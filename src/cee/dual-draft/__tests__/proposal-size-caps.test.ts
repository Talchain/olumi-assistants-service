/**
 * G-size enforcement at the deterministic merge (F1 fix, MVP-path).
 *
 * Proves a 100KB node label — and every other oversized proposal text channel —
 * CANNOT enter the committed graph: the merge rejects the proposal individually
 * with `proposal_field_too_large`, valid siblings still apply, the exact-one-
 * bucket tally invariant holds, and no over-cap text survives into merged.nodes.
 */
import { describe, it, expect } from 'vitest';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { mergeProposals } from '../merge.js';
import { PROPOSAL_FIELD_CAPS } from '../guards.js';

const C = PROPOSAL_FIELD_CAPS;
const HUGE = 'x'.repeat(100_000);

function baseGraph(): GraphV3T {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_price: 0.8 } },
      { id: 'opt_wait', kind: 'option', label: 'Wait 6 months', interventions: { fac_price: 0.2 } },
      { id: 'fac_price', kind: 'factor', label: 'Price point' },
      { id: 'risk_churn', kind: 'risk', label: 'Customer churn' },
    ],
    edges: [
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  });
}

function codes(out: ReturnType<typeof mergeProposals>): string[] {
  return out.report.failures.map((f) => f.reason_code);
}

function assertTallyInvariant(out: ReturnType<typeof mergeProposals>, total: number): void {
  expect(out.report.applied + out.report.artifacts + out.report.failures.length).toBe(total);
  expect(out.report.proposals_total).toBe(total);
}

const VALID_RISK = {
  type: 'added_risk',
  delta: { node: { id: 'risk_regulatory', kind: 'risk', label: 'Regulatory delay' } },
  evidence_pointer: 'brief: approval timeline',
};

describe('G-size — a 100KB node label cannot enter the committed graph', () => {
  it('rejects the oversized proposal with proposal_field_too_large; the graph is untouched', () => {
    const g = baseGraph();
    const out = mergeProposals(g, [
      {
        type: 'added_risk',
        delta: { node: { id: 'risk_huge', kind: 'risk', label: HUGE } },
        evidence_pointer: 'brief: something',
      },
    ]);
    expect(out.report.applied).toBe(0);
    expect(codes(out)).toEqual(['proposal_field_too_large']);
    expect(out.merged).toEqual(g);
    expect(out.merged.nodes.some((n) => n.id === 'risk_huge')).toBe(false);
    expect(out.report.failures[0].reason).toContain('delta.node.label');
    expect(out.report.post_merge_valid).toBe(true);
  });

  it('rejects the oversized proposal but a valid sibling in the SAME batch still applies', () => {
    const out = mergeProposals(baseGraph(), [
      { type: 'added_risk', delta: { node: { id: 'risk_huge', kind: 'risk', label: HUGE } }, evidence_pointer: 'e' },
      VALID_RISK,
    ]);
    expect(out.report.applied).toBe(1);
    expect(codes(out)).toEqual(['proposal_field_too_large']);
    expect(out.merged.nodes.some((n) => n.id === 'risk_regulatory')).toBe(true);
    expect(out.merged.nodes.some((n) => n.id === 'risk_huge')).toBe(false);
    assertTallyInvariant(out, 2);
  });

  it('post-merge invariant: no committed node label exceeds the cap', () => {
    const out = mergeProposals(baseGraph(), [
      { type: 'added_risk', delta: { node: { id: 'risk_huge', kind: 'risk', label: HUGE } }, evidence_pointer: 'e' },
      VALID_RISK,
    ]);
    for (const n of out.merged.nodes) expect(n.label.length).toBeLessThanOrEqual(C.label);
  });
});

describe('G-size — every oversized channel is rejected with proposal_field_too_large', () => {
  const CASES: Array<[string, unknown]> = [
    [
      'node id',
      { type: 'added_risk', delta: { node: { id: `risk_${'a'.repeat(C.node_id)}`, kind: 'risk', label: 'R' } }, evidence_pointer: 'e' },
    ],
    ['node label', { type: 'added_risk', delta: { node: { id: 'risk_l', kind: 'risk', label: 'a'.repeat(C.label + 1) } }, evidence_pointer: 'e' }],
    [
      'node description',
      { type: 'added_risk', delta: { node: { id: 'risk_d', kind: 'risk', label: 'R', description: 'a'.repeat(C.description + 1) } }, evidence_pointer: 'e' },
    ],
    [
      'uncertainty_drivers item count',
      { type: 'added_risk', delta: { node: { id: 'risk_dc', kind: 'risk', label: 'R', uncertainty_drivers: Array.from({ length: C.uncertainty_drivers_items + 1 }, () => 'd') } }, evidence_pointer: 'e' },
    ],
    [
      'uncertainty_driver element length',
      { type: 'added_risk', delta: { node: { id: 'risk_de', kind: 'risk', label: 'R', uncertainty_drivers: ['a'.repeat(C.uncertainty_driver_length + 1)] } }, evidence_pointer: 'e' },
    ],
    ['evidence_pointer', { type: 'added_risk', delta: { node: { id: 'risk_ep', kind: 'risk', label: 'R' } }, evidence_pointer: 'a'.repeat(C.evidence_pointer + 1) }],
    ['rationale', { type: 'added_risk', delta: { node: { id: 'risk_ra', kind: 'risk', label: 'R' } }, evidence_pointer: 'e', rationale: 'a'.repeat(C.rationale + 1) }],
    ['artifact question', { type: 'added_evidence_gap', delta: { question: 'a'.repeat(C.question + 1) }, evidence_pointer: 'e' }],
  ];

  for (const [label, proposal] of CASES) {
    it(`rejects oversized ${label}`, () => {
      const out = mergeProposals(baseGraph(), [proposal]);
      expect(out.report.applied).toBe(0);
      expect(out.report.artifacts).toBe(0);
      expect(codes(out)).toEqual(['proposal_field_too_large']);
    });
  }

  it('an oversized artifact never becomes a DeferArtifact', () => {
    const out = mergeProposals(baseGraph(), [
      { type: 'added_evidence_gap', delta: { question: 'What?' }, evidence_pointer: 'a'.repeat(C.evidence_pointer + 1) },
    ]);
    expect(out.artifacts).toHaveLength(0);
    expect(codes(out)).toEqual(['proposal_field_too_large']);
  });
});

describe('G-size — boundary: exactly at cap applies, one over rejects', () => {
  it('label of exactly the cap applies', () => {
    const out = mergeProposals(baseGraph(), [
      { type: 'added_risk', delta: { node: { id: 'risk_atcap', kind: 'risk', label: 'a'.repeat(C.label) } }, evidence_pointer: 'e' },
    ]);
    expect(out.report.applied).toBe(1);
    expect(out.report.failures).toEqual([]);
  });

  it('label of cap + 1 rejects', () => {
    const out = mergeProposals(baseGraph(), [
      { type: 'added_risk', delta: { node: { id: 'risk_over', kind: 'risk', label: 'a'.repeat(C.label + 1) } }, evidence_pointer: 'e' },
    ]);
    expect(codes(out)).toEqual(['proposal_field_too_large']);
  });

  it('evidence_pointer of exactly the cap applies; an artifact at cap is recorded', () => {
    const out = mergeProposals(baseGraph(), [
      { type: 'added_evidence_gap', delta: { question: 'q'.repeat(C.question) }, evidence_pointer: 'a'.repeat(C.evidence_pointer) },
    ]);
    expect(out.report.artifacts).toBe(1);
    expect(out.report.failures).toEqual([]);
  });
});

describe('G-size — a whole batch is NOT collapsed by oversized members', () => {
  it('mixed batch: valid applies, oversized rejects, artifact records; tally holds', () => {
    const out = mergeProposals(baseGraph(), [
      VALID_RISK,
      { type: 'added_risk', delta: { node: { id: 'risk_huge', kind: 'risk', label: HUGE } }, evidence_pointer: 'e' },
      { type: 'added_evidence_gap', delta: { question: 'Churn baseline?' }, evidence_pointer: 'draft: churn' },
    ]);
    expect(out.report.applied).toBe(1);
    expect(out.report.artifacts).toBe(1);
    expect(codes(out)).toEqual(['proposal_field_too_large']);
    assertTallyInvariant(out, 3);
    expect(out.report.post_merge_valid).toBe(true);
  });
});
