"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  LogIn,
  LogOut,
  Plus,
  Search,
  Settings,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type {
  AttendanceCorrection,
  AttendanceRecord,
  AttendanceRegister,
  AttendanceSummary,
  DayStatus,
  LeaveRequest,
  WorkSchedule,
} from "@/lib/types";
import { MyCheckIn } from "@/components/MyCheckIn";
import { saveFile } from "@/lib/native";
import { useIsPhone } from "@/lib/use-phone";
import { PhoneMyAttendance } from "@/components/phone/PhoneMyAttendance";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Avatar,
  BarTrend,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBanner,
  LoadingRows,
  PageHeader,
  StatCard,
} from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatCalendarDate, formatDateRange, formatDateTime, formatTime, localIsoDate } from "@/components/format";

/**
 * Attendance & Leave (03). One screen for the daily register, leave, attendance
 * corrections and the work schedule — plus the approval actions for whoever the
 * requests are routed to. There is no separate Approvals menu.
 */

type Tab = "attendance" | "leave" | "corrections" | "schedule";

const TABS: { key: Tab; label: string }[] = [
  { key: "attendance", label: "Attendance" },
  { key: "leave", label: "Leave" },
  { key: "corrections", label: "Corrections" },
  { key: "schedule", label: "Work Schedule" },
];

const DAY_MS = 86_400_000;

export default function AttendancePage() {
  return (
    <Suspense fallback={<LoadingRows rows={4} />}>
      <AttendanceTabs />
    </Suspense>
  );
}

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function AttendanceTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const { hasPermission, user } = useAuth();
  const canReadAll = hasPermission("employee:read");
  const isPhone = useIsPhone();
  const [phoneReload, setPhoneReload] = useState(0);
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = TABS.some((t) => t.key === requested) ? (requested as Tab) : "attendance";
  const today = localIsoDate();
  const [date, setDate] = useState(today);

  function select(next: Tab, extra = "") {
    router.replace(next === "attendance" && !extra ? "/attendance" : `/attendance?tab=${next}${extra}`, { scroll: false });
  }

  const label = new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  // The register's day. On phones it sits above the team register it controls.
  const dateNav = (
    <div className="c-date-nav">
      <button type="button" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
        <ChevronLeft className="size-5" aria-hidden />
      </button>
      <label>
        <CalendarDays className="size-icon text-secondary" strokeWidth={2} aria-hidden />
        <span>{label}</span>
        <input
          type="date"
          className="sr-only"
          value={date}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Pick a date"
        />
      </label>
      <button
        type="button"
        onClick={() => setDate(shiftDate(date, 1))}
        disabled={date >= today}
        aria-label="Next day"
      >
        <ChevronRight className="size-5" aria-hidden />
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarDays}
        title="Attendance"
        description="Track employee attendance, check in/out, and manage corrections."
        actions={
          <>
            {canReadAll && tab === "attendance" && !isPhone && dateNav}
            <Button icon={Plus} onClick={() => select("corrections", "&new=1")}>
              Add Correction
            </Button>
          </>
        }
      />

      <div className="c-tabs" role="tablist" aria-label="Attendance and leave">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => select(t.key)} className="c-tab">
            {t.label}
          </button>
        ))}
      </div>

      {tab === "attendance" &&
        (isPhone ? (
          // Phone: my own day first (as in the app design), then the team register for HR.
          <>
            {user?.employee && <PhoneMyAttendance onChange={() => setPhoneReload((k) => k + 1)} />}
            {canReadAll && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <h2 className="text-base font-semibold text-heading">Team Register</h2>
                  {dateNav}
                </div>
                <RegisterTab key={phoneReload} date={date} hideMyCheckIn />
              </>
            )}
          </>
        ) : canReadAll ? (
          <RegisterTab date={date} />
        ) : (
          <MyAttendanceTab />
        ))}
      {tab === "leave" && <LeaveTab startOpen={params.get("new") === "1"} />}
      {tab === "corrections" && <CorrectionsTab startOpen={params.get("new") === "1"} />}
      {tab === "schedule" && <ScheduleTab />}
    </div>
  );
}

/* ─── Attendance: the organization register (HR/Admin) ───────────────── */

type Trend = { days: { date: string; rate: number | null; counts: Record<DayStatus, number>; eligible: number }[] };

const PAGE_SIZE = 10;

const STATUS_FILTERS: { key: DayStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All statuses" },
  { key: "PRESENT", label: "Present" },
  { key: "ON_LEAVE", label: "On leave" },
  { key: "ABSENT", label: "Absent" },
  { key: "NOT_CHECKED_IN", label: "Not checked in" },
];

function workedHours(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn || !checkOut) return "—";
  const mins = Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

function RegisterTab({ date, hideMyCheckIn = false }: { date: string; hideMyCheckIn?: boolean }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [register, setRegister] = useState<AttendanceRegister | null>(null);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [pendingCorrections, setPendingCorrections] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<DayStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AttendanceRegister>(`/attendance/register?date=${date}`)
      .then((r) => {
        if (!cancelled) {
          setRegister(r);
          setPage(1);
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [date, reloadKey]);

  useEffect(() => {
    apiFetch<Trend>("/attendance/trend?days=7").then(setTrend).catch(() => setTrend(null));
    apiFetch<unknown[]>("/attendance/corrections/pending")
      .then((r) => setPendingCorrections(r.length))
      .catch(() => setPendingCorrections(0));
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (register?.rows ?? []).filter(
      (r) =>
        (status === "ALL" || r.status === status) &&
        (!q || `${r.name} ${r.employeeCode} ${r.department ?? ""}`.toLowerCase().includes(q)),
    );
  }, [register, search, status]);

  if (!register) return error ? <ErrorBanner message={error} /> : <LoadingRows rows={6} />;

  const count = (s: DayStatus) => register.rows.filter((r) => r.status === s).length;
  const total = register.rows.length;
  const pct = (n: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : "—");
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // In-page summary download (no Reports menu in the essential release).
  function downloadCsv() {
    const header = ["Employee code", "Name", "Department", "Check in", "Check out", "Working hours", "Status"];
    const lines = register!.rows.map((r) =>
      [r.employeeCode, r.name, r.department ?? "", formatTime(r.checkInAt), formatTime(r.checkOutAt), workedHours(r.checkInAt, r.checkOutAt), r.status]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    saveFile(blob, `attendance-${register!.date}.csv`).catch(() => toast.error("Couldn't save the file."));
  }

  const trendData = (trend?.days ?? []).map((d) => {
    const dt = new Date(`${d.date}T00:00:00Z`);
    return {
      label: dt.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }),
      value: d.rate,
      hint: d.rate === null ? undefined : `${d.counts.PRESENT} of ${d.eligible} present`,
    };
  });

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {/* HR and admins are employees too: their own check in / out. */}
      {!hideMyCheckIn && <MyCheckIn onChange={() => setReloadKey((k) => k + 1)} />}

      {!register.isWorkingDay && (
        <p className="c-alert" data-tone="info">
          {register.holiday ? `${register.holiday} — a company holiday.` : "Not a working day."} Nobody is counted absent.
        </p>
      )}

      <div className="c-stats" data-dense="true">
        <StatCard icon={Users} label="Employees" value={total} />
        <StatCard icon={UserCheck} label="Present" value={count("PRESENT")} hint={pct(count("PRESENT"))} />
        <StatCard icon={CalendarDays} iconTone="warning" label="On Leave" value={count("ON_LEAVE")} hint={pct(count("ON_LEAVE"))} />
        <StatCard icon={UserX} iconTone="danger" label="Absent" value={count("ABSENT")} hint={pct(count("ABSENT"))} />
        <StatCard
          icon={Clock}
          iconTone="info"
          label="Not Yet Checked In"
          value={count("NOT_CHECKED_IN")}
          hint="Not absent yet"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <Card className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-2 pt-5">
            <h2 className="c-card-title">
              {register.date === localIsoDate() ? "Today's Attendance" : `Attendance · ${formatCalendarDate(register.date)}`} ({total})
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="c-input-group w-72 max-w-full">
                <Search strokeWidth={2} aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search employee (name, ID, department)…"
                  aria-label="Search employees"
                  className="c-input"
                />
              </div>
              <select
                aria-label="Filter by status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as DayStatus | "ALL");
                  setPage(1);
                }}
                className="c-select w-auto"
              >
                {STATUS_FILTERS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={Users} title="No one matches" description="Try a different name, ID or status." />
          ) : (
            <div className="overflow-x-auto px-5">
              <table className="c-table">
                <caption className="sr-only">Attendance register</caption>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Check In</th>
                    <th>Check Out</th>
                    <th>Working Hours</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.employeeId}>
                      <td>
                        <span className="flex items-center gap-3">
                          <Avatar name={row.name} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-heading">{row.name}</span>
                            <span className="block text-xs text-secondary">{row.employeeCode}</span>
                          </span>
                        </span>
                      </td>
                      <td>{row.department ?? "—"}</td>
                      <td className="whitespace-nowrap">{row.checkInAt ? formatTime(row.checkInAt) : "—"}</td>
                      <td className="whitespace-nowrap">
                        {row.missingCheckOut ? (
                          <span className="c-badge" data-tone="warning">
                            Missing
                          </span>
                        ) : row.checkOutAt ? (
                          formatTime(row.checkOutAt)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {row.checkInAt && !row.checkOutAt && !row.missingCheckOut ? "At work" : workedHours(row.checkInAt, row.checkOutAt)}
                      </td>
                      <td className="whitespace-nowrap">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm text-secondary">
            <span>
              Showing {rows.length ? (page - 1) * PAGE_SIZE + 1 : 0} – {Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}{" "}
              employees
            </span>
            {pages > 1 && <Pager page={page} pages={pages} onPage={setPage} />}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Attendance Trend (Last 7 Days)" />
            <CardBody className="pt-1">
              {trendData.some((d) => d.value !== null) ? (
                <BarTrend data={trendData} caption="Attendance rate, last seven days" />
              ) : (
                <p className="py-6 text-center text-sm text-secondary">No working days in the last week yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Quick Actions" />
            <CardBody className="pt-1">
              <button type="button" onClick={downloadCsv} className="c-list-row w-full text-left">
                <span className="c-icon-tile" data-size="sm" aria-hidden>
                  <Download strokeWidth={2} />
                </span>
                <span className="flex-1">Download Register (CSV)</span>
                <ChevronRight className="size-4 text-secondary" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => router.replace("/attendance?tab=corrections", { scroll: false })}
                className="c-list-row w-full text-left"
              >
                <span className="c-icon-tile" data-size="sm" data-tone="ai" aria-hidden>
                  <ClipboardList strokeWidth={2} />
                </span>
                <span className="flex-1">Attendance Corrections</span>
                {pendingCorrections > 0 && (
                  <span className="c-badge" data-tone="brand">
                    {pendingCorrections}
                  </span>
                )}
                <ChevronRight className="size-4 text-secondary" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => router.replace("/attendance?tab=schedule", { scroll: false })}
                className="c-list-row w-full text-left"
              >
                <span className="c-icon-tile" data-size="sm" data-tone="info" aria-hidden>
                  <CalendarCheck strokeWidth={2} />
                </span>
                <span className="flex-1">Work Schedule & Holidays</span>
                <ChevronRight className="size-4 text-secondary" aria-hidden />
              </button>
              <Link href="/settings?tab=company" className="c-list-row">
                <span className="c-icon-tile" data-size="sm" data-tone="warning" aria-hidden>
                  <Settings strokeWidth={2} />
                </span>
                <span className="flex-1">Attendance Settings</span>
                <ChevronRight className="size-4 text-secondary" aria-hidden />
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  // First, last, current and its neighbours; gaps become an ellipsis.
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return (
    <nav aria-label="Pages" className="flex items-center gap-1">
      <button type="button" className="c-btn-ghost c-btn-icon border border-line" onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page">
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1">
          {i > 0 && n - nums[i - 1] > 1 && <span className="px-1">…</span>}
          <button
            type="button"
            onClick={() => onPage(n)}
            aria-current={n === page ? "page" : undefined}
            className={`c-btn-icon rounded-md text-sm font-medium ${n === page ? "bg-nav-active text-on-nav-active" : "c-btn-ghost text-heading"}`}
          >
            {n}
          </button>
        </span>
      ))}
      <button type="button" className="c-btn-ghost c-btn-icon border border-line" onClick={() => onPage(page + 1)} disabled={page === pages} aria-label="Next page">
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </nav>
  );
}

/* ─── Attendance: my own days (employees) ────────────────────────────── */

function MyAttendanceTab() {
  const { toast } = useFeedback();
  const month = localIsoDate().slice(0, 7);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSummary(await apiFetch<AttendanceSummary>(`/attendance/summary?month=${month}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function punch(which: "check-in" | "check-out") {
    setBusy(true);
    try {
      await apiFetch(`/attendance/${which}`, { method: "POST" });
      toast.success(which === "check-in" ? "Checked in" : "Checked out");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!summary) return error ? <ErrorBanner message={error} /> : <LoadingRows rows={5} />;

  const today = summary.records.find((r) => r.date.slice(0, 10) === localIsoDate()) as AttendanceRecord | undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4">
          <span className="c-icon-tile" aria-hidden>
            <Clock strokeWidth={2} />
          </span>
          <div className="min-w-48 flex-1">
            <p className="text-lg font-semibold text-heading">
              {today?.checkOutAt ? "Checked out" : today?.checkInAt ? "Checked in" : "Not checked in yet"}
            </p>
            <p className="text-sm text-secondary">
              {today?.checkInAt ? `In at ${formatTime(today.checkInAt)}` : "Check in when you start work."}
              {today?.checkOutAt ? ` · out at ${formatTime(today.checkOutAt)}` : ""}
              {today?.checkInAt && today.checkOutAt ? ` · ${workedHours(today.checkInAt, today.checkOutAt)}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button icon={LogIn} loading={busy} disabled={!!today?.checkInAt} onClick={() => punch("check-in")}>
              Check In
            </Button>
            <Button
              variant="secondary"
              icon={LogOut}
              loading={busy}
              disabled={!today?.checkInAt || !!today?.checkOutAt}
              onClick={() => punch("check-out")}
            >
              Check Out
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="c-stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
        <StatCard icon={UserCheck} label="Present" value={summary.PRESENT} hint="This month" />
        <StatCard icon={CalendarDays} iconTone="warning" label="On Leave" value={summary.ON_LEAVE} />
        <StatCard icon={Clock} iconTone="info" label="Not Checked In" value={summary.NOT_CHECKED_IN} hint="Days still running" />
        <StatCard icon={UserX} iconTone="danger" label="Absent" value={summary.ABSENT} />
        <StatCard icon={CalendarCheck} iconTone="ai" label="Working Days" value={summary.workingDays} />
      </div>

      <div className="c-table-wrap">
        <table className="c-table">
          <caption className="sr-only">My attendance this month</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Working Hours</th>
            </tr>
          </thead>
          <tbody>
            {summary.records.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-secondary">
                  No check-ins recorded this month yet.
                </td>
              </tr>
            ) : (
              [...summary.records]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((r) => (
                  <tr key={r.date}>
                    <td className="whitespace-nowrap font-semibold text-heading">{formatCalendarDate(r.date)}</td>
                    <td>{formatTime(r.checkInAt)}</td>
                    <td>
                      {r.checkOutAt ? (
                        formatTime(r.checkOutAt)
                      ) : r.checkInAt && r.date.slice(0, 10) === localIsoDate() ? (
                        "At work"
                      ) : r.checkInAt ? (
                        <span className="c-badge" data-tone="warning">
                          Missing
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{workedHours(r.checkInAt, r.checkOutAt)}</td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Leave ──────────────────────────────────────────────────────────── */

function LeaveTab({ startOpen = false }: { startOpen?: boolean }) {
  const { toast, confirm } = useFeedback();
  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [pending, setPending] = useState<LeaveRequest[]>([]);
  const [schedule, setSchedule] = useState<WorkSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Home's "Apply Leave" quick action opens the form straight away.
  const [showForm, setShowForm] = useState(startOpen);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, p, s] = await Promise.all([
        apiFetch<LeaveRequest[]>("/leave-requests/me"),
        apiFetch<LeaveRequest[]>("/leave-requests/pending-approvals").catch(() => []),
        apiFetch<WorkSchedule>("/attendance/schedule"),
      ]);
      setMine(m);
      setPending(p);
      setSchedule(s);
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

  async function cancel(r: LeaveRequest) {
    const ok = await confirm({
      title: "Cancel this leave request?",
      description:
        r.status === "APPROVED"
          ? `${r.leaveType.name}, ${formatDateRange(r.startDate, r.endDate)}. The ${r.days} day(s) go back to your balance.`
          : `${r.leaveType.name}, ${formatDateRange(r.startDate, r.endDate)}.`,
      confirmLabel: "Cancel request",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(r.id);
    try {
      await apiFetch(`/leave-requests/${r.id}/cancel`, { method: "POST" });
      toast.success("Leave request cancelled");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function decide(r: LeaveRequest, approve: boolean) {
    setBusyId(r.id);
    try {
      await apiFetch(`/leave-requests/${r.id}/${approve ? "approve" : "reject"}`, { method: "POST" });
      toast.success(approve ? "Leave approved" : "Leave rejected");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <LoadingRows rows={4} />;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {/* Approvals live here, inside the records they decide. */}
      {pending.length > 0 && (
        <Card>
          <CardHeader title={`Waiting on you · ${pending.length}`} />
          <div className="c-table-wrap">
            <table className="c-table">
              <caption className="sr-only">Leave requests waiting on you</caption>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Days</th>
                  <th>
                    <span className="sr-only">Decision</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-heading">
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : "—"}
                    </td>
                    <td className="text-secondary">{r.leaveType.name}</td>
                    <td className="whitespace-nowrap text-secondary">{formatDateRange(r.startDate, r.endDate)}</td>
                    <td className="text-secondary">{r.days}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" loading={busyId === r.id} onClick={() => decide(r, true)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="secondary" loading={busyId === r.id} onClick={() => decide(r, false)}>
                          Reject
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="c-section-title">My leave</h2>
        <Button
          variant={showForm ? "secondary" : "primary"}
          icon={showForm ? undefined : CalendarPlus}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Close form" : "Request leave"}
        </Button>
      </div>

      {showForm && schedule && (
        <LeaveRequestForm
          schedule={schedule}
          onCreated={() => {
            setShowForm(false);
            toast.success("Leave request submitted");
            load();
          }}
        />
      )}

      {mine.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarX2}
            title="No leave requests yet"
            description="When you need time off, request it here and it goes to your approver."
          />
        </Card>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
            <caption className="sr-only">My leave requests</caption>
            <thead>
              <tr>
                <th>Type</th>
                <th>Dates</th>
                <th>Days</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-heading">
                    {r.leaveType.name}
                    {!r.leaveType.paid && <span className="ml-2 c-tag">Unpaid</span>}
                  </td>
                  <td className="whitespace-nowrap text-secondary">{formatDateRange(r.startDate, r.endDate)}</td>
                  <td className="text-secondary">{r.days}</td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.routingNote && (
                      <p className="mt-1 max-w-xs text-xs text-warning">{r.routingNote}</p>
                    )}
                  </td>
                  <td className="text-right">
                    {(r.status === "PENDING" || r.status === "APPROVED") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger-text hover:bg-danger-soft hover:text-danger-text"
                        loading={busyId === r.id}
                        onClick={() => cancel(r)}
                      >
                        Cancel
                      </Button>
                    )}
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

function LeaveRequestForm({ schedule, onCreated }: { schedule: WorkSchedule; onCreated: () => void }) {
  const [leaveTypeId, setLeaveTypeId] = useState(schedule.leaveTypes[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = schedule.leaveTypes.find((t) => t.id === leaveTypeId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/leave-requests", { method: "POST", body: JSON.stringify({ leaveTypeId, startDate, endDate, reason }) });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (schedule.leaveTypes.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CalendarDays}
          title="No leave types are set up yet"
          description="An administrator adds them in Settings, under Company & HR rules."
        />
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="leave-type" className="c-label">
            Leave type
          </label>
          <select id="leave-type" required value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className="c-select">
            {schedule.leaveTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
                {lt.paid ? "" : " (unpaid)"}
              </option>
            ))}
          </select>
          {selected && !selected.paid && (
            <p className="mt-1 text-xs text-secondary">Unpaid leave reduces the paid days used for your payslip.</p>
          )}
        </div>
        <div className="hidden sm:block" />
        <div>
          <label htmlFor="leave-start" className="c-label">
            Start date
          </label>
          <input id="leave-start" required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="c-input" />
        </div>
        <div>
          <label htmlFor="leave-end" className="c-label">
            End date
          </label>
          <input
            id="leave-end"
            required
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="c-input"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="leave-reason" className="c-label">
            Reason <span className="font-normal text-secondary">(optional)</span>
          </label>
          <input id="leave-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="c-input" />
        </div>
        <p className="text-xs text-secondary sm:col-span-2">
          Only working days are counted. Weekly offs and holidays are not leave.
        </p>
        {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting} disabled={!leaveTypeId}>
            Submit request
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ─── Corrections ────────────────────────────────────────────────────── */

function CorrectionsTab({ startOpen = false }: { startOpen?: boolean }) {
  const { toast } = useFeedback();
  const [mine, setMine] = useState<AttendanceCorrection[]>([]);
  const [pending, setPending] = useState<AttendanceCorrection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(startOpen);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, p] = await Promise.all([
        apiFetch<AttendanceCorrection[]>("/attendance/corrections/me"),
        apiFetch<AttendanceCorrection[]>("/attendance/corrections/pending").catch(() => []),
      ]);
      setMine(m);
      setPending(p);
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

  async function decide(c: AttendanceCorrection, approve: boolean) {
    setBusyId(c.id);
    try {
      await apiFetch(`/attendance/corrections/${c.id}/${approve ? "approve" : "reject"}`, { method: "POST" });
      toast.success(approve ? "Correction approved" : "Correction rejected");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(c: AttendanceCorrection) {
    setBusyId(c.id);
    try {
      await apiFetch(`/attendance/corrections/${c.id}/cancel`, { method: "POST" });
      toast.success("Request cancelled");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <LoadingRows rows={4} />;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {pending.length > 0 && (
        <Card>
          <CardHeader title={`Waiting on you · ${pending.length}`} />
          <div className="c-table-wrap">
            <table className="c-table">
              <caption className="sr-only">Attendance corrections waiting on you</caption>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>Requested</th>
                  <th>Reason</th>
                  <th>
                    <span className="sr-only">Decision</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pending.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-heading">
                      {c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : "—"}
                    </td>
                    <td className="whitespace-nowrap text-secondary">{formatCalendarDate(c.date)}</td>
                    <td className="whitespace-nowrap text-secondary">
                      {c.requestedCheckInAt ? `in ${formatTime(c.requestedCheckInAt)}` : ""}
                      {c.requestedCheckOutAt ? ` out ${formatTime(c.requestedCheckOutAt)}` : ""}
                    </td>
                    <td className="max-w-xs truncate text-secondary">{c.reason}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" loading={busyId === c.id} onClick={() => decide(c, true)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="secondary" loading={busyId === c.id} onClick={() => decide(c, false)}>
                          Reject
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="c-section-title">My corrections</h2>
        <Button
          variant={showForm ? "secondary" : "primary"}
          icon={showForm ? undefined : ClipboardList}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Close form" : "Request a correction"}
        </Button>
      </div>

      {showForm && (
        <CorrectionForm
          onCreated={() => {
            setShowForm(false);
            toast.success("Correction requested");
            load();
          }}
        />
      )}

      {mine.length === 0 ? (
        <Card>
          <EmptyState
            icon={Clock}
            title="No corrections requested"
            description="If you forgot to check in or out on a past day, ask for it to be corrected here."
          />
        </Card>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
            <caption className="sr-only">My correction requests</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Requested</th>
                <th>Reason</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {mine.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap font-medium text-heading">{formatCalendarDate(c.date)}</td>
                  <td className="whitespace-nowrap text-secondary">
                    {c.requestedCheckInAt ? `in ${formatTime(c.requestedCheckInAt)}` : ""}
                    {c.requestedCheckOutAt ? ` out ${formatTime(c.requestedCheckOutAt)}` : ""}
                  </td>
                  <td className="max-w-xs truncate text-secondary">{c.reason}</td>
                  <td>
                    <StatusBadge status={c.status} />
                    {c.routingNote && <p className="mt-1 max-w-xs text-xs text-warning">{c.routingNote}</p>}
                    {c.decisionNote && <p className="mt-1 max-w-xs text-xs text-secondary">{c.decisionNote}</p>}
                  </td>
                  <td className="text-right">
                    {c.status === "PENDING" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger-text hover:bg-danger-soft hover:text-danger-text"
                        loading={busyId === c.id}
                        onClick={() => cancel(c)}
                      >
                        Cancel
                      </Button>
                    )}
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

function CorrectionForm({ onCreated }: { onCreated: () => void }) {
  const [date, setDate] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!checkIn && !checkOut) {
      setError("Give a corrected check-in time, a check-out time, or both.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/attendance/corrections", {
        method: "POST",
        body: JSON.stringify({
          date,
          ...(checkIn ? { requestedCheckInAt: new Date(`${date}T${checkIn}`).toISOString() } : {}),
          ...(checkOut ? { requestedCheckOutAt: new Date(`${date}T${checkOut}`).toISOString() } : {}),
          reason,
        }),
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
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="corr-date" className="c-label">
            Date
          </label>
          <input
            id="corr-date"
            required
            type="date"
            max={localIsoDate()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="c-input"
          />
        </div>
        <div>
          <label htmlFor="corr-in" className="c-label">
            Check in <span className="font-normal text-secondary">(optional)</span>
          </label>
          <input id="corr-in" type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="c-input" />
        </div>
        <div>
          <label htmlFor="corr-out" className="c-label">
            Check out <span className="font-normal text-secondary">(optional)</span>
          </label>
          <input id="corr-out" type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="c-input" />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="corr-reason" className="c-label">
            Reason
          </label>
          <input
            id="corr-reason"
            required
            minLength={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="c-input"
            placeholder="Why the recorded times are wrong"
          />
        </div>
        <p className="text-xs text-secondary sm:col-span-3">
          The day only changes once your approver accepts the correction.
        </p>
        {error && <p className="text-sm text-danger-text sm:col-span-3">{error}</p>}
        <div className="sm:col-span-3">
          <Button type="submit" loading={submitting} disabled={!date}>
            Send request
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ─── Work schedule ──────────────────────────────────────────────────── */

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function ScheduleTab() {
  const [schedule, setSchedule] = useState<WorkSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<WorkSchedule>("/attendance/schedule")
      .then(setSchedule)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingRows rows={3} />;
  if (!schedule) return <ErrorBanner message={error} />;

  const upcoming = schedule.holidays.filter((h) => h.date >= localIsoDate());

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Working days and hours" />
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="c-field">
              <dt>Working days</dt>
              <dd>{schedule.workingDays.map((d) => WEEKDAYS[d]).join(", ")}</dd>
            </div>
            <div className="c-field">
              <dt>Hours</dt>
              <dd>
                {schedule.workStartTime} – {schedule.workEndTime} ({schedule.fullDayHours}h day)
              </dd>
            </div>
            <div className="c-field">
              <dt>Time zone</dt>
              <dd>{schedule.timezone}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Holidays · ${upcoming.length} upcoming`} />
        {schedule.holidays.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No holidays set" description="An administrator adds them in Settings." />
        ) : (
          <div className="c-table-wrap">
            <table className="c-table">
              <caption className="sr-only">Company holidays</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Holiday</th>
                </tr>
              </thead>
              <tbody>
                {schedule.holidays.map((h) => (
                  <tr key={h.date}>
                    <td className="whitespace-nowrap font-medium text-heading">{formatCalendarDate(h.date)}</td>
                    <td className="text-secondary">{h.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Leave types and rules" />
        <CardBody className="space-y-3">
          <ul className="space-y-1 text-sm text-body">
            {schedule.leaveTypes.map((lt) => (
              <li key={lt.id}>
                <span className="font-medium text-heading">{lt.name}</span> · {lt.defaultDaysPerYear} day(s) a year ·{" "}
                {lt.paid ? "paid" : "unpaid"}
              </li>
            ))}
            {schedule.leaveTypes.length === 0 && <li className="text-secondary">No leave types are set up yet.</li>}
          </ul>
          <ul className="space-y-1 text-xs text-secondary">
            <li>Leave is counted in working days. Weekly offs and holidays are not leave.</li>
            <li>A working day is only marked absent once it has finished — before that it shows as not checked in.</li>
            <li>Requests go to your assigned manager, or to authorized HR. Nobody approves their own request.</li>
            <li>Approved leave that you cancel returns to your balance once.</li>
          </ul>
        </CardBody>
      </Card>

      <p className="text-xs text-secondary">
        Last updated {formatDateTime(new Date())}. Rules are configured in Settings, not on this screen.
      </p>
    </div>
  );
}
