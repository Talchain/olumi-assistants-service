/**
 * Holistic whole-graph scorer — LLM layer (wired, key-gated, held).
 *
 * One blinded call per candidate: brief + final graph as ONE artifact, fixed
 * whole-graph rubric, JSON scores. No element decomposition. Consumes ONLY
 * the blind payload; the leak scanner runs on the exact payload sent.
 * Any output produced before judge clearance is watermarked NOT EVIDENCE by
 * the report layer. This is the ONLY LLM scoring prompt in this lane.
 */
import { z } from "zod";
import { extractJson, type LlmClient } from "../../llm/client.ts";
import { buildCallRecord } from "../../compute/cost.ts";
import type { LoadedPrompt } from "../../prompts/loader.ts";
import type { BlindCandidate, CallRecord } from "../../types.ts";

export const HOLISTIC_JUDGE_MODEL = "claude-opus-4-8";
export const HOLISTIC_MAX_TOKENS = 2_048;

const score010 = z.number().min(0).max(10);
export const HolisticVerdictSchema = z.object({
  coherence: score010,
  brief_coverage: score010,
  decision_usefulness: score010,
  parsimony: score010,
  overall: score010,
  rationale: z.string(),
});
export type HolisticVerdict = z.infer<typeof HolisticVerdictSchema>;

export interface HolisticLlmOutcome {
  verdict: HolisticVerdict | null;
  call: CallRecord;
  error: string | null;
}

export function buildHolisticUserContent(blind: BlindCandidate): string {
  return [
    `Decision brief:\n${blind.brief}`,
    `Candidate graph (JSON):\n${JSON.stringify(blind.graph, null, 2)}`,
    blind.open_questions.length > 0
      ? `Open questions surfaced by the candidate:\n${blind.open_questions.map((q) => `- ${q}`).join("\n")}`
      : "Open questions surfaced by the candidate: none",
  ].join("\n\n");
}

export async function scoreHolisticLlm(
  blind: BlindCandidate,
  prompt: LoadedPrompt,
  client: LlmClient,
  model: string = HOLISTIC_JUDGE_MODEL
): Promise<HolisticLlmOutcome> {
  const result = await client.call({
    purpose: `holistic-judge:${blind.blind_id}`,
    model,
    system: prompt.body,
    userContent: buildHolisticUserContent(blind),
    maxTokens: HOLISTIC_MAX_TOKENS,
    thinking: { type: "adaptive" },
  });
  const call = buildCallRecord(`holistic-judge:${blind.blind_id}`, model, result);
  try {
    const parsed = HolisticVerdictSchema.safeParse(extractJson(result.text));
    if (!parsed.success) {
      return { verdict: null, call, error: `holistic verdict failed schema: ${parsed.error.issues[0]?.message}` };
    }
    return { verdict: parsed.data, call, error: null };
  } catch (err) {
    return { verdict: null, call, error: (err as Error).message };
  }
}
