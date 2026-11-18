import { Prisma } from "@prisma/client";
import { SYSTEM_ROLES } from "./permissions";

export const DEFAULT_LEAVE_TYPES = [
  { name: "Casual Leave", defaultDaysPerYear: 12 },
  { name: "Sick Leave", defaultDaysPerYear: 8 },
  { name: "Earned Leave", defaultDaysPerYear: 15 },
];

export interface NewOrganization {
  organizationName: string;
  organizationSlug: string;
  /** Bound to this WorkEasy360 organization from the start (a WorkEasy360 sign-in created it). */
  workeasy360OrganizationId?: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Null: the first admin signs in with WorkEasy360 only. */
  passwordHash: string | null;
  /** Linked to this WorkEasy360 identity from the start. */
  externalIdentity?: { issuer: string; subject: string };
}

/**
 * Creates an organization with its system roles, its first Admin user and employee, and the
 * default leave types. One transaction, used by self-service registration and by the first
 * WorkEasy360 sign-in of an organization, so both produce the same company.
 */
export async function createOrganizationWithAdmin(tx: Prisma.TransactionClient, input: NewOrganization) {
  const organization = await tx.organization.create({
    data: {
      name: input.organizationName,
      slug: input.organizationSlug,
      ...(input.workeasy360OrganizationId ? { workeasy360OrganizationId: input.workeasy360OrganizationId } : {}),
    },
  });

  const roleMap = new Map<string, string>();
  for (const [roleName, permissionKeys] of Object.entries(SYSTEM_ROLES)) {
    const role = await tx.role.create({
      data: { organizationId: organization.id, name: roleName, isSystem: true },
    });
    roleMap.set(roleName, role.id);

    const permissions = await tx.permission.findMany({ where: { key: { in: permissionKeys } } });
    await tx.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }

  const user = await tx.user.create({
    data: { organizationId: organization.id, email: input.email, passwordHash: input.passwordHash },
  });

  await tx.userRole.create({
    data: { userId: user.id, roleId: roleMap.get("Admin")! },
  });

  const employee = await tx.employee.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      employeeCode: "EMP-0001",
      firstName: input.firstName,
      lastName: input.lastName,
      status: "ACTIVE",
      dateOfJoining: new Date(),
    },
  });

  await tx.leaveType.createMany({
    data: DEFAULT_LEAVE_TYPES.map((lt) => ({ organizationId: organization.id, ...lt })),
  });

  if (input.externalIdentity) {
    await tx.externalIdentity.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        issuer: input.externalIdentity.issuer,
        subject: input.externalIdentity.subject,
        email: input.email,
        lastLoginAt: new Date(),
      },
    });
  }

  return { organization, user, employee };
}
