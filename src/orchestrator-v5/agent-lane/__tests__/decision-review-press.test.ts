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
import { goalChanceWithheldForAgent, GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED } from '../goal-chance-withheld.js';
import { dropRankingSentences } from '../withheld-leader-fail-closed.js';
import { TREATED_AS_ZERO_UNNAMED_ONE, treatedAsZeroReplyLine, treatedAsZeroUnnamedMany } from '../root-line.js';

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
const FRAGILE = 'The link from ‘Pro plan price’ to ‘MRR’ is one of the links this result is most sensitive to.';
const PROMISE = 'You can test the result without it.';
const EXPLORATORY = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'exploratory' } };
/** The served flip row, re-pointed at a factor no option sets (the served one, Pro plan price, is a LEVER: options set it). */
const NON_LEVER_FLIP = { ...(PLOT.flip_thresholds as Rec[])[0], factor_id: 'other_mrr_growth', factor_label: 'Other MRR growth' };
const WITH_NON_LEVER_FLIP = { ...PLOT, flip_thresholds: [NON_LEVER_FLIP] };
const TEST_LINK = { kind: 'test_without_link', from_id: 'pro_plan_price', to_id: 'mrr' } as const;
const WHAT_WOULD_CHANGE = { kind: 'what_would_change' } as const;
/** goal-chance-withheld.ts's own opening: the withhold said without its reason (its fail-closed reading). */
const WITHHELD_OPENING = 'This run doesn’t yet show each option’s chance of reaching £100,000.';

describe('decisionReviewFor — one typed fact per item, on the bound Run', () => {
  it('a licensed Run: the default-0 factor (F2) and the most sensitive link (F5), with the link test and What would change', () => {
    const turn = decisionReviewFor(SCENARIO, readOf());
    expect(turn.bound).toBe(true);
    expect(turn.reply.split('\n')[0]).toBe(DECISION_REVIEW_OPENING);
    expect(turn.lines).toEqual([DECISION_REVIEW_OPENING, `- ${ZERO_FACTOR}`, `- ${FRAGILE}`]);
    expect(turn.steps).toEqual([TEST_LINK, WHAT_WOULD_CHANGE]);
  });

  it('RED (Codex r2 P2): no tipping item of its own, even beside a non-lever flip row — the press says what would change it', () => {
    const turn = decisionReviewFor(SCENARIO, readOf({ enrichment: WITH_NON_LEVER_FLIP }));
    expect(turn.lines).toEqual([DECISION_REVIEW_OPENING, `- ${ZERO_FACTOR}`, `- ${FRAGILE}`]);
    expect(turn.reply).not.toContain('Other MRR growth');
    expect(turn.steps).toEqual([TEST_LINK, WHAT_WOULD_CHANGE]);
  });

  it.each([
    ['a provisional licence (permitted_with_caveat)', { ready: PROVISIONAL }, true],
    ['the leader withheld', { claim: { permitted: false, withheld_reason: 'separation_unavailable' } }, false],
  ])('What would change is offered exactly where SCI-CHANGE answers (licence not withheld) — %s', (_n, opts, offered) => {
    const turn = decisionReviewFor(SCENARIO, readOf(opts as { ready?: Rec; claim?: Rec }));
    expect(turn.steps.some((x) => x.kind === 'what_would_change')).toBe(offered);
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
  const ROOT_SENTENCE = 'No figure is set for "Demand shortfall" yet, so the analysis treats it as zero. How likely or how large is "Demand shortfall" today?';
  it('F1: the unvalued risk root is said with its ask (the outcome metric M1 shape), and a data-gap warning naming it adds nothing', () => {
    const gap = { code: 'GOAL_ANCESTOR_DATA_GAP', message: "Goal node 'goal' is scored from its forward-propagated outcome distribution, but root ancestor(s) 'demand_shortfall' carry no observed value or ParameterUncertainty and defaulted to 0.0 — goal-level probabilities partially rest on placeholder zeros (insufficient data)." };
    const turn = decisionReviewFor(SCENARIO, readOf({ graph: G2_GRAPH, enrichment: { inference_warnings: [gap] } }));
    expect(turn.lines).toEqual([DECISION_REVIEW_OPENING, `- ${ROOT_SENTENCE}`]);
    expect(turn.reply.split(ROOT_SENTENCE)).toHaveLength(2);
    expect(turn.reply.split('Demand shortfall')).toHaveLength(3); // The disclosure and its own question both name it.
  });

  it('RED (Codex r2 P2): an unnamed risk root (F1) and an unnamed default-0 factor (F2) are counted as two, in one sentence', () => {
    const graph = { ...G2_GRAPH, nodes: (G2_GRAPH.nodes as Rec[]).map((n) => (n.id === 'demand_shortfall' ? { ...n, label: 'prop_abcdef12 shortfall' }
      : n.id === 'productivity' ? { ...n, label: 'prop_abcdef13 output' } : n)) };
    const gap = { code: 'GOAL_ANCESTOR_DATA_GAP', message: "Root ancestor(s) 'demand_shortfall', 'productivity' carry no observed value and defaulted to 0.0." };
    const turn = decisionReviewFor(SCENARIO, readOf({ graph, enrichment: { inference_warnings: [gap] } }));
    expect(turn.lines).toEqual([DECISION_REVIEW_OPENING, `- ${treatedAsZeroUnnamedMany(2)}`]);
  });

  const withRoots = (labels: Record<string, string>, extraRoot = false): Rec => {
    const nodes = (G2_GRAPH.nodes as Rec[]).map((n) => (typeof n.id === 'string' && n.id in labels ? { ...n, label: labels[n.id] } : n));
    if (!extraRoot) return { ...G2_GRAPH, nodes };
    return { ...G2_GRAPH, nodes: [...nodes, { id: 'supply_delay', kind: 'risk', label: labels.supply_delay ?? 'Supply delay', category: 'observable' }],
      edges: [...(G2_GRAPH.edges as Rec[]), { from: 'supply_delay', to: 'goal', strength: { mean: -0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' }] };
  };
  it.each([
    ['one root, label ""', withRoots({ demand_shortfall: '' }), TREATED_AS_ZERO_UNNAMED_ONE],
    ['one root, label of spaces', withRoots({ demand_shortfall: '   ' }), TREATED_AS_ZERO_UNNAMED_ONE],
    ['two roots, the first quoted label blank', withRoots({ demand_shortfall: ' ' }, true), treatedAsZeroUnnamedMany(2)],
  ])('RED (Codex r3 P2): a blank root label is never quoted as "" — the label-free form with the typed count (%s)', (_n, graph, line) => {
    expect(treatedAsZeroReplyLine(graph, COMPARATIVE)).toBe(line);
    const turn = decisionReviewFor(SCENARIO, readOf({ graph, enrichment: { inference_warnings: [] } }));
    expect(turn.lines).toEqual([DECISION_REVIEW_OPENING, `- ${line}`]);
  });

  it('RED (Codex r3 P2): a blank root (F1) beside an unnamed default-0 factor (F2) is counted as two, in one sentence', () => {
    const graph = withRoots({ demand_shortfall: '', productivity: 'prop_abcdef13 output' });
    const gap = { code: 'GOAL_ANCESTOR_DATA_GAP', message: "Root ancestor(s) 'demand_shortfall', 'productivity' carry no observed value and defaulted to 0.0." };
    const turn = decisionReviewFor(SCENARIO, readOf({ graph, enrichment: { inference_warnings: [gap] } }));
    expect(turn.lines).toEqual([DECISION_REVIEW_OPENING, `- ${treatedAsZeroUnnamedMany(2)}`]);
  });

  it('CONTROL (F1): two named roots keep their labels', () => {
    expect(treatedAsZeroReplyLine(withRoots({}, true), COMPARATIVE)).toBe(
      'No figures are set for "Demand shortfall" and "Supply delay" yet, so the analysis treats them as zero. How likely or how large is each of "Demand shortfall" and "Supply delay" today?');
  });

  it('RED (Codex r2 P2): a goal-figure reason the editors would rewrite says the withhold in the reader\'s own opening', () => {
    const warning = { code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, node_ids: ['mrr'], message: 'Not shown. ‘prop_abcdef12 cost’ is not evaluated yet.' };
    const turn = decisionReviewFor(SCENARIO, readOf({ enrichment: { inference_warnings: [warning] } }));
    expect(turn.lines, JSON.stringify(turn.lines)).toContain(`- ${WITHHELD_OPENING}`);
    expect(turn.reply).not.toContain('prop_abcdef12');
  });

  it('CONTROL (F4): a goal-figure reason that reaches the user whole keeps its own words', () => {
    const warning = { code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, node_ids: ['mrr'], message: 'Not shown. ‘Monthly cost’ is not evaluated yet.' };
    const turn = decisionReviewFor(SCENARIO, readOf({ enrichment: { inference_warnings: [warning] } }));
    expect(turn.lines, JSON.stringify(turn.lines)).toContain(`- ${WITHHELD_OPENING} ‘Monthly cost’ is not evaluated yet.`);
  });

  it('CONTROL (F5): a fragile link between two real nodes that is not a link of the stored graph is not said, and offers no test', () => {
    // Both nodes exist and have labels; only the link (reversed) is absent, so the in-graph check alone decides.
    const robustness = { ...(PLOT.robustness as Rec), fragile_edges: [{ from_id: 'mrr', to_id: 'pro_plan_price' }] };
    const turn = decisionReviewFor(SCENARIO, readOf({ enrichment: { ...PLOT, robustness } }));
    expect(turn.reply).not.toContain('most sensitive to');
    expect(turn.steps.some((s) => s.kind === 'test_without_link')).toBe(false);
  });

  it('F4 on the served withheld block: the typed reason’s own words; F7 stays silent for another withheld reason', () => {
    // Bind the expected producer to the same stored graph as the review, including its held target words.
    const say = goalChanceWithheldForAgent(SERVED_0948.block, STORED.graph)!.say;
    expect(say).toBe(WITHHELD_OPENING);
    const turn = decisionReviewFor('9b9a4b81-aaaa-4aaa-8aaa-aaaaaaaa0002', {
      graph: STORED.graph, graphHash: String(SERVED_0948.block.computed_against_hash), analysisReady: COMPARATIVE,
      analysisState: { ...SERVED_0948.analysis_state, run_state: current }, analysisResult: SERVED_0948.block,
    });
    expect(turn.lines, JSON.stringify(turn.lines)).toContain(`- ${say}`);
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

  it('nothing to flag on a bound Run → Science’s empty sentence, no opening (What would change still offered: it answers)', () => {
    const turn = decisionReviewFor(SCENARIO, readOf({ enrichment: { inference_warnings: [] } }));
    expect(turn).toEqual({ bound: true, reply: DECISION_REVIEW_NOTHING_TO_FLAG, lines: [DECISION_REVIEW_NOTHING_TO_FLAG], steps: [WHAT_WOULD_CHANGE] });
  });

  it.each([
    ['stale', { kind: 'complete_stale', computed_at: current.computed_at, cause: 'graph_changed' }],
    ['no result yet', { kind: 'none' }],
  ])('unbound (%s) → the existing unavailable reply, no items, no presses', (_n, runState) => {
    expect(decisionReviewFor(SCENARIO, readOf({ runState }))).toEqual({ bound: false, reply: RUN_EXPLANATION_UNAVAILABLE_TEXT, lines: [], steps: [] });
  });

  const relabel = (id: string, label: string): Rec => ({ ...STORED.graph, nodes: (STORED.graph.nodes as Rec[]).map((n) => (n.id === id ? { ...n, label } : n)) });

  it('RED (Codex P2): a default-0 factor whose label the editors would rewrite is still said, in gate 2\'s label-free form', () => {
    const turn = decisionReviewFor(SCENARIO, readOf({ graph: relabel('fac_existing_customers_grandfathered', 'Increase price to £59 leads. Churn') }));
    expect(turn.reply).not.toContain('Increase price to £59 leads');
    expect(turn.lines).toContain(`- ${TREATED_AS_ZERO_UNNAMED_ONE}`);
    expect(turn.reply).not.toBe(DECISION_REVIEW_NOTHING_TO_FLAG);
  });

  it('RED (Science 5 Oct): a job-title label ("Tech leads") is quoted — no editor rewrites it', () => {
    const turn = decisionReviewFor(SCENARIO, readOf({ graph: relabel('fac_existing_customers_grandfathered', 'Tech leads') }));
    expect(turn.lines).toContain('- ‘Tech leads’ has no figure yet, so these figures treat it as 0 until you give it.');
  });

  it('RED (Codex P2): a sensitive link whose label the editors would rewrite is said without names, with its test', () => {
    const turn = decisionReviewFor(SCENARIO, readOf({ graph: relabel('pro_plan_price', 'Increase price to £59 leads. Price') }));
    expect(turn.lines).toContain('- One link in your model is one of the links this result is most sensitive to.');
    expect(turn.steps).toContainEqual(TEST_LINK);
  });

  it('RED (Codex r2 P2): the test is never promised in words — SCI-DEEP decides at the press, on its own evidence', () => {
    expect(decisionReviewFor(SCENARIO, readOf()).reply).not.toContain(PROMISE);
  });

  it.each([
    ['blank', '   '],
    ['absent', undefined],
  ])('RED (Codex r2 P2): a default-0 factor with a %s label is still said, unnamed — never "nothing to flag"', (_n, label) => {
    const graph = { ...STORED.graph, nodes: (STORED.graph.nodes as Rec[]).map((n) => (n.id === 'fac_existing_customers_grandfathered' ? { ...n, label } : n)) };
    const turn = decisionReviewFor(SCENARIO, readOf({ graph, enrichment: { inference_warnings: PLOT.inference_warnings } }));
    expect(turn.lines).toEqual([DECISION_REVIEW_OPENING, `- ${TREATED_AS_ZERO_UNNAMED_ONE}`]);
  });

  it('RED (Codex r2 P2): a default-0 factor whose id the slug grammar misses (fac-existing:customers__2) is found by its own id', () => {
    const OLD = 'fac_existing_customers_grandfathered';
    const NEW = 'fac-existing:customers__2';
    const rename = (v: unknown): unknown => (v === OLD ? NEW : v);
    const graph = { ...STORED.graph,
      nodes: (STORED.graph.nodes as Rec[]).map((n) => ({ ...n, id: rename(n.id) })),
      edges: (STORED.graph.edges as Rec[]).map((e) => ({ ...e, from: rename(e.from), to: rename(e.to) })) };
    const inference_warnings = (PLOT.inference_warnings as Rec[]).map((w) => (w.code === 'GOAL_ANCESTOR_DATA_GAP'
      ? { ...w, message: String(w.message).replaceAll(`'${OLD}'`, `'${NEW}'`) } : w));
    expect(JSON.stringify(inference_warnings)).toContain(`'${NEW}'`);
    const turn = decisionReviewFor(SCENARIO, readOf({ graph, enrichment: { inference_warnings } }));
    expect(turn.lines).toContain(`- ${ZERO_FACTOR}`);
  });

  it.each([
    ['the link\'s removal would leave its target a root (target_becomes_root)', { fragile: { from_id: 'pro_plan_price', to_id: 'price_sensitivity' }, ready: COMPARATIVE },
      'The link from ‘Pro plan price’ to ‘Price sensitivity’ is one of the links this result is most sensitive to.'],
    ['the Run is below quantified_provisional (SCI-DEEP refuses exploratory work)', { fragile: { from_id: 'pro_plan_price', to_id: 'mrr' }, ready: EXPLORATORY },
      FRAGILE],
  ])('RED (Codex P2): no test is offered where SCI-DEEP would refuse first — %s', (_n, c, sentence) => {
    const robustness = { ...(PLOT.robustness as Rec), fragile_edges: [c.fragile] };
    const turn = decisionReviewFor(SCENARIO, readOf({ enrichment: { ...PLOT, robustness }, ready: c.ready as Rec }));
    expect(turn.lines).toContain(`- ${sentence}`);
    expect(turn.steps.some((x) => x.kind === 'test_without_link')).toBe(false);
  });

  it('every item survives the withheld-leader ranking drop unchanged', () => {
    for (const line of decisionReviewFor(SCENARIO, readOf()).lines.slice(1, 3)) {
      expect(dropRankingSentences(line).droppedSentences, line).toBe(0);
    }
  });
});
