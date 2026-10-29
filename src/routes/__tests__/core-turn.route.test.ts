/**
 * ⭐ THE CORE ROUTE (`POST /agent/v1/core-turn`, R2; DL 22 Oct). The real route over a saved MODEL PROGRAM (the synthetic bakery;
 * inventory F1b, 26 Oct: the route is program-only), with a scripted AI (0 live provider calls) and the graph / register /
 * versions routes as doubles in the served shapes: a typed turn, a card's approval, a resend of the same turn id, two turns at
 * once, a Stop, a canvas edit, a Run press, a saved scenario that is not a program (refused), the first draft's streamed graph,
 * and the contract's exact shape.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../orchestrator-v5/context/graph-hash.js';
import { registrationRequestHash, registrationRequestOf, registrationTurnId, unversionedSaveOf } from '../../orchestrator-v5/graph-registration/registration-identity.js';
import { toOutboundGraph } from '../../orchestrator-v5/goal-target/outbound-graph.js';
import { mapLivingModel } from '../../orchestrator-v5/path-b/living-model/mapper.js';
import { KNOWN_ANSWER } from '../../orchestrator-v5/path-b/living-model/__tests__/fixtures.js';
import { withCanonicalAnalysisView } from '../../orchestrator-v5/agent-lane/__tests__/fixtures/canonical-analysis-read.js';
import { streamWhenAsked } from '../../orchestrator-v5/agent-lane/__tests__/stream-when-asked.js';
import { SELECTION_NOTE_PREFIX } from '../../orchestrator-v5/agent-lane/selection-context.js';
import { TODAY_PREFIX } from '../../orchestrator-v5/agent-lane/turn-context.js';
import { corePromptCacheKey, PAUSE_NO_CARD, PAUSE_SUPERSEDED, STATE_BLOCK_PREFIX } from '../../orchestrator-v5/agent-lane/core/sdk-turn.js';
import { PROGRAM_TOOL_DESCRIPTIONS, programInstructions } from '../../orchestrator-v5/core-route/instructions.js';
import { TOOL_DESCRIPTIONS } from '../../orchestrator-v5/path-b/tools/index.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { ASK_CHALLENGE_CHIP_ID, OWN_SAVE_READ_MS, recordedRunsOf, typedRowProof } from '../../orchestrator-v5/core-route/turn-request.js';
import { bakery, BRIEF as BAKERY_BRIEF, club, CLUB_BRIEF, q, updateOf } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import type { CanonicalQuantityT } from '../../orchestrator-v5/model-program/canonical.js';
import { DRAFTING_INSTRUCTIONS, todayLine } from '../../orchestrator-v5/model-program-turn/prompt.js';
import type { LivingModelT } from '../../schemas/living-model.js';
import { seedOf } from '../../orchestrator-v5/model-program-turn/evaluate.js';
import { programOperationId, withNewRun } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { MODEL_PROGRAM, savedProgramOf } from '../../orchestrator-v5/model-program-turn/program-store.js';
import { PROGRAM_TURN_FACTS_PREFIX } from '../../orchestrator-v5/model-program-turn/program-tools.js';
import { coreBudget } from '../../orchestrator-v5/agent-lane/model-budgets.js';

type Json = Record<string, any>;
let SCENARIO = '';
const BRIEF = 'we need at least 100 units; today we are at 70. f is at 0.5. push f to 1, or we hold. each +1 in f adds 50 units on average, with a standard deviation of 10. Sam disagrees';
/** A saved Living Model: out of the alpha, refused on this route (inventory F1b). */
const postimage = (m: LivingModelT): Json => ({ ...mapLivingModel(m).graph, living_model: m });
/** The bakery saved as a MODEL PROGRAM with its first Run: the core route's one kind of saved scenario. */
const programGraph = (m = bakery()): Json => withNewRun({ model_program: MODEL_PROGRAM, canonical: m, seed: seedOf(SCENARIO), person_words: [BAKERY_BRIEF], runs: [] }).graph as Json;
/** Their answer to the bakery's one question (the oven's price), on that item: a card holding ONE figure of theirs, no drafter call. */
const answer = (value: number, quote: string): Json => ({ public_label: `Oven price ${quote}`, basis: 'their answer', request: '', remove: [],
  answers: [{ id: 'oven_price', value, low: null, high: null, range_kind: null, party: null, quote, basis: null, status: 'known', author: 'person' }] });
const SAID = 'The second oven would cost £2,500.';
const CHANGE = answer(2500, '£2,500');
/** The SDK's final output, with the bytes a host "tidy" would touch: leading space, markdown, a trailing newline. */
const ANSWER = '  The model holds **the oven price** as a question:\n\n- A second oven\n- Keep our one oven\n';
/** Every turn's keys; a program turn adds its view and its own record after `analysis_state`. */
const BASE_KEYS = ['turn_id', 'durability', 'assistant_text', 'model', 'cards', 'notes', 'run', 'analysis_state', 'receipts', 'paused', 'error', 'action_bar', '_agent', '_provider_calls'];
const CONTRACT_KEYS = [...BASE_KEYS.slice(0, 8), 'canonical_analysis_view', 'model_program', ...BASE_KEYS.slice(8)];
const LEGACY_ENVELOPE = ['response_version', 'blocks', 'suggested_actions', 'insights', 'stage_indicator'];
/** The UI's reader of this contract, field for field (DGAI 748f20a1 `src/v5/coreTurnContract.ts`): a body it refuses shows "reply not received". */
const uiId = z.string().min(1).nullable();
const uiAction = z.object({ id: z.string().min(1), label: z.string().min(1), message: z.string().min(1) }).passthrough();
const UI_CORE_TURN = z.object({ turn_id: uiId, durability: z.string().optional(), assistant_text: z.string(),
  model: z.object({ graph: z.record(z.unknown()).optional(), revision: uiId, scenario_revision: uiId }).passthrough().nullable(),
  cards: z.array(z.object({ proposal_id: z.string().min(1), issued_turn_id: uiId.optional(), approve_action: uiAction, decline_action: uiAction }).passthrough()).default([]),
  notes: z.array(z.object({ element_id: z.string().min(1), text: z.string().min(1) })).default([]),
  run: z.object({ run_key: uiId, run_id: uiId, computed_against: uiId,
    state: z.object({ kind: z.string().min(1), computed_at: z.string().nullable().optional() }).passthrough() }).passthrough().nullable(),
  analysis_result: z.record(z.unknown()).nullable().optional(), analysis_state: z.record(z.unknown()).nullable().optional(),
  receipts: z.array(z.object({ authorised_by: z.enum(['person', 'olumi']) }).passthrough()).default([]),
  paused: z.object({ proposal_id: uiId }).nullable().optional(), action_bar: z.unknown().optional(),
  error: z.object({ code: z.string().min(1), message: z.string(), retry_safe: z.boolean(), nothing_saved: z.boolean() }).nullable() });

let persisted: Json | null = null;
let readiness: Json = { status: 'blocked', may_run: false, options: [], blockers: [] };
let runState: Json | undefined;
let carriedResult: Json | undefined;
/** When set, the read selects ANOTHER Run than the one this turn confirmed (one that landed while the reply was written). */
let otherRun: string | undefined;
const registered: Json[] = [];
/** The register's refusal for every write, as the real register sends it (a 422 body), or none. */
let registerRefusal: Json | null = null;
/** When set, every versions read waits for it (a read that never answers until released), counted in `versionsHeld`. */
let holdVersions: Promise<void> | undefined;
let versionsHeld = 0;
/** A guest's write, as the register commits one: saved, but no version minted (`append_turn_atomic_v5`), so no version receipt. */
let guestWrites = false;
/**
 * C8: each guest registration's own row (`v5_conversation_turns` under `registrationTurnId`), as the RPC commits it with the
 * graph: `request_hash` from the ONE carrier definition (`registrationRequestHash`) and `model_version_created: false`. Kept
 * apart from `turnRows` (whose latest row the held-card reader reads); the store's `readCommittedTurn` reads both.
 */
const registrationRows = new Map<string, Json>();
/** When set, a guest registration row is written as before C8: its request hash with no `#saved` carrier. */
let preCarrierRows = false;
/** The next write's acknowledgement is lost (a 503), after its commit or before it: once, then cleared. */
let loseAck: 'after_commit' | 'before_commit' | null = null;
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
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? registrationRows.get(id) ?? null),
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
  /** This turn's own fence row carries a Stop's tombstone (`v5_turn_fence.stopped_at`). */
  isTurnStopped: vi.fn(async (sid: string, tid: string) => (fenceRows.get(`${sid}:${tid}`)?.stopped_at ?? null) !== null),
};
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
/** Spies that call the real legacy functions, so a row can say a program turn never reaches them (spec §3, DL 26 Oct). */
const legacy = vi.hoisted(() => ({ livingView: vi.fn(), capabilities: vi.fn(), rank: vi.fn(), restoreRun: vi.fn(), heldWriter: vi.fn(), history: vi.fn(),
  chips: vi.fn(), lifecycle: vi.fn(), stillApplies: vi.fn(), subjectMoved: vi.fn(), appliesAt: vi.fn(), recordApplies: vi.fn() }));
/** The program's own reader, spied the same way: the contrast that the probe sees a call the route does make. */
const program = vi.hoisted(() => ({ read: vi.fn(), history: vi.fn(), reconcile: vi.fn(), chips: vi.fn() }));
vi.mock('../../orchestrator-v5/path-b/living-model/view.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/path-b/living-model/view.js')>();
  legacy.livingView.mockImplementation(actual.livingViewOf);
  return { ...actual, livingViewOf: legacy.livingView };
});
vi.mock('../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js')>();
  legacy.capabilities.mockImplementation(actual.createAgentCapabilities);
  return { ...actual, createAgentCapabilities: legacy.capabilities };
});
vi.mock('../../orchestrator-v5/handlers/approve-held-proposal.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/handlers/approve-held-proposal.js')>();
  legacy.heldWriter.mockImplementation(actual.commitHeldProposalInProcess);
  return { ...actual, commitHeldProposalInProcess: legacy.heldWriter };
});
vi.mock('../../orchestrator-v5/model-program-turn/program-tools.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/model-program-turn/program-tools.js')>();
  program.read.mockImplementation(actual.readProgramContext);
  return { ...actual, readProgramContext: program.read };
});
vi.mock('../../orchestrator-v5/agent-lane/actions/rank.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/actions/rank.js')>();
  legacy.rank.mockImplementation(actual.actionBarOf);
  return { ...actual, actionBarOf: legacy.rank };
});
vi.mock('../../orchestrator-v5/agent-lane/history-store.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/history-store.js')>();
  legacy.history.mockImplementation(actual.historyFromDurableTurns);
  return { ...actual, historyFromDurableTurns: legacy.history };
});
vi.mock('../../orchestrator-v5/model-program-turn/program-history.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/model-program-turn/program-history.js')>();
  program.history.mockImplementation(actual.programHistoryOf);
  return { ...actual, programHistoryOf: program.history };
});
// F6 part b: the Living Model's card rules (chips, lifecycle, still-applies, the record's applies rule) and the program's own.
vi.mock('../../orchestrator-v5/agent-lane/approval-chips.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/approval-chips.js')>();
  legacy.chips.mockImplementation(actual.approvalChipsFor);
  return { ...actual, approvalChipsFor: legacy.chips };
});
vi.mock('../../orchestrator-v5/agent-lane/proposal-object/lifecycle.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/proposal-object/lifecycle.js')>();
  legacy.lifecycle.mockImplementation(actual.reconcileHeldProposals);
  return { ...actual, reconcileHeldProposals: legacy.lifecycle };
});
vi.mock('../../orchestrator-v5/agent-lane/proposal-object/still-applies.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/proposal-object/still-applies.js')>();
  legacy.stillApplies.mockImplementation(actual.heldCardStillApplies);
  legacy.subjectMoved.mockImplementation(actual.heldCardSubjectMoved);
  legacy.appliesAt.mockImplementation(actual.heldCardAppliesAt);
  return { ...actual, heldCardStillApplies: legacy.stillApplies, heldCardSubjectMoved: legacy.subjectMoved, heldCardAppliesAt: legacy.appliesAt };
});
vi.mock('../../orchestrator-v5/agent-lane/proposal-object/record.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/proposal-object/record.js')>();
  legacy.recordApplies.mockImplementation(actual.heldRecordAppliesAt);
  return { ...actual, heldRecordAppliesAt: legacy.recordApplies };
});
vi.mock('../../orchestrator-v5/model-program-turn/program-card-turn.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/model-program-turn/program-card-turn.js')>();
  program.reconcile.mockImplementation(actual.reconcileProgramCards);
  return { ...actual, reconcileProgramCards: program.reconcile };
});
vi.mock('../../orchestrator-v5/model-program-turn/program-card.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/model-program-turn/program-card.js')>();
  program.chips.mockImplementation(actual.programChipsFor);
  return { ...actual, programChipsFor: program.chips };
});
vi.mock('../../orchestrator-v5/agent-lane/run-operation.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/run-operation.js')>();
  legacy.restoreRun.mockImplementation(actual.restoreRunOperation);
  return { ...actual, restoreRunOperation: legacy.restoreRun };
});

let served = 0;
/** When set, the next provider call waits for it: a turn still running while another is sent. */
let holdProvider: Promise<void> | undefined;
/** When set, only a call this picks is held (the reply call after a tool ran: the approval has committed and awaits its words). */
let holdWhen: ((body: Json) => boolean) | undefined;
let preparedId = '';
/** Items added to a Conversation (`POST /v1/conversations/{id}/items`), with the Conversation they were added to. */
let conversationItems: { readonly conversation: string; readonly items: Json[] }[] = [];
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
  /** The drafter's answers in order, each once, before `canonicalDraft` answers the rest (a refused update, then its correction). */
  let canonicalDrafts: string[] = [];
  let runWithStageStream: typeof import('../../cee/unified-pipeline/stage-stream-context.js').runWithStageStream;
  let currentTurnFence: typeof import('../../orchestrator-v5/session/turn-fence.js').currentTurnFence;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return json({ id: `conv_${randomUUID()}`, object: 'conversation' });
      const added = /\/v1\/conversations\/([^/]+)\/items$/.exec(String(url));
      if (added !== null) {
        conversationItems.push({ conversation: added[1]!, items: (JSON.parse(String(init?.body ?? '{}')) as Json).items as Json[] });
        return json({ object: 'list', data: [], first_id: null, last_id: null, has_more: false });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      // The canonical drafter's strict call answers with the row's canned canonical model (none: no draft).
      if (body.text?.format?.name === 'canonical_model') {
        calls.push(body);
        const draft = canonicalDrafts.shift() ?? canonicalDraft;
        return json(responsesBody(draft === undefined ? [] : [{ type: 'message', text: draft }]));
      }
      // A structured side call (the model critic) answers nothing, and never takes the conversation's scripted outputs.
      if (body.text?.format?.type === 'json_schema') return json(responsesBody([]));
      calls.push(body);
      if (holdProvider !== undefined && (holdWhen === undefined || holdWhen(body))) { const hold = holdProvider; holdProvider = undefined; await hold; }
      const next = outputs.shift() ?? [{ type: 'message', text: ANSWER }];
      // A refused call (a 400: never retried), so the turn ends with no reply.
      if (next[0]?.type === 'refuse') return json({ error: { message: 'Refused.', type: 'invalid_request_error', param: null, code: null } }, 400);
      // A stream that ends after its first event, with no terminal one (served `stream_without_terminal_event`): delivery unknown.
      if (next[0]?.type === 'cut') {
        return new Response(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', sequence_number: 0,
          response: { id: 'resp_cut', object: 'response', model: 'gpt-scripted', status: 'in_progress', output: [] } })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
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
      if (registerRefusal !== null) return reply.code(422).send(registerRefusal);
      // The commit's own gate (append_turn_atomic_v4, 20260806120000): keyed by the BOUND fence handle's generation, a
      // stopped row refuses in the transaction. The real route commits a core turn's write under the turn's handle.
      const bound = currentTurnFence();
      if (bound !== undefined && [...fenceRows.values()].some((r) => r.generation === bound.generation && r.stopped_at !== null)) {
        return reply.code(409).send({ details: { code: 'TURN_STOPPED' } });
      }
      const current = persisted === null ? null : computeGraphIdentityHash(persisted as never)!.value;
      if ((b.expected_graph_identity_hash ?? null) !== current) return reply.code(409).send({ details: { code: 'GRAPH_STALE' } });
      if (loseAck === 'before_commit') { loseAck = null; return reply.code(503).send({ code: 'upstream_unavailable' }); }
      if (guestWrites) {
        // The register's guest commit: the graph and its own row in one transaction (no version minted); a same-request resend
        // replays (writes nothing), a different one under the same operation is refused; the receipt is read BACK from the row.
        const regTurn = registrationTurnId((req.params as { id: string }).id, String(b.operation_id));
        const hash = registrationRequestHash(b.graph, typeof b.brief_text === 'string' ? b.brief_text : undefined);
        const prior = registrationRows.get(regTurn);
        if (prior !== undefined && registrationRequestOf(String(prior.request_hash)) !== registrationRequestOf(hash)) {
          return reply.code(409).send({ details: { code: 'OPERATION_ID_REUSED' } });
        }
        if (prior === undefined) {
          persisted = b.graph as Json;
          registrationRows.set(regTurn, { id: `reg-${registrationRows.size + 1}`, turn_id: regTurn, user_id: null, model_version_created: false,
            request_hash: preCarrierRows ? registrationRequestOf(hash) : hash });
        }
        if (loseAck === 'after_commit') { loseAck = null; return reply.code(503).send({ code: 'upstream_unavailable' }); }
        const carried = unversionedSaveOf(registrationRows.get(regTurn), regTurn);
        return { registered: true, ...(prior !== undefined ? { replayed: true } : {}), graph_identity_hash: computeGraphIdentityHash(b.graph as never)!,
          graph_hash: hashOf(b.graph), ...(carried === null ? {} : { unversioned_save: carried }) };
      }
      persisted = b.graph as Json;
      registered.push(b);
      if (loseAck === 'after_commit') { loseAck = null; return reply.code(503).send({ code: 'upstream_unavailable' }); }
      const identity = computeGraphIdentityHash(persisted as never)!;
      return { registered: true, graph_identity_hash: identity, graph_hash: hashOf(persisted),
        model_version: { version_id: `v_${registered.length}`, version_number: registered.length, mutation_id: `m_${registered.length}`,
          creation_kind: registered.length === 1 ? 'initial' : 'committed_mutation', graph_identity_hash: identity.value,
          analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(persisted as never) } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async (req) => { if (holdVersions !== undefined) { versionsHeld += 1; await holdVersions; } return { versions: registered.map((b, i) => ({
      version_id: `v_${i + 1}`, sequence: i + 1, created_at: '2026-10-22T10:00:00.000Z',
      creation: { kind: 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId((req.params as { id: string }).id, String(b.operation_id)) } })) }; });
    // The real Stop handler (route-v2's `/orchestrate/v2/turn/stop` body), over the same store.
    const { recordExplicitTurnStop } = await import('../turn-stop.js');
    app.post('/orchestrate/v2/turn/stop', async (req, reply) => { const r = await recordExplicitTurnStop(req, 'req-stop'); return reply.code(r.status).send(r.body as never); });
    await app.register(route.coreTurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    SCENARIO = randomUUID(); persisted = programGraph(); canonicalDraft = undefined; canonicalDrafts = []; registered.length = 0; fenceRows.clear(); turnRows.clear(); conversationIds.clear();
    readiness = { status: 'blocked', may_run: false, options: [], blockers: [] }; runState = undefined; carriedResult = undefined; otherRun = undefined;
    pausedRun = null; calls = []; conversationItems = []; outputs = []; preparedId = ''; holdProvider = undefined; holdWhen = undefined; registerRefusal = null;
    holdVersions = undefined; versionsHeld = 0; guestWrites = false; loseAck = null; registrationRows.clear(); preCarrierRows = false;
  });
  const post = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/core-turn',
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const typed = (message: string, turnId = randomUUID()) => post({ turn_id: turnId, message, source: 'composer' });
  const freshRead = async (): Promise<Json> => (await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} })).json() as Json;
  const ids = (graph: Json | undefined): string[] => ((graph?.nodes ?? []) as Json[]).map((n) => String(n.id)).sort();
  const challengeOn = (id: string) => post({ turn_id: randomUUID(), message: 'Challenge this', source: 'chip_click', chip: { id: ASK_CHALLENGE_CHIP_ID },
    selected_elements: { node_ids: [id] } });
  /** The press of a card's own approve button. */
  const pressOf = (card: Json): Json => ({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click',
    chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
  /** A card holding their answer, proposed on a typed turn: its press (`preparedId` is the card). */
  const propose = async (said = SAID, args: Json = CHANGE): Promise<Json> => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args }], [{ type: 'message', text: 'I prepared that change.' }]];
    const cards = ((await typed(said)).json() as Json).cards as Json[];
    const card = cards.find((c) => c.proposal_id !== preparedId) ?? cards[0]!;
    preparedId = String(card.proposal_id);
    return pressOf(card);
  };
  /** A program figure as saved now. */
  const figure = (id: string): number | null => savedProgramOf(persisted)!.canonical.quantities.find((x) => x.id === id)!.value;
  /** How many Runs the saved program holds. */
  const storedRuns = (): number => savedProgramOf(persisted)!.runs.length;
  /** One figure typed on a card: the person's own hand on the bakery's weekly sales (`applyCanvasFigure`). */
  const canvasEdit = (turnId: string, value = 320) => post({ kind: 'system_event', turn_id: turnId,
    event: { kind: 'factor_value_edit', target_id: 'base_sales', raw_value: value } });

  it('a typed turn: the AI’s reply byte for byte, and the saved model in the contract’s exact shape', async () => {
    const r = await typed('What does the model hold for the oven today?');
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(Object.keys(j)).toEqual(CONTRACT_KEYS);
    for (const k of LEGACY_ENVELOPE) expect(j, `no legacy envelope key ${k}`).not.toHaveProperty(k);
    // NEGATIVE: nothing is composed around the SDK's final output, not even a trim.
    expect(j.assistant_text).toBe(ANSWER);
    expect(j).toMatchObject({ durability: 'recorded', cards: [], notes: [], run: null, receipts: [], paused: null, error: null, action_bar: null });
    expect(j).not.toHaveProperty('analysis_result');
    const read = await freshRead();
    expect(j.model.revision).toBe(read.graph_hash);
    expect(j.model.scenario_revision, 'identity.v1, as the graph read serves it').toBe(read.graph_identity_hash.value);
    expect(read.content_hash).toBe(read.graph_identity_hash.value);
    expect(ids(j.model.graph)).toEqual(ids(read.graph));
    expect(calls).toHaveLength(1);
    expect(turnRows.get(j.turn_id)?.assistant_message, 'the answer row records the same words').toBe(ANSWER);
  });

  it('a card: proposed on a typed turn, approved by its own press as ONE commit with the person’s receipt and its own Run, and a resend of the press writes nothing', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'I prepared that change; press its card to save it.' }]];
    const first = (await typed(SAID)).json() as Json;
    expect(first.cards.map((c: Json) => c.proposal_id), JSON.stringify(first._agent)).toEqual([expect.stringMatching(/^prop_/)]);
    const card = first.cards[0];
    preparedId = String(card.proposal_id);
    expect(card.issued_turn_id, 'the card names the reply that issued it, so it reattaches on reopen').toBe(first.turn_id);
    expect(registered, 'a proposal writes nothing').toHaveLength(0);

    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved: the oven costs £2,500.' }]];
    const press = pressOf(card);
    const approved = await post(press);
    expect(approved.statusCode, approved.body).toBe(200);
    const a = approved.json() as Json;
    expect(calls[2]?.tool_choice, 'the press opens on the change’s own apply_change').toMatchObject({ type: 'function', name: 'apply_change' });
    // M4 (DL 22 Oct): every press call goes out at the typed turn's effort and output cap, so it reads their cached prefix.
    for (const c of calls.slice(2)) expect({ model: c.model, reasoning: c.reasoning, max_output_tokens: c.max_output_tokens })
      .toEqual({ model: calls[0]!.model, reasoning: calls[0]!.reasoning, max_output_tokens: calls[0]!.max_output_tokens });
    expect(calls[0]!.reasoning, 'control: the typed turn sends an effort').toEqual({ effort: coreBudget().reasoning_effort });
    expect(registered, JSON.stringify(a._agent)).toHaveLength(1);
    expect(figure('oven_price')).toBe(2500);
    expect(a.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
    expect(a.cards, 'the applied card is no longer waiting').toEqual([]);
    expect(a.assistant_text).toBe('Saved: the oven costs £2,500.');
    // The card's model is saved with its own Run, which the reply names.
    expect(storedRuns()).toBe(2);
    expect(a.run).toMatchObject({ run_id: savedProgramOf(persisted)!.runs.at(-1)!.run_id });

    const callsBefore = calls.length;
    const again = (await post(press)).json() as Json;
    expect(again).toMatchObject({ durability: 'replayed', assistant_text: 'Saved: the oven costs £2,500.', error: null });
    expect(calls.length, 'a replay calls no model').toBe(callsBefore);
    expect(registered, 'and writes nothing').toHaveLength(1);
  });

  it('DL 93d79c3e 09:40Z (Lenses on 50f76df0): a Stop during a core turn is recorded as its tombstone, and the write the AI then makes commits nothing', async () => {
    const press = await propose();
    let release!: () => void;
    holdProvider = new Promise<void>((resolve) => { release = resolve; });
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
    const before = calls.length;
    const approval = post(press);
    // The press's first call is held: the turn is admitted, and nothing is written yet.
    await vi.waitFor(() => expect(calls.length).toBe(before + 1));
    const stop = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn/stop', payload: { scenario_id: SCENARIO, turn_id: press.turn_id } });
    expect(stop.statusCode, stop.body).toBe(200);
    expect(stop.json()).toMatchObject({ stopped: true, claimed: true, turn_id: press.turn_id });
    expect(fenceRows.get(`${SCENARIO}:${press.turn_id}`)?.stopped_at, 'the tombstone').not.toBeNull();
    release();
    const a = (await approval).json() as Json;
    expect(calls.at(-1)?.tool_choice, 'control: the AI did send its apply').toMatchObject({ type: 'function', name: 'apply_change' });
    // C14 (27 Oct): that call is the turn's last: once stopped, no reply call is made.
    expect(calls).toHaveLength(before + 1);
    expect(registered, 'nothing committed after the Stop').toHaveLength(0);
    expect(figure('oven_price')).toBeNull();
    expect(a.receipts).toEqual([]);
  });

  describe('C14 clauses 7–9 (alpha spec §7, 27 Oct): a Stop before and after a possible save, and a resend that never freezes', () => {
    /** A provider call made after a tool ran: the reply call, once the press's change has committed. */
    const afterTool = (body: Json): boolean => Array.isArray(body.input) && (body.input as Json[]).some((i) => i.type === 'function_call_output');
    const stopTurn = (turnId: string) => app.inject({ method: 'POST', url: '/orchestrate/v2/turn/stop', payload: { scenario_id: SCENARIO, turn_id: turnId } });
    /**
     * A Stop answered as `v5_mark_turn_stopped` derives it (migration 20260731120000, lines 238–241): `already_committed` is whether a
     * conversation row with THIS turn id exists. The store double's own answer is always false.
     */
    const stopAsTheRpcDerives = (turnId: string) => {
      store.markTurnStopped.mockImplementationOnce(async (sid: string, tid: string) => {
        const row = fenceRows.get(`${sid}:${tid}`);
        fenceRows.set(`${sid}:${tid}`, { generation: row?.generation ?? ++fenceGeneration, stopped_at: row?.stopped_at ?? '2026-10-27T10:00:00.000Z' });
        return { stopped: true, claimed: row !== undefined, alreadyCommitted: turnRows.has(tid) };
      });
      return stopTurn(turnId);
    };
    /** The claim wait, shortened through the object the route reads (`turn-request.ts` AGENT_TURN_CLAIM_WAIT, as the agent-turn-replay rows do), then restored. */
    const withShortClaimWait = async (run: () => Promise<void>): Promise<void> => {
      const { AGENT_TURN_CLAIM_WAIT } = await import('../../orchestrator-v5/core-route/turn-request.js');
      const kept = { ...AGENT_TURN_CLAIM_WAIT };
      Object.assign(AGENT_TURN_CLAIM_WAIT, { totalMs: 50, everyMs: 5 });
      try { await run(); } finally { Object.assign(AGENT_TURN_CLAIM_WAIT, kept); }
    };
    const OUTCOME_UNKNOWN = { code: 'TURN_OUTCOME_UNKNOWN', retry_safe: false, nothing_saved: false,
      message: 'This message is already being handled, or an earlier attempt ran and its reply was not recorded. Nothing was run again; reload to see the current model.' };
    const STOPPED_REPLY = 'That change was stopped before it was saved.';
    /** A stopped turn that had sent a write: it may have saved (its receipt says so), and is never said to be undone. */
    const STOPPED_AFTER_WRITE = { code: 'TURN_STOPPED', message: 'You stopped this turn. Anything it had already saved is kept; reload to see your model.',
      retry_safe: false, nothing_saved: false };
    /** A stopped turn whose every write the fence refused (the register's TURN_STOPPED: nothing written), or that sent none. */
    const STOPPED = { code: 'TURN_STOPPED', message: 'You stopped this turn before it changed anything. Nothing in your model was changed.',
      retry_safe: false, nothing_saved: true };
    /** A press whose first provider call is held, then stopped there: admitted, nothing written yet. */
    const stoppedBeforeWrite = async () => {
      const press = await propose();
      let release!: () => void;
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: STOPPED_REPLY }]];
      const before = calls.length;
      const pending = post(press);
      await vi.waitFor(() => expect(calls.length).toBe(before + 1));
      const stop = await stopAsTheRpcDerives(String(press.turn_id));
      release();
      const turn = await pending;
      // What the AI is told of its own apply after the Stop: the tool answer, put into the scenario's Conversation (C14, 27 Oct:
      // no reply call is made after a Stop, so the next call reads it there).
      const told = conversationItems.flatMap((c) => c.items).filter((i) => i.type === 'function_call_output' && i.call_id === 'apply')
        .map((i) => JSON.parse(String(i.output)) as Json);
      return { press, stop, turn, told };
    };
    /** A press whose change has committed (one register) and whose reply call is held, then stopped there. */
    const stoppedAfterCommit = async () => {
      const press = await propose();
      let release!: () => void;
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      holdWhen = afterTool;
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved: the oven costs £2,500.' }]];
      const pending = post(press);
      // The change has committed and its reply call is held (the hold taken): the Stop lands while the reply is written.
      await vi.waitFor(() => expect([registered.length, holdProvider]).toEqual([1, undefined]));
      const runs = storedRuns();
      const stop = await stopAsTheRpcDerives(String(press.turn_id));
      release();
      return { press, stop, runs, turn: await pending };
    };

    it('C14 (7): a Stop while the press’s first call runs, before any write: its typed answer; the AI’s apply is refused TURN_STOPPED, written false; the turn writes nothing and claims no receipt; a resend replays with no call or write; the card stays held and a new press applies it once', async () => {
      // The fence half (tombstone, nothing committed) is the row above (DL 93d79c3e 09:40Z); this row pins the turn's own outcome.
      const { press, stop, turn, told } = await stoppedBeforeWrite();
      expect(stop.statusCode, stop.body).toBe(200);
      expect(stop.json()).toEqual({ stopped: true, claimed: true, already_committed: false, scenario_id: SCENARIO, turn_id: press.turn_id, request_id: 'req-stop' });
      expect(turn.statusCode, turn.body).toBe(200);
      const t = turn.json() as Json;
      // C14 (27 Oct): the stopped turn's answer is typed TURN_STOPPED. Its one write was sent and the fence refused it (409
      // TURN_STOPPED: nothing written), so nothing changed: nothing_saved true, no receipt. The refused write is typed on its tool
      // call. No reply call is made after the Stop, so there are no words (STOPPED_REPLY was scripted for one).
      expect(t).toMatchObject({ durability: 'recorded', error: STOPPED, receipts: [], assistant_text: '' });
      expect(t._agent.tool_calls).toEqual([{ name: 'apply_change', outcome: 'refused', refusal: 'registration_refused' }]);
      expect(told).toEqual([expect.objectContaining({ status: 'refused', reason: 'registration_refused', data: { code: 'TURN_STOPPED', written: false } })]);
      expect([registered.length, figure('oven_price')]).toEqual([0, null]);
      const callsBefore = calls.length;
      const again = await post(press);
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json()).toMatchObject({ durability: 'replayed', error: STOPPED, receipts: [], assistant_text: '' });
      expect([calls.length, registered.length], 'a resend calls no model and writes nothing').toEqual([callsBefore, 0]);
      // The Stop ended that turn only: the card is still held, and a new press applies it once, with the person's receipt.
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_again' }], [{ type: 'message', text: 'Saved.' }]];
      const repress = await post({ ...press, turn_id: randomUUID() });
      expect(repress.statusCode, repress.body).toBe(200);
      expect((repress.json() as Json).receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
      expect([registered.length, figure('oven_price')]).toEqual([1, 2500]);
    });

    // C14 (8) LIMIT, pinned at the producer: `already_committed` is whether this turn's conversation row exists, and a core turn
    // stopped before any write still records its answer row. So a later Stop reads true with nothing saved: on core neither value is
    // save evidence, which is why the UI says the outcome is unknown there (DGAI #3032). It turns red if the Stop ever reads the save.
    it('C14 (8) limit: a core turn stopped before any write still records its answer row, so a later Stop reads already_committed true with nothing saved', async () => {
      const { press, stop, turn } = await stoppedBeforeWrite();
      expect(stop.json()).toMatchObject({ already_committed: false });
      expect((turn.json() as Json).receipts).toEqual([]);
      const later = await stopAsTheRpcDerives(String(press.turn_id));
      expect(later.statusCode, later.body).toBe(200);
      expect(later.json()).toMatchObject({ stopped: true, already_committed: true });
      expect([registered.length, figure('oven_price')], 'nothing was saved').toEqual([0, null]);
    });

    // C14 (7): after a Stop the AI is told the truth the row above shows: nothing was written and the card can be pressed again
    // (SAVE_STOPPED_AFTER_APPROVAL), never the store-refusal sentence "Pressing the card again would be refused the same way."
    it('C14 (7): after a Stop, the AI is told the card is still held and can be pressed again, never that a re-press would be refused', async () => {
      const { told } = await stoppedBeforeWrite();
      expect(told).toHaveLength(1);
      expect(String(told[0]!.detail)).toBe('The person’s approval of this card was received, but they stopped this turn before it saved, so '
        + 'nothing was written and the saved model is unchanged. The card is still held and can be pressed again.');
    });

    it('C14 (7): a Stop while the press waits on the scenario’s slot, before its fence claim (taken after the slot and the start reads), is refused "That turn could not be stopped." with no tombstone and never says it cancelled; the press then runs and saves once, with its receipt', async () => {
      const press = await propose();
      let release!: () => void;
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      outputs = [[{ type: 'message', text: 'First answer.' }], [{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
      const before = calls.length;
      const first = typed('First question.');
      await vi.waitFor(() => expect(calls.length).toBe(before + 1));
      const waiting = post(press);
      // The press holds its claim and waits on the slot the first turn holds: it has no place in the fence yet.
      await vi.waitFor(() => expect(turnRows.has(`${press.turn_id}:claim`)).toBe(true));
      expect(fenceRows.has(`${SCENARIO}:${press.turn_id}`)).toBe(false);
      const stop = await stopTurn(String(press.turn_id));
      expect(stop.statusCode, stop.body).toBe(404);
      expect(stop.json()).toEqual({ error: { code: 'TURN_STOP_UNKNOWN_SCENARIO', message: 'That turn could not be stopped.', source: 'cee', request_id: 'req-stop' } });
      expect(fenceRows.has(`${SCENARIO}:${press.turn_id}`), 'no tombstone was recorded').toBe(false);
      release();
      const [a, b] = await Promise.all([first, waiting]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect(b.json()).toMatchObject({ durability: 'recorded', error: null });
      expect((b.json() as Json).receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
      expect([registered.length, figure('oven_price')]).toEqual([1, 2500]);
    });

    it('C14 (8): a Stop after the press’s change committed, while its reply is written: the tombstone is recorded and nothing is rolled back or said to be; the turn’s answer carries its own receipt, one revision; a resend replays with no call or write; once the answer row exists a Stop reads already_committed true', async () => {
      const { press, stop, runs, turn } = await stoppedAfterCommit();
      expect(stop.statusCode, stop.body).toBe(200);
      // The Stop says what it recorded, and nothing else (its already_committed: the FINDING below).
      expect(Object.keys(stop.json())).toEqual(['stopped', 'claimed', 'already_committed', 'scenario_id', 'turn_id', 'request_id']);
      expect(stop.json()).toMatchObject({ stopped: true, claimed: true, turn_id: press.turn_id });
      expect(fenceRows.get(`${SCENARIO}:${press.turn_id}`)?.stopped_at, 'the tombstone').not.toBeNull();
      expect(turn.statusCode, turn.body).toBe(200);
      const t = turn.json() as Json;
      // C14 (27 Oct): typed as stopped, and never said to be undone: the saved change is kept, with its own receipt.
      expect(t).toMatchObject({ durability: 'recorded', error: STOPPED_AFTER_WRITE, assistant_text: 'Saved: the oven costs £2,500.' });
      expect(t.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', mutation_id: 'm_1', authorised_by: 'person' })]);
      expect([registered.length, storedRuns(), figure('oven_price')], 'the committed change stands: one revision, its own Run').toEqual([1, runs, 2500]);
      const callsBefore = calls.length;
      const again = await post(press);
      expect(again.statusCode, again.body).toBe(200);
      // A replay's receipts are an open item (ALPHA-PLAN C14 (8), order 4): not pinned here.
      expect(again.json()).toMatchObject({ durability: 'replayed', error: STOPPED_AFTER_WRITE, assistant_text: 'Saved: the oven costs £2,500.' });
      expect([calls.length, registered.length], 'a resend calls no model and writes nothing').toEqual([callsBefore, 1]);
      // CONTRAST, on the RPC's derivation: once the turn's own answer row exists, a Stop reads already_committed true.
      expect((await stopAsTheRpcDerives(String(press.turn_id))).json()).toMatchObject({ stopped: true, claimed: true, already_committed: true });
    });

    // FINDING (C14 (8), not fixed here): `already_committed` is whether a conversation row with the Stop's own turn id exists. A core
    // press commits its change under its registration id (`registrationTurnId(scenario, operation)`) and writes its own answer row only
    // after the reply, so a Stop between the two reads false, which Docs/v5/turn-fence.md:63 words as "It was cancelled before it was
    // saved." (the UI's own mapping is not checked here). it.fails turns red once that Stop says the change was already saved.
    it.fails('FINDING C14 (8): a Stop after the press’s change committed says it was already committed', async () => {
      const { stop } = await stoppedAfterCommit();
      expect(registered).toHaveLength(1);
      expect(stop.json()).toMatchObject({ already_committed: true });
    });

    it('C14 (8, 9): a resend of the same press while the original still holds its claim past the wait: 409 TURN_OUTCOME_UNKNOWN, durability unknown, never "nothing saved", with the change’s own receipt (C7), answered while the original still runs; the original then records its one write, and a later resend replays it', async () => {
      await withShortClaimWait(async () => {
        const press = await propose();
        let release!: () => void;
        holdProvider = new Promise<void>((resolve) => { release = resolve; });
        holdWhen = afterTool;
        outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved: the oven costs £2,500.' }]];
        let originalAnswered = false;
        const original = post(press).then((r) => { originalAnswered = true; return r; });
        // The original is held inside its next provider call, already counted, so the count below is the resend's alone (CI ran
        // the original's call during the resend's claim wait when this read only the write).
        await vi.waitFor(() => expect([registered.length, holdProvider]).toEqual([1, undefined]));
        const callsBefore = calls.length;
        const resend = await post(press);
        expect(originalAnswered, 'no freeze: the resend answers while the original still runs').toBe(false);
        expect(resend.statusCode, resend.body).toBe(409);
        // C7 (27 Oct): what the press has saved so far is said, with that change's own receipt; the outcome stays unknown.
        expect(resend.json()).toMatchObject({ durability: 'unknown', error: OUTCOME_UNKNOWN });
        expect((resend.json() as Json).receipts).toEqual([expect.objectContaining({ version_id: 'v_1', mutation_id: 'm_1', authorised_by: 'person' })]);
        expect([calls.length, registered.length], 'the resend runs nothing again').toEqual([callsBefore, 1]);
        release();
        const o = await original;
        expect(o.statusCode, o.body).toBe(200);
        expect((o.json() as Json).receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
        expect((await post(press)).json()).toMatchObject({ durability: 'replayed', error: null });
        expect(registered, 'one write for that turn id').toHaveLength(1);
      });
    });

    it('C14 (8) + C7: the change committed, its reply failed, and the failed continuation could not be recorded: 502, durability unknown, the saved receipt, never "nothing saved"; a resend writes nothing again and calls no model (409 TURN_OUTCOME_UNKNOWN, with that receipt)', async () => {
      await withShortClaimWait(async () => {
        const press = await propose();
        outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'refuse' }]];
        const append = store.append.getMockImplementation()!;
        // Only the failed continuation's own row (its turn id, response_emitted false: core-turn.ts's catch) cannot be written.
        store.append.mockImplementation(async (write: Json) => {
          if (write.turn_id === press.turn_id && write.response_emitted === false) throw new Error('store down');
          return append(write);
        });
        let r!: Awaited<ReturnType<typeof post>>;
        try { r = await post(press); } finally { store.append.mockImplementation(append); }
        expect(r.statusCode, r.body).toBe(502);
        const j = r.json() as Json;
        expect(j).toMatchObject({ durability: 'unknown', error: { code: 'UPSTREAM_ERROR', retry_safe: false, nothing_saved: false,
          message: 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.' } });
        expect(j.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', mutation_id: 'm_1', authorised_by: 'person' })]);
        // CONTRAST: the claim stands and no answer row was written (with one, the resend replays REPLY_NOT_DELIVERED: the C7 row below).
        expect([turnRows.has(`${press.turn_id}:claim`), turnRows.has(String(press.turn_id))]).toEqual([true, false]);
        const callsBefore = calls.length;
        const again = await post(press);
        expect(again.statusCode, again.body).toBe(409);
        expect(again.json()).toMatchObject({ durability: 'unknown', error: OUTCOME_UNKNOWN });
        expect((again.json() as Json).receipts).toEqual([expect.objectContaining({ version_id: 'v_1', mutation_id: 'm_1', authorised_by: 'person' })]);
        expect([calls.length, registered.length, figure('oven_price')], 'nothing run or written again').toEqual([callsBefore, 1, 2500]);
      });
    });

    it('C7: a resend while the turn still runs (the UI’s stillFinishing re-send): a first draft that has saved answers 409 TURN_OUTCOME_UNKNOWN with the draft’s own receipt (Olumi’s), sent exactly or as the chipless retry; a typed turn that has saved nothing answers 409 with none, though the model has a version', async () => {
      await withShortClaimWait(async () => {
        SCENARIO = randomUUID(); persisted = null;
        canonicalDraft = JSON.stringify(bakery());
        let release!: () => void;
        // The draft's reply call is held: the draft is saved and the turn still runs.
        holdProvider = new Promise<void>((resolve) => { release = resolve; });
        const turnId = randomUUID();
        const draft = typed(BAKERY_BRIEF, turnId);
        await vi.waitFor(() => expect([registered.length, holdProvider]).toEqual([1, undefined]));
        const exact = await typed(BAKERY_BRIEF, turnId);
        const retry = await post({ turn_id: turnId, message: BAKERY_BRIEF, source: 'retry' });
        for (const r of [exact, retry]) {
          expect(r.statusCode, r.body).toBe(409);
          expect(r.json()).toMatchObject({ durability: 'unknown', error: OUTCOME_UNKNOWN });
          expect((r.json() as Json).receipts).toEqual([expect.objectContaining({ version_id: 'v_1', mutation_id: 'm_1', authorised_by: 'olumi',
            source_turn_id: registrationTurnId(SCENARIO, programOperationId(SCENARIO, `turn:${turnId}`)) })]);
        }
        release();
        expect((await draft).statusCode).toBe(200);
        // CONTRAST: a typed turn whose first call is held has saved nothing; the model's version 1 is not its save.
        holdProvider = new Promise<void>((resolve) => { release = resolve; });
        const typedId = randomUUID();
        const asked = typed('What does the model hold for the oven?', typedId);
        await vi.waitFor(() => expect(holdProvider).toBeUndefined());
        const resend = await typed('What does the model hold for the oven?', typedId);
        expect(resend.statusCode, resend.body).toBe(409);
        expect(resend.json()).toMatchObject({ durability: 'unknown', receipts: [], error: OUTCOME_UNKNOWN });
        release();
        expect((await asked).statusCode).toBe(200);
        expect(registered, 'each resend wrote nothing').toHaveLength(1);
      });
    });
  });

  describe('DL 93d79c3e (marketing on 05745055): a card press applies THAT card, whatever id the AI sends', () => {
    /** A second card on the same item, held beside the first: their later answer. */
    const LATER = 'Actually it would be £2,700.';
    const proposeLater = async (): Promise<string> => {
      const first = preparedId;
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'propB', args: answer(2700, '£2,700') }], [{ type: 'message', text: 'I prepared that change too.' }]];
      const held = (((await typed(LATER)).json() as Json).cards as Json[]).map((c) => String(c.proposal_id));
      const idB = held.find((id) => id !== first)!;
      expect(held, 'both cards are held').toEqual(expect.arrayContaining([first, idB]));
      preparedId = first;
      return idB;
    };
    it('the AI sends an empty id on the press: the pressed card is applied, once, with the person\'s receipt; nothing is left paused', async () => {
      const press = await propose();
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply', args: { proposal_id: '' } }], [{ type: 'message', text: 'Saved.' }]];
      const r = await post(press);
      expect(r.statusCode, r.body).toBe(200);
      const a = r.json() as Json;
      expect(registered, JSON.stringify(a._agent)).toHaveLength(1);
      expect(figure('oven_price')).toBe(2500);
      expect(a.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
      expect(a.cards).toEqual([]);
      expect(a.paused).toBeNull();
      expect(pausedRun).toBeNull();
    });
    it('Codex r1 on #3695: two held cards; the AI applies the OTHER one on the press of the first: the pressed card is the one applied', async () => {
      const pressA = await propose();
      const idB = await proposeLater();
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply', args: { proposal_id: idB } }], [{ type: 'message', text: 'Saved.' }]];
      const r = await post(pressA);
      expect(r.statusCode, r.body).toBe(200);
      expect(registered).toHaveLength(1);
      expect(figure('oven_price'), 'A, the pressed card, never B').toBe(2500);
    });

    it('a pause the AI left on an empty id never keeps the held card from its press: none is kept now, and an older one does not block the re-press', async () => {
      const press = await propose();
      // A typed turn on which the AI applied with an empty id: its call names no card this scenario holds, so no pause is kept.
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'stray', args: { proposal_id: '' } }], [{ type: 'message', text: 'Nothing changed yet.' }]];
      expect((await typed('Go ahead with it.')).statusCode).toBe(200);
      expect(pausedRun, 'no pause on no card').toBeNull();
      // An older row, saved before the writer refused it (scenario 55bc5049 holds one): a real pause whose card id is ''.
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'stray2' }]];
      expect((await typed('Go ahead with it.')).statusCode).toBe(200);
      expect(pausedRun, 'control: a pause on the held card is kept').toMatchObject({ proposal_id: preparedId });
      pausedRun = { ...pausedRun, proposal_id: '' };
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply', args: { proposal_id: '' } }], [{ type: 'message', text: 'Saved.' }]];
      const r = await post(press);
      expect(r.statusCode, r.body).toBe(200);
      expect(registered).toHaveLength(1);
      expect(figure('oven_price')).toBe(2500);
      expect((r.json() as Json).receipts).toEqual([expect.objectContaining({ authorised_by: 'person' })]);
    });

    it('STEP 0 (served 25 Oct 08:39Z): after the press applies the card, the AI applies again with an empty id: no pause is kept, the reply is paused null with the AI\'s own words, and the UI reads it', async () => {
      const press = await propose();
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }],
        [{ type: 'function_call', name: 'apply_change', call_id: 'again', args: { proposal_id: '' } }], [{ type: 'message', text: 'Saved: the oven costs £2,500.' }]];
      const a = (await post(press)).json() as Json;
      expect(pausedRun, JSON.stringify(a._agent)).toBeNull();
      expect(a.paused).toBeNull();
      expect(a.assistant_text).toBe('Saved: the oven costs £2,500.');
      expect(UI_CORE_TURN.safeParse(a).success, JSON.stringify(a.paused)).toBe(true);
      expect(registered, 'the pressed card, applied once').toHaveLength(1);
      expect(a.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
      expect(JSON.stringify(calls.at(-1)?.input), 'the AI is told that call changed nothing').toContain(PAUSE_NO_CARD);
    });
    it('measure RL mrr-r3 (25 Oct): after the press applies the card, the AI applies again TWICE with no card: each stray call is refused, the reply is the AI\'s own words, never an unfinished run read as empty', async () => {
      const press = await propose();
      const warn = vi.spyOn(console, 'warn');
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }],
        [{ type: 'function_call', name: 'apply_change', call_id: 'again', args: { proposal_id: '' } }],
        [{ type: 'function_call', name: 'apply_change', call_id: 'again2', args: { proposal_id: '' } }], [{ type: 'message', text: 'Saved: the oven costs £2,500.' }]];
      const r = await post(press);
      const finalOutputRead = warn.mock.calls.some((c) => String(c[0]).includes('Accessed finalOutput before agent run is completed'));
      warn.mockRestore();
      expect(r.statusCode, r.body).toBe(200);
      const a = r.json() as Json;
      expect(a.error, JSON.stringify(a._agent)).toBeNull();
      expect(a.assistant_text).toBe('Saved: the oven costs £2,500.');
      expect(finalOutputRead, 'no unfinished run is read as the reply').toBe(false);
      expect(a.paused).toBeNull();
      expect(pausedRun).toBeNull();
      expect(registered, 'the pressed card, applied once').toHaveLength(1);
      expect((a.model as Json).scenario_revision, 'the reply reads back the saved model').toBe(computeGraphIdentityHash(persisted as never)!.value);
      // The earlier apply's save stays this turn's: its receipt, and nothing on the turn says nothing was saved.
      expect(a.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
      expect(JSON.stringify({ text: a.assistant_text, error: a.error })).not.toMatch(/nothing (?:was |has been )?(?:saved|changed)/i);
      // Both stray calls were told they changed nothing (each answer goes to the provider once, on the call after it).
      expect(calls.map((c) => JSON.stringify(c.input)).join('').split(PAUSE_NO_CARD).length - 1).toBe(2);
    });
    it('Codex on #3758: A saves, then an empty stray, then a stray naming the other held card B: every refusal the AI reads speaks of its own call, never "nothing was changed" this turn; A\'s receipt stays', async () => {
      const pressA = await propose();
      const idB = await proposeLater();
      calls.length = 0;
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }],
        [{ type: 'function_call', name: 'apply_change', call_id: 'stray', args: { proposal_id: '' } }],
        [{ type: 'function_call', name: 'apply_change', call_id: 'strayB', args: { proposal_id: idB } }], [{ type: 'message', text: 'Saved: the oven costs £2,500.' }]];
      const a = (await post(pressA)).json() as Json;
      expect(a.assistant_text).toBe('Saved: the oven costs £2,500.');
      expect(registered, 'A applied once, B never').toHaveLength(1);
      expect(figure('oven_price')).toBe(2500);
      expect(a.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
      // Every tool answer the AI read this turn, the two refusals included: each about its own call, none about the turn.
      const answers = calls.flatMap((c) => ((c.input ?? []) as Json[]).filter((i) => i.type === 'function_call_output').map((i) => JSON.stringify(i.output)));
      expect(answers.filter((t) => t.includes('Not applied'))).toHaveLength(2);
      for (const t of answers) expect(t).not.toMatch(/nothing was changed|nothing (?:has been |was )?saved|nothing changed\b/i);
    });
    it('Codex on #3758 (sibling): A applied, then the AI calls propose_change on the same press: the blocked call\'s answer speaks of that call only; A\'s receipt stays', async () => {
      const pressA = await propose();
      calls.length = 0;
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }],
        [{ type: 'function_call', name: 'propose_change', call_id: 'blocked', args: CHANGE }], [{ type: 'message', text: 'Saved: the oven costs £2,500.' }]];
      const a = (await post(pressA)).json() as Json;
      expect(a.assistant_text).toBe('Saved: the oven costs £2,500.');
      expect(registered, 'A applied once, nothing proposed').toHaveLength(1);
      expect(a.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
      const answers = calls.flatMap((c) => ((c.input ?? []) as Json[]).filter((i) => i.type === 'function_call_output').map((i) => JSON.stringify(i.output)));
      const blocked = answers.filter((t) => t.includes('withheld_on_chip_turn'));
      expect(blocked).toHaveLength(1);
      expect(blocked[0]).toContain('propose_change is not available on this turn, so this call changed and ran nothing.');
      for (const t of answers) expect(t).not.toMatch(/nothing was changed|nothing (?:has been |was )?saved|nothing changed\b/i);
    });
    it('BOUNDED: a third stray apply is not resumed again; the turn ends as an unfinished turn does (REPLY_INCOMPLETE), never by reading the unfinished run', async () => {
      const press = await propose();
      const warn = vi.spyOn(console, 'warn');
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }],
        ...['s1', 's2', 's3'].map((id) => [{ type: 'function_call', name: 'apply_change', call_id: id, args: { proposal_id: '' } }]), [{ type: 'message', text: 'never asked for' }]];
      calls.length = 0;
      const a = (await post(press)).json() as Json;
      const finalOutputRead = warn.mock.calls.some((c) => String(c[0]).includes('Accessed finalOutput before agent run is completed'));
      warn.mockRestore();
      // An unfinished turn after a save: the save is kept and said so (nothing_saved false), with its receipt; never "nothing saved".
      expect(a.error).toMatchObject({ code: 'REPLY_INCOMPLETE', nothing_saved: false });
      expect(a.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'person' })]);
      expect(JSON.stringify({ text: a.assistant_text, error: a.error })).not.toMatch(/nothing (?:was |has been )?(?:saved|changed)/i);
      expect(finalOutputRead).toBe(false);
      // The press's call, its approval's resume, then the two refusals' resumes: the third stray is not answered by a fifth call.
      expect(calls).toHaveLength(4);
      expect(registered, 'the pressed card, applied once').toHaveLength(1);
    });
    it('KEPT: a typed turn that applies a card the scenario holds still pauses on that card, as before, and the UI reads it', async () => {
      await propose();
      outputs = [[{ type: 'message', text: 'Press its card to save it.' }, { type: 'function_call', name: 'apply_change', call_id: 'held' }]];
      const a = (await typed('Go ahead with it.')).json() as Json;
      expect(pausedRun, JSON.stringify(a._agent)).toMatchObject({ proposal_id: preparedId, tool: 'apply_change' });
      expect(a.paused).toEqual({ proposal_id: preparedId });
      expect(a.assistant_text).toBe('Press its card to save it.');
      expect(UI_CORE_TURN.safeParse(a).success).toBe(true);
      expect(registered, 'a pause applies nothing').toHaveLength(0);
    });
    it('an id that is not empty but names no card the scenario holds is refused the same way: no pause, paused null, the AI\'s own words', async () => {
      await propose();
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'unknown', args: { proposal_id: `prop_${'f'.repeat(32)}` } }],
        [{ type: 'message', text: 'That change is not waiting for approval, so nothing changed.' }]];
      const a = (await typed('Go ahead with it.')).json() as Json;
      expect(pausedRun, JSON.stringify(a._agent)).toBeNull();
      expect(a.paused).toBeNull();
      expect(a.assistant_text).toBe('That change is not waiting for approval, so nothing changed.');
      expect(UI_CORE_TURN.safeParse(a).success).toBe(true);
      expect(JSON.stringify(calls.at(-1)?.input)).toContain(PAUSE_NO_CARD);
      expect(registered).toHaveLength(0);
    });
  });

  describe('Codex r1 on #3650: a canvas edit claims its turn and takes the slot BEFORE it saves', () => {
    const afterTool = (body: Json): boolean => Array.isArray(body.input) && (body.input as Json[]).some((i) => i.type === 'function_call_output');
    /** A card, then its approval held mid-turn: committed (one register), its reply not yet written. */
    const approvalHeldAfterCommit = async () => {
      const press = await propose();
      let release!: () => void;
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      holdWhen = afterTool;
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
      const approval = post(press);
      await vi.waitFor(() => expect(registered).toHaveLength(1));
      return { approval, pressId: String(press.turn_id), release };
    };

    it('an edit sent under the turn id an approval is answering is refused, and never saved: one write for that turn id', async () => {
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
      expect(figure('base_sales')).toBe(300);
    });

    it('an edit under its own turn id waits for the running turn, then runs: never interleaved with it', async () => {
      const { approval, release } = await approvalHeldAfterCommit();
      const edit = canvasEdit(randomUUID());
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(registered, 'nothing more is saved while the approval holds the scenario').toHaveLength(1);
      release();
      const [a, e] = await Promise.all([approval, edit]);
      expect([a.statusCode, e.statusCode]).toEqual([200, 200]);
      expect(registered).toHaveLength(2);
      expect([figure('oven_price'), figure('base_sales')], 'the edit saved on what the approval saved').toEqual([2500, 320]);
    });

    it('the same edit resent replays it: no second change', async () => {
      const turnId = randomUUID();
      expect((await canvasEdit(turnId)).statusCode).toBe(200);
      const again = await canvasEdit(turnId);
      expect(again.statusCode, again.body).toBe(200);
      expect((again.json() as Json).durability).toBe('replayed');
      // C7: the resend says the save it found, with that version's receipt (the first send's own operation).
      expect((again.json() as Json).receipts).toMatchObject([{ version_id: 'v_1', version: 1, authorised_by: 'person',
        source_turn_id: registrationTurnId(SCENARIO, programOperationId(SCENARIO, `card:${turnId}`)) }]);
      // CONTRAST: a different edit under that turn id is refused, and never saved.
      const other = await canvasEdit(turnId, 330);
      expect(other.statusCode).toBe(409);
      expect(registered).toHaveLength(1);
      expect(figure('base_sales')).toBe(320);
    });

    it('🔴 C7: an edit refused on its first send and resent is never answered "saved": nothing was written', async () => {
      const turnId = randomUUID();
      const notAFigure = () => post({ kind: 'system_event', turn_id: turnId, event: { kind: 'factor_value_edit', target_id: 'not_in_this_model', raw_value: 1 } });
      // Another edit's save is already in the history, so only this edit's own operation can answer its resend.
      expect((await canvasEdit(randomUUID())).statusCode).toBe(200);
      const first = await notAFigure();
      expect(first.statusCode, first.body).toBe(409);
      expect((first.json() as Json).error).toMatchObject({ code: 'CANVAS_EDIT_REFUSED', nothing_saved: true });
      const again = await notAFigure();
      expect(again.statusCode, again.body).toBe(503);
      expect(again.json() as Json).toMatchObject({ durability: 'unknown', receipts: [],
        error: { code: 'CANVAS_EDIT_REFUSED', nothing_saved: false }, model_program: { turn: 'card_edit', saved: false } });
      expect(registered).toHaveLength(1);
    });
  });

  it('Codex r1 on #3650: a reply whose words equal a host failure sentence is the AI’s reply, recorded and replayed byte for byte', async () => {
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
    const first = (await typed('What does the model hold for the oven today?', turnId)).json() as Json;
    expect(calls).toHaveLength(1);
    const again = await typed('What does the model hold for the oven today?', turnId);
    expect(again.statusCode, again.body).toBe(200);
    const j = again.json() as Json;
    expect(j.durability).toBe('replayed');
    expect(j.assistant_text).toBe(first.assistant_text);
    expect(calls, 'no second provider call').toHaveLength(1);
    expect(registered).toHaveLength(0);
    // CONTRAST (C7): a turn that saved nothing replays with no receipt.
    expect(j.receipts).toEqual([]);
    expect(storedRuns()).toBe(1);
    // CONTRAST: the same id with different words is refused, and nothing runs.
    const reused = await typed('A different question.', turnId);
    expect(reused.statusCode).toBe(409);
    expect((reused.json() as Json).error).toMatchObject({ code: 'TURN_ID_REUSED', retry_safe: false, nothing_saved: true });
    expect(calls).toHaveLength(1);
  });

  /** The tools a call may use: those its `allowed_tools` restriction names (all of them when it names none). */
  const allowedOf = (c: Json): string[] => (c.tool_choice?.type === 'allowed_tools' ? (c.tool_choice.tools as Json[]).map((t) => String(t.name))
    : ((c.tools ?? []) as Json[]).map((t) => String(t.name)));

  it('T1 (Paul 26 Oct): a program Run press makes no model call for its Run; the AI writes the reply, with no tool that drafts, proposes, applies or runs; resent, it replays with no second Run and no second call', async () => {
    const press = { turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } };
    outputs = [[{ type: 'message', text: 'Each option, by the Run.' }]];
    const first = await post(press);
    expect(first.statusCode, first.body).toBe(200);
    const stored = storedRuns();
    const again = (await post(press)).json() as Json;
    expect(again.durability).toBe('replayed');
    expect(storedRuns()).toBe(stored);
    // ONE call: the reply. The Run is the host's own; the replay makes none.
    expect(calls).toHaveLength(1);
    expect((first.json() as Json).assistant_text).toBe('Each option, by the Run.');
    for (const writer of ['build_model_from_brief', 'propose_change', 'apply_change', 'run_analysis']) expect(allowedOf(calls[0]!), writer).not.toContain(writer);
    expect(allowedOf(calls[0]!), 'CONTRAST: the reply may still read the model').toContain('read_canonical_context');
    // F7: the replay is in the live reply's program shape: the program's own view, and today's stored Run named as a program
    // names it (the Run the view shows, its state from the program's own currency), never the legacy read's run.
    const live = first.json() as Json;
    const shown = (live.canonical_analysis_view as Json | null)?.run as Json | undefined;
    expect(shown?.run_id, 'the live view shows a stored Run').toEqual(expect.any(String));
    expect(again.canonical_analysis_view).toEqual(live.canonical_analysis_view);
    expect(again.run).toMatchObject({ run_id: shown!.run_id, run_key: shown!.run_id, state: { kind: 'complete_current' } });
  });

  describe('census 27 Oct: the state block\'s header names the program\'s own newest stored Run, never the legacy read\'s "none"', () => {
    /** The header line of the state block a provider call received. */
    const headerOf = (c: Json): string => String(((c.input ?? []) as Json[]).find((i) => i.role === 'system' && String(i.content).startsWith(STATE_BLOCK_PREFIX))!.content).split('\n')[0]!;
    const newestRun = (): string => savedProgramOf(persisted)!.runs.at(-1)!.run_id;

    it('(1) a typed turn on a program with a stored Run: the header names that Run\'s id and the read\'s revision', async () => {
      const runId = newestRun();
      expect(runId).toEqual(expect.any(String));
      outputs = [[{ type: 'message', text: 'The model holds one question.' }]];
      expect((await typed('What does the model hold now?')).statusCode).toBe(200);
      expect(headerOf(calls[0]!)).toBe(`${STATE_BLOCK_PREFIX}: model revision ${hashOf(persisted)}, run ${runId}. It supersedes every earlier state block in this conversation.`);
    });

    it('(2) a Run press\'s reply call: the header names the fresh program revision and its newest stored Run, never "revision none, run none"', async () => {
      outputs = [[{ type: 'message', text: 'Each option, by the Run.' }]];
      const ran = await post({ turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } });
      expect(ran.statusCode, ran.body).toBe(200);
      expect(calls).toHaveLength(1);
      expect(headerOf(calls[0]!)).toBe(`${STATE_BLOCK_PREFIX}: model revision ${hashOf(persisted)}, run ${newestRun()}. It supersedes every earlier state block in this conversation.`);
    });

    it('CONTRAST: a program with no stored Run still says "run none", with its revision', async () => {
      const bare = JSON.parse(JSON.stringify(persisted)) as Json;
      bare.living_model.runs = [];
      persisted = bare;
      expect(savedProgramOf(persisted)!.runs).toHaveLength(0);
      outputs = [[{ type: 'message', text: 'No Run yet.' }]];
      expect((await typed('What does the model hold now?')).statusCode).toBe(200);
      expect(headerOf(calls[0]!)).toBe(`${STATE_BLOCK_PREFIX}: model revision ${hashOf(persisted)}, run none. It supersedes every earlier state block in this conversation.`);
    });
  });

  it('T1 + C12: a Run press\'s reply is the AI\'s own, in the scenario\'s Conversation, so the next typed turn continues it; a reply that cannot be written is the turn\'s error, with nothing added in the host\'s words', async () => {
    const press = () => post({ turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } });
    outputs = [[{ type: 'message', text: 'Here is what the model holds.' }]];
    expect((await typed('What does the model hold now?')).statusCode).toBe(200);
    const conversation = String(calls.at(-1)!.conversation);
    expect(conversation).toMatch(/^conv_/);
    calls = [];
    outputs = [[{ type: 'message', text: 'The Run, in my words.' }]];
    const ran = await press();
    expect(ran.statusCode, ran.body).toBe(200);
    // The AI's reply, in that Conversation: nothing added beside it.
    expect([calls.length, calls[0]!.conversation, (ran.json() as Json).assistant_text]).toEqual([1, conversation, 'The Run, in my words.']);
    expect(conversationItems).toEqual([]);
    // CONTRAST (Paul 26 Oct: "if the AI reply fails, show an error instead"): the reply call refused, the turn is that error,
    // no words of the host's stand in for it, and nothing is added to the Conversation.
    calls = [];
    outputs = [[{ type: 'refuse' }]];
    const failed = await press();
    expect(failed.statusCode, failed.body).toBe(502);
    expect((failed.json() as Json).error).toMatchObject({ code: 'UPSTREAM_ERROR', retry_safe: true, nothing_saved: true });
    expect((failed.json() as Json).assistant_text).toBe('');
    expect(conversationItems).toEqual([]);
    // The next typed turn continues that Conversation.
    outputs = [[{ type: 'message', text: 'That Run is the one I described.' }]];
    expect((await typed('What did that Run say?')).statusCode).toBe(200);
    expect(calls.at(-1)!.conversation).toBe(conversation);
  });

  it('C12 (alpha spec §7, 27 Oct): a Run press while a card waits: the host\'s reply joins the scenario\'s Conversation, after the waiting call is answered as not applied; the card stays held, unchanged, and its own press still applies it once', async () => {
    // A Run stored by an earlier engine, so the press makes a new Run, whose save is refused below: the reply is the host's own words.
    const engine = String((persisted!.living_model.runs as Json[]).at(-1)!.receipt.versions.engine);
    persisted = JSON.parse(JSON.stringify(persisted).split(engine).join('mp-a04e2cebf944')) as Json;
    const approve = await propose();
    outputs = [[{ type: 'message', text: 'Press its card to save it.' }, { type: 'function_call', name: 'apply_change', call_id: 'held' }]];
    const waiting = (await typed('Go ahead with it.')).json() as Json;
    expect(pausedRun, 'the SDK run waits on the card').toMatchObject({ proposal_id: preparedId, call_id: 'held', tool: 'apply_change' });
    const conversation = String(calls.at(-1)!.conversation);
    const card = (waiting.cards as Json[]).find((c) => c.proposal_id === preparedId)!;
    calls = []; conversationItems = [];
    registerRefusal = { schema: 'error.v1', code: 'BAD_INPUT', message: 'Refused.', details: {} };
    const ran = await post({ turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } });
    expect(ran.statusCode, ran.body).toBe(200);
    expect((ran.json() as Json).assistant_text).toBe('The model could not be saved (refused). Nothing was changed.');
    expect(calls, 'the host\'s words: no model call').toHaveLength(0);
    // In that Conversation, in ONE request: the waiting call answered as not applied, then the press and the reply as shown.
    expect(conversationItems).toEqual([{ conversation, items: [
      { type: 'function_call_output', call_id: 'held', output: PAUSE_SUPERSEDED },
      { type: 'message', role: 'user', content: 'Run the analysis' },
      { type: 'message', role: 'assistant', content: 'The model could not be saved (refused). Nothing was changed.' },
    ] }]);
    // The card stays held, byte for byte; only the SDK's waiting run was answered.
    expect((ran.json() as Json).cards).toEqual([card]);
    expect(pausedRun).toBeNull();
    // The next typed turn continues that Conversation, and the waiting call is never answered a second time.
    calls = []; conversationItems = []; registerRefusal = null;
    outputs = [[{ type: 'message', text: 'That Run could not be saved.' }]];
    expect((await typed('What did that Run say?')).statusCode).toBe(200);
    expect(calls.map((c) => c.conversation)).toEqual([conversation]);
    expect(conversationItems).toEqual([]);
    // The card's own press still applies it, once.
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
    expect((await post(approve)).statusCode).toBe(200);
    expect(figure('oven_price')).toBe(2500);
    expect(registered).toHaveLength(1);
  });

  describe('C7 (27 Oct): a change saved before its reply failed is said as saved, with its own receipt; a failure before the write says nothing was saved', () => {
    const SAVED_LOST = 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.';
    /** A receipt by its identity: the saved version, its mutation and who authorised it. */
    const idsOf = (receipts: Json[]) => receipts.map((x) => [x.version_id, x.mutation_id, x.authorised_by]);
    const draft = () => app.inject({ method: 'POST', url: '/agent/v1/core-turn',
      payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message: BAKERY_BRIEF, source: 'composer' } });

    it('a press whose change commits and whose reply then fails: the 502 says the change was saved and carries its receipt, the person’s; one revision', async () => {
      const press = await propose();
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'refuse' }]];
      const r = await post(press);
      expect(r.statusCode, r.body).toBe(502);
      const j = r.json() as Json;
      expect(j.error).toEqual({ code: 'UPSTREAM_ERROR', message: SAVED_LOST, retry_safe: false, nothing_saved: false });
      expect(registered.map((b) => b.operation_id), 'the one write is this card’s own operation').toEqual([programOperationId(SCENARIO, `proposal:${preparedId}`)]);
      expect(idsOf(j.receipts)).toEqual([['v_1', 'm_1', 'person']]);
      expect(UI_CORE_TURN.safeParse(j).success).toBe(true);
      expect(figure('oven_price')).toBe(2500);
    });

    it('NEGATIVE: the same press failing before its change is written says nothing was saved, carries no receipt, and may be sent again', async () => {
      const press = await propose();
      outputs = [[{ type: 'refuse' }]];
      const r = await post(press);
      expect(r.statusCode, r.body).toBe(502);
      const j = r.json() as Json;
      expect(j.error).toEqual({ code: 'UPSTREAM_ERROR', message: 'The reply didn’t arrive. Any changes already saved are kept. Send a new message to continue.',
        retry_safe: true, nothing_saved: true });
      expect(j.receipts).toEqual([]);
      expect([registered.length, figure('oven_price')]).toEqual([0, null]);
    });

    it('a first draft saved, then its reply fails, or the read of it for the reply fails: each failure carries the draft’s receipt, Olumi’s, never "nothing saved"', async () => {
      persisted = null;
      canonicalDraft = JSON.stringify(bakery());
      outputs = [[{ type: 'refuse' }]];
      const lost = await draft();
      expect(lost.statusCode, lost.body).toBe(502);
      expect((lost.json() as Json).error).toEqual({ code: 'UPSTREAM_ERROR', message: SAVED_LOST, retry_safe: false, nothing_saved: false });
      expect(idsOf((lost.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      // A new scenario whose draft saves, then the model cannot be read back for the reply.
      SCENARIO = randomUUID(); persisted = null; registered.length = 0;
      program.read.mockResolvedValueOnce({ status: 'unavailable', reason: 'model_read_failed', write: 'none' });
      const unread = await draft();
      expect(unread.statusCode, unread.body).toBe(503);
      expect((unread.json() as Json).error).toEqual({ code: 'MODEL_READ_FAILED', message: 'Your model could not be read just now.', retry_safe: false, nothing_saved: false });
      expect(idsOf((unread.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect(registered).toHaveLength(1);
    });

    it('C7: a first draft saved before its reply failed, resent under the same turn id, replays with that draft’s own receipt (Olumi’s), no write', async () => {
      // A new scenario with no model yet, so the first send drafts (as the row above does for its second case).
      SCENARIO = randomUUID(); persisted = null; registered.length = 0;
      canonicalDraft = JSON.stringify(bakery());
      outputs = [[{ type: 'refuse' }]];
      const turnId = randomUUID();
      const send = () => app.inject({ method: 'POST', url: '/agent/v1/core-turn',
        payload: { kind: 'message', scenario_id: SCENARIO, turn_id: turnId, message: BAKERY_BRIEF, source: 'composer' } });
      const lost = await send();
      expect(lost.statusCode, lost.body).toBe(502);
      const again = await send();
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json()).toMatchObject({ durability: 'replayed', error: { code: 'REPLY_NOT_DELIVERED', nothing_saved: false } });
      expect(idsOf((again.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect((again.json() as Json).receipts[0].source_turn_id).toBe(registrationTurnId(SCENARIO, programOperationId(SCENARIO, `turn:${turnId}`)));
      expect(registered).toHaveLength(1);
    });

    it('C7: a Run press whose new Run saved replays the person’s receipt, resent with its chip and as the UI’s chipless retry (its recorded hash is tagged a Run press); neither calls or writes', async () => {
      // A Run stored by an earlier engine, so the press makes and saves a new Run (under its turn: operation).
      const engine = String((persisted!.living_model.runs as Json[]).at(-1)!.receipt.versions.engine);
      persisted = JSON.parse(JSON.stringify(persisted).split(engine).join('mp-a04e2cebf944')) as Json;
      const press = { turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } };
      outputs = [[{ type: 'message', text: 'The new Run, in my words.' }]];
      const ran = await post(press);
      expect(ran.statusCode, ran.body).toBe(200);
      expect(idsOf((ran.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'person']]);
      const callsBefore = calls.length;
      const again = await post(press);
      expect(again.json()).toMatchObject({ durability: 'replayed' });
      expect(idsOf((again.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'person']]);
      const retry = await post({ turn_id: press.turn_id, message: press.message, source: 'retry' });
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json()).toMatchObject({ durability: 'replayed' });
      expect(idsOf((retry.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'person']]);
      expect([calls.length, registered.length], 'replays call no model and write nothing').toEqual([callsBefore, 1]);
    });

    it('C7 across the tag change: a Run press recorded before RUN_PRESS_HASH_TAG (untagged), resent exactly, replays with no call or write; other words under that turn id stay refused', async () => {
      const engine = String((persisted!.living_model.runs as Json[]).at(-1)!.receipt.versions.engine);
      persisted = JSON.parse(JSON.stringify(persisted).split(engine).join('mp-a04e2cebf944')) as Json;
      const press = { turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } };
      outputs = [[{ type: 'message', text: 'The new Run, in my words.' }]];
      expect((await post(press)).statusCode).toBe(200);
      // As a deploy before the tag recorded it: the same row, its #chip: suffix untagged.
      const row = turnRows.get(press.turn_id)!;
      expect(String(row.request_hash)).toContain('#chip:run:');
      row.request_hash = String(row.request_hash).replace('#chip:run:', '#chip:');
      const callsBefore = calls.length;
      const again = await post(press);
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json()).toMatchObject({ durability: 'replayed' });
      expect(idsOf((again.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'person']]);
      expect([calls.length, registered.length], 'no call, no write').toEqual([callsBefore, 1]);
      // CONTRAST: other words under that turn id are another request.
      const other = await post({ ...press, message: 'Run it again with fewer draws' });
      expect(other.statusCode).toBe(409);
      expect((other.json() as Json).error).toMatchObject({ code: 'TURN_ID_REUSED' });
      expect(registered).toHaveLength(1);
    });

    it('CONTRAST (C7): a chipless retry of a recorded chip press whose hash carries no Run tag (recorded before it) claims no save: unproven stays unknown', async () => {
      const { recordedRunPress, recordedWithChip } = await import('../../orchestrator-v5/core-route/turn-request.js');
      const untagged = 'agent_turn:abc#chip:0123456789abcdef0123456789abcdef';
      expect([recordedWithChip(untagged), recordedRunPress(untagged)]).toEqual([true, false]);
      expect(recordedRunPress('agent_turn:abc#chip:run:0123456789abcdef0123456789abcdef#outcome:reply_lost_saved')).toBe(true);
      expect(recordedRunPress('agent_turn:abc')).toBe(false);
    });

    it('C7: a first draft saved before its reply failed, resent as the UI’s chipless retry, replays with that draft’s own receipt (a recorded typed turn that saved was its draft)', async () => {
      SCENARIO = randomUUID(); persisted = null; registered.length = 0;
      canonicalDraft = JSON.stringify(bakery());
      outputs = [[{ type: 'refuse' }]];
      const turnId = randomUUID();
      const lost = await app.inject({ method: 'POST', url: '/agent/v1/core-turn',
        payload: { kind: 'message', scenario_id: SCENARIO, turn_id: turnId, message: BAKERY_BRIEF, source: 'composer' } });
      expect(lost.statusCode, lost.body).toBe(502);
      const retry = await app.inject({ method: 'POST', url: '/agent/v1/core-turn',
        payload: { kind: 'message', scenario_id: SCENARIO, turn_id: turnId, message: BAKERY_BRIEF, source: 'retry' } });
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json()).toMatchObject({ durability: 'replayed' });
      expect(idsOf((retry.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect(registered).toHaveLength(1);
    });

    it('after that saved press, the same press resent replays its outcome with no call and no write, and the card pressed again finds its own saved receipt: never a second revision', async () => {
      const press = await propose();
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'refuse' }]];
      expect((await post(press)).statusCode).toBe(502);
      const runs = storedRuns();
      const callsBefore = calls.length;
      const again = await post(press);
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json()).toMatchObject({ durability: 'replayed', error: { code: 'REPLY_NOT_DELIVERED', message: SAVED_LOST, retry_safe: false, nothing_saved: false } });
      expect(calls.length, 'a replay calls no model').toBe(callsBefore);
      // C7: the replay says the save it kept with that version's receipt, the press's own (proposal:<id> operation), as the
      // first answer did; the UI then reads it as saved, never unknown.
      expect(idsOf((again.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'person']]);
      // The card pressed again, as a new send: its apply looks up this operation's own version first, so it finds that save.
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_again' }], [{ type: 'message', text: 'That change was already saved.' }]];
      const repress = await post({ ...press, turn_id: randomUUID() });
      expect(repress.statusCode, repress.body).toBe(200);
      const r = repress.json() as Json;
      expect(r.receipts).toEqual([{ version: 1, version_id: 'v_1', mutation_id: 'm_1',
        source_turn_id: registrationTurnId(SCENARIO, programOperationId(SCENARIO, `proposal:${preparedId}`)), authorised_by: 'person' }]);
      expect(r.error).toBeNull();
      expect([registered.length, storedRuns(), figure('oven_price')]).toEqual([1, runs, 2500]);
    });
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
    // The first turn's model moves meanwhile: a distinctive label, held in the program only.
    const moved = bakery();
    moved.quantities = moved.quantities.map((x) => (x.id === 'base_sales' ? { ...x, label: 'loaves Ana counts each week' } : x));
    persisted = programGraph(moved);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(calls).toHaveLength(2);
    const stateBlock = (b: Json): string => ((b.input ?? []) as Json[]).filter((i) => i.role === 'system').map((i) => String(i.content)).join('\n');
    expect(stateBlock(calls[0]!), 'CONTROL: the first turn read the model before the move').not.toContain('loaves Ana counts each week');
    expect(stateBlock(calls[1]!), 'the waiting turn reads the model as it now stands').toContain('loaves Ana counts each week');
  });

  it('F1b: a saved scenario that is not a model program (a Living Model, or a graph with neither) is refused with a typed 409 on every kind of turn: no model call, nothing saved, the claim released', async () => {
    for (const graph of [postimage(KNOWN_ANSWER), mapLivingModel(KNOWN_ANSWER).graph as Json]) {
      SCENARIO = randomUUID(); turnRows.clear(); persisted = graph; calls = [];
      const turnId = randomUUID();
      const r = await typed('What does the model hold?', turnId);
      expect(r.statusCode).toBe(409);
      const j = r.json() as Json;
      expect(Object.keys(j)).toEqual(BASE_KEYS.filter((k) => k !== '_agent'));
      expect(j.error).toMatchObject({ code: 'legacy_scenario', retry_safe: true, nothing_saved: true });
      expect(calls).toHaveLength(0);
      expect(turnRows.has(`${turnId}:claim`), 'a resend may run once the scenario is current').toBe(false);
      // A canvas edit on it is refused the same way, and saves nothing.
      const edit = await post({ kind: 'system_event', turn_id: randomUUID(), event: { kind: 'factor_value_edit', target_id: 'f', raw_value: 0.8 } });
      expect(edit.statusCode, edit.body).toBe(409);
      expect((edit.json() as Json).error).toMatchObject({ code: 'legacy_scenario', nothing_saved: true });
    }
    expect(registered).toHaveLength(0);
    // CONTRAST: a saved program runs.
    SCENARIO = randomUUID(); turnRows.clear(); persisted = programGraph();
    expect((await typed('What does the model hold?')).statusCode).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('⭐ scenario_revision is the graph read’s content_hash (identity.v1) after a core turn, and a canvas edit moves both', async () => {
    const turn = (await typed('What does the model hold for the oven today?')).json() as Json;
    const before = await freshRead();
    expect(turn.model.scenario_revision).toBe(before.content_hash);
    expect(before.content_hash).toBe(before.graph_identity_hash.value);
    const edit = await canvasEdit(randomUUID());
    expect(edit.statusCode, edit.body).toBe(200);
    const e = edit.json() as Json;
    expect(figure('base_sales')).toBe(320);
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
    expect(calls.map((c) => c.text?.format?.name ?? null), 'one canonical drafting call, then the AI\'s reply (T1)').toEqual(['canonical_model', null]);
    const ready = frames.filter((f) => f.kind === 'GRAPH_READY');
    expect(ready, JSON.stringify(frames.map((f) => f.kind))).toHaveLength(1);
    expect(ids(ready[0]!.graph)).toEqual(ids(j.model.graph));
    expect(ids(j.model.graph).length).toBeGreaterThan(0);
    expect(j.receipts).toEqual([expect.objectContaining({ version_id: 'v_1', authorised_by: 'olumi' })]);
    expect(j.model.scenario_revision).toBe((await freshRead()).content_hash);
    expect((registered[0]!.graph as Json).living_model.model_program).toBe('v1');
  });
  it('W11: a first draft the register refuses names the register\'s own code on the wire\'s tool call, the words unchanged; a refusal with no code names none', async () => {
    persisted = null;
    canonicalDraft = JSON.stringify(bakery());
    const draft = () => app.inject({ method: 'POST', url: '/agent/v1/core-turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message: BAKERY_BRIEF, source: 'composer' } });
    // The real register's answer to a program past its cap (`model-program-register.test.ts`, W11 (b)), in its own shape.
    registerRefusal = { schema: 'error.v1', code: 'BAD_INPUT', message: 'This model has too many nodes to register.', details: { code: 'GRAPH_TOO_LARGE', nodes: 162, max_nodes: 150 } };
    const r = await draft();
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()._agent.tool_calls).toEqual([{ name: 'draft_canonical_model', outcome: 'refused', refusal: 'save_refused', code: 'GRAPH_TOO_LARGE' }]);
    expect(r.json().assistant_text).toBe('The model could not be saved (refused). Nothing was changed.');
    // Nothing was saved, so no analysis is served: the candidate this turn computed never reaches the wire (AR0900 10:41, PL 10:48).
    expect(r.json().canonical_analysis_view).toBeNull();
    // Contrast: a refusal that gives no code names none.
    registerRefusal = { schema: 'error.v1', code: 'BAD_INPUT', message: 'Refused.', details: {} };
    const none = await draft();
    expect(none.statusCode, none.body).toBe(200);
    expect(none.json()._agent.tool_calls).toEqual([{ name: 'draft_canonical_model', outcome: 'refused', refusal: 'save_refused' }]);
    expect(none.json().canonical_analysis_view).toBeNull();
    expect([registered.length, persisted]).toEqual([0, null]);
  });

  it('⭐ STEP 0 (arch plan, DL 23 Oct): ONE summary log line per turn, keyed by scenario and turn, by id and code only', async () => {
    const info = vi.spyOn((await import('../../utils/telemetry.js')).log, 'info');
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: CHANGE }], [{ type: 'message', text: 'Press its card to look at that price again.' }]];
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
    for (const words of [SAID, '£2,500', 'look at that price']) expect(text).not.toContain(words);
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
    // A Challenge is a chip: it carries no consent to Run, so the program's run_analysis is withheld on it.
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'withheld', args: {} }], [{ type: 'refuse' }]];
    const failed = await challengeOn(String(((persisted as Json).nodes as Json[])[0]!.id));
    expect(failed.statusCode).not.toBe(200);
    expect(summaries().map((l) => [l.failed, l.tool_calls.map((c: Json) => [c.name, c.outcome])]))
      .toEqual([['turn_failed', [['run_analysis', 'refused']]]]);
    // The conversation cannot be read: refused before any AI call, so no line.
    store.readOpenAiConversationId.mockRejectedValueOnce(new Error('store down'));
    const unread = await typed('Anything new?');
    expect(unread.statusCode).toBe(503);
    expect(summaries()).toHaveLength(1);
    info.mockRestore();
  });

  describe('⭐ CACHING (DL 22 Oct): the provider\'s cached prefix is the same bytes on every call', () => {
    /** The standing instructions: the same on every turn of every scenario; this turn's facts and guidance follow them. */
    const STANDING = programInstructions();
    /** The turn's system items, in order: its state block, then its guidance. */
    const systemItems = (b: Json): string[] => ((b.input ?? []) as Json[]).filter((i) => i.role === 'system').map((i) => String(i.content));
    /** A card a Challenge can be grounded on: a factor of the saved program. */
    const factorId = (): string => String((((persisted as Json).nodes ?? []) as Json[]).find((n) => n.kind === 'factor')!.id);

    it('(1) ONE tool list, byte for byte, on typed, approval and Challenge calls; what a turn may call rides tool_choice', async () => {
      const press = await propose();
      const typedCalls = calls.length;
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
      expect((await post(press)).statusCode).toBe(200);
      const pressCalls = calls.length;
      outputs = [[{ type: 'message', text: 'Here is the strongest case against that figure.' }]];
      expect((await challengeOn(factorId())).statusCode).toBe(200);
      expect([typedCalls, pressCalls - typedCalls, calls.length - pressCalls], 'two calls each, then one').toEqual([2, 2, 1]);

      const lists = calls.map((b) => JSON.stringify(b.tools));
      expect(lists[0]!.length).toBeGreaterThan(2);
      expect(new Set(lists).size, 'every call sends the same tools array').toBe(1);
      // The restriction lives in tool_choice: a typed turn may call every tool; a press opens on its own tool; a Challenge is a
      // chip, so its Run stays listed and is withheld.
      expect((calls[0]!.tool_choice as Json | undefined)?.type, 'a typed turn withholds nothing').not.toBe('allowed_tools');
      expect(calls[typedCalls]!.tool_choice).toMatchObject({ type: 'function', name: 'apply_change' });
      const challenge = calls[calls.length - 1]!;
      expect((challenge.tool_choice as Json).type).toBe('allowed_tools');
      expect(((challenge.tool_choice as Json).tools as Json[]).map((t) => t.name)).not.toContain('run_analysis');
      expect((challenge.tools as Json[]).map((t) => t.name)).toContain('run_analysis');
      const items = systemItems(challenge);
      expect(items[0], 'the Challenge call carried its state block first').toContain(STATE_BLOCK_PREFIX);
      expect(items.at(-1)!.startsWith(SELECTION_NOTE_PREFIX), 'then its note, last').toBe(true);
      expect(new Set(calls.map((b) => b.instructions)), 'the standing instructions, the same bytes on every call of every turn kind')
        .toEqual(new Set([STANDING]));
    });

    it('(5) the standing instructions open every call of two different scenarios; the Challenge note follows the state block in the turn\'s input', async () => {
      outputs = [[{ type: 'message', text: 'Here is the strongest case against that figure.' }]];
      expect((await challengeOn(factorId())).statusCode).toBe(200);
      const challenged = calls[0]!;
      expect(challenged.instructions).toBe(STANDING);
      const one = systemItems(challenged);
      // prompts-v2 (29 Oct, INTEGRATION §5): this turn's facts, then the Challenge's note.
      expect(one).toEqual([expect.stringContaining(STATE_BLOCK_PREFIX), `${PROGRAM_TURN_FACTS_PREFIX}{"trigger":"continuation","reading_card":false,"held_proposals":[],"requested_challenge":true}`,
        expect.stringMatching(new RegExp(`^${SELECTION_NOTE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))]);
      expect(one[0]).toContain(TODAY_PREFIX);

      // A second scenario, another saved program: a typed turn, with no guidance but the program's own.
      const first = { scenario: SCENARIO, body: challenged };
      SCENARIO = randomUUID(); persisted = programGraph(); calls = [];
      outputs = [[{ type: 'message', text: 'Tell me more about the situation first.' }]];
      expect((await typed('We are weighing two staffing options.')).statusCode).toBe(200);
      const second = calls[0]!;
      expect(SCENARIO).not.toBe(first.scenario);
      expect(second.instructions, 'byte-equal across the two scenarios').toBe(first.body.instructions);
      expect(systemItems(second)).toEqual([expect.stringContaining(STATE_BLOCK_PREFIX), `${PROGRAM_TURN_FACTS_PREFIX}{"trigger":"continuation","reading_card":false,"held_proposals":[]}`]);
      expect(String(challenged.instructions), 'no Challenge note in the instructions').not.toContain(SELECTION_NOTE_PREFIX);

      // The prefix the provider caches (the tools, then the standing instructions) is byte-equal across the two scenarios.
      expect(JSON.stringify(second.tools)).toBe(JSON.stringify(first.body.tools));
      expect(second.prompt_cache_key).toBe(first.body.prompt_cache_key);
      expect(second.prompt_cache_key).toBe(corePromptCacheKey(String(second.model), STANDING));
      expect([second.prompt_cache_retention, first.body.prompt_cache_retention]).toEqual(['24h', '24h']);
    });

    /** Draft a saved PROGRAM scenario (the canonical drafter's first turn), then clear the calls. */
    /** A reply's change cards: every card but the first draft's reading card, which must be there too (step 2). */
    const changeCards = (j: Json): Json[] => {
      expect((j.cards as Json[]).filter((c) => c.reading === true), 'the first draft\'s reading card is carried').toHaveLength(1);
      return (j.cards as Json[]).filter((c) => c.reading !== true);
    };
    /** Drafts and saves a program; returns the reply exactly as it was sent to the person. */
    /** The calls the last `savedProgram` made: the drafter's, then the AI's reply (T1). */
    let draftCalls: Json[] = [];
    const savedProgram = async (): Promise<string> => {
      SCENARIO = randomUUID(); persisted = null; canonicalDraft = JSON.stringify(bakery()); calls.length = 0;
      const drafted = await typed(BAKERY_BRIEF);
      expect(drafted.statusCode).toBe(200);
      expect(calls[0]!.text?.format?.name).toBe('canonical_model');
      const london = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      // 29 Oct: prompts v2 (INTEGRATION §1): the fixed instructions alone, the date context the first, developer message; before
      // it the instructions ended "\n\nToday is … (Europe/London), period 0. Read the dates they state against it."
      expect(calls[0]!.instructions).toBe(DRAFTING_INSTRUCTIONS);
      expect((calls[0]!.input as Json[])[0]).toEqual({ role: 'developer', content: todayLine(london) });
      draftCalls = [...calls];
      calls.length = 0;
      return String((drafted.json() as Json).assistant_text);
    };

    it('(6) ALPHA (23 Oct) + F1b (26 Oct): a saved PROGRAM\'s turn gets the model-program instructions; a saved Living Model is refused before any call', async () => {
      // Pinned from the request bodies the provider received on this route, not from the module that builds them.
      const PROGRAM_SHA = 'd312182a6485eff690ed9cf089daa9ff46737a0f212770ea9692c8186227e467'; // 29 Oct: prompts-v2 agent-coaching.txt with the DL's C1, the program's one contract; before it 95c5eb7c. · 29 Oct 03:2xZ: assessor AR0300 boundaries; before it d29e9d87. · 29 Oct: J2, when asked Olumi proposes labelled ranged estimates; before it 36cfc7fd. · 28 Oct: names factors and waits too; before it 232ae815…. 28 Oct: Box 3 naming sentence; before it d2bc1608…. 28 Oct: C1 no-chance comparison in words (K1's sentence plus keep any consequence worked out); before it c545b8a1…. 27 Oct: round 3 (Paul approved: said once, decisive mechanism, first questions); before it 1c0f7685…. 27 Oct: round 2, the consolidation (RESULTS the single Run-reporting owner; first-model questions in drafted order; shortened reply rules); before it e1e01c5e…. 27 Oct: round 1, first-model questions lead with the premise that could change the comparison. 27 Oct: T1, each caveat once per conversation. // 26 Oct: integrated review words#7 (the "on Olumi’s reading of …" basis). // 25 Oct: alpha G10 (no threshold sentences). // 25 Oct: alpha G5 (no note_on_item sentence). // 24 Oct: issue 30, synthetic examples only (after remodel coaching)
      const sha = (c: Json) => createHash('sha256').update(String(c.instructions), 'utf8').digest('hex');
      persisted = postimage(KNOWN_ANSWER);
      outputs = [[{ type: 'message', text: 'Here is what the model holds.' }]];
      expect((await typed('What does the model hold now?')).statusCode).toBe(409);
      expect(calls).toHaveLength(0);
      await savedProgram();
      outputs = [[{ type: 'message', text: 'Tell me more about the situation first.' }]];
      expect((await typed('What does the model hold now?')).statusCode).toBe(200);
      expect(calls).toHaveLength(1);
      // Integrated review 26 Oct (words#7): the RESULTS rule, as SENT, keeps the basis the Run gives before approval (#3769); the
      // two-basis wording is gone, and the "if" rule stays once. Round 2 (27 Oct, consolidation): RESULTS says it in one sentence,
      // the Run's 'if' and unconfirmed Olumi readings preserved; the words#7 wording is gone. prompts-v2 (29 Oct): in its words.
      const sent = String(calls[0]!.instructions);
      expect(sent.split("Preserve unconfirmed Olumi readings and premises; do not call the complete result \u201con your figures\u201d when it also rests on Olumi's relationships or assumptions.")).toHaveLength(2);
      expect(sent).not.toContain('"on your figures" or "if" with Olumi');
      expect(sent).not.toContain('never drop the "if" or turn it into a forecast');
      expect(sha(calls[0]!)).toBe(PROGRAM_SHA);
      expect(String(calls[0]!.instructions)).toContain('The host prepares the first model and its automatic Run before the coaching reply.');
      expect(String(calls[0]!.instructions)).not.toContain('POLYMATH COACHING');
      // Remodel coaching (DL 24 Oct, Paul's rule): a person can always choose to remodel; Olumi coaches the restatement and
      // never starts a new scenario or redrafts this one for them. Spelled as SENT.
      // prompts-v2 (29 Oct): in agent-coaching.txt's words.
      expect(String(calls[0]!.instructions)).toContain('For a fundamental misframing, explain the possible misreading and invite a clarified brief in a new scenario; '
        + 'do not create one or replace this model automatically.');
    });

    it('issue 30 (24 Oct): nothing Olumi writes into the drafter\'s or the agent\'s call on a program holds a phrase from the test briefs; its examples are synthetic', async () => {
      // Copied from the five test briefs (hiring, marketing, capacity, MRR, funding) in the harness briefs folder. They live
      // here only, never in src. Each is a pattern: a phrase, or a figure with its unit or window ("4 % a month", "10 %",
      // "within 3 months"); "about 20" does not count a chance ("about 20% chance" is a result, not an example).
      const BRIEF_PHRASES = [
        'code quality', 'spend less', 'launch date', 'three months', 'productivity',
        'first 3 months', 'within (the first )?(3|three) months', 'conversion rate', 'feature launch', 'spend more than',
        'about 20(?! ?%)', 'tickets', 'specialist',
        'churn', 'mrr', '4 ?% (a|per) month', '10 ?%',
        'investment firms', 'angel investors', 'cold emails', 'warm connections', 'run out of money',
      ];
      // Scanned: every string the host puts in a call (instructions, schema, tool descriptions, and its own messages in the
      // input: state blocks, guidance, its written replies). Skipped: only the person's own typed messages, by identity.
      const TYPED = [BAKERY_BRIEF, 'What does the model hold now?'];
      const skipped: string[] = [];
      const hostText = (v: unknown): string[] => {
        if (typeof v === 'string') return [v];
        if (Array.isArray(v)) return v.flatMap(hostText);
        if (v === null || typeof v !== 'object') return [];
        const m = v as Json;
        if (m.role === 'user' && typeof m.content === 'string' && TYPED.includes(m.content)) { skipped.push(m.content); return []; }
        return Object.values(m).flatMap(hostText);
      };
      const found = (c: Json) => {
        const text = hostText(c).join(' ').replace(/\s+/g, ' ');
        return BRIEF_PHRASES.filter((p) => new RegExp(`(?<![\\w.])${p}(?!\\w)`, 'i').test(text));
      };
      SCENARIO = randomUUID(); persisted = null; canonicalDraft = JSON.stringify(bakery()); calls.length = 0;
      expect((await typed(BAKERY_BRIEF)).statusCode).toBe(200);
      const draftCall = calls.find((c) => c.text?.format?.name === 'canonical_model')!;
      // Contrast: the probe reads the schema's descriptions and the agent's instructions (each holds its synthetic example).
      // Round 2 (27 Oct): the preference example left the schema with its description; the title's example is a schema description too.
      expect(hostText(draftCall).join(' ')).toContain('("Second oven or wholesale?")');
      skipped.length = 0;
      expect(found(draftCall)).toEqual([]);
      expect(skipped, 'only the person\'s brief is skipped').toEqual([BAKERY_BRIEF]);
      // T1: the draft's reply is the AI's own call, which opens the Conversation with the brief: scanned the same way.
      const replyCall = calls.find((c) => c.text?.format?.name !== 'canonical_model')!;
      expect(hostText(replyCall).join(' '), 'the draft reply call carries the host\'s state block').toContain('OLUMI STATE BLOCK');
      skipped.length = 0;
      expect(found(replyCall)).toEqual([]);
      expect(skipped, 'only the person\'s brief is skipped').toEqual([BAKERY_BRIEF]);
      calls.length = 0;
      outputs = [[{ type: 'message', text: 'Here is what the model holds.' }]];
      expect((await typed('What does the model hold now?')).statusCode).toBe(200);
      expect(calls).toHaveLength(1);
      // Round 2 (27 Oct): the loose-figure example left the instructions; the first-model example's estimate is synthetic too.
      // prompts-v2 (29 Oct): the instructions hold no example; the contrast is one of their sentences.
      expect(String(calls[0]!.instructions)).toContain('Start from a credible reference class and adjust for the known context; state the basis, range and what to verify.');
      expect(calls[0]!.tools, 'the tool descriptions are scanned too').toBeDefined();
      const agentText = hostText(calls[0]!).join(' ');
      expect(agentText, 'the host\'s state block in the input is scanned').toContain('OLUMI STATE BLOCK');
      expect(agentText, 'the host\'s turn facts in the input are scanned').toContain(`${PROGRAM_TURN_FACTS_PREFIX}{"trigger":"continuation"`);
      skipped.length = 0;
      expect(found(calls[0]!)).toEqual([]);
      // The brief opened the Conversation on the draft turn (T1), so this call carries only the new message.
      expect(skipped, 'only the person\'s typed message is skipped').toEqual(['What does the model hold now?']);
    });

    it('Challenge on a PROGRAM board (served 502 on board 5715db98, 24 Oct): no first tool is forced, as its tools have no note_on_item; the note rides the turn and a reply comes back', async () => {
      // A program board: the four program tools, none forced; the Challenge note follows the state block; the AI answers in words.
      await savedProgram();
      const item = (((persisted as Json).nodes ?? []) as Json[]).find((n) => n.kind === 'factor') ?? ((persisted as Json).nodes as Json[])[0]!;
      outputs = [[{ type: 'message', text: 'The strongest case against it is that demand may not grow.' }]];
      const r = await challengeOn(String(item.id));
      expect(r.statusCode, r.body).toBe(200);
      expect((r.json() as Json).assistant_text).toBe('The strongest case against it is that demand may not grow.');
      expect(calls).toHaveLength(1);
      expect((calls[0]!.tools as Json[]).map((t) => t.name), 'the program tools have no note tool').not.toContain('note_on_item');
      expect((calls[0]!.tool_choice as Json | undefined)?.type, 'no first tool forced').not.toBe('function');
      expect(((calls[0]!.input ?? []) as Json[]).filter((i) => i.role === 'system').some((i) => String(i.content).startsWith(SELECTION_NOTE_PREFIX)),
        'the Challenge note reached the turn').toBe(true);
    });

    /** The bakery whose goal waits: today's weekly sales are the person's figure, not given. */
    const waiting = () => {
      const m = bakery();
      m.quantities = m.quantities.map((x) => (x.id === 'base_sales' ? { ...x, status: 'asked', value: null, quote: null, question: 'How many loaves do you sell in a typical week now?' } : x));
      return m;
    };
    const draftWaiting = async (): Promise<Json> => {
      SCENARIO = randomUUID(); persisted = null; canonicalDraft = JSON.stringify(waiting()); calls.length = 0;
      const drafted = await typed(BAKERY_BRIEF);
      expect(drafted.statusCode).toBe(200);
      calls.length = 0;
      return drafted.json() as Json;
    };
    const NOTE = { element_id: 'more_loaves', text: 'needs "base sales". How many loaves do you sell in a typical week now?' };

    it('Olumi speaks on the item (DL 24 Oct): a goal whose chance waits gets ONE note on its card, the compiler\'s reason then the AI\'s question; never on the drafting turn; a resend adds none', async () => {
      const drafted = await draftWaiting();
      // The drafting turn's cards reach the canvas after its notes would, so it carries none.
      expect(drafted.notes).toEqual([]);
      outputs = [[{ type: 'message', text: 'The chance waits on your weekly sales today.' }]];
      const turnId = randomUUID();
      const first = (await typed('What does the model hold now?', turnId)).json() as Json;
      expect(first.notes).toEqual([NOTE]);
      expect((((first.model as Json).graph as Json).nodes as Json[]).find((n) => n.id === NOTE.element_id)).toMatchObject({ kind: 'goal' });
      // A resend of the same turn replays it and adds no second note; the next turn holds one note, never two.
      const again = (await typed('What does the model hold now?', turnId)).json() as Json;
      expect(again).toMatchObject({ durability: 'replayed', notes: [] });
      outputs = [[{ type: 'message', text: 'It still waits on that figure.' }]];
      expect(((await typed('And now?')).json() as Json).notes).toEqual([NOTE]);
    });

    it('the note names the goal and what it waits on by their labels, never their ids (Paul 25 Oct, C2: "(customer_growth_goal)\'s length")', async () => {
      const m = bakery();
      m.quantities.push(q('weeks_to_reach', 'week', { label: 'Weeks to get there', status: 'unknown', author: 'olumi', basis: 'No one has said by when yet.' }));
      m.goals = m.goals.map((g) => ({ ...g, measure: { ...g.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'weeks_to_reach' } } }));
      SCENARIO = randomUUID(); persisted = null; canonicalDraft = JSON.stringify(m); calls.length = 0;
      expect((await typed(BAKERY_BRIEF)).statusCode).toBe(200);
      outputs = [[{ type: 'message', text: 'The chance waits on when you want to get there.' }]];
      const notes = ((await typed('What does the model hold now?')).json() as Json).notes as Json[];
      expect(notes.map((n) => n.element_id), 'the machine field keeps the id').toEqual(['more_loaves']);
      expect(notes[0]!.text).toContain('The goal "Reach 380 loaves a week"\'s length "Weeks to get there" is unknown: No one has said by when yet.');
      expect(notes[0]!.text, 'no internal id in what the person reads').not.toMatch(/[a-z0-9]_[a-z0-9]/);
    });

    it('a goal with a chance gets no note (contrast: the same board, its goal calculable)', async () => {
      await savedProgram();
      outputs = [[{ type: 'message', text: 'Here is what the model holds.' }]];
      const j = (await typed('What does the model hold now?')).json() as Json;
      expect(j.notes).toEqual([]);
      expect((((j.model as Json).graph as Json).nodes as Json[]).find((n) => n.id === NOTE.element_id)).toMatchObject({ kind: 'goal' });
    });

    it('a held card is the person\'s next step: no goal note is asked beside the card that holds their answer', async () => {
      await draftWaiting();
      const words = 'We sell about 320 loaves a week now.';
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'ans', args: { public_label: 'Weekly sales today', basis: 'their answer', request: '', remove: [],
        answers: [{ id: 'base_sales', value: 320, low: null, high: null, range_kind: null, party: null, quote: 'about 320 loaves a week', basis: null, status: 'known', author: 'person' }] } }],
      [{ type: 'message', text: 'I prepared your figure; approve its card to save it.' }]];
      const j = (await typed(words)).json() as Json;
      expect(changeCards(j)).toHaveLength(1);
      expect(j.notes).toEqual([]);
    });

    // Strip (Paul 26 Oct; A5 removed): program-tools no longer refuses an answer whose quote is not this turn's words.
    it('a Challenge turn (A5 removed): an answer quoting their brief is never refused by program-tools\' own this-turn quote check, and the saved model is unchanged', async () => {
      await savedProgram();
      const saved = JSON.stringify((persisted as Json).living_model);
      const item = (((persisted as Json).nodes ?? []) as Json[]).find((n) => n.kind === 'factor') ?? ((persisted as Json).nodes as Json[])[0]!;
      const quote = BAKERY_BRIEF.slice(0, 30);
      expect(BAKERY_BRIEF).toContain(quote);
      const info = vi.spyOn((await import('../../utils/telemetry.js')).log, 'info');
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'ans', args: { public_label: 'Oven price', basis: 'their answer', request: '', remove: [],
        answers: [{ id: 'oven_price', value: 2500, low: null, high: null, range_kind: null, party: null, quote, basis: null, status: 'known', author: 'person' }] } }],
      [{ type: 'message', text: 'I could not use that as your answer.' }]];
      expect((await challengeOn(String(item.id))).statusCode).toBe(200);
      expect(calls).toHaveLength(2);
      const output = (calls[1]!.input as Json[]).find((i) => i.type === 'function_call_output' && i.call_id === 'ans')!.output;
      expect(JSON.stringify(output)).not.toContain('your words this turn don');
      expect(JSON.stringify((persisted as Json).living_model)).toBe(saved);
      // The turn's one log line never names an id or their words in the clear (issue 37).
      const line = info.mock.calls.flatMap(([o]) => ((o as Json)?.event === 'core_turn.summary' ? [o as Json] : [])).at(-1)!;
      expect(line.tool_calls.map((c: Json) => c.name)).toEqual(['propose_change']);
      expect(JSON.stringify(line)).not.toContain('oven_price');
      info.mockRestore();
    });

    it('issue 37, S1 strip (A2b off): a redraft that moves a figure of theirs without their words this turn is proposed for their press, never refused; proposing saves nothing, and the turn log never carries their words', async () => {
      await savedProgram();
      const saved = JSON.stringify((persisted as Json).living_model);
      const updated = bakery();
      updated.quantities = updated.quantities.map((x) => (x.id === 'base_sales' ? { ...x, value: 301 } : x));
      canonicalDraft = JSON.stringify(updateOf(bakery(), updated)); // the update: only what it changes
      const info = vi.spyOn((await import('../../utils/telemetry.js')).log, 'info');
      const said = 'We bake a few more loaves now.';
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'more', args: { public_label: 'Weekly loaves', basis: 'their words', request: 'They bake a few more loaves a week now.', remove: [] } }],
        [{ type: 'message', text: 'I need the figure in your words.' }]];
      expect((await typed(said)).statusCode).toBe(200);
      const output = (calls.at(-1)!.input as Json[]).find((i) => i.type === 'function_call_output' && i.call_id === 'more')!.output;
      expect(JSON.parse(typeof output === 'string' ? output : JSON.stringify(output))).toMatchObject({ status: 'ok',
        data: { changes: [{ id: 'base_sales', action: 'change', before: '300 loaves per week', after: '301 loaves per week', author: 'person' }] } });
      expect(JSON.stringify((persisted as Json).living_model)).toBe(saved);
      const line = info.mock.calls.flatMap(([o]) => ((o as Json)?.event === 'core_turn.summary' ? [o as Json] : [])).at(-1)!;
      expect(line.tool_calls).toEqual([expect.objectContaining({ name: 'propose_change', outcome: 'ok' })]);
      for (const text of [said, 'We bake 300 loaves a week']) expect(JSON.stringify(line)).not.toContain(text);
      info.mockRestore();
    });

    it('issue 37 (Codex BLOCK ×2 on #3739), S1 strip (A2 off): ids holding their words, or a plain-looking "Stop.", reach the compiler (bad_id, kept), which names them to the agent; no id or words reach a log line as text', async () => {
      await savedProgram();
      const said = 'Our rival bakery shuts in March.';
      const id = said.slice(0, -1);
      const updated = bakery();
      updated.quantities.push(q(id, 'loaf/week', { value: 40, quote: 'their 40 regulars' }), q('Stop.', 'loaf/week', { value: 5, quote: 'stop at five' }));
      canonicalDraft = JSON.stringify(updateOf(bakery(), updated)); // the update: only what it changes
      const telemetry = (await import('../../utils/telemetry.js')).log;
      const spies = (['info', 'warn', 'error'] as const).map((k) => vi.spyOn(telemetry, k));
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'rival', args: { public_label: 'A rival closing', basis: 'their words', request: 'Their rival bakery shuts in March.', remove: [] } }],
        [{ type: 'message', text: 'I could not use that as your words.' }]];
      expect((await typed(said)).statusCode).toBe(200);
      const output = (calls.at(-1)!.input as Json[]).find((i) => i.type === 'function_call_output' && i.call_id === 'rival')!.output;
      // Contrast control: what the agent receives names the ids it wrote, so it can correct its draft (this is no log).
      const told = JSON.parse(typeof output === 'string' ? output : JSON.stringify(output)) as Json;
      expect(told).toMatchObject({ status: 'refused', reason: 'does_not_compile' });
      for (const x of [id, 'Stop.']) expect(String(told.detail)).toContain(`"${x}"`);
      const logged = spies.flatMap((s) => s.mock.calls);
      const line = logged.flatMap(([o]) => ((o as Json)?.event === 'core_turn.summary' ? [o as Json] : [])).at(-1)!;
      expect(line.tool_calls).toEqual([expect.objectContaining({ name: 'propose_change', outcome: 'refused', refusal: 'does_not_compile' })]);
      for (const text of [id, 'rival bakery', 'Stop.']) expect(JSON.stringify(logged)).not.toContain(text);
      for (const s of spies) s.mockRestore();
    });

    it('T1 (Paul 26 Oct): the draft\'s reply is the AI\'s own, and its call opens the Conversation with the brief; the first typed turn continues that Conversation with only its message, never a seed', async () => {
      outputs = [[{ type: 'message', text: 'Here is your model: one question first.' }]];
      const sent = await savedProgram();
      expect(sent).toBe('Here is your model: one question first.');
      // The reply call: the brief as the person's message, the draft and its Run in the state block, and no writing tool.
      const reply = draftCalls.find((c) => c.text?.format?.name !== 'canonical_model')!;
      const replyInput = (reply.input ?? []) as Json[];
      expect(replyInput.filter((i) => i.role === 'user').map((i) => String(i.content))).toEqual([BAKERY_BRIEF]);
      expect(replyInput.some((i) => i.role === 'system' && String(i.content).startsWith(STATE_BLOCK_PREFIX))).toBe(true);
      expect(replyInput.some((i) => i.role === 'system' && String(i.content).startsWith(`${PROGRAM_TURN_FACTS_PREFIX}{"trigger":"first_model"`))).toBe(true);
      for (const writer of ['build_model_from_brief', 'propose_change', 'apply_change', 'run_analysis']) expect(allowedOf(reply), writer).not.toContain(writer);
      outputs = [[{ type: 'message', text: 'Thanks; I will put that on the oven price.' }]];
      expect((await typed('About £2,500 for the oven.')).statusCode).toBe(200);
      const input = (calls[0]!.input ?? []) as Json[];
      expect(calls[0]!.conversation, 'the same Conversation the draft opened').toBe(reply.conversation);
      // No seed: the Conversation already holds the brief and the AI's reply.
      expect(input.filter((i) => i.role === 'assistant')).toEqual([]);
      expect(input.filter((i) => i.role === 'user').map((i) => String(i.content))).toEqual(['About £2,500 for the oven.']);
    });

    it('C2 (alpha spec §7, 27 Oct): the first reply\'s instructions, as SENT, ask for what the calculation leaves out and why, only when any is, beside the left_out record it reads', async () => {
      const m = bakery();
      m.left_out.push({ id: 'shop_feel', text: 'How the shop feels to the regulars', why: 'It has no measure in this model.', question: null, concerns: [],
        author: 'olumi', quote: null, party: null, approval: 'proposed', author_id: null, approved_by: null });
      SCENARIO = randomUUID(); persisted = null; canonicalDraft = JSON.stringify(m); calls.length = 0;
      outputs = [[{ type: 'message', text: 'Here is your model.' }]];
      expect((await typed(BAKERY_BRIEF)).statusCode).toBe(200);
      const reply = calls.find((c) => c.text?.format?.name !== 'canonical_model')!;
      const system = ((reply.input ?? []) as Json[]).filter((i) => i.role === 'system').map((i) => String(i.content));
      // The record the reply may name is in its state block, by id and its own words (no source change needed for this).
      const state = system.find((s) => s.startsWith(STATE_BLOCK_PREFIX))!;
      for (const words of ['"shop_feel"', 'How the shop feels to the regulars', 'It has no measure in this model.']) expect(state).toContain(words);
      // prompts-v2 (29 Oct): the instructions ask for it, spelled here (never read from the module); the turn's one facts item
      // says it is the first model.
      expect(String(reply.instructions)).toContain('On a first model, briefly distinguish what came from the brief, what Olumi added, and what the calculation leaves out and why, '
        + 'when any material is excluded.');
      const facts = system.filter((s) => s.startsWith(PROGRAM_TURN_FACTS_PREFIX));
      expect(facts).toHaveLength(1);
      expect(JSON.parse(facts[0]!.slice(PROGRAM_TURN_FACTS_PREFIX.length))).toMatchObject({ trigger: 'first_model' });
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
      // Integrated review 26 Oct (words#4): a recount, as SENT, is a figure outside Olumi's reading of what it can be, asked again
      // quoting the blocker's reason; a blocker with none (a Run stored before it) names no bound (Codex B1); never "given below 0".
      // The range_kind clause before it is unchanged.
      const readWords = String(sentTools.read_canonical_context);
      // prompts-v2 (29 Oct): in tool-descriptions.txt's words, quoting its reason without inventing a bound.
      expect(readWords).toContain("range_kind needs firm-versus-rough range meaning; recount needs clarification of the stated figure or Olumi's domain reading, "
        + 'quoting its reason without inventing a missing bound; unknown needs ');
      expect(readWords).not.toContain('given below 0');
      expect(sentTools).toEqual(PROGRAM_TOOL_DESCRIPTIONS);
      for (const [name, description] of Object.entries(sentTools)) expect(description).not.toBe((TOOL_DESCRIPTIONS as Record<string, string>)[name]);
      // Targeted answers (DL 24 Oct): propose_change, as SENT, puts an answer in answers on its item's id and anything else in
      // request; its parameters carry answers, so the feature is not inert. Spelled here.
      const sentSha = (name: string) => createHash('sha256').update(String(sentTools[name]), 'utf8').digest('hex');
      // Strip (Paul 26 Oct; B5 removed): a figure answer goes in answers; a worded answer goes in request, as the AI writes it.
      // prompts-v2 (29 Oct): in tool-descriptions.txt's words.
      expect(String(sentTools.propose_change)).toContain('Put numerical answers whose meaning is settled on existing figures in answers; put dates, spans, measures, definitions, '
        + 'unresolved ranges, new records and other structural edits in request.');
      expect(String(sentTools.propose_change)).toContain('List every proposed removal in remove under its rules. After a card exists, do not propose another this turn. '
        + 'If refused before any card exists, one corrected call may use the returned reason; never retry an unchanged request.');
      // 26 Oct (W9, european 13:44Z): a second proposal is refused only once a card is prepared, and after any refusal, while no
      // card is prepared, a corrected proposal may follow (program-tools.ts releases the turn's claim on every outcome that is not
      // ok). Before it 2bb9c6c0… (ONE correction, after does_not_compile only); the text before W9, "a second proposal in the same
      // turn is refused", hashed to b5d5bc0e….
      // 26 Oct (W6 chat): RUN_WORDS_RULE gained one sentence, the leader's words as given (run.leader.words); before it 806a9ded….
      // Strip (Paul 26 Oct, B5): a worded answer goes in request; before it 6c4611c7….
      // 26 Oct (T1, Paul): RUN_WORDS_RULE reports from the Run's own facts (chance, precision_95, driver, leader.option_id), each figure once; before it 9532ffa4….
      // 27 Oct (round 2, consolidation): RUN_WORDS_RULE is gone (RESULTS owns Run reporting), and so is the line repeating the attribution rule; before it 7996a9ef….
      // 29 Oct: prompts-v2 tool-descriptions.txt (with the DL's T1); before it 10bcbbeb….
      expect(sentSha('propose_change')).toBe('72d57835e591f04c695ee60b688f3a13a1df288dbef735cdb14a0f7761c9bca0');
      const sentParams = (calls[0]!.tools as Json[]).find((t) => t.name === 'propose_change')!.parameters as Json;
      expect(Object.keys(sentParams.properties)).toEqual(['public_label', 'basis', 'request', 'remove', 'answers']);
      expect(sentParams.required).toContain('answers');
      expect(Object.keys(sentParams.properties.answers.items.properties).sort()).toEqual(['author', 'basis', 'high', 'id', 'low', 'party', 'quote', 'range_kind', 'status', 'value']);
      // Whose an answer is, declared by the AI (Codex r1 #3727; the host checks it, never sets it).
      expect(sentParams.properties.answers.items.properties.author.enum).toEqual(['person', 'olumi']);
      expect(sentParams.properties.answers.items.required).toContain('author');
      // The program turn's facts as SENT (prompts-v2, 29 Oct; before it the guidance 0ae8bd0d…, which said where an answer goes:
      // now propose_change's own description, above): one item, facts only, the held cards the state block holds.
      const guidance = ((calls[0]!.input ?? []) as Json[]).filter((i) => i.role === 'system').map((i) => String(i.content)).filter((c) => c.startsWith(PROGRAM_TURN_FACTS_PREFIX));
      expect(guidance).toHaveLength(1);
      const facts = JSON.parse(guidance[0]!.slice(PROGRAM_TURN_FACTS_PREFIX.length)) as Json;
      expect(Object.keys(facts)).toEqual(['trigger', 'reading_card', 'held_proposals']);
      expect(facts.trigger).toBe('continuation');
      // The read the agent got back: the Run's goal_chance exactly as stored (each goal's own line, the joint, the notes).
      const output = (calls[1]!.input as Json[]).find((i) => i.type === 'function_call_output' && i.call_id === 'read')!.output;
      const read = JSON.parse(typeof output === 'string' ? output : JSON.stringify(output)) as Json;
      const run = (read.data ?? read).run as Json;
      expect(stableStringify(run.goal_chance)).toBe(stableStringify(stored));
      // W6 chat (26 Oct): and which option is most likely to achieve the goal, or why none is named: the stored view's own words.
      const leader = (persisted!.living_model.runs.at(-1).result.canonical_analysis_view as Json).leader as Json;
      // T1: the leader's option id rides with its words, so the AI names that option without quoting the sentence.
      expect(run.leader).toEqual({ licence: leader.licence, option_id: leader.goal_chance_leader ?? null, words: leader.words });
      expect(Object.keys(run).sort()).toEqual(['current', 'engine_current', 'goal_chance', 'leader', 'options', 'run_id']);
    });

    it('measure RL mrr-r3 on a PROGRAM (25 Oct): the approved apply saves with its Run, then two stray applies: the reply is the AI\'s words, with that save\'s receipt and its stored Run, never "nothing saved"', async () => {
      await savedProgram();
      const updated = bakery();
      updated.quantities = updated.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known' as const, value: 2500, question: null, quote: 'The oven would cost £2,500' } : x));
      // 29 Oct: prompts v2: an update's output is the edit schema's, so the drafter returns only what it changes (a whole model
      // is not schema-valid for it and has no base); before it the whole updated model was returned.
      canonicalDraft = JSON.stringify(updateOf(bakery(), updated));
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'p1', args: { public_label: 'Oven price £2,500', basis: 'their answer', request: 'The oven price is £2,500.', remove: [] } }],
        [{ type: 'message', text: 'I prepared the oven price; approve its card.' }]];
      const card = changeCards((await typed('The oven would cost £2,500.')).json() as Json)[0]!;
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }],
        [{ type: 'function_call', name: 'apply_change', call_id: 'again', args: { proposal_id: '' } }],
        [{ type: 'function_call', name: 'apply_change', call_id: 'again2', args: { proposal_id: '' } }], [{ type: 'message', text: 'Saved: the oven price is £2,500.' }]];
      const r = await post({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click', chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
      expect(r.statusCode, r.body).toBe(200);
      const a = r.json() as Json;
      expect(a.error).toBeNull();
      expect(a.assistant_text).toBe('Saved: the oven price is £2,500.');
      const runs = persisted!.living_model.runs as Json[];
      expect(runs, 'the save stored its Run').toHaveLength(2);
      expect(a.run).toMatchObject({ run_id: runs[1]!.run_id });
      expect(a.receipts).toEqual([expect.objectContaining({ authorised_by: 'person' })]);
      expect(JSON.stringify({ text: a.assistant_text, error: a.error })).not.toMatch(/nothing (?:was |has been )?(?:saved|changed)/i);
    });

    it('measure RL mrr-r4/r5 (25 Oct: 8 reads, then an empty reply): a press on a card the model has moved past tells the agent what it CAN do on a press (say it is out of date, ask again), and the reply comes well under the call limit', async () => {
      await savedProgram();
      // 29 Oct: prompts v2: the drafter's update returns only what it changes (the edit schema); before it the whole model.
      const said = (id: string, f: Partial<CanonicalQuantityT>) => { const m = bakery(); m.quantities = m.quantities.map((x) => (x.id === id ? { ...x, ...f } : x)); return JSON.stringify(updateOf(bakery(), m)); };
      const cardFor = async (words: string, draft: string, public_label: string): Promise<Json> => {
        canonicalDraft = draft;
        outputs = [[{ type: 'function_call', name: 'propose_change', call_id: `p-${public_label}`, args: { public_label, basis: 'their answer', request: words, remove: [] } }],
          [{ type: 'message', text: 'I prepared that; approve its card.' }]];
        const j = (await typed(words)).json() as Json;
        return changeCards(j).find((c) => c.approve_action.detail === public_label) ?? (() => { throw new Error(JSON.stringify(j.cards)); })();
      };
      const pressOf = (card: Json) => ({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click', chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
      const stale = await cardFor('The oven would cost £2,500.', said('oven_price', { status: 'known', value: 2500, question: null, quote: 'The oven would cost £2,500' }), 'Oven price £2,500');
      // Another change is approved first, so the oven price card was prepared on a model that is no longer saved.
      const moved = await cardFor('We bake 320 loaves a week now.', said('base_sales', { value: 320, quote: 'We bake 320 loaves a week now' }), 'Base sales 320');
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply-moved' }], [{ type: 'message', text: 'Saved: base sales are 320 a week.' }]];
      expect((await post(pressOf(moved))).statusCode).toBe(200);
      calls.length = 0;
      const reply = 'That card is out of date because the model changed after it was prepared, so nothing was saved. Do you want the oven price set to £2,500 again?';
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply-stale' }], [{ type: 'message', text: reply }]];
      const r = await post(pressOf(stale));
      expect(r.statusCode, r.body).toBe(200);
      const a = r.json() as Json;
      expect(a._agent.tool_calls).toEqual([{ name: 'apply_change', outcome: 'refused', refusal: 'superseded' }]);
      expect(a.error).toBeNull();
      expect(a.assistant_text).toBe(reply);
      expect(calls.length, 'well under the call limit').toBeLessThanOrEqual(2);
      // What the agent was told it can do, as SENT on the press: the card is out of date; say so and ask; never "prepare a new change".
      const sent = String(((calls[0]!.tools as Json[]).find((t) => t.name === 'apply_change') as Json).description);
      // prompts-v2 (29 Oct): in tool-descriptions.txt's words.
      expect(sent).toContain("superseded means the card's base changed and no write occurred; ask whether to prepare that change again.");
      expect(sent).not.toContain('prepare a new change');
      // 25 Oct (measure RL mrr-r4/r5): the superseded sentence; before it 09fd261b… said "read it again and prepare a new change".
      // 26 Oct (W6 chat): RUN_WORDS_RULE gained one sentence, the leader's words as given (run.leader.words); before it 4ebb0110….
      // 26 Oct (T1, Paul): RUN_WORDS_RULE reports from the Run's own facts, each figure once; before it 8ac4ec65….
      // 27 Oct (round 2, consolidation): RUN_WORDS_RULE is gone (RESULTS owns Run reporting); before it 6a9fa6d0….
      // 29 Oct: prompts-v2 tool-descriptions.txt; before it d19276a6….
      expect(createHash('sha256').update(sent, 'utf8').digest('hex')).toBe('ba69fd9f537592b2f08841ddc8f9026142ec1311c5aa62fea25d4819eb79c932');
    });

    it('DL 23 Oct (served capacity: a new Run unseen until reload): a program reply names the Run its turn stored in `run`, and only that Run', async () => {
      await savedProgram();
      const updated = bakery();
      updated.quantities = updated.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known' as const, value: 2500, question: null, quote: 'The oven would cost £2,500' } : x));
      canonicalDraft = JSON.stringify(updateOf(bakery(), updated)); // the update: only what it changes
      const set = { public_label: 'Oven price £2,500', basis: 'their answer', request: 'The oven price is £2,500.', remove: [] };
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'p1', args: set }], [{ type: 'message', text: 'I prepared the oven price; approve its card.' }]];
      const proposed = (await typed('The oven would cost £2,500.')).json() as Json;
      // This turn's card, beside the first draft's reading card (step 2), which stays on view until it is answered or lapses.
      expect(changeCards(proposed)).toHaveLength(1);
      // A card stores no Run, so the reply names none.
      expect(proposed.run).toBeNull();
      const card = changeCards(proposed)[0]!;
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved: the oven price is £2,500.' }]];
      const approved = await post({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click', chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
      expect(approved.statusCode, approved.body).toBe(200);
      const runs = persisted!.living_model.runs as Json[];
      expect(runs).toHaveLength(2);
      // The approval stored Run 2: the reply names it, so the UI reads it after the write (coreTurnContract run.run_id).
      expect((approved.json() as Json).run).toMatchObject({ run_id: runs[1]!.run_id, run_key: runs[1]!.run_id, state: { kind: 'complete_current', computed_at: runs[1]!.computed_at } });
      expect(((approved.json() as Json).canonical_analysis_view as Json).run.run_id).toBe(runs[1]!.run_id);
    });

    it('Paul 28 Oct (stale card): after an approved change saves, the first draft\'s reading card is not offered again for review', async () => {
      await savedProgram();
      const updated = bakery();
      updated.quantities = updated.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known' as const, value: 2500, question: null, quote: 'The oven would cost £2,500' } : x));
      canonicalDraft = JSON.stringify(updateOf(bakery(), updated));
      const set = { public_label: 'Oven price £2,500', basis: 'their answer', request: 'The oven price is £2,500.', remove: [] };
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'p1', args: set }], [{ type: 'message', text: 'I prepared the oven price; approve its card.' }]];
      // CONTRAST: before the press, the reply carries the reading card beside the change card (`changeCards` asserts it).
      const card = changeCards((await typed('The oven would cost £2,500.')).json() as Json)[0]!;
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved: the oven price is £2,500.' }]];
      const approved = await post({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click', chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
      expect(approved.statusCode, approved.body).toBe(200);
      const j = approved.json() as Json;
      expect((persisted!.living_model.runs as Json[]), 'the change saved').toHaveLength(2);
      // Before: the reading card came back as "Review this change" / "Not now", the reply's only buttons, after "Saved".
      expect(j.cards as Json[]).toEqual([]);
      expect(JSON.stringify(j)).not.toContain('agent-review-proposal:');
    });

    it('Codex B2 on #3801: a program Run stored by an earlier engine is named complete_stale in the reply\'s `run`, never current', async () => {
      await savedProgram();
      const { programRunOf } = await import('../core-turn.js');
      const run = (persisted!.living_model.runs as Json[]).at(-1)!;
      const today = String(run.receipt.versions.engine);
      expect(today).toMatch(/^mp-[0-9a-f]{12}$/);
      // Contrast: the Run as the route stored it, on today's engine and the saved model, is current.
      expect(programRunOf(persisted, null)).toMatchObject({ run_id: run.run_id, state: { kind: 'complete_current', computed_at: run.computed_at } });
      // The same stored Run with the engine token from before W10 (staging 3ea44fea): the saved model is unchanged, the engine is not.
      const older = JSON.parse(JSON.stringify(persisted).split(today).join('mp-a04e2cebf944')) as Json;
      expect(programRunOf(older, null)).toMatchObject({ run_id: run.run_id, state: { kind: 'complete_stale', computed_at: run.computed_at } });
    });

    it('S3 (batch 2 mrr-r3): two program proposals in one turn still leave the person ONE card to approve; the second is refused with its way on', async () => {
      await savedProgram();
      // The drafter's updated model for whichever proposal runs: the oven price, in their words.
      const updated = bakery();
      updated.quantities = updated.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known' as const, value: 2500, question: null, quote: 'The oven would cost £2,500' } : x));
      canonicalDraft = JSON.stringify(updateOf(bakery(), updated)); // the update: only what it changes
      const set = (request: string, public_label: string) => ({ public_label, basis: 'their answer', request, remove: [] });
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'p1', args: set('The oven price is £2,500.', 'Oven price £2,500') },
        { type: 'function_call', name: 'propose_change', call_id: 'p2', args: set('Base sales are 320 a week now.', 'Base sales 320') }],
      [{ type: 'message', text: 'I prepared the oven price; approve its card and I will do the rest next.' }]];
      const r = await typed('The oven would cost £2,500 and we bake 320 loaves a week now.');
      expect(r.statusCode, r.body).toBe(200);
      const j = r.json() as Json;
      const tools = (j._agent.tool_calls as Json[]).filter((c) => c.name === 'propose_change');
      // The SDK runs the two calls together: one prepares the card, the other is refused (in either order).
      expect(tools.map((c) => c.outcome).sort()).toEqual(['ok', 'refused']);
      expect(JSON.stringify(tools.find((c) => c.outcome === 'refused'))).toContain('one_card_per_turn');
      expect(changeCards(j)).toHaveLength(1);
      expect(registered.length, 'proposing saves nothing').toBe(1);
    });

    it('W9 (european, served 26 Oct 13:44Z): propose_change, as SENT, says what the code does: a second proposal is refused only once a card is prepared, and after a refusal (here does_not_compile) a corrected proposal makes the card in the same turn', async () => {
      await savedProgram();
      // The first update does not calculate (a claim about no record: undefined_ref), on its call and its ONE repair (prompts v2;
      // before it both repairs, three drafter calls); the corrected proposal's update does. Synthetic bakery words.
      const broken = bakery();
      broken.claims.push({ id: 'nowhere', text: 'Bread sells.', concerns: ['no_such_record'], author: 'olumi', quote: null, party: null, approval: 'proposed', author_id: null } as never);
      const updated = bakery();
      updated.quantities = updated.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known' as const, value: 2500, question: null, quote: 'The oven would cost £2,500' } : x));
      const bad = JSON.stringify(updateOf(bakery(), broken));
      canonicalDrafts = [bad, bad, JSON.stringify(updateOf(bakery(), updated))];
      const set = (request: string) => ({ public_label: 'Oven price £2,500', basis: 'their answer', request, remove: [] });
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'p1', args: set('The oven price is £2,500, and a note that bread sells.') }],
        [{ type: 'function_call', name: 'propose_change', call_id: 'p2', args: set('The oven price is £2,500.') }],
        [{ type: 'message', text: 'I prepared the oven price; approve its card.' }]];
      const r = await typed('The oven would cost £2,500.');
      expect(r.statusCode, r.body).toBe(200);
      const j = r.json() as Json;
      expect((j._agent.tool_calls as Json[]).filter((c) => c.name === 'propose_change').map((c) => [c.outcome, c.refusal ?? null]))
        .toEqual([['refused', 'does_not_compile'], ['ok', null]]);
      expect(changeCards(j)).toHaveLength(1);
      expect(calls.map((c) => (c.text?.format?.name === 'canonical_model' ? 'drafter' : 'agent'))).toEqual(['agent', 'drafter', 'drafter', 'agent', 'drafter', 'agent']);
      // The refusal's own reasons went back to the agent as the tool's output, so the correction can use them.
      const back = JSON.stringify((calls[3]!.input as Json[]).find((i) => i.type === 'function_call_output' && i.call_id === 'p1')!.output);
      expect(back).toContain('does_not_compile');
      expect(back).toContain('no_such_record');
      expect(registered.length, 'proposing saves nothing').toBe(1);
      // The words the agent was given, as the provider received them.
      const sent = String((calls[0]!.tools as Json[]).find((t) => t.name === 'propose_change')!.description);
      // prompts-v2 (29 Oct): in tool-descriptions.txt's words.
      expect(sent).toContain('After a card exists, do not propose another this turn. ');
      expect(sent).toContain('If refused before any card exists, one corrected call may use the returned reason; never retry an unchanged request.');
      // The false sentences are gone: every second proposal refused, and ONE correction only after does_not_compile (the code
      // releases the claim after every refusal). A prepared card still refuses one (the S3 row above).
      expect(sent).not.toContain('ONE propose_change: a second proposal in the same turn is refused');
      expect(sent).not.toContain('After a does_not_compile refusal you may make ONE');
    });

    it('S3 (batch 4 marketing r3–r5): a propose_change whose arguments fail its schema goes back to the model as a tool error; its retry gives ONE card, never a 502', async () => {
      await savedProgram();
      const updated = bakery();
      updated.quantities = updated.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'known' as const, value: 2500, question: null, quote: 'The oven would cost £2,500' } : x));
      canonicalDraft = JSON.stringify(updateOf(bakery(), updated)); // the update: only what it changes
      const good = { public_label: 'Oven price £2,500', basis: 'their answer', request: 'The oven price is £2,500.', remove: [] };
      const bad = { ...good, remove: 'two and a half thousand' };
      outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'bad', args: bad }],
        [{ type: 'function_call', name: 'propose_change', call_id: 'good', args: good }], [{ type: 'message', text: 'I prepared the oven price; approve its card.' }]];
      const r = await typed('The oven would cost £2,500.');
      expect(r.statusCode, r.body).toBe(200);
      const j = r.json() as Json;
      expect(changeCards(j)).toHaveLength(1);
      // The model got the schema error back as the tool's own output, in the same turn.
      const back = (calls[1]!.input as Json[]).find((i) => i.type === 'function_call_output' && i.call_id === 'bad')!.output;
      expect(JSON.stringify(back)).toContain('invalid_arguments');
      // It names the failing field, never its value, so the model knows what to correct.
      expect(JSON.stringify(back)).toContain('remove: ');
      expect(JSON.stringify(back)).not.toContain('two and a half thousand');
      // Three agent calls and ONE drafter call, for the good proposal's update.
      expect(calls.map((c) => (c.text?.format?.name === 'canonical_model' ? 'drafter' : 'agent'))).toEqual(['agent', 'agent', 'drafter', 'agent']);
    });

    /** The instructions the provider received on one typed turn of a saved program (the model-program instructions). */
    const sentOnce = async (): Promise<string> => {
      await savedProgram();
      outputs = [[{ type: 'message', text: 'Noted.' }]];
      expect((await typed('The lane hire is about 20 pounds an hour.')).statusCode).toBe(200);
      expect(calls).toHaveLength(1);
      return String(calls[0]!.instructions);
    };

    it('SPEC §3 + F1b + F7 + F6b (DL 26 Oct): a program\'s draft, typed turn, card (proposed, pressed, saved, read back), canvas edit and Run press never enter the Living Model reader, the legacy capabilities, the held-approval writer, the Run restore, the action ranker, the history window or the legacy card rules (F6b); the program\'s own readers and card rules do run', async () => {
      const counts = () => Object.values(legacy).map((spy) => spy.mock.calls.length);
      const none = Object.values(legacy).map(() => 0);
      for (const spy of [...Object.values(legacy), ...Object.values(program)]) spy.mockClear();
      await savedProgram();
      expect(counts(), 'the draft').toEqual(none);
      outputs = [[{ type: 'message', text: 'Here is what the model holds.' }]];
      const typedTurn = (await typed('What does the model hold now?')).json() as Json;
      expect([typedTurn.error, typedTurn.action_bar]).toEqual([null, null]);
      expect(counts(), 'the typed turn').toEqual(none);
      // CONTRAST: the probe sees the program's own readers, of its state and of its conversation (F7), which every agent turn on a program calls.
      expect(program.read).toHaveBeenCalled();
      expect(program.history).toHaveBeenCalled();
      expect(program.reconcile).toHaveBeenCalled();
      expect(program.chips).toHaveBeenCalled();
      const press = await propose();
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
      const saved = (await post(press)).json() as Json;
      expect(saved.receipts, JSON.stringify(saved._agent)).toEqual([expect.objectContaining({ authorised_by: 'person' })]);
      expect(counts(), 'the card, its press, its save and readback').toEqual(none);
      expect((await canvasEdit(randomUUID())).statusCode).toBe(200);
      expect(counts(), 'the canvas edit').toEqual(none);
      const run = await post({ turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } });
      expect(run.statusCode, run.body).toBe(200);
      expect(counts(), 'the Run press').toEqual(none);
      // CONTRAST (F1b): a saved Living Model is refused before any of them, and the probes are live: each spy counts a direct call.
      SCENARIO = randomUUID(); persisted = postimage(KNOWN_ANSWER); turnRows.clear(); conversationIds.clear();
      expect((await typed('What does the model hold now?')).statusCode).toBe(409);
      expect(counts(), 'the refused Living Model turn').toEqual(none);
      (await import('../../orchestrator-v5/path-b/living-model/view.js')).livingViewOf(persisted);
      expect(legacy.livingView).toHaveBeenCalledTimes(1);
      (await import('../../orchestrator-v5/agent-lane/history-store.js')).historyFromDurableTurns([]);
      expect(legacy.history).toHaveBeenCalledTimes(1);
      // F6 part b: each card-rule probe counts a direct call.
      const chipsMod = await import('../../orchestrator-v5/agent-lane/approval-chips.js');
      const life = await import('../../orchestrator-v5/agent-lane/proposal-object/lifecycle.js');
      const still = await import('../../orchestrator-v5/agent-lane/proposal-object/still-applies.js');
      const rec = await import('../../orchestrator-v5/agent-lane/proposal-object/record.js');
      for (const call of [() => chipsMod.approvalChipsFor([]), () => life.reconcileHeldProposals({ atStart: [], latest: [], approved: new Set(), declined: new Set(), graph: null,
        graphHash: undefined, scenarioId: SCENARIO, requestId: 'r', nowMs: 0 }), () => still.heldCardStillApplies({ operations: [] }, null),
        () => still.heldCardSubjectMoved({ operations: [] }, null), () => still.heldCardAppliesAt({ operations: [], base_graph_identity_hash: 'x' }, null, undefined),
        () => rec.heldRecordAppliesAt({ action: { kind: 'none' } } as never, {} as never, null, undefined)]) { try { call(); } catch { /* the call is what counts */ } }
      for (const spy of [legacy.chips, legacy.lifecycle, legacy.stillApplies, legacy.subjectMoved, legacy.appliesAt, legacy.recordApplies]) expect(spy).toHaveBeenCalledTimes(1);
    });

    it('(7) Codex r1 BLOCK 1 on #3707: a loose figure goes in exactly as said, with no bounds Olumi adds; Olumi asks for their range', async () => {
      const sent = await sentOnce();
      // Round 2 (27 Oct, consolidation): the rule is the drafter's (step 6) and the schema's (an approximate point, never endpoints
      // made from it), no longer the agent instructions'.
      expect(sent).not.toContain('A loose figure ("about 35") goes in exactly as they said it');
      // 29 Oct: prompts v2; before it "Ask for a range when a supplied approximate point feeds a goal or limit."
      expect(DRAFTING_INSTRUCTIONS.split('Ask for a range when their approximate point feeds an aim or limit.')).toHaveLength(2);
      for (const gone of ['18 to 22', 'a range that reads their word', 'the range is Olumi\'s reading']) expect(sent, gone).not.toContain(gone);
    });

    it('(8) Codex r1 BLOCK 2 on #3707: the whole CALCULATION BOUNDARY rides the program instructions once, with its labelled-arithmetic permission (prompts-v2, 29 Oct: agent-coaching.txt\'s own section)', async () => {
      const sent = await sentOnce();
      expect(sent.split('\n\nCALCULATION BOUNDARY\n'
        + "Do not calculate or forecast model outcomes, goal chances, break-even points, expected values, sensitivity, robustness or tipping points yourself. "
        + 'Use current supplied engine output for implications requiring modelled relationships. '
        + 'You may show transparent one-step arithmetic on supplied figures, or an explicitly defined total or difference, including stated range endpoints, only as labelled simple arithmetic with operands, units and the saved or hypothetical setting; it must not substitute for an engine result. '
        + "Do no calendar counting, date subtraction, unit conversion of spans or period rounding; stated dates and spans belong in the model's time fields for host counting.\n\n"
      )).toHaveLength(2);
    });
  });

  describe('C7 + C14 core outcomes (alpha, 27 Oct): what a turn saved stays said, and a Stop is typed', () => {
    const SAVED_LOST = 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.';
    /** A receipt by its identity: the saved version, its mutation and who authorised it. */
    const idsOf = (receipts: Json[]) => receipts.map((x) => [x.version_id, x.mutation_id, x.authorised_by]);
    /** The bakery's stored Run as an earlier engine computed it, so a Run now evaluates and saves a new one. */
    const staleEngine = () => {
      const engine = String((persisted!.living_model.runs as Json[]).at(-1)!.receipt.versions.engine);
      persisted = JSON.parse(JSON.stringify(persisted).split(engine).join('mp-a04e2cebf944')) as Json;
    };

    it('C7: a typed turn whose Run the AI started saves a new Run, then its reply fails: the 502 says it was saved, with that Run’s own receipt (Olumi’s); one write', async () => {
      staleEngine();
      const runs = storedRuns();
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run', args: { reason: 'they asked for it' } }], [{ type: 'refuse' }]];
      const r = await typed('Run the analysis again, please.');
      expect(r.statusCode, r.body).toBe(502);
      const j = r.json() as Json;
      expect([registered.length, storedRuns()], 'the Run was saved, once').toEqual([1, runs + 1]);
      expect(j.error).toEqual({ code: 'UPSTREAM_ERROR', message: SAVED_LOST, retry_safe: false, nothing_saved: false });
      // The Run's own version (the one write's version and mutation): never a later or unrelated receipt.
      expect(idsOf(j.receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect(UI_CORE_TURN.safeParse(j).success).toBe(true);
    });

    it('C7: that typed turn’s resend replays the same Run’s own receipt (Olumi’s), found by the operation the Run saved under (recorded on its answer row), never a later write by another operation; a typed Run that replied replays its own too', async () => {
      staleEngine();
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run', args: { reason: 'they asked for it' } }], [{ type: 'refuse' }]];
      const turnId = randomUUID();
      const r = await typed('Run the analysis again, please.', turnId);
      expect(r.statusCode, r.body).toBe(502);
      expect(idsOf((r.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      // An unrelated later write, by another operation: the person's own figure edit on the canvas, version 2.
      expect((await canvasEdit(randomUUID())).statusCode).toBe(200);
      expect(registered).toHaveLength(2);
      const callsBefore = calls.length;
      const again = await typed('Run the analysis again, please.', turnId);
      expect(again.statusCode, again.body).toBe(200);
      const j = again.json() as Json;
      expect(j).toMatchObject({ durability: 'replayed', error: { code: 'REPLY_NOT_DELIVERED', message: SAVED_LOST, retry_safe: false, nothing_saved: false } });
      expect(idsOf(j.receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect(j.receipts[0].source_turn_id, 'the Run’s own operation').toBe(registrationTurnId(SCENARIO, String(registered[0]!.operation_id)));
      expect([calls.length, registered.length], 'a replay calls no model and writes nothing').toEqual([callsBefore, 2]);
      // A typed Run whose reply arrived replays its own receipt the same way.
      staleEngine();
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_2', args: { reason: 'again' } }], [{ type: 'message', text: 'Done.' }]];
      const second = randomUUID();
      const replied = await typed('And once more.', second);
      expect(replied.statusCode, replied.body).toBe(200);
      expect(idsOf((replied.json() as Json).receipts)).toEqual([['v_3', 'm_3', 'olumi']]);
      expect(idsOf(((await typed('And once more.', second)).json() as Json).receipts)).toEqual([['v_3', 'm_3', 'olumi']]);
      // Its answer row records that Run's operation, by identity, and its words stay provably typed to the next turn (`typedRowProof`).
      expect(recordedRunsOf(String(turnRows.get(second)!.request_hash))).toEqual([String(registered[2]!.operation_id)]);
      expect(typedRowProof(SCENARIO, null)(turnRows.get(second)!)).toBe(true);
    });

    it('C7: a typed Run whose register acknowledgement was lost, its save proved by its own operation’s version and a complete readback, then whose reply failed: the resend replays exactly that Run’s receipt, never a later write’s; CONTRAST: a lost acknowledgement with nothing committed stays unknown, with no receipt recorded or replayed', async () => {
      staleEngine();
      loseAck = 'after_commit';
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run', args: { reason: 'they asked for it' } }], [{ type: 'refuse' }]];
      const turnId = randomUUID();
      const r = await typed('Run the analysis again, please.', turnId);
      expect(r.statusCode, r.body).toBe(502);
      expect((r.json() as Json).error).toEqual({ code: 'UPSTREAM_ERROR', message: SAVED_LOST, retry_safe: false, nothing_saved: false });
      // The Run's own version, found by its own operation (the 503 carried no receipt): one commit, never a second revision.
      expect(idsOf((r.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect(registered).toHaveLength(1);
      const runOp = String(registered[0]!.operation_id);
      expect(recordedRunsOf(String(turnRows.get(turnId)!.request_hash)), 'its answer row records that Run’s operation').toEqual([runOp]);
      // An unrelated later write, by another operation: version 2.
      expect((await canvasEdit(randomUUID())).statusCode).toBe(200);
      expect(registered).toHaveLength(2);
      const again = await typed('Run the analysis again, please.', turnId);
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json()).toMatchObject({ durability: 'replayed', error: { code: 'REPLY_NOT_DELIVERED', message: SAVED_LOST, nothing_saved: false } });
      expect(idsOf((again.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect((again.json() as Json).receipts[0].source_turn_id).toBe(registrationTurnId(SCENARIO, runOp));
      // CONTRAST: the acknowledgement lost with nothing committed: the save is not proved, so it stays unknown and no Run is recorded.
      staleEngine();
      loseAck = 'before_commit';
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_2', args: { reason: 'again' } }], [{ type: 'refuse' }]];
      const unproved = randomUUID();
      const u = await typed('And once more.', unproved);
      expect(u.statusCode, u.body).toBe(502);
      expect(u.json()).toMatchObject({ receipts: [], error: { nothing_saved: false } });
      expect(registered, 'nothing committed').toHaveLength(2);
      expect(recordedRunsOf(String(turnRows.get(unproved)!.request_hash))).toEqual([]);
      expect(((await typed('And once more.', unproved)).json() as Json).receipts).toEqual([]);
    });

    it('C7: a press whose change committed, then whose answer row is refused (another answer holds the turn id; the ownership read fails): each refusal carries that change’s own receipt, never "nothing saved"', async () => {
      const append = store.append.getMockImplementation()!;
      const owner = store.getScenarioOwner;
      try {
        const press = await propose();
        outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
        // The answer row (this turn id, response_emitted) meets another answer already recorded under it.
        store.append.mockImplementation(async (write: Json) => (write.turn_id === press.turn_id && write.response_emitted === true
          ? { id: 'row-other', priorTurnConflict: true as const } : append(write)));
        const conflict = await post(press);
        expect(conflict.statusCode, conflict.body).toBe(409);
        expect((conflict.json() as Json).error).toMatchObject({ code: 'TURN_ID_REUSED', retry_safe: false, nothing_saved: false });
        expect(idsOf((conflict.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'person']]);
        store.append.mockImplementation(append);
        // A second change on the same model: its save commits, then the owner read for its answer row fails.
        const second = await propose('Make the oven £3,000.', answer(3000, '£3,000'));
        outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply_2' }], [{ type: 'message', text: 'Saved.' }]];
        store.getScenarioOwner = async () => { if (registered.length === 2) throw new Error('owner read down'); return null; };
        const refused = await post(second);
        expect(refused.statusCode, refused.body).toBe(403);
        expect((refused.json() as Json).error).toMatchObject({ retry_safe: false, nothing_saved: false });
        expect(idsOf((refused.json() as Json).receipts)).toEqual([['v_2', 'm_2', 'person']]);
        expect([registered.length, figure('oven_price')], 'each change was saved once').toEqual([2, 3000]);
      } finally {
        store.append.mockImplementation(append);
        store.getScenarioOwner = owner;
      }
    });

    it('C7: a streamed first draft that saved, then outlived the stream before its reply: the stream’s COMPLETE says it was saved, with the draft’s own receipt (Olumi’s); the turn then finishes with no second write', async () => {
      const { streamTurnAsStagedSse } = await import('../streamed-turn-sse.js');
      const { config } = await import('../../config/index.js');
      persisted = null;
      canonicalDraft = JSON.stringify(bakery());
      let release!: () => void;
      // The draft's reply call is held: the draft is saved and the reply has not come.
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      const turnId = randomUUID();
      const writes: string[] = [];
      const reply = { raw: { destroyed: false, writableEnded: false, setHeader: () => {}, writeHead: () => {},
        write(chunk: string) { writes.push(chunk); return true; }, end() { this.writableEnded = true; } }, getHeaders: () => ({}) };
      // The stream's budget timer (a distinct budget, so it is the one caught) fires once the draft has streamed its saved graph.
      const kept = config.proxy.browserProxyTimeoutMs;
      const budget = 98_765;
      config.proxy.browserProxyTimeoutMs = budget;
      const realSetTimeout = globalThis.setTimeout;
      let fire: (() => void) | undefined;
      const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) =>
        (ms === budget && fire === undefined ? (fire = fn, realSetTimeout(() => {}, 0)) : Reflect.apply(realSetTimeout, globalThis, [fn, ms, ...rest]))) as never);
      try {
        const streamed = streamTurnAsStagedSse({ app, reply: reply as never, requestId: 'req-stream', internalHeaders: { 'content-type': 'application/json' },
          payload: JSON.stringify({ kind: 'message', scenario_id: SCENARIO, turn_id: turnId, message: BAKERY_BRIEF, source: 'composer' }),
          featureVersion: 'test', endpoint: '/proxy/v5/turn/stream', internalTarget: '/agent/v1/core-turn' });
        await vi.waitFor(() => expect(writes.some((w) => w.includes('"stage":"GRAPH_READY"'))).toBe(true));
        fire!();
        await streamed;
      } finally {
        timers.mockRestore();
        config.proxy.browserProxyTimeoutMs = kept;
      }
      const frames = writes.filter((w) => w.startsWith('event: stage')).map((w) => JSON.parse(w.slice(w.indexOf('data: ') + 6)) as Json);
      expect(frames.map((f) => f.stage)).toEqual(['DRAFTING', 'GRAPH_READY', 'COMPLETE']);
      const complete = frames.at(-1)!;
      expect(complete.status_code).toBe(504);
      expect(complete.payload).toMatchObject({ turn_id: turnId, durability: 'unknown', error: { code: 'TURN_STILL_RUNNING', retry_safe: false, nothing_saved: false } });
      expect(registered).toHaveLength(1);
      // The draft's own version, found by its own operation (turn:<turn id>), as a replay finds it.
      expect(idsOf(complete.payload.receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect(complete.payload.receipts[0].source_turn_id).toBe(registrationTurnId(SCENARIO, programOperationId(SCENARIO, `turn:${turnId}`)));
      expect(UI_CORE_TURN.safeParse(complete.payload).success).toBe(true);
      // The turn runs on to its own answer, and writes nothing again.
      release();
      await vi.waitFor(() => expect(turnRows.has(turnId)).toBe(true));
      expect(registered).toHaveLength(1);
    });

    it('C7: the same streamed draft, outliving the stream while its own versions read never answers: the read is bounded (OWN_SAVE_READ_MS), so the COMPLETE frame still ends the stream, 504 TURN_STILL_RUNNING with no receipt', async () => {
      const { streamTurnAsStagedSse } = await import('../streamed-turn-sse.js');
      const { config } = await import('../../config/index.js');
      persisted = null;
      canonicalDraft = JSON.stringify(bakery());
      let release!: () => void;
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      let answerVersions: (() => void) | undefined;
      const turnId = randomUUID();
      const writes: string[] = [];
      const reply = { raw: { destroyed: false, writableEnded: false, setHeader: () => {}, writeHead: () => {},
        write(chunk: string) { writes.push(chunk); return true; }, end() { this.writableEnded = true; } }, getHeaders: () => ({}) };
      const kept = config.proxy.browserProxyTimeoutMs;
      const budget = 98_765;
      config.proxy.browserProxyTimeoutMs = budget;
      const realSetTimeout = globalThis.setTimeout;
      // The stream's budget timer, then (once it has fired) the bound on the versions read: each caught, and fired by the row.
      let fire: (() => void) | undefined;
      let bound: (() => void) | undefined;
      let fired = false;
      const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) =>
        (ms === budget && fire === undefined ? (fire = fn, realSetTimeout(() => {}, 0))
          : fired && ms === OWN_SAVE_READ_MS && bound === undefined ? (bound = fn, realSetTimeout(() => {}, 0))
          : Reflect.apply(realSetTimeout, globalThis, [fn, ms, ...rest]))) as never);
      try {
        const streamed = streamTurnAsStagedSse({ app, reply: reply as never, requestId: 'req-stream', internalHeaders: { 'content-type': 'application/json' },
          payload: JSON.stringify({ kind: 'message', scenario_id: SCENARIO, turn_id: turnId, message: BAKERY_BRIEF, source: 'composer' }),
          featureVersion: 'test', endpoint: '/proxy/v5/turn/stream', internalTarget: '/agent/v1/core-turn' });
        // The draft is saved and its reply call is held; from here every versions read waits.
        await vi.waitFor(() => expect([writes.some((w) => w.includes('"stage":"GRAPH_READY"')), holdProvider]).toEqual([true, undefined]));
        holdVersions = new Promise<void>((resolve) => { answerVersions = resolve; });
        fired = true;
        fire!();
        await vi.waitFor(() => expect(versionsHeld).toBe(1));
        bound?.();
        await streamed;
      } finally {
        answerVersions?.();
        timers.mockRestore();
        config.proxy.browserProxyTimeoutMs = kept;
      }
      const frames = writes.filter((w) => w.startsWith('event: stage')).map((w) => JSON.parse(w.slice(w.indexOf('data: ') + 6)) as Json);
      expect(frames.map((f) => f.stage)).toEqual(['DRAFTING', 'GRAPH_READY', 'COMPLETE']);
      const complete = frames.at(-1)!;
      expect(complete.status_code).toBe(504);
      expect(complete.payload).toMatchObject({ turn_id: turnId, durability: 'unknown', receipts: [], error: { code: 'TURN_STILL_RUNNING', retry_safe: false, nothing_saved: false } });
      expect(UI_CORE_TURN.safeParse(complete.payload).success).toBe(true);
      release();
      await vi.waitFor(() => expect(turnRows.has(turnId)).toBe(true));
      expect(registered).toHaveLength(1);
    });

    it('C7: a signed-in first draft that saved, then whose reply call ended with no terminal event: the 502 says it was saved, with the draft’s own receipt (Olumi’s), durability recorded (its continuation row is written); a resend replays that receipt. C8: a guest’s draft mints no version: the same words, with the save its own registration row carries (Olumi’s)', async () => {
      const draftThenCut = async () => {
        SCENARIO = randomUUID(); persisted = null;
        canonicalDraft = JSON.stringify(bakery());
        outputs = [[{ type: 'cut' }]];
        const turnId = randomUUID();
        return { turnId, r: await typed(BAKERY_BRIEF, turnId) };
      };
      const LOST = { code: 'UPSTREAM_ERROR', message: SAVED_LOST, retry_safe: false, nothing_saved: false };
      const { turnId, r } = await draftThenCut();
      expect(r.statusCode, r.body).toBe(502);
      const j = r.json() as Json;
      expect(j).toMatchObject({ durability: 'recorded', error: LOST });
      expect(idsOf(j.receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect(registered.map((b) => b.operation_id), 'the draft’s own operation').toEqual([programOperationId(SCENARIO, `turn:${turnId}`)]);
      expect(turnRows.get(turnId)?.request_hash, 'what was proven: its continuation row').toMatch(/#outcome:reply_lost_saved$/);
      expect(UI_CORE_TURN.safeParse(j).success).toBe(true);
      const again = await typed(BAKERY_BRIEF, turnId);
      expect(again.json()).toMatchObject({ durability: 'replayed', error: { code: 'REPLY_NOT_DELIVERED', message: SAVED_LOST, nothing_saved: false } });
      expect(idsOf((again.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect(registered, 'one write').toHaveLength(1);
      // C8: the same turn by a guest. Its draft is saved (the model is there) but mints no version: its receipt is the one its
      // own registration row carries (before C8 this was [], the gap C8 closes).
      registered.length = 0;
      guestWrites = true;
      const guest = await draftThenCut();
      expect(guest.r.statusCode, guest.r.body).toBe(502);
      expect(savedProgramOf(persisted), 'the guest’s draft is saved').toBeDefined();
      expect(guest.r.json()).toMatchObject({ durability: 'recorded', error: LOST });
      const draftRow = registrationTurnId(SCENARIO, programOperationId(SCENARIO, `turn:${guest.turnId}`));
      expect((guest.r.json() as Json).receipts).toEqual([{ ...unversionedSaveOf(registrationRows.get(draftRow), draftRow), authorised_by: 'olumi' }]);
      expect(UI_CORE_TURN.safeParse(guest.r.json()).success).toBe(true);
    });

    it('C14: a typed turn stopped while its call runs answers with the typed Stop outcome (TURN_STOPPED, nothing saved), recorded on its row, and a resend replays it with no call or write; an unstopped turn answers with none', async () => {
      let release!: () => void;
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      outputs = [[{ type: 'message', text: 'The model holds the oven price as a question.' }]];
      const turnId = randomUUID();
      const pending = typed('What does the model hold for the oven?', turnId);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const stop = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn/stop', payload: { scenario_id: SCENARIO, turn_id: turnId } });
      expect(stop.json()).toMatchObject({ stopped: true, claimed: true });
      release();
      const r = await pending;
      expect(r.statusCode, r.body).toBe(200);
      const STOPPED = { code: 'TURN_STOPPED', message: 'You stopped this turn before it changed anything. Nothing in your model was changed.', retry_safe: false, nothing_saved: true };
      expect(r.json()).toMatchObject({ durability: 'recorded', error: STOPPED, receipts: [] });
      expect(UI_CORE_TURN.safeParse(r.json()).success).toBe(true);
      expect(registered).toHaveLength(0);
      const again = await typed('What does the model hold for the oven?', turnId);
      expect(again.json()).toMatchObject({ durability: 'replayed', error: STOPPED, receipts: [] });
      expect([calls.length, registered.length], 'a resend calls no model and writes nothing').toEqual([1, 0]);
      // CONTRAST: the same turn not stopped answers with no error.
      outputs = [[{ type: 'message', text: 'Still a question.' }]];
      expect((await typed('What does the model hold for the oven?')).json()).toMatchObject({ durability: 'recorded', error: null });
    });

    it('C14: a press stopped while its conversation is read (after its fence claim, before the agent’s first call) makes no provider call and runs no tool: TURN_STOPPED, nothing saved, recorded; the card stays held', async () => {
      const press = await propose();
      const before = calls.length;
      const recent = store.readRecent.getMockImplementation()!;
      // The press's history read (`programHistoryOf`'s rows): the Stop lands there, once the turn holds its place in the fence.
      store.readRecent.mockImplementationOnce(async (...args: Parameters<typeof recent>) => {
        const stop = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn/stop', payload: { scenario_id: SCENARIO, turn_id: press.turn_id } });
        expect(stop.json()).toMatchObject({ stopped: true, claimed: true });
        return recent(...args);
      });
      const r = await post(press);
      expect(r.statusCode, r.body).toBe(200);
      const j = r.json() as Json;
      expect(calls.length, 'no provider call').toBe(before);
      expect(j._provider_calls).toEqual([]);
      expect(j._agent.tool_calls).toEqual([]);
      expect(j).toMatchObject({ durability: 'recorded', assistant_text: '', receipts: [],
        error: { code: 'TURN_STOPPED', message: 'You stopped this turn before it changed anything. Nothing in your model was changed.', retry_safe: false, nothing_saved: true } });
      expect([registered.length, figure('oven_price')]).toEqual([0, null]);
      expect((j.cards as Json[]).map((c) => c.proposal_id), 'the card stays held').toEqual([preparedId]);
    });

    it('C14: once a turn is stopped its reply call is never made: a press stopped during its first call makes no second call, writes nothing and answers its apply in the Conversation; a first draft stopped after its save makes no reply call and keeps its save, with its receipt', async () => {
      const stopTurn = (turnId: string) => app.inject({ method: 'POST', url: '/orchestrate/v2/turn/stop', payload: { scenario_id: SCENARIO, turn_id: turnId } });
      // (1) The agent's run: a press whose first call is held, then stopped there.
      const press = await propose();
      let release!: () => void;
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'A reply written after the Stop.' }]];
      const before = calls.length;
      const pending = post(press);
      await vi.waitFor(() => expect(calls.length).toBe(before + 1));
      expect((await stopTurn(String(press.turn_id))).json()).toMatchObject({ stopped: true, claimed: true });
      release();
      const r = await pending;
      expect(r.statusCode, r.body).toBe(200);
      expect(calls.length, 'the apply call only: no reply call after the Stop').toBe(before + 1);
      // Its apply was refused by the fence (nothing written), so nothing changed.
      expect(r.json()).toMatchObject({ assistant_text: '', receipts: [], error: { code: 'TURN_STOPPED', retry_safe: false, nothing_saved: true } });
      expect([registered.length, figure('oven_price')]).toEqual([0, null]);
      // The apply's own answer is in the Conversation, so the next turn finds no call left unanswered.
      const answered = conversationItems.flatMap((c) => c.items).filter((i) => i.type === 'function_call_output' && i.call_id === 'apply');
      expect(answered.map((i) => (JSON.parse(String(i.output)) as Json).data)).toEqual([{ code: 'TURN_STOPPED', written: false }]);
      // (2) The host's turn: a first draft saved, then stopped before its reply call (the Stop lands on the read for that reply).
      SCENARIO = randomUUID(); persisted = null; registered.length = 0; turnRows.clear(); pausedRun = null;
      canonicalDraft = JSON.stringify(bakery());
      const turnId = randomUUID();
      const read = program.read.getMockImplementation()!;
      program.read.mockImplementationOnce(async (...args: Parameters<typeof read>) => { await stopTurn(turnId); return read(...args); });
      const callsBefore = calls.length;
      const drafted = await app.inject({ method: 'POST', url: '/agent/v1/core-turn',
        payload: { kind: 'message', scenario_id: SCENARIO, turn_id: turnId, message: BAKERY_BRIEF, source: 'composer' } });
      expect(drafted.statusCode, drafted.body).toBe(200);
      expect(calls.slice(callsBefore).map((c) => c.text?.format?.name ?? null), 'the drafting call only: no reply call').toEqual(['canonical_model']);
      expect(drafted.json()).toMatchObject({ assistant_text: '', error: { code: 'TURN_STOPPED', retry_safe: false, nothing_saved: false } });
      expect(idsOf((drafted.json() as Json).receipts)).toEqual([['v_1', 'm_1', 'olumi']]);
      expect(registered, 'the save stands, once: nothing undone').toHaveLength(1);
    });
  });

  /**
   * ⭐ C8 (alpha, 27 Oct; DL + PL): every save has its own receipt, a GUEST's too. A guest's save mints no version, so its
   * receipt is the one its own registration row carries (`#saved:` on the row's immutable request hash, marker
   * `model_version_created === false`), read back from that row on the live answer, a lost acknowledgement, a resend and a
   * stream: `{ kind: 'unversioned', scenario_revision, run_id, source_turn_id, authorised_by }`, with NO version keys.
   */
  describe('C8 (alpha, 27 Oct): a guest’s saved change is said as saved, with its own receipt, and a retry never saves twice', () => {
    const SAVED_LOST = 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.';
    const RECEIPT_KEYS = ['kind', 'scenario_revision', 'run_id', 'source_turn_id', 'authorised_by'];
    const VERSION_KEYS = ['version', 'version_id', 'mutation_id'];
    /** The receipt an operation's own registration row carries, exactly as stored (the ONE reader). */
    const carrierOf = (operationId: string): Json | null => {
      const row = registrationTurnId(SCENARIO, operationId);
      return unversionedSaveOf(registrationRows.get(row), row);
    };
    const staleEngine = () => {
      const engine = String((persisted!.living_model.runs as Json[]).at(-1)!.receipt.versions.engine);
      persisted = JSON.parse(JSON.stringify(persisted).split(engine).join('mp-a04e2cebf944')) as Json;
    };
    /** The registration rows the route read through the store (the row reader), by turn id. */
    const registrationReads = () => store.readCommittedTurn.mock.calls.map((c) => String(c[1])).filter((id) => id.startsWith('graph_registration:'));

    it('(1, 10) a guest’s card press: ONE save, said with the receipt its own registration row stores (the person’s), naming the bytes it wrote and their newest Run, with no version key; a resend of the press replays that receipt and saves nothing', async () => {
      guestWrites = true;
      const press = await propose();
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved: the oven costs £2,500.' }]];
      const r = await post(press);
      expect(r.statusCode, r.body).toBe(200);
      const j = r.json() as Json;
      const op = programOperationId(SCENARIO, `proposal:${preparedId}`);
      expect([...registrationRows.keys()], 'one save, under the card’s own operation').toEqual([registrationTurnId(SCENARIO, op)]);
      expect(figure('oven_price')).toBe(2500);
      expect(j.receipts).toEqual([{ ...carrierOf(op), authorised_by: 'person' }]);
      // What the receipt says is what was written: the stored bytes' identity.v1 and their newest stored Run.
      expect(j.receipts[0]).toEqual({ kind: 'unversioned', scenario_revision: computeGraphIdentityHash(persisted as never)!.value,
        run_id: savedProgramOf(persisted)!.runs.at(-1)!.run_id, source_turn_id: registrationTurnId(SCENARIO, op), authorised_by: 'person' });
      // (10) The keys the UI refuses on an unversioned receipt are ABSENT, never null.
      expect(Object.keys(j.receipts[0])).toEqual(RECEIPT_KEYS);
      for (const k of VERSION_KEYS) expect(j.receipts[0], k).not.toHaveProperty(k);
      expect(UI_CORE_TURN.safeParse(j).success).toBe(true);
      const again = (await post(press)).json() as Json;
      expect(again).toMatchObject({ durability: 'replayed', error: null });
      expect(again.receipts).toEqual(j.receipts);
      expect(registrationRows.size, 'a resend saves nothing').toBe(1);
    });

    it('(2, 3, 4) a guest’s typed Run whose acknowledgement was lost AFTER it committed, then whose reply failed: reconciled from its own row’s carrier (Olumi’s), one save; after an unrelated later save the resend replays THAT carrier, never the later one or today’s revision; CONTRAST: lost before it committed stays unknown, no receipt', async () => {
      guestWrites = true;
      staleEngine();
      loseAck = 'after_commit';
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run', args: { reason: 'they asked for it' } }], [{ type: 'refuse' }]];
      const turnId = randomUUID();
      const r = await typed('Run the analysis again, please.', turnId);
      expect(r.statusCode, r.body).toBe(502);
      const j = r.json() as Json;
      expect(j.error).toEqual({ code: 'UPSTREAM_ERROR', message: SAVED_LOST, retry_safe: false, nothing_saved: false });
      expect(registrationRows.size, 'one save').toBe(1);
      const [runRow] = [...registrationRows.keys()];
      const runOp = recordedRunsOf(String(turnRows.get(turnId)!.request_hash));
      expect(runOp.map((op) => registrationTurnId(SCENARIO, op)), 'its answer row records the Run’s own operation').toEqual([runRow]);
      const original: Json = { ...carrierOf(runOp[0]!), authorised_by: 'olumi' };
      expect(j.receipts).toEqual([original]);
      expect(original.run_id, 'the Run it saved').toBe(savedProgramOf(persisted)!.runs.at(-1)!.run_id);
      // (4) An unrelated later save, by another operation: the person's own figure on the canvas.
      const edit = await canvasEdit(randomUUID());
      expect(edit.statusCode, edit.body).toBe(200);
      expect((edit.json() as Json).receipts).toEqual([expect.objectContaining({ kind: 'unversioned', authorised_by: 'person' })]);
      expect(registrationRows.size).toBe(2);
      const now = computeGraphIdentityHash(persisted as never)!.value;
      expect(now, 'the model moved on').not.toBe(original.scenario_revision);
      // (3) The resend replays the Run's own carrier, as stored: not the later save's, not today's revision.
      const callsBefore = calls.length;
      const again = await typed('Run the analysis again, please.', turnId);
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json()).toMatchObject({ durability: 'replayed', error: { code: 'REPLY_NOT_DELIVERED', message: SAVED_LOST, nothing_saved: false } });
      expect((again.json() as Json).receipts).toEqual([original]);
      expect([calls.length, registrationRows.size], 'a replay calls no model and saves nothing').toEqual([callsBefore, 2]);
      // CONTRAST: the acknowledgement lost before anything committed: no row, so no receipt, recorded or replayed.
      staleEngine();
      loseAck = 'before_commit';
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_2', args: { reason: 'again' } }], [{ type: 'refuse' }]];
      const unproved = randomUUID();
      const u = await typed('And once more.', unproved);
      expect(u.statusCode, u.body).toBe(502);
      expect(u.json()).toMatchObject({ receipts: [], error: { nothing_saved: false } });
      expect(registrationRows.size, 'nothing committed').toBe(2);
      expect(((await typed('And once more.', unproved)).json() as Json).receipts).toEqual([]);
    });

    it('(1, stream) a guest’s streamed first draft that saved, then outlived the stream: the COMPLETE frame says it was saved with the receipt its own row carries (Olumi’s); the turn finishes with no second save', async () => {
      const { streamTurnAsStagedSse } = await import('../streamed-turn-sse.js');
      const { config } = await import('../../config/index.js');
      guestWrites = true;
      persisted = null;
      canonicalDraft = JSON.stringify(bakery());
      let release!: () => void;
      holdProvider = new Promise<void>((resolve) => { release = resolve; });
      const turnId = randomUUID();
      const writes: string[] = [];
      const reply = { raw: { destroyed: false, writableEnded: false, setHeader: () => {}, writeHead: () => {},
        write(chunk: string) { writes.push(chunk); return true; }, end() { this.writableEnded = true; } }, getHeaders: () => ({}) };
      const kept = config.proxy.browserProxyTimeoutMs;
      const budget = 98_766;
      config.proxy.browserProxyTimeoutMs = budget;
      const realSetTimeout = globalThis.setTimeout;
      let fire: (() => void) | undefined;
      const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) =>
        (ms === budget && fire === undefined ? (fire = fn, realSetTimeout(() => {}, 0)) : Reflect.apply(realSetTimeout, globalThis, [fn, ms, ...rest]))) as never);
      try {
        const streamed = streamTurnAsStagedSse({ app, reply: reply as never, requestId: 'req-stream', internalHeaders: { 'content-type': 'application/json' },
          payload: JSON.stringify({ kind: 'message', scenario_id: SCENARIO, turn_id: turnId, message: BAKERY_BRIEF, source: 'composer' }),
          featureVersion: 'test', endpoint: '/proxy/v5/turn/stream', internalTarget: '/agent/v1/core-turn' });
        await vi.waitFor(() => expect(writes.some((w) => w.includes('"stage":"GRAPH_READY"'))).toBe(true));
        fire!();
        await streamed;
      } finally {
        timers.mockRestore();
        config.proxy.browserProxyTimeoutMs = kept;
      }
      const complete = writes.filter((w) => w.startsWith('event: stage')).map((w) => JSON.parse(w.slice(w.indexOf('data: ') + 6)) as Json).at(-1)!;
      expect(complete.payload).toMatchObject({ turn_id: turnId, durability: 'unknown', error: { code: 'TURN_STILL_RUNNING', nothing_saved: false } });
      const draftOp = programOperationId(SCENARIO, `turn:${turnId}`);
      expect(complete.payload.receipts).toEqual([{ ...carrierOf(draftOp), authorised_by: 'olumi' }]);
      expect(Object.keys(complete.payload.receipts[0])).toEqual(RECEIPT_KEYS);
      expect(UI_CORE_TURN.safeParse(complete.payload).success).toBe(true);
      release();
      await vi.waitFor(() => expect(turnRows.has(turnId)).toBe(true));
      expect(registrationRows.size, 'one save').toBe(1);
    });

    it('(6) a guest’s row written BEFORE the carrier (no #saved): the save stays unknown on a lost acknowledgement and on its resend; this retry’s revision and Run are never claimed as its receipt', async () => {
      guestWrites = true;
      preCarrierRows = true;
      staleEngine();
      loseAck = 'after_commit';
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run', args: { reason: 'they asked for it' } }], [{ type: 'refuse' }]];
      const turnId = randomUUID();
      const r = await typed('Run the analysis again, please.', turnId);
      expect(r.statusCode, r.body).toBe(502);
      expect(registrationRows.size, 'it did commit').toBe(1);
      expect(String([...registrationRows.values()][0]!.request_hash)).not.toContain('#saved:');
      expect(r.json()).toMatchObject({ receipts: [], error: { nothing_saved: false } });
      expect(((await typed('Run the analysis again, please.', turnId)).json() as Json).receipts).toEqual([]);
    });

    it('(7) CONTRAST: a signed-in save is said exactly as before: its version’s receipt, no `kind`; on its resend the version is found first and its registration row is never read', async () => {
      const press = await propose();
      outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
      const r = (await post(press)).json() as Json;
      const op = programOperationId(SCENARIO, `proposal:${preparedId}`);
      // Live: the register's own `model_version` (it names no source turn); replayed: the version found by its operation.
      const SIGNED_IN = { version: 1, version_id: 'v_1', mutation_id: 'm_1', source_turn_id: null, authorised_by: 'person' };
      expect(r.receipts).toEqual([SIGNED_IN]);
      expect(Object.keys(r.receipts[0])).toEqual(['version', 'version_id', 'mutation_id', 'source_turn_id', 'authorised_by']);
      store.readCommittedTurn.mockClear();
      const again = (await post(press)).json() as Json;
      expect(again).toMatchObject({ durability: 'replayed' });
      expect(again.receipts).toEqual([{ ...SIGNED_IN, source_turn_id: registrationTurnId(SCENARIO, op) }]);
      expect(store.readCommittedTurn, 'control: the probe sees the reads the resend does make').toHaveBeenCalled();
      // The card's save has a version, so its row is never read; an operation of the turn's that saved nothing (no version) is.
      expect(registrationReads(), 'control: the probe sees a row read the resend does make').toContain(registrationTurnId(SCENARIO, programOperationId(SCENARIO, `turn:${press.turn_id}`)));
      expect(registrationReads(), 'the version is found first: its row is never read').not.toContain(registrationTurnId(SCENARIO, op));
    });

    it('(8) the guest’s row once claim_guest_scenario has stamped it with the new owner (user_id set, marker still false) still says its save; CONTRAST: a row the RPC never marked (null) or one marked true has no unversioned receipt', async () => {
      guestWrites = true;
      staleEngine();
      outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run', args: { reason: 'they asked for it' } }], [{ type: 'refuse' }]];
      const turnId = randomUUID();
      const r = await typed('Run the analysis again, please.', turnId);
      expect(r.statusCode, r.body).toBe(502);
      const original = (r.json() as Json).receipts as Json[];
      expect(original).toEqual([expect.objectContaining({ kind: 'unversioned', authorised_by: 'olumi' })]);
      const row = [...registrationRows.values()][0]!;
      // Login: the claim stamps the guest's rows with the owner (20260710190000 lines 198–200/236–238); the marker is untouched.
      row.user_id = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b';
      const resend = () => typed('Run the analysis again, please.', turnId).then((x) => (x.json() as Json).receipts);
      expect(await resend()).toEqual(original);
      row.model_version_created = null;
      expect(await resend(), 'never marked: unknown').toEqual([]);
      row.model_version_created = true;
      expect(await resend(), 'marked as a version: not an unversioned save').toEqual([]);
    });
  });
});
