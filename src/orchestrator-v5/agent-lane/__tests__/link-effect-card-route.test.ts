/**
 * ⛔ THE USER'S FIGURE IS RECORDED ONLY FROM THE CARD THAT SHOWS IT (PR Review's fifth CR on #2275 @ db47673d).
 *
 * The card (`approvalChipsFor`) shows the exact reading it records. A "yes" typed to the Agent is not that card: the
 * Agent may call `authorise_change`, and nothing is recorded. Only the route binds `typed_approval_of` — from the typed
 * approve chip the user pressed (`typedApprovalOf`), never from model output — so this row runs the REAL route: the
 * same proposal is refused from words, then recorded from its card with zero model calls.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a5c';
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number }>();
/** Per scenario: the pending actions the latest answer row persisted — the durable carrier a restarted process reads. */
const lastPending = new Map<string, unknown[]>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  readMostRecentPendingActions: vi.fn(async (sid: string) => {
    const { parsePendingAction } = await import('../../session/pending-action.js');
    return (lastPending.get(sid) ?? []).map((x) => parsePendingAction(JSON.parse(JSON.stringify(x)))).filter((x) => x !== null);
  }),
  append: vi.fn(async (w: { scenario_id?: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    if (!rows.has(w.turn_id)) {
      rows.set(w.turn_id, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0 });
      if (w.scenario_id !== undefined && !w.turn_id.endsWith(':claim')) lastPending.set(w.scenario_id, JSON.parse(JSON.stringify(w.pending_actions ?? [])));
    }
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
const PRISTINE_EDGES = structuredClone(graph.edges);
const THEIRS = { source: 'user_specified', magnitude: 'user_stated',
  natural_effect: { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month' } };
const doorCalls: unknown[] = [];
vi.mock('../../system-events/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, commitOptionLevelsInProcess: async (input: unknown) => {
    doorCalls.push(input);
    const e = (graph.edges as Json[]).find((x) => x.from === 'pro_plan_price' && x.to === 'pro_plan_paying_subscribers')!;
    // The door stores exactly the effect it was sent (the read-back checks it is the approved one).
    const sent = (input as { link_effect?: { effect?: Record<string, unknown> } }).link_effect?.effect;
    e.provenance = { ...(e.provenance ?? {}), ...THEIRS, natural_effect: { ...THEIRS.natural_effect, ...(sent ?? {}) } };
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
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      modelCalls += 1;
      // Only the Agent's own call (the one offering its tools) takes the script; any other model call (the turn summary,
      // written after the answer) gets words, so it can never consume the next turn's tool call.
      const agentCall = String(init?.body ?? '').includes('"propose_link_effect"');
      return new Response(JSON.stringify(agentCall ? (script.shift() ?? say) : say), { status: 200 });
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
  beforeEach(() => { graph.edges = structuredClone(PRISTINE_EDGES); doorCalls.length = 0; script.length = 0; });

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

  it('RED (PR Review @ fe509477; AIQ 5885833834; Canonical 5885850080): a press for a proposal with no ISSUED card on offer writes nothing, even with its exact id and reading', async () => {
    const sid = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a5d';
    const offer = async (said: string, args: Json) => {
      script.push({ output: [{ type: 'function_call', name: 'propose_link_effect', call_id: 'p', arguments: JSON.stringify(args) }] });
      const b = (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: sid, message: said } })).json() as
        { suggested_actions: { id: string; message: string; detail?: string }[]; _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] } };
      const id = b._agent.tool_calls.find((c) => c.name === 'propose_link_effect' && c.ok)?.proposal_id;
      expect(typeof id === 'string' ? 'prop' : JSON.stringify(b._agent.tool_calls)).toBe('prop');
      return b.suggested_actions.find((c) => c.id === `agent-approve-proposal:${id}`)!;
    };
    const p1 = await offer(SAID, ARGS);
    // The user states another figure: P2's card is now the one on offer. P1 is still stored and would execute.
    const p2 = await offer('Actually, every £1 on the Pro price loses us about 40 paying subscribers.',
      { ...ARGS, amount: -40, quote: 'every £1 on the Pro price loses us about 40 paying subscribers' });
    expect(p2.id).not.toBe(p1.id);
    const press = async (c: { id: string; message: string }) => (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: sid, message: c.message, source: 'chip', chip: { id: c.id },
    } })).json() as { _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] } };
    // Forged: P1's exact id and its exact reading, but no card for P1 is on offer.
    expect((await press(p1))._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: false })]);
    expect(doorCalls, 'nothing recorded for a card not on offer').toHaveLength(0);
    // Control: the card on offer records.
    expect((await press(p2))._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true })]);
    expect(doorCalls).toHaveLength(1);
  });

  it('RED (DL 5885900319): the ISSUED card survives a restart (durable carrier) and is consumed once', async () => {
    const sid = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a5e';
    script.push({ output: [{ type: 'function_call', name: 'propose_link_effect', call_id: 'r', arguments: JSON.stringify(ARGS) }] });
    const b1 = (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: sid, message: SAID } })).json() as
      { suggested_actions: { id: string; message: string; detail?: string }[] };
    const card = b1.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'))!;
    expect(card.detail).toMatch(/^Record: /);
    expect(JSON.stringify(lastPending.get(sid) ?? [])).toContain(card.id); // precondition: the answer row persisted the issued card
    // A RESTART: a fresh route module (no process memory of proposals or offers), the same persisted rows.
    vi.resetModules();
    const { agentV1TurnRoute: fresh } = await import('../../../routes/agent-v1-turn.js');
    const app2 = Fastify({ logger: false });
    app2.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) }));
    await app2.register(fresh);
    await app2.ready();
    try {
      const press = async () => (await app2.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
        kind: 'message', scenario_id: sid, message: card.message, source: 'chip', chip: { id: card.id },
      } })).json() as { _agent: { tool_calls: { name: string; ok: boolean }[] } };
      expect((await press())._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true })]);
      expect(doorCalls, 'recorded after the restart, from the carried card').toHaveLength(1);
      await press(); // the same card again
      expect(doorCalls, 'a card is consumed once: pressing it again writes nothing more').toHaveLength(1);
    } finally {
      await app2.close();
    }
  });
});
