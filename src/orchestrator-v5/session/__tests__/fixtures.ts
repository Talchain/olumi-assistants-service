/**
 * Test fixtures for the V5 session module.
 *
 * The noop store satisfies the full `SessionStore` interface without
 * touching Supabase. Use it in unit tests that exercise code calling into
 * the store but don't care about persistence semantics (e.g. the existing
 * build-turn-context / commit unit tests).
 *
 * Dedicated session-store behaviour tests inject their own stubs.
 */

import type {
  HandlerFact,
  SessionTurn,
  V5ActionType,
} from '@talchain/schemas/orchestrator';

import type {
  InvalidationResult,
  InvalidationScope,
} from '../invalidation.js';
import type { SessionStore, SessionTurnWrite } from '../store.js';

export interface NoopSessionStoreOptions {
  readonly appendId?: string;
  readonly priorTurns?: readonly SessionTurn[];
  readonly facts?: readonly HandlerFact[];
  readonly throwOnRead?: Error;
  readonly throwOnAppend?: Error;
  /**
   * Owner `user_id` returned by `ensureScenarioExists`. Defaults to echoing
   * back the caller-supplied `userId`, which makes the pre-flight pass the
   * ownership check. Override to a different UUID to simulate cross-tenant
   * attempts.
   */
  readonly scenarioOwnerUserId?: string;
  readonly throwOnEnsureScenarioExists?: Error;
}

export function createNoopSessionStore(
  opts: NoopSessionStoreOptions = {},
): SessionStore {
  return {
    async append(_: SessionTurnWrite): Promise<{ id: string }> {
      if (opts.throwOnAppend) throw opts.throwOnAppend;
      return { id: opts.appendId ?? 'noop-row-id' };
    },
    async readRecent(_scenarioId: string, _limit?: number): Promise<readonly SessionTurn[]> {
      if (opts.throwOnRead) throw opts.throwOnRead;
      return opts.priorTurns ?? [];
    },
    async readFactsFor(
      _turnIds: readonly string[],
      _handlerId?: V5ActionType,
    ): Promise<readonly HandlerFact[]> {
      return opts.facts ?? [];
    },
    async invalidateScoped(
      _scenarioId: string,
      scope: InvalidationScope,
    ): Promise<InvalidationResult> {
      return { scope, entries_invalidated: [] };
    },
    async invalidateAll(_scenarioId: string): Promise<InvalidationResult> {
      return { scope: { kind: 'structural' }, entries_invalidated: [] };
    },
    async ensureScenarioExists(
      _scenarioId: string,
      userId: string,
    ): Promise<{ user_id: string }> {
      if (opts.throwOnEnsureScenarioExists) throw opts.throwOnEnsureScenarioExists;
      return { user_id: opts.scenarioOwnerUserId ?? userId };
    },
    async storeDraftGraph(_scenarioId: string, _graph: unknown): Promise<void> {
      // Noop — tests that care about persistence inject their own stub.
    },
  };
}
