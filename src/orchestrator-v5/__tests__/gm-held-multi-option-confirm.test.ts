/**
 * (A) #1940 — a multi-option hold CONFIRMED through the real turn executor.
 *
 * Review 5841737272 (coverage gap): removing the recorded cap from the
 * executor's single-hold confirm (`commitGmHeldResume` → `executeGmHeldResume`)
 * failed no test — the unit cases call `executeGmHeldResume` directly and the
 * route case never confirms. This drives the REAL executor: the hold is the one
 * `dispatchAddOptionTransaction` mints for three options (12 envelopes > the
 * model-batch cap of 8), and "yes" must land every option in ONE commit.
 * CONTRAST: the same hold with its recorded cap stripped is declined with no
 * graph write — so the cap reaching the confirm is what the first case proves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { _resetConfigCache } from '../../config/index.js';
import * as telemetry from '../../utils/telemetry.js';

const SCENARIO_ID = randomUUID();

const GRAPH = {
  goal_node_id: 'g_profit',
  schema_version: 'v3',
  nodes: [
    { id: 'g_profit', kind: 'goal', label: 'Profit' },
    { id: 'dec_choice', kind: 'decision', label: 'Which platform' },
    { id: 'fac_effort', kind: 'factor', label: 'Migration effort', observed_state: { value: 0.4 } },
    { id: 'fac_uplift', kind: 'factor', label: 'Capability uplift', observed_state: { value: 0.3 } },
    { id: 'opt_stay', kind: 'option', label: 'Stay' },
  ],
  edges: [
    { from: 'fac_effort', to: 'g_profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_uplift', to: 'g_profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'dec_choice', to: 'opt_stay', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_stay', to: 'fac_effort', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};
const HASH = computeAnalysisAffectingGraphHash(GRAPH as never)!;

let pendingActionsForRead: readonly PendingAction[] = [];
const appendCalls: Array<Record<string, unknown>> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => GRAPH,
    loadGraphAndBriefText: async () => ({ graph: GRAPH, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { dispatchAddOptionTransaction } = await import('../handlers/add-option-dispatch.js');

const option = (label: string, effort: number, uplift: number) => ({
  label,
  interventions: [
    { factor_id: 'fac_effort', value: effort },
    { factor_id: 'fac_uplift', value: uplift },
  ],
});

function heldPending(): PendingAction {
  const out = dispatchAddOptionTransaction({
    parameters: {
      parent_decision_id: 'dec_choice',
      options: [option('Outsource', 0.55, 0.7), option('Hire in-house', 0.8, 0.6), option('Partner', 0.3, 0.2)],
    },
    currentGraph: GRAPH,
    currentGraphHash: HASH,
    freshness: 'none',
    mode: 'live',
    scenarioId: SCENARIO_ID,
    turnId: 'turn-propose',
    requestId: 'req-propose',
    stage: 'decide',
  });
  if (out.kind !== 'held') throw new Error(`fixture must hold, got ${out.kind}`);
  return out.pendingActions[0]!;
}

function payload(message: string): MessageTurnPayload {
  return { kind: 'message', source: 'composer', turn_id: `t-${randomUUID()}`, scenario_id: SCENARIO_ID, message, turn_class: 'decide', stage: 'analyse' };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on a deterministic GM held resume');
      }),
  };
}

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  appendCalls.length = 0;
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  _resetConfigCache();
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('(A) a multi-option hold confirmed through the real executor', () => {
  it('"yes" lands every option, its decision link and its values in ONE commit, with zero model calls', async () => {
    const pending = heldPending();
    expect((pending.action as unknown as { inline_patch: { operations: unknown[] } }).inline_patch.operations).toHaveLength(12);
    pendingActionsForRead = [pending];
    const adapter = throwingRoutingAdapter();

    await runTurnExecutor(payload('yes'), 'req-multi-confirm', { routingAdapter: adapter });

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(appendCalls).toHaveLength(1);
    const graph = appendCalls[0]!.graph as { nodes: Array<{ id: string; kind: string; label: string }>; edges: Array<{ from: string; to: string }> };
    const added = graph.nodes.filter((n) => n.kind === 'option' && n.id !== 'opt_stay');
    expect(added.map((n) => n.label).sort()).toEqual(['Hire in-house', 'Outsource', 'Partner']);
    for (const o of added) {
      expect(graph.edges.some((e) => e.from === 'dec_choice' && e.to === o.id)).toBe(true);
    }
    const persisted = (appendCalls[0]!.pending_actions ?? []) as ReadonlyArray<{ chip_id?: string }>;
    expect(persisted.some((p) => p.chip_id === pending.chip_id)).toBe(false);
  });

  it('CONTRAST: the same hold with its recorded cap stripped is declined — no graph write', async () => {
    const pending = heldPending();
    const ip = { ...(pending.action as { inline_patch: Record<string, unknown> }).inline_patch };
    delete ip.envelope_cap;
    pendingActionsForRead = [{ ...pending, action: { ...pending.action, inline_patch: ip } } as PendingAction];

    await runTurnExecutor(payload('yes'), 'req-multi-confirm-nocap', { routingAdapter: throwingRoutingAdapter() });

    expect(appendCalls.every((w) => w.graph === undefined || w.graph === null)).toBe(true);
  });
});
