import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { writeAuditLog } from "../../utils/audit";
import { ALL_PERMISSIONS, PERMISSIONS } from "../../utils/permissions";

const router = Router();
router.use(requireAuth);

router.get("/", requirePermission(PERMISSIONS.ROLE_MANAGE), async (req, res) => {
  const roles = await prisma.role.findMany({
    where: { organizationId: req.user!.organizationId },
    include: { rolePermissions: { include: { permission: true } } },
    orderBy: { name: "asc" },
  });
  return res.json(
    roles.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: r.isSystem,
      permissions: r.rolePermissions.map((rp) => rp.permission.key),
    })),
  );
});

router.get("/permissions", requirePermission(PERMISSIONS.ROLE_MANAGE), async (_req, res) => {
  return res.json(ALL_PERMISSIONS);
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(200),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
});

router.post("/", requirePermission(PERMISSIONS.ROLE_MANAGE), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const organizationId = req.user!.organizationId;

  const permissions = await prisma.permission.findMany({
    where: { key: { in: parsed.data.permissions } },
  });

  const role = await prisma.role.create({
    data: {
      organizationId,
      name: parsed.data.name,
      rolePermissions: { createMany: { data: permissions.map((p) => ({ permissionId: p.id })) } },
    },
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "role.create",
    entityType: "Role",
    entityId: role.id,
    after: { name: role.name, permissions: parsed.data.permissions },
  });

  return res.status(201).json(role);
});

const assignSchema = z.object({ userId: z.string().uuid(), roleId: z.string().uuid() });

router.post("/assign", requirePermission(PERMISSIONS.ROLE_MANAGE), async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const organizationId = req.user!.organizationId;

  const [user, role] = await Promise.all([
    prisma.user.findFirst({ where: { id: parsed.data.userId, organizationId } }),
    prisma.role.findFirst({ where: { id: parsed.data.roleId, organizationId } }),
  ]);
  if (!user || !role) {
    return res.status(404).json({ error: "User or role not found in this organization" });
  }

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "role.assign",
    entityType: "User",
    entityId: user.id,
    after: { roleId: role.id, roleName: role.name },
  });

  return res.status(204).send();
});

export default router;
