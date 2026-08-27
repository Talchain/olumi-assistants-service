/**
 * ROADMAP 2.73 — chip-click run_analysis coaching + decision_review
 * observability.
 *
 * Fix A: the chip dispatch previously composed `coaching: null` hardcoded,
 * so a chip-driven run (first OR rerun) shipped zero STEP-5 coaching prose
 * by construction. It now invokes the SAME `applyCoachingSignal` helper
 * the turn-executor uses:
 *   - first chip run  → FIRST_ANALYSIS_COMPLETE text joins assistant_text
 *   - chip rerun      → RERUN_ANALYSIS_COMPLETE text joins assistant_text,
 *                       and the committed run_analysis fact carries the
 *                       signal marker in its enrichment.
 *
 * Fix C: when the timings/trace gate is on and the decision_review LLM
 * call RETURNS, the dispatch result carries `turnTimings` with the
 * decision_review attribution (#476 parity); a call that never returned
 * produces NO entry (no phantom attribution).
 *
 * Harness mirrors chip-click-dispatch-analysis-ready.test.ts (registry +
 * commit + enricher mocked at their module seams; the coaching helper and
 * composer run REAL).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import {
  cappedScenarioAnalysisFactSet,
  completeScenarioAnalysisFactSet,
  degradedScenarioAnalysisFactSet,
} from '../../__tests__/support/scenario-analysis-fact-set.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { ScenarioAnalysisFactSet } from '../../context/reconcile-scenario-analysis-facts.js';
import {
  DISAGREEMENT_ACTION_LABEL,
  OVERRIDE_STRESS_TEST_ACTION_LABEL,
} from '../../coaching/judgement-offer-text.js';

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  enrichRunAnalysisMock,
  handlerFnMock,
  createRegistryMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  handlerFnMock: vi.fn(),
  createRegistryMock: vi.fn(),
}));

// Mutable holder so tests can vary the stubbed context's prior_facts
// (the rerun discriminator) without re-mocking the module.
const buildTurnContextStub: {
  priorFacts: unknown[];
  priorFactsReadOk: boolean;
  scenarioBriefText: string | null;
  scenarioAnalysisFactSet: ScenarioAnalysisFactSet | null;
} = {
  priorFacts: [],
  priorFactsReadOk: true,
  scenarioBriefText: null,
  scenarioAnalysisFactSet: null,
};

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {
        can_run_analysis: false,
        can_edit_graph: false,
        can_run_decision_review: false,
        can_generate_coaching: false,
        can_invoke_tools: false,
        can_commit_session_state: false,
      },
      messages: [{ role: 'user', content: 'Run the analysis' }],
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
      prior_facts: buildTurnContextStub.priorFacts,
      prior_facts_read_ok: buildTurnContextStub.priorFactsReadOk,
      scenario_analysis_fact_set:
        buildTurnContextStub.scenarioAnalysisFactSet ??
        completeScenarioAnalysisFactSet(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          buildTurnContextStub.priorFacts.filter(
            (fact): fact is HandlerFact =>
              typeof fact === 'object' &&
              fact !== null &&
              (fact as { fact_type?: unknown }).fact_type === 'run_analysis' &&
              (fact as { noop?: unknown }).noop === false,
          ),
          buildTurnContextStub.priorFacts,
        ),
      scenarioBriefText: buildTurnContextStub.scenarioBriefText,
      persistedGraph: null,
    })),
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
    createRegistry: createRegistryMock,
    getDefaultRegistry: () => new Map([['run_analysis', handlerFnMock]]),
    resolveHandler: (_registry: unknown, id: string) =>
      id === 'run_analysis' ? handlerFnMock : undefined,
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

// Minimal schema-valid graph so the snapshot pre-load path resolves.
const READY_GRAPH: GraphV3T = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
    { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
  ],
  edges: [
    { from: 'dec_launch', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_launch', to: 'opt_status_quo', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_launch', to: 'fac_marketing', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_status_quo', to: 'fac_marketing', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_marketing', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T;
const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH)!;
const CONTESTED_GRAPH = {
  ...READY_GRAPH,
  edges: READY_GRAPH.edges.map((edge, index) =>
    index === 0
      ? {
          ...edge,
          validation: {
            status: 'contested',
            contested_reasons: ['raw_magnitude'],
            max_divergence: 0.9,
          },
        }
      : edge,
  ),
} as unknown as GraphV3T;
const CONTESTED_GRAPH_HASH =
  computeAnalysisAffectingGraphHash(CONTESTED_GRAPH)!;

function snapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: READY_GRAPH,
    options: [
      { id: 'opt_launch', option_id: 'opt_launch', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
      { id: 'opt_status_quo', option_id: 'opt_status_quo', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
    ],
    goal_node_id: 'goal_revenue',
    rawPersistedGraph: READY_GRAPH,
  };
}

function runEnvelope(): Record<string, unknown> {
  return {
    analysis_status: 'completed',
    results: [
      { option_id: 'opt_launch', option_label: 'Launch now', win_probability: 0.62, factor_sensitivity: [] },
      { option_id: 'opt_status_quo', option_label: 'Status quo', win_probability: 0.38, factor_sensitivity: [] },
    ],
  };
}

function handlerOutcome() {
  return {
    assistant_text: 'Launch now came out ahead in 62% of runs of this model.',
    handler_facts: [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_launch',
          summary: 'Analysis ran with two options compared.',
          enrichment: runEnvelope(),
          graph_hash_at_run: READY_GRAPH_HASH,
          // ROADMAP 2.804 — now LOAD-BEARING. The coaching slot's leader-claim
          // permission comes from the fact chain, which fails CLOSED on a fact
          // with no verdict stamp (the pre-#710 population). An unstamped
          // fixture no longer models a current production turn: `run_analysis`
          // stamps every fact it writes. Exact shape of `projectClaimSafety`.
          constraint_verdict: {
            may_name_leading_option: true,
            constraint_verdict_state: 'not_applicable',
          },
        },
      },
    ],
    llm_calls_used: 0,
  };
}

function judgementHandlerOutcome() {
  return {
    assistant_text: 'Analysis completed.',
    handler_facts: [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_launch',
          summary: 'Analysis completed.',
          graph_hash_at_run: CONTESTED_GRAPH_HASH,
          enrichment: {
            analysis_status: 'completed',
            confidence_tier: 'strong',
          },
          constraint_verdict: {
            may_name_leading_option: true,
            constraint_verdict_state: 'not_applicable',
          },
        },
      },
    ],
    llm_calls_used: 0,
  };
}

function winnerEdgeAdjudicationFact(): HandlerFact {
  const edge = CONTESTED_GRAPH.edges[0]!;
  return {
    fact_type: 'edge_adjudication',
    fact_version: 1,
    noop: false,
    result: {
      from: edge.from,
      to: edge.to,
      edge_id: null,
      verdict: 'overridden',
      resolved_strength_mean: 0.4,
      provenance: 'user_set',
    },
  } as unknown as HandlerFact;
}

function responseActionLabels(response: {
  blocks: readonly unknown[];
}): readonly string[] {
  return response.blocks.flatMap((raw) => {
    const block = raw as Record<string, unknown>;
    return typeof block.action_label === 'string' ? [block.action_label] : [];
  });
}

function priorRunFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_launch',
      summary: 'prior run',
      enrichment: runEnvelope(),
      computed_at: '2026-07-15T00:00:00.000Z',
      graph_hash_at_run: 'hash-prior',
      // ROADMAP 2.804 — stamped for the same reason as the current-turn fact
      // above. This one matters twice over: it is the fact
      // `selectRunAnalysisFact` picks as the DISPLAYED analysis, and an
      // unstamped displayed analysis withholds the leader for the whole turn.
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'not_applicable',
      },
    },
  } as unknown as HandlerFact;
}

beforeEach(() => {
  vi.clearAllMocks();
  buildTurnContextStub.priorFacts = [];
  buildTurnContextStub.priorFactsReadOk = true;
  buildTurnContextStub.scenarioBriefText = null;
  buildTurnContextStub.scenarioAnalysisFactSet = null;
  loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshot());
  createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
  handlerFnMock.mockResolvedValue(handlerOutcome());
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

describe('chip-click run_analysis — STEP-5 coaching (ROADMAP 2.73 Fix A)', () => {
  it('FIRST chip run: FIRST_ANALYSIS_COMPLETE text joins assistant_text (was coaching: null hardcoded)', async () => {
    buildTurnContextStub.priorFacts = [];

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-first',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.response.assistant_text).toContain('first analysis');
  });

  it('chip RERUN: RERUN_ANALYSIS_COMPLETE text joins assistant_text and names the unchanged leader', async () => {
    buildTurnContextStub.priorFacts = [priorRunFact()];

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-rerun',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    // Same envelope both runs → unchanged leader copy from compareRuns.
    expect(out.response.assistant_text).toContain('unchanged');
    expect(out.response.assistant_text).toContain('Launch now still leads');
    // And the rerun turn must NOT claim to be the first analysis.
    expect(out.response.assistant_text).not.toContain('first analysis');
  });

  it("chip RERUN: complete durable history remains authoritative outside the hot window", async () => {
    buildTurnContextStub.priorFacts = [];
    buildTurnContextStub.scenarioAnalysisFactSet =
      completeScenarioAnalysisFactSet(
        SCENARIO_ID,
        [priorRunFact()],
        [],
      );

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: "req-cc-durable-rerun",
    });

    if (out.outcome !== "ok")
      throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.response.assistant_text).not.toContain("first analysis");
    expect(out.response.assistant_text).toContain("unchanged");
  });

  it.each(["capped", "degraded"] as const)(
    "chip coaching fails weak on %s history instead of trusting a hot analysis canary",
    async (status) => {
      const prior = priorRunFact();
      buildTurnContextStub.priorFacts = [prior];
      buildTurnContextStub.scenarioAnalysisFactSet =
        status === "capped"
          ? cappedScenarioAnalysisFactSet(SCENARIO_ID, prior)
          : degradedScenarioAnalysisFactSet(SCENARIO_ID);

      const out = await dispatchChipClickRunAnalysis({
        payload: payload(),
        requestId: `req-cc-${status}`,
      });

      if (out.outcome !== "ok")
        throw new Error(`expected ok, got ${out.outcome}`);
      expect(out.response.assistant_text).not.toContain("first analysis");
      expect(out.response.assistant_text).not.toMatch(/unchanged|re-run/i);
      const committed = commitDirectAnswerMock.mock.calls[0]![1] as {
        handler_facts: Array<{
          result: { enrichment?: Record<string, unknown> };
        }>;
      };
      expect(
        committed.handler_facts[0]!.result.enrichment?.coaching_signal_id
      ).toBeUndefined();
    }
  );

  it("chip RERUN: committed run_analysis fact carries the signal marker (cache-reader visibility)", async () => {
    buildTurnContextStub.priorFacts = [priorRunFact()];

    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-rerun-fact',
    });

    expect(commitDirectAnswerMock).toHaveBeenCalledTimes(1);
    const committed = commitDirectAnswerMock.mock.calls[0]![1] as {
      handler_facts: Array<{ result: { enrichment?: Record<string, unknown> } }>;
    };
    expect(committed.handler_facts[0]!.result.enrichment?.coaching_signal_id).toBe(
      'RERUN_ANALYSIS_COMPLETE',
    );
    expect(committed.handler_facts[0]!.result.enrichment?.coaching_signal_turn_id).toBe(
      'req-cc-rerun-fact',
    );
  });

  it('default-off chip run scrubs producer CEE attestations before commit', async () => {
    const priorAwaitFlag = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'false';
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
    try {
      const forgedOutcome = handlerOutcome();
      const fact = forgedOutcome.handler_facts[0] as {
        result: { enrichment: Record<string, unknown> };
      };
      fact.result.enrichment = {
        ...fact.result.enrichment,
        producer_canary: 'PLOT_FIELD_RETAINED',
        decision_review: {
          produced_at: '2026-08-27T09:00:00.000Z',
          narrative_summary: 'PRODUCER_REVIEW_MUST_NOT_PERSIST',
        },
        coaching_signal_id: 'RERUN_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'PRODUCER_SIGNAL_MUST_NOT_PERSIST',
        coaching_signal_produced_at: '2026-08-27T09:00:01.000Z',
      };
      handlerFnMock.mockResolvedValue(forgedOutcome);

      await dispatchChipClickRunAnalysis({
        payload: payload(),
        requestId: 'req-cc-producer-attestation',
      });

      expect(enrichRunAnalysisMock).not.toHaveBeenCalled();
      const committed = commitDirectAnswerMock.mock.calls[0]![1] as {
        handler_facts: Array<{
          result: { enrichment: Record<string, unknown> };
        }>;
      };
      const enrichment = committed.handler_facts[0]!.result.enrichment;
      expect(enrichment.producer_canary).toBe('PLOT_FIELD_RETAINED');
      expect(enrichment.decision_review).toBeUndefined();
      expect(enrichment.coaching_signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
      expect(enrichment.coaching_signal_turn_id).toBe(
        'req-cc-producer-attestation',
      );
      expect(JSON.stringify(enrichment)).not.toContain(
        'PRODUCER_SIGNAL_MUST_NOT_PERSIST',
      );
      expect(JSON.stringify(enrichment)).not.toContain(
        'PRODUCER_REVIEW_MUST_NOT_PERSIST',
      );
    } finally {
      if (priorAwaitFlag === undefined) {
        delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
      } else {
        process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = priorAwaitFlag;
      }
      _resetConfigCache();
    }
  });
});

describe('chip-click run_analysis — split lens and judgement authorities', () => {
  it('does not let a foreign hot run alter lens history when the scenario carrier is degraded', async () => {
    buildTurnContextStub.scenarioAnalysisFactSet =
      degradedScenarioAnalysisFactSet(SCENARIO_ID);
    buildTurnContextStub.priorFacts = [];
    const baseline = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-lens-baseline',
    });
    if (baseline.outcome !== 'ok') {
      throw new Error(`expected ok, got ${baseline.outcome}`);
    }

    const foreign = priorRunFact();
    foreign.result.scenario_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    buildTurnContextStub.priorFacts = [foreign];
    const withForeignHotRun = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-lens-foreign-hot',
    });
    if (withForeignHotRun.outcome !== 'ok') {
      throw new Error(`expected ok, got ${withForeignHotRun.outcome}`);
    }

    expect(baseline.response.blocks.length).toBeGreaterThan(0);
    expect(withForeignHotRun.response.blocks).toEqual(baseline.response.blocks);
  });

  it('uses readable mixed adjudication but does not turn a degraded hot read into disagreement', async () => {
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue({
      graph: CONTESTED_GRAPH,
      options: snapshot().options,
      goal_node_id: snapshot().goal_node_id,
      rawPersistedGraph: CONTESTED_GRAPH,
    });
    handlerFnMock.mockResolvedValue(judgementHandlerOutcome());
    buildTurnContextStub.scenarioAnalysisFactSet =
      degradedScenarioAnalysisFactSet(SCENARIO_ID);
    buildTurnContextStub.priorFacts = [winnerEdgeAdjudicationFact()];
    buildTurnContextStub.priorFactsReadOk = true;

    const readable = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-judgement-readable',
    });
    if (readable.outcome !== 'ok') {
      throw new Error(`expected ok, got ${readable.outcome}`);
    }
    expect(responseActionLabels(readable.response)).toContain(
      OVERRIDE_STRESS_TEST_ACTION_LABEL,
    );
    expect(responseActionLabels(readable.response)).not.toContain(
      DISAGREEMENT_ACTION_LABEL,
    );

    buildTurnContextStub.priorFacts = [];
    buildTurnContextStub.priorFactsReadOk = false;
    const degraded = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-judgement-degraded',
    });
    if (degraded.outcome !== 'ok') {
      throw new Error(`expected ok, got ${degraded.outcome}`);
    }
    expect(responseActionLabels(degraded.response)).not.toContain(
      DISAGREEMENT_ACTION_LABEL,
    );
    expect(responseActionLabels(degraded.response)).not.toContain(
      OVERRIDE_STRESS_TEST_ACTION_LABEL,
    );
  });
});

describe('chip-click run_analysis — decision_review observability (ROADMAP 2.73 Fix C)', () => {
  let priorAwaitFlag: string | undefined;
  let priorTraceFlag: string | undefined;

  beforeEach(async () => {
    priorAwaitFlag = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    priorTraceFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'true';
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });

  afterEach(async () => {
    if (priorAwaitFlag === undefined) delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    else process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = priorAwaitFlag;
    if (priorTraceFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = priorTraceFlag;
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });

  it('threads decision_review attribution into turnTimings when the enricher call RETURNS (#476 parity)', async () => {
    enrichRunAnalysisMock.mockImplementation(
      async ({
        handlerFacts,
        callTelemetrySink,
      }: {
        handlerFacts: unknown[];
        callTelemetrySink?: {
          model?: string;
          provider?: string;
          input_tokens?: number;
          output_tokens?: number;
        };
      }) => {
        if (callTelemetrySink) {
          callTelemetrySink.model = 'gpt-4.1';
          callTelemetrySink.provider = 'openai';
          callTelemetrySink.input_tokens = 1200;
          callTelemetrySink.output_tokens = 800;
        }
        return handlerFacts;
      },
    );

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-dr-telemetry',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.turnTimings).toBeDefined();
    expect(out.turnTimings!.decision_review_model).toBe('gpt-4.1');
    expect(out.turnTimings!.decision_review_provider).toBe('openai');
    expect(out.turnTimings!.decision_review_input_tokens).toBe(1200);
    expect(out.turnTimings!.decision_review_output_tokens).toBe(800);
    expect(typeof out.turnTimings!.decision_review_ms).toBe('number');
    // The sink must actually have been OFFERED to the enricher.
    const call = enrichRunAnalysisMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.callTelemetrySink).toBeDefined();
  });

  it('emits NO turnTimings when the enricher call never returned a result (no phantom attribution)', async () => {
    // Sink left unpopulated — models a skip / timeout inside the enricher.
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-dr-skip',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.turnTimings).toBeUndefined();
  });
});
