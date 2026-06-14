/**
 * V5 `edit_graph` P0 — option-contract normalisation at the persist boundary.
 *
 * An option added/edited from client-supplied `graph_state` can persist its
 * interventions under `node.data.interventions` (or slash-keyed
 * `node["data/interventions/<fac>"]`) instead of the canonical OptionV3 location
 * — TOP-LEVEL `node.interventions: { <fac>: InterventionV3 }`. Draft-created
 * options always use the top-level location.
 *
 * The graph NODE schema (`NodeV3`, src/schemas/cee-v3.ts) declares top-level
 * `interventions` but has NO `data` field and is NON-passthrough, so
 * `GraphV3.safeParse(persistedGraph)` STRIPS `node.data` on read
 * (`loadScenarioSnapshotForRunAnalysis`). The downstream
 * `mergeInterventionSources` read-merge looks like it would heal
 * `data.interventions`, but it runs on the already-parsed (stripped) graph, so
 * the interventions are gone before it sees them. The edit-added option then
 * reaches `run_analysis`/PLoT wired to factors but with ZERO interventions →
 * PLoT 422 / `options_not_configured`.
 *
 * This function promotes such interventions to the canonical top-level
 * `InterventionV3` contract at the single `scenarios.graph` write chokepoint
 * (`commitDirectAnswer` → `store.append`), so the persisted record matches
 * draft-created options and survives the read-time NodeV3 strip.
 *
 * Scope: this is the V5 edit-pipeline lane only. It is INDEPENDENT of the Track S
 * persist-site intercept repair (`repairGraphForPersistence`) which it runs
 * alongside — that operates on factor observed-root intercepts; this operates on
 * option intervention bundles. Neither touches the other's node set.
 *
 * Safety (mirrors the persist-site repair doctrine):
 *  - No-op when there is no graph to persist (undefined/null) → returns the input.
 *  - Returns the ORIGINAL reference UNCHANGED when no option needs promotion
 *    (every draft graph: its options already carry top-level interventions), so a
 *    no-promotion write is byte-identical to before this change.
 *  - Fail-open: never fails a commit. A detect/clone/promote throw persists the
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

function isPlainObject(v: unknown): v is Dict {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Build the canonical top-level `interventions` bundle for an option node from
 * its non-canonical locations, or return `null` when the node needs no
 * promotion (already has a non-empty top-level bundle, or carries no
 * recoverable interventions anywhere).
 *
 * Precedence mirrors `mergeInterventionSources` (Source 1 `data.interventions`
 * wins over Source 2 slash-keyed). The top-level location (Source 3) is the
 * SKIP condition here, not a contribution: an option that already has a
 * non-empty top-level bundle is canonical and left untouched (its existing
 * InterventionV3 entries — with `reasoning`/`value_confidence`/etc. — must not
 * be rebuilt or lost).
 */
function buildPromotedInterventions(node: Dict): Dict | null {
  const top = node.interventions;
  if (isPlainObject(top) && Object.keys(top).length > 0) {
    // Already canonical — never touch a draft-shaped option.
    return null;
  }

  const out: Dict = {};

  // Source 1: data.interventions ({ fac: number } or { fac: { value, ... } }).
  const data = node.data;
  if (isPlainObject(data) && isPlainObject(data.interventions)) {
    for (const [fac, srcVal] of Object.entries(data.interventions as Dict)) {
      const value = extractNumericIntervention(srcVal);
      if (value === undefined) continue;
      out[fac] = buildInterventionV3(fac, value, srcVal);
    }
  }

  // Source 2: slash-keyed flat entries `data/interventions/<fac>` (scalar wrapping).
  for (const [k, v] of Object.entries(node)) {
    const m = SLASH_KEY_RE.exec(k);
    if (!m) continue;
    const fac = m[1]!;
    if (fac in out) continue; // Source 1 wins
    const value = extractNumericIntervention(v);
    if (value === undefined) continue;
    out[fac] = buildInterventionV3(fac, value, v);
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Construct a canonical `InterventionV3` from a recovered numeric value, lifting
 * `unit`/`raw_value` from an object-form source when present. `source` is
 * `user_specified` (these arrive via the user's edit). `target_match` is
 * synthesised by exact id — the bundle key IS the factor id. `cap` is dropped
 * (not an InterventionV3 field).
 */
function buildInterventionV3(fac: string, value: number, srcVal: unknown): Dict {
  const iv: Dict = {
    value,
    source: 'user_specified',
    target_match: { node_id: fac, match_type: 'exact_id', confidence: 'high' },
  };
  if (isPlainObject(srcVal)) {
    const unit = srcVal.unit;
    if (typeof unit === 'string') iv.unit = unit;
    const rawValue = srcVal.raw_value;
    if (typeof rawValue === 'number' || typeof rawValue === 'string' || typeof rawValue === 'boolean') {
      iv.raw_value = rawValue;
    }
  }
  return iv;
}

/** Collect ids of option nodes that need promotion. Read-only; throws only on a malformed graph. */
function findOptionsNeedingPromotion(graph: unknown): string[] {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return [];
  const ids: string[] = [];
  for (const node of graph.nodes) {
    if (!isPlainObject(node) || node.kind !== 'option') continue;
    if (buildPromotedInterventions(node) !== null) {
      ids.push(typeof node.id === 'string' ? node.id : '<unknown>');
    }
  }
  return ids;
}

/**
 * Normalise edit-added option interventions to the canonical top-level
 * `InterventionV3` contract before persistence. Returns a repaired CLONE when at
 * least one option needs promotion, otherwise the ORIGINAL reference unchanged.
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

  // 3. Promote on the CLONE. Any throw discards the clone and persists the
  //    untouched original — fail-open never leaves a node with data stripped but
  //    no top-level bundle.
  try {
    const nodes = (clone as { nodes?: unknown }).nodes;
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        if (!isPlainObject(node) || node.kind !== 'option') continue;
        const promoted = buildPromotedInterventions(node);
        if (promoted === null) continue;
        node.interventions = promoted;
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
      reason: 'promote_failed',
      error_name: errorClass(err),
    }, '[commit] option-contract normalise threw after cloning; persisting the original graph unchanged');
    return graph;
  }

  // 4. Promotion succeeded. Redacted summary: IDs + counts only, never values.
  safeLog('info', {
    event: 'v5.graph_persist.option_contract_normalised',
    scenario_id: ctx.scenarioId,
    turn_id: ctx.turnId,
    ...(ctx.turnClass !== undefined ? { turn_class: ctx.turnClass } : {}),
    ...(ctx.source !== undefined && ctx.source !== null ? { source: ctx.source } : {}),
    corrected_count: dirtyOptionIds.length,
    node_ids: dirtyOptionIds,
  }, '[commit] promoted edit-added option interventions to the canonical top-level contract');

  return clone;
}
