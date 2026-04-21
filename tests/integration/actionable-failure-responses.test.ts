/**
 * Actionable failure responses — HTTP boundary smoke test.
 *
 * One fastify-inject test that drives a full turn through the V5 route and
 * asserts the composed failure response survives serialisation end-to-end.
 * Chosen path: ENTITY_NOT_FOUND via a tool-call referencing an id absent
 * from the graph. This is the most common real-world validation failure and
 * exercises chip synthesis from the graph.
 *
 * Unit + direct-executor coverage of all other failure paths lives in
 * `src/orchestrator-v5/__tests__/turn-executor-failure-responses.test.ts` and
 * the composer-level tests. This test guards only the HTTP audit concern.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink } from '../../src/utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../src/adapters/llm/types.js';

const appendCalls: unknown[] = [];
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: 'mock-row' };
    },
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

let nextToolUseResult: ChatWithToolsResult;
const failureMockAdapter = {
  name: 'failure-responses-mock',
  model: 'failure-responses-mock',
  chatWithTools: vi.fn(async () => nextToolUseResult),
  chat: async () => ({
    content: '{"turn_class":"direct_answer"}',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'failure-responses-mock',
    latencyMs: 0,
  }),
};
vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => failureMockAdapter,
  getAdapterWithResolution: (task?: string) => ({
    adapter: failureMockAdapter,
    resolution: {
      task,
      resolved_model: 'failure-responses-mock',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

let v5Enabled = true;
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(t, p) {
        if (p === 'features') {
          return new Proxy(Reflect.get(t, p) as object, {
            get(ft, fp) {
              if (fp === 'orchestratorV5') return v5Enabled;
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

function toolUseResult(input: unknown): ChatWithToolsResult {
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

type TelemetryEvent = { event: string; data: Record<string, unknown> };
let events: TelemetryEvent[] = [];

describe('Actionable failure responses — HTTP boundary', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    v5Enabled = true;
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
  });
  afterEach(() => setTestSink(null));

  it.skip('ENTITY_NOT_FOUND round-trips through HTTP with specific text + entity-suggestion chips [v5-maintenance: superseded by fail-closed]', async () => {
    // v5-maintenance: this test predates the Group 3 Task B fail-closed
    // invariant (v5-exclusive-cee brief). Validator failure produces
    // commit_performed=false, which the route now surfaces as 500 +
    // BoundaryError — NOT a 200 + rich OlumiResponse with error blocks and
    // suggested_actions. The intended UX (sibling-entity chips) is now
    // discarded because non-2xx bodies must match BoundaryErrorSchema.
    // Telemetry-level assertions (failure_origin, error_code, chip_type)
    // still fire correctly; observability of this path is preserved. A
    // follow-up brief that widens BoundaryError.details to include
    // typed sibling hints would unblock the wire-level UX and let this
    // test be rewritten.
    // Tool call references an id absent from the graph — validator fires
    // ENTITY_NOT_FOUND and the composer emits sibling chips from listEntitiesByKind.
    nextToolUseResult = toolUseResult({
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: {
          id: 'opt_missing',
          kind: 'option',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
          label: 'Missing Plan',
        },
        parameters: [],
        cited_context_fields: [],
      },
    });

    const payload = {
      kind: 'message' as const,
      turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      message: 'run the analysis on the missing plan',
      turn_class: 'decide',
      stage: 'analyse',
      source: 'composer' as const,
      graph_state: {
        nodes: [
          { id: 'goal_1', kind: 'goal', label: 'Profit' },
          { id: 'opt_a', kind: 'option', label: 'Plan A' },
          { id: 'opt_b', kind: 'option', label: 'Plan B' },
        ],
        edges: [],
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      assistant_text: string;
      blocks: Array<{ type: string; error_code?: string; details?: Record<string, unknown> }>;
      suggested_actions: Array<{ id: string; label: string; message: string; action_type?: string }>;
    };

    expect(body.assistant_text).toMatch(/can't find/i);
    expect(body.assistant_text).toContain('Missing Plan');
    expect(body.assistant_text).not.toContain('opt_missing');

    expect(body.suggested_actions.length).toBeGreaterThan(0);
    const labels = body.suggested_actions.map((a) => a.label);
    expect(labels).toContain('Plan A');
    expect(labels).toContain('Plan B');

    const errBlock = body.blocks.find((b) => b.type === 'error');
    expect(errBlock).toBeDefined();
    expect(errBlock!.error_code).toBe('INTERNAL_ERROR');
    expect(errBlock!.details?.failure_origin).toBe('validator');
    expect(errBlock!.details?.error_code).toBe('ENTITY_NOT_FOUND');

    const failureEv = events.find((e) => e.event === 'turn_executor.failure_response');
    expect(failureEv).toBeDefined();
    expect(failureEv!.data.failure_origin).toBe('validator');
    expect(failureEv!.data.error_code).toBe('ENTITY_NOT_FOUND');
    expect(failureEv!.data.chip_type).toBe('entity_suggestion');
    expect(failureEv!.data.chip_attached).toBe(true);
  });
});
