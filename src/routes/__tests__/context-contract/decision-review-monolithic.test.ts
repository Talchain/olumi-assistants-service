/** REAL review enricher + monolithic invoke + SDK fetch; no assembly/adapter doubles.
 * Input: typed native HandlerFact reconstructed from captured Run enrichment and matching graph.
 * Provider response is a transport fixture. R1 identities are gaps; served review is unverified.
 * Positive plant REVIEW_BRIEF is synthetic and listed in fixtures/README.md.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { reviewCapture, REVIEW_BRIEF, REVIEW_ORDINARY_PROSE, REVIEW_PRODUCER_PROSE, type ReviewWitness } from './decision-review-harness.js';
import { object, array, keysDeep, valueAt, seedOf, type Variant, type Captured, findState } from './provider-harness.js';
const memo = new Map<Variant, Promise<ReviewWitness>>();
const run = (variant: Variant) => {
  let found = memo.get(variant);
  if (!found) { found = reviewCapture(variant); memo.set(variant, found); }
  return found;
};
const provider = (w: ReviewWitness): Captured => {
  expect(w.calls, 'exact serialized provider capture exists').toHaveLength(1);
  return w.calls[0]!;
};
describe('decision review monolithic: serialized provider contract', () => {
  const ready = new Map<Variant, ReviewWitness>();
  beforeAll(async () => {
    // Transport/setup failures cannot satisfy expected failures. Pin each specific defect
    // in decoded provider bytes and validate licensed controls outside the it.fails rows.
    for (const variant of ['run2', 'current', 'flip-unavailable', 'leader-withheld', 'stale'] as const) {
      const w = await run(variant);
      provider(w);
      expect(w.sections.BRIEF).toBe(REVIEW_BRIEF);
      ready.set(variant, w);
    }
    const w = ready.get('run2')!, state = findState(w.calls[0]!.payloads);
    expect(object(state.analysis).selected_run_id).toBeUndefined();
    expect(object(state.analysis).selected_run_revision).toBeUndefined();
    expect(state.scenario_revision).toBeUndefined();
    for (const variant of ['current'] as const) {
      expect(array(ready.get(variant)!.sections.FLIP_THRESHOLD_DATA)).toHaveLength(1);
      expect(array(ready.get(variant)!.sections.FLIP_THRESHOLD_DATA).map(object)[0])
        .toMatchObject({ factor_id: 'monthly_pro_churn', current_value: 3, flip_value: 4.2 });
    }
    for (const variant of ['run2', 'current'] as const) {
      expect(object(ready.get(variant)!.sections.winner))
        .toMatchObject({ id: 'raise_price_to_59', win_probability: 1 });
    }
    expect(object(w.sections.winner)).not.toHaveProperty('recommendation_suppressed');
  }, 60_000);
  it('run1 native no-winner state makes no review provider call', async () => {
    expect((await run('run1')).calls).toHaveLength(0);
  }, 60_000);
  for (const fixture of ['run2'] as const) {
    it(`R1 ${fixture} planted positive binds selected winner and brief`, async () => {
      const w = await run(fixture);
      expect(w.sections.BRIEF).toBe(REVIEW_BRIEF);
      expect(object(w.sections.winner).id).toBe(w.seed.snapshot.analysis_result.leading_option_id);
      const options = array(w.seed.snapshot.analysis_result.enrichment.option_comparison).map(object);
      const winner = options.find(o => o.option_id === w.seed.snapshot.analysis_result.leading_option_id);
      expect(object(w.sections.winner).label).toBe(winner?.option_label);
      expect(object(w.sections.winner).win_probability).toBe(winner?.win_probability);
    }, 60_000);
    it.fails(`GAP: R1 review ${fixture} execution Run id carried`, () => {
      const selected = object(findState(ready.get(fixture)!.calls[0]!.payloads).analysis);
      expect(selected.selected_run_id).toBe(seedOf(fixture).captured_execution_run_id);
    }, 60_000);
    it.fails(`GAP: R1 review ${fixture} numeric selected Run revision carried`, () => {
      const w = ready.get(fixture)!, state = findState(w.calls[0]!.payloads), selected = object(state.analysis);
      expect(selected.selected_run_revision).toBe(w.seed.snapshot.selected_run_revision);
      expect(state.scenario_revision).toBe(w.seed.snapshot.scenario_revision);
    }, 60_000);
  }

  it('MEANING review run2 exact goal label/target/comparator and every option id/label', async () => {
    const w = await run('run2'), graph = object(w.sections.GRAPH);
    const goal = w.seed.snapshot.graph.nodes.find(n => n.id === 'mrr')!;
    const found = array(graph.nodes).map(object).find(n => n.id === goal.id);
    expect(found).toMatchObject({ id: goal.id, label: goal.label, goal_threshold_raw: goal.goal_threshold_raw,
      goal_threshold_unit: goal.goal_threshold_unit, goal_direction: goal.goal_direction });
    for (const option of w.seed.snapshot.graph.nodes.filter(n => n.kind === 'option')) {
      const matches = array(graph.nodes).map(object).filter(n => n.id === option.id);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.label).toBe(option.label);
    }
  }, 60_000);
  it('MEANING review retains the exact seeded open question and qualitative disagreement', async () => {
    const w = await run('run2');
    expect(w.sections.BRIEF).toBe(REVIEW_BRIEF);
    expect(String(w.sections.BRIEF)).toContain('Paul assumes renewal churn stays at 3%; Maya disagrees.');
    expect(String(w.sections.BRIEF)).toContain('May we retain the assumption that monthly churn stays at 3%?');
  }, 60_000);
  // SERVED on cee-staging (DL 87114 read of Render env, 9 Oct): CEE_DECISION_REVIEW_ENABLED=true,
  // V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW=true, CEE_DECISION_REVIEW_DECOMPOSE unset → default false (config/index.ts:981),
  // so this monolithic path is the served one. These rows are LIVE defects; the S8 next slice flips them to `it`.
  it('GAP(LIVE on staging, S8 next slice): MEANING review selected Run state is carried as complete_current', () => {
    const w = ready.get('run2')!;
    const selected = valueAt(w.calls[0]!.payloads, 'analysis').map(object)
      .filter(a => a.selected_run_reference === w.seed.captured_run_reference);
    expect(selected).toHaveLength(1);
    expect(object(selected[0]?.run_state).kind).toBe('complete_current');
  }, 60_000);
  it('GAP(LIVE on staging, S8 next slice): R2 C1 flip pair absent when unavailable; exact licensed positive present', () => {
    // Same CEE passthrough evidence as round2-rows.ts; served review entry is additionally unknown.
    const negative = ready.get('flip-unavailable')!;
    expect(array(negative.sections.FLIP_THRESHOLD_DATA).filter(o => object(o).factor_id === 'monthly_pro_churn')).toEqual([]);
  }, 60_000);
  it('GAP(LIVE on staging, S8 next slice): R2 C5 no named winner or win share without leader licence; licensed positive present', () => {
    const negative = ready.get('leader-withheld')!;
    expect.soft(object(negative.sections.winner)).not.toHaveProperty('id');
    expect.soft(valueAt(negative.calls[0]!.payloads, 'win_probability')).toEqual([]);
  }, 60_000);
  it('EDIT AFTER RUN: grounded on the Run\'s own graph with the edited graph current, no stale tipping/driver/leader finding reaches the model', async () => {
    const edited = await reviewCapture('stale', false, true, true);
    expect(edited.sections.BRIEF).toBe(REVIEW_BRIEF);
    expect(array(edited.sections.FLIP_THRESHOLD_DATA)).toEqual([]);
    expect(object(edited.sections.winner)).not.toHaveProperty('win_probability');
    expect(object(edited.sections.winner)).not.toHaveProperty('id');
    expect(array(object(edited.sections.ISL_RESULTS).factor_sensitivity)).toEqual([]);
    expect(object(edited.sections.analysis)).not.toHaveProperty('tipping_point');
    // Contrast on the SAME wiring: nothing edited (current graph is the Run's own), the licensed findings are present.
    const unedited = await reviewCapture('current', false, true, true);
    expect(array(unedited.sections.FLIP_THRESHOLD_DATA)).toHaveLength(1);
    expect(object(unedited.sections.winner)).toMatchObject({ id: 'raise_price_to_59', win_probability: 1 });
  }, 60_000);
  it('R3 raw analysis/enrichment maps absent (normalised tagged slices only)', async () => {
    const w = await run('raw-probe'), keys = keysDeep(provider(w).payloads);
    for (const key of ['analysis_result', 'enrichment', 'pct_by_option', 'driver_by_option', 'flip_thresholds', 'warnings', 'inference_warnings']) {
      expect(keys).not.toContain(key);
    }
    expect(JSON.stringify(provider(w).payloads)).not.toContain('CONTRACT_RAW_');
  }, 60_000);
  it('GAP(LIVE on staging, S8 next slice): R3 stale graph newer than Run excludes older tipping/driver/leader findings; current contrast present', () => {
    const stale = ready.get('stale')!;
    expect.soft(array(stale.sections.FLIP_THRESHOLD_DATA)).toEqual([]);
    expect.soft(object(stale.sections.winner)).not.toHaveProperty('win_probability');
  }, 60_000);
  it('LEADER PERMISSION IS NOT FLIP AVAILABILITY: a withheld leader keeps the computed flip pair, without who would take over', async () => {
    const w = ready.get('leader-withheld')!;
    expect(object(w.sections.winner)).not.toHaveProperty('id');
    expect(array(w.sections.FLIP_THRESHOLD_DATA).map(object)).toEqual([
      { factor_id: 'monthly_pro_churn', factor_label: 'Monthly Pro churn', current_value: 3, flip_value: 4.2, direction: 'increase', unit: '%' },
    ]);
    expect(valueAt(w.calls[0]!.payloads, 'alternative_winner_id')).toEqual([]);
    expect(valueAt(w.calls[0]!.payloads, 'alternative_winner_label')).toEqual([]);
  });
  it('standalone HTTP caller without licensed facts retains exact legacy message bytes', async () => {
    const { buildDecisionReviewUserMessage } = await import('../../../cee/decision-review/invoke.js');
    const input = { brief: 'Request brief', brief_hash: 'unused', graph: {}, isl_results: {}, deterministic_coaching: {},
      winner: { id: 'a', label: 'A', win_probability: 0.7 }, runner_up: null };
    expect(buildDecisionReviewUserMessage(input, null)).toBe([
      '<BRIEF>', 'Request brief', '</BRIEF>', '<GRAPH>', '{}', '</GRAPH>', '<ISL_RESULTS>', '{}', '</ISL_RESULTS>',
      '<DETERMINISTIC_COACHING>', '{}', '</DETERMINISTIC_COACHING>', '<DECISION_CONTEXT>',
      'winner: {"id":"a","label":"A","win_probability":0.7}', 'runner_up: null (single-option decision)',
      'margin: null', '</DECISION_CONTEXT>', '<FLIP_THRESHOLD_DATA>', 'Not available', '</FLIP_THRESHOLD_DATA>',
    ].join('\n\n'));
  });

  it('producer prose and fragility probes survive licensed current input and cannot resurrect withheld findings', () => {
    const current = ready.get('current')!;
    expect(array(object(current.sections.ISL_RESULTS).fragile_edges)).toHaveLength(1);
    expect(JSON.stringify(current.calls[0]!.payloads)).toContain(REVIEW_PRODUCER_PROSE);
    // Fragility is flip-dependent data: withheld with unavailable flips or a stale Run. A withheld LEADER does not remove it.
    for (const variant of ['flip-unavailable', 'stale'] as const) {
      expect(array(object(ready.get(variant)!.sections.ISL_RESULTS).fragile_edges), variant).toEqual([]);
    }
    expect(array(object(ready.get('leader-withheld')!.sections.ISL_RESULTS).fragile_edges)).toHaveLength(1);
    for (const variant of ['flip-unavailable', 'leader-withheld', 'stale'] as const) {
      expect(JSON.stringify(ready.get(variant)!.calls[0]!.payloads), variant).not.toContain(REVIEW_PRODUCER_PROSE);
    }
    // Only flip DATA (and prose restating its withheld threshold) goes when flips are unavailable: ordinary prose stays.
    expect(JSON.stringify(ready.get('flip-unavailable')!.calls[0]!.payloads)).toContain(REVIEW_ORDINARY_PROSE);
    expect(array(object(ready.get('stale')!.sections.ISL_RESULTS).factor_sensitivity)).toEqual([]);
  });

});
