"use client";

import { FormEvent, useEffect, useState } from "react";
import { ClockPlus, FileClock } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { TimesheetEntry } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader, StatCard } from "@/ui";
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
        <div className="c-stats">
          <StatCard label="Pending" value={pending.length} valueTone="warning" />
          <StatCard label="Hours approved" value={round(approvedHours)} valueTone="success" />
          <StatCard label="Hours logged" value={round(totalHours)} />
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
                <Button variant="secondary" icon={ClockPlus} onClick={() => setShowForm(true)}>
                  Log hours
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
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
                  <td className="whitespace-nowrap font-medium text-heading">{formatDate(e.date)}</td>
                  <td className="text-secondary">{e.hours}</td>
                  <td className="text-secondary">{e.task ?? "—"}</td>
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
          <label htmlFor="ts-date" className="c-label">
            Date
          </label>
          <input id="ts-date" required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="c-input" />
        </div>
        <div>
          <label htmlFor="ts-hours" className="c-label">
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
            className="c-input"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ts-task" className="c-label">
            Task <span className="font-normal text-secondary">(optional)</span>
          </label>
          <input id="ts-task" value={task} onChange={(e) => setTask(e.target.value)} className="c-input" placeholder="What did you work on?" />
        </div>
        {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Save entry
          </Button>
        </div>
      </form>
    </Card>
  );
}
