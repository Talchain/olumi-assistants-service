/**
 * R7 integration tests — one `v5.edit_graph.turn` event per dispatch turn.
 *
 * Pins:
 *  - exactly one event per branch (success / no-op / rejected / handler-throw),
 *  - distinct parse_fail vs validation_fail failure_codes,
 *  - tokens / stop_reason / model surfaced from the threaded diagnostics,
 *  - a telemetry emit fault never masks the handler's return or rethrown error
 *    (amendment 1).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

// V5-PERSIST-FIX-01: stub ONLY the strict persisted read so applied
// mutations do not fail closed against the unconfigured test store.
// `null` = a genuinely-empty scenarios.graph → ingress-base fallback merge,
// i.e. the same (request-graph) base these tests used before the fix.
// Everything else in build-turn-context stays real.
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({
  getSystemPromptMeta: vi.fn(() => ({
    taskId: 'edit_graph',
    source: 'store',
    promptId: 'edit_graph_default',
    version: 9,
    prompt_version: 'edit_graph_default@v9 (production)',
    prompt_hash: '313665a4',
  })),
}));

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { getSystemPromptMeta } from '../../../adapters/llm/prompt-loader.js';
import { setTestSink } from '../../../utils/telemetry.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

function makePayload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Increase the strength of the launch → revenue edge',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
  ],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

const POST_EDIT_GRAPH = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
  ],
  edges: [
    {
      from: 'fac_marketing',
      to: 'goal_revenue',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
} as unknown as EditGraphResult['appliedGraph'];

function makeAppliedResult(diag?: Partial<NonNullable<EditGraphResult['diagnostics']>>): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Edge strength increased.',
    latencyMs: 1200,
    appliedGraph: POST_EDIT_GRAPH,
    wasRejected: false,
    operations: [{ op: 'update_edge', path: 'fac_marketing->goal_revenue', value: 0.7 }] as unknown as EditGraphResult['operations'],
    ...(diag ? { diagnostics: diag as EditGraphResult['diagnostics'] } : {}),
  };
}

function makeNoOpResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: "I couldn't see a concrete change to make from that description.",
    latencyMs: 50,
    appliedGraph: null,
    wasRejected: false,
  };
}

function makeRejectedResult(failureCode: string): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'The proposed edit was rejected.',
    latencyMs: 800,
    appliedGraph: null,
    wasRejected: true,
    diagnostics: { failure_code: failureCode } as unknown as EditGraphResult['diagnostics'],
  };
}

function makeCommit(graphPersisted: boolean) {
  return { response: {}, performed: true as const, persisted_row_id: 'row-1', graphPersisted };
}

const hg = handleEditGraph as MockedFunction<typeof handleEditGraph>;
const commit = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;

let events: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  (getSystemPromptMeta as MockedFunction<typeof getSystemPromptMeta>).mockReturnValue({
    taskId: 'edit_graph',
    source: 'store',
    promptId: 'edit_graph_default',
    version: 9,
    prompt_version: 'edit_graph_default@v9 (production)',
    prompt_hash: '313665a4',
  } as ReturnType<typeof getSystemPromptMeta>);
  commit.mockResolvedValue(makeCommit(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);
  events = [];
  setTestSink((event, data) => {
    events.push({ event, data });
  });
});

afterEach(() => {
  setTestSink(null);
});

function turnEvents() {
  return events.filter((e) => e.event === 'v5.edit_graph.turn');
}

async function run() {
  return dispatchEditGraph({
    payload: makePayload(),
    requestId: 'req-turn-event',
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
}

describe('R7 — v5.edit_graph.turn emitted exactly once per branch', () => {
  it('success: one event, outcome=success, prompt identity + threaded diagnostics', async () => {
    hg.mockResolvedValue(
      makeAppliedResult({
        branch_taken: 'apply',
        model: 'claude-test',
        input_tokens_est: 222,
        output_tokens: 44,
        stop_reason: 'end_turn',
        repair_attempts: 1,
        plot_outcome: 'pass',
      }),
    );
    await run();
    const te = turnEvents();
    expect(te).toHaveLength(1);
    expect(te[0]!.data.outcome).toBe('success');
    expect(te[0]!.data.model).toBe('claude-test');
    expect(te[0]!.data.input_tokens_est).toBe(222);
    expect(te[0]!.data.output_tokens).toBe(44);
    expect(te[0]!.data.stop_reason).toBe('end_turn');
    expect(te[0]!.data.repair_attempts).toBe(1);
    expect(te[0]!.data.plot_outcome).toBe('pass');
    expect(te[0]!.data.operations_count).toBe(1);
    expect(te[0]!.data.graph_nodes_after).toBe(3);
    // prompt identity (mocked source='store')
    expect(te[0]!.data.prompt_key).toBe('edit_graph_default');
    expect(te[0]!.data.prompt_version).toBe(9);
    expect(te[0]!.data.prompt_hash).toBe('313665a4');
    expect(te[0]!.data.prompt_fallback_used).toBe(false);
    // content-free: scenario_id present, no message/label text
    expect(te[0]!.data.scenario_id).toBe(SCENARIO_ID);
    expect(JSON.stringify(te[0]!.data)).not.toContain('Launch');
  });

  it('no-op: one event, outcome=no_op, deterministic token defaults', async () => {
    hg.mockResolvedValue(makeNoOpResult());
    await run();
    const te = turnEvents();
    expect(te).toHaveLength(1);
    expect(te[0]!.data.outcome).toBe('no_op');
    expect(te[0]!.data.operations_count).toBe(0);
    expect(te[0]!.data.input_tokens_est).toBe(0);
    expect(te[0]!.data.stop_reason).toBe('unknown');
    expect(te[0]!.data.plot_outcome).toBe('skipped');
  });

  it('rejected: one event, outcome=rejected, failure_code from diagnostics', async () => {
    hg.mockResolvedValue(makeRejectedResult('PLOT_SEMANTIC_REJECTED'));
    await run();
    const te = turnEvents();
    expect(te).toHaveLength(1);
    expect(te[0]!.data.outcome).toBe('rejected');
    expect(te[0]!.data.failure_code).toBe('PLOT_SEMANTIC_REJECTED');
  });

  it('prompt_fallback_used=true when the served prompt is the bundled default', async () => {
    (getSystemPromptMeta as MockedFunction<typeof getSystemPromptMeta>).mockReturnValue({
      taskId: 'edit_graph',
      source: 'default',
      prompt_version: 'bundled',
      prompt_hash: 'bundledhash',
    } as ReturnType<typeof getSystemPromptMeta>);
    hg.mockResolvedValue(makeAppliedResult({ branch_taken: 'apply' }));
    await run();
    const te = turnEvents();
    expect(te[0]!.data.prompt_fallback_used).toBe(true);
    expect(te[0]!.data.prompt_source).toBe('default');
    expect(te[0]!.data.prompt_key).toBeNull();
  });
});

describe('R7 — distinct parse_fail vs validation_fail failure_codes', () => {
  it('parse-exhausted throw → outcome=error, failure_code=parse_fail (and dispatch rethrows)', async () => {
    const parseErr = Object.assign(new Error('Failed to parse edit operations from LLM response: x'), {
      orchestratorError: { code: 'TOOL_EXECUTION_FAILED' },
      editTurnFailureCode: 'parse_fail' as const,
    });
    hg.mockRejectedValue(parseErr);
    await expect(run()).rejects.toBe(parseErr);
    const te = turnEvents();
    expect(te).toHaveLength(1);
    expect(te[0]!.data.outcome).toBe('error');
    expect(te[0]!.data.failure_code).toBe('parse_fail');
  });

  it('validation-exhausted rejection → failure_code=graph_structure_invalid, distinct from parse_fail', async () => {
    hg.mockResolvedValue(makeRejectedResult('graph_structure_invalid'));
    await run();
    const te = turnEvents();
    expect(te[0]!.data.failure_code).toBe('graph_structure_invalid');
    expect(te[0]!.data.failure_code).not.toBe('parse_fail');
  });
});

describe('R7 — amendment 1: a telemetry fault never masks the handler result/error', () => {
  it('success path: a throwing turn-event sink does not break the dispatch return', async () => {
    setTestSink((event) => {
      if (event === 'v5.edit_graph.turn') throw new Error('telemetry boom');
    });
    hg.mockResolvedValue(makeAppliedResult({ branch_taken: 'apply' }));
    const result = await run();
    expect(result.commitPerformed).toBe(true);
  });

  it('throw path: a throwing turn-event sink does not replace the rethrown handler error', async () => {
    setTestSink((event) => {
      if (event === 'v5.edit_graph.turn') throw new Error('telemetry boom');
    });
    const original = Object.assign(new Error('Edit graph LLM call failed: upstream 500'), {
      orchestratorError: { code: 'TOOL_EXECUTION_FAILED' },
      editTurnFailureCode: 'llm_call_failed' as const,
    });
    hg.mockRejectedValue(original);
    // The ORIGINAL handler error must surface, not 'telemetry boom'.
    await expect(run()).rejects.toBe(original);
  });
});
