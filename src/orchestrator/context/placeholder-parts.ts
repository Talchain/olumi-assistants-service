/**
 * ⛔ A TARGET THE OPTIONS MOVE ONLY THROUGH ITS PARTS, ON LINKS OLUMI HAS NOT SIZED, HAS NO CHECKABLE LIMIT (R-c: AI
 * Quality ruling #72 5881541947, accepted by the Codex DL 5881593118). The level-limit baseline carrier (T4,
 * `level-limit-baseline.ts`) and the per-limit fold (`constraint-feasibility.ts`) share ONE predicate, for level and
 * change frames alike. Its one import is the sizer's own unit rule (`naturalAmountUnitsOf`), which reaches neither module.
 *
 * An option that sets a PART of a target (a factor upstream of it, a direct parent or further up) and not the target
 * itself moves it only through the model's links. ISL then scores a limit on that target through those links' sizes.
 * When a link on that path is a bare placeholder, the P is an artefact of the placeholder coefficient, not an estimate
 * of the user's quantity: journey C's "Additional Advertising" at £18k on a £15k limit read P 0.695 (the verifier's T4
 * measurement), and a user-stated base cannot upgrade it (a `change_abs` P never reads the base).
 *
 * WITHHELD when some option moves a part and not the target, AND either:
 *   · (i)  a link on that option's path to the target is a bare placeholder: its `provenance.magnitude` is not an
 *          estimate (`olumi_estimate`) or the user's own (`user_stated`), or its `provenance.natural_effect.amount_unit`
 *          is not the unit the sizer says a size in for the node it points at (`naturalAmountUnitOf`: "percentage
 *          points" only for a percentage level on 100, else the node's unit), or that natural
 *          effect was written for another mean than the edge now holds. A path is sized only if EVERY link is.
 *          `defaulted` is NOT the discriminator: Olumi's sized links carry it too (AIQ 5881541947, 5882087383);
 *   · (ii) the target declares a `nonlinear_identity`: the engine does not combine parts by it yet ("product treated
 *          as additive", served journey-cloud).
 * Otherwise every link on the path is Olumi's model (served cloud: share % → downtime and readiness → downtime,
 * `olumi_estimate` in weeks), and the normal fold applies. Pure.
 */

import { naturalAmountUnitsOf } from '../../cee/magnitude/frame-defaulted-links.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why a target's limit is withheld. Each is a per-limit `reason` code on the contract (a string: hazard 1). */
export const PLACEHOLDER_PARTS_REASON = 'parts_links_placeholder';
export const PARTS_IDENTITY_UNMODELLED_REASON = 'parts_identity_unmodelled';
export type PlaceholderPartsReason = typeof PLACEHOLDER_PARTS_REASON | typeof PARTS_IDENTITY_UNMODELLED_REASON;

const SIZED_MAGNITUDES: ReadonlySet<unknown> = new Set(['olumi_estimate', 'user_stated']);

const norm = (u: unknown): string | undefined =>
  typeof u === 'string' && u.trim().length > 0 ? u.trim().toLowerCase() : undefined;

/** Per node, the unit the sizer says a link's size in ("percentage points" only for a percentage LEVEL on 100). */
const sizerUnitsOf = (nodes: readonly Rec[]): Map<unknown, string | undefined> =>
  new Map([...naturalAmountUnitsOf(nodes)].map(([id, u]) => [id, norm(u)] as const));

/**
 * A link Olumi (or the user) sized, in the unit of the node it points at, whose size still describes the link: the
 * natural effect speaks only while the edge's mean is the β it was written for (magnitude contract, R&C 5845818897).
 */
function linkIsSized(edge: Rec, unitById: ReadonlyMap<unknown, string | undefined>): boolean {
  const p = isRec(edge.provenance) ? edge.provenance : undefined;
  if (p === undefined || !SIZED_MAGNITUDES.has(p.magnitude)) return false;
  const effect = isRec(p.natural_effect) ? p.natural_effect : undefined;
  const to = unitById.get(edge.to);
  if (effect === undefined || to === undefined || norm(effect.amount_unit) !== to) return false;
  const mean = isRec(edge.strength) ? edge.strength.mean : undefined;
  return typeof mean === 'number' && mean === effect.strength_mean;
}

/** The option sets a level on the node (a bare finite number, or `{ value }`), as PLoT reads an intervention. */
function setsLevel(v: unknown): boolean {
  return (typeof v === 'number' && Number.isFinite(v)) || (isRec(v) && typeof v.value === 'number' && Number.isFinite(v.value));
}

/**
 * Why a limit on `targetId` is withheld, or `null` when it is not (no option moves the target only through its parts,
 * or every link on each such path is sized and the target declares no identity). `options` are the options PLoT scores
 * (the run's final wire options: `{ interventions }` keyed by node id).
 */
export function targetMovedOnlyThroughPlaceholderParts(
  targetId: string,
  nodes: readonly Rec[],
  edges: readonly Rec[],
  options: ReadonlyArray<Record<string, unknown>>,
): PlaceholderPartsReason | null {
  return placeholderPartsFinding(targetId, nodes, edges, options)?.reason ?? null;
}

/**
 * The same predicate, with the PART an option sets whose path to the target carries the unsized link (for
 * `parts_links_placeholder`), so the withheld row can ask for that link's size (AI Quality 5882087383: "How much would a
 * price rise move monthly churn? Give a figure, or let Olumi estimate it.").
 */
export function placeholderPartsFinding(
  targetId: string,
  nodes: readonly Rec[],
  edges: readonly Rec[],
  options: ReadonlyArray<Record<string, unknown>>,
): { readonly reason: PlaceholderPartsReason; readonly partId?: string } | null {
  const kindById = new Map(nodes.map((n) => [n.id, n.kind] as const));
  // The target's parts: every node upstream of it that is not an option or the decision (T4's walk).
  const parts = new Set<unknown>();
  const queue: unknown[] = [targetId];
  while (queue.length > 0) {
    const at = queue.shift();
    for (const e of edges) {
      if (e.to !== at || parts.has(e.from) || e.from === targetId) continue;
      const k = kindById.get(e.from);
      if (typeof k !== 'string' || k === 'option' || k === 'decision') continue;
      parts.add(e.from);
      queue.push(e.from);
    }
  }
  if (parts.size === 0) return null;
  const movers = options
    .map((o) => (isRec(o.interventions) ? o.interventions : {}))
    .filter((iv) => !setsLevel(iv[targetId]) && Object.keys(iv).some((k) => parts.has(k)));
  if (movers.length === 0) return null;
  const target = nodes.find((n) => n.id === targetId);
  if (target !== undefined && isRec(target.nonlinear_identity)) return { reason: PARTS_IDENTITY_UNMODELLED_REASON };
  const unitById = sizerUnitsOf(nodes);
  const onPath = new Set<unknown>([...parts, targetId]);
  for (const iv of movers) {
    // Forward from each part this option sets, through parts only: every link walked lies on a path to the target.
    for (const partId of Object.keys(iv).filter((k) => parts.has(k))) {
      const reached = new Set<unknown>([partId]);
      const walk: unknown[] = [partId];
      while (walk.length > 0) {
        const at = walk.shift();
        for (const e of edges) {
          if (e.from !== at || !onPath.has(e.to)) continue;
          if (!linkIsSized(e, unitById)) return { reason: PLACEHOLDER_PARTS_REASON, partId };
          if (e.to !== targetId && !reached.has(e.to)) {
            reached.add(e.to);
            walk.push(e.to);
          }
        }
      }
    }
  }
  return null;
}
