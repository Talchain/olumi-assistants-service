/**
 * Track 3 — candidate-graph construction over the V5-owned seam
 * `applyAndValidateMutation` (apply-graph-mutation.ts). PURE: builds an in-memory
 * candidate; NO persistence, no DB, no live runtime writes. Uses no V4 patch/apply
 * machinery (enforced by isolation-guards.test.ts). Ported from the PR #300 spike,
 * adapted to the T4.0 envelope payloads.
 *
 * Correctness rail: candidate graphs are constructed ONLY through this seam. The
 * persistence merge seam (`mergeMutatedGraphForPersistence`) is NEVER imported
 * here — it is exercised solely by the merge-parity fixtures (import boundary,
 * Paul #1).
 */
import { applyAndValidateMutation } from '../tools/handlers/d1-shared/apply-graph-mutation.js';
import { D1HandlerError } from '../tools/handlers/d1-shared/errors.js';
import { GraphV3, type GraphV3T, type NodeV3T, type EdgeV3T } from '../../schemas/cee-v3.js';
import {
  EDGE_REQUIRED_NESTED_FIELDS,
  NODE_REQUIRED_NESTED_FIELDS,
  describeNonObjectWrite,
  isPlainObjectWrite,
  mergeRequiredNestedWrite,
} from '../../schemas/required-nested-merge.js';
import {
  CANDIDATE_BUILD_FAILED,
  ENTITY_NOT_FOUND,
  GRAPH_INVARIANT_VIOLATED,
} from './reason-codes.js';
import type { MutationBlocker } from './types.js';

export interface CandidateBuildResult {
  readonly candidate?: Record<string, unknown>;
  readonly error?: MutationBlocker;
}

/** Payload sub-shapes the builders consume (structural subset of the envelope). */
export interface RenamePayload {
  readonly node_id: string;
  readonly to_label: string;
}
export interface AddNodePayload {
  readonly node: {
    readonly id: string;
    readonly kind: NodeV3T['kind'];
    readonly label: string;
  };
}
export interface AddEdgePayload {
  readonly edge: {
    readonly from: string;
    readonly to: string;
  };
}
export interface AddOptionPayload {
  readonly option: {
    readonly id: string;
    readonly label: string;
    readonly parent_decision_id?: string;
    readonly edges: ReadonlyArray<{
      readonly to_factor_id: string;
      readonly strength?: { readonly mean: number; readonly std: number };
      readonly effect_direction?: 'positive' | 'negative';
    }>;
    readonly interventions?: Readonly<Record<string, Record<string, unknown>>>;
  };
}
/** D-S (ROADMAP §D, Paul 2026-07-12): tunable field-update payload shapes. */
export interface UpdateNodeFieldPayload {
  readonly node_id: string;
  readonly field: string;
  readonly to: unknown;
}
export interface UpdateEdgeFieldPayload {
  readonly from_node: string;
  readonly to_node: string;
  readonly field: string;
  readonly to: unknown;
}

/**
 * Map a candidate-build error to a REDACTED blocker. Crucial: `err.message` from
 * `applyAndValidateMutation` / D1 embeds raw ids (e.g. `Node <node_id> not found`),
 * so it MUST NOT reach `blocker.readable` — the readable is a fixed per-code string
 * (path/code only, never a payload value; T4.0 §5 redaction). Only the two D1 codes
 * that belong to the mutation vocabulary map through; every other D1 code collapses
 * to CANDIDATE_BUILD_FAILED (keeping `code` inside MUTATION_REASON_CODES).
 */
function toBlocker(err: unknown): MutationBlocker {
  if (err instanceof D1HandlerError) {
    switch (err.code) {
      case 'GRAPH_INVARIANT_VIOLATED':
        return { code: GRAPH_INVARIANT_VIOLATED, readable: 'The candidate graph failed schema validation.' };
      case 'ENTITY_NOT_FOUND':
        return { code: ENTITY_NOT_FOUND, readable: 'A referenced entity was not found in the graph.' };
      default:
        return { code: CANDIDATE_BUILD_FAILED, readable: 'Candidate construction failed.' };
    }
  }
  return { code: CANDIDATE_BUILD_FAILED, readable: 'Candidate construction failed.' };
}

const DEFAULT_STRENGTH = { mean: 0.5, std: 0.1 } as const;

/** Deep-clone the mutated graph before exposing it so it does not alias input arrays. */
function exposeCandidate(mutatedGraph: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(mutatedGraph);
}

function makeEdge(
  from: string,
  to: string,
  strength?: { readonly mean: number; readonly std: number },
  effectDirection?: 'positive' | 'negative',
): EdgeV3T {
  return {
    from,
    to,
    strength: strength ? { ...strength } : { ...DEFAULT_STRENGTH },
    exists_probability: 0.9,
    effect_direction: effectDirection ?? 'positive',
  };
}

export function buildRenameCandidate(
  persistedGraph: unknown,
  payload: RenamePayload,
): CandidateBuildResult {
  try {
    const { mutatedGraph } = applyAndValidateMutation(persistedGraph, (clone: GraphV3T) => {
      const node = clone.nodes.find((n) => n.id === payload.node_id);
      if (!node) {
        throw new D1HandlerError('ENTITY_NOT_FOUND', `Node ${payload.node_id} not found in graph.`);
      }
      const before = { label: node.label };
      node.label = payload.to_label;
      return { before, after: { label: payload.to_label } };
    });
    return { candidate: exposeCandidate(mutatedGraph) };
  } catch (err) {
    return { error: toBlocker(err) };
  }
}

/**
 * Build the candidate graph for an `add_node` envelope (lane 32 intra-batch
 * sequencing). Same sanctioned seam as the other builders: the node enters a
 * GraphV3-validated clone, so the exposed candidate is guaranteed structurally
 * readable — a payload the schema rejects (e.g. a non-canonical id) surfaces
 * as a classified error, never a corrupted view.
 */
export function buildAddNodeCandidate(
  persistedGraph: unknown,
  payload: AddNodePayload,
): CandidateBuildResult {
  try {
    const { mutatedGraph } = applyAndValidateMutation(persistedGraph, (clone: GraphV3T) => {
      const node: NodeV3T = {
        id: payload.node.id,
        kind: payload.node.kind,
        label: payload.node.label,
      };
      clone.nodes.push(node);
      return { before: null, after: { node_id: payload.node.id } };
    });
    return { candidate: exposeCandidate(mutatedGraph) };
  } catch (err) {
    return { error: toBlocker(err) };
  }
}

/**
 * Build the candidate graph for an `add_edge` envelope (lane 32 intra-batch
 * sequencing). The envelope carries endpoints only; strength/existence
 * defaults mirror `makeEdge` (the add_option linkage defaults).
 */
export function buildAddEdgeCandidate(
  persistedGraph: unknown,
  payload: AddEdgePayload,
): CandidateBuildResult {
  try {
    const { mutatedGraph } = applyAndValidateMutation(persistedGraph, (clone: GraphV3T) => {
      clone.edges.push(makeEdge(payload.edge.from, payload.edge.to));
      return { before: null, after: { from: payload.edge.from, to: payload.edge.to } };
    });
    return { candidate: exposeCandidate(mutatedGraph) };
  } catch (err) {
    return { error: toBlocker(err) };
  }
}

export function buildAddOptionCandidate(
  persistedGraph: unknown,
  payload: AddOptionPayload,
): CandidateBuildResult {
  try {
    const { mutatedGraph } = applyAndValidateMutation(persistedGraph, (clone: GraphV3T) => {
      const optionNode: NodeV3T = {
        id: payload.option.id,
        kind: 'option',
        label: payload.option.label,
        ...(payload.option.interventions
          ? { interventions: { ...payload.option.interventions } }
          : {}),
      };
      clone.nodes.push(optionNode);
      if (payload.option.parent_decision_id) {
        clone.edges.push(makeEdge(payload.option.parent_decision_id, payload.option.id));
      }
      for (const e of payload.option.edges) {
        clone.edges.push(makeEdge(payload.option.id, e.to_factor_id, e.strength, e.effect_direction));
      }
      return { before: null, after: { option_id: payload.option.id } };
    });
    return { candidate: exposeCandidate(mutatedGraph) };
  } catch (err) {
    return { error: toBlocker(err) };
  }
}

// ============================================================================
// Tunable field-update builders (D-S ruling — ROADMAP §D, Paul 2026-07-12)
// ============================================================================

/**
 * Field paths arrive in every producer spelling: bare root (`description`),
 * dotted (`strength.mean`, `observed_state.value`), or slash-keyed
 * (`data/value`, `data/interventions/<fac_id>`). Segments that could reach
 * the prototype chain are refused outright (the field string is
 * model-controlled; assigning through `__proto__`/`constructor`/`prototype`
 * would pollute shared state, and no sanctioned tunable path uses them).
 */
const FORBIDDEN_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Set `value` at the (possibly nested) `field` path on `target`. Intermediate
 * segments that are absent or non-object are replaced with fresh objects —
 * mirroring the edit pipeline's leaf-path write semantics. Undeclared
 * NodeV3/EdgeV3 spellings (e.g. `data/*`) are STRIPPED by the post-mutation
 * re-validation — readiness-neutral for the referee's R6 parity check; the
 * live edit pipeline owns the real write.
 *
 * ⚠ ROADMAP 2.380 — THIS SETTER DOES NEED ONE PIECE OF SCHEMA KNOWLEDGE, AND
 * ITS ABSENCE WAS A LIVE DEAD END. Its docstring used to say *"this setter
 * never needs schema knowledge"* because post-mutation re-validation catches a
 * type-invalid result. That reasoning holds for a result that is WRONG; it
 * fails for a result that is INCOMPLETE. A whole-object write onto a REQUIRED
 * nested field (`{strength:{mean:0.8}}` — the shape the producer projects from
 * the model's own op) REPLACED the object and dropped the required `std`, so
 * every edge-strength edit failed `GraphV3.parse` and the live gate discarded
 * it: 0 of 15 live edits (L52 diagnosis, 2026-08-04). "Re-validation will
 * catch it" turned a producer-side partial write into a user-visible refusal
 * of a change the LIVE APPLIER had already computed correctly.
 *
 * `requiredNestedFields` is DERIVED from the canonical schema (see
 * `schemas/required-nested-merge.ts`) and is the SAME set the live applier
 * uses, so the two writers agree by construction rather than by two people
 * remembering the same rule. Note the dotted spelling (`strength.mean`) was
 * never broken — the segment walk descends into the existing object — so the
 * merge is needed only for the terminal whole-object write.
 */
function setTunableFieldPath(
  target: Record<string, unknown>,
  field: string,
  value: unknown,
  requiredNestedFields: ReadonlySet<string>,
): void {
  const segments = field.split(/[/.]/).filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new D1HandlerError('PARAMETER_INVALID', 'Empty field path.');
  }
  for (const seg of segments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(seg)) {
      throw new D1HandlerError('PARAMETER_INVALID', 'Forbidden field path segment.');
    }
  }
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i]!;
    const next = cursor[seg];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as Record<string, unknown>;
  }
  const leaf = segments[segments.length - 1]!;

  // Terminal WHOLE-OBJECT write onto a required nested field: merge, never
  // replace. Scope is root-level fields of the entity — deliberately the same
  // scope the live applier operates on (the keys of `op.value`).
  if (segments.length === 1 && requiredNestedFields.has(leaf)) {
    if (!isPlainObjectWrite(value)) {
      // A non-object write onto a required nested object is INCOHERENT: the
      // operation claims to update the field but cannot. Refuse it here, with
      // the producer named as the fault. Letting it through to the generic
      // post-mutation parse produced GRAPH_INVARIANT_VIOLATED — "the candidate
      // graph failed schema validation" — which blamed the graph and sent
      // every reader to the wrong file. The live applier refuses the same
      // shapes (patch-applier.ts, INVALID_OPERATION); this is the referee's
      // matching refusal, mapped by `toBlocker` to CANDIDATE_BUILD_FAILED
      // (a producer fault) rather than a graph-invariant violation.
      throw new D1HandlerError(
        'PARAMETER_INVALID',
        `Field '${leaf}' requires an object write; got ${describeNonObjectWrite(value)}.`,
      );
    }
    cursor[leaf] = mergeRequiredNestedWrite(cursor[leaf], value);
    return;
  }

  cursor[leaf] = value;
}

/**
 * Build the candidate graph for an `update_node_field` envelope. D-S ruling
 * (ROADMAP §D, Paul 2026-07-12): tunable value edits are would_apply-eligible,
 * so the referee needs a real candidate for the R6 readiness-parity check —
 * same sanctioned seam and redaction contract as the other builders. R4
 * field-safety has already allowlisted `field` before this runs; the builder
 * stays total regardless.
 */
export function buildUpdateNodeFieldCandidate(
  persistedGraph: unknown,
  payload: UpdateNodeFieldPayload,
): CandidateBuildResult {
  try {
    const { mutatedGraph } = applyAndValidateMutation(persistedGraph, (clone: GraphV3T) => {
      const node = clone.nodes.find((n) => n.id === payload.node_id);
      if (!node) {
        throw new D1HandlerError('ENTITY_NOT_FOUND', `Node ${payload.node_id} not found in graph.`);
      }
      setTunableFieldPath(
        node as Record<string, unknown>,
        payload.field,
        payload.to,
        NODE_REQUIRED_NESTED_FIELDS,
      );
      return { before: null, after: { node_id: payload.node_id } };
    });
    return { candidate: exposeCandidate(mutatedGraph) };
  } catch (err) {
    return { error: toBlocker(err) };
  }
}

/**
 * Build the candidate graph for an `update_edge_field` envelope (D-S ruling —
 * see `buildUpdateNodeFieldCandidate`). Targets the FIRST edge matching
 * from→to, mirroring `graphHasEdge`'s R3 existence semantics.
 */
export function buildUpdateEdgeFieldCandidate(
  persistedGraph: unknown,
  payload: UpdateEdgeFieldPayload,
): CandidateBuildResult {
  try {
    const { mutatedGraph } = applyAndValidateMutation(persistedGraph, (clone: GraphV3T) => {
      const edge = clone.edges.find(
        (e) => e.from === payload.from_node && e.to === payload.to_node,
      );
      if (!edge) {
        throw new D1HandlerError(
          'ENTITY_NOT_FOUND',
          `Edge ${payload.from_node} -> ${payload.to_node} not found in graph.`,
        );
      }
      setTunableFieldPath(
        edge as Record<string, unknown>,
        payload.field,
        payload.to,
        EDGE_REQUIRED_NESTED_FIELDS,
      );
      return { before: null, after: { from: payload.from_node, to: payload.to_node } };
    });
    return { candidate: exposeCandidate(mutatedGraph) };
  } catch (err) {
    return { error: toBlocker(err) };
  }
}

// ============================================================================
// Graph predicates (add_option held-reason discriminators — PR #300, verified live)
// ============================================================================

/** TOP-LEVEL options[] is an ARRAY (even empty). → OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE. */
export function graphHasTopLevelOptions(graph: unknown): boolean {
  if (graph === null || typeof graph !== 'object') return false;
  return Array.isArray((graph as { options?: unknown }).options);
}

/** TOP-LEVEL `options` is present but NOT an array. → GRAPH_OPTIONS_MALFORMED. */
export function graphOptionsAreMalformed(graph: unknown): boolean {
  if (graph === null || typeof graph !== 'object') return false;
  const options = (graph as { options?: unknown }).options;
  return options !== null && options !== undefined && !Array.isArray(options);
}

/**
 * Whether the CURRENT graph parses as GraphV3 (structural validity). Used to
 * distinguish a malformed BASE graph (an environmental hold → CURRENT_GRAPH_UNREADABLE)
 * from a genuinely invalid CANDIDATE (a producer fault → rejected): both otherwise
 * surface as `GRAPH_INVARIANT_VIOLATED` from `applyAndValidateMutation`'s two parse
 * steps (ingress vs post-mutation), which the redacted blocker cannot tell apart.
 * Total (never throws). Note: GraphV3 strips top-level `options`, so a malformed
 * `options` is caught separately by `graphOptionsAreMalformed`.
 */
export function currentGraphIsParseable(graph: unknown): boolean {
  try {
    return GraphV3.safeParse(graph).success;
  } catch {
    return false;
  }
}

/** A node with `nodeId` already exists. → OPTION_ID_COLLISION for add_option. */
export function graphHasNodeId(graph: unknown, nodeId: string): boolean {
  if (graph === null || typeof graph !== 'object') return false;
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.some(
    (n) => n !== null && typeof n === 'object' && (n as { id?: unknown }).id === nodeId,
  );
}

/** An edge `from → to` exists. Used by R3 referential integrity (update/remove edge). */
export function graphHasEdge(graph: unknown, from: string, to: string): boolean {
  if (graph === null || typeof graph !== 'object') return false;
  const edges = (graph as { edges?: unknown }).edges;
  if (!Array.isArray(edges)) return false;
  return edges.some(
    (e) =>
      e !== null &&
      typeof e === 'object' &&
      (e as { from?: unknown }).from === from &&
      (e as { to?: unknown }).to === to,
  );
}
