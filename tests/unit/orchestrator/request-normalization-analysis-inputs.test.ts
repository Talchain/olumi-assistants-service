/**
 * Tests for Fix 2 — S5 empty-message + top-level analysis_inputs handling.
 *
 * The UI's buildRunAnalysisTurnRequest sends `analysis_inputs` at top level
 * with no `message` field. Prior to the fix, Zod stripped top-level
 * analysis_inputs and normalizeContext returned context.analysis_inputs=null,
 * so the pipeline couldn't run analysis and the LLM path 400'd on empty
 * user content — surfacing "Something went wrong".
 */

import { describe, it, expect } from "vitest";
import { normalizeContext } from "../../../src/orchestrator/request-normalization.js";
import { TurnRequestSchema } from "../../../src/orchestrator/route-schemas.js";

describe("normalizeContext — top-level analysis_inputs", () => {
  it("promotes top-level analysis_inputs into context.analysis_inputs when context is absent", () => {
    const analysisInputs = {
      options: [
        {
          id: 'opt_a',
          label: 'Option A',
          status: 'ready',
          interventions: { fac_x: { value: 0.5, source: 'cee_hypothesis' } },
        },
      ],
      goal_node_id: 'goal_g',
    };
    const ctx = normalizeContext({
      scenario_id: 's1',
      analysis_inputs: analysisInputs,
      graph_state: { nodes: [], edges: [] },
    });
    expect(ctx.analysis_inputs).toBeDefined();
    expect(ctx.analysis_inputs?.options).toHaveLength(1);
    // UI sends `id`; CEE historical code uses `option_id`. Normaliser
    // mirrors so downstream sees the canonical key.
    expect(ctx.analysis_inputs?.options[0].option_id).toBe('opt_a');
  });

  it("prefers nested context.analysis_inputs over top-level when both present", () => {
    const topLevel = { options: [{ id: 'opt_top', label: 'Top', status: 'ready', interventions: {} }] };
    const nested = { options: [{ option_id: 'opt_nested', label: 'Nested', status: 'ready', interventions: {} }] };
    const ctx = normalizeContext({
      scenario_id: 's',
      analysis_inputs: topLevel,
      context: {
        graph: null,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: 's',
        analysis_inputs: nested,
      } as unknown as import("../../../src/orchestrator/types.js").ConversationContext,
    });
    expect(ctx.analysis_inputs?.options[0].option_id).toBe('opt_nested');
  });

  it("normalises id → option_id on nested context.analysis_inputs (P1a regression)", () => {
    // When the UI sends analysis_inputs nested inside `context` with `id`
    // (not `option_id`), normaliseAnalysisInputs must still run so downstream
    // run_analysis consumers always see the canonical key.
    const ctx = normalizeContext({
      scenario_id: 's',
      context: {
        graph: null,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: 's',
        // id-only shape, no option_id — same as Zod-validated top-level UI payload
        analysis_inputs: {
          options: [{ id: 'opt_nested_id_only', label: 'Nested ID only', interventions: {} }],
        },
      } as unknown as import("../../../src/orchestrator/types.js").ConversationContext,
    });
    expect(ctx.analysis_inputs?.options[0].option_id).toBe('opt_nested_id_only');
  });

  it("falls back to top-level analysis_inputs when context present but analysis_inputs absent", () => {
    const topLevel = { options: [{ id: 'opt_top', label: 'Top', status: 'ready', interventions: {} }] };
    const ctx = normalizeContext({
      scenario_id: 's',
      analysis_inputs: topLevel,
      context: {
        graph: null,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: 's',
        analysis_inputs: null,
      } as unknown as import("../../../src/orchestrator/types.js").ConversationContext,
    });
    expect(ctx.analysis_inputs?.options[0].option_id).toBe('opt_top');
  });
});

describe("TurnRequestSchema — accepts top-level analysis_inputs", () => {
  it("accepts UI-shape payload with id-not-option_id, no message", () => {
    const payload = {
      scenario_id: 's',
      client_turn_id: 't',
      conversation_history: [{ role: 'user', content: 'hello' }],
      graph_state: {
        nodes: [{ id: 'goal_g', kind: 'goal' }, { id: 'opt_a', kind: 'option' }],
        edges: [{ from: 'opt_a', to: 'goal_g' }],
      },
      analysis_inputs: {
        options: [
          {
            id: 'opt_a',
            label: 'Option A',
            status: 'ready',
            interventions: { fac_x: { value: 0.5, source: 'cee_hypothesis' } },
          },
        ],
        goal_node_id: 'goal_g',
      },
    };
    const parsed = TurnRequestSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.analysis_inputs).toBeDefined();
      expect(parsed.data.message).toBe(''); // default applied
    }
  });

  it("rejects analysis_inputs.options entries lacking both option_id and id", () => {
    const payload = {
      scenario_id: 's',
      client_turn_id: 't',
      analysis_inputs: {
        options: [{ label: 'Missing IDs', interventions: {} }],
      },
    };
    const parsed = TurnRequestSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});
