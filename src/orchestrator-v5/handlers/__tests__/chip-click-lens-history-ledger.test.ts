/**
 * ⭐ A5 — a Run after 20 quiet turn rows still knows the lens it showed last time (DL 0df0e1, 5 Oct; lease
 * `output/rc-00351a/A5-LEASE.md`, reader 3).
 *
 * The no-immediate-repeat lens tie-break replays the prior Runs (`derivePreviousAnalysisLens`). The chip Run handed it
 * the 20-row window only, so once the previous Run had left it the replay had no history and the next Run could show
 * the same lens again. The Run now hands it the window as before (`priorTurnFactsForLensHistory`, which the POSITIONAL
 * judgement signals also read) and, on its own input, the scenario's authoritative Run history (`lensReplayRuns`, read
 * by the lens replay only, in persisted order — Codex #2572 r1/r2: never merged Run by Run into the window).
 * That the replay alternates when it HAS the prior Run is pinned in `compose/__tests__/lens-history.test.ts`
 * ("turn 2 … ships the PRE-MORTEM lens"); this file pins the seam that feeds it.
 *
 * Harness: `chip-click-dispatch-stage-authority.test.ts` (every mock spreads the real module).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

const { turn, lensHistories } = vi.hoisted(() => ({
  turn: { window: [] as unknown[], durable: undefined as unknown },
  lensHistories: [] as unknown[],
}));

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>('../../build-turn-context.js');
  return {
    ...actual,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'Run analysis' }], session_id: SCENARIO_ID, request_id: 'req-lens',
      budgets: { turn_ms: 30000, handler_ms: 20000, plot_ms: 15000, anthropic_ms: 15000, openai_ms: 15000 },
      prior_turns: [], prior_facts: turn.window, scenario_analysis_fact_set: turn.durable,
      scenarioBriefText: null, persistedGraph: null,
    })),
  };
});
vi.mock('../../compose.js', async () => {
  const actual = await vi.importActual<typeof import('../../compose.js')>('../../compose.js');
  return {
    ...actual,
    composeToolCallResponse: (input: { priorTurnFactsForLensHistory?: unknown; lensReplayRuns?: unknown }) => {
      if (input.priorTurnFactsForLensHistory !== undefined) {
        lensHistories.push({ window: input.priorTurnFactsForLensHistory, history: input.lensReplayRuns });
      }
      return actual.composeToolCallResponse(input as never);
    },
  };
});
vi.mock('../../commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../commit.js')>('../../commit.js');
  return { ...actual, commitDirectAnswer: vi.fn(async (r: unknown) => ({ response: r, performed: true, persisted_row_id: 'row-lens-1', graphPersisted: false })) };
});
vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: vi.fn(async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts),
}));

const { dispatchChipClickRunAnalysis } = await import('../chip-click-dispatch.js');
const { reconcileScenarioAnalysisFacts, SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT } = await import('../../context/reconcile-scenario-analysis-facts.js');
import type { HandlerFn, HandlerRegistry } from '../../tools/registry.js';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa25';
const PRIOR: HandlerFact = {
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: SCENARIO_ID, leading_option_id: 'opt_a', summary: 'The Run before 20 quiet rows.',
    computed_at: '2026-10-05T00:05:04.173Z', enrichment: { analysis_status: 'computed' } },
} as HandlerFact;
const PRIOR_ROW = { fact_row_id: 'row-prior', fact_created_at: '2026-10-05T00:05:04.200Z' };
const EDIT = { fact_type: 'set_factor_value', fact_version: 1, noop: false, result: { node_id: 'f' } } as unknown as HandlerFact;
const durableWith = (hot: readonly HandlerFact[]) => reconcileScenarioAnalysisFacts({
  scenarioId: SCENARIO_ID, hotWindowFacts: hot,
  hotWindowFactsWithIdentity: hot.filter((f) => f === PRIOR).map((fact) => ({ fact, ...PRIOR_ROW, turn_id: 'turn-prior' })),
  durableRead: { status: 'ok', scenario_id: SCENARIO_ID, query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT, total_count: 1, facts: [{ fact: PRIOR, ...PRIOR_ROW }] },
});
const registry = (): HandlerRegistry => new Map<V5ActionType, HandlerFn>([['run_analysis', (() => Promise.resolve({
  assistant_text: 'Ran analysis.', llm_calls_used: 0,
  handler_facts: [{ fact_type: 'run_analysis' as const, fact_version: 1, noop: false,
    result: { scenario_id: SCENARIO_ID, leading_option_id: 'opt_a', win_probabilities: { opt_a: 0.7, opt_b: 0.3 }, summary: 'Done.', enrichment: {} } }],
})) as unknown as HandlerFn]]);
const runOnce = async () => {
  lensHistories.length = 0;
  const out = await dispatchChipClickRunAnalysis({
    payload: makeMessagePayload({ scenario_id: SCENARIO_ID, turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb25', stage: 'analyse',
      message: 'Run the analysis.', turn_class: 'decide', source: 'chip_click', chip: { action_type: 'run_analysis' } }),
    requestId: 'req-lens', handlerRegistry: registry(),
  });
  expect(out.outcome, 'the composed success exit').toBe('ok');
  // The Run composes more than once; exactly one compose threads the lens history (the others pass none).
  expect(lensHistories).toHaveLength(1);
  return lensHistories[0] as { window: readonly HandlerFact[]; history: readonly HandlerFact[] | undefined };
};

beforeEach(() => { turn.window = []; turn.durable = undefined; });

describe('the chip Run\'s lens history is the scenario\'s Runs, not only the 20-row window', () => {
  it('PRECONDITION: the durable set is reasoning authority with the prior Run in or out of the window', () => {
    expect(durableWith(Array.from({ length: 20 }, () => EDIT)).status).toBe('complete');
    expect(durableWith([EDIT, PRIOR]).status).toBe('complete');
  });

  it('RED: the prior Run has left the window → the lens replay receives the scenario\'s Runs, which hold it', async () => {
    const window = Array.from({ length: 20 }, () => EDIT);
    turn.window = window; turn.durable = durableWith(window);
    expect((await runOnce()).history).toEqual([PRIOR]);
  });

  it('RED (Codex #2572 P2): …and the positional input the judgement signals read is the window itself, untouched', async () => {
    const window = Array.from({ length: 20 }, () => EDIT);
    turn.window = window; turn.durable = durableWith(window);
    expect((await runOnce()).window).toBe(window);
  });

  it('CONTROL: the prior Run still in the window → the same Run once, from the authoritative history; the window untouched', async () => {
    const window = [EDIT, PRIOR];
    turn.window = window; turn.durable = durableWith(window);
    const out = await runOnce();
    expect(out.window).toBe(window);
    expect(out.history).toEqual([PRIOR]);
  });

  it('CONTROL: no durable authority → no history of its own: the replay reads the window (today, fail-safe)', async () => {
    turn.window = [EDIT];
    const out = await runOnce();
    expect(out.window).toEqual([EDIT]);
    expect(out.history).toBeUndefined();
  });
});
