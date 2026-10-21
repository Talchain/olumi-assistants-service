/**
 * ⭐ F1 (Track 3; Paul 21 Oct: exact figures are a positive): a zero-spread result that is the person's own exact arithmetic says
 * the level it reaches and its margin, the figure that keeps it there, and one question on that figure; never a chance. One
 * Olumi default on the goal's path keeps #3017's line. The goal certainty's zero-spread skip (`goal-certainty.ts`) is unchanged.
 *
 * Corpus: OPTION_EFFECTS (today 40, at least 60; A adds exactly 30, B exactly 19.9) through the core mapper, the REAL snapshot
 * loader and run_analysis handler, and a local PLoT b60fe4fb → ISL 8d862f5a, recorded (`tests/fixtures/zero-spread/…`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectCanonicalAnalysisCells } from '../canonical-analysis-view.js';
import { exactFinding, exactnessEarned } from '../../orchestrator-v5/agent-lane/goal-certainty.js';
import { runFactsOf } from '../../orchestrator-v5/agent-lane/run-facts.js';
import {
  GOAL_CHANCE_LICENSED, goalChanceLicenceForAgent, goalChanceLicenceOf, ZERO_SPREAD_LINE, zeroSpreadExactLine,
} from '../../orchestrator-v5/goal-target/goal-chance-licence.js';

type Rec = Record<string, any>;
const REC = JSON.parse(readFileSync('tests/fixtures/zero-spread/local-exact-sum-option-effects-20261021.json', 'utf8')) as Rec;
const RUN = REC.analysis_result as Rec;
const EVALUATIONS = RUN.enrichment.identity_evaluations as Rec[];
const A_LINE = 'With your figures, ‘Option A’ reaches 70 widgets per hour, 10 above your target of 60. '
  + 'It still gets there as long as it adds at least 20; you said it adds 30. How sure are you of the 30?';
const B_LINE = 'With your figures, ‘Option B’ reaches 59.9 widgets per hour, 0.1 below your target of 60. '
  + 'It would get there if it adds at least 20; you said it adds 19.9. How sure are you of the 19.9?';
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

  it('EARNED: the level, its margin and the figure that keeps it there, by hand arithmetic (40 + 30, 40 + 19.9 against 60); no chance', () => {
    expect(exactFinding(REC.graph, 'a', EVALUATIONS)).toEqual({ projected: 70, threshold: 60, setting: { value: 30, tipping: 20 } });
    expect(exactFinding(REC.graph, 'b', EVALUATIONS)).toEqual({ projected: expect.closeTo(59.9, 9), threshold: 60, setting: { value: 19.9, tipping: expect.closeTo(20, 9) } });
    expect(produce(REC.graph)).toEqual(EXACT);
    // The handler's own stored write is the same.
    expect(licenceRecord(RUN)).toMatchObject({ withheld_option_ids: ['a', 'b'], pct_by_option: {}, withheld_reason_by_option: EXACT });
    for (const line of [A_LINE, B_LINE]) expect(line).not.toMatch(/%|\bcertain|\bwill\b|chance|can’t say|sorry/i);
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

  it('CODEX F1v2 #1: an unlinked operand, a raw setting under a held value, a stray change part, an accepted Olumi figure: none is the person\'s exact arithmetic', () => {
    const unlinked = structuredClone(REC.graph) as Rec;
    unlinked.edges = (unlinked.edges as Rec[]).filter((e) => !(e.from === 'w_today' && e.to === 'w'));
    olumis(node(unlinked, 'w_today').observed_state);
    expect(exactnessEarned(unlinked, 'a', EVALUATIONS), 'an identity part with no link hides its own figure').toBe(false);
    const rawMoves = structuredClone(REC.graph) as Rec;
    Object.assign(node(rawMoves, 'b').interventions.w__change, { value: 0 });
    olumis(node(rawMoves, 'b').interventions.w__change);
    expect(exactnessEarned(rawMoves, 'b', EVALUATIONS), 'held means the RAW level: 19.9 is not 0').toBe(false);
    const stray = structuredClone(REC.graph) as Rec;
    (stray.nodes as Rec[]).push({ id: 'x', kind: 'factor', label: 'x', quantity_frame: 'change', observed_state: { value: 0, raw_value: 0, cap: 75, unit: 'widgets per hour', source: 'cee_inference' } });
    const theirs = (node(stray, 'w').nonlinear_identity as Rec).factor_ids as string[];
    (stray.edges as Rec[]).push({ ...structuredClone((stray.edges as Rec[]).find((e) => e.from === 'w_today' && e.to === 'w')!), id: 'x__w', from: 'x',
      provenance: { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: { amount: 1, amount_unit: 'widgets per hour', per_source_change: 1,
        per_source_change_unit: 'widgets per hour', strength_mean: 1, strength_mean_frame: 'edge_strength' } } });
    expect(theirs, 'precondition: x is not a part of the goal\'s own sum').not.toContain('x');
    expect(exactnessEarned(stray, 'a', EVALUATIONS), 'only the goal\'s own sum part is a definitional change').toBe(false);
    const accepted = structuredClone(REC.graph) as Rec;
    Object.assign(node(accepted, 'b').interventions.w__change, { source: 'user_confirmed' });
    delete node(accepted, 'b').interventions.w__change.extractionType;
    expect(exactnessEarned(accepted, 'b', EVALUATIONS), 'an accepted Olumi figure is still Olumi\'s').toBe(false);
    expect(exactnessEarned(REC.graph, 'b', EVALUATIONS), 'CONTRAST: the person\'s own setting').toBe(true);
  });

  it('CODEX F1v2 #2: the frame is ISL\'s own: a Run that rebuilt today in another frame says no finding', () => {
    const normalised = EVALUATIONS.map((e) => ({ ...e, reconciliation: { ...e.reconciliation, reconstructed: 40 / 75 } }));
    expect(exactFinding(REC.graph, 'a', normalised)).toBeUndefined();
    expect(produce(REC.graph, { ...structuredClone(RUN.enrichment), identity_evaluations: normalised })?.a)
      .toEqual({ reason: 'zero_spread', side: 'meets', line: ZERO_SPREAD_LINE });
  });

  it('CODEX F1v2 #3: the figure that keeps it is said only for a change from 0 today', () => {
    const fromTen = structuredClone(REC.graph) as Rec;
    Object.assign(node(fromTen, 'w__change').observed_state, { value: 10 / 75, raw_value: 10, source: 'brief_extraction', extractionType: 'explicit' });
    expect(exactFinding(fromTen, 'a', EVALUATIONS)).toEqual({ projected: 60, threshold: 60 });
  });

  it('CODEX F1v2 #5: a figure is never rounded: one that cannot be said exactly drops its sentence, or the whole line', () => {
    const f = { projected: 59.99995, threshold: 60, setting: { value: 19.99995, tipping: 20 } };
    expect(zeroSpreadExactLine('A', f, '>=', '')).toBeUndefined();
    expect(zeroSpreadExactLine('A', { ...f, projected: 59.999 }, '>=', '')).toBe('With your figures, ‘A’ reaches 59.999, 0.001 below your target of 60.');
  });

  it('COMPARATOR: at most 60 reverses both sides and the words that keep them', () => {
    const graph = structuredClone(REC.graph) as Rec;
    node(graph, 'w').goal_direction = '<=';
    const envelope = structuredClone(RUN.enrichment) as Rec;
    for (const r of envelope.option_comparison as Rec[]) r.probability_of_goal = r.option_id === 'a' ? 0 : 1;
    expect(produce(graph, envelope)).toEqual({
      a: { reason: 'zero_spread', side: 'falls_short', basis: 'exact_own_figures', line: 'With your figures, ‘Option A’ reaches 70 widgets per hour, 10 above your target of 60. '
        + 'It would get there if it adds no more than 20; you said it adds 30. How sure are you of the 30?' },
      b: { reason: 'zero_spread', side: 'meets', basis: 'exact_own_figures', line: 'With your figures, ‘Option B’ reaches 59.9 widgets per hour, 0.1 below your target of 60. '
        + 'It still gets there as long as it adds no more than 20; you said it adds 19.9. How sure are you of the 19.9?' } });
    expect(zeroSpreadExactLine('A', { projected: 50, threshold: 60, setting: { value: -10, tipping: 0 } }, '<=', '')).toContain('it adds no more than 0; you said it removes 10');
  });

  it('BOUND TO THIS RUN: a Run whose single value is not the arithmetic\'s keeps #3017\'s line', () => {
    const envelope = structuredClone(RUN.enrichment) as Rec;
    Object.assign((envelope.option_comparison as Rec[]).find((r) => r.option_id === 'a')!.outcome, { p10: 71, p50: 71, p90: 71 });
    expect(produce(REC.graph, envelope)).toEqual({ a: { reason: 'zero_spread', side: 'meets', line: ZERO_SPREAD_LINE }, b: EXACT.b });
    // …and a Run whose side is not the arithmetic's (it says A falls short at 70 against at least 60).
    const flipped = structuredClone(RUN.enrichment) as Rec;
    (flipped.option_comparison as Rec[]).find((r) => r.option_id === 'a')!.probability_of_goal = 0;
    expect(produce(REC.graph, flipped)?.a).toEqual({ reason: 'zero_spread', side: 'falls_short', line: ZERO_SPREAD_LINE });
  });

  it('REOPEN: the stored Run, through the read’s own cell projector, says each stored line verbatim under its own face', () => {
    const projected = cells(RUN);
    const face = 'Worked out from your exact figures';
    expect(projected.find((c) => c.option_id === 'a')!.cell).toMatchObject({ kind: 'withheld', face, why: A_LINE });
    expect(projected.find((c) => c.option_id === 'b')!.cell).toMatchObject({ kind: 'withheld', face, why: B_LINE });
    expect(goalChanceLicenceForAgent(RUN as never)?.withheld_reason_by_option).toEqual(EXACT);
    // Typed for the AI as exact, never a measurement problem.
    expect(runFactsOf(RUN, REC.graph, true).zero_spread).toEqual([{ option_id: 'a', basis: 'exact_own_figures' }, { option_id: 'b', basis: 'exact_own_figures' }]);
  });

  it('REOPEN CONTRAST: a stored basis beside another line is not kept (a basis never re-labels a line)', () => {
    const stored = structuredClone(RUN) as Rec;
    licenceRecord(stored).withheld_reason_by_option.a.line = ZERO_SPREAD_LINE;
    expect(goalChanceLicenceForAgent(stored as never)?.withheld_reason_by_option?.a)
      .toEqual({ reason: 'zero_spread', side: 'meets', line: ZERO_SPREAD_LINE });
    expect(cells(stored).find((c) => c.option_id === 'a')!.cell).toMatchObject({ face: 'Chance not shown yet', why: ZERO_SPREAD_LINE });
    // CODEX F1v2 #4: a cut line is not this line, so it keeps no basis.
    const cut = structuredClone(RUN) as Rec;
    licenceRecord(cut).withheld_reason_by_option.a.line = A_LINE.slice(0, A_LINE.indexOf(' your target'));
    expect(goalChanceLicenceForAgent(cut as never)?.withheld_reason_by_option?.a).not.toHaveProperty('basis');
    const truncated = structuredClone(RUN) as Rec;
    licenceRecord(truncated).withheld_reason_by_option.a.line = A_LINE.replace('How sure are you of the 30?', 'How sure are you of the 3?');
    expect(goalChanceLicenceForAgent(truncated as never)?.withheld_reason_by_option?.a).not.toHaveProperty('basis');
  });
});
