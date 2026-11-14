import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { writeAuditLog } from "../../utils/audit";
import { AUTOMATION_RULES, allowedTimings, isKnownAutomationKey, resolveAutomations } from "../../utils/automations";
import { PERMISSIONS } from "../../utils/permissions";

/**
 * Internal automation (Settings 7.5). Switches and permitted timing options for
 * a fixed catalog of rules that implement existing HR workflows. There is no
 * generic trigger/condition builder, and nothing here can finalize payroll or
 * turn a ticket resolution into an approval (rule 07).
 */
const router = Router();
router.use(requireAuth);

router.get("/", requirePermission(PERMISSIONS.AUTOMATION_MANAGE), async (req, res) => {
  const resolved = await resolveAutomations(req.user!.organizationId);
  const byKey = new Map(resolved.map((r) => [r.key, r]));
  return res.json(
    AUTOMATION_RULES.map((rule) => ({
      key: rule.key,
      label: rule.label,
      description: rule.description,
      timingOptions: rule.timing ?? null,
      enabled: byKey.get(rule.key)?.enabled ?? true,
      timingHours: byKey.get(rule.key)?.timingHours ?? null,
    })),
  );
});

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  timingHours: z.number().int().positive().nullable().optional(),
});

router.patch("/:key", requirePermission(PERMISSIONS.AUTOMATION_MANAGE), async (req, res) => {
  const key = req.params.key;
  // Only catalog keys exist: there is nothing to invent here.
  if (!isKnownAutomationKey(key)) return res.status(404).json({ error: "Unknown automation rule" });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.enabled === undefined && parsed.data.timingHours === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const timings = allowedTimings(key);
  if (parsed.data.timingHours != null) {
    if (timings.length === 0) return res.status(400).json({ error: "This rule has no timing option" });
    if (!timings.includes(parsed.data.timingHours)) {
      return res.status(400).json({ error: `Timing must be one of: ${timings.join(", ")} hours` });
    }
  }

  const organizationId = req.user!.organizationId;
  const before = await prisma.automationSetting.findUnique({ where: { organizationId_key: { organizationId, key } } });
  const setting = await prisma.automationSetting.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: {
      organizationId,
      key,
      enabled: parsed.data.enabled ?? true,
      timingHours: parsed.data.timingHours ?? null,
      updatedById: req.user!.employeeId,
    },
    update: {
      ...(parsed.data.enabled === undefined ? {} : { enabled: parsed.data.enabled }),
      ...(parsed.data.timingHours === undefined ? {} : { timingHours: parsed.data.timingHours }),
      updatedById: req.user!.employeeId,
    },
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "automation.update",
    entityType: "AutomationSetting",
    entityId: setting.id,
    before: before ? { enabled: before.enabled, timingHours: before.timingHours } : null,
    after: { key, enabled: setting.enabled, timingHours: setting.timingHours },
  });
  return res.json(setting);
});

/**
 * Activity (7.5.3). Automation outcomes are recorded in the shared audit trail
 * rather than a private log, so there is one place to look.
 */
router.get("/activity", requirePermission(PERMISSIONS.AUTOMATION_MANAGE), async (req, res) => {
  const logs = await prisma.auditLog.findMany({
    where: { organizationId: req.user!.organizationId, entityType: "AutomationSetting" },
    include: { actor: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return res.json(logs);
});

export default router;
