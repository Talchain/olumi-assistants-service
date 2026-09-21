/**
 * V5 Phase 3A — chip-click `run_analysis` decision_review attachment
 * integration test.
 *
 * Why this test exists:
 *
 *   The pre-existing `brief-persistence-composed-roundtrip.test.ts` suite
 *   proves the brief flows from `scenarios.brief_text` into the
 *   `enrichRunAnalysisWithDecisionReview` arguments. It does NOT verify
 *   that the enricher then attaches `result.enrichment.decision_review`
 *   to the run_analysis fact, nor that the attached fact survives commit,
 *   because it mocks the enricher itself with a pass-through.
 *
 *   PR #178 acceptance on real staging produced 200s + a populated
 *   `scenarios.brief_text` row, BUT the persisted `v5_handler_facts` row
 *   had NO `decision_review` key under enrichment — so Phase 3 composer
 *   correctly skipped and no `review_card` / `coaching` / `evidence`
 *   blocks emitted. The mock-passthrough test layer cannot catch this
 *   class of regression.
 *
 *   This test fills the gap: it runs the REAL
 *   `enrichRunAnalysisWithDecisionReview` against a stateful in-memory
 *   `SessionStore`, mocks ONLY the underlying LLM adapter
 *   (`invokeDecisionReview` at `src/cee/decision-review/invoke.ts`), and
 *   asserts BOTH (a) the attached fact reaches `store.append`, AND (b)
 *   composing that fact emits non-zero Phase 3 blocks.
 *
 *   See PR #178 round-5 staging acceptance report for the failure mode
 *   this test is designed to catch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse, composeToolCallResponse } from '../compose.js';
import {
  buildCoachingBlocks,
  buildEvidenceBlocks,
  buildFactorConfidenceLookup,
  buildGraphNodeLookup,
  buildReviewCardBlocks,
} from '../compose/phase3-blocks.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import { makeMessagePayload } from './fixtures.js';
import type { DecisionReviewInvokeResult } from '../../cee/decision-review/invoke.js';
import type {
  HandlerFn,
  HandlerInvocation,
  HandlerOutcome,
  HandlerRegistry,
} from '../tools/registry.js';
import type { V5ActionType } from '@talchain/schemas/orchestrator';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

// ---------------------------------------------------------------------------
// Hoisted module mocks
// ---------------------------------------------------------------------------

// 1. Stateful in-memory SessionStore mirrors the production write-once
//    brief_text predicate (`WHERE brief_text IS NULL OR brief_text = ''`).
//    Surfaces through `getSessionStore()` via the singleton holder pattern
//    the chip-click dispatcher uses indirectly via `buildTurnContext`.
const liveStoreHolder: { current: SessionStore } = {
  current: createStatefulFakeStore(),
};
vi.mock('../session/index.js', () => ({
  getSessionStore: () => liveStoreHolder.current,
  resetSessionStoreForTests: () => {},
}));

// 2. ONLY the LLM-call layer is mocked. The REAL
//    `enrichRunAnalysisWithDecisionReview` runs against this stub. Every
//    skip / attach branch in the enricher exercises real code.
const invokeDecisionReviewMock = vi.fn<
  (..._args: unknown[]) => Promise<DecisionReviewInvokeResult>
>();
vi.mock('../../cee/decision-review/invoke.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../cee/decision-review/invoke.js')>(
      '../../cee/decision-review/invoke.js',
    );
  return { ...actual, invokeDecisionReview: invokeDecisionReviewMock };
});

// Imports that follow MUST be after the vi.mock declarations so the
// module-graph rebind takes effect.
const { dispatchChipClickRunAnalysis } = await import('../handlers/chip-click-dispatch.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DRAFT_TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUN_TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BRIEF =
  'We are a 15-person engineering team weighing three options for scaling delivery over the next six months.';
const GRAPH_HASH = 'gh_integration_test_0001';

const FACTOR_DELIVERY = { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' };
const FACTOR_COST = { id: 'fac_cost_overrun', label: 'Cost overrun', kind: 'factor' };

/**
 * Canned `decision_review` LLM output — minimal but real-shaped per
 * `src/prompts/defaults.ts` OUTPUT_SCHEMA (lines 1490-1518). Has enough
 * surface to make EVERY composer builder (narrative + bias + flip +
 * pre_mortem + evidence + assumption + coaching) emit at least one
 * block when validation gates pass.
 */
const CANNED_DECISION_REVIEW_OUTPUT: Record<string, unknown> = {
  narrative_summary:
    'Plan A leads with a comfortable margin given the current evidence base.',
  story_headlines: { opt_a: 'Plan A wins on delivery confidence' },
  robustness_explanation: {
    summary: 'The lead is robust across most plausible scenarios.',
    primary_risk: 'Delivery risk volatility could compress the margin.',
    stability_factors: [],
    fragility_factors: [],
  },
  readiness_rationale: 'Model is ready for decision.',
  evidence_enhancements: {
    fac_delivery_risk: {
      specific_action: 'pull on-time delivery rate from the last two releases',
      rationale: 'delivery rate is the highest-leverage variance driver',
      evidence_type: 'internal_data',
      decision_hygiene: 'estimate first, then check the data',
    },
  },
  scenario_contexts: {},
  flip_thresholds: [
    {
      factor_id: 'fac_delivery_risk',
      factor_label: 'Delivery risk',
      current_display: 'low',
      flip_display: 'high',
      narrative: 'A move from low to high delivery risk would change the leader.',
    },
  ],
  bias_findings: [
    {
      type: 'ANCHORING',
      source: 'structural',
      description: 'Multiple factors share a default baseline; verify before relying.',
      affected_elements: ['fac_delivery_risk'],
      suggested_action: 'Check estimates against base rates.',
    },
  ],
  key_assumptions: ['Market conditions persist for the next two quarters.'],
  decision_quality_prompts: [
    {
      question: 'What would change your mind about delivery risk?',
      principle: 'Disconfirmation',
      applies_because: 'Margin is moderate.',
    },
  ],
  pre_mortem: {
    failure_scenario: 'The team underestimates integration cost.',
    warning_signs: ['Velocity drops during integration weeks'],
    mitigation: 'Weekly cross-team review.',
    grounded_in: ['fac_delivery_risk'],
  },
};

function makeCannedInvokeResult(): DecisionReviewInvokeResult {
  return {
    output: CANNED_DECISION_REVIEW_OUTPUT,
    raw: JSON.stringify(CANNED_DECISION_REVIEW_OUTPUT),
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    llm_latency_ms: 50,
    input_tokens: 100,
    output_tokens: 200,
    prompt_version: 'test-v1',
    resolution: {
      task: 'decision_review',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      precedence_source: 'config',
    },
  } as unknown as DecisionReviewInvokeResult;
}

/**
 * Synthesise a `run_analysis` HandlerFact that mirrors the
 * shape PLoT actually produces: top-level `graph_hash_at_run` +
 * `enrichment.graph.nodes[]` + `enrichment.factor_sensitivity[]`.
 * The injected handler returns this fact, so the dispatcher's
 * post-handler enricher receives realistic input.
 */
function makeRunAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
      graph_hash_at_run: GRAPH_HASH,
      computed_at: '2026-05-17T00:00:00.000Z',
      enrichment: {
        graph: { nodes: [FACTOR_DELIVERY, FACTOR_COST] },
        factor_sensitivity: [
          { factor_id: 'fac_delivery_risk', confidence: 0.2 },
          { factor_id: 'fac_cost_overrun', confidence: 0.5 },
        ],
        // Phase 3A fix (2026-05-17): canonical PLoT V2 staging shape.
        // No `results` key — option-level data lives under
        // `option_comparison` + `decision_brief.options`, as captured on
        // staging scenario 22c9e91b-6200-40fc-9556-16a5e643294a against
        // build 2e6e0be. The input-adapter fallback chain
        // (decision-review-enricher.ts:readResultsArray) walks all three
        // sources in priority order so the chip-click integration test
        // exercises the production envelope shape end-to-end.
        option_comparison: [
          {
            id: 'opt_a',
            option_id: 'opt_a',
            label: 'Plan A',
            option_label: 'Plan A',
            status: 'computed',
            outcome: { mean: 0.05, p10: -0.1, p50: 0.05, p90: 0.2 },
            win_probability: 0.7,
          },
          {
            id: 'opt_b',
            option_id: 'opt_b',
            label: 'Plan B',
            option_label: 'Plan B',
            status: 'computed',
            outcome: { mean: 0.02, p10: -0.05, p50: 0.02, p90: 0.1 },
            win_probability: 0.3,
          },
        ],
        decision_brief: {
          options: [
            { rank: 1, option_id: 'opt_a', label: 'Plan A', win_probability: 0.7 },
            { rank: 2, option_id: 'opt_b', label: 'Plan B', win_probability: 0.3 },
          ],
        },
      },
    },
  } as unknown as HandlerFact;
}

/**
 * Build an injectable handler registry whose `run_analysis` handler
 * returns the canned fact. The injection seam bypasses
 * `loadScenarioSnapshotForRunAnalysis` (per the dispatcher's test-path
 * comment) so the test owns the scenario contract end-to-end.
 */
function makeHandlerRegistry(): HandlerRegistry {
  const handler: HandlerFn = async (_invocation: HandlerInvocation): Promise<HandlerOutcome> => ({
    handler_facts: [makeRunAnalysisFact()],
    assistant_text: 'Ran analysis on your current scenario.',
    llm_calls_used: 0,
  } as unknown as HandlerOutcome);
  return new Map<V5ActionType, HandlerFn>([['run_analysis', handler]]);
}

/**
 * Stateful in-memory SessionStore. Mirrors the RPC's first-write-wins
 * predicate so the chip-click commit's `briefText: undefined` does NOT
 * overwrite the brief seeded by the draft turn.
 */
function createStatefulFakeStore(): SessionStore {
  const briefByScenario = new Map<string, string>();
  const graphByScenario = new Map<string, unknown>();
  const writes: SessionTurnWrite[] = [];
  const facts: SessionTurnWrite[] = [];

  const noop = createNoopSessionStore();
  const store: SessionStore & { readonly capturedWrites: readonly SessionTurnWrite[] } = {
    ...noop,
    async append(write: SessionTurnWrite): Promise<{ id: string }> {
      writes.push(write);
      if (
        write.briefText !== undefined &&
        write.briefText !== null &&
        write.briefText.length > 0 &&
        !briefByScenario.has(write.scenario_id)
      ) {
        briefByScenario.set(write.scenario_id, write.briefText);
      }
      if (write.graph !== undefined) {
        graphByScenario.set(write.scenario_id, write.graph);
      }
      if (write.handler_facts !== undefined) {
        facts.push(write);
      }
      return { id: `row-${write.turn_id}` };
    },
    async loadGraphAndBriefText(scenarioId: string) {
      return {
        graph: graphByScenario.get(scenarioId) ?? null,
        briefText: briefByScenario.get(scenarioId) ?? null,
      };
    },
    async loadGraph(scenarioId: string) {
      return graphByScenario.get(scenarioId) ?? null;
    },
    get capturedWrites() {
      return writes;
    },
  };
  return store;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chip-click run_analysis — real enricher integration', () => {
  let priorAwaitFlag: string | undefined;
  beforeEach(async () => {
    liveStoreHolder.current = createStatefulFakeStore();
    invokeDecisionReviewMock.mockReset();
    invokeDecisionReviewMock.mockResolvedValue(makeCannedInvokeResult());
    // V5 latency gate: this suite specifically exercises the
    // decision_review attachment, so opt into the await path. Default
    // production behaviour (flag false) is covered separately.
    priorAwaitFlag = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'true';
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
  });
  afterEach(async () => {
    if (priorAwaitFlag === undefined) {
      delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    } else {
      process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = priorAwaitFlag;
    }
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
    vi.restoreAllMocks();
  });

  it('attaches decision_review to the run_analysis fact persisted by store.append', async () => {
    const store = liveStoreHolder.current;

    // 1. Seed scenarios.brief_text via a canonical draft commit
    //    (mirrors what dispatchDraftGraph does in production).
    await commitDirectAnswer(
      composeDirectAnswerResponse({
      answerKind: 'functional', assistant_text: 'drafted', stage: 'frame' }),
      {
        scenario_id: SCENARIO_ID,
        turn_id: DRAFT_TURN_ID,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:draft',
        llm_calls_used: 1,
        duration_ms: 5,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        briefText: BRIEF,
      },
      store,
    );

    // 2. Run the chip-click against the real enricher (only the LLM
    //    layer is stubbed by the module mock above).
    const chipPayload = makeMessagePayload({
      scenario_id: SCENARIO_ID,
      turn_id: RUN_TURN_ID,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    });
    const result = await dispatchChipClickRunAnalysis({
      payload: chipPayload,
      requestId: 'req-integration',
      handlerRegistry: makeHandlerRegistry(),
    });

    expect(result.outcome).toBe('ok');
    expect(invokeDecisionReviewMock).toHaveBeenCalledTimes(1);

    // 3. The chip-click commit MUST persist the run_analysis fact with
    //    decision_review attached. This is the assertion the existing
    //    pass-through tests cannot make.
    const fakeStore = store as SessionStore & { capturedWrites: readonly SessionTurnWrite[] };
    const chipAppend = fakeStore.capturedWrites.find(
      (w) => w.handler_id === 'run_analysis',
    );
    expect(chipAppend).toBeDefined();
    expect(chipAppend?.handler_facts).toBeDefined();
    expect(chipAppend!.handler_facts!.length).toBeGreaterThan(0);
    const runFact = chipAppend!.handler_facts!.find(
      (f: HandlerFact) => f.fact_type === 'run_analysis',
    );
    expect(runFact).toBeDefined();
    const persistedEnrichment = (runFact!.result as Record<string, unknown>).enrichment as
      | Record<string, unknown>
      | undefined;
    expect(persistedEnrichment).toBeDefined();
    expect(persistedEnrichment!.decision_review).toBeDefined();
    expect((persistedEnrichment!.decision_review as Record<string, unknown>).narrative_summary)
      .toBe(CANNED_DECISION_REVIEW_OUTPUT.narrative_summary);
  });

  it('composer emits non-zero Phase 3 blocks from the enriched fact', async () => {
    const store = liveStoreHolder.current;
    await commitDirectAnswer(
      composeDirectAnswerResponse({
      answerKind: 'functional', assistant_text: 'drafted', stage: 'frame' }),
      {
        scenario_id: SCENARIO_ID,
        turn_id: DRAFT_TURN_ID,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:draft',
        llm_calls_used: 1,
        duration_ms: 5,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        briefText: BRIEF,
      },
      store,
    );

    const chipPayload = makeMessagePayload({
      scenario_id: SCENARIO_ID,
      turn_id: RUN_TURN_ID,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    });
    const result = await dispatchChipClickRunAnalysis({
      payload: chipPayload,
      requestId: 'req-integration-compose',
      handlerRegistry: makeHandlerRegistry(),
    });

    expect(result.outcome).toBe('ok');
    expect(result.response.blocks.find((b) => b.type === 'analysis_result')).toBeDefined();

    // Same composer wiring as production: take the enriched fact captured
    // by store.append and run it through compose.ts. The Phase 3 builders
    // run end-to-end against the canned LLM output.
    const fakeStore = store as SessionStore & { capturedWrites: readonly SessionTurnWrite[] };
    const chipAppend = fakeStore.capturedWrites.find((w) => w.handler_id === 'run_analysis');
    const enrichedFacts = chipAppend!.handler_facts! as readonly HandlerFact[];

    // Direct composer assertion is the most precise way to prove the
    // round-trip: persisted facts → composer → Phase 3 blocks. We don't
    // rely on the wire `result.response.blocks` for the block-count
    // assertion because the dispatcher's response-finaliser path runs
    // additional layers; the direct composer call isolates the
    // decompose-from-enrichment contract.
    const composed = composeToolCallResponse({
      answerKind: 'functional',
      orientation: '',
      confirmation: 'Ran analysis on your current scenario.',
      coaching: null,
      stage: 'analyse',
      handlerFacts: enrichedFacts,
    });
    const blocksByType = new Map<string, number>();
    for (const b of composed.blocks) {
      blocksByType.set(b.type, (blocksByType.get(b.type) ?? 0) + 1);
    }
    expect(blocksByType.get('analysis_result') ?? 0).toBe(1);
    expect((blocksByType.get('review_card') ?? 0)).toBeGreaterThan(0);
    expect((blocksByType.get('evidence') ?? 0)).toBeGreaterThan(0);
    expect((blocksByType.get('coaching') ?? 0)).toBeGreaterThan(0);
  });

  it('per-builder cross-check: building Phase 3 blocks directly from the persisted fact emits non-zero counts', async () => {
    // Direct builder cross-check — independent of compose.ts wiring.
    // If this passes but the previous test fails, the regression is in
    // compose.ts wiring, not the enricher / persistence chain.
    const store = liveStoreHolder.current;
    await commitDirectAnswer(
      composeDirectAnswerResponse({
      answerKind: 'functional', assistant_text: 'drafted', stage: 'frame' }),
      {
        scenario_id: SCENARIO_ID,
        turn_id: DRAFT_TURN_ID,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:draft',
        llm_calls_used: 1,
        duration_ms: 5,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        briefText: BRIEF,
      },
      store,
    );

    await dispatchChipClickRunAnalysis({
      payload: makeMessagePayload({
        scenario_id: SCENARIO_ID,
        turn_id: RUN_TURN_ID,
        stage: 'analyse',
        message: 'Run analysis.',
        turn_class: 'decide',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      }),
      requestId: 'req-integration-builders',
      handlerRegistry: makeHandlerRegistry(),
    });

    const fakeStore = store as SessionStore & { capturedWrites: readonly SessionTurnWrite[] };
    const chipAppend = fakeStore.capturedWrites.find((w) => w.handler_id === 'run_analysis');
    const runFact = (chipAppend!.handler_facts! as readonly HandlerFact[]).find(
      (f) => f.fact_type === 'run_analysis',
    )!;
    const ctx = {
      created_at: '2026-05-17T00:00:01.000Z',
      graph_hash_at_generation: GRAPH_HASH,
    };
    const lookup = buildGraphNodeLookup(runFact as never);
    const confidence = buildFactorConfidenceLookup(runFact as never);
    expect(buildReviewCardBlocks(runFact as never, lookup, ctx).length).toBeGreaterThan(0);
    expect(buildCoachingBlocks(runFact as never, lookup, ctx).length).toBeGreaterThan(0);
    expect(buildEvidenceBlocks(runFact as never, lookup, confidence, ctx).length)
      .toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// F10 (2026-07-24) — chip_run conditional-LLM conformance: the REAL dispatcher
// with the flag OFF makes ZERO decision_review (LLM) calls. Paired with the
// flag-ON "invokeDecisionReviewMock called times(1)" assertion above, this
// proves chip_run is zero-OR-one child call gated by
// V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW — the conditional the ContextPolicy row
// now declares (conditional_llm_delegation).
// ---------------------------------------------------------------------------
describe('F10 — chip_run makes ZERO decision_review calls with the await flag OFF', () => {
  let priorAwaitFlag: string | undefined;
  beforeEach(async () => {
    liveStoreHolder.current = createStatefulFakeStore();
    invokeDecisionReviewMock.mockReset();
    invokeDecisionReviewMock.mockResolvedValue(makeCannedInvokeResult());
    priorAwaitFlag = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'false';
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
  });
  afterEach(async () => {
    if (priorAwaitFlag === undefined) delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    else process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = priorAwaitFlag;
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
    vi.restoreAllMocks();
  });

  it('flag OFF: the chip dispatch runs deterministically — no LLM (decision_review) call, no enrichment attached', async () => {
    const store = liveStoreHolder.current;
    await commitDirectAnswer(
      composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'drafted', stage: 'frame' }),
      {
        scenario_id: SCENARIO_ID, turn_id: DRAFT_TURN_ID, turn_class: 'direct_answer',
        handler_id: null, request_hash: 'sha256:draft', llm_calls_used: 1, duration_ms: 5,
        handler_facts: [], graph: { nodes: [], edges: [] }, briefText: BRIEF,
      },
      store,
    );

    const result = await dispatchChipClickRunAnalysis({
      payload: makeMessagePayload({
        scenario_id: SCENARIO_ID, turn_id: RUN_TURN_ID, stage: 'analyse',
        message: 'Run analysis.', turn_class: 'decide', source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      }),
      requestId: 'req-integration-flagoff',
      handlerRegistry: makeHandlerRegistry(),
    });

    expect(result.outcome).toBe('ok');
    // The whole point: ZERO LLM child call on the deterministic default path.
    expect(invokeDecisionReviewMock).not.toHaveBeenCalled();

    // And no decision_review enrichment is attached to the persisted fact.
    const fakeStore = store as SessionStore & { capturedWrites: readonly SessionTurnWrite[] };
    const chipAppend = fakeStore.capturedWrites.find((w) => w.handler_id === 'run_analysis');
    const runFact = chipAppend!.handler_facts!.find((f: HandlerFact) => f.fact_type === 'run_analysis');
    const enrichment = (runFact!.result as Record<string, unknown>).enrichment as Record<string, unknown> | undefined;
    expect(enrichment?.decision_review).toBeUndefined();
  });
});

