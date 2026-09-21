/**
 * ROADMAP 1.42 — reasoning capture threading (turn-executor integration).
 *
 * Proves runTurnExecutor surfaces the routing call's captured VERBATIM
 * reasoning on `TurnExecutorRunResult.reasoning` AND that the captured text
 * never contaminates `response.assistant_text` — the two surfaces are
 * threaded via completely independent variables (`capturedReasoning` vs
 * `response`), consistent with the #385 signature-leak guard rails.
 *
 * Flag enforcement note: `CEE_REASONING_CAPTURE_ENABLED` is enforced at TWO
 * points, neither of which is turn-executor itself:
 *   1. the real Anthropic adapter (anthropic.ts) — only captures `reasoning`
 *      onto `ChatWithToolsResult` when the flag is on;
 *   2. route-v2.ts's `_reasoning` wire re-attach — re-checks the flag before
 *      exposing anything to the client.
 * Turn-executor purely threads whatever `rawResult.reasoning` the adapter
 * (real or mocked) produced — this file's flag toggling therefore only
 * matters insofar as it exercises the `_resetConfigCache` reset pattern
 * consistently with the rest of the suite; the wire-level flag gate is
 * covered separately in route-v2 tests (test (d) in the ROADMAP 1.42 plan).
 *
 * Harness mirrors turn-executor-frame-threading.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

const mockState = vi.hoisted(() => ({
  priorTurns: [] as Array<Record<string, unknown>>,
}));

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scenario_id: SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

const PROPOSAL_RUN_ANALYSIS = {
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
    cited_context_fields: [],
  },
};

const GRAPH_WITH_OPTIONS: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } },
    { id: 'opt_b', status: 'ready', interventions: { f1: { value: 0 } } },
  ],
} as GraphStateIngress;

function runAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran the analysis on your scenario.',
      computed_at: '2026-04-30T01:00:00.000Z',
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_a: 0.62, opt_b: 0.38 },
    },
  } as HandlerFact;
}

function makeSuccessRegistry(): HandlerRegistry {
  const handler: HandlerFn = async () => ({
    assistant_text: 'Ran the analysis on your scenario.',
    handler_facts: [runAnalysisFact()],
    llm_calls_used: 0,
  });
  return new Map([['run_analysis', handler]]);
}

const REASONING_TEXT =
  'Internal chain-of-thought weighing option A against option B — must never reach assistant_text.';

function mkToolUseResultWithReasoning(
  input: unknown,
  textBefore: string,
  reasoning?: string,
): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [{ type: 'text', text: textBefore }];
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
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

function mockRoutingAdapter(
  impl: (
    args: ChatWithToolsArgs,
    opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
  ) => Promise<ChatWithToolsResult>,
) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

let priorFlag: string | undefined;

async function setReasoningCaptureFlag(value: 'true' | undefined) {
  priorFlag = process.env.CEE_REASONING_CAPTURE_ENABLED;
  if (value === undefined) {
    delete process.env.CEE_REASONING_CAPTURE_ENABLED;
  } else {
    process.env.CEE_REASONING_CAPTURE_ENABLED = value;
  }
  const { _resetConfigCache } = await import('../../config/index.js');
  _resetConfigCache();
}

async function restoreReasoningCaptureFlag() {
  if (priorFlag === undefined) {
    delete process.env.CEE_REASONING_CAPTURE_ENABLED;
  } else {
    process.env.CEE_REASONING_CAPTURE_ENABLED = priorFlag;
  }
  const { _resetConfigCache } = await import('../../config/index.js');
  _resetConfigCache();
}

describe('TurnExecutor — reasoning capture threading (ROADMAP 1.42)', () => {
  beforeEach(() => {
    setTestSink(() => {});
    mockState.priorTurns = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('flag ON: run.reasoning is surfaced AND assistant_text does NOT contain the reasoning text', async () => {
    await setReasoningCaptureFlag('true');
    try {
      const result = await runTurnExecutor(BASE_PAYLOAD, 'req-reasoning-exec', {
        routingAdapter: mockRoutingAdapter(async () =>
          mkToolUseResultWithReasoning(PROPOSAL_RUN_ANALYSIS, 'Routing…', REASONING_TEXT),
        ),
        handlerRegistry: makeSuccessRegistry(),
        graphState: GRAPH_WITH_OPTIONS,
      });

      expect(result.telemetry.commit_performed).toBe(true);
      // Reasoning is surfaced on the run result, verbatim.
      expect(result.reasoning).toBe(REASONING_TEXT);
      // The composed user-facing prose (handler text + orientation text +
      // any post-analysis composition) never contains the reasoning text —
      // the two surfaces are threaded via completely independent variables
      // (`capturedReasoning` vs `response`), never concatenated.
      expect(result.response.assistant_text).not.toContain(REASONING_TEXT);
      expect(result.response.assistant_text.length).toBeGreaterThan(0);
    } finally {
      await restoreReasoningCaptureFlag();
    }
  });

  it('flag ON, no reasoning on the routing result: run.reasoning is undefined, no crash', async () => {
    await setReasoningCaptureFlag('true');
    try {
      const result = await runTurnExecutor(BASE_PAYLOAD, 'req-reasoning-none', {
        routingAdapter: mockRoutingAdapter(async () =>
          mkToolUseResultWithReasoning(PROPOSAL_RUN_ANALYSIS, 'Routing…', undefined),
        ),
        handlerRegistry: makeSuccessRegistry(),
        graphState: GRAPH_WITH_OPTIONS,
      });

      expect(result.reasoning).toBeUndefined();
    } finally {
      await restoreReasoningCaptureFlag();
    }
  });
});
