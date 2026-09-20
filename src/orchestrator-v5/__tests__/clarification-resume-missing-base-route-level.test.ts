/**
 * ROADMAP 2.1426 — route-level wiring for the missing-baseline clarify.
 *
 * Measured on served `a3d9b95` (3/3): asking for a relative change on a
 * factor with no current value produced "which factor?", then, once answered,
 * a `delta_no_existing_value` refusal. The refusal is CORRECT — the
 * arithmetic has an operand missing — but the product never asked the one
 * question that would have made the request answerable.
 *
 * This pins the wire shape of the replacement: no LLM call, the held target
 * and quantity restated so the user need not retype them, and an offer that
 * is EXECUTABLE rather than merely true. The reachability of that offer is
 * pinned separately, against the predicate that decides it, in
 * `routing/__tests__/clarification-resume-missing-base.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO_ID = randomUUID();
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
    // Durable analysis authority (reconcile-scenario-analysis-facts.ts) matches
    // hot facts to their persisted identity BY REFERENCE, so the with-turn read
    // must return THE SAME fact objects, each carrying fact_row_id AND
    // fact_created_at. Omitting either leaves the identified count at 0, which
    // is indistinguishable from omitting the method. A store with no
    // readScenarioRunAnalysisFactsFor reads as durable_unavailable, so freshness
    // degrades to 'unknown' even when there are no analysis facts at all.
    readFactsWithTurnFor: async () =>
      (await import('./helpers/durable-analysis-store-double.js')).hotFactsWithTurn(
        [],
        'test-prior-turn-row',
      ),
    readScenarioRunAnalysisFactsFor: async (scenarioId: string) =>
      (await import('./helpers/durable-analysis-store-double.js')).durableAnalysisPage(
        [],
        scenarioId,
      ),
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
const { computeAnalysisAffectingGraphHash } = await import(
  '../context/graph-hash.js'
);

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'clarify',
    stage: 'analyse',
  });
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when the resumer claims the turn');
      }),
  };
}

const BASE_NODES = [
  { id: 'goal_g', kind: 'goal', label: 'Goal' },
  { id: 'dec_d', kind: 'decision', label: 'Decision' },
  { id: 'opt_a', kind: 'option', label: 'Option A' },
];
const BASE_EDGES = [
  {
    from: 'dec_d',
    to: 'opt_a',
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  },
  {
    from: 'opt_a',
    to: 'goal_g',
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  },
];

/** The measured case: a factor carrying NO `observed_state` block at all. */
const NO_BASE_GRAPH = {
  nodes: [
    ...BASE_NODES,
    { id: 'f_eng_time', kind: 'factor', label: 'Engineering Time Commitment' },
  ],
  edges: BASE_EDGES,
};

/** The contrast: the same factor, same labels, WITH a recorded value. */
const WITH_BASE_GRAPH = {
  nodes: [
    ...BASE_NODES,
    {
      id: 'f_eng_time',
      kind: 'factor',
      label: 'Engineering Time Commitment',
      observed_state: { value: 0.4, raw_value: 40, unit: '%' },
    },
  ],
  edges: BASE_EDGES,
};

function seedIncreasePending(graph: unknown): PendingAction {
  const hash = computeAnalysisAffectingGraphHash(graph as never);
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_clarify_factor_0',
    action: {
      kind: 'set_factor_value',
      factor_id: 'f_eng_time',
      value: 10,
      unit: '%',
      operator: 'increase',
    },
    preconditions: {
      target_entity_ids: ['f_eng_time'],
      ...(hash != null ? { graph_hash: hash } : {}),
    },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-05-05T00:00:00.000Z',
  };
}

describe('ROADMAP 2.1426 — missing-baseline clarify, route level', () => {
  beforeEach(() => {
    appendCalls.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('answers the held delta on a value-less factor with an answerable question, not a refusal — no LLM call', async () => {
    mockedPendingActions = [seedIncreasePending(NO_BASE_GRAPH)];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      payload('Engineering Time Commitment'),
      'req-missing-base',
      { routingAdapter: adapter, graphState: NO_BASE_GRAPH as never },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);
    expect(result.telemetry.commit_performed).toBe(true);

    const text = result.response.assistant_text;
    // The user must not have to retype either half of the request: the
    // resolved TARGET and the held QUANTITY are both restated.
    expect(text).toContain('Engineering Time Commitment');
    expect(text).toContain('10%');
    expect(text).toMatch(/increase/i);
    // The offer, and it is the load-bearing sentence: an ABSOLUTE value,
    // which `set` can always accept on a factor with no recorded state.
    expect(text).toMatch(/should be/i);
    // It must NOT be the dead-end refusal it replaces.
    expect(text).not.toMatch(/no recorded current value to adjust from/i);
    // House rules for deterministic copy: British English, no em dash, no
    // internal vocabulary at the wire.
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/skip_reason|operator|factor_id|observed_state|raw_value/i);
  });

  it('RE-EMITS no pending of its own — the held delta is only carried forward, with its turn TTL spent', async () => {
    // The discriminator, and it is why this asserts a TTL rather than an
    // absence: the recovery arm re-emitting nothing does NOT make the held
    // pending vanish. `commitTurn`'s Signature-Loop carry-forward
    // (`computeSurvivingPriorPendingsDetailed`) keeps a still-valid proposal
    // alive across a non-consuming turn and DECREMENTS its turn TTL. So a
    // re-emission and a carry-forward both leave one `set_factor_value` on
    // the row, and only the TTL tells them apart: the ambiguity arm stamps a
    // FRESH `PENDING_ACTION_DEFAULT_TURN_TTL` on what it re-emits, while a
    // carried pending arrives with one life spent.
    const seeded = seedIncreasePending(NO_BASE_GRAPH);
    expect(seeded.expires_at_turn_count).toBe(2);
    mockedPendingActions = [seeded];

    await runTurnExecutor(
      payload('Engineering Time Commitment'),
      'req-missing-base-persist',
      { routingAdapter: throwingRoutingAdapter(), graphState: NO_BASE_GRAPH as never },
    );

    expect(appendCalls.length).toBeGreaterThan(0);
    const write = appendCalls[0]! as {
      pending_actions?: ReadonlyArray<{
        action: { kind: string; operator?: string };
        expires_at_turn_count: number;
      }>;
    };
    const held = (write.pending_actions ?? []).filter(
      (pa) => pa.action.kind === 'set_factor_value',
    );
    expect(held).toHaveLength(1);
    // Carried, not re-emitted: one turn of TTL spent, never re-stamped.
    expect(held[0]!.expires_at_turn_count).toBe(1);
    expect(held[0]!.action.operator).toBe('increase');
  });

  it('CONTRAST: the same reply on a factor that HAS a recorded value dispatches the delta exactly as before', async () => {
    mockedPendingActions = [seedIncreasePending(WITH_BASE_GRAPH)];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      payload('Engineering Time Commitment'),
      'req-with-base',
      { routingAdapter: adapter, graphState: WITH_BASE_GRAPH as never },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);
    // The proposal reached the lifecycle rather than a curated recovery: the
    // recovery arm composes its answer at `orient`/`compose` and never
    // validates, so the presence of `validate` is the discriminator between
    // the two paths on identical input.
    expect(result.telemetry.stages_completed).toContain('validate');
    expect(result.response.assistant_text ?? '').not.toMatch(
      /nothing for a 10% increase to work from/i,
    );
  });
});
