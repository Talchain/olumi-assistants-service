/**
 * V5 `edit_graph` P0 — option-contract normalisation at the persist boundary.
 *
 * An option added/edited from client-supplied `graph_state` (or via the edit
 * prompt, which instructs intervention writes to
 * `/nodes/<opt>/data/interventions/<factor_id>`) can carry its interventions
 * under `node.data.interventions` (object) or slash-keyed
 * `node["data/interventions/<fac>"]` instead of the canonical OptionV3 location
 * — TOP-LEVEL `node.interventions: { <fac>: InterventionV3 }`.
 *
 * The graph NODE schema (`NodeV3`, src/schemas/cee-v3.ts) declares top-level
 * `interventions` but has NO `data` field and is NON-passthrough, so
 * `GraphV3.safeParse(persistedGraph)` STRIPS `node.data` on read
 * (`loadScenarioSnapshotForRunAnalysis`). The downstream
 * `mergeInterventionSources` read-merge documents `data.interventions` as the
 * authoritative Source 1 (it wins over top-level, which "may contain stale
 * values from a prior pipeline run") — but it runs on the already-parsed
 * (stripped) graph, so the edit is gone before it sees it.
 *
 * Two failure modes follow from the read-time strip:
 *  - add-option (top-level ABSENT): the option reaches run_analysis/PLoT wired
 *    to factors with ZERO interventions → 422 / `options_not_configured`.
 *  - intervention edit on an EXISTING option (top-level PRESENT + new
 *    `data.interventions`): the strip drops the user's edit and the STALE
 *    top-level value survives → run_analysis silently returns 200 on the wrong
 *    configuration (worse than the 422).
 *
 * This function MERGES `data.interventions` / slash-keyed entries onto the
 * canonical top-level bundle at the single `scenarios.graph` write chokepoint
 * (`commitDirectAnswer` → `store.append`), with the SAME precedence the read
 * path uses — Source 1 `data.interventions` > Source 2 slash-keyed > top-level —
 * so the newer edit WINS and is marked `source: 'user_specified'`, preserving
 * only the still-valid factor match (`target_match`) from any existing top-level
 * entry. The persisted record then matches draft-created options and survives
 * the read-time NodeV3 strip.
 *
 * Precedence note: this MUST stay consistent with
 * `mergeInterventionSources` (src/orchestrator/tools/analysis-ready-helper.ts).
 * That helper is the READ side and returns numeric-only values; this is the
 * WRITE side and must additionally preserve/produce full InterventionV3 shape,
 * so the policy is mirrored here rather than shared. Centralising the
 * precedence into one helper is a deliberate (non-blocking) follow-up.
 *
 * P0-A add-option containment (the node-level invariant): separately, NO node
 * may persist with a top-level `interventions` that is `null` or a non-record
 * (array/scalar). `NodeV3.interventions` is `z.record(...).optional()` on EVERY
 * kind, so `GraphV3.safeParse` REJECTS such a shape on read for ANY node (not
 * just options) → the persisted graph is unreadable and rerun fails
 * `options_not_configured`/500. PASS 1 below sweeps every node's invalid shape
 * to an empty record `{}` (the analysis-safe `needs_encoding` state). This is
 * containment only — it does not recover a value lost upstream. The
 * (option-only) recoverable promotion above is PASS 2.
 *
 * Scope: INDEPENDENT of the Track S persist-site intercept repair
 * (`repairGraphForPersistence`), which it runs alongside — that operates on
 * factor observed-root intercepts; this operates on option intervention
 * bundles + the node-level interventions-shape invariant. Disjoint fields; they
 * commute.
 *
 * Safety (mirrors the persist-site repair doctrine):
 *  - No-op when there is no graph to persist (undefined/null) → returns the input.
 *  - Returns the ORIGINAL reference UNCHANGED when no node needs the invariant
 *    sweep AND no option carries recoverable `data.interventions`/slash-keyed
 *    entries (every draft graph), so a no-change write is byte-identical.
 *  - Fail-open with a floor: PASS 1 (the null/non-record sweep) is total; PASS 2
 *    (promotion) is best-effort and, on any detect/clone/merge throw, fail-opens
 *    to the SWEPT graph — never re-exposing a parse-breaking shape. Emits a
 *    redacted warning (IDs + counts only, never values or graph content).
 */
import { extractNumericIntervention } from '../orchestrator/tools/analysis-ready-helper.js';
import { log } from '../utils/telemetry.js';

/** Slash-keyed flat intervention entry, e.g. `data/interventions/fac_annual_cost`. */
const SLASH_KEY_RE = /^data\/interventions\/(.+)$/;

/** Fixed error-class taxonomy for the redacted fallback diagnostic. */
const KNOWN_ERROR_NAMES = new Set(['TypeError', 'RangeError', 'SyntaxError', 'Error']);

/** Redacted error class — never the message (which could carry values/paths). */
function errorClass(err: unknown): string {
  return err instanceof Error
    ? (KNOWN_ERROR_NAMES.has(err.name) ? err.name : 'unknown_error')
    : 'non_error_throw';
}

/** Best-effort redacted log that itself never throws — observability must never affect the flow. */
function safeLog(level: 'info' | 'warn', payload: Record<string, unknown>, msg: string): void {
  try {
    log[level](payload, msg);
  } catch {
    /* observability is best-effort; never throw from a diagnostic */
  }
}

export interface OptionContractNormaliseContext {
  readonly scenarioId?: string;
  /** Per-turn correlation id (turn_id doubles as request_id in V5). */
  readonly turnId?: string;
  readonly turnClass?: string;
  /** Originating handler id (e.g. edit_graph, set_factor_value) — non-sensitive. */
  readonly source?: string;
}

type Dict = Record<string, unknown>;

/** A numeric value recovered from a non-canonical source, with optional carried unit/raw_value. */
interface RecoveredIntervention {
  readonly value: number;
  readonly unit?: string;
  readonly raw_value?: number | string | boolean;
}

function isPlainObject(v: unknown): v is Dict {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * P0-A add-option residual — an option whose top-level `interventions` is
 * PRESENT but NOT a plain-object record (the live failure: `interventions:null`;
 * also any non-record like an array/scalar). `NodeV3.interventions` is
 * `z.record(...).optional()` — declared on EVERY node kind, not just options —
 * so `GraphV3.safeParse` ACCEPTS absent/`{}`/record but REJECTS `null`/array/
 * scalar ("Expected object, received null") on read for ANY node, making the
 * persisted graph unreadable and rerun fail `options_not_configured`/500. An
 * An ABSENT `interventions` key is safe (optional) and NOT flagged. An explicit
 * `undefined` value is likewise treated as absent: it is not persistable JSON
 * (JSON.stringify drops undefined-valued keys), so it is not a parse-bomb and
 * flagging it would only cost an unnecessary clone + a misleading log.
 *
 * JSON-only assumption: `scenarios.graph` is a Postgres `jsonb` column, so a
 * persisted node's `interventions` is always a JSON value (object / array /
 * string / number / boolean / null) — never a `Date`/`Map`/class instance.
 * Under that assumption `isPlainObject` is a true record catch-all: every
 * non-record JSON value (null, array, scalar) is flagged, and every JSON object
 * is a valid record. Non-JSON objects cannot reach this path.
 */
function hasInvalidInterventionsShape(node: Dict): boolean {
  return 'interventions' in node && node.interventions !== undefined && !isPlainObject(node.interventions);
}

function carriedUnitRaw(value: number, src: unknown): RecoveredIntervention {
  if (!isPlainObject(src)) return { value };
  const out: { value: number; unit?: string; raw_value?: number | string | boolean } = { value };
  if (typeof src.unit === 'string') out.unit = src.unit;
  const rawValue = src.raw_value;
  if (typeof rawValue === 'number' || typeof rawValue === 'string' || typeof rawValue === 'boolean') {
    out.raw_value = rawValue;
  }
  return out;
}

/**
 * Recover interventions from the NON-canonical locations only, with the read
 * path's precedence: Source 1 `data.interventions` wins over Source 2
 * slash-keyed. Top-level (Source 3) is intentionally NOT read here — it is the
 * base the recovered values are overlaid ONTO (see {@link buildMergedInterventions}).
 * Returns an empty map when the option carries nothing to overlay (every draft
 * option), which is the no-op signal.
 */
function recoverFromDataSources(node: Dict): Map<string, RecoveredIntervention> {
  const out = new Map<string, RecoveredIntervention>();

  // Source 1: data.interventions ({ fac: number } or { fac: { value, ... } }).
  const data = node.data;
  if (isPlainObject(data) && isPlainObject(data.interventions)) {
    for (const [fac, src] of Object.entries(data.interventions as Dict)) {
      const value = extractNumericIntervention(src);
      if (value === undefined) continue;
      out.set(fac, carriedUnitRaw(value, src));
    }
  }

  // Source 2: slash-keyed flat entries `data/interventions/<fac>` (scalar wrapping).
  for (const [k, v] of Object.entries(node)) {
    const m = SLASH_KEY_RE.exec(k);
    if (!m) continue;
    const fac = m[1]!;
    if (out.has(fac)) continue; // Source 1 wins
    const value = extractNumericIntervention(v);
    if (value === undefined) continue;
    out.set(fac, carriedUnitRaw(value, v));
  }

  return out;
}

/** Construct a fresh canonical InterventionV3 for a factor with no pre-existing top-level entry. */
function freshInterventionV3(fac: string, rec: RecoveredIntervention): Dict {
  const iv: Dict = {
    value: rec.value,
    source: 'user_specified',
    target_match: { node_id: fac, match_type: 'exact_id', confidence: 'high' },
  };
  if (rec.unit !== undefined) iv.unit = rec.unit;
  if (rec.raw_value !== undefined) iv.raw_value = rec.raw_value;
  return iv;
}

/**
 * Build the canonical top-level `interventions` bundle for an option by
 * overlaying the recovered `data.interventions`/slash-keyed values onto the
 * existing top-level bundle, or return `null` when there is nothing to overlay
 * (no recoverable non-canonical entries → the option is already canonical /
 * a draft; leave it untouched).
 *
 * Overlay semantics (data wins; provenance stays truthful):
 *  - factor present in BOTH top-level and a recovered source → a USER EDIT:
 *    rebuild a fresh `user_specified` InterventionV3 from the recovered value,
 *    preserving ONLY the still-valid `target_match` from the existing entry.
 *    Stale `source`/`reasoning`/`value_confidence`/`display_value` described the
 *    OLD value (`source` means "how this intervention was determined") and are
 *    NOT carried forward — that would misreport the edit's provenance;
 *  - factor present ONLY in a recovered source → fresh `user_specified` InterventionV3;
 *  - factor present ONLY at top-level → preserved verbatim (not edited).
 */
function buildMergedInterventions(node: Dict): Dict | null {
  const recovered = recoverFromDataSources(node);
  if (recovered.size === 0) return null; // nothing to overlay → no-op

  const out: Dict = {};

  // Base: preserve the existing top-level bundle (and its per-intervention metadata).
  const top = node.interventions;
  if (isPlainObject(top)) {
    for (const [fac, iv] of Object.entries(top)) {
      out[fac] = isPlainObject(iv) ? { ...iv } : iv;
    }
  }

  // Overlay the recovered (newer) values — data wins, and an overridden value is
  // re-marked `user_specified` (only the factor match is carried from the old entry).
  for (const [fac, rec] of recovered) {
    const fresh = freshInterventionV3(fac, rec);
    const existing = out[fac];
    if (isPlainObject(existing) && isPlainObject(existing.target_match)) {
      fresh.target_match = existing.target_match;
    }
    out[fac] = fresh;
  }

  return out;
}

/** Collect ids of option nodes that carry recoverable non-canonical interventions. Read-only. */
function findOptionsNeedingPromotion(graph: unknown): string[] {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return [];
  const ids: string[] = [];
  for (const node of graph.nodes) {
    if (!isPlainObject(node) || node.kind !== 'option') continue;
    if (recoverFromDataSources(node).size > 0) {
      ids.push(typeof node.id === 'string' ? node.id : '<unknown>');
    }
  }
  return ids;
}

/**
 * Collect ids of ANY node (not just options) whose top-level `interventions` is
 * null/non-record. The parse-bomb surface is node-level: `NodeV3.interventions`
 * is declared on every kind, so `GraphV3.safeParse` rejects `interventions:null`
 * on a factor/decision/goal/risk node too. Read-only.
 */
function findNodesWithInvalidInterventions(graph: unknown): string[] {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return [];
  const ids: string[] = [];
  for (const node of graph.nodes) {
    if (!isPlainObject(node)) continue;
    if (hasInvalidInterventionsShape(node)) {
      ids.push(typeof node.id === 'string' ? node.id : '<unknown>');
    }
  }
  return ids;
}

/**
 * PASS 1 — the minimal, TOTAL null/non-record invariant sweep. Coerce ANY
 * node's top-level `interventions: null` (or a non-record array/scalar) to an
 * empty record `{}`. Covers every node kind because the parse-bomb surface is
 * node-level (see {@link findNodesWithInvalidInterventions}). Deliberately
 * separate from the recoverable-promotion logic (which stays option-only) so
 * that a promotion failure (PASS 2 fail-open) can NEVER re-expose a
 * parse-breaking `interventions:null` shape. Returns the ORIGINAL reference when
 * no node is invalid (byte-identical no-op). The only failure mode is a
 * JSON-clone throw (circular/BigInt graph) — which cannot be persisted as jsonb
 * anyway — so the caller treats a sweep throw as "nothing persistable to fix".
 */
function sweepInvalidNodeInterventions<T>(graph: T): { graph: T; ids: string[] } {
  const ids = findNodesWithInvalidInterventions(graph);
  if (ids.length === 0) return { graph, ids };
  const clone = JSON.parse(JSON.stringify(graph)) as T;
  const nodes = (clone as { nodes?: unknown }).nodes;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (isPlainObject(node) && hasInvalidInterventionsShape(node)) {
        node.interventions = {};
      }
    }
  }
  return { graph: clone, ids };
}

/**
 * Redacted success summary — IDs + counts only, never values. No-op when nothing
 * changed. `node_ids` are the affected nodes from EITHER pass — the node-level
 * invariant sweep (any kind) and/or the option-only recoverable promotion — so
 * the event name is node-neutral (it can fire for a factor/decision/goal/risk
 * node swept by PASS 1, not just options).
 */
function emitNormalised(ids: string[], ctx: OptionContractNormaliseContext): void {
  if (ids.length === 0) return;
  safeLog('info', {
    event: 'v5.graph_persist.interventions_normalised',
    scenario_id: ctx.scenarioId,
    turn_id: ctx.turnId,
    ...(ctx.turnClass !== undefined ? { turn_class: ctx.turnClass } : {}),
    ...(ctx.source !== undefined && ctx.source !== null ? { source: ctx.source } : {}),
    corrected_count: ids.length,
    node_ids: ids,
  }, '[commit] normalised graph node interventions (option-contract promotion and/or invalid-shape sweep)');
}

/**
 * Normalise edit-added/edited option interventions before persistence. Two
 * responsibilities at the single `scenarios.graph` write chokepoint:
 *
 *  1. PROMOTE recoverable non-canonical interventions (data.interventions /
 *     slash-keyed) onto the canonical top-level `InterventionV3` contract
 *     (Source 1/2 overlaid onto top-level, data wins) — #276/#278.
 *  2. COERCE an analysis-invalid top-level `interventions` shape (null or a
 *     non-record) to an empty record `{}` — P0-A add-option containment. An
 *     option must never persist with `interventions:null`, which `GraphV3`
 *     rejects on read (rerun 500 / options_not_configured); `{}` is the
 *     analysis-safe `needs_encoding` state. This is containment only — it does
 *     not recover any value lost upstream.
 *
 * Returns a repaired CLONE when at least one option needs either treatment,
 * otherwise the ORIGINAL reference unchanged (clean/draft graphs are
 * byte-identical no-ops).
 */
export function normaliseOptionInterventionContract<T>(
  graph: T,
  ctx: OptionContractNormaliseContext = {},
): T {
  // Graph-absent no-op: nothing to persist/normalise.
  if (graph === undefined || graph === null) return graph;

  // ── PASS 1 — TOTAL null/non-record invariant sweep (ALL node kinds) ─────────
  // No node may persist with `interventions:null` (or a non-record), which
  // GraphV3 rejects on read for ANY kind. This sweep is independent of PASS 2
  // below: a promotion failure can never re-expose the parse-breaking shape,
  // because PASS 2 fail-opens to THIS swept graph, not the raw original.
  let base: T = graph;
  let sweptIds: string[] = [];
  try {
    const swept = sweepInvalidNodeInterventions(graph);
    base = swept.graph;
    sweptIds = swept.ids;
  } catch (err) {
    // Only reachable on a circular/BigInt graph — which cannot be persisted as
    // jsonb regardless (the write would fail), so there is no persisted
    // parse-bomb to prevent here. Fail-open to the original and continue.
    safeLog('warn', {
      event: 'v5.graph_persist.interventions_sweep_failed',
      scenario_id: ctx.scenarioId,
      turn_id: ctx.turnId,
      error_name: errorClass(err),
    }, '[commit] node interventions invariant sweep threw; persisting the graph unchanged');
    base = graph;
    sweptIds = [];
  }

  // ── PASS 2 — recoverable promotion (#276/#278), best-effort ─────────────────
  // Operates on the SWEPT `base`. Every fail-open path returns `base` (which
  // already satisfies the PASS-1 invariant), NEVER the raw original `graph`.
  const finishWithoutPromotion = (): T => {
    emitNormalised(sweptIds, ctx); // no-op when the sweep also changed nothing
    return base;
  };

  let promoteIds: string[];
  try {
    promoteIds = findOptionsNeedingPromotion(base);
  } catch (err) {
    safeLog('warn', {
      event: 'v5.graph_persist.option_contract_normalise_failed',
      scenario_id: ctx.scenarioId, turn_id: ctx.turnId, reason: 'detect_failed', error_name: errorClass(err),
    }, '[commit] option-contract promotion detect threw; persisting the swept graph');
    return finishWithoutPromotion();
  }
  if (promoteIds.length === 0) return finishWithoutPromotion();

  let clone: T;
  try {
    clone = JSON.parse(JSON.stringify(base)) as T;
  } catch (err) {
    safeLog('warn', {
      event: 'v5.graph_persist.option_contract_normalise_failed',
      scenario_id: ctx.scenarioId, turn_id: ctx.turnId, reason: 'clone_failed', error_name: errorClass(err),
    }, '[commit] option-contract promotion could not clone the graph; persisting the swept graph');
    return finishWithoutPromotion();
  }

  // Merge on the CLONE. Any throw discards the clone and persists the SWEPT base
  // (PASS-1 invariant intact) — never a node with data stripped but no top-level
  // bundle, and never a re-exposed interventions:null.
  try {
    const nodes = (clone as { nodes?: unknown }).nodes;
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        if (!isPlainObject(node) || node.kind !== 'option') continue;
        const merged = buildMergedInterventions(node);
        if (merged === null) continue;
        node.interventions = merged;
        if (isPlainObject(node.data)) {
          delete (node.data as Dict).interventions;
          // Drop a now-empty `data` object (cosmetic: NodeV3 strips `data` on read).
          if (Object.keys(node.data as Dict).length === 0) delete (node as Dict).data;
        }
        for (const k of Object.keys(node)) {
          if (SLASH_KEY_RE.test(k)) delete node[k];
        }
      }
    }
  } catch (err) {
    safeLog('warn', {
      event: 'v5.graph_persist.option_contract_normalise_failed',
      scenario_id: ctx.scenarioId, turn_id: ctx.turnId, reason: 'merge_failed', error_name: errorClass(err),
    }, '[commit] option-contract promotion threw after cloning; persisting the swept graph');
    return finishWithoutPromotion();
  }

  // Both passes succeeded. Redacted summary: union of swept + promoted ids.
  emitNormalised([...new Set([...sweptIds, ...promoteIds])], ctx);
  return clone;
}
