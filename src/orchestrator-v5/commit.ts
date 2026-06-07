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
import type { ConversationTurnClass, HandlerFact, V5ActionType } from '@talchain/schemas/orchestrator';

import { getSessionStore } from './session/index.js';
import type { SessionStore } from './session/store.js';
import { derivePendingActionsFromFinalizedChips } from './compose/derive-pending-actions.js';
import type { PendingAction } from './session/pending-action.js';
import type { SuggestedAction } from './compose/types.js';
import type { CoachingState } from './coaching/coaching-state.js';
import { emit, log, TelemetryEvents } from '../utils/telemetry.js';

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
  const chipDerivedPending =
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
    graph: metadata.graph,
    briefText: metadata.briefText,
    pending_actions: chipDerivedPending,
    coaching_state: metadata.coaching_state,
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
    if (chipDerivedPending.length > 0) {
      log.debug(
        {
          scenario_id: metadata.scenario_id,
          turn_row_id: persistedRowId,
          pending_action_count: chipDerivedPending.length,
          kinds: chipDerivedPending.map((pa) => pa.action.kind),
        },
        'V5 commit — pending actions persisted with turn',
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

  const graphPersisted = metadata.graph !== undefined;
  return { response, performed: true, persisted_row_id: persistedRowId, graphPersisted };
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
