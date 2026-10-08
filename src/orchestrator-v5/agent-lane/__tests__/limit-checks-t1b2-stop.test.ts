import { describe, it, expect } from 'vitest';
import { sameUnit } from '../same-unit.js';
import { sizedLinkTest, limitUnitsOf, userStatedLinkUnitsOf } from '../../../orchestrator/context/placeholder-parts.js';
import { goalChanceLicenceOf } from '../../goal-target/goal-chance-licence.js';
import { unsizedLeaderGoalPaths, goalCertaintyDecisions } from '../goal-certainty.js';
import { mediatorReadings, userSizedLevelLessLinks } from '../mediator-reading.js';
import { evaluatedIdentityCarriers, exactIdentityOperandLinks } from '../../admission/identity-evaluations.js';
import { captured, checks, savedFacts, runCarrier, evaluations, edge, goalId, riskId, checkedSentence, differentCostCap, type Rec } from '../../../../tools/limit-check-replay/r2-cases.js';

const units = (s: Rec) => userStatedLinkUnitsOf(s.graph.nodes, s.graph.edges);
const goalPaths = (s: Rec) => unsizedLeaderGoalPaths(s.graph, s.graph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id), evaluations(s));

describe('L1 r2: user-stated touching units and this Run’s evaluated product', () => {
  it('accumulation attestation is bound to stock_at_12 and its month, with a matching-month control', () => {
    const carrier = { id: 'stock_at_12', kind: 'outcome', nonlinear_identity: { operation: 'accumulation',
      factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'], horizon_months: 12, rate_scale: 0.01,
      stated_in_brief: false } };
    const row = { node_id: carrier.id, evaluated: true, operation: 'accumulation',
      factor_ids: [...carrier.nonlinear_identity.factor_ids], horizon_months: 12 };
    expect([...evaluatedIdentityCarriers([carrier], [row])]).toEqual(['stock_at_12']);
    expect([...evaluatedIdentityCarriers([carrier], [{ ...row, horizon_months: 18 }])]).toEqual([]);
    const { horizon_months: _month, ...missingMonth } = row;
    expect([...evaluatedIdentityCarriers([carrier], [missingMonth])]).toEqual([]);
    expect([...evaluatedIdentityCarriers([carrier], [{ ...row, node_id: 'another_stock_at_12' }])]).toEqual([]);
  });

  it('accumulation input order is stock/churn/inflow; a commutative product remains the control', () => {
    const accumulation = { id: 'stock_at_12', nonlinear_identity: { operation: 'accumulation',
      factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'], horizon_months: 12 } };
    const matching = { node_id: 'stock_at_12', evaluated: true, operation: 'accumulation',
      factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'], horizon_months: 12 };
    const reordered = { ...matching, factor_ids: ['monthly_churn', 'stock_today', 'monthly_inflow'] };
    expect([...evaluatedIdentityCarriers([accumulation], [matching])]).toEqual(['stock_at_12']);
    expect([...evaluatedIdentityCarriers([accumulation], [reordered])]).toEqual([]);
    const product = { id: 'mrr', nonlinear_identity: { operation: 'product', factor_ids: ['price', 'subscribers'] } };
    expect([...evaluatedIdentityCarriers([product], [{ node_id: 'mrr', evaluated: true, operation: 'product',
      factor_ids: ['subscribers', 'price'] }])]).toEqual(['mrr']);
  });

  it('the captured limit IS the goal: same node, comparator, raw figure and unit', () => {
    const s = captured();
    const goal = s.graph.nodes.find((n: Rec) => n.id === goalId);
    const c = s.graph.goal_constraints[0];
    expect([c.node_id, c.operator, c.value, c.unit]).toEqual([goal.id, goal.goal_direction, goal.goal_threshold_raw, goal.goal_threshold_unit]);
  });

  it('both captured options are checked; the chat carrier has no contradictory unsized sentence', () => {
    const s = captured();
    expect(checks(s)[0]).toEqual({ constraint_id: s.graph.goal_constraints[0].constraint_id,
      limit: 'monthly recurring revenue', state: 'scored', say: checkedSentence });
    expect(savedFacts(s).limit_checks.limits).toEqual(checks(s));
    expect(JSON.stringify(savedFacts(s).limit_checks)).not.toContain('couldn’t be checked');
    expect(JSON.stringify(savedFacts(s).limit_checks)).not.toContain('Olumi hasn’t sized');
  });

  it('the direct link and absent-risk-unit link are sized by the one read-time reader, with no stored write', () => {
    const s = captured();
    const bytes = JSON.stringify(s);
    const sized = sizedLinkTest(s.graph.nodes, limitUnitsOf(s.graph.goal_constraints), s.graph.edges);
    expect(units(s).get(riskId)).toBe('customers');
    expect(sized(edge(s, 'existing_price_rise', goalId))).toBe(true);
    expect(sized(edge(s, 'existing_price_rise', riskId))).toBe(true);
    expect(userSizedLevelLessLinks(s.graph).has(`existing_price_rise→${riskId}`)).toBe(true);
    expect(mediatorReadings(s.graph).get(riskId)).toEqual({ via: 'user_sized_links', unit: 'customers', child: goalId });
    expect(goalPaths(s)).toEqual([]);
    // Synthetic certainty checks the path gate; the captured fractional probabilities are never changed.
    expect(goalCertaintyDecisions(s.graph, [{ option_id: 'raise_prices_10', probability_of_goal: 1 }], evaluations(s))[0].earned).toBe(true);
    expect(JSON.stringify(s)).toBe(bytes);
  });

  it('explicit agreeing-unit control stays checked', () => {
    const s = captured();
    s.graph.nodes.find((n: Rec) => n.id === riskId).unit_reading = { unit: 'customers', source: 'user_stated' };
    expect(units(s).has(riskId)).toBe(false);
    expect(checks(s)[0].say).toBe(checkedSentence);
  });

  it('out-link source unit orders disagrees: no authority and the option remains unchecked', () => {
    const s = captured();
    edge(s, riskId, goalId).provenance.natural_effect.per_source_change_unit = 'orders';
    expect(units(s).has(riskId)).toBe(false);
    expect(checks(s)[0].withheld_for).toEqual(['Raise Prices 10%']);
    expect(goalCertaintyDecisions(s.graph, [{ option_id: 'raise_prices_10', probability_of_goal: 1 }], evaluations(s))[0].earned).toBe(false);
  });

  it.each([
    { magnitude: 'olumi_estimate', source: 'cee_hypothesis' },
    { magnitude: 'olumi_estimate', source: 'user_specified' },
    { magnitude: 'user_stated', source: 'cee_hypothesis' },
    { magnitude: 'user_stated', source: 'brief_extraction', mean_projected: true },
  ])('Olumi/projected in-link never establishes authority, even with a user stamp: %j', (stamp) => {
    const s = captured();
    Object.assign(edge(s, 'existing_price_rise', riskId).provenance, stamp);
    expect(units(s).has(riskId)).toBe(false);
    expect(checks(s)[0].withheld_for).toContain('Raise Prices 10%');
  });

  it.each(['unit', 'observed_state', 'unit_reading', 'data'])('explicit conflicting node unit on %s stays unchanged', (carrier) => {
    const s = captured();
    const n = s.graph.nodes.find((n: Rec) => n.id === riskId);
    n[carrier] = carrier === 'unit' ? 'orders' : { unit: 'orders', source: 'user_stated' };
    const before = JSON.stringify(n);
    expect(units(s).has(riskId)).toBe(false);
    expect(checks(s)[0].withheld_for).toEqual(['Raise Prices 10%']);
    expect(JSON.stringify(n)).toBe(before);
  });

  it('genuinely unsized control: removing a natural effect preserves the sentence', () => {
    const s = captured();
    delete edge(s, 'existing_price_rise', goalId).provenance.natural_effect;
    expect(checks(s)[0].say).toContain('Olumi hasn’t sized');
    expect(checks(s)[0].withheld_for).toContain('Raise Prices 10%');
  });

  it('different-unit control: a £ cost cap fed by a customer-sized link remains unsized', () => {
    const s = captured();
    differentCostCap(s);
    expect(checks(s).find(c => c.constraint_id === 'cost-cap')?.say).toContain('Olumi hasn’t sized');
  });

  it('every touching user link participates, including an extra in-link or out-link off the goal path', () => {
    for (const incoming of [true, false]) {
      const s = captured();
      const e = structuredClone(incoming ? edge(s, 'existing_price_rise', riskId) : edge(s, riskId, goalId));
      if (incoming) { e.from = 'starter_tier_subscribers'; e.provenance.natural_effect.amount_unit = 'orders'; }
      else { e.to = 'starter_tier_availability'; e.provenance.natural_effect.per_source_change_unit = 'orders'; }
      s.graph.edges.push(e);
      expect(units(s).has(riskId)).toBe(false);
      expect(checks(s)[0].withheld_for).toContain('Raise Prices 10%');
    }
  });

  it('a touching user-stated shared-cause link cannot hide a conflicting unit', () => {
    const s = captured();
    const e = structuredClone(edge(s, 'existing_price_rise', riskId));
    e.from = 'starter_tier_subscribers';
    e.edge_type = 'bidirected';
    e.provenance.natural_effect.amount_unit = 'orders';
    s.graph.edges.push(e);
    expect(units(s).has(riskId)).toBe(false);
    expect(userSizedLevelLessLinks(s.graph).has(`existing_price_rise→${riskId}`)).toBe(false);
    expect(mediatorReadings(s.graph).get(riskId)?.via).not.toBe('user_sized_links');
  });

  it('at least one link on EACH side is required; singular/plural uses the writer’s grammar', () => {
    for (const incoming of [true, false]) {
      const s = captured();
      s.graph.edges = s.graph.edges.filter((e: Rec) => incoming ? e.to !== riskId : e.from !== riskId);
      expect(units(s).has(riskId)).toBe(false);
    }
    const s = captured();
    edge(s, riskId, goalId).provenance.natural_effect.per_source_change_unit = 'customer';
    expect(units(s).get(riskId)).toBe('customers');
    expect(checks(s)[0].say).toBe(checkedSentence);
  });

  it('a stale user figure cannot establish the missing unit', () => {
    const s = captured();
    edge(s, 'existing_price_rise', riskId).strength.mean = 0.5;
    expect(units(s).has(riskId)).toBe(false);
    expect(checks(s)[0].withheld_for).toContain('Raise Prices 10%');
  });

  it('goal-chance licence bytes stay 47/34/0 (<1 on screen), and the whole captured result stays byte-identical', () => {
    const s = captured();
    const before = JSON.stringify(s.analysis_result);
    const licence = () => JSON.stringify(goalChanceLicenceOf(s.analysis_result.enrichment, s.graph, goalId, () => true));
    const beforeLicence = licence();
    checks(s); savedFacts(s); goalPaths(s); mediatorReadings(s.graph);
    expect(licence()).toBe(beforeLicence);
    expect(JSON.parse(licence()!).pct_by_option).toEqual({ raise_prices_10: 47, launch_starter_tier: 34, keep_pricing_as_it_is: 0 });
    expect(JSON.stringify(s.analysis_result)).toBe(before);
  });

  it('every captured spelling keeps its meaning; missing unit is not a spelling alias', () => {
    for (const u of ['£/month', 'GBP', '%', '£/subscriber/month', 'subscribers', 'customers', 'switch', 'binary']) expect(sameUnit(u, u)).toBe(true);
    expect(sameUnit('£/month', 'GBP')).toBe(false);
    expect(sameUnit('customers', '')).toBe(false);
  });

  it('the actual runAnalysis chat carrier passes the same Run evaluation, with a missing-carrier contrast', async () => {
    const s = captured();
    expect((await runCarrier(s)).limit_checks.limits).toEqual(checks(s));
    expect((await runCarrier(s, false)).limit_checks.limits[0].withheld_for).toEqual(['Launch Starter Tier']);
  });

  it('Starter exact operands require this Run’s identity carrier through BOTH sentence paths', () => {
    const s = captured();
    expect(checks(s)[0].say).toBe(checkedSentence);
    expect(checks(s, false)[0].withheld_for).toEqual(['Launch Starter Tier']);
    expect(savedFacts(s).limit_checks.limits[0].say).toBe(checkedSentence);
    expect(savedFacts(s, false).limit_checks.limits[0].withheld_for).toEqual(['Launch Starter Tier']);
    const ids = s.graph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id);
    expect(unsizedLeaderGoalPaths(s.graph, ids, evaluations(s))).toEqual([]);
    expect(unsizedLeaderGoalPaths(s.graph, ids, [])).toEqual([{ option_id: 'launch_starter_tier', links: [{ from: 'starter_tier_monthly_price', to: 'starter_tier_mrr' }] }]);
    expect(exactIdentityOperandLinks(s.graph.nodes, s.graph.edges, [{ node_id: 'starter_tier_mrr', evaluated: true, operation: 'sum' }]).size).toBe(0);
    expect(exactIdentityOperandLinks(s.graph.nodes, s.graph.edges, [{ node_id: 'starter_tier_mrr', evaluated: true, factor_ids: ['starter_tier_monthly_price', 'starter_tier_monthly_price'] }]).size).toBe(0);
  });
});
