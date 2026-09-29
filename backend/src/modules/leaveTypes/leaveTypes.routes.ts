import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
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

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  defaultDaysPerYear: z.number().int().min(0).max(366).default(0),
});

router.post("/", requirePermission(PERMISSIONS.LEAVE_MANAGE), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const leaveType = await prisma.leaveType.create({
    data: { organizationId: req.user!.organizationId, ...parsed.data },
  });
  return res.status(201).json(leaveType);
});

export default router;
