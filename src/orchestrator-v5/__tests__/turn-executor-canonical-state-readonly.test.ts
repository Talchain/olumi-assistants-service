/**
 * V5 M5 — read-only canonical analysis state threading (live path).
 *
 * Proves runTurnExecutor assembles the unified canonical analysis state
 * (selectCanonicalAnalysisState) on a live, successful tool/action turn and
 * exposes it on the run result for the route's flag-gated `_context_summary`
 * diagnostic. Pure read-only — it is NOT fed to chips or prose, and it does
 * not change dispatch, control flow, or the Brief 4 STEP 6.6 gate.
 *
 * Harness mirrors turn-executor-recoverable-handler.test.ts, but registers a
 * SUCCEEDING run_analysis handler so the execute path reaches the post-dispatch
 * assembly point.
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
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
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

const GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH_WITH_OPTIONS as never);

function runAnalysisFact(graphHash: string | null): HandlerFact {
  const result: Record<string, unknown> = {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_a',
    summary: 'Ran the analysis on your scenario.',
    computed_at: '2026-04-30T01:00:00.000Z',
    enrichment: { analysis_status: 'completed' },
    win_probabilities: { opt_a: 0.62, opt_b: 0.38 },
  };
  if (graphHash) result.graph_hash_at_run = graphHash;
  return { fact_type: 'run_analysis', fact_version: 1, noop: false, result } as HandlerFact;
}

function makeSuccessRegistry(graphHash: string | null): HandlerRegistry {
  const handler: HandlerFn = async () => ({
    assistant_text: 'Ran the analysis on your scenario.',
    handler_facts: [runAnalysisFact(graphHash)],
    llm_calls_used: 0,
  });
  return new Map([['run_analysis', handler]]);
}

function mkToolUseResult(input: unknown, textBefore?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (textBefore) content.push({ type: 'text', text: textBefore });
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

describe('TurnExecutor — read-only canonical analysis state (M5)', () => {
  beforeEach(() => setTestSink(() => {}));
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('successful tool turn → result.canonicalState present + reflects the run_analysis fact', async () => {
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-canon-ok', {
      routingAdapter: mockRoutingAdapter(async () => mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…')),
      handlerRegistry: makeSuccessRegistry(GRAPH_HASH),
      graphState: GRAPH_WITH_OPTIONS,
    });

    // The handler ran successfully (execute path reached the assembly point).
    expect(result.telemetry.commit_performed).toBe(true);

    // Read-only canonical state was assembled and surfaced on the result.
    expect(result.canonicalState).toBeDefined();
    expect(result.canonicalState!.version).toBe('1.0.0');
    // The current-turn run_analysis fact was seen → a fact was selected, so the
    // verdict is NOT 'none' (it has real analysis to reason about).
    expect(result.canonicalState!.selected_fact_index).not.toBeNull();
    expect(result.canonicalState!.freshness).not.toBe('none');
  });

  it('read-only posture: assembling the canonical state does not alter the response or chips', async () => {
    // Same turn with vs without a usable graph hash on the fact — the response
    // body + suggested_actions must be identical (the canonical state is
    // diagnostic-only; it never feeds prose or chip decisions).
    const run = (graphHash: string | null) =>
      runTurnExecutor(BASE_PAYLOAD, `req-canon-readonly-${graphHash ?? 'none'}`, {
        routingAdapter: mockRoutingAdapter(async () => mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…')),
        handlerRegistry: makeSuccessRegistry(graphHash),
        graphState: GRAPH_WITH_OPTIONS,
      });

    const withHash = await run(GRAPH_HASH);
    const withoutHash = await run(null);

    // Canonical freshness differs (fresh-ish vs legacy 'unknown') ...
    expect(withHash.canonicalState).toBeDefined();
    expect(withoutHash.canonicalState).toBeDefined();
    // ... but the user-facing response prose + chips are unaffected.
    expect(withHash.response.assistant_text).toBe(withoutHash.response.assistant_text);
    expect(JSON.stringify(withHash.response.suggested_actions)).toBe(
      JSON.stringify(withoutHash.response.suggested_actions),
    );
  });
});
