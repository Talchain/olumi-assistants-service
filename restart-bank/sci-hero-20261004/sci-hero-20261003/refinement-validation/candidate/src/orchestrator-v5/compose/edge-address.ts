/**
 * THE CANONICAL EDGE ADDRESS — one owner for the only identity an edge has.
 *
 * ⭐ WHY THIS MODULE EXISTS AT ALL. `EdgeV3Schema` (`@talchain/schemas`
 * `graph.ts`) declares `{ from, to, strength, exists_probability,
 * effect_direction?, edge_type?, label? }` and **NO `id`**. The contract states
 * the consequence in its own words, twice: *"EDGES ARE ADDRESSED BY
 * `(from, to)`, NEVER BY AN ID … an edge's only identity in the canonical graph
 * is its endpoint pair"*, and a client-local id (`"reactflow__edge-…"`) is
 * *"never the lookup key"*. The contrast control is `NodeV3Schema`, which DOES
 * declare `id` with `NODE_ID_PATTERN` — so this is a property of edges, not a
 * gap in the package.
 *
 * ⛔ AND THE SPELLING WAS ALREADY SCATTERED, WHICH IS HOW IT COST US CARDS. The
 * estate carries the endpoint pair in THREE spellings, measured on committed
 * live captures (`coaching/select-fragile-edge.ts` header):
 *
 *     fragile_edges[].edge_id   →  "fac_partner_invest->out_new_arr"   (ASCII)
 *     edge_e_values[].edge_id   →  "fac_partner_invest::out_new_arr"   (colons)
 *     the graph-edit path       →  "fac_partner_invest→out_new_arr"    (U+2192)
 *
 * `->` is what the decision_review producer emits (both live captures key
 * `scenario_contexts` and `pre_mortem.grounded_in` that way) and what
 * `decision-review-graph-projection.ts` hands the model as an edge's `id`.
 * `→` is what `tools/handlers/adjust-edge-strength.ts::parseEdgeId` round-trips
 * and therefore what an edge TargetRef must carry to be ACTIONABLE.
 *
 * ⚠ `::` IS DELIBERATELY NOT ACCEPTED. `parseEdgeId` rejects it and
 * `compose/__tests__/fragile-edge-offer.test.ts` pins that rejection. It is the
 * `edge_e_values` spelling, which is a RATIFIED TIER-3 DENY field joined by
 * `(from_id, to_id)` and never by its id string — so accepting it here would
 * widen an address vocabulary for a field nothing is allowed to address.
 *
 * This module is the single owner so the next lane does not add a fourth
 * spelling. `parseEdgeId` and `decision-review-graph-projection.ts`'s
 * `endpointAddress` both DELEGATE to it — they are not near-copies of it
 * (CLAUDE.md trap 12: the hand-maintained mirror is the dominant defect here,
 * and this file's own history had TWO copies of the separator constant).
 */

/** The producer's canonical separator — what `fragile_edges` and the model use. */
export const EDGE_ADDRESS_SEPARATOR = '->';

/** The separator the graph-edit path round-trips (`parseEdgeId`). */
export const EDGE_IDENTITY_SEPARATOR = '→';

/**
 * The producer's canonical endpoint spelling for an edge. DERIVED ENTIRELY FROM
 * FIELDS THE EDGE ALREADY CARRIES — it asserts nothing the producer did not say.
 */
export function canonicalEdgeAddress(from: string, to: string): string {
  return `${from}${EDGE_ADDRESS_SEPARATOR}${to}`;
}

/**
 * The composite the graph-edit path accepts, so a card's target and the handler
 * that acts on it are ONE string rather than two spellings of one idea.
 */
export function composeEdgeIdentity(from: string, to: string): string {
  return `${from}${EDGE_IDENTITY_SEPARATOR}${to}`;
}

/**
 * Read an endpoint pair out of any accepted address spelling, or `null`.
 *
 * Moved here VERBATIM from `adjust-edge-strength.ts::parseEdgeId`, which now
 * delegates — same acceptance (`→` preferred, then `->`), same `::` rejection,
 * same two-part and non-empty requirements, so the graph-edit path's behaviour
 * is unchanged by construction rather than by re-derivation.
 */
export function parseEdgeAddress(raw: string): { from: string; to: string } | null {
  const arrow = raw.includes(EDGE_IDENTITY_SEPARATOR)
    ? EDGE_IDENTITY_SEPARATOR
    : raw.includes(EDGE_ADDRESS_SEPARATOR)
      ? EDGE_ADDRESS_SEPARATOR
      : null;
  if (arrow === null) return null;
  const parts = raw.split(arrow);
  if (parts.length !== 2) return null;
  const from = parts[0]!.trim();
  const to = parts[1]!.trim();
  if (from.length === 0 || to.length === 0) return null;
  return { from, to };
}

/**
 * Normalise any accepted edge-address spelling onto the ONE key the graph lookup
 * is registered under. `null` when the string is not an edge address at all —
 * a plain node id, or an invented reference with no separator.
 *
 * ⚠ DIRECTION IS PART OF THE IDENTITY and is NEVER normalised away. The
 * contract's address is directional everywhere it appears (`structural_add_edge`
 * names `from`/`to` as "edge identity, half 1 / half 2"), so a reversed address
 * is a DIFFERENT claim. That holds for `edge_type: 'bidirected'` too: an edge
 * registered under both orientations would put two entries carrying ONE label
 * into the lookup, and `referent-resolver.ts::deriveLabelIndex` would then mark
 * that label `AMBIGUOUS_LABEL` — silently breaking prose linking for a real
 * relationship in order to resolve an address no measured producer emits.
 */
export function canonicaliseEdgeReference(raw: string): string | null {
  const pair = parseEdgeAddress(raw);
  return pair === null ? null : canonicalEdgeAddress(pair.from, pair.to);
}
