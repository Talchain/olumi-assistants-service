/**
 * Tests for Fix 1 — chip floor (two-layer).
 *
 * Layer 1: guidance-derived candidates widen the candidate pool so the
 *          session window has fresh things to promote.
 * Layer 2: when Layer 1 + filtering still leaves 0 chips AND graph exists
 *          AND an availability-valid chip was suppressed by the session
 *          window, force the highest-priority suppressed chip through.
 *
 * Scenarios covered: a-e from the brief.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { computeChips } from "../../../../src/orchestrator/deterministic/chip-engine.js";
import { log } from "../../../../src/utils/telemetry.js";
import type { CoachingContext } from "../../../../src/orchestrator/deterministic/coaching-context-builder.js";
import type { SessionState } from "../../../../src/orchestrator/deterministic/session-state.js";
import { defaultSessionState } from "../../../../src/orchestrator/deterministic/session-state.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";
import type { GuidanceItem } from "../../../../src/orchestrator/types/guidance-item.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

const infoSpy = vi.mocked(log.info);
beforeEach(() => { infoSpy.mockClear(); });

const ALL_TOOLS = [
  'run_analysis', 'explain_result', 'compare_options', 'what_would_flip',
  'challenge_assumption', 'run_premortem', 'set_factor_value', 'add_factor',
  'add_option', 'add_constraint', 'adjust_edge_strength', 'remove_factor',
  'set_goal_target', 'edit_graph',
];

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

function makeCtx(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  const graph = { nodes: [{ id: 'goal_g', kind: 'goal', label: 'Goal' }], edges: [] } as unknown as GraphV3T;
  return {
    stage: 'ideate',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null } as unknown as DeterministicTurnContext['entities'],
    graph_summary: { node_count: 3, edge_count: 2, option_count: 1, goal_label: 'Goal', option_labels: ['A'], missing_structural: [] } as unknown as DeterministicTurnContext['graph_summary'],
    analysis_summary: null,
    capabilities: {} as DeterministicTurnContext['capabilities'],
    blockers: [],
    signals: {} as DeterministicTurnContext['signals'],
    conversation: { turn_count: 2, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null } as unknown as DeterministicTurnContext['conversation'],
    eligible_actions: [],
    disambiguation_hints: [],
    graph,
    analysis: null,
    conversational_state: null,
    messages: [],
    scenario_id: 's',
    turn_id: 't',
    analysis_inputs: null,
    ...overrides,
  } as DeterministicTurnContext;
}

function makeGuidance(signal_code: string, target_id: string | undefined, item_id: string, priority = 60): GuidanceItem {
  return {
    item_id,
    signal_code: signal_code as GuidanceItem['signal_code'],
    category: 'should_fix',
    source: 'structural',
    title: 'Guidance title',
    primary_action: { type: 'discuss', prompt: 'q' },
    target_object: target_id ? { type: 'node', id: target_id, label: 'Target Label' } : undefined,
    priority,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario (a): draft turn with GuidanceItems → chips include guidance-derived.
// ────────────────────────────────────────────────────────────────────────────
describe("(a) draft turn with GuidanceItems — pool includes guidance-derived chips", () => {
  it("includes a guidance-derived chip alongside bundle chips", () => {
    const coaching = makeCoaching({ ai_estimated_count: 3 });
    const ctx = makeCtx();
    const guidance: GuidanceItem[] = [
      makeGuidance('DEFAULT_NODE_CONFIDENCE', 'fac_runway', 'gi_runway'),
    ];
    const chips = computeChips(
      coaching,
      defaultSessionState(),
      ctx,
      null,
      [],
      ALL_TOOLS,
      'needs_encoding',
      guidance,
    );
    // Bundle chips already filled 2 slots (calibrate+challenge, run_analysis
    // suppressed by needs_encoding). The guidance-derived chip should
    // appear in the 3-cap.
    const chipIds = chips.map(c => c.parameters?.chip_id);
    expect(chipIds).toContain('gi_runway');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Scenario (b): T2 after draft, bundle chips suppressed → guidance chip survives.
// ────────────────────────────────────────────────────────────────────────────
describe("(b) T2 session-suppressed bundle — guidance-derived chip survives", () => {
  it("guidance chip survives when all bundle chip_ids are in session window", () => {
    const coaching = makeCoaching({ ai_estimated_count: 3 });
    const ctx = makeCtx();
    // Session window contains ALL bundle chip_ids from T1.
    const sessionState: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['calibrate_general', 'challenge_risks', 'progress_run_analysis'],
      chip_ids_shown_prev_turn: [],
    };
    // And none of the bundle action_types have run recently.
    const guidance: GuidanceItem[] = [
      makeGuidance('DEFAULT_NODE_CONFIDENCE', 'fac_arch', 'gi_arch_cal'),
    ];
    const chips = computeChips(
      coaching,
      sessionState,
      ctx,
      null,
      [],
      ALL_TOOLS,
      'ready', // run_analysis would be available, but its chip_id is suppressed
      guidance,
    );
    const chipIds = chips.map(c => c.parameters?.chip_id);
    expect(chipIds).toContain('gi_arch_cal');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Scenario (c): everything exhausted → floor forces 1 chip via session-bypass.
// ────────────────────────────────────────────────────────────────────────────
describe("(c) all candidates exhausted — Layer 2 floor activates", () => {
  it("forces highest-priority suppressed chip through when session-only-suppression empties the pool", () => {
    const coaching = makeCoaching({ ai_estimated_count: 3 });
    const ctx = makeCtx();
    // Session window contains bundle chip_ids AND the guidance chip_id.
    const sessionState: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['calibrate_general', 'challenge_risks', 'progress_run_analysis', 'gi_arch_cal'],
      chip_ids_shown_prev_turn: [],
    };
    const guidance: GuidanceItem[] = [
      makeGuidance('DEFAULT_NODE_CONFIDENCE', 'fac_arch', 'gi_arch_cal'),
    ];
    // analysisReadyStatus: 'needs_encoding' — prevents Step 5's progress-slot
    // rule from force-inserting chipRunAnalysis (which would fill the slot
    // before the floor even gets a chance). Mirrors the real T2-after-draft
    // staging case where options don't yet have interventions.
    const chips = computeChips(
      coaching,
      sessionState,
      ctx,
      null,
      [],
      ALL_TOOLS,
      'needs_encoding',
      guidance,
    );
    expect(chips.length).toBeGreaterThanOrEqual(1);
    // Telemetry: chip floor activated
    const activated = infoSpy.mock.calls.some(
      (args) => (args[0] as Record<string, unknown>)?.event === 'v4.chip_floor_activated',
    );
    expect(activated).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Scenario (d): no graph → 0 chips, floor does NOT fire.
// ────────────────────────────────────────────────────────────────────────────
describe("(d) no graph — returns 0 chips, floor does NOT activate", () => {
  it("does not force a chip when graph is null", () => {
    const coaching = makeCoaching({ ai_estimated_count: 0, risk_factor_count: 0 });
    const ctx = makeCtx({ graph: null });
    const sessionState: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['challenge_risks', 'challenge_alternatives', 'progress_run_analysis'],
      chip_ids_shown_prev_turn: [],
    };
    const chips = computeChips(
      coaching,
      sessionState,
      ctx,
      null,
      [],
      [], // no tools either
      'ready',
      [],
    );
    expect(chips).toHaveLength(0);
    const activated = infoSpy.mock.calls.some(
      (args) => (args[0] as Record<string, unknown>)?.event === 'v4.chip_floor_activated',
    );
    expect(activated).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Scenario (e): chips only blocked by availability filter → 0 chips, floor does NOT fire.
// ────────────────────────────────────────────────────────────────────────────
describe("(e) availability-only filtering — floor does NOT force unavailable action", () => {
  it("does not bypass availability gate even when graph exists", () => {
    const coaching = makeCoaching({ ai_estimated_count: 3 });
    const ctx = makeCtx();
    // Session state is empty; chips aren't suppressed by the session window.
    // All bundle chips map to tools not in availableTools — they fail Step 6
    // (availability) which is NOT the same as session suppression, so they
    // are NOT added to sessionSuppressed and the floor should NOT fire.
    const chips = computeChips(
      coaching,
      defaultSessionState(),
      ctx,
      null,
      [],
      [], // no tools available at all — availability drops everything
      'ready',
      [],
    );
    expect(chips).toHaveLength(0);
    const activated = infoSpy.mock.calls.some(
      (args) => (args[0] as Record<string, unknown>)?.event === 'v4.chip_floor_activated',
    );
    expect(activated).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Scenario (f): chip is both session-suppressed AND recently executed —
//               floor must NOT force it through (P0 regression guard).
//
// Root-cause: before the fix, the filter checked suppressedIds before
// recentActions. A chip in BOTH sets entered sessionSuppressed at the
// suppressedIds branch and never hit the recentActions branch, so the floor
// could promote an action the user had just executed.
//
// Setup: use a guidance-only chip pool (no bundle chips survive) where the
// sole guidance chip_id is session-suppressed AND its action_type matches
// executedAction. No other candidates → floor would activate IFF the fix
// is absent.
// ────────────────────────────────────────────────────────────────────────────
describe("(f) chip session-suppressed AND recently executed — floor must NOT force it", () => {
  it("does not promote a session-suppressed chip whose action was recently executed", () => {
    // Coaching: ai_estimated_count = 0 so no calibrate bundle chip generated,
    // challenge/progress also suppressed. We'll control exactly which chips
    // are candidates by using an empty tool list except for set_factor_value.
    const coaching = makeCoaching({ ai_estimated_count: 0, risk_factor_count: 0 });
    const ctx = makeCtx();
    const guidance: GuidanceItem[] = [
      makeGuidance('DEFAULT_NODE_CONFIDENCE', 'fac_arch', 'gi_arch_cal'),
    ];
    // Session window suppresses the guidance chip.
    const sessionState: SessionState = {
      ...defaultSessionState(),
      last_chip_ids_shown: ['gi_arch_cal'],
      chip_ids_shown_prev_turn: [],
    };
    // The guidance chip maps to set_factor_value, which was just executed.
    // Only expose set_factor_value as available so no other chip can survive.
    const chips = computeChips(
      coaching,
      sessionState,
      ctx,
      'set_factor_value' as import("../../../../src/orchestrator/deterministic/actions/types.js").ActionName,
      [],
      ['set_factor_value'],
      'needs_encoding',
      guidance,
    );
    // Floor must NOT activate — the only suppressed candidate was also recently
    // executed, so promoting it would repeat an action just taken.
    const activated = infoSpy.mock.calls.some(
      (args) => (args[0] as Record<string, unknown>)?.event === 'v4.chip_floor_activated',
    );
    expect(activated).toBe(false);
    // No chip with set_factor_value should appear.
    const chipActionTypes = chips.map(c => c.parameters?.action_type);
    expect(chipActionTypes).not.toContain('set_factor_value');
  });
});
