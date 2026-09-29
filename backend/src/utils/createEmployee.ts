import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { HttpError } from "./HttpError";
import { runAutomations } from "./automations";
import { isEmailEnabled } from "./mailer";
import { sendWelcomeEmail } from "./notifications";
import { createPasswordToken, INVITE_TTL_MS } from "./passwordTokens";
import { assertInOrg } from "./tenant";

const DEFAULT_ONBOARDING_TASKS = [
  "Complete personal profile",
  "Submit ID documents",
  "IT / equipment setup",
  "Meet your manager",
];

export interface CreateEmployeeInput {
  email: string;
  firstName: string;
  lastName: string;
  designation?: string;
  phone?: string;
  departmentId?: string;
  managerId?: string;
  dateOfJoining?: Date;
}

// Shared by direct employee creation (People > Add employee) and hiring a
// candidate from Recruitment: creates a User + Employee, assigns the default
// Employee role, seeds onboarding tasks, and fires the EMPLOYEE_ONBOARDED
// automation trigger.
//
// Access: with email configured, the new user gets a "set your password" link and
// no password is ever shown to HR (`inviteSent: true`). Without email, a temporary
// password is returned for HR to hand over, and must be changed on first sign-in.
export async function createEmployeeWithUser(organizationId: string, input: CreateEmployeeInput) {
  // Relation ids come from request bodies — they must belong to this tenant.
  await assertInOrg("department", input.departmentId, organizationId, "Department");
  await assertInOrg("employee", input.managerId, organizationId, "Manager");

  const existing = await prisma.user.findUnique({
    where: { organizationId_email: { organizationId, email: input.email } },
  });
  if (existing) {
    throw new HttpError(409, "A user with this email already exists in the organization");
  }

  const employeeRole = await prisma.role.findUnique({
    where: { organizationId_name: { organizationId, name: "Employee" } },
  });
  if (!employeeRole) {
    throw new HttpError(500, "Default Employee role missing for organization");
  }

  const inviteByEmail = isEmailEnabled();
  // With an invite, the random password is never revealed, so it can't be used to sign in.
  const tempPassword = crypto.randomBytes(inviteByEmail ? 32 : 9).toString("base64url");
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const employeeCount = await prisma.employee.count({ where: { organizationId } });

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { organizationId, email: input.email, passwordHash, mustChangePassword: !inviteByEmail },
    });
    await tx.userRole.create({ data: { userId: user.id, roleId: employeeRole.id } });
    const employee = await tx.employee.create({
      data: {
        organizationId,
        userId: user.id,
        employeeCode: `EMP-${String(employeeCount + 1).padStart(4, "0")}`,
        firstName: input.firstName,
        lastName: input.lastName,
        designation: input.designation,
        phone: input.phone,
        departmentId: input.departmentId,
        managerId: input.managerId,
        dateOfJoining: input.dateOfJoining,
      },
    });
    await tx.onboardingTask.createMany({
      data: DEFAULT_ONBOARDING_TASKS.map((title) => ({
        organizationId,
        employeeId: employee.id,
        title,
      })),
    });
    return { user, employee };
  });

  await runAutomations("EMPLOYEE_ONBOARDED", { organizationId, employeeId: result.employee.id });

  if (inviteByEmail) {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const token = await createPasswordToken(result.user.id, "INVITE", INVITE_TTL_MS);
    sendWelcomeEmail({
      to: result.user.email,
      firstName: result.employee.firstName,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      token,
    });
    return { ...result, tempPassword: undefined, inviteSent: true };
  }
  return { ...result, tempPassword, inviteSent: false };
}
