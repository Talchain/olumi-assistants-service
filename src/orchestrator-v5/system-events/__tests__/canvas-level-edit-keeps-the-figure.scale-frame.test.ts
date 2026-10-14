/** A Starter-tier £49 → £59 canvas edit keeps the figure when only scale_frame declares the range. */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { mergeAppliedGraphForPersistence } from '../../handlers/edit-graph-dispatch.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { prepareOptionInterventionEdit } from '../option-intervention-edit.js';

const unit = '£ per subscriber per month';

/** Same served() shape and persistence harness as canvas-level-edit-keeps-the-figure.test.ts. */
function served(rangeSource: 'scale_frame' | 'cap') {
  return GraphV3.parse({
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'Monthly recurring revenue' },
      { id: 'raise_to_59', kind: 'option', label: 'Raise Starter-tier price to £59',
        interventions: { starter_price: {
          value: 0.245, raw_value: 49, display_value: '£49', unit, source: 'brief_extraction',
          target_match: { node_id: 'starter_price', confidence: 'high', match_type: 'exact_id' },
        } } },
      { id: 'keep_49_price', kind: 'option', label: 'Keep £49 price' },
      { id: 'starter_price', kind: 'factor', label: 'Starter-tier price',
        ...(rangeSource === 'scale_frame' ? { scale_frame: 200 } : {}),
        observed_state: {
          value: 0.245, raw_value: 49, unit, source: 'brief_extraction', declared_scale: 'unit_interval',
          ...(rangeSource === 'cap' ? { cap: 200 } : {}),
        } },
    ],
    edges: [['raise_to_59', 'starter_price'], ['starter_price', 'mrr']].map(([from, to]) => ({
      from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
    })),
  });
}

function written(g: ReturnType<typeof served>, modelValue: number): Record<string, unknown> | undefined {
  const r = prepareOptionInterventionEdit({ persistedGraph: g, optionId: 'raise_to_59', factorId: 'starter_price', modelValue,
    expectedGraphHash: computeAnalysisAffectingGraphHash(g)! });
  expect(r.kind, JSON.stringify(r)).toBe('prepared');
  if (r.kind !== 'prepared') return undefined;
  const ops = parseEditGraphResponse(JSON.stringify({ operations: [r.operation], removed_edges: [], warnings: [], coaching: null })).operations as PatchOperation[];
  const encoded = encodeOptionInterventionsForEdit(applyPatchOperations(g, ops), new Set(['raise_to_59']));
  const merged = mergeAppliedGraphForPersistence({ appliedGraph: encoded.graph, persistedBase: g, ingressBase: g, scenarioId: 's', requestId: 'r' });
  const after = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(merged))));
  return after.nodes.find((n) => n.id === 'raise_to_59')?.interventions?.starter_price as Record<string, unknown> | undefined;
}

describe('a canvas level edit keeps £59 on the factor\'s declared range', () => {
  it('scale_frame-only: stores raw_value 59 and the user-owned £ unit, clearing stale £49 display_value', () => {
    const graph = served('scale_frame');
    const factor = graph.nodes.find((n) => n.id === 'starter_price');
    expect(factor).toHaveProperty('scale_frame', 200);
    expect(factor?.observed_state).not.toHaveProperty('cap');

    const cellAfter = written(graph, 0.295);
    expect(cellAfter).toMatchObject({ value: 0.295, raw_value: 59, unit, source: 'user_specified' });
    expect(cellAfter).not.toHaveProperty('display_value');
  });

  it('CONTRAST observed_state.cap: the same edit stores raw_value 59 and clears stale £49 display_value', () => {
    const graph = served('cap');
    const factor = graph.nodes.find((n) => n.id === 'starter_price');
    expect(factor?.observed_state).toHaveProperty('cap', 200);
    expect(factor).not.toHaveProperty('scale_frame');

    const cellAfter = written(graph, 0.295);
    expect(cellAfter).toMatchObject({ value: 0.295, raw_value: 59, unit, source: 'user_specified' });
    expect(cellAfter).not.toHaveProperty('display_value');
  });
});
