import { bindRunAnalysisOccurrence } from '../../orchestrator-v5/types/handler-fact.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { buildAnalysisResultBlock } from '../../orchestrator-v5/compose.js';
import { deriveAnalysisFreshness } from '../../orchestrator-v5/context/freshness.js';
import { buildAnalysisRefusalFact } from '../../orchestrator-v5/context/analysis-refusal-continuity.js';
import { goalChanceFactsForAgent } from '../../orchestrator-v5/goal-target/goal-chance-range-agent.js';

type Json = Record<string, any>;
const capture: Json = JSON.parse(readFileSync(new URL('./fixtures/canonical-view-b1.json', import.meta.url), 'utf8'));
const saved = capture.j;
// The capture is a readback, not a raw fact row. No new analysis figures or
// constraint permissions are invented when reconstructing this test wrapper.
function fact() {
  return RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: { scenario_id: saved.scenario_id, summary: saved.analysis_result.summary,
      leading_option_id: saved.analysis_result.leading_option_id, win_probabilities: saved.analysis_result.win_probabilities,
      enrichment: saved.analysis_result.enrichment, graph_hash_at_run: saved.current_read.computed_against_hash,
      computed_at: saved.analysis_state.run_state.computed_at, run_id: saved.current_read.run_id,
      goal_certainty: saved.analysis_goal_certainty } });
}
function input(patch: Json = {}): Json {
  const run = fact();
  return { graph: saved.graph, revision: 7, runFact: run, analysisState: saved.analysis_state,
    analysisReady: saved.current_read.analysis_ready,
    derivation: deriveAnalysisFreshness([run], run.result.graph_hash_at_run!),
    currentResult: buildAnalysisResultBlock(run), ...patch };
}
async function project(args: Json): Promise<Json> {
  const module = await import('../canonical-analysis-view.js');
  return module.projectCanonicalAnalysisView(args as never);
}
const cell = (view: Json, id: string): Json => view.options.find((o: Json) => o.option_id === id).cell;
const graph = { nodes: [{ id: 'price', kind: 'factor', label: 'Price' }, { id: 'revenue', kind: 'goal', label: 'Revenue' }], edges: [] };
const licence = { code: 'GOAL_CHANCE_LICENSED', severity: 'info', form: 'each', option_ids: ['raise', 'keep'], pct_by_option: { keep: 63 } };
const warning = { code: 'GOAL_FIGURES_PLACEHOLDER_PATH', severity: 'warning', message: 'Not shown. The price link is not sized.', option_ids: ['raise'] };
function result(warnings: Json[]): Json {
  return { type: 'analysis_result', enrichment: { option_comparison: [{ option_id: 'raise' }, { option_id: 'keep', probability_of_goal: 0.63 }], inference_warnings: warnings } };
}

describe('canonical analysis view — one stored Run and the existing licences', () => {
  it('DATA-FIGURE: captured displayed chances equal the existing reader, independently of leader permission', async () => {
    const args = input();
    const before = JSON.stringify(args);
    const view = await project(args);
    const expected = goalChanceFactsForAgent(args.currentResult, args.graph, true);
    expect(expected.goal_chance_display).toEqual({ raise_prices_10: 'about 47%', launch_49_starter_tier: 'about 52%', keep_pricing_as_it_is: 'less than 1%' });
    const labels = new Map(saved.graph.nodes.map((node: Json) => [node.id, node.label]));
    for (const [id, display] of Object.entries(expected.goal_chance_display!)) expect(cell(view, id)).toEqual({
      kind: 'figure', display, face: `‘${labels.get(id)}’: ${display} chance of meeting your goal, in this model.`,
    });
    expect(view.leader_licence).toBe('withheld');
    expect(view).not.toHaveProperty('win_probabilities');
    expect(JSON.stringify(args)).toBe(before);
  });

  it('DATA-DRIVER: carries the stored licensed driver and recorded absence, never factor_sensitivity', async () => {
    const args = input();
    const view = await project(args);
    const stored = args.currentResult.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
    expect(view.options.find((o: Json) => o.option_id === 'raise_prices_10').main_driver).toMatchObject({
      kind: 'available', driver: stored.driver_by_option.raise_prices_10,
    });
    expect(view.options.find((o: Json) => o.option_id === 'keep_pricing_as_it_is').main_driver).toEqual({ kind: 'none_licensed', reason: 'none' });
    delete stored.driver_by_option;
    delete stored.no_driver_by_option;
    const absent = await project(args);
    expect(absent.options.every((o: Json) => o.main_driver.kind === 'not_recorded')).toBe(true);
  });

  it('DATA-WITHHELD: one scoped option carries its exact recorded reason and the other keeps its figure', async () => {
    const view = await project(input({ graph, currentResult: result([licence, warning]) }));
    expect(cell(view, 'raise')).toEqual({ kind: 'withheld', reasons: [{ code: warning.code, message: warning.message }], face: 'Chance not shown yet', why: warning.message });
    expect(cell(view, 'keep')).toEqual({ kind: 'figure', display: 'about 63%', face: 'about 63% chance of meeting your goal, in this model.' });
  });

  it('DATA-REASON-ABSENT: a licence-only withhold remains withheld with its cause explicitly not recorded', async () => {
    const held = { ...licence, withheld_option_ids: ['raise'] };
    const view = await project(input({ graph, currentResult: result([held]) }));
    expect(cell(view, 'raise')).toEqual({ kind: 'withheld', reasons: [{ code: 'reason_not_recorded', message: null }],
      face: 'Chance not shown yet', why: 'Olumi can’t yet say its chance of meeting your goal, in this model.' });
    expect(cell(view, 'keep')).toEqual({ kind: 'figure', display: 'about 63%', face: 'about 63% chance of meeting your goal, in this model.' });
  });

  it('DATA-RANGE: an existing licensed range takes precedence over its compatible point withhold', async () => {
    const range = { code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Some options have a licensed range.', option_ids: ['raise'], range_by_option: {
      raise: { low_pct: 23, high_pct: 90, low_rounding: 'whole', high_rounding: 'nearest_5', kind: 'link_strength', from: 'price', to: 'revenue', among: 'all' },
    } };
    const view = await project(input({ graph, currentResult: result([licence, warning, range]) }));
    expect(cell(view, 'raise')).toMatchObject({ kind: 'range', display: 'between about 23% and 90%', detail: { depends_on: { from_label: 'Price', to_label: 'Revenue' } } });
    const barred = await project(input({ graph, currentResult: result([licence, warning, range,
      { code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', message: 'The identity was not evaluated.' }]) }));
    expect(cell(barred, 'raise').kind).toBe('withheld');
  });

  it('DATA-NONE: malformed or duplicate licences never fall back to raw probabilities or win shares', async () => {
    for (const warnings of [[], [licence, licence], [{ ...licence, form: 'future_form' }]]) {
      const view = await project(input({ graph, currentResult: result(warnings) }));
      expect(view.options.map((o: Json) => o.cell)).toEqual([{ kind: 'none' }, { kind: 'none' }]);
    }
  });

  it('DATA-STALE: exposes the existing stale verdict without reopening any figure gate', async () => {
    const args = input();
    args.derivation = deriveAnalysisFreshness([args.runFact], 'changed-analysis-hash');
    args.analysisState = { ...args.analysisState, run_state: { kind: 'complete_stale', computed_at: args.runFact.result.computed_at } };
    const view = await project(args);
    expect(view.staleness).toMatchObject({ stale: true, revision: 7, run_revision: null, basis: 'analysis_graph_hash_interim' });
    expect(view.staleness.limitation).toBe('Hash equality cannot detect brief, framing or stage changes.');
    expect(view.options).toEqual([]);
    expect(view.run).toMatchObject({ run_id: args.runFact.result.run_id, graph_hash_at_run: args.runFact.result.graph_hash_at_run });
  });

  it('DATA-UNKNOWN: an unreadable/unknown result never becomes fresh or never run', async () => {
    const args = input({ revision: undefined, currentResult: null, analysisState: null, derivation: null, runFact: null });
    const view = await project(args);
    expect(view.staleness.stale).toBeNull();
    expect(view.staleness.revision).toBeNull();
    expect(view.run).toBeNull();
    expect(view.options).toEqual([]);
  });

  it('DATA-REFUSAL: a refusal fact is not a Run and supplies no identity or figures', async () => {
    const refused = buildAnalysisRefusalFact({ scenarioId: saved.scenario_id, graphHash: 'refused-hash', reasonCode: 'analysis_not_ready', computedAt: '2026-10-08T12:00:00.000Z' });
    const view = await project(input({ runFact: refused }));
    expect(view.run).toBeNull();
    expect(view.options).toEqual([]);
    expect(view.staleness.stale).toBeNull();
  });
});


it('C2 projection refuses another row’s provenance even when its recorded number matches', async () => {
  const selected = fact(); const foreign = fact();
  bindRunAnalysisOccurrence({ fact: selected, fact_row_id: 'selected-row', evaluated_scenario_revision: 7 });
  bindRunAnalysisOccurrence({ fact: foreign, fact_row_id: 'foreign-row', evaluated_scenario_revision: 7 });
  const derivation = deriveAnalysisFreshness([foreign], foreign.result.graph_hash_at_run!);
  const view = await project(input({ runFact: selected, derivation }));
  expect(view.staleness).toMatchObject({ run_revision: null, run_revision_source: 'legacy_unknown' });
});
