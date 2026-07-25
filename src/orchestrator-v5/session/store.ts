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
  V5ActionType,
} from '@talchain/schemas/orchestrator';
import type { InvalidationResult, InvalidationScope } from './invalidation.js';
import type { PendingAction } from './pending-action.js';
import type { HandlerFactWithTurn } from '../types/handler-fact.js';
import type { CoachingState } from '../coaching/coaching-state.js';
import type { CoachingStateSnapshot } from '../coaching/coaching-state-snapshot.js';
import type { SessionTurnWithContent } from './conversation-content.js';

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
  /**
   * V5 Conversation Context Reliability: the user's verbatim turn message
   * (boundary `payload.message`), persisted to
   * `v5_conversation_turns.user_message` via `append_turn_atomic_v2`
   * (`p_user_message`). The next turn's ContextPack projects it into
   * `conversation.recent_turns[].user_message` so the LLM can resolve
   * follow-ups ("Why?", "the second one"). Length-capped by the caller
   * (`commitDirectAnswer`) before write — there is no DB CHECK, so an
   * over-long value can never fail the commit. `undefined`/omitted writes
   * NULL (system / internal-event turns that carry no user text).
   */
  readonly userMessage?: string;
  /**
   * V5 Conversation Context Reliability: the FINAL public assistant answer
   * for this turn (`OlumiResponse.assistant_text` — the egress-validated,
   * user-visible prose), persisted to `v5_conversation_turns.assistant_message`
   * via `append_turn_atomic_v2` (`p_assistant_message`). NEVER raw LLM output,
   * hidden summaries, or blocked content — `assistant_text` is what the user
   * saw. Derived inside `commitDirectAnswer` from the composed response and
   * length-capped there. `undefined`/omitted writes NULL.
   */
  readonly assistantMessage?: string;
  /**
   * A3 graph CAS observe-mode: full identity hash (64-hex,
   * `computeGraphIdentityHash`) of the SERVER-SIDE persisted graph read at
   * turn start — the trusted expected base the pre-RPC CAS evaluation
   * compares against the current `scenarios.graph`.
   *
   * TRUSTED BASE RULE: this must derive ONLY from a server-side persisted
   * read (`buildTurnContext`'s scenarios read, or edit-graph-dispatch's
   * `loadPersistedGraphStrict`). NEVER from request-supplied `graph_state` —
   * that may be the very graph being written, and a CAS that validates the
   * write against itself always "matches".
   *
   * Convention: `undefined` = this write path is not instrumented (no server
   * base read; categorised `no_expected`, never a conflict). `null` = a
   * server base read happened but the graph was absent / identity-empty /
   * unparseable. Mirrors `CommitMetadata.expectedGraphIdentityHash`.
   */
  readonly expectedGraphIdentityHash?: string | null;
  /**
   * A3 graph CAS observe-mode: analysis-affecting hash (16-hex,
   * `computeAnalysisAffectingGraphHash`) of the same server-read base as
   * `expectedGraphIdentityHash`. Used to downgrade an identity mismatch to
   * `cosmetic_concurrent_edit` when the analysis projection did not move.
   * Same undefined/null convention as `expectedGraphIdentityHash`.
   */
  readonly expectedGraphAnalysisHash?: string | null;
}

export interface SessionStore {
  append(write: SessionTurnWrite): Promise<{ id: string }>;
  // V5 Conversation Context Reliability: returns the content-bearing superset
  // (user_message / assistant_message re-attached after the vendored strict
  // parse). SessionTurnWithContent ⊇ SessionTurn, so existing consumers that
  // treat the result as SessionTurn[] are unaffected; only the ContextPack
  // conversation projection reads the new fields.
  readRecent(scenarioId: string, limit?: number): Promise<readonly SessionTurnWithContent[]>;
  /**
   * The PRE-CAP number of conversation turns stored for this scenario — how
   * many rows `v5_conversation_turns` holds, before {@link readRecent}'s
   * `LIMIT` throws the older ones away.
   *
   * This exists because `readRecent` returns a WINDOW and the ContextPack was
   * reporting that window's length as the conversation's total length. On a
   * 78-turn scenario the pack said `turn_count: 20` and the coach told the
   * user, verbatim, "Total turn count on record for this conversation is 20"
   * (live probe, build `f00b8ef`, 2026-07-25). The three window numbers agreed
   * with each other and were jointly false, so no conformance check could see
   * it. Same defect shape as the decision-record cap fixed in #690, one table
   * over.
   *
   * DELIBERATELY A SEPARATE READ, not a `count: 'exact'` rider on the
   * `readRecent` SELECT: that SELECT does not run on every turn. The LRU cache
   * short-circuits it whenever `cached.turns.length >= limit`, which is
   * precisely the beyond-window case this number exists to describe — so a
   * count carried on that query would be absent or stale exactly when it
   * matters, and cacheing + incrementing it on write would make it a
   * hand-maintained mirror of the table. This is one indexed COUNT per turn,
   * derived from the source of truth every time.
   *
   * MUST throw rather than return an approximation: the caller degrades to
   * "total unknown" and suppresses the total, which is honest. A silent
   * fallback to the window length would reproduce the exact falsehood.
   *
   * Optional on the interface so existing test mocks aren't forced to
   * implement it (mirrors {@link readFactsWithTurnFor}); buildTurnContext
   * treats absence as "total unknown". Production (`SupabaseSessionStore`)
   * always implements it.
   */
  countTurns?(scenarioId: string): Promise<number>;
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
   * MM P1 (ROADMAP 1.25 hygiene batch, item 2 completion — Brief H guest
   * pre-check): plain read-only lookup of `scenarios.user_id`, WITHOUT the
   * upsert/ownership-comparison side effects of `ensureScenarioExists`.
   * Used by the commit-seam Model Management version hook
   * (`commit.ts::recordModelVersionForCommit`) to skip the `saveVersion`
   * RPC entirely for a guest (unowned) scenario — that RPC always fails
   * `sign_in_required` (MV001) for `user_id IS NULL`, so calling it is a
   * wasted round trip on every guest commit.
   *
   * Returns the scenario's `user_id` (null for guest / unowned rows, or
   * when the scenario row does not exist — both read as "cannot version,
   * skip the write"). Optional on the interface (added after the original
   * ship) so pre-existing test doubles that don't implement it keep
   * compiling; callers MUST treat a missing implementation the same as a
   * read failure — fail-open to the pre-fix behaviour (attempt the RPC,
   * let it answer MV001 authoritatively) rather than block the write.
   *
   * Read failures throw `SessionReadError`, mirroring the other plain
   * reads on this interface; the commit-seam caller catches and fails
   * open (same non-blocking contract as every other step in that hook).
   */
  getScenarioOwner?(scenarioId: string): Promise<string | null>;
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
  /**
   * V5 Signature Loop — refresh-continuation discriminator. Returns `true` iff
   * the scenario already has at least one committed turn. Cheapest possible
   * read: `SELECT 1 ... LIMIT 1` (existence only, no data transfer). Used by the
   * route-level continuation guard to distinguish a refresh / reconnection of an
   * existing decision (same scenario_id, prior turns exist → treat as
   * continuation, read server-side memory) from a brand-new decision (fresh
   * scenario_id, 0 prior turns → draft / frame as before).
   *
   * Read failures throw `SessionReadError`; the bounded loader degrades to
   * `false` (do NOT suppress the draft/frame shortcut on an uncertain read).
   *
   * Optional on the interface so existing test mocks need not implement it; the
   * bounded loader falls back to `false` when absent. Production
   * (`SupabaseSessionStore`) always implements it.
   */
  hasPriorTurns?(scenarioId: string): Promise<boolean>;
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
 * A3 graph CAS — enforce mode ONLY. Thrown by `SupabaseSessionStore.append()`
 * BEFORE the append_turn_atomic_v2 RPC when the pre-write evaluation
 * categorises the write as `analysis_affecting_conflict` and
 * CEE_V5_GRAPH_CAS_MODE='enforce' (non-prod only — prod auto-downgrades to
 * observe). No other category is ever enforced; observe mode never throws.
 *
 * Extends StateCommitFailedError so every existing TurnExecutor
 * `instanceof StateCommitFailedError` catch maps it onto the existing typed
 * failure envelope (STATE_COMMIT_FAILED → INTERNAL_ERROR) — no route or wire
 * shape change. This is app-side, best-effort blocking with a
 * SELECT-then-write TOCTOU window, NOT an atomicity guarantee.
 */
export class GraphStaleWriteError extends StateCommitFailedError {
  /** Closed-enum conflict category from graph-cas-conflict.ts. */
  readonly conflict_category: string;
  /**
   * F4 — the identity hash of the base graph the rejected write was built on
   * (the caller's stale base). Non-sensitive identity fingerprint; carried
   * onto the 409 envelope so the UI can surface what it had before it refreshes
   * canonical state and reconfirms. Undefined when no expected base was
   * supplied (e.g. an app-side categorisation with no incoming hash).
   */
  readonly expected_base_graph_hash: string | undefined;

  constructor(
    message: string,
    opts: {
      conflict_category: string;
      cause?: unknown;
      expected_base_graph_hash?: string;
    },
  ) {
    super(message, { cause: opts.cause });
    this.name = 'GraphStaleWriteError';
    this.conflict_category = opts.conflict_category;
    this.expected_base_graph_hash = opts.expected_base_graph_hash;
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
