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
 * their checks. A canvas edit goes through the existing core canvas-edit path (`/orchestrate/v2/turn` with the core header).
 * A legacy scenario (a saved graph with no living model) is refused: it is out of the PoC.
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
import { buildCanonicalAnalysisReadyFromGraph } from '../orchestrator/tools/analysis-ready-helper.js';
import { acquireCoreTurnSlot, CoreDeliveryUnknownError, CoreStateUnavailableError, runCoreTurn } from '../orchestrator-v5/agent-lane/core/sdk-turn.js';
import { coreBudget } from '../orchestrator-v5/agent-lane/model-budgets.js';
import { AI_CORE_MODE, laneModeFor, type AgentLaneMode, type AgentToolContext } from '../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { WITHHELD_ON_CHIP_TURN, type AgentTurnResult } from '../orchestrator-v5/agent-lane/runtime/agent-loop.js';
import { providerFailureOf } from '../orchestrator-v5/agent-lane/runtime/transport-retry.js';
import { internalHeaders } from '../orchestrator-v5/agent-lane/internal-headers.js';
import { FRESH_READ, turnReadCache } from '../orchestrator-v5/agent-lane/turn-read-cache.js';
import { agentSelectionContext } from '../orchestrator-v5/agent-lane/selection-context.js';
import { DURABLE_SEED_ROWS_READ, HistoryStore, historyFromDurableTurns } from '../orchestrator-v5/agent-lane/history-store.js';
import { agentProposals as proposals } from '../orchestrator-v5/agent-lane/held-approval-offers.js';
import { approvalChipsFor, typedApprovalOf, withdrawnThisTurn } from '../orchestrator-v5/agent-lane/approval-chips.js';
import { proposalPendingAction, rehydrateProposals, withApprovalOfferedOnRow } from '../orchestrator-v5/agent-lane/durable-proposal.js';
import {
  agentProposalOf, declinedProposalOf, heldProposalId, heldRecordAppliesAt, heldRecordsApplyAt, isHeldProposal,
  issuedTurnIdsForProposalRecords, proposalFieldsWire, proposalIssuances, proposalRecord,
} from '../orchestrator-v5/agent-lane/proposal-object/record.js';
import { reconcileHeldProposals, refreshedHold } from '../orchestrator-v5/agent-lane/proposal-object/lifecycle.js';
import { heldCardStillApplies, heldCardSubjectMoved } from '../orchestrator-v5/agent-lane/proposal-object/still-applies.js';
import { parseProposalEdits } from '../orchestrator-v5/agent-lane/proposal-object/amend.js';
import { editsRefusedSentence } from '../orchestrator-v5/agent-lane/proposal-object/reply.js';
import { collectTurnReceipts } from '../orchestrator-v5/agent-lane/turn-receipts.js';
import { readRecordedRun, restoreRunOperation, runOperationTurnId, type RecoveredRun } from '../orchestrator-v5/agent-lane/run-operation.js';
import { parseSelectedElements } from '../orchestrator-v5/boundary/request-extensions.js';
import { awaitsTimingReading, carriedEffectsTiming } from '../orchestrator-v5/goal-target/carried-effects-timing.js';
import { bindHeldApprovalWriter, commitHeldProposalInProcess } from '../orchestrator-v5/handlers/approve-held-proposal.js';
import { isRevisionConflict, ModelReadFailedError, promoteRevisionConflictResponse } from '../orchestrator-v5/graph-revision-conflict.js';
import { MODEL_WRITE_OWNERSHIP_REFUSAL_BODY, ModelWriteOwnershipRefused, readSuccessfulDoorEntries, readUnsavableEffects, recordReleasedTurnClaim } from '../orchestrator-v5/ownership/door-ownership.js';
import { appendCheckedGraphWrite } from '../orchestrator-v5/persist-graph-write.js';
import { CORE_DRAFTER_RULES } from '../orchestrator-v5/path-b/drafting-guidance.js';
import { readCanonicalContext, type TurnCheck } from '../orchestrator-v5/path-b/tools/index.js';
import { APPLY_CHANGE, isChangeProposal } from '../orchestrator-v5/path-b/tools/change-tools.js';
import { NOTE_ON_ITEM } from '../orchestrator-v5/path-b/tools/note-on-item.js';
import type { Restructure } from '../orchestrator-v5/path-b/tools/goal-path.js';
import { livingViewOf } from '../orchestrator-v5/path-b/living-model/view.js';
import { runAsAgentSubturn } from '../orchestrator-v5/session/agent-subturn-context.js';
import { getSessionStore } from '../orchestrator-v5/session/index.js';
import { parsePendingAction, PENDING_ACTIONS_PER_TURN_CAP, type PendingAction } from '../orchestrator-v5/session/pending-action.js';
import type { CommittedTurnRecord } from '../orchestrator-v5/session/store.js';
import {
  appliedGraphWire, constructionDeadline, CORE_RUN_PRESS_WITHHELD, coreTurnCapabilities, coreTurnStores, coreTurnTools, graphReadyEmitter,
} from '../orchestrator-v5/core-route/deps.js';
import { CORE_ALIGNED_INSTRUCTIONS, draftArmOf, instructionsForMode } from '../orchestrator-v5/core-route/instructions.js';
import {
  AGENT_TURN_CLAIM_WAIT, agentTurnRequestHash, challengeTargetOf, chipOperationOf, claimHashFor, claimTurnIdOf, isChiplessRetry,
  recordedOutcomeOf, requestHashOfAnswer, requestHashOfClaim, sameAgentTurnRequest, typedRowProof, withChipOperation, withRecordedOutcome,
  type RecordedOutcome,
} from '../orchestrator-v5/core-route/turn-request.js';
import { stableStringify } from '../orchestrator/context/stable-stringify.js';
import {
  coreTurnContract, coreTurnFailure, type AuthorisedBy, type CoreTurnCard, type CoreTurnContract, type CoreTurnDurability,
  type CoreTurnError, type CoreTurnNote, type CoreTurnReceipt, type CoreTurnRun,
} from '../orchestrator-v5/core-route/contract.js';
import { CONVERSATION_ROWS_READ } from './assist.v1.scenario-graph.js';
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
  readonly analysisReady: unknown;
  readonly run: CoreTurnRun | null;
  /** The selected Run, only while it is current and identified (what `readRecordedRun` binds a recovered Run to). */
  readonly currentRun?: { readonly runId: string; readonly graphHashAtRun: string; readonly computedAt: string };
}

function savedScenarioOf(read: { readonly status: number; readonly json: Rec }): SavedScenario {
  const json = read.status === 200 ? read.json : {};
  const graph = isRec(json.graph) ? json.graph : null;
  const currentRead = isRec(json.current_read) ? json.current_read : undefined;
  const runState = isRec(currentRead?.run_state) ? currentRead.run_state : undefined;
  const view = isRec(json.canonical_analysis_view) ? json.canonical_analysis_view : undefined;
  const runId = isRec(view?.run) ? str(view.run.run_id) : null;
  // Readiness as the legacy readback takes it: the read's own, else the canonical builder over the same graph.
  let analysisReady: unknown = json.analysis_ready ?? currentRead?.analysis_ready;
  if (analysisReady === undefined && graph !== null) {
    try { analysisReady = buildCanonicalAnalysisReadyFromGraph(graph); } catch { /* readiness is never a gate on the answer */ }
  }
  const current = runState?.kind === 'complete_current' ? {
    runId: str(currentRead?.run_id), graphHashAtRun: str(currentRead?.computed_against_hash), computedAt: str(runState.computed_at),
  } : undefined;
  return {
    status: read.status, graph, revision: str(json.graph_hash),
    identity: isRec(json.graph_identity_hash) ? str(json.graph_identity_hash.value) : str(json.graph_identity_hash), briefText: json.brief_text,
    analysisState: isRec(json.analysis_state) ? json.analysis_state : null,
    analysisResult: isRec(json.analysis_result) ? json.analysis_result : undefined,
    analysisReady,
    run: runState === undefined || runState.kind === 'never_run' ? null : {
      run_key: runId, run_id: runId, computed_against: str(currentRead?.computed_against_hash),
      state: { kind: String(runState.kind), computed_at: str(runState.computed_at) },
    },
    ...(current?.runId != null && current.graphHashAtRun != null && current.computedAt != null
      ? { currentRun: { runId: current.runId, graphHashAtRun: current.graphHashAtRun, computedAt: current.computedAt } } : {}),
  };
}

/** Whether readiness admits a Run: `may_run` when present, else `status === 'ready'` (the legacy route's `admitsRunOffer`). */
const admitsRun = (analysisReady: unknown): boolean => {
  const ar = (analysisReady ?? {}) as { may_run?: unknown; status?: unknown };
  return typeof ar.may_run === 'boolean' ? ar.may_run : ar.status === 'ready';
};

/** The held proposals' cards on this read, as `_proposal_fields` builds them, each with the reply that issued it. */
async function heldCardsOf(store: ReturnType<typeof getSessionStore>, scenarioId: string, pending: readonly PendingAction[],
  read: SavedScenario): Promise<CoreTurnCard[]> {
  const graphHash = read.revision ?? undefined;
  const records = pending.flatMap((p) => {
    if (!isHeldProposal(p)) return [];
    const r = proposalRecord(p, read.graph);
    return r !== undefined && heldRecordAppliesAt(p, r, read.graph, graphHash) ? [r] : [];
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
  const wire = proposalFieldsWire(records, graphHash, issuers, heldRecordsApplyAt(pending, read.graph, graphHash));
  return [...(wire?.proposals ?? [])];
}

/** Each saved version this turn's tools reported, with who authorised it: the drafted first model is Olumi's, an approved card the person's. */
function receiptsOf(result: Pick<AgentTurnResult, 'tool_calls' | 'tool_results'>): CoreTurnReceipt[] {
  const byVersion = new Map<string, CoreTurnReceipt>();
  result.tool_calls.forEach((call, i) => {
    const by: AuthorisedBy | undefined = call.name === 'build_model_from_brief' ? 'olumi' : call.name === APPLY_CHANGE ? 'person' : undefined;
    if (by === undefined) return;
    // A core writer's receipt is the register's `model_version` (`version_number`), read as the collector reads that shape.
    const own = (result.tool_results[i] as { receipts?: readonly unknown[] } | undefined)?.receipts ?? [];
    for (const r of collectTurnReceipts([result.tool_results[i], ...own.map((model_version) => ({ model_version }))])) byVersion.set(r.version_id, { ...r, authorised_by: by });
  });
  return [...byVersion.values()];
}

/** Each call's name, outcome and typed refusal reason, as the wire and the turn log name them. */
const toolCallsOf = (result: Pick<AgentTurnResult, 'tool_calls'>) => result.tool_calls.map((c) => ({ name: c.name,
  outcome: c.outcome ?? (c.ok ? 'ok' : 'refused'), ...(typeof c.refusal === 'string' ? { refusal: c.refusal } : {}) }));

/**
 * ⭐ ONE LOG LINE PER TURN (arch plan Step 0, DL 23 Oct): each provider call (model, ms, tokens) and each tool call (outcome,
 * refusal code, the self-check's verdict and `run_ready`, the authorship decisions), by id and code only, never content.
 */
function turnLog(result: AgentTurnResult | undefined): Record<string, unknown> {
  return {
    provider_calls: recordedProviderCalls().map((c) => ({ model: c.returned_model ?? c.model, purpose: c.purpose,
      outcome: c.attempt?.outcome ?? c.outcome, ms: c.duration_ms, input_tokens: c.usage?.input_tokens,
      output_tokens: c.usage?.output_tokens, cached_input_tokens: c.usage?.cached_input_tokens })),
    ...(result === undefined ? {} : { stopped_reason: result.stopped_reason, timing: result.timing,
      tool_calls: toolCallsOf(result).map((c, i) => ({ ...c, ...(result.tool_results[i] as { check?: TurnCheck } | undefined)?.check })) }),
  };
}

/** note_on_item's note, only while the saved model is still the one it was read on (its identity.v1 basis). */
function notesOf(result: Pick<AgentTurnResult, 'tool_results'>, identityNow: string | null): CoreTurnNote[] {
  return result.tool_results.flatMap((r) => {
    const directive = (r as { ui_directive?: unknown }).ui_directive;
    const basis = (r as { note_basis?: unknown }).note_basis;
    if (!isRec(directive) || typeof basis !== 'string' || identityNow === null || basis !== identityNow) return [];
    const target = Array.isArray(directive.targets) && isRec(directive.targets[0]) ? str(directive.targets[0].id) : null;
    const text = str(directive.note);
    return target !== null && text !== null ? [{ element_id: target, text }] : [];
  });
}

export async function coreTurnRoute(app: FastifyInstance): Promise<void> {
  if (config.proxy.agentLaneEnabled !== true) return;
  const baseMode: AgentLaneMode = config.proxy.agentLanePreview === true ? 'preview' : 'full';

  /** The internal dispatch, PER REQUEST, carrying the caller's own identity (the legacy route's `dispatchFor`). */
  const dispatchFor = (authorization: string | undefined, extraHeaders?: Record<string, string>): InternalDispatch =>
    async (path, body) => {
      const res = await app.inject({
        method: 'POST',
        url: path,
        headers: { ...internalHeaders(config.auth.assistApiKey ?? config.auth.assistApiKeys?.[0] ?? '', authorization), ...extraHeaders },
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
    const fail = (status: number, error: CoreTurnError, durability: CoreTurnDurability = 'not_recorded') =>
      send(status, coreTurnFailure(turnId, error, durability, { providerCalls: recordedProviderCalls() }));
    // The core lane runs where `laneModeFor` runs it (staging, local, test): never in production, never on a read-only preview.
    if (laneModeFor(baseMode, AI_CORE_MODE, getRuntimeEnv()) !== MODE) {
      return fail(404, { code: 'CORE_ROUTE_UNAVAILABLE', message: 'This route is not served here.', retry_safe: false, nothing_saved: true });
    }
    const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
    const graphPath = `/assist/v1/scenarios/${scenarioId}/graph`;
    const store = getSessionStore();
    const kind = typeof body.kind === 'string' ? body.kind : 'message';
    /**
     * ⭐ A CANVAS EDIT is the person's own hand on their model: the EXISTING core canvas-edit path (`/orchestrate/v2/turn` with
     * the core header: the living model first, then the graph regenerated from it), as the legacy route forwards it. No model
     * call and no reply of Olumi's; the contract carries the saved state and any refusal. No other kind but a message is taken.
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
    const takeClaim = async (forRequest: string, chipless: boolean): Promise<{ readonly held: 'mine'; readonly claimHash: string }
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
      return sameAgentTurnRequest(requestHashOfClaim(owner.request_hash), forRequest, chipless) ? { held: 'same' } : { held: 'refused', sent: reused() };
    };

    if (canvasEdit) {
      // The edit's identity is the event itself: the same edit resent is that edit, never a second one.
      const claim = await takeClaim(agentTurnRequestHash(scenarioId, userId, '', stableStringify({ system_event: body.event ?? body.system_event ?? null })), false);
      if (claim.held === 'refused') return claim.sent;
      // One turn at a time per scenario, as for a message. A resend runs after its original, and the canvas-edit path answers
      // it from its own record: the store replays a turn id it committed and never writes it twice.
      const slot = await acquireCoreTurnSlot(scenarioId);
      try {
        const forwarded = await dispatchFor(authorization, { 'x-olumi-ai-mode': AI_CORE_MODE })('/orchestrate/v2/turn', body);
        const after = savedScenarioOf(await internal(graphPath, { ...FRESH_READ }));
        let pending: readonly PendingAction[] = [];
        try { pending = await store.readMostRecentPendingActions?.(scenarioId, { validation: 'strict' }) ?? []; } catch { pending = []; }
        const refusal = isRec(forwarded.json.error) ? forwarded.json.error : undefined;
        return send(forwarded.status, coreTurnContract({
          turnId, durability: claim.held === 'same' ? 'replayed' : forwarded.status === 200 ? 'recorded' : 'not_recorded',
          revision: after.revision, scenarioRevision: after.identity, graph: appliedGraphWire(after.graph),
          cards: await heldCardsOf(store, scenarioId, pending, after), run: after.run, analysisState: after.analysisState,
          receipts: collectTurnReceipts([forwarded.json]).map((r) => ({ ...r, authorised_by: 'person' as const })),
          error: forwarded.status === 200 ? null : {
            code: str(refusal?.code) ?? str(forwarded.json.error) ?? str(forwarded.json.code) ?? 'CANVAS_EDIT_REFUSED',
            message: str(refusal?.message) ?? str(forwarded.json.message) ?? str(forwarded.json.detail) ?? 'That change could not be saved.',
            retry_safe: false, nothing_saved: forwarded.status < 500,
          },
          agent: { forwarded_kind: kind, ...(claim.held === 'same' ? { replayed: true } : {}) },
        }));
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
      approvedProposal === undefined ? chipOperationOf(body) : undefined);
    const chiplessRetry = isChiplessRetry(body);

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
      return send(200, coreTurnContract({
        turnId, durability: 'replayed', assistantText: outcome === undefined || outcome === 'reply_empty' ? prior.assistant_message ?? '' : '',
        revision: now.revision, scenarioRevision: now.identity, graph: appliedGraphWire(now.graph),
        cards: await heldCardsOf(store, scenarioId, pending, now),
        run: now.run, analysisState: now.analysisState, ...(runPress ? { analysisResult: now.analysisResult } : {}),
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
    if (prior !== null) return sameAgentTurnRequest(requestHashOfAnswer(prior.request_hash), requestHash, chiplessRetry) ? replayed(prior) : reused();
    const claim = await takeClaim(requestHash, chiplessRetry);
    if (claim.held === 'refused') return claim.sent;
    if (claim.held === 'same') {
      // Another request holds this turn: wait for its answer and replay it, never run it again.
      const deadline = Date.now() + AGENT_TURN_CLAIM_WAIT.totalMs;
      for (;;) {
        let answer: CommittedTurnRecord | null = null;
        try { answer = await readTurn(scenarioId, turnId); } catch { answer = null; }
        if (answer !== null) return sameAgentTurnRequest(requestHashOfAnswer(answer.request_hash), requestHash, chiplessRetry) ? replayed(answer) : reused();
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
    const readingDispatch: InternalDispatch = readCache.dispatch;
    const countingDispatch: InternalDispatch = async (path, b) => {
      const sendIt = async () => promoteRevisionConflictResponse(await readingDispatch(path, b));
      if (path.endsWith('/graph/register')) {
        writesDispatched += 1;
        return undoRefusedWrite(sendIt);
      }
      // A v2 turn can commit through several subdoors before a later refusal: its 409 cannot prove nothing was written.
      if (path === '/orchestrate/v2/turn') {
        writesDispatched += 1;
        return sendIt();
      }
      return readingDispatch(path, b);
    };
    const capDispatch = bindHeldApprovalWriter(countingDispatch, (input) => {
      writesDispatched += 1;
      return undoRefusedWrite(() => readCache.around(async () => promoteRevisionConflictResponse(await commitHeldProposalInProcess(input, String(req.id)))));
    });
    /** A refusal before any model call or write: the claim is released, so the same turn may be sent again. */
    const refuseUnrun = async (status: number, code: string, message: string) => {
      const released = await releaseUnwrittenTurnClaim();
      return fail(status, { code, message, retry_safe: released, nothing_saved: true });
    };

    // ── ONE TURN AT A TIME PER SCENARIO, held until the answer is persisted and read back. ───────────────────────────────
    const slot = await acquireCoreTurnSlot(scenarioId);
    try {
      // The model as this turn starts from: read AFTER the slot, so a turn that waited sees what the turn before it saved.
      const start = await readingDispatch(graphPath, { ...FRESH_READ }).catch(() => undefined);
      if (start === undefined || (start.status !== 200 && start.status !== 404)) {
        return await refuseUnrun(503, 'MODEL_READ_FAILED', 'Your model could not be read just now. Nothing was changed; please try again.');
      }
      const saved = savedScenarioOf(start);
      if (saved.graph !== null && livingViewOf(saved.graph) === undefined) {
        return await refuseUnrun(409, 'legacy_scenario', 'This scenario was saved before the current Olumi model and cannot be opened on this route. Nothing was changed.');
      }

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
      const coreCardOnly = corePaused == null && approvedProposal !== undefined && isChangeProposal(proposals.get(approvedProposal));
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

      // ── THE TURN'S CONTEXT: the person's own words, the selection, the Challenge. ───────────────────────────────────────
      const typedNow = requestWasTyped(body) ? message : null;
      const history = new HistoryStore();
      const sessionKey = `core_${scenarioId}`;
      try {
        const rows = await store.readRecent(scenarioId, DURABLE_SEED_ROWS_READ);
        history.seed(sessionKey, historyFromDurableTurns(rows), [], rows, typedRowProof(scenarioId, userId));
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId }, 'core-turn: durable conversation unreadable; earlier words stay unknown');
      }
      const words = history.authorshipWords(sessionKey);
      const verified = [...words.verified, ...(typedNow === null ? [] : [typedNow])];
      const toolCtx: AgentToolContext = { scenario_id: scenarioId, authenticated_user_id: userId, request_id: String(req.id), turn_id: turnId,
        user_turn_text: typedNow ?? '', user_text: verified.join('\n'), verified_user_messages: verified,
        unverified_user_text: words.unknown.join('\n'), user_text_complete: false };
      const nodes = Array.isArray(saved.graph?.nodes) ? (saved.graph.nodes as unknown[]).filter(isRec) : [];
      const edges = Array.isArray(saved.graph?.edges) ? (saved.graph.edges as unknown[]).filter(isRec) : [];
      const selectionContext = agentSelectionContext(selected, saved.graph === null ? undefined : { ok: true,
        entities: nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label })), links: edges.map((e) => ({ id: e.id, from: e.from, to: e.to })) });
      const challenge = challengeTargetOf(body, selectionContext, saved.graph);
      const coreCtx = { ...toolCtx, ...(selectionContext != null ? { grounded_selection: selectionContext.grounded,
        ...(selectionContext.links !== undefined ? { grounded_links: selectionContext.links } : {}) } : {}) };

      // ── THE RUN (a Run press spends its ONE Run; a restore's Run is that restore's), ported from the legacy route. ───────
      const restoreRun = runPress ? await restoreRunOperation(scenarioId) : null;
      let recoveredRun: RecoveredRun | undefined;
      if (typeof restoreRun === 'string') {
        recoveredRun = await readRecordedRun(store, scenarioId, restoreRun, async () => savedScenarioOf(await readingDispatch(graphPath, { ...FRESH_READ })));
      }
      const runOperationKey = restoreRun === null ? turnId : restoreRun;
      const constructionDeadlineAt = constructionDeadline(startedAt);
      const capabilities = coreTurnCapabilities(capDispatch, proposals, { ...(recoveredRun !== undefined ? { recoveredRun } : {}),
        ...(runPress && runOperationKey !== undefined ? { runOperationId: runOperationTurnId(scenarioId, runOperationKey) } : {}),
        deadlineAt: constructionDeadlineAt });
      let runPressConsumed = false;
      const runAnalysis = async (args: Parameters<typeof capabilities.runAnalysis>[1]) => {
        if (restoreRun === undefined) return { ok: false, mutated: false, ran: false, refusal: 'run_failed' };
        if (!runPress) return capabilities.runAnalysis(toolCtx, args);
        if (runPressConsumed) return { ok: false, mutated: false, ran: false, refusal: 'run_press_consumed',
          detail: 'This Run press has already been used. No second analysis ran.' };
        runPressConsumed = true;
        return capabilities.runAnalysis(toolCtx, { reason: args.reason, effects_timing: args.effects_timing });
      };
      // The automatic Run after a committed change: ONCE per request, on the saved revision, when its readiness admits a Run.
      let committedAnalysis: Promise<{ readonly run?: Record<string, unknown>; readonly ready?: unknown; readonly awaitsTiming?: true }> | undefined;
      const analyseCommittedChange = () => committedAnalysis ??= (async () => {
        const savedRead = savedScenarioOf(await readingDispatch(graphPath, {}));
        if (!admitsRun(savedRead.analysisReady)) return { ready: savedRead.analysisReady };
        // The AI's timing reading, carried from the Run current when the turn began while this change left its subject as it was.
        const turnStart = start.json as { graph?: unknown; analysis_result?: unknown };
        const timing = carriedEffectsTiming(turnStart, savedRead.graph);
        // None to carry where the chance needs one: no Run that could only withhold; the reply invites Run (`awaitsTimingReading`).
        if (awaitsTimingReading(savedRead.graph, timing)) return { awaitsTiming: true };
        return { run: await capabilities.runAnalysis(toolCtx, { reason: 'Analyse the model as just saved.',
          effects_timing: timing }, { afterCommittedChange: true }) };
      })();

      // ── THE SDK TURN (or the declined card, which needs none). ───────────────────────────────────────────────────────────
      let result: AgentTurnResult & { readonly sdk?: Awaited<ReturnType<typeof runCoreTurn>>['sdk'] };
      if (declinedCardOnly !== undefined) {
        proposals.discard(declinedCardOnly);
        result = { assistant_text: '', items: [], tool_calls: [], tool_results: [], mutated: false, hops: 0, stopped_reason: 'answered',
          timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 } };
      } else {
        const canonical = await readCanonicalContext({ dispatch: readingDispatch }, { scenario_id: scenarioId });
        const draftArm = draftArmOf(MODE, saved.graph === null, req.headers['x-olumi-draft-arm']);
        // This turn's repairs: a refusal they make is settled as base at the turn's end (`goal-path.ts`).
        const restructure: Restructure = { repairs: 0 };
        try {
          result = await runCoreTurn({
            // One budget for every call (DL 22 Oct, M4): a press at the typed turn's effort reads the typed turns' cached prefix.
            ctx: coreCtx, message, budget: coreBudget(), userId,
            tools: coreTurnTools({ ctx: coreCtx, mode: MODE, scenario: 'core', requestId: String(req.id), message,
              dispatch: capDispatch, proposals, deadlineAt: constructionDeadlineAt, capabilities,
              ...(challenge !== null ? { noteOnlyOn: challenge.grounded.element_ids[0] } : {}),
              onModelRegistered: graphReadyEmitter(startedAt),
              runAnalysis,
              analyseAfterCommit: analyseCommittedChange,
              // No research control is in this contract, so no search may be promised (fail closed).
              researchShowable: async () => false,
              onVerifiedSave: () => { verifiedSave = true; }, restructure }),
            settle: async () => { await restructure.settle?.(); },
            // The standing instructions, the same bytes on every call of every scenario (the cached prefix); this turn's own
            // guidance (the drafting arm, a Challenge's note) follows its state block in the turn's input.
            instructions: instructionsForMode(MODE, CORE_ALIGNED_INSTRUCTIONS),
            turnGuidance: [...(draftArm === 'on' ? [CORE_DRAFTER_RULES] : []), ...(challenge === null ? [] : [challenge.note])],
            briefText: saved.briefText,
            canonicalState: canonical.status === 'ok' ? canonical.data : undefined,
            // A Run press permits calculation and reading only; any other press carries no consent to Run.
            withheldTools: runPress ? CORE_RUN_PRESS_WITHHELD : [...(chip !== null ? ['run_analysis'] : []), 'offer_public_research'],
            ...(runPress ? { firstTool: 'run_analysis' } : coreCardOnly && press !== undefined ? { firstTool: APPLY_CHANGE }
              : challenge !== null ? { firstTool: NOTE_ON_ITEM } : {}),
            ...(press !== undefined ? { press } : {}),
            ...(saved.revision !== null ? { traceMeta: { revision: saved.revision, ...(saved.run?.run_id != null ? { run_id: saved.run.run_id } : {}) } } : {}),
            ...coreTurnStores(store),
          });
        } catch (err) {
          log.error({ event: 'core_turn.summary', err: String(err), scenario_id: scenarioId, turn_id: turnId, request_id: String(req.id),
            ...turnLog(undefined) }, 'core-turn: the turn failed');
          // A core call whose provider delivery is unknown keeps its claim: Olumi wrote nothing, but the call may still be running.
          const deliveryUnknown = err instanceof CoreDeliveryUnknownError;
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
          if (err instanceof ModelReadFailedError) {
            return fail(503, { code: 'MODEL_READ_FAILED', message: 'Your model could not be read just now.', retry_safe: released, nothing_saved: nothingSaved }, durable);
          }
          if (isRevisionConflict(err)) {
            return fail(409, { code: 'REVISION_CONFLICT', message: 'Your model changed while this turn ran. Reload to see it, then send your message again.',
              retry_safe: released, nothing_saved: nothingSaved }, durable);
          }
          if (err instanceof CoreStateUnavailableError) {
            return fail(503, { code: err.code, message: 'Olumi could not keep this conversation’s state, so it did not run the turn.', retry_safe: released, nothing_saved: nothingSaved }, durable);
          }
          // A lost delivery is reported with ITS cause, never Olumi's own code as if the provider had sent it.
          const failure = providerFailureOf(deliveryUnknown ? (err as CoreDeliveryUnknownError).cause : err);
          return fail(502, { code: String(failure.error), message: RECORDED[lost].error.message, retry_safe: released, nothing_saved: nothingSaved }, durable);
        }
      }

      // ── THE ANSWER: the saved state as it now stands, the held cards, and the row a replay reads. ──────────────────────
      const after = savedScenarioOf(await readingDispatch(graphPath, { ...FRESH_READ }));
      const paused = result.sdk?.paused;
      const noReply = result.assistant_text.trim() === '' && paused === undefined && declinedCardOnly === undefined;
      // The model's text exactly as returned (Codex r1 on #3650: " \n" became ""); only whether it says anything is decided here.
      const assistantText = result.assistant_text;
      let latestPending: readonly PendingAction[] = heldAtStart;
      try { latestPending = await store.readMostRecentPendingActions?.(scenarioId, { validation: 'strict' }) ?? heldAtStart; } catch { /* the floor re-reads it */ }
      const graphHash = after.revision ?? undefined;
      const declined = new Set<string>([...withdrawnThisTurn(result.tool_calls), ...(declinedCardOnly !== undefined ? [declinedCardOnly] : []),
        ...(result.sdk?.resumed?.answer === 'declined' && corePaused != null && corePaused.proposal_id !== null ? [corePaused.proposal_id] : [])]);
      const reconciled = reconcileHeldProposals({ atStart: heldAtStart, latest: latestPending, approved: new Set<string>(),
        isApplied: (id) => proposals.isApplied(id), declined, graph: after.graph, graphHash, scenarioId, requestId: String(req.id), nowMs: Date.now(),
        stillApplies: (hold) => { const p = agentProposalOf(hold); return p !== undefined && heldCardStillApplies(p, after.graph); },
        subjectMoved: (hold) => { const p = agentProposalOf(hold); return p !== undefined && heldCardSubjectMoved(p, after.graph); } });
      for (const l of reconciled.lapsed) if (agentProposalOf(l.hold) !== undefined) proposals.discard(heldProposalId(l.hold));
      // This turn's own cards: each proposal the AI prepared (or paused on), from the STORED proposal, never its prose.
      const emittedAtIso = new Date().toISOString();
      let liveHolds: PendingAction[] = [...reconciled.carried];
      const chips = approvalChipsFor(result.tool_calls.filter((c) => c.refusal !== WITHHELD_ON_CHIP_TURN),
        (id) => ({ proposal: proposals.get(id), result: result.tool_results.find((r) => r.proposal_id === id) }));
      for (const chipOffered of chips) {
        const id = typedApprovalOf({ chip: { id: chipOffered.id } });
        const p = id === undefined ? undefined : proposals.get(id);
        if (id === undefined || p === undefined || liveHolds.some((h) => heldProposalId(h) === id)) continue;
        liveHolds.push(refreshedHold(proposalPendingAction(p, chipOffered as Parameters<typeof proposalPendingAction>[1], { scenario_id: scenarioId, emitted_at_iso: emittedAtIso }), Date.now()));
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
      log.info({ event: 'core_turn.summary', scenario_id: scenarioId, turn_id: turnId, request_id: String(req.id), ...turnLog(result) }, 'core-turn: summary');
      return send(200, coreTurnContract({
        turnId, durability, assistantText,
        revision: after.revision, scenarioRevision: after.identity, graph: appliedGraphWire(after.graph),
        cards: await heldCardsOf(store, scenarioId, rowPending, after),
        notes: notesOf(result, after.identity),
        run: after.run, analysisState: after.analysisState, ...(ranThisTurn ? { analysisResult: after.analysisResult } : {}),
        receipts: receiptsOf(result),
        paused: paused !== undefined ? { proposal_id: paused.proposal_id } : null,
        error: noReply ? RECORDED.reply_empty.error : null,
        // A refused or unavailable call names its typed reason (DL 22 Oct: which of Class 3's offers fired was not on the wire).
        agent: { mode: MODE, stopped_reason: result.stopped_reason, tool_calls: toolCallsOf(result), ...(result.sdk !== undefined ? { sdk: result.sdk } : {}) },
        providerCalls: recordedProviderCalls(),
      }));
    } finally {
      slot.release();
    }
  };

  app.post(CORE_TURN_PATH, { config: { scenarioId: { from: 'body', key: 'scenario_id' } } }, (req: FastifyRequest, reply: FastifyReply) =>
    runWithProviderPolicy({ ...OPENAI_ONLY('agent_core_turn'), request_id: String(req.id),
      scenario_id: (req.body as { scenario_id?: string })?.scenario_id, turn_id: (req.body as { turn_id?: string })?.turn_id }, () => handle(req, reply)));

  log.info({ event: 'agent_lane.core_route_mounted' }, `POST ${CORE_TURN_PATH} mounted`);
}
