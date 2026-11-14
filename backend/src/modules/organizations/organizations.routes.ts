import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { writeAuditLog } from "../../utils/audit";
import { startOfUtcDay } from "../../utils/date";
import { PERMISSIONS } from "../../utils/permissions";

const router = Router();
router.use(requireAuth);

router.get("/current", async (req, res) => {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: req.user!.organizationId } });
  return res.json(organization);
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Company profile and the one default work schedule (Settings 7.1.1, 7.1.2). */
const updateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  workStartTime: z.string().regex(TIME, "Use HH:MM, 24-hour").optional(),
  workEndTime: z.string().regex(TIME, "Use HH:MM, 24-hour").optional(),
  fullDayHours: z.number().min(1).max(24).optional(),
});

router.patch("/current", requirePermission(PERMISSIONS.ORG_MANAGE), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = { ...parsed.data };
  if (data.workingDays) data.workingDays = [...new Set(data.workingDays)].sort((a, b) => a - b);
  if (data.workStartTime && data.workEndTime && data.workEndTime <= data.workStartTime) {
    return res.status(400).json({ error: "The working day must end after it starts" });
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to update" });

  // A valid timezone matters: attendance days and interview times are read in it.
  if (data.timezone) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone });
    } catch {
      return res.status(400).json({ error: "Unknown timezone" });
    }
  }

  const before = await prisma.organization.findUniqueOrThrow({ where: { id: req.user!.organizationId } });
  const organization = await prisma.organization.update({ where: { id: before.id }, data });

  const changed = Object.keys(data) as (keyof typeof data)[];
  await writeAuditLog({
    organizationId: organization.id,
    actorUserId: req.user!.sub,
    action: "organization.update",
    entityType: "Organization",
    entityId: organization.id,
    before: Object.fromEntries(changed.map((k) => [k, before[k]])),
    after: Object.fromEntries(changed.map((k) => [k, organization[k]])),
  });

  return res.json(organization);
});

// ─── Holidays (Settings 7.1.2) ─────────────────────────────────────────────

router.get("/current/holidays", async (req, res) => {
  const { year } = req.query as { year?: string };
  const y = year && /^\d{4}$/.test(year) ? Number(year) : null;
  const holidays = await prisma.holiday.findMany({
    where: {
      organizationId: req.user!.organizationId,
      ...(y ? { date: { gte: new Date(Date.UTC(y, 0, 1)), lte: new Date(Date.UTC(y, 11, 31)) } } : {}),
    },
    orderBy: { date: "asc" },
  });
  return res.json(holidays);
});

const holidaySchema = z.object({
  date: z.coerce.date(),
  name: z.string().trim().min(1).max(200),
});

router.post("/current/holidays", requirePermission(PERMISSIONS.ORG_MANAGE), async (req, res) => {
  const parsed = holidaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;
  const date = startOfUtcDay(parsed.data.date);

  // One holiday per date: re-adding the same day renames it, never duplicates.
  const holiday = await prisma.holiday.upsert({
    where: { organizationId_date: { organizationId, date } },
    create: { organizationId, date, name: parsed.data.name },
    update: { name: parsed.data.name },
  });
  return res.status(201).json(holiday);
});

router.delete("/current/holidays/:id", requirePermission(PERMISSIONS.ORG_MANAGE), async (req, res) => {
  const { count } = await prisma.holiday.deleteMany({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!count) return res.status(404).json({ error: "Holiday not found" });
  return res.status(204).send();
});

export default router;
