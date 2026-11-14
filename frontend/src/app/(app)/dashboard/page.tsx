"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  Headset,
  LifeBuoy,
  LogIn,
  Megaphone,
  Receipt,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isAdminView } from "@/lib/navigation";
import type {
  Announcement,
  AttendanceSummary,
  DayStatus,
  HelpDeskTicket,
  HrPolicy,
  OnboardingTask,
  Payslip,
} from "@/lib/types";
import { MyCheckIn } from "@/components/MyCheckIn";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  Donut,
  EmptyState,
  LineTrend,
  LoadingRows,
  PageHeader,
  StatCard,
} from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatCalendarDate, formatDateTime, formatMoneyCompact, formatMoneyWhole, formatTime } from "@/components/format";

/**
 * Home (01). Two views of the same records: HR/Admin see the organization,
 * everyone else sees their own day. Quick actions are buttons, not menus.
 */
export default function HomePage() {
  const { hasPermission } = useAuth();
  return isAdminView(hasPermission) ? <AdminHome /> : <EmployeeHome />;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function DateChip() {
  const label = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return (
    <span className="c-date-nav">
      <span className="border-0">
        <CalendarDays className="size-icon text-secondary" strokeWidth={2} aria-hidden />
        {label}
      </span>
    </span>
  );
}

/* ═══ 1.1 HR / Admin ══════════════════════════════════════════════════ */

type AdminSummary = {
  today: string;
  people: {
    activeEmployees: number;
    joinedThisMonth: number;
    openJoiningTasks: number | null;
    today: (Record<DayStatus, number> & { isWorkingDay: boolean; holiday: string | null; eligible: number }) | null;
    monthAverageRate: number | null;
    trend: { date: string; rate: number | null; present: number; eligible: number }[];
  } | null;
  pending: { leave: number | null; corrections: number | null; tickets: number | null };
  payroll: { month: number; year: number; status: string | null; netTotal: number | null; payslips: number; published: number } | null;
  helpdesk: { open: number; inProgress: number; waiting: number; resolvedThisMonth: number } | null;
  hiring: { openJobs: number; activeApplications: number } | null;
  upcoming: { kind: "holiday" | "interview" | "payroll"; date: string; title: string; detail: string }[];
  recent: { id: string; action: string; entityType: string; actor: string | null; createdAt: string }[] | null;
};

const ACTION_LABELS: Record<string, string> = {
  "employee.update": "Employee details changed",
  "employee.exit_recorded": "Exit recorded",
  "employee.access_revoked": "HRMS access revoked",
  "employee.invite_sent": "Invitation sent",
  "payroll.finalize": "Payroll finalized",
  "payroll.publish": "Payslips published",
  "payroll.payslip_adjusted": "Payslip adjusted",
  "payroll.payslip_revised": "Payslip revised",
  "compensation.create": "Salary recorded",
  "role.update": "Role permissions changed",
  "role.assign": "Role granted",
  "role.unassign": "Role removed",
  "document.verify": "Document verified",
  "organization.update": "Company settings changed",
  "automation.update": "Automation rule changed",
  "integration.connection_created": "Integration connected",
};

function AdminHome() {
  const { hasPermission } = useAuth();
  const [data, setData] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AdminSummary>("/dashboard/admin")
      .then(setData)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const header = (
    <PageHeader
      icon={BarChart3}
      title="HRMS Dashboard"
      description="Overview of employees, attendance, payroll and HR operations."
      actions={<DateChip />}
    />
  );

  if (!data) {
    return (
      <div className="space-y-6">
        {header}
        {error ? <p className="c-alert" data-tone="danger">{error}</p> : <LoadingRows rows={6} />}
      </div>
    );
  }

  const p = data.people;
  const today = p?.today;
  const pendingTotal = (data.pending.leave ?? 0) + (data.pending.corrections ?? 0) + (data.pending.tickets ?? 0);
  const trendData = (p?.trend ?? []).map((d) => {
    const dt = new Date(`${d.date}T00:00:00Z`);
    return {
      label: `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`,
      value: d.rate,
      hint: d.rate === null ? undefined : `${d.present} of ${d.eligible} present`,
    };
  });

  const quickActions = [
    hasPermission("employee:write") && { href: "/employees?new=1", label: "Add Employee", icon: UserPlus },
    data.pending.leave !== null && { href: "/attendance?tab=leave", label: "Approve Leave", icon: CalendarCheck },
    hasPermission("payroll:manage") && { href: "/payroll", label: "Run Payroll", icon: Wallet },
    hasPermission("recruitment:manage") && { href: "/hiring", label: "Post Job", icon: Briefcase },
    hasPermission("announcement:manage") && { href: "/settings?tab=company", label: "Create Announcement", icon: Megaphone },
  ].filter(Boolean) as { href: string; label: string; icon: typeof UserPlus }[];

  return (
    <div className="space-y-6">
      {header}

      <MyCheckIn />

      <div className="c-stats" data-dense="true">
        {p && (
          <StatCard
            icon={Users}
            label="Total Employees"
            value={p.activeEmployees.toLocaleString()}
            hint={p.joinedThisMonth ? `${p.joinedThisMonth} joined this month` : "No joiners this month"}
          />
        )}
        {today && (
          <StatCard
            icon={CalendarCheck}
            label="Present Today"
            value={today.PRESENT}
            hint={
              today.isWorkingDay
                ? `of ${today.eligible} · ${today.eligible ? Math.round((today.PRESENT / today.eligible) * 100) : 0}%`
                : today.holiday ?? "Not a working day"
            }
          />
        )}
        {data.pending.leave !== null && (
          <StatCard icon={CalendarDays} iconTone="warning" label="Leave Requests" value={data.pending.leave} hint="Waiting on you" />
        )}
        {data.payroll && (
          <StatCard
            icon={Wallet}
            iconTone="info"
            label="Payroll This Month"
            value={
              data.payroll.netTotal === null ? (
                "—"
              ) : (
                <span title={formatMoneyWhole(data.payroll.netTotal)}>
                  <span aria-hidden>{formatMoneyCompact(data.payroll.netTotal)}</span>
                  <span className="sr-only">{formatMoneyWhole(data.payroll.netTotal)}</span>
                </span>
              )
            }
            hint={
              data.payroll.status === "FINALIZED"
                ? `Finalized · ${data.payroll.published} of ${data.payroll.payslips} published`
                : data.payroll.status === "DRAFT"
                  ? "Draft — not finalized"
                  : "Not started"
            }
          />
        )}
        {data.helpdesk && (
          <StatCard icon={Headset} iconTone="ai" label="Open Tickets" value={data.helpdesk.open} hint={`${data.helpdesk.inProgress} in progress`} />
        )}
        {data.hiring && (
          <StatCard
            icon={Briefcase}
            label="Open Jobs"
            value={data.hiring.openJobs}
            hint={`${data.hiring.activeApplications} active candidates`}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {p && (
          <Card className="xl:col-span-5">
            <CardHeader
              title={
                <span>
                  Attendance Trend
                  <span className="block text-sm font-normal text-secondary">Daily attendance rate this month</span>
                </span>
              }
              actions={
                p.monthAverageRate !== null && (
                  <span className="rounded-md bg-accent-soft px-3 py-1 text-right">
                    <span className="block text-xs text-accent-strong">Avg. attendance</span>
                    <span className="block text-lg font-semibold text-accent-strong">{p.monthAverageRate}%</span>
                  </span>
                )
              }
            />
            <CardBody className="pt-2">
              {trendData.some((d) => d.value !== null) ? (
                <LineTrend data={trendData} caption="Daily attendance rate this month" />
              ) : (
                <EmptyState icon={BarChart3} title="No working days yet" description="The trend starts on this month's first working day." />
              )}
            </CardBody>
          </Card>
        )}

        {today && (
          <Card className="xl:col-span-4">
            <CardHeader
              title={
                <span>
                  Employee Status
                  <span className="block text-sm font-normal text-secondary">Today, by the configured rules</span>
                </span>
              }
            />
            <CardBody>
              <Donut
                caption="Employee status today"
                centerLabel="Employees"
                centerValue={today.eligible}
                slices={[
                  { label: "Present", value: today.PRESENT, color: "var(--we-chart-present)" },
                  { label: "On Leave", value: today.ON_LEAVE, color: "var(--we-chart-leave)" },
                  { label: "Absent", value: today.ABSENT, color: "var(--we-chart-absent)" },
                  {
                    label: today.isWorkingDay ? "Not Yet Checked In" : "Day Off",
                    value: today.isWorkingDay ? today.NOT_CHECKED_IN : today.WEEKLY_OFF + today.HOLIDAY,
                    color: "var(--we-chart-pending)",
                  },
                ]}
              />
            </CardBody>
          </Card>
        )}

        <Card className={p ? "xl:col-span-3" : "xl:col-span-12"}>
          <CardHeader
            title="Pending Approvals"
            actions={
              <span className="c-badge" data-tone="brand">
                {pendingTotal}
              </span>
            }
          />
          <CardBody className="pt-1">
            {data.pending.leave !== null && (
              <PendingRow href="/attendance?tab=leave" icon={CalendarDays} label="Leave Approvals" count={data.pending.leave} />
            )}
            {data.pending.corrections !== null && (
              <PendingRow href="/attendance?tab=corrections" icon={Clock} label="Attendance Corrections" count={data.pending.corrections} />
            )}
            {data.pending.tickets !== null && (
              <PendingRow href="/helpdesk?tab=queue" icon={LifeBuoy} label="Open Tickets" count={data.pending.tickets} />
            )}
            {p?.openJoiningTasks != null && (
              <PendingRow href="/employees" icon={UserPlus} label="Joining Tasks Open" count={p.openJoiningTasks} />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-4">
          <CardHeader title="Quick Actions" />
          <CardBody className="pt-1">
            <div className="c-action-tiles">
              {quickActions.map((a) => (
                <Link key={a.href + a.label} href={a.href} className="c-action-tile">
                  <a.icon strokeWidth={1.75} aria-hidden />
                  {a.label}
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader title="Upcoming Activities" />
          <CardBody className="pt-1">
            {data.upcoming.length === 0 ? (
              <p className="py-6 text-center text-sm text-secondary">Nothing scheduled in the next few weeks.</p>
            ) : (
              data.upcoming.slice(0, 4).map((u) => {
                const d = new Date(u.date.length === 10 ? `${u.date}T00:00:00Z` : u.date);
                return (
                  <div key={u.kind + u.date + u.title} className="c-list-row">
                    <span className="flex w-12 shrink-0 flex-col items-center rounded-md bg-muted py-1 leading-tight">
                      <span className="text-xs text-secondary">{MONTHS[d.getUTCMonth()]}</span>
                      <span className="text-lg font-semibold text-heading">{d.getUTCDate()}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{u.title}</span>
                      <span className="block truncate text-sm font-normal text-secondary">{u.detail}</span>
                    </span>
                    <span className="c-badge" data-tone={u.kind === "payroll" ? "brand" : u.kind === "interview" ? "ai" : "info"}>
                      {u.kind === "payroll" ? "Payroll" : u.kind === "interview" ? "Hiring" : "Holiday"}
                    </span>
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader
            title="Recent Activities"
            actions={
              data.recent && (
                <Link href="/settings?tab=audit" className="c-link text-sm">
                  View all
                </Link>
              )
            }
          />
          <CardBody className="pt-1">
            {!data.recent ? (
              <p className="py-6 text-center text-sm text-secondary">Activity is visible to roles with audit access.</p>
            ) : data.recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-secondary">No recorded activity yet.</p>
            ) : (
              <ol className="space-y-3">
                {data.recent.map((r) => (
                  <li key={r.id} className="flex gap-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-heading">{ACTION_LABELS[r.action] ?? r.action}</span>
                      <span className="block truncate text-xs text-secondary">
                        {r.actor ?? "System"} · {formatDateTime(r.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {data.helpdesk && (
          <Card className="xl:col-span-5">
            <CardHeader
              title="Help Desk Summary"
              actions={
                <Link href="/helpdesk?tab=queue" className="c-link text-sm">
                  View tickets
                </Link>
              }
            />
            <CardBody>
              <dl className="grid grid-cols-4 divide-x divide-line text-center">
                {[
                  ["Open", data.helpdesk.open, "text-heading"],
                  ["In progress", data.helpdesk.inProgress, "text-info"],
                  ["Waiting", data.helpdesk.waiting, "text-warning"],
                  ["Resolved (month)", data.helpdesk.resolvedThisMonth, "text-success"],
                ].map(([label, value, cls]) => (
                  <div key={label as string} className="px-2">
                    <dd className={`text-2xl font-semibold ${cls}`}>{value}</dd>
                    <dt className="mt-1 text-xs text-secondary">{label}</dt>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        )}
        <div className={data.helpdesk ? "xl:col-span-7" : "xl:col-span-12"}>
          <AnnouncementsCard manageLink={hasPermission("announcement:manage")} />
        </div>
      </div>
    </div>
  );
}

function PendingRow({ href, icon: Icon, label, count }: { href: string; icon: typeof Clock; label: string; count: number }) {
  return (
    <Link href={href} className="c-list-row">
      <Icon className="size-icon text-secondary" strokeWidth={2} aria-hidden />
      <span className="flex-1">{label}</span>
      <span className="c-badge" data-tone={count > 0 ? "warning" : undefined}>
        {count}
      </span>
      <ChevronRight className="size-4 text-secondary" aria-hidden />
    </Link>
  );
}

/* ═══ 1.2 Employee ════════════════════════════════════════════════════ */

type Balance = { leaveTypeId: string; name: string; remaining: number; paid: boolean };

const LEAVE_COLORS = ["var(--we-chart-1)", "var(--we-chart-2)", "var(--we-chart-3)"];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
}

function EmployeeHome() {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [summary, setSummary] = useState<(AttendanceSummary & { days: { date: string; status: DayStatus; holiday: string | null }[]; today: string }) | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [tickets, setTickets] = useState<HelpDeskTicket[]>([]);
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [s, b, p, t, k] = await Promise.all([
      apiFetch<typeof summary>(`/attendance/summary?month=${month}`).catch(() => null),
      apiFetch<Balance[]>("/leave-types/me/balances").catch(() => []),
      apiFetch<Payslip[]>("/payroll/me/payslips").catch(() => []),
      apiFetch<HelpDeskTicket[]>("/helpdesk/me").catch(() => []),
      apiFetch<OnboardingTask[]>("/onboarding/me").catch(() => []),
    ]);
    setSummary(s);
    setBalances(b);
    setPayslip(p[0] ?? null);
    setTickets(t);
    setTasks(k);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
    // Working hours tick while checked in.
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function punch() {
    const which = todayRecord?.checkInAt && !todayRecord.checkOutAt ? "check-out" : "check-in";
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

  const firstName = user?.employee?.firstName ?? "there";
  const fullName = user?.employee ? `${user.employee.firstName} ${user.employee.lastName}` : (user?.email ?? "");
  const todayKey = summary?.today;
  const todayRecord = summary?.records.find((r) => r.date.slice(0, 10) === todayKey);

  const header = (
    <div className="c-page-header">
      <div className="c-title-row">
        <Avatar name={fullName} size="lg" />
        <div>
          <h1 className="c-title">
            {greeting()}, {firstName}! <span aria-hidden>👋</span>
          </h1>
          <p className="c-subtitle">Here&apos;s your work summary for today.</p>
        </div>
      </div>
      <DateChip />
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingRows rows={5} />
      </div>
    );
  }

  // Today's status card.
  const checkedIn = !!todayRecord?.checkInAt;
  const checkedOut = !!todayRecord?.checkOutAt;
  const statusText = checkedOut ? "Checked Out" : checkedIn ? "Checked In" : "Not Checked In";
  const statusHint = checkedOut
    ? `at ${formatTime(todayRecord!.checkOutAt)}`
    : checkedIn
      ? `at ${formatTime(todayRecord!.checkInAt)}`
      : "Check in when you start work";

  // Working hours: live while checked in.
  let hoursValue = "0h 0m";
  let hoursHint = "Not started";
  if (todayRecord?.checkInAt) {
    const end = todayRecord.checkOutAt ? new Date(todayRecord.checkOutAt) : new Date();
    const mins = Math.max(0, Math.round((end.getTime() - new Date(todayRecord.checkInAt).getTime()) / 60000));
    hoursValue = `${Math.floor(mins / 60)}h ${mins % 60}m`;
    hoursHint = `(${formatTime(todayRecord.checkInAt)} – ${todayRecord.checkOutAt ? formatTime(todayRecord.checkOutAt) : "Now"})`;
  }

  const totalLeave = Math.round(balances.reduce((sum, b) => sum + Math.max(0, b.remaining), 0) * 10) / 10;
  const payslipPeriod = payslip?.payrollRun ? `${MONTHS[payslip.payrollRun.month - 1]} ${payslip.payrollRun.year}` : null;

  // This week, Monday to Friday (or the configured working week).
  const week = (() => {
    if (!summary || !todayKey) return [];
    const t = new Date(`${todayKey}T00:00:00Z`);
    const dow = t.getUTCDay() === 0 ? 7 : t.getUTCDay();
    const monday = new Date(t.getTime() - (dow - 1) * 86_400_000);
    const byDate = new Map(summary.days.map((d) => [d.date, d]));
    return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86_400_000))
      .map((d) => ({ d, key: d.toISOString().slice(0, 10) }))
      .map(({ d, key }) => ({ d, key, day: byDate.get(key) }))
      .filter(({ day }) => !day || (day.status !== "WEEKLY_OFF"));
  })();

  // Leave donut: three slots, the rest folded into "Other".
  const positive = balances.filter((b) => b.remaining > 0);
  const slices = positive.slice(0, 3).map((b, i) => ({ label: b.name, value: b.remaining, color: LEAVE_COLORS[i] }));
  if (positive.length > 3) {
    slices.push({
      label: "Other",
      value: positive.slice(3).reduce((s, b) => s + b.remaining, 0),
      color: "var(--we-chart-pending)",
    });
  }

  const openTickets = tickets.filter((t) => t.status !== "RESOLVED" && t.status !== "CLOSED");
  const openTasks = tasks.filter((t) => !t.done);

  return (
    <div className="space-y-6">
      {header}

      <div className="c-stats">
        <StatCard
          icon={UserCheck}
          label="Today's Status"
          value={<span className={checkedIn && !checkedOut ? "text-success" : ""}>{statusText}</span>}
          hint={statusHint}
        />
        <StatCard icon={Clock} iconTone="info" label="Working Hours" value={hoursValue} hint={hoursHint} />
        <StatCard icon={CalendarDays} iconTone="ai" label="Leave Balance" value={`${totalLeave} Days`} hint="Available this year" />
        <div className="c-stat">
          <div className="c-icon-tile" data-tone="warning" aria-hidden>
            <Receipt strokeWidth={2} />
          </div>
          <div className="c-stat-body flex-1">
            <p className="c-stat-label">Latest Payslip</p>
            <p className="c-stat-value">{payslipPeriod ?? "None yet"}</p>
            {payslipPeriod && (
              <Link href="/payslips" className="c-btn-ghost c-btn-sm self-end bg-accent-soft text-accent-strong">
                View
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Quick Actions" />
          <CardBody className="pt-1">
            <div className="c-action-tiles">
              <button type="button" className="c-action-tile" onClick={punch} disabled={busy || checkedOut}>
                <LogIn strokeWidth={1.75} aria-hidden />
                {checkedOut ? "Done for Today" : checkedIn ? "Check Out" : "Check In"}
              </button>
              <Link href="/attendance?tab=leave" className="c-action-tile" data-tone="ai">
                <CalendarPlus strokeWidth={1.75} aria-hidden />
                Request Leave
              </Link>
              <Link href="/helpdesk?new=1" className="c-action-tile" data-tone="info">
                <Headset strokeWidth={1.75} aria-hidden />
                Raise Ticket
              </Link>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="My Attendance (This Week)"
            actions={
              <Link href="/attendance" className="c-link text-sm">
                View attendance
              </Link>
            }
          />
          <CardBody className="pt-1">
            <div className="c-week">
              {week.map(({ d, key, day }) => (
                <div key={key} className="c-week-day" data-today={key === todayKey}>
                  <WeekIcon status={day?.status} />
                  {d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}
                  <small>{d.toLocaleDateString(undefined, { day: "2-digit", month: "short", timeZone: "UTC" })}</small>
                  <span className="sr-only">{day ? day.status.replace(/_/g, " ").toLowerCase() : "upcoming"}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="My Leave"
            actions={
              <Link href="/attendance?tab=leave" className="c-link text-sm">
                View leave
              </Link>
            }
          />
          <CardBody>
            {slices.length === 0 ? (
              <EmptyState icon={CalendarX2} title="No leave available" description="Balances appear once HR sets up leave types." />
            ) : (
              <Donut caption="Leave available by type" slices={slices} centerValue={totalLeave} centerLabel="Days Available" />
            )}
          </CardBody>
        </Card>
        <AnnouncementsCard />
      </div>

      {(openTasks.length > 0 || openTickets.length > 0) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {openTasks.length > 0 && (
            <Card>
              <CardHeader
                title={`Joining Checklist · ${openTasks.length} open`}
                actions={
                  <Link href="/my-details?tab=checklist" className="c-link text-sm">
                    Open
                  </Link>
                }
              />
              <CardBody className="pt-1">
                {openTasks.slice(0, 4).map((t) => (
                  <div key={t.id} className="c-list-row">
                    <span className="flex-1">{t.title}</span>
                    {t.requiresVerification && <span className="c-tag">HR checks this</span>}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
          {openTickets.length > 0 && (
            <Card>
              <CardHeader
                title="My Tickets"
                actions={
                  <Link href="/helpdesk" className="c-link text-sm">
                    View all
                  </Link>
                }
              />
              <CardBody className="pt-1">
                {openTickets.slice(0, 4).map((t) => (
                  <Link key={t.id} href="/helpdesk" className="c-list-row">
                    <span className="min-w-0 flex-1 truncate">
                      {t.reference} · {t.subject}
                    </span>
                    <StatusBadge status={t.status} />
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function WeekIcon({ status }: { status?: DayStatus }) {
  if (status === "PRESENT") return <CircleCheck className="size-7 fill-success text-surface" strokeWidth={2} aria-hidden />;
  if (status === "ABSENT") return <CircleX className="size-7 text-danger" strokeWidth={2} aria-hidden />;
  if (status === "ON_LEAVE") return <CalendarDays className="size-7 text-info" strokeWidth={2} aria-hidden />;
  if (status === "HOLIDAY") return <CalendarX2 className="size-7 text-secondary" strokeWidth={2} aria-hidden />;
  return <Clock className="size-7 text-secondary" strokeWidth={2} aria-hidden />;
}

/* ═══ 1.2.4 Announcements and policies ════════════════════════════════ */

function AnnouncementsCard({ manageLink = false }: { manageLink?: boolean }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [policies, setPolicies] = useState<HrPolicy[]>([]);
  const [open, setOpen] = useState<{ title: string; body: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<Announcement[]>("/announcements").catch(() => []),
      apiFetch<HrPolicy[]>("/policies").catch(() => []),
    ]).then(([a, p]) => {
      setAnnouncements(a);
      setPolicies(p);
    });
  }, []);

  async function readPolicy(policy: HrPolicy) {
    try {
      const full = await apiFetch<HrPolicy>(`/policies/${policy.id}`);
      setOpen({ title: full.title, body: full.body ?? "" });
    } catch {
      setOpen({ title: policy.title, body: "" });
    }
  }

  const items = [
    ...announcements.map((a) => ({
      key: `a-${a.id}`,
      kind: "announcement" as const,
      title: a.title,
      text: a.body,
      date: a.publishedAt,
      onOpen: () => setOpen({ title: a.title, body: a.body }),
    })),
    ...policies.map((p) => ({
      key: `p-${p.id}`,
      kind: "policy" as const,
      title: p.title,
      text: p.category ? `HR policy · ${p.category}` : "HR policy",
      date: p.publishedAt ?? p.updatedAt,
      onOpen: () => readPolicy(p),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const shown = showAll ? items : items.slice(0, 3);

  return (
    <Card className="h-full">
      <CardHeader
        title="Announcements & Policies"
        actions={
          manageLink ? (
            <Link href="/settings?tab=company" className="c-link text-sm">
              Create new
            </Link>
          ) : items.length > 3 ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="c-link text-sm">
              {showAll ? "Show less" : "View all"}
            </button>
          ) : null
        }
      />
      <CardBody className="space-y-3 pt-1">
        {items.length === 0 ? (
          <EmptyState icon={Megaphone} title="Nothing published yet" description="Company updates and HR policies appear here." />
        ) : (
          shown.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onOpen}
              className="flex w-full items-start gap-3 rounded-lg border border-line p-3 text-left hover:border-line-strong"
            >
              <span className="c-icon-tile" data-size="sm" data-tone={item.kind === "policy" ? "info" : "warning"} aria-hidden>
                {item.kind === "policy" ? <FileText strokeWidth={2} /> : <Megaphone strokeWidth={2} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-heading">{item.title}</span>
                <span className="block truncate text-sm text-secondary">{item.text}</span>
              </span>
              <span className="shrink-0 text-xs text-secondary">{formatCalendarDate(item.date)}</span>
            </button>
          ))
        )}
      </CardBody>

      {open && (
        <div className="c-dialog z-50" onClick={() => setOpen(null)}>
          <div role="dialog" aria-modal="true" aria-label={open.title} className="c-dialog-panel" onClick={(e) => e.stopPropagation()}>
            <h2 className="c-dialog-title">{open.title}</h2>
            <p className="mt-4 whitespace-pre-wrap text-sm text-body">{open.body || "This item has no further text."}</p>
            <div className="mt-6 flex justify-end">
              <Button variant="secondary" onClick={() => setOpen(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
