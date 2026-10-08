/** DL + a1, 8 Oct: one producer scopes words to options without a licensed range; controls keep their rules. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceFactsForAgent } from '../../goal-target/goal-chance-range-agent.js';
import { targetNotTestableWarning, targetTestabilityOf } from '../../admission/target-testability.js';
import { goalChanceWithheldForAgent, RANGE_OPENING } from '../goal-chance-withheld.js';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../goal-chance-screen-lines.js';
import { bindGuidedSizing, guidedSizingActions, guidedSizingForRun, guidedSizingReplyText, guidedSizingSentence,
  legacyGuidedSizingReplyText } from '../guided-sizing.js';
import { composeReplyShape, withholdDisclosureForCells } from '../reply/compose-reply.js';
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';

type Json = Record<string, any>;
const CAPTURE = (JSON.parse(readFileSync(new URL('../method-turn/__tests__/fixtures/w9b/C.json', import.meta.url), 'utf8')) as Json).j;
const B2 = JSON.parse(readFileSync(new URL('./fixtures/guided-sizing-range-wins.json', import.meta.url), 'utf8')) as Json;
const WORDS = "The chance isn't shown yet: the model doesn't yet say how strongly ‘Starter tier price’ affects ‘Starter subscribers’, so any figure would be a guess.";
const MIXED_WORDS = "The chance isn't shown yet: the model doesn't yet say how strongly ‘Existing plan price’ affects ‘Existing subscribers’, so any figure would be a guess.";
const RANGE_LINE = '‘Launch starter tier’: between about 5% and 37% chance of meeting your goal, in this model.';
const RANGE_DEPENDS = 'Of the links not sized yet, it depends most on how strongly ‘Starter tier price’ affects ‘Starter subscribers’, which isn’t sized in the model yet.';
const withoutRange = (run: Json): Json => ({ ...run, enrichment: { ...run.enrichment,
  inference_warnings: run.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_RANGE') } });
const said = (run: Json, graph: Json): string => withScreenLinesOwed(goalChanceWithheldForAgent(run, graph)?.say ?? '',
  goalChanceScreenLinesForAgent(run, graph, true)).text;

describe('RANGE WINS at the guided sentence producer', () => {
  it('the scenario-read range cell also keeps the typed reply free of a withheld chance marker', () => {
    const { graph, run } = structuredClone(B2);
    const read = withCanonicalAnalysisView({ graph,
      analysis_state: { run_state: { kind: 'complete_current' } },
      analysis_result: { ...run, type: 'analysis_result' },
    }, 'range-wins-canonical-read');
    const cells = read.canonical_analysis_view.options.map(option => option.cell);
    expect(cells.map(cell => cell.kind)).toEqual(['range']);
    expect(withholdDisclosureForCells(graph, cells)).toBeNull();
    const lines = goalChanceScreenLinesForAgent(run, graph, true);
    const composed = composeReplyShape({ faceContract: 'run', text: said(run, graph), graph, chanceCells: cells,
      obligations: lines.flatMap(line => [
        { role: 'evidence' as const, text: line.chance, lead: true as const, subjects: [line.option_id] },
        { role: 'evidence' as const, text: line.depends, subjects: [line.option_id], companionOf: line.option_id },
      ]),
    });
    expect(composed.shape).not.toBeNull();
    const face = [composed.shape!.headline, ...composed.shape!.bullets].join('\n');
    expect(face).toContain(RANGE_LINE);
    expect(face).toContain(RANGE_DEPENDS);
    expect(composed.text).not.toMatch(/Not shown|The chance isn't shown yet/);
    expect(guidedSizingReplyText(guidedSizingForRun(run, graph)).guided).toBeNull();
  });

  it('row 1 B2 constructed: the ranged starter keeps its range and produces no guided sentence', () => {
    const { graph, run } = structuredClone(B2);
    expect(goalChanceFactsForAgent(run, graph, true).goal_chance_range_display?.starter.range).toBe('between about 5% and 37%');
    const draft = guidedSizingForRun(run, graph)!;
    expect(guidedSizingReplyText(draft).guided).toBeNull();
    expect(draft.sentence_draft).toBeNull();
    expect(legacyGuidedSizingReplyText(draft)).toBeNull();
    expect(guidedSizingSentence(draft)).toBe('');
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(RANGE_OPENING);
    expect(said(run, graph)).toBe(`${RANGE_OPENING} ${RANGE_LINE} ${RANGE_DEPENDS}`);
    expect(said(run, graph)).not.toContain("The chance isn't shown yet");
    // Even an old recorded GP header cannot be resurrected by the warning fallback.
    run.enrichment.inference_warnings[0].message = WORDS;
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(RANGE_OPENING);
    expect(guidedSizingReplyText(guidedSizingForRun(run, graph, true)).guided).toBeNull();
    const controls = guidedSizingActions(draft, graph);
    expect(controls).toEqual(guidedSizingActions(guidedSizingForRun(withoutRange(run), graph), graph));
    const hook = bindGuidedSizing(draft, controls, { graph_hash: '0123456789abcdef', run_key: 'b2' });
    expect(hook?.links).toHaveLength(controls.length);
    expect(hook).not.toHaveProperty('sentence_draft');
  });

  it('row 2 contrast: without a range the guided sentence keeps its exact bytes', () => {
    const { graph, run } = structuredClone(B2);
    const plain = withoutRange(run);
    expect(guidedSizingForRun(plain, graph)).not.toHaveProperty('sentence_draft');
    expect(guidedSizingReplyText(guidedSizingForRun(plain, graph)).guided).toBe(WORDS);
    expect(goalChanceWithheldForAgent(plain, graph)?.say).toBe(WORDS);
    expect(said(plain, graph)).toBe(WORDS);
  });

  it('single-link B2 fallback: no multi-link controls exist, and the words-only producer still lets the range win', () => {
    const { graph, run } = structuredClone(B2);
    graph.edges[2].provenance = { magnitude: 'user_stated', natural_effect: {
      amount: 49, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'subscribers', strength_mean: 0.5,
    } };
    expect(guidedSizingForRun(run, graph)).toBeUndefined();
    expect(guidedSizingActions(guidedSizingForRun(run, graph), graph)).toEqual([]);
    expect(guidedSizingReplyText(guidedSizingForRun(run, graph, true)).guided).toBeNull();
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(RANGE_OPENING);
    expect(said(run, graph)).toContain(RANGE_LINE);
    expect(said(run, graph)).not.toContain("The chance isn't shown yet");
    expect(goalChanceWithheldForAgent(withoutRange(run), graph)?.say)
      .toBe(`${WORDS} Give a rough strength for it to see the chance.`);
  });

  it('all withheld options ranged: an unrelated scored option cannot revive the dropped sentence through a shared path', () => {
    const { graph, run } = structuredClone(B2);
    graph.nodes.push({ id: 'unrelated', kind: 'option', label: 'Other scored option', interventions: { price: 0.9 } });
    run.enrichment.option_comparison.push({ option_id: 'unrelated', status: 'computed' });
    // The placeholder warning still belongs only to starter, and starter has a licensed range.
    expect(guidedSizingReplyText(guidedSizingForRun(run, graph)).guided).toBeNull();
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(RANGE_OPENING);
  });

  it('row 3 mixed: only the un-ranged option’s links are named, while both existing controls survive', () => {
    const { graph, run } = structuredClone(B2);
    graph.nodes.push({ id: 'raise', kind: 'option', label: 'Raise existing price', interventions: { existing_price: 0.7 } },
      { id: 'existing_price', kind: 'factor', label: 'Existing plan price', observed_state: { value: 0.5, raw_value: 50, unit: '£', cap: 100 } },
      { id: 'existing_subscribers', kind: 'factor', label: 'Existing subscribers', observed_state: { value: 0.5, raw_value: 500, unit: 'subscribers', cap: 1000 } });
    graph.edges.push({ from: 'raise', to: 'existing_price', strength: { mean: 1, std: 0.01 } },
      { from: 'existing_price', to: 'existing_subscribers', strength: { mean: 0.5, std: 0.125 }, provenance: { magnitude: 'olumi_placeholder' } },
      { from: 'existing_subscribers', to: 'goal', strength: { mean: 0.5, std: 0.125 }, provenance: { magnitude: 'olumi_estimate' } });
    run.enrichment.option_comparison.push({ option_id: 'raise', status: 'computed' });
    run.enrichment.inference_warnings[0].option_ids.push('raise');
    run.enrichment.inference_warnings[0].acceptable_links.push({ from: 'existing_price', to: 'existing_subscribers' });
    const draft = guidedSizingForRun(run, graph)!;
    expect(draft.total).toBe(2);
    expect(guidedSizingReplyText(draft).guided).toBe(MIXED_WORDS);
    expect(draft.sentence_draft?.total).toBe(1);
    expect(goalChanceWithheldForAgent(run, graph, draft, guidedSizingReplyText(draft).guided)?.say).toContain(MIXED_WORDS);
    expect(said(run, graph)).toContain(RANGE_LINE);
    expect(said(run, graph)).toContain(MIXED_WORDS);
    expect(goalChanceWithheldForAgent(run, graph)?.say).not.toContain('how strongly ‘Starter tier price’');
    expect(guidedSizingActions(draft, graph)).toEqual(guidedSizingActions(guidedSizingForRun(withoutRange(run), graph), graph));
    expect(guidedSizingActions(draft, graph).filter(a => a.label.startsWith('How strongly')).map(a => a.parameters.from))
      .toEqual(['price', 'existing_price']);
  });

  it('unchanged served w9b C capture: all acceptable placeholder options have ranges, so no GP sentence is produced', () => {
    const { graph, analysis_result: run } = structuredClone(CAPTURE);
    expect(Object.keys(goalChanceFactsForAgent(run, graph, true).goal_chance_range_display ?? {}))
      .toEqual(['raise_prices_10', 'launch_starter_tier']);
    expect(guidedSizingReplyText(guidedSizingForRun(run, graph, true)).guided).toBeNull();
    expect(goalChanceWithheldForAgent(run, graph)?.say).not.toContain("The chance isn't shown yet");
    expect(said(run, graph)).toContain('between about 37% and 47%');
  });

  it('mixed causes: the scoped GP sentence retains a separate un-ranged option’s target blocker', () => {
    const { graph, run } = structuredClone(B2);
    graph.nodes.push({ id: 'plain', kind: 'option', label: 'Change existing plan', interventions: { existing: 0.7 } },
      { id: 'independent', kind: 'option', label: 'Run a campaign', interventions: { budget: 0.7 } },
      { id: 'existing', kind: 'factor', label: 'Existing plan price', observed_state: { value: 0.5, raw_value: 50, unit: '£', cap: 100 } },
      { id: 'budget', kind: 'factor', label: 'Campaign spend', observed_state: { value: 0.5, raw_value: 50, unit: '£', cap: 100 } });
    graph.edges.push({ from: 'plain', to: 'existing', strength: { mean: 1, std: 0.01 } },
      { from: 'independent', to: 'budget', strength: { mean: 1, std: 0.01 } },
      { from: 'existing', to: 'goal', strength: { mean: 0.5, std: 0.125 }, provenance: { magnitude: 'olumi_placeholder' } },
      { from: 'budget', to: 'goal', strength: { mean: 0.5, std: 0.125 }, provenance: { magnitude: 'olumi_estimate' } });
    run.enrichment.option_comparison.push({ option_id: 'plain', status: 'computed' }, { option_id: 'independent', status: 'computed' });
    run.enrichment.inference_warnings[0].option_ids.push('plain');
    run.enrichment.inference_warnings[0].acceptable_links.push({ from: 'existing', to: 'goal' });
    run.enrichment.inference_warnings.push(targetNotTestableWarning(graph, targetTestabilityOf(graph), ['independent'], 'GOAL_FIGURES_TARGET_NOT_TESTABLE'));
    const draft = guidedSizingForRun(run, graph)!;
    expect(goalChanceWithheldForAgent(run, graph)?.say).toContain('Campaign spend');
    expect(guidedSizingReplyText(draft).guided).toContain('Existing plan price');
    expect(guidedSizingReplyText(draft).guided).not.toContain('Campaign spend');
    expect(guidedSizingReplyText(draft).guided).not.toContain('Give a rough strength');
  });
});
