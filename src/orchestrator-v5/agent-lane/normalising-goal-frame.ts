/**
 * ⭐ F4 — A TARGET OR A LEVEL RETIRES THE NORMALISING FRAME (R3 #75 5922368144; DL 5922465512).
 *
 * A £ goal built with no target and no level is read on a normalising `scale_frame` (`admit-model.ts`, R3 5922308054):
 * a choice of UNITS so the user's own £ sizes into it can be carried at all. The analysis must be a function of the
 * current facts, never of the order they arrived in, so the moment a target or a level lands on that goal the frame
 * goes, and the goal is read exactly as a construction with that target would read it:
 *  · the goal's frame becomes the one its target or level carries (`frameOf`: cap → goal cap → raw/value);
 *  · every link into it whose size is the USER's, holds BY DEFINITION, or is a current Olumi natural estimate is
 *    re-derived from its unchanged natural size: β, its spread and `natural_effect.strength_mean` all scale by
 *    F_old / F_new (β = b · F_source / F_goal);
 *  · Olumi's placeholders keep their β (R3: they were never in natural units);
 *  · then the same frame refit construction runs (`refitFramesForStatedEffects`), so a user size the new frame would
 *    cut is widened exactly as it would have been, the goal's OWN target row included (`goalOwnRows`: the card writes
 *    one, holding the raw figure, and the widen rescales the goal's normalised threshold with the frame).
 *  · any Olumi estimate still outside |β| ≤ 1 returns to admission's unsized placeholder, with its guess set aside;
 *    only the other classes reach the existing clamp (DL 58e392).
 * A goal's `scale_frame` exists ONLY as the normalising frame (`refit-frames` writes one only where one was already
 * there), so its presence is the marker. With no frame to move to (no cap, no level) nothing changes: never a half state.
 * PURE: returns the graph itself when there is nothing to retire, otherwise a new one.
 */
import { clampForPersist, frameOf, refitFramesForStatedEffects, withStatedStrengths } from './refit-frames.js';
import { STRENGTH_DEFAULT_SIGNATURE } from '@talchain/schemas';
import { statementWords, type MagnitudeNode } from '../../cee/magnitude/link-effect.js';
import { SET_ASIDE_ESTIMATE_LABEL } from './admit-candidate.js';

type Rec = Record<string, any>;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export type SetAsideEstimate = { from: string; to: string; estimate: string };
export const setAsideEstimateDisclosure = (s: SetAsideEstimate): string => `${SET_ASIDE_ESTIMATE_LABEL}: ${s.estimate}`;

/** Read the recorded size in its own units, including admission's point and switch vocabulary. */
const inNaturalUnits = (node: Rec, unit: string): MagnitudeNode => ({ ...node, label: node.label, option_levels: [],
  observed_state: { ...node.observed_state, unit: unit === 'percentage points' ? '%' : unit,
    ...(unit === 'switch' ? { value: 0 } : {}) }, unit });
const naturalUnitFrame = (node: Rec, unit: string): number | undefined =>
  unit === 'percentage points' ? 100 : unit === 'switch' ? 1 : frameOf(node);

export function retireNormalisingGoalFrame<G>(graph: G): G {
  return retireNormalisingGoalFrameWithSetAside(graph).graph;
}

export function retireNormalisingGoalFrameWithSetAside<G>(graph: G): { graph: G; setAside: SetAsideEstimate[] } {
  const unchanged = { graph, setAside: [] };
  const nodes = (graph as Rec | null)?.nodes;
  if (!Array.isArray(nodes)) return unchanged;
  const goal = nodes.find((n: Rec) => n?.kind === 'goal');
  if (goal === undefined || !(num(goal.scale_frame) && goal.scale_frame > 1)) return unchanged;
  const os = goal.observed_state ?? {};
  if (!(num(goal.goal_threshold_raw) || num(os.raw_value) || num(os.baseline))) return unchanged;
  // A stored clamp is undone first (re-derived from the full β, never from the stored ±1), and re-applied at the end.
  const g = withStatedStrengths(structuredClone(graph)) as Rec;
  const node = (g.nodes as Rec[]).find((n) => n.id === goal.id)!;
  const from = node.scale_frame as number;
  delete node.scale_frame;
  const to = frameOf(node);
  if (to === undefined) return unchanged;
  rescaleSizedInLinks(g, node.id, from / to);
  return refitAndSetAside<G>(g);
}

/** DL 58e392: after the user-size refit, an estimate that no longer fits returns to admission's unsized placeholder. */
function refitAndSetAside<G>(g: Rec): { graph: G; setAside: SetAsideEstimate[] } {
  const refitted = refitFramesForStatedEffects(g, { goalOwnRows: true }).graph;
  const setAside: SetAsideEstimate[] = [];
  for (const e of (refitted.edges ?? []) as Rec[]) {
    if (e.provenance?.magnitude !== 'olumi_estimate' || !num(e.strength?.mean) || Math.abs(e.strength.mean) <= 1 + 1e-9) continue;
    const natural = e.provenance.natural_effect;
    const source = refitted.nodes.find((n: Rec) => n.id === e.from);
    const target = refitted.nodes.find((n: Rec) => n.id === e.to);
    // Natural sizes retain their own units even when the canonical node parser drops a drafter's top-level unit.
    setAside.push({ from: e.from, to: e.to, estimate: source && target && num(natural?.amount) && num(natural?.per_source_change)
      ? statementWords(natural.amount, natural.per_source_change,
        inNaturalUnits(source, natural.per_source_change_unit), inNaturalUnits(target, natural.amount_unit),
        naturalUnitFrame(source, natural.per_source_change_unit), naturalUnitFrame(target, natural.amount_unit)) : 'as given' });
    e.strength = { mean: e.effect_direction === 'negative' ? -STRENGTH_DEFAULT_SIGNATURE.mean : STRENGTH_DEFAULT_SIGNATURE.mean,
      std: STRENGTH_DEFAULT_SIGNATURE.std };
    e.provenance.magnitude = 'olumi_placeholder';
    e.provenance.mean_projected = true;
    e.defaulted = true;
    delete e.provenance.natural_effect;
    delete e.provenance.basis;
    delete e.provenance.clamped_from;
  }
  return { graph: clampForPersist(refitted) as G, setAside };
}

/** Sized links carry natural units; an Olumi estimate qualifies only while its recorded natural size is current. */
const sizedIntoGoal = (e: Rec, goalId: string): boolean =>
  e?.to === goalId && (e?.provenance?.magnitude === 'user_stated' || e?.provenance?.definitional === true
    || (e?.provenance?.magnitude === 'olumi_estimate' && num(e.strength?.mean)
      && num(e.provenance.natural_effect?.strength_mean)
      && Math.abs(e.provenance.natural_effect.strength_mean - e.strength.mean) <= 1e-9 * Math.abs(e.strength.mean)));

/** Every such link's β, spread and `natural_effect.strength_mean` scaled by F_old / F_new: its natural size unchanged. */
function rescaleSizedInLinks(g: Rec, goalId: string, k: number): void {
  for (const e of (g.edges ?? []) as Rec[]) {
    if (!sizedIntoGoal(e, goalId)) continue;
    const p = e.provenance;
    if (num(e.strength?.mean)) e.strength.mean *= k;
    if (num(e.strength?.std)) e.strength.std *= k;
    if (num(p.natural_effect?.strength_mean)) p.natural_effect.strength_mean *= k;
  }
}

/**
 * ⭐ D1 B — THE GOAL'S FRAME MOVED UNDER ITS LEVEL, SO ITS SIZED LINKS MOVE WITH IT (DL #85 5930770727; R3 5930715560 (a)).
 *
 * The target writer (`add-constraint.ts`, the goal-target stamp) keeps a stored level on the target's cap in the SAME write
 * (value = baseline = raw_value / goal cap). The level's `cap` is the goal's frame (`frameOf`: cap → goal cap), so that
 * rescale MOVES the frame every link into the goal is read on — Paul's "£100,000 today" carded on its own (cap £125,000),
 * then "double that" (cap £250,000). A user-sized, definitional or current Olumi-estimated link into the goal was
 * sized on the OLD frame
 * (β = b · F_source / F_goal), so left alone its natural size would double with the frame: the analysis would depend on
 * the ORDER the facts arrived in, which F4 rules out. So it is re-derived from its unchanged natural size by the SAME rule
 * and the SAME refit the normalising-frame retirement uses (above): β, spread and natural size × F_old / F_new; Olumi's
 * placeholders keep their β (never in natural units); then the frame refit construction runs, any remaining oversized
 * Olumi estimate is set aside, and the other classes keep the existing clamp.
 *
 * `from` is the frame the goal was read on BEFORE the write. A goal still on its normalising `scale_frame` is left to
 * `retireNormalisingGoalFrame` (it moves the links from that frame); no frame, no move, or no sized link → the graph
 * itself. PURE.
 */
export function rederiveGoalInLinks<G>(graph: G, goalId: string, from: number): G {
  return rederiveGoalInLinksWithSetAside(graph, goalId, from).graph;
}

export function rederiveGoalInLinksWithSetAside<G>(graph: G, goalId: string, from: number): { graph: G; setAside: SetAsideEstimate[] } {
  const unchanged = { graph, setAside: [] };
  const nodes = (graph as Rec | null)?.nodes;
  if (!Array.isArray(nodes) || !num(from) || from <= 0) return unchanged;
  const goal = nodes.find((n: Rec) => n?.id === goalId && n?.kind === 'goal');
  if (goal === undefined || (num(goal.scale_frame) && goal.scale_frame > 1)) return unchanged;
  const to = frameOf(goal);
  if (to === undefined || to === from) return unchanged;
  // Restore existing user/definitional clamps before checking eligibility, never rescale from the stored ±1.
  const restored = withStatedStrengths(graph) as Rec;
  if (!(restored.edges ?? []).some((e: Rec) => sizedIntoGoal(e, goalId))) return unchanged;
  const g = structuredClone(restored);
  rescaleSizedInLinks(g, goalId, from / to);
  return refitAndSetAside<G>(g);
}
