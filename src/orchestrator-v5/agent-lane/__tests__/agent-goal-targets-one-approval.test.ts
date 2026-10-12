/**
 * ⭐ B (1) — EVERY TARGET ONE MESSAGE STATES IS WRITTEN ON ONE APPROVAL, ALL OR NONE (DL lease, 12 Oct).
 *
 * C stores each of the goal's targets as a `goal_constraints` row marked `role: 'goal_target'` (marketing: conversion above
 * 15% AND at least 20 new customers). `commitGoalTargetsInProcess` threads the goal's own row (`goal_target_edit`'s
 * adapter) and every other target row (the limit door's adapter, role kept) over ONE graph and commits them as ONE CAS
 * write. Pinned here at the door, on the real route harness of `agent-writer-doors-seam.test.ts`:
 *   - two targets → ONE graph-bearing row; both rows hold the new figures and stay targets; the limit is untouched;
 *   - a target refused mid-thread (a limit row named as a target; a row that does not exist) → NOTHING appended, the
 *     stored model byte-identical;
 *   - a stale base → `stale`, nothing appended;
 *   - the same write sent again (a resend, same idempotency key) → nothing applied twice.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6b1e2d3c-4b5a-4f6e-9d7c-8b9a0e1f3d${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
let graphOf = new Map<string, unknown>();
/** Every append that carried a graph, per scenario: "ONE graph-bearing row". */
const graphWrites = new Map<string, number>();
const latestRow = (sid: string = SCENARIO): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
const jsonbOrder = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(jsonbOrder)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]))
      : v;
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  const raw = row ? (jsonbOrder(JSON.parse(JSON.stringify(row.pending_actions))) as unknown[]) : [];
  return raw.map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};
let tick = 0;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown; handler_facts?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date(Date.UTC(2026, 8, 27, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) {
        graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
        graphWrites.set(w.scenario_id, (graphWrites.get(w.scenario_id) ?? 0) + 1);
      }
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  readFactsWithTurnFor: vi.fn(async (ids: readonly string[]) => [...rows.values()].filter((r) => ids.includes(r.id))
    .flatMap((r) => r.handler_facts.map((fact) => ({ turn_id: r.id, fact })))),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the writer doors (${what})`); };
vi.mock('../../../adapters/llm/router.js', () => {
  const adapter = { name: 'test', model: 'test-model', chat: refuse('chat'), chatWithTools: refuse('chatWithTools') };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }),
    getMaxTokensFromConfig: () => undefined,
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));

type G = { nodes: { id: string; kind: string; label: string; [k: string]: unknown }[]; edges: { from: string; to: string; [k: string]: unknown }[]; goal_constraints?: Record<string, unknown>[] };

const SPEND = 'six_month_decision_spend';
const GOAL_ROW = 'gc-goal-1';
const CONV_ROW = 'gc-conv-1';
const SPEND_ROW = 'gc-spend-1';
/** A runnable model whose goal holds TWO targets (C's shape: revenue at least £60,000 AND conversion above 15%) and one limit. */
const seedGraph = (): G => {
  const e = (from: string, to: string, mean = 0.5, dir: 'positive' | 'negative' = 'positive') =>
    ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: dir });
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
      { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.6, goal_threshold_raw: 60000, goal_threshold_unit: 'GBP', goal_threshold_cap: 100000, goal_threshold_frame: 'level' },
      { id: 'fac_conv', kind: 'factor', label: 'Conversion rate', category: 'external', observed_state: { value: 0.12, raw_value: 12, unit: '%', cap: 100 } },
      { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      { id: SPEND, kind: 'factor', label: 'Six-month decision spend', category: 'external', observed_state: { value: 0.375, raw_value: 15000, unit: 'GBP', cap: 40000 } },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP' } } },
    ],
    edges: [e('dec_x', 'opt_a', 1), e('dec_x', 'opt_b', 1), e('opt_a', 'fac_price', 1), e('opt_b', 'fac_price', 1),
      e('fac_price', 'fac_conv'), e('fac_conv', 'goal_x'), e('fac_price', 'goal_x'), e(SPEND, 'goal_x', 0.2, 'negative')],
    goal_constraints: [
      { constraint_id: GOAL_ROW, node_id: 'goal_x', operator: '>=', value: 60000, unit: 'GBP', value_frame: 'level', label: 'Revenue', provenance: 'explicit', role: 'goal_target' },
      { constraint_id: CONV_ROW, node_id: 'fac_conv', operator: '>=', operator_as_stated: '>', value: 15, unit: '%', value_frame: 'level', label: 'Conversion rate', provenance: 'explicit', role: 'goal_target' },
      { constraint_id: SPEND_ROW, node_id: SPEND, operator: '<=', value: 20000, unit: 'GBP', value_frame: 'level',
        label: 'Six-month decision spend', provenance: 'inferred', source_quote: 'keep decision spend under £20,000 over six months' },
    ],
  };
};

describe('B (1) — every target one message states, on one approval, all or none', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => { throw new Error(`no network call expected: ${String(url)}`); }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    app = Fastify({ logger: false });
    await app.register(ceeOrchestratorRouteV2);
    await app.ready();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); routerCalls.length = 0; });

  const graphNow = () => graphOf.get(SCENARIO) as G;
  const bytes = () => JSON.stringify(graphOf.get(SCENARIO));
  const hashNow = async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    return computeAnalysisAffectingGraphHash(graphNow() as never) as string;
  };
  const rowOf = (id: string) => graphNow().goal_constraints?.find((c) => c['constraint_id'] === id);
  const door = async () => (await import('../../system-events/dispatch.js')).commitGoalTargetsInProcess;
  const TWO = [
    { node_id: 'goal_x', operator: '>=' as const, raw_value: 75000, unit: 'GBP' },
    { node_id: 'fac_conv', operator: '>=' as const, raw_value: 18, unit: '%', stated_operator: '>' as const },
  ];

  it('two targets → ONE graph-bearing row; both rows hold the new figures and stay targets; the limit is untouched', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const writes = graphWrites.get(SCENARIO) ?? 0;
    const r = await (await door())({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(), targets: TWO }, 'req-two');
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ status: 'committed' }));
    expect(graphWrites.get(SCENARIO), 'ONE commit for both targets').toBe(writes + 1);
    expect(rowOf(GOAL_ROW)).toEqual(expect.objectContaining({ node_id: 'goal_x', operator: '>=', value: 75000, unit: 'GBP', role: 'goal_target' }));
    expect(rowOf(CONV_ROW)).toEqual(expect.objectContaining({ node_id: 'fac_conv', operator: '>=', operator_as_stated: '>', value: 18, unit: '%', role: 'goal_target' }));
    expect(rowOf(SPEND_ROW)).toEqual(expect.objectContaining({ value: 20000 }));
    expect(rowOf(SPEND_ROW)?.['role']).toBeUndefined();
    expect(graphNow().goal_constraints).toHaveLength(3);
    expect(routerCalls, 'no model call on the door').toEqual([]);
    expect(r.status === 'committed' && r.rows.map((x) => [x.constraint_id, x.value, x.role])).toEqual([[GOAL_ROW, 75000, 'goal_target'], [CONV_ROW, 18, 'goal_target']]);
  }, 120_000);

  it('RED mid-thread: the second target is a LIMIT row → refused at index 1, NOTHING appended, the model byte-identical (the first target is not written)', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const rowsBefore = order.length;
    const r = await (await door())({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(),
      targets: [TWO[0]!, { node_id: SPEND, operator: '<=', raw_value: 30000, unit: 'GBP' }] }, 'req-limit-as-target');
    expect(r).toEqual({ status: 'refused', reason: 'not_a_goal_target', index: 1 });
    expect(order.length, 'no row appended').toBe(rowsBefore);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('RED mid-thread: the second target names no existing row → refused at index 1, nothing written', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const rowsBefore = order.length;
    const r = await (await door())({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(),
      targets: [TWO[0]!, { node_id: 'fac_price', operator: '>=', raw_value: 55, unit: 'GBP' }] }, 'req-no-row');
    expect(r).toEqual(expect.objectContaining({ status: 'refused', index: 1 }));
    expect(order.length).toBe(rowsBefore);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('a stale base → stale; nothing appended, the model byte-identical', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const rowsBefore = order.length;
    const r = await (await door())({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: 'ffffffffffffffff', targets: TWO }, 'req-stale');
    expect(r).toEqual({ status: 'stale' });
    expect(order.length).toBe(rowsBefore);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('the same write sent again (same idempotency key, same base) applies nothing twice', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const input = { scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(), targets: TWO };
    const first = await (await door())(input, 'req-once');
    expect(first.status).toBe('committed');
    const after = bytes();
    const writes = graphWrites.get(SCENARIO);
    const again = await (await door())(input, 'req-again');
    // The base has moved (the first write): the door says stale, and the caller's read-back decides "already applied".
    expect(again).toEqual({ status: 'stale' });
    expect(graphWrites.get(SCENARIO)).toBe(writes);
    expect(bytes()).toBe(after);
  }, 120_000);

  it('a duplicate target and an empty card are refused before anything is read', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const commit = await door();
    await expect(commit({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(), targets: [TWO[1]!, TWO[1]!] }, 'req-dup'))
      .resolves.toEqual({ status: 'refused', reason: 'duplicate_target' });
    await expect(commit({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(), targets: [] }, 'req-none'))
      .resolves.toEqual({ status: 'refused', reason: 'no_targets' });
    expect(bytes()).toBe(before);
  }, 120_000);
});
