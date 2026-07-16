/**
 * ROADMAP 2.11 / P0-2 — fixture-level pin of the FULL configure-option
 * chain, in the exact shapes the SERVED edit prompt emits (PMS
 * edit_graph_default v11, verified on staging 2026-07-16: teaches
 * `update_node` at `/nodes/<opt>/data/interventions/<factor_id>`, object
 * leaf `{value, raw_value, unit, cap}` — its EXAMPLE 2 — and CEE's parser
 * also accepts a scalar leaf).
 *
 * Chain pinned here, per hop:
 *   1. parseEditGraphResponse — the served-prompt op shape survives parsing
 *      WITH factor attribution (the object-leaf regression this lane fixed:
 *      an object leaf was smeared node-level, losing `<factor_id>`, so any
 *      option with more than one factor edge became un-attributable and the
 *      whole edit deferred);
 *   2. evaluateEditGraphMutations (live) — the op is TUNABLE
 *      (update_node_field, D-S would_apply): verdict proceeds, no hold;
 *   3. applyPatchOperations + encodeOptionInterventionsForEdit — the write
 *      lands as canonical top-level `interventions` with a numeric value;
 *   4. mergeInterventionSources + computeStructuralReadiness — the reader
 *      sees it and the option flips needs_encoding → ready (the exact
 *      predicate PLoT preflight enforces on run_analysis).
 *
 * Graph mirrors the diagnosis brief's captured scenario A (add-option-2.11.md
 * §2): the chat-added option has multiple option→factor edges and zero
 * interventions — the live shape that 422-blocked every analysis after A3.
 */
import { describe, it, expect } from 'vitest';

import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import {
  computeStructuralReadiness,
  mergeInterventionSources,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { evaluateEditGraphMutations } from '../../handlers/edit-graph-referee-gate.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

/** Scenario-A-shaped graph: 2 configured options + the intervention-less add. */
function buildScenarioAGraph() {
  return {
    nodes: [
      { id: 'dec_eu', kind: 'decision', label: 'EU Expansion' },
      {
        id: 'opt_berlin',
        kind: 'option',
        label: 'Open Berlin Office',
        interventions: {
          fac_setup_cost: { value: 0.6, source: 'user_specified' },
          fac_hiring: { value: 0.5, source: 'user_specified' },
        },
      },
      {
        id: 'opt_acquire',
        kind: 'option',
        label: 'Acquire Small German Competitor',
        // The live A3 shape: {id, kind, label} ONLY — zero interventions.
      },
      {
        id: 'fac_setup_cost',
        kind: 'factor',
        label: 'Setup Cost',
        observed_state: { value: 0.4, raw_value: 1000000, unit: '£', cap: 2500000 },
      },
      {
        id: 'fac_hiring',
        kind: 'factor',
        label: 'Hiring Speed',
        observed_state: { value: 0.5, raw_value: 50, unit: 'hires/yr', cap: 100 },
      },
      { id: 'goal_growth', kind: 'goal', label: 'EU Revenue Growth' },
    ],
    edges: [
      { from: 'dec_eu', to: 'opt_berlin', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_eu', to: 'opt_acquire', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      // The added option is wired to TWO factors (the attribution-ambiguity
      // shape: a node-level smear cannot pick between them).
      { from: 'opt_acquire', to: 'fac_setup_cost', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_acquire', to: 'fac_hiring', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_berlin', to: 'fac_setup_cost', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_berlin', to: 'fac_hiring', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_setup_cost', to: 'goal_growth', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
      { from: 'fac_hiring', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  };
}

/** The served prompt's EXAMPLE-2 output, retargeted at scenario A. */
const SERVED_PROMPT_SHAPED_RESPONSE = JSON.stringify({
  operations: [
    {
      op: 'update_node',
      path: '/nodes/opt_acquire/data/interventions/fac_setup_cost',
      value: { value: 0.8, raw_value: 2000000, unit: '£', cap: 2500000 },
      old_value: null,
      impact: 'moderate',
      rationale: 'Sets the setup cost intervention on the acquisition option.',
    },
    {
      op: 'update_node',
      path: '/nodes/opt_acquire/data/interventions/fac_hiring',
      value: { value: 0.7, raw_value: 70, unit: 'hires/yr', cap: 100 },
      old_value: null,
      impact: 'moderate',
      rationale: 'Sets the hiring speed intervention on the acquisition option.',
    },
  ],
  removed_edges: [],
  warnings: [],
  coaching: { summary: 'Configured the acquisition option.', rerun_recommended: true },
});

describe('configure-option apply chain (served-prompt op shapes, scenario A)', () => {
  it('hop 1 — parse keeps factor attribution for OBJECT intervention leaves', () => {
    const parsed = parseEditGraphResponse(SERVED_PROMPT_SHAPED_RESPONSE);
    expect(parsed.operations).toHaveLength(2);
    for (const [i, fac] of (['fac_setup_cost', 'fac_hiring'] as const).entries()) {
      const op = parsed.operations[i]!;
      expect(op.op).toBe('update_node');
      expect(op.path).toBe('opt_acquire');
      // The regression this pins: the object leaf must arrive keyed by its
      // slash path (factor attribution intact), NOT smeared node-level.
      const value = op.value as Record<string, unknown>;
      expect(Object.keys(value)).toEqual([`data/interventions/${fac}`]);
      expect((value[`data/interventions/${fac}`] as Record<string, unknown>).value).toBeDefined();
    }
  });

  it('hop 2 — the referee judges the op tunable and PROCEEDS (no hold)', () => {
    const parsed = parseEditGraphResponse(SERVED_PROMPT_SHAPED_RESPONSE);
    const decision = evaluateEditGraphMutations({
      mode: 'live',
      operations: parsed.operations,
      currentGraph: buildScenarioAGraph(),
      currentGraphHash: 'hash-a',
      baseGraphHash: 'hash-a',
      freshness: 'fresh',
      scenarioId: 'scn-1',
      turnId: 'turn-1',
      requestId: 'req-1',
    });
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
  });

  it('hops 3+4 — applier + encoder land canonical interventions; readiness flips needs_encoding → ready', () => {
    const graph = GraphV3.parse(buildScenarioAGraph());

    // RED baseline: before the write, the added option blocks analysis.
    const before = computeStructuralReadiness(graph);
    expect(before?.status).toBe('needs_encoding');
    expect(before?.options.find((o) => o.option_id === 'opt_acquire')?.status).toBe(
      'needs_encoding',
    );

    const parsed = parseEditGraphResponse(SERVED_PROMPT_SHAPED_RESPONSE);
    const applied = applyPatchOperations(graph, parsed.operations as PatchOperation[]);
    const { graph: encoded, unresolvedOptionIds } = encodeOptionInterventionsForEdit(
      applied,
      new Set(['opt_acquire']),
    );
    // The write must LAND — a defer here is the multi-factor attribution
    // regression (node-level smear cannot be attributed).
    expect(unresolvedOptionIds).toEqual([]);

    const encodedNode = (encoded as { nodes: Array<Record<string, unknown>> }).nodes.find(
      (n) => n.id === 'opt_acquire',
    )!;
    const merged = mergeInterventionSources(encodedNode);
    expect(merged).toBeDefined();
    expect(merged!.fac_setup_cost).toBeCloseTo(0.8);
    expect(merged!.fac_hiring).toBeCloseTo(0.7);

    const after = computeStructuralReadiness(GraphV3.parse(encoded));
    expect(after?.options.find((o) => o.option_id === 'opt_acquire')?.status).toBe('ready');
    expect(after?.status).toBe('ready');
  });

  it('scalar leaf form also lands (parser wraps it slash-keyed; encoder derives from the factor)', () => {
    const graph = GraphV3.parse(buildScenarioAGraph());
    const parsed = parseEditGraphResponse(
      JSON.stringify({
        operations: [
          {
            op: 'update_node',
            path: '/nodes/opt_acquire/data/interventions/fac_setup_cost',
            value: 0.8,
            old_value: null,
            impact: 'moderate',
            rationale: 'Scalar leaf.',
          },
          {
            op: 'update_node',
            path: '/nodes/opt_acquire/data/interventions/fac_hiring',
            value: 0.7,
            old_value: null,
            impact: 'moderate',
            rationale: 'Scalar leaf.',
          },
        ],
        removed_edges: [],
        warnings: [],
        coaching: { summary: 's', rerun_recommended: true },
      }),
    );
    const applied = applyPatchOperations(graph, parsed.operations as PatchOperation[]);
    const { graph: encoded, unresolvedOptionIds } = encodeOptionInterventionsForEdit(
      applied,
      new Set(['opt_acquire']),
    );
    expect(unresolvedOptionIds).toEqual([]);
    const after = computeStructuralReadiness(GraphV3.parse(encoded));
    expect(after?.options.find((o) => o.option_id === 'opt_acquire')?.status).toBe('ready');
  });
});
