import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { projectCanonicalAnalysisView } from '../canonical-analysis-view.js';
import { goalChanceCellFacesForAgent, goalChanceScreenLinesForAgent } from '../../orchestrator-v5/agent-lane/goal-chance-screen-lines.js';
import { buildAnalysisResultBlock } from '../../orchestrator-v5/compose.js';
import { readStoredGoalCertainty } from '../../orchestrator-v5/tools/handlers/run-goal-certainty.js';
import * as chanceReaders from '../../orchestrator-v5/goal-target/goal-chance-range-agent.js';

type Json = Record<string, any>;
const saved: Json = JSON.parse(readFileSync(new URL('./fixtures/canonical-view-b1.json', import.meta.url), 'utf8')).j;
// Pasted bytes, NOT imports from the implementation. DGAI
// src/canvas/runView/runView.ts:25 / :27 @ dl/ws5-option-card-chance-headline
// 8f53cea7eb4cb04bea5bd54b3f06d2f076d5cc8c (same strings on staging 5bd88ba9).
const RUN_AGAIN_FOR_CHANCE = 'Run the analysis again to see the chance.';
const OPTION_CHANCE_WITHHELD = 'Olumi can’t yet say its chance of meeting your goal, in this model.';
const graph = { nodes: [
  { id: 'raise', kind: 'option', label: 'Raise' }, { id: 'keep', kind: 'option', label: 'Keep' },
  { id: 'price', kind: 'factor', label: 'Price' }, { id: 'revenue', kind: 'goal', label: 'Revenue' },
], edges: [] };
const licence = { code: 'GOAL_CHANCE_LICENSED', severity: 'info', form: 'each',
  option_ids: ['raise', 'keep'], withheld_option_ids: ['raise'], pct_by_option: { keep: 63 } };
const certainty = { option_id: 'raise', probability_of_goal: 1, earned: false,
  unsized_path: { from: 'price', enters_goal_through: 'revenue' }, no_break_even: 'not_an_identity',
  say: 'Olumi can’t yet say how likely ‘Raise’ is to meet the goal: it depends on how ‘Price’ moves ‘Revenue’, which isn’t sized.' };
const identity = { code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', severity: 'warning',
  message: 'Not shown. This run could not calculate the goal from its parts.' };
function args(warnings: Json[] = [licence], decisions: Json[] = []): Json {
  return { graph, runFact: { fact_type: 'run_analysis', result: { goal_certainty: decisions } },
    analysisState: { run_state: { kind: 'complete_current' } },
    derivation: { freshness: 'fresh' }, currentResult: { type: 'analysis_result', enrichment: {
      option_comparison: [{ option_id: 'raise' }, { option_id: 'keep' }], inference_warnings: warnings,
    } } };
}
function project(input: Json): Json { return projectCanonicalAnalysisView(input as never); }
const cell = (view: Json, id = 'raise'): Json => view.options.find((o: Json) => o.option_id === id).cell;

describe('canonical cell faces — moved copy, one existing chance composer', () => {
  it('FACE-DIGITS: captured point faces equal the existing CEE prose and their displayed percentages', () => {
    const run: Json = { fact_type: 'run_analysis', result: { scenario_id: saved.scenario_id,
      summary: saved.analysis_result.summary, enrichment: saved.analysis_result.enrichment,
      goal_certainty: saved.analysis_goal_certainty, graph_hash_at_run: saved.current_read.computed_against_hash } };
    const input = { ...args(), graph: saved.graph, runFact: run,
      currentResult: buildAnalysisResultBlock(run as never), analysisState: saved.analysis_state };
    const before = JSON.stringify(input);
    const view = project(input);
    const lines = goalChanceScreenLinesForAgent(input.currentResult, input.graph, true);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const c = cell(view, line.option_id);
      expect(c.face).toBe(line.chance);
      expect(c.face).toContain(`${c.display} chance of meeting your goal, in this model`);
      expect(c.face.match(/(?:about|less than|more than) (\d+)%/)?.[1])
        .toBe(c.display.match(/(\d+)%/)?.[1]);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it('FACE-RANGE-DIGITS: a licensed range keeps both displayed endpoints and the existing sentence', () => {
    const range = { code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Some options have a licensed range.', option_ids: ['raise'], range_by_option: {
      raise: { low_pct: 23, high_pct: 90, low_rounding: 'whole', high_rounding: 'nearest_5',
        kind: 'link_strength', from: 'price', to: 'revenue', among: 'all' },
    } };
    const input = args([licence, { code: 'GOAL_FIGURES_PLACEHOLDER_PATH', option_ids: ['raise'], message: 'Not shown. The price link is not sized.' }, range]);
    const c = cell(project(input));
    expect(c.kind).toBe('range');
    expect(c.face).toBe('‘Raise’: between about 23% and 90% chance of meeting your goal, in this model.');
    expect(c.face).toBe(goalChanceScreenLinesForAgent(input.currentResult, graph, true)[1]?.chance);
    expect(c.face.match(/\d+%/g)).toEqual(c.display.match(/\d+%/g));
  });

  it('FACE-RANGE-NO-STATED: no licensed sentence means no face key; both cell types permit its absence', () => {
    // Projection fixture at the existing licensed-reader seam: stated_time is
    // optional in GoalChanceRangeDisplay. Today's raw-record reader synthesises
    // it; this exercises the composer's explicit no-stated-block branch.
    const spy = vi.spyOn(chanceReaders, 'goalChanceFactsForAgent').mockReturnValue({
      goal_chance_range_display: { raise: {
        range: 'between about 23% and 90%',
        depends_on: { kind: 'stated_time', from_label: 'Price', to_label: 'Revenue', among: 'all' },
      } },
    });
    try {
      let view: Json = {};
      expect(() => { view = project(args()); }).not.toThrow();
      const c = cell(view);
      expect(c.kind).toBe('range');
      // Inspect the object itself: JSON would silently strip face: undefined.
      expect('face' in c).toBe(false);

      // Compile assignments against the ACTUAL exported alias, rather than an
      // erased expectTypeOf assertion (the repo's build gate excludes tests).
      const source = ts.createSourceFile('canonical-analysis-view.ts',
        readFileSync(new URL('../canonical-analysis-view.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
      const alias = source.statements.find((node): node is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(node) && node.name.text === 'CanonicalAnalysisCell');
      if (alias === undefined) throw new Error('CanonicalAnalysisCell type alias is missing');
      const contract = ts.createSourceFile('/face-contract.ts', `
        type GoalChanceRangeDisplay = unknown;
        type RecordedGoalChanceWithholdReason = unknown;
        ${alias.getText(source)}
        const figure: CanonicalAnalysisCell & { kind: 'figure' } = { kind: 'figure', display: 'about 63%' };
        const range: CanonicalAnalysisCell & { kind: 'range' } = { kind: 'range', display: 'between about 23% and 90%', detail: {} };
      `, ts.ScriptTarget.Latest, true);
      const options = { noLib: true, noEmit: true, strict: true };
      const host = ts.createCompilerHost(options);
      host.getSourceFile = filename => filename === contract.fileName ? contract : undefined;
      const program = ts.createProgram([contract.fileName], options, host);
      expect(program.getSemanticDiagnostics(contract).map(diagnostic =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('FACE-WITHHELD-IDENTITY: Run-wide words precede stored certainty and the licence line', () => {
    expect(readStoredGoalCertainty([certainty])).toBeDefined();
    expect(cell(project(args([licence, identity], [certainty]))).face).toBe(identity.message);
  });

  it('FACE-WITHHELD-CERTAINTY: the same Run’s recorded say precedes the licence line', () => {
    expect(cell(project(args([licence], [certainty]))).face).toBe(certainty.say);
    const bad = { ...certainty, no_break_even: 'unknown_future_reason' };
    expect(cell(project(args([licence], [bad]))).face).toBe(`‘Raise’: ${OPTION_CHANCE_WITHHELD}`);
  });

  it('FACE-WITHHELD-LICENCE: the named licence line precedes the option fallback', () => {
    expect(cell(project(args())).face).toBe(`‘Raise’: ${OPTION_CHANCE_WITHHELD}`);
  });

  it('FACE-LABELS: only a recorded string or graph label may name a withheld option', () => {
    const input = args([{ ...licence, option_ids: ['toString', 'keep'], withheld_option_ids: ['toString'],
      option_labels_by_option: {} }]);
    input.graph = { ...graph, nodes: graph.nodes.map(node => node.id === 'raise' ? { ...node, id: 'toString' } : node) };
    input.currentResult.enrichment.option_comparison[0].option_id = 'toString';
    expect(cell(project(input), 'toString').face).toBe(`‘Raise’: ${OPTION_CHANCE_WITHHELD}`);
  });

  it('FACE-WITHHELD-FALLBACK: no identity, certainty or licence line uses the frozen option sentence', () => {
    const input = args([{ code: 'GOAL_FIGURES_PROBABILITY_UNUSABLE', option_ids: ['raise'] }]);
    expect(cell(project(input)).face).toBe(OPTION_CHANCE_WITHHELD);
  });

  it('FACE-BYTE-IDENTITY: fallback and stale bytes equal DGAI’s pasted constants, including U+2019', () => {
    const fallback = cell(project(args([{ code: 'GOAL_FIGURES_PROBABILITY_UNUSABLE', option_ids: ['raise'] }]))).face;
    const stale = project({ ...args(), derivation: { freshness: 'stale' }, analysisState: { run_state: { kind: 'complete_stale' } } });
    expect(Buffer.from(fallback ?? '')).toEqual(Buffer.from(OPTION_CHANCE_WITHHELD));
    expect(Buffer.from(stale.face_when_stale ?? '')).toEqual(Buffer.from(RUN_AGAIN_FOR_CHANCE));
  });

  it('FACE-STALE: the rerun sentence exists only beside a real stale Run, without reopening currentness gates', () => {
    const input = { ...args(), derivation: { freshness: 'stale' }, analysisState: { run_state: { kind: 'complete_stale' } } };
    const stale = project(input);
    expect(stale.face_when_stale).toBe(RUN_AGAIN_FOR_CHANCE);
    expect(stale.options).toEqual([]);
    expect(project(args())).not.toHaveProperty('face_when_stale');
    expect(project({ ...input, runFact: null })).not.toHaveProperty('face_when_stale');
    expect(project({ ...args(), derivation: null })).not.toHaveProperty('face_when_stale');
  });

  it('FACE-NONE: no cell sentence, leaving the UI’s empty-cell words to the UI', () => {
    expect(cell(project(args([])))).toEqual({ kind: 'none' });
  });

  it('FACE-ALL-FORMS: a licensed point has a face even when its sentence is not owed in narration', () => {
    const similar = { code: 'GOAL_CHANCE_LICENSED', form: 'similar', option_ids: ['raise', 'keep'],
      similar_option_ids: ['raise', 'keep'], pct_by_option: { raise: 47, keep: 52 } };
    const input = args([similar]);
    expect(goalChanceScreenLinesForAgent(input.currentResult, graph, true)).toEqual([]);
    expect(cell(project(input)).face).toBe('‘Raise’: about 47% chance of meeting your goal, in this model.');
  });

  it('FACE-UNNAMED: reuses the chance words without guessing a label; narration still drops the unnamed option', () => {
    const input = args();
    input.graph = { ...graph, nodes: graph.nodes.filter(node => node.id !== 'keep') };
    expect(cell(project(input), 'keep').face).toBe('about 63% chance of meeting your goal, in this model.');
    expect(goalChanceScreenLinesForAgent(input.currentResult, input.graph, true)).toEqual([]);
    expect(goalChanceCellFacesForAgent(input.currentResult, input.graph, false).size).toBe(0);
  });

  it('FACE-NARRATION-BYTES: the extraction keeps captured point sentences and estimate attribution byte-identical', () => {
    const input = args([{ code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['raise', 'keep'],
      pct_by_option: { raise: 47, keep: 52 }, olumi_estimate_link_count: 2 }]);
    const expected = [
      '‘Raise’: about 47% chance of meeting your goal, in this model, using Olumi\'s estimates for 2 relationships (see Check estimates).',
      '‘Keep’: about 52% chance of meeting your goal, in this model, using Olumi\'s estimates for 2 relationships (see Check estimates).',
    ];
    expect(goalChanceScreenLinesForAgent(input.currentResult, graph, true).map(line => line.chance)).toEqual(expected);
    expect(project(input).options.map((option: Json) => option.cell.face)).toEqual(expected);
  });

  it('FACE-IDENTITY-READER: moved UI reader keeps target precedence, deduplication and unsafe-word fallback', () => {
    const placeholder = { code: 'GOAL_FIGURES_PLACEHOLDER_PATH', message: 'Not shown. A link is not sized.' };
    const target = { code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', message: 'Not shown. The target cannot be tested yet.' };
    expect(cell(project(args([licence, placeholder, target, identity, identity]))).face)
      .toBe(`${target.message} ${identity.message}`);
    expect(cell(project(args([licence, { ...identity, message: 'Not shown. raw_node_id is unresolved.' }]))).face)
      .toBe("Not shown. Olumi can't give each option's figures for this goal from this run.");
  });
});
