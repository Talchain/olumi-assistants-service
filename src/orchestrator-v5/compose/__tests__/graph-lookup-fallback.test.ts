/**
 * R4 graph-node lookup fallback — persisted-snapshot source for Phase 3
 * target_refs and the flag-gated ui_directive emitter.
 *
 * THE PRODUCTION GAP (verified live at deployed build 441dc0d): the PLoT
 * /v2/run envelope stored byte-for-byte as `fact.result.enrichment`
 * (run-analysis.ts) has NO top-level `graph` key, so
 * `buildGraphNodeLookup(fact)` — which reads `enrichment.graph.nodes[]` —
 * is empty on EVERY production run. Consequences:
 *   1. `buildRecommendedOptionUiDirective` can never resolve
 *      `leading_option_id` to an option node → the CEE_UI_DIRECTIVE_EMIT
 *      emitter is permanently dead in production despite the flag.
 *   2. Every Phase 3 block ships `target_refs: []` (or drops entirely at
 *      the fail-closed lookup gates: flip_threshold, scenario_context,
 *      evidence, evidence_priority).
 *
 * THE FIX (CEE-side, no wire change): `buildGraphNodeLookup` accepts an
 * optional fallback graph — the persisted scenario snapshot CEE already
 * holds for the turn (`EnrichedTurnContext.persistedGraph` /
 * `RunAnalysisScenarioSnapshot.rawPersistedGraph`) — consulted ONLY when
 * the enrichment graph is absent or yields zero entries. Threaded through
 * `composeToolCallResponse` as the optional `persistedGraph` input.
 *
 * Contract pinned here:
 *   (a) production-shaped fact (enrichment WITHOUT `graph`) + persisted
 *       fallback containing the recommended option → the ui_directive IS
 *       emitted with the correct target ref (flag ON);
 *   (b) Phase 3 blocks resolve non-empty target_refs from the fallback
 *       (current-turn AND prior-fact fresh lifecycle rebuilds);
 *   (c) with NEITHER source, everything fails closed exactly as today;
 *   (d) flag-off dormancy unchanged — persistedGraph never causes a
 *       directive on its own;
 *   (e) enrichment graph, when present and non-empty, stays authoritative
 *       (the fallback never overrides it);
 *   (f) review F1 — the CURRENT-TURN branch consults the fallback only
 *       when the caller-supplied `persistedGraphHash` equals the fact's
 *       `graph_hash_at_run` (concurrent-writer window between the
 *       handler's execution-time read and the turn-start context read);
 *       the prior-fact FRESH lifecycle branch needs no hash.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UiDirectiveBlockSchema } from '@talchain/schemas/boundary';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { composeToolCallResponse } from '../../compose.js';
import { buildGraphNodeLookup } from '../phase3-blocks.js';
import { buildRecommendedOptionUiDirective } from '../ui-directive.js';

// ---------------------------------------------------------------------------
// Flag helpers (pattern: ui-directive-emit.test.ts)
// ---------------------------------------------------------------------------

let priorFlag: string | undefined;

async function setFlag(value: 'true' | 'false' | undefined) {
  priorFlag = process.env.CEE_UI_DIRECTIVE_EMIT;
  if (value === undefined) {
    delete process.env.CEE_UI_DIRECTIVE_EMIT;
  } else {
    process.env.CEE_UI_DIRECTIVE_EMIT = value;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

async function restoreFlag() {
  if (priorFlag === undefined) {
    delete process.env.CEE_UI_DIRECTIVE_EMIT;
  } else {
    process.env.CEE_UI_DIRECTIVE_EMIT = priorFlag;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH_HASH = 'gh_lookupfallback_0001';

/**
 * Persisted-snapshot graph — the canvas/CEE shape stored in
 * `scenarios.graph` (GraphStateIngressSchema: nodes carry id/kind/label;
 * edges carry from/to and may carry an id but no label). Includes a
 * `decision`-kind node (a valid GraphV3 NodeKind that is NOT a
 * TargetRefKind) to pin the minimal-mapping rule.
 */
const PERSISTED_GRAPH = {
  nodes: [
    { id: 'goal_launch', kind: 'goal', label: 'Launch success' },
    {
      id: 'fac_delivery_risk',
      kind: 'factor',
      label: 'Delivery risk',
      observed_state: { value: 3, cap: 10, unit: 'score' },
    },
    { id: 'opt_hire_locally', kind: 'option', label: 'Hire locally' },
    { id: 'opt_outsource', kind: 'option', label: 'Outsource' },
    { id: 'dec_root', kind: 'decision', label: 'Root decision' },
  ],
  edges: [
    { id: 'edge_risk_goal', from: 'fac_delivery_risk', to: 'goal_launch', strength: 0.4 },
  ],
  goal_node_id: 'goal_launch',
};

/**
 * v11 decision_review payload keyed to PERSISTED_GRAPH ids — flip
 * threshold + evidence enhancement on the factor, scenario context on the
 * edge. Prose deliberately avoids raw decimals, entity-id-shaped tokens,
 * and forbidden phrases so the Phase 3 prose guard is not the reason a
 * block drops.
 */
const DECISION_REVIEW = {
  narrative_summary: 'The analysis currently reads in favour of hiring locally.',
  flip_thresholds: [
    {
      factor_id: 'fac_delivery_risk',
      factor_label: 'Delivery risk',
      current_display: 'moderate',
      flip_display: 'severe',
      narrative: 'If delivery risk moves from moderate to severe, the result could change.',
    },
  ],
  evidence_enhancements: {
    fac_delivery_risk: {
      specific_action: 'benchmark supplier lead times against recent market data',
      rationale: 'Lead-time evidence is thin for the local hiring route.',
      evidence_type: 'market_research',
      decision_hygiene: 'Grounds the riskiest assumption in observed data.',
    },
  },
  scenario_contexts: {
    edge_risk_goal: {
      trigger_description: 'Delivery risk rises past the tolerance band',
      consequence: 'the launch window slips by a quarter.',
    },
  },
  key_assumptions: ['The hiring pipeline stays open through the year.'],
  produced_at: '2026-07-10T09:00:00.000Z',
};

interface FactOverrides {
  readonly leadingOptionId?: string | null;
  readonly withEnrichmentGraph?: { nodes: unknown[]; edges: unknown[] };
  readonly withDecisionReview?: boolean;
}

/**
 * Production-shaped run_analysis fact: `enrichment` mirrors the live PLoT
 * /v2/run envelope top level — science fields present, NO `graph` key.
 * `withEnrichmentGraph` opts back into the (test-only, never-live) shape
 * the pre-fix suites used, to pin enrichment-source precedence.
 */
function productionShapedFact(overrides: FactOverrides = {}): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {
    analysis_status: 'completed',
    option_comparison_status: 'computed',
    factor_sensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.8 }],
    robustness: { level: 'moderate' },
    ...(overrides.withDecisionReview === false ? {} : { decision_review: DECISION_REVIEW }),
    ...(overrides.withEnrichmentGraph !== undefined
      ? { graph: overrides.withEnrichmentGraph }
      : {}),
  };
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-lookup-fallback',
      leading_option_id:
        overrides.leadingOptionId === undefined ? 'opt_hire_locally' : overrides.leadingOptionId,
      summary: 'Ran analysis on your current scenario.',
      enrichment,
      graph_hash_at_run: GRAPH_HASH,
      computed_at: '2026-07-10T09:00:00.000Z',
    },
  } as unknown as RunAnalysisHandlerFact;
}

const BASE_INPUT = {
  orientation: 'Running the analysis.',
  confirmation: 'Ran analysis on your current scenario.',
  coaching: null as string | null,
  stage: 'analyse' as const,
};

type ComposedBlocks = ReturnType<typeof composeToolCallResponse>['blocks'];

function byType(blocks: ComposedBlocks, type: string) {
  return blocks.filter((b) => b.type === type);
}

function reviewCardsOfKind(blocks: ComposedBlocks, cardKind: string) {
  return blocks.filter(
    (b) =>
      b.type === 'review_card' &&
      (b as unknown as { card_kind: string }).card_kind === cardKind,
  );
}

// ---------------------------------------------------------------------------
// Unit — buildGraphNodeLookup fallback source
// ---------------------------------------------------------------------------

describe('buildGraphNodeLookup — persisted-snapshot fallback', () => {
  it('production-shaped enrichment (no graph key) + fallback → nodes resolved with id/label/kind', () => {
    const lookup = buildGraphNodeLookup(productionShapedFact(), PERSISTED_GRAPH);
    expect(lookup.get('opt_hire_locally')).toEqual({
      id: 'opt_hire_locally',
      label: 'Hire locally',
      kind: 'option',
    });
    expect(lookup.get('fac_delivery_risk')).toEqual({
      id: 'fac_delivery_risk',
      label: 'Delivery risk',
      kind: 'factor',
    });
    expect(lookup.get('goal_launch')).toEqual({
      id: 'goal_launch',
      label: 'Launch success',
      kind: 'goal',
    });
  });

  it('fallback edges resolve with a derived "from → to" label (persisted edges carry from/to, no label)', () => {
    const lookup = buildGraphNodeLookup(productionShapedFact(), PERSISTED_GRAPH);
    expect(lookup.get('edge_risk_goal')).toEqual({
      id: 'edge_risk_goal',
      label: 'Delivery risk → Launch success',
      kind: 'edge',
    });
  });

  it('fallback nodes with a non-TargetRef kind (decision) are skipped, never mapped', () => {
    const lookup = buildGraphNodeLookup(productionShapedFact(), PERSISTED_GRAPH);
    expect(lookup.get('dec_root')).toBeUndefined();
  });

  it('with neither source the lookup is empty (fail-closed unchanged)', () => {
    const lookup = buildGraphNodeLookup(productionShapedFact());
    expect(lookup.size).toBe(0);
  });

  it('a present, non-empty enrichment graph stays authoritative over the fallback', () => {
    const fact = productionShapedFact({
      withEnrichmentGraph: {
        nodes: [{ id: 'opt_hire_locally', kind: 'option', label: 'Enrichment label wins' }],
        edges: [],
      },
    });
    const lookup = buildGraphNodeLookup(fact, PERSISTED_GRAPH);
    expect(lookup.get('opt_hire_locally')).toEqual({
      id: 'opt_hire_locally',
      label: 'Enrichment label wins',
      kind: 'option',
    });
    // Fallback-only ids are NOT merged in when the enrichment graph is usable.
    expect(lookup.get('fac_delivery_risk')).toBeUndefined();
  });

  it('an enrichment graph yielding ZERO entries falls through to the fallback', () => {
    const fact = productionShapedFact({
      withEnrichmentGraph: { nodes: [], edges: [] },
    });
    const lookup = buildGraphNodeLookup(fact, PERSISTED_GRAPH);
    expect(lookup.get('opt_hire_locally')).toEqual({
      id: 'opt_hire_locally',
      label: 'Hire locally',
      kind: 'option',
    });
  });

  it('a structurally unusable fallback (nodes not an array) yields an empty lookup, never throws', () => {
    const lookup = buildGraphNodeLookup(productionShapedFact(), { nodes: 'oops' });
    expect(lookup.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (a) ui_directive emits from the fallback on a production-shaped fact
// ---------------------------------------------------------------------------

describe('ui_directive emitter — persisted-snapshot fallback (flag ON)', () => {
  beforeEach(async () => {
    await setFlag('true');
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('builder: production-shaped fact + fallback-carrying lookup → directive with the recommended-option target ref', () => {
    const fact = productionShapedFact();
    // Review F2: the builder consumes the lookup the compose site already
    // built for the fact's Phase 3 blocks (one build per fact).
    const directive = buildRecommendedOptionUiDirective(
      fact,
      buildGraphNodeLookup(fact, PERSISTED_GRAPH),
    );
    expect(directive).not.toBeNull();
    expect(directive).toMatchObject({
      type: 'ui_directive',
      verb: 'highlight',
      targets: [{ id: 'opt_hire_locally', label: 'Hire locally', kind: 'option' }],
    });
    expect(UiDirectiveBlockSchema.safeParse(directive).success).toBe(true);
  });

  it('compose: production-shaped fact + persistedGraph → exactly one ui_directive on blocks[]', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact()],
      persistedGraph: PERSISTED_GRAPH,
      persistedGraphHash: GRAPH_HASH,
    });
    const directives = byType(env.blocks, 'ui_directive');
    expect(directives).toHaveLength(1);
    expect(directives[0]).toMatchObject({
      verb: 'highlight',
      targets: [{ id: 'opt_hire_locally', label: 'Hire locally', kind: 'option' }],
    });
  });

  it('fallback resolving the recommended id to a NON-option kind still fails closed', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact({ leadingOptionId: 'fac_delivery_risk' })],
      persistedGraph: PERSISTED_GRAPH,
      persistedGraphHash: GRAPH_HASH,
    });
    expect(byType(env.blocks, 'ui_directive')).toHaveLength(0);
  });

  it('recommended id absent from BOTH sources still fails closed (no id-as-label fallback)', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact({ leadingOptionId: 'opt_unknown' })],
      persistedGraph: PERSISTED_GRAPH,
      persistedGraphHash: GRAPH_HASH,
    });
    expect(byType(env.blocks, 'ui_directive')).toHaveLength(0);
  });

  it('prior-fact FRESH lifecycle rebuild with persistedGraph still emits ZERO directives (current-turn only)', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [],
      persistedGraph: PERSISTED_GRAPH,
      lifecycle: {
        priorFacts: [productionShapedFact() as unknown as HandlerFact],
        freshness: {
          freshness: 'fresh',
          selected_fact_index: 0,
          graph_hash_at_run: GRAPH_HASH,
          current_graph_hash: GRAPH_HASH,
          reason: 'graph_hash_match',
          computed_at: '2026-07-10T09:00:00.000Z',
        },
        requestId: 'req-fallback-prior-fresh',
        scenarioId: 'scen-lookup-fallback',
      },
    });
    expect(byType(env.blocks, 'analysis_result')).toHaveLength(1);
    expect(byType(env.blocks, 'ui_directive')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (b) Phase 3 blocks resolve non-empty target_refs from the fallback
// ---------------------------------------------------------------------------

describe('Phase 3 target_refs — persisted-snapshot fallback', () => {
  it('flip_threshold card emits with the factor target ref resolved from the fallback', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact()],
      persistedGraph: PERSISTED_GRAPH,
      persistedGraphHash: GRAPH_HASH,
    });
    const flips = reviewCardsOfKind(env.blocks, 'flip_threshold');
    expect(flips).toHaveLength(1);
    expect((flips[0] as unknown as { target_refs: unknown[] }).target_refs).toEqual([
      { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' },
    ]);
  });

  it('scenario_context card emits with the edge target ref (derived endpoint label)', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact()],
      persistedGraph: PERSISTED_GRAPH,
      persistedGraphHash: GRAPH_HASH,
    });
    const scenarios = reviewCardsOfKind(env.blocks, 'scenario_context');
    expect(scenarios).toHaveLength(1);
    expect((scenarios[0] as unknown as { target_refs: unknown[] }).target_refs).toEqual([
      { id: 'edge_risk_goal', label: 'Delivery risk → Launch success', kind: 'edge' },
    ]);
  });

  it('evidence_priority card and evidence block resolve the factor ref from the fallback', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact()],
      persistedGraph: PERSISTED_GRAPH,
      persistedGraphHash: GRAPH_HASH,
    });
    const priority = reviewCardsOfKind(env.blocks, 'evidence_priority');
    expect(priority).toHaveLength(1);
    expect((priority[0] as unknown as { target_refs: unknown[] }).target_refs).toEqual([
      { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' },
    ]);
    const evidence = byType(env.blocks, 'evidence');
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as unknown as { target_refs: unknown[] }).target_refs).toEqual([
      { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' },
    ]);
  });

  it('prior-fact FRESH lifecycle rebuild also resolves target_refs from the fallback', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [],
      persistedGraph: PERSISTED_GRAPH,
      lifecycle: {
        priorFacts: [productionShapedFact() as unknown as HandlerFact],
        freshness: {
          freshness: 'fresh',
          selected_fact_index: 0,
          graph_hash_at_run: GRAPH_HASH,
          current_graph_hash: GRAPH_HASH,
          reason: 'graph_hash_match',
          computed_at: '2026-07-10T09:00:00.000Z',
        },
        requestId: 'req-fallback-prior-refs',
        scenarioId: 'scen-lookup-fallback',
      },
    });
    const flips = reviewCardsOfKind(env.blocks, 'flip_threshold');
    expect(flips).toHaveLength(1);
    expect((flips[0] as unknown as { target_refs: unknown[] }).target_refs).toEqual([
      { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Review F1 — the current-turn fallback is HASH-GATED
// ---------------------------------------------------------------------------
//
// On the routed path the run_analysis handler does its own Supabase read at
// execution time while compose receives the turn-start persisted graph — a
// concurrent writer in that window can rename/remove nodes between the two
// reads. The current-turn branch therefore consults the fallback ONLY when
// the caller-supplied `persistedGraphHash` (the executor's already-computed
// canonical hash of that same persisted graph) equals the fact's
// `graph_hash_at_run`. On mismatch — or when no hash is supplied — the
// branch fails closed to the pre-fix behaviour. The prior-fact lifecycle
// branch needs no hash: its FRESH verdict is already derived against the
// same persisted graph.

describe('current-turn fallback hash gate (review F1)', () => {
  beforeEach(async () => {
    await setFlag('true');
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('persistedGraphHash === graph_hash_at_run → fallback consulted (directive + resolved target_refs)', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact()],
      persistedGraph: PERSISTED_GRAPH,
      persistedGraphHash: GRAPH_HASH,
    });
    expect(byType(env.blocks, 'ui_directive')).toHaveLength(1);
    expect(reviewCardsOfKind(env.blocks, 'flip_threshold')).toHaveLength(1);
  });

  it('persistedGraphHash MISMATCH → fallback NOT consulted; pre-fix fail-closed behaviour', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact()],
      persistedGraph: PERSISTED_GRAPH,
      persistedGraphHash: 'gh_concurrent_writer_diverged',
    });
    expect(byType(env.blocks, 'ui_directive')).toHaveLength(0);
    expect(reviewCardsOfKind(env.blocks, 'flip_threshold')).toHaveLength(0);
    expect(reviewCardsOfKind(env.blocks, 'scenario_context')).toHaveLength(0);
    expect(byType(env.blocks, 'evidence')).toHaveLength(0);
    // Lookup-free blocks are unaffected — same as the neither-source baseline.
    const narrative = reviewCardsOfKind(env.blocks, 'narrative');
    expect(narrative).toHaveLength(1);
    expect((narrative[0] as unknown as { target_refs: unknown[] }).target_refs).toEqual([]);
  });

  it('persistedGraphHash ABSENT (null) → fallback NOT consulted on the current-turn branch', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact()],
      persistedGraph: PERSISTED_GRAPH,
      persistedGraphHash: null,
    });
    expect(byType(env.blocks, 'ui_directive')).toHaveLength(0);
    expect(reviewCardsOfKind(env.blocks, 'flip_threshold')).toHaveLength(0);
  });

  it('persistedGraphHash omitted entirely → fallback NOT consulted on the current-turn branch', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact()],
      persistedGraph: PERSISTED_GRAPH,
    });
    expect(byType(env.blocks, 'ui_directive')).toHaveLength(0);
    expect(reviewCardsOfKind(env.blocks, 'flip_threshold')).toHaveLength(0);
  });

  it('prior-fact FRESH lifecycle rebuild needs NO hash — fallback still resolves target_refs', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [],
      persistedGraph: PERSISTED_GRAPH,
      // no persistedGraphHash — the FRESH verdict is the gate on this branch.
      lifecycle: {
        priorFacts: [productionShapedFact() as unknown as HandlerFact],
        freshness: {
          freshness: 'fresh',
          selected_fact_index: 0,
          graph_hash_at_run: GRAPH_HASH,
          current_graph_hash: GRAPH_HASH,
          reason: 'graph_hash_match',
          computed_at: '2026-07-10T09:00:00.000Z',
        },
        requestId: 'req-f1-prior-fresh-no-hash',
        scenarioId: 'scen-lookup-fallback',
      },
    });
    const flips = reviewCardsOfKind(env.blocks, 'flip_threshold');
    expect(flips).toHaveLength(1);
    expect((flips[0] as unknown as { target_refs: unknown[] }).target_refs).toEqual([
      { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// (c) neither source → fail-closed exactly as today
// ---------------------------------------------------------------------------

describe('Phase 3 + ui_directive — neither graph source (fail-closed baseline)', () => {
  beforeEach(async () => {
    await setFlag('true');
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('lookup-gated blocks drop; narrative and assumption cards still ship with empty target_refs; zero directives', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [productionShapedFact()],
      // no persistedGraph
    });
    expect(byType(env.blocks, 'ui_directive')).toHaveLength(0);
    expect(reviewCardsOfKind(env.blocks, 'flip_threshold')).toHaveLength(0);
    expect(reviewCardsOfKind(env.blocks, 'scenario_context')).toHaveLength(0);
    expect(reviewCardsOfKind(env.blocks, 'evidence_priority')).toHaveLength(0);
    expect(byType(env.blocks, 'evidence')).toHaveLength(0);

    const narrative = reviewCardsOfKind(env.blocks, 'narrative');
    expect(narrative).toHaveLength(1);
    expect((narrative[0] as unknown as { target_refs: unknown[] }).target_refs).toEqual([]);
    const assumptions = reviewCardsOfKind(env.blocks, 'assumption');
    expect(assumptions).toHaveLength(1);
    expect((assumptions[0] as unknown as { target_refs: unknown[] }).target_refs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (d) NO-DARK-LAUNCH (Paul, 19 Jul): CEE_UI_DIRECTIVE_EMIT deleted — the
// former flag-off dormancy describe is gone. The emitter's fallback-path
// behaviour is pinned positively by the suites above.
// ---------------------------------------------------------------------------
