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
 *   · the status quo is never given a figure here: carrying on as now is the reference, by assumption (amendment 1).
 * Pure and total; reads only the Run's own records and the rows it sent.
 */
import { sayFigureAsWritten } from '../agent-lane/say-figure.js';
import { readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { comparatorWords, periodWords, type GoalTargetBasis } from './goal-target-basis.js';
import { displayedPctAt, displayRoundingFor, wilsonHalfWidthPoints, type GoalChanceDisplayRounding } from './goal-chance-driver.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unit01 = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;

/** The marker on a `goal_constraints` row that makes it one of the goal's TARGETS (absent = a limit, as before). */
export const GOAL_TARGET_ROLE = 'goal_target';

export type JointWithholdReason = 'not_returned' | 'precision_missing' | 'strict_not_preserved' | 'condition_not_named' | 'olumi_base' | 'no_option';

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
  readonly per_target: readonly GoalTargetChance[];
  readonly joint: GoalJoint;
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
export function jointWithheldLine(n: number, reason: JointWithholdReason): string {
  const all = n === 2 ? 'both' : 'all of them';
  if (reason === 'strict_not_preserved') return `The chance of meeting ${all} together isn’t shown: the comparison the analysis used is not the one you stated.`;
  if (reason === 'condition_not_named') return `The chance of meeting ${all} together isn’t shown: one of its conditions can’t be said in your units.`;
  if (reason === 'olumi_base') return `The chance of meeting ${all} together isn’t shown yet: it rests on Olumi’s own assumed starting value for a target, which you haven’t given.`;
  return `The chance of meeting ${all} together isn’t calculated yet.`;
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
 * The several-targets block for a Run that SENT at least one `goal_target` row, else `null` (one target: nothing changes).
 * `optionIds` are the scored options in the model's order; `statusQuoId` is excluded from every figure (amendment 1).
 */
export function goalTargetsBlockOf(args: {
  readonly envelope: unknown;
  readonly graph: unknown;
  readonly storedConstraints: unknown;
  readonly sentConstraints: unknown;
  readonly optionIds: readonly string[];
  readonly statusQuoId?: string;
  readonly basis?: GoalTargetBasis;
}): GoalTargetsBlock | null {
  const stored = Array.isArray(args.storedConstraints) ? args.storedConstraints.filter(isRec) : [];
  const sent = Array.isArray(args.sentConstraints) ? args.sentConstraints.filter(isRec) : [];
  const targetIds = new Set(stored.filter((r) => r.role === GOAL_TARGET_ROLE && typeof r.constraint_id === 'string').map((r) => r.constraint_id as string));
  if (!sent.some((r) => typeof r.constraint_id === 'string' && targetIds.has(r.constraint_id))) return null;
  const nodes = isRec(args.graph) && Array.isArray(args.graph.nodes) ? args.graph.nodes.filter(isRec) : [];
  const labelOf = (id: unknown): string | undefined => {
    const label = nodes.find((n) => n.id === id)?.label;
    return typeof label === 'string' && label.trim() !== '' && !/[\r\n]/.test(label) ? label.trim() : undefined;
  };
  const period = args.basis === undefined ? '' : ` ${periodWords(args.basis)}`;

  // Every condition the engine was sent, in the words the user stated it (strict kept). A row we cannot say is fatal to the joint.
  let unnamed = false;
  let strictLost = false;
  const conditions: GoalCondition[] = [];
  for (const row of sent) {
    const id = row.constraint_id;
    const node = row.node_id;
    const storedRow = stored.find((r) => r.constraint_id === id);
    const op = storedRow === undefined ? (typeof row.operator === 'string' && OPS.has(row.operator) ? row.operator : undefined) : statedOperator(storedRow);
    if (typeof id !== 'string' || typeof node !== 'string' || op === undefined) { unnamed = true; continue; }
    // ⛔ Ruling 16: "above 15%" must have been SENT as ">" — never scored as "at least 15%" and called "above".
    if (row.operator !== op) strictLost = true;
    const label = labelOf(node);
    const unit = typeof row.unit === 'string' && row.unit.trim() !== '' ? row.unit.trim()
      : typeof storedRow?.unit === 'string' && storedRow.unit.trim() !== '' ? storedRow.unit.trim() : undefined;
    const value = finite(storedRow?.value) ? storedRow!.value : row.value;
    const bound = comparatorWords(op);
    // A condition stated as a change, or with no unit or label, cannot be said exactly in this sentence form: the joint waits.
    const frame = storedRow?.value_frame ?? row.value_frame;
    if (label === undefined || unit === undefined || !finite(value) || bound === undefined || (frame !== undefined && frame !== 'level')) {
      unnamed = true; continue;
    }
    const role = targetIds.has(id) ? 'target' as const : 'limit' as const;
    conditions.push({
      constraint_id: id, node_id: node, role, operator: op as GoalCondition['operator'],
      value, unit, label, clause: `‘${label}’ ${role === 'target' ? 'being' : 'is'} ${bound} ${sayFigureAsWritten(value, unit)}`,
    });
  }
  const ordered = [...conditions.filter((c) => c.role === 'target'), ...conditions.filter((c) => c.role === 'limit')];
  const targets = ordered.filter((c) => c.role === 'target');
  // ⛔ Amendment 7: a LEVEL target read against OLUMI's own starting value is the most sensitive to it, and the goal's own
  // such target is withheld at admission (`admit-model.ts`, the kept guard). The same holds for every target row: its own
  // chance is not said, and the joint that includes it waits (never relabelled as the user's).
  const olumiBase = new Set(targets.filter((t) => {
    const n = nodes.find((x) => x.id === t.node_id);
    const os = isRec(n?.observed_state) ? n!.observed_state : undefined;
    return n?.kind !== 'goal' && os !== undefined && (os.source === 'cee_inference' || os.extractionType === 'inferred');
  }).map((t) => t.constraint_id));

  const records = readOptionResultSources(args.envelope).find((s) => s.length > 0) ?? [];
  const recordOf = new Map<string, Rec>();
  for (const r of records) {
    const id = optionIdOf(r);
    if (id !== undefined && !recordOf.has(id)) recordOf.set(id, r);
  }
  const compared = args.optionIds.filter((id) => id !== args.statusQuoId);

  // Each target's own chance, per option, from the same Run (never re-derived).
  const perTarget: GoalTargetChance[] = targets.flatMap((t) => {
    if (olumiBase.has(t.constraint_id)) return [];
    const pct: Record<string, number> = {};
    const rounding: Record<string, GoalChanceDisplayRounding> = {};
    for (const id of compared) {
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
    if (Object.keys(pct).length === 0) return [];
    return [{ constraint_id: t.constraint_id, words: `${t.clause}${period}`, pct_by_option: pct,
      ...(Object.keys(rounding).length > 0 ? { display_rounding_by_option: rounding } : {}) }];
  });

  const n = Math.max(ordered.length + (unnamed ? 1 : 0), 2);
  const withheld = (reason: JointWithholdReason): GoalJoint => ({
    status: 'withheld', reason, line: jointWithheldLine(n, reason),
    // Amendment 6: the bound needs each named target's own chance on the screen, for every compared option.
    ...(perTarget.length >= 2 && perTarget.length === targets.length && !unnamed && ordered.length === targets.length
      && compared.every((id) => perTarget.every((t) => Object.hasOwn(t.pct_by_option, id))) ? { frechet_line: frechetLine(targets.length) } : {}),
  });
  let joint: GoalJoint;
  if (unnamed) joint = withheld('condition_not_named');
  else if (strictLost) joint = withheld('strict_not_preserved');
  else if (olumiBase.size > 0) joint = withheld('olumi_base');
  else {
    const pct: Record<string, number> = {};
    const rounding: Record<string, GoalChanceDisplayRounding> = {};
    const missing: string[] = [];
    let anyFigure = false;
    let anyPrecisionMissing = false;
    for (const id of compared) {
      const r = recordOf.get(id);
      const p = r?.probability_of_joint_goal;
      if (!unit01(p)) { missing.push(id); continue; }
      anyFigure = true;
      // PLoT #448's name; schemas 0.83.0 also documents `joint_probability_precision` on the same entry. Same block.
      const pr = precisionOf(r!.probability_of_joint_goal_precision ?? r!.joint_probability_precision);
      // ⛔ Rulings 14 and 17: a joint figure with no joint precision is not said (never the single-goal interval reused).
      if (pr === null) { anyPrecisionMissing = true; missing.push(id); continue; }
      const step = displayRoundingFor(wilsonHalfWidthPoints(p, pr.n));
      pct[id] = displayedPctAt(p, step);
      rounding[id] = step;
    }
    if (compared.length === 0) joint = withheld('no_option');
    else if (Object.keys(pct).length === 0) joint = withheld(anyFigure && anyPrecisionMissing ? 'precision_missing' : 'not_returned');
    else {
      // Amendment 5 / ruling 22: the targets share the stated period; a limit keeps its own (annual budget) and is said after
      // "while", so the period is never read as the limit's.
      const limits = ordered.filter((c) => c.role === 'limit').map((c) => c.clause);
      const words = `${listWords(targets.map((c) => c.clause))}${period}${limits.length > 0 ? `, while ${listWords(limits)}` : ''}`;
      joint = {
        status: 'licensed', words, pct_by_option: pct,
        display_rounding_by_option: rounding, ...(missing.length > 0 ? { withheld_option_ids: missing } : {}),
      };
    }
  }
  return { conditions: ordered, per_target: perTarget, joint };
}

/** The stored block as a reader may use it, or `undefined` when it is malformed (a record at odds with itself speaks for nothing). */
export function readGoalTargetsBlock(v: unknown, optionIds: readonly string[]): GoalTargetsBlock | undefined {
  if (!isRec(v) || !Array.isArray(v.conditions) || !Array.isArray(v.per_target) || !isRec(v.joint)) return undefined;
  const text = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '' && s.length <= 600 && !/[\r\n]/.test(s);
  const pcts = (m: unknown): m is Record<string, number> => isRec(m) && Object.entries(m).every(([id, x]) =>
    optionIds.includes(id) && typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 100);
  const conditions = v.conditions.filter(isRec);
  if (conditions.length !== v.conditions.length || !conditions.every((c) => text(c.constraint_id) && text(c.clause)
    && (c.role === 'target' || c.role === 'limit') && OPS.has(String(c.operator)))) return undefined;
  const perTarget = v.per_target.filter(isRec);
  if (perTarget.length !== v.per_target.length || !perTarget.every((t) => text(t.constraint_id) && text(t.words) && pcts(t.pct_by_option))) return undefined;
  const j = v.joint;
  if (j.status === 'licensed') {
    if (!text(j.words) || !pcts(j.pct_by_option) || Object.keys(j.pct_by_option).length === 0) return undefined;
  } else if (j.status !== 'withheld' || !text(j.line) || (j.frechet_line !== undefined && !text(j.frechet_line))) return undefined;
  return v as unknown as GoalTargetsBlock;
}

/** "about 37%", "less than 1%", "more than 99%" — the screen's one edge-word rule for a displayed whole percentage. */
export function sayDisplayedPct(pct: number): string {
  return pct === 0 ? 'less than 1%' : pct === 100 ? 'more than 99%' : `about ${pct}%`;
}
