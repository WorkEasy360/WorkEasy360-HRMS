import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";

const router = Router();
router.use(requireAuth);

// Reference data every employee needs when filing a leave request.
router.get("/", async (req, res) => {
  const leaveTypes = await prisma.leaveType.findMany({
    where: { organizationId: req.user!.organizationId },
    orderBy: { name: "asc" },
  });
  return res.json(leaveTypes);
});

/** The signed-in employee's own balance per leave type for this year (3.2.1). */
router.get("/me/balances", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");
  const year = new Date().getUTCFullYear();

  const [types, balances] = await Promise.all([
    prisma.leaveType.findMany({ where: { organizationId: req.user!.organizationId }, orderBy: { name: "asc" } }),
    prisma.leaveBalance.findMany({ where: { organizationId: req.user!.organizationId, employeeId, year } }),
  ]);
  const byType = new Map(balances.map((b) => [b.leaveTypeId, b]));

  return res.json(
    types.map((t) => {
      const b = byType.get(t.id);
      const allocated = b?.allocatedDays ?? t.defaultDaysPerYear;
      const used = b?.usedDays ?? 0;
      return {
        leaveTypeId: t.id,
        name: t.name,
        paid: t.paid,
        year,
        allocated,
        used,
        remaining: Math.round((allocated - used) * 100) / 100,
      };
    }),
  );
});

const writeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  defaultDaysPerYear: z.number().int().min(0).max(366).default(0),
  /** Unpaid leave reduces paid days in payroll (Payroll rule 07). */
  paid: z.boolean().default(true),
});

router.post("/", requirePermission(PERMISSIONS.LEAVE_MANAGE), async (req, res) => {
  const parsed = writeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.leaveType.findUnique({
    where: { organizationId_name: { organizationId: req.user!.organizationId, name: parsed.data.name } },
    select: { id: true },
  });
  if (existing) return res.status(409).json({ error: "A leave type with that name already exists" });

  const leaveType = await prisma.leaveType.create({
    data: { organizationId: req.user!.organizationId, ...parsed.data },
  });
  return res.status(201).json(leaveType);
});

router.patch("/:id", requirePermission(PERMISSIONS.LEAVE_MANAGE), async (req, res) => {
  const parsed = writeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "Nothing to update" });

  const leaveType = await prisma.leaveType.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    select: { id: true },
  });
  if (!leaveType) return res.status(404).json({ error: "Leave type not found" });

  const updated = await prisma.leaveType.update({ where: { id: leaveType.id }, data: parsed.data });
  return res.json(updated);
});

router.delete("/:id", requirePermission(PERMISSIONS.LEAVE_MANAGE), async (req, res) => {
  const leaveType = await prisma.leaveType.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    select: { id: true, _count: { select: { leaveRequests: true } } },
  });
  if (!leaveType) return res.status(404).json({ error: "Leave type not found" });
  // Deleting would take the history of every request with it.
  if (leaveType._count.leaveRequests > 0) {
    return res.status(409).json({ error: "This leave type has been used. Set its yearly days to 0 instead of deleting it." });
  }

  await prisma.leaveType.delete({ where: { id: leaveType.id } });
  return res.status(204).send();
});

export default router;
