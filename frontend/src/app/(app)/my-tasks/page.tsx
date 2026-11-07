"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { OnboardingTask } from "@/lib/types";
import { Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate, localIsoDate } from "@/components/format";

// Default checklist items that can be done inside the app point to the page where they happen.
const TASK_LINKS: Record<string, { href: string; label: string }> = {
  "Complete personal profile": { href: "/my-profile", label: "Open My Profile" },
};

export default function MyTasksPage() {
  const { toast } = useFeedback();
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<OnboardingTask[]>("/onboarding/me");
      setTasks(data);
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

  async function toggle(task: OnboardingTask) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    try {
      await apiFetch(`/onboarding/me/${task.id}`, { method: "PATCH", body: JSON.stringify({ done: !task.done }) });
      if (!task.done) toast.success(`"${task.title}" completed`);
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: task.done } : t)));
      toast.error(errorMessage(err));
    }
  }

  const doneCount = tasks.filter((t) => t.done).length;
  const percent = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const todayStr = localIsoDate();

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="My Tasks" description="Work through your onboarding checklist. Tick tasks off as you finish them." />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {loading ? (
        <LoadingRows rows={4} />
      ) : tasks.length === 0 ? (
        !loadError && (
          <Card>
            <EmptyState
              icon={ListChecks}
              title="No tasks assigned"
              description="You're all caught up. Onboarding tasks assigned to you by HR will appear here."
            />
          </Card>
        )
      ) : (
        <>
          <Card className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-heading">
                {doneCount} of {tasks.length} tasks complete
              </p>
              <p className="text-sm font-semibold text-heading">{percent}%</p>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Onboarding progress"
            >
              <div
                className={`h-full rounded-full transition-all ${percent === 100 ? "bg-success" : "bg-accent"}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </Card>

          <Card className="divide-y divide-line overflow-hidden">
            {tasks.map((task) => {
              const overdue = !task.done && !!task.dueDate && task.dueDate.slice(0, 10) < todayStr;
              return (
                <label
                  key={task.id}
                  htmlFor={`task-${task.id}`}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-muted"
                >
                  <input
                    id={`task-${task.id}`}
                    type="checkbox"
                    checked={task.done}
                    onChange={() => toggle(task)}
                    className="h-4 w-4 shrink-0 rounded-sm border-line-strong"
                  />
                  <span className={`min-w-0 flex-1 ${task.done ? "text-secondary line-through" : "text-heading"}`}>
                    {task.title}
                  </span>
                  {!task.done && TASK_LINKS[task.title] && (
                    <Link
                      href={TASK_LINKS[task.title].href}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 text-xs c-link"
                    >
                      {TASK_LINKS[task.title].label}
                    </Link>
                  )}
                  {task.dueDate && (
                    <span className={`shrink-0 whitespace-nowrap text-xs ${overdue ? "font-medium text-danger-text" : "text-secondary"}`}>
                      {overdue ? "Overdue · " : "Due "}
                      {formatDate(task.dueDate)}
                    </span>
                  )}
                </label>
              );
            })}
          </Card>
        </>
      )}
    </div>
  );
}
