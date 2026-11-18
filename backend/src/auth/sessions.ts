import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

/**
 * Sessions. A session is one sign-in: a row in `auth_sessions` whose id is the refresh-token
 * family. Every access token names its session (`fam`), and every authenticated request asks
 * PostgreSQL whether that session is still open (`sessionState`). So whatever ends a session -
 * sign-out, a WorkEasy360 back-channel logout, a password change or reset, a reused refresh
 * token, an exit - ends its access tokens with it, at once, on every API instance and across
 * restarts: nothing is remembered in a process.
 *
 * Cost: one query per authenticated request (a primary-key lookup on auth_sessions joined to
 * the user, the company and the employee row). There is no cache on purpose: a cached "open"
 * would delay a revocation, which is the property this exists for.
 */

export type SessionOrigin =
  | { method: "PASSWORD" }
  | {
      method: "WORKEASY360";
      issuer: string;
      subject: string;
      providerSid: string | null;
      workeasy360OrganizationId: string;
    };

/** Opens a session and returns its id (the refresh-token family of the tokens issued for it). */
export async function openSession(userId: string, organizationId: string, origin: SessionOrigin): Promise<string> {
  const row = await prisma.authSession.create({
    data:
      origin.method === "PASSWORD"
        ? { userId, organizationId, method: "PASSWORD" }
        : {
            userId,
            organizationId,
            method: "WORKEASY360",
            issuer: origin.issuer,
            subject: origin.subject,
            providerSid: origin.providerSid,
            workeasy360OrganizationId: origin.workeasy360OrganizationId,
          },
    select: { id: true },
  });
  return row.id;
}

/**
 * Ends sessions and revokes their refresh tokens, in one transaction. Ending a session that has
 * already ended changes nothing (at-least-once logout delivery relies on it). Returns how many
 * open sessions it ended.
 */
export async function endSessions(
  where: { id: string } | { ids: string[] } | { userId: string } | { userIds: string[] },
  reason: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const now = new Date();
  const sessionWhere: Prisma.AuthSessionWhereInput =
    "id" in where
      ? { id: where.id }
      : "ids" in where
        ? { id: { in: where.ids } }
        : "userId" in where
          ? { userId: where.userId }
          : { userId: { in: where.userIds } };
  const tokenWhere: Prisma.RefreshTokenWhereInput =
    "id" in where
      ? { familyId: where.id }
      : "ids" in where
        ? { familyId: { in: where.ids } }
        : "userId" in where
          ? { userId: where.userId }
          : { userId: { in: where.userIds } };
  if (("ids" in where && where.ids.length === 0) || ("userIds" in where && where.userIds.length === 0)) return 0;

  const run = async (client: Prisma.TransactionClient) => {
    const ended = await client.authSession.updateMany({
      where: { ...sessionWhere, endedAt: null },
      data: { endedAt: now, endedReason: reason.slice(0, 64) },
    });
    await client.refreshToken.updateMany({ where: { ...tokenWhere, revokedAt: null }, data: { revokedAt: now } });
    return ended.count;
  };
  // Inside a caller's transaction, use it; otherwise make one.
  if (tx !== prisma) return run(tx as Prisma.TransactionClient);
  return prisma.$transaction((client) => run(client));
}

export type SessionState =
  | {
      status: "live";
      method: "PASSWORD" | "WORKEASY360";
      /** WorkEasy360 sessions: who signed in. */
      subject: string | null;
      /** WorkEasy360 sessions: the organization the ID token named at sign-in. */
      sessionOrganization: string | null;
      /** The WorkEasy360 organization the company is bound to now, or null. */
      boundOrganization: string | null;
    }
  /** Ended, never existed, or not this user's in this company. */
  | { status: "ended" }
  /** The HRMS account itself is deactivated (an exit), whatever the session says. */
  | { status: "account_disabled" };

interface StateRow {
  live: boolean;
  active: boolean;
  method: "PASSWORD" | "WORKEASY360";
  subject: string | null;
  sessionOrganization: string | null;
  boundOrganization: string | null;
}

/** The state of the session these (verified) access-token claims name. Throws when the database cannot say. */
export async function sessionState(claims: { sub: string; organizationId: string; fam?: string }): Promise<SessionState> {
  // A token issued before sessions were recorded names none: not live, and the browser
  // renews it once (its refresh token is still good) and gets one that does.
  if (!claims.fam) return { status: "ended" };
  const rows = await prisma.$queryRaw<StateRow[]>`
    SELECT s."endedAt" IS NULL AS "live",
           (u."disabledAt" IS NULL AND (e."status" IS NULL OR e."status" <> 'EXITED')) AS "active",
           s."method"::text AS "method",
           s."subject" AS "subject",
           s."workeasy360OrganizationId" AS "sessionOrganization",
           o."workeasy360OrganizationId" AS "boundOrganization"
      FROM "auth_sessions" s
      JOIN "users" u ON u."id" = s."userId"
      JOIN "organizations" o ON o."id" = u."organizationId"
      LEFT JOIN "employees" e ON e."userId" = u."id"
     WHERE s."id" = ${claims.fam}
       AND s."userId" = ${claims.sub}
       AND s."organizationId" = ${claims.organizationId}
       AND u."organizationId" = ${claims.organizationId}`;
  const row = rows[0];
  if (!row) return { status: "ended" };
  if (!row.active) return { status: "account_disabled" };
  if (!row.live) return { status: "ended" };
  return {
    status: "live",
    method: row.method,
    subject: row.subject,
    sessionOrganization: row.sessionOrganization,
    boundOrganization: row.boundOrganization,
  };
}
