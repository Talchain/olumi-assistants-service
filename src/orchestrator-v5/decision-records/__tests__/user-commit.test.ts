/**
 * Calibration R0 — the USER-COMMIT builder and the outcome scorer.
 *
 * Every assertion binds by IDENTITY (an exact record_id, an exact
 * `confidence_source` literal, an exact rung name), never by a value
 * predicate another object could satisfy (CLAUDE.md trap 19).
 *
 * ORACLE PROVENANCE (trap 13c). The literals under test are DERIVED from the
 * producer's own contract — `DecisionRecordConfidenceSource` and
 * `DecisionRecordOutcomeResult` in `@talchain/schemas/boundary` — not from
 * this lane's reading of what the fields ought to mean. A mutant kit proves a
 * test is SENSITIVE; only the contract can prove it is RIGHT.
 */

import { describe, expect, it } from 'vitest';

import {
  DecisionRecordConfidenceSource,
  DecisionRecordOutcomeResult,
  DecisionRecordDecisionSchema,
  DecisionRecordPredictionSchema,
} from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  AAG_V1_GRAPH_HASH_PREFIX,
  DECISION_RECORD_REVIEW_HORIZON_DAYS,
  buildDecisionRecordWrite,
  deriveDecisionRecordId,
} from '../capture.js';
import {
  AUTO_CAPTURE_RECORD_ID_NAMESPACE,
  USER_COMMIT_RECORD_ID_NAMESPACE,
} from '../record-id.js';
import {
  buildUserCommitWrite,
  deriveCommittedDecisionRecordId,
  normaliseStatedConfidence,
  parseRevisitDate,
} from '../user-commit.js';
import {
  BRIER_FORMULA_VERSION,
  DECISION_OUTCOME_RESULTS,
  computeBrierComponent,
  isDecisionOutcomeResult,
  resultToOutcomeIndicator,
} from '../scoring.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HASH_AT_RUN = 'abcdef0123456789';
const COMPUTED_AT = '2026-07-10T12:00:00.000Z';
const GRAPH_HASH = `${AAG_V1_GRAPH_HASH_PREFIX}${HASH_AT_RUN}`;
const NOW = new Date('2026-08-06T09:00:00.000Z');
const NONCE = 'commit-nonce-1';

/**
 * The producer's own fact shape, TYPED by the producer's contract
 * (`RunAnalysisHandlerFact`) rather than hand-authored as a loose object —
 * a fixture you wrote yourself is not evidence about the wire (trap 16).
 */
function makeFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      win_probabilities: { 'Option A': 0.62, 'Option B': 0.38 },
      summary: 'Option A currently leads.',
      enrichment: {
        option_comparison: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
        ],
      },
      graph_hash_at_run: HASH_AT_RUN,
      computed_at: COMPUTED_AT,
    },
  };
}

function commit(overrides?: Partial<Parameters<typeof buildUserCommitWrite>[0]>) {
  return buildUserCommitWrite({
    scenarioId: SCENARIO_ID,
    userId: USER_ID,
    chosenOptionId: 'opt_b',
    chosenOptionLabel: 'Option B',
    confidence0to100: 72,
    expectationStatement: 'Runway holds above 9 months through Q1.',
    graphHashAtRun: HASH_AT_RUN,
    commitNonce: NONCE,
    now: NOW,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// T1 — the record-id collision. THE test that matters most in this slice.
// ---------------------------------------------------------------------------

describe('T1 — a user commit never lands in the auto-capture id space', () => {
  it('derives a DIFFERENT record_id from the auto-capture id for the SAME analysed graph', () => {
    // The exact id the ambient capture seam would mint for this analysis.
    const autoId = deriveDecisionRecordId(SCENARIO_ID, GRAPH_HASH, COMPUTED_AT);
    const built = commit();
    expect(built.kind).toBe('write');
    if (built.kind !== 'write') return;

    // IDENTITY BINDING: the auto id is named exactly, not merely "some other
    // id". If the commit derivation ever equals it, the RPC's replay branch
    // returns the model-derived record with deduped:true and the user's
    // stated confidence is silently discarded.
    expect(built.write.record_id).not.toBe(autoId);
    expect(built.write.event_id).toBe(`decision_recorded_${built.write.record_id}`);
    expect(built.write.event_id).not.toBe(`decision_recorded_${autoId}`);
  });

  it('cannot collide even when the commit nonce is the analysis computed_at', () => {
    // The worst-case near-miss: every tuple member the auto seam uses, plus a
    // nonce equal to its third member. The NAMESPACE and the user id are what
    // keep the two apart.
    const autoId = deriveDecisionRecordId(SCENARIO_ID, GRAPH_HASH, COMPUTED_AT);
    const commitId = deriveCommittedDecisionRecordId(
      SCENARIO_ID,
      GRAPH_HASH,
      USER_ID,
      COMPUTED_AT,
    );
    expect(commitId).not.toBe(autoId);
  });

  it('keeps the two namespaces distinct at the source (the collision guard itself)', () => {
    expect(USER_COMMIT_RECORD_ID_NAMESPACE).not.toBe(AUTO_CAPTURE_RECORD_ID_NAMESPACE);
    expect(AUTO_CAPTURE_RECORD_ID_NAMESPACE).toBe('cee:decision_record:v1');
    expect(USER_COMMIT_RECORD_ID_NAMESPACE).toBe('cee:decision_record:commit:v1');
  });

  it('separates two USERS committing on the same analysed graph', () => {
    const a = deriveCommittedDecisionRecordId(SCENARIO_ID, GRAPH_HASH, USER_ID, NONCE);
    const b = deriveCommittedDecisionRecordId(
      SCENARIO_ID,
      GRAPH_HASH,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      NONCE,
    );
    expect(a).not.toBe(b);
  });

  it('separates two COMMITS by the same user on the same analysed graph', () => {
    // A second, genuinely different commit must be a second record — not a
    // silent no-op behind deduped:true.
    const a = deriveCommittedDecisionRecordId(SCENARIO_ID, GRAPH_HASH, USER_ID, 'nonce-1');
    const b = deriveCommittedDecisionRecordId(SCENARIO_ID, GRAPH_HASH, USER_ID, 'nonce-2');
    expect(a).not.toBe(b);
  });

  it('REPLAYS a retry: the same nonce derives the same id (RPC dedupe, not a duplicate)', () => {
    expect(deriveCommittedDecisionRecordId(SCENARIO_ID, GRAPH_HASH, USER_ID, NONCE)).toBe(
      deriveCommittedDecisionRecordId(SCENARIO_ID, GRAPH_HASH, USER_ID, NONCE),
    );
  });

  it('is delimiter-safe across the whole tuple', () => {
    expect(deriveCommittedDecisionRecordId('ab', 'c', USER_ID, NONCE)).not.toBe(
      deriveCommittedDecisionRecordId('a', 'bc', USER_ID, NONCE),
    );
  });

  it('produces an RFC-4122-shaped UUID (the record_id column type)', () => {
    expect(deriveCommittedDecisionRecordId(SCENARIO_ID, GRAPH_HASH, USER_ID, NONCE)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

// ---------------------------------------------------------------------------
// T6 — the confidence_source literal, derived from the contract.
// ---------------------------------------------------------------------------

describe('T6 — confidence_source is the exact contract literal on each path', () => {
  it('the COMMIT path stamps exactly the contract\'s user_stated literal', () => {
    const built = commit();
    if (built.kind !== 'write') throw new Error('expected a write');
    const [modelDerived, userStated] = DecisionRecordConfidenceSource.options;
    expect(userStated).toBe('user_stated');
    expect(built.write.prediction.confidence_source).toBe(userStated);
    expect(built.write.prediction.confidence_source).not.toBe(modelDerived);
  });

  it('the CAPTURE path still stamps exactly model_derived (no cross-contamination)', () => {
    const built = buildDecisionRecordWrite(makeFact(), SCENARIO_ID);
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(built.write.prediction.confidence_source).toBe('model_derived');
  });

  it('marks the record as an explicit user commit', () => {
    const built = commit();
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(built.write.decision.committed_by_user).toBe(true);
  });

  it('the auto-capture path never claims committed_by_user', () => {
    const built = buildDecisionRecordWrite(makeFact(), SCENARIO_ID);
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(built.write.decision).not.toHaveProperty('committed_by_user');
  });

  it('both sub-objects parse under the strict contract schemas', () => {
    const built = commit();
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(DecisionRecordDecisionSchema.safeParse(built.write.decision).success).toBe(true);
    expect(DecisionRecordPredictionSchema.safeParse(built.write.prediction).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T7 — 0–100 → [0,1] SERVER-side; out-of-range refused, never clamped.
// ---------------------------------------------------------------------------

describe('T7 — stated confidence is normalised server-side and out-of-range is refused', () => {
  it.each([
    [70, 0.7],
    [100, 1],
    [0, 0],
    [72, 0.72],
  ])('normalises %s → %s', (input, expected) => {
    expect(normaliseStatedConfidence(input)).toBeCloseTo(expected, 12);
  });

  it.each([101, -1, Number.NaN, Number.POSITIVE_INFINITY, '', '  ', 'abc', null, undefined])(
    'refuses %p rather than clamping it',
    (input) => {
      expect(normaliseStatedConfidence(input)).toBeUndefined();
    },
  );

  it('the builder REFUSES an out-of-range confidence with a typed code (no write built)', () => {
    const built = commit({ confidence0to100: 101 });
    expect(built.kind).toBe('refuse');
    if (built.kind !== 'refuse') return;
    expect(built.code).toBe('invalid_confidence');
  });

  it('the built write carries the NORMALISED value, and the [0,1] contract accepts it', () => {
    const built = commit({ confidence0to100: 72 });
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(built.write.prediction.confidence).toBeCloseTo(0.72, 12);
    expect(built.write.prediction.confidence).not.toBe(72);
  });
});

// ---------------------------------------------------------------------------
// T9 — the review-date ladder is LABELLED, never silent.
// ---------------------------------------------------------------------------

describe('T9 — the review_date ladder discloses which rung it used', () => {
  it('rung 1: an ISO date is used VERBATIM and labelled user_set', () => {
    const built = commit({ revisitTriggerOrDate: '2026-12-01' });
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(built.reviewDateSource).toBe('user_set');
    expect(built.write.review_date).toBe(new Date('2026-12-01').toISOString());
  });

  it('rung 3: no revisit input at all → the labelled 90-day default', () => {
    const built = commit({ revisitTriggerOrDate: undefined });
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(built.reviewDateSource).toBe('default_horizon');
    expect(built.write.review_date).toBe(
      new Date(
        NOW.getTime() + DECISION_RECORD_REVIEW_HORIZON_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
  });

  it('an UNPARSEABLE trigger falls back but says so — a distinct rung, never silent', () => {
    const built = commit({ revisitTriggerOrDate: 'runway falls below 9 months' });
    if (built.kind !== 'write') throw new Error('expected a write');
    // The whole point: this must NOT read the same as "the user gave us
    // nothing". Collapsing the two would let a date the user typed vanish
    // into the default with nothing disclosing it.
    expect(built.reviewDateSource).toBe('default_horizon_after_unparsed_trigger');
    expect(built.reviewDateSource).not.toBe('default_horizon');
    expect(built.reviewDateSource).not.toBe('user_set');
  });

  it('the date parser is STRICT: a trigger phrase is never coerced into a date', () => {
    expect(parseRevisitDate('runway falls below 9 months')).toBeNull();
    expect(parseRevisitDate('9')).toBeNull();
    expect(parseRevisitDate('Q1')).toBeNull();
    expect(parseRevisitDate('')).toBeNull();
    expect(parseRevisitDate(undefined)).toBeNull();
    expect(parseRevisitDate('2026-12-01')?.toISOString()).toBe(
      new Date('2026-12-01').toISOString(),
    );
    expect(parseRevisitDate('2026-12-01T10:30:00.000Z')?.toISOString()).toBe(
      '2026-12-01T10:30:00.000Z',
    );
  });
});

// ---------------------------------------------------------------------------
// T2 — the Brier component, pinned in BOTH directions.
// ---------------------------------------------------------------------------

describe('T2 — brier_component, pinned values', () => {
  it('confidence 0.72 + worse → 0.5184 (the prediction did not stand)', () => {
    expect(computeBrierComponent(0.72, 'worse')).toBeCloseTo(0.5184, 12);
  });

  it('confidence 0.72 + as_expected → 0.0784', () => {
    expect(computeBrierComponent(0.72, 'as_expected')).toBeCloseTo(0.0784, 12);
  });

  it('confidence 0.72 + better → 0.0784 (better and as_expected are the SAME indicator)', () => {
    expect(computeBrierComponent(0.72, 'better')).toBeCloseTo(0.0784, 12);
  });

  it('confidence 0.72 + abandoned → NO component at all (not 0, not null)', () => {
    // Excluded from the population by the producer's own semantics: a
    // reversed/superseded decision has no realised event to score against.
    // A stored 0 would read as a perfect score forever.
    expect(computeBrierComponent(0.72, 'abandoned')).toBeUndefined();
  });

  it('the indicator map is exactly the contract vocabulary', () => {
    expect([...DECISION_OUTCOME_RESULTS]).toEqual([...DecisionRecordOutcomeResult.options]);
    expect(resultToOutcomeIndicator('better')).toBe(1);
    expect(resultToOutcomeIndicator('as_expected')).toBe(1);
    expect(resultToOutcomeIndicator('worse')).toBe(0);
    expect(resultToOutcomeIndicator('abandoned')).toBeNull();
  });

  it('the result guard admits exactly the four contract values and nothing else', () => {
    for (const value of DecisionRecordOutcomeResult.options) {
      expect(isDecisionOutcomeResult(value)).toBe(true);
    }
    for (const value of ['BETTER', 'succeeded', '', null, undefined, 1]) {
      expect(isDecisionOutcomeResult(value)).toBe(false);
    }
  });

  it('is squared error, not absolute error (the two agree only at 0 and 1)', () => {
    // |0.72 − 0| = 0.72, (0.72 − 0)² = 0.5184 — a discriminating pair of
    // magnitudes, so an absolute-error mutant cannot pass this assertion.
    expect(computeBrierComponent(0.72, 'worse')).not.toBeCloseTo(0.72, 6);
  });

  it('names its formula version', () => {
    expect(BRIER_FORMULA_VERSION).toBe('v1');
  });
});

// ---------------------------------------------------------------------------
// T3 (pure half) — no confidence ⇒ no component, never a default.
// ---------------------------------------------------------------------------

describe('T3 — an unscored record is scored as ABSENT, never as 0.5', () => {
  it.each([undefined, Number.NaN, -0.1, 1.1])(
    'yields no component for an unusable confidence %p',
    (confidence) => {
      expect(computeBrierComponent(confidence as number | undefined, 'worse')).toBeUndefined();
    },
  );
});

// ---------------------------------------------------------------------------
// Dormancy control — the existing capture path is BYTE-IDENTICAL.
// (Replaces the pack's withdrawn "flag-off byte-identical" proof: this slice
// ships ON, so the control is that the seam it sits beside is unchanged.)
// ---------------------------------------------------------------------------

describe('dormancy control — buildDecisionRecordWrite is unchanged by this slice', () => {
  it('emits the pinned auto-capture payload verbatim', () => {
    const built = buildDecisionRecordWrite(makeFact(), SCENARIO_ID);
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(built.write).toEqual({
      scenario_id: SCENARIO_ID,
      decision: {
        chosen_option_id: 'opt_a',
        chosen_option_label: 'Option A',
        graph_hash: GRAPH_HASH,
      },
      prediction: {
        statement: 'Option A currently leads.',
        confidence: 0.62,
        confidence_source: 'model_derived',
      },
      review_date: '2026-10-08T12:00:00.000Z',
      record_id: deriveDecisionRecordId(SCENARIO_ID, GRAPH_HASH, COMPUTED_AT),
      event_id: `decision_recorded_${deriveDecisionRecordId(SCENARIO_ID, GRAPH_HASH, COMPUTED_AT)}`,
    });
  });

  it('the auto-capture id is byte-stable across the namespace refactor', () => {
    // A LITERAL, not a re-derivation: refactoring the UUID stamping into
    // record-id.ts must not move a single live record's id, and only a
    // hardcoded expected value can prove that. DERIVED BY EXECUTING THE
    // PRISTINE implementation at `8c316b5e` (capture.ts:101-114 before this
    // PR), not by running the new code and writing down what it said.
    expect(deriveDecisionRecordId(SCENARIO_ID, GRAPH_HASH, COMPUTED_AT)).toBe(
      'a35c6fb9-cf02-56bc-9d57-e6b69aa7698e',
    );
  });
});

// ---------------------------------------------------------------------------
// Refusals — the builder never fabricates a field it was not given.
// ---------------------------------------------------------------------------

describe('the commit builder refuses rather than fabricating', () => {
  it('refuses an empty expectation statement (it is the scored claim)', () => {
    const built = commit({ expectationStatement: '   ' });
    expect(built.kind).toBe('refuse');
    if (built.kind !== 'refuse') return;
    expect(built.code).toBe('invalid_expectation');
  });

  it('refuses an empty option label (never id-as-label)', () => {
    const built = commit({ chosenOptionLabel: '' });
    expect(built.kind).toBe('refuse');
    if (built.kind !== 'refuse') return;
    expect(built.code).toBe('invalid_option');
  });

  it('records the USER\'s option, which may differ from the analysis leader', () => {
    const auto = buildDecisionRecordWrite(makeFact(), SCENARIO_ID);
    if (auto.kind !== 'write') throw new Error('expected a write');
    const built = commit();
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(auto.write.decision.chosen_option_id).toBe('opt_a');
    expect(built.write.decision.chosen_option_id).toBe('opt_b');
  });

  it('anchors to the aag_v1 graph-hash regime, never a bare hash', () => {
    const built = commit();
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(built.write.decision.graph_hash).toBe(GRAPH_HASH);
    expect(built.write.decision.graph_hash.startsWith(AAG_V1_GRAPH_HASH_PREFIX)).toBe(true);
  });

  it('scopes the commit to its own scenario', () => {
    const a = commit();
    const b = commit({ scenarioId: OTHER_SCENARIO_ID });
    if (a.kind !== 'write' || b.kind !== 'write') throw new Error('expected writes');
    expect(a.write.record_id).not.toBe(b.write.record_id);
  });
});
