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
  projectUncertaintyDriversForContext,
  type GraphV3Compact,
} from '../../orchestrator/context/graph-compact.js';
import { valueSourceAuthorship } from '../../cee/transforms/provenance-display.js';

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
 * Give every projected edge an `id` the model can cite, and carry back the
 * source qualifiers the compactor does not model.
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
 * ⛔⛔ THIS JOINED BY INDEX AND THAT WAS WRONG. `compactGraph` SORTS — nodes by
 * id at graph-compact.ts:896, edges by `(from, to)` at :952. The positional join
 * silently assumed it did not. Measured on one two-edge graph: with the source
 * already in sorted order both explicit ids were retained, and with the SAME two
 * edges in the other order NEITHER was — so two genuine producer ids vanished,
 * and a model citing them would have had the whole review dropped. An endpoint
 * guard made it fail weak rather than mis-attribute, which is why nothing threw;
 * it just quietly lost identity depending on input order.
 *
 * Now joined by DIRECTED ENDPOINT PAIR, which is what the compactor sorts on and
 * therefore cannot be permuted by it. Parallel edges (same pair, more than one
 * edge) are consumed from a per-pair queue in source order — `Array.prototype
 * .sort` is stable, so same-pair edges keep their relative order through the
 * compactor and the queue matches them exactly.
 *
 * Address, in order: the source edge's own `id`; otherwise `from->to`, DERIVED
 * ENTIRELY FROM FIELDS THE EDGE ALREADY CARRIES. It asserts nothing the producer
 * did not say — contrast `toStructuralGraphV3`, which invents a strength, a
 * probability and a direction.
 *
 * `edge_ids_retained` counts only explicit producer ids, so telemetry never
 * reports a synthesised address as producer-supplied identity.
 */
function carryEdgeIds(
  compact: GraphV3Compact,
  sourceEdges: readonly unknown[],
): { edges: Array<Record<string, unknown>>; retained: number } {
  // Per-pair queues, in source order. Keyed on the directed endpoints the
  // compactor sorts by, so sorting cannot permute a key away from its edge.
  const byPair = new Map<string, Array<Record<string, unknown>>>();
  for (const raw of sourceEdges) {
    const source = readRecord(raw);
    if (source === null) continue;
    const from = nonEmptyString(source.from);
    const to = nonEmptyString(source.to);
    if (from === null || to === null) continue;
    const key = endpointAddress(from, to);
    const queue = byPair.get(key);
    if (queue === undefined) byPair.set(key, [source]);
    else queue.push(source);
  }

  let retained = 0;
  const edges = compact.edges.map((edge) => {
    const queue = byPair.get(endpointAddress(edge.from, edge.to));
    const source = queue !== undefined && queue.length > 0 ? queue.shift() ?? null : null;
    const explicit = source === null ? null : nonEmptyString(source.id);
    if (explicit !== null) retained += 1;
    return {
      id: explicit ?? endpointAddress(edge.from, edge.to),
      ...edge,
      // ⚠ `provenance.reasoning` is the producer's WHY for this relationship and
      // the compactor models only `provenance.source`. Dropping it left the model
      // a coefficient with no account of where it came from.
      ...(source !== null ? readEdgeReasoning(source) : {}),
    } as Record<string, unknown>;
  });
  return { edges, retained };
}

/** The producer's stated reason for an edge, when it gave one. Never inferred. */
function readEdgeReasoning(edge: Record<string, unknown>): Record<string, unknown> {
  const provenance = readRecord(edge.provenance);
  const reasoning = nonEmptyString(provenance?.reasoning);
  return reasoning === null ? {} : { reasoning };
}

/**
 * Goal-threshold fields GraphV3 declares on a node but `CompactNode` does not
 * model. On the £200,000-budget shape these ARE the decision meaning: a goal
 * node stripped of its threshold and unit is a name with no target.
 */
const GOAL_THRESHOLD_FIELDS = [
  'goal_threshold',
  'goal_threshold_raw',
  'goal_threshold_unit',
  'goal_threshold_cap',
] as const;

function readGoalThreshold(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of GOAL_THRESHOLD_FIELDS) {
    const value = node[field];
    if (value !== undefined && value !== null) out[field] = value;
  }
  return out;
}

/**
 * Carry the goal-threshold fields onto the compacted nodes, joined by `id`.
 * Node ids are unique within a graph, so this join cannot be permuted by the
 * compactor's sort — unlike the positional one it replaces.
 */
function carryNodeQualifiers(
  compact: GraphV3Compact,
  sourceNodes: readonly unknown[],
): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of sourceNodes) {
    const source = readRecord(raw);
    const id = nonEmptyString(source?.id);
    if (source !== null && id !== null && !byId.has(id)) byId.set(id, source);
  }
  return compact.nodes.map((node) => {
    const source = byId.get(node.id);
    return {
      ...node,
      ...(source === undefined ? {} : readGoalThreshold(source)),
    } as Record<string, unknown>;
  });
}

/**
 * Node fields copied by the preserving projection. Deliberately the same
 * vocabulary the rich compactor emits, so the two arms are interchangeable to
 * every downstream reader. A field absent on the source is absent here.
 */
const PRESERVED_NODE_FIELDS = ['id', 'kind', 'label', 'type', 'category', 'description'] as const;
/**
 * `observed_state` fields lifted to the top level, mirroring `compactGraph`.
 *
 * ⛔⛔ `stated_role` AND `source` WERE MISSING AND THAT IS THE WORST OMISSION IN
 * THIS FILE'S HISTORY, because it is the ONE-SIDED kind: it kept the NUMBER and
 * dropped the QUALIFIER THAT SAYS WHAT THE NUMBER IS.
 *
 * `stated_role: 'constraint'` means the user gave that magnitude as a LIMIT and
 * `value` is standing in for a level they never stated — the £200,000 shape
 * exactly. Without it the reviewing model sees a plain observation and may
 * reason about a budget CEILING as though it were a measured level. `source:
 * 'user_edited'` is the difference between the user's own figure and an AI
 * guess. Retaining `value` while discarding both is worse than retaining
 * neither, because it converts an uncertainty into a false certainty.
 *
 * The strict arm never had this gap — `CompactNode` models both — so this was
 * the two arms disagreeing about meaning while agreeing about numbers.
 */
const PRESERVED_OBSERVED_FIELDS = [
  'value',
  'raw_value',
  'unit',
  'cap',
  'stated_role',
  'source',
] as const;

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
      if (field === 'source') continue;
      if (observed[field] !== undefined && observed[field] !== null) out[field] = observed[field];
    }
    // ⚠ MAPPED, NOT COPIED — through the SAME shared authority the rich
    // compactor uses (`valueSourceAuthorship`, cee/transforms/provenance-
    // display.ts:396). Passing the raw string through had the two arms saying
    // DIFFERENT WORDS FOR ONE FACT: strict emitted `source: 'user'` and the
    // fallback `source: 'user_edited'` off the same node. Differently-named
    // twins is this estate's chronic defect, and it would have reached the
    // reviewing model as two provenance vocabularies in one prompt. An
    // unrecognised value maps to undefined and is omitted rather than guessed.
    // Returns the PAIR (`source` + `provenance`), which is what the compactor
    // emits too — so spreading it keeps both arms' shape identical, not just
    // their vocabulary.
    const authorship = valueSourceAuthorship(observed.source);
    if (authorship !== undefined) Object.assign(out, authorship);
  }
  if (node.is_baseline === true) out.is_baseline = true;
  // A goal node without its threshold is a name with no target.
  Object.assign(out, readGoalThreshold(node));
  // Producer-stated epistemic uncertainty, through the SHARED bounds authority
  // (`projectUncertaintyDriversForContext`) rather than a second copy of its
  // rules — it resolves the two permitted source locations, withholds on
  // conflict, and discloses its own truncation. Reusing it is what keeps this
  // arm's disclosure identical to the strict arm's.
  Object.assign(out, projectUncertaintyDriversForContext(node));
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
  // ⚠ A BIDIRECTED EDGE IS NOT AN ORDINARY LINK. It records an unmeasured common
  // cause, not a directed path. Dropping `edge_type` while keeping `strength`
  // presented one to the model as the other — the same one-sided loss as
  // `stated_role`, at the relationship level. The strict arm has always carried
  // it (graph-compact.ts CompactEdge.edge_type).
  if (edge.edge_type === 'bidirected') out.edge_type = 'bidirected';
  const provenance = readRecord(edge.provenance);
  const provenanceSource = nonEmptyString(provenance?.source);
  if (provenanceSource !== null) out.provenance = provenanceSource;
  Object.assign(out, readEdgeReasoning(edge));
  return out;
}

/**
 * The scenario's saved `goal_constraints` — a TOP-LEVEL GraphV3 field
 * (cee-v3.ts:654), and the carrier for a limit like "keep spend under
 * £200,000".
 *
 * ⛔ Both arms dropped it, because both rebuilt the graph as `{nodes, edges}`
 * and nothing else. On the shape this whole component exists to serve — Paul's
 * session, where a £200,000 budget was the entire point of the turn — the
 * reviewing model was handed a graph with the constraint deleted. Passed
 * through verbatim: it is producer data, and reshaping it would be inventing a
 * second context schema.
 */
function readGoalConstraints(graph: Record<string, unknown>): Record<string, unknown> {
  const constraints = graph.goal_constraints;
  return Array.isArray(constraints) && constraints.length > 0
    ? { goal_constraints: constraints }
    : {};
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
    graph: {
      nodes,
      edges,
      ...readGoalConstraints(graph),
      _node_count: nodes.length,
      _edge_count: edges.length,
    },
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
    const sourceNodes = Array.isArray(candidate.nodes) ? candidate.nodes : [];
    const { edges, retained } = carryEdgeIds(compact, sourceEdges);
    return {
      graph: {
        nodes: carryNodeQualifiers(compact, sourceNodes),
        edges,
        ...readGoalConstraints(candidate),
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
