/**
 * ⭐ R1 S4-core (goal) — A GOAL STATED AS A CHANGE FROM TODAY IS WRITTEN AS ONE (`@talchain/schemas` 0.61.0).
 *
 * Before: the drafter had no way to say "cut the cloud bill by 15%" except as a LEVEL target of 15 in "%" (the prompt
 * reads "by £3m" as a number to reach), so the goal read against today's £45,000 bill as a 15-percent level: no goal
 * fit, or a wrong one.
 *
 * Now (design MG #72 5871257542 §1/§3; ISL S2 served: `change_rel` r → a change of r·b_raw on the node's raw range):
 *   · the drafter types the goal's `frame` (`level | change_abs | change_rel`); for `change_rel` its `value` is the
 *     signed percentage (−15) and its `unit` the METRIC's own unit, the unit of its current level;
 *   · admission writes `goal_threshold_frame`, `goal_threshold_raw` = r (−0.15) or c, and — ONLY beside a current level
 *     the user stated — the goal's base on ONE cap taken from the level scale (today's level and the target level),
 *     with `goal_threshold` = r (scale-free) or c ÷ cap. PLoT sends [0, goal_threshold_cap] as the raw range;
 *   · with no stated current level the frame and the figure are kept, no threshold is written (no goal fit), and the
 *     build says what is missing — never a guessed base;
 *   · the held comparator IS the direction for a typed change ("cut" → `<=` → minimise), S1's level proof not needed.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { resolveGoalDirection } from '../../goal-target/goal-direction.js';

const SCENARIO = '99999999-9999-4999-8999-999999999999';
const BRIEF = 'Our monthly cloud bill is currently £45,000. We need to cut it by 15% within 6 months. Should we move steady workloads to reserved instances, or renegotiate our contract?';

const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });
function candidate(goal: Record<string, unknown>) {
  return {
    goal: {
      metric: 'Monthly cloud bill', operator: '<=', target_stated: true, value: -15, unit: 'GBP per month', horizon_months: 6,
      provenance: 'explicit', baseline_known: true, baseline_value: 45000, baseline_provenance: 'explicit', scope: null, frame: 'change_rel',
      ...goal,
    },
    constraints: [],
    options: [
      { label: 'Reserved instances', provenance: 'explicit', changes: ['Reserved share'], interventions: [], is_status_quo: false },
      { label: 'Renegotiate contract', provenance: 'explicit', changes: ['Contract discount'], interventions: [], is_status_quo: false },
    ],
    factors: [
      { label: 'Reserved share', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 100 },
      { label: 'Contract discount', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 100 },
    ],
    risks: [],
    outcomes: [],
    links: [link('Reserved share', 'Monthly cloud bill'), link('Contract discount', 'Monthly cloud bill')],
    unknowns: [],
  };
}
type Node = Record<string, unknown> & { kind?: string };
type Registered = { nodes?: Node[] } | null;
function run(payload: unknown, brief = BRIEF) {
  let registered: Registered = null;
  const reqs: { instructions: string }[] = [];
  const fn = vi.fn(async (req: { instructions: string; input: string }) => {
    reqs.push(req); return { text: JSON.stringify(payload) };
  }) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: Registered }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  return buildModelFromBrief(SCENARIO, brief, dispatch, fn).then((r) => ({ r: r as Record<string, unknown>, reqs, registered: registered as Registered }));
}
const goalOf = (g: Registered): Node => (g?.nodes ?? []).find((n) => n.kind === 'goal') as Node;

describe('S4G — the drafter types the goal\'s frame', () => {
  it('S4G-1: the goal schema REQUIRES a frame from the contract\'s three writable values', () => {
    const goal = (buildCandidateSchema() as { properties: { goal: { properties: Record<string, { enum?: string[] }>; required: string[] } } }).properties.goal;
    expect(goal.properties['frame']?.enum).toEqual(['level', 'change_abs', 'change_rel']);
    expect(goal.required).toContain('frame');
  });

  it('S4G-2: the drafter is told what each goal frame means, with the signed percentage and the metric\'s own unit', async () => {
    const { reqs } = await run(candidate({}));
    const said = reqs[0]!.instructions;
    expect(said).toMatch(/State the goal\u2019s `frame`: "level" when the user names the level to reach/);
    expect(said).toMatch(/"change_rel" when they name a PERCENTAGE change from today \("cut the cloud bill by 15%", "grow MRR by 10%"\): `value` is that signed percentage \(-15, or 10\)/);
    expect(said).toMatch(/"change_abs" when they name a change from today in the metric\u2019s own unit/);
    expect(said).toMatch(/`unit` is always the goal metric\u2019s own unit, the unit of its current level/);
  });
});

describe('S4G — WIRE: a change goal reaches /graph/register in the contract\'s shape', () => {
  it('S4G-3: "cut it by 15%" from a stated £45,000 → change_rel −0.15 on the level scale, with the user\'s base', async () => {
    const { registered } = await run(candidate({}));
    const g = goalOf(registered);
    expect(g['goal_threshold_frame']).toBe('change_rel');
    expect(g['goal_threshold_raw']).toBeCloseTo(-0.15, 12);
    expect(g['goal_threshold'], 'a relative change is scale-free: r, never r ÷ cap').toBeCloseTo(-0.15, 12);
    expect(g['goal_threshold_unit']).toBe('GBP per month');
    const cap = g['goal_threshold_cap'] as number;
    expect(cap, 'the level scale holds today\'s £45,000 (and the £38,250 target)').toBeGreaterThan(45000);
    expect(g['observed_state']).toMatchObject({ source: 'brief_extraction', raw_value: 45000, cap });
    expect((g['observed_state'] as { baseline: number }).baseline).toBeCloseTo(45000 / cap, 12);
  });

  it('S4G-3b: the brief\'s "15%" holds the change target as the user\'s, with its comparator ("<=": the run minimises)', async () => {
    const { registered } = await run(candidate({}));
    const g = goalOf(registered);
    expect(g['threshold_source']).toBe('brief_extraction');
    expect(g['goal_direction']).toBe('<=');
    expect(resolveGoalDirection(registered, g['id'])).toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
  });

  it('S4G-3c: CONTRAST — a percentage the brief never wrote (20% on a "15%" brief) is not held as the user\'s', async () => {
    const { registered } = await run(candidate({ value: -20 }));
    const g = goalOf(registered);
    expect(g['goal_threshold_frame'], 'PRECONDITION: the change is still written').toBe('change_rel');
    expect(Object.keys(g)).not.toContain('threshold_source');
    expect(Object.keys(g)).not.toContain('goal_direction');
  });

  it('S4G-4: "reduce churn by 2 points" from a stated 5% → change_abs −2, threshold −2 ÷ cap on the same cap as the base', async () => {
    const { registered } = await run(candidate({ metric: 'Monthly churn', value: -2, unit: '%', frame: 'change_abs', baseline_value: 5 }),
      'Monthly churn is 5% today. We need to reduce churn by 2 points this year. Should we add onboarding calls or cut the price?');
    const g = goalOf(registered);
    expect(g['goal_threshold_frame']).toBe('change_abs');
    expect(g['goal_threshold_raw']).toBe(-2);
    const cap = g['goal_threshold_cap'] as number;
    expect(g['goal_threshold']).toBeCloseTo(-2 / cap, 12);
    expect((g['observed_state'] as { baseline: number; raw_value: number }).raw_value).toBe(5);
    expect((g['observed_state'] as { baseline: number }).baseline).toBeCloseTo(5 / cap, 12);
  });

  it('S4G-5: NEVER A GUESSED BASE — no stated current level: the frame and r are kept, no threshold, no base, and the build says what is missing', async () => {
    const { r, registered } = await run(candidate({ baseline_known: false, baseline_value: null }),
      'We need to cut our monthly cloud bill by 15% within 6 months. Should we move steady workloads to reserved instances, or renegotiate?');
    const g = goalOf(registered);
    expect(g['goal_threshold_frame']).toBe('change_rel');
    expect(g['goal_threshold_raw']).toBeCloseTo(-0.15, 12);
    expect(Object.keys(g)).not.toContain('goal_threshold');
    expect(Object.keys(g)).not.toContain('observed_state');
    expect(JSON.stringify(r)).toMatch(/current level of \\"Monthly cloud bill\\"/);
  });

  it('S4G-6: Olumi\'s estimate of the current level is never the base (the level path\'s own rule)', async () => {
    const { registered } = await run(candidate({ baseline_known: true, baseline_value: 45000, baseline_provenance: 'ai_proposed' }));
    const g = goalOf(registered);
    expect(g['goal_threshold_frame']).toBe('change_rel');
    expect(Object.keys(g)).not.toContain('observed_state');
    expect(Object.keys(g)).not.toContain('goal_threshold');
  });

  it('S4G-7: CONTROL — a level goal ("to £40,000") registers exactly as before', async () => {
    const { registered } = await run(candidate({ value: 40000, frame: 'level' }));
    const g = goalOf(registered);
    expect(g['goal_threshold_frame']).toBe('level');
    expect(g['goal_threshold_raw']).toBe(40000);
    expect(g['goal_threshold']).toBeCloseTo(40000 / (g['goal_threshold_cap'] as number), 12);
  });

  it('S4G-8: a candidate with no goal frame (a pre-R1 payload) takes the level path unchanged', async () => {
    const c = candidate({ value: 40000 });
    delete (c.goal as Record<string, unknown>)['frame'];
    const { registered } = await run(c);
    expect(goalOf(registered)['goal_threshold_frame']).toBe('level');
    expect(goalOf(registered)['goal_threshold_raw']).toBe(40000);
  });
});

describe('S4G — the repair retry cannot re-frame the goal', () => {
  it('S4G-12: the compaction retry PINS the first draft\'s frame ("cut by 15%" stays change_rel); a pre-R1 draft pins to level', async () => {
    const { retrySchemaPinningGoal } = await import('../runtime/build-model.js');
    const { Ajv } = await import('ajv');
    const first = candidate({});
    // The GOAL sub-schema of the retry (the part this row is about); the rest of the draft is pinned elsewhere.
    const goalSchemaOf = (goal: unknown) => (retrySchemaPinningGoal(goal as never) as { properties: { goal: object } }).properties.goal;
    const pinned = new Ajv({ strict: false }).compile(goalSchemaOf(first.goal));
    expect(pinned(first.goal), JSON.stringify(pinned.errors)).toBe(true);
    expect(pinned({ ...first.goal, frame: 'level' }), 'the retry cannot turn the change into a level').toBe(false);
    const legacy = { ...first.goal } as Record<string, unknown>;
    delete legacy['frame'];
    const pinnedLegacy = new Ajv({ strict: false }).compile(goalSchemaOf(legacy));
    expect(pinnedLegacy({ ...legacy, frame: 'level' }), JSON.stringify(pinnedLegacy.errors)).toBe(true);
  });
});

describe('S4G — the held comparator is the direction of a TYPED change', () => {
  const graph = (frame: string, held: string, os?: Record<string, unknown>) => ({
    nodes: [{ id: 'goal_bill', kind: 'goal', label: 'Monthly cloud bill', goal_threshold_frame: frame, goal_direction: held, goal_threshold_unit: 'GBP per month', ...(os ? { observed_state: os } : {}) }],
  });

  it('S4G-9: "cut by 15%" (held <=, change_rel) minimises from the stated comparator — no level proof needed', () => {
    expect(resolveGoalDirection(graph('change_rel', '<='), 'goal_bill')).toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
    expect(resolveGoalDirection(graph('change_abs', '<'), 'goal_bill')).toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
  });

  it('S4G-10: CONTROL — a LEVEL ceiling still needs S1\'s proof (the user\'s level in the target\'s unit)', () => {
    const r = resolveGoalDirection(graph('level', '<='), 'goal_bill');
    expect(r?.provenance).not.toBe('stated_comparator');
  });

  it('S4G-11: a typed change FLOOR ("grow by 10%", held >=) sends nothing new — the maximiser, as before', () => {
    expect(resolveGoalDirection(graph('change_rel', '>='), 'goal_bill')?.direction).not.toBe('minimise');
  });
});
