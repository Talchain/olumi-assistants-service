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
 */
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { BaseHashCheck } from './proposal-types.js';

type HashInput = Parameters<typeof computeAnalysisAffectingGraphHash>[0];

export function currentAnalysisHash(graph: unknown): string | null {
  return computeAnalysisAffectingGraphHash(graph as HashInput);
}

export function checkBaseHash(currentGraph: unknown, baseGraphHash: string | null): BaseHashCheck {
  const actual = currentAnalysisHash(currentGraph);
  return { expected: baseGraphHash, actual, match: actual === baseGraphHash };
}

export function isStale(currentGraph: unknown, baseGraphHash: string | null): boolean {
  return !checkBaseHash(currentGraph, baseGraphHash).match;
}
