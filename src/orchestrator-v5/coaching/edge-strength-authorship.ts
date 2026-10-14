/**
 * WHOSE NUMBERS ARE ON A LINK — read from the run's own graph, joined by identity.
 *
 * Construction (agent-lane/admit-candidate.ts) stamps a link `defaulted: true` when ANY of
 * its numbers (strength mean, strength spread, or existence probability) was projected by
 * Olumi, and its provenance `brief_extraction` when the brief stated the link or
 * `cee_hypothesis` when Olumi proposed it. For such a link it is true to say "some of its
 * numbers are Olumi's starting assumptions" — and only that: a projected spread alone also
 * sets the flag, so the words never claim the STRENGTH itself was assumed.
 *
 * Every other or unknown source is `not_olumi_assumed`, even when still stamped defaulted
 * (a user edit may not clear the flag): unknown provenance never becomes an asserted origin.
 * No graph, or not exactly one link with those endpoints, is `not_tested`.
 *
 * Relation SEMANTICS (definition, approximation, mechanism) is a separate question this
 * module does not answer; it reports authorship only.
 *
 * Pure: no clock, no LLM, no telemetry.
 */
import { readRecord } from './fragile-link-challenge.js';
import { edgeReviewedByUser } from '../../cee/graph-readiness/obligation-provenance.js';
import { linkProvenanceOf } from '../../cee/provenance/provenance-of.js';

export type EdgeAuthorship = 'olumi_assumed' | 'not_olumi_assumed' | 'not_tested';

/** The edge provenance sources construction writes for a link whose numbers it may project. */
export const OLUMI_ASSUMED_EDGE_SOURCES: readonly string[] = Object.freeze(['cee_hypothesis', 'brief_extraction']);

/** Classify one graph edge record. */
export function classifyEdgeAuthorship(edge: Record<string, unknown>): Exclude<EdgeAuthorship, 'not_tested'> {
  // R11: a confirmed link is still Olumi's size, but the user has given their view of it: it is not asked about again.
  // Science 393023 LICENCE ruling 1: a user-DRAWN link whose mean Olumi projected holds Olumi's numbers (the source records
  // who drew it). Only that explicit carrier class is added; an unknown or absent source still never asserts an origin.
  // ⭐ ONE PROVENANCE AUTHORITY (AIE 6121121310): Olumi's assumed strength is a size `linkProvenanceOf` reads as Olumi's —
  // a placeholder (a user-drawn link with a projected mean included) or an Olumi size CEE flagged `defaulted`. An UNMARKED
  // link is never Olumi's wholesale: its size is unverified and disclosed by the census, not described as Olumi's here.
  const size = linkProvenanceOf(edge);
  return !edgeReviewedByUser(edge) && size.origin === 'ai' && !size.structural && (size.placeholder || edge.defaulted === true)
    ? 'olumi_assumed'
    : 'not_olumi_assumed';
}

/**
 * A lookup over a HASH-BOUND graph (`coaching/bound-graph.ts`): the authorship of THE one
 * link `fromId → toId`. The caller passes null when it has no bound graph.
 */
export function edgeAuthorshipIn(graph: Record<string, unknown> | null): (fromId: string, toId: string) => EdgeAuthorship {
  return (fromId, toId) => {
    if (graph === null || !Array.isArray(graph.edges)) return 'not_tested';
    const matches = graph.edges.filter((raw) => {
      const edge = readRecord(raw);
      return edge !== null && edge.from === fromId && edge.to === toId;
    });
    return matches.length === 1 ? classifyEdgeAuthorship(readRecord(matches[0])!) : 'not_tested';
  };
}
