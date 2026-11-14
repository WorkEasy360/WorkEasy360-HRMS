import { Prisma, type TicketQueue } from "@prisma/client";
import { Request, Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";
import { assertInOrg } from "../../utils/tenant";
import { notifyTicketReplied, notifyTicketUpdated } from "../../utils/notifications";

const router = Router();
router.use(requireAuth);

/**
 * Helpdesk (06). HRMS reuses the shared Unified Helpdesk model: one ticket
 * record, replies on the same ticket, and a sanitized product escalation as a
 * *separate* linked case. There is no second ticket system here.
 */

function requireSelfEmployee(req: Request): string {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");
  return employeeId;
}

/** Queues this user may work in (Helpdesk permissions 01). */
function agentQueues(req: Request): TicketQueue[] {
  const queues: TicketQueue[] = [];
  if (req.user!.permissions.includes(PERMISSIONS.HELPDESK_MANAGE)) queues.push("HR", "PRODUCT");
  if (req.user!.permissions.includes(PERMISSIONS.HELPDESK_PAYROLL_QUEUE)) queues.push("PAYROLL");
  return queues;
}

const TICKET_LIST_SELECT = {
  id: true,
  reference: true,
  type: true,
  queue: true,
  subject: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  reopenRequestedAt: true,
  escalatedFromId: true,
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.HelpDeskTicketSelect;

/**
 * A short, readable ticket id (6.1.3), unique per organization. Generated from
 * a per-organization counter and retried on collision.
 */
async function nextReference(organizationId: string, type: "HR_QUESTION" | "PRODUCT_PROBLEM"): Promise<string> {
  const prefix = type === "PRODUCT_PROBLEM" ? "PRD" : "HR";
  const year = new Date().getUTCFullYear();
  const count = await prisma.helpDeskTicket.count({ where: { organizationId } });
  return `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
}

// ─── My tickets (6.2) ──────────────────────────────────────────────────────

router.get("/me", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const { status } = req.query as { status?: string };
  const tickets = await prisma.helpDeskTicket.findMany({
    where: { employeeId, ...(status ? { status: status as never } : {}) },
    select: TICKET_LIST_SELECT,
    orderBy: { updatedAt: "desc" },
  });
  return res.json(tickets);
});

// ─── Team queue (6.3), authorized agents only ──────────────────────────────

router.get("/", async (req, res) => {
  const queues = agentQueues(req);
  if (queues.length === 0) return res.status(403).json({ error: "You don't have access to a help desk queue" });

  const { status, queue } = req.query as { status?: string; queue?: string };
  // A queue filter can only narrow what this agent is already allowed to see.
  const scope = queue && queues.includes(queue as TicketQueue) ? [queue as TicketQueue] : queues;

  const tickets = await prisma.helpDeskTicket.findMany({
    where: {
      organizationId: req.user!.organizationId,
      queue: { in: scope },
      ...(status ? { status: status as never } : {}),
    },
    select: TICKET_LIST_SELECT,
    orderBy: { updatedAt: "desc" },
  });
  return res.json({ queues, tickets });
});

// ─── One ticket, with its thread ───────────────────────────────────────────

/** Whether this user may read a ticket, and whether they read it as an agent. */
async function access(req: Request, ticketId: string) {
  const ticket = await prisma.helpDeskTicket.findFirst({
    where: { id: ticketId, organizationId: req.user!.organizationId },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      escalations: { select: { id: true, reference: true, status: true, queue: true } },
      escalatedFrom: { select: { id: true, reference: true } },
    },
  });
  if (!ticket) throw new HttpError(404, "Ticket not found");

  const isOwner = ticket.employeeId === req.user!.employeeId;
  const isAgent = agentQueues(req).includes(ticket.queue);
  if (!isOwner && !isAgent) throw new HttpError(403, "You don't have access to this ticket");
  return { ticket, isOwner, isAgent };
}

router.get("/:id", async (req, res) => {
  const { ticket, isAgent } = await access(req, req.params.id);
  const replies = await prisma.helpDeskReply.findMany({
    // Internal notes keep their audience (permissions 03).
    where: { ticketId: ticket.id, ...(isAgent ? {} : { internal: false }) },
    include: { author: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return res.json({ ticket, replies, canAgent: isAgent });
});

// ─── Raise a ticket (6.1) ──────────────────────────────────────────────────

// Exported so the AI assistant validates a proposed action with exactly these rules.
export const createSchema = z.object({
  type: z.enum(["HR_QUESTION", "PRODUCT_PROBLEM"]),
  /** HR questions about salary or payslips go to the restricted payroll queue. */
  aboutPayroll: z.boolean().optional(),
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
});

router.post("/", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const organizationId = req.user!.organizationId;

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { type, aboutPayroll, subject, description } = parsed.data;

  // Routing 01 and 02: HR questions stay with the employer (payroll questions
  // in the restricted queue); product problems go to the product queue.
  const queue: TicketQueue = type === "PRODUCT_PROBLEM" ? "PRODUCT" : aboutPayroll ? "PAYROLL" : "HR";

  let ticket = null;
  for (let attempt = 0; attempt < 5 && !ticket; attempt += 1) {
    try {
      ticket = await prisma.helpDeskTicket.create({
        data: {
          organizationId,
          employeeId,
          reference: await nextReference(organizationId, type),
          type,
          queue,
          subject,
          description,
        },
        select: TICKET_LIST_SELECT,
      });
    } catch (err) {
      // Two people submitting at once can land on the same counter value.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  if (!ticket) throw new HttpError(503, "Could not allocate a ticket number. Please try again.");

  return res.status(201).json(ticket);
});

// ─── Replies (6.2.2, 6.3.2) ────────────────────────────────────────────────

const replySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  internal: z.boolean().optional(),
});

router.post("/:id/replies", async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { ticket, isAgent } = await access(req, req.params.id);
  const authorId = requireSelfEmployee(req);

  // Only an agent can leave an internal note.
  const internal = !!parsed.data.internal && isAgent;

  const reply = await prisma.$transaction(async (tx) => {
    const created = await tx.helpDeskReply.create({
      data: { organizationId: ticket.organizationId, ticketId: ticket.id, authorId, body: parsed.data.body, internal },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!internal) await tx.helpDeskTicket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
    return created;
  });

  void notifyTicketReplied(reply.id);
  return res.status(201).json(reply);
});

// ─── Requester actions (6.2.2) ─────────────────────────────────────────────

router.post("/:id/request-reopen", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const { count } = await prisma.helpDeskTicket.updateMany({
    where: {
      id: req.params.id,
      organizationId: req.user!.organizationId,
      employeeId,
      status: { in: ["RESOLVED", "CLOSED"] },
      reopenRequestedAt: null,
    },
    data: { reopenRequestedAt: new Date() },
  });
  if (!count) return res.status(409).json({ error: "Only a resolved or closed ticket can be reopened, and only once" });
  return res.json({ requested: true });
});

// ─── Agent actions (6.3.1, 6.3.2) ──────────────────────────────────────────

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
});

router.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { ticket, isAgent } = await access(req, req.params.id);
  if (!isAgent) return res.status(403).json({ error: "Only an authorized agent can update this ticket" });

  await assertInOrg("employee", parsed.data.assignedToId, req.user!.organizationId, "Assignee");

  const closing = parsed.data.status === "RESOLVED" || parsed.data.status === "CLOSED";
  const updated = await prisma.helpDeskTicket.update({
    where: { id: ticket.id },
    data: {
      ...parsed.data,
      resolvedAt: closing ? new Date() : parsed.data.status ? null : ticket.resolvedAt,
      ...(parsed.data.status === "OPEN" ? { reopenRequestedAt: null } : {}),
    },
    select: TICKET_LIST_SELECT,
  });

  // Resolving a ticket is never a leave approval or a payroll change (routing 05).
  if (updated.status !== ticket.status) void notifyTicketUpdated(updated.id);
  return res.json(updated);
});

// ─── Sanitized product escalation (6.3.3) ──────────────────────────────────

const escalateSchema = z.object({
  /** Explicitly reviewed text. Only this crosses the boundary. */
  summary: z.string().trim().min(10).max(5000),
  subject: z.string().trim().min(1).max(200).optional(),
});

/**
 * Creates a *separate* linked product ticket carrying only the summary an agent
 * explicitly reviewed. The private HR conversation, its replies and any payroll
 * documents are never copied across (routing 04, permissions 04).
 */
router.post("/:id/escalate", async (req, res) => {
  const parsed = escalateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { ticket, isAgent } = await access(req, req.params.id);
  if (!isAgent) return res.status(403).json({ error: "Only an authorized agent can escalate this ticket" });
  if (ticket.queue === "PRODUCT") {
    return res.status(409).json({ error: "This is already a product ticket. Ordinary escalation keeps the same ticket." });
  }

  const existing = await prisma.helpDeskTicket.findFirst({
    where: { organizationId: ticket.organizationId, escalatedFromId: ticket.id },
    select: { id: true, reference: true },
  });
  // One linked case per source ticket, so a retry can't duplicate it.
  if (existing) return res.status(409).json({ error: `Already escalated as ${existing.reference}` });

  const organizationId = ticket.organizationId;
  const linked = await prisma.helpDeskTicket.create({
    data: {
      organizationId,
      employeeId: requireSelfEmployee(req),
      reference: await nextReference(organizationId, "PRODUCT_PROBLEM"),
      type: "PRODUCT_PROBLEM",
      queue: "PRODUCT",
      subject: parsed.data.subject ?? `Product issue behind ${ticket.reference}`,
      description: parsed.data.summary,
      escalatedFromId: ticket.id,
      escalationSummary: parsed.data.summary,
    },
    select: TICKET_LIST_SELECT,
  });

  return res.status(201).json(linked);
});

export default router;
