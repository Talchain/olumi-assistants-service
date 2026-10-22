/**
 * ⭐ PATH-B `core`: THE AI IS THE ONE VOICE (DL-3 22:5xZ; Paul: out of the box; both judges FAIL criterion 5 on 548f886f, where a
 * host guidance card asked "Give your estimate" on the link the AI's reply had just said could not hold it). In core mode the
 * turn carries, beside the AI's reply, only the cards of a change waiting for a yes, the AI's own research offers, receipts and
 * blocks: no host guidance card, action bar, gap signal, sizing chip, next step or Run offer. The A lane is unchanged.
 * Harness: the real `/agent/v1/turn` route (as `goal-level-card.route.test.ts`); a scripted AI (0 provider calls). SYNTHETIC.
 */
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRunInputSnapshot } from '../../../tools/handlers/run-input-snapshot.js';
import { d3Run, ILLUSTRATIVE } from './d3-defaults-fixture.js';
import { readCanonicalContext } from '../context-tool.js';
import { withCanonicalAnalysisView } from '../../../agent-lane/__tests__/fixtures/canonical-analysis-read.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { streamWhenAsked } from '../../../agent-lane/__tests__/stream-when-asked.js';

type Json = Record<string, any>;
let SCENARIO = '';
const CORE = { 'x-olumi-ai-mode': 'core' };
const SAID = 'Correction: about 110 a week, not 120.';
const CORRECTION = { public_label: 'Record today’s weekly orders', basis: 'The user corrected the baseline.',
  ops: [{ op: 'set_goal_current_level', goal_id: 'orders', value: 110, unit: 'orders a week', stance: 'stated_current',
    source: { origin: 'user', quote: 'about 110 a week', named_source: null } }] };
const PREPARED_WORDS = 'I have prepared your correction to 110 a week; press its card to save it.';

let persisted: Json;
let readiness: Json;
let carriedResult: Json | undefined;
let engineResult: Json | undefined;
let runState: Json | undefined;
let runCount = 0;
let inputsUsed: unknown;
const runFacts = new Map<string, Json>();
const registered: Json[] = [];
const graphWrites: Json[] = [];
const turnRows = new Map<string, any>();
let pausedRun: any = null;
const conversationIds = new Map<string, string>();
const identityOf = (g: unknown): string => createHash('sha256').update(JSON.stringify(g)).digest('hex');
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
/** The goal "Weekly orders" at least 150 a week; today 120, from the brief; the vans on its path are Olumi's estimate (a host guidance item). */
function stored(target = true): Json {
  const options = [
    { id: 'add_vans', kind: 'option', label: 'Lease two more vans', interventions: { vans: { value: 0.5, source: 'brief_extraction', extractionType: 'explicit' } } },
    { id: 'carry_on', kind: 'option', label: 'Carry on as now', interventions: { vans: { value: 0.25, source: 'cee_inference' } }, is_baseline: true },
  ];
  const g = {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Delivery capacity' },
      { id: 'orders', kind: 'goal', label: 'Weekly orders', ...(target ? { goal_threshold: 0.8, goal_threshold_raw: 150, goal_threshold_cap: 187.5,
        goal_threshold_unit: 'orders a week', goal_threshold_frame: 'level', goal_direction: 'at_least', goal_threshold_cap_provenance: 'target_derived_headroom' } : {}),
        observed_state: { value: 0.64, baseline: 0.64, raw_value: 120, unit: 'orders a week', cap: 187.5, source: 'brief_extraction' } },
      { id: 'vans', kind: 'factor', label: 'Vans on the road', category: 'controllable',
        observed_state: { value: 0.25, raw_value: 2, unit: 'vans', cap: 8, source: 'cee_inference', extractionType: 'inferred' } },
      ...options,
    ],
    edges: [
      ...options.map((o) => ({ from: 'decision', to: o.id, strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      ...options.map((o) => ({ from: o.id, to: 'vans', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      { from: 'vans', to: 'orders', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
    goal_node_id: 'orders',
  };
  return projectGraphForPersistence({ ...GraphV3.parse(g), options: [] as Json[] }) as Json;
}

const store = {
  readOpenAiPausedRun: vi.fn(async () => pausedRun),
  saveOpenAiPausedRun: vi.fn(async (_s: string, r: any) => { if (pausedRun !== null) return false; pausedRun = r; return true; }),
  takeOpenAiPausedRun: vi.fn(async (_s: string, id: string) => { if (pausedRun?.pause_id !== id) return false; pausedRun = null; return true; }),
  readOpenAiConversationId: vi.fn(async (sid: string) => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string) => { if (!conversationIds.has(sid)) conversationIds.set(sid, id); return conversationIds.get(sid); }),
  loadGraph: async () => persisted,
  loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
  readFactsFor: vi.fn(async (ids: string[], kind?: string) => kind === 'run_analysis' ? ids.flatMap(id => runFacts.has(id) ? [runFacts.get(id)] : []) : []),
  readRecent: vi.fn(async () => []),
  readFactsWithTurnFor: async () => [],
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async () => [...turnRows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => engineResult === undefined ? null : { graph: persisted }),
  append: vi.fn(async (write: Json) => {
    if (write.graph !== undefined) { graphWrites.push(write); return { id: `graph-${graphWrites.length}` }; }
    const key = String(write.turn_id);
    const prior = turnRows.get(key);
    if (prior !== undefined) return prior.request_hash === write.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...write, id: `row-${turnRows.size + 1}`, created_at: new Date().toISOString(), assistant_message: write.assistantMessage, user_message: write.userMessage };
    turnRows.set(key, row);
    return { id: row.id };
  }),
  getScenarioOwner: async () => null,
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
};
/** When set, the host guidance selector offers this card (its live trigger needs a measured Run this harness has none of). */
let offeredCard: Json | undefined;
vi.mock('../../../agent-lane/next-steps-from-guidance.js', async (original) => {
  const m = await original<typeof import('../../../agent-lane/next-steps-from-guidance.js')>();
  return { ...m, nextStepOffersForTurn: (...args: Parameters<typeof m.nextStepOffersForTurn>) => {
    const r = m.nextStepOffersForTurn(...args);
    return offeredCard === undefined ? r : { ...r, selection: offeredCard as never };
  } };
});
const GIVE_YOUR_ESTIMATE = { slot1: { policy_id: 'RC-STRENGTHEN-ITEM', priority: 'P1', variant: 'S1', item: 'vans->orders',
  primary_action: { label: 'Give your estimate', action_kind: 'edit_inline', target: 'vans->orders' }, state_key_hash: 'aaaaaaaaaaaa',
  copy: { title: 'A link on the path to your goal has no size yet.', why: 'This link connects vans on the road to weekly orders.',
    question: 'How much do vans on the road change weekly orders?' }, item_ref: { kind: 'link', from_id: 'vans', to_id: 'orders' } } };
/** When set, the final egress gate passes the FIRST research control it sees (the offer's own check) and withdraws every later one. */
let withdrawAfterOffer = false;
let gateCalls = 0;
vi.mock('../../../agent-lane/leader-final-egress.js', async (original) => {
  const m = await original<typeof import('../../../agent-lane/leader-final-egress.js')>();
  return { ...m, controlSurvivesLeaderGate: (...args: Parameters<typeof m.controlSurvivesLeaderGate>) =>
    (withdrawAfterOffer && gateCalls++ > 0 ? false : m.controlSurvivesLeaderGate(...args)) };
});
vi.mock('../../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let served = 0;
/** When set, the next provider call waits for it: a turn still running while another is sent. */
let holdProvider: Promise<void> | undefined;
let preparedId = '';
const responsesBody = (output: Json[]): Json => {
  served += 1;
  return { id: `resp_${served}`, object: 'response', model: 'gpt-scripted', status: 'completed',
    output: output.map((item, i) => item.type === 'message'
      ? { id: `msg_${served}_${i}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: item.text, annotations: [] }] }
      : { id: `fc_${served}_${i}`, status: 'completed', type: 'function_call', name: item.name, call_id: item.call_id ?? `call_${served}_${i}`,
          arguments: JSON.stringify(item.name === 'apply_change' && item.args === undefined ? { proposal_id: preparedId } : item.args ?? {}) }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PROPOSAL_CONTROL = /^(agent-approve-proposal:|agent-amend-proposal$|agent-decline-proposal:|agent-review-proposal:)/;
const QUESTION = 'What does the model hold for weekly orders today?';
const ANSWER = 'The model holds 120 orders a week today, from your brief.';
// L8 sign-off text: independent of the production constant, tested at the SDK HTTP boundary.
const COHERENT_REPLY = 'Write one coherent reply in a single voice: give the explanation first, mention what changed since the last Run only when it matters, and weave at most one next step from the current readiness facts into the prose, never as a separate bullet or receipt line and never asking for something the user has already said; ask at most one question per reply.';
const COHERENT_REPLY_SHA = '3be8d67e53696147c1b12cc8384416de7dfb9854a7e98c91e3913609bb9a9f4b';
/** Olumi's approved reply discipline, read from the served routing prompt itself (independent of the production constant). */
const ROUTING = readFileSync(new URL('../../../../../Prompts/canonical/routing.txt', import.meta.url), 'utf8');
const DISCIPLINE = ROUTING.slice(ROUTING.indexOf('<RESPONSE_DISCIPLINE>'), ROUTING.indexOf('</RESPONSE_DISCIPLINE>') + '</RESPONSE_DISCIPLINE>'.length);

describe('PATH-B core: beside the AI\u2019s reply, only its own cards; no host guidance or advice', () => {
  let app: FastifyInstance;
  let calls: Json[] = [];
  let outputs: Json[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return json({ id: 'conv_voice', object: 'conversation' });
      calls.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      if (holdProvider !== undefined) { const hold = holdProvider; holdProvider = undefined; await hold; }
      return json(responsesBody(outputs.shift() ?? [{ type: 'message', text: ANSWER }]));
    })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({ graph: persisted, graph_hash: hashOf(persisted),
      graph_identity_hash: { kind: 'graph_identity', value: identityOf(persisted), algorithm: 'sha256' },
      analysis_ready: readiness, ...(inputsUsed === undefined ? {} : { analysis_run_evidence: { run_id: 'fixture-read-run', input_snapshot: inputsUsed } }), ...(runState === undefined ? {} : { analysis_state: runState }),
      ...(carriedResult === undefined ? {} : { analysis_result: carriedResult }) }, SCENARIO));
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
    app.post('/orchestrate/v2/turn', async (req) => {
      if (engineResult === undefined) return { response_version: 2, assistant_text: '', suggested_actions: [], insights: [], blocks: [] };
      runCount += 1; carriedResult = structuredClone(engineResult);
      runState = { run_state: { kind: 'complete_current', computed_at: '2026-10-20T03:00:00.000Z' }, leader_claim: { permitted: true, separation: 'separated' } };
      const id = `engine-row-${runCount}`;
      turnRows.set(String((req.body as Json).turn_id), { id, turn_id: (req.body as Json).turn_id, llm_calls_used: 0 });
      runFacts.set(id, { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
        scenario_id: SCENARIO, run_id: 'fixture-read-run', graph_hash_at_run: hashOf(persisted), computed_at: runState.run_state.computed_at } });
      return { response_version: 2, assistant_text: 'Ran analysis.', suggested_actions: [], insights: [],
        blocks: [carriedResult], analysis_state: runState, analysis_ready: readiness, graph_hash: hashOf(persisted) };
    });
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    SCENARIO = randomUUID(); persisted = stored(); registered.length = 0; graphWrites.length = 0; turnRows.clear(); conversationIds.clear();
    readiness = { status: 'blocked', options: [], blockers: [] }; carriedResult = undefined; engineResult = undefined; runState = undefined; runCount = 0; runFacts.clear();
    inputsUsed = undefined; pausedRun = null; calls = []; outputs = []; preparedId = ''; offeredCard = GIVE_YOUR_ESTIMATE;
  });
  const post = (payload: Json, headers: Record<string, string> = CORE) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers,
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const hostCards = (j: Json): Json => ({ guidance: j.guidance, action_bar: j.action_bar, model_gap: j.model_gap, guided_sizing: j.guided_sizing,
    other_actions: ((j.suggested_actions ?? []) as Json[]).map((a) => String(a.id)).filter((id) => !PROPOSAL_CONTROL.test(id)) });
  const NONE = { guidance: undefined, action_bar: undefined, model_gap: undefined, guided_sizing: undefined, other_actions: [] };
  const expectCoherentInstructions = (j: Json): void => {
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(typeof c.instructions).toBe('string');
      // Paul, 21 Oct (standing): bullets first, detail on request. The approved discipline replaces the prose-only sentence.
      expect(DISCIPLINE.length, 'the canonical block was found').toBeGreaterThan(500);
      expect(c.instructions.split(DISCIPLINE), 'the approved response discipline rides every call exactly once').toHaveLength(2);
      expect(createHash('sha256').update(COHERENT_REPLY, 'utf8').digest('hex'), 'the replaced sentence is the one L8 signed').toBe(COHERENT_REPLY_SHA);
      expect(c.instructions, 'the prose-only sentence it replaced is gone').not.toContain(COHERENT_REPLY);
    }
    expect(j._provider_calls.filter((c: Json) => c.site === 'agent-core.sdk').map((c: Json) => c.prompt_sha256))
      .toEqual(calls.map((c) => createHash('sha256').update(c.instructions, 'utf8').digest('hex')));
  };

  it('⭐ RED→GREEN: a core correction turn carries its own card and nothing a host composed beside the AI\u2019s reply', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args: CORRECTION }], [{ type: 'message', text: PREPARED_WORDS }]];
    const r = await post({ turn_id: randomUUID(), message: SAID, source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    preparedId = String((j._agent.tool_calls as Json[]).find((c) => c.name === 'propose_change' && c.ok)?.proposal_id ?? '');
    expect((j.suggested_actions as Json[]).map((a) => a.id), 'its own card is kept').toContain(`agent-approve-proposal:${preparedId}`);
    expect(j.assistant_text).toBe(PREPARED_WORDS);
    expect(hostCards(j)).toEqual(NONE);
  });

  it('⭐ RED→GREEN: a core question turn carries the AI\u2019s answer alone', async () => {
    const r = await post({ turn_id: randomUUID(), message: QUESTION, source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j.assistant_text).toBe(ANSWER);
    expect(hostCards(j)).toEqual(NONE);
    expectCoherentInstructions(j);
  });

  it('⭐ RED→GREEN (#3522 review BLOCK, 21 Oct): a core turn can offer ONE public search; the reply ships its control, nothing is searched', async () => {
    const QUERY = 'typical weekly order growth after a loyalty scheme in small food businesses';
    outputs = [[{ type: 'function_call', name: 'offer_public_research', call_id: 'research_call', args: { query: QUERY } }],
      [{ type: 'message', text: 'A search is on offer below; it runs only if you press it.' }]];
    const r = await post({ turn_id: randomUUID(), message: 'Is there any published evidence on how much loyalty schemes help?', source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect((j._agent.tool_calls as Json[]).find((c) => c.name === 'offer_public_research')).toMatchObject({ ok: true });
    const chips = ((j.suggested_actions ?? []) as Json[]).filter((a) => String(a.id).startsWith('agent-public-research:'));
    expect(chips, 'exactly the one control that can send the query').toHaveLength(1);
    expect(JSON.stringify(chips[0])).toContain(QUERY);
    // CONTROL: a query that is not one sendable line is refused, and no control ships.
    outputs = [[{ type: 'function_call', name: 'offer_public_research', call_id: 'research_bad', args: { query: 'x'.repeat(201) } }],
      [{ type: 'message', text: 'No search is on offer.' }]];
    const bad = (await post({ turn_id: randomUUID(), message: 'Search for something very long.', source: 'composer' })).json() as Json;
    expect((bad._agent.tool_calls as Json[]).find((c) => c.name === 'offer_public_research')).toMatchObject({ ok: false });
    expect(((bad.suggested_actions ?? []) as Json[]).filter((a) => String(a.id).startsWith('agent-public-research:'))).toEqual([]);
  });

  it('⭐ RED→GREEN (Codex #3558 R1): an offer accepted, then withdrawn on the final read, ships no control, and the AI\u2019s "press it" is corrected in fixed words', async () => {
    withdrawAfterOffer = true; gateCalls = 0;
    try {
      outputs = [[{ type: 'function_call', name: 'offer_public_research', call_id: 'research_withdrawn', args: { query: 'published evidence on weekend opening and library visits' } }],
        [{ type: 'message', text: 'Press the search control below to look this up.' }]];
      const j = (await post({ turn_id: randomUUID(), message: 'Is there published evidence on this?', source: 'composer' })).json() as Json;
      expect((j._agent.tool_calls as Json[]).find((c) => c.name === 'offer_public_research')).toMatchObject({ ok: true });
      expect(((j.suggested_actions ?? []) as Json[]).filter((a) => String(a.id).startsWith('agent-public-research:'))).toEqual([]);
      expect(String(j.assistant_text)).toContain('No web search is on offer with this reply.');
    } finally { withdrawAfterOffer = false; }
  });

  it('⭐ RED→GREEN: a goal with no target: no host gap question beside the AI\u2019s answer', async () => {
    persisted = stored(false);
    const r = await post({ turn_id: randomUUID(), message: QUESTION, source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    expect(hostCards(r.json() as Json)).toEqual(NONE);
  });

  it('A-lane contrast: the same turns without the core header still carry the host guidance card, gap question and action bar', async () => {
    persisted = stored(false);
    const r = await post({ turn_id: randomUUID(), message: QUESTION, source: 'composer' }, {});
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j.guidance, 'the A lane is unchanged').toEqual(GIVE_YOUR_ESTIMATE);
    expect(j.model_gap).toMatchObject({ kind: 'goal_target_missing' });
    expect(j.action_bar).toBeDefined();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(JSON.stringify(c)).not.toContain(COHERENT_REPLY);
  });

  it.each(['delivery', 'staffing'])('L4 readiness producer: %s core omits the host list; A keeps its exact bytes; the AI keeps its facts', async (subject) => {
    const label = subject === 'delivery' ? 'Vans on the road' : 'Engineers available';
    readiness = { status: 'needs_user_input', options: [], user_questions: [`What is "${label}" today?`], blockers: [
      { blocker_type: 'missing_value', factor_id: 'vans', factor_label: label, option_id: 'add_vans',
        message: `Factor "${label}" needs a numeric value for option "Lease two more vans"`, suggested_action: 'add_value' },
      { blocker_type: 'missing_value', factor_id: 'vans', factor_label: label,
        message: `What is "${label}" today, before any option changes it? Without a current level the analysis would treat it as zero.`, suggested_action: 'add_value' },
    ] };
    const factor = persisted.nodes.find((n: Json) => n.id === 'vans');
    factor.label = label;
    delete factor.observed_state;
    delete persisted.nodes.find((n: Json) => n.id === 'add_vans').interventions.vans;
    const expectedContext = await readCanonicalContext({ dispatch: async () => ({ status: 200, json: {
      graph: persisted, graph_hash: hashOf(persisted), graph_identity_hash: { value: identityOf(persisted) },
    } }) }, { scenario_id: SCENARIO });
    expect(expectedContext.status).toBe('ok');
    if (expectedContext.status !== 'ok') throw new Error('synthetic context unavailable');
    expect(expectedContext.data.readiness, 'the AI has real missing-input facts').toMatchObject({
      blocking: expect.arrayContaining([expect.anything()]),
    });
    const original = structuredClone(readiness);
    outputs = [[{ type: 'function_call', name: 'read_canonical_context', call_id: 'context_call', args: {} }], [{ type: 'message', text: ANSWER }]];
    const turn = { turn_id: randomUUID(), message: QUESTION, source: 'composer' };
    const core = await post(turn);
    expect(core.statusCode, core.body).toBe(200);
    expect(core.json().analysis_ready).toBeUndefined();
    const output = calls.flatMap((c) => c.input ?? []).find((i: Json) => i.type === 'function_call_output' && i.call_id === 'context_call');
    expect(JSON.parse(output.output), 'the AI keeps the exact canonical facts').toEqual(expectedContext);
    expect(readiness, 'UI suppression never mutates tool context').toEqual(original);
    const count = calls.length;
    const replay = await post(turn);
    expect(replay.json()._agent.replayed).toBe(true);
    expect(replay.json().analysis_ready, 'replay is a producer too').toBeUndefined();
    expect(calls).toHaveLength(count);
    const a = await post({ ...turn, turn_id: randomUUID() }, {});
    expect(a.statusCode, a.body).toBe(200);
    const { computed_at: _at, freshness: _fresh, freshness_reason: _reason, current_graph_hash: _hash, ...aReady } = a.json().analysis_ready;
    expect(aReady).toEqual(original);
    const aReplay = await post({ ...turn, turn_id: a.json()._agent.turn_id }, {});
    expect(aReplay.json()._agent.replayed).toBe(true);
    expect(aReplay.json().analysis_ready).toEqual(a.json().analysis_ready);
  });

  it('L4 carried-result producer: no Run in core means no carried result; A keeps the exact result', async () => {
    carriedResult = { type: 'analysis_result', summary: 'Ran analysis on the earlier saved model.', leading_option_id: null };
    const original = structuredClone(carriedResult);
    const reply = 'The earlier analysis used 120 orders a week; our deadline is 2026-12-01. I am only explaining it now.';
    outputs = [[{ type: 'message', text: reply }]];
    const turn = { turn_id: randomUUID(), message: QUESTION, source: 'composer' };
    const core = await post(turn);
    expect(core.statusCode, core.body).toBe(200);
    expect(core.json()._agent.tool_calls).toEqual([]);
    expect(core.json().assistant_text).toBe(reply);
    expect(graphWrites).toEqual([]);
    expect(core.json().blocks.filter((b: Json) => b.type === 'analysis_result')).toEqual([]);
    const a = await post({ ...turn, turn_id: randomUUID() }, {});
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json().blocks.find((b: Json) => b.type === 'analysis_result')).toEqual(original);
    expect(carriedResult).toEqual(original);
  });

  it.each(['delivery', 'staffing'])('L4b real Run: %s core retains exact result data and AI facts, with no host summary; A retains exact bytes', async (subject) => {
    const label = subject === 'delivery' ? 'Weekly orders' : 'Weekly releases';
    persisted.nodes.find((n: Json) => n.id === 'orders').label = label;
    readiness = { status: 'ready', options: [], blockers: [], analysis_admission: {
      permitted_analysis_mode: 'quantified_provisional', reasons: [{ field: 'semantic_quality_sufficient', code: 'USER_STATED_PARAMETERS_NOT_MATERIAL' }],
    } };
    engineResult = { type: 'analysis_result', computed_against_hash: hashOf(persisted), leading_option_id: null,
      summary: `Host narration for ${label}: none of your estimates sits on the comparison path.`,
      win_probabilities: { 'Lease two more vans': 0.6, 'Carry on as now': 0.4 }, enrichment: {
        option_comparison: [{ option_id: 'add_vans', option_label: 'Lease two more vans', win_probability: 0.6, outcome: { mean: 130 } },
          { option_id: 'carry_on', option_label: 'Carry on as now', win_probability: 0.4, outcome: { mean: 110 } }],
        inference_warnings: [{ code: 'GOAL_CHANCE_LICENSED', form: 'each', pct_by_option: {}, withheld_option_ids: ['add_vans', 'carry_on'],
          withheld_reason_by_option: { add_vans: { reason: 'zero_spread', line: 'The spread is not established.' },
            carry_on: { reason: 'zero_spread', line: 'The spread is not established.' } } }],
      } };
    const original = structuredClone(engineResult);
    const reply = `${label}: the current model uses your settings. Our deadline is 2026-12-01; no chance is established.`;
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'voice_run', args: { reason: 'Run the saved model.', effects_timing: 'not_stated' } }],
      [{ type: 'message', text: reply }]];
    const turn = { turn_id: randomUUID(), message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } };
    const core = await post(turn);
    expect(core.statusCode, core.body).toBe(200);
    const j = core.json() as Json;
    expect(j._agent.tool_calls).toEqual([expect.objectContaining({ name: 'run_analysis', ok: true, ran: true })]);
    expect(runCount).toBe(1);
    expect(j.assistant_text).toBe(reply);
    expectCoherentInstructions(j);
    const aiOutput = calls.flatMap(c => c.input ?? []).find((i: Json) => i.type === 'function_call_output' && i.call_id === 'voice_run');
    expect(JSON.parse(aiOutput.output)).toMatchObject({ status: 'ok', ran: true, data: { result: { enrichment: {
      option_comparison: original.enrichment.option_comparison,
    } } } });
    expect(JSON.parse(aiOutput.output).data.result, 'core tool continuation keeps data and withholding, never host narration')
      .toEqual({ ...original, summary: '', decision_sensitivity: { status: 'not_measured' }, tipping_point: { status: 'not_evaluated' } });
    const block = j.blocks.find((b: Json) => b.type === 'analysis_result');
    expect(block, 'only narration is retired; numbers and every withheld reason stay').toEqual({ ...original, summary: '' });
    expect(j.canonical_analysis_view, 'typed canonical facts still ship').toBeDefined();
    const cold = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
    expect(cold.json().analysis_result, 'the A read fixture remains unmodified; the real core cold route has its own authority rows').toEqual(original);
    expect(j.canonical_analysis_view, 'turn and cold reader retain identical canonical facts').toEqual(cold.json().canonical_analysis_view);
    const count = calls.length;
    const replay = await post(turn);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()._agent.replayed).toBe(true);
    expect(replay.json().blocks.find((b: Json) => b.type === 'analysis_result')).toEqual(block);
    expect(calls).toHaveLength(count);
    expect(runCount).toBe(1);
    const a = await post({ turn_id: randomUUID(), message: QUESTION, source: 'composer' }, {});
    expect(a.statusCode, a.body).toBe(200);
    expect(calls.length).toBeGreaterThan(count);
    for (const c of calls.slice(count)) expect(JSON.stringify(c)).not.toContain(COHERENT_REPLY);
    expect(a.json().blocks.find((b: Json) => b.type === 'analysis_result')).toEqual({ ...original,
      summary: 'Your own estimates are in the model, but none of them sits on the path that decides this comparison, so these figures are still provisional. '
        + 'A share of runs in which an option fitted your goal better than the others is not the chance of reaching your target.\n\n' + original.summary });
    expect(engineResult).toEqual(original);
  });

  it.each(['orders', 'repairs'] as const)('L7: %s conditional effects retain separate D3 defaults in Run, AI and cold projections', async subject => {
    const fixture = d3Run(subject);
    persisted = fixture.graph;
    engineResult = { ...fixture.result, computed_against_hash: hashOf(persisted) };
    const licence = engineResult!.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
    expect(licence.pct_by_option).toEqual(Object.fromEntries(persisted.nodes.filter((n: Json) => n.kind === 'option')
      .map((n: Json, i: number) => [n.id, i ? 27 : 13])));
    readiness = { status: 'ready', options: [], blockers: [] };
    const reply = 'These are illustrative calculations using untested Olumi assumptions.';
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'd3_run', args: { reason: 'Run the saved model.', effects_timing: 'not_stated' } }],
      [{ type: 'message', text: reply }]];
    const r = await post({ turn_id: randomUUID(), message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(licence.default_assumptions?.status).toBe(ILLUSTRATIVE);
    const ledger = licence.default_assumptions.links;
    expect(ledger).toHaveLength(2);
    for (const [i, link] of ledger.entries()) {
      // The person's figure is theirs and so is the link's existence; only the spread is Olumi's, and its reason keeps their range apart.
      const edge = persisted.edges.find((e: Json) => e.from === link.from && e.to === link.to);
      expect(link.loss.map((l: Json) => l.after)).toEqual([edge.strength.std]);
      expect(edge.strength.std).toBeCloseTo((i ? 25 : 20) / 187.5 / 2, 12);
      expect(link.loss[0].reason).toContain('Olumi\'s illustrative spread (half the stated effect)');
      expect(link.loss[0].reason).toContain(`The stated range, ${i ? 5 : 10} to ${i ? 45 : 30}, is kept with the model but is not used as a spread.`);
      expect(edge.provenance.natural_effect).toMatchObject({ amount: i ? 25 : 20 });
      expect(edge.provenance.magnitude).toBe('user_stated');
    }
    const tool = calls.flatMap(c => c.input ?? []).find((i: Json) => i.type === 'function_call_output' && i.call_id === 'd3_run');
    expect(JSON.parse(tool.output), tool.output).toMatchObject({ status: 'ok', ran: true });
    const data = JSON.parse(tool.output).data;
    expect(data.result.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED').default_assumptions)
      .toEqual(licence.default_assumptions);
    const context = await readCanonicalContext({ dispatch: async () => ({ status: 200, json: withCanonicalAnalysisView({
      graph: persisted, graph_hash: hashOf(persisted), analysis_state: runState, analysis_result: carriedResult,
    }, SCENARIO) }) }, { scenario_id: SCENARIO });
    expect(context.status).toBe('ok');
    if (context.status !== 'ok') throw new Error('context unavailable');
    const selected = context.data.selected_run as Json;
    expect(selected.facts.current).toBe(true);
    expect(selected.facts.chances.goal_chance_licence.default_assumptions).toEqual(licence.default_assumptions);
    expect(selected.facts.must_say.filter((s: string) => s === ILLUSTRATIVE)).toEqual([ILLUSTRATIVE]);
    // The AI reads the person's own words and range in the living model, apart from Olumi's ledger.
    expect((context.data.living_model as Json).links.map((l: Json) => [l.source, l.quote, l.effect.low, l.effect.high])).toEqual([
      ['user', fixture.quotes[0], 10, 30], ['user', fixture.quotes[1], 5, 45]]);
    // A scenario saved before the core flip has no living model: the stored-model reader states the same ledger per link.
    const { living_model: _living, ...older } = persisted;
    const stored = await readCanonicalContext({ dispatch: async () => ({ status: 200, json: withCanonicalAnalysisView({
      graph: older, graph_hash: hashOf(older), analysis_state: runState, analysis_result: carriedResult,
    }, SCENARIO) }) }, { scenario_id: SCENARIO });
    if (stored.status !== 'ok') throw new Error('context unavailable');
    expect((stored.data.links as Json[]).filter(l => l.default_assumptions).map(l => l.default_assumptions)).toEqual(ledger.map((l: Json) => l.loss));
    const cold = (await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} })).json();
    expect(cold.canonical_analysis_view.goal_chance.default_assumptions).toEqual(licence.default_assumptions);
    expect(cold.canonical_analysis_view).toEqual(r.json().canonical_analysis_view);
    expect(runCount).toBe(1);
  });

  it.each([['orders', 'olumi'], ['repairs', 'olumi'], ['orders', 'stated'], ['repairs', 'stated']] as const)('L11: %s %s strengths disclose the actual Run assumptions and inputs on every reader', async (subject, mode) => {
    const fixture = d3Run(subject, mode);
    persisted = fixture.graph;
    inputsUsed = buildRunInputSnapshot({ submittedOptions: fixture.sent.options,
      rawObjectsPerOption: fixture.sent.options.map((o: Json) => o.interventions),
      wirePerOption: fixture.sent.options.map((o: Json) => Object.fromEntries(Object.entries(o.interventions).map(([id, cell]) => [id, (cell as Json).value]))),
      heldFactorIdsByOptionId: new Map(), optionsNotSent: [], wireGraph: fixture.sent.graph, plotPayload: fixture.sent });
    expect(inputsUsed).not.toBeNull();
    engineResult = { ...fixture.result, computed_against_hash: hashOf(persisted) };
    readiness = { status: 'ready', options: [], blockers: [] };
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'l11_run', args: { reason: 'Run.', effects_timing: 'not_stated' } }],
      [{ type: 'message', text: mode === 'stated' ? 'The Run uses the stated strengths.' : ILLUSTRATIVE }]];
    const r = await post({ turn_id: randomUUID(), message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } });
    expect(r.statusCode, r.body).toBe(200);
    const tool = calls.flatMap(c => c.input ?? []).find((i: Json) => i.type === 'function_call_output' && i.call_id === 'l11_run');
    const data = JSON.parse(tool.output).data;
    const assumptions = data.result.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED').default_assumptions;
    expect(data.inputs_used).toEqual(inputsUsed);
    if (mode === 'stated') {
      expect(assumptions).toBeUndefined();
    } else {
      expect(assumptions?.status).toBe(ILLUSTRATIVE);
      expect(assumptions.links).toHaveLength(2);
      for (const link of assumptions.links) {
        const edge = persisted.edges.find((e: Json) => e.from === link.from && e.to === link.to);
        expect(link.loss.map((row: Json) => [row.field_path.split('].')[1], row.after]).sort()).toEqual([
          ['exists_probability', edge.exists_probability], ['strength.std', edge.strength.std],
        ]);
      }
    }
    const cold = (await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} })).json();
    expect(cold.analysis_result.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED').default_assumptions).toEqual(assumptions);
    expect(cold.canonical_analysis_view.goal_chance?.default_assumptions).toEqual(assumptions);
    expect(r.json().canonical_analysis_view).toEqual(cold.canonical_analysis_view);
    expect(runCount).toBe(1);
  });

  it('L11: SDK science and question instructions are B-only and sent once', async () => {
    await post({ turn_id: randomUUID(), message: 'Separately, how can we improve staff training?', source: 'composer' });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.instructions.split('Illustrative calculation — uses untested Olumi assumptions.')).toHaveLength(2);
      expect(c.instructions).toContain('with the material assumptions and exact inputs used');
      expect(c.instructions).toContain('ask at most one question per reply');
      expect(c.instructions).toContain('never attribute spread to a stated range the Run did not use');
    }
    const count = calls.length;
    await post({ turn_id: randomUUID(), message: QUESTION, source: 'composer' }, {});
    for (const c of calls.slice(count)) {
      expect(JSON.stringify(c)).not.toContain('ask at most one question per reply');
      expect(JSON.stringify(c)).not.toContain('never attribute spread to a stated range the Run did not use');
    }
  });

  it('L11B: SDK receives the adopted conditional scope instruction without a mandatory handling question', async () => {
    const scope = "Keep a clearly separate situation out of the current scenario's Living Model. If the relationship to the current scenario is unclear, ask one brief scope question before building or changing the model, while continuing useful discussion. Do not ask again when the person has already made the scope clear. Ordinary expansion and what-ifs within this scenario remain allowed.";
    const r = await post({ turn_id: randomUUID(), message: 'Keep staff training separate; discuss it here without changing this model.', source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    expectCoherentInstructions(r.json());
    const { CORE_REPLY_INSTRUCTION } = await import('../../../../routes/agent-v1-turn.js');
    expect(createHash('sha256').update(CORE_REPLY_INSTRUCTION, 'utf8').digest('hex')).toBe('8c0d1f7343bfae2da5301f4277f3fcc70ed5984a8bfd4e14e2e51b29bd055e32'); // 23 Oct (b): boundary as the person's own arithmetic, the input always named, the low/high invited (was ea5b1aa0…). 23 Oct: exact inputs → each margin as goal_margins states it + a stress_test offered at the boundary of the input it rests on (DL brief, R2 c1; was 88385386…). 22 Oct: exact inputs → the Run's own results + the person's choice of figure to test (Track 3 c5; Codex r1 #3625; was ae209749…); stress_test only for a sized link/factor (buddy SIMPLER, was 30c84e52…); three-part coaching after a Run (part 2 never ranks unmeasured figures, Codex r1) + the held-risk window ask (was 9d54116b…); + CORE_NEXT_STEP decisive question (Track 3 Q2 v2 + buddy AMEND, 21 Oct; was 2dd87dc8…), Track 3 E2E 21 Oct (was 7f0493d6…; arm C adopted 21 Oct)
    for (const c of calls) {
      expect(c.instructions).toContain(CORE_REPLY_INSTRUCTION);
      expect(c.instructions.split(scope)).toHaveLength(2);
      expect(c.instructions).not.toContain("Keep a clearly separate situation out of the current scenario's Living Model and ask once how they want to handle it, for example as its own scenario.");
      expect(c.instructions).not.toContain('Do not ask again once the person has said how to handle the separate situation.');
    }
  });

  describe('one core turn at a time per scenario (buddy BLOCK on #3529: the waiting turn read the model it arrived to)', () => {
    it('⭐ RED→GREEN: a turn sent while another is running starts from the model that turn saved', async () => {
      let release!: () => void;
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      outputs = [[{ type: 'message', text: 'First answer.' }], [{ type: 'message', text: 'Second answer.' }]];
      const first = post({ turn_id: randomUUID(), message: 'First question.', source: 'composer' });
      await vi.waitFor(() => expect(calls.length).toBe(1));
      const second = post({ turn_id: randomUUID(), message: 'Second question.', source: 'composer' });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(calls.length, 'the second turn sends nothing while the first is running').toBe(1);
      // The first turn saves meanwhile: today's vans move from 2 to 3 in the stored model (a new revision).
      persisted = { ...persisted, nodes: (persisted.nodes as Json[]).map((n) => n.id === 'vans'
        ? { ...n, observed_state: { ...n.observed_state, value: 0.375, raw_value: 3 } } : n) };
      release();
      const [a, b] = await Promise.all([first, second]);
      expect(a.statusCode, a.body).toBe(200);
      expect(b.statusCode, b.body).toBe(200);
      expect(calls).toHaveLength(2);
      const vans = (c: Json): unknown => (JSON.parse(String(c.instructions).split('As the turn began: ')[1]!.split('\n')[0]!) as Json)
        .entities.find((e: Json) => e.id === 'vans').raw_value;
      expect(vans(calls[0]!), 'CONTROL: the first turn read the model before the save').toBe(2);
      expect(vans(calls[1]!), 'the waiting turn reads the model the first turn saved').toBe(3);
    });
  });
});
