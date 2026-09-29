"use client";

import { FormEvent, useEffect, useState } from "react";
import { HandCoins, Plus } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { LoanRequest } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatMoney } from "@/components/format";

export default function MyLoansPage() {
  const { toast } = useFeedback();
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setLoans(await apiFetch<LoanRequest[]>("/loans/me"));
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

  const pending = loans.filter((l) => l.status === "PENDING").length;
  const active = loans.filter((l) => l.status === "ACTIVE");
  const outstanding = active.reduce((sum, l) => sum + (Number(l.remainingAmount) || 0), 0);
  const monthlyEmi = active.reduce((sum, l) => sum + (Number(l.monthlyDeduction) || 0), 0);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="My Loans"
        description="Request salary advances and track repayments deducted from your pay."
        actions={
          <Button
            variant={showForm ? "secondary" : "primary"}
            icon={showForm ? undefined : Plus}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Close form" : "Request loan"}
          </Button>
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <LoanForm
          onCreated={() => {
            setShowForm(false);
            toast.success("Loan request submitted");
            load();
          }}
        />
      )}

      {!loading && loans.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryTile label="Pending" value={String(pending)} tone="text-amber-600" />
          <SummaryTile label="Outstanding" value={formatMoney(outstanding)} tone="text-slate-900" />
          <SummaryTile label="Monthly EMI" value={formatMoney(monthlyEmi)} tone="text-slate-900" />
        </div>
      )}

      {loading ? (
        <LoadingRows rows={3} />
      ) : loans.length === 0 ? (
        !loadError && (
          <Card>
            <EmptyState
              icon={HandCoins}
              title="No loan requests yet"
              description="Need a salary advance? Submit a request with the amount and number of EMIs, and HR will review it."
              action={
                !showForm && (
                  <Button icon={Plus} onClick={() => setShowForm(true)}>
                    Request loan
                  </Button>
                )
              }
            />
          </Card>
        )
      ) : (
        <div className="space-y-3">
          {loans.map((l) => (
            <Card key={l.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">
                  {formatMoney(l.amount)} over {l.emiMonths} months
                </p>
                <StatusBadge status={l.status} />
              </div>
              {l.reason && <p className="mt-1 text-sm text-slate-600">{l.reason}</p>}
              {(l.status === "ACTIVE" || l.status === "CLOSED") && (
                <p className="mt-2 text-xs text-slate-500">
                  {formatMoney(l.monthlyDeduction)}/month · {formatMoney(l.remainingAmount)} remaining
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </Card>
  );
}

function LoanForm({ onCreated }: { onCreated: () => void }) {
  const [amount, setAmount] = useState("");
  const [emiMonths, setEmiMonths] = useState("6");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/loans", {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), emiMonths: Number(emiMonths), reason: reason || undefined }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const perMonth = Number(amount) > 0 && Number(emiMonths) > 0 ? Number(amount) / Number(emiMonths) : null;

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="loan-amount" className="label">
            Amount (₹)
          </label>
          <input
            id="loan-amount"
            required
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="loan-emi" className="label">
            EMI months
          </label>
          <input
            id="loan-emi"
            required
            type="number"
            min="1"
            max="60"
            value={emiMonths}
            onChange={(e) => setEmiMonths(e.target.value)}
            className="input"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="loan-reason" className="label">
            Reason <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input id="loan-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="input" />
        </div>
        {perMonth !== null && (
          <p className="text-sm text-slate-500 sm:col-span-2">
            Approx. {formatMoney(Math.round(perMonth))} per month for {emiMonths} months (final amount set on approval).
          </p>
        )}
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Submit request
          </Button>
        </div>
      </form>
    </Card>
  );
}
