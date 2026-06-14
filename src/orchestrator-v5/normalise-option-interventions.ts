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
 * so the newer edit WINS while unrelated top-level metadata (target_match,
 * source, reasoning, value_confidence) is preserved. The persisted record then
 * matches draft-created options and survives the read-time NodeV3 strip.
 *
 * Precedence note: this MUST stay consistent with
 * `mergeInterventionSources` (src/orchestrator/tools/analysis-ready-helper.ts).
 * That helper is the READ side and returns numeric-only values; this is the
 * WRITE side and must additionally preserve/produce full InterventionV3 shape,
 * so the policy is mirrored here rather than shared. Centralising the
 * precedence into one helper is a deliberate (non-blocking) follow-up.
 *
 * Scope: INDEPENDENT of the Track S persist-site intercept repair
 * (`repairGraphForPersistence`), which it runs alongside — that operates on
 * factor observed-root intercepts; this operates on option intervention
 * bundles. The two touch disjoint node sets and commute.
 *
 * Safety (mirrors the persist-site repair doctrine):
 *  - No-op when there is no graph to persist (undefined/null) → returns the input.
 *  - Returns the ORIGINAL reference UNCHANGED when no option carries recoverable
 *    `data.interventions`/slash-keyed entries (every draft graph: its options
 *    carry only top-level interventions), so a no-promotion write is
 *    byte-identical to before this change.
 *  - Fail-open: never fails a commit. A detect/clone/merge throw persists the
 *    ORIGINAL graph unchanged (the clone is discarded). Emits a redacted warning
 *    (IDs + counts only, never values or graph content).
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
 * Overlay semantics (data wins, metadata preserved):
 *  - factor present in BOTH top-level and a recovered source → keep the existing
 *    InterventionV3 (target_match/source/reasoning/value_confidence) but set its
 *    `value` from the recovered source, and `unit`/`raw_value` only when the
 *    recovered source supplied them (the newer edit wins on the value);
 *  - factor present ONLY in a recovered source → fresh InterventionV3;
 *  - factor present ONLY at top-level → preserved verbatim.
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

  // Overlay the recovered (newer) values — data wins on `value`.
  for (const [fac, rec] of recovered) {
    const existing = out[fac];
    if (isPlainObject(existing)) {
      existing.value = rec.value;
      if (rec.unit !== undefined) existing.unit = rec.unit;
      if (rec.raw_value !== undefined) existing.raw_value = rec.raw_value;
      // Defensive: an existing top-level entry should already be a valid
      // InterventionV3, but synthesise the required fields if it is not.
      if (!isPlainObject(existing.target_match)) {
        existing.target_match = { node_id: fac, match_type: 'exact_id', confidence: 'high' };
      }
      if (existing.source === undefined) existing.source = 'user_specified';
    } else {
      out[fac] = freshInterventionV3(fac, rec);
    }
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
 * Normalise edit-added/edited option interventions to the canonical top-level
 * `InterventionV3` contract before persistence (Source 1/2 overlaid onto
 * top-level, data wins). Returns a repaired CLONE when at least one option
 * carries recoverable non-canonical interventions, otherwise the ORIGINAL
 * reference unchanged.
 */
export function normaliseOptionInterventionContract<T>(
  graph: T,
  ctx: OptionContractNormaliseContext = {},
): T {
  // Graph-absent no-op: nothing to persist/normalise.
  if (graph === undefined || graph === null) return graph;

  // 1. Detect (read-only) — keep clean graphs byte-identical (original reference).
  let dirtyOptionIds: string[];
  try {
    dirtyOptionIds = findOptionsNeedingPromotion(graph);
  } catch (err) {
    safeLog('warn', {
      event: 'v5.graph_persist.option_contract_normalise_failed',
      scenario_id: ctx.scenarioId,
      turn_id: ctx.turnId,
      reason: 'detect_failed',
      error_name: errorClass(err),
    }, '[commit] option-contract normalise detect threw; persisting the graph unchanged');
    return graph;
  }
  if (dirtyOptionIds.length === 0) return graph; // clean → original reference, unchanged

  // 2. Clone. A clone failure leaves no repaired artifact → persist the original.
  //    (Unreachable for DB-JSON graphs: JSON.stringify throws only on BigInt/circular.)
  let clone: T;
  try {
    clone = JSON.parse(JSON.stringify(graph)) as T;
  } catch (err) {
    safeLog('warn', {
      event: 'v5.graph_persist.option_contract_normalise_failed',
      scenario_id: ctx.scenarioId,
      turn_id: ctx.turnId,
      reason: 'clone_failed',
      error_name: errorClass(err),
    }, '[commit] option-contract normalise could not clone the graph; persisting the graph unchanged');
    return graph;
  }

  // 3. Merge on the CLONE. Any throw discards the clone and persists the
  //    untouched original — fail-open never leaves a node with data stripped but
  //    no top-level bundle.
  try {
    const nodes = (clone as { nodes?: unknown }).nodes;
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        if (!isPlainObject(node) || node.kind !== 'option') continue;
        const merged = buildMergedInterventions(node);
        if (merged === null) continue;
        node.interventions = merged;
        if (isPlainObject(node.data)) delete (node.data as Dict).interventions;
        for (const k of Object.keys(node)) {
          if (SLASH_KEY_RE.test(k)) delete node[k];
        }
      }
    }
  } catch (err) {
    safeLog('warn', {
      event: 'v5.graph_persist.option_contract_normalise_failed',
      scenario_id: ctx.scenarioId,
      turn_id: ctx.turnId,
      reason: 'merge_failed',
      error_name: errorClass(err),
    }, '[commit] option-contract normalise threw after cloning; persisting the original graph unchanged');
    return graph;
  }

  // 4. Merge succeeded. Redacted summary: IDs + counts only, never values.
  safeLog('info', {
    event: 'v5.graph_persist.option_contract_normalised',
    scenario_id: ctx.scenarioId,
    turn_id: ctx.turnId,
    ...(ctx.turnClass !== undefined ? { turn_class: ctx.turnClass } : {}),
    ...(ctx.source !== undefined && ctx.source !== null ? { source: ctx.source } : {}),
    corrected_count: dirtyOptionIds.length,
    node_ids: dirtyOptionIds,
  }, '[commit] normalised edit option interventions to the canonical top-level contract');

  return clone;
}
