-- WorkEasy360 Accounts sign-in (docs/workeasy360-sso.md): companies bound to a WorkEasy360
-- organization, linked identities, recorded sessions checked on every request, pending
-- sign-in flows, accepted back-channel logout tokens and the last entitlement answers.
-- Additive only: existing password accounts and sessions keep working.

-- CreateEnum
CREATE TYPE "SignInMethod" AS ENUM ('PASSWORD', 'WORKEASY360');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "workeasy360OrganizationId" TEXT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "external_identities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "method" "SignInMethod" NOT NULL,
    "issuer" TEXT,
    "subject" TEXT,
    "providerSid" TEXT,
    "workeasy360OrganizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workeasy360_flows" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "organization" TEXT NOT NULL DEFAULT '',
    "next" TEXT NOT NULL DEFAULT '/dashboard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workeasy360_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workeasy360_logout_tokens" (
    "issuer" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workeasy360_logout_tokens_pkey" PRIMARY KEY ("issuer","jti")
);

-- CreateTable
CREATE TABLE "workeasy360_entitlements" (
    "key" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "writeAllowed" BOOLEAN NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL,
    "trustSeconds" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workeasy360_entitlements_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "external_identities_userId_idx" ON "external_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_issuer_subject_organizationId_key" ON "external_identities"("issuer", "subject", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_issuer_userId_key" ON "external_identities"("issuer", "userId");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- CreateIndex
CREATE INDEX "auth_sessions_issuer_subject_idx" ON "auth_sessions"("issuer", "subject");

-- CreateIndex
CREATE INDEX "auth_sessions_issuer_providerSid_idx" ON "auth_sessions"("issuer", "providerSid");

-- CreateIndex
CREATE INDEX "workeasy360_flows_expiresAt_idx" ON "workeasy360_flows"("expiresAt");

-- CreateIndex
CREATE INDEX "workeasy360_logout_tokens_expiresAt_idx" ON "workeasy360_logout_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_workeasy360OrganizationId_key" ON "organizations"("workeasy360OrganizationId");

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sessions that are live now (password sign-ins before this release) become recorded
-- sessions, so their next access token is checked and can be ended like any other.
INSERT INTO "auth_sessions" ("id", "userId", "organizationId", "method", "createdAt")
SELECT DISTINCT ON (rt."familyId") rt."familyId", rt."userId", u."organizationId", 'PASSWORD', rt."createdAt"
  FROM "refresh_tokens" rt
  JOIN "users" u ON u."id" = rt."userId"
 WHERE rt."revokedAt" IS NULL AND rt."expiresAt" > CURRENT_TIMESTAMP
 ORDER BY rt."familyId", rt."createdAt"
ON CONFLICT ("id") DO NOTHING;
