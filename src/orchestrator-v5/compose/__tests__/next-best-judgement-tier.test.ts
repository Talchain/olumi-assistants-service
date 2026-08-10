/**
 * ROADMAP 2.692 slice 2 (+ 2.690 CH-B1) — the `resolve_disagreement` tier's two
 * members and their FEED.
 *
 * PR #887 declared the tier and named why it was memberless: T1/T2's inputs
 * (`prior_facts`, the persisted graph) were not threaded to the selector. This
 * spec drives the two members the design specifies:
 *
 *   T1 `override_stress_test`      — 2.690 CH-1: an `edge_adjudication` fact with
 *                                    `verdict: 'overridden'` NEWER than the latest
 *                                    claim-bearing `run_analysis` fact (I-B5
 *                                    fire-once by fact ordering).
 *   T2 `disagreement_resolution`   — 2.692 §1.4 I-DISAGREE: a persisted-graph edge
 *                                    with `validation.status === 'contested'` and
 *                                    NO `edge_adjudication` fact for its (from,to).
 *
 * FIXTURE STATE-CLASS, stated per the witness doctrine: the ANALYSIS side is the
 * two COMMITTED live captures (`fixtures/dsk-walk/*.enrichment.json`) — never a
 * shape this lane invented. The judgement/graph side has NO in-repo capture (the
 * persisted graph's `validation` metadata and `edge_adjudication` facts are
 * CEE-internal state, absent from wire captures), so those fixtures are NAMED
 * single-purpose constructions mirroring the producer shapes at the bytes
 * (`validation-pipeline/types.ts::ValidationMetadata`,
 * `system-events/dispatch.ts::buildJudgementFact`). The reachability evidence for
 * the contested class is the config note's measured 47.4% neutral-baseline
 * contest rate (config/index.ts:1287-95), not these fixtures.
 *
 * What is asserted:
 *   §1 table-walk: each row's predicate fires exactly that row's lens, with the
 *      row's signal_code and identity-bound target_refs (trap 19 pair in §5)
 *   §2 I-B5 fire-once by fact ordering (+ precondition pinned, trap 13b)
 *   §3 the T2 join and its in-tier ordering, with opposite-direction twins
 *   §4 ABSENT-INPUT IDENTITY: `judgementSignals` omitted ⇒ selection is
 *      byte-identical across both captures × every previousAnalysisLens state
 *   §5 identity binding: the discriminating mutant pair
 *   §6 composability is ELIGIBILITY (2.1024) for the new lenses too
 *   §7 the lens-history replay STRIPS judgementSignals (history cannot fork)
 *   §8 KNOWN-ABSENT pins: CH-2/T4 (unratified floor) changes nothing — with a
 *      presence control proving this harness can see judgement-driven change
 *   §9 the phase-0 reachability census over the committed captures × injected
 *      signal states, recorded rather than asserted away
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  INTERVENTION_TIER_ORDER,
  tierForCandidate,
  ALL_LENS_IDS,
} from '../../coaching/intervention-tiers.js';
import {
  deriveJudgementSignals,
  type JudgementSignals,
} from '../judgement-signals.js';
import { derivePreviousAnalysisLens } from '../lens-history.js';
import { rankInterventions, selectLens, type LensId } from '../lens-selector.js';
import { buildLensSurface, type BlockBuildCtx } from '../phase3-blocks.js';
import { setTestSink } from '../../../utils/telemetry.js';

type Enrichment = Record<string, unknown>;

function loadCapture(file: string): Enrichment {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/dsk-walk/${file}`, import.meta.url), 'utf8'),
  ) as Enrichment;
}
const SESSION_A = loadCapture('session-a.enrichment.json');
const SESSION_B2 = loadCapture('session-b2.enrichment.json');

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function makeFact(enrichment: Enrichment): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-2692-s2',
      leading_option_id: 'opt_leader',
      summary: 'Ran analysis.',
      graph_hash_at_run: 'gh_2692000000000002',
      computed_at: '2026-08-10T00:00:00.000Z',
      constraint_verdict: { may_name_leading_option: true },
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

const CTX: BlockBuildCtx = {
  created_at: '2026-08-10T12:00:00.000Z',
  graph_hash_at_generation: 'gh_2692000000000002',
};

/** DERIVED prev-state list — tracks the LensId union via the tier map's keys. */
const ALL_PREV: (LensId | null)[] = [null, ...ALL_LENS_IDS];

// ── Judgement/graph fixture builders (producer shapes at the bytes) ──────────

/** A persisted-graph shape: nodes with id/label, edges with from/to/validation. */
function makeGraph(
  edges: {
    from: string;
    to: string;
    status?: 'agreed' | 'contested';
    maxDivergence?: number;
  }[],
  nodes?: { id: string; label: string }[],
): unknown {
  const nodeIds = new Set<string>();
  for (const e of edges) {
    nodeIds.add(e.from);
    nodeIds.add(e.to);
  }
  return {
    nodes:
      nodes ??
      // Human-shaped labels: a slug-shaped label ("fac_a") would trip the
      // entity-id-leak prose guard at the block mint and drop the card —
      // correctly, since ids never reach user-facing prose.
      [...nodeIds].map((id) => ({
        id,
        kind: 'factor',
        label: `Factor ${id.slice(4).toUpperCase()}`,
      })),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      ...(e.status !== undefined
        ? {
            validation: {
              status: e.status,
              contested_reasons: e.status === 'contested' ? ['raw_magnitude'] : [],
              max_divergence: e.maxDivergence ?? 0.5,
            },
          }
        : {}),
    })),
  };
}

/** An `edge_adjudication` fact exactly as `buildJudgementFact` mints it. */
function adjudicationFact(
  from: string,
  to: string,
  verdict: 'accepted_pass1' | 'accepted_pass2' | 'overridden' | 'dismissed',
): HandlerFact {
  return {
    fact_type: 'edge_adjudication',
    fact_version: 1,
    noop: false,
    result: {
      from,
      to,
      edge_id: null,
      verdict,
      resolved_strength_mean: verdict === 'overridden' ? 0.4 : null,
      provenance: 'user_set',
    },
  } as unknown as HandlerFact;
}

/** A minimal claim-bearing prior run_analysis fact (graph-hash-bearing). */
function priorAnalysisFact(computedAt: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-2692-s2',
      summary: 'Prior analysis.',
      graph_hash_at_run: 'gh_2692000000000001',
      computed_at: computedAt,
      enrichment: clone(SESSION_B2),
    },
  } as unknown as HandlerFact;
}

/** A `prior_range_edit` fact exactly as `buildJudgementFact` mints it (CH-2's
 *  trigger shape — deliberately NARROW range, the un-built T4's predicate). */
function narrowRangeEditFact(): HandlerFact {
  return {
    fact_type: 'prior_range_edit',
    fact_version: 1,
    noop: false,
    result: {
      target_id: 'fac_energy',
      range_min: 0.5,
      range_max: 0.500001,
      distribution: null,
      provenance: 'user_set',
    },
  } as unknown as HandlerFact;
}

const GRAPH_ONE_CONTESTED = makeGraph([
  { from: 'fac_a', to: 'fac_b', status: 'contested', maxDivergence: 0.7 },
  { from: 'fac_b', to: 'fac_c', status: 'agreed' },
]);

/** prior_facts NEWEST-FIRST (the platform's delivery order): an override newer
 *  than the latest prior analysis. */
const FACTS_OVERRIDE_NEWER: HandlerFact[] = [
  adjudicationFact('fac_a', 'fac_b', 'overridden'),
  priorAnalysisFact('2026-08-09T00:00:00.000Z'),
];

/** The same two facts, ordering FLIPPED: the analysis is newer — I-B5 spent. */
const FACTS_OVERRIDE_OLDER: HandlerFact[] = [
  priorAnalysisFact('2026-08-09T00:00:00.000Z'),
  adjudicationFact('fac_a', 'fac_b', 'overridden'),
];

function signalsFor(
  priorFacts: readonly HandlerFact[],
  graph: unknown,
): JudgementSignals {
  return deriveJudgementSignals(priorFacts, graph);
}

let sink: { event: string; data: Record<string, unknown> }[] = [];
beforeEach(() => {
  sink = [];
  setTestSink((event, data) => {
    sink.push({ event, data });
  });
});
afterEach(() => {
  setTestSink(null);
});

// ============================================================================
// §1 — table-walk: each row's predicate fires exactly that row's lens
// ============================================================================

describe('§1 the resolve_disagreement tier has its two designed members', () => {
  it('T1: an unanswered override fires override_stress_test, in the resolve_disagreement tier', () => {
    // session-a is used so the core three are LIVE on this capture — the tier
    // sits BELOW them, so to see T1 win we must find a cell where the higher
    // tiers pass. Simplest honest cell: strip the analysis-derived triggers by
    // using an enrichment with no factor_sensitivity / option_comparison /
    // robustness, which is a shape the contract admits (enrichment present but
    // sparse). The HIGHER-tier-collision behaviour is measured in §9, not here.
    const sparse: Enrichment = { confidence_tier: 'strong' };
    const ranking = rankInterventions(makeFact(sparse), {
      judgementSignals: signalsFor(FACTS_OVERRIDE_NEWER, GRAPH_ONE_CONTESTED),
    });
    expect(ranking.chosen?.lens).toBe('override_stress_test');
    expect(ranking.chosen?.rationaleCode).toBe('OVERRIDE_UNANSWERED');
    expect(tierForCandidate('override_stress_test')).toBe('resolve_disagreement');
    // The edge identity rides the selection (the fragileEdge pattern).
    expect(ranking.chosen?.judgementEdge).toMatchObject({
      fromId: 'fac_a',
      toId: 'fac_b',
    });
  });

  it('T2: a contested-unadjudicated edge fires disagreement_resolution', () => {
    const sparse: Enrichment = { confidence_tier: 'strong' };
    const ranking = rankInterventions(makeFact(sparse), {
      judgementSignals: signalsFor([], GRAPH_ONE_CONTESTED),
    });
    expect(ranking.chosen?.lens).toBe('disagreement_resolution');
    expect(ranking.chosen?.rationaleCode).toBe('CONTESTED_UNADJUDICATED');
    expect(tierForCandidate('disagreement_resolution')).toBe('resolve_disagreement');
    expect(ranking.chosen?.judgementEdge).toMatchObject({
      fromId: 'fac_a',
      toId: 'fac_b',
    });
  });

  it('T1 outranks T2 within the tier (CH-1 outranks — 2.690 §B.3 sequencing)', () => {
    const sparse: Enrichment = { confidence_tier: 'strong' };
    const ranking = rankInterventions(makeFact(sparse), {
      judgementSignals: signalsFor(FACTS_OVERRIDE_NEWER, GRAPH_ONE_CONTESTED),
    });
    // fac_b→fac_c agreed; fac_a→fac_b contested AND overridden — the override
    // answers the contest, so T2's join is EMPTY here and T1 fires. Use a graph
    // where a SECOND contested edge keeps T2 live:
    const graphTwo = makeGraph([
      { from: 'fac_a', to: 'fac_b', status: 'contested', maxDivergence: 0.7 },
      { from: 'fac_c', to: 'fac_d', status: 'contested', maxDivergence: 0.9 },
    ]);
    const both = rankInterventions(makeFact(sparse), {
      judgementSignals: signalsFor(FACTS_OVERRIDE_NEWER, graphTwo),
    });
    expect(both.chosen?.lens).toBe('override_stress_test');
    const lenses = both.candidates.map((c) => c.lens);
    expect(lenses.indexOf('override_stress_test')).toBeLessThan(
      lenses.indexOf('disagreement_resolution'),
    );
    // And the single-edge case above chose T1, not T2:
    expect(ranking.chosen?.lens).toBe('override_stress_test');
  });

  it('the tier sits in the ratified band: below the core three, above challenge_protocol', () => {
    const order = INTERVENTION_TIER_ORDER;
    const disagreement = order.indexOf('resolve_disagreement');
    expect(disagreement).toBeGreaterThan(order.indexOf('orient'));
    expect(disagreement).toBeGreaterThan(order.indexOf('challenge_premortem'));
    expect(disagreement).toBeGreaterThan(order.indexOf('estimate'));
    expect(disagreement).toBeLessThan(order.indexOf('challenge_protocol'));
  });

  it('on a capture where the core three fire, both new lenses are ELIGIBLE-AND-OUTRANKED, never dark-by-shape', () => {
    const ranking = rankInterventions(makeFact(clone(SESSION_B2)), {
      judgementSignals: signalsFor(FACTS_OVERRIDE_NEWER, GRAPH_ONE_CONTESTED),
    });
    // The capture's own head (sensitivity, isolated door) still wins…
    expect(ranking.chosen?.lens).toBe('sensitivity_flip_risk');
    // …and T1 is IN the race with a recorded loss reason, not silently absent.
    const t1 = ranking.candidates.find((c) => c.lens === 'override_stress_test');
    expect(t1?.notSelectedReason).toBe('outranked');
  });
});

// ============================================================================
// §2 — I-B5: fire-once by fact ordering
// ============================================================================

describe('§2 I-B5 fire-once via fact ordering, never a ledger', () => {
  const sparse: Enrichment = { confidence_tier: 'strong' };

  it('an override NEWER than the latest prior analysis fires', () => {
    const signals = signalsFor(FACTS_OVERRIDE_NEWER, GRAPH_ONE_CONTESTED);
    expect(signals.overriddenUnanswered).toHaveLength(1);
    const sel = selectLens(makeFact(sparse), { judgementSignals: signals });
    expect(sel?.lens).toBe('override_stress_test');
  });

  it('OPPOSITE TWIN: the same facts with the ordering flipped do NOT fire (spent)', () => {
    // Precondition pinned in-test (trap 13b): the suppressing fixture is the
    // SAME pair of facts — §2's first case proves it fires when the ordering
    // flips, so suppression here is provably the ordering's doing.
    const signals = signalsFor(FACTS_OVERRIDE_OLDER, GRAPH_ONE_CONTESTED);
    expect(signals.overriddenUnanswered).toHaveLength(0);
    const sel = selectLens(makeFact(sparse), { judgementSignals: signals });
    expect(sel?.lens).not.toBe('override_stress_test');
  });

  it('re-override after a newer analysis RE-ARMS (a repeated override is a fresh signal)', () => {
    const facts: HandlerFact[] = [
      adjudicationFact('fac_a', 'fac_b', 'overridden'), // newest: re-override
      priorAnalysisFact('2026-08-09T12:00:00.000Z'),
      adjudicationFact('fac_a', 'fac_b', 'overridden'), // original, spent
      priorAnalysisFact('2026-08-09T00:00:00.000Z'),
    ];
    const signals = signalsFor(facts, GRAPH_ONE_CONTESTED);
    expect(signals.overriddenUnanswered).toHaveLength(1);
  });

  it('OPPOSITE TWIN: non-overridden verdicts never arm T1 (closed enum, all three)', () => {
    for (const verdict of ['accepted_pass1', 'accepted_pass2', 'dismissed'] as const) {
      const facts: HandlerFact[] = [
        adjudicationFact('fac_a', 'fac_b', verdict),
        priorAnalysisFact('2026-08-09T00:00:00.000Z'),
      ];
      expect(signalsFor(facts, GRAPH_ONE_CONTESTED).overriddenUnanswered).toHaveLength(0);
    }
  });
});

// ============================================================================
// §3 — the T2 join and its in-tier ordering
// ============================================================================

describe('§3 the contested-unadjudicated join (the design’s heart)', () => {
  it('any adjudication verdict removes the edge from the T2 set (structurally spent)', () => {
    for (const verdict of [
      'accepted_pass1',
      'accepted_pass2',
      'overridden',
      'dismissed',
    ] as const) {
      const signals = signalsFor(
        [adjudicationFact('fac_a', 'fac_b', verdict)],
        GRAPH_ONE_CONTESTED,
      );
      expect(signals.contestedUnadjudicated).toHaveLength(0);
    }
    // PRESENCE CONTROL: with no adjudication the same graph yields the edge.
    expect(signalsFor([], GRAPH_ONE_CONTESTED).contestedUnadjudicated).toHaveLength(1);
  });

  it('OPPOSITE TWIN: agreed edges are never in the set', () => {
    const graph = makeGraph([{ from: 'fac_a', to: 'fac_b', status: 'agreed' }]);
    expect(signalsFor([], graph).contestedUnadjudicated).toHaveLength(0);
  });

  it('an adjudication for a DIFFERENT edge does not spend the contested one', () => {
    const signals = signalsFor(
      [adjudicationFact('fac_b', 'fac_c', 'dismissed')],
      GRAPH_ONE_CONTESTED,
    );
    expect(signals.contestedUnadjudicated).toHaveLength(1);
    expect(signals.contestedUnadjudicated[0]).toMatchObject({ fromId: 'fac_a', toId: 'fac_b' });
  });

  it('ordering leg 1: lowest e_value among joined edges wins (most load-bearing)', () => {
    const graph = makeGraph([
      { from: 'fac_a', to: 'fac_b', status: 'contested', maxDivergence: 0.9 },
      { from: 'fac_c', to: 'fac_d', status: 'contested', maxDivergence: 0.1 },
    ]);
    const enrichment: Enrichment = {
      confidence_tier: 'strong',
      edge_e_values: [
        { from_id: 'fac_a', to_id: 'fac_b', e_value: 3.5 },
        { from_id: 'fac_c', to_id: 'fac_d', e_value: 1.2 },
      ],
    };
    const sel = selectLens(makeFact(enrichment), {
      judgementSignals: signalsFor([], graph),
    });
    expect(sel?.lens).toBe('disagreement_resolution');
    // Lowest e-value, NOT highest divergence — the two orderings disagree on
    // this fixture by construction, so passing proves which leg decided.
    expect(sel?.judgementEdge).toMatchObject({ fromId: 'fac_c', toId: 'fac_d' });
  });

  it('OPPOSITE TWIN: with no e-value join, highest max_divergence wins', () => {
    const graph = makeGraph([
      { from: 'fac_a', to: 'fac_b', status: 'contested', maxDivergence: 0.2 },
      { from: 'fac_c', to: 'fac_d', status: 'contested', maxDivergence: 0.8 },
    ]);
    const sel = selectLens(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signalsFor([], graph),
    });
    expect(sel?.judgementEdge).toMatchObject({ fromId: 'fac_c', toId: 'fac_d' });
  });

  it('tie → canonical (from,to) lexicographic', () => {
    const graph = makeGraph([
      { from: 'fac_z', to: 'fac_x', status: 'contested', maxDivergence: 0.5 },
      { from: 'fac_a', to: 'fac_b', status: 'contested', maxDivergence: 0.5 },
    ]);
    const sel = selectLens(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signalsFor([], graph),
    });
    expect(sel?.judgementEdge).toMatchObject({ fromId: 'fac_a', toId: 'fac_b' });
  });

  it('a partial e-value join still prefers the joined edge (leg 1 over leg 2)', () => {
    const graph = makeGraph([
      { from: 'fac_a', to: 'fac_b', status: 'contested', maxDivergence: 0.9 },
      { from: 'fac_c', to: 'fac_d', status: 'contested', maxDivergence: 0.1 },
    ]);
    const enrichment: Enrichment = {
      confidence_tier: 'strong',
      edge_e_values: [{ from_id: 'fac_c', to_id: 'fac_d', e_value: 2.0 }],
    };
    const sel = selectLens(makeFact(enrichment), {
      judgementSignals: signalsFor([], graph),
    });
    expect(sel?.judgementEdge).toMatchObject({ fromId: 'fac_c', toId: 'fac_d' });
  });
});

// ============================================================================
// §4 — ABSENT-INPUT IDENTITY (the 2.211/2.989 guarantee, extended)
// ============================================================================

describe('§4 judgementSignals omitted ⇒ selection byte-identical (both captures × all prev states)', () => {
  it('toStrictEqual across the whole committed evidence base', () => {
    for (const capture of [SESSION_A, SESSION_B2]) {
      for (const prev of ALL_PREV) {
        const without = selectLens(makeFact(clone(capture)), {
          previousAnalysisLens: prev,
        });
        const withEmpty = selectLens(makeFact(clone(capture)), {
          previousAnalysisLens: prev,
          judgementSignals: { overriddenUnanswered: [], contestedUnadjudicated: [] },
        });
        expect(withEmpty).toStrictEqual(without);
      }
    }
  });
});

// ============================================================================
// §5 — identity binding: the discriminating mutant pair (trap 19)
// ============================================================================

describe('§5 target_refs bind to the fired edge BY IDENTITY', () => {
  const graphTwo = makeGraph([
    { from: 'fac_a', to: 'fac_b', status: 'contested', maxDivergence: 0.9 },
    { from: 'fac_c', to: 'fac_d', status: 'contested', maxDivergence: 0.1 },
  ]);

  it('the block’s target_refs carry the WINNING edge’s composite id and edge kind', () => {
    const surface = buildLensSurface(
      makeFact({ confidence_tier: 'strong' }),
      CTX,
      null,
      signalsFor([], graphTwo),
    );
    expect(surface).not.toBeNull();
    expect(surface!.selection.lens).toBe('disagreement_resolution');
    const block = surface!.suggestion as unknown as {
      target_refs: { id: string; label: string; kind: string }[];
      signal_code?: string;
      body: string;
      title: string;
      action_label?: string;
    };
    // Highest divergence (no e-values here) = fac_a→fac_b. Bound by IDENTITY:
    // the composite id, not a label predicate another edge could satisfy.
    expect(block.target_refs).toHaveLength(1);
    expect(block.target_refs[0]).toMatchObject({
      id: 'fac_a→fac_b',
      kind: 'edge',
    });
    expect(block.signal_code).toBe('UNRESOLVED_DISAGREEMENT');
    // The naming sentence LEADS the body (truncation-safe) and names BOTH ends.
    expect(block.body.startsWith('The two drafting passes disagreed')).toBe(true);
    expect(block.body).toContain('Factor A');
    expect(block.body).toContain('Factor B');
    // v1 ships no action chip on this lens — the honest minimal surface.
    expect(block.action_label).toBeUndefined();
  });

  it('T1’s block carries its own signal_code and the overridden edge’s identity', () => {
    const surface = buildLensSurface(
      makeFact({ confidence_tier: 'strong' }),
      CTX,
      null,
      signalsFor(FACTS_OVERRIDE_NEWER, GRAPH_ONE_CONTESTED),
    );
    expect(surface).not.toBeNull();
    expect(surface!.selection.lens).toBe('override_stress_test');
    const block = surface!.suggestion as unknown as {
      target_refs: { id: string; kind: string }[];
      signal_code?: string;
      body: string;
    };
    expect(block.target_refs[0]).toMatchObject({ id: 'fac_a→fac_b', kind: 'edge' });
    expect(block.signal_code).toBe('OVERRIDE_UNANSWERED');
    expect(block.body.startsWith('You overrode')).toBe(true);
  });

  it('DISCRIMINATING PAIR: mutating the LOSING edge leaves the selection bound to the winner', () => {
    // Break-for-a-DIFFERENT-object control: renaming the losing edge's nodes
    // must not move the target. Paired with the winner-mutation below, this
    // proves the assertion binds to the named object, not to "any edge".
    const mutated = makeGraph([
      { from: 'fac_a', to: 'fac_b', status: 'contested', maxDivergence: 0.9 },
      { from: 'fac_zz', to: 'fac_qq', status: 'contested', maxDivergence: 0.1 },
    ]);
    const sel = selectLens(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signalsFor([], mutated),
    });
    expect(sel?.judgementEdge).toMatchObject({ fromId: 'fac_a', toId: 'fac_b' });
    // And mutating the WINNER moves it (the same probe CAN discriminate):
    const winnerGone = makeGraph([
      { from: 'fac_a', to: 'fac_b', status: 'agreed' },
      { from: 'fac_zz', to: 'fac_qq', status: 'contested', maxDivergence: 0.1 },
    ]);
    const sel2 = selectLens(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signalsFor([], winnerGone),
    });
    expect(sel2?.judgementEdge).toMatchObject({ fromId: 'fac_zz', toId: 'fac_qq' });
  });
});

// ============================================================================
// §6 — composability is ELIGIBILITY for the new lenses too (2.1024)
// ============================================================================

describe('§6 an unphraseable judgement offer never wins the slot', () => {
  it('a label that overflows the naming cap makes the candidate offer_not_composable', () => {
    const longLabel = 'X'.repeat(400); // naming sentence alone exceeds BODY_MAX
    const graph = makeGraph(
      [{ from: 'fac_a', to: 'fac_b', status: 'contested', maxDivergence: 0.7 }],
      [
        { id: 'fac_a', label: longLabel },
        { id: 'fac_b', label: 'Short' },
      ],
    );
    const ranking = rankInterventions(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signalsFor([], graph),
    });
    const t2 = ranking.ineligible.find((c) => c.lens === 'disagreement_resolution');
    expect(t2?.reason).toBe('offer_not_composable');
    expect(ranking.candidates.some((c) => c.lens === 'disagreement_resolution')).toBe(false);
  });

  it('PRESENCE CONTROL: the same shape with short labels is eligible and wins', () => {
    const ranking = rankInterventions(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signalsFor([], GRAPH_ONE_CONTESTED),
    });
    expect(ranking.chosen?.lens).toBe('disagreement_resolution');
  });
});

// ============================================================================
// §7 — the lens-history replay STRIPS judgementSignals
// ============================================================================

describe('§7 history derivation cannot fork on judgement signals', () => {
  it('derivePreviousAnalysisLens is byte-identical with and without signals on baseOptions', () => {
    // Two prior analyses so the replay genuinely walks. The signals injected
    // here would (if un-stripped) hand the first replayed turn to a judgement
    // lens and flip the derived history.
    const priorFacts: HandlerFact[] = [
      priorAnalysisFact('2026-08-09T12:00:00.000Z'),
      priorAnalysisFact('2026-08-09T00:00:00.000Z'),
    ];
    const without = derivePreviousAnalysisLens(priorFacts, {});
    const withSignals = derivePreviousAnalysisLens(priorFacts, {
      judgementSignals: signalsFor([], GRAPH_ONE_CONTESTED),
    } as never);
    expect(withSignals).toBe(without);
    // PRESENCE CONTROL for the probe itself: the signals DO change a live
    // selection on the same enrichment — so agreement above is the strip's
    // doing, not two empty extractions agreeing (the zsh-modifier lesson).
    const live = selectLens(makeFact(clone(SESSION_B2)), {
      judgementSignals: signalsFor([], GRAPH_ONE_CONTESTED),
    });
    const pristine = selectLens(makeFact(clone(SESSION_B2)), {});
    expect(live?.lens).toBe(pristine?.lens); // outranked on this capture…
    const sparseLive = selectLens(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signalsFor([], GRAPH_ONE_CONTESTED),
    });
    expect(sparseLive?.lens).toBe('disagreement_resolution'); // …but live where tiers pass
  });
});

// ============================================================================
// §8 — KNOWN-ABSENT pins (built tiers vs design tiers)
// ============================================================================

describe('§8 what is deliberately NOT built, pinned so growth is loud', () => {
  it('CH-2/T4 (revealed overconfidence): a narrow prior_range_edit changes NOTHING — the floor is an unratified Paul decision', () => {
    const factsWithRangeEdit: HandlerFact[] = [
      narrowRangeEditFact(),
      priorAnalysisFact('2026-08-09T00:00:00.000Z'),
    ];
    const signals = signalsFor(factsWithRangeEdit, GRAPH_ONE_CONTESTED);
    // The derivation exposes NO range-edit signal class at all…
    expect(Object.keys(signals).sort()).toStrictEqual([
      'contestedUnadjudicated',
      'overriddenUnanswered',
    ]);
    // …and the selection over a sparse enrichment is identical to the
    // no-range-edit case (T2 wins on the graph either way).
    const withEdit = selectLens(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signals,
    });
    const withoutEdit = selectLens(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signalsFor(
        [priorAnalysisFact('2026-08-09T00:00:00.000Z')],
        GRAPH_ONE_CONTESTED,
      ),
    });
    expect(withEdit).toStrictEqual(withoutEdit);
    // PRESENCE CONTROL: the same harness DOES see judgement-driven change when
    // an overridden adjudication is injected instead.
    const withOverride = selectLens(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signalsFor(FACTS_OVERRIDE_NEWER, GRAPH_ONE_CONTESTED),
    });
    expect(withOverride?.lens).toBe('override_stress_test');
    expect(withOverride).not.toStrictEqual(withoutEdit);
  });

  it('the built member set of resolve_disagreement is EXACTLY {override_stress_test, disagreement_resolution}', () => {
    const members = ALL_LENS_IDS.filter(
      (l) => tierForCandidate(l) === 'resolve_disagreement',
    ).sort();
    expect(members).toStrictEqual(['disagreement_resolution', 'override_stress_test']);
  });
});

// ============================================================================
// §10 — fail-closed derivation reads (2.690 I-B6: absent/malformed ⇒ NOT-FIRED)
// ============================================================================

describe('§10 the derivation fails closed on every malformed input', () => {
  const EMPTY = { overriddenUnanswered: [], contestedUnadjudicated: [] };

  it('absent / null / non-object graph ⇒ empty bag', () => {
    expect(deriveJudgementSignals([], undefined)).toStrictEqual(EMPTY);
    expect(deriveJudgementSignals([], null)).toStrictEqual(EMPTY);
    expect(deriveJudgementSignals([], 'not-a-graph')).toStrictEqual(EMPTY);
    expect(deriveJudgementSignals(FACTS_OVERRIDE_NEWER, undefined)).toStrictEqual(EMPTY);
  });

  it('a graph whose nodes cannot label the edge drops the SIGNAL, never defaults it', () => {
    const graph = {
      nodes: [{ id: 'fac_a', label: 'Factor A' }], // fac_b unlabelled
      edges: [
        {
          from: 'fac_a',
          to: 'fac_b',
          validation: { status: 'contested', contested_reasons: ['raw_magnitude'], max_divergence: 0.7 },
        },
      ],
    };
    expect(deriveJudgementSignals([], graph).contestedUnadjudicated).toHaveLength(0);
    expect(deriveJudgementSignals(FACTS_OVERRIDE_NEWER, graph).overriddenUnanswered).toHaveLength(0);
    // PRESENCE CONTROL: labelling fac_b restores both signal classes.
    const labelled = {
      ...graph as Record<string, unknown>,
      nodes: [
        { id: 'fac_a', label: 'Factor A' },
        { id: 'fac_b', label: 'Factor B' },
      ],
    };
    expect(deriveJudgementSignals([], labelled).contestedUnadjudicated).toHaveLength(1);
    expect(deriveJudgementSignals(FACTS_OVERRIDE_NEWER, labelled).overriddenUnanswered).toHaveLength(1);
  });

  it('malformed validation shapes never read as contested', () => {
    for (const validation of [null, 'contested', { status: 'CONTESTED' }, {}, { status: 42 }]) {
      const graph = {
        nodes: [
          { id: 'fac_a', label: 'Factor A' },
          { id: 'fac_b', label: 'Factor B' },
        ],
        edges: [{ from: 'fac_a', to: 'fac_b', validation }],
      };
      expect(deriveJudgementSignals([], graph).contestedUnadjudicated).toHaveLength(0);
    }
  });

  it('non-finite max_divergence becomes null (absent ≠ zero) and sorts last', () => {
    const graph = {
      nodes: [
        { id: 'fac_a', label: 'Factor A' },
        { id: 'fac_b', label: 'Factor B' },
        { id: 'fac_c', label: 'Factor C' },
        { id: 'fac_d', label: 'Factor D' },
      ],
      edges: [
        {
          from: 'fac_a',
          to: 'fac_b',
          validation: { status: 'contested', contested_reasons: ['raw_magnitude'], max_divergence: 'high' },
        },
        {
          from: 'fac_c',
          to: 'fac_d',
          validation: { status: 'contested', contested_reasons: ['raw_magnitude'], max_divergence: 0.1 },
        },
      ],
    };
    const signals = deriveJudgementSignals([], graph);
    const ab = signals.contestedUnadjudicated.find((s) => s.fromId === 'fac_a');
    expect(ab?.maxDivergence).toBeNull();
    // The evaluator must prefer the finite-divergence edge over the null one,
    // even though (fac_a,fac_b) sorts first lexicographically.
    const sel = selectLens(makeFact({ confidence_tier: 'strong' }), {
      judgementSignals: signals,
    });
    expect(sel?.judgementEdge).toMatchObject({ fromId: 'fac_c', toId: 'fac_d' });
  });
});

// ============================================================================
// §9 — phase-0 reachability census (recorded, never asserted away)
// ============================================================================

describe('§9 reachability census: captures × prev states × signal states', () => {
  it('records where the new tier wins vs is outranked, and starves nothing', () => {
    const signalStates: [string, JudgementSignals | undefined][] = [
      ['none', undefined],
      ['t1', signalsFor(FACTS_OVERRIDE_NEWER, GRAPH_ONE_CONTESTED)],
      ['t2', signalsFor([], GRAPH_ONE_CONTESTED)],
      [
        't1+t2',
        signalsFor(
          FACTS_OVERRIDE_NEWER,
          makeGraph([
            { from: 'fac_a', to: 'fac_b', status: 'contested', maxDivergence: 0.7 },
            { from: 'fac_c', to: 'fac_d', status: 'contested', maxDivergence: 0.9 },
          ]),
        ),
      ],
    ];
    const wins = new Map<string, number>();
    let cells = 0;
    let judgementWins = 0;
    for (const capture of [SESSION_A, SESSION_B2]) {
      for (const prev of ALL_PREV) {
        for (const [, signals] of signalStates) {
          cells += 1;
          const sel = selectLens(makeFact(clone(capture)), {
            previousAnalysisLens: prev,
            ...(signals !== undefined ? { judgementSignals: signals } : {}),
          });
          const key = sel?.lens ?? 'NONE';
          wins.set(key, (wins.get(key) ?? 0) + 1);
          if (key === 'override_stress_test' || key === 'disagreement_resolution') {
            judgementWins += 1;
          }
        }
      }
    }
    // DERIVED cell count (2 captures × (1 + |LensId|) prev states × 4 signal states).
    expect(cells).toBe(2 * ALL_PREV.length * signalStates.length);
    // ⚠ THE HONEST NUMBER, RECORDED: on the two committed captures the core
    // tiers are live on nearly every cell, so the new tier's win rate is LOW —
    // it wins exactly where a correlated-yield head hands the slot down and on
    // no other committed-capture cell. On the sparse shapes the design targets
    // (higher tiers silent) it wins outright (§1). Both directions are pinned:
    expect(judgementWins).toBeGreaterThan(0); // reachable on a live capture
    // …and nothing previously reachable is starved by the new tier:
    expect(wins.get('sensitivity_flip_risk') ?? 0).toBeGreaterThan(0);
    expect(wins.get('consider_opposite') ?? 0).toBeGreaterThan(0);
    expect(wins.get('devils_advocacy') ?? 0).toBeGreaterThan(0);
    expect(wins.get('fragile_edge_resolution') ?? 0).toBeGreaterThan(0);
  });
});
