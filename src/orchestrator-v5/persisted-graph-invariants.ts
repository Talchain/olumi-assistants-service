/**
 * GRAPH-EDIT-TRANSACTION step 1 — THE TERMINAL INVARIANT CHECK.
 *
 * THE GAP THIS CLOSES. Before this module there was no single post-mutation
 * invariant check anywhere in CEE. On the edit lane the only structural check
 * (`validateGraphStructure`, `edit-graph.ts:2582`) runs BEFORE the option
 * encode, the persistence merge and the three commit-site passes; between
 * `reconcileTopLevelOptionsFromNodes` and `store.append` there was no
 * validation of ANY kind — not structural, not schema. Everything that
 * validated, validated something other than what we stored.
 *
 * This module is the sole terminal authority. It is called from
 * `commitDirectAnswer` immediately before `store.append` — the SINGLE
 * `scenarios.graph` writer in `src/` — so it covers EVERY lane (edit, draft,
 * chip-click, clarify, system-event, route-v2 add-option) by construction
 * rather than by a hand-listed set of call sites that could drift (trap #12).
 *
 * DERIVED, NEVER MIRRORED. The analysis hash is not re-implemented and no list
 * of hash-projected fields is copied here: `computeAnalysisAffectingGraphHash`
 * is CALLED on the persisted bytes. If that projection gains or loses a field,
 * this module follows automatically — there is nothing to keep in sync.
 *
 * FAIL-CLOSED ON THE DELTA, NEVER A SILENT REPAIR. A violation THIS TURN
 * INTRODUCED throws `PersistedGraphInvariantError`; the commit does not happen.
 * A violation the graph ALREADY CARRIED is absorbed and logged, never refused —
 * an absolute gate here would make every legacy, migration-era or
 * `buildStructuralFallback` scenario permanently uneditable, which is the
 * failure the estate already decided against twice
 * (`edit-graph.ts:2587-2595` implements the same count-based absorption;
 * `:2750-2755` records the reason). This module NEVER mutates the graph:
 * repairing here would recreate the very defect it exists to detect (a repair
 * after the hash was computed diverges the hash again).
 *
 * SCOPE — ENFORCED ON THE DELTA (deliberately narrow; each means the graph
 * cannot be processed at all, and none fires anywhere in the 21,392-test suite
 * — the evidence that they hold on every path the estate models):
 *   - EDGE_ENDPOINT_MISSING  referential integrity of `edges[]`
 *   - DUPLICATE_NODE_ID      node id uniqueness
 *   - DUPLICATE_OPTION_ID    top-level `options[]` id uniqueness
 *
 * SCOPE — OBSERVED, NOT ENFORCED (reported and logged; never refuses):
 *   - GOAL_NODE_ID_UNRESOLVED. Demoted on evidence, not caution: `goal_node_id`
 *     is OPTIONAL on the persisted graph and is not the authoritative goal
 *     oracle (`readiness.goal_node_id` is, derived independently), and three
 *     existing commit specs persist graphs that violate it.
 *   - OPTION_NODE_MISSING_FROM_OPTIONS. The pass that maintains it
 *     (`reconcileTopLevelOptionsFromNodes`, the line before this check) is
 *     FAIL-OPEN and declares its own incompleteness at `commit.ts:958-962`.
 *     Refusing here would convert a documented soft degradation into a
 *     whole-turn `STATE_COMMIT_FAILED` (`turn-executor.ts:8859`).
 *
 * SCOPE — WHAT IS **NOT** CHECKED AT ALL (stated so no absence claim is read
 * wider than the evidence):
 *   - REACHABILITY / `NO_PATH_TO_GOAL`. Orphaned factors demonstrably survive
 *     to persistence on the draft lane today (`applyComplexityCap` /
 *     `fixDisconnectedObservables` re-orphan what the connectivity repairs just
 *     wired). Fail-closing on it here would refuse live traffic that the system
 *     currently produces. It belongs to the phase-ordering step, where the
 *     violation is caught at PLAN time and becomes a recoverable outcome.
 *   - GraphV3 SCHEMA conformance. `CommitMetadata.graph` is `unknown` by
 *     contract and several live paths persist a superset of `GraphV3`.
 *   - SEMANTIC plausibility of values (magnitudes, distributions, encodings).
 *
 * A graph whose top-level shape is not `{ nodes: [], edges: [] }` reports
 * `status: 'unshaped'`: the structural invariants are undefined for it, so it
 * is reported honestly rather than passed off as checked. `unshaped` does NOT
 * refuse — `metadata.graph` is `unknown` by contract, and refusing a shape the
 * commit contract permits would be a new failure mode, not a closed one.
 */
import { computeAnalysisAffectingGraphHash } from './context/graph-hash.js';
import type { GraphStateIngress } from './boundary/request-extensions.js';

/** Codes that REFUSE the commit. Each means the graph cannot be processed at all. */
export type PersistedGraphInvariantCode =
  | 'EDGE_ENDPOINT_MISSING'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_OPTION_ID';

/**
 * Codes that are REPORTED but do NOT refuse. Kept separate on purpose: the
 * fail-closed set may only contain invariants demonstrated to hold on real
 * traffic, and refusing a live turn on an unproven one would be a new failure
 * mode rather than a closed one.
 */
export type PersistedGraphObservationCode =
  | 'GOAL_NODE_ID_UNRESOLVED'
  | 'OPTION_NODE_MISSING_FROM_OPTIONS';

/**
 * A single violation. Carries IDs and counts ONLY — never labels, values,
 * magnitudes or any other graph content (persist-site redaction doctrine).
 */
export interface PersistedGraphInvariantViolation {
  readonly code: PersistedGraphInvariantCode | PersistedGraphObservationCode;
  /** The offending entity ids, sorted and capped. Never values or labels. */
  readonly entity_ids: readonly string[];
  /** Total offending entities, even when `entity_ids` was capped. */
  readonly count: number;
}

export interface PersistedGraphInvariantReport {
  /**
   * `ok`        — the structural invariants were evaluated and all hold.
   * `violated`  — at least one invariant failed; the commit must refuse.
   * `unshaped`  — the graph has no `{nodes:[],edges:[]}` shape, so the
   *               structural invariants are undefined for it. NOT a pass.
   */
  readonly status: 'ok' | 'violated' | 'unshaped';
  /**
   * Fatal — and DELTA-SCOPED: only violations this turn INTRODUCED relative to
   * `baseGraph`. Non-empty ⟹ `status === 'violated'` ⟹ the commit refuses.
   * Empty whenever no `baseGraph` was supplied (no baseline ⟹ no delta ⟹ no
   * refusal), so a missing baseline can never brick a scenario.
   */
  readonly violations: readonly PersistedGraphInvariantViolation[];
  /**
   * Violations present in the graph BEFORE this turn, absorbed by the baseline
   * and therefore never refused. Reported so an inherited corruption stays
   * visible rather than silently tolerated.
   */
  readonly inheritedViolations: readonly PersistedGraphInvariantViolation[];
  /**
   * Non-fatal findings, logged but never refused. Populating this does NOT
   * change `status`, so a graph with observations still commits.
   */
  readonly observations: readonly PersistedGraphInvariantViolation[];
  /**
   * The analysis hash RECOMPUTED on the bytes handed to this check — i.e. on
   * what is actually about to be persisted, after every mutating pass. This is
   * the value the turn must advertise; anything computed earlier describes a
   * graph we did not store. `null` when the graph is absent/empty/unhashable.
   */
  readonly analysisGraphHash: string | null;
}

/** Cap on ids carried in a violation, so a pathological graph cannot flood logs. */
const MAX_REPORTED_IDS = 20;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function violation(
  code: PersistedGraphInvariantCode | PersistedGraphObservationCode,
  ids: readonly string[],
): PersistedGraphInvariantViolation {
  const sorted = [...ids].sort();
  return {
    code,
    entity_ids: sorted.slice(0, MAX_REPORTED_IDS),
    count: sorted.length,
  };
}

export interface PersistedGraphInvariantOptions {
  /**
   * The graph as it stood BEFORE this turn. Violations already present in it
   * are ABSORBED and never refused — only what this transaction INTRODUCED can
   * fail the commit.
   *
   * Omit it and the check becomes observe-only: with no baseline there is no
   * way to tell an introduced violation from an inherited one, and refusing on
   * that guess is exactly how a legacy graph becomes permanently uneditable.
   */
  readonly baseGraph?: unknown;
}

/** Raw structural findings for one graph, before any baseline comparison. */
function rawViolations(graph: unknown): PersistedGraphInvariantViolation[] {
  const report = evaluate(graph);
  return report === null ? [] : report.fatal;
}

/**
 * Evaluate the terminal invariants on the graph AS IT WILL BE PERSISTED, and
 * recompute its analysis hash. Pure and total: never mutates its input, never
 * throws.
 *
 * DELTA, NOT ABSOLUTE. The fatal set is the multiset DIFFERENCE against
 * `options.baseGraph`, mirroring the edit lane's own gate
 * (`edit-graph.ts:2587-2595`, live on staging with
 * `CEE_PATCH_PRE_VALIDATION_ENABLED=true`): count-based per code, so a SECOND
 * instance of a code the base already had is still caught, while the inherited
 * instance is absorbed. The estate wrote down why at `edit-graph.ts:2750-2755`
 * — a strict refusal on an already-invalid base *"would make the scenario
 * permanently uneditable"*. An absolute check at the commit chokepoint is that
 * refusal for EVERY lane at once, so it must not be absolute.
 */
export function checkPersistedGraphInvariants(
  graph: unknown,
  options: PersistedGraphInvariantOptions = {},
): PersistedGraphInvariantReport {
  // The analysis hash is DERIVED by calling the real projection — never
  // re-implemented here. Guarded because the projection indexes `nodes`/`edges`
  // and would throw on an unshaped graph; a hash failure must not become a
  // commit failure on its own (it is reported as `null`).
  let analysisGraphHash: string | null = null;
  try {
    analysisGraphHash = computeAnalysisAffectingGraphHash(
      graph as GraphStateIngress | null | undefined,
    );
  } catch {
    analysisGraphHash = null;
  }

  const evaluated = evaluate(graph);
  if (evaluated === null) {
    return {
      status: 'unshaped',
      violations: [],
      inheritedViolations: [],
      observations: [],
      analysisGraphHash,
    };
  }

  // Absorb what the base graph already violated (count-based per code, exactly
  // as `edit-graph.ts:2587-2595` does it). No baseline ⟹ EVERYTHING is treated
  // as inherited ⟹ observe-only, never a refusal.
  const introduced: PersistedGraphInvariantViolation[] = [];
  const inherited: PersistedGraphInvariantViolation[] = [];
  if (options.baseGraph === undefined) {
    inherited.push(...evaluated.fatal);
  } else {
    const baselineCounts = new Map<string, number>();
    for (const v of rawViolations(options.baseGraph)) {
      baselineCounts.set(v.code, (baselineCounts.get(v.code) ?? 0) + v.count);
    }
    for (const v of evaluated.fatal) {
      const absorbed = Math.min(v.count, baselineCounts.get(v.code) ?? 0);
      baselineCounts.set(v.code, (baselineCounts.get(v.code) ?? 0) - absorbed);
      if (absorbed > 0) inherited.push({ ...v, count: absorbed });
      if (v.count > absorbed) {
        introduced.push({ ...v, count: v.count - absorbed });
      }
    }
  }

  return {
    status: introduced.length > 0 ? 'violated' : 'ok',
    violations: introduced,
    inheritedViolations: inherited,
    observations: evaluated.observations,
    analysisGraphHash,
  };
}

/**
 * Structural evaluation of ONE graph. Returns `null` when the graph has no
 * `{nodes:[],edges:[]}` shape (the invariants are undefined for it).
 */
function evaluate(graph: unknown): {
  fatal: PersistedGraphInvariantViolation[];
  observations: PersistedGraphInvariantViolation[];
} | null {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return null;
  }

  const violations: PersistedGraphInvariantViolation[] = [];
  const observations: PersistedGraphInvariantViolation[] = [];
  const nodes = graph.nodes;
  const edges = graph.edges;

  // ── node id uniqueness ────────────────────────────────────────────────────
  const nodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();
  for (const node of nodes) {
    if (!isPlainObject(node) || typeof node.id !== 'string') continue;
    if (nodeIds.has(node.id)) duplicateNodeIds.add(node.id);
    nodeIds.add(node.id);
  }
  if (duplicateNodeIds.size > 0) {
    violations.push(violation('DUPLICATE_NODE_ID', [...duplicateNodeIds]));
  }

  // ── referential integrity of edges ────────────────────────────────────────
  // An edge endpoint naming a node that does not exist is unrecoverable
  // corruption: PLoT/ISL cannot build the DAG, and no repair pass owns it.
  const danglingEndpoints = new Set<string>();
  for (const edge of edges) {
    if (!isPlainObject(edge)) continue;
    for (const side of ['from', 'to'] as const) {
      const ref = edge[side];
      if (typeof ref !== 'string') continue;
      if (!nodeIds.has(ref)) danglingEndpoints.add(ref);
    }
  }
  if (danglingEndpoints.size > 0) {
    violations.push(violation('EDGE_ENDPOINT_MISSING', [...danglingEndpoints]));
  }

  // ── goal_node_id resolves — OBSERVED, NOT ENFORCED ────────────────────────
  // Deliberately non-fatal, on evidence. `goal_node_id` is OPTIONAL on the
  // persisted/ingress graph (`boundary/request-extensions.ts:91`,
  // `schemas/cee-v3.ts:562`) and it is NOT the authoritative goal oracle for
  // analysis — that is `readiness.goal_node_id`, derived independently
  // (`build-turn-context.ts:1360`, `analysis-ready-core.ts:253`,
  // `canonical-analysis-state.ts:456`). Three existing commit specs persist a
  // graph whose `goal_node_id` names no node, so refusing on it would fail
  // closed on shapes the estate demonstrably produces. Reported so the
  // divergence is visible; enforcement belongs with the oracle collapse in the
  // phase-ordering step, where there is one goal authority to enforce against.
  const goalNodeId = graph.goal_node_id;
  if (typeof goalNodeId === 'string' && goalNodeId.length > 0 && !nodeIds.has(goalNodeId)) {
    observations.push(violation('GOAL_NODE_ID_UNRESOLVED', [goalNodeId]));
  }

  // ── top-level options[] ───────────────────────────────────────────────────
  // UPDATE-IF-PRESENT (decision ③): an ABSENT or non-array `options[]` is left
  // alone by `reconcileTopLevelOptionsFromNodes` and must not be asserted here
  // either — asserting it would demand a field the commit is forbidden to
  // invent. When it IS an array, these are that pass's post-conditions.
  const options = graph.options;
  if (Array.isArray(options)) {
    const optionIds = new Set<string>();
    const duplicateOptionIds = new Set<string>();
    for (const opt of options) {
      if (!isPlainObject(opt) || typeof opt.id !== 'string') continue;
      if (optionIds.has(opt.id)) duplicateOptionIds.add(opt.id);
      optionIds.add(opt.id);
    }
    if (duplicateOptionIds.size > 0) {
      violations.push(violation('DUPLICATE_OPTION_ID', [...duplicateOptionIds]));
    }

    const unmirrored: string[] = [];
    for (const node of nodes) {
      if (!isPlainObject(node) || node.kind !== 'option') continue;
      if (typeof node.id !== 'string') continue;
      if (!optionIds.has(node.id)) unmirrored.push(node.id);
    }
    if (unmirrored.length > 0) {
      // OBSERVE-ONLY, deliberately. `reconcileTopLevelOptionsFromNodes` — the
      // pass on the line before this check — is FAIL-OPEN (a detect/clone/merge
      // throw returns the graph unchanged) and declares its own incompleteness
      // at `commit.ts:958-962`. Refusing here would convert that documented
      // soft degradation into a whole-turn STATE_COMMIT_FAILED.
      observations.push(violation('OPTION_NODE_MISSING_FROM_OPTIONS', unmirrored));
    }
  }

  return { fatal: violations, observations };
}

/**
 * Thrown by `commitDirectAnswer` when the terminal check fails. Carries the
 * violation list so the refusal names what was wrong rather than asserting a
 * generic failure — an honest refusal, not a silent repair.
 */
export class PersistedGraphInvariantError extends Error {
  readonly violations: readonly PersistedGraphInvariantViolation[];

  constructor(violations: readonly PersistedGraphInvariantViolation[]) {
    super(
      'commit refused: the graph about to be persisted violates the terminal invariants — ' +
        formatViolations(violations),
    );
    this.name = 'PersistedGraphInvariantError';
    this.violations = violations;
  }
}

/** Redacted one-line rendering: codes, counts and ids only. */
export function formatViolations(
  violations: readonly PersistedGraphInvariantViolation[],
): string {
  if (violations.length === 0) return 'none';
  return violations
    .map((v) => `${v.code}(n=${v.count}: ${v.entity_ids.join(',')})`)
    .join('; ');
}
