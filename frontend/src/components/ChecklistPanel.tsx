"use client";

import { useCallback, useEffect, useState } from "react";
import { ListChecks } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { OnboardingTask } from "@/lib/types";
import { Card, CardBody, CardHeader, EmptyState, ErrorBanner, LoadingRows, Progress } from "@/ui";
import { errorMessage, useFeedback } from "./feedback";
import { formatCalendarDate } from "./format";

/**
 * The joining checklist (Employees 2.3). One checklist, the same for direct
 * hires and candidates who have joined.
 *
 * `own` means the signed-in employee is ticking their own items. HR sees
 * someone else's progress read-only here: items marked "HR checks this" are
 * verified through the document itself, not by ticking a box for the employee.
 */
export function ChecklistPanel({ employeeId, own }: { employeeId?: string; own: boolean }) {
  const { toast } = useFeedback();
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const path = own ? "/onboarding/me" : `/onboarding?employeeId=${employeeId}`;
      setTasks(await apiFetch<OnboardingTask[]>(path));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [own, employeeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function toggle(task: OnboardingTask) {
    setBusyId(task.id);
    try {
      await apiFetch(`/onboarding/me/${task.id}`, { method: "PATCH", body: JSON.stringify({ done: !task.done }) });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const done = tasks.filter((t) => t.done).length;

  return (
    <Card>
      <CardHeader title={`Joining checklist${tasks.length ? ` · ${done} of ${tasks.length}` : ""}`} />
      <CardBody className="space-y-4">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        {loading ? (
          <LoadingRows rows={3} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No checklist items"
            description="The checklist is created automatically when someone joins."
          />
        ) : (
          <>
            <Progress value={tasks.length ? Math.round((done / tasks.length) * 100) : 0} />
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id={`task-${t.id}`}
                    checked={t.done}
                    disabled={!own || busyId === t.id}
                    onChange={() => toggle(t)}
                    className="c-checkbox mt-0.5"
                  />
                  <label htmlFor={`task-${t.id}`} className="min-w-0 flex-1 text-sm">
                    <span className={t.done ? "text-secondary line-through" : "text-body"}>{t.title}</span>
                    {t.requiresVerification && (
                      <span className="ml-2 c-badge" data-tone={t.verifiedAt ? "success" : undefined}>
                        {t.verifiedAt ? "HR verified" : "HR checks this"}
                      </span>
                    )}
                    {t.dueDate && <span className="ml-2 text-xs text-secondary">due {formatCalendarDate(t.dueDate)}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
