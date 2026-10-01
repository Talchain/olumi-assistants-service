/**
 * ⭐⭐ D1 — A CURRENT LEVEL IS A FACT ABOUT TODAY: CARDED ON ITS OWN, AND KEPT ON THE GOAL'S CAP WHEN A TARGET ARRIVES
 * (DL #85 5930770727, adopting R3 F5 D1 5930715560 (a): "A current level is a fact about today. It does NOT depend on
 * the comparator; card it on its own").
 *
 * Paul's journey (guest replay on staging 29a37d18): goal "Quarterly revenue", NO target yet, unit currency/quarter.
 *   (1) "Our quarterly revenue is £100,000." → served: NO card (`no_target`; beside a target, `goal_is_unstated`).
 *   (2) "We're aiming to double that within the next 6 months." → the target £200,000 a quarter.
 *
 * THE REAL PATHS: construction (`buildModelFromBrief`, ONE scripted drafter call → `/graph/register` bytes) builds the
 * no-target goal on its normalising frame with the user's own £5,000-per-customer size into it; the Agent's real
 * `dispatchTool` → `propose_goal_current_level` → `authorise_change` → a register store enforcing the route's contract
 * gate and CAS; then the target through the target writer (`applyGoalTargetEdit` → the `add_constraint` handler).
 * Every assertion binds the goal by id and the level by its literal source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS, dispatchTool, type AgentCapabilities, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { applyGoalTargetEdit } from '../../system-events/goal-target-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Rec = Record<string, any>;
type Graph = { nodes: Rec[]; edges: Rec[] } & Rec;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/**
 * ⛔ THE GOAL BY ITS ID, NEVER BY KIND OR POSITION (trap 19; DL 380e54 on #2462, 5933850040): exactly one node holds the
 * id, and it is the goal. Construction ids Paul's goal "Quarterly revenue" `quarterly_revenue`; his stored pricing model's is `mrr`.
 */
const D1_GOAL_ID = 'quarterly_revenue';
const goalIn = (g: Graph, id: string): Rec => {
  const hits = g.nodes.filter((n) => n.id === id);
  expect(hits.map((n) => n.kind), `exactly one node "${id}", and it is the goal`).toEqual(['goal']);
  return hits[0]!;
};
const goalOf = (g: Graph): Rec => goalIn(g, D1_GOAL_ID);
const edgeInto = (g: Graph, from: string): Rec => {
  const hits = g.edges.filter((e) => e.from === from && e.to === D1_GOAL_ID);
  expect(hits, `exactly one link ${from} → ${D1_GOAL_ID}`).toHaveLength(1);
  return hits[0]!;
};

const TOOL = 'propose_goal_current_level';
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400d1';
const UNIT = 'GBP per quarter';
const SAID_1 = 'Our quarterly revenue is £100,000.';

// ── Paul's no-target goal, built by construction ─────────────────────────────────────────────────────────────────
const BRIEF = 'We want to grow our quarterly revenue. Each new enterprise customer we sign adds about £5,000 a quarter. '
  + 'We are deciding whether to hire a second salesperson or run a partner programme.';
const BRIEF_WITH_FIGURES = `${BRIEF} Our quarterly revenue is £100,000 and we aim to reach £200,000.`;

type Prov = 'explicit' | 'inferred' | 'ai_proposed';
const link = (from: string, to: string, size?: { amount: number; per: number; by: Prov }) => ({
  from, to, direction: 'positive', provenance: 'inferred' as Prov,
  effect_amount: size?.amount ?? null, effect_per_source_change: size?.per ?? null, effect_provenance: size?.by ?? null, definitional: null,
});

function draft(o: { target?: number; level?: number } = {}) {
  return {
    goal: {
      metric: 'Quarterly revenue', operator: '>=', target_stated: o.target !== undefined, frame: 'level', value: o.target ?? null,
      unit: UNIT, horizon_months: 6, provenance: 'explicit',
      baseline_known: o.level !== undefined, baseline_value: o.level ?? null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: [
      { label: 'Keep one salesperson', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Hire a second salesperson', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Salespeople', value: 2, value_kind: 'absolute', unit: 'people', provenance: 'explicit' },
      ] },
    ],
    factors: [
      { label: 'Salespeople', role: 'controllable', baseline_known: true, baseline_value: 1, unit: 'people', provenance: 'inferred', plausible_max: 10 },
    ],
    risks: [],
    outcomes: [{ label: 'New enterprise customers', provenance: 'inferred', unit: 'customers', plausible_max: 20 }],
    links: [
      link('Salespeople', 'New enterprise customers'),
      // The user's own size into the goal: "Each new enterprise customer we sign adds about £5,000 a quarter."
      link('New enterprise customers', 'Quarterly revenue', { amount: 5000, per: 1, by: 'explicit' }),
    ],
    identities: [],
    unknowns: [],
    decision_question: null,
  };
}

/** Construction's own bytes: what `/graph/register` received from the build. */
async function build(d: Record<string, unknown>, brief: string): Promise<Graph> {
  let body: unknown = null;
  const call = (async () => ({ text: JSON.stringify(d) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('d1d1d1d1-0000-4d1d-8d1d-d1d1d1d1d1d1', brief, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return body as Graph;
}

/** A store that behaves like the read and register routes (contract gate, CAS on the analysis hash, a version minted). */
function scenarioStore(initial: Graph) {
  let graph = clone(initial);
  let rev = 0;
  const hash = () => `h${rev}`;
  const registers: Rec[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      return { status: 200, json: { graph: clone(graph), graph_hash: hash(), graph_identity_hash: { value: `id-${hash()}` } } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const b = clone(body) as { graph: Graph; expected_graph_hash?: string };
      registers.push(b);
      if (!GraphStateIngressSchema.safeParse(b.graph).success) return { status: 400, json: { details: { code: 'GRAPH_CONTRACT_INVALID' } } };
      if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== hash()) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = b.graph;
      rev += 1;
      return { status: 200, json: { graph_hash: hash(), model_version: { version_number: rev + 1, version_id: `v${rev}`, mutation_id: `m${rev}` } } };
    }
    return { status: 500, json: {} };
  };
  return { dispatch, registers, graph: () => graph };
}

function setup(initial: Graph, said: string) {
  const store = scenarioStore(initial);
  const proposals = new ProposalStore();
  const caps: AgentCapabilities = createAgentCapabilities(store.dispatch, proposals);
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-d1', user_text: said };
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  return { ...store, proposals, call };
}

/** (1) carded and approved: the stored graph afterwards. */
async function levelCarded(built: Graph): Promise<{ s: ReturnType<typeof setup>; proposed: Rec }> {
  const s = setup(built, SAID_1);
  const proposed = await s.call(TOOL, { goal_label: 'Quarterly revenue', value: 100000, unit: '£', user_stated: true }) as Rec;
  // The card is bound to the goal node by its id: the held proposal's one operation addresses it.
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  expect(s.proposals.get(String(proposed.proposal_id))?.operations.map((o) => o.path)).toEqual([D1_GOAL_ID]);
  return { s, proposed };
}

/** (2) the target through the target writer (the approved card's `goal_target_edit` → `add_constraint`). */
async function targetWritten(g: Graph, raw: number, unit: string = UNIT, goalId: string = D1_GOAL_ID): Promise<Graph> {
  const event = { kind: 'goal_target_edit', goal_node_id: goalIn(g, goalId).id, constraint_type: 'at_least', raw_value: raw, unit,
    base_graph_hash: computeAnalysisAffectingGraphHash(g as never) };
  const r = await applyGoalTargetEdit({
    payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: 'turn-d1-target', stage: 'frame', event } as never,
    event: event as never, requestId: 'req-d1-target', persistedGraph: g as never, priorFacts: [],
  }) as { kind: string; mutatedGraph?: Graph };
  expect(r.kind, JSON.stringify(r).slice(0, 400)).toBe('mutated');
  return r.mutatedGraph!;
}

describe('(i) Paul\'s (1): "Our quarterly revenue is £100,000." on a goal with NO target is carded on its own', () => {
  it('CONTRAST (the served state): construction builds the goal with no target, on its normalising frame, the user\'s £5,000 per customer into it', async () => {
    const g = await build(draft(), BRIEF);
    const goal = goalOf(g);
    expect(goal.label).toBe('Quarterly revenue');
    expect(goal.goal_threshold_frame).toBe('level');
    expect(goal.goal_threshold_unit).toBe(UNIT);
    for (const k of ['goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold']) expect(goal).not.toHaveProperty(k);
    expect(goal).not.toHaveProperty('observed_state');
    expect(goal.scale_frame).toBeGreaterThan(1);
    expect(edgeInto(g, 'new_enterprise_customers').provenance?.magnitude).toBe('user_stated');
  });

  it('RED: proposed (nothing written), the card says today\'s level only; approved → observed_state {raw 100000, value = baseline = 100000/125000, the user\'s stamp, cap 125000}', async () => {
    const built = await build(draft(), BRIEF);
    const { s, proposed } = await levelCarded(built);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.mutated).toBe(false);
    expect(proposed.public_label).toBe('Record today\'s level of "Quarterly revenue" as your figure: £100,000');
    expect(proposed.public_label).not.toMatch(/target/i);
    expect(proposed).not.toHaveProperty('target');
    expect(s.registers, 'held: nothing written before the approval').toEqual([]);

    const applied = await s.call('authorise_change', { proposal_id: proposed.proposal_id }) as Rec;
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.applied).toBe(true);
    expect(s.registers).toHaveLength(1);
    const C = 125000; // resolveGoalThresholdCapWithProvenance(undefined, 100000, unit, undefined): the 25% headroom rule
    expect(goalOf(s.graph()).observed_state).toStrictEqual({
      value: 100000 / C, baseline: 100000 / C, unit: UNIT, source: USER_EDIT_SOURCE, raw_value: 100000, cap: C,
    });
    expect(USER_EDIT_SOURCE).toBe('user_override');
    // Still no target: the level card writes no target field of any kind.
    for (const k of ['goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold']) expect(goalOf(s.graph())).not.toHaveProperty(k);
  });

  it('RED (F4 at the level\'s apply): the normalising frame is retired in the same write, and the user\'s £5,000 per customer keeps its natural size on the level\'s frame', async () => {
    const built = await build(draft(), BRIEF);
    const before = edgeInto(built, 'new_enterprise_customers');
    const F0 = goalOf(built).scale_frame as number;
    const { s, proposed } = await levelCarded(built);
    await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    const after = s.graph();
    expect(goalOf(after)).not.toHaveProperty('scale_frame');
    const e = edgeInto(after, 'new_enterprise_customers');
    expect(e.provenance.natural_effect.amount).toBe(5000);
    // β = b · F_source / F_goal: the frame moved F0 → 125,000, so β moved by F0 / 125,000 and the natural size did not.
    expect(e.strength.mean).toBeCloseTo(before.strength.mean * (F0 / 125000), 12);
  });
});

describe('(ii) then the target, through the target writer: the level is kept on the target\'s cap in the SAME write', () => {
  it('RED: target £200,000 → value = baseline = 100000 / new cap AND goal_threshold = 200000 / new cap; source, raw_value and unit untouched', async () => {
    const built = await build(draft(), BRIEF);
    const { s, proposed } = await levelCarded(built);
    await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    const out = await targetWritten(s.graph(), 200000);
    const goal = goalOf(out);
    const cap = goal.goal_threshold_cap as number;
    expect(cap).toBe(250000);
    expect(goal.goal_threshold).toBe(200000 / cap);
    expect(goal.observed_state).toStrictEqual({
      value: 100000 / cap, baseline: 100000 / cap, unit: UNIT, source: USER_EDIT_SOURCE, raw_value: 100000, cap,
    });
  });

  it('RED (path independence, F4\'s rule): level-then-target reads exactly like a build that stated both — frame, level, threshold and the user\'s β into the goal', async () => {
    const built = await build(draft(), BRIEF);
    const { s, proposed } = await levelCarded(built);
    await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    const a = await targetWritten(s.graph(), 200000);
    const b = await build(draft({ target: 200000, level: 100000 }), BRIEF_WITH_FIGURES);
    const [ga, gb] = [goalOf(a), goalOf(b)];
    expect(gb.observed_state?.raw_value, 'the build admitted the stated level').toBe(100000);
    expect(ga.goal_threshold_cap).toBe(gb.goal_threshold_cap);
    expect(ga.observed_state.cap).toBe(gb.observed_state.cap);
    expect(ga.observed_state.value).toBeCloseTo(gb.observed_state.value, 12);
    expect(ga.goal_threshold).toBeCloseTo(gb.goal_threshold, 12);
    expect(edgeInto(a, 'new_enterprise_customers').strength.mean).toBeCloseTo(edgeInto(b, 'new_enterprise_customers').strength.mean, 12);
    expect(edgeInto(a, 'new_enterprise_customers').provenance.natural_effect.amount).toBe(5000);
  });
});

// ── (iii)/(iv)/(v) on Paul's stored pricing model (`cbd15f83`): goal `mrr`, target 20000 "GBP MRR", cap 25000 ─────────
const paul = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as Graph;
const CAP = 25000;
const mrr = (g: Graph): Rec => goalIn(g, 'mrr');
const T = { goal_label: 'MRR', unit: 'GBP', user_stated: true };

describe('(iii) beside a target, a level needs no comparator: the held one when there is one, else the scale rule alone', () => {
  it('RED: goal_is absent, goal_direction ">=" held → admitted on the floor rule; approved → the level on the target\'s cap', async () => {
    const g = clone(paul); mrr(g).goal_direction = '>=';
    const s = setup(g, 'Our current MRR is £12,000.');
    const r = await s.call(TOOL, { ...T, value: 12000 }) as Rec;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await s.call('authorise_change', { proposal_id: r.proposal_id });
    expect(mrr(s.graph()).observed_state).toMatchObject({ value: 12000 / CAP, baseline: 12000 / CAP, raw_value: 12000, cap: CAP, source: USER_EDIT_SOURCE });
  });

  it('CONTROL: goal_is absent, goal_direction ">=" held, a level ABOVE the target → the held floor\'s rule still refuses it (upside down)', async () => {
    const g = clone(paul); mrr(g).goal_direction = '>=';
    const r = await setup(g, 'Our current MRR is £24,000.').call(TOOL, { ...T, value: 24000 }) as Rec;
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('not_admitted');
    expect(r.detail).toContain('is already above the target of 20000');
  });

  it('CONTROL: goal_is absent, goal_direction "<=" held + a level ABOVE the target → the existing ceiling rule admits it', async () => {
    const g = clone(paul); mrr(g).goal_direction = '<=';
    const r = await setup(g, 'Our current MRR is £24,000.').call(TOOL, { ...T, value: 24000 }) as Rec;
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('CONTROL: goal_is absent, goal_direction "<=" held + a level AT OR BELOW the target → the ceiling rule refuses it, said', async () => {
    const g = clone(paul); mrr(g).goal_direction = '<=';
    const r = await setup(g, 'Our current MRR is £12,000.').call(TOOL, { ...T, value: 12000 }) as Rec;
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('is already at or below the target of 20000');
  });

  it('RED: goal_is absent and NO comparator held → admitted on the scale rule, below AND above the target (a level is a fact)', async () => {
    for (const value of [12000, 24000]) {
      const s = setup(clone(paul), `Our current MRR is £${value.toLocaleString('en-GB')}.`);
      const r = await s.call(TOOL, { ...T, value }) as Rec;
      expect(r.ok, `${value}: ${JSON.stringify(r)}`).toBe(true);
      expect(r.public_label).toContain('(target £20,000');
      await s.call('authorise_change', { proposal_id: r.proposal_id });
      expect(mrr(s.graph()).observed_state).toMatchObject({ value: value / CAP, baseline: value / CAP, raw_value: value, cap: CAP });
    }
  });

  it('CONTROL: no comparator, a level OFF the target\'s cap scale (£30,000 on 0–£25,000) → still refused, with the shared sentence', async () => {
    const s = setup(clone(paul), 'Our current MRR is £30,000.');
    const r = await s.call(TOOL, { ...T, value: 30000 }) as Rec;
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('not_admitted');
    expect(r.detail).toContain('is outside the range the target of 20000 is measured on (0 to 25000)');
    expect(s.registers).toEqual([]);
  });

  it('CONTROL: a STATED goal_is still goes through the comparator rule word for word ("at_least" + a level above → refused)', async () => {
    const r = await setup(clone(paul), 'Our current MRR is £24,000.').call(TOOL, { ...T, value: 24000, goal_is: 'at_least' }) as Rec;
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('is already above the target of 20000');
  });
});

describe('(iv) every other door stands on the level card with no target', () => {
  const noTarget = (): Graph => {
    const g = clone(paul);
    for (const k of ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold_cap_provenance']) delete mrr(g)[k];
    return g;
  };
  const refused = async (args: Rec, said: string) => {
    const s = setup(noTarget(), said);
    const r = await s.call(TOOL, args) as Rec;
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(s.proposals.outstanding(SCENARIO, null)).toEqual([]);
    expect(s.registers).toEqual([]);
    return r;
  };

  it('CONTRAST: the same goal with no target, the user\'s written £12,000 → carded', async () => {
    const r = await setup(noTarget(), 'Our current MRR is £12,000.').call(TOOL, { ...T, value: 12000 }) as Rec;
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('a figure the user did NOT write is refused (figure_not_in_users_words)', async () => {
    expect((await refused({ ...T, value: 15000 }, 'Our current MRR is £12,000.')).refusal).toBe('figure_not_in_users_words');
  });

  it('a level in another unit ("12%" for a GBP goal) is refused (unit_mismatch)', async () => {
    expect((await refused({ ...T, value: 12, unit: '%' }, 'Our MRR grew 12% last month.')).refusal).toBe('unit_mismatch');
  });

  it('an Olumi estimate (user_stated false) is refused; a figure for a factor is never the goal\'s', async () => {
    expect((await refused({ ...T, value: 12000, user_stated: false }, 'Our current MRR is £12,000.')).refusal).toBe('not_the_users_figure');
    expect((await refused({ ...T, goal_label: 'Pro plan price', value: 49 }, 'The Pro plan price is £49.')).refusal).toBe('not_the_goal');
  });

  it('a goal on another frame (delta) with no target still has nothing to read a level on', async () => {
    const s = setup(noTarget(), 'Our current MRR is £12,000.');
    const g = noTarget(); mrr(g).goal_threshold_frame = 'delta';
    const r = await setup(g, 'Our current MRR is £12,000.').call(TOOL, { ...T, value: 12000 }) as Rec;
    expect(r.refusal).toBe('no_target');
    expect(s.registers).toEqual([]);
  });

  it('a half-written target (a normalised threshold with no raw figure) is never treated as "no target yet"', async () => {
    const g = noTarget(); mrr(g).goal_threshold = 0.8;
    const r = await setup(g, 'Our current MRR is £12,000.').call(TOOL, { ...T, value: 12000 }) as Rec;
    expect(r.refusal).toBe('no_target');
  });
});

describe('(v) the target writer rescales ONLY a stored figure, and only when the cap moves', () => {
  it('CONTROL: a goal observed_state with NO raw_value (an Olumi value) is left byte for byte when the cap moves', async () => {
    const g = clone(paul);
    const olumis = { value: 0.5, baseline: 0.5, source: 'cee_inference', cap: CAP };
    mrr(g).observed_state = { ...olumis };
    const out = await targetWritten(g, 40000, 'GBP MRR', 'mrr');
    expect(mrr(out).goal_threshold_cap).toBe(50000);
    expect(mrr(out).observed_state).toStrictEqual(olumis);
  });

  it('CONTROL: a level already on the target\'s cap (a lower target inherits cap 25,000) is not touched', async () => {
    const g = clone(paul);
    const level = { value: 12000 / CAP, baseline: 12000 / CAP, unit: 'GBP MRR', source: USER_EDIT_SOURCE, raw_value: 12000, cap: CAP };
    mrr(g).observed_state = { ...level };
    const out = await targetWritten(g, 22000, 'GBP MRR', 'mrr');
    expect(mrr(out).goal_threshold_cap).toBe(CAP);
    expect(mrr(out).observed_state).toStrictEqual(level);
  });

  it('RED: a user level on cap 25,000 and a target raised past it (£40,000 → cap 50,000) → the level moves onto 50,000 with it', async () => {
    const g = clone(paul);
    mrr(g).observed_state = { value: 12000 / CAP, baseline: 12000 / CAP, unit: 'GBP MRR', source: USER_EDIT_SOURCE, raw_value: 12000, cap: CAP };
    const out = await targetWritten(g, 40000, 'GBP MRR', 'mrr');
    expect(mrr(out).goal_threshold).toBe(40000 / 50000);
    expect(mrr(out).observed_state).toStrictEqual({
      value: 12000 / 50000, baseline: 12000 / 50000, unit: 'GBP MRR', source: USER_EDIT_SOURCE, raw_value: 12000, cap: 50000,
    });
    // No user-sized link into this goal: Olumi's placeholders keep their β (never in natural units).
    expect(out.edges.filter((e) => e.to === 'mrr').map((e) => e.strength)).toStrictEqual(paul.edges.filter((e) => e.to === 'mrr').map((e) => e.strength));
  });
});

describe('R3 F5 I1.1 (#85 5933250962): the TOOL the model sees takes a level with no comparator — never "ask for a target first"', () => {
  const tool = () => AGENT_TOOLS.find((t) => t.name === TOOL)! as unknown as { description: string; parameters: { required: string[]; properties: Record<string, { description?: string }> } };
  it('RED: `goal_is` is NOT required (served fe8c9ab0 required it, so the model asked for a target instead of carding the level)', () => {
    expect(tool().parameters.required).toEqual(['goal_label', 'value', 'unit', 'user_stated']);
  });
  it('RED: its words say leave it out and record the level on its own — and never tell the model to ask first', () => {
    const words = String(tool().parameters.properties.goal_is?.description);
    expect(words).toMatch(/Otherwise leave it out/);
    expect(words).toMatch(/recorded on its own, with or without a target/);
    expect(words).not.toMatch(/If they have not said, ask them/);
  });
  it('CONTROL: the four comparators are still the only values it takes', () => {
    expect((tool().parameters.properties.goal_is as { enum?: unknown }).enum).toEqual(['at_least', 'above', 'at_most', 'below']);
  });
});

// ── (vi) DL 380e54's follow-ups on #2462 (5933850040; overflow reviewer 5933849652: "grounding verifies amount/currency, not
// the stated metric or period. Add same-currency wrong-goal and month/quarter negatives.") ──────────────────────────────────
const SERVED_D1 = JSON.parse(readFileSync(new URL('./fixtures/f5-d1-6bc6cae6-served-graph-20261001.json', import.meta.url), 'utf8')) as Graph;
const SERVED_GOAL_ID = 'quarterly_revenue';
const BRIEF_MARKETING = `${BRIEF} We could also raise our marketing spend.`;

/** Paul's D1 draft plus a same-currency quantity the user can state a figure for: "Marketing spend", £ per quarter. */
function draftWithMarketing() {
  const d = draft();
  d.factors.push({ label: 'Marketing spend', role: 'controllable', baseline_known: false, baseline_value: null as unknown as number, unit: UNIT, provenance: 'inferred', plausible_max: 500000 });
  d.links.push(link('Marketing spend', 'New enterprise customers'));
  return d;
}

/** Refused with nothing behind it: no card held, nothing registered, the goal node byte for byte as it was. */
async function levelRefused(initial: Graph, goalId: string, said: string, args: Rec): Promise<Rec> {
  const s = setup(initial, said);
  const before = clone(goalIn(initial, goalId));
  const r = await s.call(TOOL, { user_stated: true, ...args }) as Rec;
  expect(r.ok, JSON.stringify(r)).toBe(false);
  expect(r.mutated).toBe(false);
  expect(r).not.toHaveProperty('proposal_id');
  expect(s.proposals.outstanding(SCENARIO, null)).toEqual([]);
  expect(s.registers).toEqual([]);
  expect(goalIn(s.graph(), goalId)).toStrictEqual(before);
  return r;
}

describe('(vi-a) a same-currency figure written about ANOTHER quantity is never the goal\'s current level', () => {
  it('RED (the reviewer\'s row): "Our marketing spend is £100,000 a quarter." → the revenue goal\'s level is refused, nothing prepared', async () => {
    const built = await build(draftWithMarketing(), BRIEF_MARKETING);
    expect(built.nodes.filter((n) => n.label === 'Marketing spend' && n.kind === 'factor'), 'precondition: the model holds the other quantity').toHaveLength(1);
    const r = await levelRefused(built, D1_GOAL_ID, 'Our marketing spend is £100,000 a quarter.', { goal_label: 'Quarterly revenue', value: 100000, unit: '£' });
    expect(r.refusal).toBe('figure_not_about_the_goal');
  });

  it('RED (Paul\'s served D1 graph, sibling "revenue" outcomes): "Our enterprise deal revenue is £100,000 a quarter." → refused for "quarterly revenue"', async () => {
    const r = await levelRefused(SERVED_D1, SERVED_GOAL_ID, 'Our enterprise deal revenue is £100,000 a quarter.', { goal_label: 'quarterly revenue', value: 100000, unit: '£' });
    expect(r.refusal).toBe('figure_not_about_the_goal');
  });

  it('CONTROL (same graphs, same run): "Our quarterly revenue is £100,000." is still carded on both', async () => {
    const built = await build(draftWithMarketing(), BRIEF_MARKETING);
    for (const [g, label, id] of [[built, 'Quarterly revenue', D1_GOAL_ID], [SERVED_D1, 'quarterly revenue', SERVED_GOAL_ID]] as const) {
      const s = setup(g, SAID_1);
      const r = await s.call(TOOL, { goal_label: label, value: 100000, unit: '£', user_stated: true }) as Rec;
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(s.proposals.get(String(r.proposal_id))?.operations.map((o) => o.path)).toEqual([id]);
    }
  });

  it('CONTROL (binds by entity, not by amount): one message, two £ figures — the goal\'s carded, the marketing figure refused', async () => {
    const built = await build(draftWithMarketing(), BRIEF_MARKETING);
    const said = 'Our quarterly revenue is £100,000 and our marketing spend is £40,000 a quarter.';
    const s = setup(built, said);
    const ok = await s.call(TOOL, { goal_label: 'Quarterly revenue', value: 100000, unit: '£', user_stated: true }) as Rec;
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(s.proposals.get(String(ok.proposal_id))?.operations.map((o) => o.path)).toEqual([D1_GOAL_ID]);
    const r = await levelRefused(built, D1_GOAL_ID, said, { goal_label: 'Quarterly revenue', value: 40000, unit: '£' });
    expect(r.refusal).toBe('figure_not_about_the_goal');
  });
});

describe('(vi-b) a figure stated per MONTH is never recorded as the per-QUARTER goal\'s level', () => {
  const MONTHLY = 'Our monthly revenue is £100,000.';
  it.each(['£ per month', '£/month', 'GBP per month', 'GBP monthly'])('CONTROL (typed period): unit %j on "GBP per quarter" → unit_mismatch, nothing prepared', async (unit) => {
    const built = await build(draft(), BRIEF);
    const r = await levelRefused(built, D1_GOAL_ID, MONTHLY, { goal_label: 'Quarterly revenue', value: 100000, unit });
    expect(r.refusal).toBe('unit_mismatch');
  });

  it('CONTROL (typed period, unnamed-currency goal "currency/quarter"): "£ per month" → unit_mismatch, no currency adopted', async () => {
    const r = await levelRefused(SERVED_D1, SERVED_GOAL_ID, MONTHLY, { goal_label: 'quarterly revenue', value: 100000, unit: '£ per month' });
    expect(r.refusal).toBe('unit_mismatch');
  });

  /**
   * ⛔ KNOWN GAP, DECISION PENDING (MG / DL 380e54): with the period untyped (unit "£"), the door takes the goal's own period,
   * so a monthly £100,000 is carded as £100,000 per quarter. No typed evidence tells "monthly" from "quarterly" here: the
   * Agent's "£" is silent, the goal's label and unit are the goal's, and the written-about door reads entities, not periods.
   * `it.fails` pins it RED: whoever closes it flips this to `it`.
   */
  it.fails('KNOWN GAP (the period untyped): unit "£" for "Our monthly revenue is £100,000." → never a card recording £100,000 per quarter', async () => {
    const built = await build(draft(), BRIEF);
    await levelRefused(built, D1_GOAL_ID, MONTHLY, { goal_label: 'Quarterly revenue', value: 100000, unit: '£' });
  });
});
