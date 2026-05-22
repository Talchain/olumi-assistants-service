/**
 * V5 edit lifecycle recovery v1 — narrow vague-edit guard.
 *
 * Sits in route-v2.ts immediately after the chip-simplify intercept and
 * BEFORE `dispatchEditGraph`. Suppresses the V4 `edit_graph` LLM call
 * for messages that have already cleared the route-v2 edit gates
 * (`EDIT_GRAPH_POSITIVE_REGEX` matched, `EDIT_GRAPH_NEGATIVE_REGEX`
 * did not, `isValueUpdatePhrasing` is false) but are too underspecified
 * for the LLM to do anything useful with — no numeric value, no factor
 * / edge / option label anchor, no add/remove/insert/create construct,
 * no mutation-signal regex hit.
 *
 * The diagnostic from the 2026-05-22 V5 edit-lifecycle investigation
 * found that this class of message either returns empty operations
 * (`recoveryPathChosen: 'none'` at edit-graph.ts:1869) or burns a
 * 6–35s LLM call producing a structured rejection that the user
 * cannot act on. Both outcomes degrade UX more than a deterministic
 * "tell me what you want to change" reply would.
 *
 * Scope discipline (matches the user's brief explicitly):
 *
 *   MUST match (intercept):
 *     - "Simplify the change"
 *     - "Change this"
 *     - "Edit it to be cleaner"
 *     - "Adjust this somehow"
 *     - "Tweak this for me"
 *
 *   MUST NOT match (let through to existing routes):
 *     - "Set Hiring and Salary Cost to £100,000"  (PR #192 deterministic path)
 *     - "Change Hiring and Salary Cost from £80,000 to £100,000"
 *     - "Add a risk for coordination overhead"    (existing add-risk path)
 *     - "What could change the outcome?"          (analytical question)
 *     - "What if we lowered cost?"                 (hypothetical)
 *     - any message containing a graph factor / edge / option label
 *     - any message with a numeric value or %/£/$ token
 *
 * Privacy / safety contract:
 *  - Pure function. No I/O, no telemetry, no side effects.
 *  - Re-uses `hasMutationSignal`, the canonical mutation-signal regex
 *    set from `analytical-intent.ts`. Does NOT redefine those patterns
 *    (PR #192 round-4 lesson: shared grammar must be imported).
 *  - Re-uses `isValueUpdatePhrasing` from `value-update-gate.ts`.
 *  - Label anchoring is substring-only (case-insensitive). No Dice /
 *    fuzzy matching — the goal is to LET concrete edits through, not
 *    to chase ambiguous near-misses.
 *
 * Out of scope for this PR (per the user's tightened brief):
 *  - No new boundary `action_type` value.
 *  - No CQE quantity extraction. Numeric detection is a narrow regex
 *    that catches digits / % / currency tokens — enough to filter out
 *    "set X to 0.7" / "increase by £100" / "30% lower" without taking
 *    on the CQE attribution surface.
 *  - No deictic / pronoun handling. "Change that" already escapes this
 *    guard because "that" is not a label, so it intercepts cleanly.
 */

import { hasMutationSignal } from './analytical-intent.js';
import { isValueUpdatePhrasing } from '../../orchestrator/routing/value-update-gate.js';

/**
 * Minimal node shape needed for label anchoring. Compatible with both
 * `GraphStateIngress` (passthrough Zod parse) and any caller that has
 * already projected its node list down to id/kind/label triples.
 */
export interface VagueEditGuardNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

export type VagueEditGuardUnmatchedReason =
  | 'empty_message'
  | 'question_shape'
  | 'mutation_signal_present'
  | 'value_update_phrasing_present'
  | 'structural_keyword_present'
  | 'numeric_token_present'
  | 'graph_label_present';

export type VagueEditGuardResult =
  | { readonly matched: true }
  | { readonly matched: false; readonly reason: VagueEditGuardUnmatchedReason };

/**
 * Numeric / quantitative token guard. Matches digits, currency symbols,
 * and common large-number suffixes. Narrower than CQE — its job is to
 * REJECT messages that any reasonable reader would see as containing a
 * concrete value, not to attribute quantities to factors.
 *
 * Patterns:
 *   - bare digit run: `100`, `0.7`, `1,500`
 *   - currency symbols: `£`, `$`, `€`, `¥`
 *   - percent: `30%`
 *   - written magnitudes: `100k`, `2m`, `1.5bn`
 */
const NUMERIC_TOKEN_PATTERN =
  /(?:\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|bn|mm|%))?\b|[£$€¥])/i;

/**
 * Structural / add-remove keywords that must NEVER be intercepted as
 * vague. Even without an anchor, "add a risk" / "remove the thing"
 * should reach edit_graph LLM (which knows how to ask for the missing
 * driver via the add-risk classifier or fall through to clarification
 * naturally). Excluding these keeps the guard surgical.
 */
const STRUCTURAL_KEYWORD_PATTERN =
  /\b(?:add|insert|create|remove|delete|drop|new|another)\b/i;

/**
 * Question-shape detector. We don't want to intercept analytical or
 * exploratory questions even if they contain a positive edit verb
 * (e.g. "what could change the outcome?", "could you update this?").
 *
 * Two signals — either alone is sufficient to treat the message as a
 * question:
 *   1. Ends with `?` (after trimming trailing whitespace).
 *   2. Starts with an interrogative or modal-auxiliary token
 *      (what / how / why / when / where / who / which / can / could /
 *       would / should / does / do / is / are / will).
 */
const QUESTION_LEAD_PATTERN =
  /^(?:what|how|why|when|where|who|which|can|could|would|should|does|do|is|are|will)\b/i;

/**
 * Returns `matched: true` when the message looks like a vague,
 * unanchored edit request that should NOT pay for an `edit_graph` LLM
 * call. Returns `matched: false` with a discriminator reason otherwise
 * so the caller can emit precise telemetry / preserve the existing
 * route.
 *
 * @param message       the user-typed (or chip-submitted) message
 * @param nodes         current graph nodes (passthrough Zod shape).
 *                      Used ONLY for label-anchor detection; an empty
 *                      array is acceptable (skips the anchor check
 *                      gracefully, but other guards still apply).
 */
export function tryVagueEditGuard(
  message: string,
  nodes: readonly VagueEditGuardNode[] | null | undefined,
): VagueEditGuardResult {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { matched: false, reason: 'empty_message' };
  }

  const trimmed = message.trim();

  if (trimmed.endsWith('?') || QUESTION_LEAD_PATTERN.test(trimmed)) {
    return { matched: false, reason: 'question_shape' };
  }

  if (hasMutationSignal(trimmed)) {
    return { matched: false, reason: 'mutation_signal_present' };
  }

  if (isValueUpdatePhrasing(trimmed)) {
    return { matched: false, reason: 'value_update_phrasing_present' };
  }

  if (STRUCTURAL_KEYWORD_PATTERN.test(trimmed)) {
    return { matched: false, reason: 'structural_keyword_present' };
  }

  if (NUMERIC_TOKEN_PATTERN.test(trimmed)) {
    return { matched: false, reason: 'numeric_token_present' };
  }

  if (containsGraphLabel(trimmed, nodes)) {
    return { matched: false, reason: 'graph_label_present' };
  }

  return { matched: true };
}

function containsGraphLabel(
  message: string,
  nodes: readonly VagueEditGuardNode[] | null | undefined,
): boolean {
  if (!nodes || nodes.length === 0) return false;
  const lower = message.toLowerCase();
  for (const node of nodes) {
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    if (label.length < 3) continue;
    if (lower.includes(label.toLowerCase())) return true;
  }
  return false;
}
