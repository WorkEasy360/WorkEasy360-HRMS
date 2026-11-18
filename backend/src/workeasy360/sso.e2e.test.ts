import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../utils/organizationSetup";
import { linkOrganization, unlinkOrganization } from "./operator";
import { FakeWorkeasy360, productKeyPair, type AuthorizeOptions, type Identity } from "./testing/fakeProvider";
import {
  Browser,
  call,
  createTestSchema,
  freePort,
  startApi,
  TEST_DATABASE_URL,
  writeKeyFile,
  type Api,
  type TestSchema,
} from "./testing/harness";

/**
 * WorkEasy360 sign-in end to end: real API processes (`src/index.ts`) sharing one PostgreSQL
 * schema, as instances behind a load balancer do, and a fake WorkEasy360 in this process
 * (keys generated now). The test plays the browser (start, sign in at the provider, callback,
 * then the renewal the web app makes on landing, which is where it gets its access token) and
 * the platform's back-channel delivery.
 *
 * Needs PostgreSQL: set HRMS_TEST_DATABASE_URL (see docs/workeasy360-sso.md). Without it the
 * suite is skipped and says so.
 */

const APP = "http://localhost:3000";
const ORG_ACME = "3f1f6a3e-1f0e-4d6a-9c50-4c0a1c1e0b11"; // created by its first WorkEasy360 sign-in
const ORG_GLOBEX = "9a8c7d6e-5f4e-4d3c-8b2a-1a0b9c8d7e6f"; // an existing HRMS company, bound by the operator
const ORG_INITECH = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e"; // existing company: entitlement scenarios
const ORG_HOOLI = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f"; // existing company: read-only scenario
const PASSWORD = "Correct-Horse-42";

const ada: Identity = { sub: "sub-ada", email: "ada@acme.example", name: "Ada Admin", organizationId: ORG_ACME, organizationName: "Acme Corp" };
const ben: Identity = { sub: "sub-ben", email: "ben@globex.example", name: "Ben Employee", organizationId: ORG_GLOBEX };
const gina: Identity = { sub: "sub-gina", email: "gina@globex.example", name: "Gina HR", organizationId: ORG_GLOBEX };

const skip = TEST_DATABASE_URL ? false : "set HRMS_TEST_DATABASE_URL to run the end-to-end WorkEasy360 tests";

describe("WorkEasy360 sign-in, sessions and back-channel logout (two API instances, shared PostgreSQL)", { skip }, () => {
  let schema: TestSchema;
  let db: PrismaClient;
  let provider: FakeWorkeasy360;
  let one: Api;
  let two: Api;
  let ssoOnly: Api;
  let removeKey: () => void;
  const keys = productKeyPair();
  const companies: Record<string, string> = {};

  before(async () => {
    schema = await createTestSchema();
    db = schema.prisma;
    const portOne = await freePort();
    const redirectUri = `http://127.0.0.1:${portOne}/api/auth/callback/workeasy360`;
    provider = await FakeWorkeasy360.start({ redirectUris: [redirectUri], appPublicKey: keys.publicKey });
    const key = writeKeyFile(keys.privatePem);
    removeKey = key.remove;
    const env = {
      NODE_ENV: "test",
      DATABASE_URL: schema.url,
      JWT_ACCESS_SECRET: randomBytes(48).toString("base64url"),
      JWT_REFRESH_SECRET: randomBytes(48).toString("base64url"),
      CORS_ORIGIN: APP,
      APP_URL: APP,
      AI_PROVIDER: "disabled",
      MAIL_TRANSPORT: "log",
      SES_REGION: "",
      WORKEASY360_ISSUER: provider.issuer,
      WORKEASY360_CLIENT_ID: provider.clientId,
      WORKEASY360_REDIRECT_URI: redirectUri,
      WORKEASY360_POST_LOGOUT_REDIRECT_URI: `${APP}/login`,
      WORKEASY360_KEY_ID: provider.keyId,
      WORKEASY360_PRIVATE_KEY_FILE: key.path,
      WORKEASY360_PRIVATE_KEY: "",
      WORKEASY360_PRODUCT_CODE: "",
      WORKEASY360_SCOPES: "openid email profile organization",
      WORKEASY360_SSO_ONLY: "false",
      WORKEASY360_CREATE_ORGANIZATIONS: "true",
      WORKEASY360_SIGN_IN_RATE_LIMIT: "10000",
      COOKIE_SECURE: "",
    };
    process.env.JWT_ACCESS_SECRET = env.JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = env.JWT_REFRESH_SECRET;
    // Started one after the other: the first seeds the permission catalog.
    one = await startApi(env, portOne);
    two = await startApi(env);
    ssoOnly = await startApi({ ...env, WORKEASY360_SSO_ONLY: "true" });

    // Existing HRMS companies with password accounts (as live customers have them today).
    companies.globex = await existingCompany("Globex", "globex", "gina@globex.example");
    await addEmployee(companies.globex, "ben@globex.example", "Ben", "EMP-0002");
    await linkOrganization(db, "globex", ORG_GLOBEX);
    companies.initech = await existingCompany("Initech", "initech", "ian@initech.example");
    await linkOrganization(db, "initech", ORG_INITECH);
    companies.hooli = await existingCompany("Hooli", "hooli", "hal@hooli.example");
    await linkOrganization(db, "hooli", ORG_HOOLI);
  });

  after(async () => {
    await Promise.all([one?.stop(), two?.stop(), ssoOnly?.stop()]);
    await provider?.stop();
    await schema?.drop();
    removeKey?.();
  });

  beforeEach(() => provider.reset());

  // --- helpers ---------------------------------------------------------------------------

  async function existingCompany(name: string, slug: string, adminEmail: string): Promise<string> {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const created = await db.$transaction((tx) =>
      createOrganizationWithAdmin(tx, { organizationName: name, organizationSlug: slug, firstName: "Admin", lastName: name, email: adminEmail, passwordHash }),
    );
    return created.organization.id;
  }

  async function addEmployee(organizationId: string, email: string, firstName: string, code: string): Promise<string> {
    const role = await db.role.findUniqueOrThrow({ where: { organizationId_name: { organizationId, name: "Employee" } } });
    const user = await db.user.create({ data: { organizationId, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const employee = await db.employee.create({
      data: { organizationId, userId: user.id, employeeCode: code, firstName, lastName: "Tester", status: "ACTIVE" },
    });
    return employee.id;
  }

  interface Landing {
    browser: Browser;
    location: string;
    error: string | null;
  }

  /** Start on `api`, sign in at the provider, come back to the callback (on `callbackApi`). */
  async function signIn(
    api: Api,
    identity: Identity,
    options: AuthorizeOptions & { hint?: string; callbackApi?: Api; browser?: Browser; next?: string } = {},
  ): Promise<Landing> {
    const browser = options.browser ?? new Browser();
    const query = new URLSearchParams();
    if (options.hint) query.set("organization", options.hint);
    if (options.next) query.set("next", options.next);
    const started = await browser.request(`${api.url}/api/auth/workeasy360/start?${query}`);
    assert.equal(started.status, 302, `start answered ${started.status}: ${JSON.stringify(started.body)}`);
    assert.ok(started.location.startsWith(`${provider.issuer}/authorize?`), started.location);
    const authorization = provider.authorize(started.location, identity, options);
    assert.ok(authorization.callbackUrl, `the provider refused without a redirect (${authorization.ok ? "" : authorization.error})`);
    const callback = new URL(authorization.callbackUrl);
    const landed = await browser.request(`${(options.callbackApi ?? api).url}${callback.pathname}${callback.search}`);
    assert.equal(landed.status, 302);
    const location = new URL(landed.location);
    return { browser, location: landed.location, error: location.searchParams.get("sso_error") };
  }

  /** The web app's renewal on landing: the cookie in, an access token (for memory) out. */
  async function renew(api: Api, browser: Browser): Promise<{ status: number; token: string; body: Record<string, unknown> }> {
    const reply = await browser.request(`${api.url}/api/auth/refresh`, { method: "POST", headers: { "x-hrms-session": "cookie" }, body: "{}" });
    const body = (reply.body ?? {}) as Record<string, unknown>;
    return { status: reply.status, token: typeof body.accessToken === "string" ? body.accessToken : "", body };
  }

  async function signedIn(api: Api, identity: Identity, options: Parameters<typeof signIn>[2] = {}) {
    const landing = await signIn(api, identity, options);
    assert.equal(landing.error, null, `sign-in failed with ${landing.error}`);
    const renewed = await renew(api, landing.browser);
    assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
    return { ...landing, token: renewed.token };
  }

  async function passwordSignIn(api: Api, email: string, organizationSlug?: string) {
    const reply = await new Browser().request(`${api.url}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password: PASSWORD, ...(organizationSlug ? { organizationSlug } : {}) }),
    });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    return reply.body as { accessToken: string; refreshToken: string };
  }

  const deliver = (api: Api, token: string) => new Browser().request(`${api.url}/api/auth/workeasy360/backchannel-logout`, { method: "POST", form: { logout_token: token } });

  const status = async (api: Api, token: string, path = "/api/organizations/current") => (await call(api, token, path)).status;

  function familyOf(token: string): string {
    return (jwt.decode(token) as { fam: string }).fam;
  }

  // --- sign-in -------------------------------------------------------------------------------

  it("a first sign-in creates the company with the person as its Admin, and the session lives in an httpOnly cookie", async () => {
    const landing = await signIn(one, ada, { sid: "sid-ada-first", next: "/employees" });
    assert.equal(landing.error, null);
    assert.equal(landing.location, `${APP}/employees`);
    const cookie = landing.browser.cookies.get("hrms_session");
    assert.ok(cookie, "the session cookie is set");

    const renewed = await renew(one, landing.browser);
    assert.equal(renewed.status, 200);
    assert.equal(renewed.body.refreshToken, undefined, "a cookie session never hands the refresh token to the page");
    assert.equal(renewed.body.signInMethod, "workeasy360");
    const setCookie = (await landing.browser.request(`${one.url}/api/auth/refresh`, { method: "POST", headers: { "x-hrms-session": "cookie" }, body: "{}" }))
      .setCookies.find((line) => line.startsWith("hrms_session="))!;
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/api\/auth/i);
    assert.doesNotMatch(setCookie, /Domain=/i);

    const token = (await renew(one, landing.browser)).token;
    const me = await call(one, token, "/api/auth/me");
    assert.equal(me.status, 200);
    const body = me.body as { roles: string[]; signInMethod: string; hasPassword: boolean; email: string };
    assert.equal(body.signInMethod, "workeasy360");
    assert.deepEqual(body.roles, ["Admin"]);
    assert.equal(body.hasPassword, false);
    const company = await call(one, token, "/api/organizations/current");
    assert.equal((company.body as { workeasy360OrganizationId: string }).workeasy360OrganizationId, ORG_ACME);

    const session = await db.authSession.findUniqueOrThrow({ where: { id: familyOf(token) } });
    assert.equal(session.method, "WORKEASY360");
    assert.equal(session.subject, "sub-ada");
    assert.equal(session.providerSid, "sid-ada-first");
    assert.equal(session.issuer, provider.issuer);
    assert.equal(session.workeasy360OrganizationId, ORG_ACME);
    assert.ok(provider.tokenRequests.every((r) => r.assertionOk && r.pkceOk), "private_key_jwt and PKCE at the token endpoint");
  });

  it("the second sign-in of the same person lands in the same company, by (issuer, sub)", async () => {
    const first = await db.user.findFirstOrThrow({ where: { email: "ada@acme.example" } });
    const again = await signedIn(two, { ...ada, email: "ada.renamed@acme.example" });
    const me = (await call(two, again.token, "/api/auth/me")).body as { id: string };
    assert.equal(me.id, first.id, "a changed address is still the same person");
    assert.equal(await db.organization.count({ where: { workeasy360OrganizationId: ORG_ACME } }), 1);
  });

  it("a flow is used once, and only by the browser that started it", async () => {
    const browser = new Browser();
    const started = await browser.request(`${one.url}/api/auth/workeasy360/start`);
    const authorization = provider.authorize(started.location, ada);
    assert.ok(authorization.ok);
    const callback = new URL(authorization.callbackUrl);
    const path = `${callback.pathname}${callback.search}`;
    const flowCookie = browser.cookies.get("hrms_w360_flow")!;

    // Another browser (no flow cookie) with the victim's code: login CSRF, refused.
    const stranger = await new Browser().request(`${one.url}${path}`);
    assert.equal(new URL(stranger.location).searchParams.get("sso_error"), "expired");

    const first = await browser.request(`${two.url}${path}`);
    assert.equal(new URL(first.location).searchParams.get("sso_error"), null, "the flow is shared by the instances");
    const replay = new Browser();
    replay.cookies.set("hrms_w360_flow", flowCookie);
    const second = await replay.request(`${one.url}${path}`);
    assert.equal(new URL(second.location).searchParams.get("sso_error"), "expired");
  });

  it("an existing employee is linked by verified address inside the bound company, keeping their HRMS role", async () => {
    const { token } = await signedIn(one, ben);
    const me = (await call(one, token, "/api/auth/me")).body as { roles: string[]; email: string; hasPassword: boolean };
    assert.deepEqual(me.roles, ["Employee"]);
    assert.equal(me.email, "ben@globex.example");
    assert.equal(me.hasPassword, true, "linking keeps the password: password sign-in still works for live customers");
    assert.equal((await call(one, token, "/api/employees")).status, 403, "permissions come from the HRMS role, not from WorkEasy360");
    const link = await db.externalIdentity.findFirstOrThrow({ where: { subject: "sub-ben" } });
    assert.equal(link.organizationId, companies.globex);
    assert.equal(link.issuer, provider.issuer);
  });

  it("an account already linked to another WorkEasy360 identity is not taken over", async () => {
    const impostor = await signIn(one, { ...ben, sub: "sub-somebody-else" });
    assert.equal(impostor.error, "account_conflict");
  });

  it("nobody is created in an existing company: someone HR has not added is told so", async () => {
    const zed = await signIn(one, { sub: "sub-zed", email: "zed@globex.example", organizationId: ORG_GLOBEX });
    assert.equal(zed.error, "not_enrolled");
    assert.equal(await db.user.count({ where: { email: "zed@globex.example" } }), 0);
  });

  describe("never across organizations", () => {
    it("refuses a token for another organization than the launcher asked for", async () => {
      const landing = await signIn(one, ada, { hint: ORG_GLOBEX, ignoreOrganizationHint: true });
      assert.equal(landing.error, "wrong_organization");
    });

    it("does not link an address known in one company from a token naming another organization", async () => {
      // Ben exists only in Globex; a token for Acme with his address must not reach Globex's account.
      const landing = await signIn(one, { sub: "sub-ben-at-acme", email: "ben@globex.example", organizationId: ORG_ACME });
      assert.equal(landing.error, "not_enrolled");
      assert.equal(await db.externalIdentity.count({ where: { subject: "sub-ben-at-acme" } }), 0);
    });

    it("a session of one company cannot read another company's records", async () => {
      const { token } = await signedIn(one, ada);
      const benEmployee = await db.employee.findFirstOrThrow({ where: { organizationId: companies.globex, user: { email: "ben@globex.example" } } });
      assert.equal((await call(one, token, `/api/employees/${benEmployee.id}`)).status, 404);
    });

    it("a WorkEasy360 session ends when its company is unbound from the organization it signed in for", async () => {
      const { token } = await signedIn(one, gina);
      assert.equal(await status(two, token), 200);
      await unlinkOrganization(db, "globex");
      try {
        assert.equal(await status(one, token), 401);
        assert.equal(await status(two, token), 401);
      } finally {
        await linkOrganization(db, "globex", ORG_GLOBEX);
      }
    });
  });

  describe("ID token checks, end to end (each refused, no session opened)", () => {
    const cases: Array<[string, AuthorizeOptions, string]> = [
      ["another issuer", { tweak: { iss: "https://evil.example" } }, "refused"],
      ["another audience", { tweak: { aud: "another-client" } }, "refused"],
      ["a signature the key set does not verify", { tweak: { strangerKey: true } }, "refused"],
      ["another nonce", { tweak: { nonce: "replayed-from-another-session" } }, "refused"],
      ["another product", { tweak: { productCode: "easy_crm" } }, "wrong_product"],
      ["no organization", { tweak: { omit: ["organization_id"] } }, "organization_missing"],
      ["an unverified address", { tweak: { extra: { email_verified: false } } }, "email_unverified"],
    ];
    for (const [name, options, code] of cases) {
      it(`${name} -> ${code}`, async () => {
        const before = await db.authSession.count();
        const landing = await signIn(one, { ...ada, sub: `sub-${randomUUID()}`, organizationId: ORG_INITECH }, options);
        assert.equal(landing.error, code);
        assert.equal(landing.browser.cookies.get("hrms_session"), undefined);
        assert.equal(await db.authSession.count(), before);
      });
    }
  });

  describe("entitlement", () => {
    it("refuses a sign-in for an organization that is not entitled", async () => {
      provider.setOrganizationAnswer(ORG_GLOBEX, { decision: "deny", reason: "not_entitled" });
      const landing = await signIn(one, ben);
      assert.equal(landing.error, "not_entitled");
      assert.equal(provider.entitlementCalls.at(-1)?.subject, "sub-ben", "asked for the person");
    });

    it("refuses a sign-in for a person without a seat", async () => {
      provider.setPersonAnswer(ORG_GLOBEX, "sub-ben", { decision: "deny", reason: "no_seat" });
      assert.equal((await signIn(two, ben)).error, "not_entitled");
    });

    it("ends access (but not the session) when the organization's entitlement ends", async () => {
      provider.setOrganizationAnswer(ORG_INITECH, { decision: "deny", reason: "expired" });
      const { accessToken } = await passwordSignIn(one, "ian@initech.example");
      const refused = await call(one, accessToken, "/api/organizations/current");
      assert.equal(refused.status, 403);
      assert.equal((refused.body as { code: string }).code, "WORKEASY360_ACCESS_ENDED");
      assert.equal((refused.body as { reason: string }).reason, "expired");
      assert.equal(await status(one, accessToken, "/api/auth/me"), 200, "the person can still see why and sign out");
    });

    it("allows reads and refuses writes while the subscription is read-only", async () => {
      provider.setOrganizationAnswer(ORG_HOOLI, { decision: "allow", reason: "entitled", write_allowed: false });
      const { accessToken } = await passwordSignIn(one, "hal@hooli.example");
      assert.equal(await status(one, accessToken), 200);
      const write = await call(one, accessToken, "/api/organizations/current", { method: "PATCH", body: { name: "Hooli XYZ" } });
      assert.equal(write.status, 403);
      assert.equal((write.body as { code: string }).code, "WORKEASY360_READ_ONLY");
    });
  });

  // --- ending sessions ---------------------------------------------------------------------------

  describe("back-channel logout", () => {
    it("a valid logout token ends the session: its unexpired access token is refused at once on both instances, and refresh fails", async () => {
      const session = await signedIn(one, ada, { sid: "sid-ada-bcl" });
      const exp = (jwt.decode(session.token) as { exp: number }).exp;
      assert.ok(exp - Date.now() / 1000 > 600, "the access token has many minutes left");
      assert.equal(await status(one, session.token), 200);
      assert.equal(await status(two, session.token), 200);

      const delivered = await deliver(two, await provider.logoutToken({ sub: ada.sub, sid: "sid-ada-bcl" }));
      assert.equal(delivered.status, 200);
      assert.equal(delivered.headers.get("cache-control"), "no-store");

      for (const api of [one, two]) {
        const refused = await call(api, session.token, "/api/organizations/current");
        assert.equal(refused.status, 401, `instance ${api.port}`);
        assert.equal((refused.body as { code: string }).code, "SESSION_ENDED");
        assert.equal((await call(api, session.token, "/api/auth/me")).status, 401);
      }
      assert.equal((await renew(one, session.browser)).status, 401, "refresh refused on the instance that issued it");
      assert.equal((await renew(two, session.browser)).status, 401, "and on the other");

      const row = await db.authSession.findUniqueOrThrow({ where: { id: familyOf(session.token) } });
      assert.ok(row.endedAt);
      assert.equal(row.endedReason, "workeasy360_logout");
      assert.equal(await db.refreshToken.count({ where: { familyId: row.id, revokedAt: null } }), 0);
    });

    it("ends only the sign-in it names", async () => {
      const ended = await signedIn(one, ada, { sid: "sid-ada-a" });
      const kept = await signedIn(one, ada, { sid: "sid-ada-b" });
      assert.equal((await deliver(one, await provider.logoutToken({ sub: ada.sub, sid: "sid-ada-a" }))).status, 200);
      assert.equal(await status(two, ended.token), 401);
      assert.equal(await status(two, kept.token), 200);
    });

    it("a token naming only the person ends every session of that person, however it was started", async () => {
      const sso = await signedIn(one, ben, { sid: "sid-ben-1" });
      const password = await passwordSignIn(two, "ben@globex.example", "globex");
      const bystander = await signedIn(one, gina);
      assert.equal((await deliver(one, await provider.logoutToken({ sub: ben.sub }))).status, 200);
      assert.equal(await status(one, sso.token, "/api/auth/me"), 401);
      assert.equal(await status(two, password.accessToken, "/api/auth/me"), 401);
      assert.equal(await status(two, bystander.token), 200, "somebody else is not affected");
    });

    it("answers a duplicate with 200 and does nothing again", async () => {
      const token = await provider.logoutToken({ sub: ada.sub, sid: "sid-ada-dup" });
      const first = await signedIn(one, ada, { sid: "sid-ada-dup" });
      assert.equal((await deliver(one, token)).status, 200);
      assert.equal(await status(one, first.token), 401);
      // The same person signs in again under the same WorkEasy360 sign-in; a replayed token is not a new instruction.
      const later = await signedIn(two, ada, { sid: "sid-ada-dup" });
      assert.equal((await deliver(two, token)).status, 200);
      assert.equal((await deliver(one, token)).status, 200);
      assert.equal(await status(one, later.token), 200);
      assert.equal(await db.workeasy360LogoutToken.count({ where: { jti: (jwt.decode(token) as { jti: string }).jti } }), 1);
    });

    const forged: Array<[string, () => Promise<string>]> = [
      ["a bad signature", () => provider.logoutToken({ sub: ada.sub }, { strangerKey: true })],
      ["another issuer", () => provider.logoutToken({ sub: ada.sub }, { iss: "https://evil.example" })],
      ["another audience", () => provider.logoutToken({ sub: ada.sub }, { aud: "another-client" })],
      ["the wrong typ", () => provider.logoutToken({ sub: ada.sub }, { typHeader: "JWT" })],
      ["no event", () => provider.logoutToken({ sub: ada.sub }, { omit: ["events"] })],
      ["a nonce", () => provider.logoutToken({ sub: ada.sub }, { extra: { nonce: "n" } })],
      ["an expired token", () => provider.logoutToken({ sub: ada.sub }, { iatOffset: -400, expOffset: -200 })],
    ];
    for (const [name, mint] of forged) {
      it(`refuses a logout token with ${name} (400) and ends nothing`, async () => {
        const session = await signedIn(one, ada);
        const reply = await deliver(two, await mint());
        assert.equal(reply.status, 400);
        assert.deepEqual(reply.body, { error: "invalid_request" });
        assert.equal(await status(one, session.token), 200);
        assert.equal((await renew(one, session.browser)).status, 200);
      });
    }

    it("refuses a request without a logout_token form field", async () => {
      assert.equal((await new Browser().request(`${one.url}/api/auth/workeasy360/backchannel-logout`, { method: "POST", form: {} })).status, 400);
      const json = await new Browser().request(`${one.url}/api/auth/workeasy360/backchannel-logout`, {
        method: "POST",
        body: JSON.stringify({ logout_token: await provider.logoutToken({ sub: ada.sub }) }),
      });
      assert.equal(json.status, 400);
    });
  });

  describe("signing out", () => {
    it("product sign-out ends the session at once everywhere; WorkEasy360 sign-out goes through end_session_endpoint", async () => {
      const session = await signedIn(one, ada);
      const out = await session.browser.request(`${two.url}/api/auth/logout`, {
        method: "POST",
        headers: { "x-hrms-session": "cookie", authorization: `Bearer ${session.token}` },
        body: "{}",
      });
      assert.equal(out.status, 204);
      assert.equal(session.browser.cookies.get("hrms_session"), undefined, "the cookie is cleared");
      assert.equal(await status(one, session.token), 401);
      assert.equal(await status(two, session.token), 401);

      const away = await new Browser().request(`${one.url}/api/auth/workeasy360/logout`);
      assert.equal(away.status, 302);
      const target = new URL(away.location);
      assert.equal(`${target.origin}${target.pathname}`, `${provider.issuer}/logout`);
      assert.equal(target.searchParams.get("client_id"), provider.clientId);
      assert.equal(target.searchParams.get("post_logout_redirect_uri"), `${APP}/login`);
    });

    it("two tabs renewing from the one cookie at the same moment both get an access token, and the session stays open", async () => {
      const session = await signedIn(one, ada);
      const cookie = session.browser.cookies.get("hrms_session")!;
      const [tabA, tabB] = [new Browser(), new Browser()];
      tabA.cookies.set("hrms_session", cookie);
      tabB.cookies.set("hrms_session", cookie);
      const [a, b] = await Promise.all([renew(one, tabA), renew(two, tabB)]);
      assert.equal(a.status, 200, JSON.stringify(a.body));
      assert.equal(b.status, 200, JSON.stringify(b.body));
      assert.equal(await status(one, a.token), 200);
      assert.equal(await status(two, b.token), 200);
    });

    it("a password refresh token used twice is still treated as stolen: the whole session ends", async () => {
      const tokens = await passwordSignIn(one, "gina@globex.example");
      const first = await new Browser().request(`${one.url}/api/auth/refresh`, { method: "POST", body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
      assert.equal(first.status, 200);
      const reused = await new Browser().request(`${two.url}/api/auth/refresh`, { method: "POST", body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
      assert.equal(reused.status, 401);
      assert.equal(await status(one, (first.body as { accessToken: string }).accessToken), 401);
    });

    it("a new sign-in in the same browser ends the session that browser held", async () => {
      const first = await signedIn(one, ada);
      const second = await signedIn(one, gina, { browser: first.browser });
      assert.equal(await status(one, first.token), 401);
      assert.equal(await status(one, second.token), 200);
    });

    it("an exit ends the session and refuses the next WorkEasy360 sign-in", async () => {
      const employee = await addEmployee(companies.globex, "eve@globex.example", "Eve", "EMP-0099");
      const eve: Identity = { sub: "sub-eve", email: "eve@globex.example", organizationId: ORG_GLOBEX };
      const session = await signedIn(one, eve);
      const { userId } = await db.employee.findUniqueOrThrow({ where: { id: employee } });
      await db.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
      const refused = await call(two, session.token, "/api/auth/me");
      assert.equal(refused.status, 401);
      assert.equal((refused.body as { code: string }).code, "ACCOUNT_DISABLED");
      assert.equal((await signIn(one, eve)).error, "account_disabled");
    });
  });

  describe("password sign-in (kept for live customers)", () => {
    it("still works, and its sign-out now ends its access token at once", async () => {
      const tokens = await passwordSignIn(one, "gina@globex.example");
      assert.equal(await status(two, tokens.accessToken), 200);
      const renewed = await new Browser().request(`${two.url}/api/auth/refresh`, { method: "POST", body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
      assert.equal(renewed.status, 200);
      const next = renewed.body as { accessToken: string; refreshToken: string };
      assert.equal((await new Browser().request(`${one.url}/api/auth/logout`, { method: "POST", body: JSON.stringify({ refreshToken: next.refreshToken }) })).status, 204);
      assert.equal(await status(one, tokens.accessToken), 401);
      assert.equal(await status(two, next.accessToken), 401);
    });

    it("an access token from before this release (no session id) is refused, and its refresh token renews it once", async () => {
      const user = await db.user.findFirstOrThrow({ where: { email: "gina@globex.example" } });
      const legacyAccess = jwt.sign(
        { sub: user.id, organizationId: user.organizationId, employeeId: null, roles: ["Admin"], permissions: [] },
        process.env.JWT_ACCESS_SECRET!,
        { expiresIn: "15m", audience: "access" },
      );
      const refused = await call(one, legacyAccess, "/api/organizations/current");
      assert.equal(refused.status, 401);
      assert.equal((refused.body as { code: string }).code, "SESSION_ENDED");

      // Its refresh token (a family with no recorded session) renews once, into a recorded session.
      const familyId = randomUUID();
      const row = await db.refreshToken.create({ data: { userId: user.id, familyId, expiresAt: new Date(Date.now() + 86_400_000) } });
      const legacyRefresh = jwt.sign({ sub: user.id, fam: familyId }, process.env.JWT_REFRESH_SECRET!, {
        expiresIn: "7d",
        audience: "refresh",
        jwtid: row.id,
      });
      const renewed = await new Browser().request(`${two.url}/api/auth/refresh`, { method: "POST", body: JSON.stringify({ refreshToken: legacyRefresh }) });
      assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
      const access = (renewed.body as { accessToken: string }).accessToken;
      assert.equal(familyOf(access), familyId);
      assert.equal(await status(one, access), 200);
      assert.equal((await db.authSession.findUniqueOrThrow({ where: { id: familyId } })).method, "PASSWORD");
    });

    it("WORKEASY360_SSO_ONLY=true turns password sign-in off and refuses password sessions", async () => {
      const login = await new Browser().request(`${ssoOnly.url}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email: "gina@globex.example", password: PASSWORD }),
      });
      assert.equal(login.status, 403);
      assert.equal((login.body as { code: string }).code, "PASSWORD_SIGN_IN_DISABLED");
      const { accessToken } = await passwordSignIn(one, "gina@globex.example");
      const refused = await call(ssoOnly, accessToken, "/api/auth/me");
      assert.equal(refused.status, 401);
      assert.equal((refused.body as { code: string }).code, "WORKEASY360_SIGN_IN_REQUIRED");
      const config = (await new Browser().request(`${ssoOnly.url}/api/auth/config`)).body as { passwordSignIn: boolean; workeasy360: { enabled: boolean } };
      assert.equal(config.passwordSignIn, false);
      assert.equal(config.workeasy360.enabled, true);
      const { token } = await signedIn(ssoOnly, gina);
      assert.equal(await status(ssoOnly, token), 200, "WorkEasy360 sign-in works");
    });
  });

  describe("last: a refused client", () => {
    it("fails closed when WorkEasy360 refuses this product's own client", async () => {
      // Last, on the SSO-only instance: its cache now counts the client as refused for 60 s.
      const { token } = await signedIn(ssoOnly, gina);
      provider.entitlementFailure = 401;
      const landing = await signIn(ssoOnly, { ...ada, sub: "sub-refused" });
      assert.equal(landing.error, "access_unverified");
      // Every other question of that instance fails closed too, without asking.
      const refused = await call(ssoOnly, token, "/api/organizations/current");
      assert.equal(refused.status, 403);
      assert.equal((refused.body as { code: string }).code, "WORKEASY360_ACCESS_UNVERIFIED");
    });
  });
});
