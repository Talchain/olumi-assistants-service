/**
 * Tests for session decision state (WS6).
 */

import { describe, it, expect, vi } from "vitest";

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
  registerChipClick,
  suppressedChipIds,
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

// ============================================================================
// Chip tracking (2-turn suppression window)
// ============================================================================

describe("updateLastChipIds — 2-turn history shift", () => {
  it("shifts last_chip_ids_shown into chip_ids_shown_prev_turn on each call", () => {
    const state0 = defaultSessionState();
    const state1 = updateLastChipIds(state0, ['chip_a', 'chip_b']);
    expect(state1.last_chip_ids_shown).toEqual(['chip_a', 'chip_b']);
    expect(state1.chip_ids_shown_prev_turn).toEqual([]);

    const state2 = updateLastChipIds(state1, ['chip_c', 'chip_d']);
    expect(state2.last_chip_ids_shown).toEqual(['chip_c', 'chip_d']);
    expect(state2.chip_ids_shown_prev_turn).toEqual(['chip_a', 'chip_b']);

    // Third shift: chip_a/chip_b fall out of the 2-turn window entirely.
    const state3 = updateLastChipIds(state2, ['chip_e']);
    expect(state3.last_chip_ids_shown).toEqual(['chip_e']);
    expect(state3.chip_ids_shown_prev_turn).toEqual(['chip_c', 'chip_d']);
  });

  it("preserves other fields when shifting chip history", () => {
    const state0 = {
      ...defaultSessionState(),
      calibrations_provided: ['f1'],
      accepted_patches: 2,
      convergence_signal: 'narrowing' as const,
    };
    const state1 = updateLastChipIds(state0, ['chip_a']);
    expect(state1.calibrations_provided).toEqual(['f1']);
    expect(state1.accepted_patches).toBe(2);
    expect(state1.convergence_signal).toBe('narrowing');
  });

  it("does not mutate input state", () => {
    const state0 = { ...defaultSessionState(), last_chip_ids_shown: ['chip_a'] };
    updateLastChipIds(state0, ['chip_b']);
    expect(state0.last_chip_ids_shown).toEqual(['chip_a']);
    expect(state0.chip_ids_shown_prev_turn).toEqual([]);
  });
});

describe("registerChipClick", () => {
  it("adds a new chip_id to chip_ids_clicked", () => {
    const state = defaultSessionState();
    const next = registerChipClick(state, 'chip_calibrate_cost');
    expect(next.chip_ids_clicked).toContain('chip_calibrate_cost');
  });

  it("deduplicates existing clicked chip IDs", () => {
    const state = { ...defaultSessionState(), chip_ids_clicked: ['chip_a'] };
    const next = registerChipClick(state, 'chip_a');
    expect(next.chip_ids_clicked).toEqual(['chip_a']);
    expect(next).toBe(state); // same reference when no change
  });

  it("does not mutate input state", () => {
    const state = defaultSessionState();
    registerChipClick(state, 'chip_new');
    expect(state.chip_ids_clicked).toEqual([]);
  });
});

describe("suppressedChipIds — 2-turn window with click exemption", () => {
  it("returns empty set when no chips were shown", () => {
    const state = defaultSessionState();
    const result = suppressedChipIds(state);
    expect(result.size).toBe(0);
  });

  it("returns the union of N-1 and N-2 shown chips", () => {
    const state: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['chip_a', 'chip_b'],
      chip_ids_shown_prev_turn: ['chip_c', 'chip_d'],
    };
    const result = suppressedChipIds(state);
    expect(result.has('chip_a')).toBe(true);
    expect(result.has('chip_b')).toBe(true);
    expect(result.has('chip_c')).toBe(true);
    expect(result.has('chip_d')).toBe(true);
    expect(result.size).toBe(4);
  });

  it("exempts clicked chips from the suppression window", () => {
    const state: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['chip_a', 'chip_b'],
      chip_ids_shown_prev_turn: ['chip_c'],
      chip_ids_clicked: ['chip_a', 'chip_c'],
    };
    const result = suppressedChipIds(state);
    expect(result.has('chip_a')).toBe(false); // clicked → exempt
    expect(result.has('chip_b')).toBe(true);  // shown but not clicked → suppressed
    expect(result.has('chip_c')).toBe(false); // clicked → exempt
    expect(result.size).toBe(1);
  });

  it("handles deduplication when a chip appears in both shown windows", () => {
    const state: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['chip_a', 'chip_b'],
      chip_ids_shown_prev_turn: ['chip_a'], // same chip in both windows
    };
    const result = suppressedChipIds(state);
    expect(result.size).toBe(2);
    expect(result.has('chip_a')).toBe(true);
    expect(result.has('chip_b')).toBe(true);
  });
});

// ============================================================================
// Chip state preservation on advanceSessionState
// ============================================================================

describe("advanceSessionState — chip fields preserved", () => {
  it("carries last_chip_ids_shown / chip_ids_shown_prev_turn / chip_ids_clicked across turns", () => {
    const prev: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['chip_a'],
      chip_ids_shown_prev_turn: ['chip_b'],
      chip_ids_clicked: ['chip_a'],
    };
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, null, ctx);
    expect(next.last_chip_ids_shown).toEqual(['chip_a']);
    expect(next.chip_ids_shown_prev_turn).toEqual(['chip_b']);
    expect(next.chip_ids_clicked).toEqual(['chip_a']);
  });

  it("deep-copies chip arrays so mutation of `next` does not affect `prev`", () => {
    const prev: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['chip_a'],
    };
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, null, ctx);
    next.last_chip_ids_shown.push('chip_z');
    expect(prev.last_chip_ids_shown).toEqual(['chip_a']);
  });
});

// ============================================================================
// mergeSessionState — defensive copies (array mutation guard)
// ============================================================================

describe("mergeSessionState — defensive copies", () => {
  it("deep-copies array fields so mutation of the result cannot reach the input", () => {
    const input: Partial<SessionState> = {
      calibrations_provided: ['f1'],
      plays_fired: ['dominant_factor'],
      last_chip_ids_shown: ['chip_a'],
      chip_ids_shown_prev_turn: ['chip_b'],
      chip_ids_clicked: ['chip_c'],
    };
    const result = mergeSessionState(input);
    // Mutate every array field on the result.
    result.calibrations_provided.push('f2');
    result.plays_fired.push('pre_mortem');
    result.last_chip_ids_shown.push('chip_z');
    result.chip_ids_shown_prev_turn.push('chip_y');
    result.chip_ids_clicked.push('chip_x');
    // Input must be untouched.
    expect(input.calibrations_provided).toEqual(['f1']);
    expect(input.plays_fired).toEqual(['dominant_factor']);
    expect(input.last_chip_ids_shown).toEqual(['chip_a']);
    expect(input.chip_ids_shown_prev_turn).toEqual(['chip_b']);
    expect(input.chip_ids_clicked).toEqual(['chip_c']);
  });

  it("merges partial chip state fields with defaults for missing ones", () => {
    const input: Partial<SessionState> = { last_chip_ids_shown: ['chip_a'] };
    const result = mergeSessionState(input);
    expect(result.last_chip_ids_shown).toEqual(['chip_a']);
    expect(result.chip_ids_shown_prev_turn).toEqual([]);
    expect(result.chip_ids_clicked).toEqual([]);
  });
});

// ============================================================================
// Analysis-cache lifecycle (S6 fix)
// ============================================================================

describe('analysis cache lifecycle', () => {
  it('defaults to null for all analysis-cache fields', () => {
    const state = defaultSessionState();
    expect(state.analysis_graph_hash).toBeNull();
    expect(state.analysis_scenario_id).toBeNull();
    expect(state.prior_analysis_envelope).toBeNull();
  });

  it('mergeSessionState preserves analysis-cache fields from input', () => {
    const envelope = { scenario_id: 's1' } as unknown as SessionState['prior_analysis_envelope'];
    const merged = mergeSessionState({
      analysis_graph_hash: 'abc123',
      analysis_scenario_id: 's1',
      prior_analysis_envelope: envelope,
    });
    expect(merged.analysis_graph_hash).toBe('abc123');
    expect(merged.analysis_scenario_id).toBe('s1');
    expect(merged.prior_analysis_envelope).toBe(envelope);
  });

  it('advanceSessionState carries cache through for non-mutating actions', () => {
    const prev = mergeSessionState({
      analysis_graph_hash: 'abc',
      analysis_scenario_id: 's1',
      prior_analysis_envelope: { ok: true } as unknown as SessionState['prior_analysis_envelope'],
    });
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, 'explain_result', ctx);
    expect(next.analysis_graph_hash).toBe('abc');
    expect(next.analysis_scenario_id).toBe('s1');
    expect(next.prior_analysis_envelope).toBeTruthy();
  });

  it('advanceSessionState clears cache on edit_graph', () => {
    const prev = mergeSessionState({
      analysis_graph_hash: 'abc',
      analysis_scenario_id: 's1',
      prior_analysis_envelope: { ok: true } as unknown as SessionState['prior_analysis_envelope'],
    });
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, 'edit_graph', ctx);
    expect(next.analysis_graph_hash).toBeNull();
    expect(next.analysis_scenario_id).toBeNull();
    expect(next.prior_analysis_envelope).toBeNull();
  });

  it('advanceSessionState clears cache on set_factor_value', () => {
    const prev = mergeSessionState({
      analysis_graph_hash: 'abc',
      analysis_scenario_id: 's1',
      prior_analysis_envelope: { ok: true } as unknown as SessionState['prior_analysis_envelope'],
    });
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, 'set_factor_value', ctx);
    expect(next.analysis_graph_hash).toBeNull();
    expect(next.prior_analysis_envelope).toBeNull();
  });

  it('advanceSessionState does not clear cache on null action', () => {
    const prev = mergeSessionState({
      analysis_graph_hash: 'abc',
      analysis_scenario_id: 's1',
      prior_analysis_envelope: { ok: true } as unknown as SessionState['prior_analysis_envelope'],
    });
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, null, ctx);
    expect(next.analysis_graph_hash).toBe('abc');
  });
});

// ============================================================================
// Fix 0A — speculative branch
// ============================================================================

describe('advanceSessionState — speculative (Fix 0A)', () => {
  it('does NOT push calibrations_provided when speculative', () => {
    const prev = defaultSessionState();
    const ctx = makeMinimalContext();
    const next = advanceSessionState(
      prev,
      'set_factor_value',
      ctx,
      { calibrated_factor_id: 'fac_salary' },
      { speculative: true },
    );
    expect(next.calibrations_provided).toEqual([]);
  });

  it('DOES push calibrations_provided on accepted (speculative:false) set_factor_value', () => {
    const prev = defaultSessionState();
    const ctx = makeMinimalContext();
    const next = advanceSessionState(
      prev,
      'set_factor_value',
      ctx,
      { calibrated_factor_id: 'fac_salary', patch_accepted: true },
      { speculative: false },
    );
    expect(next.calibrations_provided).toEqual(['fac_salary']);
  });

  it('does NOT clear analysis cache when speculative', () => {
    const prev = mergeSessionState({
      analysis_graph_hash: 'abc',
      analysis_scenario_id: 's1',
      prior_analysis_envelope: { ok: true } as unknown as SessionState['prior_analysis_envelope'],
    });
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, 'set_factor_value', ctx, undefined, { speculative: true });
    expect(next.analysis_graph_hash).toBe('abc');
    expect(next.analysis_scenario_id).toBe('s1');
    expect(next.prior_analysis_envelope).toEqual({ ok: true });
  });

  it('DOES clear analysis cache on accepted graph-mutating action', () => {
    const prev = mergeSessionState({
      analysis_graph_hash: 'abc',
      analysis_scenario_id: 's1',
      prior_analysis_envelope: { ok: true } as unknown as SessionState['prior_analysis_envelope'],
    });
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, 'set_factor_value', ctx, undefined, { speculative: false });
    expect(next.analysis_graph_hash).toBeNull();
    expect(next.prior_analysis_envelope).toBeNull();
  });

  it('does not register calibration if outcome lacks calibrated_factor_id (speculative)', () => {
    const prev = defaultSessionState();
    const ctx = makeMinimalContext();
    const next = advanceSessionState(
      prev,
      'set_factor_value',
      ctx,
      undefined,
      { speculative: true },
    );
    expect(next.calibrations_provided).toEqual([]);
  });

  it('preserves prior_analysis_envelope across a speculative add_option turn', () => {
    const prev = mergeSessionState({
      analysis_graph_hash: 'hash',
      analysis_scenario_id: 'scn',
      prior_analysis_envelope: { cached: true } as unknown as SessionState['prior_analysis_envelope'],
    });
    const ctx = makeMinimalContext();
    const next = advanceSessionState(prev, 'add_option', ctx, undefined, { speculative: true });
    expect(next.analysis_graph_hash).toBe('hash');
    expect(next.prior_analysis_envelope).toEqual({ cached: true });
  });
});
