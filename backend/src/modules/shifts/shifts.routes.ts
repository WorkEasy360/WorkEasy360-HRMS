import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";

const router = Router();
router.use(requireAuth);

// Reference data every employee can see (needed to understand their own shift).
router.get("/templates", async (req, res) => {
  const templates = await prisma.shiftTemplate.findMany({
    where: { organizationId: req.user!.organizationId },
    orderBy: { name: "asc" },
  });
  return res.json(templates);
});

const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
});

router.post("/templates", requirePermission(PERMISSIONS.SHIFT_MANAGE), async (req, res) => {
  const parsed = createTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const template = await prisma.shiftTemplate.create({
    data: { organizationId: req.user!.organizationId, ...parsed.data },
  });
  return res.status(201).json(template);
});

router.get("/me", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const assignment = await prisma.shiftAssignment.findUnique({
    where: { employeeId },
    include: { shiftTemplate: true },
  });
  return res.json(assignment);
});

router.get("/", requirePermission(PERMISSIONS.EMPLOYEE_READ), async (req, res) => {
  const assignments = await prisma.shiftAssignment.findMany({
    where: { organizationId: req.user!.organizationId },
    include: {
      shiftTemplate: true,
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return res.json(assignments);
});

const assignSchema = z.object({
  employeeId: z.string().uuid(),
  shiftTemplateId: z.string().uuid(),
  effectiveFrom: z.coerce.date(),
});

router.post("/assign", requirePermission(PERMISSIONS.SHIFT_MANAGE), async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const [employee, template] = await Promise.all([
    prisma.employee.findFirst({ where: { id: parsed.data.employeeId, organizationId } }),
    prisma.shiftTemplate.findFirst({ where: { id: parsed.data.shiftTemplateId, organizationId } }),
  ]);
  if (!employee || !template) return res.status(404).json({ error: "Employee or shift template not found" });

  const assignment = await prisma.shiftAssignment.upsert({
    where: { employeeId: employee.id },
    create: { organizationId, ...parsed.data },
    update: { shiftTemplateId: parsed.data.shiftTemplateId, effectiveFrom: parsed.data.effectiveFrom },
    include: { shiftTemplate: true },
  });
  return res.json(assignment);
});

export default router;
