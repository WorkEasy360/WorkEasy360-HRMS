import { NextFunction, Request, Response } from "express";
import { sessionState, type SessionState } from "../auth/sessions";
import { AccessTokenPayload, verifyAccessToken } from "../utils/jwt";
import { entitlements } from "../workeasy360/entitlements";
import { workeasy360 } from "../workeasy360/settings";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
      /** The open session the access token belongs to (set by requireAuth). */
      authSession?: { id: string; method: "PASSWORD" | "WORKEASY360"; subject: string | null };
    }
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Every authenticated request:
 *
 * 1. the access token verifies (signature, audience, expiry);
 * 2. its session is still open, asked of PostgreSQL (auth/sessions.ts): a session ended by
 *    sign-out, a WorkEasy360 back-channel logout, a password change or an exit is refused at
 *    once (401 SESSION_ENDED) on every instance, however long the token had left; a deactivated
 *    account is 401 ACCOUNT_DISABLED;
 * 3. a WorkEasy360 session is served only while its company is still bound to the organization
 *    its ID token named, and with WORKEASY360_SSO_ONLY=true a password session is refused;
 * 4. for a company bound to WorkEasy360, the entitlement (per person for a WorkEasy360 session,
 *    per organization otherwise), from a cache refreshed on the provider's cadence: `deny` is
 *    403 WORKEASY360_ACCESS_ENDED, a refusal of our own client 403 WORKEASY360_ACCESS_UNVERIFIED,
 *    and a write while the subscription is read-only 403 WORKEASY360_READ_ONLY. The session
 *    itself stays valid, so /api/auth/* (me, sign-out) keeps working to explain and sign out.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  let claims: AccessTokenPayload;
  try {
    claims = verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    // verifyAccessToken also rejects MFA-challenge and refresh tokens (audience check).
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  let state: SessionState;
  try {
    state = await sessionState(claims);
  } catch (error) {
    console.error("Session check failed", error instanceof Error ? error.name : error);
    return res.status(503).json({ error: "The service is temporarily unavailable. Please try again." });
  }
  if (state.status === "account_disabled") {
    return res.status(401).json({ error: "This account has been deactivated.", code: "ACCOUNT_DISABLED" });
  }
  if (state.status === "ended") {
    return res.status(401).json({ error: "Your session has ended. Please sign in again.", code: "SESSION_ENDED" });
  }
  if (state.method === "WORKEASY360" && state.sessionOrganization !== state.boundOrganization) {
    // The company was unbound or bound to another WorkEasy360 organization since this sign-in.
    return res.status(401).json({ error: "Your session has ended. Please sign in again.", code: "SESSION_ENDED" });
  }
  if (state.method === "PASSWORD" && workeasy360.ssoOnly) {
    return res.status(401).json({ error: "Sign in with WorkEasy360.", code: "WORKEASY360_SIGN_IN_REQUIRED" });
  }

  req.user = claims;
  req.authSession = { id: claims.fam!, method: state.method, subject: state.subject };

  // Sign-out, the profile read and the account's own security settings stay reachable after
  // access ended, so the person sees why and can sign out.
  if (!workeasy360.configured || !state.boundOrganization || req.baseUrl === "/api/auth") return next();

  const access = await entitlements().check(state.boundOrganization, {
    ...(state.method === "WORKEASY360" && state.subject ? { subject: state.subject } : {}),
  });
  if (!access.allowed) {
    const refused = access.status === "refused";
    return res.status(403).json({
      error: refused
        ? "HRMS could not confirm your company's access with WorkEasy360. Please try again shortly or contact your administrator."
        : "Your access to HRMS has ended. Ask an administrator in WorkEasy360.",
      code: refused ? "WORKEASY360_ACCESS_UNVERIFIED" : "WORKEASY360_ACCESS_ENDED",
      reason: access.reason,
    });
  }
  if (!SAFE_METHODS.has(req.method) && !access.writeAllowed) {
    return res.status(403).json({
      error: "Your company's HRMS subscription is read-only at the moment: you can view and export but not change anything.",
      code: "WORKEASY360_READ_ONLY",
      reason: "read_only",
    });
  }
  return next();
}
