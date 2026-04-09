/**
 * Tests for the post-mutation health gate (T3).
 *
 * Strategy: build the operation fixtures by ACTUALLY running the existing
 * add_option / add_factor handlers against a stub graph. This guarantees the
 * shape under test matches what the deterministic actions emit in production —
 * not a hand-rolled approximation.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { assessMutationHealth } from "../../../../src/orchestrator/deterministic/mutation-health.js";
import { applyPatchOperations as applyOperationsToGraph } from "../../../../src/orchestrator/patch-applier.js";
import { addOptionAction } from "../../../../src/orchestrator/deterministic/actions/add-option.js";
import { addFactorAction } from "../../../../src/orchestrator/deterministic/actions/add-factor.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";
import type { PatchOperation } from "../../../../src/orchestrator/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGraph(extraNodes: unknown[] = [], extraEdges: unknown[] = []): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Ship on time' },
      { id: 'dec_1',  kind: 'decision', label: 'Hiring decision' },
      { id: 'fac_ramp', kind: 'factor', label: 'Ramp time' },
      { id: 'fac_cost', kind: 'factor', label: 'Cost' },
      ...extraNodes,
    ],
    edges: [
      { from: 'fac_ramp', to: 'goal_1', strength: { mean: 0.8, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_cost', to: 'goal_1', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
      ...extraEdges,
    ],
  } as unknown as GraphV3T;
}

function makeCtx(graph: GraphV3T): DeterministicTurnContext {
  const entitiesNodes = new Map<string, unknown>();
  for (const n of graph.nodes) {
    const node = n as { id: string; label: string; kind: string };
    entitiesNodes.set(node.id, { id: node.id, label: node.label, kind: node.kind });
  }
  return {
    stage: 'ideate',
    entities: { nodes: entitiesNodes as never, edges: [], option_ids: [], goal_id: 'goal_1' },
    graph_summary: {
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      option_count: graph.nodes.filter((n) => (n as { kind: string }).kind === 'option').length,
      option_labels: [],
      goal_label: 'Ship on time',
      missing_structural: [],
    },
    analysis_summary: null,
    capabilities: {
      can_run_analysis: false, can_explain_results: false, can_edit_graph: true,
      can_compare_options: false, can_challenge: false, can_generate_artefact: false,
    },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 1, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: ['add_option', 'add_factor'],
    disambiguation_hints: [],
    graph,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test',
    turn_id: 'turn-1',
    analysis_inputs: null,
  } as unknown as DeterministicTurnContext;
}

// ---------------------------------------------------------------------------
// applyOperationsToGraph — narrow contract
// ---------------------------------------------------------------------------

// F4: the deterministic response-assembler now uses applyPatchOperations
// from patch-applier.ts (the canonical applier) instead of a hand-rolled
// shim. The tests below pin the behaviours the health gate depends on.
describe("applyPatchOperations (canonical applier) — health gate contract", () => {
  it("applies an add_node + add_edge sequence (the add_option shape)", async () => {
    // Capture real operations from the add_option handler.
    const baseGraph = makeGraph();
    const ctx = makeCtx(baseGraph);
    const result = await addOptionAction.execute(
      {
        label: 'Hire Tech Lead',
        interventions: [{ factor_id: 'fac_ramp', value: 0.6 }],
      },
      ctx,
    );
    expect(result.operations).toBeDefined();
    const ops = result.operations!;
    // Sanity check the captured shape mirrors production.
    expect(ops.find((o) => o.op === 'add_node')).toBeDefined();
    expect(ops.find((o) => o.op === 'add_edge')).toBeDefined();

    const post = applyOperationsToGraph(baseGraph, ops);
    // New option in the post graph
    expect(post.nodes.find((n) => (n as { id?: string }).id === 'option_hire_tech_lead')).toBeDefined();
    // New edge present
    const newEdge = post.edges.find((e) => {
      const ee = e as { from?: string; to?: string };
      return ee.from === 'option_hire_tech_lead' && ee.to === 'fac_ramp';
    });
    expect(newEdge).toBeDefined();
    // Base graph untouched
    expect(baseGraph.nodes).toHaveLength(4);
    expect(baseGraph.edges).toHaveLength(2);
  });

  it("applies real add_factor operations (add_node + add_edge with default goal target)", async () => {
    const baseGraph = makeGraph();
    const ctx = makeCtx(baseGraph);
    const result = await addFactorAction.execute(
      { label: 'Team Morale', value: 0.7 },
      ctx,
    );
    expect(result.operations).toBeDefined();
    const post = applyOperationsToGraph(baseGraph, result.operations!);
    expect(post.nodes.find((n) => (n as { label?: string }).label === 'Team Morale')).toBeDefined();
    expect(post.edges.length).toBeGreaterThan(baseGraph.edges.length);
  });

  it("update_node merges value into the existing node (canonical Object.assign)", () => {
    const base = makeGraph();
    const ops: PatchOperation[] = [
      { op: 'update_node', path: 'fac_ramp', value: { observed_state: { value: 0.9 } } },
    ];
    const post = applyOperationsToGraph(base, ops);
    const updated = post.nodes.find((n) => (n as { id?: string }).id === 'fac_ramp') as
      | { id: string; label: string; observed_state?: { value: number } }
      | undefined;
    expect(updated).toBeDefined();
    // Existing fields preserved
    expect(updated!.label).toBe('Ramp time');
    // New field merged in
    expect(updated!.observed_state?.value).toBe(0.9);
  });

  it("remove_node also drops dangling edges", () => {
    const base = makeGraph();
    const ops: PatchOperation[] = [
      { op: 'remove_node', path: 'fac_ramp' },
    ];
    const post = applyOperationsToGraph(base, ops);
    expect(post.nodes.find((n) => (n as { id?: string }).id === 'fac_ramp')).toBeUndefined();
    // The fac_ramp → goal_1 edge should be gone too.
    expect(
      post.edges.find((e) => {
        const ee = e as { from?: string; to?: string };
        return ee.from === 'fac_ramp' || ee.to === 'fac_ramp';
      }),
    ).toBeUndefined();
  });

  it("unknown op kind throws (caller must catch — the response-assembler wire-in does)", () => {
    // Behaviour difference vs. the old shim: the canonical applier throws
    // PatchApplyError on unknown op kinds. The response-assembler wraps the
    // applyPatchOperations call in try/catch so the gate stays advisory and
    // never blocks the response. The throw is verified here so future changes
    // to the wire-in can't accidentally let an unknown-op crash the assembler.
    const base = makeGraph();
    const ops = [{ op: 'rename_node', path: 'fac_ramp', value: { label: 'X' } } as unknown as PatchOperation];
    expect(() => applyOperationsToGraph(base, ops)).toThrow();
  });

  it("never mutates the input graph (reference identity preserved on inputs)", () => {
    const base = makeGraph();
    const originalNodesRef = base.nodes;
    const originalEdgesRef = base.edges;
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'fac_quality', value: { id: 'fac_quality', kind: 'factor', label: 'Quality' } },
    ];
    applyOperationsToGraph(base, ops);
    expect(base.nodes).toBe(originalNodesRef);
    expect(base.edges).toBe(originalEdgesRef);
  });
});

// ---------------------------------------------------------------------------
// assessMutationHealth — gate behaviour
// ---------------------------------------------------------------------------

describe("assessMutationHealth — healthy / unhealthy classification", () => {
  it("does not introduce NEW issues on a clean add_factor mutation", async () => {
    // The baseline test graph is intentionally minimal — it may already have
    // pre-existing structural issues (e.g. fewer than two options). What we
    // care about is that the gate's POST issue set is a SUBSET of the PRE
    // issue set: a clean mutation must not introduce any new warnings.
    const baseGraph = makeGraph();
    const ctx = makeCtx(baseGraph);

    const preHealth = assessMutationHealth(null, baseGraph, []);
    const baselineIssues = new Set(preHealth.issues);

    const result = await addFactorAction.execute(
      { label: 'Team Morale', value: 0.7 },
      ctx,
    );
    const post = applyOperationsToGraph(baseGraph, result.operations!);
    const health = assessMutationHealth(baseGraph, post, result.operations!);

    const newIssues = health.issues.filter((i) => !baselineIssues.has(i));
    expect(newIssues).toEqual([]);
  });

  it("flags duplicate option labels created by the mutation", () => {
    // Pre: one option called 'Baseline'. Post: also adds another called 'Baseline'.
    const baseGraph = makeGraph(
      [{ id: 'option_baseline_old', kind: 'option', label: 'Baseline', data: { interventions: { fac_ramp: 0.5 } }, interventions: { fac_ramp: 0.5 } }],
      [{ from: 'option_baseline_old', to: 'fac_ramp', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' }],
    );
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'option_baseline_new',
        value: { id: 'option_baseline_new', kind: 'option', label: 'Baseline', data: { interventions: { fac_cost: 0.4 } } },
      },
    ];
    const post = applyOperationsToGraph(baseGraph, ops);
    const health = assessMutationHealth(baseGraph, post, ops);
    expect(health.healthy).toBe(false);
    expect(health.issues.some((i) => i.includes('Two options share the label'))).toBe(true);
  });

  it("EXEMPTS newly added options from readiness-degradation warnings", () => {
    // The new option is needs_encoding (no interventions) but should NOT be
    // flagged because it's new in the proposal flow.
    const baseGraph = makeGraph();
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'option_new',
        value: { id: 'option_new', kind: 'option', label: 'New Option', data: { interventions: {} }, interventions: {} },
      },
    ];
    const post = applyOperationsToGraph(baseGraph, ops);
    const health = assessMutationHealth(baseGraph, post, ops);
    // No "was ready" warning for the new option (it never was ready).
    expect(health.issues.find((i) => i.includes('New Option') && i.includes('was ready'))).toBeUndefined();
  });

  it("WARNS when an actively-edited existing option degrades from ready to needs_encoding (F3)", () => {
    // F3 — review feedback corrected this: actively-edited options are NOT
    // exempt. If a user updates an existing ready option in a way that
    // empties or breaks its interventions, the gate must warn. Only
    // newly-added options stay exempt (they may legitimately be needs_encoding
    // while awaiting user mapping).
    const baseGraph = makeGraph(
      [
        { id: 'option_active', kind: 'option', label: 'Active', data: { interventions: { fac_ramp: 0.5 } }, interventions: { fac_ramp: 0.5 } },
        { id: 'option_other',  kind: 'option', label: 'Other',  data: { interventions: { fac_cost: 0.3 } }, interventions: { fac_cost: 0.3 } },
      ],
      [
        { from: 'option_active', to: 'fac_ramp', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'option_other',  to: 'fac_cost', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    );
    // Update_node empties option_active's interventions (degrades ready → needs_encoding/needs_user_mapping).
    const ops: PatchOperation[] = [
      {
        op: 'update_node',
        path: 'option_active',
        value: { data: { interventions: {} }, interventions: {} },
      },
    ];
    const post = applyOperationsToGraph(baseGraph, ops);
    const health = assessMutationHealth(baseGraph, post, ops);
    // The warning MUST fire — this is the very signal the gate exists for.
    expect(health.healthy).toBe(false);
    expect(health.issues.find((i) => i.includes('"Active"') && i.includes('was ready'))).toBeDefined();
  });

  it("flags a cycle introduced by the mutation (new violation code)", () => {
    // Use a test where the mutation introduces a NEW violation code that
    // didn't exist in the pre-graph, so the K fix doesn't filter it.
    // A cycle between two factors is the cleanest trigger: pre-graph has
    // no cycle, post-graph has fac_a ↔ fac_b which triggers CYCLE_DETECTED.
    const baseGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Ship on time' },
        { id: 'dec_1',  kind: 'decision', label: 'Hiring decision' },
        { id: 'option_a', kind: 'option', label: 'A', data: { interventions: { fac_a: 0.5 } }, interventions: { fac_a: 0.5 } },
        { id: 'option_b', kind: 'option', label: 'B', data: { interventions: { fac_a: 0.7 } }, interventions: { fac_a: 0.7 } },
        { id: 'fac_a', kind: 'factor', label: 'A Factor' },
        { id: 'fac_b', kind: 'factor', label: 'B Factor' },
      ],
      edges: [
        { from: 'dec_1', to: 'option_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'dec_1', to: 'option_b', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'option_a', to: 'fac_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'option_b', to: 'fac_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'fac_a', to: 'goal_1', strength: { mean: 0.7, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'fac_b', to: 'fac_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    } as unknown as GraphV3T;
    // Mutation: add fac_a → fac_b edge, creating a cycle.
    const ops: PatchOperation[] = [
      {
        op: 'add_edge',
        path: 'fac_a->fac_b',
        value: {
          from: 'fac_a',
          to: 'fac_b',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 1,
          effect_direction: 'positive',
        },
      },
    ];
    const post = applyOperationsToGraph(baseGraph, ops);
    const health = assessMutationHealth(baseGraph, post, ops);
    expect(health.healthy).toBe(false);
    expect(health.issues.some((i) => i.toLowerCase().includes('circular') || i.toLowerCase().includes('cycle'))).toBe(true);
  });

  it("K: does NOT flag pre-existing structural violations carried over from preGraph", () => {
    // Audit fix K — the baseline graph here is missing options entirely, so
    // validateGraphStructure flags FEWER_THAN_TWO_OPTIONS on BOTH pre and
    // post. The gate must silently ignore the carry-over: an add_factor
    // mutation does not introduce that violation, so warning on every
    // mutation during early build would cry wolf. Only NEW violation codes
    // should surface.
    const baseGraph = makeGraph(); // no options — already FEWER_THAN_TWO_OPTIONS
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'fac_team_morale',
        value: { id: 'fac_team_morale', kind: 'factor', label: 'Team morale' },
      },
      {
        op: 'add_edge',
        path: 'fac_team_morale->goal_1',
        value: {
          from: 'fac_team_morale',
          to: 'goal_1',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 1,
          effect_direction: 'positive',
        },
      },
    ];
    const post = applyOperationsToGraph(baseGraph, ops);
    const health = assessMutationHealth(baseGraph, post, ops);
    // Clean mutation that does NOT introduce a new structural violation.
    // Pre-existing carry-overs (like FEWER_THAN_TWO_OPTIONS) must be filtered.
    expect(health.issues.find((i) => i.toLowerCase().includes('fewer than two options'))).toBeUndefined();
    expect(health.issues.find((i) => i.toLowerCase().includes('goal'))).toBeUndefined();
  });

  it("never throws when preGraph is null (paranoid path)", () => {
    const baseGraph = makeGraph();
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'fac_quality',
        value: { id: 'fac_quality', kind: 'factor', label: 'Quality' },
      },
    ];
    const post = applyOperationsToGraph(baseGraph, ops);
    expect(() => assessMutationHealth(null, post, ops)).not.toThrow();
  });
});
