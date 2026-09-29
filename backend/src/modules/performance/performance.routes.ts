import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { PERMISSIONS } from "../../utils/permissions";
import { isActiveEmployee } from "../../utils/tenant";

const router = Router();
router.use(requireAuth);

router.get("/cycles", async (req, res) => {
  const cycles = await prisma.reviewCycle.findMany({
    where: { organizationId: req.user!.organizationId },
    orderBy: { startDate: "desc" },
  });
  return res.json(cycles);
});

const createCycleSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((d) => d.endDate >= d.startDate, { message: "endDate must be on or after startDate", path: ["endDate"] });

// Creating a cycle immediately opens a review for every active employee,
// assigning their current manager as reviewer (self-assessment only if none).
router.post("/cycles", requirePermission(PERMISSIONS.PERFORMANCE_MANAGE), async (req, res) => {
  const parsed = createCycleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const cycle = await prisma.$transaction(async (tx) => {
    const created = await tx.reviewCycle.create({
      data: { organizationId, ...parsed.data, status: "ACTIVE" },
    });

    const employees = await tx.employee.findMany({ where: { organizationId, status: "ACTIVE" } });
    await tx.performanceReview.createMany({
      data: employees.map((e) => ({
        organizationId,
        cycleId: created.id,
        employeeId: e.id,
        reviewerId: e.managerId,
      })),
    });

    return created;
  });

  return res.status(201).json(cycle);
});

router.get("/reviews/me", async (req, res) => {
  const employeeId = req.user!.employeeId;
  const reviews = await prisma.performanceReview.findMany({
    where: { employeeId: employeeId ?? "__none__" },
    include: { cycle: true },
    orderBy: { createdAt: "desc" },
  });
  return res.json(reviews);
});

router.get("/reviews/team", async (req, res) => {
  const canManageAll = req.user!.permissions.includes(PERMISSIONS.PERFORMANCE_MANAGE);
  const reviews = await prisma.performanceReview.findMany({
    where: {
      organizationId: req.user!.organizationId,
      ...(canManageAll ? {} : { reviewerId: req.user!.employeeId ?? "__none__" }),
    },
    include: { cycle: true, employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json(reviews);
});

const selfSchema = z.object({ selfAssessment: z.string().trim().min(1).max(5000) });

router.patch("/reviews/me/:id", async (req, res) => {
  const parsed = selfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const review = await prisma.performanceReview.findFirst({
    where: { id: req.params.id, employeeId: req.user!.employeeId ?? "__none__" },
  });
  if (!review) return res.status(404).json({ error: "Review not found" });
  if (review.status === "COMPLETED") return res.status(409).json({ error: "Review already completed" });

  const updated = await prisma.performanceReview.update({
    where: { id: review.id },
    data: {
      selfAssessment: parsed.data.selfAssessment,
      status: review.status === "PENDING" ? "SELF_SUBMITTED" : review.status,
    },
  });
  return res.json(updated);
});

const managerSchema = z.object({ managerAssessment: z.string().trim().min(1).max(5000), rating: z.number().int().min(1).max(5) });

router.patch("/reviews/:id/manager", async (req, res) => {
  const parsed = managerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const review = await prisma.performanceReview.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!review) return res.status(404).json({ error: "Review not found" });
  if (review.status === "COMPLETED") return res.status(409).json({ error: "Review already completed" });

  if (req.user!.employeeId && review.employeeId === req.user!.employeeId) {
    return res.status(403).json({ error: "You can't rate your own review" });
  }

  const canManageAll = req.user!.permissions.includes(PERMISSIONS.PERFORMANCE_MANAGE);
  const isReviewer =
    !!req.user!.employeeId &&
    review.reviewerId === req.user!.employeeId &&
    (await isActiveEmployee(req.user!.employeeId, req.user!.organizationId));
  if (!canManageAll && !isReviewer) {
    return res.status(403).json({ error: "Not authorized to review this employee" });
  }

  const updated = await prisma.performanceReview.update({
    where: { id: review.id },
    data: {
      managerAssessment: parsed.data.managerAssessment,
      rating: parsed.data.rating,
      status: "COMPLETED",
      reviewerId: review.reviewerId ?? req.user!.employeeId,
    },
  });
  return res.json(updated);
});

export default router;
