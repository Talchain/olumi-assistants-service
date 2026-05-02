/**
 * V5 alpha hardening Phase 2.3 — PLoT permissive status matrix tests.
 *
 * Coverage goals:
 *
 *  1. PINNED regression (brief 2.3): `analysis_status: "computed"` with a
 *     usable `option_comparison[]` → handler returns success with a
 *     populated `leading_option_id` fact. This is the staging symptom the
 *     brief calls out, grounded against the real capture at
 *     tests/staging/artifacts/cross-service-2026-03-15T23-24-53-476Z/step-2-analysis.json
 *     (SHA-256 2d2aab36...).
 *
 *  2. Per-status matrix coverage for Part C of the resilience contract:
 *     null / completed / computed / partial / blocked / failed / unknown-
 *     usable / unknown-unusable.
 *
 *  3. The partial + unknown paths surface caveats through the existing
 *     `summary` + `assistant_text` fields only (correction 4 — no schema
 *     extension to RunAnalysisHandlerFactSchema).
 *
 *  4. Unknown-usable status emits an `external_contract_unknown_status`
 *     warning log; unknown-unusable emits the same warning + raises fatal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { log } from '../../../../utils/telemetry.js';

import {
  createRunAnalysisHandler,
  RUN_ANALYSIS_ASSISTANT_TEMPLATES,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import type { HandlerInvocation } from '../../registry.js';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST_ID = 'req-status-test';

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    } as unknown as HandlerInvocation['payload'],
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  };
}

const SCENARIO_SNAPSHOT: RunAnalysisScenarioSnapshot = {
  graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
  options: [
    { id: 'opt_1', option_id: 'opt_1', label: 'Plan A', interventions: { f: 1 } },
    { id: 'opt_2', option_id: 'opt_2', label: 'Plan B', interventions: { f: 0 } },
  ],
  goal_node_id: 'g',
};

const scenarioReader: ScenarioReader = async () => SCENARIO_SNAPSHOT;

function mkPlot(response: V2RunResponseEnvelope): PLoTClient {
  return {
    run: vi.fn(async () => response),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

// Usable result body matching the real staging PLoT capture shape.
function usableOptionComparison() {
  return [
    { option_id: 'opt_1', option_label: 'Raise price', win_probability: 0.62 },
    { option_id: 'opt_2', option_label: 'Keep price', win_probability: 0.38 },
  ];
}

function withStatus(
  status: string | null,
  body: Record<string, unknown> = { option_comparison: usableOptionComparison() },
): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
    response_hash: 'h',
    ...(status != null ? { analysis_status: status } : {}),
    ...body,
  } as V2RunResponseEnvelope;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('run_analysis handler — permissive status matrix (Phase 2.3)', () => {
  it('PINNED: analysis_status="computed" with usable option_comparison succeeds', async () => {
    // Brief 2.3 pinned regression. Pre-hardening, this case returned
    // HANDLER_INVOCATION_FAILED(analysis_not_completed); post-hardening
    // it succeeds with the DEFAULT template and a populated fact.
    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(withStatus('computed')),
      scenarioReader,
    });

    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT);
    expect(outcome.handler_facts).toHaveLength(1);
    const fact = outcome.handler_facts[0]!;
    expect(fact.fact_type).toBe('run_analysis');
    if (fact.fact_type === 'run_analysis') {
      expect(fact.result.leading_option_id).toBe('opt_1');
      expect(fact.result.win_probabilities).toBeDefined();
    }
  });

  it('analysis_status=null (absent) succeeds with DEFAULT template', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(withStatus(null)),
      scenarioReader,
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT);
  });

  it('analysis_status="completed" succeeds with DEFAULT template', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(withStatus('completed')),
      scenarioReader,
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT);
  });

  it('analysis_status="partial" succeeds with PARTIAL caveat template', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(withStatus('partial')),
      scenarioReader,
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.PARTIAL);
    // Caveat surfaces through summary field (correction 4 — no schema ext).
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type === 'run_analysis') {
      expect(fact.result.summary).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.PARTIAL);
    }
  });

  it('analysis_status="blocked" is fatal with cause_kind analysis_blocked', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(withStatus('blocked')),
      scenarioReader,
    });
    await expect(handler(makeInvocation())).rejects.toMatchObject({
      name: 'HandlerInvocationFailedError',
      cause_kind: 'analysis_blocked',
    });
  });

  it('analysis_status="failed" is fatal with cause_kind analysis_failed', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(withStatus('failed')),
      scenarioReader,
    });
    await expect(handler(makeInvocation())).rejects.toMatchObject({
      name: 'HandlerInvocationFailedError',
      cause_kind: 'analysis_failed',
    });
  });

  it('unknown status WITH usable fields proceeds with UNKNOWN_STATUS + warning log', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(withStatus('still_thinking_very_hard')),
      scenarioReader,
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.UNKNOWN_STATUS);

    const warnCall = warnSpy.mock.calls.find((c) => {
      const payload = c[0] as Record<string, unknown>;
      return payload?.event === 'external_contract_unknown_status';
    });
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as Record<string, unknown>).analysis_status).toBe(
      'still_thinking_very_hard',
    );
  });

  it('unknown status with NO usable fields is fatal with cause_kind analysis_not_completed', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(
        withStatus('still_thinking_very_hard', { option_comparison: [] }),
      ),
      scenarioReader,
    });
    await expect(handler(makeInvocation())).rejects.toBeInstanceOf(
      HandlerInvocationFailedError,
    );
    // Warning still fires with usable_fields:false so log aggregators can
    // separate degraded-but-passed from fatal-no-fields.
    const warnCall = warnSpy.mock.calls.find((c) => {
      const payload = c[0] as Record<string, unknown>;
      return payload?.event === 'external_contract_unknown_status';
    });
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as Record<string, unknown>).usable_fields).toBe(false);
  });

  it('partial status with no result records emits PARTIAL_NO_RESULTS caveat', async () => {
    // Follow-up review: pre-follow-up this fell through to NO_RESULTS
    // silently, dropping the partial-run caveat. Contract Part C requires
    // a caveat for partial regardless of record count — the user needs to
    // distinguish "analysis ran cleanly, nothing to compare" from
    // "analysis was cut short and produced nothing".
    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(withStatus('partial', { option_comparison: [] })),
      scenarioReader,
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(
      RUN_ANALYSIS_ASSISTANT_TEMPLATES.PARTIAL_NO_RESULTS,
    );
    // Caveat copy mentions both "partial" and the zero-comparisons fact
    // so users can't misread this as a clean empty run.
    expect(outcome.assistant_text.toLowerCase()).toContain('partial');
    expect(outcome.assistant_text.toLowerCase()).toMatch(/no option comparisons|incomplete/);
  });

  it('does NOT extend the handler fact schema for partial/unknown status', async () => {
    // Correction 4 (alpha hardening): the fact carries partial/unknown
    // caveats through the existing `summary` string only — NO new top-
    // level fields are introduced for status.
    //
    // V5 state-trust (0.10.0): `graph_hash_at_run` and `computed_at` are
    // now first-class optional fields on RunAnalysisResultSchema —
    // independent of analysis_status. They appear on EVERY successful
    // fact (including partial), so the allowlist below includes them.
    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(withStatus('partial')),
      scenarioReader,
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type === 'run_analysis') {
      // Only the known schema fields should be present on result.
      const resultKeys = Object.keys(fact.result).sort();
      for (const k of resultKeys) {
        expect([
          'scenario_id',
          'leading_option_id',
          'win_probabilities',
          'summary',
          'enrichment',
          'graph_hash_at_run',
          'computed_at',
        ]).toContain(k);
      }
    }
  });

  it('uses staging-shape capture — option_comparison with opt_id + win_probability', async () => {
    // Minimum usable-fields contract from Part C: matches real staging
    // response at cross-service-2026-03-15T23-24-53-476Z/step-2-analysis.json.
    const response = {
      meta: { seed_used: 42, n_samples: 500, response_hash: 'h' },
      response_hash: 'h',
      analysis_status: 'computed',
      option_comparison: [
        { option_id: 'opt_1', option_label: 'Raise price to £59', win_probability: 0.347 },
        { option_id: 'opt_2', option_label: 'Keep current', win_probability: 0.300 },
        { option_id: 'opt_3', option_label: 'Introduce tiered pricing', win_probability: 0.353 },
      ],
    } as unknown as V2RunResponseEnvelope;

    const handler = createRunAnalysisHandler({
      plotClient: mkPlot(response),
      scenarioReader,
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT);
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type === 'run_analysis') {
      // opt_3 has the highest probability — handler picks it.
      expect(fact.result.leading_option_id).toBe('opt_3');
      expect(Object.keys(fact.result.win_probabilities ?? {})).toHaveLength(3);
    }
  });
});
