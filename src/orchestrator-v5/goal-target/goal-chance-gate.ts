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
import { GOAL_CHANCE_COMPANION_KEYS, GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_PROBABILITY_UNUSABLE, GOAL_FIGURES_TARGET_NOT_TESTABLE, readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { CONDITIONS_NOT_KEPT, goalTargetBasisOf } from './goal-target-basis.js';
import { statedGoalTargetOf } from './stated-goal-target.js';
import { resolveGoalDirection } from './goal-direction.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Why a goal chance was not shown. The first three are run-wide (the target); the last two are the figure's own. */
export type GoalChanceUnusable =
  | 'no_stated_target' | 'no_stated_direction' | 'no_target_unit' | 'ceiling_not_minimised' | 'floor_minimised'
  | 'not_finite' | 'outside_unit_interval';

/** The run-wide cause, read off the goal the Run scored: null when the goal states a target, direction and unit. */
export function goalChanceTargetCause(graph: unknown, goalId: unknown): GoalChanceUnusable | null {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  // The target the Run scored: the goal's stated one, else the normalised threshold CEE itself holds on the goal (written
  // only from the user's target; its raw figure may be absent on older graphs). NO threshold on the goal at all is a
  // target the user never set — e.g. PLoT's synthesised `auto_goal_threshold` — and no chance of meeting it is shown.
  const stated = goal === undefined ? null : statedGoalTargetOf(graph as Rec, goal);
  const heldThreshold = goal !== undefined && typeof goal.goal_threshold === 'number' && Number.isFinite(goal.goal_threshold);
  const target = stated ?? (heldThreshold ? {
    ...(typeof goal!.goal_threshold_unit === 'string' ? { unit: goal!.goal_threshold_unit } : {}),
    ...(typeof goal!.goal_direction === 'string' ? { held: goal!.goal_direction } : {}),
    ...(typeof goal!.goal_threshold_frame === 'string' ? { frame: goal!.goal_threshold_frame } : {}),
  } : null);
  if (target === null) return 'no_stated_target';
  if (typeof target.unit !== 'string' || target.unit.trim() === '') return 'no_target_unit';
  // ⭐ D3 STEP 2 (DL 0df0e1, accepted 6 Oct; c6 words): a target figure with no comparator held or stated (22% of targeted
  // goals, DL measured) is no chance of meeting anything the user said — ISL scored its unattested maximiser. Withheld,
  // typed, and it carries the one-click "at least / at most {target}?" invitation (`invite`, below) that resolves it.
  // A target stated as a CHANGE carries its direction in its sign ("cut by 20%": change_rel −0.2) — stated, not missing.
  const isChange = target.frame === 'change_rel' || target.frame === 'change_abs' || target.frame === 'delta';
  if (target.held === undefined && !isChange) return 'no_stated_direction';
  // A ceiling is a chance of staying AT OR BELOW it only where the run minimised; otherwise ISL scored P(goal ≥ X).
  if ((target.held === '<=' || target.held === '<') && resolveGoalDirection(graph, goalId)?.direction !== 'minimise') return 'ceiling_not_minimised';
  // The mirror (Review Desk 6b, #2618): a held FLOOR on a goal the run MINIMISED (a "reduce" label outranks a held floor in
  // `resolveGoalDirection`) was scored as P(goal ≤ X) — not a chance of meeting "at least X". EXCEPT a NEGATIVE typed change:
  // "at least a 20% cut" is held `>=` on −20% and points DOWN (`heldGoalPointsUp`, AIQ #75 5901136155), so minimising IS its
  // sense (Codex buddy r1, #2628).
  const frame = 'frame' in target ? target.frame : undefined;
  const value = 'value' in target ? target.value : undefined;
  const floorPointsDown = (frame === 'change_rel' || frame === 'change_abs' || frame === 'delta') && typeof value === 'number' && value < 0;
  if ((target.held === '>=' || target.held === '>') && !floorPointsDown && resolveGoalDirection(graph, goalId)?.direction === 'minimise') return 'floor_minimised';
  return null;
}

/**
 * The invitation a `no_stated_direction` withhold carries (DL 0df0e1; c6): the goal and its target AS STATED, so the UI can
 * offer "At least {target}" / "At most {target}" — each writes the direction through the existing goal-target door; the
 * user re-runs. Empty when the raw figure or its unit cannot be said (the withhold still stands, typed).
 */
function directionInvite(graph: unknown, goalId: unknown): Rec {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  const stated = goal === undefined ? null : statedGoalTargetOf(graph as Rec, goal);
  if (stated === null || typeof stated.unit !== 'string' || stated.unit.trim() === '' || typeof goalId !== 'string') return {};
  return { invite: { kind: 'state_goal_direction', goal_node_id: goalId, target: { value: stated.value, unit: stated.unit } } };
}

/** The figure's own cause: null for a finite number in [0, 1]. */
export function goalChanceValueCause(p: unknown): GoalChanceUnusable | null {
  if (typeof p !== 'number' || !Number.isFinite(p)) return 'not_finite';
  return p < 0 || p > 1 ? 'outside_unit_interval' : null;
}

/**
 * The brief's `goal_fit` ALONE unusable, every option's chance kept: its own code, deliberately NOT in
 * `GOAL_FIGURES_WITHHELD_CODES` (Codex buddy r2 F1, #2618) — no per-option figure was withheld, so no reader may treat
 * the run's option records as withheld.
 */
export const GOAL_FIT_UNUSABLE = 'GOAL_FIT_UNUSABLE';

/**
 * NO STATED TARGET: no chance is a chance of meeting one (PLoT scored a target the user never set, e.g. its synthesised
 * `auto_goal_threshold`). ONLY `probability_of_goal` and `goal_fit` go — every other figure (shares, outcome, downside)
 * stays exactly as today — typed `info` with its own code, NOT in `GOAL_FIGURES_WITHHELD_CODES`: there is no target to
 * have tested, so no reader may say the run "could not test" one. The words for a goal with no target are step 4's
 * question (c6). Most served Runs have no target (red team #87 6005077996: 22 of 26), so this leaves their prose untouched.
 */
export const GOAL_FIGURES_NO_STATED_TARGET = 'GOAL_FIGURES_NO_STATED_TARGET';

function stripGoalChancesWithNoTarget(env: Rec, goalId: unknown): Rec {
  const removed: string[] = [];
  const strip = (rows: unknown): unknown => (!Array.isArray(rows) ? rows : rows.map((row) => {
    if (!isRec(row) || !('probability_of_goal' in row)) return row;
    const { probability_of_goal: _gone, ...kept } = row;
    // Its precision and drivers describe the figure that went: they go with it (design-g4g6 Q3).
    for (const k of GOAL_CHANCE_COMPANION_KEYS) delete kept[k];
    const id = typeof row.option_id === 'string' ? row.option_id : typeof row.id === 'string' ? row.id : undefined;
    if (id !== undefined && !removed.includes(id)) removed.push(id);
    return kept;
  }));
  const out: Rec = { ...env };
  if ('option_comparison' in env) out.option_comparison = strip(env.option_comparison);
  if (Array.isArray(env.results)) out.results = strip(env.results);
  else if (isRec(env.results)) {
    const nested: Rec = { ...env.results };
    for (const k of ['option_comparison', 'options', 'option_results'] as const) if (k in nested) nested[k] = strip(nested[k]);
    out.results = nested;
  }
  let fitRemoved = false;
  if (isRec(env.decision_brief)) {
    const brief: Rec = { ...env.decision_brief };
    if ('options' in brief) brief.options = strip(brief.options);
    if (isRec(brief.analysis_summary) && 'goal_fit' in brief.analysis_summary) {
      const { goal_fit: _fit, ...kept } = brief.analysis_summary;
      brief.analysis_summary = kept;
      fitRemoved = true;
    }
    out.decision_brief = brief;
  }
  if (removed.length === 0 && !fitRemoved) return env;
  const warnings = Array.isArray(env.inference_warnings) ? env.inference_warnings : [];
  out.inference_warnings = [...warnings, {
    code: GOAL_FIGURES_NO_STATED_TARGET, severity: 'info',
    message: 'The goal has no stated target, so no option has a chance of meeting one to show.',
    option_ids: removed, cause: 'no_stated_target' satisfies GoalChanceUnusable, ...(fitRemoved ? { goal_fit_removed: true } : {}),
    // ⭐ D3 STEP 2 (DL 0df0e1; c6): the invitation that resolves it — "Give ‘{goal}’ a target …" through the existing target door.
    ...(typeof goalId === 'string' ? { invite: { kind: 'state_goal_target', goal_node_id: goalId } } : {}),
  }];
  return out;
}

const MESSAGE = 'Not shown. The chance of meeting your goal could not be read as a probability of meeting a stated target, so it is held back.';

/**
 * Withholds every option's unusable goal chance (typed per option on the warning), and the brief's `goal_fit` when it is
 * unusable or the target is. Returns `envelope` itself when nothing is unusable. Pure.
 */
export function withholdUnusableGoalChances<E>(envelope: E, graph: unknown, goalId: unknown): E {
  if (!isRec(envelope)) return envelope;
  const targetCause = goalChanceTargetCause(graph, goalId);
  if (targetCause === 'no_stated_target') return stripGoalChancesWithNoTarget(envelope, goalId) as E;
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
    ...(targetCause === 'no_stated_direction' ? directionInvite(graph, goalId) : {}),
  }, { keepOutcome: true, keepOrdering: true }) as Rec;
  // `goal_fit` is the leader's own goal chance: withheld with its cause, never left beside a withheld one.
  const outBrief = isRec(out.decision_brief) ? out.decision_brief : undefined;
  const outSummary = outBrief !== undefined && isRec(outBrief.analysis_summary) ? outBrief.analysis_summary : undefined;
  if (fitCause !== null && outSummary !== undefined && 'goal_fit' in outSummary) {
    const { goal_fit: _dropped, ...kept } = outSummary;
    out = { ...out, decision_brief: { ...outBrief, analysis_summary: kept } };
    const warnings = Array.isArray(out.inference_warnings) ? out.inference_warnings : [];
    out = { ...out, inference_warnings: [...warnings, { code: GOAL_FIT_UNUSABLE, message: MESSAGE, severity: 'warning', goal_fit_cause: fitCause }] };
  }
  return out as E;
}

/**
 * ⭐ RECOVERY BATCH C, amendment 3: a target that can be read more than one way ("+10%": 10% more than today's capacity, or
 * 10 more percentage points?) is never resolved by picking. While the goal's stated basis carries that question, every
 * option's claims AGAINST the target are withheld (the ordering stays, as for any untestable target), and the question is
 * the reason the user reads. Returns `envelope` itself when there is no open question. Pure.
 */
export function withholdForOpenTargetQuestion<E>(envelope: E, graph: unknown, goalId: unknown,
  /**
   * ⭐ S9 (marketing widen5 bcdf70eb, judge items 2/5): the goal's OWN stated target row(s). The question is about THIS goal's
   * target, so the warning binds to them; unbound, the several-targets licence put "Does ‘conversion rate’ mean…" on the
   * customer target's line. None given: unbound, as before.
   */
  ownTargetRowsOf: (goalId: unknown) => readonly string[] = () => []): E {
  if (!isRec(envelope)) return envelope;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  const question = goal === undefined ? undefined : goalTargetBasisOf(goal)?.open_question;
  if (question === undefined) return envelope;
  const scored = [...new Set(readOptionResultSources(envelope).flat().flatMap((r) => {
    const id = typeof r.option_id === 'string' ? r.option_id : typeof r.id === 'string' ? r.id : undefined;
    return id === undefined ? [] : [id];
  }))];
  if (scored.length === 0) return envelope;
  // ⛔ RE-SCOPE 2 (R5-5 (a); DL ruling): the reading refused because its conditions cannot all be kept is said as exactly that —
  // never as a target that "can be read more than one way", never as a question to answer. Identified by its one constant.
  // `detail.reason` is CEE-local (not in @talchain/schemas 0.83; the UI renders `message`, goalIdentityWithheld.ts).
  const conditions = question === CONDITIONS_NOT_KEPT;
  const message = conditions ? `Not shown. ${CONDITIONS_NOT_KEPT}` : `Not shown. Your target can be read more than one way. ${question}`;
  const out = withholdOptionGoalFigures(envelope, new Set(scored), {
    code: GOAL_FIGURES_TARGET_NOT_TESTABLE, severity: 'warning', message, say: question,
    node_ids: [String(goalId)], option_ids: scored, detail: { reason: conditions ? 'conditions_not_kept' : 'target_reading_open' },
    ...((rows) => (rows.length > 0 ? { constraint_ids: [...rows] } : {}))(ownTargetRowsOf(goalId)),
  }, { keepOutcome: true, keepOrdering: true });
  // ⛔ R5-5 (DL ruling): the conditions reason WINS. Sizing a link (the placeholder path's ask for today's level) cannot bring
  // this chance back while the reading is refused, so that ask is not offered as the reason here; the links stay unsized in
  // the model and their own readers are unchanged. (The UI and the canonical view already prefer this code over that one.)
  if (!conditions || !isRec(out) || !Array.isArray(out.inference_warnings)) return out;
  return { ...out, inference_warnings: out.inference_warnings.filter((w) => !(isRec(w) && w.code === GOAL_FIGURES_PLACEHOLDER_PATH)) } as E;
}
