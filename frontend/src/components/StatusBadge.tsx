import type { Tone } from "@/ui";

/**
 * Every status the API can return, mapped to a design-system tone. The badge
 * always shows the label and a dot, so status never depends on colour alone.
 */
const STATUS_TONES: Record<string, Tone | undefined> = {
  // Waiting on someone
  PENDING: "warning",

  // In flight
  SCREENING: "info",
  INTERVIEW: "info",
  IN_PROGRESS: "info",
  ASSIGNED: "info",
  REIMBURSED: "info",
  OFFER: "ai",

  // Done or good
  APPROVED: "success",
  ACTIVE: "success",
  AVAILABLE: "success",
  OPEN: "success",
  ONBOARDING: "success",
  HIRED: "success",
  RESOLVED: "success",
  COMPLETED: "success",
  PROCESSED: "success",

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
      {status.replace(/_/g, " ")}
    </span>
  );
}
