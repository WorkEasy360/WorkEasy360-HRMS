import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";
import { assertInOrg } from "../../utils/tenant";

const router = Router();
router.use(requireAuth);

router.get("/me", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const goals = await prisma.goal.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
  return res.json(goals);
});

router.get("/", requirePermission(PERMISSIONS.EMPLOYEE_READ), async (req, res) => {
  const { employeeId } = req.query as { employeeId?: string };
  const goals = await prisma.goal.findMany({
    where: { organizationId: req.user!.organizationId, ...(employeeId ? { employeeId } : {}) },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json(goals);
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  dueDate: z.coerce.date().optional(),
  cycleId: z.string().uuid().optional(),
});

router.post("/", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await assertInOrg("reviewCycle", parsed.data.cycleId, req.user!.organizationId, "Review cycle");

  const goal = await prisma.goal.create({
    data: { organizationId: req.user!.organizationId, employeeId, ...parsed.data },
  });
  return res.status(201).json(goal);
});

const updateSchema = z.object({
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  dueDate: z.coerce.date().optional(),
});

router.patch("/me/:id", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const goal = await prisma.goal.findFirst({ where: { id: req.params.id, employeeId } });
  if (!goal) return res.status(404).json({ error: "Goal not found" });

  const updated = await prisma.goal.update({ where: { id: goal.id }, data: parsed.data });
  return res.json(updated);
});

export default router;
