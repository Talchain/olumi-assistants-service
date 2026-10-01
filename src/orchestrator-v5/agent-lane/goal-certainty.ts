/**
 * ⭐ IS A GOAL CERTAINTY EARNED? — ONE typed decision the reply and every goal-probability display read (AI Quality
 * 5882366427 + R3 5882389030, ACKed 5882498938; the DL assigns the producer to MG, 5882387398).
 *
 * An option whose P(goal) is exactly 0 or 1 claims a certainty. It is EARNED only if no path from a factor the option
 * moves to the goal, through a link nobody has sized, runs in the direction that could reverse it: for P = 1 a path that
 * can move the goal away from its target, for P = 0 a path that can move it towards. "Unsized" is the R-c test
 * (`sizedLinkTest`: magnitude absent or `olumi_placeholder`, a natural effect in another unit, or written for another
 * mean), except that a link from an identity operand INTO its identity is exact, when THIS run evaluated that identity.
 *
 * An unearned certainty is never said as 100% or certain. It is said as the model-conditional result plus the
 * BREAK-EVEN, exact arithmetic on the user's own figures that the unsized link cannot change:
 *   · product identity, one operand held: fraction = |T ÷ projected-if-held − 1|, counted on the operand's STATED level
 *     ("about 88 of your 1,500", never a figure the user did not give);
 *   · sum identity: the margin |projected-if-held − T|, in the goal's unit;
 *   · no identity: no exact break-even, so "can't yet say how likely: it depends on …, which isn't sized".
 * No exact break-even is typed (`no_break_even`, AI Quality 5883228443), so an audit can tell why.
 *
 * ⛔ THE GOAL'S PARENTS ARE EXACTLY ITS OPERANDS, OR NOTHING IS EARNED THROUGH THE IDENTITY (PR Review 5883209483; R3
 * 5883225699). ISL reads every DECLARED operand, but the walk reaches the goal only along links: an operand with no link
 * into the goal hides every unsized path into it, so a certainty through it is unearned and has no figure (fail closed).
 * No engine run and no new carrier: everything is on CEE's own graph and the run's per-option P(goal). Pure.
 */
import { isPlaceholderLink } from '../../cee/magnitude/link-sizing.js';
import { sizedLinkTest } from '../../orchestrator/context/placeholder-parts.js';
import { mergeInterventionSourceObjects } from '../../orchestrator/tools/analysis-ready-helper.js';
import { sayFigure } from './say-figure.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

export interface GoalCertaintyDecision {
  readonly option_id: string;
  readonly probability_of_goal: 0 | 1;
  readonly earned: boolean;
  /**
   * The first unsized path that could reverse it: the factor the option moves, and the goal's parent it reaches. A real
   * path in the graph. Present on an unearned decision exactly when `identity_mismatch` is not.
   */
  readonly unsized_path?: { readonly from: string; readonly enters_goal_through: string };
  /**
   * The goal's parents are not exactly its evaluated identity's operands, so nothing an option moves is earned (PR Review
   * on 8dd6343b/0d45a267): the node that breaks equality, and how. NOT a path — no link from the moved factor is implied.
   */
  readonly identity_mismatch?: { readonly node_id: string; readonly reason: 'operand_not_parent' | 'extra_goal_parent' };
  readonly break_even?: {
    readonly kind: 'product' | 'sum';
    readonly projected_if_held: number;
    readonly threshold: number;
    /** product: the share of the operand that reverses it. */
    readonly fraction?: number;
    /** sum: the change in the goal's unit that reverses it. */
    readonly margin?: number;
    readonly operand_id: string;
    /** product: `fraction` of the operand's level, only where that level is the user's own figure. */
    readonly operand_count?: number;
  };
  /** Why an UNEARNED certainty has no `break_even` (AI Quality 5883228443). Absent when earned or when it has one. */
  readonly no_break_even?: NoBreakEven;
  /** The one sentence for an UNEARNED certainty. Absent when earned: every surface says the result as it does today. */
  readonly say?: string;
}

/**
 * Why there is no exact break-even: the goal declares no identity · this run did not evaluate it · ISL's level came from
 * the operands, not the stated level (no k) · the identity has addends · the goal has a parent outside its operands ·
 * an operand has no link into the goal · or the figure itself cannot be formed (no stated level, an operand at 0 …).
 */
export type NoBreakEven =
  | 'not_an_identity' | 'identity_not_evaluated' | 'level_from_inputs' | 'addends' | 'extra_goal_parent'
  | 'operand_not_parent' | 'no_exact_figure';

const userOwns = (source: unknown): boolean =>
  typeof source === 'string' && (source === 'brief_extraction' || source.startsWith('user'));

/** +1 / −1 when the goal is held above / below its target; 0 when the comparator is not stated. */
function goodSign(direction: unknown): number {
  return direction === '>' || direction === '>=' ? 1 : direction === '<' || direction === '<=' ? -1 : 0;
}

function linkSign(e: Rec): number {
  if (e.effect_direction === 'positive') return 1;
  if (e.effect_direction === 'negative') return -1;
  const mean = isRec(e.strength) ? num(e.strength.mean) : undefined;
  return mean === undefined || mean === 0 ? 0 : Math.sign(mean);
}

const levelOf = (n: Rec | undefined): { value?: number; raw?: number; source?: unknown; unit?: string } => {
  const os = isRec(n?.observed_state) ? n!.observed_state : {};
  return { value: num(os.value), raw: num(os.raw_value), source: os.source, unit: text(os.unit) };
};

const interventionLevel = (v: unknown): { value?: number; raw?: number } =>
  isRec(v) ? { value: num(v.value), raw: num(v.raw_value) } : { value: num(v) };

const round3 = (x: number): number => Number(x.toPrecision(3));

/**
 * The decision for every option the run reports at P(goal) exactly 0 or 1. Options with an interior P get none.
 * `optionResults` are the run's per-option results (`option_comparison`: `option_id`, `probability_of_goal`).
 */
export function goalCertaintyDecisions(
  graph: unknown,
  optionResults: ReadonlyArray<Record<string, unknown>>,
  /**
   * THIS run's identity evaluations (the stored fact's `identity_evaluations[]`: `node_id`, `evaluated`,
   * `level_source`). A declared identity the run did not evaluate (PLoT's `identities_not_forwarded`, ISL's withheld
   * identity) was walked as ordinary links, so its operand links are read by their own provenance and it gives no
   * break-even (AI Quality 5882734064). Omitted = none attested: a declaration alone never counts.
   */
  identityEvaluations?: ReadonlyArray<unknown>,
): GoalCertaintyDecision[] {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return [];
  const nodes = graph.nodes.filter(isRec);
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const goal = nodes.find((n) => n.kind === 'goal');
  if (goal === undefined || typeof goal.id !== 'string') return [];
  const evaluations = new Map((identityEvaluations ?? []).filter(isRec)
    .filter((e) => e.evaluated === true && typeof e.node_id === 'string')
    .map((e) => [e.node_id as string, e] as const));
  const evaluated = (id: unknown): boolean => typeof id === 'string' && evaluations.has(id);
  const declared = isRec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  const identity = declared !== undefined && evaluated(goal.id) ? declared : undefined;
  const operands = new Set(Array.isArray(identity?.factor_ids) ? identity!.factor_ids.filter((x): x is string => typeof x === 'string') : []);
  // Set EQUALITY, both ways (PR Review 5883209483): the goal's parents (options and the decision aside) and its operands.
  const parents = new Set(edges.filter((e) => e.to === goal.id).map((e) => e.from)
    .filter((f): f is string => typeof f === 'string' && byId.get(f)?.kind !== 'option' && byId.get(f)?.kind !== 'decision'));
  const unlinkedOperand = identity === undefined ? undefined : [...operands].find((id) => !parents.has(id));
  const extraParent = identity === undefined ? undefined : [...parents].find((id) => !operands.has(id));
  // Either inequality fails the earned result closed, not only the break-even (PR Review on 8dd6343b; R3 5883225699).
  const mismatch = unlinkedOperand !== undefined ? { id: unlinkedOperand, reason: 'operand_not_parent' as const }
    : extraParent !== undefined ? { id: extraParent, reason: 'extra_goal_parent' as const } : undefined;
  const evaluation = evaluations.get(goal.id);
  const noExact: NoBreakEven | undefined = declared === undefined ? 'not_an_identity'
    : identity === undefined ? 'identity_not_evaluated'
      : evaluation?.level_source !== 'stated_level' ? 'level_from_inputs'
        : (Array.isArray(identity.addends) ? identity.addends.length > 0 : identity.addends !== undefined) ? 'addends'
          : unlinkedOperand !== undefined ? 'operand_not_parent'
            : extraParent !== undefined ? 'extra_goal_parent'
              : undefined;
  const sized = sizedLinkTest(nodes);
  const exact = (e: Rec): boolean => {
    const to = byId.get(e.to);
    const id = isRec(to?.nonlinear_identity) && evaluated(to!.id) ? to!.nonlinear_identity : undefined;
    return (Array.isArray(id?.factor_ids) && id!.factor_ids.includes(e.from)) || sized(e);
  };
  const good = goodSign(goal.goal_direction);
  const out: GoalCertaintyDecision[] = [];

  for (const r of optionResults) {
    const optionId = text(r.option_id);
    const p = num(r.probability_of_goal);
    if (optionId === undefined || p === undefined) continue;
    // EXACTLY 0 or 1 (PR Review on 0d45a267): the engine's P is a share of draws, so all or none is exact; 0.9999999995
    // is an interior result and gets no decision.
    const certainty: 0 | 1 | undefined = p === 1 ? 1 : p === 0 ? 0 : undefined;
    if (certainty === undefined) continue;
    const option = byId.get(optionId);
    const iv = option !== undefined ? mergeInterventionSourceObjects(option) : {};
    // The goal would move AWAY from its target (P = 1) or TOWARDS it (P = 0) to reverse the certainty.
    const reversing = certainty === 1 ? -good : good;
    let found: { from: string; through: string; move: number } | undefined;
    // The factors the option moves. A factor set at the level it holds moves nothing, so no path from it can reverse
    // anything. An unknown move is read as either way (0: "could reverse").
    const moved = Object.entries(iv).flatMap(([factorId, set]) => {
      if (!byId.has(factorId)) return [];
      const now = levelOf(byId.get(factorId));
      const to = interventionLevel(set);
      const known = to.value !== undefined && now.value !== undefined;
      const move = known ? Math.sign(to.value! - now.value!) : 0;
      return move === 0 && known ? [] : [{ factorId, move }];
    });
    // ⛔ The goal's parents are not exactly its operands: an operand with no link into the goal hides what reaches it,
    // and a parent outside them adds what the identity does not say. Nothing an option moves is earned (fail closed).
    if (mismatch !== undefined && moved.length > 0) {
      out.push({
        option_id: optionId, probability_of_goal: certainty, earned: false,
        identity_mismatch: { node_id: mismatch.id, reason: mismatch.reason },
        no_break_even: mismatch.reason,
        say: sayMismatch(certainty, option, goal, byId, { from: moved[0]!.factorId, through: mismatch.id }, mismatch.reason),
      });
      continue;
    }
    for (const { factorId, move } of moved) {
      if (found !== undefined) break;
      // Every simple path from the moved factor to the goal, through factors, outcomes and risks.
      const walk = (at: string, sign: number, allExact: boolean, seen: Set<string>): void => {
        if (found !== undefined) return;
        for (const e of edges) {
          if (e.from !== at || typeof e.to !== 'string' || seen.has(e.to)) continue;
          const k = byId.get(e.to)?.kind;
          if (k === 'option' || k === 'decision') continue;
          const s = sign * linkSign(e);
          const ok = allExact && exact(e);
          if (e.to === goal.id) {
            const effect = move * s;
            const couldReverse = reversing === 0 || effect === 0 || effect === reversing;
            if (!ok && couldReverse) found = { from: factorId, through: at, move };
            continue;
          }
          walk(e.to, s, ok, new Set([...seen, e.to]));
        }
      };
      walk(factorId, 1, true, new Set([factorId]));
    }
    if (found === undefined) {
      out.push({ option_id: optionId, probability_of_goal: certainty, earned: true });
      continue;
    }
    const breakEven = noExact === undefined ? breakEvenOf(goal, identity, operands, byId, iv, found.through) : undefined;
    out.push({
      option_id: optionId,
      probability_of_goal: certainty,
      earned: false,
      unsized_path: { from: found.from, enters_goal_through: found.through },
      ...(breakEven !== undefined ? { break_even: breakEven } : { no_break_even: noExact ?? 'no_exact_figure' }),
      say: sayUnearned(certainty, reversing, option, goal, byId, found, breakEven),
    });
  }
  return out;
}

/**
 * R3 5882943255 (CODE-READ ISL `robustness_analyzer_v2.py`): ISL evaluates goal = k × Π(operands) + addends + L, with
 * k set from the goal's STATED level. `today × Π(now ÷ was)` is ISL's own projection only when (1) this run evaluated
 * the identity from the stated level (`level_source: 'stated_level'`; `'identity_inputs'` has no k), (2) the identity
 * has no addends, and (3) the goal's parents are EXACTLY the identity's operands (L = 0, and no operand unlinked). Otherwise
 * there is no exact break-even (`noExact`, typed), and the decision says "can't yet say how likely" (fail closed: never a
 * wrong figure).
 */
function breakEvenOf(
  goal: Rec,
  identity: Rec | undefined,
  operands: ReadonlySet<string>,
  byId: ReadonlyMap<unknown, Rec>,
  iv: Record<string, unknown>,
  through: string,
): GoalCertaintyDecision['break_even'] {
  const op = identity?.operation;
  if ((op !== 'product' && op !== 'sum') || !operands.has(through) || through in iv) return undefined;
  const today = levelOf(goal).raw;
  const threshold = num(goal.goal_threshold_raw);
  if (today === undefined || threshold === undefined) return undefined;
  let projected = today;
  for (const id of operands) {
    if (!(id in iv)) continue;
    const was = levelOf(byId.get(id)).raw;
    const now = interventionLevel(iv[id]).raw;
    if (was === undefined || now === undefined || (op === 'product' && was === 0)) return undefined;
    projected = op === 'product' ? projected * (now / was) : projected + (now - was);
  }
  if (op === 'sum') return { kind: 'sum', projected_if_held: projected, threshold, margin: Math.abs(projected - threshold), operand_id: through };
  if (projected === 0) return undefined;
  const fraction = Math.abs(threshold / projected - 1);
  const operand = levelOf(byId.get(through));
  const count = operand.raw !== undefined && userOwns(operand.source) ? Math.round(fraction * operand.raw) : undefined;
  return { kind: 'product', projected_if_held: projected, threshold, fraction, operand_id: through, ...(count !== undefined ? { operand_count: count } : {}) };
}

/** The sentence when the goal's parents are not exactly its operands: the model cannot follow the option through it. */
function sayMismatch(
  certainty: 0 | 1,
  option: Rec | undefined,
  goal: Rec,
  byId: ReadonlyMap<unknown, Rec>,
  found: { from: string; through: string },
  reason: 'operand_not_parent' | 'extra_goal_parent',
): string {
  const label = (id: unknown): string => text(byId.get(id)?.label) ?? String(id);
  const opt = `‘${text(option?.label) ?? String(option?.id ?? '')}’`;
  const head = `Olumi can’t yet say how likely ${opt} is to ${certainty === 1 ? 'meet' : 'miss'} the goal: `;
  return reason === 'operand_not_parent'
    ? `${head}‘${label(goal.id)}’ is worked out from ‘${label(found.through)}’, but the model has no link from it to `
      + `‘${label(goal.id)}’, so it can’t follow what ‘${label(found.from)}’ does through it.`
    : `${head}the model links ‘${label(found.through)}’ into ‘${label(goal.id)}’ beside the parts it is worked out from, so it `
      + `can’t check what ‘${label(found.from)}’ does to it.`;
}

/**
 * ⭐ THE ONE INPUT PATH FROM A STORED RUN (DL 5883245872; PR Review 5883209483): a reply or panel reads a Run's
 * decision from the STORED fact — `result.enrichment`, PLoT's `/v2/run` response kept whole, carries both the per-option
 * `option_comparison[].probability_of_goal` and ISL's `identity_evaluations[]` (with `level_source`) — never from the
 * transport keep-list, which carries neither the evaluations nor their `level_source`. Anything missing fails closed.
 */
export function goalCertaintyOfStoredResult(graph: unknown, result: unknown): GoalCertaintyDecision[] {
  const enrichment = isRec(result) && isRec(result.enrichment) ? result.enrichment : undefined;
  const options = Array.isArray(enrichment?.option_comparison) ? enrichment!.option_comparison.filter(isRec) : [];
  const evaluations = Array.isArray(enrichment?.identity_evaluations) ? enrichment!.identity_evaluations : undefined;
  return goalCertaintyDecisions(graph, options, evaluations);
}

function sayUnearned(
  certainty: 0 | 1,
  reversing: number,
  option: Rec | undefined,
  goal: Rec,
  byId: ReadonlyMap<unknown, Rec>,
  found: { from: string; through: string; move: number },
  be: GoalCertaintyDecision['break_even'],
): string {
  const label = (id: unknown): string => text(byId.get(id)?.label) ?? String(id);
  const opt = `‘${text(option?.label) ?? String(option?.id ?? '')}’`;
  const moved = `‘${label(found.from)}’`;
  const part = `‘${label(found.through)}’`;
  // The unsized link can be the moved factor's own edge into the goal (R3 5887059128): it then moves the goal.
  const moves = found.from === found.through ? `‘${label(goal.id)}’` : part;
  const unsized = `Olumi hasn’t sized how ${moved} moves ${moves}, so it can’t yet say how likely that is.`;
  if (be === undefined) {
    return `Olumi can’t yet say how likely ${opt} is to ${certainty === 1 ? 'meet' : 'miss'} the goal: it depends on how ${moved} moves ${moves}, which isn’t sized.`;
  }
  const unit = text(goal.goal_threshold_unit) ?? levelOf(goal).unit ?? '';
  const target = sayFigure(be.threshold, unit);
  const holds = `${opt} gives about ${sayFigure(round3(be.projected_if_held), unit)} if ${part} holds.`;
  const verb = reversing < 0 ? 'loses' : 'gains';
  // The CHANGE loses or gains, not the option (AI Quality nit 5882734064): "if raising ‘Monthly Pro price’ loses …".
  const change = found.move > 0 ? `raising ${moved}` : found.move < 0 ? `lowering ${moved}` : `the change to ${moved}`;
  const outcome = certainty === 1 ? `It misses ${target} if` : `It reaches ${target} only if`;
  if (be.kind === 'sum') {
    return `${holds} ${outcome} ${part} ${reversing < 0 ? 'falls' : 'rises'} by more than ${sayFigure(round3(be.margin!), unit)}. ${unsized}`;
  }
  const operand = levelOf(byId.get(found.through));
  const count = be.operand_count !== undefined && operand.raw !== undefined
    ? ` (about ${be.operand_count} of your ${sayFigure(operand.raw, operand.unit ?? '')})`
    : '';
  const pct = Math.round(be.fraction! * 1000) / 10;
  return `${holds} ${outcome} ${change} ${verb} more than about ${pct}% of ${part}${count}. ${unsized}`;
}


/** One option whose goal figures move with a link nobody sized, and every such link on its paths into the goal. */
export interface PlaceholderGoalPath {
  readonly option_id: string;
  /** The unsized links (`from` → `to`), in walk order, deduplicated. Never empty. */
  readonly links: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

/**
 * ⛔ (S) AN OPTION'S GOAL FIGURES ARE NOT EARNED WHILE ANY PATH FROM WHAT IT MOVES INTO THE GOAL RUNS THROUGH A LINK
 * NOBODY SIZED (DL #75 5902570568; AIQ 5902548598: the ANY-path rule #2323 ships for limits, 5900908629).
 *
 * Served cut-costs on `1f9d769` (10 of 15 drafts, MG 5902531777): the goal card read "Chance 8%" for "Switch fully to
 * GCP" (R3 5902550605) through a savings → spend link that is an `olumi_placeholder`. That figure moves with Olumi's
 * unsized coefficient, not with anything the user said; their "GCP ~25% cheaper" could not move it.
 *
 * THE LINK: one the sizer marked `olumi_placeholder` (AIQ's words, R3's R-PH checker), unless the user stated its strength
 * or it is an operand INTO an identity THIS run evaluated (exact: the goal-certainty rule's `exact`). NOT R-c's broader
 * "not sized" test: a structural link the sizer never marked (no `magnitude`) is not a placeholder here. Measured: R-c's
 * test withholds the DL's signed-in MRR card journey (`520aab46`, churn → paying subscribers carries no magnitude), whose
 * price options must keep their chance (DL 5902570568's positive control). So the MRR card's confirmed
 * `price × subscribers` keeps every figure, and a pre-card MRR run, whose last link into the goal is a placeholder,
 * withholds every mover (AIQ 5902606752: intended). A factor set at the level it already holds moves nothing, so an option
 * with no move (the status quo) keeps its figures (R3 5902591666). Pure.
 */
export function placeholderGoalPaths(
  graph: unknown,
  optionIds: readonly string[],
  identityEvaluations?: ReadonlyArray<unknown>,
  /** The interventions PLoT scored, by option id (the run's final wire options); else the option node's own. */
  scoredInterventions?: ReadonlyMap<string, Record<string, unknown>>,
): PlaceholderGoalPath[] {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return [];
  const nodes = graph.nodes.filter(isRec);
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const goal = nodes.find((n) => n.kind === 'goal');
  if (goal === undefined || typeof goal.id !== 'string') return [];
  const evaluated = new Set((identityEvaluations ?? []).filter(isRec)
    .filter((e) => e.evaluated === true && typeof e.node_id === 'string').map((e) => e.node_id as string));
  // ⛔ THE CARD IS THE ONE ROUTE (AIQ 5902606752): a goal that declares an INFERRED product this run did not evaluate is
  // Olumi's unconfirmed reading of how the goal is made. PLoT never forwards it (variant (d), `translator-v3.ts`) and
  // withholds every goal figure itself (#416, which (S) defers to), and C46 names the leader's cause. (S) stands down, so
  // the one reason said is the product's, and the confirm card is the one way forward.
  const goalIdentity = isRec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  if (goalIdentity !== undefined && goalIdentity.stated_in_brief === false && goalIdentity.operation === 'product' && !evaluated.has(goal.id)) return [];
  const placeholder = (e: Rec): boolean => {
    // ONE predicate (L4, `link-sizing.ts`): an accepted Olumi estimate sizes a link for goal figures (DL 5929790081 (i)).
    if (!isPlaceholderLink(e)) return false;
    const to = byId.get(e.to);
    const id = isRec(to?.nonlinear_identity) && evaluated.has(String(to!.id)) ? to!.nonlinear_identity : undefined;
    return !(Array.isArray(id?.factor_ids) && id!.factor_ids.includes(e.from));
  };
  const walkable = (id: unknown): boolean => {
    const k = byId.get(id)?.kind;
    return k !== undefined && k !== 'option' && k !== 'decision';
  };
  // Every node with a path to the goal (options and the decision aside): a link lies on a path into the goal only
  // when it points at one of these, or at the goal.
  const reachesGoal = new Set<unknown>([goal.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) {
      if (reachesGoal.has(e.to) && !reachesGoal.has(e.from) && walkable(e.from)) { reachesGoal.add(e.from); grew = true; }
    }
  }
  const out: PlaceholderGoalPath[] = [];
  for (const optionId of optionIds) {
    const option = byId.get(optionId);
    const iv = scoredInterventions?.get(optionId) ?? (option !== undefined ? mergeInterventionSourceObjects(option) : undefined);
    if (iv === undefined) continue;
    // A factor set at the level it holds moves nothing; an unknown move is read as a move (fail closed). The wire carries
    // a level in the node's model scale or in the user's units (the egress denormalises capped factors: the scaffolded
    // status quo "Keep £49" arrives as 49 beside a held 0.245), so it is the held level in EITHER scale.
    const moved = Object.entries(iv).flatMap(([factorId, set]) => {
      if (!byId.has(factorId) || !reachesGoal.has(factorId)) return [];
      const held = levelOf(byId.get(factorId));
      const to = interventionLevel(set);
      const same = (a: number | undefined, b: number | undefined): boolean => a !== undefined && b !== undefined && a === b;
      return same(to.value, held.value) || same(to.raw, held.raw) || same(to.value, held.raw) ? [] : [factorId];
    });
    const links: { from: string; to: string }[] = [];
    const seen = new Set<unknown>(moved);
    const queue: unknown[] = [...moved];
    while (queue.length > 0) {
      const at = queue.shift();
      for (const e of edges) {
        if (e.from !== at || !reachesGoal.has(e.to) || typeof e.to !== 'string' || typeof e.from !== 'string') continue;
        if (placeholder(e) && !links.some((l) => l.from === e.from && l.to === e.to)) links.push({ from: e.from, to: e.to });
        if (e.to !== goal.id && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
      }
    }
    if (links.length > 0) out.push({ option_id: optionId, links });
  }
  return out;
}

/**
 * The ONE typed warning for (S) (`GOAL_FIGURES_PLACEHOLDER_PATH`): which options, which links, and the words, in the
 * UI's "Not shown." register (≤ 400 characters). The ask names the links to size: the writer is `propose_link_effect`
 * (AIQ 5902548598). A placeholder INTO an identity the goal declares but this run did not evaluate is sized by the
 * user's Yes on the confirm card, so it gets no link-size ask of its own: one route, not two (AIQ 5902606752).
 */
export function placeholderGoalWarning(
  graph: unknown,
  paths: readonly PlaceholderGoalPath[],
  code: string,
): { code: string; message: string; severity: 'warning'; node_ids: string[]; option_ids: string[]; acceptable_links?: Array<{ from: string; to: string }> } {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const label = (id: unknown): string => `‘${text(byId.get(id)?.label) ?? String(id)}’`;
  const list = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const cardSized = (l: { from: string; to: string }): boolean => {
    const id = byId.get(l.to)?.nonlinear_identity;
    return isRec(id) && Array.isArray(id.factor_ids) && id.factor_ids.includes(l.from);
  };
  const links = [...new Map(paths.flatMap((p) => p.links).map((l) => [`${l.from}->${l.to}`, l] as const)).values()];
  const named = links.filter((l) => !cardSized(l));
  // ⛔ ASK ONLY FOR A SIZE THAT CAN MAKE THE FIGURE RIGHT (AIQ 5902834053; MG successor 5902809244): a link from a node
  // that holds no level would add the same amount to EVERY option once sized ("Stay on AWS" would save too), so it is
  // named but not asked; its figures stay withheld until the model gives that node a level.
  // ⛔ NEVER ASK THE USER TO SIZE A GUESSED LINK OUT OF A NODE THEIR LIMIT WATCHES (AIQ 5903604206 / 5903627210; R3
  // 5903589565): "Give a figure for how 'Migration downtime' moves 'Monthly cloud spend'" presupposes a cause Olumi guessed —
  // downtime does not drive the bill — and the user's answer would turn Olumi's mechanism into a user-stated link. It is said
  // as the guess it is, and not asked; nothing is offered that no writer delivers (no tool removes a link).
  const limitIds = new Set((isRec(graph) && Array.isArray(graph.goal_constraints) ? graph.goal_constraints : [])
    .filter(isRec).map((c) => c.node_id).filter((id): id is string => typeof id === 'string'));
  // Only a link INTO the goal (AIQ 5903874730; P0 PARTNER 5903857287): a placeholder out of limit-watched churn into
  // subscribers is a real mechanism whose size is unknown, so it is asked for as before; downtime → spend is the guess.
  const guessedLink = (l: { from: string; to: string }): boolean => limitIds.has(l.from) && byId.get(l.to)?.kind === 'goal';
  const guessed = named.filter(guessedLink);
  const asked = named.filter((l) => !guessedLink(l) && levelOf(byId.get(l.from)).value !== undefined);
  const byTarget = new Map<string, string[]>();
  for (const l of named) byTarget.set(l.to, [...(byTarget.get(l.to) ?? []), l.from]);
  const phrases = [...byTarget].slice(0, 2).map(([to, froms]) =>
    `${list(froms.slice(0, 3).map(label))}${froms.length > 3 ? ' and others' : ''} ${froms.length === 1 ? 'moves' : 'move'} ${label(to)}`);
  const options = paths.map((p) => label(p.option_id));
  const opts = options.length > 3 ? `${list(options.slice(0, 2))} and ${options.length - 2} more options` : list(options);
  const verb = options.length === 1 ? 'is' : 'are';
  const sized = phrases.length === 0 ? '' : `Olumi hasn’t sized how ${phrases.join(', or how ')}${byTarget.size > 2 ? ', and more' : ''}, so t`;
  const ask = asked.length === 0 ? ''
    : ` Give a figure for how ${list(asked.slice(0, 2).map((l) => `${label(l.from)} moves ${label(l.to)}`))} and Olumi will use it.`;
  const guess = guessed.length === 0 ? ''
    : ` Olumi only guessed that ${list(guessed.slice(0, 2).map((l) => `${label(l.from)} changes ${label(l.to)}`))}, so you aren’t asked `
      + `to size ${guessed.length === 1 ? 'that link' : 'those links'}.`;
  const message = `Not shown. ${sized === '' ? 'T' : sized}his run can’t say how likely ${opts} ${verb} to reach the goal, or which option does best.${ask}${guess}`;
  const compactLabel = (id: string): string => {
    const value = text(byId.get(id)?.label) ?? id;
    return `‘${value.length <= 48 ? value : `${value.slice(0, 47).trimEnd()}…`}’`;
  };
  const fallbackAsk = asked.length === 0 ? ''
    : ` Give a figure for how ${compactLabel(asked[0]!.from)} moves ${compactLabel(asked[0]!.to)} and Olumi will use it.`;
  const fallbackGuess = guessed.length === 0 ? '' : ' Olumi only guessed another link; you aren’t asked to size it.';
  return {
    code, message: message.length <= 400 ? message
      : `Not shown. This run can’t say how likely these options are to reach the goal: a link on the way is not sized.${fallbackAsk}${fallbackGuess}`,
    severity: 'warning',
    node_ids: [...new Set(links.flatMap((l) => [l.from, l.to]))],
    option_ids: paths.map((p) => p.option_id),
    // ⭐ DL [R2] (5930827933): the links the row may offer as ONE click, "Accept starting strength", through the
    // approval that sizes a placeholder (#2446 `approvalSizes`). Only the ones whose size can make the figure right — the
    // SAME set the sentence asks about (a levelled source, not a guessed mechanism): the offer gate (V4).
    ...(asked.length > 0 ? { acceptable_links: asked.map((l) => ({ from: l.from, to: l.to })) } : {}),
  };
}
