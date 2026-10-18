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
async function build(r: Ranges = BASE): Promise<Rec> {
  const draft = wire(r);
  expect(strict(draft), JSON.stringify(strict.errors)).toBe(true);
  let graph: Rec | undefined;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SID, BRIEF, d, (async () => ({ text: JSON.stringify(draft) })) as unknown as CallStructuredModel) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 2000)).toBe(true);
  return graph!;
}

/** The saved graph read cold, as the Run prepares its request, stopped before the engine. */
async function prepared(graph: Rec): Promise<Rec | undefined> {
  const cold = GraphV3.parse(JSON.parse(JSON.stringify(graph)));
  await createAgentCapabilities((async () => ({ status: 200, json: { graph: cold, graph_hash: 'cold' } })) as never, new ProposalStore())
    .getCanonicalState({ scenario_id: SID, authenticated_user_id: null, request_id: 'cold', user_text: 'What is known?', user_turn_text: 'What is known?' } as never);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'cold', { loadGraphAndBriefText: async () => ({ graph: cold, briefText: BRIEF }),
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
