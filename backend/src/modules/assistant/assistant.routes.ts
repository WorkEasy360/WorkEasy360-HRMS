import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth } from "../../middleware/auth";
import { ASSISTANT_LIMITS, AssistantTurnError, plainText, runAssistantTurn, ToolOutcome } from "../../ai/assistant";
import {
  AssistantContext,
  assistantCapabilities,
  assistantSystem,
  LINKABLE_RECORDS,
  LinkableRecord,
} from "../../ai/capabilities";
import { ASSISTANT_DAILY_LIMIT, assistantProvider } from "../../ai/config";
import { takeAssistantQuestion } from "../../ai/usage";
import { loadUserContext } from "../../utils/loadUserContext";
import { TOOLS } from "./tools";
import { ACTION_KINDS, parseAction, Proposal, verifyAction } from "./actions";

const router = Router();
router.use(requireAuth);

const askSchema = z.object({
  question: z.string().trim().min(1).max(ASSISTANT_LIMITS.maxQuestionChars),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(ASSISTANT_LIMITS.maxAnswerChars) }))
    .max(ASSISTANT_LIMITS.historyMessages)
    .optional(),
});

export interface AssistantLink {
  label: string;
  path: string;
}

/** Suggestions the panel offers before the first question, filtered by role. */
function suggestionsFor(ctx: AssistantContext): string[] {
  const out: string[] = [];
  if (ctx.employeeId) {
    out.push("How much leave do I have left?", "Am I checked in today?");
  }
  const { actions } = assistantCapabilities(ctx);
  if (actions.some((a) => a.kind.startsWith("decide_"))) out.push("What's waiting on me to approve?");
  if (ctx.permissions.includes("employee:read")) out.push("Who is in the Engineering team?");
  out.push("What's our leave policy?");
  return out.slice(0, 4);
}

async function buildContext(userId: string): Promise<AssistantContext | null> {
  // Read roles and permissions fresh rather than trusting the 15-minute token,
  // so a role change takes effect on the next question.
  const { user, roles, permissions, employeeId } = await loadUserContext(userId);
  const organization = await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { name: true } });
  if (!organization) return null;

  const timeZone = process.env.APP_TIMEZONE?.trim() || "Asia/Kolkata";
  let todayLocal: string;
  try {
    todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    todayLocal = new Date().toISOString().slice(0, 10);
  }

  // Approver either by permission or by having someone report to them.
  const managePermissions = ["leave:manage", "timesheet:manage", "expense:manage", "loan:manage"];
  const directReports =
    employeeId && !managePermissions.some((p) => permissions.includes(p))
      ? await prisma.employee.count({ where: { organizationId: user.organizationId, managerId: employeeId } })
      : 0;

  return {
    organizationId: user.organizationId,
    organizationName: organization.name,
    employeeId,
    memberName: user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email,
    roles,
    permissions,
    timeZone,
    today: todayLocal,
    currency: "INR",
    canApprove: managePermissions.some((p) => permissions.includes(p)) || directReports > 0,
  };
}

/** A page key or a `<record>:<id>`, resolved against what this role may open. */
async function resolveLink(navigate: string | null, ctx: AssistantContext): Promise<AssistantLink | null> {
  if (!navigate) return null;
  const { pages } = assistantCapabilities(ctx);

  const page = pages.find((p) => p.key === navigate);
  if (page) return { label: page.label, path: page.path };

  const [recordType, recordId] = navigate.split(":", 2);
  if (!recordId || !(recordType in LINKABLE_RECORDS)) return null;
  const spec = LINKABLE_RECORDS[recordType as LinkableRecord];
  if (spec.permission && !spec.permission.some((p) => ctx.permissions.includes(p))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(recordId)) return null;

  if (recordType === "employee") {
    const employee = await prisma.employee.findFirst({
      where: { id: recordId, organizationId: ctx.organizationId },
      select: { firstName: true, lastName: true },
    });
    return employee ? { label: `${employee.firstName} ${employee.lastName}`, path: spec.path(recordId) } : null;
  }

  const article = await prisma.hrGuideArticle.findFirst({ where: { id: recordId, organizationId: ctx.organizationId }, select: { title: true } });
  return article ? { label: article.title, path: spec.path(recordId) } : null;
}

router.get("/", async (req, res) => {
  const provider = assistantProvider();
  const ctx = await buildContext(req.user!.sub);
  if (!ctx) return res.status(404).json({ error: "Not found" });

  return res.json({
    enabled: !!provider,
    // Named so the panel can say when answers come from the local stub rather
    // than a model. The model name is deliberately not sent.
    provider: provider?.name ?? null,
    suggestions: suggestionsFor(ctx),
    dailyLimit: ASSISTANT_DAILY_LIMIT,
  });
});

router.post("/", async (req, res) => {
  const provider = assistantProvider();
  if (!provider) {
    return res.status(503).json({ error: "The assistant isn't set up for this deployment yet." });
  }

  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Membership: the user must still belong to a company that exists.
  const ctx = await buildContext(req.user!.sub);
  if (!ctx) return res.status(404).json({ error: "Not found" });

  const withinLimit = await takeAssistantQuestion(ctx.organizationId, ASSISTANT_DAILY_LIMIT);
  if (!withinLimit) {
    return res.status(429).json({ error: "Your company has used today's assistant allowance. It resets tomorrow." });
  }

  const { tools } = assistantCapabilities(ctx);
  const allowedTools = new Set(tools.map((t) => t.name));

  const started = Date.now();
  let result;
  try {
    result = await runAssistantTurn({
      provider,
      system: assistantSystem(ctx),
      history: parsed.data.history ?? [],
      question: parsed.data.question,
      allowedTools,
      // The two lists look alike to a model, and it does reach for an action as
      // if it were a tool. Say which it is rather than just "unknown".
      unknownTool: (name) =>
        (ACTION_KINDS as readonly string[]).includes(name)
          ? `"${name}" is an action, not a tool. There is no tool for it: reply with {"type":"answer", ..., "action":{"kind":"${name}", ...}}.`
          : `Unknown tool "${name}".`,
      // Each tool gets its own short transaction, scoped to this company.
      runTool: async (name, args): Promise<ToolOutcome> => {
        const run = TOOLS[name];
        if (!run) return { ok: false, error: `Unknown tool "${name}".` };
        try {
          const value = await prisma.$transaction((tx) => run(tx, args, ctx), { timeout: 8_000 });
          return { ok: true, result: value };
        } catch {
          // The model gets a plain failure, never the database's words.
          return { ok: false, error: "That lookup failed." };
        }
      },
    });
  } catch (err) {
    const message = err instanceof AssistantTurnError ? err.message : "The assistant is unavailable right now. Please try again.";
    console.log(`[assistant] org=${ctx.organizationId} failed in ${Date.now() - started}ms: ${message}`);
    return res.status(502).json({ error: message });
  }

  const link = await resolveLink(result.answer.navigate, ctx);

  let proposal: Proposal | null = null;
  let actionNote: string | null = null;
  if (result.answer.action) {
    const action = parseAction(result.answer.action);
    if (action) {
      const allowedKinds = new Set(assistantCapabilities(ctx).actions.map((a) => a.kind));
      if (!allowedKinds.has(action.kind)) {
        actionNote = "Your role can't do that.";
      } else {
        const verified = await verifyAction(action, ctx);
        if (verified.ok) proposal = verified.proposal;
        else actionNote = verified.reason;
      }
    }
  }

  // Logged: which tools ran and how it went. Never the question, the answer or the data.
  console.log(
    `[assistant] org=${ctx.organizationId} tools=[${result.toolsUsed.map((t) => `${t.name}:${t.ok ? "ok" : "err"}`).join(",")}]` +
      ` tokens=${result.inputTokens ?? "?"}/${result.outputTokens ?? "?"} proposal=${proposal?.kind ?? "none"} ms=${Date.now() - started}`,
  );

  return res.json({
    text: plainText(result.answer.text),
    link,
    proposal,
    actionNote,
  });
});

export default router;
