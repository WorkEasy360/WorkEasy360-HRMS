"use client";

import { useEffect, useState } from "react";
import { Laptop, Package } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Asset } from "@/lib/types";
import { Card, EmptyState, ErrorBanner, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage } from "@/components/feedback";

export default function MyAssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Asset[]>("/assets/me")
      .then(setAssets)
      .catch((err) => setLoadError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="My Assets"
        description={
          !loading && assets.length > 0
            ? `You have ${assets.length} company ${assets.length === 1 ? "asset" : "assets"} assigned to you.`
            : "Company equipment currently assigned to you."
        }
      />

      <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />

      {loading ? (
        <LoadingRows rows={3} />
      ) : assets.length === 0 ? (
        !loadError && (
          <Card>
            <EmptyState
              icon={Package}
              title="No assets assigned to you"
              description="Laptops, phones, ID cards and other equipment issued to you will show up here. Raise a Help Desk ticket if something is missing."
            />
          </Card>
        )
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <Card key={a.id} className="flex items-center gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <Laptop className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{a.name}</p>
                <p className="text-sm text-slate-500">
                  {a.category}
                  {a.serialNumber && <span className="text-slate-400"> · {a.serialNumber}</span>}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
