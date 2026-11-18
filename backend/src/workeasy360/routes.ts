import { createHash, timingSafeEqual } from "node:crypto";
import express, { type CookieOptions, type Request, type Response } from "express";
import { openSession } from "../auth/sessions";
import { cookiesSecure, readSessionCookie, setSessionCookie } from "../auth/sessionCookie";
import { rateLimit } from "../middleware/rateLimit";
import { familyOf, issueRefreshToken, revokeFamily } from "../utils/refreshTokens";
import { endFromLogoutToken } from "./backchannel";
import { describe, MAX_IDENTIFIER_LENGTH, workeasy360Client, type VerifiedLogoutToken } from "./client";
import { entitlements } from "./entitlements";
import { codeForProviderError, SsoRefusal, Workeasy360Error, type SsoErrorCode } from "./errors";
import { consumeFlow, FLOW_TTL_SECONDS, newFlowId, saveFlow } from "./flows";
import { provisionSignIn } from "./provisioning";
import { safeNext } from "./safeNext";
import { UUID } from "./uuid";
import { workeasy360 } from "./settings";

/**
 * "Continue with WorkEasy360", mounted under /api/auth:
 *
 *   GET  /api/auth/workeasy360/start               ?organization=<uuid>&next=<path>
 *   GET  /api/auth/callback/workeasy360            the registered redirect URI
 *   GET  /api/auth/workeasy360/logout              on to WorkEasy360's sign-out (changes nothing here)
 *   POST /api/auth/workeasy360/backchannel-logout  the registered back-channel logout URI
 *
 * Plain GET navigations answering with redirects: the page itself never talks to WorkEasy360.
 * Failures land on `/login?sso_error=<code>` with a code from a fixed vocabulary (errors.ts);
 * details go to the log, never a code, token, state or nonce.
 */

/**
 * The flow cookie: a random id, good for one flow (10 minutes, single use).
 *
 * Over http (local development) it is `hrms_w360_flow`, confined to the callback path. With
 * Secure cookies it is `__Host-hrms_w360_flow` (Secure, Path=/, no Domain): a sibling host
 * under the same parent domain cannot plant one, so an attacker cannot bind the victim's
 * browser to the attacker's flow (login CSRF past the state check). SameSite=Lax, because the
 * callback is a cross-site top-level navigation from WorkEasy360.
 */
export const FLOW_COOKIE = "hrms_w360_flow";
export const SECURE_FLOW_COOKIE = `__Host-${FLOW_COOKIE}`;
const CALLBACK_PATH = "/api/auth/callback/workeasy360";
const MAX_CODE = 2048;
const MAX_STATE = 512;
const MAX_LOGOUT_TOKEN = 16 * 1024;

const router = express.Router();

// Starts and callbacks per IP per minute (per process). WORKEASY360_SIGN_IN_RATE_LIMIT overrides it.
const signInLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.WORKEASY360_SIGN_IN_RATE_LIMIT) || 30,
  message: "Too many sign-in attempts. Please wait a minute and try again.",
});

router.get("/workeasy360/start", signInLimiter, async (req, res) => {
  noStore(res);
  if (!workeasy360.configured) return fail(res, "unavailable", "not configured");
  const hint = typeof req.query.organization === "string" ? req.query.organization : "";
  // Forwarded only when it is a UUID; anything else is dropped and WorkEasy360 asks.
  const organization = UUID.test(hint) ? hint.toLowerCase() : "";
  const next = safeNext(req.query.next);
  try {
    const request = await workeasy360Client().authorizationRequest(organization ? { organizationId: organization } : {});
    const flowId = newFlowId();
    await saveFlow(flowId, { state: request.state, nonce: request.nonce, codeVerifier: request.codeVerifier, organization, next });
    res.cookie(flowCookieName(), flowId, flowCookieOptions(FLOW_TTL_SECONDS * 1000));
    return res.redirect(302, request.url);
  } catch (error) {
    return fail(res, codeFor(error), describe(error));
  }
});

router.get("/callback/workeasy360", signInLimiter, async (req, res) => {
  noStore(res);
  // The flow is single use: consumed (and its cookie dropped) before anything is checked.
  const { maxAge: _maxAge, ...clearOptions } = flowCookieOptions(0);
  res.clearCookie(flowCookieName(), clearOptions);
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const flowId = cookies?.[flowCookieName()];
  let flow = null;
  try {
    flow = typeof flowId === "string" ? await consumeFlow(flowId) : null;
  } catch (error) {
    return fail(res, "unavailable", describe(error));
  }

  const query = new URL(req.originalUrl, "http://callback.invalid").searchParams;
  const providerError = (query.get("error") ?? "").slice(0, 64);
  if (providerError) return fail(res, codeForProviderError(providerError), `provider returned error=${providerError}`);
  if (!flow) return fail(res, "expired", "no pending flow for this browser");
  const state = (query.get("state") ?? "").slice(0, MAX_STATE);
  if (!state || !safeEqual(state, flow.state)) return fail(res, "expired", "state does not match the pending flow");
  if (!workeasy360.configured) return fail(res, "unavailable", "not configured");
  const code = query.get("code") ?? "";
  if (!code || code.length > MAX_CODE) return fail(res, "refused", "no usable code");

  try {
    const client = workeasy360Client();
    const claims = await client.complete({ query, expectedState: flow.state, nonce: flow.nonce, codeVerifier: flow.codeVerifier });
    const organization = claims.organization_id.toLowerCase();
    if (flow.organization && organization !== flow.organization) {
      // The launcher asked for one organization and the provider answered for another: land
      // nowhere rather than in the wrong company.
      throw new SsoRefusal("wrong_organization", "organization_id differs from the launcher's");
    }

    // A person arriving: ask now (the platform asked too before it issued the code; this is
    // what catches a change in between and a misconfigured grant). An outage never refuses.
    const access = await entitlements().check(organization, { subject: claims.sub, fresh: true });
    if (!access.allowed) {
      throw new SsoRefusal(access.status === "refused" ? "access_unverified" : "not_entitled", `entitlement ${access.reason}`);
    }

    const signedIn = await provisionSignIn(claims, client.issuer);

    // Account switching and fixation: whatever session this browser already holds ends here.
    const presented = readSessionCookie(req);
    const presentedFamily = presented ? familyOf(presented) : null;
    if (presentedFamily) await revokeFamily(presentedFamily, "replaced_by_sign_in");

    const sessionId = await openSession(signedIn.userId, signedIn.organizationId, {
      method: "WORKEASY360",
      issuer: client.issuer,
      subject: claims.sub,
      providerSid: typeof claims.sid === "string" && claims.sid.length <= MAX_IDENTIFIER_LENGTH ? claims.sid : null,
      workeasy360OrganizationId: organization,
    });
    setSessionCookie(res, await issueRefreshToken(signedIn.userId, sessionId));
    console.log(
      JSON.stringify({
        msg: "workeasy360.sign_in",
        organizationId: signedIn.organizationId,
        userId: signedIn.userId,
        organizationCreated: signedIn.organizationCreated,
        linked: signedIn.linked,
      }),
    );
    return res.redirect(302, `${workeasy360.appOrigin}${flow.next}`);
  } catch (error) {
    return fail(res, codeFor(error), describe(error));
  }
});

/**
 * "Sign out of HRMS and WorkEasy360": the app ends its own session first (POST /api/auth/logout),
 * then navigates here. This only sends the browser on to WorkEasy360's end_session_endpoint,
 * which asks the person to confirm and returns them to the registered post-logout URI. It
 * changes nothing locally, so a link to it cannot sign anyone out of HRMS.
 */
router.get("/workeasy360/logout", async (_req, res) => {
  noStore(res);
  const fallback = `${workeasy360.appOrigin}/login`;
  if (!workeasy360.signOutAvailable) return res.redirect(302, fallback);
  try {
    const target = await workeasy360Client().endSessionUrl(workeasy360.postLogoutRedirectUri);
    return res.redirect(302, target || fallback);
  } catch (error) {
    console.warn(JSON.stringify({ msg: "workeasy360.end_session_failed", detail: describe(error) }));
    return res.redirect(302, fallback);
  }
});

/**
 * OpenID Connect Back-Channel Logout 1.0, the receiver. WorkEasy360 calls it server to server
 * when a sign-in that opened HRMS ends (sign-out, an account switch, a revoked session, "sign
 * out everywhere", a password change or reset). No cookie and no CSRF token: the provider's
 * signature on the token is the authentication.
 *
 * - 200: the token verified and the sessions it names have ended - or it was delivered before
 *   (at-least-once delivery; nothing is done twice);
 * - 400 `invalid_request`: the token does not verify (not retried by the provider);
 * - 503 `temporarily_unavailable`: the key set or the database could not be read; nothing was
 *   recorded, so the provider's retry is accepted;
 * - 404: this deployment does not sign in with WorkEasy360.
 */
router.post(
  "/workeasy360/backchannel-logout",
  express.urlencoded({ extended: false, limit: "32kb" }),
  async (req: Request, res: Response) => {
    noStore(res);
    if (!workeasy360.configured) return res.status(404).json({ error: "not_found" });
    const body = req.body as Record<string, unknown> | undefined;
    const raw = req.is("application/x-www-form-urlencoded") ? body?.logout_token : undefined;
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LOGOUT_TOKEN) {
      return refuseLogout(res, "no logout_token form field");
    }

    let issuer: string;
    let token: VerifiedLogoutToken;
    try {
      const client = workeasy360Client();
      issuer = client.issuer;
      token = await client.verifyLogoutToken(raw);
    } catch (error) {
      if (error instanceof Workeasy360Error && error.code === "invalid_token") return refuseLogout(res, error.detail);
      return logoutUnavailable(res, "workeasy360.logout_token_unverifiable", error);
    }

    try {
      const outcome = await endFromLogoutToken(issuer, token);
      if (outcome.status === "replayed") {
        console.log(JSON.stringify({ msg: "workeasy360.backchannel_logout_duplicate", jti: token.jti }));
      } else {
        console.log(JSON.stringify({ msg: "workeasy360.backchannel_logout", jti: token.jti, by: outcome.by, sessionsEnded: outcome.sessions }));
      }
      return res.status(200).end();
    } catch (error) {
      return logoutUnavailable(res, "workeasy360.backchannel_logout_failed", error);
    }
  },
);

// --- helpers -----------------------------------------------------------------------------------

function noStore(res: Response): void {
  res.set("Cache-Control", "no-store");
}

function flowCookieName(): string {
  return cookiesSecure() ? SECURE_FLOW_COOKIE : FLOW_COOKIE;
}

function flowCookieOptions(maxAge: number): CookieOptions {
  const secure = cookiesSecure();
  // `__Host-` demands Path=/ and no Domain; over http the cookie stays confined to the callback.
  return { httpOnly: true, secure, sameSite: "lax", path: secure ? "/" : CALLBACK_PATH, maxAge };
}

function fail(res: Response, code: SsoErrorCode, detail: string) {
  console.warn(JSON.stringify({ msg: "workeasy360.sign_in_failed", code, detail }));
  return res.redirect(302, `${workeasy360.appOrigin}/login?sso_error=${encodeURIComponent(code)}`);
}

function codeFor(error: unknown): SsoErrorCode {
  if (error instanceof SsoRefusal) return error.code;
  if (error instanceof Workeasy360Error) {
    switch (error.code) {
      case "provider_unavailable":
      case "provider_misconfigured":
        return "unavailable";
      case "rate_limited":
        return "rate_limited";
      case "provider_refused":
        return "access_unverified";
      default:
        return "refused";
    }
  }
  return "unavailable";
}

function refuseLogout(res: Response, detail: string) {
  // Our own reason only: never the token.
  console.warn(JSON.stringify({ msg: "workeasy360.logout_token_rejected", detail }));
  return res.status(400).json({ error: "invalid_request" });
}

function logoutUnavailable(res: Response, msg: string, error: unknown) {
  console.error(JSON.stringify({ msg, detail: describe(error) }));
  return res.status(503).json({ error: "temporarily_unavailable" });
}

/** Constant-time comparison that does not leak the length either. */
function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}

export default router;
