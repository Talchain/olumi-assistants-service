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
   * Group 3 P0 follow-up: caller user_id for cross-tenant enforcement.
   * When present AND config.features.v5CrossTenantEnforcement is true, the
   * store uses `append_turn_atomic_v2` which asserts `scenarios.user_id =
   * p_user_id` in SQL. When absent or the flag is off, the store uses the
   * legacy `append_turn_atomic` (no ownership check). Optional so existing
   * tests and non-enforced flows continue to work unchanged.
   */
  readonly caller_user_id?: string;
}

export interface SessionStore {
  append(write: SessionTurnWrite): Promise<{ id: string }>;
  readRecent(scenarioId: string, limit?: number): Promise<readonly SessionTurn[]>;
  readFactsFor(turnIds: readonly string[], handlerId?: V5ActionType): Promise<readonly HandlerFact[]>;
  invalidateScoped(scenarioId: string, scope: InvalidationScope): Promise<InvalidationResult>;
  invalidateAll(scenarioId: string): Promise<InvalidationResult>;
  /**
   * Returns true when a row exists in `public.scenarios` with `id = scenarioId`.
   * Used by the V2 route's pre-flight check (Task A) to surface a missing
   * scenario as a typed 422 at ingress rather than letting `append_turn_atomic`
   * surface it as an opaque `STATE_COMMIT_FAILED` at commit. Read failures
   * propagate as `SessionReadError` — callers treat them as "unknown" and
   * should fail-closed on ambiguity (the pre-flight treats a read error as
   * "pass" so an outage doesn't block traffic; the later RPC will still fail
   * loudly if the row is genuinely missing).
   *
   * ⚠ Does NOT enforce caller ownership — see checkScenarioOwnership for
   * the user-scoped variant (Group 3 P0 follow-up).
   */
  checkScenarioExists(scenarioId: string): Promise<boolean>;
  /**
   * Group 3 P0 follow-up: caller-scoped existence check. Returns true iff
   * the scenario exists AND belongs to `callerUserId`. Returns false for
   * both "missing" and "foreign owner" without distinguishing — the
   * distinction would leak ownership information across tenants.
   *
   * Requires the 20260422000000_v5_cross_tenant_enforcement.sql migration
   * to be applied; otherwise the RPC call throws and the route's
   * preflight treats it as a transient error and passes. Callers should
   * only invoke this method when config.features.v5CrossTenantEnforcement
   * is true.
   */
  checkScenarioOwnership(scenarioId: string, callerUserId: string): Promise<boolean>;
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
