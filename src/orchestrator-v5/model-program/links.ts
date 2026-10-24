/**
 * A LINK'S SIZE, WHAT IT MOVES AND WHEN ITS STATED DIRECTION IS USED: one derivation (issue 40), read by the projection
 * that draws the link (`project.ts`), the reading of a draft (`compile.ts` normalise) and the card that names what it moves
 * (`postimage.ts`).
 */
import type { CanonicalModelT, CanonicalQuantityT, CanonicalRelationT } from './canonical.js';

const none = (x: number | null | undefined) => x === null || x === undefined;

/**
 * A per-unit rate (one coefficient times one driver) is ONE meaning however the draft wrote it, an effect term or a
 * two-part product ("specialists × capacity per specialist"), so it is drawn ONE way: on its driver's link, its id as
 * `coefficient_id` (DL 23 Oct: the link editor reads it there), never as a card of its own plus a second link.
 */
export function rateOf(r: CanonicalRelationT, Q: ReadonlyMap<string, Pick<CanonicalQuantityT, 'kind'>>): { driver: string; coefficient: string } | null {
  if (r.form !== 'definition' || r.op !== 'product' || r.parts.length !== 2 || r.parts.some((p) => p.power !== 1)) return null;
  const [a, b] = r.parts.map((p) => p.id) as [string, string];
  const rate = (id: string) => Q.get(id)?.kind === 'coefficient';
  return rate(a) && !rate(b) ? { driver: b, coefficient: a } : rate(b) && !rate(a) ? { driver: a, coefficient: b } : null;
}

/** What a link sized by `id` moves: what an effect term with this coefficient, or a per-unit rate with it, defines. */
export function linkTargets(model: Pick<CanonicalModelT, 'quantities' | 'relations'>, id: string): string[] {
  const Q = new Map(model.quantities.map((q) => [q.id, q] as const));
  return [...new Set(model.relations.flatMap((r) => ((r.form === 'effect' && r.terms.some((t) => t.coefficient === id)) || rateOf(r, Q)?.coefficient === id ? [r.defines] : [])))];
}

/** A link's stated direction is used only where its size has no figure: no value, and no range or one across zero (issue 39). */
export const directionUsed = (q: Pick<CanonicalQuantityT, 'value' | 'low' | 'high'>): boolean =>
  none(q.value) && (none(q.low) || none(q.high) || (q.low! < 0 && q.high! > 0));

/**
 * The host's reading of a model's directions: one the model does not use (its link is sized, or no link has it as its
 * size) is cleared, so the card never states a sign the model does not use. Never anyone's change: the same model when
 * nothing is cleared.
 */
export function withUsedDirections<M extends Pick<CanonicalModelT, 'quantities' | 'relations'>>(model: M): M {
  const quantities = model.quantities.map((q) => (q.direction !== null && (!directionUsed(q) || linkTargets(model, q.id).length === 0) ? { ...q, direction: null } : q));
  return quantities.some((q, i) => q !== model.quantities[i]) ? { ...model, quantities } : model;
}
