/**
 * ⭐ S5t-W (e7's witness #87 6011176086 on CEE 5f8f24c; DL 07:0xZ): THE REFIT RECEIPT REACHES THE USER WHOLE, on the real route.
 *
 * Served: the card press recorded the investor's "£100,000 per quarter per percentage point" and refit the goal's frame
 * (3.5M → 10M), but the chat read only "Your other links mean the same as before…". The approve fast path handed the
 * capability's OWN receipt to the write narrator, whose completion-claim stripper is for the model's prose: the quote ends
 * `."`, so "Recorded your figure … Olumi rescaled ‘quarterly revenue’ so your figure fits." is one sentence, and it went.
 * The receipt is server-authored (the comment on the fast path: "Server-authored text only — never model prose"), so the
 * narrator adds its status line and strips nothing from it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a71';
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number }>();
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

// e7's served stg4 investor graph, before the card press (the goal's frame is 3.5M; £100k/quarter per point needs 10M).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/s5t-stg4-investor-5f8f24c.json', import.meta.url), 'utf8')) as { graph: Json };
const PRISTINE = structuredClone(fixture.graph);
let graph: Json = structuredClone(PRISTINE);
const doorCalls: unknown[] = [];
vi.mock('../../system-events/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, commitOptionLevelsInProcess: async (input: unknown) => {
    doorCalls.push(input);
    // The door stores the REAL writer's whole postimage: a refit moves the goal's frame and its other links' β too. The
    // ONE-link door opts in to the refit (`frameRefit`, as `executeOptionInterventionBatch` passes it).
    const { applyLinkEffectEdit } = await import('../../system-events/link-effect-edit.js');
    const le = (input as { link_effect: Json }).link_effect;
    const out = applyLinkEffectEdit({ persistedGraph: structuredClone(graph), from: le.from, to: le.to, effect: le.effect, quote: le.quote,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: le.edge_token }, reading_token: le.reading_token,
      ...(le.unit_readings !== undefined ? { unit_readings: le.unit_readings } : {}), ...(le.reversal !== undefined ? { reversal: le.reversal } : {}), frameRefit: true });
    if (out.kind !== 'mutated') throw new Error(`writer refused in the stub door: ${JSON.stringify(out)}`);
    graph = structuredClone(out.mutatedGraph as Json);
    return { status: 'committed', graph_hash: 'h-after', receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  } };
});

// e7's sentence, verbatim (turn-004 request).
const SAID = 'Every 1 percentage point more of Enterprise win rate adds about £100,000 per quarter of quarterly revenue.';
const ARGS = { from_label: 'Enterprise win rate', to_label: 'quarterly revenue', amount: 100000, amount_unit: '£/quarter',
  per_source_change: 1, per_source_change_unit: 'percentage point', quote: SAID };

describe('S5t-W: the refit receipt reaches the user whole (real route, e7 stg4 graph)', () => {
  let app: FastifyInstance;
  const script: Json[] = [];
  const say = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is what I would record. Press the button if that is right.' }] }] };
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
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
  beforeEach(() => { graph = structuredClone(PRISTINE); doorCalls.length = 0; script.length = 0; });

  const pressCard = async (sid: string) => {
    script.push({ output: [{ type: 'function_call', name: 'propose_link_effect', call_id: 'c1', arguments: JSON.stringify(ARGS) }] });
    const b1 = (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: sid, message: SAID } })).json() as
      { suggested_actions: { id: string; message: string }[]; _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] } };
    const proposalId = b1._agent.tool_calls.find((c) => c.name === 'propose_link_effect' && c.ok)?.proposal_id;
    expect(proposalId, JSON.stringify(b1._agent.tool_calls)).toMatch(/^prop_/);
    const card = b1.suggested_actions.find((c) => c.id === `agent-approve-proposal:${proposalId}`)!;
    const t = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: sid, message: card.message, source: 'chip', chip: { id: card.id },
    } });
    expect(t.statusCode, t.body.slice(0, 600)).toBe(200);
    return t.json() as { assistant_text: string; _agent: { tool_calls: { name: string; ok: boolean }[] }; _diagnostic_trace: { fast_path?: string } };
  };

  it('RED (e7 turn-005): the card press that refits the goal says the WHOLE receipt — the recorded figure and what was rescaled', async () => {
    const b = await pressCard(SCENARIO);
    expect(b._diagnostic_trace.fast_path).toBe('approve');
    expect(b._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true })]);
    // CONTROL: the writer really refit the frame (the goal's cap moved), so the receipt is owed.
    const goal = (graph.nodes as Json[]).find((n) => n.id === 'quarterly_revenue')!;
    expect(goal.observed_state.cap).not.toBe(PRISTINE.nodes.find((n: Json) => n.id === 'quarterly_revenue').observed_state.cap);
    expect(b.assistant_text).toContain(`Recorded your figure for how "Enterprise win rate" moves "quarterly revenue", from your words, as you confirmed: "${SAID}"`);
    expect(b.assistant_text).toContain('Olumi rescaled ‘quarterly revenue’ so your figure fits. Your other links mean the same as before, though some strength words may read differently.');
    // The server's status line still rides with it (the narrator states what was saved).
    expect(b.assistant_text).toMatch(/\bSaved\b/);
  });

  it('(Review Desk 6b) a label holding a leader word never reaches this receipt: no approve card is offered for it (KNOWN, upstream)', async () => {
    // The receipt's words are fixed; labels, figures and the user's confirmed quote are interpolated, quoted, nothing else.
    // Measured here: the card for "Best Option Plan win rate" is withheld before any approval (only "Change something
    // first" is offered), so nothing is recorded and no receipt carries the word. The leader gate later on this route still
    // runs over every approval's text; this PR changes only the completion-claim stripper.
    PRISTINE.nodes.find((n: Json) => n.id === 'enterprise_win_rate').label = 'Best Option Plan win rate';
    try {
      graph = structuredClone(PRISTINE);
      const said = 'Every 1 percentage point more of Best Option Plan win rate adds about £100,000 per quarter of quarterly revenue.';
      script.push({ output: [{ type: 'function_call', name: 'propose_link_effect', call_id: 'c1', arguments: JSON.stringify({ ...ARGS, from_label: 'Best Option Plan win rate', quote: said }) }] });
      const sid = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a72';
      const b1 = (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: sid, message: said } })).json() as
        { suggested_actions: { id: string }[]; _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] } };
      expect(b1._agent.tool_calls.find((c) => c.name === 'propose_link_effect' && c.ok)?.proposal_id, 'CONTROL: the proposal was made').toMatch(/^prop_/);
      expect(b1.suggested_actions.map((c) => c.id).filter((id) => id.startsWith('agent-approve-proposal:'))).toEqual([]);
      expect(doorCalls).toHaveLength(0);
    } finally {
      PRISTINE.nodes.find((n: Json) => n.id === 'enterprise_win_rate').label = 'Enterprise win rate';
    }
  });
});
