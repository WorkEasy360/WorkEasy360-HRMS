"use client";

import { FormEvent, useEffect, useState } from "react";
import { Inbox, LifeBuoy, MessageSquarePlus } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { HelpDeskTicket } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate } from "@/components/format";

const STATUS_LABELS: Record<HelpDeskTicket["status"], string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

const STATUS_STYLES: Record<HelpDeskTicket["status"], string> = {
  OPEN: "bg-amber-100 text-amber-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  RESOLVED: "bg-green-100 text-green-800",
  CLOSED: "bg-slate-100 text-slate-600",
};

export default function HelpDeskPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("helpdesk:manage");
  const { toast } = useFeedback();

  const [myTickets, setMyTickets] = useState<HelpDeskTicket[]>([]);
  const [allTickets, setAllTickets] = useState<HelpDeskTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [mine, all] = await Promise.all([
        apiFetch<HelpDeskTicket[]>("/helpdesk/me"),
        canManage ? apiFetch<HelpDeskTicket[]>("/helpdesk") : Promise.resolve([]),
      ]);
      setMyTickets(mine);
      setAllTickets(all);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  async function updateStatus(id: string, status: HelpDeskTicket["status"]) {
    setUpdatingId(id);
    try {
      await apiFetch(`/helpdesk/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast.success(`Ticket marked ${STATUS_LABELS[status].toLowerCase()}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUpdatingId(null);
    }
  }

  const openMine = myTickets.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS").length;
  const resolvedMine = myTickets.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length;

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Help Desk"
        description="Raise IT, HR, payroll or facilities issues and follow them to resolution."
        actions={
          <Button
            variant={showForm ? "secondary" : "primary"}
            icon={showForm ? undefined : MessageSquarePlus}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Close form" : "New ticket"}
          </Button>
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <TicketForm
          onCreated={() => {
            setShowForm(false);
            toast.success("Ticket submitted");
            load();
          }}
        />
      )}

      {!loading && myTickets.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <SummaryTile label="Open" value={openMine} tone="text-amber-600" />
          <SummaryTile label="Resolved" value={resolvedMine} tone="text-emerald-600" />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-500">My tickets</h2>
        {loading ? (
          <LoadingRows rows={3} />
        ) : myTickets.length === 0 ? (
          <Card>
            <EmptyState
              icon={LifeBuoy}
              title="No tickets yet"
              description="Having trouble with something? Raise a ticket and the right team will pick it up."
              action={
                !showForm && (
                  <Button icon={MessageSquarePlus} onClick={() => setShowForm(true)}>
                    New ticket
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          myTickets.map((t) => <TicketCard key={t.id} ticket={t} />)
        )}
      </section>

      {canManage && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-slate-500">All tickets</h2>
          {loading ? (
            <LoadingRows rows={3} />
          ) : allTickets.length === 0 ? (
            <Card>
              <EmptyState
                icon={Inbox}
                title="No tickets in the organization"
                description="Tickets raised by employees will appear here for you to triage."
              />
            </Card>
          ) : (
            allTickets.map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{t.subject}</p>
                    <p className="text-sm text-slate-500">
                      {t.employee?.firstName} {t.employee?.lastName} · {t.category} · {formatDate(t.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-600">{t.description}</p>
                  </div>
                  <div className="shrink-0">
                    <label htmlFor={`ticket-status-${t.id}`} className="sr-only">
                      Status
                    </label>
                    <select
                      id={`ticket-status-${t.id}`}
                      value={t.status}
                      disabled={updatingId === t.id}
                      onChange={(e) => updateStatus(t.id, e.target.value as HelpDeskTicket["status"])}
                      className="input w-auto py-1 text-xs"
                    >
                      <option value="OPEN">Open</option>
                      <option value="IN_PROGRESS">In progress</option>
                      <option value="RESOLVED">Resolved</option>
                      <option value="CLOSED">Closed</option>
                    </select>
                  </div>
                </div>
              </Card>
            ))
          )}
        </section>
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

function TicketCard({ ticket }: { ticket: HelpDeskTicket }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-medium text-slate-900">{ticket.subject}</p>
        <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[ticket.status]}`}>
          {STATUS_LABELS[ticket.status]}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {ticket.category} · Raised {formatDate(ticket.createdAt)}
        {ticket.resolvedAt && ` · Resolved ${formatDate(ticket.resolvedAt)}`}
      </p>
      <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-600">{ticket.description}</p>
    </Card>
  );
}

function TicketForm({ onCreated }: { onCreated: () => void }) {
  const [category, setCategory] = useState("IT");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/helpdesk", { method: "POST", body: JSON.stringify({ category, subject, description }) });
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
          <label htmlFor="ticket-category" className="label">
            Category
          </label>
          <select id="ticket-category" value={category} onChange={(e) => setCategory(e.target.value)} className="input">
            <option value="IT">IT</option>
            <option value="HR">HR</option>
            <option value="Payroll">Payroll</option>
            <option value="Facilities">Facilities</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor="ticket-subject" className="label">
            Subject
          </label>
          <input
            id="ticket-subject"
            required
            placeholder="e.g. VPN not connecting"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="input"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ticket-description" className="label">
            Description
          </label>
          <textarea
            id="ticket-description"
            required
            placeholder="Describe the issue…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="input"
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Submit ticket
          </Button>
        </div>
      </form>
    </Card>
  );
}
