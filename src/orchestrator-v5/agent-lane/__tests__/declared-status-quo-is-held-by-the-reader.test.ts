/**
 * ⛔ THE READER MUST HOLD WHAT THE WRITER HELD — a DECLARED status quo, whatever its label.
 *
 * SERVED on CEE d5d5839, pricing scenario fcfaf7e0 (#69 5832119174). The constructor
 * declared "Keep £49 Pro Price" the status quo (`is_status_quo` → persisted
 * `is_baseline: true`), and admission held it with repair edges to `pro_plan_price` and
 * `59_price_exposure` (`wireInertStatusQuo` reads the DECLARATION first and the idiom
 * list only as a fallback). The Agent lane's reader was LABEL-only
 * (`labelMatchesBaseline`, which deliberately excludes "keep"), so it saw no status quo:
 *   - `missingPairs` demanded levels for it — the first starting point was refused
 *     `incomplete_starting_point`;
 *   - neither held guard fired — the approval wrote `pro_plan_price` = 0.245 (£49, the
 *     starting value) as `user_specified` and `59_price_exposure` = 0 onto the held
 *     status quo.
 *
 * The reader now mirrors the writer's order: the ONE declared option that carries at
 * least one repair-authored option→factor edge; otherwise the ONE idiom-labelled
 * option. Two declared → none. Assertions name options and pairs by id.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { structuralFacts } from '../structural-facts.js';
import { REPAIR_AUTHORED_ORIGIN, isRepairAuthoredOptionFactorEdge } from '../../../graph/repair-authored-edge.js';
import { CONNECTIVITY_REPAIR_WIRING_REASON } from '../../../cee/unified-pipeline/stages/repair/status-quo-fix.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';
import { labelMatchesBaseline } from '../../../cee/transforms/analysis-ready.js';
import { readIsBaseline } from '../../../cee/baseline-identity.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { slugId, type CandidateModel } from '../admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { nextRequest } from './fixtures/next-request.js';

const SCENARIO = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
/** What the user wrote in these rows: a figure is recorded as theirs only when it is here (`stated-by-user.ts`). */
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-declared', request_id: 'r', user_text: 'Carrying on, the price stays at £49, or we run a £45 promo.' };

type Edge = { from: string; to: string; origin?: string; provenance?: Record<string, unknown>; strength?: unknown; exists_probability?: number; effect_direction?: string };
type Node = {
  id: string; kind: string; label: string;
  observed_state?: Record<string, unknown>; scale_frame?: number; interventions?: Record<string, unknown>;
  is_baseline?: boolean; data?: Record<string, unknown>;
};

/** An ordinary (drafted or user-stated) link. */
const edge = (from: string, to: string): Edge => ({
  from, to,
  strength: { ...STRUCTURAL_EDGE_DEFAULTS.strength },
  exists_probability: STRUCTURAL_EDGE_DEFAULTS.exists_probability,
  effect_direction: STRUCTURAL_EDGE_DEFAULTS.effect_direction,
  provenance: { source: 'cee_hypothesis' },
});
/** The edge admission mints for a held status quo: `origin: 'repair'`, the repair's wording, no level. */
const held = (from: string, to: string): Edge => ({
  ...edge(from, to),
  origin: REPAIR_AUTHORED_ORIGIN,
  provenance: { source: 'cee_hypothesis', reasoning: CONNECTIVITY_REPAIR_WIRING_REASON },
});

const KEEP = 'keep_49_pro_price';
const KEEP_LABEL = 'Keep £49 Pro Price';
const PRICE = 'pro_plan_price';
const EXPOSURE = '59_price_exposure';

/**
 * The served pricing model, reduced to what the defect needs. `statusQuo` is the held
 * option; `extra` adds options. By default the status quo is DECLARED (`is_baseline:
 * true`) and wired to both factors by repair edges only — the served shape.
 */
function pricing(statusQuo: Partial<Node> = {}, opts: { sqEdges?: Edge[]; extraNodes?: Node[]; extraEdges?: Edge[] } = {}) {
  const sq: Node = { id: KEEP, kind: 'option', label: KEEP_LABEL, is_baseline: true, ...statusQuo };
  const nodes: Node[] = [
    { id: 'monthly_revenue', kind: 'goal', label: 'Monthly revenue' },
    { id: PRICE, kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: '£/month' } },
    { id: EXPOSURE, kind: 'factor', label: '£59 price exposure', observed_state: { value: 0, raw_value: 0, cap: 1, unit: 'share of customers' } },
    { id: 'raise_pro_to_59', kind: 'option', label: 'Raise Pro to £59' },
    { id: 'grandfather_at_49', kind: 'option', label: 'Grandfather current customers at £49' },
    sq,
    ...(opts.extraNodes ?? []),
  ];
  const edges: Edge[] = [
    edge('raise_pro_to_59', PRICE),
    edge('raise_pro_to_59', EXPOSURE),
    edge('grandfather_at_49', PRICE),
    edge('grandfather_at_49', EXPOSURE),
    ...(opts.sqEdges ?? [held(sq.id, PRICE), held(sq.id, EXPOSURE)]),
    edge(PRICE, 'monthly_revenue'),
    edge(EXPOSURE, 'monthly_revenue'),
    ...(opts.extraEdges ?? []),
  ];
  return { nodes, edges };
}

/** The product, faked at the dispatch seam (as `held-status-quo-gets-no-levels.test.ts`). */
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

const ORDINARY_LEVELS = [
  { option_label: 'Raise Pro to £59', factor_label: 'Pro plan price', value: 59, basis: 'the new price' },
  { option_label: 'Raise Pro to £59', factor_label: '£59 price exposure', value: 1, basis: 'every customer' },
  { option_label: 'Grandfather current customers at £49', factor_label: 'Pro plan price', value: 59, basis: 'new customers pay £59' },
  { option_label: 'Grandfather current customers at £49', factor_label: '£59 price exposure', value: 0.4, basis: 'new customers only' },
];
const ORDINARY_PATHS = [
  `grandfather_at_49::${EXPOSURE}`, `grandfather_at_49::${PRICE}`,
  `raise_pro_to_59::${EXPOSURE}`, `raise_pro_to_59::${PRICE}`,
];
const levelPaths = (store: ProposalStore, id: unknown) =>
  store.get(String(id))!.operations.filter((o) => o.op === 'set_option_intervention').map((o) => o.path).sort();

describe('vacuity: the served label is NOT an idiom, so only the declaration can hold it', () => {
  it('labelMatchesBaseline rejects the served label and the undeclared controls; accepts the idiom control', () => {
    expect([KEEP_LABEL, 'Hold Pro at £49', 'Use contractors', 'Raise Pro to £59', 'Grandfather current customers at £49'].filter(labelMatchesBaseline)).toEqual([]);
    expect(labelMatchesBaseline('Maintain current pricing')).toBe(true);
  });

  it('the served fixture carries the declaration as the shared reader reads it', () => {
    const sq = pricing().nodes.find((n) => n.id === KEEP)!;
    expect(readIsBaseline(sq)).toBe(true);
    // data-surface form of the same declaration (the reader's other surface)
    expect(readIsBaseline({ data: { is_baseline: true } })).toBe(true);
  });
});

describe('(1) the served pricing shape: a DECLARED "Keep £49 Pro Price" held by repair edges', () => {
  it('RED: structuralFacts reports it in status_quo_held, not in options_that_change_nothing', () => {
    const { nodes, edges } = pricing();
    const f = structuralFacts(nodes, edges);
    expect(f.status_quo_held).toEqual([KEEP_LABEL]);
    expect(f.options_that_change_nothing).toEqual(['Raise Pro to £59', 'Grandfather current customers at £49']);
  });

  it('RED: …the same holds when the declaration is on the data surface only', () => {
    const { nodes, edges } = pricing({ is_baseline: undefined, data: { is_baseline: true } });
    expect(structuralFacts(nodes, edges).status_quo_held).toEqual([KEEP_LABEL]);
  });

  it('RED: get_canonical_state carries it — the declaration survives the read the Agent is given', async () => {
    const { nodes, edges } = pricing();
    const caps = createAgentCapabilities(fakeProduct(nodes, edges).d, new ProposalStore());
    const s = (await caps.getCanonicalState(ctx)).structure as { status_quo_held: string[]; options_that_change_nothing: string[] };
    expect(s.status_quo_held).toEqual([KEEP_LABEL]);
    expect(s.options_that_change_nothing).not.toContain(KEEP_LABEL);
  });

  it('RED: missingPairs does not ask for its levels — a starting point without status-quo levels is complete', async () => {
    const { nodes, edges } = pricing();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(fakeProduct(nodes, edges).d, store);
    const r = await caps.proposeStartingPoint(ctx, { assumptions: [], option_levels: ORDINARY_LEVELS });
    expect(r.refusal, JSON.stringify(r.options_missing_levels)).toBeUndefined();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('options_missing_levels');
    expect(levelPaths(store, r.proposal_id)).toEqual(ORDINARY_PATHS);
  });

  it('RED: an UNFLAGGED level on it (the served £49) is refused, nothing is stored, and it says why', async () => {
    const { nodes, edges } = pricing();
    const p = fakeProduct(nodes, edges);
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: KEEP_LABEL, factor_label: 'Pro plan price', value: 49, basis: 'the current price' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('nothing_to_set');
    expect(r.levels_not_accepted).toEqual([{
      option: KEEP_LABEL, factor: 'Pro plan price', value: 49,
      reason: `${KEEP_LABEL} is held at its starting values — carrying on as now sets no level, so none is recorded for Pro plan price. Leave it out, unless the user themselves said carrying on changes Pro plan price and gave the level: then send it with user_stated: true.`,
    }]);
    expect(store.size()).toBe(0);
    expect(p.posted).toEqual([]);
  });

  it('RED: a FLAGGED level equal to its starting value (49) is refused as a restatement', async () => {
    const { nodes, edges } = pricing();
    const p = fakeProduct(nodes, edges);
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: KEEP_LABEL, factor_label: 'Pro plan price', value: 49, basis: 'the user: it stays at £49', user_stated: true }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('nothing_to_set');
    expect(r.levels_not_accepted).toEqual([{
      option: KEEP_LABEL, factor: 'Pro plan price', value: 49,
      reason: `${KEEP_LABEL} already keeps Pro plan price at its starting value, 49. Recording that as a level changes nothing today, and would stop carrying on as now from following a later correction to the starting value, so none is recorded. Leave it out.`,
    }]);
    expect(store.size()).toBe(0);
    expect(p.posted).toEqual([]);
  });

  it('CONTRAST: a FLAGGED DIFFERENT figure (45) is still recorded as the user’s correction', async () => {
    const { nodes, edges } = pricing();
    const p = fakeProduct(nodes, edges);
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: KEEP_LABEL, factor_label: 'Pro plan price', value: 45, basis: 'the user: carrying on means a £45 promo', user_stated: true }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('levels_not_accepted');
    expect((await caps.authoriseChange(nextRequest(ctx), { proposal_id: String(r.proposal_id) })).ok).toBe(true);
    expect(p.posted).toEqual([`level ${KEEP}::${PRICE}`]);
    expect(p.read().find((n) => n.id === KEEP)?.interventions).toEqual({ [PRICE]: { value: 45 / 200 } });
  });

  it('RED (the served journey): the Agent’s starting point with £49 and 0 on the status quo — ONE approval writes neither', async () => {
    const { nodes, edges } = pricing();
    const p = fakeProduct(nodes, edges);
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, {
      assumptions: [],
      option_levels: [
        ...ORDINARY_LEVELS,
        { option_label: KEEP_LABEL, factor_label: 'Pro plan price', value: 49, basis: 'the current price' },
        { option_label: KEEP_LABEL, factor_label: '£59 price exposure', value: 0, basis: 'nobody pays £59' },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.levels_not_accepted).toEqual([
      expect.objectContaining({ option: KEEP_LABEL, factor: 'Pro plan price', value: 49 }),
      expect.objectContaining({ option: KEEP_LABEL, factor: '£59 price exposure', value: 0 }),
    ]);
    expect(levelPaths(store, r.proposal_id)).toEqual(ORDINARY_PATHS);
    expect((await caps.authoriseChange(nextRequest(ctx), { proposal_id: String(r.proposal_id) })).ok).toBe(true);
    expect(p.posted.filter((x) => x.startsWith(`level ${KEEP}::`))).toEqual([]);
    expect(p.read().find((n) => n.id === KEEP)).not.toHaveProperty('interventions');
  });

  it('CONTRAST: the identical model WITHOUT the declaration is not held (the flag is what discriminates) — its levels are demanded', async () => {
    const { nodes, edges } = pricing({ is_baseline: undefined });
    expect(structuralFacts(nodes, edges).status_quo_held).toEqual([]);
    const caps = createAgentCapabilities(fakeProduct(nodes, edges).d, new ProposalStore());
    const r = await caps.proposeStartingPoint(ctx, { assumptions: [], option_levels: ORDINARY_LEVELS });
    expect(r.refusal).toBe('incomplete_starting_point');
    expect(r.options_missing_levels).toEqual([
      { option: KEEP_LABEL, factor: 'Pro plan price' },
      { option: KEEP_LABEL, factor: '£59 price exposure' },
    ]);
  });

  it('CONTRAST: an explicit is_baseline:false is not a declaration', () => {
    const { nodes, edges } = pricing({ is_baseline: false });
    expect(structuralFacts(nodes, edges).status_quo_held).toEqual([]);
  });
});

/**
 * The fixture above is self-authored. This one is not: the graph is what admission
 * REGISTERS for a declared status quo (`buildModelFromBrief` → `/graph/register` →
 * `GraphV3`), so the reader is bound to the writer's own bytes. No model is called —
 * the drafter is a fake returning a fixed candidate.
 */
describe('writer → reader: what admission mints for a declared status quo is what the reader holds', () => {
  const candidate = (): CandidateModel => ({
    goal: { metric: 'Monthly revenue', operator: '>=', target_stated: false, value: null, unit: '£', horizon_months: null, provenance: 'explicit' },
    constraints: [],
    options: [
      {
        label: 'Raise Pro to £59', provenance: 'explicit', changes: [], is_status_quo: null,
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: '£/month', provenance: 'explicit' }],
      },
      { label: KEEP_LABEL, provenance: 'explicit', changes: [], interventions: [], is_status_quo: true },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: '£/month', provenance: 'explicit', plausible_max: 200 },
    ],
    risks: [], outcomes: [],
    links: [{ from: 'Pro plan price', to: 'Monthly revenue', direction: 'positive', provenance: 'inferred' }],
  } as unknown as CandidateModel);

  async function registered() {
    let graph: unknown = null;
    const call = (async () => ({ text: JSON.stringify({ ...candidate(), unknowns: [] }) })) as unknown as CallStructuredModel;
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    };
    const out = await buildModelFromBrief(SCENARIO, 'Should we raise Pro from £49 to £59?', d, call) as Record<string, unknown>;
    expect(out.ok, JSON.stringify(out)).toBe(true);
    return GraphV3.parse(graph) as unknown as { nodes: Node[]; edges: Edge[] };
  }

  it('PRECONDITION: the writer declared and held it — is_baseline stamped, repair edge minted', async () => {
    const g = await registered();
    const id = slugId(KEEP_LABEL);
    const kinds = new Map(g.nodes.map((n) => [n.id, n.kind]));
    expect(readIsBaseline(g.nodes.find((n) => n.id === id)!)).toBe(true);
    expect(g.edges.filter((e) => e.from === id && isRepairAuthoredOptionFactorEdge(e, kinds)).map((e) => e.to)).toEqual(['pro_plan_price']);
  });

  it('RED: the reader holds it — status_quo_held, and an unflagged level on it is refused', async () => {
    const g = await registered();
    const id = slugId(KEEP_LABEL);
    expect(structuralFacts(g.nodes, g.edges).status_quo_held).toEqual([KEEP_LABEL]);
    const p = fakeProduct(g.nodes, g.edges);
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: KEEP_LABEL, factor_label: 'Pro plan price', value: 49, basis: 'the current price' }],
    });
    expect(r.refusal, JSON.stringify(r)).toBe('nothing_to_set');
    expect(r.levels_not_accepted).toEqual([expect.objectContaining({ option: KEEP_LABEL, factor: 'Pro plan price', value: 49 })]);
    expect(p.posted.filter((x) => x.startsWith(`level ${id}::`))).toEqual([]);
  });
});

describe('(2) the idiom path is unchanged — an UNDECLARED idiom-labelled status quo is still held', () => {
  const idiom = () => pricing({ id: 'maintain_current_pricing', label: 'Maintain current pricing', is_baseline: undefined });

  it('CONTROL: structuralFacts holds it', () => {
    const { nodes, edges } = idiom();
    expect(structuralFacts(nodes, edges).status_quo_held).toEqual(['Maintain current pricing']);
  });

  it('CONTROL: a starting point without its levels is complete, and an unflagged level on it is refused', async () => {
    const { nodes, edges } = idiom();
    const caps = createAgentCapabilities(fakeProduct(nodes, edges).d, new ProposalStore());
    const sp = await caps.proposeStartingPoint(ctx, { assumptions: [], option_levels: ORDINARY_LEVELS });
    expect(sp.ok, JSON.stringify(sp)).toBe(true);
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Maintain current pricing', factor_label: 'Pro plan price', value: 49, basis: 'as now' }],
    });
    expect(r.refusal).toBe('nothing_to_set');
  });
});

describe('(3) controls that must stay NOT held', () => {
  it('CONTROL: an undeclared "Use contractors" with repair edges only is NOT held — repair alone is not enough', async () => {
    const { nodes, edges } = pricing({ id: 'use_contractors', label: 'Use contractors', is_baseline: undefined });
    const f = structuralFacts(nodes, edges);
    expect(f.status_quo_held).toEqual([]);
    expect(f.options_that_change_nothing).toContain('Use contractors');
    const store = new ProposalStore();
    const caps = createAgentCapabilities(fakeProduct(nodes, edges).d, store);
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Use contractors', factor_label: 'Pro plan price', value: 55, basis: 'a guess' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.get(String(r.proposal_id))!.operations.map((o) => o.path)).toEqual([`use_contractors::${PRICE}`]);
  });

  describe('TWO declared options — ambiguity is not guessed, neither is held', () => {
    const twoDeclared = () => pricing({}, {
      extraNodes: [{ id: 'hold_pro_at_49', kind: 'option', label: 'Hold Pro at £49', is_baseline: true }],
      extraEdges: [held('hold_pro_at_49', PRICE), held('hold_pro_at_49', EXPOSURE)],
    });

    it('CONTROL: structuralFacts holds neither', () => {
      const { nodes, edges } = twoDeclared();
      const f = structuralFacts(nodes, edges);
      expect(f.status_quo_held).toEqual([]);
      expect(f.options_that_change_nothing).toEqual(expect.arrayContaining([KEEP_LABEL, 'Hold Pro at £49']));
    });

    it('CONTROL: the level guards hold neither — an unflagged level on the FIRST declared option is accepted', async () => {
      const { nodes, edges } = twoDeclared();
      const store = new ProposalStore();
      const caps = createAgentCapabilities(fakeProduct(nodes, edges).d, store);
      const r = await caps.proposeOptionInterventions(ctx, {
        interventions: [{ option_label: KEEP_LABEL, factor_label: 'Pro plan price', value: 49, basis: 'as now' }],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(store.get(String(r.proposal_id))!.operations.map((o) => o.path)).toEqual([`${KEEP}::${PRICE}`]);
    });

    it('RED: two declarations do not fall back to the idiom list — a declared idiom beside a declared non-idiom is not held either', () => {
      const { nodes, edges } = pricing({}, {
        extraNodes: [{ id: 'maintain_current_pricing', kind: 'option', label: 'Maintain current pricing', is_baseline: true }],
        extraEdges: [held('maintain_current_pricing', PRICE), held('maintain_current_pricing', EXPOSURE)],
      });
      expect(structuralFacts(nodes, edges).status_quo_held).toEqual([]);
    });
  });

  it('RED: a declared option with an ORDINARY edge to a factor keeps THAT pair un-held; its repair pair stays held', async () => {
    const { nodes, edges } = pricing({}, { sqEdges: [held(KEEP, PRICE), edge(KEEP, EXPOSURE)] });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(fakeProduct(nodes, edges).d, store);
    // missingPairs: the ordinary pair is demanded, the repair pair is not.
    const sp = await caps.proposeStartingPoint(ctx, { assumptions: [], option_levels: ORDINARY_LEVELS });
    expect(sp.refusal).toBe('incomplete_starting_point');
    expect(sp.options_missing_levels).toEqual([{ option: KEEP_LABEL, factor: '£59 price exposure' }]);
    // The ordinary pair takes an unflagged level; the repair pair refuses one.
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [
        { option_label: KEEP_LABEL, factor_label: '£59 price exposure', value: 0.1, basis: 'the user: some already pay £59' },
        { option_label: KEEP_LABEL, factor_label: 'Pro plan price', value: 49, basis: 'as now' },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.get(String(r.proposal_id))!.operations.map((o) => o.path)).toEqual([`${KEEP}::${EXPOSURE}`]);
    expect(r.levels_not_accepted).toEqual([expect.objectContaining({ option: KEEP_LABEL, factor: 'Pro plan price', value: 49 })]);
  });
});

/**
 * ⛔ ONE WRONG FLAG MUST NOT BLOCK WHAT BASE HELD — the writer's rule (review 5825562938,
 * B1), mirrored. A declared option admission could not hold carries no repair edge; the
 * reader then falls back to the idiom list exactly as if nothing were declared.
 */
describe('(4) declared-but-unholdable → the idiom fallback', () => {
  const misflag = () => {
    const { nodes, edges } = pricing({ id: 'maintain_current_pricing', label: 'Maintain current pricing', is_baseline: undefined });
    return { nodes: nodes.map((n) => (n.id === 'raise_pro_to_59' ? { ...n, is_baseline: true } : n)), edges };
  };

  it('CONTROL: a flagged option with no repair edge does not stop the idiom status quo being held', () => {
    const { nodes, edges } = misflag();
    const f = structuralFacts(nodes, edges);
    expect(f.status_quo_held).toEqual(['Maintain current pricing']);
    expect(f.options_that_change_nothing).toContain('Raise Pro to £59');
  });

  it('CONTROL: …and the level guards follow it — the idiom status quo is not demanded; the misflagged lever still is', async () => {
    const { nodes, edges } = misflag();
    const caps = createAgentCapabilities(fakeProduct(nodes, edges).d, new ProposalStore());
    const sp = await caps.proposeStartingPoint(ctx, { assumptions: [], option_levels: ORDINARY_LEVELS.filter((l) => l.option_label !== 'Raise Pro to £59') });
    expect(sp.refusal).toBe('incomplete_starting_point');
    expect(sp.options_missing_levels).toEqual([
      { option: 'Raise Pro to £59', factor: 'Pro plan price' },
      { option: 'Raise Pro to £59', factor: '£59 price exposure' },
    ]);
  });
});
