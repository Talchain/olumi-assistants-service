/**
 * orchestrator-eval — real assembly path.
 *
 * Runs a fixture's raw analysis projection through the PRODUCTION display
 * formatter, `formatAnalysisForContext`. That formatter is the exact assembly
 * stage the goal-fit fix lives in: it keeps `win_probability` ("wins most
 * often") and `target_fit` ("meets your target") as two distinct percent
 * vocabularies and emits the `TARGET_FIT_DEFINITION` disclosure so the LLM
 * cannot silently conflate them. By assembling through the real formatter (not
 * a re-specified copy), the eval exercises the same projection the orchestrator
 * prompt is actually grounded on.
 *
 * SCOPE (foundation): this exercises the analysis-projection stage only. The
 * full prompt compose (context-pack assembler → system-prompt compose in the
 * turn-executor) is heavier and is deferred to the follow-up — see README.
 */

import { formatAnalysisForContext } from '../../../src/orchestrator-v5/format/format-analysis-for-context.js';
import type { ContextPackAnalysis } from '../../../src/orchestrator-v5/context/context-pack-assembler.js';

/** The display-safe analysis the prompt sees (return type of the prod formatter). */
export type AssembledAnalysis = ReturnType<typeof formatAnalysisForContext>;

/**
 * Assemble the display-safe analysis via the production formatter. Returns
 * `null` when the raw analysis is `null` (mirrors the formatter's contract).
 */
export function assembleAnalysis(raw: ContextPackAnalysis | null): AssembledAnalysis {
  return formatAnalysisForContext(raw);
}
