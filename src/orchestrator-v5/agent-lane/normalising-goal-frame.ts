/**
 * ⭐ F4 — A TARGET OR A LEVEL RETIRES THE NORMALISING FRAME (R3 #75 5922368144; DL 5922465512).
 *
 * A £ goal built with no target and no level is read on a normalising `scale_frame` (`admit-model.ts`, R3 5922308054):
 * a choice of UNITS so the user's own £ sizes into it can be carried at all. The analysis must be a function of the
 * current facts, never of the order they arrived in, so the moment a target or a level lands on that goal the frame
 * goes, and the goal is read exactly as a construction with that target would read it:
 *  · the goal's frame becomes the one its target or level carries (`frameOf`: cap → goal cap → raw/value);
 *  · every link into it whose size is the USER's or holds BY DEFINITION is re-derived from its natural size, which is
 *    unchanged: β, its spread and `natural_effect.strength_mean` all scale by F_old / F_new (β = b · F_source / F_goal);
 *  · Olumi's placeholders keep their β (R3: they were never in natural units);
 *  · then the same frame refit construction runs (`refitFramesForStatedEffects`), so a user size the new frame would
 *    cut is widened exactly as it would have been, the goal's OWN target row included (`goalOwnRows`: the card writes
 *    one, holding the raw figure, and the widen rescales the goal's normalised threshold with the frame).
 * A goal's `scale_frame` exists ONLY as the normalising frame (`refit-frames` writes one only where one was already
 * there), so its presence is the marker. With no frame to move to (no cap, no level) nothing changes: never a half state.
 * PURE: returns the graph itself when there is nothing to retire, otherwise a new one.
 */
import { frameOf, refitFramesForStatedEffects } from './refit-frames.js';

type Rec = Record<string, any>;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function retireNormalisingGoalFrame<G>(graph: G): G {
  const nodes = (graph as Rec | null)?.nodes;
  if (!Array.isArray(nodes)) return graph;
  const goal = nodes.find((n: Rec) => n?.kind === 'goal');
  if (goal === undefined || !(num(goal.scale_frame) && goal.scale_frame > 1)) return graph;
  const os = goal.observed_state ?? {};
  if (!(num(goal.goal_threshold_raw) || num(os.raw_value) || num(os.baseline))) return graph;
  const g = structuredClone(graph) as Rec;
  const node = (g.nodes as Rec[]).find((n) => n.id === goal.id)!;
  const from = node.scale_frame as number;
  delete node.scale_frame;
  const to = frameOf(node);
  if (to === undefined) return graph;
  const k = from / to;
  for (const e of (g.edges ?? []) as Rec[]) {
    const p = e?.provenance;
    if (e?.to !== node.id || !(p?.magnitude === 'user_stated' || p?.definitional === true)) continue;
    if (num(e.strength?.mean)) e.strength.mean *= k;
    if (num(e.strength?.std)) e.strength.std *= k;
    if (num(p.natural_effect?.strength_mean)) p.natural_effect.strength_mean *= k;
  }
  return refitFramesForStatedEffects(g, { goalOwnRows: true }).graph as G;
}
