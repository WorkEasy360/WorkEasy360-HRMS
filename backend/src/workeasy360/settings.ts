import { readFileSync } from "node:fs";
import { isIPv4 } from "node:net";

/**
 * WorkEasy360 Accounts sign-in configuration, read from the environment. The names are
 * the ones the platform's integration kit writes into `.env.example`:
 *
 *   WORKEASY360_ISSUER                    exactly as the kit names it (no trailing slash)
 *   WORKEASY360_CLIENT_ID
 *   WORKEASY360_PRODUCT_CODE              default workeasy_hrms
 *   WORKEASY360_REDIRECT_URI              https://<host>/api/auth/callback/workeasy360
 *   WORKEASY360_POST_LOGOUT_REDIRECT_URI  https://<host>/login (optional: WorkEasy360 sign-out)
 *   WORKEASY360_KEY_ID                    the credential id of the registered public key
 *   WORKEASY360_PRIVATE_KEY_FILE          path to the private key PEM (or WORKEASY360_PRIVATE_KEY inline)
 *   WORKEASY360_SCOPES                    default "openid email profile organization"
 *   WORKEASY360_SSO_ONLY                  "true": password sign-in is switched off
 *
 * HRMS-specific:
 *
 *   WORKEASY360_CREATE_ORGANIZATIONS      "false": a WorkEasy360 organization that no company is
 *                                         bound to is refused instead of creating a company
 *   WORKEASY360_LINK_BY_VERIFIED_EMAIL    "true": a first WorkEasy360 sign-in links the bound company's
 *                                         unlinked account with the verified address (audited).
 *                                         Default off: that sign-in is refused (account_conflict)
 *                                         and an operator links the account with `link-user`.
 *
 * Nothing here is cached: tests and operators change the environment, and reading a few
 * variables per request is free. The private key is read when it is needed.
 */

const LOOPBACK_NAMES = new Set(["localhost", "[::1]", "::1"]);

/**
 * A loopback host as the platform and its reference connector define it (Python's
 * `ipaddress.is_loopback`, RFC 6890): `localhost`, ::1 and the whole of 127.0.0.0/8, not only
 * 127.0.0.1 - a product can run on 127.0.0.13 in a local run next to others. `URL` has already
 * normalised the host (lower case, IPv4 in dotted decimal, IPv6 in brackets).
 */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_NAMES.has(hostname) || (isIPv4(hostname) && hostname.startsWith("127."));
}

export const DEFAULT_PRODUCT_CODE = "workeasy_hrms";
export const DEFAULT_SCOPES = ["openid", "email", "profile", "organization"];

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export const workeasy360 = {
  get issuer(): string {
    return env("WORKEASY360_ISSUER");
  },
  get clientId(): string {
    return env("WORKEASY360_CLIENT_ID");
  },
  get redirectUri(): string {
    return env("WORKEASY360_REDIRECT_URI");
  },
  get postLogoutRedirectUri(): string {
    return env("WORKEASY360_POST_LOGOUT_REDIRECT_URI");
  },
  get keyId(): string {
    return env("WORKEASY360_KEY_ID");
  },
  get productCode(): string {
    return env("WORKEASY360_PRODUCT_CODE") || DEFAULT_PRODUCT_CODE;
  },
  get scopes(): string[] {
    const configured = env("WORKEASY360_SCOPES").split(/\s+/).filter(Boolean);
    const scopes = configured.length ? configured : DEFAULT_SCOPES;
    // `openid` is what makes this OpenID Connect; `email` carries the verified address the
    // contract requires (email_verified), so neither can be configured away.
    for (const required of ["openid", "email"]) if (!scopes.includes(required)) scopes.unshift(required);
    return [...new Set(scopes)];
  },
  /** WorkEasy360 is the only way in: password sign-in, registration and resets are off. */
  get ssoOnly(): boolean {
    return env("WORKEASY360_SSO_ONLY").toLowerCase() === "true";
  },
  /** A first sign-in from an unbound WorkEasy360 organization creates its company. */
  get createOrganizations(): boolean {
    return env("WORKEASY360_CREATE_ORGANIZATIONS").toLowerCase() !== "false";
  },
  /**
   * A first sign-in may link the bound company's existing, unlinked account with the verified
   * address. Off unless exactly "true": an email match is refused and an operator links the
   * account with `link-user` (an operator-vouched link, as the other WorkEasy360 products do).
   */
  get linkByVerifiedEmail(): boolean {
    return env("WORKEASY360_LINK_BY_VERIFIED_EMAIL").toLowerCase() === "true";
  },
  /** Everything a sign-in needs is present (says nothing about whether the provider answers). */
  get configured(): boolean {
    return Boolean(
      this.issuer &&
        this.clientId &&
        this.redirectUri &&
        this.keyId &&
        (env("WORKEASY360_PRIVATE_KEY") || env("WORKEASY360_PRIVATE_KEY_FILE")),
    );
  },
  get signOutAvailable(): boolean {
    return this.configured && Boolean(this.postLogoutRedirectUri);
  },
  /** Where the browser lands after sign-in: the web app (APP_URL, else the first CORS origin). */
  get appOrigin(): string {
    const configured = env("APP_URL") || (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",")[0].trim();
    return new URL(configured || "http://localhost:3000").origin;
  },
};

/** The private key PEM from WORKEASY360_PRIVATE_KEY_FILE (preferred) or WORKEASY360_PRIVATE_KEY. */
export function privateKeyPem(): string {
  const file = env("WORKEASY360_PRIVATE_KEY_FILE");
  if (file) return readFileSync(file, "utf8");
  // An inline key in an env file usually has its newlines escaped.
  return env("WORKEASY360_PRIVATE_KEY").replace(/\\n/g, "\n");
}

/** http is accepted only for a loopback host outside production (local development). */
export function isAcceptableUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && !isProduction() && isLoopbackHost(url.hostname);
}

/**
 * Configuration mistakes that must stop the API from starting (an unusable sign-in is
 * better found at deploy time than by the first person). Empty: fine, or not configured.
 */
export function configurationProblems(): string[] {
  const s = workeasy360;
  const anySet = ["WORKEASY360_ISSUER", "WORKEASY360_CLIENT_ID", "WORKEASY360_REDIRECT_URI", "WORKEASY360_KEY_ID"].some(
    (name) => env(name),
  );
  const problems: string[] = [];
  if (s.ssoOnly && !s.configured) problems.push("WORKEASY360_SSO_ONLY=true needs the WorkEasy360 sign-in to be configured");
  if (!anySet) return problems;
  if (!s.configured) {
    problems.push(
      "WorkEasy360 sign-in is partly configured: set WORKEASY360_ISSUER, WORKEASY360_CLIENT_ID, WORKEASY360_REDIRECT_URI, WORKEASY360_KEY_ID and WORKEASY360_PRIVATE_KEY_FILE",
    );
    return problems;
  }
  if (!isAcceptableUrl(s.issuer)) problems.push("WORKEASY360_ISSUER must be https (http only for a loopback host outside production)");
  if (s.issuer.endsWith("/")) problems.push("WORKEASY360_ISSUER must not end with a slash: it is compared exactly");
  if (!isAcceptableUrl(s.redirectUri)) problems.push("WORKEASY360_REDIRECT_URI must be https (http only for a loopback host outside production)");
  if (s.postLogoutRedirectUri && !isAcceptableUrl(s.postLogoutRedirectUri)) {
    problems.push("WORKEASY360_POST_LOGOUT_REDIRECT_URI must be https (http only for a loopback host outside production)");
  }
  return problems;
}
