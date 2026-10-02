/**
 * RC-WIDEN's method turn (`widen-turn.ts`): the gate is by IDENTITY (DL 5947426886 rows), never by wording. Each refusal
 * row has its passing control beside it, so a gate that refuses everything (or nothing) is RED here.
 */
import { describe, expect, it } from 'vitest';

import { POLICY } from '../../guidance/policy.js';
import type { GuidanceSignals } from '../../turn-context/guidance-signals.js';
import {
  nextStepsWithWiden, settleWidenTurn, SOMETHING_ELSE_CHIP, WIDEN_CHIP, WIDEN_FALLBACK_TEMPLATE, WIDEN_REPLACES_CHIP_ID,
  WIDEN_CARD_LINE, widenGate, widenTurnFromSignals, type RunWidenTurn,
} from '../widen-turn.js';

/** A goal, two factors, two options that BOTH act on Price (same lever), and a status quo. */
const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'f_price', kind: 'factor', label: 'Price' },
    { id: 'f_churn', kind: 'factor', label: 'Customer churn' },
    { id: 'o_keep', kind: 'option', label: 'Keep £49' },
    { id: 'o_raise', kind: 'option', label: 'Raise to £59' },
    { id: 'o_sq', kind: 'option', label: 'Carry on as now' },
  ],
  edges: [
    { from: 'o_keep', to: 'f_price', strength: { mean: 0.4 } },
    { from: 'o_raise', to: 'f_price', strength: { mean: 0.6 } },
    { from: 'f_price', to: 'goal', strength: { mean: 0.5 } },
    { from: 'f_churn', to: 'goal', strength: { mean: -0.5 } },
  ],
};

const signals = (over: Partial<Record<keyof GuidanceSignals, unknown>> = {}): GuidanceSignals => ({
  'turn.request': 'method', 'open.decision_point': false, 'run.kind': 'complete_current', 'run.leader_licensed': false,
  'run.withheld_reason': 'every_option_likely_breaks_limit', 'run.leader_option_id': null,
  'run.decision_sensitivity': { status: 'not_measured' },
  'model.goal_present': true, 'model.goal_label': 'Revenue', 'model.goal_horizon': null,
  'model.status_quo_option_id': 'o_sq', 'model.non_sq_option_ids': ['o_keep', 'o_raise'],
  'model.option_labels': { o_keep: 'Keep £49', o_raise: 'Raise to £59', o_sq: 'Carry on as now' },
  'model.same_lever': true, 'model.risk_ids': [], 'model.goal_path_factor_ids': ['f_price', 'f_churn'],
  'model.goal_path_links': [], 'model.placeholder_goal_links': [], 'model.goal_path_factors': [],
  'since_run.goal_path_user_edits': { status: 'pending' }, guidance: {}, 'user.explicit_request': 'RC-WIDEN',
  ...over,
} as unknown as GuidanceSignals);

const run = (): RunWidenTurn => {
  const t = widenTurnFromSignals(signals(), GRAPH);
  if (t.kind !== 'run') throw new Error('expected a run turn');
  return t;
};
const est = { value: 2, unit: '%', estimate: true, basis: 'a typical retention programme' };

describe('RC-WIDEN method turn', () => {
  it('runs on typed signals: variant W1 (limit), target options; the directive names the factors by exact label', () => {
    const t = run();
    expect([t.variant, t.target]).toEqual(['W1', 'options']);
    expect(t.directive).toContain('METHOD TURN');
    expect(t.directive).toContain('‘Price’, ‘Customer churn’');
    expect(t.directive).toContain('- ‘Keep £49’: changes ‘Price’');
    expect(t.directive).toContain(POLICY.method_turns['RC-WIDEN'].body);
  });

  it('no goal → the unavailable reply, no model call', () => {
    const t = widenTurnFromSignals(signals({ 'model.goal_present': false }), GRAPH);
    expect(t.kind).toBe('unavailable');
  });

  it('PASS control: two options on a DIFFERENT factor set, grounded, figures only as Olumi’s estimate', () => {
    expect(widenGate(run(), { options: [
      { label: 'Retention offer for at-risk accounts', acts_on: [{ factor_label: 'Customer churn', direction: 'negative', level: est }] },
      { label: 'Cut price, cut churn', acts_on: [{ factor_label: 'Price', direction: 'negative' }, { factor_label: 'customer  churn', direction: 'negative' }] },
    ], rationale: 'r' })).toMatchObject({ ok: true });
    // The single-option form is gated the same way.
    expect(widenGate(run(), { label: 'Retention offer', acts_on: [{ factor_label: 'Customer churn', direction: 'negative' }], rationale: 'r' })).toMatchObject({ ok: true });
  });

  it('WD-S-DISTINCT (identity, not wording): a REWORDED copy of a current option — same factor, same direction — is refused', () => {
    // The label shares no words with either current option: a wording check would pass it.
    const copy = { label: 'Lift what we charge', acts_on: [{ factor_label: 'Price', direction: 'positive' }] };
    expect(widenGate(run(), { label: copy.label, acts_on: copy.acts_on, rationale: 'r' })).toEqual({ ok: false, failed: ['WD-S-DISTINCT'] });
    // Control: the same label on the opposite direction is a different mechanism.
    expect(widenGate(run(), { label: copy.label, acts_on: [{ factor_label: 'Price', direction: 'negative' }], rationale: 'r' })).toMatchObject({ ok: true });
    // Two proposals with one signature: the second is a copy of the first.
    const r = widenGate(run(), { options: [
      { label: 'Retention offer', acts_on: [{ factor_label: 'Customer churn', direction: 'negative' }] },
      { label: 'Loyalty scheme', acts_on: [{ factor_label: 'Customer churn', direction: 'negative' }] },
    ], rationale: 'r' });
    expect(r).toEqual({ ok: false, failed: ['WD-S-DISTINCT'] });
  });

  it('WD-NO-DUP: a current option’s label (case and spacing folded) is refused, the status quo included', () => {
    expect(widenGate(run(), { label: 'keep  £49', acts_on: [{ factor_label: 'Customer churn', direction: 'negative' }], rationale: 'r' }))
      .toEqual({ ok: false, failed: ['WD-NO-DUP'] });
    expect(widenGate(run(), { label: 'Carry on as now', acts_on: [{ factor_label: 'Customer churn', direction: 'negative' }], rationale: 'r' }))
      .toEqual({ ok: false, failed: ['WD-NO-DUP'] });
  });

  it('WD-S-GROUNDED: a factor the model does not have, or no factor at all, is refused', () => {
    expect(widenGate(run(), { label: 'Hire sales', acts_on: [{ factor_label: 'Sales headcount', direction: 'positive' }], rationale: 'r' }))
      .toEqual({ ok: false, failed: ['WD-S-GROUNDED'] });
    expect(widenGate(run(), { label: 'Hire sales', acts_on: [], rationale: 'r' })).toEqual({ ok: false, failed: ['WD-S-GROUNDED'] });
  });

  it('WD-NO-NEW-FIGURES: a level not marked as Olumi’s estimate (with a basis) is refused', () => {
    const bare = { label: 'Retention offer', acts_on: [{ factor_label: 'Customer churn', direction: 'negative', level: { value: 2, unit: '%' } }], rationale: 'r' };
    expect(widenGate(run(), bare)).toEqual({ ok: false, failed: ['WD-NO-NEW-FIGURES'] });
    const noBasis = { ...bare, acts_on: [{ ...bare.acts_on[0], level: { value: 2, estimate: true } }] };
    expect(widenGate(run(), noBasis)).toEqual({ ok: false, failed: ['WD-NO-NEW-FIGURES'] });
  });

  it('WD-COUNT and WD-S-NEW-FACTORS: 1 to 3 options, and no new factors in v1', () => {
    const o = (i: number) => ({ label: `Option ${i}`, acts_on: [{ factor_label: i % 2 ? 'Customer churn' : 'Price', direction: i < 2 ? 'negative' : 'positive' }] });
    expect(widenGate(run(), { options: [o(0), o(1), o(2), o(3)], rationale: 'r' })).toMatchObject({ ok: false, failed: expect.arrayContaining(['WD-COUNT']) });
    expect(widenGate(run(), { rationale: 'r' })).toEqual({ ok: false, failed: ['WD-COUNT'] });
    expect(widenGate(run(), { label: 'New lever', acts_on: [{ factor_label: 'Customer churn', direction: 'negative' }], new_factors: [{ label: 'X', affects: [] }], rationale: 'r' }))
      .toEqual({ ok: false, failed: ['WD-S-NEW-FACTORS'] });
  });

  it('settle: ONE passed card → the door’s own reply + Something else; anything else → RC’s fallback + Talk it through, no card', () => {
    const t = run();
    const ok = [{ name: 'propose_new_option', ok: true, proposal_id: 'gmh_0123456789ab' }];
    const card = settleWidenTurn(t, { assistant_text: 'I would add two options…', tool_calls: ok });
    expect(card).toEqual({ reply: 'I would add two options…', carded: true, actions: [SOMETHING_ELSE_CHIP] });
    // ⛔ A stored card is NEVER answered with the fallback (seam W-R1 caught it: the door composed no text at 1 hop).
    const gate = widenGate(t, { options: [
      { label: 'Retention offer', acts_on: [{ factor_label: 'customer churn', direction: 'negative' }] },
      { label: 'Cut price', acts_on: [{ factor_label: 'Price', direction: 'negative' }] },
    ], rationale: 'r' });
    const silent = settleWidenTurn(t, { assistant_text: '', tool_calls: ok }, gate);
    expect(silent.carded).toBe(true);
    expect(silent.reply).toBe('Options you haven\u2019t compared yet, each working a different way:\n'
      + '- Retention offer: lowers \u2018Customer churn\u2019\n- Cut price: lowers \u2018Price\u2019\n'
      + 'Approve to add them to the comparison, then re-analyse.');
    expect(settleWidenTurn(t, { assistant_text: '', tool_calls: ok }).reply).toBe(WIDEN_CARD_LINE);
    const refused = settleWidenTurn(t, { assistant_text: '', tool_calls: [{ name: 'propose_new_option', ok: false }] });
    expect(refused.carded).toBe(false);
    expect(refused.reply).toBe(WIDEN_FALLBACK_TEMPLATE.replace('{goal}', '‘Revenue’'));
    expect(refused.actions.map((a) => a.id)).toEqual(['agent-talk-it-through']);
    expect(settleWidenTurn(t, { assistant_text: 'x', tool_calls: [] }).carded).toBe(false);
  });

  it('contract pins: the fallback and the chip label are RC’s words', () => {
    expect(POLICY.method_turns['RC-WIDEN'].fallback).toContain(WIDEN_FALLBACK_TEMPLATE.replace('{goal}', '{goal}'));
    expect(WIDEN_CHIP.label).toBe('Suggest options');
  });

  it('next steps: Widen takes the "What would change the result?" place only when offered (three chips kept)', () => {
    const steps = [{ id: 'agent-next-pre-mortem', label: 'a', message: 'a' }, { id: WIDEN_REPLACES_CHIP_ID, label: 'b', message: 'b' }, { id: 'agent-next-strengthen', label: 'c', message: 'c' }];
    expect(nextStepsWithWiden(steps, true).map((s) => s.id)).toEqual(['agent-next-pre-mortem', 'agent-next-widen', 'agent-next-strengthen']);
    expect(nextStepsWithWiden(steps, false)).toEqual(steps);
  });
});
