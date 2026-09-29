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

const createSchema = z.object({
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

export default router;
