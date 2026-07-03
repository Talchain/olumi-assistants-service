/**
 * Frozen-seam readiness proofs (WS5) — the evidence base for the
 * executable-option seam-change decision (Docs/v6/handoff-option-surface-seam.md).
 *
 * HEADLINE PROOF (pin 2): a fully-executable synthetic option does NOT
 * downgrade structural readiness — G12(i) optionSurfaceUnchanged is the
 * BINDING constraint that blocks executable option enrichment, not the
 * readiness guard. Pin 4 sharpens it: even a strict readiness IMPROVEMENT
 * is discarded by the byte-freeze.
 *
 * All pins run against the CURRENT frozen contract via the real live guards
 * (read-only imports). Nothing here assumes a moved seam.
 */
import { describe, it, expect } from 'vitest';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { mergeProposals, type DeferArtifact } from '../../dual-draft/merge.js';
import { optionSurfaceUnchanged, checkReadinessNoDowngrade } from '../../dual-draft/guards.js';
import { computeStructuralReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import {
  synthesiseOptionCandidate,
  extractDeferredOptionLabel,
} from '../option-enrichment/synthesise-option-candidate.js';
import { baseGraph } from './adversarial-fixtures.js';

const DEFER_PROPOSAL = {
  type: 'added_option',
  delta: { node: { id: 'opt_partner', kind: 'option', label: 'Partner with a distributor' } },
  evidence_pointer: 'brief: partnership mentioned',
  rationale: 'A third route the draft does not model.',
};

function deferredArtifact(): DeferArtifact {
  const out = mergeProposals(baseGraph(), [DEFER_PROPOSAL]);
  expect(out.artifacts).toHaveLength(1);
  return out.artifacts[0];
}

function withNode(graph: GraphV3T, node: GraphV3T['nodes'][number]): GraphV3T {
  const clone = structuredClone(graph);
  clone.nodes.push(node);
  return clone;
}

/** A single-option graph — structurally needs_user_input (fewer than 2 options). */
function oneOptionGraph(): GraphV3T {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_price: 0.8 } },
      { id: 'fac_price', kind: 'factor', label: 'Price point' },
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

describe('pin 1 — D1: the merge NEVER applies an added_option, however well-formed', () => {
  it('a fully-labelled option proposal defers to an artifact; graph deep-equal', () => {
    const g = baseGraph();
    const out = mergeProposals(g, [DEFER_PROPOSAL]);
    expect(out.report.applied).toBe(0);
    expect(out.report.artifacts).toBe(1);
    expect(out.merged).toEqual(g);
    expect(extractDeferredOptionLabel(out.artifacts[0].question)).toBe('Partner with a distributor');
  });
});

describe('pin 2 — HEADLINE: G12(i), not readiness, blocks an executable option', () => {
  it('an executable candidate keeps readiness OK, yet optionSurfaceUnchanged trips', () => {
    const g = baseGraph(); // 2 ready options → payload status 'ready'
    const candidate = synthesiseOptionCandidate(deferredArtifact(), { fac_price: { value: 0.5 } }, g);
    expect(candidate.validation).toEqual({ ok: true, issues: [] });

    const after = withNode(g, candidate.node);
    expect(GraphV3.safeParse(after).success).toBe(true);

    const readiness = checkReadinessNoDowngrade(g, after);
    expect(readiness).toEqual({ ok: true, before_status: 'ready', after_status: 'ready' });

    // …and yet the byte-freeze discards it: the binding constraint.
    expect(optionSurfaceUnchanged(g, after)).toBe(false);
  });
});

describe('pin 3 — why D1 defers: a VALUE-LESS option downgrades readiness', () => {
  it('the candidate refuses to invent values (no_intervention_values_supplied)', () => {
    const candidate = synthesiseOptionCandidate(deferredArtifact(), {}, baseGraph());
    expect(candidate.validation.ok).toBe(false);
    expect(candidate.validation.issues).toContain('no_intervention_values_supplied');
  });

  it('appending a value-less option node flips ready → needs_user_mapping', () => {
    const g = baseGraph();
    const after = withNode(g, {
      id: 'opt_valueless',
      kind: 'option',
      label: 'Partner with a distributor',
    } as GraphV3T['nodes'][number]);
    const readiness = checkReadinessNoDowngrade(g, after);
    expect(readiness).toEqual({
      ok: false,
      before_status: 'ready',
      after_status: 'needs_user_mapping',
    });
  });
});

describe('pin 4 — the freeze blocks even strict readiness IMPROVEMENTS', () => {
  it('on a 1-option graph an executable candidate lifts needs_user_input → ready, yet G12(i) still trips', () => {
    const g = oneOptionGraph();
    expect(computeStructuralReadiness(g)?.status).toBe('needs_user_input');

    const candidate = synthesiseOptionCandidate(deferredArtifact(), { fac_price: { value: 0.4 } }, g);
    expect(candidate.validation.ok).toBe(true);

    const after = withNode(g, candidate.node);
    expect(computeStructuralReadiness(after)?.status).toBe('ready');
    expect(checkReadinessNoDowngrade(g, after).ok).toBe(true); // improvement

    expect(optionSurfaceUnchanged(g, after)).toBe(false); // still discarded
  });
});

describe('pin 5 — the third blocker: edges to the candidate are endpoint-restricted', () => {
  it('an added_causal_link touching the injected option id → edge_endpoint_restricted', () => {
    const g = baseGraph();
    const candidate = synthesiseOptionCandidate(deferredArtifact(), { fac_price: { value: 0.5 } }, g);
    const withCandidate = withNode(g, candidate.node);

    const out = mergeProposals(withCandidate, [
      {
        type: 'added_causal_link',
        delta: {
          edge: {
            from: candidate.node.id,
            to: 'fac_price',
            strength: { mean: 0.3, std: 0.1 },
            exists_probability: 0.7,
            effect_direction: 'positive',
          },
        },
        evidence_pointer: 'probe',
      },
    ]);
    expect(out.report.failures.map((f) => f.reason_code)).toEqual(['edge_endpoint_restricted']);
  });
});

describe('pin 6 — the unsynchronised surface: GraphV3 has NO top-level options[]', () => {
  it('type-level: options is not a property of GraphV3T', () => {
    const g = baseGraph();
    // @ts-expect-error — GraphV3T deliberately has no options[]; the
    // response-level options array lives on CEEGraphResponseV3 only. An
    // executable-option lane must decide who writes that surface.
    void g.options;
  });

  it('runtime: GraphV3.parse STRIPS a top-level options array (strip-mode object)', () => {
    const parsed = GraphV3.parse({
      ...structuredClone(baseGraph()),
      options: [{ id: 'opt_launch', label: 'Launch now' }],
    } as unknown as GraphV3T);
    expect('options' in parsed).toBe(false);
  });
});

describe('candidate determinism + collision handling', () => {
  it('same inputs → deep-equal candidates', () => {
    const g = baseGraph();
    const a = synthesiseOptionCandidate(deferredArtifact(), { fac_price: { value: 0.5 } }, g);
    const b = synthesiseOptionCandidate(deferredArtifact(), { fac_price: { value: 0.5 } }, g);
    expect(a).toEqual(b);
  });

  it('id collisions get a numeric suffix against the current graph', () => {
    const g = baseGraph();
    const first = synthesiseOptionCandidate(deferredArtifact(), { fac_price: { value: 0.5 } }, g);
    const gWithFirst = withNode(g, first.node);
    const second = synthesiseOptionCandidate(deferredArtifact(), { fac_price: { value: 0.6 } }, gWithFirst);
    expect(second.node.id).toBe(`${first.node.id}_2`);
  });

  it('unknown or non-factor intervention targets are validation issues, never silently dropped', () => {
    const g = baseGraph();
    const candidate = synthesiseOptionCandidate(
      deferredArtifact(),
      { fac_missing: { value: 0.5 }, risk_churn: { value: 0.2 } },
      g,
    );
    expect(candidate.validation.ok).toBe(false);
    expect(candidate.validation.issues).toEqual(
      expect.arrayContaining([
        'intervention target "fac_missing" not in graph',
        'intervention target "risk_churn" is a risk, not a factor',
      ]),
    );
  });

  it('raw_value/unit provenance is preserved onto the OptionV3 intervention', () => {
    const candidate = synthesiseOptionCandidate(
      deferredArtifact(),
      { fac_price: { value: 0.59, raw_value: 59, unit: '£' } },
      baseGraph(),
    );
    expect(candidate.option.interventions.fac_price).toMatchObject({
      value: 0.59,
      raw_value: 59,
      unit: '£',
      source: 'user_specified',
      target_match: { node_id: 'fac_price', match_type: 'exact_id', confidence: 'high' },
    });
  });
});
