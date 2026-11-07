"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarDays, CheckSquare, Clock, LogIn, LogOut, Megaphone, ShieldAlert, Sparkles } from "lucide-react";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate, formatTime, localIsoDate } from "@/components/format";
import { Button, Card, EmptyState, PageHeader, Skeleton } from "@/ui";
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
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        title={`${greeting()}${user?.employee ? `, ${user.employee.firstName}` : ""}`}
      />

      {user && !user.totpEnabled && (
        <div className="c-alert" data-tone="info">
          <ShieldAlert strokeWidth={2} aria-hidden />
          <span className="flex-1">Protect your account with two-factor authentication. It takes about a minute.</span>
          <Link href="/settings/security" className="c-link shrink-0">
            Turn on 2FA
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {user?.employee ? <TodayCard /> : null}

        <Card className="flex flex-col p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-secondary">
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
              <p className="text-sm text-secondary">Next approved {upcomingLeave.leaveType.name.toLowerCase()}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-secondary">No upcoming leave booked.</p>
          )}
          {pendingLeave > 0 && (
            <p className="mt-2 text-xs text-warning-text">
              {pendingLeave} request{pendingLeave === 1 ? "" : "s"} awaiting approval
            </p>
          )}
          <Link href="/my-leave" className="mt-auto inline-flex items-center gap-1 pt-4 text-sm c-link">
            Request leave <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>

        <Card className="flex flex-col p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-secondary">
            <CheckSquare className="h-4 w-4" /> Waiting on you
          </div>
          {pending.total > 0 ? (
            <div className="mt-3">
              <p className="c-stat-value">{pending.total}</p>
              <p className="text-sm text-secondary">
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
            <div className="mt-3 flex items-center gap-2 text-sm text-secondary">
              <Sparkles className="h-4 w-4 text-success" /> You&apos;re all caught up.
            </div>
          )}
          <Link href="/approvals" className="mt-auto inline-flex items-center gap-1 pt-4 text-sm c-link">
            Open approvals <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      </div>

      <section>
        <h2 className="c-section-title mb-3">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {quick.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="c-card group flex flex-col items-start gap-2 p-4 transition hover:border-accent hover:shadow-md"
            >
              <span className="flex size-9 items-center justify-center rounded-md bg-accent-soft text-accent-strong group-hover:bg-accent group-hover:text-on-accent">
                <item.icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-medium text-heading">{item.label.replace(/^My /, "")}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="c-section-title">Announcements</h2>
            <Link href="/announcements" className="text-xs c-link">
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
                  <Card className="p-4 transition hover:border-accent">
                    <p className="font-medium text-heading">{a.title}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-body">{a.body}</p>
                    <p className="mt-2 text-xs text-secondary">
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
            <h2 className="c-section-title mb-3">Manage</h2>
            <Card className="divide-y divide-line">
              {adminTools.map((item) => (
                <Link key={item.href} href={item.href} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted">
                  <item.icon className="h-4 w-4 text-secondary" />
                  <span className="flex-1">
                    <span className="font-medium text-heading">{item.label}</span>
                    <span className="block text-xs text-secondary">{item.description}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-secondary" />
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
        <div className="flex items-center gap-2 text-sm font-medium text-secondary">
          <Clock className="h-4 w-4" /> Today
        </div>
        {record !== undefined && (
          <span className="c-badge" data-tone={state === "in" ? "success" : state === "done" ? undefined : "warning"}>
            {state === "in" ? "Checked in" : state === "done" ? "Day complete" : "Not checked in"}
          </span>
        )}
      </div>
      {record === undefined ? (
        <Skeleton className="mt-3 h-12 w-full" />
      ) : (
        <p className="mt-3 text-sm text-body">
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
          <Link href="/my-attendance" className="c-back">
            View attendance <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </Card>
  );
}
