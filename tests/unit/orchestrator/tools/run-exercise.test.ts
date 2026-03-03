/**
 * run_exercise Tool Handler Tests
 */

import { describe, it, expect, vi } from "vitest";
import { handleRunExercise } from "../../../../src/orchestrator/tools/run-exercise.js";
import type { ConversationContext } from "../../../../src/orchestrator/types.js";
import type { LLMAdapter } from "../../../../src/adapters/llm/types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeAnalysisResponse() {
  return {
    results: [
      { option_label: 'Option A', win_probability: 0.65 },
      { option_label: 'Option B', win_probability: 0.35 },
    ],
    factor_sensitivity: [
      { label: 'Cost', elasticity: 0.6, node_id: 'n1' },
      { label: 'Quality', elasticity: 0.3, node_id: 'n2' },
    ],
    robustness: { level: 'fragile', fragile_edges: [{ label: 'cost-outcome' }] },
    constraint_analysis: {
      per_constraint: [{ constraint_id: 'c1', label: 'Budget', probability: 0.3 }],
      joint_probability: 0.3,
    },
    fact_objects: [],
    response_hash: 'test-hash',
  };
}

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: makeAnalysisResponse() as any,
    framing: null,
    messages: [],
    selected_elements: [],
    scenario_id: 'test-scenario',
    ...overrides,
  };
}

function makeAdapter(content = 'Exercise output text'): LLMAdapter {
  return {
    chat: vi.fn().mockResolvedValue({ content }),
  } as unknown as LLMAdapter;
}

// ============================================================================
// Tests
// ============================================================================

describe("handleRunExercise", () => {
  it("throws TOOL_EXECUTION_FAILED when analysis_response is missing", async () => {
    const ctx = makeContext({ analysis_response: undefined as any });
    const adapter = makeAdapter();
    await expect(handleRunExercise('pre_mortem', ctx, adapter, 'req-1', 'turn-1')).rejects.toMatchObject({
      orchestratorError: { code: 'TOOL_EXECUTION_FAILED', tool: 'run_exercise' },
    });
  });

  it("throws TOOL_EXECUTION_FAILED for unknown exercise type", async () => {
    const ctx = makeContext();
    const adapter = makeAdapter();
    await expect(
      handleRunExercise('unknown_exercise' as any, ctx, adapter, 'req-1', 'turn-1'),
    ).rejects.toMatchObject({
      orchestratorError: { code: 'TOOL_EXECUTION_FAILED' },
    });
  });

  describe("pre_mortem exercise", () => {
    it("returns a review_card block with tone: challenger", async () => {
      const ctx = makeContext();
      const adapter = makeAdapter('Pre-mortem analysis output');
      const result = await handleRunExercise('pre_mortem', ctx, adapter, 'req-1', 'turn-1');

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].block_type).toBe('review_card');
      const cardData = result.blocks[0].data as { card: Record<string, unknown> };
      expect(cardData.card.tone).toBe('challenger');
      expect(cardData.card.exercise_type).toBe('pre_mortem');
      expect(cardData.card.content).toBe('Pre-mortem analysis output');
    });

    it("calls adapter.chat with pre-mortem system prompt", async () => {
      const ctx = makeContext();
      const adapter = makeAdapter();
      await handleRunExercise('pre_mortem', ctx, adapter, 'req-1', 'turn-1');

      expect(adapter.chat).toHaveBeenCalledOnce();
      const call = vi.mocked(adapter.chat).mock.calls[0];
      expect(call[0].system).toContain('pre-mortem');
    });
  });

  describe("devil_advocate exercise", () => {
    it("returns block with exercise_type: devil_advocate", async () => {
      const ctx = makeContext();
      const adapter = makeAdapter("Devil's advocate output");
      const result = await handleRunExercise('devil_advocate', ctx, adapter, 'req-1', 'turn-1');

      const cardData = result.blocks[0].data as { card: Record<string, unknown> };
      expect(cardData.card.exercise_type).toBe('devil_advocate');
      expect(cardData.card.tone).toBe('challenger');
    });

    it("includes the winner label in the prompt context", async () => {
      const ctx = makeContext();
      const adapter = makeAdapter();
      await handleRunExercise('devil_advocate', ctx, adapter, 'req-1', 'turn-1');

      const call = vi.mocked(adapter.chat).mock.calls[0];
      expect(call[0].system).toContain('Option A');
    });
  });

  describe("disconfirmation exercise", () => {
    it("returns block with exercise_type: disconfirmation", async () => {
      const ctx = makeContext();
      const adapter = makeAdapter('Disconfirmation output');
      const result = await handleRunExercise('disconfirmation', ctx, adapter, 'req-1', 'turn-1');

      const cardData = result.blocks[0].data as { card: Record<string, unknown> };
      expect(cardData.card.exercise_type).toBe('disconfirmation');
    });
  });

  describe("LLM error handling", () => {
    it("propagates LLM errors as TOOL_EXECUTION_FAILED", async () => {
      const ctx = makeContext();
      const adapter: LLMAdapter = {
        chat: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      } as unknown as LLMAdapter;

      await expect(
        handleRunExercise('pre_mortem', ctx, adapter, 'req-1', 'turn-1'),
      ).rejects.toMatchObject({
        orchestratorError: { code: 'TOOL_EXECUTION_FAILED', recoverable: true },
      });
    });
  });

  it("returns non-null latencyMs", async () => {
    const ctx = makeContext();
    const adapter = makeAdapter();
    const result = await handleRunExercise('pre_mortem', ctx, adapter, 'req-1', 'turn-1');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns assistantText as null", async () => {
    const ctx = makeContext();
    const adapter = makeAdapter();
    const result = await handleRunExercise('pre_mortem', ctx, adapter, 'req-1', 'turn-1');
    expect(result.assistantText).toBeNull();
  });

  it("includes suggested_actions in card", async () => {
    const ctx = makeContext();
    const adapter = makeAdapter();
    const result = await handleRunExercise('pre_mortem', ctx, adapter, 'req-1', 'turn-1');
    const cardData = result.blocks[0].data as { card: Record<string, unknown> };
    expect(Array.isArray(cardData.card.suggested_actions)).toBe(true);
  });
});
