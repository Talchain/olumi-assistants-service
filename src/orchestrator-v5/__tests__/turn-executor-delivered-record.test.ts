/**
 * ⭐ SD-1 Slice R (cut 7) — W1, the ROUTED Run's commit (`turn-executor.ts`, `commitTurn(composedOk, …)`), through the
 * real executor with an injected Run handler (harness of turn-executor-canonical-state-readonly.test.ts). The stored
 * Run fact carries the record of what this turn's wire delivered, bound to its run; a turn that also WRITES the graph
 * records nothing (its `analysis_ready` is re-derived after the commit).
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

const { writes, firstTouch } = vi.hoisted(() => ({ writes: [] as Array<Record<string, unknown>>, firstTouch: { on: false } }));

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (w: Record<string, unknown>) => { writes.push(w); return { id: 'mock-row-id' }; },
    // The twin below models a first-touch scenario (explicit absence licenses the request graph), so the Run turn also
    // WRITES the graph. Otherwise the key is absent, as in the harness this mirrors.
    ...(firstTouch.on ? { loadGraphAndBriefText: async () => ({ graph: null, briefText: null }) } : {}),
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
    leading_option_id: null,
    run_id: 'run_w1',
    constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'unevaluated' },
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


const runIt = (id: string) => runTurnExecutor(BASE_PAYLOAD, id, {
  routingAdapter: mockRoutingAdapter(async () => mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…')),
  handlerRegistry: makeSuccessRegistry(GRAPH_HASH),
  graphState: GRAPH_WITH_OPTIONS,
});
const storedRunFact = () => ((writes.at(-1)?.handler_facts ?? []) as HandlerFact[]).find((f) => f.fact_type === 'run_analysis');
const PHASE3 = new Set(['review_card', 'coaching', 'evidence', 'exercise']);

describe('TurnExecutor — the routed Run records what it delivered (SD-1 W1)', () => {
  beforeEach(() => { setTestSink(() => {}); writes.length = 0; firstTouch.on = false; });
  afterEach(() => { setTestSink(null); vi.restoreAllMocks(); });

  it('⭐ the stored Run fact carries delivered_record, bound to its run, holding the wire\'s Phase 3 subset', async () => {
    const result = await runIt('req-w1-record');
    expect(result.telemetry.commit_performed).toBe(true);
    expect(writes.at(-1)?.graph ?? null).toBeNull(); // precondition: this turn writes no graph
    const record = (storedRunFact()!.result as Record<string, unknown>).delivered_record as Record<string, unknown>;
    expect(record).toMatchObject({ record_version: 1, run_id: 'run_w1', graph_hash: GRAPH_HASH });
    const wirePhase3 = (result.response.blocks ?? []).filter((b) => PHASE3.has((b as { type: string }).type));
    expect(record.phase3_blocks).toEqual(wirePhase3);
  });

  it('a Run turn that also WRITES the graph records nothing (first-touch adopt)', async () => {
    firstTouch.on = true;
    const result = await runIt('req-w1-first-touch');
    expect(result.telemetry.commit_performed).toBe(true);
    expect(writes.at(-1)?.graph ?? null, 'precondition: this twin writes the graph').not.toBeNull();
    expect(storedRunFact()!.result).not.toHaveProperty('delivered_record');
  });
});
