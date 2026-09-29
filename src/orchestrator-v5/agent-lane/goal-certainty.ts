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
  /** The first unsized path that could reverse it: the factor the option moves, and the goal's parent it reaches. */
  readonly unsized_path?: { readonly from: string; readonly enters_goal_through: string };
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

const CERTAIN = 1e-9;
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
    const certainty: 0 | 1 | undefined = p >= 1 - CERTAIN ? 1 : p <= CERTAIN ? 0 : undefined;
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
      found = { from: moved[0]!.factorId, through: mismatch.id, move: moved[0]!.move };
      out.push({
        option_id: optionId, probability_of_goal: certainty, earned: false,
        unsized_path: { from: found.from, enters_goal_through: found.through },
        no_break_even: mismatch.reason,
        say: sayMismatch(certainty, option, goal, byId, found, mismatch.reason),
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
  const unsized = `Olumi hasn’t sized how ${moved} moves ${part}, so it can’t yet say how likely that is.`;
  if (be === undefined) {
    return `Olumi can’t yet say how likely ${opt} is to ${certainty === 1 ? 'meet' : 'miss'} the goal: it depends on how ${moved} moves ${part}, which isn’t sized.`;
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
