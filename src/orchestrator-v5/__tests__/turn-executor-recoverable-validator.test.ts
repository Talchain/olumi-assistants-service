/**
 * V5 alpha hardening Phase 2.2 — TurnExecutor recoverable-validator tests.
 *
 * Two coverage goals:
 *
 *  1. **Pinned regression for ENTITY_KIND_MISMATCH** (brief 2.2):
 *     Sonnet proposes `run_analysis` on a decision-kind node → validator
 *     returns ENTITY_KIND_MISMATCH → response is product-voice (no internal
 *     terms) → commit succeeds → HTTP 200 → chip is conversational
 *     (never executable Run-analysis when the proposal was malformed).
 *
 *  2. **Commit-failure-per-recoverable-code** (correction 10):
 *     For each of the 7 ValidationErrorCodes, force `commitDirectAnswer`
 *     to throw. Assert:
 *       - `failure_type === 'STATE_COMMIT_FAILED'` (→ HTTP 500 at the
 *         route-v2 boundary)
 *       - `commit_performed === false`
 *       - Two distinct log records exist: `v5.recoverable_outcome_pre_commit_failure`
 *         (warn) and `v5.state_commit_failed` (error). Commit-failure on a
 *         recoverable path must NOT hide the original recoverable outcome.
 */

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';



import { log,setTestSink } from '../../utils/telemetry.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

// Shared session-store mock — tests can flip `appendShouldThrow` to
// simulate commit failure on the recoverable path.
let appendShouldThrow: Error | null = null;
const appendCalls: Array<unknown> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      if (appendShouldThrow) throw appendShouldThrow;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));













// Proposals that trigger each validator code. Kind-independent codes only
// need a structural shape; graph-dependent codes (ENTITY_NOT_FOUND,
// ENTITY_RESOLUTION_SUSPICIOUS, PRECONDITION_UNMET, plus the cross-check
// variant of ENTITY_KIND_MISMATCH) need a graph.






// NOTE: run_analysis has NO parameter_schemas declared in
// HANDLER_VALIDATION_REGISTRY (it takes the scenario as its implicit
// target). That makes `PARAMETER_INVALID` currently unreachable through
// the production registry — the validator silently accepts any extra
// parameters when no schema is declared. The per-code composer exists
// for forward-compatibility, and the composer-level tests cover its text
// output. Once a second registered handler declares a parameter schema,
// this test suite should add a commit-failure case for it.













// AMENDED (run_analysis TARGET REPAIR). This fixture previously carried
// `opt_a`. It no longer may: an ADMITTED `run_analysis` whose entity fails on
// kind is now retargeted to an option and revalidated, because run_analysis's
// entity is a proxy for the whole scenario rather than a real target. With an
// option present the proposal below is REPAIRED and this case stops exercising
// the graph-dependent ENTITY_KIND_MISMATCH branch it exists for.
//
// The branch itself is unchanged; only the raw material for the repair is
// removed. The invariant is asserted below rather than left to this comment,
// because a comment cannot fail (CLAUDE.md trap 12 — derive or fail loud,
// never rely on a note someone must remember).
const GRAPH_KIND_CROSSCHECK: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    // Target of PROPOSAL_KIND_MISMATCH_GRAPH — resolves to wire kind 'node'.
    { id: 'fac_x', kind: 'factor', label: 'Factor X' },
  ],
  edges: [],
} as GraphStateIngress;



// One entry per validator code. Each case is a minimal shape that
// definitely triggers the given error. Graph-dependent codes supply a
// graph; structural codes omit it.


type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  appendShouldThrow = null;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setTestSink(null);
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('TurnExecutor — recoverable validator outcomes (Phase 2.2)', () => {
  it('FIXTURE INVARIANT: the cross-check graph carries NO option, or run_analysis is repaired instead of refused', () => {
    // Not decoration. Add an option back to GRAPH_KIND_CROSSCHECK and the
    // graph-dependent ENTITY_KIND_MISMATCH case silently becomes a passing
    // run — the parameterised case would then be asserting a code that the
    // turn no longer produces. This REDs first and names the reason.
    expect(
      GRAPH_KIND_CROSSCHECK.nodes.some((n) => (n as { kind?: string }).kind === 'option'),
    ).toBe(false);
    // Contrast control, same fixture: the factor target IS present, so the
    // case is not passing merely because the graph is empty.
    expect(
      GRAPH_KIND_CROSSCHECK.nodes.some((n) => (n as { id?: string }).id === 'fac_x'),
    ).toBe(true);
  });




});
