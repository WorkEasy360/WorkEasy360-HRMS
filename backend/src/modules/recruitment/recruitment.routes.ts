import { Prisma } from "@prisma/client";
import { Request, Router } from "express";
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

/**
 * Hiring (05). Authorized HR/Admin only, except that an assigned interviewer
 * may see and give feedback on their own interviews (rule 06). Resumes, notes
 * and contact details are never visible to ordinary employees (rule 05).
 */

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizePhone = (phone?: string | null) => {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits : null;
};

function requireSelfEmployee(req: Request): string {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");
  return employeeId;
}

// ─── Job openings (5.1) ────────────────────────────────────────────────────

router.get("/postings", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const postings = await prisma.jobPosting.findMany({
    where: { organizationId: req.user!.organizationId },
    include: {
      department: { select: { id: true, name: true } },
      hiringOwner: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { applications: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(postings);
});

// Exported so the AI assistant validates a proposed action with exactly these rules.
export const createPostingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  departmentId: z.string().uuid().optional(),
  location: z.string().trim().max(200).optional(),
  workMode: z.enum(["ONSITE", "HYBRID", "REMOTE"]).optional(),
  hiringOwnerId: z.string().uuid().optional(),
});

router.post("/postings", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const postedById = requireSelfEmployee(req);
  const organizationId = req.user!.organizationId;

  const parsed = createPostingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await assertInOrg("department", parsed.data.departmentId, organizationId, "Department");
  await assertInOrg("employee", parsed.data.hiringOwnerId, organizationId, "Hiring owner");

  const posting = await prisma.jobPosting.create({ data: { organizationId, postedById, ...parsed.data } });
  return res.status(201).json(posting);
});

const updatePostingSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  workMode: z.enum(["ONSITE", "HYBRID", "REMOTE"]).nullable().optional(),
  hiringOwnerId: z.string().uuid().nullable().optional(),
  status: z.enum(["OPEN", "ON_HOLD", "CLOSED"]).optional(),
});

router.patch("/postings/:id", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const parsed = updatePostingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const posting = await prisma.jobPosting.findFirst({ where: { id: req.params.id, organizationId } });
  if (!posting) return res.status(404).json({ error: "Job opening not found" });
  await assertInOrg("department", parsed.data.departmentId, organizationId, "Department");
  await assertInOrg("employee", parsed.data.hiringOwnerId, organizationId, "Hiring owner");

  const updated = await prisma.jobPosting.update({ where: { id: posting.id }, data: parsed.data });
  return res.json(updated);
});

// ─── Candidates and applications (5.2) ─────────────────────────────────────

const APPLICATION_SELECT = {
  id: true,
  stage: true,
  notes: true,
  joinedAt: true,
  hiredEmployeeId: true,
  createdAt: true,
  updatedAt: true,
  jobPosting: { select: { id: true, title: true, status: true } },
  hiringOwner: { select: { id: true, firstName: true, lastName: true } },
  candidate: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      source: true,
      notes: true,
      resumeFileName: true,
      createdAt: true,
    },
  },
  _count: { select: { interviews: true } },
} satisfies Prisma.JobApplicationSelect;

/** The candidate list is a list of applications: search and filter (5.2.2). */
router.get("/candidates", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const { jobPostingId, stage, hiringOwnerId, search } = req.query as Record<string, string | undefined>;

  const applications = await prisma.jobApplication.findMany({
    where: {
      organizationId: req.user!.organizationId,
      ...(jobPostingId ? { jobPostingId } : {}),
      ...(stage ? { stage: stage as never } : {}),
      ...(hiringOwnerId ? { hiringOwnerId } : {}),
      ...(search
        ? {
            candidate: {
              OR: [
                { firstName: { contains: search, mode: "insensitive" } },
                { lastName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    select: APPLICATION_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return res.json(applications);
});

/** Candidate details: the person, every application, and dated activity (5.2.3). */
router.get("/candidates/:id", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const candidate = await prisma.candidate.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      source: true,
      notes: true,
      resumeFileName: true,
      resumeMimeType: true,
      createdAt: true,
      applications: {
        select: {
          ...APPLICATION_SELECT,
          interviews: {
            select: {
              id: true,
              scheduledAt: true,
              location: true,
              meetingLink: true,
              feedback: true,
              decision: true,
              interviewer: { select: { id: true, firstName: true, lastName: true } },
            },
            orderBy: { scheduledAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  return res.json(candidate);
});

/** Resume download. Hiring staff only — never an ordinary employee (rule 05). */
router.get("/candidates/:id/resume", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const candidate = await prisma.candidate.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    select: { resumeFileName: true, resumeMimeType: true, resumeContent: true },
  });
  if (!candidate?.resumeContent) return res.status(404).json({ error: "No resume on file" });

  res.setHeader("Content-Type", candidate.resumeMimeType ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(candidate.resumeFileName ?? "resume")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.send(Buffer.from(candidate.resumeContent));
});

const createCandidateSchema = z.object({
  jobPostingId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).optional(),
  source: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(5000).optional(),
  hiringOwnerId: z.string().uuid().optional(),
  resume: z
    .object({
      fileName: z.string().trim().min(1).max(255),
      mimeType: z.string().trim().min(1).max(127),
      contentBase64: z.string().max(Math.ceil((MAX_RESUME_BYTES * 4) / 3) + 1024),
    })
    .optional(),
});

/**
 * Add a candidate to a job (5.2.1). The person is reused across jobs: a
 * matching normalized email is the same candidate, with a new application
 * (rule 02). Manual entry and an optional resume upload — there is no public
 * careers portal or resume parsing in this release (rule 01).
 */
router.post("/candidates", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const parsed = createCandidateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;
  const { jobPostingId, resume, hiringOwnerId, ...person } = parsed.data;

  const posting = await prisma.jobPosting.findFirst({ where: { id: jobPostingId, organizationId } });
  if (!posting) return res.status(404).json({ error: "Job opening not found" });
  await assertInOrg("employee", hiringOwnerId, organizationId, "Hiring owner");

  let resumeData: { resumeFileName: string; resumeMimeType: string; resumeContent: Buffer } | undefined;
  if (resume) {
    const content = Buffer.from(resume.contentBase64, "base64");
    if (content.length === 0) return res.status(400).json({ error: "The resume file is empty" });
    if (content.length > MAX_RESUME_BYTES) {
      return res.status(413).json({ error: "Resume must be 5 MB or smaller" });
    }
    resumeData = { resumeFileName: resume.fileName, resumeMimeType: resume.mimeType, resumeContent: content };
  }

  const normalizedEmail = normalizeEmail(person.email);
  const normalizedPhone = normalizePhone(person.phone);

  const result = await prisma.$transaction(async (tx) => {
    // One person row per normalized email, so re-applying never duplicates them.
    const candidate = await tx.candidate.upsert({
      where: { organizationId_normalizedEmail: { organizationId, normalizedEmail } },
      create: { organizationId, ...person, normalizedEmail, normalizedPhone, ...resumeData },
      update: {
        firstName: person.firstName,
        lastName: person.lastName,
        phone: person.phone,
        normalizedPhone,
        ...(person.source ? { source: person.source } : {}),
        ...(resumeData ?? {}),
      },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true },
    });

    const existing = await tx.jobApplication.findUnique({
      where: { candidateId_jobPostingId: { candidateId: candidate.id, jobPostingId } },
      select: { id: true },
    });
    if (existing) throw new HttpError(409, "This candidate has already applied to that job opening");

    const application = await tx.jobApplication.create({
      data: {
        organizationId,
        candidateId: candidate.id,
        jobPostingId,
        hiringOwnerId: hiringOwnerId ?? posting.hiringOwnerId,
        notes: person.notes,
      },
      select: APPLICATION_SELECT,
    });
    return { candidate, application };
  });

  // Warn (don't block) when the same phone belongs to a different person.
  const phoneTwin = normalizedPhone
    ? await prisma.candidate.findFirst({
        where: { organizationId, normalizedPhone, id: { not: result.candidate.id } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : null;

  return res.status(201).json({
    ...result,
    duplicateWarning: phoneTwin
      ? { reason: "phone", candidate: phoneTwin, message: "Another candidate has the same phone number." }
      : null,
  });
});

/** Look for an existing person before adding one (rule 02). */
router.get("/candidates-search", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const { email, phone } = req.query as { email?: string; phone?: string };
  const normalizedEmail = email ? normalizeEmail(email) : null;
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedEmail && !normalizedPhone) return res.json([]);

  const matches = await prisma.candidate.findMany({
    where: {
      organizationId: req.user!.organizationId,
      OR: [
        ...(normalizedEmail ? [{ normalizedEmail }] : []),
        ...(normalizedPhone ? [{ normalizedPhone }] : []),
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      applications: { select: { id: true, stage: true, jobPosting: { select: { title: true } } } },
    },
    take: 10,
  });
  return res.json(matches);
});

// Exported so the AI assistant validates a proposed action with exactly these rules.
export const updateApplicationSchema = z.object({
  // JOINED is intentionally absent: joining must go through /confirm-joining.
  stage: z.enum(["APPLIED", "SHORTLISTED", "INTERVIEW", "SELECTED", "REJECTED"]).optional(),
  notes: z.string().trim().max(5000).optional(),
  hiringOwnerId: z.string().uuid().nullable().optional(),
});

router.patch("/applications/:id", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const parsed = updateApplicationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const application = await prisma.jobApplication.findFirst({ where: { id: req.params.id, organizationId } });
  if (!application) return res.status(404).json({ error: "Application not found" });
  // Selected is not Joined (rule 03): once joined, the stage is settled.
  if (application.stage === "JOINED") return res.status(409).json({ error: "This candidate has already joined" });
  await assertInOrg("employee", parsed.data.hiringOwnerId, organizationId, "Hiring owner");

  const updated = await prisma.jobApplication.update({
    where: { id: application.id },
    data: parsed.data,
    select: APPLICATION_SELECT,
  });
  return res.json(updated);
});

// ─── Convert to employee (5.4) ─────────────────────────────────────────────

const confirmJoiningSchema = z.object({
  dateOfJoining: z.coerce.date(),
  designation: z.string().trim().max(200).optional(),
  departmentId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
});

/**
 * Confirms joining and creates — or reuses — the employee record (5.4).
 *
 * Selected does not mean Joined: this is the explicit confirmation. A retry
 * returns the employee that already exists rather than creating a second one
 * (rule 03). Salary, payroll and login access are *not* granted here (rule 04):
 * the invitation is sent by createEmployeeWithUser only as an account set-up
 * link, and compensation stays with authorized payroll users.
 */
router.post("/applications/:id/confirm-joining", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const parsed = confirmJoiningSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const application = await prisma.jobApplication.findFirst({
    where: { id: req.params.id, organizationId },
    include: { candidate: true },
  });
  if (!application) return res.status(404).json({ error: "Application not found" });

  // Idempotent: a repeated confirmation returns what already exists.
  if (application.hiredEmployeeId) {
    const employee = await prisma.employee.findUnique({ where: { id: application.hiredEmployeeId } });
    return res.status(200).json({ application, employee, alreadyJoined: true });
  }

  // The same person may already be an employee from another application.
  const existingEmployee = await prisma.employee.findFirst({
    where: { organizationId, user: { email: application.candidate.email } },
    select: { id: true },
  });

  let employeeId = existingEmployee?.id ?? null;
  let tempPassword: string | undefined;
  let inviteSent = false;

  if (!employeeId) {
    const created = await createEmployeeWithUser(organizationId, {
      email: application.candidate.email,
      firstName: application.candidate.firstName,
      lastName: application.candidate.lastName,
      designation: parsed.data.designation,
      departmentId: parsed.data.departmentId,
      managerId: parsed.data.managerId,
      dateOfJoining: parsed.data.dateOfJoining,
    });
    employeeId = created.employee.id;
    tempPassword = created.tempPassword;
    inviteSent = created.inviteSent;
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Conditional claim: two concurrent confirmations can't both link.
    const { count } = await tx.jobApplication.updateMany({
      where: { id: application.id, organizationId, hiredEmployeeId: null },
      data: { stage: "JOINED", hiredEmployeeId: employeeId, joinedAt: parsed.data.dateOfJoining },
    });
    if (!count) throw new HttpError(409, "This application was just confirmed by someone else");
    return tx.jobApplication.findUniqueOrThrow({ where: { id: application.id }, select: APPLICATION_SELECT });
  });

  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  return res.status(201).json({
    application: updated,
    employee,
    reusedExistingEmployee: !!existingEmployee,
    tempPassword,
    inviteSent,
  });
});

// ─── Interviews (5.3) ──────────────────────────────────────────────────────

/** An interviewer's own schedule. They see nothing else about the candidate (rule 06). */
router.get("/interviews/me", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const interviews = await prisma.interview.findMany({
    where: { interviewerId: employeeId, organizationId: req.user!.organizationId },
    select: {
      id: true,
      scheduledAt: true,
      location: true,
      meetingLink: true,
      feedback: true,
      decision: true,
      application: {
        select: {
          id: true,
          candidate: { select: { firstName: true, lastName: true } },
          jobPosting: { select: { title: true } },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });
  return res.json(interviews);
});

router.get("/interviews", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const interviews = await prisma.interview.findMany({
    where: { organizationId: req.user!.organizationId },
    select: {
      id: true,
      scheduledAt: true,
      location: true,
      meetingLink: true,
      feedback: true,
      decision: true,
      interviewer: { select: { id: true, firstName: true, lastName: true } },
      application: {
        select: {
          id: true,
          stage: true,
          candidate: { select: { id: true, firstName: true, lastName: true } },
          jobPosting: { select: { title: true } },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });
  return res.json(interviews);
});

const scheduleInterviewSchema = z.object({
  interviewerId: z.string().uuid(),
  // Stored as an instant; screens render it in the organization timezone (rule 07).
  scheduledAt: z.coerce.date(),
  location: z.string().trim().max(500).optional(),
  meetingLink: z.string().trim().url().max(2000).optional(),
});

router.post("/applications/:id/interviews", requirePermission(PERMISSIONS.RECRUITMENT_MANAGE), async (req, res) => {
  const parsed = scheduleInterviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const application = await prisma.jobApplication.findFirst({ where: { id: req.params.id, organizationId } });
  if (!application) return res.status(404).json({ error: "Application not found" });
  await assertInOrg("employee", parsed.data.interviewerId, organizationId, "Interviewer");

  const interview = await prisma.interview.create({
    data: { organizationId, applicationId: application.id, ...parsed.data },
  });
  // Essential reminders stay inside HRMS; external calendar invites are a
  // WorkEasy Connect concern once a connector is released (rule 07).
  void notifyInterviewScheduled(interview.id);
  return res.status(201).json(interview);
});

const feedbackSchema = z.object({
  feedback: z.string().trim().min(1).max(5000),
  decision: z.enum(["PROCEED", "HOLD", "REJECT"]),
});

router.patch("/interviews/:id", async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const interview = await prisma.interview.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!interview) return res.status(404).json({ error: "Interview not found" });

  // The assigned interviewer, or authorized hiring staff. Nobody else (rule 06).
  const canManageAll = req.user!.permissions.includes(PERMISSIONS.RECRUITMENT_MANAGE);
  if (!canManageAll && interview.interviewerId !== req.user!.employeeId) {
    return res.status(403).json({ error: "Not authorized to submit feedback for this interview" });
  }

  const updated = await prisma.interview.update({ where: { id: interview.id }, data: parsed.data });
  return res.json(updated);
});

export default router;
