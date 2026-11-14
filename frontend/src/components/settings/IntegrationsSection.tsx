"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ExternalLink, Link2, Plug, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { IntegrationCatalog, IntegrationConnection, IntegrationTransfer } from "@/lib/types";
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorBanner, LoadingRows } from "@/ui";
import { errorMessage, useFeedback } from "@/components/feedback";
import { formatDateTime } from "@/components/format";

/**
 * Settings 7.6 — Integrations, powered by WorkEasy Connect.
 *
 * HRMS records which connections are authorized and which supported events and
 * actions they are wired to. Credentials, OAuth, delivery, retries and logs all
 * belong to Connect: there is no second integration engine here, and no retry
 * button, because HRMS does not deliver anything.
 */
export function IntegrationsSection() {
  const { toast, confirm } = useFeedback();
  const [catalog, setCatalog] = useState<IntegrationCatalog | null>(null);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [transfers, setTransfers] = useState<IntegrationTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, conns, t] = await Promise.all([
        apiFetch<IntegrationCatalog>("/integrations/catalog"),
        apiFetch<IntegrationConnection[]>("/integrations/connections"),
        apiFetch<IntegrationTransfer[]>("/integrations/transfers").catch(() => []),
      ]);
      setCatalog(c);
      setConnections(conns);
      setTransfers(t);
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

  async function remove(connection: IntegrationConnection) {
    const ok = await confirm({
      title: `Remove "${connection.name}"?`,
      description: "HRMS stops offering this connection. The connection itself is managed in WorkEasy Connect.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/integrations/connections/${connection.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (loading) return <LoadingRows rows={5} />;
  if (!catalog) return <ErrorBanner message={error} />;

  const available = catalog.connectors.filter((c) => c.released);
  const comingSoon = catalog.connectors.filter((c) => !c.released);

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <p className="c-alert" data-tone="info">
        Connections, credentials, delivery and retries are handled by WorkEasy Connect. HRMS only records which connections are
        authorized here and which supported events and actions they use.
      </p>

      {/* 7.6.1 Connections */}
      <Card>
        <CardHeader
          title="Connections"
          actions={
            <Button variant={showForm ? "secondary" : "primary"} size="sm" icon={showForm ? undefined : Plug} onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Close" : "Add connection"}
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {showForm && (
            <ConnectionForm
              catalog={catalog}
              onCreated={() => {
                setShowForm(false);
                toast.success("Connection recorded");
                load();
              }}
            />
          )}

          {connections.length === 0 ? (
            <EmptyState icon={Plug} title="No connections" description="Add one for a released connector to get started." />
          ) : (
            <ul className="divide-y divide-line">
              {connections.map((c) => (
                <li key={c.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-heading">
                        {c.name}
                        <span className="ml-2 c-badge" data-tone={c.status === "ACTIVE" ? "success" : undefined}>
                          {c.status.replace(/_/g, " ")}
                        </span>
                      </p>
                      <p className="text-xs text-secondary">
                        {c.provider} · {c.direction === "INBOUND" ? "incoming" : "outgoing"} · {c.mappings.length} mapping(s)
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {c.connectUrl && (
                        <a href={c.connectUrl} target="_blank" rel="noreferrer" className="c-btn-ghost c-btn-sm">
                          <ExternalLink className="size-icon" strokeWidth={2} aria-hidden /> Open in Connect
                        </a>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        className="text-danger-text hover:bg-danger-soft hover:text-danger-text"
                        onClick={() => remove(c)}
                      >
                        <span className="sr-only">Remove {c.name}</span>
                      </Button>
                    </div>
                  </div>
                  <MappingEditor connection={c} catalog={catalog} onChanged={load} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* 7.6.5 Ready-made connectors */}
      <Card>
        <CardHeader title="Connectors" />
        <CardBody className="space-y-3">
          <div>
            <p className="c-eyebrow">Available</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {available.map((c) => (
                <li key={c.provider} className="c-tag">
                  {c.label}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="c-eyebrow">Coming soon</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {comingSoon.map((c) => (
                <li key={c.provider} className="c-badge">
                  {c.label}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-secondary">
              These have no setup action yet. A card here does not assert that the provider has approved anything.
            </p>
          </div>
        </CardBody>
      </Card>

      {/* 7.6.2 Supported events and actions */}
      <Card>
        <CardHeader title="What HRMS exposes" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="c-eyebrow">Outgoing events</p>
            <ul className="mt-1 space-y-2 text-sm">
              {catalog.events.map((e) => (
                <li key={e.key}>
                  <span className="font-medium text-heading">{e.label}</span>
                  <span className="block font-mono text-xs text-secondary">{e.key}</span>
                  <span className="block text-xs text-secondary">{e.fields.join(", ")}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="c-eyebrow">Incoming actions</p>
            <ul className="mt-1 space-y-2 text-sm">
              {catalog.actions.map((a) => (
                <li key={a.key}>
                  <span className="font-medium text-heading">{a.label}</span>
                  <span className="block font-mono text-xs text-secondary">{a.key}</span>
                  <span className="block text-xs text-secondary">{a.note ?? a.fields.join(", ")}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-secondary sm:col-span-2">
            Salary, bank details, private documents and help desk conversations are not available to any of these.
          </p>
        </CardBody>
      </Card>

      {/* 7.6.4 Transfer history */}
      <Card>
        <CardHeader title="Transfer history" />
        {transfers.length === 0 ? (
          <EmptyState icon={Link2} title="No transfers yet" description="Delivery history comes from Connect, filtered to HRMS." />
        ) : (
          <div className="c-table-wrap">
            <table className="c-table">
              <caption className="sr-only">Transfer history</caption>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Connection</th>
                  <th>Event or action</th>
                  <th>Reference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap text-secondary">{formatDateTime(t.occurredAt)}</td>
                    <td className="font-medium text-heading">{t.connection.name}</td>
                    <td className="font-mono text-xs text-secondary">{t.mapping?.eventKey ?? t.mapping?.actionKey ?? "—"}</td>
                    <td className="font-mono text-xs text-secondary">{t.reference}</td>
                    <td>
                      <span className="c-badge" data-tone={t.status === "DELIVERED" ? "success" : t.status === "FAILED" ? "danger" : undefined}>
                        {t.status}
                      </span>
                      {t.message && <p className="mt-1 max-w-xs text-xs text-secondary">{t.message}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CardBody>
          <p className="text-xs text-secondary">
            Retries are handled by Connect. A failed transfer never loses the HR record behind it, and a permanent permission or
            validation error needs fixing rather than retrying.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function ConnectionForm({ catalog, onCreated }: { catalog: IntegrationCatalog; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = catalog.connectors.find((c) => c.provider === provider);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/integrations/connections", {
        method: "POST",
        body: JSON.stringify({ name, provider, direction: chosen.direction }),
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 rounded-md bg-muted p-3 sm:grid-cols-3">
      <div>
        <label htmlFor="conn-provider" className="c-label">
          Connector
        </label>
        <select id="conn-provider" required value={provider} onChange={(e) => setProvider(e.target.value)} className="c-select">
          <option value="">Choose</option>
          {catalog.connectors
            .filter((c) => c.released)
            .map((c) => (
              <option key={c.provider} value={c.provider}>
                {c.label}
              </option>
            ))}
        </select>
      </div>
      <div>
        <label htmlFor="conn-name" className="c-label">
          Name
        </label>
        <input id="conn-name" required value={name} onChange={(e) => setName(e.target.value)} className="c-input" />
      </div>
      <div className="flex items-end">
        <Button type="submit" size="sm" loading={busy} disabled={!provider || !name.trim()}>
          Add
        </Button>
      </div>
      {chosen && (
        <p className="text-xs text-secondary sm:col-span-3">
          {chosen.direction === "INBOUND" ? "Incoming" : "Outgoing"} connection. Credentials and the sender policy are set in
          WorkEasy Connect.
        </p>
      )}
      {error && <p className="text-sm text-danger-text sm:col-span-3">{error}</p>}
    </form>
  );
}

/** 7.6.3 — map approved fields to a supported event or action. */
function MappingEditor({
  connection,
  catalog,
  onChanged,
}: {
  connection: IntegrationConnection;
  catalog: IntegrationCatalog;
  onChanged: () => void;
}) {
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);

  const outbound = connection.direction === "OUTBOUND";
  const options = outbound ? catalog.events : catalog.actions;

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const chosen = options.find((o) => o.key === key);
      await apiFetch("/integrations/mappings", {
        method: "POST",
        body: JSON.stringify({
          connectionId: connection.id,
          direction: connection.direction,
          ...(outbound ? { eventKey: key } : { actionKey: key }),
          ...(destination ? { destination } : {}),
          // Start with every approved field mapped to itself; narrow it in Connect.
          fieldMap: Object.fromEntries((chosen?.fields ?? []).map((f) => [f, f])),
        }),
      });
      setKey("");
      setDestination("");
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(mappingId: string, enabled: boolean) {
    try {
      await apiFetch(`/integrations/mappings/${mappingId}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-2 pl-1">
      {connection.mappings.length > 0 && (
        <ul className="space-y-1 text-sm">
          {connection.mappings.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-secondary">
                {m.eventKey ?? m.actionKey}
                {m.destination ? ` → ${m.destination}` : ""}
              </span>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" className="c-checkbox" checked={m.enabled} onChange={(e) => toggle(m.id, e.target.checked)} />
                {m.enabled ? "Enabled" : "Disabled"}
              </label>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`map-key-${connection.id}`} className="c-label">
              {outbound ? "HRMS event" : "HRMS action"}
            </label>
            <select id={`map-key-${connection.id}`} required value={key} onChange={(e) => setKey(e.target.value)} className="c-select">
              <option value="">Choose</option>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {outbound && (
            <div>
              <label htmlFor={`map-dest-${connection.id}`} className="c-label">
                Destination
              </label>
              <input
                id={`map-dest-${connection.id}`}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Set in Connect"
                className="c-input"
              />
            </div>
          )}
          <Button type="submit" size="sm" loading={busy} disabled={!key}>
            Add mapping
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Add a mapping
        </Button>
      )}
    </div>
  );
}
