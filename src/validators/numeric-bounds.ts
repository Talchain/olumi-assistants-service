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
 */

import { z } from 'zod';

export type NumericBoundsIssue = {
  /** Dot-joined path relative to the checked value, e.g. "edges.0.strength.mean". */
  path: string;
  /** Bound description — never echoes the offending value or any label. */
  message: string;
  /** Matches the ZodIssue code vocabulary used by boundary error `issues`. */
  code: string;
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
): void {
  if (typeof value === 'number' && Number.isFinite(value) && !predicate(value)) {
    issues.push({ path, message, code: 'custom' });
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
// Zod superRefine adapters — let existing schemas plug the same checks into
// their established failure conventions (edit repair loop / draft retry throw).
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
