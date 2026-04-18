/**
 * Slice C2 — run_analysis handler unit tests.
 *
 * Covers (per brief §3 D7 + Refinements R1, R2):
 *   - Happy path fact shape (all 5 required fields; enrichment byte-equality)
 *   - assistant_text allowlist (exact-match against the two locked templates)
 *   - llm_calls_used === 0
 *   - Error paths: PLoT 5xx, PLoT timeout, PLoT payload rejection, PLoT
 *     unknown, scenarioReader failure, args validation failure,
 *     non-completed analysis_status
 *   - R2 edge cases for leading_option_id (empty, single, tied, missing prob,
 *     all-zero, option_comparison fallback)
 *   - AbortSignal + budget propagation
 */

import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient, PLoTClientRunOpts } from '../../../../orchestrator/plot-client.js';
import { PLoTError, PLoTTimeoutError } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';

import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  HandlerInvocationFailedError,
  HandlerResultInvalidError,
  RUN_ANALYSIS_ASSISTANT_TEMPLATES,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import happyFixture from '../../../../../tests/fixtures/plot/v2-run-golden-happy.json' with { type: 'json' };
import minimalFixture from '../../../../../tests/fixtures/plot/v2-run-golden-minimal.json' with { type: 'json' };
import largerFixture from '../../../../../tests/fixtures/plot/v2-run-golden-larger.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

// scenario_id must be a valid UUID per RunAnalysisArgsSchema + ResultSchema.
const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-c2-test';

function makeScenarioSnapshot(overrides?: Partial<RunAnalysisScenarioSnapshot>): RunAnalysisScenarioSnapshot {
  return {
    graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { fac_price: 0.9 } },
    ],
    goal_node_id: 'g',
    ...overrides,
  };
}

function makeScenarioReader(snapshot?: RunAnalysisScenarioSnapshot): ScenarioReader {
  const returned = snapshot ?? makeScenarioSnapshot();
  return vi.fn<[string, AbortSignal | undefined], Promise<RunAnalysisScenarioSnapshot>>(
    () => Promise.resolve(returned),
  );
}

function makePlotClient(response: V2RunResponseEnvelope | (() => Promise<V2RunResponseEnvelope>)): PLoTClient {
  const run = vi.fn<[Record<string, unknown>, string, PLoTClientRunOpts | undefined], Promise<V2RunResponseEnvelope>>(
    () =>
      typeof response === 'function'
        ? response()
        : Promise.resolve(JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope),
  );
  const validatePatch = vi.fn().mockResolvedValue({});
  return { run, validatePatch } as unknown as PLoTClient;
}

function makeInvocation(overrides?: Partial<HandlerInvocation>): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: TEST_SCENARIO_ID,
      request_id: TEST_REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
    },
    payload: {
      turn_id: 't1',
      scenario_id: TEST_SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    },
    requestId: TEST_REQUEST_ID,
    signal: new AbortController().signal,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('run_analysis handler — happy path', () => {
  it('returns a HandlerOutcome with DEFAULT template, exactly one fact, zero LLM calls', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });

    const outcome = await handler(makeInvocation());

    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT);
    expect(outcome.handler_facts).toHaveLength(1);
    expect(outcome.llm_calls_used).toBe(0);
  });

  it('fact.result.scenario_id equals the payload scenario_id (identity copy, not from PLoT)', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });

    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.scenario_id).toBe(TEST_SCENARIO_ID);
  });

  it('fact.result.leading_option_id matches the max-probability option from results', async () => {
    // happy fixture has opt_a@0.62 and opt_b@0.38 → leader is opt_a
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.leading_option_id).toBe('opt_a');
  });

  it('fact.result.win_probabilities maps option_label → win_probability', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.win_probabilities).toEqual({ 'Option A': 0.62, 'Option B': 0.38 });
  });

  it('fact.result.enrichment equals the validated V2RunResponse byte-for-byte (Resolution 2)', async () => {
    const responseSnapshot = JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope;
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(responseSnapshot),
      scenarioReader: makeScenarioReader(),
    });

    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');

    // Deep equality — no projection, no stripping, no field reordering that
    // would change JSON.stringify byte output.
    expect(fact.result.enrichment).toEqual(responseSnapshot);
    expect(JSON.stringify(fact.result.enrichment)).toBe(JSON.stringify(responseSnapshot));
  });

  it('fact carries fact_type=run_analysis, fact_version=1, noop=false', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    expect(fact.fact_type).toBe('run_analysis');
    expect(fact.fact_version).toBe(1);
    expect(fact.noop).toBe(false);
  });

  it('fact.result.summary matches assistant_text (both from the same template)', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.summary).toBe(outcome.assistant_text);
  });
});

// ---------------------------------------------------------------------------
// assistant_text allowlist + forbidden patterns
// ---------------------------------------------------------------------------

describe('run_analysis handler — assistant_text ownership contract', () => {
  const allowedTemplates = Object.values(RUN_ANALYSIS_ASSISTANT_TEMPLATES);

  it('DEFAULT template matches the locked string exactly', () => {
    expect(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT).toBe('Ran analysis on your current scenario.');
  });

  it('NO_RESULTS template matches the locked string exactly', () => {
    expect(RUN_ANALYSIS_ASSISTANT_TEMPLATES.NO_RESULTS).toBe(
      'Ran analysis on your current scenario. No options were compared.',
    );
  });

  it('emitted assistant_text is exactly one of the two locked templates (allowlist)', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    expect(allowedTemplates).toContain(outcome.assistant_text);
  });

  it('assistant_text contains NO recommendation language', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).not.toMatch(
      /\b(you should|consider|we recommend|we suggest|try to)\b/i,
    );
  });

  it('assistant_text contains NO interpretive qualifiers', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).not.toMatch(
      /\b(highly|strongly|weakly|clearly) (suggests|indicates|confirms)\b/i,
    );
  });

  it('assistant_text contains NO numeric values from the result payload', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    // No percent-style numbers
    expect(outcome.assistant_text).not.toMatch(/\d+(\.\d+)?%/);
    // No decimal numbers
    expect(outcome.assistant_text).not.toMatch(/\d+\.\d+/);
  });

  it('NO_RESULTS template fires when results[] is empty AND status is completed', async () => {
    const emptyResponse: V2RunResponseEnvelope = {
      meta: { seed_used: 1, n_samples: 10, response_hash: 'empty' },
      results: [],
      response_hash: 'empty-top',
      analysis_status: 'completed',
    } as V2RunResponseEnvelope;
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(emptyResponse),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.NO_RESULTS);
  });
});

// ---------------------------------------------------------------------------
// R2 edge cases for leading_option_id
// ---------------------------------------------------------------------------

describe('run_analysis handler — leading_option_id deterministic rules (R2)', () => {
  async function invokeWithResults(results: unknown[]): Promise<string | null> {
    const response: V2RunResponseEnvelope = {
      meta: { seed_used: 1, n_samples: 10, response_hash: 'r2' },
      results,
      response_hash: 'r2-top',
      analysis_status: 'completed',
    } as V2RunResponseEnvelope;
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(response),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    return fact.result.leading_option_id;
  }

  it('empty results → null', async () => {
    expect(await invokeWithResults([])).toBeNull();
  });

  it('single result (any probability) → that option', async () => {
    expect(
      await invokeWithResults([{ option_id: 'only', option_label: 'Only', win_probability: 0.5 }]),
    ).toBe('only');
  });

  it('single result with zero probability → still that option (presence wins over magnitude)', async () => {
    expect(
      await invokeWithResults([{ option_id: 'only', option_label: 'Only', win_probability: 0 }]),
    ).toBe('only');
  });

  it('single result missing win_probability → still that option (single exempts magnitude check)', async () => {
    expect(await invokeWithResults([{ option_id: 'only', option_label: 'Only' }])).toBe('only');
  });

  it('multiple results, strictly one max → that option', async () => {
    expect(
      await invokeWithResults([
        { option_id: 'a', option_label: 'A', win_probability: 0.5 },
        { option_id: 'b', option_label: 'B', win_probability: 0.7 },
        { option_id: 'c', option_label: 'C', win_probability: 0.3 },
      ]),
    ).toBe('b');
  });

  it('multiple results tied at max → null (no interpretation)', async () => {
    expect(
      await invokeWithResults([
        { option_id: 'a', option_label: 'A', win_probability: 0.5 },
        { option_id: 'b', option_label: 'B', win_probability: 0.5 },
      ]),
    ).toBeNull();
  });

  it('all-zero probabilities across multiple options → null (tie at zero)', async () => {
    expect(
      await invokeWithResults([
        { option_id: 'a', option_label: 'A', win_probability: 0 },
        { option_id: 'b', option_label: 'B', win_probability: 0 },
      ]),
    ).toBeNull();
  });

  it('missing probability on any record → null (cannot compute)', async () => {
    expect(
      await invokeWithResults([
        { option_id: 'a', option_label: 'A', win_probability: 0.6 },
        { option_id: 'b', option_label: 'B' }, // no win_probability
      ]),
    ).toBeNull();
  });

  it('option_comparison[] fallback when results[] absent', async () => {
    const response: V2RunResponseEnvelope = {
      meta: { seed_used: 1, n_samples: 10, response_hash: 'oc' },
      results: [],
      option_comparison: [
        { option_id: 'oc_a', option_label: 'OC A', win_probability: 0.8 },
        { option_id: 'oc_b', option_label: 'OC B', win_probability: 0.2 },
      ],
      response_hash: 'oc-top',
      analysis_status: 'completed',
    } as unknown as V2RunResponseEnvelope;
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(response),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.leading_option_id).toBe('oc_a');
    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT);
  });

  it('record with only option_label (no option_id) uses the label as id', async () => {
    expect(
      await invokeWithResults([
        { option_label: 'Only Label', win_probability: 0.9 },
        { option_label: 'Runner-Up', win_probability: 0.1 },
      ]),
    ).toBe('Only Label');
  });
});

// ---------------------------------------------------------------------------
// win_probabilities extraction
// ---------------------------------------------------------------------------

describe('run_analysis handler — win_probabilities extraction', () => {
  it('keys map by option_label when present', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(Object.keys(fact.result.win_probabilities ?? {})).toEqual(['Option A', 'Option B']);
  });

  it('omits win_probabilities entirely when no usable entries exist', async () => {
    const response: V2RunResponseEnvelope = {
      meta: { seed_used: 1, n_samples: 10, response_hash: 'nw' },
      results: [{ /* no label/id, no prob */ }],
      response_hash: 'nw-top',
      analysis_status: 'completed',
    } as unknown as V2RunResponseEnvelope;
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(response),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.win_probabilities).toBeUndefined();
  });

  it('skips records with non-finite probability (NaN, Infinity)', async () => {
    const response: V2RunResponseEnvelope = {
      meta: { seed_used: 1, n_samples: 10, response_hash: 'nan' },
      results: [
        { option_label: 'A', win_probability: Number.NaN },
        { option_label: 'B', win_probability: 0.7 },
      ],
      response_hash: 'nan-top',
      analysis_status: 'completed',
    } as unknown as V2RunResponseEnvelope;
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(response),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.win_probabilities).toEqual({ B: 0.7 });
  });
});

// ---------------------------------------------------------------------------
// Error paths → HandlerInvocationFailedError
// ---------------------------------------------------------------------------

describe('run_analysis handler — PLoT invocation failure paths', () => {
  it('PLoTTimeoutError → HandlerInvocationFailedError with cause_kind=plot_timeout', async () => {
    const plotClient = makePlotClient(() =>
      Promise.reject(new PLoTTimeoutError('timed out')),
    );
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(),
    });

    await expect(handler(makeInvocation())).rejects.toMatchObject({
      name: 'HandlerInvocationFailedError',
      kind: 'HANDLER_INVOCATION_FAILED',
      cause_kind: 'plot_timeout',
    });
  });

  it('PLoTError (5xx) → HandlerInvocationFailedError with cause_kind=plot_error', async () => {
    const plotClient = makePlotClient(() =>
      Promise.reject(new PLoTError('503 Service Unavailable')),
    );
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(),
    });

    await expect(handler(makeInvocation())).rejects.toMatchObject({
      kind: 'HANDLER_INVOCATION_FAILED',
      cause_kind: 'plot_error',
    });
  });

  it('generic plain Error → HandlerInvocationFailedError with cause_kind=plot_unknown', async () => {
    const plotClient = makePlotClient(() => Promise.reject(new Error('mystery')));
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(),
    });

    await expect(handler(makeInvocation())).rejects.toMatchObject({
      kind: 'HANDLER_INVOCATION_FAILED',
      cause_kind: 'plot_unknown',
    });
  });

  it('payload-validator error (orchestratorError attached) → cause_kind=plot_payload_invalid', async () => {
    const plotClient = makePlotClient(() => {
      const err = Object.assign(new Error('bad payload'), {
        orchestratorError: {
          code: 'INTERNAL_PAYLOAD_ERROR',
          tool: 'run_analysis',
          message: 'missing goal_node_id',
          recoverable: false,
        },
      });
      return Promise.reject(err);
    });
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(),
    });

    await expect(handler(makeInvocation())).rejects.toMatchObject({
      kind: 'HANDLER_INVOCATION_FAILED',
      cause_kind: 'plot_payload_invalid',
    });
  });

  it('scenarioReader throws → cause_kind=scenario_read_failed', async () => {
    const scenarioReader: ScenarioReader = () => Promise.reject(new Error('supabase down'));
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader,
    });

    await expect(handler(makeInvocation())).rejects.toMatchObject({
      kind: 'HANDLER_INVOCATION_FAILED',
      cause_kind: 'scenario_read_failed',
    });
  });

  it('PLoT response with analysis_status=blocked → cause_kind=analysis_not_completed', async () => {
    const response: V2RunResponseEnvelope = {
      meta: { seed_used: 1, n_samples: 10, response_hash: 'b' },
      results: [],
      response_hash: 'b-top',
      analysis_status: 'blocked',
    } as V2RunResponseEnvelope;
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(response),
      scenarioReader: makeScenarioReader(),
    });

    await expect(handler(makeInvocation())).rejects.toMatchObject({
      kind: 'HANDLER_INVOCATION_FAILED',
      cause_kind: 'analysis_not_completed',
    });
  });

  it('PLoT response with analysis_status=failed → cause_kind=analysis_not_completed', async () => {
    const response: V2RunResponseEnvelope = {
      meta: { seed_used: 1, n_samples: 10, response_hash: 'f' },
      results: [],
      response_hash: 'f-top',
      analysis_status: 'failed',
    } as V2RunResponseEnvelope;
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(response),
      scenarioReader: makeScenarioReader(),
    });

    await expect(handler(makeInvocation())).rejects.toBeInstanceOf(HandlerInvocationFailedError);
  });

  it('PLoT response without analysis_status still treated as happy path (absent ≠ failed)', async () => {
    const response: V2RunResponseEnvelope = {
      meta: { seed_used: 1, n_samples: 10, response_hash: 'a' },
      results: [{ option_id: 'x', option_label: 'X', win_probability: 1.0 }],
      response_hash: 'a-top',
      // no analysis_status at all
    } as V2RunResponseEnvelope;
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(response),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT);
  });

  it('args validation failure (scenario_id non-string) → cause_kind=args_validation_failed', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    // Force an invalid payload by casting — OrchestratorTurnPayload schema
    // would reject non-string at the wire boundary; we're testing the
    // handler's defensive re-parse here.
    const invocation = makeInvocation({
      payload: {
        turn_id: 't1',
        scenario_id: 42 as unknown as string,
        message: 'x',
        turn_class: 'decide',
        stage: 'analyse',
      },
    });
    await expect(handler(invocation)).rejects.toMatchObject({
      kind: 'HANDLER_INVOCATION_FAILED',
      cause_kind: 'args_validation_failed',
    });
  });
});

// ---------------------------------------------------------------------------
// AbortSignal + budget propagation
// ---------------------------------------------------------------------------

describe('run_analysis handler — AbortSignal + budget propagation', () => {
  it('passes invocation.signal as turnSignal to PLoT client', async () => {
    const plotClient = makePlotClient(happyFixture as unknown as V2RunResponseEnvelope);
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(),
    });
    const externalController = new AbortController();
    await handler(makeInvocation({ signal: externalController.signal }));

    expect(plotClient.run).toHaveBeenCalledTimes(1);
    const opts = (plotClient.run as ReturnType<typeof vi.fn>).mock.calls[0]![2] as PLoTClientRunOpts;
    expect(opts.turnSignal).toBe(externalController.signal);
  });

  it('passes a turnBudgetMs to PLoT client (handler budget)', async () => {
    const plotClient = makePlotClient(happyFixture as unknown as V2RunResponseEnvelope);
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(),
    });
    await handler(makeInvocation());
    const opts = (plotClient.run as ReturnType<typeof vi.fn>).mock.calls[0]![2] as PLoTClientRunOpts;
    expect(typeof opts.turnBudgetMs).toBe('number');
    expect(opts.turnBudgetMs).toBeGreaterThan(0);
  });

  it('passes invocation.signal into the scenarioReader call', async () => {
    const reader = vi.fn<[string, AbortSignal | undefined], Promise<RunAnalysisScenarioSnapshot>>(
      () => Promise.resolve(makeScenarioSnapshot()),
    );
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: reader,
    });
    const externalController = new AbortController();
    await handler(makeInvocation({ signal: externalController.signal }));
    expect(reader).toHaveBeenCalledWith(TEST_SCENARIO_ID, externalController.signal);
  });
});

// ---------------------------------------------------------------------------
// PLoT payload construction
// ---------------------------------------------------------------------------

describe('run_analysis handler — PLoT payload construction', () => {
  it('includes graph, options, goal_node_id, request_id — the PLoT-required fields', async () => {
    const plotClient = makePlotClient(happyFixture as unknown as V2RunResponseEnvelope);
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(),
    });
    await handler(makeInvocation());
    const payload = (plotClient.run as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(payload.graph).toBeDefined();
    expect(Array.isArray(payload.options)).toBe(true);
    expect(payload.goal_node_id).toBe('g');
    expect(payload.request_id).toBe(TEST_REQUEST_ID);
  });

  it('forwards seed when scenario snapshot carries one', async () => {
    const plotClient = makePlotClient(happyFixture as unknown as V2RunResponseEnvelope);
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(makeScenarioSnapshot({ seed: 7 })),
    });
    await handler(makeInvocation());
    const payload = (plotClient.run as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(payload.seed).toBe(7);
  });

  it('omits seed when scenario snapshot does NOT carry one', async () => {
    const plotClient = makePlotClient(happyFixture as unknown as V2RunResponseEnvelope);
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(),
    });
    await handler(makeInvocation());
    const payload = (plotClient.run as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(payload.seed).toBeUndefined();
  });

  it('forwards n_samples and goal_constraints when present on the snapshot', async () => {
    const plotClient = makePlotClient(happyFixture as unknown as V2RunResponseEnvelope);
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(
        makeScenarioSnapshot({ n_samples: 2000, goal_constraints: { threshold: 0.5 } }),
      ),
    });
    await handler(makeInvocation());
    const payload = (plotClient.run as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(payload.n_samples).toBe(2000);
    expect(payload.goal_constraints).toEqual({ threshold: 0.5 });
  });
});

// ---------------------------------------------------------------------------
// Fixture coverage (R5 — multiple golden shapes)
// ---------------------------------------------------------------------------

describe('run_analysis handler — golden fixture coverage (R5)', () => {
  it('minimal fixture (1 option) produces a valid fact with that option as leader', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(minimalFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.leading_option_id).toBe('opt_only');
    expect(outcome.assistant_text).toBe(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT);
  });

  it('larger fixture (3 options) selects the top-prob option deterministically', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(largerFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.leading_option_id).toBe('opt_alpha');
    expect(Object.keys(fact.result.win_probabilities ?? {})).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('larger fixture enrichment preserves decision_brief, fact_objects, and factor_sensitivity', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(largerFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    const enrichment = fact.result.enrichment as Record<string, unknown>;
    expect(enrichment.decision_brief).toBeDefined();
    expect(Array.isArray(enrichment.fact_objects)).toBe(true);
    expect(Array.isArray(enrichment.factor_sensitivity)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema enforcement (HandlerResultInvalidError is defensible)
// ---------------------------------------------------------------------------

describe('run_analysis handler — HandlerResultInvalidError is defined and carries the kind tag', () => {
  it('HandlerInvocationFailedError is a proper Error subclass with kind=HANDLER_INVOCATION_FAILED', () => {
    const err = new HandlerInvocationFailedError('x', { cause_kind: 'plot_unknown' });
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe('HANDLER_INVOCATION_FAILED');
    expect(err.name).toBe('HandlerInvocationFailedError');
  });

  it('HandlerResultInvalidError is a proper Error subclass with kind=HANDLER_RESULT_INVALID', () => {
    const err = new HandlerResultInvalidError('x');
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe('HANDLER_RESULT_INVALID');
    expect(err.name).toBe('HandlerResultInvalidError');
  });
});

// ---------------------------------------------------------------------------
// Handler does not mutate invocation context / payload
// ---------------------------------------------------------------------------

describe('run_analysis handler — immutability of invocation inputs', () => {
  it('does not mutate the passed HandlerInvocation object', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const invocation = makeInvocation();
    const before = JSON.stringify({
      context: invocation.context,
      payload: invocation.payload,
      requestId: invocation.requestId,
    });
    await handler(invocation);
    const after = JSON.stringify({
      context: invocation.context,
      payload: invocation.payload,
      requestId: invocation.requestId,
    });
    expect(after).toBe(before);
  });
});
