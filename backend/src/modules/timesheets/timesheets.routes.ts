import { Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { runAutomations } from "../../utils/automations";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";
import { latestCurrentDate, monthRange, startOfUtcDay } from "../../utils/date";
import { assertCanDecide } from "../../utils/tenant";

const router = Router();
router.use(requireAuth);

function requireSelfEmployee(req: Request): string {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");
  return employeeId;
}

router.get("/me", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const { month } = req.query as { month?: string };

  const entries = await prisma.timesheetEntry.findMany({
    where: { employeeId, ...(month ? monthRange(month) : {}) },
    orderBy: { date: "desc" },
  });
  return res.json(entries);
});

router.get("/pending-approvals", async (req, res) => {
  const organizationId = req.user!.organizationId;
  const canManageAll = req.user!.permissions.includes(PERMISSIONS.TIMESHEET_MANAGE);

  const entries = await prisma.timesheetEntry.findMany({
    where: {
      organizationId,
      status: "PENDING",
      ...(canManageAll ? {} : { employee: { managerId: req.user!.employeeId ?? "__none__" } }),
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { date: "asc" },
  });
  return res.json(entries);
});

router.get("/", requirePermission(PERMISSIONS.EMPLOYEE_READ), async (req, res) => {
  const { employeeId, month } = req.query as { employeeId?: string; month?: string };
  const entries = await prisma.timesheetEntry.findMany({
    where: {
      organizationId: req.user!.organizationId,
      ...(employeeId ? { employeeId } : {}),
      ...(month ? monthRange(month) : {}),
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { date: "desc" },
  });
  return res.json(entries);
});

const upsertSchema = z.object({
  date: z.coerce
    .date()
    .transform(startOfUtcDay)
    .refine((d) => d.getTime() <= latestCurrentDate().getTime(), { message: "Timesheet date can't be in the future" }),
  hours: z.number().finite().positive().max(24),
  task: z.string().trim().max(5000).optional(),
});

router.post("/", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.timesheetEntry.findUnique({
    where: { employeeId_date: { employeeId, date: parsed.data.date } },
  });
  if (existing?.status === "APPROVED") {
    return res.status(409).json({ error: "This day's timesheet has already been approved" });
  }

  const entry = await prisma.timesheetEntry.upsert({
    where: { employeeId_date: { employeeId, date: parsed.data.date } },
    create: { organizationId: req.user!.organizationId, employeeId, ...parsed.data },
    update: { hours: parsed.data.hours, task: parsed.data.task, status: "PENDING", approverId: null, decidedAt: null },
  });
  return res.status(existing ? 200 : 201).json(entry);
});

const decisionSchema = z.object({});

async function decide(req: Request, res: Response, approve: boolean) {
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const entry = await prisma.timesheetEntry.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    include: { employee: true },
  });
  if (!entry) return res.status(404).json({ error: "Timesheet entry not found" });
  if (entry.status !== "PENDING") {
    return res.status(409).json({ error: "Entry has already been decided" });
  }

  await assertCanDecide(
    req,
    { employeeId: entry.employeeId, managerId: entry.employee.managerId },
    PERMISSIONS.TIMESHEET_MANAGE,
    "Not authorized to decide this entry",
  );

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.timesheetEntry.updateMany({
      where: { id: entry.id, organizationId: req.user!.organizationId, status: "PENDING" },
      data: { status: approve ? "APPROVED" : "REJECTED", approverId: req.user!.employeeId, decidedAt: new Date() },
    });
    if (!count) throw new HttpError(409, "Entry has already been decided");
    return tx.timesheetEntry.findUniqueOrThrow({ where: { id: entry.id } });
  });

  if (approve) {
    await runAutomations("TIMESHEET_APPROVED", { organizationId: req.user!.organizationId, employeeId: updated.employeeId });
  }

  return res.json(updated);
}

router.post("/:id/approve", (req, res) => decide(req, res, true));
router.post("/:id/reject", (req, res) => decide(req, res, false));

export default router;
