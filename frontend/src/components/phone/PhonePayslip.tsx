"use client";

import { useEffect, useState } from "react";
import { Download, Receipt, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { saveFile } from "@/lib/native";
import { payslipPdf } from "@/lib/payslip-pdf";
import type { Organization, Payslip } from "@/lib/types";
import { Button, EmptyState, ErrorBanner, LoadingRows } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatMoney } from "@/components/format";

/**
 * The person's own payslip on a phone, as in the app design: pick a month,
 * see the salary summary and net pay, download it as a PDF. Published
 * payslips only — a draft is not a payslip.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function periodOf(p: Payslip): string {
  return p.payrollRun ? `${MONTHS[p.payrollRun.month - 1]} ${p.payrollRun.year}` : "—";
}

export function PhonePayslip() {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [payslips, setPayslips] = useState<Payslip[] | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<Payslip[]>("/payroll/me/payslips")
      .then((list) => {
        setPayslips(list);
        setSelectedId(list[0]?.id ?? "");
      })
      .catch((err) => {
        setPayslips([]);
        setError(errorMessage(err));
      });
    apiFetch<Organization>("/organizations/current")
      .then((o) => setOrgName(o.name))
      .catch(() => setOrgName(null));
  }, []);

  if (!payslips) return <LoadingRows rows={4} />;
  if (payslips.length === 0) {
    return (
      <div className="space-y-3">
        <ErrorBanner message={error} />
        <div className="c-card">
          <EmptyState icon={Receipt} title="No payslips yet" description="Payslips appear here once payroll has been finalized and published for a month." />
        </div>
      </div>
    );
  }

  const payslip = payslips.find((p) => p.id === selectedId) ?? payslips[0];
  const inputs = (payslip.calculationInputs ?? {}) as Record<string, unknown>;
  const segments = Array.isArray(inputs.salarySegments) ? (inputs.salarySegments as { monthlyGross?: number }[]) : [];
  const monthlyGross = segments.length ? Number(segments[segments.length - 1].monthlyGross ?? 0) : null;
  const unpaidDays = Number(inputs.unpaidLeaveDays ?? 0);
  const period = periodOf(payslip);

  async function download() {
    setSaving(true);
    try {
      const blob = payslipPdf({
        payslip,
        period,
        employeeName: user?.employee ? `${user.employee.firstName} ${user.employee.lastName}` : (user?.email ?? ""),
        employeeCode: user?.employee?.employeeCode,
        organizationName: orgName,
      });
      await saveFile(blob, `payslip-${period.replace(/\s+/g, "-").toLowerCase()}.pdf`);
    } catch {
      toast.error("Couldn't save the payslip.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="sr-only">Month</span>
        <select value={payslip.id} onChange={(e) => setSelectedId(e.target.value)} className="c-select h-11 w-full">
          {payslips.map((p) => (
            <option key={p.id} value={p.id}>
              {periodOf(p)}
              {p.revisionNumber > 1 ? " (revised)" : ""}
            </option>
          ))}
        </select>
      </label>

      <section className="c-card p-4" aria-labelledby="salary-summary">
        <div className="flex items-center gap-3">
          <span className="c-icon-tile" aria-hidden>
            <Wallet strokeWidth={2} />
          </span>
          <div>
            <h2 id="salary-summary" className="text-base font-semibold text-heading">
              Salary Summary
            </h2>
            <p className="text-sm text-secondary">{period}</p>
          </div>
        </div>

        <dl className="mt-4 space-y-2.5 text-sm">
          {monthlyGross !== null && <Line label="Monthly gross salary" value={formatMoney(monthlyGross)} />}
          <Line label="Paid days" value={`${payslip.paidDays} of ${payslip.payableDays}`} />
          {unpaidDays > 0 && <Line label="Unpaid leave days" value={String(unpaidDays)} />}
          <Line label="Gross pay" value={formatMoney(payslip.grossPay)} strong />
        </dl>

        <p className="mt-4 text-sm font-semibold text-heading">Deductions</p>
        <dl className="mt-2 space-y-2.5 text-sm">
          <Line label="Total deductions" value={formatMoney(payslip.deductions)} />
        </dl>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-accent-soft px-4 py-3">
          <span className="text-base font-bold text-accent-strong">Net Pay</span>
          <span className="text-lg font-bold text-heading">{formatMoney(payslip.netPay)}</span>
        </div>

        {payslip.revisionNote && (
          <p className="c-alert mt-3" data-tone="info">
            Revision {payslip.revisionNumber}: {payslip.revisionNote}
          </p>
        )}
      </section>

      <Button className="h-12 w-full text-base" icon={Download} loading={saving} onClick={download}>
        Download Payslip (PDF)
      </Button>

      <p className="text-xs text-secondary">A published payslip records what was calculated for the month. It is not confirmation that the salary has been paid.</p>
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={strong ? "font-semibold text-heading" : "text-body"}>{label}</dt>
      <dd className={strong ? "font-bold text-heading" : "text-heading"}>{value}</dd>
    </div>
  );
}
