/**
 * Arm D — advisor-tool arm.
 *
 * Executor claude-sonnet-4-6, advisor claude-opus-4-8 via the server-side
 * advisor tool. Pinned per lane brief: beta header advisor-tool-2026-03-01,
 * tool type advisor_20260301, max_tokens: 2048 on the tool definition.
 * Stores advice text, executor output, and the FULL usage.iterations[] —
 * the only honest cost source for this arm.
 */
import { extractJson } from "../llm/client.ts";
import { buildCallRecord } from "../compute/cost.ts";
import { briefUserContent, emptyOutput, type ArmRunner } from "./types.ts";

export const ADVISOR_BETA = "advisor-tool-2026-03-01";
export const ARM_D_MAX_TOKENS = 16_384;
export const ADVISOR_TOOL_MAX_TOKENS = 2_048;

export function buildAdvisorTool(advisorModel: string): Record<string, unknown> {
  return {
    type: "advisor_20260301",
    name: "advisor",
    model: advisorModel,
    max_tokens: ADVISOR_TOOL_MAX_TOKENS,
  };
}

/** Best-effort text extraction from advisor_tool_result content blocks. */
export function extractAdviceTexts(content: unknown[]): string[] {
  const advice: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as { type?: string; content?: unknown; text?: unknown };
    if (typeof b.type !== "string" || !b.type.includes("advisor")) continue;
    if (typeof b.text === "string") {
      advice.push(b.text);
    } else if (Array.isArray(b.content)) {
      const texts = b.content
        .filter((c): c is { type: string; text: string } =>
          typeof c === "object" && c !== null && typeof (c as { text?: unknown }).text === "string")
        .map((c) => c.text);
      advice.push(texts.length > 0 ? texts.join("\n") : JSON.stringify(b.content));
    } else if (b.content !== undefined) {
      advice.push(JSON.stringify(b.content));
    }
  }
  return advice;
}

export const runArmD: ArmRunner = async (input) => {
  const out = emptyOutput();
  const result = await input.client.call({
    purpose: "arm-d-advisor-draft",
    model: input.models.D.executor,
    system: input.prompts.armDExecutor.body,
    userContent: briefUserContent(input.brief),
    maxTokens: ARM_D_MAX_TOKENS,
    tools: [buildAdvisorTool(input.models.D.advisor)],
    betas: [ADVISOR_BETA],
  });
  out.calls.push(
    buildCallRecord("arm-d-advisor-draft", input.models.D.executor, result, input.models.D.advisor)
  );
  out.armD = {
    advice_texts: extractAdviceTexts(result.content),
    content_block_types: result.contentBlockTypes,
  };
  try {
    out.candidate = extractJson(result.text);
  } catch (err) {
    out.failure = { stage: "arm-d-parse", message: (err as Error).message };
  }
  return out;
};
