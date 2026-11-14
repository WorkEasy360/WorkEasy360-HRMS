-- WorkEasy HRMS - Essential Development Note v9.
--
-- DESTRUCTIVE. This migration drops the modules removed from the essential
-- release (performance, goals, assets, expenses, loans, shifts, timesheets,
-- HR guide, the generic automation-rule builder) together with their data, and
-- restructures recruitment so one candidate can hold several applications.
--
-- Review before running against any database that holds real records.

-- ---------------------------------------------------------------------------
-- 1. Drop the out-of-scope modules.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "goals" CASCADE;
DROP TABLE IF EXISTS "performance_reviews" CASCADE;
DROP TABLE IF EXISTS "review_cycles" CASCADE;
DROP TABLE IF EXISTS "timesheet_entries" CASCADE;
DROP TABLE IF EXISTS "shift_assignments" CASCADE;
DROP TABLE IF EXISTS "shift_templates" CASCADE;
DROP TABLE IF EXISTS "expense_claims" CASCADE;
DROP TABLE IF EXISTS "assets" CASCADE;
DROP TABLE IF EXISTS "loan_requests" CASCADE;
DROP TABLE IF EXISTS "hr_guide_articles" CASCADE;
DROP TABLE IF EXISTS "automation_rules" CASCADE;

DROP TYPE IF EXISTS "GoalStatus";
DROP TYPE IF EXISTS "ReviewStatus";
DROP TYPE IF EXISTS "ReviewCycleStatus";
DROP TYPE IF EXISTS "TimesheetStatus";
DROP TYPE IF EXISTS "ExpenseStatus";
DROP TYPE IF EXISTS "AssetStatus";
DROP TYPE IF EXISTS "LoanStatus";
DROP TYPE IF EXISTS "AutomationTrigger";
DROP TYPE IF EXISTS "AutomationActionType";

-- Permissions for the removed modules. The catalog is re-seeded on boot, so
-- only the stale grants and rows need clearing.
DELETE FROM "role_permissions" rp
USING "permissions" p
WHERE rp."permissionId" = p."id"
  AND p."key" IN ('shift:manage', 'timesheet:manage', 'performance:manage',
                  'hrguide:manage', 'expense:manage', 'asset:manage', 'loan:manage');
DELETE FROM "permissions"
WHERE "key" IN ('shift:manage', 'timesheet:manage', 'performance:manage',
                'hrguide:manage', 'expense:manage', 'asset:manage', 'loan:manage');

-- ---------------------------------------------------------------------------
-- 2. Enum changes.
-- ---------------------------------------------------------------------------
ALTER TYPE "PayrollRunStatus" RENAME VALUE 'PROCESSED' TO 'FINALIZED';

ALTER TYPE "CandidateStage" RENAME VALUE 'SCREENING' TO 'SHORTLISTED';
ALTER TYPE "CandidateStage" RENAME VALUE 'OFFER' TO 'SELECTED';
ALTER TYPE "CandidateStage" RENAME VALUE 'HIRED' TO 'JOINED';

ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'WAITING' BEFORE 'RESOLVED';
ALTER TYPE "JobPostingStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD' BEFORE 'CLOSED';

CREATE TYPE "CorrectionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "TicketType" AS ENUM ('HR_QUESTION', 'PRODUCT_PROBLEM');
CREATE TYPE "TicketQueue" AS ENUM ('HR', 'PAYROLL', 'PRODUCT');
CREATE TYPE "IntegrationDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'COMING_SOON');

-- ---------------------------------------------------------------------------
-- 3. Organization work schedule (Settings 7.1.2).
-- ---------------------------------------------------------------------------
ALTER TABLE "organizations"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN "workingDays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5],
  ADD COLUMN "workStartTime" TEXT NOT NULL DEFAULT '09:00',
  ADD COLUMN "workEndTime" TEXT NOT NULL DEFAULT '18:00',
  ADD COLUMN "fullDayHours" DOUBLE PRECISION NOT NULL DEFAULT 8;

-- ---------------------------------------------------------------------------
-- 4. Employee exit and HRMS access revocation (Employees 2.4).
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "disabledAt" TIMESTAMP(3);

ALTER TABLE "employees"
  ADD COLUMN "exitReason" TEXT,
  ADD COLUMN "exitRecordedAt" TIMESTAMP(3),
  ADD COLUMN "exitRecordedById" TEXT,
  ADD COLUMN "accessRevokedAt" TIMESTAMP(3);

-- Drop relations that pointed at the removed modules.
ALTER TABLE "employees" DROP COLUMN IF EXISTS "shiftAssignmentId";

-- ---------------------------------------------------------------------------
-- 5. Employee documents (Employees 2.2.2).
-- ---------------------------------------------------------------------------
CREATE TABLE "employee_documents" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "content" BYTEA NOT NULL,
  "uploadedById" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employee_documents_organizationId_employeeId_idx" ON "employee_documents" ("organizationId", "employeeId");
ALTER TABLE "employee_documents"
  ADD CONSTRAINT "employee_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_documents_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. Attendance corrections and holidays (Attendance 3.1.3, 3.3).
-- ---------------------------------------------------------------------------
CREATE TABLE "attendance_correction_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "requestedCheckInAt" TIMESTAMP(3),
  "requestedCheckOutAt" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "status" "CorrectionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "approverId" TEXT,
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "routingNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_correction_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_correction_requests_organizationId_status_idx" ON "attendance_correction_requests" ("organizationId", "status");
ALTER TABLE "attendance_correction_requests"
  ADD CONSTRAINT "attendance_correction_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_correction_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_correction_requests_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE "holidays" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "holidays_organizationId_date_key" ON "holidays" ("organizationId", "date");
ALTER TABLE "holidays"
  ADD CONSTRAINT "holidays_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 7. Leave and onboarding additions.
-- ---------------------------------------------------------------------------
ALTER TABLE "leave_types" ADD COLUMN "paid" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "leave_requests" ADD COLUMN "routingNote" TEXT;

ALTER TABLE "onboarding_tasks"
  ADD COLUMN "requiresVerification" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "verifiedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 8. HR policies (Settings 7.1.4).
-- ---------------------------------------------------------------------------
CREATE TABLE "hr_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "category" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_policies_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "hr_policies"
  ADD CONSTRAINT "hr_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "hr_policies_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_policies" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 9. Payroll: finalize, publish and controlled revisions (Payroll 4.2, 4.3).
-- ---------------------------------------------------------------------------
ALTER TABLE "payroll_runs" RENAME COLUMN "processedAt" TO "finalizedAt";
ALTER TABLE "payroll_runs" ADD COLUMN "finalizedById" TEXT;
ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payslips"
  ADD COLUMN "payableDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "paidDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "calculationInputs" JSONB,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revisionOfId" TEXT,
  ADD COLUMN "revisionNote" TEXT,
  ADD COLUMN "supersededAt" TIMESTAMP(3);

-- Payslips that already existed were visible to employees, so keep them so.
UPDATE "payslips" SET "publishedAt" = "createdAt" WHERE "publishedAt" IS NULL;

DROP INDEX IF EXISTS "payslips_payrollRunId_employeeId_key";
CREATE UNIQUE INDEX "payslips_payrollRunId_employeeId_revisionNumber_key"
  ON "payslips" ("payrollRunId", "employeeId", "revisionNumber");
ALTER TABLE "payslips"
  ADD CONSTRAINT "payslips_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "payslips" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 10. Helpdesk: type, queue, reference, replies, escalation (Helpdesk 06).
-- ---------------------------------------------------------------------------
ALTER TABLE "helpdesk_tickets"
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "type" "TicketType" NOT NULL DEFAULT 'HR_QUESTION',
  ADD COLUMN "queue" "TicketQueue" NOT NULL DEFAULT 'HR',
  ADD COLUMN "reopenRequestedAt" TIMESTAMP(3),
  ADD COLUMN "escalatedFromId" TEXT,
  ADD COLUMN "escalationSummary" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing tickets keep their text category as the opening line of a reference.
UPDATE "helpdesk_tickets"
SET "reference" = 'HR-' || UPPER(SUBSTRING(REPLACE("id", '-', '') FROM 1 FOR 8))
WHERE "reference" IS NULL;
ALTER TABLE "helpdesk_tickets" ALTER COLUMN "reference" SET NOT NULL;
ALTER TABLE "helpdesk_tickets" DROP COLUMN IF EXISTS "category";
ALTER TABLE "helpdesk_tickets" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE UNIQUE INDEX "helpdesk_tickets_organizationId_reference_key" ON "helpdesk_tickets" ("organizationId", "reference");
CREATE INDEX "helpdesk_tickets_organizationId_queue_status_idx" ON "helpdesk_tickets" ("organizationId", "queue", "status");
ALTER TABLE "helpdesk_tickets"
  ADD CONSTRAINT "helpdesk_tickets_escalatedFromId_fkey" FOREIGN KEY ("escalatedFromId") REFERENCES "helpdesk_tickets" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "helpdesk_replies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "internal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "helpdesk_replies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "helpdesk_replies_ticketId_idx" ON "helpdesk_replies" ("ticketId");
ALTER TABLE "helpdesk_replies"
  ADD CONSTRAINT "helpdesk_replies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "helpdesk_replies_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "helpdesk_tickets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "helpdesk_replies_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 11. Internal automation switches (Settings 7.5), replacing the rule builder.
-- ---------------------------------------------------------------------------
CREATE TABLE "automation_settings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "timingHours" INTEGER,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "automation_settings_organizationId_key_key" ON "automation_settings" ("organizationId", "key");
ALTER TABLE "automation_settings"
  ADD CONSTRAINT "automation_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "automation_settings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 12. Audit index (Settings 7.4).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "audit_logs_organizationId_createdAt_idx" ON "audit_logs" ("organizationId", "createdAt");

-- ---------------------------------------------------------------------------
-- 13. Hiring: one candidate, many applications (Hiring rule 02).
-- ---------------------------------------------------------------------------
ALTER TABLE "job_postings"
  ADD COLUMN "hiringOwnerId" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "workMode" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "job_postings"
  ADD CONSTRAINT "job_postings_hiringOwnerId_fkey" FOREIGN KEY ("hiringOwnerId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_postings" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "candidates"
  ADD COLUMN "normalizedEmail" TEXT,
  ADD COLUMN "normalizedPhone" TEXT,
  ADD COLUMN "resumeFileName" TEXT,
  ADD COLUMN "resumeMimeType" TEXT,
  ADD COLUMN "resumeContent" BYTEA;

UPDATE "candidates"
SET "normalizedEmail" = LOWER(TRIM("email")),
    "normalizedPhone" = NULLIF(REGEXP_REPLACE(COALESCE("phone", ''), '[^0-9]', '', 'g'), '');
ALTER TABLE "candidates" ALTER COLUMN "normalizedEmail" SET NOT NULL;

CREATE TABLE "job_applications" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "jobPostingId" TEXT NOT NULL,
  "hiringOwnerId" TEXT,
  "stage" "CandidateStage" NOT NULL DEFAULT 'APPLIED',
  "notes" TEXT,
  "hiredEmployeeId" TEXT,
  "joinedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- Every existing candidate row was really one application; carry it over.
INSERT INTO "job_applications"
  ("id", "organizationId", "candidateId", "jobPostingId", "stage", "notes",
   "hiredEmployeeId", "joinedAt", "createdAt", "updatedAt")
SELECT c."id", c."organizationId", c."id", c."jobPostingId", c."stage", c."notes",
       c."hiredEmployeeId",
       CASE WHEN c."hiredEmployeeId" IS NOT NULL THEN c."updatedAt" END,
       c."createdAt", c."updatedAt"
FROM "candidates" c;

-- Merge person rows that share an email, keeping the earliest.
CREATE TEMP TABLE "candidate_merge" AS
SELECT c."id" AS dup_id, k.keep_id
FROM "candidates" c
JOIN (
  SELECT "organizationId", "normalizedEmail",
         (ARRAY_AGG("id" ORDER BY "createdAt", "id"))[1] AS keep_id
  FROM "candidates"
  GROUP BY "organizationId", "normalizedEmail"
) k ON k."organizationId" = c."organizationId" AND k."normalizedEmail" = c."normalizedEmail"
WHERE c."id" <> k.keep_id;

-- Drop applications that would collide with the kept person's own application
-- for the same job, then repoint the rest.
DELETE FROM "job_applications" ja
USING "candidate_merge" m
WHERE ja."candidateId" = m.dup_id
  AND EXISTS (
    SELECT 1 FROM "job_applications" k
    WHERE k."candidateId" = m.keep_id AND k."jobPostingId" = ja."jobPostingId"
  );
UPDATE "job_applications" ja SET "candidateId" = m.keep_id
FROM "candidate_merge" m WHERE ja."candidateId" = m.dup_id;
DELETE FROM "candidates" c USING "candidate_merge" m WHERE c."id" = m.dup_id;
DROP TABLE "candidate_merge";

CREATE UNIQUE INDEX "job_applications_candidateId_jobPostingId_key" ON "job_applications" ("candidateId", "jobPostingId");
CREATE UNIQUE INDEX "job_applications_hiredEmployeeId_key" ON "job_applications" ("hiredEmployeeId");
ALTER TABLE "job_applications"
  ADD CONSTRAINT "job_applications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "job_applications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "job_applications_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "job_postings" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "job_applications_hiringOwnerId_fkey" FOREIGN KEY ("hiringOwnerId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "job_applications_hiredEmployeeId_fkey" FOREIGN KEY ("hiredEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_applications" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Interviews now hang off the application.
ALTER TABLE "interviews"
  ADD COLUMN "applicationId" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "meetingLink" TEXT,
  ADD COLUMN "decision" TEXT;
UPDATE "interviews" i SET "applicationId" = i."candidateId";
DELETE FROM "interviews" WHERE "applicationId" NOT IN (SELECT "id" FROM "job_applications");
ALTER TABLE "interviews" ALTER COLUMN "applicationId" SET NOT NULL;
ALTER TABLE "interviews" DROP CONSTRAINT IF EXISTS "interviews_candidateId_fkey";
ALTER TABLE "interviews" DROP COLUMN "candidateId";
ALTER TABLE "interviews" DROP COLUMN IF EXISTS "rating";
ALTER TABLE "interviews"
  ADD CONSTRAINT "interviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "job_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "interviews_organizationId_scheduledAt_idx" ON "interviews" ("organizationId", "scheduledAt");

-- The person row no longer carries job, stage or hire.
ALTER TABLE "candidates" DROP CONSTRAINT IF EXISTS "candidates_jobPostingId_fkey";
ALTER TABLE "candidates" DROP CONSTRAINT IF EXISTS "candidates_hiredEmployeeId_fkey";
DROP INDEX IF EXISTS "candidates_hiredEmployeeId_key";
ALTER TABLE "candidates"
  DROP COLUMN "jobPostingId",
  DROP COLUMN "stage",
  DROP COLUMN "hiredEmployeeId";
CREATE UNIQUE INDEX "candidates_organizationId_normalizedEmail_key" ON "candidates" ("organizationId", "normalizedEmail");
CREATE INDEX "candidates_organizationId_normalizedPhone_idx" ON "candidates" ("organizationId", "normalizedPhone");

-- ---------------------------------------------------------------------------
-- 14. Settings 7.6 - Integrations powered by WorkEasy Connect.
-- ---------------------------------------------------------------------------
CREATE TABLE "integration_connections" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "direction" "IntegrationDirection" NOT NULL,
  "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'DRAFT',
  "connectUrl" TEXT,
  "connectRef" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_connections_organizationId_name_key" ON "integration_connections" ("organizationId", "name");
ALTER TABLE "integration_connections"
  ADD CONSTRAINT "integration_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_connections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_connections" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE "integration_mappings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "direction" "IntegrationDirection" NOT NULL,
  "eventKey" TEXT,
  "actionKey" TEXT,
  "destination" TEXT,
  "fieldMap" JSONB NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_mappings_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "integration_mappings"
  ADD CONSTRAINT "integration_mappings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_mappings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_mappings" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE "integration_transfers" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "mappingId" TEXT,
  "direction" "IntegrationDirection" NOT NULL,
  "reference" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "message" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_transfers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_transfers_organizationId_connectionId_reference_key"
  ON "integration_transfers" ("organizationId", "connectionId", "reference");
CREATE INDEX "integration_transfers_organizationId_occurredAt_idx" ON "integration_transfers" ("organizationId", "occurredAt");
ALTER TABLE "integration_transfers"
  ADD CONSTRAINT "integration_transfers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_transfers_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_transfers_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "integration_mappings" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
