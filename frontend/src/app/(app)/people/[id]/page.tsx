"use client";

import { FormEvent, use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, Pencil, Save, UserX } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Department, Employee, EmployeeStatus } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { useAuth } from "@/lib/auth-context";
import { useAppConfig } from "@/lib/use-app-config";
import { AccessNotice, type AccessResult } from "@/components/AccessNotice";
import { formatCalendarDate, formatDate, toDateInput } from "@/components/format";

export default function EmployeeProfilePage(props: PageProps<"/people/[id]">) {
  const { id } = use(props.params);
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("employee:write");
  const [editing, setEditing] = useState(false);
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

      {editing ? (
        <EditEmployeeForm
          employee={employee}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            setEmployee(updated);
            setEditing(false);
          }}
        />
      ) : (
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Employee details</h2>
            {canEdit && (
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Field label="Employee code" value={employee.employeeCode} />
            <Field label="Email" value={employee.user?.email ?? "—"} />
            <Field label="Designation" value={employee.designation ?? "—"} />
            <Field label="Phone" value={employee.phone ?? "—"} />
            <Field label="Department" value={employee.department?.name ?? "—"} />
            <Field label="Manager" value={employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : "—"} />
            <Field label="Date of joining" value={formatDate(employee.dateOfJoining)} />
            <Field label="Status" value={STATUS_LABELS[employee.status]} />
          </dl>
        </Card>
      )}

      {canEdit && <PersonalDetailsCard employee={employee} />}

      <ResetPasswordCard employeeId={employee.id} name={employee.firstName} />
    </div>
  );
}

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  ONBOARDING: "Onboarding",
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  EXITED: "Exited",
};

/** HR/Admin corrects job details and moves people through Onboarding → Active → Exited. */
function EditEmployeeForm({
  employee,
  onCancel,
  onSaved,
}: {
  employee: Employee;
  onCancel: () => void;
  onSaved: (updated: Employee) => void;
}) {
  const { toast } = useFeedback();
  const [form, setForm] = useState({
    firstName: employee.firstName,
    lastName: employee.lastName,
    designation: employee.designation ?? "",
    phone: employee.phone ?? "",
    departmentId: employee.departmentId ?? "",
    managerId: employee.managerId ?? "",
    dateOfJoining: toDateInput(employee.dateOfJoining),
    status: employee.status,
  });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [colleagues, setColleagues] = useState<Employee[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Department[]>("/departments").then(setDepartments).catch(() => {});
    apiFetch<Employee[]>("/employees").then(setColleagues).catch(() => {});
  }, []);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await apiFetch<Employee>(`/employees/${employee.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...form,
          departmentId: form.departmentId || null,
          managerId: form.managerId || null,
          dateOfJoining: form.dateOfJoining || null,
        }),
      });
      toast.success(`${updated.firstName}'s details saved`);
      onSaved(updated);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // The current manager stays selectable even if they have since exited.
  const managerOptions = colleagues.filter(
    (c) => c.id !== employee.id && (c.status !== "EXITED" || c.id === employee.managerId),
  );

  return (
    <Card className="p-6">
      <h2 className="mb-4 text-sm font-semibold text-slate-900">Edit employee details</h2>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="edit-first-name" className="label">
            First name
          </label>
          <input id="edit-first-name" required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="edit-last-name" className="label">
            Last name
          </label>
          <input id="edit-last-name" required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="edit-designation" className="label">
            Designation
          </label>
          <input id="edit-designation" value={form.designation} onChange={(e) => set("designation", e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="edit-phone" className="label">
            Phone
          </label>
          <input id="edit-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="edit-department" className="label">
            Department
          </label>
          <select id="edit-department" value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)} className="input">
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="edit-manager" className="label">
            Manager
          </label>
          <select id="edit-manager" value={form.managerId} onChange={(e) => set("managerId", e.target.value)} className="input">
            <option value="">No manager</option>
            {managerOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName} ({c.employeeCode})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="edit-joining" className="label">
            Date of joining
          </label>
          <input id="edit-joining" type="date" value={form.dateOfJoining} onChange={(e) => set("dateOfJoining", e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="edit-status" className="label">
            Status
          </label>
          <select id="edit-status" value={form.status} onChange={(e) => set("status", e.target.value as EmployeeStatus)} className="input">
            {(Object.keys(STATUS_LABELS) as EmployeeStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {form.status === "EXITED" && employee.status !== "EXITED" && (
            <p className="mt-1 text-xs text-amber-700">Their exit date will be set to today.</p>
          )}
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" icon={Save} loading={saving}>
            Save changes
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** What the employee filled in on My Profile — shown to HR only. */
function PersonalDetailsCard({ employee }: { employee: Employee }) {
  const emergency = [employee.emergencyContactName, employee.emergencyContactPhone].filter(Boolean).join(" · ");
  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold text-slate-900">Personal details</h2>
      <p className="mt-1 text-sm text-slate-500">
        Filled in by {employee.firstName} on their My Profile page. Hidden from managers and colleagues.
      </p>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
        <Field label="Date of birth" value={formatCalendarDate(employee.dateOfBirth)} />
        <Field label="Personal email" value={employee.personalEmail ?? "—"} />
        <Field label="Address" value={employee.address ?? "—"} />
        <Field label="Emergency contact" value={emergency || "—"} />
      </dl>
    </Card>
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
