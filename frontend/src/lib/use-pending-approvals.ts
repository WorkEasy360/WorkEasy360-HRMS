"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";

export type PendingCounts = { leave: number; timesheets: number; expenses: number; loans: number; total: number };

const EMPTY: PendingCounts = { leave: 0, timesheets: 0, expenses: 0, loans: 0, total: 0 };

/** Counts of requests waiting on the current user. Refreshes on navigation and every minute. */
export function usePendingApprovals(): PendingCounts {
  const pathname = usePathname();
  const [counts, setCounts] = useState<PendingCounts>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const safe = (path: string) => apiFetch<unknown[]>(path).then((r) => r.length).catch(() => 0);
      const [leave, timesheets, expenses, loans] = await Promise.all([
        safe("/leave-requests/pending-approvals"),
        safe("/timesheets/pending-approvals"),
        safe("/expenses/pending-approvals"),
        safe("/loans/pending-approvals"),
      ]);
      if (!cancelled) setCounts({ leave, timesheets, expenses, loans, total: leave + timesheets + expenses + loans });
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pathname]);

  return counts;
}
