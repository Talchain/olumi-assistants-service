/**
 * P4 transport (lane evidence:
 * PHASE0-EVIDENCE-2026-07-28/lane-p4-transport-2026-08-05.md) — route-level
 * pins for the three human-judgement receipts.
 *
 * THE DEFECTS (verified at the bytes on staging ac62fd4d):
 *   · `feedback` — dispatch committed an EMPTY ack (`handler_facts: []`); the
 *     thumbs rating was hashed into `request_hash` and then DISCARDED. The UI
 *     has emitted the typed event since 0.22; the server threw its content away.
 *   · `edge_adjudication` / `prior_range_edit` — no wire kind existed at all
 *     until schemas 0.34.0; the human's contested-edge verdict and prior-range
 *     edit terminated in the browser.
 *
 * WHAT THIS FILE PINS:
 *   1. each of the three events commits a TYPED fact on its turn row
 *      (turn_class 'direct_answer', handler_id null — the edit_graph/DL-7 PR B
 *      precedent; facts on direct_answer turns ARE read back, the loader
 *      passes all prior-turn row ids);
 *   2. NO graph is written by any of the three (carry the signal, never touch
 *      the model — compute consequence is a separate Paul design call);
 *   3. R-004: the feedback comment TEXT never reaches the store — only
 *      comment_present does (with a positive control proving the leak scan
 *      can see);
 *   4. the 0.34.0 root cross-field rules actually run at CEE's pin (an
 *      overridden verdict with no value is a 422, not a quietly-lossy commit);
 *   5. value-less ack events (patch_dismissed) still commit EMPTY facts —
 *      byte-identical silent acknowledgement, reader-first compatibility;
 *   6. leak-4 lane A: a factor_value_edit's committed graph carries
 *      observed_state.source 'user_override' + provenance 'user_set' on the
 *      EDITED node (ROADMAP 2.396(b) — the set_factor_value writer now stamps
 *      the source, not just the transform-clobbered provenance).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { HandlerFactSchema } from '@talchain/schemas/orchestrator';

// ── persisted model (only factor_value_edit reads it) ───────────────────────
function buildPersistedGraph() {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
    ],
    edges: [
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  };
}

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
let persisted: unknown = buildPersistedGraph();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

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

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID_BASE = '11111111-1111-4111-8111-11111111111';
const RATED_TURN_ID = '33333333-3333-4333-8333-333333333333';

function payloadFor(event: Record<string, unknown>, suffix: string) {
  return {
    kind: 'system_event',
    turn_id: `${TURN_ID_BASE}${suffix}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  };
}

type AppendArg = {
  graph?: unknown;
  turn_class?: string;
  handler_id?: string | null;
  handler_facts?: Array<Record<string, unknown>>;
};

function lastAppend(): AppendArg {
  const call = appendMock.mock.calls.at(-1);
  return (call?.[0] ?? {}) as AppendArg;
}

describe('POST /orchestrate/v2/turn — human-judgement receipts (P4 transport)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockClear();
    llmChatMock.mockClear();
    persisted = buildPersistedGraph();
  });

  // ── 1. feedback — the rating PERSISTS ─────────────────────────────────────

  it('⭐ a thumbs rating commits a typed feedback fact — the empty-ack class is dead', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        {
          kind: 'feedback',
          rating: 'up',
          target: { id: RATED_TURN_ID, kind: 'turn' },
        },
        '0',
      ),
    });

    expect(res.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(llmChatMock).not.toHaveBeenCalled();

    const arg = lastAppend();
    // No graph write — this event carries a judgement, never a model change.
    expect(arg.graph == null).toBe(true);
    // The PR B precedent: direct_answer + null handler_id + a typed fact.
    expect(arg.turn_class).toBe('direct_answer');
    expect(arg.handler_id ?? null).toBeNull();

    expect(arg.handler_facts).toHaveLength(1);
    const fact = arg.handler_facts![0]!;
    // The fact parses against the CONTRACT, not a local shape.
    expect(HandlerFactSchema.safeParse(fact).success).toBe(true);
    // Identity-bound: the rated turn's OWN id, the exact rating.
    expect(fact).toMatchObject({
      fact_type: 'feedback',
      fact_version: 1,
      noop: false,
      result: {
        target_id: RATED_TURN_ID,
        target_kind: 'turn',
        rating: 'up',
        comment_present: false,
      },
    });
  });

  it('R-004 — the comment TEXT never reaches the store; only its presence does', async () => {
    const PII_COMMENT = 'my colleague jane.doe@example.com hated this';
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        {
          kind: 'feedback',
          rating: 'down',
          comment: PII_COMMENT,
          target: { id: RATED_TURN_ID, kind: 'turn' },
        },
        '1',
      ),
    });

    expect(res.statusCode).toBe(200);
    const arg = lastAppend();
    expect(arg.handler_facts).toHaveLength(1);
    expect(arg.handler_facts![0]).toMatchObject({
      result: { rating: 'down', comment_present: true },
    });

    // Leak scan over EVERYTHING handed to the store — with a positive control
    // (trap 13): the scan must be able to SEE a known-present value before its
    // absence claim counts.
    const persistedBytes = JSON.stringify(appendMock.mock.calls.at(-1));
    expect(persistedBytes).toContain('down'); // positive control
    expect(persistedBytes).not.toContain(PII_COMMENT);
    expect(persistedBytes).not.toContain('jane.doe');
  });

  // ── 2. edge_adjudication — the settled disagreement PERSISTS ──────────────

  it('⭐ an overridden adjudication commits a typed fact with the asserted value; no graph write', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        {
          kind: 'edge_adjudication',
          from: 'f-budget',
          to: 'g-revenue',
          edge_id: 'reactflow__edge-f-budget-g-revenue',
          verdict: 'overridden',
          resolved_strength_mean: -0.45,
        },
        '2',
      ),
    });

    expect(res.statusCode).toBe(200);
    expect(llmChatMock).not.toHaveBeenCalled();

    const arg = lastAppend();
    expect(arg.graph == null).toBe(true);
    expect(arg.handler_facts).toHaveLength(1);
    const fact = arg.handler_facts![0]!;
    expect(HandlerFactSchema.safeParse(fact).success).toBe(true);
    expect(fact).toMatchObject({
      fact_type: 'edge_adjudication',
      result: {
        from: 'f-budget',
        to: 'g-revenue',
        edge_id: 'reactflow__edge-f-budget-g-revenue',
        verdict: 'overridden',
        resolved_strength_mean: -0.45,
        provenance: 'user_set',
      },
    });
  });

  it('a dismissal persists with a null value (an honest "no value asserted")', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'edge_adjudication', from: 'f-budget', to: 'g-revenue', verdict: 'dismissed' },
        '3',
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(lastAppend().handler_facts![0]).toMatchObject({
      fact_type: 'edge_adjudication',
      result: { verdict: 'dismissed', resolved_strength_mean: null, edge_id: null },
    });
  });

  it('the 0.34.0 cross-field rule RUNS at this pin — overridden with no value is a 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'edge_adjudication', from: 'f-budget', to: 'g-revenue', verdict: 'overridden' },
        '4',
      ),
    });
    expect(res.statusCode).toBe(422);
    expect(appendMock).not.toHaveBeenCalled();
  });

  // ── 3. prior_range_edit — the user-set range PERSISTS ─────────────────────

  it('⭐ a prior-range edit commits a typed fact; no graph write (carry, never compute)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'prior_range_edit', target_id: 'f-budget', range_min: 0.2, range_max: 0.6 },
        '5',
      ),
    });

    expect(res.statusCode).toBe(200);
    const arg = lastAppend();
    expect(arg.graph == null).toBe(true);
    expect(arg.handler_facts).toHaveLength(1);
    const fact = arg.handler_facts![0]!;
    expect(HandlerFactSchema.safeParse(fact).success).toBe(true);
    expect(fact).toMatchObject({
      fact_type: 'prior_range_edit',
      result: {
        target_id: 'f-budget',
        range_min: 0.2,
        range_max: 0.6,
        distribution: null,
        provenance: 'user_set',
      },
    });
  });

  it('an inverted range is a 422 at the wire — never a quietly-persisted nonsense fact', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'prior_range_edit', target_id: 'f-budget', range_min: 0.9, range_max: 0.1 },
        '6',
      ),
    });
    expect(res.statusCode).toBe(422);
    expect(appendMock).not.toHaveBeenCalled();
  });

  // ── 4. reader-first regression — ack kinds are byte-identical ─────────────

  it('patch_dismissed still commits an EMPTY ack (no facts, no graph) — unchanged semantics', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'patch_dismissed', patch_id: 'patch-1' }, '7'),
    });
    expect(res.statusCode).toBe(200);
    const arg = lastAppend();
    expect(arg.handler_facts).toEqual([]);
    expect(arg.graph == null).toBe(true);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toBe('');
  });

  // ── 5. leak-4 lane A — factor_value_edit stamps the source ────────────────

  it('⭐ a factor_value_edit commits the graph WITH source user_override + provenance user_set (2.396(b))', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
        '8',
      ),
    });

    expect(res.statusCode).toBe(200);
    const graph = lastAppend().graph as { nodes: Array<Record<string, unknown>> } | undefined;
    expect(graph).toBeDefined();
    // Identity binding: the EDITED node, by id.
    const edited = graph!.nodes.find((n) => n.id === 'f-budget')!;
    const observed = edited.observed_state as Record<string, unknown>;
    expect(observed.value).toBeCloseTo(0.5, 10);
    expect(observed.source).toBe('user_override');
    expect(edited.provenance).toBe('user_set');
    // Negative control: the untouched option node earned nothing.
    const option = graph!.nodes.find((n) => n.id === 'o-launch')!;
    expect((option.observed_state as Record<string, unknown> | undefined)?.source).toBeUndefined();
  });
});
