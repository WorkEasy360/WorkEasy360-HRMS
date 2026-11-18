import type { PrismaClient } from "@prisma/client";
import { UUID } from "./uuid";

/** Why an operator command could not do what was asked. The message is for the operator. */
export class OperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorError";
  }
}

type Db = Pick<PrismaClient, "organization" | "authSession" | "refreshToken" | "externalIdentity" | "user" | "auditLog" | "$transaction">;

/** Who asked for an operator change and why: written into its audit record. */
export interface OperatorAudit {
  actor?: string;
  reason?: string;
}

function auditTrail(audit: OperatorAudit | undefined) {
  return { via: "operator", actor: audit?.actor?.trim() || null, reason: audit?.reason?.trim() || null };
}

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
 * account is then linked to their WorkEasy360 identity with `linkUser` (or, only with
 * WORKEASY360_LINK_BY_VERIFIED_EMAIL=true, at their first sign-in); nothing else changes, and
 * password sign-in keeps working. Audited (`organization.workeasy360_bound`).
 */
export async function linkOrganization(db: Db, companyReference: string, workeasy360OrganizationId: string, audit?: OperatorAudit) {
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
  await db.$transaction([
    db.organization.update({ where: { id: company.id }, data: { workeasy360OrganizationId: target } }),
    db.auditLog.create({
      data: {
        organizationId: company.id,
        action: "organization.workeasy360_bound",
        entityType: "Organization",
        entityId: company.id,
        after: { workeasy360OrganizationId: target, ...auditTrail(audit) },
      },
    }),
  ]);
  return { company: { ...company, workeasy360OrganizationId: target }, changed: true };
}

/**
 * Removes a company's WorkEasy360 binding. Its WorkEasy360 sessions end at once (they are served
 * only while the company is bound to the organization they signed in for) and its links to
 * WorkEasy360 identities are removed, so a later binding starts clean. Password sign-in is
 * unaffected; accounts that have no password can no longer sign in until it is bound again.
 */
export async function unlinkOrganization(db: Db, companyReference: string, audit?: OperatorAudit) {
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
    db.auditLog.create({
      data: {
        organizationId: company.id,
        action: "organization.workeasy360_unbound",
        entityType: "Organization",
        entityId: company.id,
        before: { workeasy360OrganizationId: company.workeasy360OrganizationId },
        after: auditTrail(audit),
      },
    }),
  ]);
  return { company: { ...company, workeasy360OrganizationId: null }, changed: true, sessionsEnded: ended.count, identitiesRemoved: removed.count };
}

export interface LinkUserRequest {
  /** The account's address in the company. */
  email: string;
  /** The person's WorkEasy360 `sub`, as WorkEasy360 Accounts shows it. */
  subject: string;
  /** The WorkEasy360 organization; the account must belong to the company bound to it. */
  workeasy360OrganizationId: string;
  /** The issuer the link is for (WORKEASY360_ISSUER). */
  issuer: string;
  /** Who vouches for this link, and why (both required, both audited). */
  actor: string;
  reason: string;
}

/**
 * An operator-vouched link: binds one existing HRMS account to a WorkEasy360 identity
 * `(issuer, sub)` in the company bound to the stated WorkEasy360 organization, so that person's
 * WorkEasy360 sign-ins land in that account. This is how existing people are linked: a sign-in
 * whose address matches an unlinked account is refused (`account_conflict`) unless
 * WORKEASY360_LINK_BY_VERIFIED_EMAIL=true.
 *
 * Refused when the account is already linked (to another identity, or under another issuer) or
 * the identity is already linked to another account of the company. Running it again with the
 * same link changes nothing. The identity and its audit record (`user.workeasy360_linked`,
 * via "operator", with actor and reason) are written in one transaction. The password is left
 * as it is: WORKEASY360_SSO_ONLY=true is what switches password sign-in off.
 */
export async function linkUser(db: Db, request: LinkUserRequest) {
  const email = request.email.trim().toLowerCase();
  const subject = request.subject.trim();
  const issuer = request.issuer.trim();
  const actor = request.actor.trim();
  const reason = request.reason.trim();
  if (!email) throw new OperatorError("--email is required.");
  if (!subject) throw new OperatorError("--subject is required.");
  if (!issuer) throw new OperatorError("The issuer is unknown: set WORKEASY360_ISSUER or pass --issuer.");
  if (issuer.endsWith("/")) throw new OperatorError("Issuers are compared exactly: drop the trailing slash.");
  if (!actor) throw new OperatorError("--actor is required: who vouches for this link.");
  if (!reason) throw new OperatorError("--reason is required: why this account is this person.");
  if (!UUID.test(request.workeasy360OrganizationId)) throw new OperatorError("The WorkEasy360 organization id must be a UUID.");
  const organization = request.workeasy360OrganizationId.toLowerCase();

  const company = await db.organization.findUnique({
    where: { workeasy360OrganizationId: organization },
    select: { id: true, name: true, slug: true },
  });
  if (!company) {
    throw new OperatorError(`No HRMS company is bound to WorkEasy360 organization ${organization}. Bind it first with link-organization.`);
  }
  const user = await db.user.findUnique({
    where: { organizationId_email: { organizationId: company.id, email } },
    select: { id: true, email: true, externalIdentities: { select: { issuer: true, subject: true } } },
  });
  if (!user) throw new OperatorError(`${company.name} (${company.slug}) has no account with the address ${email}.`);

  const existing = user.externalIdentities;
  if (existing.length === 1 && existing[0].issuer === issuer && existing[0].subject === subject) {
    return { company, user: { id: user.id, email: user.email }, issuer, subject, changed: false };
  }
  if (existing.length > 0) {
    const links = existing.map((link) => `${link.subject} at ${link.issuer}`).join(", ");
    throw new OperatorError(`${email} in ${company.slug} is already linked (${links}). Nothing was changed.`);
  }
  const holder = await db.externalIdentity.findUnique({
    where: { issuer_subject_organizationId: { issuer, subject, organizationId: company.id } },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (holder) {
    throw new OperatorError(
      `WorkEasy360 identity ${subject} is already linked to ${holder.user.email} (${holder.userId}) in ${company.slug}. Nothing was changed.`,
    );
  }

  await db.$transaction([
    db.externalIdentity.create({ data: { organizationId: company.id, userId: user.id, issuer, subject, email } }),
    db.auditLog.create({
      data: {
        organizationId: company.id,
        action: "user.workeasy360_linked",
        entityType: "User",
        entityId: user.id,
        after: { issuer, subject, email, workeasy360OrganizationId: organization, via: "operator", actor, reason },
      },
    }),
  ]);
  return { company, user: { id: user.id, email: user.email }, issuer, subject, changed: true };
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
