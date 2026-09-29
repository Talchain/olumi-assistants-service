/**
 * V5 emitted-block-type allowlist guard (contract freeze-gate).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The CEE → DGAI boundary forbids CEE from emitting a NEW user-facing
 * `blocks[]` type until the full surfacing gate is satisfied (contract +
 * DGAI parser + mapper + renderer + visibility tests + degrade behaviour).
 * See `Docs/v5/v5-dgai-boundary-and-surfacing-gates.md` §2 and the boundary
 * contract `Docs/v5/olumi-boundary-contract-v1_1.md` (B1, `Block` union in
 * `@olumi/contracts/boundary`, re-shipped here as `@talchain/schemas/boundary`).
 *
 * Today the only mechanical guard is a compile-time `never` in
 * `output-safety.ts::sanitiseBlock`, which proves every variant is *scrubbed*
 * — NOT that the wire allowlist is frozen, nor that a composer can't emit an
 * off-contract type. This file closes that gap.
 *
 * It mirrors the established freeze-gate convention in
 * `tests/utils/telemetry-events.test.ts`.
 *
 * TO CHANGE THE ALLOWLIST (deliberate, not incidental):
 *   1. Update the boundary/data contract and the §2 surfacing gate FIRST.
 *   2. Then update `FROZEN_V5_BLOCK_TYPES` below.
 * A bare schema-package bump that adds/removes a `Block` variant will fail the
 * type-level assertion in this file until both steps are done.
 *
 * Scope of coverage (no silent caps):
 *   - GUARD 1 (global, type-level): freezes the whole `Block['type']` union.
 *     Because every wire block is typed `Block` (`OlumiResponse.blocks: Block[]`),
 *     freezing the union IS the egress-global allowlist guarantee — no value of
 *     any other `type` can reach the wire without a compile error here.
 *   - GUARD 2 (egress choke point, behavioural): runs one block of every frozen
 *     type through `sanitiseOlumiResponseForEgress` — the single function that
 *     sees every outgoing `blocks[]` payload — and asserts the egress type-set
 *     is exactly the frozen allowlist (nothing dropped, nothing extra).
 *   - GUARD 3 (emission subset, bounded): exercises the V5 Phase-3 composer
 *     builders and asserts their emitted types ⊆ {review_card, coaching,
 *     evidence, exercise} ⊆ allowlist.
 *
 *     ⚠ `exercise` + the FOURTH builder ADDED 2026-07-31 (capability P1, CEE
 *     #770 review F2). This header previously said GUARD 3 "exercises the V5
 *     Phase-3 composer builders" with the set {review_card, coaching,
 *     evidence}. #770 added a fourth Phase-3 builder
 *     (`buildLensCompanionBlocks`, emitting `exercise`) which GUARD 3 neither
 *     DROVE nor ALLOWED — so the guard stayed green only because
 *     `emitAllPhase3Blocks()` calls the three old builders by name. A coverage
 *     claim that holds because it never looked is the same incidental-pass
 *     shape as the `no ExerciseBlocks` pin #770 also had to repair, and it is
 *     the exact defect this file's own header calls "the gap" it exists to
 *     close. The fourth builder is now DRIVEN, and — as with the other three —
 *     its non-vacuity is asserted (it must actually emit).
 *
 *     Behaviourally-exercised emission sites are the Phase-3 builders; the
 *     other emitters (analysis_result/graph_patch via compose.ts, ui_directive
 *     via compose.ts — behaviourally driven in ui-directive-emit.test.ts —
 *     draft_graph via draft dispatch, error via failure paths) are covered
 *     GLOBALLY by GUARD 1 (type system) + GUARD 2 (egress walker), not
 *     behaviourally driven here.
 *
 *     ⚠ AND ONE CORRECTION THIS PR DID NOT CAUSE, recorded rather than
 *     repeated: that list used to include "text/explanation/comparison/
 *     flip_analysis via the direct-answer composers". At this tip NONE of
 *     those four has a V5 producer — `composeDirectAnswerResponse` returns
 *     `blocks: []` (asserted in compose.test.ts) and an `rg` over `src/`
 *     non-test finds no constructor for an explanation/comparison/
 *     flip_analysis block. Naming absent producers as covered emission sites
 *     overstates what is driven anywhere, so the phrase is dropped.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Block, OlumiResponse } from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { sanitiseOlumiResponseForEgress } from '../output-safety.js';
import {
  buildCoachingBlocks,
  buildEvidenceBlocks,
  buildFactorConfidenceLookup,
  buildGraphNodeLookup,
  buildLensCompanionBlocks,
  buildLensSurface,
  buildReviewCardBlocks,
  type BlockBuildCtx,
} from '../phase3-blocks.js';
import { log } from '../../../utils/telemetry.js';
import type { GraphV3T } from '../../../orchestrator/types.js';

// ============================================================================
// Frozen allowlist — the single source of truth for this test.
// Verified against `@talchain/schemas/boundary` block discriminants and
// `output-safety.ts::sanitiseBlock` (the exhaustive egress switch).
// ============================================================================

const FROZEN_V5_BLOCK_TYPES = [
  'analysis_result',
  'coaching',
  'comparison',
  'draft_graph',
  'error',
  'evidence',
  'exercise',
  'explanation',
  'flip_analysis',
  'graph_patch',
  'review_card',
  'text',
  // 0.15.0 / seamlessness R4 (CEE half, slice 1) — MOVED here from
  // CONTRACT_PRESENT_NOT_YET_SURFACED per this file's surfacing protocol.
  // §2 gate status at the move (v5-dgai-boundary-and-surfacing-gates.md §2,
  // historical — file exists only in git history at bb52d7545):
  //   1. contract          — SATISFIED (0.15.0 wave, olumi-schemas PR #7;
  //                          adopted by CEE PR #405).
  //   2. DGAI parser        — NOT YET (R4 UI-half lane).
  //   3. DGAI mapper        — NOT YET (R4 UI-half lane).
  //   4. renderer/consumer  — NOT YET (R4 UI-half lane).
  //   5. visibility tests   — NOT YET (R4 UI-half lane).
  //   6. degrade behaviour  — CEE-side specified+tested (fail-closed emitter
  //                          + egress scrub case + strict-schema
  //                          validate-before-emit, see ui-directive-emit
  //                          .test.ts); DGAI-side = #187 unknown-block
  //                          tolerance (tolerated-and-dropped, safe).
  // The §2 rule guards against CEE *emitting* an unrenderable type. The
  // only emission site (compose.ts::buildBlocksFromFacts →
  // compose/ui-directive.ts) is UNCONDITIONAL since #539 deleted
  // CEE_UI_DIRECTIVE_EMIT (Paul's 19 Jul no-dark-launch ruling) — the
  // former "dark until DGAI gates 2–5 land" sequencing no longer applies.
  'ui_directive',
  // 0.15.0 / seamlessness R8 (CEE half). §2 surfacing gates now ALL SATISFIED:
  //   1. contract          — SATISFIED (0.15.0 wave, adopted by CEE PR #405).
  //   2. DGAI parser        — SATISFIED (mapV5Blocks held_proposal branch, #382).
  //   3. DGAI mapper        — SATISFIED (#382).
  //   4. renderer/consumer  — SATISFIED (V5HeldProposalBlock card, #382 live).
  //   5. visibility tests   — SATISFIED (#382 mapV5Blocks/card specs).
  //   6. degrade behaviour  — CEE-side fail-closed builder
  //                          compose/held-proposal.ts + strict-schema
  //                          validate-before-emit + egress scrub; DGAI-side
  //                          fails an unresolvable ref to the R7 unsupported
  //                          card (#382 mapV5Blocks).
  // NO LONGER GATED: the CEE_HELD_PROPOSAL_EMIT flag was deleted (Paul's
  // NO-DARK-LAUNCHES ruling) once #382 went live; the emission site
  // (edit-graph-dispatch.ts GM held branch, gate-built block) now appends the
  // block unconditionally.
  'held_proposal',
] as const;

type FrozenBlockType = (typeof FROZEN_V5_BLOCK_TYPES)[number];

// Contract-present but NOT yet cleared for CEE emission. The 0.15.0 schema
// wave (olumi-schemas PR #7, b02ba489c) added held_proposal and ui_directive
// to the boundary `Block` union; both have since moved onto the emission
// allowlist with flag-gated emitters (R4 ui_directive, R8 held_proposal —
// see their entries above). This set is currently EMPTY; a future
// contract-only block kind lands here first, then MOVES into
// `FROZEN_V5_BLOCK_TYPES` when its §2 surfacing gate + emitter exist —
// do not duplicate entries across the two lists.
const CONTRACT_PRESENT_NOT_YET_SURFACED = [] as const;

type NotYetSurfacedBlockType = (typeof CONTRACT_PRESENT_NOT_YET_SURFACED)[number];

// ----------------------------------------------------------------------------
// GUARD 1 (compile-time): exact mutual equality between the boundary `Block`
// union discriminant and (frozen allowlist ∪ known-not-yet-surfaced). tsd-style
// exact check — a drift in EITHER direction makes `_AllowlistMatchesUnion`
// resolve to `false`, and `Expect<false>` fails to compile. The two lists must
// also stay disjoint (`_ListsAreDisjoint`).
// ----------------------------------------------------------------------------

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// If this line errors, the boundary `Block` union changed. Update the contract
// + §2 gate, then `FROZEN_V5_BLOCK_TYPES` (or, for a contract-only addition
// that is not yet surfaced, `CONTRACT_PRESENT_NOT_YET_SURFACED`). Do not "fix"
// by editing only here.
type _AllowlistMatchesUnion = Expect<
  Equals<Block['type'], FrozenBlockType | NotYetSurfacedBlockType>
>;
type _ListsAreDisjoint = Expect<
  Equals<Extract<FrozenBlockType, NotYetSurfacedBlockType>, never>
>;

// ============================================================================
// Fixtures (kept local + minimal; mirrors output-safety.test.ts / phase3-blocks.test.ts)
// ============================================================================

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';
const CTX: BlockBuildCtx = {
  created_at: '2026-05-16T15:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_delivery_risk', kind: 'factor', label: 'Delivery risk' },
      { id: 'fac_cost_overrun', kind: 'factor', label: 'Cost overrun risk' },
      { id: 'opt_premium', kind: 'option', label: 'Premium Tier' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

function makeResponse(overrides: Partial<OlumiResponse> = {}): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: 'The leading option performs best.',
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
    ...overrides,
  };
}

interface FactInput {
  readonly graphHash?: string | null;
  readonly decisionReview?: Record<string, unknown>;
  readonly graphNodes?: ReadonlyArray<Record<string, unknown>>;
  readonly factorSensitivity?: ReadonlyArray<Record<string, unknown>>;
  /** Capability P1: drives `selectLens` rule 2a for the companion builder. */
  readonly confidenceTier?: string;
}

function makeFact(input: FactInput = {}): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (input.decisionReview !== undefined) enrichment.decision_review = input.decisionReview;
  if (input.graphNodes !== undefined) enrichment.graph = { nodes: input.graphNodes };
  if (input.factorSensitivity !== undefined) enrichment.factor_sensitivity = input.factorSensitivity;
  if (input.confidenceTier !== undefined) enrichment.confidence_tier = input.confidenceTier;
  const result: Record<string, unknown> = {
    scenario_id: 'scen-test',
    leading_option_id: 'opt_a',
    summary: 'Ran analysis on your current scenario.',
    enrichment,
    computed_at: '2026-05-16T14:59:00.000Z',
  };
  if (input.graphHash !== null) result.graph_hash_at_run = input.graphHash ?? GRAPH_HASH;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result,
  } as unknown as RunAnalysisHandlerFact;
}

const STANDARD_GRAPH_NODES = [
  { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' },
  { id: 'fac_cost_overrun', label: 'Cost overrun risk', kind: 'factor' },
  { id: 'edge_delivery_goal', label: 'Delivery risk → Launch success', kind: 'edge' },
];

/**
 * One block of every frozen type — clean prose (no entity IDs in user-facing
 * fields) so the egress walker does not rewrite content; structured machine
 * IDs live only in non-scrubbed fields. Used to drive GUARD 2.
 */
function oneBlockOfEachType(): Block[] {
  return [
    { type: 'text', content: 'Standard analysis output.' },
    {
      type: 'analysis_result',
      summary: 'The leading option holds a narrow lead.',
      leading_option_id: 'opt_premium',
      win_probabilities: { opt_premium: 0.6 },
      enrichment: { note: 'opaque' },
    },
    {
      type: 'explanation',
      narrative: 'The leading option performs best on the strongest driver.',
      referenced_option_ids: ['opt_premium'],
    },
    {
      type: 'comparison',
      narrative: 'The two options differ mainly on cost.',
      options: [
        { option_id: 'opt_premium', label: 'Premium Tier', win_probability: 0.6, attributes: {} },
      ],
    },
    {
      type: 'flip_analysis',
      narrative: 'A small move on the top driver could flip the result.',
      flip_scenarios: [
        {
          factor_id: 'fac_delivery_risk',
          current_value: 0.5,
          flip_threshold: 0.7,
          from_option_id: 'opt_premium',
          to_option_id: 'opt_offshore',
          fragile: true,
        },
      ],
    },
    { type: 'error', error_code: 'INTERNAL_ERROR', severity: 'error' },
    {
      type: 'graph_patch',
      status: 'applied',
      operation: 'set_factor_value',
      target_id: 'fac_delivery_risk',
      before: null,
      after: { value: 0.4 },
    },
    { type: 'draft_graph', nodes: [], edges: [], node_count: 0, edge_count: 0 },
    {
      block_id: '550e8400-e29b-41d4-a716-446655440001',
      signal_id: 'review:narrative:gh',
      created_at: '2026-05-16T15:00:00.000Z',
      source_handler: 'decision_review_enricher',
      graph_hash_at_generation: GRAPH_HASH,
      freshness: 'fresh',
      type: 'review_card',
      card_kind: 'narrative',
      title: 'How the analysis reads',
      body: 'The leading option holds a narrow lead on the strongest driver.',
      severity: 'info',
      target_refs: [],
      priority_rank: 10,
    },
    {
      block_id: '550e8400-e29b-41d4-a716-446655440002',
      signal_id: 'coach:assumption:1:gh',
      created_at: '2026-05-16T15:00:00.000Z',
      source_handler: 'decision_review_enricher',
      graph_hash_at_generation: GRAPH_HASH,
      freshness: 'fresh',
      type: 'coaching',
      coaching_kind: 'assumption_check',
      title: 'Check a key assumption',
      body: 'Edge strengths assume current market conditions persist.',
      source: 'decision_review',
      target_refs: [],
      priority_rank: 101,
      action_intent: 'confirm_factor',
    },
    {
      block_id: '550e8400-e29b-41d4-a716-446655440003',
      signal_id: 'evidence:gh',
      created_at: '2026-05-16T15:00:00.000Z',
      source_handler: 'decision_review_enricher',
      graph_hash_at_generation: GRAPH_HASH,
      freshness: 'fresh',
      type: 'evidence',
      factor_label: 'Delivery risk',
      factor_ref: { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' },
      target_refs: [],
      current_confidence: 'low',
      evidence_gap: 'Need data on delivery-rate trends.',
      suggested_technique: 'Internal data: pull delivery dashboards',
      impact_if_gathered: 'Would lift confidence in the top driver.',
      priority_rank: 1,
      severity: 'critical',
    },
    {
      block_id: '550e8400-e29b-41d4-a716-446655440004',
      signal_id: 'exercise:pre_mortem:gh',
      created_at: '2026-05-16T15:00:00.000Z',
      source_handler: 'run_exercise',
      freshness: 'fresh',
      type: 'exercise',
      exercise_kind: 'pre_mortem',
      target_refs: [],
    },
    {
      // R4 slice-1 emitter shape: schema-required fields + the option
      // target only — no `note` (nothing for the egress scrub to rewrite),
      // no `duration_ms`.
      type: 'ui_directive',
      verb: 'highlight',
      targets: [{ id: 'opt_premium', label: 'Premium Tier', kind: 'option' }],
    },
    {
      // R8 emitter shape: typed codes + action refs + fixed-template
      // summary — exactly what compose/held-proposal.ts produces.
      type: 'held_proposal',
      proposal_id: 'gmh_abc123def456',
      summary: "A change to 'Delivery risk' is held for your confirmation.",
      mutation_class: 'tunable',
      reason_code: 'TUNABLE_APPLY_HELD',
      confirm_action_id: 'gmh_abc123def456',
    },
  ] as Block[];
}

// ============================================================================
// GUARD 1 (runtime mirror) — pin the readable allowlist itself.
// ============================================================================

describe('V5 block-type allowlist — frozen union (GUARD 1)', () => {
  it('freezes the emission allowlist to exactly 14 block types (the full boundary union)', () => {
    // Snapshot-style pin (sorted) so the readable list cannot drift silently.
    expect([...FROZEN_V5_BLOCK_TYPES].sort()).toEqual(
      [
        'analysis_result',
        'coaching',
        'comparison',
        'draft_graph',
        'error',
        'evidence',
        'exercise',
        'explanation',
        'flip_analysis',
        'graph_patch',
        // R8 CEE half — unconditional emitter (CEE_HELD_PROPOSAL_EMIT flag
        // deleted; UI card #382 live). See the FROZEN_V5_BLOCK_TYPES entry
        // comment for the §2 gate status.
        'held_proposal',
        'review_card',
        'text',
        // R4 CEE-half slice 1 — flag-gated emitter (CEE_UI_DIRECTIVE_EMIT,
        // default OFF). See the FROZEN_V5_BLOCK_TYPES entry comment for the
        // §2 gate status at the move.
        'ui_directive',
      ].sort(),
    );
  });

  it('has no duplicate entries', () => {
    expect(new Set(FROZEN_V5_BLOCK_TYPES).size).toBe(FROZEN_V5_BLOCK_TYPES.length);
    expect(FROZEN_V5_BLOCK_TYPES.length).toBe(14);
  });

  it('the compile-time union-equality assertion is in force', () => {
    // `_AllowlistMatchesUnion` (above) only compiles when the boundary
    // `Block['type']` union equals `FROZEN_V5_BLOCK_TYPES` ∪
    // `CONTRACT_PRESENT_NOT_YET_SURFACED` exactly, and `_ListsAreDisjoint`
    // only compiles when the two lists share no member. These runtime lines
    // document that the type-level guards exist; the real enforcement is at
    // `tsc` time.
    const witness: _AllowlistMatchesUnion = true;
    const disjoint: _ListsAreDisjoint = true;
    expect(witness).toBe(true);
    expect(disjoint).toBe(true);
  });

  it('pins the contract-present-but-not-yet-surfaced set to exactly EMPTY', () => {
    // Both 0.15.0 additions (ui_directive R4, held_proposal R8) have moved
    // to the frozen allowlist with flag-gated emitters. This pin makes any
    // silent growth of the "in contract, not surfaced" set a deliberate
    // decision, mirroring the frozen-allowlist pin above.
    expect([...CONTRACT_PRESENT_NOT_YET_SURFACED].sort()).toEqual([]);
  });
});

// ============================================================================
// GUARD 2 — egress choke point sees only allowlisted block types.
// `sanitiseOlumiResponseForEgress` is the single function every outgoing
// `blocks[]` payload passes through (route-v2 egress).
// ============================================================================

describe('V5 block-type allowlist — egress choke point (GUARD 2)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => log);
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('passes every frozen block type through egress with no drop and no off-allowlist type', () => {
    const out = sanitiseOlumiResponseForEgress(
      makeResponse({ blocks: oneBlockOfEachType() }),
      { graph: makeGraph(), requestId: 'req-allowlist', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
    );

    // Nothing dropped: all 12 survive the egress walk.
    expect(out.blocks).toHaveLength(FROZEN_V5_BLOCK_TYPES.length);

    // Every outgoing block type is within the frozen allowlist.
    for (const block of out.blocks) {
      expect(FROZEN_V5_BLOCK_TYPES).toContain(block.type);
    }

    // Set-completeness: the egress type-set is EXACTLY the allowlist.
    const egressTypes = new Set(out.blocks.map((b) => b.type));
    expect(egressTypes).toEqual(new Set(FROZEN_V5_BLOCK_TYPES));
  });
});

// ============================================================================
// GUARD 3 — V5 Phase-3 composer emits only allowlisted (Phase-3) types.
// Bounded coverage: behaviourally exercises the Phase-3 builders only (see
// file header for the global coverage of the other emission sites).
// ============================================================================

describe('V5 block-type allowlist — Phase-3 composer emission subset (GUARD 3)', () => {
  const PHASE3_ALLOWED = new Set<FrozenBlockType>([
    'review_card',
    'coaching',
    'evidence',
    // Capability P1 (#770): the lens companion. See the file header for why
    // adding the type WITHOUT driving its builder would have been the same
    // incidental pass this amendment exists to remove.
    'exercise',
  ]);

  /**
   * The FOURTH Phase-3 builder (capability P1). Needs a fact whose enrichment
   * BOTH selects the `pre_mortem` lens (`confidence_tier: 'needs_work'` — rule
   * 2a) AND carries a pre_mortem prose object that survives `buildPreMortemCard`
   * (the companion inherits that card's drop rules), so `grounded_in` must
   * resolve against the graph nodes.
   */
  function emitLensCompanionBlocks(): Array<{ type: string }> {
    const fact = makeFact({
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.4 }],
      decisionReview: {
        pre_mortem: {
          failure_scenario:
            'Delivery risk was underestimated and the rollout slipped past the planned window.',
          warning_signs: ['Sprint burndown flattens for two consecutive weeks.'],
          mitigation: 'Book a mid-point checkpoint before committing budget.',
          grounded_in: ['fac_delivery_risk'],
        },
      },
      confidenceTier: 'needs_work',
    });
    const lookup = buildGraphNodeLookup(fact);
    const surface = buildLensSurface(fact, CTX);
    // Non-vacuity, stated as a precondition rather than assumed: if the lens
    // stops selecting, the companion below is trivially empty and this arm
    // would go green while driving nothing.
    expect(surface, 'GUARD 3 precondition: the fixture must select a lens').not.toBeNull();
    expect(surface!.selection.lens).toBe('pre_mortem');
    return [
      ...buildLensCompanionBlocks(
        fact,
        CTX,
        surface!.selection,
        buildReviewCardBlocks(fact, lookup, CTX),
        lookup,
      ),
    ];
  }

  function emitAllPhase3Blocks(): Array<{ type: string }> {
    const reviewFact = makeFact({
      decisionReview: {
        narrative_summary: 'The leading option is currently ahead by a narrow lead.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const reviewBlocks = buildReviewCardBlocks(
      reviewFact,
      buildGraphNodeLookup(reviewFact),
      CTX,
    );

    const coachingBlocks = buildCoachingBlocks(
      makeFact({
        decisionReview: {
          key_assumptions: ['Edge strengths assume current market conditions persist.'],
        },
      }),
      new Map(),
      CTX,
    );

    const evidenceFact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'Pull on-time delivery rate from the last two releases.',
            rationale: 'Delivery rate is the largest variance driver here.',
            evidence_type: 'internal_data',
            decision_hygiene: 'Estimate first, then look at data.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.2 }],
    });
    const evidenceBlocks = buildEvidenceBlocks(
      evidenceFact,
      buildGraphNodeLookup(evidenceFact),
      buildFactorConfidenceLookup(evidenceFact),
      CTX,
    );

    return [
      ...reviewBlocks,
      ...coachingBlocks,
      ...evidenceBlocks,
      ...emitLensCompanionBlocks(),
    ];
  }

  it('emits at least one block from the exercised builders (non-vacuous)', () => {
    expect(emitAllPhase3Blocks().length).toBeGreaterThan(0);
  });

  it('DRIVES the fourth Phase-3 builder, and it actually emits an exercise block', () => {
    // Per-builder non-vacuity. Without this, adding 'exercise' to PHASE3_ALLOWED
    // would widen the allowed set while the builder stayed undriven — a strictly
    // WEAKER guard wearing a wider claim, which is the failure mode F2 raised.
    const companions = emitLensCompanionBlocks();
    expect(companions.length).toBeGreaterThan(0);
    expect(companions.every((b) => b.type === 'exercise')).toBe(true);
    expect(emitAllPhase3Blocks().some((b) => b.type === 'exercise')).toBe(true);
  });

  it('every emitted Phase-3 block type is in the allowlist and the Phase-3 subset', () => {
    for (const block of emitAllPhase3Blocks()) {
      expect(FROZEN_V5_BLOCK_TYPES).toContain(block.type as FrozenBlockType);
      expect(PHASE3_ALLOWED.has(block.type as FrozenBlockType)).toBe(true);
    }
  });
});
