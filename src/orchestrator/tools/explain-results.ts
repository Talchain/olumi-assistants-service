/**
 * explain_results — LEGACY V1 STUB
 *
 * This file was the V1 explain_results tool handler (~1200 lines of
 * LLM-driven commentary generation across three deterministic tiers).
 *
 * As of Fix 7 (April 2026) the V1 pipeline is unreachable in production:
 * `CEE_PIPELINE_V4_ENABLED` is the permanent routing path, and
 * pipeline-stream.ts returns immediately once V4 executes. The live
 * explain_result handler is now the V4 deterministic action at
 * src/orchestrator/deterministic/actions/explain-result.ts.
 *
 * The file is reduced to a typed stub because three V1 callers still
 * import it (pipeline.ts, dispatch.ts, turn-handler.ts) and deleting
 * the imports would require unwinding the entire V1 pipeline — a
 * separate decommission task. The stub preserves the type surface so
 * the V1 files still compile while making the runtime behaviour
 * unambiguously an error if any dead branch is ever reached.
 *
 * If you are reading this because a V1 callsite is live again: don't
 * resurrect this file — port the logic you need to the V4 action.
 */

import type { LLMAdapter } from "../../adapters/llm/types.js";
import type { TypedConversationBlock, ConversationContext } from "../types.js";

export interface ExplainResultsResult {
  blocks: TypedConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
  /** Which tier resolved this turn: 1 = cached deterministic, 2 = review data, 3 = LLM. */
  deterministic_answer_tier?: 1 | 2 | 3;
}

const DEAD_PATH_MESSAGE =
  'V1 explain_results handler is unreachable under CEE_PIPELINE_V4_ENABLED. ' +
  'Use the V4 deterministic action at src/orchestrator/deterministic/actions/explain-result.ts.';

/**
 * @deprecated V1 pipeline only. Unreachable under V4. Throws if invoked.
 */
export async function handleExplainResults(
  _context: ConversationContext,
  _adapter: LLMAdapter,
  _requestId: string,
  _turnId: string,
  _focus?: string,
): Promise<ExplainResultsResult> {
  throw new Error(DEAD_PATH_MESSAGE);
}

/**
 * @deprecated V1 pipeline only. Unreachable under V4. Returns an empty chip list.
 * (Returns rather than throws because `dispatch.ts` still reads it unconditionally
 * when building route metadata; an empty array is a safe no-op.)
 */
export function buildExplainChips(
  _context: ConversationContext,
): Array<{ label: string; prompt: string; role: 'facilitator' | 'challenger' }> {
  return [];
}
