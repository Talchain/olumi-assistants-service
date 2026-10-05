/**
 * ⭐ A4 SLICE 1 — "Review this decision" (lease #87 5991360031; Science wording rulings 5 Oct). Rows on SERVED bytes:
 * the b5 per-limit capture a6ed1bff (stored graph + PLoT response: fragile edges, flip thresholds and a
 * GOAL_ANCESTOR_DATA_GAP warning) and the served withheld-leader block (0948Z, GOAL_FIGURES_TARGET_NOT_TESTABLE).
 * Every item is bound by identity (node id, link ids, typed code) and each family has a discriminating control.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decisionReviewFor,
  DECISION_REVIEW_NOTHING_TO_FLAG,
  DECISION_REVIEW_OPENING,
} from '../decision-review-press.js';
import { RUN_EXPLANATION_UNAVAILABLE_TEXT } from '../run-explanation.js';
import { tippingPointOf } from '../decision-sensitivity.js';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
import { provisionalFiguresCaveatFor } from '../../compose/leading-option-wire-enforcement.js';
import { dropRankingSentences } from '../withheld-leader-fail-closed.js';

type Rec = Record<string, unknown>;
const json = (p: string): Rec => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as Rec;
const B5 = '../../../../tests/fixtures/cross-service/b5-per-limit/';
const STORED = json(`${B5}a6ed1bff.graph.json`) as { graph: Rec; graph_hash: string; scenario_id: string };
const PLOT = json(`${B5}a6ed1bff.plot-response.json`);
const SERVED_0948 = json('./fixtures/served-withheld-leader-0948Z.json') as { analysis_state: Rec; block: Rec };
const SCENARIO = STORED.scenario_id;

const COMPARATIVE = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
const PROVISIONAL = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional' } };
const current = { kind: 'complete_current', computed_at: '2026-10-05T03:48:55.163Z' };

/** The served PLoT response, carried as the Run's analysis_result block for the stored graph. */
function readOf(opts: { claim?: Rec; ready?: Rec; enrichment?: Rec; graph?: Rec; runState?: Rec } = {}) {
  return {
    graph: opts.graph ?? STORED.graph,
    graphHash: STORED.graph_hash,
    analysisReady: opts.ready ?? COMPARATIVE,
    analysisState: { run_state: opts.runState ?? current, leader_claim: opts.claim ?? { permitted: true, separation: 'separated' } },
    analysisResult: { type: 'analysis_result', computed_against_hash: STORED.graph_hash, enrichment: opts.enrichment ?? PLOT },
  };
}
const ZERO_FACTOR = '‘Existing customers grandfathered’ has no figure yet, so these figures treat it as 0 until you give it.';
const FRAGILE = 'The link from ‘Pro plan price’ to ‘MRR’ is one of the links this result is most sensitive to. You can test the result without it.';
const TIPPING = (tippingPointOf(PLOT) as { say: string }).say;

describe('decisionReviewFor — one typed fact per item, on the bound Run', () => {
  it('a licensed Run: the default-0 factor (F2), the most sensitive link (F5) and the tipping point (F6), with their presses', () => {
    const turn = decisionReviewFor(SCENARIO, readOf());
    expect(turn.bound).toBe(true);
    expect(turn.reply.split('\n')[0]).toBe(DECISION_REVIEW_OPENING);
    expect(turn.lines).toEqual([DECISION_REVIEW_OPENING, `- ${ZERO_FACTOR}`, `- ${FRAGILE}`, `- ${TIPPING}`]);
    expect(turn.steps).toEqual([{ kind: 'test_without_link', from_id: 'pro_plan_price', to_id: 'mrr' }, { kind: 'what_would_change' }]);
  });

  it('CONTROL (F6): the same Run with the leader withheld says no tipping point and offers no What would change', () => {
    const turn = decisionReviewFor(SCENARIO, readOf({ claim: { permitted: false, withheld_reason: 'separation_unavailable' } }));
    expect(turn.reply).not.toContain(TIPPING);
    expect(turn.steps.some((s) => s.kind === 'what_would_change')).toBe(false);
  });

  it('F6 under a provisional licence carries its caveat, once', () => {
    const turn = decisionReviewFor(SCENARIO, readOf({ ready: PROVISIONAL }));
    const caveat = provisionalFiguresCaveatFor(PROVISIONAL);
    expect(turn.lines).toContain(`- ${TIPPING} ${caveat}`);
    expect(turn.reply.split(caveat)).toHaveLength(2);
  });

  it('CONTROL (F2): the warning gone → no zero-factor item', () => {
    const enrichment = { ...PLOT, inference_warnings: (PLOT.inference_warnings as Rec[]).filter((w) => w.code !== 'GOAL_ANCESTOR_DATA_GAP') };
    expect(decisionReviewFor(SCENARIO, readOf({ enrichment })).reply).not.toContain('has no figure yet');
  });

  // F1 on the gate-2 case's shape (9b9a4b81: a risk root on the goal path with no figure, the held-out replica of
  // `run-reply-unvalued-root.route.test.ts`), with a GOAL_ANCESTOR_DATA_GAP warning that also names that risk.
  const G2_GRAPH: Rec = (() => {
    const edge = (from: string, to: string, negative = false): Rec => ({ from, to, strength: { mean: negative ? -0.4 : 0.4, std: 0.1 },
      exists_probability: 1, effect_direction: negative ? 'negative' : 'positive' });
    const option = (id: string, label: string, interventions: Rec, is_baseline = false): Rec => ({ id, option_id: id, kind: 'option', label, interventions, is_baseline });
    const options = [option('hire_lead', 'Hire a Tech Lead', { tech_leads: { value: 0.2, source: 'brief_extraction' } }),
      option('hire_two', 'Hire Two Developers', { developers: { value: 0.2, source: 'brief_extraction' } }), option('carry_on', 'Carry On as Now', {}, true)];
    return { goal_node_id: 'goal', options, nodes: [
      { id: 'decision', kind: 'decision', label: 'Hiring approach' }, { id: 'goal', kind: 'goal', label: 'Meet our next feature-launch deadline' },
      { id: 'tech_leads', kind: 'factor', label: 'Tech leads', category: 'controllable', observed_state: { value: 0.1, raw_value: 1, unit: 'people', source: 'brief_extraction' } },
      { id: 'developers', kind: 'factor', label: 'Developers', category: 'controllable', observed_state: { value: 4 / 30, raw_value: 4, unit: 'people', source: 'brief_extraction' } },
      { id: 'productivity', kind: 'factor', label: 'Delivery productivity', category: 'observable', observed_state: { value: 0.2, raw_value: 20, unit: 'feature points/week', source: 'brief_extraction' } },
      { id: 'demand_shortfall', kind: 'risk', label: 'Demand shortfall', category: 'observable' }, ...options],
    edges: [...options.map((o) => edge('decision', String(o.id))), edge('hire_lead', 'tech_leads'), edge('hire_two', 'developers'),
      edge('carry_on', 'tech_leads'), edge('carry_on', 'developers'), edge('tech_leads', 'productivity'), edge('developers', 'productivity'),
      edge('productivity', 'goal'), edge('demand_shortfall', 'goal', true)] };
  })();
  const ROOT_SENTENCE = 'No figure is set for "Demand shortfall" yet, so the analysis treats it as zero. How likely or how large is it today?';
  it('F1: the unvalued risk root is said with its ask (the outcome metric M1 shape), and a data-gap warning naming it adds nothing', () => {
    const gap = { code: 'GOAL_ANCESTOR_DATA_GAP', message: "Goal node 'goal' is scored from its forward-propagated outcome distribution, but root ancestor(s) 'demand_shortfall' carry no observed value or ParameterUncertainty and defaulted to 0.0 — goal-level probabilities partially rest on placeholder zeros (insufficient data)." };
    const turn = decisionReviewFor(SCENARIO, readOf({ graph: G2_GRAPH, enrichment: { inference_warnings: [gap] } }));
    expect(turn.lines).toEqual([DECISION_REVIEW_OPENING, `- ${ROOT_SENTENCE}`]);
    expect(turn.reply.split('Demand shortfall')).toHaveLength(2);
  });

  it('CONTROL (F5): a fragile link that is not in the stored graph is not said, and offers no test', () => {
    const robustness = { ...(PLOT.robustness as Rec), fragile_edges: [{ from_id: 'pro_plan_price', to_id: 'no_such_node' }] };
    const turn = decisionReviewFor(SCENARIO, readOf({ enrichment: { ...PLOT, robustness } }));
    expect(turn.reply).not.toContain('most sensitive to');
    expect(turn.steps.some((s) => s.kind === 'test_without_link')).toBe(false);
  });

  it('F4 on the served withheld block: the typed reason’s own words; F7 stays silent for another withheld reason', () => {
    const say = goalChanceWithheldForAgent(SERVED_0948.block)!.say;
    const turn = decisionReviewFor('9b9a4b81-aaaa-4aaa-8aaa-aaaaaaaa0002', {
      graph: STORED.graph, graphHash: String(SERVED_0948.block.computed_against_hash), analysisReady: COMPARATIVE,
      analysisState: { ...SERVED_0948.analysis_state, run_state: current }, analysisResult: SERVED_0948.block,
    });
    expect(turn.lines).toContain(`- ${say}`);
    expect(turn.steps.some((s) => s.kind === 'strengthen')).toBe(false);
  });

  it('F7: options that do not separate, with nothing else giving the reason → the withheld closing and Strengthen', () => {
    const enrichment = { inference_warnings: [] };
    const turn = decisionReviewFor(SCENARIO, readOf({ enrichment, claim: { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' } }));
    expect(turn.steps).toEqual([{ kind: 'strengthen' }]);
    expect(turn.lines).toHaveLength(2);
  });

  it('CONTROL (F7): the same near tie beside a typed goal-figure withhold gives one reason only', () => {
    const enrichment = { inference_warnings: [{ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', node_ids: ['mrr'], message: 'Not shown. Your target can’t be tested yet.' }] };
    const turn = decisionReviewFor(SCENARIO, readOf({ enrichment, claim: { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' } }));
    expect(turn.steps.some((s) => s.kind === 'strengthen')).toBe(false);
    expect(turn.lines).toHaveLength(2); // the opening + the goal-figure reason
  });

  it('nothing to flag on a bound Run → Science’s empty sentence, no opening', () => {
    const turn = decisionReviewFor(SCENARIO, readOf({ enrichment: { inference_warnings: [] } }));
    expect(turn).toEqual({ bound: true, reply: DECISION_REVIEW_NOTHING_TO_FLAG, lines: [DECISION_REVIEW_NOTHING_TO_FLAG], steps: [] });
  });

  it.each([
    ['stale', { kind: 'complete_stale', computed_at: current.computed_at, cause: 'graph_changed' }],
    ['no result yet', { kind: 'none' }],
  ])('unbound (%s) → the existing unavailable reply, no items, no presses', (_n, runState) => {
    expect(decisionReviewFor(SCENARIO, readOf({ runState }))).toEqual({ bound: false, reply: RUN_EXPLANATION_UNAVAILABLE_TEXT, lines: [], steps: [] });
  });

  it('a default-0 factor whose label would not survive the reply editors is not quoted', () => {
    const graph = { ...STORED.graph, nodes: (STORED.graph.nodes as Rec[]).map((n) => (n.id === 'fac_existing_customers_grandfathered'
      ? { ...n, label: 'Increase price to £59 leads. Churn' } : n)) };
    expect(decisionReviewFor(SCENARIO, readOf({ graph })).reply).not.toContain('has no figure yet');
  });

  it('every item survives the withheld-leader ranking drop unchanged', () => {
    for (const line of decisionReviewFor(SCENARIO, readOf()).lines.slice(1, 3)) {
      expect(dropRankingSentences(line).droppedSentences, line).toBe(0);
    }
  });
});
