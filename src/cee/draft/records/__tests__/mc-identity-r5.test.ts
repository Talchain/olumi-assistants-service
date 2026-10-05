import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setAsideInventedStructure } from '../invented-structure.js';
import { replayRecordSet } from '../replay.js';
import { omitOptionalRecordNulls } from '../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import type { DraftRecordSet } from '../grammar.js';
import { BRIEF } from './compile-spec/sealed-fixture.js';

function rootGraph(carrier: 'stated_edge' | 'stated_setting' | 'estimate' | 'placeholder' | 'none') {
  return { nodes: [
    { id: 'o', kind: 'option', label: 'Act', data: carrier === 'stated_setting'
      ? { interventions: { f: 1 }, intervention_details: { f: { source: 'brief_extraction', raw_value: 1, reasoning: 'A stated setting', unit: 'units', value_confidence: 'high' } } } : {} },
    { id: 'f', kind: 'factor', label: 'Unlevelled carrier', provenance: { provenance_class: 'ai_inferred' } },
    { id: 'g', kind: 'goal', label: 'Goal', observed_state: { value: 0.5 }, data: { value: 0.5 } },
  ], edges: [
    { from: 'o', to: 'f', strength: 0.5 },
    { from: 'f', to: 'g', strength: 0.5, ...(carrier === 'none' || carrier === 'stated_setting' ? {} : {
      provenance: { source: 'brief_extraction', magnitude: carrier === 'stated_edge' ? 'user_stated' : carrier === 'estimate' ? 'olumi_estimate' : 'placeholder',
        stated_relationship: { from_quantity: 1, to_quantity: 0 }, natural_effect: { amount: 2, per_source_change: 1 } } }) },
  ] };
}

describe('MC R5 a stated carrier is never invented', () => {
  it.each(['stated_edge', 'stated_setting'] as const)('RED R5: %s exempts an unlevelled root from e2', carrier => {
    const graph = rootGraph(carrier), result = setAsideInventedStructure(graph);
    expect(result.graph.nodes.some(n => n.id === 'f')).toBe(true);
    expect(result.disclosures).toEqual([]);
    expect(result.asks).toEqual([]);
  });
  it.each(['none', 'estimate', 'placeholder'] as const)('CONTRAST R5: %s does not license the root', carrier => {
    const result = setAsideInventedStructure(rootGraph(carrier));
    expect(result.graph.nodes.some(n => n.id === 'f')).toBe(false);
    expect(result.disclosures).toContainEqual(expect.objectContaining({ node_id: 'f', reason: 'invented_root_level_unknown' }));
    expect(result.asks).toContain('What is Unlevelled carrier today?');
  });
  it.each([1, 3])('RED R5: sealed draw %i retains Starter Subscribers and its stated receipts', async draw => {
    const raw = JSON.parse(readFileSync(new URL(`./compile-spec/fixtures/s2-sealed-d${draw}.records.json`, import.meta.url), 'utf8'));
    const result = await replayRecordSet(omitOptionalRecordNulls(raw) as DraftRecordSet, { brief: BRIEF });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect((result.graph as { nodes: { id: string }[] }).nodes.some(n => n.id === '19b1afd6')).toBe(true);
    expect(result.projection.dropped.some(d => d.node_id === '19b1afd6' && d.reason === 'invented_root_level_unknown')).toBe(false);
  });
});
