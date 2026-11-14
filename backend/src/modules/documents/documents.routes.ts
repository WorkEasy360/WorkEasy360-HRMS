import express, { Request, Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { writeAuditLog } from "../../utils/audit";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";

/**
 * Employee documents (Employees 2.2.2). Files live inside the employee profile,
 * not in a separate company document module.
 *
 * Access is server-side on every read, including the download itself: an
 * employee sees only their own files; HR with document:manage sees any file in
 * the organization. A manager does not inherit document access (rule 07).
 */
const router = Router();

const MAX_BYTES = 5 * 1024 * 1024;
// The global JSON limit is 100 KB; uploads need their own, larger parser.
router.use(express.json({ limit: "7mb" }));
router.use(requireAuth);

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const DOCUMENT_SELECT = {
  id: true,
  employeeId: true,
  title: true,
  category: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  verifiedAt: true,
  createdAt: true,
  uploadedBy: { select: { id: true, firstName: true, lastName: true } },
  verifiedBy: { select: { id: true, firstName: true, lastName: true } },
};

function canManage(req: Request): boolean {
  return req.user!.permissions.includes(PERMISSIONS.DOCUMENT_MANAGE);
}

/** Own documents, or anyone's with document:manage. Nothing else. */
function assertCanSee(req: Request, employeeId: string): void {
  if (employeeId === req.user!.employeeId) return;
  if (canManage(req)) return;
  throw new HttpError(403, "You don't have access to these documents");
}

router.get("/", async (req, res) => {
  const { employeeId } = req.query as { employeeId?: string };
  const target = employeeId ?? req.user!.employeeId;
  if (!target) throw new HttpError(400, "No employee profile linked to this user");
  assertCanSee(req, target);

  const documents = await prisma.employeeDocument.findMany({
    where: { organizationId: req.user!.organizationId, employeeId: target },
    select: DOCUMENT_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return res.json(documents);
});

const uploadSchema = z.object({
  employeeId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(127),
  contentBase64: z.string().min(1).max(Math.ceil((MAX_BYTES * 4) / 3) + 1024),
});

router.post("/", async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;
  const uploaderId = req.user!.employeeId ?? null;

  const employeeId = parsed.data.employeeId ?? req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");
  // Uploading to someone else's profile needs the document permission.
  if (employeeId !== req.user!.employeeId && !canManage(req)) {
    return res.status(403).json({ error: "You can only upload documents to your own profile" });
  }

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, select: { id: true } });
  if (!employee) return res.status(404).json({ error: "Employee not found" });

  if (!ALLOWED_MIME.has(parsed.data.mimeType)) {
    return res.status(415).json({ error: "Only PDF, Word and image files can be uploaded" });
  }
  const content = Buffer.from(parsed.data.contentBase64, "base64");
  if (content.length === 0) return res.status(400).json({ error: "The file is empty" });
  if (content.length > MAX_BYTES) return res.status(413).json({ error: "Files must be 5 MB or smaller" });

  const document = await prisma.employeeDocument.create({
    data: {
      organizationId,
      employeeId,
      title: parsed.data.title,
      category: parsed.data.category,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: content.length,
      content,
      uploadedById: uploaderId,
    },
    select: DOCUMENT_SELECT,
  });
  return res.status(201).json(document);
});

/** Download. The permission is re-checked here, not only on the list (7 security). */
router.get("/:id/content", async (req, res) => {
  const document = await prisma.employeeDocument.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    select: { employeeId: true, fileName: true, mimeType: true, content: true },
  });
  if (!document) return res.status(404).json({ error: "Document not found" });
  assertCanSee(req, document.employeeId);

  res.setHeader("Content-Type", document.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(document.fileName)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.send(Buffer.from(document.content));
});

/** Authorized HR confirms a required submission (Employees 2.3.2). */
router.post("/:id/verify", async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: `Missing permission: ${PERMISSIONS.DOCUMENT_MANAGE}` });

  const document = await prisma.employeeDocument.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    select: { id: true, employeeId: true, verifiedAt: true },
  });
  if (!document) return res.status(404).json({ error: "Document not found" });
  if (document.verifiedAt) return res.status(409).json({ error: "This document is already verified" });

  const updated = await prisma.employeeDocument.update({
    where: { id: document.id },
    data: { verifiedAt: new Date(), verifiedById: req.user!.employeeId },
    select: DOCUMENT_SELECT,
  });

  await writeAuditLog({
    organizationId: req.user!.organizationId,
    actorUserId: req.user!.sub,
    action: "document.verify",
    entityType: "EmployeeDocument",
    entityId: document.id,
    after: { employeeId: document.employeeId },
  });
  return res.json(updated);
});

router.delete("/:id", async (req, res) => {
  const document = await prisma.employeeDocument.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    select: { id: true, employeeId: true, title: true },
  });
  if (!document) return res.status(404).json({ error: "Document not found" });
  assertCanSee(req, document.employeeId);

  await prisma.employeeDocument.delete({ where: { id: document.id } });
  await writeAuditLog({
    organizationId: req.user!.organizationId,
    actorUserId: req.user!.sub,
    action: "document.delete",
    entityType: "EmployeeDocument",
    entityId: document.id,
    before: { employeeId: document.employeeId, title: document.title },
  });
  return res.status(204).send();
});

export default router;
