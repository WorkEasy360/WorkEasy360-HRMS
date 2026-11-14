import { prisma } from "../../config/prisma";
import { AssistantContext } from "../../ai/capabilities";
import { resolveApprovalRoute, type ApprovalPermissions } from "../../utils/approvals";
import { PERMISSIONS, PermissionKey } from "../../utils/permissions";
import { countWorkingDays, getWorkSchedule, todayInOrgTimezone } from "../../utils/workSchedule";
import { createSchema as leaveCreateSchema } from "../leaveRequests/leaveRequests.routes";
import { correctionSchema } from "../attendance/attendance.routes";
import { createSchema as ticketCreateSchema } from "../helpdesk/helpdesk.routes";
import { createSchema as announcementCreateSchema } from "../announcements/announcements.routes";
import { createSchema as employeeCreateSchema } from "../employees/employees.routes";
import { createPostingSchema, updateApplicationSchema } from "../recruitment/recruitment.routes";

/**
 * Turning a model's suggestion into a card the member can confirm.
 *
 * Nothing here writes. Each action is checked with the same validation schema
 * and the same rules as the endpoint that will eventually run it, so the card
 * never offers something the server would refuse — and if the world changes
 * between the card and the button, the endpoint refuses it anyway.
 *
 * The assistant can never approve its own proposal, finalize payroll, change
 * salary or export a private file: those actions simply do not exist here.
 */

export interface Proposal {
  kind: string;
  title: string;
  /** Label/value rows: the facts that were checked. */
  summary: [string, string][];
  /** One sentence, present tense, saying what pressing the button does. */
  effect: string;
  confirmLabel: string;
  /** Cancels, rejections and anything that emails someone get the red button. */
  danger: boolean;
  request: { method: "POST" | "PATCH"; path: string; body: Record<string, unknown> };
  done?: { label: string; path: string };
}

export type VerifyResult = { ok: true; proposal: Proposal } | { ok: false; reason: string };

const refuse = (reason: string): VerifyResult => ({ ok: false, reason });

/* ------------------------------------------------------------ arg parsing */

type Args = Record<string, unknown>;

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
}

function id(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}

function date(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function datetime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export const ACTION_KINDS = [
  "apply_leave",
  "cancel_leave",
  "check_in",
  "check_out",
  "request_attendance_correction",
  "raise_ticket",
  "complete_onboarding_task",
  "decide_leave",
  "decide_correction",
  "publish_announcement",
  "create_job_posting",
  "move_application",
  "create_employee",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export interface ParsedAction {
  kind: ActionKind;
  args: Args;
}

/**
 * Accept only a well-formed action. Unknown kinds and stray keys are dropped
 * here, before anything touches the database.
 */
export function parseAction(raw: unknown): ParsedAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Args;
  const kind = typeof obj.kind === "string" ? obj.kind.trim() : "";
  if (!(ACTION_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as ActionKind, args: obj };
}

/* -------------------------------------------------------- shared checks */

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;

const LEAVE_PERMISSIONS: ApprovalPermissions = {
  approve: PERMISSIONS.LEAVE_APPROVE,
  manage: PERMISSIONS.LEAVE_MANAGE,
};
const CORRECTION_PERMISSIONS: ApprovalPermissions = {
  approve: PERMISSIONS.ATTENDANCE_APPROVE,
  manage: PERMISSIONS.ATTENDANCE_MANAGE,
};

/**
 * Mirrors the routing the endpoint will apply: the assigned manager holding the
 * approval permission, or authorized HR as fallback, and never the requester
 * themselves. Returns a refusal message, or null when the member may decide.
 */
async function canDecide(
  ctx: AssistantContext,
  requesterEmployeeId: string,
  permissions: ApprovalPermissions,
): Promise<string | null> {
  if (!ctx.employeeId) return "You don't have an employee profile, so you can't decide requests.";
  if (requesterEmployeeId === ctx.employeeId) return "You can't approve your own request.";
  const route = await resolveApprovalRoute(ctx.organizationId, requesterEmployeeId, permissions);
  if (route.approverIds.includes(ctx.employeeId)) return null;
  return route.routingNote ?? "That request isn't waiting on you to decide.";
}

function needsEmployee(ctx: AssistantContext): string | null {
  return ctx.employeeId ? null : "You don't have an employee profile yet, so I can't do that for you.";
}

function needsPermission(ctx: AssistantContext, permission: PermissionKey, what: string): string | null {
  return ctx.permissions.includes(permission) ? null : `Your role can't ${what}.`;
}

/** Runs the endpoint's own schema; its message becomes the refusal. */
function check<T>(
  schema: {
    safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
  },
  value: unknown,
): { ok: true; data: T } | { ok: false; reason: string } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, reason: parsed.error.issues[0]?.message ?? "Those details aren't valid." };
}

/* ---------------------------------------------------------------- verify */

export async function verifyAction(action: ParsedAction, ctx: AssistantContext): Promise<VerifyResult> {
  const { kind, args } = action;
  const org = ctx.organizationId;

  switch (kind) {
    /* ------------------------------------------------------ self-service */
    case "apply_leave": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);

      const parsed = check(leaveCreateSchema, {
        leaveTypeId: args.leaveTypeId,
        startDate: date(args.startDate),
        endDate: date(args.endDate),
        reason: str(args.reason, 5000),
      });
      if (!parsed.ok) return refuse(parsed.reason);

      const [leaveType, schedule] = await Promise.all([
        prisma.leaveType.findFirst({ where: { id: parsed.data.leaveTypeId, organizationId: org } }),
        getWorkSchedule(org, { from: parsed.data.startDate, to: parsed.data.endDate }),
      ]);
      if (!leaveType) return refuse("I couldn't find that leave type in this company.");

      // Working days only, exactly as the endpoint counts them.
      const days = countWorkingDays(parsed.data.startDate, parsed.data.endDate, schedule);
      if (days === 0) return refuse("That range has no working days in this company's schedule.");

      const overlapping = await prisma.leaveRequest.findFirst({
        where: {
          employeeId: ctx.employeeId!,
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { lte: parsed.data.endDate },
          endDate: { gte: parsed.data.startDate },
        },
        select: { id: true },
      });
      if (overlapping) return refuse("You already have leave booked in that period.");

      const balance = await prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: ctx.employeeId!,
            leaveTypeId: leaveType.id,
            year: parsed.data.startDate.getFullYear(),
          },
        },
      });
      if (balance && leaveType.defaultDaysPerYear > 0 && balance.allocatedDays - balance.usedDays < days) {
        return refuse(
          `You only have ${balance.allocatedDays - balance.usedDays} day(s) of ${leaveType.name} left, and this needs ${days}.`,
        );
      }

      // Say where it will land, including when nothing is configured yet.
      const route = await resolveApprovalRoute(org, ctx.employeeId!, LEAVE_PERMISSIONS);

      return {
        ok: true,
        proposal: {
          kind,
          title: `Request ${days} day${days === 1 ? "" : "s"} of ${leaveType.name}`,
          summary: [
            ["Leave type", leaveType.name],
            ["From", date(args.startDate)!],
            ["To", date(args.endDate)!],
            ["Working days", String(days)],
            ...(leaveType.paid ? [] : ([["Paid", "No — unpaid leave reduces paid days in payroll"]] as [string, string][])),
            ...(parsed.data.reason ? ([["Reason", parsed.data.reason]] as [string, string][]) : []),
          ],
          effect: route.routingNote
            ? "Records the request. It stays pending until an approver is configured."
            : "Sends the request to your approver for a decision.",
          confirmLabel: "Send request",
          danger: false,
          request: {
            method: "POST",
            path: "/leave-requests",
            body: {
              leaveTypeId: leaveType.id,
              startDate: date(args.startDate),
              endDate: date(args.endDate),
              ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
            },
          },
          done: { label: "Attendance & Leave", path: "/attendance?tab=leave" },
        },
      };
    }

    case "cancel_leave": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);
      const requestId = id(args.leaveRequestId);
      if (!requestId) return refuse("I need the leave request to cancel.");

      const request = await prisma.leaveRequest.findFirst({
        where: { id: requestId, organizationId: org, employeeId: ctx.employeeId! },
        include: { leaveType: true },
      });
      if (!request) return refuse("I couldn't find that leave request among yours.");
      if (request.status !== "PENDING" && request.status !== "APPROVED") {
        return refuse("Only a pending or approved request can be cancelled.");
      }
      if (request.status === "APPROVED" && request.endDate < new Date()) {
        return refuse("That leave has already been taken, so it can't be cancelled. Ask HR for a correction.");
      }

      const wasApproved = request.status === "APPROVED";
      return {
        ok: true,
        proposal: {
          kind,
          title: `Cancel ${request.leaveType.name} leave`,
          summary: [
            ["Leave type", request.leaveType.name],
            ["From", request.startDate.toISOString().slice(0, 10)],
            ["To", request.endDate.toISOString().slice(0, 10)],
            ["Days", String(request.days)],
            ["Status", request.status],
          ],
          effect: wasApproved
            ? "Cancels the approved leave and gives the days back to your balance."
            : "Withdraws the request so nobody needs to decide it.",
          confirmLabel: "Cancel request",
          danger: true,
          request: { method: "POST", path: `/leave-requests/${request.id}/cancel`, body: {} },
          done: { label: "Attendance & Leave", path: "/attendance?tab=leave" },
        },
      };
    }

    case "check_in":
    case "check_out": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);

      // The working day is the organization's calendar day, not the server's.
      const schedule = await getWorkSchedule(org);
      const day = todayInOrgTimezone(schedule);
      const record = await prisma.attendanceRecord.findFirst({
        where: { organizationId: org, employeeId: ctx.employeeId!, date: day },
      });

      if (kind === "check_in" && record?.checkInAt) return refuse("You're already checked in for today.");
      if (kind === "check_out") {
        if (!record?.checkInAt) return refuse("You haven't checked in today yet.");
        if (record.checkOutAt) return refuse("You've already checked out for today.");
      }

      return {
        ok: true,
        proposal: {
          kind,
          title: kind === "check_in" ? "Check in for today" : "Check out for today",
          summary: [
            ["Date", ctx.today],
            ...(kind === "check_out" && record?.checkInAt
              ? ([["Checked in at", record.checkInAt.toISOString()]] as [string, string][])
              : []),
          ],
          effect: kind === "check_in" ? "Records your start time for today." : "Records your end time for today.",
          confirmLabel: kind === "check_in" ? "Check in" : "Check out",
          danger: false,
          request: { method: "POST", path: `/attendance/${kind === "check_in" ? "check-in" : "check-out"}`, body: {} },
          done: { label: "Attendance & Leave", path: "/attendance" },
        },
      };
    }

    case "request_attendance_correction": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);

      const parsed = check(correctionSchema, {
        date: date(args.date),
        requestedCheckInAt: datetime(args.requestedCheckInAt),
        requestedCheckOutAt: datetime(args.requestedCheckOutAt),
        reason: str(args.reason, 5000),
      });
      if (!parsed.ok) return refuse(parsed.reason);

      const schedule = await getWorkSchedule(org);
      if (parsed.data.date > todayInOrgTimezone(schedule)) {
        return refuse("You can only correct a day that has already happened.");
      }

      const pending = await prisma.attendanceCorrectionRequest.findFirst({
        where: { employeeId: ctx.employeeId!, date: parsed.data.date, status: "PENDING" },
        select: { id: true },
      });
      if (pending) return refuse("You already have a pending correction for that day.");

      const route = await resolveApprovalRoute(org, ctx.employeeId!, CORRECTION_PERMISSIONS);
      return {
        ok: true,
        proposal: {
          kind,
          title: `Correct attendance for ${date(args.date)}`,
          summary: [
            ["Date", date(args.date)!],
            ...(parsed.data.requestedCheckInAt
              ? ([["Check in", parsed.data.requestedCheckInAt.toISOString()]] as [string, string][])
              : []),
            ...(parsed.data.requestedCheckOutAt
              ? ([["Check out", parsed.data.requestedCheckOutAt.toISOString()]] as [string, string][])
              : []),
            ["Reason", parsed.data.reason],
          ],
          effect: route.routingNote
            ? "Records the request. It stays pending until an approver is configured."
            : "Sends the correction to your approver. The day only changes once they approve it.",
          confirmLabel: "Send request",
          danger: false,
          request: {
            method: "POST",
            path: "/attendance/corrections",
            body: {
              date: date(args.date),
              ...(parsed.data.requestedCheckInAt ? { requestedCheckInAt: datetime(args.requestedCheckInAt) } : {}),
              ...(parsed.data.requestedCheckOutAt ? { requestedCheckOutAt: datetime(args.requestedCheckOutAt) } : {}),
              reason: parsed.data.reason,
            },
          },
          done: { label: "Attendance & Leave", path: "/attendance?tab=corrections" },
        },
      };
    }

    case "raise_ticket": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);
      const parsed = check(ticketCreateSchema, {
        type: args.type,
        aboutPayroll: bool(args.aboutPayroll),
        subject: args.subject,
        description: args.description,
      });
      if (!parsed.ok) return refuse(parsed.reason);

      // Routing 01 and 02, shown so the member knows who will read it.
      const queue =
        parsed.data.type === "PRODUCT_PROBLEM"
          ? "WorkEasy360 product support"
          : parsed.data.aboutPayroll
            ? "your employer's payroll team"
            : "your employer's HR team";

      return {
        ok: true,
        proposal: {
          kind,
          title: "Raise a help desk ticket",
          summary: [
            ["Type", parsed.data.type === "PRODUCT_PROBLEM" ? "Product problem" : "HR question"],
            ["Goes to", queue],
            ["Subject", parsed.data.subject],
            ["Details", parsed.data.description.slice(0, 300)],
          ],
          effect: `Opens a ticket for ${queue} to pick up, and shows you its ticket number.`,
          confirmLabel: "Raise ticket",
          danger: false,
          request: {
            method: "POST",
            path: "/helpdesk",
            body: {
              type: parsed.data.type,
              ...(parsed.data.aboutPayroll ? { aboutPayroll: true } : {}),
              subject: parsed.data.subject,
              description: parsed.data.description,
            },
          },
          done: { label: "Helpdesk", path: "/helpdesk" },
        },
      };
    }

    case "complete_onboarding_task": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);
      const taskId = id(args.taskId);
      if (!taskId) return refuse("I need to know which task.");
      const done = bool(args.done) ?? true;

      const task = await prisma.onboardingTask.findFirst({
        where: { id: taskId, organizationId: org, employeeId: ctx.employeeId! },
      });
      if (!task) return refuse("I couldn't find that task among yours.");
      if (task.done === done) return refuse(done ? "That task is already done." : "That task is already open.");

      return {
        ok: true,
        proposal: {
          kind,
          title: done ? `Mark "${task.title}" done` : `Reopen "${task.title}"`,
          summary: [
            ["Task", task.title],
            ...(task.requiresVerification
              ? ([["Note", "HR still has to check this one before it counts as complete"]] as [string, string][])
              : []),
          ],
          effect: done ? "Ticks the task off your joining checklist." : "Puts the task back on your checklist.",
          confirmLabel: done ? "Mark done" : "Reopen",
          danger: false,
          request: { method: "PATCH", path: `/onboarding/me/${task.id}`, body: { done } },
          done: { label: "My Details", path: "/my-details" },
        },
      };
    }

    /* ---------------------------------------------------------- approvals */
    case "decide_leave": {
      const requestId = id(args.leaveRequestId);
      const approve = bool(args.approve);
      if (!requestId || approve === undefined) {
        return refuse("I need to know which request, and whether to approve or reject it.");
      }
      const note = str(args.decisionNote, 5000);

      const request = await prisma.leaveRequest.findFirst({
        where: { id: requestId, organizationId: org },
        include: { employee: true, leaveType: true },
      });
      if (!request) return refuse("I couldn't find that leave request.");
      if (request.status !== "PENDING") return refuse("That request has already been decided.");

      const denied = await canDecide(ctx, request.employeeId, LEAVE_PERMISSIONS);
      if (denied) return refuse(denied);

      if (approve && request.leaveType.defaultDaysPerYear > 0) {
        const balance = await prisma.leaveBalance.findUnique({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: request.employeeId,
              leaveTypeId: request.leaveTypeId,
              year: request.startDate.getFullYear(),
            },
          },
        });
        if (balance && balance.allocatedDays - balance.usedDays < request.days) {
          return refuse(
            `${fullName(request.employee)} only has ${balance.allocatedDays - balance.usedDays} day(s) left, and this request is ${request.days}.`,
          );
        }
      }

      return {
        ok: true,
        proposal: {
          kind,
          title: `${approve ? "Approve" : "Reject"} ${fullName(request.employee)}'s leave`,
          summary: [
            ["Employee", `${fullName(request.employee)} (${request.employee.employeeCode})`],
            ["Leave type", request.leaveType.name],
            ["From", request.startDate.toISOString().slice(0, 10)],
            ["To", request.endDate.toISOString().slice(0, 10)],
            ["Days", String(request.days)],
            ...(note ? ([["Note", note]] as [string, string][]) : []),
          ],
          effect: approve
            ? "Approves the leave, draws it from their balance and notifies them."
            : "Rejects the request and notifies them.",
          confirmLabel: approve ? "Approve leave" : "Reject leave",
          danger: !approve,
          request: {
            method: "POST",
            path: `/leave-requests/${request.id}/${approve ? "approve" : "reject"}`,
            body: note ? { decisionNote: note } : {},
          },
          done: { label: "Attendance & Leave", path: "/attendance?tab=leave" },
        },
      };
    }

    case "decide_correction": {
      const correctionId = id(args.correctionId);
      const approve = bool(args.approve);
      if (!correctionId || approve === undefined) {
        return refuse("I need to know which correction, and whether to approve or reject it.");
      }
      const note = str(args.decisionNote, 5000);

      const correction = await prisma.attendanceCorrectionRequest.findFirst({
        where: { id: correctionId, organizationId: org },
        include: { employee: true },
      });
      if (!correction) return refuse("I couldn't find that correction request.");
      if (correction.status !== "PENDING") return refuse("That request has already been decided.");

      const denied = await canDecide(ctx, correction.employeeId, CORRECTION_PERMISSIONS);
      if (denied) return refuse(denied);

      return {
        ok: true,
        proposal: {
          kind,
          title: `${approve ? "Approve" : "Reject"} ${fullName(correction.employee)}'s attendance correction`,
          summary: [
            ["Employee", `${fullName(correction.employee)} (${correction.employee.employeeCode})`],
            ["Date", correction.date.toISOString().slice(0, 10)],
            ...(correction.requestedCheckInAt
              ? ([["Check in", correction.requestedCheckInAt.toISOString()]] as [string, string][])
              : []),
            ...(correction.requestedCheckOutAt
              ? ([["Check out", correction.requestedCheckOutAt.toISOString()]] as [string, string][])
              : []),
            ["Reason", correction.reason],
            ...(note ? ([["Note", note]] as [string, string][]) : []),
          ],
          effect: approve
            ? "Approves the correction and updates that day's attendance record."
            : "Rejects the correction and leaves the day as it is.",
          confirmLabel: approve ? "Approve correction" : "Reject correction",
          danger: !approve,
          request: {
            method: "POST",
            path: `/attendance/corrections/${correction.id}/${approve ? "approve" : "reject"}`,
            body: note ? { decisionNote: note } : {},
          },
          done: { label: "Attendance & Leave", path: "/attendance?tab=corrections" },
        },
      };
    }

    /* --------------------------------------------------- HR administration */
    case "publish_announcement": {
      const denied = needsPermission(ctx, PERMISSIONS.ANNOUNCEMENT_MANAGE, "publish announcements");
      if (denied) return refuse(denied);
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);
      const parsed = check(announcementCreateSchema, { title: args.title, body: args.body });
      if (!parsed.ok) return refuse(parsed.reason);

      return {
        ok: true,
        proposal: {
          kind,
          title: "Publish an announcement",
          summary: [
            ["Title", parsed.data.title],
            ["Body", parsed.data.body.slice(0, 400)],
          ],
          effect: "Publishes it to everyone in the company straight away.",
          confirmLabel: "Publish",
          danger: true,
          request: { method: "POST", path: "/announcements", body: parsed.data },
          done: { label: "Home", path: "/dashboard" },
        },
      };
    }

    case "create_job_posting": {
      const denied = needsPermission(ctx, PERMISSIONS.RECRUITMENT_MANAGE, "manage hiring");
      if (denied) return refuse(denied);
      const departmentId = id(args.departmentId);
      const parsed = check(createPostingSchema, {
        title: args.title,
        description: args.description,
        ...(departmentId ? { departmentId } : {}),
        ...(str(args.location, 200) ? { location: str(args.location, 200) } : {}),
        ...(str(args.workMode, 20) ? { workMode: str(args.workMode, 20) } : {}),
      });
      if (!parsed.ok) return refuse(parsed.reason);

      let departmentName: string | null = null;
      if (parsed.data.departmentId) {
        const department = await prisma.department.findFirst({
          where: { id: parsed.data.departmentId, organizationId: org },
          select: { name: true },
        });
        if (!department) return refuse("I couldn't find that department in this company.");
        departmentName = department.name;
      }

      return {
        ok: true,
        proposal: {
          kind,
          title: `Open a job for ${parsed.data.title}`,
          summary: [
            ["Role", parsed.data.title],
            ...(departmentName ? ([["Department", departmentName]] as [string, string][]) : []),
            ...(parsed.data.location ? ([["Location", parsed.data.location]] as [string, string][]) : []),
            ...(parsed.data.workMode ? ([["Work mode", parsed.data.workMode]] as [string, string][]) : []),
            ["Description", parsed.data.description.slice(0, 300)],
          ],
          effect: "Opens the job so candidates can be added to it.",
          confirmLabel: "Open job",
          danger: false,
          request: { method: "POST", path: "/hiring/postings", body: parsed.data },
          done: { label: "Hiring", path: "/hiring" },
        },
      };
    }

    case "move_application": {
      const denied = needsPermission(ctx, PERMISSIONS.RECRUITMENT_MANAGE, "manage hiring");
      if (denied) return refuse(denied);
      const applicationId = id(args.applicationId);
      if (!applicationId) return refuse("I need to know which application.");
      const parsed = check(updateApplicationSchema, { stage: args.stage });
      if (!parsed.ok) return refuse(parsed.reason);
      if (!parsed.data.stage) return refuse("I need the stage to move them to.");

      const application = await prisma.jobApplication.findFirst({
        where: { id: applicationId, organizationId: org },
        select: {
          id: true,
          stage: true,
          candidate: { select: { firstName: true, lastName: true } },
          jobPosting: { select: { title: true } },
        },
      });
      if (!application) return refuse("I couldn't find that application.");
      // Selected is not Joined, and Joined is settled.
      if (application.stage === "JOINED") {
        return refuse("That candidate has already joined, so this application's stage can't be changed.");
      }
      if (application.stage === parsed.data.stage) return refuse(`They're already at ${parsed.data.stage}.`);

      return {
        ok: true,
        proposal: {
          kind,
          title: `Move ${fullName(application.candidate)} to ${parsed.data.stage}`,
          summary: [
            ["Candidate", fullName(application.candidate)],
            ["Role", application.jobPosting.title],
            ["Now", application.stage],
            ["New", parsed.data.stage],
            ...(parsed.data.stage === "SELECTED"
              ? ([["Note", "Selected is not joined — confirming a joining is done on the Hiring page"]] as [
                  string,
                  string,
                ][])
              : []),
          ],
          effect: "Moves this application to that stage. Their other applications are unaffected.",
          confirmLabel: "Move application",
          danger: parsed.data.stage === "REJECTED",
          request: { method: "PATCH", path: `/hiring/applications/${application.id}`, body: { stage: parsed.data.stage } },
          done: { label: "Hiring", path: "/hiring" },
        },
      };
    }

    case "create_employee": {
      const denied = needsPermission(ctx, PERMISSIONS.EMPLOYEE_WRITE, "add employees");
      if (denied) return refuse(denied);

      const parsed = check(employeeCreateSchema, {
        email: args.email,
        firstName: args.firstName,
        lastName: args.lastName,
        designation: str(args.designation, 200),
        departmentId: id(args.departmentId),
        managerId: id(args.managerId),
        dateOfJoining: date(args.dateOfJoining),
      });
      if (!parsed.ok) return refuse(parsed.reason);

      const existing = await prisma.user.findFirst({
        where: { organizationId: org, email: parsed.data.email.toLowerCase() },
        select: { id: true },
      });
      if (existing) return refuse("Someone already has an account with that email address in this company.");

      let departmentName: string | null = null;
      if (parsed.data.departmentId) {
        const department = await prisma.department.findFirst({
          where: { id: parsed.data.departmentId, organizationId: org },
          select: { name: true },
        });
        if (!department) return refuse("I couldn't find that department in this company.");
        departmentName = department.name;
      }
      let managerName: string | null = null;
      if (parsed.data.managerId) {
        const manager = await prisma.employee.findFirst({
          where: { id: parsed.data.managerId, organizationId: org },
          select: { firstName: true, lastName: true },
        });
        if (!manager) return refuse("I couldn't find that manager in this company.");
        managerName = fullName(manager);
      }

      return {
        ok: true,
        proposal: {
          kind,
          title: `Add ${parsed.data.firstName} ${parsed.data.lastName}`,
          summary: [
            ["Name", `${parsed.data.firstName} ${parsed.data.lastName}`],
            ["Email", parsed.data.email],
            ...(parsed.data.designation ? ([["Designation", parsed.data.designation]] as [string, string][]) : []),
            ...(departmentName ? ([["Department", departmentName]] as [string, string][]) : []),
            ...(managerName ? ([["Manager", managerName]] as [string, string][]) : []),
            ...(parsed.data.dateOfJoining ? ([["Joining", date(args.dateOfJoining)!]] as [string, string][]) : []),
          ],
          effect:
            "Creates the employee, their login and their joining checklist, and emails them a welcome link. It does not set salary or payroll. Check the spelling: the email goes out immediately.",
          confirmLabel: "Add employee",
          danger: true,
          request: {
            method: "POST",
            path: "/employees",
            body: {
              email: parsed.data.email,
              firstName: parsed.data.firstName,
              lastName: parsed.data.lastName,
              ...(parsed.data.designation ? { designation: parsed.data.designation } : {}),
              ...(parsed.data.departmentId ? { departmentId: parsed.data.departmentId } : {}),
              ...(parsed.data.managerId ? { managerId: parsed.data.managerId } : {}),
              ...(parsed.data.dateOfJoining ? { dateOfJoining: date(args.dateOfJoining) } : {}),
            },
          },
          done: { label: "Employees", path: "/employees" },
        },
      };
    }
  }
}
