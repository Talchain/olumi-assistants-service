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
 *      `similar`                    H2 (DL 0df0e1 6 Oct, d5 interim rule: below 10 points; c6 words "similar chances"):
 *                                   every option quoted, no superlative — `similar_option_ids` names every option within 10
 *                                   displayed points of the top, in the model's order (never ranked);
 *      `each`                       an option withheld for its own path: each option's line, in the model's order.
 *    ORDER COUNTS AS A SUPERLATIVE (d5 6005640764): only the two `highest` forms license an order by goal chance.
 */
import { readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { statedGoalTargetOf } from './stated-goal-target.js';
import { goalChanceTargetCause } from './goal-chance-gate.js';
import { heldLinkOf, isUserStatedLink } from './held-user-links.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export const GOAL_CHANCE_LICENSED = 'GOAL_CHANCE_LICENSED';
/** Science's interim superlative gap, in displayed whole percentage points (d5 6005279728). */
export const SUPERLATIVE_GAP_POINTS = 10;
/** c6's "more likely to miss your goal than meet it" family: every displayed chance at or under this. */
export const MORE_LIKELY_TO_MISS_PCT = 40;

export type GoalChanceForm = 'highest' | 'highest_all_likely_to_miss' | 'all_likely_to_miss' | 'similar' | 'each';
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
  /** `similar` only: the options within 10 displayed points of the top, in the model's order (≥ 2). */
  readonly similar_option_ids?: readonly string[];
  readonly leader_option_id?: string;
  readonly next_option_id?: string;
  /** The target as the user stated it: the UI says it in these words, never re-derives the comparator. */
  readonly target: { readonly comparator: GoalChanceComparator; readonly value: number; readonly unit: string };
  /**
   * ⭐ D3 cut 5 (DL 0df0e1; Science d5 #87 6008242694 / 6008252938): present iff a USER-STATED link on a licensed option's
   * path to the goal carries an existence probability below 1 — the chances then also count Olumi's own assumption that
   * the user's link might not hold. `one_in` is N when every such link shares one value p and 1 − p is 1/N (0.8 → 5,
   * 0.9 → 10); absent when they differ (the words then say it is Olumi's estimate for each).
   */
  readonly user_link_existence?: { readonly links: number; readonly one_in?: number };
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
  // H2: every option quoted and no superlative → the options within 10 points of the top have similar chances.
  const same = complete && !superlative && !allLikelyToMiss
    ? licensed.filter((id) => pct[leader]! - pct[id]! < SUPERLATIVE_GAP_POINTS) : [];
  const form: GoalChanceForm = superlative
    ? (allLikelyToMiss ? 'highest_all_likely_to_miss' : 'highest')
    : allLikelyToMiss ? 'all_likely_to_miss' : same.length >= 2 ? 'similar' : 'each';
  const existence = userLinkExistenceOn(graph, goalId, licensed);
  return {
    code: GOAL_CHANCE_LICENSED,
    severity: 'info',
    message: 'Each option’s chance of meeting your goal is licensed on this Run.',
    form,
    option_ids,
    pct_by_option: pct,
    ...(withheld.length > 0 ? { withheld_option_ids: withheld } : {}),
    ...(form === 'similar' ? { similar_option_ids: same } : {}),
    ...(superlative ? { leader_option_id: leader, next_option_id: next } : {}),
    target: { comparator, value: target.value, unit: target.unit },
    ...(existence !== undefined ? { user_link_existence: existence } : {}),
  };
}

/**
 * The user-stated relationships on a licensed option's path to THE SCORED goal that carry `exists_probability` < 1;
 * `undefined` when there are none. A link is on that path when its source is reached from the option's intervened
 * factors and its target reaches the goal (Codex r1 #2637: the goal the Run scored, never the first one).
 *  · USER-STATED is the relationship's AUTHORSHIP, not its size (Codex r1): a link the user sized (`linkSizing` 'user') or
 *    one their brief stated (`brief_extraction`, construction's mapping of an explicit brief relationship). An Olumi
 *    hypothesis the user only accepted is not theirs.
 *  · An IDENTITY edge (into a node whose `nonlinear_identity` lists its source) is fixed by ISL, never Bernoulli-gated
 *    (Codex r1: robustness_analyzer_v2 bypasses the gate), so it never counts.
 */
function userLinkExistenceOn(graph: unknown, goalId: unknown, optionIds: readonly string[]): { links: number; one_in?: number } | undefined {
  const held = userStatedLinksBelowOne(graph, goalId, optionIds);
  if (held.length === 0) return undefined;
  const values = [...new Set(held.map((e) => e.exists_probability as number))];
  const n = values.length === 1 && values[0]! < 1 ? 1 / (1 - values[0]!) : NaN;
  const oneIn = Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-6 && Math.round(n) >= 2 ? Math.round(n) : undefined;
  return { links: held.length, ...(oneIn !== undefined ? { one_in: oneIn } : {}) };
}

/**
 * The links `userLinkExistenceOn` counts (exported for its rows). Science d5 #87 6008444863: a `brief_extraction` edge is
 * the user's relationship only WITH its evidence (`source_quote`), so a drafter-invented mediator tagged brief_extraction
 * never becomes "your link".
 */
export function userStatedLinksBelowOne(graph: unknown, goalId: unknown, optionIds: readonly string[]): Rec[] {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  if (goal === undefined) return [];
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind] as const));
  const walkable = (id: unknown): boolean => { const k = kindOf.get(id); return k !== undefined && k !== 'option' && k !== 'decision'; };
  const directed = edges.filter((e) => e.edge_type !== 'bidirected');
  // Nodes with a directed path to the goal (the goal included).
  const toGoal = new Set<unknown>([goal.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of directed) if (toGoal.has(e.to) && !toGoal.has(e.from) && walkable(e.from)) { toGoal.add(e.from); grew = true; }
  }
  // Nodes reached from the licensed options: their intervened factors and their own out-links, then forward.
  const reached = new Set<unknown>();
  for (const id of optionIds) {
    const option = nodes.find((n) => n.id === id);
    const seeds = [...(isRec(option?.interventions) ? Object.keys(option!.interventions as Rec) : []),
      ...directed.filter((e) => e.from === id).map((e) => e.to)];
    for (const seed of seeds) if (walkable(seed)) reached.add(seed);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const e of directed) if (reached.has(e.from) && !reached.has(e.to) && walkable(e.to)) { reached.add(e.to); grew = true; }
  }
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const identityEdge = (e: Rec): boolean => {
    const id = byId.get(e.to)?.nonlinear_identity;
    return isRec(id) && Array.isArray(id.factor_ids) && id.factor_ids.includes(e.from);
  };
  // ⭐ Hold-at-1.0 (d5 #87 6008807178): a link the Run holds at 1.0 is not Olumi's doubt; the SAME function the payload uses.
  return directed.filter((e) => reached.has(e.from) && toGoal.has(e.to) && isUserStatedLink(e) && !identityEdge(e)
    && heldLinkOf(e) === null
    && typeof e.exists_probability === 'number' && Number.isFinite(e.exists_probability) && e.exists_probability < 1);
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

/**
 * ⭐ DL 0df0e1 ruling C (6 Oct): the Run's stored licence as the Agent may read it — `form` and option ids only, read by
 * its code where the Run carries it (`enrichment.inference_warnings`) or where a kept Run moved it (`inference_warnings`).
 * No percentage travels: the Agent quotes each option's `probability_of_goal` from its own row. `undefined` when the Run
 * carries no single well-formed licence.
 */
export function goalChanceLicenceForAgent(result: unknown): {
  form: GoalChanceForm; option_ids: string[]; leader_option_id?: string; similar_option_ids?: string[]; withheld_option_ids?: string[];
} | undefined {
  if (!isRec(result)) return undefined;
  const records = [isRec(result.enrichment) ? result.enrichment.inference_warnings : undefined, result.inference_warnings]
    .flatMap((w) => (Array.isArray(w) ? w : [])).filter((w): w is Rec => isRec(w) && w.code === GOAL_CHANCE_LICENSED);
  if (records.length !== 1) return undefined;
  const r = records[0]!;
  const ids = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : undefined);
  const forms: readonly string[] = ['highest', 'highest_all_likely_to_miss', 'all_likely_to_miss', 'similar', 'each'];
  const optionIds = ids(r.option_ids);
  if (typeof r.form !== 'string' || !forms.includes(r.form) || optionIds === undefined) return undefined;
  const similar = ids(r.similar_option_ids);
  const withheld = ids(r.withheld_option_ids);
  // A record at odds with itself speaks for nothing (Codex r2 #2625; DGAI's reader refuses the same records).
  const form = r.form as GoalChanceForm;
  const superlative = form === 'highest' || form === 'highest_all_likely_to_miss';
  const named = (v: unknown): boolean => typeof v === 'string' && optionIds.includes(v);
  if (superlative ? !(named(r.leader_option_id) && named(r.next_option_id) && r.leader_option_id !== r.next_option_id)
    : r.leader_option_id !== undefined || r.next_option_id !== undefined) return undefined;
  if (form === 'similar'
    ? similar === undefined || similar.length < 2 || new Set(similar).size !== similar.length || !similar.every((id) => optionIds.includes(id))
    : r.similar_option_ids !== undefined) return undefined;
  if (r.withheld_option_ids !== undefined
    && (form !== 'each' || withheld === undefined || withheld.length === 0 || !withheld.every((id) => optionIds.includes(id)))) return undefined;
  return {
    form,
    option_ids: optionIds,
    ...(typeof r.leader_option_id === 'string' ? { leader_option_id: r.leader_option_id } : {}),
    ...(similar !== undefined ? { similar_option_ids: similar } : {}),
    ...(withheld !== undefined ? { withheld_option_ids: withheld } : {}),
  };
}
