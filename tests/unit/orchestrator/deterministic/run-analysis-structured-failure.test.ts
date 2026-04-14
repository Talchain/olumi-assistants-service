/**
 * Proves that when run_analysis's underlying handler throws an
 * OrchestratorError (e.g. intervention-normaliser hard-fail), the V4 action
 * catch branch produces a structured ActionFailure that survives through
 * assembleV4Envelope to the final envelope, rather than the generic
 * "The analysis service returned an error" fallback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/run-analysis.js", () => ({
  handleRunAnalysis: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/plot-client.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/orchestrator/plot-client.js")>("../../../../src/orchestrator/plot-client.js");
  return {
    ...actual,
    createPLoTClient: vi.fn(() => ({ run: vi.fn() })),
  };
});

import { runAnalysisAction } from "../../../../src/orchestrator/deterministic/actions/run-analysis.js";
import { assembleV4Envelope } from "../../../../src/orchestrator/deterministic/pipeline-v4.js";
import { handleRunAnalysis } from "../../../../src/orchestrator/tools/run-analysis.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";
import type { OrchestratorError } from "../../../../src/orchestrator/types.js";

const handleRunAnalysisMock = vi.mocked(handleRunAnalysis);

beforeEach(() => {
  handleRunAnalysisMock.mockReset();
});

function makeCtx(): DeterministicTurnContext {
  return {
    stage: 'evaluate',
    entities: { nodes: new Map(), edges: [], option_ids: ['opt_a'], goal_id: 'goal_g' },
    graph_summary: { node_count: 3, edge_count: 1, option_count: 1, option_labels: ['A'], goal_label: 'Goal', missing_structural: [] },
    analysis_summary: null,
    capabilities: { can_run_analysis: true, can_explain_results: false, can_edit_graph: true, can_compare_options: false, can_challenge: false, can_generate_artefact: false },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 1, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: ['run_analysis'],
    disambiguation_hints: [],
    graph: {
      nodes: [{ id: 'goal_g', kind: 'goal', label: 'Goal' }, { id: 'opt_a', kind: 'option', label: 'A' }],
      edges: [{ from: 'opt_a', to: 'goal_g' }],
    } as unknown as DeterministicTurnContext['graph'],
    analysis: null,
    conversational_state: null,
    messages: [],
    scenario_id: 'sc',
    turn_id: 'tu',
    analysis_inputs: {
      options: [{ option_id: 'opt_a', interventions: { fac_x: 'bad' as unknown as number } }],
    } as unknown as DeterministicTurnContext['analysis_inputs'],
  } as DeterministicTurnContext;
}

describe("run_analysis OrchestratorError → structured ActionFailure", () => {
  it("produces a RUN_ANALYSIS_INTERNAL_PAYLOAD_ERROR failure that reaches the envelope", async () => {
    const orchestratorError: OrchestratorError = {
      code: 'INTERNAL_PAYLOAD_ERROR',
      message: 'Cannot normalize intervention for option "opt_a"…',
      tool: 'run_analysis',
      recoverable: false,
    };
    const err = Object.assign(new Error(orchestratorError.message), { orchestratorError });
    handleRunAnalysisMock.mockRejectedValue(err);

    const ctx = makeCtx();
    const result = await runAnalysisAction.execute({}, ctx);

    expect(result.failure).toBeDefined();
    expect(result.failure?.code).toBe('RUN_ANALYSIS_INTERNAL_PAYLOAD_ERROR');
    expect(result.failure?.user_message).not.toMatch(/returned an error\. Your model is unchanged/i);

    // Verify it propagates through envelope assembly
    const envelope = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'tu',
      requestId: 'req',
      executionClass: 'standard_turn',
      assistantText: '',
      actionResult: result,
      routing: 'deterministic',
      executedAction: 'run_analysis',
      contextFallbackUsed: false,
      availableTools: [],
    });

    expect((envelope as Record<string, unknown>).failure_code).toBe('RUN_ANALYSIS_INTERNAL_PAYLOAD_ERROR');
    expect(envelope.assistant_text).toBe(result.failure?.user_message);
    expect(envelope.assistant_text).not.toMatch(/returned an error\. Your model is unchanged/i);
  });

  it("still emits a structured failure when no OrchestratorError metadata is attached", async () => {
    handleRunAnalysisMock.mockRejectedValue(new Error('Boom'));
    const ctx = makeCtx();
    const result = await runAnalysisAction.execute({}, ctx);
    expect(result.failure?.code).toBe('RUN_ANALYSIS_UNKNOWN');
  });
});
