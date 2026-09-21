/**
 * V5 edit_graph P0 (add-option encoding) — boundary replay.
 *
 * Proves the encoded option is analysis-ready across the REAL read chain that
 * Gate 1 failed on: encode → GraphV3.safeParse (strips node.data) →
 * computeStructuralReadiness. The malformed live shapes (raw_value-only
 * data.interventions; node-level raw_value) become `status:'ready'` with a
 * derived numeric `value`, so run_analysis would NOT trip options_not_configured.
 * The uncappable case defers (graph unchanged) so nothing malformed is persisted.
 */
import { describe, it, expect } from 'vitest';

import { encodeOptionInterventionsForEdit } from '../../../src/orchestrator/tools/encode-option-interventions.js';
import { computeStructuralReadiness } from '../../../src/orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../src/schemas/cee-v3.js';

const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const });
const draftOption = (id: string, value: number, isBaseline: boolean) => ({
  id, kind: 'option', label: `draft ${id}`, is_baseline: isBaseline,
  interventions: { fac_annual_cost: { value, unit: '£', source: 'brief_extraction', target_match: { node_id: 'fac_annual_cost', confidence: 'high', match_type: 'exact_id' } } },
});
const baseNodes = () => [
  { id: 'goal_g', kind: 'goal', label: 'G' },
  { id: 'dec_d', kind: 'decision', label: 'D' },
  { id: 'fac_annual_cost', kind: 'factor', label: 'Annual Support Cost', observed_state: { value: 0.267, unit: '£', cap: 150000 } },
  draftOption('opt_a', 0.933, true),
  draftOption('opt_b', 0.6, false),
];

const readinessOption = (graph: unknown, id: string) => {
  const parsed = GraphV3.safeParse(graph);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('parse failed');
  const r = computeStructuralReadiness(parsed.data);
  return r!.options.find((o) => o.option_id === id)!;
};

describe('edit_graph add-option encoding — boundary replay', () => {
  it('SHAPE 1 (raw_value-only data.interventions, capped) → encode → ready with derived value after safeParse', () => {
    const g = {
      nodes: [...baseNodes(), { id: 'opt_new', kind: 'option', label: 'New', data: { interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } } }],
      edges: [edge('opt_new', 'fac_annual_cost')],
    };
    // CONTROL: without encoding, safeParse strips data → option unconfigured (the Gate 1 failure).
    expect(Object.keys(readinessOption(g, 'opt_new').interventions)).toHaveLength(0);
    // FIXED: encode → ready with value 0.8 surviving safeParse.
    const { graph } = encodeOptionInterventionsForEdit(g);
    const opt = readinessOption(graph, 'opt_new');
    expect(opt.status).toBe('ready');
    expect(opt.interventions.fac_annual_cost).toBeCloseTo(0.8, 10);
  });

  it('SHAPE 2 (node-level raw_value, single edge, capped) → encode → ready after safeParse', () => {
    const g = {
      nodes: [...baseNodes(), { id: 'opt_lean', kind: 'option', label: 'Lean', unit: '£', raw_value: 120000 }],
      edges: [edge('dec_d', 'opt_lean'), edge('opt_lean', 'fac_annual_cost')],
    };
    const { graph } = encodeOptionInterventionsForEdit(g);
    const opt = readinessOption(graph, 'opt_lean');
    expect(opt.status).toBe('ready');
    expect(opt.interventions.fac_annual_cost).toBeCloseTo(0.8, 10);
  });

  it('uncappable factor → defer: graph unchanged, so nothing analysis-incompatible is persisted', () => {
    const g = {
      nodes: [...baseNodes(),
        { id: 'fac_cap', kind: 'factor', label: 'In-House Capacity', observed_state: { value: 0 } },
        { id: 'opt_u', kind: 'option', label: 'U', data: { interventions: { fac_cap: { unit: 'agents', raw_value: 2 } } } }],
      edges: [edge('opt_u', 'fac_cap')],
    };
    const out = encodeOptionInterventionsForEdit(g);
    expect(out.unresolvedOptionIds).toEqual(['opt_u']); // caller (edit handler) defers → graph never committed
    expect(out.graph).toBe(g);
  });

  it('P0-A: ADDED option that REQUESTED a configuration it could not encode → defer; the rerun graph stays analysis-ready (no options_not_configured)', () => {
    // The COMBINED-BUILD live failure: an ADDED option REQUESTED a £ intervention
    // on a drafted factor with no cap; the value could not be derived and
    // collapsed to interventions:null; the next run_analysis returned
    // options_not_configured. The must-configure set (intent-scoped) carries that
    // request, so the encoder defers it even though the node now looks empty.
    const g = {
      nodes: [...baseNodes(), { id: 'opt_unconf', kind: 'option', label: 'Unconfigured' }],
      edges: [edge('opt_unconf', 'fac_annual_cost')],
    };
    // CONTROL: were this option persisted, it reaches run_analysis with zero
    // numeric interventions after safeParse → the options_not_configured class.
    expect(readinessOption(g, 'opt_unconf').status).toBe('needs_encoding');
    expect(Object.keys(readinessOption(g, 'opt_unconf').interventions)).toHaveLength(0);
    // FIXED (P0-A configure-or-don't-persist): the add requested a configuration
    // (so it is in the must-configure set), so the encoder defers — graph
    // unchanged, the edit handler rejects, nothing is committed.
    const out = encodeOptionInterventionsForEdit(g, new Set(['opt_unconf']), new Set(['opt_unconf']));
    expect(out.unresolvedOptionIds).toEqual(['opt_unconf']);
    expect(out.graph).toBe(g);
    // The graph the rerun reads (pre-add baseline) keeps its ready options, so
    // run_analysis does NOT trip options_not_configured.
    expect(readinessOption(g, 'opt_a').status).toBe('ready');
    expect(readinessOption(g, 'opt_b').status).toBe('ready');
  });
});
