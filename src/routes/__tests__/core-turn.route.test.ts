/**
 * ⭐ THE CORE ROUTE (`POST /agent/v1/core-turn`, R2; DL 22 Oct). The real route over a core scenario (a living model), with a
 * scripted AI (0 live provider calls) and the graph / register / versions / orchestrate routes as doubles in the served shapes:
 * a typed turn, a Run press, a card's approval, a resend of the same turn id, two turns at once, a legacy scenario, a canvas
 * edit, the first draft's streamed graph, and the contract's exact shape. SYNTHETIC wording (the KNOWN_ANSWER fixture).
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AnalysisStateV1Schema } from '@talchain/schemas/boundary';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../orchestrator-v5/context/graph-hash.js';
import { registrationTurnId } from '../../orchestrator-v5/graph-registration/registration-identity.js';
import { toOutboundGraph } from '../../orchestrator-v5/goal-target/outbound-graph.js';
import { mapLivingModel } from '../../orchestrator-v5/path-b/living-model/mapper.js';
import { KNOWN_ANSWER, OPTION_EFFECTS } from '../../orchestrator-v5/path-b/living-model/__tests__/fixtures.js';
import { withCanonicalAnalysisView } from '../../orchestrator-v5/agent-lane/__tests__/fixtures/canonical-analysis-read.js';
import { streamWhenAsked } from '../../orchestrator-v5/agent-lane/__tests__/stream-when-asked.js';
import { SELECTION_NOTE_PREFIX } from '../../orchestrator-v5/agent-lane/selection-context.js';
import { TODAY_PREFIX } from '../../orchestrator-v5/agent-lane/turn-context.js';
import { corePromptCacheKey, STATE_BLOCK_PREFIX } from '../../orchestrator-v5/agent-lane/core/sdk-turn.js';
import { CORE_INSTRUCTIONS_LIVING_MODEL, CORE_REPLY_RULES_LIVING_MODEL, instructionsForMode, PROGRAM_TOOL_DESCRIPTIONS } from '../../orchestrator-v5/core-route/instructions.js';
import { TOOL_DESCRIPTIONS } from '../../orchestrator-v5/path-b/tools/index.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { ASK_CHALLENGE_CHIP_ID } from '../../orchestrator-v5/core-route/turn-request.js';
import { bakery, BRIEF as BAKERY_BRIEF, club, CLUB_BRIEF, q } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import { DRAFTING_INSTRUCTIONS } from '../../orchestrator-v5/model-program-turn/prompt.js';
import type { LivingModelT } from '../../schemas/living-model.js';
import { GOAL_CHANCE_LICENSED, PERIOD_END_EFFECTS_UNSTATED } from '../../orchestrator-v5/goal-target/goal-chance-licence.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../orchestrator/context/option-result-source.js';
import { coreBudget } from '../../orchestrator-v5/agent-lane/model-budgets.js';

type Json = Record<string, any>;
let SCENARIO = '';
const BRIEF = 'we need at least 100 units; today we are at 70. f is at 0.5. push f to 1, or we hold. each +1 in f adds 50 units on average, with a standard deviation of 10. Sam disagrees';
const postimage = (m: LivingModelT): Json => ({ ...mapLivingModel(m).graph, living_model: m });
const SAID = 'Actually f is at 0.6 now.';
const corrected = (): LivingModelT => {
  const m = structuredClone(KNOWN_ANSWER);
  m.factors[0] = { ...m.factors[0]!, value: 0.6, quote: SAID };
  return m;
};
const CHANGE = { public_label: 'Set f to 0.6, as you said', basis: 'The person corrected f.', model: corrected(), remove: [] as string[] };
/** The SDK's final output, with the bytes a host "tidy" would touch: leading space, markdown, a trailing newline. */
const ANSWER = '  The model holds **f at 0.5** today:\n\n- Push sets it to 1\n- Hold keeps it\n';
const CONTRACT_KEYS = ['turn_id', 'durability', 'assistant_text', 'model', 'cards', 'notes', 'run', 'analysis_state', 'receipts', 'paused', 'error', 'action_bar', '_agent', '_provider_calls'];
const LEGACY_ENVELOPE = ['response_version', 'blocks', 'suggested_actions', 'insights', 'stage_indicator'];

let persisted: Json | null = null;
let readiness: Json = { status: 'blocked', may_run: false, options: [], blockers: [] };
let runState: Json | undefined;
let carriedResult: Json | undefined;
/** When set, the read selects ANOTHER Run than the one this turn confirmed (one that landed while the reply was written). */
let otherRun: string | undefined;
let runs = 0;
let timingRun = false;
const runTimings: unknown[] = [];
const registered: Json[] = [];
const canvasForwards: { headers: Json; body: Json }[] = [];
const turnRows = new Map<string, any>();
/** The scenario's turn fence (`v5_turn_fence`): a claim takes the next generation; a Stop sets the row's tombstone. */
const fenceRows = new Map<string, { generation: number; stopped_at: string | null }>();
let fenceGeneration = 0;
let pausedRun: any = null;
const conversationIds = new Map<string, string>();
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
/** A SERVED analysis_state (staging, `served-pj-a02-run.json`): the full v1 object the graph read's builder composes. */
const SERVED_STATE = (JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/served-pj-a02-run.json', import.meta.url), 'utf8')) as Json).analysis_state as Json;
/** The read's state now: never run (no fact, so no usability) until the Run, then that Run, current. */
const stateNow = (): Json => runState === undefined
  ? { ...SERVED_STATE, run_state: { kind: 'never_run' }, usable_for_prose: false, usable_for_chips: false, usable_for_followup: false }
  : { ...SERVED_STATE, run_state: runState.run_state };

const store = {
  readOpenAiPausedRun: vi.fn(async () => pausedRun),
  saveOpenAiPausedRun: vi.fn(async (_s: string, r: any) => { if (pausedRun !== null) return false; pausedRun = r; return true; }),
  takeOpenAiPausedRun: vi.fn(async (_s: string, id: string) => { if (pausedRun?.pause_id !== id) return false; pausedRun = null; return true; }),
  readOpenAiConversationId: vi.fn(async (sid: string) => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string) => { if (!conversationIds.has(sid)) conversationIds.set(sid, id); return conversationIds.get(sid); }),
  loadGraph: async () => persisted,
  loadGraphAndBriefText: async () => ({ graph: persisted, briefText: BRIEF }),
  readFactsFor: vi.fn(async () => []),
  // Newest first, claims included, as the store reads them (`supabase-store.ts` readRecent: created_at descending).
  readRecent: vi.fn(async () => [...turnRows.values()].reverse()),
  readFactsWithTurnFor: async () => [],
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async () => [...turnRows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  releaseTurnClaim: vi.fn(async (_sid: string, id: string, hash: string) => { if (turnRows.get(id)?.request_hash === hash) turnRows.delete(id); }),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  append: vi.fn(async (write: Json) => {
    const key = String(write.turn_id);
    const prior = turnRows.get(key);
    if (prior !== undefined) return prior.request_hash === write.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...write, id: `row-${turnRows.size + 1}`, created_at: new Date(Date.now() + turnRows.size).toISOString(), assistant_message: write.assistantMessage, user_message: write.userMessage };
    turnRows.set(key, row);
    return { id: row.id };
  }),
  getScenarioOwner: async () => null,
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  claimTurnFence: vi.fn(async (sid: string, tid: string) => {
    if (!fenceRows.has(`${sid}:${tid}`)) fenceRows.set(`${sid}:${tid}`, { generation: ++fenceGeneration, stopped_at: null });
    return { scenarioId: sid, turnId: tid, generation: fenceRows.get(`${sid}:${tid}`)!.generation };
  }),
  turnFenceRowExists: vi.fn(async (sid: string, tid: string) => fenceRows.has(`${sid}:${tid}`)),
  markTurnStopped: vi.fn(async (sid: string, tid: string) => {
    const row = fenceRows.get(`${sid}:${tid}`);
    fenceRows.set(`${sid}:${tid}`, { generation: row?.generation ?? ++fenceGeneration, stopped_at: '2026-10-23T10:00:00.000Z' });
    return { stopped: true, claimed: row !== undefined, alreadyCommitted: false };
  }),
};
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let served = 0;
/** When set, the next provider call waits for it: a turn still running while another is sent. */
let holdProvider: Promise<void> | undefined;
/** When set, only a call this picks is held (the reply call after a tool ran: the approval has committed and awaits its words). */
let holdWhen: ((body: Json) => boolean) | undefined;
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

/** The served read (assist.v1.scenario-graph.ts): the graph in its outbound projection; `content_hash` is identity.v1's value. */
function graphRead(): Json {
  if (persisted === null) return { scenario_id: SCENARIO, graph: null, graph_present: false, brief_text: null, graph_identity_hash: null, graph_hash: null, content_hash: null };
  const graph = toOutboundGraph(persisted);
  const read = withCanonicalAnalysisView({ scenario_id: SCENARIO, graph, graph_present: true, brief_text: BRIEF, graph_hash: hashOf(persisted),
    graph_identity_hash: computeGraphIdentityHash(persisted as never), content_hash: computeGraphIdentityHash(persisted as never)!.value, analysis_ready: readiness,
    analysis_state: stateNow(), current_read: runState === undefined ? { run_state: { kind: 'never_run' }, computed_against_hash: null, run_id: null }
      : { run_state: runState.run_state, computed_against_hash: hashOf(persisted), run_id: 'fixture-read-run' },
    ...(carriedResult === undefined ? {} : { analysis_result: carriedResult }) }, SCENARIO);
  return otherRun === undefined ? read
    : { ...read, canonical_analysis_view: { ...read.canonical_analysis_view, run: { ...read.canonical_analysis_view.run, run_id: otherRun } } };
}

describe('POST /agent/v1/core-turn: the thin core route', () => {
  let app: FastifyInstance;
  let calls: Json[] = [];
  let outputs: Json[][] = [];
  /** The canonical drafter's answer for a first turn (a scenario with no saved model). */
  let canonicalDraft: string | undefined;
  let runWithStageStream: typeof import('../../cee/unified-pipeline/stage-stream-context.js').runWithStageStream;
  let currentTurnFence: typeof import('../../orchestrator-v5/session/turn-fence.js').currentTurnFence;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return json({ id: `conv_${randomUUID()}`, object: 'conversation' });
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      // The canonical drafter's strict call answers with the row's canned canonical model (none: no draft).
      if (body.text?.format?.name === 'canonical_model') { calls.push(body); return json(responsesBody(canonicalDraft === undefined ? [] : [{ type: 'message', text: canonicalDraft }])); }
      // A structured side call (the model critic) answers nothing, and never takes the conversation's scripted outputs.
      if (body.text?.format?.type === 'json_schema') return json(responsesBody([]));
      calls.push(body);
      if (holdProvider !== undefined && (holdWhen === undefined || holdWhen(body))) { const hold = holdProvider; holdProvider = undefined; await hold; }
      const next = outputs.shift() ?? [{ type: 'message', text: ANSWER }];
      // A refused call (a 400: never retried), so the turn ends with no reply.
      if (next[0]?.type === 'refuse') return json({ error: { message: 'Refused.', type: 'invalid_request_error', param: null, code: null } }, 400);
      return json(responsesBody(next));
    })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../core-turn.js');
    // The route's own instance (after resetModules): the stage context must be the one the route reads.
    ({ runWithStageStream } = await import('../../cee/unified-pipeline/stage-stream-context.js'));
    ({ currentTurnFence } = await import('../../orchestrator-v5/session/turn-fence.js'));
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => graphRead());
    app.post('/assist/v1/scenarios/:id/graph/register', async (req, reply) => {
      const b = req.body as Json;
      // The commit's own gate (append_turn_atomic_v4, 20260806120000): keyed by the BOUND fence handle's generation, a
      // stopped row refuses in the transaction. The real route commits a core turn's write under the turn's handle.
      const bound = currentTurnFence();
      if (bound !== undefined && [...fenceRows.values()].some((r) => r.generation === bound.generation && r.stopped_at !== null)) {
        return reply.code(409).send({ details: { code: 'TURN_STOPPED' } });
      }
      const current = persisted === null ? null : computeGraphIdentityHash(persisted as never)!.value;
      if ((b.expected_graph_identity_hash ?? null) !== current) return reply.code(409).send({ details: { code: 'GRAPH_STALE' } });
      persisted = b.graph as Json;
      registered.push(b);
      const identity = computeGraphIdentityHash(persisted as never)!;
      return { registered: true, graph_identity_hash: identity, graph_hash: hashOf(persisted),
        model_version: { version_id: `v_${registered.length}`, version_number: registered.length, mutation_id: `m_${registered.length}`,
          creation_kind: registered.length === 1 ? 'initial' : 'committed_mutation', graph_identity_hash: identity.value,
          analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(persisted as never) } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async (req) => ({ versions: registered.map((b, i) => ({
      version_id: `v_${i + 1}`, sequence: i + 1, created_at: '2026-10-22T10:00:00.000Z',
      creation: { kind: 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId((req.params as { id: string }).id, String(b.operation_id)) } })) }));
    app.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as Json;
      // A canvas edit (the existing core canvas-edit path, as a double): the person's own value lands in the living model.
      if (b.kind === 'system_event') {
        canvasForwards.push({ headers: req.headers as Json, body: b });
        const m = structuredClone((persisted as Json).living_model) as LivingModelT;
        m.options = m.options.map((o) => o.id === 'push' ? { ...o, settings: [{ ...o.settings[0]!, value: Number(b.event.value), quote: null }] } : o);
        persisted = postimage(m);
        return { response_version: 2, assistant_text: '', graph_hash: hashOf(persisted) };
      }
      // The Run: one engine result, on the saved revision.
      runs += 1;
      const timing = b.chip?.parameters?.effects_timing;
      runTimings.push(timing);
      carriedResult = { type: 'analysis_result', computed_against_hash: hashOf(persisted), leading_option_id: null, summary: 'Engine summary.',
        enrichment: { option_comparison: [{ option_id: 'push', option_label: 'Push', win_probability: 0.7, outcome: { mean: 115 } },
          { option_id: 'hold', option_label: 'Hold', win_probability: 0.3, outcome: { mean: 95 } }], inference_warnings: [] } };
      // Engine double: a valid timing reading licenses its synthetic chances; otherwise every target is withheld.
      if (timingRun) {
        const options = (persisted!.nodes as Json[]).filter((n) => n.kind === 'option');
        const hasReading = timing === 'not_stated' || timing === 'in_place_by_period';
        carriedResult.enrichment = {
          option_comparison: options.map((o) => ({ option_id: o.id, option_label: o.label, ...(hasReading ? { probability_of_goal: 0.5 } : {}) })),
          inference_warnings: [hasReading
            ? { code: GOAL_CHANCE_LICENSED, effects_timing: timing, effects_timing_origin: 'olumi' }
            : { code: GOAL_FIGURES_TARGET_NOT_TESTABLE, option_ids: options.map((o) => o.id),
                message: 'The model has not established how much of these effects would be in place by then.',
                detail: { reason: PERIOD_END_EFFECTS_UNSTATED, effects_timing: null, effects_timing_origin: null } }],
        };
      }
      runState = { run_state: { kind: 'complete_current', computed_at: '2026-10-22T10:00:00.000Z' } };
      return { response_version: 2, assistant_text: '', blocks: [carriedResult], analysis_state: runState, analysis_ready: readiness, graph_hash: hashOf(persisted) };
    });
    // The real Stop handler (route-v2's `/orchestrate/v2/turn/stop` body), over the same store.
    const { recordExplicitTurnStop } = await import('../turn-stop.js');
    app.post('/orchestrate/v2/turn/stop', async (req, reply) => { const r = await recordExplicitTurnStop(req, 'req-stop'); return reply.code(r.status).send(r.body as never); });
    await app.register(route.coreTurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    SCENARIO = randomUUID(); persisted = postimage(KNOWN_ANSWER); canonicalDraft = undefined; registered.length = 0; fenceRows.clear(); canvasForwards.length = 0; turnRows.clear(); conversationIds.clear();
    readiness = { status: 'blocked', may_run: false, options: [], blockers: [] }; runState = undefined; carriedResult = undefined; otherRun = undefined; runs = 0; timingRun = false; runTimings.length = 0;
    pausedRun = null; calls = []; outputs = []; preparedId = ''; holdProvider = undefined; holdWhen = undefined;
  });
  const post = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/core-turn',
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const typed = (message: string, turnId = randomUUID()) => post({ turn_id: turnId, message, source: 'composer' });
  const freshRead = async (): Promise<Json> => (await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} })).json() as Json;
  const ids = (graph: Json | undefined): string[] => ((graph?.nodes ?? []) as Json[]).map((n) => String(n.id)).sort();

  it('a typed turn: the AI’s reply byte for byte, and the saved model in the contract’s exact shape', async () => {
    const r = await typed('What does the model hold for f today?');
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(Object.keys(j)).toEqual(CONTRACT_KEYS);
    for (const k of LEGACY_ENVELOPE) expect(j, `no legacy envelope key ${k}`).not.toHaveProperty(k);
    // NEGATIVE: nothing is composed around the SDK's final output, not even a trim.
    expect(j.assistant_text).toBe(ANSWER);
    expect(j).toMatchObject({ durability: 'recorded', cards: [], notes: [], run: null, receipts: [], paused: null, error: null });
    expect(j).not.toHaveProperty('analysis_result');
    const read = await freshRead();
    expect(j.model.revision).toBe(read.graph_hash);
    expect(j.model.scenario_revision, 'identity.v1, as the graph read serves it').toBe(read.graph_identity_hash.value);
    expect(read.content_hash).toBe(read.graph_identity_hash.value);
    expect(ids(j.model.graph)).toEqual(ids(read.graph));
    expect(calls).toHaveLength(1);
    expect(turnRows.get(j.turn_id)?.assistant_message, 'the answer row records the same words').toBe(ANSWER);
  });

  it('DL 93d79c3e 09:24Z: the turn carries the panel\'s action bar, ranked from its own read: only the pre-mortem a core press serves', async () => {
    const j = (await typed('What does the model hold for f today?')).json() as Json;
    const read = await freshRead();
    const offers = [...j.action_bar.priority, ...j.action_bar.standard, ...j.action_bar.more] as Json[];
    expect(offers.map((o) => o.action_id)).toEqual(['pre_mortem']);
    expect(offers[0]).toMatchObject({ press_id: 'agent-next-pre-mortem', enabled: true });
    expect(j.action_bar.revision.graph_hash, 'bound to the saved model the turn answered on').toBe(read.graph_hash);
  });

  it('a Run press: run_analysis is the first call’s forced tool, ONE Run, and the fresh analysis_result rides the contract', async () => {
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_press', args: { reason: 'The person pressed Run.', effects_timing: 'not_stated' } }],
      [{ type: 'message', text: 'The analysis ran on your saved model.' }]];
    const r = await post({ turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(calls[0]?.tool_choice).toMatchObject({ type: 'function', name: 'run_analysis' });
    expect(runs).toBe(1);
    expect(j.assistant_text).toBe('The analysis ran on your saved model.');
    const read = await freshRead();
    expect(j.analysis_result).toEqual(read.analysis_result);
    expect(j.run).toMatchObject({ run_id: read.canonical_analysis_view.run.run_id, state: { kind: 'complete_current' } });
    expect(j.run.run_id).not.toBeNull();
    expect(j.analysis_state).toEqual(read.analysis_state);
  });

  it('a card: proposed on a typed turn, approved by its own press as ONE commit with the person’s receipt, and a resend of the press writes nothing', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'I prepared that change; press its card to save it.' }]];
    const first = (await typed(SAID)).json() as Json;
    expect(first.cards.map((c: Json) => c.proposal_id), JSON.stringify(first._agent)).toEqual([expect.stringMatching(/^prop_/)]);
    const card = first.cards[0];
    preparedId = String(card.proposal_id);
    expect(card.issued_turn_id, 'the card names the reply that issued it, so it reattaches on reopen').toBe(first.turn_id);
    expect(registered, 'a proposal writes nothing').toHaveLength(0);

    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved: f is 0.6 now.' }]];
    const pressId = randomUUID();
    const press = { turn_id: pressId, message: card.approve_action.message, source: 'chip_click', chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } };
    const approved = await post(press);
    expect(approved.statusCode, approved.body).toBe(200);
    const a = approved.json() as Json;
    expect(calls[2]?.tool_choice, 'the press opens on the change’s own apply_change').toMatchObject({ type: 'function', name: 'apply_change' });
    // M4 (DL 22 Oct): every press call goes out at the typed turn's effort and output cap, so it reads their cached prefix.
    for (const c of calls.slice(2)) expect({ model: c.model, reasoning: c.reasoning, max_output_tokens: c.max_output_tokens })
      .toEqual({ model: calls[0]!.model, reasoning: calls[0]!.reasoning, max_output_tokens: calls[0]!.max_output_tokens });
    expect(calls[0]!.reasoning, 'control: the typed turn sends an effort').toEqual({ effort: coreBudget().reasoning_effort });
    expect(registered, JSON.stringify(a._agent)).toHaveLength(1);
    expect(((persisted as Json).living_model as LivingModelT).factors[0]).toMatchObject({ value: 0.6 });
    expect(a.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
    expect(a.cards, 'the applied card is no longer waiting').toEqual([]);
    expect(a.assistant_text).toBe('Saved: f is 0.6 now.');
    // CONTRAST (the row below): readiness admits no Run here, so none ran and no result is claimed.
    expect(runs).toBe(0);
    expect(a).not.toHaveProperty('analysis_result');

    const callsBefore = calls.length;
    const again = (await post(press)).json() as Json;
    expect(again).toMatchObject({ durability: 'replayed', assistant_text: 'Saved: f is 0.6 now.', error: null });
    expect(calls.length, 'a replay calls no model').toBe(callsBefore);
    expect(registered, 'and writes nothing').toHaveLength(1);
  });

  it('DL 93d79c3e 09:40Z (Lenses on 50f76df0): a Stop during a core turn is recorded as its tombstone, and the write the AI then makes commits nothing', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'Prepared.' }]];
    const card = ((await typed(SAID)).json() as Json).cards[0];
    preparedId = String(card.proposal_id);
    let release!: () => void;
    holdProvider = new Promise<void>((resolve) => { release = resolve; });
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
    const pressId = randomUUID();
    const before = calls.length;
    const approval = post({ turn_id: pressId, message: card.approve_action.message, source: 'chip_click', chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
    // The press's first call is held: the turn is admitted, and nothing is written yet.
    await vi.waitFor(() => expect(calls.length).toBe(before + 1));
    const stop = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn/stop', payload: { scenario_id: SCENARIO, turn_id: pressId } });
    expect(stop.statusCode, stop.body).toBe(200);
    expect(stop.json()).toMatchObject({ stopped: true, claimed: true, turn_id: pressId });
    expect(fenceRows.get(`${SCENARIO}:${pressId}`)?.stopped_at, 'the tombstone').not.toBeNull();
    release();
    const a = (await approval).json() as Json;
    expect(calls.at(-2)?.tool_choice, 'control: the AI did send its apply').toMatchObject({ type: 'function', name: 'apply_change' });
    expect(registered, 'nothing committed after the Stop').toHaveLength(0);
    expect(((persisted as Json).living_model as LivingModelT).factors[0]).toMatchObject({ value: 0.5 });
    expect(a.receipts).toEqual([]);
  });

  describe('DL 93d79c3e (marketing on 05745055): a card press applies THAT card, whatever id the AI sends', () => {
    const propose = async () => {
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'I prepared that change.' }]];
      const card = ((await typed(SAID)).json() as Json).cards[0];
      preparedId = String(card.proposal_id);
      return { turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click', chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } };
    };
    it('the AI sends an empty id on the press: the pressed card is applied, once, with the person\'s receipt; nothing is left paused', async () => {
      const press = await propose();
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply', args: { proposal_id: '' } }], [{ type: 'message', text: 'Saved.' }]];
      const r = await post(press);
      expect(r.statusCode, r.body).toBe(200);
      const a = r.json() as Json;
      expect(registered, JSON.stringify(a._agent)).toHaveLength(1);
      expect(((persisted as Json).living_model as LivingModelT).factors[0]).toMatchObject({ value: 0.6 });
      expect(a.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
      expect(a.cards).toEqual([]);
      expect(a.paused).toBeNull();
      expect(pausedRun).toBeNull();
    });
    it('Codex r1 on #3695: two held cards; the AI applies the OTHER one on the press of the first: the pressed card is the one applied', async () => {
      const pressA = await propose();
      const idA = preparedId;
      const sevenSaid = 'f is at 0.7 by now.';
      const seven = structuredClone(KNOWN_ANSWER);
      seven.factors[0] = { ...seven.factors[0]!, value: 0.7, quote: sevenSaid };
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'propB', args: { ...CHANGE, public_label: 'Set f to 0.7', model: seven } }],
        [{ type: 'message', text: 'I prepared that change too.' }]];
      const held = ((await typed(sevenSaid)).json() as Json).cards.map((c: Json) => String(c.proposal_id));
      const idB = held.find((id: string) => id !== idA)!;
      expect(held, 'both cards are held').toEqual(expect.arrayContaining([idA, idB]));
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply', args: { proposal_id: idB } }], [{ type: 'message', text: 'Saved.' }]];
      const r = await post(pressA);
      expect(r.statusCode, r.body).toBe(200);
      expect(registered).toHaveLength(1);
      expect(((persisted as Json).living_model as LivingModelT).factors[0], 'A, the pressed card, never B').toMatchObject({ value: 0.6 });
    });

    it('a pause the AI left on an empty id never keeps the held card from its press: the re-press applies it', async () => {
      const press = await propose();
      // A typed turn on which the AI applied with an empty id: its call waits on no card this scenario holds.
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'stray', args: { proposal_id: '' } }]];
      expect((await typed('Go ahead with it.')).statusCode).toBe(200);
      expect(pausedRun, 'the stray pause is kept, on no card').toMatchObject({ proposal_id: '' });
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply', args: { proposal_id: '' } }], [{ type: 'message', text: 'Saved.' }]];
      const r = await post(press);
      expect(r.statusCode, r.body).toBe(200);
      expect(registered).toHaveLength(1);
      expect(((persisted as Json).living_model as LivingModelT).factors[0]).toMatchObject({ value: 0.6 });
      expect((r.json() as Json).receipts).toEqual([expect.objectContaining({ authorised_by: 'person' })]);
    });
  });

  it('Lenses 22 Oct (15c72e9d): an approval whose saved model admits a Run carries that automatic Run\u2019s analysis_result in the contract, as a Run press does', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'I prepared that change; press its card to save it.' }]];
    const card = ((await typed(SAID)).json() as Json).cards[0];
    preparedId = String(card.proposal_id);
    readiness = { status: 'ready', may_run: true, options: [], blockers: [] };
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved, and the analysis ran.' }]];
    const r = await post({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click',
      chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
    expect(r.statusCode, r.body).toBe(200);
    const a = r.json() as Json;
    expect(runs, JSON.stringify(a._agent)).toBe(1);
    const read = await freshRead();
    expect(a.analysis_result, 'the automatic Run\u2019s fresh result, as the read now holds it').toEqual(read.analysis_result);
    expect(a.run).toMatchObject({ run_id: read.canonical_analysis_view.run.run_id, state: { kind: 'complete_current' } });
  });

  describe.each([
    ['capacity brief', KNOWN_ANSWER, 'not_stated', true],
    // CONTRAST: this shape's goal carries no target the licence reads (goal_threshold_raw null), so its chance needs no timing reading.
    ['widgets brief', OPTION_EFFECTS, 'in_place_by_period', false],
  ] as const)('automatic Run timing: %s', (_brief, base, reading, needsReading) => {
    it.each(['unrelated change', 'subject changed', 'no prior reading'] as const)('%s', async (row) => {
      // Small synthetic change-at-period-end models, with the same timing carrier as the captured approval.
      const initial = structuredClone(base);
      initial.aims[0]!.source = 'olumi';
      initial.aims[0]!.quote = null;
      Object.assign(initial.aims[0]!.target!, { comparator: 'increase', value: 10, unit: '%', current: null,
        current_unit: null, change_kind: 'relative', baseline: 'today', period_months: 3 });
      for (const link of initial.links) link.effect.unit = '%';
      persisted = postimage(initial);
      expect(persisted.nodes.find((n: Json) => n.kind === 'goal').goal_target_basis).toMatchObject({
        period_months: 3, effects_at_period_end: false, source: 'olumi_reading',
      });
      timingRun = true;
      readiness = { status: 'ready', may_run: true, options: [], blockers: [] };
      if (row !== 'no prior reading') {
        outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'pressed', args: { reason: 'Run pressed.', effects_timing: reading } }],
          [{ type: 'message', text: 'Ran.' }]];
        const pressed = await post({ turn_id: randomUUID(), message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } });
        expect(pressed.statusCode, pressed.body).toBe(200);
        expect(runTimings).toEqual([reading]);
      }
      const model = structuredClone(initial);
      // As in the capture: add an unrelated factor, leaving every option and the goal unchanged.
      model.factors.push({ ...structuredClone(KNOWN_ANSWER.factors[0]!), id: 'extra', label: 'Extra factor', value: null, low: 0.2, high: 0.3, source: 'olumi', quote: null });
      if (row === 'subject changed') model.options[0]!.label += ' revised';
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop',
        args: { public_label: 'Add extra factor', basis: 'An additional consideration.', model, remove: [] } }],
        [{ type: 'message', text: 'Prepared.' }]];
      const proposed = await typed('Add an extra factor.');
      expect(proposed.statusCode, proposed.body).toBe(200);
      const card = (proposed.json() as Json).cards[0];
      expect(card).toBeDefined();
      preparedId = String(card.proposal_id);
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved and analysed.' }]];
      const approved = await post({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click',
        chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
      expect(approved.statusCode, approved.body).toBe(200);
      expect(registered).toHaveLength(1);
      const chances = (result: Json) => {
        expect(result.enrichment.option_comparison).toHaveLength(initial.options.length);
        for (const option of result.enrichment.option_comparison) expect(option.probability_of_goal, option.option_id).toBe(0.5);
      };
      if (row === 'unrelated change' || !needsReading) {
        // CONTRAST: a reading to carry, or a goal whose chance needs none: the automatic Run runs, as before.
        expect(runs).toBe(row === 'no prior reading' ? 1 : 2);
        expect(runTimings.at(-1)).toBe(row === 'unrelated change' ? reading : null);
        const result = (approved.json() as Json).analysis_result;
        expect(result).toEqual((await freshRead()).analysis_result);
        if (row === 'unrelated change') chances(result);
        return;
      }
      // ⭐ DL 22 Oct (hiring a, 2fa753d6): no reading to carry, so no automatic Run that could only withhold every chance
      // (it was a GOAL_FIGURES_TARGET_NOT_TESTABLE / PERIOD_END_EFFECTS_UNSTATED result). The reply is told to invite Run.
      expect(runs).toBe(row === 'no prior reading' ? 0 : 1);
      expect(approved.json() as Json).not.toHaveProperty('analysis_result');
      expect(JSON.stringify(calls.at(-1)!.input)).toContain('run_awaits_timing');
      // The invited Run, with the AI's reading, gives the chances.
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'invited', args: { reason: 'Run pressed.', effects_timing: reading } }],
        [{ type: 'message', text: 'Ran.' }]];
      const invited = await post({ turn_id: randomUUID(), message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } });
      expect(invited.statusCode, invited.body).toBe(200);
      expect(runTimings.at(-1)).toBe(reading);
      chances((await freshRead()).analysis_result);
    });
  });

  it('Codex r1 on #3668: a Run that lands while the approval\u2019s reply is written is not that approval\u2019s: its result is not shipped', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'Prepared.' }]];
    const card = ((await typed(SAID)).json() as Json).cards[0];
    preparedId = String(card.proposal_id);
    readiness = { status: 'ready', may_run: true, options: [], blockers: [] };
    // ⭐ DETERMINISTIC (DL 22 Oct: a timer-polled flip raced the automatic Run's own confirming read, about 1 run in 4): the other
    // Run lands exactly when the reply call is made, so after the approval's tool (its Run and that Run's confirming read) and
    // before the turn's final read. The gate is already resolved: no timer and no wait decide the order.
    let landedAfterRuns: number | undefined;
    holdProvider = Promise.resolve();
    holdWhen = (body) => {
      const reply = Array.isArray(body.input) && (body.input as Json[]).some((i) => i.type === 'function_call_output');
      if (reply) {
        landedAfterRuns = runs;
        otherRun = 'another-run';
        carriedResult = { ...carriedResult, summary: 'Another Run\u2019s summary.' };
      }
      return reply;
    };
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved, and the analysis ran.' }]];
    const r = await post({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click',
      chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
    expect(r.statusCode, r.body).toBe(200);
    expect(landedAfterRuns, 'the other Run lands after the approval\u2019s own automatic Run').toBe(1);
    const a = r.json() as Json;
    expect(a.analysis_result, 'never another Run\u2019s result beside this Run\u2019s narration').toBeUndefined();
    expect(a.run).toMatchObject({ run_id: 'another-run' });
  });

  it('analysis_state is the read\u2019s FULL v1 state on a typed turn, a card turn and a Run turn (contract v1.4/v1.5)', async () => {
    const typedTurn = (await typed('What does the model hold for f today?')).json() as Json;
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'Prepared.' }]];
    const cardTurn = (await typed(SAID)).json() as Json;
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_press', args: { reason: 'The person pressed Run.', effects_timing: 'not_stated' } }],
      [{ type: 'message', text: 'Ran.' }]];
    const runTurn = (await post({ turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } })).json() as Json;
    expect(cardTurn.cards).toHaveLength(1);
    expect(runs).toBe(1);
    for (const [turn, kind] of [[typedTurn, 'never_run'], [cardTurn, 'never_run'], [runTurn, 'complete_current']] as const) {
      expect(AnalysisStateV1Schema.safeParse(turn.analysis_state).success, JSON.stringify(turn.analysis_state)).toBe(true);
      expect(Object.keys(turn.analysis_state).sort()).toEqual(Object.keys(SERVED_STATE).sort());
      expect(turn.analysis_state.run_state.kind).toBe(kind);
    }
    expect(runTurn.analysis_state).toEqual((await freshRead()).analysis_state);
  });

  it('a value change on a factor WITH a unit: its card carries the factor_value field the canvas ghost reads (record.ts, the #2880 projection)', async () => {
    const hours = structuredClone(KNOWN_ANSWER);
    hours.factors[0] = { ...hours.factors[0]!, unit: 'hours' };
    persisted = postimage(hours);
    const next = structuredClone(hours);
    next.factors[0] = { ...next.factors[0]!, value: 0.6, quote: SAID };
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: { ...CHANGE, model: next } }], [{ type: 'message', text: 'Prepared.' }]];
    const j = (await typed(SAID)).json() as Json;
    expect(j.cards).toHaveLength(1);
    expect(j.cards[0].fields).toEqual([expect.objectContaining({ kind: 'factor_value', node_id: 'f', current: { value: 0.6, unit: 'hours', source: 'yours' }, filled_missing: false })]);
    // CONTRAST: the same change on KNOWN_ANSWER's unitless f is shown as a change note only (the builder projects a unit-bearing point value).
    // A new scenario: the store double holds one scenario's rows at a time.
    SCENARIO = randomUUID(); turnRows.clear(); persisted = postimage(KNOWN_ANSWER);
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'Prepared.' }]];
    const unitless = (await typed(SAID)).json() as Json;
    expect(unitless.cards).toHaveLength(1);
    expect(unitless.cards[0].fields).toEqual([]);
    expect(unitless.cards[0].adds).toEqual([expect.objectContaining({ kind: 'change_note', field_id: 'change_note:factor:f' })]);
  });

  describe('Codex r1 on #3650: a canvas edit claims its turn and takes the slot BEFORE it is forwarded', () => {
    const afterTool = (body: Json): boolean => Array.isArray(body.input) && (body.input as Json[]).some((i) => i.type === 'function_call_output');
    /** A card, then its approval held mid-turn: committed (one register), its reply not yet written. */
    const approvalHeldAfterCommit = async () => {
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'Prepared.' }]];
      const card = ((await typed(SAID)).json() as Json).cards[0];
      preparedId = String(card.proposal_id);
      let release!: () => void;
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      holdWhen = afterTool;
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
      const pressId = randomUUID();
      const approval = post({ turn_id: pressId, message: card.approve_action.message, source: 'chip_click', chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
      await vi.waitFor(() => expect(registered).toHaveLength(1));
      return { approval, pressId, release };
    };
    const canvasEdit = (turnId: string) => post({ kind: 'system_event', turn_id: turnId,
      event: { kind: 'option_intervention_edit', option_id: 'push', factor_id: 'f', value: 0.8, base_graph_hash: hashOf(persisted) } });

    it('an edit sent under the turn id an approval is answering is refused, and never forwarded: one write for that turn id', async () => {
      const { approval, pressId, release } = await approvalHeldAfterCommit();
      const pending = canvasEdit(pressId);
      const settled = await Promise.race([pending.then(() => 'answered'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 150))]);
      expect(settled, 'refused at once by the claim, never queued behind the approval').toBe('answered');
      release();
      const edit = await pending;
      expect(edit.statusCode, edit.body).toBe(409);
      expect((edit.json() as Json).error).toMatchObject({ code: 'TURN_ID_REUSED', nothing_saved: true });
      const a = await approval;
      expect(a.statusCode, a.body).toBe(200);
      expect((a.json() as Json)).toMatchObject({ durability: 'recorded', error: null });
      expect(registered).toHaveLength(1);
      expect(canvasForwards).toHaveLength(0);
    });

    it('an edit under its own turn id waits for the running turn, then runs: never interleaved with it', async () => {
      const { approval, release } = await approvalHeldAfterCommit();
      const edit = canvasEdit(randomUUID());
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(canvasForwards, 'nothing is forwarded while the approval holds the scenario').toHaveLength(0);
      release();
      const [a, e] = await Promise.all([approval, edit]);
      expect([a.statusCode, e.statusCode]).toEqual([200, 200]);
      expect(canvasForwards).toHaveLength(1);
    });

    it('the same edit resent replays it: no second change', async () => {
      const turnId = randomUUID();
      const event = { kind: 'option_intervention_edit', option_id: 'push', factor_id: 'f', value: 0.8, base_graph_hash: hashOf(persisted) };
      expect((await post({ kind: 'system_event', turn_id: turnId, event })).statusCode).toBe(200);
      const again = await post({ kind: 'system_event', turn_id: turnId, event });
      expect(again.statusCode, again.body).toBe(200);
      expect((again.json() as Json).durability).toBe('replayed');
      // CONTRAST: a different edit under that turn id is refused, and never forwarded.
      const other = await post({ kind: 'system_event', turn_id: turnId, event: { kind: 'option_intervention_edit', option_id: 'push', factor_id: 'f', value: 0.9, base_graph_hash: hashOf(persisted) } });
      expect(other.statusCode).toBe(409);
      expect(canvasForwards.map((f) => f.body.event.value)).toEqual([0.8, 0.8]);
    });
  });

  it('Codex r1 on #3650: a reply whose words equal a host failure sentence is the AI\u2019s reply, recorded and replayed byte for byte', async () => {
    const SAME = 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.';
    outputs = [[{ type: 'message', text: SAME }]];
    const turnId = randomUUID();
    const first = (await typed('What happens if the reply is lost?', turnId)).json() as Json;
    expect(first).toMatchObject({ assistant_text: SAME, error: null });
    const again = (await typed('What happens if the reply is lost?', turnId)).json() as Json;
    expect(again).toMatchObject({ durability: 'replayed', assistant_text: SAME, error: null });
  });

  it('Codex r1 on #3650: a whitespace-only reply is passed on unmodified, as the typed empty-reply outcome, and replays so', async () => {
    outputs = [[{ type: 'message', text: ' \n' }]];
    const turnId = randomUUID();
    const first = (await typed('Say nothing.', turnId)).json() as Json;
    expect(first.assistant_text).toBe(' \n');
    expect(first).toMatchObject({ durability: 'recorded', error: { code: 'REPLY_INCOMPLETE', retry_safe: false, nothing_saved: false } });
    const again = (await typed('Say nothing.', turnId)).json() as Json;
    expect(again.assistant_text).toBe(' \n');
    expect(again).toMatchObject({ durability: 'replayed', error: { code: 'REPLY_INCOMPLETE' } });
    expect(calls, 'the replay calls no model').toHaveLength(1);
  });

  it('⭐ REPLAY: a resend of the same turn id returns the recorded reply on today’s state: no model call, no write, no Run', async () => {
    const turnId = randomUUID();
    const first = (await typed('What does the model hold for f today?', turnId)).json() as Json;
    expect(calls).toHaveLength(1);
    const again = await typed('What does the model hold for f today?', turnId);
    expect(again.statusCode, again.body).toBe(200);
    const j = again.json() as Json;
    expect(j.durability).toBe('replayed');
    expect(j.assistant_text).toBe(first.assistant_text);
    expect(calls, 'no second provider call').toHaveLength(1);
    expect(registered).toHaveLength(0);
    expect(runs).toBe(0);
    // CONTRAST: the same id with different words is refused, and nothing runs.
    const reused = await typed('A different question.', turnId);
    expect(reused.statusCode).toBe(409);
    expect((reused.json() as Json).error).toMatchObject({ code: 'TURN_ID_REUSED', retry_safe: false, nothing_saved: true });
    expect(calls).toHaveLength(1);
  });

  it('a Run press resent replays its result and never runs again', async () => {
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_press', args: { reason: 'The person pressed Run.', effects_timing: 'not_stated' } }],
      [{ type: 'message', text: 'The analysis ran.' }]];
    const press = { turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } };
    await post(press);
    expect(runs).toBe(1);
    const again = (await post(press)).json() as Json;
    expect(again.durability).toBe('replayed');
    expect(runs).toBe(1);
    expect(again.analysis_result).toEqual((await freshRead()).analysis_result);
  });

  it('two turns at once: the second waits on the scenario’s slot and starts from what the first saved', async () => {
    let release!: () => void;
    holdProvider = new Promise<void>((resolve) => { release = resolve; });
    outputs = [[{ type: 'message', text: 'First answer.' }], [{ type: 'message', text: 'Second answer.' }]];
    const first = typed('First question.');
    await vi.waitFor(() => expect(calls.length).toBe(1));
    const second = typed('Second question.');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls.length, 'the second turn sends nothing while the first is running').toBe(1);
    // The first turn's model moves meanwhile: a distinctive view, held in the living model only.
    const moved = structuredClone(KNOWN_ANSWER);
    moved.views.push({ holder: 'Ana', position: 'prefers a slower push', quote: null });
    persisted = postimage(moved);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(calls).toHaveLength(2);
    const stateBlock = (b: Json): string => ((b.input ?? []) as Json[]).filter((i) => i.role === 'system').map((i) => String(i.content)).join('\n');
    expect(stateBlock(calls[0]!), 'CONTROL: the first turn read the model before the move').not.toContain('prefers a slower push');
    expect(stateBlock(calls[1]!), 'the waiting turn reads the model as it now stands').toContain('prefers a slower push');
  });

  it('a legacy scenario (a graph with no living model) is refused with a typed 409: no model call, the claim released', async () => {
    persisted = mapLivingModel(KNOWN_ANSWER).graph as Json;
    const turnId = randomUUID();
    const r = await typed('What does the model hold?', turnId);
    expect(r.statusCode).toBe(409);
    const j = r.json() as Json;
    expect(Object.keys(j)).toEqual(CONTRACT_KEYS.filter((k) => k !== '_agent'));
    expect(j.error).toMatchObject({ code: 'legacy_scenario', retry_safe: true, nothing_saved: true });
    expect(calls).toHaveLength(0);
    expect(turnRows.has(`${turnId}:claim`), 'a resend may run once the scenario is current').toBe(false);
    // CONTRAST: the same graph WITH its living model is a core scenario and runs.
    persisted = postimage(KNOWN_ANSWER);
    expect((await typed('What does the model hold?')).statusCode).toBe(200);
  });

  it('⭐ scenario_revision is the graph read’s content_hash (identity.v1) after a core turn, and a canvas edit moves both', async () => {
    const turn = (await typed('What does the model hold for f today?')).json() as Json;
    const before = await freshRead();
    expect(turn.model.scenario_revision).toBe(before.content_hash);
    expect(before.content_hash).toBe(before.graph_identity_hash.value);
    const edit = await post({ kind: 'system_event', turn_id: randomUUID(), event: { kind: 'option_intervention_edit', option_id: 'push', factor_id: 'f', value: 0.8, base_graph_hash: before.graph_hash } });
    expect(edit.statusCode, edit.body).toBe(200);
    const e = edit.json() as Json;
    expect(canvasForwards).toHaveLength(1);
    expect(canvasForwards[0]!.headers['x-olumi-ai-mode'], 'the existing core canvas-edit path').toBe('core');
    const after = await freshRead();
    expect(e.model.scenario_revision).toBe(after.content_hash);
    expect(e.model.scenario_revision).not.toBe(turn.model.scenario_revision);
    expect(e).toMatchObject({ assistant_text: '', error: null });
    expect(calls, 'a canvas edit calls no model').toHaveLength(1);
  });

  it('⭐ the first draft (the canonical drafter): the streamed GRAPH_READY frame and the COMPLETE contract carry the same ids', async () => {
    persisted = null;
    canonicalDraft = JSON.stringify(bakery());
    const frames: Json[] = [];
    const r = await runWithStageStream((event) => { frames.push(event as Json); },
      // Awaited INSIDE the stage context, as the SSE wrapper does (`streamed-turn-sse.ts`): light-my-request dispatches on await.
      async () => await app.inject({ method: 'POST', url: '/agent/v1/core-turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message: BAKERY_BRIEF, source: 'composer' } }));
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(registered).toHaveLength(1);
    expect(calls.map((c) => c.text?.format?.name ?? null), 'one canonical drafting call, and no agent call').toEqual(['canonical_model']);
    const ready = frames.filter((f) => f.kind === 'GRAPH_READY');
    expect(ready, JSON.stringify(frames.map((f) => f.kind))).toHaveLength(1);
    expect(ids(ready[0]!.graph)).toEqual(ids(j.model.graph));
    expect(ids(j.model.graph).length).toBeGreaterThan(0);
    expect(j.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'olumi' })]);
    expect(j.model.scenario_revision).toBe((await freshRead()).content_hash);
    expect((registered[0]!.graph as Json).living_model.model_program).toBe('v1');
  });
  it('DL 22 Oct (marketing on 7ee0d90f): a change that would cut the goal\u2019s path is said back; the AI\u2019s re-linked retry is the card', async () => {
    // f's unit stated, as every factor has one: Olumi's re-link from it can be sized per unit (the Run's own target verdict, C1).
    const united: LivingModelT = { ...structuredClone(KNOWN_ANSWER), factors: KNOWN_ANSWER.factors.map((f) => ({ ...f, unit: 'level' })) };
    persisted = postimage(united);
    const remeasured = structuredClone(united);
    remeasured.aims[0]!.target = { ...remeasured.aims[0]!.target!, quantity: 'new customers', unit: 'customers', value: 20, current: null };
    remeasured.links = [];
    const relinked = { ...structuredClone(remeasured), links: [{ id: 'f_customers', from: 'f', to: 'g', source: 'olumi' as const, party: null, quote: null,
      effect: { estimate_by: null, form: 'range' as const, value: null, low: 2, high: 8, sd: null, unit: 'customers', sign: '+' as const } }] };
    const change = (model: LivingModelT) => ({ public_label: 'Measure the goal in customers', basis: 'The person restated the goal.', model, remove: ['f_g'] });
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'cut', args: change(remeasured) }],
      [{ type: 'function_call', name: 'propose_change', call_id: 'relink', args: change(relinked) }],
      [{ type: 'message', text: 'I prepared the change, with what drives the goal linked to its new measure.' }]];
    const r = await typed('Measure the goal in new customers: we need 20.');
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j._agent.tool_calls.map((c: Json) => [c.name, c.outcome])).toEqual([['propose_change', 'refused'], ['propose_change', 'ok']]);
    // DL 22 Oct: the self-check's refusal is on the wire, as the refused call's typed reason; an ok call names none.
    expect(j._agent.tool_calls.map((c: Json) => c.refusal ?? null)).toEqual(['not_run_ready', null]);
    expect(j.cards).toHaveLength(1);
    expect(JSON.stringify(j.cards[0].adds)).toContain('f_customers');
    expect(registered, 'a card writes nothing').toHaveLength(0);
  });

  it('⭐ STEP 0 (arch plan, DL 23 Oct): ONE summary log line per turn, keyed by scenario and turn, by id and code only', async () => {
    const info = vi.spyOn((await import('../../utils/telemetry.js')).log, 'info');
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'Press its card to look at that condition again.' }]];
    const turnId = randomUUID();
    const r = await typed(SAID, turnId);
    expect(r.statusCode, r.body).toBe(200);
    const summaries = () => info.mock.calls.flatMap(([o]) => ((o as Json)?.event === 'core_turn.summary' ? [o as Json] : []));
    const lines = summaries();
    expect(lines).toHaveLength(1);
    // A resend of the same turn replays it: no AI call, so no second line (Codex r1 on #3691: one per turn that reached the AI).
    expect((await typed(SAID, turnId)).statusCode).toBe(200);
    expect(summaries()).toHaveLength(1);
    info.mockRestore();
    const line = lines[0]!;
    expect(line).toMatchObject({ scenario_id: SCENARIO, turn_id: turnId, stopped_reason: 'answered' });
    expect(line.provider_calls.length).toBeGreaterThan(0);
    for (const c of line.provider_calls) expect(c).toMatchObject({ model: 'gpt-scripted', input_tokens: 10, output_tokens: 5, ms: expect.any(Number) });
    expect(line.tool_calls.map((c: Json) => [c.name, c.outcome])).toEqual([['propose_change', 'ok']]);
    // Ids and codes only: no said words or reply words.
    const text = JSON.stringify(line);
    for (const words of [SAID, 'look at that condition']) expect(text).not.toContain(words);
  });
  it('Codex r1 on #3691: a failed turn writes its ONE summary line, with the calls made before it failed and no error words', async () => {
    const info = vi.spyOn((await import('../../utils/telemetry.js')).log, 'info');
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'refuse' }]];
    const turnId = randomUUID();
    const r = await typed(SAID, turnId);
    const lines = info.mock.calls.flatMap(([o]) => ((o as Json)?.event === 'core_turn.summary' ? [o as Json] : []));
    info.mockRestore();
    expect(r.statusCode).not.toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ scenario_id: SCENARIO, turn_id: turnId, failed: 'turn_failed' });
    expect(lines[0]!.provider_calls.length).toBeGreaterThan(0);
    expect(lines[0]!.tool_calls.map((c: Json) => [c.name, c.outcome])).toEqual([['propose_change', 'ok']]);
    expect(lines[0]).not.toHaveProperty('err');
  });
  it('Codex r2 on #3691: a withheld tool\'s refusal the SDK records itself is in a failed turn\'s line; a turn that reached no AI writes none', async () => {
    const telemetry = (await import('../../utils/telemetry.js')).log;
    const info = vi.spyOn(telemetry, 'info');
    const summaries = () => info.mock.calls.flatMap(([o]) => ((o as Json)?.event === 'core_turn.summary' ? [o as Json] : []));
    outputs = [[{ type: 'function_call', name: 'offer_public_research', call_id: 'withheld', args: { query: 'synthetic query' } }], [{ type: 'refuse' }]];
    const failed = await typed('Look this up for me.');
    expect(failed.statusCode).not.toBe(200);
    expect(summaries().map((l) => [l.failed, l.tool_calls.map((c: Json) => [c.name, c.outcome])]))
      .toEqual([['turn_failed', [['offer_public_research', 'refused']]]]);
    // The conversation cannot be read: refused before any AI call, so no line.
    store.readOpenAiConversationId.mockRejectedValueOnce(new Error('store down'));
    const unread = await typed('Anything new?');
    expect(unread.statusCode).toBe(503);
    expect(summaries()).toHaveLength(1);
    info.mockRestore();
  });

  describe('⭐ CACHING (DL 22 Oct): the provider\'s cached prefix is the same bytes on every call', () => {
    /** The standing instructions: the same on every turn of every scenario; this turn's facts and guidance follow them. */
    // These rows run on a saved Living Model (not a program): it keeps the Living Model text, byte for byte (Codex r1 BLOCK 4 on #3709).
    const STANDING = instructionsForMode('core', CORE_INSTRUCTIONS_LIVING_MODEL, CORE_REPLY_RULES_LIVING_MODEL);
    const challengeOn = (id: string) => post({ turn_id: randomUUID(), message: 'Challenge this', source: 'chip_click', chip: { id: ASK_CHALLENGE_CHIP_ID },
      selected_elements: { node_ids: [id] } });

    it('(1) ONE tool list, byte for byte, on typed, approval, Run-press and Challenge calls; what a turn may call rides tool_choice', async () => {
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'Press its card to save it.' }]];
      const card = ((await typed(SAID)).json() as Json).cards[0];
      preparedId = String(card.proposal_id);
      const typedCalls = calls.length;
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
      expect((await post({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click',
        chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } })).statusCode).toBe(200);
      const pressCalls = calls.length;
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run', args: { reason: 'The person pressed Run.', effects_timing: 'not_stated' } }],
        [{ type: 'message', text: 'The analysis ran.' }]];
      expect((await post({ turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } })).statusCode).toBe(200);
      const runCalls = calls.length;
      const factor = (((persisted as Json).nodes ?? []) as Json[]).find((n) => n.kind === 'factor')!;
      outputs = [[{ type: 'message', text: 'Here is the strongest case against that figure.' }]];
      expect((await challengeOn(String(factor.id))).statusCode).toBe(200);
      expect([typedCalls, pressCalls - typedCalls, runCalls - pressCalls, calls.length - runCalls], 'two calls each, then one').toEqual([2, 2, 2, 1]);

      const lists = calls.map((b) => JSON.stringify(b.tools));
      expect(lists[0]!.length).toBeGreaterThan(2);
      expect(new Set(lists).size, 'every call sends the same tools array').toBe(1);
      // The restriction lives in tool_choice: a withheld tool stays in the list; a press opens on its own tool; a Run press's later calls are restricted.
      const names = (calls[0]!.tools as Json[]).map((t) => String(t.name));
      const typedChoice = calls[0]!.tool_choice as Json;
      expect(typedChoice.type).toBe('allowed_tools');
      expect(names.filter((n) => !(typedChoice.tools as Json[]).some((t) => t.name === n)), 'research is withheld on this route, and still listed')
        .toEqual(['offer_public_research']);
      expect(calls[typedCalls]!.tool_choice).toMatchObject({ type: 'function', name: 'apply_change' });
      expect(calls[pressCalls]!.tool_choice).toMatchObject({ type: 'function', name: 'run_analysis' });
      const after = calls[pressCalls + 1]!.tool_choice as Json;
      expect(after.type).toBe('allowed_tools');
      expect((after.tools as Json[]).map((t) => t.name), 'a Run press withholds the writers').not.toContain('propose_change');
      expect(((calls[calls.length - 1]!.input ?? []) as Json[]).filter((i) => i.role === 'system').map((i) => String(i.content).slice(0, SELECTION_NOTE_PREFIX.length)),
        'the Challenge call carried its note, after its state block').toEqual([expect.stringContaining(STATE_BLOCK_PREFIX), SELECTION_NOTE_PREFIX]);
      expect(new Set(calls.map((b) => b.instructions)), 'the standing instructions, the same bytes on every call of every turn kind')
        .toEqual(new Set([STANDING]));
    });

    it('(5) the standing instructions open every call of two different scenarios; the Challenge note follows the state block in the turn\'s input', async () => {
      /** The turn's system items, in order: its state block, then its guidance. */
      const systemItems = (b: Json): string[] => ((b.input ?? []) as Json[]).filter((i) => i.role === 'system').map((i) => String(i.content));
      const factor = (((persisted as Json).nodes ?? []) as Json[]).find((n) => n.kind === 'factor')!;
      outputs = [[{ type: 'message', text: 'Here is the strongest case against that figure.' }]];
      expect((await challengeOn(String(factor.id))).statusCode).toBe(200);
      const challenged = calls[0]!;
      expect(challenged.instructions).toBe(STANDING);
      const one = systemItems(challenged);
      expect(one).toHaveLength(2);
      expect(one[0]).toContain(STATE_BLOCK_PREFIX);
      expect(one[0]).toContain(TODAY_PREFIX);
      expect(one[1]!.startsWith(SELECTION_NOTE_PREFIX), 'the note follows the state block').toBe(true);

      // A second scenario, another saved model: a typed turn, with no guidance of its own.
      const first = { scenario: SCENARIO, body: challenged };
      SCENARIO = randomUUID(); persisted = postimage(KNOWN_ANSWER); calls = [];
      outputs = [[{ type: 'message', text: 'Tell me more about the situation first.' }]];
      expect((await typed('We are weighing two staffing options.')).statusCode).toBe(200);
      const drafting = calls[0]!;
      expect(SCENARIO).not.toBe(first.scenario);
      expect(drafting.instructions, 'byte-equal across the two scenarios').toBe(first.body.instructions);
      expect(systemItems(drafting)).toEqual([expect.stringContaining(STATE_BLOCK_PREFIX)]);
      expect(String(challenged.instructions), 'no Challenge note in the instructions').not.toContain(SELECTION_NOTE_PREFIX);

      // The prefix the provider caches (the tools, then the standing instructions) is byte-equal across the two scenarios.
      expect(JSON.stringify(drafting.tools)).toBe(JSON.stringify(first.body.tools));
      expect(drafting.prompt_cache_key).toBe(first.body.prompt_cache_key);
      expect(drafting.prompt_cache_key).toBe(corePromptCacheKey(String(drafting.model), STANDING));
      expect([drafting.prompt_cache_retention, first.body.prompt_cache_retention]).toEqual(['24h', '24h']);
    });

    /** Draft a saved PROGRAM scenario (the canonical drafter's first turn), then clear the calls. */
    const savedProgram = async (): Promise<void> => {
      SCENARIO = randomUUID(); persisted = null; canonicalDraft = JSON.stringify(bakery()); calls.length = 0;
      expect((await typed(BAKERY_BRIEF)).statusCode).toBe(200);
      expect(calls[0]!.text?.format?.name).toBe('canonical_model');
      expect(calls[0]!.instructions).toBe(DRAFTING_INSTRUCTIONS);
      calls.length = 0;
    };

    it('(6) ALPHA (23 Oct) + Codex r1 BLOCK 4 on #3709: a saved PROGRAM\'s turn gets the model-program instructions; a saved Living Model keeps the old text, byte for byte', async () => {
      // Pinned from the request bodies the provider received on this route, not from the module that builds them.
      const PROGRAM_SHA = '08747cdea15ebf05c863822fb8776ef4a4b34f7ac001270018a1d90b529fd6a9';
      const LIVING_MODEL_SHA = '7a1bced23a44dccc478a00d075b28bbe2dda487a4b6da868ae3a477698097e44'; // staging 646d374e's
      const sha = (c: Json) => createHash('sha256').update(String(c.instructions), 'utf8').digest('hex');
      outputs = [[{ type: 'message', text: 'Here is what the model holds.' }]];
      expect((await typed('What does the model hold now?')).statusCode).toBe(200);
      expect(calls).toHaveLength(1);
      expect(sha(calls[0]!)).toBe(LIVING_MODEL_SHA);
      expect(String(calls[0]!.instructions)).not.toContain('HOW THE MODEL WORKS');
      await savedProgram();
      outputs = [[{ type: 'message', text: 'Tell me more about the situation first.' }]];
      expect((await typed('What does the model hold now?')).statusCode).toBe(200);
      expect(calls).toHaveLength(1);
      expect(sha(calls[0]!)).toBe(PROGRAM_SHA);
      expect(String(calls[0]!.instructions)).toContain('draft the first model from their brief in that same turn, even when figures are missing');
      expect(String(calls[0]!.instructions)).not.toContain('POLYMATH COACHING');
    });

    it('S3 (DL 23 Oct): on a program turn the provider receives the PROGRAM tool descriptions, read included, and the read it gets back carries the Run\'s goal_chance block unchanged', async () => {
      // Two goals, so the block has each goal's own line and the joint.
      const m = club();
      m.quantities.push(q('floor', 'member', { value: 320, quote: 'at least 320 members' }));
      m.goals.push({ ...m.goals[0]!, id: 'keep_320', label: 'Keep at least 320 members', measure: { ...m.goals[0]!.measure!, target: 'floor' }, quote: 'keep at least 320 members' });
      SCENARIO = randomUUID(); persisted = null; canonicalDraft = JSON.stringify(m);
      expect((await typed(`${CLUB_BRIEF} And keep at least 320 members.`)).statusCode).toBe(200);
      const stored = (persisted!.living_model.runs.at(-1).result.canonical_analysis_view as Json).goal_chance;
      expect(stored.targets.per_target).toHaveLength(2);
      calls.length = 0;
      outputs = [[{ type: 'function_call', name: 'read_canonical_context', call_id: 'read', args: {} }], [{ type: 'message', text: 'The model has two goals.' }]];
      expect((await typed('What does the model hold now?')).statusCode).toBe(200);
      expect(calls).toHaveLength(2);
      // The tools as the provider received them: the four program tools, each with #3707's description, none with core's.
      const sentTools = Object.fromEntries((calls[0]!.tools as Json[]).filter((t) => t.type === 'function').map((t) => [t.name, t.description]));
      expect(sentTools).toEqual(PROGRAM_TOOL_DESCRIPTIONS);
      for (const [name, description] of Object.entries(sentTools)) expect(description).not.toBe((TOOL_DESCRIPTIONS as Record<string, string>)[name]);
      // The read the agent got back: the Run's goal_chance exactly as stored (each goal's own line, the joint, the notes).
      const output = (calls[1]!.input as Json[]).find((i) => i.type === 'function_call_output' && i.call_id === 'read')!.output;
      const read = JSON.parse(typeof output === 'string' ? output : JSON.stringify(output)) as Json;
      const run = (read.data ?? read).run as Json;
      expect(stableStringify(run.goal_chance)).toBe(stableStringify(stored));
      expect(Object.keys(run).sort()).toEqual(['current', 'engine_current', 'goal_chance', 'options', 'run_id']);
    });

    it('S3 (batch 2 mrr-r3): two program proposals in one turn still leave the person ONE card to approve; the second is refused with its way on', async () => {
      await savedProgram();
      const set = (quantity_id: string, value: number, quote: string, public_label: string) => ({ public_label, basis: 'their answer',
        ops: [{ op: 'set_quantity', quantity_id, value, low: null, high: null, range_kind: null, quote }] });
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'p1', args: set('oven_price', 2500, 'The oven would cost £2,500', 'Oven price £2,500') },
        { type: 'function_call', name: 'propose_change', call_id: 'p2', args: set('base_sales', 320, 'we bake 320 loaves a week now', 'Base sales 320') }],
      [{ type: 'message', text: 'I prepared the oven price; approve its card and I will do the rest next.' }]];
      const r = await typed('The oven would cost £2,500 and we bake 320 loaves a week now.');
      expect(r.statusCode, r.body).toBe(200);
      const j = r.json() as Json;
      const tools = (j._agent.tool_calls as Json[]).filter((c) => c.name === 'propose_change');
      // The SDK runs the two calls together: one prepares the card, the other is refused (in either order).
      expect(tools.map((c) => c.outcome).sort()).toEqual(['ok', 'refused']);
      expect(JSON.stringify(tools.find((c) => c.outcome === 'refused'))).toContain('one_card_per_turn');
      expect(j.cards as Json[]).toHaveLength(1);
      expect(registered.length, 'proposing saves nothing').toBe(1);
    });

    /** The instructions the provider received on one typed turn of a saved program (the model-program instructions). */
    const sentOnce = async (): Promise<string> => {
      await savedProgram();
      outputs = [[{ type: 'message', text: 'Noted.' }]];
      expect((await typed('The lane hire is about 20 pounds an hour.')).statusCode).toBe(200);
      expect(calls).toHaveLength(1);
      return String(calls[0]!.instructions);
    };

    it('(7) Codex r1 BLOCK 1 on #3707: a loose figure goes in exactly as said, with no bounds Olumi adds; Olumi asks for their range', async () => {
      const sent = await sentOnce();
      expect(sent.split('A loose figure ("about 20") goes in exactly as they said it: their figure, 20, with their words quoted so the "about" stays visible. '
        + 'Never add a range or bounds they did not give. If that figure feeds a goal or a limit, ask what range they would put on it.')).toHaveLength(2);
      for (const gone of ['18 to 22', 'a range that reads their word', 'the range is Olumi\'s reading']) expect(sent, gone).not.toContain(gone);
    });

    it('(8) Codex r1 BLOCK 2 on #3707: the whole CALCULATION BOUNDARY rides the core instructions once, with its labelled-arithmetic permission', async () => {
      const sent = await sentOnce();
      expect(sent.split('\n\nCALCULATION BOUNDARY\n'
        + "Do not calculate or forecast an option's goal outcome, probability of success, break-even, expected value, sensitivity, robustness, or other engine-owned analytical result yourself.\n"
        + 'You may perform transparent one-step arithmetic on figures the user supplied, or evaluate a total or difference they explicitly defined, including at the end points of a range they stated, only when it is NOT presented as a model result. '
        + 'Show the operands and units, label it as simple arithmetic, and identify the saved setting or clearly labelled what-if used. This permission excludes every engine-owned result named above and never permits inventing a response law between quantities.\n'
        + 'If the requested implication requires modelled relationships, use only supplied current engine output. If that output is unavailable, stale or blocked, identify the missing input or offer the appropriate model/run action instead of estimating the result.\n\n'
      )).toHaveLength(2);
    });
  });
});
