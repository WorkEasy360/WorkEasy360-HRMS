"use client";

import { Suspense } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { LoadingRows, PageHeader } from "@/ui";
import { AccountSection } from "@/components/settings/AccountSection";
import { AuditSection } from "@/components/settings/AuditSection";
import { AutomationSection } from "@/components/settings/AutomationSection";
import { CompanySection } from "@/components/settings/CompanySection";
import { IntegrationsSection } from "@/components/settings/IntegrationsSection";
import { RolesSection } from "@/components/settings/RolesSection";
import { SharedLinksSection } from "@/components/settings/SharedLinksSection";

/**
 * Settings (07). One menu with tabs, rather than several menus: company and HR
 * rules, roles and access, the shared WorkEasy360 links, audit history,
 * internal automation and integrations.
 */

type Tab = "company" | "roles" | "shared" | "audit" | "automation" | "integrations" | "account";

const TABS: { key: Tab; label: string; permission?: string }[] = [
  { key: "company", label: "Company & HR rules", permission: "org:manage" },
  { key: "roles", label: "Roles & access", permission: "role:manage" },
  { key: "shared", label: "Plan, billing & wallets" },
  { key: "audit", label: "Audit history", permission: "audit:read" },
  { key: "automation", label: "Internal automation", permission: "automation:manage" },
  { key: "integrations", label: "Integrations", permission: "integration:manage" },
  { key: "account", label: "My account & security" },
];

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingRows rows={5} />}>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const { hasPermission } = useAuth();
  const params = useSearchParams();
  const router = useRouter();

  // Everyone can reach Settings for their own account; the rest is permission-gated.
  const visible = TABS.filter((t) => !t.permission || hasPermission(t.permission));
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = visible.some((t) => t.key === requested) ? (requested as Tab) : visible[0].key;

  return (
    <div className="space-y-6">
      <PageHeader icon={SettingsIcon} title="Settings" description="Company rules, access, automation and the shared WorkEasy360 services." />

      <div className="c-tabs" role="tablist" aria-label="Settings">
        {visible.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => router.replace(`/settings?tab=${t.key}`, { scroll: false })}
            className="c-tab"
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "company" && <CompanySection />}
      {tab === "roles" && <RolesSection />}
      {tab === "shared" && <SharedLinksSection />}
      {tab === "audit" && <AuditSection />}
      {tab === "automation" && <AutomationSection />}
      {tab === "integrations" && <IntegrationsSection />}
      {tab === "account" && <AccountSection />}
    </div>
  );
}
