/**
 * Lane C3 / decision ③ — node↔options[] consistency at the persist boundary.
 *
 * THE DIVERGENCE THIS CLOSES (debit b, R-3 probe). When an option is added as
 * an option-KIND node (the live add path — edit_graph and the new typed
 * add-option transaction both land the option in `graph.nodes`), the top-level
 * `graph.options[]` array is NOT updated. A consumer that reads top-level
 * `options[]` (the V3-canonical option surface) therefore cannot see the added
 * option, while a consumer reading option-NODES can — the two views diverge
 * (probe A2/B1: `options[]` stayed 3 after an option was added to `nodes[]`).
 *
 * Decision ③ (Paul, write-both): keep the two representations consistent at the
 * single `scenarios.graph` write chokepoint (`commitDirectAnswer` →
 * `store.append`, alongside `normaliseOptionInterventionContract`), by MIRRORING
 * every option-node into `options[]`. This is the least-downstream-churn option;
 * retiring top-level `options[]` would touch every PLoT/ISL analysis consumer.
 *
 * SCOPE — strictly ADDITIVE + idempotent. For every option-KIND node whose id
 * is NOT already present in top-level `options[]`, append a canonical OptionV3
 * entry DERIVED from the node (id, label, status, interventions, is_baseline).
 * It never modifies or removes an existing `options[]` entry: deletion of a
 * removed option's `options[]` entry stays owned by
 * `mergeAppliedGraphForPersistence` (the edit-path merge). On a graph where
 * every option-node already has an `options[]` entry (every draft graph, whose
 * options are mirrored in sync), this is a byte-identical no-op — the ORIGINAL
 * reference is returned unchanged.
 *
 * ORDERING — runs AFTER `normaliseOptionInterventionContract` so the
 * interventions bundle a mirrored entry copies is already the canonical
 * top-level shape (the sweep + promotion have run). Disjoint fields; they
 * commute except that the interventions must be normalised first.
 *
 * SAFETY (mirrors the persist-site repair doctrine): no-op on an absent/null
 * graph; fail-open on any detect/clone throw (returns the input unchanged —
 * never a half-written `options[]`); emits a redacted summary (ids + counts
 * only, never values or graph content).
 */
import { log } from '../utils/telemetry.js';

type Dict = Record<string, unknown>;

const KNOWN_ERROR_NAMES = new Set(['TypeError', 'RangeError', 'SyntaxError', 'Error']);

function errorClass(err: unknown): string {
  return err instanceof Error
    ? KNOWN_ERROR_NAMES.has(err.name)
      ? err.name
      : 'unknown_error'
    : 'non_error_throw';
}

function safeLog(level: 'info' | 'warn', payload: Record<string, unknown>, msg: string): void {
  try {
    log[level](payload, msg);
  } catch {
    /* observability is best-effort; never throw from a diagnostic */
  }
}

function isPlainObject(v: unknown): v is Dict {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export interface ReconcileOptionsContext {
  readonly scenarioId?: string;
  readonly turnId?: string;
  readonly turnClass?: string;
  readonly source?: string;
}

/** True iff the interventions bundle carries at least one numeric-valued entry. */
function hasNumericIntervention(interventions: unknown): boolean {
  if (!isPlainObject(interventions)) return false;
  for (const iv of Object.values(interventions)) {
    if (typeof iv === 'number' && Number.isFinite(iv)) return true;
    if (isPlainObject(iv) && typeof iv.value === 'number' && Number.isFinite(iv.value)) {
      return true;
    }
  }
  return false;
}

/**
 * Build the canonical OptionV3 entry for an option-node. Status is derived
 * conservatively from the node's own interventions: a configured option
 * (>=1 numeric effect value) is `ready`; an option with no effect values is
 * `needs_encoding` (the analysis-safe unconfigured state) — never an
 * over-optimistic `ready` on an empty bundle. The authoritative per-option
 * readiness is still computed by run_analysis; this mirror only needs to name
 * the same configuration state so an `options[]` reader is not misled.
 */
function optionEntryFromNode(node: Dict): Dict {
  const interventions = isPlainObject(node.interventions) ? node.interventions : {};
  const entry: Dict = {
    id: node.id,
    label: typeof node.label === 'string' && node.label.length > 0 ? node.label : node.id,
    status: hasNumericIntervention(interventions) ? 'ready' : 'needs_encoding',
    interventions,
  };
  if (node.is_baseline === true) entry.is_baseline = true;
  return entry;
}

/** Collect ids of option-nodes not present in the top-level `options[]`. Read-only. */
function findOptionNodesMissingFromOptions(graph: unknown): string[] {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return [];
  const options = graph.options;
  // A present-but-malformed `options` (non-array) is a pre-existing corruption
  // this pass must not touch — reconciling would clobber it. No-op.
  if (options !== undefined && !Array.isArray(options)) return [];
  const existingOptionIds = new Set<string>();
  if (Array.isArray(options)) {
    for (const opt of options) {
      if (isPlainObject(opt) && typeof opt.id === 'string') existingOptionIds.add(opt.id);
    }
  }
  const missing: string[] = [];
  for (const node of graph.nodes) {
    if (!isPlainObject(node) || node.kind !== 'option') continue;
    if (typeof node.id !== 'string') continue;
    if (!existingOptionIds.has(node.id)) missing.push(node.id);
  }
  return missing;
}

/**
 * Mirror every option-node missing from top-level `options[]` into `options[]`,
 * additively. Returns a repaired CLONE when at least one option-node needs
 * mirroring, otherwise the ORIGINAL reference unchanged (byte-identical no-op).
 */
export function reconcileTopLevelOptionsFromNodes<T>(
  graph: T,
  ctx: ReconcileOptionsContext = {},
): T {
  if (graph === undefined || graph === null) return graph;

  let missingIds: string[];
  try {
    missingIds = findOptionNodesMissingFromOptions(graph);
  } catch (err) {
    safeLog(
      'warn',
      {
        event: 'v5.graph_persist.options_reconcile_failed',
        scenario_id: ctx.scenarioId,
        turn_id: ctx.turnId,
        reason: 'detect_failed',
        error_name: errorClass(err),
      },
      '[commit] node↔options[] reconcile detect threw; persisting the graph unchanged',
    );
    return graph;
  }
  if (missingIds.length === 0) return graph;

  let clone: T;
  try {
    clone = JSON.parse(JSON.stringify(graph)) as T;
  } catch (err) {
    safeLog(
      'warn',
      {
        event: 'v5.graph_persist.options_reconcile_failed',
        scenario_id: ctx.scenarioId,
        turn_id: ctx.turnId,
        reason: 'clone_failed',
        error_name: errorClass(err),
      },
      '[commit] node↔options[] reconcile could not clone the graph; persisting unchanged',
    );
    return graph;
  }

  try {
    const c = clone as { nodes?: unknown; options?: unknown };
    const options: unknown[] = Array.isArray(c.options) ? c.options : [];
    const missing = new Set(missingIds);
    const nodes = Array.isArray(c.nodes) ? c.nodes : [];
    for (const node of nodes) {
      if (!isPlainObject(node) || node.kind !== 'option') continue;
      if (typeof node.id !== 'string' || !missing.has(node.id)) continue;
      options.push(optionEntryFromNode(node));
    }
    c.options = options;
  } catch (err) {
    safeLog(
      'warn',
      {
        event: 'v5.graph_persist.options_reconcile_failed',
        scenario_id: ctx.scenarioId,
        turn_id: ctx.turnId,
        reason: 'merge_failed',
        error_name: errorClass(err),
      },
      '[commit] node↔options[] reconcile threw after cloning; persisting the pre-reconcile graph',
    );
    return graph;
  }

  safeLog(
    'info',
    {
      event: 'v5.graph_persist.options_reconciled',
      scenario_id: ctx.scenarioId,
      turn_id: ctx.turnId,
      ...(ctx.turnClass !== undefined ? { turn_class: ctx.turnClass } : {}),
      ...(ctx.source !== undefined && ctx.source !== null ? { source: ctx.source } : {}),
      mirrored_count: missingIds.length,
      node_ids: missingIds,
    },
    '[commit] mirrored option-nodes into top-level options[] (node↔options[] consistency)',
  );
  return clone;
}
