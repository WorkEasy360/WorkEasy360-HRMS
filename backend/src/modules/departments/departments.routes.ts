import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { PERMISSIONS } from "../../utils/permissions";
import { assertInOrg } from "../../utils/tenant";

const router = Router();
router.use(requireAuth);

router.get("/", requirePermission(PERMISSIONS.DEPARTMENT_READ), async (req, res) => {
  const departments = await prisma.department.findMany({
    where: { organizationId: req.user!.organizationId },
    orderBy: { name: "asc" },
  });
  return res.json(departments);
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: z.string().uuid().optional(),
});

router.post("/", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  await assertInOrg("department", parsed.data.parentId, req.user!.organizationId, "Parent department");

  const department = await prisma.department.create({
    data: { organizationId: req.user!.organizationId, ...parsed.data },
  });
  return res.status(201).json(department);
});

export default router;
