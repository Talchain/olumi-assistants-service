/**
 * ⭐ A5 — A BOARD VALUE EDIT KNOWS THE MODEL WAS ANALYSED AFTER 20 QUIET TURN ROWS (DL 0df0e1, 5 Oct; lease
 * `output/rc-00351a/A5-LEASE.md`, reader 2).
 *
 * The value-edit writer decides "the last analysis is now out of date" from the Runs it is handed. The dispatch handed
 * it the 20-row turn window only, so once 20 rows passed with no Run (≈12 min of board edits at a demo's pace) the reply
 * dropped the sentence while the same response's badge, which reads the durable set, still said stale. The writer now
 * gets the window plus every ledger Run the window has lost (`run-ledger.ts`).
 *
 * Harness: the sibling `factor-value-edit-freshness-branch.test.ts` (same mocks, each spreading the real module).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

const mocks = vi.hoisted(() => ({
  applyFactorValueEdit: vi.fn(),
  loadScenarioAnalysisFactsForRead: vi.fn(),
  loadPersistedGraphStrict: vi.fn(),
  commitDirectAnswer: vi.fn(),
}));

vi.mock('../factor-value-edit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../factor-value-edit.js')>()),
  applyFactorValueEdit: mocks.applyFactorValueEdit,
}));
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  loadScenarioAnalysisFactsForRead: mocks.loadScenarioAnalysisFactsForRead,
  loadPersistedGraphStrict: mocks.loadPersistedGraphStrict,
}));
vi.mock('../../commit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commit.js')>()),
  commitDirectAnswer: mocks.commitDirectAnswer,
}));

import { dispatchSystemEvent } from '../dispatch.js';
import { reconcileScenarioAnalysisFacts, SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT } from '../../context/reconcile-scenario-analysis-facts.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05';
const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Service quality' },
    { id: 'factor_capex', kind: 'factor', label: 'Capital expenditure', observed_state: { value: 0.4, raw_value: 40, cap: 100 } },
  ],
  edges: [{ from: 'factor_capex', to: 'goal', kind: 'causal' }],
  goal_node_id: 'goal',
};
const payload = (): SystemEventTurnPayload => ({
  kind: 'system_event', scenario_id: SCENARIO_ID, turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05', stage: 'analyse',
  event: { kind: 'factor_value_edit', target_id: 'factor_capex', value: 40, field: 'value' },
}) as unknown as SystemEventTurnPayload;

/** One successful Run, the shape the durable read validates. */
const RUN: HandlerFact = {
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: SCENARIO_ID, leading_option_id: 'opt_a', summary: 'The Run before 20 board edits.',
    computed_at: '2026-10-05T00:05:04.173Z', enrichment: { analysis_status: 'computed' } },
} as HandlerFact;
/** A board edit's fact: what fills the 20-row window between Runs. */
const EDIT = { fact_type: 'set_factor_value', fact_version: 1, noop: false, result: { node_id: 'factor_capex' } } as unknown as HandlerFact;

/** The Run's ONE persisted identity, named by the window and the durable read alike (production maps priorFacts from
 *  priorFactsWithTurn, so the window's fact object IS the identified one). */
const RUN_ROW = { fact_row_id: 'row-run', fact_created_at: '2026-10-05T00:05:04.200Z' };
const durableWith = (facts: readonly HandlerFact[], hotWindowFacts: readonly HandlerFact[]) => reconcileScenarioAnalysisFacts({
  scenarioId: SCENARIO_ID, hotWindowFacts,
  hotWindowFactsWithIdentity: hotWindowFacts.filter((f) => f === RUN).map((fact) => ({ fact, ...RUN_ROW, turn_id: 'turn-run' })),
  durableRead: { status: 'ok', scenario_id: SCENARIO_ID, query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT, total_count: facts.length,
    facts: facts.map((fact) => ({ fact, ...RUN_ROW })) },
});
const durableDegraded = () => reconcileScenarioAnalysisFacts({ scenarioId: SCENARIO_ID, hotWindowFacts: [] });
const priorFactsSent = (): readonly HandlerFact[] => (mocks.applyFactorValueEdit.mock.calls[0]![0] as { priorFacts: readonly HandlerFact[] }).priorFacts;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadPersistedGraphStrict.mockResolvedValue(GRAPH);
  mocks.commitDirectAnswer.mockResolvedValue({ persistedAnalysisGraphHash: 'committed-hash' });
  mocks.applyFactorValueEdit.mockResolvedValue({
    kind: 'mutated', graph: GRAPH, mutatedGraph: GRAPH,
    response: { response_version: 2, assistant_text: 'Updated.', blocks: [], suggested_actions: [], insights: [] }, receipts: [],
  });
});

describe('a board value edit is handed the scenario\'s Runs, not only the 20-row window', () => {
  it('PRECONDITION: the durable set is attested as reasoning authority, with the Run in the window or out of it', () => {
    expect(durableWith([RUN], [EDIT]).status).toBe('complete');
    expect(durableWith([RUN], [EDIT, RUN]).status).toBe('complete');
  });

  it('RED: the Run has left the window (20 board edits) → the writer still receives it', async () => {
    const window = Array.from({ length: 20 }, () => EDIT);
    mocks.loadScenarioAnalysisFactsForRead.mockResolvedValue({ hotWindow: { status: 'ok', facts: window }, factSet: durableWith([RUN], window) });
    await dispatchSystemEvent({ payload: payload(), requestId: 'req-a5-aged' });
    expect(mocks.applyFactorValueEdit).toHaveBeenCalledTimes(1);
    const sent = priorFactsSent();
    expect(sent.slice(0, 20)).toEqual(window); // the window first, unchanged and in order
    expect(sent.filter((f) => f.fact_type === 'run_analysis')).toEqual([RUN]);
  });

  it('CONTROL: the Run is still in the window → the writer receives the window exactly, the Run once', async () => {
    const window = [EDIT, RUN];
    mocks.loadScenarioAnalysisFactsForRead.mockResolvedValue({ hotWindow: { status: 'ok', facts: window }, factSet: durableWith([RUN], window) });
    await dispatchSystemEvent({ payload: payload(), requestId: 'req-a5-held' });
    expect(priorFactsSent()).toEqual(window);
  });

  it('CONTROL: a durable set that is not authority adds nothing (today\'s window, fail-safe)', async () => {
    mocks.loadScenarioAnalysisFactsForRead.mockResolvedValue({ hotWindow: { status: 'ok', facts: [EDIT] }, factSet: durableDegraded() });
    await dispatchSystemEvent({ payload: payload(), requestId: 'req-a5-degraded' });
    expect(priorFactsSent()).toEqual([EDIT]);
  });
});
