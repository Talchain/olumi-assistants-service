/**
 * V5 Phase 1.5 — deterministic graph hash.
 *
 * Computes a stable 16-char hex hash of a graph's node + edge identity, for
 * routing-log telemetry and future staleness-comparison work. The hash input
 * is the sorted list of node IDs and (from, to) edge pairs — not the full
 * structural data — so additive fields (observed_state drift, strength
 * refinements) do NOT change the hash. That is deliberate: Phase 1.5 uses the
 * hash only as a stable identity marker for a given graph shape; downstream
 * staleness logic compares identity against analysis-time snapshots and
 * should not trip on cosmetic edits.
 *
 * The hash is kept OUT of ContextPack (plan correction #3). Consumers that
 * need it — routing log, future staleness comparator — read it from the
 * TurnExecutor scope where this helper is called.
 */

import { createHash } from 'node:crypto';

import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

/** Length of the returned hex prefix. 16 gives collision odds ~1 in 2^64. */
const HASH_HEX_LENGTH = 16;

/**
 * Compute a deterministic 16-char hex hash of graph identity. Returns null
 * when the graph is null, undefined, or structurally empty (no nodes AND no
 * edges) — a null hash is indistinguishable from "no graph present" for the
 * routing-log consumer.
 *
 * Canonicalisation:
 *   1. Copy nodes + edges into plain identity records (strip passthrough
 *      fields — we hash identity, not structure)
 *   2. Sort nodes by id, edges by (from, to)
 *   3. stableStringify (recursive key sort)
 *   4. SHA-256, take first 16 hex chars
 */
export function computeDeterministicGraphHash(
  graph: GraphStateIngress | null | undefined,
): string | null {
  if (!graph) return null;

  const nodes = graph.nodes;
  const edges = graph.edges;
  if (nodes.length === 0 && edges.length === 0) return null;

  const nodeIdentity = nodes
    .map((n) => ({ id: n.id }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const edgeIdentity = edges
    .map((e) => ({ from: e.from, to: e.to }))
    .sort((a, b) => {
      const fromCmp = a.from.localeCompare(b.from);
      return fromCmp !== 0 ? fromCmp : a.to.localeCompare(b.to);
    });

  const canonical = stableStringify({ nodes: nodeIdentity, edges: edgeIdentity });
  return createHash('sha256').update(canonical).digest('hex').slice(0, HASH_HEX_LENGTH);
}
