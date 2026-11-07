import { ChatMessage, JsonCompletionProvider, ProviderError } from "./provider";

/**
 * The assistant turn: the loop, the reply format and the limits. This half is
 * the same in every WorkEasy360 product; what the assistant can see and do
 * lives in capabilities.ts. See docs/04-ai-assistant.md.
 */

export const ASSISTANT_LIMITS = {
  /** Read-only tool calls allowed in one question. */
  maxTools: 4,
  /** Wall clock for the whole turn, model calls and tools together. */
  turnMs: 50_000,
  maxOutputTokens: 1_500,
  /** Messages of prior conversation sent back to the model. */
  historyMessages: 12,
  maxQuestionChars: 2_000,
  /** A tool result longer than this is cut; the model is told it was cut. */
  toolResultChars: 12_000,
  maxAnswerChars: 4_000,
} as const;

export type AssistantReply =
  | { type: "tool"; tool: string; args: Record<string, unknown> }
  | { type: "answer"; text: string; navigate: string | null; action: Record<string, unknown> | null };

const CORRECTION = 'Your last message was not valid JSON in the required format. Reply with exactly one JSON object and nothing else.';

/**
 * Pull one JSON object out of a model reply. Providers in JSON mode still
 * sometimes wrap it in a code fence or add a sentence, so this is forgiving
 * about packaging and strict about shape.
 */
export function parseAssistantReply(raw: string): AssistantReply | null {
  const text = raw.trim();
  if (!text) return null;

  const candidates: string[] = [text];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) candidates.push(fenced[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

  for (const candidate of candidates) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    const reply = validate(value);
    if (reply) return reply;
  }
  return null;
}

function validate(value: unknown): AssistantReply | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;

  if (obj.type === "tool") {
    if (typeof obj.tool !== "string" || !obj.tool.trim()) return null;
    const args = obj.args && typeof obj.args === "object" && !Array.isArray(obj.args) ? (obj.args as Record<string, unknown>) : {};
    return { type: "tool", tool: obj.tool.trim(), args };
  }

  if (obj.type === "answer") {
    if (typeof obj.text !== "string") return null;
    const navigate = typeof obj.navigate === "string" && obj.navigate.trim() ? obj.navigate.trim() : null;
    const action = obj.action && typeof obj.action === "object" && !Array.isArray(obj.action) ? (obj.action as Record<string, unknown>) : null;
    return { type: "answer", text: obj.text, navigate, action };
  }

  return null;
}

/**
 * Model text on its way to the browser. The panel renders plain text, so this
 * only has to stop control characters, runaway length and anything that looks
 * like markup.
 */
export function plainText(raw: string): string {
  return raw
    .replace(/<[^>\n]{0,200}>/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, ASSISTANT_LIMITS.maxAnswerChars);
}

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };
export type ToolRunner = (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;

export interface TurnOptions {
  provider: JsonCompletionProvider;
  system: string;
  /** Earlier turns, oldest first. Trimmed to the history limit. */
  history: ChatMessage[];
  question: string;
  runTool: ToolRunner;
  /** Names the role may call. Anything else is refused without running. */
  allowedTools: Set<string>;
  /**
   * How to word the refusal when the model asks for a tool that is not listed.
   * The tool still never runs; this only decides what the model is told, which
   * is the difference between it giving up and it correcting itself.
   */
  unknownTool?: (name: string) => string;
  now?: () => number;
}

export interface TurnResult {
  answer: Extract<AssistantReply, { type: "answer" }>;
  toolsUsed: { name: string; ok: boolean }[];
  inputTokens: number | null;
  outputTokens: number | null;
}

export class AssistantTurnError extends Error {}

/**
 * One question, start to finish: ask the model, run whatever read-only tools it
 * asks for, and come back with an answer. Never writes anything — an action in
 * the answer is a suggestion the caller still has to verify.
 */
export async function runAssistantTurn(options: TurnOptions): Promise<TurnResult> {
  const { provider, system, question, runTool, allowedTools } = options;
  const now = options.now ?? Date.now;
  const deadline = now() + ASSISTANT_LIMITS.turnMs;

  const messages: ChatMessage[] = [
    ...options.history.slice(-ASSISTANT_LIMITS.historyMessages),
    { role: "user", content: question.slice(0, ASSISTANT_LIMITS.maxQuestionChars) },
  ];

  const toolsUsed: { name: string; ok: boolean }[] = [];
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let corrected = false;

  // One slot per tool, plus the call that produces the answer, plus a retry
  // slot for a single malformed reply.
  for (let step = 0; step < ASSISTANT_LIMITS.maxTools + 2; step++) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new AssistantTurnError("The assistant took too long. Please try again.");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let text: string;
    try {
      const result = await provider.complete({
        system,
        messages,
        maxOutputTokens: ASSISTANT_LIMITS.maxOutputTokens,
        signal: controller.signal,
      });
      text = result.text;
      inputTokens = sum(inputTokens, result.inputTokens);
      outputTokens = sum(outputTokens, result.outputTokens);
    } catch (err) {
      if (err instanceof ProviderError) throw new AssistantTurnError("The assistant is unavailable right now. Please try again.");
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const reply = parseAssistantReply(text);

    if (!reply) {
      // One correction, then give up: a model that cannot produce the format
      // twice in a row will not produce it on the third try either.
      if (corrected) throw new AssistantTurnError("The assistant could not answer that. Please rephrase and try again.");
      corrected = true;
      messages.push({ role: "assistant", content: text.slice(0, 500) }, { role: "user", content: CORRECTION });
      continue;
    }

    if (reply.type === "answer") {
      return { answer: reply, toolsUsed, inputTokens, outputTokens };
    }

    if (toolsUsed.length >= ASSISTANT_LIMITS.maxTools) {
      messages.push(
        { role: "assistant", content: JSON.stringify(reply) },
        { role: "user", content: "No more tools are available for this question. Answer with what you have." },
      );
      continue;
    }

    const outcome = allowedTools.has(reply.tool)
      ? await runTool(reply.tool, reply.args)
      : ({ ok: false, error: options.unknownTool?.(reply.tool) ?? `Unknown tool "${reply.tool}".` } as ToolOutcome);

    toolsUsed.push({ name: reply.tool, ok: outcome.ok });
    messages.push({ role: "assistant", content: JSON.stringify(reply) }, { role: "user", content: toolResultBlock(reply.tool, outcome) });
  }

  throw new AssistantTurnError("The assistant could not answer that. Please rephrase and try again.");
}

function sum(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/**
 * Tool output goes back as data inside a tag. The prompt tells the model that
 * anything inside these tags is data and never an instruction.
 */
function toolResultBlock(name: string, outcome: ToolOutcome): string {
  if (!outcome.ok) return `<tool_result name="${name}" status="error">${outcome.error}</tool_result>`;

  const json = JSON.stringify(outcome.result ?? null);
  const body = json.length > ASSISTANT_LIMITS.toolResultChars ? `${json.slice(0, ASSISTANT_LIMITS.toolResultChars)}… (truncated)` : json;
  return `<tool_result name="${name}">${body}</tool_result>`;
}
