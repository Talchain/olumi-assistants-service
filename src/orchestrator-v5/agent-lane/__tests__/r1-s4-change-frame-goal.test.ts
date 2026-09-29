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
import { withGoalSenseReading } from '../goal-sense-reading.js';

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
    expect(JSON.stringify(r)).toMatch(/its current level was not stated, so no chance of reaching it can be shown/);
    expect(JSON.stringify(r), 'no promise of a chat path that does not exist yet').not.toMatch(/Tell me the current level/);
  });

  it('S4G-6: Olumi\'s estimate of the current level is never the base (the level path\'s own rule)', async () => {
    const { registered } = await run(candidate({ baseline_known: true, baseline_value: 45000, baseline_provenance: 'ai_proposed' }));
    const g = goalOf(registered);
    expect(g['goal_threshold_frame']).toBe('change_rel');
    expect(Object.keys(g)).not.toContain('observed_state');
    expect(Object.keys(g)).not.toContain('goal_threshold');
  });

  // PR Review CHANGES_REQUIRED on #2262 @ 338e4268: the drafter's "known" + "explicit" is its word, not the brief's.
  it('S4G-8 RED: a FALSELY explicit current level (the brief states no bill) is never the base — no threshold, no base, said', async () => {
    const { r, registered } = await run(candidate({}),
      'Cut our monthly cloud bill by 15% within 6 months. Should we move steady workloads to reserved instances, or renegotiate our contract?');
    const g = goalOf(registered);
    expect(g['goal_threshold_frame'], 'PRECONDITION: the change is still written').toBe('change_rel');
    expect(Object.keys(g)).not.toContain('observed_state');
    expect(Object.keys(g)).not.toContain('goal_threshold');
    expect(JSON.stringify(r)).toMatch(/is not a figure your brief states for it/);
  });
  it('S4G-8b RED: the same £45,000 stated for ANOTHER quantity (support costs) is not the cloud bill\'s base', async () => {
    const { registered } = await run(candidate({}),
      'Our support team costs £45,000 a month. Cut our monthly cloud bill by 15% within 6 months. Should we move steady workloads to reserved instances, or renegotiate our contract?');
    const g = goalOf(registered);
    expect(Object.keys(g)).not.toContain('observed_state');
    expect(Object.keys(g)).not.toContain('goal_threshold');
  });
  it('S4G-8c CONTROL: the brief states the cloud bill\'s £45,000 → the base is written (the valid control beside 8/8b)', async () => {
    const { registered } = await run(candidate({}));
    const g = goalOf(registered);
    expect((g['observed_state'] as { raw_value: number; source: string })).toMatchObject({ raw_value: 45000, source: 'brief_extraction' });
  });
  // Read with the model's own labels, as every chat door reads a goal target (`scopeIn`): a quantity the model does not
  // hold names nothing, so "cut it by 15%" stays the user's (S4G-9b) — the scope rule's stated limit, not this door's.
  it('S4G-9 RED: a "15%" the brief writes about ANOTHER quantity does not hold the goal\'s change target as the user\'s', async () => {
    const { registered } = await run(candidate({}),
      'Our reserved share grew 15% this year. Our monthly cloud bill is currently £45,000 and we need it lower within 6 months. Should we move steady workloads to reserved instances, or renegotiate our contract?');
    const g = goalOf(registered);
    expect(g['goal_threshold_frame'], 'PRECONDITION: the change is still written').toBe('change_rel');
    expect(Object.keys(g)).not.toContain('threshold_source');
    expect(Object.keys(g)).not.toContain('goal_direction');
  });

  it('S4G-9b CONTROL: "cut it by 15%" (a clause naming no quantity) holds the change target as the user\'s', async () => {
    const { registered } = await run(candidate({}));
    const g = goalOf(registered);
    expect(g).toMatchObject({ threshold_source: 'brief_extraction', goal_direction: '<=' });
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

// ⛔ R3-B #72 5893233864 / DL 5893260041 (served, release blocker): "cut costs by 20%" MAXIMISED spend — "Stay on AWS"
// crowned, 100% "reaches the target" — because the "20%" beside "costs" was given to another node labelled "cost", so no
// comparator was held. AIQ 5893340150: a typed DECREASE is Olumi's reading of the sense — typed on the goal
// (`goal_sense_reading`, MG 5893383773), said, and sent as `minimise` — never when the drafter's own comparator is a floor.
describe('Olumi\'s typed reading of a decrease target (the served "cut costs" inversion)', () => {
  const CLOUD = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% without more than 2 weeks of migration downtime risk.';
  const WORDS = 'Olumi reads ‘Monthly spend’ as a target to bring it DOWN by at least 20% from today.';
  const COST_NODES = ['GCP workload share', 'Monthly cloud-cost reduction'];
  const cloud = (factors: string[], goal: Record<string, unknown> = {}) => {
    const c = candidate({ metric: 'Monthly spend', value: -20, unit: 'GBP per month', baseline_value: 45000, horizon_months: null, ...goal }) as Record<string, any>;
    c.options = [
      { label: 'Switch to GCP', provenance: 'explicit', changes: [factors[0]], interventions: [], is_status_quo: false },
      { label: 'Stay on AWS', provenance: 'explicit', changes: [], interventions: [], is_status_quo: true },
    ];
    c.factors = factors.map((l) => ({ label: l, role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 100 }));
    c.links = factors.map((l) => link(l, 'Monthly spend'));
    return c;
  };
  const sent = async (payload: unknown, brief = CLOUD) => {
    const { r, registered } = await run(payload, brief);
    const g = goalOf(registered);
    return { r, g, wire: resolveGoalDirection(registered, g.id) };
  };
  it.each([
    ['another node labelled "cost" ("Monthly cloud-cost reduction")', COST_NODES],
    ['another node labelled "cost" ("Migration remediation cost")', ['GCP workload share', 'Migration remediation cost']],
  ])('RED (served shape): %s — no comparator held, yet Olumi\'s reading is typed, said, and the run minimises', async (_why, factors) => {
    const { r, g, wire } = await sent(cloud(factors));
    expect(g['goal_threshold_frame'], 'PRECONDITION: typed as a change').toBe('change_rel');
    expect(g['goal_threshold']).toBe(-0.2);
    expect(Object.keys(g), 'PRECONDITION: the served failure — no comparator held').not.toContain('goal_direction');
    expect(g['goal_sense_reading']).toEqual({ sense: 'minimise', basis: 'typed_change_sign', threshold: -0.2, threshold_frame: 'change_rel', words: WORDS });
    expect(wire).toEqual({ direction: 'minimise', provenance: 'typed_change_sign' });
    expect(r.not_represented, 'AIQ (a): the reading is said in the reply').toContain(WORDS);
  });
  it('FLOOR GUARD (AIQ (b)): the same served shape with the drafter\'s comparator a FLOOR (>=) — no reading, nothing sent', async () => {
    const { g, wire } = await sent(cloud(COST_NODES, { operator: '>=' }));
    expect(g['goal_threshold']).toBe(-0.2);
    expect(Object.keys(g)).not.toContain('goal_direction');
    expect(Object.keys(g)).not.toContain('goal_sense_reading');
    expect(wire).toBeUndefined();
  });
  it('CONTROL: with no "cost" node the user\'s comparator is held and speaks first — no Olumi reading is written', async () => {
    const { g, wire } = await sent(cloud(['GCP workload share']));
    expect(g['goal_direction']).toBe('<=');
    expect(Object.keys(g)).not.toContain('goal_sense_reading');
    expect(wire).toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
  });
  it('CONTROL: a typed INCREASE ("grow MRR by 10%", +0.10) — no reading, nothing sent (the maximiser, exactly as today)', async () => {
    const brief = 'Our MRR is £75,000. We want to grow MRR by 10% within a year. Should we raise the Pro price or add a Teams plan?';
    const payload = cloud(['Pro price'], { metric: 'MRR', value: 10, operator: '>=', baseline_value: 75000 }) as Record<string, any>;
    payload.options = [{ label: 'Raise Pro price', provenance: 'explicit', changes: ['Pro price'], interventions: [], is_status_quo: false }, { label: 'Add Teams plan', provenance: 'explicit', changes: [], interventions: [], is_status_quo: false }];
    payload.links = [link('Pro price', 'MRR')];
    const { g, wire } = await sent(payload, brief);
    expect(g['goal_threshold']).toBe(0.1);
    expect(Object.keys(g)).not.toContain('goal_sense_reading');
    expect(wire).toBeUndefined();
  });
  it('CONTROL: a graph saved BEFORE the reading (typed −0.2, nothing held, no reading) reads exactly as before', () => {
    const graph = { nodes: [{ id: 'monthly_spend', kind: 'goal', label: 'Monthly spend', goal_threshold: -0.2, goal_threshold_raw: -0.2, goal_threshold_frame: 'change_rel' }] };
    expect(resolveGoalDirection(graph, 'monthly_spend')).toBeUndefined();
  });
  it('the reading speaks only while the typed sign is negative: an edit to +0.1 keeps the stale field but sends nothing', () => {
    const graph = { nodes: [{ id: 'monthly_spend', kind: 'goal', label: 'Monthly spend', goal_threshold: 0.1, goal_threshold_raw: 0.1, goal_threshold_frame: 'change_rel',
      goal_sense_reading: { sense: 'minimise', basis: 'typed_change_sign', threshold: -0.2, threshold_frame: 'change_rel', words: WORDS } }] };
    expect(resolveGoalDirection(graph, 'monthly_spend')).toBeUndefined();
  });

  // ⛔ PR Review 5894041769: a SAVED graph keeps the reading across later edits (every write keeps a CEE-owned field), so
  // the Run decision binds to the exact target it read and never overrules a comparator held since. Each row starts from
  // the graph construction REGISTERED on the served shape (a real −20% ceiling reading), then edits only the target.
  describe('SAVED GRAPH: the reading is bound to the exact target it read', () => {
    const saved = async () => {
      const { g } = await sent(cloud(COST_NODES));
      expect(g['goal_sense_reading'], 'PRECONDITION: construction wrote the −20% ceiling reading').toMatchObject({ threshold: -0.2, threshold_frame: 'change_rel' });
      expect(resolveGoalDirection({ nodes: [g] }, g.id), 'PRECONDITION: before the edit the run minimises').toEqual({ direction: 'minimise', provenance: 'typed_change_sign' });
      return g;
    };
    const after = (g: Record<string, any>, edit: Record<string, unknown>) => resolveGoalDirection({ nodes: [{ ...g, ...edit }] }, g.id);
    it('RED: an edit to a −10% FLOOR ("keep spend from falling more than 10%", held >=) keeps the old reading → no minimise', async () => {
      const g = await saved();
      expect(after(g, { goal_threshold: -0.1, goal_threshold_raw: -0.1, goal_direction: '>=' })).toBeUndefined();
    });
    it('RED: a FLOOR held since on the SAME −20% target → no minimise (a held comparator is never overruled by Olumi\'s reading)', async () => {
      const g = await saved();
      expect(after(g, { goal_direction: '>=' })).toBeUndefined();
      expect(after(g, { goal_direction: '>' })).toBeUndefined();
    });
    it('RED: another NEGATIVE target (−10%) with no fresh reading cannot use the stale −20% reading → nothing sent', async () => {
      const g = await saved();
      expect(after(g, { goal_threshold: -0.1, goal_threshold_raw: -0.1 })).toBeUndefined();
    });
    it('RED: the same figure re-typed in ANOTHER frame (change_abs) cannot use the change_rel reading → nothing sent', async () => {
      const g = await saved();
      expect(after(g, { goal_threshold_frame: 'change_abs' })).toBeUndefined();
    });
    it('CONTROL: a user CEILING held since speaks as the user\'s own (stated_comparator), never as Olumi\'s reading', async () => {
      const g = await saved();
      expect(after(g, { goal_direction: '<=' })).toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
    });
    it('CONTROL: an unrelated edit (the label) leaves the target, and the reading, exactly as read → still minimise', async () => {
      const g = await saved();
      expect(after(g, { label: 'Monthly cloud spend' })).toEqual({ direction: 'minimise', provenance: 'typed_change_sign' });
    });
  });
});

describe('withGoalSenseReading (pure)', () => {
  const goalNode = (over: Record<string, unknown> = {}) => ({ id: 'g', kind: 'goal', label: 'Monthly spend', goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2, ...over });
  it('a strict ceiling says "more than"; a change_abs says the amount in its unit', () => {
    expect((withGoalSenseReading([goalNode()], { operator: '<' })[0] as Record<string, any>).goal_sense_reading.words)
      .toBe('Olumi reads ‘Monthly spend’ as a target to bring it DOWN by more than 20% from today.');
    const abs = withGoalSenseReading([goalNode({ goal_threshold_frame: 'change_abs', goal_threshold_raw: -5000, goal_threshold_unit: 'GBP per month' })], { operator: '<=' });
    expect((abs[0] as Record<string, any>).goal_sense_reading.words).toMatch(/DOWN by at least £5,000/);
  });
  it.each([
    ['a floor', [goalNode()], { operator: '>=' }],
    ['a held user comparator', [goalNode({ goal_direction: '<=' })], { operator: '<=' }],
    ['an increase', [goalNode({ goal_threshold_raw: 0.1 })], { operator: '<=' }],
    ['a level target', [goalNode({ goal_threshold_frame: 'level', goal_threshold_raw: 36000 })], { operator: '<=' }],
    ['two goals', [goalNode(), goalNode({ id: 'h' })], { operator: '<=' }],
  ])('NO READING: %s → the very same array', (_why, nodes, goal) => {
    expect(withGoalSenseReading(nodes, goal)).toBe(nodes);
  });
});
