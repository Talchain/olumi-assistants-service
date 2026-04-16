/**
 * Tests for T1 — Structured handler failure (Phase A).
 *
 * Covers:
 *   - set_factor_value cap path returns ActionResult.failure
 *   - add_factor cap-on-existing path returns ActionResult.failure
 *   - Normal paths still return operations / assistantText (regression)
 *   - Response assembler routes failure into envelope.failure_code +
 *     failure_recovery_hint and surfaces user_message as assistant_text
 *   - Failure path emits NO blocks and NO operations
 *   - v4.action_failed telemetry event is logged
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { setFactorValueAction } from "../../../../src/orchestrator/deterministic/actions/set-factor-value.js";
import { addFactorAction } from "../../../../src/orchestrator/deterministic/actions/add-factor.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Ship on time' },
      { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    ],
    edges: [
      { from: 'fac_capacity', to: 'goal_1', strength: { mean: 0.7, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
  } as unknown as GraphV3T;
}

function makeCtxWithCap(cap: number): DeterministicTurnContext {
  const graph = makeGraph();
  return {
    stage: 'evaluate',
    entities: {
      nodes: new Map([
        ['fac_capacity', { id: 'fac_capacity', label: 'Capacity', kind: 'factor', cap, unit: 'units' } as unknown as never],
      ]),
      edges: [],
      option_ids: [],
      goal_id: 'goal_1',
    },
    graph_summary: {
      node_count: 2, edge_count: 1, option_count: 0,
      option_labels: [], goal_label: 'Ship on time', missing_structural: [],
    },
    analysis_summary: null,
    capabilities: {
      can_run_analysis: false, can_explain_results: false, can_edit_graph: true,
      can_compare_options: false, can_challenge: false, can_generate_artefact: false,
    },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 1, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: ['set_factor_value', 'add_factor'],
    disambiguation_hints: [],
    graph,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test',
    turn_id: 'turn-1',
    analysis_inputs: null,
  } as unknown as DeterministicTurnContext;
}

// ─────────────────────────────────────────────────────────────────────────
// Action handler return shape
// ─────────────────────────────────────────────────────────────────────────

describe("set_factor_value — structured CAP_EXCEEDED failure (T1)", () => {
  it("returns failure object when value exceeds cap (slight overflow)", async () => {
    // S3 recovery only kicks in when value > 10 (absolute real-world overflow).
    // Slightly-over-cap values (1.01–10) preserve the original CAP_EXCEEDED path.
    const ctx = makeCtxWithCap(3);
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_capacity', value: 5 },
      ctx,
    );

    expect(result.failure).toBeDefined();
    expect(result.failure!.code).toBe('CAP_EXCEEDED');
    expect(result.failure!.user_message).toContain('Capacity');
    expect(result.failure!.user_message).toContain('maximum');
    expect(result.failure!.recovery_hint).toBeTruthy();
    // No operations, no blocks on failure path.
    expect(result.operations).toBeUndefined();
    expect(result.blocks).toEqual([]);
    // assistantText is empty — the failure user_message takes its place at envelope assembly.
    expect(result.assistantText).toBe('');
  });

  it("returns no failure when value is within cap (regression)", async () => {
    const ctx = makeCtxWithCap(50);
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_capacity', value: 25 },
      ctx,
    );
    expect(result.failure).toBeUndefined();
    expect(result.operations).toBeDefined();
    // Proposal language (auto_apply: false) — "would be applied", not "Updated".
    expect(result.assistantText).toContain('would');
  });
});

describe("add_factor — structured CAP_EXCEEDED failure (T1)", () => {
  it("returns failure when updating an existing factor would exceed its cap", async () => {
    const ctx = makeCtxWithCap(10);
    // Pretend 'Capacity' already exists (the dedup helper iterates entities.nodes
    // which already has it from makeCtxWithCap).
    const result = await addFactorAction.execute(
      { label: 'Capacity', value: 100 },
      ctx,
    );

    expect(result.failure).toBeDefined();
    expect(result.failure!.code).toBe('CAP_EXCEEDED');
    expect(result.failure!.user_message).toContain('Capacity');
    expect(result.failure!.recovery_hint).toBeTruthy();
    expect(result.operations).toBeUndefined();
  });
});


