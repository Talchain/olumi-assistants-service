/**
 * Adversarial pins — multi-hop and same-batch cycle-closure behaviour.
 *
 * PINS the live merge's cycle rejection (read-only). The single-hop and
 * bidirected-reverse cases live in merge.test.ts; these add multi-hop
 * closures and the running-state semantics (the cycle check sees edges
 * applied EARLIER IN THE SAME BATCH).
 */
import { describe, it, expect } from 'vitest';
import { mergeProposals } from '../../dual-draft/merge.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { chainGraph, edgeProposal } from './adversarial-fixtures.js';

function codes(out: ReturnType<typeof mergeProposals>): string[] {
  return out.report.failures.map((f) => f.reason_code);
}

describe('multi-hop cycle closure → edge_creates_cycle', () => {
  for (const hops of [3, 4, 5]) {
    it(`closing a ${hops}-node directed chain (fac_${hops}→fac_1) is rejected`, () => {
      const out = mergeProposals(chainGraph(hops), [edgeProposal(`fac_${hops}`, 'fac_1')]);
      expect(out.report.applied).toBe(0);
      expect(codes(out)).toEqual(['edge_creates_cycle']);
    });
  }

  it('a same-direction long-range shortcut over the chain applies (no false positive)', () => {
    const out = mergeProposals(chainGraph(5), [edgeProposal('fac_1', 'fac_5')]);
    expect(out.report.applied).toBe(1);
    expect(out.report.failures).toEqual([]);
  });
});

describe('running-state semantics — the cycle check includes edges applied earlier in the batch', () => {
  it('reverse of an edge applied in the SAME batch closes a 2-cycle → edge_creates_cycle', () => {
    // Neither edge exists in the base graph; the second is only cyclic
    // because the first was applied moments earlier.
    const g = chainGraph(3); // has fac_1→fac_2→fac_3
    const out = mergeProposals(g, [
      edgeProposal('fac_3', 'fac_1'), // would close chain — wait, this IS cyclic vs base
    ]);
    expect(codes(out)).toEqual(['edge_creates_cycle']);

    // The genuinely-batch-local case: two brand-new opposite edges between
    // nodes with no pre-existing path.
    const g2 = GraphV3.parse({
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal' },
        { id: 'fac_a', kind: 'factor', label: 'A' },
        { id: 'fac_b', kind: 'factor', label: 'B' },
      ],
      edges: [],
    }) as GraphV3T;
    const out2 = mergeProposals(g2, [edgeProposal('fac_a', 'fac_b'), edgeProposal('fac_b', 'fac_a')]);
    expect(out2.report.applied).toBe(1);
    expect(codes(out2)).toEqual(['edge_creates_cycle']);
  });

  it('multi-hop closure that only exists because of an earlier in-batch apply → edge_creates_cycle', () => {
    // Base: fac_1→fac_2. Batch adds fac_2→fac_3 (fine), then fac_3→fac_1 —
    // cyclic ONLY via the just-applied edge.
    const g = GraphV3.parse({
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal' },
        { id: 'fac_1', kind: 'factor', label: 'F1' },
        { id: 'fac_2', kind: 'factor', label: 'F2' },
        { id: 'fac_3', kind: 'factor', label: 'F3' },
      ],
      edges: [
        {
          from: 'fac_1',
          to: 'fac_2',
          strength: { mean: 0.3, std: 0.1 },
          exists_probability: 0.7,
          effect_direction: 'positive',
        },
      ],
    }) as GraphV3T;
    const out = mergeProposals(g, [edgeProposal('fac_2', 'fac_3'), edgeProposal('fac_3', 'fac_1')]);
    expect(out.report.applied).toBe(1);
    expect(codes(out)).toEqual(['edge_creates_cycle']);
    // The applied edge is the first one.
    expect(out.merged.edges.some((e) => e.from === 'fac_2' && e.to === 'fac_3')).toBe(true);
    expect(out.merged.edges.some((e) => e.from === 'fac_3' && e.to === 'fac_1')).toBe(false);
  });
});

describe('bidirected (confounder) links never form the return path', () => {
  it('a back-path that crosses a bidirected edge is not a cycle → proposal applies', () => {
    // fac_1→fac_2 directed, fac_2↔fac_3 bidirected. Proposing fac_3→fac_1:
    // fac_1 can reach fac_2 but the bidirected hop to fac_3 is skipped, so no
    // directed return path exists.
    const g = GraphV3.parse({
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal' },
        { id: 'fac_1', kind: 'factor', label: 'F1' },
        { id: 'fac_2', kind: 'factor', label: 'F2' },
        { id: 'fac_3', kind: 'factor', label: 'F3' },
      ],
      edges: [
        {
          from: 'fac_1',
          to: 'fac_2',
          strength: { mean: 0.3, std: 0.1 },
          exists_probability: 0.7,
          effect_direction: 'positive',
        },
        {
          from: 'fac_2',
          to: 'fac_3',
          strength: { mean: 0.2, std: 0.1 },
          exists_probability: 0.6,
          effect_direction: 'positive',
          edge_type: 'bidirected',
        },
      ],
    }) as GraphV3T;
    const out = mergeProposals(g, [edgeProposal('fac_3', 'fac_1')]);
    expect(out.report.applied).toBe(1);
    expect(out.report.failures).toEqual([]);
  });
});
