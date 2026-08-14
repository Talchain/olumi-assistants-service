/**
 * THE OUTSIDE-THE-AUTHOR'S-HEAD CORPUS for the goal-direction predicate.
 *
 * ⚠⚠ WHY THIS FILE EXISTS, AND WHY IT MAY NOT BE "TIDIED".
 *
 * CLAUDE.md trap 22: *a corpus drawn from the author's head cannot see the class
 * the author did not imagine — and a 25/25 mutant kit will certify it.* Six live
 * defects shipped in a stated-value-honour rule with every suite green, because
 * the guards' corpora shared the code's blind spot. CEE #888 then lost FOUR
 * CONSECUTIVE ROUNDS on one natural-language predicate, each round fixing one
 * direction and reopening the other, every round green.
 *
 * So this corpus is not written. It is HARVESTED, by script, on a stated date,
 * from real artefacts:
 *
 *     every *.json under the repo (excluding node_modules), taking the `label`
 *     of every node whose `kind`/`type` is goal/objective/outcome or whose `id`
 *     begins `goal` — deduplicated, sorted.
 *
 * Harvested 2026-08-14 at CEE `73ea84e6`. **73 distinct labels.** The sources
 * are fixtures, golden briefs, cross-service captures, `acceptance-evidence/`
 * live draft captures, `tools/graph-evaluator` fixtures and the L60 Supabase
 * pull of a REAL staging scenario.
 *
 * ⚠ APPEND-ONLY (trap 14b). These are records of labels the product actually
 * carried on dated builds. You may ADD to this list; you may not EDIT an entry
 * to keep it current. Rewriting it would make the suite agree with a history
 * that never happened.
 *
 * ⭐ THE MEASURED SCOPE FACT THIS CORPUS ESTABLISHES, and the reason the
 * directional arm is gated on ARITHMETIC rather than on this predicate alone:
 * **not one of the 73 states a direction over a factor the options intervene
 * on.** They are directions over the GOAL METRIC (`Maximise ARR`) or they are
 * non-directional (`Choose vendor`). The pricing shape the investigation was
 * opened on — `Grow MRR to £250,000`, with options intervening on price — is in
 * the first class, which is exactly why the directional arm stays SILENT there
 * and the goal-attainment arm is the one that speaks.
 */

import { describe, it, expect } from 'vitest';

import { deriveGoalIntent } from '../objective-contradiction.js';

/**
 * The harvest. Frozen literal, not re-derived at test time: a corpus that
 * re-reads the fixtures would silently shrink the day a fixture is deleted, and
 * a shrinking corpus is the failure mode that cannot be seen from a green run.
 */
const HARVESTED_GOAL_LABELS: readonly string[] = Object.freeze([
  'Accelerate product delivery',
  'Achieve 15% ARR Growth Without Worsening Attrition',
  'Achieve EBITDA Breakeven by Q3 2027',
  'Achieve Profitable European Market Entry Within Budget',
  'Annual Recurring Revenue',
  'Balance product velocity with system health',
  'Build Sales Pipeline',
  'Build development capacity on time',
  'Choose vendor',
  'Deliver 4-Day Week Within Budget and CSAT Floor',
  'Deliver Business Value',
  'Deliver CRM capability on time',
  'Deliver Project Successfully with Sustainable Team',
  'Deliver Q3 Roadmap Commitments',
  'Double Revenue',
  'Engineering Excellence',
  'European Growth',
  'Grow Annual Recurring Revenue',
  'Grow MRR',
  'Grow MRR to £250,000',
  'High Quality Delivery',
  'Hit compliance deadline',
  'Increase Pro upgrades',
  'International Growth',
  'Maintain system performance and scalability',
  'Maximise ARR',
  'Maximise Attendee Turnout',
  'Maximise CRM Value Over 3 Years',
  'Maximise CRM Value Over Three Years',
  'Maximise Deal Value',
  'Maximise Growth',
  'Maximise Launch ROI',
  'Maximise Net ARR Growth',
  'Maximise Profit',
  'Maximise Revenue',
  'Maximise Sales Productivity Within Budget',
  'Maximise Sustainable Growth',
  'Maximise Team Productivity',
  'Maximize Profit',
  'Maximize Revenue',
  'Maximize Sustainable Profitability',
  'Maximize business growth',
  'Maximize career success and happiness',
  'Maximize market share and revenue',
  'Maximize revenue growth and market position',
  'Maximize revenue to $500,000',
  'Maximize team output',
  'Meet Q3 Roadmap Commitments at Scale',
  'Mid-market revenue target',
  'Minimise TCO over 3 years',
  'Minimize long-term energy costs',
  'Monthly Recurring Revenue',
  'Optimise 7-Year Fleet Total Cost of Ownership',
  'Project Success',
  'Reach $200k revenue target',
  'Reach 800 Pro Customers',
  'Reach £20k MRR within 12 months',
  'Reach £20m ARR by End of FY28',
  'Reach £250k Monthly Recurring Revenue',
  'Resolve Nursing Shortage Within Budget and Safety Constraints',
  'Revenue Growth',
  'Scale delivery',
  'Scale delivery for Q3',
  'Select Best Vendor',
  'Ship AI Features Within 6 Months',
  'Ship Compliance Feature On Time Without Platform Incidents',
  'Ship Fast and Cheaply',
  'Successful product launch with market share',
  'Sustain CSAT at or Above 85% Within £250k Implementation Budget',
  'Sustainable Profitability',
  'higher sales productivity without blowing the budget',
  'unlock larger enterprise deals',
  '£20k MRR',
]);

/**
 * THE EXPECTED CLASSIFICATION — the ORACLE, and it is derived from what a
 * British-business-English reader takes the label to ASK, never from what the
 * implementation happens to return (trap 13c: a mutant kit validates
 * sensitivity, never a wrong oracle; a perfect kill-rate against a
 * self-confirming oracle is a perfect score on the wrong exam).
 *
 * Only labels expected to yield a direction are listed. Everything else in
 * {@link HARVESTED_GOAL_LABELS} is expected UNDETERMINED, and that
 * KNOWN-UNDETERMINED set is asserted EXACTLY below.
 */
const EXPECTED_INCREASE: readonly string[] = Object.freeze([
  'Accelerate product delivery',
  'Double Revenue',
  'Grow Annual Recurring Revenue',
  'Grow MRR',
  'Grow MRR to £250,000',
  'Increase Pro upgrades',
  'Maximise ARR',
  'Maximise Attendee Turnout',
  'Maximise CRM Value Over 3 Years',
  'Maximise CRM Value Over Three Years',
  'Maximise Deal Value',
  'Maximise Growth',
  'Maximise Launch ROI',
  'Maximise Net ARR Growth',
  'Maximise Profit',
  'Maximise Revenue',
  'Maximise Sales Productivity Within Budget',
  'Maximise Sustainable Growth',
  'Maximise Team Productivity',
  'Maximize Profit',
  'Maximize Revenue',
  'Maximize Sustainable Profitability',
  'Maximize business growth',
  'Maximize career success and happiness',
  'Maximize market share and revenue',
  'Maximize revenue growth and market position',
  'Maximize revenue to $500,000',
  'Maximize team output',
]);

const EXPECTED_DECREASE: readonly string[] = Object.freeze([
  'Minimise TCO over 3 years',
  'Minimize long-term energy costs',
]);

describe('goal-direction corpus — harvested 2026-08-14 at CEE 73ea84e6', () => {
  it('the corpus is the size it was harvested at, and is deduplicated', () => {
    expect(HARVESTED_GOAL_LABELS).toHaveLength(73);
    expect(new Set(HARVESTED_GOAL_LABELS).size).toBe(73);
  });

  it('CONFUSION MATRIX — every harvested label classifies exactly as the oracle says', () => {
    const actual = {
      increase: [] as string[],
      decrease: [] as string[],
      undetermined: [] as string[],
    };
    for (const label of HARVESTED_GOAL_LABELS) {
      actual[deriveGoalIntent(label).direction].push(label);
    }

    // Printed on failure so a drift names the labels rather than a count.
    expect(actual.increase.slice().sort()).toEqual(EXPECTED_INCREASE.slice().sort());
    expect(actual.decrease.slice().sort()).toEqual(EXPECTED_DECREASE.slice().sort());

    // The matrix has no off-diagonal mass by construction: three disjoint
    // buckets covering the whole corpus.
    expect(
      actual.increase.length + actual.decrease.length + actual.undetermined.length,
    ).toBe(73);
    expect(actual.increase).toHaveLength(28);
    expect(actual.decrease).toHaveLength(2);
    expect(actual.undetermined).toHaveLength(43);
  });

  /**
   * ⭐ TRAP 22f — THE KNOWN-UNDETERMINED SET, PINNED EXACTLY.
   *
   * *"The honest way to ship a known gap: pin it in an explicit KNOWN-DROPPED
   * set with a test asserting EXACTLY that set — so the suite stays green for
   * the right reason and REDs if the set grows OR shrinks."*
   *
   * GROWS ⇒ the predicate has started refusing labels it used to read, and a
   * legitimate honesty surface has gone silent. SHRINKS ⇒ the predicate has
   * started reading a direction into a label whose direction is genuinely
   * undetermined, which is the LIE direction (trap 22b). Both are RED.
   */
  it('KNOWN-UNDETERMINED is exactly this set — REDs if it grows OR shrinks', () => {
    const undetermined = HARVESTED_GOAL_LABELS.filter(
      (l) => deriveGoalIntent(l).direction === 'undetermined',
    );
    expect(undetermined.slice().sort()).toEqual(
      HARVESTED_GOAL_LABELS.filter(
        (l) => !EXPECTED_INCREASE.includes(l) && !EXPECTED_DECREASE.includes(l),
      )
        .slice()
        .sort(),
    );
  });
});

describe('the opposite-direction twins (trap 22b — every case gets its twin)', () => {
  /**
   * ⚠ A predicate guarding two opposite harms needs TWO parameters, not one
   * window. A false positive that DROPS a contradiction is a gap; one that
   * INVENTS a contradiction is a lie. These are the lie-direction cases.
   */
  it('STASIS is never read as increase — the inversion that would invent a contradiction', () => {
    for (const label of [
      'Maintain system performance and scalability',
      'Maintain £49 Price',
      'Sustain CSAT at or Above 85% Within £250k Implementation Budget',
      'Hold the current price point',
      'Keep churn where it is',
      'Preserve gross margin',
    ]) {
      expect(deriveGoalIntent(label).direction).toBe('undetermined');
    }
  });

  it('a stasis verb BESIDE a direction verb is undetermined, not increase', () => {
    // Which verb governs the lever cannot be determined; refusing both is the
    // only answer that cannot lie.
    expect(deriveGoalIntent('Grow MRR while maintaining gross margin').direction).toBe(
      'undetermined',
    );
    expect(deriveGoalIntent('Increase price but hold churn steady').direction).toBe(
      'undetermined',
    );
  });

  it('DECREASE goals do not trigger the increase logic', () => {
    for (const label of [
      'Reduce churn',
      'Reduce monthly churn below 3%',
      'Minimise TCO over 3 years',
      'Lower cost to serve',
      'Cut support headcount',
    ]) {
      expect(deriveGoalIntent(label).direction).toBe('decrease');
    }
  });

  it('INCREASE goals do not trigger the decrease logic', () => {
    for (const label of ['Increase our subscription price', 'Raise seat price to £59']) {
      expect(deriveGoalIntent(label).direction).toBe('increase');
    }
  });

  it('genuinely ambiguous verbs are undetermined — the estate does not guess', () => {
    for (const label of [
      'Optimise 7-Year Fleet Total Cost of Ownership',
      'Balance product velocity with system health',
      'Improve Product UX',
      'Manage the cost base',
    ]) {
      expect(deriveGoalIntent(label).direction).toBe('undetermined');
    }
  });

  /**
   * ⚠ ADDED BY A SURVIVING MUTANT, NOT BY INSPECTION. Deleting the ambiguous
   * refusal left the case above fully GREEN — none of those four labels carries
   * a DIRECTION stem, so the refusal never had to fire for them to pass. The
   * test was a guard agreeing with itself (trap 13b): present, and covering no
   * branch. These labels carry BOTH an ambiguous verb and a direction verb, so
   * only the refusal can produce `undetermined`.
   */
  it('an AMBIGUOUS verb beside a direction verb is undetermined (kills the ambiguous-refusal mutant)', () => {
    expect(deriveGoalIntent('Optimise pricing to grow MRR').direction).toBe('undetermined');
    expect(deriveGoalIntent('Improve retention and increase ARR').direction).toBe(
      'undetermined',
    );
    expect(deriveGoalIntent('Balance cost against raising throughput').direction).toBe(
      'undetermined',
    );
  });

  /**
   * ⚠ ALSO ADDED BY A SURVIVING MUTANT. Disabling the both-directions refusal
   * left every existing case green, because no case carried an increase stem
   * AND a decrease stem at once — so the refusal was untested and a label
   * asking for two opposite moves would silently have been read as `increase`.
   * That is the LIE direction (trap 22b): inventing a single intent where the
   * user stated two.
   */
  it('TWO OPPOSITE directions in one aim is undetermined (kills the both-direction mutant)', () => {
    expect(deriveGoalIntent('Increase price and reduce churn').direction).toBe('undetermined');
    expect(deriveGoalIntent('Grow revenue while cutting cost to serve').direction).toBe(
      'undetermined',
    );
  });

  /**
   * ⚠ THE NOUN/VERB TRAP, and it is live in the corpus: `European Growth`,
   * `International Growth`, `Revenue Growth` are NOUN phrases. Reading `Growth`
   * as the verb `grow` would classify a bare metric name as a lever
   * instruction. The `\b`-anchored inflection groups are what prevent it — a
   * bare-substring matcher would fire on all three.
   */
  it('a direction NOUN is not a direction VERB', () => {
    for (const label of ['European Growth', 'International Growth', 'Revenue Growth']) {
      expect(deriveGoalIntent(label).direction).toBe('undetermined');
    }
    // ...and the containment control: the verb form IS read.
    expect(deriveGoalIntent('Grow revenue').direction).toBe('increase');
  });

  it('ATTAINMENT verbs are not direction verbs — they are the goal-attainment arm’s territory', () => {
    for (const label of [
      'Reach £20k MRR within 12 months',
      'Achieve EBITDA Breakeven by Q3 2027',
      'Hit compliance deadline',
      'Meet Q3 Roadmap Commitments at Scale',
      'Deliver CRM capability on time',
    ]) {
      expect(deriveGoalIntent(label).direction).toBe('undetermined');
    }
  });
});

describe('subject extraction — the window is decimal-safe (trap 22)', () => {
  /**
   * ⚠ THE MEASURED DEFECT THIS GUARDS. A guard its own module called "the most
   * important line here" could not fire at all, because the window handed to it
   * was cut at the first `[.!?]` — WHICH IS ALSO THE DECIMAL POINT — so
   * `£1.5 million` was truncated to `1` before the guard ever looked. The guard
   * was correct and pointed at the wrong bytes.
   */
  it('a decimal in the target does not truncate the subject', () => {
    expect(deriveGoalIntent('Grow MRR to £1.5 million').subject).toBe('mrr');
    expect(deriveGoalIntent('Increase price to £59.99').subject).toBe('price');
  });

  it('the subject stops at a clause boundary, not mid-noun', () => {
    expect(deriveGoalIntent('Grow Annual Recurring Revenue').subject).toBe(
      'annual recurring revenue',
    );
    expect(deriveGoalIntent('Increase our subscription price').subject).toBe(
      'our subscription price',
    );
    expect(deriveGoalIntent('Maximise CRM Value Over 3 Years').subject).toBe('crm value');
  });

  it('non-strings and empties are undetermined, never a throw', () => {
    for (const value of [null, undefined, 42, {}, [], '', '   ']) {
      expect(deriveGoalIntent(value).direction).toBe('undetermined');
    }
  });
});
