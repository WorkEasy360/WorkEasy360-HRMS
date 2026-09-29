"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Check, Clock, HandCoins, Receipt, X, type LucideIcon } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ExpenseClaim, LeaveRequest, LoanRequest, TimesheetEntry } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate, formatDateRange, formatMoney } from "@/components/format";

type Employeeish = { employee?: { firstName: string; lastName: string; employeeCode: string } };

function employeeName(item: Employeeish): string {
  return item.employee ? `${item.employee.firstName} ${item.employee.lastName}` : "this employee";
}

export default function ApprovalsPage() {
  const { toast, confirm } = useFeedback();
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseClaim[]>([]);
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ key: string; approve: boolean } | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [leave, ts, exp, ln] = await Promise.all([
        apiFetch<LeaveRequest[]>("/leave-requests/pending-approvals"),
        apiFetch<TimesheetEntry[]>("/timesheets/pending-approvals"),
        apiFetch<ExpenseClaim[]>("/expenses/pending-approvals"),
        apiFetch<LoanRequest[]>("/loans/pending-approvals"),
      ]);
      setLeaveRequests(leave);
      setTimesheets(ts);
      setExpenses(exp);
      setLoans(ln);
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

  async function decide(basePath: string, id: string, approve: boolean, label: string, who: string) {
    if (!approve) {
      const ok = await confirm({
        title: `Reject this ${label.toLowerCase()}?`,
        description: `${who} will be notified that the ${label.toLowerCase()} was rejected. This cannot be undone.`,
        confirmLabel: "Reject",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy({ key: `${basePath}:${id}`, approve });
    try {
      await apiFetch(`${basePath}/${id}/${approve ? "approve" : "reject"}`, { method: "POST" });
      toast.success(`${label} ${approve ? "approved" : "rejected"}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const total = leaveRequests.length + timesheets.length + expenses.length + loans.length;

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Approvals"
        description={
          loading
            ? "Review requests from your team that are waiting on you."
            : total === 0
              ? "You're all caught up — nothing is waiting on you."
              : `${total} item${total === 1 ? "" : "s"} waiting for your review.`
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      <ApprovalSection
        title="Leave requests"
        icon={CalendarCheck}
        items={leaveRequests}
        loading={loading}
        emptyText="No leave requests waiting for your review."
        busy={busy}
        busyPrefix="/leave-requests"
        onDecide={(r, approve) => decide("/leave-requests", r.id, approve, "Leave request", employeeName(r))}
        renderDetail={(r) => (
          <>
            <EmployeeLine item={r} />
            <p className="text-sm text-slate-500">
              {r.leaveType.name} · {formatDateRange(r.startDate, r.endDate)} · {r.days} day(s)
            </p>
            {r.reason && <p className="mt-1 text-sm text-slate-600">&ldquo;{r.reason}&rdquo;</p>}
          </>
        )}
      />

      <ApprovalSection
        title="Timesheet entries"
        icon={Clock}
        items={timesheets}
        loading={loading}
        emptyText="No timesheet entries waiting for your review."
        busy={busy}
        busyPrefix="/timesheets"
        onDecide={(t, approve) => decide("/timesheets", t.id, approve, "Timesheet entry", employeeName(t))}
        renderDetail={(t) => (
          <>
            <EmployeeLine item={t} />
            <p className="text-sm text-slate-500">
              {formatDate(t.date)} · {t.hours}h{t.task ? ` · ${t.task}` : ""}
            </p>
          </>
        )}
      />

      <ApprovalSection
        title="Expense claims"
        icon={Receipt}
        items={expenses}
        loading={loading}
        emptyText="No expense claims waiting for your review."
        busy={busy}
        busyPrefix="/expenses"
        onDecide={(e, approve) => decide("/expenses", e.id, approve, "Expense claim", employeeName(e))}
        renderDetail={(e) => (
          <>
            <EmployeeLine item={e} />
            <p className="text-sm text-slate-500">
              {e.category} · {formatMoney(e.amount)} · {formatDate(e.expenseDate)}
            </p>
            {e.description && <p className="mt-1 text-sm text-slate-600">{e.description}</p>}
          </>
        )}
      />

      <ApprovalSection
        title="Loan requests"
        icon={HandCoins}
        items={loans}
        loading={loading}
        emptyText="No loan requests waiting for your review."
        busy={busy}
        busyPrefix="/loans"
        onDecide={(l, approve) => decide("/loans", l.id, approve, "Loan request", employeeName(l))}
        renderDetail={(l) => (
          <>
            <EmployeeLine item={l} />
            <p className="text-sm text-slate-500">
              {formatMoney(l.amount)} over {l.emiMonths} months
            </p>
            {l.reason && <p className="mt-1 text-sm text-slate-600">{l.reason}</p>}
          </>
        )}
      />
    </div>
  );
}

function EmployeeLine({ item }: { item: Employeeish }) {
  return (
    <p className="font-medium text-slate-900">
      {item.employee?.firstName} {item.employee?.lastName}{" "}
      <span className="font-normal text-slate-500">({item.employee?.employeeCode})</span>
    </p>
  );
}

function ApprovalSection<T extends { id: string }>({
  title,
  icon,
  items,
  loading,
  emptyText,
  busy,
  busyPrefix,
  onDecide,
  renderDetail,
}: {
  title: string;
  icon: LucideIcon;
  items: T[];
  loading: boolean;
  emptyText: string;
  busy: { key: string; approve: boolean } | null;
  busyPrefix: string;
  onDecide: (item: T, approve: boolean) => void;
  renderDetail: (item: T) => React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-slate-500">
        {title}
        {!loading && items.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{items.length}</span>
        )}
      </h2>
      {loading ? (
        <LoadingRows rows={2} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={icon} title="Nothing pending" description={emptyText} />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isBusy = busy?.key === `${busyPrefix}:${item.id}`;
            return (
              <Card key={item.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">{renderDetail(item)}</div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      icon={Check}
                      loading={isBusy && busy?.approve}
                      disabled={isBusy}
                      onClick={() => onDecide(item, true)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={X}
                      className="text-red-600 hover:text-red-700"
                      loading={isBusy && !busy?.approve}
                      disabled={isBusy}
                      onClick={() => onDecide(item, false)}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
