/**
 * The model-provider seam. Everything above it works in one shape, so swapping
 * Gemini for OpenAI (or for the deterministic stub) changes no assistant code.
 *
 * Shared across WorkEasy360 products: see docs/04-ai-assistant.md.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  /** The system prompt: who the assistant is, plus the reply format and context. */
  system: string;
  /** The conversation so far, oldest first. */
  messages: ChatMessage[];
  maxOutputTokens: number;
  /** Aborted when the turn runs out of time. */
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * A provider that is asked for, and expected to return, a single JSON object.
 * Providers set whatever "JSON mode" they offer; the caller validates anyway,
 * because a provider promising JSON is not the same as it being the JSON we want.
 */
export interface JsonCompletionProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Shared fetch wrapper: times out with the turn, and never leaks the key in an error. */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  providerName: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderError(`${providerName} timed out`);
    }
    throw new ProviderError(`${providerName} is unreachable`);
  }

  if (!response.ok) {
    // The body can echo the request; keep only the status so no prompt or key is logged.
    throw new ProviderError(`${providerName} returned ${response.status}`, response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new ProviderError(`${providerName} returned a malformed body`);
  }
}
