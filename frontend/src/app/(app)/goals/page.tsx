"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarDays, Plus, Target } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Goal } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate } from "@/components/format";

const STATUS_LABELS: Record<Goal["status"], string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};

export default function GoalsPage() {
  const { toast } = useFeedback();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setGoals(await apiFetch<Goal[]>("/goals/me"));
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

  async function updateGoal(id: string, patch: Partial<Pick<Goal, "status" | "progress">>) {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    try {
      await apiFetch(`/goals/me/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (patch.status) toast.success(`Goal marked ${STATUS_LABELS[patch.status].toLowerCase()}`);
    } catch (err) {
      toast.error(errorMessage(err));
      load();
    }
  }

  const completed = goals.filter((g) => g.status === "COMPLETED").length;
  const inProgress = goals.filter((g) => g.status === "IN_PROGRESS").length;
  const avgProgress = goals.length ? Math.round(goals.reduce((s, g) => s + (Number(g.progress) || 0), 0) / goals.length) : 0;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="My Goals"
        description="Set personal goals and keep your progress up to date."
        actions={
          <Button variant={showForm ? "secondary" : "primary"} icon={showForm ? undefined : Plus} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Close form" : "New goal"}
          </Button>
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <GoalForm
          onCreated={() => {
            setShowForm(false);
            toast.success("Goal added");
            load();
          }}
        />
      )}

      {!loading && goals.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile label="In progress" value={String(inProgress)} tone="text-blue-600" />
          <SummaryTile label="Completed" value={String(completed)} tone="text-emerald-600" />
          <SummaryTile label="Avg. progress" value={`${avgProgress}%`} tone="text-slate-900" />
        </div>
      )}

      {loading ? (
        <LoadingRows rows={3} />
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={Target}
            title="No goals yet"
            description="Add a goal to focus your work and track progress towards it over time."
            action={
              !showForm && (
                <Button icon={Plus} onClick={() => setShowForm(true)}>
                  New goal
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => (
            <Card key={g.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{g.title}</p>
                  {g.dueDate && (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Due {formatDate(g.dueDate)}
                    </p>
                  )}
                </div>
                <label htmlFor={`goal-status-${g.id}`} className="sr-only">
                  Status
                </label>
                <select
                  id={`goal-status-${g.id}`}
                  value={g.status}
                  onChange={(e) => updateGoal(g.id, { status: e.target.value as Goal["status"] })}
                  className="input w-auto py-1 text-xs"
                >
                  <option value="NOT_STARTED">Not started</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>
              {g.description && <p className="mt-2 text-sm text-slate-600">{g.description}</p>}
              <div className="mt-3 flex items-center gap-3">
                <label htmlFor={`goal-progress-${g.id}`} className="text-xs font-medium text-slate-500">
                  Progress
                </label>
                <input
                  id={`goal-progress-${g.id}`}
                  type="range"
                  min={0}
                  max={100}
                  value={g.progress}
                  onChange={(e) => updateGoal(g.id, { progress: Number(e.target.value) })}
                  className="flex-1 accent-blue-600"
                />
                <span className="w-10 text-right text-xs font-medium tabular-nums text-slate-700">{g.progress}%</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </Card>
  );
}

function GoalForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/goals", { method: "POST", body: JSON.stringify({ title, description, dueDate: dueDate || undefined }) });
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
        <div>
          <label htmlFor="goal-title" className="label">
            Goal title
          </label>
          <input id="goal-title" required value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="e.g. Ship the new onboarding flow" />
        </div>
        <div>
          <label htmlFor="goal-due" className="label">
            Due date <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input id="goal-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="goal-description" className="label">
            Description <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea id="goal-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input" />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Add goal
          </Button>
        </div>
      </form>
    </Card>
  );
}
