"use client";

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Headset, LifeBuoy, MessageSquarePlus, Send, Ticket } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import type { HelpDeskReply, HelpDeskTicket, TicketQueue, TicketStatus } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDateTime } from "@/components/format";

/**
 * Helpdesk (06). The same shared Unified Helpdesk records, in two views: the
 * employee's own tickets, and the queues an authorized agent works in.
 *
 * Resolving a ticket never approves leave and never changes payroll.
 */

type Tab = "mine" | "queue";

const STATUS_FILTERS: (TicketStatus | "ALL")[] = ["ALL", "OPEN", "IN_PROGRESS", "WAITING", "RESOLVED"];

const QUEUE_LABEL: Record<TicketQueue, string> = {
  HR: "HR team",
  PAYROLL: "Payroll team",
  PRODUCT: "Product support",
};

export default function HelpdeskPage() {
  return (
    <Suspense fallback={<LoadingRows rows={5} />}>
      <Helpdesk />
    </Suspense>
  );
}

function Helpdesk() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) === "queue" ? "queue" : "mine");
  const [showForm, setShowForm] = useState(params.get("new") === "1");
  const [openId, setOpenId] = useState<string | null>(null);

  const [mine, setMine] = useState<HelpDeskTicket[]>([]);
  const [queue, setQueue] = useState<HelpDeskTicket[]>([]);
  const [queues, setQueues] = useState<TicketQueue[]>([]);
  const [status, setStatus] = useState<TicketStatus | "ALL">("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, q] = await Promise.all([
        apiFetch<HelpDeskTicket[]>("/helpdesk/me"),
        apiFetch<{ queues: TicketQueue[]; tickets: HelpDeskTicket[] }>("/helpdesk").catch(() => null),
      ]);
      setMine(m);
      setQueue(q?.tickets ?? []);
      setQueues(q?.queues ?? []);
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

  function select(next: Tab) {
    setTab(next);
    router.replace(next === "mine" ? "/helpdesk" : "/helpdesk?tab=queue", { scroll: false });
  }

  const isAgent = queues.length > 0;
  const rows = (tab === "mine" ? mine : queue).filter((t) => status === "ALL" || t.status === status);

  return (
    <div className="space-y-6">
      <PageHeader icon={Headset}
        title="Helpdesk"
        description="Ask HR a question, report a product problem, and follow the replies."
        actions={
          <Button
            variant={showForm ? "secondary" : "primary"}
            icon={showForm ? undefined : MessageSquarePlus}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Close form" : "Raise a ticket"}
          </Button>
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {showForm && (
        <RaiseTicketForm
          onCreated={(ticket) => {
            setShowForm(false);
            load();
            setOpenId(ticket.id);
          }}
        />
      )}

      {isAgent && (
        <div className="c-tabs" role="tablist" aria-label="Helpdesk views">
          <button role="tab" aria-selected={tab === "mine"} onClick={() => select("mine")} className="c-tab">
            My tickets
          </button>
          <button role="tab" aria-selected={tab === "queue"} onClick={() => select("queue")} className="c-tab">
            Team queue · {queues.map((q) => QUEUE_LABEL[q]).join(", ")}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            data-active={status === s}
            className="c-tab"
            aria-pressed={status === s}
          >
            {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingRows rows={5} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Ticket}
            title={tab === "mine" ? "No tickets yet" : "Nothing in your queue"}
            description={
              tab === "mine"
                ? "Raise a ticket when you have an HR question or hit a problem with the product."
                : "Tickets routed to your queue will appear here."
            }
          />
        </Card>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
            <caption className="sr-only">{tab === "mine" ? "My tickets" : "Team queue"}</caption>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Subject</th>
                {tab === "queue" && <th>Raised by</th>}
                <th>Goes to</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap font-medium text-heading">
                    <button type="button" onClick={() => setOpenId(t.id)} className="c-link">
                      {t.reference}
                    </button>
                  </td>
                  <td className="max-w-xs truncate text-body">{t.subject}</td>
                  {tab === "queue" && (
                    <td className="text-secondary">
                      {t.employee ? `${t.employee.firstName} ${t.employee.lastName}` : "—"}
                    </td>
                  )}
                  <td className="text-secondary">{QUEUE_LABEL[t.queue]}</td>
                  <td>
                    <StatusBadge status={t.status} />
                    {t.reopenRequestedAt && (
                      <span className="ml-1 c-badge" data-tone="warning">
                        Reopen asked
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-secondary">{formatDateTime(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && <TicketDialog ticketId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

/* ─── 6.1 Raise a ticket ─────────────────────────────────────────────── */

function RaiseTicketForm({ onCreated }: { onCreated: (t: HelpDeskTicket) => void }) {
  const { toast } = useFeedback();
  const [type, setType] = useState<"HR_QUESTION" | "PRODUCT_PROBLEM">("HR_QUESTION");
  const [aboutPayroll, setAboutPayroll] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const goesTo =
    type === "PRODUCT_PROBLEM"
      ? "WorkEasy360 product support"
      : aboutPayroll
        ? "your employer's payroll team"
        : "your employer's HR team";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const ticket = await apiFetch<HelpDeskTicket>("/helpdesk", {
        method: "POST",
        body: JSON.stringify({ type, ...(type === "HR_QUESTION" && aboutPayroll ? { aboutPayroll: true } : {}), subject, description }),
      });
      toast.success(`Ticket ${ticket.reference} raised · ${goesTo}`);
      onCreated(ticket);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="space-y-4">
        {/* 6.1.1 — the one choice that decides routing. */}
        <fieldset>
          <legend className="c-label">What is this about?</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
              <input type="radio" name="ticket-type" checked={type === "HR_QUESTION"} onChange={() => setType("HR_QUESTION")} />
              An HR question
            </label>
            <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
              <input
                type="radio"
                name="ticket-type"
                checked={type === "PRODUCT_PROBLEM"}
                onChange={() => {
                  setType("PRODUCT_PROBLEM");
                  setAboutPayroll(false);
                }}
              />
              A problem with WorkEasy360
            </label>
          </div>
        </fieldset>

        {type === "HR_QUESTION" && (
          <label className="flex items-center gap-2 text-sm text-body">
            <input
              type="checkbox"
              className="c-checkbox"
              checked={aboutPayroll}
              onChange={(e) => setAboutPayroll(e.target.checked)}
            />
            This is about my salary or payslip
          </label>
        )}

        <div>
          <label htmlFor="ticket-subject" className="c-label">
            Subject
          </label>
          <input id="ticket-subject" required value={subject} onChange={(e) => setSubject(e.target.value)} className="c-input" />
        </div>
        <div>
          <label htmlFor="ticket-description" className="c-label">
            Description
          </label>
          <textarea
            id="ticket-description"
            required
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="c-textarea"
          />
        </div>

        <p className="text-xs text-secondary">This goes to {goesTo}. You&apos;ll get a ticket number straight away.</p>
        {error && <p className="text-sm text-danger-text">{error}</p>}
        <Button type="submit" loading={submitting}>
          Submit ticket
        </Button>
      </form>
    </Card>
  );
}

/* ─── 6.2 / 6.3 One ticket and its thread ────────────────────────────── */

function TicketDialog({ ticketId, onClose, onChanged }: { ticketId: string; onClose: () => void; onChanged: () => void }) {
  const { toast } = useFeedback();
  const [data, setData] = useState<{ ticket: HelpDeskTicket; replies: HelpDeskReply[]; canAgent: boolean } | null>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escalating, setEscalating] = useState(false);
  const [summary, setSummary] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await apiFetch(`/helpdesk/${ticketId}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ticketId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function reply(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/helpdesk/${ticketId}/replies`, { method: "POST", body: JSON.stringify({ body, internal }) });
      setBody("");
      setInternal(false);
      await load();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: TicketStatus) {
    setBusy(true);
    try {
      await apiFetch(`/helpdesk/${ticketId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function requestReopen() {
    setBusy(true);
    try {
      await apiFetch(`/helpdesk/${ticketId}/request-reopen`, { method: "POST" });
      toast.success("Reopen requested");
      await load();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function escalate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const linked = await apiFetch<HelpDeskTicket>(`/helpdesk/${ticketId}/escalate`, {
        method: "POST",
        body: JSON.stringify({ summary }),
      });
      toast.success(`Escalated as ${linked.reference}`);
      setEscalating(false);
      setSummary("");
      await load();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const ticket = data?.ticket;
  const isAgent = data?.canAgent ?? false;
  const closed = ticket?.status === "RESOLVED" || ticket?.status === "CLOSED";

  return (
    <div className="c-dialog z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ticket ? `Ticket ${ticket.reference}` : "Ticket"}
        className="c-dialog-panel max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        {!ticket ? (
          <LoadingRows rows={3} />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="c-dialog-title">{ticket.subject}</h2>
                <p className="mt-1 text-xs text-secondary">
                  {ticket.reference} · {QUEUE_LABEL[ticket.queue]} · raised {formatDateTime(ticket.createdAt)}
                </p>
              </div>
              <StatusBadge status={ticket.status} />
            </div>

            {ticket.escalatedFrom && (
              <p className="c-alert mt-3" data-tone="info">
                Linked product case for {ticket.escalatedFrom.reference}. Only the reviewed summary was shared.
              </p>
            )}
            {ticket.escalations && ticket.escalations.length > 0 && (
              <p className="c-alert mt-3" data-tone="info">
                Escalated to product support as {ticket.escalations.map((e) => e.reference).join(", ")}.
              </p>
            )}

            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <article>
                <p className="text-xs text-secondary">
                  {ticket.employee ? `${ticket.employee.firstName} ${ticket.employee.lastName}` : "Requester"} ·{" "}
                  {formatDateTime(ticket.createdAt)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-body">{ticket.description}</p>
              </article>

              {(data?.replies ?? []).map((r) => (
                <article key={r.id} className={r.internal ? "rounded-md bg-muted p-3" : ""}>
                  <p className="text-xs text-secondary">
                    {r.author.firstName} {r.author.lastName} · {formatDateTime(r.createdAt)}
                    {r.internal && (
                      <span className="ml-2 c-badge" data-tone="warning">
                        Internal note
                      </span>
                    )}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-body">{r.body}</p>
                </article>
              ))}
            </div>

            <form onSubmit={reply} className="mt-4 space-y-2 border-t border-line pt-4">
              <label htmlFor="ticket-reply" className="c-label">
                Reply
              </label>
              <textarea
                id="ticket-reply"
                required
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="c-textarea"
              />
              {isAgent && (
                <label className="flex items-center gap-2 text-sm text-body">
                  <input type="checkbox" className="c-checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                  Internal note — not visible to the requester
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" icon={Send} loading={busy} disabled={!body.trim()}>
                  Send reply
                </Button>

                {isAgent && (
                  <>
                    <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => setStatus("IN_PROGRESS")}>
                      In progress
                    </Button>
                    <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => setStatus("WAITING")}>
                      Waiting on requester
                    </Button>
                    <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => setStatus("RESOLVED")}>
                      Resolve
                    </Button>
                    {ticket.queue !== "PRODUCT" && !ticket.escalations?.length && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        icon={ArrowUpRight}
                        onClick={() => setEscalating((v) => !v)}
                      >
                        Escalate to product support
                      </Button>
                    )}
                  </>
                )}

                {!isAgent && closed && !ticket.reopenRequestedAt && (
                  <Button type="button" size="sm" variant="secondary" loading={busy} onClick={requestReopen}>
                    Ask to reopen
                  </Button>
                )}
              </div>
            </form>

            {/* 6.3.3 — only the reviewed summary crosses the boundary. */}
            {escalating && (
              <form onSubmit={escalate} className="mt-4 space-y-2 rounded-md bg-muted p-3">
                <label htmlFor="escalate-summary" className="c-label">
                  Sanitized summary for product support
                </label>
                <textarea
                  id="escalate-summary"
                  required
                  rows={4}
                  minLength={10}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="c-textarea"
                  placeholder="Describe the fault without naming the employee or quoting private HR or payroll details."
                />
                <p className="text-xs text-secondary">
                  This creates a separate linked ticket. The private conversation above, and any payroll details in it, are not
                  copied across.
                </p>
                <Button type="submit" size="sm" icon={ArrowUpRight} loading={busy}>
                  Create linked product ticket
                </Button>
              </form>
            )}

            <p className="mt-4 text-xs text-secondary">
              Resolving a ticket does not approve leave or change payroll. Those keep their own approval workflow.
            </p>

            <div className="mt-4 flex justify-end">
              <Button variant="secondary" icon={LifeBuoy} onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
