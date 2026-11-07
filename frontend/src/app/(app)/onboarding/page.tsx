"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Circle, ClipboardList, ListPlus } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Employee, OnboardingTask } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader, StatCard } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";

export default function OnboardingPage() {
  const { toast } = useFeedback();
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [t, e] = await Promise.all([
        apiFetch<OnboardingTask[]>("/onboarding"),
        apiFetch<Employee[]>("/employees"),
      ]);
      setTasks(t);
      setEmployees(e.filter((emp) => emp.status === "ONBOARDING"));
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

  const grouped = tasks.reduce<Record<string, OnboardingTask[]>>((acc, task) => {
    const key = task.employee ? `${task.employee.firstName} ${task.employee.lastName} (${task.employee.employeeCode})` : "Unknown";
    acc[key] = acc[key] ?? [];
    acc[key].push(task);
    return acc;
  }, {});

  const groups = Object.entries(grouped);
  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Onboarding"
        description="Track checklist tasks for new hires until they're fully set up."
        actions={
          <Button
            variant={showForm ? "secondary" : "primary"}
            icon={showForm ? undefined : ListPlus}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Close form" : "Add task"}
          </Button>
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <AddTaskForm
          employees={employees}
          onCreated={() => {
            setShowForm(false);
            toast.success("Onboarding task added");
            load();
          }}
        />
      )}

      {!loading && tasks.length > 0 && (
        <div className="c-stats">
          <StatCard label="New hires" value={groups.length} />
          <StatCard label="Open tasks" value={tasks.length - doneCount} valueTone="warning" />
          <StatCard label="Completed" value={doneCount} valueTone="success" />
        </div>
      )}

      {loading ? (
        <LoadingRows rows={4} />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="No onboarding tasks yet"
            description="Add checklist tasks (laptop setup, paperwork, induction…) for employees who are onboarding."
            action={
              !showForm && (
                <Button variant="secondary" icon={ListPlus} onClick={() => setShowForm(true)}>
                  Add task
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(([employeeLabel, employeeTasks]) => {
            const done = employeeTasks.filter((t) => t.done).length;
            const pct = Math.round((done / employeeTasks.length) * 100);
            return (
              <Card key={employeeLabel} className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-heading">{employeeLabel}</p>
                  <span className="text-xs font-medium text-secondary">
                    {done}/{employeeTasks.length} done
                  </span>
                </div>
                <div
                  className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${employeeLabel} onboarding progress`}
                >
                  <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
                </div>
                <ul className="space-y-1.5 text-sm">
                  {employeeTasks.map((t) => (
                    <li key={t.id} className="flex items-start gap-2">
                      {t.done ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Done" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-label="Not done" />
                      )}
                      <span className={t.done ? "text-secondary line-through" : "text-body"}>{t.title}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}


function AddTaskForm({ employees, onCreated }: { employees: Employee[]; onCreated: () => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/onboarding", { method: "POST", body: JSON.stringify({ employeeId, title }) });
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
          <label htmlFor="onb-employee" className="c-label">
            Employee
          </label>
          <select id="onb-employee" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="c-select">
            <option value="">Select an onboarding employee…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName}
              </option>
            ))}
          </select>
          {employees.length === 0 && (
            <p className="mt-1 text-xs text-secondary">No employees are currently in onboarding status.</p>
          )}
        </div>
        <div>
          <label htmlFor="onb-title" className="c-label">
            Task title
          </label>
          <input
            id="onb-title"
            required
            placeholder="e.g. Issue laptop"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="c-input"
          />
        </div>
        {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Add task
          </Button>
        </div>
      </form>
    </Card>
  );
}
