"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronRight, CircleCheck, Clock, LogIn, LogOut } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { AttendanceSummary, LeaveRequest } from "@/lib/types";
import { Button, ErrorBanner, LoadingRows } from "@/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDateRange, formatTime } from "@/components/format";

/**
 * The person's own attendance on a phone, as in the app design: today's
 * check in / check out with hours, this month's counts, and recent leave.
 * Check in and out happen here, on the server's clock and the organization's
 * timezone, like everywhere else.
 */

type Summary = AttendanceSummary & { today?: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function hoursBetween(from: string, to: string | null): string {
  const end = to ? new Date(to) : new Date();
  const mins = Math.max(0, Math.round((end.getTime() - new Date(from).getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function PhoneMyAttendance({ onChange }: { onChange?: () => void }) {
  const { toast } = useFeedback();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        apiFetch<Summary>(`/attendance/summary?month=${month}`),
        apiFetch<LeaveRequest[]>("/leave-requests/me").catch(() => []),
      ]);
      setSummary(s);
      setLeave(l);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
    // Today's hours tick while checked in.
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function punch(which: "check-in" | "check-out") {
    setBusy(true);
    try {
      await apiFetch(`/attendance/${which}`, { method: "POST" });
      toast.success(which === "check-in" ? "Checked in" : "Checked out");
      await load();
      onChange?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!summary) return error ? <ErrorBanner message={error} /> : <LoadingRows rows={4} />;

  const today = summary.records.find((r) => r.date.slice(0, 10) === summary.today);
  const checkedIn = !!today?.checkInAt;
  const checkedOut = !!today?.checkOutAt;
  const todayLabel = new Date(`${summary.today ?? month + "-01"}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const elapsed = summary.PRESENT + summary.ON_LEAVE + summary.ABSENT;
  const rate = elapsed ? Math.round((summary.PRESENT / elapsed) * 100) : null;
  const recent = [...leave].sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 3);

  return (
    <div className="space-y-4">
      <section className="c-card p-4" aria-label="Today">
        <p className="text-sm font-semibold text-heading">Today, {todayLabel}</p>
        <div className="mt-3 grid grid-cols-2 divide-x divide-[color:var(--we-border)]">
          <div className="flex items-center gap-3 pr-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong" aria-hidden>
              <CircleCheck className="size-5" strokeWidth={2} />
            </span>
            <span>
              <span className="block text-xs text-secondary">Checked In</span>
              <span className="block text-lg font-bold text-heading">{checkedIn ? formatTime(today!.checkInAt) : "—"}</span>
            </span>
          </div>
          <div className="flex items-center gap-3 pl-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--we-error-soft)] text-[color:var(--we-error-text)]" aria-hidden>
              <LogOut className="size-5" strokeWidth={2} />
            </span>
            <span>
              <span className="block text-xs text-secondary">Checked Out</span>
              <span className="block text-lg font-bold text-heading">
                {checkedOut ? formatTime(today!.checkOutAt) : checkedIn ? "At work" : "—"}
              </span>
            </span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-accent-soft px-3 py-2.5">
          <Clock className="size-5 text-accent-strong" strokeWidth={2} aria-hidden />
          <span>
            <span className="block text-xs text-accent-strong">Today&apos;s Hours</span>
            <span className="block text-base font-bold text-heading">{checkedIn ? hoursBetween(today!.checkInAt!, today!.checkOutAt) : "0h 0m"}</span>
          </span>
        </div>
        {!checkedOut && (
          <Button
            className="mt-3 h-11 w-full"
            variant={checkedIn ? "secondary" : "primary"}
            icon={checkedIn ? LogOut : LogIn}
            loading={busy}
            onClick={() => punch(checkedIn ? "check-out" : "check-in")}
          >
            {checkedIn ? "Check Out" : "Check In"}
          </Button>
        )}
      </section>

      <section aria-labelledby="month-att">
        <h2 id="month-att" className="mb-2 text-base font-semibold text-heading">
          Monthly Attendance ({MONTHS[now.getMonth()].slice(0, 3)} {now.getFullYear()})
        </h2>
        <div className="grid grid-cols-4 gap-2">
          <MonthTile value={summary.PRESENT} label="Present" tone="text-accent-strong" bg="bg-accent-soft" />
          <MonthTile value={summary.ON_LEAVE} label="On Leave" tone="text-[color:var(--we-warning-text)]" bg="bg-[color:var(--we-warning-soft)]" />
          <MonthTile value={summary.ABSENT} label="Absent" tone="text-[color:var(--we-error-text)]" bg="bg-[color:var(--we-error-soft)]" />
          <MonthTile value={rate === null ? "—" : `${rate}%`} label="Rate" tone="text-heading" bg="bg-surface border border-line" />
        </div>
      </section>

      <section className="c-card" aria-labelledby="recent-leave">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 id="recent-leave" className="text-base font-semibold text-heading">
            Recent Leave Requests
          </h2>
          <Link href="/attendance?tab=leave" className="flex items-center text-sm font-semibold text-link">
            View All <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-4 pb-4 pt-2 text-sm text-secondary">No leave requests yet.</p>
        ) : (
          <ul className="px-2 pb-2 pt-1">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
                <span className="c-icon-tile" data-size="sm" data-tone="info" aria-hidden>
                  <CalendarDays strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-heading">{r.leaveType.name}</span>
                  <span className="block text-xs text-secondary">
                    {formatDateRange(r.startDate, r.endDate)} ({r.days} day{r.days === 1 ? "" : "s"})
                  </span>
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MonthTile({ value, label, tone, bg }: { value: number | string; label: string; tone: string; bg: string }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl px-1 py-3 text-center ${bg}`}>
      <span className={`text-xl font-bold ${tone}`}>{value}</span>
      <span className="text-xs text-body">{label}</span>
    </div>
  );
}
