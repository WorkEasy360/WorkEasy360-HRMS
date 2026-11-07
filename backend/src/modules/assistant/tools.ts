import { Prisma } from "@prisma/client";
import { AssistantContext } from "../../ai/capabilities";
import { PERMISSIONS } from "../../utils/permissions";
import { today } from "../../utils/date";

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

/* ------------------------------------------------------------------ tools */

export const TOOLS: Record<string, ToolRun> = {
  async company_overview(tx, _args, ctx) {
    const canSeePeople = ctx.permissions.includes(PERMISSIONS.EMPLOYEE_READ);
    const [headcount, pendingLeave, myOpenTickets] = await Promise.all([
      canSeePeople ? tx.employee.count({ where: { organizationId: ctx.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
      tx.leaveRequest.count({ where: { organizationId: ctx.organizationId, status: "PENDING" } }),
      ctx.employeeId
        ? tx.helpDeskTicket.count({ where: { organizationId: ctx.organizationId, employeeId: ctx.employeeId, status: { in: ["OPEN", "IN_PROGRESS"] } } })
        : Promise.resolve(null),
    ]);

    return {
      company: ctx.organizationName,
      today: ctx.today,
      timeZone: ctx.timeZone,
      currency: ctx.currency,
      member: { name: ctx.memberName, roles: ctx.roles, hasEmployeeRecord: !!ctx.employeeId },
      activeEmployees: headcount,
      pendingLeaveRequestsInCompany: canSeePeople || ctx.permissions.includes(PERMISSIONS.LEAVE_MANAGE) ? pendingLeave : null,
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
        select: { id: true, startDate: true, endDate: true, days: true, status: true, reason: true, leaveType: { select: { name: true } } },
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
        from: iso(r.startDate),
        to: iso(r.endDate),
        days: r.days,
        status: r.status,
        reason: r.reason,
      })),
    };
  },

  async my_attendance(tx, _args, ctx) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [todayRecord, month] = await Promise.all([
      tx.attendanceRecord.findFirst({ where: { organizationId: ctx.organizationId, employeeId: self(ctx), date: today() } }),
      tx.attendanceRecord.findMany({
        where: { organizationId: ctx.organizationId, employeeId: self(ctx), date: { gte: monthStart } },
        select: { date: true, checkInAt: true, checkOutAt: true },
      }),
    ]);

    const hours = month.reduce((sum, r) => {
      if (!r.checkInAt || !r.checkOutAt) return sum;
      return sum + (r.checkOutAt.getTime() - r.checkInAt.getTime()) / 3_600_000;
    }, 0);

    return {
      today: {
        date: ctx.today,
        checkedIn: !!todayRecord?.checkInAt,
        checkedOut: !!todayRecord?.checkOutAt,
        checkInAt: todayRecord?.checkInAt?.toISOString() ?? null,
        checkOutAt: todayRecord?.checkOutAt?.toISOString() ?? null,
      },
      thisMonth: { daysPresent: month.filter((r) => r.checkInAt).length, hours: Math.round(hours * 10) / 10 },
    };
  },

  async my_timesheets(tx, args, ctx) {
    const entries = await tx.timesheetEntry.findMany({
      where: { organizationId: ctx.organizationId, employeeId: self(ctx) },
      select: { id: true, date: true, hours: true, task: true, status: true },
      orderBy: { date: "desc" },
      take: limit(args),
    });
    return entries.map((e) => ({ id: e.id, date: iso(e.date), hours: e.hours, task: e.task, status: e.status }));
  },

  async my_expenses(tx, args, ctx) {
    const claims = await tx.expenseClaim.findMany({
      where: { organizationId: ctx.organizationId, employeeId: self(ctx) },
      select: { id: true, category: true, amount: true, currency: true, expenseDate: true, status: true, description: true },
      orderBy: { expenseDate: "desc" },
      take: limit(args),
    });
    return claims.map((c) => ({ ...c, expenseDate: iso(c.expenseDate) }));
  },

  async my_loans(tx, _args, ctx) {
    const loans = await tx.loanRequest.findMany({
      where: { organizationId: ctx.organizationId, employeeId: self(ctx) },
      select: { id: true, amount: true, emiMonths: true, monthlyDeduction: true, remainingAmount: true, status: true, reason: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return loans;
  },

  async my_payslips(tx, args, ctx) {
    const payslips = await tx.payslip.findMany({
      where: { organizationId: ctx.organizationId, employeeId: self(ctx) },
      select: { id: true, grossPay: true, deductions: true, netPay: true, payrollRun: { select: { month: true, year: true, status: true } } },
      orderBy: [{ payrollRun: { year: "desc" } }, { payrollRun: { month: "desc" } }],
      take: limit(args, 6, 12),
    });
    return payslips.map((p) => ({
      id: p.id,
      period: `${p.payrollRun.year}-${String(p.payrollRun.month).padStart(2, "0")}`,
      status: p.payrollRun.status,
      gross: p.grossPay,
      deductions: p.deductions,
      net: p.netPay,
    }));
  },

  async my_goals(tx, _args, ctx) {
    const goals = await tx.goal.findMany({
      where: { organizationId: ctx.organizationId, employeeId: self(ctx) },
      select: { id: true, title: true, status: true, progress: true, dueDate: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return goals.map((g) => ({ ...g, dueDate: iso(g.dueDate) }));
  },

  async my_onboarding_tasks(tx, _args, ctx) {
    const tasks = await tx.onboardingTask.findMany({
      where: { organizationId: ctx.organizationId, employeeId: self(ctx) },
      select: { id: true, title: true, done: true, dueDate: true },
      orderBy: [{ done: "asc" }, { dueDate: "asc" }],
      take: 20,
    });
    return tasks.map((t) => ({ ...t, dueDate: iso(t.dueDate) }));
  },

  async my_assets(tx, _args, ctx) {
    return tx.asset.findMany({
      where: { organizationId: ctx.organizationId, assignedToId: self(ctx) },
      select: { id: true, name: true, category: true, serialNumber: true, status: true, assignedAt: true },
      take: 20,
    });
  },

  async pending_approvals(tx, args, ctx) {
    const kind = oneOf(args.kind, ["leave", "timesheet", "expense", "loan"] as const);
    const take = limit(args);
    const org = ctx.organizationId;
    // HR-style permissions see the whole company; everyone else sees their own reports.
    const mine = (perm: string) =>
      ctx.permissions.includes(perm) ? {} : { employee: { managerId: ctx.employeeId ?? "__no_employee__" } };

    const want = (k: string) => !kind || kind === k;

    const [leave, timesheets, expenses, loans] = await Promise.all([
      want("leave")
        ? tx.leaveRequest.findMany({
            where: { organizationId: org, status: "PENDING", ...mine(PERMISSIONS.LEAVE_MANAGE) },
            select: { id: true, startDate: true, endDate: true, days: true, leaveType: { select: { name: true } }, employee: { select: EMPLOYEE_CARD } },
            orderBy: { createdAt: "asc" },
            take,
          })
        : [],
      want("timesheet")
        ? tx.timesheetEntry.findMany({
            where: { organizationId: org, status: "PENDING", ...mine(PERMISSIONS.TIMESHEET_MANAGE) },
            select: { id: true, date: true, hours: true, task: true, employee: { select: EMPLOYEE_CARD } },
            orderBy: { date: "asc" },
            take,
          })
        : [],
      want("expense")
        ? tx.expenseClaim.findMany({
            where: { organizationId: org, status: "PENDING", ...mine(PERMISSIONS.EXPENSE_MANAGE) },
            select: { id: true, category: true, amount: true, expenseDate: true, employee: { select: EMPLOYEE_CARD } },
            orderBy: { createdAt: "asc" },
            take,
          })
        : [],
      want("loan")
        ? tx.loanRequest.findMany({
            where: { organizationId: org, status: "PENDING", ...mine(PERMISSIONS.LOAN_MANAGE) },
            select: { id: true, amount: true, emiMonths: true, employee: { select: EMPLOYEE_CARD } },
            orderBy: { createdAt: "asc" },
            take,
          })
        : [],
    ]);

    return {
      counts: { leave: leave.length, timesheet: timesheets.length, expense: expenses.length, loan: loans.length },
      leave: leave.map((r) => ({ id: r.id, who: card(r.employee).name, leaveType: r.leaveType.name, from: iso(r.startDate), to: iso(r.endDate), days: r.days })),
      timesheets: timesheets.map((t) => ({ id: t.id, who: card(t.employee).name, date: iso(t.date), hours: t.hours, task: t.task })),
      expenses: expenses.map((e) => ({ id: e.id, who: card(e.employee).name, category: e.category, amount: e.amount, date: iso(e.expenseDate) })),
      loans: loans.map((l) => ({ id: l.id, who: card(l.employee).name, amount: l.amount, emiMonths: l.emiMonths })),
    };
  },

  async leave_types(tx, _args, ctx) {
    return tx.leaveType.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, name: true, defaultDaysPerYear: true },
      orderBy: { name: "asc" },
    });
  },

  async hr_guide_search(tx, args, ctx) {
    const query = text(args.query);
    const articles = await tx.hrGuideArticle.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { body: { contains: query, mode: "insensitive" } }] } : {}),
      },
      select: { id: true, title: true, body: true, category: true },
      orderBy: { title: "asc" },
      take: limit(args, 5, 10),
    });
    return articles.map((a) => ({ id: a.id, title: a.title, category: a.category, extract: a.body.slice(0, 800) }));
  },

  async recent_announcements(tx, args, ctx) {
    const items = await tx.announcement.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, title: true, body: true, publishedAt: true, author: { select: { firstName: true, lastName: true } } },
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
    const canManage = ctx.permissions.includes(PERMISSIONS.HELPDESK_MANAGE);
    const scope = oneOf(args.scope, ["mine", "all"] as const) ?? "mine";
    const status = oneOf(args.status, ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const);
    const tickets = await tx.helpDeskTicket.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(scope === "all" && canManage ? {} : { employeeId: self(ctx) }),
        ...(status ? { status } : {}),
      },
      select: { id: true, category: true, subject: true, status: true, createdAt: true, employee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: limit(args),
    });
    return tickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      category: t.category,
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
      select: { ...EMPLOYEE_CARD, dateOfJoining: true, exitDate: true, directReports: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!person) return null;
    return {
      ...card(person),
      dateOfJoining: iso(person.dateOfJoining),
      exitDate: iso(person.exitDate),
      directReports: person.directReports.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` })),
    };
  },

  async headcount_report(tx, _args, ctx) {
    const [byStatus, byDepartment, total] = await Promise.all([
      tx.employee.groupBy({ by: ["status"], where: { organizationId: ctx.organizationId }, _count: { _all: true } }),
      tx.department.findMany({
        where: { organizationId: ctx.organizationId },
        select: { name: true, _count: { select: { employees: true } } },
        orderBy: { name: "asc" },
      }),
      tx.employee.count({ where: { organizationId: ctx.organizationId } }),
    ]);
    return {
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      byDepartment: byDepartment.map((d) => ({ department: d.name, count: d._count.employees })),
    };
  },

  async recruitment_overview(tx, args, ctx) {
    const [postings, stages] = await Promise.all([
      tx.jobPosting.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, title: true, status: true, department: { select: { name: true } }, _count: { select: { candidates: true } } },
        orderBy: { createdAt: "desc" },
        take: limit(args),
      }),
      tx.candidate.groupBy({ by: ["stage"], where: { organizationId: ctx.organizationId }, _count: { _all: true } }),
    ]);
    return {
      postings: postings.map((p) => ({ id: p.id, title: p.title, status: p.status, department: p.department?.name ?? null, candidates: p._count.candidates })),
      candidatesByStage: stages.map((s) => ({ stage: s.stage, count: s._count._all })),
    };
  },

  async payroll_overview(tx, args, ctx) {
    const runs = await tx.payrollRun.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, month: true, year: true, status: true, processedAt: true, _count: { select: { payslips: true } } },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: limit(args, 6, 12),
    });
    return runs.map((r) => ({
      id: r.id,
      period: `${r.year}-${String(r.month).padStart(2, "0")}`,
      status: r.status,
      payslips: r._count.payslips,
      processedAt: r.processedAt?.toISOString() ?? null,
    }));
  },

  async asset_inventory(tx, _args, ctx) {
    const [byStatus, byCategory] = await Promise.all([
      tx.asset.groupBy({ by: ["status"], where: { organizationId: ctx.organizationId }, _count: { _all: true } }),
      tx.asset.groupBy({ by: ["category"], where: { organizationId: ctx.organizationId }, _count: { _all: true } }),
    ]);
    return {
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      byCategory: byCategory.map((c) => ({ category: c.category, count: c._count._all })),
    };
  },
};
