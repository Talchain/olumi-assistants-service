import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHashSha256 } from './graph-hash.js';
import { computeLegacyAnalysisAffectingGraphHashSha256 } from './graph-hash-legacy.js';

/** Immutable version validation only. This must never license current freshness. */
export function matchesHistoricalAnalysisIdentity(graph: GraphStateIngress, storedHash: string): boolean {
  return computeAnalysisAffectingGraphHashSha256(graph) === storedHash
    || computeLegacyAnalysisAffectingGraphHashSha256(graph) === storedHash;
}
