/**
 * ROADMAP 2.918 — route-level pins for the baseline-elicitation loop, both
 * halves MOUNTED in the executor (trap 3b: a green unit suite is not evidence
 * the wiring exists):
 *
 *   EMIT — an add_constraint turn on the mintable-and-baseline-less cell must
 *   PERSIST the pending question in the same commit as the receipt that asks
 *   it. Driven through the typed-chip mutation route so the turn is fully
 *   deterministic (no LLM), which also proves the channel rides the ordinary
 *   handler-execute commit path, not a special one.
 *
 *   RESUME — with the pending question live and the graph unchanged, the
 *   bare answer "about 12%" must dispatch the add_constraint replay with ZERO
 *   LLM calls and commit the minted baseline on the named target.
 *   MUTATION-CHECK BY CONSTRUCTION (same doctrine as the typed-chip suite):
 *   the LLM adapter, if reached, returns a plain direct answer that commits
 *   nothing — so a green "baseline committed + adapter never called" pair
 *   flips RED if the pre-route wiring is reverted.
 *
 *   FAIL-CLOSED — a diverged graph hash must fall through SILENTLY to the
 *   normal flow (adapter called, nothing minted, no recovery copy).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { PendingAction } from '../session/pending-action.js';

const appendCalls: Array<Record<string, unknown>> = [];
let mockedPendingActions: ReadonlyArray<PendingAction> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockedPendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/**
 * A NON-ROOT outcome 'Churn rate' with no baseline; the persisted level-framed
 * '%' row rides `goal_constraints` (the RESUME fixtures' state-class — the ask
 * turn persists the row and the pending in one commit, so every answer turn
 * replays against a graph that carries both).
 */
function graphWithFramedRow(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      { id: 'f-quality', kind: 'factor', label: 'Product quality' },
      { id: 'o-churn-rate', kind: 'outcome', label: 'Churn rate' },
    ],
    edges: [
      {
        from: 'f-quality',
        to: 'o-churn-rate',
        strength: { mean: -0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
    ],
    goal_constraints: [
      {
        constraint_id: 'gc-live-1',
        node_id: 'o-churn-rate',
        operator: '<=',
        value: 10,
        label: 'Churn rate',
        provenance: 'explicit',
        unit: '%',
        value_frame: 'level',
      },
    ],
  } as unknown as GraphV3T;
}

/** Same graph, no persisted row — the EMIT fixture (first registration). */
function graphWithoutRow(): GraphV3T {
  const g = graphWithFramedRow();
  (g as { goal_constraints?: unknown[] }).goal_constraints = [];
  return g;
}

function elicitPending(graphHash: string, overrides?: Partial<PendingAction>): PendingAction {
  return {
    id: 'pa-elicit-route-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_elicit_target_baseline',
    action: {
      kind: 'elicit_target_baseline',
      target_id: 'o-churn-rate',
      target_label: 'Churn rate',
      constraint_type: 'at_most',
      value: 10,
      unit: '%',
      label: 'Churn rate',
    },
    preconditions: { graph_hash: graphHash },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-08T00:00:00.000Z',
    ...overrides,
  } as PendingAction;
}

function payload(message: string, extra?: Partial<MessageTurnPayload>): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message,
    ...extra,
  });
}

/** An adapter that, if reached, returns a mint-free direct answer. */
function directAnswerAdapter() {
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () => ({
      content: [{ type: 'text', text: 'Understood.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
      model: 'mock',
      latencyMs: 0,
    }));
  return { adapter: { chatWithTools }, chatWithTools };
}

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  mockedPendingActions = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('2.918 EMIT — the ask turn persists the pending question in the same commit', () => {
  it('typed add_constraint chip on the cell → question in the receipt, pending in the commit, zero LLM', async () => {
    const { adapter, chatWithTools } = directAnswerAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Keep churn rate under 10%.', {
        source: 'chip_click',
        chip: {
          action_type: 'add_constraint',
          parameters: { target_id: 'o-churn-rate', constraint_type: 'at_most', value: 10, unit: '%' },
        },
      } as Partial<MessageTurnPayload>),
      'req-2918-emit',
      { routingAdapter: adapter, graphState: graphWithoutRow() },
    );

    expect(telemetry.failure_type).toBeNull();
    expect(chatWithTools).not.toHaveBeenCalled();

    // The receipt asks the one question, naming the target.
    expect(response.assistant_text).toContain('Roughly what percentage is Churn rate at right now?');

    // The commit carries the pending question, hash-pinned to the committed graph.
    expect(appendCalls).toHaveLength(1);
    const pendings = (appendCalls[0]!.pending_actions ?? []) as PendingAction[];
    const elicit = pendings.filter((p) => p.action.kind === 'elicit_target_baseline');
    expect(elicit).toHaveLength(1);
    expect(elicit[0]!.action).toMatchObject({
      kind: 'elicit_target_baseline',
      target_id: 'o-churn-rate',
      target_label: 'Churn rate',
      constraint_type: 'at_most',
      value: 10,
      unit: '%',
    });
    const persistedHash = elicit[0]!.preconditions.graph_hash;
    expect(typeof persistedHash).toBe('string');
    expect((persistedHash as string).length).toBeGreaterThan(0);
    // Hash-pinned to the COMMITTED (post-mutation) graph, so the answer-turn
    // resume's divergence gate reads the right baseline.
    expect(persistedHash).toBe(
      computeAnalysisAffectingGraphHash(appendCalls[0]!.graph as never),
    );
  });

  it('CONTROL — a minting turn (level stated) persists NO pending question', async () => {
    const { adapter } = directAnswerAdapter();
    await runTurnExecutor(
      payload('Churn rate is 12% today. Keep churn rate under 10%.', {
        source: 'chip_click',
        chip: {
          action_type: 'add_constraint',
          parameters: { target_id: 'o-churn-rate', constraint_type: 'at_most', value: 10, unit: '%' },
        },
      } as Partial<MessageTurnPayload>),
      'req-2918-emit-control',
      { routingAdapter: adapter, graphState: graphWithoutRow() },
    );
    const pendings = (appendCalls[0]!.pending_actions ?? []) as PendingAction[];
    expect(pendings.filter((p) => p.action.kind === 'elicit_target_baseline')).toHaveLength(0);
    // And the mint landed instead.
    const committed = appendCalls[0]!.graph as GraphV3T;
    expect(committed.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline).toBe(
      0.12,
    );
  });
});

describe('2.918 RESUME — the bare answer dispatches the replay with zero LLM calls', () => {
  it('"about 12%" against the live question mints the baseline on the named target', async () => {
    const graph = graphWithFramedRow();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [elicitPending(liveHash)];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { response, telemetry } = await runTurnExecutor(
      payload('about 12%'),
      'req-2918-resume',
      { routingAdapter: adapter, graphState: graph },
    );

    expect(telemetry.failure_type).toBeNull();
    // ZERO LLM calls — the pre-route claimed the turn.
    expect(chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.llm_calls_used).toBe(0);

    // The committed graph carries the minted baseline, on the named target only.
    expect(appendCalls).toHaveLength(1);
    const committed = appendCalls[0]!.graph as GraphV3T;
    const target = committed.nodes.find((n) => n.id === 'o-churn-rate');
    expect(target?.observed_state?.baseline).toBe(0.12);
    expect(target?.observed_state?.unit).toBe('fraction');
    expect(target?.observed_state?.cap).toBe(1);
    for (const n of committed.nodes) {
      if (n.id === 'o-churn-rate') continue;
      expect(n.observed_state?.baseline).toBeUndefined();
    }

    // The receipt confirms the noted level; no re-ask.
    expect(response.assistant_text).toContain('Noted Churn rate is currently at 12%.');
    expect(response.assistant_text).not.toContain('Roughly what percentage');

    // The answered question was CONSUMED — it does not carry forward.
    const persistedPendings = (appendCalls[0]!.pending_actions ?? []) as PendingAction[];
    expect(
      persistedPendings.filter((p) => p.action.kind === 'elicit_target_baseline'),
    ).toHaveLength(0);

    // Telemetry: the pending was matched.
    const matched = events.filter(
      (e) =>
        e.event === 'v5.pending_action.matched' &&
        e.data['kind'] === 'elicit_target_baseline',
    );
    expect(matched.length).toBeGreaterThanOrEqual(1);
  });

  it('FAIL-CLOSED — a diverged graph hash falls through silently to the normal flow', async () => {
    const graph = graphWithFramedRow();
    mockedPendingActions = [elicitPending('sha256:something-else-entirely')];
    const { adapter, chatWithTools } = directAnswerAdapter();

    const { response } = await runTurnExecutor(payload('about 12%'), 'req-2918-diverged', {
      routingAdapter: adapter,
      graphState: graph,
    });

    // The turn reached the ordinary LLM path; nothing was minted.
    expect(chatWithTools).toHaveBeenCalled();
    const committedGraphs = appendCalls
      .map((c) => c.graph as GraphV3T | undefined)
      .filter((g): g is GraphV3T => g != null);
    for (const g of committedGraphs) {
      expect(g.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline).toBeUndefined();
    }
    // Silent lapse: no recovery copy about expiry or divergence.
    expect(response.assistant_text).not.toContain('lapsed');
    expect(response.assistant_text).not.toContain('has changed since');
  });

  it('FAIL-CLOSED — no live question means "about 12%" is just a message for the LLM', async () => {
    const graph = graphWithFramedRow();
    mockedPendingActions = [];
    const { adapter, chatWithTools } = directAnswerAdapter();

    await runTurnExecutor(payload('about 12%'), 'req-2918-nopending', {
      routingAdapter: adapter,
      graphState: graph,
    });

    expect(chatWithTools).toHaveBeenCalled();
    const committedGraphs = appendCalls
      .map((c) => c.graph as GraphV3T | undefined)
      .filter((g): g is GraphV3T => g != null);
    for (const g of committedGraphs) {
      expect(g.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline).toBeUndefined();
    }
  });
});
