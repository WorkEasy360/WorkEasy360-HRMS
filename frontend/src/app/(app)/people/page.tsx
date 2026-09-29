"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Search, UserPlus, Users } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Employee } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { AccessNotice, type AccessResult } from "@/components/AccessNotice";

export default function PeoplePage() {
  const { hasPermission } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  async function load(q?: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const query = q ? `?search=${encodeURIComponent(q)}` : "";
      const data = await apiFetch<Employee[]>(`/employees${query}`);
      setEmployees(data);
      setActiveSearch(q ?? "");
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, []);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    load(search);
  }

  function clearSearch() {
    setSearch("");
    load();
  }

  const canManage = hasPermission("employee:write");
  const activeCount = employees.filter((e) => e.status === "ACTIVE").length;
  const onboardingCount = employees.filter((e) => e.status === "ONBOARDING").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee Directory"
        description="Find colleagues, view their profiles and add new employees."
        actions={
          canManage && (
            <Button
              variant={showAddForm ? "secondary" : "primary"}
              icon={showAddForm ? undefined : UserPlus}
              onClick={() => setShowAddForm((v) => !v)}
            >
              {showAddForm ? "Close form" : "Add employee"}
            </Button>
          )
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showAddForm && <AddEmployeeForm onCreated={() => load(search)} />}

      <form onSubmit={onSearch} className="flex max-w-md items-end gap-2">
        <div className="flex-1">
          <label htmlFor="people-search" className="label">
            Search employees
          </label>
          <input
            id="people-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or employee code…"
            className="input"
          />
        </div>
        <Button type="submit" variant="secondary" icon={Search}>
          Search
        </Button>
      </form>

      {!loading && employees.length > 0 && (
        <p className="text-sm text-slate-500">
          {employees.length} employee{employees.length === 1 ? "" : "s"}
          {activeSearch ? ` matching “${activeSearch}”` : ""}
          {activeCount > 0 && ` · ${activeCount} active`}
          {onboardingCount > 0 && ` · ${onboardingCount} onboarding`}
        </p>
      )}

      {loading ? (
        <LoadingRows rows={6} />
      ) : employees.length === 0 ? (
        <Card>
          {activeSearch ? (
            <EmptyState
              icon={Search}
              title={`No employees match “${activeSearch}”`}
              description="Check the spelling or search by employee code instead."
              action={
                <Button variant="secondary" onClick={clearSearch}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No employees yet"
              description={
                canManage
                  ? "Add your first employee to start building your directory."
                  : "Employees will appear here once they have been added by HR."
              }
              action={
                canManage &&
                !showAddForm && (
                  <Button icon={UserPlus} onClick={() => setShowAddForm(true)}>
                    Add employee
                  </Button>
                )
              }
            />
          )}
        </Card>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Code</th>
                <th>Designation</th>
                <th>Department</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <Link href={`/people/${emp.id}`} className="font-medium text-slate-900 hover:text-blue-600 hover:underline">
                      {emp.firstName} {emp.lastName}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-slate-500">{emp.employeeCode}</td>
                  <td className="text-slate-500">{emp.designation ?? "—"}</td>
                  <td className="text-slate-500">{emp.department?.name ?? "—"}</td>
                  <td>
                    <StatusBadge status={emp.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddEmployeeForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useFeedback();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", designation: "" });
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<AccessResult>("/employees", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setAccess({ ...result, email: form.email });
      toast.success(`${form.firstName} ${form.lastName} added to the directory`);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="emp-first-name" className="label">
            First name
          </label>
          <input
            id="emp-first-name"
            required
            value={form.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="emp-last-name" className="label">
            Last name
          </label>
          <input
            id="emp-last-name"
            required
            value={form.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="emp-email" className="label">
            Work email
          </label>
          <input
            id="emp-email"
            required
            type="email"
            placeholder="name@company.com"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="emp-designation" className="label">
            Designation <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="emp-designation"
            placeholder="e.g. Software Engineer"
            value={form.designation}
            onChange={(e) => set("designation", e.target.value)}
            className="input"
          />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        {access && <AccessNotice result={access} kind="created" />}
        <div className="sm:col-span-2">
          <Button type="submit" icon={UserPlus} loading={submitting}>
            Create employee
          </Button>
        </div>
      </form>
    </Card>
  );
}
