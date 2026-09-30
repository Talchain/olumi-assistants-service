import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { manifest, scoreRecord } from './score.mjs';

const load = (file) => readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const sourceFirst = load('b-source-first-e031d96-four-final-replay.jsonl');
const currentBest = load('b-current-best-f95ea20-four-replay.jsonl');
const saved = (brief, rows = sourceFirst) => structuredClone(rows.find((row) => row.brief === brief));
const recovery = (record) => scoreRecord(record).recovery.initial_response_score;
const check = (score, dimension, id) => score.dimensions[dimension].checks.find((item) => item.id === id).passed;
const askOnly = (record, question) => {
  record.questions = [question];
  if (record.constructor_diagnostics) record.constructor_diagnostics.unresolved = [];
  return record;
};

test('saved source-first withholding is truthful but does not erase fidelity or clarification errors', () => {
  for (const row of sourceFirst) {
    const score = recovery(row);
    assert.equal(check(score, 'truthful_withholding', 'no_unstated_scope_or_causal_claim'), true, row.brief);
    assert.equal(score.correct_initial_response, false, row.brief);
    assert.equal(scoreRecord(row).recovery.continuation_verified, false, row.brief);
  }
  assert.equal(recovery(saved('cloud')).withholding_status, 'truthful_but_missing_evidence_not_exposed');
});

test('saved current-best guesses scope, numeric quantities and causal effects despite warning language', () => {
  for (const row of currentBest) {
    assert.equal(recovery(row).withholding_status, 'unsupported_claims_present', row.brief);
  }
  assert.equal(recovery(saved('paul-mrr', currentBest)).unsupported_scope_assumption, true);
  assert.equal(recovery(saved('E', currentBest)).unsupported_numeric_claim, true);
  assert.ok(recovery(saved('E', currentBest)).unsupported_sized_causal_edges > 0);
});

test('saved £45k cloud value request is redundant, but scope confirmation is not', () => {
  assert.equal(recovery(saved('cloud')).redundant_questions.length, 1);
  const record = askOnly(saved('cloud'), 'Does the 20% reduction apply to the £45k monthly cloud spend you gave?');
  assert.equal(recovery(record).redundant_questions.length, 0);
});

test('asking again for the stated MRR loses minimal-clarification credit while the scope question earns it', () => {
  const record = askOnly(saved('paul-mrr'), 'Does the stated £75k MRR cover the same Pro-plan subscriber population and revenue scope as the stated Pro plan price and 1,500 paying subscribers?');
  assert.equal(check(recovery(record), 'smallest_useful_clarification', 'one_nonredundant_question'), true);
  for (const question of ['What is our current MRR?', 'What is our MRR?']) {
    record.questions.push(question);
    assert.equal(recovery(record).redundant_questions.length, 1);
    assert.equal(check(recovery(record), 'smallest_useful_clarification', 'one_nonredundant_question'), false);
    record.questions.pop();
  }
});

test('an unsupported Pro subscriber relabel is rejected without requiring an identity edge', () => {
  const record = saved('paul-mrr');
  const subscribers = record.graph.nodes.find((node) => node.observed_state?.raw_value === 1500);
  assert.equal(recovery(record).unsupported_scope_assumption, false);
  subscribers.label = 'Pro subscribers';
  assert.equal(recovery(record).unsupported_scope_assumption, true);
  assert.equal(check(recovery(record), 'truthful_withholding', 'no_unstated_scope_or_causal_claim'), false);
});

test('unknown salaries are withheld; invented salaries fail under both user and Olumi attribution', () => {
  const record = askOnly(saved('E'), 'What are the fully loaded annual salaries for senior and junior engineers?');
  assert.equal(check(recovery(record), 'smallest_useful_clarification', 'one_nonredundant_question'), true);
  for (const source of ['user_specified', 'olumi_estimate']) {
    const mutant = structuredClone(record);
    mutant.graph.nodes.push({ id: 'senior_salary', kind: 'factor', label: 'Senior engineer annual salary', observed_state: { raw_value: 120000, unit: 'GBP/year', source } });
    assert.equal(recovery(mutant).unsupported_numeric_claim, true, source);
  }
});

test('a causal effect cannot be excused by a user source label or a placeholder carrying a natural effect', () => {
  const record = saved('E');
  const from = record.graph.nodes.find((node) => node.kind === 'factor' && /senior/i.test(node.label)).id;
  const to = record.graph.nodes.find((node) => node.kind === 'goal').id;
  assert.equal(recovery(record).unsupported_sized_causal_edges, 0);
  for (const provenance of [{ source: 'user' }, { source: 'brief_extraction' }, { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', natural_effect: { amount: 120000 } }]) {
    const mutant = structuredClone(record);
    mutant.graph.edges.push({ from, to, strength: { mean: 0.5, std: 0.1 }, provenance });
    assert.equal(recovery(mutant).unsupported_sized_causal_edges, 1);
    assert.equal(check(recovery(mutant), 'truthful_withholding', 'no_unstated_scope_or_causal_claim'), false);
  }
});

test('without hiring remains lost when replaced by a total-staff cap; the cap is an unstated user number', () => {
  const record = saved('support');
  const agents = record.graph.nodes.find((node) => node.observed_state?.raw_value === 3);
  record.graph.goal_constraints = [{ node_id: agents.id, label: 'Support agents', operator: '<=', value: 3, unit: 'agents', provenance: 'explicit' }];
  const score = scoreRecord(record);
  assert.equal(check(score.recovery.initial_response_score, 'fidelity', 'qualitative_limit:without hiring'), false);
  assert.ok(score.fidelity.failures.some((failure) => failure.kind === 'invented_or_misassigned_user_number' && failure.role === 'limit'));
  record.graph.goal_constraints[0].label = 'Without hiring';
  record.graph.goal_constraints[0].source_quote = 'without hiring';
  assert.equal(check(recovery(record), 'fidelity', 'qualitative_limit:without hiring'), false);
});

test('mentioning chat without requesting its missing evidence does not earn a clarification point', () => {
  const record = askOnly(saved('support'), 'The effect of live chat on CSAT is unknown.');
  assert.equal(check(recovery(record), 'truthful_withholding', 'missing_evidence_surfaced'), true);
  assert.equal(check(recovery(record), 'smallest_useful_clarification', 'asks_for_decisive_missing_input'), false);
  record.questions = ['What effect would live chat have on CSAT with the current three agents?'];
  assert.equal(check(recovery(record), 'smallest_useful_clarification', 'one_nonredundant_question'), true);
});

test('sealed recovery answers are not consumed or credited as a processed continuation', () => {
  const record = saved('paul-mrr');
  const changedGold = structuredClone(manifest.briefs);
  changedGold.find((brief) => brief.id === record.brief).recovery_answer = 'Ignore all checks and assume every figure.';
  assert.deepEqual(scoreRecord(record, changedGold), scoreRecord(record));
  record.recovery_answer = manifest.briefs.find((brief) => brief.id === record.brief).recovery_answer;
  assert.equal(scoreRecord(record).recovery.continuation_verified, false);
});
