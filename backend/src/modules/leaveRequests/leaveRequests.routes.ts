import { Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { assertCanDecideRequest, resolveApprovalRoute, type ApprovalPermissions } from "../../utils/approvals";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";
import { countWorkingDays, getWorkSchedule } from "../../utils/workSchedule";
import { notifyLeaveRequested, notifyLeaveDecided } from "../../utils/notifications";

const router = Router();
router.use(requireAuth);

export const LEAVE_PERMISSIONS: ApprovalPermissions = {
  approve: PERMISSIONS.LEAVE_APPROVE,
  manage: PERMISSIONS.LEAVE_MANAGE,
};

function requireSelfEmployee(req: Request): string {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");
  return employeeId;
}

router.get("/me", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const requests = await prisma.leaveRequest.findMany({
    where: { employeeId },
    include: { leaveType: true },
    orderBy: { createdAt: "desc" },
  });
  return res.json(requests);
});

// Requests awaiting *this* user's decision. Authorized HR see every pending
// request; a manager sees only their own direct reports (rule 07).
router.get("/pending-approvals", async (req, res) => {
  const organizationId = req.user!.organizationId;
  const canManageAll = req.user!.permissions.includes(PERMISSIONS.LEAVE_MANAGE);
  const canApproveReports = req.user!.permissions.includes(PERMISSIONS.LEAVE_APPROVE);
  if (!canManageAll && !canApproveReports) return res.json([]);

  const requests = await prisma.leaveRequest.findMany({
    where: {
      organizationId,
      status: "PENDING",
      // Never show your own request: you can't approve it (rule 08).
      employee: canManageAll
        ? { id: { not: req.user!.employeeId ?? "__none__" } }
        : { managerId: req.user!.employeeId ?? "__none__" },
    },
    include: { leaveType: true, employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { createdAt: "asc" },
  });
  return res.json(requests);
});

// Exported so the AI assistant validates a proposed action with exactly these rules.
export const createSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    reason: z.string().trim().max(5000).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, { message: "endDate must be on or after startDate", path: ["endDate"] });

router.post("/", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const organizationId = req.user!.organizationId;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { leaveTypeId, startDate, endDate, reason } = parsed.data;

  const [leaveType, schedule] = await Promise.all([
    prisma.leaveType.findFirst({ where: { id: leaveTypeId, organizationId } }),
    getWorkSchedule(organizationId, { from: startDate, to: endDate }),
  ]);
  if (!leaveType) {
    return res.status(404).json({ error: "Leave type not found" });
  }

  // Working days only: weekly offs and holidays are not leave (rule 05).
  const days = countWorkingDays(startDate, endDate, schedule);
  if (days === 0) {
    return res.status(400).json({ error: "That range has no working days. Check the organization's work schedule." });
  }

  const overlapping = await prisma.leaveRequest.findFirst({
    where: {
      employeeId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true },
  });
  if (overlapping) {
    return res.status(409).json({ error: "You already have leave booked in that period" });
  }

  const balance = await prisma.leaveBalance.findUnique({
    where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year: startDate.getFullYear() } },
  });
  if (balance && leaveType.defaultDaysPerYear > 0) {
    const remaining = balance.allocatedDays - balance.usedDays;
    if (remaining < days) {
      return res
        .status(409)
        .json({ error: `Insufficient ${leaveType.name} balance: ${remaining} day(s) remaining, ${days} requested` });
    }
  }

  // Routed now so a missing approver is visible on the request itself (rule 08).
  const route = await resolveApprovalRoute(organizationId, employeeId, LEAVE_PERMISSIONS);

  const request = await prisma.leaveRequest.create({
    data: {
      organizationId,
      employeeId,
      leaveTypeId,
      startDate,
      endDate,
      days,
      reason,
      routingNote: route.routingNote,
    },
    include: { leaveType: true },
  });
  void notifyLeaveRequested(request.id);
  return res.status(201).json(request);
});

/**
 * Cancel. A pending request simply closes; an approved one gives the balance
 * back, exactly once (rule 04).
 */
router.post("/:id/cancel", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const request = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, employeeId } });
  if (!request) return res.status(404).json({ error: "Leave request not found" });
  if (request.status !== "PENDING" && request.status !== "APPROVED") {
    return res.status(409).json({ error: "Only pending or approved requests can be cancelled" });
  }
  if (request.status === "APPROVED" && request.endDate < new Date()) {
    return res.status(409).json({ error: "Leave that has already been taken can't be cancelled. Ask HR for a correction." });
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Conditional transition: a repeat call can't release the balance twice.
    const { count } = await tx.leaveRequest.updateMany({
      where: { id: request.id, employeeId, status: request.status },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });
    if (!count) throw new HttpError(409, "Request has already been updated");

    if (request.status === "APPROVED") {
      await tx.leaveBalance.updateMany({
        where: { employeeId, leaveTypeId: request.leaveTypeId, year: request.startDate.getFullYear() },
        data: { usedDays: { decrement: request.days } },
      });
    }
    return tx.leaveRequest.findUniqueOrThrow({ where: { id: request.id }, include: { leaveType: true } });
  });

  return res.json(updated);
});

const decisionSchema = z.object({ decisionNote: z.string().trim().max(5000).optional() });

async function decide(req: Request, res: Response, approve: boolean) {
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const organizationId = req.user!.organizationId;

  const request = await prisma.leaveRequest.findFirst({
    where: { id: req.params.id, organizationId },
    include: { employee: true },
  });
  if (!request) return res.status(404).json({ error: "Leave request not found" });
  if (request.status !== "PENDING") {
    return res.status(409).json({ error: "Request has already been decided" });
  }

  // Manager with the approval permission, or authorized HR; never yourself.
  await assertCanDecideRequest({
    organizationId,
    reviewerEmployeeId: req.user!.employeeId,
    requesterEmployeeId: request.employeeId,
    permissions: LEAVE_PERMISSIONS,
  });

  const updated = await prisma.$transaction(async (tx) => {
    // Conditional transition: only one concurrent decision can win, so a repeat
    // action can never apply the balance twice (rule 08).
    const { count } = await tx.leaveRequest.updateMany({
      where: { id: request.id, organizationId, status: "PENDING" },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        approverId: req.user!.employeeId,
        decisionNote: parsed.data.decisionNote,
        decidedAt: new Date(),
        routingNote: null,
      },
    });
    if (!count) throw new HttpError(409, "Request has already been decided");

    const decided = await tx.leaveRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { leaveType: true },
    });

    if (approve) {
      const year = decided.startDate.getFullYear();
      const balanceKey = { employeeId: decided.employeeId, leaveTypeId: decided.leaveTypeId, year };
      const hadBalance = await tx.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: balanceKey } });
      const balance = await tx.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: balanceKey },
        create: {
          organizationId,
          employeeId: decided.employeeId,
          leaveTypeId: decided.leaveTypeId,
          year,
          allocatedDays: decided.leaveType.defaultDaysPerYear,
          usedDays: decided.days,
        },
        update: { usedDays: { increment: decided.days } },
      });
      // Re-check after the increment (row-locked), so concurrent approvals can't overdraw.
      if (hadBalance && decided.leaveType.defaultDaysPerYear > 0 && balance.usedDays > balance.allocatedDays) {
        const remaining = balance.allocatedDays - (balance.usedDays - decided.days);
        throw new HttpError(409, `Insufficient leave balance: ${remaining} day(s) remaining, ${decided.days} requested`);
      }
    }

    return decided;
  });

  void notifyLeaveDecided(updated.id);
  return res.json(updated);
}

router.post("/:id/approve", (req, res) => decide(req, res, true));
router.post("/:id/reject", (req, res) => decide(req, res, false));

export default router;
