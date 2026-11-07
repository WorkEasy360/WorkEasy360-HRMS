import { ChatMessage, CompletionRequest, CompletionResult, JsonCompletionProvider, postJson, ProviderError } from "./provider";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function toContents(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

/** Google Gemini via the Generative Language REST API. */
export class GeminiProvider implements JsonCompletionProvider {
  readonly name = "gemini";

  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: toContents(request.messages),
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: request.maxOutputTokens,
        responseMimeType: "application/json",
      },
    };

    const data = (await postJson(
      `${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`,
      body,
      { "x-goog-api-key": this.apiKey },
      request.signal,
      "Gemini",
    )) as GeminiResponse;

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      // MAX_TOKENS and SAFETY both land here; the caller turns it into one retry.
      throw new ProviderError(`Gemini returned no text (${candidate?.finishReason ?? "no candidate"})`);
    }

    return {
      text,
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
    };
  }
}
