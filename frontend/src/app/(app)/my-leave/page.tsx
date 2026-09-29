"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarPlus, CalendarX2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { LeaveRequest, LeaveType } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDateRange } from "@/components/format";

export default function MyLeavePage() {
  const { toast, confirm } = useFeedback();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [reqs, types] = await Promise.all([
        apiFetch<LeaveRequest[]>("/leave-requests/me"),
        apiFetch<LeaveType[]>("/leave-types"),
      ]);
      setRequests(reqs);
      setLeaveTypes(types);
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

  async function cancel(r: LeaveRequest) {
    const ok = await confirm({
      title: "Cancel this leave request?",
      description: `${r.leaveType.name}, ${formatDateRange(r.startDate, r.endDate)}. You can submit a new request later if needed.`,
      confirmLabel: "Cancel request",
      destructive: true,
    });
    if (!ok) return;
    setCancellingId(r.id);
    try {
      await apiFetch(`/leave-requests/${r.id}/cancel`, { method: "POST" });
      toast.success("Leave request cancelled");
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCancellingId(null);
    }
  }

  const pending = requests.filter((r) => r.status === "PENDING");
  const approved = requests.filter((r) => r.status === "APPROVED");
  const approvedDays = approved.reduce((sum, r) => sum + (Number(r.days) || 0), 0);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="My Leave"
        description="Request time off and track the status of your leave requests."
        actions={
          <Button
            variant={showForm ? "secondary" : "primary"}
            icon={showForm ? undefined : CalendarPlus}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Close form" : "Request leave"}
          </Button>
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <LeaveRequestForm
          leaveTypes={leaveTypes}
          onCreated={() => {
            setShowForm(false);
            toast.success("Leave request submitted");
            load();
          }}
        />
      )}

      {!loading && requests.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile label="Pending" value={pending.length} tone="text-amber-600" />
          <SummaryTile label="Approved" value={approved.length} tone="text-emerald-600" />
          <SummaryTile label="Days approved" value={approvedDays} tone="text-slate-900" />
        </div>
      )}

      {loading ? (
        <LoadingRows rows={4} />
      ) : requests.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarX2}
            title="No leave requests yet"
            description="When you need time off, submit a request and your manager will be notified to approve it."
            action={
              !showForm && (
                <Button icon={CalendarPlus} onClick={() => setShowForm(true)}>
                  Request leave
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
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-slate-900">{r.leaveType.name}</td>
                  <td className="whitespace-nowrap text-slate-500">{formatDateRange(r.startDate, r.endDate)}</td>
                  <td className="text-slate-500">{r.days}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="text-right">
                    {r.status === "PENDING" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        loading={cancellingId === r.id}
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

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </Card>
  );
}

function LeaveRequestForm({ leaveTypes, onCreated }: { leaveTypes: LeaveType[]; onCreated: () => void }) {
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/leave-requests", {
        method: "POST",
        body: JSON.stringify({ leaveTypeId, startDate, endDate, reason }),
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
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="leave-type" className="label">
            Leave type
          </label>
          <select id="leave-type" required value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className="input">
            {leaveTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </select>
        </div>
        <div className="hidden sm:block" />
        <div>
          <label htmlFor="leave-start" className="label">
            Start date
          </label>
          <input id="leave-start" required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="leave-end" className="label">
            End date
          </label>
          <input
            id="leave-end"
            required
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="leave-reason" className="label">
            Reason <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input id="leave-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="input" />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting} disabled={!leaveTypeId}>
            Submit request
          </Button>
        </div>
      </form>
    </Card>
  );
}
