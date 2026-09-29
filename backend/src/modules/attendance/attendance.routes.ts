import { Request, Router } from "express";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../middleware/requirePermission";
import { PERMISSIONS } from "../../utils/permissions";
import { monthRange, today } from "../../utils/date";
import { HttpError } from "../../utils/HttpError";

const router = Router();
router.use(requireAuth);

function requireSelfEmployee(req: Request): string {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw new HttpError(400, "No employee profile linked to this user");
  return employeeId;
}

router.post("/check-in", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const date = today();

  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date } },
  });
  if (existing?.checkInAt) {
    return res.status(409).json({ error: "Already checked in today" });
  }

  const record = await prisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date } },
    create: { organizationId: req.user!.organizationId, employeeId, date, checkInAt: new Date() },
    update: { checkInAt: new Date() },
  });
  return res.status(201).json(record);
});

router.post("/check-out", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const date = today();

  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date } },
  });
  if (!existing?.checkInAt) {
    return res.status(400).json({ error: "Must check in before checking out" });
  }
  if (existing.checkOutAt) {
    return res.status(409).json({ error: "Already checked out today" });
  }

  const record = await prisma.attendanceRecord.update({
    where: { id: existing.id },
    data: { checkOutAt: new Date() },
  });
  return res.json(record);
});

router.get("/me", async (req, res) => {
  const employeeId = requireSelfEmployee(req);
  const { month } = req.query as { month?: string };

  const records = await prisma.attendanceRecord.findMany({
    where: {
      employeeId,
      ...(month ? monthRange(month) : {}),
    },
    orderBy: { date: "desc" },
  });
  return res.json(records);
});

router.get("/", requirePermission(PERMISSIONS.EMPLOYEE_READ), async (req, res) => {
  const { employeeId, month } = req.query as { employeeId?: string; month?: string };

  const records = await prisma.attendanceRecord.findMany({
    where: {
      organizationId: req.user!.organizationId,
      ...(employeeId ? { employeeId } : {}),
      ...(month ? monthRange(month) : {}),
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { date: "desc" },
  });
  return res.json(records);
});

export default router;
