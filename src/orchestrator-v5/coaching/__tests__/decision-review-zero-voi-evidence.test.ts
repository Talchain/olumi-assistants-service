/**
 * A FACTOR THE ENGINE SCORED AT ZERO VALUE OF INFORMATION MUST NOT BE HANDED
 * TO `decision_review` AS AN INVESTIGATION CANDIDATE.
 *
 * ⭐ THE WITNESSED HARM (deployed build, 2026-09-04 22:44–23:28Z). The product
 * told a founder, eight times, to "run a short pilot" on "Team coordination
 * overhead" — a factor its own engine scored `value_of_information: 0`,
 * `flip_risk_category: "negligible"`, `rank_flip_rate: 0`.
 *
 * ⚠ THE MODEL WAS NOT HALLUCINATING — IT WAS OBEYING. The served prompt
 * (`Prompts/canonical/decision_review.txt`, sha256 ba4879dd0a71…, the exact
 * hash captured on the witnessed turn) says at :227 and :383-384:
 *
 *     "EVIDENCE: the top 3 non-lever evidence_gaps by voi (all if fewer),
 *      one concrete action each."
 *     "The top 3 non-lever evidence_gaps by voi (all if fewer; {} if none;
 *      never fabricate entries)."
 *
 * **"all if fewer" carries no value-of-information floor.** `normaliseEvidenceGap`
 * accepts any FINITE `voi_score` — and `0` is finite — so a zero-VoI factor
 * entered `deterministic_coaching.evidence_gaps` and the prompt then required a
 * concrete data-gathering action for it.
 *
 * So the fix is at the COMPOSITION BOUNDARY, deterministically: a factor with
 * no measured information value is not an investigation candidate, and never
 * reaches the list the prompt selects from. This is deliberately NOT a prompt
 * change — a predicate over natural language cannot be bounded by tests, and
 * this estate has repeatedly watched such changes oscillate (trap 22f).
 *
 * ⚠ ASSERTIONS BIND BY IDENTITY (`factor_id`), never by a value predicate
 * another gap could satisfy (trap #19).
 */

import { describe, expect, it } from 'vitest';

import { buildInvokeInputForTests } from '../decision-review-enricher.js';

/**
 * Envelope that actually reaches the evidence-gap projection.
 *
 * ⚠ THE `results` ARRAY IS LOAD-BEARING, NOT DECORATION. `buildInvokeInput`
 * returns NULL when it cannot resolve a winner, and the first draft of this
 * suite omitted it: every `not.toContain` assertion then passed VACUOUSLY on
 * an empty array, i.e. the whole suite could not fail. {@link gapIds} now
 * asserts its own precondition so that can never recur silently.
 */
function envelopeWithGaps(gaps: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    results: [
      { option_id: 'opt-1', option_label: 'Option A', win_probability: 0.7 },
      { option_id: 'opt-2', option_label: 'Option B', win_probability: 0.3 },
    ],
    factor_sensitivity: [],
    robustness: { level: 'moderate', fragile_edges: [] },
    graph: { nodes: [], edges: [] },
    m1_coaching: {
      readiness: 'fair',
      headline_type: 'neutral',
      evidence_gaps: gaps,
    },
  };
}

/**
 * Read the gap ids the LLM would receive, PINNING THE PRECONDITION in-test:
 * a null invoke-input means the harness measured nothing, and an absence
 * assertion over nothing is a tautology (trap #13). Hard-fail instead.
 */
function gapIds(input: ReturnType<typeof buildInvokeInputForTests>): string[] {
  if (input === null) {
    throw new Error('buildInvokeInput returned null — the harness measured nothing');
  }
  const dc = (input as unknown as { deterministic_coaching?: { evidence_gaps?: unknown[] } })
    ?.deterministic_coaching;
  if (dc === undefined) {
    throw new Error('no deterministic_coaching on the invoke input — harness drift');
  }
  return (dc.evidence_gaps ?? []).map((g) => String((g as { factor_id: string }).factor_id));
}

/** The witnessed factor. `voi_score: 0` — zero measured value in resolving it. */
const ZERO_VOI_COORDINATION = {
  factor_id: 'coord-overhead-01',
  factor_label: 'Team coordination overhead',
  voi_score: 0,
  confidence: 0.6,
};

/** A factor that genuinely IS worth investigating — must SURVIVE. */
const INFORMATIVE_CHURN = {
  factor_id: 'churn-response-42',
  factor_label: 'Churn response to price',
  voi_score: 0.18,
  confidence: 0.7,
};

/** A very small but genuinely POSITIVE score — must SURVIVE (fail-open). */
const TINY_POSITIVE = {
  factor_id: 'tiny-but-real-07',
  factor_label: 'Supplier lead time',
  voi_score: 0.0001,
  confidence: 0.5,
};

describe('zero value-of-information factors are not investigation candidates', () => {
  it('THE WITNESSED CASE: a voi_score of 0 never reaches the list the prompt turns into a pilot', () => {
    const input = buildInvokeInputForTests('brief', envelopeWithGaps([ZERO_VOI_COORDINATION]), null);
    expect(input).not.toBeNull();
    expect(gapIds(input)).not.toContain('coord-overhead-01');
  });

  it('a factor with real value of information SURVIVES — the gate must not suppress everything', () => {
    const input = buildInvokeInputForTests('brief', envelopeWithGaps([INFORMATIVE_CHURN]), null);
    expect(gapIds(input)).toContain('churn-response-42');
  });

  it('DISCRIMINATION: in one payload the zero is dropped and the informative one is kept', () => {
    // The pair is the point. A gate that dropped everything would pass the
    // first test above; a gate that dropped nothing would pass the second.
    // Only a gate that discriminates passes both here, on one input.
    const input = buildInvokeInputForTests(
      'brief',
      envelopeWithGaps([ZERO_VOI_COORDINATION, INFORMATIVE_CHURN]),
      null,
    );
    const ids = gapIds(input);
    expect(ids).toContain('churn-response-42');
    expect(ids).not.toContain('coord-overhead-01');
  });

  it('a tiny but POSITIVE score survives — only a measured zero is suppressed', () => {
    const input = buildInvokeInputForTests('brief', envelopeWithGaps([TINY_POSITIVE]), null);
    expect(gapIds(input)).toContain('tiny-but-real-07');
  });

  it('a negative score is suppressed too — it cannot mean "worth investigating"', () => {
    const input = buildInvokeInputForTests(
      'brief',
      envelopeWithGaps([{ ...ZERO_VOI_COORDINATION, factor_id: 'neg-01', voi_score: -0.2 }]),
      null,
    );
    expect(gapIds(input)).not.toContain('neg-01');
  });

  it('a MALFORMED gap is still counted as malformed, not as a zero-VoI suppression', () => {
    // The two counters answer different questions and must not be conflated
    // (trap #21): `dropped` means "the producer sent something unusable",
    // the new counter means "the producer scored this at zero". Merging them
    // would corrupt existing malformed-entry telemetry.
    const input = buildInvokeInputForTests(
      'brief',
      envelopeWithGaps([
        { factor_id: 'malformed-01', factor_label: 'No voi at all', confidence: 0.5 },
      ]),
      null,
    );
    expect(gapIds(input)).not.toContain('malformed-01');
  });
});
