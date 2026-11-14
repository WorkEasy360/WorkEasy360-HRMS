import type { Tone } from "@/ui";

/**
 * Every status the API can return, mapped to a design-system tone. The badge
 * always shows the label and a dot, so status never depends on colour alone.
 */
const STATUS_TONES: Record<string, Tone | undefined> = {
  // Waiting on someone
  PENDING: "warning",

  // In flight
  SHORTLISTED: "info",
  INTERVIEW: "info",
  IN_PROGRESS: "info",
  WAITING: "warning",
  ON_HOLD: "warning",
  SELECTED: "ai",

  // Done or good
  APPROVED: "success",
  ACTIVE: "success",
  AVAILABLE: "success",
  OPEN: "success",
  ONBOARDING: "success",
  JOINED: "success",
  RESOLVED: "success",
  COMPLETED: "success",
  FINALIZED: "success",
  PUBLISHED: "success",
  PRESENT: "success",
  ON_LEAVE: "info",
  NOT_CHECKED_IN: "warning",
  ABSENT: "danger",
  HOLIDAY: undefined,
  WEEKLY_OFF: undefined,

  // Refused
  REJECTED: "danger",

  // Neutral: no tone, so the badge stays on the muted surface.
  DRAFT: undefined,
  APPLIED: undefined,
  CANCELLED: undefined,
  CLOSED: undefined,
  RETIRED: undefined,
  INACTIVE: undefined,
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="c-badge" data-tone={STATUS_TONES[status]}>
      {status
        .toLowerCase()
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")}
    </span>
  );
}
