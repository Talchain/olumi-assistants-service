/**
 * RC-WIDEN's method turn (`widen-turn.ts`): the gate is by IDENTITY (DL 5947426886 rows), never by wording. Each refusal
 * row has its passing control beside it, so a gate that refuses everything (or nothing) is RED here.
 *
 * ⛔ The fixture's option → factor edges are STRUCTURAL (+1.0, `STRUCTURAL_EDGE_DEFAULTS`), exactly as the product
 * writes them: an option's direction lives in its INTERVENTION (DL P1-A on #2512), so a gate that read the edge sign
 * would call every option "raises" and these rows go RED.
 */
import { describe, expect, it } from 'vitest';

import { POLICY } from '../../guidance/policy.js';
import type { GuidanceSignals } from '../../turn-context/guidance-signals.js';
import {
  actsWithout, doorFactorOf, existingLevers, keptProposalOf, nextStepsWithWiden, openAssumptionOf, sameLevers, settleWidenTurn, SOMETHING_ELSE_CHIP, WIDEN_CARD_LINE, WIDEN_CHIP,
  WIDEN_FALLBACK_TEMPLATE, WIDEN_REPLACES_CHIP_ID, widenDoorReply, widenGate as gateWithChecks, widenTurnFromSignals, type RunWidenTurn,
} from '../widen-turn.js';

// Preserve the existing exact verdict pins; W10 separately verifies the new per-option diagnostics.
const widenGate = (...args: Parameters<typeof gateWithChecks>) => {
  const result = gateWithChecks(...args);
  return result.ok ? { ok: true } : { ok: false, failed: result.failed };
};

const STRUCTURAL = { strength: { mean: 1.0 }, effect_direction: 'positive' };
/** A goal, two factors, a status quo at today's price, an option that CUTS the price and one that RAISES it. */
const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'f_price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
    { id: 'f_churn', kind: 'factor', label: 'Customer churn', observed_state: { value: 0.1 } },
    { id: 'o_cut', kind: 'option', label: 'Cut to £45', interventions: { f_price: { value: 0.2 } } },
    { id: 'o_raise', kind: 'option', label: 'Raise to £59', interventions: { f_price: { value: 0.3 } } },
    { id: 'o_sq', kind: 'option', label: 'Carry on as now', interventions: { f_price: { value: 0.245 } } },
  ],
  edges: [
    { from: 'o_cut', to: 'f_price', ...STRUCTURAL },
    { from: 'o_raise', to: 'f_price', ...STRUCTURAL },
    { from: 'o_sq', to: 'f_price', ...STRUCTURAL },
    { from: 'f_price', to: 'goal', strength: { mean: 0.5 } },
    { from: 'f_churn', to: 'goal', strength: { mean: -0.5 } },
  ],
};

const signals = (over: Partial<Record<keyof GuidanceSignals, unknown>> = {}): GuidanceSignals => ({
  'turn.request': 'method', 'open.decision_point': false, 'run.kind': 'complete_current', 'run.leader_licensed': false,
  'run.withheld_reason': 'every_option_likely_breaks_limit', 'run.leader_option_id': null,
  'run.decision_sensitivity': { status: 'not_measured' },
  'model.goal_present': true, 'model.goal_label': 'Revenue', 'model.goal_horizon': null,
  'model.status_quo_option_id': 'o_sq', 'model.non_sq_option_ids': ['o_cut', 'o_raise'],
  'model.option_labels': { o_cut: 'Cut to £45', o_raise: 'Raise to £59', o_sq: 'Carry on as now' },
  'model.same_lever': true, 'model.risk_ids': [], 'model.goal_path_factor_ids': ['f_price', 'f_churn'],
  'model.goal_path_links': [], 'model.placeholder_goal_links': [], 'model.goal_path_factors': [],
  'since_run.goal_path_user_edits': { status: 'pending' }, guidance: {}, 'user.explicit_request': 'RC-WIDEN',
  ...over,
} as unknown as GuidanceSignals);

const turnOn = (graph: unknown, over: Partial<Record<keyof GuidanceSignals, unknown>> = {}): RunWidenTurn => {
  const t = widenTurnFromSignals(signals(over), graph);
  if (t.kind !== 'run') throw new Error('expected a run turn');
  return t;
};
const run = (): RunWidenTurn => turnOn(GRAPH);
/** Olumi's framed estimate per factor and move: Price on its cap of 200 (today £49 = 0.245), churn on 0..1 (today 0.1). */
const LEVEL: Record<string, Record<'positive' | 'negative', { value: number; unit?: string }>> = {
  Price: { negative: { value: 45, unit: 'GBP' }, positive: { value: 70, unit: 'GBP' } },
  'Customer churn': { negative: { value: 0.05 }, positive: { value: 0.2 } },
  'customer churn': { negative: { value: 0.05 }, positive: { value: 0.2 } },
};
/** One proposed option; every factor carries Olumi's framed estimate unless the factor has none in LEVEL. */
const one = (label: string, ...acts: [string, 'positive' | 'negative'][]) => ({ label, rationale: 'r',
  acts_on: acts.map(([factor_label, direction]) => ({ factor_label, direction,
    ...(LEVEL[factor_label] !== undefined ? { level: { ...LEVEL[factor_label]![direction], estimate: true, basis: 'Olumi\u2019s estimate' } } : {}) })) });
const est = { value: 0.05, estimate: true, basis: 'a typical retention programme' };

describe('RC-WIDEN method turn', () => {
  it('runs on typed signals: variant W1 (limit), target options; the directive names the factors by exact label', () => {
    const t = run();
    expect([t.variant, t.target]).toEqual(['W1', 'options']);
    expect(t.directive).toContain('METHOD TURN');
    expect(t.directive).toContain('‘Price’, ‘Customer churn’');
    expect(t.directive).toContain('- ‘Cut to £45’: changes ‘Price’');
    expect(t.directive).toContain(POLICY.method_turns['RC-WIDEN'].body);
  });

  it('no goal → the unavailable reply, no model call', () => {
    expect(widenTurnFromSignals(signals({ 'model.goal_present': false }), GRAPH).kind).toBe('unavailable');
  });

  it('P1-A: an existing option’s direction comes from its INTERVENTION vs the baseline, never the structural edge (+1.0)', () => {
    expect([...existingLevers(GRAPH as never, 'o_cut', 'o_sq')]).toEqual([['f_price', 'negative']]);
    expect([...existingLevers(GRAPH as never, 'o_raise', 'o_sq')]).toEqual([['f_price', 'positive']]);
    expect([...existingLevers(GRAPH as never, 'o_sq', 'o_sq')]).toEqual([['f_price', 'unchanged']]);
  });

  it('P1-A WD-S-DISTINCT: a reworded LOWERING proposal copies the lowering option and is refused; RAISING copies the raise', () => {
    // "Trim what we charge" shares no word with "Cut to £45": a wording check passes it; the edge sign (+1.0) did too.
    expect(widenGate(run(), one('Trim what we charge', ['Price', 'negative']))).toEqual({ ok: false, failed: ['WD-S-DISTINCT'] });
    expect(widenGate(run(), one('Lift what we charge', ['Price', 'positive']))).toEqual({ ok: false, failed: ['WD-S-DISTINCT'] });
    // Control (DL): with ONLY the lowering option on the table, a RAISING proposal on the same factor passes.
    const onlyCut = { nodes: GRAPH.nodes.filter((n) => n.id !== 'o_raise'), edges: GRAPH.edges.filter((e) => e.from !== 'o_raise') };
    const t = turnOn(onlyCut, { 'model.non_sq_option_ids': ['o_cut'] });
    expect(widenGate(t, one('Lift what we charge', ['Price', 'positive']))).toEqual({ ok: true });
    expect(widenGate(t, one('Trim what we charge', ['Price', 'negative']))).toEqual({ ok: false, failed: ['WD-S-DISTINCT'] });
  });

  it('P1-D: NO finite baseline is NO direction — a missing or non-finite baseline reads `unknown`, refusing both directions', () => {
    for (const observed of [undefined, { value: 'n/a' }, { value: Number.NaN }]) {
      const g = { nodes: [...GRAPH.nodes, { id: 'f_x', kind: 'factor', label: 'Partner reach', ...(observed !== undefined ? { observed_state: observed } : {}) },
        { id: 'o_x', kind: 'option', label: 'Partner push', interventions: { f_x: { value: 0.6 } } }],
        edges: [...GRAPH.edges, { from: 'o_x', to: 'f_x', ...STRUCTURAL }] };
      expect([...existingLevers(g as never, 'o_x', 'o_sq')], JSON.stringify(observed)).toEqual([['f_x', 'unknown']]);
      const t = turnOn(g, { 'model.non_sq_option_ids': ['o_cut', 'o_raise', 'o_x'] });
      // A proposal on that factor cannot persist a move either (no baseline): refused, both directions.
      const lvl = (direction: 'positive' | 'negative') => ({ label: `Partner ${direction}`, rationale: 'r',
        acts_on: [{ factor_label: 'Partner reach', direction, level: { value: 0.7, estimate: true, basis: 'b' } }] });
      expect(widenGate(t, lvl('positive'))).toEqual({ ok: false, failed: ['WD-S-LEVEL'] });
      expect(widenGate(t, lvl('negative'))).toEqual({ ok: false, failed: ['WD-S-LEVEL'] });
    }
  });

  it('P1-E: a proposed LEVEL decides the move on the door\u2019s own frame — a "cut" to £60 when today is £49 is refused', () => {
    // Today £49 (0.245 on the cap of 200); the only other option raises to £59. A "cut" to £60 would be WRITTEN as a rise.
    const onlyRaise = { nodes: GRAPH.nodes.filter((n) => n.id !== 'o_cut'), edges: GRAPH.edges.filter((e) => e.from !== 'o_cut') };
    const t = turnOn(onlyRaise, { 'model.non_sq_option_ids': ['o_raise'] });
    const cut = (value: number) => ({ label: 'Cut what we charge', rationale: 'r',
      acts_on: [{ factor_label: 'Price', direction: 'negative', level: { value, unit: 'GBP', estimate: true, basis: 'b' } }] });
    expect(widenGate(t, cut(60))).toEqual({ ok: false, failed: ['WD-S-DIRECTION'] });
    expect(widenGate(t, cut(49)), 'a "cut" that keeps today\u2019s level is not a cut').toEqual({ ok: false, failed: ['WD-S-DIRECTION'] });
    // Control: a TRUE lowering to £45 passes.
    expect(widenGate(t, cut(45))).toEqual({ ok: true });
  });

  it('P1-F SCOPE CUT: the gate judges what the writer will PERSIST — every changed factor needs a framed Olumi estimate', () => {
    const onlyRaise = { nodes: GRAPH.nodes.filter((n) => n.id !== 'o_cut'), edges: GRAPH.edges.filter((e) => e.from !== 'o_cut') };
    const t = turnOn(onlyRaise, { 'model.non_sq_option_ids': ['o_raise'] });
    const price59 = { factor_label: 'Price', direction: 'positive', level: { value: 59, unit: 'GBP', estimate: true, basis: 'b' } };
    // The Codex mixed case: Price £59 (= the existing raise) + Churn with NO level. The writer drops the unset Churn and
    // Approve would persist an exact copy of "Raise to £59" → refused.
    // Both reasons hold: the unset Churn never persists (WD-S-LEVEL), and what WOULD persist, Price £59 alone, is a copy.
    expect(widenGate(t, { label: 'Raise and retain', rationale: 'r', acts_on: [price59, { factor_label: 'Customer churn', direction: 'negative' }] }))
      .toEqual({ ok: false, failed: ['WD-S-LEVEL', 'WD-S-DISTINCT'] });
    // An unframed level (churn has no frame; 5 is outside 0..1, so the door would not store it) → refused.
    expect(widenGate(t, { label: 'Retention push', rationale: 'r', acts_on: [{ factor_label: 'Customer churn', direction: 'positive', level: { value: 5, estimate: true, basis: 'b' } }] }))
      .toEqual({ ok: false, failed: ['WD-S-LEVEL'] });
    // A level that contradicts the figure in the option's own name: the door leaves it unset → refused.
    expect(widenGate(t, { label: 'Cut to £40', rationale: 'r', acts_on: [{ factor_label: 'Price', direction: 'negative', level: { value: 45, unit: 'GBP', estimate: true, basis: 'b' } }] }))
      .toEqual({ ok: false, failed: ['WD-S-LEVEL'] });
    // No level at all → refused.
    expect(widenGate(t, { label: 'Cut what we charge', rationale: 'r', acts_on: [{ factor_label: 'Price', direction: 'negative' }] }))
      .toEqual({ ok: false, failed: ['WD-S-LEVEL'] });
    // Control: Price £45 + Churn at a framed estimate → passes; and Price £59 + a framed Churn is a REAL second lever.
    expect(widenGate(t, one('Cut price and retain', ['Price', 'negative'], ['Customer churn', 'negative']))).toEqual({ ok: true });
    expect(widenGate(t, { label: 'Raise and retain', rationale: 'r', acts_on: [price59, { factor_label: 'Customer churn', direction: 'negative', level: { ...est } }] }))
      .toEqual({ ok: true });
  });

  it('P1-G: the gate reads units as the DOOR does — a level in another unit, the name rule on the factor\u2019s unit, a repeated factor', () => {
    // Churn measured in % on its own level, and (second graph) only through a limit in the RAW graph's goal_constraints.
    const pct = { ...GRAPH, nodes: GRAPH.nodes.map((n) => (n.id === 'f_churn' ? { ...n, observed_state: { value: 0.1, unit: '%' } } : n)) };
    const viaLimit = { ...GRAPH, goal_constraints: [{ node_id: 'f_churn', operator: '<=', value: 0.3, unit: '%' }] };
    const churnAt = (unit?: string) => ({ label: 'Retention push', rationale: 'r',
      acts_on: [{ factor_label: 'Customer churn', direction: 'negative', level: { value: 0.05, ...(unit !== undefined ? { unit } : {}), estimate: true, basis: 'b' } }] });
    // (a) A churn level stated in GBP: the door records unitMismatch and stores no level → refused, on both unit sources.
    expect(widenGate(turnOn(pct), churnAt('GBP'))).toEqual({ ok: false, failed: ['WD-S-LEVEL'] });
    expect(widenGate(turnOn(viaLimit), churnAt('GBP'))).toEqual({ ok: false, failed: ['WD-S-LEVEL'] });
    // Controls: the same level in the factor's own unit, or with no unit, persists.
    expect(widenGate(turnOn(pct), churnAt('%'))).toEqual({ ok: true });
    expect(widenGate(turnOn(viaLimit), churnAt())).toEqual({ ok: true });
    // (b) No unit on the level: the door reads the name with the FACTOR's unit (GBP), so only '£27' counts → contradicts 45.
    // Without the fallback, '45%' in the name would match 45 and the gate would pass a level that never persists.
    // On a model without 'Cut to £45', so a refusal here is the level's, never WD-S-DISTINCT against that option.
    const noCut = turnOn({ nodes: GRAPH.nodes.filter((n) => n.id !== 'o_cut'), edges: GRAPH.edges.filter((e) => e.from !== 'o_cut') },
      { 'model.non_sq_option_ids': ['o_raise'] });
    const priceNoUnit = (label: string) => ({ label, rationale: 'r',
      acts_on: [{ factor_label: 'Price', direction: 'negative', level: { value: 45, estimate: true, basis: 'b' } }] });
    expect(widenGate(noCut, priceNoUnit('Take 45% off to £27'))).toEqual({ ok: false, failed: ['WD-S-LEVEL'] });
    // Control: the factor's unit also drops a figure of another kind — '£20' is not a churn level, so 0.05 persists.
    expect(widenGate(turnOn(pct), { ...churnAt(), label: 'Spend £20 a head on retention' })).toEqual({ ok: true });
    expect(widenGate(noCut, priceNoUnit('Take it down to £45'))).toEqual({ ok: true });
    // (c) A factor twice in one option: the door keeps the FIRST direction but the LAST level → refused.
    expect(widenGate(noCut, one('Cut then raise', ['Price', 'negative'], ['Price', 'positive']))).toEqual({ ok: false, failed: ['WD-S-LEVEL'] });
    expect(widenGate(noCut, one('Cut twice', ['Price', 'negative'], ['Price', 'negative']))).toEqual({ ok: false, failed: ['WD-S-LEVEL'] });
  });

  it('fail closed: an option whose direction is UNKNOWN (no level set) matches any proposal on the same factors', () => {
    const g = { nodes: [...GRAPH.nodes, { id: 'o_new', kind: 'option', label: 'Loyalty scheme' }],
      edges: [...GRAPH.edges, { from: 'o_new', to: 'f_churn', ...STRUCTURAL }] };
    expect([...existingLevers(g as never, 'o_new', 'o_sq')]).toEqual([['f_churn', 'unknown']]);
    const t = turnOn(g, { 'model.non_sq_option_ids': ['o_cut', 'o_raise', 'o_new'] });
    expect(widenGate(t, one('Retention offer', ['Customer churn', 'negative']))).toEqual({ ok: false, failed: ['WD-S-DISTINCT'] });
    expect(widenGate(t, one('Retention offer', ['Customer churn', 'positive']))).toEqual({ ok: false, failed: ['WD-S-DISTINCT'] });
    // Control: a different factor SET is distinct even beside an unknown.
    expect(widenGate(t, one('Bundle', ['Customer churn', 'negative'], ['Price', 'negative']))).toEqual({ ok: true });
  });

  it('PASS control: two options on a DIFFERENT lever set, grounded, figures only as Olumi’s estimate', () => {
    expect(widenGate(run(), { options: [
      { label: 'Retention offer for at-risk accounts', acts_on: [{ factor_label: 'Customer churn', direction: 'negative', level: est }] },
      one('Cut price, cut churn', ['Price', 'negative'], ['customer churn', 'negative']),
    ], rationale: 'r' })).toEqual({ ok: true });
    expect(widenGate(run(), one('Retention offer', ['Customer churn', 'negative']))).toEqual({ ok: true });
    // W10 DL ruling: the second copy is dropped, while the first is admitted.
    expect(widenGate(run(), { options: [one('Retention offer', ['Customer churn', 'negative']), one('Loyalty scheme', ['Customer churn', 'negative'])], rationale: 'r' }))
      .toEqual({ ok: true });
  });

  it('WD-NO-DUP: a current option’s label (case and spacing folded) is refused, the status quo included', () => {
    expect(widenGate(run(), one('cut  to £45', ['Customer churn', 'negative']))).toMatchObject({ ok: false, failed: expect.arrayContaining(['WD-NO-DUP']) });
    expect(widenGate(run(), one('Carry on as now', ['Customer churn', 'negative']))).toEqual({ ok: false, failed: ['WD-NO-DUP'] });
  });

  it('an option LEFT OUT of the comparison is existing too: re-proposing it (by label or by levers) is refused', () => {
    const g = { nodes: [...GRAPH.nodes, { id: 'o_out', kind: 'option', label: 'Phased churn programme', proposed_by: 'olumi', interventions: { f_churn: { value: 0.05 } } }],
      edges: [...GRAPH.edges, { from: 'o_out', to: 'f_churn', ...STRUCTURAL }] };
    const t = turnOn(g);
    expect(t.directive).toContain('- ‘Phased churn programme’ (left out of the comparison): changes ‘Customer churn’');
    expect(widenGate(t, one('Phased churn programme', ['Price', 'negative'], ['Customer churn', 'positive']))).toEqual({ ok: false, failed: ['WD-NO-DUP'] });
    expect(widenGate(t, one('Retention offer', ['Customer churn', 'negative']))).toEqual({ ok: false, failed: ['WD-S-DISTINCT'] });
    expect(widenGate(run(), one('Retention offer', ['Customer churn', 'negative']))).toEqual({ ok: true });
  });

  it('P2-C: the gate resolves a factor exactly as the DOOR does (label OR description); an ambiguous label is refused', () => {
    const g = { nodes: [...GRAPH.nodes, { id: 'f_ret', kind: 'factor', label: 'Retention', description: 'Customer churn' }], edges: GRAPH.edges };
    const t = turnOn(g);
    expect(doorFactorOf(t, 'Customer churn'), 'label of one, description of another: the door would pick the FIRST').toBeUndefined();
    expect(widenGate(t, one('Retention offer', ['Customer churn', 'negative']))).toEqual({ ok: false, failed: ['WD-S-GROUNDED'] });
    // Controls: a unique label resolves; a unique description resolves to the node the door picks.
    expect(doorFactorOf(t, '  PRICE ')).toBe('f_price');
    const d = turnOn({ nodes: [...GRAPH.nodes, { id: 'f_ret', kind: 'factor', label: 'Retention', description: 'How many stay' }], edges: GRAPH.edges });
    expect(doorFactorOf(d, 'how many stay')).toBe('f_ret');
  });

  it('WD-S-GROUNDED: a factor the model does not have, or no factor at all, is refused', () => {
    expect(widenGate(run(), one('Hire sales', ['Sales headcount', 'positive']))).toEqual({ ok: false, failed: ['WD-S-GROUNDED'] });
    expect(widenGate(run(), { label: 'Hire sales', acts_on: [], rationale: 'r' })).toEqual({ ok: false, failed: ['WD-S-GROUNDED'] });
  });

  it('WD-NO-NEW-FIGURES: a level not marked as Olumi’s estimate (with a basis) is refused', () => {
    const bare = { label: 'Retention offer', acts_on: [{ factor_label: 'Customer churn', direction: 'negative', level: { value: 2, unit: '%' } }], rationale: 'r' };
    expect(widenGate(run(), bare)).toEqual({ ok: false, failed: ['WD-NO-NEW-FIGURES'] });
    const noBasis = { ...bare, acts_on: [{ ...bare.acts_on[0], level: { value: 2, estimate: true } }] };
    expect(widenGate(run(), noBasis)).toEqual({ ok: false, failed: ['WD-NO-NEW-FIGURES'] });
  });

  it('WD-COUNT and WD-S-NEW-FACTORS: 1 to 3 options, and no new factors in v1', () => {
    const o = (i: number) => one(`Option ${i}`, [i % 2 ? 'Customer churn' : 'Price', i < 2 ? 'negative' : 'positive']);
    expect(widenGate(run(), { options: [o(0), o(1), o(2), o(3)], rationale: 'r' })).toMatchObject({ ok: false, failed: expect.arrayContaining(['WD-COUNT']) });
    expect(widenGate(run(), { rationale: 'r' })).toEqual({ ok: false, failed: ['WD-COUNT'] });
    expect(widenGate(run(), { ...one('New lever', ['Customer churn', 'negative']), new_factors: [{ label: 'X', affects: [] }] }))
      .toEqual({ ok: false, failed: ['WD-S-NEW-FACTORS'] });
  });

  it('P1-B: the reply comes from the DOOR’S TYPED RESULT — only what it HELD, plus every option it left out', () => {
    const held = { ok: true, mutated: false, proposal_id: 'gmh_0123456789ab',
      options: [
        { label: 'Retention offer', levels: [{ factor: 'Customer churn', value: 2, unit: '%', stated_by: 'olumi_estimate', basis: 'b' }] },
        { label: 'Bundle', levels: [{ factor: 'Price', value: null, still_needed: true }] },
      ],
      not_added: [{ option: 'Hold at £49', same_levels_as: 'Carry on as now' }] };
    expect(widenDoorReply(held)).toBe('Options you haven’t compared yet:\n'
      + '- Retention offer: sets ‘Customer churn’ (Olumi’s estimate)\n'
      + '- Bundle: sets ‘Price’ (level still needed)\n'
      + 'Not in this change: ‘Hold at £49’ would set the same levels as ‘Carry on as now’.\n'
      + 'Approve to add them to the comparison, then re-analyse.');
    const single = { ok: true, proposal_id: 'gmh_x', option: { label: 'Retention offer' }, levels: [{ factor: 'Customer churn', value: 2, stated_by: 'user' }] };
    expect(widenDoorReply(single)).toBe('An option you haven’t compared yet:\n- Retention offer: sets ‘Customer churn’ (your figure)\nApprove to add it to the comparison, then re-analyse.');
    expect(widenDoorReply({ ok: true })).toBeNull();
  });

  it('settle: ONE passed card → the door’s reply (its own text, else its typed result); anything else → RC’s fallback, no card', () => {
    const t = run();
    const ok = [{ name: 'propose_new_option', ok: true, proposal_id: 'gmh_0123456789ab' }];
    expect(settleWidenTurn(t, { assistant_text: 'I would add two options…', tool_calls: ok }))
      .toEqual({ reply: 'I would add two options…', carded: true, actions: [SOMETHING_ELSE_CHIP] });
    // ⛔ A stored card is NEVER answered with the fallback (seam W-R1: the door composed no text at 1 hop).
    const doorResult = { ok: true, proposal_id: 'gmh_0123456789ab', option: { label: 'Retention offer' }, levels: [] };
    const silent = settleWidenTurn(t, { assistant_text: '', tool_calls: ok, tool_results: [doorResult] });
    expect(silent).toEqual({ reply: widenDoorReply(doorResult), carded: true, actions: [SOMETHING_ELSE_CHIP] });
    expect(settleWidenTurn(t, { assistant_text: '', tool_calls: ok }).reply).toBe(WIDEN_CARD_LINE);
    const refused = settleWidenTurn(t, { assistant_text: '', tool_calls: [{ name: 'propose_new_option', ok: false }] });
    expect(refused.carded).toBe(false);
    expect(refused.reply).toBe(WIDEN_FALLBACK_TEMPLATE.replace('{goal}', '‘Revenue’'));
    expect(refused.actions.map((a) => a.id)).toEqual(['agent-talk-it-through']);
  });

  it('sameLevers: exact lever set; unknown matches any direction; size or factor differences are distinct', () => {
    const m = (...e: [string, 'positive' | 'negative' | 'unchanged' | 'unknown'][]) => new Map(e);
    expect(sameLevers(m(['a', 'negative']), m(['a', 'negative']))).toBe(true);
    expect(sameLevers(m(['a', 'negative']), m(['a', 'unknown']))).toBe(true);
    expect(sameLevers(m(['a', 'negative']), m(['a', 'positive']))).toBe(false);
    expect(sameLevers(m(['a', 'negative']), m(['a', 'unchanged']))).toBe(false);
    expect(sameLevers(m(['a', 'negative'], ['b', 'negative']), m(['a', 'negative']))).toBe(false);
    expect(sameLevers(m(), m())).toBe(false);
  });

  it('contract pins: the fallback and the chip label are RC’s words', () => {
    expect(POLICY.method_turns['RC-WIDEN'].fallback).toContain(WIDEN_FALLBACK_TEMPLATE);
    expect(WIDEN_CHIP.label).toBe('Suggest options');
  });

  it('next steps: Widen takes the "What would change the result?" place only when offered (three chips kept)', () => {
    const steps = [{ id: 'agent-next-pre-mortem', label: 'a', message: 'a' }, { id: WIDEN_REPLACES_CHIP_ID, label: 'b', message: 'b' }, { id: 'agent-next-strengthen', label: 'c', message: 'c' }];
    expect(nextStepsWithWiden(steps, true).map((s) => s.id)).toEqual(['agent-next-pre-mortem', 'agent-next-widen', 'agent-next-strengthen']);
    expect(nextStepsWithWiden(steps, false)).toEqual(steps);
  });
});

describe('Living Model causal paths and selected goal identity', () => {
  const assumptionGraph = (multihop: boolean) => ({
    ...GRAPH,
    goal_node_id: 'goal',
    nodes: [...GRAPH.nodes, { id: 'f_alt', kind: 'factor', label: 'Referral rate', observed_state: { value: 0.1 } },
      { id: 'out_suffix', kind: 'outcome', label: 'Retained revenue' },
      { id: 'out_alt', kind: 'outcome', label: 'New revenue' }],
    edges: [
      ...GRAPH.edges.filter((e) => e.from !== 'f_churn'),
      { from: 'f_price', to: 'f_churn', provenance: { magnitude: 'olumi_estimate' }, strength: { mean: 0.3 } },
      ...(multihop ? [{ from: 'f_churn', to: 'out_suffix' }, { from: 'out_suffix', to: 'goal' },
        { from: 'f_alt', to: 'out_alt' }, { from: 'out_alt', to: 'goal' }]
        : [{ from: 'f_churn', to: 'goal' }, { from: 'f_alt', to: 'goal' }]),
    ] as Record<string, unknown>[],
  });
  const alt = { label: 'Referral programme', rationale: 'r', acts_on: [{ factor_label: 'Referral rate', direction: 'positive',
    level: { value: 0.2, estimate: true, basis: 'a typical referral programme' } }] };

  it.each([false, true])('direct/multihop control (%s): an open causal assumption and a different goal path pass', (multihop) => {
    const g = assumptionGraph(multihop);
    const q = openAssumptionOf(g, 'f_price', 'f_churn')!;
    expect(q).toMatchObject({ goal_id: 'goal', goal_label: 'Revenue' });
    expect(actsWithout(g, 'f_alt', q)).toBe(true);
    expect(widenGate(widenTurnFromSignals(signals(), g, q) as RunWidenTurn, alt)).toEqual({ ok: true });
  });

  for (const multihop of [false, true]) {
    for (const blocked of [{ edge_type: 'bidirected' }, { exists_probability: 0 }]) {
      it.each(['questioned', 'suffix', 'alternative'] as const)(
        `rejects ${JSON.stringify(blocked)} at %s (${multihop ? 'multihop' : 'direct'})`, (position) => {
          const g = assumptionGraph(multihop);
          const from = position === 'questioned' ? 'f_price' : position === 'suffix'
            ? (multihop ? 'out_suffix' : 'f_churn') : (multihop ? 'out_alt' : 'f_alt');
          const to = position === 'questioned' ? 'f_churn' : 'goal';
          g.edges = g.edges.map((e) => e.from === from && e.to === to ? { ...e, ...blocked } : e);
          const q = openAssumptionOf(g, 'f_price', 'f_churn');
          if (position !== 'alternative') expect(q).toBeUndefined();
          else {
            expect(q).toBeDefined();
            expect(actsWithout(g, 'f_alt', q!)).toBe(false);
            expect(widenGate(widenTurnFromSignals(signals(), g, q) as RunWidenTurn, alt))
              .toEqual({ ok: false, failed: ['CH-OTHER-MECHANISM'] });
          }
        });
    }
  }

  it.each([false, true])('selected goal ID, directive, headline and fallback agree after goal reorder (%s)', (reverse) => {
    const g = assumptionGraph(false);
    const other = { id: 'goal_other', kind: 'goal', label: 'Customer satisfaction' };
    g.nodes = reverse ? [...g.nodes, other] : [other, ...g.nodes];
    const q = openAssumptionOf(g, 'f_price', 'f_churn')!;
    const t = widenTurnFromSignals(signals({ 'model.goal_label': 'Customer satisfaction' }), g, q) as RunWidenTurn;
    expect(t.goal_label).toBe('Revenue');
    expect(t.directive).toContain('The goal is ‘Revenue’.');
    expect(t.directive).not.toContain('Customer satisfaction');
    const card = settleWidenTurn(t, { assistant_text: 'A referral programme.',
      tool_calls: [{ name: 'propose_new_option', ok: true, proposal_id: 'gmh_0123456789ab' }] });
    expect(card.reply).toContain('Revenue');
    expect(card.reply).not.toContain('Customer satisfaction');
    expect(keptProposalOf(card.actions[0]!.id)).toBe('gmh_0123456789ab');
    const fallback = settleWidenTurn(t, { assistant_text: '', tool_calls: [] });
    expect(fallback.reply).toContain('Revenue');
    expect(fallback.reply).not.toContain('Customer satisfaction');
    // A path only to the other goal never qualifies as a path to the selected goal.
    g.edges = g.edges.map((e) => e.from === 'f_alt' ? { ...e, to: 'goal_other' } : e);
    expect(actsWithout(g, 'f_alt', q)).toBe(false);
  });
});
