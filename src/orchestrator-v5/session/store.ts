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
}

export interface SessionStore {
  append(write: SessionTurnWrite): Promise<{ id: string }>;
  readRecent(scenarioId: string, limit?: number): Promise<readonly SessionTurn[]>;
  readFactsFor(turnIds: readonly string[], handlerId?: V5ActionType): Promise<readonly HandlerFact[]>;
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
