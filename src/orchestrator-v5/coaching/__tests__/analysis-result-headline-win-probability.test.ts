/**
 * The headline states the leader's OWN win probability, never the gap to the
 * runner-up.
 *
 * THE DEFECT THIS PINS. `analysis_result.summary` shipped sentences like
 * "Switch to HubSpot currently leads by 95 percentage points." That number is
 * the difference between two `P(argmax)` statistics — not a difference in
 * outcome, cost or benefit — and "leads by 95 percentage points" invites the
 * reading "95% better", which it emphatically is not.
 *
 * Worse, it INFLATES BY CONSTRUCTION. The gap widens when a THIRD option
 * collapses, with no improvement whatever in the leader: a 92pp figure was
 * measured on a run whose runner-up had itself fallen to 4%. The number moved
 * because someone else got worse. That is the property the third test below
 * pins directly, and it is the reason a gap can never be the headline
 * statistic: no threshold on a difference-of-argmax-probabilities makes it
 * mean what a reader takes it to mean.
 *
 * WHAT REPLACES IT. `{leader} came out ahead in {P}% of runs of this model` —
 * exactly what `win_probability` is, scoped to the model that produced it.
 * It cannot be inflated by a third option collapsing, and the leader's own
 * probability was already resolved in the same module (`winner.winnerProb`),
 * so nothing new is computed and no new field crosses any boundary.
 *
 * "of this model" is load-bearing and is asserted on every numbered band. The
 * statistic is a property of the model as drafted, not a measurement of the
 * world, and the clause is the whole difference between a user reading 72% as
 * evidence and reading it as arithmetic over assumptions.
 *
 * ASSERTIONS ARE POSITIVE AND BIND BY IDENTITY. Every case asserts the WHOLE
 * sentence the user sees, by exact string. A `not.toContain('percentage
 * points')` would pass just as happily on an empty summary, on the locked
 * template, and on a sentence that dropped the leader's name — the three
 * failure modes most likely here, since an unrecognised shape is silently
 * replaced by the locked template at egress.
 *
 * THE EGRESS PAIR. Each new shape is asserted against
 * `isAllowedRunAnalysisAssistantText` as well as against the builder. The two
 * are separate mechanisms — a shape the builder emits but the grammar does not
 * admit is swallowed at the wire and the user receives the bland locked
 * template, with no error raised anywhere. That failure mode has shipped in
 * this module three times (the constraint-gap disclosure, the round-5 override
 * shape, the scaffold disclosure); asserting the builder alone would not see
 * it.
 */

import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  isAllowedRunAnalysisAssistantText,
} from '../analysis-result-headline.js';

/** Two options, 62/38 — a clean, comfortably-leading, fragility-bearing run. */
const HIRING_FULL: Record<string, unknown> = {
  results: [
    { option_id: 'opt_a', option_label: 'Hire One Senior Technical Lead', win_probability: 0.62 },
    { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.38 },
  ],
  factor_sensitivity: [
    { label: 'Technical Leadership in Place', elasticity: 0.6, confidence: 0.8, influence_score: 0.6 },
    { label: 'Hiring and Salary Cost', elasticity: -0.3, confidence: 0.7, influence_score: 0.3 },
  ],
  robustness: {
    level: 'moderate',
    fragile_edges: [
      { from_label: 'Hiring and Salary Cost', to_label: 'Outcome', switch_probability: 0.45 },
    ],
  },
};

describe('headline states the leader’s own win probability, not the gap', () => {
  it('Case A (winner + provisional caution): states the leader’s win probability "of this model"', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe(
      'Hire One Senior Technical Lead came out ahead in 62% of runs of this model, but treat this as provisional: the result is sensitive to Hiring and Salary Cost.',
    );
    // Egress: the builder emitting it is not enough — the grammar must admit it
    // or the wire silently serves the locked template instead.
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('Case B (winner + driver, robust): states the leader’s win probability "of this model"', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: { ...HIRING_FULL, robustness: { level: 'moderate' } },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe(
      'Hire One Senior Technical Lead came out ahead in 62% of runs of this model because Technical Leadership in Place is the strongest driver.',
    );
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('Case D (winner + number only): states the leader’s win probability "of this model"', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Hire One Senior Technical Lead', win_probability: 0.62 },
          { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.38 },
        ],
        robustness: { level: 'moderate' },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe(
      'Hire One Senior Technical Lead came out ahead in 62% of runs of this model.',
    );
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  // ==========================================================================
  // The inflation property — the reason a gap can never be the headline number
  // ==========================================================================

  it('THE INFLATION PROPERTY: a third option collapsing must not change the headline number', () => {
    // Two runs, SAME leader, SAME leader win_probability (0.62). The only
    // difference is how the REMAINING 38% is distributed among the other two
    // options. In the second run the runner-up has collapsed to 4% — which is
    // exactly the shape that produced the measured 92pp figure: the gap widened
    // because a rival fell away, not because the leader did anything.
    const leaderSteady = { option_id: 'opt_a', option_label: 'Switch to HubSpot', win_probability: 0.62 };

    const spreadField = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          leaderSteady,
          { option_id: 'opt_b', option_label: 'Stay on Salesforce', win_probability: 0.2 },
          { option_id: 'opt_c', option_label: 'Build In House', win_probability: 0.18 },
        ],
        robustness: { level: 'moderate' },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });

    const collapsedField = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          leaderSteady,
          { option_id: 'opt_b', option_label: 'Stay on Salesforce', win_probability: 0.04 },
          { option_id: 'opt_c', option_label: 'Build In House', win_probability: 0.34 },
        ],
        robustness: { level: 'moderate' },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });

    // The leader did not improve between these two runs — its win probability
    // is 0.62 in both — so the headline number MUST be identical. Under the
    // old gap copy these read "leads by 42 percentage points" and "leads by 28
    // percentage points": the same leader, two different confident numbers,
    // moved entirely by options the user was not asking about.
    expect(spreadField).toContain('came out ahead in 62% of runs of this model');
    expect(collapsedField).toContain('came out ahead in 62% of runs of this model');
    expect(spreadField).toBe(collapsedField);
  });

  it('the leader’s number tracks the LEADER: a genuinely stronger leader reads higher', () => {
    // The discriminating half of the pair above. The previous test proves the
    // number is INSENSITIVE to the rest of the field; on its own that is also
    // satisfied by a constant, so this proves it still MOVES with the leader.
    const out = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Switch to HubSpot', win_probability: 0.91 },
          { option_id: 'opt_b', option_label: 'Stay on Salesforce', win_probability: 0.09 },
        ],
        robustness: { level: 'moderate' },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Switch to HubSpot came out ahead in 91% of runs of this model.');
  });

  // ==========================================================================
  // The rounding itself — the one quantity this change exists to produce
  // ==========================================================================

  it('the percentage is ROUNDED, not truncated (0.615 → 62%, never 61%)', () => {
    // ⚠ WHY A DEDICATED CASE FOR ONE ARITHMETIC OPERATOR. Every other test here
    // uses a probability whose ×100 is already an integer (0.62, 0.91, 0.52),
    // so `Math.round` and `Math.floor` agree on all of them and the whole suite
    // passes with the operator swapped. A mutant that survives the entire
    // battery on the exact statistic the change exists to state is an UNPINNED
    // PROPERTY, not an equivalent one — and it is unpinned precisely where it
    // matters most, because rounding is the last step between the engine's
    // number and the sentence a user reads.
    //
    // 0.615 is the discriminator: `0.615 * 100` is 61.5, so round → 62 and
    // floor → 61. Half-up is the correct choice — it is what the single-option
    // Case D band has always used, and truncation would bias EVERY displayed
    // figure downward, understating the leader on average by half a point for
    // no reason a user could discover.
    const out = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Switch to HubSpot', win_probability: 0.615 },
          { option_id: 'opt_b', option_label: 'Stay on Salesforce', win_probability: 0.385 },
        ],
        robustness: { level: 'moderate' },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Switch to HubSpot came out ahead in 62% of runs of this model.');
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('a probability just under certainty rounds to 100%, and stays an integer', () => {
    // The upper-boundary partner: 0.999 → 100 under round, 99 under floor. Also
    // guards the grammar's `\d{1,3}` slot at three digits and re-asserts the
    // no-raw-decimals content defence at the value most likely to leak one.
    const out = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Switch to HubSpot', win_probability: 0.999 },
          { option_id: 'opt_b', option_label: 'Stay on Salesforce', win_probability: 0.001 },
        ],
        robustness: { level: 'moderate' },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Switch to HubSpot came out ahead in 100% of runs of this model.');
    expect(out!).not.toMatch(/\d+\.\d+/);
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  // ==========================================================================
  // Bands that must NOT acquire a number — the corpus in the other direction
  // ==========================================================================

  it('near-tie (1pp < margin < 5pp) also states the leader’s win probability', () => {
    // This band DOES carry a number today ("leads by 4 percentage points"), so
    // it carries the category error and must convert with the rest. Its
    // closeness caveat is untouched — the change is to the statistic, never to
    // the honesty framing around it.
    const out = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Hire One Senior Technical Lead', win_probability: 0.52 },
          { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.48 },
        ],
        robustness: { level: 'moderate' },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe(
      'Hire One Senior Technical Lead came out ahead in 52% of runs of this model, but the options are close.',
    );
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('Case E (weak plurality floor) keeps its number-free copy', () => {
    // Sub-MIN_LEAD_PROBABILITY with no driver and no fragility: every enriching
    // gate declined this run, so the floor must NOT gain a win-probability
    // number as a side effect of the change. This is the corpus in the other
    // direction — the bands that must stay exactly as they are.
    const out = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Hire One Senior Technical Lead', win_probability: 0.35 },
          { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.28 },
        ],
        robustness: { level: 'moderate' },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Hire One Senior Technical Lead currently leads.');
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('near-tie (≤1pp) keeps its number-free "effectively tied" copy', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Hire One Senior Technical Lead', win_probability: 0.505 },
          { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.495 },
        ],
        robustness: { level: 'moderate' },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe(
      'Hire One Senior Technical Lead is currently only fractionally ahead, so the options are effectively tied.',
    );
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  // ==========================================================================
  // Egress: the retired phrasing must no longer be admitted
  // ==========================================================================

  it('the retired gap phrasing is no longer admitted at egress', () => {
    // Asserted at the ALLOWLIST, not merely absent from the builder: the
    // grammar is the second line of defence, and leaving the old alternative
    // in it would let a regression re-emit the category error unchallenged.
    expect(
      isAllowedRunAnalysisAssistantText(
        'Switch to HubSpot currently leads by 95 percentage points.',
      ),
    ).toBe(false);
    expect(
      isAllowedRunAnalysisAssistantText(
        'Switch to HubSpot currently leads by 24 percentage points, but the options are close.',
      ),
    ).toBe(false);
  });
});
