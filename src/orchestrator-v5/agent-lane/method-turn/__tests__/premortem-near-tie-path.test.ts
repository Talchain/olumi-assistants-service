import { reclassifiedCTurn } from '../../__tests__/licence-test-graphs.js';
/** W9b: untouched A2 read captures, through the same method adapter as the route. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { assembleGuidanceSignals } from '../../turn-context/guidance-signals.js';
import {
  PREMORTEM_PRESS_ID, cardCallFor, fallbackReply, methodTurnForReadback, methodTurnFromSignals,
  planPickChipId, settleMethodTurn, type MethodReadback, type MethodTurn, type RunMethodTurn,
} from '../method-turn.js';
import { withApprovedMethodWords } from './helpers/approved-method-words.js';
import { assertUserLinkStories } from './helpers/user-link-stories.js';

type Graph = { nodes: Record<string, any>[]; edges: Record<string, any>[]; goal_constraints?: unknown };
type Read = {
  graph: Graph; analysis_state: unknown; analysis_result: unknown;
  current_read: { analysis_ready: unknown }; analysis_option_participation: unknown;
  analysis_identity_evaluated_node_ids?: string[];
};
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/w9b/${name}.json`, import.meta.url), 'utf8'));
// Science 393023 LICENCE (a)/(b), 7 Oct: C's mean-projected links are now grounded as unsized; captured bytes stay unchanged.
/**
 * ONE PROVENANCE AUTHORITY (DL ruling; AIE 6119326092): an absent-type `cee_inference` is Olumi's estimate on every reader.
 * 591cc1a0's F1 alone read it 'unknown', and these W9b contracts were recorded on that reading. They are held on the same
 * captures with those figures' stamp replaced by one the authority does not recognise (origin UNESTABLISHED, still
 * stamped) — the class every reader now reads 'unknown'. The as-captured behaviour is its own row (`asCaptured`).
 */
const UNRECOGNISED = 'unrecognised_stamp';
const unestablished = (r: Read): Read => {
  for (const n of r.graph.nodes) {
    const os = n.observed_state as Record<string, unknown> | undefined;
    if (os?.source === 'cee_inference' && os.extractionType === undefined && os.user_material_unverified !== true) os.source = UNRECOGNISED;
  }
  return r;
};
const captured = (name: string): Read => unestablished(load(name).j);
const asCaptured = (name: string): Read => load(name).j;
const base = load('base-turns') as Record<string, MethodTurn>;
const readback = (c: Read): MethodReadback => ({
  graph: c.graph, analysisState: c.analysis_state, analysisResult: c.analysis_result,
  analysisReady: c.current_read.analysis_ready, optionParticipation: c.analysis_option_participation,
  ...(c.analysis_identity_evaluated_node_ids !== undefined
    ? { identityEvaluated: new Set(c.analysis_identity_evaluated_node_ids) } : {}),
});
const turn = (c: Read, chip = PREMORTEM_PRESS_ID) => methodTurnForReadback(chip, readback(c));
const signalsOf = (c: Read) => assembleGuidanceSignals({
  graph: c.graph, analysisState: c.analysis_state, analysisResult: c.analysis_result,
  optionParticipation: c.analysis_option_participation, leaderLicensed: false,
  offeredSpecific: [], request: 'method', explicitRequest: 'RC-PREMORTEM',
});
const run = (out: MethodTurn | null): RunMethodTurn => {
  assert.equal(out?.kind, 'run');
  if (out?.kind !== 'run') throw new Error('expected decision method, not refusal');
  return out;
};

describe('W9b: near-tie completed decision pre-mortem', () => {
  it('A: RED at base — runs the decision on both paths without mutating captured keys or naming a leader', () => {
    const c = captured('A');
    const before = JSON.stringify(c);
    const out = run(turn(c));
    assert.equal(out.context.plan, null);
    assert.equal(out.context.decision_level, true);
    assert.equal(out.context.dsk, null);
    assert.equal(out.context.not_cited, 'no_identified_plan');
    assert.deepEqual(out.context.supplied_items.map(i => i.id), ['price_change_from_current', 'starter_tier_launched']);
    assert.ok(out.directive.includes('Stress-test the whole decision.'));
    assert.equal(out.check_inputs.plan_label, undefined);
    assert.equal(out.check_inputs.decision_level, true);
    // The existing directive bans ranking; no selected option or ranking data is supplied.
    assert.deepEqual(out.context.supplied_figures, []);
    assert.ok(!/\b(?:leads|ahead)\b/i.test(out.directive));
    assert.ok(!/\b(?:best|winner|leads|ahead)\b/i.test(fallbackReply(out.context)));
    assert.ok(out.directive.includes('‘Raise prices by 10%’ sets ‘Price change from current’'));
    assert.ok(out.directive.includes('‘Launch starter tier’ sets ‘Starter tier launched’'));
    assert.ok(!out.directive.includes('a figure Olumi estimated'));
    assert.equal(JSON.stringify(c), before);
  });

  it('A: prepares no keep/assumption card for either passed stories or the fallback at the route seam', () => {
    const c = captured('A');
    const out = run(turn(c));
    const draft = [
      'Two ways this decision went badly.',
      '1. Price change from current overshot what customers accepted. Watch for: renewal complaints. Mitigate: test the price change.',
      '2. Starter tier launched stalled before customers could join. Watch for: delayed signups. Mitigate: test the launch with a small group.',
      'Outside the model: what else could have blindsided this?',
    ].join('\n');
    const passed = settleMethodTurn(out, draft);
    assert.equal(passed.passed, true);
    assert.equal(cardCallFor(passed.target, c.graph), null);
    const fallback = settleMethodTurn(out, '');
    assert.equal(fallback.passed, false);
    assert.equal(cardCallFor(fallback.target, c.graph), null);
    for (const item of out.context.supplied_items) {
      assert.equal(item.card, null);
      assert.equal(cardCallFor(item, c.graph), null);
    }
  });

  it('ONE PROVENANCE AUTHORITY: A as captured — its absent-type cee_inference figures are Olumi\'s estimates on the F1 reader too', () => {
    const c = asCaptured('A');
    const ids = c.graph.nodes.filter(n => n.observed_state?.source === 'cee_inference' && n.observed_state?.extractionType === undefined
      && typeof n.observed_state?.value === 'number').map(n => n.id as string);
    assert.ok(ids.length > 0, 'precondition: the capture holds absent-type cee_inference figures');
    const factors = signalsOf(c)['model.goal_path_factors'];
    for (const id of ids) {
      const f = factors.find(x => x.factor_id === id);
      if (f !== undefined) assert.equal(f.value_authorship, 'olumi_estimate', id);
    }
    assert.ok(ids.some(id => factors.some(x => x.factor_id === id)), 'at least one is on the goal path (not vacuous)');
  });

  it('the review’s Monthly churn 4% probe is on an own-option path but is not an own lever', () => {
    const c = captured('A');
    c.graph.nodes.push({ id: 'monthly_churn_4', kind: 'factor', label: 'Monthly churn 4%',
      // Origin unestablished (a stamp the authority does not recognise): an absent-type `cee_inference` is now Olumi's estimate.
      observed_state: { source: UNRECOGNISED, value: 0.04 } });
    const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.1, std: 0.01 },
      provenance: { source: 'user_specified', magnitude: 'user_stated' } });
    c.graph.edges.push(edge('price_change_from_current', 'monthly_churn_4'), edge('monthly_churn_4', 'monthly_recurring_revenue'));
    const signals = signalsOf(c);
    assert.ok(signals['model.goal_path_links'].some(l => l.link_id === 'monthly_churn_4->monthly_recurring_revenue'
      && l.option_ids.includes('raise_prices_by_10')));
    assert.equal(signals['model.goal_path_factors'].find(f => f.factor_id === 'monthly_churn_4')?.value_authorship, 'unknown');
    const out = run(turn(c));
    assert.deepEqual(out.context.supplied_items.map(i => i.id), ['price_change_from_current', 'starter_tier_launched']);
    assert.ok(!out.directive.includes('Monthly churn 4%'));
  });

  it('B: entire grounded licensed-plan output is byte-equivalent to the base replay', () => {
    assert.equal(JSON.stringify(turn(captured('B'))), JSON.stringify(withApprovedMethodWords(base.B)));
  });

  it('C: whole decision turn and exact fallback are pinned with the grounding union intact', () => {
    const c = captured('C');
    const out = run(turn(c));
    const expected = JSON.parse(readFileSync(new URL('./fixtures/w9c/r2-controls.json', import.meta.url), 'utf8')).C;
    // Science 393023 LICENCE (a)/(b), 7 Oct: two → four unsized grounding links; every other whole-turn field stays pinned.
    assert.equal(JSON.stringify(out), JSON.stringify(withApprovedMethodWords(reclassifiedCTurn(expected.turn))));
    const fallback = settleMethodTurn(out, '');
    assert.equal(fallback.reply, expected.fallback);
    assert.equal(JSON.stringify(fallback), JSON.stringify(expected.settled));
    assert.equal(settleMethodTurn(out, fallback.reply).passed, true);
    assert.equal(cardCallFor(fallback.target, c.graph), null);
  });

  // ⭐ RE-RULED (AIE 19 Oct AMEND, DL-3 order; was "still refuse", pinned to base.A): the user's own links ground story-only stories.
  it('W9 all-user-sized links/values ground story-only stories on their own links (was: refuse)', () => {
    const c = JSON.parse(readFileSync(new URL('./fixtures/scout-premortem-paths.json', import.meta.url), 'utf8')).draw1;
    const graph: Graph = structuredClone(c.graph);
    graph.nodes = graph.nodes.filter(n => n.kind !== 'risk');
    const ids = new Set(graph.nodes.map(n => n.id));
    graph.edges = graph.edges.filter(e => ids.has(e.from) && ids.has(e.to)).map(e => ({
      ...e, provenance: { source: 'user_specified', magnitude: 'user_stated' },
    }));
    graph.nodes = graph.nodes.map(n => n.kind === 'factor' ? {
      ...n, observed_state: { ...n.observed_state, source: 'user_specified' },
    } : n);
    delete graph.goal_constraints;
    const out = assertUserLinkStories(methodTurnForReadback(PREMORTEM_PRESS_ID, { ...c, graph }), graph);
    assert.equal(out.context.decision_level, true);
    assert.equal(out.context.not_cited, 'no_identified_plan');
  });

  // ⭐ RE-RULED (AIE 19 Oct AMEND; was "retains the base empty-path refusal"): the pick stays on its own plan and path, and that
  // path's user-sized links ground story-only stories.
  it('explicit unlicensed A pick stays on its plan; its own user-sized links ground story-only stories (was: refusal)', () => {
    const c = captured('A');
    const out = assertUserLinkStories(turn(c, planPickChipId('raise_prices_by_10')), c.graph);
    assert.deepEqual(out.context.plan, { option_id: 'raise_prices_by_10', label: 'Raise prices by 10%', basis: 'user_selected' });
    const onPick = new Set(signalsOf(c)['model.goal_path_links'].filter(l => l.option_ids.includes('raise_prices_by_10')).map(l => l.link_id));
    for (const item of out.context.supplied_items) assert.ok(onPick.has(item.id), `${item.id} is off the picked plan's path`);
  });

  // ⭐ RE-RULED (AIE 19 Oct AMEND): the status-quo-only lever and its link still never ground anything (the boundary this row
  // protects); the own options' user-sized links now ground story-only stories, so the turn runs without them.
  it('a status-quo-only lever on a real goal path cannot rescue the own-option union', () => {
    const c = captured('A');
    for (const n of c.graph.nodes.filter(n => n.kind === 'factor')) n.observed_state.source = 'user_specified';
    c.graph.nodes.push({ id: 'off_path', kind: 'factor', label: 'Status quo lever',
      observed_state: { source: UNRECOGNISED, value: 10 } });
    c.graph.nodes.find(n => n.id === 'keep_pricing_as_it_is')!.interventions = { off_path: 10 };
    c.graph.edges.push({ from: 'off_path', to: 'monthly_recurring_revenue', strength: { mean: 0.1, std: 0.01 },
      provenance: { source: 'user_specified', magnitude: 'user_stated' } });
    const signals = signalsOf(c);
    assert.ok(signals['model.goal_path_factors'].some(f => f.factor_id === 'off_path' && f.value_authorship === 'unknown'));
    assert.deepEqual(signals['model.goal_path_links'].find(l => l.link_id === 'off_path->monthly_recurring_revenue')?.option_ids,
      ['keep_pricing_as_it_is']);
    const statusQuoOnly = ['off_path', 'off_path->monthly_recurring_revenue'];
    const first = assertUserLinkStories(turn(c), c.graph);
    assert.deepEqual(first.context.supplied_items.filter(i => statusQuoOnly.includes(i.id)), []);
    // Ownership and path are independent inputs to science. Bind the target as an own lever in the graph while
    // retaining the typed status-quo-only path, so this probe isolates the path guard rather than the lever guard.
    c.graph.nodes.find(n => n.id === 'raise_prices_by_10')!.interventions.off_path = 10;
    const second = assertUserLinkStories(methodTurnFromSignals(PREMORTEM_PRESS_ID, signals, c.graph), c.graph);
    assert.deepEqual(second.context.supplied_items.filter(i => statusQuoOnly.includes(i.id)), []);
  });

  // ⭐ RE-RULED (AIE 19 Oct AMEND): the lever fallback stays conservative (no such factor is ever grounded, with or without a card);
  // a current decision's own user-sized links now ground story-only stories instead; a stale Run keeps the full refusal.
  for (const change of ['user_source', 'brief_source', 'explicit_type', 'node_explicit_type', 'accepted', 'no_value', 'no_source', 'stale'] as const) {
    it(`empty union stays conservative: ${change}`, () => {
      const c = captured('A');
      for (const n of c.graph.nodes.filter(n => n.kind === 'factor')) {
        if (change === 'user_source') n.observed_state.source = 'user_specified';
        if (change === 'brief_source') { n.observed_state.source = 'brief_extraction'; delete n.observed_state.extractionType; /* one authority: a brief figure carries no AI marker */ }
        if (change === 'explicit_type') n.observed_state.extractionType = 'explicit';
        if (change === 'node_explicit_type') n.extractionType = 'explicit';
        if (change === 'accepted') n.observed_state.reviewed_by_user = { intent: 'confirm' };
        if (change === 'no_value') delete n.observed_state.value;
        if (change === 'no_source') delete n.observed_state.source;
      }
      if (change === 'stale') (c.analysis_state as { run_state: { kind: string } }).run_state.kind = 'complete_stale';
      if (change === 'stale') { assert.equal(turn(c)?.kind, 'unavailable'); return; }
      assertUserLinkStories(turn(c), c.graph);
    });
  }
});

it('Science 393023: as-served near-tie C now supplies a placeholder link', () => {
  const c = load('C').j as Read;
  const signals = signalsOf(c);
  assert.ok(signals['model.goal_path_links'].some(l => l.link_sizing === 'placeholder'));
  assert.deepEqual(run(turn(c)).context.supplied_items.map(i => i.id), [
    'price_rise', 'starter_tier_subscribers', 'support_capacity_strain->monthly_recurring_revenue',
    'price_rise->price_rise_churn', 'starter_tier_support_cost->support_capacity_strain',
    'starter_tier_subscribers->starter_tier_support_cost', 'price_rise_churn', 'support_capacity_strain',
  ]);
});
