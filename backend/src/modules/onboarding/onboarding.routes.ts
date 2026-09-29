import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";

const router = Router();
router.use(requireAuth);

router.get("/me", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const tasks = await prisma.onboardingTask.findMany({
    where: { employeeId },
    orderBy: { createdAt: "asc" },
  });
  return res.json(tasks);
});

router.patch("/me/:id", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const parsed = z.object({ done: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const task = await prisma.onboardingTask.findFirst({ where: { id: req.params.id, employeeId } });
  if (!task) return res.status(404).json({ error: "Onboarding task not found" });

  const updated = await prisma.onboardingTask.update({
    where: { id: task.id },
    data: { done: parsed.data.done },
  });
  return res.json(updated);
});

router.get("/", requirePermission(PERMISSIONS.ONBOARDING_MANAGE), async (req, res) => {
  const { employeeId } = req.query as { employeeId?: string };
  const tasks = await prisma.onboardingTask.findMany({
    where: { organizationId: req.user!.organizationId, ...(employeeId ? { employeeId } : {}) },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { createdAt: "asc" },
  });
  return res.json(tasks);
});

const createSchema = z.object({
  employeeId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  dueDate: z.coerce.date().optional(),
});

router.post("/", requirePermission(PERMISSIONS.ONBOARDING_MANAGE), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const employee = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, organizationId: req.user!.organizationId },
  });
  if (!employee) return res.status(404).json({ error: "Employee not found" });

  const task = await prisma.onboardingTask.create({
    data: { organizationId: req.user!.organizationId, ...parsed.data },
  });
  return res.status(201).json(task);
});

router.delete("/:id", requirePermission(PERMISSIONS.ONBOARDING_MANAGE), async (req, res) => {
  const task = await prisma.onboardingTask.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!task) return res.status(404).json({ error: "Onboarding task not found" });

  await prisma.onboardingTask.delete({ where: { id: task.id } });
  return res.status(204).send();
});

export default router;
