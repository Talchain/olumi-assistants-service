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
import type { GuidanceItem } from "../types/guidance-item.js";
import { SIGNAL_CODES } from "../types/guidance-item.js";
import { suppressedChipIds } from "./session-state.js";
import { sanitiseAssistantText } from "./sanitise-output.js";
import { chipActionToTool } from "./action-tool-mapping.js";
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
 * sanitisation, the max-3 cap, and tool-availability filtering.
 *
 * `availableTools` lists the tool names that survived pipeline filtering
 * (stage policy + context exclusions). Any chip whose action_type maps
 * to a tool not in this list is filtered out. Chips that don't map to
 * a tool (virtual actions) always pass.
 *
 * `analysisReadyStatus` is the per-turn readiness gate. When it's a
 * defined non-'ready' value (e.g. 'needs_encoding', 'needs_user_input',
 * 'blocked'), the 'Run analysis' chip is suppressed before dedup/slot
 * logic — we never offer a progress chip the tool can't honour.
 * Undefined/null means "unknown" and the gate does not fire (backwards
 * compatible with callers that don't pass it).
 */
export function computeChips(
  coaching: CoachingContext,
  sessionState: SessionState,
  turnContext: DeterministicTurnContext,
  executedAction: ActionName | null,
  deferredActions: ActionName[],
  availableTools: readonly string[] = [],
  analysisReadyStatus?: string | null,
  guidanceItems: readonly GuidanceItem[] = [],
): SuggestedAction[] {
  const ci = coaching.chip_inputs;
  const inRecoverOrConfirm =
    coaching.coaching_mode === 'recover'
    || turnContext.conversation.pending_confirmation != null;

  // Readiness gate: suppress 'Run analysis' when we have an explicit status
  // that is not 'ready'. Unknown status (undefined/null) does not fire the
  // gate — matches pre-v5 behaviour so callers without the hint still work.
  const canRunAnalysis = analysisReadyStatus == null || analysisReadyStatus === 'ready';

  // Step 1: select the chip bundle for this context.
  const candidates: TypedChip[] = [];

  // Track whether the gate actually prevented a run_analysis chip from being
  // surfaced this turn (bundle push, deferred promotion, or slot-rule
  // backfill). We log the suppression event at most once per turn regardless
  // of how many insertion points the gate fired on.
  let runAnalysisSuppressed = false;
  const suppressRunAnalysis = (source: 'bundle' | 'deferred' | 'slot_rule'): void => {
    if (runAnalysisSuppressed) return;
    runAnalysisSuppressed = true;
    log.info(
      {
        event: 'v4.chip_run_analysis_suppressed',
        analysis_ready_status: analysisReadyStatus,
        source,
      },
      'chipRunAnalysis suppressed: analysis_ready.status is not "ready"',
    );
  };

  if (!ci.has_analysis) {
    // Post-draft / IDEATE path.
    if (coaching.ai_estimated_count > 0) {
      // High AI-estimated — calibrate + challenge + progress.
      candidates.push(chipHelpCalibrate(coaching));
      candidates.push(chipWhatCouldGoWrong());
      if (canRunAnalysis) candidates.push(chipRunAnalysis(turnContext));
      else suppressRunAnalysis('bundle');
    } else if (coaching.risk_factor_count === 0) {
      // No risk factors modelled — challenge frame.
      candidates.push(chipWhatCouldGoWrong());
      candidates.push(chipOtherApproaches());
      if (canRunAnalysis) candidates.push(chipRunAnalysis(turnContext));
      else suppressRunAnalysis('bundle');
    } else {
      // Generic post-draft — progress + calibrate + challenge.
      if (canRunAnalysis) candidates.push(chipRunAnalysis(turnContext));
      else suppressRunAnalysis('bundle');
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
      // Dominant factor — confidence check + flip + premortem.
      // chipGenerateBrief suppressed: generate_artefact handler is not yet functional.
      candidates.push(chipHowConfidentInFactor(ci.dominant_factor_label));
      candidates.push(chipWhatWouldFlip());
      candidates.push(chipRunPremortem());
    } else {
      // Stable result — calibrate + premortem + compare.
      // chipGenerateBrief suppressed: generate_artefact handler is not yet functional.
      candidates.push(chipHowConfidentInFactor(coaching.drivers[0]?.factor_label ?? 'the top driver'));
      candidates.push(chipRunPremortem());
      candidates.push(chipCompareOptions());
    }
  } else {
    // Stale analysis (analysis_summary absent from coaching_inputs when the
    // UI stripped it due to graph edits). Offer re-run + review.
    candidates.push(chipReRunWithUpdatedModel());
    candidates.push(chipReviewChangesFirst());
  }

  // Step 2: add deferred chips at the front (compound tool calls the LLM
  // emitted but the pipeline discarded per one-tool-per-turn). Honour the
  // readiness gate here too — a deferred `run_analysis` must not bypass the
  // non-ready state. Promotes gate-aware behaviour to every insertion path.
  for (const deferred of deferredActions) {
    if (candidates.some(c => c.action_type === deferred)) continue;
    if (deferred === 'run_analysis' && !canRunAnalysis) {
      suppressRunAnalysis('deferred');
      continue;
    }
    const deferredChip = chipFromDeferredAction(deferred);
    if (deferredChip) {
      candidates.unshift(deferredChip);
    }
  }

  // Step 2b (Fix 1 Layer 1): widen the candidate pool with guidance-derived
  // chips. Hardcoded bundles produce 3 candidates — a 2-turn session window
  // exhausts them on T2 and starves the user of chips. Guidance items are
  // structurally grounded (DEFAULT_NODE_CONFIDENCE on node X, MISSING_FRAMING
  // on goal Y, …) so they vary by graph state and give the session window
  // fresh candidates to promote instead of suppressing everything.
  //
  // Priority 10 puts these below every bundle chip (priority 1-4), so bundle
  // wins when unsuppressed. chip_id uses the guidance item_id (already hashed
  // on signal_code + target_id + source) so they're naturally deterministic
  // and unique, and suppression tracks them correctly turn-to-turn.
  for (const g of guidanceItems) {
    const candidate = chipFromGuidance(g);
    if (!candidate) continue;
    if (candidates.some(c => c.chip_id === candidate.chip_id)) continue;
    candidates.push(candidate);
  }

  // Step 3: filter by session suppression + recent execution.
  // Suppression covers chips shown on the last 2 turns (last_chip_ids_shown
  // + chip_ids_shown_prev_turn), except ones the user explicitly clicked —
  // those can reappear immediately if still relevant.
  const suppressedIds = suppressedChipIds(sessionState);
  const recentActions = new Set(turnContext.conversation.recent_actions_taken ?? []);
  if (executedAction) recentActions.add(executedAction);

  // Track chips suppressed ONLY by the session window (not by recent
  // execution or downstream gates) so Layer 2 can promote one through the
  // floor if everything else is exhausted. Chips filtered by recentActions
  // are NOT in this list — we never force an action we just executed.
  //
  // IMPORTANT: recentActions is checked FIRST. A chip whose action_type was
  // just executed must never enter sessionSuppressed — otherwise the floor
  // could bypass the recent-action protection and force that action again.
  // The comment in 6b ("recent executions still exclude the chip from
  // sessionSuppressed") is only valid when this ordering is respected.
  const sessionSuppressed: TypedChip[] = [];
  let filtered = candidates.filter(c => {
    if (recentActions.has(c.action_type)) {
      return false;
    }
    if (suppressedIds.has(c.chip_id)) {
      sessionSuppressed.push(c);
      log.debug({ event: 'v4.chip_engine.suppressed_by_session', chip_id: c.chip_id }, 'Chip suppressed by 2-turn session window');
      return false;
    }
    return true;
  });

  // Step 4: deduplicate by action_type (keep first occurrence).
  //
  // Guidance-derived chips (chip_id prefix `gi_`) are exempt: they represent
  // target-specific actions (calibrate THIS factor, flip FROM this driver)
  // and shouldn't be squashed by a generic bundle chip with the same
  // action_type but a different target. A separate chip_id dedup below
  // prevents duplicate IDs.
  const seenTypes = new Set<ActionName>();
  const seenChipIds = new Set<string>();
  filtered = filtered.filter(c => {
    if (seenChipIds.has(c.chip_id)) return false;
    seenChipIds.add(c.chip_id);
    const isGuidance = c.chip_id.startsWith('gi_');
    if (isGuidance) return true;
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
      if (canRunAnalysis) {
        const progressChip = chipRunAnalysis(turnContext);
        // Only add if its action isn't recently executed and it's not already present.
        if (!recentActions.has(progressChip.action_type) && !seenTypes.has(progressChip.action_type)) {
          filtered = [progressChip, ...filtered];
        }
      } else {
        // Slot rule would normally force-insert run_analysis; the readiness
        // gate blocks that. Record the suppression so chip telemetry reflects it.
        suppressRunAnalysis('slot_rule');
      }
    }
  } else if (inRecoverOrConfirm) {
    // In recover/confirm mode: suppress progress chips entirely.
    filtered = filtered.filter(c => !PROGRESS_TYPES.has(c.type));
  }

  // Step 6: filter by tool availability.
  // Remove any chip whose action_type maps to a tool not in the resolved
  // tool set BEFORE capping at 3, so valid chips at position 4+ can
  // backfill slots vacated by unavailable tools.
  const toolSet = new Set(availableTools);
  const available = filtered.filter(c => {
    const tool = chipActionToTool(c.action_type);
    if (!tool) return true; // Virtual action — always passes
    if (toolSet.has(tool)) return true;
    log.debug({
      event: 'v4.chip_filtered_unavailable',
      chip_id: c.chip_id,
      action_type: c.action_type,
      mapped_tool: tool,
    }, 'Chip filtered: mapped tool not in available tools');
    return false;
  });

  // Step 6b (Fix 1 Layer 2): chip floor. If Layer 1 + filtering still leaves
  // us with zero chips AND a graph exists AND at least one availability-valid
  // chip was suppressed ONLY by the session window, bypass session-window
  // suppression for the single highest-priority suppressed chip.
  //
  // Scope of the bypass — deliberately narrow:
  //   - Does NOT bypass tool availability (chipActionToTool must map to an
  //     available tool, OR be virtual).
  //   - Does NOT bypass readiness gate (run_analysis already filtered above
  //     via canRunAnalysis).
  //   - Does NOT bypass recent-action filter (recent executions still
  //     exclude the chip from sessionSuppressed — see Step 3).
  //
  // When no graph exists OR no suppressed chip survives availability, return
  // zero chips — that's the correct behaviour (no actionable next step).
  if (
    available.length === 0
    && turnContext.graph != null
    && sessionSuppressed.length > 0
  ) {
    const toolSetFloor = new Set(availableTools);
    const floorCandidate = sessionSuppressed
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .find((c) => {
        // Belt-and-braces: never force an action that was recently executed,
        // even if somehow it entered sessionSuppressed (e.g. ordering edge cases).
        if (recentActions.has(c.action_type)) return false;
        const tool = chipActionToTool(c.action_type);
        return !tool || toolSetFloor.has(tool);
      });
    if (floorCandidate) {
      available.push(floorCandidate);
      log.info(
        {
          event: 'v4.chip_floor_activated',
          forced_chip_id: floorCandidate.chip_id,
          forced_action_type: floorCandidate.action_type,
          bypass_reason: 'session_window_exhaustion',
        },
        'Chip floor activated — session window exhausted all candidates, promoting highest-priority suppressed chip',
      );
    }
  }

  // Step 7: cap at 3.
  const capped = available.slice(0, 3);

  // Step 8: sanitise + flatten to SuggestedAction.
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
    filtered_by_availability: filtered.length - available.length,
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
 * Map a GuidanceItem to a TypedChip candidate. Guidance items come from
 * generatePostDraftGuidance / generatePostAnalysisGuidance and encode
 * structural + analysis-derived next steps. Mapping is signal-driven so the
 * chip_id (= guidance.item_id) is already deterministic, grounded, and
 * naturally varies with graph state — exactly what the session window needs
 * to avoid exhausting the candidate pool.
 *
 * Returns null when a signal doesn't have a clean chip framing (e.g.
 * STRUCTURAL_VALIDATION_ERROR, ProposalCard variants handled elsewhere, or
 * technique signals that need their own surfacing).
 */
function chipFromGuidance(g: GuidanceItem): TypedChip | null {
  const targetId = g.target_object?.id;
  const targetLabel = g.target_object?.label ?? targetId ?? 'this factor';
  const baseId = g.item_id;
  const basePriority = 10;

  switch (g.signal_code) {
    case SIGNAL_CODES.DEFAULT_NODE_CONFIDENCE:
    case SIGNAL_CODES.MISSING_OBSERVED_VALUE:
    case SIGNAL_CODES.MISSING_BASE_RATE:
    case SIGNAL_CODES.HIGH_INFLUENCE_LOW_CONFIDENCE:
    case SIGNAL_CODES.DOMINANT_FACTOR:
      return {
        chip_id: baseId,
        type: 'calibrate',
        action_type: 'set_factor_value',
        role: 'facilitator',
        label: truncateLabel(`Calibrate ${targetLabel}`),
        message: `Help me calibrate ${targetLabel}. What value would you expect?`,
        priority: basePriority,
      };
    case SIGNAL_CODES.DEFAULT_EDGE_STRENGTH:
      return {
        chip_id: baseId,
        type: 'calibrate',
        action_type: 'adjust_edge_strength',
        role: 'facilitator',
        label: truncateLabel(`Tune ${targetLabel}`),
        message: `Walk me through calibrating ${targetLabel}'s influence.`,
        priority: basePriority,
      };
    case SIGNAL_CODES.LOW_OPTION_COUNT:
      return {
        chip_id: baseId,
        type: 'restructure',
        action_type: 'add_option',
        role: 'challenger',
        label: 'Add another option',
        message: 'What alternative option should I consider adding?',
        priority: basePriority,
      };
    case SIGNAL_CODES.MISSING_FRAMING_ELEMENT:
      return {
        chip_id: baseId,
        type: 'challenge',
        action_type: 'challenge_assumption',
        role: 'challenger',
        label: 'Check the framing',
        message: g.title ?? 'Walk me through the framing gaps in this model.',
        priority: basePriority,
      };
    case SIGNAL_CODES.FRAGILE_RESULT:
    case SIGNAL_CODES.CONSTRAINT_VIOLATION:
      return {
        chip_id: baseId,
        type: 'challenge',
        action_type: 'what_would_flip',
        role: 'challenger',
        label: 'What would flip this?',
        message: 'Show me what would flip this result.',
        priority: basePriority,
      };
    case SIGNAL_CODES.STRUCTURAL_CYCLE:
      return {
        chip_id: baseId,
        type: 'challenge',
        action_type: 'challenge_assumption',
        role: 'challenger',
        label: 'Explain this cycle',
        message: g.title ?? 'Walk me through the cycle in this model.',
        priority: basePriority,
      };
    default:
      return null;
  }
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
