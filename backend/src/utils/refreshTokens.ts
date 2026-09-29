import { randomUUID } from "crypto";
import { prisma } from "../config/prisma";
import { signRefreshToken, verifyRefreshToken } from "./jwt";
import { HttpError } from "./HttpError";

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Issues a refresh token and records it; pass familyId when rotating an existing session. */
export async function issueRefreshToken(userId: string, familyId: string = randomUUID()): Promise<string> {
  const row = await prisma.refreshToken.create({
    data: { userId, familyId, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
  });
  return signRefreshToken(userId, row.id, familyId);
}

/**
 * Exchanges a refresh token for a new one in the same family. A token that was
 * already used (revoked) means it leaked, so the whole family is revoked.
 */
export async function rotateRefreshToken(token: string): Promise<{ userId: string; refreshToken: string }> {
  let claims: { sub: string; jti: string; fam: string };
  try {
    claims = verifyRefreshToken(token);
  } catch {
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }

  const row = await prisma.refreshToken.findUnique({ where: { id: claims.jti } });
  if (!row || row.userId !== claims.sub) {
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }
  if (row.revokedAt) {
    await revokeFamily(row.familyId);
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }

  // Conditional update so two concurrent refreshes can't both succeed with the same token.
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!count || row.expiresAt < new Date()) {
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }

  return { userId: row.userId, refreshToken: await issueRefreshToken(row.userId, row.familyId) };
}

/** Revokes the session a refresh token belongs to (logout). Invalid tokens are ignored. */
export async function revokeRefreshToken(token: string): Promise<void> {
  try {
    const { jti, fam } = verifyRefreshToken(token);
    const row = await prisma.refreshToken.findUnique({ where: { id: jti } });
    if (row) await revokeFamily(fam);
  } catch {
    // Already invalid; nothing to revoke.
  }
}

export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Signs the user out everywhere (password change, account exit). */
export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
