/**
 * ⭐ PAUL'S RULING, 21 Sep 2026 — the result sentence names WHAT the option
 * came out highest ON, and never adjudicates.
 *
 * Verbatim: "It's not a leading option. It's the option from the causal
 * analysis that either is most likely to happen or, if we can provide this, is
 * most likely to achieve the user's goal. We are a reasoning enhancement tool,
 * not a causal analysis tool. We are giving them information to improve their
 * critical and creative thinking, not recommending options."
 *
 * WHY A BEHAVIOURAL GUARD AND NOT A PHRASE LIST IN A CONSTANT. A list of banned
 * words here would be a fourth hand-maintained copy (trap 12) and — the
 * decisive part — it would keep passing if the COMPOSER stopped naming the goal
 * at all, which is the direction a tidy-up moves. So every assertion below runs
 * the REAL exported composer and reads its real output.
 *
 * WHAT THE PROBABILITY ACTUALLY MEASURES, derived at the producer rather than
 * assumed: ISL `robustness_analyzer_v2.py:1078-1092` evaluates every option at
 * `request.goal_node_id` per Monte Carlo draw and credits the highest (ties
 * split); `robustness_v2.py:851` describes the field as "P(this option is
 * best)". So the quantity is the fraction of sampled futures in which the
 * option came out highest ON THE USER'S OWN GOAL. Goal-referenced, comparative,
 * and not a forecast that the option will succeed — which is exactly how
 * "performs best, with a probability of 62%" was being read.
 */
import { describe, it, expect } from 'vitest';
import { composeExplainResultsFallback } from '../explanation-fallback.js';
import type { AnalysisProjectionSummary } from '../../../context/projection-summaries.js';

const GOAL = 'Annual recurring revenue';

const projection: AnalysisProjectionSummary = {
  status: 'complete',
  leading_option: { label: 'Double Down on Self-Serve SMB', probability: 0.62 },
  runner_up: { label: 'Enterprise Land and Expand', probability: 0.24 },
  margin_pp: 38,
  robustness_band: 'stable',
  top_drivers: [],
};

/**
 * The superseded sentence, reproduced verbatim as it stood at staging
 * `09a1b3a5`. It is the POSITIVE CONTROL: every assertion below must be able to
 * REJECT this string, or the assertions are passing by testing nothing
 * (trap 13). It is an append-only record of what the product once said — never
 * edit it to match new copy (trap 14b).
 */
const SUPERSEDED =
  'Double Down on Self-Serve SMB performs best, with a probability of 62%. '
  + 'Enterprise Land and Expand sits in second place, with a probability of 24%, '
  + 'so the lead is meaningful rather than marginal.';

/** Vocabulary the ruling supersedes. Applied to OUTPUT, never to source. */
const SUPERSEDED_VOCABULARY = [
  /\bperforms best\b/i,
  /\bleading option\b/i,
  /\bsits in second place\b/i,
  /\bmeaningful rather than marginal\b/i,
  /\bwinner\b/i,
  /\brecommend(s|ed|ation)?\b/i,
];

function offendingPhrases(text: string): string[] {
  return SUPERSEDED_VOCABULARY.filter((r) => r.test(text)).map((r) => r.source);
}

describe("the result sentence answers 'highest on what?'", () => {
  it('POSITIVE CONTROL: the detector rejects the sentence this ruling supersedes', () => {
    // If this ever reads empty, every other assertion in this file is vacuous.
    expect(
      offendingPhrases(SUPERSEDED),
      'the superseded sentence must still be detectable, or these guards test nothing',
    ).not.toHaveLength(0);
  });

  it('names the goal the probability is about, when the goal is known', () => {
    const text = composeExplainResultsFallback(projection, null, null, null, GOAL);
    // Bind by identity — the exact goal label, not "a label appears".
    expect(text, 'the sentence must say what the option came out highest ON').toContain(GOAL);
    expect(text).toContain('Double Down on Self-Serve SMB');
    expect(offendingPhrases(text), 'superseded vocabulary reached the user').toEqual([]);
  });

  it('says "your goal" rather than inventing a referent, when the goal is unknown', () => {
    const text = composeExplainResultsFallback(projection, null, null, null, null);
    expect(text).toContain('your goal');
    // A wrong goal is worse than a generic one: the reader cannot tell it is wrong.
    expect(text, 'no other label may be substituted for the goal').not.toContain(GOAL);
    expect(offendingPhrases(text)).toEqual([]);
  });

  it('states the measurement without adjudicating whether the margin matters', () => {
    const text = composeExplainResultsFallback(projection, null, null, null, GOAL);
    // The analysis produces a margin. It does not produce a verdict ON that
    // margin, so the product must not state one.
    expect(text).not.toMatch(/\bmeaningful\b/i);
    expect(text).not.toMatch(/\bmarginal\b/i);
  });

  it('a near-tie is still goal-referenced (the guard is not bound to one branch)', () => {
    const tied: AnalysisProjectionSummary = {
      ...projection,
      runner_up: { label: 'Enterprise Land and Expand', probability: 0.61 },
      margin_pp: 1,
    };
    const text = composeExplainResultsFallback(tied, null, null, null, GOAL);
    expect(offendingPhrases(text)).toEqual([]);
  });
});
