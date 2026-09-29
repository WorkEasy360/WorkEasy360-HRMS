import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { writeAuditLog } from "../../utils/audit";
import { PERMISSIONS } from "../../utils/permissions";

const router = Router();
router.use(requireAuth);

router.get("/current", async (req, res) => {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: req.user!.organizationId },
  });
  return res.json(organization);
});

const updateSchema = z.object({ name: z.string().trim().min(2).max(200) });

router.patch("/current", requirePermission(PERMISSIONS.ORG_MANAGE), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const before = await prisma.organization.findUniqueOrThrow({ where: { id: req.user!.organizationId } });
  const organization = await prisma.organization.update({
    where: { id: req.user!.organizationId },
    data: { name: parsed.data.name },
  });

  await writeAuditLog({
    organizationId: organization.id,
    actorUserId: req.user!.sub,
    action: "organization.update",
    entityType: "Organization",
    entityId: organization.id,
    before: { name: before.name },
    after: { name: organization.name },
  });

  return res.json(organization);
});

export default router;
