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
  V5ActionType,
} from '@talchain/schemas/orchestrator';

import type {
  InvalidationResult,
  InvalidationScope,
} from '../invalidation.js';
import type {
  SessionAppendResult,
  SessionStore,
  SessionTurnWrite,
} from '../store.js';
import type { PendingAction } from '../pending-action.js';
import type { SessionTurnWithContent } from '../conversation-content.js';

export interface NoopSessionStoreOptions {
  readonly appendId?: string;
  // V5 Conversation Context Reliability: accept the content-bearing superset so
  // tests can inject user_message / assistant_message. Plain SessionTurn[] is
  // still assignable (content fields are optional).
  readonly priorTurns?: readonly SessionTurnWithContent[];
  readonly facts?: readonly HandlerFact[];
  readonly loadGraphResult?: unknown | null;
  /**
   * V5 Phase 1 brief persistence: scenarios.brief_text returned by
   * loadGraphAndBriefText. Defaults to null (no persisted brief).
   */
  readonly loadBriefTextResult?: string | null;
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
  /**
   * V5 Wave 1 pending-action persistence: pending actions returned by
   * `readMostRecentPendingActions`. Defaults to empty (no offer
   * available to resume).
   */
  readonly mostRecentPendingActions?: readonly PendingAction[];
  /**
   * MM P1 (ROADMAP 1.25 hygiene batch, item 2 completion): controls whether
   * this fixture implements the OPTIONAL `getScenarioOwner` member at all,
   * and what it returns/throws.
   *
   *  - `undefined` (default) — the member is OMITTED from the returned
   *    object, exercising the "older store, no pre-check available"
   *    fail-open path callers must support.
   *  - `{ value }` — implements the member, resolving to `value` (a
   *    `user_id` string, or `null` for a guest/unowned/absent scenario).
   *  - `{ throws }` — implements the member, rejecting with `throws`.
   */
  readonly getScenarioOwnerBehaviour?:
    | { readonly value: string | null }
    | { readonly throws: Error };
}

export function createNoopSessionStore(
  opts: NoopSessionStoreOptions = {},
): SessionStore {
  // Double-conformance guard: see file header for rationale. The declared
  // return type above catches missing members; `satisfies` below catches
  // excess members on the inline literal. `getScenarioOwner` is OPTIONAL
  // on `SessionStore` (added after this fixture shipped) and is attached
  // conditionally below the literal — see `getScenarioOwnerBehaviour`.
  const store = {
    async append(write: SessionTurnWrite): Promise<SessionAppendResult> {
      if (opts.throwOnAppend) throw opts.throwOnAppend;
      return {
        id: opts.appendId ?? 'noop-row-id',
        ...(write.graph != null
          ? { graph_write_disposition: 'accepted_insert' as const }
          : {}),
      };
    },
    async readRecent(
      _scenarioId: string,
      _limit?: number,
    ): Promise<readonly SessionTurnWithContent[]> {
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
      // Noop — tests that care about graph retrieval can inject a concrete
      // graph via loadGraphResult. Returning null by default mirrors the
      // "no graph stored" branch of the real Supabase-backed implementation.
      return opts.loadGraphResult ?? null;
    },
    async loadGraphAndBriefText(_scenarioId: string): Promise<{
      readonly graph: unknown | null;
      readonly briefText: string | null;
    }> {
      // V5 Phase 1 brief persistence noop: tests that care about
      // canonical-state reads inject a concrete brief via
      // loadBriefTextResult. Returning null defaults mirrors the
      // "no scenario row / no brief stored" branch.
      return {
        graph: opts.loadGraphResult ?? null,
        briefText: opts.loadBriefTextResult ?? null,
      };
    },
    async readMostRecentPendingActions(_scenarioId: string) {
      return opts.mostRecentPendingActions ?? [];
    },
  } satisfies SessionStore;

  if (opts.getScenarioOwnerBehaviour !== undefined) {
    const behaviour = opts.getScenarioOwnerBehaviour;
    (store as SessionStore).getScenarioOwner = async (
      _scenarioId: string,
    ): Promise<string | null> => {
      if ('throws' in behaviour) throw behaviour.throws;
      return behaviour.value;
    };
  }

  return store;
}
