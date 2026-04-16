/**
 * Intent Gates (Fix 2B)
 *
 * Deterministic pre-LLM intent detectors. Unlike the legacy intent-gate.ts,
 * these do NOT bypass the LLM — they only narrow the LLM's tool selection
 * when user intent is unambiguous, so the model cannot pick the wrong tool
 * for a clearly-phrased request.
 *
 * Two gates today:
 *   - detectValueSetIntent: value-assignment phrasing ("set X to Y",
 *     "calibrate X at Y", etc.) with a concrete matching factor in the
 *     graph. Returns the factor id. Used to force tool_choice to
 *     set_factor_value.
 *   - detectStructuralEditIntent: phrasing implying the user wants to
 *     rewire / fix a connection. Used to force tool_choice to edit_graph.
 *
 * Both gates fall through to 'auto' on any ambiguity. They do not invent
 * tool availability — pipeline-v4 only forces a tool_choice if the target
 * tool survived all context filters.
 *
 * Design note: detectValueSetIntent's token-overlap check requires that
 * every non-stop-word token of a factor's label appears in the user's
 * message. This prevents false matches like "set your priorities" (no
 * factor called "priorities") while correctly matching "set salary to
 * £95k" → factor "Salary".
 */

import type { DeterministicTurnContext } from "./types.js";

// ============================================================================
// Regexes
// ============================================================================

export const VALUE_SET_INTENT_RE =
  /\b(set|update|change|calibrate|adjust)\b[^]{0,40}?\b(to|at|=|is|are|be|of)\b/i;

// Mirrors edit-graph.ts STRUCTURAL_INTENT_RE. Kept in sync — if either
// changes the other must follow.
export const STRUCTURAL_EDIT_INTENT_RE =
  /\b(connect|disconnect|fix|wire|link|rewire|add.*connection|remove.*connection|isn'?t connected|not connected|missing connection)\b/i;

// ============================================================================
// Tokenisation
// ============================================================================

const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'of', 'to', 'is', 'it', 'its', 'at', 'by', 'in', 'on',
  'for', 'with', 'from', 'as', 'and', 'or', 'but', 'if', 'be', 'are', 'was',
  'were', 'am', 'my', 'your', 'our', 'their', 'his', 'her', 'this', 'that',
  'these', 'those', 'any', 'all', 'some', 'new', 'old',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s_\-,.()/\\[\]{}"'£$€¥₹%#@!?*&+:;]+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ''))
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

// ============================================================================
// Gates
// ============================================================================

/**
 * Detect a value-assignment intent that unambiguously targets a single
 * factor in the graph. Returns the matched factor id, or null if:
 *   - the message doesn't match the value-assignment regex,
 *   - no factor's label tokens are all present in the message, or
 *   - 2+ factors tie for best match (ambiguous — let the handler's
 *     entity resolver ask for clarification).
 */
export function detectValueSetIntent(
  message: string,
  ctx: DeterministicTurnContext,
): string | null {
  if (!VALUE_SET_INTENT_RE.test(message)) return null;

  const msgTokens = tokenize(message);
  if (msgTokens.size === 0) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  let tied = false;

  for (const [id, entry] of ctx.entities.nodes) {
    if (entry.kind !== 'factor') continue;
    const labelTokens = tokenize(entry.label);
    if (labelTokens.size === 0) continue;

    // Every label token must be in the message (label ⊆ message) — this is
    // the "overlap score exceeds threshold" check specified in the plan.
    // It prevents "set the priorities" matching a factor called "Customer
    // priority score", and prevents the gate firing on messages that only
    // happen to share stop-ish words with a factor.
    let matchedAll = true;
    for (const tok of labelTokens) {
      if (!msgTokens.has(tok)) { matchedAll = false; break; }
    }
    if (!matchedAll) continue;

    const score = labelTokens.size;
    if (score > bestScore) {
      bestId = id;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }

  if (tied) return null;
  return bestId;
}

/**
 * Detect a structural-edit intent (connect / rewire / fix / disconnect).
 * Returns true when the message implies the user wants a structural
 * change that edit_graph should handle.
 */
export function detectStructuralEditIntent(message: string): boolean {
  return STRUCTURAL_EDIT_INTENT_RE.test(message);
}

// ============================================================================
// Aggregate result
// ============================================================================

export interface IntentGateResult {
  /** Force tool_choice to this tool when it survives context filters. */
  force_tool?: 'set_factor_value' | 'edit_graph';
  /** Telemetry: which detector fired. */
  reason?: 'value_set' | 'structural_edit';
  /** Telemetry: matched factor id (value_set only). */
  matched_factor_id?: string;
}

/**
 * Compute pre-LLM intent gating for a user turn. Chip-click forcing takes
 * precedence over any result from this function — callers must apply chip
 * forcing first and only fall back to intent gating when no chip is active.
 */
export function computeIntentGates(
  message: string | null | undefined,
  ctx: DeterministicTurnContext,
): IntentGateResult {
  if (!message) return {};

  // Value-set takes precedence over structural — "set the risk factor to
  // connect with X" is a value assignment, not a structural edit. But
  // require a concrete factor match (handled by detectValueSetIntent).
  const valueSetFactorId = detectValueSetIntent(message, ctx);
  if (valueSetFactorId) {
    return {
      force_tool: 'set_factor_value',
      reason: 'value_set',
      matched_factor_id: valueSetFactorId,
    };
  }

  if (detectStructuralEditIntent(message)) {
    return {
      force_tool: 'edit_graph',
      reason: 'structural_edit',
    };
  }

  return {};
}
