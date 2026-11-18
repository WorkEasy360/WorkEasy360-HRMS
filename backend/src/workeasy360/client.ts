import { createPrivateKey, randomUUID, type KeyObject } from "node:crypto";
import { SsoRefusal, Workeasy360Error } from "./errors";
import { libraries, type Jose, type Oidc } from "./esm";
import { isAcceptableUrl, privateKeyPem, workeasy360 } from "./settings";

/**
 * The WorkEasy360 Accounts client: OpenID Connect Authorization Code + PKCE (S256) with
 * `private_key_jwt`, on openid-client 6, plus the two things openid-client does not do -
 * verifying back-channel logout tokens and asking the entitlement endpoint - on jose 6.
 *
 * Only the issuer is configured; every endpoint comes from its discovery document, whose
 * `issuer` must be exactly the configured one. The ID token's signature is verified against
 * the provider's key set (openid-client's non-repudiation checks: by `kid` from `jwks_uri`,
 * the algorithm from an allow-list), together with iss, aud, exp, iat, nonce and azp; this
 * class adds what the WorkEasy360 contract adds: `typ` is `id_token`, the audience is this
 * client alone, `product_code` is ours, `organization_id` is present and `email_verified` is
 * true.
 */

/** Discovery metadata is reused for this long before it is fetched again. */
export const METADATA_TTL_MS = 60 * 60 * 1000;
/** Clock skew tolerated on exp / nbf / iat (the integration guide's +-30 s). */
export const LEEWAY_SECONDS = 30;
/** A client assertion is single-use and short-lived (iss = sub = client id, aud = token endpoint). */
export const ASSERTION_LIFETIME_SECONDS = 60;
export const SIGNING_ALGORITHMS = ["RS256", "ES256"];
/** OpenID Connect Back-Channel Logout 1.0 section 2.4: the event a logout token must carry. */
export const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
/** WorkEasy360 mints a fresh logout token (valid 120 s) for every delivery: an older one is a replay. */
export const MAX_LOGOUT_TOKEN_AGE_SECONDS = 600;
/** Longest `sub`, `sid` or `jti` stored from a token. */
export const MAX_IDENTIFIER_LENGTH = 255;
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const HTTP_TIMEOUT_SECONDS = 10;

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface VerifiedIdToken {
  iss: string;
  sub: string;
  organization_id: string;
  product_code: string;
  email: string;
  email_verified: true;
  name?: string;
  given_name?: string;
  family_name?: string;
  organization_name?: string;
  /** The WorkEasy360 sign-in, present once a back-channel logout URI is registered (ADR-069). */
  sid?: string;
  aal?: number;
}

export interface VerifiedLogoutToken {
  jti: string;
  /** The person. Absent only when the token names a sign-in alone. */
  sub?: string;
  /** The WorkEasy360 sign-in that ended. Absent: every session of `sub` ends. */
  sid?: string;
  /** Epoch seconds after which the token is refused anyway, so its jti need not be kept. */
  acceptableUntil: number;
}

export interface EntitlementAnswer {
  decision: "allow" | "deny";
  reason: string;
  writeAllowed: boolean;
  /** Seconds the answer may be trusted, as the provider advertises (default 900). */
  revalidateAfter: number;
}

interface Discovered {
  config: Oidc.Configuration;
  at: number;
  jwks: ReturnType<typeof Jose.createRemoteJWKSet>;
}

interface SigningKey {
  node: KeyObject;
  crypto: Oidc.CryptoKey;
  alg: "RS256" | "ES256";
}

export class Workeasy360Client {
  readonly issuer: string;
  readonly clientId: string;
  private readonly redirectUri: string;
  private readonly keyId: string;
  private readonly productCode: string;
  private readonly scopes: string[];
  private readonly readPem: () => string;
  private discovered: Promise<Discovered> | null = null;
  private signingKey: Promise<SigningKey> | null = null;

  constructor(
    options: {
      issuer: string;
      clientId: string;
      redirectUri: string;
      keyId: string;
      productCode: string;
      scopes: string[];
      privateKeyPem: () => string;
    },
  ) {
    this.issuer = options.issuer;
    this.clientId = options.clientId;
    this.redirectUri = options.redirectUri;
    this.keyId = options.keyId;
    this.productCode = options.productCode;
    this.scopes = options.scopes;
    this.readPem = options.privateKeyPem;
  }

  // --- configuration -------------------------------------------------------------

  /** RS256 for an RSA key, ES256 for a P-256 key: derived, so the two cannot disagree. */
  private key(): Promise<SigningKey> {
    this.signingKey ??= (async () => {
      const { jose } = await libraries();
      let node: KeyObject;
      try {
        node = createPrivateKey(this.readPem());
      } catch {
        throw new Workeasy360Error("provider_misconfigured", "the client private key is unreadable");
      }
      let alg: "RS256" | "ES256";
      if (node.asymmetricKeyType === "rsa") alg = "RS256";
      else if (node.asymmetricKeyType === "ec" && node.asymmetricKeyDetails?.namedCurve === "prime256v1") alg = "ES256";
      else throw new Workeasy360Error("provider_misconfigured", "the client key must be RSA or EC P-256");
      const pkcs8 = node.export({ type: "pkcs8", format: "pem" }).toString();
      const crypto = await jose.importPKCS8(pkcs8, alg);
      return { node, crypto, alg };
    })().catch((error: unknown) => {
      this.signingKey = null;
      throw error;
    });
    return this.signingKey;
  }

  /** The discovered configuration; refetched after an hour, and after a failure. */
  private discovery(): Promise<Discovered> {
    const current = this.discovered;
    if (current) {
      return current.then((found) => {
        if (Date.now() - found.at < METADATA_TTL_MS) return found;
        this.discovered = null;
        return this.discovery();
      });
    }
    const started = this.discover().catch((error: unknown) => {
      if (this.discovered === started) this.discovered = null;
      throw error;
    });
    this.discovered = started;
    return started;
  }

  private async discover(): Promise<Discovered> {
    const { oidc, jose } = await libraries();
    const key = await this.key();
    let tokenEndpoint = "";
    const insecure = new URL(this.issuer).protocol === "http:";
    if (insecure && !isAcceptableUrl(this.issuer)) {
      throw new Workeasy360Error("provider_misconfigured", "an http issuer is accepted only on a loopback host outside production");
    }
    let config: Oidc.Configuration;
    try {
      config = await oidc.discovery(
        new URL(this.issuer),
        this.clientId,
        { token_endpoint_auth_method: "private_key_jwt" },
        oidc.PrivateKeyJwt(
          { key: key.crypto, kid: this.keyId },
          {
            // The WorkEasy360 contract: aud is the token endpoint (RFC 7523 section 3), for
            // the token endpoint and the entitlement endpoint alike.
            [oidc.modifyAssertion]: (_header, payload) => {
              payload.aud = tokenEndpoint;
            },
          },
        ),
        {
          timeout: HTTP_TIMEOUT_SECONDS,
          execute: [...(insecure ? [oidc.allowInsecureRequests] : []), oidc.enableNonRepudiationChecks],
        },
      );
    } catch (error) {
      throw new Workeasy360Error(
        error instanceof oidc.ClientError && error.code === "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED"
          ? "provider_misconfigured"
          : "provider_unavailable",
        `discovery failed (${describe(error)})`,
      );
    }
    const metadata = config.serverMetadata();
    // openid-client compares the issuers as URLs (a trailing slash would pass); the contract
    // says exactly, as OpenID Connect Core does.
    if (metadata.issuer !== this.issuer) {
      throw new Workeasy360Error("provider_misconfigured", "discovery names a different issuer");
    }
    for (const name of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
      const value = metadata[name];
      if (typeof value !== "string" || !isAcceptableUrl(value)) {
        throw new Workeasy360Error("provider_misconfigured", `discovery has no usable ${name}`);
      }
    }
    for (const name of ["end_session_endpoint", "workeasy360_entitlement_endpoint"]) {
      const value = metadata[name];
      if (value !== undefined && (typeof value !== "string" || !isAcceptableUrl(value))) {
        throw new Workeasy360Error("provider_misconfigured", `discovery has an unusable ${name}`);
      }
    }
    tokenEndpoint = metadata.token_endpoint!;
    const jwks = jose.createRemoteJWKSet(new URL(metadata.jwks_uri!), {
      timeoutDuration: HTTP_TIMEOUT_SECONDS * 1000,
      // An unknown kid refreshes the set (a rotation), but not more often than this: garbage
      // tokens must not turn into request amplification against the provider.
      cooldownDuration: 10_000,
      cacheMaxAge: METADATA_TTL_MS,
    });
    return { config, at: Date.now(), jwks };
  }

  // --- sign-in -------------------------------------------------------------------

  async authorizationRequest(options: { organizationId?: string } = {}): Promise<AuthorizationRequest> {
    const { oidc } = await libraries();
    const { config } = await this.discovery();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const parameters: Record<string, string> = {
      redirect_uri: this.redirectUri,
      scope: this.scopes.join(" "),
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
    };
    // The launcher names the organization the person chose; without it WorkEasy360 asks.
    if (options.organizationId) parameters.organization = options.organizationId;
    return { url: oidc.buildAuthorizationUrl(config, parameters).href, state, nonce, codeVerifier };
  }

  /**
   * Exchanges the code (once, with the PKCE verifier and a client assertion) and returns the
   * verified ID token's claims. `query` is the callback's query string as received.
   */
  async complete(input: {
    query: URLSearchParams;
    expectedState: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<VerifiedIdToken> {
    const { oidc, jose } = await libraries();
    const { config } = await this.discovery();
    // The token request's redirect_uri is derived from this URL: the registered one, exactly,
    // whatever host and scheme the request reached us under behind the proxy.
    const current = new URL(this.redirectUri);
    for (const [name, value] of input.query) current.searchParams.append(name, value);

    let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
    try {
      tokens = await oidc.authorizationCodeGrant(config, current, {
        pkceCodeVerifier: input.codeVerifier,
        expectedState: input.expectedState,
        expectedNonce: input.nonce,
        idTokenExpected: true,
      });
    } catch (error) {
      throw tokenEndpointError(oidc, error);
    }

    const idToken = tokens.id_token;
    const claims = tokens.claims() as Record<string, unknown> | undefined;
    if (!idToken || !claims) throw new Workeasy360Error("invalid_token", "the token response has no id_token");
    let header: { alg?: string };
    try {
      header = jose.decodeProtectedHeader(idToken);
    } catch {
      throw new Workeasy360Error("invalid_token", "unreadable ID token header");
    }
    if (!header.alg || !SIGNING_ALGORITHMS.includes(header.alg)) {
      throw new Workeasy360Error("invalid_token", `the ID token is signed with ${String(header.alg)}`);
    }
    return this.checkIdTokenClaims(claims);
  }

  /** The WorkEasy360 claims, on top of what openid-client verified. */
  checkIdTokenClaims(claims: Record<string, unknown>): VerifiedIdToken {
    if (claims.iss !== this.issuer) throw new Workeasy360Error("invalid_token", "iss is not exactly the configured issuer");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (audiences.length !== 1 || audiences[0] !== this.clientId) {
      throw new Workeasy360Error("invalid_token", "aud is not exactly this client");
    }
    // An access token is signed by the same key for the same audience: it is not an identity assertion.
    if (claims.typ !== "id_token") throw new Workeasy360Error("invalid_token", "typ is not id_token");
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.iat !== "number" || claims.iat > now + LEEWAY_SECONDS) {
      throw new Workeasy360Error("invalid_token", "iat is missing or in the future");
    }
    if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > MAX_IDENTIFIER_LENGTH) {
      throw new Workeasy360Error("invalid_token", "no usable sub");
    }
    // The audience check already ties the token to our client id; this catches a client id
    // registered to the wrong product.
    if (claims.product_code !== this.productCode) {
      throw new SsoRefusal("wrong_product", `the token is for ${String(claims.product_code)}`);
    }
    if (typeof claims.organization_id !== "string" || !claims.organization_id) {
      throw new SsoRefusal("organization_missing", "the token names no organization_id");
    }
    // Whoever registered an unproven address at WorkEasy360 must not take over the HRMS account
    // that has it, nor squat the address its real owner arrives with.
    if (typeof claims.email !== "string" || !claims.email.trim() || claims.email_verified !== true) {
      throw new SsoRefusal("email_unverified", "the token carries no verified email");
    }
    return claims as unknown as VerifiedIdToken;
  }

  /** RP-initiated logout at WorkEasy360, or "" when the provider advertises none. */
  async endSessionUrl(postLogoutRedirectUri: string): Promise<string> {
    const { oidc } = await libraries();
    const { config } = await this.discovery();
    if (!config.serverMetadata().end_session_endpoint) return "";
    return oidc.buildEndSessionUrl(config, { post_logout_redirect_uri: postLogoutRedirectUri }).href;
  }

  // --- back-channel logout -----------------------------------------------------------

  /**
   * Verifies a logout token as OpenID Connect Back-Channel Logout 1.0 section 2.6 asks and as
   * WorkEasy360 issues it: JOSE `typ: logout+jwt`; signature by `kid` from the provider's key set
   * (RS256 or ES256 only); `iss` exactly the issuer; `aud` this client; `iat` not in the future
   * and at most ten minutes old; `exp` not passed (30 s skew); the back-channel-logout event; no
   * `nonce`; `sub` and/or `sid`; a `jti`. Replay is the receiver's to check (it needs storage).
   *
   * Throws `invalid_token` for a token that must not be trusted (answer 400), and
   * `provider_unavailable` / `provider_misconfigured` when the key set cannot be read (answer
   * 503, so the provider retries).
   */
  async verifyLogoutToken(logoutToken: string): Promise<VerifiedLogoutToken> {
    const { jose } = await libraries();
    const { jwks } = await this.discovery();
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jose.jwtVerify(logoutToken, jwks, {
        issuer: this.issuer,
        audience: this.clientId,
        algorithms: SIGNING_ALGORITHMS,
        typ: "logout+jwt",
        clockTolerance: LEEWAY_SECONDS,
        maxTokenAge: MAX_LOGOUT_TOKEN_AGE_SECONDS + LEEWAY_SECONDS,
        requiredClaims: ["iat", "exp", "jti", "events"],
      }));
    } catch (error) {
      throw logoutVerificationError(jose, error);
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (audiences.length > 1 && payload.azp !== this.clientId) {
      throw new Workeasy360Error("invalid_token", "several audiences and azp is not this client");
    }
    if (payload.azp !== undefined && payload.azp !== this.clientId) {
      throw new Workeasy360Error("invalid_token", "azp is another client");
    }
    if ("typ" in payload && payload.typ !== "logout_token") {
      throw new Workeasy360Error("invalid_token", "typ is not logout_token");
    }
    const events = payload.events;
    const event = isPlainObject(events) ? events[BACKCHANNEL_LOGOUT_EVENT] : undefined;
    if (!isPlainObject(event)) {
      throw new Workeasy360Error("invalid_token", "events does not hold the back-channel logout event");
    }
    // What keeps an ID token (same key, same audience) from being replayed as a logout instruction.
    if ("nonce" in payload) throw new Workeasy360Error("invalid_token", "a logout token must not carry a nonce");
    const sub = optionalIdentifier(payload.sub, "sub");
    const sid = optionalIdentifier(payload.sid, "sid");
    if (sub === undefined && sid === undefined) throw new Workeasy360Error("invalid_token", "neither sub nor sid");
    const jti = optionalIdentifier(payload.jti, "jti");
    if (jti === undefined) throw new Workeasy360Error("invalid_token", "no jti");
    const iat = payload.iat as number;
    const exp = payload.exp as number;
    return {
      jti,
      ...(sub !== undefined ? { sub } : {}),
      ...(sid !== undefined ? { sid } : {}),
      acceptableUntil: Math.min(exp, iat + MAX_LOGOUT_TOKEN_AGE_SECONDS) + LEEWAY_SECONDS + 1,
    };
  }

  // --- the entitlement API -------------------------------------------------------------

  /**
   * Asks whether `organizationId` (and, with `subject`, this person) may use HRMS. There is no
   * product parameter: the product is whoever the client assertion proves this is.
   *
   * Anything that is not an answer throws: `provider_unavailable` / `rate_limited` for an outage
   * (never a denial; the caller keeps its last answer) and `provider_refused` when the platform
   * answered and refused this client (400/401/403: a revoked credential, a suspended integration).
   */
  async verifyEntitlement(organizationId: string, options: { subject?: string; write?: boolean } = {}): Promise<EntitlementAnswer> {
    const { config } = await this.discovery();
    const metadata = config.serverMetadata();
    const endpoint = metadata.workeasy360_entitlement_endpoint;
    if (typeof endpoint !== "string" || !endpoint) {
      throw new Workeasy360Error("provider_misconfigured", "discovery has no workeasy360_entitlement_endpoint");
    }
    const form = new URLSearchParams({
      organization_id: organizationId,
      write: options.write ? "true" : "false",
      client_id: this.clientId,
      client_assertion_type: ASSERTION_TYPE,
      client_assertion: await this.clientAssertion(metadata.token_endpoint!),
    });
    if (options.subject) form.set("subject", options.subject);
    let status: number;
    let body: Record<string, unknown> = {};
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_SECONDS * 1000),
        redirect: "error",
      });
      status = response.status;
      body = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    } catch (error) {
      throw new Workeasy360Error("provider_unavailable", `entitlement endpoint unreachable (${describe(error)})`);
    }
    const decision = body.decision;
    if (status === 200 && (decision === "allow" || decision === "deny")) {
      const advertised = Number(body.revalidate_after);
      return {
        decision,
        reason: typeof body.reason === "string" ? body.reason.slice(0, 64) : "",
        writeAllowed: decision === "allow" && body.write_allowed === true,
        revalidateAfter: Number.isFinite(advertised) && advertised > 0 ? advertised : 900,
      };
    }
    const detail = `entitlement endpoint ${status}`;
    if (status === 400 || status === 401 || status === 403) throw new Workeasy360Error("provider_refused", detail);
    if (status === 429) throw new Workeasy360Error("rate_limited", detail);
    throw new Workeasy360Error("provider_unavailable", detail);
  }

  /** RFC 7523 section 3: iss = sub = client id, aud = the token endpoint, 60 s, a fresh jti. */
  private async clientAssertion(audience: string): Promise<string> {
    const { jose } = await libraries();
    const { node, alg } = await this.key();
    const now = Math.floor(Date.now() / 1000);
    return new jose.SignJWT({})
      .setProtectedHeader({ alg, kid: this.keyId })
      .setIssuer(this.clientId)
      .setSubject(this.clientId)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + ASSERTION_LIFETIME_SECONDS)
      .setJti(randomUUID())
      .sign(node);
  }

  /** For the operator's `check` command: discovery, the key and the key set, without a person. */
  async selfTest(): Promise<{ issuer: string; tokenEndpoint: string; entitlementEndpoint: string; endSession: string; keyAlg: string }> {
    const { config } = await this.discovery();
    const { alg } = await this.key();
    const metadata = config.serverMetadata();
    return {
      issuer: metadata.issuer,
      tokenEndpoint: metadata.token_endpoint ?? "",
      entitlementEndpoint: String(metadata.workeasy360_entitlement_endpoint ?? ""),
      endSession: metadata.end_session_endpoint ?? "",
      keyAlg: alg,
    };
  }
}

// --- the one client of this process ------------------------------------------------------

let shared: { key: string; client: Workeasy360Client } | null = null;

/** The client for the current configuration (rebuilt when the configuration changes). */
export function workeasy360Client(): Workeasy360Client {
  const s = workeasy360;
  if (!s.configured) throw new Workeasy360Error("provider_misconfigured", "WorkEasy360 sign-in is not configured");
  const key = JSON.stringify([s.issuer, s.clientId, s.redirectUri, s.keyId, s.productCode, s.scopes]);
  if (!shared || shared.key !== key) {
    shared = {
      key,
      client: new Workeasy360Client({
        issuer: s.issuer,
        clientId: s.clientId,
        redirectUri: s.redirectUri,
        keyId: s.keyId,
        productCode: s.productCode,
        scopes: s.scopes,
        privateKeyPem,
      }),
    };
  }
  return shared.client;
}

// --- helpers --------------------------------------------------------------------------------

function tokenEndpointError(oidc: typeof Oidc, error: unknown): Workeasy360Error {
  if (error instanceof Workeasy360Error) return error;
  if (error instanceof oidc.ResponseBodyError) {
    const detail = `token endpoint ${error.status} ${error.error}`;
    if (error.status === 429) return new Workeasy360Error("rate_limited", detail);
    if (error.status >= 500 || error.error === "temporarily_unavailable") return new Workeasy360Error("provider_unavailable", detail);
    // invalid_grant is routine (an expired code, a membership changed since the redirect):
    // the person simply starts again.
    return new Workeasy360Error("sign_in_refused", detail);
  }
  if (error instanceof oidc.AuthorizationResponseError) {
    return new Workeasy360Error("sign_in_refused", `authorization response error ${error.error}`);
  }
  if (error instanceof oidc.ClientError) {
    // A non-conform response (a 5xx without a JSON error) or an unreadable key set is an outage;
    // everything else is about the token itself: claims, signature, key selection, alg.
    if (error.code === "OAUTH_RESPONSE_IS_NOT_CONFORM" || error.code === "OAUTH_RESPONSE_IS_NOT_JSON") {
      return new Workeasy360Error("provider_unavailable", `token endpoint answered unexpectedly (${error.code})`);
    }
    return new Workeasy360Error("invalid_token", `${error.code ?? "verification failed"}: ${error.message}`);
  }
  if (error instanceof TypeError) return new Workeasy360Error("provider_unavailable", `token endpoint unreachable (${error.message})`);
  return new Workeasy360Error("invalid_token", describe(error));
}

function logoutVerificationError(jose: typeof Jose, error: unknown): Workeasy360Error {
  if (error instanceof Workeasy360Error) return error;
  if (error instanceof jose.errors.JWKSTimeout) return new Workeasy360Error("provider_unavailable", "the key set timed out");
  if (error instanceof jose.errors.JWKSInvalid) return new Workeasy360Error("provider_misconfigured", "the key set is invalid");
  if (error instanceof jose.errors.JOSEError && error.code === "ERR_JOSE_GENERIC") {
    // jose's remote key set reports a non-200 answer this way.
    return new Workeasy360Error("provider_unavailable", `the key set could not be read (${error.message})`);
  }
  if (error instanceof jose.errors.JOSEError) return new Workeasy360Error("invalid_token", `verification failed (${error.code})`);
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return new Workeasy360Error("provider_unavailable", "the key set is unreachable");
  }
  return new Workeasy360Error("invalid_token", `verification failed (${describe(error)})`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalIdentifier(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Workeasy360Error("invalid_token", `${name} is not a usable identifier`);
  }
  return value;
}

/** What is safe to log about an error: its type and code, never a token. */
export function describe(error: unknown): string {
  if (error instanceof Workeasy360Error) return error.detail || error.code;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? `${error.name} ${code}` : error.name;
  }
  return "unknown";
}
