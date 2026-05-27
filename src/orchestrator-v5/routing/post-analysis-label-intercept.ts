/**
 * V5 post-analysis exploration intercept — narrow pre-LLM guards for
 * bare-label and legacy fill-in chip submissions that would otherwise
 * dispatch to V4 `edit_graph` and no-op.
 *
 * Context — the observed staging failure:
 *  1. The post-analysis vague-edit / chip-simplify clarification composer
 *     ([compose/edit-clarify-response.ts](../compose/edit-clarify-response.ts))
 *     renders chips whose submit messages take the form
 *     `"Change Existing Team Size — "` — verb + label + em-dash + trailing
 *     whitespace, NO value after the dash.
 *  2. The chip carries no `action_type`, so the deterministic chip-click
 *     fast path at route-v2.ts:819 does not catch it.
 *  3. The bare verb `"Change"` matches `EDIT_GRAPH_POSITIVE_REGEX` in
 *     route-v2.ts → `editIntentDetected: true` → `dispatchEditGraph`.
 *  4. The V4 LLM cannot synthesise an operation from a value-less prompt
 *     → returns zero operations → no-op recovery enters the final
 *     `ambiguous` branch ([edit-graph-dispatch.ts:242](../handlers/edit-graph-dispatch.ts:242))
 *     and returns `assistantText: null, suggestedActions: []`.
 *  5. The user sees a dead end — bland fallback prose, no chips.
 *
 * This module ships two narrow predicates that short-circuit the loop
 * BEFORE the V4 LLM round-trip:
 *
 *  - **Predicate A — bare-label intercept.** Catches NEW chips and
 *    free-text label submissions where the message is just the label
 *    name. No edit verb, no analytical-intent phrasing, no mutation
 *    signal. Gated on fresh prior analysis so we never intercept a
 *    user typing a factor name BEFORE analysis exists.
 *
 *  - **Predicate B — legacy fill-in intercept.** Catches the EXACT
 *    failing shape currently in flight on deployed UIs:
 *    `"Change <known label> [—|–|-]"` with optional trailing whitespace
 *    and NO value after the dash. Predicate A excludes this (it
 *    contains the verb "Change"), so a separate dedicated predicate
 *    is required. Predicate B can be retired once Touch 4 has bled
 *    through deployed UIs and no chip still produces this shape.
 *
 * Privacy / safety contract:
 *  - Pure function. No I/O, no telemetry, no log spam. The caller
 *    (route-v2.ts) owns telemetry emission.
 *  - Label matching uses ONLY canonical graph labels (already
 *    user-authored). No LLM invention.
 *  - Match algorithm is exact-equal after normalisation (trim +
 *    lowercase + collapse internal whitespace). Levenshtein /
 *    fuzzy-match is intentionally NOT implemented in V1 — exact
 *    equality keeps the predicate auditable and easy to extend.
 *  - Returns a discriminated result so callers can emit precise
 *    telemetry (`predicate: 'bare_label' | 'legacy_fill_in'`).
 *
 * Out of scope (intentionally NOT in this module):
 *  - Per-factor chip emission (the composer's three chips are fixed
 *    generic-exploration chips; per-factor chips were deferred until
 *    the routing layer is hardened further — see plan
 *    workstream-v5-post-analysis-exploration-whimsical-micali).
 *  - Levenshtein / typo-tolerant matching.
 *  - Chip-source metadata (`Action.chip.action_type` on the new chips
 *    is from `DETERMINISTIC_CHIP_ACTION_TYPES` so they hit the fast
 *    path on subsequent click).
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { composeDirectAnswerResponse } from '../compose.js';
import type { SuggestedAction } from '../compose/types.js';
import {
  classifyAnalyticalIntent,
  hasMutationSignal,
} from './analytical-intent.js';

export interface PostAnalysisLabelInterceptNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

export type LabelInterceptPredicate = 'bare_label' | 'legacy_fill_in';
export type LabelMatchKind = 'exact';

export type LabelInterceptUnmatchedReason =
  | 'empty_message'
  | 'no_prior_analysis_fresh'
  | 'no_graph_nodes'
  | 'mutation_signal_present'
  | 'analytical_intent_present'
  | 'explicit_edit_verb_present'
  | 'no_label_match'
  | 'legacy_pattern_has_value_after_dash';

export type PostAnalysisLabelInterceptResult =
  | {
      readonly matched: true;
      readonly predicate: LabelInterceptPredicate;
      readonly matchedNode: PostAnalysisLabelInterceptNode;
      readonly matchKind: LabelMatchKind;
    }
  | { readonly matched: false; readonly reason: LabelInterceptUnmatchedReason };

/**
 * Explicit-edit verb allowlist used by Predicate A's negative gate.
 *
 * Per the workstream brief this list is intentionally DIFFERENT from
 * `EDIT_GRAPH_POSITIVE_REGEX` in route-v2.ts (which is the existing
 * positive trigger for the V4 edit_graph dispatch). The two lists are
 * kept separately auditable so a future tightening of one cannot
 * silently widen the other.
 *
 * If the message contains any of these verbs, Predicate A defers —
 * either Predicate B catches the `"Change <label> —"` legacy shape, or
 * the message falls through to the existing edit_graph dispatch (which
 * is correct for messages with a real edit verb + value).
 */
const EXPLICIT_EDIT_VERB_REGEX =
  /\b(?:change|set|update|increase|decrease|make|remove|add|edit|modify|adjust|reduce|tweak|raise|lower|delete)\b/i;

/**
 * Predicate B's submit-message shape. Anchors:
 *  - Optional leading whitespace.
 *  - Literal "change" (case-insensitive).
 *  - One or more whitespace characters.
 *  - Captured label group — lazy match to allow the trailing dash.
 *  - Optional whitespace.
 *  - One of: em-dash (U+2014), en-dash (U+2013), or ASCII hyphen-minus.
 *  - Optional trailing whitespace.
 *  - End of string.
 *
 * The captured label must then EXACTLY match a current graph node label
 * after normalisation. The end-of-string anchor ensures any value after
 * the dash (e.g. `"Change Pricing — 100"`) fails the predicate and
 * falls through to the V4 LLM which can handle a real edit.
 */
const LEGACY_FILL_IN_REGEX = /^\s*change\s+(.+?)\s*[—–-]\s*$/i;

/**
 * Normalise a string for label-equality comparison: trim, lowercase,
 * collapse internal whitespace runs to a single space. Pure.
 */
function normaliseForLabelMatch(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Find the first node whose (normalised) label exactly matches the
 * (normalised) candidate. Returns the matching node or `null`.
 *
 * Labels shorter than 3 characters are skipped — single-letter labels
 * are exceedingly rare in real graphs and a 1-char near-match is more
 * likely to be a stray keystroke than an explore intent.
 */
function findLabelMatch(
  candidate: string,
  nodes: readonly PostAnalysisLabelInterceptNode[],
): PostAnalysisLabelInterceptNode | null {
  const target = normaliseForLabelMatch(candidate);
  if (target.length < 3) return null;
  for (const node of nodes) {
    if (typeof node.label !== 'string') continue;
    const trimmed = node.label.trim();
    if (trimmed.length < 3) continue;
    if (normaliseForLabelMatch(trimmed) === target) return node;
  }
  return null;
}

/**
 * Try both predicates in order:
 *   1. Predicate B (legacy `Change <label> —` shape) — more specific.
 *   2. Predicate A (bare label) — broader.
 *
 * The two are mutually exclusive by construction: Predicate B requires
 * a leading "change" verb which Predicate A's negative gate rejects.
 *
 * Returns `matched: false` with a discriminator when neither fires so
 * the caller (route-v2.ts) can preserve existing routing.
 */
export function tryPostAnalysisLabelIntercept(
  message: string,
  nodes: readonly PostAnalysisLabelInterceptNode[] | null | undefined,
  priorAnalysisIsFresh: boolean,
): PostAnalysisLabelInterceptResult {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { matched: false, reason: 'empty_message' };
  }
  if (!priorAnalysisIsFresh) {
    return { matched: false, reason: 'no_prior_analysis_fresh' };
  }
  if (!nodes || nodes.length === 0) {
    return { matched: false, reason: 'no_graph_nodes' };
  }

  const trimmed = message.trim();

  // ── Predicate B — legacy `Change <label> —` shape ──────────────────
  //
  // Tried first because it is more specific (anchored start + end +
  // explicit verb + explicit terminal dash). When the message matches
  // the legacy regex the captured label must then equal a current node
  // label. A real edit ("Change Pricing — 100") fails the regex on the
  // end anchor and falls through to Predicate A's negative gate.
  const legacyMatch = LEGACY_FILL_IN_REGEX.exec(trimmed);
  if (legacyMatch) {
    const capturedLabel = legacyMatch[1] ?? '';
    // Defensive: a malformed submit such as `"Change Pricing — 100"`
    // would have failed the regex's end anchor above, but the
    // captured-label segment could in principle carry an embedded
    // mutation signal too. Reject on any mutation signal in the
    // message as a belt-and-braces gate.
    if (hasMutationSignal(trimmed)) {
      return { matched: false, reason: 'mutation_signal_present' };
    }
    const matchedNode = findLabelMatch(capturedLabel, nodes);
    if (matchedNode) {
      return {
        matched: true,
        predicate: 'legacy_fill_in',
        matchedNode,
        matchKind: 'exact',
      };
    }
    // Legacy shape with an unknown label — leave to V4 LLM rather
    // than fabricating a guess. Could be a user-renamed factor not
    // yet reflected in the snapshot.
    return { matched: false, reason: 'no_label_match' };
  }

  // ── Predicate A — bare-label intercept ─────────────────────────────
  //
  // Negative gates first — each rejects with a precise reason so
  // telemetry can attribute miss rates per gate. Order matters only
  // for readability; the conditions are mutually exclusive in
  // practice (a message with an analytical-intent shape rarely
  // contains a mutation signal as well).
  if (EXPLICIT_EDIT_VERB_REGEX.test(trimmed)) {
    return { matched: false, reason: 'explicit_edit_verb_present' };
  }
  if (hasMutationSignal(trimmed)) {
    return { matched: false, reason: 'mutation_signal_present' };
  }
  if (classifyAnalyticalIntent(trimmed) !== null) {
    return { matched: false, reason: 'analytical_intent_present' };
  }

  const matchedNode = findLabelMatch(trimmed, nodes);
  if (matchedNode) {
    return {
      matched: true,
      predicate: 'bare_label',
      matchedNode,
      matchKind: 'exact',
    };
  }

  return { matched: false, reason: 'no_label_match' };
}

// ────────────────────────────────────────────────────────────────────
// Composer — deterministic 3-chip response. Code-owned copy.
// ────────────────────────────────────────────────────────────────────

/**
 * Build the canonical exploration message for the matched label.
 *
 * Copy contract (must pass `FORBIDDEN_USER_FACING_PHRASES`):
 *  - No "previous analysis" / "prior analysis".
 *  - No "no change was made" / denial framing.
 *  - No "recommended" / "winner" / "winning option".
 *  - No "validator" / "dispatcher" / "tool calls" / "envelope".
 *  - British English. Sentence case. No em dashes.
 *
 * The label is interpolated from the canonical graph node label
 * (already user-authored), so no sanitisation is performed beyond
 * `String(label).trim()` defence.
 */
function composeExploreText(canonicalLabel: string): string {
  const safeLabel = String(canonicalLabel).trim();
  return (
    `It looks like you would like to explore ${safeLabel}. `
    + 'Would you like me to walk you through the analysis, '
    + 'look at what could change the outcome, or run a pre-mortem?'
  );
}

/**
 * The three deterministic follow-up chips. First two carry
 * `action_type` values inside `DETERMINISTIC_CHIP_ACTION_TYPES` so a
 * click hits the deterministic fast path at route-v2.ts:819 — zero
 * Sonnet round-trip. The third is a prompt chip (no `action_type`)
 * because there is no registered handler for the pre-mortem flow;
 * the click routes through TurnExecutor as a normal turn.
 *
 * Frozen so callers cannot mutate the shared instance. The composer
 * spreads them into a fresh array on each invocation so the wire
 * `suggested_actions` is itself mutable per OlumiResponse's contract.
 */
const WALK_ME_THROUGH_CHIP: SuggestedAction = Object.freeze({
  id: 'chip_action_explain_results',
  label: 'Walk me through the analysis',
  message: 'Walk me through the analysis.',
  action_type: 'explain_results' as const,
});

const RERUN_ANALYSIS_CHIP: SuggestedAction = Object.freeze({
  id: 'chip_action_rerun_analysis',
  label: 'Re-run analysis',
  message: 'Re-run the analysis.',
  action_type: 'run_analysis' as const,
});

const RUN_PRE_MORTEM_CHIP: SuggestedAction = Object.freeze({
  id: 'chip_action_run_pre_mortem',
  label: 'Run a pre-mortem',
  message: 'Imagine this decision went wrong. What would have caused it?',
});

/**
 * Compose the deterministic exploration response for a matched
 * intercept. Pure function. Output is a `direct_answer`-shaped
 * `OlumiResponse` with three chips and a one-sentence assistant text.
 *
 * `canonicalLabel` MUST come from the matched graph node's `label`
 * field (the caller has already validated the node against the
 * snapshot), NOT from the raw user message. This guarantees the
 * user sees the canonical capitalised label, not a lowercase
 * mistype.
 */
export function composePostAnalysisLabelInterceptResponse(
  canonicalLabel: string,
  stage: StageType,
): OlumiResponse {
  return composeDirectAnswerResponse({
    assistant_text: composeExploreText(canonicalLabel),
    stage,
    suggested_actions: [WALK_ME_THROUGH_CHIP, RERUN_ANALYSIS_CHIP, RUN_PRE_MORTEM_CHIP],
  });
}
