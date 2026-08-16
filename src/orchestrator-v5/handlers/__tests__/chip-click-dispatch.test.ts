/**
 * Phase 2b — `dispatchDeterministicChipClick` whitelist tests.
 *
 * These tests pin the new generalised entry point:
 *   - Whitelist enforcement (throws for un-registered action_types).
 *   - run_analysis path delegates to the existing heavyweight dispatcher
 *     (regression: existing chip-click behaviour unchanged).
 *   - explain_results / what_would_flip paths invoke the registered handler
 *     directly, with no Sonnet routing call observed.
 *
 * The handler invocation is mocked at the registry seam (same as the
 * existing `chip-click-dispatch-analysis-ready.test.ts`), so failures of
 * the deterministic-projection helpers surface as type errors rather than
 * runtime drift. Spot checks of the projection wiring live in the
 * integration test (see `tests/integration/orchestrator/route-v2-chip-click-explain.test.ts`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  enrichRunAnalysisMock,
  runAnalysisHandlerMock,
  explainResultsHandlerMock,
  whatWouldFlipHandlerMock,
  routeWithToolUseSpy,
  getDefaultRegistryMock,
  buildTurnContextMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  runAnalysisHandlerMock: vi.fn(),
  explainResultsHandlerMock: vi.fn(),
  whatWouldFlipHandlerMock: vi.fn(),
  routeWithToolUseSpy: vi.fn(),
  getDefaultRegistryMock: vi.fn(),
  // Hoisted so per-test happy-path overrides can call
  // `buildTurnContextMock.mockResolvedValueOnce(...)`. Default is the
  // empty-prior-facts / no-persisted-graph shape used by precondition-
  // fail tests; happy-path tests override at call site.
  buildTurnContextMock: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    // Minimal stub — the dispatcher only reads scenarioBriefText, prior_facts,
    // persistedGraph, budgets, and session_id from the context. Other fields
    // are not consulted by the deterministic dispatch path. Hoisted so
    // happy-path tests can override via mockResolvedValueOnce.
    buildTurnContext: buildTurnContextMock,
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: enrichRunAnalysisMock,
}));

vi.mock('../../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/registry.js')>(
    '../../tools/registry.js',
  );
  return {
    ...actual,
    createRegistry: () =>
      new Map<string, unknown>([
        ['run_analysis', runAnalysisHandlerMock],
        ['explain_results', explainResultsHandlerMock],
        ['what_would_flip', whatWouldFlipHandlerMock],
      ]),
    getDefaultRegistry: getDefaultRegistryMock,
    resolveHandler: (registry: Map<string, unknown>, id: string) =>
      registry.get(id) ?? null,
  };
});

// The deterministic-bypass contract: NO routing call. Spy on routeWithToolUse
// and assert zero invocations on every test in this suite. This is the
// canonical Phase 2b assertion — the dispatcher must NOT hit the Sonnet
// routing prompt, even though it shares COMMIT/COMPOSE with TurnExecutor.
vi.mock('../../routing/route-with-tool-use.js', () => ({
  routeWithToolUse: routeWithToolUseSpy,
}));

import {
  dispatchDeterministicChipClick,
  isDeterministicChipClickActionType,
  DETERMINISTIC_CHIP_ACTION_TYPES,
} from '../chip-click-dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Exact current canonical authority for the post-analysis science-chip tests.
// A successful handler fact is not positive permission by itself: the snapshot
// must also pass the whole-model readiness contract (decision → options →
// factor → goal, with both option interventions configured).
const READY_SNAPSHOT_GRAPH = {
  nodes: [
    { id: 'dec_x', kind: 'decision' as const, label: 'Choose an option' },
    { id: 'goal_x', kind: 'goal' as const, label: 'Outcome', goal_threshold: 0.8 },
    { id: 'fac_delivery', kind: 'factor' as const, label: 'Delivery reliability' },
    {
      id: 'opt_a',
      kind: 'option' as const,
      label: 'Option A',
      interventions: { fac_delivery: 1 },
    },
    {
      id: 'opt_b',
      kind: 'option' as const,
      label: 'Option B',
      interventions: { fac_delivery: 0 },
    },
  ],
  edges: [
    {
      from: 'dec_x',
      to: 'opt_a',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'dec_x',
      to: 'opt_b',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_a',
      to: 'fac_delivery',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_b',
      to: 'fac_delivery',
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_delivery',
      to: 'goal_x',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_x',
};
const READY_SNAPSHOT_GRAPH_HASH = computeAnalysisAffectingGraphHash(
  READY_SNAPSHOT_GRAPH as never,
)!;

function payloadFor(actionType: 'run_analysis' | 'explain_results' | 'what_would_flip') {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Please explain the analysis result.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: actionType },
  });
}

/**
 * Default `buildTurnContext` mock implementation — empty prior_facts,
 * no persisted graph. Per-test overrides via
 * `buildTurnContextMock.mockResolvedValueOnce({...})` for happy-path
 * scenarios that need real prior_facts / persisted graph.
 */
const DEFAULT_TURN_CONTEXT = {
  stage: 'analyse' as const,
  entity_registry: { option_ids: [], goal_id: null },
  capabilities: {
    can_run_analysis: false,
    can_edit_graph: false,
    can_run_decision_review: false,
    can_generate_coaching: false,
    can_invoke_tools: false,
    can_commit_session_state: false,
  },
  messages: [{ role: 'user' as const, content: 'Please explain the result.' }],
  session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  request_id: 'req-test',
  budgets: {
    turn_ms: 30000,
    handler_ms: 20000,
    plot_ms: 15000,
    anthropic_ms: 15000,
    openai_ms: 15000,
  },
  prior_turns: [],
  prior_facts: [] as unknown[],
  scenarioBriefText: null,
  persistedGraph: null,
};

describe('dispatchDeterministicChipClick — whitelist enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildTurnContextMock.mockResolvedValue(DEFAULT_TURN_CONTEXT);
    getDefaultRegistryMock.mockImplementation(
      () =>
        new Map<string, unknown>([
          ['run_analysis', runAnalysisHandlerMock],
          ['explain_results', explainResultsHandlerMock],
          ['what_would_flip', whatWouldFlipHandlerMock],
        ]),
    );
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    });
  });

  it('exposes the whitelisted action_types as an immutable set (audit-friendly)', () => {
    // F2 CHANGE A — run_analysis STAYS (genuine no-LLM compute handler);
    // explain_results / what_would_flip are REMOVED so they route through the
    // conversation-aware coach path instead of composing canned prose.
    expect(DETERMINISTIC_CHIP_ACTION_TYPES.has('run_analysis')).toBe(true);
    expect(DETERMINISTIC_CHIP_ACTION_TYPES.has('explain_results')).toBe(false);
    expect(DETERMINISTIC_CHIP_ACTION_TYPES.has('what_would_flip')).toBe(false);
    // The whitelist is now exactly {run_analysis} — pin the size so a future
    // re-addition of an explanation intent trips this test (anti-drift).
    expect(DETERMINISTIC_CHIP_ACTION_TYPES.size).toBe(1);
  });

  it('isDeterministicChipClickActionType returns true for run_analysis and false for the (now coach-routed) explanation intents and everything else', () => {
    expect(isDeterministicChipClickActionType('run_analysis')).toBe(true);
    // F2 CHANGE A — these now fall through to the coach (forced intent), so they
    // must NOT be deterministic-dispatched.
    expect(isDeterministicChipClickActionType('explain_results')).toBe(false);
    expect(isDeterministicChipClickActionType('what_would_flip')).toBe(false);
    // Singular alias not registered; explicit not-whitelisted.
    expect(isDeterministicChipClickActionType('explain_result')).toBe(false);
    // Mutation handler — must NEVER be in the whitelist (requires routed
    // proposal params per the brief stop-condition list).
    expect(isDeterministicChipClickActionType('set_factor_value')).toBe(false);
    expect(isDeterministicChipClickActionType('arbitrary_unknown')).toBe(false);
    expect(isDeterministicChipClickActionType('')).toBe(false);
  });

  it('throws when called with an unwhitelisted action_type — explicit programming-error path', async () => {
    await expect(
      dispatchDeterministicChipClick('arbitrary_unknown', {
        payload: payloadFor('run_analysis'),
        requestId: 'req-test',
      }),
    ).rejects.toThrow(/not whitelisted/);
  });

  it('throws when called with a registered handler ID that is NOT in the whitelist (e.g. mutation handler)', async () => {
    await expect(
      dispatchDeterministicChipClick('set_factor_value', {
        payload: payloadFor('run_analysis'),
        requestId: 'req-test',
      }),
    ).rejects.toThrow(/not whitelisted/);
  });
});

describe('dispatchDeterministicChipClick — run_analysis regression', () => {
  // V5 latency gate (#209, d92702d4): the decision_review auto-fire on the
  // chip-click run_analysis path is gated behind
  // `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` (default false → skip with
  // reason `autofire_disabled`). This regression test pins the legacy
  // await path ("enricher still runs"), so run it with the flag on —
  // same pattern as turn-executor-decision-review-resilience.test.ts.
  let priorAwaitFlag: string | undefined;
  beforeEach(async () => {
    priorAwaitFlag = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'true';
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
    vi.clearAllMocks();
    buildTurnContextMock.mockResolvedValue(DEFAULT_TURN_CONTEXT);
    // run_analysis takes its existing heavyweight code path: scenario
    // snapshot pre-load + decision_review enrichment + analysis_ready
    // derivation from the cached snapshot graph. Mock the scenario read
    // to return a minimal snapshot so the dispatch completes.
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue({
      graph: {
        nodes: [
          { id: 'goal_x', kind: 'goal', label: 'Outcome', goal_threshold: 0.8 },
          { id: 'opt_a', kind: 'option', label: 'Option A', interventions: {} },
          { id: 'opt_b', kind: 'option', label: 'Option B', interventions: {} },
        ],
        edges: [],
      },
      options: [],
      goal_node_id: 'goal_x',
      rawPersistedGraph: null,
    });
    runAnalysisHandlerMock.mockResolvedValue({
      assistant_text: 'Ran analysis.',
      handler_facts: [
        {
          fact_type: 'run_analysis' as const,
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: SCENARIO_ID,
            leading_option_id: 'opt_a',
            win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
            summary: 'Done.',
            enrichment: {},
          },
        },
      ],
      llm_calls_used: 0,
    });
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    });
  });

  it('run_analysis chip-click continues to dispatch with no behavioural change for the existing path', async () => {
    const out = await dispatchDeterministicChipClick('run_analysis', {
      payload: payloadFor('run_analysis'),
      requestId: 'req-run-analysis',
    });

    expect(out.outcome).toBe('ok');
    expect(runAnalysisHandlerMock).toHaveBeenCalledTimes(1);
    // Decision-review enricher still runs on the run_analysis path —
    // unchanged behaviour from before Phase 2b.
    expect(enrichRunAnalysisMock).toHaveBeenCalledTimes(1);
    // No Sonnet routing call.
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();
    // The explanation handlers are not consulted on the run_analysis path.
    expect(explainResultsHandlerMock).not.toHaveBeenCalled();
    expect(whatWouldFlipHandlerMock).not.toHaveBeenCalled();
    // F-DG negative pin (W1 overnight 2026-07-11): the deterministic
    // chip-click whitelist (run_analysis / explain_results /
    // what_would_flip) never MUTATES the graph, so its responses must
    // never carry the applied-mutation `draft_graph` wire field — that
    // attach is scoped to committed D1 mutations (turn-executor STEP 7,
    // GM-held resume, edit_graph apply). See applied-graph-emit.ts.
    expect('draft_graph' in out.response).toBe(false);
  });

  afterEach(async () => {
    if (priorAwaitFlag === undefined) {
      delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    } else {
      process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = priorAwaitFlag;
    }
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });
});

// ===========================================================================
// chip-click post-analysis suggested_actions parity
//
// Why this exists: the Sonnet-routed `run_analysis` path emits the post-
// `run_analysis` chip set via `generateChips` at turn-executor.ts:4274
// (executable explain_results + executable what_would_flip + conditional
// prompt-chip "What should we validate?"). The chip-click bypass goes
// through `dispatchDeterministicChipClick` and historically composed
// without calling `generateChips` — so the chip set never reached the
// user on the dominant Golden Journey path (clicking the post-draft
// "Run analysis" chip), per the PR #190 staging smoke (turn
// `e940f7e3-cbfc-4b02-b99e-406ae17a6f2c` returned 0 suggested_actions).
//
// These regression tests pin the parity contract:
//   - chip-click run_analysis emits the same baseline 2 chips that the
//     routed path emits.
//   - The "What should we validate?" prompt chip appears iff the
//     CURRENT-turn producer-ranked factor EVPPI identity has an exact safe
//     label. A same-factor Decision Review action is optional enrichment.
//   - No prior-fact rescue: a missing/empty/malformed current-turn
//     enrichment suppresses the chip even when priorFacts has usable
//     enrichment (preserves the PR #190 honesty rule from
//     chip-generator's `currentTurnCarriesUsableValidationGuidance`).
//   - MAX_CHIPS respected; chip IDs unique.
// ===========================================================================

describe('dispatchDeterministicChipClick — run_analysis post-analysis chip emission (parity with routed path)', () => {
  // Build a run_analysis handler-fact factory so per-test enrichment shapes
  // can be injected via `enrichRunAnalysisMock.mockImplementation(...)`.
  function makeRunAnalysisFact(
    enrichment: Record<string, unknown> = {},
  ): HandlerFact {
    return {
      fact_type: 'run_analysis' as const,
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_a',
        win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
        summary: 'Done.',
        graph_hash_at_run: READY_SNAPSHOT_GRAPH_HASH,
        computed_at: '2026-08-16T05:00:00.000Z',
        enrichment,
      },
    };
  }

  // V5 latency gate (#209, d92702d4): the conditional "What should we
  // validate?" prompt chip keys off CURRENT-turn decision_review
  // enrichment, which only attaches on the legacy await path
  // (`V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW=true`; default false skips the
  // auto-fire with reason `autofire_disabled`). Run this parity suite with
  // the flag on so the enricher-injected shapes below actually reach the
  // chip generator.
  let priorAwaitFlag: string | undefined;
  beforeEach(async () => {
    priorAwaitFlag = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'true';
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
    vi.clearAllMocks();
    buildTurnContextMock.mockResolvedValue(DEFAULT_TURN_CONTEXT);
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue({
      graph: READY_SNAPSHOT_GRAPH,
      options: [],
      goal_node_id: 'goal_x',
      rawPersistedGraph: READY_SNAPSHOT_GRAPH,
    });
    runAnalysisHandlerMock.mockResolvedValue({
      assistant_text: 'Ran analysis.',
      handler_facts: [makeRunAnalysisFact({})],
      llm_calls_used: 0,
    });
    // Default: enricher passes through unchanged (no decision_review attached).
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: HandlerFact[] }) => handlerFacts,
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    });
  });

  afterEach(async () => {
    if (priorAwaitFlag === undefined) {
      delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    } else {
      process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = priorAwaitFlag;
    }
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });

  it('emits the executable explain_results + what_would_flip chips after successful run_analysis (parity with routed path)', async () => {
    const out = await dispatchDeterministicChipClick('run_analysis', {
      payload: payloadFor('run_analysis'),
      requestId: 'req-chip-parity-baseline',
    });
    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    expect(out.analysisReady?.status).toBe('ready');
    expect(out.freshness?.freshness).toBe('fresh');
    const chips = out.response.suggested_actions ?? [];
    expect(chips).toHaveLength(2);
    expect(chips[0]!.id).toBe('chip_action_explain_results');
    expect((chips[0] as { action_type?: string }).action_type).toBe('explain_results');
    expect(chips[1]!.id).toBe('chip_action_what_would_flip');
    expect((chips[1] as { action_type?: string }).action_type).toBe('what_would_flip');
  });

  it('emits the "What should we validate?" prompt chip from current-turn EVPPI identity plus exact factor label', async () => {
    // Replace the enricher's pass-through with one that attaches
    // decision_review.evidence_enhancements with a usable specific_action
    // — the exact contract PR #190's `currentTurnCarriesUsableValidationGuidance`
    // gates on.
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: HandlerFact[] }) => {
        const enriched: HandlerFact[] = handlerFacts.map((f) => {
          if (f.fact_type !== 'run_analysis') return f;
          return {
            ...f,
            result: {
              ...f.result,
              enrichment: {
                factor_evppi: [
                  { factor_id: 'fac_delivery', evppi: 0.1, status: 'resolved' },
                ],
                factor_sensitivity: [
                  { factor_id: 'fac_delivery', factor_label: 'Delivery reliability' },
                ],
                decision_review: {
                  produced_at: '2026-05-21T17:00:00.000Z',
                  evidence_enhancements: {
                    fac_delivery: {
                      specific_action: 'Pull on-time delivery rates from the last two releases.',
                      rationale: 'top sensitivity',
                    },
                  },
                  key_assumptions: ['The talent market stays competitive.'],
                },
              },
            },
          } as HandlerFact;
        });
        return enriched;
      },
    );

    const out = await dispatchDeterministicChipClick('run_analysis', {
      payload: payloadFor('run_analysis'),
      requestId: 'req-chip-parity-validation',
    });
    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    expect(out.analysisReady?.status).toBe('ready');
    expect(out.freshness?.freshness).toBe('fresh');
    const chips = out.response.suggested_actions ?? [];
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.id)).toEqual([
      'chip_action_explain_results',
      'chip_action_what_would_flip',
      'chip_prompt_validate_decision',
    ]);
    const validationChip = chips[2]!;
    expect(validationChip.label).toBe('What should we validate?');
    expect(validationChip.message).toBe(
      'What should we validate or research to build confidence in this decision?',
    );
    // Prompt chip — `action_type` must be absent so the click routes
    // through the post-analysis advice gate's evidence_gap class.
    expect((validationChip as { action_type?: string }).action_type).toBeUndefined();
  });

  it('suppresses the validation chip when current-turn decision_review is absent (no priorFacts rescue — PR #190 honesty rule)', async () => {
    // Default enricher mock is a pass-through (no decision_review attached
    // to the current-turn fact). priorFacts could in principle carry an
    // older successful fact with usable enrichment; PR #190's chip-
    // honesty rule (`currentTurnCarriesUsableValidationGuidance`) reads
    // current-turn handlerFacts ONLY, so the chip must still be suppressed.
    const PRIOR_FACT_WITH_USABLE_ENRICHMENT: HandlerFact = {
      fact_type: 'run_analysis' as const,
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_a',
        win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
        summary: 'Older run.',
        enrichment: {
          decision_review: {
            produced_at: '2026-05-21T15:00:00.000Z',
            evidence_enhancements: {
              fac_old: {
                specific_action: 'OLDER stale advice that must NOT rescue the chip.',
              },
            },
            key_assumptions: [],
          },
        },
      },
    };
    // Override the turn-context mock to thread a stale prior fact through.
    buildTurnContextMock.mockResolvedValueOnce({
      ...DEFAULT_TURN_CONTEXT,
      prior_facts: [PRIOR_FACT_WITH_USABLE_ENRICHMENT],
    });

    const out = await dispatchDeterministicChipClick('run_analysis', {
      payload: payloadFor('run_analysis'),
      requestId: 'req-chip-parity-no-rescue',
    });
    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    const chips = out.response.suggested_actions ?? [];
    expect(chips).toHaveLength(2);
    expect(chips.some((c) => c.id === 'chip_prompt_validate_decision')).toBe(false);
  });

  it('keeps the validation chip reachable without a decision-review action when the PLoT label join is valid', async () => {
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: HandlerFact[] }) => {
        return handlerFacts.map((f) => {
          if (f.fact_type !== 'run_analysis') return f;
          return {
            ...f,
            result: {
              ...f.result,
              enrichment: {
                factor_evppi: [
                  { factor_id: 'fac_a', evppi: 0.1, status: 'resolved' },
                ],
                factor_sensitivity: [
                  { factor_id: 'fac_a', factor_label: 'Delivery reliability' },
                ],
                decision_review: {
                  produced_at: '2026-05-21T17:00:00.000Z',
                  evidence_enhancements: {
                    fac_a: { rationale: 'no action attached' },
                    fac_b: { specific_action: '   ' }, // whitespace-only
                    fac_c: { specific_action: 42 }, // wrong type
                  },
                  key_assumptions: [],
                },
              },
            },
          } as HandlerFact;
        });
      },
    );

    const out = await dispatchDeterministicChipClick('run_analysis', {
      payload: payloadFor('run_analysis'),
      requestId: 'req-chip-parity-malformed',
    });
    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    const chips = out.response.suggested_actions ?? [];
    expect(chips).toHaveLength(3);
    expect(chips.some((c) => c.id === 'chip_prompt_validate_decision')).toBe(true);
  });

  it('fails the science chip closed when current canonical readiness is unknown, while preserving ordinary post-analysis chips', async () => {
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce({
      graph: READY_SNAPSHOT_GRAPH,
      options: [],
      goal_node_id: 'goal_x',
      rawPersistedGraph: null,
    });
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: HandlerFact[] }) =>
        handlerFacts.map((f) => {
          if (f.fact_type !== 'run_analysis') return f;
          return {
            ...f,
            result: {
              ...f.result,
              enrichment: {
                factor_evppi: [
                  { factor_id: 'fac_delivery', evppi: 0.1, status: 'resolved' },
                ],
                factor_sensitivity: [
                  { factor_id: 'fac_delivery', factor_label: 'Delivery reliability' },
                ],
                decision_review: {
                  evidence_enhancements: {
                    fac_delivery: { specific_action: 'This must not reopen science.' },
                  },
                },
              },
            },
          } as HandlerFact;
        }),
    );

    const out = await dispatchDeterministicChipClick('run_analysis', {
      payload: payloadFor('run_analysis'),
      requestId: 'req-chip-parity-readiness-unknown',
    });
    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    expect(out.analysisReady).toBeUndefined();
    expect((out.response.suggested_actions ?? []).map((chip) => chip.id)).toEqual([
      'chip_action_explain_results',
      'chip_action_what_would_flip',
    ]);
  });

  it('MAX_CHIPS=3 cap respected — never more than 3 suggested_actions on the chip-click run_analysis path', async () => {
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: HandlerFact[] }) => {
        return handlerFacts.map((f) => {
          if (f.fact_type !== 'run_analysis') return f;
          return {
            ...f,
            result: {
              ...f.result,
              enrichment: {
                factor_evppi: [
                  { factor_id: 'fac_a', evppi: 0.1, status: 'resolved' },
                ],
                factor_sensitivity: [
                  { factor_id: 'fac_a', factor_label: 'Delivery reliability' },
                ],
                decision_review: {
                  produced_at: '2026-05-21T17:00:00.000Z',
                  evidence_enhancements: {
                    fac_a: { specific_action: 'A' },
                  },
                  key_assumptions: [],
                },
              },
            },
          } as HandlerFact;
        });
      },
    );

    const out = await dispatchDeterministicChipClick('run_analysis', {
      payload: payloadFor('run_analysis'),
      requestId: 'req-chip-parity-cap',
    });
    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    const chips = out.response.suggested_actions ?? [];
    expect(chips.length).toBeLessThanOrEqual(3);
  });

  it('chip IDs are unique within the chip-click run_analysis emission set', async () => {
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: HandlerFact[] }) => {
        return handlerFacts.map((f) => {
          if (f.fact_type !== 'run_analysis') return f;
          return {
            ...f,
            result: {
              ...f.result,
              enrichment: {
                factor_evppi: [
                  { factor_id: 'fac_a', evppi: 0.1, status: 'resolved' },
                ],
                factor_sensitivity: [
                  { factor_id: 'fac_a', factor_label: 'Delivery reliability' },
                ],
                decision_review: {
                  produced_at: '2026-05-21T17:00:00.000Z',
                  evidence_enhancements: {
                    fac_a: { specific_action: 'A' },
                  },
                  key_assumptions: [],
                },
              },
            },
          } as HandlerFact;
        });
      },
    );

    const out = await dispatchDeterministicChipClick('run_analysis', {
      payload: payloadFor('run_analysis'),
      requestId: 'req-chip-parity-unique-ids',
    });
    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    const chips = out.response.suggested_actions ?? [];
    const ids = chips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
