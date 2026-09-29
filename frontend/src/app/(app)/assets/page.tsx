"use client";

import { FormEvent, useEffect, useState } from "react";
import { Laptop, PackagePlus } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Asset, Employee } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage, useFeedback } from "@/components/feedback";

export default function AssetsPage() {
  const { toast, confirm } = useFeedback();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [a, e] = await Promise.all([
        apiFetch<Asset[]>("/assets"),
        apiFetch<Employee[]>("/employees"),
      ]);
      setAssets(a);
      setEmployees(e);
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

  async function assign(asset: Asset, employeeId: string) {
    if (!employeeId) return;
    const emp = employees.find((e) => e.id === employeeId);
    setBusyId(asset.id);
    try {
      await apiFetch(`/assets/${asset.id}/assign`, { method: "POST", body: JSON.stringify({ employeeId }) });
      toast.success(emp ? `${asset.name} assigned to ${emp.firstName} ${emp.lastName}` : "Asset assigned");
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function returnAsset(asset: Asset) {
    const ok = await confirm({
      title: `Mark ${asset.name} as returned?`,
      description: asset.assignedTo
        ? `It will be unassigned from ${asset.assignedTo.firstName} ${asset.assignedTo.lastName} and become available again.`
        : "It will become available for assignment again.",
      confirmLabel: "Mark returned",
    });
    if (!ok) return;
    setBusyId(asset.id);
    try {
      await apiFetch(`/assets/${asset.id}/return`, { method: "POST" });
      toast.success(`${asset.name} returned`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function retire(asset: Asset) {
    const ok = await confirm({
      title: `Retire ${asset.name}?`,
      description: "Retired assets can no longer be assigned. This cannot be undone.",
      confirmLabel: "Retire asset",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(asset.id);
    try {
      await apiFetch(`/assets/${asset.id}/retire`, { method: "POST" });
      toast.success(`${asset.name} retired`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const available = assets.filter((a) => a.status === "AVAILABLE").length;
  const assigned = assets.filter((a) => a.status === "ASSIGNED").length;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Assets"
        description="Track company equipment and who it is assigned to."
        actions={
          <Button
            variant={showForm ? "secondary" : "primary"}
            icon={showForm ? undefined : PackagePlus}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Close form" : "New asset"}
          </Button>
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {showForm && (
        <AssetForm
          onCreated={() => {
            setShowForm(false);
            toast.success("Asset added");
            load();
          }}
        />
      )}

      {!loading && assets.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile label="Total" value={assets.length} tone="text-slate-900" />
          <SummaryTile label="Available" value={available} tone="text-emerald-600" />
          <SummaryTile label="Assigned" value={assigned} tone="text-blue-600" />
        </div>
      )}

      {loading ? (
        <LoadingRows rows={5} />
      ) : assets.length === 0 ? (
        <Card>
          <EmptyState
            icon={Laptop}
            title="No assets yet"
            description="Add laptops, phones, ID cards and other equipment so you can assign them to employees."
            action={
              !showForm && (
                <Button icon={PackagePlus} onClick={() => setShowForm(true)}>
                  New asset
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Category</th>
                <th>Status</th>
                <th>Assigned to</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="font-medium text-slate-900">{a.name}</span>
                    {a.serialNumber && <span className="block text-xs text-slate-400">{a.serialNumber}</span>}
                  </td>
                  <td className="text-slate-500">{a.category}</td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="text-slate-500">
                    {a.assignedTo ? `${a.assignedTo.firstName} ${a.assignedTo.lastName}` : "—"}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      {a.status === "AVAILABLE" && (
                        <select
                          aria-label={`Assign ${a.name} to employee`}
                          defaultValue=""
                          disabled={busyId === a.id}
                          onChange={(e) => assign(a, e.target.value)}
                          className="input w-auto py-1 text-xs"
                        >
                          <option value="" disabled>
                            Assign…
                          </option>
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {emp.firstName} {emp.lastName}
                            </option>
                          ))}
                        </select>
                      )}
                      {a.status === "ASSIGNED" && (
                        <Button variant="ghost" size="sm" loading={busyId === a.id} onClick={() => returnAsset(a)}>
                          Return
                        </Button>
                      )}
                      {a.status !== "RETIRED" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          disabled={busyId === a.id}
                          onClick={() => retire(a)}
                        >
                          Retire
                        </Button>
                      )}
                    </div>
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

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </Card>
  );
}

function AssetForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Laptop");
  const [serialNumber, setSerialNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/assets", {
        method: "POST",
        body: JSON.stringify({ name, category, serialNumber: serialNumber || undefined }),
      });
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
          <label htmlFor="asset-name" className="label">
            Asset name
          </label>
          <input
            id="asset-name"
            required
            placeholder="e.g. MacBook Pro 14"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="asset-category" className="label">
            Category
          </label>
          <select id="asset-category" value={category} onChange={(e) => setCategory(e.target.value)} className="input">
            <option value="Laptop">Laptop</option>
            <option value="Phone">Phone</option>
            <option value="ID Card">ID Card</option>
            <option value="Monitor">Monitor</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor="asset-serial" className="label">
            Serial number <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input id="asset-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className="input" />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={submitting}>
            Add asset
          </Button>
        </div>
      </form>
    </Card>
  );
}
