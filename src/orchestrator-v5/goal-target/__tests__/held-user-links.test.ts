/**
 * ⭐ D3 cut 6, HOLD-AT-1.0 (Science d5 #87 6008807178 / 6008817484): a USER-stated link whose own stated range excludes
 * zero holds at exists_probability 1.0 on the Run's input, with sd_β = |β(high) − β(low)| / 3.29 and the mean left at the
 * STATED value. One function: the PLoT payload, the licence's existence flag and the input snapshot all read it; the
 * persisted graph is untouched. No range → no hold (never mean ± k·std: circular).
 */
import { describe, expect, it } from 'vitest';
import { heldLinkOf, withHeldUserLinks } from '../held-user-links.js';
import { goalChanceLicenceOf, userStatedLinksBelowOne } from '../goal-chance-licence.js';

type Rec = Record<string, any>;
/** The user wrote "20 to 40 subscribers per £1"; the low end (20) is the size the link carries (A4), β 0.3 on its frame. */
const ranged = (low: number, high: number, amount = low): Rec => ({
  amount, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: '£', strength_mean: 0.3 * (amount / 20),
  strength_mean_frame: 'edge_strength', stated_range: { low, high, text: `${low} to ${high}`, end: 'low' },
});
const userLink = (from: string, to: string, ne: Rec | undefined, exists = 0.8): Rec => ({
  from, to, strength: { mean: ne?.strength_mean ?? 0.6, std: 0.15 }, exists_probability: exists,
  provenance: { source: 'user_specified', magnitude: 'user_stated', ...(ne !== undefined ? { natural_effect: ne } : {}) },
});
const sdOf = (low: number, high: number): number => Math.abs(0.3 * (high / 20) - 0.3 * (low / 20)) / 3.29;

describe('hold-at-1.0: a user link whose own range excludes zero holds on the Run input', () => {
  it('HELD: user-sized, range 20 to 40 → exists 1.0, sd_β = |β(40) − β(20)| / 3.29, the mean stays the stated β', () => {
    const e = userLink('price', 'subs', ranged(20, 40));
    expect(heldLinkOf(e)).toEqual({ std: sdOf(20, 40) });
    const g = withHeldUserLinks({ nodes: [], edges: [e] });
    expect(g.edges[0].exists_probability).toBe(1);
    expect(g.edges[0].strength.std).toBeCloseTo(sdOf(20, 40), 12);
    // Mutant "midpoint mean" → RED: the mean is the user's stated end, never (low + high) / 2.
    expect(g.edges[0].strength.mean).toBe(0.3);
  });
  it('a NEGATIVE range (−40 to −20) excludes zero too → held', () => {
    expect(heldLinkOf(userLink('price', 'churn', ranged(-40, -20, -40)))).toEqual({ std: sdOf(-40, -20) });
  });
  it('CONTRAST: a range that STRADDLES zero (−5 to 10) → not held, the edge is byte-identical', () => {
    const e = userLink('price', 'subs', ranged(-5, 10, 10));
    expect(heldLinkOf(e)).toBeNull();
    const g = { nodes: [], edges: [e] };
    expect(withHeldUserLinks(g)).toBe(g);
  });
  it('a range touching zero (0 to 10) does not exclude it → not held', () => {
    expect(heldLinkOf(userLink('price', 'subs', ranged(0, 10, 10)))).toBeNull();
  });
  it('NO RANGE → no hold, whatever the size or spread (never mean ± k·std)', () => {
    const ne = ranged(20, 40);
    delete ne.stated_range;
    expect(heldLinkOf(userLink('price', 'subs', ne))).toBeNull();
    expect(heldLinkOf(userLink('price', 'subs', undefined))).toBeNull();
  });
  it('CLASS: an Olumi estimate carrying a range → not held; a brief-quoted link → held; brief WITHOUT its quote → not', () => {
    const olumi = { ...userLink('price', 'subs', ranged(20, 40)), provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: ranged(20, 40) } };
    expect(heldLinkOf(olumi)).toBeNull();
    const brief = { ...userLink('price', 'subs', ranged(20, 40)), provenance: { source: 'brief_extraction', source_quote: 'each £1 brings 20 to 40 subscribers', natural_effect: ranged(20, 40) } };
    expect(heldLinkOf(brief)).toEqual({ std: sdOf(20, 40) });
    expect(heldLinkOf({ ...brief, provenance: { ...brief.provenance, source_quote: '  ' } })).toBeNull();
  });
  it('the PERSISTED graph is never written: the input is not mutated and a held graph is a new object', () => {
    const e = userLink('price', 'subs', ranged(20, 40));
    const g = { nodes: [], edges: [e] };
    const before = structuredClone(g);
    const out = withHeldUserLinks(g);
    expect(out).not.toBe(g);
    expect(g).toEqual(before);
  });
  it('MC 21\'s RESHAPED link (DL: hold → MC PR-1): switch × count, "about 150, between 80 and 250" (end: centre) → held', () => {
    // The mean is the stated POINT (150), never the range's midpoint (165); each end maps through the same per-unit β.
    const beta150 = 0.45;
    const ne = { amount: 150, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'switch', strength_mean: beta150,
      strength_mean_frame: 'edge_strength', stated_range: { low: 80, high: 250, text: 'about 150, between 80 and 250', end: 'centre' } };
    const e = userLink('switch', 'subs', ne);
    const sd = Math.abs(beta150 * 250 / 150 - beta150 * 80 / 150) / 3.29;
    expect(heldLinkOf(e)?.std).toBeCloseTo(sd, 12);
    const out = withHeldUserLinks({ nodes: [], edges: [e] });
    expect(out.edges[0]).toMatchObject({ exists_probability: 1, strength: { mean: beta150 } });
  });
  it('mutant "default spread on a held link" → RED: the held std is the range\'s, never the edge\'s prior 0.15', () => {
    const out = withHeldUserLinks({ nodes: [], edges: [userLink('price', 'subs', ranged(20, 40))] });
    expect(out.edges[0].strength.std).not.toBe(0.15);
  });
});

describe('the licence reads the SAME hold: a held link never counts as Olumi\'s doubt', () => {
  const graph = (edges: Rec[]): Rec => ({ nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_raw: 20000, goal_threshold: 0.5, goal_threshold_unit: '£', goal_direction: '>=' },
    { id: 'price', kind: 'factor', label: 'Price' }, { id: 'subs', kind: 'factor', label: 'Subscribers' },
    { id: 'a', kind: 'option', label: 'Raise', interventions: { price: { value: 0.6 } } },
    { id: 'b', kind: 'option', label: 'Starter', interventions: { price: { value: 0.4 } } },
  ], edges });
  const env = { option_comparison: [['a', 0.5], ['b', 0.35]].map(([id, p]) => ({ option_id: id, id, probability_of_goal: p, win_probability: 0.5 })), inference_warnings: [] };
  it('TWIN (the deterministic line-absent case): both path links ranged off zero → no flag', () => {
    const edges = [userLink('price', 'subs', ranged(20, 40)), userLink('subs', 'mrr', ranged(20, 40))];
    expect(userStatedLinksBelowOne(graph(edges), 'mrr', ['a', 'b'])).toEqual([]);
    expect(goalChanceLicenceOf(env, graph(edges), 'mrr')?.user_link_existence).toBeUndefined();
  });
  it('CONTRAST: the same links with no range → both counted, 1-in-5', () => {
    const edges = [userLink('price', 'subs', undefined), userLink('subs', 'mrr', undefined)];
    expect(goalChanceLicenceOf(env, graph(edges), 'mrr')?.user_link_existence).toEqual({ links: 2, one_in: 5 });
  });
  it('one held, one not → the count is the unheld one only', () => {
    const edges = [userLink('price', 'subs', ranged(20, 40)), userLink('subs', 'mrr', undefined)];
    expect(goalChanceLicenceOf(env, graph(edges), 'mrr')?.user_link_existence).toEqual({ links: 1, one_in: 5 });
  });
});

describe('the Run sends PLoT the held copy (wire only); the persisted graph keeps the user\'s 0.8', () => {
  const sendOn = async (edit: (e: Rec) => void): Promise<{ wire: Rec; persisted: Rec }> => {
    const { readFileSync } = await import('node:fs');
    const { vi } = await import('vitest');
    const { createRunAnalysisHandler } = await import('../../tools/handlers/run-analysis.js');
    const minimal = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/plot/v2-run-golden-minimal.json', import.meta.url), 'utf8'));
    const FX = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/served/c96fc4bb-saved-graph.json', import.meta.url), 'utf8')) as { goal_node_id: string; graph: Rec };
    const graph = structuredClone(FX.graph);
    edit(graph.edges.find((x: Rec) => x.from === 'paying_subscribers' && x.to === 'mrr'));
    const options = graph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => ({ id: n.id, option_id: n.id, label: n.label, interventions: { pro_plan_price: 59 } }));
    const snapshot = { graph: structuredClone(graph), options, goal_node_id: FX.goal_node_id, rawPersistedGraph: structuredClone(graph) };
    const runMock = vi.fn(async () => structuredClone(minimal));
    const handler = createRunAnalysisHandler({ plotClient: { run: runMock, validatePatch: vi.fn().mockResolvedValue({}) }, scenarioReader: async () => snapshot } as never);
    await handler({ payload: { scenario_id: 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4' }, requestId: 'req-hold', signal: new AbortController().signal, context: {}, orientationText: '' } as never).catch((x: unknown) => x);
    expect(runMock).toHaveBeenCalledTimes(1);
    const sent = ((runMock.mock.calls as unknown[][])[0]![0] as { graph: Rec }).graph;
    return { wire: sent.edges.find((x: Rec) => x.from === 'paying_subscribers' && x.to === 'mrr'),
      persisted: snapshot.rawPersistedGraph.edges.find((x: Rec) => x.from === 'paying_subscribers' && x.to === 'mrr') };
  };

  it('a ranged user link (20 to 40) → PLoT gets exists 1.0 and the range\'s sd at the stated mean; the stored link keeps 0.8', async () => {
    const { wire, persisted } = await sendOn((e) => {
      e.strength = { mean: 0.3, std: 0.15 };
      e.exists_probability = 0.8;
      e.provenance = { source: 'user_specified', magnitude: 'user_stated', natural_effect: ranged(20, 40) };
    });
    expect(wire.exists_probability).toBe(1);
    expect(wire.strength.mean).toBe(0.3);
    expect(wire.strength.std).toBeCloseTo(sdOf(20, 40), 12);
    expect(persisted.exists_probability).toBe(0.8);
    expect(persisted.strength.std).toBe(0.15);
  });

  it('CONTRAST: the same link with no range is sent exactly as stored (0.8, its own spread)', async () => {
    const ne = ranged(20, 40);
    delete ne.stated_range;
    const { wire } = await sendOn((e) => {
      e.strength = { mean: 0.3, std: 0.15 };
      e.exists_probability = 0.8;
      e.provenance = { source: 'user_specified', magnitude: 'user_stated', natural_effect: ne };
    });
    expect(wire.exists_probability).toBe(0.8);
    expect(wire.strength.std).toBe(0.15);
  });

  it('ORDER: a stored CLAMP with a range → the full β is restored first, then the range sets the sd (never rescaled by the restore)', async () => {
    const full = 4.61;
    const { wire } = await sendOn((e) => {
      e.strength = { mean: 1, std: 0.5 };
      e.exists_probability = 0.8;
      e.provenance = { source: 'user_specified', magnitude: 'user_stated', clamped_from: full,
        natural_effect: { amount: 49, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'subscriber', strength_mean: full,
          strength_mean_frame: 'edge_strength', stated_range: { low: 49, high: 69, text: '£49 to £69', end: 'low' } } };
    });
    expect(wire.strength.mean).toBe(full);
    expect(wire.exists_probability).toBe(1);
    expect(wire.strength.std).toBeCloseTo(Math.abs((69 - 49) * full / 49) / 3.29, 12);
  });
});

describe('the model reasons with the existence the Run USES (d5: every reader that shows existence)', () => {
  const g = (): Rec => ({ version: '3', default_seed: 1, nodes: [
    { id: 'price', kind: 'factor', label: 'Price' }, { id: 'subs', kind: 'factor', label: 'Subscribers' }, { id: 'office', kind: 'factor', label: 'Office' },
    { id: 'mrr', kind: 'goal', label: 'MRR' }],
  edges: [userLink('price', 'subs', ranged(20, 40)), userLink('office', 'mrr', undefined)] });
  it('graph-compact (decision-continuity reads it): the held link exists at 1, the unheld user link keeps 0.8', async () => {
    const { compactGraph } = await import('../../../orchestrator/context/graph-compact.js');
    const edges = (compactGraph(g() as never).edges as Rec[]);
    expect(edges.find((e) => e.from === 'price')?.exists).toBe(1);
    expect(edges.find((e) => e.from === 'office')?.exists).toBe(0.8);
  });
  it('serialise compactGraph: the same; the EDIT view keeps the stored 0.8 (a patch must never persist the hold)', async () => {
    const { compactGraph, editCompactGraph } = await import('../../../orchestrator/context/serialise.js');
    const edges = (compactGraph(g() as never).edges as Rec[]);
    expect(edges.find((e) => e.from === 'price')?.exists_probability).toBe(1);
    expect(edges.find((e) => e.from === 'office')?.exists_probability).toBe(0.8);
    expect((editCompactGraph(g() as never).edges as Rec[]).find((e) => e.from === 'price')?.exists_probability).toBe(0.8);
  });
});

/**
 * ⭐ HELD-LINK PARITY (DL 0df0e1 condition 2): the SAME fixture, byte for byte, runs here and in DGAI
 * (`src/canvas/domain/__tests__/fixtures/held-link-parity.json`, `isHeldUserLink`). Each repo pins its sha256, so an edit to
 * either copy REDs that repo's CI until both are re-pinned to the same digest. Check name: "held-link parity fixture digest".
 */
describe('held-link parity fixture (shared with DGAI)', () => {
  const FIXTURE_SHA256 = '8cbd230b58a9e1d356e84e1383c1bac277e223649b96756927db27e40e5f4e0d';
  const load = async (): Promise<{ bytes: Buffer; rows: Array<{ name: string; edge: Rec; held: boolean }> }> => {
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(new URL('./fixtures/held-link-parity.json', import.meta.url));
    return { bytes, rows: (JSON.parse(bytes.toString('utf8')) as { rows: Array<{ name: string; edge: Rec; held: boolean }> }).rows };
  };
  it('held-link parity fixture digest: the bytes are the ones DGAI pins', async () => {
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update((await load()).bytes).digest('hex')).toBe(FIXTURE_SHA256);
  });
  it('every row: heldLinkOf agrees with the fixture (both directions present)', async () => {
    const { rows } = await load();
    expect(rows.filter((r) => r.held).length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.held).length).toBeGreaterThan(0);
    for (const r of rows) expect({ name: r.name, held: heldLinkOf(r.edge) !== null }).toEqual({ name: r.name, held: r.held });
  });
});

describe('Codex r1 #2643: identity, currency and the decision reviewer read the hold', () => {
  const graphWith = (edge: Rec): Rec => ({ nodes: [{ id: 'price', kind: 'factor', label: 'Price' }, { id: 'subs', kind: 'outcome', label: 'Subscribers' }], edges: [edge] });
  it('P1 identity: a range edit on a HELD link (20–40 → 20–80) changes the analysis hash', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const a = computeAnalysisAffectingGraphHash(graphWith(userLink('price', 'subs', ranged(20, 40))) as never);
    const b = computeAnalysisAffectingGraphHash(graphWith(userLink('price', 'subs', ranged(20, 80))) as never);
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
  });
  it('CONTRAST (no churn): the same range edit on an UNHELD link (Olumi estimate) leaves the hash alone', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const olumi = (ne: Rec): Rec => ({ ...userLink('price', 'subs', ne), provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: ne } });
    expect(computeAnalysisAffectingGraphHash(graphWith(olumi(ranged(20, 40))) as never))
      .toBe(computeAnalysisAffectingGraphHash(graphWith(olumi(ranged(20, 80))) as never));
  });
  it('P1 currency: a writer that moved the strength and kept natural_effect leaves it STALE → not held', () => {
    const e = { ...userLink('price', 'subs', ranged(20, 40)), strength: { mean: 0.6, std: 0.15 } };
    expect(heldLinkOf(e)).toBeNull();
  });
  it('P2 decision review: both branches read the existence the Run uses (fallback projection and enrichment graph)', async () => {
    const { projectRunGraphForDecisionReview } = await import('../../coaching/decision-review-graph-projection.js');
    const held = userLink('price', 'subs', ranged(20, 40));
    const viaRun = projectRunGraphForDecisionReview({}, graphWith(held)) as Rec;
    expect((viaRun.graph.edges as Rec[])[0]).toMatchObject({ exists: 1 });
    const viaEnrichment = projectRunGraphForDecisionReview(graphWith(held), null) as Rec;
    expect(viaEnrichment.via).toBe('enrichment');
    expect((viaEnrichment.graph.edges as Rec[])[0].exists_probability).toBe(1);
    // CONTRAST: an unheld user link keeps its 0.8 on the fallback branch.
    expect(((projectRunGraphForDecisionReview({}, graphWith(userLink('price', 'subs', undefined))) as Rec).graph.edges as Rec[])[0]).toMatchObject({ exists: 0.8 });
  });
});
