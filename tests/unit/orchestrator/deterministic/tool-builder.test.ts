/**
 * Tests for the tool definition builder.
 * Verifies that ACTION_CATALOGUE produces valid Anthropic ToolDefinition objects,
 * context-aware filtering, entity disambiguation, and dynamic descriptions.
 */

import { describe, it, expect } from "vitest";
import { buildToolDefinitions } from "../../../../src/orchestrator/deterministic/tool-builder.js";
import { ACTION_CATALOGUE } from "../../../../src/orchestrator/deterministic/actions/registry.js";
import type { ActionName } from "../../../../src/orchestrator/deterministic/actions/types.js";
import type { DeterministicTurnContext, AnalysisSummary, EntityEntry, GraphSummary } from "../../../../src/orchestrator/deterministic/types.js";

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal DeterministicTurnContext for testing. */
function buildTestContext(overrides: Partial<{
  analysis_summary: AnalysisSummary | null;
  graph: unknown;
  graph_summary: Partial<GraphSummary>;
  entities: Map<string, EntityEntry>;
}>): DeterministicTurnContext {
  const nodes = overrides.entities ?? new Map<string, EntityEntry>();
  return {
    stage: 'evaluate',
    entities: { nodes, edges: [], option_ids: [], goal_id: null },
    graph_summary: {
      node_count: overrides.graph_summary?.node_count ?? 5,
      edge_count: overrides.graph_summary?.edge_count ?? 3,
      option_count: overrides.graph_summary?.option_count ?? 2,
      option_labels: overrides.graph_summary?.option_labels ?? ['Option A', 'Option B'],
      goal_label: overrides.graph_summary?.goal_label ?? 'Maximise revenue',
      missing_structural: overrides.graph_summary?.missing_structural ?? [],
    },
    analysis_summary: overrides.analysis_summary ?? null,
    capabilities: { can_run_analysis: true, can_explain_results: true, can_edit_graph: true, can_compare_options: true, can_challenge: true, can_generate_artefact: false },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 3, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: [],
    disambiguation_hints: [],
    graph: (overrides.graph as DeterministicTurnContext['graph']) ?? { nodes: [], edges: [] } as unknown as DeterministicTurnContext['graph'],
    analysis: null,
    conversational_state: null,
    scenario_id: 'test-scenario',
    turn_id: 'test-turn',
    analysis_inputs: null,
  };
}

function buildAnalysisSummary(overrides?: Partial<AnalysisSummary>): AnalysisSummary {
  return {
    winner: 'Option A',
    winner_probability: 0.72,
    runner_up: 'Option B',
    runner_up_probability: 0.28,
    robustness_band: 'moderate',
    top_drivers: [
      { label: 'Revenue Growth', factor_id: 'f1', sensitivity: 3.2, direction: 'positive' },
      { label: 'Churn Rate', factor_id: 'f2', sensitivity: 2.1, direction: 'negative' },
      { label: 'Market Size', factor_id: 'f3', sensitivity: 1.5, direction: 'positive' },
    ],
    fragile_edge_count: 0,
    constraints_met: true,
    constraint_tensions: [],
    ...overrides,
  };
}

// ============================================================================
// Original Tests
// ============================================================================

describe("buildToolDefinitions", () => {
  it("returns empty array for no eligible actions", () => {
    expect(buildToolDefinitions([])).toEqual([]);
  });

  it("produces valid ToolDefinition for each working action", () => {
    const workingActions: ActionName[] = [
      'set_factor_value', 'add_constraint', 'add_factor', 'adjust_edge_strength',
      'add_option', 'remove_factor', 'set_goal_target', 'run_analysis',
      'explain_result', 'compare_options', 'challenge_assumption', 'run_premortem',
      'what_would_flip', 'draft_graph',
    ];

    const defs = buildToolDefinitions(workingActions);

    expect(defs.length).toBe(14);

    for (const def of defs) {
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
      expect(def).toHaveProperty('input_schema');
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(def.input_schema).toHaveProperty('type', 'object');
      expect(def.input_schema).toHaveProperty('properties');
      expect(def.input_schema).toHaveProperty('additionalProperties', false);
    }
  });

  it("excludes generate_artefact from tool definitions", () => {
    const defs = buildToolDefinitions(['generate_artefact']);
    expect(defs.length).toBe(0);
  });

  it("skips actions not in the catalogue", () => {
    const defs = buildToolDefinitions(['nonexistent_action' as ActionName]);
    expect(defs.length).toBe(0);
  });

  it("preserves input_schema from the action definition", () => {
    const defs = buildToolDefinitions(['set_factor_value']);
    expect(defs.length).toBe(1);
    const def = defs[0];
    expect(def.name).toBe('set_factor_value');

    const schema = def.input_schema as Record<string, unknown>;
    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty('target_id');
    expect(props).toHaveProperty('value');
    expect((schema.required as string[])).toContain('target_id');
    expect((schema.required as string[])).toContain('value');
  });

  it("every action in ACTION_CATALOGUE has input_schema", () => {
    for (const [name, def] of ACTION_CATALOGUE) {
      expect(def.input_schema, `${name} missing input_schema`).toBeDefined();
      expect(typeof def.input_schema).toBe('object');
      expect(def.input_schema).toHaveProperty('type', 'object');
    }
  });
});

// ============================================================================
// Task 1: Context-Aware Tool Filtering
// ============================================================================

describe("buildToolDefinitions — context-aware filtering", () => {
  it("excludes explain_result, compare_options, what_would_flip when no analysis", () => {
    const ctx = buildTestContext({ analysis_summary: null });
    const allActions: ActionName[] = [
      'set_factor_value', 'run_analysis', 'explain_result', 'compare_options',
      'what_would_flip', 'challenge_assumption',
    ];

    const defs = buildToolDefinitions(allActions, ctx);
    const names = defs.map(d => d.name);

    expect(names).not.toContain('explain_result');
    expect(names).not.toContain('compare_options');
    expect(names).not.toContain('what_would_flip');
    // These should remain
    expect(names).toContain('set_factor_value');
    expect(names).toContain('run_analysis');
    expect(names).toContain('challenge_assumption');
  });

  it("includes explain_result, compare_options, what_would_flip when analysis exists", () => {
    const ctx = buildTestContext({ analysis_summary: buildAnalysisSummary() });
    const allActions: ActionName[] = [
      'explain_result', 'compare_options', 'what_would_flip', 'run_analysis',
    ];

    const defs = buildToolDefinitions(allActions, ctx);
    const names = defs.map(d => d.name);

    expect(names).toContain('explain_result');
    expect(names).toContain('compare_options');
    expect(names).toContain('what_would_flip');
    expect(names).toContain('run_analysis');
  });

  it("excludes edit tools and run_analysis when no graph", () => {
    const ctx = buildTestContext({
      graph: null,
      graph_summary: { node_count: 0, edge_count: 0, option_count: 0 },
    });
    const allActions: ActionName[] = [
      'set_factor_value', 'add_factor', 'add_option', 'add_constraint',
      'adjust_edge_strength', 'remove_factor', 'set_goal_target',
      'run_analysis', 'challenge_assumption',
    ];

    const defs = buildToolDefinitions(allActions, ctx);
    const names = defs.map(d => d.name);

    expect(names).not.toContain('set_factor_value');
    expect(names).not.toContain('add_factor');
    expect(names).not.toContain('add_option');
    expect(names).not.toContain('add_constraint');
    expect(names).not.toContain('adjust_edge_strength');
    expect(names).not.toContain('remove_factor');
    expect(names).not.toContain('set_goal_target');
    expect(names).not.toContain('run_analysis');
    // Non-edit, non-analysis tools should remain
    expect(names).toContain('challenge_assumption');
  });
});

// ============================================================================
// Task 2: Entity Disambiguation
// ============================================================================

describe("buildToolDefinitions — entity disambiguation", () => {
  it("removes target_id tools when two factors share a significant word", () => {
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Employee Churn', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Customer Churn', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });

    const defs = buildToolDefinitions(
      ['set_factor_value', 'run_analysis', 'explain_result'],
      ctx,
    );
    const names = defs.map(d => d.name);

    // set_factor_value has target_id — should be removed
    expect(names).not.toContain('set_factor_value');
    // run_analysis has NO target_id — should remain
    expect(names).toContain('run_analysis');
    // explain_result has no target_id as required — should remain
    expect(names).toContain('explain_result');
  });

  it("keeps target_id tools when only one factor has the word", () => {
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Employee Churn', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Revenue Growth', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });

    const defs = buildToolDefinitions(['set_factor_value', 'run_analysis'], ctx);
    const names = defs.map(d => d.name);

    expect(names).toContain('set_factor_value');
    expect(names).toContain('run_analysis');
  });

  it("keeps non-target_id tools even with ambiguous entities", () => {
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Employee Churn', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Customer Churn', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });

    const defs = buildToolDefinitions(['run_analysis', 'compare_options'], ctx);
    const names = defs.map(d => d.name);

    // Neither tool has target_id — both should remain
    expect(names).toContain('run_analysis');
    expect(names).toContain('compare_options');
  });

  it("does not flag ambiguity between different entity kinds sharing a word", () => {
    // A factor and an option both containing "growth" — different kinds, not ambiguous
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Revenue Growth', kind: 'factor', aliases: [], is_action_target: true }],
      ['o1', { id: 'o1', label: 'Growth Strategy', kind: 'option', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });

    const defs = buildToolDefinitions(['set_factor_value', 'run_analysis'], ctx);
    const names = defs.map(d => d.name);

    // Different kinds — no ambiguity, target_id tools remain
    expect(names).toContain('set_factor_value');
    expect(names).toContain('run_analysis');
  });

  it("triggers disambiguation from ctx.disambiguation_hints", () => {
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Alpha Factor', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Beta Factor', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });
    // Simulate disambiguation hints from user message
    ctx.disambiguation_hints = [
      { term: 'factor', candidates: [{ id: 'f1', label: 'Alpha Factor' }, { id: 'f2', label: 'Beta Factor' }] },
    ];

    const defs = buildToolDefinitions(['set_factor_value', 'run_analysis'], ctx);
    const names = defs.map(d => d.name);

    // disambiguation_hints triggers suppression of target_id tools
    expect(names).not.toContain('set_factor_value');
    expect(names).toContain('run_analysis');
  });
});

// ============================================================================
// Task 4: Dynamic Descriptions
// ============================================================================

describe("buildToolDefinitions — dynamic descriptions", () => {
  it("enriches explain_result description with winner and drivers when analysis exists", () => {
    const ctx = buildTestContext({ analysis_summary: buildAnalysisSummary() });
    const defs = buildToolDefinitions(['explain_result'], ctx);

    expect(defs.length).toBe(1);
    expect(defs[0].description).toContain('Option A');
    expect(defs[0].description).toContain('72%');
    expect(defs[0].description).toContain('Revenue Growth');
  });

  it("uses static description when no analysis exists", () => {
    const ctx = buildTestContext({ analysis_summary: null });
    // explain_result is excluded when no analysis — test with set_factor_value instead
    const defs = buildToolDefinitions(['set_factor_value'], ctx);

    expect(defs.length).toBe(1);
    const action = ACTION_CATALOGUE.get('set_factor_value')!;
    expect(defs[0].description).toBe(action.description);
  });

  it("enriches compare_options with option count and leader", () => {
    const ctx = buildTestContext({
      analysis_summary: buildAnalysisSummary(),
      graph_summary: { option_count: 3, option_labels: ['A', 'B', 'C'] },
    });

    const defs = buildToolDefinitions(['compare_options'], ctx);
    expect(defs[0].description).toContain('3 options');
    expect(defs[0].description).toContain('Option A');
  });

  it("enriches what_would_flip with winner and runner-up", () => {
    const ctx = buildTestContext({ analysis_summary: buildAnalysisSummary() });
    const defs = buildToolDefinitions(['what_would_flip'], ctx);

    expect(defs[0].description).toContain('Option A');
    expect(defs[0].description).toContain('Option B');
    expect(defs[0].description).toContain('72%');
    expect(defs[0].description).toContain('28%');
  });
});
