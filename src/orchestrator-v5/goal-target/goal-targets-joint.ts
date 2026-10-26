import { goalDependencyCauses, goalDependencyWords } from '../admission/target-testability.js';
/**
 * ⭐ RECOVERY BATCH C — SEVERAL TARGETS: EACH TARGET'S OWN CHANCE, AND THE CHANCE OF MEETING THEM ALL ON THE SAME DRAWS
 * (Batch 0 change-goal decision rulings 15–17 and 22; amendments 5–6; DL amendment 22:15Z: C includes the minimum joint AND).
 *
 * Marketing: "conversion over 15% and 20 new customers within the first three months after launch". Each target is a
 * `goal_constraints` row marked `role: 'goal_target'` (the goal's own target is one of them). The Run sends every row
 * (`goal_constraints`, strict comparators as stated: `wireGoalConstraints`); ISL counts the draws on which EVERY sent
 * condition holds (PLoT `probability_of_joint_goal`, with `probability_of_joint_goal_precision`) and each condition alone
 * (`constraint_probabilities[id]`, with `constraint_probabilities_precision[id]`). So:
 *
 *   · the HEADLINE is the joint, and it names EVERY condition the Run sent (ruling 16) — targets first, then any limit;
 *   · each target is said separately below, with its own chance (ruling 15);
 *   · the joint is WITHHELD, with its reason, when the engine returned no joint figure or no joint precision, when a strict
 *     comparison the user stated did not reach the engine strictly, or when a condition cannot be said in the user's units
 *     (rulings 16–17, amendment 6). Marginal chances are NEVER multiplied. While it is withheld the Fréchet bound may be said:
 *     meeting both is no more likely than the lower of the two chances, which holds whatever their dependence;
 *   · the status quo is given no figure only where its own reference is the same-draw one (amendment 1, partial: AIE 12 Oct).
 * Pure and total; reads only the Run's own records and the rows it sent.
 */
import { sayFigureAsWritten } from '../agent-lane/say-figure.js';
import { goalFiguresWithheldWarnings, readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { comparatorWords, periodWords, type GoalTargetBasis } from './goal-target-basis.js';
import { readGoalRecord } from './goal-record.js';
import type { PressBlocker } from '../agent-lane/press-next-step.js';
import { displayedPctAt, displayRoundingFor, wilsonHalfWidthPoints, type GoalChanceDisplayRounding } from './goal-chance-driver.js';
import { unresolvedRetainedLimits, retainedLimitWithheldLine, RETAINED_LIMIT_WITHHOLD_CODE } from '../../graph/retained-limit.js';
import type { PerLimitVerdict } from '../../orchestrator/context/constraint-feasibility.js';
import { isOlumiEstimateValue } from '../../cee/provenance/provenance-of.js';
import { cohortTargetsOf, rateQuartilesOf, readCohortForecast, type CohortForecast } from './cohort-forecast.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unit01 = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;

/** The marker on a `goal_constraints` row that makes it one of the goal's TARGETS (absent = a limit, as before). */
export const GOAL_TARGET_ROLE = 'goal_target';

export type JointWithholdReason = 'not_returned' | 'precision_missing' | 'strict_not_preserved' | 'condition_not_named' | 'olumi_base' | 'no_option'
  | 'target_not_supported' | 'figure_not_preserved' | 'condition_unscored' | 'condition_withheld';

export interface GoalCondition {
  readonly constraint_id: string;
  readonly node_id: string;
  readonly role: 'target' | 'limit';
  readonly operator: '>=' | '>' | '<=' | '<';
  readonly value: number;
  readonly unit: string;
  readonly label: string;
  /** "‘Conversion rate’ being above 15%". */
  readonly clause: string;
}

export interface GoalTargetChance {
  readonly constraint_id: string;
  /** The words after "chance of": "‘Conversion rate’ being above 15% over the first three months after launch". */
  readonly words: string;
  readonly pct_by_option: Readonly<Record<string, number>>;
  readonly display_rounding_by_option?: Readonly<Record<string, GoalChanceDisplayRounding>>;
}

export type GoalJoint =
  | { readonly status: 'licensed'; readonly words: string; readonly pct_by_option: Readonly<Record<string, number>>;
      readonly display_rounding_by_option?: Readonly<Record<string, GoalChanceDisplayRounding>>;
      readonly withheld_option_ids?: readonly string[] }
  | { readonly status: 'withheld'; readonly reason: JointWithholdReason; readonly line: string; readonly frechet_line?: string };

export interface GoalTargetsBlock {
  readonly conditions: readonly GoalCondition[];
  /** Disclosures copied to the existing licence notes; no figure is licensed by a note. */
  readonly notes?: readonly string[];
  /** Display joins from this Run's recorded causes. Original condition notes remain available to the AI. */
  readonly note_groups?: readonly {
    readonly source_notes: readonly string[];
    readonly line: string;
    readonly joint_line?: string;
  }[];
  /**
   * AIE C clause 3 (12 Oct): the labels of the goal's targets this analysis cannot yet combine (a target stated as a
   * change, including the goal's own). They are kept and named; the joint is withheld with `target_not_supported`.
   */
  readonly unsupported_targets?: readonly string[];
  readonly per_target: readonly GoalTargetChance[];
  readonly joint: GoalJoint;
  /**
   * AIE same-cohort law (science PR-4): the targets' chances rest on each option's cohort forecast (`cohort-forecast.ts`), not
   * on the model's links; the joint covers the targets only, and the notes say so, name the limits left out and give the inputs.
   */
  readonly basis?: 'same_cohort_forecast';
  /** Set when any forecast said rests on Olumi's figures (they stay Olumi's after approval, MA5). */
  readonly provisional?: true;
}

const OPS = new Set(['>=', '>', '<=', '<']);

/** A stored row's comparator as the user stated it: `operator_as_stated` beside its consistent held bound, else the held one. */
function statedOperator(row: Rec): string | undefined {
  const held = row.operator;
  const stated = row.operator_as_stated;
  if ((stated === '>' && held === '>=') || (stated === '<' && held === '<=')) return stated;
  return typeof held === 'string' && OPS.has(held) ? held : undefined;
}

function listWords(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The Run's one joint-withheld sentence (DL scope decision 2's words, kept for both and for more). */
export function jointWithheldLine(n: number, reason: JointWithholdReason, unsupported: readonly string[] = [],
  /** The clauses of the targets whose own chance waits with the joint (strictness not kept, r1 item 4). */
  strictLost: readonly string[] = []): string {
  const all = n === 2 ? 'both' : 'all of them';
  if (reason === 'target_not_supported' && unsupported.length > 0) {
    const names = listWords(unsupported.map((x) => `‘${x}’`));
    return `The chance of meeting ${all} together isn’t shown: ${names} ${unsupported.length === 1 ? 'is' : 'are'} stated as a change, which can’t yet be combined with the other targets in this analysis.`;
  }
  if (reason === 'strict_not_preserved') {
    const own = strictLost.length === 0 ? ''
      : `, and nor is the chance of ${listWords(strictLost)} on ${strictLost.length === 1 ? 'its' : 'their'} own`;
    return `The chance of meeting ${all} together isn’t shown${own}: the comparison the analysis used is not the one you stated.`;
  }
  // Re-scope r1 (non-blocking, DL item 3): the figure the engine was sent is not the stored one — never describe the stored one.
  if (reason === 'figure_not_preserved') {
    const own = strictLost.length === 0 ? ''
      : `, and nor is the chance of ${listWords(strictLost)} on ${strictLost.length === 1 ? 'its' : 'their'} own`;
    return `The chance of meeting ${all} together isn’t shown${own}: this analysis did not use every stated target as specified.`;
  }
  if (reason === 'condition_withheld') return `The chance of meeting ${all} together isn’t shown: one or more condition chances are withheld. The condition notes explain why.`;
  if (reason === 'condition_unscored') return `The chance of meeting ${all} together isn’t shown: one or more conditions could not be evaluated. The condition notes explain why.`;
  if (reason === 'condition_not_named') return `The chance of meeting ${all} together isn’t shown: one of its conditions can’t be said in your units.`;
  if (reason === 'olumi_base') return `The chance of meeting ${all} together isn’t shown: this Run withholds the chance for a target that starts from an Olumi estimate.`;
  // Independent check r1 item 7: a joint figure that came back WITHOUT its precision was calculated; say what is missing.
  if (reason === 'precision_missing') return `The chance of meeting ${all} together isn’t shown: this run did not say how precise it is. Run the analysis again to get it with its precision.`;
  return `The chance of meeting ${all} together isn’t calculated yet. Run the analysis again to get it.`;
}

/**
 * ⛔ Amendment 7: the targets whose own starting value is OLUMI's estimate (never the goal's own, withheld at admission).
 * ONE predicate: the joint waits on exactly these (`goalTargetsBlockOf`), and the coaching ask names the first of them.
 */
export function olumiBaseTargetsOf(graph: unknown, targets: readonly GoalCondition[]): GoalCondition[] {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  return targets.filter((t) => {
    const n = nodes.find((x) => x.id === t.node_id);
    const os = isRec(n?.observed_state) ? n!.observed_state : undefined;
    return n?.kind !== 'goal' && os !== undefined && isOlumiEstimateValue(os);
  });
}

/**
 * ⭐ COACH (DL coaching-on-press; PL #94 6135017311): the ONE next step for a withheld joint chance, typed by the same
 * reason `jointWithheldLine` says. A change target that can't be combined, or a strict comparison the joint did not keep,
 * is a CAPABILITY gap: said as such, never asked. Olumi's own assumed starting value is the user's to give, asked for the
 * named target in its own unit (`olumiBase`, from `olumiBaseTargetsOf`: today's level, as target-testability's case (d)
 * asks it); a writer takes that answer and the joint no longer waits on it. A missing precision or result is the line's
 * own "Run the analysis again". No typed cause, no step: a condition that can't be named or a figure not used as stated
 * (an input might or might not unlock it), an `olumi_base` whose target is not identified, `no_option` (the reason
 * does not say whether the options are missing or were not scored), and a condition withheld or unscored (its own note).
 */
export function jointBlockerOf(n: number, reason: JointWithholdReason, unsupported: readonly string[] = [],
  olumiBase: readonly GoalCondition[] = []): PressBlocker | null {
  const all = n === 2 ? 'both targets' : 'all of the targets';
  switch (reason) {
    case 'target_not_supported':
      return { kind: 'missing_implementation', what: unsupported.length > 0
        ? `the chance of meeting ${all} together while ${listWords(unsupported.map((x) => `‘${x}’`))} ${unsupported.length === 1 ? 'is' : 'are'} stated as a change`
        : `the chance of meeting ${all} together` };
    case 'strict_not_preserved':
      return { kind: 'missing_implementation', what: `the chance of meeting ${all} together with the strict comparison you stated` };
    case 'olumi_base': {
      const first = olumiBase[0];
      return first === undefined ? null
        : { kind: 'missing_input', ask: `What's today's level of ${first.label}${first.unit !== '' ? `, in ${first.unit}` : ''}?` };
    }
    case 'precision_missing':
    case 'not_returned':
      return { kind: 'run_again', why: reason };
    // #2992: a condition withheld or unscored has its own note saying why, so the joint has no step of its own.
    case 'figure_not_preserved':
    case 'condition_not_named':
    case 'no_option':
    case 'condition_unscored':
    case 'condition_withheld':
      return null;
  }
}

/** Amendment 6: true whatever the targets' dependence; never a product of the marginals. */
export function frechetLine(n: number): string {
  return n === 2 ? 'Meeting both is no more likely than the lower of the two chances.'
    : 'Meeting all of them is no more likely than the lowest of these chances.';
}

/** `{n_informative, standard_error}` (schemas 0.83.0 `EnrichmentProbabilityPrecisionSchema`), or null. Null is "not known". */
function precisionOf(v: unknown): { n: number; se: number } | null {
  if (!isRec(v)) return null;
  const n = v.n_informative;
  const se = v.standard_error;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && finite(se) && se >= 0 && se <= 0.5 ? { n, se } : null;
}

const optionIdOf = (r: Rec): string | undefined => typeof r.option_id === 'string' ? r.option_id : typeof r.id === 'string' ? r.id : undefined;

/**
 * The several-targets block for a model that STORED at least one `goal_target` row, else `null` (one target: nothing changes).
 * `optionIds` are the scored options in the model's order. The status quo is given no figure only where its own reference
 * says so (AIE status-quo disposition, 12 Oct): `fromTargets` names each target whose marginal it is left out of (that
 * target's reference is the same-draw one, or its share disagrees with it), and `fromJoint` whether it is left out of the
 * joint. Anywhere else its figures are the Run's, with their uncertainty, exactly as any option's.
 */
export function goalTargetsBlockOf(args: {
  readonly envelope: unknown;
  readonly graph: unknown;
  readonly storedConstraints: unknown;
  readonly sentConstraints: unknown;
  readonly optionIds: readonly string[];
  readonly statusQuo?: { readonly id: string; readonly fromJoint: boolean; readonly fromTargets: ReadonlySet<string> };
  readonly basis?: GoalTargetBasis;
  readonly perLimit?: readonly PerLimitVerdict[];
  readonly primaryGoalId?: unknown;
  readonly primaryRefused?: boolean;
}): GoalTargetsBlock | null {
  const stored = Array.isArray(args.storedConstraints) ? args.storedConstraints.filter(isRec) : [];
  const sent = Array.isArray(args.sentConstraints) ? args.sentConstraints.filter(isRec) : [];
  const targetIds = new Set(stored.filter((r) => r.role === GOAL_TARGET_ROLE && typeof r.constraint_id === 'string').map((r) => r.constraint_id as string));
  if (targetIds.size === 0) return null;
  const nodes = isRec(args.graph) && Array.isArray(args.graph.nodes) ? args.graph.nodes.filter(isRec) : [];
  const labelOf = (id: unknown): string | undefined => {
    const label = nodes.find((n) => n.id === id)?.label;
    return typeof label === 'string' && label.trim() !== '' && !/[\r\n]/.test(label) ? label.trim() : undefined;
  };
  const period = args.basis === undefined ? '' : ` ${periodWords(args.basis)}`;

  // Every stored or sent condition, in the words the user stated it (strict kept). A row we cannot say is fatal to the joint.
  let unnamed = false;
  let strictLost = false;
  const strictLostIds = new Set<string>();
  // ⛔ Re-scope r1 (DL item 3): a row whose SENT figure is not the stored one was scored on another threshold — the joint and
  // that condition's own chance wait, with that reason; the stored figure is never described as what was analysed.
  const figureLostIds = new Set<string>();
  const conditions: GoalCondition[] = [];
  // AIE C clause 3: a target kept in its own (change) frame is named here, never forced into a level clause.
  const unsupported: string[] = [];
  // Stored conditions remain visible even when admission refused to send one.
  const inventory = [...sent, ...stored.filter((r) => !sent.some((x) => x.constraint_id === r.constraint_id))];
  for (const row of inventory) {
    const id = row.constraint_id;
    const node = row.node_id;
    const storedRow = stored.find((r) => r.constraint_id === id);
    const op = storedRow === undefined ? (typeof row.operator === 'string' && OPS.has(row.operator) ? row.operator : undefined) : statedOperator(storedRow);
    if (typeof id !== 'string' || typeof node !== 'string' || op === undefined) { unnamed = true; continue; }
    // ⛔ Ruling 16: "above 15%" must have been SENT as ">" — never scored as "at least 15%" and called "above". The joint
    // waits, and so does THIS condition's own chance (independent check r1 item 4): its marginal was scored on the sent bound.
    if (sent.includes(row) && row.operator !== op) { strictLost = true; strictLostIds.add(id); }
    // ⛔ RE-SCOPE 2 (R5-4; AIE open 2): EXACT finite agreement, in the same unit and frame, from the same caller snapshot —
    // never a unit-dependent tolerance (`1e-9 × max(1, |v|)` was not an attested representation equality: 15 + 1e-12 is
    // another figure). A row whose sent unit or frame differs from the stored one was scored on another quantity reading.
    const differs = (k: 'unit' | 'value_frame'): boolean => typeof row[k] === 'string' && typeof storedRow?.[k] === 'string' && row[k] !== storedRow[k];
    if (storedRow !== undefined && finite(storedRow.value)
      && (!(finite(row.value) && row.value === storedRow.value) || differs('unit') || differs('value_frame'))) figureLostIds.add(id);
    const label = labelOf(node) ?? (typeof storedRow?.label === 'string' && storedRow.label.trim() !== '' && !/[\r\n]/.test(storedRow.label) ? storedRow.label.trim() : undefined);
    const unit = typeof row.unit === 'string' && row.unit.trim() !== '' ? row.unit.trim()
      : typeof storedRow?.unit === 'string' && storedRow.unit.trim() !== '' ? storedRow.unit.trim() : undefined;
    const value = finite(storedRow?.value) ? storedRow!.value : row.value;
    const bound = comparatorWords(op);
    // A condition stated as a change, or with no unit or label, cannot be said exactly in this sentence form: the joint waits.
    const frame = storedRow?.value_frame ?? row.value_frame;
    if (targetIds.has(id) && label !== undefined && frame !== undefined && frame !== 'level') { unsupported.push(label); continue; }
    if (label === undefined || unit === undefined || !finite(value) || bound === undefined || (frame !== undefined && frame !== 'level')) {
      unnamed = true; continue;
    }
    const role = targetIds.has(id) ? 'target' as const : 'limit' as const;
    conditions.push({
      constraint_id: id, node_id: node, role, operator: op as GoalCondition['operator'],
      value, unit, label, clause: `‘${label}’ ${role === 'target' ? 'being' : 'is'} ${bound} ${sayFigureAsWritten(value, unit)}${role === 'target' ? period : ''}`,
    });
  }
  const ordered = [...conditions.filter((c) => c.role === 'target'), ...conditions.filter((c) => c.role === 'limit')];
  const targets = ordered.filter((c) => c.role === 'target');
  const model = isRec(args.graph) && isRec(args.graph.living_model) ? args.graph.living_model : undefined;
  const currentAims = Array.isArray(model?.aims) ? model.aims.filter(isRec).filter(a => a.status === 'current').map(a => a.id) : [];
  const dependencyHeld = new Set([...ordered.map(t => t.node_id), ...currentAims].filter(id => goalDependencyCauses(args.graph, id).length > 0));
  // ⛔ RE-SCOPE 2 (R5-5 (b); DL ruling): a stated TARGET the Run did not send (no row, so no threshold reached the engine) is
  // never left out of a joint that claims every target — the joint waits, as for a figure not preserved.
  const unsentTargets = stored.filter((r) => typeof r.constraint_id === 'string' && targetIds.has(r.constraint_id)
    && !sent.some((x) => x.constraint_id === r.constraint_id));
  // The goal's own target is one of the joint's conditions only when its own row was sent. A goal whose target is a CHANGE
  // has no such row (`admit-model.ts` writes it for a level target only): the joint would leave the goal out, so it waits.
  const goalNode = nodes.find((x) => x.kind === 'goal');
  const goalLabel = labelOf(goalNode?.id);
  const goalStates = typeof goalNode?.id === 'string' && finite(readGoalRecord(args.graph, goalNode.id)?.target?.raw);
  const goalRowStored = stored.some((r) => typeof r.constraint_id === 'string' && targetIds.has(r.constraint_id) && r.node_id === goalNode?.id);
  if (goalNode !== undefined && goalLabel !== undefined && goalStates && !goalRowStored
    && !targets.some((t) => t.node_id === goalNode.id) && !unsupported.includes(goalLabel)) unsupported.unshift(goalLabel);
  // ⛔ Amendment 7: a LEVEL target read against OLUMI's own starting value is the most sensitive to it, and the goal's own
  // such target is withheld at admission (`admit-model.ts`, the kept guard). The same holds for every target row: its own
  // chance is not said, and the joint that includes it waits (never relabelled as the user's).
  const olumiBase = new Set(olumiBaseTargetsOf(args.graph, targets).map((t) => t.constraint_id));

  const records = (isRec(args.envelope) ? readOptionResultSources(args.envelope) : []).find((s) => s.length > 0) ?? [];
  const recordOf = new Map<string, Rec>();
  for (const r of records) {
    const id = optionIdOf(r);
    if (id !== undefined && !recordOf.has(id)) recordOf.set(id, r);
  }
  // ⭐ AIE same-cohort law (science PR-4, `cohort-forecast.ts`): where the Run scored the two targets on an option's cohort
  // forecast, their chances come from THAT forecast, never the model's links, so the model's own reasons for withholding a
  // target's figure (its missing level, its unsized parts) describe the model, not this figure, and are not said beside it.
  // Every gate on what the targets ARE stays (both stated, both sent as stated, levels, never Olumi's base). Each option's
  // figures are bound by identity to the forecast it holds: the same people and quartiles, the stated comparison, the exact
  // threshold. An option without one is named, never filled in. The joint covers the targets only; each limit keeps its reason.
  const storedTargetRows = stored.filter((r) => r.role === GOAL_TARGET_ROLE);
  // A LIMIT sent on another scale or comparison is no part of this joint (it is named as left out); a TARGET must be exact.
  const forecastMode = dependencyHeld.size === 0 && targetIds.size === 2 && targets.length === 2 && unsupported.length === 0 && !unnamed
    && ![...targetIds].some((id) => strictLostIds.has(id) || figureLostIds.has(id)) && unsentTargets.length === 0 && olumiBase.size === 0
    && args.optionIds.some((id) => isRec(recordOf.get(id)?.target_forecast));
  const forecastOf = (id: string): { forecast: CohortForecast; marginal: Map<string, { p: number; n: number }>; joint: { p: number; n: number } } | null => {
    const f = readCohortForecast(nodes.find((n) => n.id === id));
    const tf = recordOf.get(id)?.target_forecast;
    if (f === undefined || !isRec(tf) || !isRec(tf.law) || !Array.isArray(tf.conditions)) return null;
    const bound = cohortTargetsOf(storedTargetRows, f);
    const [q25, q75] = rateQuartilesOf(f);
    const lq = tf.law.rate_quartiles;
    if (bound === undefined || tf.law.exposure !== f.people_reached || !Array.isArray(lq) || lq.length !== 2 || lq[0] !== q25 || lq[1] !== q75) return null;
    const conds = tf.conditions.filter(isRec);
    if (conds.length !== bound.length || conds.length !== tf.conditions.length) return null;
    const marginal = new Map<string, { p: number; n: number }>();
    for (const b of bound) {
      const t = targets.find((x) => x.constraint_id === b.row.constraint_id);
      const matches = conds.filter((c) => c.constraint_id === b.row.constraint_id);
      const c = matches[0];
      const pr = precisionOf(c?.precision);
      if (t === undefined || matches.length !== 1 || c === undefined || pr === null || c.quantity !== b.quantity
        || c.threshold !== b.threshold || c.operator !== t.operator || !unit01(c.probability)) return null;
      marginal.set(t.constraint_id, { p: c.probability, n: pr.n });
    }
    const jp = precisionOf(tf.joint_probability_precision);
    return unit01(tf.joint_probability) && jp !== null ? { forecast: f, marginal, joint: { p: tf.joint_probability, n: jp.n } } : null;
  };
  const figures = new Map<string, NonNullable<ReturnType<typeof forecastOf>>>();
  if (forecastMode) for (const id of args.optionIds) { const f = forecastOf(id); if (f !== null) figures.set(id, f); }

  const sq = args.statusQuo;
  const compared = args.optionIds.filter((id) => !(sq?.fromJoint === true && id === sq.id));
  const comparedFor = (constraintId: string): string[] => args.optionIds.filter((id) => !(sq?.fromTargets.has(constraintId) === true && id === sq.id));

  const upstream = isRec(args.envelope) ? goalFiguresWithheldWarnings(args.envelope) : [];
  const notes: string[] = [...dependencyHeld].map(id => goalDependencyWords(args.graph, id));
  const limitNotes = new Set<string>();
  const causes = new Map<string, { reason: string; clauses: Set<string>; notes: Set<string>; options?: readonly string[] }>();
  const recordCause = (c: GoalCondition, note: string, code: unknown, reason: string, options?: readonly string[]) => {
    // Scope is a recorded binding, never inferred from the reason's prose or a warning's node_ids.
    const key = JSON.stringify([code, reason, options === undefined ? null : [...options].sort()]);
    const cause = causes.get(key) ?? { reason, clauses: new Set<string>(), notes: new Set<string>(), options };
    cause.clauses.add(c.clause);
    cause.notes.add(note);
    causes.set(key, cause);
  };
  const retainedIds = new Set(unresolvedRetainedLimits(args.graph).map((r) => r.constraint_id));
  const targetWarnings = (t: GoalCondition) => upstream.filter((w) =>
    !Array.isArray(w.constraint_ids) || w.constraint_ids.length === 0 || w.constraint_ids.includes(t.constraint_id));
  const refusedTargets = new Set(targets.filter((t) => dependencyHeld.has(t.node_id) || (args.primaryRefused && t.node_id === args.primaryGoalId)
    || !sent.some((r) => r.constraint_id === t.constraint_id)).map((t) => t.constraint_id));
  for (const c of ordered) {
    // The typed dependency note above is the reason; absence from the wire is its consequence.
    if (dependencyHeld.has(c.node_id) || (forecastMode && c.role === 'target')) continue;
    const verdict = args.perLimit?.find((v) => v.constraint_id === c.constraint_id);
    if (verdict?.state === 'unscored') {
      const reason = retainedIds.has(c.constraint_id) ? retainedLimitWithheldLine(args.graph) : verdict.reason === 'parts_links_placeholder'
        ? 'The contributing quantities have links whose sizes are not yet specified. This calculation needs supported contributions in this quantity’s units, or a supported forecast for the quantity.'
        : verdict.reason === 'limit_rests_on_olumi_guess'
          ? 'The calculation still rests on Olumi’s estimated quantities. Review their basis and uncertainty; the limit or target itself is not a forecast.'
          : 'This Run did not return a usable evaluation for this condition; the reason needs to be checked.';
      const note = `${c.clause}: ${reason}`;
      notes.push(note);
      limitNotes.add(note);
      // A retained limit's cause is the retained-limit withhold itself, whatever the engine's per-limit code: so two retained
      // limits are ONE cause and one line (reply-face P2; served marketing 7f5659fd said it once per limit).
      recordCause(c, note, retainedIds.has(c.constraint_id) ? RETAINED_LIMIT_WITHHOLD_CODE : verdict.reason, reason);
    }
    if (c.role === 'target' && olumiBase.has(c.constraint_id)) {
      const reason = jointWithheldLine(Math.max(ordered.length + unsupported.length + (unnamed ? 1 : 0), 2), 'olumi_base');
      const note = `${c.clause}: ${reason}`;
      notes.push(note);
      recordCause(c, note, 'olumi_base', reason);
    }
    if (c.role === 'target' && (refusedTargets.has(c.constraint_id) || targetWarnings(c).length > 0)) {
      const messages = targetWarnings(c).flatMap((w) => typeof w.message === 'string' ? [w.message] : []);
      const fallback = !sent.some((r) => r.constraint_id === c.constraint_id)
        ? 'This Run did not test the stated target. Its quantity and scoring frame need to be resolved.'
        : c.node_id === args.primaryGoalId && records.some((r) => unit01(r.probability_of_goal))
          ? 'This Run scored this target, but its chance is withheld.'
          : 'This Run returned no licensed chance for this target.';
      const note = `${c.clause}: ${messages.length > 0 ? [...new Set(messages)].join(' ') : fallback}`;
      notes.push(note);
      // Leave the complete note unjoined if any cause has a malformed binding.
      const warnings = targetWarnings(c);
      if (warnings.some((w) => Array.isArray(w.option_ids) && !w.option_ids.every((id) => typeof id === 'string'))) continue;
      for (const w of warnings) {
        if (typeof w.message !== 'string') continue;
        recordCause(c, note, w.code, w.message, Array.isArray(w.option_ids) ? w.option_ids as string[] : undefined);
      }
    }
  }

  // Each target's own chance from each option's forecast, with that figure's own precision.
  const forecastPerTarget: GoalTargetChance[] = !forecastMode ? [] : targets.flatMap((t) => {
    const pct: Record<string, number> = {};
    const rounding: Record<string, GoalChanceDisplayRounding> = {};
    for (const [id, f] of figures) {
      const m = f.marginal.get(t.constraint_id)!;
      rounding[id] = displayRoundingFor(wilsonHalfWidthPoints(m.p, m.n));
      pct[id] = displayedPctAt(m.p, rounding[id]!);
    }
    return Object.keys(pct).length === 0 ? [] : [{ constraint_id: t.constraint_id, words: t.clause, pct_by_option: pct, display_rounding_by_option: rounding }];
  });
  if (forecastMode) {
    const optionWords = (id: string): string => `‘${labelOf(id) ?? id}’`;
    const missing = args.optionIds.filter((id) => !figures.has(id));
    if (missing.length > 0) {
      notes.push(`${listWords(missing.map(optionWords))} ${missing.length === 1 ? 'has' : 'have'} no forecast of the people reached and how many convert in this Run, so ${missing.length === 1 ? 'its' : 'their'} chance isn’t shown.`);
    }
    const limits = ordered.filter((c) => c.role === 'limit');
    if (limits.length > 0) {
      notes.push(`This covers your two targets only. Your ${limits.length === 1 ? 'limit' : 'limits'} on ${listWords(limits.map((c) => `‘${c.label}’`))} ${limits.length === 1 ? 'is' : 'are'} not included, because the forecast it rests on is of the people reached and how many of them convert${limitNotes.size > 0 ? '; the reasons the model gives for each limit are below' : ''}.`);
    }
    if (figures.size > 0) {
      const [rate, count] = cohortTargetsOf(storedTargetRows, [...figures.values()][0]!.forecast)!;
      const rateLabel = targets.find((t) => t.constraint_id === rate.row.constraint_id)!.label;
      const countLabel = targets.find((t) => t.constraint_id === count.row.constraint_id)!.label;
      // Whose each forecast is, by its own author (a human point forecast is not certainty, AIE 6180618773 C4; Olumi's stays Olumi's).
      const whose = (f: CohortForecast): string => (f.author === 'user' ? 'your' : 'Olumi’s');
      const inputs = [...figures].map(([id, { forecast: f }]) => `${f.author === 'user' ? 'your forecast' : 'Olumi’s estimate'} that ${optionWords(id)} reaches ${f.people_reached.toLocaleString('en-GB')} people${period}, with ${whose(f)} ‘${rateLabel}’ estimates of ${f.conversion_middle_half_pct[0]}% and ${f.conversion_middle_half_pct[1]}%`);
      const allYours = [...figures.values()].every(({ forecast: f }) => f.author === 'user');
      notes.push(`These chances rest on a forecast, not on the model’s links: ${inputs.join('; ')}. Each pair of conversion figures is ${allYours ? 'your own estimate' : 'an estimate'}, with about one chance in four below the lower and one in four above the upper; treating the underlying rate as a smooth curve through them (a Beta distribution), with each person converting at that same chance, is Olumi’s approximation. Each chance is Olumi’s scenario in which exactly that many people are reached; how many are actually reached may differ, and that uncertainty isn’t included. ‘${countLabel}’ counts the people who convert among those same people, as you said, so with that many reached, meeting both is the same as meeting the harder of the two.`);
      const olumi = [...figures].filter(([, { forecast: f }]) => f.author === 'olumi').map(([id]) => optionWords(id));
      if (olumi.length > 0) notes.push(`The figures for ${listWords(olumi)} are Olumi’s estimates, not yours, so the chances that rest on them are provisional.`);
    }
  }

  // Each target's own chance, per option, from the same Run (never re-derived).
  const perTarget: GoalTargetChance[] = forecastMode ? forecastPerTarget : targets.flatMap((t) => {
    if (refusedTargets.has(t.constraint_id) || olumiBase.has(t.constraint_id) || strictLostIds.has(t.constraint_id) || figureLostIds.has(t.constraint_id)) return [];
    const pct: Record<string, number> = {};
    const rounding: Record<string, GoalChanceDisplayRounding> = {};
    for (const id of comparedFor(t.constraint_id)) {
      if (targetWarnings(t).some((w) => !Array.isArray(w.option_ids) || w.option_ids.includes(id))) continue;
      const r = recordOf.get(id);
      const cp = r === undefined ? undefined : r.constraint_probabilities;
      const p = isRec(cp) ? cp[t.constraint_id] : Array.isArray(cp)
        ? cp.filter(isRec).find((x) => x.constraint_id === t.constraint_id)?.probability : undefined;
      if (!unit01(p)) continue;
      const pr = precisionOf(isRec(r?.constraint_probabilities_precision) ? r!.constraint_probabilities_precision[t.constraint_id] : undefined);
      const step = pr === null ? 'whole' : displayRoundingFor(wilsonHalfWidthPoints(p, pr.n));
      pct[id] = displayedPctAt(p, step);
      if (pr !== null) rounding[id] = step;
    }
    const absent = comparedFor(t.constraint_id).filter((id) => !Object.hasOwn(pct, id)
      && !targetWarnings(t).some((w) => !Array.isArray(w.option_ids) || w.option_ids.includes(id)));
    // A target this Run left unscored has its own reason said above (marketing e2e 25d14238: said once, never a second note).
    if (absent.length > 0 && args.perLimit?.find((v) => v.constraint_id === t.constraint_id)?.state !== 'unscored') {
      notes.push(`${t.clause}: This Run did not return a usable chance for ${listWords(absent.map((id) => `‘${labelOf(id) ?? id}’`))}.`);
    }
    if (Object.keys(pct).length === 0) return [];
    return [{ constraint_id: t.constraint_id, words: t.clause, pct_by_option: pct,
      ...(Object.keys(rounding).length > 0 ? { display_rounding_by_option: rounding } : {}) }];
  });

  const n = Math.max(ordered.length + unsupported.length + (unnamed ? 1 : 0), 2);
  const withheld = (reason: JointWithholdReason): GoalJoint => ({
    status: 'withheld', reason,
    line: jointWithheldLine(n, reason, unsupported, targets.filter((t) => (reason === 'figure_not_preserved' ? figureLostIds : strictLostIds)
      .has(t.constraint_id)).map((t) => period === '' ? t.clause : t.clause.slice(0, -period.length))),
    // Amendment 6: the bound needs each named target's own chance on the screen, for every compared option.
    ...(perTarget.length >= 2 && perTarget.length === targets.length && !unnamed && unsupported.length === 0 && unsentTargets.length === 0
      && ordered.length === targets.length
      && compared.every((id) => perTarget.every((t) => Object.hasOwn(t.pct_by_option, id))) ? { frechet_line: frechetLine(targets.length) } : {}),
  });
  let joint: GoalJoint;
  if (dependencyHeld.size > 0) joint = withheld('condition_withheld');
  else if (forecastMode) {
    const pct: Record<string, number> = {};
    const rounding: Record<string, GoalChanceDisplayRounding> = {};
    for (const [id, f] of figures) {
      rounding[id] = displayRoundingFor(wilsonHalfWidthPoints(f.joint.p, f.joint.n));
      pct[id] = displayedPctAt(f.joint.p, rounding[id]!);
    }
    const missing = args.optionIds.filter((id) => !figures.has(id));
    // The two targets share the stated period; no limit is part of this joint (the notes say so).
    joint = figures.size === 0 ? withheld('not_returned') : {
      status: 'licensed', words: `${listWords(targets.map((c) => period === '' ? c.clause : c.clause.slice(0, -period.length)))}${period}`,
      pct_by_option: pct, display_rounding_by_option: rounding, ...(missing.length > 0 ? { withheld_option_ids: missing } : {}),
    };
  } else if (unsupported.length > 0) joint = withheld('target_not_supported');
  else if (unnamed) joint = withheld('condition_not_named');
  else if (strictLost) joint = withheld('strict_not_preserved');
  else if (figureLostIds.size > 0 || unsentTargets.length > 0) joint = withheld('figure_not_preserved');
  else if (olumiBase.size > 0) joint = withheld('olumi_base');
  else if (args.primaryRefused) joint = withheld(args.perLimit?.some((v) => v.state === 'unscored') ? 'condition_unscored' : 'condition_withheld');
  else {
    const pct: Record<string, number> = {};
    const rounding: Record<string, GoalChanceDisplayRounding> = {};
    const missing: string[] = [];
    let anyFigure = false;
    let anyPrecisionMissing = false;
    for (const id of compared) {
      if (upstream.some((w) => (!Array.isArray(w.constraint_ids) || w.constraint_ids.length === 0
        || ordered.some((c) => (w.constraint_ids as unknown[]).includes(c.constraint_id)))
        && (!Array.isArray(w.option_ids) || w.option_ids.includes(id)))) { missing.push(id); continue; }
      const r = recordOf.get(id);
      const p = r?.probability_of_joint_goal;
      if (!unit01(p)) { missing.push(id); continue; }
      anyFigure = true;
      // DL contract ruling 1 (12 Oct): PLoT's wire name ONLY (schemas 0.83.0 renamed to match); no other name is a fallback.
      const pr = precisionOf(r!.probability_of_joint_goal_precision);
      // ⛔ Rulings 14 and 17: a joint figure with no joint precision is not said (never the single-goal interval reused).
      if (pr === null) { anyPrecisionMissing = true; missing.push(id); continue; }
      const step = displayRoundingFor(wilsonHalfWidthPoints(p, pr.n));
      pct[id] = displayedPctAt(p, step);
      rounding[id] = step;
    }
    if (compared.length === 0) joint = withheld('no_option');
    else if (Object.keys(pct).length === 0) joint = withheld(limitNotes.size > 0
      ? 'condition_unscored' : upstream.some((w) => (!Array.isArray(w.constraint_ids) || w.constraint_ids.length === 0
        || ordered.some((c) => (w.constraint_ids as unknown[]).includes(c.constraint_id)))
        && compared.some((id) => !Array.isArray(w.option_ids) || w.option_ids.includes(id)))
        ? 'condition_withheld' : anyFigure && anyPrecisionMissing ? 'precision_missing' : 'not_returned');
    else {
      // Amendment 5 / ruling 22: the targets share the stated period; a limit keeps its own (annual budget) and is said after
      // "while", so the period is never read as the limit's.
      const limits = ordered.filter((c) => c.role === 'limit').map((c) => c.clause);
      const words = `${listWords(targets.map((c) => period === '' ? c.clause : c.clause.slice(0, -period.length)))}${period}${limits.length > 0 ? `, while ${listWords(limits)}` : ''}`;
      joint = {
        status: 'licensed', words, pct_by_option: pct,
        display_rounding_by_option: rounding, ...(missing.length > 0 ? { withheld_option_ids: missing } : {}),
      };
    }
  }
  // A missing marginal or legacy per-limit certificate does not revoke a joint the existing gates licensed.
  // Phase a explains withheld results; full event testability is the separately scoped positive-path work.
  const shownNotes = joint.status === 'withheld' || forecastMode ? notes : notes.filter((note) => !limitNotes.has(note));
  const shownCauses = [...causes.values()].filter((cause) => [...cause.notes].every((note) => shownNotes.includes(note)));
  // Join in the existing producer, before prose loses its condition/cause/option bindings. No note is removed from the licence.
  const noteGroups = shownCauses.some((cause) => cause.clauses.size > 1 || (joint.status === 'withheld' && cause.reason === joint.line))
    ? shownCauses.map((cause) => ({ source_notes: [...cause.notes],
      line: `${listWords([...cause.clauses])}${cause.options === undefined ? '' : ` (for ${listWords(cause.options.map((id) => `‘${labelOf(id) ?? id}’`))})`}: ${cause.reason}`,
      ...(joint.status === 'withheld' && cause.reason === joint.line ? { joint_line: joint.line } : {}),
    })) : [];
  return { conditions: ordered, ...(shownNotes.length > 0 ? { notes: shownNotes } : {}),
    ...(noteGroups.length > 0 ? { note_groups: noteGroups } : {}), per_target: perTarget, joint, ...(unsupported.length > 0 ? { unsupported_targets: unsupported } : {}),
    ...(forecastMode ? { basis: 'same_cohort_forecast' as const } : {}),
    ...(forecastMode && [...figures.values()].some((f) => f.forecast.author === 'olumi') ? { provisional: true as const } : {}) };
}

/**
 * ⭐ Reply-face P2 (said once, on the result card): the licence's notes as a surface shows them. Notes that share one recorded
 * cause are said as their ONE group line, and a note or group whose reason the same surface already says (the card's summary,
 * e.g. the retained-limit withhold) is not said again. The licence keeps every original note; only the display joins.
 */
export function notesAsShown(notes: readonly string[], groups: GoalTargetsBlock['note_groups'], alreadySaid: readonly string[] = []): string[] {
  const said = alreadySaid.map((t) => t.trim()).filter((t) => t !== '');
  const repeats = (line: string): boolean => said.some((t) => line === t || line.endsWith(`: ${t}`));
  const out: string[] = [];
  const done = new Set<number>();
  for (const note of notes) {
    const at = (groups ?? []).findIndex((g) => g.source_notes.length > 1 && g.source_notes.includes(note));
    if (at === -1) { if (!repeats(note) && !out.includes(note)) out.push(note); continue; }
    if (done.has(at)) continue;
    done.add(at);
    const line = groups![at]!.line;
    if (!repeats(line) && !out.includes(line)) out.push(line);
  }
  return out;
}

/** The stored block as a reader may use it, or `undefined` when it is malformed (a record at odds with itself speaks for nothing). */
export function readGoalTargetsBlock(v: unknown, optionIds: readonly string[]): GoalTargetsBlock | undefined {
  if (!isGoalTargetsBlock(v, optionIds)) return undefined;
  // Optional display joins cannot change a numerical licence. An invalid/old join falls back to the original notes.
  const groups: unknown = v.note_groups;
  const joint = v.joint;
  if (groups === undefined) return v;
  if (!Array.isArray(groups)) return { ...v, note_groups: undefined };
  // ⭐ S9 (marketing widen5 bcdf70eb, judge item 2): each join is judged ON ITS OWN. Served, one group had lost its `line`, and
  // dropping EVERY group put the two retained limits' shared cause in the reply twice. A malformed group falls back to its own
  // original notes; the others stay joined (a note may belong to several causes' groups, as before).
  const kept = groups.filter((g) => isRec(g)
    && Array.isArray(g.source_notes) && g.source_notes.length > 0
    && g.source_notes.every((note) => typeof note === 'string' && v.notes?.includes(note))
    && typeof g.line === 'string' && g.line.trim() !== '' && !/[\r\n]/.test(g.line)
    && (g.joint_line === undefined || (joint.status === 'withheld' && g.joint_line === joint.line))) as NonNullable<GoalTargetsBlock['note_groups']>[number][];
  return kept.length === groups.length ? v : { ...v, note_groups: kept.length > 0 ? kept : undefined };
}

/** Every member a reader relies on, checked; a type guard, so the stored record is never cast to the block. */
function isGoalTargetsBlock(v: unknown, optionIds: readonly string[]): v is GoalTargetsBlock {
  if (!isRec(v) || !Array.isArray(v.conditions) || !Array.isArray(v.per_target) || !isRec(v.joint)) return false;
  const text = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '' && s.length <= 600 && !/[\r\n]/.test(s);
  const pcts = (m: unknown): m is Record<string, number> => isRec(m) && Object.entries(m).every(([id, x]) =>
    optionIds.includes(id) && typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 100);
  const conditions = v.conditions.filter(isRec);
  if (conditions.length !== v.conditions.length || !conditions.every((c) => text(c.constraint_id) && text(c.clause)
    && (c.role === 'target' || c.role === 'limit') && OPS.has(String(c.operator)))) return false;
  const perTarget = v.per_target.filter(isRec);
  if (perTarget.length !== v.per_target.length || !perTarget.every((t) => text(t.constraint_id) && text(t.words) && pcts(t.pct_by_option))) return false;
  const j = v.joint;
  if (j.status === 'licensed') {
    if (!text(j.words) || !pcts(j.pct_by_option) || Object.keys(j.pct_by_option).length === 0) return false;
  } else if (j.status !== 'withheld' || !text(j.line) || (j.frechet_line !== undefined && !text(j.frechet_line))) return false;
  return true;
}

export { sayDisplayedPct } from '../model-program/present/display-words.js';
