/**
 * ⭐ PR-S1 (#87 6027634829, rulings 1–2): an unsized path may carry ONE ISL row's two group chances as a range.
 * The figures remain withheld. No manufactured bound, comparison claim, or re-derived deadline. Pure.
 */
import {
  appendInferenceWarning, GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE,
  GOAL_FIGURES_WITHHELD_CODES,
} from '../../orchestrator/context/option-result-source.js';
import { targetTestabilityOf } from '../admission/target-testability.js';
import { goalChanceTargetCause } from './goal-chance-gate.js';
import { GOAL_HORIZON_NOT_TESTED } from '../agent-lane/decision-input-ask.js';
import { licenceUnsizedLink, type PlaceholderGoalPath } from '../agent-lane/goal-certainty.js';
import { byIslRank, groupPct, linkEnds, runEdge, topDriverRow, type GoalChanceDisplayRounding } from './goal-chance-driver.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const chance = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

export const GOAL_CHANCE_RANGE = 'GOAL_CHANCE_RANGE';

export interface GoalChanceRange {
  readonly low_pct: number;
  readonly high_pct: number;
  readonly low_rounding: GoalChanceDisplayRounding;
  readonly high_rounding: GoalChanceDisplayRounding;
  readonly kind: 'link_strength' | 'link_existence';
  readonly from: string;
  readonly to: string;
  readonly among: 'all' | 'unsized_links';
}

export interface GoalChanceRangeInputs {
  /** The option's own driver block, captured before either CEE withhold deletes it. Current-first by option id. */
  readonly driversByOption: ReadonlyMap<string, unknown>;
  readonly goalPaths: readonly PlaceholderGoalPath[];
  /** `runWithheldGoalFigures` BEFORE CEE's arms: PLoT's withhold always bars a range. */
  readonly plotWithheld: boolean;
  /** The Run's goal node: a chance that is unusable for the whole Run (`goalChanceTargetCause`) bars every range. */
  readonly goalId: unknown;
}

/** Ruling 2: copy the A7 info record's own sentence verbatim; absence stays absent. */
export function goalChanceHorizonOf(envelope: unknown): { horizon_untested: true; horizon_line: string } | Record<string, never> {
  const warnings = isRec(envelope) && Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : [];
  const horizon = warnings.find((w): w is Rec => isRec(w) && w.code === GOAL_HORIZON_NOT_TESTED
    && w.severity === 'info' && typeof w.message === 'string');
  return horizon === undefined ? {} : { horizon_untested: true, horizon_line: horizon.message as string };
}

/** Ruling 1: one withheld option, one resolved unsized link row, each endpoint at its own group step. */
export function goalChanceRangeOf(envelope: unknown, graph: unknown, optionId: string, inputs: GoalChanceRangeInputs): GoalChanceRange | null {
  if (!isRec(envelope) || !isRec(graph) || !Array.isArray(graph.nodes) || inputs.plotWithheld) return null;
  // ⛔ S1 review r1 #2: no stated target / direction / unit, a ceiling not minimised, a floor minimised — the chance itself
  // is unusable for every option, so no range of it is shown either (the gate never names an option already withheld).
  if (goalChanceTargetCause(graph, inputs.goalId) !== null) return null;
  const warnings = Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings.filter(isRec) : [];
  const applies = (w: Rec): boolean => !Array.isArray(w.option_ids) || w.option_ids.length === 0 || w.option_ids.includes(optionId);
  const allowed = (w: Rec): boolean => w.code === GOAL_FIGURES_PLACEHOLDER_PATH || w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE;
  if (!warnings.some(w => applies(w) && allowed(w))) return null;
  if (warnings.some(w => applies(w) && typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code) && !allowed(w))) return null;

  // The P5 walk must start at THIS option. Other options' failing links cannot license this option's range.
  const nodes = graph.nodes.filter(isRec);
  if (!nodes.some(n => n.kind === 'option' && n.id === optionId)) return null;
  const otherOptions = new Set(nodes.filter(n => n.kind === 'option' && n.id !== optionId).map(n => n.id));
  const ownGraph = { ...graph, nodes: nodes.filter(n => !otherOptions.has(n.id)),
    edges: Array.isArray(graph.edges) ? graph.edges.filter(e => isRec(e) && !otherOptions.has(e.from) && !otherOptions.has(e.to)) : [] };
  const verdict = targetTestabilityOf(ownGraph, Array.isArray(envelope.identity_evaluations) ? envelope.identity_evaluations : undefined);
  if (verdict.kind !== 'not_testable' || verdict.failures.length === 0 || !verdict.failures.every(f =>
    (f.precondition === 'P5' || f.precondition === 'P6') && (f.code === 'goal_path_placeholder' || f.code === 'goal_path_unsized'))) return null;
  const links = [...inputs.goalPaths.filter(p => p.option_id === optionId).flatMap(p => p.links),
    ...verdict.failures.filter(f => f.precondition === 'P5').flatMap(f => f.links ?? [])];

  const block = inputs.driversByOption.get(optionId);
  if (!isRec(block) || ('invalid_rows_dropped' in block && block.invalid_rows_dropped !== 0)) return null;
  const top = topDriverRow({ probability_of_goal_drivers: block });
  if (top === null) return null; // Includes any unrankable row, not just an unrankable candidate.
  // ⛔ S1 review r1 #3: the FIRST row (ISL's order) on one of this option's unsized links decides. If it cannot be shown
  // (below resolution, correlated, not a link kind, off the Run graph), there is no range: a lower row would make
  // "depends most on" false. A sized quantity may outrank it (`among: 'unsized_links'`).
  const onUnsizedLink = (r: Rec): boolean => {
    const ends = linkEnds(r);
    return ends !== null && links.some(l => l.from === ends.from && l.to === ends.to);
  };
  const ranked = (block.drivers as Rec[]).slice().sort(byIslRank);
  const at = ranked.findIndex(onUnsizedLink);
  if (at < 0) return null;
  const row = ranked[at]!;
  // ⛔ S1 review r2 #1 (DL 6028386916; Science ruling, fail closed): "Of the links not sized yet, it depends most on X"
  // is false when a link nobody sized (`licenceUnsizedLink`) OFF this option's path outranks X. Sizing that link would
  // not show this option's chance, so it cannot stand in either: there is no range. Sized quantities may outrank X.
  if (ranked.slice(0, at).some(r => { const e = linkEnds(r); return e !== null && licenceUnsizedLink(runEdge(graph, e.from, e.to)); })) return null;
  // ⛔ S1 review r1 #1: ISL omits `correlated` unless true (PLoT forwards only `true`); a missing key is uncorrelated,
  // exactly as `goalChanceDriverOf` reads it. Anything but absent/false is correlated.
  if (row.status !== 'resolved' || (row.correlated !== undefined && row.correlated !== false)
    || (row.kind !== 'link_strength' && row.kind !== 'link_existence')) return null;
  { const ends = linkEnds(row)!; if (runEdge(graph, ends.from, ends.to) === undefined) return null; }
  const existence = row.kind === 'link_existence';
  const a = row[existence ? 'p_goal_if_absent' : 'p_goal_if_low'];
  const b = row[existence ? 'p_goal_if_present' : 'p_goal_if_high'];
  const na = row[existence ? 'n_absent' : 'n_low'];
  const nb = row[existence ? 'n_present' : 'n_high'];
  if (!chance(a) || !chance(b) || !count(na) || !count(nb)) return null;
  const ga = groupPct(a, na), gb = groupPct(b, nb);
  // ⛔ #87 6027634829 STOP RULE: equal displayed endpoints are no range, even when raw chances differ.
  if (ga.pct_if_side === gb.pct_if_side) return null;
  const [low, high] = ga.pct_if_side < gb.pct_if_side ? [ga, gb] : [gb, ga];
  return { low_pct: low.pct_if_side, high_pct: high.pct_if_side,
    low_rounding: low.pct_if_side_rounding, high_rounding: high.pct_if_side_rounding,
    kind: existence ? 'link_existence' : 'link_strength', ...linkEnds(row)!, among: row === top ? 'all' : 'unsized_links' };
}

/** Append ONE info record when at least one option qualifies. No figure or withhold is changed. */
export function withGoalChanceRange<E>(envelope: E, graph: unknown, inputs: GoalChanceRangeInputs): E {
  if (!isRec(envelope)) return envelope;
  const warnings = Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : [];
  if (warnings.some(w => isRec(w) && w.code === GOAL_CHANCE_RANGE)) return envelope;
  const entries = [...inputs.driversByOption.keys()].flatMap(id => {
    const range = goalChanceRangeOf(envelope, graph, id, inputs);
    return range === null ? [] : [[id, range] as const];
  });
  if (entries.length === 0) return envelope;
  return appendInferenceWarning(envelope, {
    code: GOAL_CHANCE_RANGE, severity: 'info',
    message: "Some options' chances are shown as a range: a link on the way to your goal isn't sized in the model yet.",
    option_ids: entries.map(([id]) => id), range_by_option: Object.fromEntries(entries), ...goalChanceHorizonOf(envelope),
  });
}
