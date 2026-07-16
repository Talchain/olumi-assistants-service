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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestSink } from '../../../../utils/telemetry.js';
import { z } from 'zod';
import * as talchainSchemas from '@talchain/schemas/orchestrator';

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
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

// scenario_id must be a valid UUID per RunAnalysisArgsSchema + ResultSchema.
const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-c2-test';

function makeScenarioSnapshot(overrides?: Partial<RunAnalysisScenarioSnapshot>): RunAnalysisScenarioSnapshot {
  const graph = overrides?.graph ?? { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { fac_price: 0.9 } },
    ],
    goal_node_id: 'g',
    // V5 state-trust: production snapshots populate rawPersistedGraph with
    // the pre-parse JSON. Tests don't have a separate raw form, so we
    // mirror `graph` here — the hash function reads only the projected
    // analysis-affecting fields, so using the V3-shape graph as both is
    // hash-equivalent in fixtures (real Supabase reads have richer
    // top-level options/goal_node_id; tests inject those via the snapshot
    // directly when needed).
    rawPersistedGraph: graph,
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
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      turn_id: 't1',
      scenario_id: TEST_SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    }),
    requestId: TEST_REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('run_analysis handler — happy path', () => {
  it('returns a HandlerOutcome with a deterministic headline, exactly one fact, zero LLM calls', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });

    const outcome = await handler(makeInvocation());

    // Headline derived from happy fixture: leader = Option A, margin 24pp to
    // the runner-up, top driver = Price (highest |elasticity| × confidence).
    // No fragility resolvable (no from_label/to_label/from_node_id/to_node_id
    // on the lone fragile edge, no graph nodes to map against), so the
    // driver-with-margin shape (Case B) fires.
    expect(outcome.assistant_text).toBe(
      'Option A currently leads by 24 percentage points because Price is the strongest driver.',
    );
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.summary).toBe(outcome.assistant_text);  // card/chat parity
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
// Seam item 3 — SAMPLES_REDUCED_FOR_COMPLEXITY disclosure (CRITIQUE_BUCKETS
// ruling): the reduced-samples fact must reach the user on BOTH prose paths.
// ---------------------------------------------------------------------------

describe('run_analysis handler — reduced-samples disclosure', () => {
  const REDUCED_SUFFIX =
    ' Because this model is complex, the analysis ran fewer simulations than usual, so results may be less precise.';

  it('headline path: inference_warnings code appends the disclosure suffix', async () => {
    const fixture = {
      ...(JSON.parse(JSON.stringify(happyFixture)) as Record<string, unknown>),
      inference_warnings: [{ code: 'SAMPLES_REDUCED_FOR_COMPLEXITY' }],
    };
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(fixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(
      `Option A currently leads by 24 percentage points because Price is the strongest driver.${REDUCED_SUFFIX}`,
    );
  });

  it('template path: headline-ineligible results select the REDUCED_SAMPLES locked template', async () => {
    // No option_label anywhere → resolveWinner rejects the id-shaped label →
    // headline null → template path. Status absent + records present → the
    // DEFAULT template, which the disclosure replaces.
    const fixture = {
      results: [
        { option_id: 'opt_a', win_probability: 0.62 },
        { option_id: 'opt_b', win_probability: 0.38 },
      ],
      meta: { response_hash: 'hash-reduced-1' },
      inference_warnings: [{ code: 'SAMPLES_REDUCED_FOR_COMPLEXITY' }],
    };
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(fixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(
      'Ran analysis on your current scenario. Because this model is complex, the analysis ran fewer simulations than usual, so results may be less precise.',
    );
  });

  it('no warning code → prose unchanged (default posture)', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toBe(
      'Option A currently leads by 24 percentage points because Price is the strongest driver.',
    );
  });
});

// ---------------------------------------------------------------------------
// V5 state-trust freshness fields (schema 0.10.0+)
//
// graph_hash_at_run + computed_at must land on every successful run_analysis
// fact so future turns can derive freshness deterministically. The fields
// live on result alongside enrichment — NOT inside it — to keep the
// handler-ownership invariant intact.
// ---------------------------------------------------------------------------

describe('run_analysis handler — freshness fields on the fact', () => {
  it('records graph_hash_at_run computed from snapshot.graph (analysis-affecting hash)', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(
        makeScenarioSnapshot({
          graph: {
            nodes: [
              { id: 'g', kind: 'goal', label: 'Goal' },
              { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 100 } },
            ],
            edges: [],
          },
        }),
      ),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.graph_hash_at_run).toMatch(/^[0-9a-f]{16}$/);
  });

  it('records computed_at as an ISO timestamp', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    const computedAt = fact.result.computed_at;
    expect(computedAt).toBeDefined();
    expect(() => new Date(computedAt!).toISOString()).not.toThrow();
    expect(new Date(computedAt!).toISOString()).toBe(computedAt);
  });

  it('value-only edit on the snapshot graph produces a different graph_hash_at_run', async () => {
    const baseSnapshot = makeScenarioSnapshot({
      graph: {
        nodes: [
          { id: 'g', kind: 'goal', label: 'Goal' },
          { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 100 } },
        ],
        edges: [],
      },
    });
    const editedSnapshot = makeScenarioSnapshot({
      graph: {
        nodes: [
          { id: 'g', kind: 'goal', label: 'Goal' },
          { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 200 } },
        ],
        edges: [],
      },
    });

    const baseHandler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(baseSnapshot),
    });
    const editedHandler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(editedSnapshot),
    });

    const baseOutcome = await baseHandler(makeInvocation());
    const editedOutcome = await editedHandler(makeInvocation());
    const baseFact = baseOutcome.handler_facts[0]!;
    const editedFact = editedOutcome.handler_facts[0]!;
    if (baseFact.fact_type !== 'run_analysis' || editedFact.fact_type !== 'run_analysis') {
      throw new Error('wrong fact_type');
    }
    expect(baseFact.result.graph_hash_at_run).toBeDefined();
    expect(editedFact.result.graph_hash_at_run).toBeDefined();
    expect(baseFact.result.graph_hash_at_run).not.toBe(editedFact.result.graph_hash_at_run);
  });

  it('graph_hash_at_run IS recorded when rawPersistedGraph carries top-level options (Ingress shape)', async () => {
    // V5 state-trust: the hash reads from the persisted graph parsed
    // via GraphStateIngressSchema, which preserves top-level `options`
    // / `goal_node_id`. A persisted JSON shaped like Supabase reads —
    // empty nodes/edges plus top-level options — still produces a
    // non-null hash because options are analysis-affecting.
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(
        makeScenarioSnapshot({
          graph: { nodes: [], edges: [] },
          rawPersistedGraph: {
            nodes: [],
            edges: [],
            options: [
              { id: 'opt_a', status: 'ready', interventions: { fac_price: { value: 1.2 } } },
            ],
            goal_node_id: 'g',
          },
        }),
      ),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.graph_hash_at_run).toMatch(/^[0-9a-f]{16}$/);
  });

  it('freshness fields live on result alongside enrichment, NOT inside it', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    // CEE-owned freshness fields are top-level on result
    expect(fact.result.graph_hash_at_run).toBeDefined();
    expect(fact.result.computed_at).toBeDefined();
    // enrichment is the byte-for-byte PLoT response — must NOT contain CEE
    // freshness fields inside it
    const enrichment = fact.result.enrichment ?? {};
    expect(enrichment).not.toHaveProperty('graph_hash_at_run');
    expect(enrichment).not.toHaveProperty('computed_at');
    expect(enrichment).not.toHaveProperty('_cee_meta');
  });
});

// ---------------------------------------------------------------------------
// assistant_text allowlist + forbidden patterns
// ---------------------------------------------------------------------------

describe('run_analysis handler — assistant_text ownership contract', () => {
  const allowedTemplates: readonly string[] = Object.values(RUN_ANALYSIS_ASSISTANT_TEMPLATES);
  const HEADLINE_SHAPE = / currently leads\b/;

  it('DEFAULT template matches the locked string exactly', () => {
    expect(RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT).toBe('Ran analysis on your current scenario.');
  });

  it('NO_RESULTS template matches the locked string exactly', () => {
    expect(RUN_ANALYSIS_ASSISTANT_TEMPLATES.NO_RESULTS).toBe(
      'Ran analysis on your current scenario. No options were compared.',
    );
  });

  it('emitted assistant_text is deterministic — either a locked template or the headline shape', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    const text = outcome.assistant_text;
    const isTemplate = allowedTemplates.includes(text);
    const isHeadline = HEADLINE_SHAPE.test(text);
    expect(isTemplate || isHeadline).toBe(true);
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

  it('assistant_text contains NO raw decimal numbers from the result payload', async () => {
    // V5 deterministic headline (2026-05-28): integer percentages are
    // permitted in the Case D headline ("X currently leads with 62%
    // probability ..."). Raw decimals (e.g. "0.62", "0.123") remain
    // forbidden — that was the load-bearing invariant. The happy fixture
    // hits Case B (driver-only) and emits no numerals at all, so this
    // assertion is still tight for the canonical golden path.
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
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
    // option_comparison shape yields a Case D headline (winner + probability,
    // no driver/fragility data in this synthetic fixture).
    expect(outcome.assistant_text).toContain('OC A currently leads');
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

  it('PLoT response with analysis_status=blocked → cause_kind=analysis_blocked', async () => {
    // V5 alpha hardening Phase 2.3: the cause_kind for blocked/failed is
    // now specific (analysis_blocked vs analysis_failed) rather than a
    // blanket analysis_not_completed. Permissive status matrix lives in
    // Docs/v5/v5-resilience-contract.md Part C.
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
      cause_kind: 'analysis_blocked',
    });
  });

  it('PLoT response with analysis_status=failed → cause_kind=analysis_failed', async () => {
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
    // Single option at 100% → Case D headline (winner + probability).
    expect(outcome.assistant_text).toBe(
      'X currently leads with 100% probability. Run the follow-up checks before treating this as final.',
    );
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
      payload: makeMessagePayload({
        turn_id: 't1',
        scenario_id: 42 as unknown as string,
        message: 'x',
        turn_class: 'decide',
        stage: 'analyse',
      }),
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
    // #343: the reader now also receives the adopt-on-empty candidate
    // (invocation.graphForTurn) — undefined here because this invocation
    // carried none, pinning that absence stays absence.
    expect(reader).toHaveBeenCalledWith(TEST_SCENARIO_ID, externalController.signal, undefined);
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
    // Minimal fixture has a single option at 1.0 → Case D headline.
    expect(outcome.assistant_text).toContain('currently leads with 100% probability');
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
// HandlerResultInvalidError reachability via schema-spy seam
//
// The handler's deterministic extraction logic structurally prevents a
// malformed fact from being constructed under normal conditions (all five
// required RunAnalysisResult fields are extracted with types that satisfy
// the strict schema). To exercise the catch branch AND prove the
// turn-executor mapping (HANDLER_RESULT_INVALID → INTERNAL_ERROR wire
// code with details.reason='fact_schema_violation'), we force the schema's
// safeParse to return { success: false } via `vi.spyOn`. This is the
// minimum test surface that proves:
//   1. The handler distinguishes result-invalid from invocation-failed
//   2. Zod parse failure surfaces as HandlerResultInvalidError, not the
//      generic UNHANDLED path
//   3. The cause chain is preserved (cause = the ZodError)
// Without this seam, the path would be an unreachable assertion in the
// evidence pack — a promise the code makes but the test cannot verify.
// ---------------------------------------------------------------------------

describe('run_analysis handler — HandlerResultInvalidError path via schema-spy', () => {
  it('forced Zod safeParse failure → handler throws HandlerResultInvalidError with the ZodError preserved', async () => {
    const forcedIssues: z.ZodIssue[] = [
      {
        code: 'custom',
        path: ['result', 'summary'],
        message: 'forced schema violation for test coverage',
      },
    ];
    const forcedError = new z.ZodError(forcedIssues);
    const spy = vi
      .spyOn(talchainSchemas.RunAnalysisHandlerFactSchema, 'safeParse')
      .mockReturnValue({ success: false, error: forcedError });

    try {
      const handler = createRunAnalysisHandler({
        plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
        scenarioReader: makeScenarioReader(),
      });

      let caught: unknown;
      try {
        await handler(makeInvocation());
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(HandlerResultInvalidError);
      const e = caught as HandlerResultInvalidError;
      expect(e.kind).toBe('HANDLER_RESULT_INVALID');
      expect(e.name).toBe('HandlerResultInvalidError');
      // The ZodError is preserved on the `cause` chain so observability
      // can surface the specific schema violation without log parsing.
      expect((e as { cause?: unknown }).cause).toBe(forcedError);
      // Spy observed the failure before the throw.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('handler did NOT call scenarioReader or plotClient twice despite fact failure (no retry / no double-invoke)', async () => {
    const forcedError = new z.ZodError([
      { code: 'custom', path: [], message: 'forced' },
    ]);
    const spy = vi
      .spyOn(talchainSchemas.RunAnalysisHandlerFactSchema, 'safeParse')
      .mockReturnValue({ success: false, error: forcedError });

    const plotClient = makePlotClient(happyFixture as unknown as V2RunResponseEnvelope);
    const scenarioReader = vi.fn<[string, AbortSignal | undefined], Promise<RunAnalysisScenarioSnapshot>>(
      () => Promise.resolve(makeScenarioSnapshot()),
    );

    try {
      const handler = createRunAnalysisHandler({ plotClient, scenarioReader });
      await expect(handler(makeInvocation())).rejects.toBeInstanceOf(HandlerResultInvalidError);
      expect(plotClient.run).toHaveBeenCalledTimes(1);
      expect(scenarioReader).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
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

// ---------------------------------------------------------------------------
// Phase 2 workstream E — numeric integrity guard (NaN/Infinity rejection)
// ---------------------------------------------------------------------------

describe('run_analysis handler — numeric integrity guard', () => {
  type Event = { event: string; data: Record<string, unknown> };
  let events: Event[] = [];

  beforeEach(() => {
    events = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });
  afterEach(() => {
    setTestSink(null);
  });

  function findInvalidNumericEvent(): Event | undefined {
    return events.find((e) => e.event === 'v5.plot_response.invalid_numeric');
  }

  /**
   * Inject a non-finite value into a clone of the happy fixture and assert
   * the handler rejects via HandlerInvocationFailedError + telemetry.
   *
   * NB: cloning via JSON.parse(JSON.stringify(...)) silently coerces NaN /
   * Infinity to null. The trick: clone first (the fixture has only finite
   * values, so the clone is faithful), then mutate the cloned object to
   * inject the non-finite value into a real reference. Pass via the
   * function form of `makePlotClient` to bypass its own JSON deep-clone.
   */
  async function assertRejected(
    mutate: (envelope: Record<string, unknown>) => string /* expected field_path */,
    expectedRepr: 'NaN' | 'Infinity' | '-Infinity',
  ): Promise<void> {
    const envelope = JSON.parse(JSON.stringify(happyFixture)) as Record<string, unknown>;
    const expectedPath = mutate(envelope);
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(() =>
        Promise.resolve(envelope as unknown as V2RunResponseEnvelope),
      ),
      scenarioReader: makeScenarioReader(),
    });

    await expect(handler(makeInvocation())).rejects.toMatchObject({
      kind: 'HANDLER_INVOCATION_FAILED',
      cause_kind: 'analysis_failed',
      details: {
        handler_id: 'run_analysis',
        specific_issue: 'invalid_numeric',
        invalid_field: expectedPath,
        invalid_value_repr: expectedRepr,
      },
    });

    const ev = findInvalidNumericEvent();
    expect(ev).toBeDefined();
    expect(ev!.data).toMatchObject({
      field_path: expectedPath,
      value_repr: expectedRepr,
    });
  }

  it('rejects NaN in results[*].win_probability', async () => {
    await assertRejected((env) => {
      const results = env.results as Array<Record<string, unknown>>;
      results[0].win_probability = Number.NaN;
      return 'results[0].win_probability';
    }, 'NaN');
  });

  it('rejects Infinity in factor_sensitivity[*].elasticity', async () => {
    await assertRejected((env) => {
      const fs = env.factor_sensitivity as Array<Record<string, unknown>>;
      fs[0].elasticity = Number.POSITIVE_INFINITY;
      return 'factor_sensitivity[0].elasticity';
    }, 'Infinity');
  });

  it('rejects -Infinity in robustness.recommendation_stability', async () => {
    await assertRejected((env) => {
      const rob = env.robustness as Record<string, unknown>;
      rob.recommendation_stability = Number.NEGATIVE_INFINITY;
      return 'robustness.recommendation_stability';
    }, '-Infinity');
  });

  it('rejects NaN in option outcome p10', async () => {
    await assertRejected((env) => {
      const results = env.results as Array<Record<string, unknown>>;
      const first = results[0];
      // Inject the outcome shape if not present in this fixture
      const outcome = (first.outcome as Record<string, unknown> | undefined) ?? {};
      outcome.p10 = Number.NaN;
      first.outcome = outcome;
      return 'results[0].outcome.p10';
    }, 'NaN');
  });

  it('passes the happy fixture unchanged (no false positives)', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toContain('Option A currently leads');
    expect(findInvalidNumericEvent()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Area D — no verbatim duplication of the run_analysis headline
// ---------------------------------------------------------------------------
//
// FINDING (reported to the DGAI lane): the visible "same headline in both the
// chat bubble and the result block" duplication observed on staging is DGAI
// rendering-side. CEE emits the run_analysis headline on the wire ONLY via
// `assistant_text`; the matching `fact.result.summary` is an INTERNAL persisted
// fact (DB context / "card-chat parity"), not a wire block, and no emitted wire
// block (analysis_ready, phase3) carries the headline text.
//
// This regression locks the CEE side so it cannot drift into verbatim
// duplication, WITHOUT banning future structured analysis/result blocks — it
// only forbids re-emitting THIS headline string verbatim outside the two
// sanctioned carriers (assistant_text + the persisted fact summary).

describe('run_analysis headline — no verbatim wire-block duplication (Area D)', () => {
  it('headline lives in assistant_text + the internal persisted fact only; the handler emits no block carrying it verbatim', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClient(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: makeScenarioReader(),
    });
    const outcome = await handler(makeInvocation());

    const headline = outcome.assistant_text;
    expect(headline.length).toBeGreaterThan(0);

    // Sanctioned carrier #1: assistant_text (chat). Sanctioned carrier #2: the
    // internal persisted run_analysis fact summary (intentional parity, NOT a
    // wire block).
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.summary).toBe(headline);

    // The handler emits NO wire blocks (blocks are assembled downstream); it
    // therefore cannot duplicate the headline into an emitted block.
    expect(Object.keys(outcome)).not.toContain('blocks');

    // Future-proof: after removing the two sanctioned carriers, the headline
    // string must appear NOWHERE ELSE in the outcome. If a future change pipes
    // the summary into another (block-bound) field, this fails. It does not ban
    // blocks — only verbatim re-emission of this headline.
    const stripped = JSON.parse(JSON.stringify(outcome)) as {
      assistant_text?: unknown;
      handler_facts?: Array<{ result?: { summary?: unknown } }>;
    };
    delete stripped.assistant_text;
    const strippedResult = stripped.handler_facts?.[0]?.result;
    if (strippedResult) delete strippedResult.summary;
    expect(JSON.stringify(stripped)).not.toContain(headline);
  });
});
