import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SessionTurnWrite } from '../../orchestrator-v5/session/store.js';
import { SupabaseSessionStore } from '../../orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../orchestrator-v5/session/cache.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { runExplanationChip, RUN_EXPLANATION_PREFIX } from '../../orchestrator-v5/agent-lane/run-explanation.js';
import { agentProposals } from '../../orchestrator-v5/agent-lane/held-approval-offers.js';
import { parseAnswerOffers } from '../../orchestrator-v5/agent-lane/answer-offers-envelope.js';
import { createProposal } from '../../orchestrator-v5/agent-lane/proposal.js';
import { proposalPendingAction } from '../../orchestrator-v5/agent-lane/durable-proposal.js';
import { parsePendingAction, type PendingAction } from '../../orchestrator-v5/session/pending-action.js';

const { port, source, identity, finalOffers } = vi.hoisted(() => ({
  port: { append: vi.fn(), appendIfLatest: undefined as undefined | ((...a: unknown[]) => unknown), readRecent: vi.fn(), readLatestAnswerOffers: vi.fn(), readCommittedTurn: vi.fn(),
    ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(),
    readExistingScenario: vi.fn(), isScenarioMember: vi.fn(), readMostRecentPendingActions: vi.fn() },
  source: { analysis: {} as Record<string, unknown> },
  identity: { userId: '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b' },
  finalOffers: { value: null as null | Record<string, unknown>[] },
}));
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => port }));
vi.mock('../../config/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false },
    proxy: { ...actual.config.proxy, agentLaneEnabled: true, agentLanePreview: false } } };
});
vi.mock('../../orchestrator/user-identity.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'verified', userId: identity.userId }),
}));
// The canonical analysis producer is fixed locally; both real doors consume exactly this same read.
vi.mock('../scenario-graph-analysis-read.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), readScenarioAnalysis: async () => source.analysis,
}));
vi.mock('../../utils/telemetry.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, key) => String(key) }) }));
// Row 7 injects a deliberately mixed FINAL wire after real egress, before the real answer-row commit.
vi.mock('../../orchestrator-v5/agent-lane/leader-final-egress.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../orchestrator-v5/agent-lane/leader-final-egress.js')>();
  return { ...actual, enforceLeaderLicenceAtFinalEgress: (...args: Parameters<typeof actual.enforceLeaderLicenceAtFinalEgress>) => {
    const result = actual.enforceLeaderLicenceAtFinalEgress(...args);
    return finalOffers.value === null ? result : { ...result, response: { ...result.response, suggested_actions: finalOffers.value } };
  } };
});

import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
import { agentV1TurnRoute, isDurableAnswerOffer, NEXT_STEP_CHIPS, NEXT_STEP_AFTER_BLOCKED_RUN_CHIP,
  SUGGEST_STARTING_ASSUMPTIONS_CHIP, REBUILD_AFTER_TOO_LARGE_CHIP, RUN_OFFER_CHIP } from '../agent-v1-turn.js';
import { answerOffersForReload } from '../../orchestrator-v5/agent-lane/answer-offers-reload.js';

const OWNER = identity.userId;
const MEMBER = '9e8d7c6b-5a49-4382-b716-0c5d4e3f2a1b';
const GRAPH = { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges: [] };
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const AT = '2026-10-06T20:55:00.000Z';
const CURRENT = { run_state: { kind: 'complete_current', computed_at: AT }, usable_for_chips: true, leader_claim: { permitted: false } };
const READY = { status: 'ready', may_run: true };
const RESULT = { type: 'analysis_result', computed_against_hash: HASH, data: {} };
const EXPECTED = [
  { id: 'agent-next-pre-mortem', label: 'Run a pre-mortem', message: 'Run a pre-mortem with me: imagine this decision went badly. What most plausibly went wrong?' },
  { id: 'agent-next-what-would-change', label: 'What would change this?', message: 'What would most likely change this result?' },
  { id: 'agent-next-strengthen', label: 'Strengthen the model', message: 'What would most strengthen this model?' },
];
let serial = 0;
let scenario: string;
let table: Record<string, unknown>[];
let latest: PendingAction[];
let realStore: SupabaseSessionStore;
let app: FastifyInstance;
const selections: string[] = [];
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/20261006230000_agent_answer_offers.sql', import.meta.url), 'utf8');
const SQL_OFFER_ID = /^agent-[a-z0-9-]{1,80}$/;
// Only the database transport is fake: the real store's writer, hot projection and narrow reader run.
const client = {
  from: () => {
    let columns: string[] = []; let cap = Infinity;
    const checks: ((row: Record<string, unknown>) => boolean)[] = [];
    const orders: { key: string; ascending: boolean }[] = [];
    const chain = {
      select: (s: string) => { selections.push(s); columns = s.split(',').map(c => c.trim()); return chain; },
      eq: (k: string, v: unknown) => { checks.push(row => row[k] === v); return chain; },
      is: (k: string, v: unknown) => { checks.push(row => row[k] === v); return chain; },
      like: (k: string, v: string) => { checks.push(row => String(row[k]).startsWith(v.slice(0, -1))); return chain; },
      not: (k: string, op: string, v: unknown) => { checks.push(row => op === 'like'
        ? !String(row[k]).endsWith(String(v).slice(1)) : row[k] !== v); return chain; },
      order: (key: string, options: { ascending: boolean }) => { orders.push({ key, ...options }); return chain; },
      abortSignal: () => chain,
      limit: (n: number) => { cap = n; return chain; },
      then: (resolve: (v: unknown) => void) => resolve({ data: table.filter(row => checks.every(check => check(row)))
        .sort((a, b) => { for (const o of orders) { const cmp = String(a[o.key]).localeCompare(String(b[o.key])); if (cmp) return o.ascending ? cmp : -cmp; } return 0; })
        .slice(0, cap).map(row => Object.fromEntries(columns.map(c => [c, row[c]]))), error: null }),
    };
    return chain;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    // The migration's own offer check (20261006230000, reached from append_agent_answer_if_latest too), transcribed:
    // a row the database would refuse is refused here, before anything is written.
    if ((name === 'append_agent_answer_with_offers' || name === 'append_agent_answer_if_latest') && args.p_suggested_actions != null) {
      const offers = args.p_suggested_actions as Record<string, unknown>[];
      const bad = !Array.isArray(offers) || offers.length < 1 || offers.length > 8 || offers.some(o => o === null || typeof o !== 'object'
        || Object.keys(o).some(k => k !== 'id' && k !== 'label' && k !== 'message')
        || typeof o.id !== 'string' || typeof o.label !== 'string' || typeof o.message !== 'string'
        || !SQL_OFFER_ID.test(o.id) || o.id === 'agent-run-analysis'
        || [...o.label].length < 1 || [...o.label].length > 80 || [...o.message].length < 1 || [...o.message].length > 400);
      if (bad) return { data: null, error: { code: 'P0001', message: 'invalid plain-text answer offer' } };
    }
    // 20261007090000: the latest non-claim row must still be the one the caller read, or nothing is written.
    if (name === 'append_agent_answer_if_latest'
      && (table.find(r => r.scenario_id === args.p_scenario_id && !String(r.turn_id).endsWith(':claim'))?.id ?? null) !== args.p_expected_latest_row_id) {
      return { data: { status: 'latest_moved' }, error: null };
    }
    const prior = table.find(r => r.scenario_id === args.p_scenario_id && r.turn_id === args.p_turn_id);
    const id = prior?.id ?? `11111111-1111-4111-8111-${String(table.length + 1).padStart(12, '0')}`;
    if (!prior) table.unshift({ id, scenario_id: args.p_scenario_id, user_id: OWNER,
      turn_id: args.p_turn_id, turn_class: args.p_turn_class, handler_id: args.p_handler_id,
      request_hash: args.p_request_hash, response_emitted: args.p_response_emitted,
      llm_calls_used: args.p_llm_calls_used, duration_ms: args.p_duration_ms,
      created_at: new Date(Date.parse(AT) + table.length * 1000).toISOString(),
      user_message: args.p_user_message, assistant_message: args.p_assistant_message,
      pending_actions: args.p_pending_actions, coaching_state: args.p_coaching_state,
      agent_guidance: args.p_agent_guidance ?? null, suggested_actions: args.p_suggested_actions ?? null,
      suggested_actions_run_key: args.p_suggested_actions_run_key ?? null });
    return { data: name === 'append_agent_answer_with_offers' || name === 'append_agent_answer_with_guidance'
      || (name === 'append_agent_answer_if_latest' && (args.p_suggested_actions != null || args.p_agent_guidance != null))
      ? { id, replayed_prior_turn: !!prior && prior.request_hash === args.p_request_hash,
        prior_turn_conflict: !!prior && prior.request_hash !== args.p_request_hash } : id, error: null };
  },
};
/** The conditional answer append the deployed store takes (the AIE failures were on it); only rows that ask for it. */
const conditionalAppend = () => {
  port.appendIfLatest = (w: unknown, o: unknown) => realStore.appendIfLatest(w as SessionTurnWrite, o as never);
  port.readMostRecentPendingActions.mockImplementation(async (sid: string, o?: { onLatestRowId?: (id: string | null) => void }) => {
    o?.onLatestRowId?.((table.find(r => r.scenario_id === sid && !String(r.turn_id).endsWith(':claim'))?.id as string | undefined) ?? null);
    return latest;
  });
};
const coldStore = () => {
  realStore = new SupabaseSessionStore(client as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 50 }), { defaultReadLimit: 20 });
  port.append.mockImplementation((w: SessionTurnWrite) => realStore.append(w));
  port.readRecent.mockImplementation((s: string, n?: number) => realStore.readRecent(s, n));
  port.readCommittedTurn.mockImplementation((s: string, t: string) => realStore.readCommittedTurn(s, t));
  port.readLatestAnswerOffers.mockImplementation((s: string) => realStore.readLatestAnswerOffers(s));
};

beforeEach(async () => {
  vi.clearAllMocks(); serial += 1; scenario = `6f1e2d3c-4b5a-4e6d-9c7b-${String(serial).padStart(12, '0')}`;
  port.appendIfLatest = undefined; table = []; latest = []; selections.length = 0; rpcCalls.length = 0; identity.userId = OWNER; finalOffers.value = null;
  source.analysis = { analysis_state: CURRENT, analysis_result: RESULT,
    current_read: { analysis_ready: READY, result: RESULT }, analysis_constraint_verdict_state: null };
  coldStore();
  port.ensureScenarioExists.mockResolvedValue({ user_id: OWNER }); port.getScenarioOwner.mockResolvedValue(OWNER);
  port.scenarioExists.mockResolvedValue(true); port.isScenarioMember.mockResolvedValue(false);
  port.readExistingScenario.mockResolvedValue({ userId: OWNER, graph: GRAPH, briefText: 'How can we improve velocity?', analysisInvalidatedAt: null });
  port.readMostRecentPendingActions.mockImplementation(async () => latest);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message',
    content: [{ type: 'output_text', text: 'In the current model, the link matters.' }] }] }), { status: 200 })));
  app = Fastify({ logger: false });
  await scenarioGraphRoute(app); await app.register(agentV1TurnRoute); await app.ready();
});
afterEach(async () => {
  await app.close(); vi.unstubAllGlobals();
  for (const proposal of agentProposals.outstanding(scenario, OWNER)) agentProposals.discard(proposal.proposal_id);
});
const ask = async (turnId = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1') => {
  const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: scenario, turn_id: turnId, message: 'What do you make of this?' } });
  expect(response.statusCode).toBe(200); return response.json();
};
const read = async (sid = scenario) => {
  const response = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${sid}/graph`, payload: { include_conversation_turns: true } });
  expect(response.statusCode).toBe(200); return response.json();
};
const noOffers = (body: { conversation_turns: Record<string, unknown>[] }) => {
  expect(body.conversation_turns.length).toBeGreaterThan(0);
  for (const turn of body.conversation_turns) expect(turn).not.toHaveProperty('suggested_actions');
};
// Every negative witness first crosses the same positive commit/read twin, preventing a dead reader from passing.
const positive = async () => {
  const live = await ask(); expect(live.suggested_actions).toEqual(EXPECTED);
  const stored = table.find(r => r.turn_id === 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1')!;
  expect(stored.suggested_actions).toEqual(EXPECTED);
  const chip = runExplanationChip(scenario, { graphHash: HASH, analysisState: CURRENT, analysisResult: RESULT });
  expect(chip).not.toBeNull(); expect(stored.suggested_actions_run_key).toBe(chip!.id.slice(RUN_EXPLANATION_PREFIX.length));
  coldStore(); const body = await read();
  expect(body.conversation_turns.at(-1)).toHaveProperty('turn_id', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  expect(body.conversation_turns.at(-1).suggested_actions).toEqual(EXPECTED);
  for (const action of body.conversation_turns.at(-1).suggested_actions) expect(Object.keys(action).sort()).toEqual(['id', 'label', 'message']);
  return body;
};

describe('X4 real commit door → cold graph-read door', () => {
  it('RED row 1: final Agent answer offers the witnessed three next steps and the LAST restored turn retains them', async () => {
    expect(NEXT_STEP_CHIPS).toEqual(EXPECTED); await positive();
    expect(rpcCalls.some(c => c.name === 'append_agent_answer_with_offers')).toBe(true);
    expect(selections.filter(s => s.includes('suggested_actions')).every(s =>
      s === 'turn_id, request_hash, suggested_actions, suggested_actions_run_key')).toBe(true);
  });
  it('row 2: stale Run drops all offers; also discriminates the existing stillValidOffers call on an unusable current Run', async () => {
    await positive(); source.analysis.analysis_state = { ...CURRENT, run_state: { kind: 'complete_stale', computed_at: AT }, usable_for_chips: false };
    noOffers(await read());
    // Same binding, but chips are withheld: removing stillValidOffers must fail this twin.
    source.analysis.analysis_state = { ...CURRENT, usable_for_chips: false }; noOffers(await read());
  });
  it('row 3: a later Run of the SAME graph cannot inherit the older answer offers', async () => {
    await positive(); source.analysis.analysis_state = { ...CURRENT, run_state: { kind: 'complete_current', computed_at: '2026-10-06T21:00:00.000Z' } };
    expect((await read()).graph).toEqual(GRAPH); noOffers(await read());
  });
  it('row 4: another scenario never carries the offers, even with matching graph and answer turn id', async () => {
    await positive(); const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const row = table.find(r => r.turn_id === 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1')!;
    // Defence in depth: deliberately transplant the original Run key; its scenario binding must refuse it.
    table.unshift({ ...row, id: '22222222-2222-4222-8222-222222222222', scenario_id: other }); coldStore();
    noOffers(await read(other));
  });
  it('row 5: an executable held proposal suppresses next steps and leaves held_proposal_offers intact', async () => {
    await positive();
    const proposal = createProposal({ scenario_id: scenario, user_id: OWNER, base_graph_identity_hash: HASH,
      operations: [{ op: 'add_edge', path: 'f1::o1', value: 0.4 }], provenance: { authored_by: 'model_proposed' },
      validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'The held change' });
    const chip = { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Record this link', message: 'Yes, record that.', detail: 'The exact offered card.' };
    const pa = parsePendingAction(proposalPendingAction(proposal, chip, { scenario_id: scenario, emitted_at_iso: new Date().toISOString() }))!;
    expect(pa).not.toBeNull(); latest = [pa];
    const old = table.find(r => r.turn_id === 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1')!;
    table.push({ ...old, id: '33333333-3333-4333-8333-333333333333', turn_id: 'held-answer',
      created_at: '2026-10-06T20:54:00.000Z', suggested_actions: null, suggested_actions_run_key: null,
      pending_actions: [pa], assistant_message: 'Approve this change?' });
    coldStore(); const waiting = await read(); noOffers(waiting);
    expect(waiting.held_proposal_offers).toEqual([{ turn_id: 'held-answer', proposal_id: proposal.proposal_id,
      suggested_actions: expect.arrayContaining([chip]) }]);
    port.readLatestAnswerOffers.mockResolvedValueOnce(null);
    expect((await read()).held_proposal_offers).toEqual(waiting.held_proposal_offers);
    // The same gate also consults the existing warm executable proposal authority.
    latest = []; agentProposals.put(proposal); coldStore(); noOffers(await read());
  });
  it('row 6: a newer answer without offers prevents restoring an older answer\'s offers', async () => {
    await positive(); finalOffers.value = []; await ask('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'); coldStore();
    const body = await read(); expect(body.conversation_turns.at(-1).turn_id).toBe('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'); noOffers(body);
    expect(table.find(r => r.turn_id === 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1')?.suggested_actions).toEqual(EXPECTED);
    const old = table.find(r => r.turn_id === 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1')!;
    port.readLatestAnswerOffers.mockResolvedValueOnce({ turn_id: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', suggested_actions: EXPECTED, run_key: old.suggested_actions_run_key });
    noOffers(await read()); // Never attach controls to an older restored turn, even if the optional port returns it.
  });
  it('RED row 7: mixed final wire stores only the next step; approve, Run, research, Explain and metadata never persist here', async () => {
    await positive();
    const explanation = runExplanationChip(scenario, { graphHash: HASH, analysisState: CURRENT, analysisResult: RESULT })!;
    finalOffers.value = [
      { id: 'agent-approve-proposal:held', label: 'Record this link', message: 'Yes', detail: 'Held card' },
      { ...RUN_OFFER_CHIP }, { id: 'agent-research:held', label: 'Search the web', message: 'Search' },
      explanation, EXPECTED[1]!, { ...EXPECTED[0], action_type: 'run_analysis' }, { ...EXPECTED[2], detail: 'extra' },
    ];
    const live = await ask('aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3'); expect(live.suggested_actions).toEqual(finalOffers.value);
    expect(table.find(r => r.turn_id === 'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3')?.suggested_actions).toEqual([EXPECTED[1]]);
    coldStore(); expect((await read()).conversation_turns.at(-1).suggested_actions).toEqual([EXPECTED[1]]);
  });
  it('RED row 7b (AIE 6048621134): a widen Add press in the final answer never costs the answer its row; it stays live, unstored', async () => {
    // The harness's offer check is the migration's own, word for word.
    expect(MIGRATION).toContain(`(v_action->>'id') !~ '${SQL_OFFER_ID.source}'`);
    expect(MIGRATION).toContain(`RAISE EXCEPTION 'invalid plain-text answer offer'`);
    await positive(); conditionalAppend();
    const add = { id: 'agent-widen-add:0123456789abcdef', label: 'Add', message: 'Add the risk ‘Existing customers downgrade’ to ‘Launch Starter Tier’.' };
    finalOffers.value = [add, EXPECTED[0]!];
    const live = await ask('aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4'); expect(live.suggested_actions).toEqual([add, EXPECTED[0]]);
    expect(table.find(r => r.turn_id === 'aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4')?.suggested_actions).toEqual([EXPECTED[0]]);
    expect(rpcCalls.filter(c => c.args.p_turn_id === 'aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4').map(c => c.name)).toEqual(['append_agent_answer_if_latest']);
    coldStore(); expect((await read()).conversation_turns.at(-1)).toMatchObject({ turn_id: 'aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4', suggested_actions: [EXPECTED[0]] });
  });
  it('row 7c (retry-safe): the same widen-Add answer sent again under its turn id replays the one recorded answer; no second row', async () => {
    await positive();
    const add = { id: 'agent-widen-add:0123456789abcdef', label: 'Add', message: 'Add the risk ‘Existing customers downgrade’ to ‘Launch Starter Tier’.' };
    finalOffers.value = [add, EXPECTED[0]!];
    conditionalAppend();
    const first = await ask('aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5');
    const provider = vi.mocked(fetch).mock.calls.length;
    const again = await ask('aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5');
    expect(vi.mocked(fetch).mock.calls.length, 'the retry runs no model call').toBe(provider);
    expect(rpcCalls.filter(c => c.args.p_turn_id === 'aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5').map(c => c.name), 'one append, never a second')
      .toEqual(['append_agent_answer_if_latest']);
    expect(table.filter(r => r.turn_id === 'aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5')).toHaveLength(1);
    expect(again.assistant_text).toBe(first.assistant_text);
    expect(rpcCalls.filter(c => c.args.p_turn_id === 'aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5').every(c => c.args.p_suggested_actions == null
      || (c.args.p_suggested_actions as { id: string }[]).every(o => SQL_OFFER_ID.test(o.id)))).toBe(true);
  }, 30_000);
  it('row 8: a viewer member still receives no conversation or answer offers', async () => {
    await positive(); identity.userId = MEMBER; port.isScenarioMember.mockResolvedValue(true);
    const before = port.readLatestAnswerOffers.mock.calls.length;
    const body = await read(); expect(body.graph).toEqual(GRAPH); expect(body).not.toHaveProperty('conversation_turns');
    expect(port.readLatestAnswerOffers.mock.calls.length).toBe(before);
  });
  it('row 9: turns without offers keep exactly four keys; failed offers reads change no other response field', async () => {
    const body = await positive();
    port.readLatestAnswerOffers.mockRejectedValueOnce(new Error('missing column'));
    const failed = await read(); noOffers(failed);
    const clean = (b: Record<string, unknown>) => ({ ...b, request_id: undefined,
      conversation_turns: (b.conversation_turns as Record<string, unknown>[]).map(({ suggested_actions: _offers, ...t }) => t) });
    expect(clean(failed)).toEqual(clean(body));
    for (const turn of failed.conversation_turns) expect(Object.keys(turn).sort()).toEqual(['assistant_message', 'created_at', 'turn_id', 'user_message']);
  });
  it('row 10 (buddy r1 P1): an unexpired approval in the latest carrier withholds next steps on a COLD worker that cannot recover its card', async () => {
    await positive();
    const proposal = createProposal({ scenario_id: scenario, user_id: OWNER, base_graph_identity_hash: HASH,
      operations: [{ op: 'add_edge', path: 'f1::o1', value: 0.4 }], provenance: { authored_by: 'model_proposed' },
      validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'The held change' });
    const chip = { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Record this link', message: 'Yes, record that.', detail: 'The exact offered card.' };
    const pa = parsePendingAction(proposalPendingAction(proposal, chip, { scenario_id: scenario, emitted_at_iso: new Date().toISOString() }))!;
    expect(pa).not.toBeNull();
    // Cold worker: the proposal is not in this process, and NO answer row carries its card.
    agentProposals.discard(proposal.proposal_id); latest = [pa]; coldStore();
    const waiting = await read(); noOffers(waiting);
    expect(waiting.held_proposal_offers ?? []).toEqual([]); // no card is recoverable: the field is empty or absent
    // Positive twin in the same state minus the carrier: the next steps are served again.
    latest = []; coldStore();
    expect((await read()).conversation_turns.at(-1).suggested_actions).toEqual(EXPECTED);
  });
  it('the envelope refuses the Run chip id, as the migration does (buddy r1 #2)', () => {
    expect(parseAnswerOffers([{ id: 'agent-run-analysis', label: 'Run analysis', message: 'Run analysis.' }])).toBeNull();
    expect(parseAnswerOffers(EXPECTED)).toEqual(EXPECTED);
  });
  it('null Run binding restores nothing; the repair chips are never durable (buddy r1 #3)', async () => {
    await positive(); table.find(r => r.turn_id === 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1')!.suggested_actions_run_key = null; coldStore(); noOffers(await read());
    const repairs = [REBUILD_AFTER_TOO_LARGE_CHIP, NEXT_STEP_AFTER_BLOCKED_RUN_CHIP, SUGGEST_STARTING_ASSUMPTIONS_CHIP];
    const stored = { turn_id: 'repairs', run_key: null, suggested_actions: [...EXPECTED, ...repairs] };
    expect(answerOffersForReload(stored, scenario, { graphHash: HASH, analysisState: { run_state: { kind: 'none' } },
      analysisReady: { status: 'blocked', may_run: false }, analysisResult: null, outstandingProposalIds: new Set(), modelExists: false })).toEqual([]);
    expect(repairs.some(isDurableAnswerOffer)).toBe(false);
    expect(EXPECTED.every(isDurableAnswerOffer)).toBe(true);
  });
});
