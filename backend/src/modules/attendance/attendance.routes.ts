import { Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { assertCanDecideRequest, resolveApprovalRoute, type ApprovalPermissions } from "../../utils/approvals";
import { PERMISSIONS } from "../../utils/permissions";
import { monthRange, startOfUtcDay } from "../../utils/date";
import { HttpError } from "../../utils/HttpError";
import { notifyCorrectionDecided, notifyCorrectionRequested } from "../../utils/notifications";
import { attendanceTrend } from "../../utils/attendanceStats";
import {
  dateKey,
  evaluateDay,
  getWorkSchedule,
  isWorkingDay,
  minutesNowInOrgTimezone,
  parseTimeToMinutes,
  todayInOrgTimezone,
  type DayStatus,
} from "../../utils/workSchedule";

const router = Router();
router.use(requireAuth);

const CORRECTION_PERMISSIONS: ApprovalPermissions = {
  approve: PERMISSIONS.ATTENDANCE_APPROVE,
  manage: PERMISSIONS.ATTENDANCE_MANAGE,
};

function requireSelfEmployee(req: Request): string {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");
  return employeeId;
}

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;
function parseDateParam(value: unknown, fallback: Date): Date {
  if (typeof value !== "string") return fallback;
  if (!DATE_PARAM.test(value)) throw new HttpError(400, "date must be in YYYY-MM-DD format");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, "date must be a real calendar date");
  return parsed;
}

// ─── Check in / check out (3.1.2) ──────────────────────────────────────────

router.post("/check-in", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const schedule = await getWorkSchedule(req.user!.organizationId);
  // The working day is the organization's calendar day, not the server's (rule 03).
  const date = todayInOrgTimezone(schedule);

  const existing = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (existing?.checkInAt) {
    return res.status(409).json({ error: "Already checked in today" });
  }

  const record = await prisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date } },
    create: { organizationId: req.user!.organizationId, employeeId, date, checkInAt: new Date() },
    update: { checkInAt: new Date() },
  });
  return res.status(201).json(record);
});

router.post("/check-out", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const schedule = await getWorkSchedule(req.user!.organizationId);
  const date = todayInOrgTimezone(schedule);

  const existing = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (!existing?.checkInAt) {
    return res.status(400).json({ error: "Must check in before checking out" });
  }
  if (existing.checkOutAt) {
    return res.status(409).json({ error: "Already checked out today" });
  }

  const record = await prisma.attendanceRecord.update({ where: { id: existing.id }, data: { checkOutAt: new Date() } });
  return res.json(record);
});

// ─── Work schedule and applicable rules (3.3) ──────────────────────────────

router.get("/schedule", async (req, res) => {
  const { year } = req.query as { year?: string };
  const y = year && /^\d{4}$/.test(year) ? Number(year) : new Date().getUTCFullYear();
  const [schedule, leaveTypes] = await Promise.all([
    getWorkSchedule(req.user!.organizationId, {
      from: new Date(Date.UTC(y, 0, 1)),
      to: new Date(Date.UTC(y, 11, 31)),
    }),
    prisma.leaveType.findMany({
      where: { organizationId: req.user!.organizationId },
      select: { id: true, name: true, defaultDaysPerYear: true, paid: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return res.json({
    timezone: schedule.timezone,
    workingDays: schedule.workingDays,
    workStartTime: schedule.workStartTime,
    workEndTime: schedule.workEndTime,
    fullDayHours: schedule.fullDayHours,
    holidays: [...schedule.holidays.entries()]
      .map(([date, name]) => ({ date, name }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    leaveTypes,
  });
});

// ─── Own history and monthly summary (3.1.1) ───────────────────────────────

router.get("/me", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const { month } = req.query as { month?: string };
  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId, ...(month ? monthRange(month) : {}) },
    orderBy: { date: "desc" },
  });
  return res.json(records);
});

/** Monthly summary for one employee: counted against the work schedule. */
router.get("/summary", async (req, res) => {
  const organizationId = req.user!.organizationId;
  const { month, employeeId: queryEmployeeId } = req.query as { month?: string; employeeId?: string };
  const self = req.user!.employeeId;
  const canReadAll = req.user!.permissions.includes(PERMISSIONS.EMPLOYEE_READ);
  const employeeId = queryEmployeeId && canReadAll ? queryEmployeeId : self;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");
  if (!month) throw new HttpError(400, "month is required, in YYYY-MM format");

  const range = monthRange(month).date;
  const lastDay = new Date(range.lt.getTime() - 86_400_000);
  const [schedule, records, leaves] = await Promise.all([
    getWorkSchedule(organizationId, { from: range.gte, to: lastDay }),
    prisma.attendanceRecord.findMany({
      where: { organizationId, employeeId, date: range },
      select: { date: true, checkInAt: true, checkOutAt: true },
    }),
    prisma.leaveRequest.findMany({
      where: { organizationId, employeeId, status: "APPROVED", startDate: { lt: range.lt }, endDate: { gte: range.gte } },
      select: { startDate: true, endDate: true },
    }),
  ]);

  const checkedIn = new Set(records.filter((r) => r.checkInAt).map((r) => dateKey(r.date)));
  const onLeave = leaveDateSet(leaves);
  const today = todayInOrgTimezone(schedule);
  const nowMinutes = minutesNowInOrgTimezone(schedule);

  const counts: Record<DayStatus, number> = {
    HOLIDAY: 0,
    WEEKLY_OFF: 0,
    ON_LEAVE: 0,
    PRESENT: 0,
    NOT_CHECKED_IN: 0,
    ABSENT: 0,
  };
  const days: { date: string; status: DayStatus; holiday: string | null }[] = [];
  for (let d = range.gte; d < range.lt; d = new Date(d.getTime() + 86_400_000)) {
    const key = dateKey(d);
    const status = evaluateDay({
      date: d,
      schedule,
      hasCheckIn: checkedIn.has(key),
      onApprovedLeave: onLeave.has(key),
      today,
      nowMinutes,
    });
    counts[status] += 1;
    days.push({ date: key, status, holiday: schedule.holidays.get(key) ?? null });
  }

  const workingDays = counts.PRESENT + counts.ON_LEAVE + counts.ABSENT + counts.NOT_CHECKED_IN;
  return res.json({ month, employeeId, workingDays, ...counts, records, days, today: dateKey(today) });
});

function leaveDateSet(leaves: { startDate: Date; endDate: Date }[]): Set<string> {
  const set = new Set<string>();
  for (const l of leaves) {
    for (let d = startOfUtcDay(l.startDate); d <= startOfUtcDay(l.endDate); d = new Date(d.getTime() + 86_400_000)) {
      set.add(dateKey(d));
    }
  }
  return set;
}

// ─── Attendance trend, HR/Admin ────────────────────────────────────────────

/**
 * Attendance rate per day for the last `days` days, ending today in the
 * organization's time zone. Non-working days carry no rate.
 */
router.get("/trend", requirePermission(PERMISSIONS.EMPLOYEE_READ), async (req, res) => {
  const n = Math.min(62, Math.max(1, Number(req.query.days) || 7));
  const schedule = await getWorkSchedule(req.user!.organizationId);
  const to = todayInOrgTimezone(schedule);
  const from = new Date(to.getTime() - (n - 1) * 86_400_000);
  return res.json(await attendanceTrend(req.user!.organizationId, from, to));
});

// ─── Daily register (3.1.1), HR/Admin ──────────────────────────────────────

router.get("/register", requirePermission(PERMISSIONS.EMPLOYEE_READ), async (req, res) => {
  const organizationId = req.user!.organizationId;
  const scheduleForToday = await getWorkSchedule(organizationId);
  const date = parseDateParam(req.query.date, todayInOrgTimezone(scheduleForToday));
  const schedule = await getWorkSchedule(organizationId, { from: date, to: date });

  const [employees, records, leaves] = await Promise.all([
    prisma.employee.findMany({
      where: {
        organizationId,
        status: { not: "EXITED" },
        OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: date } }],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        department: { select: { name: true } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.attendanceRecord.findMany({
      where: { organizationId, date },
      select: { employeeId: true, checkInAt: true, checkOutAt: true },
    }),
    prisma.leaveRequest.findMany({
      where: { organizationId, status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } },
      select: { employeeId: true },
    }),
  ]);

  const byEmployee = new Map(records.map((r) => [r.employeeId, r]));
  const dayFinished =
    dateKey(date) < dateKey(todayInOrgTimezone(schedule)) ||
    (dateKey(date) === dateKey(todayInOrgTimezone(schedule)) &&
      minutesNowInOrgTimezone(schedule) >= parseTimeToMinutes(schedule.workEndTime));
  const onLeave = new Set(leaves.map((l) => l.employeeId));
  const today = todayInOrgTimezone(schedule);
  const nowMinutes = minutesNowInOrgTimezone(schedule);

  const rows = employees.map((e) => {
    const record = byEmployee.get(e.id);
    return {
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`,
      employeeCode: e.employeeCode,
      department: e.department?.name ?? null,
      checkInAt: record?.checkInAt ?? null,
      checkOutAt: record?.checkOutAt ?? null,
      // A missing check-out is shown, not silently treated as a full day
      // (rule 03) — but only once the day has finished. While it is still
      // running, no check-out simply means they are still at work.
      missingCheckOut: !!record?.checkInAt && !record.checkOutAt && dayFinished,
      status: evaluateDay({
        date,
        schedule,
        hasCheckIn: !!record?.checkInAt,
        onApprovedLeave: onLeave.has(e.id),
        today,
        nowMinutes,
      }),
    };
  });

  return res.json({
    date: dateKey(date),
    isWorkingDay: isWorkingDay(date, schedule),
    holiday: schedule.holidays.get(dateKey(date)) ?? null,
    rows,
  });
});

router.get("/", requirePermission(PERMISSIONS.EMPLOYEE_READ), async (req, res) => {
  const { employeeId, month } = req.query as { employeeId?: string; month?: string };
  const records = await prisma.attendanceRecord.findMany({
    where: {
      organizationId: req.user!.organizationId,
      ...(employeeId ? { employeeId } : {}),
      ...(month ? monthRange(month) : {}),
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { date: "desc" },
  });
  return res.json(records);
});

// ─── Corrections (3.1.3) ───────────────────────────────────────────────────

export const correctionSchema = z
  .object({
    date: z.coerce.date(),
    requestedCheckInAt: z.coerce.date().optional(),
    requestedCheckOutAt: z.coerce.date().optional(),
    reason: z.string().trim().min(3).max(5000),
  })
  .refine((d) => d.requestedCheckInAt || d.requestedCheckOutAt, {
    message: "Give a corrected check-in time, a check-out time, or both",
    path: ["requestedCheckInAt"],
  })
  .refine((d) => !d.requestedCheckInAt || !d.requestedCheckOutAt || d.requestedCheckOutAt > d.requestedCheckInAt, {
    message: "Check-out must be after check-in",
    path: ["requestedCheckOutAt"],
  });

router.get("/corrections/me", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const rows = await prisma.attendanceCorrectionRequest.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    include: { approver: { select: { firstName: true, lastName: true } } },
  });
  return res.json(rows);
});

router.get("/corrections/pending", async (req, res) => {
  const organizationId = req.user!.organizationId;
  const canManageAll = req.user!.permissions.includes(PERMISSIONS.ATTENDANCE_MANAGE);
  const canApproveReports = req.user!.permissions.includes(PERMISSIONS.ATTENDANCE_APPROVE);
  if (!canManageAll && !canApproveReports) return res.json([]);

  const rows = await prisma.attendanceCorrectionRequest.findMany({
    where: {
      organizationId,
      status: "PENDING",
      employee: canManageAll
        ? { id: { not: req.user!.employeeId ?? "__none__" } }
        : { managerId: req.user!.employeeId ?? "__none__" },
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { createdAt: "asc" },
  });
  return res.json(rows);
});

router.post("/corrections", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const organizationId = req.user!.organizationId;
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const date = startOfUtcDay(parsed.data.date);
  const schedule = await getWorkSchedule(organizationId);
  if (date > todayInOrgTimezone(schedule)) {
    return res.status(400).json({ error: "You can only correct a day that has already happened" });
  }

  const duplicate = await prisma.attendanceCorrectionRequest.findFirst({
    where: { employeeId, date, status: "PENDING" },
    select: { id: true },
  });
  if (duplicate) {
    return res.status(409).json({ error: "You already have a pending correction for that day" });
  }

  const route = await resolveApprovalRoute(organizationId, employeeId, CORRECTION_PERMISSIONS);
  const created = await prisma.attendanceCorrectionRequest.create({
    data: {
      organizationId,
      employeeId,
      date,
      requestedCheckInAt: parsed.data.requestedCheckInAt,
      requestedCheckOutAt: parsed.data.requestedCheckOutAt,
      reason: parsed.data.reason,
      routingNote: route.routingNote,
    },
  });
  void notifyCorrectionRequested(created.id);
  return res.status(201).json(created);
});

router.post("/corrections/:id/cancel", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const { count } = await prisma.attendanceCorrectionRequest.updateMany({
    where: { id: req.params.id, employeeId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
  if (!count) return res.status(409).json({ error: "Only a pending correction can be cancelled" });
  return res.json(await prisma.attendanceCorrectionRequest.findUniqueOrThrow({ where: { id: req.params.id } }));
});

async function decideCorrection(req: Request, res: Response, approve: boolean) {
  const schema = z.object({ decisionNote: z.string().trim().max(5000).optional() });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const request = await prisma.attendanceCorrectionRequest.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!request) return res.status(404).json({ error: "Correction request not found" });
  if (request.status !== "PENDING") return res.status(409).json({ error: "Request has already been decided" });

  await assertCanDecideRequest({
    organizationId,
    reviewerEmployeeId: req.user!.employeeId,
    requesterEmployeeId: request.employeeId,
    permissions: CORRECTION_PERMISSIONS,
  });

  const updated = await prisma.$transaction(async (tx) => {
    // Conditional transition: a repeated approval can't apply the punch twice.
    const { count } = await tx.attendanceCorrectionRequest.updateMany({
      where: { id: request.id, organizationId, status: "PENDING" },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        approverId: req.user!.employeeId,
        decisionNote: parsed.data.decisionNote,
        decidedAt: new Date(),
        routingNote: null,
      },
    });
    if (!count) throw new HttpError(409, "Request has already been decided");

    if (approve) {
      await tx.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: request.employeeId, date: request.date } },
        create: {
          organizationId,
          employeeId: request.employeeId,
          date: request.date,
          checkInAt: request.requestedCheckInAt,
          checkOutAt: request.requestedCheckOutAt,
        },
        update: {
          ...(request.requestedCheckInAt ? { checkInAt: request.requestedCheckInAt } : {}),
          ...(request.requestedCheckOutAt ? { checkOutAt: request.requestedCheckOutAt } : {}),
        },
      });
    }

    return tx.attendanceCorrectionRequest.findUniqueOrThrow({ where: { id: request.id } });
  });

  void notifyCorrectionDecided(updated.id);
  return res.json(updated);
}

router.post("/corrections/:id/approve", (req, res) => decideCorrection(req, res, true));
router.post("/corrections/:id/reject", (req, res) => decideCorrection(req, res, false));

export default router;
