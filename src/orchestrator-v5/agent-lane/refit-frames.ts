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
 * has no out-links, so widening it moves no other β up. It is REFUSED (the clamp and #422's withhold stay) when:
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
  readonly reason: 'no_frame' | 'levels_set_on_node' | 'new_cut' | 'spread_would_move';
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
  if (n.kind !== 'factor' || os === undefined || !num(os.value)) return false;
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

export function refitFramesForStatedEffects(graph: Rec): { readonly graph: Rec; readonly refits: FrameRefit[]; readonly refused: FrameRefusal[] } {
  let g = graph;
  const refits: FrameRefit[] = [];
  const refused: FrameRefusal[] = [];
  const tried = new Set<string>();
  for (;;) {
    const e = cuts(g).find((x) => userStated(x) && !tried.has(key(x)));
    if (e === undefined) break;
    tried.add(key(e));
    const target = (g.nodes as Rec[]).find((n) => n.id === e.to);
    const Fold = frameOf(target);
    if (target === undefined || Fold === undefined) { refused.push({ link: key(e), reason: 'no_frame' }); continue; }
    const setByOption = (g.nodes as Rec[]).some((n) => n.kind === 'option' && n.interventions !== null && typeof n.interventions === 'object'
      && Object.prototype.hasOwnProperty.call(n.interventions, target.id));
    const namedByLimit = Array.isArray(g.goal_constraints) && g.goal_constraints.some((c: Rec) => c?.node_id === target.id);
    if (setByOption || namedByLimit) { refused.push({ link: key(e), reason: 'levels_set_on_node' }); continue; }
    const F = niceFrameAtLeast(Math.abs(e.strength.mean) * Fold);
    if (spreadWouldMove(target, Fold, F)) { refused.push({ link: key(e), reason: 'spread_would_move' }); continue; }
    const next = reframed(g, target.id, F);
    const newCut = cuts(next).find((x) => !cuts(g).some((y) => key(y) === key(x)));
    if (newCut !== undefined) { refused.push({ link: key(e), reason: 'new_cut', detail: key(newCut) }); continue; }
    g = next;
    refits.push({ node: target.id, from: Fold, to: F, for_link: key(e) });
  }
  return { graph: g, refits, refused };
}
