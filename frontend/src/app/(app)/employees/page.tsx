"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, UserPlus, Users } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Department, Employee } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { AccessNotice, type AccessResult } from "@/components/AccessNotice";
import { PhoneEmployeeList } from "@/components/phone/PhoneEmployeeList";
import { useIsPhone } from "@/lib/use-phone";

/**
 * Employees (02). The directory, with search and the active/inactive filter
 * the note asks for. Profiles, documents, checklist and exit live one level in.
 */
type StatusFilter = "all" | "active" | "inactive";

export default function EmployeesPage() {
  const isPhone = useIsPhone();
  return <Suspense fallback={<LoadingRows rows={6} />}>{isPhone ? <PhoneEmployees /> : <EmployeeDirectory />}</Suspense>;
}

/** Phones: the app design's directory, with the same add-employee form. */
function PhoneEmployees() {
  const { hasPermission } = useAuth();
  const params = useSearchParams();
  const [showAddForm, setShowAddForm] = useState(params.get("new") === "1");
  const [reloadKey, setReloadKey] = useState(0);
  const canManage = hasPermission("employee:write");

  return (
    <div className="space-y-4">
      {canManage && (
        <Button
          className="h-11 w-full"
          variant={showAddForm ? "secondary" : "primary"}
          icon={showAddForm ? undefined : UserPlus}
          onClick={() => setShowAddForm((v) => !v)}
        >
          {showAddForm ? "Close form" : "Add Employee"}
        </Button>
      )}
      {showAddForm && <AddEmployeeForm onCreated={() => setReloadKey((k) => k + 1)} />}
      <PhoneEmployeeList reloadKey={reloadKey} />
    </div>
  );
}

function EmployeeDirectory() {
  const { hasPermission } = useAuth();
  const params = useSearchParams();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [departmentId, setDepartmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Home's "Add employee" quick action opens the form straight away.
  const [showAddForm, setShowAddForm] = useState(params.get("new") === "1");

  // One effect owns the list: it reloads whenever a filter or the submitted
  // search changes, so no control has to remember to fetch.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const query = new URLSearchParams();
        if (activeSearch) query.set("search", activeSearch);
        if (status !== "all") query.set("status", status);
        if (departmentId) query.set("departmentId", departmentId);
        const qs = query.toString();
        const data = await apiFetch<Employee[]>(`/employees${qs ? `?${qs}` : ""}`);
        if (!cancelled) setEmployees(data);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [activeSearch, status, departmentId, reloadKey]);

  useEffect(() => {
    apiFetch<Department[]>("/departments")
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, []);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setActiveSearch(search);
  }

  function clearSearch() {
    setSearch("");
    setActiveSearch("");
  }

  /** Re-runs the list query after a change that isn't a filter, like a new hire. */
  function reload() {
    setReloadKey((k) => k + 1);
  }

  const canManage = hasPermission("employee:write");
  const activeCount = employees.filter((e) => e.status === "ACTIVE").length;
  const onboardingCount = employees.filter((e) => e.status === "ONBOARDING").length;

  return (
    <div className="space-y-6">
      <PageHeader icon={Users}
        title="Employees"
        description="Find colleagues, open a profile, and add new employees."
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

      {showAddForm && <AddEmployeeForm onCreated={reload} />}

      {/* 2.1.1 — name, department and active/inactive. Nothing else. */}
      <form onSubmit={onSearch} className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="people-search" className="c-label">
            Search
          </label>
          <input
            id="people-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or employee code…"
            className="c-input"
          />
        </div>
        <div>
          <label htmlFor="people-department" className="c-label">
            Department
          </label>
          <select
            id="people-department"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="c-select"
          >
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="people-status" className="c-label">
            Status
          </label>
          <select
            id="people-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="c-select"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
        <Button type="submit" variant="secondary" icon={Search}>
          Search
        </Button>
      </form>

      {!loading && employees.length > 0 && (
        <p className="text-sm text-secondary">
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
                  <Button variant="secondary" icon={UserPlus} onClick={() => setShowAddForm(true)}>
                    Add employee
                  </Button>
                )
              }
            />
          )}
        </Card>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
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
                    <span className="flex items-center gap-3">
                      <Avatar name={`${emp.firstName} ${emp.lastName}`} />
                      <Link href={`/employees/${emp.id}`} className="font-semibold text-heading hover:text-link hover:underline">
                        {emp.firstName} {emp.lastName}
                      </Link>
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-secondary">{emp.employeeCode}</td>
                  <td className="text-secondary">{emp.designation ?? "—"}</td>
                  <td className="text-secondary">{emp.department?.name ?? "—"}</td>
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
          <label htmlFor="emp-first-name" className="c-label">
            First name
          </label>
          <input
            id="emp-first-name"
            required
            value={form.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            className="c-input"
          />
        </div>
        <div>
          <label htmlFor="emp-last-name" className="c-label">
            Last name
          </label>
          <input
            id="emp-last-name"
            required
            value={form.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            className="c-input"
          />
        </div>
        <div>
          <label htmlFor="emp-email" className="c-label">
            Work email
          </label>
          <input
            id="emp-email"
            required
            type="email"
            placeholder="name@company.com"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            className="c-input"
          />
        </div>
        <div>
          <label htmlFor="emp-designation" className="c-label">
            Designation <span className="font-normal text-secondary">(optional)</span>
          </label>
          <input
            id="emp-designation"
            placeholder="e.g. Software Engineer"
            value={form.designation}
            onChange={(e) => set("designation", e.target.value)}
            className="c-input"
          />
        </div>
        {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
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
