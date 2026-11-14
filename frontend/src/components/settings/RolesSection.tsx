"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ShieldCheck, UserCog } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { MembersResponse, Role } from "@/lib/types";
import { Button, Card, CardBody, CardHeader, ErrorBanner, LoadingRows, StatCard } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";

/**
 * Settings 7.2 — Roles & access.
 *
 * Payroll and helpdesk queue access are explicit grants, not something a
 * manager inherits. Seats are counted from enabled logins: an employee record
 * is not automatically a billed seat.
 */

/** Grouped so the sensitive grants are obvious rather than buried in a list. */
const PERMISSION_GROUPS: { title: string; note?: string; keys: [string, string][] }[] = [
  {
    title: "People",
    keys: [
      ["employee:read", "See the employee directory"],
      ["employee:write", "Add and edit employees"],
      ["employee:exit", "Record an exit and revoke HRMS access"],
      ["document:manage", "See and verify anyone's documents"],
      ["onboarding:manage", "Manage joining checklists"],
      ["department:manage", "Manage departments"],
      ["department:read", "See departments"],
    ],
  },
  {
    title: "Attendance and leave",
    note: "Approve covers direct reports only. Manage covers the whole organization.",
    keys: [
      ["leave:approve", "Approve leave for direct reports"],
      ["leave:manage", "Approve any leave, and configure leave types"],
      ["attendance:approve", "Approve corrections for direct reports"],
      ["attendance:manage", "Approve any attendance correction"],
    ],
  },
  {
    title: "Payroll",
    note: "Salary information is restricted to these grants.",
    keys: [
      ["compensation:manage", "See and set salary"],
      ["payroll:manage", "Run, finalize and publish payroll"],
    ],
  },
  {
    title: "Helpdesk",
    keys: [
      ["helpdesk:manage", "Work the HR and product queues"],
      ["helpdesk:payroll", "Work the restricted payroll queue"],
    ],
  },
  {
    title: "Hiring",
    keys: [["recruitment:manage", "Manage job openings, candidates and interviews"]],
  },
  {
    title: "Administration",
    keys: [
      ["org:manage", "Company settings, work schedule and holidays"],
      ["role:manage", "Roles and access"],
      ["audit:read", "Read the audit history"],
      ["automation:manage", "Internal automation switches"],
      ["integration:manage", "Integrations through WorkEasy Connect"],
      ["announcement:manage", "Publish announcements"],
      ["announcement:read", "Read announcements"],
      ["policy:manage", "Publish HR policies"],
    ],
  },
];

export function RolesSection() {
  const { toast } = useFeedback();
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<MembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, m] = await Promise.all([apiFetch<Role[]>("/roles"), apiFetch<MembersResponse>("/roles/members")]);
      setRoles(r);
      setMembers(m);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function savePermissions(role: Role, permissions: string[]) {
    setBusy(true);
    try {
      await apiFetch(`/roles/${role.id}`, { method: "PATCH", body: JSON.stringify({ permissions }) });
      toast.success(`${role.name} updated`);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function assign(userId: string, roleId: string, add: boolean) {
    try {
      await apiFetch(add ? "/roles/assign" : "/roles/unassign", { method: "POST", body: JSON.stringify({ userId, roleId }) });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (loading) return <LoadingRows rows={5} />;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {members && (
        <div className="c-stats">
          <StatCard label="Seats in use" value={members.seatsInUse} icon={UserCog} />
          <StatCard label="Employee records" value={members.employeeRecords} />
          <StatCard label="Roles" value={roles.length} />
        </div>
      )}
      {members && <p className="text-xs text-secondary">{members.note}</p>}

      <Card>
        <CardHeader title="Roles" />
        <CardBody className="space-y-3">
          {roles.map((role) => (
            <div key={role.id} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-heading">
                    {role.name}
                    {role.isSystem && <span className="ml-2 c-tag">built-in</span>}
                  </p>
                  <p className="text-xs text-secondary">{role.permissions.length} permission(s)</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={ShieldCheck}
                  onClick={() => setEditing(editing?.id === role.id ? null : role)}
                >
                  {editing?.id === role.id ? "Close" : "Edit permissions"}
                </Button>
              </div>
              {editing?.id === role.id && <PermissionEditor role={role} busy={busy} onSave={savePermissions} />}
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Members and their roles" />
        <div className="c-table-wrap">
          <table className="c-table">
            <caption className="sr-only">Members and roles</caption>
            <thead>
              <tr>
                <th>Member</th>
                <th>Employee</th>
                <th>Roles</th>
                <th>Seat</th>
              </tr>
            </thead>
            <tbody>
              {(members?.members ?? []).map((m) => (
                <tr key={m.userId}>
                  <td className="font-medium text-heading">
                    {m.name}
                    <span className="block text-xs font-normal text-secondary">{m.email}</span>
                  </td>
                  <td className="text-secondary">{m.employeeCode ?? "No employee record"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {roles.map((r) => {
                        const has = m.roles.some((x) => x.id === r.id);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => assign(m.userId, r.id, !has)}
                            className="c-badge"
                            data-tone={has ? "success" : undefined}
                            aria-pressed={has}
                          >
                            {r.name}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    {m.accessRevoked ? (
                      <span className="c-badge">Revoked</span>
                    ) : (
                      <span className="c-badge" data-tone="success">
                        In use
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function PermissionEditor({
  role,
  busy,
  onSave,
}: {
  role: Role;
  busy: boolean;
  onSave: (role: Role, permissions: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(role.permissions);

  function toggle(key: string) {
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave(role, selected);
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-4 border-t border-line pt-3">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.title}>
          <legend className="c-eyebrow">{group.title}</legend>
          {group.note && <p className="mb-1 text-xs text-secondary">{group.note}</p>}
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {group.keys.map(([key, label]) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="c-checkbox mt-0.5" checked={selected.includes(key)} onChange={() => toggle(key)} />
                <span>
                  {label}
                  <span className="block font-mono text-xs text-secondary">{key}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <Button type="submit" size="sm" loading={busy}>
        Save permissions
      </Button>
    </form>
  );
}
