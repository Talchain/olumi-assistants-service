/**
 * ⭐ AIQ (b) 5894808343 (1) — the brief's level as OLUMI'S DISCLOSED READING of a change goal's today level, on the REAL
 * build (`buildModelFromBrief` → `/graph/register`). The served "cut costs" shape (R3-B #72 5894575583, `7c23be87`) and
 * the saved "costs" drafts (11/12 with no level): rows (a)–(d) end to end, the reader's staleness, and the user's own
 * level untouched. Mutant (e) (the detector off) turns (a) RED. 0 LLM.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { goalLevelReadingWords } from '../../goal-target/goal-level-reading.js';

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


const CLOUD = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% without more than 2 weeks of migration downtime risk.';
const WORDS = 'Olumi reads your ‘£45k’ (‘Monthly spend is £45k’) as today\'s level of ‘costs’, so a 20% cut is £36,000 / month or less.';
/** The saved "costs" draft: a change goal named "costs", NO level (the drafter's omission), the £45k on no node. */
function costs(goal: Record<string, unknown> = {}) {
  const c = candidate({ metric: 'costs', value: -20, unit: '£/month', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', horizon_months: null, ...goal }) as Record<string, any>;
  c.options = [
    { label: 'Switch to GCP', provenance: 'explicit', changes: ['GCP workload share'], interventions: [], is_status_quo: false },
    { label: 'Stay on AWS', provenance: 'explicit', changes: [], interventions: [], is_status_quo: true },
  ];
  c.factors = [{ label: 'GCP workload share', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 100 }];
  c.links = [link('GCP workload share', String(c.goal.metric))];
  return c;
}
const said = (r: Record<string, unknown>): string => JSON.stringify(r);

describe('AIQ (b): the brief\'s £45k as Olumi\'s disclosed reading of today\'s level (real build)', () => {
  it('(a) RED: the saved "costs" draft → a base on the goal, Olumi\'s (never user_stated), the words said, the reader speaks', async () => {
    const { r, registered } = await run(costs(), CLOUD);
    const g = goalOf(registered);
    expect(g['goal_threshold_frame']).toBe('change_rel');
    expect(g['goal_threshold']).toBe(-0.2);
    expect(g['observed_state']).toMatchObject({ raw_value: 45000, source: 'cee_inference', cap: 56250 });
    expect(g['goal_level_reading']).toEqual({ level: 45000, level_unit: '£/month', quote: 'Monthly spend is £45k',
      lead: 'Olumi reads your ‘£45k’ (‘Monthly spend is £45k’) as today\'s level of ‘costs’', bound: '<=' });
    expect(said(r)).toContain(WORDS);
    expect(said(r)).not.toMatch(/current level was not stated/);
    expect(goalLevelReadingWords(registered, g.id)).toBe(WORDS);
  });
  it('CONTROL: the user\'s own stated level (the drafter gave it, the brief states it for the goal) → user_stated, no reading', async () => {
    const { registered } = await run(costs({ metric: 'Monthly spend', baseline_known: true, baseline_value: 45000, baseline_provenance: 'explicit' }), CLOUD);
    const g = goalOf(registered);
    expect(g['observed_state']).toMatchObject({ raw_value: 45000, source: 'brief_extraction' });
    expect(Object.keys(g)).not.toContain('goal_level_reading');
    expect(goalLevelReadingWords(registered, g.id)).toBeNull();
  });
  it.each<[string, Record<string, unknown>, string, RegExp]>([
    ['(b) TWO figures in the goal\'s terms', {}, CLOUD.replace('Monthly spend is £45k', 'Monthly spend is £45k, of which £12k is storage'),
      /Your brief gives ‘£45k’ and ‘£12k’, but none of them is held as today's level of ‘costs’, so no chance of reaching your target is shown\./],
    ['(c) "£540k a year" beside a monthly goal', {}, CLOUD.replace('Monthly spend is £45k', 'We spend £540k a year'),
      /Your brief gives ‘£540k’, but it isn't held as today's level of ‘costs’, so no chance of reaching your target is shown\. Tell me the current level of ‘costs’ and the chance of reaching it can be shown\./],
    ['PTL 5895711185 / AIQ 5895823531: the figure is the SUPPORT TEAM\'s, never the cloud bill\'s → refused, and the build ASKS', { metric: 'Monthly cloud bill', value: -15 },
      'Our support team costs £45,000 a month and we want to cut our cloud bill by 15%.',
      /Your brief gives ‘£45,000’, but it isn't held as today's level of ‘Monthly cloud bill’, so no chance of reaching your target is shown\. Tell me the current level of ‘Monthly cloud bill’ and the chance of reaching it can be shown\./],
    ['(c) a period-less clause ("Spend is £45k")', {}, CLOUD.replace('Monthly spend', 'Spend'),
      /Your brief gives ‘£45k’, but it isn't held as today's level of ‘costs’/],
    ['(d) a "USD per month" goal whose drafter typed the £45k as the user\'s', { unit: 'USD per month', baseline_known: true, baseline_value: 45000, baseline_provenance: 'explicit', metric: 'Monthly spend' }, CLOUD,
      /Your brief gives ‘£45k’, but it isn't held as today's level of ‘Monthly spend’/],
  ])('NO BASE, and the brief\'s figure is named, never "not stated": %s', async (_why, goal, brief, words) => {
    const { r, registered } = await run(costs(goal), brief);
    const g = goalOf(registered);
    expect(Object.keys(g)).not.toContain('observed_state');
    expect(Object.keys(g)).not.toContain('goal_level_reading');
    expect(said(r)).toMatch(words);
    expect(said(r)).not.toMatch(/current level was not stated/);
  });
  // ⛔ AIQ 5897443539 (served a20cfd6 runs 0 and 1, real build): both had no base, so no chance.
  it('(run 0, real build) a "%"-typed percentage change gets its base in the brief\'s terms, as Olumi\'s reading', async () => {
    const { registered } = await run(costs({ metric: 'Monthly spend', unit: '%' }), CLOUD);
    const g = goalOf(registered) as Record<string, any>;
    expect(g.observed_state).toMatchObject({ raw_value: 45000, source: 'cee_inference', unit: 'GBP per month' });
    expect(g.goal_threshold_unit).toBe('GBP per month');
    expect(goalLevelReadingWords(registered, g.id)).toMatch(/^Olumi reads your ‘£45k’ \(‘Monthly spend is £45k’\) as today's level of ‘Monthly spend’, so a 20% cut is £36,000/);
  });
  it('(PR Review CR @ 729afc91, real build) an ANNUAL £45k for a "%"-typed MONTHLY goal → no base, and the build asks', async () => {
    const { r, registered } = await run(costs({ metric: 'Monthly spend', unit: '%' }), 'Annual spend is £45k; we want to cut monthly spend by 20%.');
    const g = goalOf(registered) as Record<string, any>;
    expect(g.observed_state).toBeUndefined();
    expect(g.goal_level_reading).toBeUndefined();
    expect(said(r)).toMatch(/Your brief gives ‘£45k’, but it isn't held as today's level of ‘Monthly spend’/);
  });
  it('(run 1, real build) the £45k ALSO on a factor → the goal still gets its base as Olumi\'s reading', async () => {
    const c = costs({ metric: 'Monthly spend' }) as Record<string, any>;
    c.factors = [...c.factors, { label: 'AWS-equivalent monthly cloud spend', role: 'observable', baseline_known: true, baseline_value: 45000, unit: '£/month', provenance: 'explicit', plausible_max: 200000 }];
    c.links = [...c.links, link('AWS-equivalent monthly cloud spend', 'Monthly spend')];
    const { registered } = await run(c, CLOUD);
    const g = goalOf(registered) as Record<string, any>;
    expect(g.observed_state).toMatchObject({ raw_value: 45000, source: 'cee_inference' });
    expect(g.goal_level_reading).toBeDefined();
  });
  it('a brief with NO money figure still says the level was not stated (true there), exactly as before', async () => {
    const { r } = await run(costs(), 'Should we switch our cloud provider from AWS to GCP? We want to cut costs by 20% this year.');
    expect(said(r)).toMatch(/its current level was not stated/);
  });
});

describe('goalLevelReadingWords: the reading speaks only for the level it read', () => {
  const saved = async () => {
    const { registered } = await run(costs(), CLOUD);
    const g = goalOf(registered);
    expect(goalLevelReadingWords(registered, g.id), 'PRECONDITION').toBe(WORDS);
    return g as Record<string, any>;
  };
  const after = (g: Record<string, any>, os: Record<string, unknown>) => goalLevelReadingWords({ nodes: [{ ...g, observed_state: { ...g.observed_state, ...os } }] }, g.id);
  it('a level the USER edits since (another figure, their source) → silent', async () => {
    const g = await saved();
    expect(after(g, { raw_value: 50000, source: 'user_edited' })).toBeNull();
  });
  it('the SAME figure, now the user\'s own (they confirmed it) → silent: it is no longer Olumi\'s reading', async () => {
    const g = await saved();
    expect(after(g, { source: 'brief_extraction' })).toBeNull();
  });
  it('another figure, still Olumi\'s → silent (a stale reading never speaks)', async () => {
    const g = await saved();
    expect(after(g, { raw_value: 44000 })).toBeNull();
  });
  it('another unit → silent', async () => {
    const g = await saved();
    expect(after(g, { unit: 'GBP per year' })).toBeNull();
  });
  it('CONTROL: an unrelated edit (the label) → still speaks', async () => {
    const g = await saved();
    expect(goalLevelReadingWords({ nodes: [{ ...g, label: 'Monthly cloud costs' }] }, g.id)).toBe(WORDS);
  });
  // ⛔ AIQ 5895379601 (2): the level is still Olumi's reading after a TARGET edit, so the reading speaks — with the target
  // as it now stands, composed at read time, never the stored old one.
  const node = (g: Record<string, any>, over: Record<string, unknown>) => goalLevelReadingWords({ nodes: [{ ...g, ...over }] }, g.id);
  it('RED: the target edited −20% → −25% → "a 25% cut is £33,750 / month or less" (never the old £36,000)', async () => {
    const g = await saved();
    expect(node(g, { goal_threshold_raw: -0.25, goal_threshold: -0.25 })).toBe(
      'Olumi reads your ‘£45k’ (‘Monthly spend is £45k’) as today\'s level of ‘costs’, so a 25% cut is £33,750 / month or less.');
  });
  it('a comparator the USER holds speaks first: a strict ceiling says "less than" (AIQ\'s nit)', async () => {
    const g = await saved();
    expect(node(g, { goal_direction: '<' })).toBe(
      'Olumi reads your ‘£45k’ (‘Monthly spend is £45k’) as today\'s level of ‘costs’, so a 20% cut is less than £36,000 / month.');
  });
  // ⛔ AIQ 5895590866 (3) nit: Olumi's level still feeds the model after the target becomes a LEVEL, or goes: the lead alone.
  it.each<[string, Record<string, unknown>]>([
    ['the target edited to a LEVEL frame (£30,000)', { goal_threshold_frame: 'level', goal_threshold_raw: 30000, goal_threshold: 30000 }],
    ['the target removed', { goal_threshold_frame: undefined, goal_threshold_raw: undefined, goal_threshold: undefined }],
  ])('%s → the reading still speaks, the lead alone', async (_why, over) => {
    const g = await saved();
    expect(node(g, over)).toBe('Olumi reads your ‘£45k’ (‘Monthly spend is £45k’) as today\'s level of ‘costs’.');
  });
});
