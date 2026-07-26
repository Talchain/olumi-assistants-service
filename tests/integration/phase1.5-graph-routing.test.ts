/**
 * Phase 1.5 — Graph-threaded routing end-to-end (D6 Suite 1).
 *
 * MUST-PASS (plan D6 addition): at least one test here hits the real V5 HTTP
 * route via fastify inject with the UI fixture payload — exercising
 * parseRequestExtensions, the seven-step executor, the populated ContextPack,
 * and the routing log together. Remaining tests use direct runTurnExecutor
 * calls for narrower assertions.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setTestSink } from '../../src/utils/telemetry.js';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type { RoutingLog } from '../../src/orchestrator-v5/routing/routing-log.js';
import type {
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../src/adapters/llm/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'golden', 'ui-turn-with-graph.json'), 'utf8'),
) as Record<string, unknown>;

// Session store stub — no Supabase.
//
// Built from `createMockSessionStore()` (tests/utils/mock-session-store.ts)
// rather than a hand-rolled literal. The literal that used to sit here
// implemented five of the interface's methods, so it silently lacked
// `ensureScenarioExists` — the V5 pre-flight's ownership oracle. That gap was
// invisible only because production carried a `typeof store.ensureScenarioExists
// !== 'function'` skip branch, i.e. a partial test double was shaping a
// fail-open on the security path. The branch is gone; completeness comes from
// the helper, which is typed `Required<SessionStore>` and so goes RED in one
// place when the interface grows a method (derive, don't mirror).
//
// `importOriginal` is spread because a bare factory REPLACES the module:
// without it, real exports the code under test imports from this module
// (`SessionReadError`, `StateCommitFailedError`) would vanish.
const appendCalls: unknown[] = [];
vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: async (write: unknown) => {
          appendCalls.push(write);
          return { id: 'mock-row' };
        },
      }),
    resetSessionStoreForTests: () => {},
  };
});

// Mock getAdapter so route-level integration tests don't hit a live provider.
// The mock exposes chatWithTools — the seam routeWithToolUse uses.
let nextToolUseResult: ChatWithToolsResult;
const p15MockAdapter = {
  name: 'p1.5-test-mock',
  model: 'p1.5-test-mock',
  chatWithTools: vi.fn(async () => nextToolUseResult),
  // `chat` stub for any path that still needs it.
  chat: async () => ({
    content: '{"turn_class":"direct_answer"}',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'p1.5-test-mock',
    latencyMs: 0,
  }),
};
vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => p15MockAdapter,
  // Group 3 Task C: routeWithToolUse resolves via getAdapterWithResolution.
  getAdapterWithResolution: (task?: string) => ({
    adapter: p15MockAdapter,
    resolution: {
      task,
      resolved_model: 'p1.5-test-mock',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

// Feature flag proxy — enable V5 route for these tests.
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(t, p) {
        if (p === 'features') {
          return new Proxy(Reflect.get(t, p) as object, {
            get(ft, fp) {
              return Reflect.get(ft, fp);
            },
          });
        }
        return Reflect.get(t, p);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../src/orchestrator-v5/routing/tool-schema.js');

function toolUseResult(input: unknown, orientationText?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (orientationText) content.push({ type: 'text', text: orientationText });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function textResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

type TelemetryEvent = { event: string; data: Record<string, unknown> };
let events: TelemetryEvent[] = [];

describe('Phase 1.5 — HTTP E2E with real UI fixture', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    events = [];
    appendCalls.length = 0;
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
    // Default to text_only so the route finishes cleanly; individual tests
    // override for tool_use proposals.
    nextToolUseResult = textResult('The model shows 9 factors driving profit.');
  });
  afterEach(() => setTestSink(null));

  it('real UI fixture → 200 + graph_state parsed + boundary events emitted', async () => {
    // The UI fixture uses BFF-style field names (client_turn_id,
    // conversation_history). The V5 HTTP boundary expects B1 fields
    // (turn_id, turn_class, stage). We construct a B1-valid payload that
    // carries the EXACT graph_state from the UI fixture — which is what
    // this test is really exercising end-to-end.
    const payload = {
      kind: 'message' as const,
      turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      message: UI_FIXTURE.message as string,
      turn_class: 'frame',
      stage: 'frame',
      source: 'composer' as const,
      graph_state: UI_FIXTURE.graph_state,
    };

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload,
    });

    expect(res.statusCode).toBe(200);
    // Two boundary.validation events fire on success: B1 base ingress + V5-ext.
    // Egress adds a third.
    const boundaryEvents = events.filter((e) => e.event === 'boundary.validation');
    expect(boundaryEvents.length).toBeGreaterThanOrEqual(3);
    const extIngress = boundaryEvents.find(
      (e) => e.data.validator === 'V5RequestExtensions' && e.data.direction === 'ingress',
    );
    expect(extIngress).toBeDefined();
    expect(extIngress!.data.pass).toBe(true);
    expect(extIngress!.data.graph_present).toBe(true);
    expect(extIngress!.data.analysis_present).toBe(false);
  });

  it('malformed graph_state → 422 boundary error, route never invokes executor', async () => {
    const payload = {
      kind: 'message' as const,
      turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      message: 'bad graph',
      turn_class: 'frame',
      stage: 'frame',
      source: 'composer' as const,
      graph_state: {
        nodes: [{ label: 'no id or kind' }],
        edges: [],
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload,
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(body.validator).toBe('V5RequestExtensions');
    expect(body.details.field).toBe('graph_state');
    // Executor must not run when the ingress boundary fails.
    expect(events.find((e) => e.event === 'turn_executor.started')).toBeUndefined();
  });

  it('Imp-1 MUST-PASS: execute/run_analysis turn with UNMODIFIED real UI fixture reaches handler (no synthetic options)', async () => {
    // Regression guard for the P0-1 bug: a prior precondition revision
    // required graph_state.options[].status==='ready', which the real UI
    // never sends. This test proves the precondition no longer over-reaches
    // on the actual wire shape. The turn routes as execute/run_analysis,
    // validator PASSES, and control reaches the handler (which is absent in
    // this setup → UNHANDLED, which is the signal the validator let it
    // through).
    const payload = {
      kind: 'message' as const,
      turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      message: UI_FIXTURE.message as string,
      turn_class: 'frame',
      stage: 'frame',
      source: 'composer' as const,
      // EXACT fixture graph_state — no synthetic options, no status fields.
      graph_state: UI_FIXTURE.graph_state,
    };
    // Route LLM to an execute/run_analysis proposal targeting one of the
    // option nodes that the fixture actually carries.
    nextToolUseResult = toolUseResult(
      {
        intent_class: 'execute',
        action: {
          handler_id: 'run_analysis',
          entity: {
            id: 'opt_1',
            kind: 'option',
            resolution_status: 'resolved',
            resolution_method: 'id_match',
            label: 'Expand East',
          },
          parameters: [],
          cited_context_fields: ['graph.options'],
        },
      },
      'Running analysis...',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload,
    });

    // The turn now completes 200 with a recoverable "nothing to analyse yet"
    // recovery response. It previously asserted 500, and the 500 was an
    // ARTEFACT OF THE INCOMPLETE STORE DOUBLE above, not product behaviour:
    // the hand-rolled literal implemented five SessionStore methods, so the
    // handler's scenario read hit `store.loadGraph is not a function`,
    // commit_performed went false, and the route surfaced a 500. With the
    // complete double the handler reaches its real precondition
    // (`analysis_not_ready`) and returns the recovery chip — which is what
    // production does. The old comment's claim that "status 200 is
    // unreachable from this setup" was true only of the broken double.
    //
    // The test's purpose is unchanged and is now pinned MORE tightly, on
    // signals that are non-vacuous at 200 (`validator_outcome` /
    // `handler_proposed` are always emitted, and both carry a real value
    // here — the previous `body.details?.reason` checks would have degraded
    // to `undefined !== 'no_options_defined'`, i.e. passing by testing
    // nothing, the moment the status stopped being 500).
    expect(res.statusCode).toBe(200);
    const completed = events.find((e) => e.event === 'turn_executor.completed');
    expect(completed).toBeDefined();
    const stages = completed!.data.stages_completed as string[];
    // Regression guards: prove the precondition did NOT misfire on the
    // real wire. A prior precondition revision required canonical options[]
    // on graph_state, which the real UI doesn't carry — under that bug this
    // turn would have been rejected at validate with PRECONDITION_UNMET.
    expect(stages).toContain('validate');
    // Control reached handler routing on the unmodified real-UI graph_state.
    expect(completed!.data.handler_proposed).toBe('run_analysis');
    // The validator PASSED — the direct statement of "no over-reach", and the
    // assertion the old `not.toBe('no_options_defined')` was reaching for.
    // Under the P0-1 bug this would read as a validator rejection.
    expect(completed!.data.validator_outcome).toBe('valid');
    // Whatever failed, failed AFTER validate: the recovery response is the
    // handler's own precondition answer, so `validate` is in stages_completed
    // and the turn was not rejected before it.
    expect(stages.indexOf('validate')).toBeGreaterThanOrEqual(0);
  });

  it('text_only turn with graph_state — validate stage skipped entirely', async () => {
    const payload = {
      kind: 'message' as const,
      turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      message: UI_FIXTURE.message as string,
      turn_class: 'frame',
      stage: 'frame',
      source: 'composer' as const,
      graph_state: UI_FIXTURE.graph_state,
    };
    nextToolUseResult = textResult('The model shows 9 factors driving profit.');

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload,
    });

    expect(res.statusCode).toBe(200);
    const completed = events.find((e) => e.event === 'turn_executor.completed');
    const stages = completed!.data.stages_completed as string[];
    // Text-only turns skip validate entirely — these stages must all be absent.
    expect(stages).not.toContain('validate_skipped_graph_checks');
    expect(stages).not.toContain('validate_skipped_no_graph');
  });
});

const { runTurnExecutor } = await import('../../src/orchestrator-v5/turn-executor.js');
const { createRegistry } = await import('../../src/orchestrator-v5/tools/registry.js');

describe('Phase 1.5 — direct runTurnExecutor with graph and real fixture graph', () => {
  beforeEach(() => {
    events = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });
  afterEach(() => setTestSink(null));

  it('populated ContextPack.graph.counts > 0 + routing log carries graph_node_count + graph_hash', async () => {
    const routingAdapter = {
      chatWithTools: vi.fn(async () =>
        toolUseResult(
          {
            intent_class: 'execute',
            action: {
              handler_id: 'run_analysis',
              entity: {
                id: 'opt_1',
                kind: 'option',
                resolution_status: 'resolved',
                resolution_method: 'id_match',
              },
              parameters: [],
              cited_context_fields: ['graph.options'],
            },
          },
          'Running analysis on your scenario...',
        ),
      ),
    };

    const plotClient = {
      run: vi.fn(async () => ({
        meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
        results: [
          { option_id: 'opt_1', option_label: 'Expand East', win_probability: 0.7 },
          { option_id: 'opt_2', option_label: 'Expand West', win_probability: 0.3 },
        ],
        response_hash: 'top',
        analysis_status: 'completed',
      })),
      validatePatch: vi.fn().mockResolvedValue({}),
    } as never;

    const scenarioReader = async () => ({
      graph: (UI_FIXTURE.graph_state as { nodes: unknown[]; edges: unknown[] }),
      options: [
        { id: 'opt_1', option_id: 'opt_1', label: 'Expand East', status: 'ready', interventions: { fac_1: { value: 1 } } },
      ],
      goal_node_id: 'goal_1',
    });

    const registry = createRegistry({ plotClient, scenarioReader });
    const logs: RoutingLog[] = [];

    const payload: OrchestratorTurnPayload = {
      kind: 'message' as const,
      turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      message: 'analyse',
      turn_class: 'decide',
      stage: 'analyse',
      source: 'composer' as const,
    };

    // The fixture's graph_state has 13 nodes + 16 edges, and an option node.
    // We add an options[] array on graph_state so the precondition passes.
    const graphState = {
      ...(UI_FIXTURE.graph_state as Record<string, unknown>),
      options: [
        { id: 'opt_1', status: 'ready', interventions: { fac_1: { value: 0.8, source: 'user_specified' } } },
      ],
    };

    const { telemetry } = await runTurnExecutor(payload, 'req-p15-int-1', {
      routingAdapter,
      handlerRegistry: registry,
      graphState: graphState as never,
      routingLogWriter: async (r) => {
        logs.push(r);
      },
    });

    expect(telemetry.stages_completed).toContain('validate');
    expect(telemetry.stages_completed).not.toContain('validate_skipped_no_graph');
    expect(telemetry.stages_completed).not.toContain('validate_skipped_graph_checks');
    expect(telemetry.failure_type).toBeNull();

    await new Promise((r) => setImmediate(r));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.graph_node_count).toBe(13);
    expect(logs[0]!.graph_edge_count).toBe(16);
    expect(logs[0]!.graph_hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
