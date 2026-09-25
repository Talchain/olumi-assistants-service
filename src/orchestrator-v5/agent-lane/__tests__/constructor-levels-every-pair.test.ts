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
    goal: { metric: 'Delivery velocity', operator: '>=', target_stated: false, value: null, unit: 'points per sprint', horizon_months: null, provenance: 'explicit' },
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

  it('CONTROL: a retry that covers less is not adopted', async () => {
    const worse = c22();
    worse.options[2] = { ...worse.options[2]!, changes: [...worse.options[2]!.changes, 'Onboarding load'] };
    const { graph, inputs } = await construct(c22(), worse);
    expect(inputs).toHaveLength(2);
    // The first draft is kept: "Hire Both" does not act on Onboarding load.
    expect(graph.edges.some((e) => e.from === 'hire_both' && e.to === 'onboarding_load')).toBe(false);
  });

  it('CONTROL: a retry that covers every pair by dropping an option is not adopted', async () => {
    const dropped = covered();
    dropped.options = dropped.options.filter((o) => o.label !== 'Hire Both');
    const { graph } = await construct(c22(), dropped);
    expect(graph.nodes.some((n) => n.id === 'hire_both')).toBe(true);
  });

  it('RED: the contract asks for a level per pair and keeps `changes` for a factor with no defensible level only', () => {
    expect(BUILD_INSTRUCTIONS).toContain('EVERY FACTOR IT ACTS ON NEEDS A LEVEL');
    expect(BUILD_INSTRUCTIONS).not.toContain('WITHOUT a stated level');
    const changes = JSON.stringify((buildCandidateSchema() as { properties: { options: { items: { properties: { changes: unknown } } } } })
      .properties.options.items.properties.changes);
    expect(changes).not.toContain('when it states no level');
    expect(changes).toContain('no defensible level');
  });
});
