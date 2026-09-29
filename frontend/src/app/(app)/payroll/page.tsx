"use client";

import { FormEvent, useEffect, useState } from "react";
import { Banknote, CalendarPlus, HandCoins, Play, Receipt, Save } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Employee, ExpenseClaim, LoanRequest, PayrollRun, Payslip } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDateTime, formatMoney } from "@/components/format";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function PayrollPage() {
  const { toast, confirm } = useFeedback();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [expenses, setExpenses] = useState<ExpenseClaim[]>([]);
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payslipsByRun, setPayslipsByRun] = useState<Record<string, Payslip[]>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [reimbursingId, setReimbursingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [emps, r, exp, ln] = await Promise.all([
        apiFetch<Employee[]>("/employees"),
        apiFetch<PayrollRun[]>("/payroll"),
        apiFetch<ExpenseClaim[]>("/expenses"),
        apiFetch<LoanRequest[]>("/loans"),
      ]);
      setEmployees(emps);
      setRuns(r);
      setExpenses(exp);
      setLoans(ln);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function markReimbursed(e: ExpenseClaim) {
    const who = e.employee ? `${e.employee.firstName} ${e.employee.lastName}` : "the employee";
    const ok = await confirm({
      title: "Mark this claim as reimbursed?",
      description: `${formatMoney(e.amount)} ${e.category.toLowerCase()} claim for ${who}. Only do this once the money has been paid out.`,
      confirmLabel: "Mark reimbursed",
      destructive: false,
    });
    if (!ok) return;
    setReimbursingId(e.id);
    try {
      await apiFetch(`/expenses/${e.id}/mark-reimbursed`, { method: "POST" });
      toast.success("Expense marked as reimbursed");
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReimbursingId(null);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, []);

  async function processRun(run: PayrollRun) {
    const ok = await confirm({
      title: `Process payroll for ${MONTH_NAMES[run.month - 1]} ${run.year}?`,
      description: "Payslips will be generated for all employees with compensation, including loan deductions. This cannot be undone.",
      confirmLabel: "Process payroll",
      destructive: false,
    });
    if (!ok) return;
    setProcessingId(run.id);
    try {
      const result = await apiFetch<{ payslips: Payslip[] }>(`/payroll/${run.id}/process`, { method: "POST" });
      setPayslipsByRun((prev) => ({ ...prev, [run.id]: result.payslips }));
      toast.success(`Payroll processed for ${MONTH_NAMES[run.month - 1]} ${run.year}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProcessingId(null);
    }
  }

  async function viewPayslips(id: string) {
    setViewingId(id);
    try {
      const payslips = await apiFetch<Payslip[]>(`/payroll/${id}/payslips`);
      setPayslipsByRun((prev) => ({ ...prev, [id]: payslips }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setViewingId(null);
    }
  }

  function hidePayslips(id: string) {
    setPayslipsByRun((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const draftRuns = runs.filter((r) => r.status === "DRAFT").length;
  const toReimburse = expenses.filter((e) => e.status === "APPROVED");
  const activeLoans = loans.filter((l) => l.status === "ACTIVE");
  const loanOutstanding = activeLoans.reduce((sum, l) => sum + (Number(l.remainingAmount) || 0), 0);

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Payroll"
        description="Set compensation, run monthly payroll and settle expense claims and loans."
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {!loading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryTile label="Draft runs" value={String(draftRuns)} tone="text-amber-600" />
          <SummaryTile
            label="To reimburse"
            value={formatMoney(toReimburse.reduce((sum, e) => sum + (Number(e.amount) || 0), 0))}
            hint={`${toReimburse.length} approved claim(s)`}
            tone="text-blue-600"
          />
          <SummaryTile
            label="Loans outstanding"
            value={formatMoney(loanOutstanding)}
            hint={`${activeLoans.length} active loan(s)`}
            tone="text-slate-900"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <CompensationForm
          employees={employees}
          onSaved={() => toast.success("Compensation saved")}
        />

        <NewRunForm
          onCreated={() => {
            toast.success("Payroll run created");
            load();
          }}
        />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-500">Payroll runs</h2>
        {loading ? (
          <LoadingRows rows={3} />
        ) : runs.length === 0 ? (
          <Card>
            <EmptyState
              icon={Banknote}
              title="No payroll runs yet"
              description="Create a run for a month above, then process it to generate payslips for your employees."
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <Card key={run.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium text-slate-900">
                      {MONTH_NAMES[run.month - 1]} {run.year}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={run.status} />
                      {run.processedAt && (
                        <span className="text-xs text-slate-400">Processed {formatDateTime(run.processedAt)}</span>
                      )}
                    </div>
                  </div>
                  {run.status === "DRAFT" ? (
                    <Button size="sm" icon={Play} loading={processingId === run.id} onClick={() => processRun(run)}>
                      Process
                    </Button>
                  ) : payslipsByRun[run.id] ? (
                    <Button size="sm" variant="ghost" onClick={() => hidePayslips(run.id)}>
                      Hide payslips
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" loading={viewingId === run.id} onClick={() => viewPayslips(run.id)}>
                      View payslips
                    </Button>
                  )}
                </div>
                {payslipsByRun[run.id] && (
                  <div className="mt-3">
                    {payslipsByRun[run.id].length === 0 ? (
                      <p className="text-sm text-slate-500">No payslips were generated for this run.</p>
                    ) : (
                      <div className="table-wrap shadow-none">
                        <table>
                          <thead>
                            <tr>
                              <th>Employee</th>
                              <th>Gross</th>
                              <th>Deductions</th>
                              <th>Net</th>
                            </tr>
                          </thead>
                          <tbody>
                            {payslipsByRun[run.id].map((p) => (
                              <tr key={p.id}>
                                <td className="font-medium text-slate-900">
                                  {p.employee?.firstName} {p.employee?.lastName}
                                </td>
                                <td className="whitespace-nowrap text-slate-500">{formatMoney(p.grossPay)}</td>
                                <td className="whitespace-nowrap text-slate-500">{formatMoney(p.deductions)}</td>
                                <td className="whitespace-nowrap font-medium text-slate-900">{formatMoney(p.netPay)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-500">Expense claims</h2>
        {loading ? (
          <LoadingRows rows={3} />
        ) : expenses.length === 0 ? (
          <Card>
            <EmptyState
              icon={Receipt}
              title="No expense claims yet"
              description="Claims submitted by employees will appear here. Approved claims can be marked as reimbursed once paid."
            />
          </Card>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium text-slate-900">
                      {e.employee?.firstName} {e.employee?.lastName}
                    </td>
                    <td className="text-slate-500">{e.category}</td>
                    <td className="whitespace-nowrap text-slate-500">{formatMoney(e.amount)}</td>
                    <td>
                      <StatusBadge status={e.status} />
                    </td>
                    <td className="text-right">
                      {e.status === "APPROVED" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="whitespace-nowrap"
                          loading={reimbursingId === e.id}
                          onClick={() => markReimbursed(e)}
                        >
                          Mark reimbursed
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-500">Loans</h2>
        {loading ? (
          <LoadingRows rows={3} />
        ) : loans.length === 0 ? (
          <Card>
            <EmptyState
              icon={HandCoins}
              title="No loan requests yet"
              description="Loan requests from employees will appear here with their repayment progress."
            />
          </Card>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Amount</th>
                  <th>Remaining</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id}>
                    <td className="font-medium text-slate-900">
                      {l.employee?.firstName} {l.employee?.lastName}
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{formatMoney(l.amount)}</td>
                    <td className="whitespace-nowrap text-slate-500">{formatMoney(l.remainingAmount)}</td>
                    <td>
                      <StatusBadge status={l.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

function CompensationForm({ employees, onSaved }: { employees: Employee[]; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [annualCTC, setAnnualCTC] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/compensation", {
        method: "POST",
        body: JSON.stringify({ employeeId, effectiveFrom, annualCTC: Number(annualCTC) }),
      });
      setAnnualCTC("");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-medium text-slate-900">Set compensation</h2>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="comp-employee" className="label">
            Employee
          </label>
          <select id="comp-employee" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="input">
            <option value="">Select an employee…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="comp-effective" className="label">
            Effective from
          </label>
          <input
            id="comp-effective"
            required
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="comp-ctc" className="label">
            Annual CTC (₹)
          </label>
          <input
            id="comp-ctc"
            required
            type="number"
            min="1"
            value={annualCTC}
            onChange={(e) => setAnnualCTC(e.target.value)}
            className="input"
          />
          {Number(annualCTC) > 0 && (
            <p className="mt-1 text-xs text-slate-400">≈ {formatMoney(Math.round(Number(annualCTC) / 12))} per month</p>
          )}
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" icon={Save} loading={submitting}>
            Save compensation
          </Button>
        </div>
      </form>
    </Card>
  );
}

function NewRunForm({ onCreated }: { onCreated: () => void }) {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/payroll", { method: "POST", body: JSON.stringify({ month: Number(month), year: Number(year) }) });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-medium text-slate-900">Start a payroll run</h2>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="run-month" className="label">
            Month
          </label>
          <select id="run-month" value={month} onChange={(e) => setMonth(e.target.value)} className="input">
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="run-year" className="label">
            Year
          </label>
          <input id="run-year" required type="number" value={year} onChange={(e) => setYear(e.target.value)} className="input" />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" icon={CalendarPlus} loading={submitting}>
            Create run
          </Button>
        </div>
      </form>
    </Card>
  );
}
