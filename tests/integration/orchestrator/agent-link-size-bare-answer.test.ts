/**
 * ⭐ PAUL'S "About £20,000" BINDS TO OLUMI'S OWN RECORDED QUESTION, END TO END (R3 #75 5926021003 (a); AIQ words 5926045839;
 * MG lease 5926052489). The PRODUCER's record (`linkSizeAskRecord` → `linkSizeAskPendingAction`, as the answer row carries
 * it) is read back as the open ask (`openLinkSizeAskOnRow`), bound on the next typed turn (`ctx.link_size_ask`), and the
 * REAL propose → card → press → ONE commit → read-back path records the user's amount with the question's per-one,
 * marked as an answer to that question. R3's negatives refuse with nothing prepared.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { linkSizeAskPendingAction, linkSizeAskRecord, openLinkSizeAskOnRow, OpenLinkSizeAsks } from '../../../src/orchestrator-v5/agent-lane/link-size-ask.js';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '38b6c2a6-0000-4000-8000-0000000000c7';

const SRC = 'angel_investor_conversations';
/** The served 0643Z shape at the link-size turn (CEE 581c1873): a unitless count outcome with a stored frame, into the £ goal. */
function servedGraph(): unknown {
  return {
    goal_node_id: 'funding',
    nodes: [
      { id: 'funding', kind: 'goal', label: 'funding', goal_threshold_unit: '£', scale_frame: 20000000 },
      { id: SRC, kind: 'outcome', label: 'Angel investor conversations', scale_frame: 40 },
      { id: 'o-hold', kind: 'option', label: 'Continue firm outreach' },
    ],
    edges: [
      { from: SRC, to: 'funding', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
        defaulted: true, provenance: { source: 'cee_hypothesis' } },
    ],
  };
}

let persisted: unknown = servedGraph();
let receiptFor: ((write: Record<string, unknown>) => Record<string, unknown>) | undefined;
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    // The door verifies its OWN row and fact through these (as `route-v2-option-intervention-edit.test.ts` models them).
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-09-26T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-09-26T00:00:00.000Z', fact }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id, ...(receiptFor !== undefined ? { modelVersionReceipt: receiptFor(write) } : {}) };
    },
    getScenarioOwner: async () => null,
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

const currentHash = (): string => {
  const h = computeAnalysisAffectingGraphHash(persisted as never);
  if (h === null) throw new Error('fixture must have an analysis-affecting hash');
  return h;
};

describe('the bare answer to Olumi\'s recorded link-size question', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  let approvalChipsFor: typeof import('../../../src/orchestrator-v5/agent-lane/approval-chips.js').approvalChipsFor;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
    ({ approvalChipsFor } = await import('../../../src/orchestrator-v5/agent-lane/approval-chips.js'));
  });
  beforeEach(() => {
    persisted = servedGraph();
    rows.clear();
    receiptFor = (write) => ({
      mutation_id: '33333333-3333-4333-8333-333333333333', version_id: '44444444-4444-4444-8444-444444444444', version_number: 7,
      graph_identity_hash: 'a'.repeat(64), analysis_affecting_hash: 'b'.repeat(64), hash_algorithm: 'sha256',
      identity_projection_version: 'v1', identity_normaliser_version: 'v1', graph_schema_version: 'graph.v3',
      actor_kind: 'system', authored_by: null, creation_kind: 'committed_mutation', source_version_id: null,
      parent_version_id: null, root_version_id: null, undo_version_id: null, event_id: 'evt-compound',
      graph: write.graph, source_turn_id: write.turn_id,
    });
  });
  const agent = (user_text: string) => {
    const store = new ProposalStore();
    const d = async (path: string, body?: unknown) => {
      if (path.endsWith('/graph/register')) {
        const b = body as { graph: unknown; expected_graph_hash?: string; operation_id?: string };
        if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== currentHash()) return { status: 409, json: { code: 'GRAPH_STALE' } };
        persisted = b.graph;
        rows.set(`register/${String(b.operation_id)}`, { id: `row-${rows.size + 1}`, write: { scenario_id: SCENARIO_ID, turn_id: String(b.operation_id), graph: b.graph } });
        return { status: 200, json: { graph_hash: currentHash() } };
      }
      return { status: 200, json: { graph: persisted, graph_hash: currentHash() } };
    };
    const caps = createAgentCapabilities(d as never, store, undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-agent'),
    });
    return { caps, store, ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text, user_turn_text: user_text } };
  };
  const edgeOf = () => (persisted as { edges: { from: string; to: string; provenance?: Record<string, any> }[] })
    .edges.find((e) => e.from === SRC && e.to === 'funding')!;
  const pressing = (a: ReturnType<typeof agent>, p: Record<string, any>) => {
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(p.proposal_id) }],
      (id) => ({ proposal: a.store.get(id), result: p as never }))[0]!;
    return { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: card.message,
      typed_approval_of: String(p.proposal_id), typed_approval_words: card.message };
  };
  /** The producer's own record of the question, on the served bytes, read back as the next turn's open ask. */
  const openAsk = () => {
    const rec = linkSizeAskRecord(persisted, { message: 'Tell me about the link from "Angel investor conversations" to "funding".', restingText: '', awaitingApproval: false });
    expect(rec?.record, JSON.stringify(rec)).toBeTruthy();
    const pa = linkSizeAskPendingAction(rec!.record!, { scenario_id: SCENARIO_ID, emitted_at_iso: new Date().toISOString(), graph_hash: currentHash() });
    return { text: rec!.text, ask: openLinkSizeAskOnRow([pa], Date.now())!, pa };
  };
  const ARGS = { from_label: 'Angel investor conversations', to_label: 'funding', amount: 20000, amount_unit: '£', per_source_change: 1,
    per_source_change_unit: 'conversation', quote: 'About £20,000' };
  const asked = (reply: string, ask = openAsk().ask) => { const a = agent(reply); return { a, ctx: { ...a.ctx, link_size_ask: ask } }; };

  it('RED (R3 positive): ask → "About £20,000" → AIQ card → press → the user\'s amount, the question\'s per-one, marked as the answer', async () => {
    const { text, ask } = openAsk();
    expect(text).toBe('How much does one more "Angel investor conversations" add to "funding", in £?');
    const { a, ctx } = asked('About £20,000', ask);
    const p = await a.caps.proposeLinkEffect!(ctx, ARGS) as Record<string, any>;
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(p.public_label).toBe('Record your figure: each extra conversation of "Angel investor conversations" adds about £20,000 to "funding" (your answer to Olumi\u2019s question).');
    const press = pressing(a, p);
    expect(press.typed_approval_words).toBe(`Yes \u2014 ${p.public_label}`);
    const out = await a.caps.authoriseChange(press, { proposal_id: String(p.proposal_id) }) as Record<string, any>;
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(rows.size, 'ONE commit').toBe(1);
    const prov = edgeOf().provenance!;
    expect(prov).toMatchObject({ source: 'user_specified', magnitude: 'user_stated' });
    expect(prov.natural_effect).toMatchObject({ amount: 20000, per_source_change: 1, per_source_change_unit: 'conversations',
      answer_to_ask: { ask_id: ask.ask_id, per_source_change: 'from_question' } });
  });
  it('R3 negative: no open ask → refused, as today (nothing prepared)', async () => {
    const a = agent('About £20,000');
    const p = await a.caps.proposeLinkEffect!(a.ctx, ARGS);
    expect(p).toMatchObject({ ok: false, refusal: 'not_the_users_figure' });
  });
  it('R3 negative: a reply naming another quantity → not bound (control: the same reply without it binds)', async () => {
    (persisted as { nodes: unknown[] }).nodes.push({ id: 'seed_round_size', kind: 'factor', label: 'Seed round size' });
    const { a, ctx } = asked('About £20,000 of the seed round');
    const p = await a.caps.proposeLinkEffect!(ctx, { ...ARGS, quote: 'About £20,000' });
    expect(p).toMatchObject({ ok: false, refusal: 'not_the_answer', why: 'other_quantity_named' });
    const c = asked('About £20,000');
    expect((await c.a.caps.proposeLinkEffect!(c.ctx, ARGS)).ok).toBe(true);
  });
  it('R3 negative: "£20k and 3 deals" → refused, one line, nothing prepared', async () => {
    const { a, ctx } = asked('£20k and 3 deals');
    const p = await a.caps.proposeLinkEffect!(ctx, { ...ARGS, quote: '£20k' }) as Record<string, any>;
    expect(p).toMatchObject({ ok: false, refusal: 'not_the_answer', why: 'several_figures' });
    expect(p.detail).toMatch(/^Not recorded: your reply names another figure as well/);
  });
  it('R3 negative: the answer one turn late → the ask is gone (taken by the turn after it)', () => {
    const held = new OpenLinkSizeAsks();
    held.hold('s:u', openAsk().pa);
    expect(held.take('s:u', Date.now())).toBeDefined(); // the very next turn
    expect(held.take('s:u', Date.now())).toBeUndefined(); // any later turn
  });
  it('R3 negative: "not sure" → no card', async () => {
    const { a, ctx } = asked('not sure');
    const p = await a.caps.proposeLinkEffect!(ctx, { ...ARGS, quote: 'not sure' });
    expect(p).toMatchObject({ ok: false, refusal: 'not_the_users_statement', why: 'denied' });
    expect((p as Record<string, unknown>).proposal_id).toBeUndefined();
  });
  it('the model changed after the question → not recorded against it', async () => {
    const { a, ctx } = asked('About £20,000', { ...openAsk().ask, graph_hash: 'f'.repeat(16) });
    expect(await a.caps.proposeLinkEffect!(ctx, ARGS)).toMatchObject({ ok: false, refusal: 'model_changed_since_ask' });
  });
  it('a question about ANOTHER link binds nothing here', async () => {
    const { a, ctx } = asked('About £20,000', { ...openAsk().ask, from_id: 'some_other_node' });
    expect(await a.caps.proposeLinkEffect!(ctx, ARGS)).toMatchObject({ ok: false, refusal: 'not_the_users_figure' });
  });
  it('a quote from earlier words (not this turn\'s reply) binds nothing', async () => {
    const a = agent('About £20,000');
    const ctx = { ...a.ctx, user_turn_text: 'Thanks, that helps', link_size_ask: openAsk().ask };
    expect(await a.caps.proposeLinkEffect!(ctx, ARGS)).toMatchObject({ ok: false, refusal: 'not_the_users_figure' });
  });
  it('after a restart: two open asks on the row, or an expired one, bind nothing', () => {
    const { pa } = openAsk();
    expect(openLinkSizeAskOnRow([pa, { ...pa, id: 'other' }], Date.now())).toBeUndefined();
    expect(openLinkSizeAskOnRow([pa], Date.now() + 31 * 60 * 1000)).toBeUndefined();
  });
});
