/**
 * ⭐ A USER'S OWN PER-UNIT SIZE FITS THE MODEL'S FRAMES (the clamp's root; AIQ 5895140735, R3 5893508312 / 5894964169,
 * R3-B 5895208669; DL lease 5895185190).
 *
 * A link's stored size is β = b · F_source / F_target, and the contract bounds |β| ≤ 1. Served `c96fc4bb`: "£49 per
 * subscriber" on subscribers' frame 10,000 over MRR's 106,250 is β = 4.61, which PLoT cuts to 1 (and #422 then withholds
 * the goal figures). A frame is a choice of UNITS, so the fix is to move a frame, changing nothing the user sees in
 * natural units except that the cut disappears (AIQ's frame invariance):
 *  · every link touching a re-framed node keeps its natural size: β_new = β_old · (F_X,new / F_X,old) · (F_Y,old / F_Y,new),
 *    DEFAULT links included, and a stated `natural_effect` keeps its `strength_mean` current;
 *  · every raw level and the goal's raw target stay; each normalised value is raw / F_new;
 *  · a node's sampled spread stays in natural units: only a REAL `observed_state.std` is carried (std · F_old / F_new),
 *    never minted (R3-B: PLoT treats any CEE std as priority 1); a move that would shift a synthesised spread (PLoT's
 *    0.1 floor) or bind the 2.0 cap is refused.
 *
 * v1 moves ONE kind of frame: the stated link's TARGET is widened to the smallest {1, 2, 5}·10^k frame that fits (AIQ's
 * `c96` ruling: MRR 106,250 → 500,000, β 4.61 → 0.98, `pro_plan_price → mrr` 0.5 → 0.106, the same £265.6 per £1). A goal
 * has no out-links, so widening it moves no other β up; an outcome's or a risk's out-links move up by the same factor, and
 * the new-cut guard refuses any move that would cut one (A4f). It is REFUSED (the clamp and #422's withhold stay) when:
 *  · the target is a FACTOR (its sampled spread; PR Review CR on #2314);
 *  · the target has no frame, or an option SETS it, or a limit NAMES it (their rescaling is not in v1: named under-claim);
 *  · the move would put ANY link at |β| > 1 (a new cut), or move a sampled spread.
 * Tightening the source (AIQ's F_S floor, 5894561359) is not built in v1: on `c96` it makes two new cuts (AIQ).
 * PURE: the input graph is never mutated.
 */
type Rec = Record<string, any>;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const above1 = (v: unknown): v is number => num(v) && v > 1;
const [MIN_STD, MAX_STD] = [1e-4, 2.0];
const TOL = 1e-9;

export interface FrameRefit {
  readonly node: string;
  readonly from: number;
  readonly to: number;
  /** The user-stated link it was widened for ("paying_subscribers→mrr"). */
  readonly for_link: string;
}
export interface FrameRefusal {
  readonly link: string;
  readonly reason: 'no_frame' | 'not_the_goal' | 'levels_set_on_node' | 'new_cut' | 'spread_would_move' | 'bounded_scale';
  /** For `new_cut`: the link that would be cut instead. */
  readonly detail?: string;
}

/** A node's frame in CEE's reading order (`resolveMagnitudeFrame`): scale_frame → cap → goal cap → raw/value. */
export function frameOf(n: Rec | undefined): number | undefined {
  if (n === undefined) return undefined;
  if (above1(n.scale_frame)) return n.scale_frame;
  const os = n.observed_state ?? {};
  if (above1(os.cap)) return os.cap;
  if (n.kind === 'goal' && above1(n.goal_threshold_cap)) return n.goal_threshold_cap;
  if (num(os.raw_value) && num(os.value) && os.value !== 0) {
    const f = os.raw_value / os.value;
    if (Number.isFinite(f) && f > 0) return f;
  }
  return undefined;
}

/** The smallest {1, 2, 5}·10^k at or above x. */
/**
 * ⛔ A BOUNDED SCALE'S TOP IS NEVER WIDENED (AIQ 5895590866 (1)): "out of 5" bounds what the quantity can be, it is not a
 * choice of units. The natural top of a bounded unit, else undefined (money, counts and a % CHANGE are not bounded). The
 * same reading as R3's oracle (`tests/helpers/frame-invariance.ts` `naturalTop`, #2308).
 */
export function naturalTop(n: Rec | undefined): number | undefined {
  const u = String(n?.observed_state?.unit ?? n?.unit ?? '').toLowerCase().trim();
  const outOf = /out of\s*(\d+(?:\.\d+)?)/.exec(u);
  if (outOf) return Number(outOf[1]);
  if (/\b(stars?|rating)\b/.test(u)) return 5;
  if (/\bnps\b/.test(u)) return 100;
  if (/^(%|percent|percentage)$/.test(u)) return 100; // a share or probability; a % CHANGE is not bounded
  return undefined;
}

export function niceFrameAtLeast(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5, 10]) if (m * p >= x * (1 - TOL)) return m * p;
  return 10 * p;
}

const usersLevel = (n: Rec): boolean => {
  const s = n.observed_state?.source;
  return s === 'brief_extraction' || (typeof s === 'string' && s.startsWith('user'));
};

/** Whether a move of `n` from `Fold` to `F` would shift the spread PLoT samples for it, in natural units. */
function spreadWouldMove(n: Rec, Fold: number, F: number): boolean {
  const os = n.observed_state;
  // ⭐ A4f (R3 #75 5923477350): keyed on HOLDING a sampled level, not on kind: an outcome or risk that holds one keeps
  // this guard once outcomes can be widened. The goal reads as before.
  if (n.kind === 'goal' || os === undefined || !num(os.value)) return false;
  if (num(os.std) && os.std > 0) {
    const carried = (os.std * Fold) / F;
    return carried < MIN_STD || carried > MAX_STD || os.std < MIN_STD || os.std > MAX_STD;
  }
  if (usersLevel(n) || os.value === 0) return false; // sent exact, or held exact / scaled by option levels
  const k = Fold / F;
  const before = Math.max(0.1, 0.15 * Math.abs(os.value)) * Fold;
  const after = Math.max(0.1, 0.15 * Math.abs(os.value * k)) * F;
  return Math.abs(before - after) > TOL * Math.max(1, before);
}

const key = (e: Rec): string => `${e.from}→${e.to}`;
const userStated = (e: Rec): boolean => e.provenance?.magnitude === 'user_stated';
/**
 * ⭐ R3 #75 5923914386 FINDING 1 (DL 5923941128): the whole holds its parts. A DEFINITIONAL link (±1 in one unit, typed by
 * admission's `definitionalLink`) is exact by definition, like a user's size, so a frame that cuts it is refit the same
 * way. Served dry run `train-0258Z`: after "at least £1m" the goal's frame became the target's cap (£1.25m) and Olumi's
 * £1-per-£1 "Funding from investment firms → Funding secured" (outcome frame £3m) sat at β 2.4: PLoT clamped it and the UI
 * cold open declined the Run (CANVAS 5923984462). Its origin and its disclosure are unchanged: only frames move.
 */
const sizedExactly = (e: Rec): boolean => userStated(e) || e.provenance?.definitional === true;

const clampedFrom = (e: Rec): number | undefined => (num(e?.provenance?.clamped_from) ? e.provenance.clamped_from : undefined);

/**
 * ⭐ CLAMP AT PERSIST (DL #75 5924108406; R3 5924108105 / 5924114341; AIQ 5924120672; CODEX 5924186955 / 5924209469).
 * A stored |mean| > 1 breaks the WHOLE model: `assertIngressGraphNumericBounds` refuses every later write ("Not saved",
 * 52f8cd 5924036192) and the UI cold open declines its Run (CANVAS 5923984462). PLoT clamps it to ±1 at parse anyway, so
 * the analysis is the same: a link no refit could fit is STORED at ±1 (sign kept, its spread scaled with it) with
 * `provenance.clamped_from` = its full β. `EdgeStrengthV3` is a strict {mean, std}, so the marker rides the provenance,
 * which passes through. `natural_effect` is never touched: the user's figure and range stay byte-exact, and its
 * `strength_mean` keeps the full β, so the readers that trust a natural size only while it is the β analysed
 * (`placeholder-parts`) read a clamped link as not analysed at the user's size, which is true.
 */
export function clampForPersist<G>(graph: G): G {
  const over = (e: Rec): boolean => num(e?.strength?.mean) && Math.abs(e.strength.mean) > 1 + TOL;
  const edges = (graph as Rec | null)?.edges;
  if (!Array.isArray(edges) || !edges.some(over)) return graph;
  const g = structuredClone(graph) as Rec;
  for (const e of g.edges as Rec[]) {
    if (!over(e)) continue;
    const full = e.strength.mean as number;
    e.strength = { ...e.strength, mean: Math.sign(full), ...(num(e.strength.std) ? { std: e.strength.std / Math.abs(full) } : {}) };
    e.provenance = { ...(e.provenance ?? {}), clamped_from: full };
  }
  return g as G;
}

/**
 * Every stored clamp undone: each marked link back at its full β, its spread with it, the marker dropped. Every refit, the
 * F4 retirement and the run's wire copy start here (R3 5924114341: re-derive from the user's size, never from the stored
 * ±1), so a later fit restores the full size, and PLoT is sent what it always was (it clamps, marks and withholds itself).
 */
export function withStatedStrengths<G>(graph: G): G {
  const edges = (graph as Rec | null)?.edges;
  if (!Array.isArray(edges) || !edges.some((e: Rec) => clampedFrom(e) !== undefined)) return graph;
  const g = structuredClone(graph) as Rec;
  for (const e of g.edges as Rec[]) {
    const full = clampedFrom(e);
    if (full === undefined) continue;
    delete e.provenance.clamped_from;
    // ⛔ A STALE MARKER IS DROPPED, NEVER APPLIED (CODEX 5924209469): the marker speaks only while the link still holds the
    // clamp it was written with (±1, the same sign) and its natural size, where it has one, still records that β. Any
    // later write of the strength or of the size (an edge edit, a link-effect answer) leaves it stale: the edit stands.
    const ne = e.provenance?.natural_effect;
    const stillTheClamp = num(e.strength?.mean) && Math.abs(Math.abs(e.strength.mean) - 1) <= TOL && Math.sign(e.strength.mean) === Math.sign(full)
      && (!num(ne?.strength_mean) || Math.abs(ne.strength_mean - full) <= TOL * Math.max(1, Math.abs(full)));
    if (!stillTheClamp) continue;
    e.strength = { ...e.strength, mean: full, ...(num(e.strength?.std) ? { std: e.strength.std * Math.abs(full) } : {}) };
  }
  return g as G;
}

function reframed(graph: Rec, id: string, F: number): Rec {
  const g: Rec = structuredClone(graph);
  const node = (g.nodes as Rec[]).find((n) => n.id === id)!;
  const Fold = frameOf(node)!;
  const k = Fold / F;
  const os = node.observed_state;
  if (os !== undefined) {
    if (num(os.value)) os.value *= k;
    if (num(os.baseline)) os.baseline *= k;
    if (num(os.std) && os.std > 0) os.std *= k;
  }
  if (above1(node.scale_frame)) node.scale_frame = F;
  else if (os !== undefined && above1(os.cap)) os.cap = F;
  if (node.kind === 'goal') {
    node.goal_threshold_cap = F;
    node.goal_threshold_cap_provenance = 'stated_effect_fit';
    // A relative change is scale-free (`change_rel`: the fraction r); a level or an absolute change is raw / cap.
    if (num(node.goal_threshold) && node.goal_threshold_frame !== 'change_rel') node.goal_threshold *= k;
  }
  const frames = new Map((g.nodes as Rec[]).map((n) => [n.id, frameOf(n)]));
  for (const e of g.edges as Rec[]) {
    const scale = e.from === id ? F / Fold : e.to === id ? Fold / F : 1;
    if (scale === 1 || frames.get(e.from === id ? e.to : e.from) === undefined) continue; // structural edge
    if (num(e.strength?.mean)) e.strength.mean *= scale;
    if (num(e.strength?.std)) e.strength.std *= scale;
    const ne = e.provenance?.natural_effect;
    if (ne !== undefined && num(ne.strength_mean)) ne.strength_mean *= scale;
  }
  return g;
}

/** Links out of the contract (|β| > 1) between two framed nodes. */
function cuts(g: Rec): Rec[] {
  const frames = new Map((g.nodes as Rec[]).map((n) => [n.id, frameOf(n)]));
  return (g.edges as Rec[]).filter((e) => num(e.strength?.mean) && Math.abs(e.strength.mean) > 1 + TOL
    && frames.get(e.from) !== undefined && frames.get(e.to) !== undefined);
}

/**
 * `goalOwnRows`: the goal's OWN target/limit rows (`goal_constraints` naming the goal) do not refuse a goal widen. Opt-in,
 * passed only by `retireNormalisingGoalFrame` (F4, R3 #75 5922368144): those rows hold the RAW figure, and `reframed`
 * rescales the goal's normalised threshold and level with the frame, so the target the user approved reads the same.
 * Every other caller keeps v1's refusal byte for byte.
 */
export function refitFramesForStatedEffects(graph: Rec, opts: { readonly goalOwnRows?: boolean } = {}): { readonly graph: Rec; readonly refits: FrameRefit[]; readonly refused: FrameRefusal[] } {
  let g = withStatedStrengths(graph);
  const refits: FrameRefit[] = [];
  const refused: FrameRefusal[] = [];
  const tried = new Set<string>();
  for (;;) {
    const e = cuts(g).find((x) => sizedExactly(x) && !tried.has(key(x)));
    if (e === undefined) break;
    tried.add(key(e));
    const target = (g.nodes as Rec[]).find((n) => n.id === e.to);
    const Fold = frameOf(target);
    if (target === undefined || Fold === undefined) { refused.push({ link: key(e), reason: 'no_frame' }); continue; }
    const F = niceFrameAtLeast(Math.abs(e.strength.mean) * Fold);
    const why = widenRefusal(g, target, Fold, F, opts);
    if (why !== undefined) { refused.push({ link: key(e), reason: why }); continue; }
    let next = reframed(g, target.id, F);
    const chain: FrameRefit[] = [{ node: target.id, from: Fold, to: F, for_link: key(e) }];
    /**
     * ⭐ A4f CASCADE (R3's named follow-up at the cut line; MG #75 5923704064). Widening a node moves its OUT-links up by
     * the same factor, so a widen can cut the very link that carries the user's size on. Fresh draft `a4b2-p3`: deals 10 →
     * outcome £3m held £1m per deal at β 3.33; the outcome at £10m put its definitional out-link into the £5m goal at β 2,
     * and v1 refused it, so the user's size stayed cut. A new cut on a widened node's out-link is fitted by widening ITS
     * target the same way, by the same guards (`widenRefusal`); accepted only when no new cut is left.
     */
    // Monotone and bounded (R3 5923709789 (2)): frames only grow, each node is widened at most ONCE per chain, to fit every
    // new cut into it at that moment; a cut that would need a second widen, or any refusal, rolls the whole chain back.
    let newCut: Rec | undefined;
    for (;;) {
      const fresh = cuts(next).filter((x) => !cuts(g).some((y) => key(y) === key(x)));
      newCut = fresh[0];
      if (newCut === undefined) break;
      const down = (next.nodes as Rec[]).find((n) => n.id === newCut!.to);
      const Fd = frameOf(down);
      if (down === undefined || Fd === undefined || chain.some((c) => c.node === down.id) || !chain.some((c) => c.node === newCut!.from)) break;
      const into = fresh.filter((x) => x.to === down.id);
      const Fn = niceFrameAtLeast(Math.max(...into.map((x) => Math.abs(x.strength.mean))) * Fd);
      if (widenRefusal(next, down, Fd, Fn, opts) !== undefined) break;
      next = reframed(next, down.id, Fn);
      chain.push({ node: down.id, from: Fd, to: Fn, for_link: key(into[0]!) });
    }
    if (newCut !== undefined) { refused.push({ link: key(e), reason: 'new_cut', detail: key(newCut) }); continue; }
    g = next;
    refits.push(...chain);
  }
  return { graph: g, refits, refused };
}

/** Why `target` may not be widened from `Fold` to `F` (v1's guards, one per node, the cascade's included), else undefined. */
function widenRefusal(g: Rec, target: Rec, Fold: number, F: number, opts: { readonly goalOwnRows?: boolean }): FrameRefusal['reason'] | undefined {
  // ⛔ PR Review CR on #2314 @ 72b9daed: a FACTOR's frame is never widened. A factor's level with no `std` is sampled by
  // PLoT with a normal spread (`max(0.1, 0.15·|value|)` of its frame), so widening a factor would move its natural
  // uncertainty while holding its link size; a factor target stays clamped.
  // ⭐ A4f (R3 #75 5923240262, DL 5923244548): an OUTCOME or a RISK is computed from its parents, so widening one is a pure
  // change of units. Served paul-1 (`d23f5df1`): the user's £1,000,000 per deal landed on "Investment-firm funding
  // secured" (frame £5m, deals frame 10), β 2, cut, and the reply said the run could not use it at full size.
  if (target.kind === 'factor') return 'not_the_goal';
  const setByOption = (g.nodes as Rec[]).some((n) => n.kind === 'option' && n.interventions !== null && typeof n.interventions === 'object'
    && Object.prototype.hasOwnProperty.call(n.interventions, target.id));
  const namedByLimit = !(opts.goalOwnRows === true && target.kind === 'goal')
    && Array.isArray(g.goal_constraints) && g.goal_constraints.some((c: Rec) => c?.node_id === target.id);
  if (setByOption || namedByLimit) return 'levels_set_on_node';
  const top = naturalTop(target);
  if (top !== undefined && F > top * (1 + TOL)) return 'bounded_scale';
  if (spreadWouldMove(target, Fold, F)) return 'spread_would_move';
  return undefined;
}
