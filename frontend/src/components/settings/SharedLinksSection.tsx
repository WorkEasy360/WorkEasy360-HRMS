"use client";

import { ExternalLink } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/ui";

/**
 * Settings 7.3 — Shared WorkEasy360 links.
 *
 * Authentication, subscriptions, billing and balances are centralized platform
 * services. HRMS links out to them rather than duplicating a screen, so there
 * is no HRMS wallet, no HRMS recharge history and no second billing page.
 */

const APP_URL = process.env.NEXT_PUBLIC_WORKEASY_APP_URL ?? "https://app.workeasy360.com";
const STORE_URL = process.env.NEXT_PUBLIC_WORKEASY_STORE_URL ?? "https://store.workeasy360.com";

const LINKS: { title: string; description: string; href: string }[] = [
  {
    title: "Current plan and billing",
    description: "Your HRMS plan, renewal and invoices are managed in your shared WorkEasy360 subscription.",
    href: `${APP_URL}/subscriptions`,
  },
  {
    title: "Wallets and credits",
    description:
      "One organization, three balances: the Platform Wallet for plans and renewals, AI Credits for assistant usage, and the Consumption Wallet for configured messaging and external API or webhook events.",
    href: `${APP_URL}/wallets`,
  },
  {
    title: "Members and product access",
    description: "Membership and which products each member can open are managed centrally, then checked here.",
    href: `${APP_URL}/members`,
  },
  {
    title: "Buy or change a plan",
    description: "Plan selection and checkout happen in the store, and activation is verified before access changes.",
    href: STORE_URL,
  },
];

export function SharedLinksSection() {
  return (
    <div className="space-y-6">
      <p className="c-alert" data-tone="info">
        These are shared WorkEasy360 services. HRMS reads them; it does not keep its own copy, and nothing here charges a
        separate HRMS balance.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {LINKS.map((link) => (
          <Card key={link.title}>
            <CardHeader title={link.title} />
            <CardBody className="space-y-3">
              <p className="text-sm text-secondary">{link.description}</p>
              <a href={link.href} target="_blank" rel="noreferrer" className="c-link inline-flex items-center gap-1 text-sm">
                Open <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="What never uses a wallet" />
        <CardBody>
          <ul className="space-y-1 text-sm text-secondary">
            <li>Payroll money never moves through the Platform Wallet, AI Credits or the Consumption Wallet.</li>
            <li>Signing in, checking in, help desk actions and ordinary internal API calls are not billable events.</li>
            <li>Low AI credits never block manual HR work or help desk entry.</li>
            <li>An employee record is not automatically a billed seat — seats are counted from enabled logins.</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
