import { Prisma } from "@prisma/client";
import { AssistantContext } from "../../ai/capabilities";
import { PERMISSIONS } from "../../utils/permissions";
import { startOfUtcDay } from "../../utils/date";
import {
  dateKey,
  evaluateDay,
  isWorkingDay,
  minutesNowInOrgTimezone,
  todayInOrgTimezone,
  type DayStatus,
  type WorkSchedule,
} from "../../utils/workSchedule";

/**
 * The assistant's read-only tools. Every query is scoped by organizationId, and
 * self-service tools are additionally scoped to the member's own employee id.
 *
 * What comes back is only what an answer needs: no phone numbers, addresses,
 * personal email, pay for anyone but the member, and no secrets.
 */

type Tx = Prisma.TransactionClient;
type Args = Record<string, unknown>;

export type ToolRun = (tx: Tx, args: Args, ctx: AssistantContext) => Promise<unknown>;

/* ------------------------------------------------------------- arg helpers */

function limit(args: Args, fallback = 10, max = 20): number {
  const n = Number(args.limit);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

function text(value: unknown, max = 120): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** The member's employee id, or a value that can never match a row. */
function self(ctx: AssistantContext): string {
  return ctx.employeeId ?? "__no_employee__";
}

const EMPLOYEE_CARD = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  designation: true,
  status: true,
  department: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
} as const;

function card(e: {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  status: string;
  department: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string } | null;
}) {
  return {
    id: e.id,
    code: e.employeeCode,
    name: `${e.firstName} ${e.lastName}`,
    designation: e.designation,
    status: e.status,
    department: e.department?.name ?? null,
    departmentId: e.department?.id ?? null,
    manager: e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : null,
  };
}

/* --------------------------------------------------------- work schedule */

/**
 * The organization's work schedule, read through the same transaction client as
 * everything else so a tool call stays one consistent snapshot.
 */
async function scheduleOf(tx: Tx, ctx: AssistantContext, range?: { from: Date; to: Date }): Promise<WorkSchedule> {
  const [org, holidays] = await Promise.all([
    tx.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { timezone: true, workingDays: true, workStartTime: true, workEndTime: true, fullDayHours: true },
    }),
    tx.holiday.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(range ? { date: { gte: startOfUtcDay(range.from), lte: startOfUtcDay(range.to) } } : {}),
      },
      select: { date: true, name: true },
    }),
  ]);
  return {
    timezone: org?.timezone ?? "Asia/Kolkata",
    workingDays: org?.workingDays?.length ? org.workingDays : [1, 2, 3, 4, 5],
    workStartTime: org?.workStartTime ?? "09:00",
    workEndTime: org?.workEndTime ?? "18:00",
    fullDayHours: org?.fullDayHours ?? 8,
    holidays: new Map(holidays.map((h) => [dateKey(h.date), h.name])),
  };
}

function leaveDays(leaves: { startDate: Date; endDate: Date }[]): Set<string> {
  const set = new Set<string>();
  for (const l of leaves) {
    for (let d = startOfUtcDay(l.startDate); d <= startOfUtcDay(l.endDate); d = new Date(d.getTime() + 86_400_000)) {
      set.add(dateKey(d));
    }
  }
  return set;
}

/* ------------------------------------------------------------------ tools */

export const TOOLS: Record<string, ToolRun> = {
  async company_overview(tx, _args, ctx) {
    const canSeePeople = ctx.permissions.includes(PERMISSIONS.EMPLOYEE_READ);
    const [headcount, pendingLeave, pendingCorrections, myOpenTickets] = await Promise.all([
      canSeePeople
        ? tx.employee.count({ where: { organizationId: ctx.organizationId, status: "ACTIVE" } })
        : Promise.resolve(null),
      tx.leaveRequest.count({ where: { organizationId: ctx.organizationId, status: "PENDING" } }),
      tx.attendanceCorrectionRequest.count({ where: { organizationId: ctx.organizationId, status: "PENDING" } }),
      ctx.employeeId
        ? tx.helpDeskTicket.count({
            where: {
              organizationId: ctx.organizationId,
              employeeId: ctx.employeeId,
              status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] },
            },
          })
        : Promise.resolve(null),
    ]);

    const canSeeCompanyQueue = canSeePeople || ctx.permissions.includes(PERMISSIONS.LEAVE_MANAGE);
    return {
      company: ctx.organizationName,
      today: ctx.today,
      timeZone: ctx.timeZone,
      currency: ctx.currency,
      member: { name: ctx.memberName, roles: ctx.roles, hasEmployeeRecord: !!ctx.employeeId },
      activeEmployees: headcount,
      pendingLeaveRequestsInCompany: canSeeCompanyQueue ? pendingLeave : null,
      pendingCorrectionsInCompany: canSeeCompanyQueue ? pendingCorrections : null,
      myOpenTickets,
    };
  },

  async my_profile(tx, _args, ctx) {
    const me = await tx.employee.findFirst({
      where: { id: self(ctx), organizationId: ctx.organizationId },
      select: { ...EMPLOYEE_CARD, dateOfJoining: true, exitDate: true },
    });
    if (!me) return null;
    return { ...card(me), dateOfJoining: iso(me.dateOfJoining), exitDate: iso(me.exitDate) };
  },

  async my_leave(tx, args, ctx) {
    const status = oneOf(args.status, ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const);
    const [requests, balances] = await Promise.all([
      tx.leaveRequest.findMany({
        where: { organizationId: ctx.organizationId, employeeId: self(ctx), ...(status ? { status } : {}) },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          days: true,
          status: true,
          reason: true,
          routingNote: true,
          leaveType: { select: { name: true, paid: true } },
        },
        orderBy: { startDate: "desc" },
        take: limit(args),
      }),
      tx.leaveBalance.findMany({
        where: { organizationId: ctx.organizationId, employeeId: self(ctx), year: new Date().getUTCFullYear() },
        select: { allocatedDays: true, usedDays: true, leaveType: { select: { name: true } } },
      }),
    ]);

    return {
      balances: balances.map((b) => ({
        leaveType: b.leaveType.name,
        allocated: b.allocatedDays,
        used: b.usedDays,
        remaining: Math.round((b.allocatedDays - b.usedDays) * 100) / 100,
      })),
      requests: requests.map((r) => ({
        id: r.id,
        leaveType: r.leaveType.name,
        paid: r.leaveType.paid,
        from: iso(r.startDate),
        to: iso(r.endDate),
        days: r.days,
        status: r.status,
        reason: r.reason,
        // Set when nobody can approve it yet: an admin has to fix the setup.
        routingProblem: r.routingNote,
      })),
    };
  },

  async my_attendance(tx, _args, ctx) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const schedule = await scheduleOf(tx, ctx, { from: monthStart, to: monthEnd });
    const todayDate = todayInOrgTimezone(schedule);

    const [records, leaves] = await Promise.all([
      tx.attendanceRecord.findMany({
        where: { organizationId: ctx.organizationId, employeeId: self(ctx), date: { gte: monthStart, lte: monthEnd } },
        select: { date: true, checkInAt: true, checkOutAt: true },
      }),
      tx.leaveRequest.findMany({
        where: {
          organizationId: ctx.organizationId,
          employeeId: self(ctx),
          status: "APPROVED",
          startDate: { lte: monthEnd },
          endDate: { gte: monthStart },
        },
        select: { startDate: true, endDate: true },
      }),
    ]);

    const todayRecord = records.find((r) => dateKey(r.date) === dateKey(todayDate)) ?? null;
    const checkedIn = new Set(records.filter((r) => r.checkInAt).map((r) => dateKey(r.date)));
    const onLeave = leaveDays(leaves);
    const nowMinutes = minutesNowInOrgTimezone(schedule);

    const counts: Record<DayStatus, number> = {
      HOLIDAY: 0,
      WEEKLY_OFF: 0,
      ON_LEAVE: 0,
      PRESENT: 0,
      NOT_CHECKED_IN: 0,
      ABSENT: 0,
    };
    for (let d = monthStart; d <= monthEnd; d = new Date(d.getTime() + 86_400_000)) {
      const key = dateKey(d);
      counts[
        evaluateDay({
          date: d,
          schedule,
          hasCheckIn: checkedIn.has(key),
          onApprovedLeave: onLeave.has(key),
          today: todayDate,
          nowMinutes,
        })
      ] += 1;
    }

    const hours = records.reduce((sum, r) => {
      if (!r.checkInAt || !r.checkOutAt) return sum;
      return sum + (r.checkOutAt.getTime() - r.checkInAt.getTime()) / 3_600_000;
    }, 0);

    return {
      today: {
        date: ctx.today,
        isWorkingDay: isWorkingDay(todayDate, schedule),
        holiday: schedule.holidays.get(dateKey(todayDate)) ?? null,
        checkedIn: !!todayRecord?.checkInAt,
        checkedOut: !!todayRecord?.checkOutAt,
        checkInAt: todayRecord?.checkInAt?.toISOString() ?? null,
        checkOutAt: todayRecord?.checkOutAt?.toISOString() ?? null,
      },
      // Not checked in is counted separately from absent: a working day is only
      // absent once it has finished.
      thisMonth: { ...counts, hours: Math.round(hours * 10) / 10 },
    };
  },

  async my_corrections(tx, args, ctx) {
    const rows = await tx.attendanceCorrectionRequest.findMany({
      where: { organizationId: ctx.organizationId, employeeId: self(ctx) },
      select: {
        id: true,
        date: true,
        requestedCheckInAt: true,
        requestedCheckOutAt: true,
        reason: true,
        status: true,
        decisionNote: true,
        routingNote: true,
      },
      orderBy: { date: "desc" },
      take: limit(args),
    });
    return rows.map((r) => ({
      id: r.id,
      date: iso(r.date),
      requestedCheckInAt: r.requestedCheckInAt?.toISOString() ?? null,
      requestedCheckOutAt: r.requestedCheckOutAt?.toISOString() ?? null,
      reason: r.reason,
      status: r.status,
      decisionNote: r.decisionNote,
      routingProblem: r.routingNote,
    }));
  },

  async my_payslips(tx, args, ctx) {
    // Only published, current revisions: a draft is not a payslip.
    const payslips = await tx.payslip.findMany({
      where: {
        organizationId: ctx.organizationId,
        employeeId: self(ctx),
        publishedAt: { not: null },
        supersededAt: null,
      },
      select: {
        id: true,
        grossPay: true,
        deductions: true,
        netPay: true,
        paidDays: true,
        payableDays: true,
        revisionNumber: true,
        payrollRun: { select: { month: true, year: true, status: true } },
      },
      orderBy: [{ payrollRun: { year: "desc" } }, { payrollRun: { month: "desc" } }],
      take: limit(args, 6, 12),
    });
    return payslips.map((p) => ({
      id: p.id,
      period: `${p.payrollRun.year}-${String(p.payrollRun.month).padStart(2, "0")}`,
      gross: p.grossPay,
      deductions: p.deductions,
      net: p.netPay,
      paidDays: p.paidDays,
      payableDays: p.payableDays,
      revision: p.revisionNumber,
      note: "Published means the payslip is available to read. It does not mean the salary has been paid.",
    }));
  },

  async my_onboarding_tasks(tx, _args, ctx) {
    const tasks = await tx.onboardingTask.findMany({
      where: { organizationId: ctx.organizationId, employeeId: self(ctx) },
      select: { id: true, title: true, done: true, dueDate: true, requiresVerification: true, verifiedAt: true },
      orderBy: [{ done: "asc" }, { dueDate: "asc" }],
      take: 20,
    });
    return tasks.map((t) => ({
      id: t.id,
      title: t.title,
      done: t.done,
      dueDate: iso(t.dueDate),
      needsHrCheck: t.requiresVerification,
      verified: !!t.verifiedAt,
    }));
  },

  async work_schedule(tx, _args, ctx) {
    const year = new Date().getUTCFullYear();
    const [schedule, leaveTypes] = await Promise.all([
      scheduleOf(tx, ctx, { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31)) }),
      tx.leaveType.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, name: true, defaultDaysPerYear: true, paid: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const names = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    return {
      timeZone: schedule.timezone,
      workingDays: schedule.workingDays.map((d) => names[d]),
      hours: `${schedule.workStartTime} to ${schedule.workEndTime}`,
      fullDayHours: schedule.fullDayHours,
      holidays: [...schedule.holidays.entries()]
        .map(([date, name]) => ({ date, name }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      leaveTypes,
    };
  },

  async pending_approvals(tx, args, ctx) {
    const kind = oneOf(args.kind, ["leave", "correction"] as const);
    const take = limit(args);
    const org = ctx.organizationId;
    const me = ctx.employeeId ?? "__no_employee__";

    // Authorized HR see the company; a manager sees their own direct reports.
    // Either way, never the member's own request: nobody approves themselves.
    const scope = (managePermission: string) =>
      ctx.permissions.includes(managePermission) ? { employee: { id: { not: me } } } : { employee: { managerId: me } };

    const want = (k: string) => !kind || kind === k;

    const [leave, corrections] = await Promise.all([
      want("leave")
        ? tx.leaveRequest.findMany({
            where: { organizationId: org, status: "PENDING", ...scope(PERMISSIONS.LEAVE_MANAGE) },
            select: {
              id: true,
              startDate: true,
              endDate: true,
              days: true,
              leaveType: { select: { name: true } },
              employee: { select: EMPLOYEE_CARD },
            },
            orderBy: { createdAt: "asc" },
            take,
          })
        : [],
      want("correction")
        ? tx.attendanceCorrectionRequest.findMany({
            where: { organizationId: org, status: "PENDING", ...scope(PERMISSIONS.ATTENDANCE_MANAGE) },
            select: {
              id: true,
              date: true,
              requestedCheckInAt: true,
              requestedCheckOutAt: true,
              reason: true,
              employee: { select: EMPLOYEE_CARD },
            },
            orderBy: { createdAt: "asc" },
            take,
          })
        : [],
    ]);

    return {
      counts: { leave: leave.length, correction: corrections.length },
      leave: leave.map((r) => ({
        id: r.id,
        who: card(r.employee).name,
        leaveType: r.leaveType.name,
        from: iso(r.startDate),
        to: iso(r.endDate),
        days: r.days,
      })),
      corrections: corrections.map((c) => ({
        id: c.id,
        who: card(c.employee).name,
        date: iso(c.date),
        requestedCheckInAt: c.requestedCheckInAt?.toISOString() ?? null,
        requestedCheckOutAt: c.requestedCheckOutAt?.toISOString() ?? null,
        reason: c.reason,
      })),
    };
  },

  async policy_search(tx, args, ctx) {
    const query = text(args.query);
    // Published policies only, and only this organization's.
    const policies = await tx.hrPolicy.findMany({
      where: {
        organizationId: ctx.organizationId,
        publishedAt: { not: null },
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { body: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { id: true, title: true, body: true, category: true, publishedAt: true },
      orderBy: { title: "asc" },
      take: limit(args, 5, 10),
    });
    return policies.map((a) => ({
      id: a.id,
      title: a.title,
      category: a.category,
      extract: a.body.slice(0, 800),
      publishedAt: a.publishedAt?.toISOString() ?? null,
    }));
  },

  async recent_announcements(tx, args, ctx) {
    const items = await tx.announcement.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        id: true,
        title: true,
        body: true,
        publishedAt: true,
        author: { select: { firstName: true, lastName: true } },
      },
      orderBy: { publishedAt: "desc" },
      take: limit(args, 5, 10),
    });
    return items.map((a) => ({
      id: a.id,
      title: a.title,
      extract: a.body.slice(0, 400),
      publishedAt: a.publishedAt.toISOString(),
      author: `${a.author.firstName} ${a.author.lastName}`,
    }));
  },

  async helpdesk_tickets(tx, args, ctx) {
    // Agent queues only, and only the ones this member is authorized for.
    const queues: ("HR" | "PAYROLL" | "PRODUCT")[] = [];
    if (ctx.permissions.includes(PERMISSIONS.HELPDESK_MANAGE)) queues.push("HR", "PRODUCT");
    if (ctx.permissions.includes(PERMISSIONS.HELPDESK_PAYROLL_QUEUE)) queues.push("PAYROLL");

    const scope = oneOf(args.scope, ["mine", "all"] as const) ?? "mine";
    const status = oneOf(args.status, ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"] as const);
    const asAgent = scope === "all" && queues.length > 0;

    const tickets = await tx.helpDeskTicket.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(asAgent ? { queue: { in: queues } } : { employeeId: self(ctx) }),
        ...(status ? { status } : {}),
      },
      select: {
        id: true,
        reference: true,
        type: true,
        queue: true,
        subject: true,
        status: true,
        createdAt: true,
        employee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit(args),
    });
    return tickets.map((t) => ({
      id: t.id,
      reference: t.reference,
      subject: t.subject,
      type: t.type,
      queue: t.queue,
      status: t.status,
      raisedBy: `${t.employee.firstName} ${t.employee.lastName}`,
      createdAt: t.createdAt.toISOString(),
    }));
  },

  async search_employees(tx, args, ctx) {
    const query = text(args.query);
    const status = oneOf(args.status, ["ONBOARDING", "ACTIVE", "EXITED"] as const);
    const departmentId = uuid(args.departmentId);
    const people = await tx.employee.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(status ? { status } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(query
          ? {
              OR: [
                { firstName: { contains: query, mode: "insensitive" } },
                { lastName: { contains: query, mode: "insensitive" } },
                { employeeCode: { contains: query, mode: "insensitive" } },
                { designation: { contains: query, mode: "insensitive" } },
                { department: { name: { contains: query, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      select: EMPLOYEE_CARD,
      orderBy: { firstName: "asc" },
      take: limit(args),
    });
    return people.map(card);
  },

  async employee_details(tx, args, ctx) {
    const id = uuid(args.employeeId);
    if (!id) return null;
    const person = await tx.employee.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: {
        ...EMPLOYEE_CARD,
        dateOfJoining: true,
        exitDate: true,
        directReports: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!person) return null;
    return {
      ...card(person),
      dateOfJoining: iso(person.dateOfJoining),
      exitDate: iso(person.exitDate),
      directReports: person.directReports.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` })),
    };
  },

  async attendance_today(tx, _args, ctx) {
    const schedule = await scheduleOf(tx, ctx);
    const date = todayInOrgTimezone(schedule);
    const daySchedule = await scheduleOf(tx, ctx, { from: date, to: date });

    const [employees, records, leaves] = await Promise.all([
      tx.employee.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: { not: "EXITED" },
          OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: date } }],
        },
        select: { id: true },
      }),
      tx.attendanceRecord.findMany({
        where: { organizationId: ctx.organizationId, date },
        select: { employeeId: true, checkInAt: true },
      }),
      tx.leaveRequest.findMany({
        where: { organizationId: ctx.organizationId, status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } },
        select: { employeeId: true },
      }),
    ]);

    const checkedIn = new Set(records.filter((r) => r.checkInAt).map((r) => r.employeeId));
    const onLeave = new Set(leaves.map((l) => l.employeeId));
    const nowMinutes = minutesNowInOrgTimezone(daySchedule);

    const counts: Record<DayStatus, number> = {
      HOLIDAY: 0,
      WEEKLY_OFF: 0,
      ON_LEAVE: 0,
      PRESENT: 0,
      NOT_CHECKED_IN: 0,
      ABSENT: 0,
    };
    for (const e of employees) {
      counts[
        evaluateDay({
          date,
          schedule: daySchedule,
          hasCheckIn: checkedIn.has(e.id),
          onApprovedLeave: onLeave.has(e.id),
          today: date,
          nowMinutes,
        })
      ] += 1;
    }

    return {
      date: dateKey(date),
      isWorkingDay: isWorkingDay(date, daySchedule),
      holiday: daySchedule.holidays.get(dateKey(date)) ?? null,
      employees: employees.length,
      present: counts.PRESENT,
      onLeave: counts.ON_LEAVE,
      notYetCheckedIn: counts.NOT_CHECKED_IN,
      absent: counts.ABSENT,
      weeklyOff: counts.WEEKLY_OFF,
    };
  },

  async hiring_overview(tx, args, ctx) {
    const [postings, stages] = await Promise.all([
      tx.jobPosting.findMany({
        where: { organizationId: ctx.organizationId },
        select: {
          id: true,
          title: true,
          status: true,
          location: true,
          workMode: true,
          department: { select: { name: true } },
          _count: { select: { applications: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit(args),
      }),
      tx.jobApplication.groupBy({ by: ["stage"], where: { organizationId: ctx.organizationId }, _count: { _all: true } }),
    ]);
    return {
      openings: postings.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        location: p.location,
        workMode: p.workMode,
        department: p.department?.name ?? null,
        applications: p._count.applications,
      })),
      applicationsByStage: stages.map((s) => ({ stage: s.stage, count: s._count._all })),
    };
  },

  async payroll_overview(tx, args, ctx) {
    const runs = await tx.payrollRun.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        id: true,
        month: true,
        year: true,
        status: true,
        finalizedAt: true,
        _count: { select: { payslips: true } },
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: limit(args, 6, 12),
    });
    return runs.map((r) => ({
      id: r.id,
      period: `${r.year}-${String(r.month).padStart(2, "0")}`,
      status: r.status,
      payslips: r._count.payslips,
      finalizedAt: r.finalizedAt?.toISOString() ?? null,
    }));
  },
};
