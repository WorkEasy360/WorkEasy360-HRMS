"use client";

import { FormEvent, useEffect, useState } from "react";
import { Plus, Receipt } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { ExpenseClaim } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader, StatCard } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate, formatMoney } from "@/components/format";

export default function MyExpensesPage() {
  const { toast } = useFeedback();
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setClaims(await apiFetch<ExpenseClaim[]>("/expenses/me"));
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

  const sumOf = (list: ExpenseClaim[]) => list.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const pending = claims.filter((c) => c.status === "PENDING");
  const awaitingPayout = claims.filter((c) => c.status === "APPROVED");
  const reimbursed = claims.filter((c) => c.status === "REIMBURSED");

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="My Expenses"
        description="Submit expense claims and follow them through approval and reimbursement."
        actions={
          <Button
            variant={showForm ? "secondary" : "primary"}
            icon={showForm ? undefined : Plus}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Close form" : "New claim"}
          </Button>
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <ExpenseForm
          onCreated={() => {
            setShowForm(false);
            toast.success("Expense claim submitted");
            load();
          }}
        />
      )}

      {!loading && claims.length > 0 && (
        <div className="c-stats">
          <StatCard label="Pending" value={formatMoney(sumOf(pending))} hint={`${pending.length} claim(s)`} valueTone="warning" />
          <StatCard
            label="Awaiting payout"
            value={formatMoney(sumOf(awaitingPayout))}
            hint={`${awaitingPayout.length} claim(s)`}
            valueTone="info"
          />
          <StatCard
            label="Reimbursed"
            value={formatMoney(sumOf(reimbursed))}
            hint={`${reimbursed.length} claim(s)`}
            valueTone="success"
          />
        </div>
      )}

      {loading ? (
        <LoadingRows rows={4} />
      ) : claims.length === 0 ? (
        !loadError && (
          <Card>
            <EmptyState
              icon={Receipt}
              title="No expense claims yet"
              description="Spent money on work travel, meals or supplies? Submit a claim to get reimbursed."
              action={
                !showForm && (
                  <Button variant="secondary" icon={Plus} onClick={() => setShowForm(true)}>
                    New claim
                  </Button>
                )
              }
            />
          </Card>
        )
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap text-heading">{formatDate(c.expenseDate)}</td>
                  <td className="text-secondary">
                    {c.category}
                    {c.description && <span className="block text-xs text-secondary">{c.description}</span>}
                  </td>
                  <td className="whitespace-nowrap font-medium text-heading">{formatMoney(c.amount)}</td>
                  <td>
                    <StatusBadge status={c.status} />
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


function ExpenseForm({ onCreated }: { onCreated: () => void }) {
  const [category, setCategory] = useState("Travel");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/expenses", {
        method: "POST",
        body: JSON.stringify({ category, amount: Number(amount), expenseDate, description: description || undefined }),
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
          <label htmlFor="expense-category" className="c-label">
            Category
          </label>
          <select id="expense-category" value={category} onChange={(e) => setCategory(e.target.value)} className="c-select">
            <option value="Travel">Travel</option>
            <option value="Meals">Meals</option>
            <option value="Office Supplies">Office Supplies</option>
            <option value="Software">Software</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor="expense-amount" className="c-label">
            Amount (₹)
          </label>
          <input
            id="expense-amount"
            required
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="c-input"
          />
        </div>
        <div>
          <label htmlFor="expense-date" className="c-label">
            Expense date
          </label>
          <input
            id="expense-date"
            required
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className="c-input"
          />
        </div>
        <div>
          <label htmlFor="expense-description" className="c-label">
            Description <span className="font-normal text-secondary">(optional)</span>
          </label>
          <input id="expense-description" value={description} onChange={(e) => setDescription(e.target.value)} className="c-input" />
        </div>
        {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Submit claim
          </Button>
        </div>
      </form>
    </Card>
  );
}
