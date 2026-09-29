import { prisma } from "../config/prisma";
import { ALL_PERMISSIONS } from "./permissions";

// Idempotent: safe to call on every boot so the permission catalog is never missing.
// One statement (not one per key), since each round trip to the database is slow.
export async function seedPermissions() {
  await prisma.permission.createMany({ data: ALL_PERMISSIONS.map((key) => ({ key })), skipDuplicates: true });
}
