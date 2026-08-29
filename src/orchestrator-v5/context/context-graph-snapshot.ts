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
    return {
      status: 'unavailable',
      graph: null,
      reason: 'canonical_read_state_missing',
    };
  }

  if (canonicalRead.status === 'degraded') {
    return {
      status: 'unavailable',
      graph: null,
      reason: 'canonical_read_degraded',
    };
  }

  if (canonicalRead.status === 'ok_present') {
    const persisted = validateGraph(canonicalRead.graph);
    if (!persisted.ok) {
      return {
        status: 'unavailable',
        graph: null,
        reason:
          persisted.failure === 'invalid_shape'
            ? 'persisted_invalid_shape'
            : 'persisted_invalid_numeric',
      };
    }
    return { status: 'canonical', graph: persisted.graph, reason: 'persisted_valid' };
  }

  if (requestGraph === null || requestGraph === undefined) {
    return {
      status: 'absent',
      graph: null,
      reason: 'persisted_absent_no_request',
    };
  }

  const request = validateGraph(requestGraph);
  if (!request.ok) {
    return {
      status: 'absent',
      graph: null,
      reason:
        request.failure === 'invalid_shape'
          ? 'persisted_absent_request_invalid_shape'
          : 'persisted_absent_request_invalid_numeric',
    };
  }
  if (request.graph.nodes.length === 0) {
    return {
      status: 'absent',
      graph: null,
      reason: 'persisted_absent_request_empty',
    };
  }

  return {
    status: 'provisional',
    graph: request.graph,
    reason: 'persisted_absent_request_valid',
  };
}
