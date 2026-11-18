import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { writeAuditLog } from "../utils/audit";
import { enforceDueExit } from "../utils/employeeExit";
import { createOrganizationWithAdmin } from "../utils/organizationSetup";
import type { VerifiedIdToken } from "./client";
import { SsoRefusal } from "./errors";
import { workeasy360 } from "./settings";
import { UUID } from "./uuid";


export interface SignedIn {
  userId: string;
  organizationId: string;
  /** This sign-in created the company (and its first person is its Admin). */
  organizationCreated: boolean;
  /** This sign-in linked an existing HRMS account to the WorkEasy360 identity. */
  linked: boolean;
}

/**
 * Maps verified WorkEasy360 claims onto an HRMS company and user.
 *
 * - The company is the one bound to the token's `organization_id`
 *   (`organizations.workeasy360OrganizationId`). None bound: the first sign-in creates it, with
 *   this person as its Admin (unless WORKEASY360_CREATE_ORGANIZATIONS=false; an operator binds an
 *   existing company with `workeasy360 link-organization`). A sign-in never lands in a company
 *   bound to another organization, so it can never cross organizations.
 * - The person is found by `(issuer, sub)` inside that company. Nobody is created: employees and
 *   their HR roles come from HRMS's own records, so someone HR has not added is `not_enrolled`.
 * - An existing account with the same address is **not** merged by default: the sign-in is
 *   refused with `account_conflict` and the person is told to ask their administrator, who links
 *   the account with the audited operator command `workeasy360 link-user` (an operator-vouched
 *   link). Only with WORKEASY360_LINK_BY_VERIFIED_EMAIL=true does a first sign-in link it itself,
 *   and then only an account of this bound company (never another company's), with
 *   `email_verified` true, that has no WorkEasy360 link under any issuer; every such link is
 *   audited (`user.workeasy360_linked`, via "automatic").
 * - Linking never touches the password: password sign-in keeps working until
 *   WORKEASY360_SSO_ONLY=true switches it off (docs/workeasy360-sso.md).
 * - Roles and permissions are the account's own HRMS roles; nothing is authorized on `sub`.
 */
export async function provisionSignIn(claims: VerifiedIdToken, issuer: string): Promise<SignedIn> {
  const binding = claims.organization_id.toLowerCase();
  if (!UUID.test(binding)) throw new SsoRefusal("organization_missing", "organization_id is not a UUID");
  try {
    return await provisionOnce(claims, issuer, binding);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Two sign-ins racing (one person in two tabs, two people of a new organization): the
    // winner created the rows. Look once more; a second collision is a real conflict.
    try {
      return await provisionOnce(claims, issuer, binding);
    } catch (again) {
      if (isUniqueViolation(again)) throw new SsoRefusal("account_conflict", "a concurrent sign-in linked a different account");
      throw again;
    }
  }
}

async function provisionOnce(claims: VerifiedIdToken, issuer: string, binding: string): Promise<SignedIn> {
  const organization = await prisma.organization.findUnique({
    where: { workeasy360OrganizationId: binding },
    select: { id: true },
  });
  if (!organization) {
    if (!workeasy360.createOrganizations) {
      throw new SsoRefusal("organization_not_linked", `no company is bound to WorkEasy360 organization ${binding}`);
    }
    return createOrganization(claims, issuer, binding);
  }
  return signInToOrganization(organization.id, claims, issuer);
}

async function createOrganization(claims: VerifiedIdToken, issuer: string, binding: string): Promise<SignedIn> {
  const email = claims.email.trim().toLowerCase();
  const name = (claims.organization_name ?? "").trim().slice(0, 120) || "My company";
  const person = personName(claims, email);
  const slug = await uniqueSlug(name);
  const created = await prisma.$transaction((tx) =>
    createOrganizationWithAdmin(tx, {
      organizationName: name.length >= 2 ? name : "My company",
      organizationSlug: slug,
      workeasy360OrganizationId: binding,
      firstName: person.firstName,
      lastName: person.lastName,
      email,
      // No password: the first admin is reached through WorkEasy360 only.
      passwordHash: null,
      externalIdentity: { issuer, subject: claims.sub },
    }),
  );
  await writeAuditLog({
    organizationId: created.organization.id,
    actorUserId: created.user.id,
    action: "organization.provisioned_from_workeasy360",
    entityType: "Organization",
    entityId: created.organization.id,
    after: { workeasy360OrganizationId: binding },
  });
  return { userId: created.user.id, organizationId: created.organization.id, organizationCreated: true, linked: false };
}

async function signInToOrganization(organizationId: string, claims: VerifiedIdToken, issuer: string): Promise<SignedIn> {
  const subject = claims.sub;
  const email = claims.email.trim().toLowerCase();

  // 1. A known WorkEasy360 identity in this company: the same person, whatever their address is now.
  const identity = await prisma.externalIdentity.findUnique({
    where: { issuer_subject_organizationId: { issuer, subject, organizationId } },
    select: { id: true, userId: true },
  });
  if (identity) {
    await assertActive(identity.userId);
    await prisma.externalIdentity.update({ where: { id: identity.id }, data: { lastLoginAt: new Date(), email } });
    return { userId: identity.userId, organizationId, organizationCreated: false, linked: false };
  }

  // 2. First WorkEasy360 sign-in of this person here. The lookup is scoped to the company bound to
  //    the token's organization, so another company's account with this address is never seen.
  const user = await prisma.user.findUnique({
    where: { organizationId_email: { organizationId, email } },
    select: { id: true, _count: { select: { externalIdentities: true } } },
  });
  if (!user) {
    throw new SsoRefusal("not_enrolled", `company ${organizationId} has no account for this address`);
  }
  if (user._count.externalIdentities > 0) {
    // Linked already (to another WorkEasy360 account, or under another issuer before a
    // move-issuer): never re-linked by a sign-in.
    throw new SsoRefusal("account_conflict", `user ${user.id} is linked to another WorkEasy360 account`);
  }
  if (!workeasy360.linkByVerifiedEmail) {
    throw new SsoRefusal("account_conflict", `user ${user.id} has this address but is not linked; an operator links it with link-user`);
  }
  if ((claims as { email_verified?: unknown }).email_verified !== true) {
    throw new SsoRefusal("email_unverified", "an automatic link needs a verified address");
  }
  await assertActive(user.id);
  await prisma.$transaction([
    prisma.externalIdentity.create({
      data: { organizationId, userId: user.id, issuer, subject, email, lastLoginAt: new Date() },
    }),
    // In the same transaction: an automatic link without its audit record never happens.
    prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId: user.id,
        action: "user.workeasy360_linked",
        entityType: "User",
        entityId: user.id,
        after: { issuer, subject, email, workeasy360OrganizationId: claims.organization_id.toLowerCase(), via: "automatic" },
      },
    }),
  ]);
  return { userId: user.id, organizationId, organizationCreated: false, linked: true };
}

/** A recorded exit takes effect now if its date has come; a deactivated account is refused. */
async function assertActive(userId: string): Promise<void> {
  await enforceDueExit(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { disabledAt: true, employee: { select: { status: true } } },
  });
  if (!user || user.disabledAt || user.employee?.status === "EXITED") {
    throw new SsoRefusal("account_disabled", `user ${userId} is deactivated`);
  }
}

function personName(claims: VerifiedIdToken, email: string): { firstName: string; lastName: string } {
  const given = (claims.given_name ?? "").trim();
  const family = (claims.family_name ?? "").trim();
  if (given || family) return { firstName: (given || family).slice(0, 80), lastName: (given ? family : "").slice(0, 80) };
  const [first = "", ...rest] = (claims.name ?? "").trim().split(/\s+/);
  if (first) return { firstName: first.slice(0, 80), lastName: rest.join(" ").slice(0, 80) };
  return { firstName: (email.split("@")[0] || "Admin").slice(0, 80), lastName: "" };
}

/** A free organization ID (slug) derived from the name: lowercase letters, digits and hyphens. */
async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "company";
  const candidates = [base.length >= 2 ? base : `${base}-co`];
  for (let i = 0; i < 4; i++) candidates.push(`${base}-${randomBytes(3).toString("hex")}`.slice(0, 48));
  const taken = await prisma.organization.findMany({ where: { slug: { in: candidates } }, select: { slug: true } });
  const used = new Set(taken.map((row) => row.slug));
  const free = candidates.find((candidate) => !used.has(candidate));
  if (!free) throw new SsoRefusal("unavailable", "no free organization ID");
  return free;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
