/**
 * THE BOARD IS THE MODEL (Paul's manual test, 27 Oct 2026: hiring brief, scenario 6bd4201f, served CEE 4f0a93d4). Every row
 * projects the model Paul's scenario saved (`hiring-paul-1027.saved.json`: its stored canonical and brief, whose projection
 * at 4f0a93d4 equals the stored graph) and binds the exact field the canvas draws, by record id, with a contrast that was
 * already right beside each change:
 *  1. a coefficient the model works out is drawn as the mechanism size it is (a factor), never an outcome;
 *  2. each limit is drawn once: the £200,000 budget is the goal constraint the goal card draws (a reopen loads it into the
 *     canvas), never also a card; the quality limit, with no figure, is its own card, linked from what it measures;
 *  3. the question's link to an option and an option's link to what it sets carry no sign: the model states none;
 *  4. the window a calculable goal is read over is in the analysis, though an unanswered limit reads the same window;
 *  5. what a figure is worked out from names each input once ("Tech leads hired, Tech leads hired").
 * Each row is RED on 4f0a93d4's projection and GREEN with this change (row 2: RED on 14db9b50's, which drew the budget as a
 * card as well). Expectations are written by hand from the fixture.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CanonicalModel, withDeclaredTiming } from '../canonical.js';
import { compile } from '../compile.js';
import { project } from '../project.js';

type Rec = Record<string, any>;
const paul = () => {
  const s = JSON.parse(readFileSync(new URL('../../model-program-turn/__tests__/hiring-paul-1027.saved.json', import.meta.url), 'utf8')) as { brief: string; canonical: unknown };
  const m = CanonicalModel.parse(withDeclaredTiming(s.canonical));
  return project(m, compile(m, { sourceText: s.brief }), { brief: s.brief });
};
const nodeOf = (p: ReturnType<typeof project>, id: string) => (p.graph.nodes as Rec[]).find((n) => n.id === id)!;
const edgeOf = (p: ReturnType<typeof project>, id: string) => (p.graph.edges as Rec[]).find((e) => e.id === id)!;
const itemOf = (p: ReturnType<typeof project>, id: string) => p.items.find((i) => i.record_id === id)!;

describe('the board draws the saved model: Paul\'s hiring scenario, 27 Oct', () => {
  it('1 · the three worked-out coefficients are mechanism sizes (factors), each named by its link; worked-out results stay outcomes', () => {
    const p = paul();
    const sizes = ['developer_productivity_gain', 'lead_defect_effect', 'developer_defect_effect'];
    expect(sizes.map((id) => [id, nodeOf(p, id).kind, nodeOf(p, id).value_basis?.kind])).toEqual([
      ['developer_productivity_gain', 'factor', 'worked_out'], ['lead_defect_effect', 'factor', 'worked_out'], ['developer_defect_effect', 'factor', 'worked_out'],
    ]);
    // Q1 (28 Oct): the hires are said on the option cards, so each size's link starts from the option that hires.
    expect(sizes.map((id) => (p.graph.edges as Rec[]).filter((e) => e.coefficient_id === id).map((e) => e.id))).toEqual([
      ['hire_two_developers__productivity'], ['hire_tech_lead__defect_rate'], ['hire_two_developers__defect_rate'],
    ]);
    // Contrast (right before, unchanged): what the model works out as a result is an outcome; the one with an exact figure
    // today carries it in the model's own unit (1 / 6 per developer); an estimated size used only on its link has no card.
    expect(['full_developer_contribution', 'productivity', 'defect_rate', 'lead_spend', 'developer_spend', 'total_spend'].map((id) => nodeOf(p, id).kind))
      .toEqual(['outcome', 'outcome', 'outcome', 'outcome', 'outcome', 'outcome']);
    expect(nodeOf(p, 'full_developer_contribution').observed_state).toEqual({ value: 1 / 6, raw_value: 1 / 6, unit: '1/developer' });
    expect(nodeOf(p, 'lead_productivity_gain')).toBeUndefined();
    expect(itemOf(p, 'lead_productivity_gain').shown_as).toEqual({ on_edge: 'hire_tech_lead__productivity' });
  });

  it('2 · each limit is drawn once: the budget is the goal constraint the goal card draws, never also a card; the quality limit is its card', () => {
    const p = paul();
    // The one card: the limit with no figure, linked from what it measures by definition (no size, no sign).
    expect((p.graph.nodes as Rec[]).filter((n) => String(n.id).startsWith('mp:limit:')).map((n) => [n.id, n.kind, n.label, n.description])).toEqual([
      ['mp:limit:maintain_code_quality', 'action', 'Limit: Maintaining code quality', 'Maintaining code quality (its figure is not given yet).'],
    ]);
    expect((p.graph.edges as Rec[]).filter((e) => String(e.to).startsWith('mp:limit:'))).toEqual([
      { from: 'defect_rate', to: 'mp:limit:maintain_code_quality', exists_probability: 1, provenance: { source: 'brief_extraction', definitional: true }, origin: 'model_program:display', id: 'defect_rate__mp:limit:maintain_code_quality' },
    ]);
    // The budget is in the saved graph once: as its goal constraint, and on no card or link of its own.
    expect([...(p.graph.nodes as Rec[]), ...(p.graph.edges as Rec[])].filter((x) => String(x.id).includes('stay_within_budget')).map((x) => x.id)).toEqual([]);
    expect(p.items.filter((i) => i.family === 'limit').map((i) => [i.record_id, i.shown_as])).toEqual([
      ['maintain_code_quality', { node: 'mp:limit:maintain_code_quality' }], ['stay_within_budget', { constraint: 'stay_within_budget', on_node: 'total_spend' }],
    ]);
    // Contrast (right before, unchanged): the budget is the goal constraint every constraint reader takes, whole.
    expect(p.graph.goal_constraints).toEqual([{ constraint_id: 'stay_within_budget', node_id: 'total_spend', operator: '<=', value: 200000, label: 'Our budget is £200,000', unit: 'GBP',
      source_quote: 'Our budget is £200,000', provenance: 'explicit' }]);
  });

  it('3 · the question\'s links to the options carry no sign; the hires each option sets are said on its card (Q1), no link carries a strength', () => {
    const p = paul();
    const structural = ['mp:decision__hire_tech_lead', 'mp:decision__hire_two_developers'];
    expect(structural.map((id) => [id, edgeOf(p, id).from, 'effect_direction' in edgeOf(p, id)])).toEqual([
      ['mp:decision__hire_tech_lead', 'mp:decision', false], ['mp:decision__hire_two_developers', 'mp:decision', false],
    ]);
    // Q1 (Paul, 28 Oct: the situation, not the arithmetic): "Tech leads hired" and "Developers hired" are the levers the
    // options set, said on each option's card with their own label and figure, never their own cards.
    expect(['tech_leads_added', 'developers_added'].map((id) => [nodeOf(p, id), itemOf(p, id).shown_as])).toEqual([
      [undefined, { on_node: 'hire_tech_lead' }], [undefined, { on_node: 'hire_two_developers' }]]);
    expect(nodeOf(p, 'hire_two_developers').interventions.developers_added).toMatchObject({ label: 'Developers hired', value: 2 });
    expect((p.graph.edges as Rec[]).filter((e) => 'strength' in e || 'strength_mean' in e || 'weight' in e).map((e) => e.id)).toEqual([]);
    // Contrast (right before, unchanged): every sign the model does state is kept, a negative estimate's included.
    expect(['current_developers__full_developer_contribution', 'hire_tech_lead__productivity', 'hire_tech_lead__productivity__via__tech_leads_added', 'hire_two_developers__productivity__via__developers_added', 'lead_spend__total_spend']
      .map((id) => edgeOf(p, id).effect_direction)).toEqual(['negative', 'positive', 'negative', 'negative', 'positive']);
  });

  it('4 · the three months the goal is read over are in the analysis, though the unanswered quality limit is read over them too', () => {
    const p = paul();
    expect([nodeOf(p, 'launch_window').analysis_participation, itemOf(p, 'launch_window').in_calculation, itemOf(p, 'launch_window').why_out]).toEqual(['included', true, null]);
    // Contrast (right before, unchanged): the budget's figure, on a limit that cannot be worked out yet, stays out.
    expect([itemOf(p, 'hiring_budget').in_calculation, itemOf(p, 'hiring_budget').shown_as]).toEqual([false, { on_node: 'total_spend' }]);
  });

  it('5 · what a figure is worked out from names each input once, on the goal and on what it measures', () => {
    const p = paul();
    const once = { kind: 'worked_out', from: ['productivity_now', 'tech_leads_added', 'developers_added'], words: 'Worked out from Current team productivity index, Tech leads hired and Developers hired' };
    expect([nodeOf(p, 'productivity').value_basis, nodeOf(p, 'increase_productivity').value_basis]).toEqual([once, once]);
    // Contrast (right before, unchanged): a definition's two different parts.
    expect(nodeOf(p, 'lead_spend').value_basis).toEqual({ kind: 'worked_out', from: ['tech_leads_added', 'tech_lead_cost'], words: 'Worked out from Tech leads hired and Total cost per tech lead through launch' });
  });
});
