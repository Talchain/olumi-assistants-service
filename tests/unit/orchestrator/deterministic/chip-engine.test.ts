/**
 * Tests for the typed chip engine (WS5).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { computeChips, getChipIdsForSession } from "../../../../src/orchestrator/deterministic/chip-engine.js";
import { chipActionToTool } from "../../../../src/orchestrator/deterministic/action-tool-mapping.js";
import type { CoachingContext } from "../../../../src/orchestrator/deterministic/coaching-context-builder.js";
import type { SessionState } from "../../../../src/orchestrator/deterministic/session-state.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";
import { defaultSessionState } from "../../../../src/orchestrator/deterministic/session-state.js";

/**
 * Default tool list for tests — includes all tools that would typically be
 * available. Tests that want to verify availability filtering pass a
 * restricted list instead.
 */
const ALL_TOOLS = [
  'run_analysis', 'explain_result', 'compare_options', 'what_would_flip',
  'challenge_assumption', 'run_premortem', 'set_factor_value', 'add_factor',
  'add_option', 'add_constraint', 'adjust_edge_strength', 'remove_factor',
  'set_goal_target', 'generate_artefact', 'draft_graph',
];

// ============================================================================
// Fixtures
// ============================================================================

function makeCoaching(overrides: Partial<CoachingContext> = {}): CoachingContext {
  return {
    coaching_mode: 'calibrate',
    primary_move: 'surface_assumption',
    ask_question_now: false,
    challenge_now: false,
    response_posture: 'exploratory',
    headline: null,
    tradeoff: null,
    biggest_inference: null,
    calibration_target: null,
    ai_estimated_count: 0,
    user_provided_count: 0,
    total_factor_count: 0,
    drivers: [],
    top_fragile: null,
    triggered_plays: [],
    cta: null,
    risk_factor_count: 0,
    option_mechanism_overlap: false,
    critical_gap: null,
    prediction_state: 'none',
    chip_inputs: {
      stage: 'ideate',
      has_analysis: false,
      analysis_fresh: false,
      top_uncalibrated_factor: null,
      has_risk_factors: false,
      option_mechanism_overlap: false,
      stability_band: null,
      dominant_factor_label: null,
    },
    ...overrides,
  } as CoachingContext;
}

function makeTurnContext(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  return {
    stage: 'ideate',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null } as unknown as DeterministicTurnContext['entities'],
    graph_summary: { node_count: 5, edge_count: 3, option_count: 2, goal_label: 'Goal', option_labels: ['A', 'B'], missing_structural: [] } as unknown as DeterministicTurnContext['graph_summary'],
    analysis_summary: null,
    capabilities: {} as DeterministicTurnContext['capabilities'],
    blockers: [],
    signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    conversation: { turn_count: 1, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null } as unknown as DeterministicTurnContext['conversation'],
    eligible_actions: [],
    disambiguation_hints: [],
    graph: null,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test',
    turn_id: 'test',
    analysis_inputs: null,
    ...overrides,
  } as DeterministicTurnContext;
}

// ============================================================================
// Shared assertions
// ============================================================================

function assertChipShape(chip: { label: string; prompt: string; action_type?: string }) {
  const wordCount = chip.label.split(/\s+/).filter(Boolean).length;
  expect(wordCount, `label "${chip.label}" is ${wordCount} words, max 6`).toBeLessThanOrEqual(6);
  expect(chip.label).not.toMatch(/[\u2013\u2014]/);
  expect(chip.prompt).not.toMatch(/[\u2013\u2014]/);
  // Chip labels must NOT be tool-name strings like "Set factor value".
  expect(chip.label).not.toBe('Set factor value');
  expect(chip.label).not.toBe('Add factor');
  expect(chip.label).not.toBe('Add option');
  expect(chip.label).not.toBe('Add constraint');
  expect(chip.label).not.toBe('Challenge assumption');
  expect(chip.label).not.toBe('Explain results');
  expect(chip.label).not.toBe('Compare options');
}

// ============================================================================
// Post-draft contexts
// ============================================================================

describe("computeChips — post-draft, high AI-estimated", () => {
  it("returns calibrate + challenge + progress", () => {
    const coaching = makeCoaching({
      ai_estimated_count: 3,
      chip_inputs: {
        stage: 'ideate',
        has_analysis: false,
        analysis_fresh: false,
        top_uncalibrated_factor: null,
        has_risk_factors: false,
        option_mechanism_overlap: false,
        stability_band: null,
        dominant_factor_label: null,
      },
      calibration_target: {
        source_label: 'Cost Per Developer',
        target_label: 'Productivity',
        factor_id: 'f_cost',
      },
    });
    const chips = computeChips(coaching, defaultSessionState(), makeTurnContext(), null, [], ALL_TOOLS);
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips.length).toBeGreaterThanOrEqual(2);
    for (const chip of chips) assertChipShape(chip);
    // At least one progress chip.
    expect(chips.some(c => c.action_type === 'run_analysis')).toBe(true);
    // Calibrate chip references the calibration target.
    expect(chips.some(c => c.label.includes('Calibrate'))).toBe(true);
    // Challenge chip present.
    expect(chips.some(c => c.label === 'What could go wrong?')).toBe(true);
  });
});

describe("computeChips — post-draft, no risk factors", () => {
  it("returns challenge + alternatives + progress", () => {
    const coaching = makeCoaching({
      risk_factor_count: 0,
      ai_estimated_count: 0,
    });
    const chips = computeChips(coaching, defaultSessionState(), makeTurnContext(), null, [], ALL_TOOLS);
    expect(chips.some(c => c.label === 'What could go wrong?')).toBe(true);
    expect(chips.some(c => c.action_type === 'run_analysis')).toBe(true);
    for (const chip of chips) assertChipShape(chip);
  });
});

// ============================================================================
// Post-analysis contexts
// ============================================================================

describe("computeChips — post-analysis, fragile result", () => {
  it("returns what-would-change + calibrate + compare", () => {
    const coaching = makeCoaching({
      drivers: [
        { factor_label: 'Cost Per Developer', factor_id: 'f_cost', sensitivity: 0.42, is_ai_estimated: true, confidence_band: 'medium' },
      ],
      chip_inputs: {
        stage: 'evaluate',
        has_analysis: true,
        analysis_fresh: true,
        top_uncalibrated_factor: 'f_cost',
        has_risk_factors: true,
        option_mechanism_overlap: false,
        stability_band: 'fragile',
        dominant_factor_label: null,
      },
    });
    const chips = computeChips(coaching, defaultSessionState(), makeTurnContext({ stage: 'evaluate' }), null, [], ALL_TOOLS);
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips.some(c => c.label === 'What would change this?')).toBe(true);
    expect(chips.some(c => c.label.startsWith('Calibrate'))).toBe(true);
    expect(chips.some(c => c.label === 'Compare the options')).toBe(true);
    for (const chip of chips) assertChipShape(chip);
  });
});

describe("computeChips — post-analysis, dominant factor", () => {
  it("returns confidence + flip + brief", () => {
    const coaching = makeCoaching({
      drivers: [
        { factor_label: 'Cost Per Developer', factor_id: 'f_cost', sensitivity: 0.55, is_ai_estimated: false, confidence_band: 'high' },
      ],
      chip_inputs: {
        stage: 'evaluate',
        has_analysis: true,
        analysis_fresh: true,
        top_uncalibrated_factor: null,
        has_risk_factors: true,
        option_mechanism_overlap: false,
        stability_band: 'stable',
        dominant_factor_label: 'Cost Per Developer',
      },
    });
    const chips = computeChips(coaching, defaultSessionState(), makeTurnContext({ stage: 'evaluate' }), null, [], ALL_TOOLS);
    expect(chips.some(c => /How confident in/i.test(c.label))).toBe(true);
    expect(chips.some(c => c.label === 'What would flip this?')).toBe(true);
    // v5-maintenance: 'Generate a decision brief' chip was removed along
    // with the generate_brief tool. Remaining chips still validated by
    // assertChipShape below.
    for (const chip of chips) assertChipShape(chip);
  });
});

describe("computeChips — post-analysis, stable result (no dominant factor)", () => {
  it("returns confidence + pre-mortem + brief", () => {
    const coaching = makeCoaching({
      drivers: [
        { factor_label: 'Market Timing', factor_id: 'f_mkt', sensitivity: 0.25, is_ai_estimated: false, confidence_band: 'high' },
      ],
      chip_inputs: {
        stage: 'evaluate',
        has_analysis: true,
        analysis_fresh: true,
        top_uncalibrated_factor: null,
        has_risk_factors: true,
        option_mechanism_overlap: false,
        stability_band: 'stable',
        dominant_factor_label: null,
      },
    });
    const chips = computeChips(coaching, defaultSessionState(), makeTurnContext({ stage: 'evaluate' }), null, [], ALL_TOOLS);
    expect(chips.some(c => c.label === 'Run a pre-mortem')).toBe(true);
    // v5-maintenance: 'Generate a decision brief' chip was removed along
    // with the generate_brief tool. Remaining chips still validated by
    // assertChipShape below.
    for (const chip of chips) assertChipShape(chip);
  });
});

// ============================================================================
// Stale analysis context
// ============================================================================

describe("computeChips — stale analysis", () => {
  it("returns re-run + review", () => {
    const coaching = makeCoaching({
      chip_inputs: {
        stage: 'evaluate',
        has_analysis: true,
        analysis_fresh: false,
        top_uncalibrated_factor: null,
        has_risk_factors: true,
        option_mechanism_overlap: false,
        stability_band: null,
        dominant_factor_label: null,
      },
    });
    const chips = computeChips(coaching, defaultSessionState(), makeTurnContext({ stage: 'evaluate' }), null, [], ALL_TOOLS);
    expect(chips.some(c => c.label === 'Re-run with updated model')).toBe(true);
    for (const chip of chips) assertChipShape(chip);
  });
});

// ============================================================================
// Session suppression
// ============================================================================

describe("computeChips — session suppression (2-turn window)", () => {
  it("drops chips whose chip_id is in last_chip_ids_shown (turn N-1)", () => {
    const coaching = makeCoaching({
      ai_estimated_count: 3,
      calibration_target: {
        source_label: 'Cost Per Developer',
        target_label: 'Productivity',
        factor_id: 'f_cost',
      },
    });
    const session: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['calibrate_f_cost', 'challenge_risks'],
    };
    const chips = computeChips(coaching, session, makeTurnContext(), null, [], ALL_TOOLS);
    expect(chips.some(c => c.parameters?.chip_id === 'calibrate_f_cost')).toBe(false);
    expect(chips.some(c => c.parameters?.chip_id === 'challenge_risks')).toBe(false);
  });

  it("drops chips that were shown on the turn BEFORE last (turn N-2)", () => {
    const coaching = makeCoaching({
      ai_estimated_count: 3,
      calibration_target: {
        source_label: 'Cost Per Developer',
        target_label: 'Productivity',
        factor_id: 'f_cost',
      },
    });
    // last_chip_ids_shown = N-1 (empty this time)
    // chip_ids_shown_prev_turn = N-2 (the turn before)
    const session: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: [],
      chip_ids_shown_prev_turn: ['calibrate_f_cost', 'challenge_risks'],
    };
    const chips = computeChips(coaching, session, makeTurnContext(), null, [], ALL_TOOLS);
    expect(chips.some(c => c.parameters?.chip_id === 'calibrate_f_cost')).toBe(false);
    expect(chips.some(c => c.parameters?.chip_id === 'challenge_risks')).toBe(false);
  });

  it("drops chips shown on EITHER of the last 2 turns (union)", () => {
    const coaching = makeCoaching({
      ai_estimated_count: 3,
      calibration_target: {
        source_label: 'Cost Per Developer',
        target_label: 'Productivity',
        factor_id: 'f_cost',
      },
    });
    const session: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['calibrate_f_cost'],
      chip_ids_shown_prev_turn: ['challenge_risks'],
    };
    const chips = computeChips(coaching, session, makeTurnContext(), null, [], ALL_TOOLS);
    expect(chips.some(c => c.parameters?.chip_id === 'calibrate_f_cost')).toBe(false);
    expect(chips.some(c => c.parameters?.chip_id === 'challenge_risks')).toBe(false);
  });

  it("does NOT suppress chips that the user clicked (exempt from the 2-turn window)", () => {
    const coaching = makeCoaching({
      ai_estimated_count: 3,
      calibration_target: {
        source_label: 'Cost Per Developer',
        target_label: 'Productivity',
        factor_id: 'f_cost',
      },
    });
    // Chip was shown AND clicked — should reappear if still relevant.
    const session: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['calibrate_f_cost'],
      chip_ids_clicked: ['calibrate_f_cost'],
    };
    // The test checks whether the suppressedChipIds set excludes clicked IDs.
    // We verify at the suppression-set level because `calibrate_f_cost`
    // would also be blocked by the recent-action filter (set_factor_value
    // was just clicked), and we're only testing the session-window logic.
    const turnContext = makeTurnContext();
    // Don't mark set_factor_value as recently executed so the recent-action
    // filter doesn't independently drop the chip.
    turnContext.conversation.recent_actions_taken = [];
    const chips = computeChips(coaching, session, turnContext, null, [], ALL_TOOLS);
    // The calibrate chip should reappear since it was clicked.
    expect(chips.some(c => c.parameters?.chip_id === 'calibrate_f_cost')).toBe(true);
  });
});

// ============================================================================
// Confirmation-state suppression of progress chips
// ============================================================================

describe("computeChips — pending confirmation suppresses progress chips", () => {
  it("does NOT include a progress chip while awaiting confirmation", () => {
    const coaching = makeCoaching({ ai_estimated_count: 3 });
    const turnContext = makeTurnContext({
      conversation: {
        turn_count: 1,
        recent_actions_taken: [],
        recent_actions_declined: [],
        pending_confirmation: 'add_factor',
      } as unknown as DeterministicTurnContext['conversation'],
    });
    const chips = computeChips(coaching, defaultSessionState(), turnContext, null, [], ALL_TOOLS);
    expect(chips.some(c => c.action_type === 'run_analysis')).toBe(false);
  });
});

// ============================================================================
// Deferred actions
// ============================================================================

describe("computeChips — deferred actions", () => {
  it("promotes a deferred explain tool to a chip", () => {
    const coaching = makeCoaching({
      chip_inputs: {
        stage: 'evaluate',
        has_analysis: true,
        analysis_fresh: true,
        top_uncalibrated_factor: null,
        has_risk_factors: true,
        option_mechanism_overlap: false,
        stability_band: 'stable',
        dominant_factor_label: null,
      },
    });
    const chips = computeChips(
      coaching,
      defaultSessionState(),
      makeTurnContext({ stage: 'evaluate' }),
      null,
      ['what_would_flip'],
      ['what_would_flip', 'explain_result', 'compare_options', 'run_premortem', 'challenge_assumption', 'set_factor_value'],
    );
    // Deferred chip is promoted, so it should appear in output.
    expect(chips.some(c => c.action_type === 'what_would_flip')).toBe(true);
  });
});

// ============================================================================
// getChipIdsForSession
// ============================================================================

describe("getChipIdsForSession", () => {
  it("extracts chip_ids from parameters", () => {
    const chips = [
      { label: 'A', prompt: 'a', role: 'facilitator' as const, parameters: { chip_id: 'chip_1' } },
      { label: 'B', prompt: 'b', role: 'challenger' as const, parameters: { chip_id: 'chip_2' } },
      { label: 'C', prompt: 'c', role: 'scientist' as const, parameters: {} },
    ];
    expect(getChipIdsForSession(chips)).toEqual(['chip_1', 'chip_2']);
  });
});

// ============================================================================
// Tool-availability filtering
// ============================================================================

describe("computeChips — tool-availability filtering", () => {
  // Post-analysis fragile context produces explain_result, what_would_flip,
  // compare_options, and set_factor_value chips.
  const fragileCoaching = makeCoaching({
    drivers: [
      { factor_label: 'Cost Per Developer', factor_id: 'f_cost', sensitivity: 0.42, is_ai_estimated: true, confidence_band: 'medium' },
    ],
    chip_inputs: {
      stage: 'evaluate',
      has_analysis: true,
      analysis_fresh: true,
      top_uncalibrated_factor: 'f_cost',
      has_risk_factors: true,
      option_mechanism_overlap: false,
      stability_band: 'fragile',
      dominant_factor_label: null,
    },
  });

  it("filters out chips whose action_type maps to a tool not in availableTools", () => {
    // Only include set_factor_value — explanation tools are not available.
    const chips = computeChips(
      fragileCoaching,
      defaultSessionState(),
      makeTurnContext({ stage: 'evaluate' }),
      null,
      [],
      ['set_factor_value', 'add_factor'],
    );
    for (const chip of chips) {
      expect(chip.action_type).not.toBe('explain_result');
      expect(chip.action_type).not.toBe('compare_options');
      expect(chip.action_type).not.toBe('what_would_flip');
    }
  });

  it("keeps chips when their mapped tool IS in availableTools", () => {
    const chips = computeChips(
      fragileCoaching,
      defaultSessionState(),
      makeTurnContext({ stage: 'evaluate' }),
      null,
      [],
      ['what_would_flip', 'set_factor_value', 'compare_options'],
    );
    expect(chips.some(c => c.action_type === 'what_would_flip')).toBe(true);
    expect(chips.some(c => c.action_type === 'compare_options')).toBe(true);
  });

  it("returns empty array (not legacy fallback) when all chips are filtered", () => {
    // No tools available at all — every chip should be filtered.
    const chips = computeChips(
      fragileCoaching,
      defaultSessionState(),
      makeTurnContext({ stage: 'evaluate' }),
      null,
      [],
      [], // empty tool list
    );
    expect(chips).toEqual([]);
  });

  it("invariant: no chip maps to a tool not in availableTools", () => {
    const availableTools = ['what_would_flip', 'compare_options', 'set_factor_value', 'run_analysis'];
    const chips = computeChips(
      fragileCoaching,
      defaultSessionState(),
      makeTurnContext({ stage: 'evaluate' }),
      null,
      [],
      availableTools,
    );
    const toolSet = new Set(availableTools);
    for (const chip of chips) {
      const tool = chipActionToTool(chip.action_type);
      if (tool) {
        expect(toolSet.has(tool), `chip ${chip.action_type} maps to tool ${tool} which is not in availableTools`).toBe(true);
      }
    }
  });
});

// ============================================================================
// Analysis-readiness gate (Fix 5)
// ============================================================================

describe("computeChips — analysis_ready.status gate", () => {
  it("suppresses Run analysis chip when status is 'needs_encoding'", () => {
    const coaching = makeCoaching({
      ai_estimated_count: 3,
      chip_inputs: {
        stage: 'ideate',
        has_analysis: false,
        analysis_fresh: false,
        top_uncalibrated_factor: null,
        has_risk_factors: false,
        option_mechanism_overlap: false,
        stability_band: null,
        dominant_factor_label: null,
      },
    });
    const turnContext = makeTurnContext();
    const chips = computeChips(
      coaching,
      defaultSessionState(),
      turnContext,
      null,
      [],
      ALL_TOOLS,
      'needs_encoding',
    );
    const actionTypes = chips.map(c => c.action_type);
    expect(actionTypes).not.toContain('run_analysis');
  });

  it("suppresses Run analysis chip when status is 'needs_user_input'", () => {
    const coaching = makeCoaching({ ai_estimated_count: 3 });
    const chips = computeChips(
      coaching,
      defaultSessionState(),
      makeTurnContext(),
      null,
      [],
      ALL_TOOLS,
      'needs_user_input',
    );
    expect(chips.map(c => c.action_type)).not.toContain('run_analysis');
  });

  it("includes Run analysis chip when status is 'ready'", () => {
    const coaching = makeCoaching({ ai_estimated_count: 3 });
    const chips = computeChips(
      coaching,
      defaultSessionState(),
      makeTurnContext(),
      null,
      [],
      ALL_TOOLS,
      'ready',
    );
    expect(chips.map(c => c.action_type)).toContain('run_analysis');
  });

  it("includes Run analysis chip when status is null (unknown — backward compatible)", () => {
    const coaching = makeCoaching({ ai_estimated_count: 3 });
    const chips = computeChips(
      coaching,
      defaultSessionState(),
      makeTurnContext(),
      null,
      [],
      ALL_TOOLS,
      null,
    );
    expect(chips.map(c => c.action_type)).toContain('run_analysis');
  });

  it("does NOT backfill a progress chip via the slot rule when status is non-ready", () => {
    // Scenario: post-draft with no risk factors → chipWhatCouldGoWrong + chipOtherApproaches
    // Normally the slot rule would force-insert chipRunAnalysis. With a non-ready
    // status it must not.
    const coaching = makeCoaching({
      ai_estimated_count: 0,
      risk_factor_count: 0,
    });
    const chips = computeChips(
      coaching,
      defaultSessionState(),
      makeTurnContext(),
      null,
      [],
      ALL_TOOLS,
      'needs_encoding',
    );
    expect(chips.map(c => c.action_type)).not.toContain('run_analysis');
  });

  it("suppresses deferred run_analysis when status is non-ready (Pattern A follow-up P0 #2)", () => {
    // Scenario: the LLM emitted a compound tool call and run_analysis was
    // deferred by the one-tool-per-turn policy. The deferred-chip loop must
    // honour the readiness gate and NOT promote run_analysis to the top of
    // the chip list when analysis_ready.status is non-ready.
    const coaching = makeCoaching({ ai_estimated_count: 3 });
    const chips = computeChips(
      coaching,
      defaultSessionState(),
      makeTurnContext(),
      null,
      ['run_analysis'],
      ALL_TOOLS,
      'needs_encoding',
    );
    expect(chips.map(c => c.action_type)).not.toContain('run_analysis');
  });

  it("allows deferred run_analysis when status is ready", () => {
    const coaching = makeCoaching({ ai_estimated_count: 3 });
    const chips = computeChips(
      coaching,
      defaultSessionState(),
      makeTurnContext(),
      null,
      ['run_analysis'],
      ALL_TOOLS,
      'ready',
    );
    // Deferred run_analysis is unshifted to the front of candidates, so it
    // should appear among the top 3 chips.
    expect(chips.map(c => c.action_type)).toContain('run_analysis');
  });
});
