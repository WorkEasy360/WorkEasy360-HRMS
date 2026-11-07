"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Payslip } from "@/lib/types";
import { Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/ui";
import { errorMessage } from "@/components/feedback";
import { formatMoney } from "@/components/format";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function periodKey(p: Payslip): number {
  return p.payrollRun ? p.payrollRun.year * 12 + p.payrollRun.month : 0;
}

export default function MyPayslipsPage() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Payslip[]>("/payroll/me/payslips")
      .then(setPayslips)
      .catch((err) => setLoadError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const latest = payslips.reduce<Payslip | null>((best, p) => (!best || periodKey(p) > periodKey(best) ? p : best), null);
  const latestYear = latest?.payrollRun?.year;
  const yearToDateNet = latestYear
    ? payslips.filter((p) => p.payrollRun?.year === latestYear).reduce((sum, p) => sum + (Number(p.netPay) || 0), 0)
    : 0;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="My Payslips" description="Review your monthly pay, deductions and take-home amount." />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {!loading && latest && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card className="px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary">
              Latest net pay{latest.payrollRun ? ` · ${MONTH_NAMES[latest.payrollRun.month - 1]} ${latest.payrollRun.year}` : ""}
            </p>
            <p className="mt-1 text-2xl font-semibold text-success">{formatMoney(latest.netPay)}</p>
          </Card>
          {latestYear && (
            <Card className="px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-secondary">Net pay in {latestYear}</p>
              <p className="mt-1 text-2xl font-semibold text-heading">{formatMoney(yearToDateNet)}</p>
            </Card>
          )}
        </div>
      )}

      {loading ? (
        <LoadingRows rows={3} />
      ) : payslips.length === 0 ? (
        !loadError && (
          <Card>
            <EmptyState
              icon={FileText}
              title="No payslips yet"
              description="Your payslips will appear here once payroll has been processed for a month you were employed."
            />
          </Card>
        )
      ) : (
        <div className="space-y-3">
          {payslips.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-heading">
                  {p.payrollRun ? `${MONTH_NAMES[p.payrollRun.month - 1]} ${p.payrollRun.year}` : "—"}
                </p>
                <p className="text-sm font-semibold text-heading">{formatMoney(p.netPay)}</p>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-secondary">Gross</dt>
                  <dd className="font-medium text-body">{formatMoney(p.grossPay)}</dd>
                </div>
                <div>
                  <dt className="text-secondary">Deductions</dt>
                  <dd className="font-medium text-danger-text">{formatMoney(p.deductions)}</dd>
                </div>
                <div>
                  <dt className="text-secondary">Net pay</dt>
                  <dd className="font-medium text-success">{formatMoney(p.netPay)}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
