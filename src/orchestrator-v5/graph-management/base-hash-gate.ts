/**
 * INV-1 base_graph_hash stale gate.
 *
 * A proposal validated against graph H must never be applied to a moved graph
 * H2. The analysis-affecting hash is the gate. Reuses the canonical V5 primitive
 * `computeAnalysisAffectingGraphHash` — the same hash the live freshness
 * derivation and the canonical analysis-state selector use — so the spike's
 * stale axis is aligned with live freshness without a bespoke rule. Cosmetic
 * changes (labels/provenance) are excluded from that hash, which is why a
 * label-only rename is hash-neutral.
 *
 * Fail-CLOSED: a graph that cannot be hashed (not graph-like, or hashing threw
 * on an unhashable analysis value such as a BigInt) is reported `readable:false`
 * and MUST be held — it is never collapsed to a `null` hash, which would match a
 * `base_graph_hash: null` and fail open to would_apply.
 */
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { BaseHashCheck } from './proposal-types.js';

type HashInput = Parameters<typeof computeAnalysisAffectingGraphHash>[0];

/** Minimal shape a graph must have to be hashable / mutatable: an object with a `nodes` array. */
export function isGraphLike(graph: unknown): graph is { nodes: unknown[]; edges?: unknown[] } {
  return (
    graph !== null &&
    typeof graph === 'object' &&
    !Array.isArray(graph) &&
    Array.isArray((graph as { nodes?: unknown }).nodes)
  );
}

/**
 * Best-effort analysis hash for a graph the caller already TRUSTS (e.g. to stamp
 * a proposal's `base_graph_hash`). Returns `null` for an empty/un-graph-like
 * input or if hashing throws. NOT for the stale gate — the gate must distinguish
 * "unhashable" from "legitimately null"; use `checkBaseHash` there.
 */
export function currentAnalysisHash(graph: unknown): string | null {
  try {
    if (!isGraphLike(graph)) return null;
    return computeAnalysisAffectingGraphHash(graph as HashInput);
  } catch {
    return null;
  }
}

/**
 * Readable-aware base-hash check for the stale gate. The ONLY hashing path the
 * gate should use. `readable:false` ⇒ the current graph could not be hashed and
 * must be held (CURRENT_GRAPH_UNREADABLE), never treated as a null-hash match.
 */
export function checkBaseHash(currentGraph: unknown, baseGraphHash: string | null): BaseHashCheck {
  // The whole body is guarded: `isGraphLike` reads `.nodes`, so a throwing getter
  // or Proxy must resolve to readable:false (held), not an exception.
  try {
    if (!isGraphLike(currentGraph)) {
      return { expected: baseGraphHash, actual: null, match: false, readable: false };
    }
    const actual = computeAnalysisAffectingGraphHash(currentGraph as HashInput);
    return { expected: baseGraphHash, actual, match: actual === baseGraphHash, readable: true };
  } catch {
    return { expected: baseGraphHash, actual: null, match: false, readable: false };
  }
}

/** Convenience: stale = readable but hash mismatch. An unreadable graph is NOT "stale" (it is unreadable). */
export function isStale(currentGraph: unknown, baseGraphHash: string | null): boolean {
  const check = checkBaseHash(currentGraph, baseGraphHash);
  return check.readable && !check.match;
}
