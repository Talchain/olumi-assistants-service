import { describe, expect, it } from 'vitest';

import { buildCanonicalCommittedGraphReceipt } from '../compose/committed-graph-receipt.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { parseRequestExtensions } from '../boundary/request-extensions.js';
import { buildGraphLookup } from '../routing/graph-lookup-adapter.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import {
  canonicaliseCommittedGraphHashCarriers,
  projectGraphForPersistence,
} from '../persisted-graph-projection.js';

const goal = { id: 'goal_1', kind: 'goal', label: 'Goal' };

describe('canonical persisted graph hash carriers', () => {
  it('authors explicit carrier state before append and derives the unambiguous goal', () => {
    const projected = projectGraphForPersistence({ nodes: [goal], edges: [] });

    expect(projected).toEqual({
      nodes: [goal],
      edges: [],
      options: [],
      goal_node_id: 'goal_1',
      goal_constraints: [],
    });

    const receipt = buildCanonicalCommittedGraphReceipt(projected).draftGraph;
    for (const key of [
      'nodes',
      'edges',
      'options',
      'goal_node_id',
      'goal_constraints',
    ] as const) {
      expect(receipt[key], key).toEqual(projected[key]);
    }
  });

  it('uses explicit null only when the node set has no goal', () => {
    const legacy = {
      nodes: [{ id: 'fac_1', kind: 'factor', label: 'Factor' }],
      edges: [],
    };
    const projected = canonicaliseCommittedGraphHashCarriers(legacy);

    expect(projected).toEqual({
      ...legacy,
      options: [],
      goal_node_id: null,
      goal_constraints: [],
    });
    expect(computeAnalysisAffectingGraphHash(projected)).toBe(
      computeAnalysisAffectingGraphHash(legacy),
    );
  });

  it('round-trips a canonical no-goal projection through next-turn ingress, lookup, current hash, and canonical readiness', () => {
    const projected = projectGraphForPersistence({
      nodes: [{ id: 'fac_1', kind: 'factor', label: 'Factor' }],
      edges: [],
    });
    const persistedHash = computeAnalysisAffectingGraphHash(projected);
    expect(persistedHash).not.toBeNull();
    expect(projected.goal_node_id).toBeNull();

    const ingress = parseRequestExtensions(
      { graph_state: projected },
      'req-canonical-no-goal-roundtrip',
    );
    expect(ingress.ok).toBe(true);
    if (!ingress.ok) return;

    const nextTurnGraph = ingress.value.graphState;
    expect(nextTurnGraph).not.toBeNull();
    expect(Object.hasOwn(nextTurnGraph!, 'goal_node_id')).toBe(true);
    expect(nextTurnGraph!.goal_node_id).toBeNull();

    const lookup = buildGraphLookup(nextTurnGraph);
    expect(lookup.kind).toBe('ok');
    if (lookup.kind === 'ok') {
      expect(lookup.lookup.findEntityById('fac_1')).toMatchObject({
        id: 'fac_1',
        kind: 'node',
      });
    }

    expect(computeAnalysisAffectingGraphHash(nextTurnGraph!)).toBe(persistedHash);
    const readiness = buildCanonicalAnalysisReadyFromGraph(nextTurnGraph);
    expect(readiness).toMatchObject({
      status: 'blocked',
      goal_node_id: '',
      blocked_reason: 'NO_GOAL',
    });
    expect(readiness?.readiness_issues?.some((issue) => issue.code === 'NO_GOAL')).toBe(true);
  });

  it('is reference-idempotent after the canonical projection and hash-stable', () => {
    const once = projectGraphForPersistence({ nodes: [goal], edges: [] });
    const twice = projectGraphForPersistence(once);

    expect(twice).toBe(once);
    expect(computeAnalysisAffectingGraphHash(twice)).toBe(
      computeAnalysisAffectingGraphHash(once),
    );
  });

  it('establishes options before reconciliation so option nodes reach append.graph', () => {
    const option = {
      id: 'opt_1',
      kind: 'option',
      label: 'Option',
      interventions: { fac_1: 0.6 },
    };
    const projected = projectGraphForPersistence({ nodes: [goal, option], edges: [] });

    expect(projected.options).toEqual([
      {
        id: 'opt_1',
        label: 'Option',
        status: 'ready',
        interventions: { fac_1: 0.6 },
      },
    ]);
  });

  it('never guesses among multiple goal nodes, leaving the receipt barrier closed', () => {
    const projected = projectGraphForPersistence({
      nodes: [goal, { id: 'goal_2', kind: 'goal', label: 'Other goal' }],
      edges: [],
    });

    expect(Object.prototype.hasOwnProperty.call(projected, 'goal_node_id')).toBe(false);
    expect(() => buildCanonicalCommittedGraphReceipt(projected)).toThrowError(
      'missing_hash_carrier',
    );
  });
});
