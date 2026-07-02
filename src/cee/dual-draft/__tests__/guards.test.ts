/**
 * Phase 3 guard tests (RED-first).
 *
 * G10 numeric sanity + field allowlists, G12 analysis-ready no-downgrade
 * (structural-readiness recompute + option-surface invariance), G14
 * engine-boundary analysis-claim scan. The activation ruling stands behind
 * G12: structural checks are necessary but NOT sufficient — real merged-graph
 * run_analysis success is the activation gate; these guards only ensure the
 * merge can never make readiness WORSE.
 */
import { describe, it, expect } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import {
  findAnalysisClaim,
  checkEdgeNumericSanity,
  findForbiddenProposalField,
  ALLOWED_NODE_DELTA_FIELDS,
  ALLOWED_EDGE_DELTA_FIELDS,
  optionSurfaceUnchanged,
  checkReadinessNoDowngrade,
} from '../guards.js';

// A structurally READY graph: goal + two options with numeric interventions.
function readyGraph(): GraphV3T {
  return {
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
  } as GraphV3T;
}

describe('G14 — analysis-claim scan (engine-owned vocabulary rejected)', () => {
  const CLAIMY = [
    'the EVPI here is high',
    'VOI suggests gathering data first',
    'the flip point is around 0.3',
    'robustness is low for this option',
    'a sensitivity analysis shows price dominates',
    'there is an 87% probability of success',
    '90% confidence this holds',
    'the analysis shows option A wins',
    'analysis computed a win probability of 0.7',
  ];
  for (const text of CLAIMY) {
    it(`flags: "${text}"`, () => {
      expect(findAnalysisClaim(text)).not.toBeNull();
    });
  }

  const CLEAN = [
    'the brief mentions regulatory approval',
    'this link is plausible but unsupported',
    'worth validating the churn assumption with data',
    'draft: fac_price present but unquantified',
    'what is the current churn baseline?',
  ];
  for (const text of CLEAN) {
    it(`passes: "${text}"`, () => {
      expect(findAnalysisClaim(text)).toBeNull();
    });
  }

  it('scans multiple texts and returns the first hit', () => {
    expect(findAnalysisClaim('clean text', null, undefined, 'the flip point is 0.5')).not.toBeNull();
  });

  it('returns null when all texts are empty/absent', () => {
    expect(findAnalysisClaim(null, undefined, '')).toBeNull();
  });
});

describe('G10 — edge numeric sanity bounds (schema gap: mean is unbounded in EdgeStrengthV3)', () => {
  it('accepts an in-bounds edge', () => {
    expect(checkEdgeNumericSanity({ strength: { mean: 0.5, std: 0.2 } })).toBeNull();
  });

  it('rejects |mean| > 1', () => {
    expect(checkEdgeNumericSanity({ strength: { mean: 1.5, std: 0.2 } })).not.toBeNull();
    expect(checkEdgeNumericSanity({ strength: { mean: -1.01, std: 0.2 } })).not.toBeNull();
  });

  it('rejects std below the 1e-6 floor', () => {
    expect(checkEdgeNumericSanity({ strength: { mean: 0.5, std: 1e-7 } })).not.toBeNull();
  });

  it('rejects std above max(0.5, 2|mean|)', () => {
    // |mean|=0.1 → cap max(0.5, 0.2) = 0.5
    expect(checkEdgeNumericSanity({ strength: { mean: 0.1, std: 0.6 } })).not.toBeNull();
    // |mean|=0.4 → cap 0.8; 0.7 is fine
    expect(checkEdgeNumericSanity({ strength: { mean: 0.4, std: 0.7 } })).toBeNull();
  });
});

describe('G10 — proposal field allowlists (no invented values/units/caps)', () => {
  it('accepts a node delta with only allowlisted fields', () => {
    const node = { id: 'risk_x', kind: 'risk', label: 'X', description: 'd', uncertainty_drivers: ['a'] };
    expect(findForbiddenProposalField(node, ALLOWED_NODE_DELTA_FIELDS)).toBeNull();
  });

  for (const field of [
    'observed_state',
    'goal_threshold',
    'goal_threshold_raw',
    'goal_threshold_unit',
    'goal_threshold_cap',
    'prior',
    'intercept',
    'interventions',
    'encoding_map',
    'display_value',
    'is_baseline',
  ]) {
    it(`rejects a node delta carrying value-bearing field "${field}"`, () => {
      const node: Record<string, unknown> = { id: 'risk_x', kind: 'risk', label: 'X' };
      node[field] = field === 'prior' ? { distribution: 'uniform', range_min: 0, range_max: 1 } : 1;
      expect(findForbiddenProposalField(node, ALLOWED_NODE_DELTA_FIELDS)).toBe(field);
    });
  }

  it('rejects an edge delta carrying provenance/validation/origin fields', () => {
    const edge = {
      from: 'a',
      to: 'b',
      strength: { mean: 0.1, std: 0.1 },
      exists_probability: 0.5,
      effect_direction: 'positive',
      defaulted: true,
    };
    expect(findForbiddenProposalField(edge, ALLOWED_EDGE_DELTA_FIELDS)).toBe('defaulted');
  });
});

describe('G12 — option-surface invariance + readiness no-downgrade', () => {
  it('optionSurfaceUnchanged is true when option nodes and option-adjacent edges are untouched', () => {
    const before = readyGraph();
    const after = readyGraph();
    after.nodes.push({ id: 'risk_new', kind: 'risk', label: 'New risk' });
    expect(optionSurfaceUnchanged(before, after)).toBe(true);
  });

  it('optionSurfaceUnchanged is false when an option node is mutated', () => {
    const before = readyGraph();
    const after = readyGraph();
    (after.nodes[1] as { label: string }).label = 'Launch immediately';
    expect(optionSurfaceUnchanged(before, after)).toBe(false);
  });

  it('optionSurfaceUnchanged is false when an option node is added', () => {
    const before = readyGraph();
    const after = readyGraph();
    after.nodes.push({ id: 'opt_new', kind: 'option', label: 'Third way' });
    expect(optionSurfaceUnchanged(before, after)).toBe(false);
  });

  it('no-downgrade passes when a risk node is added to a ready graph', () => {
    const before = readyGraph();
    const after = readyGraph();
    after.nodes.push({ id: 'risk_new', kind: 'risk', label: 'New risk' });
    const res = checkReadinessNoDowngrade(before, after);
    expect(res.ok).toBe(true);
    expect(res.before_status).toBe('ready');
    expect(res.after_status).toBe('ready');
  });

  it('no-downgrade FAILS when a value-less option node lands in a ready graph (the defer-policy case)', () => {
    const before = readyGraph();
    const after = readyGraph();
    after.nodes.push({ id: 'opt_new', kind: 'option', label: 'Third way' });
    const res = checkReadinessNoDowngrade(before, after);
    expect(res.ok).toBe(false);
    expect(res.before_status).toBe('ready');
    expect(res.after_status).toBe('needs_user_mapping');
  });

  it('no-downgrade FAILS when the goal node disappears (readiness becomes underivable)', () => {
    const before = readyGraph();
    const after = readyGraph();
    after.nodes = after.nodes.filter((n) => n.kind !== 'goal');
    const res = checkReadinessNoDowngrade(before, after);
    expect(res.ok).toBe(false);
  });
});
