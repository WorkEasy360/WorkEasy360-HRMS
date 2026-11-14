"use client";

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, Calculator, CheckCircle2, CreditCard, MinusCircle, Send, Users, Wallet } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { CompensationRecord, Employee, PayrollRun, Payslip } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { PhonePayslip } from "@/components/phone/PhonePayslip";
import { useIsPhone } from "@/lib/use-phone";
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorBanner, LoadingRows, PageHeader, StatCard } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatCalendarDate, formatMoney, formatMoneyWhole, localIsoDate } from "@/components/format";

/**
 * Payroll (04). Salary details, the monthly run and payslips.
 *
 * The flow is deliberately review-and-confirm: prepare → review and adjust →
 * finalize → publish. A finalized payroll never changes silently; a correction
 * is a new payslip revision that keeps the original.
 */

type Tab = "payslip" | "salary" | "runs";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default function PayrollPage() {
  return (
    <Suspense fallback={<LoadingRows rows={5} />}>
      <Payroll />
    </Suspense>
  );
}

function Payroll() {
  const { hasPermission, user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const isPhone = useIsPhone();
  const canRun = hasPermission("payroll:manage");
  const canSetSalary = hasPermission("compensation:manage");
  // Phones put the person's own payslip first, as in the app design.
  const hasOwnPayslip = isPhone && !!user?.employee;
  const requested = params.get("tab") as Tab | null;
  const tab: Tab =
    requested === "salary" && canSetSalary
      ? "salary"
      : requested === "runs" && canRun
        ? "runs"
        : hasOwnPayslip && (requested === "payslip" || !requested)
          ? "payslip"
          : canRun
            ? "runs"
            : "salary";

  return (
    <div className="space-y-6">
      <PageHeader icon={CreditCard} title="Payroll" description="Salary details, the monthly payroll run and payslips." />

      <div className="c-tabs" role="tablist" aria-label="Payroll">
        {hasOwnPayslip && (
          <button role="tab" aria-selected={tab === "payslip"} onClick={() => router.replace("/payroll?tab=payslip", { scroll: false })} className="c-tab">
            Payslip
          </button>
        )}
        {canSetSalary && (
          <button role="tab" aria-selected={tab === "salary"} onClick={() => router.replace("/payroll?tab=salary", { scroll: false })} className="c-tab">
            {isPhone ? "Salary" : "Salary details"}
          </button>
        )}
        {canRun && (
          <button role="tab" aria-selected={tab === "runs"} onClick={() => router.replace("/payroll?tab=runs", { scroll: false })} className="c-tab">
            {isPhone ? "Payroll" : "Monthly payroll"}
          </button>
        )}
      </div>

      {tab === "payslip" ? <PhonePayslip /> : tab === "salary" ? <SalaryTab /> : <RunsTab />}
    </div>
  );
}

/* ─── 4.1 Salary details ─────────────────────────────────────────────── */

function SalaryTab() {
  const { toast } = useFeedback();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [history, setHistory] = useState<CompensationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Employee[]>("/employees")
      .then(setEmployees)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const loadHistory = useCallback(async (id: string) => {
    if (!id) {
      setHistory([]);
      return;
    }
    try {
      setHistory(await apiFetch<CompensationRecord[]>(`/compensation/${id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reloads when the employee changes
    loadHistory(employeeId);
  }, [employeeId, loadHistory]);

  if (loading) return <LoadingRows rows={4} />;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <Card>
        <CardHeader title="Employee earnings" />
        <CardBody className="space-y-4">
          <div className="max-w-sm">
            <label htmlFor="sal-employee" className="c-label">
              Employee
            </label>
            <select id="sal-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="c-select">
              <option value="">Choose an employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName} ({e.employeeCode})
                </option>
              ))}
            </select>
          </div>

          {employeeId && (
            <CompensationForm
              employeeId={employeeId}
              onSaved={() => {
                toast.success("Salary recorded");
                loadHistory(employeeId);
              }}
            />
          )}
        </CardBody>
      </Card>

      {employeeId && (
        <Card>
          <CardHeader title="Salary history" />
          {history.length === 0 ? (
            <EmptyState icon={Wallet} title="No salary on file" description="Record one so this employee can be paid." />
          ) : (
            <div className="c-table-wrap">
              <table className="c-table">
                <caption className="sr-only">Salary history</caption>
                <thead>
                  <tr>
                    <th>Effective from</th>
                    <th>Annual CTC</th>
                    <th>Monthly gross</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((c) => (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap font-medium text-heading">{formatCalendarDate(c.effectiveFrom)}</td>
                      <td className="text-secondary">{formatMoney(c.annualCTC, c.currency)}</td>
                      <td className="text-secondary">{formatMoney(c.monthlyGross, c.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <CardBody>
            <p className="text-xs text-secondary">
              Payroll uses the record in force on each day of the period, so a mid-month change is prorated automatically.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function CompensationForm({ employeeId, onSaved }: { employeeId: string; onSaved: () => void }) {
  const [effectiveFrom, setEffectiveFrom] = useState(localIsoDate());
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
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div>
        <label htmlFor="comp-from" className="c-label">
          Effective from
        </label>
        <input id="comp-from" required type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="c-input" />
      </div>
      <div>
        <label htmlFor="comp-ctc" className="c-label">
          Annual CTC
        </label>
        <input
          id="comp-ctc"
          required
          type="number"
          min={0}
          step={1000}
          value={annualCTC}
          onChange={(e) => setAnnualCTC(e.target.value)}
          className="c-input"
        />
      </div>
      <div className="flex items-end">
        <Button type="submit" loading={submitting} disabled={!annualCTC}>
          Save salary
        </Button>
      </div>
      {error && <p className="text-sm text-danger-text sm:col-span-3">{error}</p>}
    </form>
  );
}

/* ─── 4.2 / 4.3 Monthly payroll and payslips ─────────────────────────── */

function RunsTab() {
  const { toast, confirm } = useFeedback();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selected, setSelected] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revising, setRevising] = useState<Payslip | null>(null);

  const loadRuns = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<PayrollRun[]>("/payroll");
      setRuns(data);
      setSelected((prev) => (prev ? (data.find((r) => r.id === prev.id) ?? null) : (data[0] ?? null)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPayslips = useCallback(async (runId: string) => {
    try {
      setPayslips(await apiFetch<Payslip[]>(`/payroll/${runId}/payslips`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reloads when the run changes
    if (selected) loadPayslips(selected.id);
    else setPayslips([]);
  }, [selected, loadPayslips]);

  async function act(path: string, success: string, ask?: { title: string; description: string }) {
    if (ask) {
      const ok = await confirm({ ...ask, confirmLabel: "Continue", destructive: false });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await apiFetch(path, { method: "POST" });
      toast.success(success);
      await loadRuns();
      if (selected) await loadPayslips(selected.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingRows rows={5} />;

  const current = payslips.filter((p) => !p.supersededAt);
  const totals = current.reduce(
    (acc, p) => ({ gross: acc.gross + p.grossPay, deductions: acc.deductions + p.deductions, net: acc.net + p.netPay }),
    { gross: 0, deductions: 0, net: 0 },
  );
  const unpublished = current.filter((p) => !p.publishedAt).length;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <NewRunForm
        existing={runs}
        onCreated={async (run) => {
          toast.success("Payroll period created");
          await loadRuns();
          setSelected(run);
        }}
      />

      {runs.length === 0 ? (
        <Card>
          <EmptyState icon={CreditCard} title="No payroll periods yet" description="Create one for the month you want to pay." />
        </Card>
      ) : (
        <>
          <div className="max-w-sm">
            <label htmlFor="run-select" className="c-label">
              Period
            </label>
            <select
              id="run-select"
              value={selected?.id ?? ""}
              onChange={(e) => setSelected(runs.find((r) => r.id === e.target.value) ?? null)}
              className="c-select"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {MONTHS[r.month - 1]} {r.year} — {r.status === "FINALIZED" ? "finalized" : "draft"}
                </option>
              ))}
            </select>
          </div>

          {selected && (
            <>
              <div className="c-stats" data-dense="true">
                <StatCard icon={Users} label="Employees" value={current.length} />
                <StatCard icon={Wallet} iconTone="info" label="Gross" value={formatMoneyWhole(totals.gross)} />
                <StatCard icon={MinusCircle} iconTone="warning" label="Deductions" value={formatMoneyWhole(totals.deductions)} />
                <StatCard icon={CreditCard} iconTone="ai" label="Net" value={formatMoneyWhole(totals.net)} />
                <StatCard icon={BadgeCheck} label="Status" value={<StatusBadge status={selected.status} />} />
              </div>

              <div className="flex flex-wrap gap-2">
                {selected.status === "DRAFT" && (
                  <>
                    <Button
                      icon={Calculator}
                      loading={busy}
                      onClick={() =>
                        act(`/payroll/${selected.id}/prepare`, "Payroll prepared", {
                          title: "Prepare this payroll?",
                          description:
                            "Recalculates every eligible employee from their salary records, joining and exit dates, the work schedule and approved unpaid leave. Any adjustments you made to this draft are replaced.",
                        })
                      }
                    >
                      Prepare / recalculate
                    </Button>
                    <Button
                      variant="secondary"
                      icon={CheckCircle2}
                      loading={busy}
                      disabled={current.length === 0}
                      onClick={() =>
                        act(`/payroll/${selected.id}/finalize`, "Payroll finalized", {
                          title: "Finalize this payroll?",
                          description:
                            "After this, amounts can only be corrected through a payslip revision that keeps the original on record.",
                        })
                      }
                    >
                      Finalize
                    </Button>
                  </>
                )}
                {selected.status === "FINALIZED" && unpublished > 0 && (
                  <Button
                    icon={Send}
                    loading={busy}
                    onClick={() =>
                      act(`/payroll/${selected.id}/publish`, "Payslips published", {
                        title: "Publish payslips?",
                        description:
                          "Employees will be able to read their payslip and will be emailed. Publishing does not mean the salary has been paid.",
                      })
                    }
                  >
                    Publish {unpublished} payslip{unpublished === 1 ? "" : "s"}
                  </Button>
                )}
              </div>

              {selected.status === "FINALIZED" && (
                <p className="c-alert" data-tone="info">
                  This payroll is finalized. Corrections create a new payslip revision that references the original.
                </p>
              )}

              {payslips.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={Calculator}
                    title="Nothing prepared yet"
                    description="Prepare the payroll to work out each eligible employee's pay for this period."
                  />
                </Card>
              ) : (
                <div className="c-table-wrap">
                  <table className="c-table">
                    <caption className="sr-only">Payslips for this period</caption>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Paid days</th>
                        <th>Gross</th>
                        <th>Deductions</th>
                        <th>Net</th>
                        <th>Published</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {payslips.map((p) => (
                        <tr key={p.id} className={p.supersededAt ? "opacity-60" : ""}>
                          <td className="font-medium text-heading">
                            {p.employee ? `${p.employee.firstName} ${p.employee.lastName}` : "—"}
                            {p.revisionNumber > 1 && (
                              <span className="ml-2 c-badge" data-tone="info">
                                Rev {p.revisionNumber}
                              </span>
                            )}
                            {p.supersededAt && <span className="ml-2 c-tag">superseded</span>}
                          </td>
                          <td className="text-secondary">
                            {p.paidDays} of {p.payableDays}
                          </td>
                          <td className="text-secondary">{formatMoney(p.grossPay)}</td>
                          <td className="text-secondary">{formatMoney(p.deductions)}</td>
                          <td className="font-medium text-heading">{formatMoney(p.netPay)}</td>
                          <td className="text-secondary">{p.publishedAt ? formatCalendarDate(p.publishedAt) : "—"}</td>
                          <td className="text-right">
                            {!p.supersededAt && selected.status === "DRAFT" && (
                              <AdjustButton
                                payslip={p}
                                runId={selected.id}
                                onSaved={() => {
                                  toast.success("Adjustment recorded");
                                  loadPayslips(selected.id);
                                }}
                              />
                            )}
                            {!p.supersededAt && selected.status === "FINALIZED" && (
                              <Button variant="ghost" size="sm" onClick={() => setRevising(p)}>
                                Revise
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-secondary">
                No statutory deduction is applied automatically. Only explicitly approved deductions, recorded as adjustments
                during review, appear on a payslip.
              </p>
            </>
          )}
        </>
      )}

      {revising && selected && (
        <ReviseDialog
          payslip={revising}
          runId={selected.id}
          onClose={() => setRevising(null)}
          onSaved={() => {
            setRevising(null);
            toast.success("Revision recorded");
            loadPayslips(selected.id);
          }}
        />
      )}
    </div>
  );
}

function NewRunForm({ existing, onCreated }: { existing: PayrollRun[]; onCreated: (run: PayrollRun) => void }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const duplicate = existing.some((r) => r.month === month && r.year === year);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onCreated(await apiFetch<PayrollRun>("/payroll", { method: "POST", body: JSON.stringify({ month, year }) }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="run-month" className="c-label">
            Month
          </label>
          <select id="run-month" value={month} onChange={(e) => setMonth(Number(e.target.value))} className="c-select">
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="run-year" className="c-label">
            Year
          </label>
          <input
            id="run-year"
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="c-input w-28"
          />
        </div>
        <Button type="submit" loading={busy} disabled={duplicate}>
          {duplicate ? "Period already exists" : "Create period"}
        </Button>
        {error && <p className="w-full text-sm text-danger-text">{error}</p>}
      </form>
    </Card>
  );
}

/** An authorized adjustment during review (4.2.2). Draft only. */
function AdjustButton({ payslip, runId, onSaved }: { payslip: Payslip; runId: string; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [deductions, setDeductions] = useState(String(payslip.deductions));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/payroll/${runId}/payslips/${payslip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ deductions: Number(deductions), ...(note ? { note } : {}) }),
      });
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Adjust
      </Button>
    );
  }

  return (
    <form onSubmit={save} className="flex items-end justify-end gap-2">
      <div>
        <label htmlFor={`adj-${payslip.id}`} className="sr-only">
          Deductions
        </label>
        <input
          id={`adj-${payslip.id}`}
          type="number"
          min={0}
          step={1}
          value={deductions}
          onChange={(e) => setDeductions(e.target.value)}
          className="c-input w-28"
        />
      </div>
      <div>
        <label htmlFor={`adjn-${payslip.id}`} className="sr-only">
          Note
        </label>
        <input
          id={`adjn-${payslip.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason"
          className="c-input w-36"
        />
      </div>
      <Button type="submit" size="sm" loading={busy}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

/** A controlled revision of a finalized payslip (rule 02). */
function ReviseDialog({
  payslip,
  runId,
  onClose,
  onSaved,
}: {
  payslip: Payslip;
  runId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [grossPay, setGrossPay] = useState(String(payslip.grossPay));
  const [deductions, setDeductions] = useState(String(payslip.deductions));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/payroll/${runId}/payslips/${payslip.id}/revise`, {
        method: "POST",
        body: JSON.stringify({ grossPay: Number(grossPay), deductions: Number(deductions), reason }),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="c-dialog z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Revise payslip" className="c-dialog-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="c-dialog-title">
          Revise payslip · {payslip.employee ? `${payslip.employee.firstName} ${payslip.employee.lastName}` : ""}
        </h2>
        <p className="mt-1 text-sm text-secondary">
          The original payslip is kept and marked superseded. The new revision references it.
        </p>
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="rev-gross" className="c-label">
              Gross pay
            </label>
            <input id="rev-gross" required type="number" min={0} step={1} value={grossPay} onChange={(e) => setGrossPay(e.target.value)} className="c-input" />
          </div>
          <div>
            <label htmlFor="rev-ded" className="c-label">
              Deductions
            </label>
            <input id="rev-ded" required type="number" min={0} step={1} value={deductions} onChange={(e) => setDeductions(e.target.value)} className="c-input" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="rev-reason" className="c-label">
              Reason for the revision
            </label>
            <input id="rev-reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className="c-input" />
          </div>
          {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={busy}>
              Create revision
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
