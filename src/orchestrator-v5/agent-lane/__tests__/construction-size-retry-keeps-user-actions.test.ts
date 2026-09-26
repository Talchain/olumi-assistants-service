/**
 * ⛔ A COMPACTION MAY SHED WHAT THE MODEL ADDED — NEVER WHAT A USER'S OPTION DOES.
 * ⛔ AND A COMPACTION THAT ALSO REPAIRS STILL EDITS ITS OWN FIRST DRAFT.
 *
 * Two defects in #1891's delta over #1898 (MG prep, clone mg-1891-prep @ 2eb1b5c4):
 *
 * (1) WRONG ADOPT. The adoption test read `(needsSizeRetry || keepsEveryAction(...))`, so on EVERY size retry
 *     the "a repair may add what an option does, never take it away" guard (pre-review 5828705574) was skipped.
 *     A retry that shrank the model AND deleted a user-stated option's `changes` was adopted: "Hire Two
 *     Developers" registered with no edges and was listed in `options_that_change_nothing` — coverage gaps
 *     closed by deletion. A size retry is told to remove only the items it ADDED and to copy every kept item
 *     exactly (#1898), so for every option the retry KEEPS — the user's, and a model-added one it did not shed
 *     (pre-review 5828705574's own case was the model-added "Hire Both") — each factor it acted on that the
 *     retry still has must still be acted on (through `changes`, a level, or a directed link), and it may not
 *     be left inert. An option the model added may still be shed whole (a user's may not: #1710's identity
 *     check), an action may go with a factor the retry shed, and the declared status quo is held, not set.
 *     A retry that fails this is not adopted, so the oversized first draft stands and the build is REFUSED
 *     `model_too_large` (the existing policy for an unadoptable size retry) — nothing is written.
 *
 * (2) LOST COPY RULE. The edit-own-draft instruction (`SIZE_RETRY_EDITS_FIRST_DRAFT`, measured 0/8 → 8/8
 *     identity-keeping in construction-size-retry-edits-first-draft.test.ts) was sent only when there was NO
 *     repair issue. With #1891's coverage gaps now repair issues, an OVERSIZED draft with a gap took the repair
 *     branch without it. It now carries both: the repair instructions and the copy-exactly rule.
 *
 * Every draft is validated against the REAL strict schema (the retry against the goal-pinned retry schema),
 * served through `buildModelFromBrief` → `/graph/register` → `GraphV3`, and read back by node id; readiness is
 * the authority on what the registered model still asks.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { BUILD_INSTRUCTIONS, buildCandidateSchema, buildModelFromBrief, prepareProvisionalCandidate, retrySchemaPinningGoal } from '../runtime/build-model.js';
import type { CandidateModel } from '../admit-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { COMPACT_LIMITS } from '../construction-size-gate.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Iv = { factor_label: string; value: number; value_kind: 'absolute' | 'additional'; unit: string; provenance: string };
type Opt = { label: string; provenance: string; is_status_quo: boolean | null; changes: string[]; interventions: Iv[] };
type Link = { from: string; to: string; direction: 'positive' | 'negative' | 'unknown'; provenance: string };

const SCENARIO = '66666666-6666-4666-8666-666666666666';
const BRIEF = 'Should we hire two developers or a tech lead to lift delivery velocity?';
const GOAL = 'Delivery velocity';

const factor = (label: string, baseline_value: number | null, plausible_max: number, unit: string) => ({
  label, role: 'controllable' as const, baseline_known: false, baseline_value, unit, provenance: 'ai_proposed', plausible_max,
});
const est = (factor_label: string, value: number, unit: string): Iv => ({ factor_label, value, value_kind: 'absolute', unit, provenance: 'ai_proposed' });

/** The served c22 shape (constructor-levels-every-pair.test.ts): two USER options, one Olumi option, a declared status quo; every lever names its factors only in `changes`. */
function c22() {
  return {
    goal: { metric: GOAL, operator: '>=', target_stated: false, value: null, unit: 'points per sprint', horizon_months: null, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit' },
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
    risks: [] as { label: string; provenance: string }[],
    outcomes: [] as { label: string; provenance: string }[],
    links: [
      { from: 'Engineering delivery capacity', to: GOAL, direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Technical leadership capacity', to: GOAL, direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Team morale', to: GOAL, direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Onboarding load', to: GOAL, direction: 'negative', provenance: 'ai_proposed' },
    ] as Link[],
    unknowns: [] as string[],
  };
}
type Draft = ReturnType<typeof c22>;

/** A compliant, compact draft: every lever × factor it acts on carries an estimated level, both baselines estimated. */
function covered(): Draft {
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

/** Olumi's own widening: model-added factors, each wired to the goal. Nine of them take a c22-sized model past the node limit. */
const SPECULATIVE = Array.from({ length: 9 }, (_, i) => `Speculative factor ${i}`);
function oversized(d: Draft): Draft {
  d.factors.push(...SPECULATIVE.map((l) => factor(l, 5, 10, 'score')));
  d.links.push(...SPECULATIVE.map((l): Link => ({ from: l, to: GOAL, direction: 'positive', provenance: 'ai_proposed' })));
  return d;
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Graph = { nodes: Array<Record<string, unknown> & { id: string; kind: string }>; edges: Array<{ from: string; to: string }> };
type Req = { instructions: string; input: string };

async function construct(first: Draft, retry?: Draft) {
  expect(strict(first), JSON.stringify(strict.errors)).toBe(true);
  if (retry !== undefined) {
    const pinned = new Ajv({ strict: false }).compile(retrySchemaPinningGoal(first.goal as unknown as CandidateModel['goal']));
    expect(pinned(retry), JSON.stringify(pinned.errors)).toBe(true);
  }
  const drafts = retry === undefined ? [first] : [first, retry];
  let body: unknown;
  const registered: string[] = [];
  const reqs: Req[] = [];
  const dispatch: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      registered.push(path);
      body = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const result = await buildModelFromBrief(SCENARIO, BRIEF, dispatch, async (req) => {
    reqs.push({ instructions: req.instructions, input: req.input });
    return { text: JSON.stringify(drafts[Math.min(reqs.length - 1, drafts.length - 1)]) };
  }) as Record<string, unknown>;
  const graph = body === undefined ? undefined : GraphV3.parse(body) as unknown as Graph;
  return { result, graph, reqs, registered };
}

const actsOn = (g: Graph, option: string) => g.edges.filter((e) => e.from === option).map((e) => e.to).sort();
const missingValues = (g: Graph) =>
  assessCanonicalAnalysisReadiness(g).blockingIssues.filter((i) => i.code === 'MISSING_OPTION_VALUE').map((i) => i.message);

/** The unadoptable-retry outcome, stated in full: the oversized first draft stands, so the build is refused and NOTHING is registered. */
function expectRefusedNotAdopted(out: Awaited<ReturnType<typeof construct>>) {
  expect(out.reqs, 'the one bounded retry was spent').toHaveLength(2);
  expect(out.result.ok).toBe(false);
  expect(out.result.refusal).toBe('model_too_large');
  expect(out.result.retried).toBe(true);
  expect(Number(out.result.nodes)).toBeGreaterThan(COMPACT_LIMITS.maxNodes);
  expect(out.registered, 'nothing written').toEqual([]);
  expect(out.graph).toBeUndefined();
}

describe('(1) a size retry may shed what the model added, never what a kept option does', () => {
  it('PRECONDITIONS: the combined first draft is oversized WITH coverage gaps; the size-only first draft is oversized with none', async () => {
    const combined = prepareProvisionalCandidate(oversized(c22()) as unknown as CandidateModel);
    expect(combined.level_gaps.length).toBeGreaterThan(0);
    const sizeOnly = prepareProvisionalCandidate(oversized(covered()) as unknown as CandidateModel);
    expect([...sizeOnly.mechanism_issues, ...sizeOnly.level_gaps, ...sizeOnly.baseline_gaps]).toEqual([]);
    // Both really are oversized: an unadoptable retry leaves the first draft, which is refused.
    for (const first of [oversized(c22()), oversized(covered())]) {
      const out = await construct(first, first);
      expect(out.result.refusal).toBe('model_too_large');
    }
  });

  // ── The defect, every carrier and position ──────────────────────────────────────────────────────────

  it.each<[number, string]>([
    [0, 'Hire Two Developers'],
    [1, 'Hire a Tech Lead'],
  ])('RED (combined branch, `changes` carrier): a retry that shrinks AND strips user option #%i (%s) to nothing is NOT adopted', async (at) => {
    const retry = covered();
    retry.options[at] = { ...retry.options[at]!, changes: [], interventions: [] };
    expectRefusedNotAdopted(await construct(oversized(c22()), retry));
  });

  it('RED (combined branch): a retry that deletes ONE action of a user option on a factor it still has ("Hiring cost") is NOT adopted', async () => {
    const retry = covered();
    retry.options[0] = { ...retry.options[0]!, interventions: [est('Engineering delivery capacity', 52, 'story points')] };
    expect(retry.factors.some((f) => f.label === 'Hiring cost'), 'PRECONDITION: the factor survives the retry').toBe(true);
    expectRefusedNotAdopted(await construct(oversized(c22()), retry));
  });

  /** The user option acts on "Engineering delivery capacity" through a directed LINK only (a level gap). */
  function linkCarrier(): Draft {
    const d = oversized(c22());
    d.options[0] = { ...d.options[0]!, changes: ['Hiring cost'] };
    d.links.push({ from: 'Hire Two Developers', to: 'Engineering delivery capacity', direction: 'positive', provenance: 'ai_proposed' });
    return d;
  }
  it.each<[string, 'unknown' | null]>([
    ['deletes the link', null],
    ['turns the link direction-unknown (withheld by admission)', 'unknown' as const],
  ])('RED (combined branch, link carrier): a retry that %s is NOT adopted', async (_arm, direction) => {
    expect(prepareProvisionalCandidate(linkCarrier() as unknown as CandidateModel).level_gaps)
      .toContainEqual({ option: 'Hire Two Developers', factor: 'Engineering delivery capacity' });
    const retry = covered();
    retry.options[0] = { ...retry.options[0]!, interventions: [est('Hiring cost', 140000, 'GBP')] };
    if (direction !== null) retry.links.push({ from: 'Hire Two Developers', to: 'Engineering delivery capacity', direction, provenance: 'ai_proposed' });
    expectRefusedNotAdopted(await construct(linkCarrier(), retry));
  });

  it.each<[number, string]>([
    [0, 'Hire Two Developers'],
    [1, 'Hire a Tech Lead'],
  ])('RED (size-only branch, `interventions` carrier): a compaction that strips user option #%i (%s) of its levels is NOT adopted', async (at) => {
    const retry = covered();
    retry.options[at] = { ...retry.options[at]!, interventions: [] };
    expectRefusedNotAdopted(await construct(oversized(covered()), retry));
  });

  it('RED (size-only branch): a compaction that drops ONE level of a user option on a factor it still has is NOT adopted', async () => {
    const retry = covered();
    retry.options[1] = { ...retry.options[1]!, interventions: [est('Technical leadership capacity', 1.5, 'FTE')] };
    expectRefusedNotAdopted(await construct(oversized(covered()), retry));
  });

  it('RED (same class): a factor kept under another spelling ("hiring  COST" — one entity to admission) is not "shed", so dropping the user option\'s action on it is NOT adopted', async () => {
    const respelled = (d: Draft): Draft => JSON.parse(JSON.stringify(d).replaceAll('"Hiring cost"', '"hiring  COST"')) as Draft;
    const retry = respelled(covered());
    retry.options[0] = { ...retry.options[0]!, interventions: [est('Engineering delivery capacity', 52, 'story points')] };
    expectRefusedNotAdopted(await construct(oversized(covered()), retry));
  });

  it('RED (same class): a user option whose ONLY factor was shed may not be left changing nothing', async () => {
    const first = oversized(covered());
    first.options[1] = { ...first.options[1]!, interventions: [est('Speculative factor 0', 7, 'score')] };
    const retry = covered();
    retry.options[1] = { ...retry.options[1]!, interventions: [] };
    expectRefusedNotAdopted(await construct(first, retry));
  });

  it('RED (combined branch, pre-review 5828705574\'s own case): a compaction that KEEPS the model-added "Hire Both" but strips its actions is NOT adopted', async () => {
    const retry = covered();
    retry.options[2] = { ...retry.options[2]!, interventions: [] };
    expectRefusedNotAdopted(await construct(oversized(c22()), retry));
  });

  it('RED (size-only branch): a compaction that KEEPS the model-added "Hire Both" but drops its action on a factor still there is NOT adopted', async () => {
    const retry = covered();
    retry.options[2] = { ...retry.options[2]!, interventions: retry.options[2]!.interventions.filter((i) => i.factor_label !== 'Hiring cost') };
    expectRefusedNotAdopted(await construct(oversized(covered()), retry));
  });

  // ── Controls: legitimate compaction is still adopted ────────────────────────────────────────────────

  it('CONTROL (#1873 B2): the declared status quo is held, not set — a compaction that empties a status quo which listed changes IS adopted', async () => {
    const first = oversized(covered());
    first.options[3] = { ...first.options[3]!, changes: ['Team morale'] };
    const { result, graph } = await construct(first, covered());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.size_retried).toBe(true);
    // The RETRY was registered: the held status quo is wired (by admission) to what the levers act on, not to the
    // first draft's "Team morale" — and it is held at today's levels, never given a level of its own.
    expect(actsOn(graph!, 'continue_current_staffing')).toEqual(['engineering_delivery_capacity', 'hiring_cost', 'technical_leadership_capacity']);
    const statusQuo = graph!.nodes.find((n) => n.id === 'continue_current_staffing');
    expect(statusQuo?.is_baseline).toBe(true);
    expect(statusQuo).not.toHaveProperty('interventions');
  });

  it('CONTROL (size-only branch): a compaction that sheds a MODEL-ADDED option ("Hire Both") IS adopted — both user options still act on every factor they did', async () => {
    const retry = covered();
    retry.options = retry.options.filter((o) => o.label !== 'Hire Both');
    const { result, graph } = await construct(oversized(covered()), retry);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.size_retried).toBe(true);
    expect(result.within_compact_limits).toBe(true);
    expect(graph!.nodes.some((n) => n.id === 'hire_both')).toBe(false);
    expect(actsOn(graph!, 'hire_two_developers')).toEqual(['engineering_delivery_capacity', 'hiring_cost']);
    expect(actsOn(graph!, 'hire_a_tech_lead')).toEqual(['hiring_cost', 'technical_leadership_capacity']);
    expect(result.options_that_change_nothing).toEqual([]);
    expect(missingValues(graph!)).toEqual([]);
    expect((result.left_out_to_stay_compact as { label: string }[]).map((x) => x.label)).toContain('Hire Both');
  });

  it('CONTROL (combined branch): a compaction that sheds a MODEL-ADDED factor a user option acted on IS adopted — the action goes with the factor', async () => {
    const first = oversized(c22());
    first.options[0] = { ...first.options[0]!, changes: [...first.options[0]!.changes, 'Speculative factor 0'] };
    const { result, graph } = await construct(first, covered());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.size_retried).toBe(true);
    expect(graph!.nodes.some((n) => n.id === 'speculative_factor_0')).toBe(false);
    expect(actsOn(graph!, 'hire_two_developers')).toEqual(['engineering_delivery_capacity', 'hiring_cost']);
    expect(result.options_that_change_nothing).toEqual([]);
    expect(missingValues(graph!)).toEqual([]);
  });

  it('CONTROL (combined branch): a compaction that keeps every action and adds the levels IS adopted, every lever levelled by id', async () => {
    const { result, graph } = await construct(oversized(c22()), covered());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.size_retried).toBe(true);
    const levels = (id: string) => Object.keys((graph!.nodes.find((n) => n.id === id) as { interventions?: object }).interventions ?? {}).sort();
    expect(levels('hire_two_developers')).toEqual(['engineering_delivery_capacity', 'hiring_cost']);
    expect(levels('hire_a_tech_lead')).toEqual(['hiring_cost', 'technical_leadership_capacity']);
    expect(levels('hire_both')).toEqual(['engineering_delivery_capacity', 'hiring_cost', 'technical_leadership_capacity']);
    expect(missingValues(graph!)).toEqual([]);
  });
});

describe('(2) an OVERSIZED draft with a repair issue gets the repair instructions AND the copy-exactly rule', () => {
  const COPY_RULE = /Return your previous model with only the items you ADDED beyond the brief removed\. Copy every item you keep EXACTLY as it is in your previous model: the same label, wording, provenance and relationships\. Do not rename, merge, reword or re-add anything\./;
  const REPAIR_RULE = /Repair only the listed construction issues\. Preserve every option and risk hypothesis, its causal direction and path to the goal; do not delete them to clear validation\./;
  const BUDGET = `The limit is ${COMPACT_LIMITS.maxNodes} nodes and ${COMPACT_LIMITS.maxEdges} links.`;
  const ONLY_REPAIRS = 'The only other change allowed is the repair each listed construction issue asks for, made in place on the item it names.';

  const withMechanismIssue = (): Draft => {
    const d = oversized(covered());
    d.risks.push({ label: 'Delivery slip', provenance: 'ai_proposed' });
    d.links.push(
      { from: 'Hire Two Developers', to: 'Delivery slip', direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Delivery slip', to: GOAL, direction: 'negative', provenance: 'ai_proposed' },
    );
    return d;
  };
  const withBaselineGap = (): Draft => {
    const d = oversized(covered());
    d.factors[0] = factor('Engineering delivery capacity', null, 100, 'story points');
    return d;
  };

  it.each<[string, () => Draft, string]>([
    ['a level gap', () => oversized(c22()), 'Hire Two Developers -> Engineering delivery capacity: give the level'],
    ['a baseline gap', withBaselineGap, 'Engineering delivery capacity: give a baseline_value'],
    ['a missing risk mechanism', withMechanismIssue, 'Hire Two Developers -> Delivery slip: retain this risk hypothesis'],
  ])('RED: with %s, the ONE retry carries the budget, the copy-exactly rule, the repair rule and the issue, on the first draft', async (_arm, draft, issue) => {
    const first = draft();
    const { reqs, result } = await construct(first, first);
    expect(result.refusal ?? result.size_retried, 'PRECONDITION: the draft was oversized').toBeTruthy();
    expect(reqs).toHaveLength(2);
    const retry = reqs[1]!;
    expect(retry.instructions).toContain(BUDGET);
    expect(retry.instructions).toMatch(COPY_RULE);
    // The copy rule, then the one exception it allows, then the repair instructions — in that order.
    expect(retry.instructions).toContain(ONLY_REPAIRS);
    expect(retry.instructions.indexOf(ONLY_REPAIRS)).toBeGreaterThan(retry.instructions.search(COPY_RULE));
    expect(retry.instructions).toMatch(REPAIR_RULE);
    expect(retry.input.startsWith(BRIEF)).toBe(true);
    expect(retry.input).toContain(issue);
    expect(retry.input, 'the first draft itself, so kept items can be copied').toContain(JSON.stringify(first));
    expect(retry.input, 'named as the model the copy rule means').toContain(`Candidate to repair (your previous model, to shrink): ${JSON.stringify(first)}`);
  });

  it('CONTROL: a repair-only retry (within size) is NOT told to remove what it added, and carries no budget', async () => {
    const { reqs } = await construct(c22(), covered());
    expect(reqs).toHaveLength(2);
    expect(reqs[1]!.instructions).toMatch(REPAIR_RULE);
    expect(reqs[1]!.instructions).not.toMatch(COPY_RULE);
    expect(reqs[1]!.instructions).not.toContain(BUDGET);
    expect(reqs[1]!.instructions).not.toContain(ONLY_REPAIRS);
    expect(reqs[1]!.input).toContain(`Candidate to repair: ${JSON.stringify(c22())}`);
    // Byte for byte what it was before this delta: a within-size repair is not a compaction.
    expect(reqs[1]!.instructions).toBe(`${BUILD_INSTRUCTIONS}  Repair only the listed construction issues. Preserve every option and risk hypothesis, its causal direction and path to the goal; do not delete them to clear validation.`);
  });

  it('CONTROL: a size-only retry carries the copy-exactly rule and NO repair rule', async () => {
    const { reqs } = await construct(oversized(covered()), covered());
    expect(reqs).toHaveLength(2);
    expect(reqs[1]!.instructions).toMatch(COPY_RULE);
    expect(reqs[1]!.instructions).not.toMatch(REPAIR_RULE);
    expect(reqs[1]!.input).toContain('Your previous model, to shrink: ');
  });
});
