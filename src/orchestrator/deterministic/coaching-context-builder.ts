/**
 * Coaching Policy Engine (WS1)
 *
 * Consumes TurnContext + SessionState + graph entities.
 * Returns a typed CoachingContext that drives the dynamic block,
 * response composer, chip engine, and post-flight validator.
 *
 * Feature flag: CEE_COACHING_CONTEXT_ENABLED
 */

import type {
  DeterministicTurnContext,
  AnalysisSummary,
} from "./types.js";
import type { SessionState } from "./session-state.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

export type CoachingMode = 'orient' | 'challenge' | 'calibrate' | 'decide' | 'recover';

export type PrimaryMove =
  | 'name_tradeoff'
  | 'surface_assumption'
  | 'request_calibration'
  | 'challenge_preference'
  | 'present_findings'
  | 'suggest_rerun'
  | 'guide_intake'
  | 'acknowledge_edit';

export type ResponsePosture = 'exploratory' | 'evidential' | 'convergent';
export type StabilityBand = 'fragile' | 'moderate' | 'stable' | 'highly_stable';

export interface Headline {
  leading_option: string;
  leading_probability: number;
  runner_up: string;
  runner_up_probability: number;
  win_gap: number;
  stability_band: StabilityBand;
  stability_pct: number;
}

export interface Tradeoff {
  option_a: string;
  benefit_a: string;
  option_b: string;
  benefit_b: string;
}

export interface BiggestInference {
  factor_label: string;
  factor_id: string;
  source: 'ai_estimated' | 'default_value' | 'inferred_edge';
  reason: string;
}

export interface CalibrationTarget {
  source_label: string;
  target_label: string;
  factor_id: string;
}

export interface DriverContext {
  factor_label: string;
  factor_id: string;
  sensitivity: number;
  is_ai_estimated: boolean;
  confidence_band: 'low' | 'medium' | 'high';
}

export interface TopFragile {
  source_label: string;
  target_label: string;
  flip_probability: number;
}

export type PlayName =
  | 'pre_mortem'
  | 'inversion'
  | 'dominant_factor'
  | 'evidence_priority'
  | 'conditional_winner'
  | 'robustness'
  | 'inference_warning'
  | 'complexity_check';

export type RecommendedAngle =
  | 'ask_for_calibration'
  | 'stress_test_assumption'
  | 'gather_evidence'
  | 'define_constraint'
  | 'run_premortem'
  | 'consider_alternatives';

export interface TriggeredPlay {
  play: PlayName;
  trigger_reason: string;
  factor_label: string | null;
  recommended_angle: RecommendedAngle;
}

export interface CTA {
  guidance: string;
  readiness: 'not_ready' | 'ready_with_caveats' | 'ready';
}

export interface ChipInputs {
  stage: string;
  has_analysis: boolean;
  analysis_fresh: boolean;
  top_uncalibrated_factor: string | null;
  has_risk_factors: boolean;
  option_mechanism_overlap: boolean;
  stability_band: string | null;
  dominant_factor_label: string | null;
}

export interface CoachingContext {
  coaching_mode: CoachingMode;
  primary_move: PrimaryMove;
  ask_question_now: boolean;
  challenge_now: boolean;
  response_posture: ResponsePosture;

  headline: Headline | null;

  tradeoff: Tradeoff | null;
  biggest_inference: BiggestInference | null;
  calibration_target: CalibrationTarget | null;

  ai_estimated_count: number;
  user_provided_count: number;
  total_factor_count: number;

  drivers: DriverContext[];
  top_fragile: TopFragile | null;
  triggered_plays: TriggeredPlay[];
  cta: CTA | null;

  risk_factor_count: number;
  option_mechanism_overlap: boolean;
  critical_gap: { type: 'missing_factor' | 'narrow_options' | 'uncalibrated_driver' | 'no_cost_factor'; detail: string } | null;

  prediction_state: 'none' | 'predicted' | 'match' | 'mismatch';

  chip_inputs: ChipInputs;
}

// ============================================================================
// Entry Point
// ============================================================================

/**
 * Build the coaching context from TurnContext + SessionState.
 * Pure, synchronous function — no side effects beyond telemetry.
 */
export function buildCoachingContext(
  ctx: DeterministicTurnContext,
  session: SessionState,
): CoachingContext {
  const analysis = ctx.analysis_summary;
  const hasGraph = ctx.graph_summary.node_count > 0;
  const hasAnalysis = analysis != null;

  // Provenance counts
  const { ai_estimated_count, user_provided_count, total_factor_count, risk_factor_count } =
    computeProvenance(ctx);

  // Coaching mode
  const coaching_mode = computeCoachingMode(ctx, session, hasGraph, hasAnalysis);

  // Headline
  const headline = computeHeadline(analysis);

  // Drivers (max 3)
  const drivers = computeDrivers(ctx, analysis);

  // Biggest inference
  const biggest_inference = computeBiggestInference(ctx, drivers, hasAnalysis);

  // Calibration target
  const calibration_target = computeCalibrationTarget(ctx, drivers, session);

  // Tradeoff (with explicit precedence chain)
  const tradeoff = computeTradeoff(ctx);

  // Primary move
  const primary_move = computePrimaryMove(ctx, coaching_mode, session, hasAnalysis, ai_estimated_count, calibration_target);

  // Ask/challenge gates
  const ask_question_now = coaching_mode !== 'decide' &&
    session.last_question_turn < (ctx.conversation.turn_count - 1);
  const challenge_now = ctx.signals.close_call ||
    (session.accepted_patches >= 3 && session.preferred_option != null) ||
    risk_factor_count === 0;

  // Response posture
  const response_posture = computePosture(coaching_mode);

  // Top fragile edge
  const top_fragile = computeTopFragile(analysis);

  // Triggered plays
  const triggered_plays = evaluateAllPlays(ctx, analysis, session);

  // Option mechanism overlap
  const option_mechanism_overlap = detectOptionMechanismOverlap(ctx);

  // Critical gap
  const critical_gap = detectCriticalGap(ctx, analysis, risk_factor_count, calibration_target);

  // Prediction state
  const prediction_state = computePredictionState(session, analysis);

  // CTA
  const cta = computeCTA(primary_move, calibration_target, drivers, coaching_mode);

  // Chip inputs
  const dominantLabel = ctx.signals.dominant_factor
    ? (ctx.entities.nodes.get(ctx.signals.dominant_factor)?.label ?? null)
    : null;
  const chip_inputs: ChipInputs = {
    stage: ctx.stage,
    has_analysis: hasAnalysis,
    analysis_fresh: hasAnalysis, // analysis_summary only exists when fresh (staleness contract)
    top_uncalibrated_factor: calibration_target?.factor_id ?? null,
    has_risk_factors: risk_factor_count > 0,
    option_mechanism_overlap,
    stability_band: headline?.stability_band ?? null,
    dominant_factor_label: dominantLabel,
  };

  const result: CoachingContext = {
    coaching_mode,
    primary_move,
    ask_question_now,
    challenge_now,
    response_posture,
    headline,
    tradeoff,
    biggest_inference,
    calibration_target,
    ai_estimated_count,
    user_provided_count,
    total_factor_count,
    drivers,
    top_fragile,
    triggered_plays,
    cta,
    risk_factor_count,
    option_mechanism_overlap,
    critical_gap,
    prediction_state,
    chip_inputs,
  };

  log.debug({
    event: 'v4.coaching_context',
    coaching_mode,
    primary_move,
    triggered_plays_count: triggered_plays.length,
    ai_estimated_count,
    total_factor_count,
    convergence: session.convergence_signal,
  }, 'Coaching context built');

  return result;
}

// ============================================================================
// Field Computations
// ============================================================================

function computeProvenance(ctx: DeterministicTurnContext): {
  ai_estimated_count: number;
  user_provided_count: number;
  total_factor_count: number;
  risk_factor_count: number;
} {
  let aiEstimated = 0;
  let userProvided = 0;
  let total = 0;
  let riskCount = 0;

  if (ctx.graph) {
    for (const node of (ctx.graph as Record<string, unknown>).nodes as Array<Record<string, unknown>> ?? []) {
      // Count risk nodes separately — kind === 'risk' is a standalone kind
      if (node.kind === 'risk') {
        riskCount++;
        continue;
      }
      if (node.kind !== 'factor') continue;
      total++;
      const observed = node.observed_state as Record<string, unknown> | undefined;
      const extractionType = observed?.extractionType as string | undefined;
      if (extractionType === 'inferred') {
        aiEstimated++;
      } else {
        userProvided++;
      }
    }
  } else {
    // Fallback: use signals + entity registry for approximate counts
    aiEstimated = ctx.signals.default_value_count;
    for (const [, entry] of ctx.entities.nodes) {
      if (entry.kind === 'risk') riskCount++;
      else if (entry.kind === 'factor') total++;
    }
    userProvided = total - aiEstimated;
  }

  return { ai_estimated_count: aiEstimated, user_provided_count: userProvided, total_factor_count: total, risk_factor_count: riskCount };
}

function computeCoachingMode(
  ctx: DeterministicTurnContext,
  session: SessionState,
  hasGraph: boolean,
  hasAnalysis: boolean,
): CoachingMode {
  // FRAME with no graph → orient
  if (ctx.stage === 'frame' && !hasGraph) return 'orient';

  // EVALUATE with fragile result → challenge
  if (ctx.stage === 'evaluate' && hasAnalysis) {
    const robustness = ctx.analysis_summary?.robustness_band;
    if (robustness === 'fragile') return 'challenge';
    if (robustness === 'stable' || robustness === 'highly_stable') return 'decide';
  }

  // IDEATE with high AI-estimated count → calibrate
  if (ctx.stage === 'ideate' && ctx.signals.default_value_count > 0) return 'calibrate';

  // IDEATE with zero risk factors → challenge
  if (ctx.stage === 'ideate') return 'challenge';

  // DECIDE stage → decide
  if (ctx.stage === 'decide') return 'decide';

  // Default by stage
  if (hasAnalysis) return 'decide';
  if (hasGraph) return 'calibrate';
  return 'orient';
}

function computeHeadline(analysis: AnalysisSummary | null): Headline | null {
  if (!analysis?.winner || analysis.winner_probability == null) return null;

  const runnerUpProb = analysis.runner_up_probability ?? 0;
  const winGap = (analysis.winner_probability - runnerUpProb) * 100;

  const robustness = analysis.robustness_band ?? 'moderate';
  let stabilityBand: StabilityBand;
  let stabilityPct: number;
  switch (robustness) {
    case 'fragile': stabilityBand = 'fragile'; stabilityPct = 25; break;
    case 'moderate': stabilityBand = 'moderate'; stabilityPct = 55; break;
    case 'stable': stabilityBand = 'stable'; stabilityPct = 75; break;
    case 'highly_stable': stabilityBand = 'highly_stable'; stabilityPct = 90; break;
    default: stabilityBand = 'moderate'; stabilityPct = 50;
  }

  return {
    leading_option: analysis.winner,
    leading_probability: Math.round(analysis.winner_probability * 100),
    runner_up: analysis.runner_up ?? 'Other',
    runner_up_probability: Math.round(runnerUpProb * 100),
    win_gap: Math.round(winGap),
    stability_band: stabilityBand,
    stability_pct: stabilityPct,
  };
}

function computeDrivers(
  ctx: DeterministicTurnContext,
  analysis: AnalysisSummary | null,
): DriverContext[] {
  if (!analysis) return [];

  // Prefer factor_sensitivity (richer data) over top_drivers
  const source: Array<{ label: string; factor_id: string; sensitivity: number; confidence_band: string | null }> =
    analysis.factor_sensitivity.length > 0
      ? analysis.factor_sensitivity.slice(0, 3).map(f => ({
          label: f.label,
          factor_id: '', // factor_sensitivity doesn't carry factor_id directly
          sensitivity: f.influence_percent != null ? f.influence_percent / 100 : 0,
          confidence_band: f.confidence_band,
        }))
      : analysis.top_drivers.slice(0, 3).map(d => ({
          label: d.label,
          factor_id: d.factor_id,
          sensitivity: d.sensitivity,
          confidence_band: null,
        }));

  // Resolve factor_id from entity registry when missing
  return source.map(s => {
    let factorId = s.factor_id;
    if (!factorId) {
      // Lookup by label
      for (const [id, entry] of ctx.entities.nodes) {
        if (entry.label === s.label && entry.kind === 'factor') {
          factorId = id;
          break;
        }
      }
    }

    const isAiEstimated = ctx.signals.high_uncertainty_factors.includes(factorId);
    const confidenceBand: 'low' | 'medium' | 'high' =
      s.confidence_band === 'low' ? 'low'
        : s.confidence_band === 'high' ? 'high'
        : 'medium';

    return {
      factor_label: s.label,
      factor_id: factorId,
      sensitivity: s.sensitivity,
      is_ai_estimated: isAiEstimated,
      confidence_band: confidenceBand,
    };
  });
}

function computeBiggestInference(
  ctx: DeterministicTurnContext,
  drivers: DriverContext[],
  hasAnalysis: boolean,
): BiggestInference | null {
  // Only relevant when there are AI-estimated factors
  if (ctx.signals.default_value_count === 0) return null;

  if (hasAnalysis && drivers.length > 0) {
    // Post-analysis: pick the AI-estimated factor with highest sensitivity
    const aiDriver = drivers.find(d => d.is_ai_estimated);
    if (aiDriver) {
      return {
        factor_label: aiDriver.factor_label,
        factor_id: aiDriver.factor_id,
        source: 'ai_estimated',
        reason: 'highest sensitivity among AI-estimated factors',
      };
    }
  }

  // Pre-analysis: pick the AI-estimated factor with highest edge count
  const uncertainFactorIds = ctx.signals.high_uncertainty_factors;
  if (uncertainFactorIds.length === 0) return null;

  let bestId = uncertainFactorIds[0];
  let bestEdgeCount = 0;
  for (const factorId of uncertainFactorIds) {
    const edgeCount = ctx.entities.edges.filter(
      e => e.from === factorId || e.to === factorId,
    ).length;
    if (edgeCount > bestEdgeCount) {
      bestEdgeCount = edgeCount;
      bestId = factorId;
    }
  }

  const entry = ctx.entities.nodes.get(bestId);
  if (!entry) return null;

  return {
    factor_label: entry.label,
    factor_id: bestId,
    source: 'ai_estimated',
    reason: bestEdgeCount > 0 ? 'highest edge count among AI-estimated factors' : 'only AI-estimated factor',
  };
}

function computeCalibrationTarget(
  ctx: DeterministicTurnContext,
  drivers: DriverContext[],
  session: SessionState,
): CalibrationTarget | null {
  // Find the highest-sensitivity uncalibrated factor
  const calibrated = new Set(session.calibrations_provided);

  for (const driver of drivers) {
    if (calibrated.has(driver.factor_id)) continue;
    if (!driver.is_ai_estimated) continue;

    // Find an edge involving this factor to construct the question format
    const edge = ctx.entities.edges.find(
      e => e.from === driver.factor_id || e.to === driver.factor_id,
    );
    if (edge) {
      return {
        source_label: edge.from_label,
        target_label: edge.to_label,
        factor_id: driver.factor_id,
      };
    }

    // No edge found — use factor label directly
    return {
      source_label: driver.factor_label,
      target_label: ctx.graph_summary.goal_label ?? 'the outcome',
      factor_id: driver.factor_id,
    };
  }

  // Fallback: high-uncertainty factors not yet calibrated, ordered by edge count
  const uncalibrated = ctx.signals.high_uncertainty_factors
    .filter(id => !calibrated.has(id) && ctx.entities.nodes.has(id))
    .map(id => ({
      id,
      edgeCount: ctx.entities.edges.filter(e => e.from === id || e.to === id).length,
    }))
    .sort((a, b) => b.edgeCount - a.edgeCount);

  if (uncalibrated.length > 0) {
    const best = uncalibrated[0];
    const entry = ctx.entities.nodes.get(best.id)!;
    return {
      source_label: entry.label,
      target_label: ctx.graph_summary.goal_label ?? 'the outcome',
      factor_id: best.id,
    };
  }

  return null;
}

/**
 * Compute tradeoff with explicit precedence:
 * 1. Compare option intervention targets (what factors each option affects differently)
 * 2. Option labels if semantically contrastive
 * 3. Top differing downstream factors by sensitivity
 * 4. null (don't fabricate)
 */
function computeTradeoff(ctx: DeterministicTurnContext): Tradeoff | null {
  const optionIds = ctx.entities.option_ids;
  if (optionIds.length < 2) return null;

  const optA = ctx.entities.nodes.get(optionIds[0]);
  const optB = ctx.entities.nodes.get(optionIds[1]);
  if (!optA || !optB) return null;

  // Precedence 1: Compare intervention targets
  const edgesFromA = ctx.entities.edges.filter(e => e.from === optionIds[0]);
  const edgesFromB = ctx.entities.edges.filter(e => e.from === optionIds[1]);

  if (edgesFromA.length > 0 && edgesFromB.length > 0) {
    const targetsA = new Set(edgesFromA.map(e => e.to));
    const targetsB = new Set(edgesFromB.map(e => e.to));

    // Find factors unique to each option (or strongest for each)
    const uniqueToA = edgesFromA.find(e => !targetsB.has(e.to));
    const uniqueToB = edgesFromB.find(e => !targetsA.has(e.to));

    if (uniqueToA && uniqueToB) {
      return {
        option_a: optA.label,
        benefit_a: uniqueToA.to_label,
        option_b: optB.label,
        benefit_b: uniqueToB.to_label,
      };
    }

    // Shared targets: pick the strongest for each
    const strongestA = edgesFromA.reduce((best, e) =>
      e.strength_mean > best.strength_mean ? e : best, edgesFromA[0]);
    const strongestB = edgesFromB.reduce((best, e) =>
      e.strength_mean > best.strength_mean ? e : best, edgesFromB[0]);

    if (strongestA.to !== strongestB.to) {
      return {
        option_a: optA.label,
        benefit_a: strongestA.to_label,
        option_b: optB.label,
        benefit_b: strongestB.to_label,
      };
    }
  }

  // Precedence 2: Semantically contrastive labels — only if both have >= 3 words
  // We skip this heuristic since we can't reliably detect semantic contrast
  // without NLP. Fall through to precedence 3.

  // Precedence 3: Top differing downstream factors by sensitivity (requires analysis)
  // This would require deeper analysis data than available in TurnContext.
  // Fall through to null.

  // Precedence 4: Don't fabricate
  return null;
}

function computePrimaryMove(
  ctx: DeterministicTurnContext,
  mode: CoachingMode,
  session: SessionState,
  hasAnalysis: boolean,
  aiEstimatedCount: number,
  calibrationTarget: CalibrationTarget | null,
): PrimaryMove {
  // Post-draft (ideate, no analysis yet) → name_tradeoff
  if (ctx.stage === 'ideate' && !hasAnalysis) return 'name_tradeoff';

  // High AI-estimated count → surface_assumption
  if (aiEstimatedCount > 0 && mode === 'calibrate') return 'surface_assumption';

  // Top driver uncalibrated → request_calibration
  if (calibrationTarget && mode !== 'decide') return 'request_calibration';

  // User prediction mismatches result → challenge_preference
  if (session.prediction && hasAnalysis && ctx.analysis_summary?.winner) {
    const predLower = session.prediction.toLowerCase();
    const winnerLower = ctx.analysis_summary.winner.toLowerCase();
    if (!predLower.includes(winnerLower) && !winnerLower.includes(predLower)) {
      return 'challenge_preference';
    }
  }

  // Fresh analysis → present_findings
  if (hasAnalysis) return 'present_findings';

  // FRAME with no graph → guide_intake
  if (ctx.stage === 'frame' && ctx.graph_summary.node_count === 0) return 'guide_intake';

  // Default
  return 'acknowledge_edit';
}

function computePosture(mode: CoachingMode): ResponsePosture {
  switch (mode) {
    case 'orient': return 'exploratory';
    case 'calibrate': return 'exploratory';
    case 'challenge': return 'evidential';
    case 'decide': return 'convergent';
    case 'recover': return 'exploratory';
  }
}

function computeTopFragile(analysis: AnalysisSummary | null): TopFragile | null {
  if (!analysis || analysis.fragile_edges.length === 0) return null;
  const top = analysis.fragile_edges[0];
  // Fragile edge label format: "Source → Target"
  const parts = top.label.split(/\s*[→\u2192]\s*/);
  return {
    source_label: parts[0]?.trim() ?? top.label,
    target_label: parts[1]?.trim() ?? '',
    flip_probability: top.switch_probability,
  };
}

function detectOptionMechanismOverlap(ctx: DeterministicTurnContext): boolean {
  const optionIds = ctx.entities.option_ids;
  if (optionIds.length < 2) return false;

  const targetSets: Set<string>[] = [];
  for (const optId of optionIds) {
    const targets = new Set(
      ctx.entities.edges.filter(e => e.from === optId).map(e => e.to),
    );
    targetSets.push(targets);
  }

  // Check if all options target the same set of factors
  if (targetSets.length < 2) return false;
  const first = targetSets[0];
  return targetSets.every(s =>
    s.size === first.size && [...s].every(t => first.has(t)),
  );
}

function detectCriticalGap(
  ctx: DeterministicTurnContext,
  analysis: AnalysisSummary | null,
  riskFactorCount: number,
  calibrationTarget: CalibrationTarget | null,
): CoachingContext['critical_gap'] {
  // Narrow options (< 2)
  if (ctx.entities.option_ids.length < 2 && ctx.graph_summary.node_count > 0) {
    return { type: 'narrow_options', detail: 'Only one option modelled. Consider alternatives.' };
  }

  // No risk factors
  if (ctx.graph_summary.node_count > 3 && riskFactorCount === 0) {
    return { type: 'missing_factor', detail: 'No risk factors modelled. What could go wrong?' };
  }

  // Uncalibrated driver
  if (calibrationTarget && analysis) {
    return { type: 'uncalibrated_driver', detail: `Top driver ${calibrationTarget.source_label} is uncalibrated.` };
  }

  // No cost factor
  const hasCost = [...ctx.entities.nodes.values()].some(
    n => n.kind === 'factor' && /cost|budget|price|expense/i.test(n.label),
  );
  if (ctx.graph_summary.node_count > 3 && !hasCost) {
    return { type: 'no_cost_factor', detail: 'No cost or budget factor modelled.' };
  }

  return null;
}

function computePredictionState(
  session: SessionState,
  analysis: AnalysisSummary | null,
): 'none' | 'predicted' | 'match' | 'mismatch' {
  if (!session.prediction) return 'none';
  if (!analysis?.winner) return 'predicted';

  const predLower = session.prediction.toLowerCase();
  const winnerLower = analysis.winner.toLowerCase();
  if (predLower.includes(winnerLower) || winnerLower.includes(predLower)) {
    return 'match';
  }
  return 'mismatch';
}

function computeCTA(
  move: PrimaryMove,
  calibrationTarget: CalibrationTarget | null,
  drivers: DriverContext[],
  _mode: CoachingMode,
): CTA | null {
  switch (move) {
    case 'guide_intake':
      return { guidance: 'Tell me more about your decision so I can build a useful model.', readiness: 'not_ready' };
    case 'name_tradeoff':
      return { guidance: 'Which trade-off matters most to you?', readiness: 'not_ready' };
    case 'surface_assumption':
      return { guidance: 'Some factors are estimated. Calibrating them would strengthen the model.', readiness: 'not_ready' };
    case 'request_calibration':
      if (calibrationTarget) {
        return {
          guidance: `How strong is the effect of ${calibrationTarget.source_label} on ${calibrationTarget.target_label} in your experience?`,
          readiness: 'not_ready',
        };
      }
      return { guidance: 'Calibrating key assumptions would strengthen the analysis.', readiness: 'not_ready' };
    case 'present_findings': {
      const topDriver = drivers[0];
      if (topDriver) {
        return {
          guidance: `Your decision depends heavily on ${topDriver.factor_label}. ${topDriver.is_ai_estimated ? 'Gathering evidence here would be high-value.' : 'This is well-grounded.'}`,
          readiness: topDriver.is_ai_estimated ? 'ready_with_caveats' : 'ready',
        };
      }
      return { guidance: 'Results are ready for review.', readiness: 'ready' };
    }
    case 'challenge_preference':
      return { guidance: 'The analysis suggests a different outcome than you expected. Worth exploring why.', readiness: 'ready_with_caveats' };
    case 'suggest_rerun':
      return { guidance: 'The model has changed since the last analysis. Re-running would give you up-to-date results.', readiness: 'not_ready' };
    case 'acknowledge_edit':
      return null;
  }
}

// ============================================================================
// Play Evaluators
// ============================================================================

function evaluateDominantFactorWarning(analysis: AnalysisSummary | null): TriggeredPlay | null {
  if (!analysis) return null;
  const dominant = analysis.top_drivers.find(d => d.sensitivity > 0.5)
    ?? (analysis.factor_sensitivity.length > 0 && analysis.factor_sensitivity[0].influence_percent != null && analysis.factor_sensitivity[0].influence_percent > 50
      ? { label: analysis.factor_sensitivity[0].label, sensitivity: analysis.factor_sensitivity[0].influence_percent / 100 }
      : null);
  if (!dominant) return null;
  return {
    play: 'dominant_factor',
    trigger_reason: `${dominant.label} accounts for ${Math.round(dominant.sensitivity * 100)}% of sensitivity`,
    factor_label: dominant.label,
    recommended_angle: 'ask_for_calibration',
  };
}

function evaluatePreMortem(ctx: DeterministicTurnContext, analysis: AnalysisSummary | null): TriggeredPlay | null {
  // Trigger when analysis exists and result is stable (user might be overconfident)
  if (!analysis) return null;
  if (analysis.robustness_band !== 'stable' && analysis.robustness_band !== 'highly_stable') return null;
  return {
    play: 'pre_mortem',
    trigger_reason: 'Stable result may mask hidden assumptions',
    factor_label: null,
    recommended_angle: 'run_premortem',
  };
}

function evaluateInversion(analysis: AnalysisSummary | null): TriggeredPlay | null {
  if (!analysis?.winner) return null;
  // Trigger when margin is comfortable but conditional winners exist
  if (analysis.conditional_winners.length === 0) return null;
  return {
    play: 'inversion',
    trigger_reason: `${analysis.conditional_winners[0].winner_label} wins under ${analysis.conditional_winners[0].scenario}`,
    factor_label: null,
    recommended_angle: 'stress_test_assumption',
  };
}

function evaluateEvidencePriority(ctx: DeterministicTurnContext, analysis: AnalysisSummary | null): TriggeredPlay | null {
  if (!analysis) return null;
  // Trigger when a top driver is AI-estimated
  const topDriver = analysis.top_drivers[0];
  if (!topDriver) return null;
  const isUncertain = ctx.signals.high_uncertainty_factors.includes(topDriver.factor_id);
  if (!isUncertain) return null;
  return {
    play: 'evidence_priority',
    trigger_reason: `Top driver ${topDriver.label} is AI-estimated`,
    factor_label: topDriver.label,
    recommended_angle: 'gather_evidence',
  };
}

function evaluateConditionalWinner(analysis: AnalysisSummary | null): TriggeredPlay | null {
  if (!analysis || analysis.conditional_winners.length === 0) return null;
  const cw = analysis.conditional_winners[0];
  if (cw.winner_label === analysis.winner) return null; // Same winner — not interesting
  return {
    play: 'conditional_winner',
    trigger_reason: `${cw.winner_label} wins under "${cw.scenario}"`,
    factor_label: null,
    recommended_angle: 'stress_test_assumption',
  };
}

function evaluateRobustness(analysis: AnalysisSummary | null): TriggeredPlay | null {
  if (!analysis) return null;
  if (analysis.robustness_band !== 'fragile') return null;
  return {
    play: 'robustness',
    trigger_reason: `Result is fragile with ${analysis.fragile_edge_count} fragile edges`,
    factor_label: null,
    recommended_angle: 'gather_evidence',
  };
}

function evaluateInferenceWarning(ctx: DeterministicTurnContext): TriggeredPlay | null {
  if (ctx.signals.default_value_count < 3) return null;
  return {
    play: 'inference_warning',
    trigger_reason: `${ctx.signals.default_value_count} factors using default/inferred values`,
    factor_label: null,
    recommended_angle: 'ask_for_calibration',
  };
}

function evaluateComplexityCheck(ctx: DeterministicTurnContext): TriggeredPlay | null {
  if (ctx.graph_summary.node_count <= 12) return null;
  return {
    play: 'complexity_check',
    trigger_reason: `Model has ${ctx.graph_summary.node_count} nodes — consider simplifying`,
    factor_label: null,
    recommended_angle: 'consider_alternatives',
  };
}

function evaluateAllPlays(
  ctx: DeterministicTurnContext,
  analysis: AnalysisSummary | null,
  session: SessionState,
): TriggeredPlay[] {
  const firedSet = new Set(session.plays_fired);
  const candidates: Array<TriggeredPlay | null> = [
    evaluateDominantFactorWarning(analysis),
    evaluatePreMortem(ctx, analysis),
    evaluateInversion(analysis),
    evaluateEvidencePriority(ctx, analysis),
    evaluateConditionalWinner(analysis),
    evaluateRobustness(analysis),
    evaluateInferenceWarning(ctx),
    evaluateComplexityCheck(ctx),
  ];

  return candidates.filter((p): p is TriggeredPlay =>
    p != null && !firedSet.has(p.play),
  );
}
