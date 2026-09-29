import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { PERMISSIONS } from "../../utils/permissions";

const router = Router();
router.use(requireAuth);

router.get("/me", async (req, res) => {
  const employeeId = req.user!.employeeId;
  const assets = await prisma.asset.findMany({ where: { assignedToId: employeeId ?? "__none__" } });
  return res.json(assets);
});

router.get("/", requirePermission(PERMISSIONS.ASSET_MANAGE), async (req, res) => {
  const assets = await prisma.asset.findMany({
    where: { organizationId: req.user!.organizationId },
    include: { assignedTo: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json(assets);
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(200),
  serialNumber: z.string().trim().max(200).optional(),
});

router.post("/", requirePermission(PERMISSIONS.ASSET_MANAGE), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const asset = await prisma.asset.create({
    data: { organizationId: req.user!.organizationId, ...parsed.data },
  });
  return res.status(201).json(asset);
});

const assignSchema = z.object({ employeeId: z.string().uuid() });

router.post("/:id/assign", requirePermission(PERMISSIONS.ASSET_MANAGE), async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organizationId = req.user!.organizationId;

  const [asset, employee] = await Promise.all([
    prisma.asset.findFirst({ where: { id: req.params.id, organizationId } }),
    prisma.employee.findFirst({ where: { id: parsed.data.employeeId, organizationId } }),
  ]);
  if (!asset || !employee) return res.status(404).json({ error: "Asset or employee not found" });
  if (asset.status === "ASSIGNED") return res.status(409).json({ error: "Asset is already assigned" });
  if (asset.status !== "AVAILABLE") return res.status(409).json({ error: "Only available assets can be assigned" });

  const { count } = await prisma.asset.updateMany({
    where: { id: asset.id, organizationId, status: "AVAILABLE" },
    data: { assignedToId: employee.id, assignedAt: new Date(), status: "ASSIGNED" },
  });
  if (!count) return res.status(409).json({ error: "Asset is already assigned" });
  const updated = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
  return res.json(updated);
});

router.post("/:id/return", requirePermission(PERMISSIONS.ASSET_MANAGE), async (req, res) => {
  const asset = await prisma.asset.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!asset) return res.status(404).json({ error: "Asset not found" });
  if (asset.status !== "ASSIGNED") return res.status(409).json({ error: "Only assigned assets can be returned" });

  const { count } = await prisma.asset.updateMany({
    where: { id: asset.id, organizationId: req.user!.organizationId, status: "ASSIGNED" },
    data: { assignedToId: null, assignedAt: null, status: "AVAILABLE" },
  });
  if (!count) return res.status(409).json({ error: "Only assigned assets can be returned" });
  const updated = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
  return res.json(updated);
});

router.post("/:id/retire", requirePermission(PERMISSIONS.ASSET_MANAGE), async (req, res) => {
  const asset = await prisma.asset.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!asset) return res.status(404).json({ error: "Asset not found" });

  const updated = await prisma.asset.update({
    where: { id: asset.id },
    data: { status: "RETIRED", assignedToId: null, assignedAt: null },
  });
  return res.json(updated);
});

export default router;
