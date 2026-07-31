/**
 * Wave-4 δ2 — the focus / open_inspector emit policy (ROADMAP 1.202).
 * "The AI points at the graph." Deterministic ladder, zero LLM authorship, N=1.
 *
 * §2.1 trigger table pins (each fact class → exactly its verb):
 *   1 · applied set_factor_value / adjust_edge_strength → open_inspector @ node/edge
 *   2 · run_analysis + surviving lens + resolvable subject → focus (SUPERSEDES highlight)
 *   3 · run_analysis, no lens → v1 highlight (regression-proof floor)
 *   4 · what_would_flip (precondition met) → focus @ flip factor
 * plus: fail-closed (unresolved / noop / add_constraint / precondition_unmet → NOTHING);
 * the cage-composition gate (σ-dropped lens block → NO focus); N=1 latch; telemetry.
 *
 * Positive control (trap-13): every absence assertion is preceded by proving the
 * emitter CAN see a presence on the same fixture family.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { UiDirectiveBlockSchema } from '@talchain/schemas/boundary';

import { composeToolCallResponse } from '../../compose.js';
import {
  buildFocusInspectorDirective,
  buildRecommendedOptionUiDirective,
} from '../ui-directive.js';
import {
  buildGraphNodeLookup,
  buildGraphNodeLookupFromGraph,
  buildLensSuggestionCoachingBlock,
  type BlockBuildCtx,
} from '../phase3-blocks.js';
import { setTestSink } from '../../../utils/telemetry.js';

const BASE_INPUT = {
  answerKind: 'functional' as const,
  orientation: 'Done.',
  confirmation: 'Applied.',
  coaching: null as string | null,
  stage: 'analyse' as const,
};

const GRAPH_HASH = 'gh_focus_0001';

// A graph carrying the dominant driver + the recommended option + an edge.
const GRAPH = {
  nodes: [
    { id: 'goal_g', label: 'Launch success', kind: 'goal' },
    { id: 'fac_a', label: 'Delivery risk', kind: 'factor' },
    { id: 'fac_b', label: 'Team size', kind: 'factor' },
    { id: 'opt_x', label: 'Hire locally', kind: 'option' },
    { id: 'opt_y', label: 'Outsource', kind: 'option' },
  ],
  edges: [{ id: 'edge_ab', from: 'fac_a', to: 'goal_g', label: 'Delivery risk → Launch success' }],
};

// A run_analysis fact whose factor_sensitivity trips the DOMINANT_DRIVER lens
// (fac_a carries a strict majority of influence) and whose enrichment ALSO
// carries the graph so the forward lookup resolves the subject label.
function dominantFact(overrides: { leadingOptionId?: string | null; noop?: boolean } = {}): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: overrides.noop ?? false,
    result: {
      scenario_id: 'scen-focus',
      leading_option_id: overrides.leadingOptionId === undefined ? 'opt_x' : overrides.leadingOptionId,
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        graph: GRAPH,
        confidence_tier: 'strong',
        // T1 claim safety — the fixture must DECLARE its constraint verdict.
        // `rebuildPhase3BlocksFresh` reads this stamp and FAILS CLOSED without
        // it, dropping every leader-presuming block. `evaluated_feasible` is the branch this
        // fixture must reach: the ui_directive ladder's row-2 gate reads the LENS
        // block's SURVIVAL, and the `strengthen` lens block is exactly what a
        // withheld verdict drops — so an unstamped fixture silently exercises the
        // row-3 `highlight` fallback instead of the row-2 `focus` it asserts.
        __cee_claim_safety: {
          may_name_leading_option: true,
          constraint_verdict_state: 'evaluated_feasible',
        },
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      },
    },
  } as unknown as HandlerFact;
}

// A healthy run_analysis fact — balanced influences, no lens fires.
function healthyFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-focus',
      leading_option_id: 'opt_x',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        graph: GRAPH,
        confidence_tier: 'strong',
        // T1 claim safety — the fixture must DECLARE its constraint verdict.
        // `rebuildPhase3BlocksFresh` reads this stamp and FAILS CLOSED without
        // it, dropping every leader-presuming block. `evaluated_feasible` is the branch this
        // fixture must reach: the ui_directive ladder's row-2 gate reads the LENS
        // block's SURVIVAL, and the `strengthen` lens block is exactly what a
        // withheld verdict drops — so an unstamped fixture silently exercises the
        // row-3 `highlight` fallback instead of the row-2 `focus` it asserts.
        __cee_claim_safety: {
          may_name_leading_option: true,
          constraint_verdict_state: 'evaluated_feasible',
        },
        // Three balanced factors — no single one exceeds the 50% dominance
        // share, so NO lens fires (the genuine no-lens case).
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      },
    },
  } as unknown as HandlerFact;
}

function mutationFact(
  factType: 'set_factor_value' | 'adjust_edge_strength' | 'add_constraint',
  targetId: string,
  status: 'applied' | 'noop' = 'applied',
): HandlerFact {
  return {
    fact_type: factType,
    fact_version: 1,
    noop: status === 'noop',
    result: { target_id: targetId, status, before: { value: 0.4 }, after: { value: 0.5 } },
  } as unknown as HandlerFact;
}

function flipFact(opts: { preconditionUnmet?: boolean; factorId?: string | null } = {}): HandlerFact {
  const scenarios =
    opts.factorId === null
      ? []
      : [
          {
            factor_id: opts.factorId ?? 'fac_a',
            current_value: 0.5,
            flip_threshold: 0.6,
            from_option_id: 'opt_x',
            to_option_id: 'opt_y',
            fragile: true,
          },
        ];
  return {
    fact_type: 'what_would_flip',
    fact_version: 1,
    noop: false,
    result: {
      precondition_unmet: opts.preconditionUnmet ?? false,
      option_count: 2,
      flip_scenarios: scenarios,
    },
  } as unknown as HandlerFact;
}

function directives(env: { blocks: ReadonlyArray<{ type: string }> }) {
  return env.blocks.filter((b) => b.type === 'ui_directive') as unknown as ReadonlyArray<{
    type: string;
    verb: string;
    targets: ReadonlyArray<{ id: string; label: string; kind: string }>;
  }>;
}

// ---------------------------------------------------------------------------
// Telemetry capture
// ---------------------------------------------------------------------------
interface SinkEvent { readonly event: string; readonly data: Record<string, unknown>; }
let sink: SinkEvent[] = [];
beforeEach(() => {
  sink = [];
  setTestSink((event, data) => sink.push({ event, data }));
});
afterEach(() => setTestSink(null));

// ===========================================================================
// Row 2 + 3 via composeToolCallResponse — lens focus SUPERSEDES highlight
// ===========================================================================
describe('δ2 row 2/3 — run_analysis focus supersedes highlight; no lens → highlight', () => {
  it('POSITIVE CONTROL: dominant-driver lens turn emits focus @ the lens subject FACTOR, not the winner highlight', () => {
    const env = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [dominantFact()] });
    const dir = directives(env);
    expect(dir).toHaveLength(1);
    expect(dir[0]!.verb).toBe('focus');
    expect(dir[0]!.targets).toEqual([{ id: 'fac_a', label: 'Delivery risk', kind: 'factor' }]);
    // Supersession: the winner option is NOT the target.
    expect(dir[0]!.targets[0]!.id).not.toBe('opt_x');
    expect(UiDirectiveBlockSchema.safeParse(dir[0]).success).toBe(true);
  });

  it('REGRESSION FLOOR: a healthy (no-lens) analysis emits the v1 highlight @ the recommended option', () => {
    const env = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [healthyFact()] });
    const dir = directives(env);
    expect(dir).toHaveLength(1);
    expect(dir[0]!.verb).toBe('highlight');
    expect(dir[0]!.targets[0]!.id).toBe('opt_x');
  });

  it('fires the emitted telemetry (verb + target_kind, no user text)', () => {
    composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [dominantFact()] });
    const ev = sink.filter((e) => e.event === 'v5.ui_directive.emitted');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data).toMatchObject({ fact_type: 'run_analysis', verb: 'focus', target_kind: 'factor' });
    // No node id / label in the payload.
    const flat = Object.values(ev[0]!.data).map(String).join(' ');
    expect(flat).not.toContain('fac_a');
    expect(flat).not.toContain('Delivery risk');
  });
});

// ===========================================================================
// Cage composition (§Q3) + supersession — direct builder unit tests
// (control freshBlocks so a σ-dropped lens block is representable TODAY).
// ===========================================================================
describe('δ2 §Q3 — a directive fires only if the accompanying lens block survived (σ gate)', () => {
  const fact = dominantFact() as RunAnalysisHandlerFact;
  const lookup = buildGraphNodeLookup(fact);
  const ctx: BlockBuildCtx = { created_at: '2026-07-23T00:00:00.000Z', graph_hash_at_generation: GRAPH_HASH };
  const lensBlock = buildLensSuggestionCoachingBlock(fact, ctx, null)!;

  it('POSITIVE CONTROL: lens block PRESENT in freshBlocks → focus @ the subject', () => {
    const dir = buildFocusInspectorDirective(fact, lookup, [lensBlock]);
    expect(dir).not.toBeNull();
    expect(dir!.verb).toBe('focus');
    expect(dir!.targets[0]!.id).toBe('fac_a');
  });

  it('lens block ABSENT (σ dropped it) → NO focus; falls through to the v1 highlight', () => {
    const dir = buildFocusInspectorDirective(fact, lookup, []);
    expect(dir).not.toBeNull();
    expect(dir!.verb).toBe('highlight'); // fell through, did NOT point at a caged lens
    expect(dir!.targets[0]!.id).toBe('opt_x');
  });

  it('sanity: the lens block IS the deterministic_signal/strengthen block', () => {
    expect(lensBlock.type).toBe('coaching');
    expect(lensBlock.source).toBe('deterministic_signal');
    expect(lensBlock.coaching_kind).toBe('strengthen');
  });
});

// ===========================================================================
// Row 1 — mutation open_inspector
// ===========================================================================
describe('δ2 row 1 — applied mutation emits open_inspector @ the changed node/edge', () => {
  const persistedGraph = GRAPH;

  it('POSITIVE CONTROL: applied set_factor_value → open_inspector @ the factor', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [mutationFact('set_factor_value', 'fac_a')],
      persistedGraph,
    });
    const dir = directives(env);
    expect(dir).toHaveLength(1);
    expect(dir[0]!.verb).toBe('open_inspector');
    expect(dir[0]!.targets).toEqual([{ id: 'fac_a', label: 'Delivery risk', kind: 'factor' }]);
  });

  it('applied adjust_edge_strength → open_inspector @ the edge', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [mutationFact('adjust_edge_strength', 'edge_ab')],
      persistedGraph,
    });
    const dir = directives(env);
    expect(dir).toHaveLength(1);
    expect(dir[0]!.verb).toBe('open_inspector');
    expect(dir[0]!.targets[0]!).toMatchObject({ id: 'edge_ab', kind: 'edge' });
  });

  it('noop mutation → NOTHING', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [mutationFact('set_factor_value', 'fac_a', 'noop')],
      persistedGraph,
    });
    expect(directives(env)).toHaveLength(0);
  });

  it('target_id not in the persisted graph → NOTHING (fail-closed)', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [mutationFact('set_factor_value', 'fac_unknown')],
      persistedGraph,
    });
    expect(directives(env)).toHaveLength(0);
  });

  it('add_constraint is EXCLUDED (UI drops the patch) → NOTHING', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [mutationFact('add_constraint', 'con_budget')],
      persistedGraph: { nodes: [{ id: 'con_budget', label: 'Budget cap', kind: 'constraint' }], edges: [] },
    });
    expect(directives(env)).toHaveLength(0);
  });
});

// ===========================================================================
// Row 4 — what_would_flip focus
// ===========================================================================
describe('δ2 row 4 — what_would_flip focuses the first flip factor', () => {
  it('POSITIVE CONTROL: precondition met + resolvable factor → focus @ the flip factor', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [flipFact({ factorId: 'fac_a' })],
      persistedGraph: GRAPH,
    });
    const dir = directives(env);
    expect(dir).toHaveLength(1);
    expect(dir[0]!.verb).toBe('focus');
    expect(dir[0]!.targets[0]!.id).toBe('fac_a');
  });

  it('precondition_unmet → NOTHING', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [flipFact({ preconditionUnmet: true })],
      persistedGraph: GRAPH,
    });
    expect(directives(env)).toHaveLength(0);
  });

  it('no flip factor → NOTHING', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [flipFact({ factorId: null })],
      persistedGraph: GRAPH,
    });
    expect(directives(env)).toHaveLength(0);
  });

  it('flip factor unresolvable in the graph → NOTHING (fail-closed)', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [flipFact({ factorId: 'fac_ghost' })],
      persistedGraph: GRAPH,
    });
    expect(directives(env)).toHaveLength(0);
    const supp = sink.filter((e) => e.event === 'v5.ui_directive.suppressed');
    expect(supp.some((e) => e.data.reason === 'target_unresolved')).toBe(true);
  });
});

// ===========================================================================
// N=1 latch — at most one directive per turn across fact classes
// ===========================================================================
describe('δ2 N=1 — one directive per turn, first-emitting fact wins', () => {
  it('two directive-eligible facts (mutation + run_analysis) → exactly ONE directive', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [mutationFact('set_factor_value', 'fac_a'), dominantFact()],
      persistedGraph: GRAPH,
      persistedGraphHash: GRAPH_HASH,
    });
    expect(directives(env)).toHaveLength(1);
  });
});

// ===========================================================================
// Forward-path reuse — the v1 primitive is unchanged
// ===========================================================================
describe('δ2 reuses the shipped v1 highlight primitive unchanged', () => {
  it('buildRecommendedOptionUiDirective still resolves the recommended option', () => {
    const fact = dominantFact() as RunAnalysisHandlerFact;
    const lookup = buildGraphNodeLookupFromGraph(GRAPH);
    const block = buildRecommendedOptionUiDirective(fact, lookup);
    expect(block).toMatchObject({ verb: 'highlight', targets: [{ id: 'opt_x', kind: 'option' }] });
  });
});
