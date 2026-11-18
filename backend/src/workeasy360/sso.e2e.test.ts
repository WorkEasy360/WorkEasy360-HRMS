import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../utils/organizationSetup";
import { linkOrganization, linkUser, OperatorError, unlinkOrganization } from "./operator";
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
const OPERATOR = { actor: "ops@workeasy360.example", reason: "ticket HR-1: confirmed with the customer's HR lead" };

const skip = TEST_DATABASE_URL ? false : "set HRMS_TEST_DATABASE_URL to run the end-to-end WorkEasy360 tests";

describe("WorkEasy360 sign-in, sessions and back-channel logout (two API instances, shared PostgreSQL)", { skip }, () => {
  let schema: TestSchema;
  let db: PrismaClient;
  let provider: FakeWorkeasy360;
  let one: Api;
  let two: Api;
  let ssoOnly: Api;
  /** An instance with WORKEASY360_LINK_BY_VERIFIED_EMAIL=true (the others keep the default, off). */
  let autoLink: Api;
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
      WORKEASY360_LINK_BY_VERIFIED_EMAIL: "false",
      WORKEASY360_SIGN_IN_RATE_LIMIT: "10000",
      COOKIE_SECURE: "",
    };
    process.env.JWT_ACCESS_SECRET = env.JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = env.JWT_REFRESH_SECRET;
    // Started one after the other: the first seeds the permission catalog.
    one = await startApi(env, portOne);
    two = await startApi(env);
    ssoOnly = await startApi({ ...env, WORKEASY360_SSO_ONLY: "true" });
    autoLink = await startApi({ ...env, WORKEASY360_LINK_BY_VERIFIED_EMAIL: "true" });

    // Existing HRMS companies with password accounts (as live customers have them today).
    companies.globex = await existingCompany("Globex", "globex", "gina@globex.example");
    await addEmployee(companies.globex, "ben@globex.example", "Ben", "EMP-0002");
    await linkOrganization(db, "globex", ORG_GLOBEX);
    companies.initech = await existingCompany("Initech", "initech", "ian@initech.example");
    await linkOrganization(db, "initech", ORG_INITECH);
    companies.hooli = await existingCompany("Hooli", "hooli", "hal@hooli.example");
    await linkOrganization(db, "hooli", ORG_HOOLI);
    // Existing people are linked by the operator (an email match alone never links by default).
    await vouch(gina);
    await vouch(ben);
  });

  after(async () => {
    await Promise.all([one?.stop(), two?.stop(), ssoOnly?.stop(), autoLink?.stop()]);
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

  /** The operator links an existing account to the person's WorkEasy360 identity. */
  function vouch(identity: Identity, organizationId = identity.organizationId) {
    const email = identity.email ?? "";
    return linkUser(db, { email, subject: identity.sub, workeasy360OrganizationId: organizationId, issuer: provider.issuer, ...OPERATOR });
  }

  function linkAudits(userId: string) {
    return db.auditLog.findMany({ where: { action: "user.workeasy360_linked", entityId: userId }, orderBy: { createdAt: "asc" } });
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

  it("an employee the operator linked signs in to their own account, keeping their HRMS role and password", async () => {
    const { token } = await signedIn(one, ben);
    const me = (await call(one, token, "/api/auth/me")).body as { roles: string[]; email: string; hasPassword: boolean };
    assert.deepEqual(me.roles, ["Employee"]);
    assert.equal(me.email, "ben@globex.example");
    assert.equal(me.hasPassword, true, "linking keeps the password: password sign-in still works for live customers");
    await passwordSignIn(two, "ben@globex.example", "globex");
    assert.equal((await call(one, token, "/api/employees")).status, 403, "permissions come from the HRMS role, not from WorkEasy360");
    const link = await db.externalIdentity.findFirstOrThrow({ where: { subject: "sub-ben" } });
    assert.equal(link.organizationId, companies.globex);
    assert.equal(link.issuer, provider.issuer);
  });

  it("an account already linked to another WorkEasy360 identity is not taken over (setting off or on)", async () => {
    for (const api of [one, autoLink]) {
      const impostor = await signIn(api, { ...ben, sub: "sub-somebody-else" });
      assert.equal(impostor.error, "account_conflict");
    }
    assert.equal(await db.externalIdentity.count({ where: { subject: "sub-somebody-else" } }), 0);
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
      // Ben exists only in Globex; a token for Acme with his address must not reach Globex's account,
      // whether or not automatic linking is on.
      for (const api of [one, autoLink]) {
        const landing = await signIn(api, { sub: "sub-ben-at-acme", email: "ben@globex.example", organizationId: ORG_ACME });
        assert.equal(landing.error, "not_enrolled");
      }
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
      await unlinkOrganization(db, "globex", OPERATOR);
      try {
        assert.equal(await status(one, token), 401);
        assert.equal(await status(two, token), 401);
        const unbound = await db.auditLog.findFirstOrThrow({ where: { action: "organization.workeasy360_unbound", entityId: companies.globex } });
        assert.deepEqual(unbound.before, { workeasy360OrganizationId: ORG_GLOBEX });
        assert.deepEqual(unbound.after, { via: "operator", ...OPERATOR });
        // Its links went with the binding: a sign-in now finds an unlinked account and is refused.
        await linkOrganization(db, "globex", ORG_GLOBEX, OPERATOR);
        assert.equal((await signIn(one, gina)).error, "account_conflict");
      } finally {
        await linkOrganization(db, "globex", ORG_GLOBEX);
        await vouch(gina);
        await vouch(ben);
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

  // --- linking existing accounts ---------------------------------------------------------------

  describe("linking an existing account", () => {
    it("by default an email match is refused (account_conflict): nothing is linked, the account and its password stay", async () => {
      await addEmployee(companies.globex, "dora@globex.example", "Dora", "EMP-0101");
      const dora: Identity = { sub: "sub-dora", email: "dora@globex.example", organizationId: ORG_GLOBEX };
      const before = await db.authSession.count();
      const landing = await signIn(one, dora);
      assert.equal(landing.error, "account_conflict");
      assert.equal(landing.browser.cookies.get("hrms_session"), undefined);
      assert.equal(await db.authSession.count(), before, "no session opened");
      const user = await db.user.findFirstOrThrow({ where: { organizationId: companies.globex, email: "dora@globex.example" } });
      assert.equal(await db.externalIdentity.count({ where: { userId: user.id } }), 0, "no automatic merge");
      assert.equal((await linkAudits(user.id)).length, 0);
      assert.ok(user.passwordHash, "the password is untouched");
      await passwordSignIn(two, "dora@globex.example", "globex");
    });

    it("with WORKEASY360_LINK_BY_VERIFIED_EMAIL=true, the bound company's unlinked account with the verified address is linked, and audited", async () => {
      await addEmployee(companies.globex, "fay@globex.example", "Fay", "EMP-0102");
      const fay: Identity = { sub: "sub-fay", email: "fay@globex.example", organizationId: ORG_GLOBEX };
      const { token } = await signedIn(autoLink, fay);
      const me = (await call(autoLink, token, "/api/auth/me")).body as { id: string; roles: string[]; hasPassword: boolean };
      assert.deepEqual(me.roles, ["Employee"]);
      assert.equal(me.hasPassword, true, "the password stays");
      const link = await db.externalIdentity.findFirstOrThrow({ where: { userId: me.id } });
      assert.equal(link.subject, "sub-fay");
      assert.equal(link.issuer, provider.issuer);
      assert.equal(link.organizationId, companies.globex);
      const audits = await linkAudits(me.id);
      assert.equal(audits.length, 1);
      assert.equal(audits[0].organizationId, companies.globex);
      assert.equal(audits[0].actorUserId, me.id);
      assert.deepEqual(audits[0].after, {
        issuer: provider.issuer,
        subject: "sub-fay",
        email: "fay@globex.example",
        workeasy360OrganizationId: ORG_GLOBEX,
        via: "automatic",
      });
      // Later sign-ins (on any instance) go by (issuer, sub) and do not link or audit again.
      await signedIn(one, fay);
      assert.equal((await linkAudits(me.id)).length, 1);
    });

    it("with the setting on, only the account of the company bound to the token's organization is linked, never another company's", async () => {
      // The same address in two companies: Initech's sign-in links Initech's account only.
      await addEmployee(companies.globex, "sam@shared.example", "Sam", "EMP-0103");
      await addEmployee(companies.initech, "sam@shared.example", "Sam", "EMP-0201");
      const sam: Identity = { sub: "sub-sam", email: "sam@shared.example", organizationId: ORG_INITECH };
      await signedIn(autoLink, sam);
      const [globexSam, initechSam] = await Promise.all([
        db.user.findFirstOrThrow({ where: { organizationId: companies.globex, email: "sam@shared.example" }, include: { externalIdentities: true } }),
        db.user.findFirstOrThrow({ where: { organizationId: companies.initech, email: "sam@shared.example" }, include: { externalIdentities: true } }),
      ]);
      assert.equal(initechSam.externalIdentities.length, 1);
      assert.equal(globexSam.externalIdentities.length, 0, "the other company's account is never linked");
      assert.equal((await linkAudits(globexSam.id)).length, 0);

      // An address known only in another company is not enrolled here, and links nothing there.
      const cross = await signIn(autoLink, { sub: "sub-dora-at-initech", email: "dora@globex.example", organizationId: ORG_INITECH });
      assert.equal(cross.error, "not_enrolled");
      assert.equal(await db.externalIdentity.count({ where: { subject: "sub-dora-at-initech" } }), 0);
    });

    it("with the setting on, an account that is already linked is never re-linked (another identity, or another issuer)", async () => {
      // Ben is linked to sub-ben (above); a different WorkEasy360 identity with his address is refused.
      const ben2 = await signIn(autoLink, { ...ben, sub: "sub-ben-second" });
      assert.equal(ben2.error, "account_conflict");
      // An account linked under the previous issuer name (before move-issuer ran) is not linked a second time.
      await addEmployee(companies.globex, "olga@globex.example", "Olga", "EMP-0104");
      const olga = await db.user.findFirstOrThrow({ where: { organizationId: companies.globex, email: "olga@globex.example" } });
      await db.externalIdentity.create({ data: { organizationId: companies.globex, userId: olga.id, issuer: "https://auth.previous.example", subject: "sub-olga" } });
      const landing = await signIn(autoLink, { sub: "sub-olga", email: "olga@globex.example", organizationId: ORG_GLOBEX });
      assert.equal(landing.error, "account_conflict");
      assert.equal(await db.externalIdentity.count({ where: { userId: olga.id } }), 1);
      assert.equal((await linkAudits(olga.id)).length, 0);
    });

    it("the operator's link-user links an existing account, audited with who and why; the person then signs in with the setting off", async () => {
      await addEmployee(companies.globex, "hugo@globex.example", "Hugo", "EMP-0105");
      const hugo: Identity = { sub: "sub-hugo", email: "Hugo@Globex.example", organizationId: ORG_GLOBEX };
      const linked = await vouch(hugo);
      assert.equal(linked.changed, true);
      const user = await db.user.findFirstOrThrow({ where: { organizationId: companies.globex, email: "hugo@globex.example" } });
      assert.equal(linked.user.id, user.id);
      assert.ok(user.passwordHash, "the password is left as it is");
      const audits = await linkAudits(user.id);
      assert.equal(audits.length, 1);
      assert.equal(audits[0].organizationId, companies.globex);
      assert.equal(audits[0].actorUserId, null, "the operator is not an HRMS user; who is recorded as the actor");
      assert.ok(audits[0].createdAt instanceof Date);
      assert.deepEqual(audits[0].after, {
        issuer: provider.issuer,
        subject: "sub-hugo",
        email: "hugo@globex.example",
        workeasy360OrganizationId: ORG_GLOBEX,
        via: "operator",
        ...OPERATOR,
      });
      const { token } = await signedIn(one, hugo);
      assert.equal(((await call(one, token, "/api/auth/me")).body as { id: string }).id, user.id);
      // Running it again changes nothing and writes no second record.
      assert.equal((await vouch(hugo)).changed, false);
      assert.equal((await linkAudits(user.id)).length, 1);
    });

    it("link-user refuses conflicts and incomplete requests, and changes nothing", async () => {
      await addEmployee(companies.globex, "ivy@globex.example", "Ivy", "EMP-0106");
      const ivy: Identity = { sub: "sub-ivy", email: "ivy@globex.example", organizationId: ORG_GLOBEX };
      const refusals: Array<[string, () => Promise<unknown>, RegExp]> = [
        ["the account is linked to another identity", () => vouch({ ...ben, sub: "sub-ben-other" }), /already linked/],
        ["the identity is linked to another account", () => vouch({ ...ivy, sub: "sub-ben" }), /already linked to ben@globex\.example/],
        ["the account is not in the company bound to the organization", () => vouch({ ...ivy, organizationId: ORG_INITECH }), /has no account with the address/],
        ["no company is bound to the organization", () => vouch({ ...ivy, organizationId: randomUUID() }), /No HRMS company is bound/],
        ["the organization is not a UUID", () => vouch({ ...ivy, organizationId: "globex" }), /must be a UUID/],
        ["no actor", () => linkUser(db, { email: "ivy@globex.example", subject: ivy.sub, workeasy360OrganizationId: ORG_GLOBEX, issuer: provider.issuer, actor: " ", reason: "r" }), /--actor is required/],
        ["no reason", () => linkUser(db, { email: "ivy@globex.example", subject: ivy.sub, workeasy360OrganizationId: ORG_GLOBEX, issuer: provider.issuer, actor: "a", reason: "" }), /--reason is required/],
        ["no issuer", () => linkUser(db, { email: "ivy@globex.example", subject: ivy.sub, workeasy360OrganizationId: ORG_GLOBEX, issuer: "", ...OPERATOR }), /issuer is unknown/],
      ];
      const linksBefore = await db.externalIdentity.count();
      const auditsBefore = await db.auditLog.count({ where: { action: "user.workeasy360_linked" } });
      for (const [name, attempt, message] of refusals) {
        await assert.rejects(attempt(), (error: unknown) => error instanceof OperatorError && message.test(error.message), name);
      }
      assert.equal(await db.externalIdentity.count(), linksBefore);
      assert.equal(await db.auditLog.count({ where: { action: "user.workeasy360_linked" } }), auditsBefore);
      assert.equal((await signIn(one, ivy)).error, "account_conflict", "Ivy is still unlinked");
    });

    it("binding a company is audited", async () => {
      const bound = await db.auditLog.findFirstOrThrow({ where: { action: "organization.workeasy360_bound", entityId: companies.hooli } });
      assert.deepEqual(bound.after, { workeasy360OrganizationId: ORG_HOOLI, via: "operator", actor: null, reason: null });
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
      await vouch(eve);
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
