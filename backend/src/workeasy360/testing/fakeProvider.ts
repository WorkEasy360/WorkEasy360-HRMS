import { createHash, createPublicKey, generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { libraries, type Jose } from "../esm";

/**
 * A stand-in for WorkEasy360 Accounts, for tests only: Node's http module and keys generated
 * when it starts, living in the test process. Discovery, the key set, a token endpoint that
 * really verifies the client assertion (private_key_jwt: signed by the product's key, iss =
 * sub = client id, aud = the token endpoint, at most 60 s, single-use jti) and the PKCE
 * verifier, an entitlement endpoint with scripted answers, and back-channel logout tokens
 * minted as WorkEasy360 mints them (ADR-069).
 *
 * The test plays the browser: it takes the authorization URL HRMS redirected to, asks
 * `authorize` for a code (the person signing in at WorkEasy360), and hands the code and state
 * back to HRMS's callback.
 */

export interface Identity {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  organizationId: string;
  organizationName?: string;
}

/** Things a broken or hostile provider could get wrong in the ID token. */
export interface TokenTweaks {
  aud?: string | string[];
  iss?: string;
  productCode?: string;
  nonce?: string;
  expOffset?: number;
  iatOffset?: number;
  typ?: string;
  omit?: string[];
  /** Sign with HS256 using the public key as the secret, or send `alg: none`. */
  alg?: "none" | "HS256";
  /** Sign with a key the key set does not contain, under a kid it does not know. */
  unknownKey?: boolean;
  /** Sign with a key the key set does not contain, under the real kid. */
  strangerKey?: boolean;
  extra?: Record<string, unknown>;
}

export interface AuthorizeOptions {
  tweak?: TokenTweaks;
  /** Answer for the identity's organization even when the app asked for another. */
  ignoreOrganizationHint?: boolean;
  /** The WorkEasy360 sign-in id the ID token names as `sid`. */
  sid?: string;
}

export interface LogoutTokenTweaks {
  iss?: string;
  aud?: string | string[];
  expOffset?: number;
  iatOffset?: number;
  jti?: string;
  /** The JOSE typ header; null leaves it out. */
  typHeader?: string | null;
  typ?: string;
  events?: unknown;
  omit?: string[];
  /** Sign with a key the key set does not contain (under the current kid). */
  strangerKey?: boolean;
  extra?: Record<string, unknown>;
}

export type Authorization =
  | { ok: true; code: string; state: string; callbackUrl: string }
  | { ok: false; error: string; state: string; callbackUrl: string | null };

export interface EntitlementReply {
  decision: "allow" | "deny";
  reason: string;
  write_allowed?: boolean;
  revalidate_after?: number;
}

export interface TokenRequest {
  assertionOk: boolean;
  assertion: Record<string, unknown> | null;
  pkceOk: boolean;
  outcome: "issued" | "refused";
}

export interface EntitlementCall {
  organizationId: string;
  subject: string | undefined;
  assertionOk: boolean;
}

interface IssuedCode {
  redirectUri: string;
  challenge: string;
  nonce: string;
  identity: Identity;
  expiresAt: number;
  used: boolean;
  tweak: TokenTweaks;
  sid: string | undefined;
}

export const ALLOW: EntitlementReply = { decision: "allow", reason: "entitled", write_allowed: true, revalidate_after: 900 };
export const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

const sha256 = (value: string) => createHash("sha256").update(value, "ascii").digest("base64url");

export class FakeWorkeasy360 {
  readonly clientId = "hrms-client-id";
  readonly keyId = "hrms-key-1";
  productCode = "workeasy_hrms";
  signingKid = "idp-key-1";
  registeredRedirectUris: string[];
  readonly tokenRequests: TokenRequest[] = [];
  readonly entitlementCalls: EntitlementCall[] = [];
  readonly authorizationUrls: string[] = [];
  entitlementFailure: number | null = null;
  jwksFailure: number | null = null;
  /**
   * For a real browser: who "signs in" when a browser opens /authorize (null: /authorize is
   * answered 404, as the programmatic tests drive `authorize()` themselves), and the `sid` to issue.
   */
  browserIdentity: Identity | null = null;
  browserSid: string | undefined;
  /** RP-initiated logouts a browser was sent to. */
  readonly endSessionRequests: string[] = [];

  private server!: Server;
  private port = 0;
  private jose!: typeof Jose;
  private signingKey!: KeyObject;
  private readonly jwks: Record<string, unknown>[] = [];
  private readonly codes = new Map<string, IssuedCode>();
  private readonly seenAssertions = new Set<string>();
  private readonly organizationAnswers = new Map<string, EntitlementReply>();
  private readonly personAnswers = new Map<string, EntitlementReply>();

  private constructor(
    redirectUris: string[],
    private readonly appPublicKey: KeyObject,
  ) {
    this.registeredRedirectUris = redirectUris;
  }

  static async start(options: { redirectUris: string[]; appPublicKey: KeyObject; port?: number }): Promise<FakeWorkeasy360> {
    const provider = new FakeWorkeasy360(options.redirectUris, options.appPublicKey);
    await provider.listen(options.port ?? 0);
    return provider;
  }

  get issuer(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get tokenEndpoint(): string {
    return `${this.issuer}/token`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.closeAllConnections?.();
      this.server.close(() => resolve());
    });
  }

  reset(): void {
    this.codes.clear();
    this.tokenRequests.length = 0;
    this.entitlementCalls.length = 0;
    this.authorizationUrls.length = 0;
    this.organizationAnswers.clear();
    this.personAnswers.clear();
    this.entitlementFailure = null;
    this.jwksFailure = null;
    this.productCode = "workeasy_hrms";
  }

  setOrganizationAnswer(organizationId: string, answer: EntitlementReply | null): void {
    if (answer) this.organizationAnswers.set(organizationId, answer);
    else this.organizationAnswers.delete(organizationId);
  }

  setPersonAnswer(organizationId: string, subject: string, answer: EntitlementReply | null): void {
    const key = `${organizationId}|${subject}`;
    if (answer) this.personAnswers.set(key, answer);
    else this.personAnswers.delete(key);
  }

  // --- the person signing in ---------------------------------------------------------

  authorize(authorizationUrl: string, identity: Identity, options: AuthorizeOptions = {}): Authorization {
    this.authorizationUrls.push(authorizationUrl);
    const params = new URL(authorizationUrl).searchParams;
    const state = params.get("state") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    const fail = (error: string, redirect = true): Authorization => ({
      ok: false,
      error,
      state,
      callbackUrl: redirect ? this.redirectTo(redirectUri, { error, state }) : null,
    });
    if (params.get("client_id") !== this.clientId) return fail("unauthorized_client", false);
    if (!this.registeredRedirectUris.includes(redirectUri)) return fail("invalid_redirect_uri", false);
    if (params.get("response_type") !== "code") return fail("unsupported_response_type");
    if (params.get("code_challenge_method") !== "S256" || !params.get("code_challenge")) return fail("invalid_request");
    if (!(params.get("scope") ?? "").split(" ").includes("openid")) return fail("invalid_scope");
    const hint = params.get("organization");
    if (hint && hint.toLowerCase() !== identity.organizationId.toLowerCase() && !options.ignoreOrganizationHint) {
      return fail("membership_inactive");
    }
    const code = randomUUID().replace(/-/g, "");
    this.codes.set(code, {
      redirectUri,
      challenge: params.get("code_challenge") ?? "",
      nonce: params.get("nonce") ?? "",
      identity,
      expiresAt: Date.now() + 60_000,
      used: false,
      tweak: options.tweak ?? {},
      sid: options.sid,
    });
    return { ok: true, code, state, callbackUrl: this.redirectTo(redirectUri, { code, state }) };
  }

  /** A logout token as WorkEasy360 mints one: JOSE typ logout+jwt; iss, aud, iat, exp (120 s), jti, typ, events, sub, sid. */
  async logoutToken(names: { sub?: string; sid?: string }, tweak: LogoutTokenTweaks = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: tweak.iss ?? this.issuer,
      sub: names.sub,
      aud: tweak.aud ?? this.clientId,
      iat: now + (tweak.iatOffset ?? 0),
      exp: now + (tweak.expOffset ?? 120),
      jti: tweak.jti ?? randomUUID().replace(/-/g, ""),
      typ: tweak.typ ?? "logout_token",
      events: "events" in tweak ? tweak.events : { [BACKCHANNEL_EVENT]: {} },
      sid: names.sid,
      ...tweak.extra,
    };
    for (const key of [...(tweak.omit ?? []), ...Object.keys(claims).filter((k) => claims[k] === undefined)]) delete claims[key];
    const typ = tweak.typHeader === undefined ? "logout+jwt" : tweak.typHeader;
    const key = tweak.strangerKey ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey : this.signingKey;
    return new this.jose.SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: this.signingKid, ...(typ === null ? {} : { typ }) })
      .sign(key);
  }

  // --- HTTP ---------------------------------------------------------------------------

  private redirectTo(redirectUri: string, params: Record<string, string>): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }

  private async listen(port: number): Promise<void> {
    this.jose = (await libraries()).jose;
    const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.signingKey = signing.privateKey;
    this.jwks.push({ ...(await this.jose.exportJWK(signing.publicKey)), kid: this.signingKid, alg: "RS256", use: "sig" });
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => this.json(res, 500, { error: "server_error", detail: String(error) }));
    });
    await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  }

  private async form(req: IncomingMessage): Promise<URLSearchParams> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.issuer);
    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      return this.json(res, 200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: this.tokenEndpoint,
        jwks_uri: `${this.issuer}/jwks`,
        end_session_endpoint: `${this.issuer}/logout`,
        workeasy360_entitlement_endpoint: `${this.issuer}/entitlements`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256", "ES256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["private_key_jwt"],
        backchannel_logout_supported: true,
        backchannel_logout_session_supported: true,
      });
    }
    if (req.method === "GET" && url.pathname === "/jwks") {
      if (this.jwksFailure) return this.json(res, this.jwksFailure, { error: "temporarily_unavailable" });
      return this.json(res, 200, { keys: this.jwks });
    }
    if (req.method === "GET" && url.pathname === "/authorize" && this.browserIdentity) {
      const authorization = this.authorize(url.toString(), this.browserIdentity, this.browserSid ? { sid: this.browserSid } : {});
      if (!authorization.callbackUrl) return this.json(res, 400, { error: authorization.ok ? "unknown" : authorization.error });
      res.statusCode = 302;
      res.setHeader("Location", authorization.callbackUrl);
      return void res.end();
    }
    if (req.method === "GET" && url.pathname === "/logout") {
      // WorkEasy360 asks the person to confirm; the stand-in just returns them to a registered URI.
      this.endSessionRequests.push(url.toString());
      const back = url.searchParams.get("post_logout_redirect_uri");
      if (url.searchParams.get("client_id") !== this.clientId || !back) return this.json(res, 400, { error: "invalid_request" });
      res.statusCode = 302;
      res.setHeader("Location", back);
      return void res.end();
    }
    if (req.method === "POST" && url.pathname === "/token") return this.token(await this.form(req), res);
    if (req.method === "POST" && url.pathname === "/entitlements") return this.entitlement(await this.form(req), res);
    return this.json(res, 404, { error: "not_found" });
  }

  private async verifyAssertion(form: URLSearchParams): Promise<Record<string, unknown> | null> {
    const assertion = form.get("client_assertion");
    if (form.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" || !assertion) return null;
    try {
      const { payload, protectedHeader } = await this.jose.jwtVerify(assertion, this.appPublicKey, {
        issuer: this.clientId,
        subject: this.clientId,
        audience: this.tokenEndpoint,
        algorithms: ["RS256", "ES256"],
        requiredClaims: ["jti", "iat", "exp"],
      });
      if (protectedHeader.kid !== this.keyId) return null;
      if ((payload.exp ?? 0) - (payload.iat ?? 0) > 60) return null;
      const jti = String(payload.jti);
      if (this.seenAssertions.has(jti)) return null;
      this.seenAssertions.add(jti);
      return payload as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async token(form: URLSearchParams, res: ServerResponse): Promise<void> {
    const assertion = await this.verifyAssertion(form);
    const record: TokenRequest = { assertionOk: Boolean(assertion), assertion, pkceOk: false, outcome: "refused" };
    this.tokenRequests.push(record);
    if (!assertion) return this.json(res, 401, { error: "invalid_client" });
    if (form.get("grant_type") !== "authorization_code") return this.json(res, 400, { error: "unsupported_grant_type" });
    const issued = this.codes.get(form.get("code") ?? "");
    if (!issued || issued.used || issued.expiresAt < Date.now()) {
      if (issued) issued.used = true;
      return this.json(res, 400, { error: "invalid_grant" });
    }
    issued.used = true;
    if (form.get("redirect_uri") !== issued.redirectUri) return this.json(res, 400, { error: "invalid_grant" });
    record.pkceOk = sha256(form.get("code_verifier") ?? "") === issued.challenge;
    if (!record.pkceOk) return this.json(res, 400, { error: "invalid_grant" });
    record.outcome = "issued";
    return this.json(res, 200, {
      id_token: await this.mintIdToken(issued),
      access_token: randomUUID(),
      token_type: "Bearer",
      expires_in: 900,
      scope: "openid email profile organization",
    });
  }

  private async mintIdToken(issued: IssuedCode): Promise<string> {
    const { identity, tweak } = issued;
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: tweak.iss ?? this.issuer,
      sub: identity.sub,
      aud: tweak.aud ?? this.clientId,
      iat: now + (tweak.iatOffset ?? 0),
      nbf: now + (tweak.iatOffset ?? 0),
      exp: now + (tweak.expOffset ?? 300),
      jti: randomUUID(),
      typ: tweak.typ ?? "id_token",
      nonce: tweak.nonce ?? issued.nonce,
      organization_id: identity.organizationId,
      organization_name: identity.organizationName,
      product_code: tweak.productCode ?? this.productCode,
      email: identity.email,
      email_verified: identity.emailVerified ?? true,
      name: identity.name,
      aal: 1,
      auth_time: now,
      sid: issued.sid,
      ...tweak.extra,
    };
    for (const key of [...(tweak.omit ?? []), ...Object.keys(claims).filter((k) => claims[k] === undefined)]) delete claims[key];
    if (tweak.alg === "none") {
      const header = Buffer.from(JSON.stringify({ alg: "none", kid: this.signingKid })).toString("base64url");
      return `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.`;
    }
    if (tweak.alg === "HS256") {
      // The algorithm-confusion attack: the PUBLIC key used as an HMAC secret.
      const publicPem = createPublicKey(this.signingKey).export({ type: "spki", format: "pem" }).toString();
      return new this.jose.SignJWT(claims).setProtectedHeader({ alg: "HS256", kid: this.signingKid }).sign(Buffer.from(publicPem));
    }
    if (tweak.unknownKey || tweak.strangerKey) {
      const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const kid = tweak.unknownKey ? "not-in-the-key-set" : this.signingKid;
      return new this.jose.SignJWT(claims).setProtectedHeader({ alg: "RS256", kid }).sign(stranger.privateKey);
    }
    return new this.jose.SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: this.signingKid }).sign(this.signingKey);
  }

  private async entitlement(form: URLSearchParams, res: ServerResponse): Promise<void> {
    const assertion = await this.verifyAssertion(form);
    const organizationId = form.get("organization_id") ?? "";
    const subject = form.get("subject") ?? undefined;
    this.entitlementCalls.push({ organizationId, subject, assertionOk: Boolean(assertion) });
    if (!assertion) return this.json(res, 401, { error: "invalid_client" });
    if (this.entitlementFailure) {
      return this.json(res, this.entitlementFailure, { error: this.entitlementFailure === 503 ? "temporarily_unavailable" : "forbidden" });
    }
    const personal = subject ? this.personAnswers.get(`${organizationId}|${subject}`) : undefined;
    const organization = this.organizationAnswers.get(organizationId);
    const chosen = organization && organization.decision === "deny" ? organization : (personal ?? organization ?? ALLOW);
    return this.json(res, 200, {
      decision: chosen.decision,
      reason: chosen.reason,
      product_code: this.productCode,
      organization_id: organizationId,
      write_allowed: chosen.decision === "allow" ? (chosen.write_allowed ?? true) : false,
      checked_at: new Date().toISOString(),
      revalidate_after: chosen.revalidate_after ?? 900,
    });
  }
}

/** A key pair for the product (RSA 2048), generated at test time. */
export function productKeyPair(): { privatePem: string; publicKey: KeyObject; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey,
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
