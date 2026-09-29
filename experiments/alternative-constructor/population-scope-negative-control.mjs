/** Independent source-meaning regression for live provider attempt #58. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { scoreRecord } from './score.mjs';
const live = JSON.parse(readFileSync(new URL('./fixtures/live-58-pro-subscriber-scope.json', import.meta.url), 'utf8'));
const subscriber = (record) => record.graph.nodes.find((n) => n.id === 'pro_plan_paying_subscribers');
const rows = [];
const check = (name, record, cases, expect) => { const score = scoreRecord(record, cases); expect(score); rows.push({ name, fidelity: score.fidelity }); };
check('live_58_matching_quote_does_not_license_Pro_population', live, undefined, (score) => {
  assert.equal(score.fidelity.facts_retained, 5);
  assert.equal(score.fidelity.source_bound, 5);
  assert.equal(score.fidelity.false_user_claims, 1);
  assert.equal(score.fidelity.failures[0].kind, 'unsupported_population_narrowing');
  assert.equal(score.facts.find((f) => f.id === 'subscribers-current').retained, false);
});
const neutral = structuredClone(live);
subscriber(neutral).label = 'Paying subscribers'; // Stable internal id is not an authored population claim.
check('neutral_population_retains_stated_1500', neutral, undefined, (score) => {
  assert.equal(score.fidelity.facts_retained, 6);
  assert.equal(score.fidelity.source_bound, 6);
  assert.equal(score.fidelity.false_user_claims, 0);
});
function populationCase(text) {
  const quote = text;
  const source_sha256 = createHash('sha256').update(text).digest('hex');
  const brief = { id: 'population-scope-control', text, source_sha256, facts: [
    { id: 'subscribers-current', entity: 'subscriber', role: 'current', value: 1500, unit: 'count:subscribers', quote, source_span: { start: 0, end: text.length } },
  ], options: [] };
  // A concise exact clause, not the whole brief, supplies the provenance witness.
  brief.text += ' The current price is £49.';
  brief.source_sha256 = createHash('sha256').update(brief.text).digest('hex');
  const node = structuredClone(subscriber(live));
  node.source_quote = quote; node.observed_state.source_quote = quote;
  delete node.observed_state.source_span;
  return [{ brief: brief.id, source_sha256: brief.source_sha256, graph: { nodes: [node], edges: [] } }, [brief]];
}
for (const text of ['We have 1,500 Pro plan paying subscribers.', 'All 1,500 paying subscribers are on the Pro plan.']) {
  const [record, cases] = populationCase(text);
  check('explicit_population_' + text, record, cases, (score) => {
    assert.equal(score.fidelity.facts_retained, 1);
    assert.equal(score.fidelity.source_bound, 1);
    assert.equal(score.fidelity.false_user_claims, 0);
  });
}
for (const text of ['Not all 1,500 paying subscribers are on the Pro plan.', 'Are all 1,500 paying subscribers on the Pro plan?', 'We have 1,500 paying subscribers and 500 Pro plan paying subscribers.']) {
  const [record, cases] = populationCase(text);
  check('non_attestation_' + text, record, cases, (score) => {
    assert.equal(score.fidelity.facts_retained, 0);
    assert.equal(score.fidelity.false_user_claims, 1);
    assert.equal(score.fidelity.failures[0].kind, 'unsupported_population_narrowing');
  });
}
const scopeQuestion = structuredClone(live);
scopeQuestion.questions = ['Are all 1,500 subscribers on the Pro plan?'];
check('asking_is_not_resolving_population_scope', scopeQuestion, undefined, (score) => assert.equal(score.fidelity.false_user_claims, 1));
for (const row of rows) console.log(JSON.stringify(row));
console.error(`${rows.length} independent population-scope controls passed; zero provider calls.`);
