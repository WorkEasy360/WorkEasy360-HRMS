import { prisma } from "../config/prisma";
import { HttpError } from "./HttpError";
import type { PermissionKey } from "./permissions";

/**
 * Approval routing for leave and attendance corrections
 * (Attendance & Leave rules 06, 07 and 08).
 *
 * Order: the assigned manager, if they hold the matching *approve* permission;
 * otherwise authorized HR, who hold the org-wide *manage* permission. Self-
 * approval is never allowed — the requester is dropped from the pool even when
 * they hold every permission. If that leaves nobody, the request stays pending
 * and carries a routing note, so the configuration problem is visible instead
 * of being silently swallowed.
 */
export type ApprovalPermissions = {
  /** Direct-report approval, held by assigned managers. */
  approve: PermissionKey;
  /** Org-wide approval, held by authorized HR. */
  manage: PermissionKey;
};

export type ApprovalRoute = {
  /** The routed manager, when there is a usable one. */
  managerId: string | null;
  /** Authorized HR who can act as fallback. */
  hrIds: string[];
  /** Everyone allowed to decide. Empty means nobody can yet. */
  approverIds: string[];
  /** Set only when the pool is empty: what an admin has to fix. */
  routingNote: string | null;
};

async function employeesWithPermission(organizationId: string, permission: PermissionKey): Promise<Set<string>> {
  const rows = await prisma.employee.findMany({
    where: {
      organizationId,
      status: { not: "EXITED" },
      user: {
        disabledAt: null,
        userRoles: { some: { role: { rolePermissions: { some: { permission: { key: permission } } } } } },
      },
    },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export async function resolveApprovalRoute(
  organizationId: string,
  requesterEmployeeId: string,
  permissions: ApprovalPermissions,
): Promise<ApprovalRoute> {
  const [requester, canApprove, canManage] = await Promise.all([
    prisma.employee.findFirst({
      where: { id: requesterEmployeeId, organizationId },
      select: {
        managerId: true,
        manager: { select: { id: true, status: true, user: { select: { disabledAt: true } } } },
      },
    }),
    employeesWithPermission(organizationId, permissions.approve),
    employeesWithPermission(organizationId, permissions.manage),
  ]);

  const manager = requester?.manager ?? null;
  const managerUsable =
    !!manager && manager.status !== "EXITED" && manager.user.disabledAt === null && manager.id !== requesterEmployeeId;

  // Rule 06: the assigned manager routes the request, but only with the
  // matching approval permission. HR (manage) also satisfies it.
  const managerId = managerUsable && (canApprove.has(manager.id) || canManage.has(manager.id)) ? manager.id : null;

  // Rule 08: never the requester, even if they are HR themselves.
  const hrIds = [...canManage].filter((id) => id !== requesterEmployeeId && id !== managerId);

  const approverIds = managerId ? [managerId, ...hrIds] : hrIds;
  if (approverIds.length > 0) return { managerId, hrIds, approverIds, routingNote: null };

  const note = !manager
    ? "No eligible approver: no manager is assigned to this employee and no authorized HR approver is configured."
    : managerUsable
      ? "No eligible approver: the assigned manager does not hold the approval permission and no authorized HR approver is configured."
      : "No eligible approver: the assigned manager no longer has access and no authorized HR approver is configured.";
  return { managerId: null, hrIds: [], approverIds: [], routingNote: note };
}

/**
 * Guard for approve/reject. Throws 403 rather than returning a flag, so a route
 * cannot forget to check the result.
 */
export async function assertCanDecideRequest(params: {
  organizationId: string;
  reviewerEmployeeId: string | null | undefined;
  requesterEmployeeId: string;
  permissions: ApprovalPermissions;
}): Promise<void> {
  const { organizationId, reviewerEmployeeId, requesterEmployeeId, permissions } = params;
  if (!reviewerEmployeeId) throw new HttpError(403, "Only an employee record can approve requests.");
  if (reviewerEmployeeId === requesterEmployeeId) {
    throw new HttpError(403, "You can't approve your own request. Ask another authorized approver.");
  }
  const route = await resolveApprovalRoute(organizationId, requesterEmployeeId, permissions);
  if (route.approverIds.includes(reviewerEmployeeId)) return;
  throw new HttpError(403, route.routingNote ?? "This request is routed to a different approver.");
}
