"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { AuditLog } from "@/lib/types";
import { Card, EmptyState, ErrorBanner, LoadingRows } from "@/ui";
import { errorMessage } from "@/components/feedback";
import { formatDateTime } from "@/components/format";

/**
 * Settings 7.4 — Audit history. Read-only: there is no way to edit or delete an
 * event from here, and the values shown are only those the reader may see.
 */

/** Plain-English labels for the actions that get recorded. */
const ACTION_LABELS: Record<string, string> = {
  "organization.update": "Company settings changed",
  "employee.update": "Employee details changed",
  "employee.exit_recorded": "Exit recorded",
  "employee.access_revoked": "HRMS access revoked",
  "employee.invite_sent": "Invitation sent",
  "user.password_reset": "Password reset by HR",
  "document.verify": "Document verified",
  "document.delete": "Document deleted",
  "payroll.finalize": "Payroll finalized",
  "payroll.publish": "Payslips published",
  "payroll.payslip_adjusted": "Payslip adjusted",
  "payroll.payslip_revised": "Payslip revised",
  "role.create": "Role created",
  "role.update": "Role permissions changed",
  "role.assign": "Role granted",
  "role.unassign": "Role removed",
  "automation.update": "Automation rule changed",
  "integration.connection_created": "Connection created",
  "integration.connection_updated": "Connection changed",
  "integration.connection_deleted": "Connection deleted",
  "integration.mapping_created": "Field mapping created",
  "integration.mapping_updated": "Field mapping changed",
};

export function AuditSection() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    apiFetch<AuditLog[]>("/audit-logs")
      .then(setLogs)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const rows = filter
    ? logs.filter((l) => `${l.action} ${l.entityType} ${l.actor?.email ?? ""}`.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  if (loading) return <LoadingRows rows={6} />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <div className="max-w-sm">
        <label htmlFor="audit-filter" className="c-label">
          Filter
        </label>
        <input
          id="audit-filter"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Action, record type or person…"
          className="c-input"
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={History}
            title="No audit events"
            description="Salary changes, approvals, payroll finalization, role grants and access changes are recorded here."
          />
        </Card>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table">
            <caption className="sr-only">Audit history</caption>
            <thead>
              <tr>
                <th>Action</th>
                <th>Record</th>
                <th>By</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium text-heading">
                    {ACTION_LABELS[l.action] ?? l.action}
                    <span className="block font-mono text-xs font-normal text-secondary">{l.action}</span>
                  </td>
                  <td className="text-secondary">{l.entityType}</td>
                  <td className="text-secondary">{l.actor?.email ?? "System"}</td>
                  <td className="whitespace-nowrap text-secondary">{formatDateTime(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-secondary">
        Audit events are read-only and can&apos;t be edited or removed. Sensitive values are only shown to roles that may see
        them.
      </p>
    </div>
  );
}
