# WorkEasy360 HRMS

Read [DEVELOPMENT.md](./DEVELOPMENT.md) first: local setup, code map, conventions, feature checklist, deployment and gotchas. Production runbook: [deploy/README.md](./deploy/README.md).

Non-negotiables:
- Pushing to `main` deploys to production (https://52-66-103-213.sslip.io) through GitHub Actions. Only push when the user asks.
- Production DB is a SHARED Aurora cluster. This app may only touch schema `hrms` as role `hrms_app`. Never run `prisma migrate dev` / `migrate reset` / `db push` / seeds against it, and never touch schemas `public` or `helpdesk`.
- Every query is scoped by `organizationId`; body-supplied ids go through `assertInOrg`. Validate input with zod `safeParse`.
- The DB is ~150 ms away in production: no queries in loops, prefer bulk reads/writes and `Promise.all`.
- Local DB is the Docker container `workeasy-postgres` on port 5433 (start Docker Desktop first).
- Before finishing a change: `npx tsc --noEmit` in backend; `npx tsc --noEmit && npx eslint src` in frontend.
