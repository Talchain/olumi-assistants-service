/**
 * DL-3 RULING F (18 Oct; amends D-08 for Olumi's own disowned card only). G4: Olumi called its own held card ungrounded
 * and the card was offered again for six turns. Real route-v2 + Agent route, the harness of
 * `agent-proposal-user-in-control-seam.test.ts`; every row binds the card by its proposal id and the pending row.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6b1e2d3c-4b5a-4f6e-9d7c-8b9a0e1f4e${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
let graphOf = new Map<string, unknown>();
/** Every append that carried a graph, per scenario: "ONE graph-bearing row". */
const graphWrites = new Map<string, number>();
/**
 * Codex r1 P1 on #2743: run ONCE inside the persistence floor's own pending read (the read just before an answer row is
 * appended), to stage another request's write landing between a turn's reconcile and its append.
 */
let atFloorRead: (() => Promise<void>) | undefined;
const calledFromFloor = (): boolean => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 60;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = limit;
  return stack.includes('appendCheckedGraphWrite');
};
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
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  scenarioExists: vi.fn(async () => true),
  getScenarioOwner: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => ({ userId: null, graph: graphOf.get(SCENARIO), briefText: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => {
    if (atFloorRead !== undefined && calledFromFloor()) { const staged = atFloorRead; atFloorRead = undefined; await staged(); }
    return parsedPending(latestRow(sid), sid);
  }),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown; handler_facts?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date().toISOString() });
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
type Body = { _proposal_fields?: import('../proposal-object/record.js').ProposalFieldsWire; assistant_text: string; suggested_actions: Chip[]; _agent: { tool_calls: Call[]; receipts: readonly import('../turn-receipts.js').TurnReceipt[] }; _provider_calls?: { provider: string }[] };
type G = { nodes: { id: string; kind: string; label: string; [k: string]: unknown }[]; edges: { from: string; to: string; [k: string]: unknown }[]; goal_constraints?: Record<string, unknown>[] };

/** Canonical minimal graph. No incidental constraint or intervention repair can fail the writer's scope check. */
const seedGraph = (): G => ({ nodes: [
  { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
  { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
  { id: 'opt_a', kind: 'option', label: 'Keep £49' },
  { id: 'opt_b', kind: 'option', label: 'Raise to £59' },
], edges: [['dec_x', 'opt_a'], ['dec_x', 'opt_b'], ['opt_a', 'fac_hours'], ['opt_b', 'fac_hours']].map(([from, to]) => ({ from, to, strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })) });

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
// ⛔ INPUT CHANGE (#3002, known-origin transport): each stub link declares its origin, as a prompt-following AI gives it: user when it quotes the user; olumi, with Olumi's own basis, when it does not.
const withLinkClaim = (name: string, args: Record<string, unknown>): Record<string, unknown> => name === 'propose_link_strengths' && Array.isArray(args.links)
  ? { ...args, links: (args.links as Record<string, unknown>[]).map((l) => ({ origin: typeof l.from_words === 'string' ? 'user' as const : 'olumi' as const, ...(typeof l.from_words === 'string' ? {} : { basis: 'Olumi’s own estimate from the model' }), ...l })) } : args;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(withLinkClaim(name, args)) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

type Pending = import('../../session/pending-action.js').PendingAction;
const cardIdOf = (pa: Pending): string | undefined =>
  (pa.action as { inline_patch?: { agent_proposal?: { proposal_id?: string } } }).inline_patch?.agent_proposal?.proposal_id;

describe('DL-3 ruling F: Olumi takes back its own earlier card', () => {
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
      const id = (req.params as { id: string }).id;
      const g = graphOf.get(id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never) };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.useRealTimers(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
    nextScenario(); script = []; openAiCalls = 0; routerCalls.length = 0; atFloorRead = undefined; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    vi.setSystemTime(Date.now() + 10_000);
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as G;
  const bytes = () => JSON.stringify(graphOf.get(SCENARIO));
  const pending = async () => store.readMostRecentPendingActions(SCENARIO) as Promise<Pending[]>;
  /** The pending row's carrier of this card, by its proposal id. */
  const carrierOf = async (id: string) => (await pending()).find((pa) => cardIdOf(pa) === id);
  const seed = () => {
    const g = seedGraph();
    g.nodes.push({ id: 'fac_hours', kind: 'factor', label: 'Hours' }, { id: 'fac_cost', kind: 'factor', label: 'Cost' });
    g.edges.push({ from: 'fac_hours', to: 'goal_x', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }, defaulted: true, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_cost', to: 'goal_x', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }, defaulted: true, strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' });
    graphOf.set(SCENARIO, projectGraphForPersistence(g));
  };
  /** Olumi's own card: a starting assumption the user did not give. */
  const olumisCard = async () => {
    script = [() => fnCall('propose_assumptions', { assumptions: [
      { user_stated: false, factor_label: 'Hours', value: 10, unit: 'hours', basis: 'A starting estimate' },
    ] }), () => say('Here is a starting assumption for the missing figure.')];
    const b = await turn({ message: 'Suggest a starting assumption for the missing figure.' });
    const p = b._proposal_fields!.proposals.at(-1)!;
    expect(p.proposal_id).toMatch(/^prop_[0-9a-f]{32}$/);
    return p;
  };
  /** The user's own figure, offered on its card ("record 1 figure you gave"). */
  const usersCard = async () => {
    script = [() => fnCall('propose_assumptions', { assumptions: [
      { user_stated: true, factor_label: 'Hours', value: 12, unit: 'hours', basis: 'The user said Hours is 12 hours' },
    ] }), () => say('Here is your figure, ready to record.')];
    const b = await turn({ message: 'Hours is 12 hours.' });
    const p = b._proposal_fields!.proposals.at(-1)!;
    expect(p.proposal_id).toMatch(/^prop_[0-9a-f]{32}$/);
    return p;
  };
  /** A later turn on which the AI withdraws the card by its id, then replies. */
  const aiWithdraws = (id: string) => {
    script = [() => fnCall('withdraw_proposal', { proposal_id: id }), () => say('On reflection that estimate was not well grounded, so I have taken it back.')];
    return turn({ message: 'Is that figure well grounded?' });
  };
  const offeredIds = (b: Body) => b.suggested_actions.map((c) => c.id);
  const shownIds = (b: Body) => (b._proposal_fields?.proposals ?? []).map((x) => x.proposal_id);
  const countOf = (text: string, part: string) => text.split(part).length - 1;

  it('MAIN: Olumi’s earlier-turn held card, disowned and withdrawn, is set aside once and never re-served', async () => {
    seed(); const p = await olumisCard();
    // D-08 continuity, the positive control: an ordinary later turn offers the held card again.
    const control = await turn({ message: 'What else is missing?' });
    expect(offeredIds(control)).toContain(p.approve_action.id);
    expect(shownIds(control)).toContain(p.proposal_id);
    const carrier = await carrierOf(p.proposal_id);
    expect(carrier, 'the card is held on the latest row before the withdrawal').toBeDefined();
    const { heldDeclineSentence } = await import('../proposal-object/reply.js');
    const { heldChangeLabel } = await import('../proposal-object/record.js');
    const setAside = heldDeclineSentence(heldChangeLabel(carrier!));
    const before = bytes(); const writes = graphWrites.get(SCENARIO);

    const r = await aiWithdraws(p.proposal_id);
    expect(r._agent.tool_calls).toEqual([expect.objectContaining({ name: 'withdraw_proposal', ok: true, mutated: false, proposal_id: p.proposal_id })]);
    expect(countOf(r.assistant_text, setAside), 'the user sees it set aside, once').toBe(1);
    expect(offeredIds(r)).not.toContain(p.approve_action.id);
    expect(offeredIds(r)).not.toContain(p.decline_action.id);
    expect(shownIds(r)).not.toContain(p.proposal_id);
    expect(await carrierOf(p.proposal_id), 'not carried on the answer row').toBeUndefined();
    expect(bytes()).toBe(before); expect(graphWrites.get(SCENARIO)).toBe(writes);

    const next = await turn({ message: 'What else is missing?' });
    expect(offeredIds(next)).not.toContain(p.approve_action.id);
    expect(shownIds(next)).not.toContain(p.proposal_id);
    expect(countOf(next.assistant_text, setAside), 'said once, not again').toBe(0);
    expect(await carrierOf(p.proposal_id)).toBeUndefined();
    // Its own approve press now finds nothing to apply.
    const pressed = await turn({ source: 'chip', chip: { id: p.approve_action.id }, message: p.approve_action.message });
    expect(pressed._agent.tool_calls.filter((c) => c.ok && c.mutated)).toEqual([]);
    expect(bytes()).toBe(before);
  }, 180_000);

  it('CONTRAST user-authored: the user’s own figure card refuses withdrawal and stays offered', async () => {
    seed(); const p = await usersCard();
    const carrier = await carrierOf(p.proposal_id);
    expect(carrier, 'the user’s card is held').toBeDefined();
    const { agentProposalOf } = await import('../proposal-object/record.js');
    expect(agentProposalOf(carrier!)!.provenance.authored_by).toBe('user_stated');
    const before = bytes();
    const r = await aiWithdraws(p.proposal_id);
    expect(r._agent.tool_calls).toEqual([expect.objectContaining({ name: 'withdraw_proposal', ok: false, refusal: 'not_proposed_this_turn' })]);
    expect(r.assistant_text).not.toContain('Set aside:');
    expect(offeredIds(r)).toContain(p.approve_action.id);
    expect(shownIds(r)).toContain(p.proposal_id);
    expect(await carrierOf(p.proposal_id)).toBeDefined();
    expect(bytes()).toBe(before);
  }, 180_000);

  it('CONTRAST approved: an applied card refuses withdrawal and its figure stays in the model', async () => {
    seed(); const p = await olumisCard();
    const applied = await turn({ source: 'chip', chip: { id: p.approve_action.id }, message: p.approve_action.message });
    expect(applied._agent.tool_calls).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    const before = bytes(); const writes = graphWrites.get(SCENARIO);
    expect(graphNow().nodes.find((x) => x.id === 'fac_hours')!.observed_state).toMatchObject({ raw_value: 10 });
    const r = await aiWithdraws(p.proposal_id);
    expect(r._agent.tool_calls).toEqual([expect.objectContaining({ name: 'withdraw_proposal', ok: false, refusal: 'not_proposed_this_turn' })]);
    expect(r.assistant_text).not.toContain('Set aside:');
    expect(bytes()).toBe(before); expect(graphWrites.get(SCENARIO)).toBe(writes);
  }, 180_000);

  it('CONTRAST other scenario: another scenario’s card refuses withdrawal there and stays offered on its own', async () => {
    seed(); const p = await olumisCard(); const own = SCENARIO;
    nextScenario(); seed();
    const r = await aiWithdraws(p.proposal_id);
    expect(r._agent.tool_calls).toEqual([expect.objectContaining({ name: 'withdraw_proposal', ok: false, refusal: 'not_proposed_this_turn' })]);
    expect(r.assistant_text).not.toContain('Set aside:');
    SCENARIO = own;
    expect(await carrierOf(p.proposal_id)).toBeDefined();
    const back = await turn({ message: 'What else is missing?' });
    expect(offeredIds(back)).toContain(p.approve_action.id);
    expect(shownIds(back)).toContain(p.proposal_id);
  }, 180_000);

  it('CONTRAST stale model: a card pinned to an older model refuses withdrawal and fares exactly as without the call', async () => {
    /** The same card, then another writer moves the model (a new factor; the card's own subject is unchanged). */
    const staleCard = async () => {
      seed(); const p = await olumisCard();
      const pin = (await carrierOf(p.proposal_id))!.preconditions.graph_hash;
      const g = graphNow(); graphOf.set(SCENARIO, projectGraphForPersistence({ ...g, nodes: [...g.nodes, { id: 'fac_morale', kind: 'factor', label: 'Morale' }] }));
      const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
      expect(computeAnalysisAffectingGraphHash(graphNow() as never), 'the model moved').not.toBe(pin);
      return p;
    };
    const reply = 'On reflection that estimate was not well grounded, so I have taken it back.';
    // Twin without the call: what the lifecycle does with this card on its own.
    const q = await staleCard();
    script = [() => say(reply)];
    const without = await turn({ message: 'Is that figure well grounded?' });
    const keptWithout = (await carrierOf(q.proposal_id)) !== undefined;
    nextScenario();
    const p = await staleCard();
    const r = await aiWithdraws(p.proposal_id);
    expect(r._agent.tool_calls).toEqual([expect.objectContaining({ name: 'withdraw_proposal', ok: false, refusal: 'not_proposed_this_turn' })]);
    expect(r.assistant_text).not.toContain('Set aside:');
    expect(r.assistant_text, 'the same words as the twin without the call').toBe(without.assistant_text);
    expect((await carrierOf(p.proposal_id)) !== undefined, 'carried exactly as the twin is').toBe(keptWithout);
    expect(offeredIds(r).some((x) => x.includes(p.proposal_id))).toBe(offeredIds(without).some((x) => x.includes(q.proposal_id)));
  }, 240_000);

  it('THIS TURN unchanged: a card proposed and withdrawn in the same turn is withdrawn, never offered', async () => {
    seed();
    script = [() => fnCall('propose_assumptions', { assumptions: [
      { user_stated: false, factor_label: 'Hours', value: 10, unit: 'hours', basis: 'A starting estimate' },
    ] }), (body) => {
      const outputs = (body.input as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output');
      const id = (JSON.parse(outputs.at(-1)!.output!) as { proposal_id: string }).proposal_id;
      return fnCall('withdraw_proposal', { proposal_id: id });
    }, () => say('I took that back before showing it.')];
    const r = await turn({ message: 'Suggest a starting assumption for the missing figure.' });
    const [proposed, withdrawn] = r._agent.tool_calls;
    expect(proposed).toMatchObject({ name: 'propose_assumptions', ok: true });
    expect(withdrawn).toMatchObject({ name: 'withdraw_proposal', ok: true, proposal_id: proposed!.proposal_id });
    expect(offeredIds(r).filter((x) => x.includes(proposed!.proposal_id!))).toEqual([]);
    expect(shownIds(r)).not.toContain(proposed!.proposal_id);
    expect(await carrierOf(proposed!.proposal_id!)).toBeUndefined();
  }, 180_000);
});
