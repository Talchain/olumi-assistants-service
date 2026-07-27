/**
 * Coaching-output eval checks (P3, COACHING_SYSTEM audit 2026-07-27).
 *
 * The audit proposed seven checks and observed that four of them — its numbers
 * **1, 2, 5 and 7** — are PURE FUNCTIONS over an already-recorded coaching
 * block. They need no live model, no PMS row, and no harness run, so they can
 * run in CI today against a recorded fixture. Those four are implemented here.
 * (Checks 3, 4 and 6 need generated output or per-call-site token accounting
 * and are deliberately out of scope for this PR.)
 *
 * WHY THIS EXISTS AT ALL. `COACHING_SYSTEM` is a full second LLM call on every
 * draft turn with ~21.6 s measured latency (n=40) and zero output-quality eval.
 * Check 1 alone would have caught the P0 this same PR fixes — the prompt
 * instructed a `causal_claims` vocabulary the contract rejected 100% of the
 * time, and the only signal was a permanently-firing `CAUSAL_CLAIM_DROPPED`
 * warning that nobody read.
 *
 * DESIGN RULES
 *  - **Reuse the runtime coercers; do not reimplement them.** Checks call the
 *    production `enforceCoachingContract` and `validateCausalClaims` and COUNT
 *    what they had to fix. A second copy of the conformance logic would be a
 *    mirror, and would drift exactly like the prompt did (CLAUDE.md trap 12).
 *  - **Non-destructive.** `enforceCoachingContract` repairs IN PLACE, so the
 *    input is deep-cloned before measurement. A check that mutated the thing it
 *    measures would corrupt any caller that scored then shipped.
 *  - **Pure.** No I/O, no logging, never throws on malformed input.
 */

import {
  enforceCoachingContract,
  CANONICAL_BRIEF_COMPLETENESS,
} from '../../adapters/llm/coaching-contract-conformance.js';
import { validateCausalClaims } from '../../cee/transforms/causal-claims-validation.js';
import { CAUSAL_CLAIMS_WARNING_CODES } from '../../schemas/causal-claims.js';

/**
 * Cardinality caps the prompt states to the model (`strengthen_items` 0-4,
 * `bias_signals` 0-3, `causal_claims` 0-8).
 *
 * These are PRODUCT limits stated in prose, not contract enums, so they cannot
 * be derived from a Zod schema. They are therefore a mirror — and are pinned
 * FAIL-LOUD by `coaching-eval-checks.test.ts`, which asserts the rendered
 * prompt still states these exact numbers. Change the prompt and the test goes
 * RED rather than the metric silently measuring the wrong bar.
 */
export const COACHING_CARDINALITY_CAPS = {
  strengthen_items: 4,
  bias_signals: 3,
  causal_claims: 8,
} as const;

/** The coaching-pass outcome vocabulary (`_pipeline_outcome.coaching_status`). */
export const COACHING_STATUS_VALUES = ['complete', 'skipped_budget', 'failed_degraded'] as const;
export type CoachingStatus = (typeof COACHING_STATUS_VALUES)[number];

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function arrayOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Ratio helper: an empty denominator yields `null`, never a fake 1.0 or 0.0. */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

// ───────────────────────────────────────────────────────────────────────────
// CHECK 1 — contract-conformance yield
// ───────────────────────────────────────────────────────────────────────────

export interface ConformanceYieldResult {
  readonly strengthen_items_total: number;
  readonly action_types_coerced: number;
  readonly bias_categories_dropped: number;
  readonly bias_signals_total: number;
  readonly bias_signals_dropped: number;
  readonly causal_claims_total: number;
  /** Claims dropped by the raw `CausalClaimSchema.safeParse` (the P0 signal). */
  readonly causal_claims_parse_dropped: number;
  /**
   * Fraction of emitted items that survived with NO coercion and NO drop.
   * `null` when the block emitted nothing (never a fake 1.0 — an empty block
   * is unmeasured, not perfect).
   */
  readonly clean_yield: number | null;
}

/**
 * Check 1 — what fraction of what the model emitted survives the contract
 * untouched? Counts the runtime coercers' fixes instead of applying them
 * silently. A `causal_claims_parse_dropped` equal to `causal_claims_total` is
 * the exact fingerprint of a prompt-vs-contract vocabulary drift.
 */
export function checkConformanceYield(
  coaching: unknown,
  causalClaims: unknown,
  graphNodeIds: ReadonlySet<string>,
): ConformanceYieldResult {
  // Deep-clone: enforceCoachingContract repairs in place.
  const clone: unknown = isRecord(coaching) ? structuredClone(coaching) : coaching;

  const items = isRecord(clone) ? arrayOf(clone.strengthen_items) : [];
  const signals = isRecord(clone) ? arrayOf(clone.bias_signals) : [];
  const strengthenTotal = items.length;
  const signalsTotal = signals.length;

  const conformance = enforceCoachingContract(clone, undefined);

  const claims = arrayOf(causalClaims);
  const claimsTotal = claims.length;
  const { warnings } = validateCausalClaims(causalClaims, new Set(graphNodeIds));
  const dropWarning = warnings.find((w) => w.code === CAUSAL_CLAIMS_WARNING_CODES.DROPPED);
  const parseDropped =
    typeof dropWarning?.details?.count === 'number' ? dropWarning.details.count : 0;

  const total = strengthenTotal + signalsTotal + claimsTotal;
  const touched =
    conformance.action_types_coerced +
    conformance.bias_categories_dropped +
    conformance.bias_signals_dropped +
    parseDropped;

  return {
    strengthen_items_total: strengthenTotal,
    action_types_coerced: conformance.action_types_coerced,
    bias_categories_dropped: conformance.bias_categories_dropped,
    bias_signals_total: signalsTotal,
    bias_signals_dropped: conformance.bias_signals_dropped,
    causal_claims_total: claimsTotal,
    causal_claims_parse_dropped: parseDropped,
    clean_yield: ratio(total - touched, total),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// CHECK 2 — coaching status / JSON-parse outcome
// ───────────────────────────────────────────────────────────────────────────

export interface CoachingStatusResult {
  readonly status: CoachingStatus | null;
  /** True only for `complete` — the pass ran AND produced usable coaching. */
  readonly produced_coaching: boolean;
  /** True when the pass never ran (budget gate) — not a quality failure. */
  readonly skipped_for_budget: boolean;
  /** True when the pass ran and produced nothing usable (the JSON-shape mode). */
  readonly failed_degraded: boolean;
  /** `status` was absent or off-vocabulary — the envelope cannot be scored. */
  readonly unscoreable: boolean;
}

/**
 * Check 2 — read `_pipeline_outcome.coaching_status` off a recorded response
 * envelope. This call runs WITHOUT structured outputs (it relies on
 * `extractJson` over free text), so JSON-shape failure is a real, and until now
 * entirely unscored, mode: the data has been on the wire and in every persisted
 * run-dir all along with no scorer reading it.
 */
export function checkCoachingStatus(responseEnvelope: unknown): CoachingStatusResult {
  const outcome = isRecord(responseEnvelope) ? responseEnvelope._pipeline_outcome : undefined;
  const raw = isRecord(outcome) ? outcome.coaching_status : undefined;
  const status = (COACHING_STATUS_VALUES as readonly string[]).includes(raw as string)
    ? (raw as CoachingStatus)
    : null;
  return {
    status,
    produced_coaching: status === 'complete',
    skipped_for_budget: status === 'skipped_budget',
    failed_degraded: status === 'failed_degraded',
    unscoreable: status === null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// CHECK 5 — node-id validity
// ───────────────────────────────────────────────────────────────────────────

export interface NodeIdValidityResult {
  readonly references_total: number;
  readonly references_invalid: number;
  readonly invalid_ids: readonly string[];
  /** Fraction of node references that resolve. `null` when there were none. */
  readonly valid_fraction: number | null;
}

/**
 * Check 5 — do the node ids the coaching REFERENCES exist in the graph the
 * model was shown? The prompt instructs "Use only node ids that appear in the
 * provided graph", and that instruction is currently unenforced for coaching
 * (only `causal_claims` gets a ref check downstream, and before this PR's P0 it
 * never got that far).
 *
 * SCOPE, stated precisely. Two reference classes are counted:
 *   - `bias_signals[].target`
 *   - `causal_claims[]` endpoints (`from` / `to` / `via` / `between`)
 *
 * `widening_log.elements_added` is DELIBERATELY EXCLUDED. That field names
 * nodes the model would ADD to the graph — by definition they need not exist in
 * it yet, so counting them as invalid references would manufacture a false
 * violation rate. Excluding it keeps this metric a claim about *references*,
 * not about *proposals*.
 */
export function checkNodeIdValidity(
  coaching: unknown,
  causalClaims: unknown,
  graphNodeIds: ReadonlySet<string>,
): NodeIdValidityResult {
  const refs: string[] = [];

  for (const sig of arrayOf(isRecord(coaching) ? coaching.bias_signals : undefined)) {
    if (!isRecord(sig)) continue;
    if (typeof sig.target === 'string' && sig.target.trim().length > 0) refs.push(sig.target.trim());
  }

  for (const claim of arrayOf(causalClaims)) {
    if (!isRecord(claim)) continue;
    for (const key of ['from', 'to', 'via'] as const) {
      const v = claim[key];
      if (typeof v === 'string' && v.trim().length > 0) refs.push(v.trim());
    }
    for (const v of arrayOf(claim.between)) {
      if (typeof v === 'string' && v.trim().length > 0) refs.push(v.trim());
    }
  }

  const invalid = refs.filter((id) => !graphNodeIds.has(id));
  return {
    references_total: refs.length,
    references_invalid: invalid.length,
    invalid_ids: [...new Set(invalid)],
    valid_fraction: ratio(refs.length - invalid.length, refs.length),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// CHECK 7 — structure conformance
// ───────────────────────────────────────────────────────────────────────────

export interface StructureConformanceResult {
  readonly strengthen_items_over_cap: boolean;
  readonly bias_signals_over_cap: boolean;
  readonly causal_claims_over_cap: boolean;
  readonly widening_log_present: boolean;
  readonly widening_log_well_formed: boolean;
  readonly brief_completeness_in_vocabulary: boolean;
  /** Every structural rule held. */
  readonly conformant: boolean;
}

/**
 * Check 7 — are the cardinality caps the prompt states actually honoured, is
 * `widening_log` present and well-formed, and is `brief_completeness` in the
 * contract vocabulary (derived from `BriefCompleteness`, never hand-listed)?
 */
export function checkStructureConformance(
  coaching: unknown,
  causalClaims: unknown,
): StructureConformanceResult {
  const c = isRecord(coaching) ? coaching : {};
  const overStrengthen = arrayOf(c.strengthen_items).length > COACHING_CARDINALITY_CAPS.strengthen_items;
  const overSignals = arrayOf(c.bias_signals).length > COACHING_CARDINALITY_CAPS.bias_signals;
  const overClaims = arrayOf(causalClaims).length > COACHING_CARDINALITY_CAPS.causal_claims;

  const wl = c.widening_log;
  const present = isRecord(wl);
  const wellFormed =
    present &&
    Array.isArray(wl.elements_added) &&
    Array.isArray(wl.elements_considered_but_excluded) &&
    typeof wl.brief_completeness === 'string';
  const inVocabulary =
    wellFormed && CANONICAL_BRIEF_COMPLETENESS.includes(wl.brief_completeness as string);

  return {
    strengthen_items_over_cap: overStrengthen,
    bias_signals_over_cap: overSignals,
    causal_claims_over_cap: overClaims,
    widening_log_present: present,
    widening_log_well_formed: wellFormed,
    brief_completeness_in_vocabulary: inVocabulary,
    conformant:
      !overStrengthen && !overSignals && !overClaims && present && wellFormed && inVocabulary,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Aggregate
// ───────────────────────────────────────────────────────────────────────────

export interface CoachingEvalReport {
  readonly conformance_yield: ConformanceYieldResult;
  readonly coaching_status: CoachingStatusResult;
  readonly node_id_validity: NodeIdValidityResult;
  readonly structure: StructureConformanceResult;
}

/**
 * Run all four offline checks over one recorded draft response envelope.
 * Expects the raw CEE draft-graph shape (`coaching`, `causal_claims`, `nodes`,
 * `_pipeline_outcome`) — the shape `fixtures/frozen-graph.json` already holds.
 */
export function evaluateRecordedDraft(responseEnvelope: unknown): CoachingEvalReport {
  const env = isRecord(responseEnvelope) ? responseEnvelope : {};
  const coaching = env.coaching;
  const causalClaims = env.causal_claims;
  const nodeIds = new Set<string>();
  for (const n of arrayOf(env.nodes)) {
    if (isRecord(n) && typeof n.id === 'string') nodeIds.add(n.id);
  }
  return {
    conformance_yield: checkConformanceYield(coaching, causalClaims, nodeIds),
    coaching_status: checkCoachingStatus(env),
    node_id_validity: checkNodeIdValidity(coaching, causalClaims, nodeIds),
    structure: checkStructureConformance(coaching, causalClaims),
  };
}
