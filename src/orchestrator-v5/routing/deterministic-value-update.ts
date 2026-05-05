/**
 * V5 explain-stabilisation Task 4 — deterministic pre-route for value
 * updates. Inserted into TurnExecutor's lifecycle BEFORE `routeWithToolUse`
 * (the LLM call), to catch obvious value-update phrasings that prompt
 * tuning has not been able to route reliably.
 *
 * SCOPE DEVIATION FROM ORIGINAL BRIEF (Paul, 2026-04-29, AskUserQuestion):
 * The original brief specified an exact-match → `edit_graph` dispatch
 * path. Paul chose "Always go to clarify (defer exact match)" because
 * `edit_graph` is a system-layer dispatch at route-v2.ts requiring a
 * FastifyRequest, which is not available inside `runTurnExecutor`.
 * Wiring it cleanly from the turn-executor would require a separate
 * architectural decision. The exact-match branch is therefore deferred to
 * a follow-up brief. This pre-route's only output is a clarify dispatch —
 * the user picks the intended factor from up to four chips, and the next
 * turn (after the chip click) carries the disambiguated phrasing into
 * Sonnet's normal routing path.
 *
 * Detection (all conditions must hold):
 *   1. message contains an edit verb (`increase|decrease|reduce|raise|
 *      lower|set|change|update|make|adjust`, word-boundary, case-insensitive)
 *   2. CQE extracted at least one numeric value (we do NOT regex-parse
 *      the message for numbers — F.6: code computes, LLM doesn't; CQE is
 *      the canonical extractor)
 *   3. graphLookup is available (no graph → no factor labels to match)
 *   4. message does NOT contain a hypothetical phrase (`what if`, `what
 *      would`, `how would`, `would it`, `if we`, `if I`, `suppose`,
 *      `imagine`, `\btest\b`, `scenario`) — those phrasings should reach
 *      the LLM so Sonnet can frame the right exploratory response.
 *
 * Label matching (substring first, Dice as fallback):
 *   - Pass 1: substring match (case-insensitive, trimmed) — deterministic
 *     and reliable for "Set <Factor Label> to <value>" prompts.
 *   - Pass 2: bigramDice on candidates that did not substring-match,
 *     threshold 0.4. Whole-message-vs-label, mirroring the entity
 *     resolver's existing path.
 *
 * Outcome:
 *   - At least one candidate qualifies → `dispatch: 'clarify'` with up to
 *     four candidates sorted by score (substring matches first).
 *   - No candidate qualifies → `{ matched: false }` (LLM falls through).
 */

import type { QuantityExtractionResult } from '../context/cqe/schema-types.js';
import type { GraphLookup } from './validator.js';
import { bigramDice } from './validator.js';

const EDIT_VERB_PATTERN =
  /\b(increase|decrease|reduce|raise|lower|set|change|update|make|adjust)\b/i;

/**
 * P0 V5 golden-path repair (Wave 2, Path B) — deictic reference patterns.
 *
 * Targets value-update phrasings that don't carry a label but DO carry a
 * pointer ("that factor", "this factor", "the selected factor", "the
 * highlighted one"). When the user clicked a factor on the canvas and
 * then typed a deictic value-update, we can resolve deterministically
 * without an LLM call — provided exactly one selected factor exists.
 *
 * Bare "it" is intentionally OUT of this list. Pronoun resolution
 * across turns needs LLM coreference and is out of scope; a misfire on
 * "set it to £30k" silently mutating the wrong factor is worse than
 * falling through to clarify.
 *
 * Patterns are word-bounded so phrases like "do that" or "this morning"
 * never match.
 */
const DEICTIC_REFERENCE_PATTERN =
  /\b(?:(?:that|this) (?:factor|node|one)|(?:the (?:selected|highlighted|chosen)) (?:factor|node|one))\b/i;

// Case-insensitive substring matches; some are anchored on word boundary
// so "fastest" doesn't trigger `\btest\b` and "iframe" doesn't trigger
// `imagine`. Multi-word phrases are unambiguous as substring matches.
const HYPOTHETICAL_PATTERNS: readonly RegExp[] = [
  /\bwhat if\b/i,
  /\bwhat would\b/i,
  /\bhow would\b/i,
  /\bwould it\b/i,
  /\bif we\b/i,
  /\bif i\b/i,
  /\bsuppose\b/i,
  /\bimagine\b/i,
  /\btest\b/i,
  /\bscenario\b/i,
];

/** Minimum bigramDice score to qualify as a fuzzy candidate. */
const DICE_FLOOR = 0.4;

/** Maximum number of clarify candidates to surface. */
export const MAX_CANDIDATES = 4;

/**
 * How a candidate was selected — useful for routing diagnostics. `score: 0`
 * alone is too implicit for telemetry, so each candidate carries an explicit
 * source tag.
 */
export type CandidateSource = 'substring' | 'dice';

export interface ValueUpdateCandidate {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly source: CandidateSource;
}

export type ValueUpdateDispatch =
  | { readonly matched: false; readonly skip_reason: SkipReason }
  | {
      readonly matched: true;
      readonly dispatch: 'clarify';
      readonly candidates: readonly ValueUpdateCandidate[];
      readonly quantity: QuantityExtractionResult;
    }
  /**
   * V5 D1 golden-path closure (A3.1): unambiguous match on exactly ONE
   * substring candidate. The caller is responsible for verifying the
   * candidate's NodeV3.kind === 'factor' against graph state before
   * dispatching `set_factor_value` — GraphLookup buckets factor with
   * outcome/decision/risk/action under EntityKind 'node', so this
   * function cannot do the kind check itself.
   *
   * On a positive kind check the caller constructs a synthetic
   * `RoutingToolCallResult` (proposal carrying handler_id
   * 'set_factor_value', resolved entity, computed parameters) and
   * lets the existing Step 2-7 lifecycle run unchanged. No LLM call,
   * no bespoke handler invocation path.
   *
   * On a negative kind check the caller falls back to the clarify
   * variant (same shape as the multi-match case).
   */
  | {
      readonly matched: true;
      readonly dispatch: 'set_factor_value';
      readonly candidate: ValueUpdateCandidate;
      readonly quantity: QuantityExtractionResult;
    };

export type SkipReason =
  | 'no_edit_verb'
  | 'no_quantity'
  | 'no_graph'
  | 'hypothetical_gate'
  | 'no_candidate_match';

/**
 * P0 V5 golden-path repair (Wave 2): UI-side selection context, narrowed
 * to factor-kind ids by the caller. The pre-route uses this as a strict
 * tie-breaker only — never as the sole basis for a dispatch when the
 * label evidence already resolves to one factor.
 *
 * Caller is responsible for the kind-filter (factor only). Selected
 * options/risks/outcomes/decisions must be filtered out upstream so a
 * non-factor selection can't silently update a factor.
 */
export type SelectedFactorIds = readonly string[];

export function tryDeterministicValueUpdate(
  message: string,
  parsedQuantities: readonly QuantityExtractionResult[],
  graphLookup: GraphLookup | undefined,
  selectedFactorIds: SelectedFactorIds = [],
): ValueUpdateDispatch {
  if (!EDIT_VERB_PATTERN.test(message)) {
    return { matched: false, skip_reason: 'no_edit_verb' };
  }

  // F.6: code computes, LLM doesn't. CQE is the canonical numeric
  // extractor — if it found nothing, fall through to the LLM rather than
  // re-running a regex here.
  const quantity = parsedQuantities.find((q) => q.value !== null);
  if (!quantity) {
    return { matched: false, skip_reason: 'no_quantity' };
  }

  if (graphLookup === undefined) {
    return { matched: false, skip_reason: 'no_graph' };
  }

  // Negative gate: hypothetical phrasings should reach the LLM. The
  // pre-route is for explicit value updates, not exploratory scenarios.
  for (const pat of HYPOTHETICAL_PATTERNS) {
    if (pat.test(message)) {
      return { matched: false, skip_reason: 'hypothetical_gate' };
    }
  }

  // Candidate pool: GraphLookup buckets factor / outcome / decision / risk
  // / action node kinds together under EntityKind 'node' (per
  // graph-lookup-adapter.ts:toEntityKind). The interface cannot
  // disambiguate factor from outcome/risk inside the 'node' bucket.
  // Substring/Dice matches on this pool may surface non-factor candidates
  // (e.g. an outcome whose label happens to substring-match the user's
  // text). We accept this: the chip click on the next turn carries a
  // disambiguated phrasing into Sonnet's normal routing path, where the
  // validator catches kind-mismatched proposals via the recoverable
  // path. Tightening this would require widening GraphLookup to expose
  // 'factor' separately — deferred (would touch the validator surface).
  const candidatesPool = graphLookup.listEntitiesByKind('node');
  if (candidatesPool.length === 0) {
    return { matched: false, skip_reason: 'no_candidate_match' };
  }

  const normMessage = message.trim().toLowerCase();
  const substringMatches: ValueUpdateCandidate[] = [];
  const remaining: Array<{ id: string; label: string | null }> = [];

  for (const f of candidatesPool) {
    if (f.label == null) {
      // No label means we cannot anchor a substring or Dice match on this
      // candidate — drop it from consideration.
      continue;
    }
    const normLabel = f.label.trim().toLowerCase();
    if (normLabel.length === 0) continue;
    if (normMessage.includes(normLabel)) {
      substringMatches.push({ id: f.id, label: f.label, score: 1, source: 'substring' });
    } else {
      remaining.push(f);
    }
  }

  const diceMatches: ValueUpdateCandidate[] = [];
  for (const f of remaining) {
    if (f.label == null) continue;
    const score = bigramDice(message, f.label);
    if (score >= DICE_FLOOR) {
      diceMatches.push({ id: f.id, label: f.label, score, source: 'dice' });
    }
  }
  diceMatches.sort((a, b) => b.score - a.score);

  const matched = [...substringMatches, ...diceMatches].slice(0, MAX_CANDIDATES);
  if (matched.length === 0) {
    // Brief contract: "All candidates < 0.4 → { matched: false } (LLM
    // falls through)". Pure semantic-synonym mismatches like "budget" →
    // "Hiring and Staffing Cost" (bigramDice ~0.04, no shared lexical
    // material) land here. KNOWN RESIDUAL RISK: Test G's exact
    // "Increase the budget to £300k" prompt against a graph with no
    // budget-keyworded label still falls through to the LLM, which has
    // been observed to misroute. A robust fix needs either a curated
    // synonym layer or LLM understanding — deferred.
    return { matched: false, skip_reason: 'no_candidate_match' };
  }

  // V5 D1 golden-path closure (A3.1): exactly ONE substring match (and
  // no Dice fuzzies) is the gate for handler dispatch. A single Dice
  // candidate stays clarify because label confidence is too low; multi-
  // candidate stays clarify by definition. The kind check (factor only)
  // is the caller's responsibility — see the discriminated union docs.
  if (substringMatches.length === 1 && diceMatches.length === 0) {
    return {
      matched: true,
      dispatch: 'set_factor_value',
      candidate: substringMatches[0],
      quantity,
    };
  }

  // P0 V5 golden-path repair (Wave 2, Path A — selection narrowing):
  // when label evidence yields multiple candidates AND the UI selection
  // intersects them at exactly one factor, treat the selection as a
  // strict tie-breaker. Non-factor selections never appear here because
  // the caller pre-filters to factor-kind ids. If the intersection is
  // zero or > 1, fall through to clarify — never silently update a
  // factor because some unrelated node was selected.
  if (matched.length > 1 && selectedFactorIds.length > 0) {
    const selectionSet = new Set(selectedFactorIds);
    const narrowed = matched.filter((c) => selectionSet.has(c.id));
    if (narrowed.length === 1) {
      return {
        matched: true,
        dispatch: 'set_factor_value',
        candidate: narrowed[0]!,
        quantity,
      };
    }
  }

  return {
    matched: true,
    dispatch: 'clarify',
    candidates: matched,
    quantity,
  };
}

/**
 * P0 V5 golden-path repair (Wave 2, Path B — selected-deictic).
 *
 * Detect deterministic value-update intent expressed via deictic
 * reference + UI selection: "Update that factor to £30,000" with
 * exactly one factor selected. Returns:
 *   - `null` when the message has no deictic reference (caller should
 *     fall through to label-based path A or LLM).
 *   - A clarify dispatch when the deictic IS present but the selection
 *     doesn't yield exactly one factor — never silently update a
 *     non-factor and never guess.
 *   - A set_factor_value dispatch when exactly one factor is selected
 *     AND a quantity is parsed.
 *
 * Pronoun resolution across turns is intentionally not handled here.
 * "Set it to £30k" without a selection still falls through to the LLM.
 *
 * Categorical / state updates ("update team maturity to mid-weight
 * developers") are NOT supported by this path — there is no quantity,
 * so the no_quantity gate triggers below and the message reaches the
 * LLM. The handler set_factor_value rejects categorical proposals
 * upstream; until the schema supports ordinal states, the LLM is the
 * right fallback (it can clarify or route to another handler).
 */
export type DeicticDispatch =
  | { readonly matched: false; readonly skip_reason: 'no_deictic' }
  | { readonly matched: false; readonly skip_reason: 'no_edit_verb' }
  | { readonly matched: false; readonly skip_reason: 'no_quantity' }
  | { readonly matched: false; readonly skip_reason: 'no_graph' }
  | { readonly matched: false; readonly skip_reason: 'hypothetical_gate' }
  | {
      readonly matched: true;
      readonly dispatch: 'clarify_deictic';
      readonly reason:
        | 'no_factor_selected'
        | 'multiple_factors_selected';
      readonly quantity: QuantityExtractionResult;
    }
  | {
      readonly matched: true;
      readonly dispatch: 'set_factor_value';
      readonly candidate: ValueUpdateCandidate;
      readonly quantity: QuantityExtractionResult;
    };

/**
 * Resolve a deictic value-update against UI selection. Caller passes
 * factor-kinded selection (already filtered upstream) plus a label
 * lookup function for the resolved id, so this function can produce a
 * `ValueUpdateCandidate` with the human label for the receipt copy.
 *
 * The label lookup is supplied by the caller (rather than reading
 * graphLookup here) because graphLookup buckets factor under the broader
 * 'node' EntityKind and exposes labels indirectly; the caller already
 * walks the graph for the factor-kind filter, so it has the labels in
 * hand.
 */
export function tryDeicticValueUpdate(
  message: string,
  parsedQuantities: readonly QuantityExtractionResult[],
  graphLookup: GraphLookup | undefined,
  selectedFactorIds: SelectedFactorIds,
  resolveFactorLabel: (id: string) => string | null,
): DeicticDispatch {
  if (!DEICTIC_REFERENCE_PATTERN.test(message)) {
    return { matched: false, skip_reason: 'no_deictic' };
  }
  if (!EDIT_VERB_PATTERN.test(message)) {
    return { matched: false, skip_reason: 'no_edit_verb' };
  }
  for (const pat of HYPOTHETICAL_PATTERNS) {
    if (pat.test(message)) {
      return { matched: false, skip_reason: 'hypothetical_gate' };
    }
  }
  const quantity = parsedQuantities.find((q) => q.value !== null);
  if (!quantity) {
    return { matched: false, skip_reason: 'no_quantity' };
  }
  if (graphLookup === undefined) {
    return { matched: false, skip_reason: 'no_graph' };
  }
  if (selectedFactorIds.length === 0) {
    return {
      matched: true,
      dispatch: 'clarify_deictic',
      reason: 'no_factor_selected',
      quantity,
    };
  }
  if (selectedFactorIds.length > 1) {
    return {
      matched: true,
      dispatch: 'clarify_deictic',
      reason: 'multiple_factors_selected',
      quantity,
    };
  }
  const id = selectedFactorIds[0]!;
  const label = resolveFactorLabel(id);
  if (label === null || label.trim().length === 0) {
    // Defensive: factor exists in selection but lacks a label. Falling
    // back to clarify rather than dispatching with a blank receipt.
    return {
      matched: true,
      dispatch: 'clarify_deictic',
      reason: 'no_factor_selected',
      quantity,
    };
  }
  return {
    matched: true,
    dispatch: 'set_factor_value',
    candidate: { id, label, score: 1, source: 'substring' },
    quantity,
  };
}

/**
 * User-facing clarification copy for the deictic-but-ambiguous path.
 * British English, no internal terms.
 */
export function buildDeicticClarifyAssistantText(
  reason: 'no_factor_selected' | 'multiple_factors_selected',
): string {
  if (reason === 'no_factor_selected') {
    return (
      `I wasn't sure which factor you meant. Please click the factor on ` +
      `the canvas and try again, or tell me the factor's name.`
    );
  }
  return (
    `You have more than one factor selected, so I'm not sure which one to ` +
    `update. Please select just the factor you want to change, or tell me ` +
    `its name.`
  );
}

/**
 * Build the user-visible clarify prose. Kept here (not in compose) because
 * the wording is specific to this pre-route and the helper has zero deps
 * on the wider compose pipeline.
 */
export function buildClarifyAssistantText(
  candidates: readonly ValueUpdateCandidate[],
): string {
  if (candidates.length === 1) {
    const c = candidates[0];
    return `I wasn't sure which factor you meant. Did you mean ${c.label}?`;
  }
  return `I wasn't sure which factor you meant. Did you mean one of these?`;
}

/**
 * Build prompt-replay messages for each candidate chip, preserving the
 * user's original verb where possible.
 */
export function buildClarifyChipMessage(
  message: string,
  candidate: ValueUpdateCandidate,
  quantity: QuantityExtractionResult,
): string {
  const verbMatch = message.match(EDIT_VERB_PATTERN);
  const verb = verbMatch ? verbMatch[0].toLowerCase() : 'set';
  const valueText = quantity.raw_text || (quantity.value != null ? String(quantity.value) : '');
  if (valueText === '') {
    return `${capitalise(verb)} ${candidate.label}.`;
  }
  return `${capitalise(verb)} ${candidate.label} to ${valueText}.`;
}

function capitalise(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// V5 D1 golden-path closure (A3.1) — proposal construction
// ---------------------------------------------------------------------------

/**
 * Map CQE's internal `unit` (e.g. `'percentage'`, `'GBP'`,
 * `'percentage_points'`) to a user-facing unit string the
 * `set_factor_value` handler accepts (`'%'`, `'£'`, `'$'`, `'€'`, or
 * the raw string when no canonical mapping exists).
 *
 * The handler's `normaliseFactorValue` interprets the unit + value as
 * USER UNITS and divides by the factor's cap to derive model units.
 * This means CQE's own pre-normalisation (e.g. `5%` → `value: 0.05`,
 * `unit: 'percentage'`) MUST be undone here so the handler sees
 * `value: 5, unit: '%'` and computes `5 / 100 = 0.05` correctly.
 * Otherwise the handler would compute `0.05 / 100 = 0.0005` — silent
 * double-normalisation.
 */
export function mapCqeQuantityToProposalValue(
  quantity: QuantityExtractionResult,
): { value: number; unit: string | undefined } {
  if (quantity.value === null) {
    // The pre-route gate already rejects null-value quantities, so
    // this is unreachable in practice. Defensive default keeps the
    // function total.
    return { value: 0, unit: undefined };
  }
  switch (quantity.unit) {
    case 'percentage':
      // CQE pre-divides by 100. Multiply back to user units.
      return { value: quantity.value * 100, unit: '%' };
    case 'percentage_points':
      // CQE keeps the raw number ("1 percentage point" → value: 1).
      // Operator (decrease/increase) carries the delta semantics; the
      // handler applies it to raw_value (user units) directly.
      return { value: quantity.value, unit: '%' };
    case 'GBP':
      return { value: quantity.value, unit: '£' };
    case 'USD':
      return { value: quantity.value, unit: '$' };
    case 'EUR':
      return { value: quantity.value, unit: '€' };
    case null:
      return { value: quantity.value, unit: undefined };
    default:
      // Best-effort passthrough for time / metric / colloquial units.
      // The handler validates the unit string against the factor's
      // stored unit; mismatches surface as PARAMETER_INVALID.
      return { value: quantity.value, unit: quantity.unit };
  }
}

/**
 * Derive the V5 routing `parameter_operator` from the CQE quantity's
 * operator/direction hints, falling back to the matched edit verb in
 * the message. The wire enum is `'set' | 'increase' | 'decrease' |
 * 'multiply'`.
 *
 * Precedence:
 *   1. CQE `operator` — the canonical truth. CQE distinguishes
 *      "Increase budget TO £50,000" (operator: 'set', direction: 'up')
 *      from "Increase budget BY £10k" (operator: 'increment',
 *      direction: 'up'). The verb-flavoured `direction` is auxiliary
 *      and would otherwise turn every `to`-value phrase into a delta.
 *      `'set' → set`, `'increment' / 'add' → increase`,
 *      `'decrement' → decrease`, `'multiply' → multiply`.
 *   2. CQE `direction` (used only when operator is null):
 *      `'up' → increase`, `'down' → decrease`, `'set' → set`.
 *   3. Verb-from-message (set/change/update/make → set;
 *      increase/raise → increase; reduce/decrease/lower → decrease;
 *      adjust → set).
 */
export function deriveOperator(
  message: string,
  quantity: QuantityExtractionResult,
): 'set' | 'increase' | 'decrease' | 'multiply' {
  if (quantity.operator === 'set') return 'set';
  if (quantity.operator === 'increment' || quantity.operator === 'add') return 'increase';
  if (quantity.operator === 'decrement') return 'decrease';
  if (quantity.operator === 'multiply') return 'multiply';
  if (quantity.direction === 'up') return 'increase';
  if (quantity.direction === 'down') return 'decrease';
  if (quantity.direction === 'set') return 'set';

  const verbMatch = message.match(EDIT_VERB_PATTERN);
  const verb = verbMatch ? verbMatch[0].toLowerCase() : 'set';
  if (verb === 'increase' || verb === 'raise') return 'increase';
  if (verb === 'reduce' || verb === 'decrease' || verb === 'lower') return 'decrease';
  return 'set';
}
