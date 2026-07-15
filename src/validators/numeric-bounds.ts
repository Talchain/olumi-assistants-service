/**
 * W2E-2 — numeric-bounds enforcement for graph values at CEE ingress.
 *
 * Numeric graph fields enter CEE from three directions:
 *   (a) the UI's `graph_state` on POST /orchestrate/v2/turn
 *       (src/orchestrator-v5/boundary/request-extensions.ts), and
 *   (b) LLM tool-call output — edit_graph PatchOperation[] values
 *       (src/orchestrator/patch-validation.ts) and draft/repair graph
 *       responses (src/adapters/llm/shared-schemas.ts).
 *
 * Out-of-range values (probability 1.4, strength mean -7, Infinity) that slip
 * past these seams flow to PLoT/ISL where they corrupt analysis or crash late
 * with an opaque error. This module is the single shared source of truth for
 * the bounds those seams enforce.
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
 * DOCTRINE — PERSISTED-STATE REPAIR vs NEW-CLAIM REJECTION
 * ---------------------------------------------------------------------------
 * The two ingress paths are NOT symmetric, and treating them the same way
 * bricks real users. The first cut of this gate hard-rejected every violation
 * on both paths; because the UI re-sends its persisted canvas on EVERY turn,
 * any scenario already saved with sigma <= 0 became permanently unusable —
 * every turn 422'd with a non-actionable error. That is worse than the leak
 * the gate closes.
 *
 * Path (a) — UI `graph_state` (persisted state re-entering CEE):
 *   The user is re-sending state WE previously accepted and persisted. A
 *   violation with an unambiguous safe interpretation must be REPAIRED and
 *   recorded via telemetry, never rejected. Bricking a user's scenario is not
 *   an acceptable way to enforce a bound we failed to enforce earlier.
 *     - sigma <= 0 (`strength.std`, `observed_state.std`) means "no
 *       uncertainty stated" → REPAIR to INGRESS_SIGMA_REPAIR_FLOOR.
 *   Values that are semantically MEANINGLESS, or that cannot be safely
 *   interpreted, stay HARD REJECTS with an actionable error:
 *     - NaN / ±Infinity — no defensible reading at all.
 *     - a probability outside [0, 1], or strength.mean outside [-1, 1] — we
 *       cannot know whether 1.4 meant 1.0 or 0.14, and guessing would silently
 *       change the user's model. Rejecting names the field and the bound so
 *       the user can fix it.
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

import { INGRESS_SIGMA_REPAIR_FLOOR } from '../cee/constants.js';

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
export type GraphNumericRepairResult<T> =
  /** No un-interpretable violation. `graph` carries any repairs applied. */
  | { ok: true; graph: T; repairs: NumericBoundsRepair[] }
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
 * Numeric-bounds gate for the UI `graph_state` ingress path.
 *
 * Repairs non-positive sigma to INGRESS_SIGMA_REPAIR_FLOOR and reports each
 * repair so we can see how much invalid persisted state exists. Rejects
 * anything with no safe interpretation (non-finite, out-of-range probability
 * or strength.mean).
 *
 * A rejection takes precedence over a repair: if a graph carries both, the
 * turn cannot proceed anyway, and reporting the (silently repairable) sigma
 * alongside a real error would only make the message less actionable.
 *
 * Non-mutating, and a clean graph is returned by reference — valid input
 * round-trips byte-identically.
 */
export function repairGraphNumericBounds<T>(graph: T): GraphNumericRepairResult<T> {
  const issues = checkGraphNumericBounds(graph);
  if (issues.length === 0) return { ok: true, graph, repairs: [] };

  const rejects = issues.filter((i) => i.kind !== 'sigma_non_positive');
  if (rejects.length > 0) return { ok: false, issues: rejects };

  let repaired = graph;
  const repairs: NumericBoundsRepair[] = [];
  for (const issue of issues) {
    repaired = setAtPath(repaired, issue.path.split('.'), INGRESS_SIGMA_REPAIR_FLOOR) as T;
    repairs.push({
      path: issue.path,
      kind: 'sigma_non_positive',
      repaired_to: INGRESS_SIGMA_REPAIR_FLOOR,
    });
  }
  return { ok: true, graph: repaired, repairs };
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
