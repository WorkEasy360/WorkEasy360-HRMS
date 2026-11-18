import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { Workeasy360Client, type VerifiedIdToken } from "./client";
import { SsoRefusal, Workeasy360Error } from "./errors";
import { BACKCHANNEL_EVENT, FakeWorkeasy360, productKeyPair, type AuthorizeOptions, type Identity } from "./testing/fakeProvider";

/**
 * The WorkEasy360 client against a fake provider in this process (keys generated now): the
 * Authorization Code + PKCE flow with private_key_jwt, every ID token check of the contract,
 * back-channel logout token verification and the entitlement call. No database.
 */

const REDIRECT = "http://127.0.0.1:65001/api/auth/callback/workeasy360";
const ORG = "3f1f6a3e-1f0e-4d6a-9c50-4c0a1c1e0b11";
const ada: Identity = { sub: "sub-ada", email: "ada@acme.example", name: "Ada Admin", organizationId: ORG, organizationName: "Acme" };

let provider: FakeWorkeasy360;
let client: Workeasy360Client;
const keys = productKeyPair();

function newClient(overrides: Partial<{ issuer: string; productCode: string }> = {}): Workeasy360Client {
  return new Workeasy360Client({
    issuer: overrides.issuer ?? provider.issuer,
    clientId: provider.clientId,
    redirectUri: REDIRECT,
    keyId: provider.keyId,
    productCode: overrides.productCode ?? "workeasy_hrms",
    scopes: ["openid", "email", "profile", "organization"],
    privateKeyPem: () => keys.privatePem,
  });
}

before(async () => {
  provider = await FakeWorkeasy360.start({ redirectUris: [REDIRECT], appPublicKey: keys.publicKey });
  client = newClient();
});
after(() => provider.stop());
beforeEach(() => provider.reset());

/** The browser's round trip: start, sign in at the provider, back to the callback. */
async function signIn(identity: Identity = ada, options: AuthorizeOptions = {}): Promise<VerifiedIdToken> {
  const request = await client.authorizationRequest();
  const authorization = provider.authorize(request.url, identity, options);
  assert.ok(authorization.ok, `the provider refused: ${authorization.ok ? "" : authorization.error}`);
  const query = new URL(authorization.callbackUrl).searchParams;
  return client.complete({ query, expectedState: request.state, nonce: request.nonce, codeVerifier: request.codeVerifier });
}

async function refusedWith(promise: Promise<unknown>, expected: { code: string; type?: "client" | "refusal" }): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    if (expected.type === "refusal") {
      assert.ok(error instanceof SsoRefusal, `expected an SsoRefusal, got ${String(error)}`);
    } else {
      assert.ok(error instanceof Workeasy360Error, `expected a Workeasy360Error, got ${String(error)}`);
    }
    assert.equal((error as { code: string }).code, expected.code, String(error));
    return true;
  });
}

describe("sign-in: Authorization Code + PKCE with private_key_jwt", () => {
  it("returns the verified claims of a good ID token", async () => {
    const claims = await signIn();
    assert.equal(claims.sub, "sub-ada");
    assert.equal(claims.organization_id, ORG);
    assert.equal(claims.product_code, "workeasy_hrms");
    assert.equal(claims.email_verified, true);
    assert.equal(claims.iss, provider.issuer);
  });

  it("asks with PKCE S256, a state, a nonce and the openid and email scopes", async () => {
    const request = await client.authorizationRequest({ organizationId: ORG });
    const params = new URL(request.url).searchParams;
    assert.equal(params.get("response_type"), "code");
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.equal(params.get("code_challenge"), createHash("sha256").update(request.codeVerifier).digest("base64url"));
    assert.equal(params.get("state"), request.state);
    assert.equal(params.get("nonce"), request.nonce);
    assert.equal(params.get("redirect_uri"), REDIRECT);
    assert.equal(params.get("organization"), ORG);
    const scopes = (params.get("scope") ?? "").split(" ");
    assert.ok(scopes.includes("openid") && scopes.includes("email"));
    assert.ok(request.state.length >= 32 && request.nonce.length >= 32 && request.codeVerifier.length >= 43);
  });

  it("authenticates the code exchange with a client assertion: iss = sub = client id, aud = token endpoint, 60 s, fresh jti", async () => {
    await signIn();
    await signIn();
    const [first, second] = provider.tokenRequests;
    assert.ok(first.assertionOk && first.pkceOk && second.assertionOk);
    assert.equal(first.assertion!.aud, provider.tokenEndpoint);
    assert.equal(first.assertion!.iss, provider.clientId);
    assert.equal(first.assertion!.sub, provider.clientId);
    assert.ok(Number(first.assertion!.exp) - Number(first.assertion!.iat) <= 60);
    assert.notEqual(first.assertion!.jti, second.assertion!.jti);
  });

  it("spends a code once", async () => {
    const request = await client.authorizationRequest();
    const authorization = provider.authorize(request.url, ada);
    assert.ok(authorization.ok);
    const query = new URL(authorization.callbackUrl).searchParams;
    const input = { query, expectedState: request.state, nonce: request.nonce, codeVerifier: request.codeVerifier };
    await client.complete(input);
    await refusedWith(client.complete(input), { code: "sign_in_refused" });
  });

  it("refuses a code exchanged with another PKCE verifier", async () => {
    const request = await client.authorizationRequest();
    const authorization = provider.authorize(request.url, ada);
    assert.ok(authorization.ok);
    const query = new URL(authorization.callbackUrl).searchParams;
    const other = await client.authorizationRequest();
    await refusedWith(
      client.complete({ query, expectedState: request.state, nonce: request.nonce, codeVerifier: other.codeVerifier }),
      { code: "sign_in_refused" },
    );
    assert.equal(provider.tokenRequests.at(-1)?.pkceOk, false);
  });

  it("refuses a callback whose state is not the flow's", async () => {
    const request = await client.authorizationRequest();
    const authorization = provider.authorize(request.url, ada);
    assert.ok(authorization.ok);
    const query = new URL(authorization.callbackUrl).searchParams;
    await assert.rejects(client.complete({ query, expectedState: "another-state", nonce: request.nonce, codeVerifier: request.codeVerifier }));
    assert.equal(provider.tokenRequests.length, 0, "no code is exchanged for a callback that is not ours");
  });

  it("refuses a discovery document that names another issuer (exact comparison, no trailing slash)", async () => {
    const strict = newClient({ issuer: `${provider.issuer}/` });
    await refusedWith(strict.authorizationRequest(), { code: "provider_misconfigured" });
  });
});

describe("sign-in: every ID token check", () => {
  const cases: Array<[string, AuthorizeOptions, { code: string; type?: "client" | "refusal" }]> = [
    ["another issuer", { tweak: { iss: "https://evil.example" } }, { code: "invalid_token" }],
    ["another audience", { tweak: { aud: "another-client" } }, { code: "invalid_token" }],
    ["an extra audience", { tweak: { aud: ["hrms-client-id", "another-client"] } }, { code: "invalid_token" }],
    ["a signature by a key the key set does not hold (same kid)", { tweak: { strangerKey: true } }, { code: "invalid_token" }],
    ["a kid the key set does not hold", { tweak: { unknownKey: true } }, { code: "invalid_token" }],
    ["alg none", { tweak: { alg: "none" } }, { code: "invalid_token" }],
    ["HS256 with the public key as the secret", { tweak: { alg: "HS256" } }, { code: "invalid_token" }],
    ["another nonce", { tweak: { nonce: "somebody-elses-nonce" } }, { code: "invalid_token" }],
    ["no nonce", { tweak: { omit: ["nonce"] } }, { code: "invalid_token" }],
    ["an expired token", { tweak: { expOffset: -120, iatOffset: -420 } }, { code: "invalid_token" }],
    ["an iat in the future", { tweak: { iatOffset: 600, expOffset: 900 } }, { code: "invalid_token" }],
    ["an access token presented as an ID token", { tweak: { typ: "access_token" } }, { code: "invalid_token" }],
    ["another product", { tweak: { productCode: "easy_crm" } }, { code: "wrong_product", type: "refusal" }],
    ["no product code", { tweak: { omit: ["product_code"] } }, { code: "wrong_product", type: "refusal" }],
    ["no organization", { tweak: { omit: ["organization_id"] } }, { code: "organization_missing", type: "refusal" }],
    ["an unverified email", { tweak: { extra: { email_verified: false } } }, { code: "email_unverified", type: "refusal" }],
    ["no email", { tweak: { omit: ["email", "email_verified"] } }, { code: "email_unverified", type: "refusal" }],
  ];
  for (const [name, options, expected] of cases) {
    it(`refuses ${name}`, async () => {
      await refusedWith(signIn(ada, options), expected);
    });
  }

  it("refuses a token for another product even when the audience is right (configured product code)", async () => {
    const crm = newClient({ productCode: "easy_crm" });
    const request = await crm.authorizationRequest();
    const authorization = provider.authorize(request.url, ada);
    assert.ok(authorization.ok);
    await refusedWith(
      crm.complete({
        query: new URL(authorization.callbackUrl).searchParams,
        expectedState: request.state,
        nonce: request.nonce,
        codeVerifier: request.codeVerifier,
      }),
      { code: "wrong_product", type: "refusal" },
    );
  });
});

describe("back-channel logout token verification", () => {
  it("accepts a token naming a sign-in (sid) or a person (sub)", async () => {
    const bySid = await client.verifyLogoutToken(await provider.logoutToken({ sub: "sub-ada", sid: "sid-1" }));
    assert.equal(bySid.sid, "sid-1");
    assert.equal(bySid.sub, "sub-ada");
    assert.ok(bySid.jti.length > 0);
    const bySub = await client.verifyLogoutToken(await provider.logoutToken({ sub: "sub-ada" }));
    assert.equal(bySub.sid, undefined);
    assert.equal(bySub.sub, "sub-ada");
  });

  it("accepts the application/ prefixed typ header", async () => {
    await client.verifyLogoutToken(await provider.logoutToken({ sub: "sub-ada" }, { typHeader: "application/logout+jwt" }));
  });

  const forged: Array<[string, () => Promise<string>]> = [
    ["a bad signature", () => provider.logoutToken({ sub: "sub-ada" }, { strangerKey: true })],
    ["another issuer", () => provider.logoutToken({ sub: "sub-ada" }, { iss: "https://evil.example" })],
    ["another audience", () => provider.logoutToken({ sub: "sub-ada" }, { aud: "another-client" })],
    ["the typ header of a plain JWT", () => provider.logoutToken({ sub: "sub-ada" }, { typHeader: "JWT" })],
    ["no typ header", () => provider.logoutToken({ sub: "sub-ada" }, { typHeader: null })],
    ["a typ claim of an ID token", () => provider.logoutToken({ sub: "sub-ada" }, { typ: "id_token" })],
    ["no events", () => provider.logoutToken({ sub: "sub-ada" }, { omit: ["events"] })],
    ["events without the back-channel event", () => provider.logoutToken({ sub: "sub-ada" }, { events: { "urn:other": {} } })],
    ["the event as a string", () => provider.logoutToken({ sub: "sub-ada" }, { events: { [BACKCHANNEL_EVENT]: "yes" } })],
    ["a nonce", () => provider.logoutToken({ sub: "sub-ada" }, { extra: { nonce: "n" } })],
    ["neither sub nor sid", () => provider.logoutToken({})],
    ["no jti", () => provider.logoutToken({ sub: "sub-ada" }, { omit: ["jti"] })],
    ["an expired token", () => provider.logoutToken({ sub: "sub-ada" }, { iatOffset: -300, expOffset: -100 })],
    ["a token issued long ago", () => provider.logoutToken({ sub: "sub-ada" }, { iatOffset: -1200, expOffset: 300 })],
    ["an iat in the future", () => provider.logoutToken({ sub: "sub-ada" }, { iatOffset: 600, expOffset: 720 })],
  ];
  for (const [name, mint] of forged) {
    it(`refuses ${name}`, async () => {
      await refusedWith(client.verifyLogoutToken(await mint()), { code: "invalid_token" });
    });
  }

  it("refuses an ID token presented as a logout token", async () => {
    // Same key, same audience: the typ header and the nonce are what tell them apart.
    const request = await client.authorizationRequest();
    const authorization = provider.authorize(request.url, ada);
    assert.ok(authorization.ok);
    const minted = await (provider as unknown as { mintIdToken(i: unknown): Promise<string> }).mintIdToken({
      identity: ada,
      tweak: {},
      nonce: "n",
      sid: "sid-1",
    });
    await refusedWith(client.verifyLogoutToken(minted), { code: "invalid_token" });
  });

  it("reports an unreadable key set as an outage, not an invalid token", async () => {
    const fresh = newClient();
    provider.jwksFailure = 503;
    await refusedWith(fresh.verifyLogoutToken(await provider.logoutToken({ sub: "sub-ada" })), { code: "provider_unavailable" });
  });
});

describe("the entitlement endpoint", () => {
  it("asks with a client assertion, for the person, and returns the answer", async () => {
    const answer = await client.verifyEntitlement(ORG, { subject: "sub-ada" });
    assert.deepEqual(answer, { decision: "allow", reason: "entitled", writeAllowed: true, revalidateAfter: 900 });
    const call = provider.entitlementCalls.at(-1)!;
    assert.equal(call.organizationId, ORG);
    assert.equal(call.subject, "sub-ada");
    assert.ok(call.assertionOk);
  });

  it("returns a denial as an answer", async () => {
    provider.setOrganizationAnswer(ORG, { decision: "deny", reason: "expired", revalidate_after: 600 });
    assert.deepEqual(await client.verifyEntitlement(ORG), { decision: "deny", reason: "expired", writeAllowed: false, revalidateAfter: 600 });
  });

  it("reports a refusal of the client (401/403) as provider_refused and an outage (503) as provider_unavailable", async () => {
    provider.entitlementFailure = 403;
    await refusedWith(client.verifyEntitlement(ORG), { code: "provider_refused" });
    provider.entitlementFailure = 503;
    await refusedWith(client.verifyEntitlement(ORG), { code: "provider_unavailable" });
    provider.entitlementFailure = 429;
    await refusedWith(client.verifyEntitlement(ORG), { code: "rate_limited" });
  });
});

describe("WorkEasy360 sign-out", () => {
  it("builds the end_session_endpoint URL with the client id and the registered post-logout URI", async () => {
    const url = new URL(await client.endSessionUrl("http://localhost:3000/login"));
    assert.equal(`${url.origin}${url.pathname}`, `${provider.issuer}/logout`);
    assert.equal(url.searchParams.get("client_id"), provider.clientId);
    assert.equal(url.searchParams.get("post_logout_redirect_uri"), "http://localhost:3000/login");
  });
});
