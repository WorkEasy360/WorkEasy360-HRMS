import { prisma } from "../../config/prisma";
import { AssistantContext } from "../../ai/capabilities";
import { PERMISSIONS, PermissionKey } from "../../utils/permissions";
import { createSchema as leaveCreateSchema } from "../leaveRequests/leaveRequests.routes";
import { createSchema as ticketCreateSchema } from "../helpdesk/helpdesk.routes";
import { updateSchema as goalUpdateSchema } from "../goals/goals.routes";
import { upsertSchema as timesheetSchema } from "../timesheets/timesheets.routes";
import { createSchema as expenseCreateSchema } from "../expenses/expenses.routes";
import { createSchema as announcementCreateSchema } from "../announcements/announcements.routes";
import { createSchema as employeeCreateSchema } from "../employees/employees.routes";
import { createPostingSchema, updateCandidateSchema } from "../recruitment/recruitment.routes";

/**
 * Turning a model's suggestion into a card the member can confirm.
 *
 * Nothing here writes. Each action is checked with the same validation schema
 * and the same rules as the endpoint that will eventually run it, so the card
 * never offers something the server would refuse — and if the world changes
 * between the card and the button, the endpoint refuses it anyway.
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

function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export const ACTION_KINDS = [
  "apply_leave",
  "cancel_leave",
  "check_in",
  "check_out",
  "raise_ticket",
  "log_timesheet",
  "submit_expense",
  "update_goal_progress",
  "complete_onboarding_task",
  "decide_leave",
  "decide_timesheet",
  "decide_expense",
  "decide_loan",
  "publish_announcement",
  "create_job_posting",
  "move_candidate",
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

const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;

/**
 * Mirrors assertCanDecide: nobody decides their own record; a holder of the
 * manage permission decides anything else; otherwise only the owner's direct
 * manager, and only while that manager is still active.
 */
async function canDecide(
  ctx: AssistantContext,
  owner: { employeeId: string; managerId: string | null },
  managePermission: PermissionKey,
): Promise<string | null> {
  if (ctx.employeeId && owner.employeeId === ctx.employeeId) return "You can't approve your own request.";
  if (ctx.permissions.includes(managePermission)) return null;
  if (ctx.employeeId && owner.managerId === ctx.employeeId) {
    const me = await prisma.employee.findFirst({
      where: { id: ctx.employeeId, organizationId: ctx.organizationId },
      select: { status: true },
    });
    if (me && me.status !== "EXITED") return null;
  }
  return "That request isn't waiting on you to decide.";
}

function needsEmployee(ctx: AssistantContext): string | null {
  return ctx.employeeId ? null : "You don't have an employee profile yet, so I can't do that for you.";
}

function needsPermission(ctx: AssistantContext, permission: PermissionKey, what: string): string | null {
  return ctx.permissions.includes(permission) ? null : `Your role can't ${what}.`;
}

/** Runs the endpoint's own schema; its message becomes the refusal. */
function check<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, value: unknown):
  | { ok: true; data: T }
  | { ok: false; reason: string } {
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

      const leaveType = await prisma.leaveType.findFirst({ where: { id: parsed.data.leaveTypeId, organizationId: org } });
      if (!leaveType) return refuse("I couldn't find that leave type in this company.");

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

      const days = Math.round((parsed.data.endDate.getTime() - parsed.data.startDate.getTime()) / 86_400_000) + 1;
      const balance = await prisma.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId: ctx.employeeId!, leaveTypeId: leaveType.id, year: parsed.data.startDate.getFullYear() } },
      });
      if (balance && leaveType.defaultDaysPerYear > 0 && balance.allocatedDays - balance.usedDays < days) {
        return refuse(`You only have ${balance.allocatedDays - balance.usedDays} day(s) of ${leaveType.name} left, and this needs ${days}.`);
      }

      return {
        ok: true,
        proposal: {
          kind,
          title: `Request ${days} day${days === 1 ? "" : "s"} of ${leaveType.name}`,
          summary: [
            ["Leave type", leaveType.name],
            ["From", date(args.startDate)!],
            ["To", date(args.endDate)!],
            ["Days", String(days)],
            ...(parsed.data.reason ? ([["Reason", parsed.data.reason]] as [string, string][]) : []),
          ],
          effect: "Sends the request to your manager for approval.",
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
          done: { label: "My Leave", path: "/my-leave" },
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
      if (request.status !== "PENDING") return refuse("Only a pending request can be cancelled.");

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
          ],
          effect: "Withdraws the request so nobody needs to decide it.",
          confirmLabel: "Cancel request",
          danger: true,
          request: { method: "POST", path: `/leave-requests/${request.id}/cancel`, body: {} },
          done: { label: "My Leave", path: "/my-leave" },
        },
      };
    }

    case "check_in":
    case "check_out": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);
      const todayUtc = new Date();
      const day = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate()));
      const record = await prisma.attendanceRecord.findFirst({ where: { organizationId: org, employeeId: ctx.employeeId!, date: day } });

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
            ...(kind === "check_out" && record?.checkInAt ? ([["Checked in at", record.checkInAt.toISOString()]] as [string, string][]) : []),
          ],
          effect: kind === "check_in" ? "Records your start time for today." : "Records your end time for today.",
          confirmLabel: kind === "check_in" ? "Check in" : "Check out",
          danger: false,
          request: { method: "POST", path: `/attendance/${kind === "check_in" ? "check-in" : "check-out"}`, body: {} },
          done: { label: "My Attendance", path: "/my-attendance" },
        },
      };
    }

    case "raise_ticket": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);
      const parsed = check(ticketCreateSchema, { category: args.category, subject: args.subject, description: args.description });
      if (!parsed.ok) return refuse(parsed.reason);

      return {
        ok: true,
        proposal: {
          kind,
          title: "Raise a help desk ticket",
          summary: [
            ["Category", parsed.data.category],
            ["Subject", parsed.data.subject],
            ["Details", parsed.data.description.slice(0, 300)],
          ],
          effect: "Opens a ticket for the HR help desk to pick up.",
          confirmLabel: "Raise ticket",
          danger: false,
          request: { method: "POST", path: "/helpdesk", body: parsed.data },
          done: { label: "Help Desk", path: "/helpdesk" },
        },
      };
    }

    case "log_timesheet": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);
      const parsed = check(timesheetSchema, { date: date(args.date), hours: num(args.hours), task: str(args.task, 5000) });
      if (!parsed.ok) return refuse(parsed.reason);

      const existing = await prisma.timesheetEntry.findUnique({
        where: { employeeId_date: { employeeId: ctx.employeeId!, date: parsed.data.date } },
        select: { status: true, hours: true },
      });
      if (existing && existing.status !== "PENDING") return refuse(`That day's timesheet is already ${existing.status.toLowerCase()}.`);

      return {
        ok: true,
        proposal: {
          kind,
          title: `Log ${parsed.data.hours} hour${parsed.data.hours === 1 ? "" : "s"} on ${date(args.date)}`,
          summary: [
            ["Date", date(args.date)!],
            ["Hours", String(parsed.data.hours)],
            ...(parsed.data.task ? ([["Task", parsed.data.task]] as [string, string][]) : []),
            ...(existing ? ([["Replaces", `${existing.hours} hour(s) already logged`]] as [string, string][]) : []),
          ],
          effect: "Saves the entry and sends it to your manager for approval.",
          confirmLabel: "Log hours",
          danger: false,
          request: { method: "POST", path: "/timesheets", body: { date: date(args.date), hours: parsed.data.hours, ...(parsed.data.task ? { task: parsed.data.task } : {}) } },
          done: { label: "My Timesheet", path: "/my-timesheet" },
        },
      };
    }

    case "submit_expense": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);
      const parsed = check(expenseCreateSchema, {
        category: args.category,
        amount: num(args.amount),
        expenseDate: date(args.expenseDate),
        description: str(args.description, 5000),
      });
      if (!parsed.ok) return refuse(parsed.reason);

      return {
        ok: true,
        proposal: {
          kind,
          title: `Claim ${money(parsed.data.amount)}`,
          summary: [
            ["Category", parsed.data.category],
            ["Amount", money(parsed.data.amount)],
            ["Date", date(args.expenseDate)!],
            ...(parsed.data.description ? ([["Details", parsed.data.description]] as [string, string][]) : []),
          ],
          effect: "Submits the claim for approval before reimbursement.",
          confirmLabel: "Submit claim",
          danger: false,
          request: {
            method: "POST",
            path: "/expenses",
            body: {
              category: parsed.data.category,
              amount: parsed.data.amount,
              expenseDate: date(args.expenseDate),
              ...(parsed.data.description ? { description: parsed.data.description } : {}),
            },
          },
          done: { label: "My Expenses", path: "/my-expenses" },
        },
      };
    }

    case "update_goal_progress": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);
      const goalId = id(args.goalId);
      if (!goalId) return refuse("I need to know which goal.");
      const parsed = check(goalUpdateSchema, { progress: num(args.progress) });
      if (!parsed.ok) return refuse(parsed.reason);
      if (parsed.data.progress === undefined) return refuse("I need a progress value between 0 and 100.");

      const goal = await prisma.goal.findFirst({ where: { id: goalId, organizationId: org, employeeId: ctx.employeeId! } });
      if (!goal) return refuse("I couldn't find that goal among yours.");

      return {
        ok: true,
        proposal: {
          kind,
          title: `Set "${goal.title}" to ${parsed.data.progress}%`,
          summary: [
            ["Goal", goal.title],
            ["Now", `${goal.progress}%`],
            ["New", `${parsed.data.progress}%`],
          ],
          effect: "Updates the progress on your goal.",
          confirmLabel: "Update progress",
          danger: false,
          request: { method: "PATCH", path: `/goals/me/${goal.id}`, body: { progress: parsed.data.progress } },
          done: { label: "My Goals", path: "/goals" },
        },
      };
    }

    case "complete_onboarding_task": {
      const blocked = needsEmployee(ctx);
      if (blocked) return refuse(blocked);
      const taskId = id(args.taskId);
      if (!taskId) return refuse("I need to know which task.");
      const done = bool(args.done) ?? true;

      const task = await prisma.onboardingTask.findFirst({ where: { id: taskId, organizationId: org, employeeId: ctx.employeeId! } });
      if (!task) return refuse("I couldn't find that task among yours.");
      if (task.done === done) return refuse(done ? "That task is already done." : "That task is already open.");

      return {
        ok: true,
        proposal: {
          kind,
          title: done ? `Mark "${task.title}" done` : `Reopen "${task.title}"`,
          summary: [["Task", task.title]],
          effect: done ? "Ticks the task off your onboarding checklist." : "Puts the task back on your checklist.",
          confirmLabel: done ? "Mark done" : "Reopen",
          danger: false,
          request: { method: "PATCH", path: `/onboarding/me/${task.id}`, body: { done } },
          done: { label: "My Tasks", path: "/my-tasks" },
        },
      };
    }

    /* ---------------------------------------------------------- approvals */
    case "decide_leave": {
      const requestId = id(args.leaveRequestId);
      const approve = bool(args.approve);
      if (!requestId || approve === undefined) return refuse("I need to know which request, and whether to approve or reject it.");
      const note = str(args.decisionNote, 5000);

      const request = await prisma.leaveRequest.findFirst({
        where: { id: requestId, organizationId: org },
        include: { employee: true, leaveType: true },
      });
      if (!request) return refuse("I couldn't find that leave request.");
      if (request.status !== "PENDING") return refuse("That request has already been decided.");

      const denied = await canDecide(ctx, { employeeId: request.employeeId, managerId: request.employee.managerId }, PERMISSIONS.LEAVE_MANAGE);
      if (denied) return refuse(denied);

      if (approve && request.leaveType.defaultDaysPerYear > 0) {
        const balance = await prisma.leaveBalance.findUnique({
          where: { employeeId_leaveTypeId_year: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year: request.startDate.getFullYear() } },
        });
        if (balance && balance.allocatedDays - balance.usedDays < request.days) {
          return refuse(`${fullName(request.employee)} only has ${balance.allocatedDays - balance.usedDays} day(s) left, and this request is ${request.days}.`);
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
          request: { method: "POST", path: `/leave-requests/${request.id}/${approve ? "approve" : "reject"}`, body: note ? { decisionNote: note } : {} },
          done: { label: "Approvals", path: "/approvals" },
        },
      };
    }

    case "decide_timesheet": {
      const entryId = id(args.timesheetId);
      const approve = bool(args.approve);
      if (!entryId || approve === undefined) return refuse("I need to know which timesheet, and whether to approve or reject it.");

      const entry = await prisma.timesheetEntry.findFirst({ where: { id: entryId, organizationId: org }, include: { employee: true } });
      if (!entry) return refuse("I couldn't find that timesheet entry.");
      if (entry.status !== "PENDING") return refuse("That entry has already been decided.");

      const denied = await canDecide(ctx, { employeeId: entry.employeeId, managerId: entry.employee.managerId }, PERMISSIONS.TIMESHEET_MANAGE);
      if (denied) return refuse(denied);

      return {
        ok: true,
        proposal: {
          kind,
          title: `${approve ? "Approve" : "Reject"} ${fullName(entry.employee)}'s hours`,
          summary: [
            ["Employee", fullName(entry.employee)],
            ["Date", entry.date.toISOString().slice(0, 10)],
            ["Hours", String(entry.hours)],
            ...(entry.task ? ([["Task", entry.task]] as [string, string][]) : []),
          ],
          effect: approve ? "Approves the logged hours." : "Rejects the logged hours.",
          confirmLabel: approve ? "Approve hours" : "Reject hours",
          danger: !approve,
          request: { method: "POST", path: `/timesheets/${entry.id}/${approve ? "approve" : "reject"}`, body: {} },
          done: { label: "Approvals", path: "/approvals" },
        },
      };
    }

    case "decide_expense": {
      const claimId = id(args.expenseId);
      const approve = bool(args.approve);
      if (!claimId || approve === undefined) return refuse("I need to know which claim, and whether to approve or reject it.");
      const note = str(args.decisionNote, 5000);

      const claim = await prisma.expenseClaim.findFirst({ where: { id: claimId, organizationId: org }, include: { employee: true } });
      if (!claim) return refuse("I couldn't find that expense claim.");
      if (claim.status !== "PENDING") return refuse("That claim has already been decided.");

      const denied = await canDecide(ctx, { employeeId: claim.employeeId, managerId: claim.employee.managerId }, PERMISSIONS.EXPENSE_MANAGE);
      if (denied) return refuse(denied);

      return {
        ok: true,
        proposal: {
          kind,
          title: `${approve ? "Approve" : "Reject"} ${money(claim.amount)} claim`,
          summary: [
            ["Employee", fullName(claim.employee)],
            ["Category", claim.category],
            ["Amount", money(claim.amount)],
            ["Date", claim.expenseDate.toISOString().slice(0, 10)],
            ...(note ? ([["Note", note]] as [string, string][]) : []),
          ],
          effect: approve ? "Approves the claim, ready to be paid out." : "Rejects the claim and notifies them.",
          confirmLabel: approve ? "Approve claim" : "Reject claim",
          danger: !approve,
          request: { method: "POST", path: `/expenses/${claim.id}/${approve ? "approve" : "reject"}`, body: note ? { decisionNote: note } : {} },
          done: { label: "Approvals", path: "/approvals" },
        },
      };
    }

    case "decide_loan": {
      const loanId = id(args.loanId);
      const approve = bool(args.approve);
      if (!loanId || approve === undefined) return refuse("I need to know which loan request, and whether to approve or reject it.");
      const note = str(args.decisionNote, 5000);

      const loan = await prisma.loanRequest.findFirst({ where: { id: loanId, organizationId: org }, include: { employee: true } });
      if (!loan) return refuse("I couldn't find that loan request.");
      if (loan.status !== "PENDING") return refuse("That request has already been decided.");

      const denied = await canDecide(ctx, { employeeId: loan.employeeId, managerId: loan.employee.managerId }, PERMISSIONS.LOAN_MANAGE);
      if (denied) return refuse(denied);

      return {
        ok: true,
        proposal: {
          kind,
          title: `${approve ? "Approve" : "Reject"} ${money(loan.amount)} loan`,
          summary: [
            ["Employee", fullName(loan.employee)],
            ["Amount", money(loan.amount)],
            ["Repayment", `${loan.emiMonths} month(s)`],
            ...(note ? ([["Note", note]] as [string, string][]) : []),
          ],
          effect: approve ? "Approves the loan and sets up the monthly deduction." : "Rejects the request and notifies them.",
          confirmLabel: approve ? "Approve loan" : "Reject loan",
          danger: !approve,
          request: { method: "POST", path: `/loans/${loan.id}/${approve ? "approve" : "reject"}`, body: note ? { decisionNote: note } : {} },
          done: { label: "Approvals", path: "/approvals" },
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
          done: { label: "Announcements", path: "/announcements" },
        },
      };
    }

    case "create_job_posting": {
      const denied = needsPermission(ctx, PERMISSIONS.RECRUITMENT_MANAGE, "manage recruitment");
      if (denied) return refuse(denied);
      const departmentId = id(args.departmentId);
      const parsed = check(createPostingSchema, { title: args.title, description: args.description, ...(departmentId ? { departmentId } : {}) });
      if (!parsed.ok) return refuse(parsed.reason);

      let departmentName: string | null = null;
      if (parsed.data.departmentId) {
        const department = await prisma.department.findFirst({ where: { id: parsed.data.departmentId, organizationId: org }, select: { name: true } });
        if (!department) return refuse("I couldn't find that department in this company.");
        departmentName = department.name;
      }

      return {
        ok: true,
        proposal: {
          kind,
          title: `Open a posting for ${parsed.data.title}`,
          summary: [
            ["Role", parsed.data.title],
            ...(departmentName ? ([["Department", departmentName]] as [string, string][]) : []),
            ["Description", parsed.data.description.slice(0, 300)],
          ],
          effect: "Opens the posting so candidates can be added to it.",
          confirmLabel: "Open posting",
          danger: false,
          request: { method: "POST", path: "/recruitment/postings", body: parsed.data },
          done: { label: "Recruitment", path: "/recruitment" },
        },
      };
    }

    case "move_candidate": {
      const denied = needsPermission(ctx, PERMISSIONS.RECRUITMENT_MANAGE, "manage recruitment");
      if (denied) return refuse(denied);
      const candidateId = id(args.candidateId);
      if (!candidateId) return refuse("I need to know which candidate.");
      const parsed = check(updateCandidateSchema, { stage: args.stage });
      if (!parsed.ok) return refuse(parsed.reason);
      if (!parsed.data.stage) return refuse("I need the stage to move them to.");

      const candidate = await prisma.candidate.findFirst({
        where: { id: candidateId, organizationId: org },
        select: { id: true, firstName: true, lastName: true, stage: true, jobPosting: { select: { title: true } } },
      });
      if (!candidate) return refuse("I couldn't find that candidate.");
      if (candidate.stage === "HIRED") return refuse("That candidate is already hired, so their stage can't be changed here.");
      if (candidate.stage === parsed.data.stage) return refuse(`They're already at ${parsed.data.stage}.`);

      return {
        ok: true,
        proposal: {
          kind,
          title: `Move ${fullName(candidate)} to ${parsed.data.stage}`,
          summary: [
            ["Candidate", fullName(candidate)],
            ["Role", candidate.jobPosting?.title ?? "—"],
            ["Now", candidate.stage],
            ["New", parsed.data.stage],
          ],
          effect: "Moves them to that stage in the hiring pipeline.",
          confirmLabel: "Move candidate",
          danger: parsed.data.stage === "REJECTED",
          request: { method: "PATCH", path: `/recruitment/candidates/${candidate.id}`, body: { stage: parsed.data.stage } },
          done: { label: "Recruitment", path: "/recruitment" },
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

      const existing = await prisma.user.findFirst({ where: { email: parsed.data.email.toLowerCase() }, select: { id: true } });
      if (existing) return refuse("Someone already has an account with that email address.");

      let departmentName: string | null = null;
      if (parsed.data.departmentId) {
        const department = await prisma.department.findFirst({ where: { id: parsed.data.departmentId, organizationId: org }, select: { name: true } });
        if (!department) return refuse("I couldn't find that department in this company.");
        departmentName = department.name;
      }
      let managerName: string | null = null;
      if (parsed.data.managerId) {
        const manager = await prisma.employee.findFirst({ where: { id: parsed.data.managerId, organizationId: org }, select: { firstName: true, lastName: true } });
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
          effect: "Creates the employee and their login, and emails them a welcome link. Check the spelling: the email goes out immediately.",
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
          done: { label: "Directory", path: "/people" },
        },
      };
    }
  }
}
