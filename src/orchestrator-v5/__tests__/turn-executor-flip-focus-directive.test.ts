/**
 * §2.1 ROW 4 — BIND THE FLIP GESTURE TO THE FACTOR THE TURN ACTUALLY PROPOSES.
 *
 * ⭐ THE MEASURED DEFECT (settled by EXECUTION, not by reading — see
 * `olumi-docs/PHASE0-EVIDENCE-2026-07-28/overturn-intervention-2026-08-14/`).
 * On a turn that GENUINELY dispatches the `what_would_flip` handler, the
 * workspace gestures at NOTHING. Both directive rows that could fire, suppress:
 *
 *     v5.ui_directive.suppressed  fact_type=what_would_flip   reason=no_flip_factor
 *     v5.ui_directive.suppressed  fact_type=discussed_entity  reason=no_discussed_entity
 *
 * Reproduced on BOTH dispatch routes (routed tool-use, and the chip forced
 * intent). So the claim this file makes is "NONE → SPECIFIC", not
 * "generic → specific": there was no gesture at all, not a loose one.
 *
 * WHY ROW 4 WAS DEAD. It read `fact.result.flip_scenarios?.[0]?.factor_id`.
 * `flip_scenarios` is a DEPRECATED LEGACY field: `WhatWouldFlipResultSchema`
 * still admits it (optional) at schemas 0.40.0 — so this is NOT a contract
 * gap — but the schema's own comment says "new code populates only the no-op
 * fields", and NEITHER producer (`what-would-flip.ts:95`, `:223`) writes it.
 * Row 4 therefore emitted `no_flip_factor` on every real flip turn: a standing
 * FALSE NEGATIVE that made the capability look gestureless in telemetry.
 *
 * WHY ROW 7 COULD NOT COVER FOR IT. The flip branch (`compose.ts:553-560`)
 * pushes no blocks and passes `EMPTY_FRESH_BLOCKS`, and the lifecycle rebuild
 * runs AFTER row 7 by a deliberate ruling. So row 7's scan sees no block
 * carrying a dispatchable `target_ref` and suppresses too.
 *
 * ⭐ THE BINDING, AND WHY IT IS THE PROPOSAL AND NOT A RE-DERIVATION.
 * The same turn already emits a REAL `set_factor_value` proposed change —
 * "Test <factor> at <N>" (`compose/flip-proposal.ts`, via `selectFlipProposal`).
 * That selection is not `flip_thresholds[0]`: it SKIPS entries that cannot
 * produce a safely-renderable proposal. Binding the gesture to that same
 * selection makes sentence, proposal and gesture provably agree — one
 * derivation, two read points (the rule ROADMAP 2.211 applies to `selectLens`).
 * Re-deriving the flip factor inside compose would reintroduce exactly the
 * two-authorities defect (trap 21) this row is supposed to close.
 *
 * IDENTITY BINDING (trap 19). `FLIP_THRESHOLDS[0]` is a DECOY: it is a real,
 * graph-resolvable factor that appears FIRST in the threshold list AND FIRST
 * among the graph's factor nodes — it fails ONLY the proposal's renderability
 * check. So an implementation that read `flip_thresholds[0]`, or the first
 * factor in graph order, or the first dispatchable ref, would emit a
 * SUCCESSFUL directive pointed at the wrong factor. Every assertion below
 * binds by id AND label, never by a value predicate another node could satisfy.
 *
 * POSITIVE CONTROL (trap 13). The "decoy is never chosen" absence assertion is
 * preceded by a case proving the emitter CAN point at that very decoy when the
 * proposal genuinely selects it — so the absence measures SELECTION, not an
 * unresolvable target or a blind probe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { createWhatWouldFlipHandler } from '../tools/handlers/what-would-flip.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import type { V5ActionType } from '@talchain/schemas/orchestrator';
import { setTestSink } from '../../utils/telemetry.js';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** The factor the turn's own `set_factor_value` proposal targets. */
const PROPOSAL_FACTOR_ID = 'fac_market_demand';
const PROPOSAL_FACTOR_LABEL = 'Market demand';
/** The decoy: first in threshold order AND first in graph factor order. */
const DECOY_FACTOR_ID = 'fac_acquisition_cost';
const DECOY_FACTOR_LABEL = 'Acquisition cost';

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = { priorTurns: [], priorFacts: [], persistedGraph: null };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>(
    '../routing/route-with-tool-use.js',
  );
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

const { runTurnExecutor } = await import('../turn-executor.js');

/**
 * Both factors are REAL graph nodes, both resolvable by the same lookup row 4
 * uses. The decoy is listed FIRST so graph-order and threshold-order
 * implementations both land on it.
 */
const READY_GRAPH = {
  nodes: [
    { id: 'dec_root', kind: 'decision' as const, label: 'Marketing capacity?' },
    { id: 'goal_growth', kind: 'goal' as const, label: 'Customer growth', goal_threshold: 0.8 },
    { id: DECOY_FACTOR_ID, kind: 'factor' as const, label: DECOY_FACTOR_LABEL },
    { id: PROPOSAL_FACTOR_ID, kind: 'factor' as const, label: PROPOSAL_FACTOR_LABEL },
    { id: 'opt_freelance', kind: 'option' as const, label: 'Freelance Plus Moderate Ad Spend' },
    { id: 'opt_hire', kind: 'option' as const, label: 'Hire Marketing Manager' },
  ],
  edges: [
    { from: 'dec_root', to: 'opt_freelance', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'dec_root', to: 'opt_hire', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: DECOY_FACTOR_ID, to: 'goal_growth', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: PROPOSAL_FACTOR_ID, to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
};

/**
 * `flip_value: 0.45` on an UNCAPPED factor is a user-scale value the exact
 * formatter refuses to round (`unrenderable_value`), so `selectFlipProposal`
 * skips this entry — while the node itself resolves perfectly through the graph
 * lookup. That is what makes it a decoy rather than merely an invalid input.
 */
const DECOY_ENTRY = {
  factor_id: DECOY_FACTOR_ID,
  factor_label: DECOY_FACTOR_LABEL,
  flip_value: 0.45,
  direction: 'increase',
};
/** Uncapped whole number → renders exactly → this is the entry that proposes. */
const PROPOSABLE_ENTRY = {
  factor_id: PROPOSAL_FACTOR_ID,
  factor_label: PROPOSAL_FACTOR_LABEL,
  flip_value: 12,
  direction: 'increase',
};

function priorRunAnalysisFact(
  flipThresholds: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  const parsed = GraphStateIngressSchema.safeParse(READY_GRAPH);
  if (!parsed.success) throw new Error('test setup: graph parse failed');
  const hash = computeAnalysisAffectingGraphHash(parsed.data)!;
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_freelance',
      win_probabilities: { opt_freelance: 0.62, opt_hire: 0.38 },
      summary: 'Ran analysis.',
      graph_hash_at_run: hash,
      computed_at: '2026-04-30T12:00:00.000Z',
      // An UNSTAMPED fact fails closed to "leader withheld", which would send
      // the turn down the withheld-explanation projection instead of the path
      // under test. This fixture is a healthy, feasible run, so it permits.
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
      enrichment: {
        analysis_status: 'computed',
        option_comparison: [
          { option_id: 'opt_freelance', option_label: 'Freelance Plus Moderate Ad Spend', win_probability: 0.62 },
          { option_id: 'opt_hire', option_label: 'Hire Marketing Manager', win_probability: 0.38 },
        ],
        // TOP-LEVEL `factor_sensitivity` with `influence_score` — the shape PLoT
        // returns and the only one `deriveTopDriversFromTopLevel` reads. Without
        // a renderable top driver the flip turn never clears the class gate at
        // all (measured: `missing_inputs:["top_driver"]`).
        factor_sensitivity: [
          { factor_id: PROPOSAL_FACTOR_ID, factor_label: PROPOSAL_FACTOR_LABEL, influence_score: 0.7, direction: 'positive' },
          { factor_id: DECOY_FACTOR_ID, factor_label: DECOY_FACTOR_LABEL, influence_score: 0.5, direction: 'negative' },
        ],
        flip_thresholds: flipThresholds,
      },
    },
  };
}

const PRIOR_RA_TURN = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: '2026-04-30T12:00:00.000Z',
};

function mkPayload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

/** Minimal valid routed tool_call proposing `what_would_flip` (execute). */
function routedWhatWouldFlip() {
  return {
    type: 'tool_call' as const,
    orientationText: '',
    llmCallCount: 1,
    rawResult: { content: [], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, model: 'mock', latencyMs: 0 },
    proposal: {
      intent_class: 'execute' as const,
      action: {
        handler_id: 'what_would_flip',
        entity: {
          id: 'goal_growth',
          kind: 'goal' as const,
          resolution_status: 'resolved' as const,
          resolution_method: 'context_inference' as const,
        },
        parameters: [],
        cited_context_fields: [],
        explanation: { answer_text: 'x' },
      },
    },
  };
}

/**
 * `set_factor_value` MUST be registered. `emitProposedChange` refuses to offer
 * a proposal whose intent has no registered handler — the resumer could not
 * honour a "yes" — so without it the flip proposal never emits and this file
 * would measure the no-proposal branch while believing it measured the bound
 * gesture. It is never INVOKED here (the turn offers the change, it does not
 * apply it), so the stub throws rather than pretending to succeed.
 */
const REAL_REGISTRY: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
  ['what_would_flip', createWhatWouldFlipHandler()],
  [
    'set_factor_value',
    (() => {
      throw new Error('set_factor_value must not be invoked on a what_would_flip turn');
    }) as unknown as HandlerFn,
  ],
]);

let sink: Array<{ event: string; data: Record<string, unknown> }> = [];

/**
 * ⚠ ATTRIBUTION IS TELEMETRY-BASED, NOT BYTE-BASED. Rows 2, 4 and 7 all emit
 * `focus @ <factor>` and the block bytes are IDENTICAL. Only the telemetry
 * carries the authoring row's `fact_type` tag, so it is the sole available
 * discriminator for "row 4 authored this".
 */
function emittedBy(tag: string) {
  return sink.filter(
    (e) => e.event === 'v5.ui_directive.emitted' && e.data.fact_type === tag,
  );
}
function suppressionsBy(tag: string) {
  return sink.filter(
    (e) => e.event === 'v5.ui_directive.suppressed' && e.data.fact_type === tag,
  );
}
/** The directive block actually on the wire, with its resolved target. */
function directiveBlocks(result: unknown) {
  const blocks =
    ((result as { response?: { blocks?: Array<Record<string, unknown>> } }).response?.blocks) ?? [];
  return blocks.filter((b) => b.type === 'ui_directive') as Array<{
    type: string;
    verb: string;
    targets: Array<{ id: string; label: string; kind: string }>;
  }>;
}

async function runFlipTurn(requestId: string) {
  routeWithToolUseMock.mockResolvedValue(routedWhatWouldFlip());
  return runTurnExecutor(mkPayload('Let us keep going with this for now please.'), requestId, {
    routingAdapter: { chatWithTools: vi.fn() } as never,
    handlerRegistry: REAL_REGISTRY,
    graphState: READY_GRAPH as never,
  });
}

describe('§2.1 row 4 — the flip gesture binds to the factor the turn proposes', () => {
  beforeEach(() => {
    sink = [];
    setTestSink((event, data) => sink.push({ event, data: data as Record<string, unknown> }));
    routeWithToolUseMock.mockReset();
    mockState.priorTurns = [PRIOR_RA_TURN];
    mockState.persistedGraph = READY_GRAPH;
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  it('emits `focus` bound BY IDENTITY to the proposal factor, not the first threshold row', async () => {
    // Decoy FIRST: an implementation reading flip_thresholds[0], or graph
    // factor order, or the first dispatchable ref, lands on the decoy.
    mockState.priorFacts = [priorRunAnalysisFact([DECOY_ENTRY, PROPOSABLE_ENTRY])];

    const result = await runFlipTurn('req-flip-focus-bind');

    // RED at pristine: row 4 read the never-written legacy `flip_scenarios`,
    // so it suppressed `no_flip_factor` and the turn gestured at nothing.
    const emitted = emittedBy('what_would_flip');
    expect(
      emitted,
      'row 4 must emit a directive on a turn that dispatched the flip handler',
    ).toHaveLength(1);
    expect(emitted[0]?.data.verb).toBe('focus');
    expect(suppressionsBy('what_would_flip')).toHaveLength(0);

    // IDENTITY: id AND label, never a value predicate another node satisfies.
    const blocks = directiveBlocks(result);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.verb).toBe('focus');
    expect(blocks[0]?.targets).toHaveLength(1);
    expect(blocks[0]?.targets[0]?.id).toBe(PROPOSAL_FACTOR_ID);
    expect(blocks[0]?.targets[0]?.label).toBe(PROPOSAL_FACTOR_LABEL);
    expect(blocks[0]?.targets[0]?.kind).toBe('factor');

    // The decoy is never the target — the positive control below proves this
    // absence measures SELECTION and not an unresolvable node.
    expect(blocks[0]?.targets[0]?.id).not.toBe(DECOY_FACTOR_ID);
    expect(blocks[0]?.targets[0]?.label).not.toBe(DECOY_FACTOR_LABEL);

    // N=1 latch: row 4 emitting means row 7 never runs, so the turn carries
    // exactly one directive and it is attributed to row 4.
    expect(emittedBy('discussed_entity')).toHaveLength(0);
  });

  it('POSITIVE CONTROL — when the proposal selects the decoy, the gesture points AT the decoy', async () => {
    // Same node, same lookup, same row: only the PROPOSAL selection changes.
    // If this failed, the previous test's absence assertion would be vacuous
    // (a blind probe or an unresolvable target rather than a real choice).
    mockState.priorFacts = [
      priorRunAnalysisFact([{ ...DECOY_ENTRY, flip_value: 8 }, PROPOSABLE_ENTRY]),
    ];

    const result = await runFlipTurn('req-flip-focus-control');

    expect(emittedBy('what_would_flip')).toHaveLength(1);
    const blocks = directiveBlocks(result);
    expect(blocks[0]?.targets[0]?.id).toBe(DECOY_FACTOR_ID);
    expect(blocks[0]?.targets[0]?.label).toBe(DECOY_FACTOR_LABEL);
  });

  it('no renderable flip proposal → suppresses honestly, and does NOT invent a target', async () => {
    // Every entry unproposable → `selectFlipProposal` returns null → there is
    // genuinely no factor the turn offered to change. Fail closed: the row
    // must not fall back to "some factor from the analysis".
    mockState.priorFacts = [priorRunAnalysisFact([DECOY_ENTRY])];

    const result = await runFlipTurn('req-flip-focus-none');

    expect(emittedBy('what_would_flip')).toHaveLength(0);
    const suppressed = suppressionsBy('what_would_flip');
    expect(suppressed).toHaveLength(1);
    // The reason must be the HONEST one. At pristine this read
    // `no_flip_factor` — a false negative sourced from the never-written
    // legacy `flip_scenarios` field, which fired on EVERY flip turn including
    // the ones that did emit a proposal. `no_flip_proposal` states the
    // condition that is actually true here.
    expect(suppressed[0]?.data.reason).toBe('no_flip_proposal');
    expect(directiveBlocks(result)).toHaveLength(0);
  });

  it('DISCRIMINATING PAIR — a non-flip turn is byte-unchanged (no row-4 telemetry at all)', async () => {
    // A turn that dispatches no flip handler must not gain, lose or re-tag a
    // directive. Row 4 is keyed to the flip fact; nothing else may touch it.
    mockState.priorFacts = [priorRunAnalysisFact([DECOY_ENTRY, PROPOSABLE_ENTRY])];
    routeWithToolUseMock.mockResolvedValue({
      type: 'text_only' as const,
      text: 'Here is a plain answer.',
      inferredIntent: 'converse' as const,
      llmCallCount: 1,
      rawResult: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, model: 'mock', latencyMs: 0 },
    });

    await runTurnExecutor(mkPayload('Tell me about this model.'), 'req-flip-focus-nonflip', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      handlerRegistry: REAL_REGISTRY,
      graphState: READY_GRAPH as never,
    });

    expect(emittedBy('what_would_flip')).toHaveLength(0);
    expect(suppressionsBy('what_would_flip')).toHaveLength(0);
  });
});
