import { describe, expect, it } from 'vitest';

import {
  resolveLabel,
  resolveLabelOrFallback,
  type LabelResolverContext,
} from '../resolve-label.js';
import { genericFallbackForId } from '../../../orchestrator/shared/output-safety.js';

const GRAPH = {
  nodes: [
    { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally', kind: 'option' },
    { id: 'fac_hiring_cost', label: 'Hiring and Staffing Cost', kind: 'factor' },
  ],
  edges: [],
} as unknown as LabelResolverContext['graph'];

const ANALYSIS_READY = {
  options: [
    { option_id: 'opt_offshore', label: 'Engage Offshore Partner' },
    { option_id: 'opt_status_quo', label: 'Maintain Status Quo' },
  ],
};

const ENRICHMENT_OPTION_COMPARISON = {
  option_comparison: [
    { id: 'opt_tiered_pricing', label: 'Introduce Tiered Pricing' },
  ],
};

const ENRICHMENT_PAYLOADS = {
  payloads: {
    isl_request: {
      options: [
        { id: 'opt_payloads_only', label: 'ISL-Echo-Only Option' },
      ],
    },
  },
};

describe('resolveLabel — four-priority lookup', () => {
  it('priority 1: graph.nodes hit returns the node label', () => {
    const ctx: LabelResolverContext = { graph: GRAPH };
    expect(resolveLabel('opt_hire_local', ctx)).toBe('Hire Two Senior Engineers Locally');
    expect(resolveLabel('fac_hiring_cost', ctx)).toBe('Hiring and Staffing Cost');
  });

  it('priority 2: analysisReady.options hit when graph is absent', () => {
    const ctx: LabelResolverContext = { analysisReady: ANALYSIS_READY };
    expect(resolveLabel('opt_offshore', ctx)).toBe('Engage Offshore Partner');
    expect(resolveLabel('opt_status_quo', ctx)).toBe('Maintain Status Quo');
  });

  it('priority 2: tolerates `id` fallback (analysisReady option without explicit option_id)', () => {
    const ctx: LabelResolverContext = {
      analysisReady: { options: [{ id: 'opt_x', label: 'X' }] },
    };
    expect(resolveLabel('opt_x', ctx)).toBe('X');
  });

  it('priority 3: enrichment.option_comparison hit when 1 + 2 miss', () => {
    const ctx: LabelResolverContext = { enrichment: ENRICHMENT_OPTION_COMPARISON };
    expect(resolveLabel('opt_tiered_pricing', ctx)).toBe('Introduce Tiered Pricing');
  });

  it('priority 4: enrichment.payloads.isl_request.options hit (lowest priority)', () => {
    const ctx: LabelResolverContext = { enrichment: ENRICHMENT_PAYLOADS };
    expect(resolveLabel('opt_payloads_only', ctx)).toBe('ISL-Echo-Only Option');
  });

  it('priority 1 wins over priorities 2/3/4 when all sources have the same id', () => {
    const ctx: LabelResolverContext = {
      graph: {
        nodes: [{ id: 'opt_x', label: 'GRAPH_LABEL', kind: 'option' }],
        edges: [],
      } as unknown as LabelResolverContext['graph'],
      analysisReady: { options: [{ option_id: 'opt_x', label: 'AR_LABEL' }] },
      enrichment: {
        option_comparison: [{ id: 'opt_x', label: 'OC_LABEL' }],
        payloads: { isl_request: { options: [{ id: 'opt_x', label: 'ISL_LABEL' }] } },
      },
    };
    expect(resolveLabel('opt_x', ctx)).toBe('GRAPH_LABEL');
  });

  it('priority 2 wins over 3/4 when graph misses', () => {
    const ctx: LabelResolverContext = {
      analysisReady: { options: [{ option_id: 'opt_x', label: 'AR_LABEL' }] },
      enrichment: {
        option_comparison: [{ id: 'opt_x', label: 'OC_LABEL' }],
        payloads: { isl_request: { options: [{ id: 'opt_x', label: 'ISL_LABEL' }] } },
      },
    };
    expect(resolveLabel('opt_x', ctx)).toBe('AR_LABEL');
  });

  it('returns null when every priority misses', () => {
    expect(resolveLabel('opt_unknown', {})).toBeNull();
    expect(resolveLabel('opt_unknown', { graph: GRAPH, analysisReady: ANALYSIS_READY })).toBeNull();
  });

  it('returns null on empty/invalid input', () => {
    expect(resolveLabel('', { graph: GRAPH })).toBeNull();
    expect(resolveLabel(undefined as unknown as string, { graph: GRAPH })).toBeNull();
  });

  it('skips entries with empty-string labels (defensive)', () => {
    const ctx: LabelResolverContext = {
      analysisReady: { options: [{ option_id: 'opt_empty', label: '' }] },
    };
    expect(resolveLabel('opt_empty', ctx)).toBeNull();
  });

  it('handles null / undefined nested branches without throwing', () => {
    expect(resolveLabel('opt_x', { graph: null, analysisReady: null, enrichment: null })).toBeNull();
    expect(resolveLabel('opt_x', { enrichment: { payloads: undefined } })).toBeNull();
    expect(resolveLabel('opt_x', { enrichment: { option_comparison: undefined } })).toBeNull();
  });
});

describe('resolveLabelOrFallback — never returns the raw ID', () => {
  it('returns the resolved label when found', () => {
    expect(resolveLabelOrFallback('opt_hire_local', { graph: GRAPH }))
      .toBe('Hire Two Senior Engineers Locally');
  });

  it.each([
    ['opt_unknown', 'the relevant option'],
    ['option_unknown', 'the relevant option'],
    ['fac_unknown', 'the relevant factor'],
    ['factor_unknown', 'the relevant factor'],
    ['goal_unknown', 'the relevant goal'],
    ['dec_unknown', 'the relevant decision'],
    ['decision_unknown', 'the relevant decision'],
    ['out_unknown', 'the relevant outcome'],
    ['outcome_unknown', 'the relevant outcome'],
    ['risk_unknown', 'the relevant risk'],
    ['con_unknown', 'the relevant constraint'],
    ['constraint_unknown', 'the relevant constraint'],
  ])('falls back to prefix-aware generic for %s → %s', (id, expected) => {
    expect(resolveLabelOrFallback(id, {})).toBe(expected);
  });

  it('returns the defensive "the relevant node" for unrecognised prefixes', () => {
    expect(resolveLabelOrFallback('mystery_xyz', {})).toBe('the relevant node');
    expect(resolveLabelOrFallback('totally-malformed', {})).toBe('the relevant node');
  });

  it('never returns the raw ID for any prefix family', () => {
    const PREFIXES = [
      'opt', 'option', 'fac', 'factor', 'goal', 'dec', 'decision',
      'out', 'outcome', 'risk', 'con', 'constraint',
    ];
    for (const p of PREFIXES) {
      const id = `${p}_xxxx_yyyy`;
      const out = resolveLabelOrFallback(id, {});
      expect(out).not.toBe(id);
      expect(out).not.toContain(id);
    }
  });

  it('separator-agnostic: works for `_`, `:`, `-`', () => {
    expect(resolveLabelOrFallback('opt_x', {})).toBe('the relevant option');
    expect(resolveLabelOrFallback('opt:x', {})).toBe('the relevant option');
    expect(resolveLabelOrFallback('opt-x', {})).toBe('the relevant option');
  });
});

describe('unsafe-label rejection (Codex review 2026-04-30, finding #3)', () => {
  it('rejects label === id and falls through to fallback', () => {
    const ctx: LabelResolverContext = {
      analysisReady: { options: [{ option_id: 'opt_x', label: 'opt_x' }] },
    };
    expect(resolveLabel('opt_x', ctx)).toBeNull();
    expect(resolveLabelOrFallback('opt_x', ctx)).toBe('the relevant option');
  });

  it('rejects a label that contains a raw entity-id-shaped token', () => {
    const ctx: LabelResolverContext = {
      analysisReady: { options: [{ option_id: 'opt_x', label: 'See fac_churn_rate' }] },
    };
    expect(resolveLabel('opt_x', ctx)).toBeNull();
    expect(resolveLabelOrFallback('opt_x', ctx)).toBe('the relevant option');
  });

  it('priority-1 graph hit is rejected when the graph stores the raw id as the label', () => {
    const ctx: LabelResolverContext = {
      graph: {
        nodes: [{ id: 'opt_x', label: 'opt_x', kind: 'option' }],
        edges: [],
      } as unknown as LabelResolverContext['graph'],
    };
    expect(resolveLabel('opt_x', ctx)).toBeNull();
    expect(resolveLabelOrFallback('opt_x', ctx)).toBe('the relevant option');
  });

  it('falls through priorities until a SAFE label is found', () => {
    const ctx: LabelResolverContext = {
      graph: {
        nodes: [{ id: 'opt_x', label: 'opt_x', kind: 'option' }], // unsafe
        edges: [],
      } as unknown as LabelResolverContext['graph'],
      analysisReady: { options: [{ option_id: 'opt_x', label: 'See fac_churn' }] }, // unsafe
      enrichment: {
        option_comparison: [{ id: 'opt_x', label: 'Hire Two Senior Engineers' }], // safe
      },
    };
    expect(resolveLabel('opt_x', ctx)).toBe('Hire Two Senior Engineers');
  });

  it('returns null when EVERY priority has only unsafe labels', () => {
    const ctx: LabelResolverContext = {
      graph: {
        nodes: [{ id: 'opt_x', label: 'opt_x', kind: 'option' }],
        edges: [],
      } as unknown as LabelResolverContext['graph'],
      analysisReady: { options: [{ option_id: 'opt_x', label: 'See opt_y' }] },
      enrichment: {
        option_comparison: [{ id: 'opt_x', label: 'fac_churn ref' }],
        payloads: { isl_request: { options: [{ id: 'opt_x', label: 'opt_x_again' }] } },
      },
    };
    expect(resolveLabel('opt_x', ctx)).toBeNull();
    expect(resolveLabelOrFallback('opt_x', ctx)).toBe('the relevant option');
  });
});

describe('genericFallbackForId — pinning the shared mapping', () => {
  it('matches resolveLabelOrFallback fallback behaviour exactly', () => {
    const PREFIXES = [
      ['opt_x', 'the relevant option'],
      ['fac_x', 'the relevant factor'],
      ['goal_x', 'the relevant goal'],
      ['dec_x', 'the relevant decision'],
      ['out_x', 'the relevant outcome'],
      ['risk_x', 'the relevant risk'],
      ['con_x', 'the relevant constraint'],
    ] as const;
    for (const [id, expected] of PREFIXES) {
      expect(genericFallbackForId(id)).toBe(expected);
      expect(resolveLabelOrFallback(id, {})).toBe(expected);
    }
  });

  it('returns the defensive default for non-prefix inputs', () => {
    expect(genericFallbackForId('not_a_prefix')).toBe('the relevant node');
    expect(genericFallbackForId('')).toBe('the relevant node');
  });
});
