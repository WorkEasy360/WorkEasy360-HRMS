"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, Save, ShieldCheck, UserX } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Employee } from "@/lib/types";
import { Button, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatCalendarDate, formatDate, toDateInput } from "@/components/format";

export default function MyProfilePage() {
  const { user } = useAuth();
  const linked = !!user?.employee;
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!linked) return;
    // /employees/me includes department, manager and personal details, which /auth/me doesn't.
    apiFetch<Employee>("/employees/me")
      .then(setEmployee)
      .catch(() => setLoadError(true));
  }, [linked]);

  if (!linked || loadError) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader title="My Profile" description="Your employment and personal details." />
        <Card>
          <EmptyState
            icon={UserX}
            title={linked ? "Couldn't load your profile" : "No employee profile linked yet"}
            description={
              linked
                ? "Refresh the page to try again."
                : "Your login isn't connected to an employee record. Ask your HR administrator to link your account."
            }
          />
        </Card>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="max-w-2xl space-y-6" aria-busy="true" aria-label="Loading">
        <PageHeader title="My Profile" description="Your employment and personal details." />
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-40" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const initials = `${employee.firstName[0] ?? ""}${employee.lastName[0] ?? ""}`.toUpperCase();
  const tenure = employee.dateOfJoining ? tenureLabel(employee.dateOfJoining) : null;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="My Profile" description="Your employment and personal details." />

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-100 text-lg font-semibold text-blue-700">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-slate-900">
            {employee.firstName} {employee.lastName}
          </p>
          <p className="truncate text-sm text-slate-500">
            {[employee.designation, employee.department?.name].filter(Boolean).join(" · ") || employee.employeeCode}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={employee.status} />
          {tenure && <p className="text-xs text-slate-500">{tenure}</p>}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Employment details</h2>
        <p className="mt-1 text-sm text-slate-500">Recorded by HR. Contact HR if anything looks wrong.</p>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <Field label="Employee code" value={employee.employeeCode} />
          <Field label="Work email" value={employee.user?.email ?? user?.email ?? "—"} />
          <Field label="Designation" value={employee.designation ?? "—"} />
          <Field label="Department" value={employee.department?.name ?? "—"} />
          <Field label="Manager" value={employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : "—"} />
          <Field label="Date of joining" value={formatDate(employee.dateOfJoining)} />
        </dl>
      </Card>

      <PersonalDetails employee={employee} onSaved={setEmployee} />

      <section>
        <h2 className="flex items-center gap-2 text-sm font-medium text-slate-500">
          <ShieldCheck className="h-4 w-4 text-slate-400" />
          Roles
        </h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {user?.roles.length ? (
            user.roles.map((role) => (
              <span key={role} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {role}
              </span>
            ))
          ) : (
            <p className="text-sm text-slate-500">No roles assigned.</p>
          )}
        </div>
      </section>
    </div>
  );
}

const PERSONAL_KEYS = ["phone", "personalEmail", "dateOfBirth", "address", "emergencyContactName", "emergencyContactPhone"] as const;

/** Contact and personal details the employee maintains themselves. Only they and HR can see these. */
function PersonalDetails({ employee, onSaved }: { employee: Employee; onSaved: (e: Employee) => void }) {
  const { toast } = useFeedback();
  const missing = PERSONAL_KEYS.filter((k) => !employee[k]).length;
  // Open the form straight away for new joiners who haven't filled anything in yet.
  const [editing, setEditing] = useState(missing === PERSONAL_KEYS.length);
  const [form, setForm] = useState(() => formFrom(employee));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEditing() {
    setForm(formFrom(employee));
    setError(null);
    setEditing(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await apiFetch<Employee>("/employees/me", { method: "PATCH", body: JSON.stringify(form) });
      onSaved(updated);
      setEditing(false);
      toast.success("Your details are saved");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const emergency = [employee.emergencyContactName, employee.emergencyContactPhone].filter(Boolean).join(" · ");

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Personal details</h2>
          <p className="mt-1 text-sm text-slate-500">Only you and HR can see these.</p>
        </div>
        {!editing && (
          <Button variant="secondary" size="sm" icon={Pencil} onClick={startEditing}>
            Edit
          </Button>
        )}
      </div>

      {!editing && missing > 0 && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {missing} of {PERSONAL_KEYS.length} details still missing. Keeping them up to date helps HR reach you or your family in an emergency.
        </p>
      )}

      {editing ? (
        <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="me-phone" className="label">
              Phone
            </label>
            <input id="me-phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="input" />
          </div>
          <div>
            <label htmlFor="me-personal-email" className="label">
              Personal email
            </label>
            <input
              id="me-personal-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.personalEmail}
              onChange={(e) => set("personalEmail", e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="me-dob" className="label">
              Date of birth
            </label>
            <input
              id="me-dob"
              type="date"
              autoComplete="bday"
              max={new Date().toISOString().slice(0, 10)}
              value={form.dateOfBirth}
              onChange={(e) => set("dateOfBirth", e.target.value)}
              className="input"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="me-address" className="label">
              Address
            </label>
            <textarea
              id="me-address"
              rows={2}
              autoComplete="street-address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="me-ec-name" className="label">
              Emergency contact name
            </label>
            <input
              id="me-ec-name"
              placeholder="e.g. Priya Singh (sister)"
              value={form.emergencyContactName}
              onChange={(e) => set("emergencyContactName", e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="me-ec-phone" className="label">
              Emergency contact phone
            </label>
            <input
              id="me-ec-phone"
              type="tel"
              value={form.emergencyContactPhone}
              onChange={(e) => set("emergencyContactPhone", e.target.value)}
              className="input"
            />
          </div>
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" icon={Save} loading={saving}>
              Save details
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <Field label="Phone" value={employee.phone ?? "—"} />
          <Field label="Personal email" value={employee.personalEmail ?? "—"} />
          <Field label="Date of birth" value={formatCalendarDate(employee.dateOfBirth)} />
          <Field label="Address" value={employee.address ?? "—"} />
          <Field label="Emergency contact" value={emergency || "—"} />
        </dl>
      )}
    </Card>
  );
}

function formFrom(employee: Employee) {
  return {
    phone: employee.phone ?? "",
    personalEmail: employee.personalEmail ?? "",
    dateOfBirth: toDateInput(employee.dateOfBirth),
    address: employee.address ?? "",
    emergencyContactName: employee.emergencyContactName ?? "",
    emergencyContactPhone: employee.emergencyContactPhone ?? "",
  };
}

function tenureLabel(dateOfJoining: string): string | null {
  const start = new Date(dateOfJoining);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return "Joining soon";
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0 && rem === 0) return "Joined this month";
  const parts = [];
  if (years) parts.push(`${years} yr${years > 1 ? "s" : ""}`);
  if (rem) parts.push(`${rem} mo`);
  return `${parts.join(" ")} with us`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="whitespace-pre-line break-words font-medium text-slate-900">{value}</dd>
    </div>
  );
}
