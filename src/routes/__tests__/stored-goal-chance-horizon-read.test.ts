import { readBackState } from '../agent-v1-turn.js';
import { goalChanceSideOf } from '../../orchestrator-v5/goal-target/goal-chance-sides.js';
/** DL #2895 P1b: a cold reload reads today's graph even when H does not change the analysis hash. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { RunDeliveredRecordSchema } from '@talchain/schemas/boundary';
const readRecent = vi.fn(), readFactsFor = vi.fn(), readFactsWithTurnFor = vi.fn();
const readScenarioRunAnalysisFactsFor = vi.fn(), readAnalysisInvalidatedAt = vi.fn();
const readNewestRunDeliveryFor = vi.fn();
vi.mock('../../orchestrator-v5/session/index.js', async original => ({
  ...(await original<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => ({ readRecent, readFactsFor, readFactsWithTurnFor, readScenarioRunAnalysisFactsFor,
    readAnalysisInvalidatedAt, readNewestRunDeliveryFor, readMostRecentPendingActions: async () => [] }),
}));
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
import { readScenarioAnalysis } from '../scenario-graph-analysis-read.js';
import { projectCanonicalAnalysisCells } from '../canonical-analysis-view.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { goalHorizonVerdict, withReadTimeHorizonGate } from '../../orchestrator-v5/goal-target/goal-horizon-verdict.js';
import { goalChanceLicenceForAgent } from '../../orchestrator-v5/goal-target/goal-chance-licence.js';
import { goalChanceFactsForAgent, goalChanceRangeDisplayForAgent } from '../../orchestrator-v5/goal-target/goal-chance-range-agent.js';
import { goalChanceScreenLinesForAgent } from '../../orchestrator-v5/agent-lane/goal-chance-screen-lines.js';
import { goalChanceWithheldForAgent } from '../../orchestrator-v5/agent-lane/goal-chance-withheld.js';
import { analysisResultForAgent } from '../../orchestrator-v5/agent-lane/decision-sensitivity.js';
import { buildAnalysisFromPriorFacts } from '../../orchestrator-v5/context/analysis-fallback.js';
import { buildAnalysisResultBlock } from '../../orchestrator-v5/compose.js';

type Rec = Record<string, any>;
const SCENARIO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const graph = (): Rec => ({ goal_node_id: 'goal', nodes: [
  { id: 'decision', kind: 'decision', label: 'Choose' },
  { id: 'goal', kind: 'goal', label: 'Revenue', goal_threshold: .7 },
  { id: 'factor', kind: 'factor', label: 'Demand' },
  { id: 'a', kind: 'option', label: 'A', interventions: { factor: 1 } },
  { id: 'b', kind: 'option', label: 'B', interventions: { factor: 0 } },
], edges: [['decision', 'a'], ['decision', 'b'], ['a', 'factor'], ['b', 'factor'], ['factor', 'goal']]
  .map(([from, to]) => ({ from, to, strength: { mean: 1, std: .1 }, exists_probability: 1, effect_direction: 'positive' })) });
const fact = (g: Rec) => RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: SCENARIO, summary: 'Analysis complete.', computed_at: '2026-10-08T12:00:00.000Z',
    graph_hash_at_run: computeAnalysisAffectingGraphHash(g as never), leading_option_id: 'a', win_probabilities: { a: .8, b: .2 },
    constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    enrichment: { analysis_status: 'completed', robustness: { level: 'strong', near_tie: { is_tie: false } },
      option_comparison: [{ option_id: 'a', option_label: 'A', probability_of_goal: .63, win_probability: .8 },
        { option_id: 'b', option_label: 'B', probability_of_goal: .43, win_probability: .2 }],
      inference_warnings: [{ code: 'GOAL_CHANCE_LICENSED', severity: 'info', form: 'each', option_ids: ['a', 'b'], pct_by_option: { a: 63, b: 43 } }] } } });
async function reload(run: ReturnType<typeof fact>, g: Rec): Promise<Rec> {
  readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [{ fact: run, fact_row_id: 'row', fact_created_at: run.result.computed_at }], total_count: 1 });
  return readScenarioAnalysis({ scenarioId: SCENARIO, graph: g as never, requestId: 'horizon-reload' });
}
beforeEach(() => {
  vi.clearAllMocks(); readRecent.mockResolvedValue([]); readFactsFor.mockResolvedValue([]);
  readFactsWithTurnFor.mockResolvedValue([]); readAnalysisInvalidatedAt.mockResolvedValue(null);
  readNewestRunDeliveryFor.mockResolvedValue(null);
});

describe('stored supported chance re-licensed against the current graph', () => {
  it('stored delivered chance prose is omitted alongside the horizon-held cells rather than rewritten', async () => {
    const g = graph(), run = fact(g);
    run.result.run_id = 'stored-no-h-run';
    const record = RunDeliveredRecordSchema.parse({ record_version: 1, run_id: run.result.run_id,
      graph_hash: run.result.graph_hash_at_run, phase3_blocks: [{ type: 'review_card',
        block_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', signal_id: 'chance-review',
        created_at: run.result.computed_at, source_handler: 'run_analysis', graph_hash_at_generation: run.result.graph_hash_at_run,
        freshness: 'fresh', card_kind: 'narrative', title: 'Recorded goal chance',
        body: 'One recorded chance is about 63%.', severity: 'info', target_refs: [], priority_rank: 1 }] });
    readNewestRunDeliveryFor.mockResolvedValue({ result: { record } });
    expect((await reload(run, g)).current_read.delivered_record).toEqual(record);
    g.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months = 12;
    const after = await reload(run, g);
    expect(after.current_read.delivered_record).toBeUndefined();
    expect(JSON.stringify(record)).toContain('about 63%');
  });
  it('no H Run → H=12 without a carrier → canonical reload withholds and Agent sees no chance; hash unchanged', async () => {
    const g = graph(), run = fact(g), storedBytes = JSON.stringify(run);
    const before = await reload(run, g);
    expect(before.canonical_analysis_view.options.map((r: Rec) => r.cell.kind)).toEqual(['figure', 'figure']);
    g.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months = 12;
    expect(computeAnalysisAffectingGraphHash(g as never)).toBe(run.result.graph_hash_at_run);
    const after = await reload(run, g);
    expect(after.analysis_state.run_state.kind).toBe('complete_current');
    expect(after.analysis_goal_certainty).toBeUndefined();
    expect(after.canonical_analysis_view.options).toHaveLength(2);
    for (const r of after.canonical_analysis_view.options) expect(r.cell).toMatchObject({ kind: 'withheld',
      reasons: [{ code: 'GOAL_FIGURES_HORIZON_NOT_TESTED', message: "Your goal is for month 12, and this model only has today's numbers." }] });
    const projected = analysisResultForAgent(after.analysis_result, undefined, true, g) as Rec;
    expect(projected.goal_chance_display).toBeUndefined();
    expect(JSON.stringify(projected)).not.toMatch(/probability_of_goal|pct_by_option|GOAL_CHANCE_LICENSED/);
    expect(projected.enrichment.option_comparison.map((r: Rec) => r.win_probability)).toEqual([.8, .2]);
    expect(JSON.stringify(run)).toBe(storedBytes);
  });
  it('an exact stored chance cannot bypass the read gate through its separate certainty record', async () => {
    const g = graph(), run = fact(g), enrichment = run.result.enrichment as Rec;
    enrichment.option_comparison[0].probability_of_goal = 1;
    enrichment.inference_warnings[0].pct_by_option.a = 100;
    run.result.goal_certainty = [{ option_id: 'a', probability_of_goal: 1, earned: true }];
    const before = await reload(run, g);
    expect(before.analysis_goal_certainty).toEqual(run.result.goal_certainty);
    g.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months = 12;
    const after = await reload(run, g);
    expect(after.analysis_goal_certainty).toBeUndefined();
    expect(after.canonical_analysis_view.options.every((r: Rec) => r.cell.kind === 'withheld')).toBe(true);
    expect(JSON.stringify(analysisResultForAgent(after.analysis_result, g))).not.toContain('probability_of_goal');
  });
  it('direct stored readers, compose cells and legacy model fallback share the gate', () => {
    const g = graph(), run = fact(g), block = buildAnalysisResultBlock(run);
    g.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months = 12;
    expect(goalChanceLicenceForAgent(block, g)).toBeUndefined();
    expect(goalChanceSideOf(block, 'a', g)).toEqual({ kind: 'withheld' });
    expect(goalChanceFactsForAgent(block, g, true)).toEqual({});
    expect(goalChanceRangeDisplayForAgent(block, g)).toBeUndefined();
    expect(goalChanceScreenLinesForAgent(block, g, true)).toEqual([]);
    expect(goalChanceWithheldForAgent(block, g)).toBeDefined();
    expect(projectCanonicalAnalysisCells(block, g).every(row => row.cell.kind === 'withheld')).toBe(true);
    expect(JSON.stringify(analysisResultForAgent(block, undefined, true, g))).not.toContain('probability_of_goal');
    const fallback = buildAnalysisFromPriorFacts([run], undefined, g);
    expect(fallback?.options).toHaveLength(2);
    expect(fallback?.options.every(row => row.probability_of_goal === undefined)).toBe(true);
  });
  it('H removed after a withheld Run stays withheld on reload and for Agent until a new Run', async () => {
    const g = graph(); g.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months = 12;
    const run = fact(g);
    run.result.enrichment = withReadTimeHorizonGate(run.result.enrichment, g);
    const bytes = JSON.stringify(run);
    delete g.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months;
    const read = await reload(run, g);
    expect(goalHorizonVerdict(g, run.result.enrichment)).toBe('no_horizon');
    expect(read.canonical_analysis_view.options.every((r: Rec) => r.cell.kind === 'withheld')).toBe(true);
    expect(goalChanceFactsForAgent(read.analysis_result, g, true)).toEqual({});
    expect(withReadTimeHorizonGate(run, g)).toBe(run);
    expect(JSON.stringify(run)).toBe(bytes);
  });
  it('evaluated carrier evidence survives public projection internally; a later horizon edit is still rechecked', async () => {
    const g = graph(), goal = g.nodes.find((n: Rec) => n.kind === 'goal');
    goal.goal_horizon_months = 12;
    goal.nonlinear_identity = { operation: 'product', factor_ids: ['price', 'stock_at_h'], stated_in_brief: true };
    g.nodes.push({ id: 'stock_at_h', kind: 'factor', label: 'Stock at month H', nonlinear_identity: {
      operation: 'accumulation', factor_ids: ['today', 'leave', 'adds'], horizon_months: 12, rate_scale: .01, stated_in_brief: true } },
      ...['price', 'today', 'leave', 'adds'].map(id => ({ id, kind: 'factor', label: id,
        observed_state: { value: .5, raw_value: 1, source: 'user_confirmed' } })));
    const run = fact(g);
    run.result.enrichment!.identity_evaluations = g.nodes.filter((n: Rec) => n.nonlinear_identity)
      .map((n: Rec) => ({ node_id: n.id, evaluated: true, ...n.nonlinear_identity }));
    expect(goalHorizonVerdict(g, run.result.enrichment)).toBe('computed_at_h');
    const block = buildAnalysisResultBlock(run);
    expect(block.enrichment).not.toHaveProperty('identity_evaluations');
    expect(JSON.stringify(block)).not.toContain('identity_evaluations');
    expect(projectCanonicalAnalysisCells(block, g).every(row => row.cell.kind === 'figure')).toBe(true);
    const canonicalRead = await reload(run, g);
    expect(canonicalRead.canonical_analysis_view.options.every((r: Rec) => r.cell.kind === 'figure')).toBe(true);
    // Exercise JSON decode too: safe transport omits evaluation rows, while the server's canonical view already gated them.
    const decoded = await readBackState(async path => path.endsWith('/graph')
      ? { status: 200, json: JSON.parse(JSON.stringify({ graph: g, ...canonicalRead })) }
      : { status: 404, json: {} }, SCENARIO);
    expect((analysisResultForAgent(decoded.analysisResult, decoded.graph) as Rec).goal_chance_display).toEqual({ a: 'about 63%', b: 'about 43%' });
    (decoded.graph as Rec).nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months = 6;
    expect(goalChanceFactsForAgent(decoded.analysisResult, decoded.graph, true)).toEqual({});
    goal.goal_horizon_months = 6;
    expect(projectCanonicalAnalysisCells(block, g).every(row => row.cell.kind === 'withheld')).toBe(true);
    expect(goalChanceFactsForAgent(block, g, true)).toEqual({});
  });
  it('a licence-only stored display is gated even when no native result rows remain', () => {
    const g = graph(), result = { inference_warnings: [{ code: 'GOAL_CHANCE_LICENSED', severity: 'info',
      form: 'each', option_ids: ['a'], pct_by_option: { a: 63 } }] };
    g.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months = 12;
    for (const stored of [result, { ...result, enrichment: {} }]) {
      expect(goalChanceLicenceForAgent(stored, g)).toBeUndefined();
      expect(goalChanceSideOf(stored, 'a', g)).toEqual({ kind: 'withheld' });
      const held = withReadTimeHorizonGate(stored, g) as Rec;
      expect((held.enrichment ?? held).inference_warnings).toContainEqual(expect.objectContaining({ code: 'GOAL_FIGURES_HORIZON_NOT_TESTED' }));
    }
  });
  it('a stored range and UI-normalised aliases cannot revive a withheld chance', () => {
    const g = graph(); g.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months = 12;
    const result = { enrichment: { option_comparison: [{ option_id: 'a', probability_of_goal: .63, goal_probability: .63, goalProbability: .63, win_probability: .8 }],
      inference_warnings: [{ code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Range', option_ids: ['a'], range_by_option: {
        a: { low_pct: 23, high_pct: 90, low_rounding: 'whole', high_rounding: 'nearest_5', kind: 'link_strength', from: 'factor', to: 'goal', among: 'all' } } }] } };
    const held = withReadTimeHorizonGate(result, g);
    expect(goalChanceRangeDisplayForAgent(result, g)).toBeUndefined();
    expect(held.enrichment.option_comparison[0]).toEqual({ option_id: 'a', win_probability: .8 });
    expect(withReadTimeHorizonGate(held, g)).toBe(held);
  });
});
