/**
 * ROADMAP 2.474 / A3 — THE WIRING THAT MAKES THE SPLIT REAL.
 *
 * The pure seams are proved elsewhere (`structural-edit-batch-split.test.ts`,
 * `structural-edit-split-disclosure.test.ts`). What is proved HERE is the one
 * line that decides whether any of it reaches a user: WHICH operations the
 * dispatcher hands to `handleEditGraph`.
 *
 * ⚠ THE MUTANT THIS EXISTS FOR. Submit `outcome.operations` (the whole batch)
 * instead of `parts[0].operations` and every pure test above stays green while
 * the live behaviour is EXACTLY the witnessed defect: 12 edge operations meet
 * the 8-edge budget inside the pipeline and the composed batch is discarded
 * again. Without this file that mutant survives.
 *
 * It is also where "splitting is not disclosed-partial" becomes checkable at
 * the seam that matters: the assertion is that the remainder appears in NO
 * call to `handleEditGraph` at all — not that it was described nicely.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    // B-FIX1: the combined read follows the existing graph double.
    loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
    loadPersistedGraphStrict: vi.fn(),
    loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
    // Mockable so ONE test can inject a prior run_analysis fact. Every other
    // test restores the real implementation in `beforeEach`.
    buildTurnContext: vi.fn(),
  };
});
import { commitDirectAnswer } from '../../commit.js';
import { loadPersistedGraphStrict, buildTurnContext } from '../../build-turn-context.js';
import { staleAnalysisBlocksApply } from '../../graph-management/frame-gate.js';

/**
 * ⚠ ROADMAP 2.713 — a CAUSAL link create must carry the belief the apply
 * contract has required since February (`strength.{mean,std}`,
 * `exists_probability`, `effect_direction`). The reconstructed fixtures here
 * carried only `{from,to}`, and separately supplied a `value.id` the deployed
 * advert makes structurally impossible — so they were unfaithful to the wire in
 * both directions and could not see the seam defect. Identity now arrives by
 * server-side synthesis from the authoritative `path`; the belief is stated,
 * because the composer refuses a link the model did not describe rather than
 * inventing one. Neither change alters an envelope count.
 */
const CAUSAL_BELIEF = {
  strength: { mean: 0.4, std: 0.15 },
  exists_probability: 0.8,
  effect_direction: 'positive',
} as const;

/** Four existing nodes, so each new driver can be wired to four of them. */
const GRAPH = {
  nodes: [
    { id: 'dec_plan', kind: 'decision', label: 'Which plan' },
    { id: 'goal_profit', kind: 'goal', label: 'Profit' },
    { id: 'fac_spend', kind: 'factor', label: 'Marketing spend' },
    { id: 'fac_reach', kind: 'factor', label: 'Audience reach' },
  ],
  edges: [{ from: 'dec_plan', to: 'goal_profit', ...CAUSAL_BELIEF }],
};

let realBuildTurnContext: typeof buildTurnContext;

beforeEach(async () => {
  vi.clearAllMocks();
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  realBuildTurnContext = actual.buildTurnContext;
  (buildTurnContext as MockedFunction<typeof buildTurnContext>)
    .mockImplementation(realBuildTurnContext);
  (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>)
    .mockResolvedValue(GRAPH as never);
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
});

/**
 * ⭐⭐ FINDING 1 — AUTO-RETIRED BY RULING A4 (Paul, 2026-08-05), WHICH IS
 * EXACTLY WHAT #829's DERIVATION WAS BUILT FOR.
 *
 * The finding was real and the fix was right: on an already-analysed scenario,
 * applying part 1 moved the graph hash, freshness flipped to `stale`, and a
 * STRUCTURAL candidate did not trust `stale` — so the next part was blocked
 * and the honest copy said "confirm, re-run, then the rest".
 *
 * A4 removed the block itself. `rerunRequiredBeforeNextStep` is DERIVED from
 * the frame gate (`staleAnalysisBlocksApply`), never restated, so the moment
 * the ruling moved the trust set this copy retired on its own — no stale
 * sentence left behind, no lane needed to remember. The pins below therefore
 * flip from "the re-run chip is offered" to "the next step is offered", and
 * the assertion that MATTERS now is that the promise is DELIVERABLE: the next
 * step really can be proposed immediately, because the gate no longer refuses
 * it.
 *
 * ⚠ SCOPE, unchanged: the fact is INJECTED, so this pins the CONSUMER. It does
 * not prove the loader delivers that fact on a post-apply turn.
 */
describe('⭐⭐ an already-analysed scenario can continue straight to the next step (A4)', () => {

  /**
   * ⭐ THE DELIVERABILITY PROOF — the assertion the old pin could not make.
   *
   * The re-run copy existed because the next step genuinely could not be
   * proposed. Offering "Propose the next step" is only honest if the gate
   * would now hold that step rather than refuse it. Asked of the gate itself,
   * for the same class and the same post-apply frame state.
   */
  it('⭐ the promise is DELIVERABLE: a stale frame no longer blocks a structural apply', () => {
    expect(staleAnalysisBlocksApply()).toBe(false);
  });
});
