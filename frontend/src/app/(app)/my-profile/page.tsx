"use client";

import { ShieldCheck, UserX } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/components/format";

export default function MyProfilePage() {
  const { user } = useAuth();
  const employee = user?.employee;

  if (!employee) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader title="My Profile" description="Your employment details as recorded by HR." />
        <Card>
          <EmptyState
            icon={UserX}
            title="No employee profile linked yet"
            description="Your login isn't connected to an employee record. Ask your HR administrator to link your account."
          />
        </Card>
      </div>
    );
  }

  const initials = `${employee.firstName[0] ?? ""}${employee.lastName[0] ?? ""}`.toUpperCase();
  const tenure = employee.dateOfJoining ? tenureLabel(employee.dateOfJoining) : null;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="My Profile"
        description="Your employment details as recorded by HR. Contact HR if anything looks wrong."
      />

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
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <Field label="Employee code" value={employee.employeeCode} />
          <Field label="Status" value={employee.status.replace(/_/g, " ")} />
          <Field label="Full name" value={`${employee.firstName} ${employee.lastName}`} />
          <Field label="Email" value={user?.email ?? "—"} />
          <Field label="Designation" value={employee.designation ?? "—"} />
          <Field label="Phone" value={employee.phone ?? "—"} />
          <Field label="Department" value={employee.department?.name ?? "—"} />
          <Field label="Date of joining" value={formatDate(employee.dateOfJoining)} />
        </dl>
      </Card>

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
      <dd className="break-words font-medium text-slate-900">{value}</dd>
    </div>
  );
}
