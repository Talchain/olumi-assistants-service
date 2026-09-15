/**
 * ⭐⭐ CAN THE ANALYSIS ACTUALLY CHECK THIS LIMIT? — ASKED AT THE MOMENT THE ROW
 * IS WRITTEN, NOT TWO TURNS LATER.
 *
 * ── THE DEFECT, MEASURED ──────────────────────────────────────────────────
 * Debug export `olumi-debug-44e349fa-20260914.json`, staging, 14 Sep 2026. The
 * user said *"If the churn goes over 7% for more than 3 months, we will have a
 * cash flow problem."* The product replied
 *
 *     "Added constraint: Churn must not exceed 7% for more than 3 months
 *      must be at most 7%."
 *
 * and persisted `goal_constraints[0] = {node_id: '8b73e070', operator: '<=',
 * value: 7, unit: '%', provenance: 'explicit'}`. Node `8b73e070` is
 * "Subscriber Churn Rate", `kind: risk`, and carries NOTHING: `observed_state`,
 * `prior`, `display_value`, `intercept`, `goal_threshold*`, `scale_frame` — all
 * null. TWO TURNS LATER the rerun disclosed the truth:
 *
 *     "One limit on your model could not be checked … We could not line it up
 *      with anything this analysis measures."
 *
 * with `plot.constraint_no_observed_value` then `constraint_analysis_absent`
 * for all four options in PLoT's log, and ISL returning 200/`computed`.
 *
 * **The product accepted a limit it structurally cannot evaluate, printed
 * "Added constraint", and told the truth two turns later.** This module lets the
 * write path say it at the write.
 *
 * ── THE PREDICATE, DERIVED AT THE CONSUMER'S BYTES ────────────────────────
 * Derived 14 Sep 2026 from `plot-lite-service` @ `d68d4ff` (branch `staging`),
 * NOT inferred from the symptom:
 *
 *   `src/integrations/isl/constraint-pu-injection.ts` → `classifyConstraintPu`
 *   is PLoT's own SINGLE source of truth for "does this constraint get a
 *   ParameterUncertainty, and if not why". In order:
 *     · `node_id === goalNodeId`                  → skip `goal_node`
 *       (the goal's distribution comes from ISL's outcome computation, so the
 *        constraint IS evaluated — this is an evaluable skip, not a failure)
 *     · node already has a PU from the translator → `existing`  (evaluable)
 *     · node not in the graph                     → skip `missing_node`
 *     · `node.observed_state?.value === undefined`→ skip `missing_observed_state`
 *       ⇒ logs `plot.constraint_no_observed_value`, and its own message says
 *         "ISL may use base=0.0" — i.e. the threshold is compared against a
 *         fabricated zero, which is worse than not checked
 *     · otherwise                                 → inject (evaluable)
 *
 *   `src/integrations/isl/translator-v3.ts` → `buildParameterUncertaintiesV3`
 *   decides who arrives with a PU already: pass 1 is
 *   `kind === 'factor' && Number.isFinite(observed_state.value)`; pass 2 is
 *   `kind === 'factor' && prior` with a finite, non-degenerate uniform range.
 *   Both passes are FACTOR-ONLY, which is why an `outcome` or `risk` target has
 *   to carry its own `observed_state.value`.
 *
 * ── WHAT THIS MODULE ACTUALLY SPEAKS FROM, AND WHY IT IS NOT THAT ─────────
 * ⭐ It speaks from {@link constraintTargetCarriesNoQuantity} — "does the node
 * record ANY number, on ANY of the fields a quantity can arrive on" — which is
 * STRICTLY STRONGER than PLoT's condition, and already ratified as the
 * run_analysis-time `unmeasured_target` predicate.
 *
 * The entailment is one-way and that is the whole safety argument: carries no
 * quantity ⇒ no `observed_state.value` AND no `prior` ⇒ PLoT's
 * `missing_observed_state` fires. So everything this module speaks about is
 * genuinely un-evaluable. The converse does not hold.
 *
 * ⚠ THE GAP THIS BUYS, RECORDED RATHER THAN CHASED (CLAUDE.md: a missing
 * disclosure is a gap, an invented one is a lie): a node carrying, say, only
 * `display_value` and no `observed_state.value` still reaches PLoT's
 * `missing_observed_state` branch, and this module stays SILENT about it. That
 * is today's behaviour, unchanged. Speaking from the narrower PLoT predicate
 * instead would close the gap and simultaneously make the write-time sentence
 * DISAGREE with the run_analysis-time disclosure on that class — two authorities
 * answering the same user question differently (CLAUDE.md trap 21). One shared
 * predicate, one shared set of words, one recorded gap.
 *
 * ⚠ AND IT IS THE SAFE DIRECTION FOR THE ERROR THAT MATTERS HERE. A false
 * "cannot be checked" tells a user their perfectly good limit will be ignored,
 * which is worse than the defect being fixed. A false silence is merely the
 * product as it shipped.
 *
 * PURE. No I/O, no clock, no config.
 */

import { constraintTargetCarriesNoQuantity } from '../../../../orchestrator/context/constraint-feasibility.js';
import { TIME_UNIT_ALT } from '../../../../cee/compound-goal/extractor.js';

/**
 * Whether a limit written onto this target can be checked by the analysis, and
 * on what basis. `basis` / `reason` exist so callers and tests bind to the
 * DECISION rather than to a boolean another condition could also produce.
 */
export type ConstraintWriteAdmissibility =
  | { readonly checkable: true; readonly basis: 'goal_target' | 'target_records_a_value' }
  | { readonly checkable: false; readonly reason: 'target_records_no_value' };

/** The minimum shape this classifier reads. Deliberately structural. */
export interface ConstraintTargetForAdmissibility {
  readonly kind?: unknown;
  readonly [field: string]: unknown;
}

/**
 * Classify a constraint's TARGET NODE for write-time admissibility.
 *
 * ⚠ THE GOAL EXEMPTION IS LOAD-BEARING AND IS *NOT* PRESENT IN THE READ-TIME
 * COLLECTOR — the two consume the same predicate in opposite directions, so
 * they need different exemptions, and pretending otherwise is how a shared
 * predicate turns into a wrong claim. At read time
 * `collectUnmeasuredConstraintTargetIds` uses it to RELAX a withholding, so
 * including the goal node there costs at most a withholding it would have made
 * anyway. HERE the verdict is SPOKEN, so a goal target must be exempted: PLoT
 * skips PU injection for the goal node with reason `goal_node` precisely
 * because ISL computes that node's outcome distribution, and the constraint is
 * evaluated against it.
 */
export function classifyConstraintWriteAdmissibility(
  target: ConstraintTargetForAdmissibility,
): ConstraintWriteAdmissibility {
  if (target.kind === 'goal') return { checkable: true, basis: 'goal_target' };
  if (constraintTargetCarriesNoQuantity(target as Record<string, unknown>)) {
    return { checkable: false, reason: 'target_records_no_value' };
  }
  return { checkable: true, basis: 'target_records_a_value' };
}

/* ===========================================================================
 * THE TIME SPAN THAT SURVIVES ONLY AS PROSE.
 *
 * A `goal_constraints[]` row is `{node_id, operator, value, unit, label}`. It
 * has NO temporal field, at any schema version. So "for more than 3 months"
 * survives exclusively inside `label`, and the rule that is actually stored and
 * evaluated is "churn ≤ 7%" — which is NOT what the user said: a one-month
 * spike is fine by their actual meaning and violates the stored rule.
 *
 * Representing duration properly is a schema change across CEE → PLoT → ISL and
 * is far larger than this increment, so the honest move is the one the brief
 * names: SAY the time condition is recorded as description and not evaluated.
 * That sentence is unconditionally true of every row (the row has no temporal
 * field), so this scanner's ONLY job is to avoid pointing at the bound itself.
 *
 * ⚠ TWO EXCLUSIONS, BOTH STRUCTURAL, NEITHER A TUNING CONSTANT:
 *   (a) a TIME-DENOMINATED UNIT. "Runway must be at least 18 months" has
 *       `unit: 'months'` — the span IS the bound and nothing about it goes
 *       unchecked. Silent.
 *   (b) a number equal to the row's own VALUE. "Delivery at most 12 months"
 *       carries `value: 12`; the "12 months" in the label is the threshold
 *       being rendered, not a qualifier.
 *
 * ⚠ THE FALSE NEGATIVES THIS BUYS, DISCLOSED NOT DISCOVERED — all silent, all
 * in the direction of saying nothing rather than saying something untrue:
 *   · a span with no numeral ("for a sustained period", "for several months");
 *   · a span whose number happens to equal the threshold ("churn ≤ 3% for 3
 *     months") — exclusion (b) cannot tell the two 3s apart, and guessing would
 *     risk telling a user their BOUND is not checked, which is the one error
 *     this module must never make.
 *
 * The temporal alphabet is NOT spelled here: it is `TIME_UNIT_ALT`, derived
 * from `WORD_UNITS` in `cee/compound-goal/extractor.ts`, whose `temporal` flag
 * is already guarded for completeness by `durative-over-not-a-bound.test.ts`.
 * Adding a time unit there reaches this scanner with no edit (CLAUDE.md trap 12
 * — derive, don't mirror).
 * ========================================================================= */

/** `<number> <time-unit>` anywhere in a label. Built from the shared alphabet. */
const NUMBERED_TIME_SPAN_RE = new RegExp(
  String.raw`(\d[\d,]*(?:\.\d+)?)\s+(?:${TIME_UNIT_ALT})\b`,
  'gi',
);

/** A unit that IS a time unit — the whole unit string, not a substring of it. */
const TIME_DENOMINATED_UNIT_RE = new RegExp(String.raw`^\s*(?:${TIME_UNIT_ALT})\s*$`, 'i');

export interface DurationSpanScanInput {
  /**
   * The label that will be PERSISTED on the row — the only place a span
   * survives. Optional because `GoalConstraint.label` is: a row with no label
   * carries no span to speak about, and this returns `null` rather than
   * inventing one.
   */
  readonly label?: string | undefined;
  /** The row's own threshold, used to exclude the bound from the scan. */
  readonly value: number;
  /** The row's resolved unit, if any. */
  readonly unit?: string | undefined;
}

/**
 * The first time span in the label that the analysis will NOT evaluate, exactly
 * as it is written there, or `null` when there is none to speak about.
 */
export function findUnevaluatedDurationSpan(input: DurationSpanScanInput): string | null {
  if (typeof input.label !== 'string' || input.label.length === 0) return null;
  if (input.unit !== undefined && TIME_DENOMINATED_UNIT_RE.test(input.unit)) return null;

  // A fresh lastIndex per call — a module-level /g regex is stateful.
  const label = input.label;
  NUMBERED_TIME_SPAN_RE.lastIndex = 0;
  for (
    let match = NUMBERED_TIME_SPAN_RE.exec(label);
    match !== null;
    match = NUMBERED_TIME_SPAN_RE.exec(label)
  ) {
    const spelled = Number(match[1]!.replace(/,/g, ''));
    if (Number.isFinite(spelled) && spelled === input.value) continue;
    return match[0];
  }
  return null;
}
