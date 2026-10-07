import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectLimitLevelOwners, readRatifiedConstraints } from '../../src/orchestrator/context/constraint-feasibility.js';
import { placeholderPartsFinding, limitUnitsOf } from '../../src/orchestrator/context/placeholder-parts.js';
import { exactIdentityOperandLinks } from '../../src/orchestrator-v5/admission/identity-evaluations.js';
import { goalCertaintyDecisions } from '../../src/orchestrator-v5/agent-lane/goal-certainty.js';
import { limitChecksForAgent } from '../../src/orchestrator-v5/agent-lane/limit-checks.js';
import { targetTestabilityOf } from '../../src/orchestrator-v5/admission/target-testability.js';
import { captured, checks, savedFacts, edge, riskId, runCarrier, type Rec } from './r2-cases.js';

export const fixture = (name: string): Rec => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
export const readOf = (x: Rec): Rec => x.j ?? x.body ?? x;
export const optionsOf = (g: Rec): Rec[] => g.nodes.filter((n: Rec) => n.kind === 'option');
export function j3WithLimits(): Rec {
  const s = readOf(fixture('j3-user-confirmed.json'));
  const shape = captured().graph.goal_constraints[0];
  s.graph.goal_constraints = [
    { ...shape, constraint_id: 'j3-mrr', node_id: 'monthly_recurring_revenue', value: 126000 },
    { ...shape, constraint_id: 'j3-customers', node_id: 'existing_customers', value: 350, unit: 'customers' },
  ];
  s.analysis_limit_verdicts = { per_limit: s.graph.goal_constraints.map((c: Rec) => ({ constraint_id: c.constraint_id, state: 'scored' })), joint: { state: 'scored' } };
  return s;
}
export function verifyJ3(): void {
  const s = j3WithLimits(); const g = s.graph;
  const link = g.edges.find((e: Rec) => e.from === 'price_rise_from_current' && e.to === 'customers_lost_from_price_rise');
  assert.equal(link.provenance.source, 'user_specified');
  assert.equal(link.provenance.reading, 'agent_proposed_user_confirmed');
  assert.deepEqual([link.provenance.natural_effect.amount, link.provenance.natural_effect.amount_unit,
    link.provenance.natural_effect.per_source_change, link.provenance.natural_effect.per_source_change_unit, link.strength.mean],
  [3, 'customers', 1, '%', 0.6]);
  const limitChecks = limitChecksForAgent(g, s.analysis_limit_verdicts)!;
  assert.equal(limitChecks.length, 2);
  for (const c of limitChecks) {
    assert.equal(c.state, 'scored'); assert.equal(c.withheld_for, undefined, 'J3 user-confirmed strength must remain SIZED');
    assert.equal(c.say.includes('couldn’t be checked'), false); assert.equal(c.say.includes('Olumi hasn’t sized'), false);
  }
  const fold = collectLimitLevelOwners(g, readRatifiedConstraints(g), optionsOf(g));
  assert.equal(fold.placeholderMovedOptionIds.size, 0, 'J3 customer limit stays scored in the Run-time fold');
}
export function declaredCapture(): Rec {
  const s = captured();
  s.graph.nodes.find((n: Rec) => n.id === 'starter_tier_mrr').nonlinear_identity.stated_in_brief = true;
  return s;
}
export async function verifyIdentity(): Promise<void> {
  const s = declaredCapture(); const g = s.graph;
  assert.equal(checks(s)[0].withheld_for, undefined);
  assert.deepEqual(checks(s, false)[0].withheld_for, ['Launch Starter Tier'], 'declaration alone cannot license limit operands');
  assert.deepEqual(savedFacts(s, false).limit_checks.limits[0].withheld_for, ['Launch Starter Tier']);
  assert.equal((await runCarrier(s)).limit_checks.limits[0].withheld_for, undefined);
  assert.deepEqual((await runCarrier(s, false)).limit_checks.limits[0].withheld_for, ['Launch Starter Tier']);
  const reviewGraph = JSON.parse(readFileSync(new URL('../../src/orchestrator-v5/admission/__tests__/fixtures/t1b-126k-c7878208-graph.json', import.meta.url), 'utf8'));
  const option = optionsOf(reviewGraph).filter(o => o.id === 'launch_starter_tier');
  const find = (ev?: readonly unknown[]) => placeholderPartsFinding('service_quality_deterioration', reviewGraph.nodes, reviewGraph.edges, option, limitUnitsOf(reviewGraph.goal_constraints), ev);
  const reviewEvaluations = [{ node_id: 'starter_support_cost', evaluated: true }];
  assert.equal(find(reviewEvaluations), null);
  assert.equal(find()?.reason, 'parts_links_placeholder');
  const shape = g.goal_constraints[0];
  reviewGraph.goal_constraints = [...(reviewGraph.goal_constraints ?? [])];
  reviewGraph.goal_constraints.push({ ...shape, constraint_id: 'quality', node_id: 'service_quality_deterioration', value: 1, unit: '%' });
  const fold = (ev?: readonly unknown[]) => collectLimitLevelOwners(reviewGraph, readRatifiedConstraints(reviewGraph), optionsOf(reviewGraph), ev).placeholderMovedOptionIds.get('quality');
  assert.equal(fold(reviewEvaluations)?.has('launch_starter_tier') ?? false, false);
  assert.equal(fold()?.has('launch_starter_tier'), true, 'Run fold must fail closed without evaluation');
  // Existing caller still grants stated identities; malformed evaluations cannot grant an inferred identity.
  assert.ok(exactIdentityOperandLinks(g.nodes, g.edges).size > 0);
  assert.equal(exactIdentityOperandLinks(g.nodes, g.edges, [], 'evaluated_only').size, 0);
}
export function verifyCertaintyEdges(): void {
  const s = readOf(fixture('certainty-two-children.json')); const g = s.graph;
  const result = goalCertaintyDecisions(g, [{ option_id: 'launch_49_starter_tier', probability_of_goal: 0 }],
    (s.analysis_identity_evaluated_node_ids ?? []).map((node_id: string) => ({ node_id, evaluated: true })));
  assert.equal(result.length, 1);
  assert.equal(result[0].earned, true, 'certainty path needs all edges at sizedLinkTest; user-chain alone does not size this mediator');
}
export function targetFixtureBytes(): string {
  const raw = JSON.parse(readFileSync(new URL('../../src/orchestrator-v5/admission/__tests__/fixtures/target-testability-20260930.json', import.meta.url), 'utf8'));
  const results = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== '_source').map(([k, graph]) => {
    const g = graph as Rec;
    const ev = g.nodes.filter((n: Rec) => n.nonlinear_identity).map((n: Rec) => ({ node_id: n.id, evaluated: true }));
    return [k, [targetTestabilityOf(g), targetTestabilityOf(g, ev)]];
  }));
  return JSON.stringify(results);
}
export function verifyTargetBytes(): void {
  assert.equal(targetFixtureBytes(), readFileSync(new URL('./fixtures/target-testability-before-r3.json', import.meta.url), 'utf8').trim(), 'existing target-testability fixture results stay byte-identical');
}
export function verifyNamedGraphs(): void {
  for (const name of ['read-after-run1-1791348363696.json', 'read-end-1791348570452.json', 'd1w-1-read.json']) {
    const s = readOf(fixture(name));
    const before = JSON.stringify(s);
    const out = limitChecksForAgent(s.graph, s.analysis_limit_verdicts, new Set<string>(s.analysis_identity_evaluated_node_ids))!;
    assert.ok(out.length > 0, name);
    for (const c of out) assert.equal(c.withheld_for, undefined, `${name}: all options checked`);
    assert.equal(JSON.stringify(s), before, `${name}: read-time only`);
  }
}

export function verifyUserStampExclusions(): void {
  for (const stamp of [{ source: 'user_specified', magnitude: 'olumi_estimate' },
    { source: 'user_specified', magnitude: 'user_stated', mean_projected: true }]) {
    const s = captured(); Object.assign(edge(s, 'existing_price_rise', riskId).provenance, stamp);
    assert.equal(checks(s)[0].withheld_for?.includes('Raise Prices 10%'), true, 'user stamp cannot exempt an estimate/projected mean');
  }
}
