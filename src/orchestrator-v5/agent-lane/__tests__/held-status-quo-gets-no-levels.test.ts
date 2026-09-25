/**
 * ⛔ A HELD STATUS QUO GETS NO LEVELS — on the Agent lane too.
 *
 * Paul's ruling (MG #1838): an option that reads as carrying on as now, and says
 * nothing about what it changes, is a HELD BASELINE — each factor stays at its
 * starting value. Admission connects it to the factors the other options act on
 * with deterministic repair edges (`origin: 'repair'`, no levels), and readiness
 * already EXCLUDES those edges from its level mapping.
 *
 * RC's harm statement, which this suite pins: the Agent lane still asked for, and
 * accepted, status-quo LEVELS. "Answering the refusal writes status-quo levels; a
 * later correction then makes 'Maintain current staffing' silently model CUTTING
 * staff." Three seams let that happen, each bound here by identity:
 *   (a) `missingPairs` demanded a level for every held pair, so a complete
 *       starting point was refused `incomplete_starting_point`;
 *   (b) the level proposer accepted a level on a held pair and made it an operation;
 *   (c) `structuralFacts` listed the held option in `options_that_change_nothing`,
 *       so the Agent was told to ask what it changes;
 *   (d) the prompt told the Agent to give every option levels.
 *
 * The fixture is shaped the way #1838 mints the edges: `origin: 'repair'`, the
 * conventional repair's wording, no `interventions` on the option.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { structuralFacts } from '../structural-facts.js';
import { REPAIR_AUTHORED_ORIGIN } from '../../../graph/repair-authored-edge.js';
import { CONNECTIVITY_REPAIR_WIRING_REASON } from '../../../cee/unified-pipeline/stages/repair/status-quo-fix.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';

// Only the route-level prompt capture (d) needs these; the capability tests never touch them.
const sessionStore = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => sessionStore }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const SCENARIO = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
const USER = 'user-held';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'r' };

type Edge = { from: string; to: string; origin?: string; provenance?: Record<string, unknown>; strength?: unknown; exists_probability?: number; effect_direction?: string };
type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; scale_frame?: number; interventions?: Record<string, unknown> };

/** An ordinary (drafted or user-stated) link. */
const edge = (from: string, to: string): Edge => ({
  from, to,
  strength: { ...STRUCTURAL_EDGE_DEFAULTS.strength },
  exists_probability: STRUCTURAL_EDGE_DEFAULTS.exists_probability,
  effect_direction: STRUCTURAL_EDGE_DEFAULTS.effect_direction,
  provenance: { source: 'cee_hypothesis' },
});
/** The edge #1838's `wireInertStatusQuo` mints: `origin: 'repair'`, the repair's wording, no level. */
const held = (from: string, to: string): Edge => ({
  ...edge(from, to),
  origin: REPAIR_AUTHORED_ORIGIN,
  provenance: { source: 'cee_hypothesis', reasoning: CONNECTIVITY_REPAIR_WIRING_REASON },
});

const idOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_');

/** Paul's hiring decision, with the status quo held by repair edges to the two factors the other options set. */
function hiring(statusQuoLabel: string) {
  const SQ = idOf(statusQuoLabel);
  const nodes: Node[] = [
    { id: 'velocity', kind: 'goal', label: 'Velocity' },
    { id: 'tech_leads_hired', kind: 'factor', label: 'Tech leads hired', observed_state: { value: 0, raw_value: 0, cap: 10, unit: 'hires' } },
    { id: 'developers_hired', kind: 'factor', label: 'Developers hired', observed_state: { value: 0, raw_value: 0, cap: 20, unit: 'hires' } },
    { id: 'onboarding_workload', kind: 'factor', label: 'Onboarding workload', scale_frame: 100 },
    { id: 'hire_a_tech_lead', kind: 'option', label: 'Hire a Tech Lead' },
    { id: 'hire_two_developers', kind: 'option', label: 'Hire Two Developers' },
    { id: SQ, kind: 'option', label: statusQuoLabel },
  ];
  const edges: Edge[] = [
    edge('hire_a_tech_lead', 'tech_leads_hired'),
    edge('hire_two_developers', 'developers_hired'),
    edge('hire_two_developers', 'onboarding_workload'),
    held(SQ, 'tech_leads_hired'),
    held(SQ, 'developers_hired'),
    edge('tech_leads_hired', 'velocity'),
    edge('developers_hired', 'velocity'),
    edge('onboarding_workload', 'velocity'),
  ];
  return { SQ, nodes, edges };
}

/** The product, faked at the dispatch seam. The level write accepts any wired pair — the served rule (`linkedFactorsOf`) counts repair edges too. */
function fakeProduct(nodes0: Node[], edges: Edge[]) {
  const posted: string[] = [];
  let nodes: Node[] = nodes0.map((n) => ({ ...n, ...(n.observed_state ? { observed_state: { ...n.observed_state } } : {}) }));
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      posted.push('register');
      if (typeof b.expected_graph_hash === 'string' && b.expected_graph_hash !== `h${rev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind === 'option_intervention_edit') {
        const o = String(ev.option_id); const f = String(ev.factor_id);
        posted.push(`level ${o}::${f}`);
        if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
        if (!edges.some((e) => e.from === o && e.to === f)) return { status: 422, json: { refusal_reason: 'unresolved_effect_relationship' } };
        nodes = nodes.map((n) => (n.id === o ? { ...n, interventions: { ...(n.interventions ?? {}), [f]: { value: ev.value } } } : n));
        rev += 1;
        return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${rev}` } };
      }
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes, edges }, graph_hash: `h${rev}` } };
  };
  return { d, posted, read: () => nodes };
}

const VALUES = [{ factor_label: 'Onboarding workload', value: 30, unit: 'score (0-100)', basis: 'a settled team of five' }];
const ORDINARY_LEVELS = [
  { option_label: 'Hire a Tech Lead', factor_label: 'Tech leads hired', value: 1, basis: 'one hire' },
  { option_label: 'Hire Two Developers', factor_label: 'Developers hired', value: 2, basis: 'two hires' },
  { option_label: 'Hire Two Developers', factor_label: 'Onboarding workload', value: 45, basis: 'two new starters to onboard' },
];
const ORDINARY_PATHS = ['hire_a_tech_lead::tech_leads_hired', 'hire_two_developers::developers_hired', 'hire_two_developers::onboarding_workload'];

describe.each(['Maintain current staffing', 'Maintain current team'])('a held status quo ("%s") gets no levels', (statusQuoLabel) => {
  const fixture = () => hiring(statusQuoLabel);

  describe('(a) missingPairs does not demand a level for a held pair', () => {
    it('RED: a starting point covering the ordinary options and the values is admitted, with no held pair missing', async () => {
      const { nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const r = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: ORDINARY_LEVELS });
      expect(r.refusal, JSON.stringify(r.options_missing_levels)).toBeUndefined();
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r).not.toHaveProperty('options_missing_levels');
      const stored = store.get(String(r.proposal_id))!;
      expect(stored.operations.filter((o) => o.op === 'set_option_intervention').map((o) => o.path).sort()).toEqual(ORDINARY_PATHS);
      expect(stored.operations.filter((o) => o.op === 'set_factor_value').map((o) => o.path)).toEqual(['onboarding_workload']);
      expect(store.outstanding(SCENARIO, USER).map((o) => o.proposal_id)).toEqual([r.proposal_id]);
    });

    it('CONTRAST: an ordinary option missing a level is still refused incomplete_starting_point, naming that pair', async () => {
      const { nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const r = await caps.proposeStartingPoint(ctx, {
        assumptions: VALUES,
        option_levels: ORDINARY_LEVELS.filter((l) => !(l.option_label === 'Hire Two Developers' && l.factor_label === 'Onboarding workload')),
      });
      expect(r.refusal).toBe('incomplete_starting_point');
      expect(r.options_missing_levels).toContainEqual({ option: 'Hire Two Developers', factor: 'Onboarding workload' });
      expect(store.size()).toBe(0);
    });

    it('RED: …and that refusal names ONLY the ordinary pair — never the held status quo', async () => {
      const { nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const caps = createAgentCapabilities(p.d, new ProposalStore());
      const r = await caps.proposeStartingPoint(ctx, {
        assumptions: VALUES,
        option_levels: ORDINARY_LEVELS.filter((l) => !(l.option_label === 'Hire Two Developers' && l.factor_label === 'Onboarding workload')),
      });
      expect(r.options_missing_levels).toEqual([{ option: 'Hire Two Developers', factor: 'Onboarding workload' }]);
    });
  });

  describe('(b) a proposed level on a held pair is not accepted and never becomes an operation', () => {
    it('RED: proposing ONLY a held level records nothing, and says why', async () => {
      const { SQ, nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const r = await caps.proposeOptionInterventions(ctx, {
        interventions: [{ option_label: statusQuoLabel, factor_label: 'Tech leads hired', value: 0, basis: 'no hires' }],
      });
      expect(r.ok, JSON.stringify(r)).toBe(false);
      expect(r.refusal).toBe('nothing_to_set');
      expect(r.levels_not_accepted).toEqual([{
        option: statusQuoLabel, factor: 'Tech leads hired', value: 0,
        reason: `${statusQuoLabel} is held at its starting values — carrying on as now sets no level, so none is recorded for Tech leads hired. Leave it out, unless the user themselves said carrying on changes Tech leads hired and gave the level: then send it with user_stated: true.`,
      }]);
      expect(store.size()).toBe(0);
      expect(p.posted).toEqual([]);
      expect(p.read().find((n) => n.id === SQ)).not.toHaveProperty('interventions');
    });

    it('CONTRAST: the same factor on an ordinary linked option IS accepted as an operation', async () => {
      const { nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const r = await caps.proposeOptionInterventions(ctx, {
        interventions: [{ option_label: 'Hire a Tech Lead', factor_label: 'Tech leads hired', value: 1, basis: 'one hire' }],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r).not.toHaveProperty('levels_not_accepted');
      expect(store.get(String(r.proposal_id))!.operations.map((o) => o.path)).toEqual(['hire_a_tech_lead::tech_leads_hired']);
    });

    it('RED: inside a starting point the held level is excluded and named; ONE approval writes only the ordinary levels', async () => {
      const { SQ, nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const r = await caps.proposeStartingPoint(ctx, {
        assumptions: VALUES,
        option_levels: [...ORDINARY_LEVELS, { option_label: statusQuoLabel, factor_label: 'Tech leads hired', value: 0, basis: 'no hires' }],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.levels_not_accepted).toEqual([expect.objectContaining({ option: statusQuoLabel, factor: 'Tech leads hired', value: 0 })]);
      const heldPath = `${SQ}::tech_leads_hired`;
      const ops = store.get(String(r.proposal_id))!.operations;
      expect(ops.filter((o) => o.path === heldPath)).toEqual([]);
      expect(ops.filter((o) => o.op === 'set_option_intervention').map((o) => o.path).sort()).toEqual(ORDINARY_PATHS);
      const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
      expect(out.ok, JSON.stringify(out)).toBe(true);
      expect(p.posted.filter((x) => x.startsWith('level ')).sort()).toEqual(ORDINARY_PATHS.map((x) => `level ${x}`));
      expect(p.read().find((n) => n.id === SQ)).not.toHaveProperty('interventions');
    });
  });

  describe('(b2) the USER\'s own correction to a held status quo IS recordable (review 5820560331, blocker 1)', () => {
    it('RED: a user-stated level on a held pair becomes an operation, and ONE approval writes it', async () => {
      const { SQ, nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const r = await caps.proposeOptionInterventions(ctx, {
        interventions: [{
          option_label: statusQuoLabel, factor_label: 'Developers hired', value: 1,
          basis: 'carrying on still backfills one developer', user_stated: true,
        }],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r).not.toHaveProperty('levels_not_accepted');
      expect(store.size()).toBe(1);
      const auth = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
      expect(auth.ok, JSON.stringify(auth)).toBe(true);
      expect(p.posted).toEqual([`level ${SQ}::developers_hired`]);
      expect(p.read().find((n) => n.id === SQ)?.interventions).toEqual({ developers_hired: { value: expect.any(Number) } });
    });

    it('CONTRAST: the identical level WITHOUT user_stated is still refused, and nothing is stored', async () => {
      const { nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const r = await caps.proposeOptionInterventions(ctx, {
        interventions: [{ option_label: statusQuoLabel, factor_label: 'Developers hired', value: 1, basis: 'carrying on still backfills one developer' }],
      });
      expect(r.ok).toBe(false);
      expect(r.refusal).toBe('nothing_to_set');
      expect(store.size()).toBe(0);
    });

    it('RED: inside a starting point too — the user-stated held level joins the one approval', async () => {
      const { SQ, nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const caps = createAgentCapabilities(p.d, new ProposalStore());
      const r = await caps.proposeStartingPoint(ctx, {
        assumptions: VALUES,
        option_levels: [
          ...ORDINARY_LEVELS,
          { option_label: statusQuoLabel, factor_label: 'Developers hired', value: 1, basis: 'the user: carrying on backfills one', user_stated: true },
        ],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r).not.toHaveProperty('levels_not_accepted');
      const auth = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
      expect(auth.ok, JSON.stringify(auth)).toBe(true);
      expect(p.posted).toContain(`level ${SQ}::developers_hired`);
    });
  });

  /**
   * ⛔ A HELD STATUS QUO'S OWN STARTING VALUE IS NOT A LEVEL ANYONE STATED
   * (RC #69 5830102377; pre-review 5830132268).
   *
   * MEASURED on served builds, in this lane's own captures: one "Use as starting
   * assumptions" wrote the held status quo's levels as COPIES of the factors'
   * starting values, and the level writer stamped them `user_specified`:
   *   - hiring (c27a, `0303ef5`): `carry_on_as_now::developer_delivery_capacity` =
   *     0.1333 and `::technical_leadership_capacity` = 0 — the values the SAME
   *     starting point proposed — on pairs held by repair edges only;
   *   - pricing (c26, `7f9a16d`): `keep_pro_at_49::pro_plan_price` = 0.245, the
   *     brief's own £49 baseline.
   * The flag that let them through was `user_stated: true`, which the Agent
   * supplies. A copy of the starting value records nothing the user changed, and
   * freezes it: a later correction to that starting value would leave "carrying
   * on as now" at the OLD figure (the harm `heldStatusQuoPairs` exists to stop).
   * A DIFFERENT user-stated figure is still a real correction — (b2) stands.
   */
  describe('(b3) a user-stated held level that restates its starting value is not a level', () => {
    const withHeldWorkload = () => {
      const { SQ, nodes, edges } = fixture();
      return { SQ, nodes, edges: [...edges, held(SQ, 'onboarding_workload')] };
    };

    it('RED (pricing shape): restating the factor’s current starting value is refused, nothing is stored, and it says why', async () => {
      const { SQ, nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const r = await caps.proposeOptionInterventions(ctx, {
        interventions: [{ option_label: statusQuoLabel, factor_label: 'Developers hired', value: 0, basis: 'carrying on hires nobody', user_stated: true }],
      });
      expect(r.ok, JSON.stringify(r)).toBe(false);
      expect(r.refusal).toBe('nothing_to_set');
      expect(r.levels_not_accepted).toEqual([{
        option: statusQuoLabel, factor: 'Developers hired', value: 0,
        reason: `${statusQuoLabel} already keeps Developers hired at its starting value, 0. Recording that as a level changes nothing today, and would stop carrying on as now from following a later correction to the starting value, so none is recorded. Leave it out.`,
      }]);
      expect(store.size()).toBe(0);
      expect(p.posted).toEqual([]);
      expect(p.read().find((n) => n.id === SQ)).not.toHaveProperty('interventions');
    });

    it('RED (hiring shape): inside a starting point, the value THAT starting point proposes is the starting value — excluded, and ONE approval writes no status-quo level', async () => {
      const { SQ, nodes, edges } = withHeldWorkload();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const r = await caps.proposeStartingPoint(ctx, {
        assumptions: VALUES,
        option_levels: [
          ...ORDINARY_LEVELS,
          { option_label: statusQuoLabel, factor_label: 'Onboarding workload', value: 30, basis: 'a settled team of five', user_stated: true },
          { option_label: statusQuoLabel, factor_label: 'Tech leads hired', value: 0, basis: 'no hires', user_stated: true },
        ],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.levels_not_accepted).toEqual([
        expect.objectContaining({ option: statusQuoLabel, factor: 'Onboarding workload', value: 30, reason: expect.stringContaining('at its starting value, 30.') }),
        expect.objectContaining({ option: statusQuoLabel, factor: 'Tech leads hired', value: 0, reason: expect.stringContaining('at its starting value, 0.') }),
      ]);
      const ops = store.get(String(r.proposal_id))!.operations;
      expect(ops.filter((o) => o.path.startsWith(`${SQ}::`))).toEqual([]);
      expect(ops.filter((o) => o.op === 'set_option_intervention').map((o) => o.path).sort()).toEqual(ORDINARY_PATHS);
      const auth = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
      expect(auth.ok, JSON.stringify(auth)).toBe(true);
      expect(p.posted.filter((x) => x.startsWith(`level ${SQ}::`))).toEqual([]);
      expect(p.read().find((n) => n.id === SQ)).not.toHaveProperty('interventions');
    });

    it('RED: carrying on as now then FOLLOWS a corrected starting value — no frozen status-quo level exists to disagree with it', async () => {
      const { SQ, nodes, edges } = withHeldWorkload();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const sp = await caps.proposeStartingPoint(ctx, {
        assumptions: VALUES,
        option_levels: [...ORDINARY_LEVELS, { option_label: statusQuoLabel, factor_label: 'Onboarding workload', value: 30, basis: 'as now', user_stated: true }],
      });
      expect((await caps.authoriseChange(ctx, { proposal_id: String(sp.proposal_id) })).ok).toBe(true);
      expect(p.read().find((n) => n.id === SQ)).not.toHaveProperty('interventions');
      // The starting value is then corrected to 40 (any writer — here, straight through registration).
      const now = await p.d(`/assist/v1/scenarios/${SCENARIO}/graph`, {});
      const corrected = (now.json as { graph: { nodes: Node[] } }).graph.nodes.map((n) =>
        n.id === 'onboarding_workload' ? { ...n, observed_state: { ...(n.observed_state ?? {}), value: 0.4, raw_value: 40, cap: 100 } } : n);
      const reg = await p.d(`/assist/v1/scenarios/${SCENARIO}/graph/register`, { graph: { nodes: corrected, edges }, expected_graph_hash: (now.json as { graph_hash: string }).graph_hash });
      expect(reg.status).toBe(200);
      // Carrying on as now reads the NEW figure: restating 40 is nothing, and the OLD 30 would be a change.
      const caps2 = createAgentCapabilities(p.d, new ProposalStore());
      const again = await caps2.proposeOptionInterventions(ctx, {
        interventions: [{ option_label: statusQuoLabel, factor_label: 'Onboarding workload', value: 40, basis: 'as now', user_stated: true }],
      });
      expect(again.levels_not_accepted).toEqual([expect.objectContaining({ factor: 'Onboarding workload', value: 40, reason: expect.stringContaining('at its starting value, 40.') })]);
      const old = await caps2.proposeOptionInterventions(ctx, {
        interventions: [{ option_label: statusQuoLabel, factor_label: 'Onboarding workload', value: 30, basis: 'the user: carrying on stays at 30', user_stated: true }],
      });
      expect(old.ok, JSON.stringify(old)).toBe(true);
      expect(old).not.toHaveProperty('levels_not_accepted');
      expect(p.posted.filter((x) => x.startsWith(`level ${SQ}::`))).toEqual([]);
    });

    it('CONTRAST (blocker 1 stands): a DIFFERENT user-stated figure inside the same starting point IS recorded', async () => {
      const { SQ, nodes, edges } = withHeldWorkload();
      const p = fakeProduct(nodes, edges);
      const caps = createAgentCapabilities(p.d, new ProposalStore());
      const r = await caps.proposeStartingPoint(ctx, {
        assumptions: VALUES,
        option_levels: [...ORDINARY_LEVELS, { option_label: statusQuoLabel, factor_label: 'Onboarding workload', value: 31, basis: 'the user: carrying on adds one', user_stated: true }],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r).not.toHaveProperty('levels_not_accepted');
      expect((await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) })).ok).toBe(true);
      expect(p.posted).toContain(`level ${SQ}::onboarding_workload`);
    });

    it('CONTRAST: the proposed value, not the factor’s old one, is the starting value — restating the OLD figure is a real change once the new one is adopted', async () => {
      const { SQ, nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const caps = createAgentCapabilities(p.d, new ProposalStore());
      // Developers hired starts at 0; this starting point revises it to 3, and the user says carrying on stays at 0.
      const r = await caps.proposeStartingPoint(ctx, {
        assumptions: [{ factor_label: 'Developers hired', value: 3, unit: 'hires', basis: 'the user: three this year', revise: true } as never],
        option_levels: [...ORDINARY_LEVELS, { option_label: statusQuoLabel, factor_label: 'Developers hired', value: 0, basis: 'the user: carrying on hires nobody', user_stated: true }],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r).not.toHaveProperty('levels_not_accepted');
      expect(p.posted).toEqual([]);
      expect((await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) })).ok).toBe(true);
      expect(p.posted).toContain(`level ${SQ}::developers_hired`);
    });

    it('CONTRAST: an ORDINARY option may set a factor to its starting value — the rule is the held status quo’s alone', async () => {
      const { nodes, edges } = fixture();
      const p = fakeProduct(nodes, edges);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(p.d, store);
      const r = await caps.proposeOptionInterventions(ctx, {
        interventions: [{ option_label: 'Hire a Tech Lead', factor_label: 'Tech leads hired', value: 0, basis: 'the hire falls through' }],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r).not.toHaveProperty('levels_not_accepted');
      expect(store.get(String(r.proposal_id))!.operations.map((o) => o.path)).toEqual(['hire_a_tech_lead::tech_leads_hired']);
    });
  });

  describe('(c) structuralFacts holds the status quo instead of calling it inert', () => {
    const extras = (): { nodes: Node[]; edges: Edge[] } => {
      const { nodes, edges } = fixture();
      return {
        nodes: [...nodes,
          { id: 'does_nothing_new', kind: 'option', label: 'Does nothing new' },
          { id: 'mixed_option', kind: 'option', label: 'Mixed option' }],
        // A mix of one repair edge and one ordinary edge is NOT a held status quo.
        edges: [...edges, held('mixed_option', 'tech_leads_hired'), edge('mixed_option', 'onboarding_workload')],
      };
    };

    it('RED: the held status quo is absent from options_that_change_nothing and present in status_quo_held', () => {
      const { nodes, edges } = extras();
      const f = structuralFacts(nodes, edges);
      expect(f.options_that_change_nothing).not.toContain(statusQuoLabel);
      expect(f.status_quo_held).toEqual([statusQuoLabel]);
    });

    it('CONTRAST: a truly inert option (no edges) and a mixed repair+ordinary option are still listed, and neither is held', () => {
      const { nodes, edges } = extras();
      const f = structuralFacts(nodes, edges);
      expect(f.options_that_change_nothing).toContain('Does nothing new');
      expect(f.options_that_change_nothing).toContain('Mixed option');
      expect(f.status_quo_held ?? []).not.toContain('Does nothing new');
      expect(f.status_quo_held ?? []).not.toContain('Mixed option');
    });

    it('RED: exact lists, in node order', () => {
      const { nodes, edges } = extras();
      const f = structuralFacts(nodes, edges);
      expect(f.options_that_change_nothing).toEqual(['Hire a Tech Lead', 'Hire Two Developers', 'Does nothing new', 'Mixed option']);
      expect(f.status_quo_held).toEqual([statusQuoLabel]);
    });

    it('RED: get_canonical_state carries it — `origin` survives the read the Agent is given', async () => {
      const { nodes, edges } = extras();
      const caps = createAgentCapabilities(fakeProduct(nodes, edges).d, new ProposalStore());
      const r = await caps.getCanonicalState(ctx);
      const s = r.structure as { options_that_change_nothing: string[]; status_quo_held: string[] };
      expect(s.status_quo_held).toEqual([statusQuoLabel]);
      expect(s.options_that_change_nothing).not.toContain(statusQuoLabel);
      expect(s.options_that_change_nothing).toContain('Does nothing new');
    });
  });
});

describe('(d) the Agent is told a held status quo is never given levels — in the prompt it is actually sent', () => {
  let app: FastifyInstance;
  const instructions: string[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      instructions.push(String(body['instructions'] ?? ''));
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The model holds three options.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ok', blocks: [], suggested_actions: [], insights: [], graph_hash: 'h1' }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] }, graph_hash: 'h1' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What is in the model?' } });
    expect(r.statusCode).toBe(200);
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('CONTROL: the captured instructions are the Agent prompt', () => {
    expect(instructions.length).toBeGreaterThanOrEqual(1);
    expect(instructions[0]).toContain('call propose_starting_point ONCE');
  });

  it('RED: the starting-point instruction excludes the held status quo', () => {
    expect(instructions[0]).toContain(
      'In that same reply, if any factor has no value or any option sets nothing, call propose_starting_point ONCE with a reasoned ' +
      'starting value for each such factor and the level each option sets, in the user’s own units. An option in ' +
      '`status_quo_held` does not count: it is held at its starting values and is never given levels.',
    );
  });

  it('RED: the options_that_change_nothing instruction says the held status quo holds today’s values, and invites a correction', () => {
    expect(instructions[0]).toContain(
      'ask what that option would actually change, and record the answer with propose_option_interventions. ' +
      'An option in `status_quo_held` is not in that list and is never given levels: say, in one short clause, that carrying ' +
      'on as now holds today’s values, and that the user can say what would change if that is wrong.',
    );
  });
});

/**
 * ⛔ BLOCKER 2 (review 5820560331): "held" was decided from `origin: 'repair'`
 * alone. The conventional `fixStatusQuoConnectivity` stamps that origin on EVERY
 * disconnected option, so a real alternative ("Use contractors") was called a
 * status quo holding today's values and its levels were refused. Held now needs
 * the same test #1838 mints under: exactly one baseline label, all-repair edges.
 */
describe('a repair-wired option is held ONLY when its label reads as carrying on as now', () => {
  function contractors() {
    const { nodes, edges } = hiring('Maintain current staffing');
    // Replace the status quo with a real alternative the repair wired the same way.
    const nodes2 = nodes.map((n) => (n.id === idOf('Maintain current staffing') ? { ...n, id: 'use_contractors', label: 'Use contractors' } : n));
    const edges2 = edges.map((e) => (e.from === idOf('Maintain current staffing') ? { ...e, from: 'use_contractors' } : e));
    return { nodes: nodes2, edges: edges2 };
  }

  it('RED: "Use contractors" (repair edges only) is NOT held — it is listed as changing nothing', () => {
    const { nodes, edges } = contractors();
    const f = structuralFacts(nodes as never, edges as never);
    expect(f.status_quo_held).toEqual([]);
    expect(f.options_that_change_nothing).toContain('Use contractors');
  });

  it('RED: its level is accepted as an operation, with no user_stated needed', async () => {
    const { nodes, edges } = contractors();
    const p = fakeProduct(nodes, edges);
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Use contractors', factor_label: 'Developers hired', value: 3, basis: 'three contractors' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.size()).toBe(1);
  });

  it('CONTRAST: the same graph with the baseline label IS held (the predicate discriminates on the label alone)', () => {
    const { nodes, edges } = hiring('Maintain current staffing');
    const f = structuralFacts(nodes as never, edges as never);
    expect(f.status_quo_held).toEqual(['Maintain current staffing']);
    expect(f.options_that_change_nothing).not.toContain('Maintain current staffing');
  });

  it('RED: TWO baseline-labelled repair-wired options — neither is held (ambiguity is not guessed)', () => {
    const { nodes, edges } = hiring('Maintain current staffing');
    const nodes2 = [...nodes, { id: 'status_quo', kind: 'option', label: 'Status quo' }];
    const edges2 = [...edges, held('status_quo', 'tech_leads_hired')];
    const f = structuralFacts(nodes2 as never, edges2 as never);
    expect(f.status_quo_held).toEqual([]);
    expect(f.options_that_change_nothing).toEqual(expect.arrayContaining(['Maintain current staffing', 'Status quo']));
  });
});

/**
 * ⛔ REVIEW OF #1849 AT 1a32b120: "held" must stay PAIR-level inside the status quo.
 * The user corrects one thing about carrying on ("it raises onboarding workload"),
 * the Agent links it — the status quo now has two repair pairs and one ordinary
 * pair. The two repair pairs are STILL held: never demanded, never accepted
 * unflagged. (The existing mixed-edge contrast uses a non-baseline label, so it
 * could not see this.)
 */
describe('a status quo with one ordinary link keeps its OTHER pairs held', () => {
  function mixedStatusQuo() {
    const f = hiring('Maintain current staffing');
    return { ...f, edges: [...f.edges, edge(f.SQ, 'onboarding_workload')] };
  }

  it('RED: a starting point is admitted without levels for the still-held repair pairs (P2)', async () => {
    const { SQ, nodes, edges } = mixedStatusQuo();
    const p = fakeProduct(nodes, edges);
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeStartingPoint(ctx, {
      assumptions: VALUES,
      option_levels: [
        ...ORDINARY_LEVELS,
        { option_label: 'Maintain current staffing', factor_label: 'Onboarding workload', value: 40, basis: 'the user: carrying on raises onboarding workload' },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('options_missing_levels');
    const auth = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(auth.ok, JSON.stringify(auth)).toBe(true);
    expect(p.posted).toContain(`level ${SQ}::onboarding_workload`);
    expect(p.posted).not.toContain(`level ${SQ}::developers_hired`);
    expect(p.posted).not.toContain(`level ${SQ}::tech_leads_hired`);
  });

  it('RED: an UNFLAGGED level on a still-held repair pair is refused and stores nothing (P3)', async () => {
    const { nodes, edges } = mixedStatusQuo();
    const p = fakeProduct(nodes, edges);
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Maintain current staffing', factor_label: 'Developers hired', value: 0, basis: 'no hires' }],
    });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('nothing_to_set');
    expect(store.size()).toBe(0);
  });

  it('CONTRAST: its ORDINARY pair takes a level with no flag', async () => {
    const { nodes, edges } = mixedStatusQuo();
    const p = fakeProduct(nodes, edges);
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Maintain current staffing', factor_label: 'Onboarding workload', value: 40, basis: 'the user said so' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.size()).toBe(1);
  });
});
