/**
 * EDGE-REFERENCING REVIEW CARDS REACH THE USER.
 *
 * ⛔ THE MEASURED DEFECT (Render `srv-d4slpaili9vc73eiq4og`, 17 Sep 2026
 * 17:39–18:20Z, ONE real user session, TWELVE occurrences):
 *
 *   event:"v5.phase3.block_dropped" block_type:"review_card"
 *   block_kind:"scenario_context" drop_reason:"lookup_miss" field:"edge_id"
 *
 *   event:"v5.phase3.block_dropped" block_type:"review_card"
 *   block_kind:"pre_mortem"        drop_reason:"lookup_miss" field:"grounded_in"
 *
 * Every pre-mortem and scenario-context card that referenced a RELATIONSHIP was
 * deleted before egress. The user asked, the model answered, and the answer was
 * thrown away by a lookup that could not succeed.
 *
 * ⭐ ROOT CAUSE — A CONTRACT GAP, NOT A BAD REFERENCE. `EdgeV3Schema`
 * (`@talchain/schemas` 0.55.0 `dist/graph.js:280`) declares
 * `{ from, to, strength, exists_probability, effect_direction?, edge_type?,
 * label? }` — and NO `id`. The contrast control fires: `NodeV3Schema`
 * (`:256`) declares `id: z.string().min(1).max(100).regex(NODE_ID_PATTERN)`.
 * The contract states the consequence itself: *"EDGES ARE ADDRESSED BY
 * `(from, to)`, NEVER BY AN ID … an edge's only identity in the canonical graph
 * is its endpoint pair"* (`dist/boundary/turn-payload.js:573`).
 *
 * `populateGraphNodeLookup`'s edge pass keyed the lookup on a literal `e.id`
 * and `continue`d when it was absent — so for a canonical graph NO EDGE WAS
 * EVER REGISTERED, and every edge reference missed by construction. Both drop
 * sites are correct fail-closed gates; the lookup underneath them was empty.
 *
 * ⭐ AND THE MODEL WAS CITING THE RIGHT THING ALL ALONG. The served prompt says
 * *"scenario_contexts keys: edge_ids from isl_results.fragile_edges only"* and
 * *"pre_mortem.grounded_in: fragile edge_ids … that exist in the inputs"*, and
 * `decision-review-graph-projection.ts::carryEdgeIds` hands the model
 * `id: from->to` for exactly those edges. The producer emitted the address the
 * projection gave it; the consumer looked for a field the contract does not
 * define. Widening the drop gates would have been a relaxation. This is not —
 * it makes the ADDRESS resolvable, by the identity the contract actually has.
 *
 * WHAT IS ASSERTED HERE IS THE USER OUTCOME: the card SURVIVES `egress`
 * (`buildReviewCardBlocks`) and points at the real relationship. Every
 * assertion binds by IDENTITY (exact ref id / label / kind), never by a value
 * predicate another object could satisfy (CLAUDE.md trap 19).
 */

import { describe, expect, it, vi } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { log } from '../../../utils/telemetry.js';

import {
  buildCoachingBlocks,
  buildGraphNodeLookup,
  buildGraphNodeLookupFromGraph,
  buildReviewCardBlocks,
  type BlockBuildCtx,
} from '../phase3-blocks.js';
import {
  AMBIGUOUS_LABEL,
  buildLabelIndex,
  normaliseForPhraseMatch,
} from '../../../orchestrator/shared/referent-resolver.js';


const CTX: BlockBuildCtx = {
  created_at: '2026-09-17T18:00:00.000Z',
  graph_hash_at_generation: 'gh_edgeidentity0001',
};

const NODES = [
  { id: 'fac_wholesale', label: 'Wholesale Unit Price', kind: 'factor' },
  { id: 'fac_volume', label: 'Retail Demand Volume', kind: 'factor' },
  { id: 'opt_bristol', label: 'Expand The Bristol Site', kind: 'option' },
];

/**
 * A CANONICAL `EdgeV3` EDGE — every field the contract declares, and NO `id`,
 * because the contract declares none. This fixture is the defect: it is what a
 * real persisted graph looks like.
 */
const CANONICAL_EDGE = {
  from: 'fac_wholesale',
  to: 'fac_volume',
  strength: { mean: -0.42, std: 0.11 },
  exists_probability: 0.86,
  effect_direction: 'negative',
  edge_type: 'directed',
} as const;

/** The address the projection hands the model, and the key it cites back. */
const EDGE_ADDRESS = 'fac_wholesale->fac_volume';
/** The other spelling live in this estate (`composeEdgeIdentity`/`parseEdgeId`). */
const EDGE_ADDRESS_ARROW = 'fac_wholesale→fac_volume';
/** What a resolved ref must carry: the actionable composite + derived label. */
const EXPECTED_EDGE_REF = {
  id: 'fac_wholesale→fac_volume',
  label: 'Wholesale Unit Price → Retail Demand Volume',
  kind: 'edge',
} as const;

const TRIGGER = 'Wholesale Unit Price climbs faster than the supplier contract assumed';
const CONSEQUENCE = 'Retail Demand Volume could flip if buyers move to the substitute range';
const FAILURE =
  'It failed because the relationship between the two quantities was assumed to be far steadier than it turned out to be.';

function makeFact(
  decisionReview: Record<string, unknown>,
  edges: readonly unknown[] = [CANONICAL_EDGE],
  nodes: readonly unknown[] = NODES,
): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-edge-identity',
      leading_option_id: 'opt_bristol',
      summary: 'Ran analysis on your current scenario.',
      graph_hash_at_run: 'gh_edgeidentity0001',
      computed_at: '2026-09-17T17:59:00.000Z',
      enrichment: {
        decision_review: decisionReview,
        graph: { nodes, edges },
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

/** Drive the REAL egress path, exactly as compose does. */
function egress(
  decisionReview: Record<string, unknown>,
  edges: readonly unknown[] = [CANONICAL_EDGE],
  nodes: readonly unknown[] = NODES,
) {
  const fact = makeFact(decisionReview, edges, nodes);
  return buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
}

function scenarioCard(
  dr: Record<string, unknown>,
  edges?: readonly unknown[],
  nodes?: readonly unknown[],
) {
  return egress(dr, edges, nodes).find((b) => b.card_kind === 'scenario_context');
}

function preMortemCard(
  dr: Record<string, unknown>,
  edges?: readonly unknown[],
  nodes?: readonly unknown[],
) {
  return egress(dr, edges, nodes).find((b) => b.card_kind === 'pre_mortem');
}

const SCENARIO_ENTRY = {
  trigger_description: TRIGGER,
  consequence: CONSEQUENCE,
} as const;

describe('the two cards the live session lost', () => {
  it('DELIVERS the scenario-context card that references a canonical (from,to) edge', () => {
    const card = scenarioCard({
      scenario_contexts: { [EDGE_ADDRESS]: SCENARIO_ENTRY },
    });
    expect(card).toBeDefined();
    expect(card?.target_refs).toEqual([EXPECTED_EDGE_REF]);
  });

  it('DELIVERS the pre-mortem card grounded ONLY in a canonical (from,to) edge', () => {
    const card = preMortemCard({
      pre_mortem: { failure_scenario: FAILURE, grounded_in: [EDGE_ADDRESS] },
    });
    expect(card).toBeDefined();
    expect(card?.target_refs).toEqual([EXPECTED_EDGE_REF]);
  });

  it('DELIVERS both on ONE turn — the shape the live session actually sent', () => {
    const blocks = egress({
      scenario_contexts: { [EDGE_ADDRESS]: SCENARIO_ENTRY },
      pre_mortem: { failure_scenario: FAILURE, grounded_in: [EDGE_ADDRESS] },
    });
    expect(blocks.filter((b) => b.card_kind === 'scenario_context')).toHaveLength(1);
    expect(blocks.filter((b) => b.card_kind === 'pre_mortem')).toHaveLength(1);
  });

  it('resolves the `→` spelling too — `parseEdgeId` accepts both, so the lookup must', () => {
    const card = scenarioCard({
      scenario_contexts: { [EDGE_ADDRESS_ARROW]: SCENARIO_ENTRY },
    });
    expect(card).toBeDefined();
    expect(card?.target_refs).toEqual([EXPECTED_EDGE_REF]);
  });
});

describe('the fail-closed gates are NOT relaxed', () => {
  it('still DROPS a scenario referencing an edge that is not in the graph', () => {
    expect(
      scenarioCard({ scenario_contexts: { 'fac_volume->opt_bristol': SCENARIO_ENTRY } }),
    ).toBeUndefined();
  });

  it('still DROPS a scenario whose endpoints are not nodes at all', () => {
    expect(
      scenarioCard({ scenario_contexts: { 'fac_ghost->fac_phantom': SCENARIO_ENTRY } }),
    ).toBeUndefined();
  });

  it('still DROPS a pre-mortem grounded ONLY in an invented edge address', () => {
    expect(
      preMortemCard({
        pre_mortem: { failure_scenario: FAILURE, grounded_in: ['fac_ghost->fac_phantom'] },
      }),
    ).toBeUndefined();
  });

  it('still DROPS a reference carrying no separator at all (not an address)', () => {
    expect(
      scenarioCard({ scenario_contexts: { edge_00000000: SCENARIO_ENTRY } }),
    ).toBeUndefined();
  });

  /**
   * DIRECTION IS PART OF THE IDENTITY. The contract's address is directional
   * (`endpointAddress`, `parseEdgeId` and `structural_add_edge` all are), so a
   * REVERSED address is a different claim and must not silently resolve — not
   * even for `edge_type: 'bidirected'`, where registering both orientations
   * would put TWO entries carrying ONE label into the lookup and
   * `buildReferentIndex` would mark that label `AMBIGUOUS_LABEL`, breaking
   * prose linking for a real relationship. Reported, deliberate, unchanged.
   */
  it('still DROPS a REVERSED address, including for a bidirected edge', () => {
    const bidirected = { ...CANONICAL_EDGE, edge_type: 'bidirected' };
    expect(
      scenarioCard({ scenario_contexts: { 'fac_volume->fac_wholesale': SCENARIO_ENTRY } }, [
        bidirected,
      ]),
    ).toBeUndefined();
  });
});

describe('AMBIGUITY: parallel edges share one (from,to) address', () => {
  /**
   * ⚠ THE PAIR DOES NOT UNIQUELY RESOLVE EVERY CASE, and the rule is explicit
   * rather than "first match wins". Two edges between the SAME ordered pair
   * have ONE address between them; attaching the card to an arbitrary one of
   * them would assert a relationship identity nothing gave us — the exact
   * fabrication class the `lookup_miss` gates exist to prevent. So an address
   * claimed by more than one edge resolves to NEITHER, and the card drops
   * exactly as it does today, with its existing telemetry.
   *
   * This mirrors `deriveLabelIndex`'s own `AMBIGUOUS_LABEL` doctrine in the
   * sibling resolver — same estate, same shape, not a new opinion.
   */
  it('DROPS when two parallel edges claim the same address — neither is chosen', () => {
    const parallel = [
      { ...CANONICAL_EDGE, label: 'Price pressure on volume' },
      { ...CANONICAL_EDGE, label: 'Substitution pressure on volume' },
    ];
    expect(
      scenarioCard({ scenario_contexts: { [EDGE_ADDRESS]: SCENARIO_ENTRY } }, parallel),
    ).toBeUndefined();
  });

  it('an ambiguous address does not poison the OTHER edges in the graph', () => {
    const graph = {
      nodes: NODES,
      edges: [
        { ...CANONICAL_EDGE, label: 'Price pressure on volume' },
        { ...CANONICAL_EDGE, label: 'Substitution pressure on volume' },
        { from: 'fac_volume', to: 'opt_bristol', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.7 },
      ],
    };
    const lookup = buildGraphNodeLookupFromGraph(graph);
    expect(lookup.get('fac_wholesale->fac_volume')).toBeUndefined();
    expect(lookup.get('fac_volume->opt_bristol')).toEqual({
      id: 'fac_volume→opt_bristol',
      label: 'Retail Demand Volume → Expand The Bristol Site',
      kind: 'edge',
    });
  });

  /**
   * A producer that DOES mint its own ids can still distinguish its parallel
   * edges — an explicit id is unambiguous by construction and keeps its own key.
   */
  it('parallel edges with DISTINCT explicit ids each stay addressable by that id', () => {
    const lookup = buildGraphNodeLookupFromGraph({
      nodes: NODES,
      edges: [
        { ...CANONICAL_EDGE, id: 'edge_price_a', label: 'Price pressure on volume' },
        { ...CANONICAL_EDGE, id: 'edge_price_b', label: 'Substitution pressure on volume' },
      ],
    });
    expect(lookup.get('edge_price_a')?.label).toBe('Price pressure on volume');
    expect(lookup.get('edge_price_b')?.label).toBe('Substitution pressure on volume');
  });
});

describe('no regression for producers that DO carry an explicit edge id', () => {
  it('an explicit id still resolves, and now the address does too', () => {
    const edges = [{ ...CANONICAL_EDGE, id: 'edge_abc123', label: 'Price pressure on volume' }];
    const byId = scenarioCard({ scenario_contexts: { edge_abc123: SCENARIO_ENTRY } }, edges);
    expect(byId?.target_refs).toEqual([
      { id: 'edge_abc123', label: 'Price pressure on volume', kind: 'edge' },
    ]);
    const byAddress = scenarioCard({ scenario_contexts: { [EDGE_ADDRESS]: SCENARIO_ENTRY } }, edges);
    expect(byAddress?.target_refs).toEqual([
      { id: 'edge_abc123', label: 'Price pressure on volume', kind: 'edge' },
    ]);
  });

  it('an explicit label still wins over the derived `from → to` label', () => {
    const lookup = buildGraphNodeLookupFromGraph({
      nodes: NODES,
      edges: [{ ...CANONICAL_EDGE, label: 'Price pressure on volume' }],
    });
    expect(lookup.get(EDGE_ADDRESS)).toEqual({
      id: 'fac_wholesale→fac_volume',
      label: 'Price pressure on volume',
      kind: 'edge',
    });
  });
});

describe('the lookup stays ONE ENTRY PER EDGE (prose linking must not go ambiguous)', () => {
  /**
   * ⭐ THE REGRESSION THIS FORBIDS, measured in the sibling resolver:
   * `buildReferentIndex` buckets by normalised LABEL over `lookup.values()`,
   * and `deriveLabelIndex` marks any label with two owners `AMBIGUOUS_LABEL`.
   * Registering one edge under several keys would therefore stop that edge's
   * label linking in prose anywhere. Asserted by COUNT, so an alias added later
   * REDs here rather than silently degrading prose linking.
   */
  it('registers exactly one entry per node and per edge', () => {
    const lookup = buildGraphNodeLookupFromGraph({
      nodes: NODES,
      edges: [
        CANONICAL_EDGE,
        { from: 'fac_volume', to: 'opt_bristol', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.7 },
      ],
    });
    expect(lookup.size).toBe(NODES.length + 2);
    const edgeLabels = [...lookup.values()].filter((r) => r.kind === 'edge').map((r) => r.label);
    expect(new Set(edgeLabels).size).toBe(edgeLabels.length);
  });

  it('an edge whose endpoints are not both resolvable is still skipped', () => {
    const lookup = buildGraphNodeLookupFromGraph({
      nodes: NODES,
      edges: [{ from: 'fac_wholesale', to: 'fac_missing', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.5 }],
    });
    expect(lookup.size).toBe(NODES.length);
  });
});

/**
 * ⭐⭐ THE CORPUS FROM OUTSIDE THIS LANE'S HEAD (CLAUDE.md trap 22).
 *
 * Every string below is READ FROM `__tests__/fixtures/dsk-walk/session-a
 * .enrichment.json` — a COMMITTED LIVE CAPTURE of a real decision_review
 * response. The keys, the prose, the endpoint ids and the endpoint labels are
 * the producer's, not this lane's. The fixtures above are hand-written and
 * therefore can only prove that the code does what its author imagined; this
 * one proves the shape the product ACTUALLY emits now survives egress.
 *
 * Note what it shows: `pre_mortem.grounded_in` on that capture is TWO EDGE
 * ADDRESSES AND NOTHING ELSE — no factor id to fall back on — so every entry
 * missed and the card was dropped whole. That is the `field: 'grounded_in'`
 * drop from the live session, reproduced from the producer's own bytes.
 */
describe('LIVE CAPTURE — session-a, replayed through egress', () => {
  const CAPTURE_NODES = [
    { id: 'fac_market_conditions', label: 'Market Conditions', kind: 'factor' },
    { id: 'risk_activation_failure', label: 'Self-Serve Activation Failure', kind: 'risk' },
    { id: 'out_partner_leverage', label: 'Partner Pipeline Leverage', kind: 'outcome' },
    { id: 'goal_arr', label: 'Add £2M Net New ARR Within 12 Months', kind: 'goal' },
  ];
  const CAPTURE_EDGES = [
    { from: 'fac_market_conditions', to: 'risk_activation_failure', strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.8 },
    { from: 'out_partner_leverage', to: 'goal_arr', strength: { mean: 0.6, std: 0.2 }, exists_probability: 0.9 },
  ];
  // Verbatim from the capture.
  const KEY_A = 'fac_market_conditions->risk_activation_failure';
  const KEY_B = 'out_partner_leverage->goal_arr';
  const CAPTURE_DR = {
    scenario_contexts: {
      [KEY_A]: {
        trigger_description:
          'If market conditions reduce self-serve activation further than modelled, this link may undermine both the PLG and partner strategies.',
        consequence:
          'Then Product-Led Growth Free Tier could overtake Double Down on Partner Channel if the partner model falters.',
      },
    },
    pre_mortem: {
      failure_scenario:
        'The plan fails because partner pipeline dries up or conversion rates decline, while market headwinds dampen activation and new ARR falls short across both partner and PLG routes.',
      mitigation:
        'Set early targets for partner pipeline growth and monitor market signals, with a clear fallback to PLG investment if results are missed.',
      grounded_in: [KEY_A, KEY_B],
    },
  };

  it("DELIVERS the capture's scenario-context card, bound to the real relationship", () => {
    const card = scenarioCard(CAPTURE_DR, CAPTURE_EDGES, CAPTURE_NODES);
    expect(card).toBeDefined();
    expect(card?.target_refs).toEqual([
      {
        id: 'fac_market_conditions→risk_activation_failure',
        label: 'Market Conditions → Self-Serve Activation Failure',
        kind: 'edge',
      },
    ]);
  });

  it("DELIVERS the capture's pre-mortem card, grounded in BOTH captured edges", () => {
    const card = preMortemCard(CAPTURE_DR, CAPTURE_EDGES, CAPTURE_NODES);
    expect(card).toBeDefined();
    expect(card?.target_refs.map((r) => r.id)).toEqual([
      'fac_market_conditions→risk_activation_failure',
      'out_partner_leverage→goal_arr',
    ]);
  });

  /**
   * ⭐ THE ASSERTION BOUND DIRECTLY TO THE MEASURED SIGNAL. The live session was
   * diagnosed from `v5.phase3.block_dropped` warnings, so the repair is checked
   * against that same telemetry rather than only against the cards: ZERO
   * `lookup_miss` drops on the capture's own payload.
   */
  it('emits NO `lookup_miss` drop on the captured payload — the measured signal is gone', () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never);
    try {
      egress(CAPTURE_DR, CAPTURE_EDGES, CAPTURE_NODES);
      const drops = (warnSpy.mock.calls as ReadonlyArray<readonly unknown[]>)
        .map((call) => call[0])
        .filter(
          (p): p is Record<string, unknown> =>
            p !== null && typeof p === 'object'
            && (p as Record<string, unknown>).event === 'v5.phase3.block_dropped',
        );
      expect(drops.filter((d) => d.drop_reason === 'lookup_miss')).toEqual([]);
      // POSITIVE CONTROL for the spy itself: an absence assertion needs proof
      // the instrument can SEE a presence (CLAUDE.md trap 13). An invented
      // address on the same payload MUST still produce the drop.
      warnSpy.mockClear();
      egress(
        { scenario_contexts: { 'fac_ghost->fac_phantom': SCENARIO_ENTRY } },
        CAPTURE_EDGES,
        CAPTURE_NODES,
      );
      const controlDrops = (warnSpy.mock.calls as ReadonlyArray<readonly unknown[]>)
        .map((call) => call[0])
        .filter(
          (p): p is Record<string, unknown> =>
            p !== null && typeof p === 'object'
            && (p as Record<string, unknown>).event === 'v5.phase3.block_dropped',
        );
      expect(
        controlDrops.some(
          (d) => d.drop_reason === 'lookup_miss' && d.field === 'edge_id',
        ),
        'the drop telemetry must still fire for a genuinely unresolvable edge',
      ).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('EXTRACTOR GUARD: the captured keys really are endpoint addresses of those edges', () => {
    // If the capture is ever re-extracted and these stop being addresses, the
    // two assertions above would start passing for a different reason.
    for (const [key, edge] of [[KEY_A, CAPTURE_EDGES[0]!], [KEY_B, CAPTURE_EDGES[1]!]] as const) {
      expect(key).toBe(`${edge.from}->${edge.to}`);
    }
  });
});
/**
 * ⭐⭐ THE REGRESSION THE REPAIR HAD TO NOT CAUSE, and the reason
 * `referent-resolver.ts::buildReferentIndex` now dedupes by canonical id.
 *
 * An edge that carries a producer-minted `id` AND resolvable endpoints is
 * reachable by TWO keys. `buildReferentIndex` buckets by normalised LABEL over
 * `lookup.values()`, and `deriveLabelIndex` marks any label with two owners
 * `AMBIGUOUS_LABEL` — so without the dedupe, making the second spelling
 * resolvable would have SILENTLY STOPPED THAT EDGE'S LABEL LINKING IN PROSE.
 * A repair that delivers the card and breaks the link is not a repair, and the
 * first version of this suite could not see it: the mutant that removed the
 * dedupe SURVIVED 20/20 green until this block was written.
 *
 * Ambiguity is a fact about how many CANONICAL IDS own a label, never about how
 * many keys reach them — so the second test here is the complement, proving the
 * dedupe did not swallow REAL ambiguity while closing this hole.
 */
describe('one entity addressable by two spellings is not two entities', () => {
  const LABELLED_EDGE = {
    ...CANONICAL_EDGE,
    id: 'edge_abc123',
    label: 'Wholesale Pressure On Volume',
  };
  const GRAPH = { nodes: NODES, edges: [LABELLED_EDGE] };

  it('the edge label stays UNAMBIGUOUS though the edge answers to id AND address', () => {
    const lookup = buildGraphNodeLookupFromGraph(GRAPH);
    // PRECONDITION, pinned in-test: this edge really IS reachable by two keys,
    // so a pass here cannot be the fixture quietly failing to set the case up.
    expect(lookup.get('edge_abc123')).toBeDefined();
    expect(lookup.get(EDGE_ADDRESS)).toBeDefined();
    expect(lookup.get(EDGE_ADDRESS)).toBe(lookup.get('edge_abc123'));

    const index = buildLabelIndex(lookup);
    expect(index.get(normaliseForPhraseMatch('Wholesale Pressure On Volume')))
      .toBe('edge_abc123');
  });

  it('and prose naming that relationship still LINKS it', () => {
    const fact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 'scen-edge-identity',
        leading_option_id: null,
        summary: 'x',
        graph_hash_at_run: 'gh_edgeidentity0001',
        enrichment: {
          decision_review: {
            key_assumptions: ['We assume Wholesale Pressure On Volume holds through the year.'],
          },
          graph: GRAPH,
        },
      },
    } as unknown as RunAnalysisHandlerFact;
    const blocks = buildCoachingBlocks(fact, buildGraphNodeLookup(fact), CTX);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.target_refs).toEqual([
      { id: 'edge_abc123', label: 'Wholesale Pressure On Volume', kind: 'edge' },
    ]);
  });

  it('COMPLEMENT: two DIFFERENT entities sharing a label are still AMBIGUOUS', () => {
    // The dedupe must not have swallowed real ambiguity while closing the hole.
    const lookup = buildGraphNodeLookupFromGraph({
      nodes: [
        { id: 'fac_price_a', label: 'Selling Price', kind: 'factor' },
        { id: 'fac_price_b', label: 'selling price', kind: 'factor' },
      ],
      edges: [],
    });
    expect(buildLabelIndex(lookup).get(normaliseForPhraseMatch('Selling Price')))
      .toBe(AMBIGUOUS_LABEL);
  });
});
