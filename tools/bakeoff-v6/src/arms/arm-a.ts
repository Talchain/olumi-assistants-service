/**
 * Arm A — mirror of the CURRENT served single-model draft, as an offline call.
 *
 * Mirrored parameters (source: src/adapters/llm/anthropic.ts draft path at the
 * pinned base SHA; PMS itself is never touched):
 *   - model: claude-sonnet-4-6 (served default; memory: PMS modelConfig serves
 *     the same ID, no thinking)
 *   - temperature: 0 (no-thinking draft path)
 *   - max_tokens: 16384 (DRAFT_MAX_TOKENS_DEFAULT; CEE_MAX_TOKENS_DRAFT
 *     assumed unset on staging — UNVERIFIED, recorded in provenance)
 *   - structured outputs: GA output_config.format json_schema with the REAL
 *     ANTHROPIC_DRAFT_GRAPH_SCHEMA imported read-only (staging flag state
 *     UNVERIFIED — recorded in provenance)
 *   - system prompt: SLOT ONLY. The served prompt lives in PMS; Paul drops the
 *     captured text into prompts/arm-a.system.txt.
 */
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../../../../src/cee/draft/anthropic-graph-schema.ts";
import { extractJson } from "../llm/client.ts";
import { buildCallRecord } from "../compute/cost.ts";
import { STRUCTURED_OUTPUTS_AUX_STRING_REMINDER } from "../llm/structured-aux.ts";
import { briefUserContent, emptyOutput, m1ThinkingConfig, type ArmRunner } from "./types.ts";

export const ARM_A_MAX_TOKENS = 16384;

export const runArmA: ArmRunner = async (input) => {
  const out = emptyOutput();
  const tc = m1ThinkingConfig(input, ARM_A_MAX_TOKENS);
  const result = await input.client.call({
    purpose: "arm-a-draft",
    model: input.models.A.model,
    system: input.prompts.armA.body,
    // Grammar arm: append the adapter's stringified-aux reminder (mirrors the
    // live path). The v0.4.x no-think draft mirror = explicit thinking disabled
    // (Sonnet 5 defaults to adaptive when omitted); no temperature (400 on Sonnet 5).
    // The M1 thinking axis (m1ThinkingConfig) can switch this to adaptive+effort.
    userContent: briefUserContent(input.brief) + STRUCTURED_OUTPUTS_AUX_STRING_REMINDER,
    maxTokens: tc.maxTokens,
    thinking: tc.thinking,
    outputConfig: {
      format: { type: "json_schema", schema: ANTHROPIC_DRAFT_GRAPH_SCHEMA as Record<string, unknown> },
      ...(tc.effort ? { effort: tc.effort } : {}),
    },
  });
  out.calls.push(buildCallRecord("arm-a-draft", input.models.A.model, result));
  try {
    out.candidate = extractJson(result.text);
  } catch (err) {
    out.failure = { stage: "arm-a-parse", message: (err as Error).message };
  }
  return out;
};
