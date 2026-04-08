/**
 * Post-Analysis Policy
 *
 * Single source of truth for which actions are answered from Zone 2 data
 * (the dynamic prompt block) when fresh analysis is in context, instead of
 * being executed as tool calls.
 *
 * Tool-builder strips these from the tool list when `analysis_summary` is
 * present so the LLM cannot call the handler templates — the handler would
 * intercept the response and the LLM would only emit a 40–60 char stub
 * instead of writing a coached response from the Zone 2 fields
 * (factor_sensitivity, fragile_edges, top_drivers, etc.).
 *
 * NOT removed from chip-builder: chip clicks for these actions are routed
 * via pipeline-v4's Zone 2 path (see `isExplanationChipSuppressedByAnalysis`
 * in tool-builder.ts and its consumer in pipeline-v4.ts). The chip is a
 * conversation prompt, not a tool invocation — the click survives chip
 * generation, the tool is intentionally absent at LLM call time, and
 * pipeline-v4 detects this case to suppress the "tool not available"
 * downgrade and let the LLM respond from analysis_state directly.
 *
 * Adding or removing entries from this set is a contract change — both
 * tool-builder and pipeline-v4 import from here. The shared-constant test
 * in `post-analysis-policy.test.ts` enforces single-sourcing.
 */

import type { ActionName } from "./actions/types.js";

export const POST_ANALYSIS_EXPLANATION_ACTIONS: ReadonlySet<ActionName> = new Set<ActionName>([
  'explain_result',
  'compare_options',
  'what_would_flip',
]);
