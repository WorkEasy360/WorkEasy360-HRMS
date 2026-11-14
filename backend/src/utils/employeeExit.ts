import { prisma } from "../config/prisma";
import { writeAuditLog } from "./audit";
import { isAutomationEnabled } from "./automations";
import { revokeAllForUser } from "./refreshTokens";
import { getWorkSchedule, todayInOrgTimezone } from "./workSchedule";

/**
 * Employee exit (Employees 2.4, Internal automation rule 04).
 *
 * Leaving one employer revokes HRMS access for *this* organization only. The
 * person's shared WorkEasy360 identity and their access to other organizations
 * are untouched, and no history is deleted: documents, attendance, salary and
 * payroll records all stay, so an exited employee can still be paid for a
 * period they worked (Payroll rule 06).
 */

/**
 * Revokes HRMS access for one employee. Idempotent: calling it twice does not
 * produce a second audit entry or change anything the first call already did.
 */
export async function revokeHrmsAccess(params: {
  organizationId: string;
  employeeId: string;
  actorUserId?: string;
  reason: string;
}): Promise<boolean> {
  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, organizationId: params.organizationId },
    select: { id: true, userId: true, accessRevokedAt: true },
  });
  if (!employee || employee.accessRevokedAt) return false;

  const now = new Date();
  const { count } = await prisma.employee.updateMany({
    where: { id: employee.id, organizationId: params.organizationId, accessRevokedAt: null },
    data: { accessRevokedAt: now, status: "EXITED" },
  });
  if (!count) return false;

  // Only this product's login is disabled; the shared identity is not deleted.
  await prisma.user.update({ where: { id: employee.userId }, data: { disabledAt: now } });
  await revokeAllForUser(employee.userId);

  await writeAuditLog({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId ?? "",
    action: "employee.access_revoked",
    entityType: "Employee",
    entityId: employee.id,
    after: { reason: params.reason, at: now.toISOString() },
  });
  return true;
}

/**
 * Has the last working day passed, in the organization's own time zone?
 *
 * A date-only column is UTC midnight, so comparing it with `new Date()` is a
 * day out for any organization ahead of UTC: an exit effective today would not
 * take effect until the next UTC day.
 */
export async function isExitEffective(organizationId: string, exitDate: Date): Promise<boolean> {
  const schedule = await getWorkSchedule(organizationId);
  return exitDate <= todayInOrgTimezone(schedule);
}

/**
 * Applies a recorded exit whose effective date has arrived, at the moment the
 * person tries to use the product. There is no scheduler in the essential
 * release, so the check happens on sign-in and refresh.
 */
export async function enforceDueExit(userId: string): Promise<boolean> {
  const employee = await prisma.employee.findFirst({
    where: { userId, accessRevokedAt: null, exitDate: { not: null } },
    select: { id: true, organizationId: true, exitDate: true },
  });
  if (!employee?.exitDate) return false;
  if (!(await isExitEffective(employee.organizationId, employee.exitDate))) return false;
  if (!(await isAutomationEnabled(employee.organizationId, "exit_access_policy"))) return false;

  return revokeHrmsAccess({
    organizationId: employee.organizationId,
    employeeId: employee.id,
    reason: "Effective exit date reached",
  });
}
