/**
 * `deriveMissingRootAssumptions` — driven over TWO REAL CAPTURES first, then
 * over structural cases.
 *
 * ⭐ WHY THE FIXTURES ARE CAPTURES AND NOT FIXTURES I WROTE. CLAUDE.md trap
 * 16-inverse, in the estate's own words: *a fixture you wrote yourself is not
 * evidence about the wire* — it encodes the author's model of the producer
 * rather than the producer. Both graph fixtures here are mechanical projections
 * of committed artefacts in `Talchain/olumi-programme-docs`, and each carries
 * its own `_provenance` block naming the artefact and the exact transformation:
 *
 *   `founder-2026-09-03.graph.json`  — the founder's 3 Sep manual test,
 *                                      scenario 7826c742, from the debug bundle
 *   `draft-b2-2026-09-03.graph.json` — a raw CEE draft response, schema 3.0,
 *                                      nodes[] and edges[] copied verbatim
 *
 * The founder capture is the one this lane exists to serve, so the suite's
 * first obligation is to reproduce the LOCKED count off it — three root
 * factors, not eleven nodes — without that number being written into the
 * module.
 *
 * ⚠ EVERY SUPPRESSION ASSERTION PINS ITS OWN PRECONDITION (trap 13b, third
 * face). "Expect it to be absent" passes just as happily when the derivation
 * saw nothing at all, so each exclusion test first asserts the fact that is
 * supposed to cause the exclusion.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { deriveMissingRootAssumptions } from '../missing-root-assumptions.js';

function loadFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}.graph.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

const FOUNDER = loadFixture('founder-2026-09-03');
const B2 = loadFixture('draft-b2-2026-09-03');

/** The founder capture's own ids, so assertions bind by IDENTITY (trap 19). */
const F = {
  icpClarity: '16ec3d64',
  churnedCustomersSentence: '26fbdff5',
  hiringFreesThisUp: '27c23ebb',
  churnRateDeterioration: '3d37f4b2',
  productQualityFragment: '422ceee7',
  runwayDepletionRisk: '428612e0',
  goal: '552bd1c0',
  competitivePressure: '7dc44ba7',
  salesHeadcountInvestment: '919d7f50',
  trialToPaidUplift: 'b42f8b15',
  mrrGrowthRate: 'b6941ac0',
  customerAcquisitionCost: 'bbbbd8f2',
  decision: 'faa7499e',
} as const;

function nodeById(graph: Record<string, unknown>, id: string): Record<string, unknown> {
  const nodes = graph.nodes as Record<string, unknown>[];
  const found = nodes.find((n) => n.id === id);
  expect(found, `fixture has no node ${id}`).toBeDefined();
  return found!;
}

function incomingEdgeCount(graph: Record<string, unknown>, id: string): number {
  const edges = graph.edges as Record<string, unknown>[];
  return edges.filter((e) => (e.to ?? e.target) === id).length;
}

describe('the founder capture — the locked diagnosis, reproduced from structure', () => {
  it('the fixture is the capture it claims to be (a vacuous corpus proves nothing)', () => {
    const provenance = FOUNDER._provenance as Record<string, unknown>;
    expect(provenance.scenario_id).toBe('7826c742-2939-4584-917c-f1286a663ae4');
    expect((FOUNDER.nodes as unknown[]).length).toBe(16);
    expect((FOUNDER.edges as unknown[]).length).toBe(24);
  });

  it('finds EXACTLY the three root factors the locked diagnosis names, most material first', () => {
    const { ranked, unreachable_count } = deriveMissingRootAssumptions(FOUNDER);

    expect(ranked.map((r) => r.factor_id)).toEqual([
      F.icpClarity,
      F.productQualityFragment,
      F.competitivePressure,
    ]);
    expect(unreachable_count).toBe(0);
    // The locked worked example: "ICP clarity matters most".
    expect(ranked[0]!.factor_label).toBe('ICP Clarity');
  });

  it('the order is a real separation, not a coin flip — the leader is ~2x the runner-up', () => {
    const { ranked } = deriveMissingRootAssumptions(FOUNDER);
    // Hand-derivable from the capture: ICP Clarity reaches the goal by two
    // routes (0.35 x 0.5 and 0.4 x 0.5); the runner-up by one (0.3518... x 0.5).
    expect(ranked[0]!.materiality).toBeCloseTo(0.375, 10);
    expect(ranked[1]!.materiality).toBeCloseTo(0.17592592592592593, 10);
    expect(ranked[2]!.materiality).toBeCloseTo(0.10555555555555556, 10);
    expect(ranked[0]!.materiality / ranked[1]!.materiality).toBeGreaterThan(2);
  });

  it('⛔ THE WITHDRAWN DENOMINATOR: no outcome, risk, goal, decision or option is ever asked for', () => {
    const { ranked } = deriveMissingRootAssumptions(FOUNDER);
    const asked = new Set(ranked.map((r) => r.factor_id));
    // Precondition: these are the entity kinds the locked document says are
    // computed downstream. Asserted from the fixture so the claim is about the
    // capture and not about this test's memory of it.
    for (const id of [
      F.churnRateDeterioration,
      F.runwayDepletionRisk,
      F.trialToPaidUplift,
      F.mrrGrowthRate,
      F.customerAcquisitionCost,
      F.goal,
      F.decision,
    ]) {
      expect(['risk', 'outcome', 'goal', 'decision']).toContain(nodeById(FOUNDER, id).kind);
      expect(asked.has(id)).toBe(false);
    }
  });

  it('⛔ a factor EVERY option overrides is not asked for — and the precondition is pinned', () => {
    // The £80 -> £100,000 factor. The engine reported `sensitivity_score: 0`,
    // `zero_reason: "intervention_override"` for it: a baseline that cannot
    // move the result. It is excluded because the option interventions are
    // incoming edges, which is what makes it not a root.
    expect(incomingEdgeCount(FOUNDER, F.salesHeadcountInvestment)).toBe(3);
    expect(incomingEdgeCount(FOUNDER, F.hiringFreesThisUp)).toBe(3);

    const asked = new Set(deriveMissingRootAssumptions(FOUNDER).ranked.map((r) => r.factor_id));
    expect(asked.has(F.salesHeadcountInvestment)).toBe(false);
    expect(asked.has(F.hiringFreesThisUp)).toBe(false);
  });

  it('⛔ a factor that already carries a value is not asked for — precondition pinned', () => {
    const node = nodeById(FOUNDER, F.churnedCustomersSentence);
    expect((node.observed_state as Record<string, unknown>).value).toBe(0.5);
    const asked = new Set(deriveMissingRootAssumptions(FOUNDER).ranked.map((r) => r.factor_id));
    expect(asked.has(F.churnedCustomersSentence)).toBe(false);
  });
});

describe('the B2 draft capture — an ESTIMATE is not an admission of ignorance', () => {
  const CHANNEL_PARTNER = '29987760'; // prior U(0.45, 1) — a stated belief
  const PRODUCT_LED = 'a1530fa2'; // no prior at all
  const OUTBOUND_HEADCOUNT = '89d16343'; // prior_is_unquantified, but not a root

  it('the fixture is the verbatim capture it claims to be', () => {
    const provenance = B2._provenance as Record<string, unknown>;
    expect(provenance.schema_version).toBe('3.0');
    expect((B2.nodes as unknown[]).length).toBe(15);
  });

  it('asks for the one root with NO information, and not the one with a narrowed prior', () => {
    // ⭐ THE DISCRIMINATING PAIR. Both are roots; both carry no value. They
    // differ ONLY in whether their prior states a belief, and the capture
    // contains one of each — so this is the real distinction, not a synthetic
    // one. Preconditions first.
    expect(incomingEdgeCount(B2, CHANNEL_PARTNER)).toBe(0);
    expect(incomingEdgeCount(B2, PRODUCT_LED)).toBe(0);
    expect(nodeById(B2, CHANNEL_PARTNER).prior).toEqual({
      distribution: 'uniform',
      range_min: 0.45,
      range_max: 1,
    });
    expect(nodeById(B2, PRODUCT_LED).prior).toBeUndefined();

    const { ranked } = deriveMissingRootAssumptions(B2);
    expect(ranked.map((r) => r.factor_id)).toEqual([PRODUCT_LED]);
  });

  it('and the excluded one is a CLOSE second by materiality, so the exclusion is doing the work', () => {
    // If the prior test passed merely because the estimate-bearing factor were
    // immaterial, the discrimination would be untested. It is not: on this
    // capture the two are within 6% of each other.
    const withoutPrior = deriveMissingRootAssumptions({
      ...B2,
      nodes: (B2.nodes as Record<string, unknown>[]).map((n) =>
        n.id === CHANNEL_PARTNER ? { ...n, prior: undefined } : n,
      ),
    });
    expect(withoutPrior.ranked.map((r) => r.factor_id)).toEqual([PRODUCT_LED, CHANNEL_PARTNER]);
    const [top, second] = withoutPrior.ranked;
    expect(second!.materiality / top!.materiality).toBeGreaterThan(0.9);
  });

  it('⛔ an explicit ignorance prior on a NON-root is still not asked for', () => {
    expect(nodeById(B2, OUTBOUND_HEADCOUNT).prior).toMatchObject({ prior_is_unquantified: true });
    expect(incomingEdgeCount(B2, OUTBOUND_HEADCOUNT)).toBe(1);
    const asked = new Set(deriveMissingRootAssumptions(B2).ranked.map((r) => r.factor_id));
    expect(asked.has(OUTBOUND_HEADCOUNT)).toBe(false);
  });
});

// ── structural cases ────────────────────────────────────────────────────────

const GOAL = { id: 'g', kind: 'goal', label: 'Goal' };

function graph(nodes: unknown[], edges: unknown[]) {
  return { nodes: [GOAL, ...nodes], edges };
}

describe('materiality is ABSOLUTE, so opposing routes cannot cancel', () => {
  it('a factor with a +0.6 and a -0.6 route to the goal scores 1.2, not 0', () => {
    const result = deriveMissingRootAssumptions(
      graph(
        [
          { id: 'f', kind: 'factor', label: 'Both ways' },
          { id: 'up', kind: 'outcome', label: 'Up' },
          { id: 'down', kind: 'risk', label: 'Down' },
        ],
        [
          { from: 'f', to: 'up', strength_mean: 0.6 },
          { from: 'f', to: 'down', strength_mean: -0.6 },
          { from: 'up', to: 'g', strength_mean: 1 },
          { from: 'down', to: 'g', strength_mean: 1 },
        ],
      ),
    );
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0]!.materiality).toBeCloseTo(1.2, 10);
  });
});

describe('both edge vocabularies, one reader', () => {
  it.each([
    ['V3 nested strength', { strength: { mean: 0.5, std: 0.1 } }],
    ['V4 strength_mean', { strength_mean: 0.5 }],
    ['legacy weight', { weight: 0.5 }],
  ])('%s resolves to the same materiality', (_name, strengthFields) => {
    const result = deriveMissingRootAssumptions(
      graph([{ id: 'f', kind: 'factor', label: 'F' }], [{ from: 'f', to: 'g', ...strengthFields }]),
    );
    expect(result.ranked[0]!.materiality).toBeCloseTo(0.5, 10);
  });

  it('the nested V3 strength WINS over a legacy weight on the same edge', () => {
    const result = deriveMissingRootAssumptions(
      graph(
        [{ id: 'f', kind: 'factor', label: 'F' }],
        [{ from: 'f', to: 'g', strength: { mean: 0.25, std: 0.1 }, weight: 0.9 }],
      ),
    );
    expect(result.ranked[0]!.materiality).toBeCloseTo(0.25, 10);
  });

  it('the source/target spelling is read as well as from/to', () => {
    const result = deriveMissingRootAssumptions(
      graph([{ id: 'f', kind: 'factor', label: 'F' }], [{ source: 'f', target: 'g', strength_mean: 0.5 }]),
    );
    expect(result.ranked.map((r) => r.factor_id)).toEqual(['f']);
  });

  it('an edge with NO stated strength contributes nothing rather than a default', () => {
    const result = deriveMissingRootAssumptions(
      graph([{ id: 'f', kind: 'factor', label: 'F' }], [{ from: 'f', to: 'g' }]),
    );
    expect(result.ranked).toEqual([]);
    expect(result.unreachable_count).toBe(1);
  });
});

describe('a bidirected edge is a trust annotation, not a causal path', () => {
  it('it neither carries influence nor makes its target a non-root', () => {
    const result = deriveMissingRootAssumptions(
      graph(
        [
          { id: 'f', kind: 'factor', label: 'F' },
          { id: 'other', kind: 'factor', label: 'Other' },
        ],
        [
          { from: 'other', to: 'f', strength_mean: 0.9, edge_type: 'bidirected' },
          { from: 'f', to: 'g', strength_mean: 0.5 },
          { from: 'other', to: 'g', strength_mean: 0.5, edge_type: 'bidirected' },
        ],
      ),
    );
    // `f` keeps its root status despite the bidirected edge pointing at it.
    expect(result.ranked.map((r) => r.factor_id)).toEqual(['f']);
    // `other` reaches the goal ONLY by a bidirected edge, so it is unreachable.
    expect(result.unreachable_count).toBe(1);
  });
});

describe('fail-closed', () => {
  it('a cycle returns nothing at all — a truncated path sum is a made-up number', () => {
    const result = deriveMissingRootAssumptions(
      graph(
        [
          { id: 'f', kind: 'factor', label: 'F' },
          { id: 'a', kind: 'outcome', label: 'A' },
          { id: 'b', kind: 'outcome', label: 'B' },
        ],
        [
          { from: 'f', to: 'a', strength_mean: 0.5 },
          { from: 'a', to: 'b', strength_mean: 0.5 },
          { from: 'b', to: 'a', strength_mean: 0.5 },
          { from: 'a', to: 'g', strength_mean: 0.5 },
        ],
      ),
    );
    expect(result).toEqual({ ranked: [], unreachable_count: 0 });
  });

  it('a model with no goal returns nothing — there is no influence to rank by', () => {
    const result = deriveMissingRootAssumptions({
      nodes: [{ id: 'f', kind: 'factor', label: 'F' }, { id: 'o', kind: 'outcome', label: 'O' }],
      edges: [{ from: 'f', to: 'o', strength_mean: 0.5 }],
    });
    expect(result.ranked).toEqual([]);
  });

  it.each([
    ['null', null],
    ['a string', 'graph'],
    ['no nodes array', { edges: [] }],
    ['empty nodes', { nodes: [], edges: [] }],
  ])('%s returns an empty result rather than throwing', (_name, input) => {
    expect(deriveMissingRootAssumptions(input)).toEqual({ ranked: [], unreachable_count: 0 });
  });
});

describe('the value predicates are the estate\'s existing ones', () => {
  it.each([
    ['observed_state.value', { observed_state: { value: 0.42 } }],
    ['data.value', { data: { value: 0.42 } }],
  ])('a factor carrying %s is not asked for', (_name, valueFields) => {
    const result = deriveMissingRootAssumptions(
      graph(
        [{ id: 'f', kind: 'factor', label: 'F', ...valueFields }],
        [{ from: 'f', to: 'g', strength_mean: 0.5 }],
      ),
    );
    expect(result.ranked).toEqual([]);
  });

  it('an ignorance prior U(0,1) IS asked for; a narrowed prior is not', () => {
    const build = (prior: unknown) =>
      deriveMissingRootAssumptions(
        graph(
          [{ id: 'f', kind: 'factor', label: 'F', prior }],
          [{ from: 'f', to: 'g', strength_mean: 0.5 }],
        ),
      ).ranked.length;

    expect(build({ distribution: 'uniform', range_min: 0, range_max: 1 })).toBe(1);
    expect(build({ distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true })).toBe(1);
    expect(build({ distribution: 'uniform', range_min: 0.6, range_max: 1 })).toBe(0);
  });
});

describe('a root that cannot reach the goal is COUNTED, never ASKED', () => {
  it('separates the two populations', () => {
    const result = deriveMissingRootAssumptions(
      graph(
        [
          { id: 'reaches', kind: 'factor', label: 'Reaches' },
          { id: 'orphan', kind: 'factor', label: 'Orphan' },
          { id: 'dead', kind: 'outcome', label: 'Dead end' },
        ],
        [
          { from: 'reaches', to: 'g', strength_mean: 0.5 },
          { from: 'orphan', to: 'dead', strength_mean: 0.9 },
        ],
      ),
    );
    expect(result.ranked.map((r) => r.factor_id)).toEqual(['reaches']);
    expect(result.unreachable_count).toBe(1);
  });
});

describe('ties break by id, never by label', () => {
  it('two equally material roots come back in id order regardless of label order', () => {
    const result = deriveMissingRootAssumptions(
      graph(
        [
          { id: 'zzz', kind: 'factor', label: 'Aardvark' },
          { id: 'aaa', kind: 'factor', label: 'Zebra' },
        ],
        [
          { from: 'zzz', to: 'g', strength_mean: 0.5 },
          { from: 'aaa', to: 'g', strength_mean: 0.5 },
        ],
      ),
    );
    expect(result.ranked.map((r) => r.factor_id)).toEqual(['aaa', 'zzz']);
  });
});
