/**
 * Select the single graph snapshot that may shape AI reasoning for a turn.
 *
 * This is deliberately narrower than `graphStateForTurn`: request-first state
 * remains available to validation, mutation dispatch and commit. ContextPack
 * consumers, however, must never mix persisted and in-flight graph authority.
 */

import type { CanonicalGraphReadState } from '../build-turn-context.js';
import {
  GraphStateIngressSchema,
  type GraphStateIngress,
} from '../boundary/request-extensions.js';
import { assertIngressGraphNumericBounds } from '../../validators/numeric-bounds.js';

export const GRAPH_CONTEXT_STATUSES = [
  'canonical',
  'provisional',
  'absent',
  'unavailable',
] as const;

export type GraphContextStatus = (typeof GRAPH_CONTEXT_STATUSES)[number];

/** The only graph-authority metadata permitted to reach the model. */
export interface ContextPackGraphContext {
  readonly status: GraphContextStatus;
}

export type ContextGraphSelectionReason =
  | 'persisted_valid'
  | 'persisted_absent_request_valid'
  | 'persisted_absent_no_request'
  | 'persisted_absent_request_empty'
  | 'persisted_absent_request_invalid_shape'
  | 'persisted_absent_request_invalid_numeric'
  | 'canonical_read_degraded'
  | 'canonical_read_state_missing'
  | 'persisted_invalid_shape'
  | 'persisted_invalid_numeric';

export type ContextGraphSelection =
  | {
      readonly status: 'canonical';
      readonly graph: GraphStateIngress;
      readonly reason: 'persisted_valid';
    }
  | {
      readonly status: 'provisional';
      readonly graph: GraphStateIngress;
      readonly reason: 'persisted_absent_request_valid';
    }
  | {
      readonly status: 'absent';
      readonly graph: null;
      readonly reason:
        | 'persisted_absent_no_request'
        | 'persisted_absent_request_empty'
        | 'persisted_absent_request_invalid_shape'
        | 'persisted_absent_request_invalid_numeric';
    }
  | {
      readonly status: 'unavailable';
      readonly graph: null;
      readonly reason:
        | 'canonical_read_degraded'
        | 'canonical_read_state_missing'
        | 'persisted_invalid_shape'
        | 'persisted_invalid_numeric';
    };

// Runtime provenance for the exact selector result. `ContextGraphSelection`
// remains a plain structural type for ergonomic consumers, so a caller could
// otherwise hand-build `{status:'canonical', ...}` and pass request bytes off
// as selected persisted state. Only this module can mint membership.
//
// The attested object and its graph are deeply frozen before membership is
// minted. A serialised fingerprint is not an authority boundary: callers can
// install `toJSON` and make mutable bytes stringify as their earlier value.
// Exact identity plus immutability closes both clone and post-selection
// mutation paths without freezing the separate request-first graph used by
// validation, mutation dispatch, or commit.
const SELECTED_CONTEXT_GRAPH_SNAPSHOTS = new WeakSet<object>();

function deepFreezeContextSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreezeContextSnapshot(nested, seen);
  }
  return Object.freeze(value);
}

function attestSelection(selection: ContextGraphSelection): ContextGraphSelection {
  // Zod clones its declared containers but `.passthrough()` values can retain
  // references to nested objects on the canonical/request graph. Detach the
  // entire JSON-shaped reasoning snapshot before freezing it so this read-only
  // authority marker cannot freeze bytes still used by validation, mutation,
  // or commit. `structuredClone` also ignores user-defined `toJSON` methods.
  const immutable = deepFreezeContextSnapshot(
    structuredClone(selection) as ContextGraphSelection,
  );
  SELECTED_CONTEXT_GRAPH_SNAPSHOTS.add(immutable);
  return immutable;
}

/** True only for the exact object returned by `selectContextGraphSnapshot`. */
export function isSelectedContextGraphSnapshot(
  value: unknown,
): value is ContextGraphSelection {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.isFrozen(value) &&
    SELECTED_CONTEXT_GRAPH_SNAPSHOTS.has(value)
  );
}

type ValidatedGraph =
  | { readonly ok: true; readonly graph: GraphStateIngress }
  | { readonly ok: false; readonly failure: 'invalid_shape' | 'invalid_numeric' };

function validateGraph(value: unknown): ValidatedGraph {
  const parsed = GraphStateIngressSchema.safeParse(value);
  if (!parsed.success) return { ok: false, failure: 'invalid_shape' };
  const bounded = assertIngressGraphNumericBounds(parsed.data);
  if (!bounded.ok) return { ok: false, failure: 'invalid_numeric' };
  return { ok: true, graph: bounded.graph };
}

/**
 * Four-state ContextPack graph selector.
 *
 * Absence of a canonical read state is intentionally `unavailable`: legacy
 * omission is not permission to promote caller bytes. Only an explicit
 * `ok_absent` read can license a validated, non-empty first-touch graph as
 * provisional reasoning context.
 */
export function selectContextGraphSnapshot(input: {
  readonly canonicalRead: CanonicalGraphReadState | undefined;
  readonly requestGraph: unknown | null | undefined;
}): ContextGraphSelection {
  const { canonicalRead, requestGraph } = input;

  if (canonicalRead === undefined) {
    return attestSelection({
      status: 'unavailable',
      graph: null,
      reason: 'canonical_read_state_missing',
    });
  }

  if (canonicalRead.status === 'degraded') {
    return attestSelection({
      status: 'unavailable',
      graph: null,
      reason: 'canonical_read_degraded',
    });
  }

  if (canonicalRead.status === 'ok_present') {
    const persisted = validateGraph(canonicalRead.graph);
    if (!persisted.ok) {
      return attestSelection({
        status: 'unavailable',
        graph: null,
        reason:
          persisted.failure === 'invalid_shape'
            ? 'persisted_invalid_shape'
            : 'persisted_invalid_numeric',
      });
    }
    return attestSelection({
      status: 'canonical',
      graph: persisted.graph,
      reason: 'persisted_valid',
    });
  }

  if (requestGraph === null || requestGraph === undefined) {
    return attestSelection({
      status: 'absent',
      graph: null,
      reason: 'persisted_absent_no_request',
    });
  }

  const request = validateGraph(requestGraph);
  if (!request.ok) {
    return attestSelection({
      status: 'absent',
      graph: null,
      reason:
        request.failure === 'invalid_shape'
          ? 'persisted_absent_request_invalid_shape'
          : 'persisted_absent_request_invalid_numeric',
    });
  }
  if (request.graph.nodes.length === 0) {
    return attestSelection({
      status: 'absent',
      graph: null,
      reason: 'persisted_absent_request_empty',
    });
  }

  return attestSelection({
    status: 'provisional',
    graph: request.graph,
    reason: 'persisted_absent_request_valid',
  });
}
