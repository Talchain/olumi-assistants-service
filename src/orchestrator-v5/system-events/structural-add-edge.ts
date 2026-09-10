/**
 * `structural_add_edge` (schemas 0.50.0) — the DURABLE edge writer.
 *
 * THE DEFECT THIS CLOSES. `SYSTEM_EVENT_HANDLING` declared this kind
 * `'reader_only_refusal'` because CEE could parse the event and had no writer
 * for it. The comment beside its `structural_add` sibling states the rule this
 * file discharges: *"`'reader_only_refusal'` was honest while CEE had no
 * writer; it becomes a lie the moment one exists."*
 *
 * ⭐⭐ ONE WRITER, FOUR USER-FACING CAPABILITIES. Draw-a-link is the obvious
 * one. The other three are gestures users ALREADY PERFORM and already believe
 * work: the five "Add connected …" affordances, duplicate, and paste. Today a
 * duplicated subgraph reaches the server as nodes with no connections, so it
 * comes back on the next reload having quietly lost its causal structure. That
 * is a silent loss, which is the class this estate keeps paying for.
 *
 * ⚠ THIS FILE CONTAINS NO MUTATION LOGIC OF ITS OWN. Like both siblings it is
 * an ADAPTER: it resolves the addition against the server's own persisted read
 * and routes it through the canonical `add_edge` PatchOperation train
 * (`applyPatchOperations`), then hands the merged graph to the commit
 * chokepoint `dispatch.ts` owns.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐⭐ WHAT THE SERVER OWNS, AND WHY IT IS NOT AN INVENTED NUMBER.
 *
 * The wire member carries `from`, `to`, `magnitude`, `effect_direction` and
 * `base_graph_hash` — and the contract is explicit that `std` and
 * `exists_probability` are *"ABSENT BY CONTRACT … The server owns them."*
 * `EdgeV3Schema` requires both, so this module must supply them.
 *
 * It supplies the CANONICAL CONSTANTS and nothing hand-rolled:
 * `DEFAULT_EXISTS_PROBABILITY` (0.8) and `DEFAULT_STD` (0.1), both from
 * `@talchain/schemas`, the same values PLoT defaults to. That is deliberate and
 * it is the honest reading of the situation rather than a shortcut:
 *
 *   · The user stated a MAGNITUDE and a DIRECTION. Those are their claims and
 *     they land verbatim.
 *   · The user stated NOTHING about how likely the link is to exist, or about
 *     how uncertain the strength is. A defaulted constant is not a user fact,
 *     and this module does not stamp one as though it were — it writes no
 *     provenance claiming a person supplied these.
 *
 * ⛔ SO DO NOT LATER "IMPROVE" THIS by stamping user provenance on the two
 * server-owned fields to make a downstream surface stop saying "not set". The
 * canvas's provenance gates read exactly that distinction, and a stamp here
 * would turn a default into a measurement on every edge a user draws — the
 * `beliefExists: 0.8` fabrication class, re-shipped from the server side where
 * it is harder to see.
 *
 * ⚠ AND NOT `STRUCTURAL_EDGE_DEFAULTS`. That constant (1.0 / mean 1.0 / std
 * 0.01) is for TOPOLOGY edges — decision→option, option→factor — which "represent
 * graph topology, not causal beliefs". An edge a user draws between two existing
 * nodes is a causal belief by construction, so borrowing the structural
 * constants would assert certainty nobody expressed.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐⭐ THE TWO GATES THE APPLIER ALREADY ENFORCES, PRE-CHECKED HERE ANYWAY.
 *
 * `applyAddEdge` throws `NODE_NOT_FOUND` for an unresolvable endpoint and
 * `EDGE_ALREADY_EXISTS` for a duplicate, which satisfies the contract's demand
 * that CEE *"MUST refuse an endpoint that does not resolve in its persisted
 * graph rather than creating a dangling edge."*
 *
 * That is correct and it is NOT sufficient, for exactly the reason the
 * `structural_add` sibling records about its own id collision: a `PatchApplyError`
 * yields a generic *"I couldn't apply that"* sentence, whereas each of these has
 * a specific, followable answer. So both are resolved here first, with the
 * applier left in place as the backstop that makes the sentence a courtesy
 * rather than the enforcement.
 *
 * ⚠ SELF-EDGES ARE NOT REFUSED, and that is derived rather than an oversight.
 * The contract says so in terms: `EdgeV3Schema` permits them, no endpoint-addressed
 * member forbids them, and *"a transport-level refusal would encode a MODELLING
 * opinion the graph contract does not hold."*
 *
 * ⚠ NO `expected` TWIN, unlike `structural_rename`. Also derived: every edge
 * field the hash projection reads is analysis-affecting, so `base_graph_hash`
 * genuinely covers this gesture. The two members differ because the hash's
 * COVERAGE differs, not because the authors were inconsistent.
 */
import type { OlumiResponse, SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { EditGraphHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { DEFAULT_EXISTS_PROBABILITY, DEFAULT_STD } from '@talchain/schemas';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { log } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../graph-management/reason-codes.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { mergeAppliedGraphForPersistence } from '../handlers/edit-graph-dispatch.js';
import { applyPatchOperations, PatchApplyError } from '../../orchestrator/patch-applier.js';
import type { PatchOperation } from '../../orchestrator/types.js';

type StructuralAddEdgeEvent = Extract<
  SystemEventTurnPayload['event'],
  { kind: 'structural_add_edge' }
>;

export interface StructuralAddEdgeBaseHashConflict {
  readonly conflict_category: typeof BASE_HASH_DIVERGED;
  readonly expected_base_graph_hash: string | null;
}

/** A non-null persisted graph that fails GraphV3 is CORRUPTION, not absence. */
export class InvalidPersistedAddEdgeGraphError extends Error {
  constructor() {
    super('structural_add_edge persisted graph failed GraphV3 validation');
    this.name = 'InvalidPersistedAddEdgeGraphError';
  }
}

export type StructuralAddEdgeResult =
  | {
      readonly kind: 'mutated';
      readonly response: OlumiResponse;
      readonly mutatedGraph: unknown;
      readonly handlerFacts: readonly HandlerFact[];
      readonly graph: GraphV3T;
      readonly baseGraph: unknown;
      readonly from: string;
      readonly to: string;
      readonly signedMean: number;
    }
  | {
      readonly kind: 'refused';
      readonly response: OlumiResponse;
      readonly reason: string;
      readonly baseHashConflict?: StructuralAddEdgeBaseHashConflict;
    };

export interface ApplyStructuralAddEdgeParams {
  readonly payload: SystemEventTurnPayload;
  readonly event: StructuralAddEdgeEvent;
  readonly requestId: string;
  /** Raw graph from the STRICT server-side persisted-graph read. Never client-supplied. */
  readonly persistedGraph: unknown;
}

function refuse(
  payload: SystemEventTurnPayload,
  reason: string,
  assistantText: string,
  baseHashConflict?: StructuralAddEdgeBaseHashConflict,
): StructuralAddEdgeResult {
  return {
    kind: 'refused',
    reason,
    ...(baseHashConflict !== undefined ? { baseHashConflict } : {}),
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

/** The label a person would recognise, for the confirmation and the receipt. */
function labelOf(graph: GraphV3T, nodeId: string): string {
  return graph.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
}

/**
 * ⭐ THE SIGN IS APPLIED HERE AND NOWHERE ELSE.
 *
 * The wire carries an unsigned `magnitude` and a separate `effect_direction`,
 * *"so a strength change cannot reverse an edge accidentally"*. `EdgeV3`'s
 * `strength.mean` is signed, so exactly one place must combine them. Doing it
 * twice — or differently from the canvas — is how one datum acquires two
 * spellings.
 */
export function signedMeanFor(magnitude: number, direction: 'positive' | 'negative'): number {
  return direction === 'negative' ? -Math.abs(magnitude) : Math.abs(magnitude);
}

export function applyStructuralAddEdge(
  params: ApplyStructuralAddEdgeParams,
): StructuralAddEdgeResult {
  const { payload, event, requestId, persistedGraph } = params;

  // ── 1. a base we can trust, or nothing ───────────────────────────────────
  if (persistedGraph === null || persistedGraph === undefined) {
    log.info(
      {
        event: 'v5.system_event.structural_add_edge.no_persisted_graph',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_add_edge — no persisted model; refusing without a graph write',
    );
    return refuse(
      payload,
      'no_persisted_graph',
      `There's no saved model to connect those in yet. Tell me about the decision first and I'll build one with you.`,
    );
  }
  const graphParse = GraphV3.safeParse(persistedGraph);
  if (!graphParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_add_edge.persisted_graph_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: graphParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_add_edge — non-null persisted graph is malformed; failing closed',
    );
    throw new InvalidPersistedAddEdgeGraphError();
  }
  const baseGraph = graphParse.data;

  // ── 2. THE STALE GATE, before anything is resolved ───────────────────────
  const currentBaseHash = computeAnalysisAffectingGraphHash(
    persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (currentBaseHash === null || currentBaseHash !== event.base_graph_hash) {
    log.info(
      {
        event: 'v5.system_event.structural_add_edge.base_hash_diverged',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        client_base_graph_hash: event.base_graph_hash,
        server_base_graph_hash: currentBaseHash,
      },
      'structural_add_edge — client base hash diverged; refusing the add',
    );
    return refuse(
      payload,
      BASE_HASH_DIVERGED,
      `The model has changed since you drew that connection, so I haven't added it. Reload it and draw it again.`,
      { conflict_category: BASE_HASH_DIVERGED, expected_base_graph_hash: currentBaseHash },
    );
  }

  // ── 3. THE ENDPOINT GATE — a dangling edge is what the contract forbids ──
  // The applier throws NODE_NOT_FOUND, which is the enforcement. This exists
  // for the SENTENCE: "one end of that connection isn't in the model" is
  // followable, "I couldn't apply that" is not.
  const sourceExists = baseGraph.nodes.some((n) => n.id === event.from);
  const targetExists = baseGraph.nodes.some((n) => n.id === event.to);
  if (!sourceExists || !targetExists) {
    log.info(
      {
        event: 'v5.system_event.structural_add_edge.endpoint_unresolved',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        source_exists: sourceExists,
        target_exists: targetExists,
      },
      'structural_add_edge — an endpoint does not resolve in the persisted graph; refusing',
    );
    return refuse(
      payload,
      'endpoint_unresolved',
      `One end of that connection isn't in the saved model, so I haven't added it. Reload and try again.`,
    );
  }

  // ── 4. THE DUPLICATE GATE — the hash cannot catch this either ────────────
  // Same shape as the sibling's id collision: `base_graph_hash` can be perfectly
  // fresh and the edge still already be present, because it is present in the
  // very graph the user was looking at.
  if (baseGraph.edges.some((e) => e.from === event.from && e.to === event.to)) {
    log.info(
      {
        event: 'v5.system_event.structural_add_edge.edge_already_exists',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_add_edge — that edge is already present; refusing rather than duplicating',
    );
    return refuse(
      payload,
      'edge_already_exists',
      `${labelOf(baseGraph, event.from)} and ${labelOf(baseGraph, event.to)} are already connected, so I've left the model as it is. Open that connection to change its strength.`,
    );
  }

  // ── 5. the canonical PatchOperation train ────────────────────────────────
  const signedMean = signedMeanFor(event.magnitude, event.effect_direction);
  const addedEdge = {
    from: event.from,
    to: event.to,
    strength: { mean: signedMean, std: DEFAULT_STD },
    exists_probability: DEFAULT_EXISTS_PROBABILITY,
    effect_direction: event.effect_direction,
  };
  const operations: PatchOperation[] = [
    // `applyAddEdge` reads the id off `value`, not `path`; the `from::to` path
    // is the convention `parseEdgePath` accepts and its siblings emit.
    { op: 'add_edge', path: `${event.from}::${event.to}`, value: addedEdge },
  ];

  let candidate: GraphV3T;
  try {
    candidate = applyPatchOperations(baseGraph, operations);
  } catch (err) {
    log.error(
      {
        event: 'v5.system_event.structural_add_edge.apply_failed',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        code: err instanceof PatchApplyError ? err.code : 'unknown',
      },
      'structural_add_edge — canonical applier refused the addition; nothing written',
    );
    return refuse(
      payload,
      err instanceof PatchApplyError ? err.code : 'apply_failed',
      `I couldn't add that connection to the saved model, so nothing changed. Reload it and try again.`,
    );
  }

  // ── 6. put the rest of the graph back ────────────────────────────────────
  const ingressParse = GraphStateIngressSchema.safeParse(persistedGraph);
  if (!ingressParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_add_edge.ingress_projection_failed',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: ingressParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_add_edge — trusted base could not be projected for the persist merge; refusing',
    );
    return refuse(
      payload,
      'ingress_projection_failed',
      `I couldn't save that safely, so I haven't changed anything.`,
    );
  }
  // ⚠ THE CLONE IS LOAD-BEARING — see the sibling's note. `mergeAppliedGraphForPersistence`
  // composes with a SHALLOW spread, so a downstream projection pass that mutated
  // rather than copied would write through into `persistedGraph`, which
  // `dispatch.ts` hashes as the atomic-CAS expected base: a 409 at rest, forever.
  const merged = structuredClone(
    mergeAppliedGraphForPersistence({
      appliedGraph: candidate,
      persistedBase: persistedGraph,
      ingressBase: ingressParse.data,
      requestId,
      scenarioId: payload.scenario_id,
    }),
  );

  const projectedGraph = projectGraphForPersistence(merged, {
    scenarioId: payload.scenario_id,
    turnId: payload.turn_id,
    turnClass: 'handler',
    source: 'structural_add_edge',
  });
  const projectedParse = GraphV3.safeParse(projectedGraph);
  if (!projectedParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_add_edge.projected_graph_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: projectedParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_add_edge — post-add graph failed validation; refusing the write',
    );
    return refuse(
      payload,
      'projected_graph_invalid',
      `I couldn't save that safely, so I haven't changed anything.`,
    );
  }

  // ── 7. postconditions, on the bytes that would land ──────────────────────
  // 7a. THE EDGE IS ACTUALLY THERE, AND UNALTERED. Claiming an add that did not
  //     land is the defect this writer exists to close, one level up. The sign
  //     is checked too: a merge or projection pass that dropped the direction
  //     would land an edge pointing the opposite way under a confirmation
  //     saying otherwise.
  const landed = projectedParse.data.edges.find(
    (e) => e.from === event.from && e.to === event.to,
  );
  if (
    landed === undefined ||
    landed.strength.mean !== signedMean ||
    landed.effect_direction !== event.effect_direction
  ) {
    log.error(
      {
        event: 'v5.system_event.structural_add_edge.add_did_not_land',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        found: landed !== undefined,
        landed_mean: landed?.strength.mean ?? null,
        expected_mean: signedMean,
      },
      'structural_add_edge — the new connection is absent or altered in the persisted bytes; refusing',
    );
    return refuse(
      payload,
      'add_did_not_land',
      `I couldn't add that connection reliably, so I haven't changed anything.`,
    );
  }

  // 7b. NOTHING ELSE MOVED. An add creates exactly one edge and touches no node.
  if (
    projectedParse.data.edges.length !== baseGraph.edges.length + 1 ||
    projectedParse.data.nodes.length !== baseGraph.nodes.length
  ) {
    log.error(
      {
        event: 'v5.system_event.structural_add_edge.collateral_change',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        edges_before: baseGraph.edges.length,
        edges_after: projectedParse.data.edges.length,
        nodes_before: baseGraph.nodes.length,
        nodes_after: projectedParse.data.nodes.length,
      },
      'structural_add_edge — the write would change more than one edge; refusing',
    );
    return refuse(
      payload,
      'collateral_change',
      `I couldn't add that connection safely, so I haven't changed anything.`,
    );
  }

  // ── 8. the receipt ───────────────────────────────────────────────────────
  // `impact: 'high'` and NOT the sibling's `'moderate'`, and the difference is
  // derived from its own stated reasoning: a new NODE is `'moderate'` because
  // "the new entry has no edges, so it changes what the model CONTAINS without
  // yet changing any causal path the analysis follows." An edge IS a causal
  // path. It changes what the analysis follows, by construction.
  const postAddHash = computeAnalysisAffectingGraphHash(
    projectedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  const fromLabel = labelOf(baseGraph, event.from);
  const toLabel = labelOf(baseGraph, event.to);
  const fact = {
    fact_type: 'edit_graph' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      edit_kind: 'structural' as const,
      status: 'applied' as const,
      operations_count: operations.length,
      affected_entities: [{ kind: 'edge', label: `${fromLabel} → ${toLabel}` }],
      graph_hash_before: currentBaseHash,
      graph_hash_after: postAddHash,
      safe_summary: `Connected ${fromLabel} to ${toLabel}`,
      impact: 'high' as const,
      rerun_recommended: true,
    },
  };
  const factCheck = EditGraphHandlerFactSchema.safeParse(fact);
  if (!factCheck.success) {
    log.error(
      {
        event: 'v5.system_event.structural_add_edge.fact_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        parse_error: factCheck.error.message,
      },
      'structural_add_edge — receipt failed its own contract; refusing the commit (fail closed)',
    );
    return refuse(
      payload,
      'fact_invalid',
      `I couldn't record that properly, so I haven't changed the model.`,
    );
  }

  return {
    kind: 'mutated',
    response: {
      response_version: 2,
      assistant_text: `I've connected ${fromLabel} to ${toLabel}. Re-run the analysis to see what it changes.`,
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: payload.stage,
    },
    mutatedGraph: projectedGraph,
    handlerFacts: [factCheck.data],
    graph: projectedParse.data,
    baseGraph: persistedGraph,
    from: event.from,
    to: event.to,
    signedMean,
  };
}
