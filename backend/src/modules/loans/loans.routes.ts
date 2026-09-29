import { Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";
import { assertCanDecide } from "../../utils/tenant";
import { notifyLoanRequested, notifyLoanDecided } from "../../utils/notifications";

const router = Router();
router.use(requireAuth);

router.get("/me", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const loans = await prisma.loanRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
  return res.json(loans);
});

router.get("/pending-approvals", async (req, res) => {
  const organizationId = req.user!.organizationId;
  const canManageAll = req.user!.permissions.includes(PERMISSIONS.LOAN_MANAGE);

  const loans = await prisma.loanRequest.findMany({
    where: {
      organizationId,
      status: "PENDING",
      ...(canManageAll ? {} : { employee: { managerId: req.user!.employeeId ?? "__none__" } }),
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { createdAt: "asc" },
  });
  return res.json(loans);
});

router.get("/", requirePermission(PERMISSIONS.LOAN_MANAGE), async (req, res) => {
  const loans = await prisma.loanRequest.findMany({
    where: { organizationId: req.user!.organizationId },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json(loans);
});

const createSchema = z.object({
  amount: z.number().finite().positive().max(10_000_000),
  emiMonths: z.number().int().min(1).max(120),
  reason: z.string().trim().max(5000).optional(),
});

router.post("/", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const loan = await prisma.loanRequest.create({
    data: { organizationId: req.user!.organizationId, employeeId, ...parsed.data },
  });
  void notifyLoanRequested(loan.id);
  return res.status(201).json(loan);
});

const decisionSchema = z.object({ decisionNote: z.string().trim().max(5000).optional() });

async function decide(req: Request, res: Response, approve: boolean) {
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const loan = await prisma.loanRequest.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    include: { employee: true },
  });
  if (!loan) return res.status(404).json({ error: "Loan request not found" });
  if (loan.status !== "PENDING") return res.status(409).json({ error: "Loan has already been decided" });

  await assertCanDecide(
    req,
    { employeeId: loan.employeeId, managerId: loan.employee.managerId },
    PERMISSIONS.LOAN_MANAGE,
    "Not authorized to decide this loan request",
  );

  const monthlyDeduction = Math.round((loan.amount / loan.emiMonths) * 100) / 100;
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.loanRequest.updateMany({
      where: { id: loan.id, organizationId: req.user!.organizationId, status: "PENDING" },
      data: {
        status: approve ? "ACTIVE" : "REJECTED",
        approverId: req.user!.employeeId,
        decisionNote: parsed.data.decisionNote,
        decidedAt: new Date(),
        ...(approve ? { monthlyDeduction, remainingAmount: loan.amount } : {}),
      },
    });
    if (!count) throw new HttpError(409, "Loan has already been decided");
    return tx.loanRequest.findUniqueOrThrow({ where: { id: loan.id } });
  });
  void notifyLoanDecided(updated.id);
  return res.json(updated);
}

router.post("/:id/approve", (req, res) => decide(req, res, true));
router.post("/:id/reject", (req, res) => decide(req, res, false));

export default router;
