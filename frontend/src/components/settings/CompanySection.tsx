"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Building2, CalendarDays, Megaphone, Plus, Save, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Announcement, Department, Holiday, HrPolicy, LeaveType, Organization } from "@/lib/types";
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorBanner, LoadingRows } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatCalendarDate, localIsoDate } from "@/components/format";

/**
 * Settings 7.1 — Company & HR rules. Everything that configures how attendance,
 * leave and payroll behave lives here, so no other screen has its own copy.
 */

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export function CompanySection() {
  return (
    <div className="space-y-6">
      <OrganizationCard />
      <DepartmentsCard />
      <HolidaysCard />
      <LeaveTypesCard />
      <AnnouncementsCard />
      <PoliciesCard />
    </div>
  );
}

/* ─── 7.1.1 / 7.1.2 Company profile and work schedule ────────────────── */

function OrganizationCard() {
  const { toast } = useFeedback();
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<Organization>("/organizations/current")
      .then(setOrg)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!org) return;
    setSaving(true);
    try {
      const updated = await apiFetch<Organization>("/organizations/current", {
        method: "PATCH",
        body: JSON.stringify({
          name: org.name,
          timezone: org.timezone,
          workingDays: org.workingDays,
          workStartTime: org.workStartTime,
          workEndTime: org.workEndTime,
          fullDayHours: org.fullDayHours,
        }),
      });
      setOrg(updated);
      toast.success("Company settings saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingRows rows={3} />;
  if (!org) return <ErrorBanner message={error} />;

  function toggleDay(day: number) {
    setOrg((o) =>
      o
        ? {
            ...o,
            workingDays: o.workingDays.includes(day)
              ? o.workingDays.filter((d) => d !== day)
              : [...o.workingDays, day].sort((a, b) => a - b),
          }
        : o,
    );
  }

  return (
    <Card>
      <CardHeader title="Company and work schedule" />
      <CardBody>
        <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="org-name" className="c-label">
              Organization name
            </label>
            <input id="org-name" required value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} className="c-input" />
          </div>
          <div>
            <label htmlFor="org-tz" className="c-label">
              Time zone
            </label>
            <input
              id="org-tz"
              required
              value={org.timezone}
              onChange={(e) => setOrg({ ...org, timezone: e.target.value })}
              placeholder="Asia/Kolkata"
              className="c-input"
            />
            <p className="mt-1 text-xs text-secondary">Decides what counts as today for check-in, leave and interviews.</p>
          </div>

          <fieldset className="sm:col-span-2">
            <legend className="c-label">Working days</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <label key={d.value} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="c-checkbox"
                    checked={org.workingDays.includes(d.value)}
                    onChange={() => toggleDay(d.value)}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="org-start" className="c-label">
              Day starts
            </label>
            <input id="org-start" required type="time" value={org.workStartTime} onChange={(e) => setOrg({ ...org, workStartTime: e.target.value })} className="c-input" />
          </div>
          <div>
            <label htmlFor="org-end" className="c-label">
              Day ends
            </label>
            <input id="org-end" required type="time" value={org.workEndTime} onChange={(e) => setOrg({ ...org, workEndTime: e.target.value })} className="c-input" />
            <p className="mt-1 text-xs text-secondary">A working day is only counted absent after it ends.</p>
          </div>
          <div>
            <label htmlFor="org-hours" className="c-label">
              Full day hours
            </label>
            <input
              id="org-hours"
              required
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={org.fullDayHours}
              onChange={(e) => setOrg({ ...org, fullDayHours: Number(e.target.value) })}
              className="c-input"
            />
          </div>

          <div className="sm:col-span-2">
            <Button type="submit" icon={Save} loading={saving} disabled={org.workingDays.length === 0}>
              Save
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/* ─── 7.1.1 Departments and reporting ────────────────────────────────── */

function DepartmentsCard() {
  const { toast } = useFeedback();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDepartments(await apiFetch<Department[]>("/departments").catch(() => []));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/departments", { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Departments" />
      <CardBody className="space-y-3">
        {departments.length === 0 ? (
          <p className="text-sm text-secondary">No departments yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {departments.map((d) => (
              <li key={d.id} className="c-tag">
                {d.name}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="flex items-end gap-2">
          <div className="max-w-xs flex-1">
            <label htmlFor="dept-name" className="c-label">
              Add a department
            </label>
            <input id="dept-name" required value={name} onChange={(e) => setName(e.target.value)} className="c-input" />
          </div>
          <Button type="submit" icon={Plus} loading={busy} disabled={!name.trim()}>
            Add
          </Button>
        </form>
        <p className="text-xs text-secondary">Reporting managers are set on each employee&apos;s profile.</p>
      </CardBody>
    </Card>
  );
}

/* ─── 7.1.2 Holidays ─────────────────────────────────────────────────── */

function HolidaysCard() {
  const { toast } = useFeedback();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [date, setDate] = useState(localIsoDate());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setHolidays(await apiFetch<Holiday[]>("/organizations/current/holidays").catch(() => []));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/organizations/current/holidays", { method: "POST", body: JSON.stringify({ date, name }) });
      setName("");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(h: Holiday) {
    try {
      await apiFetch(`/organizations/current/holidays/${h.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader title="Holidays" />
      <CardBody className="space-y-3">
        {holidays.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No holidays set" description="A holiday is never counted as absent." />
        ) : (
          <ul className="divide-y divide-line">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-heading">{formatCalendarDate(h.date)}</span>
                  <span className="ml-2 text-secondary">{h.name}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  className="text-danger-text hover:bg-danger-soft hover:text-danger-text"
                  onClick={() => remove(h)}
                >
                  <span className="sr-only">Remove {h.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="hol-date" className="c-label">
              Date
            </label>
            <input id="hol-date" required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="c-input" />
          </div>
          <div className="max-w-xs flex-1">
            <label htmlFor="hol-name" className="c-label">
              Holiday
            </label>
            <input id="hol-name" required value={name} onChange={(e) => setName(e.target.value)} className="c-input" />
          </div>
          <Button type="submit" icon={Plus} loading={busy}>
            Add
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

/* ─── 7.1.3 Leave types ──────────────────────────────────────────────── */

function LeaveTypesCard() {
  const { toast } = useFeedback();
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [form, setForm] = useState({ name: "", defaultDaysPerYear: 0, paid: true });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setTypes(await apiFetch<LeaveType[]>("/leave-types").catch(() => []));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/leave-types", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", defaultDaysPerYear: 0, paid: true });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function update(type: LeaveType, patch: Partial<LeaveType>) {
    try {
      await apiFetch(`/leave-types/${type.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader title="Leave types and balances" />
      <CardBody className="space-y-3">
        {types.length === 0 ? (
          <p className="text-sm text-secondary">No leave types yet. Employees can&apos;t request leave until there is one.</p>
        ) : (
          <div className="c-table-wrap">
            <table className="c-table">
              <caption className="sr-only">Leave types</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Days a year</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium text-heading">{t.name}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={366}
                        aria-label={`Days a year for ${t.name}`}
                        defaultValue={t.defaultDaysPerYear}
                        onBlur={(e) => {
                          const value = Number(e.target.value);
                          if (value !== t.defaultDaysPerYear) update(t, { defaultDaysPerYear: value });
                        }}
                        className="c-input w-24"
                      />
                    </td>
                    <td>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="c-checkbox"
                          checked={t.paid}
                          onChange={(e) => update(t, { paid: e.target.checked })}
                        />
                        {t.paid ? "Paid" : "Unpaid"}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="max-w-xs flex-1">
            <label htmlFor="lt-name" className="c-label">
              Add a leave type
            </label>
            <input id="lt-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="c-input" />
          </div>
          <div>
            <label htmlFor="lt-days" className="c-label">
              Days a year
            </label>
            <input
              id="lt-days"
              type="number"
              min={0}
              max={366}
              value={form.defaultDaysPerYear}
              onChange={(e) => setForm({ ...form, defaultDaysPerYear: Number(e.target.value) })}
              className="c-input w-24"
            />
          </div>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="c-checkbox" checked={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.checked })} />
            Paid
          </label>
          <Button type="submit" icon={Plus} loading={busy} disabled={!form.name.trim()}>
            Add
          </Button>
        </form>
        <p className="text-xs text-secondary">
          Unpaid leave reduces the paid days used for a payslip. Manager and HR approval permissions are set under Roles &amp;
          access.
        </p>
      </CardBody>
    </Card>
  );
}

/* ─── 7.1.4 Announcements and policies ───────────────────────────────── */

function AnnouncementsCard() {
  const { toast } = useFeedback();
  const [items, setItems] = useState<Announcement[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setItems(await apiFetch<Announcement[]>("/announcements").catch(() => []));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function publish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/announcements", { method: "POST", body: JSON.stringify({ title, body }) });
      setTitle("");
      setBody("");
      toast.success("Announcement published");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Announcement) {
    try {
      await apiFetch(`/announcements/${a.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader title="Announcements" />
      <CardBody className="space-y-3">
        {items.length === 0 ? (
          <EmptyState icon={Megaphone} title="Nothing published" description="Employees read announcements on Home." />
        ) : (
          <ul className="divide-y divide-line">
            {items.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-heading">{a.title}</p>
                  <p className="text-xs text-secondary">{formatCalendarDate(a.publishedAt)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  className="text-danger-text hover:bg-danger-soft hover:text-danger-text"
                  onClick={() => remove(a)}
                >
                  <span className="sr-only">Delete {a.title}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={publish} className="space-y-2">
          <div>
            <label htmlFor="ann-title" className="c-label">
              Title
            </label>
            <input id="ann-title" required value={title} onChange={(e) => setTitle(e.target.value)} className="c-input" />
          </div>
          <div>
            <label htmlFor="ann-body" className="c-label">
              Message
            </label>
            <textarea id="ann-body" required rows={3} value={body} onChange={(e) => setBody(e.target.value)} className="c-textarea" />
          </div>
          <Button type="submit" loading={busy}>
            Publish
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function PoliciesCard() {
  const { toast } = useFeedback();
  const [items, setItems] = useState<HrPolicy[]>([]);
  const [form, setForm] = useState({ title: "", category: "", body: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setItems(await apiFetch<HrPolicy[]>("/policies/all").catch(() => []));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/policies", { method: "POST", body: JSON.stringify({ ...form, publish: true }) });
      setForm({ title: "", category: "", body: "" });
      toast.success("Policy published");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(p: HrPolicy) {
    try {
      await apiFetch(`/policies/${p.id}`, { method: "PATCH", body: JSON.stringify({ publish: !p.publishedAt }) });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove(p: HrPolicy) {
    try {
      await apiFetch(`/policies/${p.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader title="HR policies" />
      <CardBody className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-secondary">No policies yet. Employees read published policies on Home.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-heading">{p.title}</p>
                  <p className="text-xs text-secondary">
                    {p.category ? `${p.category} · ` : ""}
                    {p.publishedAt ? `published ${formatCalendarDate(p.publishedAt)}` : "draft"}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => togglePublish(p)}>
                    {p.publishedAt ? "Unpublish" : "Publish"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    className="text-danger-text hover:bg-danger-soft hover:text-danger-text"
                    onClick={() => remove(p)}
                  >
                    <span className="sr-only">Delete {p.title}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={create} className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="pol-title" className="c-label">
                Title
              </label>
              <input id="pol-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="c-input" />
            </div>
            <div>
              <label htmlFor="pol-category" className="c-label">
                Category <span className="font-normal text-secondary">(optional)</span>
              </label>
              <input id="pol-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="c-input" />
            </div>
          </div>
          <div>
            <label htmlFor="pol-body" className="c-label">
              Policy text
            </label>
            <textarea id="pol-body" required rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="c-textarea" />
          </div>
          <Button type="submit" icon={Building2} loading={busy}>
            Publish policy
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
