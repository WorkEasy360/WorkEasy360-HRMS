import type { CookieOptions, Request, Response } from "express";
import { REFRESH_TTL_SECONDS } from "../utils/refreshTokens";

/**
 * The session cookie of a WorkEasy360 sign-in: the refresh token, httpOnly, never readable by
 * the page. The page keeps only the short-lived access token, in memory.
 *
 * - `Path=/api/auth`: sent only to refresh, logout and the sign-in callback, never with
 *   ordinary API calls.
 * - `SameSite=Strict`: never sent on a cross-site request, so another site cannot make the
 *   browser renew or end the session. (The callback that sets it is a cross-site navigation
 *   from WorkEasy360; setting a cookie there is allowed, and nothing reads it there.)
 * - Host-only (no Domain): there is never a cookie for a parent domain.
 * - `Secure` outside local development (production, or COOKIE_SECURE=true), and then named with
 *   the `__Secure-` prefix, which browsers refuse to accept over http or without Secure.
 *
 * Requests that rely on it (refresh and logout without a token in the body) must also send the
 * `X-HRMS-Session: cookie` header: a simple cross-site form cannot set a custom header, and a
 * script on another origin cannot send one without a CORS preflight this API refuses.
 */
export const SESSION_COOKIE = "hrms_session";
export const SECURE_SESSION_COOKIE = `__Secure-${SESSION_COOKIE}`;
export const SESSION_COOKIE_PATH = "/api/auth";
export const COOKIE_SESSION_HEADER = "x-hrms-session";

export function cookiesSecure(): boolean {
  const configured = (process.env.COOKIE_SECURE ?? "").trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return process.env.NODE_ENV !== "production";
  return process.env.NODE_ENV === "production";
}

export function sessionCookieName(): string {
  return cookiesSecure() ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}

function options(maxAgeMs: number): CookieOptions {
  return { httpOnly: true, secure: cookiesSecure(), sameSite: "strict", path: SESSION_COOKIE_PATH, maxAge: maxAgeMs };
}

export function setSessionCookie(res: Response, refreshToken: string): void {
  res.cookie(sessionCookieName(), refreshToken, options(REFRESH_TTL_SECONDS * 1000));
}

export function clearSessionCookie(res: Response): void {
  const { maxAge: _ignored, ...rest } = options(0);
  res.clearCookie(sessionCookieName(), rest);
}

/** The refresh token from the session cookie (only the expected name is read), or null. */
export function readSessionCookie(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[sessionCookieName()];
  return typeof value === "string" && value.length > 0 && value.length < 4096 ? value : null;
}

/** The request explicitly asks to use the session cookie (the CSRF guard above). */
export function wantsCookieSession(req: Request): boolean {
  return (req.get(COOKIE_SESSION_HEADER) ?? "").toLowerCase() === "cookie";
}
