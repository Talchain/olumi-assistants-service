/**
 * ⭐ F1 T5 `set_goal` — THE GOAL'S PERIOD, HORIZON AND STATED FIGURES RIDE THE ONE TARGET WRITE (MG; spec
 * `output/mg-0ebb952a/SEMANTIC-MODEL-SPEC.md` §1 G1, §7; `@talchain/schemas` 0.69.0 `goal_target_edit`).
 *
 * Paul (1 Oct): his "£100k a quarter" was dropped "because the units differ". The 0.69.0 event carries the goal's
 * `goal_period`, `goal_horizon` and `stated_as`; the writer must put them on the GOAL node in the SAME mutation as the
 * target, convert explicitly (×3 / ×4 / ×12) or refuse, and never clear what an event does not carry.
 *
 * Rows drive the REAL card door (`applyGoalTargetEdit` → the G1 gate → the REAL `add_constraint` handler → the
 * persisted-base re-merge): `mutatedGraph` is the exact graph `dispatchAddConstraintEdit` commits. The full route
 * (commit + reload) is driven in `agent-sets-the-goal-target-real-writer.test.ts`. Rung: TESTED (in-process).
 */
import { describe, expect, it } from 'vitest';
import type { GoalStatedAs } from '@talchain/schemas';
import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';
import { applyGoalTargetEdit } from '../goal-target-edit.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { askForGoalPeriodFigure, convertGoalFigure, periodsNamedIn, sameGoalFigure, statedFigureHolds } from '../../goal-target/goal-period.js';

type Json = Record<string, any>;
const SCENARIO = '550e8400-e29b-41d4-a716-446655440451';
const GOAL = 'g-revenue';

/** The D1 fixture with its goal as a £ level, parsed as the turn path hands it on. */
const graphWith = (goal: Json = {}): GraphV3T => {
  const g = buildD1Fixture() as unknown as { nodes: Json[] };
  g.nodes = g.nodes.map((n) => (n.id === GOAL ? { ...n, label: 'Revenue', goal_threshold_unit: '£', ...goal } : n));
  const parsed = GraphV3.safeParse(g);
  if (!parsed.success) throw new Error(`fixture must parse: ${JSON.stringify(parsed.error.issues[0])}`);
  return parsed.data;
};
const goalOf = (g: unknown): Json => (g as { nodes: Json[] }).nodes.find((n) => n.id === GOAL)!;
/** Canonical bytes: the store re-orders JSONB keys, so "byte-equal" is equal after a deep key sort. */
const bytes = (v: unknown): string => JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Json)[k]])) : x));

type Extra = { goal_period?: string; goal_horizon?: Json; stated_as?: GoalStatedAs[]; expected?: Json; unit?: string };
/** The 0.69.0 event, through the REAL door. Every event is parsed by the REAL boundary schema first. */
const send = async (graph: GraphV3T, raw_value: number, extra: Extra = {}, constraint_type: 'at_least' | 'at_most' = 'at_least') => {
  // A client that READ the graph sends, for each field it writes, the value it read (null = none recorded): schemas
  // 0.69.0 `expected_*` (CODEX #78 5930825929). A stale one is a separate row.
  const held = goalOf(graph) as { goal_period?: unknown; goal_horizon?: unknown; goal_stated_as?: unknown };
  const event = { kind: 'goal_target_edit', goal_node_id: GOAL, constraint_type, raw_value, unit: '£',
    base_graph_hash: computeAnalysisAffectingGraphHash(graph as never), ...extra,
    ...(extra.goal_period !== undefined ? { expected_goal_period: held.goal_period ?? null } : {}),
    ...(extra.goal_horizon !== undefined ? { expected_goal_horizon: held.goal_horizon ?? null } : {}),
    ...(extra.stated_as !== undefined ? { expected_stated_as: held.goal_stated_as ?? null } : {}),
    ...(extra.expected ?? {}) };
  delete (event as Json).expected;
  const payload = { kind: 'system_event', scenario_id: SCENARIO, turn_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', stage: 'frame', event };
  const wire = OrchestratorTurnPayloadSchema.safeParse(payload);
  expect(wire.success, wire.success ? '' : JSON.stringify(wire.error.issues)).toBe(true);
  return applyGoalTargetEdit({
    payload: payload as never, event: event as never, requestId: 'req-t5', persistedGraph: graph, priorFacts: [],
  }) as Promise<{ kind: string; reason?: string; mutatedGraph?: Json; handlerFacts?: Json[]; response?: Json }>;
};
const written = async (graph: GraphV3T, raw: number, extra: Extra = {}, type: 'at_least' | 'at_most' = 'at_least') => {
  const r = await send(graph, raw, extra, type);
  expect(r.kind, JSON.stringify(r).slice(0, 400)).toBe('mutated');
  return r;
};

const PAUL_QUARTER: GoalStatedAs = { value: 100000, unit: '£', period: 'quarter', quote: 'about £100k a quarter' };

describe('F1 T5 G1: the ONE conversion module (`goal-period.ts`)', () => {
  it('converts month ↔ quarter ×3, month ↔ year ×12, quarter ↔ year ×4 — by an integer factor, one rounding', () => {
    expect(convertGoalFigure(100000, 'quarter', 'month')).toEqual({ kind: 'converted', value: 100000 / 3, factor: 3, op: 'divide' });
    expect(convertGoalFigure(20000, 'month', 'quarter')).toEqual({ kind: 'converted', value: 60000, factor: 3, op: 'multiply' });
    expect(convertGoalFigure(20000, 'month', 'year')).toEqual({ kind: 'converted', value: 240000, factor: 12, op: 'multiply' });
    expect(convertGoalFigure(240000, 'year', 'month')).toEqual({ kind: 'converted', value: 20000, factor: 12, op: 'divide' });
    expect(convertGoalFigure(50000, 'quarter', 'year')).toEqual({ kind: 'converted', value: 200000, factor: 4, op: 'multiply' });
    expect(convertGoalFigure(200000, 'year', 'quarter')).toEqual({ kind: 'converted', value: 50000, factor: 4, op: 'divide' });
    expect(convertGoalFigure(7, 'month', 'month')).toEqual({ kind: 'same_period', value: 7 });
  });
  it('never guesses: day, week and none against any other period are not convertible', () => {
    for (const [from, to] of [['week', 'month'], ['month', 'week'], ['day', 'month'], ['day', 'week'], ['none', 'month'], ['year', 'none']] as const) {
      expect(convertGoalFigure(1, from, to), `${from}→${to}`).toEqual({ kind: 'not_convertible', from, to });
    }
  });
  it('1e-9 relative: another order of the same arithmetic agrees; a figure rounded to pence does not', () => {
    expect(sameGoalFigure(100000 / 3, (100000 * 4) / 12)).toBe(true);
    expect(sameGoalFigure(100000 / 3, 33333.33)).toBe(false);
    expect(sameGoalFigure(0, 0)).toBe(true);
    expect(sameGoalFigure(0, 1e-12)).toBe(false);
  });
  it('the writer rule reads the LAST stated entry against the goal\'s period (the event\'s, else the one held)', () => {
    expect(statedFigureHolds({ raw_value: 100000 / 3, goal_period: 'month', stated_as: [PAUL_QUARTER] })).toEqual({ ok: true });
    expect(statedFigureHolds({ raw_value: 100000, goal_period: 'month', stated_as: [PAUL_QUARTER] }))
      .toEqual({ ok: false, reason: 'goal_period_conversion_mismatch', expected: 100000 / 3 });
    // An earlier record in another period is history, never converted: only the last entry binds `raw_value`.
    expect(statedFigureHolds({ raw_value: 40000, goal_period: 'month', stated_as: [PAUL_QUARTER, { value: 40000, unit: '£', period: 'month', quote: '£40k a month' }] })).toEqual({ ok: true });
    expect(statedFigureHolds({ raw_value: 1, goal_period: undefined, stated_as: [PAUL_QUARTER] })).toEqual({ ok: true });
  });
  it('the period words are the limit grammar\'s own: singular rates only, "today" is not a day', () => {
    expect([...periodsNamedIn('about £100k a quarter')]).toEqual(['quarter']);
    expect([...periodsNamedIn('£1.2m p.a.')]).toEqual(['year']);
    expect([...periodsNamedIn('monthly revenue')]).toEqual(['month']);
    expect([...periodsNamedIn('£100k today, within 6 months')]).toEqual([]);
  });
});

describe('F1 T5: `goal_target_edit` writes the goal\'s period, horizon and stated figures in the SAME write as the target', () => {
  it('RED (a): period + horizon + stated_as → the committed goal node carries each byte-equal, beside the target', async () => {
    const stated: GoalStatedAs[] = [{ value: 150000, unit: '£', period: 'quarter', quote: 'at least £150k a quarter' }];
    const r = await written(graphWith(), 150000, { goal_period: 'quarter', goal_horizon: { months: 6 }, stated_as: stated });
    const goal = goalOf(r.mutatedGraph);
    expect(goal.goal_period).toBe('quarter');
    expect(bytes(goal.goal_horizon)).toBe(bytes({ months: 6 }));
    expect(bytes(goal.goal_stated_as)).toBe(bytes(stated));
    expect(goal).toMatchObject({ goal_threshold_raw: 150000, threshold_source: 'user' });
    // …and a re-parse (every later write's `GraphV3.safeParse`) keeps all three (T1's mirror, on the written bytes).
    const reparsed = goalOf(GraphV3.parse(r.mutatedGraph));
    expect(bytes([reparsed.goal_period, reparsed.goal_horizon, reparsed.goal_stated_as])).toBe(bytes(['quarter', { months: 6 }, stated]));
  });

  it('CONTROL (b): an event WITHOUT them leaves every stored value exactly as it was — never cleared', async () => {
    const held = { goal_period: 'month', goal_horizon: { deadline: '2027-03-31' }, goal_stated_as: [PAUL_QUARTER] };
    const before = graphWith(held);
    expect(goalOf(before), 'PRECONDITION: the goal holds all three').toMatchObject(held);
    const r = await written(before, 40000);
    expect(bytes([goalOf(r.mutatedGraph).goal_period, goalOf(r.mutatedGraph).goal_horizon, goalOf(r.mutatedGraph).goal_stated_as]))
      .toBe(bytes([held.goal_period, held.goal_horizon, held.goal_stated_as]));
    expect(goalOf(r.mutatedGraph).goal_threshold_raw, 'the target itself was written').toBe(40000);
    // One key present: that one is replaced, the other two untouched.
    const r2 = await written(before, 40000, { goal_horizon: { months: 9 } });
    expect(bytes(goalOf(r2.mutatedGraph).goal_horizon)).toBe(bytes({ months: 9 }));
    expect(goalOf(r2.mutatedGraph).goal_period).toBe('month');
    expect(bytes(goalOf(r2.mutatedGraph).goal_stated_as)).toBe(bytes([PAUL_QUARTER]));
  });

  it('RED (c) Paul\'s case: a monthly goal, "£100k a quarter" → 33,333.33… stored PER MONTH (row and node), his quarterly figure kept verbatim', async () => {
    const r = await written(graphWith(), 100000 / 3, { goal_period: 'month', stated_as: [PAUL_QUARTER] });
    const goal = goalOf(r.mutatedGraph);
    expect(goal.goal_threshold_raw).toBe(100000 / 3);
    expect(r.mutatedGraph!.goal_constraints.filter((c: Json) => c.node_id === GOAL).map((c: Json) => c.value)).toEqual([100000 / 3]);
    expect(goal.goal_period).toBe('month');
    expect(bytes(goal.goal_stated_as)).toBe(bytes([PAUL_QUARTER]));
    // The UI may compute it in another order: one figure within 1e-9 relative.
    expect((await send(graphWith(), (100000 * 4) / 12, { goal_period: 'month', stated_as: [PAUL_QUARTER] })).kind).toBe('mutated');
  });

  it('RED (d): a conversion that does not give `raw_value` is REFUSED with nothing written — the unconverted figure, or one rounded to pence', async () => {
    const before = graphWith();
    for (const raw of [100000, 33333.33]) {
      const r = await send(before, raw, { goal_period: 'month', stated_as: [PAUL_QUARTER] });
      expect(r, `raw ${raw}`).toEqual({ kind: 'refused', reason: 'goal_period_conversion_mismatch' });
    }
    // The period the goal ALREADY holds binds too: omitting `goal_period` does not opt out of G1.
    const r = await send(graphWith({ goal_period: 'month' }), 100000, { stated_as: [PAUL_QUARTER] });
    expect(r).toEqual({ kind: 'refused', reason: 'goal_period_conversion_mismatch' });
  });

  it('RED (e): a figure per week or per day (or one-off) against a monthly goal is never converted — refused, and the ask names the period wanted', async () => {
    for (const period of ['week', 'day', 'none'] as const) {
      const r = await send(graphWith(), 25000, { goal_period: 'month', stated_as: [{ value: 25000, unit: '£', period, quote: '£25k' }] });
      expect(r, period).toEqual({ kind: 'refused', reason: 'goal_period_not_convertible' });
    }
    const ask = askForGoalPeriodFigure('week', 'month');
    expect(ask).toContain('per month');
    expect(ask).toContain('Nothing was changed');
    expect(ask).not.toMatch(/4\.3|4\.33|×/);
  });

  it('RED (CODEX #78 5930825929): a STALE expected value refuses with nothing written — the period moved since it was read', async () => {
    const stored = graphWith({ goal_period: 'quarter' });
    const r = await send(stored, 40000, { goal_period: 'month', expected: { expected_goal_period: 'month' } });
    expect(r).toEqual({ kind: 'refused', reason: 'expected_goal_metadata_mismatch' });
    // CONTROL: the value it really read (quarter) → written.
    expect((await send(stored, 40000, { goal_period: 'month' })).kind).toBe('mutated');
  });

  it('a period-only change is a change: never "no need to change it", the fact is not a no-op — and the analysis hash does not move (none of the three is an input)', async () => {
    const first = GraphV3.parse((await written(graphWith(), 40000, { goal_period: 'month' })).mutatedGraph);
    const again = await written(first, 40000, { goal_period: 'month', goal_horizon: { deadline: '2027-03-31' } });
    expect(again.handlerFacts?.[0]?.noop).toBe(false);
    expect(String(again.response?.assistant_text ?? '')).not.toMatch(/no need to change/);
    expect(bytes(goalOf(again.mutatedGraph).goal_horizon)).toBe(bytes({ deadline: '2027-03-31' }));
    expect(computeAnalysisAffectingGraphHash(again.mutatedGraph as never)).toBe(computeAnalysisAffectingGraphHash(first as never));
    // CONTROL: the identical restatement (same target, same period) IS a no-op, as before.
    const same = await written(first, 40000, { goal_period: 'month' });
    expect(same.handlerFacts?.[0]?.noop).toBe(true);
  });

  it('`at_most` writes the period on the goal too (the goal\'s figures are per it), and still stamps no threshold', async () => {
    const r = await written(graphWith(), 5000, { goal_period: 'month' }, 'at_most');
    expect(goalOf(r.mutatedGraph).goal_period).toBe('month');
    expect(goalOf(r.mutatedGraph).goal_threshold_raw).toBeUndefined();
  });
});

describe('ONE PERIOD CARRIER (CODEX #2454 5932596768): a goal holds ONE period — typed `goal_period`, or the one its stored unit names', () => {
  const QUARTERLY = { goal_threshold_unit: '£ per quarter' };
  const stated = (value: number, period: 'month' | 'quarter' | 'year', quote: string): GoalStatedAs => ({ value, unit: '£', period, quote });

  it('RED: `{unit: "£ per quarter", goal_period: "month"}` (two carriers, two periods) is REFUSED, nothing written', async () => {
    const g = graphWith(QUARTERLY);
    const r = await send(g, 70000, { unit: '£ per quarter', goal_period: 'month' });
    expect(r).toMatchObject({ kind: 'refused', reason: 'goal_period_conflicts_with_unit' });
  });

  it('CONTROL: the unit and goal_period agree ("£ per quarter" + quarter) → written, both held byte-equal', async () => {
    const r = await send(graphWith(QUARTERLY), 200000, { unit: '£ per quarter', goal_period: 'quarter' });
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    expect(goalOf(r.mutatedGraph)).toMatchObject({ goal_threshold_unit: '£ per quarter', goal_period: 'quarter', goal_threshold_raw: 200000 });
  });

  it('CONTROL (an explicit period edit, quarter → month): "£" + month on a "£ per quarter" goal → ONE carrier: unit "£", goal_period month', async () => {
    const r = await send(graphWith(QUARTERLY), 70000, { unit: '£', goal_period: 'month' });
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    expect(goalOf(r.mutatedGraph)).toMatchObject({ goal_threshold_unit: '£', goal_period: 'month', goal_threshold_raw: 70000 });
  });

  it.each([
    ['month → quarter (×3)', stated(70000, 'month', 'we need £70k a month'), 210000],
    ['year → quarter (÷4)', stated(400000, 'year', 'we need £400k a year'), 100000],
  ])('RED: G1 reads the LEGACY unit period exactly as a typed one — %s', async (_n, s, raw) => {
    const ok = await send(graphWith(QUARTERLY), raw, { unit: '£ per quarter', stated_as: [s] });
    expect(ok.kind, JSON.stringify(ok)).toBe('mutated');
    expect(goalOf(ok.mutatedGraph)).toMatchObject({ goal_threshold_unit: '£ per quarter', goal_threshold_raw: raw });
    const unconverted = await send(graphWith(QUARTERLY), s.value, { unit: '£ per quarter', stated_as: [s] });
    expect(unconverted).toMatchObject({ kind: 'refused', reason: 'goal_period_conversion_mismatch' });
  });
});

describe('ONE PERIOD CARRIER, the period in force AFTER the write (CODEX #2454 5933216093): an omitted goal_period keeps the typed one', () => {
  const TYPED_QUARTER = { goal_threshold_unit: '£', goal_period: 'quarter' };
  it('RED (the CODEX case): held {unit "£", goal_period quarter} + event {unit "£ per month", no goal_period} → REFUSED, nothing written', async () => {
    const r = await send(graphWith(TYPED_QUARTER), 70000, { unit: '£ per month' });
    expect(r).toMatchObject({ kind: 'refused', reason: 'goal_period_conflicts_with_unit' });
  });
  it.each([
    ['matching quarter (unit names quarter, typed quarter kept)', { unit: '£ per quarter' }, 'quarter'],
    ['explicit month (unit names month, event sets month)', { unit: '£ per month', goal_period: 'month' }, 'month'],
    ['no period anywhere in the unit (typed quarter kept)', { unit: '£' }, 'quarter'],
  ])('CONTROL: %s → written', async (_n, extra, period) => {
    const r = await send(graphWith(TYPED_QUARTER), 200000, extra as never);
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    expect(goalOf(r.mutatedGraph).goal_period).toBe(period);
  });
  it('CONTROL (legacy no-edit): a legacy "£ per quarter" goal (no typed period) keeps its unit → written', async () => {
    const r = await send(graphWith({ goal_threshold_unit: '£ per quarter' }), 200000, { unit: '£ per quarter' });
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
  });
  // ⛔ CODEX overflow 5934135126 P1 #1: an AT-MOST write never stamps the goal's own unit, so "£ per quarter" was RETAINED
  // beside a newly written `month` (and the read-back returned before checking). The shared writer now judges every unit
  // the goal holds after the write — this event door reaches it like every other.
  it('RED (CODEX P1 #1): at most "£" + month on a goal holding "£ per quarter" → REFUSED, nothing written (the retained unit collides)', async () => {
    const g = graphWith({ goal_threshold_unit: '£ per quarter', goal_threshold_raw: 200000 });
    const before = bytes(g);
    const r = await send(g, 5000, { unit: '£', goal_period: 'month' }, 'at_most');
    expect(r).toMatchObject({ kind: 'refused', reason: 'goal_period_conflicts_with_unit' });
    expect(bytes(g)).toBe(before);
  });
  it('CONTROL: the same at-most write naming the goal\'s own period (quarter) → written; the floor and its unit untouched', async () => {
    const r = await send(graphWith({ goal_threshold_unit: '£ per quarter', goal_threshold_raw: 200000 }), 15000, { unit: '£', goal_period: 'quarter' }, 'at_most');
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    expect(goalOf(r.mutatedGraph)).toMatchObject({ goal_period: 'quarter', goal_threshold_unit: '£ per quarter', goal_threshold_raw: 200000 });
  });
});
