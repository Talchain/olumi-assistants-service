import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scoreRecord } from './score.mjs';

// The exact saved cloud replay from B's live Terra extraction at e031d96.
// These checks use no provider or constructor implementation.
const saved = JSON.parse(readFileSync(new URL('./fixtures/cloud-b-live-terra-e031.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(saved);
const failureKinds = (score) => score.fidelity.failures.map((failure) => failure.kind);

function bindToOneMetric(record) {
  const current = record.graph.nodes.find((node) => node.label === 'Monthly cloud spend');
  const goal = record.graph.nodes.find((node) => node.label === 'Cloud cost reduction');
  goal.observed_state = structuredClone(current.observed_state);
  goal.goal_threshold_raw = -0.2;
  goal.goal_threshold_frame = 'change_rel';
  goal.goal_threshold_unit = 'GBP per month';
  goal.threshold_source = 'brief_extraction';
  record.graph.nodes = record.graph.nodes.filter((node) => node !== current);
  return { current, goal };
}

test('saved live cloud output loses the relative target, splits its metric and asks again for a supplied current quantity', () => {
  const score = scoreRecord(saved);
  assert.equal(score.fidelity.facts_retained, 2);
  assert.equal(score.fidelity.relative_target_same_metric_bound, 0);
  assert.equal(score.fidelity.relative_target_binding.status, 'split_references');
  assert.equal(score.fidelity.relative_target_binding.redundant_question, true);
  assert.deepEqual(failureKinds(score).filter((kind) => kind === 'relative_target_split_from_current' || kind === 'redundant_current_quantity_question'),
    ['relative_target_split_from_current', 'redundant_current_quantity_question']);
});

test('same source-grounded metric ref earns credit without claiming £36k was stated', () => {
  const record = clone();
  bindToOneMetric(record);
  record.questions = record.questions.filter((question) => !question.includes('What current quantity'));
  record.constructor_diagnostics.unresolved = record.constructor_diagnostics.unresolved.filter((finding) => finding.ref !== 'q2');
  const score = scoreRecord(record);
  assert.equal(score.fidelity.facts_retained, 3);
  assert.equal(score.fidelity.source_bound, 3);
  assert.equal(score.fidelity.relative_target_same_metric_bound, 1);
  assert.equal(score.fidelity.relative_target_binding.status, 'source_bound_shared_reference');
  assert.equal(score.fidelity.relative_target_binding.current_ref, score.fidelity.relative_target_binding.target_ref);
  assert.equal(record.graph.nodes.some((node) => node.observed_state?.raw_value === 36000 || node.goal_threshold_raw === 36000), false);
  assert.equal(failureKinds(score).includes('redundant_current_quantity_question'), false);
});

test('identical labels on different refs cannot earn metric-binding credit', () => {
  const record = clone();
  const current = record.graph.nodes.find((node) => node.label === 'Monthly cloud spend');
  const goal = record.graph.nodes.find((node) => node.label === 'Cloud cost reduction');
  current.label = 'Cloud costs';
  goal.label = 'Cloud costs';
  goal.goal_threshold_raw = -0.2;
  goal.goal_threshold_frame = 'change_rel';
  goal.goal_threshold_unit = 'GBP per month';
  goal.threshold_source = 'brief_extraction';
  const score = scoreRecord(record);
  assert.equal(score.fidelity.relative_target_same_metric_bound, 0);
  assert.equal(score.fidelity.relative_target_binding.status, 'split_references');
  assert.ok(failureKinds(score).includes('current_target_different_quantity'));
});

test('one node without the current claim’s exact source does not earn source-grounded credit', () => {
  const record = clone();
  const { goal } = bindToOneMetric(record);
  goal.observed_state.source_quote = 'Monthly spend is £40k';
  const score = scoreRecord(record);
  assert.equal(score.fidelity.relative_target_same_metric_bound, 0);
  assert.equal(score.fidelity.relative_target_binding.status, 'current_missing_or_ambiguous');
  assert.ok(failureKinds(score).includes('source_unbound'));
});

test('a scope confirmation naming the supplied £45k is not scored as a redundant request for its value', () => {
  const record = clone();
  record.questions = ['Does the 20% reduction apply to the £45k monthly cloud spend you gave?'];
  record.constructor_diagnostics.unresolved = [];
  const score = scoreRecord(record);
  assert.equal(score.fidelity.relative_target_binding.redundant_question, false);
});
