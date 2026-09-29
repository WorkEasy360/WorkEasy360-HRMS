import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const articles = await prisma.hrGuideArticle.findMany({
    where: { organizationId: req.user!.organizationId },
    include: { author: { select: { firstName: true, lastName: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return res.json(articles);
});

router.get("/:id", async (req, res) => {
  const article = await prisma.hrGuideArticle.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    include: { author: { select: { firstName: true, lastName: true } } },
  });
  if (!article) return res.status(404).json({ error: "Article not found" });
  return res.json(article);
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50000),
  category: z.string().trim().max(200).optional(),
});

router.post("/", requirePermission(PERMISSIONS.HR_GUIDE_MANAGE), async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const article = await prisma.hrGuideArticle.create({
    data: { organizationId: req.user!.organizationId, authorId: employeeId, ...parsed.data },
  });
  return res.status(201).json(article);
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(50000).optional(),
  category: z.string().trim().max(200).optional(),
});

router.patch("/:id", requirePermission(PERMISSIONS.HR_GUIDE_MANAGE), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const article = await prisma.hrGuideArticle.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!article) return res.status(404).json({ error: "Article not found" });

  const updated = await prisma.hrGuideArticle.update({ where: { id: article.id }, data: parsed.data });
  return res.json(updated);
});

router.delete("/:id", requirePermission(PERMISSIONS.HR_GUIDE_MANAGE), async (req, res) => {
  const article = await prisma.hrGuideArticle.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!article) return res.status(404).json({ error: "Article not found" });

  await prisma.hrGuideArticle.delete({ where: { id: article.id } });
  return res.status(204).send();
});

export default router;
