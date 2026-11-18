import { prisma } from "../config/prisma";
import { endSessions } from "../auth/sessions";
import { signRefreshToken, verifyRefreshToken } from "./jwt";
import { HttpError } from "./HttpError";

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_TTL_SECONDS = REFRESH_TTL_MS / 1000;
const EXPIRED = "Your session has expired. Please sign in again.";
/**
 * Cookie sessions only: a refresh token rotated this recently, in a session that is still open,
 * is a second tab renewing at the same moment (each tab keeps its own in-memory access token, and
 * they share the one cookie), not a stolen token. It gets an access token but no new refresh token;
 * the browser already holds the new cookie.
 */
const COOKIE_ROTATION_GRACE_MS = 30_000;

/** Issues a refresh token in a session's family (auth/sessions.ts `openSession`) and records it. */
export async function issueRefreshToken(userId: string, familyId: string): Promise<string> {
  const row = await prisma.refreshToken.create({
    data: { userId, familyId, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
  });
  return signRefreshToken(userId, row.id, familyId);
}

export interface Rotated {
  userId: string;
  /** Null: a concurrent renewal inside the grace window (cookie sessions); keep the current cookie. */
  refreshToken: string | null;
  familyId: string;
  method: "PASSWORD" | "WORKEASY360";
}

/**
 * Exchanges a refresh token for a new one in the same family. A token that was
 * already used (revoked) means it leaked, so the whole family is revoked. A token
 * of an ended session (signed out, ended by WorkEasy360, password changed, exit) is
 * refused.
 */
export async function rotateRefreshToken(token: string, options: { cookie?: boolean } = {}): Promise<Rotated> {
  let claims: { sub: string; jti: string; fam: string };
  try {
    claims = verifyRefreshToken(token);
  } catch {
    throw new HttpError(401, EXPIRED);
  }

  const [row, session] = await Promise.all([
    prisma.refreshToken.findUnique({ where: { id: claims.jti } }),
    prisma.authSession.findUnique({ where: { id: claims.fam }, select: { id: true, userId: true, endedAt: true, method: true } }),
  ]);
  if (!row || row.userId !== claims.sub || row.familyId !== claims.fam) {
    throw new HttpError(401, EXPIRED);
  }
  // A second tab renewing at the same moment (see COOKIE_ROTATION_GRACE_MS).
  const concurrentRenewal = (revokedAt: Date | null) =>
    Boolean(
      options.cookie &&
        session &&
        !session.endedAt &&
        session.userId === row.userId &&
        row.expiresAt > new Date() &&
        revokedAt &&
        Date.now() - revokedAt.getTime() < COOKIE_ROTATION_GRACE_MS,
    );
  if (row.revokedAt) {
    if (concurrentRenewal(row.revokedAt)) return { userId: row.userId, refreshToken: null, familyId: row.familyId, method: session!.method };
    await revokeFamily(row.familyId, "refresh_token_reused");
    throw new HttpError(401, EXPIRED);
  }
  if (session && (session.endedAt || session.userId !== row.userId)) {
    await revokeFamily(row.familyId, "session_ended");
    throw new HttpError(401, EXPIRED);
  }

  // Conditional update so two concurrent refreshes can't both succeed with the same token.
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!count) {
    // Another request rotated it between our read and our update.
    const now = await prisma.refreshToken.findUnique({ where: { id: row.id }, select: { revokedAt: true } });
    if (concurrentRenewal(now?.revokedAt ?? null)) {
      return { userId: row.userId, refreshToken: null, familyId: row.familyId, method: session!.method };
    }
    throw new HttpError(401, EXPIRED);
  }
  if (row.expiresAt < new Date()) {
    throw new HttpError(401, EXPIRED);
  }

  let method: Rotated["method"] = session?.method ?? "PASSWORD";
  if (!session) {
    // A family started before sessions were recorded (a password sign-in): it becomes a
    // recorded session now, so its access tokens can be checked and ended like any other.
    const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { organizationId: true } });
    if (!user) throw new HttpError(401, EXPIRED);
    await prisma.authSession.upsert({
      where: { id: row.familyId },
      create: { id: row.familyId, userId: row.userId, organizationId: user.organizationId, method: "PASSWORD", createdAt: row.createdAt },
      update: {},
    });
    method = "PASSWORD";
  }

  return {
    userId: row.userId,
    refreshToken: await issueRefreshToken(row.userId, row.familyId),
    familyId: row.familyId,
    method,
  };
}

/** The session a refresh token belongs to, if the token is genuine (logout). */
export function familyOf(token: string): string | null {
  try {
    return verifyRefreshToken(token).fam;
  } catch {
    return null;
  }
}

/** Ends the session a refresh token belongs to (logout). Invalid tokens are ignored. */
export async function revokeRefreshToken(token: string): Promise<void> {
  const family = familyOf(token);
  if (family) await revokeFamily(family, "signed_out");
}

/** Ends one session: its refresh tokens and, through the per-request check, its access tokens. */
export async function revokeFamily(familyId: string, reason = "revoked"): Promise<void> {
  await endSessions({ id: familyId }, reason);
}

/** Signs the user out everywhere (password change or reset, account exit). */
export async function revokeAllForUser(userId: string, reason = "signed_out_everywhere"): Promise<void> {
  await endSessions({ userId }, reason);
}
