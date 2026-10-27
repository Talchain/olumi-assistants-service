/**
 * The identity normalisation of a graph (contract §8–§10), on its own so the model-program path can read a saved
 * graph's identity without loading the legacy analysis code `graph-identity.ts` also holds (W5, alpha wall).
 * `graph-identity.ts` re-exports everything here; nothing in the normalisation changed, so no persisted hash moves. The identity
 * hash itself lives here too, so the program's save (`core-write.ts`) reads it without loading that module either.
 */
import { createHash } from 'node:crypto';

import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { goalScopeMeaning } from '../../schemas/goal-scope.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';


/** Canonical graph schema family this normalisation targets. */
export const GRAPH_SCHEMA_VERSION = 'graph_v3' as const;

/** Bump when the identity normalisation rules change (fields, ordering, strip list). */
export const IDENTITY_NORMALISER_VERSION = '1' as const;

/** Bump when the identity projection's field policy changes. */
export const IDENTITY_PROJECTION_VERSION = 'identity.v1' as const;

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
// EXPORTED (C8-A review, 2026-08-25) so guards DERIVE this set instead of
// mirroring it. A hand-written copy in a test was measured unable to see the
// set GROW: it REDded when a key was removed and stayed fully green when one
// was added — the hand-maintained-mirror defect living inside the guard that
// exists to prevent it. Export only; the membership and the projection are
// unchanged, so no persisted hash moves and IDENTITY_NORMALISER_VERSION stands.
export const TRANSIENT_UI_KEYS: ReadonlySet<string> = new Set(
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
export function isIdentityEmptyGraph(
  graph: GraphStateIngress | null | undefined,
): boolean {
  return !graph || isIdentityEmpty(graph);
}

/**
 * Deterministic ORDERING ONLY — no key stripping, no hashing, no envelope.
 *
 * Added (C8-A review, 2026-08-25) so a consumer that must NOT inherit the
 * transient strip can still be order-invariant. `normaliseGraphForIdentity`
 * couples the two: it strips `TRANSIENT_UI_KEYS` at every depth AND orders the
 * entry arrays. The model-version creation policy needs the ordering and must
 * not have the strip — a factor whose id normalises into that set (a factor
 * labelled "UI" → `ui`) had its interventions entry deleted from both sides of
 * the comparison, so a real edit compared equal and its version was silently
 * dropped.
 *
 * Reuses the SAME comparators as the identity normaliser rather than restating
 * them; a second copy of an ordering rule is the hand-maintained twin this file
 * already warns about. Pure; never mutates its input. Does not alter any
 * persisted hash — nothing calls it from the identity or CAS paths.
 */
export function orderGraphEntriesForComparison(graph: unknown): unknown {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    return graph;
  }
  const out: Record<string, unknown> = { ...(graph as Record<string, unknown>) };
  if (Array.isArray(out.nodes)) out.nodes = sortByIdThenSerialised(out.nodes);
  if (Array.isArray(out.edges)) out.edges = sortEdges(out.edges);
  if (Array.isArray(out.options)) out.options = sortByIdThenSerialised(out.options);
  return out;
}

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
  // `ref_high_water` (stable entity refs, `graph/entity-refs.ts`) is a COUNTER, not content: the highest ref number ever
  // issued per prefix. Keeping it out lets a restore raise it (so a retired ref is never reissued) while the restored
  // bytes still bind to the restored version's identity. `node.ref` itself stays IN identity, like `label`. Excluding a
  // key no persisted graph held before this change moves no existing hash, so IDENTITY_NORMALISER_VERSION stands.
  delete stripped.ref_high_water;

  if (Array.isArray(stripped.nodes)) {
    // Scope sources do not change meaning. Bind this projection to NODE FIELDS,
    // never a nested key (an intervention's factor id may itself be goal_scope).
    stripped.nodes = sortByIdThenSerialised(stripped.nodes.map(raw => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Object.prototype.hasOwnProperty.call(raw, 'goal_scope')) return raw;
      return { ...raw, goal_scope: goalScopeMeaning((raw as Record<string, unknown>).goal_scope) };
    }));
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
// A2 — the identity hash.
// ---------------------------------------------------------------------------

export const HASH_ALGORITHM = 'sha256' as const;

export interface GraphIdentityHash {
  readonly kind: 'graph_identity_hash';
  readonly value: string;
  readonly algorithm: typeof HASH_ALGORITHM;
  readonly projection_version: string;
  readonly graph_schema_version: string;
  readonly normaliser_version: string;
}

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
