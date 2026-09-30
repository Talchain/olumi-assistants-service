/**
 * ⛔ GATE 5 — A GOAL THE USER'S OWN FIGURES MAKE AS A PRODUCT HAS NO FIGURES FROM A RUN THAT DID NOT READ IT THAT WAY
 * (DL #75 5904272507; AIQ 5904262145 + 5904286130; P0 partner rows 5904282153).
 *
 * Served MRR on CEE `ef042ce` (R3 #2339 row (b), guest `c8108752`, draft `m0`): the brief's "£49 … 1,500 paying subscribers
 * … £75k MRR" drafted MRR with price and subscribers as two default links, beside an invented "Non-Pro MRR £1,500". No
 * identity, no placeholder mark, nothing withheld: Run 1 said "Raise to £59 is the provisional leading option" and
 * "£59 → £75.0k–£78.4k", where 1,500 × £59 is £88,500. Those figures come from an additive walk the user's own numbers
 * contradict.
 *
 * THE RULE: the goal's level o and two factor levels a, b on its paths are all the user's (`brief_extraction` / `user*`),
 * |o − a·b| ≤ 5% of |o| (ISL's tolerance, `RECONCILIATION_TOLERANCE`), and the units compose as a rate × its count in the
 * goal's currency and period (`unitsCompose`, not `no`), yet no node on the goal's path declares a product whose two
 * factors are a and b, or are derived from them (a month-12 count from today's).
 * Then every option's goal figures, win shares and the leader are withheld (`withholdOptionGoalFigures`) with one typed
 * code. A DECLARED product is read either way: evaluated, or PLoT withheld the run itself (#416, `identity on the goal's
 * path not evaluated`) and this never runs. A level of ±1 is no reading (anything × 1 is itself). Pure.
 */
import { RECONCILIATION_TOLERANCE, unitsCompose } from './reconciling-product.js';
import { sayFigure } from './say-figure.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
/** The user's own level: from the brief, or one they typed or approved (the certainty rule's `userOwns`). */
const userOwns = (source: unknown): boolean =>
  typeof source === 'string' && (source === 'brief_extraction' || source.startsWith('user'));

/** The reconciling product this run did not read: the goal and its two parts, each with the user's level and unit. */
export interface UnreadGoalProduct {
  /** `typed`: the user WROTE the goal's level (brief, chat); a level they only ratified is Olumi's (#2333 class). */
  readonly goal: { readonly id: string; readonly label: string; readonly level: number; readonly unit: string; readonly typed: boolean };
  readonly rate: { readonly id: string; readonly label: string; readonly level: number; readonly unit: string };
  readonly count: { readonly id: string; readonly label: string; readonly level: number; readonly unit: string };
}

/** The user's level in their own units: `raw_value`, else `value` when the node declares no model scale. */
function userLevel(n: Rec): { level: number; unit: string } | undefined {
  const os = isRec(n.observed_state) ? n.observed_state : undefined;
  if (os === undefined || !userOwns(os.source)) return undefined;
  const scaled = os.cap !== undefined || os.declared_scale !== undefined;
  const level = num(os.raw_value) ?? (scaled ? undefined : num(os.value));
  const unit = text(os.unit) ?? text(n.unit);
  return level === undefined || level === 0 || Math.abs(level) === 1 || unit === undefined ? undefined : { level, unit };
}

export function unreadGoalProduct(graph: unknown): UnreadGoalProduct | null {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return null;
  const nodes = graph.nodes.filter(isRec);
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const goal = nodes.find((n) => n.kind === 'goal');
  if (goal === undefined || typeof goal.id !== 'string') return null;
  const os = isRec(goal.observed_state) ? goal.observed_state : undefined;
  const o = num(os?.raw_value);
  const goalUnit = text(os?.unit) ?? text(goal.goal_threshold_unit);
  const goalLabel = text(goal.label) ?? goal.id;
  if (o === undefined || o === 0 || !userOwns(os?.source) || goalUnit === undefined) return null;
  // Every node with a path to the goal (options and the decision aside).
  const onPath = new Set<unknown>([goal.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) {
      const k = byId.get(e.from)?.kind;
      if (onPath.has(e.to) && !onPath.has(e.from) && k !== undefined && k !== 'option' && k !== 'decision') { onPath.add(e.from); grew = true; }
    }
  }
  const parentsOf = new Map<unknown, unknown[]>();
  for (const e of edges) parentsOf.set(e.to, [...(parentsOf.get(e.to) ?? []), e.from]);
  /** `part` is `f` itself or one of its ancestors: a factor derived from it carries it (a month-12 count from today's). */
  const carries = (f: unknown, part: string): boolean => {
    const seen = new Set<unknown>([f]);
    const walk = [f];
    while (walk.length > 0) {
      const at = walk.pop();
      if (at === part) return true;
      for (const p of parentsOf.get(at) ?? []) if (!seen.has(p)) { seen.add(p); walk.push(p); }
    }
    return false;
  };
  // READ: a product declared on the goal's path (the goal's own, or a part-total's) whose two factors carry the two parts,
  // each directly or derived from it (P0 partner #2340 5904465928: served m1/m8 read `price × subscribers at month 12`,
  // derived from today's count — after the user's Yes that IS the product, projected).
  const read = (a: string, b: string): boolean => nodes.some((n) => {
    const id = isRec(n.nonlinear_identity) ? n.nonlinear_identity : undefined;
    if (id === undefined || id.operation !== 'product' || !onPath.has(n.id) || !Array.isArray(id.factor_ids)) return false;
    const fs = id.factor_ids as unknown[];
    return fs.some((fa) => carries(fa, a) && fs.some((fb) => fb !== fa && carries(fb, b)));
  });
  const parts = nodes.filter((n) => n.kind === 'factor' && typeof n.id === 'string' && onPath.has(n.id))
    .flatMap((n) => { const l = userLevel(n); return l === undefined ? [] : [{ id: n.id as string, label: text(n.label) ?? (n.id as string), ...l }]; });
  let found: UnreadGoalProduct | null = null;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i]!;
      const b = parts[j]!;
      if (Math.abs(o - a.level * b.level) > RECONCILIATION_TOLERANCE * Math.abs(o)) continue;
      const c = unitsCompose(goalUnit, goalLabel, a, b);
      if (c.kind === 'no' || read(a.id, b.id)) continue;
      const [rate, count] = c.rate === a.label ? [a, b] : [b, a];
      const typed = os?.source === 'brief_extraction' || os?.source === 'user_override' || os?.source === 'user_stated';
      const product = { goal: { id: goal.id, label: goalLabel, level: o, unit: goalUnit, typed }, rate, count };
      if (c.kind === 'proof') return product;
      found ??= product;
    }
  }
  return found;
}

/**
 * The ONE typed warning (`GOAL_FIGURES_PRODUCT_NOT_READ`), in the UI's "Not shown." register. It names the reading Olumi
 * did not make, in the user's own figures, and promises nothing: the card that offers the reading is a separate door.
 */
export function unreadGoalProductWarning(
  p: UnreadGoalProduct,
  optionIds: readonly string[],
  code: string,
): { code: string; message: string; severity: 'warning'; node_ids: string[]; option_ids: string[] } {
  const product = p.rate.level * p.count.level;
  const same = Math.abs(product - p.goal.level) < 1e-9 * Math.abs(p.goal.level);
  const sum = `${sayFigure(p.rate.level, p.rate.unit)} × ${sayFigure(p.count.level, p.count.unit)} = ${sayFigure(product, p.goal.unit)}`;
  const message = `Not shown. Olumi has not read ‘${p.goal.label}’ as ‘${p.rate.label}’ × ‘${p.count.label}’ (${sum}, `
    + `${same ? '' : 'close to '}${p.goal.typed ? 'your' : 'the goal’s current'} ${sayFigure(p.goal.level, p.goal.unit)}), so this run can’t say how likely any option is `
    + 'to reach the goal, what it would reach, or which option does best.';
  return {
    code,
    message: message.length <= 400 ? message
      : `Not shown. Olumi has not read ‘${p.goal.label}’ as a product of your own figures, so this run can’t say how likely any option is to reach the goal, what it would reach, or which option does best.`,
    severity: 'warning',
    node_ids: [p.goal.id, p.rate.id, p.count.id],
    option_ids: [...optionIds],
  };
}
