/**
 * ⭐ DR ROW 1 — THE APPROVED TARGET CARD'S COMPARATOR IS THE GOAL'S DIRECTION: ONE STATEMENT, ONE CARRIER
 * (DECISION-REPRESENTATION-v1 row 1; DL 5918381864; AIQ 5918365996; R3 5918409192 C1–C4).
 *
 * Measured at staging `d3d28031` (MG SUCCESSOR 5918338227): Paul's "at least £1.2m" through the card wrote ONLY
 * `goal_constraints[{operator: '>='}]`. The goal node held no `goal_direction`, so `readHeldGoalComparator` read null
 * and the headline told him the analysis "was not told which way your goal points" after he had said so.
 *
 * Rows drive the REAL card door (`applyGoalTargetEdit` → the REAL `add_constraint` handler). Rung: TESTED (in-process).
 */
import { describe, expect, it } from 'vitest';
import { applyConstraintEditThroughAddConstraint, applyGoalTargetEdit } from '../goal-target-edit.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { heldGoalPointsUp, readHeldGoalComparator, resolveGoalDirection, resolveGoalThresholdStrict } from '../../goal-target/goal-direction.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';

type Json = Record<string, any>;
const SCENARIO = '550e8400-e29b-41d4-a716-446655440391';
const GOAL = 'g-revenue';

/** The D1 fixture with its goal as a £ level (Paul's shape: no direction held), parsed as the turn path hands it on. */
const graphWith = (goal: Json = {}): GraphV3T => {
  const g = buildD1Fixture() as unknown as { nodes: Json[] };
  g.nodes = g.nodes.map((n) => (n.id === GOAL ? { ...n, label: 'Securing funding', ...goal } : n));
  const parsed = GraphV3.safeParse(g);
  if (!parsed.success) throw new Error(`fixture must parse: ${JSON.stringify(parsed.error.issues[0])}`);
  return parsed.data;
};
const goalOf = (g: unknown): Json => (g as { nodes: Json[] }).nodes.find((n) => n.id === GOAL)!;

/** The approved card, through the REAL door. */
const card = async (graph: GraphV3T, constraint_type: 'at_least' | 'at_most', raw_value: number, unit = '£') => {
  const event = { kind: 'goal_target_edit', goal_node_id: GOAL, constraint_type, raw_value, unit,
    base_graph_hash: computeAnalysisAffectingGraphHash(graph as never) };
  const r = await applyGoalTargetEdit({
    payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: 'turn-dr1', stage: 'frame', event } as never,
    event: event as never, requestId: 'req-dr1', persistedGraph: graph, priorFacts: [],
  }) as { kind: string; reason?: string; mutatedGraph?: Json };
  expect(r.kind, JSON.stringify(r).slice(0, 400)).toBe('mutated');
  return r.mutatedGraph!;
};

/** The same handler through the shared edit function WITHOUT the card (the limit door's shape). */
const notTheCard = async (graph: GraphV3T, targetId: string, constraintType: 'at_least' | 'at_most', rawValue: number, unit: string) => {
  const r = await applyConstraintEditThroughAddConstraint({
    payload: { scenario_id: SCENARIO, turn_id: 'turn-dr1-limit', stage: 'frame' } as never,
    requestId: 'req-dr1-limit', persistedGraph: graph, graph, priorFacts: [], targetId, constraintType, rawValue, unit,
    eventName: 'limit_edit', logBase: {},
  }) as { kind: string; mutatedGraph?: Json };
  expect(r.kind, JSON.stringify(r).slice(0, 400)).toBe('mutated');
  return r.mutatedGraph!;
};

describe('DR row 1: the approved card holds the goal\'s direction on the goal node', () => {
  it('PRECONDITION: Paul\'s shape holds no direction, and the readers say so', () => {
    const g = graphWith();
    expect(goalOf(g).goal_direction).toBeUndefined();
    expect(readHeldGoalComparator(g, GOAL)).toBeNull();
    expect(heldGoalPointsUp(g, GOAL)).toBe(false);
  });

  it('RED: "at least £1.2m" approved → the goal node holds `>=` beside the row; the headline reader sees it', async () => {
    const out = await card(graphWith(), 'at_least', 1_200_000);
    expect(out.goal_constraints).toEqual([expect.objectContaining({ node_id: GOAL, operator: '>=', value: 1_200_000 })]);
    expect(goalOf(out)).toMatchObject({ goal_direction: '>=', goal_threshold_raw: 1_200_000 });
    expect(readHeldGoalComparator(out, GOAL)).toBe('>=');
    expect(heldGoalPointsUp(out, GOAL)).toBe(true);
  });

  it('R3 C1 (one event, one number): a goal holding £1.5m + "at least £1.2m" → stored £1.2m and `>=`, never both', async () => {
    const out = await card(graphWith({ goal_threshold_raw: 1_500_000, goal_threshold_unit: '£', goal_threshold_cap: 1_875_000, goal_threshold: 0.8, goal_threshold_frame: 'level' }), 'at_least', 1_200_000);
    const goal = goalOf(out);
    expect(goal).toMatchObject({ goal_direction: '>=', goal_threshold_raw: 1_200_000, success_threshold: 1_200_000, threshold_source: 'user' });
    // raw, model and cap agree: the model threshold is the raw target on the cap the same write stamped.
    expect(goal.goal_threshold).toBeCloseTo(goal.goal_threshold_raw / goal.goal_threshold_cap, 12);
    expect(out.goal_constraints.filter((c: Json) => c.node_id === GOAL).map((c: Json) => c.value)).toEqual([1_200_000]);
  });

  /** The goal as a first approval left it, minus the direction (a graph written before this change). */
  const restated = async (goal_direction?: string): Promise<GraphV3T> => {
    const first = await card(graphWith(), 'at_least', 1_200_000);
    const nodes = first.nodes.map((n: Json) => (n.id === GOAL ? { ...n, goal_direction } : n));
    const parsed = GraphV3.safeParse({ ...first, nodes });
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues[0]));
    return parsed.data;
  };

  it('CODEX 5918509191 (same target, no direction held): re-approving "at least £1.2m" commits `>=` and moves the hash — no false no-op', async () => {
    const before = await restated(undefined);
    expect(goalOf(before).goal_direction, 'PRECONDITION: target held, direction not').toBeUndefined();
    const out = await card(before, 'at_least', 1_200_000);
    expect(goalOf(out).goal_direction).toBe('>=');
    expect(computeAnalysisAffectingGraphHash(out as never)).not.toBe(computeAnalysisAffectingGraphHash(before as never));
  });

  it('CODEX (same target, the OPPOSITE direction held): re-approving "at least" replaces `<=` with `>=` and moves the hash', async () => {
    const before = await restated('<=');
    const out = await card(before, 'at_least', 1_200_000);
    expect(goalOf(out).goal_direction).toBe('>=');
    expect(computeAnalysisAffectingGraphHash(out as never)).not.toBe(computeAnalysisAffectingGraphHash(before as never));
  });

  it('CONTROL (a true no-op): the same target AND the same direction already held → the hash does not move', async () => {
    const before = await restated('>=');
    const out = await card(before, 'at_least', 1_200_000);
    expect(goalOf(out).goal_direction).toBe('>=');
    expect(computeAnalysisAffectingGraphHash(out as never)).toBe(computeAnalysisAffectingGraphHash(before as never));
  });

  it('R3 C2 (the typed stated comparator, never inferred from the enum): a relayed `>` holds `>` and the run is scored strictly', async () => {
    const graph = graphWith();
    const r = await applyConstraintEditThroughAddConstraint({
      payload: { scenario_id: SCENARIO, turn_id: 'turn-dr1-strict', stage: 'frame' } as never,
      requestId: 'req-dr1-strict', persistedGraph: graph, graph, priorFacts: [], targetId: GOAL, constraintType: 'at_least',
      rawValue: 1_200_000, unit: '£', statedConstraintOperator: '>', holdsGoalDirection: true, eventName: 'goal_target_edit', logBase: {},
    }) as { kind: string; mutatedGraph?: Json };
    expect(r.kind).toBe('mutated');
    expect(goalOf(r.mutatedGraph).goal_direction).toBe('>');
    expect(resolveGoalThresholdStrict(r.mutatedGraph, GOAL)).toBe(true);
    // The card's own enum (`at_least`) with nothing relayed stays non-strict.
    const plain = await card(graphWith(), 'at_least', 1_200_000);
    expect(resolveGoalThresholdStrict(plain, GOAL)).toBe(false);
  });

  it('R3 C3 (replace, never merge): a held `<=` + the approved "at least" → stored `>=`, and the analysis hash moves', async () => {
    const before = graphWith({ goal_direction: '<=' });
    const out = await card(before, 'at_least', 1_200_000);
    expect(goalOf(out).goal_direction).toBe('>=');
    expect(computeAnalysisAffectingGraphHash(out as never)).not.toBe(computeAnalysisAffectingGraphHash(before as never));
  });

  it('R3 (what PLoT gets): a held floor sends nothing new — the direction sent is the same with and without it', async () => {
    const out = await card(graphWith(), 'at_least', 1_200_000);
    const without = { ...out, nodes: out.nodes.map((n: Json) => (n.id === GOAL ? { ...n, goal_direction: undefined } : n)) };
    expect(resolveGoalDirection(out, GOAL)).toEqual(resolveGoalDirection(without, GOAL));
  });

  it('R3 C4 (goal only): a limit on another node, through the same handler, leaves the goal\'s direction AND target untouched', async () => {
    const before = graphWith({ goal_threshold_raw: 1_500_000, goal_threshold_unit: '£', goal_threshold_cap: 1_875_000, goal_threshold: 0.8, goal_threshold_frame: 'level' });
    const out = await notTheCard(before, 'f-budget', 'at_most', 50_000, '£');
    expect(out.goal_constraints).toEqual([expect.objectContaining({ node_id: 'f-budget', operator: '<=' })]);
    const [was, now] = [goalOf(before), goalOf(out)];
    expect(now.goal_direction).toBeUndefined();
    expect([now.goal_threshold_raw, now.goal_threshold, now.goal_threshold_cap]).toEqual([was.goal_threshold_raw, was.goal_threshold, was.goal_threshold_cap]);
  });

  it('CONTROL (bound to the approved card): the same goal floor written NOT through the card holds no direction', async () => {
    const out = await notTheCard(graphWith(), GOAL, 'at_least', 1_200_000, '£');
    expect(out.goal_constraints).toEqual([expect.objectContaining({ node_id: GOAL, operator: '>=' })]);
    expect(goalOf(out).goal_direction).toBeUndefined();
  });

  it('R3 C4 (never unlocks figures): DR row 4\'s verdict on the written graph is the same with and without the direction', async () => {
    const out = await card(graphWith(), 'at_least', 1_200_000);
    const without = { ...out, nodes: out.nodes.map((n: Json) => (n.id === GOAL ? { ...n, goal_direction: undefined } : n)) };
    const verdict = targetTestabilityOf(out);
    expect(verdict.kind).toBe('not_testable');
    expect(verdict).toEqual(targetTestabilityOf(without));
  });
});
