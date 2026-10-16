import { describe, expect, it } from 'vitest';
import { sentDigest } from '../../tools/handlers/run-input-digest.js';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';
import { goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { runFactsOf } from '../../agent-lane/run-facts.js';
import { withReadTimeHorizonGate } from '../goal-horizon-verdict.js';
import { STATIC_MODEL_SCOPE_NOTE, goalChanceLicenceForAgent, deriveRunQuestion } from '../goal-chance-licence.js';
import { unsizedOlumiRiskLineFor } from '../../agent-lane/unsized-risk.js';

const graph = () => ({ nodes: [
  { id: 'capacity', kind: 'goal', label: 'Weekly support capacity', goal_threshold_raw: 100, goal_threshold: 0.2,
    goal_threshold_frame: 'level', goal_threshold_unit: 'tickets per week', goal_direction: '>=', goal_threshold_cap: 500,
    goal_horizon: { deadline: '2027-03-31' }, goal_deadline_as_stated: 'by March',
    observed_state: { value: 0.16, raw_value: 80, baseline: 0.16, unit: 'tickets per week', source: 'user_override' } },
  { id: 'hire', kind: 'option', label: 'Add one specialist' }, { id: 'hold', kind: 'option', label: 'Carry on as now', is_baseline: true },
], edges: [] });
const savedRun = () => ({ run_id: 'run-N', graph_hash_at_run: '0123456789abcdef', computed_at: '2026-10-15T12:00:00.000Z',
  input_snapshot: { sent_digest: sentDigest({ graph: graph(), goal_node_id: 'capacity',
    options: [{ id: 'hire' }, { id: 'hold', is_baseline: true }] }), goal: { node_id: 'capacity', label: 'Weekly support capacity', target_raw: 100, frame: 'level', unit: 'tickets per week', operator: '>=' },
    factors: [{ factor_id: 'capacity', raw: 80, encoded: 0.16, unit: 'tickets per week' }],
    options: [{ option_id: 'hire' }, { option_id: 'hold', is_baseline: true }] },
  enrichment: { option_comparison: [{ option_id: 'hire', probability_of_goal: 0.35 }, { option_id: 'hold', probability_of_goal: 0 }],
    inference_warnings: [{ code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Each option’s chance is licensed on this Run.', form: 'each',
      goal_node_id: 'capacity', goal_label: 'Weekly support capacity', option_ids: ['hire', 'hold'],
      option_labels_by_option: { hire: 'Add one specialist', hold: 'Carry on as now' }, pct_by_option: { hire: 35 }, withheld_option_ids: ['hold'],
      target: { comparator: 'at_least', value: 100, unit: 'tickets per week', frame: 'level' },
      sent_threshold: { value: 0.2, field: 'goal_threshold', frame: 'level', baseline: 0.16, status_quo_option_id: 'hold' },
      notes: [STATIC_MODEL_SCOPE_NOTE] }] } });
const project = (run: ReturnType<typeof savedRun>, currentGraph = graph()) => projectCanonicalAnalysisView({ graph: currentGraph,
  runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: run } as never,
  analysisState: { run_state: { kind: 'complete_current' } } as never, analysisReady: {} as never,
  currentResult: { type: 'analysis_result', computed_against_hash: run.graph_hash_at_run, enrichment: run.enrichment } as never });

describe('THIS Run’s recorded omissions survive every existing scope reader', () => {
  const risk = { node_id: 'risk-N', label: 'The original provisional risk', reason: 'unsized_olumi_risk' as const };
  const omission = { scope: 'modelled_effects_only' as const, risks: [risk] };
  const recorded = () => {
    const run = savedRun();
    Object.assign(run.enrichment.inference_warnings[0]!, { omitted_from_calculation: structuredClone(omission) });
    return run;
  };
  const note = unsizedOlumiRiskLineFor(risk.label, true)!;

  it('the existing licence reader retains the stored id/reason/scope without changing its figures or permission', () => {
    const run = recorded(), before = JSON.stringify(run);
    expect(goalChanceLicenceForAgent(run)).toMatchObject({ omitted_from_calculation: omission, form: 'each', option_ids: ['hire', 'hold'] });
    expect(JSON.stringify(run)).toBe(before);
  });

  it('the selected Run question and AI packet retain the omission and its one existing disclosure', () => {
    const run = recorded();
    run.enrichment.inference_warnings[0]!.notes.push(note);
    const facts = runFactsOf(run, graph(), true);
    expect(facts.question?.run_id).toBe('run-N');
    expect(facts.question?.omitted).toContainEqual({ field: 'risk', ...risk, scope: 'modelled_effects_only' });
    expect(facts.chances.goal_chance_licence).toMatchObject({ omitted_from_calculation: omission });
    expect(facts.must_say.filter(line => line === note)).toHaveLength(1);
    expect(facts.chances.goal_chance_display?.hire).toBe('about 35%');
  });

  it.each(['point', 'range'] as const)('%s Results keep the disclosure beside their own chance through JSON readback and later edits', kind => {
    const run = recorded();
    if (kind === 'range') (run.enrichment.inference_warnings as Record<string, unknown>[]).push({ code: 'GOAL_CHANCE_RANGE',
      severity: 'info', message: 'Recorded range.', option_ids: ['hire'], range_by_option: { hire: { low_pct: 20, high_pct: 50,
        low_rounding: 'whole', high_rounding: 'whole', kind: 'link_strength', from: 'hire', to: 'capacity', among: 'unsized_links' } } });
    // The current model cannot rename or remove a historical omission; the selected saved Run owns it.
    const today = graph(); today.nodes[1]!.label = 'A later option label';
    const view = project(JSON.parse(JSON.stringify(run)), today);
    expect(view.run?.run_id).toBe('run-N');
    expect(view.options.find(o => o.option_id === 'hire')?.cell.kind).toBe(kind === 'point' ? 'figure' : 'range');
    expect(view.question?.omitted).toContainEqual({ field: 'risk', ...risk, scope: 'modelled_effects_only' });
    expect(view.goal_chance?.notes?.filter(line => line === note)).toHaveLength(1);
    const cell = view.options.find(o => o.option_id === 'hire')!.cell;
    expect('face' in cell ? cell.face : undefined).toContain(STATIC_MODEL_SCOPE_NOTE);
  });

  it('another selected Run supplies only its own omission; a missing record is never filled from today’s graph', () => {
    const earlier = recorded(), later = savedRun(); later.run_id = 'run-M';
    const today = graph();
    Object.assign(today.nodes[1]!, { kind: 'risk', provenance: 'ai_inferred', label: risk.label });
    expect(project(earlier, today).question?.omitted).toContainEqual({ field: 'risk', ...risk, scope: 'modelled_effects_only' });
    expect(project(later, today).question?.omitted.some(o => o.field === 'risk')).toBe(false);
    expect(project(later, today).goal_chance?.notes ?? []).not.toContain(note);
    expect(runFactsOf(earlier, today, false).must_say).not.toContain(note);
  });

  it('foreign selected-Run evidence cannot lend this omission or a figure permission', () => {
    const question = deriveRunQuestion({ storedResult: recorded(), runEvidence: { runId: 'run-foreign' } });
    expect(question.scope.can_show_goal_chance).toBe(false);
    expect(question.omitted.some(o => o.field === 'risk')).toBe(false);
  });

  it('a stale historical question retains its omission identity without reopening any figure or current disclosure', () => {
    const run = recorded();
    const view = projectCanonicalAnalysisView({ graph: graph(),
      runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: run } as never,
      analysisState: { run_state: { kind: 'complete_stale' } } as never, currentResult: null });
    expect(view.question?.run_id).toBe('run-N');
    expect(view.question?.omitted).toContainEqual({ field: 'risk', ...risk, scope: 'modelled_effects_only' });
    expect(view.options).toEqual([]);
    expect(view.goal_chance).toBeUndefined();
  });
});

describe('one evaluated question on canonical Results and run facts', () => {
  it('keeps the probability supplied by the Run and puts the static scope beside it', () => {
    const run = savedRun();
    const view = project(run);
    const cell = view.options.find(o => o.option_id === 'hire')!.cell;
    expect(cell.kind).toBe('figure');
    if (cell.kind !== 'figure') throw new Error('expected the licensed fixture figure');
    expect(cell.display).toBe('about 35%');
    expect(cell.face).toContain('35%');
    expect(cell.face).toContain(STATIC_MODEL_SCOPE_NOTE);
    expect(cell.face).not.toContain('by March');
    const lines = goalChanceScreenLinesForAgent({ type: 'analysis_result', enrichment: run.enrichment }, graph(), true);
    expect(cell.face).toBe(lines.find(l => l.option_id === 'hire')!.chance);
    expect(view.goal_chance?.notes ?? []).not.toContain(STATIC_MODEL_SCOPE_NOTE);
    expect(view.question?.calculated).toMatchObject({ target: 100, baseline: 80, frame: 'level', comparator: '>=' });
    expect(view.question?.evaluated_scenario_revision).toBeNull();
    expect(view.question?.evidence.missing).toContain('asked_horizon_and_reference_at_evaluated_revision');
    expect(withReadTimeHorizonGate(run, graph())).toBe(run);
  });

  it('range-only Results and coaching retain the recorded quantity instead of saying the whole dated goal was calculated', () => {
    const run = savedRun();
    Object.assign(run.enrichment.inference_warnings[0]!, { chance_words: 'chance of ‘Weekly support capacity’ being at least 100 tickets per week' });
    (run.enrichment.inference_warnings as Record<string, unknown>[]).push({ code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Recorded range.',
      option_ids: ['hire'], range_by_option: { hire: { low_pct: 20, high_pct: 50, low_rounding: 'whole', high_rounding: 'whole',
        kind: 'link_strength', from: 'hire', to: 'capacity', among: 'unsized_links' } } });
    const cell = project(run).options.find(o => o.option_id === 'hire')!.cell;
    expect(cell.kind).toBe('range');
    if (cell.kind !== 'range') throw new Error('expected the recorded fixture range');
    expect(cell.face).toContain('being at least 100 tickets per week');
    expect(cell.face).toContain(STATIC_MODEL_SCOPE_NOTE);
    expect(cell.face).not.toContain('by March');
    const facts = runFactsOf(run, graph(), true);
    expect(facts.chances.goal_chance_words).toBe('chance of ‘Weekly support capacity’ being at least 100 tickets per week');
    expect(facts.question?.scope.status).toBe('supported_static');
  });

  it('a retained zero baseline stays zero; conversion is checked on the recorded target scale', () => {
    const run = savedRun(), zero = graph();
    Object.assign(zero.nodes[0]!.observed_state!, { value: 0, raw_value: 0, baseline: 0 });
    Object.assign(run.input_snapshot.factors[0]!, { raw: 0, encoded: 0 });
    run.enrichment.inference_warnings[0]!.sent_threshold.baseline = 0;
    run.input_snapshot.sent_digest = sentDigest({ graph: zero, goal_node_id: 'capacity', options: [{ id: 'hire' }, { id: 'hold', is_baseline: true }] });
    expect(project(run, zero).question?.calculated?.baseline).toBe(0);
    expect(project(run, zero).question?.scope.status).toBe('supported_static');
    expect(withReadTimeHorizonGate(run, zero)).toBe(run);
  });

  it.each(['missing_baseline', 'wrong_frame', 'missing_digest'] as const)('a static caveat cannot license %s on Results or readback', mutant => {
    const run = savedRun();
    if (mutant === 'missing_baseline') run.input_snapshot.factors = [];
    else if (mutant === 'missing_digest') run.input_snapshot.sent_digest = '';
    else run.input_snapshot.goal.frame = 'delta';
    expect(project(run).options.every(o => o.cell.kind === 'withheld')).toBe(true);
    const gated = withReadTimeHorizonGate(run, graph());
    expect(gated).not.toBe(run);
    expect(JSON.stringify(gated)).not.toContain('pct_by_option');
    const undated = graph(); Reflect.deleteProperty(undated.nodes[0]!, 'goal_horizon');
    Reflect.deleteProperty(undated.nodes[0]!, 'goal_deadline_as_stated');
    expect(JSON.stringify(withReadTimeHorizonGate(run, undated))).not.toContain('pct_by_option');
    const facts = runFactsOf(run, undated, true);
    expect(JSON.stringify(facts.chances)).not.toContain('35');
    expect(facts.must_say).toContain('The inputs needed to verify this static calculation were not retained. Run the analysis again on the saved model.');
    expect(project(run).leader.goal_chance_leader).toBeNull();
    expect(JSON.stringify(project(run).goal_chance ?? null)).not.toContain('35');
  });

  it('a missing Run identity withholds a marked static figure', () => {
    const run = savedRun(); Reflect.deleteProperty(run, 'run_id');
    const view = project(run);
    expect(view.question?.run_id).toBeNull();
    expect(view.options.every(o => o.cell.kind === 'withheld')).toBe(true);
  });

  it('run facts never borrow the current model to complete Run N’s question', () => {
    const run = savedRun(), later = graph(); later.nodes[0]!.goal_threshold_raw = 150;
    const facts = runFactsOf({ type: 'analysis_result', enrichment: run.enrichment }, later, true, {
      runEvidence: { runId: run.run_id, inputSnapshot: run.input_snapshot,
        occurrence: { fact_row_id: 'fact-N', evaluated_scenario_revision: 12 } },
    });
    expect(facts.question?.run_id).toBe('run-N');
    expect(facts.question?.evaluated_scenario_revision).toBe(12);
    expect(facts.question?.calculated?.target).toBe(100);
    expect(facts.question?.asked?.target).toBe(100);
    expect(facts.question?.asked?.option_ids).toBeUndefined();
    expect(facts.question?.calculated?.option_ids).toEqual(['hire', 'hold']);
    expect(facts.question?.evidence.missing).toContain('asked_options_at_evaluated_revision');
    expect(facts.question?.evidence.missing).toContain('historical_model_at_evaluated_revision');
  });
});
