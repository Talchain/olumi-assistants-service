/**
 * Candidate-graph construction over the V5-owned seam `applyAndValidateMutation`
 * (apply-graph-mutation.ts). PURE: builds an in-memory candidate; NO persistence,
 * no DB, no live runtime writes. Uses no V4 patch/apply machinery (enforced by
 * isolation-guards.test.ts).
 *
 * Two builders:
 *  - buildRenameCandidate: label-only node mutation (representable; survives the
 *    seam, see merge-parity.test.ts).
 *  - buildAddOptionCandidate: adds the option as a graph NODE + edges. Pinned
 *    fact: this CANNOT introduce a top-level options[] entry — the mutator only
 *    sees the GraphV3 clone (nodes/edges/goal_constraints), and the seam merges
 *    options[] from the base verbatim. `graphHasTopLevelOptions` lets the spine
 *    classify the hold reason honestly (divergence vs apply-unwired).
 */
import { applyAndValidateMutation } from '../tools/handlers/d1-shared/apply-graph-mutation.js';
import { D1HandlerError } from '../tools/handlers/d1-shared/errors.js';
import type { GraphV3T, NodeV3T, EdgeV3T } from '../../schemas/cee-v3.js';
import type { AddOptionProposal, RenameNodeProposal, ProposalBlocker } from './proposal-types.js';

export interface CandidateBuildResult {
  readonly candidate?: Record<string, unknown>;
  readonly error?: ProposalBlocker;
}

function toBlocker(err: unknown): ProposalBlocker {
  if (err instanceof D1HandlerError) return { code: err.code, message: err.message };
  return {
    code: 'CANDIDATE_BUILD_FAILED',
    message: err instanceof Error ? err.message : 'candidate construction failed',
  };
}

const DEFAULT_STRENGTH = { mean: 0.5, std: 0.1 } as const;

/**
 * Deep-clone the mutated graph before exposing it. The V5 helper shallow-copies
 * undeclared top-level fields (e.g. `options`, `meta`), so the returned candidate
 * would otherwise alias those arrays from the input; structuredClone makes it
 * fully referentially separate (and handles BigInt etc.).
 */
function exposeCandidate(mutatedGraph: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(mutatedGraph);
}

/** Build a valid EdgeV3T, defaulting strength/direction so GraphV3 parse accepts it. */
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
  proposal: RenameNodeProposal,
): CandidateBuildResult {
  try {
    const { mutatedGraph } = applyAndValidateMutation(persistedGraph, (clone: GraphV3T) => {
      const node = clone.nodes.find((n) => n.id === proposal.node_id);
      if (!node) {
        throw new D1HandlerError('ENTITY_NOT_FOUND', `Node ${proposal.node_id} not found in graph.`);
      }
      const before = { label: node.label };
      node.label = proposal.new_label;
      return { before, after: { label: proposal.new_label } };
    });
    return { candidate: exposeCandidate(mutatedGraph) };
  } catch (err) {
    return { error: toBlocker(err) };
  }
}

export function buildAddOptionCandidate(
  persistedGraph: unknown,
  proposal: AddOptionProposal,
): CandidateBuildResult {
  try {
    const { mutatedGraph } = applyAndValidateMutation(persistedGraph, (clone: GraphV3T) => {
      const optionNode: NodeV3T = {
        id: proposal.option.id,
        kind: 'option',
        label: proposal.option.label,
        ...(proposal.option.interventions
          ? { interventions: { ...proposal.option.interventions } }
          : {}),
      };
      clone.nodes.push(optionNode);
      if (proposal.option.parent_decision_id) {
        clone.edges.push(makeEdge(proposal.option.parent_decision_id, proposal.option.id));
      }
      for (const e of proposal.option.edges) {
        clone.edges.push(makeEdge(proposal.option.id, e.to_factor_id, e.strength, e.effect_direction));
      }
      return { before: null, after: { option_id: proposal.option.id } };
    });
    return { candidate: exposeCandidate(mutatedGraph) };
  } catch (err) {
    return { error: toBlocker(err) };
  }
}

/**
 * Whether the graph carries a TOP-LEVEL options[] ARRAY. The add_option held-reason
 * discriminator, evaluated AFTER the malformed-options guard (so `options` is
 * array-or-absent here): an ARRAY (even empty) -> OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE
 * (the context-pack assembler prefers it via `graph.options ?? nodes` while
 * run-analysis reads option NODES, so the two views can diverge — e.g. options:[]
 * => context sees 0, run-analysis sees the option nodes); ABSENT -> both fall back
 * to nodes, so ADD_OPTION_APPLY_UNWIRED. A present-but-non-array `options` never
 * reaches here — it is held earlier as GRAPH_OPTIONS_MALFORMED.
 */
export function graphHasTopLevelOptions(graph: unknown): boolean {
  if (graph === null || typeof graph !== 'object') return false;
  return Array.isArray((graph as { options?: unknown }).options);
}

/**
 * Whether the graph's top-level `options` is PRESENT but NOT an array — a malformed
 * graph. The context-pack assembler retains a truthy non-array value (`graph.options
 * ?? nodes` does NOT fall back to nodes for a truthy value), so it is neither absent
 * nor safely unwired; the spine holds it as GRAPH_OPTIONS_MALFORMED rather than
 * mis-classifying it as ADD_OPTION_APPLY_UNWIRED.
 */
export function graphOptionsAreMalformed(graph: unknown): boolean {
  if (graph === null || typeof graph !== 'object') return false;
  const options = (graph as { options?: unknown }).options;
  return options !== null && options !== undefined && !Array.isArray(options);
}

/**
 * Whether a node with `nodeId` already exists in the graph. Used to reject an
 * add_option whose id collides with an existing node (the structural validator
 * does NOT dedupe node ids, so a collision would otherwise produce a duplicate).
 */
export function graphHasNodeId(graph: unknown, nodeId: string): boolean {
  if (graph === null || typeof graph !== 'object') return false;
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.some(
    (n) => n !== null && typeof n === 'object' && (n as { id?: unknown }).id === nodeId,
  );
}
