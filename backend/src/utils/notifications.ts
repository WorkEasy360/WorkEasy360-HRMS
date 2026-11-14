import { prisma } from "../config/prisma";
import { resolveApprovalRoute, type ApprovalPermissions } from "./approvals";
import { isAutomationEnabled } from "./automations";
import { renderEmail } from "./emailTemplates";
import { sendMail } from "./mailer";
import { PERMISSIONS } from "./permissions";

// Every notification is best-effort: it runs after the request, loads what it needs,
// and swallows its own errors. Call as `void notifyX(...)`.
// A failed notification must never undo a successful HR transaction
// (Internal automation rule 06, Helpdesk simplification 03).

const TIMEZONE = process.env.APP_TIMEZONE ?? "Asia/Kolkata";

function formatDate(d: Date) {
  // Date-only columns are stored as UTC midnight.
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function formatDateTime(d: Date) {
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
}
function formatMoney(amount: number, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function safely(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`Notification failed: ${label}`, err);
  }
}

type Person = { firstName: string; email: string };

/**
 * The people a request is actually routed to (Attendance & Leave rule 06):
 * the assigned manager with the matching approval permission, or authorized HR
 * as fallback. Never the requester.
 */
async function routedReviewers(
  organizationId: string,
  requesterEmployeeId: string,
  permissions: ApprovalPermissions,
): Promise<Person[]> {
  const route = await resolveApprovalRoute(organizationId, requesterEmployeeId, permissions);
  if (route.approverIds.length === 0) return [];
  // The routed manager alone when there is one; HR only as the fallback pool.
  const ids = route.managerId ? [route.managerId] : route.hrIds.slice(0, 20);
  const rows = await prisma.employee.findMany({
    where: { id: { in: ids }, organizationId },
    select: { firstName: true, user: { select: { email: true } } },
  });
  return rows.map((r) => ({ firstName: r.firstName, email: r.user.email }));
}

const employeeWithEmail = { select: { firstName: true, lastName: true, user: { select: { email: true } } } } as const;

// ─── Account emails ────────────────────────────────────────────────────────

export function sendWelcomeEmail(p: { to: string; firstName: string; organizationName: string; organizationSlug: string; token: string }) {
  sendMail(
    renderEmail({
      to: p.to,
      subject: `Welcome to ${p.organizationName} on WorkEasy360`,
      heading: `Welcome, ${p.firstName}!`,
      paragraphs: [
        `${p.organizationName} has set up your WorkEasy360 account. Use it for attendance, leave, payslips and help desk requests.`,
        "Choose your password to get started:",
      ],
      details: [
        ["Organization ID", p.organizationSlug],
        ["Your sign-in email", p.to],
      ],
      action: { label: "Set my password", path: `/reset-password?token=${encodeURIComponent(p.token)}` },
      footnote: "This link works once and expires in 3 days. If it expires, ask HR to send a new one.",
    }),
  );
}

export function sendPasswordResetEmail(p: { to: string; firstName: string; token: string; requestedByHr: boolean }) {
  sendMail(
    renderEmail({
      to: p.to,
      subject: "Reset your WorkEasy360 password",
      heading: "Reset your password",
      paragraphs: [
        `Hi ${p.firstName},`,
        p.requestedByHr
          ? "Your HR team asked for your password to be reset. Choose a new one using the button below."
          : "We received a request to reset your password. Choose a new one using the button below.",
      ],
      action: { label: "Choose a new password", path: `/reset-password?token=${encodeURIComponent(p.token)}` },
      footnote: p.requestedByHr
        ? "Your old password no longer works. This link works once and expires in 24 hours."
        : "This link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email; your password won't change.",
    }),
  );
}

// ─── Approval requests ─────────────────────────────────────────────────────

const LEAVE_PERMISSIONS: ApprovalPermissions = { approve: PERMISSIONS.LEAVE_APPROVE, manage: PERMISSIONS.LEAVE_MANAGE };
const CORRECTION_PERMISSIONS: ApprovalPermissions = {
  approve: PERMISSIONS.ATTENDANCE_APPROVE,
  manage: PERMISSIONS.ATTENDANCE_MANAGE,
};

export function notifyLeaveRequested(leaveRequestId: string) {
  return safely("leave requested", async () => {
    const r = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { employee: employeeWithEmail, leaveType: { select: { name: true } } },
    });
    if (!r) return;
    if (!(await isAutomationEnabled(r.organizationId, "approval_routing_notice"))) return;
    const reviewers = await routedReviewers(r.organizationId, r.employeeId, LEAVE_PERMISSIONS);
    const name = `${r.employee.firstName} ${r.employee.lastName}`;
    sendMail(
      reviewers.map((a) =>
        renderEmail({
          to: a.email,
          subject: `Leave request from ${name}`,
          heading: `${name} requested leave`,
          paragraphs: [`Hi ${a.firstName}, a leave request is waiting for your approval.`],
          details: [
            ["Type", r.leaveType.name],
            ["Dates", `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`],
            ["Days", String(r.days)],
            ...(r.reason ? ([["Reason", r.reason]] as [string, string][]) : []),
          ],
          action: { label: "Review request", path: "/attendance?tab=leave" },
        }),
      ),
    );
  });
}

export function notifyCorrectionRequested(correctionId: string) {
  return safely("attendance correction requested", async () => {
    const c = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id: correctionId },
      include: { employee: employeeWithEmail },
    });
    if (!c) return;
    if (!(await isAutomationEnabled(c.organizationId, "approval_routing_notice"))) return;
    const reviewers = await routedReviewers(c.organizationId, c.employeeId, CORRECTION_PERMISSIONS);
    const name = `${c.employee.firstName} ${c.employee.lastName}`;
    sendMail(
      reviewers.map((a) =>
        renderEmail({
          to: a.email,
          subject: `Attendance correction from ${name}`,
          heading: `${name} requested an attendance correction`,
          paragraphs: [`Hi ${a.firstName}, an attendance correction is waiting for your approval.`],
          details: [
            ["Date", formatDate(c.date)],
            ...(c.requestedCheckInAt ? ([["Check in", formatDateTime(c.requestedCheckInAt)]] as [string, string][]) : []),
            ...(c.requestedCheckOutAt ? ([["Check out", formatDateTime(c.requestedCheckOutAt)]] as [string, string][]) : []),
            ["Reason", c.reason],
          ],
          action: { label: "Review request", path: "/attendance?tab=corrections" },
        }),
      ),
    );
  });
}

// ─── Decisions ─────────────────────────────────────────────────────────────

function decisionEmail(p: {
  to: string;
  firstName: string;
  what: string;
  approved: boolean;
  details: [string, string][];
  note?: string | null;
  path: string;
}) {
  const verb = p.approved ? "approved" : "rejected";
  return renderEmail({
    to: p.to,
    subject: `Your ${p.what} was ${verb}`,
    heading: `Your ${p.what} was ${verb}`,
    paragraphs: [`Hi ${p.firstName},`, p.approved ? `Good news: your ${p.what} has been approved.` : `Your ${p.what} was not approved.`],
    details: [...p.details, ...(p.note ? ([["Note", p.note]] as [string, string][]) : [])],
    action: { label: "View details", path: p.path },
  });
}

export function notifyLeaveDecided(leaveRequestId: string) {
  return safely("leave decided", async () => {
    const r = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { employee: employeeWithEmail, leaveType: { select: { name: true } } },
    });
    if (!r || (r.status !== "APPROVED" && r.status !== "REJECTED")) return;
    sendMail(
      decisionEmail({
        to: r.employee.user.email,
        firstName: r.employee.firstName,
        what: "leave request",
        approved: r.status === "APPROVED",
        details: [
          ["Type", r.leaveType.name],
          ["Dates", `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`],
        ],
        note: r.decisionNote,
        path: "/attendance?tab=leave",
      }),
    );
  });
}

export function notifyCorrectionDecided(correctionId: string) {
  return safely("attendance correction decided", async () => {
    const c = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id: correctionId },
      include: { employee: employeeWithEmail },
    });
    if (!c || (c.status !== "APPROVED" && c.status !== "REJECTED")) return;
    sendMail(
      decisionEmail({
        to: c.employee.user.email,
        firstName: c.employee.firstName,
        what: "attendance correction",
        approved: c.status === "APPROVED",
        details: [["Date", formatDate(c.date)]],
        note: c.decisionNote,
        path: "/attendance?tab=corrections",
      }),
    );
  });
}

// ─── Other events ──────────────────────────────────────────────────────────

export function notifyInterviewScheduled(interviewId: string) {
  return safely("interview scheduled", async () => {
    const i = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        interviewer: employeeWithEmail,
        application: {
          select: {
            candidate: { select: { firstName: true, lastName: true } },
            jobPosting: { select: { title: true } },
          },
        },
      },
    });
    if (!i) return;
    const candidate = i.application.candidate;
    sendMail(
      renderEmail({
        to: i.interviewer.user.email,
        subject: `Interview: ${candidate.firstName} ${candidate.lastName} on ${formatDateTime(i.scheduledAt)}`,
        heading: "You've been scheduled to interview",
        paragraphs: [`Hi ${i.interviewer.firstName}, you're on the panel for this interview.`],
        details: [
          ["Candidate", `${candidate.firstName} ${candidate.lastName}`],
          ["Role", i.application.jobPosting.title],
          ["When", formatDateTime(i.scheduledAt)],
          ...(i.meetingLink ? ([["Meeting link", i.meetingLink]] as [string, string][]) : []),
          ...(i.location ? ([["Location", i.location]] as [string, string][]) : []),
        ],
        action: { label: "Open hiring", path: "/hiring" },
      }),
    );
  });
}

/**
 * Sent when payslips are *published* (Payroll 4.3.1). Publishing makes a
 * payslip visible; it does not mean the salary was paid (rule 03).
 */
export function notifyPayslipsPublished(payrollRunId: string) {
  return safely("payslips published", async () => {
    const run = await prisma.payrollRun.findUnique({
      where: { id: payrollRunId },
      include: {
        payslips: {
          where: { publishedAt: { not: null }, supersededAt: null },
          include: { employee: employeeWithEmail },
        },
      },
    });
    if (!run) return;
    const period = `${MONTHS[run.month - 1]} ${run.year}`;
    sendMail(
      run.payslips.map((p) =>
        renderEmail({
          to: p.employee.user.email,
          subject: `Your payslip for ${period} is ready`,
          heading: `Payslip for ${period}`,
          paragraphs: [
            `Hi ${p.employee.firstName}, your payslip is now available.`,
            "A published payslip records what was calculated for the period. It is not confirmation that the salary has been paid.",
          ],
          details: [
            ["Gross pay", formatMoney(p.grossPay)],
            ["Deductions", formatMoney(p.deductions)],
            ["Net pay", formatMoney(p.netPay)],
            ["Paid days", `${p.paidDays} of ${p.payableDays}`],
          ],
          action: { label: "View payslip", path: "/payslips" },
        }),
      ),
    );
  });
}

const TICKET_STATUS_TEXT: Record<string, string> = {
  IN_PROGRESS: "is being worked on",
  WAITING: "is waiting for your reply",
  RESOLVED: "has been resolved",
  CLOSED: "has been closed",
  OPEN: "has been reopened",
};

export function notifyTicketUpdated(ticketId: string) {
  return safely("ticket updated", async () => {
    const t = await prisma.helpDeskTicket.findUnique({ where: { id: ticketId }, include: { employee: employeeWithEmail } });
    if (!t) return;
    const statusText = TICKET_STATUS_TEXT[t.status] ?? `is now ${t.status.toLowerCase()}`;
    sendMail(
      renderEmail({
        to: t.employee.user.email,
        subject: `Your help desk ticket ${statusText}`,
        heading: `"${t.subject}" ${statusText}`,
        paragraphs: [`Hi ${t.employee.firstName}, there's an update on your help desk ticket.`],
        details: [
          ["Ticket", t.reference],
          ["Subject", t.subject],
        ],
        action: { label: "View ticket", path: "/helpdesk" },
      }),
    );
  });
}

/** A new reply on a ticket. Internal notes are never mailed to the requester. */
export function notifyTicketReplied(replyId: string) {
  return safely("ticket replied", async () => {
    const reply = await prisma.helpDeskReply.findUnique({
      where: { id: replyId },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
        ticket: { include: { employee: employeeWithEmail, assignedTo: employeeWithEmail } },
      },
    });
    if (!reply || reply.internal) return;
    const t = reply.ticket;
    const authoredByRequester = reply.author.id === t.employeeId;
    const recipient = authoredByRequester
      ? t.assignedTo
        ? { email: t.assignedTo.user.email, firstName: t.assignedTo.firstName }
        : null
      : { email: t.employee.user.email, firstName: t.employee.firstName };
    if (!recipient) return;

    const preview = reply.body.length > 600 ? `${reply.body.slice(0, 600)}…` : reply.body;
    sendMail(
      renderEmail({
        to: recipient.email,
        subject: `New reply on ${t.reference}: ${t.subject}`,
        heading: `New reply on "${t.subject}"`,
        paragraphs: [`Hi ${recipient.firstName},`, preview, `— ${reply.author.firstName} ${reply.author.lastName}`],
        details: [["Ticket", t.reference]],
        action: { label: "View ticket", path: "/helpdesk" },
      }),
    );
  });
}

export function notifyAnnouncement(announcementId: string) {
  return safely("announcement", async () => {
    const a = await prisma.announcement.findUnique({
      where: { id: announcementId },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!a) return;
    const recipients = await prisma.employee.findMany({
      where: { organizationId: a.organizationId, status: { not: "EXITED" }, id: { not: a.author.id } },
      select: { firstName: true, user: { select: { email: true } } },
    });
    const preview = a.body.length > 600 ? `${a.body.slice(0, 600)}…` : a.body;
    sendMail(
      recipients.map((r) =>
        renderEmail({
          to: r.user.email,
          subject: `Announcement: ${a.title}`,
          heading: a.title,
          paragraphs: [preview, `— ${a.author.firstName} ${a.author.lastName}`],
          action: { label: "Read on WorkEasy360", path: "/dashboard" },
        }),
      ),
    );
  });
}
