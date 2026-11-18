import type { PrismaClient } from "@prisma/client";
import { UUID } from "./uuid";

/** Why an operator command could not do what was asked. The message is for the operator. */
export class OperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorError";
  }
}

type Db = Pick<PrismaClient, "organization" | "authSession" | "refreshToken" | "externalIdentity" | "$transaction">;

async function findCompany(db: Db, reference: string) {
  const company = await db.organization.findFirst({
    where: { OR: [{ id: reference }, { slug: reference.toLowerCase() }] },
    select: { id: true, name: true, slug: true, workeasy360OrganizationId: true },
  });
  if (!company) throw new OperatorError(`No HRMS company with id or organization ID "${reference}".`);
  return company;
}

/**
 * Binds an existing HRMS company to a WorkEasy360 organization, so WorkEasy360 sign-ins for
 * that organization land in it instead of creating a new, empty company. Each employee's
 * account is linked to their WorkEasy360 identity at their own first WorkEasy360 sign-in (by the
 * verified address); nothing else changes, and password sign-in keeps working.
 */
export async function linkOrganization(db: Db, companyReference: string, workeasy360OrganizationId: string) {
  if (!UUID.test(workeasy360OrganizationId)) throw new OperatorError("The WorkEasy360 organization id must be a UUID.");
  const target = workeasy360OrganizationId.toLowerCase();
  const company = await findCompany(db, companyReference);
  if (company.workeasy360OrganizationId === target) return { company, changed: false };
  if (company.workeasy360OrganizationId) {
    throw new OperatorError(
      `${company.name} (${company.slug}) is already bound to WorkEasy360 organization ${company.workeasy360OrganizationId}. ` +
        "Unbind it first with unlink-organization if that is really intended.",
    );
  }
  const holder = await db.organization.findUnique({ where: { workeasy360OrganizationId: target }, select: { id: true, name: true, slug: true } });
  if (holder) {
    throw new OperatorError(
      `WorkEasy360 organization ${target} is already bound to ${holder.name} (${holder.slug}, ${holder.id}). ` +
        "If a first sign-in created that company and it is empty, unbind or delete it first.",
    );
  }
  await db.organization.update({ where: { id: company.id }, data: { workeasy360OrganizationId: target } });
  return { company: { ...company, workeasy360OrganizationId: target }, changed: true };
}

/**
 * Removes a company's WorkEasy360 binding. Its WorkEasy360 sessions end at once (they are served
 * only while the company is bound to the organization they signed in for) and its links to
 * WorkEasy360 identities are removed, so a later binding starts clean. Password sign-in is
 * unaffected; accounts that have no password can no longer sign in until it is bound again.
 */
export async function unlinkOrganization(db: Db, companyReference: string) {
  const company = await findCompany(db, companyReference);
  if (!company.workeasy360OrganizationId) return { company, changed: false, sessionsEnded: 0, identitiesRemoved: 0 };
  const now = new Date();
  const [, ended, , removed] = await db.$transaction([
    db.organization.update({ where: { id: company.id }, data: { workeasy360OrganizationId: null } }),
    db.authSession.updateMany({
      where: { organizationId: company.id, method: "WORKEASY360", endedAt: null },
      data: { endedAt: now, endedReason: "organization_unlinked" },
    }),
    db.refreshToken.updateMany({
      where: { revokedAt: null, user: { organizationId: company.id }, familyId: { in: await workeasy360Families(db, company.id) } },
      data: { revokedAt: now },
    }),
    db.externalIdentity.deleteMany({ where: { organizationId: company.id } }),
  ]);
  return { company: { ...company, workeasy360OrganizationId: null }, changed: true, sessionsEnded: ended.count, identitiesRemoved: removed.count };
}

async function workeasy360Families(db: Db, organizationId: string): Promise<string[]> {
  const rows = await db.authSession.findMany({ where: { organizationId, method: "WORKEASY360", endedAt: null }, select: { id: true } });
  return rows.map((row) => row.id);
}

export async function organizationStatus(db: Db) {
  return db.organization.findMany({
    select: { id: true, name: true, slug: true, workeasy360OrganizationId: true, _count: { select: { externalIdentities: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Moves the identity links (and the open sessions' issuer) from one issuer name to another, for
 * the release that changes WORKEASY360_ISSUER (onboarding contract item 4; ADR-067's move from
 * auth. to accounts.). People keep their accounts because `sub` does not change; only the issuer
 * half of `(issuer, sub)` does. Dry run unless `apply`.
 */
export async function moveIssuer(db: Db, from: string, to: string, apply: boolean) {
  if (!from || !to || from === to) throw new OperatorError("--from and --to must name two different issuers.");
  if (from.endsWith("/") || to.endsWith("/")) throw new OperatorError("Issuers are compared exactly: drop the trailing slash.");
  const [identities, sessions, clashes] = await Promise.all([
    db.externalIdentity.count({ where: { issuer: from } }),
    db.authSession.count({ where: { issuer: from, endedAt: null } }),
    db.externalIdentity.count({ where: { issuer: to } }),
  ]);
  if (clashes > 0) {
    throw new OperatorError(`${clashes} links already use ${to}; resolve them before moving (nothing was changed).`);
  }
  if (!apply) return { identities, sessions, applied: false };
  const [movedIdentities, movedSessions] = await db.$transaction([
    db.externalIdentity.updateMany({ where: { issuer: from }, data: { issuer: to } }),
    db.authSession.updateMany({ where: { issuer: from, endedAt: null }, data: { issuer: to } }),
  ]);
  return { identities: movedIdentities.count, sessions: movedSessions.count, applied: true };
}
