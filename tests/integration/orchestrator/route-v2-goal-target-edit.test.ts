/**
 * `goal_target_edit` (schemas 0.59.0) — route-level tests for the STRUCTURED
 * success-target edit, written RED-first.
 *
 * WHAT IS BEING CLOSED. The Canvas success-target control sends a MESSAGE turn
 * carrying a typed `add_constraint` chip, and the conventional route writes it
 * deterministically (`turn-executor.ts` typed-chip route, zero LLM). The OpenAI
 * Agent lane forwards system events verbatim to this route but has no path for
 * a goal-target write at all. `goal_target_edit` is the id-addressed, typed
 * system event that gives it one — and it must write EXACTLY what the
 * conventional path writes, through the SAME handler, or the two lanes start
 * to disagree about what a success target is.
 *
 * ⭐ THE PARITY TEST (b) IS THE LOAD-BEARING ONE. It drives BOTH paths over the
 * same persisted graph and compares the stored goal node and `goal_constraints`
 * FIELD BY FIELD. The chat path is driven with the exact sentence the UI sends
 * (`manualGoalTargetMessage`, DecisionGuideAI `src/canvas/conversation/
 * manualGoalTarget.ts` at staging `bfb2d0b2`), because that sentence is what
 * attests the row's `value_frame: 'level'` on the chat path. A structured event
 * has no sentence, so the writer must supply the same attestation another way;
 * if it does not, the row lands unframed and (b) REDs on `value_frame`.
 *
 * Every assertion binds by IDENTITY — the goal node id, the persisted
 * constraint id, the exact bytes handed to the atomic append and the hash of
 * those bytes — never a value predicate another object could satisfy.
 *
 * NO PROVIDER. The LLM router, the Anthropic transport the post-commit rolling
 * summariser would reach (`commit.ts`, `chatWithAnthropic`) and global `fetch`
 * are all mocked and asserted uncalled after EVERY case (see `afterEach`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { GraphStaleWriteError } from '../../../src/orchestrator-v5/session/store.js';
import { resolveGoalThresholdCapWithProvenance } from '../../../src/utils/goal-threshold-cap.js';

const GOAL_ID = 'g-revenue';
const EXISTING_ROW_ID = 'gc-revenue-target';

// ── the persisted model ────────────────────────────────────────────────────
// The witnessed goal shape: a £250,000 success target whose cap was derived by
// the headroom rule (250000 × 1.25 = 312500 → goal_threshold 0.8), registered
// through BOTH channels (node fields + a level-framed `>=` row).
function buildPersistedGraph() {
  return {
    goal_node_id: GOAL_ID,
    nodes: [
      {
        id: GOAL_ID,
        kind: 'goal',
        label: 'Revenue',
        goal_threshold: 0.8,
        goal_threshold_raw: 250000,
        goal_threshold_unit: '£',
        goal_threshold_cap: 312500,
        goal_threshold_cap_provenance: 'target_derived_headroom',
        goal_threshold_frame: 'level',
      },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
        // A field `NodeV3` does NOT declare (the V1 quantity carrier). The goal
        // write must not strip it from a node it never touched.
        data: { unit: '£' },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
    ],
    edges: [
      {
        from: 'f-budget',
        to: GOAL_ID,
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
    goal_constraints: [
      {
        constraint_id: EXISTING_ROW_ID,
        node_id: GOAL_ID,
        operator: '>=',
        value: 250000,
        label: 'Revenue',
        provenance: 'explicit',
        unit: '£',
        value_frame: 'level',
      },
    ],
  };
}

const appendMock = vi.fn();
const readRecentMock = vi.fn();
const readFactsForMock = vi.fn();
let persisted: unknown = buildPersistedGraph();

/**
 * WRITE-THROUGH: a resolved graph-bearing append becomes the persisted graph,
 * so "nothing of ours was stored" is observable on the store itself, not only
 * inferred from the mock's call list.
 */
function installWriteThroughAppend() {
  appendMock.mockImplementation(async (write: { graph?: unknown }) => {
    if (write.graph !== undefined && write.graph !== null) persisted = write.graph;
    return { id: 'mock-row-id' };
  });
}

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: readRecentMock,
    readFactsFor: readFactsForMock,
    // The writer's reply freshness reads the DURABLE run-fact record and the restore marker, as every
    // system-event writer does (shared `deriveWriteReplyFreshness`). A complete, empty record is the honest
    // "never run" — without it the read is degraded and the reply says `unknown`, not `none`.
    readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
    readAnalysisInvalidatedAt: async () => null,
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// Every LLM adapter the router can hand out. Asserted uncalled after every case.
const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

// The Anthropic transport the post-commit rolling summariser calls
// (`rolling-summary/summariser.ts` → `chatWithAnthropic`). Identity-bound probe
// for the one Anthropic call site every commit can reach.
const anthropicTransportMock = vi.fn(async () => {
  throw new Error('Anthropic transport is forbidden in this suite');
});
vi.mock('../../../src/adapters/llm/anthropic.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/adapters/llm/anthropic.js')>();
  return { ...original, chatWithAnthropic: anthropicTransportMock };
});

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { runTurnExecutor } = await import('../../../src/orchestrator-v5/turn-executor.js');

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID_BASE = '44444444-4444-4444-8444-4444444444';

type Json = Record<string, unknown>;
type GoalRow = Record<string, unknown>;

function currentHash(): string {
  const h = computeAnalysisAffectingGraphHash(buildPersistedGraph() as never);
  if (typeof h !== 'string') throw new Error('fixture must hash');
  return h;
}

function payloadFor(event: Json, suffix: string) {
  return {
    kind: 'system_event',
    turn_id: `${TURN_ID_BASE}${suffix.padStart(2, '0')}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  };
}

function goalEvent(overrides: Json = {}): Json {
  return {
    kind: 'goal_target_edit',
    goal_node_id: GOAL_ID,
    constraint_type: 'at_least',
    raw_value: 300000,
    unit: '£',
    base_graph_hash: currentHash(),
    ...overrides,
  };
}

/** The exact write object the commit handed the store, or undefined. */
function lastAppend(): (Json & { graph?: Json }) | undefined {
  return appendMock.mock.calls.at(-1)?.[0] as (Json & { graph?: Json }) | undefined;
}

function nodeById(graph: unknown, id: string): Json | undefined {
  const nodes = ((graph as { nodes?: unknown[] } | undefined)?.nodes ?? []) as Json[];
  return nodes.find((n) => n.id === id);
}

function rowsFor(graph: unknown, nodeId: string): GoalRow[] {
  const rows = ((graph as { goal_constraints?: unknown[] } | undefined)?.goal_constraints ?? []) as GoalRow[];
  return rows.filter((r) => r.node_id === nodeId);
}

/** The goal node's target channel — every field `add_constraint` owns on it. */
const GOAL_TARGET_FIELDS = [
  'goal_threshold',
  'goal_threshold_raw',
  'goal_threshold_unit',
  'goal_threshold_cap',
  'goal_threshold_cap_provenance',
  'goal_threshold_frame',
  'observed_state',
] as const;

function goalTargetChannel(graph: unknown): Json {
  const goal = nodeById(graph, GOAL_ID) ?? {};
  return Object.fromEntries(GOAL_TARGET_FIELDS.map((f) => [f, goal[f]]));
}

function successfulRunFact(graphHash: string) {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'o-launch',
      summary: 'Analysis completed.',
      graph_hash_at_run: graphHash,
      computed_at: '2026-09-24T10:00:00.000Z',
      enrichment: { analysis_status: 'computed' },
    },
  };
}

/** The sentence the UI sends today (`manualGoalTargetMessage`, verbatim grammar). */
function manualGoalTargetMessage(value: number, unit: string, direction: 'at_least' | 'at_most'): string {
  const number = value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 });
  const amount = /^[£$€]$/.test(unit) ? `${unit}${number}` : unit === '%' ? `${number}%` : `${number} ${unit}`;
  const bound = direction === 'at_least' ? 'at least' : 'at most';
  return `This goal must be ${bound} ${amount}. This is an absolute level, not a change from the current level.`;
}

describe('POST /orchestrate/v2/turn — goal_target_edit (the structured success-target edit)', () => {
  let app: FastifyInstance;
  let fetchSpy: MockInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockReset();
    installWriteThroughAppend();
    readRecentMock.mockReset();
    readRecentMock.mockResolvedValue([]);
    readFactsForMock.mockReset();
    readFactsForMock.mockResolvedValue([]);
    llmChatMock.mockClear();
    anthropicTransportMock.mockClear();
    persisted = buildPersistedGraph();
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network is forbidden in this suite'));
  });

  // (i) NO PROVIDER — asserted after EVERY case, so no case can pass while a
  // provider (or any network) was reached underneath it.
  afterEach(() => {
    expect(llmChatMock, 'an LLM adapter was reached').not.toHaveBeenCalled();
    expect(anthropicTransportMock, 'the Anthropic transport was reached').not.toHaveBeenCalled();
    expect(fetchSpy, 'global fetch was reached').not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  async function post(event: Json, suffix: string) {
    return app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payloadFor(event, suffix) });
  }

  // ── (a) at_least: the write, the reply, and that they describe the same bytes

  it('(a) at_least 300000 on a £250,000 goal writes raw, unit, the handler-derived cap, raw/cap and the row', async () => {
    const res = await post(goalEvent(), '1');

    expect(res.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    const write = lastAppend()!;
    const graph = write.graph;
    expect(graph, 'the atomic append must carry a graph').toBeDefined();

    // The cap is derived by the SAME function add_constraint uses — and the
    // precondition is pinned so a fixture drift cannot hide behind it.
    const expected = resolveGoalThresholdCapWithProvenance(312500, 300000, '£', '£');
    expect(expected).toEqual({ cap: 312500, provenance: 'inherited' });

    const goal = nodeById(graph, GOAL_ID)!;
    expect(goal.goal_threshold_raw).toBe(300000);
    expect(goal.goal_threshold_unit).toBe('£');
    expect(goal.goal_threshold_cap).toBe(expected!.cap);
    expect(goal.goal_threshold_cap_provenance).toBe(expected!.provenance);
    expect(goal.goal_threshold).toBe(300000 / expected!.cap);
    expect(goal.goal_threshold_frame).toBe('level');

    // The row is UPDATED IN PLACE (same constraint id), never a second `>=` row.
    expect(rowsFor(graph, GOAL_ID)).toEqual([
      {
        constraint_id: EXISTING_ROW_ID,
        node_id: GOAL_ID,
        operator: '>=',
        value: 300000,
        label: 'Revenue',
        provenance: 'explicit',
        unit: '£',
        value_frame: 'level',
      },
    ]);
    // Canonical top-level state survives the mutation (the persisted-base re-merge).
    expect(graph!.goal_node_id).toBe(GOAL_ID);
    // The nodes the edit did not target keep every field `NodeV3` declares.
    // (The undeclared `data` carrier is dropped by the SHARED D1 mutation
    // helper's GraphV3 parse on every D1 write — identically on the chat path,
    // which the node-array parity assertions in (b) pin.)
    const budgetBefore = nodeById(buildPersistedGraph(), 'f-budget')!;
    const budgetAfter = nodeById(graph, 'f-budget')!;
    expect(budgetAfter.observed_state).toEqual(budgetBefore.observed_state);
    expect(budgetAfter.label).toBe(budgetBefore.label);
    expect(nodeById(graph, 'o-launch')).toEqual(nodeById(buildPersistedGraph(), 'o-launch'));

    // The append records the REAL handler, not an anonymous direct answer.
    expect(write.turn_class).toBe('handler');
    expect(write.handler_id).toBe('add_constraint');
    expect(write.llm_calls_used).toBe(0);
    const facts = write.handler_facts as Array<{ fact_type: string; result: Json }>;
    expect(facts).toHaveLength(1);
    expect(facts[0]!.fact_type).toBe('add_constraint');
    expect(facts[0]!.result.status).toBe('applied');
    expect(facts[0]!.result.target_id).toBe(EXISTING_ROW_ID);

    // ── the reply describes the APPENDED bytes
    const body = JSON.parse(res.body);
    const appendedHash = computeAnalysisAffectingGraphHash(graph as never);
    expect(body.graph_hash).toBe(appendedHash);
    expect(body.graph_hash).not.toBe(currentHash());

    expect(body.draft_graph, 'the committed postimage must ride the reply').toBeDefined();
    expect(goalTargetChannel(body.draft_graph)).toEqual(goalTargetChannel(graph));

    const patch = (body.blocks as Json[]).find((b) => b.type === 'graph_patch');
    expect(patch, 'the reply must carry the handler receipt block').toBeDefined();
    expect(patch!.operation).toBe('add_constraint');
    expect(patch!.status).toBe('applied');
    expect(patch!.target_id).toBe(EXISTING_ROW_ID);
    expect((patch!.after as Json).node_id).toBe(GOAL_ID);
    expect((patch!.after as Json).value).toBe(300000);

    // No prior run in this fixture ⇒ `none` — the contrast for case (h).
    expect(body.analysis_ready).toBeDefined();
    expect(body.analysis_ready.freshness).toBe('none');
  });

  // ── (b) PARITY with the existing deterministic typed-chip add_constraint path

  async function runChatPath(direction: 'at_least' | 'at_most', value: number, suffix: string) {
    const chatWithTools = vi.fn();
    await runTurnExecutor(
      {
        kind: 'message',
        source: 'chip_click',
        turn_class: 'frame',
        stage: 'analyse',
        turn_id: `${TURN_ID_BASE}${suffix}`,
        scenario_id: SCENARIO_ID,
        message: manualGoalTargetMessage(value, '£', direction),
        chip: {
          action_type: 'add_constraint',
          parameters: { target_id: GOAL_ID, constraint_type: direction, value, unit: '£' },
        },
      } as never,
      `req-gte-parity-${suffix}`,
      { routingAdapter: { chatWithTools } as never, graphState: buildPersistedGraph() as never },
    );
    // Precondition pinned in-test: the chat path really took the deterministic
    // typed-chip route through add_constraint, with no model call.
    expect(chatWithTools).not.toHaveBeenCalled();
    const write = lastAppend()!;
    expect(write.handler_id).toBe('add_constraint');
    expect(write.graph).toBeDefined();
    return write.graph!;
  }

  it('(b) PARITY — at_least stores exactly what the typed-chip add_constraint path stores', async () => {
    const res = await post(goalEvent(), '2');
    expect(res.statusCode).toBe(200);
    const eventGraph = lastAppend()!.graph!;

    persisted = buildPersistedGraph();
    appendMock.mockClear();
    const chatGraph = await runChatPath('at_least', 300000, '92');

    expect(goalTargetChannel(eventGraph)).toEqual(goalTargetChannel(chatGraph));
    expect(rowsFor(eventGraph, GOAL_ID)).toEqual(rowsFor(chatGraph, GOAL_ID));
    // Whole node arrays, not only the goal: the two paths must treat every
    // node — including the fixture's undeclared `data` field — identically.
    expect(eventGraph.nodes).toEqual(chatGraph.nodes);
    // Row identity is preserved on both paths, so the WHOLE analysis-affecting
    // projection must agree, not only the fields listed above.
    expect(computeAnalysisAffectingGraphHash(eventGraph as never)).toBe(
      computeAnalysisAffectingGraphHash(chatGraph as never),
    );
  });

  it('(b) PARITY — at_most stores exactly what the typed-chip add_constraint path stores', async () => {
    const res = await post(goalEvent({ constraint_type: 'at_most', raw_value: 400000 }), '3');
    expect(res.statusCode).toBe(200);
    const eventGraph = lastAppend()!.graph!;

    persisted = buildPersistedGraph();
    appendMock.mockClear();
    const chatGraph = await runChatPath('at_most', 400000, '93');

    expect(goalTargetChannel(eventGraph)).toEqual(goalTargetChannel(chatGraph));
    expect(eventGraph.nodes).toEqual(chatGraph.nodes);

    // ⚠⚠ ONE MEASURED DIVERGENCE, PINNED RATHER THAN COPIED — `value_frame`.
    //
    // The chat path attests the row's frame from the UI's SENTENCE, via
    // `deriveStatedConstraintFrame`. Measured at this tip (57f903c4, probe log
    // `gte-artifacts/cee-frame-probe.log`): the compound-goal extractor parses
    // "This goal must be at least £300000. …" (→ 'level') but returns NO
    // constraint at all for "This goal must be at most £400000. …", so the
    // chat path's `<=` goal row lands UNFRAMED — despite the sentence saying,
    // in words, "This is an absolute level". The UI's own comment
    // (manualGoalTarget.ts: "Our at_most sentence was witnessed yielding
    // value_frame: 'level'", CEE dcebc360) does not hold at this tip for £.
    //
    // The structured event does NOT reproduce that gap: its contract DECLARES
    // `raw_value` an absolute level for BOTH directions, so it relays 'level'.
    // Copying the chat path's miss would make the new writer wrong on purpose.
    // So every OTHER field must agree, and the divergence itself is asserted —
    // if the chat path's extractor is fixed, the second assertion below REDs
    // and this pin must be revisited (and should collapse to full equality).
    const normalise = (rows: GoalRow[]) =>
      rows.map((r) => {
        if (r.operator !== '<=') return r;
        const { value_frame: _frame, ...rest } = r;
        return { ...rest, constraint_id: '<fresh>' };
      });
    expect(normalise(rowsFor(eventGraph, GOAL_ID))).toEqual(normalise(rowsFor(chatGraph, GOAL_ID)));
    const eventRow = rowsFor(eventGraph, GOAL_ID).find((r) => r.operator === '<=')!;
    const chatRow = rowsFor(chatGraph, GOAL_ID).find((r) => r.operator === '<=')!;
    expect(eventRow.value_frame).toBe('level');
    expect(chatRow.value_frame).toBeUndefined();
  });

  // ── (c) at_most: the row only, never the success threshold

  it('(c) at_most writes ONLY a `<=` row — the goal threshold channel is untouched', async () => {
    const res = await post(goalEvent({ constraint_type: 'at_most', raw_value: 400000 }), '4');
    expect(res.statusCode).toBe(200);
    const graph = lastAppend()!.graph!;

    // Byte-identical to the persisted channel: at_most never stamps a threshold.
    expect(goalTargetChannel(graph)).toEqual(goalTargetChannel(buildPersistedGraph()));

    const rows = rowsFor(graph, GOAL_ID);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.constraint_id === EXISTING_ROW_ID)).toEqual(
      buildPersistedGraph().goal_constraints[0],
    );
    const added = rows.find((r) => r.operator === '<=')!;
    expect(added).toMatchObject({
      node_id: GOAL_ID,
      operator: '<=',
      value: 400000,
      unit: '£',
      label: 'Revenue',
      provenance: 'explicit',
      value_frame: 'level',
    });
    expect(added.constraint_id).not.toBe(EXISTING_ROW_ID);
  });

  // ── (d) the stale gate

  it('(d) a stale base_graph_hash is a typed 409 GRAPH_DIVERGED and appends NOTHING', async () => {
    const res = await post(goalEvent({ base_graph_hash: 'deadbeefdeadbeef' }), '5');

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(body.details?.failure_type).toBe('GRAPH_DIVERGED');
    expect(body.details?.conflict_category).toBe('BASE_HASH_DIVERGED');
    expect(body.details?.recovery_action).toBe('refresh_and_reconfirm');
    expect(body.details?.retryable).toBe(false);
    expect(body.details?.expected_base_graph_hash).toBe(currentHash());
    expect(body.details?.event_kind).toBe('goal_target_edit');

    expect(appendMock).not.toHaveBeenCalled();
    expect(persisted).toEqual(buildPersistedGraph());
  });

  // ── (e) the atomic CAS race

  it('(e) an atomic CAS conflict after the base read is a typed 409, not a 500, and stores nothing of ours', async () => {
    const IDENTITY_SENTINEL = 'f'.repeat(64);
    appendMock.mockRejectedValueOnce(
      new GraphStaleWriteError('simulated OLGC1 atomic CAS conflict', {
        conflict_category: 'rpc_cas_conflict',
        expected_base_graph_hash: IDENTITY_SENTINEL,
      }),
    );

    // A VALID base hash, so the request clears the T0 gate and reaches the store.
    const res = await post(goalEvent(), '6');
    expect(appendMock).toHaveBeenCalledTimes(1);

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(body.details?.conflict_category).toBe('rpc_cas_conflict');
    expect(body.details?.recovery_action).toBe('refresh_and_reconfirm');
    // Analysis space, from a FRESH read — never the identity hash the error carries.
    expect(body.details?.expected_base_graph_hash).toBe(currentHash());
    expect(body.details?.expected_base_graph_hash).not.toBe(IDENTITY_SENTINEL);
    expect(body.blocks).toBeUndefined();
    expect(body.graph_hash).toBeUndefined();

    expect(persisted).toEqual(buildPersistedGraph());
  });

  // ── (f) refusals

  it.each([
    ['an unknown goal_node_id', 'g-does-not-exist', '7'],
    ['a non-goal node id (a factor)', 'f-budget', '8'],
    ['a non-goal node id (an option)', 'o-launch', '9'],
  ])('(f) %s is REFUSED — nothing appended, no receipt, no graph', async (_label, id, suffix) => {
    const res = await post(goalEvent({ goal_node_id: id }), suffix);

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.details?.reason).toBe('system_event_refused_no_write');
    expect(body.details?.event_kind).toBe('goal_target_edit');
    expect(body.details?.retryable).toBe(false);
    expect(body.blocks).toBeUndefined();
    expect(body.draft_graph).toBeUndefined();
    expect(body.graph_hash).toBeUndefined();

    expect(appendMock).not.toHaveBeenCalled();
    expect(persisted).toEqual(buildPersistedGraph());
  });

  // ── (g) ingress

  it.each([
    ['negative', -5, '10'],
    ['a small negative', -0.5, '11'],
  ])('(g) raw_value %s is rejected at ingress (422), never half-applied', async (_label, raw, suffix) => {
    const res = await post(goalEvent({ raw_value: raw }), suffix);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(appendMock).not.toHaveBeenCalled();
    expect(persisted).toEqual(buildPersistedGraph());
  });

  // Zero is a meaningful `at_most` level ("at most 0 defects"; Codex, #63
  // 5821693599). The 0.59.0 contract admits it; the SERVER decides by direction.
  it('(g0) at_most 0 COMMITS: the stored `<=` row reads back value 0, the threshold channel untouched', async () => {
    const res = await post(goalEvent({ constraint_type: 'at_most', raw_value: 0 }), '16');
    expect(res.statusCode).toBe(200);
    const graph = lastAppend()!.graph!;
    expect(goalTargetChannel(graph)).toEqual(goalTargetChannel(buildPersistedGraph()));
    const added = rowsFor(graph, GOAL_ID).find((r) => r.operator === '<=');
    expect(added).toMatchObject({ node_id: GOAL_ID, operator: '<=', value: 0, unit: '£', value_frame: 'level' });
    // Readback: the reply's hash is the hash of exactly these bytes.
    expect(JSON.parse(res.body).graph_hash).toBe(computeAnalysisAffectingGraphHash(graph as never));
  });

  it('(g0) at_least 0 is REFUSED by the server — "at least nothing" is not a success target — nothing appended', async () => {
    const res = await post(goalEvent({ constraint_type: 'at_least', raw_value: 0 }), '17');
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.details?.reason).toBe('system_event_refused_no_write');
    expect(body.details?.event_kind).toBe('goal_target_edit');
    expect(body.blocks).toBeUndefined();
    expect(body.draft_graph).toBeUndefined();
    expect(body.graph_hash).toBeUndefined();
    expect(appendMock).not.toHaveBeenCalled();
    expect(persisted).toEqual(buildPersistedGraph());
  });

  // ── (h) freshness

  it('(h) a prior successful run on the PRE-edit hash makes the reply freshness `stale`', async () => {
    readRecentMock.mockResolvedValue([{ id: 'prior-run-row' }]);
    readFactsForMock.mockResolvedValue([successfulRunFact(currentHash())]);

    const res = await post(goalEvent(), '12');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const appendedHash = computeAnalysisAffectingGraphHash(lastAppend()!.graph as never);

    expect(body.analysis_ready).toMatchObject({
      freshness: 'stale',
      freshness_reason: 'graph_hash_diverged',
      computed_at: '2026-09-24T10:00:00.000Z',
    });
    expect(body.graph_hash).toBe(appendedHash);
  });

  // ── (i) no provider, stated as its own case (also enforced in afterEach)

  it('(i) the whole family — write, stale, refusal — reaches no LLM, no Anthropic transport and no network', async () => {
    await post(goalEvent(), '13');
    await post(goalEvent({ base_graph_hash: 'deadbeefdeadbeef' }), '14');
    await post(goalEvent({ goal_node_id: 'f-budget' }), '15');
    expect(llmChatMock).not.toHaveBeenCalled();
    expect(anthropicTransportMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
