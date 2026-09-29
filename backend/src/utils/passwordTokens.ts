import crypto from "crypto";
import type { PasswordTokenPurpose } from "@prisma/client";
import { prisma } from "../config/prisma";
import { HttpError } from "./HttpError";

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // welcome link: 3 days
export const RESET_TTL_MS = 60 * 60 * 1000; // self-service "forgot password" link: 1 hour
export const HR_RESET_TTL_MS = 24 * 60 * 60 * 1000; // HR-initiated reset link: 24 hours

function hash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Creates a single-use link token (only its hash is stored). Earlier unused tokens of the same purpose stop working. */
export async function createPasswordToken(userId: string, purpose: PasswordTokenPurpose, ttlMs: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordToken.create({ data: { userId, purpose, tokenHash: hash(token), expiresAt: new Date(Date.now() + ttlMs) } }),
  ]);
  return token;
}

const INVALID_LINK = "This link is invalid or has expired. Ask for a new one.";

/** Looks up a token without using it (to show the right screen before the user types a password). */
export async function findValidPasswordToken(token: string) {
  const row = await prisma.passwordToken.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { select: { id: true, email: true, organization: { select: { slug: true, name: true } } } } },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new HttpError(400, INVALID_LINK);
  return row;
}

/** Marks a token used; concurrent submissions of the same link can't both succeed. */
export async function consumePasswordToken(token: string) {
  const row = await findValidPasswordToken(token);
  const { count } = await prisma.passwordToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (!count) throw new HttpError(400, INVALID_LINK);
  return row;
}
