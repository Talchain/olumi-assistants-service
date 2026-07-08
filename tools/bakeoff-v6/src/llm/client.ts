/**
 * Thin standalone LLM client for the bake-off.
 *
 * Deliberately NOT the repo's src/adapters/llm/* — those are entangled with
 * src/config (full-env Zod validation at import) and the PMS prompt loader.
 * This client replicates only the CALL SHAPE the arms need, via the official
 * @anthropic-ai/sdk. Keys come from ANTHROPIC_API_KEY; they are never logged
 * and never written to any record or snapshot.
 *
 * Beta surfaces (advisor tool, task budgets) are ahead of the pinned SDK's
 * type definitions, so request bodies are constructed as plain objects and
 * cast at the call boundary. The exact wire fields are pinned in the arms.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface LlmCallRequest {
  purpose: string;
  model: string;
  system?: string;
  userContent: string;
  maxTokens: number;
  /** Only set for models that accept it (sonnet-4-6 mirror path). */
  temperature?: number;
  thinking?: Record<string, unknown>;
  outputConfig?: Record<string, unknown>;
  tools?: Array<Record<string, unknown>>;
  betas?: string[];
}

export interface LlmCallResult {
  text: string | null;
  contentBlockTypes: string[];
  content: unknown[];
  servedModel: string | null;
  stopReason: string | null;
  usage: Record<string, unknown> | null;
  iterations: unknown[] | null;
  latencyMs: number;
}

export interface LlmClient {
  readonly name: string;
  call(req: LlmCallRequest): Promise<LlmCallResult>;
}

export function hasApiKey(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.length > 0;
}

export class AnthropicLlmClient implements LlmClient {
  readonly name = "anthropic";
  private client: Anthropic | null = null;

  sdk(): Anthropic {
    if (!this.client) {
      if (!hasApiKey()) {
        throw new Error("ANTHROPIC_API_KEY not set — the pre-flight gate should have blocked this path");
      }
      this.client = new Anthropic();
    }
    return this.client;
  }

  async call(req: LlmCallRequest): Promise<LlmCallResult> {
    const client = this.sdk();
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: [{ role: "user", content: req.userContent }],
    };
    if (req.system) body.system = req.system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.thinking) body.thinking = req.thinking;
    if (req.outputConfig) body.output_config = req.outputConfig;
    if (req.tools) body.tools = req.tools;

    const started = Date.now();
    let message: Record<string, unknown>;
    if (req.betas && req.betas.length > 0) {
      // Beta path (advisor tool / task budgets). Streaming keeps long
      // generations under HTTP timeouts; finalMessage() returns the full message.
      const stream = client.beta.messages.stream({ ...body, betas: req.betas } as never);
      message = (await stream.finalMessage()) as unknown as Record<string, unknown>;
    } else {
      const stream = client.messages.stream(body as never);
      message = (await stream.finalMessage()) as unknown as Record<string, unknown>;
    }
    const latencyMs = Date.now() - started;

    const content = Array.isArray(message.content) ? (message.content as unknown[]) : [];
    const textBlocks = content.filter(
      (b): b is { type: string; text: string } =>
        typeof b === "object" && b !== null && (b as { type?: string }).type === "text"
    );
    const usage = (message.usage ?? null) as Record<string, unknown> | null;
    const iterations = usage && Array.isArray((usage as { iterations?: unknown }).iterations)
      ? ((usage as { iterations: unknown[] }).iterations)
      : null;

    return {
      text: textBlocks.length > 0 ? textBlocks.map((b) => b.text).join("\n") : null,
      contentBlockTypes: content.map((b) => (typeof b === "object" && b !== null ? String((b as { type?: string }).type) : "unknown")),
      content,
      servedModel: typeof message.model === "string" ? message.model : null,
      stopReason: typeof message.stop_reason === "string" ? message.stop_reason : null,
      usage,
      iterations,
      latencyMs,
    };
  }
}

/** Strip markdown fences and parse the first JSON value in a model reply. */
export function extractJson(text: string | null): unknown {
  if (!text) throw new Error("no text content to parse as JSON");
  let candidate = text.trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidate = fence[1].trim();
  const firstBrace = candidate.search(/[[{]/);
  if (firstBrace > 0) candidate = candidate.slice(firstBrace);
  return JSON.parse(candidate);
}
