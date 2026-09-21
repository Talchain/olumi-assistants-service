import { describe, expect, it, vi } from 'vitest';
import { GraphV3, InterventionV3 } from '../../../../src/schemas/cee-v3.js';
import { compactGraphForContextPack } from '../../../../src/orchestrator-v5/context/compact-graph-for-contextpack.js';
import { assembleContextPack } from '../../../../src/orchestrator-v5/context/context-pack-assembler.js';
import { buildUserMessage } from '../../../../src/orchestrator-v5/routing/route-with-tool-use.js';
import { makeMessagePayload } from '../../../../src/orchestrator-v5/__tests__/fixtures.js';
import { observeSerialisedPack } from '../../../../src/orchestrator-v5/context/__tests__/observe-serialised-pack.js';

vi.mock('../../../../src/orchestrator-v5/routing/prompt-loader.js', () => ({
  LOADED_PROMPT: { text: 'OFFLINE', version: 'offline', hash: 'offline' },
  getCachedRoutingPromptIdentity: () => null,
  ensureRoutingPromptSnapshot: async () => ({ text: 'OFFLINE', version: 'offline', sent_hash: 'offline' }),
}));

// The canonical shape reported in the existing pricing captures. This is a
// contract fixture, not a new live draft or a claim of conversational quality.
function graph() {
  return GraphV3.parse({
    nodes: [
      { id: 'price', kind: 'factor', label: 'Monthly price', observed_state: { value: 0.49, raw_value: 49, unit: '£/month' } },
      { id: 'revenue', kind: 'goal', label: 'Revenue' },
      { id: 'raise', kind: 'option', label: 'Raise price', interventions: {
        price: InterventionV3.parse({ value: 0.59, raw_value: 59, unit: '£/month', source: 'cee_hypothesis', target_match: { node_id: 'price', match_type: 'exact_id', confidence: 'high' } }),
      } },
      { id: 'hold', kind: 'option', label: 'Hold price', interventions: {
        price: InterventionV3.parse({ value: 0.49, raw_value: 49, unit: '£/month', source: 'cee_hypothesis', target_match: { node_id: 'price', match_type: 'exact_id', confidence: 'high' } }),
      } },
    ],
    edges: [],
  });
}

function requestNodes(input: ReturnType<typeof graph>) {
  const before = JSON.stringify(input);
  const compact = compactGraphForContextPack(input, { requestId: 'offline-option-settings' });
  expect(compact.kind).toBe('compacted');
  if (compact.kind !== 'compacted') throw new Error('Missing compact graph');
  expect(compact.via).toBe('strict_parse');
  const question = 'What price is each option actually set to?';
  const pack = assembleContextPack({
    payload: makeMessagePayload({ message: question }), priorTurns: [], priorFacts: [],
    compactedGraph: compact.compact, graphContext: { status: 'canonical' },
  });
  const sent = observeSerialisedPack(buildUserMessage(pack, question));
  expect(JSON.stringify(input)).toBe(before);
  return (sent.graph as { nodes: Array<{ id: string; intervention_summary?: string }> }).nodes;
}

describe('saved option settings reach the coaching request', () => {
  it('keeps option-specific native values separate from the shared factor value', () => {
    const nodes = requestNodes(graph());
    expect(nodes.find(n => n.id === 'raise')?.intervention_summary).toBe('sets Monthly price=59 £/month (model value 0.59)');
    expect(nodes.find(n => n.id === 'hold')?.intervention_summary).toBe('sets Monthly price=49 £/month (model value 0.49)');
    expect(nodes.find(n => n.id === 'price')?.intervention_summary).toBeUndefined();
  });

  it('a saved intervention change changes the model-facing request, not only its label', () => {
    const before = graph();
    const after = graph();
    after.nodes.find(n => n.id === 'raise')!.interventions!.price.raw_value = 69;
    after.nodes.find(n => n.id === 'raise')!.interventions!.price.value = 0.69;
    expect(requestNodes(before).find(n => n.id === 'raise')).not.toEqual(requestNodes(after).find(n => n.id === 'raise'));
    expect(requestNodes(after).find(n => n.id === 'raise')?.intervention_summary).toContain('69 £/month');
  });

  it('preserves the existing edit-source precedence before strict parsing drops legacy carriers', () => {
    const input = graph();
    const option = input.nodes.find(n => n.id === 'raise')!;
    Object.assign(option, { data: { interventions: { price: { value: 0.69, raw_value: 69, unit: '£/month' } } } });
    const summary = requestNodes(input).find(n => n.id === 'raise')?.intervention_summary;
    expect(summary).toBe('sets Monthly price=69 £/month (model value 0.69)');
    expect(summary).not.toContain('59');
  });

  it('does not invent a native price from a unit and a model-scale value', () => {
    const input = graph();
    delete input.nodes.find(n => n.id === 'raise')!.interventions!.price.raw_value;
    expect(requestNodes(input).find(n => n.id === 'raise')?.intervention_summary)
      .toBe('sets Monthly price=model value 0.59 (native quantity not established)');
  });

  it('does not infer settings from an option label or invent orphaned targets', () => {
    const input = graph();
    const option = input.nodes.find(n => n.id === 'raise')!;
    option.label = 'Raise price to £999';
    option.interventions = { absent_factor: { value: 0.99, raw_value: 99, unit: '£/month' } };
    expect(requestNodes(input).find(n => n.id === 'raise')?.intervention_summary).toBeUndefined();
  });

  it.each([
    [{ value: 0, raw_value: 0 }, 'sets Monthly price=raw value 0 (model value 0; unit not established)'],
    [{ value: 0, raw_value: false, unit: 'binary' }, 'sets Monthly price=raw value false (model value 0; unit "binary")'],
  ])('keeps zero and literal raw values without inventing their interpretation', (entry, expected) => {
    const input = graph();
    input.nodes.find(n => n.id === 'raise')!.interventions!.price = entry;
    expect(requestNodes(input).find(n => n.id === 'raise')?.intervention_summary).toBe(expected);
  });
});
