/**
 * S3-L6 / F-5 — edit-lane LLM call attribution reaches route-v2 on
 * `DispatchEditGraphResult.editLlmCall`.
 *
 * F-5 defect: `_diagnostic_trace.llm_calls` was structurally `[]` on every
 * edit turn that demonstrably called the LLM — the edit dispatch never
 * threaded the call. This suite pins the DISPATCH half of the fix (the
 * builder + wire half live in `v5-diagnostic-trace.test.ts` and
 * `route-v2-edit-graph-diagnostic-trace.test.ts`):
 *
 *  - an APPLIED edit (success) whose R7 diagnostics carry a model/tokens
 *    surfaces `editLlmCall` with the real attribution;
 *  - a REJECTED edit (failure) with LLM diagnostics ALSO surfaces it — the
 *    call happened regardless of the edit outcome;
 *  - a DETERMINISTIC edit (no-LLM: model null, 0 tokens) surfaces NOTHING, so
 *    a no-LLM edit still reports `llm_calls: []` honestly.
 *
 * MUTATION-CHECK: revert either return's `...(editLlmCall ? { editLlmCall } : {})`
 * spread in edit-graph-dispatch.ts, OR the `llmRan` gate in
 * `extractEditLlmCallTelemetry` (in v5-diagnostic-trace.ts), and the
 * corresponding case goes RED.
 *
 * Harness mirrors edit-graph-dispatch.test.ts. The extractor lives in
 * v5-diagnostic-trace.ts (mocked by no test), so mocking `handleEditGraph` with
 * a bare factory here is safe — it does not strand the extractor.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult, EditGraphTraceDiagnostics } from '../../../orchestrator/tools/edit-graph.js';

// ── module-level mocks ────────────────────────────────────────────────────────

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  // Real provider name so `adapter.name` flows into the telemetry's `provider`.
  getAdapter: vi.fn().mockReturnValue({ name: 'anthropic', model: 'claude-sonnet-4-6' }),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
    loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
  };
});

// ── imports after mocks ───────────────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { extractEditLlmCallTelemetry } from '../../diagnostics/v5-diagnostic-trace.js';
import { commitDirectAnswer } from '../../commit.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// ── helpers ───────────────────────────────────────────────────────────────────

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
  ],
  edges: [
    {
      from: 'dec_launch',
      to: 'goal_revenue',
      strength: { mean: 0.7, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

/** R7 diagnostics for a turn where the edit LLM ran (model + tokens present). */
function llmRanDiagnostics(overrides: Partial<EditGraphTraceDiagnostics> = {}): EditGraphTraceDiagnostics {
  return {
    classified_intent: 'parameter_update',
    instruction_mode_applied: 'narrow_parameter_update',
    edit_instruction_preview: null,
    graph_context_node_count: 2,
    graph_context_edge_count: 1,
    operations_proposed_count: 1,
    operations_proposed_types: ['update_edge'],
    validation_outcome: 'valid',
    validation_violation_codes: [],
    recovery_path_chosen: 'none',
    conversational_state_summary: null,
    target_resolution: null,
    resolution_mode: 'auto_apply',
    proposal_returned: false,
    branch_taken: 'apply',
    branch_reason: null,
    failure_branch: null,
    failure_code: null,
    failure_message: null,
    model: 'claude-sonnet-4-6',
    input_tokens_est: 3100,
    output_tokens: 210,
    stop_reason: 'end_turn',
    repair_attempts: 1,
    plot_outcome: 'pass',
    ...overrides,
  };
}

function makeAppliedEditResult(diagnostics?: EditGraphTraceDiagnostics): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Edge strength increased.',
    latencyMs: 1450,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [{ op: 'update_edge', path: 'dec_launch->goal_revenue', value: 0.7 }],
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function makeRejectedEditResult(diagnostics?: EditGraphTraceDiagnostics): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'The proposed edit was rejected.',
    latencyMs: 800,
    appliedGraph: null,
    wasRejected: true,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function makeCommitResult(graphPersisted: boolean) {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-edit-1',
    graphPersisted,
  };
}

// ── extraction-unit tests ──────────────────────────────────────────────────────

describe('extractEditLlmCallTelemetry (S3-L6 / F-5)', () => {
  it('maps R7 diagnostics of an LLM turn into edit-lane telemetry', () => {
    const telemetry = extractEditLlmCallTelemetry(
      { diagnostics: llmRanDiagnostics(), latencyMs: 1450 },
      'anthropic',
    );
    expect(telemetry).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      input_tokens: 3100,
      output_tokens: 210,
      latency_ms: 1450,
      stop_reason: 'end_turn',
      repair_attempts: 1,
    });
  });

  it('returns undefined for a deterministic (no-LLM) edit — model null, 0 tokens', () => {
    const telemetry = extractEditLlmCallTelemetry(
      {
        diagnostics: llmRanDiagnostics({
          model: null,
          input_tokens_est: 0,
          output_tokens: 0,
          repair_attempts: 0,
          stop_reason: null,
          branch_reason: 'constraint_shortcut',
        }),
        latencyMs: 12,
      },
      'anthropic',
    );
    expect(telemetry).toBeUndefined();
  });

  it('records the call when a model is absent but tokens were consumed (honest sentinel case)', () => {
    const telemetry = extractEditLlmCallTelemetry(
      { diagnostics: llmRanDiagnostics({ model: null, input_tokens_est: 0, output_tokens: 5 }), latencyMs: 900 },
      'anthropic',
    );
    expect(telemetry).toBeDefined();
    expect(telemetry!.model).toBeNull();
    expect(telemetry!.output_tokens).toBe(5);
  });

  it('returns undefined when the result carries no diagnostics at all', () => {
    expect(extractEditLlmCallTelemetry({ diagnostics: undefined, latencyMs: 5 }, 'anthropic')).toBeUndefined();
  });
});

// ── dispatch-wiring tests ──────────────────────────────────────────────────────

describe('dispatchEditGraph — editLlmCall threading (S3-L6 / F-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces editLlmCall on an APPLIED edit whose LLM ran (success path)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(makeAppliedEditResult(llmRanDiagnostics()));
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-edit-applied',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(result.commitPerformed).toBe(true);
    expect(result.editLlmCall).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      input_tokens: 3100,
      output_tokens: 210,
      latency_ms: 1450,
      stop_reason: 'end_turn',
      repair_attempts: 1,
    });
  });

  it('surfaces editLlmCall on a REJECTED edit whose LLM ran (failure path — call still happened)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(makeRejectedEditResult(llmRanDiagnostics({ branch_taken: 'rejection', output_tokens: 40 })));
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-edit-rejected',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(result.editLlmCall).toBeDefined();
    expect(result.editLlmCall!.provider).toBe('anthropic');
    expect(result.editLlmCall!.model).toBe('claude-sonnet-4-6');
    expect(result.editLlmCall!.output_tokens).toBe(40);
  });

  it('omits editLlmCall on a DETERMINISTIC (no-LLM) edit so the trace stays honestly empty', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeAppliedEditResult(
          llmRanDiagnostics({ model: null, input_tokens_est: 0, output_tokens: 0, repair_attempts: 0, stop_reason: null }),
        ),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-edit-deterministic',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(result.editLlmCall).toBeUndefined();
  });
});
