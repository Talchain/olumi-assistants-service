/**
 * ROADMAP 2.1085 (root 2.1041) / golden-journey EXT-2 — the ROUTED half of "every analyse
 * path emits a typed readiness state".
 *
 * The chip-click half shipped NOTHING (see
 * `handlers/__tests__/chip-click-dispatch-blocked-readiness.test.ts`). This
 * half is the mirror defect, and it is the more dangerous of the two: the
 * routed (Sonnet-orientated) analyse turn takes the SAME recoverable-handler
 * branch, but `analysisReadyForTurn` was computed from the PRE-DISPATCH graph
 * and is never revised, so the wire ships
 *
 *     analysis_ready.status === 'ready'
 *
 * on a turn where CEE REFUSED to run the analysis. Present-but-false is worse
 * than absent: a consumer reading it concludes the run was admitted.
 *
 * CLAUDE.md trap 21 — a harm closed by one PR and re-opened by its neighbour
 * will not show up in either PR's tests. Both exits are pinned here, in one
 * change, against ONE authority.
 */

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';



import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { log,setTestSink } from '../../utils/telemetry.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

let appendShouldThrow: Error | null = null;
const appendCalls: Array<unknown> = [];
let persistedGraphForTest: GraphStateIngress | null = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      if (appendShouldThrow) throw appendShouldThrow;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    loadGraphAndBriefText: async () => ({ graph: persistedGraphForTest, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));









/**
 * A graph whose STRUCTURAL readiness is `ready` — both options carry encoded
 * numeric interventions on the node. This is the shape that makes the routed
 * defect visible: without the fix the refused turn ships `status: 'ready'`.
 */
const READY_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'dec_1', kind: 'decision', label: 'Choose an option' },
    // A status-quo level (inside the options' 0.3–0.7 scale, as #2177 gave this factor in the admission-verdict spec). Since
    // #2164 an unvalued goal root is a factor-scoped `MISSING_FACTOR_LEVEL` that refuses the Run, so without it this
    // graph is not structurally `ready` and the FENCE/CONTROL/TWIN rows lose their premise. NOT_READY_GRAPH below
    // carries the same level, so the interventions stay the ONLY difference between the two.
    { id: 'fac_licence', kind: 'factor', label: 'Annual CRM Licence Cost', observed_state: { value: 0.5 } },
    { id: 'opt_a', kind: 'option', label: 'A', interventions: { fac_licence: 0.7 } },
    { id: 'opt_b', kind: 'option', label: 'B', interventions: { fac_licence: 0.3 } },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_1', to: 'opt_b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_a', to: 'fac_licence', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_b', to: 'fac_licence', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_licence', to: 'goal_1', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { fac_licence: { value: 0.7 } } },
    { id: 'opt_b', status: 'ready', interventions: { fac_licence: { value: 0.3 } } },
  ],
} as unknown as GraphStateIngress;







/** The mixed-scale gate's exact throw (run-analysis.ts:533). */


/**
 * An `add_constraint` proposal that passes validation, so the handler is
 * actually INVOKED and gets the chance to throw. Shape copied from
 * `journey-3-and-6-envelope-contract.test.ts`, which drives the same handler
 * through the same executor.
 */


/**
 * The twin's own payload. A graph-mutating handler executes only on an
 * affirmative MUTATION WARRANT (INV-1), so "run the analysis" would leave
 * `add_constraint` held for confirmation and the handler would never be
 * invoked — the test would then pass while asserting nothing. This message
 * carries the warrant, and `_nonAnalyseHandlerInvoked` proves it worked.
 */


/** Observability for the twin's precondition assertion. */
let _nonAnalyseHandlerInvoked = false;

/**
 * A NON-analyse handler that throws a cause which IS on
 * `RECOVERABLE_HANDLER_CAUSES` — exactly what `d1-shared/error-boundary.ts`
 * produces for a `PARAMETER_INVALID` D1 error
 * (`CAUSE_BY_D1_CODE.PARAMETER_INVALID === 'parameter_invalid_at_execute'`).
 */


/** A successful handler — the CONTROL arm. */


let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  appendCalls.length = 0;
  appendShouldThrow = null;
  persistedGraphForTest = READY_GRAPH;
  _nonAnalyseHandlerInvoked = false;
  setTestSink(() => {});
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setTestSink(null);
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});



/**
 * THE P0 MEASURED ON STAGING, 18 Aug 2026 — and the seam ONE PAST the helper.
 *
 * The core two-turn journey failed on 4 of 13 runs. Turn 1 drafted a healthy
 * model (`goal:1`, `option:4`, `goal_node_id: "378f195a"`); turn 2 routed to the
 * analyse handler, the handler correctly refused (`MISSING_OPTION_VALUE` — a
 * fresh draft's options carry no effect values), and the refusal REPLACED the
 * turn's structural readiness with the present-but-empty carrier. The user's
 * goal and every option identity vanished, on a turn whose own `graph_hash` was
 * IDENTICAL to the drafting turn's.
 *
 * The FENCE above pins the reviewers' case and uses `READY_GRAPH`, where the
 * empty carrier is correct. This block pins the OTHER half, on a graph whose
 * structural readiness is NOT ready — the journey's real shape.
 *
 * ⭐ WHY THIS LIVES HERE AND NOT ONLY BESIDE THE HELPER. The helper's own unit
 * spec proves the RULE; it cannot prove the rule is WIRED. Measured: a mutant
 * that deletes the `analysisReadyForTurn` argument at the call site
 * (turn-executor.ts, the `ANALYSE_HANDLER_ID` branch) restores the P0 exactly,
 * typechecks clean, and leaves the helper's 7-spec suite fully GREEN. That
 * survivor is the whole reason for this block — a guard is correct at the seam
 * it guards and the defect lives one seam past it (P1).
 */
describe('the P0 — a refused analyse turn must not erase a model the same turn just read', () => {
  /**
   * The journey's real shape: a complete, connected model whose options carry
   * NO effect values, so structural readiness is non-`ready` while the model
   * itself is entirely legible. Same skeleton as `READY_GRAPH` with the
   * interventions removed, so the ONLY difference between this fixture and the
   * FENCE's is the one the rule turns on.
   */
  const NOT_READY_GRAPH: GraphStateIngress = {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'dec_1', kind: 'decision', label: 'Choose an option' },
      // The same status-quo level as READY_GRAPH, so the ONLY difference stays the interventions (see its note).
      { id: 'fac_licence', kind: 'factor', label: 'Annual CRM Licence Cost', observed_state: { value: 0.5 } },
      { id: 'opt_a', kind: 'option', label: 'A' },
      { id: 'opt_b', kind: 'option', label: 'B' },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_licence', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_b', to: 'fac_licence', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_licence', to: 'goal_1', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
  } as unknown as GraphStateIngress;

  it('PRECONDITION: the fixture really is structurally NOT ready and really does name the model', () => {
    // Pinned IN-TEST (trap 13b). Without this the assertions below could pass
    // because the projection found nothing rather than because the rule fired,
    // and the fixture — not the code — would be doing the discriminating.
    const structural = buildCanonicalAnalysisReadyFromGraph(NOT_READY_GRAPH);
    expect(structural).toBeDefined();
    expect(structural!.status).not.toBe('ready');
    expect(structural!.goal_node_id).toBe('goal_1');
    expect(structural!.options.map((o) => o.option_id).sort()).toEqual(['opt_a', 'opt_b']);
    // And the FENCE's fixture really is the opposite, or the two blocks are
    // pinning the same case twice.
    expect(buildCanonicalAnalysisReadyFromGraph(READY_GRAPH)!.status).toBe('ready');
  });






});
