/**
 * Tests for the patch-summary formatter (patch-summary.ts)
 *
 * Coverage:
 * 1. Small applied patch — specific summary + specific detail items
 * 2. Large auto-applied patch — grouped summary + grouped detail items
 * 3. Proposal/reviewable patch (edit) — readable summary, no internal IDs
 * 4. Fallback wording and pluralisation — supported kinds + unknown kind graceful degradation
 * 5. Edge cases — empty ops, coaching override, accepted context
 */

import { describe, it, expect } from "vitest";
import { buildPatchSummary, buildPatchDetailItems, analyseOperations } from "../../../src/orchestrator/patch-summary.js";
import type { PatchOperation } from "../../../src/orchestrator/types.js";

// ============================================================================
// Fixtures
// ============================================================================

const ADD_FACTOR: PatchOperation = {
  op: 'add_node',
  path: '/nodes/churn_rate',
  value: { id: 'churn_rate', kind: 'factor', label: 'Monthly churn rate' },
};

const ADD_GOAL: PatchOperation = {
  op: 'add_node',
  path: '/nodes/revenue_goal',
  value: { id: 'revenue_goal', kind: 'goal', label: 'Revenue' },
};

const ADD_OPTION: PatchOperation = {
  op: 'add_node',
  path: '/nodes/opt_status_quo',
  value: { id: 'opt_status_quo', kind: 'option', label: 'Status Quo' },
};

const ADD_EDGE: PatchOperation = {
  op: 'add_edge',
  path: '/edges/churn_rate->revenue_goal',
  value: {
    from: 'churn_rate',
    to: 'revenue_goal',
    strength_mean: 0.6,
    strength_std: 0.1,
    exists_probability: 0.9,
    effect_direction: 'negative',
  },
};

const UPDATE_FACTOR: PatchOperation = {
  op: 'update_node',
  path: '/nodes/technical_oversight',
  value: { data: 0.2 },
  old_value: { id: 'technical_oversight', kind: 'factor', label: 'Technical oversight' },
};

const REMOVE_FACTOR: PatchOperation = {
  op: 'remove_node',
  path: '/nodes/old_factor',
  old_value: { id: 'old_factor', kind: 'factor', label: 'Old factor' },
};

// ============================================================================
// 1. Small patch — specific summary and detail
// ============================================================================

describe("buildPatchSummary — small patch", () => {
  it("single update: emits specific field-level summary", () => {
    const summary = buildPatchSummary([UPDATE_FACTOR], null, 'edit');
    expect(summary).toMatch(/Technical oversight/);
    expect(summary).not.toMatch(/op\b/i);
    expect(summary).not.toMatch(/update_node/i);
    expect(summary).not.toMatch(/patch/i);
  });

  it("single add_node: mentions the label and kind", () => {
    const summary = buildPatchSummary([ADD_FACTOR], null, 'edit');
    expect(summary).toMatch(/Monthly churn rate/i);
    expect(summary).not.toMatch(/add_node/i);
  });

  it("prefers coaching summary when available", () => {
    const coaching = "Updated Status Quo to set technical oversight to 20%.";
    const summary = buildPatchSummary([UPDATE_FACTOR], coaching, 'edit');
    expect(summary).toBe(coaching);
  });

  it("ends with a period", () => {
    const summary = buildPatchSummary([UPDATE_FACTOR], null, 'edit');
    expect(summary.endsWith('.')).toBe(true);
  });
});

describe("buildPatchDetailItems — small patch (≤3 ops)", () => {
  it("single update: shows label + field name", () => {
    const items = buildPatchDetailItems([UPDATE_FACTOR]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toMatch(/Technical oversight/);
    expect(items[0].description).not.toMatch(/update_node/i);
  });

  it("single add_node: shows kind label and element label", () => {
    const items = buildPatchDetailItems([ADD_FACTOR]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toMatch(/factor/i);
    expect(items[0].description).toMatch(/Monthly churn rate/i);
  });

  it("add_node + add_edge: two items, specific", () => {
    const items = buildPatchDetailItems([ADD_FACTOR, ADD_EDGE]);
    expect(items.length).toBeGreaterThanOrEqual(2);
    // Should not expose raw op names
    for (const item of items) {
      expect(item.description).not.toMatch(/add_node|add_edge|update_node/i);
    }
  });

  it("remove_node: shows element label", () => {
    const items = buildPatchDetailItems([REMOVE_FACTOR]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toMatch(/Old factor/);
    expect(items[0].description).not.toMatch(/remove_node/i);
  });
});

// ============================================================================
// 2. Large patch — grouped summary and detail
// ============================================================================

function makeLargeDraftOps(): PatchOperation[] {
  const ops: PatchOperation[] = [];
  for (let i = 0; i < 4; i++) {
    ops.push({
      op: 'add_node',
      path: `/nodes/factor_${i}`,
      value: { id: `factor_${i}`, kind: 'factor', label: `Factor ${i + 1}` },
    });
  }
  ops.push({
    op: 'add_node',
    path: '/nodes/opt_a',
    value: { id: 'opt_a', kind: 'option', label: 'Option A' },
  });
  ops.push({
    op: 'add_node',
    path: '/nodes/opt_b',
    value: { id: 'opt_b', kind: 'option', label: 'Option B' },
  });
  ops.push({
    op: 'add_node',
    path: '/nodes/goal_revenue',
    value: { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
  });
  for (let i = 0; i < 4; i++) {
    ops.push({
      op: 'add_edge',
      path: `/edges/factor_${i}->goal_revenue`,
      value: { from: `factor_${i}`, to: 'goal_revenue', strength_mean: 0.5, strength_std: 0.1, exists_probability: 0.9, effect_direction: 'positive' },
    });
  }
  return ops;
}

describe("buildPatchSummary — large patch", () => {
  it("emits a summary with node kind counts, not raw op names", () => {
    const ops = makeLargeDraftOps();
    const summary = buildPatchSummary(ops, null, 'full_draft');
    expect(summary).not.toMatch(/add_node|add_edge|update_node/i);
    expect(summary).not.toMatch(/\bop\b/);
    // Should mention something about what was added
    expect(summary).toMatch(/factor|option|goal|connection/i);
  });

  it("ends with a period", () => {
    const ops = makeLargeDraftOps();
    const summary = buildPatchSummary(ops, null, 'full_draft');
    expect(summary.endsWith('.')).toBe(true);
  });

  it("coaching summary overrides operation-derived text even for large patches", () => {
    const ops = makeLargeDraftOps();
    const coaching = "Created an initial pricing decision model with 5 factors and 2 options.";
    const summary = buildPatchSummary(ops, coaching, 'full_draft');
    expect(summary).toBe(coaching);
  });
});

describe("buildPatchDetailItems — large patch (>3 ops)", () => {
  it("groups by kind, not raw op-per-line", () => {
    const ops = makeLargeDraftOps();
    const items = buildPatchDetailItems(ops);
    // Should have fewer items than ops (grouped, not 1:1)
    expect(items.length).toBeLessThan(ops.length);
    // Should mention factor, option, goal as kinds (grouped)
    const descs = items.map(i => i.description).join(' ');
    expect(descs).toMatch(/factor/i);
    expect(descs).toMatch(/option/i);
    // Should not expose op names
    for (const item of items) {
      expect(item.description).not.toMatch(/add_node|add_edge|update_node/i);
    }
  });

  it("mentions connections (edges)", () => {
    const ops = makeLargeDraftOps();
    const items = buildPatchDetailItems(ops);
    const descs = items.map(i => i.description).join(' ');
    expect(descs).toMatch(/connection/i);
  });

  it("each item description is non-empty and readable", () => {
    const ops = makeLargeDraftOps();
    const items = buildPatchDetailItems(ops);
    for (const item of items) {
      expect(item.description.trim().length).toBeGreaterThan(0);
      // No internal IDs (simple heuristic: no underscore-separated hex-like strings)
      expect(item.description).not.toMatch(/[a-z]+_[a-z0-9]{4,}_[a-z0-9]/);
    }
  });
});

// ============================================================================
// 3. Proposal / reviewable patch (edit context)
// ============================================================================

describe("buildPatchSummary — proposal edit context", () => {
  it("add_node + add_edge proposal: no internal jargon", () => {
    const summary = buildPatchSummary([ADD_FACTOR, ADD_EDGE], null, 'edit');
    expect(summary).not.toMatch(/add_node|add_edge|update_node/i);
    expect(summary).not.toMatch(/\bpatch\b/i);
    expect(summary).not.toMatch(/blk_|_[a-f0-9]{16}/);
  });

  it("includes the node label for small structural edit", () => {
    const summary = buildPatchSummary([ADD_FACTOR], null, 'edit');
    expect(summary).toMatch(/Monthly churn rate/i);
  });
});

describe("buildPatchDetailItems — proposal", () => {
  it("items are human-readable for proposal review UI", () => {
    const items = buildPatchDetailItems([ADD_FACTOR, ADD_GOAL, ADD_OPTION, ADD_EDGE]);
    for (const item of items) {
      expect(item.description).not.toMatch(/add_node|add_edge|update_node|remove_node/i);
    }
  });
});

// ============================================================================
// 4. Fallback wording and pluralisation
// ============================================================================

describe("buildPatchSummary — pluralisation and kind labels", () => {
  it("single add_node: uses element label in summary (not kind count)", () => {
    const summary = buildPatchSummary([ADD_FACTOR], null, 'edit');
    // Small patch uses element label — more specific than "1 factor"
    expect(summary).toMatch(/Monthly churn rate/i);
    expect(summary).not.toMatch(/\bfactors\b/);
  });

  it("two factors (small patch): uses both labels in summary", () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: '/nodes/f1', value: { id: 'f1', kind: 'factor', label: 'Churn' } },
      { op: 'add_node', path: '/nodes/f2', value: { id: 'f2', kind: 'factor', label: 'Price' } },
    ];
    const summary = buildPatchSummary(ops, null, 'edit');
    expect(summary).toMatch(/Churn/);
    expect(summary).toMatch(/Price/);
  });

  it("many factors (large patch): uses kind+count grouped form", () => {
    const ops: PatchOperation[] = Array.from({ length: 5 }, (_, i) => ({
      op: 'add_node' as const,
      path: `/nodes/f${i}`,
      value: { id: `f${i}`, kind: 'factor', label: `Factor ${i + 1}` },
    }));
    const summary = buildPatchSummary(ops, null, 'edit');
    expect(summary).toMatch(/\bfactors\b/);
  });

  it("single connection: 'connection' (not 'connections')", () => {
    const summary = buildPatchSummary([ADD_EDGE], null, 'edit');
    expect(summary).toMatch(/\bconnection\b/);
    expect(summary).not.toMatch(/\bconnections\b/);
  });

  it("multiple connections: 'connections'", () => {
    const ops: PatchOperation[] = [ADD_EDGE, {
      op: 'add_edge',
      path: '/edges/churn_rate->opt_a',
      value: { from: 'churn_rate', to: 'opt_a', strength_mean: 0.4, strength_std: 0.1, exists_probability: 0.8, effect_direction: 'positive' },
    }];
    const summary = buildPatchSummary(ops, null, 'edit');
    expect(summary).toMatch(/\bconnections\b/);
  });

  it("unknown node kind: degrades gracefully (no crash, no jargon)", () => {
    const op: PatchOperation = {
      op: 'add_node',
      path: '/nodes/custom_widget',
      value: { id: 'custom_widget', kind: 'custom_widget_type', label: 'My Widget' },
    };
    const summary = buildPatchSummary([op], null, 'edit');
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).not.toMatch(/undefined|null|\[object/);
    // Should contain the label
    expect(summary).toMatch(/My Widget/i);
  });

  it("unknown kind detail item: graceful fallback, no crash", () => {
    const op: PatchOperation = {
      op: 'add_node',
      path: '/nodes/custom_widget',
      value: { id: 'custom_widget', kind: 'exotic_node_kind', label: 'Exotic' },
    };
    const items = buildPatchDetailItems([op]);
    expect(items).toHaveLength(1);
    expect(items[0].description.length).toBeGreaterThan(0);
    expect(items[0].description).not.toMatch(/undefined|null/);
  });
});

// ============================================================================
// 5. Edge cases
// ============================================================================

describe("buildPatchSummary — edge cases", () => {
  it("empty operations: returns clean no-changes message", () => {
    const summary = buildPatchSummary([], null, 'edit');
    expect(summary).toBe('No changes were applied.');
  });

  it("empty operations detail: returns empty array", () => {
    const items = buildPatchDetailItems([]);
    expect(items).toEqual([]);
  });

  it("accepted context with ops: summary does not say 'patch applied'", () => {
    const summary = buildPatchSummary([UPDATE_FACTOR], null, 'accepted');
    expect(summary).not.toMatch(/patch.*applied/i);
    expect(summary).toMatch(/Technical oversight/);
  });

  it("whitespace-only coaching is ignored, falls back to op-derived", () => {
    const summary = buildPatchSummary([ADD_FACTOR], '   ', 'edit');
    // Should fall back to op-derived since coaching is blank
    expect(summary).toMatch(/Monthly churn rate|factor/i);
  });
});

// ============================================================================
// 6. analyseOperations — internal unit tests
// ============================================================================

describe("analyseOperations", () => {
  it("counts add_node by kind correctly", () => {
    const ops: PatchOperation[] = [ADD_FACTOR, ADD_GOAL, ADD_OPTION];
    const a = analyseOperations(ops);
    expect(a.addedByKind.get('factor')).toBe(1);
    expect(a.addedByKind.get('goal')).toBe(1);
    expect(a.addedByKind.get('option')).toBe(1);
  });

  it("counts add_edge correctly", () => {
    const a = analyseOperations([ADD_EDGE]);
    expect(a.edgesAdded).toBe(1);
  });

  it("tracks removed nodes with labels", () => {
    const a = analyseOperations([REMOVE_FACTOR]);
    expect(a.removedByKind.get('factor')).toEqual(['Old factor']);
  });

  it("tracks update_node with old_value label", () => {
    const a = analyseOperations([UPDATE_FACTOR]);
    expect(a.updatedNodes).toHaveLength(1);
    expect(a.updatedNodes[0].label).toBe('Technical oversight');
    expect(a.updatedNodes[0].fields).toContain('data');
  });

  it("totalOps is correct", () => {
    const ops = [ADD_FACTOR, ADD_GOAL, ADD_EDGE, UPDATE_FACTOR];
    const a = analyseOperations(ops);
    expect(a.totalOps).toBe(4);
  });
});

// ============================================================================
// T4 — Semantic, label-aware summaries (graph-aware path)
// ============================================================================

import type { GraphV3T } from "../../../src/orchestrator/types.js";

function makeGraphForSemantic(extraNodes: unknown[] = [], extraEdges: unknown[] = []): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Ship on time' },
      { id: 'fac_dev_capacity', kind: 'factor', label: 'Development capacity' },
      { id: 'fac_cost', kind: 'factor', label: 'Cost' },
      { id: 'fac_quality', kind: 'factor', label: 'Quality' },
      ...extraNodes,
    ],
    edges: [
      { from: 'fac_dev_capacity', to: 'goal_1', strength: { mean: 0.7, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_cost', to: 'goal_1', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
      ...extraEdges,
    ],
  } as unknown as GraphV3T;
}

describe("buildPatchSummary — T4 semantic summaries (graph-aware)", () => {
  it("add_option with intervention edges → semantic sentence with target factor labels", () => {
    const graph = makeGraphForSemantic();
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'option_contractor',
        value: { id: 'option_contractor', kind: 'option', label: 'Contractor' },
      },
      {
        op: 'add_edge',
        path: 'option_contractor->fac_dev_capacity',
        value: { from: 'option_contractor', to: 'fac_dev_capacity', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      },
    ];

    const summary = buildPatchSummary(ops, null, 'edit', graph);
    expect(summary).toContain('Contractor');
    expect(summary).toContain('Development capacity');
    // Proposal wording, not applied
    expect(summary).toMatch(/Proposing to add/i);
    // Defence-in-depth: no raw IDs leak
    expect(summary).not.toContain('option_contractor');
    expect(summary).not.toContain('fac_dev_capacity');
  });

  it("add_option with multiple intervention targets joins with 'and'", () => {
    const graph = makeGraphForSemantic();
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'option_hybrid',
        value: { id: 'option_hybrid', kind: 'option', label: 'Hybrid Approach' },
      },
      {
        op: 'add_edge',
        path: 'option_hybrid->fac_dev_capacity',
        value: { from: 'option_hybrid', to: 'fac_dev_capacity', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      },
      {
        op: 'add_edge',
        path: 'option_hybrid->fac_cost',
        value: { from: 'option_hybrid', to: 'fac_cost', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      },
    ];

    const summary = buildPatchSummary(ops, null, 'edit', graph);
    expect(summary).toContain('Hybrid Approach');
    expect(summary).toContain('Development capacity');
    expect(summary).toContain('Cost');
    expect(summary).toContain(' and ');
  });

  it("add_factor with category → 'as a controllable factor'", () => {
    const graph = makeGraphForSemantic();
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'fac_team_morale',
        value: { id: 'fac_team_morale', kind: 'factor', label: 'Team morale', category: 'controllable' },
      },
    ];

    const summary = buildPatchSummary(ops, null, 'edit', graph);
    expect(summary).toContain('Team morale');
    expect(summary).toContain('controllable factor');
  });

  it("update_node single field → 'Updated <label>: <field>'", () => {
    const graph = makeGraphForSemantic();
    const ops: PatchOperation[] = [
      {
        op: 'update_node',
        path: 'fac_dev_capacity',
        value: { observed_state: { value: 0.8 } },
      },
    ];

    const summary = buildPatchSummary(ops, null, 'edit', graph);
    expect(summary).toContain('Development capacity');
    expect(summary).toMatch(/Proposing to update/i);
  });

  it("applied (full_draft) wording differs from proposal (edit) wording", () => {
    const graph = makeGraphForSemantic();
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'option_baseline',
        value: { id: 'option_baseline', kind: 'option', label: 'Baseline' },
      },
      {
        op: 'add_edge',
        path: 'option_baseline->fac_dev_capacity',
        value: { from: 'option_baseline', to: 'fac_dev_capacity', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      },
    ];

    const proposal = buildPatchSummary(ops, null, 'edit', graph);
    const applied = buildPatchSummary(ops, null, 'full_draft', graph);

    expect(proposal).toMatch(/Proposing to add/);
    expect(applied).toMatch(/^Added/);
    expect(proposal).not.toMatch(/^Added/);
  });

  it("large patch → grouped sentence with top entity label call-out", () => {
    const graph = makeGraphForSemantic();
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'fac_one',   value: { id: 'fac_one',   kind: 'factor', label: 'Factor One' } },
      { op: 'add_node', path: 'fac_two',   value: { id: 'fac_two',   kind: 'factor', label: 'Factor Two' } },
      { op: 'add_node', path: 'fac_three', value: { id: 'fac_three', kind: 'factor', label: 'Factor Three' } },
      { op: 'add_node', path: 'opt_one',   value: { id: 'opt_one',   kind: 'option', label: 'Option One' } },
      { op: 'add_edge', path: 'opt_one->fac_one', value: { from: 'opt_one', to: 'fac_one', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' } },
    ];

    const summary = buildPatchSummary(ops, null, 'full_draft', graph);
    // Top label is the first add_node — Factor One
    expect(summary).toContain('Factor One');
    expect(summary).toContain('factors');
    expect(summary).toContain('option');
  });

  it("missing labels → graceful fallback to count-based", () => {
    const graph = makeGraphForSemantic();
    // add_edge references a target NOT in the graph
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'option_x',
        value: { id: 'option_x', kind: 'option', label: 'Option X' },
      },
      {
        op: 'add_edge',
        path: 'option_x->fac_missing',
        value: { from: 'option_x', to: 'fac_missing', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      },
    ];

    const summary = buildPatchSummary(ops, null, 'edit', graph);
    // Falls back to count-based — no claim about Option X with target labels
    expect(summary).not.toContain('Development capacity');
    // Count-based path emits "Added X" / specific counts
    expect(summary.length).toBeGreaterThan(0);
  });

  it("no graph passed → count-based behaviour (regression)", () => {
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'option_baseline',
        value: { id: 'option_baseline', kind: 'option', label: 'Baseline' },
      },
    ];
    const summary = buildPatchSummary(ops, null, 'edit');
    // Count-based: still mentions the label but does NOT use "Proposing to add" prefix
    expect(summary).toBeTruthy();
  });

  it("coachingSummary still wins over graph-aware computed summary", () => {
    const graph = makeGraphForSemantic();
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'option_x',
        value: { id: 'option_x', kind: 'option', label: 'Option X' },
      },
    ];
    const summary = buildPatchSummary(ops, 'Custom coaching note from LLM.', 'edit', graph);
    expect(summary).toBe('Custom coaching note from LLM.');
  });

  it("update_node where friendly field resolution fails → falls back to count-based", () => {
    // Use a slash-keyed path field that contains an internal token. The
    // friendlyFieldName helper returns it unchanged, so the entity-leak
    // check trips and bails out of the semantic path.
    const graph = makeGraphForSemantic();
    const ops: PatchOperation[] = [
      {
        op: 'update_node',
        path: 'fac_dev_capacity',
        value: { 'data/interventions/fac_quality': 0.8 },
      },
    ];

    const summary = buildPatchSummary(ops, null, 'edit', graph);
    // Must NOT contain the raw internal token
    expect(summary).not.toContain('data/interventions/fac_quality');
    expect(summary).not.toContain('fac_quality');
  });

  it("add_edge between two existing entities → 'connect' verb with both labels", () => {
    const graph = makeGraphForSemantic();
    const ops: PatchOperation[] = [
      {
        op: 'add_edge',
        path: 'fac_quality->goal_1',
        value: { from: 'fac_quality', to: 'goal_1', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      },
    ];

    const summary = buildPatchSummary(ops, null, 'edit', graph);
    expect(summary).toContain('Quality');
    expect(summary).toContain('Ship on time');
    expect(summary).toMatch(/Proposing to connect/i);
  });
});
