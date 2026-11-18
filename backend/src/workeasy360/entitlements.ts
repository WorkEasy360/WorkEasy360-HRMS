import { createHash } from "node:crypto";
import { prisma } from "../config/prisma";
import { workeasy360Client, type EntitlementAnswer } from "./client";
import { Workeasy360Error } from "./errors";

/**
 * Is this organization (and person) still entitled to HRMS? Asked of WorkEasy360's
 * entitlement endpoint on the cadence it advertises, never assumed (integration guide
 * section 7, completion design section 4):
 *
 * - An `allow` is trusted for `min(revalidate_after, 900)` seconds, at least 30.
 * - A person's denial is re-asked after 60 s (a renewal takes effect quickly); an
 *   organization's (no person) after 900 s.
 * - An outage (5xx, 429, timeout, network, an unusable discovery document or key) is never a
 *   denial: the last answer stands; with none, access continues; the next attempt waits 60 s.
 * - A refusal of our own client (400/401/403: a revoked credential, a suspended integration)
 *   is not an outage: every question fails closed (`refused`) for 60 s, for everyone, logged
 *   as an error; then one question goes out alone. A 429 within 5 minutes of the refusal is
 *   still the refusal talking (the platform limits failed client authentications).
 * - A known denial never lapses into access: it is kept without expiry, in this process and in
 *   PostgreSQL (`workeasy360_entitlements`, shared by every instance and surviving restarts).
 * - Within a process one request asks per key and the others wait for (or use the last of) its
 *   answer. Answers are read from PostgreSQL only on a local miss, so a cached answer costs no
 *   round trip at all.
 */

export const MAX_TRUST_SECONDS = 900;
export const MIN_TRUST_SECONDS = 30;
export const PERSON_DENIAL_RECHECK_SECONDS = 60;
export const ORGANIZATION_DENIAL_RECHECK_SECONDS = 900;
export const FAILURE_BACKOFF_SECONDS = 60;
export const CLIENT_REFUSAL_SECONDS = 60;
export const RATE_LIMIT_AFTER_REFUSAL_SECONDS = 300;
export const REFUSED_REASON = "refused";
const LOCAL_MAX_ENTRIES = 10_000;

export interface EntitlementAccess {
  allowed: boolean;
  writeAllowed: boolean;
  /** The provider's reason, `refused` when it refused our client, `unchecked` when no answer was ever available. */
  reason: string;
  status: "allow" | "deny" | "refused" | "unchecked";
}

export const UNCHECKED: EntitlementAccess = { allowed: true, writeAllowed: true, reason: "unchecked", status: "unchecked" };
const CLIENT_REFUSED: EntitlementAccess = { allowed: false, writeAllowed: false, reason: REFUSED_REASON, status: "refused" };

export interface StoredAnswer {
  decision: "allow" | "deny";
  reason: string;
  writeAllowed: boolean;
  /** Epoch milliseconds when the provider answered. */
  at: number;
  /** Seconds the answer is trusted. */
  trust: number;
}

export interface AnswerStore {
  load(key: string): Promise<StoredAnswer | null>;
  save(key: string, answer: StoredAnswer): Promise<void>;
}

export interface EntitlementSource {
  verifyEntitlement(organizationId: string, options: { subject?: string; write?: boolean }): Promise<EntitlementAnswer>;
}

type Log = (level: "info" | "warn" | "error", message: string, meta: Record<string, unknown>) => void;

const consoleLog: Log = (level, message, meta) => {
  const line = JSON.stringify({ msg: message, ...meta });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export class PostgresAnswerStore implements AnswerStore {
  async load(key: string): Promise<StoredAnswer | null> {
    const row = await prisma.workeasy360Entitlement.findUnique({ where: { key } });
    if (!row || (row.decision !== "allow" && row.decision !== "deny")) return null;
    return {
      decision: row.decision,
      reason: row.reason,
      writeAllowed: row.writeAllowed,
      at: row.answeredAt.getTime(),
      trust: row.trustSeconds,
    };
  }

  async save(key: string, answer: StoredAnswer): Promise<void> {
    const data = {
      decision: answer.decision,
      reason: answer.reason,
      writeAllowed: answer.writeAllowed,
      answeredAt: new Date(answer.at),
      trustSeconds: answer.trust,
    };
    await prisma.workeasy360Entitlement.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
}

export class MemoryAnswerStore implements AnswerStore {
  readonly rows = new Map<string, StoredAnswer>();
  async load(key: string) {
    return this.rows.get(key) ?? null;
  }
  async save(key: string, answer: StoredAnswer) {
    this.rows.set(key, answer);
  }
}

export class EntitlementCache {
  private readonly local = new Map<string, StoredAnswer>();
  private readonly backoff = new Map<string, number>();
  private readonly flights = new Map<string, Promise<EntitlementAccess>>();
  /** When this process last saw a refusal of the client; 0: never. */
  private refusedAt = 0;
  /** A refusal was seen and no question has been answered since: one question at a time. */
  private recovering = false;
  private probe: Promise<void> | null = null;

  constructor(
    private readonly source: () => EntitlementSource,
    private readonly store: AnswerStore,
    private readonly now: () => number = Date.now,
    private readonly log: Log = consoleLog,
  ) {}

  /**
   * The answer for this organization (and person). `fresh`: ask now even if a cached answer is
   * still trusted (a person arriving at sign-in); an outage still falls back to the last answer.
   */
  async check(organizationId: string, options: { subject?: string; fresh?: boolean } = {}): Promise<EntitlementAccess> {
    const key = cacheKey(organizationId, options.subject);
    const now = this.now();
    if (this.refusedAt > 0 && now - this.refusedAt < CLIENT_REFUSAL_SECONDS * 1000) return CLIENT_REFUSED;
    const known = await this.lastKnown(key);
    if (!options.fresh && known && now - known.at < known.trust * 1000 && known.at >= this.refusedAt) return toAccess(known);
    if ((this.backoff.get(key) ?? 0) > now) {
      return this.recovering ? CLIENT_REFUSED : known ? toAccess(known) : UNCHECKED;
    }
    const flight = this.flights.get(key);
    if (flight) return !options.fresh && known ? toAccess(known) : flight;

    const started = this.askOnce(organizationId, options, key, known).finally(() => this.flights.delete(key));
    this.flights.set(key, started);
    return started;
  }

  /** Forget this process's copy of the answers (tests). */
  clearLocal(): void {
    this.local.clear();
    this.backoff.clear();
    this.flights.clear();
    this.refusedAt = 0;
    this.recovering = false;
    this.probe = null;
  }

  private async askOnce(
    organizationId: string,
    options: { subject?: string; fresh?: boolean },
    key: string,
    known: StoredAnswer | null,
  ): Promise<EntitlementAccess> {
    if (!this.recovering) return this.ask(organizationId, options.subject, key, known);
    if (this.probe) {
      await this.probe;
      this.flights.delete(key);
      return this.check(organizationId, options);
    }
    let finished: () => void = () => undefined;
    this.probe = new Promise<void>((resolve) => (finished = resolve));
    try {
      return await this.ask(organizationId, options.subject, key, known);
    } finally {
      this.probe = null;
      finished();
    }
  }

  private async ask(organizationId: string, subject: string | undefined, key: string, known: StoredAnswer | null): Promise<EntitlementAccess> {
    const now = this.now();
    const person = Boolean(subject);
    try {
      const answer = await this.source().verifyEntitlement(organizationId, { ...(subject ? { subject } : {}), write: false });
      const record: StoredAnswer = {
        decision: answer.decision,
        reason: answer.reason.slice(0, 64),
        writeAllowed: answer.decision === "allow" && answer.writeAllowed,
        at: now,
        trust: trustSeconds(answer, person),
      };
      this.remember(key, record);
      await this.store.save(key, record).catch((error: unknown) =>
        this.log("warn", "workeasy360.entitlement_store_failed", { detail: error instanceof Error ? error.name : "unknown" }),
      );
      this.recovering = false;
      if (!known || known.decision !== record.decision || known.reason !== record.reason) {
        this.log("info", "workeasy360.entitlement_changed", { organizationId, decision: record.decision, reason: record.reason, person });
      }
      return toAccess(record);
    } catch (error) {
      const refusal =
        error instanceof Workeasy360Error &&
        (error.code === "provider_refused" ||
          (error.code === "rate_limited" && this.refusedAt > 0 && now - this.refusedAt < RATE_LIMIT_AFTER_REFUSAL_SECONDS * 1000));
      if (refusal) {
        // WorkEasy360 answered and refused our own client: not an outage. Fail closed, loudly.
        this.log("error", "workeasy360.entitlement_refused", { organizationId, detail: (error as Workeasy360Error).detail });
        this.refusedAt = now;
        this.recovering = true;
        return CLIENT_REFUSED;
      }
      // An outage: never a denial.
      this.log("warn", "workeasy360.entitlement_unavailable", {
        organizationId,
        code: error instanceof Workeasy360Error ? error.code : error instanceof Error ? error.name : "unknown",
        detail: error instanceof Workeasy360Error ? error.detail : "",
        lastKnown: known?.decision ?? null,
      });
      this.backoff.set(key, now + FAILURE_BACKOFF_SECONDS * 1000);
      return this.recovering ? CLIENT_REFUSED : known ? toAccess(known) : UNCHECKED;
    }
  }

  private async lastKnown(key: string): Promise<StoredAnswer | null> {
    const local = this.local.get(key);
    if (local) return local;
    try {
      const stored = await this.store.load(key);
      if (stored) this.remember(key, stored);
      return stored;
    } catch {
      return null;
    }
  }

  private remember(key: string, record: StoredAnswer): void {
    this.local.delete(key);
    this.local.set(key, record);
    while (this.local.size > LOCAL_MAX_ENTRIES) {
      const oldest = this.local.keys().next().value;
      if (oldest === undefined) break;
      this.local.delete(oldest);
    }
    this.backoff.delete(key);
  }
}

function cacheKey(organizationId: string, subject?: string): string {
  if (!subject) return `org:${organizationId}`;
  return `sub:${organizationId}:${createHash("sha256").update(subject).digest("hex").slice(0, 32)}`;
}

function trustSeconds(answer: EntitlementAnswer, person: boolean): number {
  if (answer.decision !== "allow") return person ? PERSON_DENIAL_RECHECK_SECONDS : ORGANIZATION_DENIAL_RECHECK_SECONDS;
  return Math.max(MIN_TRUST_SECONDS, Math.min(Math.floor(answer.revalidateAfter), MAX_TRUST_SECONDS));
}

function toAccess(record: StoredAnswer): EntitlementAccess {
  if (record.decision === "allow") return { allowed: true, writeAllowed: record.writeAllowed, reason: record.reason, status: "allow" };
  return { allowed: false, writeAllowed: false, reason: record.reason, status: "deny" };
}

// --- the one cache of this process -----------------------------------------------------------

let shared: EntitlementCache | null = null;

export function entitlements(): EntitlementCache {
  if (!shared) {
    // Resolved per question, so a configuration that changes is picked up.
    shared = new EntitlementCache(workeasy360Client, new PostgresAnswerStore());
  }
  return shared;
}
