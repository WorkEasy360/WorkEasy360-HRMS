# WorkEasy360 HRMS

Multi-tenant HRMS (Zoho People / Razorpay X–class). See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full architecture, domain model, and roadmap.

## Folder structure

```
frontend/     # Next.js app
backend/      # Node.js + Express + PostgreSQL API
README.md
```

> Deploying to AWS (Aurora / RDS PostgreSQL)? See [DEPLOY.md](./DEPLOY.md) for environment variables, Docker images and a launch checklist.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ running locally (or a connection string to one)

## Backend setup

```bash
cd backend
npm install
cp .env.example .env     # edit DATABASE_URL / JWT secrets as needed
npx prisma migrate dev   # creates the schema
npm run dev               # http://localhost:4000
```

The permission catalog is seeded automatically on server boot, so no separate seed step is required after migrating.

## Frontend setup

```bash
cd frontend
npm install
cp .env.local.example .env.local   # points at http://localhost:4000/api by default
npm run dev                         # http://localhost:3000
```

## What's implemented (v0)

**Phase 0 — foundation**
- Multi-tenant org registration (creates Organization + Admin user + Employee)
- JWT auth (access + refresh tokens), login, session restore
- RBAC: system default roles (Admin, HR, Manager, Employee) with per-permission API guards
- People: Employee Directory (search, add employee), employee profile view
- My Workspace: My Profile
- Settings: Organization profile

**Phase 1 — self-service core**
- My Workspace: My Attendance (check-in/check-out, history)
- My Workspace: My Leave (leave types, request, cancel own pending request)
- Approvals: manager-chain approval (a request routes to the employee's manager) plus org-wide approval for HR/Admin; approving a leave request increments a per-employee/per-leave-type/per-year balance
- Announcements: publish (HR/Admin) and view (everyone), surfaced on the Home dashboard

**Phase 2 — talent + payroll basics**
- Talent: Onboarding checklists (default tasks auto-created per new hire, HR/Admin can add more; employee self-checks off their own tasks)
- Time & Attendance: Shifts (HR/Admin define shift templates and assign employees; everyone sees their own current shift)
- Time & Attendance: Timesheets (self log daily hours; manager-chain or HR/Admin approval, surfaced on the same Approvals page as leave)
- Payroll: Compensation (HR/Admin set annual CTC per employee, effective-dated), Payroll Processing (create a monthly run, process it to generate payslips from each active employee's current compensation), My Payslips (self view)
  - Payroll deductions use a flat placeholder rate for v0 — real statutory calculations (PF/ESI/TDS) are deferred to v1, see `ARCHITECTURE.md` §10.

**Phase 3 — scale features**
- Talent: Performance (review cycles opened for every active employee; self-assessment, then manager-chain or HR/Admin assessment + rating), My Goals (self-service goal tracking with progress)
- HR Services: Help Desk (self-raised tickets; HR/Admin triage, assign, resolve), HR Guide (org-wide policy articles, HR/Admin authored)
- Reports: Headcount (by status/department), Attrition (exits by month), Leave Liability (remaining/used days by leave type), Payroll Cost (gross/net by run) — all read-only aggregations
- Automation: a lightweight rule engine — `when <trigger> then <action>` rules an HR/Admin can create (triggers: employee onboarded, leave approved, timesheet approved; actions: create an announcement, assign an onboarding task). Dispatches inline from the triggering request, best-effort (a rule failure never breaks the request that fired it)
- Security: TOTP-based 2FA (self-service setup/disable, enforced at login via a short-lived MFA challenge token), and an audit log for sensitive mutations (organization changes, role creation/assignment, compensation records, payroll processing), viewable under Settings → Security

**Not implemented — SSO (Integrations)**: real Google/Microsoft OAuth login requires an actual OAuth app (client ID/secret) registered in that provider's console, which this environment doesn't have. Rather than ship an unusable stub, this is left out of v0; wiring it up (via Passport.js, per `ARCHITECTURE.md`'s stack) is straightforward once real credentials are available.

v0 (Phases 0–3) is feature-complete per `ARCHITECTURE.md`'s roadmap.

## What's implemented (v1)

**Phase 4 — talent acquisition & spend**
- Talent: Recruitment (job postings; candidate pipeline with stages APPLIED→SCREENING→INTERVIEW→OFFER→HIRED/REJECTED; interview scheduling + feedback/rating; "Hire" converts a candidate straight into a real Employee — same onboarding checklist and EMPLOYEE_ONBOARDED automation as adding one directly)
- My Workspace: My Expenses (submit a claim; manager-chain or HR/Admin approval on the Approvals page; HR/Admin marks reimbursed from Payroll)
- Assets: company asset inventory (HR/Admin add/assign/return/retire); My Assets (self view of what's assigned to you)
- My Workspace: My Loans (request an amount + EMI term; manager-chain or HR/Admin approval activates it). Approved loans auto-deduct their monthly EMI in every payroll run alongside the statutory placeholder, closing automatically once the balance reaches zero

**Not implemented — e-Signature**: same reasoning as SSO above — real e-signing needs a provider (DocuSign/Zoho Sign-class) account and API keys this environment doesn't have.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §10 for the rest of v1 (Benefits, LMS, Succession Planning, Grievance, Statutory Compliance, Mobile App, HR Analytics, Public API, AI HR Assistant).
