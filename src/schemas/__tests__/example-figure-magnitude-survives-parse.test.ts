import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../cee-v3.js';

const graph = (magnitude: string) => ({
  nodes: [
    { id: 'subscribers', kind: 'factor', label: 'Subscribers' },
    { id: 'goal', kind: 'goal', label: 'Revenue goal' },
  ],
  edges: [{
    from: 'subscribers', to: 'goal',
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive',
    provenance: { source: 'cee_hypothesis', magnitude },
  }],
});

describe('RT-12: example edge magnitudes survive the persisted-graph parse', () => {
  // build-turn-context.ts parses the reloaded graph with GraphV3.safeParse.
  it('(a) GraphV3 keeps example_figure on the subscribers→goal edge', () => {
    const parsed = GraphV3.safeParse(graph('example_figure'));
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    const edge = parsed.data.edges.find((e) => e.from === 'subscribers' && e.to === 'goal');
    expect(edge).toBeDefined();
    expect(edge?.provenance?.magnitude).toBe('example_figure');
  });

  it('(b) GraphV3 still drops an unknown edge magnitude to undefined', () => {
    const parsed = GraphV3.safeParse(graph('nonsense'));
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    const edge = parsed.data.edges.find((e) => e.from === 'subscribers' && e.to === 'goal');
    expect(edge).toBeDefined();
    expect(edge?.provenance).toBeDefined();
    expect(edge?.provenance?.magnitude).toBeUndefined();
  });
});
