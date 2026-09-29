"use client";

import { FormEvent, useEffect, useState } from "react";
import { ClockPlus, FileClock } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { TimesheetEntry } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate } from "@/components/format";

export default function MyTimesheetPage() {
  const { toast } = useFeedback();
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<TimesheetEntry[]>("/timesheets/me");
      setEntries(data);
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

  const pending = entries.filter((e) => e.status === "PENDING");
  const approvedHours = entries.filter((e) => e.status === "APPROVED").reduce((sum, e) => sum + (Number(e.hours) || 0), 0);
  const totalHours = entries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="My Timesheet"
        description="Log the hours you work each day and track their approval."
        actions={
          <Button
            variant={showForm ? "secondary" : "primary"}
            icon={showForm ? undefined : ClockPlus}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Close form" : "Log hours"}
          </Button>
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <TimesheetForm
          onSaved={() => {
            setShowForm(false);
            toast.success("Hours logged");
            load();
          }}
        />
      )}

      {!loading && entries.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile label="Pending" value={pending.length} tone="text-amber-600" />
          <SummaryTile label="Hours approved" value={round(approvedHours)} tone="text-emerald-600" />
          <SummaryTile label="Hours logged" value={round(totalHours)} tone="text-slate-900" />
        </div>
      )}

      {loading ? (
        <LoadingRows rows={4} />
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileClock}
            title="No timesheet entries yet"
            description="Log the hours you spent working and your manager will review them."
            action={
              !showForm && (
                <Button icon={ClockPlus} onClick={() => setShowForm(true)}>
                  Log hours
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Hours</th>
                <th>Task</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap font-medium text-slate-900">{formatDate(e.date)}</td>
                  <td className="text-slate-500">{e.hours}</td>
                  <td className="text-slate-500">{e.task ?? "—"}</td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </Card>
  );
}

function TimesheetForm({ onSaved }: { onSaved: () => void }) {
  const [date, setDate] = useState("");
  const [hours, setHours] = useState("8");
  const [task, setTask] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/timesheets", {
        method: "POST",
        body: JSON.stringify({ date, hours: Number(hours), task }),
      });
      onSaved();
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
          <label htmlFor="ts-date" className="label">
            Date
          </label>
          <input id="ts-date" required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="ts-hours" className="label">
            Hours
          </label>
          <input
            id="ts-hours"
            required
            type="number"
            min="0.5"
            max="24"
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="input"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ts-task" className="label">
            Task <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input id="ts-task" value={task} onChange={(e) => setTask(e.target.value)} className="input" placeholder="What did you work on?" />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Save entry
          </Button>
        </div>
      </form>
    </Card>
  );
}
