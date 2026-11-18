# Sign in with WorkEasy360 Accounts

HRMS signs people in through **WorkEasy360 Accounts**, the central identity provider, following the
platform's onboarding contract (`docs/universal-sso/onboarding-a-product.md` in the platform
repository, "The contract, for every adapter"). Password sign-in keeps working beside it unless
`WORKEASY360_SSO_ONLY=true`, so live customers are never locked out.

- [What happens](#what-happens)
- [Register HRMS in Super Admin](#register-hrms-in-super-admin)
- [Environment](#environment)
- [Operator commands](#operator-commands)
- [Run it locally against a provider on 127.0.0.1:8031](#run-it-locally-against-a-provider-on-12700018031)
- [Tests](#tests)
- [The Android app](#the-android-app)
- [Before go-live](#before-go-live)

## What happens

| Step | Where | What HRMS does |
|---|---|---|
| Start | `GET /api/auth/workeasy360/start?organization=<uuid>&next=<path>` | Creates `state`, `nonce` and a PKCE verifier (S256), keeps them **server-side** in PostgreSQL (`workeasy360_flows`, 10 minutes), puts only a random flow id in an httpOnly cookie, and redirects to the discovered `authorization_endpoint`. A UUID `organization` from the launcher is forwarded. |
| Callback | `GET /api/auth/callback/workeasy360` (the redirect URI) | Consumes the flow first (`DELETE ... RETURNING`: used once, on any instance), compares `state` in constant time, exchanges the code with PKCE and a **`private_key_jwt`** client assertion (`iss = sub =` client id, `aud` = the token endpoint, 60 s, fresh `jti`), and verifies the ID token (below). Then asks the entitlement endpoint, maps the organization and person, ends any session this browser already held, opens a new session and lands on `next`. Failures land on `/login?sso_error=<code>`. |
| Every request | `middleware/auth.ts` | Verifies the access token, then asks PostgreSQL whether its session is still open (one query). Ended: **401 `SESSION_ENDED`** at once on every instance. Then the entitlement, from a cache (below). |
| Back-channel logout | `POST /api/auth/workeasy360/backchannel-logout` | Verifies the logout token, records its `jti` once and ends the sessions it names, in one transaction. 200 (a duplicate too), 400 if invalid, 503 if the key set or the database cannot be read (the platform retries). |
| Sign out | `POST /api/auth/logout`, then optionally `GET /api/auth/workeasy360/logout` | Ends the HRMS session only. "Sign out of WorkEasy360 too" then sends the browser to the discovered `end_session_endpoint` with `client_id` and the registered post-logout URI; WorkEasy360 asks the person to confirm. |

**The ID token** must pass, in `src/workeasy360/client.ts` (openid-client 6 with its non-repudiation
checks, plus the contract's own): signature by `kid` from `jwks_uri` (RS256 or ES256 only; `none` and
HS256 are refused), `iss` **exactly** `WORKEASY360_ISSUER` (the discovery document's `issuer` too),
`aud` exactly the client id, `exp` / `iat` (30 s skew), `nonce`, `typ` = `id_token`, `product_code` =
`WORKEASY360_PRODUCT_CODE`, `organization_id` present, and `email_verified` = true.

**Identity and tenancy** (`src/workeasy360/provisioning.ts`):

- A company is bound to one WorkEasy360 organization (`organizations.workeasy360OrganizationId`). A
  sign-in lands only in the company bound to the token's `organization_id`, so it never crosses
  organizations. If the launcher named an organization, the token must name the same one.
- People are linked on **`(issuer, sub)`** inside that company (`external_identities`). One person in
  two companies is two HRMS users, as before.
- First WorkEasy360 sign-in of an existing employee: the company's account with the **verified**
  address is linked (WorkEasy360 has verified the address and the membership; the company was bound
  by the operator or created by WorkEasy360). An account already linked to another WorkEasy360
  identity is refused (`account_conflict`). The password stays, so password sign-in keeps working.
- **Nobody is created in an existing company.** Employees and their HR roles come from HRMS's own
  records; someone HR has not added is told so (`not_enrolled`). Roles and permissions are the
  account's own HRMS roles: nothing is authorized on `sub` alone.
- An organization no company is bound to: its first sign-in creates the company, with that person as
  its Admin and no password (`WORKEASY360_CREATE_ORGANIZATIONS=false` refuses instead, with
  `organization_not_linked`). **Bind existing companies first** (`link-organization`), or their first
  sign-in creates a new, empty company.
- A WorkEasy360 session is served only while its company is still bound to the organization the ID
  token named; unbinding ends it at once.

**Sessions** (`src/auth/sessions.ts`, `src/auth/sessionCookie.ts`): a session is a row in
`auth_sessions` whose id is the refresh-token family. Every access token carries it (`fam`), and every
request checks it, so sign-out, a back-channel logout, a password change or reset, a reused refresh
token or an exit ends its access tokens at once on every instance (they share PostgreSQL), and its
refresh is refused. For a WorkEasy360 sign-in the refresh token is an **httpOnly** cookie,
`Path=/api/auth`, `SameSite=Strict`, host-only, `Secure` (and `__Secure-` prefixed) outside local
development; the page keeps the 15-minute access token **in memory only** and renews it from the
cookie (`POST /api/auth/refresh` with `X-HRMS-Session: cookie`). Password sign-in keeps its tokens in
localStorage as before, but its access tokens are now checked and ended the same way. Cost: one
indexed query per authenticated request (about one database round trip, ~150 ms on the shared
Aurora today), deliberately not cached.

**Entitlement** (`src/workeasy360/entitlements.ts`): asked at sign-in (for the person, fresh) and then
for every request of a bound company, from a cache: an `allow` is trusted for `revalidate_after`
(between 30 and 900 s), a person's denial is re-asked after 60 s, an outage never denies (the last
answer stands; with none, access continues), and a refusal of HRMS's own client (400/401/403) **fails
closed** for every question for 60 s. Answers are kept per process and in `workeasy360_entitlements`
(shared, survives restarts), so a denial never lapses into access. `deny` is 403
`WORKEASY360_ACCESS_ENDED`, a refused client 403 `WORKEASY360_ACCESS_UNVERIFIED`, and a write while
read-only 403 `WORKEASY360_READ_ONLY`; `/api/auth/*` stays reachable so the person can see why and
sign out.

**The back-channel logout token** must be: JOSE `typ` `logout+jwt`, signed by a key of the provider's
key set (RS256/ES256), `iss` exactly the issuer, `aud` the client id, `iat` not in the future and at
most 10 minutes old, `exp` not passed, the `http://schemas.openid.net/event/backchannel-logout`
event, **no** `nonce`, `sub` and/or `sid`, a `jti` (accepted once, `workeasy360_logout_tokens`). With
`sid` it ends exactly the sessions of that WorkEasy360 sign-in; with `sub` alone ("sign out
everywhere") every session of every account linked to that person, however started.

## Register HRMS in Super Admin

Use the product's real host (see [Before go-live](#before-go-live): not the sslip.io address). With
`https://hrms.example.com` standing for it:

| Field | Value |
|---|---|
| Product code | `workeasy_hrms` (or set `WORKEASY360_PRODUCT_CODE` to the code the catalog uses) |
| Launch URL | `https://hrms.example.com/api/auth/workeasy360/start` (the launcher adds `?organization=<uuid>`) |
| Redirect URI | `https://hrms.example.com/api/auth/callback/workeasy360` (exact) |
| Back-channel logout URI | `https://hrms.example.com/api/auth/workeasy360/backchannel-logout` (same origin as the redirect URI, as ADR-069 requires) |
| Post-logout redirect URI | `https://hrms.example.com/login` |
| Login URL | `https://hrms.example.com/login` |
| Sign-in mode | `sso_optional` while password sign-in stays on; `sso_only` once `WORKEASY360_SSO_ONLY=true` |
| Scopes | `openid email profile organization` (`email` is required: it carries `email_verified`) |
| Client authentication | `private_key_jwt`: add the **public** key from `keygen` as a credential; note its credential id (`WORKEASY360_KEY_ID`) |
| Domains | Prove `hrms.example.com` with its DNS TXT record (ADR-070) before activation |

Or with the platform's operator command (the back-channel URI is then set in the console):

```
manage.py connect_product_sso --actor <staff email> --product workeasy_hrms \
    --redirect-uri https://hrms.example.com/api/auth/callback/workeasy360 \
    --post-logout-redirect-uri https://hrms.example.com/login \
    --sign-in-mode sso_optional --login-url https://hrms.example.com/login \
    --scopes "openid email profile organization" \
    --public-key-file workeasy360-public.pem
```

Then grant HRMS to a test organization (entitlement) and run the platform's conformance run
(`Accounts/e2e/run_global_logout.py`, extended with HRMS).

## Environment

In `backend/.env` (development) or `deploy/.env` (production). See `backend/.env.example`.

| Variable | Value |
|---|---|
| `WORKEASY360_ISSUER` | The issuer the integration kit names, **exactly** (no trailing slash). Today `https://auth.workeasy360.com`; `https://accounts.workeasy360.com` once ADR-067 stage b is live, in a release that also runs `move-issuer`. |
| `WORKEASY360_CLIENT_ID` | From the registration |
| `WORKEASY360_PRODUCT_CODE` | Default `workeasy_hrms` |
| `WORKEASY360_REDIRECT_URI` | `https://<host>/api/auth/callback/workeasy360` |
| `WORKEASY360_POST_LOGOUT_REDIRECT_URI` | `https://<host>/login` (empty: "Sign out of WorkEasy360 too" is not offered) |
| `WORKEASY360_KEY_ID` | The credential id of the public key |
| `WORKEASY360_PRIVATE_KEY_FILE` | Path of the private key PEM inside the container (mounted from the secret store). `WORKEASY360_PRIVATE_KEY` (inline PEM, `\n` escaped) is the alternative. Never commit either. |
| `WORKEASY360_SCOPES` | Default `openid email profile organization` (`openid` and `email` are always added) |
| `WORKEASY360_SSO_ONLY` | `true`: password sign-in, registration, resets and password changes are refused, and password sessions end. Default off. |
| `WORKEASY360_CREATE_ORGANIZATIONS` | `false`: an unbound organization is refused instead of creating a company. Default on. |
| `WORKEASY360_SIGN_IN_RATE_LIMIT` | Starts and callbacks per IP per minute per process (default 30) |
| `APP_URL` | Where a sign-in lands (the web app's origin; defaults to the first `CORS_ORIGIN`) |
| `COOKIE_SECURE` | Default: Secure cookies in production only. `true` forces them; `false` is ignored in production. |

The API refuses to start when the sign-in is half configured, or uses http outside a loopback host
in development (`configurationProblems()` in `src/workeasy360/settings.ts`). With none of the
variables set, HRMS behaves exactly as before.

## Operator commands

Development: `npm run workeasy360 -- <command>` in `backend/`. Production container:
`docker compose -f docker-compose.prod.yml exec api node dist/scripts/workeasy360.js <command>`.

| Command | What it does |
|---|---|
| `keygen --out <private.pem>` | A new RSA-3072 key pair: writes the private key (mode 600; it goes into the secret store, never the repository) and prints the **public** key for Super Admin. `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072` works too. |
| `check [--organization <uuid>]` | Readiness self-test: configuration, discovery (exact issuer), the key, and the URIs to register. With `--organization`, one real entitlement question, which proves the credential against the live provider (a refused client is an error). |
| `status` | Every company, the WorkEasy360 organization it is bound to, and how many people are linked |
| `link-organization --company <slug\|id> --organization <uuid>` | Binds an existing company to a WorkEasy360 organization, so its WorkEasy360 sign-ins land there. Run it for every live customer **before** they first sign in with WorkEasy360. |
| `unlink-organization --company <slug\|id>` | Removes the binding: the company's WorkEasy360 sessions end at once and its links are removed. Password sign-in is unaffected. |
| `move-issuer --from <old> [--to <new>] [--apply]` | Moves the `(issuer, sub)` links and open sessions to a new issuer name, in the release that changes `WORKEASY360_ISSUER` (dry run without `--apply`). |

## Run it locally against a provider on 127.0.0.1:8031

http is accepted only for loopback hosts and only outside production.

1. **The provider.** Run WorkEasy360 Accounts locally on `http://127.0.0.1:8031` (its own
   development setup). For back-channel delivery to a loopback product it needs
   `W360_EGRESS_ALLOW_LOOPBACK=true` and `W360_EGRESS_ALLOW_HTTP=true` (development only; production
   refuses both) and port 4000 in `W360_EGRESS_ALLOWED_PORTS`.
2. **A key.** `cd backend && npm run workeasy360 -- keygen --out ../../hrms-dev-key.pem` (outside the
   repository). Keep the printed public key.
3. **Register** a development integration for `workeasy_hrms`: redirect
   `http://localhost:4000/api/auth/callback/workeasy360`, back-channel
   `http://localhost:4000/api/auth/workeasy360/backchannel-logout`, post-logout
   `http://localhost:3000/login`, scopes `openid email profile organization`, sign-in mode
   `sso_optional` with login URL `http://localhost:3000/login`, the public key. Loopback hosts need no
   DNS proof. Grant HRMS to a test organization.
4. **HRMS.** Database: `docker run -d --name w360sso-hrms-pg -e POSTGRES_USER=hrms -e
   POSTGRES_PASSWORD=hrms_local_only -e POSTGRES_DB=hrms -p 127.0.0.1:15561:5432 postgres:16-alpine`
   (any free port), then in `backend/.env`:

   ```
   DATABASE_URL="postgresql://hrms:hrms_local_only@127.0.0.1:15561/hrms?schema=hrms"
   JWT_ACCESS_SECRET=<48 random characters>
   JWT_REFRESH_SECRET=<48 different random characters>
   NODE_ENV=development
   CORS_ORIGIN=http://localhost:3000
   APP_URL=http://localhost:3000
   WORKEASY360_ISSUER=http://127.0.0.1:8031
   WORKEASY360_CLIENT_ID=<client id>
   WORKEASY360_REDIRECT_URI=http://localhost:4000/api/auth/callback/workeasy360
   WORKEASY360_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/login
   WORKEASY360_KEY_ID=<credential id>
   WORKEASY360_PRIVATE_KEY_FILE=../../hrms-dev-key.pem
   ```

   `npx prisma migrate deploy && npm run workeasy360 -- check --organization <test org uuid>` (expect
   the exact issuer and `entitlement allow`), then `npm run dev`; the frontend with `npm run dev` in
   `frontend/`. Use `localhost` for both, not `127.0.0.1` for one of them: cookies are per host.
5. **Sign in**: open `http://localhost:3000/login` and choose **Continue with WorkEasy360**. The first
   sign-in from the test organization creates its company with you as Admin (or bind an existing
   one first with `link-organization`).
6. **Prove 200, then 401.** The session cookie is httpOnly, so take it from the browser's developer
   tools (Application -> Cookies -> `http://localhost:4000`, `hrms_session`), then:

   ```
   # the credential: an access token from the session cookie
   TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/refresh -H "X-HRMS-Session: cookie" \
       -H "Content-Type: application/json" -d '{}' --cookie "hrms_session=<value>" | jq -r .accessToken)
   # the protected endpoint (any signed-in person)
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/organizations/current   # 200
   ```

   Now sign out everywhere in WorkEasy360 (Account -> Security), or sign out of HRMS. The same
   command answers **401** with `{"code":"SESSION_ENDED"}` although the token has minutes left, and
   the refresh (first command, with the rotated cookie value) answers 401. For a password account the
   credential is simply `curl -X POST http://localhost:4000/api/auth/login -H "Content-Type:
   application/json" -d '{"email":"...","password":"..."}'`.

## Tests

```
cd backend
npm test                                                    # unit tests; the end-to-end suite is skipped and says why
HRMS_TEST_DATABASE_URL="postgresql://hrms:hrms_local_only@127.0.0.1:15561/hrms" npm test   # everything
```

- `src/workeasy360/client.test.ts` (no database): the flow and every ID token check against a fake
  provider whose keys are generated at test time (`src/workeasy360/testing/fakeProvider.ts`): wrong
  issuer, audience (also an extra one), signature (stranger key, unknown kid, `none`, HS256 with the
  public key), nonce, expiry, `iat`, `typ`, product, organization, email; code reuse; PKCE; state;
  the client assertion's claims; logout token verification (bad signature, other issuer, other
  audience, wrong or missing `typ`, missing or malformed event, nonce, no `sub`/`sid`, no `jti`,
  expired, too old, an ID token presented as one, an unreadable key set); the entitlement call.
- `src/workeasy360/entitlements.test.ts` (no database): the cache's cadence, outages, refusals and
  denials.
- `src/workeasy360/sso.e2e.test.ts` (PostgreSQL): three real API processes on one schema of their own
  (created and dropped by the test). Happy path; ID token failures end to end; wrong product;
  missing organization; not entitled; no seat; read-only; client refusal; cross-organization
  attempts; back-channel logout valid (by `sid` and by `sub`), forged (bad signature, other issuer,
  other audience, wrong `typ`, missing event, nonce, expired) and replayed; **an unexpired access
  token refused at once on both instances after logout, and refresh refused**; sign-out; account
  switching; exits; password sign-in and `WORKEASY360_SSO_ONLY`.

## The Android app

The app (`mobile/`) is a Capacitor WebView that loads the live site. It **stays on password sign-in**
for now: the login page hides "Continue with WorkEasy360" inside the app. Signing in through
WorkEasy360 inside a WebView would be an embedded user agent, which OAuth for native apps (RFC 8252)
rules out, and Capacitor would open the provider in the system browser anyway, where the session
cookie would land outside the app.

What the app needs (a separate, testable-on-a-device change, not in this branch):

1. Open the authorization request in the **system browser** (Custom Tabs, `@capacitor/browser`), with
   its own PKCE verifier, state and nonce.
2. Register a **claimed https redirect** (Android App Link) such as
   `https://<hrms host>/app/callback/workeasy360`: an intent filter with `autoVerify` in the manifest
   and `/.well-known/assetlinks.json` on the HRMS host naming `com.workeasy360.hrms` and the signing
   key's SHA-256. Register that URI with WorkEasy360 too.
3. Receive the callback (`@capacitor/app` `appUrlOpen`), close the browser, and hand the code, state
   and verifier to a new HRMS endpoint that exchanges them exactly as the web callback does and opens
   the session inside the WebView (sets the session cookie for the WebView's own cookie store).
4. Rebuild and sign the APK. This needs the final domain: the App Link and `assetlinks.json` cannot
   be bound to the sslip.io address.

Until then **do not set `WORKEASY360_SSO_ONLY=true`**: app users would be locked out.

## Before go-live

1. **Move off sslip.io.** `52-66-103-213.sslip.io` is not a domain the owner controls, so it cannot
   be proven with a DNS TXT record, and WorkEasy360 refuses to activate an integration until every
   hostname in it is proven (ADR-070). Choose a host under a domain the owner controls (for example
   `hrms.workeasy360.com`), point it at the server, issue its certificate (`deploy/scripts/init-letsencrypt.sh`),
   set the `DOMAIN` repository variable, and rebuild the APK, whose server URL is the sslip.io address.
2. Publish the `_w360-product-verify.<host>` TXT record Super Admin shows, and keep it published.
3. Generate the production key pair; put the private key in the secret store and mount it into the
   `api` container; set the `WORKEASY360_*` variables in `deploy/.env`.
4. Register the production integration (above), grant HRMS to the customers' organizations and map
   their plans.
5. Bind every live company to its WorkEasy360 organization with `link-organization` **before**
   announcing the button (otherwise a first sign-in creates an empty company).
6. Deploy (the migration is additive), run `check --organization <uuid>`, sign in once and sign out
   everywhere, run the platform's conformance run, then activate and publish the integration.
7. Keep `WORKEASY360_SSO_ONLY` off until the Android app signs in through WorkEasy360.
8. Issuer: configure the one the kit names today (`auth.`); move to `accounts.` only in a release that
   also runs `move-issuer --from https://auth.workeasy360.com --apply`.
