import bcrypt from "bcryptjs";
import { Router } from "express";
import { generateSecret as generateTotpSecret, generateURI as generateTotpURI, verify as verifyTotp } from "otplib";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { HttpError } from "../../utils/HttpError";
import { loadUserContext } from "../../utils/loadUserContext";
import { signAccessToken, signMfaToken, verifyMfaToken } from "../../utils/jwt";
import { SYSTEM_ROLES } from "../../utils/permissions";
import { issueRefreshToken, revokeAllForUser, revokeRefreshToken, rotateRefreshToken } from "../../utils/refreshTokens";
import { isEmailEnabled } from "../../utils/mailer";
import { sendPasswordResetEmail } from "../../utils/notifications";
import { consumePasswordToken, createPasswordToken, findValidPasswordToken, RESET_TTL_MS } from "../../utils/passwordTokens";

const router = Router();

const DEFAULT_LEAVE_TYPES = [
  { name: "Casual Leave", defaultDaysPerYear: 12 },
  { name: "Sick Leave", defaultDaysPerYear: 8 },
  { name: "Earned Leave", defaultDaysPerYear: 15 },
];

export const BCRYPT_COST = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// Compared against when the account doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("workeasy-timing-equaliser", BCRYPT_COST);
const INVALID_CREDENTIALS = "Incorrect organization ID, email or password.";
const BAD_CODE = "That code didn't match. Check your authenticator app and try again.";

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters")
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/[0-9]/, "Include at least one number");

const totpCode = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");

type SignInCandidate = { lockedUntil: Date | null; employee?: { status: string } | null };

function assertCanSignIn(user: SignInCandidate) {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  if (user.employee?.status === "EXITED") {
    throw new HttpError(403, "This account has been deactivated. Contact your HR team.");
  }
}

async function recordFailedAttempt(userId: string) {
  const user = await prisma.user.update({ where: { id: userId }, data: { failedLoginCount: { increment: 1 } } });
  if (user.failedLoginCount >= MAX_FAILED_ATTEMPTS) {
    await prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) },
    });
  }
}

async function clearFailedAttempts(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } });
}

/** Issues a fresh access + refresh token pair for a fully authenticated user. */
async function issueSession(userId: string) {
  const { user, roles, permissions, employeeId } = await loadUserContext(userId);
  const accessToken = signAccessToken({ sub: user.id, organizationId: user.organizationId, employeeId, roles, permissions });
  const refreshToken = await issueRefreshToken(user.id);
  return { accessToken, refreshToken };
}

/** Accepts a TOTP code at most once: codes from an already-used time step are rejected. */
async function verifyTotpOnce(user: { id: string; totpSecret: string | null; lastTotpStep: number | null }, token: string) {
  if (!user.totpSecret) return false;
  const result = await verifyTotp({
    secret: user.totpSecret,
    token,
    epochTolerance: 30,
    ...(user.lastTotpStep != null ? { afterTimeStep: user.lastTotpStep } : {}),
  });
  if (!result.valid) return false;
  // "epoch" is the start (in seconds) of the 30s period the code matched.
  const timeStep = "timeStep" in result && typeof result.timeStep === "number" ? result.timeStep : Math.floor(Number((result as { epoch?: number }).epoch) / 30);
  await prisma.user.update({ where: { id: user.id }, data: { lastTotpStep: timeStep } });
  return true;
}

const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  organizationSlug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens only"),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
});

// Registers a new organization plus its first Admin user/employee in one transaction.
// Set ALLOW_PUBLIC_REGISTRATION=false once your organization exists, so nobody else can create one.
const registrationOpen = () => process.env.ALLOW_PUBLIC_REGISTRATION !== "false";

router.post("/register", async (req, res) => {
  if (!registrationOpen()) {
    return res.status(403).json({ error: "New organizations can't be created here. Ask your administrator for an account." });
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { organizationName, organizationSlug, firstName, lastName, email, password } = parsed.data;

  const existingSlug = await prisma.organization.findUnique({ where: { slug: organizationSlug } });
  if (existingSlug) {
    return res.status(409).json({ error: "That organization ID is already taken. Try another." });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: organizationName, slug: organizationSlug },
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
      data: { organizationId: organization.id, email, passwordHash },
    });

    await tx.userRole.create({
      data: { userId: user.id, roleId: roleMap.get("Admin")! },
    });

    const employee = await tx.employee.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        employeeCode: "EMP-0001",
        firstName,
        lastName,
        status: "ACTIVE",
        dateOfJoining: new Date(),
      },
    });

    await tx.leaveType.createMany({
      data: DEFAULT_LEAVE_TYPES.map((lt) => ({ organizationId: organization.id, ...lt })),
    });

    return { organization, user, employee };
  });

  const { accessToken, refreshToken } = await issueSession(result.user.id);

  return res.status(201).json({
    accessToken,
    refreshToken,
    organization: { id: result.organization.id, name: result.organization.name, slug: result.organization.slug },
  });
});

const loginSchema = z.object({
  organizationSlug: z.string().trim().toLowerCase().min(1).max(48),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { organizationSlug, email, password } = parsed.data;

  const organization = await prisma.organization.findUnique({ where: { slug: organizationSlug } });
  const user = organization
    ? await prisma.user.findUnique({
        where: { organizationId_email: { organizationId: organization.id, email } },
        include: { employee: { select: { status: true } } },
      })
    : null;

  // Always run bcrypt so unknown accounts take as long as wrong passwords.
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user) {
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }
  assertCanSignIn(user);
  if (!passwordOk) {
    await recordFailedAttempt(user.id);
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }

  if (user.totpEnabled) {
    return res.json({ mfaRequired: true, mfaToken: signMfaToken(user.id) });
  }

  await clearFailedAttempts(user.id);
  return res.json(await issueSession(user.id));
});

// Rotates the refresh token: the old one stops working and a new one is returned.
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: unknown };
  if (typeof refreshToken !== "string" || !refreshToken) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  const rotated = await rotateRefreshToken(refreshToken);
  const { user, roles, permissions, employeeId } = await loadUserContext(rotated.userId);
  if (user.employee?.status === "EXITED") {
    await revokeAllForUser(user.id);
    return res.status(401).json({ error: "This account has been deactivated." });
  }
  const accessToken = signAccessToken({ sub: user.id, organizationId: user.organizationId, employeeId, roles, permissions });
  return res.json({ accessToken, refreshToken: rotated.refreshToken });
});

router.post("/logout", async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: unknown };
  if (typeof refreshToken === "string" && refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  return res.status(204).end();
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

// Changes the password, signs out every other session, and returns fresh tokens for this one.
router.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: "Your current password is incorrect." });
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return res.status(400).json({ error: "Choose a password different from your current one." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST), mustChangePassword: false },
  });
  await revokeAllForUser(user.id);
  return res.json(await issueSession(user.id));
});

// Lets the sign-in page know whether self-service password reset is available.
router.get("/config", (_req, res) => {
  res.json({ emailEnabled: isEmailEnabled(), registrationEnabled: registrationOpen() });
});

const forgotSchema = z.object({
  organizationSlug: z.string().trim().toLowerCase().min(1).max(48),
  email: z.string().trim().toLowerCase().email().max(254),
});

// Always answers the same way, so it can't be used to discover which accounts exist.
router.post("/forgot-password", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!isEmailEnabled()) {
    return res.status(503).json({ error: "Password reset by email isn't available. Ask your HR admin to reset it." });
  }

  const user = await prisma.user.findFirst({
    where: { email: parsed.data.email, organization: { slug: parsed.data.organizationSlug } },
    include: { employee: { select: { firstName: true, status: true } } },
  });
  if (user && user.employee?.status !== "EXITED") {
    const token = await createPasswordToken(user.id, "RESET", RESET_TTL_MS);
    sendPasswordResetEmail({ to: user.email, firstName: user.employee?.firstName ?? "there", token, requestedByHr: false });
  }
  return res.json({ ok: true });
});

const tokenSchema = z.object({ token: z.string().min(20).max(200) });

// Checks a set/reset-password link before showing the form.
router.post("/password-token", async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "This link is invalid or has expired. Ask for a new one." });
  const row = await findValidPasswordToken(parsed.data.token);
  return res.json({
    purpose: row.purpose,
    email: row.user.email,
    organizationSlug: row.user.organization.slug,
    organizationName: row.user.organization.name,
  });
});

const resetSchema = z.object({ token: z.string().min(20).max(200), newPassword: passwordSchema });

// Sets a password from an emailed link (welcome invite or reset). The user then signs in
// normally, so two-factor authentication still applies.
router.post("/reset-password", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const row = await consumePasswordToken(parsed.data.token);
  await prisma.user.update({
    where: { id: row.userId },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST),
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await revokeAllForUser(row.userId);
  return res.json({ organizationSlug: row.user.organization.slug, email: row.user.email });
});

router.get("/me", requireAuth, async (req, res) => {
  const { user, roles, permissions } = await loadUserContext(req.user!.sub);
  return res.json({
    id: user.id,
    email: user.email,
    organizationId: user.organizationId,
    employee: user.employee,
    roles,
    permissions,
    totpEnabled: user.totpEnabled,
    mustChangePassword: user.mustChangePassword,
  });
});

router.post("/2fa/setup", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  // Re-running setup would silently replace a working authenticator; require turning it off first.
  if (user.totpEnabled) {
    return res.status(409).json({ error: "Two-factor authentication is already on. Turn it off first to set it up again." });
  }
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret, lastTotpStep: null } });

  const otpauthUrl = generateTotpURI({ issuer: "WorkEasy360 HRMS", label: user.email, secret });
  return res.json({ secret, otpauthUrl });
});

const verifySchema = z.object({ token: totpCode });

router.post("/2fa/verify", requireAuth, async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (user.totpEnabled) return res.status(409).json({ error: "Two-factor authentication is already on." });
  if (!user.totpSecret) return res.status(400).json({ error: "Start the setup first." });

  if (!(await verifyTotpOnce(user, parsed.data.token))) {
    return res.status(400).json({ error: BAD_CODE });
  }

  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  return res.json({ totpEnabled: true });
});

const disableSchema = z.object({ password: z.string().min(1).max(128), token: totpCode });

// Turning 2FA off needs both factors, so a stolen password alone can't remove it.
router.post("/2fa/disable", requireAuth, async (req, res) => {
  const parsed = disableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  if (user.totpEnabled && !(await verifyTotpOnce(user, parsed.data.token))) {
    return res.status(401).json({ error: BAD_CODE });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecret: null, lastTotpStep: null },
  });
  return res.json({ totpEnabled: false });
});

const loginVerifySchema = z.object({ mfaToken: z.string().min(1).max(2048), token: totpCode });

router.post("/2fa/login-verify", async (req, res) => {
  const parsed = loginVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let userId: string;
  try {
    userId = verifyMfaToken(parsed.data.mfaToken).sub;
  } catch {
    return res.status(401).json({ error: "Your sign-in attempt expired. Please sign in again." });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { employee: { select: { status: true } } },
  });
  assertCanSignIn(user);
  if (!(await verifyTotpOnce(user, parsed.data.token))) {
    await recordFailedAttempt(user.id);
    return res.status(401).json({ error: BAD_CODE });
  }

  await clearFailedAttempts(user.id);
  return res.json(await issueSession(user.id));
});

export default router;
