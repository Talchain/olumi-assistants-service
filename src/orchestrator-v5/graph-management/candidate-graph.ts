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
 *    options[] from the base verbatim. `optionPresentInModelState` makes that
 *    measurable so the spine can HELD-classify honestly.
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
    // Deep-clone before exposing: the V5 helper shallow-copies undeclared
    // top-level fields (e.g. `options`, `meta`), so the returned candidate would
    // otherwise alias those arrays from the input. Cloning makes the candidate
    // fully referentially separate (structuredClone handles BigInt etc.).
    return { candidate: structuredClone(mutatedGraph) };
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
        const decisionEdge: EdgeV3T = {
          from: proposal.option.parent_decision_id,
          to: proposal.option.id,
          strength: { ...DEFAULT_STRENGTH },
          exists_probability: 0.9,
          effect_direction: 'positive',
        };
        clone.edges.push(decisionEdge);
      }
      for (const e of proposal.option.edges) {
        const edge: EdgeV3T = {
          from: proposal.option.id,
          to: e.to_factor_id,
          strength: e.strength ? { ...e.strength } : { ...DEFAULT_STRENGTH },
          exists_probability: 0.9,
          effect_direction: e.effect_direction ?? 'positive',
        };
        clone.edges.push(edge);
      }
      return { before: null, after: { option_id: proposal.option.id } };
    });
    // Deep-clone before exposing: the V5 helper shallow-copies undeclared
    // top-level fields (e.g. `options`, `meta`), so the returned candidate would
    // otherwise alias those arrays from the input. Cloning makes the candidate
    // fully referentially separate (structuredClone handles BigInt etc.).
    return { candidate: structuredClone(mutatedGraph) };
  } catch (err) {
    return { error: toBlocker(err) };
  }
}

/**
 * Whether the graph carries a TOP-LEVEL options[] array. This is the add_option
 * held-reason discriminator: with a top-level options[] present, applying a new
 * option diverges it (kept base-only by the merge, preferred by the context-pack
 * assembler) from the node-derived set -> OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE.
 * Absent -> both consumers fall back to nodes, so there is no divergence and the
 * hold is ADD_OPTION_APPLY_UNWIRED.
 */
export function graphHasTopLevelOptions(graph: unknown): boolean {
  return (
    graph !== null &&
    typeof graph === 'object' &&
    Array.isArray((graph as { options?: unknown }).options)
  );
}

/**
 * Whether `optionId` is already a member of the TOP-LEVEL options[] array. Used to
 * avoid a false divergence claim: if the new id is ALREADY in options[] (e.g. a
 * phantom options[] entry with no node), adding the node CONVERGES the two views
 * rather than diverging them — so that case is ADD_OPTION_APPLY_UNWIRED, not
 * OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE.
 */
export function topLevelOptionsContainsId(graph: unknown, optionId: string): boolean {
  if (graph === null || typeof graph !== 'object') return false;
  const options = (graph as { options?: unknown }).options;
  if (!Array.isArray(options)) return false;
  return options.some(
    (o) => o !== null && typeof o === 'object' && (o as { id?: unknown }).id === optionId,
  );
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
