import { Router } from "express";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { attendanceTrend } from "../../utils/attendanceStats";
import { dateKey, getWorkSchedule, todayInOrgTimezone } from "../../utils/workSchedule";
import { PERMISSIONS } from "../../utils/permissions";

/**
 * Home for HR/Admin (01, 1.1). One request returns every panel, and each panel
 * is present only when the reader's permissions allow it — the client never
 * decides what someone may see. Everything is read in parallel bulk queries.
 *
 * There are no invented figures here: no "vs last month" deltas, no health
 * score. Each number is something the organization's records actually say.
 */
const router = Router();
router.use(requireAuth);

const DAY_MS = 86_400_000;

router.get("/admin", async (req, res) => {
  const organizationId = req.user!.organizationId;
  const perms = new Set(req.user!.permissions);
  const me = req.user!.employeeId ?? "__none__";

  const canPeople = perms.has(PERMISSIONS.EMPLOYEE_READ);
  const canPayroll = perms.has(PERMISSIONS.PAYROLL_MANAGE);
  const canHiring = perms.has(PERMISSIONS.RECRUITMENT_MANAGE);
  const canAudit = perms.has(PERMISSIONS.AUDIT_READ);
  const queues: ("HR" | "PAYROLL" | "PRODUCT")[] = [];
  if (perms.has(PERMISSIONS.HELPDESK_MANAGE)) queues.push("HR", "PRODUCT");
  if (perms.has(PERMISSIONS.HELPDESK_PAYROLL_QUEUE)) queues.push("PAYROLL");

  // Requests waiting on this reader, scoped exactly as the approval lists are.
  const leaveScope = perms.has(PERMISSIONS.LEAVE_MANAGE)
    ? { employee: { id: { not: me } } }
    : perms.has(PERMISSIONS.LEAVE_APPROVE)
      ? { employee: { managerId: me } }
      : null;
  const correctionScope = perms.has(PERMISSIONS.ATTENDANCE_MANAGE)
    ? { employee: { id: { not: me } } }
    : perms.has(PERMISSIONS.ATTENDANCE_APPROVE)
      ? { employee: { managerId: me } }
      : null;

  const schedule = await getWorkSchedule(organizationId);
  const today = todayInOrgTimezone(schedule);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const month = today.getUTCMonth() + 1;
  const year = today.getUTCFullYear();

  const [
    trend,
    activeEmployees,
    joinedThisMonth,
    pendingLeave,
    pendingCorrections,
    payrollRun,
    tickets,
    resolvedThisMonth,
    openJobs,
    activeApplications,
    upcomingHolidays,
    upcomingInterviews,
    openJoiningTasks,
    recent,
  ] = await Promise.all([
    canPeople ? attendanceTrend(organizationId, monthStart, today) : null,
    canPeople ? prisma.employee.count({ where: { organizationId, status: { not: "EXITED" } } }) : null,
    canPeople
      ? prisma.employee.count({ where: { organizationId, dateOfJoining: { gte: monthStart, lte: today } } })
      : null,
    leaveScope ? prisma.leaveRequest.count({ where: { organizationId, status: "PENDING", ...leaveScope } }) : null,
    correctionScope
      ? prisma.attendanceCorrectionRequest.count({ where: { organizationId, status: "PENDING", ...correctionScope } })
      : null,
    canPayroll
      ? prisma.payrollRun.findUnique({
          where: { organizationId_month_year: { organizationId, month, year } },
          select: {
            id: true,
            status: true,
            finalizedAt: true,
            payslips: { where: { supersededAt: null }, select: { netPay: true, publishedAt: true } },
          },
        })
      : null,
    queues.length
      ? prisma.helpDeskTicket.groupBy({
          by: ["status"],
          where: { organizationId, queue: { in: queues } },
          _count: { _all: true },
        })
      : null,
    queues.length
      ? prisma.helpDeskTicket.count({
          where: { organizationId, queue: { in: queues }, resolvedAt: { gte: monthStart } },
        })
      : null,
    canHiring ? prisma.jobPosting.count({ where: { organizationId, status: "OPEN" } }) : null,
    canHiring
      ? prisma.jobApplication.count({ where: { organizationId, stage: { notIn: ["REJECTED", "JOINED"] } } })
      : null,
    prisma.holiday.findMany({
      where: { organizationId, date: { gte: today, lte: new Date(today.getTime() + 45 * DAY_MS) } },
      select: { date: true, name: true },
      orderBy: { date: "asc" },
      take: 4,
    }),
    canHiring
      ? prisma.interview.findMany({
          where: { organizationId, scheduledAt: { gte: new Date(), lte: new Date(Date.now() + 14 * DAY_MS) } },
          select: {
            id: true,
            scheduledAt: true,
            application: {
              select: { candidate: { select: { firstName: true, lastName: true } }, jobPosting: { select: { title: true } } },
            },
          },
          orderBy: { scheduledAt: "asc" },
          take: 4,
        })
      : [],
    perms.has(PERMISSIONS.ONBOARDING_MANAGE)
      ? prisma.onboardingTask.count({ where: { organizationId, done: false } })
      : null,
    canAudit
      ? prisma.auditLog.findMany({
          where: { organizationId },
          select: { id: true, action: true, entityType: true, createdAt: true, actor: { select: { email: true } } },
          orderBy: { createdAt: "desc" },
          take: 6,
        })
      : null,
  ]);

  const todayRow = trend?.days[trend.days.length - 1] ?? null;
  const workingRates = (trend?.days ?? []).filter((d) => d.rate !== null).map((d) => d.rate as number);

  const ticketCounts = tickets
    ? Object.fromEntries(tickets.map((t) => [t.status, t._count._all]))
    : null;

  // Upcoming: holidays, interviews, and this month's payroll if it is still open.
  const upcoming = [
    ...upcomingHolidays.map((h) => ({ kind: "holiday" as const, date: dateKey(h.date), title: h.name, detail: "Company holiday" })),
    ...upcomingInterviews.map((i) => ({
      kind: "interview" as const,
      date: i.scheduledAt.toISOString(),
      title: `Interview: ${i.application.candidate.firstName} ${i.application.candidate.lastName}`,
      detail: i.application.jobPosting.title,
    })),
    ...(canPayroll && payrollRun?.status !== "FINALIZED"
      ? [
          {
            kind: "payroll" as const,
            date: dateKey(new Date(Date.UTC(year, month, 0))),
            title: payrollRun ? "Finalize this month's payroll" : "Start this month's payroll",
            detail: payrollRun ? "Prepared as a draft, not yet finalized" : "No payroll period created yet",
          },
        ]
      : []),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return res.json({
    today: dateKey(today),
    timezone: schedule.timezone,
    people: canPeople
      ? {
          activeEmployees,
          joinedThisMonth,
          openJoiningTasks,
          today: todayRow
            ? { isWorkingDay: todayRow.isWorkingDay, holiday: todayRow.holiday, eligible: todayRow.eligible, ...todayRow.counts }
            : null,
          monthAverageRate: workingRates.length
            ? Math.round((workingRates.reduce((a, b) => a + b, 0) / workingRates.length) * 10) / 10
            : null,
          trend: trend?.days.map((d) => ({ date: d.date, rate: d.rate, present: d.counts.PRESENT, eligible: d.eligible })) ?? [],
        }
      : null,
    pending: {
      leave: pendingLeave,
      corrections: pendingCorrections,
      tickets: ticketCounts ? (ticketCounts.OPEN ?? 0) : null,
    },
    payroll: canPayroll
      ? {
          month,
          year,
          status: payrollRun?.status ?? null,
          netTotal: payrollRun ? payrollRun.payslips.reduce((sum, p) => sum + p.netPay, 0) : null,
          payslips: payrollRun?.payslips.length ?? 0,
          published: payrollRun?.payslips.filter((p) => p.publishedAt).length ?? 0,
        }
      : null,
    helpdesk: ticketCounts
      ? {
          open: ticketCounts.OPEN ?? 0,
          inProgress: ticketCounts.IN_PROGRESS ?? 0,
          waiting: ticketCounts.WAITING ?? 0,
          resolvedThisMonth: resolvedThisMonth ?? 0,
        }
      : null,
    hiring: canHiring ? { openJobs, activeApplications } : null,
    upcoming,
    recent: recent?.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      actor: r.actor?.email ?? null,
      createdAt: r.createdAt.toISOString(),
    })) ?? null,
  });
});

export default router;
