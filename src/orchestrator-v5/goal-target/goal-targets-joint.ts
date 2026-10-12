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
 *
 * ⭐ RECOVERY BATCH F (S12; DL brief 12 Oct; words pending AIE, #94 6129762547): every withhold is TRUTHFUL — the joint and
 * each target carry the cause PLoT or CEE established (PLoT's `joint_withheld`, CEE's per-row verdict, or a target whose
 * quantity had no level today on the sent graph), by code, with ONE next step that would change it (`WithholdNextStep`);
 * "run the analysis again" only for a stale or mismatched Run. No stated target is dropped silently (`withheld_targets`).
 * The joint's science is unchanged: the same conditions, the same figures, the same licence.
 * Pure and total; reads only the Run's own records and the rows it sent.
 */
import { sayFigureAsWritten } from '../agent-lane/say-figure.js';
import { readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { comparatorWords, periodWords, type GoalTargetBasis } from './goal-target-basis.js';
import { readGoalRecord } from './goal-record.js';
import { displayedPctAt, displayRoundingFor, wilsonHalfWidthPoints, type GoalChanceDisplayRounding } from './goal-chance-driver.js';
import { isOlumiEstimateValue } from '../../cee/provenance/provenance-of.js';
import {
  OLUMI_GUESS_LIMIT_REASON, PLACEHOLDER_PARTS_REASON, limitUnitsOf, placeholderPartsFinding,
} from '../../orchestrator/context/placeholder-parts.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unit01 = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;

/** The marker on a `goal_constraints` row that makes it one of the goal's TARGETS (absent = a limit, as before). */
export const GOAL_TARGET_ROLE = 'goal_target';

/**
 * ⭐ RECOVERY BATCH F (S12; DL brief 12 Oct): `limit_unscored` is PLoT's own reason, verbatim (`joint_withheld.reason`, PLoT
 * B5 `run.ts`): the engine did not score one or more of the conditions it was sent, so it returned no joint. Re-running does
 * not change that; the joint names each such condition with the cause CEE or PLoT established and its own next step.
 */
export type JointWithholdReason = 'not_returned' | 'precision_missing' | 'strict_not_preserved' | 'condition_not_named' | 'olumi_base' | 'no_option'
  | 'target_not_supported' | 'figure_not_preserved' | 'limit_unscored';

/**
 * ⭐ BATCH F: CEE's own cause for a TARGET the engine did not score while its quantity carried no level today on the graph the
 * Run SENT (a level target is tested against today's level; ISL refuses a non-root target without `observed_state.baseline`).
 */
export const TARGET_NO_LEVEL_TODAY = 'target_no_level_today';

/**
 * ⭐ BATCH F: the ONE step that would change a withheld chance, by code (never prose). `rerun_analysis` ONLY where the cause is
 * the Run itself — it did not send what is stored (a stale or mismatched Run). `none_established` where CEE knows of no step
 * the user can take that would change it (no writer exists, or the cause is the engine's alone): nothing is promised.
 */
export type WithholdNextStep =
  | 'give_goal_current_level' | 'give_starting_value' | 'give_option_levels' | 'size_link' | 'rerun_analysis' | 'none_established';

export interface WithholdNextStepRef {
  readonly code: WithholdNextStep;
  /** The quantity the step is about, by id and label (every step but `rerun_analysis` and `none_established`). */
  readonly node_id?: string;
  readonly label?: string;
  /** `size_link` only: the quantity whose effect on `node_id` is to be sized. */
  readonly from?: { readonly node_id: string; readonly label: string };
}

/** A condition the engine did not score, with the cause CEE or PLoT established (verbatim code) and its own next step. */
export interface WithheldConditionCause {
  readonly constraint_id: string;
  readonly node_id: string;
  readonly label: string;
  readonly role: 'target' | 'limit';
  /** CEE's per-row verdict reason (`constraint_verdict.perLimit`), else PLoT's `joint_withheld.reason`; or {@link TARGET_NO_LEVEL_TODAY}. */
  readonly reason: string;
  readonly next_step: WithholdNextStepRef;
}

/** ⭐ BATCH F (b): a stated target whose own chance is not shown — never dropped silently: its reason and next step, by code. */
export interface GoalTargetWithheld {
  readonly constraint_id: string;
  readonly node_id: string;
  readonly label: string;
  readonly reason: string;
  readonly next_step: WithholdNextStepRef;
  readonly line: string;
}

/**
 * ⭐ THE AIE'S WORDS (recovery Batch F, S12; AIE copy banked f-inputs/AIE-JOINT-WITHHOLD-COPY-20261012.json, sha256 685ee884…).
 * Every joint or per-target withhold sentence, and every next step, is ONE row: the AIE's sentence, byte for byte, with
 * `{slot}`s filled by identity (labels as ‘…’; a reason as its ordinary words, {@link reasonWords}, never its raw code,
 * which stays in the data). `meaning` is what the words say, kept for the reader of this table.
 */
export const JOINT_WITHHOLD_WORDS = {
  'joint.limit_unscored': { slots: ['conditions'], words: 'The chance of meeting these conditions together is not shown because this analysis could not check: {conditions}.',
    meaning: 'Meeting every condition together is not shown: the engine did not score the named conditions (PLoT joint_withheld); each is named with its reason code.' },
  'joint.not_returned': { slots: [], words: 'The chance of meeting these conditions together is not shown because this analysis returned no joint estimate and no usable explanation.',
    meaning: 'Meeting every condition together is not shown: the engine returned no joint figure and gave no reason CEE can read; no next step is known (never "run again").' },
  'joint.precision_missing': { slots: [], words: 'The chance of meeting these conditions together is not shown because this analysis did not report how precise its joint estimate is.',
    meaning: 'Meeting every condition together is not shown: the joint figure came back without its precision, so it is not said; no next step is known (never "run again").' },
  'joint.no_option': { slots: [], words: 'The chance of meeting these conditions together is not shown because no option has a usable joint result.',
    meaning: 'Meeting every condition together is not shown: no option is left to quote it for; no next step is known.' },
  'target.withheld': { slots: ['target', 'reason'], words: 'Chance not shown for {target}: {reason}.',
    meaning: 'This target’s own chance is not shown: names the target and why (its reason code; target_no_level_today = its quantity has no level today, so it cannot be tested), then its one next step.' },
  'conditions.retained_unbound': { slots: ['conditions'], words: 'Other conditions remain recorded from your brief: {conditions}; their relation to this result has not been established.',
    meaning: 'Beside several targets: the other conditions the brief states, each kept as written; CEE cannot bind them to the targets, so it claims neither that this chance includes nor that it excludes them.' },
  'next.give_goal_current_level': { slots: ['quantity'], words: 'Give the current value of {quantity}.',
    meaning: 'Next step: give today’s level of the goal’s quantity (the goal’s current-level card).' },
  'next.give_starting_value': { slots: ['quantity'], words: 'Give a starting value for {quantity}.',
    meaning: 'Next step: give today’s level of this factor yourself (the starting-value card).' },
  'next.give_option_levels': { slots: ['quantity'], words: 'Set the value or range for {quantity} in each option.',
    meaning: 'Next step: give each option’s own level (or range) for this quantity; each now rests on Olumi’s single figure.' },
  'next.size_link': { slots: ['from', 'to'], words: 'Estimate how much {from} affects {to}.',
    meaning: 'Next step: say how much the first quantity changes the second (a link Olumi sized or left unsized).' },
  'next.rerun_analysis': { slots: [], words: 'Run the analysis again to use the saved targets.',
    meaning: 'Next step: run the analysis again — said ONLY where the Run itself did not use the targets as stored (a stale or mismatched Run).' },
} as const satisfies Readonly<Record<string, { readonly slots: readonly string[]; readonly words: string; readonly meaning: string }>>;

export type JointWithholdWordsKey = keyof typeof JOINT_WITHHOLD_WORDS;

/** One row of {@link JOINT_WITHHOLD_WORDS}: the AIE's sentence, each `{slot}` filled by identity. One line. */
export function withholdWords(key: JointWithholdWordsKey, slots: Readonly<Record<string, string>> = {}): string {
  return (JOINT_WITHHOLD_WORDS[key].words as string).replace(/\{([a-z]+)\}/g, (_, s: string) => (slots[s] ?? '').replace(/[\r\n]+/g, ' '));
}

/**
 * A reason code in ordinary words (AIE copy, binding guards 1–2): the AIE's own words for the codes it named; the existing
 * withheld sentence's own clause for the Run-mismatch and Olumi-base codes; else the AIE's neutral line. The code itself is
 * never said; it stays in the record (`reason`).
 */
export const KNOWN_REASON_WORDS: Readonly<Record<string, string>> = {
  target_no_level_today: 'this analysis has no starting value for the quantity',
  parts_identity_unmodelled: 'the model does not yet represent how its component values add up',
  limit_rests_on_olumi_guess: 'at least one required input is an unconfirmed estimate from Olumi',
  limit_unscored: 'this analysis could not evaluate the condition',
  not_returned: 'this analysis returned no usable estimate for this target',
  target_not_supported: 'this analysis cannot represent the target as stated',
  strict_not_preserved: 'the comparison the analysis used is not the one you stated',
  figure_not_preserved: 'this analysis did not use every stated target as specified',
  olumi_base: 'it rests on Olumi’s own assumed starting value for a target, which you haven’t given',
};
export const NEUTRAL_REASON_WORDS = 'the returned result could not be used for this target';
export function reasonWords(code: string): string {
  return Object.hasOwn(KNOWN_REASON_WORDS, code) ? KNOWN_REASON_WORDS[code]! : NEUTRAL_REASON_WORDS;
}

/** The words of ONE next step (a placeholder), or '' when none is established — nothing is promised. */
export function nextStepWords(next: WithholdNextStepRef | undefined): string {
  if (next === undefined || next.code === 'none_established') return '';
  if (next.code === 'rerun_analysis') return withholdWords('next.rerun_analysis');
  const quantity = next.label === undefined ? '' : `‘${next.label}’`;
  if (next.code === 'size_link') {
    // A step whose quantity cannot be named promises nothing (binding guard 3: only a supported writer and a useful input).
    if (next.from === undefined || quantity === '') return '';
    return withholdWords('next.size_link', { from: `‘${next.from.label}’`, to: quantity });
  }
  return quantity === '' ? '' : withholdWords(`next.${next.code}`, { quantity });
}

const NONE: WithholdNextStepRef = { code: 'none_established' };
const RERUN: WithholdNextStepRef = { code: 'rerun_analysis' };
/** A stored line a reader still accepts (`isGoalTargetsBlock`: ≤ 600 characters, one line). */
const LINE_MAX = 600;
/**
 * ⛔ NEVER A SILENT SLICE (AIE copy, binding guard 8): the first variant that fits, whole. A next step that does not fit is
 * left out of the line (it stays in `next_step`), never cut off; the full per-condition state stays in `causes`.
 */
function fitLine(variants: readonly string[]): string {
  const fits = variants.find((s) => s.length <= LINE_MAX);
  if (fits !== undefined) return fits;
  // Only a label longer than the line itself reaches here (labels are ≤ 600): its words end at a word, marked, never mid-word.
  const last = variants[variants.length - 1]!;
  return `${last.slice(0, LINE_MAX - 1).replace(/\s+\S*$/u, '')}…`;
}

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
  | { readonly status: 'withheld'; readonly reason: JointWithholdReason; readonly line: string; readonly frechet_line?: string;
      /** Batch F: the ONE next step (absent only on a block stored before Batch F). */
      readonly next_step?: WithholdNextStepRef;
      /** Batch F, `limit_unscored`: every condition the engine named as unscored, in the joint's order (targets, then limits). */
      readonly causes?: readonly WithheldConditionCause[] };

export interface GoalTargetsBlock {
  readonly conditions: readonly GoalCondition[];
  /**
   * AIE C clause 3 (12 Oct): the labels of the goal's targets this analysis cannot yet combine (a target stated as a
   * change, including the goal's own). They are kept and named; the joint is withheld with `target_not_supported`.
   */
  readonly unsupported_targets?: readonly string[];
  readonly per_target: readonly GoalTargetChance[];
  /** Batch F (b): every stated target NOT in `per_target`, with its reason and next step — no target is dropped silently. */
  readonly withheld_targets?: readonly GoalTargetWithheld[];
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

/**
 * The Run's one joint-withheld sentence (DL scope decision 2's words, kept for both and for more), followed by its ONE next
 * step's words (Batch F). ⛔ Batch F: "Run the analysis again" is said ONLY where the cause is the Run itself (a stale or
 * mismatched Run: `strict_not_preserved`, `figure_not_preserved`); every other reason says what CEE or PLoT established
 * (words pending AIE: {@link JOINT_WITHHOLD_WORDS}) and promises no step it does not know.
 */
export function jointWithheldLine(n: number, reason: JointWithholdReason, unsupported: readonly string[] = [],
  /** The clauses of the targets whose own chance waits with the joint (strictness not kept, r1 item 4). */
  strictLost: readonly string[] = [],
  /** Batch F: the conditions the engine did not score (`limit_unscored`) and the ONE next step (default: none established). */
  f: { readonly causes?: readonly WithheldConditionCause[]; readonly next?: WithholdNextStepRef } = {}): string {
  const next = nextStepWords(f.next);
  const variants = jointReasonVariants(n, reason, unsupported, strictLost, f.causes ?? []);
  return fitLine([...(next === '' ? [] : [`${variants[0]} ${next}`]), ...variants]);
}

/** The joint's reason sentence, then (for a long list of unscored conditions) the same sentence naming them without reasons. */
function jointReasonVariants(n: number, reason: JointWithholdReason, unsupported: readonly string[], strictLost: readonly string[],
  causes: readonly WithheldConditionCause[]): string[] {
  if (reason === 'limit_unscored') {
    return [withholdWords('joint.limit_unscored', { conditions: listWords(causes.map((c) => `‘${c.label}’ (${reasonWords(c.reason)})`)) }),
      withholdWords('joint.limit_unscored', { conditions: listWords(causes.map((c) => `‘${c.label}’`)) })];
  }
  return [jointReasonWords(n, reason, unsupported, strictLost)];
}

function jointReasonWords(n: number, reason: JointWithholdReason, unsupported: readonly string[], strictLost: readonly string[]): string {
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
  if (reason === 'condition_not_named') return `The chance of meeting ${all} together isn’t shown: one of its conditions can’t be said in your units.`;
  if (reason === 'olumi_base') return `The chance of meeting ${all} together isn’t shown yet: it rests on Olumi’s own assumed starting value for a target, which you haven’t given.`;
  // ⛔ Batch F: a figure without its precision, and no figure with no reason, are NOT cured by running again: no step is promised.
  if (reason === 'precision_missing') return withholdWords('joint.precision_missing');
  if (reason === 'no_option') return withholdWords('joint.no_option');
  return withholdWords('joint.not_returned');
}

/** Batch F (b): one stated target's own withheld line — its label, its reason in ordinary words and its ONE next step. */
export function targetWithheldLine(label: string, reason: string, next: WithholdNextStepRef): string {
  const why = withholdWords('target.withheld', { target: `‘${label}’`, reason: reasonWords(reason) });
  const step = nextStepWords(next);
  return fitLine(step === '' ? [why] : [`${why} ${step}`, why]);
}

/** Batch F (c): the brief's other conditions beside several targets, each kept as written, claimed neither in nor out. */
export function retainedConditionsLine(conditions: readonly string[]): string | undefined {
  return conditions.length === 0 ? undefined : withholdWords('conditions.retained_unbound', { conditions: conditions.join('; ') });
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
  /** Batch F: CEE's per-row verdicts for this Run (`constraint_verdict.perLimit`: every row it ratified, targets included). */
  readonly limitVerdicts?: unknown;
  /** Batch F: the graph the Run SENT (its run-time level carriers), where a target's level today is read. Absent: not read. */
  readonly sentGraph?: unknown;
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
  const strictLostIds = new Set<string>();
  // ⛔ Re-scope r1 (DL item 3): a row whose SENT figure is not the stored one was scored on another threshold — the joint and
  // that condition's own chance wait, with that reason; the stored figure is never described as what was analysed.
  const figureLostIds = new Set<string>();
  const conditions: GoalCondition[] = [];
  // AIE C clause 3: a target kept in its own (change) frame is named here, never forced into a level clause.
  const unsupported: string[] = [];
  // Batch F (b): the same targets by identity, so each still gets its own withheld line.
  const unsupportedRows: { constraint_id: string; node_id: string; label: string }[] = [];
  for (const row of sent) {
    const id = row.constraint_id;
    const node = row.node_id;
    const storedRow = stored.find((r) => r.constraint_id === id);
    const op = storedRow === undefined ? (typeof row.operator === 'string' && OPS.has(row.operator) ? row.operator : undefined) : statedOperator(storedRow);
    if (typeof id !== 'string' || typeof node !== 'string' || op === undefined) { unnamed = true; continue; }
    // ⛔ Ruling 16: "above 15%" must have been SENT as ">" — never scored as "at least 15%" and called "above". The joint
    // waits, and so does THIS condition's own chance (independent check r1 item 4): its marginal was scored on the sent bound.
    if (row.operator !== op) { strictLost = true; strictLostIds.add(id); }
    // ⛔ RE-SCOPE 2 (R5-4; AIE open 2): EXACT finite agreement, in the same unit and frame, from the same caller snapshot —
    // never a unit-dependent tolerance (`1e-9 × max(1, |v|)` was not an attested representation equality: 15 + 1e-12 is
    // another figure). A row whose sent unit or frame differs from the stored one was scored on another quantity reading.
    const differs = (k: 'unit' | 'value_frame'): boolean => typeof row[k] === 'string' && typeof storedRow?.[k] === 'string' && row[k] !== storedRow[k];
    if (storedRow !== undefined && finite(storedRow.value)
      && (!(finite(row.value) && row.value === storedRow.value) || differs('unit') || differs('value_frame'))) figureLostIds.add(id);
    const label = labelOf(node);
    const unit = typeof row.unit === 'string' && row.unit.trim() !== '' ? row.unit.trim()
      : typeof storedRow?.unit === 'string' && storedRow.unit.trim() !== '' ? storedRow.unit.trim() : undefined;
    const value = finite(storedRow?.value) ? storedRow!.value : row.value;
    const bound = comparatorWords(op);
    // A condition stated as a change, or with no unit or label, cannot be said exactly in this sentence form: the joint waits.
    const frame = storedRow?.value_frame ?? row.value_frame;
    if (targetIds.has(id) && label !== undefined && frame !== undefined && frame !== 'level') {
      unsupported.push(label);
      unsupportedRows.push({ constraint_id: id, node_id: node, label });
      continue;
    }
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
  const olumiBase = new Set(targets.filter((t) => {
    const n = nodes.find((x) => x.id === t.node_id);
    const os = isRec(n?.observed_state) ? n!.observed_state : undefined;
    return n?.kind !== 'goal' && os !== undefined && isOlumiEstimateValue(os);
  }).map((t) => t.constraint_id));

  const records = (isRec(args.envelope) ? readOptionResultSources(args.envelope) : []).find((s) => s.length > 0) ?? [];
  const recordOf = new Map<string, Rec>();
  for (const r of records) {
    const id = optionIdOf(r);
    if (id !== undefined && !recordOf.has(id)) recordOf.set(id, r);
  }
  const sq = args.statusQuo;
  const compared = args.optionIds.filter((id) => !(sq?.fromJoint === true && id === sq.id));
  const comparedFor = (constraintId: string): string[] => args.optionIds.filter((id) => !(sq?.fromTargets.has(constraintId) === true && id === sq.id));

  // ⭐ BATCH F (W1): what the engine and CEE ESTABLISHED about each sent condition the engine did not score. PLoT names them
  // (`joint_withheld`, B5: no joint while any sent condition is unscored); CEE's per-row verdict says why, by its ranked code.
  const plotWithheld = isRec(args.envelope) && isRec(args.envelope.joint_withheld) ? args.envelope.joint_withheld : undefined;
  const plotReason = typeof plotWithheld?.reason === 'string' && plotWithheld.reason.trim() !== '' ? plotWithheld.reason.trim() : 'limit_unscored';
  const plotUnscored = new Set(Array.isArray(plotWithheld?.constraint_ids)
    ? plotWithheld.constraint_ids.filter((x): x is string => typeof x === 'string' && x !== '') : []);
  const verdicts = new Map((Array.isArray(args.limitVerdicts) ? args.limitVerdicts.filter(isRec) : [])
    .filter((v) => typeof v.constraint_id === 'string').map((v) => [v.constraint_id as string, v] as const));
  const cee = (id: string): string | undefined => {
    const v = verdicts.get(id);
    return v?.state === 'unscored' && typeof v.reason === 'string' && v.reason.trim() !== '' ? v.reason.trim() : undefined;
  };
  const sentNodes = isRec(args.sentGraph) && Array.isArray(args.sentGraph.nodes) ? args.sentGraph.nodes.filter(isRec) : undefined;
  const sentEdges = isRec(args.sentGraph) && Array.isArray(args.sentGraph.edges) ? args.sentGraph.edges.filter(isRec) : [];
  /**
   * On the graph the Run SENT: a non-root node (an in-edge from a node that is not an option or the decision) carrying NO level
   * at all (no baseline, value or raw value). A node that holds a level the carrier did not send keeps the engine's own code.
   */
  const noLevelToday = (nodeId: string): boolean => {
    if (sentNodes === undefined) return false;
    const n = sentNodes.find((x) => x.id === nodeId);
    const os = isRec(n?.observed_state) ? n!.observed_state : undefined;
    if (n === undefined || (os !== undefined && (finite(os.baseline) || finite(os.value) || finite(os.raw_value)))) return false;
    return sentEdges.some((e) => e.to === nodeId && sentNodes.some((x) => x.id === e.from && x.kind !== 'option' && x.kind !== 'decision'));
  };
  const nodeOf = (id: string): Rec | undefined => nodes.find((x) => x.id === id);
  /** The step that gives a quantity its level today — only where a writer exists (the goal's, or a factor's starting value). */
  const levelStep = (nodeId: string): WithholdNextStepRef => {
    const n = nodeOf(nodeId);
    const label = labelOf(nodeId);
    if (label === undefined) return NONE;
    return n?.kind === 'goal' ? { code: 'give_goal_current_level', node_id: nodeId, label }
      : n?.kind === 'factor' ? { code: 'give_starting_value', node_id: nodeId, label } : NONE;
  };
  /** A per-row reason's ONE step, read off the SAME predicate the verdict used (`placeholderPartsFinding`, first option's arm). */
  const reasonStep = (reason: string, nodeId: string): WithholdNextStepRef => {
    if (reason !== OLUMI_GUESS_LIMIT_REASON && reason !== PLACEHOLDER_PARTS_REASON) return NONE;
    const label = labelOf(nodeId);
    if (label === undefined) return NONE;
    try {
      const options = nodes.filter((n) => n.kind === 'option');
      const edges = isRec(args.graph) && Array.isArray(args.graph.edges) ? args.graph.edges.filter(isRec) : [];
      const units = limitUnitsOf(stored);
      for (const o of options) {
        const f = placeholderPartsFinding(nodeId, nodes, edges, [o], units);
        if (f === null || f.reason !== reason) continue;
        if (f.arm === 'link') {
          const fromId = f.arm === 'link' ? f.link?.from : f.partId;
          const toId = f.arm === 'link' ? f.link?.to : nodeId;
          const [fromLabel, toLabel] = [labelOf(fromId), labelOf(toId)];
          return typeof fromId === 'string' && typeof toId === 'string' && fromLabel !== undefined && toLabel !== undefined
            ? { code: 'size_link', node_id: toId, label: toLabel, from: { node_id: fromId, label: fromLabel } } : NONE;
        }
        if (f.arm === 'level') return levelStep(nodeId);
        if (f.arm === 'point') return { code: 'give_option_levels', node_id: nodeId, label };
        return NONE;
      }
    } catch {
      // A failure costs the step, never the reason: nothing is promised.
    }
    return NONE;
  };
  /** The cause of ONE condition the engine did not score (PLoT names it, or CEE's verdict does), else undefined. */
  const causeOf = (c: { constraint_id: string; node_id: string; label: string; role: 'target' | 'limit' }, frame: unknown): WithheldConditionCause | undefined => {
    const engine = cee(c.constraint_id) ?? (plotUnscored.has(c.constraint_id) ? plotReason : undefined);
    if (engine === undefined) return undefined;
    // A level target tested against a quantity that carried no level today on the sent graph: said as THAT, naming the quantity.
    if (c.role === 'target' && (frame === undefined || frame === 'level') && noLevelToday(c.node_id)) {
      return { ...c, reason: TARGET_NO_LEVEL_TODAY, next_step: levelStep(c.node_id) };
    }
    return { ...c, reason: engine, next_step: reasonStep(engine, c.node_id) };
  };
  const frameOf = (id: string): unknown => stored.find((r) => r.constraint_id === id)?.value_frame ?? sent.find((r) => r.constraint_id === id)?.value_frame;
  /** The joint's ONE next step: the first established step among its causes, in the joint's order. */
  const firstStep = (causes: readonly WithheldConditionCause[]): WithholdNextStepRef =>
    causes.find((x) => x.next_step.code !== 'none_established')?.next_step ?? NONE;

  // Each target's own chance, per option, from the same Run (never re-derived).
  const perTarget: GoalTargetChance[] = targets.flatMap((t) => {
    if (olumiBase.has(t.constraint_id) || strictLostIds.has(t.constraint_id) || figureLostIds.has(t.constraint_id)) return [];
    const pct: Record<string, number> = {};
    const rounding: Record<string, GoalChanceDisplayRounding> = {};
    for (const id of comparedFor(t.constraint_id)) {
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

  // ⭐ BATCH F (b, W2): EVERY stated target not said above gets its own line — its reason and ONE next step, by identity. Never
  // a silent drop: a mismatched Run (strictness or figure not sent as stored, or not sent) says to run it again; Olumi's own
  // starting value says whose figure is missing; an unscored target says what the engine or CEE established.
  const shownIds = new Set(perTarget.map((t) => t.constraint_id));
  const withheldTargets: GoalTargetWithheld[] = [];
  const withholdTarget = (who: { constraint_id: string; node_id: string; label: string }, reason: string, next: WithholdNextStepRef): void => {
    withheldTargets.push({ ...who, reason, next_step: next, line: targetWithheldLine(who.label, reason, next) });
  };
  for (const t of targets) {
    if (shownIds.has(t.constraint_id)) continue;
    const who = { constraint_id: t.constraint_id, node_id: t.node_id, label: t.label };
    // AIE copy, binding guard 5: "run again" only where a fresh request is established to test the saved targets. It is:
    // the current sender (`wireGoalConstraints`) sends each stored target's stated comparator and figure as stored, so a Run
    // whose request did not was built before them (stale), and a fresh one tests them (pinned in batch-f-joint-withhold).
    if (strictLostIds.has(t.constraint_id)) withholdTarget(who, 'strict_not_preserved', RERUN);
    else if (figureLostIds.has(t.constraint_id)) withholdTarget(who, 'figure_not_preserved', RERUN);
    else if (olumiBase.has(t.constraint_id)) withholdTarget(who, 'olumi_base', levelStep(t.node_id));
    else {
      const cause = causeOf({ ...who, role: 'target' }, frameOf(t.constraint_id));
      withholdTarget(who, cause?.reason ?? 'not_returned', cause?.next_step ?? NONE);
    }
  }
  for (const u of unsupportedRows) withholdTarget(u, 'target_not_supported', NONE);
  for (const r of unsentTargets) {
    const label = labelOf(r.node_id);
    if (typeof r.node_id === 'string' && label !== undefined) withholdTarget({ constraint_id: r.constraint_id as string, node_id: r.node_id, label }, 'figure_not_preserved', RERUN);
  }

  const n = Math.max(ordered.length + unsupported.length + unsentTargets.length + (unnamed ? 1 : 0), 2);
  const withheld = (reason: JointWithholdReason, f: { readonly causes?: readonly WithheldConditionCause[]; readonly next?: WithholdNextStepRef } = {}): GoalJoint => {
    // The first olumi-base target's level step; else what was given.
    const next = reason === 'olumi_base' ? (() => { const t = targets.find((x) => olumiBase.has(x.constraint_id)); return t === undefined ? NONE : levelStep(t.node_id); })()
        : f.next ?? NONE;
    return {
      status: 'withheld', reason,
      line: jointWithheldLine(n, reason, unsupported, targets.filter((t) => (reason === 'figure_not_preserved' ? figureLostIds : strictLostIds)
        .has(t.constraint_id)).map((t) => t.clause), { ...(f.causes !== undefined ? { causes: f.causes } : {}), next }),
      // Amendment 6: the bound needs each named target's own chance on the screen, for every compared option.
      ...(perTarget.length >= 2 && perTarget.length === targets.length && !unnamed && unsupported.length === 0 && unsentTargets.length === 0
        && ordered.length === targets.length
        && compared.every((id) => perTarget.every((t) => Object.hasOwn(t.pct_by_option, id))) ? { frechet_line: frechetLine(targets.length) } : {}),
      next_step: next,
      ...(f.causes !== undefined && f.causes.length > 0 ? { causes: f.causes } : {}),
    };
  };
  let joint: GoalJoint;
  if (unsupported.length > 0) joint = withheld('target_not_supported');
  else if (unnamed) joint = withheld('condition_not_named');
  else if (strictLost) joint = withheld('strict_not_preserved');
  else if (figureLostIds.size > 0 || unsentTargets.length > 0) joint = withheld('figure_not_preserved');
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
      // DL contract ruling 1 (12 Oct): PLoT's wire name ONLY (schemas 0.83.0 renamed to match); no other name is a fallback.
      const pr = precisionOf(r!.probability_of_joint_goal_precision);
      // ⛔ Rulings 14 and 17: a joint figure with no joint precision is not said (never the single-goal interval reused).
      if (pr === null) { anyPrecisionMissing = true; missing.push(id); continue; }
      const step = displayRoundingFor(wilsonHalfWidthPoints(p, pr.n));
      pct[id] = displayedPctAt(p, step);
      rounding[id] = step;
    }
    // ⛔ Batch F (W1): PLoT's own reason for returning no joint — the conditions it names, each with its established cause.
    const causes = ordered.flatMap((c) => {
      if (!plotUnscored.has(c.constraint_id)) return [];
      const cause = causeOf({ constraint_id: c.constraint_id, node_id: c.node_id, label: c.label, role: c.role }, frameOf(c.constraint_id));
      return cause === undefined ? [] : [cause];
    });
    if (compared.length === 0) joint = withheld('no_option');
    else if (Object.keys(pct).length === 0 && !anyFigure && causes.length > 0) joint = withheld('limit_unscored', { causes, next: firstStep(causes) });
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
  return { conditions: ordered, per_target: perTarget, ...(withheldTargets.length > 0 ? { withheld_targets: withheldTargets } : {}), joint,
    ...(unsupported.length > 0 ? { unsupported_targets: unsupported } : {}) };
}

/** The stored block as a reader may use it, or `undefined` when it is malformed (a record at odds with itself speaks for nothing). */
export function readGoalTargetsBlock(v: unknown, optionIds: readonly string[]): GoalTargetsBlock | undefined {
  return isGoalTargetsBlock(v, optionIds) ? v : undefined;
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
  // Batch F: a stored next step, cause or withheld target is read only when every member a reader relies on is well formed.
  const step = (s: unknown): boolean => isRec(s) && typeof s.code === 'string' && NEXT_STEPS.has(s.code)
    && (s.label === undefined || text(s.label)) && (s.node_id === undefined || text(s.node_id));
  if (v.withheld_targets !== undefined && !(Array.isArray(v.withheld_targets) && v.withheld_targets.every((t) => isRec(t)
    && text(t.constraint_id) && text(t.label) && text(t.reason) && text(t.line) && step(t.next_step)))) return false;
  const j = v.joint;
  if (j.status === 'licensed') {
    if (!text(j.words) || !pcts(j.pct_by_option) || Object.keys(j.pct_by_option).length === 0) return false;
  } else if (j.status !== 'withheld' || !text(j.line) || (j.frechet_line !== undefined && !text(j.frechet_line))
    || (j.next_step !== undefined && !step(j.next_step))
    || (j.causes !== undefined && !(Array.isArray(j.causes) && j.causes.every((c) => isRec(c) && text(c.constraint_id) && text(c.label)
      && text(c.reason) && step(c.next_step))))) return false;
  return true;
}

const NEXT_STEPS: ReadonlySet<string> = new Set<WithholdNextStep>([
  'give_goal_current_level', 'give_starting_value', 'give_option_levels', 'size_link', 'rerun_analysis', 'none_established']);

/** "about 37%", "less than 1%", "more than 99%" — the screen's one edge-word rule for a displayed whole percentage. */
export function sayDisplayedPct(pct: number): string {
  return pct === 0 ? 'less than 1%' : pct === 100 ? 'more than 99%' : `about ${pct}%`;
}
