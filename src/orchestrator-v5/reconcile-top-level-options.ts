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
 * Decision ③ — RULED (Paul, 2026-07-22 23:35Z, evidence-based): **write-both
 * NARROWLY — update-if-present at option-mutating commits only, NEVER invent the
 * field.** The reader-manifest sweep found live CEE readers of top-level
 * `options[]` (incl. the ContextPack projection preferring `options[]`), so the
 * two views must agree; but a graph that carries NO `options[]` array must not
 * suddenly grow one on an unrelated commit (that collides with the tested
 * "commit does not invent graph fields" invariant). Retiring `options[]` was
 * rejected — it would touch every PLoT/ISL analysis consumer.
 *
 * STATUS — WIRED (decision ③ ruled 22 Jul 2026). `commitDirectAnswer` calls this
 * at the single persist chokepoint (`store.append`'s only caller), AFTER
 * `normaliseOptionInterventionContract` and before the write, so every
 * option-mutating commit (add-option held-confirm, edit_graph apply) reconciles
 * top-level `options[]` while the update-if-present guard keeps the "commit does
 * not invent graph fields" invariant green. The wiring is pinned by
 * `commit-options-reconcile-wiring.test.ts` (call-site deletion → RED).
 *
 * SCOPE — additive + PROPAGATING + idempotent + UPDATE-IF-PRESENT. When (and
 * only when) a top-level `options[]` ARRAY is already present, this pass:
 *   (1) APPENDS a canonical OptionV3 entry — DERIVED from the node (id, label,
 *       status, interventions, is_baseline) — for every option-KIND node NOT
 *       already in it; and
 *   (2) PROPAGATES the node's `interventions` into an EXISTING entry.
 * An ABSENT `options[]` (undefined) or a malformed (non-array) one is left
 * exactly as found (never invented, never clobbered). It never REMOVES an
 * entry: deletion of a removed option's entry stays owned by
 * `mergeAppliedGraphForPersistence` (the edit-path merge). An already-consistent
 * graph is a byte-identical no-op — the ORIGINAL reference is returned unchanged.
 *
 * ⭐ (2) SUPERSEDES THIS MODULE'S ORIGINAL APPEND-ONLY BEHAVIOUR — it is not a
 * new owner beside it. THE DEFECT IT CLOSES: decision ③ ruled **write-both,
 * update-if-present**; the implementation delivered only the APPEND half, so an
 * option that ALREADY had an `options[]` entry was skipped entirely. A user's
 * intervention write lands on the option NODE
 * (`encode-option-interventions.ts` → `node.interventions[fac]`), and
 * `projectSemanticAnalysisReadyFromGraph` reads TOP-LEVEL `options[]`
 * (`analysis-ready-helper.ts`), where `topLevelById.get(id)` WINS over the node
 * in BOTH branches. A stale entry therefore MASKED the user's value on the very
 * surface the analysis reads. The value was never lost — it was never
 * PROPAGATED. `computeStructuralReadiness` reads NODES and
 * `projectSemanticAnalysisReadyFromGraph` reads `options[]`, so the two
 * readiness surfaces disagreed by construction until this pass ran.
 *
 * PRECEDENCE IS PER FIELD AND PER KEY, NEVER GLOBAL — a blanket "node wins"
 * would be a new defect in the other direction. For `interventions` ONLY, and
 * only for a factor key whose NODE entry carries a USABLE numeric value, the
 * node is authoritative (it is the surface the user's write lands on). Two
 * directions are deliberately refused:
 *   - NEVER DELETE. A key present only in the existing entry is preserved.
 *     `normaliseOptionInterventionContract` PASS 1 is a CONTAINMENT sweep that
 *     can legitimately empty a node bundle WITHOUT recovering the value
 *     ("containment only — it does not recover a value lost upstream"), and by
 *     the time this pass runs a swept `{}` is indistinguishable from a bundle
 *     the user genuinely emptied. Destroying a real value is the strictly worse
 *     error, so removal stays owned by whoever can tell the two apart.
 *   - NEVER DEGRADE. A node key with no usable numeric value does not clobber a
 *     numeric value already in the entry.
 * KNOWN-DROPPED, pinned by an exact-set test: an intervention the user REMOVED
 * from the node is not un-mirrored from `options[]`. Recorded here so the suite
 * REDs if that set grows OR shrinks.
 *
 * ORDERING (once wired) — runs AFTER `normaliseOptionInterventionContract` so the
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

/** A single intervention entry carrying a usable finite numeric value. */
function usableInterventionValue(iv: unknown): boolean {
  if (typeof iv === 'number') return Number.isFinite(iv);
  if (isPlainObject(iv) && typeof iv.value === 'number') return Number.isFinite(iv.value);
  return false;
}

/**
 * Per-key union with NODE-WINS-ON-USABLE-VALUE. Never removes a key the entry
 * already has; never replaces a usable value with an unusable one. Returns the
 * merged bundle (a fresh object; callers own cloning).
 */
function mergeEntryInterventions(existing: unknown, node: unknown): Dict {
  const existingIvs = isPlainObject(existing) ? existing : {};
  const nodeIvs = isPlainObject(node) ? node : {};
  const merged: Dict = { ...existingIvs };
  for (const [key, value] of Object.entries(nodeIvs)) {
    if (usableInterventionValue(value)) {
      merged[key] = value;
    } else if (!(key in merged)) {
      // Preserve the key's presence without inventing a value.
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Key-order-INSENSITIVE structural digest, so a bundle that differs only in key
 * order is not misread as stale (which would destroy the byte-identical-no-op
 * guarantee this module promises).
 */
function stableDigest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableDigest).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableDigest(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
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

interface ReconcilePlan {
  /** Option-nodes with no `options[]` entry at all — APPEND. */
  readonly missing: string[];
  /** Option-nodes whose existing entry's interventions are stale — PROPAGATE. */
  readonly stale: string[];
}

const EMPTY_PLAN: ReconcilePlan = { missing: [], stale: [] };

/**
 * Decide what this pass must do. Read-only — computes no clone and mutates
 * nothing, so a throw here leaves the caller free to persist unchanged.
 */
function planOptionsReconcile(graph: unknown): ReconcilePlan {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return EMPTY_PLAN;
  const options = graph.options;
  // UPDATE-IF-PRESENT (decision ③ ruling): only reconcile into an EXISTING
  // top-level `options[]` array. An absent field (undefined) is left alone
  // (never invented); a present-but-malformed (non-array) one is a pre-existing
  // corruption this pass must not clobber. Either way → no-op.
  if (!Array.isArray(options)) return EMPTY_PLAN;

  const entryById = new Map<string, Dict>();
  const duplicateIds = new Set<string>();
  for (const opt of options) {
    if (!isPlainObject(opt) || typeof opt.id !== 'string') continue;
    if (entryById.has(opt.id)) duplicateIds.add(opt.id);
    else entryById.set(opt.id, opt);
  }

  const missing: string[] = [];
  const stale: string[] = [];
  for (const node of graph.nodes) {
    if (!isPlainObject(node) || node.kind !== 'option') continue;
    if (typeof node.id !== 'string') continue;
    const entry = entryById.get(node.id);
    if (entry === undefined) {
      missing.push(node.id);
      continue;
    }
    // A DUPLICATED id is an ambiguous target — propagating into it could write
    // to the wrong entry. `persisted-graph-invariants` already reports
    // DUPLICATE_OPTION_ID; this pass declines rather than guesses.
    if (duplicateIds.has(node.id)) continue;
    const merged = mergeEntryInterventions(entry.interventions, node.interventions);
    if (stableDigest(merged) !== stableDigest(entry.interventions)) stale.push(node.id);
  }
  return { missing, stale };
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

  let plan: ReconcilePlan;
  try {
    plan = planOptionsReconcile(graph);
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
  if (plan.missing.length === 0 && plan.stale.length === 0) return graph;

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
    const missing = new Set(plan.missing);
    const stale = new Set(plan.stale);
    const nodes = Array.isArray(c.nodes) ? c.nodes : [];

    // PROPAGATE into existing entries first, so the append pass below cannot
    // observe a half-updated array.
    if (stale.size > 0) {
      const entryById = new Map<string, Dict>();
      for (const opt of options) {
        if (isPlainObject(opt) && typeof opt.id === 'string' && !entryById.has(opt.id)) {
          entryById.set(opt.id, opt);
        }
      }
      for (const node of nodes) {
        if (!isPlainObject(node) || node.kind !== 'option') continue;
        if (typeof node.id !== 'string' || !stale.has(node.id)) continue;
        const entry = entryById.get(node.id);
        if (entry === undefined) continue;
        entry.interventions = mergeEntryInterventions(entry.interventions, node.interventions);
        // Status is a DERIVED mirror field. Promote only the value this module
        // itself mints, and only upwards — never downgrade, and never overwrite
        // a status vocabulary this module does not own.
        if (entry.status === 'needs_encoding' && hasNumericIntervention(entry.interventions)) {
          entry.status = 'ready';
        }
      }
    }

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
      mirrored_count: plan.missing.length,
      node_ids: plan.missing,
      propagated_count: plan.stale.length,
      propagated_node_ids: plan.stale,
    },
    '[commit] reconciled option-nodes into top-level options[] (mirrored missing + propagated interventions)',
  );
  return clone;
}
