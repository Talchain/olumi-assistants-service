/**
 * ⭐ F1 (Track 3; DL lease 21 Oct): a zero-spread result that is the person's own exact arithmetic says which side of the target
 * the model's result is on ("With your exact figures, …"), worded by the goal's comparator, and never a chance. One Olumi
 * default on the goal's path keeps #3017's line. The goal certainty's zero-spread skip (`goal-certainty.ts`) is unchanged.
 *
 * Corpus: OPTION_EFFECTS (today 40, at least 60; A adds exactly 30, B exactly 19.9) through the core mapper, the REAL snapshot
 * loader and run_analysis handler, and a local PLoT b60fe4fb → ISL 8d862f5a, recorded (`tests/fixtures/zero-spread/…`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectCanonicalAnalysisCells } from '../canonical-analysis-view.js';
import { exactnessEarned } from '../../orchestrator-v5/agent-lane/goal-certainty.js';
import {
  GOAL_CHANCE_LICENSED, goalChanceLicenceForAgent, goalChanceLicenceOf, ZERO_SPREAD_LINE, zeroSpreadExactLine,
} from '../../orchestrator-v5/goal-target/goal-chance-licence.js';

type Rec = Record<string, any>;
const REC = JSON.parse(readFileSync('tests/fixtures/zero-spread/local-exact-sum-option-effects-20261021.json', 'utf8')) as Rec;
const RUN = REC.analysis_result as Rec;
const EVALUATIONS = RUN.enrichment.identity_evaluations as Rec[];
const A_LINE = 'With your exact figures, the model’s result for ‘Option A’ is at or above the target. '
  + 'It can’t say how likely that is: add a range to the figures you’re least sure of.';
const B_LINE = 'With your exact figures, the model’s result for ‘Option B’ is below the target. '
  + 'It can’t say how likely that is: add a range to the figures you’re least sure of.';
const EXACT = { a: { reason: 'zero_spread', side: 'meets', line: A_LINE, basis: 'exact_own_figures' },
  b: { reason: 'zero_spread', side: 'falls_short', line: B_LINE, basis: 'exact_own_figures' } };
const licenceRecord = (result: Rec): Rec => (result.enrichment.inference_warnings as Rec[]).find((w) => w.code === GOAL_CHANCE_LICENSED)!;
const produce = (graph: Rec, envelope: Rec = RUN.enrichment) => goalChanceLicenceOf(envelope, graph, 'w')?.withheld_reason_by_option;
const cells = (result: Rec) => projectCanonicalAnalysisCells(result as never, REC.graph, result.goal_certainty);
/** Olumi's inference in place of the person's figure, as the mapper stamps one (`levelSource`: olumi → cee_inference). */
const olumis = (record: Rec): void => { record.source = 'cee_inference'; delete record.extractionType; };
const node = (graph: Rec, id: string): Rec => (graph.nodes as Rec[]).find((n) => n.id === id)!;

describe('F1: a zero-spread result on the person’s own exact figures says its side, never a chance', () => {
  it('precondition (recorded Run): every draw gave one value, A at 70 and B at 59.9, on the identity this Run evaluated', () => {
    const rows = RUN.enrichment.option_comparison as Rec[];
    expect(rows.map((r) => [r.option_id, r.probability_of_goal, r.outcome.p10, r.outcome.p90]))
      .toEqual([['a', 1, 70, 70], ['b', 0, 59.9, 59.9]]);
    expect(EVALUATIONS).toEqual([expect.objectContaining({ node_id: 'w', operation: 'sum', evaluated: true, level_source: 'stated_level' })]);
    // The certainty walk still skips zero spread: no decision for either option.
    expect(RUN.goal_certainty).toEqual([]);
  });

  it('EARNED: the producer says each side by the comparator (at least 60), typed, and shows no chance', () => {
    expect(exactnessEarned(REC.graph, 'a', EVALUATIONS)).toBe(true);
    expect(exactnessEarned(REC.graph, 'b', EVALUATIONS)).toBe(true);
    expect(produce(REC.graph)).toEqual(EXACT);
    // The handler's own stored write is the same.
    expect(licenceRecord(RUN)).toMatchObject({ withheld_option_ids: ['a', 'b'], pct_by_option: {}, withheld_reason_by_option: EXACT });
    expect(zeroSpreadExactLine('Option A', 'at or above')).toBe(A_LINE);
    for (const line of [A_LINE, B_LINE]) expect(line).not.toMatch(/\d\s*%|\bcertain|\bwill\b|\bmeets\b|falls short|chance/i);
  });

  it('ONE OLUMI DEFAULT: B’s effect as Olumi’s inference keeps #3017’s line for B only', () => {
    const graph = structuredClone(REC.graph) as Rec;
    olumis(node(graph, 'b').interventions.w__change);
    expect(exactnessEarned(graph, 'b', EVALUATIONS)).toBe(false);
    expect(produce(graph)).toEqual({ a: EXACT.a, b: { reason: 'zero_spread', side: 'falls_short', line: ZERO_SPREAD_LINE } });
  });

  it('ONE OLUMI DEFAULT: a level on the path as Olumi’s inference (the sum’s today part) keeps #3017’s line for both', () => {
    // The goal's own today as Olumi's is refused before this (the licence needs the person's today, and the mapper builds no
    // exact sum without it); the level rule is what holds for a defined quantity's parts (Track 2).
    const graph = structuredClone(REC.graph) as Rec;
    olumis(node(graph, 'w_today').observed_state);
    expect(exactnessEarned(graph, 'a', EVALUATIONS)).toBe(false);
    expect(produce(graph)).toEqual({ a: { reason: 'zero_spread', side: 'meets', line: ZERO_SPREAD_LINE },
      b: { reason: 'zero_spread', side: 'falls_short', line: ZERO_SPREAD_LINE } });
  });

  it('NOT EVALUATED: a Run that did not evaluate the identity has no exact sum to rest on: #3017’s line', () => {
    const envelope = { ...structuredClone(RUN.enrichment), identity_evaluations: [] };
    expect(exactnessEarned(REC.graph, 'a', [])).toBe(false);
    expect(produce(REC.graph, envelope)).toEqual({ a: { reason: 'zero_spread', side: 'meets', line: ZERO_SPREAD_LINE },
      b: { reason: 'zero_spread', side: 'falls_short', line: ZERO_SPREAD_LINE } });
  });

  it('COMPARATOR: at most 60 says the other side for each, never a chance', () => {
    const graph = structuredClone(REC.graph) as Rec;
    node(graph, 'w').goal_direction = '<=';
    const envelope = structuredClone(RUN.enrichment) as Rec;
    for (const r of envelope.option_comparison as Rec[]) r.probability_of_goal = r.option_id === 'a' ? 0 : 1;
    expect(produce(graph, envelope)).toEqual({
      a: { reason: 'zero_spread', side: 'falls_short', line: zeroSpreadExactLine('Option A', 'above'), basis: 'exact_own_figures' },
      b: { reason: 'zero_spread', side: 'meets', line: zeroSpreadExactLine('Option B', 'at or below'), basis: 'exact_own_figures' } });
  });

  it('REOPEN: the stored Run, through the read’s own cell projector, says each stored line verbatim', () => {
    const projected = cells(RUN);
    expect(projected.find((c) => c.option_id === 'a')!.cell).toMatchObject({ kind: 'withheld', why: A_LINE });
    expect(projected.find((c) => c.option_id === 'b')!.cell).toMatchObject({ kind: 'withheld', why: B_LINE });
    expect(goalChanceLicenceForAgent(RUN as never)?.withheld_reason_by_option).toEqual(EXACT);
  });

  it('REOPEN CONTRAST: a stored basis beside another line is not kept (a basis never re-labels a line)', () => {
    const stored = structuredClone(RUN) as Rec;
    licenceRecord(stored).withheld_reason_by_option.a.line = ZERO_SPREAD_LINE;
    expect(goalChanceLicenceForAgent(stored as never)?.withheld_reason_by_option?.a)
      .toEqual({ reason: 'zero_spread', side: 'meets', line: ZERO_SPREAD_LINE });
  });
});
