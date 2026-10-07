/** Admission owns this durable carrier; generic writers must preserve its exact bytes and endpoints. */
import { isDeepStrictEqual } from 'node:util';
type Rec = Record<string, any>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export class ShareByDateOwnershipError extends Error {
  constructor() { super('share_by_date_server_owned'); }
}

/** Compare every carrier, including malformed ones: a generic writer cannot heal or erase ownership. */
export function assertShareByDatePreserved(before: unknown, after: unknown): void {
  const carriers = (g: unknown) => rec(g) && Array.isArray(g.edges) ? g.edges.filter((e: unknown) =>
    rec(e) && rec(e.provenance) && Object.hasOwn(e.provenance, 'share_by_date')).map((e: Rec) =>
      ({ from: e.from, to: e.to, bytes: JSON.stringify(e.provenance.share_by_date) }))
      .sort((a: Rec, b: Rec) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : [];
  // An unreadable base (undefined) can attest nothing: a write that CARRIES a carrier is refused (it could be forged);
  // a write with none goes ahead as before (a dropped carrier makes the forecast unrecognisable, and S2a then
  // withholds it: fail closed downstream). Scoped so no other graph's write changes behaviour.
  if (before === undefined) {
    if (carriers(after).length > 0) throw new ShareByDateOwnershipError();
    return;
  }
  if (before === null) return; // First admission has no previous carrier.
  if (!isDeepStrictEqual(carriers(before), carriers(after))) throw new ShareByDateOwnershipError();
}

/** IDs minted at admission must resolve to actual graph nodes of the right kinds. */
export function eventShareEndpointMatches(edge: unknown, from: unknown, to: unknown): boolean {
  if (!rec(edge) || !rec(from) || !rec(to)) return false;
  const c = edge.provenance?.share_by_date;
  return rec(c) && c.role === 'team' && typeof c.deliverable === 'string' && c.deliverable.trim() !== ''
    && c.team_id === edge.from && c.team_id === from.id && from.kind === 'factor'
    && c.goal_id === edge.to && c.goal_id === to.id && to.kind === 'goal'
    && Array.isArray(c.unresolved_option_ids) && c.unresolved_option_ids.every((id: unknown) => typeof id === 'string');
}
