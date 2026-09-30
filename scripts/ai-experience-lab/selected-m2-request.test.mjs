import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareSelectedM2Request, SELECTED_M2_SOURCE } from './selected-m2-request.mjs';
import { currentM2Input, providerSchema } from './m2-runner.mjs';
import { MM1_PROPOSAL_JSON_SCHEMA } from './pinned-runtime/artefact-runtime/evals/mm-1/package.ts';

const snapshot = () => ({ session_id: 'offline-selected-m2', brief: 'What are we missing about raising funding?',
  graph: { nodes: [{ id: 'funding', kind: 'goal', label: 'Funding' }], edges: [] } });
const reference = JSON.parse(readFileSync(new URL('./selected-m2/benchmark-request.json', import.meta.url), 'utf8'));
const prompt = readFileSync(new URL('./selected-m2/prompt-v0_2.txt', import.meta.url), 'utf8');

test('selected M2 preparation preserves benchmark transport with only current input and the approved v0.2 delta', () => {
  const input = snapshot(), before = structuredClone(input);
  const { request, current, source } = prepareSelectedM2Request(input);
  assert.deepEqual(request, { ...reference, instructions: prompt, input: JSON.stringify(currentM2Input(input).providerInput) });
  assert.equal(request.model, 'gpt-6-astra');
  assert.equal(request.reasoning.effort, 'high');
  for (const key of ['max_output_tokens', 'temperature', 'top_p', 'tools']) assert.equal(Object.hasOwn(request, key), false);
  assert.equal(request.text.format.name, 'mm1_widening');
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema, providerSchema(MM1_PROPOSAL_JSON_SCHEMA));
  assert.equal(current.binding.evidence_refs.length, 0);
  assert.equal(source.status, 'offline_candidate_pending_real_route_gate');
  assert.equal(source.prompt_sha256, SELECTED_M2_SOURCE.prompt_sha256);
  assert.deepEqual(input, before);
});

test('selected preparation reuses canonical binding rejection rather than admitting a second model', () => {
  assert.throws(() => prepareSelectedM2Request({ ...snapshot(), canonical_binding: null }), /invalid_canonical_m1_binding/);
});
