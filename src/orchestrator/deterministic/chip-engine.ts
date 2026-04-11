/**
 * Typed Chip Engine (WS5)
 *
 * Produces contextual, decision-language chips from CoachingContext signals
 * and SessionState suppression. Replaces the legacy buildDeterministicChips
 * (chip-builder-v4.ts) which only renders tool-name labels.
 *
 * Rules:
 *   - Max 3 chips per turn.
 *   - At least one progress chip (run_analysis / generate_artefact / decide)
 *     unless the turn is in confirmation state or RECOVER mode, in which case
 *     progress chips are suppressed.
 *   - No duplicate labels/action_types.
 *   - Suppress any chip whose chip_id was shown in the last turn's
 *     last_chip_ids_shown (from SessionState).
 *   - Sanitise every label and prompt via sanitiseAssistantText.
 *   - chip_id is deterministic so the UI can round-trip suppression.
 *
 * Feature flag: CEE_CHIP_ENGINE_ENABLED.
 */

import type { SuggestedAction } from "../types.js";
import type { ActionName } from "./actions/types.js";
import type { DeterministicTurnContext } from "./types.js";
import type { CoachingContext } from "./coaching-context-builder.js";
import type { SessionState } from "./session-state.js";
import { suppressedChipIds } from "./session-state.js";
import { sanitiseAssistantText } from "./sanitise-output.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Internal chip shape with metadata the engine uses before flattening
 * to the public SuggestedAction contract.
 */
interface TypedChip {
  /** Stable ID used for session suppression round-trip. */
  chip_id: string;
  /** Chip category — drives ordering and progress-slot logic. */
  type: 'calibrate' | 'challenge' | 'analyse' | 'explain' | 'evidence' | 'restructure' | 'decide';
  /** Tool name routed on click. */
  action_type: ActionName;
  /** Role badge shown in the UI. */
  role: 'facilitator' | 'challenger' | 'scientist';
  /** Short decision-language label (max 6 words). */
  label: string;
  /** Message sent to the pipeline on click. */
  message: string;
  /** Priority within the engine (lower = earlier). */
  priority: number;
}

// ============================================================================
// Progress-chip identification
// ============================================================================

/** Chip types that count as "progress" — moves the decision forward. */
const PROGRESS_TYPES: ReadonlySet<TypedChip['type']> = new Set(['analyse', 'decide']);

// ============================================================================
// Entry point
// ============================================================================

/**
 * Compute contextual chips from coaching signals + session suppression.
 *
 * The engine picks a chip bundle based on `chip_inputs` + `coaching_mode`
 * + graph/analysis signals, then applies session suppression, dedup,
 * sanitisation, and the max-3 cap.
 */
export function computeChips(
  coaching: CoachingContext,
  sessionState: SessionState,
  turnContext: DeterministicTurnContext,
  executedAction: ActionName | null,
  deferredActions: ActionName[],
): SuggestedAction[] {
  const ci = coaching.chip_inputs;
  const inRecoverOrConfirm =
    coaching.coaching_mode === 'recover'
    || turnContext.conversation.pending_confirmation != null;

  // Step 1: select the chip bundle for this context.
  const candidates: TypedChip[] = [];

  if (!ci.has_analysis) {
    // Post-draft / IDEATE path.
    if (coaching.ai_estimated_count > 0) {
      // High AI-estimated — calibrate + challenge + progress.
      candidates.push(chipHelpCalibrate(coaching));
      candidates.push(chipWhatCouldGoWrong());
      candidates.push(chipRunAnalysis(turnContext));
    } else if (coaching.risk_factor_count === 0) {
      // No risk factors modelled — challenge frame.
      candidates.push(chipWhatCouldGoWrong());
      candidates.push(chipOtherApproaches());
      candidates.push(chipRunAnalysis(turnContext));
    } else {
      // Generic post-draft — progress + calibrate + challenge.
      candidates.push(chipRunAnalysis(turnContext));
      candidates.push(chipHelpCalibrate(coaching));
      candidates.push(chipWhatCouldGoWrong());
    }
  } else if (ci.analysis_fresh) {
    // Post-analysis path.
    if (ci.stability_band === 'fragile') {
      // Fragile result — challenge + calibrate + compare.
      candidates.push(chipWhatWouldChange());
      candidates.push(chipCalibrateTopFactor(coaching));
      candidates.push(chipCompareOptions());
    } else if (ci.dominant_factor_label) {
      // Dominant factor — confidence check + flip + brief.
      candidates.push(chipHowConfidentInFactor(ci.dominant_factor_label));
      candidates.push(chipWhatWouldFlip());
      candidates.push(chipGenerateBrief());
    } else {
      // Stable result — calibrate + premortem + brief.
      candidates.push(chipHowConfidentInFactor(coaching.drivers[0]?.factor_label ?? 'the top driver'));
      candidates.push(chipRunPremortem());
      candidates.push(chipGenerateBrief());
    }
  } else {
    // Stale analysis (analysis_summary absent from coaching_inputs when the
    // UI stripped it due to graph edits). Offer re-run + review.
    candidates.push(chipReRunWithUpdatedModel());
    candidates.push(chipReviewChangesFirst());
  }

  // Step 2: add deferred chips at the front (compound tool calls the LLM
  // emitted but the pipeline discarded per one-tool-per-turn).
  for (const deferred of deferredActions) {
    if (candidates.some(c => c.action_type === deferred)) continue;
    const deferredChip = chipFromDeferredAction(deferred);
    if (deferredChip) {
      candidates.unshift(deferredChip);
    }
  }

  // Step 3: filter by session suppression + recent execution.
  // Suppression covers chips shown on the last 2 turns (last_chip_ids_shown
  // + chip_ids_shown_prev_turn), except ones the user explicitly clicked —
  // those can reappear immediately if still relevant.
  const suppressedIds = suppressedChipIds(sessionState);
  const recentActions = new Set(turnContext.conversation.recent_actions_taken ?? []);
  if (executedAction) recentActions.add(executedAction);

  let filtered = candidates.filter(c => {
    if (suppressedIds.has(c.chip_id)) {
      log.debug({ event: 'v4.chip_engine.suppressed_by_session', chip_id: c.chip_id }, 'Chip suppressed by 2-turn session window');
      return false;
    }
    if (recentActions.has(c.action_type)) {
      return false;
    }
    return true;
  });

  // Step 4: deduplicate by action_type (keep first occurrence).
  const seenTypes = new Set<ActionName>();
  filtered = filtered.filter(c => {
    if (seenTypes.has(c.action_type)) return false;
    seenTypes.add(c.action_type);
    return true;
  });

  // Step 5: progress-slot rule.
  // When not in recover/confirm mode AND the turn is pre-analysis, ensure at
  // least one progress chip is present in the first 3. Post-analysis bundles
  // already encode forward motion (compare / pre-mortem / generate brief)
  // so we do not force-insert an additional progress chip there.
  if (!inRecoverOrConfirm && !ci.has_analysis) {
    const top3 = filtered.slice(0, 3);
    const hasProgress = top3.some(c => PROGRESS_TYPES.has(c.type));
    if (!hasProgress) {
      const progressChip = chipRunAnalysis(turnContext);
      // Only add if its action isn't recently executed and it's not already present.
      if (!recentActions.has(progressChip.action_type) && !seenTypes.has(progressChip.action_type)) {
        filtered = [progressChip, ...filtered];
      }
    }
  } else if (inRecoverOrConfirm) {
    // In recover/confirm mode: suppress progress chips entirely.
    filtered = filtered.filter(c => !PROGRESS_TYPES.has(c.type));
  }

  // Step 6: cap at 3.
  const capped = filtered.slice(0, 3);

  // Step 7: sanitise + flatten to SuggestedAction.
  const result: SuggestedAction[] = capped.map(c => ({
    label: sanitiseAssistantText(c.label),
    prompt: sanitiseAssistantText(c.message),
    role: c.role,
    action_type: c.action_type,
    parameters: { chip_id: c.chip_id, chip_type: c.type },
  }));

  log.debug({
    event: 'v4.chip_engine.computed',
    count: result.length,
    types: capped.map(c => c.type),
    action_types: capped.map(c => c.action_type),
    in_recover_or_confirm: inRecoverOrConfirm,
  }, 'Chip engine computed chips');

  return result;
}

/**
 * Return the set of chip_ids computed this turn, for the UI to round-trip
 * as the next turn's `session_state.last_chip_ids_shown`.
 */
export function getChipIdsForSession(chips: SuggestedAction[]): string[] {
  return chips
    .map(c => (c.parameters?.chip_id as string | undefined) ?? null)
    .filter((id): id is string => id != null);
}

// ============================================================================
// Chip factories — each returns a TypedChip with decision-language labels
// ============================================================================

function chipHelpCalibrate(coaching: CoachingContext): TypedChip {
  const target = coaching.calibration_target;
  const label = target ? `Calibrate ${target.source_label}` : 'Help me calibrate';
  const message = target
    ? `Walk me through calibrating ${target.source_label}. What value would you expect in your experience?`
    : 'Walk me through calibrating the key assumptions in this model.';
  return {
    chip_id: target ? `calibrate_${target.factor_id}` : 'calibrate_general',
    type: 'calibrate',
    action_type: 'set_factor_value',
    role: 'facilitator',
    label: truncateLabel(label),
    message,
    priority: 2,
  };
}

function chipWhatCouldGoWrong(): TypedChip {
  return {
    chip_id: 'challenge_risks',
    type: 'challenge',
    action_type: 'challenge_assumption',
    role: 'challenger',
    label: 'What could go wrong?',
    message: 'Walk me through the biggest risks for this decision.',
    priority: 3,
  };
}

function chipOtherApproaches(): TypedChip {
  return {
    chip_id: 'challenge_alternatives',
    type: 'restructure',
    action_type: 'add_option',
    role: 'challenger',
    label: 'Are there other approaches?',
    message: 'What alternative options should I consider adding to this model?',
    priority: 4,
  };
}

function chipRunAnalysis(turnContext: DeterministicTurnContext): TypedChip {
  void turnContext;
  return {
    chip_id: 'progress_run_analysis',
    type: 'analyse',
    action_type: 'run_analysis',
    role: 'facilitator',
    label: 'Run analysis',
    message: 'Run the analysis on this model.',
    priority: 1,
  };
}

function chipWhatWouldChange(): TypedChip {
  return {
    chip_id: 'challenge_what_would_change',
    type: 'challenge',
    action_type: 'what_would_flip',
    role: 'challenger',
    label: 'What would change this?',
    message: 'What would need to change for this result to flip?',
    priority: 2,
  };
}

function chipCalibrateTopFactor(coaching: CoachingContext): TypedChip {
  const top = coaching.drivers[0];
  const label = top ? `Calibrate ${top.factor_label}` : 'Calibrate the top driver';
  const message = top
    ? `Help me calibrate ${top.factor_label}. How confident are you in that estimate?`
    : 'Help me calibrate the top driver in the results.';
  return {
    chip_id: top ? `calibrate_${top.factor_id}` : 'calibrate_top_driver',
    type: 'calibrate',
    action_type: 'set_factor_value',
    role: 'facilitator',
    label: truncateLabel(label),
    message,
    priority: 3,
  };
}

function chipCompareOptions(): TypedChip {
  return {
    chip_id: 'explain_compare',
    type: 'explain',
    action_type: 'compare_options',
    role: 'facilitator',
    label: 'Compare the options',
    message: 'Compare the leading options in detail.',
    priority: 4,
  };
}

function chipHowConfidentInFactor(factorLabel: string): TypedChip {
  // Keep the chip_id stable on the factor label so suppression works even if
  // the label slightly differs turn-to-turn.
  const id = `calibrate_${factorLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  return {
    chip_id: id,
    type: 'calibrate',
    action_type: 'set_factor_value',
    role: 'facilitator',
    label: truncateLabel(`How confident in ${factorLabel}?`),
    message: `How confident are you in ${factorLabel}? What would change your view?`,
    priority: 2,
  };
}

function chipWhatWouldFlip(): TypedChip {
  return {
    chip_id: 'challenge_what_would_flip',
    type: 'challenge',
    action_type: 'what_would_flip',
    role: 'challenger',
    label: 'What would flip this?',
    message: 'Show me what would flip this result.',
    priority: 3,
  };
}

function chipRunPremortem(): TypedChip {
  return {
    chip_id: 'challenge_premortem',
    type: 'challenge',
    action_type: 'run_premortem',
    role: 'challenger',
    label: 'Run a pre-mortem',
    message: 'Run a pre-mortem on the leading option.',
    priority: 4,
  };
}

function chipGenerateBrief(): TypedChip {
  return {
    chip_id: 'decide_generate_brief',
    type: 'decide',
    action_type: 'generate_artefact',
    role: 'facilitator',
    label: 'Generate a decision brief',
    message: 'Generate a decision brief I can share.',
    priority: 1,
  };
}

function chipReRunWithUpdatedModel(): TypedChip {
  return {
    chip_id: 'progress_rerun_analysis',
    type: 'analyse',
    action_type: 'run_analysis',
    role: 'facilitator',
    label: 'Re-run with updated model',
    message: 'Re-run the analysis with the updated model.',
    priority: 1,
  };
}

function chipReviewChangesFirst(): TypedChip {
  return {
    chip_id: 'explain_review_changes',
    type: 'explain',
    action_type: 'explain_result',
    role: 'facilitator',
    label: 'Review the changes first',
    message: 'Walk me through what has changed since the last analysis.',
    priority: 2,
  };
}

/**
 * Build a chip for a deferred (compound) tool call that the pipeline discarded
 * due to the one-tool-per-turn policy. Returns null if the action is not
 * surfaceable as a chip.
 */
function chipFromDeferredAction(action: ActionName): TypedChip | null {
  // Only actions with clear decision-language framings are promoted.
  switch (action) {
    case 'run_analysis':
      return { ...chipRunAnalysis({} as DeterministicTurnContext), priority: 0, chip_id: 'deferred_run_analysis' };
    case 'explain_result':
      return { ...chipReviewChangesFirst(), priority: 0, chip_id: 'deferred_explain' };
    case 'compare_options':
      return { ...chipCompareOptions(), priority: 0, chip_id: 'deferred_compare' };
    case 'what_would_flip':
      return { ...chipWhatWouldFlip(), priority: 0, chip_id: 'deferred_flip' };
    case 'run_premortem':
      return { ...chipRunPremortem(), priority: 0, chip_id: 'deferred_premortem' };
    case 'challenge_assumption':
      return { ...chipWhatCouldGoWrong(), priority: 0, chip_id: 'deferred_challenge' };
    default:
      return null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Enforce the max-6-words label rule. Truncates at the last word boundary.
 */
function truncateLabel(label: string): string {
  const words = label.split(/\s+/);
  if (words.length <= 6) return label;
  return words.slice(0, 6).join(' ');
}
