/**
 * Chip tool-set test — proves buildToolDefinitions emits a non-empty list on
 * conversation-reply turns when a graph is present. The conversation-reply
 * path in pipeline-v4 passes the same chipToolNames into the envelope as
 * action turns, so the contract under test is identical: given an ideate-stage
 * context with a usable graph, chip-facing tool names are populated.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { buildToolDefinitions } from "../../../../src/orchestrator/deterministic/tool-builder.js";
import { computeTurnContext } from "../../../../src/orchestrator/deterministic/turn-context.js";
import type { OrchestratorTurnRequest } from "../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

function makeRequest(hasGraph: boolean, message = 'what should I do next?'): OrchestratorTurnRequest {
  const graph: GraphV3T | null = hasGraph
    ? ({
        nodes: [
          { id: 'goal_g', kind: 'goal', label: 'Goal' },
          { id: 'opt_a', kind: 'option', label: 'Option A' },
          { id: 'fac_x', kind: 'factor', label: 'Factor X', category: 'external' },
        ],
        edges: [
          { from: 'opt_a', to: 'goal_g', strength: { mean: 0.5, std: 0.1 } },
        ],
      } as unknown as GraphV3T)
    : null;
  return {
    turn_id: 'tu-1',
    scenario_id: 'sc-1',
    message,
    context: {
      graph,
      analysis_response: null,
      framing: { stage: 'ideate' },
      messages: [],
      scenario_id: 'sc-1',
    },
  } as unknown as OrchestratorTurnRequest;
}

describe("chip tool-set on conversation-reply turns", () => {
  it("emits a non-empty chip tool list when graph is present", () => {
    const turnRequest = makeRequest(true);
    const ctx = computeTurnContext(turnRequest);
    const chipToolDefs = buildToolDefinitions(
      ctx.eligible_actions,
      ctx,
      { bypassDisambiguation: true },
    );
    const chipToolNames = chipToolDefs.map((t) => t.name);
    expect(chipToolNames.length).toBeGreaterThan(0);
    expect(chipToolNames).toContain('edit_graph');
  });

  it("emits an empty chip tool list when no graph is present", () => {
    const turnRequest = makeRequest(false);
    const ctx = computeTurnContext(turnRequest);
    const chipToolDefs = buildToolDefinitions(
      ctx.eligible_actions,
      ctx,
      { bypassDisambiguation: true },
    );
    expect(chipToolDefs).toEqual([]);
  });

  it("suppresses adjust_edge_strength from LLM tools when structural intent is detected", () => {
    const turnRequest = makeRequest(true, 'the option is not connected to the goal, fix it');
    const ctx = computeTurnContext(turnRequest);
    expect(ctx.structural_intent_detected).toBe(true);
    const toolDefs = buildToolDefinitions(ctx.eligible_actions, ctx);
    const names = toolDefs.map((t) => t.name);
    expect(names).not.toContain('adjust_edge_strength');
    expect(names).toContain('edit_graph');
  });

  it("does NOT suppress adjust_edge_strength from chip tools on structural intent", () => {
    // Chip construction uses bypassDisambiguation: true. Structural-intent
    // bias is LLM-only — chips carry explicit targets and shouldn't be
    // narrowed by LLM-safety filters.
    const turnRequest = makeRequest(true, 'the option is not connected to the goal, fix it');
    const ctx = computeTurnContext(turnRequest);
    expect(ctx.structural_intent_detected).toBe(true);
    const chipToolDefs = buildToolDefinitions(
      ctx.eligible_actions,
      ctx,
      { bypassDisambiguation: true },
    );
    const names = chipToolDefs.map((t) => t.name);
    expect(names).toContain('adjust_edge_strength');
    expect(names).toContain('edit_graph');
  });

  it("keeps adjust_edge_strength on non-structural messages", () => {
    const turnRequest = makeRequest(true, 'bump the driver strength');
    const ctx = computeTurnContext(turnRequest);
    expect(ctx.structural_intent_detected).toBe(false);
    const toolDefs = buildToolDefinitions(ctx.eligible_actions, ctx);
    const names = toolDefs.map((t) => t.name);
    expect(names).toContain('adjust_edge_strength');
  });
});
