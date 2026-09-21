/**
 * `edge_strength_edit` — strict inspector event → canonical D1 edge writer.
 *
 * This module is an adapter, not a second graph writer. It resolves the exact
 * persisted `(from, to)` edge, verifies the client's expected-before tuple,
 * then routes the requested signed mean and explicit direction through the
 * registered `adjust_edge_strength` validator and handler. Persistence and
 * compare-and-swap remain owned by `dispatch.ts` → `commitDirectAnswer`.
 */

import type {
  OlumiResponse,
  SystemEventTurnPayload,
} from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { isDeepStrictEqual } from 'node:util';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { log } from '../../utils/telemetry.js';
import { composeToolCallResponse } from '../compose.js';
import { composeRecoverableHandlerResponse } from '../compose/recoverable-handler-response.js';
import { composeRecoverableValidationResponse } from '../compose/recoverable-validation-response.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { buildGraphLookup } from '../routing/graph-lookup-adapter.js';
import { HANDLER_VALIDATION_REGISTRY } from '../routing/validation-registry.js';
import type { GraphLookup } from '../routing/validator.js';
import { validateToolCall } from '../routing/validator.js';
import type { ProposalAction } from '../routing/types.js';
import { HandlerInvocationFailedError } from '../tools/handler-errors.js';
import { mergeMutatedGraphForPersistence } from '../tools/handlers/d1-shared/apply-graph-mutation.js';
import { formatEdgeStrengthConfirmed } from '../tools/handlers/d1-shared/format-confirmation.js';
import {
  getDefaultRegistry,
  resolveHandler,
  type HandlerInvocation,
} from '../tools/registry.js';

type EdgeStrengthEditEvent = Extract<
  SystemEventTurnPayload['event'],
  { kind: 'edge_strength_edit' }
>;

export interface EdgeStrengthEditAuthorityConflict {
  readonly recovery_action: 'refresh_and_reconfirm';
  readonly conflict_category:
    | 'edge_target_not_found'
    | 'edge_target_ambiguous'
    | 'edge_expected_tuple_mismatch';
  readonly edge: {
    readonly from: string;
    readonly to: string;
    readonly expected: {
      readonly mean: number;
      readonly effect_direction: 'positive' | 'negative';
    };
    readonly current: {
      readonly mean: number;
      readonly std: number;
      readonly effect_direction: 'positive' | 'negative';
    } | null;
    readonly match_count: number;
  };
}

/**
 * A non-null persisted graph that fails GraphV3 is corruption, not absence.
 * Dispatch maps this throw to retryable 500/no append so the corrupt row stays
 * authoritative and no friendly "no saved model" refusal hides the defect.
 */
export class InvalidPersistedEdgeGraphError extends Error {
  constructor() {
    super('edge_strength_edit persisted graph failed GraphV3 validation');
    this.name = 'InvalidPersistedEdgeGraphError';
  }
}

export type EdgeStrengthEditResult =
  | {
      readonly kind: 'mutated';
      readonly response: OlumiResponse;
      readonly mutatedGraph: unknown;
      readonly handlerFacts: readonly HandlerFact[];
      readonly graph: GraphV3T;
      readonly baseGraph: unknown;
    }
  | {
      readonly kind: 'refused';
      readonly response: OlumiResponse;
      readonly reason: string;
      readonly authorityConflict?: EdgeStrengthEditAuthorityConflict;
    };

export interface ApplyEdgeStrengthEditParams {
  readonly payload: SystemEventTurnPayload;
  readonly event: EdgeStrengthEditEvent;
  readonly requestId: string;
  /** Raw graph from the strict server-side persisted-graph read. */
  readonly persistedGraph: unknown;
}

function refuse(
  payload: SystemEventTurnPayload,
  reason: string,
  assistantText: string,
  authorityConflict?: EdgeStrengthEditAuthorityConflict,
): EdgeStrengthEditResult {
  return {
    kind: 'refused',
    reason,
    ...(authorityConflict !== undefined ? { authorityConflict } : {}),
    response: {
      response_version: 2,
      assistant_text: assistantText,
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: payload.stage,
    },
  };
}

function authorityConflict(
  event: EdgeStrengthEditEvent,
  conflictCategory: EdgeStrengthEditAuthorityConflict['conflict_category'],
  current: EdgeStrengthEditAuthorityConflict['edge']['current'],
  matchCount: number,
): EdgeStrengthEditAuthorityConflict {
  return {
    recovery_action: 'refresh_and_reconfirm',
    conflict_category: conflictCategory,
    edge: {
      from: event.from,
      to: event.to,
      expected: {
        mean: event.expected.mean,
        effect_direction: event.expected.effect_direction,
      },
      current,
      match_count: matchCount,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rawExactEdge(
  graph: unknown,
  from: string,
  to: string,
): Record<string, unknown> | null {
  if (!isRecord(graph) || !Array.isArray(graph.edges)) return null;
  const matches = graph.edges.filter(
    (edge): edge is Record<string, unknown> =>
      isRecord(edge) && edge.from === from && edge.to === to,
  );
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Full-graph confirmation guard. The only permitted differences are the
 * target edge's `provenance.source` and `provenance_display`; every other byte
 * of persisted JSON — including cosmetic/additive fields outside the analysis
 * hash — must remain deeply equal.
 */
export function isProvenanceOnlyEdgeConfirmation(args: {
  readonly before: unknown;
  readonly after: unknown;
  readonly from: string;
  readonly to: string;
}): boolean {
  const beforeParse = GraphV3.safeParse(args.before);
  const afterParse = GraphV3.safeParse(args.after);
  if (!beforeParse.success || !afterParse.success) return false;

  const beforeEdges = beforeParse.data.edges.filter(
    (edge) => edge.from === args.from && edge.to === args.to,
  );
  const afterEdges = afterParse.data.edges.filter(
    (edge) => edge.from === args.from && edge.to === args.to,
  );
  if (beforeEdges.length !== 1 || afterEdges.length !== 1) return false;
  const beforeEdge = beforeEdges[0]!;
  const afterEdge = afterEdges[0]!;
  if (
    !isDeepStrictEqual(beforeEdge.strength, afterEdge.strength) ||
    beforeEdge.effect_direction !== afterEdge.effect_direction ||
    afterEdge.provenance?.source !== 'user_specified' ||
    afterEdge.provenance_display !== 'user_set'
  ) {
    return false;
  }

  const normalisedAfter = structuredClone(args.after);
  const rawBeforeEdge = rawExactEdge(args.before, args.from, args.to);
  const rawAfterEdge = rawExactEdge(normalisedAfter, args.from, args.to);
  if (rawBeforeEdge === null || rawAfterEdge === null) return false;

  const beforeProvenance = rawBeforeEdge.provenance;
  const afterProvenance = rawAfterEdge.provenance;
  if (isRecord(beforeProvenance)) {
    if (!isRecord(afterProvenance)) return false;
    if ('source' in beforeProvenance) {
      afterProvenance.source = structuredClone(beforeProvenance.source);
    } else {
      delete afterProvenance.source;
    }
  } else if (isRecord(afterProvenance)) {
    delete afterProvenance.source;
    if (Object.keys(afterProvenance).length === 0) delete rawAfterEdge.provenance;
  } else if (afterProvenance !== beforeProvenance) {
    return false;
  }

  if ('provenance_display' in rawBeforeEdge) {
    rawAfterEdge.provenance_display = structuredClone(
      rawBeforeEdge.provenance_display,
    );
  } else {
    delete rawAfterEdge.provenance_display;
  }

  return isDeepStrictEqual(normalisedAfter, args.before);
}

/**
 * Verify that the target edge in the commit receipt is exactly the edge the
 * adapter projected. A unique endpoint pair on both sides is part of the
 * receipt contract; equality covers strength, direction, provenance and any
 * additive target-edge metadata rather than comparing only the analysis hash.
 */
export function isExactCommittedEdgeReadback(args: {
  readonly projected: unknown;
  readonly committed: unknown;
  readonly from: string;
  readonly to: string;
}): boolean {
  const projectedParse = GraphV3.safeParse(args.projected);
  const committedParse = GraphV3.safeParse(args.committed);
  if (!projectedParse.success || !committedParse.success) return false;
  const projectedMatches = projectedParse.data.edges.filter(
    (edge) => edge.from === args.from && edge.to === args.to,
  );
  const committedMatches = committedParse.data.edges.filter(
    (edge) => edge.from === args.from && edge.to === args.to,
  );
  return (
    projectedMatches.length === 1 &&
    committedMatches.length === 1 &&
    isDeepStrictEqual(projectedMatches[0], committedMatches[0])
  );
}

function lookupOrUndefined(graph: GraphV3T): GraphLookup | undefined {
  const built = buildGraphLookup(graph);
  return built.kind === 'ok' ? built.lookup : undefined;
}

/**
 * Resolve intent to the signed mean the canonical handler accepts.
 *
 * Direction is explicit even at zero. The trusted handler-invocation sideband
 * is load-bearing: JavaScript's numeric sign cannot distinguish positive and
 * negative direction when `magnitude === 0` after JSON persistence.
 */
export function resolveEdgeStrengthTarget(args: {
  readonly magnitude: number;
  readonly directionIntent: EdgeStrengthEditEvent['direction_intent'];
  readonly persistedDirection: 'positive' | 'negative';
}): {
  readonly mean: number;
  readonly effectDirection: 'positive' | 'negative';
} {
  const effectDirection =
    args.directionIntent === 'preserve'
      ? args.persistedDirection
      : args.directionIntent;
  return {
    // Keep canonical zero numerically unsigned. Direction is carried by the
    // trusted invocation sideband, so `-0` would add a JavaScript-only bit that
    // JSON persistence immediately erases and would make confirm-current look
    // like a numeric change in strict object comparisons.
    mean:
      args.magnitude === 0
        ? 0
        : effectDirection === 'negative'
          ? -args.magnitude
          : args.magnitude,
    effectDirection,
  };
}

export async function applyEdgeStrengthEdit(
  params: ApplyEdgeStrengthEditParams,
): Promise<EdgeStrengthEditResult> {
  const { payload, event, requestId, persistedGraph } = params;

  if (persistedGraph === null) {
    log.info(
      {
        event: 'v5.system_event.edge_strength_edit.no_persisted_graph',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'edge_strength_edit — no persisted model; refusing without a graph write',
    );
    return refuse(
      payload,
      'no_persisted_graph',
      `There's no saved model I can safely update yet, so I haven't changed anything.`,
    );
  }
  const graphParse = GraphV3.safeParse(persistedGraph);
  if (!graphParse.success) {
    log.error(
      {
        event: 'v5.system_event.edge_strength_edit.persisted_graph_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: graphParse.error.issues[0]?.path.join('.') ?? '',
      },
      'edge_strength_edit — non-null persisted graph is malformed; failing closed',
    );
    throw new InvalidPersistedEdgeGraphError();
  }
  const graph = graphParse.data;

  // The canonical edge identity is the ordered endpoint pair. Never fall back
  // to labels or a UI edge id, and never let `.find()` silently pick one of
  // duplicate persisted matches.
  const matches = graph.edges.filter(
    (edge) => edge.from === event.from && edge.to === event.to,
  );
  if (matches.length === 0) {
    return refuse(
      payload,
      'target_not_found',
      `I couldn't find that link in the current model, so I haven't changed anything. Reload the model and try again.`,
      authorityConflict(event, 'edge_target_not_found', null, 0),
    );
  }
  if (matches.length !== 1) {
    log.warn(
      {
        event: 'v5.system_event.edge_strength_edit.target_ambiguous',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        match_count: matches.length,
      },
      'edge_strength_edit — duplicate persisted endpoint pair; refusing rather than choosing a target',
    );
    return refuse(
      payload,
      'target_ambiguous',
      `I found duplicate copies of that link in the saved model, so I haven't changed either one. The model needs repairing before this edit can be applied safely.`,
      authorityConflict(event, 'edge_target_ambiguous', null, matches.length),
    );
  }
  const targetEdge = matches[0]!;

  // Optimistic expected-before guard. This is exact by contract: the event is
  // a readback assertion, not a tolerance-based scientific comparison. The
  // commit layer additionally threads the trusted full-graph base into the
  // existing atomic CAS RPC, closing the check-to-write race.
  if (
    targetEdge.strength.mean !== event.expected.mean ||
    targetEdge.effect_direction !== event.expected.effect_direction
  ) {
    log.info(
      {
        event: 'v5.system_event.edge_strength_edit.expected_mismatch',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        mean_matched: targetEdge.strength.mean === event.expected.mean,
        direction_matched:
          targetEdge.effect_direction === event.expected.effect_direction,
      },
      'edge_strength_edit — expected persisted tuple moved; refusing stale edit',
    );
    return refuse(
      payload,
      'expected_mismatch',
      `That link has changed since you opened it, so I haven't changed the model. Reload it and confirm the current strength before trying again.`,
      authorityConflict(
        event,
        'edge_expected_tuple_mismatch',
        {
          mean: targetEdge.strength.mean,
          std: targetEdge.strength.std,
          effect_direction: targetEdge.effect_direction,
        },
        1,
      ),
    );
  }

  const target = resolveEdgeStrengthTarget({
    magnitude: event.magnitude,
    directionIntent: event.direction_intent,
    persistedDirection: targetEdge.effect_direction,
  });

  // `set` and `confirm_current` are intentionally different acts. A set that
  // resolves to the already-persisted scientific tuple has changed nothing,
  // so it must not reach the handler merely to stamp human provenance. Only
  // the explicit confirmation intent grants that provenance-only write.
  if (
    event.intent === 'set' &&
    target.mean === targetEdge.strength.mean &&
    target.effectDirection === targetEdge.effect_direction
  ) {
    return refuse(
      payload,
      'set_target_unchanged',
      `That link already has exactly that strength and direction, so I haven't recorded it as your judgement. Confirm the current strength explicitly if you want to adopt the existing value.`,
    );
  }

  const proposal: ProposalAction = {
    handler_id: 'adjust_edge_strength',
    entity: {
      id: `${event.from}→${event.to}`,
      kind: 'edge',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'strength',
        value: target.mean,
        operator: 'set',
        source: 'user_explicit',
      },
    ],
    cited_context_fields: ['graph.edges'],
  };

  const lookup = lookupOrUndefined(graph);
  const validation = validateToolCall(
    proposal,
    lookup,
    HANDLER_VALIDATION_REGISTRY,
  );
  if (!validation.valid) {
    const composed = composeRecoverableValidationResponse(
      validation.error,
      {
        ...(lookup !== undefined ? { graph: lookup } : {}),
        handlerRegistry: HANDLER_VALIDATION_REGISTRY,
      },
      payload.stage,
    );
    return {
      kind: 'refused',
      reason: validation.error.code,
      response: composed.response,
    };
  }

  const handlerFn = resolveHandler(getDefaultRegistry(), 'adjust_edge_strength');
  if (!handlerFn) {
    return refuse(
      payload,
      'handler_not_registered',
      `I can't change link strengths right now, so I haven't changed anything.`,
    );
  }

  const invocation: HandlerInvocation = {
    context: {
      session_id: payload.scenario_id,
      stage: payload.stage,
      request_id: requestId,
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph,
      // forbidden-exempt: bounded shim — adjust_edge_strength reads only persistedGraph from this context; widening HandlerInvocation.payload to the payload union is a separate cross-handler train
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      stage: payload.stage,
      message: '',
      // forbidden-exempt: inert shim — adjust_edge_strength never reads invocation.payload; empty text avoids fabricating a user message
    } as unknown as HandlerInvocation['payload'],
    requestId,
    signal: new AbortController().signal,
    orientationText: '',
    proposal: validation.proposal,
    // Trusted side band, not a model-authored proposal parameter. Numeric zero
    // cannot carry direction; only this strict persisted-edge adapter may.
    edgeStrengthDirectionAuthority: target.effectDirection,
    // Preserve the exact persisted identity already matched above. The
    // canonical handler's legacy NL composite parser trims endpoint halves;
    // reparsing here would weaken the event contract's byte-exact match.
    edgeStrengthEndpointAuthority: { from: event.from, to: event.to },
    // Give the canonical handler the strict raw persisted shape. It performs
    // its own GraphV3 narrowing for mutation while its existing merge helper
    // preserves additive top-level fields; the parsed `graph` above remains
    // the read-only identity/expected guard and validation lookup.
    graphForTurn: persistedGraph,
  };

  let outcome;
  try {
    outcome = await handlerFn(invocation);
  } catch (err) {
    if (err instanceof HandlerInvocationFailedError) {
      const composed = composeRecoverableHandlerResponse(
        err,
        {
          ...(lookup !== undefined ? { graph: lookup } : {}),
          handlerRegistry: HANDLER_VALIDATION_REGISTRY,
        },
        payload.stage,
      );
      return {
        kind: 'refused',
        reason: err.cause_kind,
        response: composed.response,
      };
    }
    throw err;
  }

  if (outcome.mutated_graph == null) {
    return refuse(
      payload,
      'handler_returned_no_graph',
      `I couldn't save that change, so I haven't changed anything.`,
    );
  }

  const mergedGraph = mergeMutatedGraphForPersistence({
    mutatedGraph: outcome.mutated_graph as Record<string, unknown>,
    persistedBase: persistedGraph,
    requestId,
    scenarioId: payload.scenario_id,
  });
  // Use the existing canonical persist projection before deriving the graph
  // this adapter hands to dispatch. `commitDirectAnswer` applies the same
  // idempotent function at the write chokepoint; projecting here makes the
  // adapter's hash/freshness view describe those eventual bytes exactly.
  const projectedGraph = projectGraphForPersistence(mergedGraph, {
    scenarioId: payload.scenario_id,
    turnId: payload.turn_id,
    turnClass: 'handler',
    source: 'adjust_edge_strength',
  });
  const projectedParse = GraphV3.safeParse(projectedGraph);
  if (!projectedParse.success) {
    return refuse(
      payload,
      'merged_graph_invalid',
      `I couldn't save that change, so I haven't changed anything.`,
    );
  }

  // `confirm_current` is permission to stamp exactly two provenance fields,
  // not permission to repair, normalise or cosmetically rewrite anything else.
  // Analysis-hash equality alone is insufficient: it ignores labels and other
  // additive persisted fields whose loss would still corrupt the shared model.
  if (
    event.intent === 'confirm_current' &&
    !isProvenanceOnlyEdgeConfirmation({
      before: persistedGraph,
      after: projectedGraph,
      from: event.from,
      to: event.to,
    })
  ) {
    log.warn(
      {
        event:
          'v5.system_event.edge_strength_edit.confirmation_would_change_non_provenance_state',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'edge_strength_edit — full-graph diff exceeded the provenance allowlist; refusing confirmation',
    );
    return refuse(
      payload,
      'confirmation_would_change_non_provenance_state',
      `I couldn't confirm that link without also changing the saved model, so I haven't changed anything. Reload the model and try again.`,
    );
  }

  const response = composeToolCallResponse({
    answerKind: 'functional',
    orientation: '',
    confirmation:
      event.intent === 'confirm_current'
        ? formatEdgeStrengthConfirmed({
            fromLabel:
              graph.nodes.find((node) => node.id === event.from)?.label ?? event.from,
            toLabel:
              graph.nodes.find((node) => node.id === event.to)?.label ?? event.to,
          })
        : outcome.assistant_text,
    coaching: null,
    stage: payload.stage,
    handlerFacts: outcome.handler_facts,
  });

  return {
    kind: 'mutated',
    response,
    mutatedGraph: projectedGraph,
    handlerFacts: outcome.handler_facts,
    graph: projectedParse.data,
    baseGraph: persistedGraph,
  };
}
