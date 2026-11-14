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

const updateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).optional(),
});

/** Edit a role's explicit permissions (Settings 7.2.2). */
router.patch("/:id", requirePermission(PERMISSIONS.ROLE_MANAGE), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const role = await prisma.role.findFirst({
    where: { id: req.params.id, organizationId },
    include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
  });
  if (!role) return res.status(404).json({ error: "Role not found" });
  // Renaming a system role would break the defaults that look it up by name.
  if (role.isSystem && parsed.data.name && parsed.data.name !== role.name) {
    return res.status(409).json({ error: "A built-in role can't be renamed" });
  }

  const before = role.rolePermissions.map((rp) => rp.permission.key);

  if (parsed.data.permissions) {
    const wanted = [...new Set(parsed.data.permissions)];
    const permissions = await prisma.permission.findMany({ where: { key: { in: wanted } }, select: { id: true } });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })) }),
      ...(parsed.data.name ? [prisma.role.update({ where: { id: role.id }, data: { name: parsed.data.name } })] : []),
    ]);
  } else if (parsed.data.name) {
    await prisma.role.update({ where: { id: role.id }, data: { name: parsed.data.name } });
  }

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "role.update",
    entityType: "Role",
    entityId: role.id,
    before: { name: role.name, permissions: before },
    after: { name: parsed.data.name ?? role.name, permissions: parsed.data.permissions ?? before },
  });

  const updated = await prisma.role.findUniqueOrThrow({
    where: { id: role.id },
    include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
  });
  return res.json({
    id: updated.id,
    name: updated.name,
    isSystem: updated.isSystem,
    permissions: updated.rolePermissions.map((rp) => rp.permission.key),
  });
});

/**
 * Members and their roles (Settings 7.2.3). An employee record and a product
 * seat are separate things: a person only consumes a seat once they have a
 * login that can actually sign in.
 */
router.get("/members", requirePermission(PERMISSIONS.ROLE_MANAGE), async (req, res) => {
  const organizationId = req.user!.organizationId;
  const users = await prisma.user.findMany({
    where: { organizationId },
    select: {
      id: true,
      email: true,
      disabledAt: true,
      employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, status: true } },
      userRoles: { select: { role: { select: { id: true, name: true } } } },
    },
    orderBy: { email: "asc" },
  });

  const members = users.map((u) => ({
    userId: u.id,
    email: u.email,
    employeeId: u.employee?.id ?? null,
    name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u.email,
    employeeCode: u.employee?.employeeCode ?? null,
    employeeStatus: u.employee?.status ?? null,
    accessRevoked: !!u.disabledAt,
    roles: u.userRoles.map((ur) => ur.role),
    // Headcount is not a seat count: only an enabled login occupies one.
    occupiesSeat: !u.disabledAt,
  }));

  return res.json({
    members,
    seatsInUse: members.filter((m) => m.occupiesSeat).length,
    employeeRecords: members.filter((m) => m.employeeId).length,
    note: "Seats are counted from enabled logins, not from employee records. The plan and its seat allowance are managed in your shared WorkEasy360 account.",
  });
});

router.post("/unassign", requirePermission(PERMISSIONS.ROLE_MANAGE), async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const [user, role] = await Promise.all([
    prisma.user.findFirst({ where: { id: parsed.data.userId, organizationId }, select: { id: true } }),
    prisma.role.findFirst({ where: { id: parsed.data.roleId, organizationId }, select: { id: true, name: true } }),
  ]);
  if (!user || !role) return res.status(404).json({ error: "User or role not found in this organization" });

  // Never leave the organization without an administrator.
  if (role.name === "Admin") {
    const admins = await prisma.userRole.count({ where: { roleId: role.id } });
    if (admins <= 1) return res.status(409).json({ error: "This is the last Admin. Assign another one first." });
  }

  const { count } = await prisma.userRole.deleteMany({ where: { userId: user.id, roleId: role.id } });
  if (!count) return res.status(404).json({ error: "That role is not assigned to this user" });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "role.unassign",
    entityType: "User",
    entityId: user.id,
    before: { roleId: role.id, roleName: role.name },
  });
  return res.status(204).send();
});

export default router;
