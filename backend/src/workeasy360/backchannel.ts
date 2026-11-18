import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { endSessions } from "../auth/sessions";
import type { VerifiedLogoutToken } from "./client";

const PURGE_INTERVAL_MS = 10 * 60 * 1000;
let lastPurge = 0;

export type LogoutOutcome =
  /** Accepted; `sessions` is how many open sessions it ended (possibly none). */
  | { status: "ended"; by: "sid" | "sub"; sessions: number }
  /** This `jti` was accepted before: nothing was done again. */
  | { status: "replayed" };

/**
 * The storage half of OpenID Connect Back-Channel Logout 1.0 (section 2.7). A verified logout
 * token ends, in PostgreSQL (which every API instance checks on every request):
 *
 * - with `sid`: the sessions that WorkEasy360 sign-in opened (narrowed to `sub` when both are named);
 * - with `sub` only ("sign out everywhere"): every session of every HRMS account linked to
 *   `(issuer, sub)` - one per company the person works in - however it was started.
 *
 * Recording the `jti` and ending the sessions are one transaction: if anything fails nothing
 * happened (the `jti` included), so the provider's retry is not mistaken for a replay. Ending an
 * ended session changes nothing, which is what at-least-once delivery needs.
 */
export async function endFromLogoutToken(issuer: string, token: VerifiedLogoutToken): Promise<LogoutOutcome> {
  const now = new Date();
  let outcome: LogoutOutcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      // First, so a concurrent delivery of the same token waits on the key and then fails.
      await tx.workeasy360LogoutToken.create({
        data: { issuer, jti: token.jti, expiresAt: new Date(token.acceptableUntil * 1000) },
      });
      if (token.sid) {
        const sessions = await tx.authSession.findMany({
          where: { issuer, providerSid: token.sid, ...(token.sub ? { subject: token.sub } : {}) },
          select: { id: true },
        });
        const ended = await endSessions({ ids: sessions.map((s) => s.id) }, "workeasy360_logout", tx);
        return { status: "ended" as const, by: "sid" as const, sessions: ended };
      }
      const subject = token.sub!;
      const identities = await tx.externalIdentity.findMany({ where: { issuer, subject }, select: { userId: true } });
      const sessions = await tx.authSession.findMany({ where: { issuer, subject }, select: { userId: true }, distinct: ["userId"] });
      const userIds = [...new Set([...identities, ...sessions].map((row) => row.userId))];
      const ended = await endSessions({ userIds }, "workeasy360_logout", tx);
      return { status: "ended" as const, by: "sub" as const, sessions: ended };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "replayed" };
    throw error;
  }
  if (now.getTime() - lastPurge > PURGE_INTERVAL_MS) {
    lastPurge = now.getTime();
    // Best effort: a jti past its token's acceptance window can never be replayed.
    prisma.workeasy360LogoutToken.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => undefined);
  }
  return outcome;
}
