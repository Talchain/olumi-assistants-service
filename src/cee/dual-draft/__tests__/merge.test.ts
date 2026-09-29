/**
 * Phase 3 deterministic-merge tests (RED-first).
 *
 * Invariants under test:
 *  - every proposal lands in EXACTLY one bucket (applied | artifact | failure);
 *  - added_option is DEFERRED (artifact), never merged (MVP policy D1);
 *  - all rejection classes fire with coded reasons;
 *  - the merged output is ALWAYS GraphV3-valid (or the report says otherwise);
 *  - same inputs → deep-equal outputs (determinism);
 *  - the input graph is never mutated.
 */
import { describe, it, expect } from 'vitest';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from '../../../config/graphCaps.js';
import { mergeProposals } from '../merge.js';
import { PROPOSAL_CAP } from '../proposals.js';

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
      {
        from: 'risk_churn',
        to: 'goal_revenue',
        strength: { mean: -0.4, std: 0.1 },
        exists_probability: 0.8,
        effect_direction: 'negative',
      },
    ],
  });
}

const VALID_RISK = {
  type: 'added_risk',
  delta: { node: { id: 'risk_regulatory', kind: 'risk', label: 'Regulatory delay' } },
  evidence_pointer: 'brief: approval timeline mentioned',
};

const VALID_EDGE = {
  type: 'added_causal_link',
  delta: {
    edge: {
      from: 'risk_churn',
      to: 'fac_price',
      strength: { mean: 0.3, std: 0.1 },
      exists_probability: 0.7,
      effect_direction: 'positive',
    },
  },
  evidence_pointer: 'draft: churn and price both present',
};

const VALID_ARTIFACT = {
  type: 'added_evidence_gap',
  delta: { question: 'What is the current churn baseline?' },
  evidence_pointer: 'draft: risk_churn unquantified',
};

function codes(report: ReturnType<typeof mergeProposals>['report']): string[] {
  return report.failures.map((f) => f.reason_code);
}

describe('mergeProposals — acceptance', () => {
  it('applies a valid risk node and a valid causal link', () => {
    const out = mergeProposals(baseGraph(), [VALID_RISK, VALID_EDGE]);
    expect(out.report.applied).toBe(2);
    expect(out.report.failures).toEqual([]);
    expect(out.merged.nodes.some((n) => n.id === 'risk_regulatory')).toBe(true);
    expect(out.merged.edges.some((e) => e.from === 'risk_churn' && e.to === 'fac_price')).toBe(true);
    expect(out.report.post_merge_valid).toBe(true);
    expect(GraphV3.safeParse(out.merged).success).toBe(true);
  });

  it('applies a node+edge proposal atomically (edge endpoint = own proposed node)', () => {
    const p = {
      type: 'added_risk',
      delta: {
        node: { id: 'risk_supply', kind: 'risk', label: 'Supply shortage' },
        edge: {
          from: 'risk_supply',
          to: 'fac_price',
          strength: { mean: 0.2, std: 0.1 },
          exists_probability: 0.6,
          effect_direction: 'positive',
        },
      },
      evidence_pointer: 'brief: supplier dependency',
    };
    const out = mergeProposals(baseGraph(), [p]);
    expect(out.report.applied).toBe(1);
    expect(out.merged.nodes.some((n) => n.id === 'risk_supply')).toBe(true);
    expect(out.merged.edges.some((e) => e.from === 'risk_supply')).toBe(true);
  });

  it('records defer artifacts without touching the graph', () => {
    const g = baseGraph();
    const out = mergeProposals(g, [VALID_ARTIFACT]);
    expect(out.artifacts).toHaveLength(1);
    expect(out.artifacts[0].question).toBe('What is the current churn baseline?');
    expect(out.report.applied).toBe(0);
    expect(out.merged).toEqual(g);
  });

  it('never mutates the input graph', () => {
    const g = baseGraph();
    const snapshot = structuredClone(g);
    mergeProposals(g, [VALID_RISK, VALID_EDGE, VALID_ARTIFACT]);
    expect(g).toEqual(snapshot);
  });

  it('is deterministic: same inputs → deep-equal outputs', () => {
    const a = mergeProposals(baseGraph(), [VALID_RISK, VALID_EDGE, VALID_ARTIFACT]);
    const b = mergeProposals(baseGraph(), [VALID_RISK, VALID_EDGE, VALID_ARTIFACT]);
    expect(a).toEqual(b);
  });
});

describe('mergeProposals — D1 policy: added_option is deferred, never merged', () => {
  it('converts added_option to a defer artifact; graph and option set unchanged', () => {
    const g = baseGraph();
    const p = {
      type: 'added_option',
      delta: { node: { id: 'opt_partner', kind: 'option', label: 'Partner with a distributor' } },
      evidence_pointer: 'brief: partnership mentioned',
      rationale: 'A third route the draft does not model.',
    };
    const out = mergeProposals(g, [p]);
    expect(out.report.applied).toBe(0);
    expect(out.artifacts).toHaveLength(1);
    expect(out.artifacts[0].type).toBe('added_option');
    expect(out.artifacts[0].question).toContain('Partner with a distributor');
    expect(out.merged).toEqual(g);
  });

  it('fails an added_option with no usable label', () => {
    const out = mergeProposals(baseGraph(), [
      { type: 'added_option', delta: { node: { id: 'opt_x', kind: 'option' } }, evidence_pointer: 'x' },
    ]);
    expect(codes(out.report)).toEqual(['option_missing_label']);
  });
});

describe('mergeProposals — rejection classes (each proposal in exactly one bucket)', () => {
  it('malformed envelope → malformed_proposal', () => {
    const out = mergeProposals(baseGraph(), [{ type: 'added_risk', delta: {} }]); // no evidence_pointer
    expect(codes(out.report)).toEqual(['malformed_proposal']);
  });

  it('proposal cap: index >= PROPOSAL_CAP → proposal_cap_exceeded', () => {
    const proposals = Array.from({ length: PROPOSAL_CAP + 2 }, (_, i) => ({
      type: 'added_evidence_gap',
      delta: { question: `q${i}` },
      evidence_pointer: `e${i}`,
    }));
    const out = mergeProposals(baseGraph(), proposals);
    expect(out.artifacts).toHaveLength(PROPOSAL_CAP);
    expect(codes(out.report)).toEqual(['proposal_cap_exceeded', 'proposal_cap_exceeded']);
  });

  it('artifact carrying a node delta → artifact_carries_delta', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'uncertainty_flag',
        delta: { question: 'q', node: { id: 'x', kind: 'risk', label: 'X' } },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['artifact_carries_delta']);
  });

  it('artifact with empty question → artifact_missing_question', () => {
    const out = mergeProposals(baseGraph(), [
      { type: 'added_evidence_gap', delta: { question: '   ' }, evidence_pointer: 'e' },
    ]);
    expect(codes(out.report)).toEqual(['artifact_missing_question']);
  });

  it('wrong node kind for proposal type → kind_not_allowed', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_risk',
        delta: { node: { id: 'goal_x', kind: 'goal', label: 'Sneaky goal' } },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['kind_not_allowed']);
  });

  it('node failing NodeV3 (bad id charset) → node_schema_invalid', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_risk',
        delta: { node: { id: 'Risk With Spaces!', kind: 'risk', label: 'X' } },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['node_schema_invalid']);
  });

  it('node carrying a value-bearing field → forbidden_node_field', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_risk',
        delta: { node: { id: 'risk_x', kind: 'risk', label: 'X', intercept: 0.4 } },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['forbidden_node_field']);
  });

  it('duplicate node id → duplicate_node_id', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_risk',
        delta: { node: { id: 'risk_churn', kind: 'risk', label: 'Different label' } },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['duplicate_node_id']);
  });

  it('duplicate normalised label → duplicate_node_label', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_risk',
        delta: { node: { id: 'risk_churn2', kind: 'risk', label: '  customer   CHURN ' } },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['duplicate_node_label']);
  });

  it('edge failing EdgeV3 (missing exists_probability) → edge_schema_invalid', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_causal_link',
        delta: {
          edge: { from: 'risk_churn', to: 'fac_price', strength: { mean: 0.3, std: 0.1 }, effect_direction: 'positive' },
        },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['edge_schema_invalid']);
  });

  it('edge with out-of-bounds strength.mean → edge_numeric_bounds (schema gap covered)', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_causal_link',
        delta: {
          edge: {
            from: 'risk_churn',
            to: 'fac_price',
            strength: { mean: 3.5, std: 0.1 },
            exists_probability: 0.7,
            effect_direction: 'positive',
          },
        },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['edge_numeric_bounds']);
  });

  it('edge carrying non-allowlisted field (defaulted) → forbidden_edge_field', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_causal_link',
        delta: {
          edge: {
            from: 'risk_churn',
            to: 'fac_price',
            strength: { mean: 0.3, std: 0.1 },
            exists_probability: 0.7,
            effect_direction: 'positive',
            defaulted: true,
          },
        },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['forbidden_edge_field']);
  });

  it('edge endpoint not in graph → edge_endpoint_missing', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_causal_link',
        delta: {
          edge: {
            from: 'fac_ghost',
            to: 'fac_price',
            strength: { mean: 0.3, std: 0.1 },
            exists_probability: 0.7,
            effect_direction: 'positive',
          },
        },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['edge_endpoint_missing']);
  });

  it('edge touching an option node → edge_endpoint_restricted (intervention structure is engine input)', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_causal_link',
        delta: {
          edge: {
            from: 'opt_launch',
            to: 'fac_price',
            strength: { mean: 0.3, std: 0.1 },
            exists_probability: 0.7,
            effect_direction: 'positive',
          },
        },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['edge_endpoint_restricted']);
  });

  it('duplicate from→to edge → duplicate_edge', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_causal_link',
        delta: {
          edge: {
            from: 'fac_price',
            to: 'goal_revenue',
            strength: { mean: 0.2, std: 0.1 },
            exists_probability: 0.7,
            effect_direction: 'positive',
          },
        },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['duplicate_edge']);
  });

  it('edge closing a directed cycle → edge_creates_cycle (a cyclic graph cannot run analysis)', () => {
    // Base has risk_churn → goal_revenue; adding goal_revenue → risk_churn closes a cycle.
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_causal_link',
        delta: {
          edge: {
            from: 'goal_revenue',
            to: 'risk_churn',
            strength: { mean: 0.2, std: 0.1 },
            exists_probability: 0.6,
            effect_direction: 'positive',
          },
        },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['edge_creates_cycle']);
  });

  it('bidirected (confounder) edges are excluded from cycle detection — reverse-direction proposal applies', () => {
    // Canonical detectCycles/isDAG semantics: bidirected edges are not
    // directed causal paths. A base graph storing a confounder as
    // risk_churn<->fac_price (edge_type bidirected, persisted as from/to)
    // must not make the legitimate directed fac_price->risk_churn proposal
    // look like a cycle.
    const g = baseGraph();
    g.edges.push({
      from: 'risk_churn',
      to: 'fac_price',
      strength: { mean: 0.2, std: 0.1 },
      exists_probability: 0.6,
      effect_direction: 'positive',
      edge_type: 'bidirected',
    } as (typeof g.edges)[number]);
    const out = mergeProposals(g, [
      {
        type: 'added_causal_link',
        delta: {
          edge: {
            from: 'fac_price',
            to: 'risk_churn',
            strength: { mean: 0.15, std: 0.1 },
            exists_probability: 0.5,
            effect_direction: 'positive',
          },
        },
        evidence_pointer: 'e',
      },
    ]);
    expect(out.report.failures).toEqual([]);
    expect(out.report.applied).toBe(1);
  });

  it('effect_direction inconsistent with strength.mean sign → effect_direction_inconsistent', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_causal_link',
        delta: {
          edge: {
            from: 'risk_churn',
            to: 'fac_price',
            strength: { mean: -0.3, std: 0.1 },
            exists_probability: 0.7,
            effect_direction: 'positive',
          },
        },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['effect_direction_inconsistent']);
  });

  it('analysis-claim text in rationale → engine_boundary_violation (G14)', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_risk',
        delta: { node: { id: 'risk_x', kind: 'risk', label: 'X' } },
        evidence_pointer: 'e',
        rationale: 'the flip point is 0.3 so this matters',
      },
    ]);
    expect(codes(out.report)).toEqual(['engine_boundary_violation']);
  });

  it('analysis-claim text in uncertainty_drivers → engine_boundary_violation (allowlisted free-text array is scanned)', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_assumption',
        delta: {
          node: {
            id: 'fac_supplier',
            kind: 'factor',
            label: 'Supplier reliability',
            uncertainty_drivers: ['analysis shows 90% probability of failure'],
          },
        },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['engine_boundary_violation']);
  });

  it('analysis-claim text in an artifact question → engine_boundary_violation', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'uncertainty_flag',
        delta: { question: 'is the 87% probability of success robust?' },
        evidence_pointer: 'e',
      },
    ]);
    expect(codes(out.report)).toEqual(['engine_boundary_violation']);
    expect(out.artifacts).toHaveLength(0);
  });
});

describe('mergeProposals — graph caps (G11)', () => {
  it('rejects a node proposal that would exceed GRAPH_MAX_NODES → graph_cap_exceeded', () => {
    const g = baseGraph();
    // Pad with factor nodes up to exactly the cap.
    for (let i = g.nodes.length; i < GRAPH_MAX_NODES; i++) {
      g.nodes.push({ id: `fac_pad_${i}`, kind: 'factor', label: `Pad ${i}` });
    }
    const out = mergeProposals(g, [VALID_RISK]);
    expect(codes(out.report)).toEqual(['graph_cap_exceeded']);
    expect(out.merged.nodes).toHaveLength(GRAPH_MAX_NODES);
  });

  it('rejects an edge proposal that would exceed GRAPH_MAX_EDGES → graph_cap_exceeded', () => {
    const g = baseGraph();
    // Pad with factor nodes + edges into the goal up to exactly the edge cap.
    for (let i = 0; g.edges.length < GRAPH_MAX_EDGES; i++) {
      const id = `fac_edge_pad_${i}`;
      g.nodes.push({ id, kind: 'factor', label: `Edge pad ${i}` });
      g.edges.push({
        from: id,
        to: 'goal_revenue',
        strength: { mean: 0.1, std: 0.05 },
        exists_probability: 0.5,
        effect_direction: 'positive',
      });
    }
    const out = mergeProposals(g, [VALID_EDGE]);
    expect(codes(out.report)).toEqual(['graph_cap_exceeded']);
    expect(out.merged.edges).toHaveLength(GRAPH_MAX_EDGES);
  });
});

describe('mergeProposals — accounting invariant', () => {
  it('applied + artifacts + failures === proposals_total on a mixed batch', () => {
    const proposals = [
      VALID_RISK,                                            // applied
      VALID_ARTIFACT,                                        // artifact
      { type: 'added_risk', delta: {} },                     // malformed (no evidence_pointer)
      {
        type: 'added_option',
        delta: { node: { id: 'opt_p', kind: 'option', label: 'Partner' } },
        evidence_pointer: 'e',
      },                                                     // artifact (deferred option)
      {
        type: 'added_risk',
        delta: { node: { id: 'risk_churn', kind: 'risk', label: 'Dup' } },
        evidence_pointer: 'e',
      },                                                     // failure (dup id)
    ];
    const out = mergeProposals(baseGraph(), proposals);
    expect(out.report.proposals_total).toBe(5);
    expect(out.report.applied).toBe(1);
    expect(out.report.artifacts).toBe(2);
    expect(out.report.failures).toHaveLength(2);
    expect(out.report.applied + out.report.artifacts + out.report.failures.length).toBe(
      out.report.proposals_total,
    );
  });
});

describe('mergeProposals — adversarial: output is always GraphV3-valid, never throws', () => {
  const HOSTILE: unknown[] = [
    null,
    42,
    'a string',
    [],
    {},
    { type: 'added_risk' },
    { type: 'added_risk', delta: null, evidence_pointer: 'e' },
    { type: 'added_causal_link', delta: { edge: { from: 'x', to: 'x' } }, evidence_pointer: 'e' },
    {
      type: 'added_causal_link',
      delta: {
        edge: {
          from: 'risk_churn',
          to: 'risk_churn',
          strength: { mean: 0.1, std: 0.05 },
          exists_probability: 0.5,
          effect_direction: 'positive',
        },
      },
      evidence_pointer: 'self-loop',
    },
    {
      type: 'added_risk',
      delta: { node: { id: 'risk_h', kind: 'risk', label: 'x'.repeat(100_000) } },
      evidence_pointer: 'huge string',
    },
    { type: 'added_risk', delta: { node: { __proto__: { polluted: true }, id: 'risk_pp', kind: 'risk', label: 'PP' } }, evidence_pointer: 'e' },
    { type: 'added_evidence_gap', delta: { question: 42 }, evidence_pointer: 'e' },
    { type: 'clarification_proposal', delta: {}, evidence_pointer: 'e' },
  ];

  it('processes a hostile batch without throwing; merged output parses as GraphV3', () => {
    const out = mergeProposals(baseGraph(), HOSTILE);
    expect(GraphV3.safeParse(out.merged).success).toBe(true);
    expect(out.report.proposals_total).toBe(HOSTILE.length);
    expect(out.report.applied + out.report.artifacts + out.report.failures.length).toBe(HOSTILE.length);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('every hostile proposal individually yields a valid graph or a recorded failure', () => {
    for (const p of HOSTILE) {
      const out = mergeProposals(baseGraph(), [p]);
      expect(GraphV3.safeParse(out.merged).success).toBe(true);
      expect(out.report.applied + out.report.artifacts + out.report.failures.length).toBe(1);
    }
  });
});
