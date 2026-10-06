/**
 * ⭐ T1b (Science d5, 6 Oct, RT-18 class Q1; Integrator lease #87 6009588974). The red team's £126k draft (guest 00ec6d16,
 * CEE c7878208, served graph): the user set BOTH links through "Service quality deterioration" (a risk with no unit or
 * level) on the canvas. P5 (c) then asked "how much monthly recurring revenue in £/month does a change in Service quality
 * deterioration bring?", a question M's missing unit makes unanswerable (no unit to record the answer per). d5: the user's
 * two bands size the path, because M's arbitrary scale cancels in β_in · β_out, so P5 must not fire. A ±1 gauge NEVER
 * overwrites a user band. Mixed case (one band, one unsized) and a derived unit (Q2) are the follow-up, not this file.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { notTargetTestableSentence, targetTestabilityOf, targetVerdictWithholdsTargetClaims, untestableTargetParts } from '../target-testability.js';
import { mediatorReadings } from '../../agent-lane/mediator-reading.js';
import { linkEffectEndUnits } from '../../system-events/link-effect-edit.js';

type Rec = Record<string, any>;
const SERVED = (): Rec => JSON.parse(readFileSync(new URL('./fixtures/t1b-126k-c7878208-graph.json', import.meta.url), 'utf8'));
const M = 'service_quality_deterioration';
const GOAL = 'monthly_recurring_revenue';
const edge = (g: Rec, from: string, to: string): Rec => g.edges.find((e: Rec) => e.from === from && e.to === to);
const caseC = (g: Rec) => {
  const v = targetTestabilityOf(g);
  return v.kind === 'not_testable' ? v.failures.find((f) => f.case === 'c') : undefined;
};

describe('T1b: two user bands through a level-less mediator size the path', () => {
  it('PRECONDITION (served graph): M has no unit or level, and both its links are bands the user SET', () => {
    const g = SERVED();
    const m = g.nodes.find((n: Rec) => n.id === M);
    expect(m.kind).toBe('risk');
    expect(m.observed_state?.unit).toBeUndefined();
    expect(linkEffectEndUnits(g, M, GOAL)!.source.own).toEqual([]); // why the served ask could not be answered
    for (const [from, to] of [['starter_support_cost', M], [M, GOAL]] as const) {
      expect(edge(g, from, to).provenance).toEqual({ source: 'user_specified' });
      expect(edge(g, from, to).provenance_display).toBe('user_set');
    }
  });

  it('RED (served): no P5 (c) on the user\'s banded path, so no question "per a change in" a node with no unit', () => {
    const g = SERVED();
    expect(caseC(g)).toBeUndefined();
    const v = targetTestabilityOf(g);
    expect(targetVerdictWithholdsTargetClaims(v)).toBe(false);
    expect(notTargetTestableSentence(g, v)).toBeNull();
    expect(untestableTargetParts(g, v)?.question ?? null).toBeNull();
  });

  it('NO GAUGE OVER A USER BAND (d5): M gets no ±1 gauge while the user\'s band sits on M→child; unbanded, it does (contrast)', () => {
    // The parent given a unit of its own, so the gauge's (B) rule ("a parent with a unit") would otherwise fire.
    const withUnit = (g: Rec): Rec => { g.nodes.find((n: Rec) => n.id === 'starter_support_cost').observed_state = { unit: '£/month' }; return g; };
    expect(mediatorReadings(withUnit(SERVED())).get(M)).toBeUndefined();
    const contrast = withUnit(SERVED());
    edge(contrast, M, GOAL).provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' };
    delete edge(contrast, M, GOAL).provenance_display;
    expect(mediatorReadings(contrast).get(M)).toEqual(expect.objectContaining({ via: 'gauge', child: GOAL }));
  });

  it('CONTROL one band + one unsized: the in-link is Olumi\'s placeholder → P5 (c) still asks (mixed case is the follow-up)', () => {
    const g = SERVED();
    const into = edge(g, 'starter_support_cost', M);
    into.provenance = { source: 'cee_hypothesis' };
    delete into.provenance_display;
    expect(caseC(g)?.link).toEqual({ from: M, to: GOAL });
  });

  it('CONTROL a link the user only DREW (no band set) is not a size → P5 (c) still asks', () => {
    const g = SERVED();
    delete edge(g, M, GOAL).provenance_display;
    expect(caseC(g)?.link).toEqual({ from: M, to: GOAL });
  });

  it('CONTROL M with its own unit and level is not level-less → the link into the goal is asked in its ends\' units', () => {
    const g = SERVED();
    g.nodes.find((n: Rec) => n.id === M).observed_state = { value: 0.2, raw_value: 20, unit: '%', cap: 100 };
    expect(caseC(g)?.link).toEqual({ from: M, to: GOAL });
  });

  it('CONTROL M with a second child: its scale does not cancel on one path → P5 (c) still asks', () => {
    const g = SERVED();
    g.edges.push({ ...edge(g, M, GOAL), to: 'price_rise_customer_losses', id: undefined });
    expect(caseC(g)?.link).toEqual({ from: M, to: GOAL });
  });
});
