"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { AuditLog, AutomationRule } from "@/lib/types";
import { Card, CardBody, CardHeader, EmptyState, ErrorBanner, LoadingRows } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDateTime } from "@/components/format";

/**
 * Settings 7.5 — Internal automation. A fixed set of switches and timing
 * options for rules that implement existing HR workflows. Deliberately not a
 * trigger/condition builder: nothing here can finalize payroll or turn a ticket
 * resolution into an approval.
 */
export function AutomationSection() {
  const { toast } = useFeedback();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [activity, setActivity] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, a] = await Promise.all([
        apiFetch<AutomationRule[]>("/automation"),
        apiFetch<AuditLog[]>("/automation/activity").catch(() => []),
      ]);
      setRules(r);
      setActivity(a);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function update(rule: AutomationRule, patch: { enabled?: boolean; timingHours?: number }) {
    setBusyKey(rule.key);
    try {
      await apiFetch(`/automation/${rule.key}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <LoadingRows rows={5} />;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <Card>
        <CardHeader title="Essential rules" />
        <CardBody className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.key} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-heading">{rule.label}</p>
                <p className="mt-0.5 text-sm text-secondary">{rule.description}</p>
              </div>
              <div className="flex items-center gap-3">
                {rule.timingOptions && (
                  <div>
                    <label htmlFor={`timing-${rule.key}`} className="sr-only">
                      Timing for {rule.label}
                    </label>
                    <select
                      id={`timing-${rule.key}`}
                      value={rule.timingHours ?? ""}
                      disabled={!rule.enabled || busyKey === rule.key}
                      onChange={(e) => update(rule, { timingHours: Number(e.target.value) })}
                      className="c-select"
                    >
                      {rule.timingOptions.map((h) => (
                        <option key={h} value={h}>
                          {h < 24 ? `${h} hour${h === 1 ? "" : "s"}` : `${h / 24} day${h === 24 ? "" : "s"}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="c-checkbox"
                    checked={rule.enabled}
                    disabled={busyKey === rule.key}
                    onChange={(e) => update(rule, { enabled: e.target.checked })}
                  />
                  {rule.enabled ? "On" : "Off"}
                </label>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Activity" />
        {activity.length === 0 ? (
          <EmptyState icon={Zap} title="No changes yet" description="Switch changes are recorded in the shared audit history." />
        ) : (
          <CardBody>
            <ul className="divide-y divide-line text-sm">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-body">{a.actor?.email ?? "System"} changed an automation rule</span>
                  <span className="whitespace-nowrap text-xs text-secondary">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        )}
      </Card>

      <p className="text-xs text-secondary">
        A failed reminder never undoes a successful HR transaction, and repeating an event never duplicates a task, a balance
        change or a notification.
      </p>
    </div>
  );
}
