"use client";

import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, UserCheck } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AttendanceSummary } from "@/lib/types";
import { Button } from "@/ui";
import { errorMessage, useFeedback } from "./feedback";
import { formatTime } from "./format";

/**
 * The signed-in person's own check in / check out, as a compact bar.
 *
 * HR and admins are employees too: their dashboards show the organization, so
 * this bar is how they record their own day. Hidden for a login without an
 * employee record, since there is nobody to check in.
 */
export function MyCheckIn({ onChange }: { onChange?: () => void }) {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [summary, setSummary] = useState<(AttendanceSummary & { today?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const hasEmployee = !!user?.employee;

  const load = useCallback(async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setSummary(await apiFetch<AttendanceSummary & { today?: string }>(`/attendance/summary?month=${month}`).catch(() => null));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    if (hasEmployee) load();
  }, [hasEmployee, load]);

  if (!hasEmployee || !summary) return null;

  // "Today" is the organization's calendar day, as the server counts it.
  const todayKey = summary.today;
  const record = summary.records.find((r) => r.date.slice(0, 10) === todayKey);
  const checkedIn = !!record?.checkInAt;
  const checkedOut = !!record?.checkOutAt;

  async function punch(which: "check-in" | "check-out") {
    setBusy(true);
    try {
      await apiFetch(`/attendance/${which}`, { method: "POST" });
      toast.success(which === "check-in" ? "Checked in" : "Checked out");
      await load();
      onChange?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="c-card flex flex-wrap items-center gap-4 px-5 py-4">
      <span className="c-icon-tile" data-size="sm" aria-hidden>
        <UserCheck strokeWidth={2} />
      </span>
      <div className="min-w-48 flex-1">
        <p className="text-sm font-semibold text-heading">
          My day ·{" "}
          {checkedOut ? "Checked out" : checkedIn ? "Checked in" : "Not checked in yet"}
        </p>
        <p className="text-sm text-secondary">
          {checkedIn ? `In at ${formatTime(record!.checkInAt)}` : "Record your own attendance here."}
          {checkedOut ? ` · out at ${formatTime(record!.checkOutAt)}` : ""}
        </p>
      </div>
      {!checkedIn && (
        <Button icon={LogIn} loading={busy} onClick={() => punch("check-in")}>
          Check In
        </Button>
      )}
      {checkedIn && !checkedOut && (
        <Button variant="secondary" icon={LogOut} loading={busy} onClick={() => punch("check-out")}>
          Check Out
        </Button>
      )}
    </div>
  );
}
