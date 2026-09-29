"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Organization } from "@/lib/types";
import { Button, Card, ErrorBanner, PageHeader, Skeleton } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";

export default function OrganizationSettingsPage() {
  const { hasPermission } = useAuth();
  const { toast } = useFeedback();
  const [org, setOrg] = useState<Organization | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = hasPermission("org:manage");

  useEffect(() => {
    apiFetch<Organization>("/organizations/current")
      .then((data) => {
        setOrg(data);
        setName(data.name);
      })
      .catch((err) => setLoadError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await apiFetch<Organization>("/organizations/current", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setOrg(updated);
      toast.success("Organization name updated");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <PageHeader
        title="Organization"
        description={
          canManage
            ? "Manage how your organization appears across WorkEasy."
            : "Your organization's details. Only administrators can make changes."
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {loading ? (
        <Card className="space-y-4 p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </Card>
      ) : (
        <Card className="p-4">
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4">
            <div>
              <label htmlFor="org-slug" className="label">
                Organization slug
              </label>
              <input id="org-slug" disabled value={org?.slug ?? ""} className="input" aria-describedby="org-slug-hint" />
              <p id="org-slug-hint" className="mt-1 text-xs text-slate-500">
                Used when signing in. The slug can&apos;t be changed.
              </p>
            </div>
            <div>
              <label htmlFor="org-name" className="label">
                Organization name
              </label>
              <input
                id="org-name"
                required
                disabled={!canManage}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            {canManage && (
              <div>
                <Button type="submit" loading={saving}>
                  Save changes
                </Button>
              </div>
            )}
          </form>
        </Card>
      )}
    </div>
  );
}
