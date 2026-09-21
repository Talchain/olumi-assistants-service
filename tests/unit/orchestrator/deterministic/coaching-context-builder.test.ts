/**
 * Tests for the coaching policy engine (WS1).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { buildCoachingContext } from "../../../../src/orchestrator/deterministic/coaching-context-builder.js";
import { defaultSessionState } from "../../../../src/orchestrator/deterministic/session-state.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";

// ============================================================================
// Fixture helpers
// ============================================================================

function makeContext(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  return {
    stage: 'ideate',
    entities: {
      nodes: new Map([
        ['opt_a', { id: 'opt_a', label: 'Hire Tech Lead', kind: 'option', aliases: [], is_action_target: true }],
        ['opt_b', { id: 'opt_b', label: 'Hire Two Developers', kind: 'option', aliases: [], is_action_target: true }],
        ['f1', { id: 'f1', label: 'Cost Per Developer', kind: 'factor', aliases: [], is_action_target: false, category: 'financial', value: 150000, unit: 'USD' }],
        ['f2', { id: 'f2', label: 'Technical Direction', kind: 'factor', aliases: [], is_action_target: false, category: 'capability' }],
        ['f3', { id: 'f3', label: 'Delivery Capacity', kind: 'factor', aliases: [], is_action_target: false, category: 'capability' }],
      ]),
      edges: [
        { from: 'opt_a', to: 'f2', from_label: 'Hire Tech Lead', to_label: 'Technical Direction', strength_mean: 0.8 },
        { from: 'opt_b', to: 'f3', from_label: 'Hire Two Developers', to_label: 'Delivery Capacity', strength_mean: 0.7 },
        { from: 'f1', to: 'f3', from_label: 'Cost Per Developer', to_label: 'Delivery Capacity', strength_mean: 0.5 },
      ],
      option_ids: ['opt_a', 'opt_b'],
      goal_id: 'goal_1',
    } as unknown as DeterministicTurnContext['entities'],
    graph_summary: {
      node_count: 5,
      edge_count: 3,
      option_count: 2,
      goal_label: 'Best hiring strategy',
      option_labels: ['Hire Tech Lead', 'Hire Two Developers'],
      missing_structural: [],
    } as unknown as DeterministicTurnContext['graph_summary'],
    analysis_summary: null,
    capabilities: { can_run_analysis: true, can_explain_results: false, can_edit_graph: true, can_compare_options: false, can_challenge: false, can_generate_artefact: false } as DeterministicTurnContext['capabilities'],
    blockers: [],
    signals: { close_call: false, dominant_factor: null, default_value_count: 2, weak_edges: [], high_uncertainty_factors: ['f2', 'f3'] } as unknown as DeterministicTurnContext['signals'],
    conversation: { turn_count: 3, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null } as unknown as DeterministicTurnContext['conversation'],
    eligible_actions: [],
    disambiguation_hints: [],
    graph: null,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test-scenario',
    turn_id: 'test-turn',
    analysis_inputs: null,
    ...overrides,
  } as DeterministicTurnContext;
}

function makeAnalysis(overrides: Partial<DeterministicTurnContext['analysis_summary']> = {}): NonNullable<DeterministicTurnContext['analysis_summary']> {
  return {
    winner: 'Hire Tech Lead',
    winner_probability: 0.72,
    runner_up: 'Hire Two Developers',
    runner_up_probability: 0.28,
    robustness_band: 'moderate',
    top_drivers: [
      { label: 'Cost Per Developer', factor_id: 'f1', sensitivity: 0.42, direction: 'negative' },
      { label: 'Technical Direction', factor_id: 'f2', sensitivity: 0.25, direction: 'positive' },
    ],
    fragile_edge_count: 1,
    fragile_edges: [{ label: 'Cost \u2192 Delivery Capacity', switch_probability: 0.18 }],
    factor_sensitivity: [],
    edge_e_values: [],
    conditional_winners: [],
    inference_warnings: [],
    constraints_met: true,
    constraint_tensions: [],
    ...overrides,
  } as NonNullable<DeterministicTurnContext['analysis_summary']>;
}

// ============================================================================
// coaching_mode
// ============================================================================

describe("coaching_mode", () => {
  it("returns orient for FRAME with no graph", () => {
    const ctx = makeContext({ stage: 'frame', graph_summary: { node_count: 0, edge_count: 0, option_count: 0, goal_label: null, option_labels: [], missing_structural: [] } as unknown as DeterministicTurnContext['graph_summary'] });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.coaching_mode).toBe('orient');
  });

  it("returns calibrate for IDEATE with AI-estimated factors", () => {
    const ctx = makeContext({ stage: 'ideate' });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.coaching_mode).toBe('calibrate');
  });

  it("returns challenge for IDEATE with zero default values", () => {
    const ctx = makeContext({
      stage: 'ideate',
      signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.coaching_mode).toBe('challenge');
  });

  it("returns challenge for EVALUATE with fragile result", () => {
    const ctx = makeContext({
      stage: 'evaluate',
      analysis_summary: makeAnalysis({ robustness_band: 'fragile' }),
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.coaching_mode).toBe('challenge');
  });

  it("returns decide for EVALUATE with stable result", () => {
    const ctx = makeContext({
      stage: 'evaluate',
      analysis_summary: makeAnalysis({ robustness_band: 'stable' }),
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.coaching_mode).toBe('decide');
  });
});

// ============================================================================
// primary_move
// ============================================================================

describe("primary_move", () => {
  it("returns name_tradeoff post-draft with no analysis", () => {
    const ctx = makeContext({ stage: 'ideate' });
    const result = buildCoachingContext(ctx, defaultSessionState());
    // In ideate with no analysis, name_tradeoff takes precedence (post-draft rule)
    expect(result.primary_move).toBe('name_tradeoff');
  });

  it("returns name_tradeoff in ideate with zero defaults", () => {
    const ctx = makeContext({
      stage: 'ideate',
      signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.primary_move).toBe('name_tradeoff');
  });

  it("returns present_findings with fresh analysis", () => {
    const ctx = makeContext({
      stage: 'evaluate',
      analysis_summary: makeAnalysis(),
      signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.primary_move).toBe('present_findings');
  });

  it("returns guide_intake for FRAME with no graph", () => {
    const ctx = makeContext({
      stage: 'frame',
      graph_summary: { node_count: 0, edge_count: 0, option_count: 0, goal_label: null, option_labels: [], missing_structural: [] } as unknown as DeterministicTurnContext['graph_summary'],
      signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.primary_move).toBe('guide_intake');
  });

  it("returns challenge_preference on prediction mismatch", () => {
    const ctx = makeContext({
      stage: 'evaluate',
      analysis_summary: makeAnalysis({ winner: 'Hire Tech Lead' }),
      signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const session = { ...defaultSessionState(), prediction: 'Hire Two Developers' };
    const result = buildCoachingContext(ctx, session);
    expect(result.primary_move).toBe('challenge_preference');
  });
});

// ============================================================================
// headline
// ============================================================================

describe("headline", () => {
  it("returns null when no analysis", () => {
    const ctx = makeContext();
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.headline).toBeNull();
  });

  it("computes headline from analysis", () => {
    const ctx = makeContext({ analysis_summary: makeAnalysis() });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.headline).not.toBeNull();
    expect(result.headline!.leading_option).toBe('Hire Tech Lead');
    expect(result.headline!.leading_probability).toBe(72);
    expect(result.headline!.runner_up).toBe('Hire Two Developers');
    expect(result.headline!.runner_up_probability).toBe(28);
    expect(result.headline!.win_gap).toBe(44);
    expect(result.headline!.stability_band).toBe('moderate');
  });
});

// ============================================================================
// tradeoff (precedence chain)
// ============================================================================

describe("tradeoff", () => {
  it("returns null with fewer than 2 options", () => {
    const ctx = makeContext({
      entities: {
        ...makeContext().entities,
        option_ids: ['opt_a'],
      } as unknown as DeterministicTurnContext['entities'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.tradeoff).toBeNull();
  });

  it("derives tradeoff from unique intervention targets", () => {
    const ctx = makeContext();
    const result = buildCoachingContext(ctx, defaultSessionState());
    // opt_a → f2 (Technical Direction), opt_b → f3 (Delivery Capacity)
    expect(result.tradeoff).not.toBeNull();
    expect(result.tradeoff!.option_a).toBe('Hire Tech Lead');
    expect(result.tradeoff!.benefit_a).toBe('Technical Direction');
    expect(result.tradeoff!.option_b).toBe('Hire Two Developers');
    expect(result.tradeoff!.benefit_b).toBe('Delivery Capacity');
  });

  it("returns null when options have no edges", () => {
    const ctx = makeContext({
      entities: {
        ...makeContext().entities,
        edges: [],
      } as unknown as DeterministicTurnContext['entities'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.tradeoff).toBeNull();
  });
});

// ============================================================================
// biggest_inference
// ============================================================================

describe("biggest_inference", () => {
  it("returns null when all factors are user-provided", () => {
    const ctx = makeContext({
      signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.biggest_inference).toBeNull();
  });

  it("picks AI-estimated factor with highest edge count pre-analysis", () => {
    const ctx = makeContext();
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.biggest_inference).not.toBeNull();
    // f3 has 2 edges (opt_b→f3, f1→f3), f2 has 1 edge (opt_a→f2)
    expect(result.biggest_inference!.factor_id).toBe('f3');
    expect(result.biggest_inference!.source).toBe('ai_estimated');
  });
});

// ============================================================================
// calibration_target
// ============================================================================

describe("calibration_target", () => {
  it("returns null when no uncalibrated drivers", () => {
    const ctx = makeContext({
      signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.calibration_target).toBeNull();
  });

  it("picks first uncalibrated high-uncertainty factor", () => {
    const ctx = makeContext();
    const result = buildCoachingContext(ctx, defaultSessionState());
    // With no analysis, drivers are empty, so fallback to high_uncertainty_factors
    expect(result.calibration_target).not.toBeNull();
    expect(['f2', 'f3']).toContain(result.calibration_target!.factor_id);
  });

  it("skips already-calibrated factors", () => {
    const ctx = makeContext();
    const session = { ...defaultSessionState(), calibrations_provided: ['f2', 'f3'] };
    const result = buildCoachingContext(ctx, session);
    expect(result.calibration_target).toBeNull();
  });
});

// ============================================================================
// drivers
// ============================================================================

describe("drivers", () => {
  it("returns empty when no analysis", () => {
    const ctx = makeContext();
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.drivers).toEqual([]);
  });

  it("returns max 3 drivers from analysis", () => {
    const ctx = makeContext({ analysis_summary: makeAnalysis() });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.drivers.length).toBeLessThanOrEqual(3);
    expect(result.drivers[0].factor_label).toBe('Cost Per Developer');
    expect(result.drivers[0].sensitivity).toBe(0.42);
  });
});

// ============================================================================
// provenance
// ============================================================================

describe("provenance counts", () => {
  it("counts AI-estimated from signals when no raw graph", () => {
    const ctx = makeContext();
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.ai_estimated_count).toBe(2); // default_value_count
    // total_factor_count counts only kind === 'factor', not options/goal
    expect(result.total_factor_count).toBe(3); // f1, f2, f3 (not opt_a, opt_b)
  });
});

// ============================================================================
// triggered_plays
// ============================================================================

describe("triggered_plays", () => {
  it("triggers dominant_factor when sensitivity > 0.5", () => {
    const ctx = makeContext({
      analysis_summary: makeAnalysis({
        top_drivers: [
          { label: 'Cost', factor_id: 'f1', sensitivity: 0.55, direction: 'negative' },
        ],
      }),
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    const play = result.triggered_plays.find(p => p.play === 'dominant_factor');
    expect(play).toBeDefined();
    expect(play!.factor_label).toBe('Cost');
  });

  it("triggers robustness when result is fragile", () => {
    const ctx = makeContext({
      analysis_summary: makeAnalysis({ robustness_band: 'fragile', fragile_edge_count: 3 }),
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.triggered_plays.find(p => p.play === 'robustness')).toBeDefined();
  });

  it("triggers inference_warning when 3+ default values", () => {
    const ctx = makeContext({
      signals: { close_call: false, dominant_factor: null, default_value_count: 4, weak_edges: [], high_uncertainty_factors: ['f1', 'f2', 'f3', 'f4'] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.triggered_plays.find(p => p.play === 'inference_warning')).toBeDefined();
  });

  it("deduplicates against session plays_fired", () => {
    const ctx = makeContext({
      signals: { close_call: false, dominant_factor: null, default_value_count: 4, weak_edges: [], high_uncertainty_factors: ['f1', 'f2', 'f3', 'f4'] } as unknown as DeterministicTurnContext['signals'],
    });
    const session = { ...defaultSessionState(), plays_fired: ['inference_warning'] };
    const result = buildCoachingContext(ctx, session);
    expect(result.triggered_plays.find(p => p.play === 'inference_warning')).toBeUndefined();
  });

  it("triggers complexity_check when > 12 nodes", () => {
    const ctx = makeContext({
      graph_summary: { node_count: 15, edge_count: 20, option_count: 2, goal_label: 'Goal', option_labels: ['A', 'B'], missing_structural: [] } as unknown as DeterministicTurnContext['graph_summary'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.triggered_plays.find(p => p.play === 'complexity_check')).toBeDefined();
  });

  it("triggers conditional_winner when flipped winner exists", () => {
    const ctx = makeContext({
      analysis_summary: makeAnalysis({
        conditional_winners: [{ scenario: 'If cost doubles', winner_label: 'Hire Two Developers', probability: 0.6 }],
      }),
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.triggered_plays.find(p => p.play === 'conditional_winner')).toBeDefined();
  });
});

// ============================================================================
// top_fragile
// ============================================================================

describe("top_fragile", () => {
  it("returns null without analysis", () => {
    const ctx = makeContext();
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.top_fragile).toBeNull();
  });

  it("picks the top fragile edge", () => {
    const ctx = makeContext({ analysis_summary: makeAnalysis() });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.top_fragile).not.toBeNull();
    expect(result.top_fragile!.flip_probability).toBe(0.18);
  });

  it("HEAD-ONLY MUTANT — selects the finite maximum from unsorted fragile edges", () => {
    const ctx = makeContext({
      analysis_summary: makeAnalysis({
        fragile_edges: [
          { label: 'Head factor → Head outcome', switch_probability: 0.12 },
          { label: 'Maximum factor → Maximum outcome', switch_probability: 0.81 },
          { label: 'Middle factor → Middle outcome', switch_probability: 0.4 },
        ],
      }),
    });
    const result = buildCoachingContext(ctx, defaultSessionState());

    expect(result.top_fragile).toEqual({
      source_label: 'Maximum factor',
      target_label: 'Maximum outcome',
      flip_probability: 0.81,
    });
  });
});

// ============================================================================
// critical_gap
// ============================================================================

describe("critical_gap", () => {
  it("flags narrow_options when only 1 option", () => {
    const ctx = makeContext({
      entities: {
        ...makeContext().entities,
        option_ids: ['opt_a'],
      } as unknown as DeterministicTurnContext['entities'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.critical_gap?.type).toBe('narrow_options');
  });
});

// ============================================================================
// prediction_state
// ============================================================================

describe("prediction_state", () => {
  it("returns none when no prediction", () => {
    const ctx = makeContext();
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.prediction_state).toBe('none');
  });

  it("returns match when prediction matches winner", () => {
    const ctx = makeContext({ analysis_summary: makeAnalysis({ winner: 'Hire Tech Lead' }) });
    const session = { ...defaultSessionState(), prediction: 'Hire Tech Lead' };
    const result = buildCoachingContext(ctx, session);
    expect(result.prediction_state).toBe('match');
  });

  it("returns mismatch when prediction differs", () => {
    const ctx = makeContext({ analysis_summary: makeAnalysis({ winner: 'Hire Tech Lead' }) });
    const session = { ...defaultSessionState(), prediction: 'Hire Two Developers' };
    const result = buildCoachingContext(ctx, session);
    expect(result.prediction_state).toBe('mismatch');
  });
});

// ============================================================================
// cta
// ============================================================================

describe("cta", () => {
  it("provides guide_intake CTA for orient mode", () => {
    const ctx = makeContext({
      stage: 'frame',
      graph_summary: { node_count: 0, edge_count: 0, option_count: 0, goal_label: null, option_labels: [], missing_structural: [] } as unknown as DeterministicTurnContext['graph_summary'],
      signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.cta).not.toBeNull();
    expect(result.cta!.readiness).toBe('not_ready');
  });

  it("provides present_findings CTA with driver info", () => {
    const ctx = makeContext({
      stage: 'evaluate',
      analysis_summary: makeAnalysis(),
      signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.cta).not.toBeNull();
    expect(result.cta!.guidance).toContain('Cost Per Developer');
  });
});

// ============================================================================
// chip_inputs
// ============================================================================

describe("chip_inputs", () => {
  it("reflects stage and analysis state", () => {
    const ctx = makeContext({ stage: 'ideate' });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.chip_inputs.stage).toBe('ideate');
    expect(result.chip_inputs.has_analysis).toBe(false);
    expect(result.chip_inputs.analysis_fresh).toBe(false);
  });

  it("includes dominant factor label when present", () => {
    const ctx = makeContext({
      signals: { close_call: false, dominant_factor: 'f1', default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.chip_inputs.dominant_factor_label).toBe('Cost Per Developer');
  });
});

// ============================================================================
// Golden fixture: full EVALUATE context
// ============================================================================

describe("golden fixture — EVALUATE with fresh analysis", () => {
  it("produces a complete coaching context", () => {
    const ctx = makeContext({
      stage: 'evaluate',
      analysis_summary: makeAnalysis({ robustness_band: 'moderate' }),
      signals: {
        close_call: false,
        dominant_factor: 'f1',
        default_value_count: 2,
        weak_edges: [],
        high_uncertainty_factors: ['f2'],
      } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());

    // All fields should be populated
    expect(result.coaching_mode).toBeDefined();
    expect(result.primary_move).toBeDefined();
    expect(result.headline).not.toBeNull();
    expect(result.drivers.length).toBeGreaterThan(0);
    expect(result.chip_inputs.stage).toBe('evaluate');
    expect(result.chip_inputs.has_analysis).toBe(true);
    expect(result.total_factor_count).toBeGreaterThan(0);
  });
});

// ============================================================================
// risk_factor_count with kind === 'risk' nodes
// ============================================================================

describe("risk_factor_count — risk node kind", () => {
  it("counts kind === 'risk' nodes in entity registry fallback", () => {
    const ctx = makeContext({
      entities: {
        nodes: new Map([
          ['opt_a', { id: 'opt_a', label: 'Option A', kind: 'option', aliases: [], is_action_target: true }],
          ['f1', { id: 'f1', label: 'Cost', kind: 'factor', aliases: [], is_action_target: false }],
          ['r1', { id: 'r1', label: 'Regulatory Risk', kind: 'risk', aliases: [], is_action_target: false }],
          ['r2', { id: 'r2', label: 'Market Risk', kind: 'risk', aliases: [], is_action_target: false }],
        ]),
        edges: [],
        option_ids: ['opt_a'],
        goal_id: null,
      } as unknown as DeterministicTurnContext['entities'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.risk_factor_count).toBe(2);
    // factor count should NOT include risk nodes
    expect(result.total_factor_count).toBe(1);
  });

  it("counts kind === 'risk' nodes from raw graph", () => {
    const ctx = makeContext({
      graph: {
        nodes: [
          { id: 'f1', kind: 'factor', label: 'Cost', observed_state: { value: 100 } },
          { id: 'f2', kind: 'factor', label: 'Speed', observed_state: { value: 50, extractionType: 'inferred' } },
          { id: 'r1', kind: 'risk', label: 'Compliance Risk', observed_state: {} },
          { id: 'opt_a', kind: 'option', label: 'A' },
        ],
        edges: [],
      } as unknown as DeterministicTurnContext['graph'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.risk_factor_count).toBe(1);
    expect(result.total_factor_count).toBe(2); // only factors
    expect(result.ai_estimated_count).toBe(1); // f2 is inferred
    expect(result.user_provided_count).toBe(1); // f1 is user-provided
  });

  it("does not flag missing_factor gap when risk nodes exist", () => {
    const ctx = makeContext({
      entities: {
        nodes: new Map([
          ['opt_a', { id: 'opt_a', label: 'A', kind: 'option', aliases: [], is_action_target: true }],
          ['opt_b', { id: 'opt_b', label: 'B', kind: 'option', aliases: [], is_action_target: true }],
          ['f1', { id: 'f1', label: 'Cost', kind: 'factor', aliases: [], is_action_target: false }],
          ['f2', { id: 'f2', label: 'Speed', kind: 'factor', aliases: [], is_action_target: false }],
          ['r1', { id: 'r1', label: 'Downtime Risk', kind: 'risk', aliases: [], is_action_target: false }],
        ]),
        edges: [],
        option_ids: ['opt_a', 'opt_b'],
        goal_id: null,
      } as unknown as DeterministicTurnContext['entities'],
      graph_summary: { node_count: 5, edge_count: 0, option_count: 2, goal_label: 'Goal', option_labels: ['A', 'B'], missing_structural: [] } as unknown as DeterministicTurnContext['graph_summary'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result.risk_factor_count).toBe(1);
    // With risk nodes present, critical_gap should NOT be 'missing_factor' (no risk)
    expect(result.critical_gap?.type).not.toBe('missing_factor');
  });
});

// ============================================================================
// Snapshot tests — FRAME / IDEATE / EVALUATE
// ============================================================================

describe("snapshot — FRAME context", () => {
  it("matches expected shape", () => {
    const ctx = makeContext({
      stage: 'frame',
      graph_summary: { node_count: 0, edge_count: 0, option_count: 0, goal_label: null, option_labels: [], missing_structural: [] } as unknown as DeterministicTurnContext['graph_summary'],
      entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null } as unknown as DeterministicTurnContext['entities'],
      signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result).toMatchSnapshot();
  });
});

describe("snapshot — IDEATE context (post-draft)", () => {
  it("matches expected shape", () => {
    const ctx = makeContext({ stage: 'ideate' });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result).toMatchSnapshot();
  });
});

describe("snapshot — EVALUATE context (fresh analysis)", () => {
  it("matches expected shape", () => {
    const ctx = makeContext({
      stage: 'evaluate',
      analysis_summary: makeAnalysis(),
      signals: { close_call: false, dominant_factor: 'f1', default_value_count: 2, weak_edges: [], high_uncertainty_factors: ['f2'] } as unknown as DeterministicTurnContext['signals'],
    });
    const result = buildCoachingContext(ctx, defaultSessionState());
    expect(result).toMatchSnapshot();
  });
});
