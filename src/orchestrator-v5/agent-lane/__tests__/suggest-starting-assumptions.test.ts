/**
 * ⭐ "SUGGEST STARTING ASSUMPTIONS" — THE DETERMINISTIC AFFORDANCE (P-CORE #78 5911687135; DL 5912622789 item 5).
 *
 * Paul's test (13:06Z, 30 Sep): "always make assumptions about the missing data… alert me". The state already carried
 * the gaps Olumi may fill (`olumi_can_offer`), and the prompt's rule fired 0–2 times in 4 (P0 2/4, P1a 0/2, P1b 0/2).
 * So the HOST offers the chip whenever the run is KNOWN refused and Olumi can offer, and the press makes the Agent's
 * first call `propose_starting_point`: every figure is still shown as Olumi's and waits for the user's approval.
 *
 * The graph is a served construction (constructor `f7c8c86a`, 0-LLM replay of a captured cut-costs draft) with the
 * option levels Olumi set removed: P-CORE PC01's shape (the run refused, Olumi can offer the levels).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { runAgentTurn, type CallModel } from '../runtime/agent-loop.js';
import type { AgentCapabilities, AgentToolContext } from '../runtime/agent-tools.js';
import { readinessViewOf } from '../readiness-view.js';
import {
  SUGGEST_STARTING_ASSUMPTIONS_CHIP, STARTING_ASSUMPTIONS_TOOL, NEXT_STEP_AFTER_BLOCKED_RUN_CHIP,
  offersStartingAssumptions, startingAssumptionsOffered, forcedToolOf, stillValidOffers,
} from '../../../routes/agent-v1-turn.js';

type Json = Record<string, any>;
const FIX = JSON.parse(readFileSync(new URL('./fixtures/cc-olumi-levels-unset-20260930.json', import.meta.url), 'utf8')) as { graph: Json; olumi_levels_unset: Json };
const REFUSED = { status: 'needs_user_input', may_run: false };

/** The same served graph with every factor's level removed: only the USER can give those (MISSING_FACTOR_LEVEL). */
const factorLevelsUnset = (): Json => {
  const g = structuredClone(FIX.graph);
  for (const n of g.nodes) if (n.kind === 'factor') delete n.observed_state;
  return g;
};

describe('when the chip is offered: the run is KNOWN refused and Olumi can offer', () => {
  it('RED: the served graph with Olumi\'s option levels unset → refused, Olumi can offer → offered', () => {
    const view = readinessViewOf(FIX.olumi_levels_unset);
    expect(view.checked).toBe(true);
    expect(view.may_run).toBe(false);
    expect(view.olumi_can_offer.length).toBeGreaterThan(0);
    expect(offersStartingAssumptions(view)).toBe(true);
    expect(startingAssumptionsOffered(FIX.olumi_levels_unset, REFUSED)).toBe(true);
  });

  it('CONTROL: the same graph as constructed (it runs) → not offered', () => {
    expect(readinessViewOf(FIX.graph).may_run).toBe(true);
    expect(startingAssumptionsOffered(FIX.graph, REFUSED)).toBe(false);
  });

  it('CONTROL: refused, but only the USER can fill it (factor levels) → not offered', () => {
    const view = readinessViewOf(factorLevelsUnset());
    expect(view.may_run, 'the control reaches a refusal').toBe(false);
    expect(view.needs_from_user.length, 'the refusal is a user demand').toBeGreaterThan(0);
    expect(view.olumi_can_offer).toEqual([]);
    expect(startingAssumptionsOffered(factorLevelsUnset(), REFUSED)).toBe(false);
  });

  it('CONTROL: an unchecked verdict (no graph) is never a refusal → not offered', () => {
    expect(offersStartingAssumptions(readinessViewOf(null))).toBe(false);
  });

  it.each([
    ['this turn\'s Run control admits a run (never beside a Run button)', { status: 'ready', may_run: true }],
    ['the readback\'s readiness is unknown (a failed read)', undefined],
  ])('CONTROL: %s → not offered', (_l, analysisReady) => {
    expect(startingAssumptionsOffered(FIX.olumi_levels_unset, analysisReady)).toBe(false);
  });
});

describe('a replayed offer stays only while the run is KNOWN refused', () => {
  const now = (analysisReady: unknown) => ({ outstandingProposalIds: new Set<string>(), analysisReady, analysisState: {}, modelExists: true });
  it('kept on a known refusal; dropped once it may run, and on an unknown state', () => {
    const offered = [SUGGEST_STARTING_ASSUMPTIONS_CHIP];
    expect(stillValidOffers(offered, now(REFUSED)).map((a) => a.id)).toEqual([SUGGEST_STARTING_ASSUMPTIONS_CHIP.id]);
    expect(stillValidOffers(offered, now({ status: 'ready', may_run: true }))).toEqual([]);
    expect(stillValidOffers(offered, now(undefined))).toEqual([]);
  });
});

describe('the forced first call is sent only for a tool the call declares', () => {
  const tools = [{ type: 'function', name: STARTING_ASSUMPTIONS_TOOL }, { type: 'function', name: 'get_canonical_state' }];
  it.each([
    ['a declared tool', { tools, tool_choice: { type: 'function', name: STARTING_ASSUMPTIONS_TOOL } }, STARTING_ASSUMPTIONS_TOOL],
    ['CONTROL: a tool the call does not declare', { tools, tool_choice: { type: 'function', name: 'authorise_change' } }, undefined],
    ['CONTROL: "none" (the Run interpretation)', { tools, tool_choice: 'none' }, undefined],
    ['CONTROL: no choice', { tools }, undefined],
    ['CONTROL: no tools', { tool_choice: { type: 'function', name: STARTING_ASSUMPTIONS_TOOL } }, undefined],
  ])('%s', (_l, req, expected) => {
    expect(forcedToolOf(req)).toBe(expected);
  });
});

describe('the loop forces the named tool on its FIRST call only', () => {
  const ctx: AgentToolContext = { scenario_id: 'scn', authenticated_user_id: null, request_id: 'req' };
  const called: string[] = [];
  const caps = { proposeStartingPoint: async () => { called.push('proposeStartingPoint'); return { ok: true, mutated: false, proposal_id: 'prop_s' }; } } as unknown as AgentCapabilities;
  const base = { ctx, history: [], message: SUGGEST_STARTING_ASSUMPTIONS_CHIP.message, instructions: 'i', maxOutputTokens: 100 };
  const run = async (over: Record<string, unknown>) => {
    const seen: Json[] = [];
    let hop = 0;
    const model: CallModel = async (req) => {
      seen.push(req as Json);
      return { output: hop++ === 0
        ? [{ type: 'function_call', name: STARTING_ASSUMPTIONS_TOOL, call_id: 'c1', arguments: '{}' }]
        : [{ type: 'message', content: [{ type: 'output_text', text: 'Here are starting assumptions to review.' }] }] };
    };
    const r = await runAgentTurn({ ...base, ...over }, caps, model);
    return { seen, r };
  };
  beforeEach(() => { called.length = 0; });

  it('RED: firstCallTool → the first request requires that function; the next one is free', async () => {
    const { seen, r } = await run({ firstCallTool: STARTING_ASSUMPTIONS_TOOL });
    expect(seen[0]!.tool_choice).toEqual({ type: 'function', name: STARTING_ASSUMPTIONS_TOOL });
    expect(seen.length, 'the turn went on after the proposal').toBeGreaterThan(1);
    for (const later of seen.slice(1)) expect(later.tool_choice).toBeUndefined();
    expect(called).toEqual(['proposeStartingPoint']);
    expect(r.tool_calls.map((c) => c.name)).toEqual([STARTING_ASSUMPTIONS_TOOL]);
  });

  it('CONTROL: no firstCallTool → no forced call (exactly as before)', async () => {
    const { seen } = await run({});
    expect(seen.every((q) => q.tool_choice === undefined)).toBe(true);
  });

  it('CONTROL: a withheld tool is never forced', async () => {
    const { seen } = await run({ firstCallTool: STARTING_ASSUMPTIONS_TOOL, withheldTools: [STARTING_ASSUMPTIONS_TOOL] });
    expect(seen[0]!.tool_choice).toBeUndefined();
  });

  it('CONTROL: a tool the mode does not carry (preview has no writers) is never forced', async () => {
    const { seen } = await run({ firstCallTool: STARTING_ASSUMPTIONS_TOOL, mode: 'preview' });
    expect(seen[0]!.tool_choice).toBeUndefined();
  });
});

/**
 * THE REAL ROUTE: the offer on the state read back, and the press through the route's own transport. The only seams are
 * the product's internal routes (a graph read) and the provider's HTTP call (`fetch`), whose request body is recorded.
 */
let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `5e0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d2c${String(n).padStart(2, '0')}`; };
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('the real route offers the chip, and its press forces the proposal', () => {
  let app: FastifyInstance;
  let graph: Json = FIX.olumi_levels_unset;
  let readiness: Record<string, unknown> = REFUSED;
  let modelBodies: Json[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      modelBodies.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, the options have no levels yet.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: 'h0', analysis_ready: readiness, analysis_state: {} }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [], analysis_ready: readiness }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { graph = FIX.olumi_levels_unset; readiness = REFUSED; modelBodies = []; nextScenario(); });

  const turn = async (payload: Record<string, unknown>) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, ...payload } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { suggested_actions: { id: string }[] };
  };

  it('RED: a typed question on the refused, Olumi-can-offer state → "Suggest starting assumptions", replacing the general next step', async () => {
    const b = await turn({ message: 'What does the model still need?' });
    const ids = b.suggested_actions.map((a) => a.id);
    expect(ids).toContain(SUGGEST_STARTING_ASSUMPTIONS_CHIP.id);
    expect(ids).not.toContain(NEXT_STEP_AFTER_BLOCKED_RUN_CHIP.id);
  });

  it('CONTROL: the same graph when this turn\'s Run control admits a run → not offered', async () => {
    readiness = { status: 'ready', may_run: true };
    const b = await turn({ message: 'What does the model still need?' });
    expect(b.suggested_actions.map((a) => a.id)).not.toContain(SUGGEST_STARTING_ASSUMPTIONS_CHIP.id);
  });

  it('CONTROL: the constructed graph (it runs) → not offered', async () => {
    graph = FIX.graph;
    const b = await turn({ message: 'What does the model still need?' });
    expect(b.suggested_actions.map((a) => a.id)).not.toContain(SUGGEST_STARTING_ASSUMPTIONS_CHIP.id);
  });

  it('RED: the press → the first provider request requires propose_starting_point, and declares it', async () => {
    await turn({ message: SUGGEST_STARTING_ASSUMPTIONS_CHIP.message, source: 'chip', chip: { id: SUGGEST_STARTING_ASSUMPTIONS_CHIP.id } });
    const first = modelBodies[0]!;
    expect(first.tool_choice).toEqual({ type: 'function', name: STARTING_ASSUMPTIONS_TOOL });
    expect((first.tools as { name: string }[]).map((t) => t.name)).toContain(STARTING_ASSUMPTIONS_TOOL);
  });

  it('CONTROL: the same words TYPED (no chip) → nothing is forced', async () => {
    await turn({ message: SUGGEST_STARTING_ASSUMPTIONS_CHIP.message });
    expect(modelBodies.length, 'the control reached the model').toBeGreaterThan(0);
    expect(modelBodies.every((q) => q.tool_choice === undefined)).toBe(true);
  });
});
