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
import { RunAnalysisHandlerFactSchema, RunInputSnapshotSchema } from '@talchain/schemas/orchestrator';

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
    readMostRecentPendingActions: async () => [],
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
import { agentNoLeaderSentence } from '../../orchestrator-v5/agent-lane/withheld-leader-fail-closed.js';

const SCENARIO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GRAPH: GraphStateIngress = { nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }], edges: [] };
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const RUN_AT = '2026-09-24T17:00:00.000Z';
const RUN_ROW = 'run-fact-row';


function runFact(opts: { mayName: boolean; auto: boolean; state?: 'not_applicable' | 'evaluated_feasible' | 'evaluated_infeasible'; status?: 'completed' | 'partial'; at?: string }) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, computed_at: opts.at ?? RUN_AT, graph_hash_at_run: HASH,
      leading_option_id: 'option-a', summary: 'Option A leads on the current model.',
      win_probabilities: { 'option-a': 0.65, 'option-b': 0.35 },
      constraint_verdict: {
        may_name_leading_option: opts.mayName,
        constraint_verdict_state: opts.state ?? (opts.mayName ? 'evaluated_feasible' : 'evaluated_infeasible'),
      },
      enrichment: {
        analysis_status: opts.status ?? 'completed',
        robustness: { level: 'strong', near_tie: { is_tie: false } },
        ...(opts.auto ? { run_provenance: { initiated_by: 'auto_post_draft' } } : {}),
      },
    },
  });
}

async function reloadWith(fact: ReturnType<typeof runFact> | readonly ReturnType<typeof runFact>[], id: string,
  graph: GraphStateIngress = GRAPH) {
  const facts = Array.isArray(fact) ? fact : [fact];
  readScenarioRunAnalysisFactsFor.mockResolvedValue({
    facts: facts.map((item, index) => ({ fact: item, fact_row_id: `${RUN_ROW}-${index}`, fact_created_at: item.result.computed_at })),
    total_count: facts.length,
  });
  readRecent.mockResolvedValue([]);
  readFactsFor.mockResolvedValue([]);
  readFactsWithTurnFor.mockResolvedValue([]);
  return readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: id });
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

  it('a current no-limit Run withheld by a non-constraint gate gives a cause-free reason on cold read', async () => {
    const result = await reloadWith(runFact({ mayName: false, auto: false, state: 'not_applicable' }), 'w-no-limit');
    expect(result.analysis_state?.run_state.kind).toBe('complete_current');
    expect(result.analysis_state?.leader_claim).toMatchObject({ permitted: false, withheld_reason: 'analysis_leader_withheld' });
    const said = agentNoLeaderSentence(result.analysis_state?.leader_claim.withheld_reason, undefined);
    expect(said).not.toMatch(/limit|run the analysis again/i);
  });

  it('a met limit cannot be named as the cause of a provisional leader withhold on cold read', async () => {
    const result = await reloadWith(runFact({ mayName: false, auto: false, state: 'evaluated_feasible' }), 'w-met-limit');
    expect(result.analysis_state?.leader_claim).toMatchObject({ permitted: false, withheld_reason: 'analysis_leader_withheld' });
    expect(agentNoLeaderSentence(result.analysis_state?.leader_claim.withheld_reason, undefined)).not.toMatch(/limit|run the analysis again/i);
  });

  it('a newer partial Run with a limit verdict withholds without assigning a cause to the older displayed result', async () => {
    const older = runFact({ mayName: false, auto: false, state: 'not_applicable' });
    const newer = runFact({ mayName: false, auto: false, state: 'evaluated_infeasible', status: 'partial', at: '2026-09-24T18:00:00.000Z' });
    const result = await reloadWith([newer, older], 'w-newer-limit');
    expect(result.analysis_state?.contradictions).toContain('fact_status_success_but_degraded_newer');
    expect(result.analysis_result).toBeNull();
    expect(result.analysis_state?.leader_claim.withheld_reason).toBe('analysis_leader_withheld');
  });

  it('a newer partial no-limit Run keeps its own generic cause even when the older displayed Run had a limit', async () => {
    const older = runFact({ mayName: false, auto: false, state: 'evaluated_infeasible' });
    const newer = runFact({ mayName: false, auto: false, state: 'not_applicable', status: 'partial', at: '2026-09-24T18:00:00.000Z' });
    const result = await reloadWith([newer, older], 'w-newer-no-limit');
    expect(result.analysis_state?.contradictions).toContain('fact_status_success_but_degraded_newer');
    expect(result.analysis_result).toBeNull();
    expect(result.analysis_state?.leader_claim.withheld_reason).toBe('analysis_leader_withheld');
  });

  it('a newer partial withhold does not let an older permitted Run carry a current leader in the result block', async () => {
    const older = runFact({ mayName: true, auto: false });
    const newer = runFact({ mayName: false, auto: false, state: 'not_applicable', status: 'partial', at: '2026-09-24T18:00:00.000Z' });
    const result = await reloadWith([newer, older], 'w-newer-shadow');
    expect(result.analysis_state?.leader_claim.permitted).toBe(false);
    expect(result.analysis_state?.contradictions).toContain('fact_status_success_but_degraded_newer');
    expect(result.analysis_state?.robustness).toEqual({});
    expect(result.analysis_state?.leader_claim.separation).toBeUndefined();
    expect(result.analysis_result).toBeNull();
    expect(result.analysis_constraint_verdict_state, 'no old selected-Run sidecar reaches the Agent read').toBeUndefined();
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

// Synthetic stored Run/engine-echo fixtures: this tests the served comparison seam, not a probability oracle.
describe('C6: the cold read keeps recorded inputs and licensed chances beside automatic Runs', () => {
  for (const [brief, factor, unit, target] of [
    ['capacity', 'Additional specialists', 'specialists', 100],
    ['hiring', 'Additional engineers', 'engineers', 8],
  ] as const) {
    for (const automatic of ['prior', 'current'] as const) {
      for (const deniedChance of [false, true]) {
        it(`RED: ${brief}, automatic ${automatic}, denied chance=${deniedChance}: a bound input pair survives without that Run’s leader or win shares`, async () => {
          const graph: GraphStateIngress = { nodes: [
            { id: 'goal', kind: 'goal', label: `${brief} goal`, goal_threshold: 0.7 },
            { id: 'option-a', kind: 'option', label: `Add ${factor.toLowerCase()}` },
            { id: 'option-b', kind: 'option', label: 'Hold current setting' },
            { id: 'setting', kind: 'factor', label: factor },
          ], edges: [] };
          const make = (side: 'prior' | 'current') => {
            const raw = side === 'prior' ? 1 : 2;
            const base = runFact({ mayName: true, auto: side === automatic,
              at: side === 'prior' ? '2026-09-24T16:00:00.000Z' : RUN_AT });
            const snapshot = RunInputSnapshotSchema.parse({ snapshot_version: 1, sent_digest: 'a'.repeat(64),
              residual_digest: 'b'.repeat(64), goal: { node_id: 'goal', label: `${brief} goal`, target_raw: target },
              options: [{ option_id: 'option-a', settings: [{ factor_id: 'setting', label: factor, raw, encoded: raw, unit }] },
                { option_id: 'option-b', is_baseline: true, settings: [{ factor_id: 'setting', label: factor, raw: 0, encoded: 0, unit, held: true }] }],
              options_not_sent: [], factors: [{ factor_id: 'goal' }], constraints: [], links: [] });
            return RunAnalysisHandlerFactSchema.parse({ ...base, result: { ...base.result,
              summary: 'The recorded conditional findings are ready.', run_id: `${brief}-${side}`,
              graph_hash_at_run: computeAnalysisAffectingGraphHash(graph), input_snapshot: snapshot,
              enrichment: { ...base.result.enrichment, meta: { seed_used: side === 'prior' ? '17' : '18', n_samples: 10000 },
                option_comparison: [{ option_id: 'option-a', option_label: `Add ${factor.toLowerCase()}`, win_probability: 0.65 },
                  { option_id: 'option-b', option_label: 'Hold current setting', win_probability: 0.35 }],
                inference_warnings: deniedChance && side === automatic
                  // A missing point licence alone does not invalidate a conditional pair (AIE A); record an independent hold.
                  ? [{ code: 'GOAL_FIGURES_PROBABILITY_UNUSABLE', severity: 'warning', option_ids: ['option-a'],
                    message: 'This Run could not evaluate this option’s goal test.' },
                  { code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Stored range without its selected-Run licence.',
                    option_ids: ['option-a'], range_by_option: { 'option-a': { low_pct: 0, high_pct: 7,
                      low_rounding: 'whole', high_rounding: 'whole', kind: 'link_existence', from: 'setting', to: 'goal', among: 'all' } } }]
                  : [{ code: 'GOAL_CHANCE_LICENSED', severity: 'info', form: 'each',
                    option_ids: ['option-a', 'option-b'], pct_by_option: { 'option-a': side === 'prior' ? 35 : 59, 'option-b': 20 } }] },
            } });
          };
          const prior = make('prior'), current = make('current');
          const source = JSON.stringify([prior, current]);
          const result = await reloadWith([current, prior], `c6-${brief}-${automatic}`, graph);
          expect(result.analysis_state?.run_state.kind).toBe('complete_current');
          const delta = result.current_read.run_delta;
          expect(delta).toBeDefined();
          expect(delta?.endpoints).toEqual({ prior: { run_id: `${brief}-prior`, computed_at: prior.result.computed_at },
            current: { run_id: `${brief}-current`, computed_at: current.result.computed_at } });
          expect(delta?.input_changes).toEqual([{ entity_kind: 'option_setting', entity_id: 'setting', option_id: 'option-a',
            field: 'value', label_before: factor, label_after: factor, before: { raw: 1, unit }, after: { raw: 2, unit }, change: 'changed' }]);
          expect(delta?.win_probabilities).toEqual([]);
          expect(delta?.leader).not.toHaveProperty(automatic === 'prior' ? 'prior_leading_option_id' : 'current_leading_option_id');
          expect(delta?.goal_chances?.find(row => row.option_id === 'option-a')).toEqual({ option_id: 'option-a',
            prior: deniedChance && automatic === 'prior' ? { kind: 'withheld' } : { kind: 'point', pct: 35, rounding: 'whole' },
            current: deniedChance && automatic === 'current' ? { kind: 'withheld' } : { kind: 'point', pct: 59, rounding: 'whole' } });
          expect(JSON.stringify(delta?.goal_chances)).not.toContain('low_pct');
          expect(JSON.stringify([prior, current])).toBe(source);
        });
      }
    }
  }
});
