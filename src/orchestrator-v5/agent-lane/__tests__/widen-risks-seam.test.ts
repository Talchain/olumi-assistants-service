/**
 * ⭐ S-C MODEL WIDENING, target risks, on the LIVE route end to end (DL 0fd71f 7 Oct, lane WIDEN; Paul's prod test D-11):
 *   "Suggest risks" press → ONE tool-less model call → the identity gate → a deterministic reply (method, what each hits,
 *   one gap question) + one Add per item + Something else, NOTHING stored → Add → NO model call → the existing add-risk
 *   door holds ONE card → the existing approve → the risk is in the model WITH its driver (never inert, D-09).
 * The model is Paul's served v1 (scenario 6582edbc, CEE 7e3f8fb2), reconstructed from its run fact; the risk names are the
 * ones served as prose on turn #2 ("None has been added", no Add buttons).
 *
 * HARNESS: copied from `widen-turn-seam.test.ts` (itself from `agent-add-option-held-seam.test.ts`): the REAL route-v2 and
 * the REAL Agent route in one app, a stateful store with production read semantics, OpenAI scripted.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { asSent } from './helpers/as-sent.js';
import { readFileSync } from 'node:fs';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `5a0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d2c${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
let graphOf = new Map<string, unknown>();
/** The latest ANSWER row for a scenario — claim rows excluded, exactly as the production read excludes them. */
const latestRow = (sid: string = SCENARIO): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
/** What a Postgres `jsonb` column gives back: keys shorter-first then bytewise, `undefined` dropped. */
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
        // Stored with the turn, as `append_turn_atomic` does, so a writer's own read-back of its fact is served.
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date(Date.UTC(2026, 8, 26, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  // The production shape (`supabase-store.ts` readFactsWithTurnFor): each stored fact with the id of the turn row it rode on.
  readFactsWithTurnFor: vi.fn(async (ids: readonly string[]) => [...rows.values()].filter((r) => ids.includes(r.id))
    .flatMap((r) => r.handler_facts.map((fact) => ({ turn_id: r.id, fact })))),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  storeDraftGraph: vi.fn(async (sid: string, g: unknown) => { graphOf.set(sid, g); }),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
/** route-v2's LLM router: the typed add-option and its confirm are deterministic — ANY use is a failure. */
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the typed add-option seam (${what})`); };
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
type Body = { assistant_text: string; suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string }; _provider_calls?: { provider: string; outcome?: string }[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string; conflict_fields?: string[]; rejected_levels?: Record<string, unknown>[] }[] } };

/** Scripted OpenAI: each Agent model call takes the next reply; anything that is not OpenAI throws. */
let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** The inner requests the Agent sent to route-v2, in order. */
let inner: Record<string, unknown>[] = [];
/** Runs inside the inner request's preHandler — BEFORE route-v2 reads the store (a writer racing the confirm). */
let onInner: ((body: Record<string, unknown>) => void) | undefined;
/** Runs as route-v2's answer to an inner request is sent — AFTER it has decided. */
let onInnerSent: ((body: Record<string, unknown>) => void) | undefined;
/** Extra keys on the graph read (an analysis state), per row. */
let extraRead: Record<string, unknown> = {};

describe('S-C WIDEN risks on the live route: suggestions, then ONE card per Add', () => {
  async function buildApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const { computeGraphIdentityHash } = await import('../../context/graph-identity.js');
    const a = Fastify({ logger: false });
    a.addHook('preHandler', async (req) => { if (req.url === '/orchestrate/v2/turn') { inner.push(req.body as Record<string, unknown>); onInner?.(req.body as Record<string, unknown>); } });
    a.addHook('onSend', async (req, _reply, payload) => { if (req.url === '/orchestrate/v2/turn') onInnerSent?.(req.body as Record<string, unknown>); return payload; });
    a.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never),
        graph_identity_hash: g === null ? null : computeGraphIdentityHash(g as never), ...extraRead };
    });
    await a.register(ceeOrchestratorRouteV2);
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }
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
    app = await buildApp();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; inner = []; onInner = undefined; onInnerSent = undefined; routerCalls.length = 0; extraRead = {}; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as { nodes: { id: string; kind: string; label: string; proposed_by?: string;
    analysis_participation?: string; interventions?: Record<string, unknown> }[]; edges: { from: string; to: string }[] };
  const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
  /** The hold the Agent's LATEST answer row carries — what the next turn (and route-v2's confirm) will read. */
  const heldOnLatestRow = async () => {
    const pendings = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; expires_at_turn_count: number; action: { kind: string; inline_patch?: { handler_id?: string; operations?: { op: string; path: string }[] } } }[];
    return pendings.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };


  const RISKS = { id: 'agent-next-suggest-risks', message: "Suggest risks I haven't considered." };
  const paulV1 = () => {
    const g = JSON.parse(readFileSync(new URL('../method-turn/__tests__/fixtures/s-c-widen/paul-6582edbc-v1.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    delete g['_provenance'];
    graphOf.set(SCENARIO, g);
  };
  /** Served turn #2's prose risks (forensics D-11), as the typed candidates the method call now returns. */
  const TURN2 = [
    { label: 'Recruitment delay', category: 'timing', hits_id: 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive',
      affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'filling both developer roles quickly', watch_for: 'no accepted offer by week 4' },
    { label: 'Wrong bottleneck', category: 'dependency', hits_id: 'hire_a_tech_lead', through_id: 'tech_lead_hires', through_direction: 'positive',
      affects_id: 'meet_our_next_feature_launch_deadline', direction: 'negative', relies_on: 'a Tech Lead removing the main delivery blocker', watch_for: 'delays persist after the Tech Lead starts' },
    { label: 'Coordination drag', category: 'people', hits_id: 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive',
      affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'new developers joining without slowing the team', watch_for: 'senior time spent on onboarding' },
    { label: 'Quality trade-off', category: 'cost', hits_id: 'hire_a_tech_lead', through_id: 'tech_lead_hires', through_direction: 'positive',
      affects_id: 'meet_our_next_feature_launch_deadline', direction: 'negative', relies_on: 'keeping quality while hiring under time pressure', watch_for: 'rising defect counts before launch' },
  ];
  const candidates = (items: unknown) => say(`<risk_suggestions>${JSON.stringify(items)}</risk_suggestions>`);
  const nodeLabels = () => graphNow().nodes.map((x) => x.label).sort();
  const addChips = (b: Body) => b.suggested_actions.filter((c) => c.id.startsWith('agent-widen-add:'));
  /** #2742 S1's ONE question for a chance goal with no date (`chanceGoalDeadlineAsk`), verbatim. */
  const S1_ASK = 'What is the deadline for "meet our next feature-launch deadline"? A date or a time from now is fine, for example "6 months"; I\'ll propose it as your deadline.';
  const gapOf = (b: Body) => (b as unknown as { model_gap?: { kind: string; question: string } }).model_gap;

  it('SR-1 RED (served turn #2): the press runs the method — ONE tool-less call, ≤3 risks each with an Add, Something else, the gap question; NOTHING stored', async () => {
    paulV1();
    const before = nodeLabels();
    const bodies: Record<string, unknown>[] = [];
    script = [(body) => { bodies.push(asSent(body) as Record<string, unknown>); return candidates(TURN2); }];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    expect(openAiCalls, 'ONE model call').toBe(1);
    expect(((bodies[0]!['tools'] ?? []) as unknown[]), 'no tool: the call suggests, the server decides').toEqual([]);
    expect(JSON.stringify(bodies[0]!['instructions'] ?? '')).toContain('METHOD TURN: the user asked Olumi to suggest risks');
    expect(addChips(t1).map((c) => c.label), JSON.stringify(t1.suggested_actions)).toEqual(['Add ‘Recruitment delay’', 'Add ‘Wrong bottleneck’', 'Add ‘Coordination drag’']);
    expect(t1.suggested_actions.map((c) => c.id).slice(3)).toEqual(['agent-widen-something-else']);
    expect(t1.assistant_text).toContain('(assumption-based planning)');
    expect(t1.assistant_text).toContain('- ‘Hire Two Developers’ relies on filling both developer roles quickly. Risk: ‘Recruitment delay’ (timing), through ‘Developer Hires’. Watch for: no accepted offer by week 4.');
    expect((t1 as unknown as { model_gap?: { kind: string } }).model_gap?.kind, 'the typed gap rides the wire').toBe('deadline_missing');
    expect(t1.assistant_text).not.toContain('<risk_suggestions>');
    expect(t1.assistant_text.trim().split('\n').at(-1)).toBe(S1_ASK);
    expect(t1._agent.tool_calls).toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(nodeLabels(), 'nothing is written by the suggestion').toEqual(before);
  }, 120_000);

  it('SR-2 RED: Add → NO model call → ONE held card through the add-risk door → approve → the risk is in the model WITH its driver (never inert)', async () => {
    paulV1();
    script = [() => candidates(TURN2)];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    const add = addChips(t1)[0]!;
    expect(add?.message, JSON.stringify(t1.suggested_actions)).toBe('Add the risk ‘Recruitment delay’ to ‘Hire Two Developers’: driven by more ‘Developer Hires’, it would lower ‘Feature Delivery Capacity’.');
    const before = nodeLabels();
    const calls = openAiCalls;
    const t2 = await turn({ message: add.message, source: 'chip', chip: { id: add.id } });
    expect(openAiCalls, 'the Add press makes no model call').toBe(calls);
    expect(t2._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_risk', true]]);
    // Served sc-plus-1 (7 Oct 16:58Z): the card was held, yet the words said it was not. A held card is never a refusal.
    expect(t2.assistant_text).not.toContain('I couldn’t prepare that risk');
    expect(t2.assistant_text).toContain('I’ve prepared this change');
    expect(t2.assistant_text).toContain('Recruitment delay');
    const approve = approveChipOf(t2);
    expect(approve?.id, JSON.stringify(t2.suggested_actions)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    const held = await heldOnLatestRow();
    expect(held).toHaveLength(1);
    const ops = held[0]!.action.inline_patch!.operations!.map((o) => `${o.op} ${o.path}`);
    expect(ops).toEqual(['add_node risk_recruitment_delay', 'add_edge risk_recruitment_delay::feature_delivery_capacity', 'add_edge developer_hires::risk_recruitment_delay']);
    expect(nodeLabels(), 'nothing is written before the approval').toEqual(before);
    await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    const g = graphNow();
    expect(g.nodes.some((x) => x.id === 'risk_recruitment_delay' && x.kind === 'risk' && x.label === 'Recruitment delay')).toBe(true);
    expect(g.edges.filter((e) => e.to === 'risk_recruitment_delay').map((e) => e.from), 'D-09: the risk has a parent the options move').toEqual(['developer_hires']);
    expect(g.edges.filter((e) => e.from === 'risk_recruitment_delay').map((e) => e.to)).toEqual(['feature_delivery_capacity']);
  }, 120_000);

  it('SR-3 RED: the canvas "+" Risk press (ask:risks) reaches the SAME door', async () => {
    paulV1();
    script = [() => candidates(TURN2.slice(0, 1))];
    const t1 = await turn({ message: 'What could go wrong, or unexpectedly well, that this model doesn’t have yet?', source: 'chip', chip: { id: 'ask:risks' } });
    expect(addChips(t1).map((c) => c.label)).toEqual(['Add ‘Recruitment delay’']);
    expect(await heldOnLatestRow()).toEqual([]);
  }, 120_000);

  it('SR-4: nothing passes the gate → RC\'s fallback and Talk it through; nothing stored, no Add', async () => {
    paulV1();
    const before = nodeLabels();
    script = [() => say('Consider these possible risks—not established facts: Recruitment delay, Wrong bottleneck. None has been added.')];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    expect(t1.assistant_text).toBe('What else could stop ‘meet our next feature-launch deadline’ from working out? For example, something about people, timing, cost, a dependency, or something outside your control.');
    expect(t1.suggested_actions.map((c) => c.id)).toEqual(['agent-talk-it-through']);
    expect(nodeLabels()).toEqual(before);
  }, 120_000);

  it('SR-5 CONTROL: the pre-mortem worksheet "Add this as a risk" (same id, its own message) stays an ordinary Agent turn with its tools', async () => {
    paulV1();
    const bodies: Record<string, unknown>[] = [];
    script = [
      (body) => { bodies.push(asSent(body) as Record<string, unknown>); return fnCall('propose_new_risk', { label: 'Onboarding drag', rationale: 'The user asked for it.',
        affects: [{ target_label: 'Feature Delivery Capacity', direction: 'negative' }], caused_by: [{ factor_label: 'Developer Hires', direction: 'positive' }] }); },
      () => say('I can add it. Shall I?'),
    ];
    const t1 = await turn({ message: 'Prepare one risk called "Onboarding drag": Onboarding takes longer. It would lower "Feature Delivery Capacity". Olumi hypothesis — for you to challenge. Show the proposed change for approval.',
      source: 'chip', chip: { id: RISKS.id } });
    expect(((bodies[0]!['tools'] ?? []) as { name?: string }[]).map((x) => x.name)).toContain('propose_new_risk');
    expect(t1._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_risk', true]]);
    expect(addChips(t1)).toEqual([]);
  }, 120_000);

  it('SR-7 RED (reload): the Add presses persist on the answer row like the press that offered them, and stand only while the result is current and nothing awaits approval', async () => {
    const { isDurableAnswerOffer, stillValidOffers } = await import('../../../routes/agent-v1-turn.js');
    const { riskAddPressFor } = await import('../method-turn/widen-turn.js');
    const add = riskAddPressFor({ label: 'Recruitment delay', hits: { id: 'hire_two_developers', label: 'Hire Two Developers', kind: 'option' },
      through: { id: 'developer_hires', label: 'Developer Hires', direction: 'positive' },
      affects: { id: 'feature_delivery_capacity', label: 'Feature Delivery Capacity', direction: 'negative' } });
    expect(isDurableAnswerOffer(add)).toBe(true);
    const current = { analysisReady: undefined, modelExists: true, analysisState: { run_state: { kind: 'complete_current' }, usable_for_chips: true } };
    expect(stillValidOffers([add], { ...current, outstandingProposalIds: new Set() }).map((a) => a.id)).toEqual([add.id]);
    expect(stillValidOffers([add], { ...current, outstandingProposalIds: new Set(['gmh_0123456789ab']) })).toEqual([]);
    expect(stillValidOffers([add], { ...current, analysisState: { run_state: { kind: 'stale' }, usable_for_chips: true }, outstandingProposalIds: new Set() })).toEqual([]);
  });

  it('SR-8 (Codex r1 P1): an Add press whose message was edited is REFUSED in words — no model call, no proposal, never ordinary generation', async () => {
    paulV1();
    script = [() => candidates(TURN2)];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    const add = addChips(t1)[0]!;
    const calls = openAiCalls;
    script = [() => fnCall('propose_new_option', { label: 'Contractor cover', acts_on: [{ factor_label: 'Developer Hires', direction: 'positive' }], rationale: 'r' })];
    const t2 = await turn({ message: 'Add an option called Contractor cover instead; it increases Developer Hires.', source: 'chip', chip: { id: add.id } });
    expect(openAiCalls, 'no model call').toBe(calls);
    expect(t2._agent.tool_calls).toEqual([]);
    expect(t2.assistant_text).toBe('I couldn’t prepare that risk as a change, so nothing was added. The model may have changed since I suggested it. Press Suggest risks for a fresh set.');
    expect(t2.suggested_actions.map((c) => c.id)).toEqual([RISKS.id]);
    expect(await heldOnLatestRow()).toEqual([]);
  }, 120_000);

  it('SR-9 (Codex r1 P1): a STALE Add — its factor renamed and a new node given the old name — is refused; nothing held', async () => {
    paulV1();
    script = [() => candidates(TURN2)];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    const add = addChips(t1)[0]!;
    const g = graphOf.get(SCENARIO) as { nodes: Record<string, unknown>[] };
    graphOf.set(SCENARIO, { ...g, nodes: [...g.nodes.map((n) => (n['id'] === 'developer_hires' ? { ...n, label: 'Renamed developer count' } : n)),
      { id: 'fac_other', kind: 'factor', label: 'Developer Hires', observed_state: { value: 0 } }] });
    const t2 = await turn({ message: add.message, source: 'chip', chip: { id: add.id } });
    expect(t2._agent.tool_calls).toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
  }, 120_000);

  /**
   * DL 7 Oct (Reasoning lane, DGAI #2598): `agent-next-widen` is now sent at EVERY stage from every door. Both targets answer
   * a pre-run model and a withheld-leader Run with their own typed turn — never ordinary generation.
   */
  const WITHHELD = { analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-07T09:17:02.002Z' }, usable_for_chips: true,
    leader_claim: { permitted: false, withheld_reason: 'goal_figures_withheld' } } };
  for (const [stage, read] of [['pre-run (no analysis)', {}], ['withheld leader', WITHHELD]] as const) {
    it(`SR-10 ${stage}: "Suggest options" runs the options door (its ONLY tool), and an empty answer is RC's typed fallback`, async () => {
      paulV1();
      extraRead = read;
      const bodies: Record<string, unknown>[] = [];
      script = [(body) => { bodies.push(asSent(body) as Record<string, unknown>); return say('Here are some ideas in prose.'); }];
      const t = await turn({ message: 'Suggest options I haven’t considered.', source: 'chip', chip: { id: 'agent-next-widen' } });
      expect(openAiCalls).toBe(1);
      expect(((bodies[0]!['tools'] ?? []) as { name?: string }[]).map((x) => x.name)).toEqual(['propose_new_option']);
      expect(t.assistant_text).toBe('What other way could you reach ‘meet our next feature-launch deadline’? For example, a different lever, a smaller first step, or a mix of these options.');
      expect(t.suggested_actions.map((c) => c.id)).toEqual(['agent-talk-it-through']);
    }, 120_000);
    it(`SR-11 ${stage}: "Suggest risks" runs the risks door (no tool) and answers with typed items and Adds`, async () => {
      paulV1();
      extraRead = read;
      const bodies: Record<string, unknown>[] = [];
      script = [(body) => { bodies.push(asSent(body) as Record<string, unknown>); return candidates(TURN2.slice(0, 2)); }];
      const t = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
      expect(openAiCalls).toBe(1);
      expect(((bodies[0]!['tools'] ?? []) as unknown[])).toEqual([]);
      expect(addChips(t).map((c) => c.label)).toEqual(['Add ‘Recruitment delay’', 'Add ‘Wrong bottleneck’']);
    }, 120_000);
  }

  it('SR-12 JOINED (PL/Codex 5443200599 with #2742 S1): on Paul\'s CHANCE goal only S1\'s deadline question survives — in the widen text, on the wire, and on an ordinary turn', async () => {
    paulV1();
    script = [() => candidates(TURN2)];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    expect(t1.assistant_text).not.toContain('What would count as meeting it');
    expect(t1.assistant_text.split(S1_ASK)).toHaveLength(2);
    expect(t1.assistant_text.match(/\?/gu), 'ONE question in the reply').toHaveLength(1);
    expect(gapOf(t1)).toEqual({ kind: 'deadline_missing', goal_id: 'meet_our_next_feature_launch_deadline', question: S1_ASK });
    script = [() => say('We can look at the hiring options together.')];
    const t2 = await turn({ message: 'What do you think about the two hires?' });
    expect(JSON.stringify(t2)).not.toContain('What would count as meeting it');
    expect(gapOf(t2)?.question).toBe(S1_ASK);
  }, 120_000);

  it('SR-13 CONTROL: the same model with a QUANTITY goal keeps the target ask on the wire and in the widen text', async () => {
    paulV1();
    const g = graphOf.get(SCENARIO) as { nodes: Record<string, unknown>[] };
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((n) => (n['kind'] === 'goal' ? { ...n, goal_threshold_unit: 'features shipped' } : n)) });
    script = [() => candidates(TURN2)];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    expect(gapOf(t1)?.kind).toBe('goal_target_missing');
    expect(t1.assistant_text.trim().split('\n').at(-1)).toBe('One gap: ‘meet our next feature-launch deadline’ has no target or deadline yet. What would count as meeting it, and by when?');
    expect(t1.assistant_text).not.toContain(S1_ASK);
  }, 120_000);

  /**
   * Served canvas witness sc-plus-1 (UI a36315d4, CEE 666dad1, 7 Oct 16:58:44Z): the "+" → Risk press offered three Adds; the
   * first Add's message, VERBATIM, held its card (`widen_add: propose_new_risk, held: true`) and the reply said "I couldn't
   * prepare that risk". The model here carries the served labels only (the stored graph was not read: guest, key-gated).
   */
  const STARTER = {
    nodes: [
      { id: 'dec_pricing', kind: 'decision', label: 'How should we price the starter tier?' },
      { id: 'goal_mrr', kind: 'goal', label: 'Total MRR', goal_threshold_unit: '£', goal_threshold_raw: 50000 },
      { id: 'out_starter_mrr', kind: 'outcome', label: 'Starter-plan MRR' },
      { id: 'fac_subs', kind: 'factor', label: 'Starter-plan paying subscribers', observed_state: { value: 0.2, raw_value: 200, unit: 'subscribers', cap: 1000 } },
      { id: 'opt_launch', kind: 'option', label: 'Launch cheaper starter plan', interventions: { fac_subs: { value: 0.5, raw_value: 500, unit: 'subscribers' } } },
      { id: 'opt_keep', kind: 'option', label: 'Keep current pricing', is_baseline: true, interventions: {} },
    ],
    edges: [
      { from: 'dec_pricing', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_pricing', to: 'opt_keep', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_launch', to: 'fac_subs', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_keep', to: 'fac_subs', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', origin: 'repair' },
      { from: 'fac_subs', to: 'out_starter_mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'out_starter_mrr', to: 'goal_mrr', strength: { mean: 0.7, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
    goal_node_id: 'goal_mrr',
    goal_constraints: [],
  };
  const SERVED_ADD_MESSAGE = 'Add the risk ‘Weak starter demand’ to ‘Launch cheaper starter plan’: driven by less ‘Starter-plan paying subscribers’, it would lower ‘Starter-plan MRR’.';
  it('SR-14 RED (served sc-plus-1): canvas "+" Risk → Add with the served message VERBATIM → ONE held card AND the words say it is prepared, never "I couldn’t prepare"', async () => {
    graphOf.set(SCENARIO, structuredClone(STARTER));
    script = [() => candidates([{ label: 'Weak starter demand', category: 'external', hits_id: 'opt_launch', through_id: 'fac_subs', through_direction: 'negative',
      affects_id: 'out_starter_mrr', direction: 'negative', relies_on: 'attracting new paying subscribers with a cheaper plan', watch_for: 'interest fails to convert into paid subscriptions' }])];
    const t1 = await turn({ message: 'What could go wrong, or unexpectedly well, that this model doesn’t have yet?', source: 'chip', chip: { id: 'ask:risks' } });
    const add = addChips(t1)[0]!;
    expect(add?.message, JSON.stringify(t1.suggested_actions)).toBe(SERVED_ADD_MESSAGE);
    const calls = openAiCalls;
    const t2 = await turn({ message: add.message, source: 'chip', chip: { id: add.id } });
    expect(openAiCalls).toBe(calls);
    expect(t2._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_risk', true]]);
    expect(approveChipOf(t2)?.id).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect(t2.assistant_text).not.toContain('I couldn’t prepare that risk');
    expect(t2.assistant_text).toContain('I’ve prepared this change');
    expect(t2.assistant_text).toContain('Weak starter demand');
    // The door's OWN typed reply (`newRiskReply`), not the fallback: the press is the whole request. Through #2748's ONE
    // composer it is the `proposal` profile, so it ships WHOLE, byte for byte, with no reshaped `_answer_shape` (DL 17:3xZ).
    expect(t2.assistant_text).toBe([
      'I’ve prepared this change: add risk \'Weak starter demand\', link \'Weak starter demand\' to \'Starter-plan MRR\' and link \'Starter-plan paying subscribers\' to \'Weak starter demand\'.',
      'It threatens Starter-plan MRR (lowers it).',
      'It is driven by Starter-plan paying subscribers (more of it makes the risk less likely).',
      'How strongly it acts is not known yet: Olumi uses a placeholder strength for each link, not an estimate, for you to correct.',
      'Approve these 3 changes?',
    ].join('\n\n'));
    expect((t2 as unknown as { _answer_shape?: unknown })._answer_shape, 'kept whole: no reshaped answer shape').toBeUndefined();
    const held = await heldOnLatestRow();
    expect(held[0]!.action.inline_patch!.operations!.map((o) => `${o.op} ${o.path}`))
      .toEqual(['add_node risk_weak_starter_demand', 'add_edge risk_weak_starter_demand::out_starter_mrr', 'add_edge fac_subs::risk_weak_starter_demand']);
  }, 120_000);

  it('SR-6 RED: the canvas "+" Option press (ask:widen) reaches the options door — its ONLY tool is propose_new_option', async () => {
    paulV1();
    const bodies: Record<string, unknown>[] = [];
    script = [(body) => { bodies.push(asSent(body) as Record<string, unknown>); return say('No suggestion.'); }];
    await turn({ message: 'What other options could answer this that I have not put on the board?', source: 'chip', chip: { id: 'ask:widen' } });
    expect(((bodies[0]!['tools'] ?? []) as { name?: string }[]).map((x) => x.name)).toEqual(['propose_new_option']);
  }, 120_000);
});
