"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { MessageCircle, Phone, Search, SlidersHorizontal, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { AttendanceRegister, Department, Employee } from "@/lib/types";
import { Avatar, Button, EmptyState, ErrorBanner, LoadingRows } from "@/ui";
import { errorMessage } from "@/components/feedback";

/**
 * The employee directory on a phone, as in the app design: All / Active /
 * On Leave tabs with counts, search, and one-tap Call and WhatsApp.
 *
 * "On Leave" means on approved leave today (from today's register), not a
 * profile status. "All" is everyone still employed; exited people appear only
 * when the filter asks for them.
 */

type Tab = "all" | "active" | "leave";

/** Digits for wa.me. A bare 10-digit number is taken as Indian (+91), the product's home market. */
function whatsappNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits.length >= 11 ? digits : null;
}

export function PhoneEmployeeList({ reloadKey }: { reloadKey: number }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [onLeave, setOnLeave] = useState<Set<string>>(new Set());
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [showExited, setShowExited] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ status: showExited ? "all" : "active" });
    if (activeSearch) query.set("search", activeSearch);
    if (departmentId) query.set("departmentId", departmentId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list reloads when a filter changes
    setLoading(true);
    apiFetch<Employee[]>(`/employees?${query}`)
      .then((list) => !cancelled && setEmployees(list))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeSearch, departmentId, showExited, reloadKey]);

  useEffect(() => {
    apiFetch<AttendanceRegister>("/attendance/register")
      .then((r) => setOnLeave(new Set(r.rows.filter((row) => row.status === "ON_LEAVE").map((row) => row.employeeId))))
      .catch(() => setOnLeave(new Set()));
    apiFetch<Department[]>("/departments")
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, []);

  const groups = useMemo(() => {
    const employed = employees.filter((e) => e.status !== "EXITED");
    return {
      all: showExited ? employees : employed,
      active: employed.filter((e) => !onLeave.has(e.id)),
      leave: employed.filter((e) => onLeave.has(e.id)),
    };
  }, [employees, onLeave, showExited]);

  const shown = groups[tab];

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setActiveSearch(search.trim());
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Employees">
        {(
          [
            ["all", "All"],
            ["active", "Active"],
            ["leave", "On Leave"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`h-10 rounded-xl border text-sm font-semibold transition-colors ${
              tab === key ? "border-transparent bg-[color:var(--we-accent)] text-[color:var(--we-on-accent)]" : "border-line bg-surface text-heading"
            }`}
          >
            {label} ({groups[key].length})
          </button>
        ))}
      </div>

      <form onSubmit={onSearch} className="flex gap-2">
        <label className="c-input-group flex-1">
          <Search strokeWidth={2} aria-hidden />
          <span className="sr-only">Search employees</span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) setActiveSearch("");
            }}
            placeholder="Search employees…"
            enterKeyHint="search"
            className="c-input h-11 w-full"
          />
        </label>
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          aria-label="Filters"
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl border ${
            filtersOpen || departmentId || showExited ? "border-[color:var(--we-accent)] bg-accent-soft text-accent-strong" : "border-line bg-surface text-heading"
          }`}
        >
          <SlidersHorizontal className="size-5" strokeWidth={2} aria-hidden />
        </button>
      </form>

      {filtersOpen && (
        <div className="c-card space-y-3 p-3">
          <div>
            <label htmlFor="phone-dept" className="c-label">
              Department
            </label>
            <select id="phone-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="c-select w-full">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-body">
            <input type="checkbox" className="c-checkbox" checked={showExited} onChange={(e) => setShowExited(e.target.checked)} />
            Include people who have left
          </label>
        </div>
      )}

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {loading ? (
        <LoadingRows rows={6} />
      ) : shown.length === 0 ? (
        <div className="c-card">
          <EmptyState
            icon={activeSearch ? Search : Users}
            title={activeSearch ? `No employees match “${activeSearch}”` : tab === "leave" ? "Nobody is on leave today" : "No employees here"}
            description={activeSearch ? "Check the spelling or search by employee code." : undefined}
            action={
              activeSearch ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setActiveSearch("");
                  }}
                >
                  Clear search
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="c-card divide-y divide-[color:var(--we-border)]">
          {shown.map((emp) => {
            const name = `${emp.firstName} ${emp.lastName}`;
            const wa = emp.phone ? whatsappNumber(emp.phone) : null;
            return (
              <li key={emp.id} className="flex items-center gap-3 px-3 py-3">
                <Link href={`/employees/${emp.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={name} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-heading">{name}</span>
                    <span className="block truncate text-xs text-secondary">{emp.designation ?? emp.employeeCode}</span>
                    {emp.department?.name && <span className="block truncate text-xs text-secondary">{emp.department.name}</span>}
                    {emp.status === "EXITED" && <span className="block text-xs font-semibold text-[color:var(--we-error-text)]">Left</span>}
                  </span>
                </Link>
                {emp.phone && (
                  <span className="flex shrink-0 gap-2">
                    <a
                      href={`tel:${emp.phone.replace(/[^\d+]/g, "")}`}
                      aria-label={`Call ${name}`}
                      className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent-strong"
                    >
                      <Phone className="size-[1.125rem]" strokeWidth={2} aria-hidden />
                    </a>
                    {wa && (
                      <a
                        href={`https://wa.me/${wa}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Message ${name} on WhatsApp`}
                        className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent-strong"
                      >
                        <MessageCircle className="size-[1.125rem]" strokeWidth={2} aria-hidden />
                      </a>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
