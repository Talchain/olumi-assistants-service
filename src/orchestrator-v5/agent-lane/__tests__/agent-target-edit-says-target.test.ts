/**
 * ⭐ B (3) — A LATER EDIT OF ONE OF THE GOAL'S TARGETS SAYS "TARGET" AND STAYS A TARGET (DL lease, 12 Oct; CUT ruling).
 *
 * C stores each of the goal's targets as a `goal_constraints` row marked `role: 'goal_target'` (marketing: conversion above
 * 15% AND at least 20 new customers). CURRENT MODEL STATE lists every row under `limits`, so the Agent edits a second
 * target with `propose_limit_change`; the limit door writes it and keeps its role (4c4f0e66), but the card, button and
 * receipt said "Change the limit on …" (SYS1 probe at 857c87f5, 12 Oct). Here, on the real route-v2 + Agent route harness
 * of `agent-writer-doors-seam.test.ts` with a scripted model:
 *   - RED→GREEN: the target row's card, note, ONE button and receipt are the target's; pressed, the row holds the new
 *     figure and the user's strict comparator, stays a target, in ONE commit; the goal's own target is untouched;
 *   - CONTROL, byte-unchanged: a real limit's card, note and button (captured before this change at CEE 4806cefb).
 */
import { quoteOfFigure } from '../stated-by-user.js';
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

type Chip = { id: string; label: string; message: string; detail?: string };
type Call = { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _agent: { tool_calls: Call[] }; _provider_calls?: { provider: string }[] };
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

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** The tool output the model was handed on its NEXT call (the last function_call_output in its input). */
const toolOutputIn = (body: Record<string, unknown>): Record<string, unknown> => {
  const out = (body['input'] as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output').at(-1);
  return JSON.parse(String(out?.output ?? '{}')) as Record<string, unknown>;
};

describe('B (3) — a later edit of one of the goal\'s targets says "target" and stays a target', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      if (!String(url).includes('openai')) throw new Error(`non-OpenAI network call: ${String(url)}`);
      openAiCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const next = script.shift();
      return new Response(JSON.stringify(next !== undefined ? next(body) : say('Done.')), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never) };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); routerCalls.length = 0; script = []; openAiCalls = 0; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as G;
  const rowOf = (id: string) => graphNow().goal_constraints?.find((c) => c['constraint_id'] === id);
  const approveChipOf = (b: Body) => b.suggested_actions.filter((c) => c.id.startsWith('agent-approve-proposal:'));
  const proposeLimitChange = async (message: string, args: Record<string, unknown>) => {
    let out: Record<string, unknown> = {};
    // LEAN CORE (#3392, W19): the AI cites the user's sentence that writes the new figure (USER_QUOTE); none where it is unwritten.
    const quote = args.quote === undefined ? quoteOfFigure(Number(args.new_value), String(args.unit ?? ''), message) : null;
    script = [() => fnCall('propose_limit_change', quote !== null ? { ...args, quote } : args), (body) => { out = toolOutputIn(body); return say('Shall I?'); }];
    const body = await turn({ message });
    return { body, out };
  };

  it('RED→GREEN: the target row gets the TARGET card, note, ONE button and receipt; pressed, it holds the figure and stays a target', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const { body, out } = await proposeLimitChange('Make the conversion rate target above 20%.',
      { limit_label: 'Conversion rate', operator: '>=', new_value: 20, stated_operator: '>', unit: '%', rationale: 'x' });
    const card = 'Set the target for "Conversion rate" to above 20%';
    expect(out['public_label'], JSON.stringify(out)).toBe(card);
    // AIE-B-multi-target-text-AMEND-0836 S6: the card's own button is the consent; a typed yes is not.
    expect(String(out['note'])).toBe('The target for ‘Conversion rate’ is ready for review: above 20%. Tell the user they can review it and press ‘Set this target’. '
      + 'Never show the id. Call authorise_change only for the approval bound to this card; a typed ‘yes’ alone is not that approval.');
    const chips = approveChipOf(body);
    expect(chips.map(({ id: _id, ...c }) => c)).toEqual([{ label: 'Set this target', message: 'Yes, set that target.', detail: card }]);
    const writes = graphWrites.get(SCENARIO) ?? 0;
    const t2 = await turn({ message: chips[0]!.message, source: 'chip', chip: { id: chips[0]!.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(graphWrites.get(SCENARIO), 'ONE commit').toBe(writes + 1);
    expect(rowOf(CONV_ROW)).toEqual(expect.objectContaining({ value: 20, operator: '>=', operator_as_stated: '>', unit: '%', role: 'goal_target' }));
    expect(rowOf(GOAL_ROW)).toEqual(expect.objectContaining({ value: 60000, role: 'goal_target' }));
    expect(rowOf(SPEND_ROW)).toEqual(expect.objectContaining({ value: 20000 }));
    // The writer's receipt, as the reply's first line: the target's words, never "The limit on …".
    expect(t2.assistant_text.split('\n')[0]).toBe('The target for ‘Conversion rate’ is now above 20%, using your figure.');
  }, 120_000);

  it('CONTROL, byte-unchanged: a real limit keeps its limit card, note and button', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const { body, out } = await proposeLimitChange('Change the spend limit to £30,000.',
      { limit_label: 'Six-month decision spend', operator: '<=', new_value: 30000, unit: 'GBP', rationale: 'x' });
    const { proposal_id: _id, base_revision: _rev, ...rest } = out;
    expect(rest).toEqual(LIMIT_RESULT);
    expect(approveChipOf(body).map(({ id: _cid, ...c }) => c)).toEqual(LIMIT_CHIPS);
  }, 120_000);

  /** Captured from this same row BEFORE this change, at CEE 4806cefb (the limit path untouched). */
  const LIMIT_RESULT: Record<string, unknown> = {"ok": true, "mutated": false, "public_label": "Change the limit on \"Six-month decision spend\" from at most £20,000 to at most £30,000", "limit": {"on": "Six-month decision spend", "now": "at most £20,000", "becomes": "at most £30,000"}, "note": "Nothing has changed yet. Tell the user it will change the limit on \"Six-month decision spend\" from at most £20,000 to at most £30,000, as their own figure, keeping its units — never the id — and call authorise_change with this proposal_id once they agree."};
  const LIMIT_CHIPS: unknown[] = [{"label": "Change this limit", "message": "Yes, change that limit.", "detail": "Change the limit on \"Six-month decision spend\" from at most £20,000 to at most £30,000"}];
});
