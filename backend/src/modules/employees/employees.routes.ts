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
import { createPasswordToken, HR_RESET_TTL_MS } from "../../utils/passwordTokens";

const router = Router();
router.use(requireAuth);

// Employee Directory (People > Employee Directory)
router.get("/", requirePermission(PERMISSIONS.EMPLOYEE_READ), async (req, res) => {
  const { departmentId, search } = req.query as { departmentId?: string; search?: string };

  const employees = await prisma.employee.findMany({
    where: {
      organizationId: req.user!.organizationId,
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
  return res.json(employees);
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
  return res.json(employee);
});

const createSchema = z.object({
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
  designation: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
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

export default router;
