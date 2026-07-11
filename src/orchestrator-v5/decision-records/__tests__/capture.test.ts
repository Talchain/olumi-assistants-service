/**
 * Decision Records (ROADMAP 3.1, CEE half) — pure payload builder + id
 * derivation unit tests.
 *
 * Pins (RED-first for the capture lane):
 *  - decision.graph_hash = 'aag_v1:sha256:' + the fact's OWN
 *    `graph_hash_at_run` (the value the run_analysis handler computed from
 *    the exact snapshot the analysis ran against — PR #411 object-identity
 *    discipline: never re-read, never re-hash);
 *  - chosen_option_id = the fact's leading_option_id; chosen_option_label
 *    resolved from the PLoT `option_comparison` records (never id-as-label);
 *  - prediction.statement = the fact's deterministic summary;
 *    prediction.confidence = the leader's win_probability when usable;
 *  - analysis_summary copied from PLoT `decision_brief.analysis_summary`
 *    OPTIONAL-FORWARD (absent → record still valid; malformed → dropped,
 *    disclosed via the build result — never a hard failure);
 *  - review_date = computed_at + 90 days (BRIEF-C derivation rules: no
 *    explicit user date / horizon heuristic exists in this slice → the
 *    labelled 90-day default);
 *  - record_id deterministic on (scenario_id, decision.graph_hash,
 *    computed_at) so a retried turn replays as the RPC's dedupe branch;
 *    event_id = 'decision_recorded_' + record_id (matches the RPC default).
 */

import { describe, expect, it } from 'vitest';

import {
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

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HASH_AT_RUN = 'abcdef0123456789';
const COMPUTED_AT = '2026-07-10T12:00:00.000Z';
const SUMMARY = 'Option A currently leads.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeFact(overrides?: {
  noop?: boolean;
  result?: Partial<RunAnalysisHandlerFact['result']>;
}): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: overrides?.noop ?? false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      win_probabilities: { 'Option A': 0.62, 'Option B': 0.38 },
      summary: SUMMARY,
      enrichment: {
        option_comparison: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
        ],
      },
      graph_hash_at_run: HASH_AT_RUN,
      computed_at: COMPUTED_AT,
      ...(overrides?.result ?? {}),
    },
  };
}

describe('deriveDecisionRecordId', () => {
  it('produces an RFC-4122-shaped UUID, stable across calls (retry ⇒ dedupe, not duplicate)', () => {
    const a = deriveDecisionRecordId(SCENARIO_ID, `${AAG_V1_GRAPH_HASH_PREFIX}${HASH_AT_RUN}`, COMPUTED_AT);
    const b = deriveDecisionRecordId(SCENARIO_ID, `${AAG_V1_GRAPH_HASH_PREFIX}${HASH_AT_RUN}`, COMPUTED_AT);
    expect(a).toMatch(UUID_RE);
    expect(a).toBe(b);
  });

  it('changes when any tuple member changes', () => {
    const base = deriveDecisionRecordId(SCENARIO_ID, 'h1', COMPUTED_AT);
    expect(deriveDecisionRecordId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'h1', COMPUTED_AT)).not.toBe(base);
    expect(deriveDecisionRecordId(SCENARIO_ID, 'h2', COMPUTED_AT)).not.toBe(base);
    expect(deriveDecisionRecordId(SCENARIO_ID, 'h1', '2026-07-11T12:00:00.000Z')).not.toBe(base);
  });

  it('is delimiter-safe: shifting a boundary character between tuple members changes the id', () => {
    expect(deriveDecisionRecordId('ab', 'c', COMPUTED_AT)).not.toBe(
      deriveDecisionRecordId('a', 'bc', COMPUTED_AT),
    );
  });
});

describe('buildDecisionRecordWrite — happy path', () => {
  it('builds the exact create_decision_record payload from the fact alone', () => {
    const built = buildDecisionRecordWrite(makeFact(), SCENARIO_ID);
    expect(built.kind).toBe('write');
    if (built.kind !== 'write') return;
    const expectedGraphHash = `${AAG_V1_GRAPH_HASH_PREFIX}${HASH_AT_RUN}`;
    const expectedRecordId = deriveDecisionRecordId(SCENARIO_ID, expectedGraphHash, COMPUTED_AT);
    expect(built.write).toEqual({
      scenario_id: SCENARIO_ID,
      decision: {
        chosen_option_id: 'opt_a',
        chosen_option_label: 'Option A',
        graph_hash: expectedGraphHash,
      },
      prediction: { statement: SUMMARY, confidence: 0.62, confidence_source: 'model_derived' },
      review_date: '2026-10-08T12:00:00.000Z', // computed_at + 90 days
      record_id: expectedRecordId,
      event_id: `decision_recorded_${expectedRecordId}`,
    });
    expect(built.analysisSummaryDropped).toBe(false);
  });

  it(`review_date is computed_at + ${DECISION_RECORD_REVIEW_HORIZON_DAYS} days exactly`, () => {
    const built = buildDecisionRecordWrite(makeFact(), SCENARIO_ID);
    if (built.kind !== 'write') throw new Error('expected write');
    expect(Date.parse(built.write.review_date) - Date.parse(COMPUTED_AT)).toBe(
      DECISION_RECORD_REVIEW_HORIZON_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  it('graph_hash carries the aag_v1 regime prefix over the fact-carried hash (no recompute)', () => {
    const built = buildDecisionRecordWrite(makeFact(), SCENARIO_ID);
    if (built.kind !== 'write') throw new Error('expected write');
    expect(built.write.decision.graph_hash).toBe(`aag_v1:sha256:${HASH_AT_RUN}`);
  });

  it('omits confidence when the leader has no usable win_probability (out of [0,1] range)', () => {
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [
              { option_id: 'opt_a', option_label: 'Option A', win_probability: 1.5 },
            ],
          },
        },
      }),
      SCENARIO_ID,
    );
    if (built.kind !== 'write') throw new Error('expected write');
    expect(built.write.prediction).toEqual({
      statement: SUMMARY,
      confidence_source: 'model_derived',
    });
  });

  it('resolves the leading record by option_label when option_id is absent (extractOptionId parity)', () => {
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          leading_option_id: 'Option A',
          enrichment: {
            option_comparison: [{ option_label: 'Option A', win_probability: 0.7 }],
          },
        },
      }),
      SCENARIO_ID,
    );
    if (built.kind !== 'write') throw new Error('expected write');
    expect(built.write.decision.chosen_option_id).toBe('Option A');
    expect(built.write.decision.chosen_option_label).toBe('Option A');
    expect(built.write.prediction.confidence).toBe(0.7);
  });
});

describe('buildDecisionRecordWrite — analysis_summary optional-forward', () => {
  it('absent decision_brief → no analysis_summary key (the normal case today: PLoT emits it behind its own flag)', () => {
    const built = buildDecisionRecordWrite(makeFact(), SCENARIO_ID);
    if (built.kind !== 'write') throw new Error('expected write');
    expect('analysis_summary' in built.write.decision).toBe(false);
    expect(built.analysisSummaryDropped).toBe(false);
  });

  it('valid decision_brief.analysis_summary is copied verbatim', () => {
    const summary = {
      leading_option: 'Option A',
      win_probability: 0.62,
      goal_fit: 0.8,
      robustness_band: 'robust',
    };
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [
              { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
            ],
            decision_brief: { analysis_summary: summary },
          },
        },
      }),
      SCENARIO_ID,
    );
    if (built.kind !== 'write') throw new Error('expected write');
    expect(built.write.decision.analysis_summary).toEqual(summary);
    expect(built.analysisSummaryDropped).toBe(false);
  });

  it('partial analysis_summary (all fields optional) is copied as-is', () => {
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [
              { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
            ],
            decision_brief: { analysis_summary: { leading_option: 'Option A' } },
          },
        },
      }),
      SCENARIO_ID,
    );
    if (built.kind !== 'write') throw new Error('expected write');
    expect(built.write.decision.analysis_summary).toEqual({ leading_option: 'Option A' });
  });

  it('malformed analysis_summary (off-whitelist key) is DROPPED, disclosed, and the record still builds', () => {
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [
              { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
            ],
            decision_brief: {
              analysis_summary: { leading_option: 'Option A', rogue_key: true },
            },
          },
        },
      }),
      SCENARIO_ID,
    );
    if (built.kind !== 'write') throw new Error('expected write');
    expect('analysis_summary' in built.write.decision).toBe(false);
    expect(built.analysisSummaryDropped).toBe(true);
  });

  it('malformed analysis_summary (win_probability out of range) is dropped, not forwarded to a DB 22023', () => {
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [
              { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
            ],
            decision_brief: { analysis_summary: { win_probability: 7 } },
          },
        },
      }),
      SCENARIO_ID,
    );
    if (built.kind !== 'write') throw new Error('expected write');
    expect('analysis_summary' in built.write.decision).toBe(false);
    expect(built.analysisSummaryDropped).toBe(true);
  });
});

describe('buildDecisionRecordWrite — skip matrix (no RPC-able record)', () => {
  it('noop fact → skip noop_fact', () => {
    const built = buildDecisionRecordWrite(makeFact({ noop: true }), SCENARIO_ID);
    expect(built).toEqual({ kind: 'skip', reason: 'noop_fact' });
  });

  it('missing graph_hash_at_run → skip missing_graph_hash', () => {
    const built = buildDecisionRecordWrite(
      makeFact({ result: { graph_hash_at_run: undefined } }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'missing_graph_hash' });
  });

  it('missing computed_at → skip missing_computed_at', () => {
    const built = buildDecisionRecordWrite(
      makeFact({ result: { computed_at: undefined } }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'missing_computed_at' });
  });

  it('unparseable computed_at → skip missing_computed_at (review_date must be finite)', () => {
    const built = buildDecisionRecordWrite(
      makeFact({ result: { computed_at: 'not-a-date' } }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'missing_computed_at' });
  });

  it('null leading_option_id (no unambiguous leader) → skip no_leading_option', () => {
    const built = buildDecisionRecordWrite(
      makeFact({ result: { leading_option_id: null } }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'no_leading_option' });
  });

  it('leader unresolvable to a labelled comparison record → skip no_option_label (never id-as-label)', () => {
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [{ option_id: 'opt_a', win_probability: 0.62 }],
          },
        },
      }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'no_option_label' });
  });

  it('no enrichment at all → skip no_option_label', () => {
    const built = buildDecisionRecordWrite(
      makeFact({ result: { enrichment: undefined } }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'no_option_label' });
  });

  it('blank summary → skip empty_summary (prediction.statement must be non-empty)', () => {
    const built = buildDecisionRecordWrite(
      makeFact({ result: { summary: '   ' } }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'empty_summary' });
  });
});

// ---------------------------------------------------------------------------
// 0.16.0 addendum — D-N Option-B scoring capture (both probabilities) +
// confidence provenance. Ruling (2026-07-11, PAUL-CHECKLIST rulings batch):
// "both candidate probabilities get captured from day one so a Neil overrule
// is a recompute, never lost data."
// ---------------------------------------------------------------------------

describe('buildDecisionRecordWrite — D-N scoring probabilities (0.16.0 addendum)', () => {
  /** Goal-bearing fixture: the leading option's comparison record carries
   *  BOTH goal-attainment probabilities (the PLoT #204 live shape —
   *  probability_of_goal from ISL per-option results, probability_of_joint_goal
   *  from constraint_analysis.joint_probability; both ride the same
   *  option_comparison[] rows the leader is already resolved from). */
  function makeGoalBearingFact(): RunAnalysisHandlerFact {
    return makeFact({
      result: {
        enrichment: {
          option_comparison: [
            {
              option_id: 'opt_a',
              option_label: 'Option A',
              win_probability: 0.62,
              probability_of_goal: 0.31,
              probability_of_joint_goal: 0.293,
            },
            {
              option_id: 'opt_b',
              option_label: 'Option B',
              win_probability: 0.38,
              probability_of_goal: 0.22,
              probability_of_joint_goal: 0.19,
            },
          ],
        },
      },
    });
  }

  it('captures BOTH probabilities from the CHOSEN option verbatim (never rescaled, never another option)', () => {
    const built = buildDecisionRecordWrite(makeGoalBearingFact(), SCENARIO_ID);
    if (built.kind !== 'write') throw new Error('expected write');
    expect(built.write.prediction).toEqual({
      statement: SUMMARY,
      confidence: 0.62,
      confidence_source: 'model_derived',
      probability_of_goal: 0.31, // the leader's, not opt_b's 0.22
      probability_of_joint_goal: 0.293, // verbatim [0,1] float — no percent rescale
    });
  });

  it('absent goal fit → HONEST OMISSION: neither probability key exists (never a fabricated 0)', () => {
    // The default fixture is exactly the pre-goal-target shape: comparison
    // records carry win_probability only.
    const built = buildDecisionRecordWrite(makeFact(), SCENARIO_ID);
    if (built.kind !== 'write') throw new Error('expected write');
    expect('probability_of_goal' in built.write.prediction).toBe(false);
    expect('probability_of_joint_goal' in built.write.prediction).toBe(false);
    expect(Object.values(built.write.prediction)).not.toContain(0);
  });

  it('the two probabilities are independent: one present, one absent → only the present one lands', () => {
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [
              {
                option_id: 'opt_a',
                option_label: 'Option A',
                win_probability: 0.62,
                probability_of_goal: 0.31,
                // no probability_of_joint_goal (no constraints on the goal)
              },
            ],
          },
        },
      }),
      SCENARIO_ID,
    );
    if (built.kind !== 'write') throw new Error('expected write');
    expect(built.write.prediction.probability_of_goal).toBe(0.31);
    expect('probability_of_joint_goal' in built.write.prediction).toBe(false);
  });

  it('unusable values (out of [0,1] / non-finite / non-number) are OMITTED — never clamped, defaulted, or zeroed', () => {
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [
              {
                option_id: 'opt_a',
                option_label: 'Option A',
                win_probability: 0.62,
                probability_of_goal: 1.5, // out of range
                probability_of_joint_goal: Number.NaN, // non-finite
              },
            ],
          },
        },
      }),
      SCENARIO_ID,
    );
    if (built.kind !== 'write') throw new Error('expected write');
    expect('probability_of_goal' in built.write.prediction).toBe(false);
    expect('probability_of_joint_goal' in built.write.prediction).toBe(false);
  });

  it('boundary values 0 and 1 are REAL producer values and are kept (omission is for absence, not extremes)', () => {
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [
              {
                option_id: 'opt_a',
                option_label: 'Option A',
                win_probability: 0.62,
                probability_of_goal: 0,
                probability_of_joint_goal: 1,
              },
            ],
          },
        },
      }),
      SCENARIO_ID,
    );
    if (built.kind !== 'write') throw new Error('expected write');
    expect(built.write.prediction.probability_of_goal).toBe(0);
    expect(built.write.prediction.probability_of_joint_goal).toBe(1);
  });

  it("stamps confidence_source:'model_derived' on EVERY write from this seam (no user-stated path exists here)", () => {
    // Everything this hook can place on prediction is model-derived (the
    // deterministic summary, the leader's win_probability, ISL's
    // goal-attainment probabilities). The unconditional stamp makes the
    // provenance explicit on the record itself instead of leaning on the
    // schema's absent⇒model_derived disclosed inference — the calibration
    // pack's binding honesty constraint (04 §2) is that the two populations
    // are NEVER blended, so provenance is stamped at the source.
    const withConfidence = buildDecisionRecordWrite(makeGoalBearingFact(), SCENARIO_ID);
    if (withConfidence.kind !== 'write') throw new Error('expected write');
    expect(withConfidence.write.prediction.confidence_source).toBe('model_derived');

    // Even with NO usable confidence, the statement itself is model-derived.
    const withoutConfidence = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [
              { option_id: 'opt_a', option_label: 'Option A', win_probability: 1.5 },
            ],
          },
        },
      }),
      SCENARIO_ID,
    );
    if (withoutConfidence.kind !== 'write') throw new Error('expected write');
    expect(withoutConfidence.write.prediction.confidence_source).toBe('model_derived');
  });
});

describe('schemas 0.16.0 strict-parse — the blocked-lane unblock proof', () => {
  // The capture-addendum lane was CORRECTLY BLOCKED on 2026-07-11
  // (HANDOVER.md ~02:45 wave entry): 0.15.0 DecisionRecordSchema is
  // .strict() at every level, so these additive fields were hard-rejected
  // at every layer. Reproduced against built dists in olumi-schemas PR #8:
  // base 0.15.0 → REJECTED — "prediction: Unrecognized key(s):
  // 'confidence_source', 'probability_of_goal', 'probability_of_joint_goal'".
  // These specs prove the vendored 0.16.0 now ACCEPTS exactly that payload,
  // while .strict() itself stays armed (the rejection mechanism is intact —
  // only the whitelist grew).

  it('0.16.0 DecisionRecordPredictionSchema accepts the exact prediction shape 0.15.0 rejected', () => {
    const parsed = DecisionRecordPredictionSchema.safeParse({
      statement: 'Option A currently leads.',
      confidence: 0.62,
      confidence_source: 'model_derived',
      probability_of_goal: 0.31,
      probability_of_joint_goal: 0.293,
    });
    expect(parsed.success).toBe(true);
  });

  it('the BUILT write round-trips its sub-objects through the 0.16.0 .strict() schemas unchanged', () => {
    const built = buildDecisionRecordWrite(
      makeFact({
        result: {
          enrichment: {
            option_comparison: [
              {
                option_id: 'opt_a',
                option_label: 'Option A',
                win_probability: 0.62,
                probability_of_goal: 0.31,
                probability_of_joint_goal: 0.293,
              },
            ],
          },
        },
      }),
      SCENARIO_ID,
    );
    if (built.kind !== 'write') throw new Error('expected write');
    const prediction = DecisionRecordPredictionSchema.safeParse(built.write.prediction);
    expect(prediction.success).toBe(true);
    if (prediction.success) expect(prediction.data).toEqual(built.write.prediction);
    const decision = DecisionRecordDecisionSchema.safeParse(built.write.decision);
    expect(decision.success).toBe(true);
  });

  it('.strict() stays armed: an off-schema key on prediction still hard-rejects (the exact 0.15.0 mechanism)', () => {
    const parsed = DecisionRecordPredictionSchema.safeParse({
      statement: 'Option A currently leads.',
      probability_of_goal: 0.31,
      rogue_key: true,
    });
    expect(parsed.success).toBe(false);
  });
});
