/**
 * F1: THE RELOAD MUST NOT LOSE AN ANALYSIS WHOSE TURN HAS AGED OUT OF THE WINDOW.
 *
 * The reload leg (`readScenarioAnalysis`) read analysis facts through the
 * `readRecent` window ALONE (SESSION_READ_WINDOW_TURNS, default 20 rows). Every
 * value op and every Agent turn is a row, so after 20 of them the run's turn
 * fell out of the window. The reload then said `never_run` and returned no
 * result, for a scenario that HAS a current analysis.
 *
 * The store fake behaves like the real store on BOTH ports: `readRecent` returns
 * only the newest window, while `readScenarioRunAnalysisFactsFor` (the durable,
 * scenario-scoped port the turn path already reconciles) returns the scenario's
 * run facts whatever their age.
 *
 *   CONTRAST: the run's turn is inside the window → current. Passes before and after.
 *   DEFECT:   the run's turn is outside the window → STILL current. RED before the fix.
 *
 * Deliberately not claimed here: the edit reply's freshness (a separate
 * `dispatch.ts` leg), and `capped` scenarios (covered by the reconciler's own suite).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readFactsWithTurnFor = vi.fn();
const readScenarioRunAnalysisFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();
// Partial mock: the REAL `SESSION_READ_WINDOW_DEFAULT` flows through, so the
// premise below is the production window size, not a copied number.
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => ({
    readRecent,
    readFactsFor,
    readFactsWithTurnFor,
    readScenarioRunAnalysisFactsFor,
    readAnalysisInvalidatedAt,
  }),
}));
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { readScenarioAnalysis } from '../scenario-graph-analysis-read.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { SESSION_READ_WINDOW_DEFAULT } from '../../orchestrator-v5/session/index.js';
import type { GraphStateIngress } from '../../orchestrator-v5/boundary/request-extensions.js';

const SCENARIO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GRAPH: GraphStateIngress = { nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }], edges: [] };
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const RUN_AT = '2026-09-24T17:00:00.000Z';
const RUN_TURN = 'turn-run';
const RUN_ROW = 'run-fact-row';

/** One successful run, stamped with the hash of the graph the reload returns. */
const RUN = RunAnalysisHandlerFactSchema.parse({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: {
    scenario_id: SCENARIO, computed_at: RUN_AT, graph_hash_at_run: HASH,
    leading_option_id: 'option-a', summary: 'Option A leads on the current model.',
    win_probabilities: { 'option-a': 0.65, 'option-b': 0.35 },
    constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    enrichment: { analysis_status: 'completed', robustness: { level: 'strong', near_tie: { is_tie: false } } },
  },
});

/** Newer turn rows that carry no analysis (value ops, Agent turns). */
function newerRows(count: number): { id: string }[] {
  return Array.from({ length: count }, (_, i) => ({ id: `turn-newer-${i}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  readAnalysisInvalidatedAt.mockResolvedValue(null);
  // The durable port returns the scenario's run whatever its age, exactly as
  // the production port does (an exact-count, scenario-scoped page).
  readScenarioRunAnalysisFactsFor.mockResolvedValue({
    facts: [{ fact: RUN, fact_row_id: RUN_ROW, fact_created_at: RUN_AT }],
    total_count: 1,
  });
});

describe('the reload keeps an analysis its turn has aged out of', () => {
  it('CONTRAST: the run turn is inside the readRecent window, so the reload reports it current', async () => {
    readRecent.mockResolvedValue([...newerRows(SESSION_READ_WINDOW_DEFAULT - 1), { id: RUN_TURN }]);
    readFactsFor.mockResolvedValue([RUN]);
    readFactsWithTurnFor.mockResolvedValue([
      { fact: RUN, fact_row_id: RUN_ROW, fact_created_at: RUN_AT, turn_id: RUN_TURN },
    ]);

    const result = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'f1-contrast' });

    expect(result.analysis_state?.run_state.kind).toBe('complete_current');
    expect(result.analysis_result).not.toBeNull();
  });

  it('DEFECT: 20 newer rows push the run turn out of the window, and the reload must STILL report it current', async () => {
    // Premise, proven here rather than assumed: the window is full of newer
    // rows and does not contain the run's turn.
    const window = newerRows(SESSION_READ_WINDOW_DEFAULT);
    expect(window).toHaveLength(SESSION_READ_WINDOW_DEFAULT);
    expect(window.some((row) => row.id === RUN_TURN)).toBe(false);
    readRecent.mockResolvedValue(window);
    readFactsFor.mockResolvedValue([]);
    readFactsWithTurnFor.mockResolvedValue([]);

    const result = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'f1-defect' });

    expect(
      result.analysis_state?.run_state.kind,
      'reload lost a current analysis once its turn aged out of the 20-row readRecent window',
    ).toBe('complete_current');
    expect(result.analysis_result).not.toBeNull();
    // Bound by identity: the result is THIS run, not any analysis-shaped block.
    expect(JSON.stringify(result.analysis_result)).toContain(HASH);
  });

  it('STALE ARM: an aged-out run on an EARLIER graph reloads as stale, never as current and never as never_run', async () => {
    // Without this case, a fix that says "a durable fact exists, so it is
    // current" passes the DEFECT case above. It would show an old run's numbers
    // as the current answer: worse than the cliff it replaces. The hash
    // comparison must still decide.
    const EDITED_GRAPH: GraphStateIngress = {
      ...GRAPH,
      nodes: [{ ...GRAPH.nodes[0], goal_threshold: 0.9 }],
    } as GraphStateIngress;
    const editedHash = computeAnalysisAffectingGraphHash(EDITED_GRAPH)!;
    expect(editedHash).not.toBe(HASH);
    readRecent.mockResolvedValue(newerRows(SESSION_READ_WINDOW_DEFAULT));
    readFactsFor.mockResolvedValue([]);
    readFactsWithTurnFor.mockResolvedValue([]);

    const result = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: EDITED_GRAPH, requestId: 'f1-stale' });

    expect(result.analysis_state?.run_state.kind).toBe('complete_stale');
    expect(result.analysis_result, 'a stale run must not be served as the current result').toBeNull();
  });
});

describe('a DEGRADED durable read cannot prove a run never happened (the hot window is 20 rows, not the record)', () => {
  // Found pre-review on #1860 (Codex source finding 5824695259): with the durable
  // read failed, a healthy window holding no run was read as proof of absence and
  // the reload said never_run while an older successful run existed. Absence is
  // authoritative only in a COMPLETE durable record; a success in the window is
  // still positive evidence.

  it('DEGRADED ABSENCE: durable read fails, the run aged out of the window — unknown, never never_run', async () => {
    readScenarioRunAnalysisFactsFor.mockRejectedValue(new Error('durable read unavailable'));
    const window = newerRows(SESSION_READ_WINDOW_DEFAULT);
    expect(window.some((row) => row.id === RUN_TURN), 'premise: the run turn is outside the window').toBe(false);
    readRecent.mockResolvedValue(window);
    readFactsFor.mockResolvedValue([]);
    readFactsWithTurnFor.mockResolvedValue([]);

    const result = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'deg-absence' });

    expect(readScenarioRunAnalysisFactsFor, 'premise: the durable port was consulted').toHaveBeenCalled();
    expect(result.analysis_state?.run_state.kind, 'an incomplete window cannot prove no run exists').toBe('unknown_degraded');
    expect(result.analysis_result).toBeNull();
  });

  it('DEGRADED, RUN IN WINDOW: durable read fails but the window holds the run — positive evidence still decides: current', async () => {
    readScenarioRunAnalysisFactsFor.mockRejectedValue(new Error('durable read unavailable'));
    readRecent.mockResolvedValue([...newerRows(SESSION_READ_WINDOW_DEFAULT - 1), { id: RUN_TURN }]);
    readFactsFor.mockResolvedValue([RUN]);
    readFactsWithTurnFor.mockResolvedValue([
      { fact: RUN, fact_row_id: RUN_ROW, fact_created_at: RUN_AT, turn_id: RUN_TURN },
    ]);

    const result = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'deg-in-window' });

    expect(result.analysis_state?.run_state.kind).toBe('complete_current');
    expect(JSON.stringify(result.analysis_result)).toContain(HASH);
  });

  it('COMPLETE AND EMPTY: the durable record is complete and holds no run — absence is authoritative: never_run', async () => {
    readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [], total_count: 0 });
    readRecent.mockResolvedValue(newerRows(SESSION_READ_WINDOW_DEFAULT));
    readFactsFor.mockResolvedValue([]);
    readFactsWithTurnFor.mockResolvedValue([]);

    const result = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'complete-empty' });

    expect(result.analysis_state?.run_state.kind).toBe('never_run');
    expect(result.analysis_result).toBeNull();
  });
});
