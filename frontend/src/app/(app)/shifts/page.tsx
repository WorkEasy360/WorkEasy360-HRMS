"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarClock, Clock, UserPlus } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Employee, ShiftAssignment, ShiftTemplate } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader, Skeleton } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDate } from "@/components/format";

export default function ShiftsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("shift:manage");
  const { toast } = useFeedback();

  const [myShift, setMyShift] = useState<ShiftAssignment | null>(null);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [mine, tpls] = await Promise.all([
        apiFetch<ShiftAssignment | null>("/shifts/me"),
        apiFetch<ShiftTemplate[]>("/shifts/templates"),
      ]);
      setMyShift(mine);
      setTemplates(tpls);
      if (canManage) {
        const [all, emps] = await Promise.all([
          apiFetch<ShiftAssignment[]>("/shifts"),
          apiFetch<Employee[]>("/employees"),
        ]);
        setAssignments(all);
        setEmployees(emps);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount, re-run once permission is known
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Shifts"
        description={canManage ? "See your shift, define shift templates and assign employees to them." : "See the working shift you are assigned to."}
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      <Card className="p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">My shift</p>
        {loading ? (
          <div className="mt-2 space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : myShift ? (
          <div className="mt-2 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-900">{myShift.shiftTemplate.name}</p>
              <p className="text-sm text-slate-500">
                {myShift.shiftTemplate.startTime} – {myShift.shiftTemplate.endTime} · effective from {formatDate(myShift.effectiveFrom)}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">You haven&apos;t been assigned a shift yet. Contact HR if you think this is a mistake.</p>
        )}
      </Card>

      {canManage && (
        <>
          <TemplateForm
            onCreated={(name) => {
              toast.success(`Shift template "${name}" created`);
              load();
            }}
          />
          <AssignForm
            templates={templates}
            employees={employees}
            onAssigned={() => {
              toast.success("Employee assigned to shift");
              load();
            }}
          />

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-slate-500">All assignments</h2>
            {loading ? (
              <LoadingRows rows={4} />
            ) : assignments.length === 0 ? (
              <Card>
                <EmptyState
                  icon={CalendarClock}
                  title="No shift assignments yet"
                  description="Create a shift template, then use the form above to assign employees to it."
                />
              </Card>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Shift</th>
                      <th>Effective from</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a) => (
                      <tr key={a.id}>
                        <td className="font-medium text-slate-900">
                          {a.employee?.firstName} {a.employee?.lastName}
                        </td>
                        <td className="text-slate-500">
                          {a.shiftTemplate.name}{" "}
                          <span className="whitespace-nowrap">
                            ({a.shiftTemplate.startTime}–{a.shiftTemplate.endTime})
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-slate-500">{formatDate(a.effectiveFrom)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function TemplateForm({ onCreated }: { onCreated: (name: string) => void }) {
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/shifts/templates", { method: "POST", body: JSON.stringify({ name, startTime, endTime }) });
      setName("");
      onCreated(name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">New shift template</h2>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="shift-tpl-name" className="label">
            Name
          </label>
          <input id="shift-tpl-name" required placeholder="e.g. Day Shift" value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="shift-tpl-start" className="label">
            Start time
          </label>
          <input id="shift-tpl-start" required type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="shift-tpl-end" className="label">
            End time
          </label>
          <input id="shift-tpl-end" required type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input" />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting} icon={Clock}>
            Create template
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AssignForm({
  templates,
  employees,
  onAssigned,
}: {
  templates: ShiftTemplate[];
  employees: Employee[];
  onAssigned: () => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [shiftTemplateId, setShiftTemplateId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/shifts/assign", {
        method: "POST",
        body: JSON.stringify({ employeeId, shiftTemplateId, effectiveFrom }),
      });
      onAssigned();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Assign employee to shift</h2>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="shift-assign-employee" className="label">
            Employee
          </label>
          <select id="shift-assign-employee" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="input">
            <option value="">Select employee…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="shift-assign-template" className="label">
            Shift template
          </label>
          <select id="shift-assign-template" required value={shiftTemplateId} onChange={(e) => setShiftTemplateId(e.target.value)} className="input">
            <option value="">Select shift…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.startTime}–{t.endTime})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="shift-assign-from" className="label">
            Effective from
          </label>
          <input id="shift-assign-from" required type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input" />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting} icon={UserPlus}>
            Assign
          </Button>
        </div>
      </form>
    </Card>
  );
}
