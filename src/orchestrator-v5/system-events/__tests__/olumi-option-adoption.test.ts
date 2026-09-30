import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { computeExpectedGraphCasHashes } from '../../context/graph-cas-conflict.js';
import { applyOlumiOptionAdoption } from '../olumi-option-adoption.js';

const graph = () => ({
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Which price?' },
    { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.49, source: 'brief_extraction' } },
    { id: 'keep', kind: 'option', label: 'Keep £49', interventions: { price: { value: 0.49, source: 'brief_extraction' } } },
    { id: 'raise', kind: 'option', label: 'Raise to £59', interventions: { price: { value: 0.59, source: 'brief_extraction' } } },
    { id: 'suggested', kind: 'option', label: 'Raise to £54', proposed_by: 'olumi',
      interventions: { price: { value: 0.54, source: 'cee_hypothesis' } } },
  ],
  edges: [
    { from: 'decision', to: 'keep', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'decision', to: 'raise', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'decision', to: 'suggested', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'suggested', to: 'price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
});

const input = (g: ReturnType<typeof graph>) => {
  const hashes = computeExpectedGraphCasHashes(g);
  return {
    option_id: 'suggested',
    expected_label: 'Raise to £54',
    expected_interventions: { price: { value: 0.54, source: 'cee_hypothesis' } },
    base_graph_hash: hashes.expectedGraphAnalysisHash!,
    expected_graph_identity_hash: hashes.expectedGraphIdentityHash!,
  };
};

describe('pressing an Olumi option into the comparison', () => {
  it('changes participation and freshness while preserving identity, edges, and Olumi levels', () => {
    const before = graph();
    const snapshot = structuredClone(before);
    const applied = applyOlumiOptionAdoption(before, input(before));
    expect(applied.kind, JSON.stringify(applied)).toBe('mutated');
    if (applied.kind !== 'mutated') return;
    expect(before).toEqual(snapshot);
    const adopted = applied.graph.nodes.find((n: unknown) => (n as { id?: string }).id === 'suggested') as Record<string, unknown>;
    expect(adopted).toMatchObject({ proposed_by: 'olumi', analysis_participation: 'included',
      interventions: { price: { value: 0.54, source: 'cee_hypothesis' } } });
    expect(applied.graph.edges).toEqual(before.edges);
    expect(applied.graph.nodes).toHaveLength(before.nodes.length);
    expect(applied.graph_hash).not.toBe(input(before).base_graph_hash);
  });

  it('refuses a changed reading and a moved base before any mutation', () => {
    const before = graph();
    expect(applyOlumiOptionAdoption(before, { ...input(before), expected_label: 'Another £54' }).kind).toBe('stale');
    expect(applyOlumiOptionAdoption(before, { ...input(before), base_graph_hash: '0'.repeat(16) }).kind).toBe('stale');
    expect(before.nodes.find((n) => n.id === 'suggested')).not.toHaveProperty('analysis_participation');
  });

  it('accepts the stored pricing graph shape with the existing £54 suggestion', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as {
      graph: { nodes: Array<Record<string, unknown>> };
    };
    const before = fixture.graph;
    const option = before.nodes.find((n) => n.id === 'raise_price_to_54')!;
    const cas = computeExpectedGraphCasHashes(before);
    const applied = applyOlumiOptionAdoption(before, {
      option_id: 'raise_price_to_54', expected_label: String(option.label),
      expected_interventions: option.interventions as Record<string, unknown>,
      base_graph_hash: cas.expectedGraphAnalysisHash!,
      expected_graph_identity_hash: cas.expectedGraphIdentityHash!,
    });
    expect(applied.kind, JSON.stringify(applied)).toBe('mutated');
    if (applied.kind !== 'mutated') return;
    expect(applied.graph.nodes.find((n: unknown) => (n as { id?: string }).id === 'raise_price_to_54'))
      .toMatchObject({ proposed_by: 'olumi', analysis_participation: 'included',
        interventions: option.interventions });
  });
});
