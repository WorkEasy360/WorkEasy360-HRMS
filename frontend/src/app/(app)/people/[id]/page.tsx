"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, UserX } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Employee } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { useAuth } from "@/lib/auth-context";
import { useAppConfig } from "@/lib/use-app-config";
import { AccessNotice, type AccessResult } from "@/components/AccessNotice";
import { formatDate } from "@/components/format";

export default function EmployeeProfilePage(props: PageProps<"/people/[id]">) {
  const { id } = use(props.params);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Employee>(`/employees/${id}`)
      .then(setEmployee)
      .catch(() => setError("Employee not found or you don't have access."))
      .finally(() => setLoading(false));
  }, [id]);

  const backLink = (
    <Link href="/people" className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
      <ArrowLeft className="h-4 w-4" />
      Back to directory
    </Link>
  );

  if (loading) {
    return (
      <div className="max-w-2xl space-y-6" aria-busy="true" aria-label="Loading">
        {backLink}
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Card className="p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-36" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="max-w-2xl space-y-6">
        {backLink}
        <Card>
          <EmptyState
            icon={UserX}
            title="Profile unavailable"
            description={error ?? "Employee not found or you don't have access."}
          />
        </Card>
      </div>
    );
  }

  const fullName = `${employee.firstName} ${employee.lastName}`;
  const initials = `${employee.firstName?.[0] ?? ""}${employee.lastName?.[0] ?? ""}`.toUpperCase();
  const subtitle = [employee.designation, employee.department?.name].filter(Boolean).join(" · ");

  return (
    <div className="max-w-2xl space-y-6">
      {backLink}

      <div className="flex items-start gap-4">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-100 text-lg font-semibold text-blue-700"
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <PageHeader title={fullName} description={subtitle || `Employee ${employee.employeeCode}`} />
          <div className="mt-2">
            <StatusBadge status={employee.status} />
          </div>
        </div>
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Employee details</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <Field label="Employee code" value={employee.employeeCode} />
          <Field label="Email" value={employee.user?.email ?? "—"} />
          <Field label="Designation" value={employee.designation ?? "—"} />
          <Field label="Phone" value={employee.phone ?? "—"} />
          <Field label="Department" value={employee.department?.name ?? "—"} />
          <Field label="Manager" value={employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : "—"} />
          <Field label="Date of joining" value={formatDate(employee.dateOfJoining)} />
        </dl>
      </Card>

      <ResetPasswordCard employeeId={employee.id} name={employee.firstName} />
    </div>
  );
}

/** HR/Admin resets access when someone forgot their password or is locked out. */
function ResetPasswordCard({ employeeId, name }: { employeeId: string; name: string }) {
  const { user, hasPermission } = useAuth();
  const { confirm, toast } = useFeedback();
  const config = useAppConfig();
  const [result, setResult] = useState<AccessResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (!hasPermission("employee:write") || user?.employee?.id === employeeId) return null;
  const byEmail = config?.emailEnabled ?? false;

  async function reset() {
    const ok = await confirm({
      title: `Reset ${name}'s password?`,
      description: byEmail
        ? "Their current password stops working and they're signed out everywhere. We'll email them a link to choose a new one."
        : "Their current password stops working and they're signed out everywhere. You'll get a temporary password to give them.",
      confirmLabel: "Reset password",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await apiFetch<AccessResult>(`/employees/${employeeId}/reset-password`, { method: "POST" });
      setResult(res);
      toast.success(res.emailSent ? "Reset link sent." : "Password reset. Share the temporary password privately.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold text-slate-900">Account access</h2>
      <p className="mt-1 text-sm text-slate-500">
        Forgot their password or locked out? {byEmail ? "Send them a reset link by email." : "Issue a new temporary password."}
      </p>
      {result ? (
        <div className="mt-3">
          <AccessNotice result={result} kind="reset" />
        </div>
      ) : (
        <Button variant="secondary" icon={KeyRound} loading={busy} onClick={reset} className="mt-3">
          Reset password
        </Button>
      )}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-slate-900">{value}</dd>
    </div>
  );
}
