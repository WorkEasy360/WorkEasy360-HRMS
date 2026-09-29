import { prisma } from "../config/prisma";

// Runs on every sign-in, token refresh and /auth/me. The database can be ~150 ms away,
// and a nested include costs one sequential round trip per level (user → roles →
// permissions ≈ 6). Three independent queries in parallel cost about two.
export async function loadUserContext(userId: string) {
  const [user, roles, permissions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { employee: true } }),
    prisma.role.findMany({ where: { userRoles: { some: { userId } } }, select: { name: true } }),
    prisma.permission.findMany({
      where: { rolePermissions: { some: { role: { userRoles: { some: { userId } } } } } },
      select: { key: true },
    }),
  ]);

  return {
    user,
    roles: roles.map((r) => r.name),
    permissions: permissions.map((p) => p.key),
    employeeId: user.employee?.id ?? null,
  };
}
