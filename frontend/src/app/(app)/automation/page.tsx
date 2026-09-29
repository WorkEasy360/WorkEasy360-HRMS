"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Plus, Workflow } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { AutomationRule } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";

const TRIGGER_LABELS: Record<AutomationRule["trigger"], string> = {
  LEAVE_APPROVED: "Leave approved",
  EMPLOYEE_ONBOARDED: "Employee onboarded",
  TIMESHEET_APPROVED: "Timesheet approved",
};

const ACTION_LABELS: Record<AutomationRule["actionType"], string> = {
  CREATE_ANNOUNCEMENT: "Create announcement",
  ASSIGN_ONBOARDING_TASK: "Assign onboarding task",
};

export default function AutomationPage() {
  const { toast, confirm } = useFeedback();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setRules(await apiFetch<AutomationRule[]>("/automation-rules"));
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, []);

  async function toggle(rule: AutomationRule) {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    try {
      await apiFetch(`/automation-rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) });
      toast.success(`"${rule.name}" ${rule.enabled ? "paused" : "enabled"}`);
    } catch (err) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      toast.error(errorMessage(err));
    }
  }

  async function remove(rule: AutomationRule) {
    const ok = await confirm({
      title: `Delete "${rule.name}"?`,
      description: "This rule will stop running immediately. This cannot be undone.",
      confirmLabel: "Delete rule",
      destructive: true,
    });
    if (!ok) return;
    setDeletingId(rule.id);
    try {
      await apiFetch(`/automation-rules/${rule.id}`, { method: "DELETE" });
      toast.success("Automation rule deleted");
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Automation"
        description="Trigger an action automatically when something happens."
        actions={
          <Button
            variant={showForm ? "secondary" : "primary"}
            icon={showForm ? undefined : Plus}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Close form" : "New rule"}
          </Button>
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <RuleForm
          onCreated={() => {
            setShowForm(false);
            toast.success("Automation rule created");
            load();
          }}
        />
      )}

      {loading ? (
        <LoadingRows rows={3} />
      ) : rules.length === 0 ? (
        <Card>
          <EmptyState
            icon={Workflow}
            title="No automation rules yet"
            description="Create a rule to post announcements or assign onboarding tasks automatically when events happen."
            action={
              !showForm && (
                <Button icon={Plus} onClick={() => setShowForm(true)}>
                  New rule
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            {enabledCount} of {rules.length} {rules.length === 1 ? "rule" : "rules"} enabled
          </p>
          {rules.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className={`font-medium ${r.enabled ? "text-slate-900" : "text-slate-500"}`}>{r.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
                    <span>When</span>
                    <strong className="font-medium text-slate-700">{TRIGGER_LABELS[r.trigger]}</strong>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <strong className="font-medium text-slate-700">{ACTION_LABELS[r.actionType]}</strong>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <label htmlFor={`rule-enabled-${r.id}`} className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                    <input
                      id={`rule-enabled-${r.id}`}
                      type="checkbox"
                      checked={r.enabled}
                      onChange={() => toggle(r)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Enabled
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    loading={deletingId === r.id}
                    onClick={() => remove(r)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RuleForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationRule["trigger"]>("EMPLOYEE_ONBOARDED");
  const [actionType, setActionType] = useState<AutomationRule["actionType"]>("ASSIGN_ONBOARDING_TASK");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const actionConfig = actionType === "CREATE_ANNOUNCEMENT" ? { title, body } : { title };
      await apiFetch("/automation-rules", {
        method: "POST",
        body: JSON.stringify({ name, trigger, actionType, actionConfig }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="rule-name" className="label">
            Rule name
          </label>
          <input
            id="rule-name"
            required
            placeholder="e.g. Welcome new joiners"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="rule-trigger" className="label">
            When
          </label>
          <select
            id="rule-trigger"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as AutomationRule["trigger"])}
            className="input"
          >
            {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rule-action" className="label">
            Then
          </label>
          <select
            id="rule-action"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as AutomationRule["actionType"])}
            className="input"
          >
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {actionType === "ASSIGN_ONBOARDING_TASK" && (
          <div className="sm:col-span-2">
            <label htmlFor="rule-task-title" className="label">
              Task title
            </label>
            <input id="rule-task-title" required value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          </div>
        )}
        {actionType === "CREATE_ANNOUNCEMENT" && (
          <>
            <div className="sm:col-span-2">
              <label htmlFor="rule-announcement-title" className="label">
                Announcement title
              </label>
              <input
                id="rule-announcement-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="rule-announcement-body" className="label">
                Announcement body
              </label>
              <textarea
                id="rule-announcement-body"
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="input"
              />
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Create rule
          </Button>
        </div>
      </form>
    </Card>
  );
}
