import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { HttpError } from "../../utils/HttpError";
import { PERMISSIONS } from "../../utils/permissions";
import { notifyAnnouncement } from "../../utils/notifications";

const router = Router();
router.use(requireAuth);

router.get("/", requirePermission(PERMISSIONS.ANNOUNCEMENT_READ), async (req, res) => {
  const announcements = await prisma.announcement.findMany({
    where: { organizationId: req.user!.organizationId },
    include: { author: { select: { firstName: true, lastName: true } } },
    orderBy: { publishedAt: "desc" },
  });
  return res.json(announcements);
});

// Exported so the AI assistant validates a proposed action with exactly these rules.
export const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

router.post("/", requirePermission(PERMISSIONS.ANNOUNCEMENT_MANAGE), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  if (!req.user!.employeeId) {
    throw new HttpError(400, "No employee profile linked to this user");
  }

  const announcement = await prisma.announcement.create({
    data: {
      organizationId: req.user!.organizationId,
      authorId: req.user!.employeeId,
      ...parsed.data,
    },
  });
  void notifyAnnouncement(announcement.id);
  return res.status(201).json(announcement);
});

/** Simple edit (Settings 7.1.4). Editing does not re-notify everyone. */
router.patch("/:id", requirePermission(PERMISSIONS.ANNOUNCEMENT_MANAGE), async (req, res) => {
  const parsed = createSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "Nothing to update" });

  const announcement = await prisma.announcement.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
    select: { id: true },
  });
  if (!announcement) return res.status(404).json({ error: "Announcement not found" });

  const updated = await prisma.announcement.update({ where: { id: announcement.id }, data: parsed.data });
  return res.json(updated);
});

router.delete("/:id", requirePermission(PERMISSIONS.ANNOUNCEMENT_MANAGE), async (req, res) => {
  const { count } = await prisma.announcement.deleteMany({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!count) return res.status(404).json({ error: "Announcement not found" });
  return res.status(204).send();
});

export default router;
