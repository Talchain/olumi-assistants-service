/**
 * Tests for the tool definition builder.
 * Verifies that ACTION_CATALOGUE produces valid Anthropic ToolDefinition objects.
 */

import { describe, it, expect } from "vitest";
import { buildToolDefinitions } from "../../../../src/orchestrator/deterministic/tool-builder.js";
import { ACTION_CATALOGUE } from "../../../../src/orchestrator/deterministic/actions/registry.js";
import type { ActionName } from "../../../../src/orchestrator/deterministic/actions/types.js";

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
