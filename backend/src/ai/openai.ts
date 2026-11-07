import { CompletionRequest, CompletionResult, JsonCompletionProvider, postJson, ProviderError } from "./provider";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

interface OpenAiResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** OpenAI chat completions, in JSON mode. */
export class OpenAiProvider implements JsonCompletionProvider {
  readonly name = "openai";

  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const body = {
      model: this.model,
      temperature: 0.2,
      max_tokens: request.maxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.system },
        ...request.messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      ],
    };

    const data = (await postJson(ENDPOINT, body, { authorization: `Bearer ${this.apiKey}` }, request.signal, "OpenAI")) as OpenAiResponse;

    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text.trim()) {
      throw new ProviderError(`OpenAI returned no text (${choice?.finish_reason ?? "no choice"})`);
    }

    return {
      text,
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
    };
  }
}
