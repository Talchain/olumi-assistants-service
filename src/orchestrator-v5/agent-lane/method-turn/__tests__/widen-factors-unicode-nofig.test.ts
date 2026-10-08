import { describe, expect, it } from 'vitest';
import { FACTOR_METHOD, factorGate, factorsTurnForReadback } from '../widen-turn.js';

const graph = {
  goal_node_id: 'goal',
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Sustainable business' },
    { id: 'revenue', kind: 'outcome', label: 'Revenue' },
  ],
  edges: [{ from: 'revenue', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8 }],
};

const candidate = (over: Record<string, string> = {}) => ({
  label: 'Customer retention', category: FACTOR_METHOD.categories[0], anchor_id: 'revenue',
  direction: 'positive', since: 'steadier relationships support revenue', ...over,
});

function gate(over: Record<string, string> = {}) {
  const turn = factorsTurnForReadback({ graph });
  expect(turn.kind).toBe('run_factors');
  if (turn.kind !== 'run_factors') throw new Error('Expected readable factors turn');
  return factorGate(turn, [candidate(over)]);
}

describe('P14 FD-NO-FIGURE covers Unicode figures', () => {
  it('drops the Arabic decimal digit in Retention phase ٢', () => {
    expect(gate({ label: 'Retention phase ٢' }).kept).toEqual([]);
  });

  it('drops the unsupported Arabic figure in retention increases ٢٠٪', () => {
    expect(gate({ since: 'retention increases ٢٠٪' }).kept).toEqual([]);
  });

  it.each(['%', '٪', '﹪', '％', '⁒'])('drops a standalone percent sign %s in label and mechanism', (percent) => {
    expect(gate({ label: `Retention ${percent}` }).kept).toEqual([]);
    expect(gate({ since: `retention increases ${percent}` }).kept).toEqual([]);
  });

  it('keeps a possible driver with no figure or percent sign', () => {
    expect(gate().kept.map((item) => item.label)).toEqual(['Customer retention']);
    expect(gate().dropped).toEqual([]);
  });
});
