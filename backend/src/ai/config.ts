import { GeminiProvider } from "./gemini";
import { OpenAiProvider } from "./openai";
import { JsonCompletionProvider } from "./provider";
import { StubProvider } from "./stub";

export type ProviderName = "gemini" | "openai" | "stub" | "disabled";

const DEFAULT_MODEL: Record<Exclude<ProviderName, "disabled">, string> = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4.1-mini",
  stub: "stub-1",
};

/** Questions one organization may ask per day. */
export const ASSISTANT_DAILY_LIMIT = clampInt(process.env.ASSISTANT_DAILY_LIMIT, 200, 1, 100_000);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function readProviderName(): ProviderName {
  const raw = (process.env.AI_PROVIDER ?? "disabled").trim().toLowerCase();
  if (raw === "gemini" || raw === "openai" || raw === "stub" || raw === "disabled") return raw;
  throw new Error(`AI_PROVIDER must be gemini, openai, stub or disabled (got "${raw}")`);
}

/**
 * Built once at startup so a missing key fails the boot rather than the first
 * question. `disabled` is the default: the chat then says the assistant is not
 * set up, and nothing else in the API changes.
 */
function build(): JsonCompletionProvider | null {
  const name = readProviderName();
  if (name === "disabled") return null;
  if (name === "stub") return new StubProvider();

  const model = (process.env.AI_MODEL ?? DEFAULT_MODEL[name]).trim();
  if (!model) throw new Error("AI_MODEL must not be empty");

  const keyName = name === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
  const key = process.env[keyName]?.trim();
  if (!key) throw new Error(`${keyName} must be set when AI_PROVIDER=${name}`);

  return name === "gemini" ? new GeminiProvider(model, key) : new OpenAiProvider(model, key);
}

let provider: JsonCompletionProvider | null | undefined;

/** null when the assistant is switched off. Throws only at startup, never per request. */
export function assistantProvider(): JsonCompletionProvider | null {
  if (provider === undefined) provider = build();
  return provider;
}

/** Called from the server's boot sequence so misconfiguration is loud and early. */
export function verifyAssistantConfig(): void {
  const p = assistantProvider();
  console.log(p ? `Assistant provider: ${p.name} (${p.model}), ${ASSISTANT_DAILY_LIMIT}/day per organization` : "Assistant: disabled");
}

/** Test seam. */
export function setAssistantProviderForTests(p: JsonCompletionProvider | null): void {
  provider = p;
}
