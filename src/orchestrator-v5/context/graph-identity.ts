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
import { computeAnalysisAffectingGraphHash } from './graph-hash.js';

// ---------------------------------------------------------------------------
// Versioned projection metadata (contract §8 "Normalisation must be versioned",
// §9.1/§9.2 "must include projection/version metadata").
// ---------------------------------------------------------------------------

/** Canonical graph schema family this normalisation targets. */
export const GRAPH_SCHEMA_VERSION = 'graph_v3' as const;

/** Bump when the identity normalisation rules change (fields, ordering, strip list). */
export const IDENTITY_NORMALISER_VERSION = '1' as const;

/** Bump when the identity projection's field policy changes. */
export const IDENTITY_PROJECTION_VERSION = 'identity.v1' as const;

/**
 * Metadata describing the EXISTING analysis-affecting projection owned by
 * graph-hash.ts. Recorded here so the §9.1 envelope carries version metadata
 * without editing the sanctioned implementation. These values annotate the
 * current behaviour; they do not alter it.
 */
export const ANALYSIS_NORMALISER_VERSION = '1' as const;
export const ANALYSIS_PROJECTION_VERSION = 'analysis_affecting.v1' as const;

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
// Transient UI state — excluded from BOTH hashes (contract §10).
//
// Selection, hover, viewport and purely local panel state are UI-ephemeral and
// never part of graph identity. Canvas LAYOUT (x/y/position/layout) is
// deliberately NOT in this list: contract §10 classifies persisted layout as
// DISPLAY IDENTITY and includes it in graphIdentityHash. None of these keys
// exist in today's persisted `scenarios.graph` schema (see A0 findings) — the
// strip is defensive so that if the UI ever bleeds transient state into a
// persisted payload it cannot perturb identity. The set is matched
// case-insensitively against object keys at every depth.
// ---------------------------------------------------------------------------

// Fail-safe asymmetry (load-bearing): for a CAS/identity hash, over-INCLUDING a
// field is safe (a spurious identity change → CAS mismatch → rejection), but
// over-EXCLUDING a real persisted field is DANGEROUS (two different graphs
// collapse to the same hash → a false CAS `match` → silent overwrite). So this
// list is deliberately CONSERVATIVE — only keys that are unambiguously UI
// scaffolding (the contract-named selection/hover/viewport plus clearly-
// namespaced state). Bare domain-ambiguous words (`active`, `focused`,
// `highlighted`, `zoom`, `scroll`, `pan`, bare `panel`) are intentionally NOT
// stripped: if such a field ever appears it stays in identity, which is the
// safe direction. A leaked bare `viewport.zoom` is still covered — the whole
// `viewport` object is stripped.
const TRANSIENT_UI_KEYS: ReadonlySet<string> = new Set(
  [
    'selected',
    'selection',
    'isselected',
    'hover',
    'hovered',
    'ishovered',
    'dragging',
    'isdragging',
    'viewport',
    'ui',
    'ui_state',
    'uistate',
    'panelstate',
    'panel_state',
    '__transient',
    '_transient',
  ].map((k) => k.toLowerCase()),
);

function isTransientKey(key: string): boolean {
  return TRANSIENT_UI_KEYS.has(key.toLowerCase());
}

/**
 * Deep clone `value`, dropping any object key in TRANSIENT_UI_KEYS at every
 * nesting level. Array element order is preserved (callers reorder the
 * identity-bearing arrays explicitly, below). Never mutates the input.
 *
 * The accumulator is a null-prototype object so an own `__proto__` key (which
 * `JSON.parse` of wire JSON can produce and `.passthrough()` does not strip)
 * survives as a real own property instead of vanishing through the prototype
 * setter — otherwise two graphs differing only in `__proto__` would collide to
 * one identity hash. Mirrors the same fix in the shared `stableStringify`.
 */
function stripTransientDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripTransientDeep);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (isTransientKey(key)) continue;
    out[key] = stripTransientDeep(obj[key]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// A1 — identity normalisation.
// ---------------------------------------------------------------------------

/**
 * The versioned identity projection envelope (contract §8 "Required target
 * concepts" — `NormalisedGraphIdentity`). `graph` is the full-fidelity,
 * transient-stripped, deterministically ordered persisted graph.
 */
export interface NormalisedGraphIdentity {
  readonly schema_version: string;
  readonly normaliser_version: string;
  readonly projection_version: string;
  readonly graph: unknown;
}

/**
 * Codepoint (UTF-16 code unit) total order — NOT `localeCompare`. Locale
 * collation returns 0 for distinct strings (canonically-equivalent Unicode,
 * collation-ignorable code points), and a 0 comparator makes the stable sort
 * preserve insertion order — insertion order would leak into the hash and
 * break order-invariance. `<`/`>` on strings is a locale-independent total
 * order, so equal-compare implies byte-identical JSON downstream.
 */
function compareCodeunits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const raw = record[key];
  return typeof raw === 'string' ? raw : '';
}

/** Sentinel for `undefined` array elements. No `JSON.stringify` output is a
 * bareword, so this cannot collide with a real element's serialisation. */
const UNDEFINED_ELEMENT_KEY = 'undefined';

/**
 * Stable string key for an element. `JSON.stringify(undefined)` returns the
 * VALUE `undefined` (not a string); coerce it to a fixed sentinel so degenerate
 * `undefined` array elements still get a deterministic total order.
 */
function stableKey(value: unknown): string {
  const s = stableStringify(value);
  return typeof s === 'string' ? s : UNDEFINED_ELEMENT_KEY;
}

/**
 * Decorate-sort-undecorate: serialise each element's tiebreak key ONCE (O(n)
 * serialisations), then sort by id + key. Avoids re-serialising both operands
 * on every comparison. The `key` tiebreak keeps ordering stable (hash
 * order-invariant) even when entries share an id — defensive against
 * malformed duplicates. Returns a fresh array; input is not mutated.
 */
function sortByIdThenSerialised(items: readonly unknown[]): unknown[] {
  return items
    .map((it) => {
      const r = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
      return { it, id: stringField(r, 'id'), key: stableKey(it) };
    })
    .sort((a, b) => {
      const idCmp = compareCodeunits(a.id, b.id);
      return idCmp !== 0 ? idCmp : compareCodeunits(a.key, b.key);
    })
    .map((d) => d.it);
}

/**
 * As above, keyed on (from, to) then the serialised tiebreak — so parallel
 * edges (same from,to) do not leak insertion order into the hash.
 */
function sortEdges(items: readonly unknown[]): unknown[] {
  return items
    .map((it) => {
      const r = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
      return { it, from: stringField(r, 'from'), to: stringField(r, 'to'), key: stableKey(it) };
    })
    .sort((a, b) => {
      const fromCmp = compareCodeunits(a.from, b.from);
      if (fromCmp !== 0) return fromCmp;
      const toCmp = compareCodeunits(a.to, b.to);
      return toCmp !== 0 ? toCmp : compareCodeunits(a.key, b.key);
    })
    .map((d) => d.it);
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * True when the graph carries no identity-bearing content (no nodes, edges or
 * options and no goal node). Like `computeAnalysisAffectingGraphHash`, an
 * absent/content-empty graph hashes to `null`. The two are not required to be
 * byte-identical on the degenerate all-empty-arrays case (they never compare to
 * each other — different purposes); returning `null` for an empty graph is the
 * safe identity outcome and drives the CAS evaluator's `unavailable` result.
 */
function isIdentityEmpty(graph: GraphStateIngress): boolean {
  const g = graph as Record<string, unknown>;
  const nodes = g.nodes;
  const edges = g.edges;
  const options = g.options;
  const goalNodeId = g.goal_node_id;
  return (
    !isNonEmptyArray(nodes) &&
    !isNonEmptyArray(edges) &&
    !isNonEmptyArray(options) &&
    goalNodeId === undefined
  );
}

/**
 * A1: deterministic, full-fidelity identity projection of a persisted graph.
 *
 * Full fidelity: retains labels, descriptions, units, provenance and every
 * other persisted field, plus any top-level graph keys beyond
 * nodes/edges/options. Excludes only transient UI state (TRANSIENT_UI_KEYS).
 * Returns `null` when the graph is absent or identity-empty.
 *
 * Ordering: nodes by id, edges by (from, to), options by id — each with a
 * serialised tiebreak — so the hash is invariant to array insertion order.
 * Key ordering within objects is handled by `stableStringify` at hash time.
 */
export function normaliseGraphForIdentity(
  graph: GraphStateIngress | null | undefined,
): NormalisedGraphIdentity | null {
  if (!graph) return null;
  if (isIdentityEmpty(graph)) return null;

  const stripped = stripTransientDeep(graph) as Record<string, unknown>;

  if (Array.isArray(stripped.nodes)) {
    stripped.nodes = sortByIdThenSerialised(stripped.nodes);
  }
  if (Array.isArray(stripped.edges)) {
    stripped.edges = sortEdges(stripped.edges);
  }
  if (Array.isArray(stripped.options)) {
    stripped.options = sortByIdThenSerialised(stripped.options);
  }

  return {
    schema_version: GRAPH_SCHEMA_VERSION,
    normaliser_version: IDENTITY_NORMALISER_VERSION,
    projection_version: IDENTITY_PROJECTION_VERSION,
    graph: stripped,
  };
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
