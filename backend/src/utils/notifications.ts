import { prisma } from "../config/prisma";
import { renderEmail } from "./emailTemplates";
import { sendMail } from "./mailer";
import { PERMISSIONS, type PermissionKey } from "./permissions";

// Every notification is best-effort: it runs after the request, loads what it needs,
// and swallows its own errors. Call as `void notifyX(...)`.

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

type Person = { firstName: string; user: { email: string } };

/**
 * Who should approve a request: the requester's manager if they have an active one,
 * otherwise the org's users holding the relevant manage permission (e.g. HR).
 */
async function approversFor(organizationId: string, employeeId: string, permission: PermissionKey): Promise<Person[]> {
  const requester = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { manager: { select: { status: true, firstName: true, user: { select: { email: true } } } } },
  });
  if (requester?.manager && requester.manager.status !== "EXITED") return [requester.manager];

  const users = await prisma.user.findMany({
    where: {
      organizationId,
      employee: { status: { not: "EXITED" }, id: { not: employeeId } },
      userRoles: { some: { role: { rolePermissions: { some: { permission: { key: permission } } } } } },
    },
    select: { email: true, employee: { select: { firstName: true } } },
    take: 20,
  });
  return users.map((u) => ({ firstName: u.employee?.firstName ?? "there", user: { email: u.email } }));
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
        `${p.organizationName} has set up your WorkEasy360 account. Use it for attendance, leave, payslips, expenses and more.`,
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

export function notifyLeaveRequested(leaveRequestId: string) {
  return safely("leave requested", async () => {
    const r = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { employee: employeeWithEmail, leaveType: { select: { name: true } } },
    });
    if (!r) return;
    const approvers = await approversFor(r.organizationId, r.employeeId, PERMISSIONS.LEAVE_MANAGE);
    const name = `${r.employee.firstName} ${r.employee.lastName}`;
    sendMail(
      approvers.map((a) =>
        renderEmail({
          to: a.user.email,
          subject: `Leave request from ${name}`,
          heading: `${name} requested leave`,
          paragraphs: [`Hi ${a.firstName}, a leave request is waiting for your approval.`],
          details: [
            ["Type", r.leaveType.name],
            ["Dates", `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`],
            ["Days", String(r.days)],
            ...(r.reason ? ([["Reason", r.reason]] as [string, string][]) : []),
          ],
          action: { label: "Review request", path: "/approvals" },
        }),
      ),
    );
  });
}

export function notifyExpenseSubmitted(expenseId: string) {
  return safely("expense submitted", async () => {
    const e = await prisma.expenseClaim.findUnique({ where: { id: expenseId }, include: { employee: employeeWithEmail } });
    if (!e) return;
    const approvers = await approversFor(e.organizationId, e.employeeId, PERMISSIONS.EXPENSE_MANAGE);
    const name = `${e.employee.firstName} ${e.employee.lastName}`;
    sendMail(
      approvers.map((a) =>
        renderEmail({
          to: a.user.email,
          subject: `Expense claim from ${name}`,
          heading: `${name} submitted an expense claim`,
          paragraphs: [`Hi ${a.firstName}, an expense claim is waiting for your approval.`],
          details: [
            ["Amount", formatMoney(e.amount, e.currency)],
            ["Category", e.category],
            ["Date", formatDate(e.expenseDate)],
            ...(e.description ? ([["Description", e.description]] as [string, string][]) : []),
          ],
          action: { label: "Review claim", path: "/approvals" },
        }),
      ),
    );
  });
}

export function notifyLoanRequested(loanId: string) {
  return safely("loan requested", async () => {
    const l = await prisma.loanRequest.findUnique({ where: { id: loanId }, include: { employee: employeeWithEmail } });
    if (!l) return;
    const approvers = await approversFor(l.organizationId, l.employeeId, PERMISSIONS.LOAN_MANAGE);
    const name = `${l.employee.firstName} ${l.employee.lastName}`;
    sendMail(
      approvers.map((a) =>
        renderEmail({
          to: a.user.email,
          subject: `Loan request from ${name}`,
          heading: `${name} requested a loan`,
          paragraphs: [`Hi ${a.firstName}, a loan request is waiting for your approval.`],
          details: [
            ["Amount", formatMoney(l.amount)],
            ["Repayment", `${l.emiMonths} monthly instalments`],
            ...(l.reason ? ([["Reason", l.reason]] as [string, string][]) : []),
          ],
          action: { label: "Review request", path: "/approvals" },
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
        path: "/my-leave",
      }),
    );
  });
}

export function notifyExpenseDecided(expenseId: string) {
  return safely("expense decided", async () => {
    const e = await prisma.expenseClaim.findUnique({ where: { id: expenseId }, include: { employee: employeeWithEmail } });
    if (!e) return;
    if (e.status === "REIMBURSED") {
      sendMail(
        renderEmail({
          to: e.employee.user.email,
          subject: "Your expense claim has been reimbursed",
          heading: "Expense reimbursed",
          paragraphs: [`Hi ${e.employee.firstName}, your expense claim has been marked as reimbursed.`],
          details: [
            ["Amount", formatMoney(e.amount, e.currency)],
            ["Category", e.category],
          ],
          action: { label: "View my expenses", path: "/my-expenses" },
        }),
      );
      return;
    }
    if (e.status !== "APPROVED" && e.status !== "REJECTED") return;
    sendMail(
      decisionEmail({
        to: e.employee.user.email,
        firstName: e.employee.firstName,
        what: "expense claim",
        approved: e.status === "APPROVED",
        details: [
          ["Amount", formatMoney(e.amount, e.currency)],
          ["Category", e.category],
        ],
        note: e.decisionNote,
        path: "/my-expenses",
      }),
    );
  });
}

export function notifyLoanDecided(loanId: string) {
  return safely("loan decided", async () => {
    const l = await prisma.loanRequest.findUnique({ where: { id: loanId }, include: { employee: employeeWithEmail } });
    if (!l || (l.status !== "ACTIVE" && l.status !== "APPROVED" && l.status !== "REJECTED")) return;
    const approved = l.status !== "REJECTED";
    sendMail(
      decisionEmail({
        to: l.employee.user.email,
        firstName: l.employee.firstName,
        what: "loan request",
        approved,
        details: [
          ["Amount", formatMoney(l.amount)],
          ...(approved && l.monthlyDeduction
            ? ([["Monthly deduction", `${formatMoney(l.monthlyDeduction)} × ${l.emiMonths} months`]] as [string, string][])
            : []),
        ],
        note: l.decisionNote,
        path: "/my-loans",
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
        candidate: { select: { firstName: true, lastName: true, jobPosting: { select: { title: true } } } },
      },
    });
    if (!i) return;
    sendMail(
      renderEmail({
        to: i.interviewer.user.email,
        subject: `Interview: ${i.candidate.firstName} ${i.candidate.lastName} on ${formatDateTime(i.scheduledAt)}`,
        heading: "You've been scheduled to interview",
        paragraphs: [`Hi ${i.interviewer.firstName}, you're on the panel for this interview.`],
        details: [
          ["Candidate", `${i.candidate.firstName} ${i.candidate.lastName}`],
          ["Role", i.candidate.jobPosting.title],
          ["When", formatDateTime(i.scheduledAt)],
        ],
        action: { label: "Open recruitment", path: "/recruitment" },
      }),
    );
  });
}

export function notifyPayslipsReady(payrollRunId: string) {
  return safely("payslips ready", async () => {
    const run = await prisma.payrollRun.findUnique({
      where: { id: payrollRunId },
      include: { payslips: { include: { employee: employeeWithEmail } } },
    });
    if (!run) return;
    const period = `${MONTHS[run.month - 1]} ${run.year}`;
    sendMail(
      run.payslips.map((p) =>
        renderEmail({
          to: p.employee.user.email,
          subject: `Your payslip for ${period} is ready`,
          heading: `Payslip for ${period}`,
          paragraphs: [`Hi ${p.employee.firstName}, your payslip is ready.`],
          details: [
            ["Gross pay", formatMoney(p.grossPay)],
            ["Deductions", formatMoney(p.deductions)],
            ["Net pay", formatMoney(p.netPay)],
          ],
          action: { label: "View payslip", path: "/my-payslips" },
        }),
      ),
    );
  });
}

const TICKET_STATUS_TEXT: Record<string, string> = {
  IN_PROGRESS: "is being worked on",
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
          ["Ticket", t.subject],
          ["Category", t.category],
        ],
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
          action: { label: "Read on WorkEasy360", path: "/announcements" },
        }),
      ),
    );
  });
}
