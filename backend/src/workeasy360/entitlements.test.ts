import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { EntitlementAnswer } from "./client";
import { EntitlementCache, MemoryAnswerStore, type EntitlementSource } from "./entitlements";
import { Workeasy360Error } from "./errors";

/** The entitlement cache with a scripted source, an in-memory store and a clock the test moves. */

const ORG = "3f1f6a3e-1f0e-4d6a-9c50-4c0a1c1e0b11";
const OTHER = "9a8c7d6e-5f4e-4d3c-8b2a-1a0b9c8d7e6f";

class ScriptedSource implements EntitlementSource {
  calls: Array<{ organizationId: string; subject?: string }> = [];
  next: Array<EntitlementAnswer | Workeasy360Error> = [];
  fallback: EntitlementAnswer | Workeasy360Error = { decision: "allow", reason: "entitled", writeAllowed: true, revalidateAfter: 900 };
  async verifyEntitlement(organizationId: string, options: { subject?: string }) {
    this.calls.push({ organizationId, ...(options.subject ? { subject: options.subject } : {}) });
    const answer = this.next.shift() ?? this.fallback;
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

const allow = (revalidateAfter = 900, writeAllowed = true): EntitlementAnswer => ({ decision: "allow", reason: "entitled", writeAllowed, revalidateAfter });
const deny = (reason = "expired"): EntitlementAnswer => ({ decision: "deny", reason, writeAllowed: false, revalidateAfter: 900 });

let now: number;
let source: ScriptedSource;
let store: MemoryAnswerStore;
let cache: EntitlementCache;
const silent = () => undefined;

beforeEach(() => {
  now = Date.parse("2026-11-18T10:00:00Z");
  source = new ScriptedSource();
  store = new MemoryAnswerStore();
  cache = new EntitlementCache(() => source, store, () => now, silent);
});

describe("EntitlementCache", () => {
  it("trusts an allow for revalidate_after, then asks again", async () => {
    source.next = [allow(120)];
    assert.equal((await cache.check(ORG)).status, "allow");
    now += 119_000;
    assert.equal((await cache.check(ORG)).status, "allow");
    assert.equal(source.calls.length, 1);
    now += 2_000;
    await cache.check(ORG);
    assert.equal(source.calls.length, 2);
  });

  it("never trusts an allow longer than 900 s nor shorter than 30 s", async () => {
    source.next = [allow(86_400)];
    await cache.check(ORG);
    now += 901_000;
    await cache.check(ORG);
    assert.equal(source.calls.length, 2);
    source.next = [allow(1)];
    await cache.check(OTHER);
    now += 29_000;
    await cache.check(OTHER);
    assert.equal(source.calls.filter((c) => c.organizationId === OTHER).length, 1);
  });

  it("asks per person when a subject is given, and per organization otherwise", async () => {
    await cache.check(ORG, { subject: "sub-ada" });
    await cache.check(ORG);
    assert.deepEqual(source.calls, [{ organizationId: ORG, subject: "sub-ada" }, { organizationId: ORG }]);
  });

  it("re-asks a person's denial after 60 s, and keeps it until then", async () => {
    source.next = [deny("membership_inactive"), allow()];
    const first = await cache.check(ORG, { subject: "sub-ada" });
    assert.deepEqual(first, { allowed: false, writeAllowed: false, reason: "membership_inactive", status: "deny" });
    now += 59_000;
    assert.equal((await cache.check(ORG, { subject: "sub-ada" })).status, "deny");
    now += 2_000;
    assert.equal((await cache.check(ORG, { subject: "sub-ada" })).status, "allow");
  });

  it("asks afresh when told to (a person arriving), even within the window", async () => {
    await cache.check(ORG, { subject: "sub-ada" });
    source.next = [deny("no_seat")];
    assert.equal((await cache.check(ORG, { subject: "sub-ada", fresh: true })).reason, "no_seat");
    assert.equal(source.calls.length, 2);
  });

  it("keeps the last answer through an outage, and never turns an outage into a denial", async () => {
    source.next = [allow(60), new Workeasy360Error("provider_unavailable", "503")];
    await cache.check(ORG);
    now += 61_000;
    assert.equal((await cache.check(ORG)).status, "allow");
    // Backing off: no question for 60 s.
    await cache.check(ORG);
    assert.equal(source.calls.length, 2);
  });

  it("lets access continue through an outage when there is no answer yet", async () => {
    source.next = [new Workeasy360Error("provider_unavailable", "timeout")];
    assert.deepEqual(await cache.check(ORG), { allowed: true, writeAllowed: true, reason: "unchecked", status: "unchecked" });
  });

  it("keeps a known denial through an outage: it never lapses into access", async () => {
    source.next = [deny("expired"), new Workeasy360Error("provider_unavailable", "503")];
    await cache.check(ORG);
    now += 3_600_000;
    assert.equal((await cache.check(ORG)).status, "deny");
  });

  it("fails closed for every question for 60 s when WorkEasy360 refuses the client, then asks once again", async () => {
    await cache.check(OTHER);
    source.next = [new Workeasy360Error("provider_refused", "401")];
    now += 1_000_000;
    assert.equal((await cache.check(ORG)).status, "refused");
    // Every other organization and person too, without asking, even with a cached allow.
    assert.equal((await cache.check(OTHER)).status, "refused");
    assert.equal((await cache.check(ORG, { subject: "sub-ada" })).status, "refused");
    const asked = source.calls.length;
    now += 61_000;
    source.next = [allow()];
    assert.equal((await cache.check(ORG)).status, "allow");
    assert.equal(source.calls.length, asked + 1);
  });

  it("treats a 429 soon after a refusal as the refusal, and a 429 alone as an outage", async () => {
    source.next = [new Workeasy360Error("rate_limited", "429")];
    assert.equal((await cache.check(ORG)).status, "unchecked");
    source.next = [new Workeasy360Error("provider_refused", "401"), new Workeasy360Error("rate_limited", "429")];
    assert.equal((await cache.check(OTHER)).status, "refused");
    now += 61_000;
    assert.equal((await cache.check(OTHER)).status, "refused");
  });

  it("reports a read-only subscription as allowed without writes", async () => {
    source.next = [allow(900, false)];
    assert.deepEqual(await cache.check(ORG), { allowed: true, writeAllowed: false, reason: "entitled", status: "allow" });
  });

  it("shares answers through the store: a new process does not forget a denial", async () => {
    source.next = [deny("suspended")];
    await cache.check(ORG);
    const restarted = new EntitlementCache(() => source, store, () => now, silent);
    source.next = [new Workeasy360Error("provider_unavailable", "503")];
    now += 3_600_000;
    assert.equal((await restarted.check(ORG)).status, "deny");
  });

  it("asks once for concurrent first questions in one process", async () => {
    const answers = await Promise.all([cache.check(ORG), cache.check(ORG), cache.check(ORG)]);
    assert.ok(answers.every((a) => a.status === "allow"));
    assert.equal(source.calls.length, 1);
  });
});
