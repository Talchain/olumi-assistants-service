/**
 * ⭐ RECOVERY BATCH C — WHAT THE GOAL'S TARGET IS MEASURED AGAINST (Batch 0 change-goal decision, rulings 1–14 and 18–23;
 * science review 2 amendments 1–7; `BATCH0-CHANGE-GOAL-DECISION.md`).
 *
 * A chance of meeting a target is only a chance of meeting THE USER'S target when five things are stated and agree: the
 * frame (a level, or a change from today), the reference (today, or the launch), the denominator (what 100% is, for a
 * percentage change), the period (the target is met at month N, or over the first N months), and the unit every option's
 * effect on the goal is stated in. The drafter states them (ruling 11); admission validates them HERE and stores Olumi's
 * reading on the goal (`goal_target_basis`, CEE-only, declared on `NodeV3`); the licence reads them back from the graph
 * the Run scored. A basis whose target has since been edited is stale and reads as absent (never re-applied).
 *
 * WHAT A BASIS LICENSES, AND WHAT IT DOES NOT:
 *   · a change target with no level today (hiring: "+10% productivity" on a `quantity_frame: 'change'` goal, ruling 2–5):
 *     admitted without a base once the denominator, period and effect unit are stated (ISL scores the paired change);
 *   · "at three months" in the sentence only when the period is stated and every effect is stated AT the period's end,
 *     including recruitment and ramp-up (amendment 2). A held horizon without that basis is still withheld
 *     (`goal-horizon-verdict.ts`); steady state is never assumed;
 *   · an ambiguous target ("+10%": points of capacity, or 10% of today's?) is never resolved by picking (amendment 3):
 *     the question is stored and the chance is withheld with it.
 * Pure and total.
 */
import { sayFigureAsWritten } from '../agent-lane/say-figure.js';
import { readGoalRecord } from './goal-record.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const words = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(/\s+/g, ' ');
  return t !== '' && t.length <= max && !/[\r\n<>{}]/.test(t) ? t : undefined;
};

export const BASIS_TEXT_MAX = 120;
export const BASIS_QUESTION_MAX = 300;
/**
 * ⛔ RECOVERY BATCH C RE-SCOPE (DL after independent check r2, BLOCKING 2; re-scope check r1, BLOCKING 1): ONE RULE — a goal
 * condition the drafter retained is NEVER silently dropped and NEVER changed. Up to `BASIS_ALSO_REQUIRED_MAX` are kept, every
 * one (six in → six everywhere), each BYTE-FOR-BYTE as drafted from the user's words: its comparison ("> 15%", "<= £200,000",
 * "= 12"), its figure, its period and its reference are the drafter's own characters, never cut, re-spaced or filtered. A
 * condition that cannot be kept so — more than one line, or longer than `BASIS_CONDITION_MAX` — refuses the WHOLE reading
 * with its reason (`'condition_text'`), as more conditions than the maximum do (`'conditions'`).
 */
export const BASIS_ALSO_REQUIRED_MAX = 20;
export const BASIS_CONDITION_MAX = 500;

type ConditionVerdict = { readonly kind: 'blank' } | { readonly kind: 'unkeepable' } | { readonly kind: 'kept'; readonly text: string };

/**
 * One retained condition's verdict: kept exactly; `blank` (null or whitespace only — no condition at all); or not keepable
 * faithfully (not text, more than one line, or too long).
 */
function conditionVerdict(v: unknown): ConditionVerdict {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return { kind: 'blank' };
  // eslint-disable-next-line no-control-regex
  if (typeof v !== 'string' || v.length > BASIS_CONDITION_MAX || /[\u0000-\u001f\u007f\u2028\u2029]/.test(v)) return { kind: 'unkeepable' };
  return { kind: 'kept', text: v };
}

/** Every retained condition exactly as drafted, or why the reading cannot keep them all faithfully. */
function conditionsOf(v: unknown): { readonly kept: string[] } | { readonly refused: 'conditions' | 'condition_text' } {
  if (!Array.isArray(v)) return { kept: [] };
  const verdicts = v.map(conditionVerdict).filter((x) => x.kind !== 'blank');
  if (verdicts.length > BASIS_ALSO_REQUIRED_MAX) return { refused: 'conditions' };
  const kept = verdicts.flatMap((x) => (x.kind === 'kept' ? [x.text] : []));
  return kept.length === verdicts.length ? { kept } : { refused: 'condition_text' };
}

/** How many conditions a drafted (or stored) basis retains (each non-blank text), kept or not. */
export function goalConditionCount(basis: unknown): number {
  return isRec(basis) && Array.isArray(basis.also_required) ? basis.also_required.filter((x) => conditionVerdict(x).kind !== 'blank').length : 0;
}

/** The drafter's statement of the target's semantics (`buildCandidateSchema` `goal.basis`). Every member is required in what is sent. */
export interface DraftedGoalTargetBasis {
  readonly reference: 'today' | 'launch';
  readonly denominator: string | null;
  readonly period_months: number | null;
  readonly period_kind: 'at_end' | 'over_period';
  readonly effect_unit: string | null;
  readonly effects_at_period_end: boolean;
  readonly also_required: readonly string[] | null;
  readonly open_question: string | null;
}

/** Olumi's validated reading, stored on the goal node. The three `target_*`/`quantity_frame` members are its staleness key. */
export interface GoalTargetBasis {
  readonly quantity_frame: 'level' | 'change';
  readonly target_frame: 'level' | 'change_abs' | 'change_rel';
  readonly target_raw: number;
  readonly reference: 'today' | 'launch';
  readonly denominator?: string;
  readonly period_months: number;
  readonly period_kind: 'at_end' | 'over_period';
  readonly effect_unit: string;
  readonly effects_at_period_end: boolean;
  /** The other conditions the user stated with this target that this chance does not include (amendment 4). */
  readonly also_required?: readonly string[];
  /** Amendment 3: the target can be read more than one way; this asks which. While present, no chance is shown. */
  readonly open_question?: string;
  readonly source: 'olumi_reading';
}

/** The stored reading while its period waits for the user's confirmed deadline (DL ruling 14 Oct): every other member admitted. */
export type GoalTargetBasisAwaitingPeriod = Omit<GoalTargetBasis, 'period_months'>;

/**
 * ⭐ DL ruling 14 Oct (hiring): the drafter's reading with its period left UNSTATED (null), no drafted deadline, and every other
 * member valid, is kept WITHOUT a period instead of being dropped whole. It speaks only once the user confirms a deadline
 * (its held months supply the period in `goalTargetBasisOf`); until then it reads as absent, exactly as
 * today, and construction still says the target needs "when the target must be met". An invalid period (0, 200, 2.5) is
 * still refused. Served hiring 14 Oct (drafter rows 14:54Z/15:36Z): the same request that held "3" 24 times sent null.
 */
export function admitGoalTargetBasisAwaitingPeriod(args: Parameters<typeof admitGoalTargetBasis>[0]): GoalTargetBasisAwaitingPeriod | undefined {
  const d = args.drafted;
  if (!isRec(d) || (d.period_months !== null && d.period_months !== undefined) || finite(args.horizonMonths)) return undefined;
  // Every other member is validated by the one admission, exactly as drafted; the period is then left out.
  const checked = admitGoalTargetBasis({ ...args, drafted: { ...d, period_months: 1 }, horizonMonths: undefined });
  if (!('basis' in checked) || checked.basis === null) return undefined;
  const { period_months: _period, ...rest } = checked.basis;
  return rest;
}

export type GoalTargetBasisRefusal = 'reference' | 'denominator' | 'period' | 'period_conflict' | 'effect_unit' | 'frame' | 'conditions'
  | 'condition_text';

/**
 * Validate the drafter's basis for a goal target (ruling 11). `null` basis → `{ basis: null }` (no reading; every older
 * candidate). A refusal names the missing or invalid member; the caller says it and writes no threshold for a target that
 * needs the basis (a change with no level today).
 */
export function admitGoalTargetBasis(args: {
  readonly drafted: DraftedGoalTargetBasis | null | undefined;
  readonly quantityFrame: 'level' | 'change';
  readonly targetFrame: 'level' | 'change_abs' | 'change_rel';
  readonly targetRaw: number;
  readonly horizonMonths: number | null | undefined;
}): { readonly basis: GoalTargetBasis | null } | { readonly refused: GoalTargetBasisRefusal } {
  const d = args.drafted;
  if (d === null || d === undefined || !isRec(d)) return { basis: null };
  if (d.reference !== 'today' && d.reference !== 'launch') return { refused: 'reference' };
  // A change of a change quantity is only ever its own change in its own units (the contract: no change_rel on `change`).
  if (args.quantityFrame === 'change' && args.targetFrame !== 'change_abs') return { refused: 'frame' };
  const change = args.targetFrame !== 'level';
  const denominator = words(d.denominator, BASIS_TEXT_MAX);
  // ⛔ A change with no stated denominator is still refused (ruling 9): "10%" of nothing named is not a target.
  if (change && denominator === undefined) return { refused: 'denominator' };
  const period = d.period_months;
  if (!finite(period) || !Number.isInteger(period) || period < 1 || period > 120) return { refused: 'period' };
  if (finite(args.horizonMonths) && args.horizonMonths !== period) return { refused: 'period_conflict' };
  const effectUnit = words(d.effect_unit, BASIS_TEXT_MAX);
  if (effectUnit === undefined) return { refused: 'effect_unit' };
  // Every retained condition, exactly as drafted, or the whole reading refused with its reason — never a subset, never changed.
  const conditions = conditionsOf(d.also_required);
  if ('refused' in conditions) return { refused: conditions.refused };
  const also = conditions.kept;
  const question = words(d.open_question, BASIS_QUESTION_MAX);
  return { basis: {
    quantity_frame: args.quantityFrame,
    target_frame: args.targetFrame,
    target_raw: args.targetRaw,
    reference: d.reference,
    ...(change && denominator !== undefined ? { denominator } : {}),
    period_months: period,
    period_kind: d.period_kind === 'over_period' ? 'over_period' : 'at_end',
    effect_unit: effectUnit,
    effects_at_period_end: d.effects_at_period_end === true,
    ...(also.length > 0 ? { also_required: also } : {}),
    ...(question !== undefined ? { open_question: question } : {}),
    source: 'olumi_reading',
  } };
}

/**
 * ⛔ RE-SCOPE 2 (R5-5; AIE e58 handback, text simplification): the unsupported-condition face. A reading refused because its
 * conditions cannot all be kept whole says only that — never the implementation's bounds (how many, how long, one line),
 * which would have the person reformat conditions the drafter may have written. The bounds stay in validation
 * (`BASIS_ALSO_REQUIRED_MAX`, `BASIS_CONDITION_MAX`, `conditionsOf`) and in the refusal code (`conditions` / `condition_text`).
 */
export function unsupportedConditionWords(metric: string): string {
  return `No chance of meeting the target for ‘${metric}’ is shown yet: ${CONDITIONS_NOT_KEPT}`;
}

/**
 * ⛔ RE-SCOPE 2 (R5-5 (a); DL ruling): the AIE's reason, VERBATIM — the ONE value admission writes into the stored reading's
 * `open_question` when the reading is refused because its conditions cannot all be kept whole (`conditions` /
 * `condition_text`), so that the refusal survives save → cold reopen in an existing persisted field: the licence withholds on
 * any `open_question` (amendment 3), and the open-question gate says THIS sentence — never "can be read more than one way",
 * never a question whose answer is claimed to restore a chance. The rejected conditions' own text is NOT kept (no new store:
 * an OPEN residual, DL 12 Oct).
 */
export const CONDITIONS_NOT_KEPT = 'Olumi cannot keep every additional condition intact in this analysis.';

/**
 * The persisted reason for a reading refused for its conditions: the same validated reading WITHOUT any condition (every other
 * member was valid — conditions are checked last), carrying `CONDITIONS_NOT_KEPT` as its `open_question`. `undefined` for any
 * other verdict: only this refusal writes it.
 */
export function conditionsRefusedBasis(
  args: Parameters<typeof admitGoalTargetBasis>[0], verdict: { readonly refused: GoalTargetBasisRefusal } | { readonly basis: unknown },
): GoalTargetBasis | undefined {
  if (!('refused' in verdict) || (verdict.refused !== 'conditions' && verdict.refused !== 'condition_text') || !isRec(args.drafted)) return undefined;
  const rest = admitGoalTargetBasis({ ...args, drafted: { ...args.drafted, also_required: null, open_question: null } });
  return 'basis' in rest && rest.basis !== null ? { ...rest.basis, open_question: CONDITIONS_NOT_KEPT } : undefined;
}

/** The refusal in the user's words, for the build's ledger. */
export function goalTargetBasisRefusalWords(metric: string, refusal: GoalTargetBasisRefusal): string {
  if (refusal === 'conditions' || refusal === 'condition_text') return unsupportedConditionWords(metric);
  const what = {
    reference: 'where the change is measured from (today, or the launch)',
    denominator: 'what the percentage is a percentage of (for example, today\'s level of it)',
    period: 'when the target must be met (the number of months)',
    period_conflict: 'one period: the target\'s period and its deadline disagree',
    effect_unit: 'the unit each option\'s effect on it is stated in',
    frame: 'whether the target is a level or a change in the quantity\'s own unit',
  }[refusal];
  return `No chance of meeting the target for "${metric}" is shown yet: Olumi needs ${what}, and will not guess it.`;
}

/**
 * ⛔ Re-scope (r2 BLOCKING 2): a reading refused while the drafter retained conditions beside the target refuses the WHOLE
 * goal reading — no threshold is written, so no chance is shown — with why. Without this, a target admitted on its own would
 * be scored and said with none of the conditions the user set beside it. `undefined` when nothing is lost (a valid reading, or
 * one that retained no condition: exactly as before).
 */
export function goalReadingRefusedWords(
  metric: string, verdict: { readonly refused: GoalTargetBasisRefusal } | { readonly basis: unknown }, drafted: unknown,
): string | undefined {
  if (!('refused' in verdict)) return undefined;
  const n = goalConditionCount(drafted);
  if (n === 0) return undefined;
  const why = goalTargetBasisRefusalWords(metric, verdict.refused);
  return verdict.refused === 'conditions' || verdict.refused === 'condition_text' ? why
    : `${why} No chance is shown without the ${n === 1 ? 'condition' : `${n} conditions`} you set beside it.`;
}

/** Read the stored basis, or `undefined` when there is none, it is malformed, or the target it describes has since changed. */
export function goalTargetBasisOf(goal: unknown): GoalTargetBasis | undefined {
  if (!isRec(goal) || !isRec(goal.goal_target_basis)) return undefined;
  const b = goal.goal_target_basis;
  const quantityFrame = goal.quantity_frame === 'change' ? 'change' : 'level';
  const targetFrame = goal.goal_threshold_frame === 'change_abs' || goal.goal_threshold_frame === 'change_rel' ? goal.goal_threshold_frame : 'level';
  if (b.source !== 'olumi_reading' || b.quantity_frame !== quantityFrame || b.target_frame !== targetFrame
    || !finite(b.target_raw) || b.target_raw !== goal.goal_threshold_raw) return undefined;
  if (b.reference !== 'today' && b.reference !== 'launch') return undefined;
  // DL ruling 14 Oct: a reading stored without its period takes the user's confirmed deadline (the ONE goal record's held
  // months, S5); with no deadline held it stays absent (`admitGoalTargetBasisAwaitingPeriod`).
  const period = b.period_months === undefined && typeof goal.id === 'string' ? readGoalRecord({ nodes: [goal] }, goal.id)?.horizon?.months
    : b.period_months;
  if (!finite(period) || period <= 0 || period > 120) return undefined;
  if (b.period_kind !== 'at_end' && b.period_kind !== 'over_period') return undefined;
  const effectUnit = words(b.effect_unit, BASIS_TEXT_MAX);
  if (effectUnit === undefined || typeof b.effects_at_period_end !== 'boolean') return undefined;
  const denominator = words(b.denominator, BASIS_TEXT_MAX);
  if (targetFrame !== 'level' && denominator === undefined) return undefined;
  const conditions = conditionsOf(b.also_required);
  if ('refused' in conditions) return undefined;
  const also = conditions.kept;
  const question = words(b.open_question, BASIS_QUESTION_MAX);
  return {
    quantity_frame: quantityFrame, target_frame: targetFrame, target_raw: b.target_raw,
    reference: b.reference, ...(denominator !== undefined ? { denominator } : {}),
    period_months: period, period_kind: b.period_kind, effect_unit: effectUnit,
    effects_at_period_end: b.effects_at_period_end,
    ...(also.length > 0 ? { also_required: also } : {}),
    ...(question !== undefined ? { open_question: question } : {}),
    source: 'olumi_reading',
  };
}

const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const months = (n: number): string => `${n <= 12 ? NUMBER_WORDS[n] : String(n)} ${n === 1 ? 'month' : 'months'}`;
export const monthNumber = (n: number): string => `month ${n <= 12 ? NUMBER_WORDS[n] : String(n)}`;

/** "month three" / "month three after launch": the point by which a change target is read (D3, AIE #94 6128697025). */
export function periodEndWords(basis: Pick<GoalTargetBasis, 'reference' | 'period_months'>): string {
  return `${monthNumber(basis.period_months)}${basis.reference === 'launch' ? ' after launch' : ''}`;
}

/** "at three months" / "three months after launch" / "over the first three months after launch" (rulings 18–22, amendment 5). */
export function periodWords(basis: Pick<GoalTargetBasis, 'reference' | 'period_months' | 'period_kind'>): string {
  const n = months(basis.period_months);
  if (basis.period_kind === 'over_period') return `over the first ${n}${basis.reference === 'launch' ? ' after launch' : ''}`;
  return basis.reference === 'launch' ? `${n} after launch` : `at ${n}`;
}

const COMPARATOR_WORDS: Readonly<Record<string, string>> = { '>=': 'at least', '>': 'above', '<=': 'at most', '<': 'below' };
export const comparatorWords = (op: unknown): string | undefined => typeof op === 'string' ? COMPARATOR_WORDS[op] : undefined;

/**
 * The words after "chance of", for the goal's own target (rulings 18–21): `undefined` when they cannot be said exactly.
 *   · level:       ‘X’ being at least T at three months
 *   · change_abs:  ‘X’ increasing by at least C units from today at three months — and, for a change MEASURED in % of today
 *                  (a quantity measured AS a change, the goal's change quantity frame: hiring, ruling 20), ‘X’ being at least 10%
 *                  higher than today at three months; for a quantity that IS a percentage level (capacity 75%), an absolute
 *                  change is in POINTS: ‘X’ being at least 10 percentage points higher than today (75% → 85%, never 82.5%)
 *   · change_rel:  ‘X’ being at least r% higher than today at three months (today's level is said by the caller, ruling 21)
 */
export function targetChanceWords(args: {
  readonly label: string;
  readonly frame: 'level' | 'change_abs' | 'change_rel';
  readonly comparator: string;
  /** level/change_abs: in the target's unit; change_rel: the stored fraction r. */
  readonly value: number;
  readonly unit: string;
  readonly basis?: Pick<GoalTargetBasis, 'reference' | 'period_months' | 'period_kind'>;
  /** The goal's quantity frame: 'change' = measured AS a change (its % is a % of today); 'level' = a level (a % moves in points). */
  readonly quantityFrame?: unknown;
}): string | undefined {
  const { label, frame, comparator, value, unit } = args;
  const bound = comparatorWords(comparator);
  if (bound === undefined || !finite(value) || label.trim() === '' || /[\r\n]/.test(label)) return undefined;
  const time = args.basis === undefined ? '' : ` ${periodWords(args.basis)}`;
  const x = `‘${label.trim()}’`;
  if (frame === 'level') {
    if (unit.trim() === '') return undefined;
    return `${x} being ${bound} ${sayFigureAsWritten(value, unit)}${time}`;
  }
  // A change: its sign is its direction; the comparator bounds its size ("at least 10% higher", "at most 5% lower").
  if (value === 0) return undefined;
  const up = value > 0;
  const size = Math.abs(value);
  const sizeBound = up ? bound : ({ 'at least': 'at most', above: 'below', 'at most': 'at least', below: 'above' } as Record<string, string>)[bound]!;
  const more = sizeBound === 'above' ? 'more than' : sizeBound === 'below' ? 'less than' : sizeBound;
  if (frame === 'change_rel') {
    const pct = Math.round(size * 100 * 1e6) / 1e6;
    return `${x} being ${more} ${pct}% ${up ? 'higher' : 'lower'} than today${time}`;
  }
  if (unit.trim() === '') return undefined;
  if (isPercentUnit(unit)) {
    // Independent check r1 item 1: only a quantity measured AS a change has a % of today; a percentage LEVEL moves in points.
    // With neither frame known the size cannot be said exactly: no default, it is not said (and the licence, which needs a
    // validated reading for any change target, is withheld before this: ruling 11).
    if (args.quantityFrame === 'change') return `${x} being ${more} ${size}% ${up ? 'higher' : 'lower'} than today${time}`;
    if (args.quantityFrame === 'level') return `${x} being ${more} ${size} percentage ${size === 1 ? 'point' : 'points'} ${up ? 'higher' : 'lower'} than today${time}`;
    return undefined;
  }
  return `${x} ${up ? 'increasing' : 'decreasing'} by ${more} ${sayFigureAsWritten(size, unit)} from today${time}`;
}

const isPercentUnit = (unit: string): boolean => /^%$|^percent$/i.test(unit.trim());

/** Amendment 1: every paired frame reads the status quo as unchanged; disclosed for every frame, the status quo row by assumption. */
export function statusQuoAssumptionWords(labels: string | readonly string[], basis?: Pick<GoalTargetBasis, 'reference' | 'period_months' | 'period_kind'>): string {
  const through = basis === undefined ? '' : basis.period_kind === 'over_period'
    ? ` over ${basis.reference === 'launch' ? 'that period' : `the next ${months(basis.period_months)}`}` : ` through ${monthNumber(basis.period_months)}`;
  const named = (typeof labels === 'string' ? [labels] : [...labels]).map((l) => `‘${l}’`);
  const list = named.length <= 1 ? (named[0] ?? '') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return `This assumes carrying on as now leaves ${list} unchanged${through}; each option is measured against that.`;
}

/** A level goal's held level today against its stated target, in the target's own unit (the status quo row's facts). */
export interface StatusQuoLevel {
  readonly today: number;
  /** The held comparator (`>=`, `>`, `<=`, `<`). */
  readonly comparator: string;
  readonly target: number;
  readonly unit: string;
}

/**
 * Amendment 1: the status quo row's own line, for the Run's recorded same-draw reference (`status_quo_by_assumption`) only.
 * Never a Monte Carlo figure, an interval or a chance, and never a forecast: a held reference value is named as recorded,
 * never compared with the target as a future event.
 * ⭐ AIE #94 6163023819 (`recovery/codex/AIE-D4-FUTURE-VALUE-CALENDAR-AND-STATUS-QUO-RULINGS-20261014.json`, sha256
 * fc17c200…, `status_quo`; capacity judge post3017 row 3), replacing #94 6160089127's lines: the two exact lines, byte for
 * byte. A limitation of this Run's held-reference convention, never a universal inability, a certain future outcome or a
 * promise that a figure unlocks a chance. The LEVEL line only where the caller holds the same Run's level and target in one
 * unit; every other case the generic line.
 */
export function statusQuoRowWords(label: string, level?: StatusQuoLevel): string {
  const bound = level === undefined ? undefined : COMPARATOR_WORDS[level.comparator];
  // Plain words (Paul's principle review, C.md #3028): the same meaning, still no promise that a figure unlocks a chance, and
  // still no future-event comparison (the AIE's rule for this row: never "stays at" or "meets"), so it says the assumption.
  const opening = `This Run can’t give a chance for carrying on as now, because it treats ‘${label}’ as unchanged from today`;
  if (level === undefined || bound === undefined || !Number.isFinite(level.today) || !Number.isFinite(level.target)
    || level.unit.trim() === '') {
    return `${opening}.`;
  }
  const say = (v: number): string => sayFigureAsWritten(v, level.unit);
  return `${opening}’s ${say(level.today)} (your target is ${bound} ${say(level.target)}).`;
}

/**
 * AIE status-quo disposition (12 Oct): a Run read on the same-draw reference whose status-quo result does NOT sit at that
 * reference disagrees with its own inputs (source, transport or currentness) until checked — withheld with this reason,
 * never relabelled as a finding or as "no change".
 */
export function statusQuoMovedWords(labels: readonly string[]): string {
  const named = labels.map((l) => `‘${l}’`);
  const list = named.length <= 1 ? (named[0] ?? '') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return `Chance not shown: Olumi cannot verify this Run’s result for carrying on as now against the reference for ${list}.`;
}

/** AIE status-quo disposition (12 Oct): a forecast whose status quo varies is carrying on's own projection, with its uncertainty. */
export function statusQuoProjectionWords(statusQuoLabel: string): string {
  return `‘${statusQuoLabel}’ is this model’s projection for carrying on as now, with its own uncertainty — not an assumption that nothing changes.`;
}

/** Amendment 2 + DL hiring decision: the timing basis and the additive reading, said beside the chance. */
export function effectsBasisWords(basis: GoalTargetBasis): string | undefined {
  if (!basis.effects_at_period_end) return undefined;
  const when = basis.period_kind === 'over_period' ? `over the first ${months(basis.period_months)}${basis.reference === 'launch' ? ' after launch' : ''}`
    : `at ${monthNumber(basis.period_months)}`;
  return `Each option’s effects are read as their size ${when}, including recruitment and ramp-up (${basis.effect_unit}), and are added together: twice the change counts twice, with no diminishing returns, interactions or extra onboarding drag modelled.`;
}

/** Amendment 4: a chance that covers the target alone, while the user's goal also requires other conditions. */
export function partialGoalWords(label: string | readonly string[], others: readonly string[]): string | undefined {
  if (others.length === 0) return undefined;
  const labels = (typeof label === 'string' ? [label] : [...label]).map((x) => `‘${x}’`);
  const named = labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `This chance covers ${named} only. It does not include: ${others.join('; ')}.`;
}

/** Amendments 7 and 10: a change_rel on Olumi's starting value. */
export function estimateOnlyWords(base: number, unit: string): string {
  return `Provisional estimate using Olumi’s assumed starting value: ${sayFigureAsWritten(base, unit)}. That starting value’s own uncertainty is not included.`;
}

/**
 * ⭐ SCIENCE (AIE MA1, 13 Oct; Batch 0 amendment 5: "an unlaunched feature has no conversion level today"): a LEVEL target
 * read OVER a window that starts at launch measures a quantity that does not exist before launch. It has no current level
 * to ask for; what its chance needs is a forecast for that window. ONE predicate for every surface that would otherwise ask
 * for "today's level": the stored basis (Olumi's reading, staleness-checked), else `undefined`.
 */
export function launchWindowOf(goal: unknown): GoalTargetBasis | undefined {
  const b = goalTargetBasisOf(goal);
  // A level target implies a level quantity (`admitGoalTargetBasis`: a change quantity takes only change_abs).
  return b !== undefined && b.reference === 'launch' && b.period_kind === 'over_period' && b.target_frame === 'level' ? b : undefined;
}

/** Why a launch-window goal has no chance yet, in one sentence: "Conversion rate is measured over the first three months after launch, so it has no level today, and the model has no forecast for that period yet." */
export function launchWindowGapWords(label: string, basis: Pick<GoalTargetBasis, 'reference' | 'period_months' | 'period_kind'>): string {
  const name = label === '' ? 'It' : `${label[0]!.toUpperCase()}${label.slice(1)}`;
  return `${name} is measured ${periodWords(basis)}, so it has no level today, and the model has no forecast for that period yet.`;
}

/**
 * The ONE question for a launch-window goal (AIE laws ruling, `same_cohort`: "Before claiming the original full joint,
 * confirm whether conversion and new customers use the same numerator/cohort"). With another target in the same window,
 * whether the two count the same people decides how they move together, so it is asked first; alone, the forecast itself.
 */
export function launchWindowQuestion(label: string, basis: Pick<GoalTargetBasis, 'reference' | 'period_months' | 'period_kind'>,
  otherTargetLabel?: string): string {
  return otherTargetLabel !== undefined
    ? `Do your ‘${otherTargetLabel}’ come from the same people your ‘${label}’ is measured on?`
    : `What ${label} do you expect ${periodWords(basis)}? A range is fine.`;
}

/** What stays unbuilt whatever the answer, for the step's `also_unbuilt` (never promised by the question). */
export const LAUNCH_WINDOW_UNBUILT = 'the chance of meeting a target measured from launch';
