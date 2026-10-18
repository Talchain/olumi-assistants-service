/**
 * ⭐ A (18 Oct; AIE 00:27/00:37, D2): a range Olumi chose for a factor is Olumi's computational reference — never a bound,
 * an encoding or a licence. Admission says so the same way for every such range (the existing `frame_source:
 * 'olumi_convention'`): the drafter's range the brief does not write and the unit does not encode, a defaulted range, and
 * a range widened to cover an option's level or (U3) the user's own limit. A range the brief writes, or a percentage's
 * 100 (its encoding), is not Olumi's and is not marked. A size the user stated in raw units does not depend on Olumi's
 * reference (P3). Synthetic brief; served through `buildModelFromBrief` → `/graph/register` → GraphV3 cold read →
 * canonical readiness → the prepared Run request, stopped before the engine (no engine or provider call).
 */
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { levelDomain } from '../../../cee/magnitude/link-effect.js';
import { createSetFactorValueHandler } from '../../tools/handlers/set-factor-value.js';

type Rec = Record<string, any>;
const SID = '41414141-4141-4141-8141-414141414141';
const PRICE = 'Monthly price';
const CANCEL = 'Weekly cancellations';
const SCORE = 'Satisfaction score';
const CHURN = 'Monthly churn rate';
const GOAL = 'Active subscribers';
const SIZE = 'Every £1 we add to the price brings about 2 more cancellations a week.';
const BRIEF = 'We are deciding whether to raise our monthly price from £20 to £25. We have 300 active subscribers and want at least '
  + `320 within 12 months. We see 6 cancellations a week and must keep them under 30 a week. ${SIZE} `
  + 'Our satisfaction score is 7, scored out of 10. Monthly churn rate is 4%.';

const s = (quote: string, subject: Rec, field: string, value: number | null, unit: string | null): Rec =>
  ({ quote, subject: { to_label: null, factor_label: null, ...subject }, field, form: 'point', value, low: null, high: null, unit, qualifier: null, conditions: null });

/** The drafter's ranges for price and cancellations, neither written in the brief nor fixed by the unit. */
type Ranges = { price: number; cancellations: number };
const BASE: Ranges = { price: 40, cancellations: 160 };
function wire(r: Ranges = BASE): Rec {
  const factor = (label: string, value: number, unit: string, max: number | null): Rec =>
    ({ label, role: label === PRICE ? 'controllable' : 'observable', baseline_known: true, baseline_value: value, unit, provenance: 'explicit', plausible_max: max });
  return {
    goal: { metric: GOAL, operator: '>=', target_stated: true, frame: 'level', value: 320, unit: 'subscribers', horizon_months: 12,
      provenance: 'explicit', baseline_known: true, baseline_value: 300, baseline_provenance: 'explicit', scope: null },
    constraints: [{ metric: CANCEL, operator: '<', value: 30, unit: 'cancellations per week', provenance: 'explicit', frame: 'level' }],
    options: [
      { label: 'Keep £20', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Raise to £25', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: PRICE, value: 25, value_kind: 'absolute', unit: '£ per month', provenance: 'explicit' }] },
    ],
    factors: [
      factor(PRICE, 20, '£ per month', r.price),
      factor(CANCEL, 6, 'cancellations per week', r.cancellations),
      factor(SCORE, 7, 'points', 10),
      factor(CHURN, 4, '%', 100),
    ],
    risks: [], outcomes: [],
    links: [
      { from: PRICE, to: CANCEL, direction: 'positive', provenance: 'explicit', effect_amount: 2, effect_per_source_change: 1, effect_provenance: 'explicit', source_quote: SIZE },
      { from: CANCEL, to: GOAL, direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: SCORE, to: GOAL, direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: CHURN, to: GOAL, direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
    ],
    identities: [], unknowns: [], decision_question: null,
    statements: [
      s(SIZE, { kind: 'link', label: PRICE, to_label: CANCEL }, 'effect', 2, 'cancellations per week'),
      s('We see 6 cancellations a week', { kind: 'factor', label: CANCEL }, 'level', 6, 'cancellations per week'),
      s('Our satisfaction score is 7, scored out of 10.', { kind: 'factor', label: SCORE }, 'level', 7, 'points'),
      s('Monthly churn rate is 4%.', { kind: 'factor', label: CHURN }, 'level', 4, '%'),
    ],
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
async function build(r: Ranges = BASE, brief = BRIEF, patch?: (w: Rec) => void): Promise<Rec> {
  const draft = wire(r);
  patch?.(draft);
  expect(strict(draft), JSON.stringify(strict.errors)).toBe(true);
  let graph: Rec | undefined;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SID, brief, d, (async () => ({ text: JSON.stringify(draft) })) as unknown as CallStructuredModel) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 2000)).toBe(true);
  return graph!;
}

/** The saved graph read cold, as the Run prepares its request, stopped before the engine. */
async function prepared(graph: Rec, brief = BRIEF): Promise<Rec | undefined> {
  const cold = GraphV3.parse(JSON.parse(JSON.stringify(graph)));
  await createAgentCapabilities((async () => ({ status: 200, json: { graph: cold, graph_hash: 'cold' } })) as never, new ProposalStore())
    .getCanonicalState({ scenario_id: SID, authenticated_user_id: null, request_id: 'cold', user_text: 'What is known?', user_turn_text: 'What is known?' } as never);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'cold', { loadGraphAndBriefText: async () => ({ graph: cold, briefText: brief }),
    readMostRecentPendingActions: async () => [] } as never);
  let request: Rec | undefined;
  let engineCalls = 0;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
    plotClient: { run: async () => { engineCalls++; throw Error('ENGINE'); }, validatePatch: async () => { throw Error('ENGINE'); } },
    probe: async (v: Rec) => { request = v.plotPayload; throw Error('STOP_AFTER_REQUEST'); } } as never);
  try {
    await handler({ payload: { scenario_id: SID, turn_id: 'cold', kind: 'message', message: 'Run analysis.' }, requestId: 'cold',
      signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  } catch { /* stopped at the request */ }
  expect(engineCalls).toBe(0);
  return request;
}

const idOf = (g: Rec, label: string): string => g.nodes.find((n: Rec) => n.label === label).id;
const nodeOf = (g: Rec, label: string): Rec => g.nodes.find((n: Rec) => n.label === label);

const factorsOf = (g: Rec): Rec[] => g.nodes.filter((n: Rec) => n.kind === 'factor');
const linkOf = (g: Rec): Rec => g.edges.find((e: Rec) => e.from === idOf(g, PRICE) && e.to === idOf(g, CANCEL));
/** What a reference may never change: each factor's raw level and unit, the user's words on it, and the size the user stated. */
const rawOf = (g: Rec): Rec => ({
  levels: factorsOf(g).map((n: Rec) => [n.label, n.observed_state.value * n.observed_state.cap, n.observed_state.raw_value, n.observed_state.unit]),
  // The user's words on each factor, as recorded (the recording time aside).
  words: JSON.parse(JSON.stringify(factorsOf(g).map((n: Rec) => [n.label, n.category, n.provenance, n.user_statements]),
    (k, v) => (k === 'recorded_at' ? undefined : v))),
  // The size the user stated, in their units (its reference-relative strength is `rawEffect`'s job).
  effect: (({ strength_mean: _s, ...said }) => said)(linkOf(g).provenance.natural_effect),
});
/** The size and spread the engine reads, in the target's raw unit per the source's raw unit. */
const rawEffect = (g: Rec): number[] => {
  const e = linkOf(g);
  const k = nodeOf(g, CANCEL).observed_state.cap / nodeOf(g, PRICE).observed_state.cap;
  return [e.strength.mean * k, e.strength.std * k];
};

describe('A: Olumi\'s range is its reference, said the same way; the user\'s raw-unit size does not depend on it', () => {
  it('W1/P1: the drafter\'s unwritten range is marked Olumi\'s; a range the brief writes, and a percentage\'s 100, are not', async () => {
    const g = await build();
    expect(nodeOf(g, PRICE).observed_state).toMatchObject({ cap: 40, frame_source: 'olumi_convention' });
    expect(nodeOf(g, CANCEL).observed_state).toMatchObject({ cap: 160, frame_source: 'olumi_convention' });
    // "scored out of 10": the user's range. 4%: the unit's encoding. Neither is Olumi's.
    expect(nodeOf(g, SCORE).observed_state).toMatchObject({ cap: 10 });
    expect(nodeOf(g, CHURN).observed_state).toMatchObject({ cap: 100 });
    expect(nodeOf(g, SCORE).observed_state).not.toHaveProperty('frame_source');
    expect(nodeOf(g, CHURN).observed_state).not.toHaveProperty('frame_source');
  });

  it('U3: a limit above Olumi\'s range widens it, so the user\'s limit is read inside it, and the range is marked Olumi\'s', async () => {
    const g = await build({ ...BASE, cancellations: 15 });
    expect(nodeOf(g, CANCEL).observed_state).toMatchObject({ cap: 100, raw_value: 6, frame_source: 'olumi_convention' });
    const request = (await prepared(g))!;
    const limit = request.goal_constraints.find((c: Rec) => c.node_id === idOf(g, CANCEL));
    expect(limit).toMatchObject({ value: 30, unit: 'cancellations per week' });
    expect(limit.value / request.graph.nodes.find((n: Rec) => n.id === idOf(g, CANCEL)).observed_state.cap).toBeLessThanOrEqual(1);
  });

  it('(d): a frame of 1 is a [0, 1] domain only beside a unit that states a share; Olumi\'s default 1 on "0.5 FTE" is no maximum', () => {
    for (const unit of ['fraction', 'share', 'proportion', 'share (0-1)']) expect(levelDomain(unit, 1), unit).toEqual({ lo: 0, hi: 1 });
    for (const unit of ['FTE', 'hours per week', undefined]) expect(levelDomain(unit, 1), String(unit)).toBeNull();
  });

  it('P3/P4: Olumi\'s references ×10, or one end ×2, leave every raw level, word, size, spread and limit of the prepared Run request unchanged', async () => {
    const arms = [BASE, { price: 400, cancellations: 1600 }, { price: 80, cancellations: 160 }];
    const requests = await Promise.all(arms.map(async (r) => (await prepared(await build(r)))!));
    const sent = requests.map((q) => q.graph as Rec);
    // The references differ (so β differs: 0.5, 0.5, 1) …
    expect(sent.map((g) => [nodeOf(g, PRICE).observed_state.cap, nodeOf(g, CANCEL).observed_state.cap])).toEqual([[40, 160], [400, 1600], [80, 160]]);
    expect(sent.map((g) => linkOf(g).strength.mean)).toEqual([0.5, 0.5, 1]);
    // … and nothing the user said, nor what it means in their units, moves with them.
    for (const g of sent.slice(1)) {
      expect(rawOf(g)).toEqual(rawOf(sent[0]!));
      for (const [i, v] of rawEffect(g).entries()) expect(v).toBeCloseTo(rawEffect(sent[0]!)[i]!, 12);
    }
    expect(rawEffect(sent[0]!)[0]).toBeCloseTo(2, 12);
    for (const q of requests) {
      expect(q.options).toEqual(requests[0]!.options);
      expect(q.goal_constraints).toEqual(requests[0]!.goal_constraints);
      // No clipping in any arm: every level, setting and limit sits inside its reference.
      const cap = (id: string): number => q.graph.nodes.find((n: Rec) => n.id === id).observed_state.cap;
      for (const n of factorsOf(q.graph)) expect(n.observed_state.raw_value).toBeLessThanOrEqual(n.observed_state.cap);
      for (const o of q.options) for (const [id, v] of Object.entries(o.interventions as Rec)) expect(v as number).toBeLessThanOrEqual(cap(id));
      for (const c of q.goal_constraints) expect(c.value).toBeLessThanOrEqual(cap(c.node_id));
    }
  });
});

/** The user's own figure for the price, through the chat writer, on the saved graph (it never mutates its input). */
async function setPrice(g: Rec, brief: string, value: number): Promise<Rec> {
  const price = nodeOf(g, PRICE);
  const out = await createSetFactorValueHandler()({
    context: { session_id: SID, stage: 'frame', request_id: 'edit', prior_turns: [], prior_facts: [], scenarioBriefText: brief, persistedGraph: null },
    payload: { kind: 'message', scenario_id: SID, turn_id: 'edit', stage: 'frame', message: `Monthly price is £${value} per month.` },
    requestId: 'edit', signal: new AbortController().signal, orientationText: '',
    proposal: { handler_id: 'set_factor_value', entity: { id: price.id, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
      parameters: [{ name: 'value', value: { value, unit: '£ per month' }, source: 'user_explicit' }], cited_context_fields: [] },
    graphForTurn: structuredClone(g),
  } as never) as Rec;
  return out.mutated_graph as Rec;
}
const edgeOf = (g: Rec, from: string, to: string): Rec => g.edges.find((e: Rec) => e.from === idOf(g, from) && e.to === idOf(g, to));
/** A link's size and spread as the engine reads them, in the target's raw unit per the source's raw unit. */
const rawSize = (g: Rec, from: string, to: string): number[] => {
  const k = nodeOf(g, to).observed_state.cap / nodeOf(g, from).observed_state.cap;
  return [edgeOf(g, from, to).strength.mean * k, edgeOf(g, from, to).strength.std * k];
};
/** Who sized a link and the words they used: everything on it but the reference-relative β of its natural size. */
const said = (g: Rec, from: string, to: string): Rec => {
  const { natural_effect: { strength_mean: _beta, ...words }, ...author } = edgeOf(g, from, to).provenance;
  return { author, words };
};

// A second stated size, INTO the price, so the carry is proven at both ends of the factor whose reference moves.
const SUPPLY = 'Supplier cost';
const PASS = 'Every £1 of supplier cost is passed on as about £1 on the monthly price.';
const B1_BRIEF = `${BRIEF} Our supplier cost is £8 a month. ${PASS}`;
const withSupplier = (w: Rec): void => {
  w.factors.push({ label: SUPPLY, role: 'observable', baseline_known: true, baseline_value: 8, unit: '£ per month', provenance: 'explicit', plausible_max: 20 });
  w.links.push({ from: SUPPLY, to: PRICE, direction: 'positive', provenance: 'explicit', effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'explicit', source_quote: PASS });
  w.statements.push(s(PASS, { kind: 'link', label: SUPPLY, to_label: PRICE }, 'effect', 1, '£ per month'),
    s('Our supplier cost is £8 a month.', { kind: 'factor', label: SUPPLY }, 'level', 8, '£ per month'));
};

describe('BUDDY-A #3396: widening Olumi\'s reference keeps every stated size (B1); only this factor\'s stated bound is the user\'s (B2)', () => {
  it('B1: the user\'s £60 widens Olumi\'s £40 reference and both stated sizes keep their raw effect and spread, saved, read cold and in the prepared Run', async () => {
    const g = await build(BASE, B1_BRIEF, withSupplier);
    const out = rawSize(g, PRICE, CANCEL);
    const into = rawSize(g, SUPPLY, PRICE);
    expect(out[0]).toBeCloseTo(2, 12);
    expect(into[0]).toBeCloseTo(1, 12);
    expect([edgeOf(g, PRICE, CANCEL), edgeOf(g, SUPPLY, PRICE)].map((e) => e.provenance.magnitude)).toEqual(['user_stated', 'user_stated']);
    const after = await setPrice(g, B1_BRIEF, 60);
    expect(nodeOf(after, PRICE).observed_state).toMatchObject({ raw_value: 60, cap: 75, frame_source: 'olumi_convention' });
    // The coordinates moved (β 0.5 → 0.9375 out of the price, 0.5 → 0.2667 into it) …
    expect(edgeOf(after, PRICE, CANCEL).strength.mean).toBeCloseTo(0.9375, 12);
    expect(edgeOf(after, SUPPLY, PRICE).strength.mean).toBeCloseTo(0.5 * 40 / 75, 12);
    // … and what the user said did not: author and words byte-equal, raw size and spread equal, saved and as the Run sends it.
    for (const [from, to] of [[PRICE, CANCEL], [SUPPLY, PRICE]] as const) expect(said(after, from, to)).toEqual(said(g, from, to));
    const request = (await prepared(after, B1_BRIEF))!;
    for (const graph of [after, request.graph as Rec]) {
      for (const [i, v] of rawSize(graph, PRICE, CANCEL).entries()) expect(v).toBeCloseTo(out[i]!, 12);
      for (const [i, v] of rawSize(graph, SUPPLY, PRICE).entries()) expect(v).toBeCloseTo(into[i]!, 12);
    }
  });

  it('B1 hold: where a stated size cannot be carried (£150 puts "2 per £1" past the contract on the widened reference), nothing is written', async () => {
    const g = await build(BASE, B1_BRIEF, withSupplier);
    const before = structuredClone(g);
    await expect(setPrice(g, B1_BRIEF, 150)).rejects.toMatchObject({ details: { d1_code: 'GRAPH_INVARIANT_VIOLATED', reason: 'untouched_level_rescaled' } });
    expect(g).toEqual(before);
  });

  it('B2: another quantity\'s £40 is no bound on the price; the reference stays Olumi\'s and the user\'s £60 widens it', async () => {
    const brief = `${BRIEF} Our marketing budget is £40 per month.`;
    const g = await build(BASE, brief);
    expect(nodeOf(g, PRICE).observed_state).toMatchObject({ cap: 40, frame_source: 'olumi_convention' });
    expect(nodeOf(await setPrice(g, brief, 60), PRICE).observed_state).toMatchObject({ raw_value: 60, cap: 75, frame_source: 'olumi_convention' });
  });

  it('B2 contrast: a range the brief states for the price ends at its bound, so it is the user\'s: not marked, and £60 above it is asked about', async () => {
    const brief = `${BRIEF} Our monthly price has ranged between £10 and £40 a month.`;
    const g = await build(BASE, brief);
    expect(nodeOf(g, PRICE).observed_state).toMatchObject({ cap: 40 });
    expect(nodeOf(g, PRICE).observed_state).not.toHaveProperty('frame_source');
    await expect(setPrice(g, brief, 60)).rejects.toMatchObject({ details: { rejection_reason: 'value_exceeds_cap' } });
  });

  it('B2 contrast: today\'s price written at the drafted range\'s end is a point, not a bound: the range stays Olumi\'s', async () => {
    const brief = BRIEF.replace('raise our monthly price from £20 to £25', 'cut our monthly price from £40 to £35');
    const g = await build(BASE, brief, (w) => {
      Object.assign(w.factors.find((f: Rec) => f.label === PRICE), { baseline_value: 40 });
      w.options = [{ label: 'Keep £40', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
        { label: 'Cut to £35', provenance: 'explicit', is_status_quo: null, changes: [],
          interventions: [{ factor_label: PRICE, value: 35, value_kind: 'absolute', unit: '£ per month', provenance: 'explicit' }] }];
    });
    expect(nodeOf(g, PRICE).observed_state).toMatchObject({ raw_value: 40, cap: 40, frame_source: 'olumi_convention' });
  });

  it('B2 at U3: another quantity\'s 15 does not stop the user\'s limit of 30 widening Olumi\'s 15', async () => {
    const g = await build({ ...BASE, cancellations: 15 }, `${BRIEF} We ship 15 parcels a week.`);
    expect(nodeOf(g, CANCEL).observed_state).toMatchObject({ cap: 100, raw_value: 6, frame_source: 'olumi_convention' });
  });
});

