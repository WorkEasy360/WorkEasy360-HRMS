import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { writeAuditLog } from "../../utils/audit";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";

const router = Router();
router.use(requireAuth);

router.get("/me", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const records = await prisma.compensationRecord.findMany({
    where: { employeeId },
    orderBy: { effectiveFrom: "desc" },
  });
  return res.json(records);
});

router.get("/:employeeId", requirePermission(PERMISSIONS.COMPENSATION_MANAGE), async (req, res) => {
  const records = await prisma.compensationRecord.findMany({
    where: { employeeId: req.params.employeeId, organizationId: req.user!.organizationId },
    orderBy: { effectiveFrom: "desc" },
  });
  return res.json(records);
});

const createSchema = z.object({
  employeeId: z.string().uuid(),
  effectiveFrom: z.coerce.date(),
  annualCTC: z.number().finite().positive().max(1_000_000_000),
  currency: z.string().trim().min(1).max(10).default("INR"),
});

router.post("/", requirePermission(PERMISSIONS.COMPENSATION_MANAGE), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const employee = await prisma.employee.findFirst({ where: { id: parsed.data.employeeId, organizationId } });
  if (!employee) return res.status(404).json({ error: "Employee not found" });

  const record = await prisma.compensationRecord.create({
    data: {
      organizationId,
      employeeId: parsed.data.employeeId,
      effectiveFrom: parsed.data.effectiveFrom,
      annualCTC: parsed.data.annualCTC,
      monthlyGross: Math.round((parsed.data.annualCTC / 12) * 100) / 100,
      currency: parsed.data.currency,
    },
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "compensation.create",
    entityType: "CompensationRecord",
    entityId: record.id,
    after: { employeeId: record.employeeId, annualCTC: record.annualCTC, effectiveFrom: record.effectiveFrom },
  });

  return res.status(201).json(record);
});

export default router;
