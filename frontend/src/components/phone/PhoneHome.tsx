"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Clock,
  Fingerprint,
  Headset,
  LifeBuoy,
  Receipt,
  UserCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AttendanceSummary, HelpDeskTicket, Payslip } from "@/lib/types";
import { Donut, LoadingRows } from "@/ui";
import { formatMoneyWhole } from "@/components/format";

/**
 * Home on a phone (the Android app and phone browsers), following the app
 * design: a greeting, four summary cards, this month's attendance ring, quick
 * actions, and for HR/Admin what is waiting on them. Same records as the
 * desktop Home, laid out for one hand.
 */

type Balance = { remaining: number };
type AdminSummary = {
  people: { today: { PRESENT: number; ON_LEAVE: number; ABSENT: number; NOT_CHECKED_IN: number; eligible: number } | null } | null;
  pending: { leave: number | null; corrections: number | null; tickets: number | null };
  payroll: { netTotal: number | null; status: string | null } | null;
  helpdesk: { open: number; inProgress: number; waiting: number } | null;
};
type Summary = AttendanceSummary & { today?: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function PhoneHome({ admin }: { admin: boolean }) {
  const { user } = useAuth();
  const hasEmployee = !!user?.employee;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [tickets, setTickets] = useState<HelpDeskTicket[]>([]);
  const [org, setOrg] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    Promise.all([
      hasEmployee ? apiFetch<Summary>(`/attendance/summary?month=${month}`).catch(() => null) : null,
      hasEmployee ? apiFetch<Balance[]>("/leave-types/me/balances").catch(() => []) : [],
      hasEmployee ? apiFetch<Payslip[]>("/payroll/me/payslips").catch(() => []) : [],
      hasEmployee ? apiFetch<HelpDeskTicket[]>("/helpdesk/me").catch(() => []) : [],
      admin ? apiFetch<AdminSummary>("/dashboard/admin").catch(() => null) : null,
    ]).then(([s, b, p, t, o]) => {
      setSummary(s);
      setBalances(b);
      setPayslip(p[0] ?? null);
      setTickets(t);
      setOrg(o);
      setLoading(false);
    });
  }, [admin, hasEmployee]);

  const firstName = user?.employee?.firstName ?? user?.email.split("@")[0] ?? "there";
  const now = new Date();
  const monthLabel = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  // Own day.
  const todayRecord = summary?.records.find((r) => r.date.slice(0, 10) === summary.today);
  const todayStatus = todayRecord?.checkInAt ? "Present" : "Not In Yet";
  const leaveDays = Math.round(balances.reduce((sum, b) => sum + Math.max(0, b.remaining), 0) * 10) / 10;
  const myOpenTickets = tickets.filter((t) => !["RESOLVED", "CLOSED"].includes(t.status)).length;

  // Organization (HR/Admin).
  const queueTickets = org?.helpdesk ? org.helpdesk.open + org.helpdesk.inProgress + org.helpdesk.waiting : null;
  const pendingTotal = (org?.pending.leave ?? 0) + (org?.pending.corrections ?? 0) + (org?.pending.tickets ?? 0);

  const cards: { href: string; icon: LucideIcon; tone?: string; label: string; value: string; valueClass?: string }[] = [];
  if (hasEmployee) {
    cards.push({ href: "/attendance", icon: UserCheck, label: "Today's Attendance", value: todayStatus, valueClass: todayRecord?.checkInAt ? "text-accent-strong" : "text-heading" });
    cards.push({ href: "/attendance?tab=leave", icon: CalendarDays, tone: "info", label: "Leave Balance", value: `${leaveDays} Days`, valueClass: "text-[color:var(--we-info-text)]" });
  } else if (org?.people?.today) {
    cards.push({ href: "/attendance", icon: UserCheck, label: "Present Today", value: `${org.people.today.PRESENT} / ${org.people.today.eligible}` });
    cards.push({ href: "/attendance?tab=leave", icon: CalendarDays, tone: "info", label: "Leave Requests", value: String(org.pending.leave ?? 0) });
  }
  cards.push({
    href: admin ? "/helpdesk?tab=queue" : "/helpdesk",
    icon: Headset,
    tone: "warning",
    label: "Open Tickets",
    value: String(admin && queueTickets !== null ? queueTickets : myOpenTickets),
  });
  if (admin && org?.payroll) {
    cards.push({
      href: "/payroll",
      icon: Wallet,
      label: "Payroll Summary",
      value: org.payroll.netTotal === null ? "Not run" : formatMoneyWhole(org.payroll.netTotal),
    });
  } else if (hasEmployee) {
    cards.push({ href: "/payslips", icon: Wallet, label: "Last Net Pay", value: payslip ? formatMoneyWhole(payslip.netPay) : "—" });
  }

  // This month's own attendance, over the working days so far.
  const present = summary?.PRESENT ?? 0;
  const onLeave = summary?.ON_LEAVE ?? 0;
  const absent = summary?.ABSENT ?? 0;
  const elapsed = present + onLeave + absent;
  const rate = elapsed ? Math.round((present / elapsed) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-heading">
            Hello {firstName} <span aria-hidden>👋</span>
          </h1>
          <p className="text-sm text-secondary">{admin ? "Here's your HR overview" : "Here's your work summary"}</p>
        </div>
        <span className="c-badge shrink-0" data-tone="brand">
          {monthLabel}
        </span>
      </div>

      {loading ? (
        <LoadingRows rows={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {cards.map((c) => (
              <Link key={c.label} href={c.href} className="c-card flex items-start gap-3 p-3.5 active:scale-[0.98]">
                <span className="c-icon-tile" data-size="sm" data-tone={c.tone} aria-hidden>
                  <c.icon strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium leading-tight text-secondary">{c.label}</span>
                  <span className={`mt-1 block text-base font-bold leading-tight [overflow-wrap:anywhere] ${c.valueClass ?? "text-heading"}`}>{c.value}</span>
                </span>
              </Link>
            ))}
          </div>

          {summary && (
            <section className="c-card p-4" aria-labelledby="att-overview">
              <div className="flex items-center justify-between gap-2">
                <h2 id="att-overview" className="text-base font-semibold text-heading">
                  Attendance Overview
                </h2>
                <span className="text-xs text-secondary">This month</span>
              </div>
              <div className="mt-3">
                <Donut
                  size={120}
                  thickness={14}
                  caption="My attendance this month"
                  centerLabel="Attendance"
                  centerValue={rate === null ? "—" : `${rate}%`}
                  slices={[
                    { label: "Present", value: present, color: "var(--we-chart-present)" },
                    { label: "On Leave", value: onLeave, color: "var(--we-chart-leave)" },
                    { label: "Absent", value: absent, color: "var(--we-chart-absent)" },
                  ]}
                />
              </div>
              <p className="mt-2 text-xs text-secondary">
                Present {present} of {elapsed} working day{elapsed === 1 ? "" : "s"} so far
              </p>
            </section>
          )}

          <section aria-labelledby="quick-actions">
            <h2 id="quick-actions" className="mb-2 text-base font-semibold text-heading">
              Quick Actions
            </h2>
            <div className="grid grid-cols-4 gap-2">
              <QuickAction href="/attendance" icon={Fingerprint} label="Mark Attendance" />
              <QuickAction href="/attendance?tab=leave&new=1" icon={CalendarPlus} label="Apply Leave" />
              <QuickAction href="/helpdesk?new=1" icon={Headset} label="Raise Ticket" />
              <QuickAction href="/payslips" icon={Receipt} label="View Payslip" />
            </div>
          </section>

          {admin && org && (
            <section className="c-card" aria-labelledby="waiting">
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 id="waiting" className="text-base font-semibold text-heading">
                  Waiting on You
                </h2>
                {pendingTotal > 0 && (
                  <span className="c-badge" data-tone="warning">
                    {pendingTotal}
                  </span>
                )}
              </div>
              <ul className="px-2 pb-2 pt-1">
                <PendingRow href="/attendance?tab=leave" icon={CalendarDays} label="Leave Requests" count={org.pending.leave} />
                <PendingRow href="/attendance?tab=corrections" icon={Clock} label="Attendance Corrections" count={org.pending.corrections} />
                <PendingRow href="/helpdesk?tab=queue" icon={LifeBuoy} label="Open Tickets" count={org.pending.tickets} />
              </ul>
            </section>
          )}

          {admin && org?.people?.today && (
            <Link href="/attendance" className="c-card flex items-center gap-3 p-4">
              <span className="c-icon-tile" data-size="sm" aria-hidden>
                <UserCheck strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-heading">Team Today</span>
                <span className="block text-xs text-secondary">
                  {org.people.today.PRESENT} present · {org.people.today.ON_LEAVE} on leave · {org.people.today.NOT_CHECKED_IN} not in yet
                </span>
              </span>
              <ChevronRight className="size-5 text-secondary" aria-hidden />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-[5.25rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-1 py-2.5 text-center text-xs font-semibold leading-tight text-heading active:scale-[0.97]"
    >
      <Icon className="size-6 text-accent-strong" strokeWidth={1.75} aria-hidden />
      {label}
    </Link>
  );
}

function PendingRow({ href, icon: Icon, label, count }: { href: string; icon: LucideIcon; label: string; count: number | null }) {
  if (count === null) return null;
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-body hover:bg-muted">
        <Icon className="size-5 text-secondary" strokeWidth={2} aria-hidden />
        <span className="flex-1">{label}</span>
        <span className="c-badge" data-tone={count > 0 ? "warning" : undefined}>
          {count}
        </span>
        <ChevronRight className="size-4 text-secondary" aria-hidden />
      </Link>
    </li>
  );
}
