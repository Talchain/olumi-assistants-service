/**
 * Test fixtures for the V5 session module.
 *
 * The noop store satisfies the full `SessionStore` interface without
 * touching Supabase. Use it in unit tests that exercise code calling into
 * the store but don't care about persistence semantics (e.g. the existing
 * build-turn-context / commit unit tests).
 *
 * Dedicated session-store behaviour tests inject their own stubs.
 *
 * ## Interface-conformance guard
 *
 * The factory below uses BOTH an explicit `: SessionStore` return type
 * AND a `satisfies SessionStore` clause on the returned object literal.
 * This is deliberate belt-and-suspenders hardening:
 *
 *   - The return type annotation catches MISSING members (TS2741).
 *     Demonstrated in April 2026 when `loadGraph` was added to the
 *     `SessionStore` interface without updating this fixture — the build
 *     typecheck on `claude/v5-followup-turn-fixes` failed exactly here.
 *
 *   - The `satisfies` clause additionally catches EXCESS members that
 *     don't belong to `SessionStore` (e.g. a leftover method from a
 *     removed interface), which a declared return type alone does NOT
 *     flag for inline object literals.
 *
 * Any future addition to the `SessionStore` interface should therefore
 * immediately surface as a compile error in this file, not slip through
 * to a runtime failure in downstream tests that use the noop store.
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
  // Double-conformance guard: see file header for rationale. The declared
  // return type above catches missing members; `satisfies` below catches
  // excess members on the inline literal.
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
    async loadGraph(_scenarioId: string): Promise<unknown | null> {
      // Noop — tests that care about graph retrieval inject their own stub.
      // Returning null mirrors the "no graph stored" branch of the real
      // Supabase-backed implementation so callers exercise the
      // graph-absent code path by default. See
      // src/orchestrator-v5/session/store.ts for the interface contract.
      return null;
    },
  } satisfies SessionStore;
}
