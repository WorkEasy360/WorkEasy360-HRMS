import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { createEmployeeWithUser } from "../../utils/createEmployee";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";
import { assertInOrg } from "../../utils/tenant";
import { notifyInterviewScheduled } from "../../utils/notifications";

const router = Router();
router.use(requireAuth);

// --- Job postings ---

router.get("/postings", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const postings = await prisma.jobPosting.findMany({
    where: { organizationId: req.user!.organizationId },
    include: { department: true, _count: { select: { candidates: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json(postings);
});

const createPostingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  departmentId: z.string().uuid().optional(),
});

router.post("/postings", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const parsed = createPostingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await assertInOrg("department", parsed.data.departmentId, req.user!.organizationId, "Department");

  const posting = await prisma.jobPosting.create({
    data: { organizationId: req.user!.organizationId, postedById: employeeId, ...parsed.data },
  });
  return res.status(201).json(posting);
});

const updatePostingSchema = z.object({ status: z.enum(["OPEN", "CLOSED"]) });

router.patch("/postings/:id", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const parsed = updatePostingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const posting = await prisma.jobPosting.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!posting) return res.status(404).json({ error: "Job posting not found" });

  const updated = await prisma.jobPosting.update({ where: { id: posting.id }, data: parsed.data });
  return res.json(updated);
});

// --- Candidates ---

router.get("/candidates", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const { jobPostingId } = req.query as { jobPostingId?: string };
  const candidates = await prisma.candidate.findMany({
    where: { organizationId: req.user!.organizationId, ...(jobPostingId ? { jobPostingId } : {}) },
    include: { jobPosting: { select: { title: true } }, interviews: true },
    orderBy: { createdAt: "desc" },
  });
  return res.json(candidates);
});

const createCandidateSchema = z.object({
  jobPostingId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).optional(),
  source: z.string().trim().max(200).optional(),
});

router.post("/candidates", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const parsed = createCandidateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const posting = await prisma.jobPosting.findFirst({ where: { id: parsed.data.jobPostingId, organizationId } });
  if (!posting) return res.status(404).json({ error: "Job posting not found" });

  const candidate = await prisma.candidate.create({ data: { organizationId, ...parsed.data } });
  return res.status(201).json(candidate);
});

const updateCandidateSchema = z.object({
  // HIRED is intentionally absent: hiring must go through POST /candidates/:id/hire.
  stage: z.enum(["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED"]).optional(),
  notes: z.string().trim().max(5000).optional(),
});

router.patch("/candidates/:id", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const parsed = updateCandidateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const candidate = await prisma.candidate.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  if (candidate.stage === "HIRED") return res.status(409).json({ error: "Candidate has already been hired" });

  const updated = await prisma.candidate.update({ where: { id: candidate.id }, data: parsed.data });
  return res.json(updated);
});

const hireSchema = z.object({
  designation: z.string().trim().max(200).optional(),
  departmentId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  dateOfJoining: z.coerce.date().optional(),
});

// Converts a candidate into a real Employee (creates User + Employee, seeds
// onboarding tasks, fires the EMPLOYEE_ONBOARDED automation) and marks HIRED.
router.post("/candidates/:id/hire", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const parsed = hireSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const candidate = await prisma.candidate.findFirst({ where: { id: req.params.id, organizationId } });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  if (candidate.stage === "HIRED") return res.status(409).json({ error: "Candidate has already been hired" });

  const { employee, tempPassword, inviteSent } = await createEmployeeWithUser(organizationId, {
    email: candidate.email,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    ...parsed.data,
  });

  const updatedCandidate = await prisma.candidate.update({
    where: { id: candidate.id },
    data: { stage: "HIRED", hiredEmployeeId: employee.id },
  });

  return res.status(201).json({ candidate: updatedCandidate, employee, tempPassword, inviteSent });
});

// --- Interviews ---

router.get("/interviews/me", async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const interviews = await prisma.interview.findMany({
    where: { interviewerId: employeeId },
    include: { candidate: { select: { firstName: true, lastName: true, jobPosting: { select: { title: true } } } } },
    orderBy: { scheduledAt: "asc" },
  });
  return res.json(interviews);
});

const scheduleInterviewSchema = z.object({
  interviewerId: z.string().uuid(),
  scheduledAt: z.coerce.date(),
});

router.post("/candidates/:id/interviews", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const parsed = scheduleInterviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const candidate = await prisma.candidate.findFirst({ where: { id: req.params.id, organizationId } });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const interviewer = await prisma.employee.findFirst({ where: { id: parsed.data.interviewerId, organizationId } });
  if (!interviewer) return res.status(404).json({ error: "Interviewer not found" });

  const interview = await prisma.interview.create({
    data: { organizationId, candidateId: candidate.id, ...parsed.data },
  });
  void notifyInterviewScheduled(interview.id);
  return res.status(201).json(interview);
});

const feedbackSchema = z.object({ feedback: z.string().trim().min(1).max(5000), rating: z.number().int().min(1).max(5) });

router.patch("/interviews/:id", async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const interview = await prisma.interview.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!interview) return res.status(404).json({ error: "Interview not found" });

  const canManageAll = req.user!.permissions.includes(PERMISSIONS.RECRUITMENT_MANAGE);
  if (!canManageAll && interview.interviewerId !== req.user!.employeeId) {
    return res.status(403).json({ error: "Not authorized to submit feedback for this interview" });
  }

  const updated = await prisma.interview.update({ where: { id: interview.id }, data: parsed.data });
  return res.json(updated);
});

export default router;
