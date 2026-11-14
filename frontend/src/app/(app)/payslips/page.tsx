"use client";

import { useEffect, useState } from "react";
import { Download, Receipt } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Payslip } from "@/lib/types";
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/ui";
import { errorMessage } from "@/components/feedback";
import { formatCalendarDate, formatMoney } from "@/components/format";

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

/**
 * My Payslips (Payroll 4.3.2). Published payslips only — a draft is not a
 * payslip, and publishing is not payment (rule 03).
 */
export default function PayslipsPage() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Payslip | null>(null);

  useEffect(() => {
    apiFetch<Payslip[]>("/payroll/me/payslips")
      .then(setPayslips)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const period = (p: Payslip) => (p.payrollRun ? `${MONTHS[p.payrollRun.month - 1]} ${p.payrollRun.year}` : "—");

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader icon={Receipt} title="Payslips" description="Your published payslips. Download or open one to see how it was worked out." />

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {loading ? (
        <LoadingRows rows={4} />
      ) : payslips.length === 0 ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title="No payslips yet"
            description="Payslips appear here once payroll has been finalized and published for a period."
          />
        </Card>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
            <caption className="sr-only">My payslips</caption>
            <thead>
              <tr>
                <th>Period</th>
                <th>Paid days</th>
                <th>Gross</th>
                <th>Deductions</th>
                <th>Net</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {payslips.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap font-medium text-heading">
                    {period(p)}
                    {p.revisionNumber > 1 && (
                      <span className="ml-2 c-badge" data-tone="info">
                        Revised
                      </span>
                    )}
                  </td>
                  <td className="text-secondary">
                    {p.paidDays} of {p.payableDays}
                  </td>
                  <td className="text-secondary">{formatMoney(p.grossPay)}</td>
                  <td className="text-secondary">{formatMoney(p.deductions)}</td>
                  <td className="font-medium text-heading">{formatMoney(p.netPay)}</td>
                  <td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setOpen(p)}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-secondary">
        A published payslip records what was calculated for the period. It is not confirmation that the salary has been paid.
      </p>

      {open && <PayslipDialog payslip={open} period={period(open)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PayslipDialog({ payslip, period, onClose }: { payslip: Payslip; period: string; onClose: () => void }) {
  const inputs = (payslip.calculationInputs ?? {}) as Record<string, unknown>;

  function downloadText() {
    const lines = [
      `Payslip — ${period}`,
      `Published: ${formatCalendarDate(payslip.publishedAt)}`,
      payslip.revisionNumber > 1 ? `Revision ${payslip.revisionNumber}` : "",
      "",
      `Paid days: ${payslip.paidDays} of ${payslip.payableDays}`,
      `Gross pay: ${formatMoney(payslip.grossPay)}`,
      `Deductions: ${formatMoney(payslip.deductions)}`,
      `Net pay: ${formatMoney(payslip.netPay)}`,
      "",
      "A published payslip is not confirmation that the salary has been paid.",
    ].filter(Boolean);
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payslip-${period.replace(/\s+/g, "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="c-dialog z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Payslip for ${period}`} className="c-dialog-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="c-dialog-title">Payslip · {period}</h2>

        <dl className="mt-4 grid grid-cols-2 gap-4">
          <div className="c-field">
            <dt>Gross pay</dt>
            <dd>{formatMoney(payslip.grossPay)}</dd>
          </div>
          <div className="c-field">
            <dt>Deductions</dt>
            <dd>{formatMoney(payslip.deductions)}</dd>
          </div>
          <div className="c-field">
            <dt>Net pay</dt>
            <dd className="font-semibold">{formatMoney(payslip.netPay)}</dd>
          </div>
          <div className="c-field">
            <dt>Paid days</dt>
            <dd>
              {payslip.paidDays} of {payslip.payableDays}
            </dd>
          </div>
        </dl>

        {payslip.revisionNote && (
          <p className="c-alert mt-4" data-tone="info">
            Revision {payslip.revisionNumber}: {payslip.revisionNote}
          </p>
        )}

        {/* The inputs are kept with the payslip so the amount can always be explained. */}
        <Card className="mt-4">
          <CardHeader title="How this was worked out" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <Row label="Basis" value={String(inputs.basis ?? "paid-days")} />
              <Row label="Rounding" value={String(inputs.rounding ?? "—")} />
              <Row label="Working days in period" value={String(inputs.totalWorkingDays ?? "—")} />
              <Row label="Eligible from" value={String(inputs.eligibleFrom ?? "—")} />
              <Row label="Eligible to" value={String(inputs.eligibleTo ?? "—")} />
              <Row label="Unpaid leave days" value={String(inputs.unpaidLeaveDays ?? 0)} />
            </dl>
          </CardBody>
        </Card>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" icon={Download} onClick={downloadText}>
            Download
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-secondary">{label}</dt>
      <dd className="text-body">{value}</dd>
    </div>
  );
}
