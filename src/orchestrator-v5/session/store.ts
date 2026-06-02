/**
 * V5 session store interface (slice B).
 *
 * Every V5 TurnExecutor commit writes through this; every build-turn-context
 * reads prior turns through this. Supabase is the authoritative source; the
 * LRU cache (see `cache.ts`) is derivative — on disagreement Supabase wins.
 *
 * `turn_id` is CLIENT-GENERATED and forms the idempotency key together with
 * `scenario_id`. The `append_turn_atomic` RPC has `UNIQUE (scenario_id,
 * turn_id)` with `ON CONFLICT DO NOTHING`, so two concurrent `append()` calls
 * carrying identical `(scenario_id, turn_id)` return the same row id and
 * neither errors. See Phase 0 audit §4.3.
 */

import type {
  ConversationTurnClass,
  HandlerFact,
  SessionTurn,
  V5ActionType,
} from '@talchain/schemas/orchestrator';
import type { InvalidationResult, InvalidationScope } from './invalidation.js';
import type { PendingAction } from './pending-action.js';
import type { HandlerFactWithTurn } from '../types/handler-fact.js';
import type { CoachingState } from '../coaching/coaching-state.js';
import type { CoachingStateSnapshot } from '../coaching/coaching-state-snapshot.js';

/**
 * Re-export so existing in-session callers (and `commit.ts` /
 * `build-turn-context.ts`) keep importing from `session/store.js` if
 * they prefer. The canonical definition lives in
 * `../types/handler-fact.ts` so leaf consumers (e.g.
 * `routing/proposed-change-synthesis.ts`) can import it without
 * crossing the state-write-invariant boundary.
 */
export type { HandlerFactWithTurn };

export interface SessionTurnWrite {
  readonly scenario_id: string;
  readonly turn_id: string;
  readonly turn_class: ConversationTurnClass;
  readonly handler_id: V5ActionType | null;
  readonly request_hash: string;
  readonly response_emitted: boolean;
  readonly llm_calls_used: number;
  readonly duration_ms: number;
  readonly handler_facts: readonly HandlerFact[];
  /**
   * When present, the graph JSONB is persisted to scenarios.graph atomically
   * with the turn insert inside append_turn_atomic. Both writes commit or roll
   * back together — no split-state risk. Omit for non-draft turns.
   */
  readonly graph?: unknown;
  /**
   * When present, the user-supplied free-text decision brief is persisted to
   * scenarios.brief_text atomically with the turn insert inside
   * append_turn_atomic.
   *
   * Write-once semantics: the RPC silently ignores subsequent writes
   * (`WHERE brief_text IS NULL OR brief_text = ''`) — first-write-wins.
   * Set on the first draft turn that supplies a non-null value; subsequent
   * repair / edit / regeneration turns may pass this field through but it
   * will NOT overwrite. Brief regeneration is out of scope for Phase 1.
   *
   * Distinct from scenarios.brief (JSONB DecisionBriefV1 — V4 residual /
   * future structured storage).
   *
   * Convention: `string | undefined` (omit when absent), not `string | null`.
   * Empty / whitespace-only strings should be normalised to undefined by
   * the caller via `normaliseBriefText` — the RPC's CHECK constraint
   * forbids whitespace-only values.
   */
  readonly briefText?: string;
  /**
   * Pending actions emitted alongside this turn's suggested-action chips.
   * Persisted atomically with the turn insert via
   * `append_turn_atomic(p_pending_actions)`. Capped at
   * `PENDING_ACTIONS_PER_TURN_CAP` (3); the DB CHECK enforces the same
   * cap. The next turn's deterministic short-confirm pre-route reads
   * these via `readMostRecentPendingActions` to resume offered actions
   * without an LLM round-trip. Omit (or pass `[]`) when the turn
   * offers no resumable actions.
   *
   * Pending actions live entirely server-side. They are NOT echoed
   * onto chips because the boundary `ActionSchema` is `.strict()` and
   * does not carry a `parameters` field. The link between a chip and
   * a pending action is the `PendingAction.chip_id` reference; the
   * resumer matches by short-confirm regex or by
   * `chip_metadata.action_type` (which the UI already round-trips).
   */
  readonly pending_actions?: readonly PendingAction[];
  /**
   * V5 Coaching State Spine — Stage 2B-1b: the internal Stage-2A `coaching_state`
   * derived at turn start (pre-dispatch), persisted to
   * `v5_conversation_turns.coaching_state` atomically with the turn insert via
   * `append_turn_atomic(p_coaching_state)`. The store wraps it in a
   * `CoachingStateSnapshot` envelope (`snapshot_timing: 'pre_dispatch'`) before
   * writing — see `coaching/coaching-state-snapshot.ts`.
   *
   * `null`/omitted writes `coaching_state = NULL` (the column is nullable, no
   * default) — used by paths that never derive a coaching state (system events,
   * the route-v2 draft/edit dispatch paths). Content-free: only closed-enum
   * signal codes + SHA-prefix hashes are persisted, never raw user content.
   */
  readonly coaching_state?: CoachingState | null;
}

export interface SessionStore {
  append(write: SessionTurnWrite): Promise<{ id: string }>;
  readRecent(scenarioId: string, limit?: number): Promise<readonly SessionTurn[]>;
  /**
   * Load handler facts for a set of prior conversation turns.
   *
   * **Important:** `conversationTurnRowIds` must be the `v5_conversation_turns.id`
   * row UUIDs (i.e. `SessionTurn.id`) — NOT the client-supplied `turn_id`
   * strings. `v5_handler_facts.v5_conversation_turn_id` is a foreign key to
   * the row `id`, and filtering against `turn_id` silently returns zero
   * rows. An earlier revision of this API was called with `turn_id` values
   * and produced empty results in production; renaming the parameter makes
   * the semantics loud at the call site.
   *
   * Results are ordered newest-first by `created_at DESC`. Callers that
   * need the most recent entry can rely on `.find()` selecting
   * deterministically.
   */
  readFactsFor(
    conversationTurnRowIds: readonly string[],
    handlerId?: V5ActionType,
  ): Promise<readonly HandlerFact[]>;
  /**
   * Variant of {@link readFactsFor} that pairs each fact with its
   * parent turn id and creation timestamp. The proposed-change
   * synthesis path uses this to gate idempotency by an explicit
   * schema-aligned ownership link rather than positional ordering
   * across `priorTurns` and `priorFacts`.
   *
   * Results are ordered newest-first by the fact's `created_at DESC`,
   * matching `readFactsFor`.
   *
   * Optional on the interface so existing test mocks aren't forced
   * to implement it; buildTurnContext falls back to an empty array
   * when absent. Production (`SupabaseSessionStore`) always
   * implements this.
   */
  readFactsWithTurnFor?(
    conversationTurnRowIds: readonly string[],
    handlerId?: V5ActionType,
  ): Promise<readonly HandlerFactWithTurn[]>;
  invalidateScoped(scenarioId: string, scope: InvalidationScope): Promise<InvalidationResult>;
  invalidateAll(scenarioId: string): Promise<InvalidationResult>;
  /**
   * Persist a draft graph to the scenarios.graph column via the
   * store_draft_graph RPC. Not on the critical V5 path — graph persistence
   * now happens atomically inside append_turn_atomic via SessionTurnWrite.graph.
   * Retained for out-of-band use (admin tooling, migrations). Throws
   * StateCommitFailedError on RPC failure.
   */
  storeDraftGraph(scenarioId: string, graph: unknown): Promise<void>;
  /**
   * Load the persisted graph from scenarios.graph for a given scenario.
   * Returns null if no graph is stored. Throws SessionReadError on DB/RPC failure.
   * Uses the same service-role client access pattern as storeDraftGraph (bypasses RLS).
   * Used by follow-up turns when the UI does not send graph_state in the
   * request body.
   *
   * @deprecated Prefer {@link loadGraphAndBriefText} which returns both the
   * graph and the persisted brief_text in one round trip. This wrapper is
   * retained for callers that only need the graph and have not yet been
   * migrated; it delegates to `loadGraphAndBriefText` and discards the brief.
   */
  loadGraph(scenarioId: string): Promise<unknown | null>;
  /**
   * Load both the persisted graph and the user-supplied brief_text from
   * the scenarios row in a single round trip.
   *
   * Returns `{ graph: null, briefText: null }` when no scenario row exists
   * for the given id. Empty-string `brief_text` is coerced to `null` so
   * callers never receive a value that fails the CHECK constraint or the
   * downstream `if (briefText)` truthy check. Throws SessionReadError on
   * any DB/RPC failure.
   *
   * Used by `build-turn-context.loadPersistedScenarioState` to populate
   * `EnrichedTurnContext.scenarioBriefText` so handlers (TurnExecutor,
   * chip-click-dispatch) can read the brief from canonical state instead
   * of an out-of-band option field.
   */
  loadGraphAndBriefText(scenarioId: string): Promise<{
    readonly graph: unknown | null;
    readonly briefText: string | null;
  }>;
  /**
   * Idempotently ensure a row exists in `public.scenarios` for `scenarioId`,
   * creating it with `userId` as the owner if absent. `userId` may be null
   * for guest sessions (VITE_AUTH_MODE=guest) — the row is created with a
   * NULL user_id in that case.
   *
   * Returns the AUTHORITATIVE `user_id` (as stored in `public.scenarios`).
   * Returns null for guest rows. Callers should skip the cross-tenant
   * ownership check when either the caller userId or the returned value
   * is null (no ownership concept in guest mode).
   *
   * Read/RPC failures propagate as `SessionReadError`. The pre-flight
   * treats those as "unknown" and fails-open (traffic continues; the
   * later `append_turn_atomic` is the last line of defence).
   *
   * ⚠ PoC security posture — trust-the-caller on `userId`. CEE's HTTP
   * ingress is API-key + HMAC authenticated service-to-service; there
   * is no end-user Supabase JWT reaching Postgres. The SECURITY DEFINER
   * RPC therefore has no way to verify `userId` independently — it
   * writes what the caller passes. Production upgrade: per-request
   * JWT-scoped client + an RPC that reads identity from `auth.uid()`.
   * See supabase/migrations/…_v5_ensure_scenario_exists.sql header.
   */
  ensureScenarioExists(scenarioId: string, userId: string | null): Promise<{ user_id: string | null }>;
  /**
   * Load the pending actions emitted by the most recent prior turn for a
   * scenario. Returns `[]` when no prior turn exists, when the most
   * recent turn carried no pending actions, or when a row's
   * `pending_actions` JSONB fails the read-side schema parse.
   *
   * Read scope is intentionally narrow: only the latest prior turn.
   * Older orphan pending actions are ignored — "yes" resolves only
   * against the last assistant turn's explicit actionable offer
   * (Wave 2 resumer enforces this). Filtered by `scenarioId` such
   * that cross-scenario resume is impossible.
   *
   * Read failures throw `SessionReadError`; callers should log
   * `session.read_degraded` telemetry and fall through to the
   * non-resume path rather than failing the turn.
   */
  readMostRecentPendingActions(scenarioId: string): Promise<readonly PendingAction[]>;
  /**
   * V5 Coaching State Spine — Stage 2B-1b: load the most recent NON-NULL
   * coaching-state snapshot for a scenario. Returns the parsed
   * `CoachingStateSnapshot` envelope, or `null` when no scenario row carries a
   * coaching state, the JSONB is malformed, or the read degraded.
   *
   * Read scope is intentionally narrow + bounded: the query filters
   * `coaching_state IS NOT NULL` and takes `ORDER BY created_at DESC LIMIT 1`,
   * so system-event / draft / edit turns that persist NULL do NOT reset the
   * prior snapshot, and no unbounded history scan occurs. Attached to
   * `EnrichedTurnContext.prior_coaching_state` by `buildTurnContext`.
   *
   * Optional on the interface so existing test mocks need not implement it;
   * `buildTurnContext` falls back to `null` when absent. Production
   * (`SupabaseSessionStore`) always implements it.
   */
  readMostRecentCoachingState?(scenarioId: string): Promise<CoachingStateSnapshot | null>;
}

/**
 * Thrown by commit stage when the Supabase RPC or any underlying DB operation
 * fails. TurnExecutor's existing try/catch at turn-executor.ts:223 catches this
 * and maps to `STATE_COMMIT_FAILED` → `INTERNAL_ERROR` wire code. BI-01 is
 * preserved because the failure envelope counts as a response.
 */
export class StateCommitFailedError extends Error {
  readonly rpc_code: string | undefined;

  constructor(message: string, opts?: { cause?: unknown; rpc_code?: string }) {
    super(message);
    this.name = 'StateCommitFailedError';
    this.rpc_code = opts?.rpc_code;
    if (opts?.cause !== undefined) {
      (this as unknown as { cause?: unknown }).cause = opts.cause;
    }
  }
}

/**
 * Thrown by `readRecent` / `readFactsFor` on Supabase errors. Caller
 * (build-turn-context) should log + emit `session.read_degraded` telemetry
 * and continue with an empty history — read failures are NOT fatal to the
 * turn.
 */
export class SessionReadError extends Error {
  readonly code: string | undefined;

  constructor(message: string, opts?: { cause?: unknown; code?: string }) {
    super(message);
    this.name = 'SessionReadError';
    this.code = opts?.code;
    if (opts?.cause !== undefined) {
      (this as unknown as { cause?: unknown }).cause = opts.cause;
    }
  }
}
