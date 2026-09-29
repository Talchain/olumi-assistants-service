/**
 * ⛔ THE USER'S FIGURE IS RECORDED ONLY FROM THE CARD THAT SHOWS IT (PR Review's fifth CR on #2275 @ db47673d).
 *
 * The card (`approvalChipsFor`) shows the exact reading it records. A "yes" typed to the Agent is not that card: the
 * Agent may call `authorise_change`, and nothing is recorded. Only the route binds `typed_approval_of` — from the typed
 * approve chip the user pressed (`typedApprovalOf`), never from model output — so this row runs the REAL route: the
 * same proposal is refused from words, then recorded from its card with zero model calls.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a5c';
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number }) => {
    if (!rows.has(w.turn_id)) rows.set(w.turn_id, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0 });
    return { id: rows.get(w.turn_id)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

// Served journey C (5411da8): a DIRECT, UNSIZED "Pro plan price" → "Pro plan paying subscribers" link.
const graph = (JSON.parse(readFileSync(new URL('./fixtures/served-journey-c-price-subscribers-unsized-5411da8.json', import.meta.url), 'utf8')) as { graph: Json }).graph;
const THEIRS = { source: 'user_specified', magnitude: 'user_stated',
  natural_effect: { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month' } };
const doorCalls: unknown[] = [];
vi.mock('../../system-events/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, commitOptionLevelsInProcess: async (input: unknown) => {
    doorCalls.push(input);
    const e = (graph.edges as Json[]).find((x) => x.from === 'pro_plan_price' && x.to === 'pro_plan_paying_subscribers')!;
    e.provenance = { ...(e.provenance ?? {}), ...THEIRS };
    return { status: 'committed', graph_hash: 'h-after', receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  } };
});

const SAID = 'Honestly, every £1 on the Pro price loses us about 50 paying subscribers.';
const ARGS = { from_label: 'Pro plan price', to_label: 'Pro plan paying subscribers', amount: -50, amount_unit: 'subscribers',
  per_source_change: 1, per_source_change_unit: 'GBP per month', quote: 'every £1 on the Pro price loses us about 50 paying subscribers' };

describe('a link\'s stated effect is recorded only from its card, on the real route', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  /** What the model does next: a tool call, then words. */
  const script: Json[] = [];
  const say = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is what I would record. Press the button if that is right.' }] }] };
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      modelCalls += 1;
      return new Response(JSON.stringify(script.shift() ?? say), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the Agent approving from "yes" records nothing; pressing the card records it, with zero model calls', async () => {
    script.push({ output: [{ type: 'function_call', name: 'propose_link_effect', call_id: 'c1', arguments: JSON.stringify(ARGS) }] });
    const t1 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: SAID } });
    const b1 = t1.json() as { suggested_actions: { id: string; label: string; message: string; detail?: string }[]; _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] } };
    const proposalId = b1._agent.tool_calls.find((c) => c.name === 'propose_link_effect' && c.ok)?.proposal_id;
    expect(proposalId, JSON.stringify(b1._agent.tool_calls)).toMatch(/^prop_/);
    const card = b1.suggested_actions.find((c) => c.id === `agent-approve-proposal:${proposalId}`)!;
    expect(card.detail).toMatch(/from your words: "every £1 on the Pro price loses us about 50 paying subscribers"$/);

    // Words, not the card: the Agent calls authorise_change on the same proposal → refused, nothing written.
    script.push({ output: [{ type: 'function_call', name: 'authorise_change', call_id: 'c2', arguments: JSON.stringify({ proposal_id: proposalId }) }] });
    const t2 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Yes, record that.' } });
    const b2 = t2.json() as { suggested_actions: { id: string; detail?: string }[]; _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] } };
    expect(b2._agent.tool_calls).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'authorise_change', ok: false, proposal_id: proposalId })]));
    expect(doorCalls, 'nothing recorded from words').toHaveLength(0);
    // The button the Agent points to is still there, with the same reading (never a dead end).
    expect(b2.suggested_actions.find((c) => c.id === card.id)?.detail).toBe(card.detail);

    // A FORGED approval (AIQ 5885290014): the chip's id without its reading — the old plain words — records nothing.
    const forged = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Yes, record that.', source: 'chip', chip: { id: card.id },
    } });
    expect((forged.json() as { _agent: { tool_calls: { name: string; ok: boolean }[] } })._agent.tool_calls)
      .toEqual([expect.objectContaining({ name: 'authorise_change', ok: false })]);
    expect(doorCalls, 'nothing recorded without the reading').toHaveLength(0);

    // The card: the route binds the proposal the chip names and the words it sent (its reading); one write, no model call.
    const before = modelCalls;
    const t3 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: card.message, source: 'chip', chip: { id: card.id },
    } });
    expect(t3.statusCode).toBe(200);
    const b3 = t3.json() as { _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] }; _diagnostic_trace: { fast_path?: string } };
    expect(modelCalls - before, 'zero model calls on the card').toBe(0);
    expect(b3._diagnostic_trace.fast_path).toBe('approve');
    expect(b3._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, proposal_id: proposalId })]);
    expect(doorCalls, 'recorded once, from the card').toHaveLength(1);
  });
});
