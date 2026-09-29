"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, CalendarClock, LogIn, LogOut } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { AttendanceRecord } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader, Skeleton } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate, formatTime, localIsoDate } from "@/components/format";

export default function MyAttendancePage() {
  const { toast } = useFeedback();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<AttendanceRecord[]>("/attendance/me");
      setRecords(data);
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

  const todayIso = localIsoDate();
  const todayRecord = records.find((r) => r.date.slice(0, 10) === todayIso);

  async function checkIn() {
    setError(null);
    setActionPending(true);
    try {
      await apiFetch("/attendance/check-in", { method: "POST" });
      toast.success("Checked in. Have a great day!");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setActionPending(false);
    }
  }

  async function checkOut() {
    setError(null);
    setActionPending(true);
    try {
      await apiFetch("/attendance/check-out", { method: "POST" });
      toast.success("Checked out. See you next time!");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setActionPending(false);
    }
  }

  const checkedIn = !!todayRecord?.checkInAt;
  const checkedOut = !!todayRecord?.checkOutAt;
  const todayStatus = checkedOut
    ? { label: "Day complete", tone: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" }
    : checkedIn
      ? { label: "Checked in", tone: "bg-blue-50 text-blue-700 ring-blue-600/20" }
      : { label: "Not checked in", tone: "bg-slate-100 text-slate-600 ring-slate-500/20" };

  const now = new Date();
  const monthPrefix = todayIso.slice(0, 7);
  const thisMonth = records.filter((r) => r.date.slice(0, 7) === monthPrefix && r.checkInAt);
  const monthHours = thisMonth.reduce((sum, r) => sum + (workedHours(r) ?? 0), 0);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="My Attendance" description="Check in and out each day and review your attendance history." />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Today</p>
              {!loading && (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${todayStatus.tone}`}>
                  {todayStatus.label}
                </span>
              )}
            </div>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </p>
            {loading ? (
              <div className="mt-3 flex gap-6">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
              </div>
            ) : (
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                <TimeStat label="Check-in" value={formatTime(todayRecord?.checkInAt)} />
                <TimeStat label="Check-out" value={formatTime(todayRecord?.checkOutAt)} />
                {todayRecord && workedHours(todayRecord) !== null && (
                  <TimeStat label="Worked" value={formatHours(workedHours(todayRecord))} />
                )}
              </dl>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {!checkedIn ? (
              <Button icon={LogIn} onClick={checkIn} loading={actionPending} disabled={loading} className="w-full px-6 py-2.5 sm:w-auto">
                Check in
              </Button>
            ) : !checkedOut ? (
              <Button
                variant="secondary"
                icon={LogOut}
                onClick={checkOut}
                loading={actionPending}
                disabled={loading}
                className="w-full px-6 py-2.5 sm:w-auto"
              >
                Check out
              </Button>
            ) : (
              <p className="text-sm text-slate-500">You&apos;re all done for today.</p>
            )}
          </div>
        </div>
        {error && <p className="border-t border-red-100 bg-red-50 px-5 py-2 text-sm text-red-600 sm:px-6">{error}</p>}
      </Card>

      {!loading && records.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <SummaryTile label="Days this month" value={String(thisMonth.length)} />
          <SummaryTile label="Hours this month" value={formatHours(monthHours)} />
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-500">History</h2>
        {loading ? (
          <LoadingRows rows={5} />
        ) : records.length === 0 ? (
          <Card>
            <EmptyState
              icon={CalendarClock}
              title="No attendance records yet"
              description="Check in using the button above when you start work — your daily records will appear here."
            />
          </Card>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Worked</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap font-medium text-slate-900">
                      <span className="inline-flex items-center gap-1.5">
                        {formatDate(r.date)}
                        {r.date.slice(0, 10) === todayIso && <CalendarCheck className="h-3.5 w-3.5 text-blue-600" aria-label="Today" />}
                      </span>
                    </td>
                    <td className="text-slate-500">{formatTime(r.checkInAt)}</td>
                    <td className="text-slate-500">{formatTime(r.checkOutAt)}</td>
                    <td className="text-slate-500">{formatHours(workedHours(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function TimeStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </Card>
  );
}

/** Hours between check-in and check-out; null when the day is not complete. */
function workedHours(r: AttendanceRecord): number | null {
  if (!r.checkInAt || !r.checkOutAt) return null;
  const ms = new Date(r.checkOutAt).getTime() - new Date(r.checkInAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : null;
}

function formatHours(h: number | null): string {
  if (h === null) return "—";
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}
