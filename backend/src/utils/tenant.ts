import { Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "../config/prisma";
import { HttpError } from "./HttpError";
import { PermissionKey } from "./permissions";

type Db = Prisma.TransactionClient | typeof prisma;

// Tenant-scoped existence lookups for foreign ids that arrive in request bodies.
const finders = {
  employee: (db: Db, id: string, organizationId: string) =>
    db.employee.findFirst({ where: { id, organizationId }, select: { id: true } }),
  department: (db: Db, id: string, organizationId: string) =>
    db.department.findFirst({ where: { id, organizationId }, select: { id: true } }),
  leaveType: (db: Db, id: string, organizationId: string) =>
    db.leaveType.findFirst({ where: { id, organizationId }, select: { id: true } }),
  jobPosting: (db: Db, id: string, organizationId: string) =>
    db.jobPosting.findFirst({ where: { id, organizationId }, select: { id: true } }),
  candidate: (db: Db, id: string, organizationId: string) =>
    db.candidate.findFirst({ where: { id, organizationId }, select: { id: true } }),
  jobApplication: (db: Db, id: string, organizationId: string) =>
    db.jobApplication.findFirst({ where: { id, organizationId }, select: { id: true } }),
  payrollRun: (db: Db, id: string, organizationId: string) =>
    db.payrollRun.findFirst({ where: { id, organizationId }, select: { id: true } }),
  helpDeskTicket: (db: Db, id: string, organizationId: string) =>
    db.helpDeskTicket.findFirst({ where: { id, organizationId }, select: { id: true } }),
  integrationConnection: (db: Db, id: string, organizationId: string) =>
    db.integrationConnection.findFirst({ where: { id, organizationId }, select: { id: true } }),
  integrationMapping: (db: Db, id: string, organizationId: string) =>
    db.integrationMapping.findFirst({ where: { id, organizationId }, select: { id: true } }),
};

export type OrgModel = keyof typeof finders;

// Throws 400 "<label> not found" unless the id belongs to the given organization.
// null/undefined ids are ignored (optional or explicitly-cleared relations).
export async function assertInOrg(
  model: OrgModel,
  id: string | null | undefined,
  organizationId: string,
  label: string,
  db: Db = prisma,
): Promise<void> {
  if (id == null) return;
  const found = await finders[model](db, id, organizationId);
  if (!found) throw new HttpError(400, `${label} not found`);
}

// Authorization for approve/reject style decisions on an employee-owned record:
//  - nobody may decide their own record (even with the org-wide manage permission)
//  - holders of `managePermission` may decide anything else in the org
//  - otherwise only the owner's direct manager, and only while that manager is not EXITED
export async function assertCanDecide(
  req: Request,
  owner: { employeeId: string; managerId: string | null },
  managePermission: PermissionKey,
  deniedMessage: string,
  selfMessage = "You can't approve your own request",
): Promise<void> {
  const approverId = req.user!.employeeId;
  if (approverId && owner.employeeId === approverId) {
    throw new HttpError(403, selfMessage);
  }
  if (req.user!.permissions.includes(managePermission)) return;

  if (approverId && owner.managerId === approverId && (await isActiveEmployee(approverId, req.user!.organizationId))) {
    return;
  }
  throw new HttpError(403, deniedMessage);
}

export async function isActiveEmployee(employeeId: string, organizationId: string): Promise<boolean> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
    select: { status: true },
  });
  return !!employee && employee.status !== "EXITED";
}
