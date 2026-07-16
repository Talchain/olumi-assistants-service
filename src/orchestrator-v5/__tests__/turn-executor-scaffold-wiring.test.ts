/**
 * D-ask-1 (2.11 P0-1) — M4: LIVE WIRING of `__scaffolded_options` on the
 * ROUTED execute path (turn-executor).
 *
 * End-to-end through the REAL pipeline: real registry, REAL run_analysis
 * handler (the scaffold mechanism actually fires on a mixed-state
 * snapshot), real executor threading, real generateChips, real
 * validation-registry egress. Only the LLM routing adapter, PLoT client,
 * scenario reader, session store, and (for the P1-2 pin) the
 * decision-review enricher are mocked.
 *
 * Mutation target (M4, routed path): delete either
 * `handlerOutcome.__scaffolded_options` spread in turn-executor.ts (the
 * generateChips input or the enricher input) → the corresponding test
 * here goes RED. The chip-generator- and enricher-level suites stay green
 * under that mutation — this file is what makes the threading observable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import { _resetConfigCache } from '../../config/index.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { ScaffoldedOptionRecord } from '../coaching/scaffold-disclosure.js';

// Session store mock (mirrors turn-executor-handler.test.ts).
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
}));

// P1-2 routed-call-site pin: mock ONLY the enricher (everything else in the
// coaching module stays real) so the test can observe the argument the
// executor threads.
const { enrichMock } = vi.hoisted(() => ({ enrichMock: vi.fn() }));
vi.mock('../coaching/decision-review-enricher.js', async () => {
  const actual = await vi.importActual<
    typeof import('../coaching/decision-review-enricher.js')
  >('../coaching/decision-review-enricher.js');
  return { ...actual, enrichRunAnalysisWithDecisionReview: enrichMock };
});

import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import type { RunAnalysisScenarioSnapshot } from '../tools/handlers/run-analysis.js';

const { runTurnExecutor } = await import('../turn-executor.js');
const { createRegistry } = await import('../tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AWAIT_DR_ENV = 'V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW';

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: TEST_SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

const RUN_ANALYSIS_TOOL_CALL_INPUT = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'opt_a',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: ['graph.options'],
  },
};

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: input as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function makeGoldenResponse(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
    results: [
      { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.6 },
      { option_id: 'opt_new', option_label: 'New Option', win_probability: 0.4 },
    ],
    response_hash: 'h-top',
    analysis_status: 'completed',
  } as V2RunResponseEnvelope;
}

/**
 * MIXED-STATE snapshot: opt_a configured, opt_new (added via chat, never
 * configured) empty. fac_m carries observed_state.value so the REAL
 * scaffold finds neutral provenance; opt_new is edge-connected to fac_m.
 */
function makeScaffoldingSnapshot(): RunAnalysisScenarioSnapshot {
  const graph = {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Goal' },
      { id: 'fac_m', kind: 'factor', label: 'Marketing', observed_state: { value: 0.4 } },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      { id: 'opt_new', kind: 'option', label: 'New Option' },
    ],
    edges: [
      { from: 'opt_new', to: 'fac_m' },
      { from: 'opt_a', to: 'fac_m' },
      { from: 'fac_m', to: 'g' },
    ],
  };
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_m: 1 } },
      { id: 'opt_new', option_id: 'opt_new', label: 'New Option', interventions: {} },
    ],
    goal_node_id: 'g',
    rawPersistedGraph: graph,
  };
}

function makeMockPlotClient(): PLoTClient {
  return {
    run: vi.fn(async () => makeGoldenResponse()),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

function mockRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<
        (
          args: ChatWithToolsArgs,
          opts: { requestId: string },
        ) => Promise<ChatWithToolsResult>
      >()
      .mockImplementation(async () => mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT)),
  };
}

beforeEach(() => {
  setTestSink(() => {});
  enrichMock.mockImplementation(
    async ({ handlerFacts }: { handlerFacts: readonly unknown[] }) => handlerFacts,
  );
});

afterEach(() => {
  setTestSink(null);
  delete process.env[AWAIT_DR_ENV];
  _resetConfigCache();
  vi.clearAllMocks();
});

describe('turn-executor — D-ask-1 scaffold live wiring (M4, routed execute path)', () => {
  it('a scaffolded run offers the CONFIGURE chip FIRST and the disclosure survives to assistant_text (real handler, real chips, real egress)', async () => {
    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => makeScaffoldingSnapshot(),
    });

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-scaffold-routed', {
      routingAdapter: mockRoutingAdapter(),
      handlerRegistry: registry,
    });

    expect(telemetry.failure_type).toBeNull();
    // The REAL handler scaffolded opt_new → the REAL executor threading →
    // the REAL chip generator puts the configure chip first.
    const chips = response.suggested_actions ?? [];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0]).toMatchObject({
      id: 'chip_prompt_configure_option',
      label: 'Configure New Option',
      message: 'Help me configure New Option.',
    });
    // Disclosure end-to-end: composed through the registry forwarder (the
    // egress allowlist), not silently replaced by the locked template.
    expect(response.assistant_text).toMatch(/Placeholder values were used for 'New Option'/);
    expect(response.assistant_text).toMatch(/the whole comparison is illustrative/);
  });

  it('threads scaffoldedOptions into the decision_review enricher input (P1-2, routed call site)', async () => {
    process.env[AWAIT_DR_ENV] = 'true';
    _resetConfigCache();

    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => makeScaffoldingSnapshot(),
    });

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-scaffold-routed-dr', {
      routingAdapter: mockRoutingAdapter(),
      handlerRegistry: registry,
    });

    expect(telemetry.failure_type).toBeNull();
    expect(enrichMock).toHaveBeenCalledTimes(1);
    const enricherInput = enrichMock.mock.calls[0][0] as {
      scaffoldedOptions?: readonly ScaffoldedOptionRecord[];
    };
    expect(enricherInput.scaffoldedOptions).toBeDefined();
    expect(enricherInput.scaffoldedOptions).toEqual([
      {
        option_id: 'opt_new',
        label: 'New Option',
        factor_ids: ['fac_m'],
        value_defaulted: true,
      },
    ]);
  });

  it('non-scaffolded run (all options configured): no configure chip, no scaffoldedOptions on the enricher input', async () => {
    process.env[AWAIT_DR_ENV] = 'true';
    _resetConfigCache();

    const snapshot = makeScaffoldingSnapshot();
    const configured = {
      ...snapshot,
      options: [
        { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_m: 1 } },
        { id: 'opt_new', option_id: 'opt_new', label: 'New Option', interventions: { fac_m: 0.5 } },
      ],
    };
    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => configured,
    });

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-no-scaffold-routed', {
      routingAdapter: mockRoutingAdapter(),
      handlerRegistry: registry,
    });

    expect(telemetry.failure_type).toBeNull();
    expect(
      (response.suggested_actions ?? []).some((c) => c.id === 'chip_prompt_configure_option'),
    ).toBe(false);
    expect(response.assistant_text).not.toMatch(/Placeholder values/);
    expect(enrichMock).toHaveBeenCalledTimes(1);
    expect('scaffoldedOptions' in (enrichMock.mock.calls[0][0] as object)).toBe(false);
  });
});
