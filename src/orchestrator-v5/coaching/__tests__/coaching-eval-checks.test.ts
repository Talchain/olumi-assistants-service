/**
 * Coaching-output eval checks — audit checks 1, 2, 5, 7 (P3, 2026-07-27).
 *
 * THE HEADLINE ASSERTION: check 1 alone catches the P0 this PR fixes. The audit
 * claimed it "would have caught §4.1 on day one"; the first describe below
 * proves that on the exact hand-typed vocabulary the prompt shipped, rather
 * than asserting it in prose.
 *
 * MUTATION MAP:
 *  - M6  loosen COACHING_CARDINALITY_CAPS away from the prompt's stated numbers
 *        → "the stated caps ARE the prompt's caps" RED
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { COACHING_SYSTEM } from '../../../cee/unified-pipeline/stages/coaching-pass.js';
import {
  checkConformanceYield,
  checkCoachingStatus,
  checkNodeIdValidity,
  checkStructureConformance,
  evaluateRecordedDraft,
  COACHING_CARDINALITY_CAPS,
} from '../coaching-eval-checks.js';

const GRAPH_IDS = new Set(['fac_cost', 'out_speed', 'opt_hire', 'fac_budget_remaining']);

/** The vocabulary the prompt hand-typed from 2026-07-23 until this PR. */
const P0_CLAIMS = [
  { type: 'direct', from: 'fac_cost', to: 'out_speed', stated_strength: 'weak' },
  { type: 'direct', from: 'opt_hire', to: 'out_speed', stated_strength: 'moderate' },
  { type: 'direct', from: 'fac_cost', to: 'opt_hire', stated_strength: 'strong' },
];

/** The vocabulary the prompt instructs after this PR's P0 fix. */
const FIXED_CLAIMS = [
  { type: 'direct_effect', from: 'fac_cost', to: 'out_speed', stated_strength: 'slight' },
  { type: 'direct_effect', from: 'opt_hire', to: 'out_speed', stated_strength: 'very_strong' },
];

describe('check 1 — conformance yield CATCHES the P0 (the whole point)', () => {
  it('reports 100% causal-claim parse loss on the retired hand-typed vocabulary', () => {
    const r = checkConformanceYield({}, P0_CLAIMS, GRAPH_IDS);
    expect(r.causal_claims_total).toBe(3);
    expect(r.causal_claims_parse_dropped).toBe(3);
    // This is the number that was silently true on every draft turn for four days.
    expect(r.clean_yield).toBe(0);
  });

  it('reports zero loss on the derived vocabulary — the check discriminates', () => {
    const r = checkConformanceYield({}, FIXED_CLAIMS, GRAPH_IDS);
    expect(r.causal_claims_total).toBe(2);
    expect(r.causal_claims_parse_dropped).toBe(0);
    expect(r.clean_yield).toBe(1);
  });

  it('counts coaching coercions and drops without applying them to the caller', () => {
    const coaching = {
      strengthen_items: [
        { id: 'a', label: 'L', detail: 'D', action_type: 'add_edge', bias_category: 'availability' },
        { id: 'b', label: 'L', detail: 'D', action_type: 'add_option' },
      ],
      bias_signals: [
        { type: 'availability', detail: 'x' },
        { type: 'anchoring', detail: 'y' },
      ],
    };
    const before = JSON.stringify(coaching);
    const r = checkConformanceYield(coaching, [], GRAPH_IDS);

    expect(r.action_types_coerced).toBe(1);
    expect(r.bias_categories_dropped).toBe(1);
    expect(r.bias_signals_dropped).toBe(1);
    // NON-DESTRUCTIVE: the production coercer repairs in place, so a check that
    // forgot to clone would silently rewrite its caller's block.
    expect(JSON.stringify(coaching)).toBe(before);
  });

  it('an empty block scores null, never a fake 1.0', () => {
    expect(checkConformanceYield({}, [], GRAPH_IDS).clean_yield).toBeNull();
  });
});

describe('check 2 — coaching status', () => {
  it('reads the three-value outcome vocabulary off a recorded envelope', () => {
    expect(checkCoachingStatus({ _pipeline_outcome: { coaching_status: 'complete' } }))
      .toMatchObject({ status: 'complete', produced_coaching: true, unscoreable: false });
    expect(checkCoachingStatus({ _pipeline_outcome: { coaching_status: 'skipped_budget' } }))
      .toMatchObject({ skipped_for_budget: true, produced_coaching: false });
    expect(checkCoachingStatus({ _pipeline_outcome: { coaching_status: 'failed_degraded' } }))
      .toMatchObject({ failed_degraded: true, produced_coaching: false });
  });

  it('marks an absent or off-vocabulary status UNSCOREABLE, not "complete"', () => {
    expect(checkCoachingStatus({}).unscoreable).toBe(true);
    expect(checkCoachingStatus({ _pipeline_outcome: { coaching_status: 'nonsense' } }).unscoreable).toBe(true);
    expect(checkCoachingStatus(undefined).unscoreable).toBe(true);
  });
});

describe('check 5 — node-id validity', () => {
  it('flags references to ids the model was never shown', () => {
    const r = checkNodeIdValidity(
      { bias_signals: [{ type: 'anchoring', detail: 'd', target: 'fac_invented' }] },
      [{ type: 'direct_effect', from: 'fac_cost', to: 'out_missing', stated_strength: 'slight' }],
      GRAPH_IDS,
    );
    expect(r.references_total).toBe(3);
    expect(r.references_invalid).toBe(2);
    expect(r.invalid_ids).toEqual(expect.arrayContaining(['fac_invented', 'out_missing']));
    expect(r.valid_fraction).toBeCloseTo(1 / 3);
  });

  it('scores a fully grounded block 1.0', () => {
    const r = checkNodeIdValidity({}, FIXED_CLAIMS, GRAPH_IDS);
    expect(r.references_invalid).toBe(0);
    expect(r.valid_fraction).toBe(1);
  });

  it('EXCLUDES widening_log.elements_added — those name nodes to ADD, not references', () => {
    const r = checkNodeIdValidity(
      { widening_log: { elements_added: ['fac_not_yet_in_graph'], elements_considered_but_excluded: [], brief_completeness: 'thin' } },
      [],
      GRAPH_IDS,
    );
    // Counting a proposal as an invalid reference would manufacture a false
    // violation rate. Nothing is referenced here, so nothing is scored.
    expect(r.references_total).toBe(0);
    expect(r.valid_fraction).toBeNull();
  });

  it('no references at all scores null, not 1.0', () => {
    expect(checkNodeIdValidity({}, [], GRAPH_IDS).valid_fraction).toBeNull();
  });
});

describe('check 7 — structure conformance', () => {
  const wl = { elements_added: [], elements_considered_but_excluded: [], brief_completeness: 'partial' };

  it('passes a well-formed in-cap block', () => {
    const r = checkStructureConformance({ strengthen_items: [1, 2], bias_signals: [1], widening_log: wl }, FIXED_CLAIMS);
    expect(r.conformant).toBe(true);
  });

  it('flags each cardinality breach independently', () => {
    expect(checkStructureConformance({ strengthen_items: [1, 2, 3, 4, 5], widening_log: wl }, []).strengthen_items_over_cap).toBe(true);
    expect(checkStructureConformance({ bias_signals: [1, 2, 3, 4], widening_log: wl }, []).bias_signals_over_cap).toBe(true);
    expect(checkStructureConformance({ widening_log: wl }, new Array(9).fill({})).causal_claims_over_cap).toBe(true);
  });

  it('flags a missing / malformed widening_log and an off-vocabulary completeness', () => {
    expect(checkStructureConformance({}, []).widening_log_present).toBe(false);
    expect(checkStructureConformance({ widening_log: { ...wl, brief_completeness: 'sparse' } }, []).brief_completeness_in_vocabulary).toBe(false);
    expect(checkStructureConformance({ widening_log: { elements_added: 'no' } }, []).widening_log_well_formed).toBe(false);
  });
});

/**
 * The caps are prose in the prompt, not a Zod enum, so they cannot be derived.
 * That makes them a mirror — so it fails LOUD instead of assuming good.
 */
describe('M6 — the stated caps ARE the prompt\'s caps', () => {
  it('every cap appears in the rendered prompt as the model is told it', () => {
    expect(COACHING_SYSTEM).toContain(`0-${COACHING_CARDINALITY_CAPS.strengthen_items} items`);
    expect(COACHING_SYSTEM).toContain(`0-${COACHING_CARDINALITY_CAPS.bias_signals},`);
    expect(COACHING_SYSTEM).toContain(`0-${COACHING_CARDINALITY_CAPS.causal_claims} claims`);
  });
});

/**
 * End-to-end over the harness's recorded draft. This is the "runs today, in CI,
 * no live model" claim from the audit made literal.
 */
describe('evaluateRecordedDraft over the frozen fixture', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), 'tools/conversation-harness/fixtures/frozen-graph.json'), 'utf8'),
  ) as unknown;

  it('scores the recorded draft without a live model call', () => {
    const report = evaluateRecordedDraft(fixture);

    // The fixture is a recorded COMPLETE pass…
    expect(report.coaching_status.status).toBe('complete');
    expect(report.coaching_status.produced_coaching).toBe(true);

    // …whose coaching is contract-clean and structurally conformant…
    expect(report.conformance_yield.action_types_coerced).toBe(0);
    expect(report.conformance_yield.bias_signals_dropped).toBe(0);
    expect(report.structure.conformant).toBe(true);

    // …and which carries ZERO causal claims. That is the P0 fingerprint,
    // preserved in a fixture recorded while the drift was live: a run marked
    // `coaching_status: complete` that nonetheless produced no claim at all.
    expect(report.conformance_yield.causal_claims_total).toBe(0);
  });
});
