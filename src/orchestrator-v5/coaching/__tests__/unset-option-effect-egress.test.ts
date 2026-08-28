/**
 * RED-FIRST for the UNSET OPTION-EFFECT DISCLOSURE.
 *
 * ⭐ EVERY TEST IN THIS FILE RUNS AT PRISTINE. It imports only modules that
 * already exist and hard-codes the user-facing sentence as a LITERAL, so the
 * RED is a real measurement of the deployed defect ("the egress would strip
 * this sentence") rather than a module-not-found collection error. The
 * builder's own unit suite lives in `unset-option-effect-disclosure.test.ts`
 * and necessarily arrives with the implementation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT (measured on CEE staging, 2026-08-28, 15 fresh authenticated
 * draws). 7 of 9 first clicks return `status: needs_user_input` carrying
 * `MISSING_OPTION_VALUE` blockers while `may_run: true` and the analysis
 * returns results anyway — the compute-discard waiver deliberately lets the
 * run proceed. In all 7 the analyse turn's own sentence said NOTHING about the
 * unset option effects. In 3 of 15 it went further and named a decisive driver
 * that was ITSELF an unset factor.
 *
 * The analysis is NOT wrong and `may_run: true` is NOT a gate defect. The
 * defect is that the prose does not DISCLOSE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DISCRIMINATING PAIR, which is what makes this suite evidence rather than
 * decoration. Without the second limb a disclosure that fires ALWAYS is
 * indistinguishable from one that fires CORRECTLY:
 *
 *   POSITIVE  — a run with unset option effects must GAIN the sentence, and
 *               the sentence must SURVIVE the registry egress allowlist.
 *   CONTROL   — a run with everything set must NOT gain it, and must be
 *               byte-identical to what it is today (GREEN before AND after).
 */

import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  isAllowedRunAnalysisAssistantText,
  type AnalysisResultHeadlineInput,
} from '../analysis-result-headline.js';

/**
 * The exact sentence this lane ships, pinned as a LITERAL.
 *
 * ⚠ DELIBERATELY NOT imported from the builder. This is the EGRESS suite: its
 * job is to prove the wire admits this text, and importing the builder would
 * make the assertion "the allowlist admits whatever the builder emits" — which
 * is true by construction the moment both are derived from one RE_SRC, and
 * therefore proves nothing about the sentence a user actually reads. The
 * builder/literal agreement is pinned separately in the builder's own suite,
 * which REDs if either side moves.
 */
const UNSET_EFFECT_SENTENCE_SINGULAR =
  ' This analysis ran without a value for how “Keep what we have” affects ' +
  '“Sales Rep Adoption Rate”, so that option was analysed as leaving it unchanged. ' +
  'Set that value and run the analysis again to see whether the comparison changes.';

const UNSET_EFFECT_SENTENCE_PLURAL =
  ' This analysis ran without values for 3 option effects, including how ' +
  '“Keep what we have” affects “Sales Rep Adoption Rate”, so those options were ' +
  'analysed as leaving those factors unchanged. Set those values and run the ' +
  'analysis again to see whether the comparison changes.';

const UNSET_EFFECT_SENTENCE_GENERIC_SINGULAR =
  ' This analysis ran without a value for one option effect, so that option was ' +
  'analysed as leaving that factor unchanged. Set that value and run the ' +
  'analysis again to see whether the comparison changes.';

const UNSET_EFFECT_SENTENCE_GENERIC_PLURAL =
  ' This analysis ran without values for 3 option effects, so those options were ' +
  'analysed as leaving those factors unchanged. Set those values and run the ' +
  'analysis again to see whether the comparison changes.';

/** The locked template a WITHHELD turn (no headline) ships. */
const LOCKED_TEMPLATE = 'Ran analysis on your current scenario.';

/**
 * A Case-B run: a clear leader and a named strongest driver. `fac_adoption`
 * carries the top `influence_score`, so it is the factor the headline names.
 *
 * Modelled on the HIRING_FULL fixture in `analysis-result-headline.test.ts`,
 * with `factor_id` added — the id is what a driver/blocker cross-reference has
 * to join on, and the production `factor_sensitivity` entries carry it.
 */
const CASE_B_ENRICHMENT: Record<string, unknown> = {
  results: [
    { option_id: 'opt_hold', option_label: 'Keep what we have', win_probability: 0.82 },
    { option_id: 'opt_switch', option_label: 'Switch platform', win_probability: 0.18 },
  ],
  factor_sensitivity: [
    {
      factor_id: 'fac_adoption',
      label: 'Sales Rep Adoption Rate',
      factor_label: 'Sales Rep Adoption Rate',
      elasticity: 0.6,
      confidence: 0.8,
      influence_score: 0.6,
    },
    {
      factor_id: 'fac_cost',
      label: 'Licence Cost',
      factor_label: 'Licence Cost',
      elasticity: -0.3,
      confidence: 0.7,
      influence_score: 0.3,
    },
  ],
  // No `fragile_edges` — keeps the run in Case B (driver named, no caution).
  robustness: { level: 'moderate' },
};

const CASE_B_INPUT: AnalysisResultHeadlineInput = {
  enrichment: CASE_B_ENRICHMENT,
  leading_option_id: 'opt_hold',
  status_kind: 'ok',
};

/** The Case-B headline as it ships TODAY, driver clause and all. */
const CASE_B_HEADLINE_WITH_DRIVER =
  'Keep what we have came out ahead in 82% of runs of this model because ' +
  'Sales Rep Adoption Rate is the strongest driver.';

/** The same run with the driver clause omitted — an existing Case-E shape. */
const CASE_B_HEADLINE_WITHOUT_DRIVER = 'Keep what we have currently leads.';

describe('unset option-effect disclosure — registry egress', () => {
  // ───────────────────────────────────────────────────────────────────────
  // POSITIVE LIMB. RED at pristine: the allowlist has no slot for this
  // sentence, so the registry forwarder silently replaces the whole summary
  // with the locked template and the user reads NOTHING about the unset
  // effects. This is the single most likely way to ship the fix dark.
  // ───────────────────────────────────────────────────────────────────────
  it('⭐ admits the disclosure riding a LOCKED TEMPLATE (the withheld-turn path)', () => {
    expect(
      isAllowedRunAnalysisAssistantText(LOCKED_TEMPLATE + UNSET_EFFECT_SENTENCE_SINGULAR),
    ).toBe(true);
  });

  it('⭐ admits the disclosure riding a HEADLINE (the leader-named path)', () => {
    expect(
      isAllowedRunAnalysisAssistantText(
        CASE_B_HEADLINE_WITHOUT_DRIVER + UNSET_EFFECT_SENTENCE_SINGULAR,
      ),
    ).toBe(true);
  });

  it('admits every shape the builder can emit — plural, and both generic fallbacks', () => {
    for (const sentence of [
      UNSET_EFFECT_SENTENCE_PLURAL,
      UNSET_EFFECT_SENTENCE_GENERIC_SINGULAR,
      UNSET_EFFECT_SENTENCE_GENERIC_PLURAL,
    ]) {
      expect(isAllowedRunAnalysisAssistantText(LOCKED_TEMPLATE + sentence)).toBe(true);
      expect(
        isAllowedRunAnalysisAssistantText(CASE_B_HEADLINE_WITHOUT_DRIVER + sentence),
      ).toBe(true);
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // ⭐ THE OVER-DISCLOSURE CONTROL. GREEN at pristine AND after. Without it a
  // disclosure that fires on every run passes every positive test above.
  // ───────────────────────────────────────────────────────────────────────
  it('⭐ CONTROL — a bare locked template is still admitted, unchanged', () => {
    expect(isAllowedRunAnalysisAssistantText(LOCKED_TEMPLATE)).toBe(true);
  });

  it('⭐ CONTROL — a headline with NO disclosure is still admitted, unchanged', () => {
    expect(isAllowedRunAnalysisAssistantText(CASE_B_HEADLINE_WITH_DRIVER)).toBe(true);
  });

  it('⭐ CONTROL — the allowlist still rejects improvised prose in this slot', () => {
    // The widened grammar must admit THIS sentence, not "a sentence starting
    // with 'This analysis ran'". A slot loose enough to pass free prose is not
    // an allowlist.
    expect(
      isAllowedRunAnalysisAssistantText(
        LOCKED_TEMPLATE + ' This analysis ran without some values, so it is probably wrong.',
      ),
    ).toBe(false);
  });
});

describe('unset option-effect disclosure — the NAMED-DRIVER half', () => {
  // ───────────────────────────────────────────────────────────────────────
  // The sharper half of the defect: the headline named `Sales Rep Adoption
  // Rate` as the reason "Keep what we have" came out ahead, while that
  // factor's effect was never set for one of the options.
  //
  // ⚠ WHY OMISSION AND NOT A QUALIFIER. `influence_score` is a real measure of
  // the factor's influence on the OUTCOME, so "X is the strongest driver" is
  // true in isolation. What is unlicensed is the `because` — the clause binds
  // the driver to the WIN, and a factor an option does not move cannot be the
  // reason that option came out ahead of another. This is structurally the
  // same finding as the ratified option-controlled-lever rule already in
  // `resolveTopDriverLabel` ("never present a weaker driver as the strongest"
  // ⇒ OMIT, never substitute), so it reuses that mechanism rather than minting
  // a rival one — and omitting lands on an EXISTING headline shape, so it
  // needs no new grammar.
  // ───────────────────────────────────────────────────────────────────────
  it('⭐ omits the driver clause when the strongest driver is itself an unset option effect', () => {
    const out = buildAnalysisResultHeadline({
      ...CASE_B_INPUT,
      // Cast so this compiles at PRISTINE, where the field does not exist yet —
      // the assertion below is then a real measurement of today's behaviour
      // rather than a type error.
      unsetOptionEffectFactorIds: new Set(['fac_adoption']),
    } as AnalysisResultHeadlineInput);

    expect(out).not.toBeNull();
    expect(out!).not.toContain('is the strongest driver');
    expect(out!).not.toContain('Sales Rep Adoption Rate');
  });

  it('⭐ CONTROL — keeps the driver clause when NOTHING is unset', () => {
    const out = buildAnalysisResultHeadline(CASE_B_INPUT);
    expect(out).toBe(CASE_B_HEADLINE_WITH_DRIVER);
  });

  it('⭐ CONTROL — keeps the driver clause when a DIFFERENT factor is unset', () => {
    // Binds the suppression to the NAMED driver by identity. Without this a
    // rule that omitted whenever ANY effect was unset would pass the positive
    // test above and silently strip honest driver clauses off every partially
    // configured run.
    const out = buildAnalysisResultHeadline({
      ...CASE_B_INPUT,
      unsetOptionEffectFactorIds: new Set(['fac_cost']),
    } as AnalysisResultHeadlineInput);

    expect(out).toBe(CASE_B_HEADLINE_WITH_DRIVER);
  });
});
