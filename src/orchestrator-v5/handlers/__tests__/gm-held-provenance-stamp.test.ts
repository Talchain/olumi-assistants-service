/**
 * ROADMAP 2.396(b), held/confirm half — the SECOND of the two chat-set lanes
 * that wrote `observed_state` with no user stamp (the normal edit seam's half
 * is pinned in orchestrator/__tests__/user-edit-provenance-stamp.test.ts; the
 * full defect statement lives there).
 *
 * A held mixed batch the user explicitly CONFIRMS is the strongest possible
 * consent signal in the product — and before this change the value it applied
 * looked, to every provenance surface, exactly like an Olumi estimate.
 *
 * Harness mirrors gm-held-value-canonicalisation.test.ts: mint the hold
 * through the REAL referee gate, read the pending back, confirm through
 * `executeGmHeldResume` — the whole user-visible loop, not a hand-built input.
 */
import { describe, expect, it } from 'vitest';

import { evaluateEditGraphMutations } from '../edit-graph-referee-gate.js';
import { executeGmHeldResume, readGmHeldResume } from '../gm-held-execute.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

const VALUE_GRAPH = {
  goal_node_id: 'g_profit',
  schema_version: 'v3',
  nodes: [
    { id: 'g_profit', kind: 'goal', label: 'Profit' },
    {
      id: 'fac_setup',
      kind: 'factor',
      label: 'Setup and Migration Complexity',
      category: 'observable',
      observed_state: { value: 0.1, unit: 'index', raw_value: 10, cap: 100 },
    },
  ],
  edges: [
    {
      from: 'fac_setup',
      to: 'g_profit',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

function holdThenConfirm(operations: unknown[]) {
  const hash = hashOf(VALUE_GRAPH);
  const held = evaluateEditGraphMutations({
    mode: 'live',
    operations: operations as never,
    currentGraph: VALUE_GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none',
    scenarioId: 'scn-2396b-held',
    turnId: 'turn-2396b-held',
    requestId: 'req-2396b-held',
  });
  expect(held.governing).toBe('held');
  const pending = held.pendingActions![0]!;
  const read = readGmHeldResume(pending);
  expect(read.kind).toBe('ok');
  if (read.kind !== 'ok') throw new Error('pending must carry an executable payload');
  return executeGmHeldResume({
    operations: read.operations,
    currentGraph: VALUE_GRAPH,
    currentGraphHash: hash,
    freshness: 'none',
    hasExistingAnalysis: false,
    scenarioId: 'scn-2396b-held',
    turnId: 'turn-2396b-held',
    requestId: 'req-2396b-held',
  });
}

function nodeOf(graph: unknown, id: string): Record<string, unknown> {
  const found = ((graph as { nodes: Array<Record<string, unknown>> }).nodes).find(
    (n) => n.id === id,
  );
  if (found === undefined) throw new Error(`node ${id} missing`);
  return found;
}

describe('held/confirm seam — a confirmed value op earns the user stamp (2.396(b))', () => {
  const LIVE_VALUE_OP = {
    op: 'update_node',
    path: 'fac_setup',
    value: { 'data/value': 0.5 },
    old_value: { 'data/value': 0.1 },
  };
  const RISK_ADD = {
    op: 'add_node',
    path: 'risk_dq',
    value: { id: 'risk_dq', kind: 'risk', label: 'Data quality' },
  };
  const RISK_LINK = {
    op: 'add_edge',
    path: 'risk_dq::g_profit',
    value: {
      from: 'risk_dq',
      to: 'g_profit',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.8,
      effect_direction: 'negative',
    },
  };

  it('⭐ the confirmed value write lands WITH source user_override + provenance user_set', () => {
    const outcome = holdThenConfirm([LIVE_VALUE_OP, RISK_ADD, RISK_LINK]);

    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;

    // Identity binding: the CONFIRMED factor, by id.
    const fac = nodeOf(outcome.mutatedGraph, 'fac_setup');
    const observed = fac.observed_state as Record<string, unknown>;
    expect(observed.value).toBe(0.5);
    expect(observed.source).toBe('user_override');
    expect(fac.provenance).toBe('user_set');

    // The merge siblings still survive — the stamp must never become a
    // wholesale replace.
    expect(observed.unit).toBe('index');
    expect(observed.raw_value).toBe(10);
    expect(observed.cap).toBe(100);

    // Negative control: the structural sibling that ALSO landed in this batch
    // is NOT a value assertion and earns no user-value stamp.
    const risk = nodeOf(outcome.mutatedGraph, 'risk_dq');
    expect((risk.observed_state as Record<string, unknown> | undefined)?.source).toBeUndefined();
  });

  it('a structural-only batch stamps NOTHING (the stamp is value-write-scoped)', () => {
    const outcome = holdThenConfirm([RISK_ADD, RISK_LINK]);
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;

    const fac = nodeOf(outcome.mutatedGraph, 'fac_setup');
    expect((fac.observed_state as Record<string, unknown>).source).toBeUndefined();
    expect(fac.provenance).toBeUndefined();
  });
});
