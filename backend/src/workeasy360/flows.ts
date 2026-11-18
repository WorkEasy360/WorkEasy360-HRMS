import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../config/prisma";

/** Time allowed at WorkEasy360 (sign-in, second factor, organization choice) before the flow is abandoned. */
export const FLOW_TTL_SECONDS = 600;
const PURGE_INTERVAL_MS = 10 * 60 * 1000;

export interface PendingFlow {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** The WorkEasy360 organization the launcher named, or "". */
  organization: string;
  /** Validated same-site path to land on. */
  next: string;
}

const idFor = (flowId: string): string => createHash("sha256").update(flowId).digest("hex");

let lastPurge = 0;

/**
 * Pending sign-ins, kept server-side in PostgreSQL (shared by every API instance) and used
 * once. The browser holds only a random flow id in an httpOnly cookie; the state, nonce and
 * PKCE verifier never leave the server, and the row is addressed by a hash of the id. A
 * callback consumes it with DELETE ... RETURNING before anything else, so a flow is good for
 * exactly one callback even when two arrive at once.
 */
export function newFlowId(): string {
  return randomBytes(32).toString("base64url");
}

export async function saveFlow(flowId: string, flow: PendingFlow): Promise<void> {
  const now = Date.now();
  await prisma.workeasy360Flow.create({
    data: { id: idFor(flowId), ...flow, expiresAt: new Date(now + FLOW_TTL_SECONDS * 1000) },
  });
  if (now - lastPurge > PURGE_INTERVAL_MS) {
    lastPurge = now;
    // Best effort: abandoned flows are dropped.
    prisma.workeasy360Flow.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }).catch(() => undefined);
  }
}

/** Atomically removes and returns the flow; null when unknown, already used, or too old. */
export async function consumeFlow(flowId: string): Promise<PendingFlow | null> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(flowId)) return null;
  const rows = await prisma.$queryRaw<Array<PendingFlow & { expiresAt: Date }>>`
    DELETE FROM "workeasy360_flows" WHERE "id" = ${idFor(flowId)}
    RETURNING "state", "nonce", "codeVerifier", "organization", "next", "expiresAt"`;
  const row = rows[0];
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return { state: row.state, nonce: row.nonce, codeVerifier: row.codeVerifier, organization: row.organization, next: row.next };
}
