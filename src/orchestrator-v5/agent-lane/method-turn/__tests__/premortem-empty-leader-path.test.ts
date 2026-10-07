/** W9: exact scout readback projections, not a synthetic estimate or leader licence. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { leaderLicenceFromState } from '../../../compose/leader-licence.js';
import { assembleGuidanceSignals, type GuidanceSignalInputs } from '../../turn-context/guidance-signals.js';
import {
  PREMORTEM_PRESS_ID, TALK_IT_THROUGH_CHIP, cardCallFor,
  methodTurnForReadback, planMethodTurn, planPickChipId, type RunMethodTurn,
} from '../method-turn.js';

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[]; goal_constraints?: unknown };
type Capture = {
  source: { capture: string; sha256: string; cee_build: string };
  graph: Graph;
  analysisState: { leader_claim: { permitted: boolean } };
  analysisResult: { leading_option_id: string | null };
  optionParticipation: unknown;
  /** The capture's own `current_read.analysis_ready`, so the route's readback reads the real leader licence. */
  analysisReady: unknown;
};
const captures = JSON.parse(readFileSync(new URL('./fixtures/scout-premortem-paths.json', import.meta.url), 'utf8')) as {
  draw1: Capture; draw2: Capture;
};
const inputsOf = (c: Capture): Omit<GuidanceSignalInputs, 'request' | 'explicitRequest'> => ({
  offeredSpecific: [], graph: c.graph, analysisState: c.analysisState, analysisResult: c.analysisResult,
  optionParticipation: c.optionParticipation, leaderLicensed: c.analysisState.leader_claim.permitted,
});
const turnFor = (c: Capture, chipId = PREMORTEM_PRESS_ID) => planMethodTurn({ chipId, signalInputs: inputsOf(c) });
const signalsOf = (c: Capture) => assembleGuidanceSignals({ ...inputsOf(c), request: 'method', explicitRequest: 'RC-PREMORTEM' });
const requireRun = (turn: ReturnType<typeof turnFor>): RunMethodTurn => {
  assert.equal(turn?.kind, 'run');
  if (turn?.kind !== 'run') throw new Error('expected a grounded method run');
  return turn;
};

describe('W9: empty licensed-leader path on a generic pre-mortem press', () => {
  it('RED at base: captured draw 1 keeps the original licensed decision byte for byte', () => {
    const c = captures.draw1;
    const signals = signalsOf(c);
    assert.equal(signals['run.leader_licensed'], true);
    assert.equal(signals['run.leader_option_id'], 'launch_starter_tier');
    assert.equal(signals['model.goal_path_factors'].find(f => f.factor_id === 'starter_tier_subscribers')?.value_authorship, 'unknown');
    assert.equal(signals['model.goal_path_links'].find(l => l.link_id === 'starter_tier_subscribers->monthly_recurring_revenue')?.link_sizing, 'user');
    assert.equal(leaderLicenceFromState(c.analysisState, c.analysisReady), 'permitted');
    const before = JSON.stringify(c);
    const out = requireRun(turnFor(c));
    assert.equal(out.context.plan, null);
    assert.equal(out.context.decision_level, true);
    assert.equal(out.check_inputs.plan_label, undefined);
    assert.equal(out.check_inputs.decision_level, true);
    assert.deepEqual(out.context.supplied_items.map(i => i.id), [
      'price_rise_mrr_uplift->monthly_recurring_revenue', 'customer_losses_from_price_rise',
    ]);
    // Original W9 licensed-leader contract is an explicit control, including its existing card.
    const base = JSON.parse(readFileSync(new URL('./fixtures/w9c/r2-base-controls.json', import.meta.url), 'utf8')).draw1;
    assert.equal(JSON.stringify(out), JSON.stringify(base.turn));
    assert.equal(cardCallFor(out.context.supplied_items[0], c.graph)?.tool, 'propose_link_strengths');
    assert.equal(out.context.dsk, null);
    assert.equal(out.context.not_cited, 'no_identified_plan');
    assert.ok(out.directive.includes('Stress-test the whole decision.'));
    assert.deepEqual(methodTurnForReadback(PREMORTEM_PRESS_ID, c), out);
    assert.equal(JSON.stringify(c), before);
  });

  it('CONTROL: captured draw 2 uses story-only own levers', () => {
    const c = captures.draw2;
    assert.equal(signalsOf(c)['run.leader_licensed'], false);
    const out = requireRun(turnFor(c));
    assert.equal(out.context.plan, null);
    assert.equal(out.context.decision_level, true);
    assert.deepEqual(out.context.supplied_items.map(i => i.id), [
      'price_change_from_today', 'starter_tier_availability',
      'monthly_recurring_revenue_lost_to_price_driven_churn->monthly_recurring_revenue',
      'monthly_recurring_revenue_lost_to_price_driven_churn',
    ]);
    // W9c: a decision story never offers an authorship/estimate approval.
    assert.equal(cardCallFor(out.context.supplied_items[0], c.graph), null);
    assert.equal(out.context.dsk, null);
    assert.equal(out.context.not_cited, 'no_identified_plan');
  });

  it('CONTROL: a whole model with only user-sized links and values still refuses without denying estimates', () => {
    const c = structuredClone(captures.draw1);
    c.graph.nodes = c.graph.nodes.filter(n => n.kind !== 'risk');
    const ids = new Set(c.graph.nodes.map(n => n.id));
    c.graph.edges = c.graph.edges.filter(e => ids.has(e.from) && ids.has(e.to)).map(e => ({
      ...e, provenance: { source: 'user_specified', magnitude: 'user_stated' },
    }));
    c.graph.nodes = c.graph.nodes.map(n => n.kind === 'factor' ? {
      ...n, observed_state: { ...(n.observed_state as object), source: 'user_specified' },
    } : n);
    delete c.graph.goal_constraints;
    const out = turnFor(c);
    assert.equal(out?.kind, 'unavailable');
    if (out?.kind !== 'unavailable') throw new Error('expected an empty-grounding refusal');
    assert.equal(out.reason, 'no_grounded_item');
    assert.ok(out.reply.includes('this decision'));
    assert.ok(!out.reply.includes('nothing on'));
    assert.ok(!out.reply.includes('Olumi’s estimate'));
    assert.deepEqual(out.actions, [TALK_IT_THROUGH_CHIP]);
  });

  it('CONTROL: an explicit own-option press stays on that plan and its path', () => {
    const c = captures.draw2;
    const out = requireRun(turnFor(c, planPickChipId('raise_prices_by_10')));
    assert.deepEqual(out.context.plan, { option_id: 'raise_prices_by_10', label: 'Raise prices by 10%', basis: 'user_selected' });
    assert.equal(out.context.decision_level, undefined);
    assert.equal(out.check_inputs.decision_level, undefined);
    assert.equal(out.check_inputs.plan_label, 'Raise prices by 10%');
    assert.ok(!out.directive.includes('Stress-test the whole decision.'));
  });

  it('CONTROL: a grounded licensed leader retains the existing option-plan method', () => {
    const c = structuredClone(captures.draw1);
    c.analysisResult.leading_option_id = 'raise_prices_by_10';
    const out = requireRun(turnFor(c));
    assert.deepEqual(out.context.plan, { option_id: 'raise_prices_by_10', label: 'Raise prices by 10%', basis: 'licensed_leader' });
    assert.equal(out.context.decision_level, undefined);
    assert.equal(out.context.dsk?.protocol_id, 'DSK-P-001');
    assert.ok(out.context.supplied_items.length > 0);
  });
});
