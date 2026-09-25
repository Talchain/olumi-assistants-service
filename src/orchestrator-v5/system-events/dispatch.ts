/**
 * V5 deterministic system-event dispatch.
 *
 * v0.7.0 introduced `kind: 'system_event'` on OrchestratorTurnPayload. System
 * events are deterministic Layer 0 operations — no LLM routing. The route
 * (route-v2.ts) intercepts them BEFORE calling runTurnExecutor because:
 *   (1) system-event payloads have no `message` field, so TurnExecutor's
 *       ORIENT step (which needs a user message) cannot fire.
 *   (2) these events map to UI state changes the server records without
 *       LLM involvement.
 *
 * Persistence (Paul decision in planning round, matching V4 semantics):
 *   - patch_accepted, patch_dismissed, direct_graph_edit, chip_click
 *     → commit via commitDirectAnswer (append_turn_atomic).
 *   - undo, redo, selection_change → no commit; return commitPerformed:
 *     false with commitSkippedReason: 'client_only_event'. The route
 *     recognises this reason and still returns 200 — the skip is honest,
 *     not a fake success. See src/orchestrator/route-v2.ts for the
 *     skip-reason allowlist.
 *   - factor_value_edit, edge_strength_edit → run the existing canonical D1
 *     handler, then atomically persist graph + fact with a trusted-base CAS.
 *
 * Response envelope: acknowledgement kinds retain their prior silent response;
 * value-carrying writers return the canonical handler receipt.
 */

import type {
  OlumiResponse,
  SystemEventTurnPayload,
  SystemEventKindLiteral,
} from '@talchain/schemas/boundary';
import { HandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { config } from '../../config/index.js';
import { log } from '../../utils/telemetry.js';
import {
  GraphStaleWriteError,
  loadMostRecentPendingActionsIntegrityStrict,
  loadPersistedGraphStrict,
  loadPriorFactsWithReadState,
  loadScenarioAnalysisFactsForRead,
} from '../build-turn-context.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import { getSessionStore } from '../session/index.js';
import { TurnFenceRejectedError } from '../session/turn-fence.js';
import { executeOptionInterventionEdit } from './option-intervention-edit.js';
import type { FrameFreshness } from '../graph-management/types.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import {
  deriveAnalysisFreshness,
  emitFreshnessTelemetry,
  isSuccessfulRunAnalysisFact,
  type FreshnessDerivation,
} from '../context/freshness.js';
import { isScenarioAnalysisReasoningAuthority } from '../context/reconcile-scenario-analysis-facts.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import {
  buildAppliedGraphWireField,
  buildCanonicalCommittedGraphReceipt,
} from '../compose/applied-graph-emit.js';
import {
  applyEdgeStrengthEdit,
  isExactCommittedEdgeReadback,
  isProvenanceOnlyEdgeConfirmation,
  type EdgeStrengthEditAuthorityConflict,
} from './edge-strength-edit.js';
import { applyFactorValueEdit } from './factor-value-edit.js';
import { applyStructuralDelete } from './structural-delete.js';
import { applyStructuralAdd, findFabricatedLevel } from './structural-add.js';
import {
  applyStructuralAddEdge,
  InvalidPersistedAddEdgeGraphError,
} from './structural-add-edge.js';
import { applyStructuralRename, findStaleRenamedLabel } from './structural-rename.js';
// TYPE-ONLY — binds READER_ONLY_CHAT_ROUTE_OPS to the canonical structural-edit
// grammar at typecheck time without adding a runtime edge into the tools layer.
import type { StructuralEditOp } from '../tools/propose-structural-edit.js';

/**
 * ⭐ ONE FRESHNESS DERIVATION FOR EVERY WRITER'S REPLY.
 *
 * Each system-event writer used to derive its reply's analysis freshness on its
 * own, and the F1 defect (#1843) was fixed one writer at a time: the reload,
 * then factor_value_edit (#1860), while edge_strength_edit, structural_delete,
 * structural_add and structural_add_edge kept reading the 20-row hot window
 * alone, and structural_rename derived nothing. Once a run's turn aged out of
 * the window (every value op and Agent turn is a row), a structural edit's reply
 * said the scenario had NEVER been analysed, and a rename's said
 * `unknown_degraded / no_graph_this_turn`.
 *
 * The rule, the turn path's (`build-turn-context.ts`) and the reload's
 * (`scenario-graph-analysis-read.ts`): facts from the scenario's durable record
 * when it is reasoning authority (`complete | capped`), else the hot window; and
 * ABSENCE is authoritative only in a COMPLETE record — never under `capped`
 * (unread history behind the wall) and never in the window fallback (20 rows
 * can hide an older run). `priorFactsReadOk` is consulted only when no fact is
 * selected, so a success in the window stays positive evidence compared by hash.
 *
 * ⚠ NOT YET `option_intervention_edit`: it also feeds the window's verdict into
 * its pre-write referee, so moving its source changes write behaviour, not only
 * the reply. Named follow-up with its own RED case.
 */
function deriveWriteReplyFreshness(
  read: WriteReplyAnalysisInputs,
  persistedAnalysisGraphHash: string | null,
): FreshnessDerivation {
  const durableAuthority = isScenarioAnalysisReasoningAuthority(read.factSet);
  const derived = deriveAnalysisFreshness(
    durableAuthority ? read.factSet.facts : read.hotWindow.facts,
    persistedAnalysisGraphHash,
    undefined,
    { priorFactsReadOk: read.factSet.status === 'complete', analysisInvalidatedAt: read.analysisInvalidatedAt },
  );
  // ⛔ AN UNREAD RESTORE MARKER NEVER BECOMES A POSITIVE `fresh`. The marker can
  // only turn a hash MATCH from fresh to stale, so when it could not be read a
  // `fresh` is unverifiable (a restore may sit behind the failed read), while
  // every other verdict is untouched. The module's own degraded form is used
  // (no fact-bound hashes: `unknown` only where data is genuinely missing, its
  // invariant 3). Independent pre-review 5828334202 on #1892.
  if (!read.analysisInvalidatedAtReadOk && derived.freshness === 'fresh') {
    return deriveAnalysisFreshness([], persistedAnalysisGraphHash, undefined, { priorFactsReadOk: false });
  }
  return derived;
}

type WriteReplyAnalysisInputs = Awaited<ReturnType<typeof loadScenarioAnalysisFactsForRead>> & {
  readonly analysisInvalidatedAt: string | null;
  /** False when the marker could not be read: `null` above then means "unknown", not "no restore". */
  readonly analysisInvalidatedAtReadOk: boolean;
};

/**
 * EVERY WRITER'S ANALYSIS INPUTS: the facts AND the restore marker, read side by
 * side exactly as the reload reads them (`scenario-graph-analysis-read.ts`).
 *
 * The marker (`scenarios.analysis_invalidated_at`) is the ONLY input that can
 * make a hash MATCH read `stale`: restore the analysed version after a run
 * (A → analyse → B → restore A) and the bytes equal A again while the analysis
 * is no longer about the model the user is looking at. Without it, a write that
 * lands on the analysed hash — a rename never moves it — replied `fresh` while
 * the reload said `stale` (Independent Review 5827685385 on #1892).
 *
 * ⚠ A FAILED READ NEVER BLOCKS THE WRITE, AND IS NEVER READ AS "NO RESTORE".
 * The `.catch` is load-bearing: the real store THROWS on a database error or a
 * malformed timestamp, and `??` cannot catch a rejection. A failed read is
 * reported as `analysisInvalidatedAtReadOk: false`, and the reply then cannot
 * claim `fresh` (see `deriveWriteReplyFreshness`): substituting "no restore"
 * would present a possibly-restored model's analysis as current, while `stale`
 * would be an unsupported claim in the other direction. Fact history and the
 * marker are observational only; neither ever authorises or blocks the write.
 */
async function loadWriteReplyAnalysisInputs(
  scenarioId: string,
  requestId: string,
): Promise<WriteReplyAnalysisInputs> {
  // The store lookup sits INSIDE the guarded promise: `getSessionStore()` throws
  // synchronously when the store is not configured, and a throw outside the
  // `.catch` would fail the user's write over an observational read. An
  // unavailable store degrades exactly like a failed read.
  const markerRead = (async (): Promise<{ readonly value: string | null; readonly ok: boolean }> => ({
    value: (await getSessionStore()?.readAnalysisInvalidatedAt?.(scenarioId)) ?? null,
    ok: true,
  }))();
  const [read, marker] = await Promise.all([
    loadScenarioAnalysisFactsForRead(scenarioId, requestId),
    markerRead.catch((error: unknown) => {
      log.warn(
        {
          event: 'session.read_degraded',
          read: 'analysis_invalidated_at',
          request_id: requestId,
          scenario_id: scenarioId,
          error_name: error instanceof Error ? error.name : typeof error,
        },
        'Restore-invalidation read degraded on a write reply — currency cannot be confirmed',
      );
      return { value: null, ok: false };
    }),
  ]);
  return { ...read, analysisInvalidatedAt: marker.value, analysisInvalidatedAtReadOk: marker.ok };
}

/**
 * Why a system-event turn committed nothing — and why this is a VOCABULARY
 * rather than a boolean.
 *
 * ⚠ IT HAD ONE MEMBER, AND THAT MADE `commitPerformed: false` MEAN "THE SERVER
 * BROKE". `route-v2` reads exactly this: anything that did not commit and is
 * not a recognised skip becomes HTTP 500 `system_event_commit_failed`,
 * `retryable: true`. For an acknowledgement kind that was fine. For a
 * value-carrying writer it is not: a same-value edit and a permanently stale
 * base both commit nothing, and telling the client to retry either is telling
 * it to repeat a request that cannot succeed.
 *
 * So the states are named apart, because they need opposite follow-ups:
 *
 *   · `client_only_event` — nothing to write, by kind.
 *   · `verified_no_op`    — the server LOOKED and the model already holds what
 *                           was asked for. Success with nothing to do.
 *   · `refused_no_write`  — a gate declined and NOTHING was written. The client
 *                           cannot fix it by repeating the request.
 *
 * ⚠ AND THERE IS DELIBERATELY NO MEMBER FOR "UNVERIFIED". A writer that could
 * not confirm what happened must NOT be described as a skip: a commit may have
 * landed, so it keeps the retryable failure path (the retry is idempotent on
 * `(scenario_id, turn_id)`). Minting a skip reason for it would convert "we do
 * not know" into "nothing happened", which is the one claim the writer
 * explicitly refuses to make.
 */
export type SystemEventCommitSkipReason =
  | 'client_only_event'
  | 'verified_no_op'
  | 'refused_no_write';

export interface DispatchSystemEventResult {
  readonly response: OlumiResponse;
  readonly commitPerformed: boolean;
  readonly commitSkippedReason?: SystemEventCommitSkipReason;
  /**
   * V5 finaliser contract — system event readiness, by event kind:
   *
   *   undo / redo / selection_change / chip_click / patch_dismissed
   *     No server-side graph state to inspect. analysisReady stays
   *     undefined; the finaliser stamps no analysis_ready, and the UI's
   *     prior `ceeAnalysisReady` remains the truth (it was correct before
   *     the event).
   *
   *   patch_accepted / direct_graph_edit
   *     Graph-MUTATING in the client, but this dispatch produces only a
   *     silent acknowledgement and has no post-mutation graph snapshot in
   *     scope, so analysisReady stays undefined here too. The UI is
   *     responsible for invalidating `ceeAnalysisReady` locally on these
   *     events (per `invalidateAnalysisReady()` in DecisionGuideAI canvas
   *     store).
   *
   *   factor_value_edit / edge_strength_edit
   *     Graph-mutating ON THE SERVER. Each carries the VALUE, so dispatch can
   *     run the corresponding canonical D1 mutation, commit the graph, and re-derive
   *     readiness from the COMMITTED bytes via the canonical graph adapter
   *     — which is exactly the "future change" the paragraph above
   *     anticipated. Readiness is derived post-commit, never pre-, so it can
   *     never describe a graph that failed to land.
   *
   * Type is `AnalysisReadyPayload | undefined` (not literal `undefined`)
   * so future implementations can populate it without a type-shape change.
   */
  readonly analysisReady?: AnalysisReadyPayload;
  /**
   * Graph for the central egress sanitiser.
   *
   * `null` for acknowledgement kinds and refusals without a usable graph.
   *
   * NON-NULL FOR successful value-carrying writers. They ship real prose
   * ("Updated Marketing budget from £40,000 to £50,000.") through
   * `sanitiseOlumiResponseForEgress`, whose entity-id leak scrub resolves ids
   * to labels AGAINST THIS GRAPH. Passing `null` does not SKIP the scrub — it
   * runs graph-free, and a graph-free scrub cannot tell an ambiguous
   * single-segment id (`goal_revenue`) from an English compound
   * (`goal_setting`), so it leaves those intact.
   *
   * ⚠ THIS IS NOW PINNED, AND FOR A WHILE IT WAS NOT. Stamping the wire
   * `graph_hash` explicitly from the commit's own persisted hash (see
   * `dispatchFactorValueEdit`) removed the coverage this field used to get for
   * free — a mutation check then showed `graph: null` leaving the whole suite
   * green. The gap was disclosed rather than papered over, and is now closed by
   * a fixture that discriminates the scrub itself:
   * `route-v2-factor-value-edit.test.ts` → "resolves a leak-shaped label via the
   * graph". It uses a SINGLE-SEGMENT suffix under an ambiguous prefix
   * (`goal_revenue`, not `fac_*`/`opt_*`), which `isLikelyEntityId` leaves
   * untouched without a graph and rewrites to the node's label with one. Set
   * this field to `null` and that test REDs.
   */
  readonly graph: GraphV3T | null;
  /**
   * Canonical analysis currency against the graph this turn actually wrote.
   * Present on the edge writer only after a successful atomic commit; omitted
   * on the reader floor so its deployed response remains byte-compatible.
   */
  readonly freshness?: FreshnessDerivation;
  /**
   * Recoverable canonical-state divergence. The route maps this outcome to
   * HTTP 409 + GRAPH_DIVERGED; generic integrity/infra failures omit it and
   * remain retryable 500. No graph or turn write lands for this outcome.
   */
  readonly graphConflict?: {
    readonly recovery_action: 'refresh_and_reconfirm' | 'start_new_draft';
    readonly conflict_category: string;
    /**
     * ⚠ ALWAYS ANALYSIS-SPACE (16-hex), NEVER the 64-hex identity hash.
     * See `readClientRecoverableBaseHash` — this field is the target of a
     * user-facing "refresh and reconfirm", so a value the client cannot hold
     * or send makes the instruction unfollowable.
     */
    readonly expected_base_graph_hash: string | null;
    readonly edge?: EdgeStrengthEditAuthorityConflict['edge'];
  };
}

/**
 * The hash to hand a client that has just been told to REFRESH AND RECONFIRM.
 *
 * ⚠⚠ ONE WIRE FIELD, TWO HASH SPACES — the defect this exists to close, and it
 * is this estate's "two authorities under one name" class exactly.
 *
 * `expected_base_graph_hash` had two producers:
 *   - the stale-base gate (`structural-delete.ts`) emitted
 *     `computeAnalysisAffectingGraphHash` — 16-hex, the SAME space as the
 *     client's own `base_graph_hash`, so a refresh can actually satisfy it;
 *   - the atomic-CAS conflict path emitted `GraphStaleWriteError`'s
 *     `expected_base_graph_hash`, which is the 64-hex IDENTITY hash.
 *
 * `structural-delete.ts`'s own header states the rule the second producer
 * broke: *"The 64-hex IDENTITY hash has no wire emitter at all, so a client
 * cannot hold one; comparing against it would be a gate that can never match —
 * an affordance terminating in refusal (P8)."* Handing that value back while
 * saying "refresh and reconfirm" names a recovery that cannot be performed.
 *
 * So this reads the CURRENT persisted graph and answers in analysis space.
 * A FRESH read, deliberately: on a CAS conflict this turn's own base is stale
 * BY DEFINITION, so echoing it back would be a claim about persisted state that
 * the persisted state does not support (P5). Best-effort and total — a failed
 * read yields `null` ("I cannot name a target"), which is honest, and must
 * never convert a typed 409 into a different failure.
 *
 * ⚠⚠ RESIDUAL — THE SPLIT MOVED, IT DID NOT CLOSE. DO NOT READ THIS AS DONE.
 *
 * Two producers of the SAME wire field still emit the 64-hex IDENTITY hash,
 * both alongside `recovery_action: 'refresh_and_reconfirm'`:
 *   - `turn-executor.ts:11559` (the commit-catch branch), and
 *   - `turn-executor.ts:12448` (the hoisted finalise remap),
 * both from `GraphStaleWriteError.expected_base_graph_hash`, which is
 * `write.expectedGraphIdentityHash`.
 *
 * They are NOT a separate contract, and it would be comfortable and wrong to
 * assume they were. Verified at the bytes: `expected_base_graph_hash` is a
 * member of `GRAPH_CONFLICT_RECOVERY_KEYS` (graph-conflict-recovery-keys.ts:29),
 * the manifest those producers are compile-bound to via
 * `satisfies GraphConflictFailureDetails`, and `route-v2.ts`'s
 * `extractGraphConflictRecovery` forwards it onto the SAME 409 envelope for the
 * SAME UI recovery leg. So as of this change the field is ANALYSIS-space when a
 * SYSTEM EVENT refused and IDENTITY-space when a CHAT TURN refused.
 *
 * Why it is not fixed here rather than "not worth fixing": converting those two
 * needs an awaited persisted read inside the turn executor's failure-finalise
 * path, which is a different capability's hot path and a materially larger
 * blast radius than this P0 — the scope-expansion rule says stop at the
 * boundary and disclose. Nobody is misled TODAY (measured: zero product
 * consumers of the field at UI `c71ea7e0`, contrast controls fired), so this is
 * a latent inconsistency, not a live harm.
 *
 * TO CLOSE IT: convert both sites to an analysis-space answer (or make
 * `GraphStaleWriteError` carry both spaces explicitly) and delete this note.
 * Until then the invariant this function's name implies holds for the
 * system-event family ONLY.
 */
async function readClientRecoverableBaseHash(scenarioId: string): Promise<string | null> {
  try {
    const current = await loadPersistedGraphStrict(scenarioId);
    return computeExpectedGraphCasHashes(current).expectedGraphAnalysisHash;
  } catch {
    return null;
  }
}

/**
 * ⭐ A TURN-FENCE REFUSAL IS A KNOWN REFUSAL — one mapping for every writer.
 *
 * A later turn claimed this scenario (`superseded`) or the user stopped this
 * one (`stopped`): the fence refused the write inside the append transaction,
 * so nothing of it landed. It is answered with the envelope the message path
 * already uses for the same error (turn-executor.ts, V5 TURN FENCE —
 * AMENDMENT A2): 409 GRAPH_DIVERGED, `turn_fence_<verdict>`, and the
 * per-verdict remedy. Served `caf7d1a` answered it with the retryable 500
 * (3 of 5 refused racers, request 5bb2257f), which invited a blind retry over
 * the turn that superseded this one.
 *
 * Only the two CONFLICT verdicts, as the register route draws the line:
 * `unclaimed` / `unavailable` are infrastructure refusals and keep the
 * retryable 500 until their code is decided. `null` = not a fence conflict;
 * the caller falls through to its own handling.
 */
async function turnFenceConflict(
  err: unknown,
  ctx: {
    readonly requestId: string;
    readonly eventKind: string;
    readonly scenarioId: string;
    readonly targetId?: string;
  },
): Promise<NonNullable<DispatchSystemEventResult['graphConflict']> | null> {
  if (!(err instanceof TurnFenceRejectedError)) return null;
  if (err.verdict !== 'superseded' && err.verdict !== 'stopped') return null;
  log.warn(
    {
      request_id: ctx.requestId,
      event_kind: ctx.eventKind,
      scenario_id: ctx.scenarioId,
      ...(ctx.targetId !== undefined ? { target_id: ctx.targetId } : {}),
      fence_verdict: err.verdict,
      generation: err.generation,
      max_generation: err.maxGeneration,
    },
    `V5 ${ctx.eventKind} — turn fence refused the graph write; nothing written`,
  );
  return {
    recovery_action: err.verdict === 'stopped' ? 'start_new_draft' : 'refresh_and_reconfirm',
    conflict_category: `turn_fence_${err.verdict}`,
    expected_base_graph_hash: await readClientRecoverableBaseHash(ctx.scenarioId),
  };
}

/**
 * commit.ts opens its reused-id CONFLICT reply with exactly this (the
 * `priorTurnConflict` arm of its replay/conflict correction). `CommitResult`
 * exposes only `thisAttemptWrote`, not which of the two it was, so the prose is
 * the discriminator. A missed match fails SAFE: a conflict read as a replay can
 * only swap in a `REPLAY_CHANGE_*` sentence, which is true of a conflict too.
 */
const COMMIT_CONFLICT_REFUSAL_PREFIX = 'I did not make that change';
/** A replay whose requested change is not in the reread snapshot. */
const REPLAY_CHANGE_NOT_IN_MODEL_TEXT =
  'Nothing new was written just now, and that change is not in the model at the moment.';
/** A replay whose reread failed: whether the change is in the model is unknown. */
const REPLAY_CHANGE_UNCHECKABLE_TEXT =
  "Nothing new was written just now, and I couldn't read the model to check whether that change is in it.";
/**
 * A replay whose requested change IS in the reread snapshot, with no receipt
 * naming THIS turn as its author: true whoever made the change.
 */
const REPLAY_CHANGE_IN_MODEL_UNATTRIBUTED_TEXT =
  'Nothing new was written just now, and the model already reflects that change.';
/**
 * The two arms that keep commit.ts's claim, restated WITHOUT its value tail.
 * commit.ts ends both with "<label> is currently <value>." or, when it has no
 * value target, "I couldn't read the current value just now — open the model
 * to check it." A structural write never has a value target, so that tail was
 * always the second one: false beside the snapshot this reply presents
 * (#1906 review 5831160000). The reply's `draft_graph` is the current state.
 */
const REPLAY_ALREADY_RECORDED_TEXT =
  'That change had already been recorded, so nothing new was written just now.';
const CONFLICT_REFUSAL_TEXT =
  'I did not make that change. This request arrived under an identifier that had already been ' +
  'used for a different instruction, so I stopped rather than risk applying the wrong edit. ' +
  'Nothing was written.';
/** Appended to either kept arm only when the reread failed, so no snapshot is shown. */
const NO_SNAPSHOT_TAIL = " I couldn't read the model just now to show what it currently holds.";

/**
 * ⛔ F4 (Codex, #63 5821693599) — THE REPLY FOR A GRAPH WRITER WHOSE COMMIT
 * RESOLVED BUT WROTE NOTHING FOR THIS ATTEMPT (`CommitResult.thisAttemptWrote
 * === false`: a replay of an already-committed request, or a reused turn id
 * carrying a different request).
 *
 * WHY THE WRITERS' OWN RECEIPT CHECKS CANNOT BE TRUSTED HERE. On this branch
 * `graphPersisted` is still `true` ("a graph was PROVIDED") and `persistedGraph`
 * / `persistedAnalysisGraphHash` are the authoritative REREAD — a display
 * snapshot that another writer, or this request's own earlier commit, may
 * already have changed. A check of the shape "graph persisted AND the snapshot
 * shows my change" therefore attests "verified in the persisted bytes" for a
 * write that never happened when the snapshot happens to agree, and turns a
 * KNOWN no-write into a retryable 500 when it does not — and retrying cannot
 * help: the same id conflicts again, and a replay has already committed.
 * `thisAttemptWrote` is the write-truth (commit.ts, the field doc).
 *
 * THE HONEST REPLY — the shape `factor_value_edit` already gives on this branch:
 *   · the COMMIT's response, never the writer's pre-commit one. commit.ts has
 *     already corrected it: a conflict says "I did not make that change …
 *     Nothing was written." and carries no receipt; a replay says the change
 *     "had already been recorded, so nothing new was written just now" and may
 *     carry the ORIGINAL receipt (the only evidence it committed EARLIER); any
 *     `graph_patch` is `noop` and any `ui_directive` is dropped;
 *   · `commitPerformed: true` — the turn is durably recorded;
 *   · the stored snapshot as `draft_graph` / `graph_hash`, with the readiness
 *     and freshness OF that snapshot — DISPLAY ONLY, describing what the store
 *     holds now, never evidence that this attempt wrote. When the reread failed
 *     or does not parse, nothing graph-shaped is presented at all;
 *   · a log line that is NOT the writer's "committed … verified" attestation.
 *
 * ⛔ A REPLAY FLAG IS NOT "IT WAS WRITTEN EARLIER". The store flags
 * `replayedPriorTurn` for ANY prior row under the same `(scenario_id, turn_id)`
 * with the same request hash — including a committed REFUSAL row (e.g.
 * `no_persisted_graph`), which wrote no graph. Retried under that turn id once
 * state has changed, the identical request reaches the append, the store says
 * "replay", and commit.ts's "had already been recorded" would describe a change
 * that never happened.
 *
 * ⛔ VISIBLE IS NOT "MINE" (independent pre-review 5831122178 on #1906). The
 * change being in today's reread says nothing about WHO made it: after that
 * refusal, a foreign writer can make exactly the requested change between the
 * retry's base read and its append, and the store still says "replay". The only
 * durable evidence that THIS turn wrote earlier is the original receipt, which
 * the RPC hands back on a genuine replay and which names its `source_turn_id`.
 * So on a replay (anything commit.ts did not answer as a conflict) commit.ts's
 * prose and the original receipt are kept ONLY when that receipt names this
 * turn AND the caller's `requestedChangeVisibleIn` finds the change in the
 * reread snapshot. Otherwise the receipt is withheld and the prose is replaced
 * with a sentence true whoever wrote: the change is in the model, or it is not,
 * or (no snapshot) it cannot be checked. A guest's genuine replay has no receipt
 * and so reads "already reflects that change" — never a claim the reply cannot
 * prove. Conflicts keep commit.ts's refusal — already true, receipt-free.
 */
function replyForAttemptThatWroteNothing(args: {
  readonly writer: string;
  readonly payload: SystemEventTurnPayload;
  readonly requestId: string;
  readonly committedResponse: OlumiResponse;
  readonly persistedGraphBytes: unknown;
  readonly persistedAnalysisGraphHash: string | null;
  /**
   * The writer's own analysis read — the durable record, the hot window and the
   * restore marker (`loadWriteReplyAnalysisInputs`) — so this reply derives its
   * freshness exactly as every other writer reply does. It once took the window
   * alone, which answered `none` for a run older than 20 rows and `fresh` for a
   * restored model.
   */
  readonly analysisInputs: WriteReplyAnalysisInputs;
  /**
   * Whether the change THIS request asked for is present in the reread snapshot,
   * expressed by the writer in the terms of its own receipt check. Consulted
   * only on a replay, and only to decide whether "already recorded" is true.
   */
  readonly requestedChangeVisibleIn: (snapshot: GraphV3T) => boolean;
  readonly logFields: Readonly<Record<string, unknown>>;
}): DispatchSystemEventResult {
  const {
    writer,
    payload,
    requestId,
    committedResponse,
    persistedGraphBytes,
    persistedAnalysisGraphHash,
    analysisInputs,
  } = args;
  const snapshotParse = GraphV3.safeParse(persistedGraphBytes);
  const snapshot =
    snapshotParse.success && persistedAnalysisGraphHash !== null
      ? { graph: snapshotParse.data, hash: persistedAnalysisGraphHash }
      : null;
  const answeredAsConflict =
    typeof committedResponse.assistant_text === 'string' &&
    committedResponse.assistant_text.startsWith(COMMIT_CONFLICT_REFUSAL_PREFIX);
  const requestedChangeVisible =
    snapshot !== null && args.requestedChangeVisibleIn(snapshot.graph);
  const earlierWriteByThisTurnProven =
    committedResponse.model_version_receipt?.source_turn_id === payload.turn_id;
  const withholdReplayClaim =
    !answeredAsConflict && !(requestedChangeVisible && earlierWriteByThisTurnProven);
  const claimSafeResponse: OlumiResponse = withholdReplayClaim
    ? (() => {
        const withoutReceipt = { ...(committedResponse as Record<string, unknown>) };
        delete withoutReceipt.model_version_receipt;
        return {
          ...withoutReceipt,
          assistant_text:
            snapshot === null
              ? REPLAY_CHANGE_UNCHECKABLE_TEXT
              : requestedChangeVisible
                ? REPLAY_CHANGE_IN_MODEL_UNATTRIBUTED_TEXT
                : REPLAY_CHANGE_NOT_IN_MODEL_TEXT,
        } as OlumiResponse;
      })()
    : {
        ...committedResponse,
        assistant_text:
          (answeredAsConflict ? CONFLICT_REFUSAL_TEXT : REPLAY_ALREADY_RECORDED_TEXT) +
          (snapshot === null ? NO_SNAPSHOT_TAIL : ''),
      };
  const response: OlumiResponse =
    snapshot !== null
      ? {
          ...claimSafeResponse,
          graph_hash: snapshot.hash,
          draft_graph: buildAppliedGraphWireField(snapshot.graph),
        }
      : claimSafeResponse;
  log.info(
    {
      request_id: requestId,
      event_kind: payload.event.kind,
      scenario_id: payload.scenario_id,
      ...args.logFields,
      this_attempt_wrote: false,
      stored_snapshot_presented: snapshot !== null,
      answered_as_conflict: answeredAsConflict,
      requested_change_visible_in_snapshot: snapshot === null ? null : requestedChangeVisible,
      earlier_write_by_this_turn_proven: earlierWriteByThisTurnProven,
      replay_claim_withheld: withholdReplayClaim,
    },
    `V5 ${writer} — this attempt wrote nothing (a replay or a reused-id conflict); ` +
      "returning the commit's corrected reply with the stored snapshot for display only, attesting no success",
  );
  if (snapshot === null) {
    return { response, commitPerformed: true, graph: null };
  }
  // The shared rule, against the SNAPSHOT's hash: the durable record when it is
  // authority, the restore marker, and `unknown` when the marker is unread.
  const freshness: FreshnessDerivation = deriveWriteReplyFreshness(analysisInputs, snapshot.hash);
  emitFreshnessTelemetry(
    freshness,
    {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: `system_event.${writer}`,
    },
    {
      prior_fact_count: analysisInputs.hotWindow.facts.length,
      prior_fact_read_status: analysisInputs.hotWindow.status,
      scenario_fact_set_status: analysisInputs.factSet.status,
      this_attempt_wrote: false,
    },
  );
  return {
    response,
    commitPerformed: true,
    analysisReady: buildCanonicalAnalysisReadyFromGraph(snapshot.graph),
    freshness,
    graph: snapshot.graph,
  };
}

export interface DispatchSystemEventParams {
  readonly payload: SystemEventTurnPayload;
  readonly requestId: string;
}

/**
 * How each system-event kind is handled. TOTAL BY CONSTRUCTION.
 *
 * ⚠ THIS REPLACES A CLAIM THAT WAS FALSE FOR AS LONG AS IT EXISTED. The list
 * below used to be a `ReadonlySet<SystemEventKindLiteral>` carrying the comment
 * "adding a new kind to the schema without updating this list is a compile-time
 * error (not a silent runtime miss)". **A `Set` of a union type is not exhaustive
 * — a Set with three members satisfies `ReadonlySet<X>` no matter how many
 * members `X` has.** Nothing went red. That is precisely how `factor_value_edit`
 * would have arrived: silently, falling through to the generic acknowledgement,
 * which is the P0 this change exists to fix — one kind later.
 *
 * A `Record` keyed by the union IS exhaustive: TypeScript requires every member.
 * So re-vendoring a schemas release that adds a kind now fails `pnpm typecheck`
 * until someone states what the new kind does. That is the loud signal the old
 * comment promised and did not deliver.
 *
 * Belt and braces, because a compile-time guard can be defeated by a cast or by
 * a consumer on a stale pin: `system-event-kind-exhaustiveness.test.ts` DERIVES
 * the kind set from `SystemEventKind.options` — the schema's own vocabulary —
 * and asserts set-equality with this map's keys. Derived, not mirrored.
 */
export type SystemEventHandling =
  /** No server state change at all — no commit, `client_only_event` skip reason. */
  | 'client_only'
  /** Silent acknowledgement, committed as a turn row. No graph write. */
  | 'ack_and_commit'
  /**
   * Known additive wire event whose writer is deliberately not deployed yet.
   * Commit an explicit typed refusal, never a graph/fact/new-pending mutation.
   */
  | 'reader_only_refusal'
  /**
   * Silent acknowledgement committed WITH a typed handler fact — the event
   * carries a human judgement the server must PERSIST, never a graph write
   * (P4 transport, 2026-08-05: carry the signal; whether it feeds compute is
   * a separate explicit design decision). Turn shape follows the edit_graph /
   * DL-7 PR B precedent: `turn_class: 'direct_answer'`, `handler_id: null`,
   * facts on the turn row — the prior-facts loader reads facts from ALL prior
   * turns, so these are downstream-visible.
   */
  | 'fact_and_commit'
  /** Runs a real mutation and writes `scenarios.graph`. */
  | 'mutating';

export const SYSTEM_EVENT_HANDLING: Readonly<Record<SystemEventKindLiteral, SystemEventHandling>> = {
  patch_accepted: 'ack_and_commit',
  patch_dismissed: 'ack_and_commit',
  direct_graph_edit: 'ack_and_commit',
  factor_value_edit: 'mutating',
  chip_click: 'ack_and_commit',
  undo: 'client_only',
  redo: 'client_only',
  selection_change: 'client_only',
  // Reclassified 2026-08-05 (was 'ack_and_commit' — which committed an EMPTY
  // ack and DISCARDED the rating after hashing it into request_hash; the UI
  // has emitted the typed event since 0.22.0 and the server threw it away).
  feedback: 'fact_and_commit',
  // 0.34.0 — the two judgement kinds that previously terminated in the
  // browser (no wire shape existed at all).
  edge_adjudication: 'fact_and_commit',
  prior_range_edit: 'fact_and_commit',
  // 0.42.0 Train C — canonical writer. Reverting THIS writer commit lands on
  // Train B's deployed explicit no-write refusal and its integrity-strict
  // pending carry-forward; reader and writer rollback remain independent.
  edge_strength_edit: 'mutating',
  // 0.48.0 — THE P0 L-22 WRITER. `'ack_and_commit'` here is the defect itself:
  // it commits a turn row and writes NO graph, so the next turn reloads a graph
  // that still holds the deleted option and re-adds it. A delete that does not
  // reach `scenarios.graph` is not a delete.
  structural_delete: 'mutating',
  // 0.50.0 — the direct-edit half of the canvas vocabulary. CEE can now PARSE
  // these (the pin carries them) but has no writer for any of the three, so
  // they take the contract's own mandated posture: reader-first.
  //
  // ⚠ WHY NOT `'ack_and_commit'`, spelled out because it is the tempting cheap
  // answer and it is the SAME DEFECT the `structural_delete` note above
  // records. An ack commits a turn row and writes no graph, so the user's new
  // factor survives exactly until the next reload and then silently vanishes —
  // a lie told by omission. `'client_only'` is equally wrong: undo/redo/
  // selection_change are genuinely realised in the client, whereas a
  // structural add is a request the SERVER must honour and cannot.
  // `'reader_only_refusal'` is the only posture that leaves the user knowing
  // what happened, and it is what the contract asks for in terms
  // ("Reader-first adoption is mandatory", schemas enums.ts).
  // 0.50.0 — THE NODE WRITER. `'reader_only_refusal'` was honest while CEE had
  // no writer; it becomes a lie the moment one exists. See `structural-add.ts`
  // for the collision gate the base hash provably cannot replace, and for why a
  // new factor arrives as an EXPLICIT UNKNOWN rather than a fabricated number.
  structural_add: 'mutating',
  // 0.50.0 — THE EDGE WRITER (landed after the node one above, and for the same
  // reason its comment gives): `'reader_only_refusal'` was honest while CEE had
  // no writer; it becomes a LIE the moment one exists, because the refusal tells
  // the user this version cannot connect two nodes and it now can.
  //
  // ⭐⭐ THIS ONE KIND CARRIES FOUR USER-FACING GESTURES, which is why it is
  // worth the writer: draw-a-link, the five "Add connected …" affordances,
  // duplicate, and paste. The last three are gestures users ALREADY perform and
  // already believe work — a duplicated subgraph reaches the server as nodes
  // with no connections and returns having quietly lost its causal structure.
  //
  // ⚠ NOT `'ack_and_commit'`, and the delete sibling above says why: an ack
  // writes a turn row and NO graph, so the connection survives exactly until the
  // next reload. See `structural-add-edge.ts` for the three gates (stale hash,
  // endpoint resolution, duplicate) and for why the two server-owned fields are
  // the canonical constants rather than anything hand-rolled.
  structural_add_edge: 'mutating',
  // 0.50.0 — THE LABEL WRITER (landed after the two above). `'reader_only_refusal'`
  // here was honest while CEE had no writer; it is a LIE the moment one exists,
  // because the refusal tells the user this version cannot apply a canvas rename
  // and it now can. See `structural-rename.ts` for the two gates this kind needs
  // and why only ONE of them answers 409.
  structural_rename: 'mutating',
  // 0.54.0 — the per-cell option→factor effect carrier. `'mutating'` because it
  // has exactly what that value requires and nothing weaker: a receipt-bearing
  // writer already on this branch (`option-intervention-edit.ts`, banked
  // internal in #1279 and released), a server-side write to `scenarios.graph`
  // through the SAME operation constructor → parser → referee → applier the
  // conversational path uses, and a committed `edit_graph` fact.
  //
  // ⚠ NOT `'ack_and_commit'`, and the delete sibling above says why that
  // matters: an ack-and-commit writes a turn row and NO graph, so the next turn
  // reloads a graph that still holds the old value. An effect value that does
  // not reach `scenarios.graph` is not an edit — it is a number the user watched
  // vanish on reload.
  option_intervention_edit: 'mutating',
  // 0.55.0 — the Reasoning tab's stated disagreement. `'fact_and_commit'`
  // because this event changes NO graph and yet carries something the server
  // must keep: the words a human wrote about a finding.
  //
  // ⚠ NOT `'mutating'`. Every member of that set writes `scenarios.graph`, which
  // moves `graph_hash` and invalidates the user's analysis. A dissent asserts no
  // value and edits no node — it is a claim ABOUT a finding, not a change to the
  // model that produced it. Making it mutating would invalidate the very
  // analysis the user is objecting to: wrong, and self-defeating.
  //
  // ⚠ NOT `'ack_and_commit'`, and this is the whole point of the change. An ack
  // commits a turn row and DISCARDS the payload — precisely the defect recorded
  // against `feedback` above, where the UI emitted a typed event and the server
  // threw its content away. Here the payload IS the record, so an ack would
  // reproduce the empty-ack class on the one field the event exists to carry.
  finding_dissent: 'fact_and_commit',
};

// DERIVED from the map above — not a second list to keep in step. undo/redo are
// realised in the client's graph history, not in Supabase turn state.
//
// selection_change is client-only ACKED as a holding position — R5 will
// likely route it into ephemeral turn context (never a committed turn);
// revisit the dispatch branch, not this guard, when R5 lands.
const CLIENT_ONLY_EVENT_KINDS: ReadonlySet<SystemEventKindLiteral> = new Set<SystemEventKindLiteral>(
  (Object.keys(SYSTEM_EVENT_HANDLING) as SystemEventKindLiteral[]).filter(
    (k) => SYSTEM_EVENT_HANDLING[k] === 'client_only',
  ),
);



/**
 * Build the typed judgement receipt for a `fact_and_commit` event kind.
 *
 * Returns `null` for kinds that are not fact-bearing (the caller then treats
 * the event as a plain ack — which cannot happen for a kind the handling map
 * declares 'fact_and_commit'; the null arm exists so this function is total).
 *
 * ⚠ R-004 (feedback): the fact records `comment_present`, NEVER the comment
 * text — the user's free text may contain PII and a fact row is long-lived
 * and widely read. The contract's `FeedbackResultSchema` is `.strict()`, so a
 * future `comment` field is a deliberate reviewed widening, not a quiet leak.
 * That widening now has a REALISED EXAMPLE, and it does NOT relax the rule
 * above: `FindingDissentResultSchema` persists a `statement` VERBATIM,
 * authorised by Paul's ruling of 2026-09-11. The limit is the authorisation's
 * own — it is scoped to a user's OWN STATED REASONING ABOUT A FINDING, never a
 * general licence to persist free text. `feedback.comment` is still withheld,
 * and both halves are pinned together in
 * tests/integration/orchestrator/route-v2-judgement-receipts.test.ts so neither
 * can quietly drift into the other.
 *
 * Provenance on the adjudication/prior facts is stamped HERE, server-side
 * (`user_set`) — the wire deliberately carries no provenance field (the event
 * kind is the provenance claim; a client constant would add nothing the
 * server could trust).
 */
export function buildJudgementFact(
  event: SystemEventTurnPayload['event'],
): HandlerFact | null {
  switch (event.kind) {
    case 'feedback':
      return {
        fact_type: 'feedback',
        fact_version: 1,
        noop: false,
        result: {
          target_id: event.target.id,
          target_kind: event.target.kind,
          rating: event.rating,
          comment_present: event.comment !== undefined && event.comment.length > 0,
        },
      };
    case 'edge_adjudication':
      return {
        fact_type: 'edge_adjudication',
        fact_version: 1,
        noop: false,
        result: {
          from: event.from,
          to: event.to,
          edge_id: event.edge_id ?? null,
          verdict: event.verdict,
          resolved_strength_mean: event.resolved_strength_mean ?? null,
          provenance: 'user_set',
        },
      };
    case 'prior_range_edit':
      return {
        fact_type: 'prior_range_edit',
        fact_version: 1,
        noop: false,
        result: {
          target_id: event.target_id,
          range_min: event.range_min,
          range_max: event.range_max,
          distribution: event.distribution ?? null,
          provenance: 'user_set',
        },
      };
    case 'finding_dissent':
      return {
        fact_type: 'finding_dissent',
        fact_version: 1,
        noop: false,
        result: {
          finding_id: event.finding_id,
          analysis_id: event.analysis_id,
          // VERBATIM — passed through untouched. Not trimmed, collapsed,
          // truncated or re-encoded: the words are the record, and a
          // whitespace-only statement is REFUSED by the contract at the wire
          // rather than tidied into something the user did not write.
          statement: event.statement,
          provenance: 'user_set',
        },
      };
    default:
      return null;
  }
}

function buildAcknowledgementResponse(
  payload: SystemEventTurnPayload,
): OlumiResponse {
  // Silent acknowledgement. V4's handleSystemEvent follows the same
  // convention — UI-visible confirmation is rendered by the UI's own
  // patch/history components, not by a message bubble.
  return {
    response_version: 2,
    assistant_text: '',
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: payload.stage,
  };
}

/**
 * Per-kind copy for the reader-first refusal.
 *
 * ⚠ PARTIAL BY DESIGN, WITH A FALLBACK THAT IS TRUE OF EVERY KIND — this is
 * deliberately NOT a total map. A total `Record<SystemEventKindLiteral, …>`
 * would force copy for the ten-plus kinds that never refuse, and a
 * hand-maintained list of "kinds that might refuse" is exactly the mirror this
 * repo pays for most often: it drifts silently and the drift reads as green.
 * Here an unlisted kind gets the GENERIC sentence, which is accurate for any
 * event ("I can't apply this change"), so drift degrades to less-specific copy
 * and can never produce a FALSE sentence. Adding a kind is an improvement, not
 * a correctness obligation.
 */
const READER_ONLY_REFUSAL_COPY: Partial<
  Record<SystemEventKindLiteral, { text: string; reason: string }>
> = {
  // ⚠ DELIBERATELY GESTURE-NEUTRAL. DO NOT "IMPROVE" THIS BY NAMING AN AXIS.
  //
  // `@talchain/schemas` 0.50.0 gave `edge_strength_edit` a `direction_intent`
  // field, so ONE kind now carries TWO gestures: a strength change and a
  // helps/hurts direction change. This table is keyed on `event.kind` alone —
  // it never sees the payload — so any axis named here is a guess, and it was
  // wrong for every direction-only edit: the user flipped helps/hurts and was
  // told CEE could not apply a "link-strength" change. A refusal that names the
  // wrong gesture tells the user something false about their own action, which
  // is worse than saying less (see `buildReaderOnlyRefusal`'s note below).
  //
  // "link" is true of BOTH gestures, so this sentence cannot be false for any
  // payload this kind admits. Naming the actual axis needs the payload, not the
  // kind — that is a different change with a different risk, and it is not this
  // one. The machine `reason` is unchanged, so clients still distinguish this
  // rollout floor from a malformed payload (B1/422).
  edge_strength_edit: {
    text: "I can't apply this link change in this version, so I haven't changed the model.",
    reason: 'edge_strength_edit_reader_only',
  },
  // 0.50.0 direct-edit vocabulary — wire members CEE can READ but has no writer
  // for. Named individually because "I can't apply this change" would leave the
  // user guessing which gesture was dropped.
  //
  // ⚠⚠ THE DENIAL IS SCOPED TO THE CANVAS, AND THAT SCOPE IS LOAD-BEARING — it
  // is the whole correction. The first version of this copy said "I can't add a
  // factor to the model in this version", which denies the CAPABILITY. CEE has
  // that capability: chat reaches it through `edit-graph-dispatch.ts` →
  // `propose-structural-edit.ts`, whose advertised grammar carries `add_node`,
  // `add_edge` and `update_node` (see READER_ONLY_CHAT_ROUTE_OPS below).
  // What this deployment lacks is a writer for the gesture performed ON THE
  // CANVAS — an implementation fact, never a product limit the user is told.
  //
  // ⭐ AND IT CLOSED A LOOP. `compose/unsupported-action-response.ts:247-267`
  // appends, unconditionally, "You can make this change (add factor) directly
  // on the canvas". So chat sent the user to the canvas and the canvas told
  // them the version could not — an affordance terminating in refusal, with no
  // exit. Each sentence below therefore names the route that WORKS, per the
  // standing D-seam rule: hand the user to a direct-manipulation surface where
  // one exists and works, and to chat where one does not. Pointing a CANVAS
  // refusal at CHAT is non-circular by construction; the inverse pointer in
  // unsupported-action-response fires only for handler ids with no chat route.
  //
  // Pinned BOTH WAYS in `__tests__/reader-only-refusal-capability-honesty.test.ts`.
  // ⚠ `structural_add` DELIBERATELY HAS NO ENTRY ANY MORE — it is declared
  // `'mutating'` above, so this branch is unreachable for it and a sentence
  // saying "I can't apply a factor added on the canvas in this version" would be
  // false the moment someone re-declared the kind. Deleted rather than left as a
  // comment, on the same reasoning as `structural_rename`'s.
  // ⚠ `structural_add_edge` DELIBERATELY HAS NO ENTRY ANY MORE, on exactly the
  // reasoning its two siblings above record. It is declared `'mutating'`, so this
  // branch is unreachable for it, and the sentence it used to carry — "I can't
  // apply a link added on the canvas in this version" — would be FALSE the moment
  // someone re-declared the kind. Dead copy that reads as live is how an honest
  // label gets overwritten by a false one, so it is deleted rather than commented
  // out. `SYSTEM_EVENT_HANDLING` is the only place that decides this.
  // ⚠ `structural_rename` DELIBERATELY HAS NO ENTRY ANY MORE. It is declared
  // `'mutating'` above, so this branch is unreachable for it, and a refusal
  // sentence saying "I can't apply a rename made on the canvas in this version"
  // would be FALSE the moment someone re-declared the kind. Dead copy that reads
  // as live is how an honest label gets overwritten by a false one — the copy is
  // deleted rather than left as a comment. Its capability-honesty pin moves with
  // it (see `reader-only-refusal-capability-honesty.test.ts`).
};

/**
 * The CHAT route that realises each canvas gesture this deployment cannot apply.
 *
 * This is what makes the refusal copy above CHECKABLE rather than merely
 * better-worded. Each value is the canonical structural-edit op that delivers
 * the same outcome through chat, so the honesty pin can ask the real question —
 * *does a route exist?* — instead of pattern-matching the sentence.
 *
 * ⚠ HAND-WRITTEN, therefore the part that can go short (CLAUDE.md trap 12d).
 * `StructuralEditOp` is imported as a TYPE, so a typo or a retired op fails
 * TYPECHECK here; the test then pins the pair BOTH WAYS at runtime:
 *   · every op named here is really in `STRUCTURAL_EDIT_OPS` — if chat LOSES
 *     `add_node`, this stops being a route and the copy must go back to a flat
 *     denial, so the guard REDs rather than leaving a false promise;
 *   · every kind named here is really declared `reader_only_refusal` — if CEE
 *     gains a server-side writer the kind becomes 'mutating', the refusal is
 *     dead copy, and the guard REDs rather than keeping an unreachable branch.
 *
 * A type-only import keeps this binding free of a runtime edge into the tools
 * layer; the test imports the value and does the derivation.
 *
 * ⭐ RE-SURFACE TRIGGER for this whole block: **the UI re-vendors to schemas
 * ≥0.50.0**. That is the single event that gives these three kinds a live
 * producer and turns any dishonesty here into a user-visible one.
 */
export const READER_ONLY_CHAT_ROUTE_OPS: Readonly<
  Partial<Record<SystemEventKindLiteral, StructuralEditOp>>
> = {
  // ⚠⚠ THIS TABLE IS NOW EMPTY, AND THAT IS A MILESTONE RATHER THAN A DEFECT:
  // every kind `SYSTEM_EVENT_HANDLING` declares has a writer or a defined
  // non-writer posture, so no canvas gesture is refused for want of a server
  // implementation. `structural_add_edge` was the last member and left when its
  // writer landed, exactly as `structural_rename` and `structural_add` did.
  //
  // ⛔ THE MACHINERY STAYS WIRED, deliberately. The next contract version that
  // adds a kind CEE cannot yet write must land here reader-first, and the
  // both-ways pin in `reader-only-refusal-capability-honesty.test.ts` REDs if a
  // kind is parked reader-only without adjudicating what its copy may claim.
  // `structural_rename` is GONE from this table because it is no longer
  // reader-only: CEE writes the label server-side now. The table's own both-ways
  // pin REDs if this table and `SYSTEM_EVENT_HANDLING` ever disagree again.
};

/**
 * Reader-first response for a wire member this deployment can parse but not apply.
 *
 * The new discriminator must be understood before any producer emits it, but
 * understanding is not permission to mutate. This response is intentionally
 * explicit and non-retryable: the request parsed, this deployment has no
 * writer for it, and the model was not changed. The stable reason lets a
 * client distinguish this rollout floor from a malformed payload (B1/422).
 *
 * ⚠ WHY THIS IS NO LONGER `edge_strength_edit`-SPECIFIC. It was, and 0.50.0
 * made that a defect: the three new structural members have no writer either,
 * so declaring them `reader_only_refusal` would have routed a user who ADDED A
 * FACTOR into the sentence "I can't apply this link-strength change" — a
 * refusal that names the wrong gesture is worse than a generic one, because it
 * tells the user something false about their own action.
 */
export function buildReaderOnlyRefusal(payload: SystemEventTurnPayload): OlumiResponse {
  const copy = READER_ONLY_REFUSAL_COPY[payload.event.kind] ?? {
    text: "I can't apply this change in this version, so I haven't changed the model.",
    reason: `${payload.event.kind}_reader_only`,
  };
  return {
    response_version: 2,
    assistant_text: copy.text,
    blocks: [
      {
        type: 'error',
        error_code: 'FEATURE_NOT_ENABLED',
        severity: 'warn',
        details: {
          reason: copy.reason,
          retryable: false,
        },
      },
    ],
    suggested_actions: [],
    insights: [],
    stage_indicator: payload.stage,
  };
}

export async function dispatchSystemEvent(
  params: DispatchSystemEventParams,
): Promise<DispatchSystemEventResult> {
  const { payload, requestId } = params;
  const startedAt = Date.now();
  const declaredHandling = SYSTEM_EVENT_HANDLING[payload.event.kind];
  // Writer activation is the existing atomic-RPC config, not a second flag.
  // Under off/shadow we deliberately execute Train B's deployed reader floor:
  // typed FEATURE_NOT_ENABLED, strict newest-pending carry, no graph read/fact/
  // writer effect. Enabling the emitter is therefore insufficient on its own;
  // the service must be objectively running the RPC in enforce mode.
  const handling =
    payload.event.kind === 'edge_strength_edit' &&
    declaredHandling === 'mutating' &&
    config.features.graphCas.rpcEnforce !== true
      ? 'reader_only_refusal'
      : declaredHandling;
  const response =
    handling === 'reader_only_refusal'
      ? buildReaderOnlyRefusal(payload)
      : buildAcknowledgementResponse(payload);

  if (CLIENT_ONLY_EVENT_KINDS.has(payload.event.kind)) {
    log.info(
      {
        request_id: requestId,
        event_kind: payload.event.kind,
        scenario_id: payload.scenario_id,
      },
      'V5 system event — client-only, skipping commit',
    );
    return {
      response,
      commitPerformed: false,
      commitSkippedReason: 'client_only_event',
      graph: null,
    };
  }

  // ── VALUE-CARRYING writers ────────────────────────────────────────────────
  // Value-less events retain their byte-identical acknowledgement. Each
  // writer below owns only its structured adapter + commit transaction; the
  // canonical D1 handlers remain the sole graph mutators.
  if (
    handling === 'mutating' &&
    payload.event.kind === 'factor_value_edit'
  ) {
    return await dispatchFactorValueEdit(payload, payload.event, requestId, startedAt);
  }
  if (
    handling === 'mutating' &&
    payload.event.kind === 'edge_strength_edit'
  ) {
    return await dispatchEdgeStrengthEdit(payload, payload.event, requestId, startedAt);
  }
  if (
    handling === 'mutating' &&
    payload.event.kind === 'structural_delete'
  ) {
    return await dispatchStructuralDelete(payload, payload.event, requestId, startedAt);
  }
  if (
    handling === 'mutating' &&
    payload.event.kind === 'structural_rename'
  ) {
    return await dispatchStructuralRename(payload, payload.event, requestId, startedAt);
  }
  if (
    handling === 'mutating' &&
    payload.event.kind === 'structural_add'
  ) {
    return await dispatchStructuralAdd(payload, payload.event, requestId, startedAt);
  }
  if (
    handling === 'mutating' &&
    payload.event.kind === 'structural_add_edge'
  ) {
    return await dispatchStructuralAddEdge(payload, payload.event, requestId, startedAt);
  }
  if (
    handling === 'mutating' &&
    payload.event.kind === 'option_intervention_edit'
  ) {
    return await dispatchOptionInterventionEdit(payload, payload.event, requestId);
  }

  // ── fact_and_commit: the judgement PERSISTS, or the turn fails loud ──────
  // Built + contract-validated BEFORE the commit. Fail-closed: a fact that
  // does not parse against the contract is a code bug, and committing the ack
  // WITHOUT it would silently reproduce the empty-ack defect this exists to
  // close — so the commit is refused (route maps that to a typed 500, the
  // client retries) rather than quietly degraded.
  let judgementFacts: readonly HandlerFact[] = [];
  if (handling === 'fact_and_commit') {
    const fact = buildJudgementFact(payload.event);
    const check = fact === null ? null : HandlerFactSchema.safeParse(fact);
    if (fact === null || check === null || !check.success) {
      log.error(
        {
          request_id: requestId,
          event_kind: payload.event.kind,
          scenario_id: payload.scenario_id,
          parse_error: check?.success === false ? check.error.message : 'no fact built',
        },
        'V5 system event — judgement fact failed its own contract; refusing the commit (fail closed)',
      );
      return { response, commitPerformed: false, graph: null };
    }
    judgementFacts = [check.data];
  }

  // A reader-only refusal is a committed assistant turn. Pending-action
  // authority is deliberately "most recent turn only", so committing an empty
  // row without threading the prior set would make a legitimate offer
  // unreachable even though this refusal neither consumed nor superseded it.
  // Read STRICTLY: on degradation we cannot prove preservation, so fail the
  // commit closed and leave the previous row authoritative. The canonical
  // commit carry-forward owns normal TTL/expiry/hash rules; this seam neither
  // reimplements them nor treats the prior entries as newly-created actions.
  let readerPriorPendingActions:
    | Awaited<ReturnType<typeof loadMostRecentPendingActionsIntegrityStrict>>
    | undefined;
  if (handling === 'reader_only_refusal') {
    try {
      readerPriorPendingActions = await loadMostRecentPendingActionsIntegrityStrict(
        payload.scenario_id,
        requestId,
      );
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: payload.event.kind,
          scenario_id: payload.scenario_id,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 system event compatibility refusal — pending read failed; refusing commit to preserve prior state',
      );
      return { response, commitPerformed: false, graph: null };
    }
  }

  try {
    const commitResult = await commitDirectAnswer(response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: judgementFacts,
      // The compatibility reader is a hard no-new-action floor. Supplying this
      // explicitly prevents refusal copy/chips from deriving a resumable
      // pending at commit time; priorPendingActions below is a distinct input
      // owned by the canonical carry-forward lifecycle.
      ...(handling === 'reader_only_refusal' ? { pending_actions: [] } : {}),
      ...(handling === 'reader_only_refusal'
        ? { priorPendingActions: readerPriorPendingActions }
        : {}),
      // V5 Stage 2B-1b: system-event turns have no user turn / coaching context
      // (no buildTurnContext) — persist NULL explicitly. The most-recent read
      // filters non-null, so this never resets a prior coaching snapshot.
      coaching_state: null,
    });
    log.info(
      {
        request_id: requestId,
        event_kind: payload.event.kind,
        scenario_id: payload.scenario_id,
      },
      handling === 'reader_only_refusal'
        ? 'V5 system event refused by compatibility reader — no graph/fact write or new pending action'
        : 'V5 system event committed',
    );
    return { response: commitResult.response, commitPerformed: true, graph: null };
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: payload.event.kind,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 system event commit failed',
    );
    return { response, commitPerformed: false, graph: null };
  }
}

/**
 * `edge_strength_edit` — strict persisted-edge writer with atomic CAS.
 *
 * The 0.42 event is only intent. Authority stays server-side: read the graph
 * and newest pending row losslessly, let the adapter resolve and validate the
 * exact persisted edge through `adjust_edge_strength`, then hand the merged
 * graph to the existing atomic commit chokepoint. No branch below writes a
 * graph directly or carries pending JSONB around the canonical lifecycle.
 */
async function dispatchEdgeStrengthEdit(
  payload: SystemEventTurnPayload,
  event: Extract<SystemEventTurnPayload['event'], { kind: 'edge_strength_edit' }>,
  requestId: string,
  startedAt: number,
): Promise<DispatchSystemEventResult> {
  let persistedGraph: unknown;
  let priorPendingActions: Awaited<
    ReturnType<typeof loadMostRecentPendingActionsIntegrityStrict>
  >;
  let factsRead: WriteReplyAnalysisInputs;
  try {
    // Both reads are authoritative and required before ANY newest-turn append.
    // The integrity-strict pending read rejects a non-array, any invalid entry,
    // or a scenario mismatch. On either failure the prior row remains newest
    // and therefore authoritative: no refusal transcript is appended.
    [persistedGraph, priorPendingActions, factsRead] = await Promise.all([
      loadPersistedGraphStrict(payload.scenario_id),
      loadMostRecentPendingActionsIntegrityStrict(
        payload.scenario_id,
        requestId,
      ),
      loadWriteReplyAnalysisInputs(payload.scenario_id, requestId),
    ]);
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 edge_strength_edit — authoritative graph/pending read failed; refusing any append',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  let result: Awaited<ReturnType<typeof applyEdgeStrengthEdit>>;
  try {
    result = await applyEdgeStrengthEdit({
      payload,
      event,
      requestId,
      persistedGraph,
    });
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 edge_strength_edit — canonical adapter failed before commit',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  const persistedParse = GraphV3.safeParse(persistedGraph);
  const contentGraph = persistedParse.success ? persistedParse.data : null;
  const currentAnalysisHash = persistedParse.success
    ? computeAnalysisAffectingGraphHash(
        persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      )
    : null;

  // Honest domain refusal: record the attempt, but write no graph/fact/new
  // pending. The exact valid newest pending set is fed into canonical
  // carry-forward, which alone owns TTL, wall expiry and graph-hash survival.
  if (result.kind === 'refused') {
    const response: OlumiResponse =
      currentAnalysisHash !== null
        ? { ...result.response, graph_hash: currentAnalysisHash }
        : result.response;
    // Missing/duplicate/stale endpoint authority is not a normal domain
    // refusal and must never masquerade as 200 success. Append nothing: the
    // strict prior pending row remains newest and untouched. The route turns
    // this descriptor into 409 GRAPH_DIVERGED with exact edge reconciliation
    // details. Other honest refusals still record a transcript below.
    if (result.authorityConflict !== undefined) {
      return {
        response,
        commitPerformed: false,
        graph: contentGraph,
        graphConflict: {
          recovery_action: result.authorityConflict.recovery_action,
          conflict_category: result.authorityConflict.conflict_category,
          expected_base_graph_hash: null,
          edge: result.authorityConflict.edge,
        },
      };
    }
    // ⭐ THE SHIPPED ANSWER MUST BE THE COMMITTED ANSWER — PR #1290's contract,
    // in a site #1290 never touched (it closed the two `chip-click-dispatch.ts`
    // exits; this one and `dispatchStructuralDelete`'s twin below are the same
    // defect, reported independently by the founder and by a reviewer that
    // raised them rather than dropping them when they fell outside #1290).
    //
    // This exit threads `priorPendingActions` (immediately below), so
    // `commitDirectAnswer`'s carry-forward pass can retire a live consent hold —
    // and when it does it AMENDS the response it persists, in two places, both
    // keyed off that same input: it appends the honest one-sentence F-HELD lapse
    // notice (`buildHeldLapseNotice`) and it suppresses competing `run_analysis`
    // suggestion chips (steer-don't-bind). It returns that amended copy as
    // `CommitResult.response`. Discarding it wrote the notice into the turn row
    // and never spoke it: the user's live proposal died silently and the durable
    // record disagreed with the wire about what the user had been told.
    let responseForWire: OlumiResponse = response;
    try {
      const committed = await commitDirectAnswer(response, {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: computeRequestHash(payload),
        llm_calls_used: 0,
        duration_ms: Date.now() - startedAt,
        handler_facts: [],
        pending_actions: [],
        priorPendingActions: priorPendingActions,
        ...(currentAnalysisHash !== null
          ? { graph_hash: currentAnalysisHash }
          : {}),
        ...(contentGraph !== null ? { contentGraph } : {}),
        coaching_state: null,
      });
      // `?? response` is load-bearing, not defensive noise: ~100 suites in this
      // repo stub `commitDirectAnswer`, and a bare `vi.fn()` resolves to
      // `undefined`. Reading `.response` unguarded would ship an undefined wire
      // body on every one of those paths.
      responseForWire = committed?.response ?? response;
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          refusal_reason: result.reason,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 edge_strength_edit — refusal commit failed',
      );
      return { response, commitPerformed: false, graph: null };
    }
    return {
      response: responseForWire,
      commitPerformed: true,
      graph: contentGraph,
    };
  }

  let persistedAnalysisGraphHash: string | null = null;
  let persistedGraphBytes: unknown = null;
  let graphPersisted = false;
  // `null` until the commit resolves. See `replyForAttemptThatWroteNothing`.
  let thisAttemptWrote: boolean | null = null;
  let committedResponse: OlumiResponse = result.response;
  try {
    // The trusted expected base includes both edge mean and direction in its
    // analysis projection and every persisted field in its identity projection.
    // append_turn_atomic_v4/v3 checks the identity under the DB row lock when
    // the deployed CAS RPC is enforcing, closing the read→write race.
    const cas = computeExpectedGraphCasHashes(result.baseGraph);
    const commitResult = await commitDirectAnswer(result.response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      turn_class: 'handler',
      handler_id: 'adjust_edge_strength',
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: result.handlerFacts,
      graph: result.mutatedGraph,
      baseGraphForInvariants: result.baseGraph,
      pending_actions: [],
      priorPendingActions: priorPendingActions,
      contentGraph: result.mutatedGraph,
      // ⚠⚠ SPREAD, NEVER CONDITIONALLY OMITTED (C8-A review defect 1 follow-up,
      // 2026-08-25). This was
      //     ...(cas.expectedGraphIdentityHash !== null ? { … } : {})
      // which turned a KNOWN-ABSENT base into an ABSENT PROPERTY — and those
      // are different facts. `supabase-store.ts` derives `p_expected_base_known`
      // as `write.expectedGraphIdentityHash !== undefined`, so omitting the key
      // made it FALSE on every one of these paths and the whole known-base CAS
      // guard was DARK in the running code: the fix shipped, and nothing on
      // this seam could ever reach it.
      //
      // `computeExpectedGraphCasHashes` already returns BOTH keys, using null
      // for "server base read, but no hashable graph existed" — exactly the
      // fact that must travel. `turn-executor.ts` spreads the object for the
      // same reason. Both metadata fields are typed `string | null | undefined`,
      // so null is carried, not coerced away.
      ...cas,
      coaching_state: null,
    });
    persistedAnalysisGraphHash = commitResult.persistedAnalysisGraphHash;
    persistedGraphBytes = commitResult.persistedGraph;
    graphPersisted = commitResult.graphPersisted;
    thisAttemptWrote = commitResult.thisAttemptWrote;
    committedResponse = commitResult.response;
  } catch (err) {
    if (err instanceof GraphStaleWriteError) {
      log.warn(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          conflict_category: err.conflict_category,
        },
        'V5 edge_strength_edit — atomic graph CAS conflict; refresh and reconfirm',
      );
      return {
        response: result.response,
        commitPerformed: false,
        graph: null,
        graphConflict: {
          recovery_action: 'refresh_and_reconfirm',
          conflict_category: err.conflict_category,
          // Analysis-space (16-hex), from a FRESH read — never the 64-hex
          // identity hash the error carries. See readClientRecoverableBaseHash.
          expected_base_graph_hash: await readClientRecoverableBaseHash(payload.scenario_id),
        },
      };
    }
    // A later turn claimed this scenario, or the user stopped this one: a
    // KNOWN refusal, never the retryable 500 below. See turnFenceConflict.
    const fenceConflict = await turnFenceConflict(err, {
      requestId,
      eventKind: event.kind,
      scenarioId: payload.scenario_id,
    });
    if (fenceConflict !== null) {
      return { response: result.response, commitPerformed: false, graph: null, graphConflict: fenceConflict };
    }
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 edge_strength_edit — atomic mutation commit failed',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }

  // ⛔ F4 — a replay or a reused-id conflict wrote nothing for this attempt; the
  // readback below would compare a reread snapshot, not this attempt's bytes.
  // See `replyForAttemptThatWroteNothing`.
  if (thisAttemptWrote === false) {
    return replyForAttemptThatWroteNothing({
      writer: 'edge_strength_edit',
      payload,
      requestId,
      committedResponse,
      persistedGraphBytes,
      persistedAnalysisGraphHash,
      analysisInputs: factsRead,
      // The edit is in the model iff the unique (from, to) edge carries what the
      // adapter projected for it: the signed mean, the direction, and the
      // user-set provenance stamp — the stamp is the whole of a `confirm_current`
      // change. Not the full-edge deep equality of the readback below: that also
      // compares fields this request did not set.
      requestedChangeVisibleIn: (snapshot) => {
        const requested = result.graph.edges.filter(
          (e) => e.from === event.from && e.to === event.to,
        );
        const stored = snapshot.edges.filter(
          (e) => e.from === event.from && e.to === event.to,
        );
        return (
          requested.length === 1 &&
          stored.length === 1 &&
          stored[0]!.strength.mean === requested[0]!.strength.mean &&
          stored[0]!.effect_direction === requested[0]!.effect_direction &&
          stored[0]!.provenance?.source === requested[0]!.provenance?.source
        );
      },
      logFields: { intent: event.intent },
    });
  }

  const committedParse = GraphV3.safeParse(persistedGraphBytes);
  const exactTargetReadback = isExactCommittedEdgeReadback({
    projected: result.graph,
    committed: persistedGraphBytes,
    from: event.from,
    to: event.to,
  });
  const confirmationStillProvenanceOnly =
    event.intent !== 'confirm_current' ||
    isProvenanceOnlyEdgeConfirmation({
      before: result.baseGraph,
      after: persistedGraphBytes,
      from: event.from,
      to: event.to,
    });
  // A successful append without a trustworthy graph receipt is an ambiguous
  // transport outcome, never a 200 mutation success. Fail the route closed so
  // the UI keeps its write barrier and reconciles; do not fabricate readback
  // from the adapter's pre-commit copy.
  if (
    thisAttemptWrote !== true ||
    graphPersisted !== true ||
    persistedAnalysisGraphHash === null ||
    !committedParse.success ||
    !exactTargetReadback ||
    !confirmationStillProvenanceOnly
  ) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        this_attempt_wrote: thisAttemptWrote,
        graph_persisted: graphPersisted,
        has_analysis_hash: persistedAnalysisGraphHash !== null,
        graph_parse_ok: committedParse.success,
        exact_target_readback: exactTargetReadback,
        confirmation_provenance_only: confirmationStillProvenanceOnly,
      },
      'V5 edge_strength_edit — committed graph receipt invalid; withholding success',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }
  const graphForReadiness = committedParse.data;
  // The exact graph this commit projected and handed to the atomic store is
  // the UI's authoritative readback. It is load-bearing for confirm_current:
  // graph_patch honestly stays `noop` for the unchanged scientific tuple,
  // while this receipt proves provenance was durably stamped.
  const response: OlumiResponse = {
    ...committedResponse,
    ...(persistedAnalysisGraphHash !== null
      ? { graph_hash: persistedAnalysisGraphHash }
      : {}),
    draft_graph: buildAppliedGraphWireField(committedParse.data),
  };
  // Fact history is observational only: it never authorises or blocks the
  // write. A healthy empty read means canonical `none`; a degraded read must
  // not fabricate that conclusion and therefore emits honest `unknown`.
  const freshness: FreshnessDerivation = deriveWriteReplyFreshness(factsRead, persistedAnalysisGraphHash);
  emitFreshnessTelemetry(
    freshness,
    {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: 'system_event.edge_strength_edit',
    },
    {
      prior_fact_count: factsRead.hotWindow.facts.length,
      prior_fact_read_status: factsRead.hotWindow.status,
      scenario_fact_set_status: factsRead.factSet.status,
      current_turn_fact_count: result.handlerFacts.length,
      intent: event.intent,
    },
  );

  log.info(
    {
      request_id: requestId,
      event_kind: event.kind,
      scenario_id: payload.scenario_id,
      intent: event.intent,
    },
    'V5 edge_strength_edit committed — canonical graph/fact written atomically',
  );
  return {
    response,
    commitPerformed: true,
    analysisReady: buildCanonicalAnalysisReadyFromGraph(graphForReadiness),
    freshness,
    graph: graphForReadiness,
  };
}

/**
 * `structural_delete` — persist a removal, atomically, or change nothing.
 *
 * Same shape as the two writers above, and the ORDER is the part that matters:
 *
 *   1. load the persisted graph STRICTLY — the trusted base is the SERVER's own
 *      read, never request-supplied structure (`session/store.ts`: a CAS fed
 *      from the incoming graph validates the write against itself and always
 *      "matches"). For a DELETE this is sharper than for an edit: without an
 *      independent view the server has nothing to refuse a stale removal with;
 *   2. resolve + apply through the canonical PatchOperation train (no mutation
 *      code lives here, and none lives in the adapter either);
 *   3. commit ONCE, with the atomic CAS expected-base threaded — one graph, one
 *      transaction. A partial apply would leave DANGLING EDGES, which is worse
 *      than no apply: the model becomes incoherent rather than merely unchanged;
 *   4. verify the committed bytes actually lost what the user removed;
 *   5. ONLY THEN derive readiness, from the graph that landed.
 *
 * ⚠ WHY THIS WRITER IS NOT GATED ON `config.features.graphCas.rpcEnforce`,
 * unlike `edge_strength_edit` — a deliberate, reversible divergence, disclosed
 * rather than quietly taken.
 *
 * `edge_strength_edit`'s gate is a ROLLOUT device, not a safety property: its own
 * comment describes Train B's "deployed reader floor" for a wire member "whose
 * writer is deliberately not deployed yet". `CEE_V5_GRAPH_CAS_RPC` defaults to
 * `'shadow'` and config records `'enforce'` as "a later explicit step", so
 * gating on it would ship this P0 fix DARK — a user's delete would return
 * FEATURE_NOT_ENABLED and the option would still come back, which is the defect
 * unchanged. The estate's standing rulings forbid exactly that ("ship
 * capabilities ON; rollback = code revert"; no new env gates).
 *
 * ⚠ THE HONEST SAFETY POSTURE — do NOT restate this as "two gates make the write
 * safe". An earlier draft did, and it claimed more than the mechanisms deliver.
 * `CEE_V5_GRAPH_CAS_RPC` defaults to `shadow` (the UPDATE stays UNCONDITIONAL —
 * the CAS is stamped, not enforced) and `CEE_V5_GRAPH_CAS_MODE` defaults to
 * `off`, so NEITHER the adapter's `base_graph_hash` gate nor the receipt check
 * closes the read→write window. The base hash is checked at T0 and the write
 * happens later; nothing in that pair is atomic.
 *
 * What largely closes the window is a DIFFERENT mechanism: the TURN FENCE
 * (`session/turn-fence.ts`), which refuses a graph write from a superseded turn
 * — post-migration inside the append transaction under a FOR UPDATE on the
 * turn's own fence row, and fail-closed when the fence RPC is unavailable.
 *
 * State the posture exactly as: **base checked at T0, writes ordered by the turn
 * fence, CAS stamped-not-enforced** — adequate for single-user acceptance. What
 * IS true about the flag is narrower and still worth having: both the stale gate
 * and the receipt check run UNCONDITIONALLY, so no shadow-mode path reaches the
 * write with an unchecked base hash, and the atomic CAS hashes are threaded so
 * moving the deployment to `enforce` upgrades this writer with no code change —
 * the same posture as `factor_value_edit`, the sibling mutating writer that has
 * never been gated on it. A safety claim stronger than its mechanism is how the
 * next lane gets hurt.
 */
async function dispatchStructuralDelete(
  payload: SystemEventTurnPayload,
  event: Extract<SystemEventTurnPayload['event'], { kind: 'structural_delete' }>,
  requestId: string,
  startedAt: number,
): Promise<DispatchSystemEventResult> {
  let persistedGraph: unknown;
  let priorPendingActions: Awaited<
    ReturnType<typeof loadMostRecentPendingActionsIntegrityStrict>
  >;
  let factsRead: WriteReplyAnalysisInputs;
  try {
    // All three reads are authoritative and required before ANY newest-turn
    // append. On failure the prior row stays newest and authoritative: no
    // transcript is appended, because a degraded read gives no trusted base and
    // guessing at one is how a server model gets clobbered.
    [persistedGraph, priorPendingActions, factsRead] = await Promise.all([
      loadPersistedGraphStrict(payload.scenario_id),
      loadMostRecentPendingActionsIntegrityStrict(payload.scenario_id, requestId),
      loadWriteReplyAnalysisInputs(payload.scenario_id, requestId),
    ]);
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_delete — authoritative graph/pending read failed; refusing any append',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  let result: ReturnType<typeof applyStructuralDelete>;
  try {
    result = applyStructuralDelete({ payload, event, requestId, persistedGraph });
  } catch (err) {
    // A malformed-but-present persisted graph lands here (corruption, not
    // absence). Retryable 500 with no append; the corrupt row stays
    // authoritative rather than being healed forward under a delete.
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_delete — adapter failed before commit',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  const persistedParse = GraphV3.safeParse(persistedGraph);
  const contentGraph = persistedParse.success ? persistedParse.data : null;
  const currentAnalysisHash = persistedParse.success
    ? computeAnalysisAffectingGraphHash(
        persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      )
    : null;

  if (result.kind === 'refused') {
    const response: OlumiResponse =
      currentAnalysisHash !== null
        ? { ...result.response, graph_hash: currentAnalysisHash }
        : result.response;
    // A stale base hash is canonical-state divergence, not a domain refusal, and
    // must never masquerade as a 200. Append NOTHING: the route turns this
    // descriptor into 409 GRAPH_DIVERGED carrying the hash the server holds, so
    // the client's refresh is a bounded action rather than a guess.
    if (result.baseHashConflict !== undefined) {
      return {
        response,
        commitPerformed: false,
        graph: contentGraph,
        graphConflict: {
          recovery_action: result.baseHashConflict.recovery_action,
          conflict_category: result.baseHashConflict.conflict_category,
          expected_base_graph_hash: result.baseHashConflict.expected_base_graph_hash,
        },
      };
    }
    // Every other refusal IS recorded: the transcript should say the user tried
    // to delete and was refused, with no graph write and no new pending. The
    // exact valid newest pending set is fed to canonical carry-forward, which
    // alone owns TTL, wall expiry and graph-hash survival.
    // ⭐ THE SHIPPED ANSWER MUST BE THE COMMITTED ANSWER — the exact twin of the
    // `dispatchEdgeStrengthEdit` refusal exit above, and the same defect PR
    // #1290 closed on the two `chip-click-dispatch.ts` exits. This exit threads
    // `priorPendingActions` (immediately below), so `commitDirectAnswer`'s
    // carry-forward can retire a live consent hold and AMEND the response it
    // persists — the F-HELD lapse notice and the steer-don't-bind chip
    // suppression, both keyed off that same input — returning the amended copy
    // as `CommitResult.response`. Discarding it persisted the honest notice into
    // the turn row and never spoke it.
    //
    // Fixed together with its twin rather than one at a time: a harm closed on
    // one path and left open on its neighbour is how the closed half gets
    // re-opened (CLAUDE.md trap 21).
    let responseForWire: OlumiResponse = response;
    try {
      const committed = await commitDirectAnswer(response, {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: computeRequestHash(payload),
        llm_calls_used: 0,
        duration_ms: Date.now() - startedAt,
        handler_facts: [],
        pending_actions: [],
        priorPendingActions,
        ...(currentAnalysisHash !== null ? { graph_hash: currentAnalysisHash } : {}),
        ...(contentGraph !== null ? { contentGraph } : {}),
        coaching_state: null,
      });
      // `?? response` is load-bearing — see the identical note on the edge
      // writer's exit above (a bare `vi.fn()` stub resolves to `undefined`).
      responseForWire = committed?.response ?? response;
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          refusal_reason: result.reason,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 structural_delete — refusal commit failed',
      );
      return { response, commitPerformed: false, graph: null };
    }
    log.info(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        refusal_reason: result.reason,
      },
      'V5 structural_delete refused — committed honestly, no graph written',
    );
    return { response: responseForWire, commitPerformed: true, graph: contentGraph };
  }

  // ── the mutation path: ONE atomic commit ─────────────────────────────────
  let persistedAnalysisGraphHash: string | null = null;
  let persistedGraphBytes: unknown = null;
  let graphPersisted = false;
  // `null` until the commit resolves. See `replyForAttemptThatWroteNothing`.
  let thisAttemptWrote: boolean | null = null;
  let committedResponse: OlumiResponse = result.response;
  try {
    // The trusted expected base is the SERVER-READ graph, hashed both ways:
    // identity for the in-transaction CAS (append_turn_atomic_v4/v3 compares it
    // under the row lock when enforcing, closing the read→write race) and
    // analysis for the cosmetic-vs-substantive downgrade.
    const cas = computeExpectedGraphCasHashes(result.baseGraph);
    const commitResult = await commitDirectAnswer(result.response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      // ⚠ `direct_answer` + `handler_id: null` IS the estate's ruling for an
      // `edit_graph` receipt, not a shortcut — and it differs from the two
      // writers above, which claim `turn_class: 'handler'` because their
      // handler ids (`set_factor_value`, `adjust_edge_strength`) ARE members of
      // the contract's `V5ActionType`. `edit_graph` is not, so stamping it here
      // would need a schemas widening. `edit-graph-dispatch.ts:3673-3682` records
      // the War Room correction verbatim: turn_class stays `direct_answer`, the
      // RPC accepts non-empty `handler_facts` alongside it (verified via SQL
      // inspection), and the FACT-level `fact_type === 'edit_graph'` is the
      // canonical discriminator every downstream consumer already keys off
      // (recent_changes projector, state-query guard, prior_facts readers).
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: result.handlerFacts,
      // THE LINE THE WHOLE CHANGE IS ABOUT. `commitDirectAnswer` writes
      // scenarios.graph atomically with the turn row when — and only when —
      // this key is present. Omitting it is precisely the defect: a turn row
      // that says a deletion happened over a graph that never lost the node.
      graph: result.mutatedGraph,
      baseGraphForInvariants: result.baseGraph,
      pending_actions: [],
      priorPendingActions,
      contentGraph: result.mutatedGraph,
      // ⚠⚠ SPREAD, NEVER CONDITIONALLY OMITTED (C8-A review defect 1 follow-up,
      // 2026-08-25). This was
      //     ...(cas.expectedGraphIdentityHash !== null ? { … } : {})
      // which turned a KNOWN-ABSENT base into an ABSENT PROPERTY — and those
      // are different facts. `supabase-store.ts` derives `p_expected_base_known`
      // as `write.expectedGraphIdentityHash !== undefined`, so omitting the key
      // made it FALSE on every one of these paths and the whole known-base CAS
      // guard was DARK in the running code: the fix shipped, and nothing on
      // this seam could ever reach it.
      //
      // `computeExpectedGraphCasHashes` already returns BOTH keys, using null
      // for "server base read, but no hashable graph existed" — exactly the
      // fact that must travel. `turn-executor.ts` spreads the object for the
      // same reason. Both metadata fields are typed `string | null | undefined`,
      // so null is carried, not coerced away.
      ...cas,
      coaching_state: null,
    });
    persistedAnalysisGraphHash = commitResult.persistedAnalysisGraphHash;
    persistedGraphBytes = commitResult.persistedGraph;
    graphPersisted = commitResult.graphPersisted;
    thisAttemptWrote = commitResult.thisAttemptWrote;
    committedResponse = commitResult.response;
  } catch (err) {
    if (err instanceof GraphStaleWriteError) {
      log.warn(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          conflict_category: err.conflict_category,
        },
        'V5 structural_delete — atomic graph CAS conflict; refresh and reconfirm',
      );
      return {
        response: result.response,
        commitPerformed: false,
        graph: null,
        graphConflict: {
          recovery_action: 'refresh_and_reconfirm',
          conflict_category: err.conflict_category,
          // Analysis-space (16-hex), from a FRESH read — never the 64-hex
          // identity hash the error carries. See readClientRecoverableBaseHash.
          expected_base_graph_hash: await readClientRecoverableBaseHash(payload.scenario_id),
        },
      };
    }
    // A later turn claimed this scenario, or the user stopped this one: a
    // KNOWN refusal, never the retryable 500 below. See turnFenceConflict.
    const fenceConflict = await turnFenceConflict(err, {
      requestId,
      eventKind: event.kind,
      scenarioId: payload.scenario_id,
    });
    if (fenceConflict !== null) {
      return { response: result.response, commitPerformed: false, graph: null, graphConflict: fenceConflict };
    }
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_delete — atomic mutation commit failed',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }

  // ⛔ F4 — a replay or a reused-id conflict wrote nothing for this attempt; the
  // receipt check below would read a reread snapshot another writer may already
  // have removed the ids from. See `replyForAttemptThatWroteNothing`.
  if (thisAttemptWrote === false) {
    return replyForAttemptThatWroteNothing({
      writer: 'structural_delete',
      payload,
      requestId,
      committedResponse,
      persistedGraphBytes,
      persistedAnalysisGraphHash,
      analysisInputs: factsRead,
      // The removal is in the model iff every removed id and edge pair is ABSENT
      // — the same keys (`from::to`) the receipt check below compares.
      requestedChangeVisibleIn: (snapshot) => {
        const snapshotNodeIds = new Set(snapshot.nodes.map((n) => n.id));
        const snapshotEdgePairs = new Set(snapshot.edges.map((e) => `${e.from}::${e.to}`));
        return (
          result.removedNodeIds.every((id) => !snapshotNodeIds.has(id)) &&
          result.removedEdgePairs.every((pair) => !snapshotEdgePairs.has(pair))
        );
      },
      logFields: {
        requested_removed_node_count: result.removedNodeIds.length,
        requested_removed_edge_count: result.removedEdgePairs.length,
      },
    });
  }

  // ── the post-commit receipt check ────────────────────────────────────────
  // A successful append without a trustworthy receipt is an ambiguous transport
  // outcome, never a 200 mutation success. For a DELETE the claim to verify is
  // ABSENCE: every id the user removed must be gone.
  //
  // ⚠⚠ WHAT THIS ACTUALLY CHECKS — READ BEFORE RELYING ON IT. An earlier version
  // of this comment called it "the bytes the store actually holds" and told the
  // next lane never to fabricate it "from the adapter's pre-commit copy". THAT
  // WAS A STRONGER CLAIM THAN THE CODE DELIVERS, which is exactly the defect
  // class this estate calls an honest label overwritten by a false one.
  //
  // `commitResult.persistedGraph` is `graphForStore`, and `commit.ts:372-373`
  // says so in terms: *"Do NOT treat it as a general read-back: it is this
  // commit's own input after projection, not a re-read."* So this compares the
  // adapter's projected graph against the commit chokepoint's own SECOND
  // projection of it. It is a non-idempotent-projection check, NOT a database
  // read-back.
  //
  // That is still worth having — `projectGraphForPersistence` repairs,
  // normalises and reconciles, and `reconcileTopLevelOptionsFromNodes` is
  // precisely a pass that can re-add option entries — so a projection that
  // reintroduced a removed id would be caught here. What it CANNOT see is the
  // store persisting something different from what it was handed. A real
  // read-back would need a post-commit SELECT this seam does not perform.
  // (This is the demonstrated reason the M12 mutant survives: with no second,
  // independent source of bytes, the comparison has nothing to disagree with.)
  const committedParse = GraphV3.safeParse(persistedGraphBytes);
  const committedNodeIds = committedParse.success
    ? new Set(committedParse.data.nodes.map((n) => n.id))
    : new Set<string>();
  const committedEdgePairs = committedParse.success
    ? new Set(committedParse.data.edges.map((e) => `${e.from}::${e.to}`))
    : new Set<string>();
  const removalsLanded =
    committedParse.success &&
    result.removedNodeIds.every((id) => !committedNodeIds.has(id)) &&
    result.removedEdgePairs.every((pair) => !committedEdgePairs.has(pair));
  if (
    thisAttemptWrote !== true ||
    graphPersisted !== true ||
    persistedAnalysisGraphHash === null ||
    !committedParse.success ||
    !removalsLanded
  ) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        this_attempt_wrote: thisAttemptWrote,
        graph_persisted: graphPersisted,
        has_analysis_hash: persistedAnalysisGraphHash !== null,
        graph_parse_ok: committedParse.success,
        removals_landed: removalsLanded,
      },
      'V5 structural_delete — committed graph receipt invalid; withholding success',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }
  const graphForReadiness = committedParse.data;

  // The authoritative receipt the UI binds to. `draft_graph` is the UI's ONLY
  // inline-graph ingestion path (`applied-graph-emit.ts`), and a removal is
  // expressed there as ABSENCE from the applied graph — which is why the
  // `graph_patch` block is not the right carrier for this event even setting
  // aside that its `operation` enum cannot name a delete.
  const response: OlumiResponse = {
    ...committedResponse,
    graph_hash: persistedAnalysisGraphHash,
    draft_graph: buildAppliedGraphWireField(graphForReadiness),
  };

  // Fact history is observational only: it never authorises or blocks the write.
  // A healthy empty read means canonical `none`; a degraded read must not
  // fabricate that conclusion and therefore emits honest `unknown`.
  const freshness: FreshnessDerivation = deriveWriteReplyFreshness(factsRead, persistedAnalysisGraphHash);
  emitFreshnessTelemetry(
    freshness,
    {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: 'system_event.structural_delete',
    },
    {
      prior_fact_count: factsRead.hotWindow.facts.length,
      prior_fact_read_status: factsRead.hotWindow.status,
      scenario_fact_set_status: factsRead.factSet.status,
      removed_node_count: result.removedNodeIds.length,
      removed_edge_count: result.removedEdgePairs.length,
    },
  );

  log.info(
    {
      request_id: requestId,
      event_kind: event.kind,
      scenario_id: payload.scenario_id,
      removed_node_count: result.removedNodeIds.length,
      removed_edge_count: result.removedEdgePairs.length,
    },
    'V5 structural_delete committed — canonical graph/fact written atomically, removals verified in the persisted bytes',
  );
  return {
    response,
    commitPerformed: true,
    // Readiness from the bytes that LANDED, never the pre-mutation graph:
    // deleting an option can legitimately move the model to not-analysable, and
    // that verdict must describe the model the user now has.
    analysisReady: buildCanonicalAnalysisReadyFromGraph(graphForReadiness),
    freshness,
    graph: graphForReadiness,
  };
}

/**
 * `factor_value_edit` — run the real mutation, commit it, and stamp readiness.
 *
 * The shape mirrors the turn-executor's own write chokepoint, and the ORDER is
 * the part that matters:
 *
 *   1. load the persisted graph STRICTLY (throws on a degraded read — never
 *      guess at a base, because guessing is how you clobber a server model);
 *   2. run the existing validator + handler (no mutation code lives here);
 *   3. commit the merged graph with a CAS expected-base;
 *   4. ONLY THEN derive readiness, from the graph that actually landed.
 *
 * Step 4 after step 3 is deliberate: deriving readiness pre-commit once shipped
 * a post-mutation hash paired with pre-mutation interventions.
 */
async function dispatchFactorValueEdit(
  payload: SystemEventTurnPayload,
  event: Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }>,
  requestId: string,
  startedAt: number,
): Promise<DispatchSystemEventResult> {
  let persistedGraph: unknown;
  try {
    persistedGraph = await loadPersistedGraphStrict(payload.scenario_id);
  } catch (err) {
    // Fail CLOSED. A degraded read gives no trusted merge base, so writing
    // anything risks clobbering a model we cannot see. Surface it as a failed
    // commit; the route maps that to a typed 500 rather than a false success.
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 factor_value_edit — persisted-graph read failed; refusing the write (fail closed)',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  /**
   * ⛔ READ THE FACTS *WITH* THEIR READ STATE. `loadPriorFactsQuietly` discards it
   * and returns a bare array, so a DEGRADED read is indistinguishable from a
   * genuinely empty one — and `deriveAnalysisFreshness([], hash)` would then report
   * `none` ("no run has happened") from a read that simply failed. That is the
   * estate's own named trap: an absence that was never observed reported as an
   * observed absence. The existing `priorFacts` consumer below is unchanged.
   *
   * ⭐ AND THE SCENARIO'S ANALYSIS RECORD, NOT ONLY THE LAST 20 ROWS. The window
   * alone (`readRecent`, SESSION_READ_WINDOW_DEFAULT rows) loses the run once
   * ~20 value ops / Agent turns have passed, and the reply then said `none`
   * about an analysis this very edit had just made stale. The composer is the
   * reload route's own (`routes/scenario-graph-analysis-read.ts`): the turn
   * path's hot-window and durable readers, reconciled. `hotWindow` is exactly
   * the window this function always read, so the handler's `priorFacts` input
   * keeps its meaning; only the freshness below chooses the durable set.
   */
  const {
    hotWindow: priorFactsRead,
    factSet: analysisFactSet,
    analysisInvalidatedAt,
    analysisInvalidatedAtReadOk,
  } = await loadWriteReplyAnalysisInputs(payload.scenario_id, requestId);
  const priorFacts = priorFactsRead.facts;

  const result = await applyFactorValueEdit({
    payload,
    event,
    requestId,
    persistedGraph,
    priorFacts,
  });

  // ── the refusal path ─────────────────────────────────────────────────────
  // An above-cap value, an unknown target, an inconsistent scale: all land
  // here. The turn IS committed (the transcript should record that the user
  // tried and was refused) but NO graph is written, so `scenarios.graph` is
  // untouched and `graph_hash` does not move. Never a silent clamp, never a 500.
  if (result.kind === 'refused') {
    try {
      await commitDirectAnswer(result.response, {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: computeRequestHash(payload),
        llm_calls_used: 0,
        duration_ms: Date.now() - startedAt,
        handler_facts: [],
        // The consented "extend the scale" chip's backing pending. Supplied
        // EXPLICITLY (not left to commit.ts's chip-derivation default) because
        // this pending carries structured `{value, unit, cap}` that no chip can
        // encode — deriving it from the chip set would lose the cap, which is the
        // whole point of the consent. Omitted entirely when empty so the normal
        // derivation still runs for every other refusal.
        ...(result.pendingActions.length > 0
          ? { pending_actions: result.pendingActions }
          : {}),
        coaching_state: null,
      });
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          refusal_reason: result.reason,
          err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
        },
        'V5 factor_value_edit — refusal commit failed',
      );
      return { response: result.response, commitPerformed: false, graph: null };
    }
    log.info(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        refusal_reason: result.reason,
        rescale_pendings_persisted: result.pendingActions.length,
      },
      'V5 factor_value_edit refused — committed honestly, no graph written',
    );
    return { response: result.response, commitPerformed: true, graph: null };
  }

  // ── the mutation path ────────────────────────────────────────────────────
  let persistedAnalysisGraphHash: string | null = null;
  let persistedGraphBytes: unknown = null;
  let committedResponse: OlumiResponse = result.response;
  try {
    const cas = computeExpectedGraphCasHashes(result.baseGraph);
    const commitResult = await commitDirectAnswer(result.response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      // A handler ran and produced facts. Claiming `direct_answer` with a
      // populated `handler_facts` would misreport the turn to every consumer
      // that keys off turn_class.
      turn_class: 'handler',
      handler_id: 'set_factor_value',
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: result.handlerFacts,
      // THE LINE THE WHOLE CHANGE IS ABOUT. `commitDirectAnswer` writes
      // scenarios.graph atomically with the turn row when — and only when —
      // this key is present, and RECOMPUTES the authoritative graph_hash from
      // the persisted bytes. Omitting it is precisely the old behaviour whose
      // symptom was a hash that never moved.
      graph: result.mutatedGraph,
      baseGraphForInvariants: result.baseGraph,
      // ⚠⚠ SPREAD, NEVER CONDITIONALLY OMITTED (C8-A review defect 1 follow-up,
      // 2026-08-25). This was
      //     ...(cas.expectedGraphIdentityHash !== null ? { … } : {})
      // which turned a KNOWN-ABSENT base into an ABSENT PROPERTY — and those
      // are different facts. `supabase-store.ts` derives `p_expected_base_known`
      // as `write.expectedGraphIdentityHash !== undefined`, so omitting the key
      // made it FALSE on every one of these paths and the whole known-base CAS
      // guard was DARK in the running code: the fix shipped, and nothing on
      // this seam could ever reach it.
      //
      // `computeExpectedGraphCasHashes` already returns BOTH keys, using null
      // for "server base read, but no hashable graph existed" — exactly the
      // fact that must travel. `turn-executor.ts` spreads the object for the
      // same reason. Both metadata fields are typed `string | null | undefined`,
      // so null is carried, not coerced away.
      ...cas,
      coaching_state: null,
    });
    persistedAnalysisGraphHash = commitResult.persistedAnalysisGraphHash;
    persistedGraphBytes = commitResult.persistedGraph;
    committedResponse = commitResult.response;
  } catch (err) {
    // ⭐ ANOTHER WRITER COMMITTED AFTER THIS EDIT'S BASE READ. The atomic CAS
    // refused the write, so nothing of this edit landed. That is a KNOWN
    // outcome, not an unconfirmed one, so it gets the typed conflict the
    // structural writers already return, never the retryable 500 below. That
    // 500 told a caller "we do not know whether your value was saved" about a
    // write we DO know was refused, and invited a blind retry over the other
    // writer's change.
    if (err instanceof GraphStaleWriteError) {
      log.warn(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          target_id: event.target_id,
          conflict_category: err.conflict_category,
        },
        'V5 factor_value_edit — atomic graph CAS conflict; refresh and reconfirm',
      );
      return {
        response: result.response,
        commitPerformed: false,
        graph: null,
        graphConflict: {
          recovery_action: 'refresh_and_reconfirm',
          conflict_category: err.conflict_category,
          // Analysis-space (16-hex), from a FRESH read, never the 64-hex
          // identity hash the error carries. See readClientRecoverableBaseHash.
          expected_base_graph_hash: await readClientRecoverableBaseHash(payload.scenario_id),
        },
      };
    }
    // ⭐ A LATER TURN CLAIMED THIS SCENARIO, OR THE USER STOPPED THIS ONE (F5).
    // The turn fence refused the write inside the append transaction, so
    // nothing of this edit landed — a KNOWN refusal, answered with the typed
    // 409 the message path already returns, never the retryable 500 below.
    // One mapping for every writer: see turnFenceConflict.
    const fenceConflict = await turnFenceConflict(err, {
      requestId,
      eventKind: event.kind,
      scenarioId: payload.scenario_id,
      targetId: event.target_id,
    });
    if (fenceConflict !== null) {
      return { response: result.response, commitPerformed: false, graph: null, graphConflict: fenceConflict };
    }
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        target_id: event.target_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 factor_value_edit — mutation commit failed',
    );
    // commitPerformed:false with no recognised skip reason ⇒ the route returns
    // a typed 500. Correct: nothing landed, and saying otherwise would tell the
    // UI to show a change that does not exist.
    return { response: result.response, commitPerformed: false, graph: null };
  }

  log.info(
    {
      request_id: requestId,
      event_kind: event.kind,
      scenario_id: payload.scenario_id,
      target_id: event.target_id,
    },
    'V5 factor_value_edit committed — graph written, hash recomputed',
  );

  // ⚠ ADVERTISE THE PERSISTED HASH, NOT ONE WE COMPUTED OURSELVES.
  //
  // `commitDirectAnswer` runs `projectGraphForPersistence` on the way to the
  // store (it repairs the graph, normalises option-intervention contracts and
  // reconciles top-level options), so the bytes that land are NOT the bytes we
  // handed it. Letting the egress sanitiser hash OUR copy advertises a hash the
  // next turn will never read back — the UI would compare its
  // `computed_against_hash` against a value that never existed and conclude
  // "stale" (or "fresh") on a fiction. That is the same class of defect as the
  // frozen hash this change exists to fix, so it is not a nicety.
  //
  // `persistedAnalysisGraphHash` is documented as "the only hash a caller may
  // advertise for this turn" (commit.ts:347-352). The sanitiser's
  // `response.graph_hash ?? compute(opts.graph)` precedence exists for exactly
  // this "authoritative upstream setter" case, so setting it here wins.
  //
  // Caught by `route-v2-factor-value-edit.test.ts` — the wire hash and the hash
  // of the graph the store received disagreed until this was threaded.
  // Readiness and the UI receipt must both describe the bytes that LANDED.
  // A successful factor edit is a mutation on a non-empty canvas; the client
  // reconciles that authoritative postimage from the top-level `draft_graph`.
  // Without it the edit persists server-side but appears reverted until reload.
  const committedParse = GraphV3.safeParse(persistedGraphBytes);
  const graphForReadiness = committedParse.success ? committedParse.data : result.graph;

  const response: OlumiResponse = {
    ...committedResponse,
    ...(persistedAnalysisGraphHash !== null
      ? { graph_hash: persistedAnalysisGraphHash }
      : {}),
    // Only attest a committed postimage when the persisted bytes parse.
    ...(committedParse.success
      ? { draft_graph: buildAppliedGraphWireField(committedParse.data) }
      : {}),
  };

  // Readiness from the bytes that LANDED, not from our pre-projection copy.
  //
  // This is not pedantry. The canonical graph adapter reads each option node's
  // merged `interventions`, and `projectGraphForPersistence` runs
  // `normaliseOptionInterventionContract` over exactly that field on the way to
  // the store. Deriving readiness from the un-projected graph can therefore
  // publish a readiness verdict for a graph that was never stored — the same
  // "advertised state != persisted state" class as the hash defect above.
  // Falls back to the merged graph only if the projected bytes fail to re-parse,
  // which would itself mean the store holds something we cannot model.
  /**
   * ⛔⛔ AND THE FRESHNESS, WHICH THIS WRITER OMITTED. #63 item 15.
   *
   * Measured on Paul's live journey: a factor-value edit returned `analysisReady`
   * with NO freshness, so a surface that clears its "stale" mark only on that field
   * looked clean immediately after an edit that had just invalidated the analysis.
   * The edge-strength writer in this same file already derives it; the value writer
   * — by far the commoner edit — did not.
   *
   * Same derivation, same honesty rule as that sibling: a healthy read yields a real
   * verdict, a degraded read yields `unknown` with `derivation_failed` rather than
   * fabricating `none`. Fact history is observational only and never authorises or
   * blocks the write, so a failed read cannot lose the user's edit.
   *
   * THE FACT-SOURCE RULE IS THE RELOAD ROUTE'S (`scenario-graph-analysis-read.ts`):
   * the durable set when it is reasoning authority (`complete | capped`), else the
   * hot window. Absence is authoritative only for the `complete` record — under
   * `capped` unread history sits behind the wall, and in the window fallback the
   * 20 rows can hide an older run, so an empty selection stays `unknown /
   * derivation_failed` in both (the turn path's rule, `build-turn-context.ts`).
   *
   * AND THE RESTORE MARKER, as the reload reads it (`loadWriteReplyAnalysisInputs`):
   *   an edit that lands back on an analysed hash after a version restore reads
   *   `stale / model_restored_after_analysis` here too, never `fresh` while the
   *   reload says `stale` (#1892, Independent Review 5827685385).
   */
  // The shared rule (`deriveWriteReplyFreshness`): absence only in a COMPLETE record.
  const freshness: FreshnessDerivation = deriveWriteReplyFreshness(
    { hotWindow: priorFactsRead, factSet: analysisFactSet, analysisInvalidatedAt, analysisInvalidatedAtReadOk },
    persistedAnalysisGraphHash,
  );
  emitFreshnessTelemetry(
    freshness,
    {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: 'system_event.factor_value_edit',
    },
  );
  return {
    response,
    commitPerformed: true,
    analysisReady: buildCanonicalAnalysisReadyFromGraph(graphForReadiness),
    freshness,
    // Still the full graph: the egress id-leak scrub resolves ids to labels
    // against it, independently of the hash above.
    graph: graphForReadiness,
  };
}

/**
 * `structural_rename` — commit the label, verify it in the committed bytes.
 *
 * Same shape as `dispatchStructuralDelete` and for the same reasons: three
 * authoritative reads first, adapter second, ONE atomic commit third, receipt
 * check fourth. Two things differ, and both are derived from the fact that a
 * label is not analysis-affecting:
 *
 *  1. THE RECEIPT CHECK ASSERTS PRESENCE, NOT ABSENCE. For a delete the claim is
 *     "the ids are gone"; here it is "the named node carries the new label".
 *
 *  2. `analysisReady` IS DELIBERATELY NOT RE-DERIVED AND NOT STAMPED. A rename
 *     cannot move readiness — `label` is absent from the analysis projection, and
 *     the adapter has already REFUSED the write if the projected hash moved. The
 *     dispatch contract at the top of this file says an undefined `analysisReady`
 *     leaves the UI's prior verdict standing, which is exactly right: it was
 *     correct before the rename and the rename did not touch it. Stamping a
 *     freshly-derived one would be a second computation of an unchanged fact,
 *     and any disagreement between them would be noise presented as a change.
 *     `freshness` is likewise omitted — the graph hash did not move, so the
 *     currency of any prior analysis is exactly what it was.
 *
 * ⚠ WHY THIS WRITER IS NOT GATED ON `config.features.graphCas.rpcEnforce`: the
 * same reasoning `dispatchStructuralDelete` records above — that gate is a
 * ROLLOUT device whose default (`shadow`) would ship this capability DARK, and
 * the estate's standing ruling is to ship capabilities ON with a code revert as
 * the rollback. The safety posture is stated the same honest way: base checked at
 * T0, writes ordered by the turn fence, CAS stamped-not-enforced.
 */
/**
 * ⭐⭐ 0.54.0 — the PUBLIC route to the option→factor effect writer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS, AND WHY IT IS THIN
 *
 * Its siblings above are long because their writers are inline. This one is
 * short on purpose: `executeOptionInterventionEdit` — released internally and
 * unadmitted until now — already owns the whole transaction. It loads the
 * canonical graph, reads the pending authority, verifies the client's asserted
 * base hash AGAINST THE LOADED BYTES, composes through the same operation
 * constructor → parser → live referee → applier → intervention encoder the
 * conversational path uses, commits through `commitDirectAnswer`, reads the
 * graph BACK, and binds the persisted parent row and its atomic fact before it
 * will call anything committed.
 *
 * So this function adds exactly two things and must add nothing else:
 * the server-derived inputs the client is not entitled to supply, and an
 * honest mapping of four outcomes onto the dispatch result.
 *
 * ⚠ IT MINTS NO SECOND WRITER, NO SECOND VALIDATION AND NO SECOND POLICY. If a
 * rule seems missing here, it is because the writer already owns it — check
 * `prepareOptionInterventionEdit` before adding one, because a second copy of a
 * rule is how the two spellings start to disagree.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE CLIENT SUPPLIES, AND WHAT IT MAY NOT
 *
 * From the event: the two canonical ids, the model-scale value, and the base
 * graph hash it last read. Nothing else — the member is `.strict()` and carries
 * no unit, raw value, provenance or actor precisely so that none of them can
 * arrive as a claim.
 *
 * ⚠ `base_graph_hash` IS AN ASSERTION, NEVER A FACT, and the writer treats it
 * as one: `prepareOptionInterventionEdit` recomputes the analysis-affecting
 * hash from the graph it loaded and refuses `stale_graph` on a mismatch. So a
 * client on a stale base cannot write, whatever it claims here.
 *
 * Server-derived here, because they are authority the client does not hold:
 *
 *   · `freshness` — the referee consumes it. Derived from the prior facts
 *     against the hash under edit. ⚠ A DEGRADED READ FAILS CLOSED TO
 *     `'unknown'`, and the writer REFUSES on `'unknown'` (pinned by
 *     `option-intervention-transaction.test.ts`). That is deliberate: an
 *     unreadable fact history is not permission, and this is the one place the
 *     temptation to default to `'none'` would silently grant it.
 *   · `hasExistingAnalysis` — observational only. It never authorises the write.
 *   · `turnId` / `requestId` / `requestHash` — the replay key and the record,
 *     from the turn rather than from anything the client said.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FOUR OUTCOMES, AND WHY THREE OF THEM RETURN `commitPerformed: false`
 *
 *   committed   → the writer proved it: graph read back, parent row and fact
 *                 bound, receipt (if any) matching this turn. Its own response
 *                 is returned with the persisted hash stamped, and the applied
 *                 graph is handed to the egress sanitiser so the ack's entity
 *                 ids resolve to labels against the graph that actually landed.
 *   unchanged   → the value was already what the user asked for. Nothing was
 *                 appended, so nothing is claimed.
 *   refused     → a gate declined. No graph, no commit.
 *   unverified  → ⚠ THE ONE THAT NEEDS CARE. The writer reached this state
 *                 because it could NOT prove what happened — a commit may have
 *                 landed. It explicitly refuses to assert a rollback, and
 *                 neither does this. `commitPerformed: false` is the fail-closed
 *                 report, not a claim that nothing was written: the retry is
 *                 idempotent on (scenario_id, turn_id), so under-reporting
 *                 costs a duplicate-key no-op while over-reporting would tell
 *                 the finaliser a turn exists that may not. The distinction the
 *                 boolean cannot carry is carried by the log line instead.
 *
 * ⚠ AND NONE OF THE THREE INVENTS COPY. The silent acknowledgement is this
 * seam's convention, shared with every sibling's refusal path. The surface that
 * performed the gesture renders the outcome; a message bubble minted here would
 * be a second voice describing an edit the user is already looking at.
 */
async function dispatchOptionInterventionEdit(
  payload: SystemEventTurnPayload,
  event: Extract<SystemEventTurnPayload['event'], { kind: 'option_intervention_edit' }>,
  requestId: string,
): Promise<DispatchSystemEventResult> {
  let priorFactsRead: Awaited<ReturnType<typeof loadPriorFactsWithReadState>>;
  try {
    priorFactsRead = await loadPriorFactsWithReadState(payload.scenario_id, requestId);
  } catch (err) {
    // The read itself threw. Refuse before any append: a degraded history gives
    // no trusted freshness, and the prior row stays newest and authoritative.
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 option_intervention_edit — prior-fact read failed; refusing any append',
    );
    return { response: buildAcknowledgementResponse(payload), commitPerformed: false, graph: null };
  }

  const freshness: FrameFreshness =
    priorFactsRead.status === 'ok'
      ? deriveAnalysisFreshness(priorFactsRead.facts, event.base_graph_hash).freshness
      : 'unknown';
  const hasExistingAnalysis =
    priorFactsRead.status === 'ok' && priorFactsRead.facts.some(isSuccessfulRunAnalysisFact);

  const outcome = await executeOptionInterventionEdit(
    {
      optionId: event.option_id,
      factorId: event.factor_id,
      modelValue: event.value,
      expectedGraphHash: event.base_graph_hash,
      scenarioId: payload.scenario_id,
      turnId: payload.turn_id,
      requestId,
      stage: payload.stage,
      requestHash: computeRequestHash(payload),
      freshness,
      hasExistingAnalysis,
    },
    getSessionStore(),
  );

  if (outcome.kind === 'committed') {
    // ⚠ THE GRAPH FIELD IS A VALIDATED VIEW, AND IT IS NOT THE AUTHORITY.
    // `DispatchSystemEventResult.graph` feeds the egress sanitiser, which needs
    // a parsed GraphV3 to resolve entity ids to labels. The writer returns the
    // raw persisted bytes as `unknown` ON PURPOSE — they are the postimage it
    // verified, and re-parsing them must never become a second source of truth.
    // So: parse for PRESENTATION, and keep `analysisGraphHash` — computed by the
    // writer over the raw bytes — as the hash on the wire. A parse failure
    // degrades the scrub to graph-free; it does not degrade the receipt.
    const committedParse = GraphV3.safeParse(outcome.graph);
    const graphForReadiness = committedParse.success ? committedParse.data : null;

    // ⭐ READINESS AND FRESHNESS ARE RE-DERIVED AGAINST THE BYTES THAT LANDED.
    //
    // The `freshness` passed INTO the writer is a pre-write input the referee
    // consumes; forwarding it here would describe the model as it was before
    // this edit. The sibling structural/edge writers derive both after the
    // commit for exactly that reason, and this is a model-changing route.
    //
    // ⚠ AND THE HEALTHY-EMPTY / DEGRADED DISTINCTION SURVIVES. A history read
    // that succeeded and found nothing is `none` — a real verdict. A read that
    // degraded is `unknown`. Collapsing them would let a transport failure
    // masquerade as "this model has never been analysed". No extra I/O: the
    // prior facts are re-projected against the committed hash.
    const freshnessAfterCommit: FreshnessDerivation =
      priorFactsRead.status === 'ok'
        ? deriveAnalysisFreshness(priorFactsRead.facts, outcome.analysisGraphHash)
        : {
            freshness: 'unknown',
            reason: 'derivation_failed',
            selected_fact_index: null,
            graph_hash_at_run: null,
            current_graph_hash: outcome.analysisGraphHash,
            computed_at: null,
          };
    emitFreshnessTelemetry(
      freshnessAfterCommit,
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        dispatch_path: 'system_event.option_intervention_edit',
      },
      { prior_fact_count: priorFactsRead.status === 'ok' ? priorFactsRead.facts.length : 0 },
    );

    log.info(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        option_id: event.option_id,
        factor_id: event.factor_id,
        persisted_row_id: outcome.persistedRowId,
        freshness_after_commit: freshnessAfterCommit.freshness,
        committed_graph_parsed: committedParse.success,
      },
      'V5 option_intervention_edit — committed',
    );
    // Derived ONCE and used twice — the receipt below must not disagree with
    // the readiness beside it about which options and which goal the committed
    // graph holds.
    const canonicalReady =
      graphForReadiness !== null
        ? buildCanonicalAnalysisReadyFromGraph(graphForReadiness)
        : undefined;

    /**
     * ⭐⭐⭐ THE COMMITTED POSTIMAGE GOES BACK, AND WITHOUT IT THIS WHOLE ROUTE
     * IS WRITE-ONLY.
     *
     * The client wrote nothing locally — deliberately; the applied response owns
     * the store. So until this turn carries the committed value back, a
     * SUCCESSFUL edit leaves the user's row saying "sent, not saved yet" for the
     * rest of the session, and a second edit is unreachable behind it.
     *
     * ⚠ AND THE CARRIER ALREADY EXISTS — I claimed otherwise and was wrong. I
     * derived at ONE receiver (`applyV5State`'s three-operation `graph_patch`
     * switch) and generalised to "the wire cannot carry the value". The UI's
     * applied-edit path is a DIFFERENT receiver: `useConversation.ts:5004` takes
     * a top-level `draft_graph` on a NON-EMPTY canvas as an applied-edit receipt
     * and reconciles it atomically — adds, UPDATES and deletions — precisely
     * because "a successful edit returns `blocks: []` and the receipt's
     * draft_graph is the entire committed post-state", which is exactly this
     * writer's shape.
     *
     * ⚠ NOT `buildAppliedGraphWireField`. That helper omits `options` and
     * `goal_node_id`, and for a canonical transactional producer their omission
     * is not a smaller truth but a different one — the contract reads an absent
     * `options` as "this producer made no complete options attestation", on the
     * one turn whose subject is an option's canonical record.
     *
     * ⚠ OMITTED ENTIRELY WHEN THE COMMITTED GRAPH DID NOT PARSE. A receipt is an
     * attestation about bytes; with no parsed view there is no basis for one,
     * and the honest answer is absence — the same rule the readiness above
     * follows, for the same reason.
     */
    const committedReceipt =
      graphForReadiness !== null && canonicalReady !== undefined
        ? buildCanonicalCommittedGraphReceipt(graphForReadiness, canonicalReady)
        : undefined;

    return {
      response: {
        ...outcome.response,
        graph_hash: outcome.analysisGraphHash,
        ...(committedReceipt !== undefined ? { draft_graph: committedReceipt } : {}),
      },
      commitPerformed: true,
      // Readiness from the bytes that LANDED. `undefined` only when the
      // committed graph did not parse — an honest absence, not a guess.
      ...(graphForReadiness !== null ? { analysisReady: canonicalReady } : {}),
      freshness: freshnessAfterCommit,
      graph: graphForReadiness,
    };
  }

  // ── Everything below committed NOTHING, and the three cases need opposite
  // follow-ups. Reporting them all as `commitPerformed: false` with no skip
  // reason is what made a permanently stale base and a same-value edit arrive
  // at the client as a retryable 500.
  if (outcome.kind === 'unchanged') {
    log.info(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        option_id: event.option_id,
        factor_id: event.factor_id,
      },
      'V5 option_intervention_edit — verified no-op: the model already holds this value',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      commitSkippedReason: 'verified_no_op',
      graph: null,
    };
  }

  if (outcome.kind === 'refused') {
    // ⭐ A STALE BASE IS A CONFLICT, NOT A FAILURE, and it has a shipped
    // recovery: refresh and reconfirm. The hash handed back is read from the
    // CURRENT persisted graph in analysis space — the same space the client
    // sent — so the instruction is followable rather than a bare "try again".
    if (outcome.reason === 'stale_graph') {
      const expectedBaseGraphHash = await readClientRecoverableBaseHash(payload.scenario_id);
      log.warn(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          option_id: event.option_id,
          factor_id: event.factor_id,
          client_base_graph_hash: event.base_graph_hash,
          expected_base_graph_hash: expectedBaseGraphHash,
        },
        'V5 option_intervention_edit — stale base: refusing with refresh-and-reconfirm',
      );
      return {
        response: buildAcknowledgementResponse(payload),
        commitPerformed: false,
        graph: null,
        graphConflict: {
          recovery_action: 'refresh_and_reconfirm',
          conflict_category: 'stale_base_graph_hash',
          expected_base_graph_hash: expectedBaseGraphHash,
        },
      };
    }
    // Every other refusal is the request itself being unhonourable against the
    // canonical model — an unresolvable id, an option and factor that are not
    // linked, a value outside the model scale. Repeating it cannot succeed, so
    // it must not be advertised as retryable.
    log.warn(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        option_id: event.option_id,
        factor_id: event.factor_id,
        refusal_reason: outcome.reason,
      },
      'V5 option_intervention_edit — refused, nothing written',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      commitSkippedReason: 'refused_no_write',
      graph: null,
    };
  }

  // ⚠ UNVERIFIED. The writer could not prove what happened and explicitly
  // refuses to assert a rollback; a commit MAY have landed. So this deliberately
  // takes NO skip reason and keeps the retryable failure path: the retry is
  // idempotent on (scenario_id, turn_id), and "we do not know" must not be
  // rendered as "nothing happened".
  log.error(
    {
      request_id: requestId,
      event_kind: event.kind,
      scenario_id: payload.scenario_id,
      option_id: event.option_id,
      factor_id: event.factor_id,
      reason: outcome.reason,
      commit_attempted: outcome.commitAttempted,
    },
    'V5 option_intervention_edit — UNVERIFIED: no success claimed and no rollback asserted',
  );
  return { response: buildAcknowledgementResponse(payload), commitPerformed: false, graph: null };
}

async function dispatchStructuralRename(
  payload: SystemEventTurnPayload,
  event: Extract<SystemEventTurnPayload['event'], { kind: 'structural_rename' }>,
  requestId: string,
  startedAt: number,
): Promise<DispatchSystemEventResult> {
  let persistedGraph: unknown;
  let priorPendingActions: Awaited<
    ReturnType<typeof loadMostRecentPendingActionsIntegrityStrict>
  >;
  // A rename cannot move the analysis hash, but its reply must still STATE the
  // verdict: without one the finaliser answered `unknown_degraded /
  // no_graph_this_turn` beside the graph it had just written.
  let factsRead: WriteReplyAnalysisInputs;
  try {
    // Both reads are authoritative and required before ANY newest-turn append.
    // On failure the prior row stays newest and authoritative: no transcript is
    // appended, because a degraded read gives no trusted base.
    //
    // ⚠ NO PRIOR-FACTS READ, unlike the delete sibling. That read exists there
    // ONLY to derive `freshness`, which this path does not emit (see the header):
    // a rename moves no hash, so there is no currency verdict to re-derive.
    // Issuing the read anyway would cost a round trip to compute a value that is
    // then discarded.
    [persistedGraph, priorPendingActions, factsRead] = await Promise.all([
      loadPersistedGraphStrict(payload.scenario_id),
      loadMostRecentPendingActionsIntegrityStrict(payload.scenario_id, requestId),
      loadWriteReplyAnalysisInputs(payload.scenario_id, requestId),
    ]);
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_rename — authoritative graph/pending read failed; refusing any append',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  let result: ReturnType<typeof applyStructuralRename>;
  try {
    result = applyStructuralRename({ payload, event, requestId, persistedGraph });
  } catch (err) {
    // A malformed-but-present persisted graph lands here (corruption, not
    // absence). Retryable 500 with no append; the corrupt row stays
    // authoritative rather than being healed forward under a rename.
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_rename — adapter failed before commit',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  const persistedParse = GraphV3.safeParse(persistedGraph);
  const contentGraph = persistedParse.success ? persistedParse.data : null;
  const currentAnalysisHash = persistedParse.success
    ? computeAnalysisAffectingGraphHash(
        persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      )
    : null;

  if (result.kind === 'refused') {
    const response: OlumiResponse =
      currentAnalysisHash !== null
        ? { ...result.response, graph_hash: currentAnalysisHash }
        : result.response;
    // A stale ANALYSIS-SPACE base hash is canonical-state divergence: append
    // nothing, and let the route turn this into 409 GRAPH_DIVERGED carrying the
    // hash the server holds. An `expected_label` divergence deliberately does
    // NOT take this branch — see `structural-rename.ts`'s header — and instead
    // falls through to the committed refusal below, where its copy names the
    // current label.
    if (result.baseHashConflict !== undefined) {
      return {
        response,
        commitPerformed: false,
        graph: contentGraph,
        graphConflict: {
          recovery_action: result.baseHashConflict.recovery_action,
          conflict_category: result.baseHashConflict.conflict_category,
          expected_base_graph_hash: result.baseHashConflict.expected_base_graph_hash,
        },
      };
    }
    try {
      await commitDirectAnswer(response, {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: computeRequestHash(payload),
        llm_calls_used: 0,
        duration_ms: Date.now() - startedAt,
        handler_facts: [],
        pending_actions: [],
        priorPendingActions,
        ...(currentAnalysisHash !== null ? { graph_hash: currentAnalysisHash } : {}),
        ...(contentGraph !== null ? { contentGraph } : {}),
        coaching_state: null,
      });
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          refusal_reason: result.reason,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 structural_rename — refusal commit failed',
      );
      return { response, commitPerformed: false, graph: null };
    }
    log.info(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        refusal_reason: result.reason,
      },
      'V5 structural_rename refused — committed honestly, no graph written',
    );
    return { response, commitPerformed: true, graph: contentGraph };
  }

  // ── the mutation path: ONE atomic commit ─────────────────────────────────
  let persistedAnalysisGraphHash: string | null = null;
  let persistedGraphBytes: unknown = null;
  let graphPersisted = false;
  let thisAttemptWrote: boolean | null = null;
  let committedResponse: OlumiResponse = result.response;
  try {
    const cas = computeExpectedGraphCasHashes(result.baseGraph);
    const commitResult = await commitDirectAnswer(result.response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      // `direct_answer` + `handler_id: null` — the estate's ruling for an
      // `edit_graph` receipt, identical to `structural_delete`: `edit_graph` is
      // not a member of the contract's `V5ActionType`, so `turn_class: 'handler'`
      // with that id would need a schemas widening. The FACT-level
      // `fact_type === 'edit_graph'` is the discriminator downstream keys off.
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: result.handlerFacts,
      // THE LINE THE WHOLE CHANGE IS ABOUT. Without this key `commitDirectAnswer`
      // writes a turn row and NO graph — which is `'ack_and_commit'` wearing a
      // writer's name, and the rename would vanish on the next reload exactly as
      // it does today.
      graph: result.mutatedGraph,
      baseGraphForInvariants: result.baseGraph,
      pending_actions: [],
      priorPendingActions,
      contentGraph: result.mutatedGraph,
      // SPREAD, never conditionally omitted: `supabase-store.ts` derives
      // `p_expected_base_known` from key PRESENCE, so omitting a null hash turns
      // "known-absent base" into "no base asserted" and darkens the CAS guard.
      ...cas,
      coaching_state: null,
    });
    persistedAnalysisGraphHash = commitResult.persistedAnalysisGraphHash;
    persistedGraphBytes = commitResult.persistedGraph;
    graphPersisted = commitResult.graphPersisted;
    thisAttemptWrote = commitResult.thisAttemptWrote;
    committedResponse = commitResult.response;
  } catch (err) {
    if (err instanceof GraphStaleWriteError) {
      log.warn(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          conflict_category: err.conflict_category,
        },
        'V5 structural_rename — atomic graph CAS conflict; refresh and reconfirm',
      );
      return {
        response: result.response,
        commitPerformed: false,
        graph: null,
        graphConflict: {
          recovery_action: 'refresh_and_reconfirm',
          conflict_category: err.conflict_category,
          // Analysis-space (16-hex), from a FRESH read — never the 64-hex
          // identity hash the error carries. See readClientRecoverableBaseHash.
          expected_base_graph_hash: await readClientRecoverableBaseHash(payload.scenario_id),
        },
      };
    }
    // A later turn claimed this scenario, or the user stopped this one: a
    // KNOWN refusal, never the retryable 500 below. See turnFenceConflict.
    const fenceConflict = await turnFenceConflict(err, {
      requestId,
      eventKind: event.kind,
      scenarioId: payload.scenario_id,
    });
    if (fenceConflict !== null) {
      return { response: result.response, commitPerformed: false, graph: null, graphConflict: fenceConflict };
    }
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_rename — atomic mutation commit failed',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }

  // ── THIS ATTEMPT WROTE NOTHING: answer truthfully, attest nothing ────────
  // ⛔ F4, extended to rename (Codex's consumer-boundary follow-up on #1856).
  // On a replay or a reused-id conflict `graphPersisted` is still `true` and
  // `persistedGraph` is a reread another writer (or this request's own earlier
  // commit) may already have renamed exactly as asked, so the label check below
  // would attest "new label verified in the persisted bytes" for a write that
  // never happened, or answer a known no-write with a retryable 500. It reuses
  // the writer's own analysis read (`factsRead`), the same one its success path
  // derives freshness from.
  if (thisAttemptWrote === false) {
    return replyForAttemptThatWroteNothing({
      writer: 'structural_rename',
      payload,
      requestId,
      committedResponse,
      persistedGraphBytes,
      persistedAnalysisGraphHash,
      analysisInputs: factsRead,
      // The rename is in the model iff the node carries the new label.
      requestedChangeVisibleIn: (snapshot) =>
        findStaleRenamedLabel(
          snapshot,
          result.renamedNodeId,
          result.newLabel,
        ) === null,
      // NOT `renamed_node_id` (the "committed … verified" line's field): this
      // attempt renamed nothing.
      logFields: { requested_renamed_node_id: result.renamedNodeId },
    });
  }

  // ── the post-commit receipt check ────────────────────────────────────────
  // For a RENAME the claim to verify is PRESENCE: the named node carries the new
  // label in the bytes the commit produced, and the top-level `options[]` mirror
  // agrees with it.
  //
  // ⚠ WHAT THIS ACTUALLY CHECKS, stated at the same honesty level as the delete
  // sibling: `commitResult.persistedGraph` is `graphForStore` — "this commit's
  // own input after projection, NOT a re-read" (`commit.ts`). So this compares
  // the adapter's projected graph against the chokepoint's SECOND projection of
  // it. It catches a non-idempotent projection reintroducing the old label; it
  // CANNOT see the store persisting something different from what it was handed.
  // A real read-back would need a post-commit SELECT this seam does not perform.
  const committedParse = GraphV3.safeParse(persistedGraphBytes);
  const renameLanded =
    committedParse.success &&
    findStaleRenamedLabel(
      persistedGraphBytes as Record<string, unknown>,
      result.renamedNodeId,
      result.newLabel,
    ) === null;
  if (
    thisAttemptWrote !== true ||
    graphPersisted !== true ||
    persistedAnalysisGraphHash === null ||
    !committedParse.success ||
    !renameLanded
  ) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        this_attempt_wrote: thisAttemptWrote,
        graph_persisted: graphPersisted,
        has_analysis_hash: persistedAnalysisGraphHash !== null,
        graph_parse_ok: committedParse.success,
        rename_landed: renameLanded,
      },
      'V5 structural_rename — committed graph receipt invalid; withholding success',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }
  const graphForEgress = committedParse.data;

  const response: OlumiResponse = {
    ...committedResponse,
    graph_hash: persistedAnalysisGraphHash,
    // `draft_graph` is the UI's ONLY inline-graph ingestion path
    // (`applied-graph-emit.ts`), and it is the carrier the delete lane already
    // established for a structural change that `graph_patch` cannot name.
    draft_graph: buildAppliedGraphWireField(graphForEgress),
  };

  log.info(
    {
      request_id: requestId,
      event_kind: event.kind,
      scenario_id: payload.scenario_id,
      renamed_node_id: result.renamedNodeId,
    },
    'V5 structural_rename committed — canonical graph/fact written atomically, new label verified in the persisted bytes',
  );
  const freshness: FreshnessDerivation = deriveWriteReplyFreshness(factsRead, persistedAnalysisGraphHash);
  emitFreshnessTelemetry(
    freshness,
    {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: 'system_event.structural_rename',
    },
    {
      prior_fact_count: factsRead.hotWindow.facts.length,
      prior_fact_read_status: factsRead.hotWindow.status,
      scenario_fact_set_status: factsRead.factSet.status,
    },
  );
  return {
    response,
    commitPerformed: true,
    // Still the full graph: the egress id-leak scrub resolves ids to labels
    // against it. See the `graph` field's doc at the top of this file — passing
    // null does not SKIP the scrub, it runs it blind.
    graph: graphForEgress,
    // Readiness + freshness TOGETHER: the route stamps `freshness` into
    // `analysis_ready` only beside a readiness payload, and `analysis_ready.freshness`
    // is the field the UI clears its local "Model changed" mark on. A label cannot
    // change readiness, so this restates the model's verdict from the bytes that landed.
    analysisReady: buildCanonicalAnalysisReadyFromGraph(graphForEgress),
    freshness,
  };
}

/**
 * `structural_add` — commit the new entry, verify it in the committed bytes.
 *
 * Same shape as its two siblings; two things differ, and both are derived from
 * the fact that an add IS analysis-affecting where a rename is not:
 *
 *  1. `analysisReady` IS re-derived and stamped, from the bytes that LANDED.
 *     Adding an option can legitimately move the model to not-analysable (a new
 *     option has no interventions, so there is nothing to compare it on), and
 *     adding a factor with no stated level adds an open question. That verdict
 *     must describe the model the user now has — the delete lane's reasoning,
 *     applying in the opposite direction.
 *
 *  2. `freshness` is derived and emitted, because `nodes` and `options[]` are
 *     both inside the analysis-hash projection, so any prior analysis genuinely
 *     is out of date and the currency verdict has to move with it. This is why
 *     the prior-facts read below is issued at all — the rename path skips it
 *     precisely because its hash cannot move.
 *
 * ⚠ NOT GATED on `config.features.graphCas.rpcEnforce`, for the reason the
 * delete sibling records: that gate is a rollout device whose default (`shadow`)
 * would ship the capability DARK. Posture stated the same honest way — base
 * checked at T0, writes ordered by the turn fence, CAS stamped-not-enforced.
 */
async function dispatchStructuralAdd(
  payload: SystemEventTurnPayload,
  event: Extract<SystemEventTurnPayload['event'], { kind: 'structural_add' }>,
  requestId: string,
  startedAt: number,
): Promise<DispatchSystemEventResult> {
  let persistedGraph: unknown;
  let priorPendingActions: Awaited<
    ReturnType<typeof loadMostRecentPendingActionsIntegrityStrict>
  >;
  let factsRead: WriteReplyAnalysisInputs;
  try {
    [persistedGraph, priorPendingActions, factsRead] = await Promise.all([
      loadPersistedGraphStrict(payload.scenario_id),
      loadMostRecentPendingActionsIntegrityStrict(payload.scenario_id, requestId),
      loadWriteReplyAnalysisInputs(payload.scenario_id, requestId),
    ]);
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_add — authoritative graph/pending read failed; refusing any append',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  let result: ReturnType<typeof applyStructuralAdd>;
  try {
    result = applyStructuralAdd({ payload, event, requestId, persistedGraph });
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_add — adapter failed before commit',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  const persistedParse = GraphV3.safeParse(persistedGraph);
  const contentGraph = persistedParse.success ? persistedParse.data : null;
  const currentAnalysisHash = persistedParse.success
    ? computeAnalysisAffectingGraphHash(
        persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      )
    : null;

  if (result.kind === 'refused') {
    const response: OlumiResponse =
      currentAnalysisHash !== null
        ? { ...result.response, graph_hash: currentAnalysisHash }
        : result.response;
    if (result.baseHashConflict !== undefined) {
      return {
        response,
        commitPerformed: false,
        graph: contentGraph,
        graphConflict: {
          recovery_action: result.baseHashConflict.recovery_action,
          conflict_category: result.baseHashConflict.conflict_category,
          expected_base_graph_hash: result.baseHashConflict.expected_base_graph_hash,
        },
      };
    }
    try {
      await commitDirectAnswer(response, {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: computeRequestHash(payload),
        llm_calls_used: 0,
        duration_ms: Date.now() - startedAt,
        handler_facts: [],
        pending_actions: [],
        priorPendingActions,
        ...(currentAnalysisHash !== null ? { graph_hash: currentAnalysisHash } : {}),
        ...(contentGraph !== null ? { contentGraph } : {}),
        coaching_state: null,
      });
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          refusal_reason: result.reason,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 structural_add — refusal commit failed',
      );
      return { response, commitPerformed: false, graph: null };
    }
    log.info(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        refusal_reason: result.reason,
      },
      'V5 structural_add refused — committed honestly, no graph written',
    );
    return { response, commitPerformed: true, graph: contentGraph };
  }

  // ── the mutation path: ONE atomic commit ─────────────────────────────────
  let persistedAnalysisGraphHash: string | null = null;
  let persistedGraphBytes: unknown = null;
  let graphPersisted = false;
  // `null` until the commit resolves. See the no-write branch below.
  let thisAttemptWrote: boolean | null = null;
  let committedResponse: OlumiResponse = result.response;
  try {
    const cas = computeExpectedGraphCasHashes(result.baseGraph);
    const commitResult = await commitDirectAnswer(result.response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      // `direct_answer` + `handler_id: null` — the estate's ruling for an
      // `edit_graph` receipt; `edit_graph` is not a `V5ActionType` member, so
      // `turn_class: 'handler'` with that id would need a schemas widening.
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: result.handlerFacts,
      // THE LINE THE WHOLE CHANGE IS ABOUT. Without this key the commit writes a
      // turn row and NO graph, and the new entry vanishes on the next reload —
      // which is `'ack_and_commit'` wearing a writer's name.
      graph: result.mutatedGraph,
      baseGraphForInvariants: result.baseGraph,
      pending_actions: [],
      priorPendingActions,
      contentGraph: result.mutatedGraph,
      // SPREAD, never conditionally omitted: `supabase-store.ts` derives
      // `p_expected_base_known` from key PRESENCE, so omitting a null hash turns
      // "known-absent base" into "no base asserted" and darkens the CAS guard.
      ...cas,
      coaching_state: null,
    });
    persistedAnalysisGraphHash = commitResult.persistedAnalysisGraphHash;
    persistedGraphBytes = commitResult.persistedGraph;
    graphPersisted = commitResult.graphPersisted;
    thisAttemptWrote = commitResult.thisAttemptWrote;
    committedResponse = commitResult.response;
  } catch (err) {
    if (err instanceof GraphStaleWriteError) {
      log.warn(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          conflict_category: err.conflict_category,
        },
        'V5 structural_add — atomic graph CAS conflict; refresh and reconfirm',
      );
      return {
        response: result.response,
        commitPerformed: false,
        graph: null,
        graphConflict: {
          recovery_action: 'refresh_and_reconfirm',
          conflict_category: err.conflict_category,
          expected_base_graph_hash: await readClientRecoverableBaseHash(payload.scenario_id),
        },
      };
    }
    // A later turn claimed this scenario, or the user stopped this one: a
    // KNOWN refusal, never the retryable 500 below. See turnFenceConflict.
    const fenceConflict = await turnFenceConflict(err, {
      requestId,
      eventKind: event.kind,
      scenarioId: payload.scenario_id,
    });
    if (fenceConflict !== null) {
      return { response: result.response, commitPerformed: false, graph: null, graphConflict: fenceConflict };
    }
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_add — atomic mutation commit failed',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }

  // ── THIS ATTEMPT WROTE NOTHING: answer truthfully, attest nothing ────────
  // ⛔ F4. On a replay or a reused-id conflict `graphPersisted` is still `true`
  // and `persistedGraph` is a reread another writer (or this request's own
  // earlier commit) may already have put the new node into, so the receipt
  // check below could attest "verified in the persisted bytes" for a write that
  // never happened, or answer a known no-write with a retryable 500. See
  // `replyForAttemptThatWroteNothing`; `result.response` ("Added '…'") is never
  // returned from here — an add carries no `graph_patch`, so commit.ts's
  // corrected prose is the only claim carrier on this branch.
  if (thisAttemptWrote === false) {
    return replyForAttemptThatWroteNothing({
      writer: 'structural_add',
      payload,
      requestId,
      committedResponse,
      persistedGraphBytes,
      persistedAnalysisGraphHash,
      analysisInputs: factsRead,
      // The add is in the model iff the requested node id is.
      requestedChangeVisibleIn: (snapshot) =>
        snapshot.nodes.some((n) => n.id === result.addedNodeId),
      // NOT `added_node_id` (the "committed … verified" line's field): this
      // attempt added nothing.
      logFields: { requested_node_id: result.addedNodeId },
    });
  }

  // ── the post-commit receipt check ────────────────────────────────────────
  // For an ADD the claim to verify is PRESENCE — and, because this writer's
  // whole point is that it invents no number, that the committed bytes still
  // carry no fabricated level.
  //
  // Reached only when `thisAttemptWrote` is not `false`; the `!== true`
  // conjunct below withholds success unless this attempt provably wrote.
  //
  // ⚠ SCOPE, at the same honesty level the delete sibling states it:
  // `commitResult.persistedGraph` is `graphForStore` — "this commit's own input
  // after projection, NOT a re-read" (`commit.ts`). So this compares the
  // adapter's projected graph against the chokepoint's SECOND projection of it.
  // It catches a non-idempotent projection dropping the entry or synthesising a
  // baseline; it CANNOT see the store persisting something different from what
  // it was handed.
  const committedParse = GraphV3.safeParse(persistedGraphBytes);
  const committedNode = committedParse.success
    ? committedParse.data.nodes.find((n) => n.id === result.addedNodeId)
    : undefined;
  const addLanded =
    committedNode !== undefined &&
    committedNode.label === result.addedLabel &&
    findFabricatedLevel(
      persistedGraphBytes as Record<string, unknown>,
      result.addedNodeId,
    ) === null;
  if (
    thisAttemptWrote !== true ||
    graphPersisted !== true ||
    persistedAnalysisGraphHash === null ||
    !committedParse.success ||
    !addLanded
  ) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        this_attempt_wrote: thisAttemptWrote,
        graph_persisted: graphPersisted,
        has_analysis_hash: persistedAnalysisGraphHash !== null,
        graph_parse_ok: committedParse.success,
        add_landed: addLanded,
      },
      'V5 structural_add — committed graph receipt invalid; withholding success',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }
  const graphForReadiness = committedParse.data;

  const response: OlumiResponse = {
    ...committedResponse,
    graph_hash: persistedAnalysisGraphHash,
    draft_graph: buildAppliedGraphWireField(graphForReadiness),
  };

  // Fact history is observational only: it never authorises or blocks the write.
  // A healthy empty read means canonical `none`; a degraded read must not
  // fabricate that conclusion and therefore emits honest `unknown`.
  const freshness: FreshnessDerivation = deriveWriteReplyFreshness(factsRead, persistedAnalysisGraphHash);
  emitFreshnessTelemetry(
    freshness,
    {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: 'system_event.structural_add',
    },
    {
      prior_fact_count: factsRead.hotWindow.facts.length,
      prior_fact_read_status: factsRead.hotWindow.status,
      scenario_fact_set_status: factsRead.factSet.status,
      added_node_kind: result.addedNodeKind,
      left_unquantified: result.leftUnquantified,
    },
  );

  log.info(
    {
      request_id: requestId,
      event_kind: event.kind,
      scenario_id: payload.scenario_id,
      added_node_id: result.addedNodeId,
      added_node_kind: result.addedNodeKind,
      left_unquantified: result.leftUnquantified,
    },
    'V5 structural_add committed — canonical graph/fact written atomically, new entry verified in the persisted bytes with no fabricated level',
  );
  return {
    response,
    commitPerformed: true,
    // Readiness from the bytes that LANDED. An added option with no
    // interventions can legitimately move the model to not-analysable, and that
    // verdict must describe the model the user now has.
    analysisReady: buildCanonicalAnalysisReadyFromGraph(graphForReadiness),
    freshness,
    graph: graphForReadiness,
  };
}

/**
 * `structural_add_edge` — the edge writer's dispatch half.
 *
 * Mirrors `dispatchStructuralAdd` above, because the commit contract is the
 * same one: ONE atomic commit carrying the graph, the `edit_graph` fact and the
 * CAS expected-base hashes, followed by a receipt check on the committed bytes.
 *
 * ⚠ THE ONE PLACE IT DELIBERATELY DIFFERS from its sibling is the post-commit
 * check. The node writer verifies PRESENCE plus "no fabricated level". An edge
 * has no level to fabricate, but it does have a SIGN — and a sign is the one
 * property a merge or projection pass could silently drop while leaving the
 * edge itself present. So the check verifies the edge is there AND that its
 * `strength.mean` still matches what the adapter decided.
 */
async function dispatchStructuralAddEdge(
  payload: SystemEventTurnPayload,
  event: Extract<SystemEventTurnPayload['event'], { kind: 'structural_add_edge' }>,
  requestId: string,
  startedAt: number,
): Promise<DispatchSystemEventResult> {
  let persistedGraph: unknown;
  let priorPendingActions: Awaited<
    ReturnType<typeof loadMostRecentPendingActionsIntegrityStrict>
  >;
  let factsRead: WriteReplyAnalysisInputs;
  try {
    [persistedGraph, priorPendingActions, factsRead] = await Promise.all([
      loadPersistedGraphStrict(payload.scenario_id),
      loadMostRecentPendingActionsIntegrityStrict(payload.scenario_id, requestId),
      loadWriteReplyAnalysisInputs(payload.scenario_id, requestId),
    ]);
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_add_edge — authoritative graph/pending read failed; refusing any append',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  let result: ReturnType<typeof applyStructuralAddEdge>;
  try {
    result = applyStructuralAddEdge({ payload, event, requestId, persistedGraph });
  } catch (err) {
    // `InvalidPersistedAddEdgeGraphError` lands here by design: a non-null
    // persisted graph that fails GraphV3 is CORRUPTION, not absence, and must
    // become a retryable failure with no append rather than a silent refusal.
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        corrupt_persisted_graph: err instanceof InvalidPersistedAddEdgeGraphError,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_add_edge — adapter failed before commit',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  const persistedParse = GraphV3.safeParse(persistedGraph);
  const contentGraph = persistedParse.success ? persistedParse.data : null;
  const currentAnalysisHash = persistedParse.success
    ? computeAnalysisAffectingGraphHash(
        persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      )
    : null;

  if (result.kind === 'refused') {
    const response: OlumiResponse =
      currentAnalysisHash !== null
        ? { ...result.response, graph_hash: currentAnalysisHash }
        : result.response;
    if (result.baseHashConflict !== undefined) {
      return {
        response,
        commitPerformed: false,
        graph: contentGraph,
        graphConflict: {
          recovery_action: result.baseHashConflict.recovery_action,
          conflict_category: result.baseHashConflict.conflict_category,
          expected_base_graph_hash: result.baseHashConflict.expected_base_graph_hash,
        },
      };
    }
    try {
      await commitDirectAnswer(response, {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: computeRequestHash(payload),
        llm_calls_used: 0,
        duration_ms: Date.now() - startedAt,
        handler_facts: [],
        pending_actions: [],
        priorPendingActions,
        ...(currentAnalysisHash !== null ? { graph_hash: currentAnalysisHash } : {}),
        ...(contentGraph !== null ? { contentGraph } : {}),
        coaching_state: null,
      });
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          refusal_reason: result.reason,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 structural_add_edge — refusal commit failed',
      );
      return { response, commitPerformed: false, graph: null };
    }
    log.info(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        refusal_reason: result.reason,
      },
      'V5 structural_add_edge refused — committed honestly, no graph written',
    );
    return { response, commitPerformed: true, graph: contentGraph };
  }

  // ── the mutation path: ONE atomic commit ─────────────────────────────────
  let persistedAnalysisGraphHash: string | null = null;
  let persistedGraphBytes: unknown = null;
  let graphPersisted = false;
  let thisAttemptWrote: boolean | null = null;
  let committedResponse: OlumiResponse = result.response;
  try {
    const cas = computeExpectedGraphCasHashes(result.baseGraph);
    const commitResult = await commitDirectAnswer(result.response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: result.handlerFacts,
      // THE LINE THE WHOLE CHANGE IS ABOUT — without this key the commit writes
      // a turn row and NO graph, and the connection vanishes on the next reload.
      graph: result.mutatedGraph,
      baseGraphForInvariants: result.baseGraph,
      pending_actions: [],
      priorPendingActions,
      contentGraph: result.mutatedGraph,
      // SPREAD, never conditionally omitted — `supabase-store.ts` derives
      // `p_expected_base_known` from key PRESENCE.
      ...cas,
      coaching_state: null,
    });
    persistedAnalysisGraphHash = commitResult.persistedAnalysisGraphHash;
    persistedGraphBytes = commitResult.persistedGraph;
    graphPersisted = commitResult.graphPersisted;
    thisAttemptWrote = commitResult.thisAttemptWrote;
    committedResponse = commitResult.response;
  } catch (err) {
    if (err instanceof GraphStaleWriteError) {
      log.warn(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          conflict_category: err.conflict_category,
        },
        'V5 structural_add_edge — atomic graph CAS conflict; refresh and reconfirm',
      );
      return {
        response: result.response,
        commitPerformed: false,
        graph: null,
        graphConflict: {
          recovery_action: 'refresh_and_reconfirm',
          conflict_category: err.conflict_category,
          expected_base_graph_hash: await readClientRecoverableBaseHash(payload.scenario_id),
        },
      };
    }
    // A later turn claimed this scenario, or the user stopped this one: a
    // KNOWN refusal, never the retryable 500 below. See turnFenceConflict.
    const fenceConflict = await turnFenceConflict(err, {
      requestId,
      eventKind: event.kind,
      scenarioId: payload.scenario_id,
    });
    if (fenceConflict !== null) {
      return { response: result.response, commitPerformed: false, graph: null, graphConflict: fenceConflict };
    }
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_add_edge — atomic mutation commit failed',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }

  // ── THIS ATTEMPT WROTE NOTHING: answer truthfully, attest nothing ────────
  // ⛔ F4, extended to add_edge (Codex's consumer-boundary follow-up on #1856).
  // On a replay or a reused-id conflict the reread may already hold exactly this
  // connection (another writer's, or this request's own earlier commit), so the
  // presence-and-sign check below would attest a write that never happened, or
  // answer a known no-write with a retryable 500.
  if (thisAttemptWrote === false) {
    return replyForAttemptThatWroteNothing({
      writer: 'structural_add_edge',
      payload,
      requestId,
      committedResponse,
      persistedGraphBytes,
      persistedAnalysisGraphHash,
      analysisInputs: factsRead,
      // The connection is in the model iff an edge between the endpoints carries
      // this request's signed strength — the receipt check's own terms.
      requestedChangeVisibleIn: (snapshot) =>
        snapshot.edges.some(
          (e) => e.from === result.from && e.to === result.to && e.strength.mean === result.signedMean,
        ),
      logFields: { requested_edge_from: result.from, requested_edge_to: result.to },
    });
  }

  // ── the post-commit receipt check ────────────────────────────────────────
  // ⚠ SCOPE, at the honesty level the siblings state it:
  // `commitResult.persistedGraph` is this commit's own input after projection,
  // NOT a re-read. So this compares the adapter's projected graph against the
  // chokepoint's SECOND projection of it. It catches a non-idempotent projection
  // dropping the edge or flipping its sign; it CANNOT see the store persisting
  // something different from what it was handed.
  const committedParse = GraphV3.safeParse(persistedGraphBytes);
  const committedEdge = committedParse.success
    ? committedParse.data.edges.find((e) => e.from === result.from && e.to === result.to)
    : undefined;
  const addLanded =
    committedEdge !== undefined && committedEdge.strength.mean === result.signedMean;
  if (
    thisAttemptWrote !== true ||
    graphPersisted !== true ||
    persistedAnalysisGraphHash === null ||
    !committedParse.success ||
    !addLanded
  ) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        this_attempt_wrote: thisAttemptWrote,
        graph_persisted: graphPersisted,
        has_analysis_hash: persistedAnalysisGraphHash !== null,
        graph_parse_ok: committedParse.success,
        add_landed: addLanded,
      },
      'V5 structural_add_edge — committed graph receipt invalid; withholding success',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }
  const graphForReadiness = committedParse.data;

  const response: OlumiResponse = {
    ...committedResponse,
    graph_hash: persistedAnalysisGraphHash,
    draft_graph: buildAppliedGraphWireField(graphForReadiness),
  };

  const freshness: FreshnessDerivation = deriveWriteReplyFreshness(factsRead, persistedAnalysisGraphHash);
  emitFreshnessTelemetry(
    freshness,
    {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: 'system_event.structural_add_edge',
    },
    {
      prior_fact_count: factsRead.hotWindow.facts.length,
      prior_fact_read_status: factsRead.hotWindow.status,
      scenario_fact_set_status: factsRead.factSet.status,
    },
  );

  log.info(
    {
      request_id: requestId,
      event_kind: event.kind,
      scenario_id: payload.scenario_id,
      edge_from: result.from,
      edge_to: result.to,
    },
    'V5 structural_add_edge committed — canonical graph/fact written atomically, connection verified in the persisted bytes with its sign intact',
  );
  return {
    response,
    commitPerformed: true,
    // Readiness from the bytes that LANDED: a new causal edge can move the model
    // to analysable, and that verdict must describe the model the user now has.
    analysisReady: buildCanonicalAnalysisReadyFromGraph(graphForReadiness),
    freshness,
    graph: graphForReadiness,
  };
}
