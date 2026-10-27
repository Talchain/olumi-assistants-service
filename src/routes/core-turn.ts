/**
 * ⭐ THE CORE ROUTE: `POST /agent/v1/core-turn` (22 Oct 2026; DL, on Paul's direction: the OpenAI-native core turn leaves
 * the 7,000-line legacy route for its own thin one, which the whole PoC uses). It takes TODAY's `/proxy/v5/turn` body (the
 * browser proxy selects it with `x-olumi-ai-mode: core-route`) and answers with the core turn contract
 * (`core-route/contract.ts`, the ONE builder). A turn, in order:
 *  1. provider policy (OPENAI_ONLY) → ownership (the scenario-ownership hook) → the turn's replay, or its claim;
 *  2. the scenario's core turn slot (`acquireCoreTurnSlot`), held until the answer is persisted and read back;
 *  3. a FRESH read of the saved scenario, after the slot (graph, living model, revision, selected Run);
 *  4. `runCoreTurn`: the OpenAI Agents SDK turn, its tools and stores from `core-route/deps.ts`;
 *  5. the answer row: the replay's record, carrying every held card;
 *  6. the contract.
 * The reply is the SDK's final output, untouched: nothing is composed around it. Science stays under the AI, as its tools and
 * their checks. A canvas edit saves one figure of the program (`applyCanvasFigure`).
 * ⭐ PROGRAM ONLY (inventory F1b, 26 Oct; Paul: "all of the old code stripped"): a scenario is a MODEL PROGRAM, or has no model
 * yet and is drafted as one. Any other saved scenario (a Living Model, or a graph with neither) is refused `legacy_scenario`,
 * before any model call or write: no Living Model reader, Run pipeline, held-approval writer or action bar runs here.
 *
 * The protections are the legacy route's, reused: its claim and replay primitives (`core-route/turn-request.ts`), its write
 * accounting (ported below, line for line), its approval consent check, its delivery-unknown handling and its answer floor.
 * This file imports nothing from `routes/agent-v1-turn.ts` (`thin-core-boundary.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { getRuntimeEnv } from '../config/env-resolver.js';
import { OPENAI_ONLY, providerCallsMade, recordedProviderCalls, runWithProviderPolicy } from '../adapters/llm/provider-policy.js';
import { requestWasTyped } from '../cee/provenance/provenance-of.js';
import { acquireCoreTurnSlot, addHostTurnToConversation, CoreDeliveryUnknownError, CoreStateUnavailableError, runCoreTurn, type CoreTurnCalls } from '../orchestrator-v5/agent-lane/core/sdk-turn.js';
import { coreBudget } from '../orchestrator-v5/agent-lane/model-budgets.js';
import { AI_CORE_MODE, laneModeFor, type AgentLaneMode, type AgentToolContext } from '../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../orchestrator-v5/core-route/internal-dispatch.js';
import { WITHHELD_ON_CHIP_TURN, type AgentTurnResult } from '../orchestrator-v5/agent-lane/runtime/agent-loop.js';
import { providerFailureOf } from '../orchestrator-v5/agent-lane/runtime/transport-retry.js';
import { internalHeaders } from '../orchestrator-v5/agent-lane/internal-headers.js';
import { FRESH_READ, turnReadCache } from '../orchestrator-v5/agent-lane/turn-read-cache.js';
import { agentSelectionContext } from '../orchestrator-v5/agent-lane/selection-context.js';
import { PROGRAM_HISTORY_ROWS_READ, programHistoryOf } from '../orchestrator-v5/model-program-turn/program-history.js';
import { agentProposals as proposals } from '../orchestrator-v5/agent-lane/held-approval-offers.js';
import { programChipsFor, programHoldApplies, typedApprovalOf } from '../orchestrator-v5/model-program-turn/program-card.js';
import { reconcileProgramCards, refreshedProgramHold } from '../orchestrator-v5/model-program-turn/program-card-turn.js';
import { proposalPendingAction, rehydrateProposals, withApprovalOfferedOnRow } from '../orchestrator-v5/agent-lane/durable-proposal.js';
import {
  agentProposalOf, declinedProposalOf, heldProposalId, isHeldProposal,
  issuedTurnIdsForProposalRecords, proposalFieldsWire, proposalIssuances, proposalRecord,
} from '../orchestrator-v5/agent-lane/proposal-object/record.js';
import { parseProposalEdits } from '../orchestrator-v5/agent-lane/proposal-object/amend.js';
import { editsRefusedSentence } from '../orchestrator-v5/agent-lane/proposal-object/reply.js';
import { collectTurnReceipts } from '../orchestrator-v5/agent-lane/turn-receipts.js';
import { parseSelectedElements } from '../orchestrator-v5/boundary/request-extensions.js';
import { isRevisionConflict, ModelReadFailedError, promoteRevisionConflictResponse } from '../orchestrator-v5/graph-revision-conflict.js';
import { MODEL_WRITE_OWNERSHIP_REFUSAL_BODY, ModelWriteOwnershipRefused, readSuccessfulDoorEntries, readUnsavableEffects, recordReleasedTurnClaim } from '../orchestrator-v5/ownership/door-ownership.js';
import { appendCheckedGraphWrite } from '../orchestrator-v5/persist-graph-write.js';
import type { TurnCheck } from '../orchestrator-v5/path-b/tools/index.js';
import { APPLY_CHANGE, isChangeProposal } from '../orchestrator-v5/path-b/tools/change-tools.js';
import { runAsAgentSubturn } from '../orchestrator-v5/session/agent-subturn-context.js';
import { getSessionStore } from '../orchestrator-v5/session/index.js';
import { runWithTurnFence, unclaimedTurnFenceHandle, type TurnFenceHandle } from '../orchestrator-v5/session/turn-fence.js';
import { parsePendingAction, PENDING_ACTIONS_PER_TURN_CAP, type PendingAction } from '../orchestrator-v5/session/pending-action.js';
import type { CommittedTurnRecord } from '../orchestrator-v5/session/store.js';
import { appliedGraphWire, coreTurnStores, graphReadyEmitter, programTurnTools } from '../orchestrator-v5/core-route/deps.js';
import { programInstructions } from '../orchestrator-v5/core-route/instructions.js';
import {
  AGENT_TURN_CLAIM_WAIT, agentTurnRequestHash, challengeTargetOf, chipOperationOf, claimHashFor, claimTurnIdOf, isChiplessRetry,
  recordedOutcomeOf, recordedRunPress, recordedWithChip, requestHashOfAnswer, RUN_PRESS_HASH_TAG, requestHashOfClaim, sameAgentTurnRequest, typedRowProof, withChipOperation, withRecordedOutcome,
  type RecordedOutcome,
} from '../orchestrator-v5/core-route/turn-request.js';
import { stableStringify } from '../orchestrator/context/stable-stringify.js';
import {
  coreTurnContract, coreTurnFailure, type AuthorisedBy, type CoreTurnCard, type CoreTurnContract, type CoreTurnDurability,
  type CoreTurnError, type CoreTurnNote, type CoreTurnReceipt, type CoreTurnRun,
} from '../orchestrator-v5/core-route/contract.js';
import { CONVERSATION_ROWS_READ } from './assist.v1.scenario-graph.js';
import { runModelProgramTurn } from '../orchestrator-v5/model-program-turn/turn.js';
import { isProgramGraph, programReadOf, reopenProgram, savedProgramOf, sourceTextOf, unreadableWords } from '../orchestrator-v5/model-program-turn/program-store.js';
import { compile } from '../orchestrator-v5/model-program/compile.js';
import { applyCanvasFigure, DRAFT_REPLY_GUIDANCE, HOST_REPLY_WITHHELD_TOOLS, PROGRAM_TURN_GUIDANCE, readProgramContext, RUN_REPLY_GUIDANCE } from '../orchestrator-v5/model-program-turn/program-tools.js';
import { programOperationId } from '../orchestrator-v5/model-program-turn/program-save.js';
import { findOperationVersion } from '../orchestrator-v5/path-b/tools/core-write.js';
import { log } from '../utils/telemetry.js';

export const CORE_TURN_PATH = '/agent/v1/core-turn';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODE: AgentLaneMode = 'core';

/**
 * What a turn that ended without the AI's reply records, as the legacy route records it (`agent-v1-turn.ts`, its failed-
 * continuation row): the sentence the conversation shows, and the outcome itself, TYPED on the row's request hash
 * (`withRecordedOutcome`), so a resend replays the outcome as the contract's error and never as if the AI had said it. None
 * says the turn may be sent again. `reply_empty`: the SDK turn ended with no words of the AI's and no card waiting; the row
 * keeps whatever it returned, unmodified.
 */
const REPLY_LOST_SAVED = 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.';
const REPLY_LOST_MAY_FINISH = 'The reply didn’t arrive and may still be finishing. Nothing in your model was changed. Wait a moment, then send a new message.';
const REPLY_LOST = 'The reply didn’t arrive. Any changes already saved are kept. Send a new message to continue.';
const RECORDED: Readonly<Record<RecordedOutcome, { readonly said?: string; readonly error: CoreTurnError }>> = {
  reply_lost_saved: { said: REPLY_LOST_SAVED, error: { code: 'REPLY_NOT_DELIVERED', message: REPLY_LOST_SAVED, retry_safe: false, nothing_saved: false } },
  reply_lost_may_finish: { said: REPLY_LOST_MAY_FINISH, error: { code: 'REPLY_NOT_DELIVERED', message: REPLY_LOST_MAY_FINISH, retry_safe: false, nothing_saved: true } },
  reply_lost: { said: REPLY_LOST, error: { code: 'REPLY_NOT_DELIVERED', message: REPLY_LOST, retry_safe: false, nothing_saved: false } },
  reply_empty: { error: { code: 'REPLY_INCOMPLETE', message: 'Olumi didn’t finish its reply. Anything already saved is kept; reload to see your model, then send a new message.',
    retry_safe: false, nothing_saved: false } },
};

/** A saved scenario that is not a model program: out of the alpha, refused on every kind of turn (inventory F1b). */
const LEGACY_SCENARIO = 'This scenario was saved before the current Olumi model and cannot be opened on this route. Nothing was changed.';

/** The saved scenario as one graph read gives it, in the contract's terms. */
interface SavedScenario {
  readonly status: number;
  readonly graph: Rec | null;
  readonly revision: string | null;
  /** identity.v1 of the saved graph (`graph_identity_hash.value`): the contract's `scenario_revision`, and note_on_item's basis. */
  readonly identity: string | null;
  readonly briefText: unknown;
  readonly analysisState: unknown;
  readonly analysisResult: unknown;
  readonly run: CoreTurnRun | null;
}

function savedScenarioOf(read: { readonly status: number; readonly json: Rec }): SavedScenario {
  const json = read.status === 200 ? read.json : {};
  const graph = isRec(json.graph) ? json.graph : null;
  const currentRead = isRec(json.current_read) ? json.current_read : undefined;
  const runState = isRec(currentRead?.run_state) ? currentRead.run_state : undefined;
  const view = isRec(json.canonical_analysis_view) ? json.canonical_analysis_view : undefined;
  const runId = isRec(view?.run) ? str(view.run.run_id) : null;
  return {
    status: read.status, graph, revision: str(json.graph_hash),
    identity: isRec(json.graph_identity_hash) ? str(json.graph_identity_hash.value) : str(json.graph_identity_hash), briefText: json.brief_text,
    analysisState: isRec(json.analysis_state) ? json.analysis_state : null,
    analysisResult: isRec(json.analysis_result) ? json.analysis_result : undefined,
    run: runState === undefined || runState.kind === 'never_run' ? null : {
      run_key: runId, run_id: runId, computed_against: str(currentRead?.computed_against_hash),
      state: { kind: String(runState.kind), computed_at: str(runState.computed_at) },
    },
  };
}

/**
 * A program's Run as the reply's `run`, in the shape the scenario read gives a legacy Run, ONLY when this turn stored it (its
 * newest stored Run is not the one it started from): the UI adopts a new analysis from \`turn.run.run_id\` (read-after-write),
 * so a program reply whose turn made a Run must name it (DL 23 Oct: an in-card edit's new Run stayed unseen until a reload).
 * Current only when it is the saved model's AND today's engine's, as every other reader of a program's Run says (Codex B2 on #3801).
 */
export function programRunOf(graph: unknown, before: string | null): CoreTurnRun | null {
  const shown = reopenProgram(graph);
  const run = shown?.run ?? null;
  if (run === null || run.run_id === before) return null;
  // Computed against its receipt's revision: the `graph_hash` a program's read serves (DL ruling 26 Oct, inventory F7).
  return { run_key: run.run_id, run_id: run.run_id, computed_against: run.receipt.revision_digest,
    state: { kind: shown!.current && shown!.engine_current ? 'complete_current' : 'complete_stale', computed_at: run.computed_at } };
}
const newestRunId = (read: ReturnType<typeof programReadOf>): string | null => (read.kind === 'program' ? read.program.runs.at(-1)?.run_id ?? null : null);

/** The held proposals' cards on this read, as `_proposal_fields` builds them, each with the reply that issued it. */
async function heldCardsOf(store: ReturnType<typeof getSessionStore>, scenarioId: string, pending: readonly PendingAction[],
  read: SavedScenario): Promise<CoreTurnCard[]> {
  const graphHash = read.revision ?? undefined;
  // A program card is shown while it applies by its own rule (`programHoldApplies`, inventory F6 part b).
  const records = pending.flatMap((p) => {
    if (!isHeldProposal(p)) return [];
    const r = proposalRecord(p, read.graph);
    return r !== undefined && programHoldApplies(p, read.graph, graphHash) ? [r] : [];
  });
  if (records.length === 0) return [];
  let issuers: ReadonlyMap<string, string> = new Map();
  try {
    const rows = await store.readRecent(scenarioId, CONVERSATION_ROWS_READ);
    issuers = await issuedTurnIdsForProposalRecords(proposalIssuances(records, pending), rows, CONVERSATION_ROWS_READ,
      typeof store.readCommittedTurn === 'function' ? (id) => store.readCommittedTurn!(scenarioId, id) : undefined);
  } catch (err) {
    log.warn({ scenario_id: scenarioId, err: String(err) }, 'core-turn: card issuing window unreadable');
  }
  const wire = proposalFieldsWire(records, graphHash, issuers,
    (r) => pending.some((h) => h.id === r.revision && heldProposalId(h) === r.proposal_id && programHoldApplies(h, read.graph, graphHash)));
  return [...(wire?.proposals ?? [])];
}

/** Each saved version this turn's tools reported, with who authorised it: an approved card is the person's; a Run the AI started, Olumi's. */
function receiptsOf(result: Pick<AgentTurnResult, 'tool_calls' | 'tool_results'>): CoreTurnReceipt[] {
  const byVersion = new Map<string, CoreTurnReceipt>();
  result.tool_calls.forEach((call, i) => {
    const by: AuthorisedBy | undefined = call.name === APPLY_CHANGE ? 'person' : call.name === 'run_analysis' ? 'olumi' : undefined;
    if (by === undefined) return;
    // A core writer's receipt is the register's `model_version` (`version_number`), read as the collector reads that shape.
    const own = (result.tool_results[i] as { receipts?: readonly unknown[] } | undefined)?.receipts ?? [];
    for (const r of collectTurnReceipts([result.tool_results[i], ...own.map((model_version) => ({ model_version }))])) byVersion.set(r.version_id, { ...r, authorised_by: by });
  });
  return [...byVersion.values()];
}

/** Each call's name, outcome and typed refusal reason (with a refused save's register code), as the wire and the turn log name them. */
const toolCallsOf = (result: Pick<AgentTurnResult, 'tool_calls'>) => result.tool_calls.map((c) => ({ name: c.name,
  outcome: c.outcome ?? (c.ok ? 'ok' : 'refused'), ...(typeof c.refusal === 'string' ? { refusal: c.refusal } : {}), ...(typeof c.code === 'string' ? { code: c.code } : {}) }));

/**
 * ⭐ ONE LOG LINE PER TURN (arch plan Step 0, DL 23 Oct): each provider call (model, ms, tokens) and each tool call (outcome,
 * refusal code, the self-check's verdict and `run_ready`, the authorship decisions), by id and code only, never content.
 */
function turnLog(result: AgentTurnResult | undefined, seen: Pick<AgentTurnResult, 'tool_calls' | 'tool_results'>): Record<string, unknown> {
  // A failed turn has no result: its calls are the ones the route saw recorded before it failed.
  const calls = result ?? seen;
  return {
    provider_calls: recordedProviderCalls().map((c) => ({ model: c.returned_model ?? c.model, purpose: c.purpose,
      outcome: c.attempt?.outcome ?? c.outcome, ms: c.duration_ms, input_tokens: c.usage?.input_tokens,
      output_tokens: c.usage?.output_tokens, cached_input_tokens: c.usage?.cached_input_tokens })),
    ...(result === undefined ? {} : { stopped_reason: result.stopped_reason, timing: result.timing }),
    tool_calls: toolCallsOf(calls).map((c, i) => {
      const r = calls.tool_results[i] as { check?: TurnCheck; provider_error?: unknown } | undefined;
      // A provider call that threw: its typed fields only (status, type, code, request id), never its message.
      return { ...c, ...r?.check, ...(r?.provider_error !== undefined ? { provider_error: r.provider_error } : {}) };
    }),
  };
}

/**
 * A program's first goal whose chance is withheld, as a note on its card (DL 24 Oct, "Olumi speaks on the item"): the compiler's
 * own reason, then the AI's question (the goal's, else the first asked figure's). One per turn, as the canvas holds one. Not on
 * the turn that drafts the model: its cards reach the canvas after the turn's notes do, so the note would land on nothing.
 */
function withheldGoalNote(graph: unknown, turn: unknown): CoreTurnNote[] {
  const program = turn === 'draft' ? undefined : savedProgramOf(graph);
  if (program === undefined) return [];
  const m = program.canonical;
  const per = compile(m, { sourceText: sourceTextOf(program.person_words) }).perGoal.find((p) => p.status !== 'calculable');
  const goal = m.goals.find((g) => g.id === per?.goal_id);
  if (per === undefined || goal === undefined) return [];
  const question = goal.question ?? per.asks.map((id) => m.quantities.find((q) => q.id === id)?.question).find((x) => typeof x === 'string');
  return [{ element_id: goal.id, text: [...per.reasons, ...(question ? [question] : [])].join(' ') }];
}

export async function coreTurnRoute(app: FastifyInstance): Promise<void> {
  if (config.proxy.agentLaneEnabled !== true) return;
  const baseMode: AgentLaneMode = config.proxy.agentLanePreview === true ? 'preview' : 'full';

  /** The internal dispatch, PER REQUEST, carrying the caller's own identity (the legacy route's `dispatchFor`). */
  const dispatchFor = (authorization: string | undefined): InternalDispatch =>
    async (path, body) => {
      const res = await app.inject({
        method: 'POST',
        url: path,
        headers: internalHeaders(config.auth.assistApiKey ?? config.auth.assistApiKeys?.[0] ?? '', authorization),
        payload: body as Record<string, unknown>,
      });
      let json: Record<string, unknown> = {};
      try { json = res.json() as Record<string, unknown>; } catch { json = {}; }
      return { status: res.statusCode, json };
    };

  const handle = async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const startedAt = Date.now();
    const body = isRec(req.body) ? req.body : {};
    const scenarioId = str(body.scenario_id) ?? '';
    const turnId = str(body.turn_id);
    const send = (status: number, contract: CoreTurnContract) => reply.code(status).send(contract);
    const fail = (status: number, error: CoreTurnError, durability: CoreTurnDurability = 'not_recorded', receipts: readonly CoreTurnReceipt[] = []) =>
      send(status, coreTurnFailure(turnId, error, durability, { providerCalls: recordedProviderCalls(), receipts }));
    // The core lane runs where `laneModeFor` runs it (staging, local, test): never in production, never on a read-only preview.
    if (laneModeFor(baseMode, AI_CORE_MODE, getRuntimeEnv()) !== MODE) {
      return fail(404, { code: 'CORE_ROUTE_UNAVAILABLE', message: 'This route is not served here.', retry_safe: false, nothing_saved: true });
    }
    const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
    const graphPath = `/assist/v1/scenarios/${scenarioId}/graph`;
    const store = getSessionStore();
    const kind = typeof body.kind === 'string' ? body.kind : 'message';
    /**
     * ⭐ A CANVAS EDIT is the person's own hand on their model: one figure of the program, saved with a new Run. No model call and
     * no reply of Olumi's; the contract carries the saved state and any refusal. No other kind but a message is taken.
     */
    const canvasEdit = kind === 'system_event';
    if (!canvasEdit && kind !== 'message') {
      return fail(422, { code: 'BAD_INPUT', message: `A ${kind} turn is not taken on this route.`, retry_safe: false, nothing_saved: true });
    }
    const message = !canvasEdit && typeof body.message === 'string' ? body.message : '';
    if (scenarioId === '' || (!canvasEdit && message.trim() === '')) {
      return fail(422, { code: 'BAD_INPUT', message: canvasEdit ? 'scenario_id is required.' : 'scenario_id and message are required.', retry_safe: false, nothing_saved: true });
    }
    if (turnId === null || !UUID.test(turnId)) {
      return fail(422, { code: 'BAD_INPUT', message: '`turn_id` is required and must be a UUID.', retry_safe: false, nothing_saved: true });
    }
    const userId = req.scenarioAccess?.callerUserId ?? null;
    // A scenario's first turn creates it, on the ownership hook's own continuation (the hook has answered when it refuses).
    if (req.scenarioAccess?.provisionIfMissing && !await req.scenarioAccess.provisionIfMissing()) return reply;
    if (typeof store.readCommittedTurn !== 'function') {
      return fail(503, { code: 'TURN_STATE_UNVERIFIABLE', message: 'This turn cannot be recorded here. Nothing was run.', retry_safe: true, nothing_saved: true });
    }
    const readTurn = store.readCommittedTurn.bind(store);
    const internal = dispatchFor(authorization);
    // Every in-process call the turn makes is a SUB-TURN: a row it commits keeps no conversation text (`agent-subturn-context.ts`).
    const dispatch: InternalDispatch = (path, b) => runAsAgentSubturn(scenarioId, () => internal(path, b));
    const reused = () => fail(409, { code: 'TURN_ID_REUSED', message: 'That turn id was already used for a different message. Nothing was run or changed.',
      retry_safe: false, nothing_saved: true });

    /**
     * ── THE CLAIM (the legacy route's protocol, its primitives), taken BEFORE any forward or write, for every kind (Codex r1 on
     * #3650: a canvas edit forwarded first could commit under a turn id an approval was still answering). `mine`: this request
     * runs the turn; `same`: the same request already holds it; `refused`: its refusal has been sent.
     */
    const claimTurnId = claimTurnIdOf(turnId);
    let claimAppendSucceeded = false;
    const takeClaim = async (forRequest: string, chipless: boolean, alsoAccepts?: string): Promise<{ readonly held: 'mine'; readonly claimHash: string }
      | { readonly held: 'same' } | { readonly held: 'refused'; readonly sent: unknown }> => {
      const claimHash = claimHashFor(forRequest, randomUUID());
      let owner: CommittedTurnRecord | null;
      try {
        await appendCheckedGraphWrite({ store, writesGraph: false, source: 'agent_turn_claim', write: {
          scenario_id: scenarioId, turn_id: claimTurnId, turn_class: 'direct_answer', handler_id: null, request_hash: claimHash,
          response_emitted: false, llm_calls_used: 0, duration_ms: 0, handler_facts: [],
        } });
        claimAppendSucceeded = true;
        owner = await readTurn(scenarioId, claimTurnId);
      } catch (err) {
        if (err instanceof ModelWriteOwnershipRefused) {
          const refusalBody = MODEL_WRITE_OWNERSHIP_REFUSAL_BODY[err.reason];
          return { held: 'refused', sent: fail(403, readSuccessfulDoorEntries() > 0 || readUnsavableEffects() > 0
            ? { code: err.code, message: refusalBody.message, retry_safe: false, nothing_saved: false }
            : { code: refusalBody.error, message: refusalBody.message, retry_safe: false, nothing_saved: true }) };
        }
        log.warn({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'core-turn: turn claim failed; refusing rather than running unclaimed');
        return { held: 'refused', sent: fail(503, { code: 'TURN_STATE_UNVERIFIABLE', message: 'Could not reserve this turn. Nothing was run; please try again.', retry_safe: true, nothing_saved: true }) };
      }
      if (owner === null) {
        return { held: 'refused', sent: fail(503, { code: 'TURN_STATE_UNVERIFIABLE', message: 'Could not confirm this turn was reserved. Nothing was run; please try again.', retry_safe: true, nothing_saved: true }) };
      }
      if (owner.request_hash === claimHash) return { held: 'mine', claimHash };
      const held = requestHashOfClaim(owner.request_hash);
      return sameAgentTurnRequest(held, forRequest, chipless) || (alsoAccepts !== undefined && sameAgentTurnRequest(held, alsoAccepts, chipless))
        ? { held: 'same' } : { held: 'refused', sent: reused() };
    };

    if (canvasEdit) {
      // The edit's identity is the event itself: the same edit resent is that edit, never a second one.
      const claim = await takeClaim(agentTurnRequestHash(scenarioId, userId, '', stableStringify({ system_event: body.event ?? body.system_event ?? null })), false);
      if (claim.held === 'refused') return claim.sent;
      // One turn at a time per scenario, as for a message. A resend runs after its original, and the canvas-edit path answers
      // it from its own record: the store replays a turn id it committed and never writes it twice.
      const slot = await acquireCoreTurnSlot(scenarioId);
      try {
        // ⭐ A PROGRAM scenario's canvas figure edit (alpha): the person's own hand on ONE figure, by the id it is drawn under,
        // saved with a new Run (`applyCanvasFigure`). Any other canvas edit on a program is refused with its reason, never a 500.
        const current = savedScenarioOf(await internal(graphPath, { ...FRESH_READ }));
        const currentProgram = programReadOf(current.graph);
        if (currentProgram.kind === 'unreadable') {
          return send(409, coreTurnContract({ turnId, durability: 'not_recorded', revision: current.revision, scenarioRevision: current.identity, graph: appliedGraphWire(current.graph),
            error: { code: 'MODEL_PROGRAM_UNREADABLE', message: unreadableWords(currentProgram.reason), retry_safe: false, nothing_saved: true }, agent: { forwarded_kind: kind, program: true } }));
        }
        if (currentProgram.kind === 'program') {
          const ev = isRec(body.event) ? body.event : isRec(body.system_event) ? body.system_event : {};
          const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
          // A card's figure (by its quantity id) or a goal's target; a resend of the same edit is answered from what is saved.
          const figure = ev.kind === 'factor_value_edit' && typeof ev.target_id === 'string' && num(ev.raw_value ?? ev.value) !== undefined
            ? { target: { quantity_id: ev.target_id }, value: num(ev.raw_value ?? ev.value)! }
            : ev.kind === 'goal_target_edit' && typeof ev.goal_node_id === 'string' && num(ev.raw_value) !== undefined
              ? { target: { goal_id: ev.goal_node_id }, value: num(ev.raw_value)! } : undefined;
          // A resend of the same edit is answered from its own save: the version its operation committed, with that receipt (C7).
          // With none found it is never called saved: the first send may have been refused, or its outcome is unknown.
          const own = claim.held === 'same'
            ? await findOperationVersion(dispatch, scenarioId, programOperationId(scenarioId, `card:${turnId}`)).catch(() => null) : null;
          const edited = claim.held === 'same'
            ? own !== null ? { status: 'saved' as const, receipt: own }
              : { status: 'unknown' as const, reason: 'This edit was sent again, and Olumi could not confirm it was saved. Reload to see your model.' }
            : figure !== undefined ? await applyCanvasFigure({ dispatch }, scenarioId, { ...figure, operation_key: turnId, approver: userId })
            : { status: 'refused' as const, reason: ev.kind === 'edge_strength_edit'
              ? 'A link\'s size on this model is a figure in its own units; change it in the chat for now.'
              : 'Only a figure on a card or a goal\'s target can be edited here on this model; ask Olumi in the chat for other changes.' };
          const after = savedScenarioOf(await internal(graphPath, { ...FRESH_READ }));
          return send(edited.status === 'saved' ? 200 : edited.status === 'unknown' ? 503 : 409, coreTurnContract({
            turnId, durability: claim.held === 'same' ? (own !== null ? 'replayed' : 'unknown') : edited.status === 'saved' ? 'recorded' : edited.status === 'unknown' ? 'unknown' : 'not_recorded',
            revision: after.revision, scenarioRevision: after.identity, graph: appliedGraphWire(after.graph), run: programRunOf(after.graph, newestRunId(currentProgram)), analysisState: after.analysisState,
            receipts: edited.status === 'saved' && 'receipt' in edited && edited.receipt !== undefined ? collectTurnReceipts([{ model_version: edited.receipt }]).map((r) => ({ ...r, authorised_by: 'person' as const })) : [],
            error: edited.status === 'saved' ? null : { code: 'CANVAS_EDIT_REFUSED', message: edited.reason ?? 'That change could not be saved.', retry_safe: false, nothing_saved: edited.status !== 'unknown' },
            modelProgram: { canonical_analysis_view: reopenProgram(after.graph)?.view ?? null, model_program: { turn: 'card_edit', saved: edited.status === 'saved' } },
            agent: { forwarded_kind: kind, program: true },
          }));
        }
        // Any other saved scenario is out of the alpha: refused with its reason, nothing written (inventory F1b).
        return send(409, coreTurnContract({ turnId, durability: 'not_recorded', revision: current.revision, scenarioRevision: current.identity, graph: appliedGraphWire(current.graph),
          error: current.graph === null ? { code: 'CANVAS_EDIT_REFUSED', message: 'There is no saved model to edit yet.', retry_safe: false, nothing_saved: true }
            : { code: 'legacy_scenario', message: LEGACY_SCENARIO, retry_safe: false, nothing_saved: true },
          agent: { forwarded_kind: kind } }));
      } finally {
        slot.release();
      }
    }

    // ── WHAT WAS ASKED: the words, the press, the selection. Its hash is the turn's identity for replay. ──────────────────
    const chip = isRec(body.chip) ? body.chip : null;
    const approvedProposal = typedApprovalOf(body);
    const declinedProposal = declinedProposalOf(chip?.id);
    const runPress = approvedProposal === undefined && declinedProposal === undefined && chip?.action_type === 'run_analysis';
    const selected = parseSelectedElements(body.selected_elements);
    // The approval's own operation (`approve:<id>`), as the legacy route binds it, and the selection when there is one: a typed
    // message with neither hashes plain, so its row stays provably typed (`typedRowProof`).
    const operation = approvedProposal !== undefined || selected !== null
      ? JSON.stringify({ ...(approvedProposal !== undefined ? { approve: approvedProposal } : {}), ...(selected !== null ? { selected } : {}) })
      : undefined;
    const requestHash = withChipOperation(agentTurnRequestHash(scenarioId, userId, message, operation),
      approvedProposal === undefined ? chipOperationOf(body) : undefined, runPress ? RUN_PRESS_HASH_TAG : '');
    const chiplessRetry = isChiplessRetry(body);
    // The same Run press recorded before RUN_PRESS_HASH_TAG (its #chip: suffix untagged) is this request too: its form changed,
    // not the work (buddy on #3843). Recomputed from this exact body, never reversed from a digest; any other body stays refused.
    const untaggedRunHash = runPress ? withChipOperation(agentTurnRequestHash(scenarioId, userId, message, operation), chipOperationOf(body)) : undefined;
    const sameRequest = (stored: string): boolean => sameAgentTurnRequest(stored, requestHash, chiplessRetry)
      || (untaggedRunHash !== undefined && sameAgentTurnRequest(stored, untaggedRunHash, chiplessRetry));

    /**
     * A replay: the recorded reply, byte for byte, on today's saved state. No model call and no Run. A row whose outcome is
     * recorded (typed on its hash) replays that outcome: a lost reply as its error with no words, an empty one with its own.
     */
    const replayed = async (prior: CommittedTurnRecord) => {
      const now = savedScenarioOf(await dispatch(graphPath, { ...FRESH_READ }));
      let pending: readonly PendingAction[] = [];
      try { pending = await store.readMostRecentPendingActions?.(scenarioId, { validation: 'strict' }) ?? []; } catch { pending = []; }
      const paused = await store.readOpenAiPausedRun?.(scenarioId).catch(() => undefined);
      const outcome = recordedOutcomeOf(prior.request_hash);
      // C7: a replay says what this turn saved with each version's receipt, as its live answer did: found by the operations its
      // saves ran under (its first draft or Run, keyed by this turn; the card it approved). None found, none said.
      const ownVersion = (key: string) => findOperationVersion(dispatch, scenarioId, programOperationId(scenarioId, key)).catch(() => null);
      const [turnSave, cardSave] = await Promise.all([ownVersion(`turn:${turnId}`), approvedProposal !== undefined ? ownVersion(`proposal:${approvedProposal}`) : null]);
      // Who authorised the turn: save, from the recorded press, never this resend's envelope: a request matched exactly says it
      // (a Run press's re-save is the person's; a first draft, Olumi's); for the UI's chipless retry, the recorded hash does: a
      // Run press is tagged (RUN_PRESS_HASH_TAG), a typed turn that saved was its draft. Any other recorded chip press (one
      // recorded before the tag) cannot say which chip it was, so that save is not claimed.
      const turnSaveBy = !chiplessRetry ? (runPress ? 'person' : 'olumi')
        : recordedRunPress(prior.request_hash) ? 'person' : recordedWithChip(prior.request_hash) ? null : 'olumi';
      const receiptsOf = (v: Rec | null, by: 'olumi' | 'person' | null) => (v === null || by === null ? []
        : collectTurnReceipts([{ model_version: v }]).map((r) => ({ ...r, authorised_by: by })));
      return send(200, coreTurnContract({
        turnId, durability: 'replayed', receipts: [...receiptsOf(turnSave, turnSaveBy), ...receiptsOf(cardSave, 'person')], assistantText: outcome === undefined || outcome === 'reply_empty' ? prior.assistant_message ?? '' : '',
        revision: now.revision, scenarioRevision: now.identity, graph: appliedGraphWire(now.graph),
        cards: await heldCardsOf(store, scenarioId, pending, now),
        // In the live reply's program shape (F7): today's stored Run and the program's own view, as the UI adopts them.
        run: programRunOf(now.graph, null), analysisState: now.analysisState, ...(runPress ? { analysisResult: now.analysisResult } : {}),
        ...(isProgramGraph(now.graph) ? { modelProgram: { canonical_analysis_view: reopenProgram(now.graph)?.view ?? null, model_program: { turn: 'replay' } } } : {}),
        paused: paused != null ? { proposal_id: paused.proposal_id } : null, error: outcome === undefined ? null : RECORDED[outcome].error,
        agent: { replayed: true }, providerCalls: recordedProviderCalls(),
      }));
    };

    // A recorded answer replays before any claim; only the request that creates the claim runs.
    let prior: CommittedTurnRecord | null;
    try { prior = await readTurn(scenarioId, turnId); } catch (err) {
      log.warn({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'core-turn: prior-turn read failed; refusing rather than re-running');
      return fail(503, { code: 'TURN_STATE_UNVERIFIABLE', message: 'Could not check whether this turn already ran. Nothing was run; please try again.', retry_safe: true, nothing_saved: true });
    }
    if (prior !== null) return sameRequest(requestHashOfAnswer(prior.request_hash)) ? replayed(prior) : reused();
    const claim = await takeClaim(requestHash, chiplessRetry, untaggedRunHash);
    if (claim.held === 'refused') return claim.sent;
    if (claim.held === 'same') {
      // Another request holds this turn: wait for its answer and replay it, never run it again.
      const deadline = Date.now() + AGENT_TURN_CLAIM_WAIT.totalMs;
      for (;;) {
        let answer: CommittedTurnRecord | null = null;
        try { answer = await readTurn(scenarioId, turnId); } catch { answer = null; }
        if (answer !== null) return sameRequest(requestHashOfAnswer(answer.request_hash)) ? replayed(answer) : reused();
        if (Date.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, AGENT_TURN_CLAIM_WAIT.everyMs));
      }
      log.warn({ scenario_id: scenarioId, turn_id: turnId }, 'core-turn: turn claimed but no answer recorded; outcome unknown, not re-run');
      return fail(409, { code: 'TURN_OUTCOME_UNKNOWN', message: 'This message is already being handled, or an earlier attempt ran and its reply was not recorded. Nothing was run again; reload to see the current model.',
        retry_safe: false, nothing_saved: false }, 'unknown');
    }
    const { claimHash } = claim;

    // ── THE TURN'S WRITE ACCOUNTING (ported line for line from `agent-v1-turn.ts`: its countingDispatch and doors). ────────
    const readCache = turnReadCache(dispatch, graphPath, [`/assist/v1/scenarios/${scenarioId}/versions`]);
    let writesDispatched = 0;
    let verifiedSave = false;
    let claimReleaseRecorded = false;
    const undoRefusedWrite = async <T>(write: () => Promise<T>): Promise<T> => {
      try { return await write(); }
      catch (err) {
        // Undo only this refused attempt; an earlier step may already have written.
        if (isRevisionConflict(err)) writesDispatched -= 1;
        throw err;
      }
    };
    /** Releases the claim only while nothing was written, so a resend of the same turn id runs it again. */
    const releaseUnwrittenTurnClaim = async (): Promise<boolean> => {
      if (writesDispatched !== 0 || typeof store.releaseTurnClaim !== 'function') return false;
      try {
        await store.releaseTurnClaim(scenarioId, claimTurnId, claimHash);
        if (claimAppendSucceeded && !claimReleaseRecorded) {
          recordReleasedTurnClaim();
          claimReleaseRecorded = true;
        }
        return true;
      }
      catch (err) { log.warn({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'core-turn: claim release failed'); return false; }
    };
    /**
     * ⭐ STOP (DL 93d79c3e 09:40Z; Lenses on 50f76df0: a stopped core turn still committed). Once admitted (below) the turn holds
     * its place in the scenario's fence, so an explicit Stop finds it and records its tombstone. Each graph write it makes then
     * runs under that place (`fenced`): the register route commits it under the turn's handle, and the commit's own transaction
     * refuses it once the turn is stopped (Codex r1 on #3704: never a check before the write). A claim that fails leaves an
     * UNCLAIMED handle, so the write is refused, as on every other ingress (#759), never let through unfenced.
     */
    let fence: TurnFenceHandle | undefined;
    const fenced = <T>(write: () => Promise<T>): Promise<T> => (fence === undefined ? write() : runWithTurnFence(fence, write));
    const readingDispatch: InternalDispatch = readCache.dispatch;
    const countingDispatch: InternalDispatch = async (path, b) => {
      const sendIt = async () => promoteRevisionConflictResponse(await readingDispatch(path, b));
      if (path.endsWith('/graph/register')) {
        writesDispatched += 1;
        return undoRefusedWrite(() => fenced(sendIt));
      }
      return readingDispatch(path, b);
    };
    /** A refusal before any model call or write: the claim is released, so the same turn may be sent again. */
    const refuseUnrun = async (status: number, code: string, message: string) => {
      const released = await releaseUnwrittenTurnClaim();
      return fail(status, { code, message, retry_safe: released, nothing_saved: true });
    };

    // ── ONE TURN AT A TIME PER SCENARIO, held until the answer is persisted and read back. ───────────────────────────────
    const slot = await acquireCoreTurnSlot(scenarioId);
    // The turn's summary line, once, at its end (`turnLog`): every turn that reached the AI, whichever way it returns. The SDK
    // turn records its calls here, so a turn that throws still has them.
    let summary: { readonly result?: AgentTurnResult; readonly failed?: string } | undefined;
    const seen: CoreTurnCalls = { tool_calls: [], tool_results: [] };
    try {
      // The model as this turn starts from: read AFTER the slot, so a turn that waited sees what the turn before it saved.
      const start = await readingDispatch(graphPath, { ...FRESH_READ }).catch(() => undefined);
      if (start === undefined || (start.status !== 200 && start.status !== 404)) {
        return await refuseUnrun(503, 'MODEL_READ_FAILED', 'Your model could not be read just now. Nothing was changed; please try again.');
      }
      const saved = savedScenarioOf(start);
      // A model program that cannot be read is refused with its way on, never run as a legacy model or as no model.
      const programRead = programReadOf(saved.graph);
      if (programRead.kind === 'unreadable') return await refuseUnrun(409, 'MODEL_PROGRAM_UNREADABLE', unreadableWords(programRead.reason));
      // A saved scenario that is not a program (a Living Model, or a graph with neither) is out of the alpha (inventory F1b).
      if (programRead.kind === 'none' && saved.graph !== null) return await refuseUnrun(409, 'legacy_scenario', LEGACY_SCENARIO);

      // The held cards as the turn found them (the latest answer row), restored to this process when it forgot them.
      let heldAtStart: readonly PendingAction[] = [];
      try {
        const latest = await store.readMostRecentPendingActions(scenarioId, { validation: 'strict' });
        if (!Array.isArray(latest) || latest.some((p) => parsePendingAction(p) === null || p.scenario_id !== scenarioId)) throw new Error('pending_actions_unreadable');
        if ((approvedProposal !== undefined && proposals.get(approvedProposal) === undefined)
          || (declinedProposal !== undefined && proposals.get(declinedProposal) === undefined)
          || proposals.outstanding(scenarioId, userId).length === 0) {
          rehydrateProposals(latest, proposals, { scenario_id: scenarioId, user_id: userId }, Date.now());
        }
        heldAtStart = latest.filter(isHeldProposal);
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId }, 'core-turn: pending authority unreadable; nothing run');
        return await refuseUnrun(503, 'PENDING_ACTIONS_UNREADABLE', 'I couldn’t verify the pending changes for this scenario. I haven’t applied any changes or run analysis in this request. Please try again.');
      }

      // ── A CARD PRESS (the legacy route's ONE consent check for a core change, ported). ──────────────────────────────────
      const corePaused = approvedProposal !== undefined || declinedProposal !== undefined
        ? await store.readOpenAiPausedRun?.(scenarioId).catch(() => undefined) : undefined;
      // A pause on no card this scenario holds (an apply the AI sent with an empty id) never keeps a held card from its press.
      const stalePause = corePaused != null && !heldAtStart.some((h) => heldProposalId(h) === corePaused.proposal_id);
      const coreCardOnly = (corePaused == null || stalePause) && approvedProposal !== undefined && isChangeProposal(proposals.get(approvedProposal));
      const coreOwns = coreCardOnly || (corePaused != null
        && ((approvedProposal !== undefined && approvedProposal === corePaused.proposal_id) || (declinedProposal !== undefined && declinedProposal === corePaused.proposal_id)));
      const sentEdits = coreOwns && approvedProposal !== undefined ? parseProposalEdits(body.proposal_edits) : undefined;
      // The UI's ordinary press carries the issued card's own envelope with NO fields: that is the press, never an edit.
      let uneditedPress = false;
      if (sentEdits != null && sentEdits.fields.length === 0 && sentEdits.proposal_id === approvedProposal) {
        const issued = heldAtStart.find((h) => heldProposalId(h) === approvedProposal);
        const record = issued === undefined ? undefined : proposalRecord(issued, saved.graph);
        uneditedPress = record !== undefined && record.revision === sentEdits.revision && record.digest === sentEdits.digest;
      }
      if (coreOwns && sentEdits !== undefined && !uneditedPress) {
        return await refuseUnrun(409, 'PROPOSAL_EDITS_REFUSED', editsRefusedSentence(sentEdits === null ? 'malformed' : 'refused'));
      }
      // Its words must be the offered card's own button words (a chip sends them), on a card this scenario holds.
      const offeredCard = approvedProposal === undefined ? undefined : heldAtStart.map((h) => proposalRecord(h, undefined)?.approve_action)
        .find((c) => c !== undefined && typedApprovalOf({ chip: { id: c.id } }) === approvedProposal);
      const press = !coreOwns ? undefined
        : approvedProposal !== undefined ? (offeredCard !== undefined && offeredCard.message === message ? { decision: 'approve' as const, proposal_id: approvedProposal } : undefined)
        : { decision: 'decline' as const, proposal_id: declinedProposal! };
      // A card that never paused, declined: set aside here, as the legacy route's withdraw does. No model call.
      const declinedCardOnly = declinedProposal !== undefined && !coreOwns
        && heldAtStart.some((h) => heldProposalId(h) === declinedProposal) ? declinedProposal : undefined;
      if ((approvedProposal !== undefined && press === undefined) || (declinedProposal !== undefined && !coreOwns && declinedCardOnly === undefined)) {
        return await refuseUnrun(409, 'CARD_NOT_WAITING', 'That change is no longer waiting for your approval. Nothing in your model was changed.');
      }

      if (typeof store.claimTurnFence === 'function') {
        try { fence = (await store.claimTurnFence(scenarioId, String(turnId))) ?? unclaimedTurnFenceHandle(scenarioId, String(turnId)); }
        catch (err) {
          log.error({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'core-turn: fence claim threw; this turn is UNCLAIMED and its graph writes are refused');
          fence = unclaimedTurnFenceHandle(scenarioId, String(turnId));
        }
      }

      // ── THE TURN'S CONTEXT: the person's own words, the selection, the Challenge. ───────────────────────────────────────
      const typedNow = requestWasTyped(body) ? message : null;
      // The program's own reader of the conversation (F7): its proven typed words and the turns before this one.
      let earlier: ReturnType<typeof programHistoryOf> = { verified: [], earlierTurns: [] };
      try {
        earlier = programHistoryOf(await store.readRecent(scenarioId, PROGRAM_HISTORY_ROWS_READ), typedRowProof(scenarioId, userId));
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId }, 'core-turn: durable conversation unreadable; earlier words stay unknown');
      }
      const earlierTurns = [...earlier.earlierTurns];
      const verified = [...earlier.verified, ...(typedNow === null ? [] : [typedNow])];
      // What a program's tools read of the person's words: this turn's typed message and every proven typed one.
      const coreCtx: AgentToolContext = { scenario_id: scenarioId, authenticated_user_id: userId, request_id: String(req.id), turn_id: turnId,
        user_turn_text: typedNow ?? '', verified_user_messages: verified };
      const nodes = Array.isArray(saved.graph?.nodes) ? (saved.graph.nodes as unknown[]).filter(isRec) : [];
      const edges = Array.isArray(saved.graph?.edges) ? (saved.graph.edges as unknown[]).filter(isRec) : [];
      const selectionContext = agentSelectionContext(selected, saved.graph === null ? undefined : { ok: true,
        entities: nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label })), links: edges.map((e) => ({ id: e.id, from: e.from, to: e.to })) });
      const challenge = challengeTargetOf(body, selectionContext, saved.graph);

      const program = programRead.kind === 'program';
      // A Run press on a program is the host's own (the stored Run, or a new one): no model call.
      const modelProgram = saved.graph === null || (program && runPress);

      // ── THE SDK TURN (or the declined card, which needs none). ───────────────────────────────────────────────────────────
      let result: AgentTurnResult & { readonly sdk?: Awaited<ReturnType<typeof runCoreTurn>>['sdk'] };
      /**
       * ⭐ THE CANONICAL DRAFTER (alpha, 23 Oct): a scenario with no saved model is drafted as a MODEL PROGRAM
       * (`model-program-turn/turn.ts`), in place of the core agent's drafting; so is an ask card's structured answer on one.
       * Every other turn of a program scenario is the core agent's own, with its tools on the program (`scenario: 'program'`).
       * The write goes through this turn's counting dispatch, so the claim, the write accounting and the answer row below are
       * the core route's own.
       */
      let programPayload: { readonly canonical_analysis_view: unknown; readonly model_program: Record<string, unknown> } | undefined;
      /** The AI wrote this host turn's reply (T1), so it is already in the scenario's Conversation. */
      let aiReplied = false;
      /** The host's own turn (a draft, or a Run press), once it has run: what it saved stands whatever its reply then does (C7). */
      let hostTurn: AgentTurnResult | undefined;
      /** Each saved version these calls reported, with who authorised it: a drafted first model's is Olumi's, every other the person's. */
      const turnReceipts = (calls: Pick<AgentTurnResult, 'tool_calls' | 'tool_results'>): CoreTurnReceipt[] => (programPayload === undefined ? receiptsOf(calls)
        : collectTurnReceipts(calls.tool_results).map((r) => ({ ...r, authorised_by: programPayload!.model_program['turn'] === 'draft' ? 'olumi' as const : 'person' as const })));
      const programTurn = async (): Promise<AgentTurnResult> => {
        const t0 = Date.now();
        const out = await runModelProgramTurn({ scenarioId, turnId, message, saved: { graph: saved.graph, identity: saved.identity }, dispatch: countingDispatch,
          onModelRegistered: graphReadyEmitter(startedAt), proposals, userId });
        if (out.verifiedSave) verifiedSave = true;
        programPayload = out.payload;
        const ms = Date.now() - t0;
        hostTurn = { assistant_text: out.assistantText, items: [], tool_calls: out.toolCalls.map((c) => ({ ...c, mutated: c.mutated ?? out.mutated })),
          tool_results: out.toolResults, mutated: out.mutated, hops: 0, stopped_reason: 'answered',
          timing: { total_ms: ms, provider_ms: 0, tool_ms: ms, overhead_ms: 0, tool_provider_ms: 0, provider_calls: providerCallsMade() ?? 0, tool_calls: 1, hops: 0 } };
        return hostTurn;
      };
      if (declinedCardOnly !== undefined) {
        proposals.discard(declinedCardOnly);
        result = { assistant_text: '', items: [], tool_calls: [], tool_results: [], mutated: false, hops: 0, stopped_reason: 'answered',
          timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 } };
      } else {
        // The agent's view, read only for its turn: the program's own.
        const canonical = modelProgram ? undefined : await readProgramContext({ dispatch: readingDispatch, proposals }, { scenario_id: scenarioId, authenticated_user_id: userId });
        // One budget for every call (DL 22 Oct, M4): a press at the typed turn's effort reads the typed turns' cached prefix. The
        // standing instructions are the same bytes on every call of every scenario (the cached prefix); this turn's own guidance
        // follows its state block in the turn's input.
        const agentTurn = () => ({
          ctx: coreCtx, message, budget: coreBudget(), userId,
          calls: seen,
          tools: programTurnTools({ ctx: coreCtx, mode: MODE, dispatch: countingDispatch, proposals, onVerifiedSave: () => { verifiedSave = true; } }),
          instructions: programInstructions(),
          // A pause must name a card this scenario holds, awaiting approval (`sdk-turn.ts`).
          isPendingCard: (id: string) => proposals.outstanding(coreCtx.scenario_id, coreCtx.authenticated_user_id).some((p) => p.proposal_id === id),
          ...coreTurnStores(store),
        });
        try {
          if (modelProgram) {
            result = await programTurn();
            // T1 (Paul 26 Oct): once the host has drafted and run the model, or run it on a press, the AI writes the reply from
            // the model and Run as saved, as it does on every typed turn; it may not draft, propose, apply or run. There is no
            // template fallback (Paul 26 Oct: "if the AI reply fails, show an error instead"; the host's reply words are kept in
            // turn.ts, unwired here): a failed reply is the turn's lost reply below, the save kept and said; an empty one is
            // `reply_empty`. A draft or Run the host could not save (no Run view, a refused or unconfirmed save) keeps its own
            // words: they are that turn's error, not a reply about a model.
            const kept = programPayload?.model_program;
            if (programPayload?.canonical_analysis_view != null && (kept?.['saved'] === true || kept?.['stored'] === true)) {
              const fresh = await readProgramContext({ dispatch: readingDispatch, proposals }, { scenario_id: scenarioId, authenticated_user_id: userId });
              if (fresh.status !== 'ok') throw new ModelReadFailedError(fresh);
              const reply = await runCoreTurn({ ...agentTurn(),
                turnGuidance: [PROGRAM_TURN_GUIDANCE, runPress ? RUN_REPLY_GUIDANCE : DRAFT_REPLY_GUIDANCE],
                briefText: saved.graph === null ? undefined : saved.briefText,
                canonicalState: fresh.data, withheldTools: [...HOST_REPLY_WITHHELD_TOOLS] });
              result = { ...result, assistant_text: reply.assistant_text, sdk: reply.sdk, hops: result.hops + reply.hops,
                timing: { ...result.timing, provider_calls: providerCallsMade() ?? result.timing.provider_calls + reply.timing.provider_calls } };
              aiReplied = true;
            }
          } else {
            result = await runCoreTurn({ ...agentTurn(),
              turnGuidance: [PROGRAM_TURN_GUIDANCE, ...(challenge === null ? [] : [challenge.note])],
              briefText: saved.briefText,
              // A program's first agent turn opens its Conversation with the turns before it, the host-written draft reply included.
              ...(program ? { earlierTurns } : {}),
              canonicalState: canonical?.status === 'ok' ? canonical.data : undefined,
              // A press carries no consent to Run (a Run press is the host's own, above).
              withheldTools: chip !== null ? ['run_analysis'] : [],
              // A program board has no note tool, so the AI answers a Challenge's note (in turnGuidance) in words.
              ...(coreCardOnly && press !== undefined ? { firstTool: APPLY_CHANGE } : {}),
              ...(press !== undefined ? { press } : {}),
              ...(saved.revision !== null ? { traceMeta: { revision: saved.revision, ...(saved.run?.run_id != null ? { run_id: saved.run.run_id } : {}) } } : {}),
            });
          }
        } catch (err) {
          log.error({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'core-turn: the turn failed');
          // A core call whose provider delivery is unknown keeps its claim: Olumi wrote nothing, but the call may still be running.
          const deliveryUnknown = err instanceof CoreDeliveryUnknownError;
          summary = { failed: deliveryUnknown ? 'delivery_unknown' : 'turn_failed' };
          const released = deliveryUnknown ? false : await releaseUnwrittenTurnClaim();
          const lost: RecordedOutcome = verifiedSave ? 'reply_lost_saved' : deliveryUnknown && writesDispatched === 0 ? 'reply_lost_may_finish' : 'reply_lost';
          // A possible save keeps its claim: record the outcome as the answer, so a resend replays it and reads current state.
          let continuationRecorded = false;
          if (!released && (writesDispatched > 0 || deliveryUnknown) && claimAppendSucceeded) {
            try {
              await appendCheckedGraphWrite({ store, writesGraph: false, source: 'agent_turn',
                heldProposals: { isHeld: isHeldProposal, seenByThisRequest: new Set<string>() },
                write: { scenario_id: scenarioId, turn_id: turnId, turn_class: 'direct_answer', handler_id: null, request_hash: withRecordedOutcome(requestHash, lost),
                  response_emitted: false, llm_calls_used: providerCallsMade() ?? 0, duration_ms: Date.now() - startedAt, handler_facts: [],
                  userMessage: message, assistantMessage: RECORDED[lost].said } });
              continuationRecorded = true;
            } catch (recordErr) {
              log.warn({ err: String(recordErr), scenario_id: scenarioId, turn_id: turnId }, 'core-turn: failed continuation answer could not be recorded');
            }
          }
          const nothingSaved = writesDispatched === 0 && !verifiedSave;
          // A released claim runs again; a recorded continuation replays; otherwise this outcome is not known to a resend.
          const durable: CoreTurnDurability = released ? 'not_recorded' : continuationRecorded ? 'recorded' : 'unknown';
          // C7 (27 Oct): what this turn saved before it failed (its readback, or the AI's reply after a save) is said with each
          // saved version's receipt, as on a turn that answered; a save whose outcome is unknown has none.
          const savedReceipts = turnReceipts(hostTurn ?? seen);
          if (err instanceof ModelReadFailedError) {
            return fail(503, { code: 'MODEL_READ_FAILED', message: 'Your model could not be read just now.', retry_safe: released, nothing_saved: nothingSaved }, durable, savedReceipts);
          }
          if (isRevisionConflict(err)) {
            return fail(409, { code: 'REVISION_CONFLICT', message: 'Your model changed while this turn ran. Reload to see it, then send your message again.',
              retry_safe: released, nothing_saved: nothingSaved }, durable, savedReceipts);
          }
          if (err instanceof CoreStateUnavailableError) {
            return fail(503, { code: err.code, message: 'Olumi could not keep this conversation’s state, so it did not run the turn.', retry_safe: released, nothing_saved: nothingSaved }, durable, savedReceipts);
          }
          // A lost delivery is reported with ITS cause, never Olumi's own code as if the provider had sent it.
          const failure = providerFailureOf(deliveryUnknown ? (err as CoreDeliveryUnknownError).cause : err);
          return fail(502, { code: String(failure.error), message: RECORDED[lost].error.message, retry_safe: released, nothing_saved: nothingSaved }, durable, savedReceipts);
        }
      }
      summary = { result };

      // ── THE ANSWER: the saved state as it now stands, the held cards, and the row a replay reads. ──────────────────────
      const after = savedScenarioOf(await readingDispatch(graphPath, { ...FRESH_READ }));
      const paused = result.sdk?.paused;
      const noReply = result.assistant_text.trim() === '' && paused === undefined && declinedCardOnly === undefined;
      // The model's text exactly as returned (Codex r1 on #3650: " \n" became ""); only whether it says anything is decided here.
      const assistantText = result.assistant_text;
      let latestPending: readonly PendingAction[] = heldAtStart;
      try { latestPending = await store.readMostRecentPendingActions?.(scenarioId, { validation: 'strict' }) ?? heldAtStart; } catch { /* the floor re-reads it */ }
      const graphHash = after.revision ?? undefined;
      // The program's cards across this turn (`program-card-turn.ts`, inventory F6 part b): a card declined on its press or on the
      // resumed pause goes; one whose revision moved is kept for review; an expired or vanished one lapses.
      const declined = new Set<string>([...(declinedCardOnly !== undefined ? [declinedCardOnly] : []),
        ...(result.sdk?.resumed?.answer === 'declined' && corePaused != null && corePaused.proposal_id !== null ? [corePaused.proposal_id] : [])]);
      const reconciled = reconcileProgramCards({ atStart: heldAtStart, latest: latestPending, isApplied: (id) => proposals.isApplied(id), declined,
        graph: after.graph, graphHash, scenarioId, nowMs: Date.now() });
      for (const l of reconciled.lapsed) proposals.discard(heldProposalId(l));
      // This turn's own cards: each proposal the AI prepared (or paused on), from the STORED proposal, never its prose.
      const emittedAtIso = new Date().toISOString();
      let liveHolds: PendingAction[] = [...reconciled.carried];
      const chips = programChipsFor(result.tool_calls.filter((c) => c.refusal !== WITHHELD_ON_CHIP_TURN),
        (id) => ({ proposal: proposals.get(id), result: result.tool_results.find((r) => r.proposal_id === id) }));
      for (const chipOffered of chips) {
        const id = typedApprovalOf({ chip: { id: chipOffered.id } });
        const p = id === undefined ? undefined : proposals.get(id);
        if (id === undefined || p === undefined || liveHolds.some((h) => heldProposalId(h) === id)) continue;
        liveHolds.push(refreshedProgramHold(proposalPendingAction(p, chipOffered as Parameters<typeof proposalPendingAction>[1], { scenario_id: scenarioId, emitted_at_iso: emittedAtIso }), Date.now()));
      }
      liveHolds.sort((a, b) => a.emitted_at_iso.localeCompare(b.emitted_at_iso));
      if (liveHolds.length > PENDING_ACTIONS_PER_TURN_CAP) {
        // The row holds at most PENDING_ACTIONS_PER_TURN_CAP (a DB CHECK): the oldest are kept, the rest set aside and logged.
        for (const h of liveHolds.slice(PENDING_ACTIONS_PER_TURN_CAP)) if (agentProposalOf(h) !== undefined) proposals.discard(heldProposalId(h));
        log.warn({ scenario_id: scenarioId, set_aside: liveHolds.slice(PENDING_ACTIONS_PER_TURN_CAP).map((h) => heldProposalId(h)) }, 'core-turn: held cards over the row cap');
        liveHolds = liveHolds.slice(0, PENDING_ACTIONS_PER_TURN_CAP);
      }
      const durablePending = liveHolds.map((p) => withApprovalOfferedOnRow(p, true));
      let rowPending: readonly PendingAction[] = durablePending;
      let durability: CoreTurnDurability = 'not_recorded';
      try {
        const outcome = await appendCheckedGraphWrite({ store, writesGraph: false, source: 'agent_turn', baseGraphForInvariants: after.graph,
          heldProposals: { isHeld: isHeldProposal, seenByThisRequest: new Set([...heldAtStart, ...latestPending].filter(isHeldProposal).map((h) => h.chip_id)),
            offeredChipIds: new Set(durablePending.map((p) => p.chip_id)),
            onReconciled: (write) => { rowPending = write.pending_actions ?? []; return write; } },
          write: { scenario_id: scenarioId, turn_id: turnId, turn_class: 'direct_answer', handler_id: null,
            request_hash: noReply ? withRecordedOutcome(requestHash, 'reply_empty') : requestHash,
            response_emitted: true, llm_calls_used: providerCallsMade() ?? result.hops + 1, duration_ms: Date.now() - startedAt, handler_facts: [],
            userMessage: message, assistantMessage: assistantText,
            ...(durablePending.length > 0 ? { pending_actions: durablePending } : {}) } });
        if (outcome.priorTurnConflict === true) {
          return fail(409, { code: 'TURN_ID_REUSED', message: 'That turn id was already used for a different message. This reply was not recorded.',
            retry_safe: false, nothing_saved: writesDispatched === 0 && !verifiedSave });
        }
        if (outcome.replayedPriorTurn === true) {
          const first = await readTurn(scenarioId, turnId);
          if (first !== null) return await replayed(first);
        }
        durability = 'recorded';
        // C12: a reply the host wrote (a program's Run press, or a draft) joins the agent's Conversation once it has one.
        if (modelProgram && !aiReplied) await addHostTurnToConversation({ scenarioId, userText: message, assistantText, ...coreTurnStores(store) });
      } catch (err) {
        if (err instanceof ModelWriteOwnershipRefused) {
          const released = await releaseUnwrittenTurnClaim();
          const refusalBody = MODEL_WRITE_OWNERSHIP_REFUSAL_BODY[err.reason];
          return fail(403, { code: refusalBody.error, message: refusalBody.message, retry_safe: released,
            nothing_saved: readSuccessfulDoorEntries() === 0 && writesDispatched === 0 });
        }
        // The answer is real and the writes already happened: it is returned, flagged as not recorded.
        log.error({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'core-turn: answer could not be recorded; the claim stands, so a resend reports an unknown outcome and never re-runs');
      }
      // A Run a call confirmed ships its result only while the fresh read still selects that same Run: a Run that landed while
      // the reply was written is not this turn's (Codex r1 on #3668).
      const confirmed = result.tool_results.flatMap((r) => (r.ran === true && typeof r.run_id === 'string' ? [r.run_id] : []));
      const ranThisTurn = runPress || (confirmed.length > 0 && confirmed[confirmed.length - 1] === after.run?.run_id);
      const cards = await heldCardsOf(store, scenarioId, rowPending, after);
      return send(200, coreTurnContract({
        turnId, durability, assistantText,
        revision: after.revision, scenarioRevision: after.identity, graph: appliedGraphWire(after.graph),
        cards,
        // A held change card is the person's next step (it may hold their answer), so the goal's question is not asked beside it.
        notes: cards.some((c) => c.reading !== true) ? [] : withheldGoalNote(after.graph, programPayload?.model_program['turn']),
        run: programRunOf(after.graph, newestRunId(programRead)), analysisState: after.analysisState, ...(ranThisTurn ? { analysisResult: after.analysisResult } : {}),
        receipts: turnReceipts(result),
        // A program scenario's analysis is its newest STORED Run as the scenario read serves it (never a recompute), on every turn.
        ...(programPayload !== undefined || isProgramGraph(after.graph) ? { modelProgram: {
          canonical_analysis_view: reopenProgram(after.graph)?.view ?? programPayload?.canonical_analysis_view ?? null,
          model_program: programPayload?.model_program ?? { turn: 'agent' } } } : {}),
        paused: paused !== undefined ? { proposal_id: paused.proposal_id } : null,
        error: noReply ? RECORDED.reply_empty.error : null,
        // A refused or unavailable call names its typed reason (DL 22 Oct: which of Class 3's offers fired was not on the wire).
        agent: { mode: MODE, stopped_reason: result.stopped_reason, tool_calls: toolCallsOf(result), ...(result.sdk !== undefined ? { sdk: result.sdk } : {}) },
        providerCalls: recordedProviderCalls(),
      }));
    } finally {
      // Only a turn that reached the AI: a refusal before any call (the declined card, an unreadable conversation) logs none.
      if (summary !== undefined && recordedProviderCalls().some((c) => c.outcome === 'allowed')) {
        try {
          log.info({ event: 'core_turn.summary', scenario_id: scenarioId, turn_id: turnId, request_id: String(req.id),
            ...(summary.failed !== undefined ? { failed: summary.failed } : {}), ...turnLog(summary.result, seen) }, 'core-turn: summary');
        } catch { /* a log line never decides the reply */ }
      }
      slot.release();
    }
  };

  app.post(CORE_TURN_PATH, { config: { scenarioId: { from: 'body', key: 'scenario_id' } } }, (req: FastifyRequest, reply: FastifyReply) =>
    runWithProviderPolicy({ ...OPENAI_ONLY('agent_core_turn'), request_id: String(req.id),
      scenario_id: (req.body as { scenario_id?: string })?.scenario_id, turn_id: (req.body as { turn_id?: string })?.turn_id }, () => handle(req, reply)));

  log.info({ event: 'agent_lane.core_route_mounted' }, `POST ${CORE_TURN_PATH} mounted`);
}
