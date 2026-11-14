import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { writeAuditLog } from "../../utils/audit";
import { PERMISSIONS } from "../../utils/permissions";
import { assertInOrg } from "../../utils/tenant";

/**
 * Settings 7.6 — Integrations, powered by WorkEasy Connect.
 *
 * HRMS is an authorized product adapter, not a second integration platform.
 * Connect owns OAuth, credentials, the mapping engine, webhook delivery, retries
 * and logs (Connect rule 02). What lives here is only: which connections this
 * organization has authorized, which explicitly supported HRMS events and
 * actions they are wired to, the approved field map, and a read-only view of
 * Connect's transfer history filtered to HRMS.
 *
 * No credential is stored here and no delivery happens here.
 */
const router = Router();
router.use(requireAuth);

const CONNECT_BASE_URL = process.env.CONNECT_BASE_URL ?? "https://connect.workeasy360.com";

/**
 * The only HRMS events that may leave the product, and the only actions an
 * external system may trigger. A connection existing does not make every record
 * writable (Connect rule 03).
 *
 * Outbound payloads default to minimal identifiers and approved fields.
 * Salary, bank details, private documents and HR-ticket contents are not
 * exposed by any of them (Connect rule 07).
 */
export const SUPPORTED_EVENTS = [
  {
    key: "employee.joined",
    label: "Employee joined",
    fields: ["employeeCode", "firstName", "lastName", "workEmail", "department", "designation", "dateOfJoining"],
  },
  {
    key: "employee.exited",
    label: "Employee exited",
    fields: ["employeeCode", "firstName", "lastName", "exitDate"],
  },
  {
    key: "candidate.stage_changed",
    label: "Candidate stage changed",
    fields: ["applicationId", "jobTitle", "stage", "changedAt"],
  },
] as const;

export const SUPPORTED_ACTIONS = [
  {
    key: "candidate.create",
    label: "Create a candidate application",
    fields: ["jobPostingId", "firstName", "lastName", "email", "phone", "source"],
    note: "Creates a candidate and links an application to the selected job. It never creates an employee, grants access or changes payroll.",
  },
] as const;

const EVENT_KEYS = new Set<string>(SUPPORTED_EVENTS.map((e) => e.key));
const ACTION_KEYS = new Set<string>(SUPPORTED_ACTIONS.map((a) => a.key));
const EVENT_FIELDS = new Map<string, readonly string[]>(SUPPORTED_EVENTS.map((e) => [e.key, e.fields]));
const ACTION_FIELDS = new Map<string, readonly string[]>(SUPPORTED_ACTIONS.map((a) => [a.key, a.fields]));

/**
 * Connectors shown on the HRMS Integrations page. Anything not released is
 * Coming Soon and has no live setup action (Connect rule 12, Settings 7.6.5).
 * A card never asserts provider approval.
 */
export const CONNECTORS = [
  { provider: "webhook_incoming", label: "Incoming webhook", direction: "INBOUND", released: true },
  { provider: "webhook_outgoing", label: "Outgoing webhook", direction: "OUTBOUND", released: true },
  { provider: "api_connection", label: "API connection", direction: "OUTBOUND", released: true },
  { provider: "pabbly", label: "Pabbly", direction: "INBOUND", released: false },
  { provider: "facebook_lead_forms", label: "Facebook Lead Forms", direction: "INBOUND", released: false },
  { provider: "indiamart", label: "IndiaMART", direction: "INBOUND", released: false },
  { provider: "justdial", label: "Justdial", direction: "INBOUND", released: false },
  { provider: "google_sheets", label: "Google Sheets", direction: "OUTBOUND", released: false },
  { provider: "zoom", label: "Zoom", direction: "OUTBOUND", released: false },
] as const;

const RELEASED_PROVIDERS = new Set(CONNECTORS.filter((c) => c.released).map((c) => c.provider));

/** What this organization can set up, and what is still Coming Soon. */
router.get("/catalog", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (_req, res) => {
  return res.json({
    connectBaseUrl: CONNECT_BASE_URL,
    connectors: CONNECTORS.map((c) => ({ ...c, status: c.released ? "AVAILABLE" : "COMING_SOON" })),
    events: SUPPORTED_EVENTS,
    actions: SUPPORTED_ACTIONS,
  });
});

// ─── Connections (7.6.1) ───────────────────────────────────────────────────

router.get("/connections", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const connections = await prisma.integrationConnection.findMany({
    where: { organizationId: req.user!.organizationId },
    include: {
      mappings: { select: { id: true, direction: true, eventKey: true, actionKey: true, destination: true, enabled: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { transfers: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(connections);
});

const connectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  provider: z.string().trim().min(1).max(100),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  connectRef: z.string().trim().max(200).optional(),
});

router.post("/connections", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const parsed = connectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const connector = CONNECTORS.find((c) => c.provider === parsed.data.provider);
  if (!connector) return res.status(400).json({ error: "Unknown connector" });
  // A Coming Soon card has no live setup action (7.6.5).
  if (!RELEASED_PROVIDERS.has(parsed.data.provider as never)) {
    return res.status(409).json({ error: `${connector.label} is not released yet` });
  }
  if (connector.direction !== parsed.data.direction) {
    return res.status(400).json({ error: `${connector.label} only supports ${connector.direction.toLowerCase()} connections` });
  }

  const existing = await prisma.integrationConnection.findUnique({
    where: { organizationId_name: { organizationId, name: parsed.data.name } },
    select: { id: true },
  });
  if (existing) return res.status(409).json({ error: "A connection with that name already exists" });

  const connection = await prisma.integrationConnection.create({
    data: {
      organizationId,
      ...parsed.data,
      // Credentials and the actual setup live in Connect; HRMS links out to it.
      connectUrl: `${CONNECT_BASE_URL}/connections?product=hrms&org=${encodeURIComponent(organizationId)}`,
      createdById: req.user!.employeeId,
    },
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "integration.connection_created",
    entityType: "IntegrationConnection",
    entityId: connection.id,
    after: { name: connection.name, provider: connection.provider, direction: connection.direction },
  });
  return res.status(201).json(connection);
});

const connectionUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "DISABLED"]).optional(),
  connectRef: z.string().trim().max(200).nullable().optional(),
});

router.patch("/connections/:id", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const parsed = connectionUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const connection = await prisma.integrationConnection.findFirst({ where: { id: req.params.id, organizationId } });
  if (!connection) return res.status(404).json({ error: "Connection not found" });

  // Going live needs a tested mapping behind it (Connect rule 05).
  if (parsed.data.status === "ACTIVE") {
    const mappings = await prisma.integrationMapping.count({ where: { connectionId: connection.id, enabled: true } });
    if (mappings === 0) {
      return res.status(409).json({ error: "Enable at least one field mapping before activating this connection" });
    }
  }

  const updated = await prisma.integrationConnection.update({ where: { id: connection.id }, data: parsed.data });
  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "integration.connection_updated",
    entityType: "IntegrationConnection",
    entityId: connection.id,
    before: { name: connection.name, status: connection.status },
    after: { name: updated.name, status: updated.status },
  });
  return res.json(updated);
});

router.delete("/connections/:id", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const { count } = await prisma.integrationConnection.deleteMany({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!count) return res.status(404).json({ error: "Connection not found" });
  await writeAuditLog({
    organizationId: req.user!.organizationId,
    actorUserId: req.user!.sub,
    action: "integration.connection_deleted",
    entityType: "IntegrationConnection",
    entityId: req.params.id,
  });
  return res.status(204).send();
});

// ─── Mapping and destination (7.6.3) ───────────────────────────────────────

const mappingSchema = z
  .object({
    connectionId: z.string().uuid(),
    direction: z.enum(["INBOUND", "OUTBOUND"]),
    eventKey: z.string().trim().max(100).optional(),
    actionKey: z.string().trim().max(100).optional(),
    destination: z.string().trim().max(500).optional(),
    fieldMap: z.record(z.string().max(200)).default({}),
    enabled: z.boolean().optional(),
  })
  .refine((d) => (d.direction === "OUTBOUND" ? !!d.eventKey : !!d.actionKey), {
    message: "An outbound mapping needs an HRMS event; an inbound mapping needs an HRMS action",
    path: ["eventKey"],
  });

router.post("/mappings", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const parsed = mappingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;
  await assertInOrg("integrationConnection", parsed.data.connectionId, organizationId, "Connection");

  const error = validateMapping(parsed.data);
  if (error) return res.status(400).json({ error });

  const mapping = await prisma.integrationMapping.create({
    data: {
      organizationId,
      connectionId: parsed.data.connectionId,
      direction: parsed.data.direction,
      eventKey: parsed.data.eventKey,
      actionKey: parsed.data.actionKey,
      destination: parsed.data.destination,
      fieldMap: parsed.data.fieldMap,
      enabled: parsed.data.enabled ?? false,
    },
  });

  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "integration.mapping_created",
    entityType: "IntegrationMapping",
    entityId: mapping.id,
    after: { eventKey: mapping.eventKey, actionKey: mapping.actionKey, enabled: mapping.enabled },
  });
  return res.status(201).json(mapping);
});

/** Only supported keys and approved fields are accepted (Connect rules 03, 11). */
function validateMapping(data: {
  direction: "INBOUND" | "OUTBOUND";
  eventKey?: string;
  actionKey?: string;
  fieldMap: Record<string, string>;
}): string | null {
  if (data.direction === "OUTBOUND") {
    if (!data.eventKey || !EVENT_KEYS.has(data.eventKey)) return "That HRMS event is not supported";
    const allowed = new Set(EVENT_FIELDS.get(data.eventKey) ?? []);
    const bad = Object.keys(data.fieldMap).filter((f) => !allowed.has(f));
    if (bad.length > 0) return `These fields are not available on that event: ${bad.join(", ")}`;
    return null;
  }
  if (!data.actionKey || !ACTION_KEYS.has(data.actionKey)) return "That HRMS action is not supported";
  const allowed = new Set(ACTION_FIELDS.get(data.actionKey) ?? []);
  const bad = Object.values(data.fieldMap).filter((f) => !allowed.has(f));
  if (bad.length > 0) return `These fields can't be written by an integration: ${bad.join(", ")}`;
  return null;
}

const mappingUpdateSchema = z.object({
  destination: z.string().trim().max(500).nullable().optional(),
  fieldMap: z.record(z.string().max(200)).optional(),
  enabled: z.boolean().optional(),
});

router.patch("/mappings/:id", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const parsed = mappingUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const mapping = await prisma.integrationMapping.findFirst({ where: { id: req.params.id, organizationId } });
  if (!mapping) return res.status(404).json({ error: "Mapping not found" });

  if (parsed.data.fieldMap) {
    const error = validateMapping({
      direction: mapping.direction,
      eventKey: mapping.eventKey ?? undefined,
      actionKey: mapping.actionKey ?? undefined,
      fieldMap: parsed.data.fieldMap,
    });
    if (error) return res.status(400).json({ error });
  }

  const updated = await prisma.integrationMapping.update({ where: { id: mapping.id }, data: parsed.data });
  await writeAuditLog({
    organizationId,
    actorUserId: req.user!.sub,
    action: "integration.mapping_updated",
    entityType: "IntegrationMapping",
    entityId: mapping.id,
    before: { enabled: mapping.enabled, fieldMap: mapping.fieldMap },
    after: { enabled: updated.enabled, fieldMap: updated.fieldMap },
  });
  return res.json(updated);
});

router.delete("/mappings/:id", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const { count } = await prisma.integrationMapping.deleteMany({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!count) return res.status(404).json({ error: "Mapping not found" });
  return res.status(204).send();
});

// ─── Transfer history (7.6.4) ──────────────────────────────────────────────

/**
 * Read-only. Connect owns delivery, retries and failure visibility; HRMS shows
 * the status so a failed transfer is visible without losing the HR record
 * (Connect rule 09). There is deliberately no retry endpoint here.
 */
router.get("/transfers", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const { connectionId, status } = req.query as { connectionId?: string; status?: string };
  const transfers = await prisma.integrationTransfer.findMany({
    where: {
      organizationId: req.user!.organizationId,
      ...(connectionId ? { connectionId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      connection: { select: { id: true, name: true, provider: true } },
      mapping: { select: { id: true, eventKey: true, actionKey: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: 100,
  });
  return res.json(transfers);
});

export default router;
