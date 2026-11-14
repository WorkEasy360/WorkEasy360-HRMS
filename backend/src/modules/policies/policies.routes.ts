import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";

/**
 * HR policies (Settings 7.1.4). A simple publisher in Settings and a reading
 * view on Home — not a content-management module and not a main menu.
 */
const router = Router();
router.use(requireAuth);

const LIST_SELECT = {
  id: true,
  title: true,
  category: true,
  publishedAt: true,
  updatedAt: true,
  author: { select: { id: true, firstName: true, lastName: true } },
};

/** What employees read: published policies for their own organization only. */
router.get("/", async (req, res) => {
  const policies = await prisma.hrPolicy.findMany({
    where: { organizationId: req.user!.organizationId, publishedAt: { not: null } },
    select: LIST_SELECT,
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });
  return res.json(policies);
});

/** Everything, including drafts. Authors only. */
router.get("/all", requirePermission(PERMISSIONS.POLICY_MANAGE), async (req, res) => {
  const policies = await prisma.hrPolicy.findMany({
    where: { organizationId: req.user!.organizationId },
    select: LIST_SELECT,
    orderBy: { updatedAt: "desc" },
  });
  return res.json(policies);
});

router.get("/:id", async (req, res) => {
  const canManage = req.user!.permissions.includes(PERMISSIONS.POLICY_MANAGE);
  const policy = await prisma.hrPolicy.findFirst({
    where: {
      id: req.params.id,
      organizationId: req.user!.organizationId,
      ...(canManage ? {} : { publishedAt: { not: null } }),
    },
    select: { ...LIST_SELECT, body: true, createdAt: true },
  });
  if (!policy) return res.status(404).json({ error: "Policy not found" });
  return res.json(policy);
});

const writeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  category: z.string().trim().max(100).optional(),
  publish: z.boolean().optional(),
});

router.post("/", requirePermission(PERMISSIONS.POLICY_MANAGE), async (req, res) => {
  const authorId = req.user!.employeeId;
  if (!authorId) throw new HttpError(400, "No employee profile linked to this user");
  const parsed = writeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const policy = await prisma.hrPolicy.create({
    data: {
      organizationId: req.user!.organizationId,
      authorId,
      title: parsed.data.title,
      body: parsed.data.body,
      category: parsed.data.category,
      publishedAt: parsed.data.publish ? new Date() : null,
    },
    select: LIST_SELECT,
  });
  return res.status(201).json(policy);
});

const updateSchema = writeSchema.partial();

router.patch("/:id", requirePermission(PERMISSIONS.POLICY_MANAGE), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const policy = await prisma.hrPolicy.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    select: { id: true, publishedAt: true },
  });
  if (!policy) return res.status(404).json({ error: "Policy not found" });

  const { publish, ...fields } = parsed.data;
  const updated = await prisma.hrPolicy.update({
    where: { id: policy.id },
    data: {
      ...fields,
      ...(publish === undefined ? {} : { publishedAt: publish ? (policy.publishedAt ?? new Date()) : null }),
    },
    select: LIST_SELECT,
  });
  return res.json(updated);
});

router.delete("/:id", requirePermission(PERMISSIONS.POLICY_MANAGE), async (req, res) => {
  const { count } = await prisma.hrPolicy.deleteMany({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!count) return res.status(404).json({ error: "Policy not found" });
  return res.status(204).send();
});

export default router;
