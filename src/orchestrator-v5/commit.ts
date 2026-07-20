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
import type { SessionStore } from './session/store.js';
import { repairGraphForPersistence } from './repair-graph-for-persistence.js';
import { normaliseOptionInterventionContract } from './normalise-option-interventions.js';
import { derivePendingActionsFromFinalizedChips } from './compose/derive-pending-actions.js';
import { applyEgressForbiddenPhraseGuard } from './compose/forbidden-user-facing-phrases.js';
import { sanitiseUserFacingText } from './compose/output-safety.js';
import { GraphV3, type GraphV3T } from '../schemas/cee-v3.js';
import type {
  PendingAction,
  PendingLifecycleSummary,
} from './session/pending-action.js';
import {
  CONFIRMATION_EXPECTING_ACTION_TYPES,
  isPendingActionExpired,
  PENDING_ACTIONS_PER_TURN_CAP,
} from './session/pending-action.js';
import type { SuggestedAction } from './compose/types.js';
import type { CoachingState } from './coaching/coaching-state.js';
import { emit, log, TelemetryEvents } from '../utils/telemetry.js';
import { emitContextTruncation } from './context/context-budget-telemetry.js';
import { config } from '../config/index.js';
import { getModelManagementService } from './model-management/index.js';
import type { ModelManagementResult, VersionWriteOutcome } from './model-management/index.js';
import { recordDecisionRecordForCommit } from './decision-records/capture.js';
import { maintainRollingSummaryForCommit } from './rolling-summary/capture.js';

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
  for (const pa of prior) {
    const key = pendingMatchKey(pa);
    if (consumed.has(key)) { consumedCount += 1; continue; } // 1. applied / dismissed
    if (
      thisTurnKeys.has(key)
      || (pa.action.kind === 'proposed_concept' && thisTurnHasFreshProposedConcept)
      || (pa.action.kind === 'draft_graph' && thisTurnHasFreshDraftOffer)
    ) { supersededCount += 1; continue; } // 2. superseded (same key, or fresher concept/offer capture)
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

function isCompetingRunAnalysisSuggestionChip(chip: SuggestedAction): boolean {
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
 * those paths). REMAINING wipe sharers (out of that lane's scope):
 * chip-click dispatch and system-event dispatch thread no priors.
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
  const initialChipDerivedPending =
    metadata.pending_actions === undefined
      ? derivePendingActionsFromFinalizedChips(
          (response.suggested_actions ?? []) as readonly SuggestedAction[],
          {
            scenario_id: metadata.scenario_id,
            emitted_at_iso: new Date().toISOString(),
            graph_hash: metadata.graph_hash,
          },
        )
      : metadata.pending_actions;

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
    metadata.graph_hash,
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
    metadata.graph_hash,
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

  // Track S 0.13c-4: persist-site intercept repair. This is the single chokepoint
  // for scenarios.graph writes (store.append's only caller). Strip any duplicate
  // observed-root intercept (intercept === observed_state.value) before the write,
  // closing the non-draft reintroduction path (set_factor_value / edit_graph /
  // proposal-apply) that the boundary repair and run_analysis guard do not cover.
  // No-op when no graph is written (system events, chip clicks, non-graph turns);
  // idempotent on already-repaired draft graphs. Reuses the #263/#269 predicate.
  const graphToPersist = repairGraphForPersistence(metadata.graph, {
    scenarioId: metadata.scenario_id,
    turnId: metadata.turn_id,
    turnClass: metadata.turn_class,
    source: metadata.handler_id ?? undefined,
  });

  // V5 edit_graph P0: normalise edit-added option interventions to the canonical
  // top-level OptionV3 contract before the write. An option from client-supplied
  // graph_state can persist interventions under node.data.interventions, which
  // GraphV3.safeParse strips on read (NodeV3 has no `data` field) — so the option
  // reaches run_analysis/PLoT with zero interventions (422 / options_not_configured).
  // Promoting them here makes the persisted record match draft-created options.
  // Runs alongside (independent of) the Track S intercept repair above: that
  // operates on factor observed-root intercepts, this on option intervention
  // bundles. No-op on draft/already-canonical options; fail-open; idempotent.
  const graphForStore = normaliseOptionInterventionContract(graphToPersist, {
    scenarioId: metadata.scenario_id,
    turnId: metadata.turn_id,
    turnClass: metadata.turn_class,
    source: metadata.handler_id ?? undefined,
  });

  const { id: persistedRowId } = await store.append({
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
  });

  // Post-success observability. The turn's state is now durably committed; the
  // telemetry below is best-effort and MUST NOT convert a successful persist
  // into a turn failure. `emit()`'s pre-Datadog path (sanitize / test sink /
  // pino) can throw on a pathological payload, and these emits fire AFTER the
  // irreversible append — so a throw here would invert the persisted-state
  // invariant (committed write surfaced to the caller as an error). Wrap the
  // whole block: a telemetry fault degrades to a log, never an error. (Datadog
  // transport is already independently guarded inside `emit()`.)
  try {
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

  // Lane 8 — Model Management version hook (CEE_MODEL_VERSIONS_ENABLED).
  // Fires ONLY after the durable append succeeded AND a graph was persisted
  // this commit. Fire-and-forget under the version-event-sink non-blocking
  // contract: any MM failure logs and NEVER affects the turn result. Flag
  // off ⇒ byte-identical commit path (no service construction, no env reads
  // — pinned by commit-model-version-hook.test.ts). The graph handed to MM
  // is `graphForStore` — the EXACT object the store just persisted — so the
  // Group A identity envelope MM computes (computeGraphIdentityHash inside
  // ModelManagementService.saveVersion) matches the store's own identity
  // read of scenarios.graph.
  if (config.cee.modelVersionsEnabled === true && graphWasProvided(metadata.graph)) {
    void recordModelVersionForCommit({
      scenarioId: metadata.scenario_id,
      turnId: metadata.turn_id,
      turnClass: metadata.turn_class,
      handlerId: metadata.handler_id,
      graph: graphForStore,
      persistedRowId,
      // MM P1 (ROADMAP 1.25, item 4 — racing-pointer fix): thread the SAME
      // server-read expected-base hash the A3 graph-CAS observe hook uses,
      // verbatim (null/undefined both collapse to "no expectation" —
      // service.saveVersion only accepts a string). See
      // recordModelVersionForCommit's doc comment for the bootstrap caveat.
      expectedGraphIdentityHash: metadata.expectedGraphIdentityHash ?? undefined,
      sessionStore: store,
    });
  }

  // ROADMAP 3.1 (CEE half) — decision-record capture hook
  // (CEE_DECISION_RECORD_CAPTURE). Fires ONLY after the durable append
  // succeeded AND this commit carries a successful (non-noop) run_analysis
  // fact — which covers BOTH producers (the routed turn-executor path and
  // chip-click run_analysis funnel through this commit seam). Fire-and-
  // forget under the same non-blocking contract as the MM hook above: any
  // capture failure logs and NEVER affects the turn result. Flag off ⇒
  // byte-identical commit path (no store construction, no env reads —
  // pinned by commit-decision-record-hook.test.ts). The record's
  // graph_hash is the fact's OWN `graph_hash_at_run` (aag_v1-prefixed) —
  // the hash the handler computed from the exact snapshot the analysis ran
  // against (PR #411 object-identity discipline; no re-read, no re-hash).
  // NO-DARK-LAUNCH (Paul, 19 Jul): CEE_DECISION_RECORD_CAPTURE deleted (was
  // live `true` on staging); capture now runs whenever the qualifying fact exists.
  const decisionRecordFact = metadata.handler_facts.find(
    (f): f is RunAnalysisHandlerFact => f.fact_type === 'run_analysis' && f.noop === false,
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

  const graphPersisted = graphWasProvided(metadata.graph);
  return {
    // F-HELD: the committed response (lapse notice attached / competing
    // suggestion chips suppressed when those seams fired; the SAME object as
    // the input on the untouched fast path). Callers that consume
    // `CommitResult.response` (the TurnExecutor commitTurn wrapper — the only
    // caller that threads `priorPendingActions`) surface it on the wire, so
    // wire copy == durable copy.
    response: responseForCommit,
    performed: true,
    persisted_row_id: persistedRowId,
    graphPersisted,
    pendingLifecycle,
  };
}

/**
 * MM P1 (ROADMAP 1.25 hygiene batch, item 2): true when a `saveVersion`
 * result is the EXPECTED "guest scenario, no version history" outcome
 * (SQLSTATE MV001 / error code `sign_in_required`) rather than a genuine MM
 * fault.
 *
 * `sign_in_required` fires on EVERY commit for an unowned (guest) scenario
 * — `scenarios.user_id IS NULL` (D3 Branch A, "guests refused" — see
 * `supabase/migrations/20260705120000_v5_model_versions.sql`). That is the
 * DESIGNED, EXPECTED outcome for guest traffic, not a fault: logging it at
 * `warn` meant every guest commit logged a warning for behaviour working
 * exactly as specified, drowning out genuine MM faults (`store_error`, real
 * CAS conflicts). `recordModelVersionForCommit` uses this to demote that
 * one case to `debug` — every other error/conflict status stays `warn`
 * (still actionable).
 */
export function isExpectedGuestVersionRefusal(
  result: ModelManagementResult<VersionWriteOutcome>,
): boolean {
  return result.status === 'error' && result.error.code === 'sign_in_required';
}

/**
 * Lane 8 — commit-seam Model Management version hook (flag-gated caller).
 *
 * Non-blocking contract (mirrors version-event-sink.ts): every failure —
 * service construction (missing SUPABASE_* env), RPC error, telemetry fault
 * — is caught and logged at warn (except the expected guest-refusal case,
 * see `isExpectedGuestVersionRefusal`); nothing propagates to the turn
 * result. Idempotency: `event_id` is DETERMINISTIC on the turn id, so a
 * retried turn (same scenario_id + turn_id) re-drives the same journey
 * event, which the RPC dedupes by event_id; an identical graph additionally
 * no-op-dedupes against the current head inside the RPC.
 *
 * MM P1 (ROADMAP 1.25, item 2 completion — Brief H guest pre-check): before
 * spending the `saveVersion` RPC, do a plain read of `scenarios.user_id`
 * (`SessionStore.getScenarioOwner`, when the store implements it) and skip
 * the RPC entirely when the scenario is unowned (guest). `saveVersion`
 * ALWAYS fails `sign_in_required` (MV001) for a guest scenario — this was
 * previously a wasted RPC round trip on every guest commit. The pre-check
 * is best-effort: a missing implementation, a read failure, or a scenario
 * row that no longer exists all fail OPEN to the pre-fix behaviour (attempt
 * the write; let the RPC answer MV001 authoritatively) rather than silently
 * skip a version write that might actually be owned.
 *
 * MM P1 (ROADMAP 1.25, item 4 — racing-pointer fix): when the caller
 * threaded an `expectedGraphIdentityHash` (the SAME server-read pre-turn
 * base the A3 graph-CAS observe hook uses), pass it through to
 * `saveVersion`'s optional write-time CAS. The RPC then rejects the write
 * with a `cas_conflict` (MV409) if the scenario's current MM version head
 * no longer matches that base — catching two concurrent commits racing the
 * `current_model_version_id` pointer forward from the same starting point.
 * KNOWN BOOTSTRAP CAVEAT (documented, not fixed here — a DB-migration-class
 * change, out of scope for this hygiene batch): the RPC's CAS compares
 * against the scenario's MM version HEAD, not `scenarios.graph` itself; for
 * a scenario with pre-existing graph history whose FIRST MM-tracked commit
 * carries a non-empty expected hash, the RPC sees no head yet (`v_head IS
 * NULL`) and raises the same MV409 — a false conflict, not a real race.
 * This degrades exactly like any other non-ok status here: logged at warn,
 * turn result unaffected, no version row written for that turn. Filed as a
 * residual for a future MM-hardening lane (mirrors ROADMAP 2.17).
 */
async function recordModelVersionForCommit(args: {
  readonly scenarioId: string;
  readonly turnId: string;
  readonly turnClass: ConversationTurnClass;
  readonly handlerId: V5ActionType | null;
  readonly graph: unknown;
  readonly persistedRowId: string;
  readonly expectedGraphIdentityHash?: string;
  readonly sessionStore: SessionStore;
}): Promise<void> {
  try {
    if (typeof args.sessionStore.getScenarioOwner === 'function') {
      try {
        const owner = await args.sessionStore.getScenarioOwner(args.scenarioId);
        if (owner === null) {
          log.debug(
            { scenario_id: args.scenarioId, turn_id: args.turnId },
            'ModelManagement — commit-seam saveVersion skipped pre-emptively (guest scenario, sign-in required; expected, not a fault)',
          );
          return;
        }
      } catch (precheckErr) {
        // Fail OPEN: an unreadable owner is not evidence of guest status —
        // fall through to the real RPC, which answers authoritatively.
        log.debug(
          {
            scenario_id: args.scenarioId,
            turn_id: args.turnId,
            err: precheckErr instanceof Error ? precheckErr.message : String(precheckErr),
          },
          'ModelManagement — guest pre-check read failed; proceeding to saveVersion (fail-open)',
        );
      }
    }
    const service = getModelManagementService();
    const result = await service.saveVersion({
      scenario_id: args.scenarioId,
      graph: args.graph,
      // Content-free label from turn context (handler id / turn class only).
      label: `commit:${args.handlerId ?? args.turnClass}`,
      provenance: 'commit',
      event_id: `model_version_created_turn_${args.turnId}`,
      ...(args.expectedGraphIdentityHash !== undefined
        ? { expected_graph_identity_hash: args.expectedGraphIdentityHash }
        : {}),
    });
    emit(TelemetryEvents.V5ModelVersionCreated, {
      scenario_id: args.scenarioId,
      turn_id: args.turnId,
      turn_row_id: args.persistedRowId,
      status:
        result.status === 'ok'
          ? result.value.deduped
            ? 'deduped'
            : 'ok'
          : result.status,
      version_number: result.status === 'ok' ? result.value.version_number : null,
      graph_identity_hash_prefix:
        result.status === 'ok' ? result.value.graph_identity_hash.slice(0, 16) : null,
      error_code: result.status === 'error' ? result.error.code : null,
      provenance: 'commit',
    });
    if (result.status === 'error' || result.status === 'conflict') {
      const isExpectedGuestRefusal = isExpectedGuestVersionRefusal(result);
      const logPayload = {
        scenario_id: args.scenarioId,
        turn_id: args.turnId,
        status: result.status,
        error_code: result.status === 'error' ? result.error.code : 'cas_conflict',
      };
      if (isExpectedGuestRefusal) {
        log.debug(
          logPayload,
          'ModelManagement — commit-seam saveVersion skipped (guest scenario, sign-in required; expected, not a fault)',
        );
      } else {
        log.warn(
          logPayload,
          'ModelManagement — version event sink emit failed (commit-seam saveVersion returned non-ok; turn result unaffected)',
        );
      }
    }
  } catch (err) {
    log.warn(
      {
        scenario_id: args.scenarioId,
        turn_id: args.turnId,
        err: err instanceof Error ? err.message : String(err),
      },
      'ModelManagement — version event sink emit failed (commit-seam version hook threw; turn result unaffected)',
    );
  }
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
