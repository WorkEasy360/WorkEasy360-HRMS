"use client";

import { useEffect, useState } from "react";
import { BarChart3, CalendarRange, TrendingDown, Users, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AttritionReport, HeadcountReport, LeaveLiabilityReport, PayrollCostReport } from "@/lib/types";
import { Card, EmptyState, ErrorBanner, PageHeader, Skeleton } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { formatMoney } from "@/components/format";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function ReportsPage() {
  const [headcount, setHeadcount] = useState<HeadcountReport | null>(null);
  const [attrition, setAttrition] = useState<AttritionReport | null>(null);
  const [leaveLiability, setLeaveLiability] = useState<LeaveLiabilityReport | null>(null);
  const [payrollCost, setPayrollCost] = useState<PayrollCostReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      apiFetch<HeadcountReport>("/reports/headcount").then(setHeadcount),
      apiFetch<AttritionReport>("/reports/attrition").then(setAttrition),
      apiFetch<LeaveLiabilityReport>("/reports/leave-liability").then(setLeaveLiability),
      apiFetch<PayrollCostReport>("/reports/payroll-cost").then(setPayrollCost),
    ])
      .then((results) => {
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed === results.length) setLoadError("Reports couldn't be loaded. Please try again.");
        else if (failed > 0) setLoadError("Some reports couldn't be loaded and are hidden below.");
      })
      .finally(() => setLoading(false));
  }, []);

  const header = (
    <PageHeader title="Reports" description="Workforce, leave and payroll insights across your organization." />
  );

  if (loading) {
    return (
      <div className="max-w-4xl space-y-6">
        {header}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-16 w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const maxDept = Math.max(1, ...(headcount?.byDepartment.map((d) => d.count) ?? [0]));
  const maxExits = Math.max(1, ...(attrition?.byMonth.map((m) => m.count) ?? [0]));

  return (
    <div className="max-w-4xl space-y-6">
      {header}

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {headcount && (
          <ReportCard title="Headcount" icon={Users}>
            <p className="text-3xl font-semibold text-slate-900">{headcount.total}</p>
            <p className="text-xs text-slate-500">employees in total</p>
            {headcount.byStatus.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                {headcount.byStatus.map((s) => (
                  <div key={s.status} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2">
                    <StatusBadge status={s.status} />
                    <span className="font-semibold text-slate-900">{s.count}</span>
                  </div>
                ))}
              </div>
            )}
            {headcount.byDepartment.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">By department</p>
                <div className="space-y-2 text-sm">
                  {headcount.byDepartment.map((d) => (
                    <BarRow key={d.department} label={d.department} value={d.count} max={maxDept} />
                  ))}
                </div>
              </div>
            )}
          </ReportCard>
        )}

        {attrition && (
          <ReportCard title="Attrition (last 12 months)" icon={TrendingDown}>
            <p className="text-3xl font-semibold text-slate-900">{attrition.totalExits}</p>
            <p className="text-xs text-slate-500">exits</p>
            {attrition.byMonth.length === 0 ? (
              <EmptyState icon={TrendingDown} title="No exits recorded" description="Nobody has left in the last 12 months." />
            ) : (
              <div className="mt-4 space-y-2 text-sm">
                {attrition.byMonth.map((m) => (
                  <BarRow key={m.month} label={m.month} value={m.count} max={maxExits} tone="bg-rose-400" />
                ))}
              </div>
            )}
          </ReportCard>
        )}
      </div>

      {leaveLiability && (
        <section className="space-y-2">
          <SectionTitle icon={CalendarRange} title={`Leave liability (${leaveLiability.year})`} />
          {leaveLiability.byLeaveType.length === 0 ? (
            <Card>
              <EmptyState
                icon={CalendarRange}
                title="No leave balances recorded yet"
                description="Balances appear here once leave types are allocated to employees."
              />
            </Card>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Leave type</th>
                    <th className="text-right">Remaining days</th>
                    <th className="text-right">Used days</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveLiability.byLeaveType.map((l) => (
                    <tr key={l.leaveType}>
                      <td className="font-medium text-slate-900">{l.leaveType}</td>
                      <td className="text-right text-slate-700">{l.remainingDays}</td>
                      <td className="text-right text-slate-500">{l.usedDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {payrollCost && (
        <section className="space-y-2">
          <SectionTitle icon={Wallet} title="Payroll cost" />
          {payrollCost.byRun.length === 0 ? (
            <Card>
              <EmptyState
                icon={Wallet}
                title="No processed payroll runs yet"
                description="Costs appear here after a payroll run has been processed."
              />
            </Card>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th className="text-right">Employees</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollCost.byRun.map((r) => (
                    <tr key={`${r.month}-${r.year}`}>
                      <td className="whitespace-nowrap font-medium text-slate-900">
                        {MONTH_NAMES[r.month - 1]} {r.year}
                      </td>
                      <td className="text-right text-slate-500">{r.employeeCount}</td>
                      <td className="whitespace-nowrap text-right text-slate-700">{formatMoney(r.grossTotal)}</td>
                      <td className="whitespace-nowrap text-right font-medium text-slate-900">{formatMoney(r.netTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!headcount && !attrition && !leaveLiability && !payrollCost && !loadError && (
        <Card>
          <EmptyState icon={BarChart3} title="No reports available" description="Report data will appear here once it is available." />
        </Card>
      )}
    </div>
  );
}

function ReportCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-500">
        <Icon className="h-4 w-4 text-slate-400" />
        {title}
      </h2>
      {children}
    </Card>
  );
}

function SectionTitle({ title, icon: Icon }: { title: string; icon: typeof Users }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-medium text-slate-500">
      <Icon className="h-4 w-4 text-slate-400" />
      {title}
    </h2>
  );
}

function BarRow({ label, value, max, tone = "bg-blue-500" }: { label: string; value: number; max: number; tone?: string }) {
  return (
    <div>
      <div className="flex justify-between gap-2">
        <span className="truncate text-slate-700">{label}</span>
        <span className="font-medium text-slate-900">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${(value / max) * 100}%` }} />
      </div>
    </div>
  );
}
