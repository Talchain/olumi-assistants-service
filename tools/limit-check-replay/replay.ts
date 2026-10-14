import assert from 'node:assert/strict';
import { naturalAmountUnitsOf } from '../../src/cee/magnitude/frame-defaulted-links.js';
import { limitUnitsOf, sizedLinkTest } from '../../src/orchestrator/context/placeholder-parts.js';
import { sameUnit } from '../../src/orchestrator-v5/agent-lane/same-unit.js';
import { goalChanceLicenceOf } from '../../src/orchestrator-v5/goal-target/goal-chance-licence.js';
import { targetTestabilityOf, reachedGoalPaths } from '../../src/orchestrator-v5/admission/target-testability.js';
import { userSizedLevelLessLinks } from '../../src/orchestrator-v5/agent-lane/mediator-reading.js';
import { unsizedLeaderGoalPaths, goalCertaintyDecisions } from '../../src/orchestrator-v5/agent-lane/goal-certainty.js';

import { captured, checks, savedFacts, runCarrier, edge as link, goalId, riskId, checkedSentence, differentCostCap, type Rec } from './r2-cases.js';
import { userStatedLinkUnitsOf } from '../../src/orchestrator/context/placeholder-parts.js';
import { mediatorReadings } from '../../src/orchestrator-v5/agent-lane/mediator-reading.js';
import { exactIdentityOperandLinks } from '../../src/orchestrator-v5/admission/identity-evaluations.js';
const s = captured();
const originalBytes = JSON.stringify(s);
const g = s.graph;
const options = g.nodes.filter((n: Rec) => n.kind === 'option');
const ids = options.map((o: Rec) => o.id);
// The readback's persisted evaluated-node IDs attest THIS Run (no invented evaluations).
const evaluations = s.analysis_identity_evaluated_node_ids.map((node_id: string) => ({ node_id, evaluated: true }));
const sized = sizedLinkTest(g.nodes, limitUnitsOf(g.goal_constraints), g.edges);
const units = naturalAmountUnitsOf(g.nodes);
const chain = userSizedLevelLessLinks(g);
const paths = reachedGoalPaths(g, ids, new Map(options.map((o: Rec) => [o.id, Object.keys(o.interventions ?? {})])), evaluations);
const earned = (id: string, p: 0 | 1) => s.analysis_goal_certainty.some((x: Rec) => x.option_id === id && x.probability_of_goal === p && x.earned === true);
// Independent captured-fact pins: these are replay checks, not permission to change scientific semantics.
const goal = g.nodes.find((n: Rec) => n.kind === 'goal');
const limit = g.goal_constraints[0];
assert.deepEqual([limit.node_id, limit.operator, limit.value, limit.unit], [goal.id, goal.goal_direction, goal.goal_threshold_raw, goal.goal_threshold_unit]);
const edge = (from: string, to: string) => g.edges.find((e: Rec) => e.from === from && e.to === to);
assert.equal(sized(edge('existing_price_rise', goal.id)), true);
assert.equal(sized(edge('existing_price_rise', 'customers_lost_from_price_rise')), true);
assert.equal(units.get('customers_lost_from_price_rise'), '');
assert.equal(chain.size, 2);
assert.deepEqual(s.analysis_identity_evaluated_node_ids, ['starter_tier_mrr']);
assert.equal(paths.exactLinks.has(edge('starter_tier_monthly_price', 'starter_tier_mrr')), true);
assert.deepEqual(unsizedLeaderGoalPaths(g, ids, evaluations), []);
assert.equal(targetTestabilityOf(g, evaluations).kind, 'testable');
const licence = goalChanceLicenceOf(s.analysis_result.enrichment, g, goal.id, earned);
assert.deepEqual(licence?.pct_by_option, { raise_prices_10: 47, launch_starter_tier: 34, keep_pricing_as_it_is: 0 });
assert.equal(checks(s)[0].say, checkedSentence);
assert.equal(checks(s)[0].withheld_for, undefined);
assert.deepEqual(savedFacts(s).limit_checks.limits, checks(s));
assert.equal(JSON.stringify(savedFacts(s).limit_checks).includes('Olumi hasn’t sized'), false);
const sizedControl = structuredClone(s);
sizedControl.graph.nodes.find((n: Rec) => n.id === 'customers_lost_from_price_rise').unit_reading = { unit: 'customers', source: 'user_stated' };
sizedControl.graph.nodes = sizedControl.graph.nodes.filter((n: Rec) => n.id !== 'launch_starter_tier');
assert.equal(checks(sizedControl)?.[0]?.withheld_for, undefined);
assert.equal(checks(sizedControl)?.[0]?.say, '‘monthly recurring revenue’ was checked against the figures in your model.');
const unsizedControl = structuredClone(s);
delete unsizedControl.graph.edges.find((e: Rec) => e.from === 'existing_price_rise' && e.to === goal.id).provenance.natural_effect;
assert.equal(checks(unsizedControl)?.[0]?.say.includes('Olumi hasn’t sized'), true);
const costControl = structuredClone(s);
differentCostCap(costControl);
assert.equal(checks(costControl).find(c => c.constraint_id === 'cost-cap')?.say.includes('Olumi hasn’t sized'), true);
for (const u of ['£/month', 'GBP', '%', '£/subscriber/month', 'subscribers', 'customers', 'switch', 'binary']) assert.equal(sameUnit(u, u), true);
assert.equal(sameUnit('£/month', 'GBP'), false);
assert.equal(sameUnit('customers', ''), false);
assert.deepEqual(unsizedLeaderGoalPaths(g, ids, []), [{ option_id: 'launch_starter_tier', links: [{ from: 'starter_tier_monthly_price', to: 'starter_tier_mrr' }] }]);
// L1 r2 controls execute without Vitest or an LLM/engine call; the test file pins the same rows with expect.
const readUnits = (state: Rec) => userStatedLinkUnitsOf(state.graph.nodes, state.graph.edges);
assert.equal(readUnits(s).get(riskId), 'customers');
assert.equal(goalCertaintyDecisions(g, [{ option_id: 'raise_prices_10', probability_of_goal: 1 }], evaluations)[0].earned, true);
assert.deepEqual(mediatorReadings(g).get(riskId), { via: 'user_sized_links', unit: 'customers', child: goalId });
const disagreement = captured();
link(disagreement, riskId, goalId).provenance.natural_effect.per_source_change_unit = 'orders';
assert.equal(readUnits(disagreement).has(riskId), false, 'agreement control: orders cannot establish customers');
assert.deepEqual(checks(disagreement)[0].withheld_for, ['Raise Prices 10%']);
assert.equal(goalCertaintyDecisions(disagreement.graph, [{ option_id: 'raise_prices_10', probability_of_goal: 1 }], evaluations)[0].earned, false);
for (const stamp of [
  { magnitude: 'olumi_estimate', source: 'cee_hypothesis' },
  { magnitude: 'olumi_estimate', source: 'user_specified' },
  { magnitude: 'user_stated', source: 'cee_hypothesis' },
  { magnitude: 'user_stated', source: 'brief_extraction', mean_projected: true },
]) {
  const state = captured();
  Object.assign(link(state, 'existing_price_rise', riskId).provenance, stamp);
  assert.equal(readUnits(state).has(riskId), false, 'estimate exclusion: an Olumi/projected figure is not unit authority');
  assert.equal(checks(state)[0].withheld_for?.includes('Raise Prices 10%'), true);
}
for (const carrier of ['unit', 'observed_state', 'unit_reading', 'data']) {
  const state = captured();
  const node = state.graph.nodes.find((n: Rec) => n.id === riskId);
  node[carrier] = carrier === 'unit' ? 'orders' : { unit: 'orders', source: 'user_stated' };
  const before = JSON.stringify(node);
  assert.equal(readUnits(state).has(riskId), false);
  assert.deepEqual(checks(state)[0].withheld_for, ['Raise Prices 10%']);
  assert.equal(JSON.stringify(node), before);
}
for (const incoming of [true, false]) {
  const state = captured();
  const e = structuredClone(incoming ? link(state, 'existing_price_rise', riskId) : link(state, riskId, goalId));
  if (incoming) { e.from = 'starter_tier_subscribers'; e.provenance.natural_effect.amount_unit = 'orders'; }
  else { e.to = 'starter_tier_availability'; e.provenance.natural_effect.per_source_change_unit = 'orders'; }
  state.graph.edges.push(e);
  assert.equal(readUnits(state).has(riskId), false, 'EVERY touching user link must agree');
  assert.equal(checks(state)[0].withheld_for?.includes('Raise Prices 10%'), true);
  const singleSide = captured();
  singleSide.graph.edges = singleSide.graph.edges.filter((e: Rec) => incoming ? e.to !== riskId : e.from !== riskId);
  assert.equal(readUnits(singleSide).has(riskId), false, 'both sides must have a user figure');
}
const bidirected = captured();
const sharedCause = structuredClone(link(bidirected, 'existing_price_rise', riskId));
sharedCause.from = 'starter_tier_subscribers';
sharedCause.edge_type = 'bidirected';
sharedCause.provenance.natural_effect.amount_unit = 'orders';
bidirected.graph.edges.push(sharedCause);
assert.equal(readUnits(bidirected).has(riskId), false);
assert.equal(userSizedLevelLessLinks(bidirected.graph).has(`existing_price_rise→${riskId}`), false);
assert.notEqual(mediatorReadings(bidirected.graph).get(riskId)?.via, 'user_sized_links');
const singular = captured();
link(singular, riskId, goalId).provenance.natural_effect.per_source_change_unit = 'customer';
assert.equal(readUnits(singular).get(riskId), 'customers');
assert.equal(checks(singular)[0].say, checkedSentence);
const stale = captured();
link(stale, 'existing_price_rise', riskId).strength.mean = 0.5;
assert.equal(readUnits(stale).has(riskId), false);
assert.equal(checks(stale)[0].withheld_for?.includes('Raise Prices 10%'), true);
assert.deepEqual(checks(s, false)[0].withheld_for, ['Launch Starter Tier']);
assert.equal(savedFacts(s).limit_checks.limits[0].say, checkedSentence, 'saved carrier must pass THIS Run evaluation');
assert.deepEqual(savedFacts(s, false).limit_checks.limits[0].withheld_for, ['Launch Starter Tier']);
for (const invalid of [
  { node_id: 'starter_tier_mrr', evaluated: true, operation: 'sum' },
  { node_id: 'starter_tier_mrr', evaluated: true, factor_ids: ['starter_tier_monthly_price', 'starter_tier_monthly_price'] },
]) assert.equal(exactIdentityOperandLinks(g.nodes, g.edges, [invalid]).size, 0);
const run = await runCarrier(s);
assert.deepEqual(run.limit_checks.limits, checks(s), 'runtime carrier must pass THIS Run evaluation');
assert.equal(JSON.stringify(run.limit_checks).includes('Olumi hasn’t sized'), false);
const unboundRun = await runCarrier(s, false);
assert.deepEqual(unboundRun.limit_checks.limits[0].withheld_for, ['Launch Starter Tier']);
const chanceBytes = JSON.stringify(licence);
checks(s); savedFacts(s); mediatorReadings(g); userSizedLevelLessLinks(g);
assert.equal(JSON.stringify(s), originalBytes, 'read-time only: all captured bytes unchanged');
assert.equal(JSON.stringify(goalChanceLicenceOf(s.analysis_result.enrichment, g, goal.id, earned)), chanceBytes);
console.log(JSON.stringify({
  checks: checks(s), goal_path_withholds: unsizedLeaderGoalPaths(g, ids, evaluations),
  inferred_units: [...readUnits(s)], mediator: mediatorReadings(g).get(riskId),
  testability: targetTestabilityOf(g, evaluations), licence,
  controls: 'PASS: disagreement, all touching links, both sides, estimates/hypotheses/projected means, explicit units, unsized, cost, singular, stale, identity absent/mismatch, no writes',
}, null, 2));
