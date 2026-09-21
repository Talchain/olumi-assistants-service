/**
 * Stage + Tool Aware Fallback Messages
 *
 * Deterministic fallback text for when all LLM-requested tools are suppressed
 * and the LLM produced no assistant text. Used by Phase 4 and the response
 * contract validator.
 *
 * Two-dimensional lookup: suppressed tool × stage.
 *
 * Lookup key priority:
 *   1. `${stage}:${tool}` — most specific (stage + suppressed tool)
 *   2. `${stage}:*`       — stage-only fallback
 *   3. GENERIC_FALLBACK   — last resort
 *
 * Each entry includes a suggested action chip so the user always has
 * an obvious next step.
 */

import type { DecisionStage, SuggestedAction } from '../types.js';

// ============================================================================
// Fallback entry (message + suggested action)
// ============================================================================

interface FallbackEntry {
  message: string;
  chip: SuggestedAction;
}

// ============================================================================
// Fallback table — two-dimensional: stage × tool
// ============================================================================

const FALLBACK_TABLE: Record<string, FallbackEntry> = {
  // ── frame stage ──────────────────────────────────────────────────────────
  'frame:run_analysis':   { message: "We need a model before we can run the analysis. Let's frame the decision first — what outcome are you optimising for?", chip: { label: 'Set the goal', prompt: 'What outcome are you optimising for?', role: 'facilitator' } },
  'frame:edit_graph':     { message: "There's no model to edit yet. Let's build one — what outcome are you optimising for?", chip: { label: 'Draft a model', prompt: 'Help me build a decision model', role: 'facilitator' } },
  'frame:explain_results':{ message: "There are no results to explain yet. Let's start by framing the decision.", chip: { label: 'Set the goal', prompt: 'What outcome are you optimising for?', role: 'facilitator' } },
  'frame:generate_brief': { message: "We'll need a model and analysis before generating a brief. What's the primary objective?", chip: { label: 'Set the goal', prompt: 'What outcome are you optimising for?', role: 'facilitator' } },
  // UNREACHABLE since 2026-07-22 — the `research_topic` tool was deleted in `f957d6d8`, so no
  // turn can route to it and this key can never be looked up. Kept, not deleted: it is a row in a
  // `stage:tool` lookup table, so it costs nothing and starts working again the moment research is
  // rebuilt under the same tool name. Deleting it would fall through to `'frame:*'` below, which
  // still yields a sane message — i.e. the deletion would be invisible, which is exactly why the
  // deadness needs stating here rather than being left to be rediscovered.
  // See `docs-designs/RESEARCH-ARTEFACT-DESIGN-2026-07-25.md` (programme docs, sibling dir — untracked) §2.1.
  'frame:research_topic': { message: "I'll focus on framing your decision first. Once we have a model, I can research specific factors.", chip: { label: 'Set the goal', prompt: "What's the primary objective?", role: 'facilitator' } },
  'frame:run_exercise':   { message: "Exercises work best once you have analysis results. Let's frame the decision first.", chip: { label: 'Set the goal', prompt: "What's the primary objective?", role: 'facilitator' } },
  'frame:*':              { message: "I'll focus on framing your decision first. What's the primary objective?", chip: { label: 'Set the goal', prompt: 'What outcome are you optimising for?', role: 'facilitator' } },

  // ── ideate stage ─────────────────────────────────────────────────────────
  'ideate:draft_graph':   { message: "The current model can be edited directly. What would you like to change?", chip: { label: 'Edit the model', prompt: 'What would you like to change in the model?', role: 'facilitator' } },
  'ideate:run_analysis':  { message: "The model needs configured options before analysis. Would you like help setting those up?", chip: { label: 'Configure options', prompt: 'Help me configure the options for analysis', role: 'facilitator' } },
  'ideate:explain_results':{ message: "I can't explain analysis results yet because analysis hasn't been run. Would you like to run the analysis, or shall I walk through the model structure instead?", chip: { label: 'Run the analysis', prompt: 'Run the analysis', role: 'facilitator' } },
  'ideate:generate_brief': { message: "A brief requires analysis results. Let's run the analysis first.", chip: { label: 'Run analysis', prompt: 'Run the analysis', role: 'facilitator' } },
  'ideate:*':             { message: "The current model can be edited directly. What would you like to change?", chip: { label: 'Edit the model', prompt: 'What would you like to change in the model?', role: 'facilitator' } },

  // ── evaluate stage ───────────────────────────────────────────────────────
  'evaluate:draft_graph': { message: "You already have a model. Would you like to edit it or re-run the analysis?", chip: { label: 'Re-run analysis', prompt: 'Run the analysis again', role: 'facilitator' } },
  'evaluate:*':           { message: "The analysis has run. Would you like me to explain the results, or would you like to adjust and re-run?", chip: { label: 'Explain results', prompt: 'Explain the analysis results', role: 'facilitator' } },

  // ── decide stage ─────────────────────────────────────────────────────────
  'decide:draft_graph':   { message: "You're in the decision phase. Would you like to review the brief, or go back and refine the model?", chip: { label: 'Review the brief', prompt: 'Show me the decision brief', role: 'facilitator' } },
  'decide:*':             { message: "Let's look at what the analysis tells us to help finalise your decision.", chip: { label: 'Review the brief', prompt: 'Show me the decision brief', role: 'facilitator' } },

  // ── optimise stage ───────────────────────────────────────────────────────
  'optimise:*':           { message: "I can help you refine the model or re-run the analysis with adjusted assumptions.", chip: { label: 'Edit the model', prompt: 'What would you like to adjust?', role: 'facilitator' } },
};

const GENERIC_FALLBACK: FallbackEntry = {
  message: "I processed your request but need more context to proceed. Could you rephrase?",
  chip: { label: 'Rephrase', prompt: 'Could you help me with my decision?', role: 'facilitator' },
};

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
  const entry = getStageAwareFallbackEntry(stage, tool);
  return entry.message;
}

/**
 * Get the full fallback entry (message + suggested action chip).
 *
 * Used by Phase 4 and response contract validator to inject both the
 * fallback text and a contextual chip in a single call.
 */
export function getStageAwareFallbackEntry(stage: DecisionStage | string, tool?: string): FallbackEntry {
  if (tool) {
    const specific = FALLBACK_TABLE[`${stage}:${tool}`];
    if (specific) return specific;
  }
  return FALLBACK_TABLE[`${stage}:*`] ?? GENERIC_FALLBACK;
}
