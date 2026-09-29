"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarDays, CheckSquare, Clock, LogIn, LogOut, Megaphone, ShieldAlert, Sparkles } from "lucide-react";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate, formatTime, localIsoDate } from "@/components/format";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { canSee, NAV_GROUPS, type NavItem } from "@/lib/navigation";
import type { Announcement, AttendanceRecord, LeaveRequest } from "@/lib/types";
import { usePendingApprovals } from "@/lib/use-pending-approvals";

// Most-used self-service shortcuts first, then whatever admin tools the user has.
const QUICK_LINKS = ["/my-leave", "/my-attendance", "/my-payslips", "/my-expenses", "/helpdesk", "/my-timesheet"];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { user, hasPermission } = useAuth();
  const pending = usePendingApprovals();
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [leave, setLeave] = useState<LeaveRequest[] | null>(null);

  useEffect(() => {
    apiFetch<Announcement[]>("/announcements")
      .then((data) => setAnnouncements(data.slice(0, 3)))
      .catch(() => setAnnouncements([]));
    if (user?.employee) {
      apiFetch<LeaveRequest[]>("/leave-requests/me")
        .then(setLeave)
        .catch(() => setLeave([]));
    }
  }, [user?.employee]);

  const allItems = NAV_GROUPS.flatMap((g) => g.items).filter((i) => canSee(i, hasPermission));
  const quick = QUICK_LINKS.map((href) => allItems.find((i) => i.href === href)).filter((i): i is NavItem => !!i);
  const adminTools = NAV_GROUPS.filter((g) => g.title && !["My Workspace", "Settings"].includes(g.title))
    .flatMap((g) => g.items)
    .filter((i) => i.anyOf && canSee(i, hasPermission));

  const upcomingLeave = (leave ?? [])
    .filter((r) => r.status === "APPROVED" && r.endDate.slice(0, 10) >= localIsoDate())
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const pendingLeave = (leave ?? []).filter((r) => r.status === "PENDING").length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">
          {greeting()}
          {user?.employee ? `, ${user.employee.firstName}` : ""}
        </h1>
      </div>

      {user && !user.totpEnabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-center gap-3 text-sm text-blue-900">
            <ShieldAlert className="h-5 w-5 shrink-0 text-blue-600" />
            Protect your account with two-factor authentication. It takes about a minute.
          </div>
          <Link href="/settings/security" className="text-sm font-medium text-blue-700 hover:underline">
            Turn on 2FA
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {user?.employee ? <TodayCard /> : null}

        <Card className="flex flex-col p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <CalendarDays className="h-4 w-4" /> Time off
          </div>
          {leave === null ? (
            <Skeleton className="mt-3 h-12 w-full" />
          ) : upcomingLeave ? (
            <div className="mt-3">
              <p className="text-lg font-semibold">
                {formatDate(upcomingLeave.startDate)}
                {upcomingLeave.endDate !== upcomingLeave.startDate && ` – ${formatDate(upcomingLeave.endDate)}`}
              </p>
              <p className="text-sm text-slate-500">Next approved {upcomingLeave.leaveType.name.toLowerCase()}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No upcoming leave booked.</p>
          )}
          {pendingLeave > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              {pendingLeave} request{pendingLeave === 1 ? "" : "s"} awaiting approval
            </p>
          )}
          <Link href="/my-leave" className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-blue-600 hover:underline">
            Request leave <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>

        <Card className="flex flex-col p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <CheckSquare className="h-4 w-4" /> Waiting on you
          </div>
          {pending.total > 0 ? (
            <div className="mt-3">
              <p className="text-3xl font-semibold">{pending.total}</p>
              <p className="text-sm text-slate-500">
                {[
                  pending.leave && `${pending.leave} leave`,
                  pending.timesheets && `${pending.timesheets} timesheet`,
                  pending.expenses && `${pending.expenses} expense`,
                  pending.loans && `${pending.loans} loan`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <Sparkles className="h-4 w-4 text-emerald-500" /> You&apos;re all caught up.
            </div>
          )}
          <Link href="/approvals" className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-blue-600 hover:underline">
            Open approvals <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {quick.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white">
                <item.icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-medium text-slate-900">{item.label.replace(/^My /, "")}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Announcements</h2>
            <Link href="/announcements" className="text-xs font-medium text-blue-600 hover:underline">
              View all
            </Link>
          </div>
          {announcements === null ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : announcements.length === 0 ? (
            <Card>
              <EmptyState icon={Megaphone} title="No announcements yet" description="Company news will show up here." />
            </Card>
          ) : (
            <div className="space-y-2">
              {announcements.map((a) => (
                <Link key={a.id} href="/announcements" className="block">
                  <Card className="p-4 transition hover:border-blue-300">
                    <p className="font-medium text-slate-900">{a.title}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">{a.body}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      {a.author.firstName} {a.author.lastName} · {formatDate(a.publishedAt)}
                    </p>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        {adminTools.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Manage</h2>
            <Card className="divide-y divide-slate-100">
              {adminTools.map((item) => (
                <Link key={item.href} href={item.href} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <item.icon className="h-4 w-4 text-slate-400" />
                  <span className="flex-1">
                    <span className="font-medium text-slate-900">{item.label}</span>
                    <span className="block text-xs text-slate-500">{item.description}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-300" />
                </Link>
              ))}
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}

/** Check in / check out without leaving the dashboard. */
function TodayCard() {
  const { toast } = useFeedback();
  const [record, setRecord] = useState<AttendanceRecord | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const records = await apiFetch<AttendanceRecord[]>("/attendance/me");
      setRecord(records.find((r) => r.date.slice(0, 10) === localIsoDate()) ?? null);
    } catch {
      setRecord(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function punch(kind: "check-in" | "check-out") {
    setBusy(true);
    try {
      await apiFetch(`/attendance/${kind}`, { method: "POST" });
      toast.success(kind === "check-in" ? "Checked in. Have a great day!" : "Checked out. See you tomorrow!");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const state = !record?.checkInAt ? "out" : !record.checkOutAt ? "in" : "done";

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
          <Clock className="h-4 w-4" /> Today
        </div>
        {record !== undefined && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              state === "in" ? "bg-emerald-100 text-emerald-800" : state === "done" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"
            }`}
          >
            {state === "in" ? "Checked in" : state === "done" ? "Day complete" : "Not checked in"}
          </span>
        )}
      </div>
      {record === undefined ? (
        <Skeleton className="mt-3 h-12 w-full" />
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          {state === "out" && "You haven't checked in yet today."}
          {state === "in" && `In since ${formatTime(record!.checkInAt)}.`}
          {state === "done" && `${formatTime(record!.checkInAt)} – ${formatTime(record!.checkOutAt)}`}
        </p>
      )}
      <div className="mt-auto pt-4">
        {state === "out" && (
          <Button icon={LogIn} loading={busy} disabled={record === undefined} onClick={() => punch("check-in")} className="w-full">
            Check in
          </Button>
        )}
        {state === "in" && (
          <Button variant="secondary" icon={LogOut} loading={busy} onClick={() => punch("check-out")} className="w-full">
            Check out
          </Button>
        )}
        {state === "done" && (
          <Link href="/my-attendance" className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
            View attendance <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </Card>
  );
}
