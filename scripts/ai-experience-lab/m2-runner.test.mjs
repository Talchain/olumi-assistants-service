import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertPinnedSource, callM2, currentM2Input } from './m2-runner.mjs';

const snapshot = () => ({ session_id: 'lab-1', brief: 'We need to improve MRR while customers may leave.',
  graph: { nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR' }, { id: 'customers', kind: 'factor', label: 'Customers' }],
    edges: [{ from: 'customers', to: 'mrr' }] } });
const proposal = () => ({ proposal_id: 'p1', proposal_type: 'hidden_assumption',
  candidate: 'Customer retention assumption', why_it_may_matter: 'Retention may affect MRR.',
  evidence_pointers: [{ kind: 'brief_span', quote: 'customers may leave' }],
  origin: 'olumi_hypothesis', uncertainty: 'hypothesis',
  how_to_test_or_explore: 'Ask what happened after earlier price changes.', affected_model_refs: ['customers'] });
const fake = output => async (_url, request) => {
  const body = JSON.parse(request.body);
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(body.reasoning.effort, 'low');
  assert.equal(body.tools, undefined);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.properties.proposals.items.properties.evidence_pointers.items.anyOf[0].properties.kind.type, 'string');
  return { ok: true, status: 200, json: async () => ({ status: 'completed', output: [
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 100, output_tokens: 50 } }) };
};

test('uses the exact pinned MM-1 contract; full model text affects content identity', () => {
  assertPinnedSource();
  const first = currentM2Input(snapshot());
  const changed = snapshot(); changed.graph.nodes[0].label = 'Revenue';
  assert.notEqual(first.graph_hash, currentM2Input(changed).graph_hash);
});

test('shows only a locatable provisional proposal, while preserving the model', async () => {
  const current = snapshot(), before = structuredClone(current);
  let sentInstructions;
  const send = fake({ proposals: [proposal()] });
  const result = await callM2(current, (url, request) => {
    sentInstructions = JSON.parse(request.body).instructions;
    return send(url, request);
  });
  assert.equal(result.accepted, true);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.receipt.model, 'gpt-6-luna');
  assert.match(sentInstructions, /Every proposal must use origin "olumi_hypothesis"/);
  assert.equal(result.receipt.instruction_hash, createHash('sha256').update(sentInstructions).digest('hex'));
  assert.deepEqual(current, before);
});

test('withholds an unlocatable pointer and accepts a restrained zero-proposal response', async () => {
  const wrong = proposal(); wrong.evidence_pointers[0].quote = 'not in the brief';
  const rejected = await callM2(snapshot(), fake({ proposals: [wrong] }));
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.proposals, []);
  assert.match(rejected.errors.join(' '), /unlocatable_brief_span/);
  const none = await callM2(snapshot(), fake({ proposals: [] }));
  assert.equal(none.accepted, true);
  assert.deepEqual(none.proposals, []);
});

test('withholds evidence-derived status when the current model has no supplied evidence source', async () => {
  const unsupported = proposal(); unsupported.origin = 'evidence_derived';
  const result = await callM2(snapshot(), fake({ proposals: [unsupported] }));
  assert.equal(result.accepted, false);
  assert.deepEqual(result.proposals, []);
  assert.ok(result.errors.includes('evidence_derived_without_source'));
});
