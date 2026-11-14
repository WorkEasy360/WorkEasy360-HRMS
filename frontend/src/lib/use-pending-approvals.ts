"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";

export type PendingCounts = { leave: number; corrections: number; tickets: number; total: number };

const EMPTY: PendingCounts = { leave: 0, corrections: 0, tickets: 0, total: 0 };

/**
 * What is waiting on the current user (Home 1.1.3): leave requests, attendance
 * corrections and assigned tickets. Each endpoint already excludes the user's
 * own requests, since nobody approves themselves.
 *
 * Refreshes on navigation and every minute.
 */
export function usePendingApprovals(): PendingCounts {
  const pathname = usePathname();
  const [counts, setCounts] = useState<PendingCounts>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const count = (path: string) =>
        apiFetch<unknown[]>(path)
          .then((r) => r.length)
          .catch(() => 0);
      const assigned = apiFetch<{ tickets: { assignedTo?: { id: string } | null }[] }>("/helpdesk?status=OPEN")
        .then((r) => r.tickets.length)
        .catch(() => 0);

      const [leave, corrections, tickets] = await Promise.all([
        count("/leave-requests/pending-approvals"),
        count("/attendance/corrections/pending"),
        assigned,
      ]);
      if (!cancelled) setCounts({ leave, corrections, tickets, total: leave + corrections + tickets });
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
