/**
 * Session Decision State (WS6)
 *
 * Bounded session state accumulated across turns. NOT persistent storage —
 * lives in the turn request payload, passed from UI. The UI stores the
 * updated_session_state from the response envelope and echoes it back on
 * the next turn request.
 *
 * Feature flag: CEE_COACHING_CONTEXT_ENABLED (shared with WS1/WS8)
 */

import type { ActionName } from "./actions/types.js";
import type { DeterministicTurnContext } from "./types.js";
import type { V2RunResponseEnvelope } from "../types.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

export interface SessionState {
  /** User's stated prediction, e.g. "I think Option A will win" */
  prediction: string | null;
  /** Factor IDs the user has calibrated (via set_factor_value) */
  calibrations_provided: string[];
  /** Coaching play IDs fired this session (for deduplication) */
  plays_fired: string[];
  /** Question topics asked by the assistant this session */
  questions_asked: string[];
  /** Count of accepted graph patches */
  accepted_patches: number;
  /** Count of dismissed graph patches */
  dismissed_patches: number;
  /** chip_ids shown on the most recent turn */
  last_chip_ids_shown: string[];
  /** chip_ids shown on the turn before the most recent (two-turn suppression window) */
  chip_ids_shown_prev_turn: string[];
  /** chip_ids the user explicitly clicked on any recent turn — exempt from the
   *  suppression window so a clicked chip can reappear immediately if still relevant. */
  chip_ids_clicked: string[];
  /** Turn number when last question was asked */
  last_question_turn: number;
  /** Detected preferred option from user messages */
  preferred_option: string | null;
  /** Convergence signal for coaching mode selection */
  convergence_signal: 'exploring' | 'narrowing' | 'converging';
  /**
   * Hash of graph + scenario at the point the most recent successful
   * run_analysis produced prior_analysis_envelope. Used as a freshness
   * gate before rehydrating analysis state on evaluate-stage turns.
   * Cleared whenever a graph-mutating action runs.
   */
  analysis_graph_hash: string | null;
  /**
   * Scenario the cached analysis envelope was produced for. Rehydration
   * requires both graph hash AND scenario_id to match.
   */
  analysis_scenario_id: string | null;
  /**
   * Cached analysis envelope from the most recent successful run_analysis.
   * Cleared on any graph-mutating action so stale numeric results cannot
   * survive structural edits. Presentation-only safety net: the canonical
   * path is the client forwarding analysis_state on every evaluate turn.
   *
   * Typed loosely because the schema layer (SessionStateSchema) validates
   * via object-passthrough — the pipeline runs normalizeAnalysisEnvelope
   * before the cached payload is used, so strict typing at this layer
   * would over-constrain the round-trip. Structurally this is a
   * V2RunResponseEnvelope.
   */
  prior_analysis_envelope: Record<string, unknown> | V2RunResponseEnvelope | null;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Merge a partial (possibly undefined) session state from the request with defaults.
 * Handles missing fields, malformed payloads, and backward compatibility.
 */
export function mergeSessionState(input: Partial<SessionState> | null | undefined): SessionState {
  const defaults = defaultSessionState();
  if (!input || typeof input !== 'object') return defaults;
  // Defensive copies for all array fields so a mutation in CEE cannot reach
  // back into the request payload. Without this, any future consumer that
  // forgets to spread (e.g. a direct .push into next.calibrations_provided)
  // would corrupt the client's state on round-trip.
  return {
    prediction: typeof input.prediction === 'string' ? input.prediction : defaults.prediction,
    calibrations_provided: Array.isArray(input.calibrations_provided) ? [...input.calibrations_provided] : defaults.calibrations_provided,
    plays_fired: Array.isArray(input.plays_fired) ? [...input.plays_fired] : defaults.plays_fired,
    questions_asked: Array.isArray(input.questions_asked) ? [...input.questions_asked] : defaults.questions_asked,
    accepted_patches: typeof input.accepted_patches === 'number' ? input.accepted_patches : defaults.accepted_patches,
    dismissed_patches: typeof input.dismissed_patches === 'number' ? input.dismissed_patches : defaults.dismissed_patches,
    last_chip_ids_shown: Array.isArray(input.last_chip_ids_shown) ? [...input.last_chip_ids_shown] : defaults.last_chip_ids_shown,
    chip_ids_shown_prev_turn: Array.isArray(input.chip_ids_shown_prev_turn) ? [...input.chip_ids_shown_prev_turn] : defaults.chip_ids_shown_prev_turn,
    chip_ids_clicked: Array.isArray(input.chip_ids_clicked) ? [...input.chip_ids_clicked] : defaults.chip_ids_clicked,
    last_question_turn: typeof input.last_question_turn === 'number' ? input.last_question_turn : defaults.last_question_turn,
    preferred_option: typeof input.preferred_option === 'string' ? input.preferred_option : defaults.preferred_option,
    convergence_signal: input.convergence_signal === 'exploring' || input.convergence_signal === 'narrowing' || input.convergence_signal === 'converging'
      ? input.convergence_signal
      : defaults.convergence_signal,
    analysis_graph_hash: typeof input.analysis_graph_hash === 'string' ? input.analysis_graph_hash : defaults.analysis_graph_hash,
    analysis_scenario_id: typeof input.analysis_scenario_id === 'string' ? input.analysis_scenario_id : defaults.analysis_scenario_id,
    prior_analysis_envelope: input.prior_analysis_envelope && typeof input.prior_analysis_envelope === 'object'
      ? (input.prior_analysis_envelope as V2RunResponseEnvelope)
      : defaults.prior_analysis_envelope,
  };
}

/** Create a default (empty) session state for first turn or missing payload. */
export function defaultSessionState(): SessionState {
  return {
    prediction: null,
    calibrations_provided: [],
    plays_fired: [],
    questions_asked: [],
    accepted_patches: 0,
    dismissed_patches: 0,
    last_chip_ids_shown: [],
    chip_ids_shown_prev_turn: [],
    chip_ids_clicked: [],
    last_question_turn: 0,
    preferred_option: null,
    convergence_signal: 'exploring',
    analysis_graph_hash: null,
    analysis_scenario_id: null,
    prior_analysis_envelope: null,
  };
}

// ============================================================================
// State Advancement
// ============================================================================

/** Optional context from the executed action, threaded by the pipeline. */
export interface ActionOutcome {
  /** Factor ID that was calibrated (from set_factor_value action params). */
  calibrated_factor_id?: string;
  /** Whether a patch was accepted this turn (from confirmation flow). */
  patch_accepted?: boolean;
  /** Whether a patch was dismissed this turn (from confirmation flow). */
  patch_dismissed?: boolean;
}

/**
 * Call-site options for advanceSessionState.
 *
 * `speculative`: when true, the turn emitted an unaccepted proposal patch
 * (status: 'proposed', auto_apply: false). In that case the user has not
 * yet committed to the edit, so session state must NOT:
 *   - register calibrations_provided (they haven't confirmed the value)
 *   - clear the analysis cache (the accepted graph hasn't changed)
 *   - recompute convergence as though they edited (they haven't yet)
 * The chip-suppression window and played-plays still advance because
 * those track what was SHOWN, not what was committed.
 */
export interface AdvanceOptions {
  speculative?: boolean;
}

/**
 * Advance session state after a turn completes.
 *
 * Pure function — returns a new SessionState without mutating `prev`.
 * Called after action execution but before envelope assembly.
 */
export function advanceSessionState(
  prev: SessionState,
  executedAction: ActionName | null,
  turnContext: DeterministicTurnContext,
  outcome?: ActionOutcome,
  options?: AdvanceOptions,
): SessionState {
  const next: SessionState = {
    prediction: prev.prediction,
    calibrations_provided: [...prev.calibrations_provided],
    plays_fired: [...prev.plays_fired],
    questions_asked: [...prev.questions_asked],
    accepted_patches: prev.accepted_patches,
    dismissed_patches: prev.dismissed_patches,
    last_chip_ids_shown: [...prev.last_chip_ids_shown], // updated externally by chip engine
    chip_ids_shown_prev_turn: [...prev.chip_ids_shown_prev_turn],
    chip_ids_clicked: [...prev.chip_ids_clicked],
    last_question_turn: prev.last_question_turn,
    preferred_option: prev.preferred_option,
    convergence_signal: prev.convergence_signal,
    analysis_graph_hash: prev.analysis_graph_hash,
    analysis_scenario_id: prev.analysis_scenario_id,
    prior_analysis_envelope: prev.prior_analysis_envelope,
  };

  // Speculative turns (proposal patch emitted, not yet accepted) must not
  // advance calibrations, clear the analysis cache, or mark the edit as
  // committed for convergence. The accepted graph has not actually changed.
  const speculative = options?.speculative === true;

  // Graph-mutating actions invalidate any cached analysis. Clear before
  // the turn's envelope is written so a subsequent evaluate turn on the
  // modified graph will not rehydrate stale numeric results. Skip on
  // speculative turns — the cache is still valid against the accepted graph.
  const GRAPH_MUTATING_ACTIONS: ReadonlySet<string> = new Set([
    'edit_graph', 'draft_graph',
    'add_factor', 'add_option', 'remove_factor', 'remove_option',
    'adjust_edge_strength', 'set_factor_value', 'set_goal_target',
    'add_constraint',
  ]);
  if (!speculative && executedAction && GRAPH_MUTATING_ACTIONS.has(executedAction)) {
    next.analysis_graph_hash = null;
    next.analysis_scenario_id = null;
    next.prior_analysis_envelope = null;
  }

  // Track calibrations from set_factor_value — accepted edits only.
  if (!speculative && executedAction === 'set_factor_value' && outcome?.calibrated_factor_id) {
    if (!next.calibrations_provided.includes(outcome.calibrated_factor_id)) {
      next.calibrations_provided.push(outcome.calibrated_factor_id);
    }
  }

  // Track patch acceptance/dismissal when threaded from confirmation flow
  if (outcome?.patch_accepted) {
    next.accepted_patches++;
  }
  if (outcome?.patch_dismissed) {
    next.dismissed_patches++;
  }

  // Compute convergence signal — use `next` so freshly incremented
  // accepted_patches / dismissed_patches are visible to the convergence check.
  // On speculative turns, pass null for executedAction so convergence does
  // not treat the unaccepted edit as a commit signal.
  next.convergence_signal = computeConvergence(
    next,
    speculative ? null : executedAction,
    turnContext,
  );

  log.debug({
    event: 'v4.session_state',
    speculative,
    convergence_signal: next.convergence_signal,
    calibrations_count: next.calibrations_provided.length,
    plays_fired_count: next.plays_fired.length,
    accepted_patches: next.accepted_patches,
  }, 'Session state advanced');

  return next;
}

// ============================================================================
// Convergence Detection
// ============================================================================

/**
 * Determine convergence signal from session state + current turn.
 *
 * - `exploring`: fewer than 3 turns OR no analysis run
 * - `narrowing`: analysis run, user still editing
 * - `converging`: user asked for brief, or accepted 2+ turns without editing
 */
function computeConvergence(
  prev: SessionState,
  executedAction: ActionName | null,
  turnContext: DeterministicTurnContext,
): 'exploring' | 'narrowing' | 'converging' {
  // If user asked for a brief or artefact, they're converging
  if (executedAction === 'generate_artefact') {
    return 'converging';
  }

  // If already converging, stay converging unless they edit
  if (prev.convergence_signal === 'converging') {
    const editActions: ReadonlySet<string> = new Set([
      'add_factor', 'add_option', 'remove_factor', 'adjust_edge_strength',
      'set_factor_value', 'add_constraint', 'set_goal_target',
    ]);
    if (executedAction && editActions.has(executedAction)) {
      return 'narrowing'; // Went back to editing
    }
    return 'converging';
  }

  // No analysis yet → exploring
  if (!turnContext.analysis_summary) {
    return 'exploring';
  }

  // Fewer than 3 turns → exploring
  if (turnContext.conversation.turn_count < 3) {
    return 'exploring';
  }

  // Analysis exists — are they still editing?
  const editActions: ReadonlySet<string> = new Set([
    'add_factor', 'add_option', 'remove_factor', 'adjust_edge_strength',
    'set_factor_value', 'add_constraint', 'set_goal_target',
  ]);
  if (executedAction && editActions.has(executedAction)) {
    return 'narrowing';
  }

  // Analysis exists, not editing — check for convergence signals
  // Accepted 2+ patches without further editing suggests converging
  if (prev.accepted_patches >= 2 && prev.convergence_signal === 'narrowing') {
    return 'converging';
  }

  // Default: narrowing once analysis exists
  return 'narrowing';
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Register a coaching play as fired (deduplication).
 * Returns a new SessionState — does not mutate.
 */
export function registerPlay(state: SessionState, playId: string): SessionState {
  if (state.plays_fired.includes(playId)) return state;
  return { ...state, plays_fired: [...state.plays_fired, playId] };
}

/**
 * Register a factor calibration.
 * Returns a new SessionState — does not mutate.
 */
export function registerCalibration(state: SessionState, factorId: string): SessionState {
  if (state.calibrations_provided.includes(factorId)) return state;
  return { ...state, calibrations_provided: [...state.calibrations_provided, factorId] };
}

/**
 * Update last shown chip IDs for suppression tracking. Shifts the previous
 * turn's shown IDs into `chip_ids_shown_prev_turn` so the chip engine can
 * suppress chips shown in the last 2 turns (not just the most recent).
 *
 * Returns a new SessionState — does not mutate.
 */
export function updateLastChipIds(state: SessionState, chipIds: string[]): SessionState {
  return {
    ...state,
    chip_ids_shown_prev_turn: state.last_chip_ids_shown,
    last_chip_ids_shown: chipIds,
  };
}

/**
 * Return the set of chip_ids that should be suppressed on the current turn:
 * the union of chips shown on the most recent turn and the turn before,
 * MINUS any chip the user has explicitly clicked (clicked chips can reappear
 * immediately if still relevant).
 *
 * Used by the chip engine to enforce the "shown and ignored in last 2 turns"
 * suppression rule from the WS5 brief.
 */
export function suppressedChipIds(state: SessionState): Set<string> {
  const clicked = new Set(state.chip_ids_clicked);
  const suppressed = new Set<string>();
  for (const id of state.last_chip_ids_shown) {
    if (!clicked.has(id)) suppressed.add(id);
  }
  for (const id of state.chip_ids_shown_prev_turn) {
    if (!clicked.has(id)) suppressed.add(id);
  }
  return suppressed;
}

/**
 * Register a chip click — removes the chip from future suppression so that
 * if still relevant it can reappear immediately. Called by the pipeline when
 * a turn comes in with `chip_metadata.action_type`.
 */
export function registerChipClick(state: SessionState, chipId: string): SessionState {
  if (state.chip_ids_clicked.includes(chipId)) return state;
  return { ...state, chip_ids_clicked: [...state.chip_ids_clicked, chipId] };
}
