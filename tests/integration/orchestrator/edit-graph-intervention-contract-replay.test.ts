/**
 * V5 edit_graph P0 — option-contract persist→read replay (boundary integration).
 *
 * Replays the staging failure (scenario 30aa36ad) across the REAL read boundary:
 * an edit-added option persisted its interventions under `node.data.interventions`,
 * `GraphV3.safeParse` strips `node.data` on read (NodeV3 has no `data` field), and
 * `computeStructuralReadiness` then sees the option wired to factors but with ZERO
 * interventions → it reaches run_analysis/PLoT as `options_not_configured` / 422.
 *
 * Proves: the persist-boundary normaliser (`normaliseOptionInterventionContract`,
 * wired into `commitDirectAnswer`) flips the edit-added option from the failing
 * state to `ready` with non-empty interventions — the exact predicate the
 * run_analysis `options_not_configured` guard (run-analysis.ts:245) checks — while
 * leaving the draft-created options byte-identical.
 */
import { describe, it, expect } from 'vitest';

import { normaliseOptionInterventionContract } from '../../../src/orchestrator-v5/normalise-option-interventions.js';
import { computeStructuralReadiness } from '../../../src/orchestrator/tools/analysis-ready-helper.js';
import { GraphV3, type GraphV3T } from '../../../src/schemas/cee-v3.js';

/** Edge in the canonical EdgeV3 shape (required exists_probability + effect_direction). */
const edge = (from: string, to: string) => ({
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 1,
  effect_direction: 'positive' as const,
});

/** Draft-created option: canonical top-level InterventionV3 (as persisted on staging). */
const draftOption = (id: string, value: number, isBaseline: boolean) => ({
  id,
  kind: 'option' as const,
  label: `draft ${id}`,
  is_baseline: isBaseline,
  interventions: {
    fac_annual_cost: {
      unit: '£',
      value,
      source: 'brief_extraction' as const,
      reasoning: 'Direct from V4 prompt data.interventions',
      target_match: { node_id: 'fac_annual_cost', confidence: 'high' as const, match_type: 'exact_id' as const },
      value_confidence: 'high' as const,
    },
  },
});

/** The full staging-shaped graph: 3 draft options + the edit-added opt_hybrid (data.interventions). */
const buildStagingGraph = () => ({
  nodes: [
    { id: 'goal_support', kind: 'goal', label: 'Maximise Resolved Tickets Per Week' },
    { id: 'dec_support', kind: 'decision', label: 'Support model' },
    { id: 'fac_annual_cost', kind: 'factor', label: 'Annual Support Cost', observed_state: { value: 0.267 } },
    { id: 'fac_inhouse_capacity', kind: 'factor', label: 'In-House Agent Capacity', observed_state: { value: 0 } },
    { id: 'fac_bpo_engagement', kind: 'factor', label: 'BPO Vendor Engagement', observed_state: { value: 0 } },
    draftOption('opt_hire', 0.933, true),
    draftOption('opt_outsource', 0.6, false),
    draftOption('opt_status_quo', 0.267, false),
    // edit-added option — interventions under data.interventions (the bug shape), wired to factors
    {
      id: 'opt_hybrid',
      kind: 'option',
      label: 'Hybrid: 2 In-House Agents + Partial BPO',
      is_baseline: false,
      data: {
        interventions: {
          fac_annual_cost: { cap: 200000, unit: '£', value: 0.55, raw_value: 110000 },
          fac_bpo_engagement: { cap: 1, unit: 'proportion', value: 0.5, raw_value: 0.5 },
          fac_inhouse_capacity: { cap: 4, unit: 'agents', value: 0.5, raw_value: 2 },
        },
      },
    },
  ],
  edges: [
    edge('dec_support', 'opt_hybrid'),
    edge('opt_hybrid', 'fac_annual_cost'),
    edge('opt_hybrid', 'fac_inhouse_capacity'),
    edge('opt_hybrid', 'fac_bpo_engagement'),
  ],
});

const optionInReadiness = (graph: GraphV3T, id: string) => {
  const r = computeStructuralReadiness(graph);
  expect(r).toBeDefined();
  const opt = r!.options.find((o) => o.option_id === id);
  expect(opt).toBeDefined();
  return opt!;
};

describe('edit_graph option-contract persist→read replay (V5 P0)', () => {
  it('CONTROL (no fix): the edit-added option reaches readiness with ZERO interventions (the 422 cause)', () => {
    const parsed = GraphV3.safeParse(buildStagingGraph()); // data stripped on read
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const opt = optionInReadiness(parsed.data, 'opt_hybrid');
    expect(Object.keys(opt.interventions)).toHaveLength(0); // <- would trip options_not_configured / PLoT 422
    expect(opt.status).toBe('needs_encoding'); // connected to factors but no encoded interventions
  });

  it('FIXED: normalise-then-read yields the edit-added option READY with its 3 interventions', () => {
    const normalised = normaliseOptionInterventionContract(buildStagingGraph());
    const parsed = GraphV3.safeParse(normalised);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const opt = optionInReadiness(parsed.data, 'opt_hybrid');
    expect(Object.keys(opt.interventions).sort()).toEqual(
      ['fac_annual_cost', 'fac_bpo_engagement', 'fac_inhouse_capacity'],
    );
    expect(opt.interventions.fac_annual_cost).toBe(0.55);
    expect(opt.status).toBe('ready');

    // the run_analysis options_not_configured guard predicate now passes for ALL options
    const allConfigured = parsed.data.nodes
      .filter((n) => n.kind === 'option')
      .every((n) => {
        const o = computeStructuralReadiness(parsed.data)!.options.find((x) => x.option_id === n.id)!;
        return Object.keys(o.interventions).length > 0;
      });
    expect(allConfigured).toBe(true);
  });

  it('FIXED: the three draft-created options are byte-identical after normalisation', () => {
    const before = buildStagingGraph();
    const draftBefore = before.nodes
      .filter((n) => n.kind === 'option' && n.id !== 'opt_hybrid')
      .map((n) => JSON.stringify(n));
    const after = normaliseOptionInterventionContract(before) as { nodes: Array<{ id: string; kind: string }> };
    const draftAfter = after.nodes
      .filter((n) => n.kind === 'option' && n.id !== 'opt_hybrid')
      .map((n) => JSON.stringify(n));
    expect(draftAfter).toEqual(draftBefore);
  });
});
