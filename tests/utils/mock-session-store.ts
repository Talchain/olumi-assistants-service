/**
 * Shared COMPLETE SessionStore test double (ROADMAP 1.148).
 *
 * WHY THIS EXISTS — the hand-maintained-mirror trap. Every integration
 * suite used to hand-roll its own `getSessionStore()` object literal.
 * Each time the real `SessionStore` interface gained a method
 * (`readMostRecentPendingActions`, `loadGraph`, `loadGraphAndBriefText`,
 * `hasPriorTurns`, …) every hand-rolled mock silently lacked it: the
 * live code degraded ("store.readMostRecentPendingActions is not a
 * function" warn-spam) or fail-closed 500'd (`store.loadGraph is not a
 * function` — the D1 merge-base guard), and the suites went red for
 * reasons that had nothing to do with what they were testing.
 *
 * THE FIX — derive, don't mirror. `createMockSessionStore()` returns an
 * object whose type is checked against the REAL `SessionStore` interface
 * (including its optional members), so when the interface gains a
 * required method the typecheck fails LOUDLY here — one place — instead
 * of a dozen suites drifting dark. Tests override only what they need.
 *
 * Usage inside a `vi.mock` factory (spread the real module so exports
 * like `SessionReadError` / `StateCommitFailedError` / constants stay
 * real — same derive-don't-mirror rule at the module level):
 *
 *   vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
 *     const original = await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>();
 *     const { createMockSessionStore } = await import('../utils/mock-session-store.js');
 *     return {
 *       ...original,
 *       getSessionStore: () => createMockSessionStore({ append: async (w) => { ... } }),
 *       resetSessionStoreForTests: () => {},
 *     };
 *   });
 */

import type { SessionStore } from '../../src/orchestrator-v5/session/store.js';
import type { SessionTurnWithContent } from '../../src/orchestrator-v5/session/conversation-content.js';

/**
 * A complete, benign-default SessionStore: empty reads, null graphs,
 * successful writes. Every REQUIRED interface method is implemented and
 * every OPTIONAL method is implemented too (so tests exercise the
 * "store supports it" branch by default, matching production
 * SupabaseSessionStore which implements them all).
 *
 * The `satisfies`-style annotation below is the drift alarm: add a
 * method to `SessionStore` without updating this helper and `tsc`
 * (typecheck-drift ratchet / advisory suites) fails HERE, loudly.
 */
export function createMockSessionStore(
  overrides: Partial<SessionStore> = {},
): SessionStore {
  const complete: Required<SessionStore> = {
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_scenarioId, scope) => ({
      scope,
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async (_scenarioId, userId) => ({ user_id: userId }),
    getScenarioOwner: async () => null,
    readMostRecentPendingActions: async () => [],
    readMostRecentCoachingState: async () => null,
    hasPriorTurns: async () => false,
  };
  return { ...complete, ...overrides };
}

/**
 * A COMPLETE `SessionTurnWithContent` row for `readRecent` mocks.
 *
 * The vendored `SessionTurnSchema` is `.strict()`-parsed on the read
 * path and the ContextPack projection requires `handler_id` +
 * `created_at`; hand-rolled partial rows ({ id, turn_class, turn_id })
 * fail that validation and silently drop the prior turn — the exact
 * mirror-drift this helper family exists to end. Defaults describe a
 * prior `run_analysis` handler turn (the common fixture); override any
 * field. The SessionTurn biconditional (`turn_class === 'handler'` ⇔
 * `handler_id !== null`) is the caller's responsibility when
 * overriding either field.
 */
export function makeSessionTurnRow(
  overrides: Partial<SessionTurnWithContent> = {},
): SessionTurnWithContent {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    scenario_id: '88888888-8888-4888-8888-888888888888',
    user_id: null,
    turn_id: 'prior-turn-id',
    turn_class: 'handler',
    handler_id: 'run_analysis',
    request_hash: 'sha256:prior',
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 100,
    created_at: '2026-05-04T00:00:00.000Z',
    ...overrides,
  };
}
