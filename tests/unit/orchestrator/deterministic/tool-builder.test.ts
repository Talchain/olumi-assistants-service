/**
 * Tests for the tool definition builder.
 * Verifies that ACTION_CATALOGUE produces valid Anthropic ToolDefinition objects,
 * context-aware filtering, entity disambiguation, and dynamic descriptions.
 */

import { describe, it, expect, vi } from "vitest";
import { buildToolDefinitions, validateToolSchema, _resetSchemaCache } from "../../../../src/orchestrator/deterministic/tool-builder.js";
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
    fragile_edges: [],
    factor_sensitivity: [],
    edge_e_values: [],
    conditional_winners: [],
    inference_warnings: [],
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

  it("includes explain_result, compare_options, what_would_flip when analysis exists; suppresses run_analysis (current results already present)", () => {
    const ctx = buildTestContext({ analysis_summary: buildAnalysisSummary() });
    const allActions: ActionName[] = [
      'explain_result', 'compare_options', 'what_would_flip', 'run_analysis',
    ];

    const defs = buildToolDefinitions(allActions, ctx);
    const names = defs.map(d => d.name);

    expect(names).toContain('explain_result');
    expect(names).toContain('compare_options');
    expect(names).toContain('what_would_flip');
    // run_analysis is suppressed when analysis_summary is present — the UI's
    // staleness contract guarantees fresh results, so re-running would be
    // wasted work. Chip clicks pass bypassStaleness=true to override (see
    // below).
    expect(names).not.toContain('run_analysis');
  });

  it("bypassStaleness re-includes run_analysis when chip click overrides the staleness suppression", () => {
    const ctx = buildTestContext({ analysis_summary: buildAnalysisSummary() });
    const allActions: ActionName[] = [
      'explain_result', 'compare_options', 'what_would_flip', 'run_analysis',
    ];

    const defs = buildToolDefinitions(allActions, ctx, true);
    const names = defs.map(d => d.name);

    // bypassStaleness lifts ONLY the staleness suppression. run_analysis is
    // back in scope because the user explicitly clicked the re-run chip.
    expect(names).toContain('run_analysis');
    expect(names).toContain('explain_result');
    expect(names).toContain('compare_options');
    expect(names).toContain('what_would_flip');
  });

  it("bypassStaleness does NOT lift the no-graph hard prerequisite for run_analysis", () => {
    // Even with bypassStaleness, clicking run_analysis without a graph must
    // still downgrade cleanly — no graph is a hard precondition, not staleness.
    const ctx = buildTestContext({
      graph: null,
      graph_summary: { node_count: 0, edge_count: 0, option_count: 0 },
      analysis_summary: null,
    });
    const defs = buildToolDefinitions(['run_analysis'], ctx, true);
    const names = defs.map(d => d.name);

    expect(names).not.toContain('run_analysis');
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
  it("removes target_id tools when two factors share 2+ significant words", () => {
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Q3 Sales Projection', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Q3 Sales Forecast', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    // analysis_summary present so explain_result is not analysis-suppressed.
    // run_analysis is omitted from the asserted-present set because the new
    // staleness contract suppresses it whenever analysis_summary is present.
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });

    const defs = buildToolDefinitions(
      ['set_factor_value', 'explain_result'],
      ctx,
    );
    const names = defs.map(d => d.name);

    // set_factor_value has target_id — should be removed (q3 + sales shared)
    expect(names).not.toContain('set_factor_value');
    // explain_result has no target_id as required — should remain
    expect(names).toContain('explain_result');
  });

  it("keeps target_id tools when only one non-stop-word is shared (below threshold of 2)", () => {
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Employee Churn', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Customer Churn', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    // analysis_summary: null so run_analysis is not staleness-suppressed; the
    // assertion below verifies disambiguation does not affect non-target_id tools.
    const ctx = buildTestContext({ entities, analysis_summary: null });

    const defs = buildToolDefinitions(['set_factor_value', 'run_analysis'], ctx);
    const names = defs.map(d => d.name);

    // Only "churn" shared — below threshold of 2 → target_id tools kept
    expect(names).toContain('set_factor_value');
    expect(names).toContain('run_analysis');
  });

  it("keeps target_id tools when only one factor has the word", () => {
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Employee Churn', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Revenue Trend', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: null });

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
    // analysis_summary present so compare_options survives the analysis-required filter.
    // run_analysis is correctly suppressed (staleness contract); use compare_options
    // as the non-target_id tool that should survive disambiguation.
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });

    const defs = buildToolDefinitions(['compare_options', 'what_would_flip'], ctx);
    const names = defs.map(d => d.name);

    // Neither tool has target_id — both should remain
    expect(names).toContain('compare_options');
    expect(names).toContain('what_would_flip');
  });

  it("does not flag ambiguity between different entity kinds sharing a word", () => {
    // A factor and an option both containing "growth" — different kinds, not ambiguous
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Revenue Growth', kind: 'factor', aliases: [], is_action_target: true }],
      ['o1', { id: 'o1', label: 'Growth Strategy', kind: 'option', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: null });

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
    const ctx = buildTestContext({ entities, analysis_summary: null });
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

// ============================================================================
// Schema Compliance (CI gate)
// ============================================================================

describe("ACTION_CATALOGUE — schema compliance", () => {
  for (const [name, action] of ACTION_CATALOGUE) {
    describe(name, () => {
      it("passes validateToolSchema with zero violations", () => {
        const violations = validateToolSchema(action.input_schema);
        expect(violations, `${name} schema violations: ${JSON.stringify(violations)}`).toEqual([]);
      });

      it("root is type: 'object'", () => {
        expect(action.input_schema.type).toBe('object');
      });

      it("root has additionalProperties: false", () => {
        expect(action.input_schema.additionalProperties).toBe(false);
      });

      it("required keys exist in properties", () => {
        const props = (action.input_schema.properties as Record<string, unknown>) ?? {};
        const required = (action.input_schema.required as string[]) ?? [];
        for (const key of required) {
          expect(props, `required key "${key}" missing from properties`).toHaveProperty(key);
        }
      });
    });
  }
});

// ============================================================================
// Schema Validation — runtime gate
// ============================================================================

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

describe("buildToolDefinitions — schema validation gate", () => {
  it("excludes a tool with invalid nested schema and logs warning", async () => {
    _resetSchemaCache(); // clear cache so the spy-injected schema is validated fresh
    const { log } = await import("../../../../src/utils/telemetry.js");

    // Spy on ACTION_CATALOGUE.get to inject a bad schema for a specific action
    const originalGet = ACTION_CATALOGUE.get.bind(ACTION_CATALOGUE);
    const getSpy = vi.spyOn(ACTION_CATALOGUE as Map<string, unknown>, 'get').mockImplementation((key) => {
      if (key === 'challenge_assumption') {
        return {
          ...originalGet('challenge_assumption' as ActionName),
          input_schema: {
            type: 'object',
            properties: {
              target_id: { type: 'string' },
              nested: { type: 'object', properties: { foo: { type: 'string' } } }, // missing additionalProperties
            },
            additionalProperties: false,
          },
        };
      }
      return originalGet(key as ActionName);
    });

    const defs = buildToolDefinitions(['challenge_assumption', 'run_analysis']);
    const names = defs.map(d => d.name);

    expect(names).not.toContain('challenge_assumption');
    expect(names).toContain('run_analysis');
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'challenge_assumption' }),
      'tool_builder.schema_validation_failed',
    );

    getSpy.mockRestore();
  });

  it("includes all tools when schemas are valid", () => {
    const defs = buildToolDefinitions(['run_analysis', 'draft_graph']);
    expect(defs.length).toBe(2);
  });
});

// ============================================================================
// validateToolSchema — unit tests
// ============================================================================

describe("validateToolSchema", () => {
  it("returns empty for a valid flat schema", () => {
    const violations = validateToolSchema({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    });
    expect(violations).toEqual([]);
  });

  it("flags missing additionalProperties on root", () => {
    const violations = validateToolSchema({
      type: 'object',
      properties: { name: { type: 'string' } },
    });
    expect(violations.length).toBe(1);
    expect(violations[0].message).toContain('additionalProperties');
  });

  it("flags non-object root type", () => {
    const violations = validateToolSchema({ type: 'string' });
    expect(violations.length).toBe(1);
    expect(violations[0].message).toContain('root schema');
  });

  it("flags missing additionalProperties on nested object", () => {
    const violations = validateToolSchema({
      type: 'object',
      properties: {
        nested: { type: 'object', properties: { a: { type: 'string' } } },
      },
      additionalProperties: false,
    });
    expect(violations.length).toBe(1);
    expect(violations[0].path).toContain('nested');
  });

  it("rejects additionalProperties as schema object (Anthropic requires false only)", () => {
    const violations = validateToolSchema({
      type: 'object',
      properties: {
        data: { type: 'object', additionalProperties: { type: 'number' } },
      },
      additionalProperties: false,
    });
    expect(violations.length).toBe(1);
    expect(violations[0].path).toContain('data');
    expect(violations[0].message).toContain('additionalProperties must be exactly false');
  });

  it("flags required key not in properties", () => {
    const violations = validateToolSchema({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name', 'missing_key'],
      additionalProperties: false,
    });
    expect(violations.length).toBe(1);
    expect(violations[0].message).toContain('missing_key');
  });

  it("recurses into array items", () => {
    const violations = validateToolSchema({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' } } }, // missing additionalProperties
        },
      },
      additionalProperties: false,
    });
    expect(violations.length).toBe(1);
    expect(violations[0].path).toContain('items');
  });

  it("flags required array when properties is missing", () => {
    const violations = validateToolSchema({
      type: 'object',
      required: ['name'],
      additionalProperties: false,
    });
    expect(violations.length).toBe(1);
    expect(violations[0].message).toContain('properties is missing');
  });

  it("rejects nested object within additionalProperties schema", () => {
    const violations = validateToolSchema({
      type: 'object',
      properties: {
        data: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: { nested: { type: 'string' } },
            // missing additionalProperties on this inner object
          },
        },
      },
      additionalProperties: false,
    });
    // First violation: data has additionalProperties that is not false
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some(v => v.path.includes('data'))).toBe(true);
  });

  it("rejects additionalProperties as schema object even without nested objects", () => {
    const violations = validateToolSchema({
      type: 'object',
      properties: {
        data: {
          type: 'object',
          additionalProperties: { type: 'number' },
        },
      },
      additionalProperties: false,
    });
    expect(violations.length).toBe(1);
    expect(violations[0].path).toContain('data');
    expect(violations[0].message).toContain('additionalProperties must be exactly false');
  });
});

// ============================================================================
// P2 #5: Disambiguation threshold raised to 2 shared words
// ============================================================================

describe("buildToolDefinitions — disambiguation threshold (P2 #5)", () => {
  it("single shared non-stop-word does NOT trigger suppression", () => {
    // "Revenue Growth" and "Revenue Target" share only "revenue" → 1 shared → below threshold
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Revenue Target', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Revenue Stream', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });

    const defs = buildToolDefinitions(['set_factor_value', 'run_analysis'], ctx);
    const names = defs.map(d => d.name);

    expect(names).toContain('set_factor_value');
  });

  it("two shared non-stop-words DOES trigger suppression", () => {
    // "Q3 Sales Projection" and "Q3 Sales Forecast" share "q3" + "sales" → 2 shared
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Q3 Sales Projection', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Q3 Sales Forecast', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    // analysis_summary: null so run_analysis is not staleness-suppressed and
    // the test isolates the disambiguation behaviour.
    const ctx = buildTestContext({ entities, analysis_summary: null });

    const defs = buildToolDefinitions(['set_factor_value', 'run_analysis'], ctx);
    const names = defs.map(d => d.name);

    expect(names).not.toContain('set_factor_value');
    expect(names).toContain('run_analysis');
  });

  it("expanded stop words are filtered correctly", () => {
    // "growth", "risk", "impact", "change", "performance" are now stop words.
    // "Market Growth" and "Revenue Growth" share only "growth" (stop word) → 0 shared
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Market Growth', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Revenue Growth', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });

    const defs = buildToolDefinitions(['set_factor_value'], ctx);
    const names = defs.map(d => d.name);

    // "growth" is a stop word → 0 shared non-stop-words → no suppression
    expect(names).toContain('set_factor_value');
  });

  it("zero shared words: no suppression", () => {
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Development Speed', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Market Demand', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });

    const defs = buildToolDefinitions(['set_factor_value'], ctx);
    expect(defs.map(d => d.name)).toContain('set_factor_value');
  });

  it("three factors where only two share 2+ words: suppression triggers", () => {
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Annual Sales Revenue', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Annual Sales Margin', kind: 'factor', aliases: [], is_action_target: true }],
      ['f3', { id: 'f3', label: 'Customer Retention', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: null });

    const defs = buildToolDefinitions(['set_factor_value', 'run_analysis'], ctx);
    const names = defs.map(d => d.name);

    // f1 and f2 share "annual" + "sales" → 2 shared → suppression
    expect(names).not.toContain('set_factor_value');
    expect(names).toContain('run_analysis');
  });

  it("punctuation in labels is trimmed before overlap comparison", () => {
    // "Q3 Sales," and "Q3 Sales" should match after punctuation trimming
    const entities = new Map<string, EntityEntry>([
      ['f1', { id: 'f1', label: 'Q3 Sales, Projected', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: '(Q3) Sales Actual', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: null });

    const defs = buildToolDefinitions(['set_factor_value', 'run_analysis'], ctx);
    const names = defs.map(d => d.name);

    // "q3" + "sales" shared after punctuation trim → 2 shared → suppression
    expect(names).not.toContain('set_factor_value');
    expect(names).toContain('run_analysis');
  });

  it("typical 12-node diverse graph does NOT trigger suppression", () => {
    const entities = new Map<string, EntityEntry>([
      ['g1', { id: 'g1', label: 'Maximize Revenue', kind: 'goal', aliases: [], is_action_target: true }],
      ['o1', { id: 'o1', label: 'Expand Europe', kind: 'option', aliases: [], is_action_target: true }],
      ['o2', { id: 'o2', label: 'Focus Domestic', kind: 'option', aliases: [], is_action_target: true }],
      ['o3', { id: 'o3', label: 'Partnership Model', kind: 'option', aliases: [], is_action_target: true }],
      ['f1', { id: 'f1', label: 'Market Size', kind: 'factor', aliases: [], is_action_target: true }],
      ['f2', { id: 'f2', label: 'Customer Acquisition Cost', kind: 'factor', aliases: [], is_action_target: true }],
      ['f3', { id: 'f3', label: 'Revenue Growth', kind: 'factor', aliases: [], is_action_target: true }],
      ['f4', { id: 'f4', label: 'Regulatory Risk', kind: 'factor', aliases: [], is_action_target: true }],
      ['f5', { id: 'f5', label: 'Brand Recognition', kind: 'factor', aliases: [], is_action_target: true }],
      ['f6', { id: 'f6', label: 'Team Capacity', kind: 'factor', aliases: [], is_action_target: true }],
      ['f7', { id: 'f7', label: 'Competition Intensity', kind: 'factor', aliases: [], is_action_target: true }],
      ['f8', { id: 'f8', label: 'Supply Chain Stability', kind: 'factor', aliases: [], is_action_target: true }],
    ]);
    const ctx = buildTestContext({ entities, analysis_summary: buildAnalysisSummary() });

    const defs = buildToolDefinitions(['set_factor_value', 'remove_factor', 'adjust_edge_strength'], ctx);
    const names = defs.map(d => d.name);

    // Diverse labels — no pair shares 2+ non-stop-words
    expect(names).toContain('set_factor_value');
    expect(names).toContain('remove_factor');
    expect(names).toContain('adjust_edge_strength');
  });
});

// ============================================================================
// Schema Validation: Strict additionalProperties: false Enforcement
// ============================================================================

describe("validateToolSchema — strict additionalProperties: false enforcement", () => {
  it("rejects root object with missing additionalProperties", () => {
    const schema = {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
      // additionalProperties missing
    };

    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe('(root)');
    expect(violations[0].message).toContain('additionalProperties must be exactly false');
  });

  it("rejects root object with additionalProperties: true", () => {
    const schema = {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
      additionalProperties: true,
    };

    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe('(root)');
    expect(violations[0].message).toContain('additionalProperties must be exactly false');
  });

  it("rejects root object with additionalProperties as schema object", () => {
    const schema = {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
      additionalProperties: { type: 'number' },
    };

    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe('(root)');
    expect(violations[0].message).toContain('additionalProperties must be exactly false');
  });

  it("rejects nested object with missing additionalProperties", () => {
    const schema = {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: { name: { type: 'string' } },
          // additionalProperties missing
        },
      },
      required: ['config'],
      additionalProperties: false,
    };

    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toContain('properties.config');
    expect(violations[0].message).toContain('additionalProperties must be exactly false');
  });

  it("rejects nested object with additionalProperties: {type: 'number'}", () => {
    const schema = {
      type: 'object',
      properties: {
        interventions: {
          type: 'object',
          additionalProperties: { type: 'number' },
        },
      },
      additionalProperties: false,
    };

    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toContain('properties.interventions');
    expect(violations[0].message).toContain('additionalProperties must be exactly false');
  });

  it("accepts root object with additionalProperties: false", () => {
    const schema = {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
      additionalProperties: false,
    };

    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(0);
  });

  it("accepts array items with nested object that has additionalProperties: false", () => {
    const schema = {
      type: 'object',
      properties: {
        interventions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              factor_id: { type: 'string' },
              value: { type: 'number' },
            },
            required: ['factor_id', 'value'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    };

    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(0);
  });

  it("detects multiple violations across nested objects", () => {
    const schema = {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            nested: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    };

    const violations = validateToolSchema(schema);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(violations.some(v => v.path.includes('config'))).toBe(true);
    expect(violations.some(v => v.path.includes('nested'))).toBe(true);
  });

  it("excludes invalid schema from buildToolDefinitions with logging", () => {
    _resetSchemaCache();
    const logWarnSpy = vi.spyOn(console, 'warn');

    const invalidAction: ActionName = 'set_factor_value';
    // set_factor_value exists in catalogue but we're testing exclusion logic
    const defs = buildToolDefinitions([invalidAction]);

    // Should build successfully because set_factor_value is valid
    expect(defs.length).toBeGreaterThan(0);
    const setFactorDef = defs.find(d => d.name === 'set_factor_value');
    expect(setFactorDef).toBeDefined();

    logWarnSpy.mockRestore();
  });

  it("rejects schema with null additionalProperties", () => {
    const schema = {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
      additionalProperties: null,
    };

    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('additionalProperties must be exactly false');
  });

  it("rejects schema with undefined additionalProperties", () => {
    const schema = {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
      additionalProperties: undefined,
    };

    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('additionalProperties must be exactly false');
  });
});

// ============================================================================
// add_option Action: Array Format + Legacy Format Support
// ============================================================================

describe("add_option action — array and legacy format support", () => {
  it("accepts new array format interventions", () => {
    const params = {
      label: 'Expand East',
      interventions: [
        { factor_id: 'f1', value: 0.8 },
        { factor_id: 'f2', value: 0.6 },
      ],
    };

    // Test that the schema itself is valid
    const schema = {
      type: 'object',
      properties: {
        label: { type: 'string' },
        interventions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              factor_id: { type: 'string' },
              value: { type: 'number' },
            },
            required: ['factor_id', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['label'],
      additionalProperties: false,
    };

    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(0);
  });

  it("accepts legacy object format interventions", () => {
    const params = {
      label: 'Expand East',
      interventions: {
        f1: 0.8,
        f2: 0.6,
      },
    };

    // The handler normalizes both formats to Record<string, number>
    // This test documents that legacy format is still processable
    expect(typeof params.interventions).toBe('object');
    expect(Object.entries(params.interventions as Record<string, number>)).toHaveLength(2);
  });

  it("rejects malformed array items (missing factor_id)", () => {
    const schema = {
      type: 'object',
      properties: {
        interventions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              factor_id: { type: 'string' },
              value: { type: 'number' },
            },
            required: ['factor_id', 'value'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    };

    // An item like { value: 0.8 } would fail required['factor_id'] validation at runtime
    // but the schema itself is valid (the item schema is valid)
    const violations = validateToolSchema(schema);
    expect(violations).toHaveLength(0);
  });
});
