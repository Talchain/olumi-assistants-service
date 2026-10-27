import { RunInputSnapshotSchema } from '@talchain/schemas/orchestrator';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { runAnalysisProjectionNeedsStamp } from './analysis-projection-policy.js';
/**
 * Group A — Canonical State foundation: CEE-local `graphIdentityHash`.
 *
 * Implements the two-projection / two-hash doctrine ratified in
 * `Olumi_Cross_Workstream_Graph_Data_Contract_v0.2` (§8–§10):
 *
 *   analysisAffectingHash  — analysis freshness + proposal/pending staleness.
 *                            OWNED by `computeAnalysisAffectingGraphHash`
 *                            (../context/graph-hash.ts). This module does NOT
 *                            reimplement it — it delegates, and only adds the
 *                            typed §9.1 metadata envelope. There is exactly one
 *                            analysis-affecting normaliser in the codebase.
 *
 *   graphIdentityHash      — full persisted-graph identity for strict CAS,
 *                            version identity, restore safety and compare
 *                            baseline identity (contract §9.2). Built here,
 *                            CEE-local. Designed for later promotion to
 *                            `@talchain/schemas` once package skew is resolved
 *                            (contract §6.4/§6.5) — NOT promoted this slice.
 *
 * Deliberate asymmetry (contract §8): the analysis projection is a WHITELIST
 * (only analysis-affecting fields survive); the identity projection is an
 * EXCLUDE list (everything persisted survives EXCEPT transient UI state). That
 * polarity is load-bearing — a newly persisted field is identity-relevant by
 * construction and must move `graphIdentityHash` with no code change, whereas
 * the analysis whitelist is intentionally lossy.
 *
 * Serialisation authority is the single shared `stableStringify`
 * (../../orchestrator/context/stable-stringify.ts). No second stringifier.
 *
 * Nothing in this module is wired into a live path in this slice. The pure CAS
 * evaluator (`evaluateGraphIdentityCas`) is the dark/observe-ready seam for the
 * A3 live-writer plan; it has zero production call sites today (no expensive
 * hashing on hot paths).
 */

import { createHash } from 'node:crypto';

import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import {
  computeAnalysisAffectingGraphHash,
  computeAnalysisAffectingGraphHashSha256,
} from './graph-hash.js';
import { GRAPH_SCHEMA_VERSION, IDENTITY_NORMALISER_VERSION, IDENTITY_PROJECTION_VERSION, normaliseGraphForIdentity } from './graph-identity-normalise.js';
export { GRAPH_SCHEMA_VERSION, IDENTITY_NORMALISER_VERSION, IDENTITY_PROJECTION_VERSION, TRANSIENT_UI_KEYS, isIdentityEmptyGraph,
  orderGraphEntriesForComparison, normaliseGraphForIdentity, type NormalisedGraphIdentity } from './graph-identity-normalise.js';

// ---------------------------------------------------------------------------
// Versioned projection metadata (contract §8 "Normalisation must be versioned",
// §9.1/§9.2 "must include projection/version metadata").
// ---------------------------------------------------------------------------

/**
 * Metadata describing the EXISTING analysis-affecting projection owned by
 * graph-hash.ts. Recorded here so the §9.1 envelope carries version metadata
 * without editing the sanctioned implementation. These values annotate the
 * current behaviour; they do not alter it.
 */
export const ANALYSIS_NORMALISER_VERSION = '1' as const;
export const ANALYSIS_PROJECTION_VERSION = 'analysis_affecting.admission_gaps.v2' as const;

/** Existing persisted JSON metadata recorded by every new Run. */
export const RUN_ANALYSIS_PROJECTION_KEY = '__cee_analysis_projection_version';

/** Immutable version validation only; never licenses current freshness. */
export function matchesHistoricalAnalysisIdentity(graph: GraphStateIngress, storedHash: string): boolean {
  return computeAnalysisAffectingGraphHashSha256(graph) === storedHash
    || computeAnalysisAffectingGraphHashSha256(graph, 'legacy') === storedHash
    // Codex r2 #2643: a version recorded before hold-at-1.0 hashed its held links unheld; it is still that version.
    || computeAnalysisAffectingGraphHashSha256(graph, 'pre_hold') === storedHash
    // d5 #87 6011224941: a version recorded under the user-only hold (before a validated definition held) is still that version.
    || computeAnalysisAffectingGraphHashSha256(graph, 'pre_definition') === storedHash
    // Science 393023 rule R (route-once), DESIGN science-mechanism-doubt-DESIGN.md §2/§6: history only.
    || computeAnalysisAffectingGraphHashSha256(graph, 'pre_route_once') === storedHash
    // SCIENCE C1 (AIE 6180618773): a version recorded while a user's bare range held as a 90% interval is still that version.
    || computeAnalysisAffectingGraphHashSha256(graph, 'pre_c1') === storedHash;
}

/** Compare's recorded Run and admission identity use the existing sanctioned seam.
 * Frozen model-version compatibility never licenses a Run across omitted fields. */
export function matchesHistoricalRunAnalysisIdentity(
  graph: GraphStateIngress, storedHash: string, projection: unknown, inputSnapshot: unknown,
): boolean {
  if (projection !== undefined && projection !== ANALYSIS_PROJECTION_VERSION) return false;
  const carriesGaps = runAnalysisProjectionNeedsStamp(graph);
  const currentHash = computeAnalysisAffectingGraphHash(graph);
  // A current digest attests the gap identity itself. A frozen digest may
  // bind only without gaps: exclusion reasons alone cannot identify which
  // unresolved targets an unstamped historical Run consumed.
  if (projection === undefined && carriesGaps
    && currentHash === computeAnalysisAffectingGraphHash(graph, 'legacy')) return false;
  // Codex r2 #2643: a Run computed before hold-at-1.0 is identified by the pre-hold projection (history only, never freshness).
  const preHoldHash = computeAnalysisAffectingGraphHash(graph, 'pre_hold');
  // d5 #87 6011224941: and a Run computed under the user-only hold, before a validated definition held (history only).
  const preDefinitionHash = computeAnalysisAffectingGraphHash(graph, 'pre_definition');
  const preRouteOnceHash = computeAnalysisAffectingGraphHash(graph, 'pre_route_once');
  // SCIENCE C1: and a Run computed while a user's bare range held as a 90% interval (history only, never freshness).
  const preC1Hash = computeAnalysisAffectingGraphHash(graph, 'pre_c1');
  if (currentHash !== storedHash && preHoldHash !== storedHash && preDefinitionHash !== storedHash && preRouteOnceHash !== storedHash
    && preC1Hash !== storedHash
    && (projection !== undefined || carriesGaps
      || computeAnalysisAffectingGraphHash(graph, 'legacy') !== storedHash)) return false;
  const snapshot = RunInputSnapshotSchema.safeParse(inputSnapshot);
  const ready = buildCanonicalAnalysisReadyFromGraph(graph);
  if (!snapshot.success || ready === undefined
    || snapshot.data.options.length + snapshot.data.options_not_sent.length === 0) return false;
  const sent = new Set(snapshot.data.options.map(option => option.option_id));
  const excluded = new Map(snapshot.data.options_not_sent.map(option => [option.option_id, option.reason]));
  const ids = new Set(ready.options.map(option => option.option_id));
  if (ids.size !== ready.options.length || sent.size !== snapshot.data.options.length
    || excluded.size !== snapshot.data.options_not_sent.length
    || (carriesGaps && sent.size + excluded.size !== ids.size)
    || [...sent].some(id => !ids.has(id) || excluded.has(id))
    || [...excluded.keys()].some(id => !ids.has(id))) return false;
  // Gap-free historical snapshots may record only a subset of arms, or no
  // sent arms when every arm was excluded. Check the states actually attested
  // rather than requiring a present-day, nonempty exhaustive sent population.
  // With gaps, every admission state must be recorded as well as hash-bound.
  return ready.options.every(option => {
    if (sent.has(option.option_id)) return option.status === 'ready';
    const reason = excluded.get(option.option_id);
    if (reason === undefined) return !carriesGaps;
    return reason === 'not_analysable' ? option.status !== 'ready'
      : reason === 'olumi_proposed' ? graph.nodes.some(node => node.id === option.option_id
        && node.proposed_by === 'olumi' && node.analysis_participation !== 'included')
      : graph.nodes.some(node => node.id === option.option_id && node.option_status === reason);
  });
}

const HASH_ALGORITHM = 'sha256' as const;

// ---------------------------------------------------------------------------
// Contract-shaped hash envelopes (contract §9.1 / §9.2).
// ---------------------------------------------------------------------------

export interface AnalysisAffectingHash {
  readonly kind: 'analysis_affecting_hash';
  readonly value: string;
  readonly algorithm: typeof HASH_ALGORITHM;
  readonly projection_version: string;
  readonly graph_schema_version: string;
  readonly normaliser_version: string;
}

export interface GraphIdentityHash {
  readonly kind: 'graph_identity_hash';
  readonly value: string;
  readonly algorithm: typeof HASH_ALGORITHM;
  readonly projection_version: string;
  readonly graph_schema_version: string;
  readonly normaliser_version: string;
}


// ---------------------------------------------------------------------------
// A2 — hashes.
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return createHash(HASH_ALGORITHM).update(input).digest('hex');
}

/**
 * A2: CEE-local `graphIdentityHash`. Full 64-char SHA-256 over the versioned
 * identity normalisation (contract §9.2). Returns `null` for an absent or
 * identity-empty graph.
 *
 * Distinct from — and MUST NOT be confused with — the topology-only
 * `computeDeterministicGraphHash` (graph-hash.ts), which hashes node/edge
 * identity only and is a telemetry marker, not an identity hash (contract
 * §2.2 forbids reusing the topology hash as graphIdentityHash).
 *
 * Values are assumed JSON-safe, i.e. wire-originated. Like the sanctioned
 * analysis-affecting hash (both go through `stableStringify` → `JSON.stringify`),
 * a property explicitly set to `undefined` is indistinguishable from an absent
 * one, and `NaN`/`Infinity` serialise as `null`. `JSON.parse` never produces
 * these, so they are unreachable on the real ingress path; only hand-built
 * `GraphStateIngress` objects could carry them.
 */
export function computeGraphIdentityHash(
  graph: GraphStateIngress | null | undefined,
): GraphIdentityHash | null {
  const normalised = normaliseGraphForIdentity(graph);
  if (normalised === null) return null;

  return {
    kind: 'graph_identity_hash',
    value: sha256Hex(stableStringify(normalised)),
    algorithm: HASH_ALGORITHM,
    projection_version: IDENTITY_PROJECTION_VERSION,
    graph_schema_version: GRAPH_SCHEMA_VERSION,
    normaliser_version: IDENTITY_NORMALISER_VERSION,
  };
}

/**
 * Typed §9.1 envelope over the EXISTING analysis-affecting hash. Delegates to
 * the sanctioned `computeAnalysisAffectingGraphHash` — no reimplementation, no
 * behaviour change. Returns `null` when that hash is null (absent/empty graph).
 */
export function computeAnalysisAffectingHashRecord(
  graph: GraphStateIngress | null | undefined,
): AnalysisAffectingHash | null {
  const value = computeAnalysisAffectingGraphHash(graph);
  if (value === null) return null;
  return {
    kind: 'analysis_affecting_hash',
    value,
    algorithm: HASH_ALGORITHM,
    projection_version: ANALYSIS_PROJECTION_VERSION,
    graph_schema_version: GRAPH_SCHEMA_VERSION,
    normaliser_version: ANALYSIS_NORMALISER_VERSION,
  };
}

/**
 * Durable-version form of the analysis-affecting identity. It uses the same
 * projection/normaliser as freshness but retains the complete SHA-256 rather
 * than the established 16-hex freshness token.
 */
export function computeVersionAnalysisAffectingHashRecord(
  graph: GraphStateIngress | null | undefined,
): AnalysisAffectingHash | null {
  const value = computeAnalysisAffectingGraphHashSha256(graph);
  if (value === null) return null;
  return {
    kind: 'analysis_affecting_hash',
    value,
    algorithm: HASH_ALGORITHM,
    projection_version: ANALYSIS_PROJECTION_VERSION,
    graph_schema_version: GRAPH_SCHEMA_VERSION,
    normaliser_version: ANALYSIS_NORMALISER_VERSION,
  };
}

// ---------------------------------------------------------------------------
// A3 seam (dark/observe) — pure CAS evaluator. NOT WIRED.
// ---------------------------------------------------------------------------

export type GraphIdentityCasOutcome =
  | 'match'
  | 'mismatch'
  | 'no_expected'
  | 'unavailable';

export interface GraphIdentityCasResult {
  readonly outcome: GraphIdentityCasOutcome;
  /** The server-recomputed identity hash of the current graph, or null. */
  readonly currentHash: string | null;
}

/**
 * Pure compare-and-swap evaluator for the identity hash — the dark/observe
 * comparison the A3 live-writer plan will call server-side. Recomputes the
 * current graph's identity hash and compares it to the caller-supplied
 * `expected` value. NEVER throws, NEVER writes, and has no live call sites in
 * this slice.
 *
 * Outcomes (precedence in this order):
 *   - `unavailable`  — the current graph has no computable identity hash
 *                      (absent/empty); CAS cannot run.
 *   - `no_expected`  — caller supplied no source hash; observe-only, do not
 *                      treat as a conflict (existing callers stay safe).
 *   - `mismatch`     — expected ≠ current; a strict writer would reject this
 *                      as `stale_write` ONLY under a later enforce flag.
 *   - `match`        — expected === current.
 */
export function evaluateGraphIdentityCas(
  expected: string | null | undefined,
  currentGraph: GraphStateIngress | null | undefined,
): GraphIdentityCasResult {
  const current = computeGraphIdentityHash(currentGraph);
  if (current === null) {
    return { outcome: 'unavailable', currentHash: null };
  }
  if (expected == null || expected.length === 0) {
    return { outcome: 'no_expected', currentHash: current.value };
  }
  return {
    outcome: expected === current.value ? 'match' : 'mismatch',
    currentHash: current.value,
  };
}
