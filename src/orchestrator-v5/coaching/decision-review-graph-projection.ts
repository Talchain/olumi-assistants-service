/**
 * ⭐⭐⭐ ONE RUN-MATCHED GRAPH REPRESENTATION, USED COHERENTLY BY THE PROMPT
 * AND BY THE CONTRACT.
 *
 * The decision_review enricher needs a graph for two different consumers that
 * must agree:
 *
 *   1. the PROMPT's `<GRAPH>` section (`cee/decision-review/invoke.ts`), and
 *   2. the CONTRACT's entity-grounding corpus
 *      (`cee/decision-review/contract-gate.ts` → `collectGraphEntityIds`),
 *      which decides whether `bias_findings[].affected_elements` are grounded
 *      and therefore whether the whole review is dropped.
 *
 * If those two see different graphs, the model is asked to cite ids from one
 * graph and judged against another. This module is the single projection both
 * consume.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⛔ WHY NOT `compactGraphForContextPack`.
 *
 * That adapter is the right RICH compactor on its strict-parse arm, and this
 * module reuses exactly that arm (`compactGraph`). Its OTHER arm is not usable
 * here. `toStructuralGraphV3` (compact-graph-for-contextpack.ts:267-277)
 * spreads the raw edge and then UNCONDITIONALLY overwrites three facts:
 *
 *     strength: { mean: 0, std: 0 },
 *     exists_probability: 1,
 *     effect_direction: 'positive',
 *
 * A real edge whose saved mean is -0.6 comes out of that branch as a positive,
 * certain, zero-strength edge. For the ContextPack that is a declared,
 * inert-defaults degradation whose downstream compactor suppresses
 * interpretation for zero-mean edges. Here it would be a FABRICATION handed to
 * a reviewing model and then used to ground its citations. So on strict-parse
 * failure this module falls back to a NARROW SOURCE-FIELD-PRESERVING read
 * projection instead: every field is copied only when the source actually
 * carries it, and absence stays absence. Nothing is invented.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⭐ EDGES HAVE NO `id` IN THE COMPACT SHAPE — AND THAT IS THE WHOLE REASON
 * THE CONTRACT GATE NEEDED THE ENDPOINT DOCTRINE.
 *
 * `CompactEdge` is `{ from, to, strength, exists, … }` — deliberately no `id`
 * (graph-compact.ts:143). `collectGraphEntityIds` reads `.id` only. So the
 * moment a real graph reaches the contract gate, EVERY edge reference the
 * model makes is ungrounded, `ungrounded_entity_reference` fires, and
 * `mustDrop` discards the entire review. Giving the model the graph would have
 * made the product strictly worse.
 *
 * Two halves fix it, and both are needed:
 *   · here — the source edge's explicit `id` is carried back onto the compact
 *     edge when the source has one (a positional carry that fails weak, the
 *     same idiom as `withProducerContextCarriers`);
 *   · in `contract-gate.ts` — the corpus additionally admits the producer's
 *     endpoint-pair spellings for edges that GENUINELY EXIST.
 *
 * ⚠ Neither half weakens validation. A reference to an edge that is not in
 * this projection still refuses, and an invented node id still refuses. The
 * corpus grows by the aliases of REAL edges only.
 */

import { GraphV3 } from '../../schemas/cee-v3.js';
import {
  boundNodeDescriptionForContext,
  compactGraph,
  type GraphV3Compact,
} from '../../orchestrator/context/graph-compact.js';

/** How the projection was obtained. Reported in telemetry; never user-facing. */
export type DecisionReviewGraphSource =
  /** The enrichment envelope carried its own graph — the producer is authoritative. */
  | 'enrichment'
  /** The run graph passed strict GraphV3 parse and went through the rich compactor. */
  | 'run_snapshot_strict'
  /** Strict parse failed; a narrow source-field-preserving read projection was used. */
  | 'run_snapshot_preserving'
  /** Nothing usable was available. */
  | 'absent';

export interface DecisionReviewGraphProjection {
  /** The single representation handed to BOTH the prompt and the contract. */
  readonly graph: Record<string, unknown>;
  readonly via: DecisionReviewGraphSource;
  readonly node_count: number;
  readonly edge_count: number;
  /** How many projected edges carry an explicit source `id`. */
  readonly edge_ids_retained: number;
}

const EMPTY: DecisionReviewGraphProjection = {
  graph: {},
  via: 'absent',
  node_count: 0,
  edge_count: 0,
  edge_ids_retained: 0,
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A graph record is usable only if it carries at least one node or edge. */
function hasEntities(graph: Record<string, unknown> | null): boolean {
  if (graph === null) return false;
  const nodes = graph.nodes;
  const edges = graph.edges;
  return (
    (Array.isArray(nodes) && nodes.length > 0) || (Array.isArray(edges) && edges.length > 0)
  );
}

/**
 * The producer's canonical endpoint spelling for an edge — `fragile_edges[]
 * .edge_id` and the `scenario_contexts` key both use it, and it is the form the
 * contract corpus accepts (`collectGraphEntityIds`).
 */
function endpointAddress(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * Give every projected edge an `id` the model can cite.
 *
 * ⭐⭐ THIS IS THE ROOT-CAUSE HALF OF THE FIX, AND IT IS WHY THE REPAIR DOES NOT
 * MAKE THE PRODUCT WORSE.
 *
 * The served prompt tells the model that `bias_findings[].affected_elements`
 * "must be a valid node id or edge id from graph". `CompactEdge` has no `id`
 * (graph-compact.ts:143). So the model has been instructed to cite a field that
 * does not exist on the thing it is citing — and once the contract gate has a
 * real corpus, every id it invents in that gap drops the ENTIRE review. Widening
 * the gate to tolerate invented references would be a relaxation; this is not.
 * It closes the gap at the other end, by making the address REAL.
 *
 * Two sources, in order:
 *   · the source edge's own `id`, carried back by index and confirmed by both
 *     endpoints (`compactGraph` maps `graph.edges` 1:1, so the index is the
 *     natural join; if it ever filters, the endpoints disagree and the carry
 *     fails weak, which is safe because the address below still applies);
 *   · otherwise `from->to`, which is DERIVED ENTIRELY FROM FIELDS THE EDGE
 *     ALREADY CARRIES. It asserts nothing the producer did not say — contrast
 *     `toStructuralGraphV3`, which invents a strength, a probability and a
 *     direction.
 *
 * `edge_ids_retained` counts only the FIRST kind, so telemetry never reports a
 * synthesised address as producer-supplied identity.
 */
function carryEdgeIds(
  compact: GraphV3Compact,
  sourceEdges: readonly unknown[],
): { edges: Array<Record<string, unknown>>; retained: number } {
  let retained = 0;
  const edges = compact.edges.map((edge, index) => {
    const source = readRecord(sourceEdges[index]);
    const explicit =
      source !== null && source.from === edge.from && source.to === edge.to
        ? nonEmptyString(source.id)
        : null;
    if (explicit !== null) retained += 1;
    return {
      id: explicit ?? endpointAddress(edge.from, edge.to),
      ...edge,
    } as Record<string, unknown>;
  });
  return { edges, retained };
}

/**
 * Node fields copied by the preserving projection. Deliberately the same
 * vocabulary the rich compactor emits, so the two arms are interchangeable to
 * every downstream reader. A field absent on the source is absent here.
 */
const PRESERVED_NODE_FIELDS = ['id', 'kind', 'label', 'type', 'category', 'description'] as const;
/** `observed_state` fields lifted to the top level, mirroring `compactGraph`. */
const PRESERVED_OBSERVED_FIELDS = ['value', 'raw_value', 'unit', 'cap'] as const;

function projectNodePreserving(raw: unknown): Record<string, unknown> | null {
  const node = readRecord(raw);
  if (node === null) return null;
  const id = nonEmptyString(node.id);
  if (id === null) return null;
  const out: Record<string, unknown> = { id };
  for (const field of PRESERVED_NODE_FIELDS) {
    if (field === 'id' || field === 'description') continue;
    if (node[field] !== undefined && node[field] !== null) out[field] = node[field];
  }
  // Same 160-char bound the rich compactor applies, through the same shared
  // helper — so the two arms cost the same prompt budget and a re-spelled
  // constant here can never drift from the one the strict arm uses.
  const description = boundNodeDescriptionForContext(node.description);
  if (description !== undefined) out.description = description;
  const observed = readRecord(node.observed_state);
  if (observed !== null) {
    for (const field of PRESERVED_OBSERVED_FIELDS) {
      if (observed[field] !== undefined && observed[field] !== null) out[field] = observed[field];
    }
  }
  if (node.is_baseline === true) out.is_baseline = true;
  return out;
}

/**
 * ⚠ THE ANTI-FABRICATION ARM. Every field is conditional. There is no `?? 0`,
 * no `?? 1` and no `'positive'` default anywhere in this function, and a test
 * pins that a source edge carrying `strength.mean: -0.6` survives as -0.6.
 */
function projectEdgePreserving(raw: unknown): Record<string, unknown> | null {
  const edge = readRecord(raw);
  if (edge === null) return null;
  const from = nonEmptyString(edge.from);
  const to = nonEmptyString(edge.to);
  if (from === null || to === null) return null;
  // Same address doctrine as the strict arm — an explicit producer id when there
  // is one, the endpoint spelling otherwise, so the model can always cite it.
  const out: Record<string, unknown> = { id: nonEmptyString(edge.id) ?? endpointAddress(from, to), from, to };
  const strength = readRecord(edge.strength);
  if (strength !== null && typeof strength.mean === 'number' && Number.isFinite(strength.mean)) {
    out.strength = strength.mean;
  } else if (typeof edge.strength === 'number' && Number.isFinite(edge.strength)) {
    out.strength = edge.strength;
  }
  if (typeof edge.exists_probability === 'number' && Number.isFinite(edge.exists_probability)) {
    out.exists = edge.exists_probability;
  } else if (typeof edge.exists === 'number' && Number.isFinite(edge.exists)) {
    out.exists = edge.exists;
  }
  if (typeof edge.effect_direction === 'string') out.effect_direction = edge.effect_direction;
  return out;
}

function projectPreserving(graph: Record<string, unknown>): DecisionReviewGraphProjection {
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodes = rawNodes
    .map(projectNodePreserving)
    .filter((n): n is Record<string, unknown> => n !== null);
  const edges = rawEdges
    .map(projectEdgePreserving)
    .filter((e): e is Record<string, unknown> => e !== null);
  if (nodes.length === 0 && edges.length === 0) return EMPTY;
  return {
    graph: { nodes, edges, _node_count: nodes.length, _edge_count: edges.length },
    via: 'run_snapshot_preserving',
    node_count: nodes.length,
    edge_count: edges.length,
    // Explicit producer ids only — a synthesised `from->to` address is an
    // address, not identity, and must never be reported as one.
    edge_ids_retained: rawEdges.filter((e) => nonEmptyString(readRecord(e)?.id) !== null).length,
  };
}

/**
 * Build the one run-matched graph representation.
 *
 * Authority order, and it is ORDERED not OVERRIDING: the enrichment envelope's
 * own graph wins wherever it speaks, exactly as `buildGraphNodeLookup` already
 * resolves it one layer down. The run snapshot is consulted only when the
 * envelope yields nothing at all — the documented steady state on this path.
 *
 * @param enrichmentGraph `readGraph(enrichment)` — `{}` when the envelope
 *   carries none, which on staging is every turn.
 * @param runGraph The graph the RUN HANDLER actually analysed — the chip
 *   path's `cachedSnapshot.rawPersistedGraph` or the routed path's
 *   `__run_graph_snapshot`. NOT a turn-start reread: a turn that edits and then
 *   analyses moves the persisted graph underneath, and grounding a review of
 *   run N against the graph as it stood at turn start cites the wrong model.
 */
export function projectRunGraphForDecisionReview(
  enrichmentGraph: Record<string, unknown>,
  runGraph: unknown,
): DecisionReviewGraphProjection {
  if (hasEntities(enrichmentGraph)) {
    const nodes = Array.isArray(enrichmentGraph.nodes) ? enrichmentGraph.nodes : [];
    const edges = Array.isArray(enrichmentGraph.edges) ? enrichmentGraph.edges : [];
    return {
      graph: enrichmentGraph,
      via: 'enrichment',
      node_count: nodes.length,
      edge_count: edges.length,
      edge_ids_retained: edges.filter((e) => nonEmptyString(readRecord(e)?.id) !== null).length,
    };
  }

  const candidate = readRecord(runGraph);
  if (!hasEntities(candidate) || candidate === null) return EMPTY;

  const parsed = GraphV3.safeParse(candidate);
  if (parsed.success) {
    const compact = compactGraph(parsed.data);
    const sourceEdges = Array.isArray(candidate.edges) ? candidate.edges : [];
    const { edges, retained } = carryEdgeIds(compact, sourceEdges);
    return {
      graph: {
        nodes: compact.nodes,
        edges,
        _node_count: compact._node_count,
        _edge_count: compact._edge_count,
      },
      via: 'run_snapshot_strict',
      node_count: compact.nodes.length,
      edge_count: edges.length,
      edge_ids_retained: retained,
    };
  }

  // ⛔ NOT `toStructuralGraphV3`. See this module's header.
  return projectPreserving(candidate);
}
