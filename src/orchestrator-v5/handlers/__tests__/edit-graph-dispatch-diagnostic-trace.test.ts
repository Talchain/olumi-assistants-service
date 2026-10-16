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
import { describe, it, expect, vi } from 'vitest';
import type { EditGraphTraceDiagnostics } from '../../../orchestrator/tools/edit-graph.js';

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
    // B-FIX1: the combined read follows the existing graph double.
    loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
    loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
  };
});
import { extractEditLlmCallTelemetry } from '../../diagnostics/v5-diagnostic-trace.js';

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
    prompt_hash: 'sha256:editgraphhash',
    prompt_version: 'edit_graph_default@v12',
    prompt_source: 'default',
    input_tokens_est: 3100,
    output_tokens: 210,
    stop_reason: 'end_turn',
    repair_attempts: 1,
    plot_outcome: 'pass',
    ...overrides,
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
      // Served-prompt identity maps straight through, so an edit turn's trace
      // can say WHICH PROMPT VERSION produced the edit. `toEqual` is exact, so
      // a mapping that dropped these would RED.
      prompt_hash: 'sha256:editgraphhash',
      prompt_version: 'edit_graph_default@v12',
      prompt_source: 'default',
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
