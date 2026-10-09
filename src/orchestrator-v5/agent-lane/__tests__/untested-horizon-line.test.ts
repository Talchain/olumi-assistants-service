import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';
import {
  decisionInputLines,
  GOAL_HORIZON_NOT_TESTED,
  GOAL_CHANCE_RANGE_HORIZON_CONFLICT,
  UNTESTED_HORIZON_PREFIXES,
  untestedHorizonLine,
  untestedHorizonLineForCells,
  withA7AfterGate,
  withUntestedHorizonWarning,
  withShortHorizonBesideChance,
} from '../decision-input-ask.js';
import { GOAL_CHANCE_LICENSED } from '../../goal-target/goal-chance-licence.js';
import { GOAL_CHANCE_RANGE } from '../../goal-target/goal-chance-range.js';
import { GOAL_HORIZON_STEADY_ATTESTED, goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';

type Rec = Record<string, unknown>;
type Json = Record<string, any>;
const READ_B3: Json = JSON.parse(readFileSync(new URL('./fixtures/waveB3-unseen2-7addf05-readback-run1.json', import.meta.url), 'utf8')).j;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rangeCells = (graph: Json, result: Json) => projectCanonicalAnalysisView({
  graph, analysisState: READ_B3.analysis_state, currentResult: result as never,
  runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
    scenario_id: READ_B3.scenario_id, summary: result.summary, leading_option_id: result.leading_option_id,
    enrichment: result.enrichment, graph_hash_at_run: READ_B3.current_read.computed_against_hash,
    computed_at: READ_B3.analysis_state.run_state.computed_at, run_id: READ_B3.current_read.run_id,
  } } as never,
}).options;
const graphWith = (over: Rec = {}) => ({ nodes: [{
  id: 'goal', kind: 'goal', label: 'Monthly recurring revenue', provenance: 'from_brief',
  goal_threshold_raw: 20000, goal_threshold_unit: '£/month', goal_horizon_months: 12,
  ...over,
}], edges: [] });
const FULL = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £20,000 within 12 months.";
const NO_TARGET = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll get there within 12 months.";
const PLURAL = "These chances use the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £20,000 within 12 months.";
const SHORT = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet.";
const PLURAL_SHORT = "These chances use the model's numbers as they are today; the model doesn't project how they change over time yet.";
const ONE_FIGURE = [{ kind: 'figure' as const, display: 'about 40%' }];
const TWO_FIGURES = [...ONE_FIGURE, { kind: 'figure' as const, display: 'about 60%' }];
const RANGE_CELL = { kind: 'range' as const, display: '20%–60%', detail: { range: '20%–60%', depends_on: {
  kind: 'link_strength' as const, from_label: 'Price', to_label: 'Revenue', among: 'unsized_links' as const,
} } };

describe('Science §(ad): one horizon selector retires old clauses on a positive H', () => {
  it('withheld and none cells owe neither an old host clause nor the old Run warning', () => {
    const graph = graphWith();
    const chanceCells = [{ kind: 'withheld' as const, why: 'Chance not shown yet',
      face: 'Not shown yet: needs month-by-month changes',
      reasons: [{ code: 'GOAL_FIGURES_HORIZON_NOT_TESTED', message: 'Not shown yet: needs month-by-month changes' }] },
    { kind: 'none' as const }];
    expect(goalHorizonVerdict(graph)).toBe('withhold');
    expect(untestedHorizonLineForCells(graph, chanceCells)).toBeNull();
    expect(decisionInputLines(graph, {
      restingText: 'Run ready.', builtOrRan: true, awaitingApproval: false, questionsToggle: false, chanceCells,
    })).toEqual([]);
    const envelope = { inference_warnings: [] };
    expect(withUntestedHorizonWarning(envelope, graph, chanceCells)).toBe(envelope);
    expect(withA7AfterGate('Run ready.\n\nSaved.', graph, {
      builtOrRan: true, awaitingApproval: false, chanceCells,
    }, 'Saved.')).toBe('Run ready.\n\nSaved.');
  });

  it('positive H suppresses old horizon wording even if an intermediate cell still contains a figure or range', () => {
    const figure = { kind: 'figure' as const, display: 'about 40%' };
    const withheld = { kind: 'withheld' as const, why: 'Chance not shown yet',
      face: 'Why this figure is withheld is not recorded.', reasons: [{ code: 'reason_not_recorded', message: null }] };
    expect(untestedHorizonLineForCells(graphWith(), [figure, withheld])).toBeNull();
    expect(untestedHorizonLineForCells(graphWith(), [RANGE_CELL])).toBeNull();
    expect(untestedHorizonLineForCells(graphWith(), [figure, RANGE_CELL, withheld])).toBeNull();
  });

  it('normalization removes an earlier chance-form warning and its licence horizon metadata', () => {
    const graph = graphWith();
    const licence = { code: GOAL_CHANCE_LICENSED, severity: 'info', horizon_untested: true, horizon_line: FULL };
    const previous = { inference_warnings: [licence, { code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: FULL }] };
    const out = withUntestedHorizonWarning(previous, graph, [{ kind: 'none' }]);
    // Q-c (DL 87114): one horizon-limit statement per surface.
    expect(out.inference_warnings).toEqual([{ code: GOAL_CHANCE_LICENSED, severity: 'info' },
      { code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: "This model doesn't yet say whether any option gets there within 12 months." }]);
    expect(withShortHorizonBesideChance(out, graph, [{ kind: 'none' }])).toBe(out);
  });

  it('positive H removes old range and warning horizon metadata instead of writing a plural disclaimer', () => {
    const record = { code: GOAL_CHANCE_RANGE, severity: 'info', option_ids: ['a', 'b'], horizon_untested: true, horizon_line: SHORT };
    const envelope = { inference_warnings: [record, { code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: SHORT }] };
    const out = withUntestedHorizonWarning(envelope, graphWith(), [RANGE_CELL, RANGE_CELL]);
    expect(out.inference_warnings).toEqual([{ code: GOAL_CHANCE_RANGE, severity: 'info', option_ids: ['a', 'b'] }]);
    expect(withShortHorizonBesideChance(out, graphWith(), [RANGE_CELL, RANGE_CELL])).toBe(out);
  });

  it('a conflicted served range cannot become licensed when no held months remove the global warning', () => {
    const graph = clone(READ_B3.graph);
    const goal = graph.nodes.find((node: Json) => node.kind === 'goal');
    delete goal.goal_horizon_months;
    const result = clone(READ_B3.analysis_result);
    const record = result.enrichment.inference_warnings.find((warning: Json) => warning.code === GOAL_CHANCE_RANGE);
    record.horizon_untested = true;
    record.horizon_line = 'The recorded range qualifier.';
    result.enrichment.inference_warnings.push({ code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: 'A different recorded qualifier.' });
    const before = rangeCells(graph, result);
    expect(before.some(option => option.cell.kind === 'range')).toBe(false);
    const enrichment = withUntestedHorizonWarning(result.enrichment, graph, before.map(option => option.cell));
    const after = rangeCells(graph, { ...result, enrichment });
    expect(after).toEqual(before);
    expect(enrichment.inference_warnings.some((warning: Json) => warning.code === GOAL_HORIZON_NOT_TESTED)).toBe(false);
    expect(enrichment.inference_warnings).toContainEqual(expect.objectContaining({
      code: GOAL_CHANCE_RANGE_HORIZON_CONFLICT, original_code: GOAL_CHANCE_RANGE,
      original_message: record.message, range_by_option: record.range_by_option, horizon_line: record.horizon_line,
    }));
  });

  it('removing a positive-H qualifier cannot license a conflicted range or remove an admitted point', () => {
    const graph = clone(READ_B3.graph);
    graph.nodes.find((node: Json) => node.kind === 'goal').goal_horizon_months = 9;
    const result = clone(READ_B3.analysis_result);
    result.enrichment.inference_warnings = result.enrichment.inference_warnings.filter((warning: Json) => warning.code !== 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
    result.enrichment.inference_warnings.push({ code: GOAL_CHANCE_LICENSED, severity: 'info', form: 'each',
      option_ids: ['continue_as_now'], pct_by_option: { continue_as_now: 40 } });
    result.enrichment.option_comparison.find((option: Json) => option.option_id === 'continue_as_now').probability_of_goal = 0.4;
    const record = result.enrichment.inference_warnings.find((warning: Json) => warning.code === GOAL_CHANCE_RANGE);
    record.horizon_untested = true;
    record.horizon_line = untestedHorizonLine(graph, { besideChance: true });
    result.enrichment.inference_warnings.push({ code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: 'A conflicting original qualifier.' });
    const before = rangeCells(graph, result);
    expect(before.some(option => option.cell.kind === 'range')).toBe(false);
    expect(before.find(option => option.option_id === 'continue_as_now')?.cell).toEqual({
      kind: 'figure', display: 'about 40%',
      face: '‘Continue as now’: about 40% chance of meeting your goal, in this model, using Olumi\'s estimates for 5 relationships (see Check estimates).',
    });
    const cells = before.map(option => option.cell);
    const enrichment = withUntestedHorizonWarning(result.enrichment, graph, cells);
    const after = rangeCells(graph, { ...result, enrichment });
    expect(after).toEqual(before);
    expect(enrichment.inference_warnings.some((warning: Json) => warning.code === GOAL_HORIZON_NOT_TESTED)).toBe(false);
    expect(untestedHorizonLineForCells(graph, cells)).toBeNull();
    expect(enrichment.inference_warnings.some((warning: Json) => warning.code === GOAL_CHANCE_RANGE_HORIZON_CONFLICT)).toBe(true);
  });

  it('the historical full formatter stays byte-exact for old-copy normalization and strips only the money period', () => {
    expect(untestedHorizonLine(graphWith(), { besideChance: true })).toBe(FULL);
    expect(untestedHorizonLine(graphWith())).toBe(FULL);
  });

  it('no stated target + held months uses the no-target form', () => {
    expect(untestedHorizonLine(graphWith({ goal_threshold_raw: undefined }), { besideChance: true })).toBe(NO_TARGET);
  });

  it('two options’ chances use the exact plural form', () => {
    expect(untestedHorizonLine(graphWith(), { besideChance: true, plural: true })).toBe(PLURAL);
  });

  it('B3 by Q3 without a month count uses the short form only beside a chance', () => {
    const graph = graphWith({ goal_horizon_months: undefined, goal_deadline_as_stated: 'by Q3' });
    expect(untestedHorizonLine(graph, { besideChance: true })).toBe(SHORT);
    expect(untestedHorizonLine(graph)).toBeNull();
  });

  it('no deadline uses the short form beside a chance, including plural', () => {
    const graph = graphWith({ goal_horizon_months: undefined });
    expect(untestedHorizonLine(graph, { besideChance: true })).toBe(SHORT);
    expect(untestedHorizonLine(graph, { besideChance: true, plural: true })).toBe(PLURAL_SHORT);
  });

  it.each([0, -1, Number.NaN])('a non-positive or unknown month count (%s) keeps the short form beside a chance', (goal_horizon_months) => {
    const graph = graphWith({ goal_horizon_months });
    expect(untestedHorizonLine(graph, { besideChance: true })).toBe(SHORT);
    expect(untestedHorizonLine(graph)).toBeNull();
  });

  it('hiring uses its own held target and unit', () => {
    const graph = graphWith({ label: 'Hire engineers', goal_threshold_raw: 6, goal_threshold_unit: 'engineers', goal_horizon_months: 9 });
    expect(untestedHorizonLine(graph, { besideChance: true })).toBe("This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach 6 engineers within 9 months.");
  });

  it('a target with no unit is bare and a one-month horizon is singular', () => {
    expect(untestedHorizonLine(graphWith({ goal_threshold_raw: 6, goal_threshold_unit: undefined, goal_horizon_months: 1 }))).toBe("This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach 6 within 1 month.");
  });

  it('reads the target from the goal’s own limit row through the shared target reader', () => {
    for (const unit of ['GBP', '£/month']) {
      const graph = { ...graphWith({ goal_threshold_raw: undefined }), goal_constraints: [
        { node_id: 'goal', label: 'Monthly recurring revenue', value: 20000, unit, operator: '>=' },
      ] };
      expect(untestedHorizonLine(graph), unit).toBe(FULL);
      expect(untestedHorizonLine(graph, { besideChance: true }), unit).toBe(FULL);
    }
  });

  it('a duration limit suppresses the full form while a chance still owes the short form', () => {
    const graph = { ...graphWith(), goal_constraints: [{ node_id: 'duration', value: 12, unit: 'months', operator: '<=' }] };
    expect(untestedHorizonLine(graph)).toBeNull();
    expect(untestedHorizonLine(graph, { besideChance: true })).toBe(SHORT);
  });

  it('no held months leaves draft chat silent and only a visible chance cell supplies the short form', () => {
    const graph = graphWith({ goal_horizon_months: undefined });
    const context = { restingText: 'Draft ready.', builtOrRan: true, awaitingApproval: false, questionsToggle: false };
    expect(decisionInputLines(graph, context)).toEqual([]);
    // Warning presence never substitutes for the final cells' display permission.
    const envelope = { inference_warnings: [] };
    expect(withUntestedHorizonWarning(envelope, graph)).toBe(envelope);
    expect(withShortHorizonBesideChance(envelope, graph)).toBe(envelope);
    const unlicensed = { inference_warnings: [{ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE' }] };
    expect(withShortHorizonBesideChance(unlicensed, graph)).toBe(unlicensed);
    const licence = { code: GOAL_CHANCE_LICENSED, severity: 'info' };
    const licenceOnly = { inference_warnings: [licence] };
    expect(withShortHorizonBesideChance(licenceOnly, graph)).toBe(licenceOnly);
    expect(withShortHorizonBesideChance(licenceOnly, graph, ONE_FIGURE).inference_warnings).toEqual([
      { ...licence, horizon_untested: true, horizon_line: SHORT },
      { code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: SHORT, node_ids: ['goal'] },
    ]);
  });

  it('positive H without cells suppresses the old clause in the host and warning writer', () => {
    const graph = graphWith();
    // Q-c (DL 87114): one horizon-limit statement per surface.
    expect(decisionInputLines(graph, {
      restingText: 'Draft ready.', builtOrRan: true, awaitingApproval: false, questionsToggle: false,
    })).toEqual(["This model doesn't yet say whether any option gets there within 12 months."]);
    const empty = { inference_warnings: [] };
    // Q-c (DL 87114): one horizon-limit statement per surface.
    expect(withUntestedHorizonWarning(empty, graph)).toEqual({ inference_warnings: [{
      code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: "This model doesn't yet say whether any option gets there within 12 months.", node_ids: ['goal'],
    }] });
    expect(withUntestedHorizonWarning(empty, graph, ONE_FIGURE)).toBe(empty);
  });

  it('two intermediate chance cells cannot restore a retired month-H disclaimer', () => {
    const graph = graphWith();
    expect(decisionInputLines(graph, {
      restingText: 'Run ready.', builtOrRan: true, awaitingApproval: false, questionsToggle: false, chanceCells: TWO_FIGURES,
    })).toEqual([]);
    expect(withA7AfterGate('Run ready.\n\nSaved.', graph, {
      builtOrRan: true, awaitingApproval: false, chanceCells: TWO_FIGURES,
    }, 'Saved.')).toBe('Run ready.\n\nSaved.');
    const empty = { inference_warnings: [] };
    expect(withUntestedHorizonWarning(empty, graph, TWO_FIGURES)).toBe(empty);
  });

  it('user_set steady_attested is the month-H chance basis and owes no horizon disclaimer', () => {
    const graph = graphWith({ horizon_basis: 'steady_attested', provenance: 'user_set',
      horizon_basis_source: 'user_stated', horizon_basis_months: 12 });
    expect(goalHorizonVerdict(graph)).toBe('steady_attested');
    expect(untestedHorizonLine(graph)).toBe(FULL); // Historical identity remains available to exact-copy normalization.
    expect(untestedHorizonLineForCells(graph, TWO_FIGURES)).toBeNull();
    expect(decisionInputLines(graph, {
      restingText: 'Run ready.', builtOrRan: true, awaitingApproval: false, questionsToggle: false, chanceCells: TWO_FIGURES,
    })).toEqual([]);
    const previous = { inference_warnings: [{ code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: FULL }] };
    expect(withUntestedHorizonWarning(previous, graph, TWO_FIGURES).inference_warnings).toEqual([{
      code: GOAL_HORIZON_STEADY_ATTESTED, severity: 'info', node_ids: ['goal'],
      message: 'You said ‘Monthly recurring revenue’ stays about where it is over 12 months unless you act, so this is its chance once each option is in effect.',
    }]);
  });

  it.each(['ai_inferred', 'from_brief', undefined])('steady_attested with %s provenance still withholds', (provenance) => {
    const graph = graphWith({ horizon_basis: 'steady_attested', provenance,
      horizon_basis_source: provenance, horizon_basis_months: 12 });
    expect(goalHorizonVerdict(graph)).toBe('withhold');
    expect(untestedHorizonLineForCells(graph, TWO_FIGURES)).toBeNull();
  });

  it('B1 accumulation shape remains computed at H, with no old horizon line', () => {
    const graph = graphWith({ nonlinear_identity: { operation: 'product',
      factor_ids: ['price', 'subscribers_at_h'], stated_in_brief: true } }) as Json;
    const factors = ['subscribers_today', 'monthly_churn', 'monthly_signups'];
    graph.nodes.push({ id: 'subscribers_at_h', kind: 'outcome', nonlinear_identity: { operation: 'accumulation',
      factor_ids: factors, horizon_months: 12, rate_scale: 0.01, stated_in_brief: true } },
    { id: 'price', kind: 'factor' }, ...factors.map(id => ({ id, kind: 'factor',
      observed_state: { value: 1, source: 'user_override' } })));
    const envelope = { inference_warnings: [], identity_evaluations: [
      { node_id: 'goal', operation: 'product', factor_ids: ['price', 'subscribers_at_h'], evaluated: true },
      { node_id: 'subscribers_at_h', operation: 'accumulation', factor_ids: factors, horizon_months: 12, evaluated: true },
    ] };
    expect(goalHorizonVerdict(graph)).toBe('computed_at_h');
    expect(goalHorizonVerdict(graph, envelope)).toBe('computed_at_h');
    expect(untestedHorizonLineForCells(graph, ONE_FIGURE)).toBeNull();
    expect(withUntestedHorizonWarning(envelope, graph, ONE_FIGURE)).toBe(envelope);
    expect(goalHorizonVerdict(graph, { identity_evaluations: [envelope.identity_evaluations[0]] })).toBe('withhold');
    expect(goalHorizonVerdict(graph, { identity_evaluations: [envelope.identity_evaluations[0],
      { ...envelope.identity_evaluations[1], horizon_months: 9 }] })).toBe('withhold');
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN])('H=%s is absent under the positive-integer selector rule', (goal_horizon_months) => {
    expect(goalHorizonVerdict(graphWith({ goal_horizon_months }))).toBe('no_horizon');
  });

  it('no single goal means no clause even beside a chance', () => {
    for (const nodes of [[], [...graphWith().nodes, { id: 'other', kind: 'goal' }]]) {
      expect(untestedHorizonLine({ nodes, edges: [] }, { besideChance: true })).toBeNull();
    }
  });

  it('the exported identification pair is exact, with straight apostrophes', () => {
    expect(UNTESTED_HORIZON_PREFIXES).toEqual([
      "This chance uses the model's numbers as they are today",
      "These chances use the model's numbers as they are today",
    ]);
  });
});


describe('Science §(ad): recorded horizon withhold retires barred-range qualifier metadata', () => {
  it.each([GOAL_CHANCE_RANGE, GOAL_CHANCE_RANGE_HORIZON_CONFLICT])('cleans %s without admitting its original range', code => {
    const graph = clone(READ_B3.graph);
    graph.nodes.find((node: Json) => node.kind === 'goal').goal_horizon_months = 9;
    const result = clone(READ_B3.analysis_result);
    result.enrichment.inference_warnings = result.enrichment.inference_warnings.filter((warning: Json) => warning.code !== GOAL_HORIZON_NOT_TESTED);
    const range = result.enrichment.inference_warnings.find((warning: Json) => warning.code === GOAL_CHANCE_RANGE);
    range.code = code; range.horizon_untested = true;
    range.horizon_line = untestedHorizonLine(graph, { besideChance: true });
    result.enrichment.inference_warnings.push({ code: 'GOAL_FIGURES_HORIZON_NOT_TESTED', severity: 'warning',
      message: "Your goal is for month 9, and this model only has today's numbers." });
    const before = rangeCells(graph, result);
    expect(before.every(option => option.cell.kind === 'withheld')).toBe(true);
    const enrichment = withUntestedHorizonWarning(result.enrichment, graph, before.map(option => option.cell));
    const cleaned = enrichment.inference_warnings.find((warning: Json) => warning.code === code);
    expect(cleaned).not.toHaveProperty('horizon_line');
    expect(cleaned).not.toHaveProperty('horizon_untested');
    expect(cleaned.range_by_option).toEqual(range.range_by_option);
    expect(rangeCells(graph, { ...result, enrichment })).toEqual(before);
  });
});
