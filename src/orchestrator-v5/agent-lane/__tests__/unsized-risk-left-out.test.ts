/**
 * ⭐ ONE RULE FOR AN UNSIZED RISK, IN EVERY JOURNEY (DL 19:26Z 14 Oct, T1H item (a)). Served hiring r3 (CEE 9c3b5808,
 * `live/runs/2026-10-14T183841Z-hiring-t1h-positive-r3`, read 02 after approve): the drafted risk ‘Code quality degradation’
 * had no figure and no window for any card to size it, so readiness held the whole Run on MISSING_FACTOR_LEVEL. The rule: a
 * risk nobody has sized is left out of the calculation (never sampled at zero, never given an invented occurrence), the host
 * says so once with its labelled step, and a risk the user put there themselves still asks first.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessRouteAdmission } from '../../../cee/graph-readiness/canonical-readiness.js';
import { decisionInputLines } from '../decision-input-ask.js';
import { unsizedRiskIds, withoutUnsizedRisks } from '../risk-occurrence.js';

type Rec = Record<string, any>;
const BODY = (JSON.parse(readFileSync(new URL('./fixtures/hiring-t1h-positive-r3-read02-after-approve.json', import.meta.url), 'utf8')) as Rec).body as Rec;
const RISK = 'code_quality_degradation';
const LINE = '‘Code quality degradation’ has no figure yet, so this analysis leaves it out.';
const nodeOf = (g: Rec, id: string) => (g.nodes as Rec[]).find((n) => n.id === id)!;
const withRisk = (patch: Rec): Rec => {
  const g = structuredClone(BODY.graph);
  Object.assign(nodeOf(g, RISK), patch);
  return g;
};
const riskAsks = (g: Rec) => assessRouteAdmission(g).readiness_issues.filter((i) => i.factor_id === RISK);
const lines = (g: Rec, chanceCells: Rec[] = []) => decisionInputLines(g, { restingText: '', questionsToggle: false, awaitingApproval: false,
  builtOrRan: true, chanceCells: chanceCells as never });
const FIGURE = [{ option_id: 'hire_a_tech_lead', kind: 'figure', display: '41%' }];

describe('an unsized drafted risk is left out of the chance, said once, never a block on the Run', () => {
  it('PRECONDITION (as served): the Run was held on the drafted risk alone, which no one sized and the user did not add', () => {
    expect(BODY.current_read.analysis_ready.blockers).toEqual([expect.objectContaining({ factor_id: RISK, blocker_type: 'missing_value' })]);
    const risk = nodeOf(BODY.graph, RISK);
    expect(risk).toMatchObject({ kind: 'risk', label: 'Code quality degradation' });
    expect(risk.provenance).not.toBe('user_set');
    expect(risk).not.toHaveProperty('observed_state');
    expect(risk).not.toHaveProperty('event_risk');
  });

  it('RED→GREEN readiness: the same saved model no longer asks for the risk, and the Run is admitted', () => {
    expect(riskAsks(BODY.graph)).toEqual([]);
    expect(assessRouteAdmission(BODY.graph).may_run).toBe(true);
    expect([...unsizedRiskIds(BODY.graph)]).toEqual([RISK]);
  });

  it('the Run sends the model without the risk and every link touching it; nothing else moves; the saved model is untouched', () => {
    const before = JSON.stringify(BODY.graph);
    const sent = withoutUnsizedRisks(BODY.graph) as Rec;
    expect(JSON.stringify(BODY.graph)).toBe(before);
    expect((sent.nodes as Rec[]).map((n) => n.id)).toEqual((BODY.graph.nodes as Rec[]).map((n) => n.id).filter((id) => id !== RISK));
    expect((sent.edges as Rec[]).filter((e) => e.from === RISK || e.to === RISK)).toEqual([]);
    expect(sent.edges).toEqual((BODY.graph.edges as Rec[]).filter((e) => e.from !== RISK && e.to !== RISK));
  });

  it('said ONCE by the host, on the build turn and beside a chance; no window here, so no step it cannot keep', () => {
    expect(lines(BODY.graph).filter((l) => l.includes('Code quality degradation'))).toEqual([LINE]);
    expect(lines(BODY.graph, FIGURE).filter((l) => l.includes('Code quality degradation')))
      .toEqual(['‘Code quality degradation’ has no figure yet, so this analysis leaves it out and the chances shown don’t include it.']);
  });

  it('with the goal’s one period held (3 months), the line offers the labelled step: the user’s own words, or Olumi’s press-only estimate', () => {
    const g = structuredClone(BODY.graph);
    const goal = nodeOf(g, 'productivity');
    goal.goal_target_basis = { ...goal.goal_target_basis, period_months: 3 };
    expect(lines(g).filter((l) => l.includes('Code quality degradation'))).toEqual([`${LINE} To include it, say whether it’s already true now, `
      + 'or how likely it is to happen at least once within 3 months; or ask Olumi to suggest a starting estimate for you to review.']);
  });

  it('CONTRASTS (kept): the user’s own risk, a sized risk, a caused risk and a risk an option sets are never left out', () => {
    // The user put it there themselves: it still asks first, and the Run waits for it.
    const own = withRisk({ provenance: 'user_set' });
    expect(unsizedRiskIds(own).size).toBe(0);
    expect(riskAsks(own)).toEqual([expect.objectContaining({ code: 'MISSING_FACTOR_LEVEL' })]);
    expect(lines(own).some((l) => l.includes('Code quality degradation'))).toBe(false);
    // Sized (the user's occurrence): it is in the Run.
    const sized = withRisk({ event_risk: { version: 1, occurrence: { p_low: 0.2, p_high: 0.4, meaning: 'at_least_once_within_horizon', basis: 'user' },
      horizon: { months: 3 } } });
    expect(unsizedRiskIds(sized).size).toBe(0);
    expect((withoutUnsizedRisks(sized) as Rec).nodes).toHaveLength(BODY.graph.nodes.length);
    // A cause drawn into it: it is computed from its cause, never left out.
    const caused = structuredClone(BODY.graph);
    caused.edges.push({ from: 'additional_developers_hired', to: RISK, strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });
    expect(unsizedRiskIds(caused).size).toBe(0);
    // An option sets it: the Run needs it, so it keeps asking.
    const set = structuredClone(BODY.graph);
    nodeOf(set, 'hire_a_tech_lead').interventions = { ...nodeOf(set, 'hire_a_tech_lead').interventions, [RISK]: 0.1 };
    expect(unsizedRiskIds(set).size).toBe(0);
  });
});
