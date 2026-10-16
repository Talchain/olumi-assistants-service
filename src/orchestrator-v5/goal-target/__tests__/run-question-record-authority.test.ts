import { describe, expect, it, vi } from 'vitest';
import captured from './fixtures/capacity-247ae5b4-run.json';
import minimal from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';
import { deriveRunQuestion, goalChanceLicenceForAgent, STATIC_MODEL_SCOPE_NOTE } from '../goal-chance-licence.js';
import { runFactsOf } from '../../agent-lane/run-facts.js';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import { buildAnalysisResultBlock } from '../../compose.js';

const stored = () => ({ ...structuredClone(captured.result), run_id: captured.evidence.run_id,
  input_snapshot: structuredClone(captured.evidence.input_snapshot), graph_hash_at_run: 'saved-capture' });
const evidence = () => ({ runId: captured.evidence.run_id, inputSnapshot: structuredClone(captured.evidence.input_snapshot),
  occurrence: captured.evidence.occurrence });

describe('S3 single evaluated-input authority — independent capacity capture247ae5b4', () => {
  it('the saved80 /100 /level /≥ /tickets per week inputs survive without inventing an unrecorded scope', () => {
    const run = stored();
    const q = deriveRunQuestion({ storedResult: run, runEvidence: evidence() });
    expect(q.scope).toMatchObject({ status: 'outside_static_scope', can_show_goal_chance: true });
    expect(q.scope.note).toBeUndefined();
    expect(q.omitted).toContainEqual({ field: 'calculation_scope_at_evaluated_revision', reason: 'not_recorded' });
    expect(q.calculated).toMatchObject({ quantity: { node_id: 'weekly_support_capacity' }, target: 100, baseline: 80,
      encoded_target: 0.2, encoded_baseline: 0.16, frame: 'level', comparator: '>=', unit: 'tickets per week' });
    expect(q.evaluated_scenario_revision).toBe(2);
    expect(q.evidence.missing).toContain('historical_model_at_evaluated_revision');
    expect(q.asked?.horizon).toBeUndefined();
    expect(q.omitted).toContainEqual({ field: 'asked_horizon_and_reference_at_evaluated_revision', reason: 'not_recorded' });
  });

  it('coaching and canonical Results read the same scope without borrowing a later graph', () => {
    const run = stored(), before = JSON.stringify(run), today = structuredClone(captured.graph);
    const goal = today.nodes.find(n => n.kind === 'goal')!;
    Object.assign(goal, { goal_threshold_raw: 999 });
    const facts = runFactsOf(captured.result, today, true, { runEvidence: evidence() });
    const view = projectCanonicalAnalysisView({ graph: today,
      runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: run } as never,
      analysisState: { run_state: { kind: 'complete_current' } } as never, currentResult: captured.result as never });
    expect(facts.question?.scope).toEqual(view.question?.scope);
    expect(view.question?.scope.can_show_goal_chance).toBe(true);
    expect(facts.chances.goal_chance_display?.add_one_specialist).toBe('about 40%');
    const cell = view.options.find(row => row.option_id === 'add_one_specialist')!.cell;
    expect(cell.kind).toBe('figure');
    expect('face' in cell && cell.face).not.toContain(STATIC_MODEL_SCOPE_NOTE);
    expect(view.question?.calculated).toMatchObject({ target: 100, baseline: 80, unit: 'tickets per week' });
    expect(JSON.stringify(run)).toBe(before);
  });

  it.each(['missing_baseline', 'wrong_frame', 'reversed_comparator', 'wrong_unit', 'wrong_conversion', 'different_recorded_target', 'different_recorded_goal'] as const)(
    '%s remains unlicensed despite valid-looking percentages and an added static caveat', mutant => {
      const run = stored();
      if (mutant === 'missing_baseline') run.input_snapshot.factors = run.input_snapshot.factors.filter(f => f.factor_id !== 'weekly_support_capacity');
      if (mutant === 'wrong_frame') run.input_snapshot.goal.frame = 'delta';
      if (mutant === 'reversed_comparator') run.input_snapshot.goal.operator = '<=';
      if (mutant === 'wrong_unit') run.input_snapshot.goal.unit = 'people';
      if (mutant === 'wrong_conversion') run.input_snapshot.factors[0]!.encoded = 0.8;
      const licence = run.enrichment.inference_warnings.find(w => w.code === 'GOAL_CHANCE_LICENSED');
      if (licence?.target === undefined) throw new Error('Captured licence missing');
      if (mutant === 'different_recorded_target') licence.target.value = 999;
      if (mutant === 'different_recorded_goal') licence.goal_node_id = 'another-goal';
      const q = deriveRunQuestion({ storedResult: run });
      expect(q.scope.can_show_goal_chance).toBe(false);
      const view = projectCanonicalAnalysisView({ graph: captured.graph,
        runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: run } as never,
        analysisState: { run_state: { kind: 'complete_current' } } as never, currentResult: captured.result as never });
      expect(view.options.some(row => row.cell.kind === 'figure' || row.cell.kind === 'range')).toBe(false);
      expect(runFactsOf(run, captured.graph, true).chances.goal_chance_display).toBeUndefined();
    });

  it('missing snapshots, foreign evidence and stale selection cannot borrow the recorded percentage', () => {
    const run = stored();
    const { input_snapshot: _snapshot, ...missing } = run;
    expect(deriveRunQuestion({ storedResult: missing }).scope.can_show_goal_chance).toBe(false);
    expect(runFactsOf(missing, captured.graph, true).chances.goal_chance_display).toBeUndefined();
    const foreign = { ...evidence(), runId: 'a-different-run' };
    const facts = runFactsOf(run, captured.graph, true, { runEvidence: foreign });
    expect(facts.question?.scope.can_show_goal_chance).toBe(false);
    expect(facts.chances.goal_chance_display).toBeUndefined();
    expect(runFactsOf(run, captured.graph, false, { runEvidence: evidence() }).chances.goal_chance_display).toBeUndefined();
  });

  it.each(['normal', 'reduced', 'partial', 'provisional'] as const)('the actual handler stores the record-owned chance and retains the %s caution through the registry', async mode => {
    const snapshot = await loadScenarioSnapshotForRunAnalysis('bc0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', 's3-capture', {
      loadGraphAndBriefText: vi.fn(async () => ({ graph: structuredClone(captured.graph), briefText: captured.brief, revision: 2 })),
      readMostRecentPendingActions: vi.fn(async () => []),
    } as never);
    // Transport replay only: these are the observed finite output rows, not an engine-maths test.
    let outbound: unknown;
    const transport = vi.fn(async (request: unknown) => { outbound = request; return { ...structuredClone(minimal),
      option_comparison: structuredClone(captured.result.enrichment.option_comparison),
      ...(mode === 'provisional' ? { robustness: { level: 'moderate', fragile_edges: [
        { from_label: 'Additional specialist capacity', to_label: 'Weekly support capacity', switch_probability: 0.45 },
      ] } } : {}),
      ...(mode === 'reduced' ? { inference_warnings: [{ code: 'SAMPLES_REDUCED_FOR_COMPLEXITY' }] } : {}),
      ...(mode === 'partial' ? { analysis_status: 'partial' } : {}) }; });
    const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
      plotClient: { run: transport, validatePatch: vi.fn() } as never });
    const outcome = await handler({ payload: { scenario_id: 'bc0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', turn_id: 's3-capture' }, requestId: 's3-capture',
      context: {}, signal: new AbortController().signal, orientationText: '' } as never);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(outbound).toMatchObject({ goal_node_id: 'weekly_support_capacity', graph: { nodes: expect.arrayContaining([
      expect.objectContaining({ id: 'weekly_support_capacity', goal_threshold_raw: 100, goal_threshold: 0.2, goal_threshold_frame: 'level',
        goal_direction: '>=', goal_threshold_unit: 'tickets per week', observed_state: expect.objectContaining({ raw_value: 80, baseline: 0.16 }) }),
    ]) } });
    const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis');
    if (fact?.fact_type !== 'run_analysis' || fact.noop) throw new Error('Expected actual saved Run fact');
    const q = deriveRunQuestion({ storedResult: fact.result });
    expect(q.scope.can_show_goal_chance).toBe(true);
    expect(goalChanceLicenceForAgent(fact.result)?.notes).toContain(STATIC_MODEL_SCOPE_NOTE);
    expect(goalChanceLicenceForAgent(fact.result)?.withheld_option_ids).toContain('keep_current_staffing');
    expect(fact.result.enrichment?.option_comparison).toEqual(expect.arrayContaining([
      expect.objectContaining({ option_id: 'add_one_specialist', probability_of_goal: 0.3951 }),
    ]));
    expect(fact.result.summary).toMatch(/^‘Add one specialist’: about 40% chance of/u);
    expect(fact.result.summary).toContain('100 tickets per week');
    expect(fact.result.summary).toContain(STATIC_MODEL_SCOPE_NOTE);
    expect(fact.result.summary).not.toMatch(/88%|highest weekly support capacity/u);
    expect(outcome.assistant_text).toBe(fact.result.summary);
    if (mode === 'reduced') expect(outcome.assistant_text).toContain('analysis ran fewer simulations');
    if (mode === 'partial') expect(outcome.assistant_text).toContain('Some results may be incomplete — treat with caution.');
    if (mode === 'provisional') expect(outcome.assistant_text).toContain('Treat this as provisional:');
    const confirm = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
    if (typeof confirm !== 'function') throw new Error('Expected existing Run confirmation function');
    expect(confirm(outcome)).toBe(outcome.assistant_text);
    expect(confirm({ ...outcome,
      assistant_text: outcome.assistant_text.replace('40%', '99%') })).not.toContain('99%');
    expect(confirm({ ...outcome,
      assistant_text: outcome.assistant_text + ' This includes every risk.' })).not.toContain('includes every risk');
  });

  it.each([false, true])('over-period level threshold, period-end reading=%s: existing licence owns the chance, never the static label', async supported => {
    const graph = structuredClone(captured.graph);
    const goal = graph.nodes.find(n => n.kind === 'goal')!;
    Object.assign(goal, { goal_horizon_months: 3, goal_target_basis: { quantity_frame: 'level', target_frame: 'level', target_raw: 100,
      reference: 'launch', period_months: 3, period_kind: 'over_period', effect_unit: 'tickets over the first three months',
      effects_at_period_end: supported, source: 'olumi_reading' } });
    const snapshot = await loadScenarioSnapshotForRunAnalysis('bc0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', 's3-period', {
      loadGraphAndBriefText: vi.fn(async () => ({ graph, briefText: captured.brief, revision: 2 })),
      readMostRecentPendingActions: vi.fn(async () => []),
    } as never);
    const transport = vi.fn(async (_request: unknown) => ({ ...structuredClone(minimal),
      option_comparison: structuredClone(captured.result.enrichment.option_comparison) }));
    const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
      plotClient: { run: transport, validatePatch: vi.fn() } as never });
    const outcome = await handler({ payload: { scenario_id: 'bc0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', turn_id: 's3-period' }, requestId: 's3-period',
      context: {}, signal: new AbortController().signal, orientationText: '' } as never);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0]).toMatchObject({ graph: expect.objectContaining({ nodes: expect.arrayContaining([
      expect.objectContaining({ id: 'weekly_support_capacity', goal_threshold: 0.2, goal_threshold_frame: 'level' }),
    ]) }) });
    const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis');
    if (fact?.fact_type !== 'run_analysis' || fact.noop) throw new Error('Expected stored over-period Run');
    const selectedEvidence = { runId: fact.result.run_id, inputSnapshot: fact.result.input_snapshot, occurrence: { evaluated_scenario_revision: 2 } };
    const q = deriveRunQuestion({ storedResult: fact.result, runEvidence: selectedEvidence });
    expect(q.evaluated_scenario_revision).toBe(2);
    expect(q.scope.status).not.toBe('supported_static');
    expect(q.scope.note).toBeUndefined();
    expect(q.scope.capability).toBeUndefined();
    expect(q.run_id).toBe(fact.result.run_id);
    const recorded = JSON.parse(JSON.stringify(fact.result));
    expect(deriveRunQuestion({ storedResult: recorded }).scope).toEqual(q.scope);
    if (supported) {
      expect(recorded.enrichment.inference_warnings.find((w: { code: string }) => w.code === 'GOAL_CHANCE_LICENSED')?.pct_by_option.add_one_specialist).toBe(40);
      expect(recorded.enrichment.option_comparison).toEqual(expect.arrayContaining([
        expect.objectContaining({ option_id: 'add_one_specialist', probability_of_goal: 0.3951 }),
      ]));
      expect(q.scope.can_show_goal_chance).toBe(true);
      expect(fact.result.summary).toContain('about 40%');
      expect(fact.result.summary).toContain('over the first three months after launch');
      expect(fact.result.summary).not.toContain(STATIC_MODEL_SCOPE_NOTE);
      const facts = runFactsOf(recorded, graph, true, { runEvidence: selectedEvidence });
      expect(facts.question?.scope).toEqual(q.scope);
      expect(facts.chances.goal_chance_display?.add_one_specialist).toBe('about 40%');
      expect(facts.must_say).not.toContain(STATIC_MODEL_SCOPE_NOTE);
      const view = projectCanonicalAnalysisView({ graph, runFact: { ...fact, result: recorded },
        analysisState: { run_state: { kind: 'complete_current' } } as never, currentResult: buildAnalysisResultBlock(fact) });
      expect(view.question?.scope).toEqual(q.scope);
      expect(view.options.find(row => row.option_id === 'add_one_specialist')?.cell.kind).toBe('figure');
      expect(JSON.stringify(view)).not.toContain(STATIC_MODEL_SCOPE_NOTE);
      return;
    }
    expect(q.scope.can_show_goal_chance).toBe(false);
    expect(fact.result.summary).not.toContain(STATIC_MODEL_SCOPE_NOTE);
    expect(runFactsOf(fact.result, graph, true).chances.goal_chance_display).toBeUndefined();
    expect(fact.result.enrichment?.inference_warnings).toContainEqual(expect.objectContaining({
      code: 'GOAL_FIGURES_HORIZON_NOT_TESTED', detail: expect.objectContaining({ reason: 'HORIZON_NOT_TESTED' }),
    }));
    const view = projectCanonicalAnalysisView({ graph, runFact: fact,
      analysisState: { run_state: { kind: 'complete_current' } } as never, currentResult: buildAnalysisResultBlock(fact) });
    expect(view.question?.scope.can_show_goal_chance).toBe(false);
    expect(view.options.some(row => row.cell.kind === 'figure' || row.cell.kind === 'range')).toBe(false);
  });
});
