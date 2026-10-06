/**
 * ⭐ D3 cut 6, HOLD-AT-1.0 (Science d5 #87 6008807178 / 6008817484): a USER-stated link whose own stated range excludes
 * zero holds at exists_probability 1.0 on the Run's input, with sd_β = |β(high) − β(low)| / 3.29 and the mean left at the
 * STATED value. One function: the PLoT payload, the licence's existence flag and the input snapshot all read it; the
 * persisted graph is untouched. No range → no hold (never mean ± k·std: circular).
 */
import { describe, expect, it } from 'vitest';
import { endsOfGraph, heldLinkOf, labelHoldsQuantity, validatedDefinition, withHeldUserLinks, type LinkEnds } from '../held-user-links.js';
import { goalChanceLicenceOf, olumiExistenceOnGoalPath, userStatedLinksBelowOne } from '../goal-chance-licence.js';

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
/** A causal link's rows need no ends: only a definition reads the labels and each end's unit. */
const NO_ENDS: LinkEnds = { fromLabel: undefined, toLabel: undefined, fromUnit: undefined, toUnit: undefined };
const sdOf = (low: number, high: number): number => Math.abs(0.3 * (high / 20) - 0.3 * (low / 20)) / 3.29;

describe('hold-at-1.0: a user link whose own range excludes zero holds on the Run input', () => {
  it('HELD: user-sized, range 20 to 40 → exists 1.0, sd_β = |β(40) − β(20)| / 3.29, the mean stays the stated β', () => {
    const e = userLink('price', 'subs', ranged(20, 40));
    expect(heldLinkOf(e, NO_ENDS)).toEqual({ std: sdOf(20, 40) });
    const g = withHeldUserLinks({ nodes: [], edges: [e] });
    expect(g.edges[0].exists_probability).toBe(1);
    expect(g.edges[0].strength.std).toBeCloseTo(sdOf(20, 40), 12);
    // Mutant "midpoint mean" → RED: the mean is the user's stated end, never (low + high) / 2.
    expect(g.edges[0].strength.mean).toBe(0.3);
  });
  it('a NEGATIVE range (−40 to −20) excludes zero too → held', () => {
    expect(heldLinkOf(userLink('price', 'churn', ranged(-40, -20, -40)), NO_ENDS)).toEqual({ std: sdOf(-40, -20) });
  });
  it('CONTRAST: a range that STRADDLES zero (−5 to 10) → not held, the edge is byte-identical', () => {
    const e = userLink('price', 'subs', ranged(-5, 10, 10));
    expect(heldLinkOf(e, NO_ENDS)).toBeNull();
    const g = { nodes: [], edges: [e] };
    expect(withHeldUserLinks(g)).toBe(g);
  });
  it('a range touching zero (0 to 10) does not exclude it → not held', () => {
    expect(heldLinkOf(userLink('price', 'subs', ranged(0, 10, 10)), NO_ENDS)).toBeNull();
  });
  it('NO RANGE → no hold, whatever the size or spread (never mean ± k·std)', () => {
    const ne = ranged(20, 40);
    delete ne.stated_range;
    expect(heldLinkOf(userLink('price', 'subs', ne), NO_ENDS)).toBeNull();
    expect(heldLinkOf(userLink('price', 'subs', undefined), NO_ENDS)).toBeNull();
  });
  it('CLASS: an Olumi estimate carrying a range → not held; a brief-quoted link → held; brief WITHOUT its quote → not', () => {
    const olumi = { ...userLink('price', 'subs', ranged(20, 40)), provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: ranged(20, 40) } };
    expect(heldLinkOf(olumi, NO_ENDS)).toBeNull();
    const brief = { ...userLink('price', 'subs', ranged(20, 40)), provenance: { source: 'brief_extraction', source_quote: 'each £1 brings 20 to 40 subscribers', natural_effect: ranged(20, 40) } };
    expect(heldLinkOf(brief, NO_ENDS)).toEqual({ std: sdOf(20, 40) });
    expect(heldLinkOf({ ...brief, provenance: { ...brief.provenance, source_quote: '  ' } }, NO_ENDS)).toBeNull();
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
    expect(heldLinkOf(e, NO_ENDS)?.std).toBeCloseTo(sd, 12);
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
  // d5 6011224941 (#2665): rows gained `ends` (a validated definition holds whoever flagged it). DGAI re-pins to this digest
  // with its mirror in the paired PR (DL condition 2 on #2653/#2559 applies again).
  const FIXTURE_SHA256 = 'a6706a70a9351c9ed13384fcd22345efab6c1b04de74cc552465f175ac0b340b';
  const load = async (): Promise<{ bytes: Buffer; rows: Array<{ name: string; edge: Rec; ends?: LinkEnds; held: boolean }> }> => {
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(new URL('./fixtures/held-link-parity.json', import.meta.url));
    return { bytes, rows: (JSON.parse(bytes.toString('utf8')) as { rows: Array<{ name: string; edge: Rec; ends?: LinkEnds; held: boolean }> }).rows };
  };
  it('held-link parity fixture digest: the bytes are the ones DGAI pins', async () => {
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update((await load()).bytes).digest('hex')).toBe(FIXTURE_SHA256);
  });
  it('every row: heldLinkOf agrees with the fixture (both directions present)', async () => {
    const { rows } = await load();
    expect(rows.filter((r) => r.held).length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.held).length).toBeGreaterThan(0);
    for (const r of rows) expect({ name: r.name, held: heldLinkOf(r.edge, r.ends ?? NO_ENDS) !== null }).toEqual({ name: r.name, held: r.held });
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
    expect(heldLinkOf(e, NO_ENDS)).toBeNull();
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

describe('Codex r2 #2643: history recorded before the hold still validates; freshness still moves', () => {
  const graphWith = (edge: Rec): Rec => ({ nodes: [{ id: 'price', kind: 'factor', label: 'Price' }, { id: 'subs', kind: 'outcome', label: 'Subscribers' }], edges: [edge] });
  it('a model version hashed BEFORE the hold (pre-hold projection) is still that version; the live hash differs (stale)', async () => {
    const { computeAnalysisAffectingGraphHashSha256, computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const { matchesHistoricalAnalysisIdentity } = await import('../../context/graph-identity.js');
    // Codex r2's shape: a held link AND an option with an unresolved target (admission gaps), so the frozen legacy
    // projection differs from the pre-hold one and cannot validate it by accident.
    const g = graphWith(userLink('price', 'subs', ranged(20, 40)));
    g.nodes.push({ id: 'o1', kind: 'option', label: 'Raise', interventions: { price: { value: 0.6 } }, unresolved_targets: ['subs'] });
    const recordedBeforeHold = computeAnalysisAffectingGraphHashSha256(g as never, 'pre_hold')!;
    expect(computeAnalysisAffectingGraphHashSha256(g as never, 'legacy')).not.toBe(recordedBeforeHold); // PRECONDITION
    expect(recordedBeforeHold).not.toBe(computeAnalysisAffectingGraphHashSha256(g as never));
    expect(matchesHistoricalAnalysisIdentity(g as never, recordedBeforeHold)).toBe(true);
    // Freshness reads the CURRENT projection only: a pre-hold Run on this graph is stale.
    expect(computeAnalysisAffectingGraphHash(g as never)).not.toBe(computeAnalysisAffectingGraphHash(g as never, 'pre_hold'));
  });
  it('CONTRAST: a graph with no held link hashes the same under both projections (no churn)', async () => {
    const { computeAnalysisAffectingGraphHashSha256 } = await import('../../context/graph-hash.js');
    const g = graphWith(userLink('price', 'subs', undefined));
    expect(computeAnalysisAffectingGraphHashSha256(g as never, 'pre_hold')).toBe(computeAnalysisAffectingGraphHashSha256(g as never));
  });
  it('a hash that matches NO projection is still refused (the pre-hold door is not a wildcard)', async () => {
    const { matchesHistoricalAnalysisIdentity } = await import('../../context/graph-identity.js');
    expect(matchesHistoricalAnalysisIdentity(graphWith(userLink('price', 'subs', ranged(20, 40))) as never, '0'.repeat(64))).toBe(false);
  });
});


/**
 * ⭐ DEFINITIONAL HOLD, CORRECTED (Science d5 #87 6011224941, correcting 6009797390's drafter-only clause; DL 07:46Z): a
 * VALIDATED definitional link holds at existence 1.0 with std 0.01 WHOEVER drew it. Validated: a current definitional
 * carrier (±1 per 1, one unit at both ends of its size, its β still carried), each end's OWN unit (where it has one) that
 * unit, and the source label holding the target's quantity words. 0.8 / ±50% on "Starter-tier MRR" → "MRR" said "a 20% chance
 * Starter revenue isn't revenue"; the mechanism's doubt stays on the upstream CAUSAL links, which keep Olumi's 0.8.
 * The user's own definitional link (stated, or quoted) still holds as #2653 made it.
 */
describe('definitional hold: the user\'s own definitional link holds when it VALIDATES, as any definition (d5: whoever flagged it)', () => {
  // A definition as drafted: +1 £/month per £/month, its β carried by the edge (the ONE current-carrier predicate).
  const DEF_NE = { amount: 1, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '£/month', strength_mean: 1, strength_mean_frame: 'edge_strength' };
  const definitional = (provenance: Rec): Rec => ({ from: 'part', to: 'total', strength: { mean: 1, std: 0.5 }, exists_probability: 0.8,
    provenance: { definitional: true, natural_effect: { ...DEF_NE }, ...provenance } });
  /** The ends of a definition that validates: the part's label holds the total's quantity; the total is read in £/month. */
  const VALID: LinkEnds = { fromLabel: 'Starter-tier MRR', toLabel: 'monthly recurring revenue', fromUnit: undefined, toUnit: '£/month' };
  it('QUOTED definitional (brief, with its quote) that validates → held at 1.0 with std 0.01', () => {
    const e = definitional({ source: 'brief_extraction', magnitude: 'olumi_estimate', source_quote: '<quote>' });
    expect(heldLinkOf(e, VALID)).toEqual({ std: 0.01 });
    const g = { nodes: [{ id: 'part', label: VALID.fromLabel }, { id: 'total', label: VALID.toLabel, observed_state: { unit: '£/month' } }], edges: [e] };
    expect(withHeldUserLinks(g).edges[0]).toMatchObject({ exists_probability: 1, strength: { mean: 1, std: 0.01 } });
  });
  it('USER-STATED definitional that validates → held at 1.0 with std 0.01', () => {
    expect(heldLinkOf(definitional({ source: 'user_specified', magnitude: 'user_stated' }), VALID)).toEqual({ std: 0.01 });
  });
  it('⛔ Codex r1 #2665 P1: a USER-STATED flag that FAILS validation (‘Pipeline value’ → ‘Revenue’) is not a definition → not held', () => {
    const e = definitional({ source: 'user_specified', magnitude: 'user_stated' });
    expect(heldLinkOf(e, { ...VALID, fromLabel: 'Pipeline value', toLabel: 'Revenue' })).toBeNull();
    expect(heldLinkOf(e, NO_ENDS), 'and with no ends to validate it').toBeNull();
    // It is then an ordinary user link: held only by its own range off zero (#2643).
    e.provenance.natural_effect.stated_range = { low: 0.8, high: 1.2, text: '80p to £1.20', end: 'centre' };
    expect(heldLinkOf(e, { ...VALID, fromLabel: 'Pipeline value', toLabel: 'Revenue' })?.std).toBeCloseTo(0.4 / 3.29, 12);
  });
  it('⛔ Codex r1 #2653 P1: a USER BAND EDIT keeps the flag but moves the size → not a definition, not held', () => {
    const edited = definitional({ source: 'user_specified', magnitude: 'user_stated' });
    edited.strength = { mean: -0.3, std: 0.075 };
    expect(heldLinkOf(edited, VALID)).toBeNull();
    delete edited.provenance.natural_effect;
    expect(heldLinkOf(edited, VALID), 'and with its natural effect dropped').toBeNull();
    expect(withHeldUserLinks({ nodes: [], edges: [edited] }).edges[0]).toMatchObject({ exists_probability: 0.8, strength: { std: 0.075 } });
  });
  it('CONTRAST: a definitional flag on a link that is not ±1 per 1 is not a definition → not held', () => {
    const e = definitional({ source: 'user_specified', magnitude: 'user_stated' });
    e.provenance.natural_effect.amount = 2;
    expect(heldLinkOf(e, VALID)).toBeNull();
  });
  it('CONTRAST: a POINT causal user link (no range, not definitional) → not held, stays 0.8', () => {
    expect(heldLinkOf(userLink('price', 'subs', undefined), NO_ENDS)).toBeNull();
  });
});

describe('the label clause (d5 6011224941): the source label holds every content word of the target\'s quantity', () => {
  it.each([
    ['Starter-tier monthly recurring revenue', 'monthly recurring revenue', true],
    ['Quarterly revenue lost to AI delivery distraction', 'quarterly revenue', true],
    ['Starter-tier MRR', 'monthly recurring revenue', true],
    ['MRR lost to starter support strain', 'monthly recurring revenue', true],
    ['Enterprise revenues', 'Revenue', true],
    ['Pipeline value', 'revenue', false],
    ['Support cost', 'MRR', false],
    ['Starter churn', 'monthly recurring revenue', false],
    ['Starter-tier subscribers', 'monthly recurring revenue', false],
    ['', 'revenue', false],
  ] as const)('%s → %s: %s', (source, target, holds) => {
    expect(labelHoldsQuantity(source, target)).toBe(holds);
  });
});

/** The SERVED T1b drafts that carry Olumi's drafter-only definition (rg -l "Starter-tier" under fixtures; read verbatim). */
const SERVED_T1B = {
  // e7 FA1, guest T1b draft 46d37fb7 on CEE d619668a: ‘Starter-tier MRR’ → MRR (+1) and ‘MRR lost to starter support strain’ → MRR (−1).
  fa1: '../../agent-lane/__tests__/fixtures/fa1-served-graph.json',
  // red team 19, guest T1b near tie on CEE 328d01fe: ‘Starter-tier monthly recurring revenue’ → MRR (+1), units 'GBP/month'.
  ts2: '../../admission/__tests__/fixtures/ts2-near-tie-served-graph.json',
} as const;
const GOAL = 'monthly_recurring_revenue';
const servedGraph = async (key: keyof typeof SERVED_T1B): Promise<Rec> => {
  const { readFileSync } = await import('node:fs');
  return structuredClone((JSON.parse(readFileSync(new URL(SERVED_T1B[key], import.meta.url), 'utf8')) as { graph: Rec }).graph);
};
const edgeOf = (g: Rec, from: string, to: string): Rec => {
  const e = (g.edges as Rec[]).find((x) => x.from === from && x.to === to);
  expect(e, `${from} -> ${to} is in the graph`).toBeDefined();
  return e!;
};
const nodeOf = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;

describe('a VALIDATED drafter-only definition holds at 1.0 / 0.01 (the predicate, on the served drafts)', () => {
  it('PRECONDITION: each served link is Olumi\'s drafter-only definition at the 0.8 prior', async () => {
    for (const [key, from] of [['fa1', 'starter_tier_mrr'], ['fa1', 'mrr_lost_to_starter_support_strain'], ['ts2', 'starter_tier_monthly_recurring_revenue']] as const) {
      const e = edgeOf(await servedGraph(key), from, GOAL);
      expect(e).toMatchObject({ exists_probability: 0.8, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', definitional: true } });
    }
  });
  it.each([
    ['fa1', 'starter_tier_mrr', '£/month'],
    ['fa1', 'mrr_lost_to_starter_support_strain', '£/month'],
    ['ts2', 'starter_tier_monthly_recurring_revenue', 'GBP/month'],
  ] as const)('%s %s → MRR: validated in %s, held {std 0.01}', async (key, from, unit) => {
    const g = await servedGraph(key);
    const e = edgeOf(g, from, GOAL);
    expect(validatedDefinition(e, endsOfGraph(g)(e))).toBe(unit);
    expect(heldLinkOf(e, endsOfGraph(g)(e))).toEqual({ std: 0.01 });
  });
  it('`sameUnit` at both ends: the total read in the definition\'s unit is REQUIRED; a total with no unit fails (fails safe)', async () => {
    const g = await servedGraph('fa1');
    const e = edgeOf(g, 'starter_tier_mrr', GOAL);
    const ends = endsOfGraph(g)(e);
    expect(ends).toMatchObject({ fromLabel: 'Starter-tier MRR', toLabel: 'monthly recurring revenue', fromUnit: undefined, toUnit: '£/month' });
    expect(validatedDefinition(e, { ...ends, toUnit: undefined })).toBeUndefined();
    expect(validatedDefinition(e, { ...ends, toUnit: 'GBP/month' }), 'the same unit spelled another way').toBe('£/month');
  });
  it('CONTROL: no CAUSAL link on the served drafts holds (Olumi\'s and the brief\'s point links keep their prior)', async () => {
    for (const key of ['fa1', 'ts2'] as const) {
      const g = await servedGraph(key);
      const endsOf = endsOfGraph(g);
      const held = (g.edges as Rec[]).filter((e) => heldLinkOf(e, endsOf(e)) !== null).map((e) => `${e.from}->${e.to}`);
      const definitions = (g.edges as Rec[]).filter((e) => e.provenance?.definitional === true).map((e) => `${e.from}->${e.to}`);
      expect(held).toEqual(definitions);
    }
  });
});

describe('the Run sends PLoT the validated definition at 1.0 / 0.01; causal links and failed flags keep 0.8 (served T1b)', () => {
  /** The REAL `run_analysis` handler over the served draft (PLoT faked at the transport): the graph PLoT receives. */
  const plotGraphFor = async (graph: Rec): Promise<{ wire: Rec; persisted: Rec }> => {
    const { readFileSync } = await import('node:fs');
    const { vi } = await import('vitest');
    const { GraphV3 } = await import('../../../schemas/cee-v3.js');
    const { mergeInterventionSourceObjects } = await import('../../../orchestrator/tools/analysis-ready-helper.js');
    const { createRunAnalysisHandler } = await import('../../tools/handlers/run-analysis.js');
    const minimal = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/plot/v2-run-golden-minimal.json', import.meta.url), 'utf8'));
    const parsed = GraphV3.parse(graph) as unknown as Rec;
    const options = (parsed.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => ({
      id: n.id, option_id: n.id, label: n.label, interventions: mergeInterventionSourceObjects(n as never),
    }));
    const snapshot = { graph: parsed, options, goal_node_id: GOAL, rawPersistedGraph: structuredClone(parsed) };
    const runMock = vi.fn(async () => structuredClone(minimal));
    const handler = createRunAnalysisHandler({ plotClient: { run: runMock, validatePatch: vi.fn().mockResolvedValue({}) }, scenarioReader: async () => snapshot } as never);
    await handler({ payload: { scenario_id: 'a8d3f1b2-7c4e-4d5a-9b6c-1e2f3a4b5c6d' }, requestId: 'req-vd', signal: new AbortController().signal, context: {}, orientationText: '' } as never).catch((x: unknown) => x);
    expect(runMock).toHaveBeenCalledTimes(1);
    return { wire: ((runMock.mock.calls as unknown[][])[0]![0] as { graph: Rec }).graph, persisted: snapshot.rawPersistedGraph };
  };

  it('⭐ RED (T1b fa1): ‘Starter-tier MRR’ → MRR is sent at existence 1.0, std 0.01, its β unchanged; the stored link keeps 0.8', async () => {
    const g = await servedGraph('fa1');
    const beta = edgeOf(g, 'starter_tier_mrr', GOAL).strength.mean;
    const { wire, persisted } = await plotGraphFor(g);
    expect(edgeOf(wire, 'starter_tier_mrr', GOAL)).toMatchObject({ exists_probability: 1, strength: { mean: beta, std: 0.01 } });
    expect(edgeOf(wire, 'mrr_lost_to_starter_support_strain', GOAL)).toMatchObject({ exists_probability: 1, strength: { std: 0.01 } });
    expect(edgeOf(persisted, 'starter_tier_mrr', GOAL)).toMatchObject({ exists_probability: 0.8, strength: { std: edgeOf(g, 'starter_tier_mrr', GOAL).strength.std } });
  });
  it('⭐ RED (T1b ts2): ‘Starter-tier monthly recurring revenue’ → MRR (GBP/month) is sent at existence 1.0, std 0.01', async () => {
    const { wire } = await plotGraphFor(await servedGraph('ts2'));
    expect(edgeOf(wire, 'starter_tier_monthly_recurring_revenue', GOAL)).toMatchObject({ exists_probability: 1, strength: { std: 0.01 } });
  });
  it('CONTROL: the CAUSAL Olumi links into and around the part keep 0.8 and their own spread (the doubt stays upstream)', async () => {
    const g = await servedGraph('fa1');
    const { wire } = await plotGraphFor(g);
    for (const [from, to] of [['starter_tier_monthly_price', 'starter_tier_mrr'], ['starter_tier_subscribers', 'starter_tier_mrr'],
      ['monthly_starter_support_cost', 'mrr_lost_to_starter_support_strain']] as const) {
      expect(edgeOf(wire, from, to), `${from} -> ${to}`).toMatchObject({ exists_probability: 0.8, strength: { std: edgeOf(g, from, to).strength.std } });
    }
  });
  it('⛔ Codex r2 #2665 P1: a validated definition stored as a CLAMP (mean 1, clamped_from 2) holds on the saved link AND the wire', async () => {
    const g = await servedGraph('fa1');
    const e = edgeOf(g, 'starter_tier_mrr', GOAL);
    e.strength = { mean: 1, std: 0.5 };
    e.provenance.clamped_from = 2;
    e.provenance.natural_effect.strength_mean = 2;
    // The saved link (every reader of the persisted graph) and the licence: held, no longer Olumi's existence doubt.
    expect(heldLinkOf(e, endsOfGraph(g)(e))).toEqual({ std: 0.01 });
    // The Run restores the full β first, then holds it.
    const { wire } = await plotGraphFor(g);
    expect(edgeOf(wire, 'starter_tier_mrr', GOAL)).toMatchObject({ exists_probability: 1, strength: { mean: 2, std: 0.01 } });
  });
  it('TWIN (label): the same flag on ‘Pipeline value’ → MRR fails validation → sent at 0.8 with its own spread', async () => {
    const g = await servedGraph('fa1');
    nodeOf(g, 'starter_tier_mrr').label = 'Pipeline value';
    const { wire } = await plotGraphFor(g);
    expect(edgeOf(wire, 'starter_tier_mrr', GOAL)).toMatchObject({ exists_probability: 0.8, strength: { std: edgeOf(g, 'starter_tier_mrr', GOAL).strength.std } });
  });
  it('TWIN (label, the USER\'s flag; Codex r1 #2665 P1): ‘Pipeline value’ → MRR typed user-stated still fails → 0.8', async () => {
    const g = await servedGraph('fa1');
    nodeOf(g, 'starter_tier_mrr').label = 'Pipeline value';
    Object.assign(edgeOf(g, 'starter_tier_mrr', GOAL).provenance, { source: 'user_specified', magnitude: 'user_stated' });
    const { wire } = await plotGraphFor(g);
    expect(edgeOf(wire, 'starter_tier_mrr', GOAL)).toMatchObject({ exists_probability: 0.8, strength: { std: edgeOf(g, 'starter_tier_mrr', GOAL).strength.std } });
  });
  it('TWIN (unit at the total): the size in £/week into a total in £/month fails validation → 0.8', async () => {
    const g = await servedGraph('fa1');
    const ne = edgeOf(g, 'starter_tier_mrr', GOAL).provenance.natural_effect;
    ne.amount_unit = '£/week';
    ne.per_source_change_unit = '£/week';
    const { wire } = await plotGraphFor(g);
    expect(edgeOf(wire, 'starter_tier_mrr', GOAL).exists_probability).toBe(0.8);
  });
  it('TWIN (unit at the part): a part measured in its own other unit (subscribers) fails validation → 0.8', async () => {
    const g = await servedGraph('fa1');
    nodeOf(g, 'starter_tier_mrr').observed_state = { value: 0, raw_value: 0, unit: 'subscribers' };
    const { wire } = await plotGraphFor(g);
    expect(edgeOf(wire, 'starter_tier_mrr', GOAL).exists_probability).toBe(0.8);
  });
  it('TWIN (not ±1 per 1): the flag on +2 per 1 is not a definition → 0.8', async () => {
    const g = await servedGraph('fa1');
    edgeOf(g, 'starter_tier_mrr', GOAL).provenance.natural_effect.amount = 2;
    const { wire } = await plotGraphFor(g);
    expect(edgeOf(wire, 'starter_tier_mrr', GOAL).exists_probability).toBe(0.8);
  });
});

describe('every reader that shows existence reads the SAME validated hold (served T1b fa1)', () => {
  it('graph-compact and serialise show 1 for the definition and 0.8 for the causal control; the EDIT view keeps the stored 0.8', async () => {
    const g = await servedGraph('fa1');
    const { compactGraph } = await import('../../../orchestrator/context/graph-compact.js');
    const { compactGraph: serialiseCompact, editCompactGraph } = await import('../../../orchestrator/context/serialise.js');
    const compact = compactGraph(g as never).edges as Rec[];
    expect(compact.find((e) => e.from === 'starter_tier_mrr' && e.to === GOAL)?.exists).toBe(1);
    expect(compact.find((e) => e.from === 'starter_tier_monthly_price' && e.to === 'starter_tier_mrr')?.exists).toBe(0.8);
    const serialised = serialiseCompact(g as never).edges as Rec[];
    expect(serialised.find((e) => e.from === 'starter_tier_mrr' && e.to === GOAL)?.exists_probability).toBe(1);
    expect(serialised.find((e) => e.from === 'starter_tier_monthly_price' && e.to === 'starter_tier_mrr')?.exists_probability).toBe(0.8);
    expect((editCompactGraph(g as never).edges as Rec[]).find((e) => e.from === 'starter_tier_mrr' && e.to === GOAL)?.exists_probability).toBe(0.8);
  });
  it('the decision reviewer reads exists 1 for the definition, 0.8 for the causal control, on all three branches', async () => {
    const { projectRunGraphForDecisionReview } = await import('../../coaching/decision-review-graph-projection.js');
    const definition = (edges: Rec[]): Rec | undefined => edges.find((e) => e.from === 'starter_tier_mrr' && e.to === GOAL);
    const control = (edges: Rec[]): Rec | undefined => edges.find((e) => e.from === 'starter_tier_monthly_price' && e.to === 'starter_tier_mrr');
    // 1. The Run snapshot, strict (graph-compact).
    const strict = projectRunGraphForDecisionReview({}, await servedGraph('fa1')) as Rec;
    expect(strict.via).toBe('run_snapshot_strict');
    expect(definition(strict.graph.edges)).toMatchObject({ exists: 1 });
    expect(control(strict.graph.edges)).toMatchObject({ exists: 0.8 });
    // 2. The Run snapshot, preserving (a node the strict schema refuses sends it down the field-preserving arm).
    const odd = await servedGraph('fa1');
    nodeOf(odd, 'decision_monthly_recurring_revenue').kind = 'not_a_kind';
    const preserving = projectRunGraphForDecisionReview({}, odd) as Rec;
    expect(preserving.via, 'PRECONDITION: the preserving arm').toBe('run_snapshot_preserving');
    expect(definition(preserving.graph.edges)).toMatchObject({ exists: 1 });
    expect(control(preserving.graph.edges)).toMatchObject({ exists: 0.8 });
    // 3. The enrichment graph (the held copy).
    const enrichment = projectRunGraphForDecisionReview(await servedGraph('fa1'), null) as Rec;
    expect(enrichment.via).toBe('enrichment');
    expect(definition(enrichment.graph.edges)?.exists_probability).toBe(1);
    expect(control(enrichment.graph.edges)?.exists_probability).toBe(0.8);
  });
  it('the licence: with every causal goal-path link at 1, the definitions are no longer Olumi\'s existence doubt; at 0.8 the control still is', async () => {
    const g = await servedGraph('fa1');
    const options = ['raise_prices_10', 'launch_starter_tier', 'keep_pricing_as_it_is'];
    for (const e of g.edges as Rec[]) if (e.provenance?.definitional !== true) e.exists_probability = 1;
    expect(olumiExistenceOnGoalPath(g, GOAL, options)).toBe(false);
    edgeOf(g, 'starter_tier_monthly_price', 'starter_tier_mrr').exists_probability = 0.8;
    expect(olumiExistenceOnGoalPath(g, GOAL, options)).toBe(true);
  });
});

describe('analysis identity: a validated definition is an input change; history recorded under the user-only hold still validates', () => {
  it('the current hash differs from the user-only (pre_definition) projection on the served draft, and that history validates', async () => {
    const { computeAnalysisAffectingGraphHashSha256 } = await import('../../context/graph-hash.js');
    const { matchesHistoricalAnalysisIdentity } = await import('../../context/graph-identity.js');
    const g = await servedGraph('fa1');
    // A ranged user link too, so the user-only projection differs from the pre-hold one and cannot validate it by accident.
    const user = edgeOf(g, 'price_rise_from_current_level', GOAL);
    user.provenance = { source: 'user_specified', magnitude: 'user_stated',
      natural_effect: { amount: 6000, amount_unit: '£/month', per_source_change: 10, per_source_change_unit: '%', strength_mean: user.strength.mean,
        strength_mean_frame: 'edge_strength', stated_range: { low: 4000, high: 8000, text: '£4,000 to £8,000', end: 'centre' } } };
    const recordedUnderUserHold = computeAnalysisAffectingGraphHashSha256(g as never, 'pre_definition')!;
    expect(recordedUnderUserHold).not.toBe(computeAnalysisAffectingGraphHashSha256(g as never, 'pre_hold')); // PRECONDITION
    expect(recordedUnderUserHold).not.toBe(computeAnalysisAffectingGraphHashSha256(g as never));
    expect(matchesHistoricalAnalysisIdentity(g as never, recordedUnderUserHold)).toBe(true);
  });
  it('a USER definitional link that fails validation was held under the old rule: that history validates; the live hash moved', async () => {
    const { computeAnalysisAffectingGraphHashSha256 } = await import('../../context/graph-hash.js');
    const { matchesHistoricalAnalysisIdentity } = await import('../../context/graph-identity.js');
    const g = await servedGraph('fa1');
    for (const e of g.edges as Rec[]) if (e.provenance?.definitional === true) delete e.provenance.definitional;
    nodeOf(g, 'starter_tier_mrr').label = 'Pipeline value';
    Object.assign(edgeOf(g, 'starter_tier_mrr', GOAL).provenance, { definitional: true, source: 'user_specified', magnitude: 'user_stated' });
    const recordedUnderUserHold = computeAnalysisAffectingGraphHashSha256(g as never, 'pre_definition')!;
    expect(recordedUnderUserHold).not.toBe(computeAnalysisAffectingGraphHashSha256(g as never, 'pre_hold')); // PRECONDITION: held then
    expect(recordedUnderUserHold).not.toBe(computeAnalysisAffectingGraphHashSha256(g as never));
    expect(matchesHistoricalAnalysisIdentity(g as never, recordedUnderUserHold)).toBe(true);
  });
  it('CONTRAST (no churn): a graph with no validated definition hashes the same under both projections', async () => {
    const { computeAnalysisAffectingGraphHashSha256 } = await import('../../context/graph-hash.js');
    const g = await servedGraph('fa1');
    for (const e of g.edges as Rec[]) if (e.provenance?.definitional === true) delete e.provenance.definitional;
    expect(computeAnalysisAffectingGraphHashSha256(g as never, 'pre_definition')).toBe(computeAnalysisAffectingGraphHashSha256(g as never));
  });
});
