import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";
import { assertInOrg } from "../../utils/tenant";
import { notifyTicketUpdated } from "../../utils/notifications";

const router = Router();
router.use(requireAuth);

router.get("/me", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const tickets = await prisma.helpDeskTicket.findMany({
    where: { employeeId },
    include: { assignedTo: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json(tickets);
});

router.get("/", requirePermission(PERMISSIONS.HELPDESK_MANAGE), async (req, res) => {
  const { status } = req.query as { status?: string };
  const tickets = await prisma.helpDeskTicket.findMany({
    where: { organizationId: req.user!.organizationId, ...(status ? { status: status as never } : {}) },
    include: {
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
      assignedTo: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(tickets);
});

const createSchema = z.object({
  category: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
});

router.post("/", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const ticket = await prisma.helpDeskTicket.create({
    data: { organizationId: req.user!.organizationId, employeeId, ...parsed.data },
  });
  return res.status(201).json(ticket);
});

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
});

router.patch("/:id", requirePermission(PERMISSIONS.HELPDESK_MANAGE), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const ticket = await prisma.helpDeskTicket.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  await assertInOrg("employee", parsed.data.assignedToId, req.user!.organizationId, "Assignee");

  const resolvedStatuses = ["RESOLVED", "CLOSED"];
  const updated = await prisma.helpDeskTicket.update({
    where: { id: ticket.id },
    data: {
      ...parsed.data,
      resolvedAt: parsed.data.status && resolvedStatuses.includes(parsed.data.status) ? new Date() : ticket.resolvedAt,
    },
  });
  if (updated.status !== ticket.status) void notifyTicketUpdated(updated.id);
  return res.json(updated);
});

export default router;
