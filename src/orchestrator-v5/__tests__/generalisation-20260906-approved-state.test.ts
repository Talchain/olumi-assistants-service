/**
 * Synthetic approval replay through the real executor, held-action validator,
 * patch applier, commit composer and freshness derivation. The session store
 * models its JSON boundary only: this is not a database or browser restore test.
 * Prior run metadata is synthetic. No engine is called; these facts cannot
 * establish engine consumption.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import { _resetConfigCache } from '../../config/index.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { evaluateEditGraphMutations } from '../handlers/edit-graph-referee-gate.js';
import { parsePendingAction, type PendingAction } from '../session/pending-action.js';

const SCENARIO = '4b1f3c00-0911-42c4-88da-01caa5d60906';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function fixture() {
  return {
    goal_node_id: 'goal',
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Sustainable delivery',
        description: 'Protect learning time while reducing delivery surprises.' },
      { id: 'capacity', kind: 'factor', label: 'Coaching capacity',
        observed_state: { value: 0.35, unit: 'proportion' },
        prior: { distribution: 'uniform', range_min: 0.25, range_max: 0.45 },
        description: 'Mina expects 25–45% coverage; Jo doubts the pilot applies to new teams.' },
      { id: 'coach', kind: 'option', label: 'Fractional coach', interventions: { capacity: { value: 0.65 } } },
      { id: 'peer', kind: 'option', label: 'Peer learning', interventions: { capacity: { value: 0.4 } } },
      { id: 'hire', kind: 'option', label: 'Permanent mentor', interventions: { capacity: { value: 0.8 } } },
    ],
    edges: [['coach', 'capacity'], ['peer', 'capacity'], ['hire', 'capacity'], ['capacity', 'goal']]
      .map(([from, to]) => ({ from, to, strength: { mean: 0.55, std: 0.12 },
        exists_probability: 0.9, effect_direction: 'positive' })),
  };
}
let savedGraph = fixture();
let pendings: readonly PendingAction[] = [];
let writes: Array<Record<string, unknown>> = [];
let priorFacts: Array<Record<string, unknown>> = [];
const priorRow = { id: 'recorded-run-row', scenario_id: SCENARIO, user_id: null,
  turn_id: 'recorded-run', turn_class: 'handler', handler_id: 'run_analysis',
  request_hash: 'fixture-prior-run', response_emitted: true, llm_calls_used: 0,
  duration_ms: 1, created_at: '2026-09-06T18:00:00.000Z' };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      writes.push(clone(write));
      if (write.graph) savedGraph = clone(write.graph) as typeof savedGraph;
      if (write.pending_actions) pendings = clone(write.pending_actions) as PendingAction[];
      return { id: `row-${writes.length}` };
    },
    readRecent: async () => [priorRow], readFactsFor: async () => priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => clone(savedGraph),
    loadGraphAndBriefText: async () => ({ graph: clone(savedGraph), briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => clone(pendings),
  }),
  resetSessionStoreForTests: () => {},
}));
const { runTurnExecutor } = await import('../turn-executor.js');

function payload(message: string): MessageTurnPayload {
  return { kind: 'message', source: 'composer', turn_id: randomUUID(), scenario_id: SCENARIO,
    message, turn_class: 'decide', stage: 'analyse' };
}
const routing = { chatWithTools: vi.fn(async () => ({
  content: [{ type: 'text' as const, text: 'The pilot leaves uncertainty about how well coaching transfers to new teams.' }],
  stop_reason: 'end_turn' as const, usage: { input_tokens: 1, output_tokens: 1 },
})) };
function run(message: string) {
  // No ingress graph: every call must read the saved graph through buildTurnContext.
  return runTurnExecutor(payload(message), randomUUID(), { routingAdapter: routing });
}
function armRemoval() {
  const hash = computeAnalysisAffectingGraphHash(savedGraph);
  if (!hash) throw new Error('Fixture must hash');
  const decision = evaluateEditGraphMutations({
    mode: 'live', currentGraph: savedGraph, currentGraphHash: hash, baseGraphHash: hash,
    freshness: 'fresh', scenarioId: SCENARIO, turnId: 'offer', requestId: 'offer',
    operations: [{ op: 'remove_node', path: 'peer' }, { op: 'remove_edge', path: 'peer::capacity' }],
  });
  expect(decision.governing).toBe('held');
  expect(decision.pendingActions).toHaveLength(1);
  pendings = decision.pendingActions!;
  expect(parsePendingAction(pendings[0])).not.toBeNull();
  return pendings[0]!;
}

beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live'); _resetConfigCache();
  savedGraph = fixture(); GraphV3.parse(savedGraph); writes = []; pendings = []; routing.chatWithTools.mockClear();
  priorFacts = [{ fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
    scenario_id: SCENARIO, graph_hash_at_run: computeAnalysisAffectingGraphHash(savedGraph),
    computed_at: '2026-09-06T18:00:00.000Z', enrichment: { analysis_status: 'completed' },
    summary: 'Synthetic prior run; no ranking permission is asserted by this fixture.',
  } }];
});
afterEach(() => { vi.unstubAllEnvs(); _resetConfigCache(); });

describe('generalisation: approved application and subsequent state', () => {
  it('applies the approved removal once, retires the offer and preserves unrelated reasoning', async () => {
    const before = clone(savedGraph);
    const offered = armRemoval();
    const result = await run('Yes, do that.');
    expect(result.telemetry.commit_performed).toBe(true);
    expect(routing.chatWithTools).not.toHaveBeenCalled();
    expect(writes.filter(w => w.graph)).toHaveLength(1);
    expect(savedGraph.nodes.map(n => n.id)).toEqual(['goal', 'capacity', 'coach', 'hire']);
    expect(savedGraph.edges).toEqual(before.edges.filter(e => e.from !== 'peer'));
    for (const node of before.nodes.filter(n => n.id !== 'peer')) {
      expect(savedGraph.nodes.find(n => n.id === node.id)).toEqual(node);
    }
    expect(pendings.some(p => p.chip_id === offered.chip_id)).toBe(false);
    expect(writes[0]!.handler_facts).toEqual(expect.arrayContaining([expect.objectContaining({ fact_type: 'edit_graph' })]));

    const committed = clone(savedGraph);
    await run('Yes, do that.');
    expect(savedGraph).toEqual(committed);
    expect(writes.filter(w => w.graph)).toHaveLength(1);
  });

  it('a changed saved model remains stale after JSON restoration and a no-ingress turn', async () => {
    const before = await run('What uncertainties should we discuss?');
    expect(before.freshness?.freshness).toBe('fresh');
    const offered = armRemoval();
    await run('Yes, do that.');
    expect(savedGraph.nodes.some(n => n.id === 'peer')).toBe(false);
    const snapshot = JSON.stringify({ graph: savedGraph, pending_actions: pendings });
    const restored = JSON.parse(snapshot);
    savedGraph = restored.graph; pendings = restored.pending_actions;
    const response = await run('What uncertainties should we discuss?');
    expect(response.freshness?.freshness).toBe('stale');
    expect(response.freshness?.reason).toBe('graph_hash_diverged');
    expect(savedGraph.nodes.find(n => n.id === 'capacity')?.observed_state).toEqual({
      value: 0.35, unit: 'proportion',
    });
    expect(savedGraph.nodes.find(n => n.id === 'capacity')?.prior).toEqual({
      distribution: 'uniform', range_min: 0.25, range_max: 0.45,
    });
    expect(savedGraph.nodes.find(n => n.id === 'capacity')?.description).toContain('Jo doubts');
    expect(pendings.some(p => p.chip_id === offered.chip_id)).toBe(false);
  });

  it('approval cannot apply an offer whose saved model has changed', async () => {
    armRemoval();
    savedGraph.edges[0]!.strength.mean = 0.3;
    const changed = clone(savedGraph);
    await run('Yes, do that.');
    expect(savedGraph).toEqual(changed);
    expect(writes.filter(w => w.graph)).toHaveLength(0);
  });
});
