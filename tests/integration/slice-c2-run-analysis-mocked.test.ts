/**
 * Slice C2 — integration Suite B (mocked PLoT against golden fixtures).
 *
 * Always runs (no Supabase/PLoT env dependency). Isolates C2 handler logic
 * from staging PLoT availability: if Suite A (real-staging, in CI) fails
 * while Suite B passes, the issue is infrastructure not C2 code. The
 * brief's halt condition "mocked-passes-but-real-fails split" is detected
 * by comparing Suite A + Suite B CI results.
 *
 * This suite exercises the V5 TurnExecutor end-to-end through the real
 * run_analysis handler with mocked PLoTClient + stub scenarioReader + stub
 * session store. Proves: handler fact shape, enrichment byte-for-byte,
 * template allowlist, BI-01 preservation, commit persistence of
 * handler_facts across the three golden fixture variants.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import happyFixture from '../fixtures/plot/v2-run-golden-happy.json' with { type: 'json' };
import minimalFixture from '../fixtures/plot/v2-run-golden-minimal.json' with { type: 'json' };
import largerFixture from '../fixtures/plot/v2-run-golden-larger.json' with { type: 'json' };

import { setTestSink } from '../../src/utils/telemetry.js';

// Phase mock — classifier emits handler; narrate must never fire.
const phaseState = {
  classify: { output: '{"turn_class":"handler","handler_id":"run_analysis"}' },
};

const c2MockAdapter = {
  name: 'test-mock',
  model: 'test-mock',
  chat: async (args: { responseFormat?: string }) => {
    const isClassify = args.responseFormat === 'json_object';
    return {
      content: isClassify ? phaseState.classify.output : 'narrate MUST NOT run',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'test-mock',
      latencyMs: 0,
    };
  },
  // V5 Phase 1: tool-use routing path emits a handler-class tool call.
  chatWithTools: async () => ({
    content: [
      {
        type: 'tool_use' as const,
        id: 'tu-1',
        name: 'olumi_action',
        input: {
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
        },
      },
    ],
    stop_reason: 'tool_use' as const,
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'test-mock',
    latencyMs: 0,
  }),
};
vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => c2MockAdapter,
  getAdapterWithResolution: (task?: string) => ({
    adapter: c2MockAdapter,
    resolution: {
      task,
      resolved_model: 'test-mock',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'You are a test narrator.',
}));

const appendCalls: Array<Record<string, unknown>> = [];
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({
      scope,
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
}));

import type { PLoTClient } from '../../src/orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../src/orchestrator/types.js';
import type {
  RunAnalysisScenarioSnapshot,
  ScenarioReader,
} from '../../src/orchestrator-v5/tools/handlers/run-analysis.js';

interface RegistryDeps {
  plotClient: PLoTClient;
  scenarioReader: ScenarioReader;
}
let registryDeps: RegistryDeps | null = null;

vi.mock('../../src/orchestrator-v5/tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/orchestrator-v5/tools/registry.js')>(
    '../../src/orchestrator-v5/tools/registry.js',
  );
  return {
    ...actual,
    getDefaultRegistry: () => {
      if (!registryDeps) {
        throw new Error('registryDeps unset — configure in beforeEach');
      }
      return actual.createRegistry(registryDeps);
    },
  };
});

const { runTurnExecutor } = await import('../../src/orchestrator-v5/turn-executor.js');

// Helpers
function makeSnapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { f: 1 } },
    ],
    goal_node_id: 'g',
  };
}

function makeMockPlot(response: V2RunResponseEnvelope): PLoTClient {
  return {
    run: vi.fn(async () => JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  scenario_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
};

// Telemetry sink
type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];
function installSink(): void {
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
}
function uninstallSink(): void {
  setTestSink(null);
}

beforeEach(() => {
  appendCalls.length = 0;
  registryDeps = null;
  events = [];
  installSink();
});
afterEach(() => {
  uninstallSink();
  registryDeps = null;
});

// -----------------------------------------------------------------------
// Suite B — proof points #1 (classification) + #2 (PLoT exercised) + #3
// (facts persist) — ALL via mocks. Real-staging counterpart is Suite A.
// -----------------------------------------------------------------------

describe('Slice C2 integration — Suite B (mocked PLoT, golden fixtures)', () => {
  it('proof point #1 + #2 + #3 via happy fixture: classifier routes to handler, handler invokes PLoT, fact persists', async () => {
    registryDeps = {
      plotClient: makeMockPlot(happyFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: async () => makeSnapshot(),
    };

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-suite-b-happy');

    OlumiResponseSchema.parse(response);

    // Proof #1: classifier routed to handler
    expect(telemetry.turn_class).toBe('handler');

    // Proof #2: PLoT was invoked (via mocked client)
    expect(registryDeps.plotClient.run).toHaveBeenCalledTimes(1);

    // Proof #3: commit called with a run_analysis fact
    expect(appendCalls).toHaveLength(1);
    const write = appendCalls[0]!;
    expect(write.handler_id).toBe('run_analysis');
    expect((write.handler_facts as unknown[]).length).toBe(1);
    const fact = (write.handler_facts as Array<Record<string, unknown>>)[0]!;
    expect(fact.fact_type).toBe('run_analysis');

    // v5-maintenance: the V5 Group 1 Task C coaching signal detector may
    // append a FIRST_ANALYSIS_COMPLETE coaching line after the template
    // text. Assert the template prefix rather than verbatim equality.
    expect(response.assistant_text.startsWith('Ran analysis on your current scenario.')).toBe(true);
    expect(telemetry.response_emitted).toBe(true);
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.llm_calls_used).toBe(1); // classifier only
    expect(telemetry.commit_performed).toBe(true);
  });

  it('minimal fixture: single-option response produces valid fact with that option as leader', async () => {
    registryDeps = {
      plotClient: makeMockPlot(minimalFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: async () => makeSnapshot(),
    };

    await runTurnExecutor(BASE_PAYLOAD, 'req-suite-b-minimal');

    const write = appendCalls[0]!;
    const fact = (write.handler_facts as Array<Record<string, unknown>>)[0] as {
      result: Record<string, unknown>;
    };
    expect(fact.result.leading_option_id).toBe('opt_only');
  });

  it('larger fixture: enrichment preserves decision_brief + fact_objects + factor_sensitivity byte-for-byte', async () => {
    registryDeps = {
      plotClient: makeMockPlot(largerFixture as unknown as V2RunResponseEnvelope),
      scenarioReader: async () => makeSnapshot(),
    };

    await runTurnExecutor(BASE_PAYLOAD, 'req-suite-b-larger');

    const write = appendCalls[0]!;
    const fact = (write.handler_facts as Array<Record<string, unknown>>)[0] as {
      result: { enrichment: Record<string, unknown> };
    };
    // v5-maintenance: strip V5 Group 1 Task C coaching-signal fields
    // before byte-for-byte comparison. The regression guard (PLoT
    // envelope → enrichment passthrough) is preserved; only the test's
    // expected shape needed to account for coaching metadata.
    const {
      coaching_signal_id,
      coaching_signal_turn_id,
      coaching_signal_produced_at,
      ...enrichmentWithoutCoaching
    } = fact.result.enrichment;
    void coaching_signal_id; // eslint-disable-line @typescript-eslint/no-unused-vars
    void coaching_signal_turn_id;
    void coaching_signal_produced_at;
    expect(enrichmentWithoutCoaching).toEqual(largerFixture);
    expect(fact.result.enrichment.decision_brief).toBeDefined();
    expect(Array.isArray(fact.result.enrichment.fact_objects)).toBe(true);
    expect(Array.isArray(fact.result.enrichment.factor_sensitivity)).toBe(true);
  });

  it('BI-01 holds on handler failure path (PLoT rejection)', async () => {
    const { PLoTError } = await import('../../src/orchestrator/plot-client.js');
    registryDeps = {
      plotClient: {
        run: vi.fn(async () => {
          throw new PLoTError('simulated 503');
        }),
        validatePatch: vi.fn().mockResolvedValue({}),
      } as unknown as PLoTClient,
      scenarioReader: async () => makeSnapshot(),
    };

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-suite-b-fail');

    // BI-01: response_emitted=true on failure
    expect(telemetry.response_emitted).toBe(true);
    OlumiResponseSchema.parse(response);
    expect(telemetry.commit_performed).toBe(false);
    expect(appendCalls).toHaveLength(0);
  });
});
