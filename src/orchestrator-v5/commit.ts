/**
 * V5 commit stage — slice B.
 *
 * A1 shipped this as a pure no-op per Paul's constraint 11. Slice B wires
 * persistence: on success the RPC `append_turn_atomic` records the turn in
 * `v5_conversation_turns`; on failure a `StateCommitFailedError` is thrown
 * and the TurnExecutor catch at turn-executor.ts:223-232 maps it to the
 * `STATE_COMMIT_FAILED` wire code.
 *
 * Idempotency: `turn_id` is client-generated. The RPC enforces
 * `UNIQUE (scenario_id, turn_id)` with `ON CONFLICT DO NOTHING`, so two
 * concurrent calls with identical `(scenario_id, turn_id)` each return the
 * same row id and neither raises. TurnExecutor currently uses `request_id`
 * as `turn_id`; request_id is a UUID per turn, so cross-turn collisions
 * don't occur. A retry of the same request (same request_id) is idempotent
 * by construction.
 *
 * Graph atomicity: when CommitMetadata.graph is provided, it is passed to
 * append_turn_atomic as p_graph. The RPC writes scenarios.graph and inserts
 * the turn row in the same PL/pgSQL transaction — both succeed or both roll
 * back. This eliminates the split-state risk of two separate RPC calls.
 *
 * Shape: deliberately preserves the `commitDirectAnswer` name so the diff
 * against turn-executor.ts stays surgical. The function now also handles
 * `clarify` (the schema enum narrows this safely).
 */

import { createHash } from 'node:crypto';

import type { OlumiResponse, OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type {
  ConversationTurnClass,
  HandlerFact,
  RunAnalysisHandlerFact,
  V5ActionType,
} from '@talchain/schemas/orchestrator';

import { getSessionStore } from './session/index.js';
import type {
  AtomicCommittedModelVersionReceipt,
  AtomicCommittedModelVersionWrite,
  SessionStore,
  VersionAuthoredBy,
} from './session/store.js';
import { StateCommitFailedError } from './session/store.js';
import { projectGraphForPersistence } from './persisted-graph-projection.js';
import { checkPersistedGraphInvariants } from './persisted-graph-invariants.js';
import { appendCheckedGraphWrite } from './persist-graph-write.js';
import { derivePendingActionsFromFinalizedChips } from './compose/derive-pending-actions.js';
import { applyEgressForbiddenPhraseGuard } from './compose/forbidden-user-facing-phrases.js';
import { sanitiseUserFacingText } from './compose/output-safety.js';
import type { ZodError } from 'zod';
import { GraphV3, type GraphV3T } from '../schemas/cee-v3.js';
import type {
  PendingAction,
  PendingLifecycleSummary,
} from './session/pending-action.js';
import {
  applyRecordedAskLifetimes,
  clampRecordedAskWindow,
  recordedAskWindowMustClamp,
  CONFIRMATION_EXPECTING_ACTION_TYPES,
  isPendingActionExpired,
  PENDING_ACTIONS_PER_TURN_CAP,
} from './session/pending-action.js';
import type { SuggestedAction } from './compose/types.js';
import type { CoachingState } from './coaching/coaching-state.js';
import { emit, log, TelemetryEvents } from '../utils/telemetry.js';
import { emitContextTruncation } from './context/context-budget-telemetry.js';
import { config } from '../config/index.js';
import { floorGraphSigmaForCompute } from '../validators/numeric-bounds.js';
import {
  computeGraphIdentityHash,
  computeVersionAnalysisAffectingHashRecord,
} from './context/graph-identity.js';
import {
  asGraphStateIngress,
  decideModelVersionCreation,
} from './model-management/version-creation-policy.js';
import {
  attachModelVersionMutationReceipt,
  toModelVersionMutationReceiptV1,
} from './model-management/mutation-receipt.js';
import type { ModelVersionMutationReceiptV1Local } from './model-management/mutation-receipt.js';
import { recordDecisionRecordForCommit } from './decision-records/capture.js';
import { maintainRollingSummaryForCommit } from './rolling-summary/capture.js';
import { isSuccessfulRunAnalysisFact } from './context/freshness.js';

export interface CommitMetadata {
  readonly scenario_id: string;
  readonly turn_id: string;
  readonly turn_class: ConversationTurnClass;
  readonly handler_id: V5ActionType | null;
  readonly request_hash: string;
  readonly llm_calls_used: number;
  readonly duration_ms: number;
  readonly handler_facts: readonly HandlerFact[];
  /**
   * Draft graph to persist atomically with the turn insert via
   * append_turn_atomic(p_graph). Both the graph write and the turn row commit
   * or roll back together. Omit for non-draft turns — the RPC leaves
   * scenarios.graph unchanged when p_graph is null.
   */
  readonly graph?: unknown;
  /**
   * User-supplied free-text decision brief to persist atomically with the
   * turn insert via append_turn_atomic(p_brief_text). Set by
   * `draft-graph-dispatch` on the first draft turn (after normalisation
   * via `normaliseBriefText`).
   *
   * Write-once at the RPC layer: subsequent writes are silently ignored
   * (`WHERE brief_text IS NULL OR brief_text = ''`). Repair / edit /
   * regeneration turns may still pass this through but it will not
   * overwrite. Omit for turns that should not influence brief_text.
   */
  readonly briefText?: string;
  /**
   * Pre-computed pending actions for this turn. When provided, these are
   * passed straight to `append_turn_atomic(p_pending_actions)` and the
   * chip-derivation step is skipped entirely. Used by handlers that
   * generate pending actions from non-chip state (Wave 3:
   * `add-risk-template` carries the original risk label across the
   * clarify turn; the value-update clarify path carries the parsed
   * quantity).
   *
   * When omitted, `commitDirectAnswer` derives pending actions from
   * `response.suggested_actions` via `derivePendingActionsFromChips`.
   * That covers the chip-side path (currently only `run_analysis`
   * chips). The atomic-emit contract enforces: every chip with a
   * resumable `action_type` produces exactly one matching pending
   * action — see `derive-pending-actions.test.ts`.
   */
  readonly pending_actions?: readonly PendingAction[];
  /**
   * Optional graph hash threaded into chip-derived pending actions'
   * `preconditions.graph_hash`. The resumer compares the live graph
   * hash on the next turn and invalidates set_factor_value /
   * edit_graph_add_risk pending actions if it has changed. Pass
   * undefined when the turn does not have a meaningful graph
   * (frame stage, no draft yet).
   */
  readonly graph_hash?: string;
  /**
   * The graph as it stood BEFORE this turn, for the terminal invariant check's
   * DELTA comparison. Structural violations already present here are absorbed
   * and never refused — only what this turn INTRODUCED can fail the commit.
   *
   * Omit it and the check degrades to observe-only for this commit. That is the
   * safe default: without a baseline there is no way to distinguish an
   * introduced violation from an inherited one, and refusing on that guess
   * would make an already-invalid scenario permanently uneditable (the failure
   * mode `edit-graph.ts:2750-2755` exists to avoid).
   */
  readonly baseGraphForInvariants?: unknown;
  /**
   * V5 Signature Loop — pending proposals carried in from the PRIOR turn (the
   * caller's `most_recent_pending_actions`). `commitDirectAnswer` re-persists
   * the survivors alongside this turn's own pending actions so a single
   * non-consuming turn that commits an empty pending array does NOT wipe a
   * still-valid proposal. Survival rules live in `computeSurvivingPriorPendings`
   * (wall/turn TTL, graph-hash invalidation, supersession, consumed). Omit /
   * empty = no carry-forward (legacy behaviour).
   */
  readonly priorPendingActions?: readonly PendingAction[];
  /**
   * V5 Signature Loop — proposal refs (== chip_id) consumed by THIS turn and so
   * excluded from carry-forward: the applied proposal on the apply path, and the
   * dismissed proposals on the reject path. Mandatory on those two paths — a
   * consumed/dismissed proposal must never carry forward and reappear as a
   * zombie. See the consumption-path matrix in
   * Docs/v5/v5-signature-loop-reliability.md.
   */
  readonly consumedPendingRefs?: readonly string[];
  /**
   * V5 Coaching State Spine — Stage 2B-1b: the internal Stage-2A `coaching_state`
   * derived at turn start (pre-dispatch). Persisted atomically with the turn via
   * `append_turn_atomic(p_coaching_state)` (the store wraps it in a pre-dispatch
   * snapshot envelope). Threaded from `EnrichedTurnContext.coaching_state` by the
   * commit-call sites that have a turn context in scope (turn-executor, chip-click).
   *
   * `null`/omitted persists `coaching_state = NULL` — used by paths that never
   * derive a coaching state (system events; the route-v2 draft/edit dispatch
   * paths, which skip `buildTurnContext`). The most-recent read filters
   * non-null, so these rows never reset the prior snapshot. No lifecycle here.
   */
  readonly coaching_state?: CoachingState | null;
  /**
   * V5 Conversation Context Reliability: the user's verbatim turn message
   * (boundary `payload.message`). Threaded by every commit call site that has
   * the payload in scope so the next turn's ContextPack can project it into
   * `conversation.recent_turns[].user_message` and the LLM can resolve
   * follow-ups. Capped here (`commitDirectAnswer`) before write. Omit for
   * turns with no user text (system / internal-event turns) — persists NULL.
   *
   * The assistant side is derived inside `commitDirectAnswer` from the composed
   * `response.assistant_text` (single source of truth = the egress-validated
   * public answer), so no commit path needs per-site assistant wiring.
   */
  readonly userMessage?: string;
  /**
   * V5 Conversation Context Reliability: the scenario graph used to resolve
   * entity-id labels when reducing `assistant_text` to its durable public form
   * (see `durablePublicAssistantText`). Pass the SAME graph the route egress
   * sanitiser uses for this turn so the stored copy equals the wire copy —
   * `context.persistedGraph` (turn-executor), the run_analysis snapshot graph
   * (chip-click), or the edit `appliedGraph`/ingress graph (edit-graph).
   *
   * Accepted as `unknown` and `GraphV3.safeParse`d inside `commitDirectAnswer`
   * (callers pass either a parsed `GraphV3T` or the raw persisted graph). When
   * omitted or unparseable the entity scrub runs graph-free: it still strips
   * the unambiguous / digit / multi-segment id shapes, but CANNOT distinguish
   * an ambiguous-prefix single-segment id (`goal_revenue`) from a legitimate
   * English compound (`goal_setting`) — so those are LEFT INTACT to avoid
   * corrupting prose. A turn with no graph in scope cannot reference graph
   * entity ids anyway, so this graph-free residual is low-risk; threading the
   * graph here closes it for every turn that operates on a graph.
   */
  readonly contentGraph?: unknown;
  /**
   * A3 graph CAS observe-mode: expected-base identity hash (64-hex) captured
   * at turn start from a SERVER-SIDE persisted-graph read. Threaded VERBATIM
   * to `SessionTurnWrite.expectedGraphIdentityHash` — commit.ts performs no
   * recomputation and no fallback derivation here.
   *
   * TRUSTED BASE RULE: callers must derive this only from a server read
   * (`context.persistedGraph` via the turn-executor `commitTurn` wrapper, or
   * edit-graph-dispatch's `loadPersistedGraphStrict` base). NEVER from
   * request-supplied `graph_state`. `undefined` = not instrumented
   * (`no_expected`, never a conflict); `null` = server base read but graph
   * absent/unparseable. See graph-cas-conflict.ts.
   */
  readonly expectedGraphIdentityHash?: string | null;
  /**
   * A3 graph CAS observe-mode: expected-base analysis-affecting hash (16-hex)
   * from the same server read as `expectedGraphIdentityHash`. Threaded
   * verbatim to `SessionTurnWrite.expectedGraphAnalysisHash`. Same
   * undefined/null convention.
   */
  readonly expectedGraphAnalysisHash?: string | null;
  /** Explicit producer-attested actor; absence persists Unknown. */
  readonly versionActor?:
    | { readonly kind: 'known'; readonly authored_by: VersionAuthoredBy }
    | { readonly kind: 'system' };
}

/**
 * Durable per-message length cap for persisted conversation content
 * (`user_message` / `assistant_message`). Bounds storage and the prompt-token
 * cost of projecting up to `CONTEXT_PACK_RECENT_TURNS_CAP` turns; the cap is
 * generous enough to preserve the meaning a follow-up needs ("Why?" referring
 * to the prior answer). Enforced APP-SIDE (no DB CHECK), so an over-long value
 * is truncated rather than failing the turn commit.
 */
export const CONVERSATION_TEXT_CAP = 2000;

/**
 * Cap durable conversation text app-side. Returns `undefined` for nullish or
 * empty/whitespace-only input (→ persists NULL, never an empty string) and a
 * length-bounded string otherwise. No trimming of interior content.
 *
 * Context v2 S0 (ROADMAP 1.73): a cut here now emits `v5.context_truncation`
 * — this was the platform's canonical SILENT slice (design pack 00 §broken
 * seam 1). The persistence cap itself stays (storage bound, sane); only the
 * observability changes. `disclosed` is always true: the pack projection
 * unconditionally marks the cut turn `truncated:true`
 * (projectConversation's at-cap inference), so downstream LLMs can see it.
 *
 * Exported for direct unit coverage of the emit contract (S0 tests); the
 * `section` names the durable column the cut applies to.
 */
export function capConversationText(
  text: string | undefined | null,
  section: 'user_message' | 'assistant_message',
): string | undefined {
  if (text == null) return undefined;
  if (text.trim().length === 0) return undefined;
  if (text.length > CONVERSATION_TEXT_CAP) {
    emitContextTruncation({
      site: 'commit.capConversationText',
      section,
      original_chars: text.length,
      kept_chars: CONVERSATION_TEXT_CAP,
      strategy: 'hard_slice',
      // Disclosure is now unconditional: projectConversation always marks the
      // at-cap turn `truncated:true`, so the downstream LLM sees this cut.
      disclosed: true,
    });
    return text.slice(0, CONVERSATION_TEXT_CAP);
  }
  return text;
}

/**
 * Reduce a composed `assistant_text` to the DURABLE PUBLIC form, so the
 * persisted `assistant_message` can never carry content the user never saw.
 *
 * COMMIT runs inside the dispatch handlers; TWO egress transforms then run
 * AFTER commit and can diverge the wire text from `response.assistant_text`:
 *   1. the turn-executor finaliser's forbidden-phrase guard
 *      (`applyEgressForbiddenPhraseGuard`) — rewrites denial / false-success
 *      copy to a neutral fallback; and
 *   2. the route chokepoint's entity-id leak scrub
 *      (`sanitiseUserFacingText`, inside `sanitiseOlumiResponseForEgress`) —
 *      replaces any raw internal id (e.g. `fac_delivery_cost`) that the
 *      handler-local Layer-1 scrub missed.
 * Persisting the raw `assistant_text` would therefore store text that is
 * potentially LESS leak-safe than what shipped — directly contradicting the
 * privacy contract ("stored assistant text is the final public answer").
 *
 * We apply both transforms here in WIRE ORDER (forbidden-phrase guard →
 * entity-id scrub) so the stored value equals the wire value on the common
 * egress-ok path and can never contain a forbidden phrase. Both helpers are
 * pure and idempotent; telemetry for either rewrite is emitted on the wire
 * path, NOT here (both helpers are deliberately telemetry-free), so we don't
 * double-count or mis-attribute.
 *
 * The entity-id scrub uses `graph` for label resolution — passing the SAME
 * graph the route egress uses makes the stored copy equal the wire copy AND
 * catches ambiguous-prefix single-segment ids (`goal_revenue` → its label),
 * which the scrubber confirms ONLY via `resolveLabel(graph, …)`. With a null
 * graph those ambiguous ids are left intact (they are indistinguishable from
 * English compounds like `goal_setting` without the graph) — so callers should
 * thread `contentGraph` wherever a graph is in scope; see CommitMetadata.
 *
 * Residual (documented): (a) a turn committed with NO graph in scope can retain
 * an ambiguous-prefix single-segment raw id — but such a turn cannot reference
 * graph entities anyway, so the realistic risk is closed by threading the
 * graph; (b) in the rare egress HARD-validation-failure path the route ships a
 * typed fallback while this stores the composed answer — a different, but still
 * forbidden-phrase-safe (and, with a graph, leak-safe) string.
 */
function durablePublicAssistantText(
  text: string | undefined | null,
  graph: GraphV3T | null,
): string | undefined | null {
  if (typeof text !== 'string' || text.trim().length === 0) return text;
  return sanitiseUserFacingText(applyEgressForbiddenPhraseGuard(text).text, graph).text;
}

/**
 * Parse the optional caller-supplied `contentGraph` (a parsed `GraphV3T` or the
 * raw persisted graph) into a `GraphV3T | null` for entity-id label resolution.
 * Never throws — an unparseable / absent graph degrades to `null` (graph-free
 * scrub), never a commit failure.
 */
function parseContentGraph(graph: unknown): GraphV3T | null {
  if (graph == null) return null;
  const parsed = GraphV3.safeParse(graph);
  return parsed.success ? parsed.data : null;
}

export interface CommitResult {
  readonly response: OlumiResponse;
  readonly performed: true;
  readonly persisted_row_id: string;
  readonly modelVersionReceipt: AtomicCommittedModelVersionReceipt | null;
  /**
   * True when CommitMetadata.graph was provided and the atomic commit
   * succeeded (both graph and turn row written). False when graph was absent.
   * On commit failure, commitDirectAnswer throws rather than returning false
   * here — the caller's catch block handles that path.
   */
  readonly graphPersisted: boolean;
  /**
   * Track 2 — redacted per-turn pending-action lifecycle tally from the
   * carry-forward pass (counts only). Diagnostic-only; the turn-executor
   * threads it into the frame's `pending.lifecycle` diagnostics block. Always
   * present on a successful commit (the carry-forward runs unconditionally,
   * with `priorCount: 0` on legacy callers that thread no prior pendings).
   */
  readonly pendingLifecycle: PendingLifecycleSummary;
  /**
   * §3.2 — the analysis hash of the bytes ACTUALLY WRITTEN to `scenarios.graph`,
   * recomputed after every persist-site mutation. This is the only hash a
   * caller may advertise for this turn: any hash a caller computed before
   * calling `commitDirectAnswer` describes the graph as it was BEFORE the
   * persist projection, which is not what the next turn will read back.
   *
   * `null` when this commit wrote no graph (there are no persisted bytes to
   * hash) or when the graph was empty/unhashable.
   */
  readonly persistedAnalysisGraphHash: string | null;
  /**
   * The graph bytes ACTUALLY WRITTEN to `scenarios.graph` — the output of
   * `projectGraphForPersistence`, not the caller's input.
   *
   * Exposed because `persistedAnalysisGraphHash` alone is not enough for a
   * caller that must DERIVE something else from the committed state. The persist
   * passes mutate `intercept`, node `interventions` and top-level `options[]`,
   * and at least one downstream derivation reads exactly those:
   * `computeStructuralReadiness` reads option nodes' merged interventions. A
   * caller deriving readiness from its own pre-projection copy can therefore
   * publish a readiness verdict describing a graph that was never stored —
   * the same "advertised state != persisted state" class the hash field above
   * exists to prevent, one field over.
   *
   * `null` when this commit wrote no graph. Do NOT treat it as a general
   * read-back: it is this commit's own input after projection, not a re-read.
   */
  readonly persistedGraph: unknown | null;
}

/**
 * Match key for carry-forward supersession + consumed matching. `chip_id` is
 * present on every PendingAction and, for `apply_proposed_change`, is REQUIRED
 * to equal `action.proposal_ref` (the bridge enforced by `parsePendingAction`),
 * so `consumedPendingRefs` (proposal refs) match against it directly.
 */
function pendingMatchKey(pa: PendingAction): string {
  return pa.chip_id;
}

/**
 * V5 Signature Loop — pure carry-forward survival filter (behaviour #2).
 *
 * Given the PRIOR turn's pending actions and THIS turn's freshly-derived ones,
 * return the prior pendings that should persist into this turn (each with its
 * turn-count TTL decremented). A prior pending survives iff ALL hold:
 *   1. not consumed this turn (applied / dismissed — `consumedRefs`);
 *   2. not superseded by a this-turn pending with the same key (newer wins);
 *      for `proposed_concept` supersession is KIND-level: ANY fresh
 *      capture this turn supersedes every carried concept (single-slot
 *      proposal memory — diagnosis D2a);
 *   3. not wall-clock expired (`expires_at_iso > nowMs`; malformed → expired);
 *   4. graph-hash precondition still matches `currentGraphHash` when BOTH are
 *      known (a mismatch = the graph moved underneath it → invalidated);
 *   5. turn-count TTL not exhausted AFTER decrementing by 1 (drop at `<= 0`).
 *
 * Pure and deterministic (clock injected). This is the single place the
 * turn-count TTL is decremented — see the once-per-turn invariant in the
 * consumption-path matrix (Docs/v5/v5-signature-loop-reliability.md). The
 * TurnExecutor `commitTurn` wrapper threads `priorPendingActions`, and — the
 * HOLD-WIPE fix (task_2e1b8c87) — so do the edit/draft route dispatchers
 * (via handlers/hold-thread-through.ts). Each turn commits exactly once, so
 * the once-per-turn decrement invariant holds across all threading callers.
 */
export interface SurvivingPriorPendingsResult {
  readonly survivors: readonly PendingAction[];
  readonly summary: PendingLifecycleSummary;
  /**
   * F-HELD fix 2b — the prior CONFIRMATION-EXPECTING pendings (kinds in
   * `CONFIRMATION_EXPECTING_ACTION_TYPES`) dropped by the TURN-COUNT TTL in
   * THIS pass. The carry-forward is the single turn-TTL decrement site, so
   * this is the only place a consent-expecting lapse is observable; the
   * commit seam reads it to attach the honest one-sentence lapse notice
   * (previously the hold died silently). Wall-expiry, hash-invalidation,
   * consumption and supersession are deliberately NOT reported here — they
   * have their own surfaced outcomes (apply/dismiss receipts, divergence
   * recoveries) or are wall-bounded staleness where re-offering copy risks
   * contradicting a much older conversation state.
   */
  readonly lapsedConfirmationExpecting: readonly PendingAction[];
}

/**
 * Detailed variant of {@link computeSurvivingPriorPendings}: identical survivor
 * computation (same rules, same short-circuit order, same TTL decrement) PLUS a
 * redacted drop-reason tally for the Track 2 lifecycle diagnostics. Each prior
 * pending is attributed to the FIRST matching drop reason (the order the
 * `continue`s already impose), so the counts partition `prior` exactly:
 * consumed + superseded + expiredWall + hashInvalidated + expiredTurns +
 * survived === prior.length. Pure; clock injected.
 */
export function computeSurvivingPriorPendingsDetailed(
  prior: readonly PendingAction[],
  thisTurn: readonly PendingAction[],
  consumedRefs: readonly string[],
  currentGraphHash: string | undefined,
  nowMs: number,
): SurvivingPriorPendingsResult {
  const consumed = new Set(consumedRefs);
  const thisTurnKeys = new Set(thisTurn.map(pendingMatchKey));
  // ⭐⭐ THE CLAIMANT SET MOVES AS ONE (adversarial review, 2026-08-31).
  //
  // `applyRecordedAskLifetimes` widens the four recorded-ask kinds at the arm
  // seam. The other THREE bare-number claimants — `set_factor_value`,
  // `clarify_v2_round`, `proposed_concept` — keep the default window, so
  // without this the claimant set decays UNEVENLY: a numbered menu expires at
  // 2 turns, a widened `elicit_option_effect` runs to 12, the user types the
  // MENU INDEX, and the elicit is now the sole live claimant at
  // `repair-value-binding.ts:514-518` and BINDS it into the option/factor cell.
  // That is the stale-hijack harm the lifetime note exists to prevent,
  // manufactured by the widening itself.
  //
  // ⭐ ENFORCED HERE, NOT AT THE COMMIT SEAM, and the reason is the sequence:
  // the competitor is routinely armed on a LATER turn than the ask, so a
  // one-shot guard at arm time would miss it entirely. This function runs on
  // EVERY carried turn and already owns the turn-count decrement, so a
  // competitor appearing at any point brings the asks back down with it — and
  // the clamp is applied BEFORE rules 3-5 below, so both then expire together
  // rather than one lingering a turn longer.
  //
  // ⛔ ONE-DIRECTIONAL: the clamp only ever SHORTENS, so it cannot make any
  // binding reachable that was not reachable before the widening shipped; the
  // worst it can do is decline a bind, which is the fail-closed direction. When
  // no competitor has ever been live alongside the ask — the founder's journey
  // — it is a no-op.
  //
  // ⚠⚠ AND IT IS IRREVERSIBLE. THIS COMMENT PREVIOUSLY SAID "only WHILE a
  // competing claimant is LIVE", which states an invariant this code does not
  // have, and a reviewer falsified it here. The DECISION is per turn; the
  // RESULT is persisted — `survivors.push({ ...pa, ... })` at :565 pushes the
  // CLAMPED object, and that is what lands in the turn row. Nothing restores
  // the widened bounds afterwards. So a SINGLE turn of overlap with a
  // short-window claimant permanently returns that ask to 2 turns / 10 minutes:
  // a TRANSIENT competitor reverts the widening for that ask for good.
  //
  // Accepted, by comparison rather than by a claim of harmlessness: the clamped
  // state is EXACTLY the pre-PR state, so a stuck-clamped ask is no worse than
  // shipping nothing, while an unclamped one writes a number the user meant for
  // a different question into their model. Whether the window SHOULD be
  // restored once the competitor clears is a real question, deliberately NOT
  // answered here (it needs the arming bounds carried separately from the
  // current ones) and reported as a finding instead.
  //
  // Pinned by the transient-competitor case in `recorded-ask-lifetime.test.ts`,
  // which asserts the stickiness rather than the wish.
  const clampAskWindows = recordedAskWindowMustClamp([...prior, ...thisTurn], nowMs);
  // Diagnosis D2a (live 2026-07-10 stale-resume specimen): proposal memory
  // is a SINGLE-SLOT store — when this turn's assistant text produced a
  // capturable offer (a fresh `proposed_concept` entry in `thisTurn`),
  // every CARRIED `proposed_concept` is superseded by it, kind-level.
  // Key-level supersession alone can never fire for this kind: each
  // capture mints a fresh UUID chip_id, so a carried stale concept used
  // to survive alongside the fresh one and (with the old end-first read)
  // even win over it.
  const thisTurnHasFreshProposedConcept = thisTurn.some(
    (pa) => pa.action.kind === 'proposed_concept',
  );
  // ROADMAP 2.63 C3/C4 — the draft/redraft offer is likewise a SINGLE-SLOT
  // store: each guard re-fire / graph-present decline mints a fresh offer
  // with a fresh chip_id, so key-level supersession can never fire for the
  // kind and a carried stale offer would otherwise survive alongside the
  // fresh one (two live `draft_graph` pendings, ambiguous resume target).
  // Any fresh offer this turn supersedes every carried one.
  const thisTurnHasFreshDraftOffer = thisTurn.some(
    (pa) => pa.action.kind === 'draft_graph',
  );
  const survivors: PendingAction[] = [];
  const lapsedConfirmationExpecting: PendingAction[] = [];
  let consumedCount = 0;
  let supersededCount = 0;
  let expiredWallCount = 0;
  let hashInvalidatedCount = 0;
  let expiredTurnsCount = 0;
  for (const priorPa of prior) {
    const key = pendingMatchKey(priorPa);
    if (consumed.has(key)) { consumedCount += 1; continue; } // 1. applied / dismissed
    if (
      thisTurnKeys.has(key)
      || (priorPa.action.kind === 'proposed_concept' && thisTurnHasFreshProposedConcept)
      || (priorPa.action.kind === 'draft_graph' && thisTurnHasFreshDraftOffer)
    ) { supersededCount += 1; continue; } // 2. superseded (same key, or fresher concept/offer capture)
    // 2b. SYMMETRIC CLAIM WINDOW — clamp before rules 3-5 read the bounds, so a
    // clamped ask expires on the same turn as the competitor it was outliving.
    // Identity when the set is unmixed or the pending is not a recorded ask.
    const pa = clampAskWindows ? clampRecordedAskWindow(priorPa) : priorPa;
    const expiresMs = Date.parse(pa.expires_at_iso);
    if (!Number.isFinite(expiresMs) || nowMs > expiresMs) { expiredWallCount += 1; continue; } // 3. wall TTL
    // 4. graph-hash invalidation — only when both hashes are known.
    const preconditionHash = pa.preconditions.graph_hash;
    if (
      typeof preconditionHash === 'string' &&
      preconditionHash.length > 0 &&
      typeof currentGraphHash === 'string' &&
      currentGraphHash.length > 0 &&
      preconditionHash !== currentGraphHash
    ) {
      hashInvalidatedCount += 1;
      continue;
    }
    // 5. turn-count TTL — decrement once per carried turn; drop when exhausted.
    const nextTurnCount = pa.expires_at_turn_count - 1;
    if (nextTurnCount <= 0) {
      expiredTurnsCount += 1;
      // F-HELD fix 2b: a consent-expecting pending lapsing by turn-TTL is
      // the silent-drop case the lapse notice closes. Turn-TTL drops ONLY —
      // see the field doc on SurvivingPriorPendingsResult.
      if (CONFIRMATION_EXPECTING_ACTION_TYPES.has(pa.action.kind)) {
        lapsedConfirmationExpecting.push(pa);
      }
      continue;
    }
    survivors.push({ ...pa, expires_at_turn_count: nextTurnCount });
  }
  return {
    survivors,
    lapsedConfirmationExpecting,
    summary: {
      priorCount: prior.length,
      consumedCount,
      supersededCount,
      expiredWallCount,
      expiredTurnsCount,
      hashInvalidatedCount,
      // Pre-cap: this function applies no per-turn cap (it has no view of this
      // turn's own pendings). `capDroppedCount` is finalised at the commit seam
      // against `finalPendings`; `survivedCount` here is the ELIGIBLE survivor
      // count, corrected to the actually-persisted count by `finaliseLifecycle`.
      capDroppedCount: 0,
      survivedCount: survivors.length,
    },
  };
}

/**
 * V5 Signature Loop — pure carry-forward survival filter (survivors only).
 * A thin wrapper over {@link computeSurvivingPriorPendingsDetailed}: the
 * detailed variant is the single implementation, so the survivor semantics
 * pinned by `commit-carry-forward.test.ts` cannot diverge from the tally.
 */
export function computeSurvivingPriorPendings(
  prior: readonly PendingAction[],
  thisTurn: readonly PendingAction[],
  consumedRefs: readonly string[],
  currentGraphHash: string | undefined,
  nowMs: number,
): readonly PendingAction[] {
  return computeSurvivingPriorPendingsDetailed(
    prior,
    thisTurn,
    consumedRefs,
    currentGraphHash,
    nowMs,
  ).survivors;
}

/**
 * Finalise the pre-cap carry-forward tally against the per-turn cap. The
 * detailed pass counts every ELIGIBLE survivor; the commit then caps
 * `[...thisTurnPendings, ...eligibleSurvivors]` at
 * `PENDING_ACTIONS_PER_TURN_CAP` with this turn's own pendings FIRST, so some
 * eligible survivors may not persist. This splits the pre-cap `survivedCount`
 * into the actually-persisted `survivedCount` and the `capDroppedCount`,
 * keeping the seven-fate partition exact. Pure; total (clamps defensively).
 */
export function finaliseLifecycleAgainstCap(
  preCap: PendingLifecycleSummary,
  persistedSurvivorCount: number,
): PendingLifecycleSummary {
  const eligible = preCap.survivedCount;
  const persisted = Math.max(0, Math.min(persistedSurvivorCount, eligible));
  return {
    ...preCap,
    survivedCount: persisted,
    capDroppedCount: eligible - persisted,
  };
}

/**
 * F-HELD fix 3a (steer-don't-bind, design option a) — the SUGGESTION-CLASS
 * run_analysis chip ids that must not be minted while a confirmation-expecting
 * pending is live. These are the generic "re-run analysis" offers the
 * chip-generator (and its deterministic siblings) attach to ordinary answers —
 * exactly the competing consent offer that hijacked the bare "yes" in wire
 * capture 13c→14c.
 *
 * Scope discipline: ERROR/RECOVERY chips are NEVER suppressed. Every recovery
 * mint carries a dedicated id ('chip_action_run_analysis_retry',
 * 'chip_action_retry_analysis', 'chip_action_run_analysis_after_expiry',
 * 'chip_action_run_analysis_after_chip_no_pending',
 * 'chip_action_rerun_analysis_gm_stale', 'chip_clarify_pending_N') — none of
 * them appear in this set, so their affordances survive intact.
 *
 * Documented residual — COMPLETE manifest of mints sharing the generic
 * 'chip_action_rerun_analysis' id (round-2 FIXUP 5b), all suppressed for the
 * duration of a live hold; each keeps its re-run guidance in assistant_text:
 *   - compose/chip-generator.ts (suggestion mints — the intended targets);
 *   - routing/run-comparison-gate.ts RERUN_CHIP (stale/unconfirmed
 *     "what changed?" recovery — can co-occur with a live hold);
 *   - routing/stale-rerun-guard.ts RERUN_ACTION (stale-rerun guard, ALSO
 *     re-used by the coaching degrade path; the degrade's own hold case is
 *     handled upstream by the held-aware template, F-HELD 3b);
 *   - routing/post-analysis-label-intercept.ts RERUN_ANALYSIS_CHIP
 *     (post-analysis label-click chip set);
 *   - turn-executor.ts what_would_flip stale-resume recovery (cannot
 *     co-occur with a live hold after the consent-priority fix: the hold
 *     wins the bare-confirm pick, and chip clicks are intent-scoped).
 * Steer-don't-bind accepts the one-click-affordance loss on the sharers
 * while the hold is unresolved.
 */
const SUPPRESSIBLE_RUN_ANALYSIS_SUGGESTION_CHIP_IDS: ReadonlySet<string> = new Set([
  'chip_action_rerun_analysis',
  'chip_action_rerun_analysis_after_mutation',
]);

/**
 * Exported (ROADMAP 2.622) so a chip-minting seam can ASK whether the chip it
 * is about to emit survives a live hold, instead of a downstream reader having
 * to re-derive the answer from this module's private set. The structural-edit
 * split disclosure mints a re-run chip on exactly the condition that arms this
 * suppression; its spec binds to this predicate so a change to the set moves
 * the pin with it rather than leaving a test describing a behaviour that has
 * gone. Pure, no side effects, safe to call from anywhere.
 */
export function isCompetingRunAnalysisSuggestionChip(chip: SuggestedAction): boolean {
  return (
    chip.action_type === 'run_analysis' &&
    SUPPRESSIBLE_RUN_ANALYSIS_SUGGESTION_CHIP_IDS.has(chip.id)
  );
}

/**
 * F-HELD fix 2b — the deterministic one-sentence lapse notice attached when a
 * confirmation-expecting pending is turn-TTL-dropped by THIS commit's
 * carry-forward pass.
 *
 * SEAM CHOICE (documented per the fix brief): the notice is injected at the
 * commit chokepoint itself, onto the response being committed, NOT via a
 * next-turn deterministic-line channel. Rationale: (a) the carry-forward
 * inside `commitDirectAnswer` is the SINGLE turn-TTL decrement site, so the
 * lapse is only observable here; (b) the response being committed IS the
 * next user-visible message after the last turn on which the hold was
 * resumable — deferring one more turn would need new durable state for
 * strictly later delivery; (c) appending before the durable
 * `assistant_message` derivation keeps stored copy == wire copy (the
 * recent_changes / coaching-state style seams are read-side projections and
 * have no deterministic line-injection path into assistant_text today, so
 * none could carry this without a new channel).
 *
 * RESIDUAL CLOSED for edit/draft (HOLD-WIPE fix, task_2e1b8c87): this
 * notice (and the whole TTL/carry-forward lifecycle) fires only on commits
 * that thread `priorPendingActions` — previously the TurnExecutor
 * `commitTurn` wrapper alone, so edit- and draft-classified dispatch
 * commits silently WIPED live holds. Both dispatchers now thread priors
 * (handlers/hold-thread-through.ts) and additionally handle
 * mutation-caused invalidation honestly at their own seam (a hold whose
 * pinned base the mutation moved is validated against the new graph and
 * either re-pinned or lapsed with a notice + telemetry BEFORE this
 * carry-forward runs — hash-rule drops here stay notice-less by design,
 * because consent holds can no longer reach rule 4 with a stale pin from
 * those paths).
 *
 * REMAINING wipe sharers, named INDIVIDUALLY because the module-level claim
 * that stood here until 30 Aug 2026 ("chip-click dispatch and system-event
 * dispatch thread no priors") had become false in both directions and so
 * taught every later lane to stop looking at two whole modules. Derived at
 * `7a1ea3d9` over every non-test `commitDirectAnswer(` and
 * `appendCheckedGraphWrite(` call site in `src/`; five of the seven
 * system-event sites and both remaining chip-click continuity sites DO
 * thread priors. Line numbers are as of that SHA — trust the function names,
 * re-derive the lines:
 *   - `system-events/dispatch.ts:1543` and `:1595`, both inside
 *     `dispatchFactorValueEdit` (a MUTATING path, so it needs
 *     `threadHoldsThroughMutatingCommit`, not a plain thread);
 *   - `handlers/chip-click-dispatch.ts:1679`, in
 *     `dispatchChipClickRunAnalysis` (the run_analysis SUCCESS commit);
 *   - `routes/assist.v1.scenario-graph-register.ts:435`, which writes a turn
 *     row through `appendCheckedGraphWrite` with no `pending_actions` at all
 *     (`supabase-store.ts:325` resolves that to `[]` — the same silent wipe).
 *     Mounted at `server.ts:1224`; whether a user reaches it is UNVERIFIED —
 *     no wire witness taken and the UI repo was not inspected.
 */
function buildHeldLapseNotice(pa: PendingAction): string {
  const a = pa.action;
  const label =
    (a.kind === 'apply_proposed_change' || a.kind === 'proposed_concept') &&
    typeof a.public_label === 'string' &&
    a.public_label.trim().length > 0
      ? a.public_label.trim()
      : null;
  // F-HELD round 2 (FIXUP 2): comma, not an em dash — this string is
  // injected AFTER every sanitise seam, so it must satisfy house style
  // (no em dash in user-facing copy) directly.
  return label !== null
    ? `The held change '${label}' has lapsed, say the word if you still want it.`
    : 'A held change has lapsed, say the word if you still want it.';
}

const PersistedGraphV3 = GraphV3.passthrough();

/**
 * The carrier plan carries NO graph, deliberately.
 *
 * C8 originally returned `parsed.data` here and the commit persisted THAT in
 * place of the projected form. `GraphV3.passthrough()` keeps every field, but a
 * Zod object parse REBUILDS the object in schema-declaration order — so the
 * bytes written to `scenarios.graph` came back with their keys reordered
 * whenever the carrier succeeded. That silently broke the persist-site
 * contract this file resolves `graphForStore` first to guarantee: "the appended
 * graph IS the projected form (nothing mutates after the check)".
 *
 * Worse than reordering, and the reason this is a correctness fix rather than a
 * cosmetic one: `.passthrough()` applies to the ROOT object ONLY. The nested
 * `NodeV3` / `EdgeV3` schemas strip unknown keys as Zod does by default, so the
 * substituted object came back with additive node fields DELETED — measured, a
 * factor node's `value: 10` was dropped from the bytes written to
 * `scenarios.graph`. The carrier hashed that lossy form too, so the hashes were
 * self-consistent and the loss was invisible to every assertion.
 *
 * Both hashes are therefore now computed from the SAME object that is
 * persisted, making "the carrier's hashes describe the persisted bytes" true by
 * construction rather than by coincidence — this matters because
 * `analysis_affecting_hash` is what CAS compares on.
 *
 * (The carrier is now the `plan` arm of `AtomicCommittedModelVersionOutcome`,
 * declared below with the skip/none arms it must be distinguished from. The
 * no-graph rule above is unchanged and still load-bearing.)
 */

function deterministicMutationId(scenarioId: string, turnId: string): string {
  const hex = createHash('sha256')
    .update(`olumi:model-version:committed-mutation:${scenarioId}:${turnId}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Carrier outcomes, and where the boundary between them actually falls.
 *
 * THE RULE BEING IMPLEMENTED: a valid semantic commit on a VERSIONABLE graph
 * must still produce the durable version/history consequence — versioning may
 * only be skipped for state that genuinely cannot be versioned, and never
 * silently. Silently dropping a version that WAS due would remove the durable
 * history the Core journey depends on, which is worse than the dead-end this
 * change fixes, because a silent skip is indistinguishable from success.
 *
 * WHERE "VERSIONABLE" IS DECIDED — the GraphV3 parse, and it is a genuine
 * boundary rather than a convenience:
 *
 *   · A version row is GraphV3-shaped by contract, and its
 *     `analysis_affecting_hash` is what the CAS compares on. Deriving those
 *     identities from a graph that is NOT GraphV3 is the exact hazard
 *     `assertGraphForIdentity` exists to prevent — it is how something like
 *     `{nodes:[42,'x']}` would hash into the authoritative comparison value.
 *     So a non-conformant graph has NO valid version that could be written.
 *   · Therefore every parse failure is genuinely NON-VERSIONABLE. There is no
 *     "could have been versioned but something went wrong" case hiding among
 *     them — that case lives strictly AFTER a successful parse, and it throws.
 *
 * ⚠ WHY THE SKIP IS NOT NARROWED TO A "LEGACY-ONLY" PREDICATE, stated plainly
 * because the instinct to narrow it is right and the evidence refutes it.
 * An earlier revision skipped only when EVERY Zod issue was a missing required
 * field (`invalid_type` + `received: 'undefined'`) and threw on anything else,
 * to keep a corrupt graph from being laundered as legacy. Measured against the
 * real failing corpus, that predicate FAILS 15 legitimate commits, because
 * non-conformance in this estate is routinely not a missing field:
 *
 *     invalid_enum_value | causal | edges[].edge_type        (older vocabulary)
 *     invalid_type       | number | edges[].strength         (legacy scalar strength)
 *     too_small          |        | edges[].strength.std     (std: 0)
 *
 * The last one is decisive: `std: 0` is persisted VERBATIM and deliberately, by
 * a current code path whose whole point is that the numeric floor is not
 * applied at adopt so the identity hash stays stable. That is a CURRENT product
 * graph, not an old one — so "GraphV3 rejects it" cannot be read as "it is
 * corrupt", and a predicate that fails the turn on non-conformance would break
 * behaviour the product intends.
 *
 * The discrimination that was wanted is therefore delivered where it is safe
 * and useful — in the OBSERVABILITY, not the control flow. Every skip names
 * which kind of non-conformance it was, so the two populations stay countable
 * and a corruption spike is visible, without a fragile predicate deciding
 * whether a user's turn survives. What must never happen — a versionable graph
 * losing its version — is fully covered: a graph that parses ALWAYS gets a
 * version, and any failure after the parse throws.
 *
 * The DESIGNED no-version outcomes (flag off, no graph, and the policy's
 * `no_op` / `presentation_only`) stay silent: they are not faults, and an alarm
 * that fires on them would be worthless. Only non-conformance logs at `warn`
 * and emits `status: 'skipped'` with a closed-enum reason — the shape
 * `recordDecisionRecordForCommit` already uses for a skipped secondary record,
 * on the frozen registry member `v5.model_versions.version_created` whose only
 * emitter C8 removed.
 */
type ModelVersionCarrierSkipReason =
  | 'graph_missing_required_fields'
  | 'graph_incompatible_with_graph_v3';

/**
 * Classify HOW the graph failed GraphV3. This selects a telemetry reason only —
 * both outcomes skip — so that "an old row is missing a field" and "a field is
 * present but unusable" remain separately countable.
 *
 * ⚠⚠ THE HEADER ABOVE STATES A POLICY CHOICE AS AN IMPOSSIBILITY, AND THAT IS
 * WRONG (C8-A review, 2026-08-25). It justifies skipping with "a non-conformant
 * graph has NO valid version that could be written". That sentence is FALSE for
 * at least two of the three classes it names: measured, `edge_type: 'causal'`
 * (older vocabulary) and a legacy scalar `strength` BOTH yield a computable
 * `graph_identity_hash` AND a computable `analysis_affecting_hash`, so a valid
 * version row was available for them the whole time — the same refutation that
 * closed the `std: 0` case.
 *
 * What is actually true is narrower and worth saying plainly: we CHOOSE not to
 * version a graph that fails the canonical contract, because a version row is
 * GraphV3-shaped by contract and admitting non-conformant bytes into the
 * durable record would make the version store's own guarantee untrue. That is a
 * defensible policy. It is not an impossibility, and stating it as one is how
 * the next session inherits a wrong belief and reasons from it — which is
 * exactly what happened with `std: 0`.
 */
function classifyGraphV3NonConformance(error: ZodError): ModelVersionCarrierSkipReason {
  const everyIssueIsAMissingField =
    error.issues.length > 0 &&
    error.issues.every(
      (issue) => issue.code === 'invalid_type' && issue.received === 'undefined',
    );
  return everyIssueIsAMissingField
    ? 'graph_missing_required_fields'
    : 'graph_incompatible_with_graph_v3';
}

/**
 * The carrier's outcome. Deliberately THREE cases, not two.
 *
 * ⚠ THE SKIP IS NO LONGER REPORTED FROM HERE (Codex C8-A review, 2026-08-25).
 * It used to `emit()` inline, and this function runs far upstream of — and one
 * `await` before — the durable write, which now happens inside
 * `appendCheckedGraphWrite` (`persist-graph-write.ts`). (Line numbers removed
 * deliberately: the two this sentence carried had already drifted, and a line
 * number in prose is a hand-maintained mirror like any other.) So a turn whose
 * append then threw (`GraphStaleWriteError` on a CAS conflict,
 * `StateCommitFailedError` on PGRST202, a fence refusal) had ALREADY published
 * `v5.model_versions.version_created{status:'skipped'}` — a claim about the
 * outcome of a transaction that never committed. Nothing rolls telemetry back.
 *
 * This file already states the correct rule twenty lines below the fix, for a
 * different event: *"Telemetry fires AFTER write succeeds — never log a
 * 'created' event for a pending action that was rolled back by an RPC
 * failure."* The version skip now obeys the same rule: the reason is RETURNED,
 * and the commit emits it from the post-success block once the append is
 * durable.
 */
type AtomicCommittedModelVersionOutcome =
  | { readonly kind: 'plan'; readonly write: AtomicCommittedModelVersionWrite }
  /** A DESIGNED no-version outcome (flag off, no graph, no_op, presentation_only). Silent. */
  | { readonly kind: 'none' }
  /** Non-conformance. Reportable — but only once the turn is durable. */
  | { readonly kind: 'skip'; readonly reason: ModelVersionCarrierSkipReason };

/**
 * Log the skip immediately (a log line is not a claim about a committed
 * transaction) and carry the reason to the post-success emit.
 */
function skipAtomicCommittedModelVersion(
  reason: ModelVersionCarrierSkipReason,
  metadata: CommitMetadata,
): AtomicCommittedModelVersionOutcome {
  log.warn(
    {
      scenario_id: metadata.scenario_id,
      turn_id: metadata.turn_id,
      skip_reason: reason,
    },
    'ModelManagement — semantic model version SKIPPED for this commit (turn committed in full; no version row written)',
  );
  return { kind: 'skip', reason };
}

/** Build the carrier and the exact graph bytes it content-addresses. */
function buildAtomicCommittedModelVersion(
  graph: unknown,
  metadata: CommitMetadata,
): AtomicCommittedModelVersionOutcome {
  if (config.cee.modelVersionsEnabled !== true || !graphWasProvided(graph)) {
    return { kind: 'none' };
  }
  const policy = decideModelVersionCreation(metadata.baseGraphForInvariants, graph);
  if (!policy.create) return { kind: 'none' };

  // The parse is a VALIDITY GATE over the bytes about to be persisted — its
  // output is deliberately not used (see the plan interface).
  //
  // ⚠ THE GATE IS EVALUATED AGAINST THE SANCTIONED SIGMA PROJECTION, NOT THE
  // RAW BYTES (Codex C8-A review defect 2 / H1, 2026-08-25). `EdgeStrengthV3.std`
  // is `z.number().positive()` (schemas/cee-v3.ts:263), so a single `std: 0`
  // edge failed this parse with `too_small` and the WHOLE scenario silently
  // stopped versioning — turn and graph persisted, version/head/event/receipt
  // dropped. That is the atomic-history violation this carrier's own header
  // forbids, and the header's justification for tolerating it — that a graph
  // GraphV3 rejects "has NO valid version that could be written" — is FALSE for
  // this class: measured, `computeGraphIdentityHash` and
  // `computeVersionAnalysisAffectingHashRecord` BOTH resolve on a `std: 0`
  // graph, so a perfectly good version row was available the entire time.
  //
  // `std <= 0` is not a corrupt graph and not a legacy one. It is a CURRENT,
  // routinely-produced ingress reality with an already-ratified treatment
  // (`validators/numeric-bounds.ts`, "Cut 3"): the UI's own writer floors
  // outbound sigma with `Math.max(0, …)` — a floor of ZERO — so it "emits std=0
  // continuously", and the compute path handles it by flooring at the
  // persisted-load boundary, metered as `cee.compute.sigma_floor`, while
  // leaving the hashed bytes untouched. Skipping the version here invented a
  // FOURTH treatment for the same value, and the only one that destroys data.
  //
  // So the gate reuses the sanctioned floor rather than minting a third policy.
  // The floored graph is used for the PARSE ONLY. Everything downstream — the
  // identity hash, the analysis-affecting hash and the bytes actually persisted
  // — is still derived from `graph` verbatim, because `strength.std` is inside
  // the analysis-affecting projection and rewriting it would fork identity
  // (numeric-bounds.ts "Cut 2", the abc7d29 false-stale regression). Identity
  // stays sacred; only the admissibility question is asked of the projection.
  const gateGraph = floorGraphSigmaForCompute(graph).graph;
  const parsed = PersistedGraphV3.safeParse(gateGraph);
  if (!parsed.success) {
    // NOT VERSIONABLE — no valid version row exists for this graph. Skip, and
    // make the skip observable with the kind of non-conformance it was.
    return skipAtomicCommittedModelVersion(
      classifyGraphV3NonConformance(parsed.error),
      metadata,
    );
  }

  // VERSIONABLE — a version MUST be created from here on. Hash the EXACT object
  // being persisted, not the parse output (which strips additive nested
  // fields). A failure below is a real failure on a graph that IS versionable,
  // so it SURFACES rather than silently dropping durable history.
  const persistedGraph = asGraphStateIngress(graph);
  const full = computeGraphIdentityHash(persistedGraph);
  const analysis = computeVersionAnalysisAffectingHashRecord(persistedGraph);
  if (full === null || analysis === null) {
    throw new StateCommitFailedError(
      'Model version carrier could not derive both durable identities for a versionable graph; refusing a split semantic commit.',
    );
  }
  return {
    kind: 'plan',
    write: {
      mutation_id: deterministicMutationId(metadata.scenario_id, metadata.turn_id),
      graph_identity_hash: full.value,
      analysis_affecting_hash: analysis.value,
      hash_algorithm: full.algorithm,
      identity_projection_version: full.projection_version,
      identity_normaliser_version: full.normaliser_version,
      graph_schema_version: full.graph_schema_version,
      // CEE ingress is service-authenticated, not end-user authenticated:
      // payload user ids and event kinds cannot attest the author of reasoning.
      // Producers may supply `versionActor` only when they hold that explicit
      // fact (the restore route does); every ordinary carrier stays Unknown.
      actor_kind: metadata.versionActor?.kind ?? 'unknown',
      authored_by:
        metadata.versionActor?.kind === 'known' ? metadata.versionActor.authored_by : null,
      creation_kind: 'committed_mutation',
      source_turn_id: metadata.turn_id,
    },
  };
}

/**
 * True when `metadata.graph` counts as "a graph was provided for this
 * commit" — MM hygiene batch fix (ROADMAP 1.25 MM P1 set, item 1).
 *
 * Deliberately `!= null` (excludes BOTH `undefined` AND `null`), not the
 * `!== undefined` check this used to be. `CommitMetadata.graph` is typed
 * `unknown`, so a caller CAN pass an explicit `null` (e.g. a handler outcome
 * typed `GraphStateIngress | null | undefined` — turn-executor.ts's
 * `outcome.mutatedGraph` cast). `null !== undefined` is `true`, so the old
 * check let an explicit `null` through as if a graph had been persisted:
 *   - the Lane 8 MM version hook fired with `graph: null`, and
 *     `computeGraphIdentityHash` treats `null` as identity-empty, so MM
 *     logged/returned an `empty_graph` fault for a commit that never even
 *     tried to write a graph — a spurious warning, not a real MM failure;
 *   - `graphPersisted` was returned `true` even though nothing was
 *     written — contradicting the `empty_graph` signal from the same
 *     commit and telling the caller it's safe to advance
 *     `stage_indicator='analyse'` on a turn with no graph.
 * `!= null` makes both a no-op: an explicit `null` is now treated exactly
 * like an omitted graph (`undefined`) always was.
 */
export function graphWasProvided(graph: unknown): boolean {
  return graph != null;
}

/**
 * Slice B commit: persist the turn via the session store, return the
 * unchanged response. Throws `StateCommitFailedError` on RPC failure;
 * TurnExecutor's existing catch handles the mapping to `STATE_COMMIT_FAILED`.
 *
 * When metadata.graph is provided, the graph is written atomically with the
 * turn row via append_turn_atomic(p_graph). On success, graphPersisted=true
 * is returned so the caller can set stage_indicator='analyse'. On RPC failure
 * the whole call throws (StateCommitFailedError) — there is no partial state.
 */
export async function commitDirectAnswer(
  response: OlumiResponse,
  metadata: CommitMetadata,
  sessionStore?: SessionStore,
): Promise<CommitResult> {
  // Invariant guard: the TurnExecutor seven-step assembly must produce a
  // composed OlumiResponse before reaching COMMIT. A falsy response here
  // means an upstream step returned null/undefined instead of throwing —
  // committing that would persist a turn row whose wire response never
  // materialised, silently violating BI-01 (exactly-one-response). Fail
  // loud so TurnExecutor's catch ladder maps the failure to the typed
  // INTERNAL_ERROR path instead of emitting an undefined body.
  //
  // Guarded explicitly in `commit.test.ts > throws on falsy response` so a
  // future refactor that deletes the guard trips the test before a silent
  // wire-contract breach can land.
  if (!response) {
    throw new Error('commit invariant violated: response must be a composed OlumiResponse');
  }

  const store = sessionStore ?? getSessionStore();

  // ── THE PERSISTED FORM, RESOLVED FIRST (design §3.2 closure) ──────────────
  // `graphForStore` is the exact object that will be written to
  // `scenarios.graph`. It is resolved HERE, before anything derives a decision
  // from a graph hash, because the three persist passes it applies
  // (`repairGraphForPersistence`, `normaliseOptionInterventionContract`,
  // `reconcileTopLevelOptionsFromNodes`) mutate `intercept`, node
  // `interventions` and top-level `options[]` — all three inside
  // `computeAnalysisAffectingGraphHash`'s projection.
  //
  // These passes used to run just above `store.append`, AFTER the pending
  // re-pin and the carry-forward had already been decided against
  // `metadata.graph_hash` — a hash of the PRE-pass graph. Whenever any pass
  // fired, freshness, the pending's re-pin and the held thread were all decided
  // against a graph we did not store. Ordering is the whole fix: project first,
  // then derive every hash-dependent decision from the projected bytes.
  const projectedGraphForStore = projectGraphForPersistence(metadata.graph, {
    scenarioId: metadata.scenario_id,
    turnId: metadata.turn_id,
    turnClass: metadata.turn_class,
    source: metadata.handler_id ?? undefined,
  });
  const atomicVersionPlan = buildAtomicCommittedModelVersion(
    projectedGraphForStore,
    metadata,
  );
  // The projected form is what gets persisted, ALWAYS — the carrier validates
  // and hashes it, it never substitutes its own bytes (see the plan interface).
  const graphForStore = projectedGraphForStore;

  // The authoritative hash for this turn: RECOMPUTED on the bytes above, never
  // the caller's advertised value. Callers compute their hash before the
  // projection is knowable, so a supplied `graph_hash` is only trusted on a
  // commit that writes NO graph (where there are no persisted bytes to hash
  // and the caller's value refers to the unchanged stored graph).
  const persistedInvariants = checkPersistedGraphInvariants(graphForStore, {
    baseGraph: metadata.baseGraphForInvariants,
  });
  const writesGraph = graphWasProvided(metadata.graph);
  const persistedAnalysisGraphHash = writesGraph
    ? persistedInvariants.analysisGraphHash
    : null;
  const effectiveGraphHash = writesGraph
    ? (persistedAnalysisGraphHash ?? undefined)
    : metadata.graph_hash;

  // Atomic-emit contract: every chip whose action_type is in the resumable
  // set produces exactly one matching pending action, written in the same
  // `append_turn_atomic` call.
  //
  // When a caller pre-supplied an explicit pending_actions list, we use it as
  // given — but those sites (proposal-continuation, edit-graph-dispatch,
  // turn-executor ambiguous short-confirm) derive their chip-pendings via
  // `derivePendingActionsFromFinalizedChips`, so the list is ALREADY consistent
  // with the egress-finalised chip set. When no list was supplied we derive
  // here, also from the finalised set. Either way, a chip dropped at egress
  // (`sanitiseOlumiResponseForEgress` → `finalizeChips`: unsafe / blank /
  // duplicate / over-budget) can never leave an orphaned resumable pending that
  // a later "yes" short-confirm could resume — the "persisted pending ⟹
  // rendered chip" invariant is structural at every derivation site.
  const nowMsForPendings = Date.now();
  // RECORDED-ASK LIFETIME (2026-08-31). Applied HERE, at the single seam that
  // ARMS pendings, rather than at each of the ~15 creation sites that arm one.
  //
  // ⚠ WORDING CORRECTED AFTER REVIEW. This read "the single seam where pendings
  // are persisted (`pending_actions: finalPendings` below is the only writer
  // into the turn row)", which is FALSE — and this very file names the
  // counter-example at :698: `routes/assist.v1.scenario-graph-register.ts:435`
  // writes a turn row through `appendCheckedGraphWrite` with NO
  // `pending_actions`, which `supabase-store.ts` resolves to `[]` (another
  // wipe). The accurate and load-bearing claim is the narrower one: every
  // pending that is ARMED is armed here, so a kind-derived window at this seam
  // cannot be missed by a creation site. An overstated claim about a chokepoint
  // is how a second writer stays invisible.
  //
  // A per-site stamp is a hand-maintained mirror — trap 12 — and
  // the drift would be invisible: a new ask site that forgot it would simply
  // expire in two turns and read as "the user never answered". Deriving the
  // window from the KIND at the chokepoint makes a missed site impossible by
  // construction.
  //
  // THIS TURN'S OWN NEW PENDINGS ONLY. Carry-forward survivors are stamped
  // nowhere — `computeSurvivingPriorPendingsDetailed` owns their decrement, and
  // re-stamping a survivor each turn would make a recorded ask immortal (see
  // the ⚠ on `withRecordedAskLifetime`).
  const initialChipDerivedPending = applyRecordedAskLifetimes(
    metadata.pending_actions === undefined
      ? derivePendingActionsFromFinalizedChips(
          (response.suggested_actions ?? []) as readonly SuggestedAction[],
          {
            scenario_id: metadata.scenario_id,
            emitted_at_iso: new Date().toISOString(),
            // §3.2: pin this turn's chips to the graph we are STORING.
            graph_hash: effectiveGraphHash,
          },
        )
      : metadata.pending_actions,
    nowMsForPendings,
  );

  // F-HELD fix 3a (steer-don't-bind): while a confirmation-expecting pending
  // remains live AFTER this commit, do not mint competing run_analysis
  // SUGGESTION chips (or their derived pendings). "Live after this commit" =
  // a live confirmation-expecting pending among THIS turn's own pendings
  // (e.g. a GM hold emitted this turn) OR among the carry-forward SURVIVORS
  // (so a hold that is consumed / lapsing / hash-invalidated this very
  // commit does NOT suppress — the chips return as the hold dies).
  //
  // The preliminary carry-forward below is recomputed after suppression:
  // removing a chip-derived run_analysis pending can only change
  // SAME-KEY supersession of a prior run_analysis pending, never the
  // confirmation-expecting outcomes (their keys are proposal refs, not chip
  // ids, and concept supersession is kind-level) — so the hold verdict and
  // the lapse list are identical between the two pure passes.
  const hasLiveConfirmationExpecting = (list: readonly PendingAction[]): boolean =>
    list.some(
      (pa) =>
        CONFIRMATION_EXPECTING_ACTION_TYPES.has(pa.action.kind) &&
        !isPendingActionExpired(pa, nowMsForPendings),
    );
  const prelimCarryForward = computeSurvivingPriorPendingsDetailed(
    metadata.priorPendingActions ?? [],
    initialChipDerivedPending,
    metadata.consumedPendingRefs ?? [],
    effectiveGraphHash,
    nowMsForPendings,
  );
  const holdLiveAfterCommit =
    hasLiveConfirmationExpecting(initialChipDerivedPending) ||
    hasLiveConfirmationExpecting(prelimCarryForward.survivors);

  let responseForCommit = response;
  let chipDerivedPending = initialChipDerivedPending;
  if (holdLiveAfterCommit) {
    const chips = (responseForCommit.suggested_actions ??
      []) as readonly SuggestedAction[];
    const suppressedIds = new Set(
      chips.filter(isCompetingRunAnalysisSuggestionChip).map((c) => c.id),
    );
    if (suppressedIds.size > 0) {
      responseForCommit = {
        ...responseForCommit,
        suggested_actions: chips.filter(
          (c) => !isCompetingRunAnalysisSuggestionChip(c),
        ),
      };
      // Keep the "persisted pending ⟹ rendered chip" invariant: any pending
      // riding a suppressed chip (derived OR pre-supplied) is dropped with it.
      chipDerivedPending = initialChipDerivedPending.filter(
        (pa) => !(pa.action.kind === 'run_analysis' && suppressedIds.has(pa.chip_id)),
      );
      log.info(
        {
          scenario_id: metadata.scenario_id,
          turn_id: metadata.turn_id,
          suppressed_chip_ids: [...suppressedIds],
        },
        'V5 commit — competing run_analysis suggestion chips suppressed while a confirmation-expecting pending is live (F-HELD steer-don\'t-bind)',
      );
    }
  }

  // V5 Signature Loop — carry forward the prior turn's surviving pendings so a
  // single non-consuming turn (which commits an empty `chipDerivedPending`)
  // does NOT wipe a still-valid proposal. This turn's own pendings come FIRST so
  // a fresh offer is never evicted by a carried one when the per-turn cap binds.
  // Dropping `priorPendingActions` (legacy callers) makes this a no-op.
  const carryForward = computeSurvivingPriorPendingsDetailed(
    metadata.priorPendingActions ?? [],
    chipDerivedPending,
    metadata.consumedPendingRefs ?? [],
    effectiveGraphHash,
    nowMsForPendings,
  );
  const survivingPrior = carryForward.survivors;
  // Adversarial round-3 concern 3 — consent-priority cap fill. The plain
  // fresh-first slice could silently EVICT a validly-threaded live consent
  // hold (a CONFIRMATION_EXPECTING pending awaiting the user's explicit yes)
  // whenever this turn's own pendings filled the cap — the same silent-wipe
  // class the hold-thread-through fix closes at the dispatch seam. Within
  // the cap, live consent holds now win over non-consent pendings; original
  // relative order (this turn's own pendings first, so a FRESH consent hold
  // still beats a carried one) is preserved among the kept entries. A
  // non-consent pending dropped this way loses only its short-confirm
  // resumability — its chip still renders (the persisted-pending ⟹
  // rendered-chip invariant is one-directional). A consent hold that STILL
  // cannot fit (all-consent overflow) lapses with the honest F-HELD 2b
  // notice below, never silently.
  const combinedPendings: readonly PendingAction[] = [
    ...chipDerivedPending,
    ...survivingPrior,
  ];
  let finalPendings: readonly PendingAction[];
  let capEvictedConsentHolds: readonly PendingAction[] = [];
  if (combinedPendings.length <= PENDING_ACTIONS_PER_TURN_CAP) {
    finalPendings = combinedPendings;
  } else {
    const isLiveConsentHold = (pa: PendingAction): boolean =>
      CONFIRMATION_EXPECTING_ACTION_TYPES.has(pa.action.kind) &&
      !isPendingActionExpired(pa, nowMsForPendings);
    const keep = new Set<PendingAction>();
    for (const pa of combinedPendings) {
      if (keep.size >= PENDING_ACTIONS_PER_TURN_CAP) break;
      if (isLiveConsentHold(pa)) keep.add(pa);
    }
    for (const pa of combinedPendings) {
      if (keep.size >= PENDING_ACTIONS_PER_TURN_CAP) break;
      if (!isLiveConsentHold(pa)) keep.add(pa);
    }
    finalPendings = combinedPendings.filter((pa) => keep.has(pa));
    capEvictedConsentHolds = combinedPendings.filter(
      (pa) => isLiveConsentHold(pa) && !keep.has(pa),
    );
  }

  // F-HELD fix 2b — honest lapse notice. When THIS commit's carry-forward
  // turn-TTL-dropped a confirmation-expecting pending — or (round-3
  // concern 3) the consent-priority cap fill above still could not seat a
  // live consent hold — attach ONE deterministic sentence to the response
  // being committed (see `buildHeldLapseNotice` for the seam-choice
  // rationale). One sentence even if several lapse at once (cap is 3): the
  // first in prior order — the read side places the freshest offer first —
  // names the lapse; re-offering machinery stays out of scope here
  // (say-the-word re-consent is the ruled posture, not silent re-arming).
  const lapsedHolds = [
    ...carryForward.lapsedConfirmationExpecting,
    ...capEvictedConsentHolds,
  ];
  if (lapsedHolds.length > 0) {
    const notice = buildHeldLapseNotice(lapsedHolds[0]!);
    const baseText =
      typeof responseForCommit.assistant_text === 'string'
        ? responseForCommit.assistant_text
        : '';
    responseForCommit = {
      ...responseForCommit,
      assistant_text:
        baseText.trim().length > 0 ? `${baseText}\n\n${notice}` : notice,
    };
    log.info(
      {
        scenario_id: metadata.scenario_id,
        turn_id: metadata.turn_id,
        lapsed_kinds: lapsedHolds.map((pa) => pa.action.kind),
      },
      'V5 commit — confirmation-expecting pending lapsed (turn TTL or consent-priority cap overflow); deterministic lapse notice attached (F-HELD)',
    );
  }

  // Track 2 — finalise the lifecycle tally against the cap. Counted by
  // IDENTITY against the survivor list (the consent-priority fill above can
  // seat a survivor by evicting one of this turn's own pendings, so the old
  // head/tail arithmetic no longer holds). `survivedCount` is corrected to
  // the persisted count and the evicted remainder is attributed to
  // `capDroppedCount`, so the diagnostic reflects what was WRITTEN, not
  // pre-cap eligibility (Track 3 may read this as persisted survivor truth).
  // A cap-evicted pending of THIS turn's own stays outside the partition —
  // the seven-fate tally covers prior pendings only.
  const survivorIdentity = new Set<PendingAction>(survivingPrior);
  const persistedSurvivorCount = finalPendings.filter((pa) =>
    survivorIdentity.has(pa),
  ).length;
  const pendingLifecycle = finaliseLifecycleAgainstCap(
    carryForward.summary,
    persistedSurvivorCount,
  );

  // V5 Conversation Context Reliability: capture this turn's conversation
  // content for the next turn's ContextPack. user_message comes from the call
  // site verbatim (boundary payload.message via metadata.userMessage — the
  // user's own words, not something we generated, so it is NOT egress-scrubbed,
  // only capped). assistant_message is derived HERE from the composed response
  // so every commit path captures it uniformly, then reduced to its DURABLE
  // PUBLIC form (`durablePublicAssistantText`) — the forbidden-phrase guard +
  // entity-id scrub the wire applies post-commit — so the stored copy is never
  // less leak-safe than what shipped. Both are length-capped; nullish/empty →
  // NULL (system-event turns, blank answers, and the draft_graph path whose
  // provisional response carries empty assistant_text — its narrative is
  // reconstructable from the persisted graph in context).
  const userMessage = capConversationText(metadata.userMessage, 'user_message');
  // F-HELD: derived from `responseForCommit` (not the raw input response) so
  // the durable copy includes the lapse notice / excludes suppressed chips'
  // context exactly as the wire will — stored copy == wire copy.
  const assistantMessage = capConversationText(
    durablePublicAssistantText(
      responseForCommit.assistant_text,
      parseContentGraph(metadata.contentGraph),
    ),
    'assistant_message',
  );

  // ── D — THE TERMINAL INVARIANT CHECK (design §8/§13 step 1) ──────────────
  // The graph was projected into its persisted form at the TOP of this
  // function (see `graphForStore` above), because every hash-dependent
  // decision this turn makes had to be derived from the bytes we store rather
  // than from the caller's pre-projection graph (§3.2). The three passes it
  // applies keep their original relative order and their original semantics:
  //   repairGraphForPersistence          — Track S 0.13c-4 intercept repair
  //   normaliseOptionInterventionContract — V5 edit_graph P0 option contract
  //   reconcileTopLevelOptionsFromNodes   — Lane C3 / decision ③ options mirror
  //
  // The check itself now lives in `persist-graph-write.ts` and runs LAST,
  // immediately before the append, so it validates the ACTUAL PERSISTED BYTES.
  //
  // ⚠ CORRECTED (C3 closure). This paragraph used to say the check "covers
  // EVERY lane ... by construction rather than by a hand-listed set of call
  // sites (trap #12)", justified by `store.append` being "the single
  // `scenarios.graph` writer in the service". THAT JUSTIFICATION WAS FALSE and
  // the claim it supported was false with it. Measured at 75029f4f: TWO
  // production `store.append` call sites — this one and
  // `routes/assist.v1.scenario-graph-register.ts` — and
  // `checkPersistedGraphInvariants` had exactly ONE production caller (here),
  // with ZERO in that route. So a REGISTRATION could persist a structural
  // violation this path refuses fail-closed, and the sentence asserting
  // otherwise is itself the hand-maintained mirror it invoked trap #12 against.
  //
  // ⚠ AND THE REPLACEMENT MUST NOT BE A FRESH ABSOLUTE. An earlier draft of
  // this paragraph said the claim was "true NOW, and true by construction ...
  // Any THIRD writer must too". That is the SAME defect at one remove: a third
  // writer already exists and does NOT go through the floor. The honest form is
  // a MANIFEST with its scope, measured at 87cb9f4f over every `.ts` file under
  // `src/` plus all 34 `.sql` files:
  //
  //   · `commit.ts` (here)                        → `appendCheckedGraphWrite` ✅
  //   · `routes/assist.v1.scenario-graph-register.ts`
  //                                               → `appendCheckedGraphWrite` ✅
  //   · `routes/assist.v1.scenario-versions.ts` (the RESTORE tier)
  //       → `service.restoreVersionAtomic` → `restore_model_version_atomic_v1`
  //       → `UPDATE public.scenarios SET graph = p_graph`         ❌ NOT COVERED
  //   · `store_draft_graph` — no production caller (guarded by
  //     `context/__tests__/graph-identity-guards.test.ts`)             n/a
  //
  // The third writer is LIVE, not dark: registered unconditionally at
  // `server.ts:1214` (`POST /assist/v1/scenarios/:scenario_id/versions/restore`)
  // and `CEE_MODEL_VERSIONS_ENABLED` defaults ON (`config/index.ts:1372`).
  // Restoring an older version that carries a duplicate node id into a
  // currently-clean scenario is, by this floor's own delta definition, an
  // INTRODUCED violation — refused here, silently written there. Routing it
  // through the floor is deliberately OUT OF SCOPE for C3 and materially larger
  // (the RPC owns graph + undo + version + head + event in one statement).
  //
  // So: two of three writers go through `appendCheckedGraphWrite`. DERIVE the
  // caller set (`appendCheckedGraphWrite` vs `store.append(` vs a `.sql` sweep
  // for `SET graph = p_graph`) rather than trusting this comment — an
  // UNTRUNCATED sweep, because a truncated one and a complete one produce
  // indistinguishable output. ⚠ Scope both halves: a `UPDATE public.scenarios`
  // sweep MISSES the unqualified `UPDATE scenarios SET graph = p_graph` form,
  // which is how most of the `append_turn_atomic` family is written.
  //
  // FAIL-CLOSED, NEVER A SILENT REPAIR — enforced in the floor. Repairing there
  // would put a mutation AFTER the hash was computed and recreate the exact
  // defect this closes, so a violation refuses the commit and names what was
  // wrong. The refusal is a throw: the caller's existing commit-failure catch
  // ladder already maps it to a typed failure and, on the edit lane, reports the
  // graph as NOT persisted — which is true, rather than a graph stored corrupt.
  // THE SINGLE CALL-GRAPH AUTHORITY for a `scenarios.graph` write. The
  // terminal invariant enforcement that used to be inlined here moved into
  // `appendCheckedGraphWrite` VERBATIM so the register route enforces the same
  // floor on the same bytes — see that module for why the report is recomputed
  // there from `write.graph` rather than passed in from this function's earlier
  // `persistedInvariants` (which serves the advertised analysis hash, a
  // different question, and must not be reused as this one).
  const appendOutcome = await appendCheckedGraphWrite({
    store,
    writesGraph,
    baseGraphForInvariants: metadata.baseGraphForInvariants,
    source: metadata.handler_id ?? undefined,
    write: {
      scenario_id: metadata.scenario_id,
      turn_id: metadata.turn_id,
      turn_class: metadata.turn_class,
      handler_id: metadata.handler_id,
      request_hash: metadata.request_hash,
      response_emitted: true,
      llm_calls_used: metadata.llm_calls_used,
      duration_ms: metadata.duration_ms,
      handler_facts: metadata.handler_facts,
      graph: graphForStore,
      briefText: metadata.briefText,
      pending_actions: finalPendings,
      coaching_state: metadata.coaching_state,
      userMessage,
      assistantMessage,
      // A3 graph CAS: verbatim pass-through of the caller's server-read
      // expected-base hashes (undefined when the path is not instrumented).
      expectedGraphIdentityHash: metadata.expectedGraphIdentityHash,
      expectedGraphAnalysisHash: metadata.expectedGraphAnalysisHash,
      ...(atomicVersionPlan.kind === 'plan'
        ? { modelVersion: atomicVersionPlan.write }
        : {}),
    },
  });
  const persistedRowId = appendOutcome.id;

  // ⚠⚠ DEGRADE, NEVER THROW — THE WRITE IS ALREADY DURABLE HERE (C8-A review,
  // 2026-08-25). Both calls below run AFTER `store.append` and, until this
  // change, OUTSIDE the guarded block beneath them. Both can throw: the
  // construction runs `ModelVersionMutationReceiptV1LocalSchema.parse`, and the
  // attach runs a `.strict()` parse that rejects ANY unknown top-level key on
  // the response. A throw at this point does not roll anything back — it tells
  // a user their committed turn failed, which is the persisted-state invariant
  // inverted, and it is the same class as the pre-transaction telemetry defect
  // one step earlier in this function.
  //
  // Honest status: LATENT, not demonstrated. The review could not produce a
  // live supplier of an unknown top-level key today. It is guarded anyway
  // because the cost of being wrong is asymmetric — a missing receipt is a
  // degraded response the client already handles (the field is optional), while
  // a throw is a false failure report on durable state.
  //
  // The receipt is a REPORT about the write, never part of it, so omitting it
  // cannot corrupt anything. The turn result is unaffected.
  let publicModelVersionReceipt: ModelVersionMutationReceiptV1Local | null = null;
  let responseWithModelVersionReceipt = responseForCommit;
  try {
    publicModelVersionReceipt =
      appendOutcome.modelVersionReceipt === undefined
        ? null
        : toModelVersionMutationReceiptV1(
            metadata.scenario_id,
            appendOutcome.modelVersionReceipt,
          );
    responseWithModelVersionReceipt =
      publicModelVersionReceipt === null
        ? responseForCommit
        : attachModelVersionMutationReceipt(
            responseForCommit,
            publicModelVersionReceipt,
          );
  } catch (receiptErr) {
    // Reset BOTH, so a construction that succeeded and an attach that then
    // failed cannot leave the commit returning a receipt the response does not
    // carry — the two must agree or a consumer reading one and rendering the
    // other diverges.
    publicModelVersionReceipt = null;
    responseWithModelVersionReceipt = responseForCommit;
    log.warn(
      {
        scenario_id: metadata.scenario_id,
        turn_id: metadata.turn_id,
        turn_row_id: persistedRowId,
        err:
          receiptErr instanceof Error ? receiptErr.message : String(receiptErr),
      },
      'ModelManagement — model-version receipt could not be built or attached; ' +
        'the turn is COMMITTED and is returned without a receipt (report only, ' +
        'never part of the write)',
    );
  }

  // Post-success observability. The turn's state is now durably committed; the
  // telemetry below is best-effort and MUST NOT convert a successful persist
  // into a turn failure. `emit()`'s pre-Datadog path (sanitize / test sink /
  // pino) can throw on a pathological payload, and these emits fire AFTER the
  // irreversible append — so a throw here would invert the persisted-state
  // invariant (committed write surfaced to the caller as an error). Wrap the
  // whole block: a telemetry fault degrades to a log, never an error. (Datadog
  // transport is already independently guarded inside `emit()`.)
  try {
    // ModelManagement — the version SKIP, reported only now that the turn is
    // durable. Moved here from `buildAtomicCommittedModelVersion` (Codex C8-A
    // review defect 5): emitted at decision time it published the outcome of a
    // transaction that had not run, and stayed published when the append then
    // threw. Same rule as the pending-action emit below.
    if (atomicVersionPlan.kind === 'skip') {
      emit(TelemetryEvents.V5ModelVersionCreated, {
        scenario_id: metadata.scenario_id,
        turn_id: metadata.turn_id,
        status: 'skipped',
        skip_reason: atomicVersionPlan.reason,
        version_number: null,
        graph_identity_hash_prefix: null,
        error_code: null,
        provenance: 'commit',
      });
    }

    // V5 Coaching State Spine — Stage 2B-1b: post-success persistence telemetry.
    // Once per commit across the whole turn taxonomy. `coaching_state_present`
    // distinguishes turns that derived a snapshot (turn-executor / chip-click)
    // from those that legitimately did not (system events, route-v2 draft/edit)
    // — making missed write-site wiring visible in staging. Counts / closed-enum
    // status / SHA-prefix hashes / version / timing / turn_class only — no raw
    // content.
    const cs = metadata.coaching_state ?? null;
    emit(TelemetryEvents.V5CoachingStatePersisted, {
      scenario_id: metadata.scenario_id,
      turn_id: metadata.turn_id,
      turn_row_id: persistedRowId,
      turn_class: metadata.turn_class,
      coaching_state_present: cs !== null,
      status: cs?.status ?? null,
      signal_count: cs?.signals.length ?? 0,
      active_count: cs?.summary.active_count ?? 0,
      stale_count: cs?.summary.stale_count ?? 0,
      unavailable_count: cs?.summary.unavailable_count ?? 0,
      graph_hash: cs?.graph_hash ?? null,
      analysis_graph_hash: cs?.analysis_graph_hash ?? null,
      version: cs?.version ?? null,
      snapshot_timing: cs !== null ? 'pre_dispatch' : null,
    });

    // Telemetry fires AFTER write succeeds — never log a "created" event
    // for a pending action that was rolled back by an RPC failure.
    for (const pa of chipDerivedPending) {
      emit(TelemetryEvents.PendingActionCreated, {
        scenario_id: pa.scenario_id,
        turn_row_id: persistedRowId,
        pending_action_id: pa.id,
        kind: pa.action.kind,
        chip_id: pa.chip_id,
        expires_at_turn_count: pa.expires_at_turn_count,
        expires_at_iso: pa.expires_at_iso,
      });
    }
    if (finalPendings.length > 0) {
      log.debug(
        {
          scenario_id: metadata.scenario_id,
          turn_row_id: persistedRowId,
          // newly-created this turn vs carried forward from prior turns.
          // Track 2: carried_forward_count / cap_dropped_count are the POST-CAP
          // lifecycle values (what actually persisted), so they agree with
          // `pending_action_count`: new_pending + carried_forward ≤ cap, and the
          // cap-evicted survivors are attributed to cap_dropped (NOT counted as
          // carried forward). Previously this logged pre-cap `survivingPrior.length`.
          pending_action_count: finalPendings.length,
          new_pending_count: chipDerivedPending.length,
          carried_forward_count: pendingLifecycle.survivedCount,
          cap_dropped_count: pendingLifecycle.capDroppedCount,
          consumed_ref_count: (metadata.consumedPendingRefs ?? []).length,
          kinds: finalPendings.map((pa) => pa.action.kind),
        },
        'V5 commit — pending actions persisted with turn (incl. carry-forward)',
      );
    }
  } catch (telemetryErr) {
    // Persisted-state invariant: the turn is already committed. Degrade a
    // post-success telemetry fault to a warning and continue to the success
    // return — never rethrow. (Global `emit()` hardening is a separate
    // telemetry-infra lane; this guards the most sensitive boundary.)
    log.warn(
      {
        scenario_id: metadata.scenario_id,
        turn_row_id: persistedRowId,
        err: (telemetryErr as Error)?.message ?? String(telemetryErr),
      },
      'V5 commit — post-success telemetry failed after a durable persist; continuing',
    );
  }

  // ROADMAP 3.1 (CEE half) — decision-record capture hook
  // (UNCONDITIONAL — see the NO-DARK-LAUNCH note below). Fires ONLY after
  // the durable append succeeded AND this commit carries a successful
  // (non-noop) run_analysis fact — which covers BOTH producers (the routed
  // turn-executor path and chip-click run_analysis funnel through this
  // commit seam). Fire-and-forget under the same non-blocking contract as
  // the MM hook above: any capture failure logs and NEVER affects the turn
  // result. No qualifying fact ⇒ byte-identical commit path (no store
  // construction, no env reads —
  // pinned by commit-decision-record-hook.test.ts). The record's
  // graph_hash is the fact's OWN `graph_hash_at_run` (aag_v1-prefixed) —
  // the hash the handler computed from the exact snapshot the analysis ran
  // against (PR #411 object-identity discipline; no re-read, no re-hash).
  // NO-DARK-LAUNCH (Paul, 19 Jul): CEE_DECISION_RECORD_CAPTURE deleted (was
  // live `true` on staging); capture now runs whenever the qualifying fact exists.
  const decisionRecordFact = metadata.handler_facts.find(
    (f): f is RunAnalysisHandlerFact => isSuccessfulRunAnalysisFact(f),
  );
  if (decisionRecordFact !== undefined) {
    void recordDecisionRecordForCommit({
      scenarioId: metadata.scenario_id,
      turnId: metadata.turn_id,
      persistedRowId,
      fact: decisionRecordFact,
      // Guest pre-check reads scenarios.user_id via the store's optional
      // getScenarioOwner (structural ScenarioOwnerReader slice — keeps
      // the SessionStore import surface at its declared three files).
      sessionStore: store,
    });
  }

  // Context Architecture v2 — S4 rolling conversation summary. Fires after
  // the durable append, off the turn path, on EVERY commit — UNCONDITIONAL
  // since the O-2 activation (2026-07-20; the CEE_ROLLING_SUMMARY flag is
  // DELETED per the no-dark-launches ruling — rollback = code revert).
  // Fire-and-forget under the same non-blocking contract as the MM /
  // decision-record hooks above: every failure — store construction, RPC
  // error, summariser model timeout — is caught and logged; NOTHING
  // propagates to the turn result (pinned by
  // commit-rolling-summary-hook.test.ts). The summariser reads the FULL
  // persisted history via the store's readRecent (unclamped) and writes only
  // scenarios.rolling_summary via a MONOTONIC RPC (out-of-order writes no-op).
  // Concurrent commits for one scenario do NOT stampede: the maintainer is
  // per-scenario single-flight with latest-wins coalescing (Codex r2 fix 4b),
  // so a burst of commits runs one pass plus at most one rerun.
  void maintainRollingSummaryForCommit({
    scenarioId: metadata.scenario_id,
    turnId: metadata.turn_id,
    persistedRowId,
    // The store satisfies ConversationHistoryReader structurally (readRecent);
    // the rolling-summary module never imports SessionStore, keeping the
    // state-write-invariant import surface bounded.
    historyReader: store,
    // Best-effort deterministic-floor input: the brief supplied on this turn,
    // if any. Absent on most turns — the floor then degrades to the latest
    // user message, never empty.
    briefText: metadata.briefText,
  });

  const graphPersisted = writesGraph;
  return {
    persistedAnalysisGraphHash,
    persistedGraph: writesGraph ? graphForStore : null,
    modelVersionReceipt: appendOutcome.modelVersionReceipt ?? null,
    // F-HELD: the committed response (lapse notice attached / competing
    // suggestion chips suppressed when those seams fired; the SAME object as
    // the input on the untouched fast path). Callers that consume
    // `CommitResult.response` (the TurnExecutor commitTurn wrapper — the only
    // caller that threads `priorPendingActions`) surface it on the wire, so
    // wire copy == durable copy.
    response: responseWithModelVersionReceipt,
    performed: true,
    persisted_row_id: persistedRowId,
    graphPersisted,
    pendingLifecycle,
  };
}


/**
 * Compute a stable per-request hash for the `request_hash` column. The
 * column has a non-empty-string invariant at the schema level; the value is
 * informational — the idempotency key is `(scenario_id, turn_id)`, not the
 * hash. We cover the user-visible payload fields so two distinct messages
 * on the same scenario produce different hashes, useful for post-mortem
 * debugging.
 */
export function computeRequestHash(payload: OrchestratorTurnPayload): string {
  // v0.7.0 union: message-kind carries `.message`; system-event carries `.event`.
  // Both variants hash the variant-specific distinguishing fields so two
  // genuinely different turns produce distinct hashes (hash is informational,
  // not the idempotency key — that's `(scenario_id, turn_id)`).
  const variant =
    payload.kind === 'message'
      ? { kind: 'message' as const, message: payload.message }
      : { kind: 'system_event' as const, event: payload.event };
  const canonical = JSON.stringify({
    scenario_id: payload.scenario_id,
    stage: payload.stage,
    ...variant,
  });
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  return `sha256:${digest}`;
}
