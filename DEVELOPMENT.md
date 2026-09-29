# Developer guide

Everything you need to change WorkEasy360 HRMS and ship it. Production details live in [deploy/README.md](./deploy/README.md), the domain model in [ARCHITECTURE.md](./ARCHITECTURE.md), and day-to-day user workflows in [WORKFLOWS.md](./WORKFLOWS.md).

## At a glance

| | |
|---|---|
| **Live site** | https://52-66-103-213.sslip.io (API under `/api`, health at `/api/health`) |
| **Repository** | https://github.com/WorkEasy360/WorkEasy360-HRMS, branch `main` |
| **Deploy** | Push to `main`. GitHub Actions builds the images and rolls them out to the EC2 host (about 2–3 min). |
| **Stack** | Backend: Express + TypeScript + Prisma 5 (PostgreSQL). Frontend: Next.js 16 + React 19 + Tailwind 4. |
| **Production DB** | Shared Aurora PostgreSQL 18 (eu-north-1). This app owns schema `hrms` only, as role `hrms_app`. |
| **Server** | EC2 `52.66.103.213` (ap-south-1, Ubuntu 26.04, t3.small), user `ubuntu`, code in `~/hrms/deploy` |

## Run it locally

Prerequisites: Node 20+, Docker Desktop.

1. **Database:** the local Postgres is the Docker container `workeasy-postgres` on port **5433**, not the native Postgres on 5432.
   ```bash
   # start Docker Desktop first
   docker start workeasy-postgres
   ```
   On a new machine, create it once:
   ```bash
   docker run -d --name workeasy-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=workeasy360 -p 5433:5432 postgres:16
   ```
2. **Backend** (http://localhost:4000):
   ```bash
   cd backend
   npm install
   cp .env.example .env    # first time only: set DATABASE_URL to port 5433; JWT secrets must be 32+ chars
   npx prisma migrate dev  # LOCAL ONLY: applies migrations to your local DB
   npm run dev
   ```
3. **Frontend** (http://localhost:3000):
   ```bash
   cd frontend
   npm install
   cp .env.local.example .env.local   # first time only
   npm run dev
   ```
4. Open http://localhost:3000/register and create a test organization.

Useful local switches in `backend/.env`:
- `MAIL_TRANSPORT=log` turns on the invite, reset and notification emails, but prints them to the backend console instead of sending them. Links in the log open the real pages.
- `ALLOW_PUBLIC_REGISTRATION=false` hides and blocks sign-up, like production after launch.

To stop everything: `Ctrl+C` in both terminals, then `docker stop workeasy-postgres`.

## Where things are

### Backend (`backend/src`)

- `index.ts`: middleware (helmet, CORS, body limit, rate limits), route mounting, `/api/health`, graceful shutdown.
- `modules/<feature>/<feature>.routes.ts`: one Express router per feature (leave, payroll, recruitment…).
- `middleware/`
  - `auth.ts` (`requireAuth`)
  - `requirePermission.ts`
  - `rateLimit.ts` (in-memory)
  - `errorHandler.ts`
- `utils/`
  - `permissions.ts`: the permission catalog and default roles (Admin, HR, Manager, Employee)
  - `tenant.ts`: `assertInOrg`, `assertCanDecide` (tenant isolation and approval rules)
  - `jwt.ts`, `refreshTokens.ts`, `passwordTokens.ts`: tokens and single-use links
  - `mailer.ts`, `emailTemplates.ts`, `notifications.ts`: SES email, queued and best-effort
  - `createEmployee.ts`: shared by "Add employee" and "Hire candidate"
  - `date.ts`: date helpers for `@db.Date` columns (UTC midnight)
- `prisma/schema.prisma` and `prisma/migrations/`: the schema; migrations are committed and applied in order.

### Frontend (`frontend/src`)

- `app/(app)/…/page.tsx`: signed-in pages. `app/(app)/layout.tsx` is the shell: sidebar, search, approvals bell, and a no-access guard.
- `app/login`, `register`, `forgot-password`, `reset-password`: public pages.
- `lib/`
  - `api.ts` (`apiFetch`: auth header, token refresh, readable errors)
  - `auth-context.tsx` (`useAuth`, `hasPermission`)
  - `navigation.ts`: **the menu and page permissions, in one place**
  - `use-app-config.ts`: server flags such as email and registration
- `components/`
  - `ui.tsx`: Button, PageHeader, Card, EmptyState, LoadingRows, ErrorBanner
  - `feedback.tsx`: `useFeedback()` for `toast.*` and `confirm()`
  - `format.ts`: `formatDate`, `formatMoney` (₹) and friends
  - `globals.css` (in `app/`) defines the `.input`, `.label` and `.table-wrap` classes

## Rules the code follows (keep them)

**Security and data**
- **Every query is scoped to the organization.** Use `findFirst({ where: { id, organizationId } })`, never a bare `findUnique({ where: { id } })` on data from a request. Any id taken from a request body (managerId, departmentId…) must pass `assertInOrg(...)`.
- **Validate input with zod** using `safeParse`, and return `400 { error: parsed.error.flatten() }`. Give every string a `.max()`. Money gets `.finite().max(...)`. The frontend turns these errors into readable messages automatically.
- **Guard routes with `requirePermission(PERMISSIONS.X)`.** Self-service routes use `req.user.employeeId`. Approvals go through `assertCanDecide`, which blocks approving your own request.
- **Change state atomically:** `updateMany({ where: { id, status: "PENDING" } })` and check `count`. This prevents double approvals and double payroll.
- **Throw `HttpError(status, "Human sentence")`** for expected failures; the error handler turns it into JSON.

**The production database is far away (~150 ms per query)**
- Avoid queries inside loops. Load what you need up front (`findMany({ where: { id: { in: ids } } })`) and write in bulk (`createMany`, `createManyAndReturn`). See `payroll.routes.ts` (process run) and `loadUserContext.ts`.
- Run independent queries in parallel with `Promise.all`.
- Deeply nested `include`s cost one round trip per level.
- Transactions may take up to 30 s (`DB_TRANSACTION_TIMEOUT_MS`), but keep them short.

**Emails and side effects**
- Send notifications after the response, with `void notifyX(id)` from `utils/notifications.ts`. They never throw and never block the request.
- If `SES_REGION` isn't set, email is off: the app shows HR temporary passwords instead of sending invites. Code must work in both modes (see `createEmployee.ts`).

**Frontend**
- Use the UI kit (`PageHeader`, `Button`, `EmptyState`, `LoadingRows`, `.input`, `.table-wrap`) and `useFeedback()`: a toast on success and `confirm({ destructive: true })` before anything irreversible.
- Show a page to the people who can use it: add or adjust it in `lib/navigation.ts` with `anyOf: [permissions]`. The layout then hides it from the menu and shows "no access" to everyone else.
- Next.js 16 differs from older versions. Check `frontend/node_modules/next/dist/docs/` before using a Next API you haven't used here.
- Lint rule `react-hooks/set-state-in-effect` is on. For fetch-on-mount, follow the existing `// eslint-disable-next-line … -- initial data fetch on mount` pattern.

## Adding a feature: checklist

1. **Schema change?** Edit `backend/prisma/schema.prisma`, then run `npx prisma migrate dev --name <what_changed>` **locally**. Commit the new folder in `prisma/migrations/`. Stop the backend first on Windows, because Prisma's engine file is locked while it runs.
   - Migrations must only touch this app's tables. Run `bash deploy/scripts/check-migrations.sh backend/prisma/migrations`; the deploy runs it too and refuses `public.`, `helpdesk`, extensions, roles and grants.
   - Prefer additive changes: new tables, nullable columns or columns with defaults. Migrations only go forward in production; rollback means shipping a new migration.
2. **New permission?** Add it to `PERMISSIONS` and the right `SYSTEM_ROLES` in `utils/permissions.ts`. The catalog is seeded on boot. Existing organizations' roles don't get new permissions automatically, so an admin must grant them.
3. **API:** a new router in `modules/<feature>/`, mounted in `index.ts` under `/api/<feature>`.
4. **Frontend:** a page in `app/(app)/<feature>/page.tsx`, a nav entry in `lib/navigation.ts`, and types in `lib/types.ts`.
5. **Check before pushing:**
   ```bash
   cd backend  && npx tsc --noEmit
   cd frontend && npx tsc --noEmit && npx eslint src && npx next build
   ```
6. Commit and push to `main`. Watch **Actions → Deploy**. The run applies migrations, then swaps containers, then smoke-tests the site.

## Deployment

How it works (details: [deploy/README.md](./deploy/README.md)):
1. `.github/workflows/deploy.yml` runs on every push to `main`, except pushes that only change Markdown. You can also start it by hand: Actions → Deploy → Run workflow.
2. It builds `ghcr.io/workeasy360/hrms-api` and `hrms-web`, tagged with the commit sha, **on GitHub**. The t3.small can't build them.
3. It copies `deploy/` and `backend/prisma/migrations/` to `~/hrms` on the server, then runs `deploy/scripts/deploy.sh`: pull images, `prisma migrate deploy` (one-off `migrate` service), `up -d`, wait for healthy.
4. Smoke test: `https://DOMAIN/api/health` and `/login`.

**GitHub settings** (Settings → Secrets and variables → Actions):
- Secrets: `EC2_HOST` = `52.66.103.213`, `EC2_USER` = `ubuntu`, `EC2_SSH_KEY` = the GitHub-only deploy key
- Variable: `DOMAIN` = `52-66-103-213.sslip.io`

**Rollback:** Actions → Deploy → pick an older successful run → Re-run all jobs.

**Server access:**
```bash
ssh -i <path-to>/helpdesk-ec2.pem ubuntu@52.66.103.213
cd ~/hrms/deploy
C="docker compose -f docker-compose.prod.yml"
$C ps                        # status and health
$C logs -f --tail=200 api    # API logs
```

**Changing a production setting:** edit `~/hrms/deploy/.env` on the server (it is `chmod 600` and exists only there, never in git), then run `$C up -d api`. Values it holds:
- `DOMAIN`, `LETSENCRYPT_EMAIL`
- `DATABASE_URL` (role `hrms_app`, `?schema=hrms`)
- `JWT_*` secrets
- `ALLOW_PUBLIC_REGISTRATION`
- `APP_TIMEZONE`
- `SES_REGION` / `MAIL_FROM` (commented out until SES is ready)
- `IMAGE_PREFIX` / `IMAGE_TAG` (written by the deploy)

A new environment variable needs three changes: read it in the backend, document it in `deploy/.env.example` (and `backend/.env.example`), and add it to the server's `.env`.

**Changing the domain:**
1. Point DNS at `52.66.103.213`.
2. Update `DOMAIN` in the server `.env`.
3. On the server, run `bash scripts/init-letsencrypt.sh`.
4. Update the `DOMAIN` variable on GitHub, then re-run the workflow. The web bundle bakes in the API URL.

### Never do this in production

- Don't run `prisma migrate dev`, `migrate reset`, `db push`, or any seed against Aurora. Releases only run `prisma migrate deploy`.
- Don't touch schemas `public` (another product) or `helpdesk` (the help desk app), and don't change grants for other roles. The Aurora admin (`postgres`) login is only for creating this app's role and schema (`deploy/sql/01-create-role-and-schema.sql`, already done).
- Don't build images on the server, and don't upload images from a PC. Let GitHub Actions build them.
- Don't commit `.env` files or keys. `.gitignore` already covers `.env*` (except `*.example`).

## Gotchas we hit

- **Windows + OneDrive:** `docker build` from this folder fails with `unknown file mode`, because OneDrive turns untouched files into online-only placeholders. Build from a copy outside OneDrive, or just let GitHub build.
- **Windows:** killed dev servers can leave orphan `node` processes holding ports 3000/4000. Find the owner with `Get-NetTCPConnection -LocalPort 4000` and stop it.
- **Prisma on Windows:** `migrate dev` fails with a locked `query_engine-windows.dll.node` while the backend is running; stop it first.
- **Dates:** `@db.Date` columns are stored as UTC midnight. Use `today()` and `monthRange()` from `utils/date.ts`, and `localIsoDate()` from `components/format.ts` on the frontend. The API container runs with `TZ=Asia/Kolkata` (from `APP_TIMEZONE`).
- **Rate limits:** 10 sign-in and password requests per minute per IP. Test scripts that sign in repeatedly will hit HTTP 429. That's intended.
- **Shared cluster capacity:** Aurora allows 79 connections in total. This app uses at most 10 (role limit 20); the help desk and the other product share the rest.

## Open items

- Email: verify `workeasy360.com` in SES (ap-south-1), get production access, and allow the `helpdesk-ec2` instance role to use `ses:SendEmail` on that identity. Then set `SES_REGION` and `MAIL_FROM` on the server.
- Close public sign-up once the real organization exists (`ALLOW_PUBLIC_REGISTRATION=false`).
- Move to a real domain (see above).
- Rotate the Aurora admin password and the first HRMS admin password; both were shared during setup.
- Later: refresh token in an httpOnly cookie instead of `localStorage`; Redis-backed rate limiting if the API ever runs on more than one host.
