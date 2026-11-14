import { prisma } from "../config/prisma";

/**
 * Internal automation (Settings 7.5). A fixed catalog of supported rules with
 * switches and permitted timing options — deliberately not a trigger/condition
 * builder. Everything here implements an existing HR workflow.
 */
export const AUTOMATION_RULES = [
  {
    key: "joining_checklist",
    label: "Create the joining checklist",
    description: "When someone joins — directly or from a candidate — create the essential checklist once.",
    timing: null,
  },
  {
    key: "approval_routing_notice",
    label: "Notify the reviewer of a new request",
    description: "Email the routed manager, or authorized HR, when leave or an attendance correction is submitted.",
    timing: null,
  },
  {
    key: "pending_approval_reminder",
    label: "Remind about pending approvals",
    description: "Remind the reviewer while a request is still waiting.",
    timing: [24, 48, 72],
    defaultTiming: 24,
  },
  {
    key: "joining_task_reminder",
    label: "Remind about incomplete joining tasks",
    description: "Remind a new joiner about checklist items that are still open.",
    timing: [24, 72, 168],
    defaultTiming: 72,
  },
  {
    key: "interview_reminder",
    label: "Remind about scheduled interviews",
    description: "Remind the interviewer before a scheduled interview.",
    timing: [1, 2, 24],
    defaultTiming: 24,
  },
  {
    key: "exit_access_policy",
    label: "Apply the exit access policy",
    description: "On a recorded effective exit, revoke HRMS access. History is retained and other organizations are untouched.",
    timing: null,
  },
] as const;

export type AutomationKey = (typeof AUTOMATION_RULES)[number]["key"];

const RULE_BY_KEY = new Map(AUTOMATION_RULES.map((r) => [r.key as string, r]));

export function isKnownAutomationKey(key: string): key is AutomationKey {
  return RULE_BY_KEY.has(key);
}

/** Timing options a rule accepts; empty when the rule has no timing. */
export function allowedTimings(key: string): readonly number[] {
  const rule = RULE_BY_KEY.get(key);
  return rule && rule.timing ? rule.timing : [];
}

export type ResolvedAutomation = { key: string; enabled: boolean; timingHours: number | null };

/**
 * Stored switches merged over the catalog defaults, so a rule that was never
 * touched still reports its real behaviour.
 */
export async function resolveAutomations(organizationId: string): Promise<ResolvedAutomation[]> {
  const stored = await prisma.automationSetting.findMany({ where: { organizationId } });
  const byKey = new Map(stored.map((s) => [s.key, s]));
  return AUTOMATION_RULES.map((rule) => {
    const row = byKey.get(rule.key);
    const defaultTiming = "defaultTiming" in rule ? rule.defaultTiming : null;
    return {
      key: rule.key,
      enabled: row?.enabled ?? true,
      timingHours: row?.timingHours ?? defaultTiming ?? null,
    };
  });
}

export async function isAutomationEnabled(organizationId: string, key: AutomationKey): Promise<boolean> {
  const row = await prisma.automationSetting.findUnique({
    where: { organizationId_key: { organizationId, key } },
    select: { enabled: true },
  });
  // Unset means on: the essential rules are the product's own workflows.
  return row?.enabled ?? true;
}

/**
 * The one essential joining checklist (Employees 2.3). Direct hires and
 * candidate conversions use this same routine, and repeating it must not
 * duplicate tasks (Internal automation rule 06).
 */
export const JOINING_CHECKLIST: { title: string; requiresVerification: boolean }[] = [
  { title: "Complete your personal and employment details", requiresVerification: false },
  { title: "Submit your required documents", requiresVerification: true },
  { title: "Read the company HR policies", requiresVerification: false },
];

export async function createJoiningChecklist(organizationId: string, employeeId: string): Promise<void> {
  try {
    if (!(await isAutomationEnabled(organizationId, "joining_checklist"))) return;

    // Idempotent by title: a retried conversion or a re-run must not duplicate.
    const existing = await prisma.onboardingTask.findMany({
      where: { organizationId, employeeId, title: { in: JOINING_CHECKLIST.map((t) => t.title) } },
      select: { title: true },
    });
    const have = new Set(existing.map((t) => t.title));
    const missing = JOINING_CHECKLIST.filter((t) => !have.has(t.title));
    if (missing.length === 0) return;

    await prisma.onboardingTask.createMany({
      data: missing.map((t) => ({
        organizationId,
        employeeId,
        title: t.title,
        requiresVerification: t.requiresVerification,
      })),
    });
  } catch (err) {
    // A failed checklist must not undo a successful joining (rule 06).
    console.error("Joining checklist creation failed", err);
  }
}
