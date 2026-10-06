/**
 * ⭐ D3 MILESTONE 1, STEP 2 — EACH OPTION'S CHANCE OF MEETING THE GOAL, AND WHAT MAY BE SAID ABOUT IT (DL 0df0e1 #87
 * 6005048156 + plan 6006078553; Science d5 6005138341 / 6005279728 / 6005640764; Wording c6 6005196947 + rulings 6 Oct).
 *
 * The goal chance has its OWN licence, separate from the win-share leader's (`leader_claim`): a withheld win-share leader
 * no longer silences a goal chance the Run computed for every option. CEE decides; the UI renders by identity
 * (`theUiRendersItDoesNotDecide`): the decision rides the Run's own record as ONE `info` entry in `inference_warnings`
 * (the keep-listed carrier — no new field, no schemas release, DL (b)), stored with the Run, so the turn and the reload
 * read the same decision.
 *
 *  · LICENSED — the goal states a level target with its direction and unit, and at least one scored option still carries
 *    a finite goal chance in [0, 1] after every withhold (the seam gate runs first).
 *  · PER OPTION (Science d5 #87 6007421281): an option whose chance was withheld for its OWN path (no figure on its record,
 *    or an exact 0/1 the Run did not earn, which the transport strips) loses only its own line — `withheld_option_ids`.
 *    Only the superlative and every-option forms need every option: with any option withheld the form is `each`.
 *  · `form` — which of c6's ruled sentences applies, decided HERE on the DISPLAYED whole percentages:
 *      `highest`                    the top clears the next by ≥ 10 points (Science's interim rule until each option's
 *                                   informative-draw count arrives, step 2b) and is at least 1%;
 *      `highest_all_likely_to_miss` that, and every option is at or under 40%;
 *      `all_likely_to_miss`         every option at or under 40%, no superlative;
 *      `each`                       anything else: each option's chance, in the model's option order, never ranked.
 *    ORDER COUNTS AS A SUPERLATIVE (d5 6005640764): only the two `highest` forms license an order by goal chance.
 */
import { readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { statedGoalTargetOf } from './stated-goal-target.js';
import { goalChanceTargetCause } from './goal-chance-gate.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export const GOAL_CHANCE_LICENSED = 'GOAL_CHANCE_LICENSED';
/** Science's interim superlative gap, in displayed whole percentage points (d5 6005279728). */
export const SUPERLATIVE_GAP_POINTS = 10;
/** c6's "more likely to miss your goal than meet it" family: every displayed chance at or under this. */
export const MORE_LIKELY_TO_MISS_PCT = 40;

export type GoalChanceForm = 'highest' | 'highest_all_likely_to_miss' | 'all_likely_to_miss' | 'each';
export type GoalChanceComparator = 'at_least' | 'above' | 'at_most' | 'below';

export interface GoalChanceLicence {
  readonly code: typeof GOAL_CHANCE_LICENSED;
  readonly severity: 'info';
  readonly message: string;
  readonly form: GoalChanceForm;
  /** Every scored option, in the model's option order (the order the Run's own records carry). */
  readonly option_ids: readonly string[];
  /** Each LICENSED option's DISPLAYED whole percentage — the figure the sentence quotes. */
  readonly pct_by_option: Readonly<Record<string, number>>;
  /** The options whose chance was withheld for their own path (model order); present only when non-empty. Form is `each`. */
  readonly withheld_option_ids?: readonly string[];
  readonly leader_option_id?: string;
  readonly next_option_id?: string;
  /** The target as the user stated it: the UI says it in these words, never re-derives the comparator. */
  readonly target: { readonly comparator: GoalChanceComparator; readonly value: number; readonly unit: string };
}

const COMPARATOR: Readonly<Record<string, GoalChanceComparator>> = { '>=': 'at_least', '>': 'above', '<=': 'at_most', '<': 'below' };

/** The DISPLAYED whole percentage of a chance: the figure the user reads, and the one Science's gap is tested on. */
export function displayedGoalPct(p: number): number {
  return Math.round(Math.max(0, Math.min(1, p)) * 100);
}

/**
 * The licence for the Run's goal chances, or null (nothing may be said beyond today's lines). Pure. An EXACT 0 or 1 counts
 * only where the Run's own goal certainty earned it (`earned`; 0.63.0): the transport strips an unearned one, so a licence
 * over it would quote a figure the user is never shown. No certainty decision ⇒ unearned (fail closed).
 */
export function goalChanceLicenceOf(
  envelope: unknown, graph: unknown, goalId: unknown, earned: (optionId: string, p: 0 | 1) => boolean = () => false,
): GoalChanceLicence | null {
  if (!isRec(envelope) || goalChanceTargetCause(graph, goalId) !== null) return null;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  const target = goal === undefined ? null : statedGoalTargetOf(graph as Rec, goal);
  // A LEVEL target only: a target stated as a change ("cut by 20%") has no ruled sentence yet.
  if (target === null || (target.frame !== undefined && target.frame !== 'level')) return null;
  const comparator = target.held === undefined ? undefined : COMPARATOR[target.held];
  if (comparator === undefined || typeof target.unit !== 'string' || target.unit.trim() === '') return null;

  // The Run's own option records, current-first: the first carrier that has any is the comparison.
  const records = readOptionResultSources(envelope).find((s) => s.length > 0) ?? [];
  const option_ids: string[] = [];
  const licensed: string[] = [];
  const withheld: string[] = [];
  const pct: Record<string, number> = {};
  for (const r of records) {
    const id = typeof r.option_id === 'string' ? r.option_id : typeof r.id === 'string' ? r.id : undefined;
    if (id === undefined || option_ids.includes(id)) continue;
    const p = r.probability_of_goal;
    option_ids.push(id);
    // Withheld for its own path: no figure on its record, or an exact 0/1 the Run did not earn (the transport strips it).
    if (typeof p !== 'number' || ((p === 0 || p === 1) && !earned(id, p))) { withheld.push(id); continue; }
    // An unusable figure here means a withhold did not run: fail closed, say nothing.
    if (!Number.isFinite(p) || p < 0 || p > 1) return null;
    licensed.push(id);
    pct[id] = displayedGoalPct(p);
  }
  if (option_ids.length < 2 || licensed.length === 0) return null;

  // Only the superlative and every-option forms need every option (d5 6007421281): any withheld option ⇒ `each`.
  const complete = withheld.length === 0;
  const ranked = [...licensed].sort((a, b) => pct[b]! - pct[a]!);
  const [leader, next] = ranked as [string, string];
  const superlative = complete && pct[leader]! >= 1 && pct[leader]! - pct[next]! >= SUPERLATIVE_GAP_POINTS;
  const allLikelyToMiss = complete && licensed.every((id) => pct[id]! <= MORE_LIKELY_TO_MISS_PCT);
  const form: GoalChanceForm = superlative
    ? (allLikelyToMiss ? 'highest_all_likely_to_miss' : 'highest')
    : (allLikelyToMiss ? 'all_likely_to_miss' : 'each');
  return {
    code: GOAL_CHANCE_LICENSED,
    severity: 'info',
    message: 'Each option’s chance of meeting your goal is licensed on this Run.',
    form,
    option_ids,
    pct_by_option: pct,
    ...(withheld.length > 0 ? { withheld_option_ids: withheld } : {}),
    ...(superlative ? { leader_option_id: leader, next_option_id: next } : {}),
    target: { comparator, value: target.value, unit: target.unit },
  };
}

/** Appends the licence to the Run's `inference_warnings` when there is one; otherwise the envelope itself. Pure. */
export function withGoalChanceLicence<E>(
  envelope: E, graph: unknown, goalId: unknown, earned?: (optionId: string, p: 0 | 1) => boolean,
): E {
  const licence = goalChanceLicenceOf(envelope, graph, goalId, earned);
  if (licence === null || !isRec(envelope)) return envelope;
  const warnings = Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : [];
  return { ...envelope, inference_warnings: [...warnings, licence] } as E;
}
