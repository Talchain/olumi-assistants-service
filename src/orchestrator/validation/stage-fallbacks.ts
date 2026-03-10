/**
 * Stage + Tool Aware Fallback Messages
 *
 * Deterministic fallback text for when all LLM-requested tools are suppressed
 * and the LLM produced no assistant text. Used by Phase 4 and the response
 * contract validator.
 *
 * Lookup key priority:
 *   1. `${stage}:${tool}` — most specific (stage + suppressed tool)
 *   2. `${stage}:*`       — stage-only fallback
 *   3. GENERIC_FALLBACK   — last resort
 */

import type { DecisionStage } from '../types.js';

// ============================================================================
// Fallback table
// ============================================================================

/**
 * Keys are `${stage}:${tool}` or `${stage}:*` for stage-only fallback.
 * Values from the task spec fallback table.
 */
const FALLBACK_TABLE: Record<string, string> = {
  // frame stage — tool-specific
  'frame:research_topic': "I'll focus on framing your decision first. What's the primary objective?",
  'frame:edit_graph':     "Let's build the model first. What outcome are you optimising for?",
  // frame stage — generic
  'frame:*':              "I'll focus on framing your decision first. What's the primary objective?",

  // ideate stage — tool-specific
  'ideate:draft_graph':   "The current model can be edited directly. What would you like to change?",
  'ideate:run_analysis':  "The model needs configured options before analysis. Would you like help setting those up?",
  // ideate stage — generic
  'ideate:*':             "The current model can be edited directly. What would you like to change?",

  // evaluate stage
  'evaluate:*':           "The model needs configured options before analysis. Would you like help setting those up?",

  // decide stage
  'decide:*':             "Let's look at what the analysis tells us to help finalize your decision.",

  // optimise stage
  'optimise:*':           "I can help you refine the model or re-run the analysis with adjusted assumptions.",
};

const GENERIC_FALLBACK = "I processed your request but need more context to proceed. Could you rephrase?";

// ============================================================================
// Public API
// ============================================================================

/**
 * Get a deterministic fallback message for a suppressed turn.
 *
 * @param stage  Current decision stage (from stage_indicator.stage).
 * @param tool   Name of the suppressed tool, if known. Enables the most
 *               specific fallback. Omit for a stage-only lookup.
 */
export function getStageAwareFallback(stage: DecisionStage | string, tool?: string): string {
  if (tool) {
    const specific = FALLBACK_TABLE[`${stage}:${tool}`];
    if (specific) return specific;
  }
  return FALLBACK_TABLE[`${stage}:*`] ?? GENERIC_FALLBACK;
}
