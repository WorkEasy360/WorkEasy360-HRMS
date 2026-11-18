/**
 * Why a WorkEasy360 sign-in did not complete. The code is what the browser sees
 * (`/login?sso_error=<code>`); the detail is for the log only and never carries a code,
 * token, state or nonce.
 */
export type SsoErrorCode =
  | "unavailable" // not configured, or the provider / database could not be reached
  | "expired" // no pending flow for this browser, or the state does not match
  | "cancelled" // the person cancelled at WorkEasy360
  | "refused" // the provider refused, or the ID token did not verify
  | "wrong_product" // the ID token is for another product
  | "wrong_organization" // the ID token names another organization than the launcher asked for
  | "organization_missing" // the ID token carries no organization_id
  | "email_unverified" // no verified email address in the ID token
  | "not_entitled" // the organization (or person) may not use HRMS
  | "access_unverified" // WorkEasy360 refused this product's own client
  | "organization_not_linked" // no company is bound to the WorkEasy360 organization
  | "not_enrolled" // the company has no employee with this address
  | "account_disabled" // the HRMS account is deactivated (e.g. an exit)
  | "account_conflict" // the HRMS account is linked to another WorkEasy360 account
  | "rate_limited";

export class SsoRefusal extends Error {
  constructor(
    readonly code: SsoErrorCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "SsoRefusal";
  }
}

/** Errors the provider can send back to the redirect URI, mapped onto what the person is shown. */
export function codeForProviderError(error: string): SsoErrorCode {
  switch (error) {
    case "access_denied":
      return "cancelled";
    case "product_not_entitled":
      return "not_entitled";
    case "temporarily_unavailable":
    case "server_error":
      return "unavailable";
    default:
      return "refused";
  }
}

/** A failure inside the WorkEasy360 client: what kind of thing went wrong. */
export class Workeasy360Error extends Error {
  constructor(
    readonly code:
      | "provider_unavailable" // discovery, the key set or an endpoint could not be reached (retry later)
      | "provider_misconfigured" // the provider's metadata or our own key is unusable
      | "provider_refused" // the provider answered and refused our client (400/401/403)
      | "rate_limited"
      | "sign_in_refused" // the token endpoint refused the code (invalid_grant and friends)
      | "invalid_token", // a token did not verify
    readonly detail = "",
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "Workeasy360Error";
  }
}
