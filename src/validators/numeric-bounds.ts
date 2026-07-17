/**
 * W2E-2 — numeric-bounds enforcement for graph values crossing CEE.
 *
 * Numeric graph fields enter CEE from two directions:
 *   (a) the UI's `graph_state` on POST /orchestrate/v2/turn
 *       (src/orchestrator-v5/boundary/request-extensions.ts), and
 *   (b) LLM tool-call output — edit_graph PatchOperation[] values
 *       (src/orchestrator/patch-validation.ts), draft/repair graph responses
 *       (src/adapters/llm/shared-schemas.ts), and V5 proposal parameters
 *       (src/orchestrator-v5/routing/validation-registry.ts).
 * and they cross into the compute projection at one point:
 *   (a′) the persisted-graph load for run_analysis
 *        (`loadScenarioSnapshotForRunAnalysis`, build-turn-context.ts) —
 *        BEFORE its `GraphV3.safeParse`, which rejects `std <= 0` and would
 *        otherwise fail the turn first. (Round 3 placed the floor in
 *        `PLoTClient.run`; that seam sits AFTER the parse on the only live
 *        call chain, so the floor there was dead code.)
 *
 * Out-of-range values (probability 1.4, strength mean -7, Infinity) that slip
 * past these seams flow to PLoT/ISL where they corrupt analysis or crash late
 * with an opaque error. This module is the single shared source of truth for
 * the bounds those seams enforce — and, per the doctrine below, for WHERE each
 * violation class is handled. Enforcement is deliberately NOT all at ingress.
 *
 * The ranges MATCH the vendored @talchain/schemas pin (0.16.0, dist/graph.js)
 * exactly — nothing stricter is invented:
 *   - edge `exists_probability`        ∈ [0, 1]   (z.number().min(0).max(1))
 *   - edge `strength.mean`             ∈ [-1, 1]  (StrengthSchema)
 *   - edge `strength.std`              > 0        (z.number().positive())
 *   - node `observed_state.std`        > 0        (ObservedStateSchema)
 * Where the contract is silent (observed_state.value, goal_threshold,
 * intercept, prior ranges, legacy weight/belief_exists, …) only FINITENESS is
 * enforced: every number must be finite — NaN and ±Infinity are rejected,
 * never clamped or silently dropped.
 *
 * PII invariant: issue messages reference the field path and the violated
 * bound only — never the offending value and never node/factor labels.
 *
 * ---------------------------------------------------------------------------
 * DOCTRINE — WHERE A VIOLATION IS HANDLED (three constraints, in priority order)
 * ---------------------------------------------------------------------------
 *   (1) never brick a persisted scenario;
 *   (2) never silently fork graph identity / desync hash tokens;
 *   (3) never let a meaningless value (NaN/±Infinity) or an un-interpretable
 *       one (probability outside [0,1]) reach computation.
 *
 * This gate has been wrong twice, in opposite directions. Both cuts are
 * recorded here because each failure mode is easy to reintroduce.
 *
 * Cut 1 — REJECT EVERYTHING AT INGRESS. Violated (1). The UI re-sends its
 * persisted canvas on EVERY turn, so a scenario already saved with sigma <= 0
 * became permanently unusable: every turn 422'd with a non-actionable error.
 *
 * Cut 2 — REPAIR SIGMA AT INGRESS. Violated (2), and did so SILENTLY, which is
 * worse than the bug it fixed. `strength.std` is part of the analysis-affecting
 * hash projection (context/graph-hash.ts `projectEdge`), so rewriting it at
 * ingress makes the repaired WIRE graph hash differently from the UNREPAIRED
 * PERSISTED graph. Every hash token is minted off the persisted graph, and the
 * repair was wired at exactly ONE of the ~9 GraphStateIngressSchema parse sites
 * (request-extensions.ts) — the mint sites (turn-executor.ts:1094/:1265,
 * build-turn-context.ts:547, tools/handlers/run-analysis.ts:418,
 * handlers/chip-click-dispatch.ts:793/:1334, context/graph-cas-conflict.ts:149,
 * orchestrator/route-v2.ts:1934) parse the raw graph directly and never repair.
 * Net effect on a std=0 scenario: a pending proposal minted with
 * `graph_hash = H(unrepaired)` is compared at route-v2.ts:1086 against
 * `H(repaired request graph)`, they differ, and the proposal is silently
 * dropped as `clarify_hash_mismatch`. The scenario is not bricked at the door;
 * the edit flow is bricked without a word.
 *
 * This is the same regression class the codebase already paid for once:
 * run-analysis.ts:400 records "false-stale on every explain turn (live
 * regression observed at staging build abc7d29)" and settles the invariant —
 * the ONE representation every side agrees on is the raw persisted graph as
 * stored in scenarios.graph BEFORE any parse. Ingress repair re-breaks it.
 *
 * There is no "single true ingress point" to repair at instead: the persisted
 * graph enters CEE through the request body AND through several independent
 * session-store reload paths (the mint sites above). Repairing at one of them
 * forks; repairing at all of them means every consumer must agree to rewrite
 * identically forever, and the abc7d29 precedent is that they do not.
 *
 * Cut 3 — CURRENT. Split by WHERE the value does harm, not by which door it
 * came through:
 *
 * Path (a) — UI `graph_state` ingress (persisted state re-entering CEE):
 *   IDENTITY IS SACRED. `assertIngressGraphNumericBounds` never rewrites the
 *   graph; it returns the caller's object by reference or rejects it.
 *     - sigma <= 0 passes THROUGH unrepaired — hash identity exactly preserved,
 *       every existing token stays valid, nothing forks. Satisfies (1) and (2).
 *     - NaN / ±Infinity, probability outside [0,1], strength.mean outside
 *       [-1,1] still HARD REJECT with an actionable error naming field + bound.
 *       These have no defensible reading (we cannot know whether 1.4 meant 1.0
 *       or 0.14, and guessing would silently change the user's model), and the
 *       UI writer does not routinely produce them — so (3) is satisfied at the
 *       door without bricking anyone.
 *
 * Path (a′) — the persisted-load boundary (loadScenarioSnapshotForRunAnalysis):
 *   Where the persisted graph crosses into the compute projection,
 *   `floorGraphSigmaForCompute` floors sigma to COMPUTE_SIGMA_FLOOR and meters
 *   it — BEFORE the `GraphV3.safeParse` there (`std: z.number().positive()`),
 *   which would otherwise reject the graph and fail the turn first. This
 *   satisfies (3) for the one class that survives ingress, without ever
 *   touching the graph the hash is minted from (`rawPersistedGraph` stays
 *   unfloored). It is the same discipline as the neighbouring
 *   `guardAnalysisGraphIntercepts` ("a runtime guard, not a migration, and must
 *   not perturb freshness"), applied at the same seam. NOTE it must FLOOR and
 *   not FAIL: the live UI writer emits std=0 continuously, so failing here
 *   would break analysis for routinely-produced state — constraint (1) again,
 *   just moved downstream.
 *
 * Path (b) — LLM output (edit_graph patches, draft/repair responses):
 *   Keep rejection / repair-retry as built. The model can simply be asked
 *   again, and there is no user state to brick.
 *
 * Which sigma reaches path (a) is not hypothetical — the UI's own writer
 * produces it. DecisionGuideAI `useConversation.ts` (buildRequest) floors
 * outbound std with `Math.max(0, strengthStd)` — a floor of ZERO, not >0 —
 * and `applyDraftResult.ts` stores `strength.std` verbatim from a CEE draft
 * response. `observed_state` is forwarded with no clamp at all.
 */

import { z } from 'zod';

import { COMPUTE_SIGMA_FLOOR } from '../cee/constants.js';

export type NumericBoundsIssue = {
  /** Dot-joined path relative to the checked value, e.g. "edges.0.strength.mean". */
  path: string;
  /** Bound description — never echoes the offending value or any label. */
  message: string;
  /** Matches the ZodIssue code vocabulary used by boundary error `issues`. */
  code: string;
  /**
   * Violation class, used ONLY by the path-(a) repair split (see the doctrine
   * in the module header). `sigma_non_positive` is the one class with an
   * unambiguous safe interpretation ("no uncertainty stated"), so path (a)
   * repairs it instead of bricking the scenario. Absent = no safe reading →
   * hard reject on both paths. Path (b) rejects every class regardless.
   */
  kind?: 'sigma_non_positive';
};

const FINITE_MESSAGE = 'must be a finite number';
const PROBABILITY_MESSAGE = 'must be a number within [0, 1]';
const STRENGTH_MEAN_MESSAGE = 'must be a number within [-1, 1]';
const POSITIVE_MESSAGE = 'must be a positive number';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinPath(basePath: string, key: string): string {
  return basePath === '' ? key : `${basePath}.${key}`;
}

/**
 * Recursively collect an issue for every non-finite number (NaN / ±Infinity)
 * anywhere inside `value`. JSON bodies cannot carry NaN literals, but
 * `JSON.parse("1e999")` yields Infinity, and internal callers can inject
 * arbitrary objects — so the walk is unconditional and covers passthrough
 * fields the shape schemas never look at.
 */
export function collectNonFiniteIssues(
  value: unknown,
  basePath = '',
  issues: NumericBoundsIssue[] = [],
  seen: WeakSet<object> = new WeakSet(),
): NumericBoundsIssue[] {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      issues.push({ path: basePath, message: FINITE_MESSAGE, code: 'custom' });
    }
    return issues;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return issues;
    seen.add(value);
    for (let i = 0; i < value.length; i++) {
      collectNonFiniteIssues(value[i], joinPath(basePath, String(i)), issues, seen);
    }
    return issues;
  }
  if (isRecord(value)) {
    if (seen.has(value)) return issues;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      collectNonFiniteIssues(child, joinPath(basePath, key), issues, seen);
    }
  }
  return issues;
}

/** Range check helper — only fires on finite numbers (non-finite values are
 *  already flagged by the finiteness walk, avoiding duplicate issues). */
function checkFiniteNumber(
  value: unknown,
  path: string,
  issues: NumericBoundsIssue[],
  predicate: (n: number) => boolean,
  message: string,
  kind?: NumericBoundsIssue['kind'],
): void {
  if (typeof value === 'number' && Number.isFinite(value) && !predicate(value)) {
    issues.push({ path, message, code: 'custom', ...(kind ? { kind } : {}) });
  }
}

/**
 * Contract-declared range checks for a single edge (or a partial edge-update
 * record). Checks fields only when present as numbers — shape validation is
 * the caller's schema's job.
 */
export function collectEdgeRangeIssues(
  edge: unknown,
  basePath = '',
  issues: NumericBoundsIssue[] = [],
): NumericBoundsIssue[] {
  if (!isRecord(edge)) return issues;
  checkFiniteNumber(
    edge.exists_probability,
    joinPath(basePath, 'exists_probability'),
    issues,
    (n) => n >= 0 && n <= 1,
    PROBABILITY_MESSAGE,
  );
  if (isRecord(edge.strength)) {
    checkFiniteNumber(
      edge.strength.mean,
      joinPath(basePath, 'strength.mean'),
      issues,
      (n) => n >= -1 && n <= 1,
      STRENGTH_MEAN_MESSAGE,
    );
    checkFiniteNumber(
      edge.strength.std,
      joinPath(basePath, 'strength.std'),
      issues,
      (n) => n > 0,
      POSITIVE_MESSAGE,
      'sigma_non_positive',
    );
  }
  return issues;
}

/**
 * Contract-declared range checks for a single node (or a partial node-update
 * record). The vendored contract only bounds `observed_state.std` (positive);
 * every other node number is contract-silent → finiteness only (handled by
 * the walk, not here).
 */
export function collectNodeRangeIssues(
  node: unknown,
  basePath = '',
  issues: NumericBoundsIssue[] = [],
): NumericBoundsIssue[] {
  if (!isRecord(node)) return issues;
  if (isRecord(node.observed_state)) {
    checkFiniteNumber(
      node.observed_state.std,
      joinPath(basePath, 'observed_state.std'),
      issues,
      (n) => n > 0,
      POSITIVE_MESSAGE,
      'sigma_non_positive',
    );
  }
  return issues;
}

/**
 * Full numeric-bounds check for a graph-shaped value ({ nodes, edges, … }):
 * finiteness everywhere (including options / passthrough fields) plus the
 * contract-declared ranges on nodes and edges.
 *
 * Returns an empty array for a compliant graph. Non-mutating — valid inputs
 * pass through the caller byte-identical.
 */
export function checkGraphNumericBounds(graph: unknown): NumericBoundsIssue[] {
  const issues: NumericBoundsIssue[] = [];
  collectNonFiniteIssues(graph, '', issues);
  if (isRecord(graph)) {
    if (Array.isArray(graph.nodes)) {
      for (let i = 0; i < graph.nodes.length; i++) {
        collectNodeRangeIssues(graph.nodes[i], `nodes.${i}`, issues);
      }
    }
    if (Array.isArray(graph.edges)) {
      for (let i = 0; i < graph.edges.length; i++) {
        collectEdgeRangeIssues(graph.edges[i], `edges.${i}`, issues);
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Path (a) — UI graph_state: PERSISTED-STATE REPAIR.
// See the doctrine in the module header. This is the ONLY place that repairs;
// path (b) rejects everything via the superRefine adapters below.
// ---------------------------------------------------------------------------

/** A single applied repair. Carries the field path and the floor — never the
 *  offending value and never a label (PII rule). */
export type NumericBoundsRepair = {
  path: string;
  kind: NonNullable<NumericBoundsIssue['kind']>;
  /** The value written in place of the violation. */
  repaired_to: number;
};

/**
 * Generic in the graph type so callers keep their parsed ingress type through
 * the gate — a repaired graph is the same shape as the one that went in, and
 * the caller should not need an `as`-cast to say so.
 */
export type GraphNumericIngressResult<T> =
  /**
   * No un-interpretable violation. `graph` is the caller's own object, handed
   * back BY REFERENCE and never rewritten — ingress preserves graph identity.
   */
  | { ok: true; graph: T }
  /** At least one value with no safe reading — the caller must reject. */
  | { ok: false; issues: NumericBoundsIssue[] };

/**
 * Set `object[key] = value` along `path`, copying every container on the way
 * down (copy-on-write). The caller's input object is never mutated — a turn
 * body can be retried/logged/compared afterwards without observing our repair.
 * Key insertion order is preserved, so an unrepaired sibling field still
 * round-trips byte-identically.
 */
function setAtPath(root: unknown, path: string[], value: number): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const index = Number(head);
    const copy = root.slice();
    copy[index] = setAtPath(root[index], rest, value);
    return copy;
  }
  if (isRecord(root)) {
    return { ...root, [head]: setAtPath(root[head], rest, value) };
  }
  return root;
}

/**
 * Numeric-bounds gate for the UI `graph_state` ingress path (path a).
 *
 * IDENTITY-PRESERVING BY CONSTRUCTION. This function NEVER rewrites the graph:
 * it either rejects it or hands the very same object back by reference. That
 * is the whole point — see the "WHY INGRESS DOES NOT REPAIR" section in the
 * module header. A sigma <= 0 is deliberately allowed THROUGH here; it is
 * floored later, at the persisted-load boundary
 * (loadScenarioSnapshotForRunAnalysis), by `floorGraphSigmaForCompute`.
 *
 * Rejects only the classes with no safe reading (non-finite, out-of-range
 * probability or strength.mean), which are exactly the classes the round-3
 * ruling's constraint (3) forbids from reaching computation and which the UI
 * writer does not routinely produce — so rejecting them bricks nothing.
 */
export function assertIngressGraphNumericBounds<T>(graph: T): GraphNumericIngressResult<T> {
  const rejects = checkGraphNumericBounds(graph).filter((i) => i.kind !== 'sigma_non_positive');
  if (rejects.length > 0) return { ok: false, issues: rejects };
  return { ok: true, graph };
}

/**
 * Sigma floor for the persisted-load boundary
 * (`loadScenarioSnapshotForRunAnalysis`, build-turn-context.ts) — the point
 * where the persisted graph crosses into the compute projection, applied
 * BEFORE the `GraphV3.safeParse` there so the parse cannot reject the graph
 * this floor exists to save.
 *
 * Floors non-positive `strength.std` / `observed_state.std` to
 * COMPUTE_SIGMA_FLOOR and reports each floor so we can see how much invalid
 * persisted state exists. Everything else is left exactly as-is: by the time a
 * graph reaches compute, the no-safe-reading classes have already been
 * rejected at ingress, and this guard's job is narrow.
 *
 * Non-mutating (copy-on-write via `setAtPath`), and a clean graph is returned
 * BY REFERENCE — valid input round-trips byte-identically at zero cost. The
 * caller's graph is never touched, which is load-bearing: `graph_hash_at_run`
 * is computed from `snapshot.rawPersistedGraph` and must not observe the floor
 * (perturbing it reproduces the false-stale regression of build abc7d29).
 */
export function floorGraphSigmaForCompute<T>(graph: T): {
  graph: T;
  repairs: NumericBoundsRepair[];
} {
  const sigmaIssues = checkGraphNumericBounds(graph).filter(
    (i) => i.kind === 'sigma_non_positive',
  );
  if (sigmaIssues.length === 0) return { graph, repairs: [] };

  let floored = graph;
  const repairs: NumericBoundsRepair[] = [];
  for (const issue of sigmaIssues) {
    floored = setAtPath(floored, issue.path.split('.'), COMPUTE_SIGMA_FLOOR) as T;
    repairs.push({
      path: issue.path,
      kind: 'sigma_non_positive',
      repaired_to: COMPUTE_SIGMA_FLOOR,
    });
  }
  return { graph: floored, repairs };
}

// ---------------------------------------------------------------------------
// Zod superRefine adapters — let existing schemas plug the same checks into
// their established failure conventions (edit repair loop / draft retry throw).
//
// Path (b) ONLY. These reject every violation class, sigma included: the model
// can be asked again, and no user state is at stake. Do NOT wire the repair
// above into these.
// ---------------------------------------------------------------------------

function addIssuesToCtx(ctx: z.RefinementCtx, issues: NumericBoundsIssue[]): void {
  for (const issue of issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: issue.message,
      path: issue.path === ''
        ? []
        : issue.path.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg)),
    });
  }
}

/** superRefine: every number anywhere in the value must be finite. */
export function refineFiniteNumbers(value: unknown, ctx: z.RefinementCtx): void {
  addIssuesToCtx(ctx, collectNonFiniteIssues(value));
}

/** superRefine for edge-shaped values: finiteness + contract edge ranges. */
export function refineEdgeNumericBounds(value: unknown, ctx: z.RefinementCtx): void {
  const issues = collectNonFiniteIssues(value);
  collectEdgeRangeIssues(value, '', issues);
  addIssuesToCtx(ctx, issues);
}

/** superRefine for node-shaped values: finiteness + contract node ranges. */
export function refineNodeNumericBounds(value: unknown, ctx: z.RefinementCtx): void {
  const issues = collectNonFiniteIssues(value);
  collectNodeRangeIssues(value, '', issues);
  addIssuesToCtx(ctx, issues);
}
