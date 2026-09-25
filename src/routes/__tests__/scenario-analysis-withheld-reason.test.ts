/**
 * WHY WAS THE LEADER WITHHELD? — the reload names the cause it can PROVE.
 *
 * Served (Panel #63 5825404689, CEE c673223): on the automatic first analysis the
 * reload's `leader_claim.withheld_reason` was `constraint_verdict_withheld`, and
 * the UI rendered it as "the check against the limits you set does not support
 * putting one option forward" — on a hiring brief that set NO limits. The cause
 * was not a constraint verdict: the run's own verdict PERMITTED a leader, and the
 * unrequested-analysis confinement (`wasAnalysisRequestedByUser`) withheld it.
 * `composeLeaderClaim` sees one boolean (`mayPresentLeaderClaimForFact`), so both
 * causes wore the constraint token.
 *
 *   RED:     auto-initiated run, constraint verdict PERMITS → `unrequested_analysis_withheld`
 *   CONTROL: user-requested run, constraint verdict WITHHELD → `constraint_verdict_withheld`
 *   CONTROL: auto-initiated run AND constraint verdict WITHHELD → `constraint_verdict_withheld`
 *            (a real limit is the stronger "we looked and declined"; it wins)
 *   CONTROL: user-requested, permitted, separated → permitted, no reason
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
import type { GraphStateIngress } from '../../orchestrator-v5/boundary/request-extensions.js';

const SCENARIO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GRAPH: GraphStateIngress = { nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }], edges: [] };
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const RUN_AT = '2026-09-24T17:00:00.000Z';
const RUN_ROW = 'run-fact-row';


function runFact(opts: { mayName: boolean; auto: boolean }) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, computed_at: RUN_AT, graph_hash_at_run: HASH,
      leading_option_id: 'option-a', summary: 'Option A leads on the current model.',
      win_probabilities: { 'option-a': 0.65, 'option-b': 0.35 },
      constraint_verdict: {
        may_name_leading_option: opts.mayName,
        constraint_verdict_state: opts.mayName ? 'evaluated_feasible' : 'evaluated_infeasible',
      },
      enrichment: {
        analysis_status: 'completed',
        robustness: { level: 'strong', near_tie: { is_tie: false } },
        ...(opts.auto ? { run_provenance: { initiated_by: 'auto_post_draft' } } : {}),
      },
    },
  });
}

async function reloadWith(fact: ReturnType<typeof runFact>, id: string) {
  readScenarioRunAnalysisFactsFor.mockResolvedValue({
    facts: [{ fact, fact_row_id: RUN_ROW, fact_created_at: RUN_AT }],
    total_count: 1,
  });
  readRecent.mockResolvedValue([]);
  readFactsFor.mockResolvedValue([]);
  readFactsWithTurnFor.mockResolvedValue([]);
  return readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: id });
}

beforeEach(() => {
  vi.clearAllMocks();
  readAnalysisInvalidatedAt.mockResolvedValue(null);
});

describe('the reload names the cause of a withheld leader that it can prove', () => {
  it('RED: an automatic first pass whose verdict PERMITS a leader is withheld because nobody asked — not "the limits you set"', async () => {
    const result = await reloadWith(runFact({ mayName: true, auto: true }), 'w-auto-permits');
    expect(result.analysis_state?.run_state.kind, 'premise: a current run').toBe('complete_current');
    expect(result.analysis_state?.leader_claim.permitted).toBe(false);
    expect(result.analysis_state?.leader_claim.withheld_reason).toBe('unrequested_analysis_withheld');
  });

  it('CONTROL: a requested run whose constraint verdict withholds keeps constraint_verdict_withheld', async () => {
    const result = await reloadWith(runFact({ mayName: false, auto: false }), 'w-req-withheld');
    expect(result.analysis_state?.leader_claim.permitted).toBe(false);
    expect(result.analysis_state?.leader_claim.withheld_reason).toBe('constraint_verdict_withheld');
  });

  it('CONTROL: an automatic run whose constraint verdict ALSO withholds names the real limit', async () => {
    const result = await reloadWith(runFact({ mayName: false, auto: true }), 'w-auto-withheld');
    expect(result.analysis_state?.leader_claim.withheld_reason).toBe('constraint_verdict_withheld');
  });

  it('CONTROL: a requested, permitted, separated run names no withhold reason', async () => {
    const result = await reloadWith(runFact({ mayName: true, auto: false }), 'w-req-permits');
    expect(result.analysis_state?.leader_claim.permitted).toBe(true);
    expect(result.analysis_state?.leader_claim.withheld_reason).toBeUndefined();
  });
});
