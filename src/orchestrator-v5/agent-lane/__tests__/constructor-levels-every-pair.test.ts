/**
 * ⛔ A FIRST MODEL MUST CARRY A LEVEL FOR EVERY OPTION × FACTOR IT ACTS ON.
 *
 * Served CEE e39f6e0, witness c22 (scenario 32edf657-…): the hiring build left two
 * of five factors with no baseline ("Engineering delivery capacity", "Technical
 * leadership capacity") and every option with no level at all — each lever named
 * its factors only in `changes`. Readiness raised a `MISSING_OPTION_VALUE` for
 * every pair and no automatic first analysis ran. That draft was fully INSIDE the
 * constructor's contract: `changes` was described as "the factors this option
 * changes when it states no level", the instructions asked for them "WITHOUT a
 * stated level", and nothing asked for an estimated level per pair.
 *
 * The contract now asks for one — the user's number where stated, otherwise
 * Olumi's `ai_proposed` estimate on the factor's frame — and the first pass's
 * uncovered pairs (and the baselines of factors an option acts on) go to the ONE
 * existing repair retry. What the fix must never do:
 *  · give the declared status quo a level (#1873 B2 — it is held, not set);
 *  · spend a retry on, or invent a total for, a user's addition whose baseline is
 *    unknown (#1841 B1 — that figure is the user's to give);
 *  · stamp an estimate as the user's (levels stay `cee_hypothesis`, baselines
 *    `cee_inference`, nothing `user_specified`);
 *  · adopt a retry that covers less, or drops an option.
 *
 * Every candidate is validated against the REAL strict construction schema and
 * served through `buildModelFromBrief` → `/graph/register` → `GraphV3`; readiness
 * is the authority. Assertions name options and factors by id.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { BUILD_INSTRUCTIONS, buildCandidateSchema, buildModelFromBrief, prepareProvisionalCandidate } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Iv = { factor_label: string; value: number; value_kind: 'absolute' | 'additional'; unit: string; provenance: string };
type Opt = { label: string; provenance: string; is_status_quo: boolean | null; changes: string[]; interventions: Iv[] };

const factor = (label: string, baseline_value: number | null, plausible_max: number, unit: string) => ({
  label, role: 'controllable' as const, baseline_known: false, baseline_value, unit, provenance: 'ai_proposed', plausible_max,
});

/** The served c22 shape: three levers that name their factors only in `changes`, two unset baselines, a declared status quo. */
function c22() {
  return {
    // The goal's current level (#1840) is REQUIRED by the strict schema; c22 stated none.
    goal: { metric: 'Delivery velocity', operator: '>=', target_stated: false, value: null, unit: 'points per sprint', horizon_months: null, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hire Two Developers', provenance: 'explicit', is_status_quo: null, changes: ['Engineering delivery capacity', 'Hiring cost'], interventions: [] },
      { label: 'Hire a Tech Lead', provenance: 'explicit', is_status_quo: null, changes: ['Technical leadership capacity', 'Hiring cost'], interventions: [] },
      { label: 'Hire Both', provenance: 'ai_proposed', is_status_quo: null, changes: ['Engineering delivery capacity', 'Technical leadership capacity', 'Hiring cost'], interventions: [] },
      { label: 'Continue Current Staffing', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
    ] as Opt[],
    factors: [
      factor('Engineering delivery capacity', null, 100, 'story points'),
      factor('Technical leadership capacity', null, 5, 'FTE'),
      factor('Hiring cost', 0, 500000, 'GBP'),
      factor('Team morale', 6, 10, 'score'),
      factor('Onboarding load', 1, 10, 'score'),
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Engineering delivery capacity', to: 'Delivery velocity', direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Technical leadership capacity', to: 'Delivery velocity', direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Team morale', to: 'Delivery velocity', direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Onboarding load', to: 'Delivery velocity', direction: 'negative', provenance: 'ai_proposed' },
    ],
    unknowns: [] as string[],
  };
}

const est = (factor_label: string, value: number, unit: string): Iv => ({ factor_label, value, value_kind: 'absolute', unit, provenance: 'ai_proposed' });

/** What a compliant retry returns: every lever × factor it acts on carries an estimated level; both baselines are estimated. */
function covered() {
  const c = c22();
  c.factors[0] = factor('Engineering delivery capacity', 40, 100, 'story points');
  c.factors[1] = factor('Technical leadership capacity', 0.5, 5, 'FTE');
  c.options[0] = { ...c.options[0]!, changes: [], interventions: [est('Engineering delivery capacity', 52, 'story points'), est('Hiring cost', 140000, 'GBP')] };
  c.options[1] = { ...c.options[1]!, changes: [], interventions: [est('Technical leadership capacity', 1.5, 'FTE'), est('Hiring cost', 110000, 'GBP')] };
  c.options[2] = { ...c.options[2]!, changes: [], interventions: [
    est('Engineering delivery capacity', 55, 'story points'), est('Technical leadership capacity', 1.5, 'FTE'), est('Hiring cost', 250000, 'GBP'),
  ] };
  return c;
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Graph = { nodes: Array<Record<string, unknown> & { id: string; kind: string }>; edges: Array<{ from: string; to: string }> };

async function construct(...drafts: ReturnType<typeof c22>[]) {
  for (const d of drafts) expect(strict(d), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown;
  const inputs: string[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const result = await buildModelFromBrief('32edf657-e3f7-44a5-b80a-ec6a4e00d149',
    'Should we hire two developers or a tech lead to lift delivery velocity?', dispatch,
    async (req) => {
      inputs.push(String((req as { input: unknown }).input));
      return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
    }) as Record<string, unknown>;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { result, graph: GraphV3.parse(graph) as unknown as Graph, inputs };
}

const missingValues = (g: Graph) =>
  assessCanonicalAnalysisReadiness(g).blockingIssues.filter((i) => i.code === 'MISSING_OPTION_VALUE').map((i) => i.message).sort();
const node = (g: Graph, id: string) => {
  const n = g.nodes.find((x) => x.id === id);
  expect(n, `node ${id}`).toBeDefined();
  return n as Record<string, unknown> & { interventions?: Record<string, { value: number; source: string }>; observed_state?: Record<string, unknown> };
};
const LEVERS = { hire_two_developers: ['engineering_delivery_capacity', 'hiring_cost'], hire_a_tech_lead: ['technical_leadership_capacity', 'hiring_cost'], hire_both: ['engineering_delivery_capacity', 'technical_leadership_capacity', 'hiring_cost'] } as const;

describe('the constructor gives every option × factor it acts on a level (c22)', () => {
  it('baseline (the served failure, reproduced): the c22 draft alone leaves a value question for every lever × factor', async () => {
    // A retry that returns the same draft cannot help, so this is the served outcome.
    const { graph } = await construct(c22(), c22());
    expect(missingValues(graph)).toHaveLength(7);
  });

  it('RED: preparation names every uncovered lever × factor and every unset baseline an option acts on — by identity, never the status quo', () => {
    const p = prepareProvisionalCandidate(c22() as unknown as CandidateModel) as ReturnType<typeof prepareProvisionalCandidate> & {
      level_gaps?: { option: string; factor: string }[]; baseline_gaps?: { factor: string }[];
    };
    expect(p.level_gaps).toEqual([
      { option: 'Hire Two Developers', factor: 'Engineering delivery capacity' },
      { option: 'Hire Two Developers', factor: 'Hiring cost' },
      { option: 'Hire a Tech Lead', factor: 'Technical leadership capacity' },
      { option: 'Hire a Tech Lead', factor: 'Hiring cost' },
      { option: 'Hire Both', factor: 'Engineering delivery capacity' },
      { option: 'Hire Both', factor: 'Technical leadership capacity' },
      { option: 'Hire Both', factor: 'Hiring cost' },
    ]);
    expect(p.baseline_gaps).toEqual([{ factor: 'Engineering delivery capacity' }, { factor: 'Technical leadership capacity' }]);
    expect(JSON.stringify(p.level_gaps)).not.toContain('Continue Current Staffing');
  });

  it('RED: the uncovered pairs go to the one repair retry, which is adopted — every lever sets every factor it acts on, and readiness asks no value question', async () => {
    const { graph, inputs } = await construct(c22(), covered());
    expect(inputs).toHaveLength(2);
    for (const [option, factor] of [['Hire Two Developers', 'Engineering delivery capacity'], ['Hire Both', 'Technical leadership capacity']]) {
      expect(inputs[1]).toContain(`${option} -> ${factor}`);
    }
    expect(inputs[1]).toContain('Engineering delivery capacity: ');
    for (const [option, factors] of Object.entries(LEVERS)) {
      expect(Object.keys(node(graph, option).interventions ?? {}).sort()).toEqual([...factors].sort());
    }
    expect(missingValues(graph)).toEqual([]);
  });

  it('RED: nothing constructed is the user\'s — levels stay cee_hypothesis, estimated baselines cee_inference', async () => {
    const { graph } = await construct(c22(), covered());
    for (const [option, factors] of Object.entries(LEVERS)) {
      for (const f of factors) expect(node(graph, option).interventions?.[f]?.source, `${option}.${f}`).toBe('cee_hypothesis');
    }
    for (const f of ['engineering_delivery_capacity', 'technical_leadership_capacity']) {
      expect(node(graph, f).observed_state).toMatchObject({ source: 'cee_inference' });
    }
    expect(JSON.stringify(graph.nodes)).not.toMatch(/user_specified|user_override|user_stated/);
  });

  it('CONTROL (#1873 B2): the declared status quo is never given a level, before or after the retry', async () => {
    const { graph, inputs } = await construct(c22(), covered());
    expect(inputs[1]).not.toContain('Continue Current Staffing ->');
    expect(node(graph, 'continue_current_staffing')).not.toHaveProperty('interventions');
    expect(node(graph, 'continue_current_staffing').is_baseline).toBe(true);
  });

  it('CONTROL (#1873 B2): even a flagged status quo that lists changes is never asked for a level', async () => {
    const c = c22();
    c.options[3] = { ...c.options[3]!, changes: ['Team morale'] };
    const p = prepareProvisionalCandidate(c as unknown as CandidateModel);
    expect(p.level_gaps.filter((g) => g.option === 'Continue Current Staffing')).toEqual([]);
    const { inputs } = await construct(c, covered());
    expect(inputs[1]).not.toContain('Continue Current Staffing ->');
  });

  /**
   * Pre-review 5828364580: an option can act on a factor through `links` alone
   * (`Hire Two Developers -> Engineering capacity`), repeated in neither `changes`
   * nor `interventions`. Admission admits that option→factor edge, so readiness
   * asks for its level — the gap check must see the same pair.
   */
  function linkedOnly() {
    const c = c22();
    c.factors = [factor('Engineering capacity', 40, 100, 'story points')];
    c.options = [
      { label: 'Hire Two Developers', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [] },
      { label: 'Continue Current Staffing', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
    ];
    c.links = [
      { from: 'Hire Two Developers', to: 'Engineering capacity', direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Engineering capacity', to: 'Delivery velocity', direction: 'positive', provenance: 'ai_proposed' },
    ];
    return c;
  }

  it('RED (pre-review 5828364580): an option acting on a factor through `links` ALONE is a level gap, and the retry is spent on it', async () => {
    const p = prepareProvisionalCandidate(linkedOnly() as unknown as CandidateModel);
    expect(p.level_gaps).toEqual([{ option: 'Hire Two Developers', factor: 'Engineering capacity' }]);
    const levelled = linkedOnly();
    levelled.options[0] = { ...levelled.options[0]!, interventions: [est('Engineering capacity', 52, 'story points')] };
    const { graph, inputs } = await construct(linkedOnly(), levelled);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain('Hire Two Developers -> Engineering capacity');
    expect(Object.keys(node(graph, 'hire_two_developers').interventions ?? {})).toEqual(['engineering_capacity']);
    expect(missingValues(graph)).toEqual([]);
  });

  it('CONTROL: a direction-unknown option→factor link (withheld by admission) is no level gap', () => {
    const c = linkedOnly();
    c.links[0] = { ...c.links[0]!, direction: 'unknown' };
    expect(prepareProvisionalCandidate(c as unknown as CandidateModel).level_gaps).toEqual([]);
  });

  it('CONTROL: a status quo linked to a factor through `links` is still never asked for a level', () => {
    const c = linkedOnly();
    c.links.push({ from: 'Continue Current Staffing', to: 'Engineering capacity', direction: 'positive', provenance: 'ai_proposed' });
    expect(prepareProvisionalCandidate(c as unknown as CandidateModel).level_gaps.filter((g) => g.option === 'Continue Current Staffing')).toEqual([]);
  });

  it('CONTROL (#1841 B1): a user addition on an unknown baseline still degrades — no retry, no invented total, no baseline asked for', async () => {
    const c = c22();
    c.factors = [factor('Developers', null, 50, 'people'), factor('Hiring cost', 0, 500000, 'GBP')];
    c.links = [{ from: 'Developers', to: 'Delivery velocity', direction: 'positive', provenance: 'ai_proposed' }];
    c.options = [
      { label: 'Hire Two Developers', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [{ factor_label: 'Developers', value: 2, value_kind: 'additional', unit: 'people', provenance: 'explicit' }] },
      { label: 'Continue Current Staffing', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
    ];
    const p = prepareProvisionalCandidate(c as unknown as CandidateModel) as ReturnType<typeof prepareProvisionalCandidate> & { level_gaps?: unknown[]; baseline_gaps?: unknown[] };
    expect(p.additions_without_total).toEqual([expect.objectContaining({ option: 'Hire Two Developers', factor: 'Developers', reason: 'baseline_unknown' })]);
    expect(p.level_gaps).toEqual([]);
    expect(p.baseline_gaps).toEqual([]);
    const { graph, inputs } = await construct(c);
    expect(inputs).toHaveLength(1);
    expect(node(graph, 'hire_two_developers').interventions ?? {}).not.toHaveProperty('developers');
  });

  it('CONTROL: a fully covered first draft spends no retry', async () => {
    const { inputs } = await construct(covered());
    expect(inputs).toHaveLength(1);
  });

  it('RED (pre-review 5828705574): a retry that "closes" gaps by DELETING an option\'s actions is not adopted', async () => {
    const stripped = c22();
    stripped.options[2] = { ...stripped.options[2]!, changes: [] };
    const { graph, inputs, result } = await construct(c22(), stripped);
    expect(inputs).toHaveLength(2);
    // The first draft is kept: "Hire Both" still acts on all three factors, and is not left changing nothing.
    for (const f of ['engineering_delivery_capacity', 'technical_leadership_capacity', 'hiring_cost']) {
      expect(graph.edges.some((e) => e.from === 'hire_both' && e.to === f), `hire_both -> ${f}`).toBe(true);
    }
    expect((result.options_that_change_nothing ?? []) as string[]).not.toContain('Hire Both');
  });

  /**
   * Pre-review 5829011280: gaps are counted as a total, so a retry that supplies
   * the seven levels while ERASING a baseline the user stated (40 story points)
   * improved the count and was adopted. A user's number is never a repair's to drop.
   */
  const stated40 = <T extends ReturnType<typeof c22>>(c: T, baseline: number | null, known: boolean): T => {
    c.factors[0] = { ...factor('Engineering delivery capacity', baseline, 100, 'story points'), baseline_known: known, provenance: 'explicit' };
    return c;
  };

  it('RED (pre-review 5829011280): a retry that erases a user-stated baseline is not adopted, however many gaps it closes', async () => {
    const { graph, result } = await construct(stated40(c22(), 40, true), stated40(covered(), null, false));
    const capacity = node(graph, 'engineering_delivery_capacity');
    expect(capacity.observed_state).toMatchObject({ raw_value: 40, source: 'brief_extraction' });
    // The first draft was kept, so its value questions stand, honestly.
    expect(missingValues(graph).length).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
  });

  it('RED (same class): a retry that changes a level the USER stated is not adopted', async () => {
    const first = stated40(c22(), 40, true);
    first.options[0] = { ...first.options[0]!, changes: ['Hiring cost'], interventions: [{ factor_label: 'Engineering delivery capacity', value: 52, value_kind: 'absolute', unit: 'story points', provenance: 'explicit' }] };
    const retry = stated40(covered(), 40, true);
    retry.options[0] = { ...retry.options[0]!, interventions: [est('Engineering delivery capacity', 60, 'story points'), est('Hiring cost', 140000, 'GBP')] };
    const { graph } = await construct(first, retry);
    expect(node(graph, 'hire_two_developers').interventions?.engineering_delivery_capacity).toMatchObject({ value: 0.52, source: 'brief_extraction' });
  });

  /** Pre-review 5829120255: the stated 52 must survive as the REGISTERED level, and as the user's. */
  const explicit52 = { factor_label: 'Engineering delivery capacity', value: 52, value_kind: 'absolute' as const, unit: 'story points', provenance: 'explicit' };
  const first52 = () => {
    const first = stated40(c22(), 40, true);
    first.options[0] = { ...first.options[0]!, changes: ['Hiring cost'], interventions: [{ ...explicit52 }] };
    return first;
  };
  const retry52 = (levels: Iv[]) => {
    const retry = stated40(covered(), 40, true);
    retry.options[0] = { ...retry.options[0]!, interventions: [...levels, est('Hiring cost', 140000, 'GBP')] };
    return retry;
  };
  const userLevelKept = (graph: Graph) =>
    expect(node(graph, 'hire_two_developers').interventions?.engineering_delivery_capacity).toStrictEqual({ value: 0.52, source: 'brief_extraction' });

  it('RED (pre-review 5829120255 #1): the same number re-stamped ai_proposed is not adopted — authorship is part of the user\'s number', async () => {
    const { graph } = await construct(first52(), retry52([{ ...explicit52, provenance: 'ai_proposed' }]));
    userLevelKept(graph);
  });

  it.each([
    ['user 52 first, estimate 60 last', [{ ...explicit52 }, est('Engineering delivery capacity', 60, 'story points')]],
    ['estimate 60 first, user 52 last', [est('Engineering delivery capacity', 60, 'story points'), { ...explicit52 }]],
  ])('RED (pre-review 5829120255 #2): a duplicate level for the user\'s pair is not adopted, in either order (%s)', async (_order, levels) => {
    const { graph } = await construct(first52(), retry52(levels as Iv[]));
    userLevelKept(graph);
  });

  it('RED (same class): the user\'s 52 re-read as an ADDITION (so a different total, 40 + 52) is not adopted', async () => {
    const { graph } = await construct(first52(), retry52([{ ...explicit52, value_kind: 'additional' as never }]));
    userLevelKept(graph);
  });

  it('RED (same class): a user-stated baseline kept at 40 but re-stamped as Olumi\'s is not adopted', async () => {
    const retry = stated40(covered(), 40, true);
    retry.factors[0] = { ...retry.factors[0]!, provenance: 'ai_proposed' };
    const { graph } = await construct(stated40(c22(), 40, true), retry);
    expect(node(graph, 'engineering_delivery_capacity').observed_state).toMatchObject({ raw_value: 40, source: 'brief_extraction' });
  });

  /**
   * Verdict 5829152814 B1 (regression): an explicit level on an UNKNOWN baseline is
   * demoted to ai_proposed by preparation, so a guard on prepared candidates never
   * saw it — and that shape always leaves a baseline gap, so the retry always fired.
   */
  const first60 = () => {
    const first = c22();
    first.options[0] = { ...first.options[0]!, changes: ['Hiring cost'], interventions: [{ factor_label: 'Engineering delivery capacity', value: 60, value_kind: 'absolute', unit: 'story points', provenance: 'explicit' }] };
    return first;
  };
  const retryAt = (value: number, provenance: string) => {
    const retry = covered();
    retry.options[0] = { ...retry.options[0]!, interventions: [{ ...est('Engineering delivery capacity', value, 'story points'), provenance }, est('Hiring cost', 140000, 'GBP')] };
    return retry;
  };
  const saidAsYours = (result: Record<string, unknown>) => ((result.not_represented ?? []) as string[]).filter((s) => s.includes('treated your'));

  it.each([
    ['52, ai_proposed', 52, 'ai_proposed'],
    ['52, explicit', 52, 'explicit'],
  ])('RED (verdict 5829152814 B1): a retry that rewrites the user\'s demoted 60 (%s) is not adopted — the 60 is registered and said', async (_c, value, provenance) => {
    const { graph, result } = await construct(first60(), retryAt(value as number, provenance as string));
    expect(node(graph, 'hire_two_developers').interventions?.engineering_delivery_capacity?.value).toBe(0.6);
    expect(saidAsYours(result)).toEqual([expect.stringContaining('your 60')]);
  });

  it('CONTROL (B1): a retry that keeps the demoted 60 (as ai_proposed, the prepared echo) is adopted, and still says "your 60"', async () => {
    const { graph, result } = await construct(first60(), retryAt(60, 'ai_proposed'));
    expect(node(graph, 'hire_two_developers').interventions?.engineering_delivery_capacity?.value).toBe(0.6);
    expect(Object.keys(node(graph, 'hire_both').interventions ?? {}).length).toBe(3);
    expect(saidAsYours(result)).toEqual([expect.stringContaining('your 60')]);
  });

  it('RED (same class): a retry that DROPS the user\'s level but keeps the action in `changes` is not adopted', async () => {
    const retry = retry52([]);
    retry.options[0] = { ...retry.options[0]!, changes: ['Engineering delivery capacity'] };
    const { graph } = await construct(first52(), retry);
    userLevelKept(graph);
  });

  it('RED (pre-review 5829692499): a retry with a DUPLICATE option object of the same label is not adopted', async () => {
    const retry = retry52([{ ...explicit52 }]);
    retry.options.push({ ...retry.options[0]!, interventions: [est('Engineering delivery capacity', 60, 'story points')] });
    const { graph } = await construct(first52(), retry);
    userLevelKept(graph);
    expect(graph.nodes.filter((n) => n.id === 'hire_two_developers')).toHaveLength(1);
  });

  it.each(['hire two developers', 'Hire  Two Developers', ' Hire Two Developers '])(
    'RED (pre-review 5829776660): a duplicate option spelled differently (%j) — the SAME entity to admission — is not adopted',
    async (spelling) => {
      const retry = retry52([{ ...explicit52 }]);
      retry.options.push({ ...retry.options[0]!, label: spelling, interventions: [est('Engineering delivery capacity', 60, 'story points')] });
      const { graph } = await construct(first52(), retry);
      userLevelKept(graph);
    },
  );

  it('RED (same class): a duplicate factor spelled differently ("hiring  COST") is not adopted', async () => {
    const retry = covered();
    retry.factors.push(factor('hiring  COST', 999, 500000, 'GBP'));
    const { graph } = await construct(c22(), retry);
    expect(node(graph, 'hire_both')).not.toHaveProperty('interventions');
  });

  it('RED (same class): a retry with a DUPLICATE factor object of the same label is not adopted', async () => {
    const retry = covered();
    retry.factors.push(factor('Hiring cost', 999, 500000, 'GBP'));
    const { graph } = await construct(c22(), retry);
    // The first draft is kept: no retry levels were adopted.
    expect(node(graph, 'hire_both')).not.toHaveProperty('interventions');
  });

  it('CONTROL: a retry keeping exactly the one explicit 52 and filling the other pairs is adopted', async () => {
    const { graph } = await construct(first52(), retry52([{ ...explicit52 }]));
    userLevelKept(graph);
    expect(missingValues(graph)).toEqual([]);
  });

  it('CONTROL: a retry that keeps the user-stated 40 and adds the levels is adopted, with the 40 still the user\'s', async () => {
    const { graph } = await construct(stated40(c22(), 40, true), stated40(covered(), 40, true));
    expect(node(graph, 'engineering_delivery_capacity').observed_state).toMatchObject({ raw_value: 40, source: 'brief_extraction' });
    expect(Object.keys(node(graph, 'hire_both').interventions ?? {}).sort()).toEqual(['engineering_delivery_capacity', 'hiring_cost', 'technical_leadership_capacity']);
    expect(missingValues(graph)).toEqual([]);
  });

  it('CONTROL: a retry that keeps every action and adds levels is still adopted', async () => {
    const { graph } = await construct(c22(), covered());
    expect(Object.keys(node(graph, 'hire_both').interventions ?? {}).sort()).toEqual(['engineering_delivery_capacity', 'hiring_cost', 'technical_leadership_capacity']);
  });

  it('CONTROL: a retry that covers less is not adopted', async () => {
    const worse = c22();
    worse.options[2] = { ...worse.options[2]!, changes: [...worse.options[2]!.changes, 'Onboarding load'] };
    const { graph, inputs } = await construct(c22(), worse);
    expect(inputs).toHaveLength(2);
    // The first draft is kept: "Hire Both" does not act on Onboarding load.
    expect(graph.edges.some((e) => e.from === 'hire_both' && e.to === 'onboarding_load')).toBe(false);
  });

  it('CONTROL: a coverage-only retry that covers no more is not adopted, even when it rewrites something else', async () => {
    const same = c22();
    same.factors[3] = factor('Team spirit', 6, 10, 'score');
    same.links[2] = { from: 'Team spirit', to: 'Delivery velocity', direction: 'positive', provenance: 'ai_proposed' };
    const { graph, inputs } = await construct(c22(), same);
    expect(inputs).toHaveLength(2);
    expect(graph.nodes.some((n) => n.id === 'team_morale')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'team_spirit')).toBe(false);
  });

  it('CONTROL: a retry that covers every pair by dropping an option is not adopted', async () => {
    const dropped = covered();
    dropped.options = dropped.options.filter((o) => o.label !== 'Hire Both');
    const { graph } = await construct(c22(), dropped);
    expect(graph.nodes.some((n) => n.id === 'hire_both')).toBe(true);
  });

  /**
   * #1930 (signed change): admission WITHHOLDS a level below zero that it cannot restate
   * as a level relative to today (a non-percentage unit here), keeps the option acting on
   * the factor, and says so. The gap check reads the drafter's own candidate, where that
   * level is present, so the pair is no gap and no retry is spent on it: the number is the
   * user's, and a repair must not be asked to replace it. What readiness then asks is the
   * one value the user has to give — for that pair only.
   */
  const CUT = 'Contractor spend change';
  const userCut: Iv = { factor_label: CUT, value: -60000, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' };
  const withCut = (level: Iv | null) => {
    const c = covered();
    c.factors.push({ ...factor(CUT, 0, 200000, 'GBP'), baseline_known: true, provenance: 'explicit' });
    c.links.push({ from: CUT, to: 'Delivery velocity', direction: 'positive', provenance: 'ai_proposed' });
    c.options[0] = level === null
      ? { ...c.options[0]!, changes: [CUT] }
      : { ...c.options[0]!, interventions: [...c.options[0]!.interventions, level] };
    return c;
  };

  it('#1930: a withheld signed level does not trigger the coverage retry — the user\'s number is withheld and said, and readiness asks for that one value', async () => {
    const p = prepareProvisionalCandidate(withCut(userCut) as unknown as CandidateModel);
    expect([...p.level_gaps, ...p.baseline_gaps]).toEqual([]);
    const { graph, inputs, result } = await construct(withCut(userCut));
    // One model call: no retry, for this pair or any other.
    expect(inputs).toHaveLength(1);
    // Withheld, never replaced: the option still acts on the factor, with no level of its own.
    expect(graph.edges.some((e) => e.from === 'hire_two_developers' && e.to === 'contractor_spend_change')).toBe(true);
    expect(node(graph, 'hire_two_developers').interventions ?? {}).not.toHaveProperty('contractor_spend_change');
    expect(Object.keys(node(graph, 'hire_two_developers').interventions ?? {}).sort()).toEqual(['engineering_delivery_capacity', 'hiring_cost']);
    // Said, as the user's own figure, exactly once — and never re-worded as Olumi's working figure.
    const said = ((result.not_represented ?? []) as string[]);
    expect(said.filter((s) => s.startsWith(`"Hire Two Developers" puts "${CUT}" at -60000 GBP`))).toHaveLength(1);
    expect(said.filter((s) => s.includes('treated your') && s.includes(CUT))).toEqual([]);
    // Readiness asks for exactly that one pair's value, and nothing else.
    expect(missingValues(graph)).toEqual([`Factor "${CUT}" is currently £0. What should option "Hire Two Developers" set it to?`]);
  });

  it('CONTROL (#1930 test): the same pair with NO level is a gap, and the retry IS spent on it', async () => {
    const { inputs } = await construct(withCut(null), withCut(null));
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain(`Hire Two Developers -> ${CUT}`);
  });

  it('RED: the contract asks for a level per pair and keeps `changes` for a factor with no defensible level only', () => {
    expect(BUILD_INSTRUCTIONS).toContain('EVERY FACTOR IT ACTS ON NEEDS A LEVEL');
    expect(BUILD_INSTRUCTIONS).not.toContain('WITHOUT a stated level');
    const changes = JSON.stringify((buildCandidateSchema() as { properties: { options: { items: { properties: { changes: unknown } } } } })
      .properties.options.items.properties.changes);
    expect(changes).not.toContain('when it states no level');
    expect(changes).toContain('no defensible level');
  });

  /**
   * ⛔ A RETRY NEVER TAKES AWAY THE STATUS QUO THE FIRST DRAFT HELD, AND A GAP IS ANSWERED ONLY BY WHAT REGISTERS
   * (adversarial verify of e7052de7, blocking: SQ-H1..H3 on this brief). A status quo's pairs are never gaps, so a retry
   * that declares "Hire Both" or "Hire Two Developers" reads 3 or 2 fewer gaps having levelled nothing. Two declared options
   * means neither is held, and a declaration moved to an option that acts falls back to the idioms, which do not read
   * "Continue Current Staffing". Either way it registers with no edges: readiness adds OPTION_NO_FACTOR_EDGES and
   * OPTION_NEEDS_MAPPING, and every MISSING_OPTION_VALUE is still asked. Staging spends no retry here.
   */
  const declare = (d: ReturnType<typeof c22>, label: string, v: boolean | null): ReturnType<typeof c22> =>
    ({ ...d, options: d.options.map((o) => (o.label === label ? { ...o, is_status_quo: v } : o)) });
  const blockers = (g: Graph) => assessCanonicalAnalysisReadiness(g).blockingIssues.map((i) => `${i.code}: ${i.message}`);
  const gapCountOf = (d: ReturnType<typeof c22>) => {
    const p = prepareProvisionalCandidate(d as unknown as CandidateModel);
    return p.level_gaps.length + p.baseline_gaps.length;
  };
  const HELD_AGAINST = ['engineering_delivery_capacity', 'hiring_cost', 'technical_leadership_capacity'];

  it.each([
    ['SQ-H1: declares Olumi\'s "Hire Both" beside it', (d: ReturnType<typeof c22>) => declare(d, 'Hire Both', true)],
    ['SQ-H2: declares the user\'s "Hire Two Developers" beside it', (d: ReturnType<typeof c22>) => declare(d, 'Hire Two Developers', true)],
    ['SQ-H3: moves the declaration to "Hire Both"', (d: ReturnType<typeof c22>) => declare(declare(d, 'Hire Both', true), 'Continue Current Staffing', null)],
  ])('RED (%s): refused — "Continue Current Staffing" stays held, and readiness asks exactly what the first draft asks', async (_probe, edit) => {
    const retry = edit(c22());
    // Vacuity: by the drafter's words the retry covers strictly more, having levelled nothing.
    expect(gapCountOf(retry)).toBeLessThan(gapCountOf(c22()));
    const alone = await construct(c22());
    expect(node(alone.graph, 'continue_current_staffing').is_baseline).toBe(true);
    const { graph, inputs } = await construct(c22(), retry);
    expect(inputs).toHaveLength(2);
    expect(node(graph, 'continue_current_staffing').is_baseline).toBe(true);
    expect(graph.edges.filter((e) => e.from === 'continue_current_staffing').map((e) => e.to).sort()).toEqual(HELD_AGAINST);
    expect(blockers(graph)).toEqual(blockers(alone.graph));
    expect(blockers(graph).filter((b) => b.startsWith('OPTION_NO_FACTOR_EDGES') || b.startsWith('OPTION_NEEDS_MAPPING'))).toEqual([]);
  });

  it('CONTROL: where the first draft held no status quo, a retry may declare one — adopted, held and stamped', async () => {
    const first = declare(c22(), 'Continue Current Staffing', null);
    const alone = await construct(first);
    expect(blockers(alone.graph).some((b) => b.startsWith('OPTION_NO_FACTOR_EDGES'))).toBe(true);
    const { graph } = await construct(first, covered());
    expect(node(graph, 'continue_current_staffing').is_baseline).toBe(true);
    expect(missingValues(graph)).toEqual([]);
    expect(blockers(graph).filter((b) => b.startsWith('OPTION_NO_FACTOR_EDGES'))).toEqual([]);
  });

  it('RED: an ADDITION on a factor with no baseline answers neither its level nor that baseline — refused, and the +12 is never said', async () => {
    const retry = c22();
    retry.options[0] = { ...retry.options[0]!, changes: ['Hiring cost'], interventions: [{ factor_label: 'Engineering delivery capacity', value: 12, value_kind: 'additional', unit: 'story points', provenance: 'ai_proposed' }] };
    // Vacuity: by the drafter's words both the pair and the baseline are gone from the count (7 < 9); preparation makes no total.
    expect([gapCountOf(c22()), gapCountOf(retry)]).toEqual([9, 7]);
    expect(prepareProvisionalCandidate(retry as unknown as CandidateModel).additions_without_total.map((a) => [a.option, a.factor, a.reason]))
      .toEqual([['Hire Two Developers', 'Engineering delivery capacity', 'baseline_unknown']]);
    const alone = await construct(c22());
    const { graph, inputs, result } = await construct(c22(), retry);
    expect(inputs).toHaveLength(2);
    expect(result.additions_without_total).toBeUndefined();
    expect(((result.not_represented ?? []) as string[]).filter((s) => s.includes('adds 12'))).toEqual([]);
    expect(blockers(graph)).toEqual(blockers(alone.graph));
  });
});
