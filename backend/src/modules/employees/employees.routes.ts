import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { createEmployeeWithUser } from "../../utils/createEmployee";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";
import { assertInOrg } from "../../utils/tenant";
import { writeAuditLog } from "../../utils/audit";
import { revokeAllForUser } from "../../utils/refreshTokens";
import { isEmailEnabled } from "../../utils/mailer";
import { sendPasswordResetEmail } from "../../utils/notifications";
import { createPasswordToken, HR_RESET_TTL_MS, INVITE_TTL_MS } from "../../utils/passwordTokens";
import { isExitEffective, revokeHrmsAccess } from "../../utils/employeeExit";
import { sendWelcomeEmail } from "../../utils/notifications";
import { startOfUtcDay } from "../../utils/date";

const router = Router();
router.use(requireAuth);

// Personal details are private: only the employee themselves and HR (employee:write) see them.
const PERSONAL_FIELDS = ["dateOfBirth", "personalEmail", "address", "emergencyContactName", "emergencyContactPhone"] as const;

function withoutPersonal<T extends object>(employee: T): T {
  const copy = { ...employee } as Record<string, unknown>;
  for (const field of PERSONAL_FIELDS) delete copy[field];
  return copy as T;
}

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();

// Employee Directory (People > Employee Directory)
router.get("/", requirePermission(PERMISSIONS.EMPLOYEE_READ), async (req, res) => {
  const { departmentId, search, status } = req.query as { departmentId?: string; search?: string; status?: string };

  // Directory filter (2.1.1): name, department and active/inactive.
  const statusFilter =
    status === "active"
      ? { status: { not: "EXITED" as const } }
      : status === "inactive"
        ? { status: "EXITED" as const }
        : {};

  const employees = await prisma.employee.findMany({
    where: {
      organizationId: req.user!.organizationId,
      ...statusFilter,
      ...(departmentId ? { departmentId } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { employeeCode: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { department: true, user: { select: { email: true } } },
    orderBy: { firstName: "asc" },
  });
  return res.json(employees.map(withoutPersonal));
});

// My Workspace > My Profile
router.get("/me", async (req, res) => {
  if (!req.user!.employeeId) {
    return res.status(404).json({ error: "No employee profile linked to this user" });
  }
  const employee = await prisma.employee.findFirst({
    where: { id: req.user!.employeeId, organizationId: req.user!.organizationId },
    include: { department: true, manager: true, user: { select: { email: true } } },
  });
  return res.json(employee);
});

router.get("/:id", async (req, res) => {
  const isSelf = req.params.id === req.user!.employeeId;
  if (!isSelf && !req.user!.permissions.includes(PERMISSIONS.EMPLOYEE_READ)) {
    return res.status(403).json({ error: `Missing permission: ${PERMISSIONS.EMPLOYEE_READ}` });
  }

  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    include: { department: true, manager: true, user: { select: { email: true } } },
  });
  if (!employee) {
    return res.status(404).json({ error: "Employee not found" });
  }
  const canSeePersonal = isSelf || req.user!.permissions.includes(PERMISSIONS.EMPLOYEE_WRITE);
  return res.json(canSeePersonal ? employee : withoutPersonal(employee));
});

// My Workspace > My Profile: employees keep their own contact and personal details up to date.
const selfUpdateSchema = z.object({
  phone: optionalText(50),
  personalEmail: z
    .union([z.literal(""), z.string().trim().email().max(254)])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  dateOfBirth: z
    .union([z.literal(""), z.coerce.date().refine((d) => d <= new Date(), "Date of birth can't be in the future")])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  address: optionalText(500),
  emergencyContactName: optionalText(200),
  emergencyContactPhone: optionalText(50),
});

router.patch("/me", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) {
    return res.status(404).json({ error: "No employee profile linked to this user" });
  }
  const parsed = selfUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const updated = await prisma.employee.update({
    where: { id: employeeId },
    data: parsed.data,
    include: { department: true, manager: true, user: { select: { email: true } } },
  });
  return res.json(updated);
});

// Exported so the AI assistant validates a proposed action with exactly these rules.
export const createSchema = z.object({
  email: z.string().trim().email().max(254),
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  designation: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  departmentId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  dateOfJoining: z.coerce.date().optional(),
});

// Onboarding: creates a User (with a temp password) + Employee record, assigns default Employee role.
router.post("/", requirePermission(PERMISSIONS.EMPLOYEE_WRITE), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const result = await createEmployeeWithUser(req.user!.organizationId, parsed.data);

  // Temp password returned once so HR can share it out-of-band; a real deployment would email it instead.
  return res.status(201).json({ employee: result.employee, tempPassword: result.tempPassword, inviteSent: result.inviteSent });
});

const updateSchema = z.object({
  firstName: z.string().trim().min(1).max(200).optional(),
  lastName: z.string().trim().min(1).max(200).optional(),
  designation: optionalText(200),
  phone: optionalText(50),
  dateOfJoining: z.coerce.date().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  status: z.enum(["ACTIVE", "ONBOARDING", "ON_LEAVE", "EXITED"]).optional(),
});

router.patch("/:id", requirePermission(PERMISSIONS.EMPLOYEE_WRITE), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!employee) {
    return res.status(404).json({ error: "Employee not found" });
  }

  const organizationId = req.user!.organizationId;
  await assertInOrg("department", parsed.data.departmentId, organizationId, "Department");
  if (parsed.data.managerId) {
    await assertInOrg("employee", parsed.data.managerId, organizationId, "Manager");
    await assertNoManagerCycle(employee.id, parsed.data.managerId, organizationId);
  }

  const updated = await prisma.employee.update({
    where: { id: employee.id },
    data: {
      ...parsed.data,
      ...(parsed.data.status === "EXITED" && !employee.exitDate ? { exitDate: new Date() } : {}),
    },
    include: { department: true, manager: true, user: { select: { email: true } } },
  });

  const changed = Object.keys(parsed.data) as (keyof typeof parsed.data)[];
  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "employee.update",
    entityType: "Employee",
    entityId: employee.id,
    before: Object.fromEntries(changed.map((k) => [k, employee[k]])),
    after: Object.fromEntries(changed.map((k) => [k, updated[k]])),
  });
  return res.json(updated);
});

// Rejects making an employee their own manager, directly or through the chain
// (walks up from the proposed manager; reaching the employee means a cycle).
async function assertNoManagerCycle(employeeId: string, managerId: string, organizationId: string) {
  if (managerId === employeeId) {
    throw new HttpError(400, "An employee can't be their own manager");
  }
  const seen = new Set<string>();
  let current: string | null = managerId;
  while (current && !seen.has(current)) {
    if (current === employeeId) {
      throw new HttpError(400, "This manager assignment would create a reporting cycle");
    }
    seen.add(current);
    const next: { managerId: string | null } | null = await prisma.employee.findFirst({
      where: { id: current, organizationId },
      select: { managerId: true },
    });
    current = next?.managerId ?? null;
  }
}

// HR/Admin resets a forgotten password. The old password stops working, the user is
// signed out everywhere and any lockout is cleared. With email configured they get a
// reset link (nothing is shown to HR); otherwise HR gets a one-time temporary password.
router.post("/:id/reset-password", requirePermission(PERMISSIONS.EMPLOYEE_WRITE), async (req, res) => {
  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    select: { id: true, userId: true, firstName: true, user: { select: { email: true } } },
  });
  if (!employee?.userId) throw new HttpError(404, "Employee not found");
  if (employee.userId === req.user!.sub) {
    throw new HttpError(400, "Use Settings → Security to change your own password");
  }

  const byEmail = isEmailEnabled();
  const tempPassword = crypto.randomBytes(byEmail ? 32 : 9).toString("base64url");
  await prisma.user.update({
    where: { id: employee.userId },
    data: {
      passwordHash: await bcrypt.hash(tempPassword, 12),
      mustChangePassword: !byEmail,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await revokeAllForUser(employee.userId);
  await writeAuditLog({
    organizationId: req.user!.organizationId,
    actorUserId: req.user!.sub,
    action: "user.password_reset",
    entityType: "Employee",
    entityId: employee.id,
  });

  if (byEmail) {
    const token = await createPasswordToken(employee.userId, "RESET", HR_RESET_TTL_MS);
    sendPasswordResetEmail({ to: employee.user.email, firstName: employee.firstName, token, requestedByHr: true });
    return res.json({ emailSent: true, email: employee.user.email });
  }
  return res.json({ tempPassword });
});

// ─── Employee exit (2.4) ───────────────────────────────────────────────────

const exitSchema = z.object({
  lastWorkingDate: z.coerce.date(),
  reason: z.string().trim().max(2000).optional(),
});

/**
 * Records an exit. History is always preserved: documents, attendance, salary
 * and payroll records are never deleted, so a final-period payslip can still be
 * produced from the approved payroll rules (2.4.3, Payroll rule 06).
 *
 * HRMS access is revoked at the effective date. Leaving this employer does not
 * delete the person's shared WorkEasy360 identity, and access to other
 * organizations is untouched — review those separately.
 */
router.post("/:id/exit", requirePermission(PERMISSIONS.EMPLOYEE_EXIT_MANAGE), async (req, res) => {
  const parsed = exitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, organizationId },
    select: { id: true, userId: true, exitDate: true, status: true, firstName: true, lastName: true },
  });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  if (employee.exitDate) return res.status(409).json({ error: "An exit has already been recorded for this employee" });
  if (employee.userId === req.user!.sub) {
    return res.status(400).json({ error: "You can't record your own exit. Ask another authorized admin." });
  }

  const exitDate = startOfUtcDay(parsed.data.lastWorkingDate);
  // The record is marked, but the status only flips to EXITED when access is
  // actually revoked, so a future-dated exit doesn't lock anyone out early.
  await prisma.employee.update({
    where: { id: employee.id },
    data: {
      exitDate,
      exitReason: parsed.data.reason,
      exitRecordedAt: new Date(),
      exitRecordedById: req.user!.employeeId,
    },
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "employee.exit_recorded",
    entityType: "Employee",
    entityId: employee.id,
    after: { exitDate: exitDate.toISOString().slice(0, 10), reason: parsed.data.reason ?? null },
  });

  // Effective today or earlier in the organization's own time zone: revoke now.
  // A future date is applied when it arrives, on the employee's next sign-in or
  // token refresh.
  const revokedNow = (await isExitEffective(organizationId, exitDate))
    ? await revokeHrmsAccess({
        organizationId,
        employeeId: employee.id,
        actorUserId: req.user!.sub,
        reason: "Exit recorded",
      })
    : false;

  return res.json({
    employee: await prisma.employee.findUniqueOrThrow({
      where: { id: employee.id },
      include: { department: true, manager: true, user: { select: { email: true } } },
    }),
    accessRevoked: revokedNow,
    note: revokedNow
      ? "HRMS access for this organization has been revoked. Their shared WorkEasy360 identity and other product access are unchanged — review those separately."
      : "The exit is recorded. HRMS access will be revoked on the effective date. Review other product access separately.",
    preserved: ["documents", "attendance", "leave", "salary history", "payslips"],
  });
});

/**
 * Login access (2.2.3). Sends a fresh set-your-password invitation to the
 * employee's existing account. It never creates a second login: the employee
 * record and the shared identity stay one-to-one.
 */
router.post("/:id/invite", requirePermission(PERMISSIONS.EMPLOYEE_WRITE), async (req, res) => {
  const organizationId = req.user!.organizationId;
  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, organizationId },
    select: {
      id: true,
      userId: true,
      firstName: true,
      user: { select: { email: true, disabledAt: true } },
      accessRevokedAt: true,
    },
  });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  if (employee.accessRevokedAt || employee.user.disabledAt) {
    return res.status(409).json({ error: "This employee's HRMS access has been revoked" });
  }
  if (!isEmailEnabled()) {
    return res.status(503).json({ error: "Email is not configured, so an invitation can't be sent" });
  }

  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const token = await createPasswordToken(employee.userId, "INVITE", INVITE_TTL_MS);
  sendWelcomeEmail({
    to: employee.user.email,
    firstName: employee.firstName,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    token,
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "employee.invite_sent",
    entityType: "Employee",
    entityId: employee.id,
  });
  return res.json({ inviteSent: true, email: employee.user.email });
});

export default router;
