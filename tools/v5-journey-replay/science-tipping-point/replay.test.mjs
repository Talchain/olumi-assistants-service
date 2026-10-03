import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCase, replay } from './replay.mjs';

const positive = loadCase('served-price-tipping-point');
const control = loadCase('served-no-signal');
const clone = (value) => structuredClone(value);

// These constructed recordings test the checker. They are never served evidence.
function recording(input) {
  const graph = clone(input.source.graph ?? input.source.draft_graph);
  const result = clone(input.source.analysis_result ?? { enrichment: input.enrichment });
  const current = (graphValue, hash, time) => ({
    graph: graphValue, graph_hash: hash, analysis_result: result,
    current_read: { run_state: { kind: 'complete_current', computed_at: time },
      computed_against_hash: hash, current_analysis_hash: hash, result },
  });
  const before = current(graph, 'original-analysis-hash', '2026-10-03T00:00:00Z');
  const step = (stage, response, extra = {}) => ({
    stage, scenario_id: 'instrument-selftest-only', status: 200, response, ...extra,
  });
  const steps = [step('before_read', before)];
  if (input.spec.kind === 'no_signal') {
    steps.push(step('explain', { assistant_text: 'This run did not establish a tipping point. We can discuss other assumptions.' },
      { science_value_offer_ids: [] }), step('cold_read', clone(before)));
  } else {
    const changed = clone(graph);
    Object.assign(changed.nodes.find((n) => n.id === input.spec.factor_id).observed_state,
      { raw_value: 55.76, value: 55.76 / 200, unit: 'GBP/month', source: 'user_confirmed' });
    const stale = current(changed, 'changed-analysis-hash', '2026-10-03T00:00:00Z');
    stale.current_read.run_state.kind = 'complete_stale';
    stale.current_read.computed_against_hash = 'original-analysis-hash';
    stale.current_read.result = null;
    const after = current(clone(changed), 'changed-analysis-hash', '2026-10-03T00:01:00Z');
    const approvalId = 'agent-approve-proposal:prop_abcdef';
    const runId = 'existing-offered-run-chip';
    steps.push(
      step('explain', { assistant_text: 'In this model comparison, Pro plan price could reach a tipping point at 55.76 GBP/month.' }),
      step('refine', { suggested_actions: [{ id: approvalId }] },
        { request: { existing_action: { factor_id: 'pro_plan_price' } }, target_pointer: '/existing_action/factor_id' }),
      step('before_approval_read', clone(before)),
      step('approve', { suggested_actions: [{ id: runId }] }, { request: { chip: { id: approvalId } } }),
      step('stale_read', stale),
      step('rerun', {}, { request: { chip: { id: runId, action_type: 'run_analysis' } } }),
      step('after_run_read', after), step('cold_read', clone(after)),
    );
  }
  return { case_id: input.spec.id, scenario_id: 'instrument-selftest-only', evidence_kind: 'instrument-selftest',
    configuration: { builds: Object.fromEntries(['ui', 'cee', 'plot', 'isl'].map((n) => [n, '1'.repeat(40)])),
      model: 'instrument-only', effort: 'instrument-only', prompt_hash: 'instrument-only', schema_version: 'instrument-only', flags: {} }, steps };
}

const stage = (capture, name) => capture.steps.find((s) => s.stage === name);
test('original immutable served fixtures admit exact 49 → 55.76 and attested no-signal', () => {
  assert.equal(positive.row.flip_value, 55.76);
  assert.equal(control.row.flip_value, null);
});
test('positive chain checks only an INSTRUMENT-SELFTEST rung', () => {
  assert.equal(replay(positive, recording(positive)).rung, 'INSTRUMENT-SELFTEST');
});
test('honest no-signal chain allows ordinary discussion without a measured offer', () => {
  assert.equal(replay(control, recording(control)).rung, 'INSTRUMENT-SELFTEST');
});

const negatives = [
  ['rounded threshold', positive, (c) => { stage(c, 'explain').response.assistant_text = 'Pro plan price could reach 56 GBP/month in this model.'; }],
  ['invented VOI', positive, (c) => { stage(c, 'explain').response.assistant_text += ' It has the highest value of information.'; }],
  ['wrong action factor', positive, (c) => { stage(c, 'refine').request.existing_action.factor_id = 'monthly_churn'; }],
  ['pointer to a figure instead of factor identity', positive, (c) => { stage(c, 'refine').target_pointer = '/existing_action/value'; }],
  ['write before explicit approval', positive, (c) => { stage(c, 'before_approval_read').response.graph.nodes[0].label += ' changed'; }],
  ['approval never offered', positive, (c) => { stage(c, 'refine').response.suggested_actions = []; }],
  ['unbound approval', positive, (c) => { stage(c, 'approve').request.chip.id = 'approve-anything'; }],
  ['approval failed', positive, (c) => { stage(c, 'approve').status = 409; }],
  ['old result promoted as current', positive, (c) => { stage(c, 'stale_read').response.current_read.result = { old: true }; }],
  ['rerun not offered', positive, (c) => { stage(c, 'approve').response.suggested_actions = []; }],
  ['old Run reused', positive, (c) => { stage(c, 'after_run_read').response.current_read.run_state.computed_at = stage(c, 'before_read').response.current_read.run_state.computed_at; }],
  ['rerun stale', positive, (c) => { stage(c, 'after_run_read').response.current_read.current_analysis_hash = 'changed-again'; }],
  ['cold reload loses unit or provenance', positive, (c) => { stage(c, 'cold_read').response.graph.nodes.find((n) => n.id === 'pro_plan_price').observed_state.unit = 'USD/month'; }],
  ['cold reload changes selected result', positive, (c) => { stage(c, 'cold_read').response.analysis_result = { other_run: true }; }],
  ['missing cold read', positive, (c) => { c.steps.pop(); }],
  ['cross-scenario capture', positive, (c) => { stage(c, 'approve').scenario_id = 'other-scenario'; }],
  ['missing immutable component build', positive, (c) => { delete c.configuration.builds.isl; }],
  ['historical source masquerading as current science', positive, (c) => { stage(c, 'before_read').response.current_read.result.enrichment.flip_thresholds.find((r) => r.factor_id === 'pro_plan_price').flip_value = 60; }],
  ['current verdict without selected result', positive, (c) => { stage(c, 'before_read').response.current_read.result = null; }],
  ['rerun loses approval provenance', positive, (c) => { stage(c, 'after_run_read').response.graph.nodes.find((n) => n.id === 'pro_plan_price').observed_state.source = 'brief_extraction'; }],
  ['fabricated no-signal science offer', control, (c) => { stage(c, 'explain').science_value_offer_ids = ['invented-voi-action']; }],
  ['universal no-change claim', control, (c) => { stage(c, 'explain').response.assistant_text = 'Nothing could change this conclusion.'; }],
];
for (const [name, input, mutate] of negatives) {
  test(`rejects ${name}`, () => {
    const capture = recording(input);
    mutate(capture);
    assert.throws(() => replay(input, capture));
  });
}
