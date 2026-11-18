import "dotenv/config";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { prisma } from "../config/prisma";
import { describe, workeasy360Client } from "../workeasy360/client";
import { linkOrganization, moveIssuer, OperatorError, organizationStatus, unlinkOrganization } from "../workeasy360/operator";
import { configurationProblems, workeasy360 } from "../workeasy360/settings";

/**
 * Operator commands for WorkEasy360 sign-in (docs/workeasy360-sso.md):
 *
 *   keygen --out <private-key.pem>          a new RSA key pair; prints the PUBLIC key for Super Admin
 *   check [--organization <uuid>]           discovery, the client key, and (optionally) one entitlement question
 *   status                                  every company and the WorkEasy360 organization it is bound to
 *   link-organization --company <slug|id> --organization <uuid>
 *   unlink-organization --company <slug|id>
 *   move-issuer --from <old issuer> [--to <new issuer>] [--apply]   (default --to: WORKEASY360_ISSUER)
 *
 * Development: npm run workeasy360 -- <command> ...   Production image: node dist/scripts/workeasy360.js <command> ...
 */

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new OperatorError(`--${name} is required.`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "keygen": {
      const out = required(args, "out");
      if (existsSync(out)) throw new OperatorError(`${out} exists; refusing to overwrite a key.`);
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
      writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
      console.log(`Private key written to ${out} (keep it in the secret manager; never commit it).`);
      console.log("Public key - add it as a credential in Super Admin (Products -> Integration -> Credentials):\n");
      console.log(publicKey.export({ type: "spki", format: "pem" }).toString());
      return;
    }
    case "check": {
      const problems = configurationProblems();
      if (!workeasy360.configured) problems.unshift("WorkEasy360 sign-in is not configured.");
      if (problems.length) throw new OperatorError(problems.join("\n"));
      const client = workeasy360Client();
      const found = await client.selfTest();
      console.log(`issuer               ${found.issuer} (exact match)`);
      console.log(`client               ${workeasy360.clientId}, key ${workeasy360.keyId} (${found.keyAlg})`);
      console.log(`product code         ${workeasy360.productCode}`);
      console.log(`redirect URI         ${workeasy360.redirectUri}`);
      console.log(`back-channel URI     ${new URL("/api/auth/workeasy360/backchannel-logout", workeasy360.redirectUri).href}`);
      console.log(`post-logout URI      ${workeasy360.postLogoutRedirectUri || "(none: WorkEasy360 sign-out is not offered)"}`);
      console.log(`token endpoint       ${found.tokenEndpoint}`);
      console.log(`entitlement endpoint ${found.entitlementEndpoint || "(not advertised)"}`);
      console.log(`end session          ${found.endSession || "(not advertised)"}`);
      console.log(`password sign-in     ${workeasy360.ssoOnly ? "off (WORKEASY360_SSO_ONLY=true)" : "on"}`);
      const organization = option(args, "organization");
      if (organization) {
        // Proves the credential against the live provider: a refused client is a 401 here.
        const answer = await client.verifyEntitlement(organization);
        console.log(`entitlement          ${answer.decision} (${answer.reason}), write ${answer.writeAllowed}, revalidate ${answer.revalidateAfter}s`);
      }
      return;
    }
    case "status": {
      for (const row of await organizationStatus(prisma)) {
        console.log(
          `${row.slug.padEnd(24)} ${row.id}  ${row.workeasy360OrganizationId ?? "(not bound)"}  ${row._count.externalIdentities} linked`,
        );
      }
      return;
    }
    case "link-organization": {
      const result = await linkOrganization(prisma, required(args, "company"), required(args, "organization"));
      console.log(
        result.changed
          ? `${result.company.name} (${result.company.slug}) is now bound to WorkEasy360 organization ${result.company.workeasy360OrganizationId}.`
          : `${result.company.name} was already bound to ${result.company.workeasy360OrganizationId}; nothing changed.`,
      );
      return;
    }
    case "unlink-organization": {
      const result = await unlinkOrganization(prisma, required(args, "company"));
      console.log(
        result.changed
          ? `${result.company.name} is no longer bound; ${result.sessionsEnded} WorkEasy360 sessions ended, ${result.identitiesRemoved} links removed.`
          : `${result.company.name} was not bound; nothing changed.`,
      );
      return;
    }
    case "move-issuer": {
      const to = option(args, "to") ?? workeasy360.issuer;
      const result = await moveIssuer(prisma, required(args, "from"), to, args.includes("--apply"));
      console.log(
        `${result.applied ? "Moved" : "Would move (dry run; add --apply)"}: ${result.identities} identity links and ${result.sessions} open sessions to ${to}.`,
      );
      return;
    }
    default:
      console.log("Commands: keygen, check, status, link-organization, unlink-organization, move-issuer (see docs/workeasy360-sso.md)");
      process.exitCode = command ? 2 : 0;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof OperatorError ? error.message : `Failed: ${describe(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
