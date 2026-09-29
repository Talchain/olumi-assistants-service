/**
 * ⭐ IS A GOAL CERTAINTY EARNED? — ONE typed decision the reply and every goal-probability display read (AI Quality
 * 5882366427 + R3 5882389030, ACKed 5882498938; the DL assigns the producer to MG, 5882387398).
 *
 * An option whose P(goal) is exactly 0 or 1 claims a certainty. It is EARNED only if no path from a factor the option
 * moves to the goal, through a link nobody has sized, runs in the direction that could reverse it: for P = 1 a path that
 * can move the goal away from its target, for P = 0 a path that can move it towards. "Unsized" is the R-c test
 * (`sizedLinkTest`: magnitude absent or `olumi_placeholder`, a natural effect in another unit, or written for another
 * mean), except that a link from a declared identity operand INTO its identity is exact by definition.
 *
 * An unearned certainty is never said as 100% or certain. It is said as the model-conditional result plus the
 * BREAK-EVEN, exact arithmetic on the user's own figures that the unsized link cannot change:
 *   · product identity, one operand held: fraction = |T ÷ projected-if-held − 1|, counted on the operand's STATED level
 *     ("about 88 of your 1,500", never a figure the user did not give);
 *   · sum identity: the margin |projected-if-held − T|, in the goal's unit;
 *   · no identity: no exact break-even, so "can't yet say how likely: it depends on …, which isn't sized".
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
  /** The one sentence for an UNEARNED certainty. Absent when earned: every surface says the result as it does today. */
  readonly say?: string;
}

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
export function goalCertaintyDecisions(graph: unknown, optionResults: ReadonlyArray<Record<string, unknown>>): GoalCertaintyDecision[] {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return [];
  const nodes = graph.nodes.filter(isRec);
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const goal = nodes.find((n) => n.kind === 'goal');
  if (goal === undefined || typeof goal.id !== 'string') return [];
  const identity = isRec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  const operands = new Set(Array.isArray(identity?.factor_ids) ? identity!.factor_ids.filter((x): x is string => typeof x === 'string') : []);
  const sized = sizedLinkTest(nodes);
  const exact = (e: Rec): boolean => {
    const to = byId.get(e.to);
    const id = isRec(to?.nonlinear_identity) ? to!.nonlinear_identity : undefined;
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
    let found: { from: string; through: string } | undefined;
    for (const [factorId, set] of Object.entries(iv)) {
      if (found !== undefined) break;
      if (!byId.has(factorId)) continue;
      const now = levelOf(byId.get(factorId));
      const to = interventionLevel(set);
      // A factor set at the level it holds moves nothing, so no path from it can reverse anything. An unknown move is
      // read as either way (0 below: "could reverse").
      const move = to.value !== undefined && now.value !== undefined ? Math.sign(to.value - now.value) : 0;
      if (move === 0 && to.value !== undefined && now.value !== undefined) continue;
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
            if (!ok && couldReverse) found = { from: factorId, through: at };
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
    const breakEven = breakEvenOf(goal, identity, operands, byId, iv, found.through);
    out.push({
      option_id: optionId,
      probability_of_goal: certainty,
      earned: false,
      unsized_path: { from: found.from, enters_goal_through: found.through },
      ...(breakEven !== undefined ? { break_even: breakEven } : {}),
      say: sayUnearned(certainty, reversing, option, goal, byId, found, breakEven),
    });
  }
  return out;
}

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

function sayUnearned(
  certainty: 0 | 1,
  reversing: number,
  option: Rec | undefined,
  goal: Rec,
  byId: ReadonlyMap<unknown, Rec>,
  found: { from: string; through: string },
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
  const outcome = certainty === 1 ? `It misses ${target} if` : `It reaches ${target} only if`;
  if (be.kind === 'sum') {
    return `${holds} ${outcome} ${part} ${reversing < 0 ? 'falls' : 'rises'} by more than ${sayFigure(round3(be.margin!), unit)}. ${unsized}`;
  }
  const operand = levelOf(byId.get(found.through));
  const count = be.operand_count !== undefined && operand.raw !== undefined
    ? ` (about ${be.operand_count} of your ${sayFigure(operand.raw, operand.unit ?? '')})`
    : '';
  const pct = Math.round(be.fraction! * 1000) / 10;
  return `${holds} ${outcome} it ${verb} more than about ${pct}% of ${part}${count}. ${unsized}`;
}
