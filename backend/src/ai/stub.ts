import { CompletionRequest, CompletionResult, JsonCompletionProvider } from "./provider";

/**
 * A deterministic provider for local development and tests: no key, no network,
 * no cost. It does not reason — it matches a few keywords to pick one tool, then
 * reads that tool's result back in a sentence. Anything it has no phrasing for
 * is answered with a plain note rather than raw JSON, which is never something
 * a person should see in the chat.
 *
 * Test hooks: `::malformed` returns invalid JSON once, `::tool:<name>` forces a
 * tool, `::action:{…}` proposes that action, and `::navigate:<key>` links.
 */
export class StubProvider implements JsonCompletionProvider {
  readonly name = "stub";
  readonly model = "stub-1";

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    return { text: this.reply(request), inputTokens: null, outputTokens: null };
  }

  private reply(request: CompletionRequest): string {
    const messages = request.messages;
    const last = messages[messages.length - 1]?.content ?? "";
    const question = [...messages].reverse().find((m) => m.role === "user" && !m.content.includes("<tool_result"))?.content ?? "";
    const asked = question.toLowerCase();

    // A malformed reply, once: the next turn carries the correction notice.
    if (asked.includes("::malformed") && !last.includes("valid JSON")) {
      return "sorry, here is some prose instead of JSON";
    }

    const alreadyRan = (name: string) => messages.some((m) => m.content.includes(`<tool_result name="${name}"`));
    const tools = this.toolNames(request.system);

    const forced = /::tool:([a-z_]+)/.exec(asked)?.[1];
    if (forced && !alreadyRan(forced)) {
      return JSON.stringify({ type: "tool", tool: forced, args: {} });
    }

    const actionJson = /::action:(\{.*\})/.exec(question)?.[1];
    if (actionJson) {
      try {
        return JSON.stringify({ type: "answer", text: "Here it is, ready to confirm.", navigate: null, action: JSON.parse(actionJson) });
      } catch {
        // Fall through.
      }
    }

    const page = /::navigate:([a-z_]+)/.exec(asked)?.[1];
    if (page) {
      return JSON.stringify({ type: "answer", text: "That page is here.", navigate: page, action: null });
    }

    // One tool, chosen by keyword, with the overview as the fallback opener.
    if (!forced && !last.includes("<tool_result")) {
      const pick = this.pickTool(asked, tools);
      if (pick && !alreadyRan(pick)) {
        return JSON.stringify({ type: "tool", tool: pick, args: {} });
      }
    }

    const result = this.lastToolResult(messages);
    return JSON.stringify({
      type: "answer",
      text: result ? this.say(result.tool, result.data) : STUB_NOTE,
      navigate: result ? LINK_FOR[result.tool] ?? null : null,
      action: null,
    });
  }

  /** The system prompt lists the tools this role may use; read them back out. */
  private toolNames(system: string): string[] {
    return [...system.matchAll(/^- ([a-z_]+)\(/gm)].map((m) => m[1]);
  }

  private pickTool(asked: string, tools: string[]): string | null {
    for (const [tool, words] of KEYWORDS) {
      if (tools.includes(tool) && words.some((w) => asked.includes(w))) return tool;
    }
    return tools.includes("company_overview") ? "company_overview" : null;
  }

  private lastToolResult(messages: CompletionRequest["messages"]): { tool: string; data: unknown } | null {
    const withResult = [...messages].reverse().find((m) => m.content.includes("<tool_result"));
    if (!withResult) return null;
    const match = /<tool_result name="([a-z_]+)"[^>]*>([\s\S]*?)<\/tool_result>/.exec(withResult.content);
    if (!match) return null;
    try {
      return { tool: match[1], data: JSON.parse(match[2]) };
    } catch {
      return { tool: match[1], data: null };
    }
  }

  /** A sentence per tool. Never the raw result. */
  private say(tool: string, data: unknown): string {
    const d = (data ?? {}) as Record<string, never>;
    const arr = Array.isArray(data) ? (data as unknown[]) : [];

    switch (tool) {
      case "my_leave": {
        const balances = ((d.balances as unknown) ?? []) as { leaveType: string; allocated: number; remaining: number }[];
        const requests = ((d.requests as unknown) ?? []) as unknown[];
        if (!balances.length) {
          return `You have no leave balance set up yet, so I can't tell you what's left. ${
            requests.length ? `You have ${requests.length} leave request(s) on record. ` : ""
          }Ask HR to add your allocation, or open My Leave to request time off.\n\n${STUB_NOTE}`;
        }
        const lines = balances.map((b) => `- ${b.leaveType}: ${b.remaining} day(s) left of ${b.allocated} allocated`);
        return `Here's your leave balance for this year:\n${lines.join("\n")}\n\n${STUB_NOTE}`;
      }
      case "my_attendance": {
        const today = (d.today ?? {}) as { checkedIn?: boolean; checkedOut?: boolean; checkInAt?: string | null };
        const month = (d.thisMonth ?? {}) as { daysPresent?: number; hours?: number };
        const state = today.checkedOut
          ? "You've checked in and out today."
          : today.checkedIn
            ? "You're checked in today."
            : "You haven't checked in today.";
        return `${state} This month: ${month.daysPresent ?? 0} day(s), ${month.hours ?? 0} hour(s).\n\n${STUB_NOTE}`;
      }
      case "pending_approvals": {
        const c = (d.counts ?? {}) as Record<string, number>;
        const total = Object.values(c).reduce((a, b) => a + (b || 0), 0);
        if (!total) return `Nothing is waiting on you right now.\n\n${STUB_NOTE}`;
        const parts = Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
        return `${total} item(s) waiting on you: ${parts.join(", ")}.\n\n${STUB_NOTE}`;
      }
      case "company_overview": {
        const member = (d.member ?? {}) as { name?: string; roles?: string[] };
        return `You're ${member.name ?? "signed in"} at ${d.company ?? "this company"}, with the ${
          (member.roles ?? []).join(", ") || "no"
        } role. Today is ${d.today ?? "today"}, and there are ${d.activeEmployees ?? "an unknown number of"} active employees.\n\n${STUB_NOTE}`;
      }
      case "leave_types": {
        const types = arr as { name: string; defaultDaysPerYear: number }[];
        if (!types.length) return `No leave types are set up for this company yet.\n\n${STUB_NOTE}`;
        return `This company has ${types.map((t) => `${t.name} (${t.defaultDaysPerYear}/year)`).join(", ")}.\n\n${STUB_NOTE}`;
      }
      case "my_payslips":
      case "my_expenses":
      case "my_timesheets":
      case "my_goals":
      case "my_onboarding_tasks":
      case "my_assets":
      case "helpdesk_tickets":
      case "recent_announcements":
      case "search_employees":
        return `I found ${arr.length} record(s).\n\n${STUB_NOTE}`;
      default:
        return `I looked that up with ${tool}.\n\n${STUB_NOTE}`;
    }
  }
}

const STUB_NOTE =
  "(This is the local stub assistant, which only reads one tool and reports it. Set AI_PROVIDER=gemini with a key for real answers.)";

/** First match wins, so put the more specific words first. */
const KEYWORDS: [string, string[]][] = [
  ["pending_approvals", ["approve", "approval", "waiting on me", "to decide", "sign off"]],
  ["leave_types", ["leave type", "leave types", "kinds of leave"]],
  ["my_leave", ["leave", "time off", "holiday", "vacation", "pto", "day off", "days off"]],
  ["my_attendance", ["checked in", "check in", "check out", "attendance", "punch", "clock"]],
  ["my_timesheets", ["timesheet", "hours", "logged time"]],
  ["my_payslips", ["payslip", "salary", "pay ", "net pay", "ctc"]],
  ["my_expenses", ["expense", "claim", "reimburse"]],
  ["my_loans", ["loan", "advance", "emi"]],
  ["my_goals", ["goal", "okr", "objective"]],
  ["my_onboarding_tasks", ["onboarding", "checklist", "my tasks"]],
  ["my_assets", ["asset", "laptop", "equipment", "device"]],
  ["helpdesk_tickets", ["ticket", "help desk", "helpdesk", "support"]],
  ["hr_guide_search", ["policy", "policies", "handbook", "notice period", "guide"]],
  ["recent_announcements", ["announcement", "news"]],
  ["search_employees", ["who is", "who's", "directory", "team", "colleague", "reports to"]],
  ["my_profile", ["my profile", "my details", "my manager", "my department"]],
];

/** Where an answer about each tool naturally points. */
const LINK_FOR: Record<string, string | undefined> = {
  my_leave: "my_leave",
  my_attendance: "my_attendance",
  my_timesheets: "my_timesheet",
  my_payslips: "my_payslips",
  my_expenses: "my_expenses",
  my_loans: "my_loans",
  my_goals: "my_goals",
  my_onboarding_tasks: "my_tasks",
  my_assets: "my_assets",
  pending_approvals: "approvals",
  helpdesk_tickets: "helpdesk",
  recent_announcements: "announcements",
  hr_guide_search: "hr_guide",
  my_profile: "my_profile",
};
