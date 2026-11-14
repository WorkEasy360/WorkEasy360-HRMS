import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { writeAuditLog } from "../../utils/audit";
import { startOfUtcDay } from "../../utils/date";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";
import { notifyPayslipsPublished } from "../../utils/notifications";
import { dateKey, getWorkSchedule, isWorkingDay, type WorkSchedule } from "../../utils/workSchedule";

const router = Router();
router.use(requireAuth);

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Employee view (4.3.2) ─────────────────────────────────────────────────

/** Own payslips. Only published, current revisions — a draft is not a payslip. */
router.get("/me/payslips", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const payslips = await prisma.payslip.findMany({
    where: { employeeId, publishedAt: { not: null }, supersededAt: null },
    include: { payrollRun: { select: { month: true, year: true, status: true } } },
    orderBy: [{ payrollRun: { year: "desc" } }, { payrollRun: { month: "desc" } }],
  });
  return res.json(payslips);
});

// ─── Payroll runs (4.2) ────────────────────────────────────────────────────

router.get("/", requirePermission(PERMISSIONS.PAYROLL_MANAGE), async (req, res) => {
  const runs = await prisma.payrollRun.findMany({
    where: { organizationId: req.user!.organizationId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { _count: { select: { payslips: true } } },
  });
  return res.json(runs);
});

const createRunSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
});

router.post("/", requirePermission(PERMISSIONS.PAYROLL_MANAGE), async (req, res) => {
  const parsed = createRunSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const existing = await prisma.payrollRun.findUnique({
    where: { organizationId_month_year: { organizationId, month: parsed.data.month, year: parsed.data.year } },
  });
  // Rule 08: one run per employer per period, so a retry can't duplicate it.
  if (existing) return res.status(409).json({ error: "A payroll run already exists for this month" });

  const run = await prisma.payrollRun.create({ data: { organizationId, ...parsed.data } });
  return res.status(201).json(run);
});

router.get("/:id/payslips", requirePermission(PERMISSIONS.PAYROLL_MANAGE), async (req, res) => {
  const payslips = await prisma.payslip.findMany({
    where: { payrollRunId: req.params.id, organizationId: req.user!.organizationId },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: [{ employee: { employeeCode: "asc" } }, { revisionNumber: "asc" }],
  });
  return res.json(payslips);
});

// ─── Preparation (4.2.1, 4.2.2) ────────────────────────────────────────────

type PreparedPayslip = {
  employeeId: string;
  grossPay: number;
  payableDays: number;
  paidDays: number;
  calculationInputs: Record<string, unknown>;
};

/**
 * Builds one period's payslips from explicitly approved inputs only
 * (Payroll rules 01, 06, 07): effective-dated salary, joining/exit dates, the
 * work schedule, and approved unpaid leave.
 *
 * No statutory deduction is applied. Rule 09 forbids shipping a placeholder as
 * a production calculation, so deductions stay at zero until an authorized user
 * records one as an adjustment during review.
 */
async function preparePayslips(organizationId: string, month: number, year: number): Promise<PreparedPayslip[]> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0));

  const [schedule, employees] = await Promise.all([
    getWorkSchedule(organizationId, { from: periodStart, to: periodEnd }),
    // Rule 06: eligibility comes from joining/exit dates, not today's status.
    // Someone who left mid-month may still be owed salary for the period.
    prisma.employee.findMany({
      where: {
        organizationId,
        dateOfJoining: { not: null, lte: periodEnd },
        OR: [{ exitDate: null }, { exitDate: { gte: periodStart } }],
      },
      select: { id: true, dateOfJoining: true, exitDate: true },
    }),
  ]);
  if (employees.length === 0) return [];

  const employeeIds = employees.map((e) => e.id);
  // Two bulk reads, never a query per employee: the database is a long way off.
  const [compensations, unpaidLeaves] = await Promise.all([
    prisma.compensationRecord.findMany({
      where: { organizationId, employeeId: { in: employeeIds }, effectiveFrom: { lte: periodEnd } },
      orderBy: [{ employeeId: "asc" }, { effectiveFrom: "asc" }],
    }),
    prisma.leaveRequest.findMany({
      where: {
        organizationId,
        employeeId: { in: employeeIds },
        status: "APPROVED",
        leaveType: { paid: false },
        startDate: { lte: periodEnd },
        endDate: { gte: periodStart },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
  ]);

  const compByEmployee = new Map<string, typeof compensations>();
  for (const c of compensations) compByEmployee.set(c.employeeId, [...(compByEmployee.get(c.employeeId) ?? []), c]);

  const unpaidByEmployee = new Map<string, Set<string>>();
  for (const l of unpaidLeaves) {
    const set = unpaidByEmployee.get(l.employeeId) ?? new Set<string>();
    for (let d = startOfUtcDay(l.startDate); d <= startOfUtcDay(l.endDate); d = new Date(d.getTime() + 86_400_000)) {
      set.add(dateKey(d));
    }
    unpaidByEmployee.set(l.employeeId, set);
  }

  const totalWorkingDays = workingDaysOf(periodStart, periodEnd, schedule).length;
  const currency = compensations[0]?.currency ?? "INR";

  const rows: PreparedPayslip[] = [];
  for (const employee of employees) {
    const history = compByEmployee.get(employee.id) ?? [];
    if (history.length === 0) continue; // no salary on file: not paid, not guessed

    const joined = employee.dateOfJoining ? startOfUtcDay(employee.dateOfJoining) : periodStart;
    const left = employee.exitDate ? startOfUtcDay(employee.exitDate) : periodEnd;
    const from = joined > periodStart ? joined : periodStart;
    const to = left < periodEnd ? left : periodEnd;
    if (to < from) continue;

    const payableDates = workingDaysOf(from, to, schedule);
    const unpaid = unpaidByEmployee.get(employee.id) ?? new Set<string>();

    // Day by day, so a mid-month salary change and unpaid leave both land on
    // the exact days they apply to (rule 07).
    let gross = 0;
    let paidDays = 0;
    const segments = new Map<string, { monthlyGross: number; days: number }>();
    for (const day of payableDates) {
      const key = dateKey(day);
      if (unpaid.has(key)) continue;
      const inForce = latestOnOrBefore(history, day);
      if (!inForce) continue;
      const dailyRate = totalWorkingDays > 0 ? inForce.monthlyGross / totalWorkingDays : 0;
      gross += dailyRate;
      paidDays += 1;
      const seg = segments.get(inForce.id) ?? { monthlyGross: inForce.monthlyGross, days: 0 };
      seg.days += 1;
      segments.set(inForce.id, seg);
    }

    rows.push({
      employeeId: employee.id,
      grossPay: round2(gross),
      payableDays: payableDates.length,
      paidDays,
      // Kept with the payslip so a finalized amount can always be explained.
      calculationInputs: {
        basis: "paid-days",
        rounding: "half-up to 2 decimals",
        currency,
        period: { month, year, start: dateKey(periodStart), end: dateKey(periodEnd) },
        totalWorkingDays,
        eligibleFrom: dateKey(from),
        eligibleTo: dateKey(to),
        dateOfJoining: employee.dateOfJoining ? dateKey(employee.dateOfJoining) : null,
        exitDate: employee.exitDate ? dateKey(employee.exitDate) : null,
        unpaidLeaveDays: payableDates.filter((d) => unpaid.has(dateKey(d))).length,
        salarySegments: [...segments.entries()].map(([id, s]) => ({
          compensationRecordId: id,
          monthlyGross: s.monthlyGross,
          paidDays: s.days,
        })),
        workSchedule: {
          timezone: schedule.timezone,
          workingDays: schedule.workingDays,
          holidaysInPeriod: [...schedule.holidays.keys()].filter((k) => k >= dateKey(periodStart) && k <= dateKey(periodEnd)),
        },
        deductionRules: [],
        note: "No statutory deduction is applied automatically. Authorized adjustments are recorded during review.",
      },
    });
  }

  return rows;
}

function workingDaysOf(from: Date, to: Date, schedule: WorkSchedule): Date[] {
  const days: Date[] = [];
  for (let d = startOfUtcDay(from); d <= startOfUtcDay(to); d = new Date(d.getTime() + 86_400_000)) {
    if (isWorkingDay(d, schedule)) days.push(d);
  }
  return days;
}

function latestOnOrBefore<T extends { effectiveFrom: Date }>(sortedAscending: T[], day: Date): T | null {
  let found: T | null = null;
  for (const record of sortedAscending) {
    if (startOfUtcDay(record.effectiveFrom) <= day) found = record;
    else break;
  }
  return found;
}

/** Recalculate the draft payslips for a run. Only while it is still DRAFT. */
router.post("/:id/prepare", requirePermission(PERMISSIONS.PAYROLL_MANAGE), async (req, res) => {
  const organizationId = req.user!.organizationId;
  const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, organizationId } });
  if (!run) return res.status(404).json({ error: "Payroll run not found" });
  if (run.status === "FINALIZED") {
    return res.status(409).json({ error: "This payroll is finalized. Use a payslip revision to correct it." });
  }

  const rows = await preparePayslips(organizationId, run.month, run.year);

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.payrollRun.updateMany({
      where: { id: run.id, organizationId, status: "DRAFT" },
      data: { status: "DRAFT" },
    });
    if (!count) throw new HttpError(409, "This payroll run is no longer a draft");
    await tx.payslip.deleteMany({ where: { payrollRunId: run.id, organizationId } });
    if (rows.length > 0) {
      await tx.payslip.createMany({
        data: rows.map((r) => ({
          organizationId,
          payrollRunId: run.id,
          employeeId: r.employeeId,
          grossPay: r.grossPay,
          deductions: 0,
          netPay: r.grossPay,
          payableDays: r.payableDays,
          paidDays: r.paidDays,
          calculationInputs: r.calculationInputs as object,
        })),
      });
    }
  });

  const payslips = await prisma.payslip.findMany({
    where: { payrollRunId: run.id, organizationId },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { employee: { employeeCode: "asc" } },
  });
  return res.json({ run: await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } }), payslips });
});

/** An authorized adjustment during review (4.2.2). Draft only. */
const adjustSchema = z.object({
  deductions: z.number().min(0).max(100_000_000),
  note: z.string().trim().max(2000).optional(),
});

router.patch("/:id/payslips/:payslipId", requirePermission(PERMISSIONS.PAYROLL_MANAGE), async (req, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const payslip = await prisma.payslip.findFirst({
    where: { id: req.params.payslipId, payrollRunId: req.params.id, organizationId },
    include: { payrollRun: { select: { status: true } } },
  });
  if (!payslip) return res.status(404).json({ error: "Payslip not found" });
  if (payslip.payrollRun.status === "FINALIZED") {
    return res.status(409).json({ error: "This payroll is finalized. Use a payslip revision to correct it." });
  }

  const deductions = round2(parsed.data.deductions);
  if (deductions > payslip.grossPay) {
    return res.status(400).json({ error: "Deductions can't exceed gross pay" });
  }

  const inputs = (payslip.calculationInputs as Record<string, unknown> | null) ?? {};
  const updated = await prisma.payslip.update({
    where: { id: payslip.id },
    data: {
      deductions,
      netPay: round2(payslip.grossPay - deductions),
      calculationInputs: {
        ...inputs,
        adjustment: { deductions, note: parsed.data.note ?? null, byUserId: req.user!.sub, at: new Date().toISOString() },
      } as object,
    },
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "payroll.payslip_adjusted",
    entityType: "Payslip",
    entityId: payslip.id,
    before: { deductions: payslip.deductions, netPay: payslip.netPay },
    after: { deductions: updated.deductions, netPay: updated.netPay, note: parsed.data.note ?? null },
  });
  return res.json(updated);
});

// ─── Finalize (4.2.3) ──────────────────────────────────────────────────────

router.post("/:id/finalize", requirePermission(PERMISSIONS.PAYROLL_MANAGE), async (req, res) => {
  const organizationId = req.user!.organizationId;
  const run = await prisma.payrollRun.findFirst({
    where: { id: req.params.id, organizationId },
    include: { _count: { select: { payslips: true } } },
  });
  if (!run) return res.status(404).json({ error: "Payroll run not found" });
  if (run.status === "FINALIZED") return res.status(409).json({ error: "This payroll run is already finalized" });
  if (run._count.payslips === 0) {
    return res.status(409).json({ error: "Prepare the payroll before finalizing it" });
  }

  const finalized = await prisma.$transaction(async (tx) => {
    // Rule 08: a conditional transition, so two concurrent confirmations can't
    // both finalize the same period.
    const { count } = await tx.payrollRun.updateMany({
      where: { id: run.id, organizationId, status: "DRAFT" },
      data: { status: "FINALIZED", finalizedAt: new Date(), finalizedById: req.user!.employeeId },
    });
    if (!count) throw new HttpError(409, "This payroll run is already finalized");
    return tx.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "payroll.finalize",
    entityType: "PayrollRun",
    entityId: run.id,
    after: { month: run.month, year: run.year, payslipCount: run._count.payslips },
  });
  return res.json(finalized);
});

// ─── Publish payslips (4.3.1) ──────────────────────────────────────────────

router.post("/:id/publish", requirePermission(PERMISSIONS.PAYROLL_MANAGE), async (req, res) => {
  const organizationId = req.user!.organizationId;
  const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, organizationId } });
  if (!run) return res.status(404).json({ error: "Payroll run not found" });
  if (run.status !== "FINALIZED") {
    return res.status(409).json({ error: "Finalize the payroll before publishing payslips" });
  }

  // Publishing only makes payslips visible. It is not a payment (rule 03).
  const { count } = await prisma.payslip.updateMany({
    where: { payrollRunId: run.id, organizationId, publishedAt: null, supersededAt: null },
    data: { publishedAt: new Date() },
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "payroll.publish",
    entityType: "PayrollRun",
    entityId: run.id,
    after: { published: count },
  });

  if (count > 0) void notifyPayslipsPublished(run.id);
  return res.json({ published: count });
});

// ─── Controlled revision (rule 02) ─────────────────────────────────────────

const reviseSchema = z.object({
  grossPay: z.number().min(0).max(100_000_000),
  deductions: z.number().min(0).max(100_000_000),
  reason: z.string().trim().min(3).max(2000),
});

/**
 * Corrects a finalized payslip by adding a new revision that references the
 * original. The original row is never edited and never disappears.
 */
router.post("/:id/payslips/:payslipId/revise", requirePermission(PERMISSIONS.PAYROLL_MANAGE), async (req, res) => {
  const parsed = reviseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;
  const { grossPay, deductions, reason } = parsed.data;
  if (deductions > grossPay) return res.status(400).json({ error: "Deductions can't exceed gross pay" });

  const original = await prisma.payslip.findFirst({
    where: { id: req.params.payslipId, payrollRunId: req.params.id, organizationId },
    include: { payrollRun: { select: { status: true } } },
  });
  if (!original) return res.status(404).json({ error: "Payslip not found" });
  if (original.payrollRun.status !== "FINALIZED") {
    return res.status(409).json({ error: "Only a finalized payslip needs a revision. Adjust the draft instead." });
  }
  if (original.supersededAt) {
    return res.status(409).json({ error: "This payslip has already been revised. Revise the current version." });
  }

  const revision = await prisma.$transaction(async (tx) => {
    // Conditional supersede, so a retried correction creates one revision only.
    const { count } = await tx.payslip.updateMany({
      where: { id: original.id, organizationId, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    if (!count) throw new HttpError(409, "This payslip has already been revised");

    const inputs = (original.calculationInputs as Record<string, unknown> | null) ?? {};
    return tx.payslip.create({
      data: {
        organizationId,
        payrollRunId: original.payrollRunId,
        employeeId: original.employeeId,
        grossPay: round2(grossPay),
        deductions: round2(deductions),
        netPay: round2(grossPay - deductions),
        payableDays: original.payableDays,
        paidDays: original.paidDays,
        revisionNumber: original.revisionNumber + 1,
        revisionOfId: original.id,
        revisionNote: reason,
        // A revision of a published payslip stays visible to the employee.
        publishedAt: original.publishedAt ? new Date() : null,
        calculationInputs: {
          ...inputs,
          revision: {
            of: original.id,
            reason,
            previous: { grossPay: original.grossPay, deductions: original.deductions, netPay: original.netPay },
            byUserId: req.user!.sub,
            at: new Date().toISOString(),
          },
        } as object,
      },
    });
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "payroll.payslip_revised",
    entityType: "Payslip",
    entityId: revision.id,
    before: { id: original.id, grossPay: original.grossPay, deductions: original.deductions, netPay: original.netPay },
    after: { grossPay: revision.grossPay, deductions: revision.deductions, netPay: revision.netPay, reason },
  });
  return res.status(201).json(revision);
});

export default router;
