/**
 * ⭐ IS THIS LINK SIZED, AND BY WHOM? — the ONE reading every approval, readiness check and sentence shares (L4, 52f8cd;
 * DL ruling #85 5929790081 on 5929778726).
 *
 * WHY ONE MODULE. Paul's 1 Oct test (`96c6f5f4`): he approved Olumi's estimates for 8 unsized links at 09:25, and the next
 * three Runs repeated "Olumi hasn't sized…" word for word. "Sized" had three definitions — `goal-certainty` (only
 * `olumi_placeholder`), `placeholder-parts` (any `olumi_*` or `defaulted`), `target-testability` (`olumi_placeholder`) —
 * and the approval writer matched none of them: it recorded the review and kept `magnitude: 'olumi_placeholder'`
 * byte for byte, so nothing that asks "is it sized?" could ever see the approval.
 *
 * THE CLASSES (read off the stored provenance, nothing inferred):
 *   · `user`           — the user sized it: `source: 'user_specified'`, or a size construction credits to the user
 *                        (`magnitude: 'user_stated'`).
 *   · `placeholder`    — nobody sized it: tagged, mean-projected or untagged door default (Science 393023 LICENCE (a)/(b), 7 Oct).
 *   · `olumi_accepted` — Olumi's estimate the user approved (`olumi_*` + `reviewed_by_user` confirm). Still Olumi's figure:
 *                        it earns no authorship credit (`earnsAuthorshipCredit` reads authorship, not this).
 *   · `olumi_estimate` — Olumi's estimate, not yet reviewed.
 *   · `unmarked`       — no sizing mark at all (a structural or brief link the sizer never marked).
 *
 * THE RULING (DL 5929790081):
 *   (i)  GOAL FIGURES — an accepted Olumi estimate SIZES a link ("rests on Olumi's estimates you accepted"); only a
 *        `placeholder` withholds them ({@link isPlaceholderLink}).
 *   (ii) A PARTS LIMIT — NO Olumi size scores it, accepted or not: the parts of a total are an identity, not a causal
 *        strength ({@link isSizedOnlyByOlumi}, the parts rule, unchanged).
 * Pure.
 */
import {
  type LinkSizing, PLACEHOLDER_MAGNITUDE, ESTIMATE_MAGNITUDE, DOOR_DEFAULT_CONSTANTS, linkSizing,
} from '../provenance/provenance-of.js';

// The classes, their literals, the door constants and `linkSizing` itself live in the ONE provenance authority (Recovery
// Batch C, DL 12 Oct): this module keeps the writers and the predicates over `linkSizing`'s answer, never the strings.
export { type LinkSizing, PLACEHOLDER_MAGNITUDE, ESTIMATE_MAGNITUDE, DOOR_DEFAULT_CONSTANTS, linkSizing };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);


/** Mark a projected mean at the writer seam. An authored spread may keep its existing magnitude eligibility. */
export function markPlaceholder<E extends { provenance?: object; defaulted?: boolean }>(
  edge: E, { tagMagnitude = true }: { tagMagnitude?: boolean } = {},
): E {
  const p = (edge.provenance ??= {}) as Rec;
  p.mean_projected = true;
  if (tagMagnitude) p.magnitude = PLACEHOLDER_MAGNITUDE;
  edge.defaulted = true;
  return edge;
}

/** A real size replaces the projected mean; the caller writes its magnitude and natural effect together. */
export function clearPlaceholderMarker<E extends { provenance?: object; defaulted?: boolean }>(edge: E): E {
  if (edge.provenance !== undefined) delete (edge.provenance as Rec).mean_projected;
  delete edge.defaulted;
  return edge;
}

/** (i) The link nobody sized — the one class that withholds goal figures and reads "Olumi hasn't sized…". */
export function isPlaceholderLink(edge: unknown): boolean {
  return linkSizing(edge) === 'placeholder';
}

/**
 * (ii) A link sized only by Olumi — any Olumi class, OR a plain `defaulted: true` size — and never the user's. The parts
 * rule: such a size never scores a parts limit. `defaulted` on a user's size marks a projected field (the spread), not
 * Olumi's size (MODEL GENERATION 5918011036; AIQ 5918035214; P0 PARTNER 5918144110).
 */
export function isSizedOnlyByOlumi(edge: unknown): boolean {
  const s = linkSizing(edge);
  if (s === 'user') return false;
  return s === 'placeholder' || s === 'olumi_accepted' || s === 'olumi_estimate' || (isRec(edge) && edge.defaulted === true);
}

/**
 * (i) GOAL FIGURES ONLY: an Olumi size the user accepted counts as sized for the goal (DL 5929790081 (i)). The parts rule
 * ({@link isSizedOnlyByOlumi}) never reads this: an accepted Olumi size still never scores a parts limit (ii).
 */
export function isAcceptedOlumiSize(edge: unknown): boolean {
  return linkSizing(edge) === 'olumi_accepted';
}

/**
 * Links that need a new size before approval can size them: a placeholder or an older unmarked default.
 * Confirmation of their stored default supplies no estimate; only a different, newly adopted size can replace it.
 */
export function approvalSizes(edge: unknown): boolean {
  const s = linkSizing(edge);
  return s === 'placeholder' || (s === 'unmarked' && isRec(edge) && edge.defaulted === true);
}

/**
 * Only adoption of a newly supplied, different estimate may replace an unsized default. A confirmation alone
 * never supplies a size. `newMean` is passed only by the trusted adoption writer; `edge` is its stored preimage.
 */
export function sizedByApproval<P extends object>(provenance: P, edge: unknown, newMean?: number): P {
  if (newMean === undefined || !Number.isFinite(newMean) || !isRec(edge) || !isRec(edge.strength)
    || newMean === edge.strength.mean) return provenance;
  if (!approvalSizes(edge)) return provenance;
  // Science 393023 LICENCE ruling 1 / R3 B1: `user_specified` on a projected mean records who drew the link, not who
  // sized it. A review must keep that carrier: clearing it would make the unchanged prior read `user` under the ONE
  // predicate's ordering and award authorship for a confirm. Record the review only; no size or source is rewritten.
  const stored = isRec(edge) && isRec(edge.provenance) ? edge.provenance : undefined;
  if (stored?.source === 'user_specified' && stored.mean_projected === true) return provenance;
  // R8-3 (Science 393023 ruling 1): a projected mean beside Olumi's estimate is a placeholder, but an approval that would
  // write the same magnitude would clear the carrier ALONE, and the carrier is outside the analysis hash. Nothing is
  // written: the link stays a placeholder (fail-closed) rather than reading sized against an unchanged hash.
  if ((provenance as { magnitude?: unknown }).magnitude === ESTIMATE_MAGNITUDE) return provenance;
  // R8 hash safety: approval changes magnitude; confirm-only review keeps the carrier.
  const { mean_projected: _projectedMean, ...kept } = provenance as P & { mean_projected?: unknown };
  return { ...kept, magnitude: ESTIMATE_MAGNITUDE } as P;
}

/**
 * ⭐ F1b [R1] (DL 5930827933: "each figure carries its `linkSizing` label"): the options whose outcome rests on at least
 * one Olumi size the user ACCEPTED, on any path from what the option moves into the goal. Their figures read "rests on
 * Olumi's estimates you accepted". Pure; reads the stored graph only.
 */
export function optionsRestingOnAcceptedOlumiSizes(graph: unknown, optionIds: readonly string[]): string[] {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return [];
  const nodes = (graph.nodes as unknown[]).filter(isRec);
  const edges = (graph.edges as unknown[]).filter(isRec);
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind] as const));
  const goal = nodes.find((n) => n.kind === 'goal')?.id;
  if (goal === undefined) return [];
  // Every node that can reach the goal (the goal included): a link off every such path moves nothing the goal sees.
  const toGoal = new Set<unknown>([goal]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) if (toGoal.has(e.to) && !toGoal.has(e.from)) { toGoal.add(e.from); grew = true; }
  }
  return optionIds.filter((option) => {
    const reached = new Set<unknown>([option]);
    for (let grew = true; grew;) {
      grew = false;
      for (const e of edges) {
        if (reached.has(e.from) && !reached.has(e.to) && kindOf.get(e.to) !== 'option' && kindOf.get(e.to) !== 'decision') { reached.add(e.to); grew = true; }
      }
    }
    return edges.some((e) => reached.has(e.from) && kindOf.get(e.from) !== 'option' && toGoal.has(e.to) && isAcceptedOlumiSize(e));
  });
}

/** R8 writer guard: the carrier is outside the analysis hash; an unchanged size cannot change it on re-register. */
export function keepMeanProjectionWhenSizeUnchanged<E extends object>(before: unknown, after: E): E {
  if (!isRec(before) || !isRec(after)) return after;
  const oldSize = isRec(before.strength) ? before.strength : {};
  const newSize = isRec(after.strength) ? after.strength : {};
  const oldProvenance = isRec(before.provenance) ? before.provenance : {};
  const newProvenance = isRec(after.provenance) ? after.provenance : {};
  if (!Object.hasOwn(oldProvenance, 'mean_projected') && !Object.hasOwn(newProvenance, 'mean_projected')) return after;
  if (oldSize.mean !== newSize.mean || oldProvenance.magnitude !== newProvenance.magnitude) return after;
  // Copy the old carrier opaquely at this write boundary; only the licence interprets its value.
  const { mean_projected: _proposed, ...kept } = newProvenance;
  const carrier = Object.fromEntries(Object.entries(oldProvenance).filter(([key]) => key === 'mean_projected'));
  if (!isRec(before.provenance) && !isRec(after.provenance)) return after;
  return { ...after, provenance: { ...kept, ...carrier } };
}
