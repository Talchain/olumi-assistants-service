/**
 * TurnExecutor × run_analysis — C2 regression through Phase 1 seven-step flow.
 *
 * Same C2 invariants as before the routing refactor, but now dispatched via
 * the new tool-use seam instead of the classifier:
 *
 *   - Happy path: run_analysis fact persists, assistant_text is the typed
 *     confirmation template, BI-01 preserved, llm_calls accounting correct
 *   - HandlerInvocationFailedError path: PLoT error, scenarioReader failure,
 *     analysis_status=blocked → HANDLER_INVOCATION_FAILED → INTERNAL_ERROR;
 *     commit NOT performed; BI-01 preserved
 *   - HandlerResultInvalidError path: forced Zod safeParse failure →
 *     HANDLER_RESULT_INVALID → INTERNAL_ERROR; no partial persistence
 *   - Constraint 7: outer budget wins over inner handler error
 *
 * The new seam (tool-use) is mocked via an injected routingAdapter. The
 * handler registry is built with real createRegistry(overrides) so the
 * run_analysis handler is exercised end-to-end against mocked PLoT + stubbed
 * scenarioReader.
 */

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';



import { setTestSink } from '../../utils/telemetry.js';

// Session store mock — capture append() calls for fact-round-trip assertions.
// priorTurnRows / priorFactRows are mutable so individual tests can seed a
// prior run_analysis turn (ROADMAP 2.73 rerun coverage); default empty.
const appendCalls: Array<unknown> = [];
const priorTurnRows: Array<unknown> = [];
const priorFactRows: Array<unknown> = [];
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => priorTurnRows,
    readFactsFor: async () => priorFactRows,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
}));






// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------



















// ---------------------------------------------------------------------------
// Telemetry sink
// ---------------------------------------------------------------------------

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];
function installSink(): void {
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
}
function uninstallSink(): void {
  setTestSink(null);
}


beforeEach(() => {
  appendCalls.length = 0;
  priorTurnRows.length = 0;
  priorFactRows.length = 0;
  events = [];
  installSink();
});

afterEach(() => {
  uninstallSink();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// HandlerInvocationFailedError paths
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// HandlerResultInvalidError path
// ---------------------------------------------------------------------------

describe('turn-executor × run_analysis via tool-use — HandlerResultInvalidError path', () => {
  it('constant wire mapping: HANDLER_RESULT_INVALID + HANDLER_INVOCATION_FAILED both map to INTERNAL_ERROR', async () => {
    const { INTERNAL_TO_WIRE } = await import('../types.js');
    expect(INTERNAL_TO_WIRE.HANDLER_RESULT_INVALID).toBe('INTERNAL_ERROR');
    expect(INTERNAL_TO_WIRE.HANDLER_INVOCATION_FAILED).toBe('INTERNAL_ERROR');
  });


});

// ---------------------------------------------------------------------------
// Constraint 7 — BUDGET_EXCEEDED wins over handler errors
// ---------------------------------------------------------------------------
