/**
 * Tests for session decision state (WS6).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import {
  defaultSessionState,
  mergeSessionState,
  advanceSessionState,
  registerPlay,
  registerCalibration,
  updateLastChipIds,
} from "../../../../src/orchestrator/deterministic/session-state.js";
import type { SessionState } from "../../../../src/orchestrator/deterministic/session-state.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";

// ============================================================================
// Minimal fixture helpers
// ============================================================================

function makeMinimalContext(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  return {
    stage: 'ideate',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null } as unknown as DeterministicTurnContext['entities'],
    graph_summary: { node_count: 5, edge_count: 3, option_count: 2, goal_label: 'Goal', option_labels: ['A', 'B'], missing_structural: [] } as unknown as DeterministicTurnContext['graph_summary'],
    analysis_summary: null,
    capabilities: {} as DeterministicTurnContext['capabilities'],
    blockers: [],
    signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
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

// ============================================================================
// defaultSessionState
// ============================================================================

describe("defaultSessionState", () => {
  it("returns valid empty state", () => {
    const state = defaultSessionState();
    expect(state.prediction).toBeNull();
    expect(state.calibrations_provided).toEqual([]);
    expect(state.plays_fired).toEqual([]);
    expect(state.questions_asked).toEqual([]);
    expect(state.accepted_patches).toBe(0);
    expect(state.dismissed_patches).toBe(0);
    expect(state.last_chip_ids_shown).toEqual([]);
    expect(state.last_question_turn).toBe(0);
    expect(state.preferred_option).toBeNull();
    expect(state.convergence_signal).toBe('exploring');
  });
});

// ============================================================================
// advanceSessionState — convergence detection
// ============================================================================

describe("advanceSessionState — convergence", () => {
  it("stays exploring when no analysis and few turns", () => {
    const prev = defaultSessionState();
    const ctx = makeMinimalContext({ conversation: { turn_count: 2, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null } as unknown as DeterministicTurnContext['conversation'] });
    const next = advanceSessionState(prev, null, ctx);
    expect(next.convergence_signal).toBe('exploring');
  });

  it("stays exploring when no analysis_summary", () => {
    const prev = defaultSessionState();
    const ctx = makeMinimalContext({ analysis_summary: null });
    const next = advanceSessionState(prev, 'explain_result', ctx);
    expect(next.convergence_signal).toBe('exploring');
  });

  it("transitions to narrowing when analysis exists and user edits", () => {
    const prev = defaultSessionState();
    const ctx = makeMinimalContext({
      analysis_summary: { winner: 'A', winner_probability: 0.7 } as unknown as DeterministicTurnContext['analysis_summary'],
    });
    const next = advanceSessionState(prev, 'set_factor_value', ctx);
    expect(next.convergence_signal).toBe('narrowing');
  });

  it("transitions to converging on generate_artefact", () => {
    const prev = { ...defaultSessionState(), convergence_signal: 'narrowing' as const };
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, 'generate_artefact', ctx);
    expect(next.convergence_signal).toBe('converging');
  });

  it("stays converging unless user edits", () => {
    const prev = { ...defaultSessionState(), convergence_signal: 'converging' as const };
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, 'explain_result', ctx);
    expect(next.convergence_signal).toBe('converging');
  });

  it("reverts from converging to narrowing on edit", () => {
    const prev = { ...defaultSessionState(), convergence_signal: 'converging' as const };
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, 'add_factor', ctx);
    expect(next.convergence_signal).toBe('narrowing');
  });

  it("converges when accepted_patches >= 2 and was narrowing", () => {
    const prev = { ...defaultSessionState(), convergence_signal: 'narrowing' as const, accepted_patches: 2 };
    const ctx = makeMinimalContext({
      analysis_summary: { winner: 'A' } as unknown as DeterministicTurnContext['analysis_summary'],
    });
    const next = advanceSessionState(prev, null, ctx);
    expect(next.convergence_signal).toBe('converging');
  });
});

// ============================================================================
// advanceSessionState — immutability
// ============================================================================

describe("advanceSessionState — immutability", () => {
  it("does not mutate the previous state", () => {
    const prev = defaultSessionState();
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, 'run_analysis', ctx);
    expect(next).not.toBe(prev);
    expect(prev.calibrations_provided).toEqual([]);
    expect(prev.plays_fired).toEqual([]);
  });
});

// ============================================================================
// registerPlay
// ============================================================================

describe("registerPlay", () => {
  it("adds a new play ID", () => {
    const state = defaultSessionState();
    const next = registerPlay(state, 'dominant_factor');
    expect(next.plays_fired).toContain('dominant_factor');
  });

  it("does not duplicate existing play ID", () => {
    const state = { ...defaultSessionState(), plays_fired: ['dominant_factor'] };
    const next = registerPlay(state, 'dominant_factor');
    expect(next.plays_fired).toEqual(['dominant_factor']);
    expect(next).toBe(state); // same reference when no change
  });

  it("does not mutate original state", () => {
    const state = defaultSessionState();
    registerPlay(state, 'pre_mortem');
    expect(state.plays_fired).toEqual([]);
  });
});

// ============================================================================
// registerCalibration
// ============================================================================

describe("registerCalibration", () => {
  it("adds a new factor ID", () => {
    const state = defaultSessionState();
    const next = registerCalibration(state, 'factor_cost');
    expect(next.calibrations_provided).toContain('factor_cost');
  });

  it("does not duplicate existing factor ID", () => {
    const state = { ...defaultSessionState(), calibrations_provided: ['factor_cost'] };
    const next = registerCalibration(state, 'factor_cost');
    expect(next.calibrations_provided).toEqual(['factor_cost']);
    expect(next).toBe(state);
  });
});

// ============================================================================
// updateLastChipIds
// ============================================================================

describe("updateLastChipIds", () => {
  it("replaces chip IDs", () => {
    const state = defaultSessionState();
    const next = updateLastChipIds(state, ['chip_1', 'chip_2']);
    expect(next.last_chip_ids_shown).toEqual(['chip_1', 'chip_2']);
  });

  it("does not mutate original state", () => {
    const state = defaultSessionState();
    updateLastChipIds(state, ['chip_1']);
    expect(state.last_chip_ids_shown).toEqual([]);
  });
});

// ============================================================================
// mergeSessionState
// ============================================================================

describe("mergeSessionState", () => {
  it("returns defaults for undefined input", () => {
    const result = mergeSessionState(undefined);
    expect(result).toEqual(defaultSessionState());
  });

  it("returns defaults for null input", () => {
    const result = mergeSessionState(null);
    expect(result).toEqual(defaultSessionState());
  });

  it("returns defaults for non-object input", () => {
    const result = mergeSessionState("bad" as unknown as null);
    expect(result).toEqual(defaultSessionState());
  });

  it("merges partial state with defaults", () => {
    const result = mergeSessionState({ prediction: 'Option A', convergence_signal: 'narrowing' });
    expect(result.prediction).toBe('Option A');
    expect(result.convergence_signal).toBe('narrowing');
    expect(result.calibrations_provided).toEqual([]);
    expect(result.accepted_patches).toBe(0);
  });

  it("ignores fields with wrong types", () => {
    const result = mergeSessionState({
      prediction: 42 as unknown as string,
      accepted_patches: "bad" as unknown as number,
    });
    expect(result.prediction).toBeNull(); // default
    expect(result.accepted_patches).toBe(0); // default
  });

  it("preserves valid arrays", () => {
    const result = mergeSessionState({ calibrations_provided: ['f1', 'f2'] });
    expect(result.calibrations_provided).toEqual(['f1', 'f2']);
  });

  it("rejects invalid convergence signal", () => {
    const result = mergeSessionState({ convergence_signal: 'invalid' as 'exploring' });
    expect(result.convergence_signal).toBe('exploring');
  });
});

// ============================================================================
// advanceSessionState — ActionOutcome
// ============================================================================

describe("advanceSessionState — ActionOutcome", () => {
  it("tracks calibration from set_factor_value with factor ID", () => {
    const prev = defaultSessionState();
    const ctx = makeMinimalContext({
      analysis_summary: { winner: 'A' } as unknown as DeterministicTurnContext['analysis_summary'],
    });
    const next = advanceSessionState(prev, 'set_factor_value', ctx, { calibrated_factor_id: 'f1' });
    expect(next.calibrations_provided).toContain('f1');
  });

  it("does not duplicate existing calibration", () => {
    const prev = { ...defaultSessionState(), calibrations_provided: ['f1'] };
    const ctx = makeMinimalContext({
      analysis_summary: { winner: 'A' } as unknown as DeterministicTurnContext['analysis_summary'],
    });
    const next = advanceSessionState(prev, 'set_factor_value', ctx, { calibrated_factor_id: 'f1' });
    expect(next.calibrations_provided).toEqual(['f1']);
  });

  it("increments accepted_patches on patch_accepted outcome", () => {
    const prev = defaultSessionState();
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, null, ctx, { patch_accepted: true });
    expect(next.accepted_patches).toBe(1);
  });

  it("increments dismissed_patches on patch_dismissed outcome", () => {
    const prev = defaultSessionState();
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, null, ctx, { patch_dismissed: true });
    expect(next.dismissed_patches).toBe(1);
  });
});
