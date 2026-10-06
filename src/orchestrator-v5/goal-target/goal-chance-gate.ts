/**
 * ⭐ D3 STEP 1 — THE GOAL CHANCE IS A PROBABILITY OF MEETING A STATED TARGET, OR IT IS NOT SHOWN (DL 0df0e1, PL rec 5;
 * #87 6006078553). At the CEE seam, each option's `probability_of_goal` (and the brief's `goal_fit`, the leader's own
 * P(goal)) reaches a reader only when it is a finite number in [0, 1] AND the goal states a target, its direction and its
 * unit, and a ceiling was scored minimised. Otherwise it is WITHHELD with its typed cause, through the ONE goal-figure seam
 * (`withholdOptionGoalFigures`, the target claims only: the ordering and the outcome stay), and never substituted: no
 * reader may put the win share where the goal chance was.
 *
 * Before this, a figure outside [0, 1] or with no target behind it rode the turn and the reload untyped
 * (`enrichment.option_comparison`, a `z.record`), and `goal_fit` escaped every gate a per-option withhold applies.
 *
 * Runs LAST among the goal-figure withholds in `run_analysis`: every earlier withhold keeps its own reason, and a figure
 * one of them removed is not here to gate.
 */
import { withholdOptionGoalFigures } from '../../orchestrator/context/constraint-feasibility.js';
import { GOAL_FIGURES_PROBABILITY_UNUSABLE, readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { statedGoalTargetOf } from './stated-goal-target.js';
import { resolveGoalDirection } from './goal-direction.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Why a goal chance was not shown. The first three are run-wide (the target); the last two are the figure's own. */
export type GoalChanceUnusable =
  | 'no_stated_target' | 'no_stated_direction' | 'no_target_unit' | 'ceiling_not_minimised'
  | 'not_finite' | 'outside_unit_interval';

/** The run-wide cause, read off the goal the Run scored: null when the goal states a target, direction and unit. */
export function goalChanceTargetCause(graph: unknown, goalId: unknown): GoalChanceUnusable | null {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  const target = goal === undefined ? null : statedGoalTargetOf(graph as Rec, goal);
  if (target === null) return 'no_stated_target';
  if (target.held === undefined) return 'no_stated_direction';
  if (typeof target.unit !== 'string' || target.unit.trim() === '') return 'no_target_unit';
  // A ceiling is a chance of staying AT OR BELOW it only where the run minimised; otherwise ISL scored P(goal ≥ X).
  if ((target.held === '<=' || target.held === '<') && resolveGoalDirection(graph, goalId)?.direction !== 'minimise') return 'ceiling_not_minimised';
  return null;
}

/** The figure's own cause: null for a finite number in [0, 1]. */
export function goalChanceValueCause(p: unknown): GoalChanceUnusable | null {
  if (typeof p !== 'number' || !Number.isFinite(p)) return 'not_finite';
  return p < 0 || p > 1 ? 'outside_unit_interval' : null;
}

const MESSAGE = 'Not shown. The chance of meeting your goal could not be read as a probability of meeting a stated target, so it is held back.';

/**
 * Withholds every option's unusable goal chance (typed per option on the warning), and the brief's `goal_fit` when it is
 * unusable or the target is. Returns `envelope` itself when nothing is unusable. Pure.
 */
export function withholdUnusableGoalChances<E>(envelope: E, graph: unknown, goalId: unknown): E {
  if (!isRec(envelope)) return envelope;
  const targetCause = goalChanceTargetCause(graph, goalId);
  const causes = new Map<string, GoalChanceUnusable>();
  for (const record of readOptionResultSources(envelope).flat()) {
    if (!isRec(record) || !('probability_of_goal' in record) || record.probability_of_goal === undefined) continue;
    const id = typeof record.option_id === 'string' ? record.option_id : typeof record.id === 'string' ? record.id : undefined;
    if (id === undefined || causes.has(id)) continue;
    const cause = targetCause ?? goalChanceValueCause(record.probability_of_goal);
    if (cause !== null) causes.set(id, cause);
  }
  const brief = isRec(envelope.decision_brief) ? envelope.decision_brief : undefined;
  const summary = brief !== undefined && isRec(brief.analysis_summary) ? brief.analysis_summary : undefined;
  const fitCause = summary === undefined || !('goal_fit' in summary) || summary.goal_fit === undefined || summary.goal_fit === null ? null
    : targetCause ?? goalChanceValueCause(summary.goal_fit);
  if (causes.size === 0 && fitCause === null) return envelope;

  let out: Rec = causes.size === 0 ? envelope : withholdOptionGoalFigures(envelope, new Set(causes.keys()), {
    code: GOAL_FIGURES_PROBABILITY_UNUSABLE,
    message: MESSAGE,
    severity: 'warning',
    option_ids: [...causes.keys()],
    causes: [...causes].map(([option_id, cause]) => ({ option_id, cause })),
  }, { keepOutcome: true, keepOrdering: true }) as Rec;
  // `goal_fit` is the leader's own goal chance: withheld with its cause, never left beside a withheld one.
  const outBrief = isRec(out.decision_brief) ? out.decision_brief : undefined;
  const outSummary = outBrief !== undefined && isRec(outBrief.analysis_summary) ? outBrief.analysis_summary : undefined;
  if (fitCause !== null && outSummary !== undefined && 'goal_fit' in outSummary) {
    const { goal_fit: _dropped, ...kept } = outSummary;
    out = { ...out, decision_brief: { ...outBrief, analysis_summary: kept } };
    const warnings = Array.isArray(out.inference_warnings) ? out.inference_warnings : [];
    out = { ...out, inference_warnings: [...warnings, { code: GOAL_FIGURES_PROBABILITY_UNUSABLE, message: MESSAGE, severity: 'warning', goal_fit_cause: fitCause }] };
  }
  return out as E;
}
