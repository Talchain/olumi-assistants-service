/**
 * Model-program rows (alpha): the model-program turn on the REAL core route (`POST /agent/v1/core-turn`), in process, with in-memory
 * stores in the core-turn route's served shapes (the C2″ harness's), so nothing reaches a database. The provider is stubbed
 * at fetch: the drafting call's answers are canned canonical models of a SYNTHETIC bakery (never a test brief's words), so
 * every row binds the real request the route sends and the real postimage it saves. One row per step, plus the
 * save → readback → cold reopen identity row with its contrast control.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod-v4';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';
import { APPROXIMATE_FIGURE, CanonicalModel, withDeclaredTiming, type CanonicalModelT, type CanonicalQuantityT } from '../../model-program/canonical.js';
import { compile, isApproximate, normalise } from '../../model-program/compile.js';
import { PROGRAM_TOOL_DESCRIPTIONS, programInstructions } from '../../core-route/instructions.js';
import { project } from '../../model-program/project.js';
import { simulate } from '../../model-program/simulate/simulate.js';
import { CANONICAL_JSON_SCHEMA, DRAFTING_INSTRUCTIONS, REPAIR_PREFIX, UPDATE_CHANGE_LABEL, UPDATE_JSON_SCHEMA, UPDATE_PREFIX, UPDATE_REPAIR_PREFIX } from '../prompt.js';
import { runModelProgramTurn } from '../turn.js';
import { evaluateCanonical, seedOf, RUN_DRAWS } from '../evaluate.js';
import { livingModelOf, MODEL_PROGRAM, programReadOf, reopenProgram, savedProgramOf, sourceTextOf } from '../program-store.js';
import { draftCanonicalModel, proposePostimage, withHostFields } from '../draft.js';
import { applyCanvasFigure, applyProgramChange, holdProgramCard, ProgramChangeParams, proposeProgramChange, readProgramContext, runProgram } from '../program-tools.js';
import { log as staticLog } from '../../../utils/telemetry.js';
import { asDrafted, GROUPS, readingOf, validatePostimage, withoutHost } from '../postimage.js';
import { approveReadingRows } from '../approve-rows.js';
import { foldedInto } from '../reading-groups.js';
import { proposalPendingAction } from '../../agent-lane/durable-proposal.js';
import { agentProposalOf, proposalFieldsWire, proposalRecord } from '../../agent-lane/proposal-object/record.js';
import { ProposalChangeSchema, ProposalStore, type ProposalChange } from '../../agent-lane/proposal.js';
import { postimageOf, savePostimage, withNewRun } from '../program-save.js';
import { programRevisionOf } from '../program-card.js';
import { projectCorePostimageForPersistence } from '../../persisted-graph-projection.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { ENGINE_VERSIONS, revisionDigest, RUN_AGAIN_AFTER_UPDATE, RUN_AGAIN_FOR_CHANCE } from '../run-receipt.js';
import { registrationRequestHash, registrationTurnId } from '../../graph-registration/registration-identity.js';
import { PROGRAM_MODEL_STATE_PREFIX } from '../../agent-lane/turn-context.js';
import { responsesSse } from '../../agent-lane/__tests__/stream-when-asked.js';
import { AGENTS_CLIENT_MAX_RETRIES } from '../../../adapters/llm/openai-agents-client.js';
import { at, bakery, bakeryWithDefect, BRIEF, club, CLUB_BRIEF, q, updateOf } from './bakery.fixture.js';

/** A draft captured before a field existed, read in today's format (the saved-model reader's own mapping). */
const savedDraft = (file: string) => { const s = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as { brief: string; canonical: unknown }; return { brief: s.brief, canonical: withDeclaredTiming(s.canonical) as CanonicalModelT }; };

type Json = Record<string, any>;

// ── in-memory stores (the C2″ harness's served shapes) ────────────────────────────────────────────────────────────────
let SCENARIO = '';
let persisted: Json | null = null;
const registered: Json[] = [];
const turnRows = new Map<string, any>();
let pausedRun: any = null;
const conversationIds = new Map<string, string>();
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
const store = {
  readOpenAiPausedRun: vi.fn(async () => pausedRun),
  saveOpenAiPausedRun: vi.fn(async (_s: string, r: any) => { if (pausedRun !== null) return false; pausedRun = r; return true; }),
  takeOpenAiPausedRun: vi.fn(async (_s: string, id: string) => { if (pausedRun?.pause_id !== id) return false; pausedRun = null; return true; }),
  readOpenAiConversationId: vi.fn(async (sid: string) => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string) => { if (!conversationIds.has(sid)) conversationIds.set(sid, id); return conversationIds.get(sid); }),
  loadGraph: async () => persisted,
  loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
  readFactsFor: vi.fn(async () => []),
  readRecent: vi.fn(async () => [...turnRows.values()].reverse()),
  readFactsWithTurnFor: async () => [],
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async () => [...turnRows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  releaseTurnClaim: vi.fn(async (_sid: string, id: string, hash: string) => { if (turnRows.get(id)?.request_hash === hash) turnRows.delete(id); }),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  append: vi.fn(async (write: Json) => {
    const key = String(write.turn_id); const prior = turnRows.get(key);
    if (prior !== undefined) return prior.request_hash === write.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...write, id: `row-${turnRows.size + 1}`, created_at: new Date(Date.now() + turnRows.size).toISOString(), assistant_message: write.assistantMessage, user_message: write.userMessage };
    turnRows.set(key, row); return { id: row.id };
  }),
  getScenarioOwner: async () => null,
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));

function graphRead(): Json {
  if (persisted === null) return { scenario_id: SCENARIO, graph: null, graph_present: false, brief_text: null, graph_identity_hash: null, graph_hash: null, content_hash: null };
  return { scenario_id: SCENARIO, graph: persisted, graph_present: true, brief_text: null, graph_hash: hashOf(persisted),
    graph_identity_hash: computeGraphIdentityHash(persisted as never), content_hash: computeGraphIdentityHash(persisted as never)!.value,
    analysis_ready: { status: 'blocked', may_run: false, options: [], blockers: [] },
    analysis_state: { run_state: { kind: 'never_run' }, usable_for_prose: false, usable_for_chips: false, usable_for_followup: false },
    current_read: { run_state: { kind: 'never_run' }, computed_against_hash: null, run_id: null } };
}

// ── the provider, stubbed at fetch: canned Responses streams, every request body kept ────────────────────────────────
const sent: Json[] = [];
/** Each call's answer: a model's JSON text (a completed stream), or the provider's own Response (a failure). */
let replies: (string | (() => Response | Promise<Response>))[] = [];
/** The header a row names its caller in (the harness's stand-in for the verified identity the ownership hook reads). */
const CALLER_HEADER = 'x-test-caller';
/** Every request forwarded to the existing core canvas-edit path (`/orchestrate/v2/turn`), headers and body. */
const legacyForwards: { readonly headers: Json; readonly body: Json }[] = [];
/** Pause either side of the fake store's atomic commit, without changing the production writer. */
let registerPause: ((stage: 'before' | 'after') => Promise<void>) | undefined;
/** Every POST /v1/conversations (a scenario's empty Conversation create), by its body. */
const creates: { readonly body: Json }[] = [];
/**
 * Each create's answer, in order: a status (2xx = the new Conversation, else the provider's error), what fetch throws, or
 * the answer itself. None left: the harness's own 599, as before this queue existed.
 */
let createAnswers: (number | Error | ((init: any) => Response | Promise<Response>))[] = [];
/** The served 503 of 26 Oct (04:57:12Z ×2, 07:44:06Z), as its proxy sent it: plain text, no JSON. */
const ENVOY_503 = 'upstream connect error or disconnect/reset before headers. retried and the latest reset reason: remote connection failure, transport failure reason: delayed connect error: Connection refused';
/** What the agent says on a host turn's reply (T1) when a row queues no reply of its own. */
const DEFAULT_AGENT_REPLY = 'Here is what the model shows, in a few points.';
const createAnswer = (status: number): Response => (status < 300
  ? new Response(JSON.stringify({ id: `conv_created_${creates.length}`, object: 'conversation', created_at: 0, metadata: null }), { status, headers: { 'content-type': 'application/json' } })
  : status === 503 ? new Response(ENVOY_503, { status, headers: { 'content-type': 'text/plain' } })
    : new Response(JSON.stringify({ error: status === 429 ? { message: 'Rate limit reached for requests', type: 'requests', param: null, code: 'rate_limit_exceeded' }
      : { message: 'Invalid request', type: 'invalid_request_error', param: null, code: null } }), { status, headers: { 'content-type': 'application/json' } }));
const sse = (text: string, output?: Json[]): Response => {
  const response = { id: `resp_${sent.length}`, object: 'response', status: 'completed', model: 'gpt-6.1-sol',
    output: output ?? [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 500, output_tokens_details: { reasoning_tokens: 100 }, total_tokens: 1500 } };
  const body = responsesSse(response);
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

let app: FastifyInstance;
/** The route's internal dispatch, into this harness's stores (for the agent's tools, called as the SDK turn calls them). */
const dispatch = async (path: string, body: unknown) => { const r = await app.inject({ method: 'POST', url: path, payload: body as never }); return { status: r.statusCode, json: r.json() as Record<string, unknown> }; };
const turn = (payload: Json, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/agent/v1/core-turn', headers, payload: { kind: 'message', scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', turn_id: randomUUID(), source: 'composer', ...payload } });

const latch = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};
/** The real transport's raw-reply boundary (as in sse-terminal-delivery-truth.test.ts), with the REAL core route behind it. */
const streamedTurn = async (payload: Json) => {
  const { streamTurnAsStagedSse } = await import('../../../routes/streamed-turn-sse.js');
  const delivered: string[] = [];
  const raw = { destroyed: false, writableEnded: false, setHeader: () => {}, writeHead: () => {},
    write(chunk: string) { if (this.destroyed) return false; delivered.push(chunk); return true; },
    end() { this.writableEnded = true; } };
  const done = streamTurnAsStagedSse({ app, reply: { raw, getHeaders: () => ({}) } as unknown as FastifyReply,
    requestId: randomUUID(), internalHeaders: { 'content-type': 'application/json', accept: 'application/json' }, internalTarget: '/agent/v1/core-turn',
    payload: JSON.stringify({ kind: 'message', scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', source: 'composer', ...payload }),
    featureVersion: 'v5', endpoint: '/proxy/v5/turn/stream' });
  return { done, delivered, disconnect: () => { raw.destroyed = true; } };
};

/** The saved model with `edit` applied, whole. */
const wholeWith = (edit: (m: CanonicalModelT) => void): string => { const m = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT; edit(m); return JSON.stringify(m); };
/** The drafter's update for a model written whole: only what it changes or adds, by id, and what it removes (DL 24 Oct). */
const asUpdate = (whole: string): string => JSON.stringify(updateOf(persisted!.living_model.canonical as CanonicalModelT, JSON.parse(whole) as CanonicalModelT));
/** The drafter's update for a change: the saved model with `edit` applied, as an update returns it. */
const savedWith = (edit: (m: CanonicalModelT) => void): string => asUpdate(wholeWith(edit));
const setQ = (m: CanonicalModelT, id: string, f: Partial<CanonicalQuantityT>) => { m.quantities = m.quantities.map((x) => (x.id === id ? { ...x, ...f } : x)); };
/** The drafter's own calls (no Conversation); T1's reply to a draft or a Run press is the agent's, in the Conversation. */
const drafterCalls = (): Json[] => sent.filter((b) => b.conversation === undefined);
/** Each call in order: the drafter's (false) or the agent's, in the Conversation (true). */
const callKinds = (): boolean[] => sent.map((b) => b.conversation !== undefined);
/** The saved scenario as the route reads it for a turn. */
const savedNow = () => ({ graph: persisted, identity: computeGraphIdentityHash(persisted as never)!.value });
/**
 * T1 (Paul 26 Oct): the route's reply to a first draft or a Run press is the AI's, from the Run's own facts. The host's own
 * words are kept in turn.ts, unwired ("don't delete it in case we need to implement it later"); these rows read them from the
 * turn itself, called as the route calls it, with a card store.
 */
const hostTurn = async (message: string, saved: { graph: Json | null; identity: string | null } = { graph: null, identity: null }): Promise<Json> => {
  const out = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message, saved, dispatch, proposals: new ProposalStore() });
  return { ...out.payload, assistant_text: out.assistantText };
};
const LOST_BASIS = 'Nobody has said how much baking time a new oven loses while the staff learn it.';
/** Issue 40: the bakery with Olumi's link of unknown size, stated to lower sales, and any more of Olumi's links on the oven. */
const withOlumiLinks = (m: CanonicalModelT, ...more: CanonicalQuantityT[]): CanonicalModelT => {
  const sizes = [q('lost_bake_time', 'loaf/week/oven', { kind: 'coefficient', status: 'unknown', author: 'olumi', direction: 'lowers', basis: LOST_BASIS }), ...more];
  m.quantities.push(...sizes);
  m.relations = m.relations.map((r) => (r.form === 'effect' ? { ...r, terms: [...r.terms, ...sizes.map((x) => ({ driver: 'ovens_added', coefficient: x.id, author: 'olumi' as const, quote: null, ...at }))] } : r));
  return m;
};

describe('the model-program turn on the real core route', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: any) => {
      const u = String((url as any)?.href ?? (url as any)?.url ?? url);
      if (u === 'https://api.openai.com/v1/conversations' && init?.method === 'POST') {
        creates.push({ body: JSON.parse(String(init?.body ?? '{}')) });
        const next = createAnswers.shift();
        if (next instanceof Error) throw next;
        if (next !== undefined) return typeof next === 'function' ? next(init) : createAnswer(next);
        // T1 (Paul 26 Oct): a first draft's reply is the AI's own, so a draft opens the Conversation; with no answer given,
        // the create succeeds.
        return createAnswer(201);
      }
      if (!u.startsWith('https://api.openai.com/') || !u.endsWith('/responses')) return new Response(JSON.stringify({ error: 'blocked by the spike test' }), { status: 599 });
      const body = JSON.parse(String(init?.body ?? '{}'));
      sent.push(body);
      const next = replies.shift();
      // A host turn's reply (T1: a first draft, a Run press) is the agent's, in the scenario's Conversation: with no reply
      // queued for it, it says a line of its own. A drafter call (no Conversation) still needs the test's reply.
      if (next === undefined && body.conversation !== undefined) return sse(DEFAULT_AGENT_REPLY);
      if (next === undefined) throw new Error('the test gave no reply for this call');
      return typeof next === 'function' ? next() : sse(next);
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    process.env.OPENAI_API_KEY ||= 'sk-test-not-sent';
    const route = await import('../../../routes/core-turn.js');
    app = Fastify({ logger: false });
    // Who is calling, as the scenario-ownership hook sets it from the verified identity (`scenario-ownership.ts`): only on a
    // request that names a caller; every other request is a guest's, as before.
    app.addHook('preHandler', async (req) => {
      const caller = req.headers[CALLER_HEADER];
      if (typeof caller === 'string') req.scenarioAccess = { scenarioId: SCENARIO, ownerUserId: null, callerUserId: caller, caller: { userId: caller, verified: true }, memberRead: false };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => graphRead());
    app.post('/assist/v1/scenarios/:id/graph/register', async (req, reply) => {
      const b = req.body as Json;
      await registerPause?.('before');
      const current = persisted === null ? null : computeGraphIdentityHash(persisted as never)!.value;
      if ((b.expected_graph_identity_hash ?? null) !== current) return reply.code(409).send({ details: { code: 'GRAPH_STALE' } });
      // Stored as JSON, as a database column gives it back: never the caller's object.
      persisted = JSON.parse(JSON.stringify(b.graph)) as Json; registered.push(b);
      const identity = computeGraphIdentityHash(persisted as never)!;
      await registerPause?.('after');
      return { registered: true, graph_identity_hash: identity, graph_hash: hashOf(persisted),
        model_version: { version_id: `v_${registered.length}`, version_number: registered.length, mutation_id: `m_${registered.length}`,
          creation_kind: registered.length === 1 ? 'initial' : 'committed_mutation', graph_identity_hash: identity.value,
          analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(persisted as never) } };
    });
    // The store's history in its served shape: each registered write under its own operation's registration id (as
    // `core-turn.route.test.ts` serves it), so a resend can find its own save.
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: registered.map((b, i) => ({ version_id: `v_${i + 1}`, sequence: i + 1,
      creation: { kind: i === 0 ? 'initial' : 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId(SCENARIO, String(b.operation_id)) } })) }));
    app.post('/orchestrate/v2/turn', async (req, reply) => { legacyForwards.push({ headers: req.headers as Json, body: req.body as Json }); return reply.code(500).send({ error: 'no Run in this harness' }); });
    await app.register(route.coreTurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); });
  beforeEach(() => { SCENARIO = randomUUID(); persisted = null; registered.length = 0; turnRows.clear(); conversationIds.clear(); pausedRun = null; sent.length = 0; replies = []; registerPause = undefined; creates.length = 0; createAnswers = []; legacyForwards.length = 0; });

  it('T gap3: disconnect while drafting stops delivery, not the provider or the complete save; the same turn replays without another call or Run', async () => {
    const started = latch(); const finish = latch();
    replies = [async () => { started.release(); await finish.promise; return sse(JSON.stringify(bakery())); }];
    const payload = { turn_id: randomUUID(), message: BRIEF };
    const stream = await streamedTurn(payload);
    try {
      await Promise.race([started.promise, stream.done.then(() => { throw new Error('The turn ended before drafting started.'); })]);
      expect(persisted).toBeNull();
      const signal = vi.mocked(fetch).mock.calls.at(-1)?.[1]?.signal;
      expect(signal).toBeInstanceOf(AbortSignal); // the provider call carries a signal, so "not aborted" is a real claim
      stream.disconnect();
      expect(signal!.aborted).toBe(false);
      finish.release();
      await stream.done;
      expect(signal!.aborted).toBe(false);
      expect(stream.delivered.some((f) => f.includes('"stage":"COMPLETE"'))).toBe(false);
      expect(registered).toHaveLength(1);
      expect(callKinds()).toEqual([false, true]); // the drafter, then the AI's reply (T1)
      expect(persisted!.living_model.canonical).toEqual(bakery());
      const snapshot = JSON.stringify(persisted);
      const cold = reopenProgram(JSON.parse(snapshot))!;
      expect(cold.current).toBe(true);
      expect(persisted!.living_model.runs).toHaveLength(1);
      expect(turnRows.get(payload.turn_id)?.assistant_message).toBeTruthy();
      const replay = await turn(payload);
      expect([replay.statusCode, replay.json().durability]).toEqual([200, 'replayed']);
      expect(replay.json().cards).toHaveLength(1); // the lost reading card is recovered too
      expect([registered.length, sent.length, JSON.stringify(persisted)]).toEqual([1, 2, snapshot]);
    } finally { finish.release(); await stream.done; }
  });

  it.each(['before', 'after'] as const)('T gap3: disconnect %s the approval commit preserves the frozen model and Run; replay and a cold proposal retry never write twice', async (stage) => {
    replies = [JSON.stringify(bakery())];
    const draft = (await turn({ message: BRIEF })).json();
    const card = draft.cards[0];
    const held = agentProposalOf([...turnRows.values()].find((r) => r.pending_actions?.length)?.pending_actions[0])!;
    conversationIds.set(SCENARIO, `conv_${SCENARIO}`);
    replies = [() => sse('', [{ type: 'function_call', id: 'fc_approve', call_id: 'call_approve', status: 'completed', name: 'apply_change',
      arguments: JSON.stringify({ proposal_id: card.proposal_id }) }]), 'Saved.'];
    const reached = latch(); const finish = latch();
    registerPause = async (at) => { if (at === stage) { reached.release(); await finish.promise; } };
    const payload = { turn_id: randomUUID(), message: card.approve_action.message, chip: card.approve_action };
    const stream = await streamedTurn(payload);
    try {
      await Promise.race([reached.promise, stream.done.then(() => { throw new Error(`The turn ended before the ${stage}-commit pause.`); })]);
      expect(registered).toHaveLength(stage === 'before' ? 1 : 2);
      expect(turnRows.has(payload.turn_id)).toBe(false); // no terminal answer yet, even after the save
      stream.disconnect(); finish.release();
      await stream.done;
      registerPause = undefined;
      expect(stream.delivered.some((f) => f.includes('"stage":"COMPLETE"'))).toBe(false);
      expect([registered.length, sent.length]).toEqual([2, 4]); // draft, its AI reply (T1), native apply call, native reply
      expect(sent[2]!.tool_choice).toMatchObject({ type: 'function', name: 'apply_change' });
      expect(stableStringify(persisted!.living_model)).toBe(stableStringify(held.living_model));
      expect(persisted!.living_model.runs).toHaveLength(2);
      expect(persisted!.living_model.runs[0]).toEqual(registered[0]!.graph.living_model.runs[0]);
      const snapshot = JSON.stringify(persisted);
      const cold = reopenProgram(JSON.parse(snapshot))!;
      expect(cold.current).toBe(true);
      expect(cold.run!.run_id).toBe(persisted!.living_model.runs[1].run_id);
      const replay = await turn(payload);
      expect([replay.statusCode, replay.json().durability]).toEqual([200, 'replayed']);

      // A fresh proposal store has no applied flag or execution memo: only THIS operation's persisted version can reconcile it.
      const proposals = new ProposalStore(); proposals.put(JSON.parse(JSON.stringify(held)));
      const operation = registered[1]!.operation_id;
      const ownReceipt = { version_id: 'v_2', version_number: 2, mutation_id: 'm_2', source_turn_id: registrationTurnId(SCENARIO, operation) };
      const historyDispatch = async (path: string, body: unknown) => path.endsWith('/versions')
        ? { status: 200, json: { versions: [{ version_id: 'unrelated', sequence: 3, creation: { kind: 'committed_mutation', mutation_id: 'other', source_turn_id: 'other' } },
          { version_id: ownReceipt.version_id, sequence: 2, creation: { kind: 'committed_mutation', mutation_id: ownReceipt.mutation_id, source_turn_id: ownReceipt.source_turn_id } }] } }
        : dispatch(path, body);
      expect(await applyProgramChange({ dispatch: historyDispatch, proposals }, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, held.proposal_id))
        .toMatchObject({ status: 'ok', data: { already_saved: true, receipt: ownReceipt } });
      expect([registered.length, sent.length, JSON.stringify(persisted)]).toEqual([2, 4, snapshot]);
    } finally { finish.release(); await stream.done; registerPause = undefined; }
  });

  it('inventory §0 item 6: a typed program turn gives the agent its state in the program tools\' own words, and its Run tool asks for no timing reading', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).statusCode).toBe(200);
    conversationIds.set(SCENARIO, `conv_${SCENARIO}`);
    replies = ['The model holds what you described.'];
    expect((await turn({ message: 'What does the model hold?' })).statusCode).toBe(200);
    // The request the agent's call actually sent: its state block, and its Run tool's parameters.
    const agent = sent[1]!;
    const block = (agent.input as Json[]).map((i) => (typeof i.content === 'string' ? i.content : JSON.stringify(i.content))).find((t) => t.includes('OLUMI STATE BLOCK'))!;
    expect(block).toContain(PROGRAM_MODEL_STATE_PREFIX);
    for (const legacy of ['get_canonical_state', 'graph_revision', 'readiness_after', 'readiness_if_approved']) expect(block).not.toContain(legacy);
    const run = (agent.tools as Json[]).find((t) => t.name === 'run_analysis')!;
    expect(Object.keys(run.parameters.properties)).toEqual(['reason']);
  });

  /**
   * ⭐ SERVED STAGING, 26 OCT (04:57:12Z twice, 07:44:06Z once): a scenario's FIRST conversation turn, the approval after its
   * first draft, failed in about 3 s on "503 upstream connect error or disconnect/reset before headers … Connection refused",
   * with 0 AI calls and nothing saved, and the next turn on the same board went through. The one request such a turn makes
   * before any AI call is the scenario's empty Conversation create, so that create alone is tried again: at most 3 attempts,
   * only when there was no answer (fetch threw, not an abort) or the answer was a 5xx. Every row is bound at the fetch the
   * OpenAI client sends through, on the real core route; the abort rows call the same turn with a signal (the route gives none).
   */
  describe('the scenario\'s empty Conversation create (served 503, 26 Oct)', () => {
    /** Each create attempt's log line (`core_turn.conversation_create`), at either level, in the order they were written. */
    const restoreSpies: (() => void)[] = [];
    // Restored after every row, passed or failed: a row that fails before reading its lines never leaks them into the next.
    afterEach(() => { restoreSpies.splice(0).forEach((restore) => restore()); });
    const watchCreateLines = async () => {
      const { log } = await import('../../../utils/telemetry.js'); // the instance the re-imported route holds
      const spies = [vi.spyOn(log, 'info'), vi.spyOn(log, 'warn')];
      restoreSpies.push(...spies.map((s) => () => s.mockRestore()));
      return (): Json[] => spies.flatMap((s) => s.mock.calls.map((c, i) => ({ order: s.mock.invocationCallOrder[i]!, line: c[0] as Json })))
        .filter((l) => l.line?.event === 'core_turn.conversation_create').sort((a, b) => a.order - b.order).map((l) => l.line);
    };
    /**
     * The first draft (the host's own: no Conversation yet), then the approval of its reading card: the scenario's FIRST
     * conversation turn, with `answers` for its creates. `saved` gives the scenario a Conversation first.
     */
    const draftThenApprove = async (answers: typeof createAnswers, saved = false) => {
      replies = [JSON.stringify(bakery())];
      const draft = await turn({ message: BRIEF });
      expect(draft.statusCode, draft.body).toBe(200);
      // T1 (Paul 26 Oct): the draft's reply is the AI's, so the draft turn opens the scenario's Conversation for it. These rows
      // are a scenario's FIRST conversation turn with no saved Conversation (one drafted before T1), so it is cleared here, and
      // the approval's creates are counted from here.
      expect([creates.length, conversationIds.has(SCENARIO), draft.json().assistant_text]).toEqual([1, true, DEFAULT_AGENT_REPLY]);
      conversationIds.delete(SCENARIO); creates.length = 0;
      if (saved) conversationIds.set(SCENARIO, `conv_${SCENARIO}`);
      const card = draft.json().cards[0];
      const held = agentProposalOf([...turnRows.values()].find((r) => r.pending_actions?.length)?.pending_actions[0])!;
      const before = { sent: sent.length, registered: registered.length, graph: JSON.stringify(persisted) };
      createAnswers = answers;
      replies = [() => sse('', [{ type: 'function_call', id: 'fc_approve', call_id: 'call_approve', status: 'completed', name: 'apply_change',
        arguments: JSON.stringify({ proposal_id: card.proposal_id }) }]), 'Saved.'];
      const r = await turn({ message: card.approve_action.message, chip: card.approve_action });
      const j = r.json();
      return { r, j, held, before, counts: { status: r.statusCode, creates: creates.length, responses: sent.length - before.sent,
        writes: registered.length - before.registered, provider_rows: (j._provider_calls as Json[]).length, tools: j._agent?.tool_calls ?? null } };
    };

    // Strip (Paul 26 Oct; T3 removed): the create is sent ONCE, whatever its failure; this code adds no retry of its own.
    it.each([
      ['a 503', 503],
      ['no answer at all (fetch threw: connection refused)', new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' }) })],
      ['a 429', 429], ['a 400', 400],
      ['the client\'s own timeout (its fetch aborted, the turn not cancelled)', new DOMException('This operation was aborted', 'AbortError')],
      ['undici\'s headers timeout', new TypeError('fetch failed', { cause: Object.assign(new Error('Headers Timeout Error'), { name: 'HeadersTimeoutError', code: 'UND_ERR_HEADERS_TIMEOUT' }) })],
      ['undici\'s connect timeout', new TypeError('fetch failed', { cause: Object.assign(new Error('Connect Timeout Error (attempted address: api.openai.com:443, timeout: 10000ms)'), { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' }) })],
    ] as const)('%s: ONE create attempt, never repeated (T3 removed); the turn fails with no Responses call and no write', async (_name, answer) => {
      const lines = await watchCreateLines();
      const x = await draftThenApprove([answer, 201]); // a second attempt would take the 201
      expect({ status: x.counts.status, creates: x.counts.creates, responses: x.counts.responses, writes: x.counts.writes, left: createAnswers.length,
        graph_unchanged: JSON.stringify(persisted) === x.before.graph, saved_id: conversationIds.get(SCENARIO) ?? null })
        .toEqual({ status: 502, creates: 1, responses: 0, writes: 0, left: 1, graph_unchanged: true, saved_id: null });
      // ONE line at this non-model boundary, with no attempt count and no retry flag: no body, no key, no provider prose. (The
      // first line is the draft's own create, refused by this harness: T1.)
      const logged = lines().slice(1);
      expect(logged).toHaveLength(1);
      expect(Object.keys(logged[0]!)).not.toContain('retry');
      expect(Object.keys(logged[0]!)).not.toContain('attempt');
      for (const words of ['upstream connect', 'sk-', 'items', 'conv_created']) expect(JSON.stringify(logged)).not.toContain(words);
    }, 30_000);

    it('the create answered at once: the approval runs (one apply_change, one CAS write), one line with its status', async () => {
      const lines = await watchCreateLines();
      const x = await draftThenApprove([201]);
      expect([x.counts.status, x.counts.creates, x.counts.writes, x.counts.tools.filter((t: Json) => t.name === 'apply_change').length], x.r.body).toEqual([200, 1, 1, 1]);
      expect(stableStringify(persisted!.living_model)).toBe(stableStringify(x.held.living_model));
      expect(lines().slice(1)).toEqual([{ event: 'core_turn.conversation_create', scenario_id: SCENARIO, path: '/v1/conversations', status: 201, duration_ms: expect.any(Number) }]); // after the draft's refused create (T1)
    }, 30_000);

    it('the turn\'s signal aborted during the create: the turn stops at once, after ONE create attempt and no Responses call', async () => {
      const { runCoreTurn } = await import('../../agent-lane/core/sdk-turn.js');
      const { OPENAI_ONLY, runWithProviderPolicy } = await import('../../../adapters/llm/provider-policy.js');
      const { budgetFor } = await import('../../agent-lane/model-budgets.js');
      const cancel = new AbortController();
      // In flight when the turn is cancelled: fetch rejects as fetch does, on the signal it was given (never, after 3 s).
      createAnswers = [(init: any) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        setTimeout(() => cancel.abort(), 10);
        setTimeout(() => reject(new TypeError('the create was never cancelled')), 3_000);
      }), 201];
      const claimed: string[] = [];
      const t0 = Date.now();
      const outcome = await runWithProviderPolicy(OPENAI_ONLY('agent_core_turn'), () => runCoreTurn({
        ctx: { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-cancel', verified_user_messages: ['Hello.'], user_turn_text: 'Hello.' },
        message: 'Hello.', instructions: 'Synthetic instructions.', budget: budgetFor('gpt-6.1-sol', 'conversation'), userId: null, tools: () => [],
        conversationStore: { read: async () => null, claim: async (_s, id) => { claimed.push(id); return id; } }, signal: cancel.signal,
      })).then(() => 'answered', (err: unknown) => err);
      const ms = Date.now() - t0;
      const { APIUserAbortError } = await import('openai-v7');
      expect(outcome).toBeInstanceOf(APIUserAbortError);
      expect({ aborted: cancel.signal.aborted, creates: creates.length, left: createAnswers.length, responses: sent.length, claimed })
        .toEqual({ aborted: true, creates: 1, left: 1, responses: 0, claimed: [] });
      expect(ms).toBeLessThan(500); // at once
    }, 30_000);

    it('a scenario with a saved Conversation: its first approval makes 0 creates and continues that Conversation', async () => {
      const x = await draftThenApprove([503, 201], true);
      expect([x.counts.status, x.counts.creates, createAnswers.length, x.counts.writes, x.j._agent.sdk.conversation_id, x.j._agent.sdk.conversation_created], x.r.body)
        .toEqual([200, 0, 2, 1, `conv_${SCENARIO}`, false]);
    }, 30_000);
  });

  /**
   * W9: AN OPENAI OVERLOAD (served staging 26 Oct). Strip (Paul 26 Oct): our own reply retry (W9a) and drafter resend (W9b) are
   * removed; the error typing (W9d) stays, so an overload is reported as the provider being busy and a saved change is kept.
   * Each row drives the real core route or the real tool, with the provider's failure injected at fetch (synthetic bakery words).
   */
  describe('W9: an OpenAI overload (served 26 Oct 13:33Z and 13:44Z)', () => {
    // The provider's error as its stream carries it (the captured shape of 19 Oct's streamed refusal, `{ error: {...} }`), after
    // the response was created. Its typed fields are this fixture's: the served turn's log kept only the message (UNVERIFIED).
    const OVERLOADED = { message: 'Our servers are currently overloaded. Please try again later.', type: 'service_unavailable_error', param: null, code: 'server_is_overloaded' };
    const overloaded = (): Response => new Response(
      `event: response.created\ndata: ${JSON.stringify({ type: 'response.created', sequence_number: 0, response: { id: `resp_overloaded_${sent.length}`, object: 'response', status: 'in_progress', model: 'gpt-6.1-sol', output: [] } })}\n\n`
      + `event: error\ndata: ${JSON.stringify({ error: OVERLOADED })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const SAVED_KEPT = 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.';
    /** The first draft, then its card's press, its first call answered with the approval (the reply calls are each row's). */
    const press = async () => {
      replies = [JSON.stringify(bakery())];
      const draft = await turn({ message: BRIEF });
      expect(draft.statusCode, draft.body).toBe(200);
      conversationIds.set(SCENARIO, `conv_${SCENARIO}`);
      const card = draft.json().cards[0];
      const apply = () => sse('', [{ type: 'function_call', id: 'fc_approve', call_id: 'call_approve', status: 'completed', name: 'apply_change',
        arguments: JSON.stringify({ proposal_id: card.proposal_id }) }]);
      return { apply, payload: { turn_id: randomUUID(), message: card.approve_action.message, chip: card.approve_action } };
    };
    const outputsSent = (body: Json): string[] => (body.input as Json[]).filter((i) => i.type === 'function_call_output').map((i) => String(i.call_id));

    // Strip (Paul 26 Oct; W9a removed): the reply after a saved change is never asked for again by this code.
    it('change 2 (W9a removed): an overload on the reply after the approval saved is not asked for again: the change is kept, written once, and the provider is reported busy', async () => {
      const { apply, payload } = await press();
      replies = [apply, overloaded, 'never sent'];
      const r = await turn(payload);
      expect(r.statusCode, r.body).toBe(502);
      expect(r.json().error, 'the provider is busy; the change is kept').toEqual({ code: 'PROVIDER_CAPACITY', message: SAVED_KEPT, retry_safe: false, nothing_saved: false });
      expect(registered, 'the approval stays saved, written once').toHaveLength(2);
      // The draft, its AI reply (T1), the apply call and the overloaded reply: the reply is never asked for again.
      expect([sent.length, replies.length]).toEqual([4, 1]);
      expect(outputsSent(sent[3]!)).toEqual(['call_approve']);
    });

    it('change 2 (CONTRAST): a provider error that is not a server fault on the same reply is not asked for again, and stays an upstream error', async () => {
      const { apply, payload } = await press();
      const refusal = () => new Response(`event: error\ndata: ${JSON.stringify({ error: { message: 'Invalid request.', type: 'invalid_request_error', param: null, code: null } })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } });
      replies = [apply, refusal, 'never sent'];
      const r = await turn(payload);
      expect(r.statusCode, r.body).toBe(502);
      expect(r.json().error).toMatchObject({ code: 'UPSTREAM_ERROR', nothing_saved: false });
      expect([sent.length, registered.length, replies.length]).toEqual([4, 2, 1]);
    });

    it('change 2 (CONTRAST): an overload before anything is saved is not asked for again here: nothing saved, the provider busy, and the same turn may be sent again', async () => {
      replies = [JSON.stringify(bakery())];
      expect((await turn({ message: BRIEF })).statusCode).toBe(200);
      conversationIds.set(SCENARIO, `conv_${SCENARIO}`);
      const payload = { turn_id: randomUUID(), message: 'What does the model hold now?' };
      replies = [overloaded, 'never sent'];
      const r = await turn(payload);
      expect(r.statusCode, r.body).toBe(502);
      expect(r.json().error).toMatchObject({ code: 'PROVIDER_CAPACITY', retry_safe: true, nothing_saved: true });
      expect([sent.length, registered.length, replies.length]).toEqual([3, 1, 1]); // the draft, its AI reply (T1), the overloaded call
      expect([turnRows.has(`${payload.turn_id}:claim`), turnRows.has(payload.turn_id)], 'the claim is released, so a resend runs the turn').toEqual([false, false]);
    });

    it('change 3 (W9b removed): a drafter repair call that ends on the overload is never sent again: the loop stops on it, and no card is prepared', async () => {
      replies = [JSON.stringify(bakery())];
      expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
      const read = programReadOf(persisted!);
      const saved = (read.kind === 'program' ? read.program.canonical : null)!;
      const none = { version: saved.version, question: null, period: null, coaching_questions: null, quantities: [], relations: [], goals: [], limits: [], preferences: [], options: [], risks: [], claims: [],
        evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [] };
      const broken = { ...none, claims: [{ id: 'nowhere', text: 'Bread sells.', concerns: ['no_such_record'], author: 'olumi', quote: null, party: null, approval: 'proposed', approved_by: null, author_id: null }] };
      const landlord = { id: 'landlord_agrees', text: 'Only once the landlord agrees.', kind: 'prerequisite', concerns: ['second_oven'], author: 'person', party: null,
        quote: 'the landlord must agree first', approval: 'proposed', approved_by: null, author_id: null };
      const words = 'The oven would cost £2,500, and the landlord must agree first.';
      replies = [JSON.stringify(broken), overloaded, JSON.stringify({ ...none, conditions: [landlord] })];
      sent.length = 0;
      const info = vi.spyOn(staticLog, 'info'); // the instance the statically imported tools hold
      const out = await proposeProgramChange({ dispatch, proposals: new ProposalStore() }, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(),
        verified_user_messages: [words], user_turn_text: words }, ProgramChangeParams.parse({ public_label: 'The landlord must agree', basis: 'their words',
        request: 'The landlord must agree first.', remove: [] })) as Json;
      const drafted = info.mock.calls.flatMap(([o]) => ((o as Json)?.event === 'model_program.update_draft' ? [o as Json] : []));
      info.mockRestore();
      expect(out.status, JSON.stringify(out)).toBe('refused');
      // The update and its repair (overloaded): two calls; the repair's body is never sent again.
      expect(sent).toHaveLength(2);
      expect(replies).toHaveLength(1);
      // The failed attempt is logged with the provider's typed fields, never its words.
      expect(drafted.map((d) => d.attempts.map((a: Json) => [a.codes, a.failed ?? null, a.provider_error ?? null]))).toEqual([[
        [['undefined_ref'], null, null],
        [null, 'call failed: Error', { status: null, type: 'service_unavailable_error', code: 'server_is_overloaded', request_id: null }]]]);
      expect(JSON.stringify(drafted)).not.toContain('overloaded. Please');
      expect(registered, 'proposing saves nothing').toHaveLength(1);
    });
  });

  it('step 1, drafter: the first turn sends ONE strict canonical-schema call at gpt-6.1-sol, effort medium, with the fixed prompt', async () => {
    replies = [JSON.stringify(bakery())];
    const r = await turn({ message: BRIEF });
    expect(r.statusCode).toBe(200);
    expect(callKinds()).toEqual([false, true]); // ONE drafter call, then the AI's reply in the Conversation (T1)
    const body = sent[0]!;
    expect(body.model).toBe('gpt-6.1-sol');
    expect(body.reasoning).toEqual({ effort: 'medium' });
    // Alpha G14: today's date (Europe/London) follows the fixed instructions, so a stated date counts from it.
    const london = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(body.instructions).toBe(`${DRAFTING_INSTRUCTIONS}\n\nToday is ${london} (Europe/London). A date they state counts in whole periods from today, which is period 0.`);
    // The date sent is recorded beside the fixed instructions' hash, so the record says exactly what was sent (Codex on #3760).
    expect(r.json().model_program.draft).toMatchObject({ prompt_sha256: createHash('sha256').update(DRAFTING_INSTRUCTIONS, 'utf8').digest('hex'), today: london });
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'canonical_model', strict: true });
    expect(stableStringify(body.text.format.schema)).toBe(stableStringify(CANONICAL_JSON_SCHEMA));
    expect(body.input).toEqual([{ role: 'user', content: BRIEF }]);
    expect(body.tools ?? []).toEqual([]);
    // The saved model is the AI's own draft, unedited.
    expect(persisted!.living_model.canonical).toEqual(bakery());
    expect(r.json().model_program.draft.attempts.map((a: Json) => a.errors.length)).toEqual([0]);
  });

  it('no header, no flag: a scenario with no saved model is drafted by the canonical drafter and nothing else', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    expect(sent.map((b) => (b.conversation !== undefined ? 'reply' : b.text?.format?.name ?? b.model))).toEqual(['canonical_model', 'reply']); // and the AI's reply (T1)
    expect(persisted!.living_model.model_program).toBe('v1');
  });

  it('step 2, compile + repair: the compiler\'s own sentence goes back to the SAME conversation; at most 2 repairs', async () => {
    const bad = JSON.stringify(bakeryWithDefect());
    replies = [bad, JSON.stringify(bakery())];
    const r = await turn({ message: BRIEF });
    expect(drafterCalls()).toHaveLength(2);
    const errors = compile(bakeryWithDefect(), { sourceText: BRIEF }).errors;
    expect(errors.map((e) => e.code)).toEqual(['range_order']);
    expect(sent[1]!.input).toEqual([{ role: 'user', content: BRIEF }, { role: 'assistant', content: bad },
      { role: 'user', content: `${REPAIR_PREFIX}\n- ${errors[0]!.message}` }]);
    expect(sent[1]!.instructions).toBe(sent[0]!.instructions);
    expect(r.json().model_program.draft.attempts.map((a: Json) => a.errors.length)).toEqual([1, 0]);
    expect(persisted!.living_model.canonical).toEqual(bakery());

    // Three defective drafts: three calls (two repairs), and nothing is saved.
    beforeEachReset();
    replies = [bad, bad, bad];
    const r3 = await turn({ message: BRIEF });
    expect(sent).toHaveLength(3);
    expect(persisted).toBeNull();
    expect(r3.json().model_program.saved).toBe(false);
    expect(r3.json()._agent.tool_calls).toEqual([{ name: 'draft_canonical_model', outcome: 'refused', refusal: 'does_not_compile' }]);
  });

  it('25 Oct 03:55Z (every first draft "call failed: Error"; the cause, 429 insufficient_quota, recorded nowhere): a provider call that throws keeps its typed fields on the attempt and the summary log line, never its message or key; the same no_draft words', async () => {
    const info = vi.spyOn((await import('../../../utils/telemetry.js')).log, 'info');
    const QUOTA_WORDS = 'You exceeded your current quota, please check your plan and billing details.';
    const KEY = 'sk-proj-ab**********************wxyz';
    replies = [() => new Response(JSON.stringify({ error: { message: `${QUOTA_WORDS} Key: ${KEY}`, type: 'insufficient_quota', param: null, code: 'credit_balance_exhausted' } }),
      { status: 429, headers: { 'content-type': 'application/json', 'x-request-id': 'req_quota_1', 'x-should-retry': 'false' } })];
    const r = await turn({ message: BRIEF });
    const line = info.mock.calls.flatMap(([o]) => ((o as Json)?.event === 'core_turn.summary' ? [o as Json] : [])).at(-1)!;
    info.mockRestore();
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(sent).toHaveLength(1);
    expect(persisted).toBeNull();
    expect(j.assistant_text).toBe('I couldn\'t build a model that calculates from this yet (call failed: Error). Nothing was saved.');
    expect(j._agent.tool_calls).toEqual([{ name: 'draft_canonical_model', outcome: 'refused', refusal: 'no_draft' }]);
    const typed = { status: 429, type: 'insufficient_quota', code: 'credit_balance_exhausted', request_id: 'req_quota_1' };
    expect(j.model_program.draft.attempts).toEqual([{ attempt: 0, errors: null, failed: 'call failed: Error', provider_error: typed, status: null, usage: null, ms: expect.any(Number) }]);
    expect(line.tool_calls).toEqual([{ name: 'draft_canonical_model', outcome: 'refused', refusal: 'no_draft', provider_error: typed }]);
    // Never the provider's message (it can echo input) nor the masked key in it: not on the wire, not in the log line.
    for (const text of [r.body, JSON.stringify(line)]) for (const words of ['exceeded your current quota', 'sk-proj', 'wxyz']) expect(text).not.toContain(words);
  });

  it('25 Oct (the contrast): a call that throws a plain Error, or no Error at all, records null typed fields; nothing throws, and the words are as before', async () => {
    const none = { status: null, type: null, code: null, request_id: null };
    for (const [thrown, name] of [[new Error('socket hang up'), 'Error'], ['not an Error', 'error']] as const) {
      const out = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch,
        call: async () => { throw thrown; } });
      expect(out.assistantText).toBe(`I couldn't build a model that calculates from this yet (call failed: ${name}). Nothing was saved.`);
      expect(out.toolCalls).toEqual([{ name: 'draft_canonical_model', ok: false, outcome: 'refused', refusal: 'no_draft' }]);
      // Strip (Paul 26 Oct; W9b removed): a failed call is never sent again by the loop; the first failure ends it.
      const failedAt = (attempt: number) => ({ attempt, errors: null, failed: `call failed: ${name}`, provider_error: none, status: null, usage: null, ms: expect.any(Number) });
      expect((out.payload.model_program['draft'] as Json).attempts).toEqual([failedAt(0)]);
      expect(out.toolResults[0]!.provider_error).toEqual(none);
      expect(JSON.stringify(out.payload)).not.toContain('socket hang up');
    }
    expect(sent).toHaveLength(0);
  });

  /**
   * C14 (alpha spec §7, bounded operation, 27 Oct): a first draft whose provider call fails or comes back unusable ends in a
   * bounded number of physical attempts (the OpenAI client's own configured retries, AGENTS_CLIENT_MAX_RETRIES, are the only
   * resend; the drafter's loop sends nothing again), writes nothing, and says nothing was saved. Today's behaviour, pinned on
   * the real core route with the provider's answer injected at fetch; a sentinel reply queued after the last expected attempt
   * stays unsent. Elapsed time is printed, never asserted. NOT covered here: a provider that never answers (the drafter passes
   * no timeout or signal of its own; only the client's default applies).
   */
  describe('C14: a failed first-draft call is bounded and writes nothing; every physical call is on the record', () => {
    const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
    const NEVER = 'C14 sentinel: never sent';
    const failedDraft = async (label: string, answers: (() => Response)[]) => {
      replies = [...answers, NEVER];
      const t0 = performance.now();
      const r = await turn({ message: BRIEF });
      console.log('C14 elapsed ms', label, Math.round(performance.now() - t0));
      return { r, j: r.json() as Json };
    };
    /** What every failed first draft leaves: no write, no Conversation, the host's own refusal words, one drafter attempt. */
    const nothingWritten = (j: Json, why: string) => {
      expect([registered.length, persisted, creates.length], 'nothing registered, no Conversation opened').toEqual([0, null, 0]);
      expect(j.assistant_text).toBe(`I couldn't build a model that calculates from this yet (${why}). Nothing was saved.`);
      expect(j.model_program).toMatchObject({ turn: 'draft', saved: false });
      expect(j._agent.tool_calls).toEqual([{ name: 'draft_canonical_model', outcome: 'refused', refusal: 'no_draft' }]);
      expect(replies, 'the sentinel after the last expected attempt is never sent').toEqual([NEVER]);
    };
    const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 500, output_tokens_details: { reasoning_tokens: 100 }, total_tokens: 1500 };

    it('(a) HTTP 503 on every attempt: 1 + AGENTS_CLIENT_MAX_RETRIES = 3 physical attempts of the same request, then refused; nothing saved', async () => {
      const { r, j } = await failedDraft('503 x3', [() => createAnswer(503), () => createAnswer(503), () => createAnswer(503)]);
      expect(r.statusCode, r.body).toBe(200);
      expect(sent).toHaveLength(1 + AGENTS_CLIENT_MAX_RETRIES);
      expect(sent).toHaveLength(3);
      expect(callKinds(), 'every attempt is the drafter\'s; no AI reply').toEqual([false, false, false]);
      expect(new Set(sent.map((b) => stableStringify(b))).size, 'the same request resent, unchanged').toBe(1);
      nothingWritten(j, 'call failed: Error');
      // The drafter's loop made ONE logical call; its typed provider fields are the last physical attempt's.
      expect(j.model_program.draft.attempts).toEqual([{ attempt: 0, errors: null, failed: 'call failed: Error', provider_error: { status: 503, type: null, code: null, request_id: null },
        status: null, usage: null, ms: expect.any(Number) }]);
      // The ledger: one row per physical attempt, each closed as an HTTP error, the two resent ones marked retried.
      const rows = j._provider_calls as Json[];
      expect(rows.map((c) => [c.site, c.purpose, c.outcome, c.attempt])).toEqual([0, 1, 2].map((i) => ['model-program.draft', 'canonical_draft', 'allowed',
        { transport_status: 503, result: 'http_error', outcome: 'http_error', ...(i < 2 ? { retry: true, retry_reason: 'transport' } : { retry: false }) }]));
      expect(rows.every((c) => c.usage === undefined), 'no usage on a failed attempt').toBe(true);
      expect(j.error).toBeNull();
    }, 30_000);

    it('(b) HTTP 429 without x-should-retry: the client retries it as it does a 5xx, 3 physical attempts, then refused; nothing saved (contrast: x-should-retry false is sent once, the 25 Oct 03:55Z row)', async () => {
      const { r, j } = await failedDraft('429 x3', [() => createAnswer(429), () => createAnswer(429), () => createAnswer(429)]);
      expect(r.statusCode, r.body).toBe(200);
      expect(sent).toHaveLength(1 + AGENTS_CLIENT_MAX_RETRIES);
      expect(callKinds()).toEqual([false, false, false]);
      nothingWritten(j, 'call failed: Error');
      expect(j.model_program.draft.attempts).toEqual([{ attempt: 0, errors: null, failed: 'call failed: Error',
        provider_error: { status: 429, type: 'requests', code: 'rate_limit_exceeded', request_id: null }, status: null, usage: null, ms: expect.any(Number) }]);
      const rows = j._provider_calls as Json[];
      expect(rows.map((c) => [c.site, c.attempt.transport_status, c.attempt.outcome, c.attempt.retry])).toEqual([
        ['model-program.draft', 429, 'rate_limited', true], ['model-program.draft', 429, 'rate_limited', true], ['model-program.draft', 429, 'rate_limited', false]]);
      // Never the provider's message on the wire.
      expect(r.body).not.toContain('Rate limit reached');
      expect(j.error).toBeNull();
    }, 30_000);

    it('(c) a completed response whose text is not JSON: ONE call, never resent or repaired; nothing saved', async () => {
      const { r, j } = await failedDraft('not JSON', [() => sse('Here is your model: a bakery with two ovens.')]);
      expect(r.statusCode, r.body).toBe(200);
      expect(callKinds()).toEqual([false]);
      nothingWritten(j, 'output is not JSON');
      expect(j.model_program.draft.attempts).toEqual([{ attempt: 0, errors: null, failed: 'output is not JSON', status: 'completed', usage, ms: expect.any(Number) }]);
      const rows = j._provider_calls as Json[];
      expect(rows.map((c) => [c.site, c.attempt.transport_status, c.attempt.result, c.attempt.outcome, c.attempt.retry])).toEqual([['model-program.draft', 200, 'completed', 'success', false]]);
      expect(rows[0]!.usage).toMatchObject({ input_tokens: 1000, output_tokens: 500, cached_input_tokens: 0 });
      expect(j.error).toBeNull();
    }, 30_000);

    it('(d) an incomplete response (max_output_tokens, no message): ONE call, never resent; the reason is said; nothing saved', async () => {
      const spent = { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 32_000, output_tokens_details: { reasoning_tokens: 32_000 }, total_tokens: 33_000 };
      const incomplete = { id: 'resp_incomplete', object: 'response', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, model: 'gpt-6.1-sol', output: [], usage: spent };
      const ev = (o: Json) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
      const stream = ev({ type: 'response.created', sequence_number: 0, response: { ...incomplete, status: 'in_progress', incomplete_details: null, usage: null } })
        + ev({ type: 'response.incomplete', sequence_number: 1, response: incomplete });
      const { r, j } = await failedDraft('incomplete', [() => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })]);
      expect(r.statusCode, r.body).toBe(200);
      expect(callKinds()).toEqual([false]);
      nothingWritten(j, 'no output (incomplete: max_output_tokens)');
      expect(j.model_program.draft.attempts).toEqual([{ attempt: 0, errors: null, failed: 'no output (incomplete: max_output_tokens)', status: 'incomplete', usage: spent, ms: expect.any(Number) }]);
      // Today the ledger closes an incomplete terminal response as a delivered one (its terminal event passed through).
      const rows = j._provider_calls as Json[];
      expect(rows.map((c) => [c.site, c.attempt.transport_status, c.attempt.result, c.attempt.outcome, c.attempt.retry])).toEqual([['model-program.draft', 200, 'incomplete', 'success', false]]);
      expect(rows[0]!.usage).toMatchObject({ input_tokens: 1000, output_tokens: 32_000, cached_input_tokens: 0 });
      expect(j.error).toBeNull();
    }, 30_000);

    it('(6) the provider-call record of a successful first draft: one row per physical call, each bound to the request actually sent (site, purpose, prompt alias and hashes, attempt) with its usage as numbers', async () => {
      replies = [JSON.stringify(bakery())];
      const t0 = performance.now();
      const r = await turn({ message: BRIEF });
      console.log('C14 elapsed ms', 'first draft ok', Math.round(performance.now() - t0));
      expect(r.statusCode, r.body).toBe(200);
      const j = r.json() as Json;
      const rows = j._provider_calls as Json[];
      expect(callKinds()).toEqual([false, true]);
      expect(rows, 'one row per physical call').toHaveLength(sent.length);
      expect(rows.map((c) => [c.site, c.provider, c.purpose, c.outcome, c.prompt_alias])).toEqual([
        ['model-program.draft', 'openai', 'canonical_draft', 'allowed', 'agent.construct'], ['agent-core.sdk', 'openai', 'conversation', 'allowed', 'agent.converse']]);
      // Each row's identity is read off the body that call sent (its own index), never a constant another call could match.
      rows.forEach((c, i) => {
        const body = sent[i]!;
        expect(c.prompt_sha256, `row ${i}: the instructions sent`).toBe(sha(String(body.instructions)));
        expect(c.input_sha256, `row ${i}: the input sent`).toBe(sha(JSON.stringify(body.input)));
        expect(c.attempt, `row ${i}: one delivered attempt, not retried`).toMatchObject({ transport_status: 200, result: 'completed', outcome: 'success', retry: false });
        expect(c.attempt.response_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(c.duration_ms).toEqual(expect.any(Number));
        expect(c.usage, `row ${i}: the provider's usage is recorded`).toBeDefined();
        for (const k of ['input_tokens', 'output_tokens', 'cached_input_tokens']) expect(typeof c.usage[k], `row ${i}: usage.${k}`).toBe('number');
        expect(c.usage).toMatchObject({ input_tokens: 1000, output_tokens: 500, cached_input_tokens: 0 });
      });
      const draft = rows[0]!;
      expect(draft).toMatchObject({ model: 'gpt-6.1-sol', returned_model: 'gpt-6.1-sol', reasoning_effort: 'medium', max_output_tokens: 32_000, tool_names: [],
        schema_sha256: sha(JSON.stringify(sent[0]!.text.format.schema)) });
      // The draft record's schema hash is the one the ledger saw sent; its prompt hash is the FIXED instructions' (step 1),
      // the ledger's the composed instructions with today's line.
      expect(draft.schema_sha256).toBe(j.model_program.draft.schema_sha256);
      expect(draft.prompt_sha256).not.toBe(j.model_program.draft.prompt_sha256);
      expect(rows[1]!.schema_sha256, 'the reply sends no schema').toBeUndefined();
    }, 30_000);
  });

  it('alpha G4: a draft whose save cannot be confirmed (the register call throws) never says nothing was changed', async () => {
    const throwing: typeof dispatch = async (path, body) => { if (path.endsWith('/graph/register')) throw new Error('socket hang up'); return dispatch(path, body); };
    replies = [JSON.stringify(bakery())];
    const out = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch: throwing });
    expect(out.assistantText).toBe('The save could not be confirmed, so the model may or may not have changed. Reload to see the current model before changing it again.');
    expect(out.toolCalls[0]).toMatchObject({ name: 'draft_canonical_model', ok: false, outcome: 'unknown', refusal: 'save_unknown' });
  });

  it('writes#4: a draft whose register lands and then throws is looked up ONCE by its own operation id and, found, is that save (its receipt, the draft reply, one revision); not found, it stays unknown and says so', async () => {
    let lookups = 0;
    let servedTurnId = '';
    // The store's history keys a version by its registration turn id; `mine` says whether this operation's version is in it.
    const landsThenThrows = (mine: boolean): typeof dispatch => async (path, body) => {
      if (path.endsWith('/graph/register')) { await dispatch(path, body); throw new Error('socket hang up'); }
      if (path.endsWith('/versions')) {
        lookups += 1;
        servedTurnId = mine ? registrationTurnId(SCENARIO, registered[0]!.operation_id) : 'another_operation';
        return { status: 200, json: { versions: [{ version_id: 'v_1', sequence: 1, creation: { kind: 'initial', mutation_id: 'm_1', source_turn_id: servedTurnId } }] } };
      }
      return dispatch(path, body);
    };
    replies = [JSON.stringify(bakery())];
    const out = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch: landsThenThrows(true) });
    expect([registered.length, lookups]).toEqual([1, 1]);
    expect(out.payload.model_program).toMatchObject({ turn: 'draft', saved: true, write: 'already_saved', readback: { read: true, canonical_identical: true, runs_identical: true } });
    expect(out.toolCalls[0]).toEqual({ name: 'draft_canonical_model', ok: true, outcome: 'ok', mutated: true });
    expect(out.toolResults[0]).toEqual({ ok: true, mutated: true, model_version: { version_id: 'v_1', version_number: 1, mutation_id: 'm_1', source_turn_id: servedTurnId } });
    expect(out.assistantText.split('\n\n')[0]).toBe('I\'ve drafted a first model of: Should the bakery buy a second oven?');
    expect(out.mutated).toBe(true);

    // Contrast, a true miss: the same landed write, with only another operation's version in the history, stays unknown.
    SCENARIO = randomUUID(); persisted = null; registered.length = 0; lookups = 0;
    replies = [JSON.stringify(bakery())];
    const miss = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch: landsThenThrows(false) });
    expect([registered.length, lookups, servedTurnId]).toEqual([1, 1, 'another_operation']);
    expect(miss.payload.model_program).toMatchObject({ turn: 'draft', saved: false, write: 'unknown' });
    expect(miss.toolCalls[0]).toEqual({ name: 'draft_canonical_model', ok: false, outcome: 'unknown', mutated: false, refusal: 'save_unknown' });
    expect(miss.assistantText).toBe('The save could not be confirmed, so the model may or may not have changed. Reload to see the current model before changing it again.');
  });

  it('writes#4 recovery: a draft whose register lands, then another save lands before its acknowledgement is lost, is found by its own id yet never narrated as saved: the model read back is not the one sent, so it stays unknown; with nothing saved after it, the same lookup is that save', async () => {
    let lookups = 0;
    // The history, newest first, keys each version by its registration turn id.
    const versionOf = (i: number) => ({ version_id: `v_${i + 1}`, sequence: i + 1,
      creation: { kind: i === 0 ? 'initial' : 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId(SCENARIO, registered[i]!.operation_id) } });
    const lostAck = (another: boolean): typeof dispatch => async (path, body) => {
      if (path.endsWith('/graph/register')) {
        await dispatch(path, body);
        // Another save (the person's figure edit in a second tab) lands on top before this one's acknowledgement is lost.
        if (another) {
          const other = JSON.parse(JSON.stringify((body as Json).graph)) as Json;
          other.living_model.canonical.quantities = other.living_model.canonical.quantities.map((x: Json) => (x.id === 'base_sales' ? { ...x, value: 320, quote: 'We bake 320 loaves a week' } : x));
          await dispatch(path, { graph: other, thin_core: true, operation_id: randomUUID(), expected_graph_identity_hash: computeGraphIdentityHash(persisted as never)!.value });
        }
        throw new Error('socket hang up');
      }
      if (path.endsWith('/versions')) { lookups += 1; return { status: 200, json: { versions: registered.map((_, i) => versionOf(i)).reverse() } }; }
      return dispatch(path, body);
    };
    replies = [JSON.stringify(bakery())];
    const out = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch: lostAck(true) });
    expect([registered.length, lookups, persisted!.living_model.canonical.quantities.find((x: Json) => x.id === 'base_sales').value]).toEqual([2, 1, 320]);
    expect(out.payload.model_program).toMatchObject({ turn: 'draft', saved: false, write: 'unknown', readback: { read: true, canonical_identical: false } });
    expect(out.toolCalls[0]).toEqual({ name: 'draft_canonical_model', ok: false, outcome: 'unknown', mutated: false, refusal: 'save_unknown' });
    expect(out.toolResults[0]).toEqual({ ok: false, mutated: false });
    expect(out.assistantText).toBe('The save could not be confirmed, so the model may or may not have changed. Reload to see the current model before changing it again.');
    expect(out.mutated).toBe(false);

    // Contrast: the same lost acknowledgement with nothing saved after it is found and held, so it is that save.
    SCENARIO = randomUUID(); persisted = null; registered.length = 0; lookups = 0;
    replies = [JSON.stringify(bakery())];
    const held = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch: lostAck(false) });
    expect([registered.length, lookups]).toEqual([1, 1]);
    expect(held.payload.model_program).toMatchObject({ turn: 'draft', saved: true, write: 'already_saved', readback: { read: true, canonical_identical: true, runs_identical: true } });
    expect(held.toolCalls[0]).toEqual({ name: 'draft_canonical_model', ok: true, outcome: 'ok', mutated: true });
    expect(held.assistantText.split('\n\n')[0]).toBe('I\'ve drafted a first model of: Should the bakery buy a second oven?');
  });

  it('writes#4 (Codex r2): an already_saved the register\'s own 409 lookup returns is this save only while the read holds the postimage sent; a later save in its place leaves it unknown', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const base = JSON.parse(JSON.stringify(persisted)) as Json;
    const sent = JSON.parse(JSON.stringify(base)) as Json;
    sent.living_model.canonical.quantities = sent.living_model.canonical.quantities.map((x: Json) => (x.id === 'base_sales' ? { ...x, value: 310, quote: 'We bake 310 loaves a week' } : x));
    const receipt = { version_id: 'v_own', version_number: 2, mutation_id: 'm_own' };
    /** The register answers 409 reused after `landed` is saved in its place: the sent postimage itself, or another save. */
    const reused = (landed: Json): typeof dispatch => async (path, body) => {
      if (!path.endsWith('/graph/register')) return dispatch(path, body);
      await dispatch(path, { graph: landed, thin_core: true, operation_id: randomUUID(), expected_graph_identity_hash: computeGraphIdentityHash(persisted as never)!.value });
      return { status: 409, json: { details: { code: 'OPERATION_ID_REUSED' } } };
    };
    const other = JSON.parse(JSON.stringify(sent)) as Json;
    other.living_model.canonical.quantities = other.living_model.canonical.quantities.map((x: Json) => (x.id === 'base_sales' ? { ...x, value: 320, quote: 'We bake 320 loaves a week' } : x));
    const op = { scenarioId: SCENARIO, operationId: randomUUID(), ownVersion: async () => receipt };
    const later = await savePostimage(reused(other), { ...op, expectedIdentity: computeGraphIdentityHash(base as never)!.value }, sent);
    expect([later.write.status, later.readback.canonical_identical]).toEqual(['unknown', false]);
    // Contrast: the sent postimage is what landed, so the same lookup is that save, with its own receipt.
    const same = await savePostimage(reused(sent), { ...op, expectedIdentity: computeGraphIdentityHash(persisted as never)!.value }, sent);
    expect(same.write).toEqual({ status: 'already_saved', receipt });
  });

  it('step 3, simulate + present: the view is the simulator\'s result on the scenario\'s seed; the display graph is S1\'s projection', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF })).json();
    const x = compile(bakery(), { sourceText: BRIEF }).executable!;
    const sim = simulate(x, { seed: seedOf(SCENARIO), draws: RUN_DRAWS });
    const stored = persisted!.living_model.runs[0].result as Json;
    expect(persisted!.living_model.seed).toBe(seedOf(SCENARIO));
    expect(stored.chances).toEqual(JSON.parse(JSON.stringify(sim.options.map((o) => ({ option_id: o.option_id, per_goal: o.per_goal, joint: o.joint,
      within_limits: o.within_limits, joint_within_limits: o.joint_within_limits, outcomes: o.outcomes })))));
    const oven = sim.options.find((o) => o.option_id === 'second_oven')!.per_goal[0] as { chance: number };
    // W10 (adopted; the √12 law gave 1 − Φ(0.1 / 0.1155) ≈ 0.19, within 0.12 to 0.27): sell through 0.5 to 0.9 read as the
    // range it falls in 8 times out of 10, σ = 0.2/1.2815516 = 0.15606, so 1 − Φ(0.1 / 0.15606 = 0.6408) = 0.2608.
    // NB2 on #3801: within 0.02 of it (4.6 standard errors at 10,000 draws on this test's random seed: √(0.2608 × 0.7392 /
    // 10,000) = 0.0044), so the √12 law's 0.193238 is outside.
    expect(Math.abs(oven.chance - 0.2608)).toBeLessThanOrEqual(0.02);
    expect((sim.options.find((o) => o.option_id === 'keep_one')!.per_goal[0] as { chance: number }).chance).toBe(0);
    const view = r.canonical_analysis_view;
    expect(view.schema).toBe('canonical_analysis_view.v1');
    expect(view.options.map((o: Json) => [o.option_id, o.cell.kind])).toEqual([['second_oven', 'figure'], ['keep_one', 'figure']]);
    // The budget limit waits on the oven price: it is never folded silently into the chance.
    expect(stored.compile.within_limits.status).toBe('asks');
    expect(r.model_program.blockers.map((b: Json) => [b.id, b.code])).toEqual([['oven_price', 'asked']]);
    expect(view.options.every((o: Json) => o.cell.face.includes('Not yet checked: ‘Within the £3,000’'))).toBe(true);
    const { living_model: _lm, ...display } = persisted!;
    expect(display).toEqual(JSON.parse(JSON.stringify(project(bakery(), compile(bakery(), { sourceText: BRIEF })).graph)));
  });

  /** The bakery's chance words and basis as the view says them (step 3), written out by hand. */
  const BAKERY_SALES = '‘sales’ being at least 380 loaves per week';
  /** W8 (c7.1): after the first chance has said the range's reading in full, the leader's words name it by its ends. */
  const BAKERY_BASIS = 'on Olumi’s reading of your figures (not yet confirmed), if ‘sell through’ follows Olumi’s provisional reading of Olumi’s own estimated range, '
    + '0.5 to 0.9 and ‘sales’ follows Olumi’s assumed relationship';
  /** The bakery with the oven's price given: the £3,000 limit is then checked, and the second oven is within it in every draw. */
  const PRICED = `${BRIEF} The oven costs £2,500.`;
  const priced = (): CanonicalModelT => {
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known', value: 2500, question: null, quote: 'The oven costs £2,500' } : x));
    return m;
  };
  const FORBIDDEN_CHOICE = /\b(best|winner|wins?|recommend\w*|should|go with)\b|comes out on top/i;

  it('W6 review B2 (Paul 6 and 14 Oct): with the £3,000 limit not yet checked, the first Run names no option as most likely, says why with each chance, in the view and in the reply', async () => {
    replies = [JSON.stringify(bakery())];
    const r = await hostTurn(BRIEF);
    const view = r.canonical_analysis_view;
    const oven = view.options.find((o: Json) => o.option_id === 'second_oven').cell, keep = view.options.find((o: Json) => o.option_id === 'keep_one').cell;
    // A second oven: about 26% (step 3; W10, before it 19%), on the sales target alone; our one oven: 0% in every draw. Spend
    // = price × ovens, so only the second oven can break the budget, and its price is not known: a target-only chance is not
    // the whole goal.
    expect(oven.display).toMatch(/^about 2[4-8]%$/); // 0.2608 ± 0.02 (step 3), never the √12 law's 19%
    expect(keep.display).toBe('0%');
    expect(view.goal_chance.unchecked_limits).toEqual([{ limit_id: 'within_budget', words: '‘Within the £3,000’ — needs "oven price".' }]);
    expect(view.leader_licence).toBe('withheld');
    const words = 'In this model, which option is most likely to achieve the goal is not said yet, as a limit is not yet checked and these chances leave it out: '
      + `the chance of ${BAKERY_SALES} is ${oven.display} for ‘A second oven’ and 0% for ‘Keep our one oven’, ${BAKERY_BASIS}. Not yet checked: ‘Within the £3,000’ — needs "oven price".`;
    expect(view.leader).toEqual({ licence: 'withheld', option_id: null, goal_chance_leader: null, similar_option_ids: [], words });
    // The reply says the view's own words, once, after the options' chances; the stored Run holds the same view.
    const paragraphs = (r.assistant_text as string).split('\n\n');
    expect(paragraphs.filter((x) => x === words)).toHaveLength(1);
    expect(paragraphs.indexOf(words)).toBe(paragraphs.indexOf(keep.face) + 1);
    expect(persisted!.living_model.runs[0].result.canonical_analysis_view.leader).toEqual(view.leader);
    // Olumi's own words (every paragraph after the one quoting the person's question) never choose for them.
    for (const said of [words, ...paragraphs.slice(1)]) expect(said).not.toMatch(FORBIDDEN_CHOICE);
  });

  it('W6 (Paul 6 and 14 Oct; contrast to B2): with the oven price given the limit is checked, and the first Run says which option is most likely to achieve the goal, with both chances, in the view and in the reply', async () => {
    replies = [JSON.stringify(priced())];
    const r = await hostTurn(PRICED);
    const view = r.canonical_analysis_view;
    const oven = view.options.find((o: Json) => o.option_id === 'second_oven'), keep = view.options.find((o: Json) => o.option_id === 'keep_one');
    expect(view.goal_chance.unchecked_limits).toBeUndefined();
    // The second oven's 95% precision is far above 0 (our one oven's, exact) and below 50%: more likely to miss than meet it.
    expect(oven.cell.detail.precision_95[0]).toBeGreaterThan(keep.cell.detail.precision_95[1]);
    expect(oven.cell.detail.precision_95[1]).toBeLessThan(0.5);
    expect(view.leader_licence).toBe('permitted');
    const d = oven.main_driver.driver;
    expect([oven.main_driver.kind, d.quantity, d.author]).toEqual(['available', 'sell_through', 'olumi']);
    // W8 (c7.1, c7.2): the finding, its two chances and what it rests on, each once; the settings are said with the option's chance.
    const words = `In this model, ‘A second oven’ is the option most likely to achieve the goal: ${oven.cell.display} chance, against 0% for ‘Keep our one oven’, `
      + 'the next most likely. Like each option’s chance, it rests on Olumi’s reading of your figures (not yet confirmed) and the assumptions listed with it. '
      + 'Even so, in this model it is more likely to miss the goal than to meet it. Its chance is most sensitive to ‘sell through’ (Olumi’s estimate).';
    expect(oven.main_driver.detail).toContain(`held at its low end (0.5), the chance is ${d.low.display}; at its middle (0.7), ${d.middle.display}; at its high end (0.9), ${d.high.display}.`);
    expect(view.goal_chance.chance_words).toBe(`chance of ${BAKERY_SALES}, while ‘spend’ is at most £3,000`);
    expect(view.leader).toEqual({ licence: 'permitted', option_id: null, goal_chance_leader: 'second_oven', similar_option_ids: [], words });
    const paragraphs = (r.assistant_text as string).split('\n\n');
    expect(paragraphs.filter((x) => x === words)).toHaveLength(1);
    expect(paragraphs.indexOf(words)).toBe(paragraphs.indexOf(keep.cell.face) + 1);
    for (const said of [words, ...paragraphs.slice(1)]) expect(said).not.toMatch(FORBIDDEN_CHOICE);
  });

  it('W6 review B3: a stored Run that is not current carries no leader on any path that serves it (engine update, model moved, the agent\'s read); current, it does', async () => {
    replies = [JSON.stringify(priced())];
    const r = (await turn({ message: PRICED })).json();
    const stored = r.canonical_analysis_view as Json;
    expect([stored.leader_licence, stored.leader.goal_chance_leader]).toEqual(['permitted', 'second_oven']);
    // Reopen on today's engine: current, the stored leader as stored.
    expect((reopenProgram(JSON.parse(JSON.stringify(persisted)))!.view as Json).leader).toEqual(stored.leader);
    // An engine update (the card-edit turn and the scenario read serve the same `reopenProgram`): stale, no leader.
    const bumped = { ...ENGINE_VERSIONS, engine: `${ENGINE_VERSIONS.engine}-bumped` };
    const updated = reopenProgram(JSON.parse(JSON.stringify(persisted)), bumped)!.view as Json;
    expect([updated.staleness.stale, updated.face_when_stale, Object.hasOwn(updated, 'leader'), updated.leader_licence]).toEqual([true, RUN_AGAIN_AFTER_UPDATE, false, 'withheld']);
    // The model moved since the Run: stale, no leader, and the agent's read of it names none either.
    const moved = JSON.parse(JSON.stringify(persisted)) as Json;
    moved.living_model.canonical.quantities = moved.living_model.canonical.quantities.map((x: Json) => (x.id === 'base_sales' ? { ...x, value: 310, quote: 'We bake 310 loaves a week' } : x));
    const diverged = reopenProgram(moved)!.view as Json;
    expect([diverged.staleness.stale, diverged.face_when_stale, Object.hasOwn(diverged, 'leader'), diverged.leader_licence]).toEqual([true, RUN_AGAIN_FOR_CHANCE, false, 'withheld']);
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null };
    const fresh = await readProgramContext({ dispatch, proposals: new ProposalStore() }, ctx) as Json;
    expect([fresh.data.run.current, fresh.data.run.leader]).toEqual([true, { licence: 'permitted', option_id: stored.leader.goal_chance_leader, words: stored.leader.words }]);
    persisted = moved;
    const old = await readProgramContext({ dispatch, proposals: new ProposalStore() }, ctx) as Json;
    expect([old.data.run.current, Object.hasOwn(old.data.run, 'leader')]).toEqual([false, false]);
  });

  it('W6 chat: the agent can say on a later turn which option is most likely, from the Run\'s own words; the program instructions say how, and no tool description holds a choosing word', () => {
    // Round 2 (27 Oct, consolidation): the program instructions are the single owner of the leader rule; the tool descriptions
    // no longer repeat it (RUN_WORDS_RULE is gone). prompts-v2 (29 Oct): in agent-coaching.txt's words, each once, as sent.
    const rule = "Name which option is most likely to achieve the aim only when the current Run's leader explicitly licenses it, using its option label and recorded qualification.";
    expect(programInstructions().split(rule)).toHaveLength(2);
    expect(programInstructions().split('Otherwise preserve its similarity or withholding wording.')).toHaveLength(2);
    expect(programInstructions().split('Cut repetition and process narration before material caveats; say each thing once.')).toHaveLength(2);
    for (const [name, text] of Object.entries(PROGRAM_TOOL_DESCRIPTIONS)) {
      expect(text, name).not.toContain('run.leader');
      for (const banned of ['recommend', 'best', 'winner', 'you should']) expect(text.toLowerCase(), `${name}: ${banned}`).not.toContain(banned);
    }
  });

  it('step 4, save → readback → cold reopen: the canonical model and its stored Run come back byte-identical; the reopen SHOWS that Run', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect(r.model_program.write).toBe('saved');
    expect(r.model_program.readback).toMatchObject({ read: true, version: 'canonical.v1', seed_identical: true, runs_identical: true, canonical_identical: true });
    expect(persisted!.living_model.canonical).toEqual(bakery());
    const runs = persisted!.living_model.runs as Json[];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.run_id).toBe(r.model_program.run.run_id);
    expect(runs[0]!.receipt).toEqual({ revision_digest: revisionDigest(bakery(), [BRIEF]), versions: { ...ENGINE_VERSIONS }, seed: seedOf(SCENARIO), draws: RUN_DRAWS });
    expect(stableStringify(runs[0]!.result.canonical_analysis_view)).toBe(stableStringify(r.canonical_analysis_view));
    // Cold: the stored JSON alone, in a fresh module instance, shows the STORED Run: current, today's engine.
    vi.resetModules();
    const fresh = await import('../program-store.js');
    const cold = fresh.reopenProgram(JSON.parse(JSON.stringify(persisted)))!;
    expect(stableStringify(cold.view)).toBe(stableStringify(r.canonical_analysis_view));
    expect([cold.run!.run_id, cold.current, cold.engine_current]).toEqual([r.model_program.run.run_id, true, true]);
    // Contrast: a NEW evaluation on another seed gives other numbers, so what the reopen shows is the stored Run, not a recompute.
    const other = fresh.savedProgramOf(JSON.parse(JSON.stringify(persisted)))!;
    const recomputed = withNewRun({ ...other, seed: other.seed + 1 }).evaluation;
    expect(stableStringify(recomputed.view)).not.toBe(stableStringify(cold.view));
  });

  it('step 4b, an engine-version bump: the reopen still shows the ORIGINAL stored result, said as from before an update (S4: the person\'s model did not move)', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF })).json();
    const bumped = { ...ENGINE_VERSIONS, engine: `${ENGINE_VERSIONS.engine}-bumped` };
    const cold = reopenProgram(JSON.parse(JSON.stringify(persisted)), bumped)!;
    const { staleness, face_when_stale, ...result } = cold.view as Json;
    // W6 review B3: everything the Run showed, byte for byte, except that a Run not current names no leader (stored withheld here:
    // its limit is not yet checked; the permitted case is the B3 row's).
    const { staleness: was, leader: storedLeader, ...stored } = r.canonical_analysis_view as Json;
    expect(storedLeader).toMatchObject({ licence: 'withheld' });
    expect([Object.hasOwn(result, 'leader'), result.leader_licence, stored.leader_licence]).toEqual([false, 'withheld', 'withheld']);
    expect(stableStringify(result)).toBe(stableStringify(stored));
    expect([was.stale, staleness.stale, staleness.reason, face_when_stale]).toEqual([false, true, 'engine_or_format_updated', RUN_AGAIN_AFTER_UPDATE]);
    expect(RUN_AGAIN_AFTER_UPDATE).toBe('This result is from before an update. Run again to see the chance.');
    expect([cold.run!.run_id, cold.current, cold.engine_current]).toEqual([r.model_program.run.run_id, true, false]);
    expect(cold.run!.receipt.versions).toEqual({ ...ENGINE_VERSIONS });
    // What it shows is the stored bytes: a marker written into the stored Run is what comes back (a recompute would lose it).
    const marked = JSON.parse(JSON.stringify(persisted));
    marked.living_model.runs[0].result.canonical_analysis_view.options[0].cell.display = 'STORED-RUN-MARKER';
    expect((reopenProgram(marked, bumped)!.view as Json).options[0].cell.display).toBe('STORED-RUN-MARKER');
  });

  it('step 4c, the core postimage persistence projection the register applies keeps the model program byte for byte', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const postimage = registered[0]!.graph as Json;
    const stored = projectCorePostimageForPersistence(JSON.parse(JSON.stringify(postimage))) as Json;
    expect(JSON.stringify(stored.living_model)).toBe(JSON.stringify(postimage.living_model));
    expect(savedProgramOf(stored)!.runs).toHaveLength(1);
  });

  // ── STEP 2, "Check what I understood" (DL 24 Oct; the UI half is DGAI #2960, 128bd2db) ──────────────────────────────────
  const hostFieldsOf = (x: unknown) => new Set(JSON.stringify(x).match(/"(approval|author_id)":("[^"]*"|null)/g));
  const withoutHostFields = (x: unknown) => JSON.parse(JSON.stringify(x).replace(/"(approval|author_id)":("[^"]*"|null)/g, '"$1":"host"'));

  it('step 2 "Check what I understood" (1): a first draft is saved as Olumi\'s reading, every record proposed and approved by no one, whatever the drafter wrote; who authored it and in whose words are untouched', async () => {
    const m = bakery();
    // The drafter claims approvals it cannot give: on a goal, a figure, a relation and a link inside it.
    m.goals = m.goals.map((g) => ({ ...g, approval: 'approved' as const, author_id: 'someone-else' }));
    m.quantities = m.quantities.map((x) => (x.id === 'base_sales' ? { ...x, approval: 'approved' as const, author_id: 'someone-else' } : x));
    m.relations = m.relations.map((r) => (r.form === 'effect'
      ? { ...r, approval: 'approved' as const, terms: r.terms.map((x) => ({ ...x, approval: 'approved' as const, author_id: 'someone-else' })) } : r));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    expect(hostFieldsOf(saved)).toEqual(new Set(['"approval":"proposed"', '"author_id":null']));
    // Positive control: the probe sees every record's host fields (the bakery's 18 records and its one link).
    expect(JSON.stringify(saved).match(/"approval":/g)).toHaveLength(19);
    // Contrast: everything else, who authored each item and in whose words included, is the drafter's, untouched.
    expect(withoutHostFields(saved)).toEqual(withoutHostFields(m));
  });

  describe('lean draft (Paul 26 Oct, "we do not make the AI do any unnecessary, complicated work or data generation"): the drafter never writes a host-owned field', () => {
    const HOST = new Set(['approval', 'author_id']);
    /** The draft as the drafter now writes it: every approval and author_id left out, at any depth. */
    const unhosted = (m: unknown): Json => JSON.parse(JSON.stringify(m), (k, v) => (HOST.has(k) ? undefined : v));
    /** A stored model a person has approved: every record and link approved, by person-1. */
    const approvedBakery = (): CanonicalModelT => JSON.parse(JSON.stringify(bakery()).replace(/"approval":"proposed"/g, '"approval":"approved"').replace(/"author_id":null/g, '"author_id":"person-1"'));
    /** Each place a schema names a host field (a property or a required key), each object strict output would refuse, and the attributed objects walked. */
    const audit = (schema: unknown) => {
      const host: string[] = []; const loose: string[] = []; let quoted = 0;
      const walk = (node: unknown, path: string) => {
        if (node === null || typeof node !== 'object') return;
        const n = node as Json;
        if (n.type === 'object') {
          const keys = Object.keys(n.properties ?? {});
          if (keys.includes('quote')) quoted += 1;
          host.push(...keys.filter((k) => HOST.has(k)).map((k) => `${path}.properties.${k}`), ...((n.required ?? []) as string[]).filter((k) => HOST.has(k)).map((k) => `${path}.required.${k}`));
          if (n.additionalProperties !== false || JSON.stringify([...(n.required ?? [])].sort()) !== JSON.stringify([...keys].sort())) loose.push(path);
        }
        for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
      };
      walk(schema, '$');
      return { host, loose, quoted };
    };

    it('(a) neither schema the drafter is sent (first draft, update) holds approval or author_id anywhere, and each stays valid strict output', () => {
      // Positive control: the walker reaches every attributed object (each record family, the five relation forms, a link, an
      // option's setting); neither holds a history entry (W2: the host's).
      for (const [name, schema, quoted] of [['draft', CANONICAL_JSON_SCHEMA, 19], ['update', UPDATE_JSON_SCHEMA, 19]] as const) {
        const a = audit(schema);
        expect([a.host, a.loose, a.quoted], name).toEqual([[], [], quoted]);
        expect(JSON.stringify(schema), name).not.toMatch(/approval|author_id/);
      }
      // Contrast: the same walker on the STORED format finds every one: approval on 18 objects, author_id on those and the
      // history entry, each as a property and a required key.
      const stored = audit(z.toJSONSchema(CanonicalModel));
      expect([stored.host.length, stored.quoted]).toEqual([74, 20]);
      expect(stored.host).toEqual(expect.arrayContaining(['$.properties.history.items.properties.author_id', '$.properties.goals.items.properties.approval', '$.properties.goals.items.required.approval']));
    });

    it('(b) a first draft WITHOUT the host fields parses, compiles and saves with every record proposed and approved by no one; the rest is the drafter\'s, exactly', async () => {
      const bare = unhosted(bakery());
      // The probe removed them all (positive control: the stored format refuses this draft as it stands).
      expect(JSON.stringify(bare)).not.toMatch(/approval|author_id/);
      expect(CanonicalModel.safeParse(bare).success).toBe(false);
      replies = [JSON.stringify(bare)];
      const r = await turn({ message: BRIEF });
      expect(r.json().model_program.saved).toBe(true);
      expect(r.json().model_program.draft.attempts.map((x: Json) => x.errors.length)).toEqual([0]);
      const saved = persisted!.living_model.canonical as CanonicalModelT;
      expect(hostFieldsOf(saved)).toEqual(new Set(['"approval":"proposed"', '"author_id":null']));
      // The bakery's 18 records and its one link, each set by the host.
      expect(JSON.stringify(saved).match(/"approval":/g)).toHaveLength(19);
      expect(saved).toEqual(bakery());
    });

    it('(b) an update WITHOUT the host fields is merged and read as before: the record it returns takes the host\'s values, every other record is the saved one', async () => {
      const saved = approvedBakery();
      const none = { version: saved.version, question: null, period: null, coaching_questions: null, quantities: [], relations: [], goals: [], limits: [], preferences: [], options: [], risks: [], claims: [],
        evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [] };
      const link = saved.relations.find((x) => x.form === 'effect')!;
      const update = unhosted({ ...none, relations: [link] });
      expect(JSON.stringify(update)).not.toMatch(/approval|author_id/);
      const out = await proposePostimage(saved, [BRIEF], 'Keep the link as it is.', [], async () => ({ text: JSON.stringify(update), status: 'completed', incomplete: null, usage: null }));
      expect(out.attempts.map((x) => x.errors?.length ?? x.failed)).toEqual([0]);
      const back = out.model!.relations.find((x) => x.id === link.id)!;
      expect(hostFieldsOf(back)).toEqual(new Set(['"approval":"proposed"', '"author_id":null']));
      expect(withoutHostFields(out.model)).toEqual(withoutHostFields(saved));
      // Every record it did not return is the saved one, host fields included (positive control: there are such records).
      const kept = (m: CanonicalModelT) => (Object.keys(m) as (keyof CanonicalModelT)[]).filter((f) => Array.isArray(m[f]) && f !== 'history')
        .flatMap((f) => (m[f] as { id: string }[]).filter((x) => x.id !== link.id).map((x) => `${f}:${JSON.stringify(x)}`));
      expect(kept(out.model!)).toEqual(kept(saved));
      expect(kept(saved).length).toBeGreaterThan(15);
    });

    it('(c) contrast: a STORED model keeps its host fields and reads unchanged (approved, by someone); the stored format still requires them', () => {
      const approved = approvedBakery();
      expect(hostFieldsOf(approved)).toEqual(new Set(['"approval":"approved"', '"author_id":"person-1"']));
      const graph = (canonical: unknown) => ({ living_model: { model_program: MODEL_PROGRAM, canonical, seed: 1, person_words: [BRIEF], runs: [] } });
      const read = programReadOf(graph(approved));
      expect(read.kind === 'program' ? read.program.canonical : read).toEqual(approved);
      // The host fills only a draft: a stored model without them is not read as a program.
      expect(programReadOf(graph(unhosted(approved))).kind).toBe('unreadable');
      // The fill sets the host fields and nothing else.
      expect(withHostFields(approved, false)).toEqual(bakery());
    });

    it('(d) W2 (spec §3, history is host-owned): the first draft is never asked for history, and one whose output carries history anyway is saved with the host\'s alone: none yet', async () => {
      // As sent: no history in the first draft's schema or its instructions (contrast: the stored format keeps it).
      expect(JSON.stringify(CANONICAL_JSON_SCHEMA)).not.toContain('history');
      expect(DRAFTING_INSTRUCTIONS).not.toContain('history');
      expect(Object.keys((z.toJSONSchema(CanonicalModel) as Json).properties)).toContain('history');
      // The drafter writes a history of its own: an earlier figure it claims was superseded, said and approved by someone.
      const made = { id: 'base_sales', change: 'superseded', old: JSON.stringify({ ...bakery().quantities[0], value: 250 }), quote: 'We bake 300 loaves a week', author_id: 'someone-else', approved_by: 'someone-else' };
      replies = [JSON.stringify({ ...bakery(), history: [made] })];
      const r = await turn({ message: BRIEF });
      expect(r.json().model_program.saved).toBe(true);
      const saved = persisted!.living_model.canonical as CanonicalModelT;
      expect(saved.history).toEqual([]);
      // Contrast: every record is the drafter's, as before.
      expect(saved).toEqual(bakery());
      // A draft written to the sent schema (no history at all) is read the same way: the host's history, none yet.
      const { history: _none, ...asSent } = bakery();
      const out = await draftCanonicalModel(BRIEF, async () => ({ text: JSON.stringify(asSent), status: 'completed', incomplete: null, usage: null }), BRIEF, { interpret: true });
      expect(out.attempts.map((x) => x.errors?.length ?? x.failed)).toEqual([0]);
      expect(out.model!.history).toEqual([]);
    });
  });

  it('verbatim (DL 24 Oct), S1 strip (A2 off): an empty unknown slot of theirs issues the reading card; a known figure in words not theirs, or none, is no longer refused: it is shown as the AI wrote it', async () => {
    // The measured class: their figure with no figure, no question and no words, not known yet.
    const m = bakery();
    m.quantities.push(q('other_costs', 'GBP', { status: 'unknown', basis: 'Nobody has said what else the oven costs to run.', quote: null }));
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].reading).toBe(true);
    expect(r.cards[0].changes.find((c: Json) => c.id === 'other_costs')).toMatchObject({ action: 'add', author: 'person' });
    const read = (edit: (d: CanonicalModelT) => void) => { const d = bakery(); edit(d); return readingOf(d, { words: [BRIEF], approver: null }); };
    // No longer refused (A2 off): a KNOWN figure of theirs in words they did not write, one with no words, and an unknown slot
    // holding a figure. The card shows each as the AI wrote it, theirs, and their press is what accepts it.
    const shown = (r: ReturnType<typeof read>, id: string) => { expect(r.ok, JSON.stringify(r)).toBe(true); return r.ok ? r.changes.find((c) => c.id === id) : undefined; };
    expect(shown(read((d) => setQ(d, 'base_sales', { quote: 'We bake about 300 loaves' })), 'base_sales')).toMatchObject({ action: 'add', author: 'person' });
    expect(shown(read((d) => setQ(d, 'base_sales', { quote: 'We bake about 300 loaves' })), 'base_sales')!.after).toContain('in your words "We bake about 300 loaves"');
    expect(shown(read((d) => setQ(d, 'base_sales', { quote: null })), 'base_sales')).toMatchObject({ action: 'add', author: 'person' });
    expect(read((d) => { d.quantities.push(q('other_costs', 'GBP', { status: 'unknown', value: 50, basis: 'Synthetic.', quote: null })); }).ok).toBe(true);
    // One form with compile: a quote differing only in case, or in a curly quote for their straight one, is theirs, on the card
    // as in compile.
    const folded = bakery();
    setQ(folded, 'base_sales', { quote: 'WE BAKE 300 LOAVES A WEEK' });
    setQ(folded, 'budget', { quote: 'We have £3,000 to spend and don’t know' });
    expect(compile(folded, { sourceText: BRIEF }).unverified).toEqual([]);
    expect(readingOf(folded, { words: [BRIEF], approver: null }).ok).toBe(true);
    expect(read((d) => setQ(d, 'base_sales', { quote: 'We bake 300 loaves a week’' })).ok).toBe(true); // S1 strip: an extra mark is no longer refused either
  });

  it('DL 24 Oct (#3728): on the reading card a pure-number unit reads plainly ("1/oven" is "per oven"); a real unit is unchanged', () => {
    const d = bakery();
    setQ(d, 'sell_through', { unit: '1/oven' });
    const v = readingOf(d, { words: [BRIEF], approver: null }) as Json;
    expect(v.ok).toBe(true);
    const after = (id: string): string => v.changes.find((c: Json) => c.id === id).after;
    expect(after('sell_through')).toContain('from 0.5 to 0.9 per oven, most likely 0.7');
    expect(after('sell_through')).not.toContain('1/oven');
    expect(after('base_sales')).toContain('300 loaves per week');
    expect(after('budget')).toContain('£3,000');
  });

  it('alpha G2: a declared bound is said as Olumi\'s reading on the card and in the chance\'s basis; a change to it alone shows as a change', () => {
    const d = bakery();
    setQ(d, 'base_sales', { floor: 0 });
    const v = readingOf(d, { words: [BRIEF], approver: null }) as Json;
    expect(v.ok).toBe(true);
    expect(v.changes.find((c: Json) => c.id === 'base_sales').after).toBe('300 loaves per week (never below 0: Olumi’s reading), in your words "We bake 300 loaves a week"');
    // Only Olumi's reading of it changes: the card shows that figure's change alone, never refused for want of their words.
    const post = JSON.parse(JSON.stringify(d)) as CanonicalModelT;
    setQ(post, 'base_sales', { floor: null, ceiling: 1000 });
    const u = validatePostimage(d, post, { removals: [], words: [BRIEF], fresh: [] }) as Json;
    expect(u.ok, JSON.stringify(u)).toBe(true);
    expect(u.changes.filter((c: Json) => c.id === 'base_sales').map((c: Json) => [c.before, c.after])).toEqual([[
      '300 loaves per week (never below 0: Olumi’s reading)', '300 loaves per week (never above 1,000: Olumi’s reading)']]);
    // The chance's basis: Olumi's range for the promotion's effect, drawn within its declared floor, says so with the floor.
    const m = club();
    m.quantities = m.quantities.map((x) => (x.id === 'promo_effect' ? { ...x, floor: 0 } : x));
    const face = ((evaluateCanonical(m, { sourceText: CLUB_BRIEF, seed: 7 }).view as Json).options as Json[]).find((o) => o.option_id === 'promotion')!.cell.face as string;
    // Codex B1 on #3801: the floor is 3/1.56061 = 1.92 σ below the low end, inside the 4 σ the tail needs to be whole, so no
    // frequency is said (the same range with no floor keeps its 8 in 10: HALL below).
    expect(face).toContain('‘promo effect’ follows Olumi’s provisional reading of Olumi’s own estimated range, 3 to 7 members per promotion per month, '
      + 'with 5 members per promotion per month as the middle value, kept to Olumi’s reading of what it can be (never below 0 members per promotion per month)');
  });

  it('numbers#2 (spec §3.7): Olumi\'s floor on a worked-out stock is said, saved and applied; a path that keeps to it gives its chance', async () => {
    // A first draft declaring floor 0 on the members stock (worked out) and on members today (given). The club grows (300,
    // 10 more a month), so no draw leaves the floor and the chances stand.
    const m = club();
    setQ(m, 'members', { floor: 0 });
    setQ(m, 'members_now', { floor: 0 });
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: CLUB_BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    const after = (id: string): string => r.cards[0].changes.find((c: Json) => c.id === id).after;
    // W8: the worked-out stock is said on its relation's line, with Olumi's floor.
    expect(r.cards[0].changes.some((c: Json) => c.id === 'members')).toBe(false);
    expect(after('members_rel')).toBe('a running total that starts at "members now" and adds "joins" and takes away "leavers" each month, in members (never below 0: Olumi’s reading)');
    expect(after('members_now')).toBe('300 members (never below 0: Olumi’s reading), in your words "300 members today"');
    // Saved as drafted, and read so by the agent.
    const read = await readProgramContext({ dispatch, proposals: new ProposalStore() }, { scenario_id: SCENARIO, authenticated_user_id: null }) as Json;
    expect((read.data.model.quantities as Json[]).find((x) => x.id === 'members')).toMatchObject({ floor: 0 });
    // The Run carries the floor on the stock, and every chance of the stored Run is worked out (contrast to a falling path).
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    expect(compile(saved, { sourceText: CLUB_BRIEF }).executable!.quantities.find((x) => x.id === 'members')).toMatchObject({ domain: { min: 0 } });
    const stored = persisted!.living_model.runs.at(-1).result.chances as Json[];
    expect(stored.map((o) => [o.option_id, typeof o.per_goal[0].chance])).toEqual([['promotion', 'number'], ['carry_on', 'number']]);
  });

  it('the real Run tests the middle of an 80–120% range inside its declared 100% ceiling: 80%, 90%, 100%', () => {
    const m = bakery(), rangeWords = 'between 80 and 120 percent';
    m.quantities = m.quantities.map((x) => x.id === 'sell_through'
      ? { ...x, unit: '%', status: 'known', value: null, low: 80, high: 120, range_kind: 'bounds', ceiling: 100, author: 'person', quote: rangeWords, basis: null }
      : x.id === 'sales_target' ? { ...x, value: 390, quote: 'reach 390 loaves a week' }
      : x.id === 'oven_price' ? { ...x, status: 'known', value: 2500, question: null, quote: 'The oven costs £2,500' } : x);
    m.goals = m.goals.map((g) => ({ ...g, label: 'Reach 390 loaves a week', quote: 'want to reach 390 loaves a week' }));
    const source = `${BRIEF.replace('380', '390')} Sell-through is ${rangeWords}. The oven costs £2,500.`;
    const result = evaluateCanonical(m, { sourceText: source, seed: 7 });
    expect(result.sim).not.toBeNull();
    const d = (result.view as Json).options.find((o: Json) => o.option_id === 'second_oven').main_driver;
    expect(d.kind).toBe('available');
    expect(d.driver.quantity).toBe('sell_through');
    expect(d.driver.low.value).toBe(0.8);
    expect(d.driver.middle.value).toBe(0.9);
    expect(d.driver.high.value).toBe(1);
    expect(d.detail).toContain('at its middle (90%)');
    expect(d.detail).not.toContain('(120%)');
    expect(m.quantities.find((x) => x.id === 'sell_through')).toMatchObject({ low: 80, high: 120, ceiling: 100 });
  });

  it('issue 40: a first draft with an Olumi link of unknown size and a stated direction shows its reading card, the direction said as an arrow and words on what it moves', async () => {
    const m = withOlumiLinks(bakery());
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].reading).toBe(true);
    expect(r.cards[0].changes.find((c: Json) => c.id === 'lost_bake_time')).toMatchObject({ action: 'add', author: 'olumi',
      after: `no figure yet (in loaves per oven per week), ↓ lowers sales, based on "${LOST_BASIS}"` });
    // Contrast: the same link stated as raising reads so; with no direction, nothing about one is said.
    const said = (d: CanonicalQuantityT['direction']) => { const x = JSON.parse(JSON.stringify(m)) as CanonicalModelT; setQ(x, 'lost_bake_time', { direction: d });
      const v = readingOf(x, { words: [BRIEF], approver: null }); return v.ok ? v.changes.find((c) => c.id === 'lost_bake_time')!.after : v.code; };
    expect(said('raises')).toBe(`no figure yet (in loaves per oven per week), ↑ raises sales, based on "${LOST_BASIS}"`);
    expect(said(null)).toBe(`no figure yet (in loaves per oven per week), based on "${LOST_BASIS}"`);
  });

  it('issue 40 (Codex #3742): a direction on a per-unit rate written as a two-part product (one size times one driver) is kept and worded, unknown or across zero, as on an effect\'s link; times another size it is no link, and S1 strip (B3 off): its direction is kept and said alone', () => {
    const BASIS = 'Nobody has said how many loaves a new oven loses.';
    /** The draft path (read as `normalise` reads it, then the reading card): the rate's direction kept, and its card words. */
    const rated = (f: Partial<CanonicalQuantityT>, driver = 'ovens_added') => {
      const m = bakery();
      m.quantities.push(q('loss_per_oven', 'loaf/week/oven', { kind: 'coefficient', author: 'olumi', ...f }), q('extra_loss', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }));
      m.relations.push({ form: 'definition', id: 'loss_rel', defines: 'extra_loss', op: 'product', parts: [{ id: driver, power: 1 }, { id: 'loss_per_oven', power: 1 }], author: 'olumi', quote: null, ...at });
      const read = normalise(m);
      const v = readingOf(read, { words: [BRIEF], approver: null });
      return { direction: read.quantities.find((x) => x.id === 'loss_per_oven')!.direction, after: v.ok ? v.changes.find((c) => c.id === 'loss_per_oven')!.after : v.code };
    };
    expect(rated({ status: 'unknown', basis: BASIS, direction: 'lowers' }))
      .toEqual({ direction: 'lowers', after: `no figure yet (in loaves per oven per week), ↓ lowers extra loss, based on "${BASIS}"` });
    expect(rated({ status: 'estimated', low: -20, high: 10, range_kind: 'plausible', basis: BASIS, direction: 'raises' }))
      .toEqual({ direction: 'raises', after: `from -20 to 10 loaves per oven per week (a plausible range), ↑ raises extra loss, an estimate, based on "${BASIS}"` });
    // Contrast: times another size ("sell through", a coefficient) it is no per-unit rate and no link: kept as written, said alone.
    expect(rated({ status: 'unknown', basis: BASIS, direction: 'lowers' }, 'sell_through'))
      .toEqual({ direction: 'lowers', after: `no figure yet (in loaves per oven per week), ↓ lowers, based on "${BASIS}"` });
  });

  // C6 (27 Oct 2026): who approved is approved_by; author_id is who said it (the C6 rows below), no longer the approver.
  it('alpha G16: approval records WHO approved (approved_by) and never who said it: author, party and quote stay each item\'s own', () => {
    const APPROVER = 'user-7f3a';
    const draft = bakery();
    const v = readingOf(draft, { words: [BRIEF], approver: APPROVER });
    expect(v.ok, JSON.stringify(v)).toBe(true);
    if (!v.ok) return;
    const origin = (r: Json) => ({ author: r.author, party: r.party ?? null, quote: r.quote ?? null });
    for (const family of ['quantities', 'relations', 'goals', 'options'] as const) {
      const before = new Map((draft[family] as Json[]).map((r) => [r.id, r]));
      for (const r of v.model[family] as Json[]) {
        expect(origin(r), `${family}/${r.id}`).toEqual(origin(before.get(r.id)!));
        expect([r.approval, r.approved_by], `${family}/${r.id}`).toEqual(['approved', APPROVER]);
      }
    }
    // Olumi's own items stay Olumi's after a person approves them: approval is not authorship.
    expect((v.model.quantities as Json[]).filter((q) => q.author === 'olumi').length).toBeGreaterThan(0);
  });

  it('issue 40, S1 strip (B3 off): a direction the saved program holds (on a sized link, or on a figure no link has) is kept and never shows as a change nor refuses one: a saved program holding them takes an unrelated update; the AI\'s change to a direction the model uses still shows', async () => {
    const m = withOlumiLinks(bakery(), q('oven_delay', 'loaf/week/oven', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: -10, low: -20, high: -5, range_kind: 'plausible',
      basis: 'A new oven takes a few weeks to bed in.' }));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    // As a program saved before the host cleared them holds them: a direction on a sized link, and one on a figure no link has.
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    setQ(saved, 'oven_delay', { direction: 'raises' });
    setQ(saved, 'oven_price', { direction: 'lowers' });
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'We now bake 320 loaves a week, our baker says.';
    const propose = async (edit: (d: CanonicalModelT) => void) => {
      replies = [savedWith(edit)];
      return await proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
        { public_label: 'Base sales', basis: 'their words', request: 'Base sales are now 320 a week.', remove: [] }) as Json;
    };
    const sales = (d: CanonicalModelT) => setQ(d, 'base_sales', { value: 320, quote: 'We now bake 320 loaves a week' });
    const p = await propose(sales);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(p.data.changes).toEqual([{ id: 'base_sales', kind: 'quantity', action: 'change', label: 'base sales', before: '300 loaves per week, in your words "We bake 300 loaves a week"',
      after: '320 loaves per week, in your words "We now bake 320 loaves a week"', author: 'person', family: 'quantity' }]);
    // Contrast: the AI's own change to a direction the model uses (a linked size with no figure) is on the card.
    const flipped = await propose((d) => { sales(d); setQ(d, 'lost_bake_time', { direction: 'raises' }); });
    expect(flipped.status, JSON.stringify(flipped)).toBe('ok');
    expect(flipped.data.changes.map((c: Json) => c.id)).toEqual(['base_sales', 'lost_bake_time']);
    expect(flipped.data.changes[1]).toMatchObject({ action: 'change', before: 'no figure yet (in loaves per oven per week), ↓ lowers sales', after: 'no figure yet (in loaves per oven per week), ↑ raises sales' });
  });

  /** Issue 40 (marketing-r3): the bakery with Olumi's link of unknown size and a stated direction, saved; an update the AI writes on it. */
  const linkUpdate = async () => {
    replies = [JSON.stringify(withOlumiLinks(bakery()))];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'Leave the lost baking time out of sales for now.';
    return { deps, propose: async (edit: (d: CanonicalModelT) => void) => {
      replies = [savedWith(edit)];
      return await proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
        { public_label: 'Lost baking time', basis: 'their words', request: words, remove: [] }) as Json;
    } };
  };
  /** The size's own entry when its direction goes: said on what it moved, before. */
  const SIZE_SIGN_GOES = { id: 'lost_bake_time', kind: 'quantity', action: 'change', label: 'lost bake time', before: 'no figure yet (in loaves per oven per week), ↓ lowers sales', after: 'no figure yet (in loaves per oven per week)', author: 'olumi', family: 'quantity' };

  it('issue 40 (marketing-r3), S1 strip (B3 off): unlinking a link sized by Olumi\'s unknown with a stated direction, the size kept, is on the card and saved, its direction kept as the AI wrote it', async () => {
    const { deps, propose } = await linkUpdate();
    // The link taken off sales, its size kept as saved, direction and all: the host clears nothing, so only the link changes.
    const p = await propose((d) => { d.relations = d.relations.map((r) => (r.form === 'effect' ? { ...r, terms: r.terms.filter((t) => t.coefficient !== 'lost_bake_time') } : r)); });
    expect(p.status, JSON.stringify(p)).toBe('ok');
    const LINKS = 'starts from "base sales" and changes by "sold per oven" for each "ovens added"';
    expect(p.data.changes).toEqual([{ id: 'sales_rel', kind: 'relation', action: 'change', label: 'sales',
      before: `${LINKS}, and by "lost bake time" for each "ovens added"`, after: `${LINKS}, no link 2`, author: 'olumi', family: 'relation' }]);
    // Approved, the unlink is saved: the size kept, with its direction, and the link gone.
    expect(await applyProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    expect(saved.quantities.find((x) => x.id === 'lost_bake_time')).toMatchObject({ status: 'unknown', author: 'olumi', basis: LOST_BASIS, direction: 'lowers' });
    expect(saved.relations.find((r) => r.id === 'sales_rel')).toMatchObject({ terms: [{ driver: 'ovens_added', coefficient: 'sold_per_oven' }] });
  });

  it('issue 40 (marketing-r3, the negative kept): the AI dropping the direction of a link that stays drawn is its change, and the card must say it', async () => {
    const { propose } = await linkUpdate();
    const dropped = await propose((d) => setQ(d, 'lost_bake_time', { direction: null }));
    expect(dropped.status, JSON.stringify(dropped)).toBe('ok');
    expect(dropped.data.changes).toEqual([SIZE_SIGN_GOES]);
  });

  // Strip (Paul 26 Oct; B3c removed): the canvas edit no longer clears the direction the drafter stated; it passes as written.
  it('issue 40 (B3c removed): a figure typed on the canvas is theirs, and the direction stated for the size it replaces is kept as the drafter wrote it', async () => {
    replies = [JSON.stringify(withOlumiLinks(bakery()))];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    // A saved program's stray direction (on a figure no link has) is the host's to clear, on both sides: never on this card.
    setQ(persisted!.living_model.canonical as CanonicalModelT, 'oven_price', { direction: 'lowers' });
    // A range across zero with no most likely figure: the one figure a stated direction would still decide, so only the edit clears it.
    const r = await applyCanvasFigure({ dispatch }, SCENARIO, { target: { quantity_id: 'lost_bake_time' }, value: null, low: -5, high: 10, operation_key: randomUUID(), approver: null });
    expect(r.status, JSON.stringify(r)).toBe('saved');
    expect(r.changes!.map((c) => c.id)).toEqual(['lost_bake_time']);
    const change = r.changes!.find((c) => c.id === 'lost_bake_time')!;
    expect(change.before).toContain('no figure yet (in loaves per oven per week), ↓ lowers sales');
    expect(change.after).toMatch(/^from -5 to 10 loaves per oven per week/);
    expect(change.after).toContain('↓ lowers sales');
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'lost_bake_time')).toMatchObject({ low: -5, high: 10, author: 'person', direction: 'lowers' });
  });

  it('issue 40 (the system): every field of the model and of every canonical record family is said on the card, or is a named exemption; a new field with neither fails here', () => {
    /** The fields the card never compares, each with why. */
    const EXEMPT: Record<string, string> = {
      id: 'the change\'s own id: the card entry is keyed by it (postimage `bare`)',
      approval: 'host-owned, at any depth (postimage HOST_FIELDS)',
      // C6 (27 Oct 2026): who approved it, apart from who said it.
      approved_by: 'host-owned, at any depth (postimage HOST_FIELDS)',
      author_id: 'host-owned, at any depth (postimage HOST_FIELDS)',
    };
    const exemptAs = (path: string) => (path === 'id' ? 'id' : ['approval', 'approved_by', 'author_id'].find((k) => path === k || path.endsWith(`.${k}`)));
    const defOf = (s: z.ZodType) => s._zod.def as Record<string, any>;
    /** Every field of a schema, as the card's diff names it: records key by key, a list's entries as `*`. */
    const fields = (s: z.ZodType, path = ''): string[] => {
      const def = defOf(s);
      const at = (k: string) => (path === '' ? k : `${path}.${k}`);
      switch (def.type) {
        case 'object': return Object.entries(def.shape as Record<string, z.ZodType>).flatMap(([k, v]) => fields(v, at(k)));
        case 'array': return fields(def.element, at('*'));
        case 'nullable': case 'optional': case 'default': return fields(def.innerType, path);
        case 'union': return [...new Set((def.options as z.ZodType[]).flatMap((o) => fields(o, path)))];
        case 'string': case 'number': case 'boolean': case 'enum': case 'literal': case 'null': return [path];
        default: throw new Error(`the field walker does not know a ${String(def.type)} at ${path || 'the top'}`);
      }
    };
    const shape = CanonicalModel.shape as Record<string, z.ZodType>;
    const ROOT_EXEMPT: Record<string, string> = { version: 'one fixed value: the format allows no other', history: 'host-owned: appended by the host, never compared',
      // Titles (Paul, approved 27 Oct): the first draft's framing; an update never returns it.
      title: 'the first draft\'s: an update never returns it (CanonicalUpdate omits it), so no change carries it' };
    // The model's own fields the card says as their own entry (Codex #3742). Box 2 (Paul Q1/Q2, 28 Oct): Olumi's coaching
    // questions moved here from the exemptions: an update now returns the whole new list when it makes them out of date.
    const ROOT_SAID = ['question', 'period', 'coaching_questions'];
    const families = Object.keys(shape).filter((k) => defOf(shape[k]!).type === 'array' && ROOT_EXEMPT[k] === undefined && !ROOT_SAID.includes(k));
    expect(families.sort()).toEqual(Object.keys(GROUPS).sort());
    const unsaid = (family: string, schema: z.ZodType) => fields(schema).filter((p) => GROUPS[family as keyof typeof GROUPS][p] === undefined && exemptAs(p) === undefined);
    const element = (family: string): z.ZodType => defOf(shape[family]!).element;
    expect(families.flatMap((f) => unsaid(f, element(f)).map((p) => `${f}.${p}`))).toEqual([]);
    // Positive controls: the walker sees nested and listed fields, at magnitude, and every exemption is used.
    const all = families.flatMap((f) => fields(element(f)).map((p) => `${f}.${p}`));
    expect(all.length).toBeGreaterThan(150);
    expect(all).toEqual(expect.arrayContaining(['quantities.direction', 'relations.terms.*.coefficient', 'relations.terms.*.approval', 'goals.measure.window.origin_offset', 'options.sets.*.starts_after_periods', 'claims.concerns.*']));
    expect(Object.keys(EXEMPT).filter((k) => !all.some((p) => exemptAs(p.slice(p.indexOf('.') + 1)) === k))).toEqual([]);
    // Contrast: a field the card has no words for is caught.
    expect(unsaid('quantities', (element('quantities') as z.ZodObject).extend({ new_field: z.string() }))).toEqual(['new_field']);
    // The model's own fields (Codex #3742): each is a record family above, one the card says as its own entry, or exempt.
    const unsaidRoot = (keys: readonly string[]) => keys.filter((k) => !families.includes(k) && !ROOT_SAID.includes(k) && ROOT_EXEMPT[k] === undefined);
    expect(unsaidRoot(Object.keys(shape))).toEqual([]);
    expect(Object.keys(ROOT_EXEMPT).filter((k) => !(k in shape))).toEqual([]);
    // Each one the card says is said: changed alone, it is the card's one entry.
    for (const [k, v] of [['question', 'Should the bakery buy two more ovens?'], ['period', 'month']] as const) {
      const r = validatePostimage(bakery(), { ...bakery(), [k]: v }, { removals: [], words: [BRIEF], fresh: [] });
      expect(r.ok ? r.changes.map((c) => [c.id, c.after]) : r.code).toEqual([[k, v]]);
    }
    const coached = validatePostimage(bakery(), { ...bakery(), coaching_questions: ['Who else must agree?'] }, { removals: [], words: [BRIEF], fresh: [] });
    expect(coached.ok ? coached.changes.map((c) => [c.id, c.after]) : coached.code).toEqual([['coaching_questions', '1. Who else must agree?']]);
    // Contrast: a field of the model's own with neither is caught.
    expect(unsaidRoot(Object.keys(CanonicalModel.extend({ new_unlisted_field: z.string() }).shape))).toEqual(['new_unlisted_field']);
  });

  it('step 2 "Check what I understood" (2–5): after the first save ONE held card reads the draft back, every item an add, goals first and figures last, a left-out item by its why; its approve is "Yes, that’s what I meant"; its model is the draft accepted, with a new Run of the same numbers; it is carried on reload and saved by its approve', async () => {
    const m = bakery();
    m.left_out.push({ id: 'staff_morale', text: 'Staff morale while the second oven beds in', why: 'It has no measure in this model.', question: null, concerns: [], author: 'olumi', quote: null, ...at },
      { id: 'longer_shifts', text: 'Longer shifts for the staff', why: 'It is not measured in this model', question: 'How will staff feel?', concerns: ['more_loaves', 'second_oven'],
        author: 'person', quote: 'Our staff may not like longer shifts', ...at },
      { id: 'delivery_days', text: 'Which days flour is delivered', why: 'Nobody has said how it changes sales', question: null, concerns: [],
        author: 'person', ...at, party: 'Our supplier', quote: 'deliveries only on weekdays' });
    replies = [JSON.stringify(m)];
    const drafted = await turn({ message: `${BRIEF} Our staff may not like longer shifts. Our supplier says deliveries only on weekdays.` });
    expect(drafted.statusCode, drafted.body).toBe(200);
    const r = drafted.json();
    expect(r.model_program.saved).toBe(true);
    expect(callKinds()).toEqual([false, true]); // the drafter, then the AI's reply (T1): the card is the host's, with no call of its own
    expect(registered).toHaveLength(1); // the card saves nothing
    expect(r.cards).toHaveLength(1);
    const card = r.cards[0];
    // (4) CEE's own flag, the literal true; (5) the approve in the person's voice, and every card's "Not now".
    expect(card.reading).toBe(true);
    expect(card.approve_action).toMatchObject({ label: 'Yes, that’s what I meant', message: 'Yes, that’s what I meant.' });
    expect(card.decline_action).toMatchObject({ label: 'Not now', message: 'Not now.' });
    // (2) Every record an add, in the reading order: goals, limits, options, what is left out, relations, then the figures.
    expect(card.changes.map((c: Json) => [c.kind, c.id, c.action, c.before])).toEqual([
      ['goal', 'more_loaves', 'add', null], ['record', 'within_budget', 'add', null], ['option', 'second_oven', 'add', null], ['option', 'keep_one', 'add', null],
      ['left_out', 'staff_morale', 'add', null], ['left_out', 'longer_shifts', 'add', null], ['left_out', 'delivery_days', 'add', null], ['relation', 'sold_rel', 'add', null], ['relation', 'sales_rel', 'add', null], ['relation', 'spend_rel', 'add', null],
      ['quantity', 'base_sales', 'add', null], ['quantity', 'ovens_added', 'add', null], ['quantity', 'one_oven', 'add', null], ['quantity', 'extra_per_oven', 'add', null],
      ['quantity', 'sell_through', 'add', null], ['quantity', 'sales_target', 'add', null],
      ['quantity', 'budget', 'add', null], ['quantity', 'oven_price', 'add', null]]);
    // W8 (c7.1, c7.7): a worked-out figure is said on its relation's line, never as a second line of the same name.
    for (const id of ['sold_per_oven', 'sales', 'spend']) expect(card.changes.some((c: Json) => c.id === id), id).toBe(false);
    // (7) Alpha G13: each row's group, and the first reply's one line counting the same rows (11 theirs in their words, Olumi's
    // sell-through estimate, the 3 left-out notes; its workings, structure and the asked oven price are in no count).
    expect(card.changes.map((c: Json) => [c.id, c.group])).toEqual([
      ['more_loaves', 'used'], ['within_budget', 'used'], ['second_oven', 'used'], ['keep_one', 'used'], ['staff_morale', 'left_out'], ['longer_shifts', 'left_out'],
      ['delivery_days', 'left_out'], ['sold_rel', 'other'], ['sales_rel', 'used'], ['spend_rel', 'other'], ['base_sales', 'used'], ['ovens_added', 'used'], ['one_oven', 'used'],
      ['extra_per_oven', 'used'], ['sell_through', 'inferred'], ['sales_target', 'used'], ['budget', 'used'],
      ['oven_price', 'other']]);
    expect(r.assistant_text).toBe(DEFAULT_AGENT_REPLY); // the first reply is the AI's (T1); the host's count line is read at the end
    // (6) The kinds the card reads, spelled as DGAI's proposalChangeSchema has them at 128bd2db (left_out added there first).
    expect(ProposalChangeSchema.shape.kind.options).toEqual(['quantity', 'relation', 'goal', 'option', 'risk', 'record', 'left_out']);
    // (3) A left-out item: its words are the label, and `after` is its substance in plain words, its why first (the card
    // reads "Leaves out ‘…’ (after)"); every part it has is said, and none it lacks.
    expect(card.changes[5]).toEqual({ id: 'longer_shifts', kind: 'left_out', action: 'add', label: 'Longer shifts for the staff', before: null,
      after: 'It is not measured in this model. Olumi asks: “How will staff feel?”. It concerns Reach 380 loaves a week and A second oven. Your words: “Our staff may not like longer shifts”',
      author: 'person', group: 'left_out', family: 'left_out' });
    // Words the person reports from someone else name that someone first, and stay the person's own words (W8 faithful, dev H03:
    // "in CFO’s words" over their own sentence about the CFO was false attribution).
    expect(card.changes[6]).toEqual({ id: 'delivery_days', kind: 'left_out', action: 'add', label: 'Which days flour is delivered', before: null,
      after: 'Nobody has said how it changes sales. From Our supplier, in your words: “deliveries only on weekdays”', author: 'person', group: 'left_out', family: 'left_out' });
    // Contrast: a left-out item with only its why says only its why, as written.
    expect(card.changes[4]).toEqual({ id: 'staff_morale', kind: 'left_out', action: 'add', label: 'Staff morale while the second oven beds in', before: null,
      after: 'It has no measure in this model.', author: 'olumi', group: 'left_out', family: 'left_out' });
    expect(card.changes[0]).toEqual({ id: 'more_loaves', kind: 'goal', action: 'add', label: 'Reach 380 loaves a week', before: null, after: '"sales" at least "sales target" 380 loaves per week, the measure you named, in your words "want to reach 380 loaves a week"', author: 'person' , group: 'used', family: 'goal' });
    // The held card's model: the saved draft accepted by its approver (a guest here), authorship and words untouched; a new Run.
    const held = agentProposalOf([...turnRows.values()].at(-1).pending_actions[0])!;
    expect(held.proposal_id).toBe(card.proposal_id);
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    const confirmed = savedProgramOf({ living_model: held.living_model })!;
    expect(hostFieldsOf(confirmed.canonical)).toEqual(new Set(['"approval":"approved"', '"author_id":null']));
    expect(withoutHostFields(confirmed.canonical)).toEqual(withoutHostFields(saved));
    expect(confirmed.runs).toHaveLength(2);
    expect(confirmed.runs[0]).toEqual(persisted!.living_model.runs[0]);
    // Approval is in the Run's digest, so it is a new revision; on the same seed its numbers are the draft Run's exactly.
    expect(confirmed.runs[1]!.receipt.revision_digest).not.toBe(confirmed.runs[0]!.receipt.revision_digest);
    expect(confirmed.runs[1]!.result.chances).toEqual(confirmed.runs[0]!.result.chances);
    expect(JSON.stringify(confirmed.runs[0]!.result.chances)).toMatch(/[0-9]/);
    // Carried on reload: a later turn (a Run press, no drafter call; its reply is the AI's, T1) still offers the same card, flagged.
    const later = (await turn({ message: 'Run the analysis', chip: { id: 'run', action_type: 'run_analysis', label: 'Run' } })).json();
    expect(later.cards.map((c: Json) => [c.proposal_id, c.reading, c.approve_action.label])).toEqual([[card.proposal_id, true, 'Yes, that’s what I meant']]);
    expect(later.cards[0].changes).toEqual(card.changes);
    expect(callKinds()).toEqual([false, true, true]);
    // Its approve saves exactly that model and Run (the existing approve path), and the card is no longer waiting.
    const deps = { dispatch, proposals: new ProposalStore() };
    deps.proposals.put(held);
    expect(await applyProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, held.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(stableStringify(persisted!.living_model)).toBe(stableStringify(held.living_model));
    // (7) The host's own count line (kept in turn.ts, unwired since T1) counts the same rows, for the same draft.
    beforeEachReset();
    replies = [JSON.stringify(m)];
    expect((await hostTurn(`${BRIEF} Our staff may not like longer shifts. Our supplier says deliveries only on weekdays.`)).assistant_text.split('\n\n')[1]).toBe('I used 11 things from your brief, added 1 of my own for you to check, and left 3 out of the calculation.');
  });

  // ── D4: per-item approval on the reading card: the ticked rows, ONE checked write, no AI call ─────────────────────────
  describe('D4: the reading card\'s ticked rows', () => {
    const recordsOf = (m: CanonicalModelT) => (['quantities', 'relations', 'goals', 'limits', 'preferences', 'options', 'risks', 'claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out'] as const)
      .flatMap((f) => (m[f] as readonly { id: string; author: string; approval: string; author_id: string | null }[]).map((r) => [r.id, r] as const));
    const approvals = () => Object.fromEntries(recordsOf(persisted!.living_model.canonical as CanonicalModelT).map(([id, r]) => [id, r.approval]));
    const drafted = async () => {
      replies = [JSON.stringify(bakery())];
      const r = await turn({ message: BRIEF });
      expect(r.statusCode, r.body).toBe(200);
      return r.json().cards[0] as Json;
    };
    const tick = (card: Json, ids: unknown, extra: Json = {}) => turn({ message: 'Confirm ticked.', chip: card.approve_action, approve_ids: ids, ...extra });

    it('W7 (assessor 01:15Z): a ticked row approves every record the card says on it (a worked-out figure on its relation\'s row); an unticked row\'s stay proposed', async () => {
      const card = await drafted();
      const rowOf = foldedInto(persisted!.living_model.canonical as CanonicalModelT);
      // The bakery's spend is worked out on the spend relation's row; it has no row of its own.
      expect(rowOf.get('spend')).toBe('spend_rel');
      expect(card.changes.some((c: Json) => c.id === 'spend')).toBe(false);
      const res = await tick(card, ['spend_rel']);
      expect(res.statusCode, res.body).toBe(200);
      expect(approvals()).toMatchObject({ spend_rel: 'approved', spend: 'approved', sales_rel: 'proposed', sales: 'proposed' });
    });

    it('a partial approval saves exactly the ticked ids (an Olumi estimate stays Olumi\'s), the rest stay proposed, with no AI call; the card is offered again for what is open; it survives a cold reopen and a resend', async () => {
      const card = await drafted();
      const before = persisted!.living_model.canonical as CanonicalModelT;
      // Counted from before the tick: the first draft now opens its own Conversation (staging f49f50e1); the tick opens none.
      const [calls, conversations, writes] = [sent.length, creates.length, registered.length];
      const turnId = randomUUID();
      const res = await tick(card, ['sell_through', 'more_loaves'], { turn_id: turnId });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      // No AI call and no Conversation; ONE write, receipted as the person's.
      expect([sent.length, creates.length, registered.length]).toEqual([calls, conversations, writes + 1]);
      expect(registered.at(-1)!.expected_graph_identity_hash).toBe(computeGraphIdentityHash(registered.at(-2)!.graph as never)!.value);
      expect(body.receipts.map((x: Json) => x.authorised_by)).toEqual(['person']);
      // Exactly those two are approved; every other record is still Olumi's reading, proposed.
      const ids = card.changes.map((c: Json) => c.id) as string[];
      // Every record is a row or said on one (a worked-out figure on its relation's row); only the ticked rows' are approved.
      const rowOf = foldedInto(before);
      expect(Object.keys(approvals()).sort()).toEqual([...ids, ...rowOf.keys()].sort());
      expect(approvals()).toEqual(Object.fromEntries(Object.keys(approvals()).map((id) => [id, ['sell_through', 'more_loaves'].includes(rowOf.get(id) ?? id) ? 'approved' : 'proposed'])));
      const saved = persisted!.living_model.canonical as CanonicalModelT;
      // Approval is not authorship: Olumi's estimate is still Olumi's, the person's goal still theirs, in their words.
      expect(saved.quantities.find((x) => x.id === 'sell_through')).toMatchObject({ author: 'olumi', quote: null, approval: 'approved', author_id: null });
      expect(saved.goals.find((g) => g.id === 'more_loaves')).toMatchObject({ author: 'person', quote: before.goals.find((g) => g.id === 'more_loaves')!.quote, approval: 'approved' });
      // Nothing else moved: the model but for the host's own fields is the draft's, and the drafted Run is kept, a new one after it.
      expect(withoutHostFields(saved)).toEqual(withoutHostFields(before));
      expect(persisted!.living_model.runs).toHaveLength(2);
      expect(persisted!.living_model.runs[0]).toEqual(registered[0]!.graph.living_model.runs[0]);
      expect(body.assistant_text).toBe(`Saved: 2 items confirmed. ${ids.length - 2} still to check.`);
      // Offered again, for the open rows only, in the card's order, on the new model.
      expect(body.cards.map((c: Json) => [c.reading, c.approve_action.label])).toEqual([[true, 'Yes, that’s what I meant']]);
      expect(body.cards[0].proposal_id).not.toBe(card.proposal_id);
      expect(body.cards[0].changes).toEqual(card.changes.filter((c: Json) => !['sell_through', 'more_loaves'].includes(c.id)));
      const held = agentProposalOf([...turnRows.values()].at(-1).pending_actions[0])!;
      expect(held.base_model_identity).toBe(computeGraphIdentityHash(persisted as never)!.value);
      const whole = savedProgramOf({ living_model: held.living_model })!.canonical;
      // Its approve would accept the open rows; the two approved now keep who approved them.
      expect(withoutHostFields(whole)).toEqual(withoutHostFields(saved));
      expect(new Set(Object.values(Object.fromEntries(recordsOf(whole).map(([id, r]) => [id, r.approval]))))).toEqual(new Set(['approved']));
      // A cold reopen: the stored model and Run come back as saved, the Run current; a later turn carries the same card.
      const cold = reopenProgram(JSON.parse(JSON.stringify(persisted)))!;
      expect([cold.current, cold.run!.run_id]).toEqual([true, persisted!.living_model.runs[1].run_id]);
      const later = (await turn({ message: 'Run the analysis', chip: { id: 'run', action_type: 'run_analysis', label: 'Run' } })).json();
      // A Run press while the card waits answers in the conversation (one AI call on staging f49f50e1); the ticks around it call none.
      const callsAfterRun = sent.length;
      expect(later.cards.map((c: Json) => c.proposal_id)).toEqual([body.cards[0].proposal_id]);
      expect(approvals()).toEqual(Object.fromEntries(Object.keys(approvals()).map((id) => [id, ['sell_through', 'more_loaves'].includes(rowOf.get(id) ?? id) ? 'approved' : 'proposed'])));
      // The same press resent is that press: replayed, never a second write.
      const replay = await tick(card, ['sell_through', 'more_loaves'], { turn_id: turnId });
      expect([replay.statusCode, replay.json().durability, registered.length, sent.length]).toEqual([200, 'replayed', writes + 1, callsAfterRun]);
      // C7 (PL 02:18Z): its receipt is the original's version, found by these rows' own operation on the card, never none (the
      // history adds the registration turn id this harness's register reply does not carry).
      const receiptOf = (r: Json) => ({ version_id: r.version_id, version: r.version, mutation_id: r.mutation_id, authorised_by: r.authorised_by });
      expect(body.receipts).toHaveLength(1);
      expect(replay.json().receipts.map(receiptOf)).toEqual(body.receipts.map(receiptOf));
      // The rest ticked on the card offered again: all approved, no card left, still no AI call.
      const rest = await tick(body.cards[0], ids.filter((id) => !['sell_through', 'more_loaves'].includes(id)));
      expect(rest.statusCode, rest.body).toBe(200);
      expect([rest.json().cards, rest.json().assistant_text, sent.length, registered.length]).toEqual([[], `Saved: ${ids.length - 2} items confirmed.`, callsAfterRun, writes + 2]);
      expect(new Set(Object.values(approvals()))).toEqual(new Set(['approved']));
      expect(withoutHostFields(persisted!.living_model.canonical)).toEqual(withoutHostFields(before));
    });

    it('C8 (PL 02:18Z): a guest\'s ticked rows that saved with no version, then lost the reply, are that save, found by its own registration row; never a second write (contrast: with no row read, unknown)', async () => {
      await drafted();
      const held = agentProposalOf([...turnRows.values()].at(-1).pending_actions[0])!;
      const proposals = new ProposalStore();
      proposals.put(held);
      const rows = new Map<string, Json>();
      // The register lands and writes its own row, as a guest's save does (no version; the `#saved` carrier), then the reply is lost.
      const guestLostAck: typeof dispatch = async (path, body) => {
        if (path.endsWith('/graph/register')) {
          await dispatch(path, body);
          rows.set(registrationTurnId(SCENARIO, String((body as Json).operation_id)), { request_hash: registrationRequestHash(persisted, undefined), model_version_created: false });
          throw new Error('socket hang up');
        }
        if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
        return dispatch(path, body);
      };
      const readTurn = async (_sid: string, id: string) => (rows.get(id) ?? null) as never;
      const writes = registered.length;
      const contrast = await approveReadingRows({ dispatch: guestLostAck, proposals }, { scenario_id: SCENARIO, authenticated_user_id: null }, { proposalId: held.proposal_id, ids: ['sell_through'] });
      expect(contrast.outcome.status).toBe('unavailable');
      expect(registered).toHaveLength(writes + 1);
      // The same press, from the model before it, with the row read: that save, by its own row; still one write.
      registered.pop(); persisted = JSON.parse(JSON.stringify(registered.at(-1)!.graph)); rows.clear();
      const out = await approveReadingRows({ dispatch: guestLostAck, proposals, readTurn }, { scenario_id: SCENARIO, authenticated_user_id: null }, { proposalId: held.proposal_id, ids: ['sell_through'] });
      expect(out.outcome).toMatchObject({ status: 'ok', data: { already_saved: true, receipt: { kind: 'unversioned', scenario_revision: computeGraphIdentityHash(persisted as never)!.value } } });
      expect(registered).toHaveLength(writes + 1);
      expect(approvals()).toMatchObject({ sell_through: 'approved', more_loaves: 'proposed' });
    });

    it('a record already approved is never approved again, so who approved it stays: refused by its id, nothing written', async () => {
      const card = await drafted();
      expect((await tick(card, ['sell_through'])).statusCode).toBe(200);
      // A card that still lists it, held on the model as it now is (the route never offers one; this binds the write's own check).
      const proposals = new ProposalStore();
      const p = holdProgramCard(proposals, { scenarioId: SCENARIO, userId: null, graphHash: hashOf(persisted), identity: computeGraphIdentityHash(persisted as never)!.value },
        { label: 'x', basis: 'x', program: savedProgramOf({ living_model: persisted!.living_model })!, changes: card.changes, reading: true });
      const writes = registered.length;
      const out = await approveReadingRows({ dispatch, proposals }, { scenario_id: SCENARIO, authenticated_user_id: null }, { proposalId: p.proposal_id, ids: ['sell_through', 'more_loaves'] });
      expect(out.outcome).toMatchObject({ status: 'refused', reason: 'not_proposed', data: { ids: ['sell_through'] } });
      expect(registered).toHaveLength(writes);
      // Contrast: the open one alone, on the same card, saves.
      expect((await approveReadingRows({ dispatch, proposals }, { scenario_id: SCENARIO, authenticated_user_id: null }, { proposalId: p.proposal_id, ids: ['more_loaves'] })).outcome).toMatchObject({ status: 'ok', data: { saved: true } });
    });

    it('a stale base is refused: the model moved since the card was offered, so nothing is saved (contrast: the same press on the unmoved model saves)', async () => {
      const card = await drafted();
      const moved = await applyCanvasFigure({ dispatch }, SCENARIO, { target: { quantity_id: 'base_sales' }, value: 320, operation_key: randomUUID(), approver: null });
      expect(moved.status).toBe('saved');
      const [snapshot, writes, calls] = [JSON.stringify(persisted), registered.length, sent.length];
      const res = await tick(card, ['sell_through']);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().error).toMatchObject({ code: 'SUPERSEDED', nothing_saved: true });
      expect([JSON.stringify(persisted), registered.length, sent.length]).toEqual([snapshot, writes, calls]);
    });

    it('only the card\'s own rows, only with its press, never widened to the whole card: an id off the card, an empty or repeated list, or ids with no press are refused with nothing saved; the card\'s own words with ids approve only those ids', async () => {
      const card = await drafted();
      const [snapshot, writes, calls] = [JSON.stringify(persisted), registered.length, sent.length];
      const off = await tick(card, ['sell_through', 'not_on_the_card']);
      expect([off.statusCode, off.json().error.code]).toEqual([409, 'CARD_NOT_WAITING']);
      for (const bad of [[], ['sell_through', 'sell_through'], 'sell_through', [7]]) expect((await tick(card, bad)).statusCode).toBe(422);
      expect((await turn({ message: 'Confirm ticked.', approve_ids: ['sell_through'] })).statusCode).toBe(422);
      expect([JSON.stringify(persisted), registered.length, sent.length]).toEqual([snapshot, writes, calls]);
      // The card's own approve words, with ids: those ids only, by the host, no AI call (never the whole card's apply_change).
      const res = await tick(card, ['sell_through'], { message: card.approve_action.message });
      expect(res.statusCode, res.body).toBe(200);
      expect([sent.length, registered.length]).toEqual([calls, writes + 1]);
      expect(Object.entries(approvals()).filter(([, a]) => a === 'approved').map(([id]) => id)).toEqual(['sell_through']);
    });
  });

  // ── The card in plain words (DL 24 Oct, after the staging reading card): one phrase per item, no keys or codes ─────────
  /** Text outside quoted words (their words and labels may hold anything). */
  const outsideQuotes = (x: string) => x.replace(/"[^"]*"/g, '"…"').replace(/“[^”]*”/g, '“…”');
  /** Every way the card used to read as a form: "key: value", a raw operator or code, or a "whose:" line. */
  const formLike = (x: string): string[] => {
    const o = outsideQuotes(x).replace(/Olumi asks: “…”/g, '').replace(/words: “…”/g, '');
    return [...(o.includes(':') ? ['a key: value pair'] : []), ...(/>=|<=|(^|\s)[<>](\s|$)/.test(o) ? ['a raw operator'] : []), ...(/whose/i.test(o) ? ['whose'] : []),
      ...(/\b[a-z]+_[a-z_]+\b/.test(o) ? ['a code'] : []), ...(o.includes(';') ? ['a semicolon'] : [])];
  };

  it('the card in plain words (DL 24 Oct): every item of four drafts (the served capacity reading among them) reads as one phrase, with no key: value pair, raw operator, code or "whose", and its author only as the card\'s mark', () => {
    const saved = (file: string) => savedDraft(file);
    const hiring = saved('./hiring-alpha3.saved.json');
    // The capacity draft exactly as the served reading-card run saved it (scenario fc9ab632, CEE 1fd6f8cb): its 14 entries.
    const capacity = saved('./capacity-s4.saved.json');
    const drafts: [string, CanonicalModelT, string][] = [['bakery', bakery(), BRIEF], ['club', club(), CLUB_BRIEF], ['hiring', hiring.canonical, hiring.brief],
      ['capacity', capacity.canonical, capacity.brief]];
    let entries = 0;
    for (const [name, model, brief] of drafts) {
      const v = readingOf(model, { words: [brief], approver: null });
      // Every field of every item has its words: the reading is refused otherwise (no field is hidden to read plainly).
      expect(v.ok, `${name}: ${JSON.stringify(v)}`).toBe(true);
      if (!v.ok) continue;
      for (const c of v.changes) {
        entries += 1;
        expect(formLike(c.after ?? ''), `${name} ${c.id}: ${c.after}`).toEqual([]);
        // Theirs or Olumi's is the card's mark (changes[].author), never said again as a part of the phrase.
        expect((c.after ?? '').split(', ').filter((p) => p === 'yours' || p === 'Olumi’s'), `${name} ${c.id}`).toEqual([]);
      }
    }
    // W8: a worked-out figure is read on its relation's line and an option's own setting on its option's line (11 lines fewer).
    expect(entries).toBe(69); // positive control: 16 bakery + 16 club + the hiring and capacity items read
    // The words, spelled, for one item of each kind the bakery has.
    const reading = readingOf(bakery(), { words: [BRIEF], approver: null });
    const said = new Map((reading.ok ? reading.changes : []).map((c) => [c.id, c.after] as const));
    expect(Object.fromEntries(['more_loaves', 'within_budget', 'second_oven', 'keep_one', 'sold_rel', 'sales_rel', 'spend_rel', 'sell_through', 'oven_price', 'sales'].map((id) => [id, said.get(id)])))
      .toEqual({
        more_loaves: '"sales" at least "sales target" 380 loaves per week, the measure you named, in your words "want to reach 380 loaves a week"',
        within_budget: '"spend" at most "budget" £3,000, in your words "We have £3,000 to spend"',
        // W8 run 4 (c7.1): its words are its label, "A second oven", so they are theirs without being quoted twice.
        second_oven: 'sets "ovens added" to "one oven" 1 oven from the start, in your words',
        keep_one: 'carries on as now, in your words "keep our one oven"',
        sold_rel: 'worked out as "extra per oven" multiplied by "sell through", in loaves per oven per week',
        sales_rel: 'starts from "base sales" and changes by "sold per oven" for each "ovens added", link 1 is yours, in your words "A second oven adds about 100 loaves a week", in loaves per week',
        spend_rel: 'worked out as "oven price" multiplied by "ovens added", in £',
        sell_through: 'from 0.5 to 0.9, most likely 0.7 (a plausible range), an estimate, based on "New capacity sells only as far as demand grows."',
        oven_price: 'no figure yet (in £ per oven), Olumi asks "What would the second oven cost?"',
        sales: undefined,
      });
  });

  it('W8 run 4 (c7.1 said once, c7.3): a changed name is not said again after the row\'s own label; words that are the label are not quoted twice; a rate unit reads "(per week)"; every change still shows', () => {
    const words = [BRIEF];
    const base = bakery();
    base.assumptions.push({ id: 'oven_lasts', text: 'The oven lasts five years.', applied: false, concerns: [], author: 'olumi', quote: null, ...at });
    const v0 = validatePostimage(bakery(), base, { removals: [], words, fresh: words });
    expect(v0.ok, JSON.stringify(v0)).toBe(true);
    const saved = (v0 as { model: CanonicalModelT }).model;
    const rows = (m: CanonicalModelT) => { const v = validatePostimage(saved, m, { removals: [], words, fresh: words }); return v.ok ? v.changes.map((c) => [c.label, c.before, c.after]) : v; };
    // Reworded alone (EUR-1.9 "→ worded" its own heading): the label is the new words, the before side the old.
    const reworded = JSON.parse(JSON.stringify(saved)) as CanonicalModelT;
    reworded.assumptions.find((a) => a.id === 'oven_lasts')!.text = 'The oven lasts eight years.';
    expect(rows(reworded)).toEqual([['The oven lasts eight years.', 'worded "The oven lasts five years."', null]]);
    // Reworded beside another change: the after side says only the other change.
    reworded.assumptions.find((a) => a.id === 'oven_lasts')!.applied = true;
    expect(rows(reworded)).toEqual([['The oven lasts eight years.', 'worded "The oven lasts five years.", not applied in the model', 'applied in the model']]);
    // A risk named in their own words (QUA-1.3): theirs, not quoted a second time.
    const risky = JSON.parse(JSON.stringify(saved)) as CanonicalModelT;
    risky.risks.push({ id: 'lose_oven', label: 'keep our one oven', occurrence: 'sell_through', severity: 'extra_per_oven', effect_on: 'sales', direction: 'unknown', mode: 'add', starts_after_periods: 0, author: 'person', quote: 'keep our one oven', ...at });
    const [risk] = rows(risky) as string[][];
    expect([risk![0], risk![2]!.endsWith(', in your words'), risk![2]!.includes('keep our one oven')]).toEqual(['keep our one oven', true, false]);
    // A figure still to be given whose unit is a rate (QUA-3.9 "(in per week)").
    const rate = JSON.parse(JSON.stringify(saved)) as CanonicalModelT;
    rate.quantities.push(q('repairs', '1/week', { status: 'asked', question: 'How often does the oven need repair?', author: 'olumi' }));
    expect((rows(rate) as string[][]).map((r) => r[2])).toEqual(['no figure yet (per week), Olumi asks "How often does the oven need repair?"']);
  });

  it('W8 faithful (dev H03): words the person reports from someone are said as from them, in the person\'s words, never as that someone\'s own words; a change of whom is still shown', () => {
    const words = [BRIEF];
    const reported = JSON.parse(JSON.stringify(bakery())) as CanonicalModelT;
    reported.claims.push({ id: 'baker_view', text: 'The baker thinks a second oven adds about 100 loaves a week.', concerns: [], author: 'person', quote: 'A second oven adds about 100 loaves a week', party: 'our baker', approval: 'proposed', approved_by: null, author_id: null });
    const v = validatePostimage(bakery(), reported, { removals: [], words, fresh: words });
    const row = v.ok ? v.changes.find((c) => c.id === 'baker_view') : undefined;
    expect([row?.after?.endsWith('from our baker, in your words "A second oven adds about 100 loaves a week"'), row?.after?.includes('baker’s words')]).toEqual([true, false]);
    // Whom they report, changed alone, still changes the card's words (the validator's per-field check is untouched).
    const base = (v as { model: CanonicalModelT }).model;
    const other = JSON.parse(JSON.stringify(base)) as CanonicalModelT;
    other.claims.find((c) => c.id === 'baker_view')!.party = 'our manager';
    const w = validatePostimage(base, other, { removals: [], words, fresh: words });
    expect(w.ok && w.changes.map((c) => [c.before, c.after])).toEqual([['from our baker, in your words "A second oven adds about 100 loaves a week"', 'from our manager, in your words "A second oven adds about 100 loaves a week"']]);
  });

  it('the card in plain words (DL 24 Oct): a change to any one field of any item is said, before and after, in words (every group covered); a field that cannot change the words is refused', () => {
    const base = bakery();
    base.preferences.push({ id: 'fewer_hours', quantity: 'spend', direction: 'lower', author: 'olumi', quote: null, ...at });
    base.risks.push({ id: 'breakdown', label: 'The oven breaks down', occurrence: 'sell_through', severity: 'extra_per_oven', effect_on: 'sales', direction: 'unknown', mode: 'add', starts_after_periods: 0, author: 'olumi', quote: null, ...at });
    base.claims.push({ id: 'demand_grows', text: 'Demand grows in spring.', concerns: ['more_loaves'], author: 'olumi', quote: null, ...at });
    base.evidence.push({ id: 'last_spring', text: 'Sales rose last spring.', source: null, bears: 'supports', concerns: ['more_loaves'], author: 'olumi', quote: null, ...at });
    base.assumptions.push({ id: 'oven_lasts', text: 'The oven lasts five years.', applied: false, concerns: [], author: 'olumi', quote: null, ...at });
    base.dissent.push({ id: 'sam_doubts', holder: 'Sam', position: 'It will not sell.', concerns: ['second_oven'], author: 'olumi', quote: null, ...at });
    base.conditions.push({ id: 'landlord', text: 'Only once the landlord agrees.', kind: 'prerequisite', concerns: [], author: 'olumi', quote: null, ...at });
    base.left_out.push({ id: 'morale', text: 'Staff morale', why: 'It has no measure.', question: null, concerns: [], author: 'olumi', quote: null, ...at });
    const words = [BRIEF];
    type M = CanonicalModelT;
    const qty = (id: string, f: Partial<CanonicalQuantityT>) => (m: M) => setQ(m, id, f);
    const goal = (f: (g: any) => void) => (m: M) => { f(m.goals[0]!); };
    const rel = (id: string, f: (r: any) => void) => (m: M) => { f(m.relations.find((r) => r.id === id)!); };
    const one = (family: keyof M, f: (r: any) => void) => (m: M) => { f((m[family] as any[])[0]); };
    const windowed = (m: M) => { m.goals[0]!.measure!.window = { origin_event: null, origin_offset: null, start: 0, periods: 'one_oven' }; };
    const edits: [string, (m: M) => void][] = [
      ['quantity label', qty('sell_through', { label: 'sell-through rate' })], ['quantity unit', qty('sell_through', { unit: '%' })], ['quantity kind', qty('sell_through', { kind: 'fact' })],
      ['quantity status', qty('sell_through', { status: 'unknown' })], ['quantity question', qty('sell_through', { question: 'How much sells?' })],
      ['quantity value', qty('sell_through', { value: 0.6 })], ['quantity low', qty('sell_through', { low: 0.4 })], ['quantity high', qty('sell_through', { high: 0.95 })],
      ['quantity range reading', qty('sell_through', { range_kind: 'bounds' })], ['quantity basis', qty('sell_through', { basis: 'A guess.' })],
      ['quantity author', qty('sell_through', { author: 'structure' })], ['quantity party', qty('budget', { party: 'our accountant' })], ['quantity words', qty('sell_through', { quote: 'We bake 300 loaves a week' })],
      ['relation base', rel('sales_rel', (r) => { r.base = 'budget'; })], ['link driver', rel('sales_rel', (r) => { r.terms[0].driver = 'one_oven'; })],
      ['link size', rel('sales_rel', (r) => { r.terms[0].coefficient = 'extra_per_oven'; })], ['link author', rel('sales_rel', (r) => { r.terms[0].author = 'olumi'; r.terms[0].quote = null; })],
      ['link party', rel('sales_rel', (r) => { r.terms[0].party = 'our baker'; })], ['part power', rel('sold_rel', (r) => { r.parts[0].power = -1; })], ['part id', rel('sold_rel', (r) => { r.parts[1].id = 'one_oven'; })],
      ['relation author', rel('spend_rel', (r) => { r.author = 'person'; r.quote = 'We have £3,000 to spend'; })],
      ['goal name', goal((g) => { g.label = 'Sell 380'; })], ['goal comparison', goal((g) => { g.measure.cmp = '>'; })], ['goal target', goal((g) => { g.measure.target = 'budget'; })],
      ['goal per', goal((g) => { g.measure.per = 'one_oven'; })], ['goal frame', goal((g) => { g.measure.frame = 'change_abs'; g.measure.reference = { kind: 'now', option: null, quantity: null }; })],
      ['goal aggregation', goal((g) => { g.measure.aggregation = 'mean'; })], ['goal window', windowed], ['goal measure by', goal((g) => { g.measure.measure_by = 'olumi'; })],
      ['goal rests on', goal((g) => { g.measure.assumptions = ['oven_lasts']; })], ['goal leaves out', goal((g) => { g.measure.exclusions = ['morale']; })], ['goal question', goal((g) => { g.question = 'By when?'; })],
      ['limit comparison', one('limits', (l) => { l.measure.cmp = '<'; })], ['limit bound', one('limits', (l) => { l.measure.bound = 'sales_target'; })], ['limit question', one('limits', (l) => { l.question = 'Is that firm?'; })],
      ['preference direction', one('preferences', (p) => { p.direction = 'higher'; })], ['preference figure', one('preferences', (p) => { p.quantity = 'budget'; })],
      ['option status', one('options', (o) => { o.status = 'ruled_out'; })], ['option variant', one('options', (o) => { o.developed_from = 'keep_one'; })],
      ['setting to', one('options', (o) => { o.sets[0].to = null; o.sets[0].value = 1; })], ['setting start', one('options', (o) => { o.sets[0].starts_after_periods = 2; })],
      ['setting question', one('options', (o) => { o.sets[0].question = 'From when?'; })], ['setting author', one('options', (o) => { o.sets[0].author = 'structure'; })],
      ['risk chance', one('risks', (k) => { k.occurrence = 'budget'; })], ['risk size', one('risks', (k) => { k.severity = 'budget'; })], ['risk affects', one('risks', (k) => { k.effect_on = 'spend'; })],
      ['risk how', one('risks', (k) => { k.mode = 'multiply'; })], ['risk start', one('risks', (k) => { k.starts_after_periods = 1; })],
      ['claim words', one('claims', (c) => { c.text = 'Demand grows in summer.'; })], ['claim about', one('claims', (c) => { c.concerns = ['second_oven']; })],
      ['evidence source', one('evidence', (e) => { e.source = 'the till'; })], ['evidence bears', one('evidence', (e) => { e.bears = 'challenges'; })],
      ['assumption applied', one('assumptions', (a) => { a.applied = true; })], ['dissent holder', one('dissent', (d) => { d.holder = 'Alex'; })], ['dissent view', one('dissent', (d) => { d.position = 'It might sell.'; })],
      ['condition kind', one('conditions', (c) => { c.kind = 'challenge'; })], ['left out why', one('left_out', (x) => { x.why = 'Nobody measures it.'; })], ['left out question', one('left_out', (x) => { x.question = 'How is morale?'; })],
    ];
    const v0 = validatePostimage(bakery(), base, { removals: [], words, fresh: words });
    expect(v0.ok, JSON.stringify(v0)).toBe(true);
    const saved = (v0 as { model: CanonicalModelT }).model;
    for (const [what, edit] of edits) {
      const m = JSON.parse(JSON.stringify(saved)) as M;
      edit(m);
      const v = validatePostimage(saved, m, { removals: [], words, fresh: words });
      expect(v.ok, `${what}: ${JSON.stringify(v)}`).toBe(true);
      if (!v.ok) continue;
      expect(v.changes.length, what).toBeGreaterThan(0);
      for (const c of v.changes) {
        expect(c.before, what).not.toBe(c.after);
        expect([...formLike(c.before ?? ''), ...formLike(c.after ?? '')], `${what}: ${c.before} → ${c.after}`).toEqual([]);
      }
    }
    // A window's own fields, on a goal that has one.
    const timed = JSON.parse(JSON.stringify(saved)) as M; windowed(timed);
    const v1 = validatePostimage(saved, timed, { removals: [], words, fresh: words }) as { ok: boolean; model: M };
    for (const [what, f] of [['window start', (w: any) => { w.start = 1; }], ['window length', (w: any) => { w.periods = 'sales_target'; }], ['window event', (w: any) => { w.origin_event = 'the opening'; w.origin_offset = 'one_oven'; }]] as const) {
      const m = JSON.parse(JSON.stringify(v1.model)) as M; f(m.goals[0]!.measure!.window!);
      const v = validatePostimage(v1.model, m, { removals: [], words, fresh: words });
      expect(v.ok, `${what}: ${JSON.stringify(v)}`).toBe(true);
    }
    // The stock relation's own fields (the club).
    const c0 = club();
    for (const [what, f] of [['stock start', (r: any) => { r.start = 'base_joins'; }], ['stock inflow', (r: any) => { r.inflows = [...r.inflows, 'base_joins']; }]] as const) {
      const m = JSON.parse(JSON.stringify(c0)) as M; f(m.relations.find((r) => r.form === 'stock')!);
      const v = validatePostimage(c0, m, { removals: [], words: [CLUB_BRIEF], fresh: [CLUB_BRIEF] });
      expect(v.ok, `${what}: ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it('step 5, an answer in chat (the agent\'s own tools: propose, then the person approves): Olumi\'s drafter returns only what it changes; ONE figure changes, in their words, on the card; a new Run', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const before = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    const firstRun = JSON.stringify(persisted!.living_model.runs[0]);
    sent.length = 0;
    const words = 'The oven would cost about £2,500.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    const args = { public_label: 'Oven price £2,500', basis: 'their answer', request: 'The oven price is their answer: about £2,500.', remove: [] };
    const answer = (quote: string) => savedWith((m) => setQ(m, 'oven_price', { status: 'known', value: 2500, question: null, quote, basis: APPROXIMATE_FIGURE }));
    // S1 strip (A2 off): a figure of theirs whose words are not theirs, verbatim, is no longer refused: the card shows the
    // AI's own words as theirs, and only the person's press accepts it (its own store, so it holds no card of this turn's).
    replies = [answer('about £2,500 I think')];
    const loose = await proposeProgramChange({ dispatch, proposals: new ProposalStore() }, { ...ctx, turn_id: randomUUID() }, args) as Json;
    expect(loose.status, JSON.stringify(loose)).toBe('ok');
    expect(loose.data.changes[0]).toMatchObject({ id: 'oven_price', author: 'person' });
    expect(loose.data.changes[0].after).toContain('in your words "about £2,500 I think"');
    replies = [answer(words)];
    const proposed = await proposeProgramChange(deps, ctx, args) as Json;
    expect(proposed.status, JSON.stringify(proposed)).toBe('ok');
    // One drafter call per proposal: the person's words, the saved model and the change.
    expect(sent).toHaveLength(2);
    // C6 (29 Oct): the update's own text and the agent's change are Olumi's (developer role, the change labelled as Olumi's
    // instruction), never the person's: re-pinned knowingly from ['user', 'assistant', 'user'] and "The change:".
    expect(sent[1]!.input.map((m: Json) => m.role)).toEqual(['user', 'assistant', 'developer']);
    // The update's request is prompt.ts's text, then the change (DL 24 Oct: the update text is prompt code).
    expect(sent[1]!.input[2].content).toBe(`${UPDATE_PREFIX}\n${UPDATE_CHANGE_LABEL} The oven price is their answer: about £2,500.\nRemove: nothing`);
    // The card shows the change's substance, before and after, and whose it is.
    expect(proposed.data.changes).toEqual([{ id: 'oven_price', kind: 'quantity', action: 'change', label: 'oven price', before: 'no figure yet (in £ per oven), still to be given, Olumi asks "What would the second oven cost?", no basis given, not in your words',
      after: `£2,500 per oven, known, no question, based on "${APPROXIMATE_FIGURE}", in your words "The oven would cost about £2,500."`, author: 'person', family: 'quantity' }]);
    expect(deps.proposals.get(proposed.data.proposal_id)!.changes).toEqual(proposed.data.changes);
    expect(registered).toHaveLength(1); // proposing saves nothing
    const applied = await applyProgramChange(deps, ctx, proposed.data.proposal_id) as Json;
    expect(applied).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(sent).toHaveLength(2);
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.quantities.find((x) => x.id === 'oven_price')).toMatchObject({ status: 'known', value: 2500, low: null, high: null, author: 'person', quote: words, approval: 'approved', question: null });
    expect(after.quantities.filter((x) => x.id !== 'oven_price')).toEqual(before.quantities.filter((x) => x.id !== 'oven_price'));
    expect({ ...after, quantities: [], history: [] }).toEqual({ ...before, quantities: [], history: [] });
    // C6 (27 Oct 2026): the entry records who approved the change apart from who said it (a guest here: neither known).
    expect(after.history).toEqual([...before.history, { id: 'oven_price', change: 'superseded', old: JSON.stringify(before.quantities.find((x) => x.id === 'oven_price')), quote: words, author_id: null, approved_by: null }]);
    expect(persisted!.living_model.person_words).toEqual([BRIEF, words]);
    // The approved card's frozen program is what was written: model and Run.
    expect(stableStringify(persisted!.living_model)).toBe(stableStringify(deps.proposals.get(proposed.data.proposal_id)!.living_model));
    const runs = persisted!.living_model.runs as Json[];
    expect(runs).toHaveLength(2);
    expect(JSON.stringify(runs[0])).toBe(firstRun);
    expect(runs[1]!.receipt.revision_digest).toBe(revisionDigest(after, [BRIEF, words]));
    const x = compile(after, { sourceText: `${BRIEF}\n${words}` }).executable!;
    expect(runs[1]!.result.chances).toEqual(JSON.parse(JSON.stringify(simulate(x, { seed: seedOf(SCENARIO), draws: RUN_DRAWS }).options
      .map((o) => ({ option_id: o.option_id, per_goal: o.per_goal, joint: o.joint, within_limits: o.within_limits, joint_within_limits: o.joint_within_limits, outcomes: o.outcomes })))));
    // The same approval again: its own earlier save is found, never written twice.
    const saves = registered.length;
    expect(await applyProgramChange(deps, ctx, proposed.data.proposal_id)).toMatchObject({ status: 'ok', data: { already_saved: true } });
    expect(registered.length).toBe(saves);
  });

  it('Box 2 (Paul Q1/Q2, 28 Oct): an update that makes Olumi\'s questions out of date returns the whole new list; the card says both lists in full; approval saves it exactly, the revision and cold reads return it, and it is part of the revision; null keeps it and [] clears it', async () => {
    const SAVED_QS = ['What would make the second oven worth its cost?', 'Who else would need to agree before you buy it?'];
    const NEW_QS = ['What would the landlord need to see before agreeing?', SAVED_QS[0]!];
    replies = [JSON.stringify({ ...bakery(), coaching_questions: SAVED_QS })];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const before = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    expect(before.coaching_questions).toEqual(SAVED_QS);
    const deps = { dispatch, proposals: new ProposalStore() };
    const words: string[] = [BRIEF];
    /** One update proposed and approved through the agent's own tools: the drafter's reply is the saved model with `edit`, as an update returns it. */
    const changeAndApprove = async (said: string, edit: (m: CanonicalModelT) => void) => {
      const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [said], user_turn_text: said };
      const text = savedWith(edit);
      replies = [text]; sent.length = 0;
      const reply = JSON.parse(text) as Json;
      const saves = registered.length;
      const p = await proposeProgramChange(deps, ctx, ProgramChangeParams.parse({ public_label: 'Your change', basis: 'their words', request: said, remove: [] })) as Json;
      expect(p.status, JSON.stringify(p)).toBe('ok');
      expect(registered.length).toBe(saves); // proposing saves nothing
      const held = savedProgramOf({ living_model: deps.proposals.get(p.data.proposal_id)!.living_model })!.canonical.coaching_questions;
      expect(await applyProgramChange(deps, ctx, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
      words.push(said);
      return { reply, changes: p.data.changes as Json[], held, ctx };
    };
    const coldList = () => reopenProgram(JSON.parse(JSON.stringify(persisted)))!.program.canonical.coaching_questions;

    // (1) Refreshed: the drafter returns the whole new list; ONE entry, both lists in full, Olumi's.
    const one = await changeAndApprove('The landlord has to agree first.', (m) => { m.coaching_questions = [...NEW_QS]; });
    expect(one.reply.coaching_questions).toEqual(NEW_QS);
    expect(one.changes).toEqual([{ id: 'coaching_questions', kind: 'record', action: 'change', label: 'Olumi’s questions for you',
      before: `1. ${SAVED_QS[0]}\n2. ${SAVED_QS[1]}`, after: `1. ${NEW_QS[0]}\n2. ${NEW_QS[1]}`, author: 'olumi' }]);
    expect(one.held).toEqual(NEW_QS); // the card's frozen program, which approval writes
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.coaching_questions).toEqual(NEW_QS);
    expect({ ...after, coaching_questions: [] }).toEqual({ ...before, coaching_questions: [] }); // nothing else moved
    // The revision read and the cold read return the new list exactly; the new Run's digest binds it.
    const context = await readProgramContext(deps, one.ctx) as Json;
    expect(context.data.model.coaching_questions).toEqual(NEW_QS);
    expect(coldList()).toEqual(NEW_QS);
    const runs = persisted!.living_model.runs as Json[];
    expect(runs).toHaveLength(2);
    expect(runs[1]!.receipt.revision_digest).toBe(revisionDigest(after, words));
    expect(runs[1]!.receipt.revision_digest).not.toBe(revisionDigest({ ...after, coaching_questions: SAVED_QS }, words));
    expect(programRevisionOf(persisted)).toBe(runs[1]!.receipt.revision_digest);

    // (2) Null keeps them: an update to a figure alone returns null for the questions; its card says nothing of them.
    const two = await changeAndApprove('The oven would cost about £2,500.', (m) => setQ(m, 'oven_price', { status: 'known', value: 2500, question: null, quote: 'The oven would cost about £2,500.', basis: APPROXIMATE_FIGURE }));
    expect(two.reply.coaching_questions).toBeNull();
    expect(two.changes.map((c) => c.id)).toEqual(['oven_price']);
    expect([two.held, coldList()]).toEqual([NEW_QS, NEW_QS]);

    // (3) [] clears them: ONE entry, the saved list before and "No questions" after; saved and read back as none.
    const three = await changeAndApprove('Those questions are settled now.', (m) => { m.coaching_questions = []; });
    expect(three.reply.coaching_questions).toEqual([]);
    expect(three.changes.map((c) => [c.id, c.action, c.before, c.after])).toEqual([['coaching_questions', 'change', `1. ${NEW_QS[0]}\n2. ${NEW_QS[1]}`, 'No questions']]);
    expect([three.held, coldList()]).toEqual([[], []]);
    const last = persisted!.living_model.runs as Json[];
    expect(last.at(-1)!.receipt.revision_digest).toBe(revisionDigest(persisted!.living_model.canonical as CanonicalModelT, words));
  });

  it('seam#3: a card held before an engine update saves its model exactly, with TODAY\'s Run of it in the card\'s Run\'s place, and apply_change reports that saved Run; a card held on today\'s engine saves byte for byte what it showed', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    // A card as a deploy holds it: the real proposal path (an answer, no AI call), held again by the real holder in a fresh
    // store (a restart restores it), its Run as that deploy computed it: `before` names an earlier deploy's engine and Run.
    const card = async (words: string, value: number, before?: { readonly engine: string; readonly run_id: string; readonly face: string }) => {
      const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
      const preparing = new ProposalStore();
      const proposed = await proposeProgramChange({ dispatch, proposals: preparing }, ctx, ProgramChangeParams.parse({ public_label: `Oven price £${value}`, basis: 'their answer', request: '', remove: [],
        answers: [{ id: 'oven_price', status: 'known', author: 'person', value, low: null, high: null, range_kind: null, party: null, quote: words, basis: null }] })) as Json;
      expect(proposed.status, JSON.stringify(proposed)).toBe('ok');
      const p = preparing.get(proposed.data.proposal_id)! as Json;
      const program = JSON.parse(JSON.stringify(savedProgramOf({ living_model: p.living_model }))) as Json;
      const shown = program.runs.at(-1);
      if (before !== undefined) {
        shown.receipt.versions.engine = before.engine; shown.run_id = before.run_id; shown.result.canonical_analysis_view.run.run_id = before.run_id;
        shown.result.canonical_analysis_view.options[0].cell.face = before.face;
      }
      const proposals = new ProposalStore();
      const held = holdProgramCard(proposals, { scenarioId: SCENARIO, userId: null, graphHash: p.base_graph_identity_hash, identity: p.base_model_identity },
        { label: p.public_label, basis: 'their answer', program: program as never, changes: p.changes });
      return { deps: { dispatch, proposals }, ctx, held, program, shown };
    };
    // The contrast: a card held on today's engine saves exactly what it showed, model and Run, and reports that Run.
    const today = await card('The oven would cost £2,500.', 2500);
    const a = await applyProgramChange(today.deps, today.ctx, today.held.proposal_id) as Json;
    expect(a).toMatchObject({ status: 'ok', data: { saved: true, run: { run_id: today.shown.run_id } } });
    expect(stableStringify(persisted!.living_model)).toBe(stableStringify(today.held.living_model));
    const savedRuns = JSON.stringify(persisted!.living_model.runs);
    expect(persisted!.living_model.runs).toHaveLength(2);

    // A card held by the deploy before an engine update, approved after it.
    const before = { engine: 'mp-0ldengine000', run_id: 'mp_run_3_0ldengine000', face: 'WORDS FROM BEFORE THE UPDATE' };
    const old = await card('Actually the oven would cost £3,000.', 3000, before);
    expect([old.shown.run_id, old.shown.receipt.versions.engine]).toEqual([before.run_id, before.engine]);
    const saves = registered.length;
    const b = await applyProgramChange(old.deps, old.ctx, old.held.proposal_id) as Json;
    expect(b, JSON.stringify(b)).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(registered.length).toBe(saves + 1);
    const lm = persisted!.living_model;
    // The model exactly as the card showed it, with the person's words; every Run before it byte for byte.
    expect(stableStringify(lm.canonical)).toBe(stableStringify(old.program.canonical));
    expect(lm.canonical.quantities.find((x: Json) => x.id === 'oven_price')).toMatchObject({ value: 3000, quote: 'Actually the oven would cost £3,000.', author: 'person', status: 'known' });
    expect(lm.person_words).toEqual([BRIEF, 'The oven would cost £2,500.', 'Actually the oven would cost £3,000.']);
    expect(JSON.stringify(lm.runs.slice(0, 2))).toBe(savedRuns);
    // Its Run is today's engine's, of that model, in the card's Run's place (never the card's, nor the card's beside it).
    expect(lm.runs).toHaveLength(3);
    const run = lm.runs[2];
    expect(run.run_id).not.toBe(before.run_id);
    expect(run.receipt).toEqual({ ...old.shown.receipt, versions: { ...ENGINE_VERSIONS } });
    expect(run.result.chances).toEqual(old.shown.result.chances);
    expect(JSON.stringify(lm)).not.toContain(before.face);
    // What apply_change reports is THAT saved Run, never the card's words.
    expect(b.data.run.run_id).toBe(run.run_id);
    expect(JSON.stringify(b.data)).not.toContain(before.face);
    // A reopen reads it as current, on today's engine: nothing stored is "from before an update" on arrival.
    const cold = reopenProgram(JSON.parse(JSON.stringify(persisted)))!;
    expect([cold.run!.run_id, cold.current, cold.engine_current, (cold.view as Json).staleness.stale]).toEqual([run.run_id, true, true, false]);
    // The same approval again finds its own save: no second Run, no second write.
    const snapshot = JSON.stringify(persisted);
    expect(await applyProgramChange(old.deps, old.ctx, old.held.proposal_id)).toMatchObject({ status: 'ok', data: { already_saved: true } });
    expect([registered.length, JSON.stringify(persisted)]).toEqual([saves + 1, snapshot]);
  });

  it('DL 24 Oct (DoD-G classes 12 and 4): an update returns ONLY what it changes, in the canonical records\' own schema, and the host merges it by id: every record it did not return is the saved one, byte for byte; a new id is added; remove deletes; an answer stays on its item; the words checks and the compiler still refuse', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const read = programReadOf(persisted!);
    const saved = (read.kind === 'program' ? read.program.canonical : null)!;
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'We bake 320 loaves a week now. The oven would cost £2,500, and the landlord must agree first.';
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words });
    // What the drafter returns: nothing but what it lists (every family [] otherwise), never the history.
    const none = { version: saved.version, question: null, period: null, coaching_questions: null, quantities: [], relations: [], goals: [], limits: [], preferences: [], options: [], risks: [], claims: [],
      evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [] };
    const propose = async (update: Json, more: Json = {}, n = 1) => {
      replies = Array.from({ length: n }, () => JSON.stringify({ ...none, ...update })); sent.length = 0;
      return await proposeProgramChange(deps, ctx(), ProgramChangeParams.parse({ public_label: 'Your changes', basis: 'their words', request: 'Base sales are 320 a week; the landlord must agree first.',
        remove: [], ...more })) as Json;
    };
    const heldOf = (p: Json) => savedProgramOf({ living_model: deps.proposals.get(p.data.proposal_id)!.living_model })!;
    // Every record but the named ones, each as its own bytes, by family.
    const others = (m: CanonicalModelT, ...ids: string[]) => (['quantities', 'relations', 'goals', 'limits', 'preferences', 'options', 'risks', 'claims', 'evidence', 'assumptions',
      'dissent', 'conditions', 'left_out'] as const).flatMap((f) => (m[f] as readonly { id: string }[]).filter((r) => !ids.includes(r.id)).map((r) => `${f}:${JSON.stringify(r)}`));
    const baseSales = { ...saved.quantities.find((x) => x.id === 'base_sales')!, value: 320, quote: 'We bake 320 loaves a week now' };
    const landlord = { id: 'landlord_agrees', text: 'Only once the landlord agrees.', kind: 'prerequisite', concerns: ['second_oven'], author: 'person', party: null,
      quote: 'the landlord must agree first', approval: 'proposed', approved_by: null, author_id: null };

    // (1) ONE changed record: the card holds that one change, and every other record is the saved one, byte for byte
    // (positive control: the records compared); the question, time step and version are the saved ones.
    const one = await propose({ quantities: [baseSales] });
    expect(one.status, JSON.stringify(one)).toBe('ok');
    expect(one.data.changes.map((c: Json) => [c.id, c.action])).toEqual([['base_sales', 'change']]);
    const held = heldOf(one).canonical;
    expect(others(held, 'base_sales')).toEqual(others(saved, 'base_sales'));
    expect(others(saved, 'base_sales').length).toBeGreaterThan(15);
    expect(held.quantities.find((x) => x.id === 'base_sales')).toMatchObject({ value: 320, quote: 'We bake 320 loaves a week now', author: 'person', approval: 'approved' });
    expect([held.version, held.question, held.period]).toEqual([saved.version, saved.question, saved.period]);
    // As sent: the update's own schema (derived: each family's records in the canonical schema itself, no history, a remove
    // list, the question and time step nullable), after the saved model, with the update's text.
    const format = sent[0]!.text.format as Json;
    expect(format).toMatchObject({ type: 'json_schema', name: 'canonical_model', strict: true });
    expect(stableStringify(format.schema)).toBe(stableStringify(UPDATE_JSON_SCHEMA));
    const families = ['quantities', 'relations', 'goals', 'limits', 'preferences', 'options', 'risks', 'claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out'];
    for (const f of families) expect(stableStringify((UPDATE_JSON_SCHEMA as Json).properties[f].items), f).toBe(stableStringify((CANONICAL_JSON_SCHEMA as Json).properties[f].items));
    expect(Object.keys((UPDATE_JSON_SCHEMA as Json).properties).sort()).toEqual([...families, 'coaching_questions', 'period', 'question', 'remove', 'version'].sort()); // Box 2 (Paul Q1/Q2, 28 Oct): + Olumi's questions
    expect((UPDATE_JSON_SCHEMA as Json).properties.remove.items).toEqual({ type: 'string' });
    expect((UPDATE_JSON_SCHEMA as Json).properties.question.anyOf.map((x: Json) => x.type)).toEqual(['string', 'null']);
    // C6 (29 Oct): the change is Olumi's instruction, in the developer role; re-pinned knowingly from ['user', 'assistant', 'user'] and "The change:".
    expect(sent[0]!.input.map((m: Json) => m.role)).toEqual(['user', 'assistant', 'developer']);
    expect(sent[0]!.input[2].content).toBe(`${UPDATE_PREFIX}\n${UPDATE_CHANGE_LABEL} Base sales are 320 a week; the landlord must agree first.\nRemove: nothing`);

    // (2) + (3) A new id is added after the saved ones; an id in remove (listed by the person) is deleted, on the card and in
    // history; everything else is the saved one, byte for byte.
    const addRemove = await propose({ conditions: [landlord], remove: ['keep_one'] }, { remove: ['keep_one'] });
    expect(addRemove.status, JSON.stringify(addRemove)).toBe('ok');
    expect(addRemove.data.changes.map((c: Json) => [c.id, c.action])).toEqual([['keep_one', 'remove'], ['landlord_agrees', 'add']]);
    const ar = heldOf(addRemove).canonical;
    expect(ar.conditions.map((c) => [c.id, c.author, c.approval])).toEqual([['landlord_agrees', 'person', 'approved']]);
    expect(ar.options.map((o) => o.id)).toEqual(['second_oven']);
    expect(ar.history.map((h) => [h.id, h.change])).toEqual([...saved.history.map((h) => [h.id, h.change]), ['keep_one', 'withdrawn']]);
    expect(others(ar, 'landlord_agrees')).toEqual(others(saved, 'keep_one'));
    // The existing negatives, on what the update lists: a removal the person did not ask for, or one it leaves out.
    expect(await propose({ remove: ['keep_one'], conditions: [landlord] })).toMatchObject({ status: 'refused', reason: 'omitted_record', data: { ids: ['keep_one'] } });
    expect(await propose({ conditions: [landlord] }, { remove: ['keep_one'] })).toMatchObject({ status: 'refused', reason: 'removal_not_applied', data: { ids: ['keep_one'] } });

    // (4) An answer to the oven price with a structural change in ONE call: the drafter returns only the new condition, and
    // the answer stays on the item it answers, its question cleared, so the Run no longer waits on it (contrast: the saved Run does).
    const asked = (run: Json) => ((run.result as Json).compile.blockers as Json[]).filter((b) => b.id === 'oven_price' && b.code === 'asked');
    expect(asked(persisted!.living_model.runs.at(-1))).toHaveLength(1);
    const answers = [{ id: 'oven_price', status: 'known', author: 'person', value: 2500, low: null, high: null, range_kind: null, party: null, quote: 'The oven would cost £2,500', basis: null }];
    const answered = await propose({ conditions: [landlord] }, { answers });
    expect(answered.status, JSON.stringify(answered)).toBe('ok');
    expect(answered.data.changes.map((c: Json) => [c.id, c.action])).toEqual([['oven_price', 'change'], ['landlord_agrees', 'add']]);
    const ah = heldOf(answered);
    expect(ah.canonical.quantities.find((x) => x.id === 'oven_price')).toMatchObject({ status: 'known', value: 2500, quote: 'The oven would cost £2,500', question: null, author: 'person' });
    expect(asked(ah.runs.at(-1) as Json)).toEqual([]);
    expect(others(ah.canonical, 'oven_price', 'landlord_agrees')).toEqual(others(saved, 'oven_price'));

    // (5) S1 strip (A2, A2b off): no words check refuses a returned record: words not theirs, or their figure moved under their
    // earlier words, are proposed as the AI wrote them, on the card for the person's press.
    for (const [quote, after] of [['about 320 loaves I think', '320 loaves per week, in your words "about 320 loaves I think"'], ['We bake 300 loaves a week', '320 loaves per week']]) {
      const p = await propose({ quantities: [{ ...baseSales, quote }], conditions: [landlord] });
      expect(p.status, JSON.stringify(p)).toBe('ok');
      expect(p.data.changes.find((c: Json) => c.id === 'base_sales')).toMatchObject({ action: 'change', author: 'person', after });
    }

    // (6) A merged model that does not compile is refused as today, after the drafter's two repairs; each repair asks for
    // the changes again (never the whole model), after the changes it returned.
    const broken = { claims: [{ id: 'nowhere', text: 'Bread sells.', concerns: ['no_such_record'], author: 'olumi', quote: null, party: null, approval: 'proposed', approved_by: null, author_id: null }] };
    const info = vi.spyOn(staticLog, 'info'); // the instance the statically imported tools hold (the routes are re-imported after resetModules)
    expect(await propose(broken, {}, 3)).toMatchObject({ status: 'refused', reason: 'does_not_compile' });
    // Why it took three calls is logged: each attempt's compiler codes, never words (T record 26 Oct: a 124 s edit's second draft had no recorded cause).
    const drafted = info.mock.calls.flatMap(([o]) => ((o as Json)?.event === 'model_program.update_draft' ? [o as Json] : []));
    info.mockRestore();
    expect(drafted.map((d) => d.attempts.map((a: Json) => a.codes))).toEqual([[['undefined_ref'], ['undefined_ref'], ['undefined_ref']]]);
    expect(JSON.stringify(drafted)).not.toContain('Bread sells');
    expect(sent).toHaveLength(3);
    expect(sent[1]!.input.at(-2)).toEqual({ role: 'assistant', content: JSON.stringify({ ...none, ...broken }) });
    expect(String(sent[1]!.input.at(-1).content).startsWith(`${UPDATE_REPAIR_PREFIX}\n- `)).toBe(true);
    // C6 (29 Oct): the update's repair feedback is the host's, in the developer role, never the person's (content unchanged).
    expect(sent[1]!.input.map((m: Json) => m.role)).toEqual(['user', 'assistant', 'developer', 'assistant', 'developer']);
    expect(stableStringify(sent[2]!.text.format.schema)).toBe(stableStringify(UPDATE_JSON_SCHEMA));
    expect(registered).toHaveLength(1); // proposing saves nothing
  });

  it('Codex BLOCK on #3740: an update is read as a first draft is only where it speaks: S1 strip (B2 off): a structure figure it returns is read as written; a saved one it did not return stays exactly as saved', async () => {
    replies = [JSON.stringify(club())];
    expect((await turn({ message: CLUB_BRIEF })).json().model_program.saved).toBe(true);
    const read = programReadOf(persisted!);
    const saved = (read.kind === 'program' ? read.program.canonical : null)!;
    const words = 'Run the promotion twice.';
    const deps = { dispatch, proposals: new ProposalStore() };
    // The update: a new switched-on figure, and the promotion's setting pointed at it; one_promo is not returned.
    const promotion = saved.options.find((o) => o.id === 'promotion')!;
    const twoPromos = q('two_promos', 'promotion', { value: 2, author: 'structure', basis: 'The promotion run twice.' });
    replies = [JSON.stringify({ version: saved.version, question: null, period: null, coaching_questions: null, quantities: [twoPromos], relations: [], goals: [], limits: [], preferences: [],
      options: [{ ...promotion, sets: promotion.sets.map((x) => (x.quantity === 'promo_on' ? { ...x, to: 'two_promos' } : x)) }],
      risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [] })];
    const p = await proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
      ProgramChangeParams.parse({ public_label: 'Two promotions', basis: 'their words', request: 'Run the promotion twice.', remove: [] })) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(p.data.changes.map((c: Json) => [c.id, c.action])).toEqual([['two_promos', 'add'], ['promotion', 'change']]);
    const held = savedProgramOf({ living_model: deps.proposals.get(p.data.proposal_id)!.living_model })!.canonical;
    // Not returned: the saved figure exactly (no option switches it now, so a whole-model reading would make it asked).
    const onePromo = saved.quantities.find((x) => x.id === 'one_promo')!;
    expect(onePromo).toMatchObject({ author: 'structure', status: 'known', value: 1 });
    expect(JSON.stringify(held.quantities.find((x) => x.id === 'one_promo'))).toBe(JSON.stringify(onePromo));
    // Returned, the figure is the AI's as written (the structure rewrite is off the path).
    expect(held.quantities.find((x) => x.id === 'two_promos')).toMatchObject({ author: 'structure', status: 'known', value: 2 });
  });

  it('THE WITNESS: a stock, a limit and one Olumi estimate, with known answers, through draft, an in-card change, a chat correction, Runs and cold reopens', async () => {
    replies = [JSON.stringify(club())];
    const drafted = (await turn({ message: CLUB_BRIEF })).json();
    expect(drafted.model_program.saved, JSON.stringify(drafted.model_program.compile?.errors ?? drafted.model_program.draft)).toBe(true);
    expect(drafted.model_program).toMatchObject({ readback: { read: true, canonical_identical: true, runs_identical: true, seed_identical: true } });
    const goalOf = (run: Json, option: string) => (run.result.chances as Json[]).find((o) => o.option_id === option)!.per_goal[0];
    const run1 = persisted!.living_model.runs[0] as Json;
    // Known answers, DETERMINISTIC: each stored Run is exactly its stored model simulated on the scenario's seed, and the known
    // answers are read off that same stored model on seed 1 (GOLD-4's documented seed), 10,000 draws. The scenario's own seed is
    // fresh per run (a random scenario id), so the fixed bounds are never read on it (#3712 CI: on correct code they failed in
    // 1 and 5 of 300 random seeds).
    const chancesOf = (seed: number) => {
      const lm = persisted!.living_model;
      return JSON.parse(JSON.stringify(simulate(compile(lm.canonical, { sourceText: sourceTextOf(lm.person_words) }).executable!, { seed, draws: RUN_DRAWS }).options
        .map((o) => ({ option_id: o.option_id, per_goal: o.per_goal, joint: o.joint, within_limits: o.within_limits, joint_within_limits: o.joint_within_limits, outcomes: o.outcomes })))) as Json[];
    };
    const atSeed1 = (option: string) => chancesOf(1).find((o) => o.option_id === option)!.per_goal[0];
    // Carry on exactly 0 (330 < 340); the promotion needs 330 + 3 × effect ≥ 340, an effect of 10/3, below its median 5. W10
    // (adopted; the √12 law gave Φ(1.4434) = 0.92554): σL = 2/1.2815516 = 1.56061, so Φ((5 − 10/3)/1.56061 = 1.06796) =
    // 0.85723 (table Φ(1.06) = 0.85543, Φ(1.07) = 0.85769, interpolated; Wilson half-width at 10,000 draws 0.0069).
    expect(run1.result.chances).toEqual(chancesOf(seedOf(SCENARIO)));
    expect([goalOf(run1, 'carry_on').chance, goalOf(run1, 'carry_on').precision_95]).toEqual([0, [0, 0]]);
    expect(Math.abs(atSeed1('promotion').chance - 0.85723)).toBeLessThan(0.0075);
    expect((run1.result.chances as Json[]).map((o) => [o.option_id, (o.within_limits as Json).chance])).toEqual([['promotion', 1], ['carry_on', 1]]);

    // Change ONE input on its card: leavers 10 → 12. The promotion now needs an effect of 16/3, above its median: W10 (the √12
    // law gave 1 − Φ(0.2887) = 0.38641): σH = 1.56061, 1 − Φ((16/3 − 5)/1.56061 = 0.21359) = 0.41543 (table Φ(0.21) = 0.58317,
    // Φ(0.22) = 0.58706, interpolated; Wilson half-width 0.0097).
    const card = await turn({ kind: 'system_event', event: { kind: 'factor_value_edit', target_id: 'leavers', value: 12 } });
    expect(card.statusCode, card.body).toBe(200);
    const m2 = persisted!.living_model.canonical as CanonicalModelT;
    expect(m2.quantities.find((x) => x.id === 'leavers')).toMatchObject({ value: 12, author: 'person', status: 'known' });
    // The canonical revision and the projected value agree, and the Run is the new revision's.
    expect((persisted!.nodes as Json[]).find((n) => n.id === 'leavers')!.observed_state).toMatchObject({ value: 12, source: 'user_override' });
    const run2 = persisted!.living_model.runs[1] as Json;
    expect(run2.receipt.revision_digest).toBe(revisionDigest(m2, persisted!.living_model.person_words));
    expect(goalOf(run2, 'carry_on').chance).toBe(0);
    expect(run2.result.chances).toEqual(chancesOf(seedOf(SCENARIO)));
    expect(Math.abs(atSeed1('promotion').chance - 0.41543)).toBeLessThan(0.012);
    expect(card.json().canonical_analysis_view.run.run_id).toBe(run2.run_id);

    // Cold reopen: the SAME stored result, Run id and digest, from the stored JSON alone in a fresh module.
    vi.resetModules();
    const fresh = await import('../program-store.js');
    const cold = fresh.reopenProgram(JSON.parse(JSON.stringify(persisted)))!;
    expect([cold.run!.run_id, cold.run!.receipt.revision_digest, cold.current]).toEqual([run2.run_id, run2.receipt.revision_digest, true]);
    expect(stableStringify(cold.view)).toBe(stableStringify(card.json().canonical_analysis_view));

    // Correct Olumi's estimate in chat (the person's words, approved): ONLY that figure becomes theirs; the mechanism (the
    // link and its relation) stays Olumi's. 300 + 3 × (20 + 6 − 12) = 342 ≥ 340: exactly 1. A new revision, a new Run.
    const words = 'From experience a promotion brings 6 more a month.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    replies = [savedWith((m) => setQ(m, 'promo_effect', { value: 6, low: null, high: null, range_kind: null, status: 'known', author: 'person', basis: null, quote: 'a promotion brings 6 more a month' }))];
    const p = await proposeProgramChange(deps, ctx, { public_label: 'Promotion effect 6 a month', basis: 'their experience', request: 'The promotion brings 6 more a month, in their words.', remove: [] }) as Json;
    expect(p.data.changes.map((c: Json) => [c.id, c.action, c.before, c.after])).toEqual([['promo_effect', 'change',
      'from 3 to 7 members per promotion per month, most likely 5 (a plausible range), an estimate, based on "Promotions at clubs this size bring a few extra joins a month.", Olumi’s, not in your words',
      '6 members per promotion per month, known, no basis given, yours, in your words "a promotion brings 6 more a month"']]);
    expect(await applyProgramChange(deps, ctx, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const m3 = persisted!.living_model.canonical as CanonicalModelT;
    expect(m3.quantities.find((x) => x.id === 'promo_effect')).toMatchObject({ value: 6, low: null, high: null, author: 'person', quote: 'a promotion brings 6 more a month' });
    expect(m3.relations).toEqual(club().relations);
    const runs = persisted!.living_model.runs as Json[];
    expect(runs.map((r) => r.run_id)).toEqual([run1.run_id, run2.run_id, runs[2]!.run_id]);
    expect(stableStringify(runs.slice(0, 2))).toBe(stableStringify([run1, run2]));
    expect(new Set(runs.map((r) => r.receipt.revision_digest)).size).toBe(3);
    expect([goalOf(runs[2]!, 'promotion'), goalOf(runs[2]!, 'carry_on')].map((g) => [g.chance, g.precision_95])).toEqual([[1, [1, 1]], [0, [0, 0]]]);
    const reopened = reopenProgram(JSON.parse(JSON.stringify(persisted)))!;
    expect([reopened.run!.run_id, reopened.current]).toEqual([runs[2]!.run_id, true]);

    // Contrast (stale CAS): a chat card made on the model BEFORE another change is superseded, and writes nothing.
    const later = 'Actually we can only spend £450.';
    const ctx2 = { ...ctx, verified_user_messages: [later], user_turn_text: later };
    replies = [savedWith((m) => setQ(m, 'budget', { value: 450, quote: 'we can only spend £450' }))];
    const stale = await proposeProgramChange(deps, ctx2, { public_label: 'Budget £450', basis: 'they said so', request: 'The budget is £450.', remove: [] }) as Json;
    expect(stale.status, JSON.stringify(stale)).toBe('ok');
    await turn({ kind: 'system_event', event: { kind: 'factor_value_edit', target_id: 'leavers', value: 11 } });
    const saves = registered.length;
    expect(await applyProgramChange(deps, ctx2, stale.data.proposal_id)).toMatchObject({ status: 'refused' });
    expect(registered.length).toBe(saves);
  });

  it('class 13: a program saved under the old from_period is read ONCE as starts_after_periods, the same count and the same executable; its stored Run is not called current for the changed form', async () => {
    replies = [JSON.stringify(club())];
    await turn({ message: CLUB_BRIEF });
    const lm = persisted!.living_model;
    const stored = JSON.parse(JSON.stringify(lm.canonical).replaceAll('"starts_after_periods":', '"from_period":'));
    expect(JSON.stringify(stored)).not.toContain('starts_after_periods');
    // As saved before the rename: the model under the old name, and its Run's digest over that stored form.
    const oldRun = { ...lm.runs[0], receipt: { ...lm.runs[0].receipt, revision_digest: revisionDigest(stored, lm.person_words) } };
    const before = { ...persisted!, living_model: { ...lm, canonical: stored, runs: [oldRun] } };
    const read = programReadOf(before);
    expect(read.kind).toBe('program');
    const program = (read as Extract<typeof read, { kind: 'program' }>).program;
    expect(stableStringify(program.canonical)).toBe(stableStringify(lm.canonical));
    const words = sourceTextOf(lm.person_words);
    expect(stableStringify(compile(program.canonical, { sourceText: words }).executable)).toBe(stableStringify(compile(lm.canonical as CanonicalModelT, { sourceText: words }).executable));
    // Its stored Run was made on the old form, so it is not called current for the read one: a Run again shows the chance.
    expect([reopenProgram(before)!.run!.run_id, reopenProgram(before)!.current]).toEqual([lm.runs[0].run_id, false]);
    expect(reopenProgram(persisted)!.current).toBe(true); // contrast: a Run made on the new form
    // S4: the person's model did not move (only how it is read), so the stale result says it is from before an update.
    const old = reopenProgram(before)!.view as Json;
    expect([old.staleness.stale, old.staleness.reason, old.face_when_stale]).toEqual([true, 'engine_or_format_updated', RUN_AGAIN_AFTER_UPDATE]);
    // Contrast: the old-form model moved too (a word of theirs added): the model-change words, never "an update".
    const movedOld = JSON.parse(JSON.stringify(before)); movedOld.living_model.person_words.push('and one more thing');
    const moved = reopenProgram(movedOld)!.view as Json;
    expect([moved.staleness.reason, moved.face_when_stale]).toEqual(['graph_hash_diverged', RUN_AGAIN_FOR_CHANCE]);
    // Both names on one setting is not mapped: the schema judges it, and the program is unreadable.
    const both = JSON.parse(JSON.stringify(lm.canonical).replace('"starts_after_periods":0', '"starts_after_periods":0,"from_period":0'));
    expect(programReadOf({ ...persisted!, living_model: { ...lm, canonical: both } }).kind).toBe('unreadable');
  });

  it('simplify v1 (A1, A2): the ONE validator: an omitted record is refused; a removal only when listed, on the card and in history, its id never used again; every add, change and remove on the card and its wire', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'Drop keeping our one oven: the oven is £2,000, and our landlord must agree first.';
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words });
    const args = (remove: string[]) => ({ public_label: 'Your changes', basis: 'they said so', request: 'Remove keeping one oven; the oven costs £2,000; the landlord must agree first.', remove });
    const edited = (drop: boolean) => savedWith((d) => {
      if (drop) d.options = d.options.filter((o) => o.id !== 'keep_one');
      setQ(d, 'oven_price', { status: 'known', value: 2000, question: null, quote: 'the oven is £2,000' });
      d.conditions.push({ id: 'landlord_agrees', text: 'Only once the landlord agrees.', kind: 'prerequisite', concerns: ['second_oven'], author: 'person', party: null, quote: 'our landlord must agree first', approval: 'proposed', approved_by: null, author_id: null });
    });
    // Left out with no listed removal: refused, and nothing is proposed.
    replies = [edited(true)];
    expect(await proposeProgramChange(deps, ctx(), args([]))).toMatchObject({ status: 'refused', reason: 'omitted_record', data: { ids: ['keep_one'] } });
    // Listed but still there; listed but no such record.
    replies = [edited(false)];
    expect(await proposeProgramChange(deps, ctx(), args(['keep_one']))).toMatchObject({ status: 'refused', reason: 'removal_not_applied', data: { ids: ['keep_one'] } });
    replies = [edited(true)];
    expect(await proposeProgramChange(deps, ctx(), args(['keep_one', 'no_such_record']))).toMatchObject({ status: 'refused', reason: 'unknown_removal', data: { ids: ['no_such_record'] } });
    expect(registered).toHaveLength(1);
    // Listed: the card holds EVERY change, each with its substance before and after, and whose it is.
    replies = [edited(true)];
    const c = ctx();
    const p = await proposeProgramChange(deps, c, args(['keep_one'])) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    const changes: ProposalChange[] = [
      { id: 'oven_price', kind: 'quantity', action: 'change', label: 'oven price', before: 'no figure yet (in £ per oven), still to be given, Olumi asks "What would the second oven cost?", not in your words',
        after: '£2,000 per oven, known, no question, in your words "the oven is £2,000"', author: 'person', family: 'quantity' },
      { id: 'keep_one', kind: 'option', action: 'remove', label: 'Keep our one oven', before: 'carries on as now, in your words "keep our one oven"', after: null, author: 'person', family: 'option' },
      { id: 'landlord_agrees', kind: 'record', action: 'add', label: 'Only once the landlord agrees.', before: null,
        after: 'a prerequisite, about "A second oven", in your words "our landlord must agree first"', author: 'person', family: 'conditions' },
    ];
    expect(p.data.changes).toEqual(changes);
    // The card the UI reads carries the same changes, on the held proposal's own projection (and in its digest).
    const proposal = deps.proposals.get(p.data.proposal_id)!;
    const hold = proposalPendingAction(proposal, { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Approve', message: 'Approve.' } as never, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() });
    const record = proposalRecord(hold, persisted)!;
    expect(proposalFieldsWire([record], record.base_graph_hash)!.proposals[0]!.changes).toEqual(changes);
    expect(proposalRecord(proposalPendingAction({ ...proposal, changes: changes.slice(1) }, { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Approve', message: 'Approve.' } as never,
      { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() }), persisted)).toBeUndefined(); // a card whose changes were edited is not this proposal
    expect(await applyProgramChange(deps, c, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.options.map((o) => o.id)).toEqual(['second_oven']);
    expect(after.conditions.map((x) => [x.id, x.author, x.approval])).toEqual([['landlord_agrees', 'person', 'approved']]);
    expect(after.history.slice(-2).map((h) => [h.id, h.change])).toEqual([['oven_price', 'superseded'], ['keep_one', 'withdrawn']]);
    expect(JSON.parse(after.history.at(-1)!.old)).toEqual(bakery().options[1]);
    // Its id is never used again: a new item under it is refused.
    replies = [savedWith((d) => { d.options.push({ ...bakery().options[1]!, label: 'Keep one oven after all' }); })];
    expect(await proposeProgramChange(deps, ctx(), { ...args([]), request: 'Bring back keeping one oven.' })).toMatchObject({ status: 'refused', reason: 'recycled_id', data: { ids: ['keep_one'] } });
  });

  it('simplify v1 (buddy 21:16Z): preserve by (family, id); the card shows EVERY changed field or nothing is proposed; approval and author_id are the host\'s, never the drafter\'s', async () => {
    const m = bakery();
    m.quantities.push(q('opening_in', 'week', { value: 2, quote: 'We open in 2 weeks' }), q('opening_twin', 'week', { label: 'opening in', value: 2, quote: 'We open in 2 weeks' }),
      q('opening_later', 'week', { value: 3, quote: 'or in 3 weeks' }), q('four_weeks', 'week', { value: 4, quote: 'within 4 weeks of opening' }));
    m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { origin_event: 'the opening', origin_offset: 'opening_in', start: 0, periods: 'four_weeks' } } }));
    m.conditions.push({ id: 'landlord_agrees', text: 'Only once the landlord agrees.', kind: 'prerequisite', concerns: [], author: 'olumi', quote: null, ...at });
    replies = [JSON.stringify(m)];
    expect((await turn({ message: `${BRIEF} We open in 2 weeks, or in 3 weeks, and want it within 4 weeks of opening.` })).json().model_program.saved).toBe(true);
    const saved = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: ['Make it 3 weeks to the opening.'], user_turn_text: 'Make it 3 weeks to the opening.' });
    const propose = async (edit: (d: CanonicalModelT) => void) => {
      replies = [savedWith(edit)];
      return await proposeProgramChange(deps, ctx(), { public_label: 'The opening', basis: 'they said so', request: 'The opening is in 3 weeks.', remove: [] }) as Json;
    };
    const timing = (offset: string) => (d: CanonicalModelT) => { d.goals = d.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { ...g.measure!.window!, origin_offset: offset } } })); };
    // (a) An existing id never moves to another family; an id is never used twice, in one family or across two.
    expect(await propose((d) => { const c = d.conditions.pop()!; d.evidence.push({ id: c.id, text: c.text, source: null, bears: 'informs', concerns: [], author: 'olumi', quote: null, ...at }); }))
      .toMatchObject({ status: 'refused', reason: 'moved_record', data: { ids: ['landlord_agrees'] } });
    expect(await propose((d) => { d.quantities.push({ ...d.quantities[0]! }); })).toMatchObject({ status: 'refused', reason: 'duplicate_id', data: { ids: ['base_sales'] } });
    expect(await propose((d) => { d.claims.push({ id: 'twin', text: 'Bread sells.', concerns: [], author: 'olumi', quote: null, ...at });
      d.dissent.push({ id: 'twin', holder: 'Sam', position: 'It will not.', concerns: [], author: 'olumi', quote: null, ...at }); }))
      .toMatchObject({ status: 'refused', reason: 'duplicate_id', data: { ids: ['twin'] } });
    // (b) Every changed field is on the card: the event's timing, moved between two figures already in the model, shows both.
    const shown = await propose(timing('opening_later'));
    expect(shown.status, JSON.stringify(shown)).toBe('ok');
    expect(shown.data.changes).toEqual([{ id: 'more_loaves', kind: 'goal', action: 'change', label: 'Reach 380 loaves a week', before: 'by the end of "four weeks" 4 weeks, counted from "the opening", which is "opening in" 2 weeks from the start of this model',
      after: 'by the end of "four weeks" 4 weeks, counted from "the opening", which is "opening later" 3 weeks from the start of this model', author: 'person', family: 'goal' }]);
    // Words that would read the same on both sides (two timings named and sized alike): not proposed.
    expect(await propose(timing('opening_twin'))).toMatchObject({ status: 'refused', reason: 'unshown_change', data: { ids: ['more_loaves (measure.window.origin_offset)'] } });
    // (c) The drafter's approval and author_id are never taken: on an untouched item they change nothing; a changed item is
    // accepted by the approving person (the host), its author unchanged.
    const host = await propose((d) => { timing('opening_later')(d);
      d.conditions = d.conditions.map((c) => ({ ...c, approval: 'approved', author_id: 'someone-else' })); d.goals = d.goals.map((g) => ({ ...g, author_id: 'someone-else' })); });
    expect(host.status, JSON.stringify(host)).toBe('ok');
    expect(host.data.changes.map((c: Json) => c.id)).toEqual(['more_loaves']);
    const card = savedProgramOf({ living_model: deps.proposals.get(host.data.proposal_id)!.living_model })!.canonical;
    expect(card.conditions).toEqual(saved.conditions);
    expect(card.goals[0]).toMatchObject({ author: 'person', approval: 'approved', author_id: null });
  });

  it('simplify v1 (Codex r1 P1): the card is driven by the field-level diff: every changed field of an item is said, saved and proposed; a field that would read the same on both sides is refused by name, whatever else changes', async () => {
    const m = bakery();
    // Two figures named and sized alike: "sold per oven", each worked out from the same two figures.
    m.quantities.push(q('sold_twin', 'loaf/week/oven', { label: 'sold per oven', kind: 'coefficient', status: 'derived', author: 'olumi' }));
    m.relations.push({ form: 'definition', id: 'twin_rel', defines: 'sold_twin', op: 'product', parts: [{ id: 'extra_per_oven', power: 1 }, { id: 'sell_through', power: 1 }], author: 'olumi', quote: null, ...at });
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'We now bake 320 loaves a week, our baker says.';
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words });
    const propose = async (edit: (d: CanonicalModelT) => void) => {
      replies = [savedWith(edit)];
      return await proposeProgramChange(deps, ctx(), { public_label: 'Base sales', basis: 'their words', request: 'Base sales are now 320 a week.', remove: [] }) as Json;
    };
    // (1) Two fields of one item change (its figure, and the question it carries): both are on the card, each saved → proposed.
    const both = await propose((d) => setQ(d, 'base_sales', { value: 320, question: 'Is that every week of the year?', quote: 'We now bake 320 loaves a week' }));
    expect(both.status, JSON.stringify(both)).toBe('ok');
    expect(both.data.changes).toEqual([{ id: 'base_sales', kind: 'quantity', action: 'change', label: 'base sales',
      before: '300 loaves per week, no question, in your words "We bake 300 loaves a week"',
      after: '320 loaves per week, Olumi asks "Is that every week of the year?", in your words "We now bake 320 loaves a week"', author: 'person', family: 'quantity' }]);
    // (2) A link's size moved to the figure named and sized alike, while who it is from also changes: refused, naming the
    // field that would read the same; the other change does not carry it through.
    const swap = (to: string) => (d: CanonicalModelT) => {
      d.relations = d.relations.map((r) => (r.form === 'effect' ? { ...r, terms: r.terms.map((x) => ({ ...x, coefficient: to, party: 'our baker' })) } : r));
    };
    expect(await propose(swap('sold_twin'))).toMatchObject({ status: 'refused', reason: 'unshown_change', data: { ids: ['sales_rel (terms.0.coefficient)'] } });
    // Contrast: moved to a figure with its own name, both changes are on the card.
    const named = await propose(swap('extra_per_oven'));
    expect(named.status, JSON.stringify(named)).toBe('ok');
    expect(named.data.changes).toEqual([{ id: 'sales_rel', kind: 'relation', action: 'change', label: 'sales',
      before: 'starts from "base sales" and changes by "sold per oven" for each "ovens added", link 1 is yours, in your words "A second oven adds about 100 loaves a week"',
      after: 'starts from "base sales" and changes by "extra per oven" for each "ovens added", link 1 is yours, '
        + 'from our baker, in your words "A second oven adds about 100 loaves a week"', author: 'olumi', family: 'relation' }]);
  });

  it('simplify v1 (buddy 22:47Z): a list of another length is compared entry by entry: a link moved to another figure of the same name is said with both figures while a link is added in full; moved to one named and sized alike, refused', async () => {
    const m = bakery();
    const brief = `${BRIEF} Each oven has an impact of 1 loaf, or 9 loaves.`;
    // Three figures named "impact": 1, 9, and a twin of the 1; and Olumi's estimate of another effect.
    m.quantities.push(q('impact_1', 'loaf/week/oven', { label: 'impact', kind: 'coefficient', value: 1, quote: 'an impact of 1 loaf' }),
      q('impact_9', 'loaf/week/oven', { label: 'impact', kind: 'coefficient', value: 9, quote: 'or 9 loaves' }),
      q('impact_twin', 'loaf/week/oven', { label: 'impact', kind: 'coefficient', value: 1, quote: 'an impact of 1 loaf' }),
      q('other', 'loaf/week/oven', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 3, low: 2, high: 4, range_kind: 'plausible', basis: 'Another oven effect, for the row.' }));
    m.relations = m.relations.map((r) => (r.form === 'effect' ? { ...r, terms: [{ driver: 'ovens_added', coefficient: 'impact_1', author: 'olumi' as const, quote: null, ...at }] } : r));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: brief })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: ['Make the impact 9, and add the other effect.'], user_turn_text: 'Make the impact 9, and add the other effect.' });
    const relink = (to: string) => async () => {
      replies = [savedWith((d) => {
        d.relations = d.relations.map((r) => (r.form === 'effect'
          ? { ...r, terms: [{ ...r.terms[0]!, coefficient: to }, { driver: 'one_oven', coefficient: 'other', author: 'olumi' as const, quote: null, ...at }] } : r));
      })];
      return await proposeProgramChange(deps, ctx(), { public_label: 'The impact', basis: 'their words', request: 'The impact is 9, with the other effect added.', remove: [] }) as Json;
    };
    // Link 1's size moves from the 1 to the 9 (both "impact") while link 2 is added: both figures, and the new link in full.
    const shown = await relink('impact_9')();
    expect(shown.status, JSON.stringify(shown)).toBe('ok');
    expect(shown.data.changes).toEqual([{ id: 'sales_rel', kind: 'relation', action: 'change', label: 'sales',
      before: 'starts from "base sales" and changes by "impact" 1 loaf per oven per week for each "ovens added", no link 2',
      after: 'starts from "base sales" and changes by "impact" 9 loaves per oven per week for each "ovens added", '
        + 'and by "other" for each "one oven"', author: 'olumi', family: 'relation' }]);
    // Moved to the twin (named and sized alike) while link 2 is added: refused, naming the field that would read the same.
    expect(await relink('impact_twin')()).toMatchObject({ status: 'refused', reason: 'unshown_change', data: { ids: ['sales_rel (terms.0.coefficient)'] } });
  });

  it('the card in plain words (Codex r1 #3718): a figure given where there was none is said or refused, never carried beside another change; a deadline or a setting taken away is said; a link reads "changes by" its own signed figure', () => {
    const words = [CLUB_BRIEF];
    const check = (base: CanonicalModelT, edit: (m: CanonicalModelT) => void, said = words) => {
      const m = JSON.parse(JSON.stringify(base)) as CanonicalModelT;
      edit(m);
      return validatePostimage(base, m, { removals: [], words: said, fresh: said });
    };
    const unshown = (ids: string[]) => ({ ok: false, code: 'unshown_change', ids });
    // Codex's case: a figure set on a switch (which reads its "one promo", never the figure) beside a timing change: refused by name.
    expect(check(club(), (m) => { m.options[0]!.sets[0]!.starts_after_periods = 2; m.options[0]!.sets[0]!.value = 99; })).toMatchObject(unshown(['promotion (sets.0.value)']));
    // Contrast: the timing alone is on the card, before and after.
    const timing = check(club(), (m) => { m.options[0]!.sets[0]!.starts_after_periods = 2; });
    expect(timing.ok ? timing.changes : timing).toEqual([{ id: 'promotion', kind: 'option', action: 'change', label: 'Run a promotion',
      before: 'sets "promo on" to "one promo" 1 promotion from the start', after: 'sets "promo on" to "one promo" 1 promotion after 2 months', author: 'person', family: 'option' }]);
    // The same figure on a setting that arrives with its own entry, or with a whole new option: refused too.
    expect(check(club(), (m) => { m.options[0]!.sets.push({ ...m.options[0]!.sets[0]!, value: 99 }); })).toMatchObject(unshown(['promotion (sets.2.value)']));
    expect(check(club(), (m) => { m.options.push({ ...m.options[0]!, id: 'promo_twice', label: 'Run two promotions', author: 'olumi', quote: null, sets: [{ ...m.options[0]!.sets[0]!, value: 99, author: 'olumi', quote: null }] }); }))
      .toMatchObject(unshown(['promo_twice (sets.0.value)']));
    // A deadline taken away, and a setting taken away, are each said (nothing is left to set back alone).
    const timed = check(bakery(), (m) => { m.goals[0]!.measure!.window = { origin_event: null, origin_offset: null, start: 0, periods: 'one_oven' }; }, [BRIEF]) as { ok: true; model: CanonicalModelT };
    const untimed = check(timed.model, (m) => { m.goals[0]!.measure!.window = null; }, [BRIEF]);
    // Paul 28 Oct (remove the false host phrases): the removed deadline is shown as its old words with nothing after (the UI's
    // "(was: …)"), never "no deadline set", which a goal whose window was never drafted would also have claimed.
    expect(untimed.ok ? untimed.changes.map((c) => [c.before, c.after]) : untimed).toEqual([['by the end of "one oven" 1 oven', null]]);
    const fewer = check(club(), (m) => { m.options[0]!.sets.pop(); });
    expect(fewer.ok ? fewer.changes.map((c) => [c.before, c.after]) : fewer).toEqual([['sets "spend" to "promo cost" £500 from the start, in your words "The promotion costs £500"', 'without this setting']]);
    // A link whose size is a fall of 3 to 7 (compiler-valid) reads "changes by" its own signed figure, never "raised by".
    const falls = club();
    setQ(falls, 'promo_effect', { value: -5, low: -7, high: -3 });
    expect(compile(falls, { sourceText: CLUB_BRIEF }).errors).toEqual([]);
    const read = readingOf(falls, { words, approver: null });
    expect(read.ok ? read.changes.find((c) => c.id === 'joins_rel')?.after : read)
      .toBe('starts from "base joins" and changes by "promo effect" for each "promo on", in members per month');
  });
  it('simplify v1 (buddy 21:46Z): an item the card could not name is never proposed: an empty-label risk is refused by the card\'s own contract and by the compiler; so is a note with no words', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: ['The oven could break down.'], user_turn_text: 'The oven could break down.' });
    const estimate = (id: string, unit: string, low: number, high: number, value: number | null) => q(id, unit, { kind: 'coefficient', status: 'estimated', author: 'olumi', value, low, high, range_kind: 'plausible', basis: 'Synthetic.' });
    const risky = (label: string, as = savedWith) => as((d) => {
      d.quantities.push(estimate('breakdown_chance', '1', 0.05, 0.2, null), estimate('lost_loaves', 'loaf/week', -150, -50, -100));
      d.risks.push({ id: 'breakdown', label, occurrence: 'breakdown_chance', severity: 'lost_loaves', effect_on: 'sales', direction: 'unknown', mode: 'add', starts_after_periods: 0, author: 'olumi', quote: null, ...at });
    });
    const propose = async (body: string) => {
      replies = [body];
      return await proposeProgramChange(deps, ctx(), { public_label: 'A risk', basis: 'they said so', request: 'Add the oven breaking down as a risk.', remove: [] }) as Json;
    };
    expect(await propose(risky(''))).toMatchObject({ status: 'refused', reason: 'invalid_change_entry', data: { ids: ['breakdown'] } });
    // The compiler refuses it on its own too (one form per meaning: every record's label is a name).
    expect(compile(JSON.parse(risky('', wholeWith)) as CanonicalModelT, { sourceText: BRIEF }).errors.map((e) => [e.code, e.items])).toContainEqual(['label', ['breakdown']]);
    // A note with no words: the card's contract refuses it (it has no label for the compiler to check).
    expect(await propose(savedWith((d) => { d.claims.push({ id: 'blank', text: '', concerns: [], author: 'olumi', quote: null, ...at }); })))
      .toMatchObject({ status: 'refused', reason: 'invalid_change_entry', data: { ids: ['blank'] } });
    expect(registered).toHaveLength(1);
    // Contrast: the same risk with its name is proposed, and on the card.
    const named = await propose(risky('The oven breaks down'));
    expect(named.status, JSON.stringify(named)).toBe('ok');
    expect(named.data.changes.find((c: Json) => c.id === 'breakdown')).toEqual({ id: 'breakdown', kind: 'risk', action: 'add', label: 'The oven breaks down', before: null,
      after: 'with a chance of "breakdown chance" 0.05–0.2, adding "lost loaves" -150–-50 loaves per week to "sales", from the start', author: 'olumi', family: 'risk' });
  });

  it('simplify v1 (A3): a typed card edit builds its postimage from its exact target and value with NO AI call, through the same validator: the change on its reply and in history', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    sent.length = 0;
    const before = persisted!.living_model.canonical as CanonicalModelT;
    const r = await applyCanvasFigure({ dispatch }, SCENARIO, { target: { quantity_id: 'base_sales' }, value: 320, operation_key: randomUUID(), approver: null });
    expect(r).toMatchObject({ status: 'saved' });
    expect(sent).toHaveLength(0);
    // D074 (C6, 29 Oct): their words are the figure as entered ("320"), never the host's "base sales: 320 loaf/week" (a label
    // and a unit they never typed). Re-pinned knowingly from that host sentence.
    expect(r.changes).toEqual([{ id: 'base_sales', kind: 'quantity', action: 'change', label: 'base sales', before: '300 loaves per week, in your words "We bake 300 loaves a week"',
      after: '320 loaves per week, in your words "320"', author: 'person', family: 'quantity' }]);
    const after = persisted!.living_model.canonical as CanonicalModelT;
    // C6 (27 Oct 2026): who approved it is recorded apart from who said it (a guest: neither known).
    // D074: the entry records the edit as entered on the canvas (re-pinned knowingly from 'superseded'); the replaced record is kept whole in `old`.
    expect(after.history.at(-1)).toEqual({ id: 'base_sales', change: 'entered', old: JSON.stringify(before.quantities.find((x) => x.id === 'base_sales')), quote: '320', author_id: null, approved_by: null });
    expect(after.quantities.find((x) => x.id === 'base_sales')).toMatchObject({ value: 320, author: 'person', quote: '320', approval: 'approved', status: 'known' });
    expect(persisted!.living_model.person_words.at(-1)).toBe('320');
    // Through the route, a goal's target typed on its card: saved, still no AI call.
    const t = await turn({ kind: 'system_event', event: { kind: 'goal_target_edit', goal_node_id: 'more_loaves', constraint_type: 'at_least', raw_value: 400, unit: 'loaf/week', base_graph_hash: hashOf(persisted) } });
    expect(t.statusCode, t.body).toBe(200);
    expect(sent).toHaveLength(0);
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'sales_target')).toMatchObject({ value: 400, author: 'person' });
  });

  // ── D074 (SPEC C6, "Source quote, contributor and approval actor stay distinct"): a figure typed on the canvas is saved in the
  // figure as entered (the edit receives a NUMBER, never the literal keystrokes: "100", or "80 to 100" for a range), and it is
  // theirs as set later by the edit's own history entry (`entered`), never by its words. The brief says "100" ("adds about 100
  // loaves a week"), so a typed 100 is found in the brief as words: it must still read as set by them. ──
  describe('D074: a figure typed on the canvas is theirs as set later, by its own history entry', () => {
    const nodeOf = (id: string) => (persisted!.nodes as Json[]).find((n) => n.id === id);
    const origin = (id: string) => { const n = nodeOf(id)!; return [n.provenance, n.observed_state?.source, n.source_quote]; };
    const canonicalNow = () => persisted!.living_model.canonical as CanonicalModelT;

    it('A1: base sales typed as 100, a figure the brief also says: saved as "100" (the figure as entered), read as set by them (user_set, user_override), never "from your brief"', async () => {
      replies = [JSON.stringify(bakery())];
      await turn({ message: BRIEF });
      expect(BRIEF).toContain('100');
      // Positive control: before the edit, the brief's figure reads as the brief's.
      expect(origin('base_sales')).toEqual(['from_brief', 'brief_extraction', 'We bake 300 loaves a week']);
      const r = await applyCanvasFigure({ dispatch }, SCENARIO, { target: { quantity_id: 'base_sales' }, value: 100, operation_key: randomUUID(), approver: null });
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'saved' });
      expect(r.changes?.[0]?.after).toBe('100 loaves per week, in your words "100"');
      expect(canonicalNow().quantities.find((x) => x.id === 'base_sales')).toMatchObject({ value: 100, author: 'person', quote: '100', approval: 'approved' });
      expect(persisted!.living_model.person_words.at(-1)).toBe('100');
      expect(canonicalNow().history.at(-1)).toMatchObject({ id: 'base_sales', change: 'entered', quote: '100' });
      // The collision: "100" is in the brief, and the figure is still theirs as set later ("Set by you").
      expect(origin('base_sales')).toEqual(['user_set', 'user_override', '100']);
      // Contrast: a figure quoted from the brief and never edited stays the brief's.
      expect(origin('ovens_added')).toEqual(['from_brief', 'brief_extraction', 'our one oven']);
    });

    it('A2: a goal\'s target it shares with another goal, typed as 100 on its card, is split into its own figure that keeps its canvas origin ("entered", replacing no record), never "brief_extraction"', async () => {
      const m = bakery();
      // A second goal on the same target figure, so a typed target is split off for the edited goal alone.
      m.goals.push({ ...m.goals[0]!, id: 'hold_loaves', label: 'Hold 380 loaves a week', quote: 'reach 380 loaves a week' });
      replies = [JSON.stringify(m)];
      expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
      expect(nodeOf('more_loaves')).toMatchObject({ provenance: 'from_brief', threshold_source: 'brief_extraction' });
      const edit = await turn({ kind: 'system_event', event: { kind: 'goal_target_edit', goal_node_id: 'more_loaves', constraint_type: 'at_least', raw_value: 100, unit: 'loaf/week', base_graph_hash: hashOf(persisted) } });
      expect([edit.statusCode, edit.json().error], edit.body).toEqual([200, null]);
      const saved = canonicalNow();
      // The split: the edited goal has its own target in the figure as entered; the other goal keeps the shared figure.
      expect(saved.goals.find((g) => g.id === 'more_loaves')!.measure!.target).toBe('more_loaves_target');
      expect(saved.quantities.find((x) => x.id === 'more_loaves_target')).toMatchObject({ value: 100, author: 'person', quote: '100', approval: 'approved' });
      expect(saved.quantities.find((x) => x.id === 'sales_target')).toMatchObject({ value: 380, quote: 'reach 380 loaves a week' });
      // Its history entry is the edit's own: entered, and replacing no record ("null"), never a predecessor it did not have.
      expect(saved.history.filter((h) => h.id === 'more_loaves_target')).toEqual([{ id: 'more_loaves_target', change: 'entered', old: 'null', quote: '100', author_id: null, approved_by: null }]);
      expect(saved.history.find((h) => h.id === 'more_loaves')).toMatchObject({ change: 'superseded', quote: 'want to reach 380 loaves a week' });
      // Their target as set later, though "100" is in the brief; the goal's own words stay the brief's.
      expect(nodeOf('more_loaves')).toMatchObject({ provenance: 'from_brief', threshold_source: 'user' });
      expect(nodeOf('more_loaves')!.threshold_source).not.toBe('brief_extraction');
      // Contrast: the other goal on the shared figure is untouched, and its target stays the brief's.
      expect(nodeOf('hold_loaves')).toMatchObject({ provenance: 'from_brief', threshold_source: 'brief_extraction' });
    });

    it('A3 (contrast): an approved change that only re-quotes a brief figure in other words of the brief, and a brief figure never edited, still read "from your brief"', async () => {
      replies = [JSON.stringify(bakery())];
      await turn({ message: BRIEF });
      const deps = { dispatch, proposals: new ProposalStore() };
      const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [], user_turn_text: 'Quote it as I put it.' };
      const longer = 'We bake 300 loaves a week with our one oven';
      expect(BRIEF).toContain(longer);
      replies = [savedWith((d) => setQ(d, 'base_sales', { quote: longer }))];
      const p = await proposeProgramChange(deps, ctx, { public_label: 'Their words', basis: 'their request', request: 'Quote base sales in the brief\'s fuller words.', remove: [] }) as Json;
      expect(p.status, JSON.stringify(p)).toBe('ok');
      expect(await applyProgramChange(deps, ctx, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
      // A quote-only change on an approved card: superseded, never entered, so the brief rule reads it, as before.
      expect(canonicalNow().history.at(-1)).toMatchObject({ id: 'base_sales', change: 'superseded', quote: longer });
      expect(origin('base_sales')).toEqual(['from_brief', 'brief_extraction', longer]);
      expect(origin('ovens_added')).toEqual(['from_brief', 'brief_extraction', 'our one oven']);
      // Positive control on the same board: a figure typed on the canvas after it reads as theirs as set later.
      expect(await applyCanvasFigure({ dispatch }, SCENARIO, { target: { quantity_id: 'base_sales' }, value: 100, operation_key: randomUUID(), approver: null })).toMatchObject({ status: 'saved' });
      expect(origin('base_sales')).toEqual(['user_set', 'user_override', '100']);
      expect(origin('ovens_added')).toEqual(['from_brief', 'brief_extraction', 'our one oven']);
    });

    it('A4: a range typed on the canvas is saved as "low to high" (both ends as entered) and is theirs as set later, though the brief says the same words', async () => {
      const brief = `${BRIEF} On a slow week we sell 80 to 100 fewer.`;
      replies = [JSON.stringify(bakery())];
      await turn({ message: brief });
      const r = await applyCanvasFigure({ dispatch }, SCENARIO, { target: { quantity_id: 'base_sales' }, value: null, low: 80, high: 100, operation_key: randomUUID(), approver: null });
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'saved' });
      expect(canonicalNow().quantities.find((x) => x.id === 'base_sales')).toMatchObject({ value: null, low: 80, high: 100, author: 'person', quote: '80 to 100' });
      expect(canonicalNow().history.at(-1)).toMatchObject({ id: 'base_sales', change: 'entered', quote: '80 to 100' });
      expect(brief).toContain('80 to 100');
      expect([nodeOf('base_sales')!.provenance, nodeOf('base_sales')!.source_quote]).toEqual(['user_set', '80 to 100']);
    });
  });

  // ── C6 (29 Oct, staging: a capacity card showed the agent's "Amend the existing…" as "in your words", though the person typed
  // only the staff-absence figure). The card shows whatever quote the drafter returns (S1 strip: no quote check, by design), so
  // the contract holds at the PRODUCER: the update call presents the agent's change as Olumi's instruction (developer role,
  // labelled), and the person's verified words, separately, as the only user-role message. A fake drafter that echoed the
  // instruction would still be shown: this row binds what the real update call sends instead. ──
  it('B1: the update call sends the agent\'s change as Olumi\'s instruction (developer role, labelled), never in a user-role message; the person\'s verified words are the only user-role message', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    sent.length = 0;
    const typed = 'About 20 loaves a week go to waste.';
    const request = 'Amend the existing sales calculation so the 20 loaves of weekly waste are taken off base sales, keeping their figure as given.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [typed], user_turn_text: typed };
    replies = [savedWith((d) => setQ(d, 'base_sales', { value: 280, quote: typed }))];
    const p = await proposeProgramChange(deps, ctx, { public_label: 'Waste', basis: 'their figure', request, remove: [] }) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(sent).toHaveLength(1);
    const input = sent[0]!.input as Json[];
    expect(input.map((x) => x.role)).toEqual(['user', 'assistant', 'developer']);
    // The person's verified words, where they always were: the brief and what they typed this turn, and nothing of the agent's.
    expect(input[0]).toEqual({ role: 'user', content: `${BRIEF}\n\n${typed}` });
    // The agent's instruction, said as Olumi's, in the developer role with the update's own text.
    expect(input[2]).toEqual({ role: 'developer', content: `${UPDATE_PREFIX}\n${UPDATE_CHANGE_LABEL} ${request}\nRemove: nothing` });
    expect(UPDATE_CHANGE_LABEL).toMatch(/^Olumi's instruction for this change \(written by Olumi, never their words/);
    // No user-role message carries any of the agent's words.
    expect(input.filter((x) => x.role === 'user').some((x) => String(x.content).includes('Amend the existing'))).toBe(false);
    // The card shows the person's own words as theirs.
    expect(p.data.changes.find((c: Json) => c.id === 'base_sales').after).toContain(`in your words "${typed}"`);
  });

  // ── HC0 (spec §3, "Authorship and acceptance are separate"): the route passed no user, so a card edit saved author_id null and
  // erased an earlier approver's id from the record. Every row on the REAL route, every record bound by its family and id. ──
  // C6 (27 Oct 2026): the editor types the figure, so they both said it (author_id) and approved it (approved_by), on the record
  // and its history entry; before C6 author_id alone held the approver.
  describe('HC0: a canvas edit on a program changes only the edited record, and records who edited it', () => {
    const EDITOR = 'user-hc0-editor';
    const EARLIER = 'user-hc0-earlier-approver';
    /** A canvas edit on the real route, from the caller the ownership hook admitted (none: a guest). */
    const cardEdit = (event: Json, caller?: string) => turn({ kind: 'system_event', event }, caller === undefined ? {} : { [CALLER_HEADER]: caller });
    /** Every record of a model by `family/id` (the families are the model's lists; its history is not a record). */
    const recordsOf = (m: CanonicalModelT): Map<string, Json> => new Map(Object.entries(m).filter(([k, v]) => k !== 'history' && Array.isArray(v))
      .flatMap(([f, rs]) => (rs as Json[]).map((r) => [`${f}/${String(r.id)}`, r] as const)));
    /** A record's host fields, in order, at any depth: each approval, and who approved it. */
    const hostOf = (r: unknown): string[] => JSON.stringify(r).match(/"(approval|author_id)":("[^"]*"|null)/g) ?? [];
    /** The saved draft as a person approved part of it before: every attribution of theirs (a link inside a relation too) by EARLIER; Olumi's left proposed. */
    const approvedEarlier = (): CanonicalModelT => {
      const mark = (v: unknown): unknown => (Array.isArray(v) ? v.map(mark) : v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Json).map(([k, x]) => [k, (v as Json).author !== 'person' ? mark(x) : k === 'approval' ? 'approved' : k === 'author_id' ? EARLIER : mark(x)])) : v);
      const m = persisted!.living_model.canonical as CanonicalModelT;
      persisted!.living_model.canonical = { ...m, ...Object.fromEntries(Object.entries(m).filter(([k, v]) => k !== 'history' && Array.isArray(v)).map(([k, v]) => [k, mark(v)])) };
      return persisted!.living_model.canonical as CanonicalModelT;
    };
    /** Every record but `edited`, by family and id, exactly as saved: the same ids, and each the same apart from its host fields AND in them. */
    const othersAsSaved = (was: Map<string, Json>, now: Map<string, Json>, edited: string) => {
      expect([...now.keys()]).toEqual([...was.keys()]);
      for (const [key, r] of was) {
        if (key === edited) continue;
        expect(withoutHost(now.get(key)), key).toEqual(withoutHost(r));
        expect(hostOf(now.get(key)), key).toEqual(hostOf(r));
      }
    };

    it('the edited figure is approved by the person who typed it (its author_id and its history entry\'s), in their typed words; the earlier approver stays in history; every other record is exactly as saved', async () => {
      replies = [JSON.stringify(bakery())];
      await turn({ message: BRIEF });
      sent.length = 0;
      const before = approvedEarlier();
      const was = recordsOf(before);
      // Positive control: the host-field probe sees both states before the edit, an earlier approver's records and Olumi's proposed ones.
      expect(new Set([...was.values()].flatMap(hostOf))).toEqual(new Set(['"approval":"approved"', `"author_id":"${EARLIER}"`, '"approval":"proposed"', '"author_id":null']));
      expect(was.get('quantities/base_sales')).toMatchObject({ value: 300, approval: 'approved', author_id: EARLIER });
      const edit = await cardEdit({ kind: 'factor_value_edit', target_id: 'base_sales', value: 320 }, EDITOR);
      expect([edit.statusCode, edit.json().error, edit.json()._agent?.program], edit.body).toEqual([200, null, true]);
      expect(sent).toHaveLength(0);
      const after = persisted!.living_model.canonical as CanonicalModelT;
      const now = recordsOf(after);
      // The edited record: their typed figure, in the figure as entered, approved by the editor (never by no one, never by the earlier approver).
      // D074 (C6): re-pinned knowingly from the host's "base sales: 320 loaf/week" to the figure as entered, and the entry from 'superseded' to 'entered'.
      expect(now.get('quantities/base_sales')).toEqual({ ...was.get('quantities/base_sales'), value: 320, quote: '320', approval: 'approved', approved_by: EDITOR, author_id: EDITOR });
      expect(after.history).toEqual([...before.history,
        { id: 'base_sales', change: 'entered', old: JSON.stringify(was.get('quantities/base_sales')), quote: '320', author_id: EDITOR, approved_by: EDITOR }]);
      // The earlier approver is never erased: the record they approved is kept whole in the edit's history entry.
      expect(JSON.parse(after.history.at(-1)!.old)).toMatchObject({ value: 300, quote: 'We bake 300 loaves a week', approval: 'approved', author_id: EARLIER });
      othersAsSaved(was, now, 'quantities/base_sales');
      expect([after.version, after.question, after.period]).toEqual([before.version, before.question, before.period]);
      // The editor is named on that record and its history entry (as who said it and who approved it), and nowhere else in the model.
      expect(JSON.stringify(after).split(EDITOR).length - 1).toBe(4);
    });

    it('a goal\'s target typed on its card: the target figure is approved by the editor, and the goal and every other record are exactly as saved', async () => {
      replies = [JSON.stringify(bakery())];
      await turn({ message: BRIEF });
      const before = approvedEarlier();
      const was = recordsOf(before);
      const edit = await cardEdit({ kind: 'goal_target_edit', goal_node_id: 'more_loaves', constraint_type: 'at_least', raw_value: 400, unit: 'loaf/week', base_graph_hash: hashOf(persisted) }, EDITOR);
      expect([edit.statusCode, edit.json().error], edit.body).toEqual([200, null]);
      const after = persisted!.living_model.canonical as CanonicalModelT;
      const now = recordsOf(after);
      // D074 (C6): re-pinned knowingly from the host's "Reach 380 loaves a week target: 400 loaf/week" to the figure as entered, and the entry to 'entered'.
      expect(now.get('quantities/sales_target')).toEqual({ ...was.get('quantities/sales_target'), value: 400, quote: '400', approval: 'approved', approved_by: EDITOR, author_id: EDITOR });
      expect(after.history.at(-1)).toEqual({ id: 'sales_target', change: 'entered', old: JSON.stringify(was.get('quantities/sales_target')), quote: '400', author_id: EDITOR, approved_by: EDITOR });
      othersAsSaved(was, now, 'quantities/sales_target');
    });

    it('a guest\'s edit (no caller id): approved by no one known (author_id null), never the earlier approver\'s id kept on a figure they did not approve, and every other record exactly as saved', async () => {
      replies = [JSON.stringify(bakery())];
      await turn({ message: BRIEF });
      const before = approvedEarlier();
      const was = recordsOf(before);
      const edit = await cardEdit({ kind: 'factor_value_edit', target_id: 'base_sales', value: 320 });
      expect([edit.statusCode, edit.json().error], edit.body).toEqual([200, null]);
      const after = persisted!.living_model.canonical as CanonicalModelT;
      const now = recordsOf(after);
      // D074 (C6): re-pinned knowingly from the host's "base sales: 320 loaf/week" to the figure as entered, and the entry to 'entered'.
      expect(now.get('quantities/base_sales')).toEqual({ ...was.get('quantities/base_sales'), value: 320, quote: '320', approval: 'approved', author_id: null });
      expect(after.history.at(-1)).toEqual({ id: 'base_sales', change: 'entered', old: JSON.stringify(was.get('quantities/base_sales')), quote: '320', author_id: null, approved_by: null });
      othersAsSaved(was, now, 'quantities/base_sales');
    });

    it('a figure typed inside the person\'s own stated range keeps their range (its ends and its reading), approved by the editor; on Olumi\'s range the single figure they type is theirs, with no range', async () => {
      const said = 'Most weeks we bake between 280 and 320 loaves.';
      const m = bakery();
      setQ(m, 'base_sales', { value: null, low: 280, high: 320, range_kind: 'bounds', quote: 'between 280 and 320 loaves' });
      replies = [JSON.stringify(m)];
      expect((await turn({ message: `${BRIEF} ${said}` })).json().model_program.saved).toBe(true);
      const was = recordsOf(approvedEarlier());
      expect(was.get('quantities/base_sales')).toMatchObject({ value: null, low: 280, high: 320, range_kind: 'bounds', author: 'person' });
      const inside = await cardEdit({ kind: 'factor_value_edit', target_id: 'base_sales', value: 310 }, EDITOR);
      expect([inside.statusCode, inside.json().error], inside.body).toEqual([200, null]);
      const now = recordsOf(persisted!.living_model.canonical as CanonicalModelT);
      // D074 (C6): what they entered on their own range is the one figure, "310"; re-pinned knowingly from the host's "base sales: 310 loaf/week, within 280 to 320".
      expect(now.get('quantities/base_sales')).toEqual({ ...was.get('quantities/base_sales'), value: 310, low: 280, high: 320, range_kind: 'bounds',
        quote: '310', approval: 'approved', approved_by: EDITOR, author_id: EDITOR });
      othersAsSaved(was, now, 'quantities/base_sales');
      // Contrast: Olumi's estimate is a range of Olumi's; the person types one figure, so the figure is theirs and the range goes.
      expect(now.get('quantities/sell_through')).toMatchObject({ value: 0.7, low: 0.5, high: 0.9, author: 'olumi', approval: 'proposed', author_id: null });
      const single = await cardEdit({ kind: 'factor_value_edit', target_id: 'sell_through', value: 0.8 }, EDITOR);
      expect([single.statusCode, single.json().error], single.body).toEqual([200, null]);
      const last = recordsOf(persisted!.living_model.canonical as CanonicalModelT);
      expect(last.get('quantities/sell_through')).toMatchObject({ value: 0.8, low: null, high: null, range_kind: null, status: 'known', author: 'person', approval: 'approved', author_id: EDITOR });
      othersAsSaved(now, last, 'quantities/sell_through');
    });

    it('contrast (inventory F1b): on a board that is not a program, the same edit from the same caller is refused as out of the alpha: never forwarded to a legacy turn route, and nothing is written', async () => {
      replies = [JSON.stringify(bakery())];
      await turn({ message: BRIEF });
      const { living_model: _program, ...plain } = persisted!;
      persisted = JSON.parse(JSON.stringify(plain)) as Json;
      expect(programReadOf(persisted).kind).toBe('none');
      const saves = registered.length;
      sent.length = 0;
      const event = { kind: 'factor_value_edit', target_id: 'base_sales', value: 320 };
      const edit = await turn({ kind: 'system_event', event }, { [CALLER_HEADER]: EDITOR, authorization: 'Bearer hc0-caller' });
      expect(edit.statusCode, edit.body).toBe(409);
      expect(edit.json()).toMatchObject({ error: { code: 'legacy_scenario', nothing_saved: true }, _agent: { forwarded_kind: 'system_event' } });
      expect(legacyForwards).toHaveLength(0);
      expect([registered.length, sent.length]).toEqual([saves, 0]);
      expect(persisted).toEqual(plain);
    });
  });

  // ── C6 (alpha spec §7, §3; 27 Oct 2026): accepting changes acceptance, never who said it. Source words, contributor
  // (author_id) and approval actor (approved_by) are three facts. Every row on the real path, every record bound by its id. ──
  describe('C6: who said it and who approved it stay separate', () => {
    const APPROVER = 'user-c6-approver';
    const EARLIER = 'user-c6-earlier-contributor';
    const byId = (m: CanonicalModelT, family: 'quantities' | 'relations' | 'goals' | 'limits', id: string) => (m[family] as readonly Json[]).find((r) => r.id === id)!;
    const host = (r: Json) => ({ author: r.author, party: r.party, quote: r.quote, approval: r.approval, author_id: r.author_id, approved_by: r.approved_by });

    it('confirming the first reading accepts Olumi\'s estimates as Olumi\'s: value, author and words untouched, author_id null, the approver recorded apart; the brief\'s own records are said by its writer', async () => {
      replies = [JSON.stringify(bakery())];
      const proposals = new ProposalStore();
      const out = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch, proposals, userId: APPROVER });
      expect(out.toolCalls[1]).toMatchObject({ name: 'confirm_reading', ok: true });
      expect(await applyProgramChange({ dispatch, proposals }, { scenario_id: SCENARIO, authenticated_user_id: APPROVER, turn_id: randomUUID() }, out.toolCalls[1]!.proposal_id!))
        .toMatchObject({ status: 'ok', data: { saved: true } });
      const m = persisted!.living_model.canonical as CanonicalModelT;
      // Olumi's estimate: accepted, by the approver; its figure and its author exactly as drafted, and said by no person.
      expect(byId(m, 'quantities', 'sell_through')).toMatchObject({ value: 0.7, low: 0.5, high: 0.9, range_kind: 'plausible', status: 'estimated' });
      expect(host(byId(m, 'quantities', 'sell_through'))).toEqual({ author: 'olumi', party: null, quote: null, approval: 'approved', author_id: null, approved_by: APPROVER });
      expect(host(byId(m, 'relations', 'sold_rel'))).toEqual({ author: 'olumi', party: null, quote: null, approval: 'approved', author_id: null, approved_by: APPROVER });
      // Contrast: a figure in the brief's words is said by the person who wrote the brief; one of theirs with no words is said by no one known.
      expect(host(byId(m, 'quantities', 'base_sales'))).toEqual({ author: 'person', party: null, quote: 'We bake 300 loaves a week', approval: 'approved', author_id: APPROVER, approved_by: APPROVER });
      expect(host(byId(m, 'quantities', 'oven_price'))).toEqual({ author: 'person', party: null, quote: null, approval: 'approved', author_id: null, approved_by: APPROVER });
      // A link in the person's words inside Olumi's relation: each carries its own.
      const link = byId(m, 'relations', 'sales_rel');
      expect([host(link), host(link.terms[0])]).toEqual([{ author: 'olumi', party: null, quote: null, approval: 'approved', author_id: null, approved_by: APPROVER },
        { author: 'person', party: null, quote: 'A second oven adds about 100 loaves a week', approval: 'approved', author_id: APPROVER, approved_by: APPROVER }]);
    });

    it('a card approved by one person keeps an earlier contributor on a record whose words it does not change; a figure they restate in this turn\'s words is said by them; each history entry carries both', async () => {
      replies = [JSON.stringify(bakery())];
      expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
      // As saved after an earlier person stated and confirmed the brief: every record of theirs (a link too) said and approved by EARLIER.
      const mark = (v: unknown): unknown => (Array.isArray(v) ? v.map(mark) : v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Json).map(([k, x]) => [k, (v as Json).author !== 'person' ? mark(x) : k === 'approval' ? 'approved'
          : k === 'author_id' || k === 'approved_by' ? EARLIER : mark(x)])) : v);
      const m0 = persisted!.living_model.canonical as CanonicalModelT;
      persisted!.living_model.canonical = { ...m0, ...Object.fromEntries(Object.entries(m0).filter(([k, v]) => k !== 'history' && Array.isArray(v)).map(([k, v]) => [k, mark(v)])) };
      const before = persisted!.living_model.canonical as CanonicalModelT;
      expect(host(byId(before, 'goals', 'more_loaves'))).toMatchObject({ author_id: EARLIER, approved_by: EARLIER });
      const words = 'We now bake 320 loaves a week. Call the goal reach 380 loaves every week.';
      const deps = { dispatch, proposals: new ProposalStore() };
      const ctx = { scenario_id: SCENARIO, authenticated_user_id: APPROVER, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
      replies = [savedWith((d) => { setQ(d, 'base_sales', { value: 320, quote: 'We now bake 320 loaves a week' }); d.goals = d.goals.map((g) => ({ ...g, label: 'Reach 380 loaves every week' })); })];
      const p = await proposeProgramChange(deps, ctx, { public_label: 'Base sales and the goal', basis: 'their words', request: words, remove: [] }) as Json;
      expect(p.status, JSON.stringify(p)).toBe('ok');
      expect(p.data.changes.map((c: Json) => [c.id, c.action])).toEqual([['base_sales', 'change'], ['more_loaves', 'change']]);
      expect(await applyProgramChange(deps, ctx, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
      const after = persisted!.living_model.canonical as CanonicalModelT;
      // Restated in this turn's words: said by the approver, who also approved it.
      expect(byId(after, 'quantities', 'base_sales')).toMatchObject({ value: 320 });
      expect(host(byId(after, 'quantities', 'base_sales'))).toEqual({ author: 'person', party: null, quote: 'We now bake 320 loaves a week', approval: 'approved', author_id: APPROVER, approved_by: APPROVER });
      // Renamed, its words unchanged: still said by EARLIER, now approved by the approver (never made its author).
      expect(byId(after, 'goals', 'more_loaves')).toMatchObject({ label: 'Reach 380 loaves every week' });
      expect(host(byId(after, 'goals', 'more_loaves'))).toEqual({ author: 'person', party: null, quote: 'want to reach 380 loaves a week', approval: 'approved', author_id: EARLIER, approved_by: APPROVER });
      // Contrast: a record the card does not touch is exactly as saved.
      expect(byId(after, 'quantities', 'budget')).toEqual(byId(before, 'quantities', 'budget'));
      expect(after.history.slice(before.history.length)).toEqual([
        { id: 'base_sales', change: 'superseded', old: JSON.stringify(byId(before, 'quantities', 'base_sales')), quote: 'We now bake 320 loaves a week', author_id: APPROVER, approved_by: APPROVER },
        { id: 'more_loaves', change: 'superseded', old: JSON.stringify(byId(before, 'goals', 'more_loaves')), quote: 'want to reach 380 loaves a week', author_id: EARLIER, approved_by: APPROVER }]);
    });
  });

  it('an UNREADABLE program (it claims model_program but is not v1) is refused with its way on: never run as legacy or as no model', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    persisted = { ...persisted!, living_model: { ...persisted!.living_model, model_program: 'v9' } };
    const saves = registered.length;
    sent.length = 0;
    const r = await turn({ message: 'What is the chance now?' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'MODEL_PROGRAM_UNREADABLE', nothing_saved: true });
    expect(r.json().error.message).toContain('Nothing was changed. You can start a new scenario from your brief');
    const edit = await turn({ kind: 'system_event', event: { kind: 'factor_value_edit', target_id: 'base_sales', value: 320 } });
    expect([edit.statusCode, edit.json().error.code]).toEqual([409, 'MODEL_PROGRAM_UNREADABLE']);
    expect([sent.length, registered.length]).toEqual([0, saves]);
    // The store reads it as unreadable, never as a program and never as none.
    expect(programReadOf(persisted).kind).toBe('unreadable');
    expect(programReadOf({ ...persisted, living_model: { ...persisted!.living_model, model_program: 'v1', canonical: { version: 'canonical.v1' } } }).kind).toBe('unreadable');
    expect(programReadOf({ nodes: [], edges: [], living_model: { aims: [] } }).kind).toBe('none'); // contrast: a legacy living model
  });

  it('an approximate answer ("about £2,500") is the person\'s figure, used for now: the words say so and the AI asks for its range (no code question); their own range is their range', () => {
    const words = 'It would cost about £2,500.';
    const answered = (f: Partial<CanonicalQuantityT>) => { const m = bakery(); setQ(m, 'oven_price', { status: 'known', question: null, approval: 'approved', ...f }); return m; };
    const approx = answered({ value: 2500, quote: words, basis: APPROXIMATE_FIGURE });
    const r = compile(approx, { sourceText: `${BRIEF}\n${words}` });
    // S1 A4: no question of the code's, and nothing waits on it; a range is asked for. Round 2 (27 Oct, consolidation): the rule is the
    // drafter's (its step 6), no longer the program instructions'.
    expect(r.blockers.some((b) => b.id === 'oven_price')).toBe(false);
    expect(JSON.stringify(r)).not.toContain('What range would you put on it');
    expect(DRAFTING_INSTRUCTIONS.split('Ask for a range when a supplied approximate point feeds a goal or limit.')).toHaveLength(2);
    expect(programInstructions()).not.toContain('If that figure feeds a goal or a limit, ask what range they would put on it.');
    expect(r.within_limits.status).toBe('calculable'); // the range asked for holds nothing back
    expect(r.conversions.some((c) => c.quantity === 'oven_price')).toBe(false);
    const view = evaluateCanonical(approx, { sourceText: `${BRIEF}\n${words}`, seed: 7 }).view as Json;
    expect(JSON.stringify(view)).toContain('It also uses £2,500 per oven for ‘oven price’ for now — you said ‘It would cost about £2,500.’');
    expect(JSON.stringify(view)).not.toContain('your range');
    expect(JSON.stringify(view)).not.toContain('as you stated it');
    // Contrast: the ends in their own words are their range, read as theirs, and no range is asked for.
    const ranged = answered({ value: null, low: 2250, high: 2750, range_kind: 'bounds', quote: 'between £2,250 and £2,750' });
    expect(compile(ranged, { sourceText: `${BRIEF}\nbetween £2,250 and £2,750` }).blockers.some((b) => b.id === 'oven_price')).toBe(false);
  });

  it('round 1 (DL 27 Oct): a FIRST DRAFT that marks a rough figure of theirs with APPROXIMATE_FIGURE is kept end to end (normalise, compile, asDrafted, validatePostimage, postimageOf, the real turn): their figure, used for now, never stripped or refused as the host\'s mark', async () => {
    // "A second oven adds about 100 loaves a week": the drafter writes it as the prompt's approximate single figure.
    const drafted = bakery();
    setQ(drafted, 'extra_per_oven', { basis: APPROXIMATE_FIGURE });
    const mark = { status: 'known', value: 100, low: null, high: null, range_kind: null, author: 'person', quote: 'adds about 100 loaves a week', basis: APPROXIMATE_FIGURE };
    const ofIt = (m: CanonicalModelT) => m.quantities.find((x) => x.id === 'extra_per_oven')!;
    const read = normalise(drafted);
    expect(ofIt(read)).toMatchObject(mark);
    expect(isApproximate(ofIt(read))).toBe(true);
    const compiled = compile(read, { sourceText: BRIEF });
    expect(compiled.errors).toEqual([]);
    expect(compiled.executable!.quantities.find((x) => x.id === 'extra_per_oven')!.dist).toEqual({ kind: 'fixed', value: 100, author: 'person' }); // a point, no invented range
    const saved = asDrafted(read);
    expect(ofIt(saved)).toMatchObject(mark);
    // A postimage that only adds the mark is a change the card shows, never refused.
    const marking = validatePostimage(asDrafted(normalise(bakery())), saved, { removals: [], words: [BRIEF], fresh: [] });
    expect(marking, JSON.stringify(marking)).toMatchObject({ ok: true, changes: [{ id: 'extra_per_oven', action: 'change', before: 'no basis given', after: `based on "${APPROXIMATE_FIGURE}"`, author: 'person' }] });
    const shown = JSON.stringify(postimageOf({ model_program: MODEL_PROGRAM, canonical: saved, person_words: [BRIEF], seed: 7, runs: [] } as Parameters<typeof postimageOf>[0]));
    expect(shown).toContain('for now — you said “adds about 100 loaves a week”');
    // The real first-draft turn saves and runs it as drafted.
    replies = [JSON.stringify(drafted)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    expect(ofIt(persisted!.living_model.canonical as CanonicalModelT)).toMatchObject(mark);
    expect(JSON.stringify(persisted)).toContain('for now — you said “adds about 100 loaves a week”');
    expect(JSON.stringify(persisted!.living_model.runs[0].result.canonical_analysis_view)).toContain('for now — you said ‘adds about 100 loaves a week’');
    // Contrast: the same draft without the mark is their exact figure, never "for now".
    const plain = JSON.stringify(postimageOf({ model_program: MODEL_PROGRAM, canonical: asDrafted(normalise(bakery())), person_words: [BRIEF], seed: 7, runs: [] } as Parameters<typeof postimageOf>[0]));
    expect(plain).not.toContain('for now — you said');
  });

  it('the agent\'s context after a cold reopen is the model AS AUTHORED: relations, coefficient basis and range kind, goal windows, option timing, the qualitative records, and the Run\'s goal_chance unchanged', async () => {
    const brief = `${CLUB_BRIEF} Sam thinks promotions never last.`;
    const m = club();
    m.dissent = [{ id: 'sam_doubts', holder: 'Sam', position: 'Promotions never last.', concerns: ['promotion'], author: 'person', party: null, quote: 'Sam thinks promotions never last', approval: 'proposed', approved_by: null, author_id: null }];
    replies = [JSON.stringify(m)];
    expect((await turn({ message: brief })).json().model_program.saved).toBe(true);
    vi.resetModules();
    const tools = await import('../program-tools.js');
    const read = await tools.readProgramContext({ dispatch, proposals: new ProposalStore() }, { scenario_id: SCENARIO, authenticated_user_id: null }) as Json;
    expect(read.status).toBe('ok');
    const model = read.data.model as Json;
    expect(model.relations).toEqual(JSON.parse(JSON.stringify(m.relations, (_k, v) => (v === null ? undefined : v))));
    expect(model.relations[0].terms[0]).toEqual({ driver: 'promo_on', coefficient: 'promo_effect', author: 'olumi', approval: 'proposed' });
    expect(model.quantities.find((x: Json) => x.id === 'promo_effect')).toMatchObject({ kind: 'coefficient', author: 'olumi', low: 3, high: 7, range_kind: 'plausible',
      basis: 'Promotions at clubs this size bring a few extra joins a month.' });
    expect(model.goals[0].measure).toMatchObject({ frame: 'level', aggregation: 'end', window: { start: 0, periods: 'months' } });
    expect(model.options[0].sets.map((x: Json) => x.starts_after_periods)).toEqual([0, 0]);
    expect(model.dissent).toEqual([{ id: 'sam_doubts', holder: 'Sam', position: 'Promotions never last.', concerns: ['promotion'], author: 'person', quote: 'Sam thinks promotions never last', approval: 'proposed' }]);
    expect(JSON.stringify(model)).not.toContain(':null');
    // The Run's goal_chance block, as stored.
    const stored = persisted!.living_model.runs[0].result.canonical_analysis_view as Json;
    expect(stableStringify(read.data.run.goal_chance)).toBe(stableStringify(stored.goal_chance));
  });

  it('buddy #3709 r7, S1 strip (B2, B7 off): a first draft is saved, receipted and read back AS THE AI WROTE IT — a structure figure no one stated stays the AI\'s structure, with no repair', async () => {
    const m = bakery();
    m.quantities.push(q('current_output', 'loaf/week', { author: 'structure', value: 12 }), q('extra', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }));
    m.relations.push({ form: 'definition', id: 'extra_rel', defines: 'extra', op: 'sum', parts: [{ id: 'current_output', sign: 1 }], author: 'olumi', quote: null, ...at });
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect(drafterCalls()).toHaveLength(1);
    expect(r.model_program.draft.attempts.map((a: Json) => a.errors.length)).toEqual([0]);
    const asWritten = { author: 'structure', status: 'known', value: 12 };
    expect(persisted!.living_model.canonical.quantities.find((x: Json) => x.id === 'current_output')).toMatchObject(asWritten);
    vi.resetModules();
    const tools = await import('../program-tools.js');
    const read = await tools.readProgramContext({ dispatch, proposals: new ProposalStore() }, { scenario_id: SCENARIO, authenticated_user_id: null }) as Json;
    expect((read.data.model as Json).quantities.find((x: Json) => x.id === 'current_output')).toMatchObject(asWritten);
    expect(((read.data.blockers ?? []) as Json[]).find((b) => b.id === 'current_output')).toBeUndefined();
  });

  it('issue 40 (marketing-r1), S1 strip (B2, B7 off): a first draft with a structural 0 as a limit\'s floor is saved on its first attempt, the floor as written', async () => {
    const m = bakery();
    m.quantities.push(q('spend_floor', 'GBP', { author: 'structure', value: 0, basis: 'Nothing spent yet.' }));
    m.limits.push({ ...m.limits[0]!, id: 'floor', label: 'Spend no less than the floor', measure: { ...m.limits[0]!.measure!, cmp: '>=', bound: 'spend_floor' } });
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    const attempts = (r.model_program.draft.attempts as Json[]).map((a) => (a.errors as Json[]).map((e) => [e.code, e.items]));
    expect(attempts).toEqual([[]]);
    expect(drafterCalls()).toHaveLength(1);
    expect(r.model_program.saved).toBe(true);
    expect(persisted!.living_model.canonical.quantities.find((x: Json) => x.id === 'spend_floor')).toMatchObject({ author: 'structure', status: 'known', value: 0 });
  });

  it('several goals: each goal\'s own chance and the joint ride the Run\'s goal_chance unchanged through read, propose, apply and run', async () => {
    const brief = `${CLUB_BRIEF} And keep at least 320 members.`;
    const m = club();
    m.quantities.push(q('floor', 'member', { value: 320, quote: 'at least 320 members' }));
    m.goals.push({ ...m.goals[0]!, id: 'keep_320', label: 'Keep at least 320 members', measure: { ...m.goals[0]!.measure!, target: 'floor' }, quote: 'keep at least 320 members' });
    replies = [JSON.stringify(m)];
    expect((await turn({ message: brief })).json().model_program.saved).toBe(true);
    const goalChance = () => (persisted!.living_model.runs.at(-1).result.canonical_analysis_view as Json).goal_chance;
    expect(goalChance().targets.per_target).toHaveLength(2);
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: ['Make it 11 leaving each month.'], user_turn_text: 'Make it 11 leaving each month.' };
    const read = await readProgramContext(deps, ctx) as Json;
    expect(stableStringify(read.data.run.goal_chance)).toBe(stableStringify(goalChance()));
    replies = [savedWith((m) => setQ(m, 'leavers', { value: 11, quote: '11 leaving each month' }))];
    const p = await proposeProgramChange(deps, ctx, { public_label: 'Leavers 11', basis: 'they said so', request: 'Leavers are 11 a month.', remove: [] }) as Json;
    const frozen = (deps.proposals.get(p.data.proposal_id)!.living_model as Json).runs.at(-1).result.canonical_analysis_view.goal_chance;
    expect(stableStringify(p.data.would_show.goal_chance)).toBe(stableStringify(frozen));
    const a = await applyProgramChange(deps, ctx, p.data.proposal_id) as Json;
    expect(stableStringify(a.data.run.goal_chance)).toBe(stableStringify(goalChance()));
    const run = await runProgram(deps, ctx) as Json;
    expect([run.data.stored, stableStringify(run.data.run.goal_chance)]).toEqual([true, stableStringify(goalChance())]);
  });

  it('an open question on how to read a range is answered through the same update path: only its reading changes; its ends, words and author stay; their answer is kept', async () => {
    const brief = `${BRIEF} Each extra oven brings between 80 and 120 loaves a week.`;
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'extra_per_oven' ? { ...x, value: null, low: 80, high: 120, range_kind: null, quote: 'between 80 and 120 loaves a week' } : x));
    replies = [JSON.stringify(m)];
    const drafted = (await turn({ message: brief })).json();
    expect(drafted.model_program.blockers.find((x: Json) => x.id === 'extra_per_oven')).toMatchObject({ code: 'range_kind' });
    const words = 'Those are firm ends: never fewer than 80, never more than 120.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    replies = [savedWith((d) => setQ(d, 'extra_per_oven', { range_kind: 'bounds' }))];
    // The args as the agent's tool schema admits them (the SDK parses every call with it).
    const p = await proposeProgramChange(deps, ctx, ProgramChangeParams.parse({ public_label: 'Read 80–120 as firm', basis: 'their answer', request: 'Their 80 to 120 are firm ends.', remove: [] })) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(p.data.changes).toEqual([{ id: 'extra_per_oven', kind: 'quantity', action: 'change', label: 'extra per oven', before: 'from 80 to 120 loaves per oven per week',
      after: 'from 80 to 120 loaves per oven per week (firm ends)', author: 'person', family: 'quantity' }]);
    expect(await applyProgramChange(deps, ctx, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = (persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'extra_per_oven')!;
    expect(after).toMatchObject({ low: 80, high: 120, range_kind: 'bounds', author: 'person', quote: 'between 80 and 120 loaves a week' });
    expect((persisted!.living_model.canonical as CanonicalModelT).history.at(-1)).toMatchObject({ id: 'extra_per_oven', change: 'superseded' });
    expect(persisted!.living_model.person_words.at(-1)).toBe(words);
    const blockers = (persisted!.living_model.runs.at(-1).result.compile as Json).blockers as Json[];
    expect(blockers.some((x) => x.id === 'extra_per_oven')).toBe(false);
  });

  it('words#4, S1 strip (A20b off): a figure outside Olumi\'s bound is no recount; the agent reads the stored Run\'s blockers as stored, an older Run\'s recount and reason included, no bound filled in', async () => {
    // Olumi's reading of what the bakery sells today (synthetic): never above 250 loaves a week, so their 300 is outside it.
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'base_sales' ? { ...x, ceiling: 250 } : x));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null };
    const read = await readProgramContext(deps, ctx) as Json;
    // An asked figure's blocker has no reason; what to ask is the AI's.
    expect(read.data.blockers).toEqual([{ id: 'oven_price', code: 'asked', scope: ['within_budget'] }]);
    // A Run stored before the strip, holding a recount (with its reason, then without): read as it was stored.
    const stored = { id: 'base_sales', code: 'recount', scope: ['more_loaves'], reason: '"base sales" is given as 300 loaf/week, but Olumi reads it as never above 250 loaf/week' };
    const blockers = (persisted!.living_model.runs.at(-1).result.compile as Json).blockers as Json[];
    blockers.unshift(stored);
    expect(((await readProgramContext(deps, ctx)) as Json).data.blockers).toEqual([stored, { id: 'oven_price', code: 'asked', scope: ['within_budget'] }]);
    for (const b of blockers) delete b.reason;
    const old = await readProgramContext(deps, ctx) as Json;
    expect(old.data.blockers).toEqual([{ id: 'base_sales', code: 'recount', scope: ['more_loaves'] }, { id: 'oven_price', code: 'asked', scope: ['within_budget'] }]);
  });

  it('Codex r1 #3709 (2), S1 strip (A25 off): the PRESENTED Run says "on your figures" for a figure the AI labels theirs, whether or not its words are found', () => {
    // The club with the promotion's effect given as the person's own figure (5 a month): theirs by its label, with or without
    // their words (authorship is the AI's alone; misattribution is a known issue, not corrected by code).
    const m = club();
    m.quantities = m.quantities.map((x) => (x.id === 'promo_effect' ? { ...x, status: 'known', author: 'person', low: null, high: null, range_kind: null, basis: null, quote: 'five extra joins a month' } : x));
    // Both relations and the term are the person's too, so every other input is theirs.
    m.relations = m.relations.map((r) => (r.form === 'effect' ? { ...r, author: 'person', quote: '20 join each month', terms: r.terms.map((t) => ({ ...t, author: 'person', quote: 'Run a promotion' })) }
      : { ...r, author: 'person', quote: '20 join each month and 10 leave each month' }));
    // R8: "on your figures" needs their reading confirmed too, so the contrast is the model as accepted.
    const confirmed = JSON.parse(JSON.stringify(m).replaceAll('"approval":"proposed"', '"approval":"approved"')) as CanonicalModelT;
    const face = (sourceText: string) => ((evaluateCanonical(confirmed, { sourceText, seed: 7 }).view as Json).options as Json[]).find((o) => o.option_id === 'promotion')!.cell.face as string;
    expect(face(`${CLUB_BRIEF} The promotion brings five extra joins a month.`)).toContain(', in this model. It rests on your figures.');
    const unfound = face(CLUB_BRIEF);
    expect(unfound).toContain(', in this model. It rests on your figures.');
    expect(unfound).not.toContain('not found in your words');
  });

  describe('R8: a result\'s basis names the premises and Olumi\'s figures it rests on (real path: compile → simulate → present)', () => {
    const HALL = `${CLUB_BRIEF} The council must let us use the hall.`;
    const OWN = `${CLUB_BRIEF} The promotion brings five extra joins a month.`;
    const faceOf = (m: CanonicalModelT, sourceText: string, option = 'promotion') =>
      ((evaluateCanonical(m, { sourceText, seed: 7 }).view as Json).options as Json[]).find((o) => o.option_id === option)!.cell.face as string;
    const approved = (m: CanonicalModelT) => JSON.parse(JSON.stringify(m).replaceAll('"approval":"proposed"', '"approval":"approved"')) as CanonicalModelT;
    /** The club with every figure, relation and link the person's own (the promotion's effect given in their words). */
    const allTheirs = () => {
      const m = club();
      m.quantities = m.quantities.map((x) => (x.id === 'promo_effect' ? { ...x, status: 'known', author: 'person', low: null, high: null, range_kind: null, basis: null, quote: 'five extra joins a month' } : x));
      m.relations = m.relations.map((r) => (r.form === 'effect' ? { ...r, author: 'person', quote: '20 join each month', terms: r.terms.map((t) => ({ ...t, author: 'person', quote: 'Run a promotion' })) }
        : { ...r, author: 'person', quote: '20 join each month and 10 leave each month' }));
      return m;
    };
    /** Their prerequisite, accepted. */
    const hall = { id: 'hall', text: 'The council must let us use the hall.', kind: 'prerequisite' as const, concerns: ['reach_340'], author: 'person' as const, quote: 'The council must let us use the hall', ...at, approval: 'approved' as const };

    it('a confirmed reported assumption or condition keeps its named speaker in the real result, never becoming yours', () => {
      for (const kind of ['assumption', 'condition'] as const) {
        const m = approved(allTheirs()), party = 'Our treasurer';
        const text = kind === 'assumption' ? 'Membership fees stay the same.' : hall.text;
        const quote = text.slice(0, -1), source = `${OWN} ${party} says: ${text} And keep at least 320 members.`;
        m.quantities.push(q('floor', 'member', { value: 320, quote: 'at least 320 members', approval: 'approved' }));
        m.goals.push({ ...m.goals[0]!, id: 'keep_320', label: 'Keep at least 320 members', measure: { ...m.goals[0]!.measure!, target: 'floor' }, quote: 'keep at least 320 members' });
        if (kind === 'assumption') m.assumptions.push({ id: 'fees', text, applied: true, concerns: ['reach_340'], author: 'person', quote, ...at, party, approval: 'approved' });
        else m.conditions.push({ ...hall, party });
        const v = evaluateCanonical(m, { sourceText: source, seed: 7 }).view as Json;
        const face = (v.options as Json[]).find((o) => o.option_id === 'promotion')!.cell.face as string;
        const premise = `${party}’s ${kind} ‘${quote}’ ${kind === 'assumption' ? 'holds' : 'is met'}`;
        expect(face).toContain(premise);
        expect(v.goal_chance.targets.per_target[0].words).toContain(premise);
        expect(face).not.toContain(`your ${kind}`);
        expect(face).not.toContain('(not yet confirmed)');
      }
    });

    it('a wrapped prerequisite stays on one line throughout a multi-goal result, including its joint and notes', () => {
      const m = approved(allTheirs()), wrapped = 'The council must let us\nuse the hall.';
      m.quantities.push(q('floor', 'member', { value: 320, quote: 'at least 320 members', approval: 'approved' }));
      m.goals.push({ ...m.goals[0]!, id: 'keep_320', label: 'Keep at least 320 members', measure: { ...m.goals[0]!.measure!, target: 'floor' }, quote: 'keep at least 320 members' });
      m.conditions.push({ ...hall, text: wrapped, quote: wrapped.slice(0, -1), concerns: ['reach_340', 'keep_320'] });
      const source = `${OWN} ${wrapped} And keep at least 320 members.`;
      const v = evaluateCanonical(m, { sourceText: source, seed: 7 }).view as Json;
      const detail = v.goal_chance, premise = 'your condition ‘The council must let us use the hall’ is met';
      expect(detail.targets.per_target).toHaveLength(2);
      for (const target of detail.targets.per_target) {
        expect(target.words).toContain(premise);
        expect(target.words).not.toMatch(/[\r\n]/);
      }
      expect(detail.targets.joint.status).toBe('licensed');
      expect(detail.targets.joint.words).not.toMatch(/[\r\n]/);
      expect(detail.chance_words).not.toMatch(/[\r\n]/);
      for (const o of v.options) {
        expect(o.cell.face).toContain(premise);
        expect(o.cell.face).not.toMatch(/[\r\n]/);
      }
      // An unmeasured aim withholds the whole chance: it has a joint line, never joint words or a partial chance.
      m.goals.push({ ...m.goals[0]!, id: 'welcoming', label: 'Keep the hall\nwelcoming', measure: null, question: 'How would you measure a welcoming hall?', quote: 'Keep the hall\nwelcoming' });
      const waiting = evaluateCanonical(m, { sourceText: `${source} Keep the hall\nwelcoming.`, seed: 7 }).view as Json;
      expect(waiting.goal_chance.targets.joint.status).toBe('withheld');
      expect(waiting.goal_chance.targets.joint.line).not.toMatch(/[\r\n]/);
      expect(waiting.goal_chance.chance_words).toBeUndefined();
      expect(waiting.goal_chance.notes.length).toBeGreaterThan(0);
      for (const note of waiting.goal_chance.notes) expect(note).not.toMatch(/[\r\n]/);
      expect(waiting.goal_chance.notes.join(' ')).toContain('Keep the hall welcoming');
      expect(waiting.goal_chance.waits_on.find((b: Json) => b.id === 'welcoming').label).toBe('Keep the hall welcoming');
      for (const target of waiting.goal_chance.targets.per_target) expect(target.words).not.toMatch(/[\r\n]/);
      for (const o of waiting.options) {
        expect(o.cell.kind).toBe('withheld');
        expect(o.cell.why).not.toMatch(/[\r\n]/);
      }
      expect(m.conditions[0]!.text).toBe(wrapped);
    });

    it('a waiting-only result also keeps its blocker labels and notes on one line without changing the model', () => {
      // Keep the option's spending limit and settings intact. Both the sales and oven-price inputs are asked, so this
      // compiles but has no calculable goal or limit; removing the limit instead would orphan its option setting.
      const m = bakery(), label = 'Current\n sales';
      m.quantities = m.quantities.map((x) => x.id === 'base_sales'
        ? { ...x, label, value: null, status: 'asked', quote: null, question: 'How many loaves do you sell a week now?' } : x);
      const result = evaluateCanonical(m, { sourceText: BRIEF.replace('300 loaves a week', 'our current sales'), seed: 7 });
      expect(result.compiled.errors).toEqual([]);
      expect(result.sim).toBeNull();
      const v = result.view as Json;
      expect(v.goal_chance.waits_on.find((b: Json) => b.id === 'base_sales').label).toBe('Current sales');
      expect(v.goal_chance.notes.length).toBeGreaterThan(0);
      for (const note of v.goal_chance.notes) expect(note).not.toMatch(/[\r\n]/);
      for (const o of v.options) {
        expect(o.cell.kind).toBe('withheld');
        expect(o.cell.why).toContain('‘Current sales’');
        expect(o.cell.why).not.toMatch(/[\r\n]/);
      }
      expect(m.quantities.find((x) => x.id === 'base_sales')!.label).toBe(label);
    });

    it('a stated condition and an Olumi estimate: the basis names both, never "on your figures"', () => {
      const m = approved(club());
      m.conditions.push(hall);
      const face = faceOf(m, HALL);
      // The club's members stock is Olumi's (accepted, but never theirs): Olumi's reading, named, with no "(not yet confirmed)".
      expect(face).toContain(', in this model. It rests on Olumi’s reading of ‘members’. It assumes your condition ‘The council must let us use the hall’ is met. It also assumes ‘promo effect’ follows Olumi’s provisional reading of '
        + 'Olumi’s own estimated range, 3 to 7 members per promotion per month, as the range it falls in 8 times out of 10, with 5 members per promotion per month as the middle value. '
        + 'It also assumes ‘joins’ follows Olumi’s assumed relationship.');
      expect(face).not.toContain('on your figures');
      // The exact 0% names it too, before what fixes it.
      expect(faceOf(m, HALL, 'carry_on')).toContain(', in this model. It rests on Olumi’s reading of ‘members’. It assumes your condition ‘The council must let us use the hall’ is met. It also assumes ‘promo effect’');
    });

    it('integrated review 26 Oct: an applied assumption on a risk is a premise of what the risk reaches: named, never "on your figures"', () => {
      const RISK = `${OWN} There is a one in five chance of a quiet month when five more leave.`;
      const m = allTheirs();
      m.quantities.push(q('quiet_chance', '1', { value: 0.2, quote: 'a one in five chance' }), q('quiet_extra', 'member/month', { value: 5, quote: 'five more leave' }));
      m.risks.push({ id: 'quiet_month', label: 'A quiet month', occurrence: 'quiet_chance', severity: 'quiet_extra', effect_on: 'leavers', direction: 'unknown', mode: 'add', starts_after_periods: 0,
        author: 'person', quote: 'a one in five chance of a quiet month', ...at });
      // Contrast first: the risk is theirs too, so with no premise the result is still on their figures.
      expect(faceOf(approved(m), RISK)).toContain(', in this model. It rests on your figures.');
      m.assumptions.push({ id: 'quiet_once', text: 'A quiet month happens at most once.', applied: true, concerns: ['quiet_month'], author: 'olumi', quote: null, ...at });
      const face = faceOf(approved(m), RISK);
      expect(face).toContain('It assumes Olumi’s assumption ‘A quiet month happens at most once’ holds');
      expect(face).not.toContain('on your figures');
    });

    it('a situation-wide assumption (concerns []) is named: it bears on every goal', () => {
      const m = approved(allTheirs());
      m.assumptions.push({ id: 'fees', text: 'Membership fees stay the same.', applied: true, concerns: [], author: 'olumi', quote: null, ...at });
      const face = faceOf(m, OWN);
      expect(face).toContain(', in this model. It assumes Olumi’s assumption ‘Membership fees stay the same’ holds. Whatever the uncertain figures turn out to be, ‘members’ is 345 members');
      expect(face).not.toContain('on your figures');
    });

    it('contrast: every input theirs and confirmed, no premise → "on your figures"; a noted assumption and a challenge are never premises', () => {
      expect(faceOf(approved(allTheirs()), OWN)).toContain(', in this model. It rests on your figures. Whatever the uncertain figures turn out to be, ‘members’ is 345 members');
      const noted = approved(allTheirs());
      noted.assumptions.push({ id: 'word', text: 'Word of mouth may help.', applied: false, concerns: ['reach_340'], author: 'olumi', quote: null, ...at });
      noted.conditions.push({ id: 'winter', text: 'Leavers may rise in winter.', kind: 'challenge', concerns: [], author: 'olumi', quote: null, ...at });
      // Even named by the goal itself, a noted assumption is no premise: the record says the calculation is not worked out under it.
      noted.goals = noted.goals.map((g) => ({ ...g, measure: { ...g.measure!, assumptions: ['word'] } }));
      const face = faceOf(noted, OWN);
      expect(face).toContain(', in this model. It rests on your figures. Whatever the uncertain figures turn out to be, ‘members’ is 345 members');
      expect(face).not.toMatch(/Word of mouth|Leavers may rise/);
    });

    it('their figures not yet confirmed (a first draft) are said as Olumi\'s reading of them, all or by name', () => {
      expect(faceOf(allTheirs(), OWN)).toContain(', in this model. It rests on Olumi’s reading of your figures (not yet confirmed). Whatever the uncertain figures turn out to be,');
      const one = approved(allTheirs());
      one.quantities = one.quantities.map((x) => (x.id === 'members_now' ? { ...x, approval: 'proposed' } : x));
      const face = faceOf(one, OWN);
      expect(face).toContain(', in this model. It rests on Olumi’s reading of ‘members now’ (not yet confirmed). Whatever the uncertain figures turn out to be,');
      expect(face).not.toContain('on your figures');
      // With a condition too: the reading leads, then what the chance is conditional on.
      const both = allTheirs();
      both.conditions.push(hall);
      expect(faceOf(both, `${OWN} The council must let us use the hall.`)).toContain(', in this model. It rests on Olumi’s reading of your figures (not yet confirmed). It assumes your condition ‘The council must let us use the hall’ is met. Whatever the uncertain figures turn out to be,');
    });

    it('Codex #3738: their relation not yet accepted, a link of Olumi\'s in it, and their link not yet accepted are each Olumi\'s reading', () => {
      const joins = (f: (r: CanonicalModelT['relations'][number]) => CanonicalModelT['relations'][number]) => {
        const m = approved(allTheirs());
        m.relations = m.relations.map((r) => (r.id === 'joins_rel' ? f(r) : r));
        return faceOf(m, OWN);
      };
      const terms = (t: { author?: 'person' | 'olumi'; quote?: string | null; approval?: 'proposed' | 'approved' }) =>
        (r: CanonicalModelT['relations'][number]) => (r.form === 'effect' ? { ...r, terms: r.terms.map((x) => ({ ...x, ...t })) } : r);
      for (const face of [joins((r) => ({ ...r, approval: 'proposed' })), joins(terms({ approval: 'proposed' }))]) {
        expect(face).toContain(', in this model. It rests on Olumi’s reading of ‘joins’ (not yet confirmed). Whatever the uncertain figures turn out to be,');
        expect(face).not.toContain('on your figures');
      }
      // Olumi's link, accepted: Olumi's reading, never theirs, and not "not yet confirmed".
      expect(joins(terms({ author: 'olumi', quote: null }))).toContain(', in this model. It rests on Olumi’s reading of ‘joins’. Whatever the uncertain figures turn out to be,');
    });

    it('DL #3738: an accepted Olumi stock is Olumi\'s reading with no "(not yet confirmed)"; unaccepted, it keeps it; mixed, each says its own', () => {
      const stock = (approval: 'proposed' | 'approved', also: (m: CanonicalModelT) => void = () => {}) => {
        const m = approved(allTheirs());
        m.relations = m.relations.map((r) => (r.id === 'members_rel' ? { ...r, author: 'olumi', quote: null, approval } : r));
        also(m);
        return faceOf(m, OWN);
      };
      const accepted = stock('approved');
      expect(accepted).toContain(', in this model. It rests on Olumi’s reading of ‘members’. Whatever the uncertain figures turn out to be,');
      expect(accepted).not.toMatch(/not yet confirmed|on your figures/);
      expect(stock('proposed')).toContain(', in this model. It rests on Olumi’s reading of ‘members’ (not yet confirmed). Whatever the uncertain figures turn out to be,');
      const mixed = stock('approved', (m) => { m.quantities = m.quantities.map((x) => (x.id === 'members_now' ? { ...x, approval: 'proposed' } : x)); });
      expect(mixed).toContain(', in this model. It rests on Olumi’s reading of ‘members now’ (not yet confirmed) and ‘members’. Whatever the uncertain figures turn out to be,');
    });

    // Codex r3 #3738: the goal is read with its own record (and its measure's author and its window's figure), and so is a limit.
    const GOAL = '‘Reach 340 members within three months’';
    type Goal = CanonicalModelT['goals'][number];
    const aimCases: readonly (readonly [string, (g: Goal) => Goal, (m: CanonicalModelT) => void, string])[] = [
      ['the goal proposed', (g) => ({ ...g, approval: 'proposed' }), () => {}, `on Olumi’s reading of ${GOAL} (not yet confirmed)`],
      ['the goal Olumi-authored (accepted)', (g) => ({ ...g, author: 'olumi', quote: null }), () => {}, `on Olumi’s reading of ${GOAL}`],
      ['the goal\'s window figure proposed', (g) => g, (m) => { m.quantities = m.quantities.map((x) => (x.id === 'months' ? { ...x, approval: 'proposed' } : x)); }, `on Olumi’s reading of ${GOAL} (not yet confirmed)`],
      ['a limit proposed', (g) => g, (m) => { m.limits = m.limits.map((l) => ({ ...l, approval: 'proposed' })); }, 'on Olumi’s reading of ‘Within the £800’ (not yet confirmed)'],
    ];
    for (const [name, goal, also, lead] of aimCases) {
      it(`Codex r3 #3738: ${name} is Olumi's reading, never "on your figures"`, () => {
        const m = approved(allTheirs());
        m.goals = m.goals.map((g) => (g.id === 'reach_340' ? goal(g) : g));
        also(m);
        const face = faceOf(m, OWN);
        expect(face).toContain(`, in this model. It rests ${lead}. Whatever the uncertain figures turn out to be,`);
        expect(face).not.toContain('on your figures');
      });
    }

    it('S1 strip (A25 off): the goal\'s own label decides: one not found in their words, or measured by Olumi\'s suggestion, is "on your figures" when theirs and accepted', () => {
      for (const goal of [(g: Goal): Goal => ({ ...g, quote: 'grow to 340 members by spring' }), (g: Goal): Goal => ({ ...g, measure: { ...g.measure!, measure_by: 'olumi' } })]) {
        const m = approved(allTheirs());
        m.goals = m.goals.map((g) => (g.id === 'reach_340' ? goal(g) : g));
        expect(faceOf(m, OWN)).toContain(', in this model. It rests on your figures.');
      }
    });

    it('buddy #3738: their premise not yet accepted is never "your" and never Olumi\'s; S1 strip (A25 off): accepted, it is theirs whether or not its words are found', () => {
      const proposed = approved(allTheirs());
      proposed.conditions.push({ ...hall, approval: 'proposed' });
      const face = faceOf(proposed, `${OWN} The council must let us use the hall.`);
      expect(face).toContain(', in this model. It assumes the condition ‘The council must let us use the hall’ is met (not yet confirmed). Whatever the uncertain figures turn out to be,');
      expect(face).not.toMatch(/your condition|Olumi’s condition|on your figures/);
      const unfound = approved(allTheirs());
      unfound.conditions.push(hall);
      expect(faceOf(unfound, OWN)).toContain('It assumes your condition ‘The council must let us use the hall’ is met');
    });

    it('Codex #3738: the same premise reaching the chance twice (both goals rest on it, one also names it) is named once', () => {
      const m = approved(allTheirs());
      m.quantities.push(q('floor', 'member', { value: 320, quote: 'at least 320 members', approval: 'approved' }));
      m.goals.push({ ...m.goals[0]!, id: 'keep_320', label: 'Keep at least 320 members', measure: { ...m.goals[0]!.measure!, target: 'floor' }, quote: 'keep at least 320 members' });
      m.assumptions.push({ id: 'fees', text: 'Membership fees stay the same.', applied: true, concerns: [], author: 'olumi', quote: null, ...at });
      m.goals = m.goals.map((g) => (g.id === 'reach_340' ? { ...g, measure: { ...g.measure!, assumptions: ['fees'] } } : g));
      const v = evaluateCanonical(m, { sourceText: `${OWN} And keep at least 320 members.`, seed: 7 }).view as Json;
      const face = (v.options as Json[]).find((o) => o.option_id === 'promotion')!.cell.face as string;
      const FEES = 'Olumi’s assumption ‘Membership fees stay the same’ holds';
      expect(face.split(FEES).length - 1).toBe(1);
      expect(face).toContain(`, in this model. It assumes ${FEES}. Whatever the uncertain figures turn out to be,`);
      expect((v.goal_chance.targets.per_target as Json[]).map((t) => t.words)).toEqual([
        `‘members’ being at least 340 members at 3 months from the start of this model, in this model, if ${FEES}`,
        `‘members’ being at least 320 members at 3 months from the start of this model, in this model, if ${FEES}`]);
    });

    const HALL_WORDS = `${OWN} The council must let us use the hall. And keep at least 320 members.`;
    /** Two goals, so the view has a line per target. */
    const viewOf = (m: CanonicalModelT) => {
      m.quantities.push(q('floor', 'member', { value: 320, quote: 'at least 320 members', approval: 'approved' }));
      m.goals.push({ ...m.goals[0]!, id: 'keep_320', label: 'Keep at least 320 members', measure: { ...m.goals[0]!.measure!, target: 'floor' }, quote: 'keep at least 320 members' });
      return evaluateCanonical(m, { sourceText: HALL_WORDS, seed: 7 }).view as Json;
    };
    const optionFace = (v: Json, id: string) => (v.options as Json[]).find((o) => o.option_id === id)!.cell.face as string;
    const HALL_MET = 'if your condition ‘The council must let us use the hall’ is met';
    const REACH = '‘members’ being at least 340 members at 3 months from the start of this model, in this model,';

    it('Codex #3769: a prerequisite on a limit is named in every option\'s chance (each is within the limit), never in the goal\'s own line', () => {
      const m = approved(allTheirs());
      m.conditions.push({ ...hall, concerns: ['within_budget'] });
      const v = viewOf(m);
      for (const id of ['promotion', 'carry_on']) {
        expect(optionFace(v, id)).toContain(`. It assumes your condition ‘The council must let us use the hall’ is met`);
        expect(optionFace(v, id)).not.toContain('on your figures');
      }
      expect((v.goal_chance.targets.per_target as Json[])[0]!.words).toBe(`${REACH} on your figures`);
    });

    it('Codex #3769: a prerequisite on one option, or on a figure only its settings use, is named for that option only; the target line names the option, with no bare "on your figures"', () => {
      for (const concerns of [['promotion'], ['promo_cost']]) {
        const m = approved(allTheirs());
        m.conditions.push({ ...hall, concerns });
        const v = viewOf(m);
        expect(optionFace(v, 'promotion')).toContain(`. It assumes your condition ‘The council must let us use the hall’ is met`);
        expect(optionFace(v, 'promotion')).not.toContain('on your figures');
        expect(optionFace(v, 'carry_on')).toContain(', in this model. It rests on your figures.');
        expect(optionFace(v, 'carry_on')).not.toContain('council');
        expect((v.goal_chance.targets.per_target as Json[])[0]!.words).toBe(`${REACH} with ‘Run a promotion’, ${HALL_MET}`);
      }
    });

    it('several goals: each goal\'s own basis names only its own premises; the joint names every one', () => {
      const m = approved(allTheirs());
      m.quantities.push(q('floor', 'member', { value: 320, quote: 'at least 320 members', approval: 'approved' }));
      m.goals.push({ ...m.goals[0]!, id: 'keep_320', label: 'Keep at least 320 members', measure: { ...m.goals[0]!.measure!, target: 'floor' }, quote: 'keep at least 320 members' });
      m.conditions.push({ ...hall, concerns: ['keep_320'] });
      const v = evaluateCanonical(m, { sourceText: `${OWN} The council must let us use the hall. And keep at least 320 members.`, seed: 7 }).view as Json;
      const words = (id: string) => (v.goal_chance.targets.per_target as Json[]).find((t) => t.constraint_id === id)!.words as string;
      expect(words('keep_320')).toBe('‘members’ being at least 320 members at 3 months from the start of this model, in this model, if your condition ‘The council must let us use the hall’ is met');
      expect(words('reach_340')).toBe('‘members’ being at least 340 members at 3 months from the start of this model, in this model, on your figures');
      expect(((v.options as Json[]).find((o) => o.option_id === 'promotion')!.cell.face as string)).toContain(', in this model. It assumes your condition ‘The council must let us use the hall’ is met. Whatever the uncertain figures turn out to be,');
    });
  });

  it('DL 23 Oct (batch 1 + batch 4) + S4 class 5: an aim with no window says how it is read (with each option in effect), never a missing deadline the compiler does not list; a % target is said in %', () => {
    const goalWords = (m: CanonicalModelT, text: string) => String(((evaluateCanonical(m, { sourceText: text, seed: 7 }).view as Json).goal_chance as Json).chance_words);
    // The bakery's aim states no window: read once with every option in effect, and said so.
    const noDeadline = goalWords(bakery(), BRIEF);
    expect(noDeadline).toContain('‘sales’ being at least 380 loaves per week');
    expect(noDeadline).not.toMatch(/deadline/);
    // The compiler lists no deadline for it (a static level), so nothing on the result says one is missing.
    expect(evaluateCanonical(bakery(), { sourceText: BRIEF, seed: 7 }).compiled.blockers.filter((b) => b.code === 'deadline')).toEqual([]);
    expect(JSON.stringify(((evaluateCanonical(bakery(), { sourceText: BRIEF, seed: 7 }).view as Json).goal_chance as Json).notes)).not.toContain('is there one?');
    expect(noDeadline).not.toMatch(/from now|from the start of this model/);
    // Contrast: the club's aim states three months, and says it.
    expect(goalWords(club(), CLUB_BRIEF)).toContain('at 3 months from the start of this model');
    // "Grow sales by 10%": the target is said as 10%, never as the compiler's 0.1.
    const rel = bakery();
    rel.quantities.push(q('growth', '%', { value: 10, quote: 'grow sales by 10%' }));
    rel.goals = [{ ...rel.goals[0]!, measure: { ...rel.goals[0]!.measure!, target: 'growth', frame: 'change_rel', reference: { kind: 'now', option: null, quantity: null } } }];
    const pct = goalWords(rel, `${BRIEF} We want to grow sales by 10%.`);
    expect(pct).toContain('at least 10%');
    expect(pct).not.toMatch(/\b0\.1\b/);
  });

  it('an aim with no measure gets the one the person states, through the same update path: its target and window in their words, on the card; the chance appears', async () => {
    const m = bakery();
    m.goals = [{ ...m.goals[0]!, measure: null, question: 'How would you know the bakery is doing well enough?' }];
    replies = [JSON.stringify(m)];
    const drafted = (await turn({ message: BRIEF })).json();
    expect(drafted.model_program.saved).toBe(true);
    expect((persisted!.living_model.runs.at(-1).result.compile as Json).blockers).toContainEqual({ id: 'more_loaves', code: 'measure', scope: ['more_loaves'] });
    const words = 'Success means selling at least 380 loaves a week within 4 weeks.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words });
    const measured = (targetQuote: string, as = savedWith) => as((d) => {
      d.quantities.push(q('more_loaves_target', 'loaf/week', { value: 380, quote: targetQuote }), q('more_loaves_window', 'week', { value: 4, quote: words }));
      d.goals = d.goals.map((g) => (g.id === 'more_loaves' ? { ...g, question: null, measure: { quantity: 'sales', per: null, cmp: '>=', target: 'more_loaves_target', frame: 'level', reference: null,
        aggregation: 'end', window: { origin_event: null, origin_offset: null, start: 0, periods: 'more_loaves_window' }, measure_by: 'person', assumptions: [], exclusions: [] } } : g));
    });
    const propose = (c = ctx()) => proposeProgramChange(deps, c, ProgramChangeParams.parse({ public_label: 'Measure the aim', basis: 'their answer',
      request: 'The aim is measured by sales: at least 380 loaves a week, within 4 weeks.', remove: [] })) as Promise<Json>;
    // S1 strip (A2 off): a figure of theirs under words they did not write is proposed as the AI wrote it (its own store).
    replies = [measured('at least 400 loaves a week')];
    const loose = await proposeProgramChange({ dispatch, proposals: new ProposalStore() }, ctx(), ProgramChangeParams.parse({ public_label: 'Measure the aim', basis: 'their answer',
      request: 'The aim is measured by sales: at least 380 loaves a week, within 4 weeks.', remove: [] })) as Json;
    expect(loose.status, JSON.stringify(loose)).toBe('ok');
    expect(loose.data.changes.find((x: Json) => x.id === 'more_loaves_target')).toMatchObject({ author: 'person', after: '380 loaves per week, in your words "at least 400 loaves a week"' });
    replies = [measured(words)];
    const c = ctx();
    const p = await propose(c);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(p.data.changes.map((x: Json) => [x.id, x.kind, x.action, x.before, x.after, x.author])).toEqual([
      ['more_loaves_target', 'quantity', 'add', null, `380 loaves per week, in your words "${words}"`, 'person'],
      ['more_loaves_window', 'quantity', 'add', null, `4 weeks, in your words "${words}"`, 'person'],
      ['more_loaves', 'goal', 'change', 'no measure yet, Olumi asks "How would you know the bakery is doing well enough?"',
        '"sales" at least "more loaves target" 380 loaves per week, by the end of "more loaves window" 4 weeks, the measure you named, no question', 'person'],
    ]);
    expect(await applyProgramChange(deps, c, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(after.goals[0]).toMatchObject({ measure: { quantity: 'sales', cmp: '>=', target: 'more_loaves_target', frame: 'level', reference: null,
      window: { start: 0, periods: 'more_loaves_window' }, measure_by: 'person' }, question: null, approval: 'approved' });
    expect(after.history.at(-1)).toMatchObject({ id: 'more_loaves', change: 'superseded' });
    // The new Run can now work out the aim: each option's chance of it is shown, and the measure question is gone.
    const run = persisted!.living_model.runs.at(-1).result as Json;
    expect((run.canonical_analysis_view as Json).options.map((o: Json) => o.cell.kind)).toEqual(['figure', 'figure']);
    expect(((run.compile as Json).blockers as Json[]).filter((x) => x.code === 'measure')).toEqual([]);
    // The compiler's own reading of a measure with an unstated target, or one nothing works out yet (built exactly).
    const asked = JSON.parse(measured(words, wholeWith)) as CanonicalModelT;
    setQ(asked, 'more_loaves_target', { status: 'asked', value: null, quote: null, question: 'What figure for "sales" would count as "Reach 380 loaves a week"?' });
    expect(compile(asked, { sourceText: `${BRIEF}\n${words}` }).blockers.map((x) => x.id)).toContain('more_loaves_target');
    const named = JSON.parse(measured(words, wholeWith)) as CanonicalModelT;
    named.quantities.push(q('repeat_customers', 'customer/week', { status: 'unknown', quote: 'at least 50 repeat customers a week', label: 'Repeat customers' }));
    named.goals = named.goals.map((g) => ({ ...g, measure: { ...g.measure!, quantity: 'repeat_customers' } }));
    setQ(named, 'more_loaves_target', { unit: 'customer/week', value: 50, quote: 'at least 50 repeat customers a week' });
    expect(compile(named, { sourceText: `${BRIEF}\nat least 50 repeat customers a week` }).perGoal[0]).toMatchObject({ status: 'withheld' });
  });

  // Strip (Paul 26 Oct; B5 removed): an answer is never re-routed to the drafter by the host. A worded answer the AI puts in
  // answers is refused as not a figure (B21's kept half); the AI sends it in request (the tool description says so), as it wrote it.
  it('REFUSED-CHANGE-CLASS 25 Oct (#11–12), B5 removed: a measure given in answers on a goal is not re-routed to the drafter, but refused as not a figure; sent in request, the AI\'s own words reach ONE drafter call and ONE card; a figure answer still sets its item with no drafter call', async () => {
    const m = bakery();
    m.goals = [{ ...m.goals[0]!, measure: null, question: 'How would you know the bakery is doing well enough?' }];
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const words = 'Success means selling at least 380 loaves a week within 4 weeks.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = (w = words) => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [w], user_turn_text: w });
    const answer = (f: Json) => ({ value: null, low: null, high: null, range_kind: null, party: null, quote: words, basis: null, status: 'known', author: 'person', ...f });
    const ask = (answers: Json[], c = ctx(), request = '') => { sent.length = 0; return proposeProgramChange(deps, c, ProgramChangeParams.parse({ public_label: 'Their answer', basis: 'their answer', request, remove: [], answers })) as Promise<Json>; };
    // A figure answer on a figure: set on its item exactly, as before.
    const price = await ask([answer({ id: 'oven_price', value: 2500, quote: 'The oven costs £2,500' })], ctx('The oven costs £2,500.'));
    expect(price.status, JSON.stringify(price)).toBe('ok');
    expect(price.data.changes.map((x: Json) => [x.id, x.action])).toEqual([['oven_price', 'change']]);
    expect(sent).toHaveLength(0);
    // A figure on the goal itself, and a non-figure answer on an option: not a figure (B21's kept half).
    expect(await ask([answer({ id: 'more_loaves', value: 380 })])).toEqual({ status: 'refused', reason: 'not_an_answer', detail: 'more_loaves is not a figure in this model; a new item is a structural change.' });
    expect(await ask([answer({ id: 'keep_one' })])).toEqual({ status: 'refused', reason: 'not_an_answer', detail: 'keep_one is not a figure in this model; a new item is a structural change.' });
    expect(sent).toHaveLength(0);
    // B5 removed: the worded answer on the goal, in answers, is never re-routed to the drafter.
    expect(await ask([answer({ id: 'more_loaves' })])).toEqual({ status: 'refused', reason: 'not_an_answer', detail: 'more_loaves is not a figure in this model; a new item is a structural change.' });
    expect(sent).toHaveLength(0);
    // In request: ONE drafter call whose change is the AI's own request, exactly (no host-written wrapper), and ONE card.
    replies = [savedWith((d) => {
      d.quantities.push(q('more_loaves_target', 'loaf/week', { value: 380, quote: words }), q('more_loaves_window', 'week', { value: 4, quote: words }));
      d.goals = d.goals.map((g) => (g.id === 'more_loaves' ? { ...g, question: null, measure: { quantity: 'sales', per: null, cmp: '>=', target: 'more_loaves_target', frame: 'level', reference: null,
        aggregation: 'end', window: { origin_event: null, origin_offset: null, start: 0, periods: 'more_loaves_window' }, measure_by: 'person', assumptions: [], exclusions: [] } } : g));
    })];
    const c = ctx();
    const request = `The answer to more_loaves, in their words: "${words}"`;
    const p = await ask([], c, request);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(sent).toHaveLength(1);
    // C6 (29 Oct): Olumi's instruction, in the developer role; re-pinned knowingly from the user role and "The change:".
    expect((sent[0]!.input as Json[])[2]).toEqual({ role: 'developer', content: `${UPDATE_PREFIX}\n${UPDATE_CHANGE_LABEL} ${request}\nRemove: nothing` });
    expect(p.data.changes.map((x: Json) => [x.id, x.kind, x.action, x.before, x.after, x.author])).toEqual([
      ['more_loaves_target', 'quantity', 'add', null, `380 loaves per week, in your words "${words}"`, 'person'],
      ['more_loaves_window', 'quantity', 'add', null, `4 weeks, in your words "${words}"`, 'person'],
      ['more_loaves', 'goal', 'change', 'no measure yet, Olumi asks "How would you know the bakery is doing well enough?"',
        '"sales" at least "more loaves target" 380 loaves per week, by the end of "more loaves window" 4 weeks, the measure you named, no question', 'person'],
    ]);
    // Approved, it is saved with a new Run: the goal has its measure and is no longer asked about.
    expect(await applyProgramChange(deps, c, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    expect((persisted!.living_model.canonical as CanonicalModelT).goals[0]).toMatchObject({ question: null, measure: { target: 'more_loaves_target' }, approval: 'approved' });
    expect(((persisted!.living_model.runs.at(-1).result.compile as Json).blockers as Json[]).filter((x) => x.id === 'more_loaves')).toEqual([]);
  });

  // Strip (Paul 26 Oct; B5, B4, B20 and B27 removed): a worded answer is never re-routed, re-stamped or refused as "read no
  // figure" by the host; sent in request, the drafter's record passes exactly as it wrote it, its author included.
  it('REFUSED-CHANGE-CLASS 25 Oct (#8–9), B5/B4/B20 removed: a date given in answers is not re-routed to the drafter; sent in request, the drafter\'s reading passes as it wrote it, never re-stamped as theirs; "I don\'t know" still sets its item with no drafter call', async () => {
    const m = bakery();
    // Counted over eight weeks, so a setting from week 2 is inside the model's horizon.
    m.quantities.push(q('oven_weeks', 'week', { status: 'asked', question: 'When will the second oven arrive?' }), q('weeks_counted', 'week', { value: 8, quote: 'We count eight weeks' }));
    m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'weeks_counted' } } }));
    m.options = m.options.map((o) => (o.id === 'second_oven' ? { ...o, sets: o.sets.map((x) => ({ ...x, starts_after_periods: 'oven_weeks' })) } : o));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: `${BRIEF} We count eight weeks.` })).json().model_program.saved).toBe(true);
    const words = 'It arrives on 9 November 2026.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = (w = words) => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [w], user_turn_text: w });
    const answer = (f: Json) => ({ id: 'oven_weeks', value: null, low: null, high: null, range_kind: null, party: null, quote: words, basis: null, status: 'known', author: 'person', ...f });
    const ask = (answers: Json[], c = ctx(), request = '') => { sent.length = 0; return proposeProgramChange(deps, c, ProgramChangeParams.parse({ public_label: 'Their answer', basis: 'their answer', request, remove: [], answers })) as Promise<Json>; };
    // "I don't know" on the same figure is set on its item exactly, with no drafter call.
    const dunno = "I don't know when it arrives.";
    const unknown = await ask([answer({ status: 'unknown', quote: dunno, basis: 'The supplier has not given a date.' })], ctx(dunno));
    expect(unknown.status, JSON.stringify(unknown)).toBe('ok');
    expect(sent).toHaveLength(0);
    expect(unknown.data.changes.map((x: Json) => [x.id, x.action, x.author])).toEqual([['oven_weeks', 'change', 'person']]);
    // B5 removed: the date in answers, with no figure, is never sent to the drafter.
    const inAnswers = await ask([answer({})]);
    expect(sent).toHaveLength(0);
    expect(inAnswers.status, JSON.stringify(inAnswers)).toBe('refused');
    // In request: ONE drafter call whose change is the AI's own request. The drafter writes its reading as Olumi's, with no
    // quote, and it passes exactly so (B4 removed: never re-stamped as theirs).
    replies = [savedWith((d) => setQ(d, 'oven_weeks', { status: 'known', question: null, value: 2, author: 'olumi', quote: null, basis: 'Two whole weeks from today, 25 October 2026.' }))];
    const request = `The answer to oven_weeks, in their words: "${words}"`;
    const p = await ask([], ctx(), request);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(sent).toHaveLength(1);
    // C6 (29 Oct): Olumi's instruction, in the developer role; re-pinned knowingly from the user role and "The change:".
    expect((sent[0]!.input as Json[])[2]).toEqual({ role: 'developer', content: `${UPDATE_PREFIX}\n${UPDATE_CHANGE_LABEL} ${request}\nRemove: nothing` });
    expect(p.data.changes.map((x: Json) => [x.id, x.kind, x.action, x.author])).toEqual([['oven_weeks', 'quantity', 'change', 'olumi']]);
    // B20 removed: a drafter update that leaves the item as saved is no "read no figure" refusal of the host's.
    replies = [savedWith((d) => setQ(d, 'oven_weeks', { basis: 'No date given.' }))];
    const unread = await ask([], ctx(), request);
    expect(JSON.stringify(unread)).not.toContain('read no figure');
  });

  // Strip (Paul 26 Oct; B19 removed): the host no longer names an answered item the change removed; the validator's own
  // consent check (a removal only when listed) is what refuses it.
  it('writes#6 (B19 removed): a figure answer whose item the drafted change removes is refused by the validator\'s removal check, never by B19\'s "removed what you answered"', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const words = 'The oven costs £2,500, and add a delivery van.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    const answer = { id: 'oven_price', value: 2500, low: null, high: null, range_kind: null, party: null, quote: 'The oven costs £2,500', basis: null, status: 'known', author: 'person' };
    // The drafter's update removes the item they answered (its repairs the same).
    replies = Array.from({ length: 3 }, () => savedWith((d) => { d.quantities = d.quantities.filter((x) => x.id !== 'oven_price'); }));
    const out = await proposeProgramChange(deps, ctx, ProgramChangeParams.parse({ public_label: 'Their answer', basis: 'their answer', request: 'Add a delivery van.', remove: [], answers: [answer] })) as Json;
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'refused', reason: 'omitted_record', data: { ids: ['oven_price'] } });
    expect(JSON.stringify(out)).not.toContain('the change removed what you answered');
    expect(registered).toHaveLength(1);
  });

  // Paul 28 Oct (blocking; ALPHA plan item 3, his added change: "an update never deletes a figure you supplied"). Box 3's
  // European simplify (a72dba23): the agent listed his 400 customers, 8 % churn and £500k budget for removal as "a
  // representation change" and the validator trusted the list, so they became notes. A figure of theirs is never removable.
  it('lost figures (Paul 28 Oct): a removal listing a figure they gave is refused before any drafting call, and at the write boundary whoever lists it; an Olumi item listed is not', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const words = 'Drastically streamline it, with 10 or fewer nodes.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    replies = Array.from({ length: 3 }, () => savedWith((d) => { d.quantities = d.quantities.filter((x) => x.id !== 'base_sales'); }));
    const out = await proposeProgramChange(deps, ctx, ProgramChangeParams.parse({ public_label: 'Streamlined', basis: 'their request', request: words, remove: ['base_sales'], answers: [] })) as Json;
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'refused', reason: 'figure_removed', data: { ids: ['base_sales'] } });
    expect(JSON.stringify(out)).toContain('a figure they gave');
    expect(replies).toHaveLength(3); // no drafting call was spent on it
    expect(registered).toHaveLength(1);
    // The write boundary, for any route: the same removal is refused by the validator itself.
    const saved = bakery();
    const without = { ...saved, quantities: saved.quantities.filter((x) => x.id !== 'base_sales') };
    expect(validatePostimage(saved, without, { removals: ['base_sales'], words: [], fresh: [] })).toMatchObject({ ok: false, code: 'figure_removed', ids: ['base_sales'] });
    // Contrast: an Olumi item listed for removal is not this refusal (Olumi's own estimate may be folded on a simplify).
    const noShare = { ...saved, quantities: saved.quantities.filter((x) => x.id !== 'sell_through') };
    expect(validatePostimage(saved, noShare, { removals: ['sell_through'], words: [], fresh: [] })).not.toMatchObject({ code: 'figure_removed' });
    // The apply seam too (PL 00:06): a card held before this check (cards outlive a deploy) that drops their figure is refused at
    // the press and nothing is written; its payload is never changed. Contrast: the same held card keeping the figure saves.
    const live = savedProgramOf({ living_model: persisted!.living_model })!;
    const hold = (canonical: CanonicalModelT) => holdProgramCard(deps.proposals, { scenarioId: SCENARIO, userId: null, graphHash: hashOf(persisted), identity: computeGraphIdentityHash(persisted as never)!.value },
      { label: 'Held before the check', basis: 'x', program: { ...live, canonical }, changes: [] });
    const press = (id: string) => applyProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, id);
    const dropped = hold({ ...live.canonical, quantities: live.canonical.quantities.filter((x) => x.id !== 'base_sales') });
    const writes = registered.length;
    expect(await press(dropped.proposal_id)).toMatchObject({ status: 'refused', reason: 'figure_removed', data: { ids: ['base_sales'] } });
    expect(registered).toHaveLength(writes);
    const keeps = hold({ ...live.canonical, quantities: live.canonical.quantities.map((x) => (x.id === 'sell_through' ? { ...x, value: 0.75 } : x)) });
    expect(await press(keeps.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
  });

  // 29 Oct (Box 3 European simplify, the first lossy boundary): the agent's remove list dropped Olumi's pilot option, its
  // prerequisite and his figures; the tool said only the person may ask for removals while the update prompt folds Olumi's own.
  it('a simplify\'s removals are the change\'s PROPOSED removals: their named ones within the figure rules, or Olumi\'s redundant scaffolding and records whose meaning is kept elsewhere; a size never outranks meaning', () => {
    const d = ProgramChangeParams.shape.remove.description ?? '';
    // The PL's 00:57 contract: proposed removals, reviewed on the card; named corrections followed within the figure rules; a
    // general simplify drops only redundant Olumi scaffolding or records whose meaning is kept elsewhere. prompts-v2's words (29 Oct).
    expect(d).toBe("Existing ids proposed for removal. Keep every person-authored quantity with a figure under its id; correct it or mark it not_applicable only on the person's explicit word. For generic simplification, remove only redundant Olumi scaffolding or non-protected records whose full consequential meaning is re-expressed in fewer records. Preserve supplied figures, useful options, measures, causal routes, supported calculations, conditions, risks, dissent, uncertainty and attribution. A requested size does not authorize loss. [] for none.");
    expect(d).not.toContain('the person asked to remove');
  });

  it('C4 (alpha spec §3): a mixed turn keeps their exact answer after the structural merge: the drafter returning the answered figure as its own estimate leaves their figure, status, author and quote on the card and on the model it would write', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const words = 'The oven costs £2,500, and add a third option: rent an oven.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    const answer = { id: 'oven_price', value: 2500, low: null, high: null, range_kind: null, party: null, quote: 'The oven costs £2,500', basis: null, status: 'known', author: 'person' };
    // The drafter's update adds the option and also returns the answered figure, rewritten as Olumi's estimate.
    replies = [savedWith((d) => {
      setQ(d, 'oven_price', { status: 'estimated', author: 'olumi', value: 3000, low: 2500, high: 3500, range_kind: 'plausible', quote: null, question: null, basis: 'A typical oven price.' });
      d.options.push({ ...d.options[0]!, id: 'rent_oven', label: 'Rent an oven', sets: [], quote: 'rent an oven' });
    })];
    sent.length = 0;
    const out = await proposeProgramChange(deps, ctx, ProgramChangeParams.parse({ public_label: 'Their answer and a new option', basis: 'their answer',
      request: 'Add an option: rent an oven.', remove: [], answers: [answer] })) as Json;
    expect(out.status, JSON.stringify(out)).toBe('ok');
    expect(drafterCalls()).toHaveLength(1);
    const held = (deps.proposals.get(out.data.proposal_id)!.living_model as { canonical: CanonicalModelT }).canonical;
    expect(held.quantities.find((x) => x.id === 'oven_price')).toMatchObject({ status: 'known', author: 'person', value: 2500, low: null, high: null, range_kind: null,
      party: null, quote: 'The oven costs £2,500', basis: null, question: null });
    // The structural change stands beside it (contrast: the drafter's records are merged), and the card shows the final change.
    expect(held.options.map((o) => o.id)).toEqual(['second_oven', 'keep_one', 'rent_oven']);
    expect(out.data.changes.map((c: Json) => [c.id, c.action, c.author])).toEqual([['oven_price', 'change', 'person'], ['rent_oven', 'add', 'person']]);
    expect(out.data.changes.find((c: Json) => c.id === 'oven_price').after).toContain('in your words "The oven costs £2,500"');
  });

  it('C12 (alpha spec §3): every continuation reads the held card: read_canonical_context names the program card held for this person, its label, every change and its base revision; another person\'s read names none, and once applied it is gone', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const words = 'The oven costs £2,500.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    expect((await readProgramContext(deps, ctx) as Json).data.awaiting_approval).toEqual([]);
    const p = await proposeProgramChange(deps, ctx, ProgramChangeParams.parse({ public_label: 'The oven costs £2,500', basis: 'their answer', request: '', remove: [],
      answers: [{ id: 'oven_price', value: 2500, low: null, high: null, range_kind: null, party: null, quote: words.slice(0, -1), basis: null, status: 'known', author: 'person' }] })) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    const read = await readProgramContext(deps, { ...ctx, turn_id: randomUUID() }) as Json;
    expect(read.data.awaiting_approval).toEqual([{ proposal_id: p.data.proposal_id, public_label: 'The oven costs £2,500', changes: p.data.changes, base_revision: p.data.base_revision }]);
    expect(read.data.awaiting_approval[0].base_revision).toBe(read.data.revision.graph_hash);
    expect((await readProgramContext(deps, { ...ctx, authenticated_user_id: 'someone-else' }) as Json).data.awaiting_approval).toEqual([]);
    expect(await applyProgramChange(deps, ctx, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    expect((await readProgramContext(deps, ctx) as Json).data.awaiting_approval).toEqual([]);
  });

  it('C12 (review on #3848): a held card that no longer applies to the saved model is not read as awaiting approval; the reading card says it is one', async () => {
    replies = [JSON.stringify(bakery())];
    const first = (await turn({ message: BRIEF })).json();
    expect(first.model_program.saved).toBe(true);
    const words = 'The oven costs £2,500.', other = 'Actually the oven costs £2,600.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctxOf = (w: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [w], user_turn_text: w });
    const card = (w: string, value: number) => proposeProgramChange(deps, ctxOf(w), ProgramChangeParams.parse({ public_label: w, basis: 'their answer', request: '', remove: [],
      answers: [{ id: 'oven_price', value, low: null, high: null, range_kind: null, party: null, quote: w.slice(0, -1), basis: null, status: 'known', author: 'person' }] })) as Promise<Json>;
    const a = await card(words, 2500), b = await card(other, 2600);
    expect([a.status, b.status]).toEqual(['ok', 'ok']);
    expect((await readProgramContext(deps, ctxOf(words)) as Json).data.awaiting_approval.map((x: Json) => x.proposal_id).sort()).toEqual([a.data.proposal_id, b.data.proposal_id].sort());
    // Applying one moves the figure the other changes from: the other no longer applies, so it is not awaiting approval.
    expect(await applyProgramChange(deps, ctxOf(words), a.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    expect((await readProgramContext(deps, ctxOf(words)) as Json).data.awaiting_approval).toEqual([]);
    // A reading card held on the saved model is read as one (confirming it adds nothing the model does not hold); a change
    // card is not marked.
    const held = { dispatch, proposals: new ProposalStore() };
    const now = (await readProgramContext(held, ctxOf(words)) as Json).data.revision;
    const savedNow = (programReadOf(persisted!) as { program: Parameters<typeof holdProgramCard>[2]['program'] }).program;
    const r = holdProgramCard(held.proposals, { scenarioId: SCENARIO, userId: null, graphHash: now.graph_hash, identity: now.graph_identity_hash, base: savedNow },
      { label: 'Your situation as I understood it', basis: 'their brief', program: savedNow, changes: [], reading: true });
    const c = await proposeProgramChange(held, ctxOf(other), ProgramChangeParams.parse({ public_label: other, basis: 'their answer', request: '', remove: [],
      answers: [{ id: 'oven_price', value: 2600, low: null, high: null, range_kind: null, party: null, quote: other.slice(0, -1), basis: null, status: 'known', author: 'person' }] })) as Json;
    const marks = ((await readProgramContext(held, ctxOf(words)) as Json).data.awaiting_approval as Json[]).map((x) => [x.proposal_id, x.reading ?? null]);
    expect(marks.sort()).toEqual([[r.proposal_id, true], [c.data.proposal_id, null]].sort());
  });

  it('words#5, one model, one period 0: the first draft\'s day is kept with the saved program, and an update on a later day counts a stated date from THAT day, naming both; a program saved before it counts from today as before, and reopens and rewrites exactly as stored', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Drafted on Monday 26 October 2026 (GMT): the oven's arrival is asked, counted over eight weeks.
      vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
      const m = bakery();
      m.quantities.push(q('oven_weeks', 'week', { status: 'asked', question: 'When will the second oven arrive?' }), q('weeks_counted', 'week', { value: 8, quote: 'We count eight weeks' }));
      m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'weeks_counted' } } }));
      m.options = m.options.map((o) => (o.id === 'second_oven' ? { ...o, sets: o.sets.map((x) => ({ ...x, starts_after_periods: 'oven_weeks' })) } : o));
      replies = [JSON.stringify(m)];
      expect((await turn({ message: `${BRIEF} We count eight weeks.` })).json().model_program.saved).toBe(true);
      expect(sent[0]!.instructions).toBe(`${DRAFTING_INSTRUCTIONS}\n\nToday is 2026-10-26 (Europe/London). A date they state counts in whole periods from today, which is period 0.`);
      expect(persisted!.living_model.drafted_on).toBe('2026-10-26');
      const drafted = JSON.parse(JSON.stringify(persisted)) as Json;
      // A program saved before the day was kept: the same stored JSON without it.
      const { drafted_on: _day, ...oldLiving } = drafted.living_model as Json;
      const old = { ...drafted, living_model: oldLiving };

      // Two weeks later, on 9 November, they answer the asked date.
      vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
      const words = 'It arrives on 23 November 2026.';
      const deps = { dispatch, proposals: new ProposalStore() };
      const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words });
      // Strip (Paul 26 Oct; B5 removed): the AI sends the worded answer in request, as the tool description says.
      const ask = (c: Json) => { sent.length = 0; return proposeProgramChange(deps, c as never, ProgramChangeParams.parse({ public_label: 'Their answer', basis: 'their answer',
        request: `The answer to oven_weeks, in their words: "${words}"`, remove: [], answers: [] })) as Promise<Json>; };

      // Contrast first, the program saved before: it reopens exactly as stored (the same newest Run, current, its view byte for
      // byte), is rewritten with no new key, and its update counts from the day it runs, the line as it always was.
      persisted = JSON.parse(JSON.stringify(old)) as Json;
      const reopened = reopenProgram(JSON.parse(JSON.stringify(old)))!;
      expect([reopened.run!.run_id, reopened.current, reopened.engine_current]).toEqual([oldLiving.runs.at(-1).run_id, true, true]);
      expect(stableStringify(reopened.view)).toBe(stableStringify(oldLiving.runs.at(-1).result.canonical_analysis_view));
      expect(livingModelOf(savedProgramOf(old)!)).toEqual(oldLiving);
      expect(Object.keys(withNewRun(savedProgramOf(old)!).graph.living_model as Json)).toEqual(['model_program', 'canonical', 'seed', 'person_words', 'runs']);
      replies = [savedWith((d) => setQ(d, 'oven_weeks', { status: 'known', question: null, value: 2, author: 'olumi', quote: null, basis: 'Two whole weeks from today, 9 November 2026.' }))];
      expect((await ask(ctx())).status).toBe('ok');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.instructions).toBe(`${DRAFTING_INSTRUCTIONS}\n\nToday is 2026-11-09 (Europe/London). A date they state counts in whole periods from today, which is period 0.`);

      // The program with its day: the drafter is told both days, and counts their date from 26 October, the model's period 0.
      persisted = JSON.parse(JSON.stringify(drafted)) as Json;
      replies = [savedWith((d) => setQ(d, 'oven_weeks', { status: 'known', question: null, value: 4, author: 'olumi', quote: null, basis: 'Four whole weeks from 26 October 2026, period 0.' }))];
      const c = ctx();
      const p = await ask(c);
      expect(p.status, JSON.stringify(p)).toBe('ok');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.instructions).toBe(`${DRAFTING_INSTRUCTIONS}\n\nToday is 2026-11-09 (Europe/London). This model's period 0 is 2026-10-26, the day it was first drafted: `
        + 'a date they state, and anything they time from today, counts in whole periods from 2026-10-26.');
      // Approved, the update is saved with the SAME period 0, and the drafter's four weeks exactly as it wrote them (B4 removed:
      // never re-stamped as theirs).
      expect(await applyProgramChange(deps, c as never, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
      expect(persisted!.living_model.drafted_on).toBe('2026-10-26');
      expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'oven_weeks')).toMatchObject({ value: 4, status: 'known', author: 'olumi', quote: null });
    } finally { vi.useRealTimers(); }
  });

  it('DL 23 Oct (batch 4 marketing-r2): what a measure leaves out is kept in their words and named; the chance says what it covers and what it leaves out, never that it covers everything', () => {
    const words = 'Success means selling at least 380 loaves a week and 50 new regulars within 4 weeks.';
    // The measured aim exactly as an approved update writes it: their target and window, and the parts it leaves out.
    const measured = (leaves: string[], window: boolean, quote = words): CanonicalModelT => {
      const m = bakery();
      m.quantities.push(q('more_loaves_target', 'loaf/week', { value: 380, quote }), ...(window ? [q('more_loaves_window', 'week', { value: 4, quote })] : []));
      const notes = leaves.map((w, i) => ({ id: `more_loaves_leaves_out${i === 0 ? '' : `_${i + 1}`}`, text: w, why: 'It is part of the aim they stated, but it has no measure yet, so the chance does not cover it.',
        question: `How would you measure "${w}"?`, concerns: ['more_loaves'], author: 'person' as const, party: null, quote: w, approval: 'approved' as const, approved_by: null, author_id: null }));
      m.left_out.push(...notes);
      m.goals = [{ ...m.goals[0]!, question: null, measure: { quantity: 'sales', per: null, cmp: '>=', target: 'more_loaves_target', frame: 'level', reference: null, aggregation: 'end',
        window: window ? { origin_event: null, origin_offset: null, start: 0, periods: 'more_loaves_window' } : null, measure_by: 'person', assumptions: [], exclusions: notes.map((n) => n.id) } }];
      return m;
    };
    const goalChance = (model: CanonicalModelT, text = words) => (evaluateCanonical(model, { sourceText: `${BRIEF}\n${text}`, seed: 7 }).view as Json).goal_chance as Json;
    expect((goalChance(measured(['50 new regulars'], true)).notes as string[]).some((n) => /^Covers: ‘sales’ being at least 380 loaves per week.* · Leaves out: ‘50 new regulars’$/.test(n))).toBe(true);
    // A deadline they stated that the model cannot hold yet is named as left out, and never asked for again.
    const ln = goalChance(measured(['50 new regulars', 'within 4 weeks'], false)).notes as string[];
    expect(ln.some((n) => n.endsWith('Leaves out: ‘50 new regulars’ and ‘within 4 weeks’'))).toBe(true);
    expect(ln.some((n) => n.includes('is there one?'))).toBe(false);
    // Codex r7: an equal figure is never read as covered. "380 new regulars" beside a 380 target is not claimed: the chance
    // names only the measured target it uses, and says nothing about what it does not hold.
    const same = 'Success means selling at least 380 loaves a week and 380 new regulars within 4 weeks.';
    const gc = goalChance(measured([], true, same), same);
    expect(JSON.stringify(gc)).not.toContain('regulars');
    expect((gc.notes as string[]).some((n) => n.startsWith('Covers:'))).toBe(false);
  });

  it('targeted answers (DL 24 Oct): an answer to a listed question is set on the existing item it answers, exactly, with no redraft: one item changes and every other record is byte-identical; "all" is read as 100% with Olumi\'s reading shown; "I don\'t know" is theirs and never asked again; a structural change still uses the redraft', async () => {
    const saved = savedDraft('./hiring-alpha3.saved.json');
    replies = [JSON.stringify(saved.canonical)];
    expect((await turn({ message: saved.brief })).json().model_program.saved).toBe(true);
    // The saved model as the tools read it (a read parses it, so its keys are in the schema's order on every path).
    const read = programReadOf(persisted!);
    const before = (read.kind === 'program' ? read.program.canonical : null)!;
    const deps = { dispatch, proposals: new ProposalStore() };
    const ask = (words: string, answers: Json[], extra: Partial<{ request: string; remove: string[] }> = {}) => {
      sent.length = 0;
      return proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
        ProgramChangeParams.parse({ public_label: 'Their answer', basis: 'their answer', request: '', remove: [], answers, ...extra })) as Promise<Json>;
    };
    const answer = (f: Json) => ({ value: null, low: null, high: null, range_kind: null, party: null, quote: null, basis: null, author: 'person', ...f });
    // The held program exactly as the card will write it (its raw bytes; a parse would reorder keys).
    const heldOf = (p: Json) => deps.proposals.get(p.data.proposal_id)!.living_model as { canonical: CanonicalModelT; runs: Json[] };
    // Every record but the answered one, each as its own bytes (the model's top-level key order is not a record's).
    const others = (m: CanonicalModelT, id: string) => (['quantities', 'relations', 'goals', 'limits', 'preferences', 'options', 'risks', 'claims', 'evidence', 'assumptions',
      'dissent', 'conditions', 'left_out'] as const).flatMap((f) => (m[f] as readonly { id: string }[]).filter((r) => r.id !== id).map((r) => `${f}:${JSON.stringify(r)}`));
    // (1) The hiring cost answer: ONE item changes, as theirs in their words; every other record is the saved one, byte for
    // byte (positive control: the records compared); no drafter call.
    const cost = await ask('About £45,000 per developer, all in.', [answer({ id: 'developer_hiring_cost', status: 'known', value: 45000, quote: 'About £45,000 per developer, all in.' })]);
    expect(cost.status, JSON.stringify(cost)).toBe('ok');
    expect(sent).toHaveLength(0);
    expect(cost.data.changes.map((c: Json) => [c.id, c.action, c.author])).toEqual([['developer_hiring_cost', 'change', 'person']]);
    const held = heldOf(cost).canonical;
    expect(others(held, 'developer_hiring_cost')).toEqual(others(before, 'developer_hiring_cost'));
    expect(others(before, 'developer_hiring_cost').length).toBeGreaterThan(20);
    expect(held.quantities.find((x) => x.id === 'developer_hiring_cost')).toMatchObject({ status: 'known', value: 45000, low: null, high: null, author: 'person',
      quote: 'About £45,000 per developer, all in.', question: null, unit: 'GBP/developer' });
    // (2) "I don't know": theirs, quoted, not known, with what would size it; never asked again as a number.
    const dunno = await ask('I don\'t know what a Tech lead would cost yet.', [answer({ id: 'tech_lead_hiring_cost', status: 'unknown', value: 99,
      quote: 'I don\'t know what a Tech lead would cost yet.', basis: 'A recruiter\'s quote for a Tech lead would size it.' })]);
    expect(dunno.status, JSON.stringify(dunno)).toBe('ok');
    expect(sent).toHaveLength(0);
    const unknown = heldOf(dunno);
    expect(unknown.canonical.quantities.find((x) => x.id === 'tech_lead_hiring_cost')).toMatchObject({ status: 'unknown', value: null, author: 'person',
      quote: 'I don\'t know what a Tech lead would cost yet.', basis: 'A recruiter\'s quote for a Tech lead would size it.', question: null });
    expect(((unknown.runs.at(-1)!.result as Json).compile.blockers as Json[]).filter((b) => b.id === 'tech_lead_hiring_cost' && b.code === 'asked')).toEqual([]);
    expect(dunno.data.changes[0].after).toContain('in your words "I don\'t know what a Tech lead would cost yet."');
    // Strip (Paul 26 Oct; A2/A2b/A5 removed): an answer quoting their brief instead of this turn's words is no longer refused by
    // the host; it passes to the card as the AI declared it, and only the person's press applies it.
    expect(await ask('No idea yet.', [answer({ id: 'tech_lead_hiring_cost', status: 'unknown', quote: saved.brief.slice(0, 40), basis: 'A recruiter\'s quote would size it.' })]))
      .toMatchObject({ status: 'ok' });
    // A range's reading is theirs to give (buddy 24 Oct): one their words declare is kept exactly; one they do not stays null,
    // honestly unresolved, and the Run asks how to read it.
    const firm = await ask('Firmly between £40,000 and £50,000.', [answer({ id: 'developer_hiring_cost', status: 'known', low: 40000, high: 50000, range_kind: 'bounds', quote: 'Firmly between £40,000 and £50,000.' })]);
    expect(heldOf(firm).canonical.quantities.find((x) => x.id === 'developer_hiring_cost')).toMatchObject({ low: 40000, high: 50000, range_kind: 'bounds' });
    const open = await ask('Between £40,000 and £50,000.', [answer({ id: 'developer_hiring_cost', status: 'known', low: 40000, high: 50000, quote: 'Between £40,000 and £50,000.' })]);
    expect(open.status, JSON.stringify(open)).toBe('ok');
    expect(heldOf(open).canonical.quantities.find((x) => x.id === 'developer_hiring_cost')).toMatchObject({ low: 40000, high: 50000, range_kind: null });
    expect(((heldOf(open).runs.at(-1)!.result as Json).compile.blockers as Json[]).filter((b) => b.id === 'developer_hiring_cost').map((b) => b.code)).toEqual(['range_kind']);
    // Strip (Paul 26 Oct): an answer quoting an earlier message of theirs is no longer refused by the host; it reaches the card.
    const earlier = 'About £45,000 per developer, all in.';
    expect(await proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [earlier, 'Yes, go ahead.'],
      user_turn_text: 'Yes, go ahead.' }, ProgramChangeParams.parse({ public_label: 'Their answer', basis: 'their answer', request: '', remove: [],
      answers: [answer({ id: 'developer_hiring_cost', status: 'known', value: 45000, quote: earlier })] }))).toMatchObject({ status: 'ok' });
    // Basis-only: their "I don't know" saved first, so the next answer changes nothing but its basis (and quotes their brief).
    expect(await applyProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, dunno.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'tech_lead_hiring_cost')).toMatchObject({ status: 'unknown', value: null, low: null, high: null });
    // Strip (Paul 26 Oct; A5 removed): the host no longer checks an answer's quote against this turn's words; a basis-only
    // answer passes as the AI declared it.
    expect(await ask('Still no idea.', [answer({ id: 'tech_lead_hiring_cost', status: 'unknown', quote: saved.brief.slice(0, 40), basis: 'Another basis.' })]))
      .toMatchObject({ status: 'ok' });
    // Refused, by construction: an answer to an item the model does not hold (it never creates one); no drafter call.
    expect(await ask('Unassigned costs are £10,000.', [answer({ id: 'unassigned_first_year_cost', status: 'known', value: 10000, quote: 'Unassigned costs are £10,000.' })]))
      .toMatchObject({ status: 'refused', reason: 'not_an_answer' });
    expect(sent).toHaveLength(0);
    // On the redraft path, S1 strip (A2b off): a person's figure whose status the drafter changes under their earlier words is
    // proposed as the AI wrote it (its own store), for the person's press.
    replies = [savedWith((d) => setQ(d, 'developer_hiring_cost', { status: 'unknown', question: null, quote: saved.brief.slice(0, 40), basis: 'They do not know it yet.' }))];
    const redraft = await proposeProgramChange({ dispatch, proposals: new ProposalStore() }, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(),
      verified_user_messages: ['They do not know it.'], user_turn_text: 'They do not know it.' }, ProgramChangeParams.parse({ public_label: 'Their answer', basis: 'their answer',
      request: 'Mark the developer cost as not known yet.', remove: [], answers: [] })) as Json;
    expect(redraft.status, JSON.stringify(redraft)).toBe('ok');
    expect(redraft.data.changes.map((c: Json) => [c.id, c.author])).toEqual([['developer_hiring_cost', 'person']]);
    expect(sent).toHaveLength(1);
    sent.length = 0;
    // A structural change still goes to Olumi's drafter: one call, what it changes.
    replies = [savedWith((d) => { d.options.push({ ...d.options[0]!, id: 'contractor', label: 'Hire a contractor', sets: [], quote: 'a contractor option' }); })];
    const structural = await ask('Also add a contractor option.', [], { request: 'Add a contractor option.' });
    expect(structural.status, JSON.stringify(structural)).toBe('ok');
    expect(sent).toHaveLength(1);
  });

  it('targeted answers: "all" of a share is read as 100%, their words kept as theirs and Olumi\'s reading shown on the card before anything is saved', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    sent.length = 0;
    const words = 'All of the new loaves sell.';
    const p = await proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
      ProgramChangeParams.parse({ public_label: 'Sell-through 100%', basis: 'their answer', request: '', remove: [], answers: [{ id: 'sell_through', status: 'known', value: 1,
        low: null, high: null, range_kind: null, party: null, quote: 'All of the new loaves sell', basis: 'Olumi reads “all” as 100%.', author: 'person' }] })) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(sent).toHaveLength(0);
    expect(p.data.changes).toEqual([{ id: 'sell_through', kind: 'quantity', action: 'change', label: 'sell through', before: 'from 0.5 to 0.9, most likely 0.7 (a plausible range), an estimate, based on "New capacity sells only as far as demand grows.", Olumi’s, not in your words',
      after: '1, known, based on "Olumi reads “all” as 100%.", yours, in your words "All of the new loaves sell"', author: 'person', family: 'quantity' }]);
  });

  it('targeted answers with a structural change in ONE call (DoD 24 Oct, marketing: refusing the pair dropped their goals): ONE card holds the answers, set exactly, and Olumi\'s drafter writes the change on the model that holds them', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'The oven costs £2,500. We also want to reach 400 loaves a week.';
    const price = { status: 'known', value: 2500, question: null, author: 'person', quote: 'The oven costs £2,500' } as const;
    // The drafter's reply: the model it was given (the answer in it), with the new goal and its target.
    replies = [savedWith((d) => {
      setQ(d, 'oven_price', price);
      d.quantities.push(q('stretch_target', 'loaf/week', { value: 400, quote: 'reach 400 loaves a week' }));
      d.goals.push({ ...d.goals[0]!, id: 'stretch', label: 'Reach 400 loaves a week', measure: { ...d.goals[0]!.measure!, target: 'stretch_target' }, quote: 'reach 400 loaves a week' });
    })];
    sent.length = 0;
    const p = await proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
      ProgramChangeParams.parse({ public_label: 'Oven price and a second goal', basis: 'their answer and their goal', request: 'Add a second goal: reach 400 loaves a week.', remove: [],
        answers: [{ id: 'oven_price', status: 'known', author: 'person', value: 2500, low: null, high: null, range_kind: null, party: null, quote: 'The oven costs £2,500', basis: null }] })) as Json;
    expect(p.status, JSON.stringify(p)).toBe('ok');
    // ONE drafter call, given the model WITH the answer set exactly: nothing they said is lost to the redraft.
    expect(sent).toHaveLength(1);
    const given = JSON.parse(String((sent[0]!.input as Json[])[1]!.content)) as CanonicalModelT;
    expect(given.quantities.find((x) => x.id === 'oven_price')).toMatchObject(price);
    // ONE card with every change: their figure, the new target and the new goal.
    expect(p.data.changes.map((c: Json) => [c.id, c.action, c.author]).sort()).toEqual([['oven_price', 'change', 'person'], ['stretch', 'add', 'person'], ['stretch_target', 'add', 'person']]);
    const held = (deps.proposals.get(p.data.proposal_id)!.living_model as { canonical: CanonicalModelT }).canonical;
    expect(held.quantities.find((x) => x.id === 'oven_price')).toMatchObject(price);
    expect(held.goals.map((g) => g.id)).toEqual(['more_loaves', 'stretch']);
    // C4 (alpha spec §3, 27 Oct) restores B27's re-set of the answers on the drafter's merged model. B27's own refusals and
    // B19 stay removed: a removal it makes is refused only by the validator's own removal check.
    const savedOven = (programReadOf(persisted!) as { program: { canonical: CanonicalModelT } }).program.canonical.quantities.find((x) => x.id === 'oven_price')!;
    const mixed = (reply: string) => {
      replies = [reply]; sent.length = 0;
      return proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
        ProgramChangeParams.parse({ public_label: 'Oven price and a second goal', basis: 'their answer and their goal', request: 'Add a second goal: reach 400 loaves a week.', remove: [],
          answers: [{ id: 'oven_price', status: 'known', author: 'person', value: 2500, low: null, high: null, range_kind: null, party: null, quote: 'The oven costs £2,500', basis: null }] })) as Promise<Json>;
    };
    // Codex r1 #3729: an update that leaves the oven figure out (the saved one unchanged) plus the new goal.
    const dropped = await mixed(savedWith((d) => {
      d.quantities.push(q('stretch_target', 'loaf/week', { value: 400, quote: 'reach 400 loaves a week' }));
      d.goals.push({ ...d.goals[0]!, id: 'stretch', label: 'Reach 400 loaves a week', measure: { ...d.goals[0]!.measure!, target: 'stretch_target' }, quote: 'reach 400 loaves a week' });
    }));
    expect(dropped.status, JSON.stringify(dropped)).toBe('ok');
    expect(sent).toHaveLength(1);
    expect((deps.proposals.get(dropped.data.proposal_id)!.living_model as { canonical: CanonicalModelT }).canonical.quantities.find((x) => x.id === 'oven_price'))
      .toMatchObject({ ...price, low: null, high: null, range_kind: null });
    // The drafter's update did not return that record, so the merge keeps the one it was given: the answer, set once.
    expect(savedOven.value).not.toBe(2500);
    expect(dropped.data.changes.map((c: Json) => [c.id, c.action, c.author]).sort()).toEqual([['oven_price', 'change', 'person'], ['stretch', 'add', 'person'], ['stretch_target', 'add', 'person']]);
    // And one that writes another figure on the item they answered: their answer stands on it (C4).
    const overwritten = await mixed(savedWith((d) => {
      setQ(d, 'oven_price', { ...price, value: 3000 });
      d.quantities.push(q('stretch_target', 'loaf/week', { value: 400, quote: 'reach 400 loaves a week' }));
      d.goals.push({ ...d.goals[0]!, id: 'stretch', label: 'Reach 400 loaves a week', measure: { ...d.goals[0]!.measure!, target: 'stretch_target' }, quote: 'reach 400 loaves a week' });
    }));
    expect(overwritten.status, JSON.stringify(overwritten)).toBe('ok');
    expect(sent).toHaveLength(1);
    expect((deps.proposals.get(overwritten.data.proposal_id)!.living_model as { canonical: CanonicalModelT }).canonical.quantities.find((x) => x.id === 'oven_price'))
      .toMatchObject({ ...price, low: null, high: null, range_kind: null });
    expect(overwritten.data.changes.find((c: Json) => c.id === 'oven_price')).toMatchObject({ action: 'change', author: 'person' });
    // A drafter that removes the item they answered: refused by the validator's removal check, never by B19's sentence.
    const removed = await mixed(savedWith((d) => {
      d.quantities = d.quantities.filter((x) => x.id !== 'oven_price');
      d.relations = d.relations.filter((r) => r.id !== 'spend_rel');
    }));
    expect(removed, JSON.stringify(removed)).toMatchObject({ status: 'refused', reason: 'omitted_record' });
    expect(JSON.stringify(removed)).not.toContain('the change removed what you answered');
  });

  it('European fix request (CEE bb11fd62, scenario 7a46b31e, turn 31fc7c00): Olumi\'s own figures for an option\'s setting, and the structure\'s figure, withdrawn into questions of theirs need no words this turn; S1 strip (A2, A2b off): nor does a new figure of theirs, or a figure kept under the question', async () => {
    // The drafter's first model: Olumi's option, its setting Olumi's figure, and the setting's off state the structure's.
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'one_oven' ? { ...x, author: 'olumi' as const, quote: null, basis: 'Olumi’s proposed setting for its option.' }
      : x.id === 'ovens_added' ? { ...x, author: 'structure' as const, quote: null, basis: 'None added until an option takes effect.' } : x));
    m.options = m.options.map((o) => (o.id === 'second_oven' ? { ...o, author: 'olumi' as const, quote: null, sets: o.sets.map((s) => ({ ...s, author: 'olumi' as const, quote: null })) } : o));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'Can you sort out the figures you made up for me?';
    const propose = (edit: (d: CanonicalModelT) => void, on = deps) => { replies = [savedWith(edit)]; return proposeProgramChange(on, { scenario_id: SCENARIO, authenticated_user_id: null,
      turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
      ProgramChangeParams.parse({ public_label: 'Ask for the settings', basis: 'Olumi’s figures were placeholders', request: 'Ask them for the settings Olumi made up.', remove: [] })) as Promise<Json>; };
    const asked = (question: string): Partial<CanonicalQuantityT> => ({ status: 'asked', author: 'person', value: null, low: null, high: null, range_kind: null, quote: null, question, basis: null });
    // The withdrawal: both figures that were never theirs become their questions, with no words of theirs to quote.
    const p = await propose((d) => { setQ(d, 'one_oven', asked('How many ovens would you add?')); setQ(d, 'ovens_added', asked('How many ovens are you adding today?')); });
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(p.data.changes.map((c: Json) => [c.id, c.action, c.author])).toEqual([['ovens_added', 'change', 'person'], ['one_oven', 'change', 'person']]);
    // No longer refused (A2, A2b off; each in its own store): a NEW figure of theirs with no words; one quoting only their
    // earlier words; and a figure kept under the question. Each is on the card as the AI wrote it, theirs.
    for (const f of [{ author: 'person' as const, status: 'known' as const, value: 2, quote: null, basis: null }, { author: 'person' as const, status: 'known' as const, value: 2, quote: 'A second oven', basis: null },
      { ...asked('How many ovens would you add?'), value: 1 }]) {
      const loose = await propose((d) => setQ(d, 'one_oven', f), { dispatch, proposals: new ProposalStore() });
      expect(loose.status, JSON.stringify(loose)).toBe('ok');
      expect(loose.data.changes.map((c: Json) => [c.id, c.author])).toEqual([['one_oven', 'person']]);
    }
    // Saved as approved: their questions, no words put in their mouth.
    expect(await applyProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'one_oven'))
      .toMatchObject({ status: 'asked', author: 'person', value: null, quote: null, question: 'How many ovens would you add?' });
  });

  it('issue 37 (marketing at 485ee1af, 3 of 5 runs): a figure of theirs said EXACTLY in another calendar unit (their 1 year as 12 month, the time step moved to month for a 3-month goal) is the same figure, so the goals are saved; S1 strip (A2b off): any other change of its amount is proposed too, shown before and after, for their press', async () => {
    const brief = `${BRIEF} The £3,000 is for 1 year.`;
    const m = bakery();
    m.period = 'year';
    m.quantities.push(q('budget_window', 'year', { value: 1, quote: 'The £3,000 is for 1 year' }));
    m.limits = m.limits.map((l) => ({ ...l, measure: { ...l.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'budget_window' } } }));
    replies = [JSON.stringify(m)];
    expect((await turn({ message: brief })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    const words = 'We want 340 loaves a week within the first 3 months.';
    // The drafter's whole updated model: their new goal with its 3-month window, so the time step is a month and their budget
    // window is said in months.
    const early = (window: Partial<CanonicalQuantityT>) => savedWith((d) => {
      d.period = 'month';
      setQ(d, 'budget_window', window);
      d.quantities.push(q('early_target', 'loaf/week', { value: 340, quote: 'We want 340 loaves a week' }), q('early_months', 'month', { value: 3, quote: 'within the first 3 months' }));
      d.goals.push({ ...d.goals[0]!, id: 'early_loaves', label: '340 loaves a week within 3 months', quote: words.slice(0, -1),
        measure: { ...d.goals[0]!.measure!, target: 'early_target', window: { origin_event: null, origin_offset: null, start: 0, periods: 'early_months' } } });
    });
    const propose = (reply: string, on = deps) => { replies = [reply]; return proposeProgramChange(on, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words],
      user_turn_text: words }, ProgramChangeParams.parse({ public_label: 'An early goal', basis: 'their goal', request: 'Add their goal: 340 loaves a week within the first 3 months.', remove: [] })) as Promise<Json>; };
    // No longer refused (each in its own store): their 1 year said as 1 month, or as 13 months; and their figure turned into a
    // question. Each is on the card as a change of theirs, for their press.
    for (const moved of [{ unit: 'month' }, { unit: 'month', value: 13 }, { unit: 'month', status: 'asked' as const, value: null, quote: null }]) {
      const loose = await propose(early(moved), { dispatch, proposals: new ProposalStore() });
      expect(loose.status, JSON.stringify(moved)).toBe('ok');
      expect(loose.data.changes.find((c: Json) => c.id === 'budget_window'), JSON.stringify(moved)).toMatchObject({ action: 'change', author: 'person' });
    }
    // Contrast (MATHS, kept): as 52 weeks a window in a monthly model is no whole number of its periods, so the compiler refuses it.
    expect(await propose(early({ unit: 'week', value: 52 }), { dispatch, proposals: new ProposalStore() })).toMatchObject({ status: 'refused', reason: 'does_not_compile' });
    // The same figure, said exactly in months: the card goes ahead and shows it, still theirs in their words.
    const p = await propose(early({ unit: 'month', value: 12 }));
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(p.data.changes.map((c: Json) => [c.id, c.action, c.author])).toEqual([['budget_window', 'change', 'person'], ['early_target', 'add', 'person'], ['early_months', 'add', 'person'],
      ['early_loaves', 'add', 'person'], ['period', 'change', 'olumi']]);
    expect(p.data.changes.find((c: Json) => c.id === 'budget_window')).toMatchObject({ before: '1 year', after: '12 months' });
    expect(await applyProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, p.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    expect(saved.goals.map((g) => g.id)).toEqual(['more_loaves', 'early_loaves']);
    expect(saved.period).toBe('month');
    expect(saved.quantities.find((x) => x.id === 'budget_window')).toMatchObject({ unit: 'month', value: 12, low: null, high: null, status: 'known', author: 'person', quote: 'The £3,000 is for 1 year' });
    // The one validator, unit by unit: every re-expression is shown (A1b) and none is refused for their words (A2b off).
    const said = (from: Partial<CanonicalQuantityT>, to: Partial<CanonicalQuantityT>) => {
      const was = JSON.parse(JSON.stringify(saved)) as CanonicalModelT; setQ(was, 'budget_window', from);
      const now = JSON.parse(JSON.stringify(was)) as CanonicalModelT; setQ(now, 'budget_window', to);
      return validatePostimage(was, now, { removals: [], words: [brief, words], fresh: [words] });
    };
    expect(said({ unit: 'week', value: 1 }, { unit: 'day', value: 7 })).toMatchObject({ ok: true, changes: [{ id: 'budget_window', action: 'change', before: '1 week', after: '7 days' }] });
    expect(said({ unit: 'week', value: 13 }, { unit: 'month', value: 3 })).toMatchObject({ ok: true, changes: [{ id: 'budget_window', action: 'change', before: '13 weeks', after: '3 months' }] });
    // A range converts end by end: every one of value, low and high exactly, or it is a change (Codex BLOCK on #3739).
    const range = { unit: 'year', value: 1, low: 1, high: 2 };
    expect(said(range, { unit: 'month', value: 12, low: 12, high: 24 }).ok).toBe(true);
    expect(said({ ...range, value: null }, { unit: 'month', value: null, low: 12, high: 24 }).ok).toBe(true);
    for (const to of [{ value: 12, low: 12, high: 25 }, { value: 12, low: 11, high: 24 }, { value: 13, low: 12, high: 24 }, { value: 12, low: null, high: null }]) {
      expect(said(range, { unit: 'month', ...to }).ok, JSON.stringify(to)).toBe(true);
    }
    // Exact is the float product in the conversion's direction, nothing looser (Codex BLOCK ×2 on #3739): 1 year as 12 month and
    // 6 month as 0.5 year are the same figure; 10^15 years as 12×10^15 + 8 or + 100 months is not, as a value or as either end of
    // a range. Nor is 0.1 year as 1.2 month (0.1 × 12 is not 1.2 in binary): refusing it is the safe base behaviour, their
    // words this turn asked for as for any change of their figure.
    expect(said({ unit: 'year', value: 1 }, { unit: 'month', value: 12 }).ok).toBe(true);
    expect(said({ unit: 'month', value: 6 }, { unit: 'year', value: 0.5 }).ok).toBe(true);
    expect(0.1 * 12).not.toBe(1.2);
    expect(said({ unit: 'year', value: 0.1 }, { unit: 'month', value: 1.2 }).ok).toBe(true);
    for (const plus of [8, 100]) {
      for (const [from, to] of [[{ value: 1e15 }, { value: 12e15 + plus }], [{ value: null, low: 1e15, high: 2e15 }, { value: null, low: 12e15 + plus, high: 24e15 }],
        [{ value: null, low: 1e15, high: 2e15 }, { value: null, low: 12e15, high: 24e15 + plus }]] as const) {
        expect(said({ unit: 'year', ...from }, { unit: 'month', ...to }).ok, JSON.stringify(to)).toBe(true);
        expect(said({ unit: 'year', ...from }, { unit: 'month', ...Object.fromEntries(Object.entries(from).map(([k, v]) => [k, v === null ? null : v * 12])) }).ok, `${JSON.stringify(from)} ×12`).toBe(true);
      }
    }
  });

  // Strip (Paul 26 Oct; B22 removed): authorship is the AI's alone. The host no longer refuses an answer whose owner and status
  // do not match; whatever the engine's maths needs (an estimate's range) is the compiler's to refuse.
  it('targeted answers (B22 removed): whose an answer is comes from what the AI declares, never checked or re-authored by the host: Olumi\'s estimate stays Olumi\'s, and a mismatch is never refused as not_an_answer', async () => {
    replies = [JSON.stringify(bakery())];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const deps = { dispatch, proposals: new ProposalStore() };
    sent.length = 0;
    const ask = (words: string, a: Json) => proposeProgramChange(deps, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
      ProgramChangeParams.parse({ public_label: 'An answer', basis: 'their question', request: '', remove: [], answers: [{ id: 'sell_through', value: null, party: null, quote: null, ...a }] })) as Promise<Json>;
    const estimate = { status: 'estimated', author: 'olumi', low: 0.6, high: 0.95, range_kind: 'plausible', basis: 'A busy high street sells most of what is baked.' };
    const p = await ask('Could you estimate how much of it would sell?', estimate);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    expect(sent).toHaveLength(0);
    expect(p.data.changes.map((c: Json) => [c.id, c.author])).toEqual([['sell_through', 'olumi']]);
    expect((deps.proposals.get(p.data.proposal_id)!.living_model as { canonical: CanonicalModelT }).canonical.quantities.find((x) => x.id === 'sell_through')).toMatchObject({ status: 'estimated', author: 'olumi',
      low: 0.6, high: 0.95, range_kind: 'plausible', quote: null, party: null, basis: 'A busy high street sells most of what is baked.' });
    // Never refused by the host's ownership check, and never re-authored: Olumi's estimate in their words, or without its range
    // or basis; their answer declared as an estimate; Olumi's declared as known.
    for (const bad of [{ ...estimate, quote: 'Could you estimate' }, { ...estimate, high: null }, { ...estimate, basis: ' ' },
      { ...estimate, author: 'person', quote: 'Could you estimate' }, { ...estimate, status: 'known' }]) {
      const out = await ask('Could you estimate how much of it would sell?', bad);
      expect((out as Json).reason, JSON.stringify(bad)).not.toBe('not_an_answer');
    }
    expect(sent).toHaveLength(0);
  });

  it('the alpha3 hiring read, through the same update path: the measure they name gets Olumi\'s mechanism on ONE card that shows every change; a figure only they know is ASKED, then the chance appears', async () => {
    const saved = savedDraft('./hiring-alpha3.saved.json');
    replies = [JSON.stringify(saved.canonical)];
    expect((await turn({ message: saved.brief })).json().model_program.saved).toBe(true);
    const before = JSON.parse(JSON.stringify(persisted!.living_model.canonical)) as CanonicalModelT;
    expect(before.goals.find((g) => g.id === 'increase_productivity')!.measure).toBeNull(); // costs-only: the aim has no measure
    const words = 'We measure productivity by the features we ship each month.';
    const deps = { dispatch, proposals: new ProposalStore() };
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words };
    // Each attempt is its own turn (a turn shows one card).
    const propose = (on = deps) => proposeProgramChange(on, { ...ctx, turn_id: randomUUID() }, ProgramChangeParams.parse({ public_label: 'Measure productivity', basis: 'their answer',
      request: 'Productivity is measured by the features shipped each month; work that out from the hires.', remove: [] })) as Promise<Json>;
    // The drafter's update: their measure on the aim, and what works it out (synthetic Olumi figures, never a test sheet's); whole, the model it makes.
    const completed = (edit: (m: CanonicalModelT) => void = () => undefined, whole = false): string => {
      const m = JSON.parse(JSON.stringify(before)) as CanonicalModelT;
      m.quantities.push(q('features_shipped_per_month', 'feature/month', { label: 'Features shipped per month', kind: 'derived', status: 'derived', quote: words }),
        q('features_now', 'feature/month', { status: 'asked', question: 'How many features does the team ship in a month now?' }),
        q('lead_effect', 'feature/month/tech_lead', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 2, low: 0, high: 4, range_kind: 'plausible', basis: 'A lead mostly unblocks others; the size varies widely.' }),
        q('developer_effect', 'feature/month/developer', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 1, low: 0.3, high: 1.5, range_kind: 'plausible', basis: 'A new developer adds less than an experienced one at first.' }));
      m.goals = m.goals.map((g) => (g.id === 'increase_productivity' ? { ...g, question: null, measure: { quantity: 'features_shipped_per_month', per: null, cmp: '>=', target: 'productivity_increase_target',
        frame: 'change_rel', reference: { kind: 'now', option: null, quantity: null }, aggregation: 'end', window: { origin_event: null, origin_offset: null, start: 0, periods: 'launch_horizon' },
        measure_by: 'person', assumptions: [], exclusions: [] } } : g));
      m.relations.push({ form: 'effect', id: 'features_rel', defines: 'features_shipped_per_month', base: 'features_now', author: 'olumi', quote: null, ...at,
        terms: [{ driver: 'tech_leads_hired', coefficient: 'lead_effect', author: 'olumi', quote: null, ...at }, { driver: 'developers_hired', coefficient: 'developer_effect', author: 'olumi', quote: null, ...at }] });
      m.claims.push({ id: 'leads_unblock', text: 'A lead mostly raises output by unblocking the others.', concerns: ['lead_effect'], author: 'olumi', quote: null, ...at },
        { id: 'lead_needs_scope', text: 'A lead helps most once the launch scope is clear.', concerns: ['features_rel'], author: 'olumi', quote: null, ...at });
      m.assumptions.push({ id: 'hires_productive_in_window', text: 'New hires are productive within the launch window.', applied: true, concerns: ['features_rel', 'leads_unblock'], author: 'olumi', quote: null, ...at });
      m.conditions.push({ id: 'scope_agreed_first', text: 'Only once the launch scope is agreed.', kind: 'prerequisite', concerns: ['lead_needs_scope'], author: 'olumi', quote: null, ...at });
      edit(m);
      return whole ? JSON.stringify(m) : asUpdate(JSON.stringify(m));
    };
    const cardModel = (r: Json) => savedProgramOf({ living_model: deps.proposals.get(r.data.proposal_id)!.living_model })!.canonical;

    // S1 strip (B2 off): the update's structure figures are read as the AI wrote them, never rewritten into their questions.
    replies = [completed((d) => { d.quantities.push(q('current_output', 'feature/month', { author: 'structure', value: 12 }), q('months_per_year', 'month/year', { author: 'structure', value: 12 }));
      (d.relations.find((r) => r.id === 'features_rel') as { base: string }).base = 'current_output'; })];
    const structured = await propose();
    expect(structured.status, JSON.stringify(structured)).toBe('ok');
    const sm = cardModel(structured);
    expect(sm.quantities.find((x) => x.id === 'current_output')).toMatchObject({ author: 'structure', status: 'known', value: 12 });
    expect(sm.quantities.find((x) => x.id === 'months_per_year')).toMatchObject({ author: 'structure', status: 'known', value: 12 });
    expect(compile(sm, { sourceText: `${saved.brief}\n${words}` }).perGoal.find((g) => g.goal_id === 'increase_productivity')!.asks).not.toContain('current_output');
    const read = (edit: (d: CanonicalModelT) => void) => normalise(JSON.parse(completed(edit, true)) as CanonicalModelT);
    const onBase = (quote: string | null, value: number) => (d: CanonicalModelT) => { d.quantities.push(q('current_features', 'feature/month', { author: 'structure', value, quote }));
      (d.relations.find((r) => r.id === 'features_rel') as { base: string }).base = 'current_features'; };
    expect(read(onBase('We ship 4 features a month', 4)).quantities.find((x) => x.id === 'current_features')).toMatchObject({ author: 'structure', status: 'known', value: 4, quote: 'We ship 4 features a month' });

    // Refused: a note naming a record that is not there, after the drafter's two repairs (its sentence goes back each time).
    replies = Array.from({ length: 3 }, () => completed((d) => { d.assumptions[d.assumptions.length - 1]!.concerns.push('no_such_record'); }));
    sent.length = 0;
    expect(await propose()).toMatchObject({ status: 'refused', reason: 'does_not_compile' });
    expect(sent).toHaveLength(3);
    // S1 strip (A2, A2b off; each in its own store): a figure only they know given as theirs in words they never wrote, and one
    // of their figures rewritten under their EARLIER words, are proposed as the AI wrote them, shown on the card for their press.
    replies = [completed((d) => setQ(d, 'features_now', { status: 'known', value: 12, question: null, quote: 'about 12 a month' }))];
    const invented = await propose({ dispatch, proposals: new ProposalStore() });
    expect(invented.status, JSON.stringify(invented)).toBe('ok');
    expect(invented.data.changes.find((c: Json) => c.id === 'features_now')).toMatchObject({ author: 'person' });
    const budget = before.quantities.find((x) => x.author === 'person' && x.value !== null && x.kind === 'fact')!;
    replies = [completed((d) => setQ(d, budget.id, { value: budget.value! + 1 }))];
    const rewritten = await propose({ dispatch, proposals: new ProposalStore() });
    expect(rewritten.status, JSON.stringify(rewritten)).toBe('ok');
    expect(rewritten.data.changes.find((c: Json) => c.id === budget.id)).toMatchObject({ action: 'change', author: 'person' });
    // Refused: a record left out without a listed removal; nothing is removed unless the change lists it for their review.
    const dropped = before.options[0]!.id;
    replies = [completed((d) => { d.options = d.options.filter((o) => o.id !== dropped); })];
    expect(await propose()).toMatchObject({ status: 'refused', reason: 'omitted_record', data: { ids: [dropped] } });
    // A change the drafter makes beyond the request is never hidden: an option it renames is on the card, before and after.
    replies = [completed((d) => { d.options = d.options.map((o) => ({ ...o, label: `${o.label} (Olumi)` })); })];
    const renamed = await propose();
    expect(renamed.status, JSON.stringify(renamed)).toBe('ok');
    expect(renamed.data.changes.filter((c: Json) => c.kind === 'option').map((c: Json) => [c.id, c.action, c.label])).toEqual(before.options.map((o) => [o.id, 'change', `${o.label} (Olumi)`]));

    // The completion: one drafter call; every change on the card, Olumi's visibly Olumi's and provisional, with a basis; the
    // person's figure it needs is a question; their 10% and their three months are the aim's target and window again.
    replies = [completed()];
    sent.length = 0;
    const card = await propose();
    expect(card.status, JSON.stringify(card)).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(card.data.changes.map((c: Json) => [c.id, c.kind, c.action, c.author])).toEqual([
      ['features_shipped_per_month', 'quantity', 'add', 'person'], ['features_now', 'quantity', 'add', 'person'], ['lead_effect', 'quantity', 'add', 'olumi'], ['developer_effect', 'quantity', 'add', 'olumi'],
      ['features_rel', 'relation', 'add', 'olumi'], ['increase_productivity', 'goal', 'change', 'person'], ['leads_unblock', 'record', 'add', 'olumi'], ['lead_needs_scope', 'record', 'add', 'olumi'],
      ['hires_productive_in_window', 'record', 'add', 'olumi'], ['scope_agreed_first', 'record', 'add', 'olumi']]);
    expect(card.data.changes.find((c: Json) => c.id === 'features_rel').after).toBe('starts from "features now" and changes by "lead effect" for each "Tech leads hired", '
      + 'and by "developer effect" for each "Additional developers hired"');
    expect(registered).toHaveLength(1); // proposing saves nothing
    expect(await applyProgramChange(deps, ctx, card.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const after = persisted!.living_model.canonical as CanonicalModelT;
    expect(stableStringify(persisted!.living_model)).toBe(stableStringify(deps.proposals.get(card.data.proposal_id)!.living_model));
    expect(after.goals.find((g) => g.id === 'increase_productivity')!.measure).toMatchObject({ quantity: 'features_shipped_per_month', target: 'productivity_increase_target', frame: 'change_rel',
      window: { start: 0, periods: 'launch_horizon' }, measure_by: 'person' });
    expect(after.quantities.find((x) => x.id === 'features_shipped_per_month')).toMatchObject({ kind: 'derived', status: 'derived', author: 'person', quote: words });
    expect(after.quantities.find((x) => x.id === 'features_now')).toMatchObject({ status: 'asked', value: null, author: 'person', quote: null });
    // Approving the card records acceptance of Olumi's parts; their author stays Olumi (host-owned, never the AI's).
    for (const id of ['lead_effect', 'developer_effect']) expect(after.quantities.find((x) => x.id === id)).toMatchObject({ author: 'olumi', status: 'estimated', approval: 'approved', author_id: null, basis: expect.any(String) });
    expect(after.relations.find((r) => r.id === 'features_rel')).toMatchObject({ author: 'olumi', approval: 'approved', terms: [{ author: 'olumi', approval: 'approved' }, { author: 'olumi', approval: 'approved' }] });
    // Everything they had stays as it was, by id: every earlier record, its author and words; the history gains the one change.
    for (const family of ['quantities', 'relations', 'limits', 'options', 'risks', 'claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out'] as const) {
      for (const r of before[family] as { id: string }[]) expect((after[family] as { id: string }[]).find((x) => x.id === r.id), `${family}:${r.id}`).toEqual(r);
    }
    expect(after.history).toEqual([...before.history, expect.objectContaining({ id: 'increase_productivity', change: 'superseded' })]);
    // An option → outcome path now: the aim waits on exactly the one figure only they know, never on a guess.
    const waiting = compile(after, { sourceText: persisted!.living_model.person_words.join('\n') });
    expect(waiting.errors).toEqual([]);
    expect(waiting.perGoal.find((g) => g.goal_id === 'increase_productivity')).toMatchObject({ status: 'asks', asks: ['features_now'] });

    // Their answer to that question, through the same path: each option's chance of the aim appears.
    const now = 'We ship about 12 features a month now.';
    const ctx2 = { ...ctx, turn_id: randomUUID(), verified_user_messages: [now], user_turn_text: now };
    replies = [savedWith((d) => setQ(d, 'features_now', { status: 'known', value: 12, question: null, quote: now, basis: APPROXIMATE_FIGURE }))];
    const fill = await proposeProgramChange(deps, ctx2, { public_label: 'Features now', basis: 'their answer', request: 'They ship about 12 features a month now.', remove: [] }) as Json;
    expect(fill.status, JSON.stringify(fill)).toBe('ok');
    expect(await applyProgramChange(deps, ctx2, fill.data.proposal_id)).toMatchObject({ status: 'ok', data: { saved: true } });
    const view = (persisted!.living_model.runs.at(-1).result as Json).canonical_analysis_view as Json;
    // (The launch aim still has no measure, so the joint chance waits for it and says so; this aim's own chance is shown.)
    const aim = (view.goal_chance as Json).targets.per_target.find((t: Json) => t.constraint_id === 'increase_productivity');
    expect(aim.options.map((o: Json) => o.option_id)).toEqual(['hire_tech_lead', 'hire_two_developers']);
    for (const o of aim.options) expect(o.display).toMatch(/^about \d+%$/);
    expect(aim.words).toMatch(/Olumi’s assumed relationship/);
    for (const c of persisted!.living_model.runs.at(-1).result.chances as Json[]) expect(c.per_goal).toEqual([expect.objectContaining({ goal_id: 'increase_productivity', chance: expect.any(Number) })]);
  });

  it('display fit (Lenses 23 Oct): every link its own id and sign; the goal target, each figure\'s source and every editable id on the fields the canvas reads', () => {
    // A part used twice (a difference of one quantity with itself) is two links, each with its own sign.
    const twice = bakery();
    twice.quantities.push(q('net_zero', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }));
    twice.relations.push({ form: 'definition', id: 'zero_rel', defines: 'net_zero', op: 'sum', parts: [{ id: 'base_sales', sign: 1 }, { id: 'base_sales', sign: -1 }], author: 'olumi', quote: null, ...at });
    const tg = project(twice, compile(twice, { sourceText: BRIEF })).graph;
    // W3b: each link's sign is its direction alone; no link carries a strength (a bare ±1 drew it "Very strong").
    const zero = tg.edges.filter((e) => e.to === 'net_zero').map((e) => [e.id, 'strength' in e, e.effect_direction]);
    expect(zero).toEqual([['base_sales__net_zero', false, 'positive'], ['base_sales__net_zero__2', false, 'negative']]);
    expect(new Set(tg.edges.map((e) => e.id)).size).toBe(tg.edges.length);

    // A later answer of the person's is theirs as entered, never "from your brief".
    const words = 'The oven would cost about £2,500.';
    const answered = bakery();
    answered.quantities = answered.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known', value: 2500, question: null, quote: words } : x));
    const g = project(answered, compile(answered, { sourceText: `${BRIEF}\n${words}` }), { brief: BRIEF }).graph;
    const node = (id: string) => g.nodes.find((n) => n.id === id) as Json;
    expect(node('more_loaves')).toMatchObject({ goal_threshold_raw: 380, goal_threshold_cap: 475, goal_threshold: 0.8, goal_threshold_cap_provenance: 'target_derived_headroom',
      goal_threshold_frame: 'level', goal_threshold_unit: 'loaf/week', threshold_source: 'brief_extraction' });
    expect(node('base_sales').observed_state).toEqual({ value: 300, raw_value: 300, unit: 'loaf/week', source: 'brief_extraction', extractionType: 'explicit' });
    expect(node('sell_through').observed_state).toEqual({ value: 0.7, raw_value: 0.7, unit: '1', source: 'cee_inference', extractionType: 'inferred', range: { low: 0.5, high: 0.9 } });
    expect(node('oven_price').observed_state).toEqual({ value: 2500, raw_value: 2500, unit: 'GBP/oven', source: 'user_override' });
    // A derived figure has none drawn (it is worked out); the coefficient's id rides its link, so an edit maps back to it.
    expect(node('sales').observed_state).toBeUndefined();
    expect(g.edges.find((e) => e.id === 'ovens_added__sales')).toMatchObject({ coefficient_id: 'sold_per_oven' });
    // The canvas's goal target on a reload: the canonical readiness builder reads it off this graph.
    // W3b: a program graph is read as a program (its links carry no strength, so it is no legacy Living Model graph): on a
    // reload the builder reads the goal target off the goal card through the program's own readiness.
    const living = livingModelOf({ model_program: MODEL_PROGRAM, canonical: answered, seed: 1, person_words: [BRIEF, words], runs: [] });
    expect(buildCanonicalAnalysisReadyFromGraph({ ...g, living_model: living })).toMatchObject({ goal_node_id: 'more_loaves', goal_threshold_raw: 380 });
  });

  it('DL 23 Oct (alpha3 fit): a per-unit rate is drawn ONE way however the draft wrote it, on its driver\'s link with its coefficient_id, never as its own card with a second link', () => {
    const words = 'A second oven adds about 100 loaves a week';
    const of = (form: 'effect' | 'product'): CanonicalModelT => {
      const m = bakery();
      m.quantities = [...m.quantities.filter((x) => !['extra_per_oven', 'sell_through', 'sold_per_oven'].includes(x.id)),
        q('per_oven', 'loaf/week/oven', { kind: 'coefficient', value: 100, low: 80, high: 120, range_kind: 'plausible', quote: words }),
        q('extra_sales', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }),
        ...(form === 'effect' ? [q('no_extra', 'loaf/week', { value: 0, author: 'structure' })] : [])];
      const rate: CanonicalModelT['relations'][number] = form === 'effect'
        ? { form: 'effect', id: 'extra_rel', defines: 'extra_sales', base: 'no_extra', terms: [{ driver: 'ovens_added', coefficient: 'per_oven', author: 'person', quote: words, ...at }], author: 'person', quote: words, ...at }
        : { form: 'definition', id: 'extra_rel', defines: 'extra_sales', op: 'product', parts: [{ id: 'ovens_added', power: 1 }, { id: 'per_oven', power: 1 }], author: 'person', quote: words, ...at };
      m.relations = [rate, { form: 'definition', id: 'sales_rel', defines: 'sales', op: 'sum', parts: [{ id: 'base_sales', sign: 1 }, { id: 'extra_sales', sign: 1 }], author: 'olumi', quote: null, ...at },
        m.relations.find((r) => r.id === 'spend_rel')!];
      return m;
    };
    const shown = (form: 'effect' | 'product') => { const m = of(form); return project(m, compile(m, { sourceText: `${BRIEF}\n${words}` })); };
    const effect = shown('effect');
    const product = shown('product');
    // Q1 (Paul, 28 Oct: the situation, not the arithmetic): Olumi's "extra sales" total is said in the goal's workings, so the
    // rate's link runs from the ovens straight to the sales it adds to, with the same size.
    const rateLinks = (p: ReturnType<typeof project>) => p.graph.edges.filter((e) => e.from === 'ovens_added' && (e.to === 'sales' || e.to === 'extra_sales'));
    // ONE link carries the rate in both forms: its id for the link editor, its size in natural units, its sign, whose it is.
    expect(rateLinks(product)).toEqual(rateLinks(effect));
    expect(rateLinks(product)).toEqual([expect.objectContaining({ id: 'ovens_added__sales', from: 'ovens_added', to: 'sales', coefficient_id: 'per_oven', effect_direction: 'positive', origin: 'model_program:calculation',
      provenance: expect.objectContaining({ source: 'brief_extraction', magnitude: 'user_stated', natural_effect: expect.objectContaining({ amount: 100, amount_unit: 'loaf/week', per_source_change_unit: 'oven' }) }) })]);
    for (const p of [effect, product]) {
      expect(p.graph.nodes.find((n) => n.id === 'per_oven')).toBeUndefined();
      expect(p.graph.edges.filter((e) => e.from === 'per_oven')).toEqual([]);
      expect(p.items.find((i) => i.record_id === 'per_oven')?.shown_as).toEqual({ on_edge: 'ovens_added__sales' });
    }
    // Codex r4 #3709: a % rate's link figure is what the compiler uses, per ONE of the driver's unit (40 % → 0.4 loaf/week per
    // loaf/week), and it times the driver gives the compiled value; the card says it as the person gave it, 40 %.
    const pct = bakery();
    pct.quantities.push(q('sold_share', '%', { kind: 'coefficient', value: 40, quote: words }), q('sold', 'loaf/week', { kind: 'derived', status: 'derived', author: 'olumi' }));
    pct.relations.push({ form: 'definition', id: 'sold_rel2', defines: 'sold', op: 'product', parts: [{ id: 'base_sales', power: 1 }, { id: 'sold_share', power: 1 }], author: 'olumi', quote: null, ...at });
    pct.goals = [{ ...pct.goals[0]!, measure: { ...pct.goals[0]!.measure!, quantity: 'sold' } }]; // in the calculation
    const pc = compile(pct, { sourceText: `${BRIEF}\n${words}` });
    const pl = project(pct, pc).graph.edges.find((e) => e.id === 'base_sales__sold') as Json;
    const fixedOf = (id: string) => ((pc.executable?.quantities ?? []) as Json[]).find((x) => x.id === id)?.dist?.value as number | undefined;
    expect(pl).toMatchObject({ coefficient_id: 'sold_share', provenance: { natural_effect: { amount_unit: 'loaf/week', per_source_change_unit: 'loaf/week' } } });
    expect(pl.provenance.natural_effect.amount).toBeCloseTo(0.4, 12);
    expect(pl.provenance.natural_effect.amount).toBeCloseTo(fixedOf('sold_share')!, 12);
    expect(pl.provenance.natural_effect.amount * 300).toBeCloseTo(120, 9);
    expect(pl.provenance.reasoning).toMatch(/^40 % per loaf\/week/);
    // Contrast: a product of two coefficients has no one driver, so both parts stay cards with their own links, no coefficient_id.
    const pb = project(bakery(), compile(bakery(), { sourceText: BRIEF })).graph;
    const sold = pb.edges.filter((e) => e.to === 'sold_per_oven');
    expect(sold.map((e) => e.id)).toEqual(['extra_per_oven__sold_per_oven', 'sell_through__sold_per_oven']);
    expect(sold.some((e) => 'coefficient_id' in e)).toBe(false);
    expect(pb.nodes.filter((n) => n.id === 'extra_per_oven' || n.id === 'sell_through')).toHaveLength(2);
  });

  it('Lenses fit 2 (DL 23 Oct): a relative target is a fraction; what waits on an answer is in the analysis; each setting and worked-out figure says whose it is', () => {
    const nodeOf = (g: { nodes: Json[] }) => (id: string) => g.nodes.find((n) => n.id === id) as Json;
    // (1) "Grow sales by 10%" is change_rel 0.1 beside the measured quantity's unit (the canvas says "up 10% from today"),
    // never 10 (read as 1000%) and never on a cap scale; the same target written as the fraction 0.1 ("1") is the same.
    const relative = (target: Partial<CanonicalModelT['quantities'][number]>, unit: string) => {
      const m = bakery();
      m.quantities.push(q('growth', unit, { quote: 'grow sales by 10%', ...target }));
      m.goals = [{ ...m.goals[0]!, measure: { ...m.goals[0]!.measure!, target: 'growth', frame: 'change_rel', reference: { kind: 'now', option: null, quantity: null } } }];
      return nodeOf(project(m, compile(m)).graph)('more_loaves');
    };
    for (const goal of [relative({ value: 10 }, '%'), relative({ value: 0.1 }, '1')]) {
      expect(goal).toMatchObject({ goal_threshold_frame: 'change_rel', quantity_frame: 'level', goal_threshold_raw: 0.1, goal_threshold_unit: 'loaf/week', threshold_source: 'brief_extraction' });
      expect(goal).not.toHaveProperty('goal_threshold_cap');
      expect(goal).not.toHaveProperty('goal_threshold');
    }

    // (5) The bakery's limit waits on the oven's price: the price, the spend and the limit's inputs are IN the analysis,
    // waiting for the answer; with the extra per oven asked as well nothing can be worked out yet, and still only what is
    // genuinely out (a note, an aim with no measure) is excluded.
    const waiting = nodeOf(project(bakery(), compile(bakery(), { sourceText: BRIEF })).graph);
    // Q1 (28 Oct): its card reads "?"; that it waits for their answer, and the question, stay on it.
    expect(waiting('oven_price')).toMatchObject({ analysis_participation: 'included', display_value: '?',
      value_basis: { kind: 'waiting_for_answer', words: 'Waiting for your answer', question: 'What would the second oven cost?' } });
    expect(waiting('spend').analysis_participation).toBe('included');
    const none = bakery();
    none.quantities = none.quantities.map((x) => (x.id === 'extra_per_oven' ? { ...x, status: 'asked', value: null, quote: null, question: 'How many more loaves would a second oven bake?' } : x));
    none.goals.push({ id: 'regulars', label: 'Keep the regulars happy', measure: null, question: 'How would you know the regulars are happy?', author: 'person', quote: 'keep our one oven', ...at });
    none.claims.push({ id: 'busy', text: 'Saturdays are the busy day.', concerns: ['sales'], author: 'olumi', quote: null, ...at });
    const compiledNone = compile(none, { sourceText: BRIEF });
    expect([compiledNone.errors, compiledNone.executable]).toEqual([[], null]);
    const out = nodeOf(project(none, compiledNone).graph);
    for (const id of ['base_sales', 'ovens_added', 'extra_per_oven', 'sales', 'oven_price', 'spend', 'more_loaves', 'second_oven', 'keep_one']) {
      expect([id, out(id).analysis_participation]).toEqual([id, 'included']);
    }
    expect(['regulars', out('regulars').analysis_participation]).toEqual(['regulars', 'retained_excluded']);
    // A claim is not a card (DL 24 Oct): the canvas draws it from the model by id.
    expect(project(none, compiledNone).graph.nodes.find((n) => n.id === 'busy')).toBeUndefined();

    // (4) An option's setting says whose it is in the canvas's intervention vocabulary; a structural switch (on or off) is the
    // option's own. A worked-out figure says what it is worked out from; a structural constant says it is fixed by the model.
    const bake = nodeOf(project(bakery(), compile(bakery(), { sourceText: BRIEF }), { brief: BRIEF }).graph);
    expect(bake('second_oven').interventions.ovens_added).toMatchObject({ source: 'brief_extraction', source_words: 'Set by ‘A second oven’, from your brief' });
    expect(bake('sales')).toMatchObject({ display_value: 'Worked out from base sales and ovens added',
      value_basis: { kind: 'worked_out', from: ['base_sales', 'ovens_added'], words: 'Worked out from base sales and ovens added' } });
    const clubbed = nodeOf(project(club(), compile(club(), { sourceText: CLUB_BRIEF }), { brief: CLUB_BRIEF }).graph);
    expect(clubbed('promotion').interventions).toMatchObject({
      promo_on: { source: 'brief_extraction', source_words: 'Set by ‘Run a promotion’, from your brief' },
      spend: { source: 'brief_extraction', source_words: 'Set by ‘Run a promotion’, from your brief' } });
    // Q1 (Paul, 28 Oct): the promotion's on/off switch is no card of its own; the promotion's card says it, by its label.
    expect(clubbed('promo_on')).toBeUndefined();
    expect(clubbed('promotion').interventions.promo_on).toMatchObject({ label: 'promo on', value: 1 });
    expect(clubbed('members').value_basis).toMatchObject({ kind: 'worked_out', from: ['members_now', 'joins', 'leavers'] });

    // Codex r1 #3709 (1): a % range with no point is projected in the unit it is labelled with: 50–90 % sits at 70 %, never
    // the compiler's fraction 0.7 beside "%".
    const pct = bakery();
    pct.quantities = pct.quantities.map((x) => (x.id === 'sell_through' ? { ...x, unit: '%', value: null, low: 50, high: 90 } : x));
    const pctNode = nodeOf(project(pct, compile(pct, { sourceText: BRIEF })).graph)('sell_through');
    expect(pctNode.observed_state).toMatchObject({ value: 70, raw_value: 70, unit: '%', range: { low: 50, high: 90 } });
    // W10: 50 to 90 % read as the range it falls in 8 times out of 10, σ = 20/1.2815516 = 15.606 % (the √12 law: 11.55).
    expect(pctNode.display_value).toBe('50–90 %, Olumi\'s estimate; Olumi reads it as a rough range, provisionally'); // plain words on the card (Paul 28 Oct)
    // The σ is the law's, never the card's words (Paul 28 Oct): 0.15606 in the compiler's fraction scale.
    const pctLaw = compile(pct, { sourceText: BRIEF }).conversions.find((x) => x.kind === 'range_law' && x.quantity === 'sell_through') as { reading: { sd_below: number; sd_above: number } } | undefined;
    expect([pctLaw?.reading.sd_below, pctLaw?.reading.sd_above].map((x) => Math.round((x ?? 0) * 1e5) / 1e5)).toEqual([0.15606, 0.15606]);

    // DL 24 Oct (board 3de98183): a bare range of theirs IS the level. The centre the card draws is Olumi's reading, labelled
    // Olumi's; the range and their words stay theirs. A figure they state keeps their source.
    const costBrief = `${BRIEF} The oven is $40,000 to $50,000, and delivery is $10,000.`;
    const costs = bakery();
    costs.quantities = costs.quantities.map((x) => (x.id === 'oven_price' ? { ...x, unit: 'USD/oven', status: 'known', value: null, low: 40000, high: 50000, range_kind: 'bounds',
      question: null, quote: '$40,000 to $50,000' } : x));
    costs.quantities.push(q('delivery', 'USD', { value: 10000, quote: '$10,000' }));
    const costNode = nodeOf(project(costs, compile(costs, { sourceText: costBrief }), { brief: costBrief }).graph);
    expect(costNode('oven_price').observed_state).toEqual({ value: 45000, raw_value: 45000, unit: 'USD/oven', source: 'cee_inference', extractionType: 'inferred',
      range: { low: 40000, high: 50000 } });
    expect(costNode('oven_price')).toMatchObject({ provenance: 'from_brief', source_quote: '$40,000 to $50,000' });
    expect(costNode('delivery').observed_state).toEqual({ value: 10000, raw_value: 10000, unit: 'USD', source: 'brief_extraction', extractionType: 'explicit' });

    // Codex r1 #3709 (5), S1 strip (A25 off): a later answer of theirs is "yours" (user_override) by the AI's label, whether or
    // not its words are found in what the person wrote (the brief decides only brief vs later, J-AUTHOR-VOCAB).
    const words = 'The oven would cost about £2,500.';
    const answered = bakery();
    answered.quantities = answered.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known', value: 2500, question: null, quote: words } : x));
    const sourceOf = (text: string) => nodeOf(project(answered, compile(answered, { sourceText: text }), { brief: BRIEF }).graph)('oven_price').observed_state;
    expect(sourceOf(`${BRIEF}\n${words}`)).toMatchObject({ source: 'user_override' });
    expect(sourceOf(BRIEF)).toMatchObject({ source: 'user_override' });
  });

  it('notes and preferences are not cards (DL 24 Oct, the canvas glyph): a draft with each family saves none of them in graph.nodes, and the model keeps every word the card showed', async () => {
    const m = bakery();
    m.claims.push({ id: 'busy_saturdays', text: 'Saturdays are the busy day.', concerns: ['sales'], author: 'olumi', quote: null, ...at });
    m.evidence.push({ id: 'till_records', text: 'Sales rose 8% last spring.', source: 'last year’s till records', bears: 'supports', concerns: ['sales'], author: 'olumi', quote: null, ...at });
    m.assumptions.push({ id: 'full_speed', text: 'The new oven runs at full capacity from the first week.', applied: false, concerns: ['extra_per_oven'], author: 'olumi', quote: null, ...at });
    m.dissent.push({ id: 'keep_one_view', holder: 'the person', position: 'One oven may be enough.', concerns: ['second_oven'], author: 'person', quote: 'we could keep our one oven', ...at });
    m.conditions.push({ id: 'landlord', text: 'Only once the landlord agrees.', kind: 'prerequisite', concerns: ['second_oven'], author: 'olumi', quote: null, ...at });
    m.left_out.push({ id: 'regulars_mood', text: 'Keeping the regulars happy', why: 'It has no measure yet.', question: 'How would you know?', concerns: [], author: 'olumi', quote: null, ...at });
    m.preferences.push({ id: 'spend_less', quantity: 'spend', direction: 'lower', author: 'olumi', quote: null, ...at });
    replies = [JSON.stringify(m)];
    expect((await turn({ message: BRIEF })).json().model_program.saved).toBe(true);
    const ids = ['busy_saturdays', 'till_records', 'full_speed', 'keep_one_view', 'landlord', 'regulars_mood', 'spend_less'];
    // None is a card on the saved graph (positive control: the model's own cards are there).
    expect((persisted!.nodes as Json[]).filter((n) => ids.includes(String(n.id)))).toEqual([]);
    expect((persisted!.nodes as Json[]).map((n) => n.id)).toEqual(expect.arrayContaining(['base_sales', 'more_loaves', 'second_oven']));
    // Every word the card showed is in the saved model, by the record's own id: text, source, why, holder and position, quote.
    const saved = persisted!.living_model.canonical as CanonicalModelT;
    expect(saved.claims.find((x) => x.id === 'busy_saturdays')).toMatchObject({ text: 'Saturdays are the busy day.' });
    expect(saved.evidence.find((x) => x.id === 'till_records')).toMatchObject({ text: 'Sales rose 8% last spring.', source: 'last year’s till records' });
    expect(saved.assumptions.find((x) => x.id === 'full_speed')).toMatchObject({ text: 'The new oven runs at full capacity from the first week.' });
    expect(saved.dissent.find((x) => x.id === 'keep_one_view')).toMatchObject({ holder: 'the person', position: 'One oven may be enough.', quote: 'we could keep our one oven' });
    expect(saved.conditions.find((x) => x.id === 'landlord')).toMatchObject({ text: 'Only once the landlord agrees.' });
    expect(saved.left_out.find((x) => x.id === 'regulars_mood')).toMatchObject({ text: 'Keeping the regulars happy', why: 'It has no measure yet.' });
    expect(saved.preferences.find((x) => x.id === 'spend_less')).toMatchObject({ quantity: 'spend', direction: 'lower' });
    expect(saved.quantities.find((x) => x.id === 'spend')!.label).toBe('spend');
  });

  it('the stored Run names itself: run id, the revision it was computed against (its receipt digest), its time; stale once the model moves', async () => {
    replies = [JSON.stringify(bakery())];
    const r = (await turn({ message: BRIEF })).json();
    const run = persisted!.living_model.runs[0] as Json;
    const view = r.canonical_analysis_view;
    expect(view.run).toEqual({ run_id: run.run_id, graph_hash_at_run: run.receipt.revision_digest, computed_at: run.computed_at });
    expect(run.receipt.revision_digest).toBe(programRevisionOf(persisted));
    expect([view.staleness.stale, view.staleness.reason, view.face_when_stale]).toEqual([false, 'graph_hash_match', undefined]);
    expect(stableStringify(reopenProgram(persisted)!.view)).toBe(stableStringify(view));
    // Contrast: the model moved with no new Run (a word of the person's added): the SAME stored result, now said stale.
    const moved = JSON.parse(JSON.stringify(persisted));
    moved.living_model.person_words.push('and one more thing');
    const shown = reopenProgram(moved)! as { view: Json; current: boolean };
    expect([shown.current, shown.view.staleness.stale, shown.view.staleness.reason, shown.view.run.graph_hash_at_run]).toEqual([false, true, 'graph_hash_diverged', view.run.graph_hash_at_run]);
    expect(shown.view.face_when_stale).toBe(RUN_AGAIN_FOR_CHANCE);
    expect(stableStringify(shown.view.options)).toBe(stableStringify(view.options));
  });

  it('canvas edits on a program: a card figure and a goal target each set ONE figure as the person\'s, with a new Run; a link edit and a resend change nothing', async () => {
    replies = [JSON.stringify(bakery())];
    const drafted = await turn({ message: BRIEF });
    // DL 23 Oct (served capacity, stale card): a reply whose turn stored a Run names it in \`run\`, so the UI reads it after the write.
    expect(drafted.json().run).toMatchObject({ run_id: persisted!.living_model.runs[0].run_id, run_key: persisted!.living_model.runs[0].run_id, state: { kind: 'complete_current' } });
    sent.length = 0;
    const edit = (event: Json, turn_id = randomUUID()) => turn({ kind: 'system_event', turn_id, event });
    const figure = { kind: 'factor_value_edit', target_id: 'base_sales', value: 320 };
    const id = randomUUID();
    const r = await edit(figure, id);
    expect(r.statusCode, r.body).toBe(200);
    expect(sent).toHaveLength(0);
    const after = persisted!.living_model.canonical as CanonicalModelT;
    // D074 (C6): the figure as entered, re-pinned knowingly from the host's "base sales: 320 loaf/week".
    expect(after.quantities.find((x) => x.id === 'base_sales')).toMatchObject({ value: 320, author: 'person', quote: '320' });
    expect(persisted!.living_model.runs).toHaveLength(2);
    // The applied graph the canvas checks the edit against carries the typed figure, as the person's.
    const drawn = (r.json().model.graph.nodes as Json[]).find((n) => n.id === 'base_sales')!;
    expect(drawn.observed_state).toMatchObject({ value: 320, source: 'user_override' });
    expect(r.json().canonical_analysis_view.run.run_id).toBe(persisted!.living_model.runs[1].run_id);
    expect(r.json().run).toMatchObject({ run_id: persisted!.living_model.runs[1].run_id, state: { kind: 'complete_current', computed_at: persisted!.living_model.runs[1].computed_at } });
    expect(r.json().run.run_id).not.toBe(drafted.json().run.run_id);
    // The same edit resent: answered from what is saved, never applied twice; it stored no Run, so it names none.
    const saves = registered.length;
    const again = await edit(figure, id);
    expect([again.statusCode, again.json().durability, registered.length]).toEqual([200, 'replayed', saves]);
    expect(again.json().run).toBeNull();

    const target = await edit({ kind: 'goal_target_edit', goal_node_id: 'more_loaves', constraint_type: 'at_least', raw_value: 400, unit: 'loaf/week', base_graph_hash: hashOf(persisted) });
    expect(target.statusCode, target.body).toBe(200);
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'sales_target')).toMatchObject({ value: 400, author: 'person' });
    expect((persisted!.nodes as Json[]).find((n) => n.id === 'more_loaves')).toMatchObject({ goal_threshold_raw: 400, threshold_source: 'user', success_threshold: 400 });

    const saved = registered.length;
    const link = await edit({ kind: 'edge_strength_edit', from: 'ovens_added', to: 'sales', magnitude: 0.5, direction_intent: 'preserve', expected: { mean: 1, effect_direction: 'positive' }, intent: 'set' });
    expect(link.statusCode).toBe(409);
    expect(link.json().error).toMatchObject({ code: 'CANVAS_EDIT_REFUSED', nothing_saved: true });
    expect(link.json().error.message).toContain('change it in the chat');
    expect(registered.length).toBe(saved);
    expect(link.json().run).toBeNull();
  });

  it('DL 23 Oct (in-card range edit): a figure typed inside the person\'s own range moves its centre and keeps the range, and the chance moves; outside it, nothing is saved and they are asked', async () => {
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'extra_per_oven' ? { ...x, low: 80, high: 120, range_kind: 'plausible' } : x));
    replies = [JSON.stringify(m)];
    await turn({ message: BRIEF });
    sent.length = 0;
    const edit = (value: number) => turn({ kind: 'system_event', turn_id: randomUUID(), event: { kind: 'factor_value_edit', target_id: 'extra_per_oven', value } });
    const chance = () => ((persisted!.living_model.runs.at(-1).result.chances as Json[]).find((c) => c.option_id === 'second_oven')!.per_goal[0].chance as number);
    const first = chance();
    // Outside the range: refused with its reason (no question), nothing saved, no new Run.
    const saves = registered.length;
    const out = await edit(60);
    expect(out.statusCode).toBe(409);
    expect(out.json().error).toMatchObject({ code: 'CANVAS_EDIT_REFUSED', nothing_saved: true, message: '60 is outside your range of 80–120, so nothing was saved: change the range with it.' });
    expect(registered.length).toBe(saves);
    expect(persisted!.living_model.runs).toHaveLength(1);
    // Inside it: their new most likely figure, the range and its reading kept, and the second oven's chance goes UP.
    const inside = await edit(110);
    expect(inside.statusCode, inside.body).toBe(200);
    expect(sent).toHaveLength(0);
    expect((persisted!.living_model.canonical as CanonicalModelT).quantities.find((x) => x.id === 'extra_per_oven'))
      .toMatchObject({ value: 110, low: 80, high: 120, range_kind: 'plausible', author: 'person', status: 'known' });
    expect(chance()).toBeGreaterThan(first);
  });

  it('Codex r4–r8 + buddy #3709, S1 strip (B2 off): no structural admission on the first draft — every figure the AI labels structure is read as written', () => {
    const saved = savedDraft('./hiring-alpha3.saved.json');
    const m = JSON.parse(JSON.stringify(saved.canonical)) as CanonicalModelT;
    const derived = (id: string, unit: string) => q(id, unit, { kind: 'derived', status: 'derived', author: 'olumi' });
    const product = (id: string, defines: string, parts: [string, 1 | -1][]) => ({ form: 'definition' as const, id, defines, op: 'product' as const, parts: parts.map(([pid, power]) => ({ id: pid, power })), author: 'olumi' as const, quote: null, ...at });
    m.quantities.push(q('current_output', 'feature/month', { author: 'structure', value: 12 }), q('months_per_year', 'month/year', { author: 'structure', value: 12 }),
      q('current_utilisation', '1', { author: 'structure', value: 1 }), q('no_extra_output', 'feature/month', { author: 'structure', value: 0 }), derived('extra_output', 'feature/month'),
      // Codex r6: an unstated "current customers = 1" added in a sum is the person's figure, not an identity.
      q('current_customers', 'customer', { author: 'structure', value: 1 }), q('new_customers', 'customer', { author: 'structure', value: 0 }), derived('customers', 'customer'),
      // A 1 WITH a unit in a product (× 1 output unit per developer, ÷ 1 customer) is a level only the person gives (buddy, r8).
      q('output_per_developer', 'feature/month/developer', { author: 'structure', value: 1 }), derived('team_output', 'feature/month'),
      q('one_customer', 'customer', { author: 'structure', value: 1 }), derived('output_per_customer', 'feature/month/customer'),
      // The unit-free 1: × 1, "1 + growth", and the base of a dimensionless index ("current productivity, indexed").
      q('output_scale', '1', { author: 'structure', value: 1 }), derived('scaled_output', 'feature/month'),
      // Codex #3710: "1" exactly, never another dimensionless unit: a structural 1 % product factor is a figure to ask for.
      q('one_percent', '%', { author: 'structure', value: 1 }), derived('scaled_percent', 'feature/month'),
      q('productivity_indexed', '1', { author: 'structure', value: 1 }), derived('productivity_index', '1'),
      q('index_per_developer', '1/developer', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 0.1, low: 0, high: 0.2, range_kind: 'plausible', basis: 'Synthetic.' }),
      q('one', '1', { author: 'structure', value: 1 }), q('growth', '1', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 0.1, low: 0, high: 0.2, range_kind: 'plausible', basis: 'Synthetic.' }), derived('growth_factor', '1'));
    m.relations.push({ form: 'definition', id: 'extra_output_rel', defines: 'extra_output', op: 'sum', parts: [{ id: 'no_extra_output', sign: 1 }, { id: 'current_output', sign: 1 }], author: 'olumi', quote: null, ...at },
      { form: 'definition', id: 'customers_rel', defines: 'customers', op: 'sum', parts: [{ id: 'current_customers', sign: 1 }, { id: 'new_customers', sign: 1 }], author: 'olumi', quote: null, ...at },
      product('team_output_rel', 'team_output', [['current_developers', 1], ['output_per_developer', 1]]),
      product('per_customer_rel', 'output_per_customer', [['extra_output', 1], ['one_customer', -1]]),
      product('scaled_output_rel', 'scaled_output', [['extra_output', 1], ['output_scale', 1]]),
      product('scaled_percent_rel', 'scaled_percent', [['extra_output', 1], ['one_percent', 1]]),
      { form: 'effect', id: 'index_rel', defines: 'productivity_index', base: 'productivity_indexed', terms: [{ driver: 'developers_hired', coefficient: 'index_per_developer', author: 'olumi', quote: null, ...at }], author: 'olumi', quote: null, ...at },
      { form: 'definition', id: 'growth_rel', defines: 'growth_factor', op: 'sum', parts: [{ id: 'one', sign: 1 }, { id: 'growth', sign: 1 }], author: 'olumi', quote: null, ...at });
    // S1 strip (B2 off): there is no structural admission. Every figure the AI labels structure is read exactly as written, a
    // stated 12, a 1 with a unit or a calendar conversion alike, and nothing is turned into their question.
    const n = new Map(normalise(m).quantities.map((x) => [x.id, x] as const));
    for (const id of ['current_output', 'current_utilisation', 'current_customers', 'output_per_developer', 'one_customer', 'one_percent', 'months_per_year', 'no_extra_output',
      'new_customers', 'output_scale', 'productivity_indexed', 'one']) expect(n.get(id), id).toEqual(m.quantities.find((x) => x.id === id));
    const c = compile(m, { sourceText: saved.brief });
    expect(c.errors).toEqual([]);
    expect(c.blockers.filter((b) => b.code === 'asked').map((b) => b.id)).not.toEqual(expect.arrayContaining(['current_output']));
    // A figure labelled structure where their words write it stays the AI's structure, its words kept.
    const cap = bakery();
    cap.quantities.push(q('weekly_bake', 'loaf/week', { author: 'structure', value: 300, quote: 'We bake 300 loaves a week' }));
    expect(normalise(cap).quantities.find((x) => x.id === 'weekly_bake')).toMatchObject({ author: 'structure', status: 'known', value: 300, quote: 'We bake 300 loaves a week' });
  });

  it('S4 class 7 (one reason): with no aim in the chance, the result says what it waits on from the typed blockers (an aim\'s measure, or the result they want), never "checks the limits only"', () => {
    const why = (m: CanonicalModelT) => {
      const e = evaluateCanonical(m, { sourceText: BRIEF, seed: 7 });
      return [e.compiled.executable === null ? 'waiting' : 'run', ...new Set(((e.view as Json).options as Json[]).map((o) => `${o.cell.face} | ${o.cell.why}`))];
    };
    // The aim has no measure; the limit can be checked (its oven price is theirs): a run of the limits alone.
    const aimNoMeasure = bakery();
    aimNoMeasure.goals = aimNoMeasure.goals.map((g) => ({ ...g, measure: null, question: 'How would you know the bakery is doing well enough?' }));
    aimNoMeasure.quantities = aimNoMeasure.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known', value: 2500, question: null, quote: 'We have £3,000 to spend' } : x));
    // What the run DID check is its own result, said apart from the reason (Codex r1 #3719): each limit on its own.
    expect(why(aimNoMeasure)).toEqual(['run', 'Not shown yet: needs your answer | The chance waits on a measure for ‘Reach 380 loaves a week’. This run checks only the limits, each on its own: ‘spend’ within its limit: 100%.']);
    // The same with no limit: nothing calculates, and the waiting view says the same, from the same blockers.
    const noLimit = JSON.parse(JSON.stringify(aimNoMeasure)) as CanonicalModelT; noLimit.limits = [];
    expect(why(noLimit)).toEqual(['waiting', 'Not shown yet: needs your answer | The chance waits on a measure for ‘Reach 380 loaves a week’.']);
    // No aim at all: the result they want.
    const noAim = JSON.parse(JSON.stringify(aimNoMeasure)) as CanonicalModelT; noAim.goals = [];
    expect(why(noAim)).toEqual(['run', 'Not shown yet: needs your answer | The chance waits on the result you want. This run checks only the limits, each on its own: ‘spend’ within its limit: 100%.']);
    for (const m of [aimNoMeasure, noLimit, noAim]) expect(JSON.stringify(evaluateCanonical(m, { sourceText: BRIEF, seed: 7 }).view)).not.toMatch(/limits only|No aim has a measure/);
    // Codex r2 #3719: an option that moves the bound (the budget to £2,000 with a second oven) is said by what each limit
    // measures and its result only, never a bound figure, so the base model's £3,000 cannot be said for it.
    const moved = JSON.parse(JSON.stringify(noAim)) as CanonicalModelT;
    moved.quantities.push(q('reduced_budget', 'GBP', { value: 2000, quote: 'our budget is £2,000' }));
    moved.options[0]!.sets.push({ ...moved.options[0]!.sets[0]!, quantity: 'budget', to: 'reduced_budget', quote: 'With a second oven our budget is £2,000' });
    const e = evaluateCanonical(moved, { sourceText: `${BRIEF} The second oven costs £2,500. With a second oven our budget is £2,000.`, seed: 7 });
    expect(e.compiled.errors).toEqual([]);
    expect(e.sim!.options.find((o) => o.option_id === 'second_oven')!.per_limit[0]).toMatchObject({ chance: 0 });
    const cellOf = (id: string) => ((e.view as Json).options as Json[]).find((o) => o.option_id === id)!.cell;
    expect(cellOf('second_oven').why).toBe('The chance waits on the result you want. This run checks only the limits, each on its own: ‘spend’ within its limit: 0%.');
    expect(cellOf('keep_one').why).toBe('The chance waits on the result you want. This run checks only the limits, each on its own: ‘spend’ within its limit: 100%.');
    for (const id of ['second_oven', 'keep_one']) expect(cellOf(id).why).not.toMatch(/£3,000|£2,000/);
    // Contrast: a measured aim waiting on a figure only they can give names that figure, as before.
    expect(why(bakery())[1]).not.toContain('measure for');
    // With nothing to run (the aim's target is asked), the waiting view's note for that aim is the blockers' words too, never
    // the compiler's joined reasons ("is not in the chance yet: needs …"); the waiting view has no run, so no limit line.
    const asked = bakery();
    setQ(asked, 'sales_target', { status: 'asked', value: null, quote: null, question: 'What is the target?' });
    const waitingView = evaluateCanonical(asked, { sourceText: BRIEF, seed: 7 });
    expect(waitingView.compiled.executable).toBeNull();
    expect(((waitingView.view as Json).goal_chance as Json).notes[0]).toBe('‘Reach 380 loaves a week’ waits on ‘sales target’.');
    expect(why(asked)).toEqual(['waiting', 'Not shown yet: needs your answer | The chance waits on ‘sales target’.']);
  });

  it('batch 4 hiring-r1: a measured aim whose options wait on their own figures says what it waits on, never "No aim has a measure yet"', () => {
    const m = bakery();
    // The aim is measured and calculable; the one option waits on its own setting (how many ovens it adds), as hiring-r1's
    // options waited on their start times.
    m.options = m.options.filter((o) => o.id === 'second_oven');
    m.quantities = m.quantities.map((x) => (x.id === 'one_oven' ? { ...x, status: 'asked', value: null, quote: null, question: 'How many ovens would you add?' } : x));
    const e = evaluateCanonical(m, { sourceText: BRIEF, seed: 7 });
    expect(e.compiled.perGoal[0]).toMatchObject({ status: 'calculable', needs_measure: false });
    expect(e.compiled.executable).toBeNull();
    const cell = (id: string) => ((e.view as Json).options as Json[]).find((o) => o.option_id === id)!.cell;
    expect(cell('second_oven').why).toBe('The chance waits on ‘one oven’.');
    expect(cell('second_oven').face).toBe('Not shown yet: needs your answer');
    expect(cell('second_oven').why).not.toContain('No aim has a measure yet');
  });

  it('DoD-G marketing r2/r5: a run with no aim says no "chance of …" sentence (it said "chance of , while …"); what it did check is still said', () => {
    const m = bakery();
    setQ(m, 'oven_price', { status: 'known', value: 2500, question: null, quote: 'The second oven costs £2,500' });
    m.goals = [];
    const src = `${BRIEF} The second oven costs £2,500.`;
    const e = evaluateCanonical(m, { sourceText: src, seed: 7 });
    expect(e.compiled.executable).not.toBeNull();
    const gc = (e.view as Json).goal_chance as Json;
    expect(gc.chance_words).toBeUndefined();
    expect(JSON.stringify(e.view)).not.toContain('chance of ,');
    // The limit on its own, and each option's cell saying what the chance waits on, as before.
    expect(gc.limits).toEqual([{ constraint_id: 'within_budget', words: '‘spend’ is at most £3,000',
      options: [{ option_id: 'second_oven', display: '100%' }, { option_id: 'keep_one', display: '100%' }] }]);
    expect(((e.view as Json).options as Json[]).map((o) => o.cell.why))
      .toEqual(Array(2).fill('The chance waits on the result you want. This run checks only the limits, each on its own: ‘spend’ within its limit: 100%.'));
    // Contrast: with its aim, the same model says the chance in full.
    m.goals = bakery().goals;
    expect(((evaluateCanonical(m, { sourceText: src, seed: 7 }).view as Json).goal_chance as Json).chance_words)
      .toBe('chance of ‘sales’ being at least 380 loaves per week, while ‘spend’ is at most £3,000');
  });

  it('DoD-G hiring: a change from today on a quantity already named "… relative to today" never says "today today", and says its assumed relationship once', () => {
    const rel = (label: string) => {
      const m = bakery();
      setQ(m, 'sales', { label });
      m.quantities.push(q('growth', '%', { value: 10, quote: 'grow sales by 10%' }));
      m.goals = [{ ...m.goals[0]!, measure: { ...m.goals[0]!.measure!, target: 'growth', frame: 'change_rel', reference: { kind: 'now', option: null, quantity: null } } }];
      const e = evaluateCanonical(m, { sourceText: `${BRIEF} We want to grow sales by 10%.`, seed: 7 });
      return { e, face: ((e.view as Json).options as Json[]).find((o) => o.option_id === 'second_oven')!.cell.face as string };
    };
    const today = rel('sales relative to today');
    expect(today.e.compiled.executable!.quantities.find((x) => x.id === 'sales__today')!.label).toBe('sales relative to today');
    expect(today.face).toBe('‘A second oven’: more than 99% chance of ‘Relative change in sales relative to today’ being at least 10%, in this model. '
      // G9 (#3738): a first draft is Olumi's reading until the person confirms it, and its basis says so.
      + 'It rests on Olumi’s reading of your figures (not yet confirmed). It assumes ‘sell through’ follows Olumi’s provisional reading of Olumi’s own estimated range, 0.5 to 0.9, as the range it falls in 8 times '
      + 'out of 10, with 0.7 as the middle value. It also assumes ‘sales relative to today’ follows Olumi’s assumed relationship. '
      + 'Not yet checked: ‘Within the £3,000’ — needs "oven price".');
    expect(JSON.stringify(today.e.view)).not.toContain('today today');
    // Contrast: a quantity not already said "today" keeps its shadow's "today", listed as before.
    const plain = rel('sales');
    expect(plain.e.compiled.executable!.quantities.find((x) => x.id === 'sales__today')!.label).toBe('sales today');
    expect(plain.face).toContain('. It also assumes ‘sales’ follows Olumi’s assumed relationship. It also assumes ‘sales today’ follows Olumi’s assumed relationship.');
  });

  it('a bound an option moves is never said as the base figure (Codex r2 #3719 case on the figure cell): a second oven takes the budget from £3,000 to £2,000; every chance line names the budget instead', () => {
    const m = bakery();
    setQ(m, 'oven_price', { status: 'known', value: 2500, question: null, quote: 'The second oven costs £2,500' });
    m.quantities.push(q('reduced_budget', 'GBP', { value: 2000, quote: 'our budget is £2,000' }));
    m.options[0]!.sets.push({ ...m.options[0]!.sets[0]!, quantity: 'budget', to: 'reduced_budget', quote: 'With a second oven our budget is £2,000' });
    const e = evaluateCanonical(m, { sourceText: `${BRIEF} The second oven costs £2,500. With a second oven our budget is £2,000.`, seed: 7 });
    expect(e.compiled.errors).toEqual([]);
    // The run is right: spending £2,500 misses the second oven's £2,000 and keeps within keeping one oven's £3,000.
    expect(e.sim!.options.map((o) => [o.option_id, o.per_limit[0]])).toMatchObject([['second_oven', { chance: 0 }], ['keep_one', { chance: 1 }]]);
    const view = e.view as Json;
    const face = (id: string) => (view.options as Json[]).find((o) => o.option_id === id)!.cell.face as string;
    // Every line that states the bound: each option's chance and its limit on its own, and the shared chance words.
    for (const words of [face('second_oven'), face('keep_one'), view.goal_chance.chance_words, view.goal_chance.limits[0].words]) {
      expect(words, words).not.toMatch(/£3,000|£2,000/);
      expect(words, words).toContain('‘spend’ is at most ‘budget’');
    }
    expect(face('second_oven')).toMatch(/Each limit on its own: ‘spend’ is at most ‘budget’[^:;]*: 0%\./);
    // The exact line too: with the sell-through theirs and fixed, the second oven misses both in every draw, and its why names
    // the budget it misses, never the base £3,000.
    const exact = JSON.parse(JSON.stringify(m)) as CanonicalModelT;
    setQ(exact, 'sell_through', { author: 'person', status: 'known', kind: 'fact', low: null, high: null, range_kind: null, basis: null, quote: 'seven in ten sell' });
    const x = evaluateCanonical(exact, { sourceText: `${BRIEF} The second oven costs £2,500. With a second oven our budget is £2,000. Seven in ten sell.`, seed: 7 }).view as Json;
    const exactFace = (x.options as Json[]).find((o) => o.option_id === 'second_oven')!.cell.face as string;
    expect(exactFace).toContain('Whatever the uncertain figures turn out to be, ');
    expect(exactFace).toContain('‘spend’ is £2,500, above ‘budget’');
    expect(exactFace).not.toMatch(/£3,000|£2,000/);
    // Contrast: with no option moving it, the budget is said as its figure, as before.
    const fixed = bakery();
    setQ(fixed, 'oven_price', { status: 'known', value: 2500, question: null, quote: 'The second oven costs £2,500' });
    const f = evaluateCanonical(fixed, { sourceText: `${BRIEF} The second oven costs £2,500.`, seed: 7 }).view as Json;
    expect(f.goal_chance.chance_words).toContain('‘spend’ is at most £3,000');

    // The card says it the same way (Codex r1 #3722): the reading card and a change list name a moved bound or target; its
    // figure stays on its own item and in the option's own setting. Unmoved, the card keeps the figure.
    const said = (v: ReturnType<typeof readingOf>, id: string) => (v.ok ? v.changes.find((c) => c.id === id)?.after ?? '' : JSON.stringify(v));
    const changeOf = (base: CanonicalModelT, edit: (d: CanonicalModelT) => void, w: string[]) => {
      const d = JSON.parse(JSON.stringify(base)) as CanonicalModelT; edit(d);
      const v = validatePostimage(base, d, { removals: [], words: w, fresh: w });
      return v.ok ? v.changes.map((c) => [c.id, c.before, c.after]) : v;
    };
    const budgetWords = [`${BRIEF} The second oven costs £2,500. With a second oven our budget is £2,000.`];
    const read = readingOf(m, { words: budgetWords, approver: null });
    expect(said(read, 'within_budget')).toContain('"spend" at most "budget",');
    expect(said(read, 'within_budget')).not.toMatch(/"budget" [0-9]|GBP/); // their own words ("We have £3,000 to spend") stay
    expect(said(read, 'budget')).toContain('£3,000');
    expect(said(read, 'second_oven')).toContain('sets "budget" to "reduced budget" £2,000');
    expect(changeOf(m, (d) => { d.limits[0]!.measure!.cmp = '<'; }, budgetWords)).toEqual([['within_budget', '"spend" at most "budget"', '"spend" less than "budget"']]);
    expect(said(readingOf(fixed, { words: [`${BRIEF} The second oven costs £2,500.`], approver: null }), 'within_budget')).toContain('"spend" at most "budget" £3,000');
    // A goal's target an option moves (keeping one oven aims for 350, not 380): the results and the card name it.
    const target = bakery();
    setQ(target, 'oven_price', { status: 'known', value: 2500, question: null, quote: 'The second oven costs £2,500' });
    target.quantities.push(q('lower_target', 'loaf/week', { value: 350, quote: 'With one oven we aim for 350' }));
    target.options[1]!.sets.push({ ...target.options[0]!.sets[0]!, quantity: 'sales_target', to: 'lower_target', quote: 'With one oven we aim for 350' });
    const targetWords = [`${BRIEF} The second oven costs £2,500. With one oven we aim for 350.`];
    const t = evaluateCanonical(target, { sourceText: targetWords[0], seed: 7 });
    expect(t.compiled.errors).toEqual([]);
    for (const o of (t.view as Json).options as Json[]) {
      expect(o.cell.face, o.cell.face).toContain('‘sales’ being at least ‘sales target’');
      expect(o.cell.face, o.cell.face).not.toMatch(/380 loaf|350 loaf/);
    }
    const targetRead = readingOf(target, { words: targetWords, approver: null });
    expect(said(targetRead, 'more_loaves')).toContain('"sales" at least "sales target",');
    expect(said(targetRead, 'more_loaves')).not.toContain('"sales target" 380');
    expect(said(targetRead, 'sales_target')).toContain('380 loaves per week');
    expect(changeOf(target, (d) => { d.goals[0]!.measure!.cmp = '>'; }, targetWords)).toEqual([['more_loaves', '"sales" at least "sales target"', '"sales" more than "sales target"']]);
  });

  it('DL 23 Oct (units on cards): every card that can hold a figure carries its quantity\'s own unit, a question\'s too; a worked-out card none', () => {
    const saved = savedDraft('./hiring-alpha3.saved.json');
    const node = (g: { nodes: Json[] }, id: string) => g.nodes.find((n) => n.id === id) as Json;
    const hiring = project(saved.canonical, compile(saved.canonical, { sourceText: saved.brief })).graph;
    expect(node(hiring, 'developer_hiring_cost').observed_state).toEqual({ unit: 'GBP/developer' });
    expect(node(hiring, 'current_developers').observed_state).toMatchObject({ value: 6, unit: 'developer' });
    expect(node(hiring, 'total_hiring_spend').observed_state).toBeUndefined();
    const share = bakery();
    share.quantities.push(q('online_share', '%', { status: 'asked', question: 'What share of your sales is online?' }), q('wholesale_share', '%', { value: 40, quote: 'We bake 300 loaves a week' }));
    const g = project(share, compile(share, { sourceText: BRIEF })).graph;
    expect(node(g, 'online_share').observed_state).toEqual({ unit: '%' });
    expect(node(g, 'wholesale_share').observed_state).toMatchObject({ value: 40, unit: '%' });
  });

  it('S1 (Codex r1 #3716): a Run stored before blockers, reused while current, still has its waits read from the model, never a pile', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    const run = persisted!.living_model.runs[0].result.compile as Json;
    delete run.blockers; run.asks = [{ quantity_id: 'oven_price', question: 'What would the second oven cost?' }]; run.coaching = [];
    const r = await hostTurn('Run the analysis', savedNow());
    expect(r.assistant_text).toContain('1. What would the second oven cost?');
    expect(r.assistant_text).not.toContain('To work out what is still missing');
  });

  it('a Run press on a program needs no drafter call (its one call is the AI\'s reply, T1): the stored Run when current; a NEW Run, stored, when the model moved since', async () => {
    replies = [JSON.stringify(bakery())];
    await turn({ message: BRIEF });
    sent.length = 0;
    const saves = registered.length;
    const press = () => turn({ message: 'Run the analysis', chip: { id: 'run', action_type: 'run_analysis', label: 'Run' } });
    const r = await press();
    expect(r.statusCode, r.body).toBe(200);
    expect([drafterCalls().length, sent.length, registered.length]).toEqual([0, 1, saves]);
    expect(r.json().model_program).toMatchObject({ turn: 'run', stored: true });
    expect(r.json().canonical_analysis_view.run.run_id).toBe(persisted!.living_model.runs[0].run_id);
    // The model moved (a word of the person's added) with no Run: the press evaluates a NEW Run and stores it.
    persisted = JSON.parse(JSON.stringify(persisted));
    persisted!.living_model.person_words.push('We open six days a week.');
    const moved = await press();
    expect(moved.statusCode, moved.body).toBe(200);
    expect([drafterCalls().length, registered.length, persisted!.living_model.runs.length]).toEqual([0, saves + 1, 2]);
    expect(moved.json().canonical_analysis_view.run.run_id).toBe(persisted!.living_model.runs[1].run_id);
  });

  it('words#11: a Run refused for its size says so once, in the view\'s own words: the first draft says it, and a Run press never says it is an analysis; once the model computes, the press opens with the analysis', async () => {
    const why = 'This model is too large to work out in one run: 5000 months ahead for 2 options. Counting in longer periods, looking less far ahead or comparing fewer options reduces the work.';
    const m = club();
    m.quantities = m.quantities.map((x) => (x.id === 'months' ? q('months', 'month', { value: 5000, quote: '5000 months ahead' }) : x));
    replies = [JSON.stringify(m)];
    const draft = await hostTurn(`${CLUB_BRIEF} We look 5000 months ahead.`);
    expect(draft.canonical_analysis_view.options.map((o: Json) => o.cell.reasons)).toEqual([[{ code: 'too_large', message: why }], [{ code: 'too_large', message: why }]]);
    const said = draft.assistant_text.split('\n\n') as string[];
    expect(said[0]).toBe('I\'ve drafted a first model of: Should the club run a promotion?');
    expect(said.filter((p) => p === why)).toHaveLength(1);
    const press = () => hostTurn('Run the analysis', savedNow());
    const r = await press();
    expect(r.model_program).toMatchObject({ turn: 'run', stored: true });
    expect(r.assistant_text).toBe(why);
    // Contrast: the model moved to three months ahead, so the press works out a NEW Run, which opens with the analysis.
    persisted = JSON.parse(JSON.stringify(persisted));
    persisted!.living_model.canonical.quantities = persisted!.living_model.canonical.quantities.map((x: Json) => (x.id === 'months' ? { ...x, value: 3, quote: 'within three months' } : x));
    const moved = await press();
    expect(moved.canonical_analysis_view.options.map((o: Json) => o.cell.kind)).toEqual(['figure', 'figure']);
    expect(moved.assistant_text.split('\n\n')[0]).toBe('Here is the analysis of the model as it stands.');
    expect(moved.assistant_text).not.toContain('too large');
  });

  // Strip (Paul 26 Oct; M4 removed): the reply has no cap on the AI's own questions; it lists every one, in the model's order.
  it('S1 one question channel (A4), M4 removed: the first reply prints EVERY one of the AI\'s OWN questions, in the model\'s order, then counts the blockers with none; the result lists every blocker by label with its answer box', async () => {
    const m = bakery();
    m.goals.push({ id: 'regulars', label: 'Keep the regulars happy', measure: null, question: 'How would you tell the regulars are happy?', author: 'person', quote: 'want to reach 380 loaves a week', ...at },
      { id: 'staff_happy', label: 'Keep the staff happy', measure: null, question: 'How would you tell the staff are happy?', author: 'person', quote: 'want to reach 380 loaves a week', ...at });
    m.limits.push({ id: 'friendly', label: 'Keep it friendly', measure: null, question: 'How would you tell it stays friendly?', author: 'person', quote: 'We have £3,000 to spend', ...at });
    // AIE §5 AMEND (DL 24 Oct): a first draft's every ask carries the AI's question (an ask with none is refused at compile).
    setQ(m, 'base_sales', { status: 'asked', value: null, quote: null, question: 'How many loaves do you sell a week now?' });
    setQ(m, 'extra_per_oven', { value: null, low: 80, high: 120 }); // their range, its kind unread: a blocker with no question
    replies = [JSON.stringify(m)];
    const r = await hostTurn(BRIEF);
    expect(r.model_program.saved).toBe(true);
    // Every one of the AI's questions, in the model's order (goals, limits, then quantities); the range_kind blocker has none, so
    // it is counted. Alpha G13's count line: 13 records theirs in their words (the asked base sales is in none), Olumi's sell-through estimate.
    expect(r.assistant_text).toBe(['I\'ve drafted a first model of: Should the bakery buy a second oven?',
      'I used 13 things from your brief and added 1 of my own for you to check.',
      '1. How would you tell the regulars are happy?\n2. How would you tell the staff are happy?\n3. How would you tell it stays friendly?\n4. How many loaves do you sell a week now?\n5. What would the second oven cost?',
      'The chance also waits on 1 other thing, listed with the result.'].join('\n\n'));
    // The result lists every one of them, by label, with the figure its answer box fills; no question of the code's anywhere.
    const waits = r.canonical_analysis_view.goal_chance.waits_on as Json[];
    expect(waits).toEqual([
      { id: 'regulars', code: 'measure', label: 'Keep the regulars happy', scope: ['regulars'], answer: null },
      { id: 'staff_happy', code: 'measure', label: 'Keep the staff happy', scope: ['staff_happy'], answer: null },
      { id: 'friendly', code: 'measure', label: 'Keep it friendly', scope: ['friendly'], answer: null },
      { id: 'base_sales', code: 'asked', label: 'base sales', scope: ['more_loaves'], answer: { quantity_id: 'base_sales' } },
      { id: 'extra_per_oven', code: 'range_kind', label: 'extra per oven', scope: ['more_loaves'], answer: { quantity_id: 'extra_per_oven' } },
      { id: 'oven_price', code: 'asked', label: 'oven price', scope: ['within_budget'], answer: { quantity_id: 'oven_price' } },
    ]);
    expect(waits.every((w) => typeof w.label === 'string' && w.label.trim() !== '')).toBe(true);
    const view = JSON.stringify(r.canonical_analysis_view);
    expect(view).not.toContain('?');
    expect(JSON.stringify((persisted!.living_model.runs.at(-1).result as Json).compile)).not.toContain('?');
    // The AI's own question for the fifth is on its record, so the probe sees questions where they are.
    expect(JSON.stringify(persisted!.living_model.canonical)).toContain('What would the second oven cost?');
  });

  it('S1 follow-up (served funding dead end): every figure the chance rests on with none in hand is listed; an unknown is no one\'s to answer (no box, its own basis), an asked one keeps its box; an unknown nothing rests on is not listed', async () => {
    const m = bakery();
    // What they expect anyway (their fact) and the option's added effect (a link), both unknown with no figure and no question.
    const none = { value: null, low: null, high: null, range_kind: null, question: null };
    setQ(m, 'base_sales', { ...none, status: 'unknown', quote: null, basis: 'Not given yet.' });
    setQ(m, 'sell_through', { ...none, status: 'unknown', basis: 'Cannot yet be sized.' });
    m.quantities.push(q('weather', '1', { status: 'unknown', author: 'olumi', basis: 'Nothing here uses it.' })); // contrast: nothing rests on it
    replies = [JSON.stringify(m)];
    const r = await hostTurn(BRIEF);
    expect(r.model_program.saved).toBe(true);
    const waits = r.canonical_analysis_view.goal_chance.waits_on as Json[];
    expect(waits).toEqual([
      { id: 'base_sales', code: 'unknown', label: 'base sales', scope: ['more_loaves'], answer: null, basis: 'Not given yet.' },
      { id: 'sell_through', code: 'unknown', label: 'sell through', scope: ['more_loaves'], answer: null, basis: 'Cannot yet be sized.' },
      { id: 'oven_price', code: 'asked', label: 'oven price', scope: ['within_budget'], answer: { quantity_id: 'oven_price' } },
    ]);
    // The goal waits only on what no one can size yet: never the needs-your-answer face; the why is their own basis, said once.
    for (const o of r.canonical_analysis_view.options as Json[]) {
      expect(o.cell.face, o.option_id).toBe('Chance not shown yet');
      expect(o.cell.why, o.option_id).toContain('‘base sales’, which no one can size yet (Not given yet) and ‘sell through’, which no one can size yet (Cannot yet be sized)');
    }
    // The AI sees the same list, typed, on its read context; the stored Run keeps it.
    expect(r.model_program.blockers).toEqual(waits.map((w) => ({ id: w.id, code: w.code, scope: w.scope })));
    expect((persisted!.living_model.runs.at(-1).result as Json).compile.blockers).toEqual(r.model_program.blockers);
    // The two unknowns have no question of the AI's, so the first reply counts them; the code writes none.
    expect(r.assistant_text).toContain('1. What would the second oven cost?');
    expect(r.assistant_text).toContain('The chance also waits on 2 other things, listed with the result.');
  });

  it('S1 follow-up: when the run computes, a chance held up only by an unknown is not "needs your answer" either (the run\'s own cells)', async () => {
    const none = { value: null, low: null, high: null, range_kind: null, question: null };
    // (a) The guardrail is calculable, the one goal waits on an unknown link: the run has no goal of its own (no-aim cell).
    const a = bakery();
    setQ(a, 'oven_price', { status: 'known', value: 2000, quote: 'The oven would cost £2,000', question: null });
    setQ(a, 'sell_through', { ...none, status: 'unknown', basis: 'Cannot yet be sized.' });
    replies = [JSON.stringify(a)];
    const ra = (await turn({ message: `${BRIEF} The oven would cost £2,000.` })).json();
    expect(ra.model_program.saved).toBe(true);
    expect(ra.canonical_analysis_view.goal_chance.waits_on).toEqual([{ id: 'sell_through', code: 'unknown', label: 'sell through', scope: ['more_loaves'], answer: null, basis: 'Cannot yet be sized.' }]);
    for (const o of ra.canonical_analysis_view.options as Json[]) expect([o.option_id, o.cell.face]).toEqual([o.option_id, 'Chance not shown yet']);
  });

  it('S1 follow-up: one goal computes while another waits on an unknown: the withheld cell is not "needs your answer"', async () => {
    const b = bakery();
    setQ(b, 'oven_price', { status: 'known', value: 2000, quote: 'The oven would cost £2,000', question: null });
    b.quantities.push(q('regulars', 'person', { status: 'unknown', author: 'olumi', basis: 'Not counted yet.' }), q('regulars_target', 'person', { value: 50, quote: 'want to reach 380 loaves a week' }));
    b.goals.push({ id: 'keep_regulars', label: 'Keep 50 regulars', measure: { quantity: 'regulars', per: null, cmp: '>=', target: 'regulars_target', frame: 'level', reference: null, aggregation: 'end',
      window: null, measure_by: 'person', assumptions: [], exclusions: [] }, question: null, author: 'person', quote: 'want to reach 380 loaves a week', ...at });
    replies = [JSON.stringify(b)];
    const rb = (await turn({ message: `${BRIEF} The oven would cost £2,000.` })).json();
    expect(rb.model_program.saved).toBe(true);
    expect(rb.canonical_analysis_view.goal_chance.waits_on).toEqual([{ id: 'regulars', code: 'unknown', label: 'regulars', scope: ['keep_regulars'], answer: null, basis: 'Not counted yet.' }]);
    for (const o of rb.canonical_analysis_view.options as Json[]) expect([o.option_id, o.cell.face]).toEqual([o.option_id, 'Chance not shown yet']);
  });

  it('S1 follow-up contrast: a goal waiting on an asked figure of theirs keeps the needs-your-answer face and its answer box', async () => {
    const m = bakery();
    setQ(m, 'base_sales', { value: null, low: null, high: null, range_kind: null, status: 'asked', quote: null, question: 'How many loaves do you bake a week now?' });
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect((r.canonical_analysis_view.goal_chance.waits_on as Json[])[0]).toEqual({ id: 'base_sales', code: 'asked', label: 'base sales', scope: ['more_loaves'], answer: { quantity_id: 'base_sales' } });
    for (const o of r.canonical_analysis_view.options as Json[]) expect(o.cell.face, o.option_id).toBe('Not shown yet: needs your answer');
  });

  it('S1 follow-up (Codex on #3723): a window\'s own unknown figure is listed too, though it withholds through the window, not the closure', async () => {
    const m = club();
    setQ(m, 'months', { value: null, low: null, high: null, range_kind: null, question: null, status: 'unknown', quote: null, basis: 'Not given yet.' });
    m.limits[0]!.measure!.window = { origin_event: null, origin_offset: null, start: 0, periods: 'months' }; // a guardrail's window too
    replies = [JSON.stringify(m)];
    const r = (await turn({ message: CLUB_BRIEF })).json();
    expect(r.model_program.saved).toBe(true);
    expect(r.canonical_analysis_view.goal_chance.waits_on).toEqual([
      { id: 'months', code: 'unknown', label: 'months', scope: ['reach_340', 'within_budget'], answer: null, basis: 'Not given yet.' },
    ]);
    expect(r.model_program.blockers).toEqual([{ id: 'months', code: 'unknown', scope: ['reach_340', 'within_budget'] }]);
  });

  // Strip (Paul 26 Oct; M6 removed): the orphaned lookup of a left-out note `aim` is retired (the drafting prompt now writes a
  // working aim instead); a no_goal blocker has no record's question, so it is counted, never worded by the code.
  it('S1 (A4), M6 removed: with no aim at all, a left-out note named `aim` is not read for the reply; the no-goal blocker is counted, and no code question', async () => {
    const m = bakery();
    m.goals = [];
    // Codex r1 #3716: another note on the situation as a whole, with a question, is never taken for it; only the declared `aim`.
    m.left_out.push({ id: 'supplier', text: 'The flour supplier is not in the model.', why: 'Not given.', question: 'Who is your supplier?', concerns: [], author: 'olumi', quote: null, ...at },
      { id: 'aim', text: 'What a good result would be is not stated.', why: 'No aim was given.', question: 'What result would make this worth it for you?',
        concerns: [], author: 'olumi', quote: null, ...at });
    replies = [JSON.stringify(m)];
    const r = await hostTurn(BRIEF);
    expect(r.model_program.saved).toBe(true);
    expect(r.assistant_text).toBe(['I\'ve drafted a first model of: Should the bakery buy a second oven?',
      'I used 10 things from your brief, added 1 of my own for you to check, and left 2 out of the calculation.',
      '1. What would the second oven cost?', 'The chance also waits on 1 other thing, listed with the result.'].join('\n\n'));
    expect(r.assistant_text).not.toContain('What result would make this worth it for you?');
    expect(r.model_program.blockers.map((b: Json) => [b.id, b.code])).toEqual([['(model)', 'no_goal'], ['oven_price', 'asked']]);
    expect(r.assistant_text).not.toContain('Who is your supplier?');
    // The same without the note: the no-goal blocker has no words of anyone's, so it is counted, never worded by the code.
    const bare = bakery(); bare.goals = [];
    beforeEachReset();
    replies = [JSON.stringify(bare)];
    const b = await hostTurn(BRIEF);
    expect(b.assistant_text).toBe(['I\'ve drafted a first model of: Should the bakery buy a second oven?',
      'I used 10 things from your brief and added 1 of my own for you to check.', '1. What would the second oven cost?',
      'The chance also waits on 1 other thing, listed with the result.'].join('\n\n'));
  });

  /**
   * ⭐ THE FIRST REPLY'S COUNT LINE SPEAKS FOR A CARD THAT IS HELD (spec §3 C2, C7; DL ui-w1 27 Oct). The line ("I used N things
   * from your brief …") is the reading card's summary. It was sent whenever the draft saved, while the card was held only on an
   * acknowledged save: a reading `readingOf` refuses held no card under a line pointing at one, and a recovered draft (writes#4's
   * `already_saved`, its own receipt, held to its read) never got its card. Both now follow ONE decision: the card is held, or
   * the reply says no count.
   */
  describe('the first reply\'s count line and its reading card are one decision', () => {
    const COUNT_LINE = 'I used 11 things from your brief and added 1 of my own for you to check.';
    const countLines = (text: string) => text.split('\n\n').filter((p) => /^I (used|added|left) /.test(p));

    it('a reading readingOf refuses holds no card, and the reply has no count line', async () => {
      const m = bakery();
      // A note the card cannot name (no words): readingOf refuses it (S1 strip: the quote check that used to refuse here is off).
      m.claims.push({ id: 'blank_note', text: '', concerns: [], author: 'olumi', quote: null, party: null, approval: 'proposed', approved_by: null, author_id: null });
      replies = [JSON.stringify(m)];
      const proposals = new ProposalStore();
      const out = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch, proposals });
      expect(out.payload.model_program).toMatchObject({ turn: 'draft', saved: true, write: 'saved' });
      expect(out.toolCalls[1]).toEqual({ name: 'confirm_reading', ok: false, outcome: 'refused', refusal: 'invalid_change_entry', mutated: false });
      expect(countLines(out.assistantText)).toEqual([]);
      expect(out.assistantText.split('\n\n')[0]).toBe('I\'ve drafted a first model of: Should the bakery buy a second oven?');
    });

    it('a recovered draft (already_saved) holds no card (accepted known issue, DL 26 Oct), so the reply has no count line', async () => {
      const landsThenThrows: typeof dispatch = async (path, body) => {
        if (path.endsWith('/graph/register')) { await dispatch(path, body); throw new Error('socket hang up'); }
        if (path.endsWith('/versions')) {
          return { status: 200, json: { versions: [{ version_id: 'v_1', sequence: 1, creation: { kind: 'initial', mutation_id: 'm_1', source_turn_id: registrationTurnId(SCENARIO, registered[0]!.operation_id) } }] } };
        }
        return dispatch(path, body);
      };
      replies = [JSON.stringify(bakery())];
      const proposals = new ProposalStore();
      const out = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch: landsThenThrows, proposals });
      expect(out.payload.model_program).toMatchObject({ turn: 'draft', saved: true, write: 'already_saved' });
      expect(out.toolCalls.some((c) => c.name === 'confirm_reading')).toBe(false);
      expect(countLines(out.assistantText)).toEqual([]);
      expect(registered).toHaveLength(1);
    });

    it('CONTRAST: an acknowledged first draft holds its card and says the same count line, as before', async () => {
      replies = [JSON.stringify(bakery())];
      const proposals = new ProposalStore();
      const out = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch, proposals });
      expect(out.payload.model_program).toMatchObject({ turn: 'draft', saved: true, write: 'saved' });
      expect(out.toolCalls[1]).toMatchObject({ name: 'confirm_reading', ok: true, outcome: 'ok' });
      const card = proposals.get(out.toolCalls[1]!.proposal_id!)!;
      expect([card.base_graph_identity_hash, card.base_model_identity]).toEqual([hashOf(persisted), computeGraphIdentityHash(persisted as never)!.value]);
      expect(countLines(out.assistantText)).toEqual([COUNT_LINE]);
    });

    it('S1 strip, the real path: drafted model → save → reopen → press → apply, every one of the AI\'s own labels passing through unchanged', async () => {
      // What the stripped rules used to rewrite or refuse: a structure figure no one stated (B2), a person's figure in words not
      // in the brief (A2, A25), Olumi's point figure (B8) and a direction beside a sized link (B3).
      const m = bakery();
      m.quantities.push(q('current_output', 'loaf/week', { author: 'structure', value: 12, basis: 'Synthetic.' }));
      setQ(m, 'base_sales', { quote: 'We bake roughly 300 loaves' });
      setQ(m, 'sell_through', { low: null, high: null, range_kind: null, direction: 'raises' });
      replies = [JSON.stringify(m)];
      const proposals = new ProposalStore();
      const out = await runModelProgramTurn({ scenarioId: SCENARIO, turnId: randomUUID(), message: BRIEF, saved: { graph: null, identity: null }, dispatch, proposals });
      expect(out.payload.model_program).toMatchObject({ turn: 'draft', saved: true, write: 'saved' });
      const labels = (c: CanonicalModelT) => ['current_output', 'base_sales', 'sell_through'].map((id) => {
        const x = c.quantities.find((y) => y.id === id)!;
        return [id, x.author, x.status, x.value, x.low, x.high, x.quote, x.direction];
      });
      const drafted = labels(m);
      expect(labels(persisted!.living_model.canonical as CanonicalModelT)).toEqual(drafted);
      // Reopen: the saved program reads back as written.
      const reopened = programReadOf(persisted!);
      expect(reopened.kind).toBe('program');
      expect(labels((reopened as { program: { canonical: CanonicalModelT } }).program.canonical)).toEqual(drafted);
      // Press: the reading card shows them as written, and approving it applies exactly that card.
      expect(out.toolCalls[1]).toMatchObject({ name: 'confirm_reading', ok: true, outcome: 'ok' });
      const card = proposals.get(out.toolCalls[1]!.proposal_id!)!;
      expect(card.changes!.find((c) => c.id === 'base_sales')).toMatchObject({ author: 'person' });
      expect(card.changes!.find((c) => c.id === 'base_sales')!.after).toContain('in your words "We bake roughly 300 loaves"');
      expect(card.changes!.find((c) => c.id === 'sell_through')!.after).toContain('↑ raises');
      expect(await applyProgramChange({ dispatch, proposals }, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID() }, out.toolCalls[1]!.proposal_id!))
        .toMatchObject({ status: 'ok', data: { saved: true } });
      const applied = persisted!.living_model.canonical as CanonicalModelT;
      expect(labels(applied)).toEqual(drafted);
      expect(applied.quantities.find((x) => x.id === 'current_output')!.approval).toBe('approved');
    });
  });
});

// ── #3789 review (probes A–E2, kept at reviews/CLAUDE-3789-8edef114-probes): every reason the display reads is on one line ─
describe('display words stay on one line: the compiler\'s reasons quote labels and bases as written (#3789 review probes A–E2)', () => {
  /** DGAI `sayable` (canonicalAnalysisView.ts:83) refuses the whole goal_chance block on a line break: every display string, listed. */
  const broken = (v: Json): string[] => [...(v.goal_chance?.notes ?? []), v.goal_chance?.chance_words, ...(v.goal_chance?.unchecked_limits ?? []).map((u: Json) => u.words),
    ...(v.options ?? []).flatMap((o: Json) => [o.cell.face, o.cell.why]), v.leader?.words].filter((t): t is string => typeof t === 'string' && /[\r\n]/.test(t));
  const known = (m: CanonicalModelT) => { m.quantities = m.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known', value: 2500, question: null, quote: 'The oven costs £2,500' } : x)); return m; };
  const PRICED_BRIEF = `${BRIEF} The oven costs £2,500.`;

  it('A: an asked figure with a wrapped label behind a limit: its unchecked line, every cell and the notes say it on one line', () => {
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'oven_price' ? { ...x, label: 'Oven\n price' } : x));
    const v = evaluateCanonical(m, { sourceText: BRIEF, seed: 7 }).view as Json;
    expect(v.goal_chance.unchecked_limits).toEqual([{ limit_id: 'within_budget', words: '‘Within the £3,000’ — needs "Oven price".' }]);
    expect(v.goal_chance.notes).toContain('Not yet checked: ‘Within the £3,000’ — needs "Oven price".');
    for (const o of v.options as Json[]) expect(o.cell.face.endsWith(' Not yet checked: ‘Within the £3,000’ — needs "Oven price".'), o.option_id).toBe(true);
    expect(broken(v)).toEqual([]);
  });

  it('B: a ruled-out option with a wrapped label: its note says it on one line', () => {
    const m = known(bakery());
    m.options = m.options.map((o) => (o.id === 'keep_one' ? { ...o, label: 'Keep our\n one oven', status: 'ruled_out' } : o));
    const v = evaluateCanonical(m, { sourceText: PRICED_BRIEF, seed: 7 }).view as Json;
    expect(v.goal_chance.notes).toContain('The option ‘Keep our one oven’ is not in this run: "Keep our one oven" is ruled out, kept in view.');
    expect(broken(v)).toEqual([]);
  });

  it('C: a limit whose label wraps and has no measure: its unchecked line says it on one line', () => {
    const m = known(bakery());
    m.limits = m.limits.map((l) => ({ ...l, label: 'Within the\n£3,000', measure: null, question: 'How would you check the budget?' }));
    const v = evaluateCanonical(m, { sourceText: PRICED_BRIEF, seed: 7 }).view as Json;
    expect(v.goal_chance.unchecked_limits).toEqual([{ limit_id: 'within_budget', words: '‘Within the £3,000’ — "Within the £3,000" has no measure yet, so the result does not cover it.' }]);
    expect(v.goal_chance.notes).toContain('Not yet checked: ‘Within the £3,000’ — "Within the £3,000" has no measure yet, so the result does not cover it.');
    expect(broken(v)).toEqual([]);
  });

  it('D: a limit resting on an unknown figure whose basis wraps: its unchecked line says the basis on one line', () => {
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'unknown', question: null, basis: 'Oven prices vary widely.\nNo supplier has quoted yet.' } : x));
    const v = evaluateCanonical(m, { sourceText: BRIEF, seed: 7 }).view as Json;
    const line = '‘Within the £3,000’ — rests on "oven price", which is unknown: Oven prices vary widely. No supplier has quoted yet.';
    expect(v.goal_chance.unchecked_limits).toEqual([{ limit_id: 'within_budget', words: line }]);
    expect(v.goal_chance.notes).toContain(`Not yet checked: ${line}`);
    expect(broken(v)).toEqual([]);
  });

  // S1 strip (A20b off): no re-route; a range the law has no room for (a ceiling far below it) is held with the law's reason.
  const HELD = 'rests on "Sell through": the range 1.2 to 1.5 has no room inside what it can be (−∞ to -5); give a most likely figure, or ask';
  for (const priced of [false, true]) it(`E${priced ? 2 : 1}: a goal held by a range with no room and a wrapped label (${priced ? 'a Run of the limit alone' : 'nothing calculates: the waiting view'}): its note and each cell say it on one line`, () => {
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'sell_through' ? { ...x, label: 'Sell\n through', ceiling: -5, low: 1.2, high: 1.5, value: null } : x));
    const r = evaluateCanonical(priced ? known(m) : m, { sourceText: PRICED_BRIEF, seed: 7 });
    expect(r.sim !== null).toBe(priced);
    const v = r.view as Json;
    expect(v.goal_chance.notes).toContain(`‘Reach 380 loaves a week’ is not in the chance yet: ${HELD}.`);
    for (const o of v.options as Json[]) expect(o.cell.why, o.option_id).toBe(priced
      ? `‘Reach 380 loaves a week’ is not in the chance yet: ${HELD}. This run checks only the limits, each on its own: ‘spend’ within its limit: 100%.` : HELD);
    expect(broken(v)).toEqual([]);
  });
});

function beforeEachReset() { SCENARIO = randomUUID(); persisted = null; registered.length = 0; turnRows.clear(); conversationIds.clear(); pausedRun = null; sent.length = 0; replies = []; creates.length = 0; createAnswers = []; }

describe('the update schema carries the one-statement rule (PL AMEND on R3, 27 Oct)', () => {
  it('UPDATE_JSON_SCHEMA states it once, and the first-draft schema still states it once', async () => {
    const { UPDATE_JSON_SCHEMA, CANONICAL_JSON_SCHEMA } = await import('../prompt.js');
    const rule = 'One statement, one record across all families; never paraphrase it into another.';
    const count = (s: unknown) => JSON.stringify(s).split(rule).length - 1;
    expect(count(UPDATE_JSON_SCHEMA)).toBe(1);
    expect(count(CANONICAL_JSON_SCHEMA)).toBe(1);
    expect(JSON.stringify(UPDATE_JSON_SCHEMA)).toContain('Only the records this update changes or adds, each in full with its id, in its own family; [] for a family with none.');
  });
});
