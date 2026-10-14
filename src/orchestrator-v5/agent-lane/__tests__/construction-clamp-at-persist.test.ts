/**
 * ⭐ CLAMP AT PERSIST (DL #75 5924108406; R3 5924108105 / 5924114341 / 5924224429; AIQ 5924120672; CODEX 5924186955 /
 * 5924209469). A stored |mean| > 1 makes the whole model unwritable and its Run undeclarable on cold open. A link no refit
 * can fit is stored at ±1 with `provenance.clamped_from` = its full β; `natural_effect` stays byte-exact; every refit, the
 * F4 retirement and the run's wire copy re-derive from the marker first; a stale marker is dropped, never applied.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { NOT_REPRESENTABLE } from '../../../cee/magnitude/link-effect.js';
import { clampForPersist, refitFramesForStatedEffects, withStatedStrengths } from '../refit-frames.js';

type Rec = Record<string, any>;
const PAUL =
  "I need to accelerate securing funding within the next 2 months. We've been focused on investment firms that do deals "
  + "between £1-2 million, mostly based in the UK. We'll keep sending cold emails and trying to find warm connections, but I "
  + "want to explore alternatives to support the funding process, as we'll run out of money soon. For example, angel "
  + 'investors might be able to provide a small amount of funding quicker to buy us more time, but we would need to decide '
  + 'whether the overhead would be worth it.';

/** raw-1's shape with the funding quantity drafted as a FACTOR: the refit must refuse to widen it. */
function draft(direction: 'positive' | 'negative' = 'positive') {
  const amount = direction === 'positive' ? 1000000 : -1000000;
  return {
    goal: { metric: 'Funding secured', operator: '>=', target_stated: false, frame: 'level', value: null, unit: '£', horizon_months: 2,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'ai_proposed', scope: null },
    constraints: [],
    options: [
      { label: 'Continue investment-firm outreach', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Angel outreach pilot', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Hours per week on angel outreach', value: 5, value_kind: 'absolute', unit: 'hours/week', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: 'Hours per week on investment-firm outreach', role: 'controllable', baseline_known: true, baseline_value: 15, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 60 },
      { label: 'Hours per week on angel outreach', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 40 },
      { label: 'Funding from investment firms', role: 'external', baseline_known: false, baseline_value: null, unit: '£', provenance: 'inferred', plausible_max: 5000000 },
    ],
    risks: [],
    outcomes: [{ label: 'Investment-firm deals closed', provenance: 'inferred', unit: 'deals', plausible_max: 10 }],
    links: [
      { from: 'Hours per week on investment-firm outreach', to: 'Investment-firm deals closed', direction: 'positive', provenance: 'inferred', effect_amount: 0.05, effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null },
      { from: 'Investment-firm deals closed', to: 'Funding from investment firms', direction, provenance: 'inferred', effect_amount: amount, effect_per_source_change: 1, effect_provenance: 'explicit', definitional: null },
      { from: 'Funding from investment firms', to: 'Funding secured', direction: 'positive', provenance: 'inferred', effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: true },
    ],
    identities: [], unknowns: [], decision_question: null,
  };
}
async function build(d: Rec): Promise<{ g: Rec; out: Rec }> {
  let body: unknown = null;
  const call = (async () => ({ text: JSON.stringify(d) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('c1a3c1a3-0000-4c1a-8c1a-c1a3c1a3c1a3', PAUL, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 300)).toBe(true);
  return { g: body as Rec, out };
}
const DEAL = (g: Rec) => g.edges.find((e: Rec) => e.from === 'investment_firm_deals_closed' && e.to === 'funding_from_investment_firms');
const questionsOf = (o: unknown): string[] => (o === null || typeof o !== 'object' ? []
  : Object.entries(o as Rec).flatMap(([k, v]) => (k === 'open_questions' && Array.isArray(v) ? v as string[] : questionsOf(v))));

describe('a size no refit can fit is stored clamped, writable, the user\'s figure intact, and still asked', () => {
  it.each(['positive', 'negative'] as const)('RED (DL row, %s): refused into a FACTOR → stored ±1 + full β marked, writable, natural figure byte-exact, question kept', async (direction) => {
    const { isEditableGraph } = await import('../../system-events/editable-graph.js');
    const { g, out } = await build(draft(direction));
    const deal = DEAL(g);
    expect(deal.strength.mean).toBe(direction === 'positive' ? 1 : -1);
    expect(Math.abs(deal.provenance.clamped_from)).toBeGreaterThan(1);
    expect(Math.sign(deal.provenance.clamped_from)).toBe(Math.sign(deal.strength.mean));
    expect(deal.provenance.magnitude).toBe('user_stated');
    expect(deal.provenance.natural_effect.amount).toBe(direction === 'positive' ? 1000000 : -1000000);
    expect(deal.provenance.natural_effect.per_source_change).toBe(1);
    expect(deal.provenance.natural_effect.stated_range?.text).toBe('£1-2 million');
    expect(deal.provenance.natural_effect.strength_mean).toBe(deal.provenance.clamped_from);
    for (const e of g.edges) expect(Math.abs(e.strength.mean)).toBeLessThanOrEqual(1);
    expect(isEditableGraph(g)).toBe(true);
    expect(questionsOf(out).some((q) => q.includes(`${NOT_REPRESENTABLE}: it is cut short in the analysis.`))).toBe(true);
  });

  it('the marker survives the contract parse (CODEX: EdgeStrengthV3 is strict, so it rides the provenance)', async () => {
    const { g } = await build(draft());
    const parsed = GraphV3.parse(JSON.parse(JSON.stringify(g))) as unknown as Rec;
    expect(DEAL(parsed).provenance.clamped_from).toBe(DEAL(g).provenance.clamped_from);
  });
});

describe('every re-derivation starts from the full β, never the stored ±1', () => {
  const n = (id: string, kind: string, scale_frame: number) => ({ id, kind, label: id, scale_frame });
  /** A goal its own limit row names: construction's refit refuses to widen it, so the user's β 3 is stored clamped. */
  const built = (): Rec => clampForPersist(refitFramesForStatedEffects({
    nodes: [n('s', 'outcome', 10), n('g', 'goal', 1000)],
    edges: [{ from: 's', to: 'g', strength: { mean: 3, std: 1.5 }, provenance: { magnitude: 'user_stated', natural_effect: { amount: 300, per_source_change: 1, strength_mean: 3 } } }],
    goal_constraints: [{ node_id: 'g', operator: '>=', value: 500 }],
  }).graph);

  it('R3 row: stored ±1 + marker, then a refit that CAN fit it (the card path\'s goalOwnRows) → full β restored and fitted, marker dropped', () => {
    const stored = built();
    expect(stored.edges[0].strength).toEqual({ mean: 1, std: 0.5 });
    expect(stored.edges[0].provenance.clamped_from).toBe(3);
    const after = clampForPersist(refitFramesForStatedEffects(stored, { goalOwnRows: true }).graph);
    expect(after.nodes[1].scale_frame).toBe(5000);
    expect(after.edges[0].strength.mean).toBeCloseTo(0.6, 12); // 3 × 1000 / 5000: the full size, never 1 × 1000 / 5000
    expect(after.edges[0].strength.std).toBeCloseTo(0.3, 12);
    expect(after.edges[0].provenance.clamped_from).toBeUndefined();
  });

  it('a STALE marker (the strength was edited after the clamp) is dropped and the edit stands', () => {
    const stored = built();
    stored.edges[0].strength = { mean: 0.3, std: 0.15 };
    const read = withStatedStrengths(stored);
    expect(read.edges[0].strength).toEqual({ mean: 0.3, std: 0.15 });
    expect(read.edges[0].provenance.clamped_from).toBeUndefined();
  });

  it('a STALE marker (the user\'s size was re-answered: natural_effect moved) is dropped too', () => {
    const stored = built();
    stored.edges[0].provenance.natural_effect = { amount: 50, per_source_change: 1, strength_mean: 0.5 };
    stored.edges[0].strength = { mean: 1, std: 0.5 };
    expect(withStatedStrengths(stored).edges[0].strength.mean).toBe(1);
  });

  it('Olumi\'s refused DEFINITIONAL link is clamped the same way and keeps its origin (never promoted to the user\'s)', () => {
    const g = clampForPersist({ nodes: [n('s', 'outcome', 3000000), n('f', 'factor', 1250000)],
      edges: [{ from: 's', to: 'f', strength: { mean: 2.4, std: 1.2 }, provenance: { magnitude: 'olumi_estimate', definitional: true, natural_effect: { amount: 1, per_source_change: 1, strength_mean: 2.4 } } }] });
    expect(g.edges[0].strength.mean).toBe(1);
    expect(g.edges[0].provenance).toMatchObject({ magnitude: 'olumi_estimate', definitional: true, clamped_from: 2.4 });
  });
});

describe('the run sends PLoT the full β (wire copy only), so PLoT clamps, marks and withholds as it always did', () => {
  it('RED: run_analysis on a stored clamp (served c96fc4bb, £49 per subscriber stored at 1 with its full β marked) → PLoT gets the full β; the stored graph keeps 1', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRunAnalysisHandler } = await import('../../tools/handlers/run-analysis.js');
    const minimal = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/plot/v2-run-golden-minimal.json', import.meta.url), 'utf8'));
    const FX = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/served/c96fc4bb-saved-graph.json', import.meta.url), 'utf8')) as { goal_node_id: string; graph: Rec };
    const graph = structuredClone(FX.graph);
    const e = graph.edges.find((x: Rec) => x.from === 'paying_subscribers' && x.to === 'mrr');
    e.strength = { mean: 1, std: 0.5 };
    e.provenance = { ...(e.provenance ?? {}), magnitude: 'user_stated', clamped_from: 4.61, natural_effect: { amount: 49, per_source_change: 1, strength_mean: 4.61 } };
    const options = graph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => ({ id: n.id, option_id: n.id, label: n.label, interventions: { pro_plan_price: 59 } }));
    const snapshot = { graph: structuredClone(graph), options, goal_node_id: FX.goal_node_id, rawPersistedGraph: structuredClone(graph) };
    const runMock = vi.fn(async () => structuredClone(minimal));
    const handler = createRunAnalysisHandler({ plotClient: { run: runMock, validatePatch: vi.fn().mockResolvedValue({}) }, scenarioReader: async () => snapshot } as never);
    await handler({ payload: { scenario_id: 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4' }, requestId: 'req-clamp', signal: new AbortController().signal, context: {}, orientationText: '' } as never).catch((x: unknown) => x);
    expect(runMock).toHaveBeenCalledTimes(1);
    const sent = ((runMock.mock.calls as unknown[][])[0]![0] as { graph: Rec }).graph;
    const wire = sent.edges.find((x: Rec) => x.from === 'paying_subscribers' && x.to === 'mrr');
    expect(wire.strength.mean).toBe(4.61);
    expect(wire.provenance?.clamped_from).toBeUndefined();
    expect(snapshot.rawPersistedGraph.edges.find((x: Rec) => x.from === 'paying_subscribers' && x.to === 'mrr').strength.mean).toBe(1);
  });
});

/**
 * R3 5924224429: the analysis hash hashes provenance `source` / `magnitude` / `natural_effect.amount_unit` and the strength,
 * not the marker. Across set → clear (a later fit, incl. one landing at β exactly 1.0) → re-size, it moves iff what the run
 * computes or withholds moves.
 */
describe('the analysis hash across a clamp\'s life', () => {
  const n = (id: string, kind: string, scale_frame: number) => ({ id, kind, label: id, scale_frame });
  const g0 = (beta: number, goalFrame = 1000): Rec => ({
    nodes: [n('s', 'outcome', 10), n('g', 'goal', goalFrame)],
    edges: [{ from: 's', to: 'g', strength: { mean: beta, std: Math.abs(beta) / 2 }, provenance: { magnitude: 'user_stated', natural_effect: { amount: beta * goalFrame / 10, amount_unit: '£', per_source_change: 1, strength_mean: beta } } }],
    goal_constraints: [{ node_id: 'g', operator: '>=', value: 500 }],
  });
  const hash = async (g: Rec): Promise<string | null> => (await import('../../context/graph-hash.js')).computeAnalysisAffectingGraphHash(g as never);

  it('set: two refused sizes both stored at 1 hash alike (PLoT computes both at 1 and withholds both)', async () => {
    const a = clampForPersist(refitFramesForStatedEffects(g0(3)).graph);
    const b = clampForPersist(refitFramesForStatedEffects(g0(4)).graph);
    expect(a.edges[0].provenance.clamped_from).toBe(3);
    expect(b.edges[0].provenance.clamped_from).toBe(4);
    expect(await hash(a)).toBe(await hash(b));
  });

  it('clear: a later fit (goalOwnRows) moves the hash — the frame moves with the marker, incl. a fit landing at exactly 1.0', async () => {
    const set = clampForPersist(refitFramesForStatedEffects(g0(3)).graph);
    const cleared = clampForPersist(refitFramesForStatedEffects(set, { goalOwnRows: true }).graph);
    expect(cleared.edges[0].provenance.clamped_from).toBeUndefined();
    expect(await hash(cleared)).not.toBe(await hash(set));
    const set2 = clampForPersist(refitFramesForStatedEffects(g0(2)).graph);
    const at1 = clampForPersist(refitFramesForStatedEffects(set2, { goalOwnRows: true }).graph);
    expect(at1.edges[0].strength.mean).toBeCloseTo(1, 12); // 2 × 1000 / 2000: fitted at exactly 1.0, unmarked
    expect(at1.edges[0].provenance.clamped_from).toBeUndefined();
    expect(await hash(at1)).not.toBe(await hash(set2)); // the goal's frame moved 1000 → 2000
  });
});
