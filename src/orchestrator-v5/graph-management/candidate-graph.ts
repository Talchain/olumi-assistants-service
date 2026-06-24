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
    return { candidate: mutatedGraph };
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
    return { candidate: mutatedGraph };
  } catch (err) {
    return { error: toBlocker(err) };
  }
}

/**
 * Whether `optionId` is a member of the candidate's TOP-LEVEL options[] array.
 * The persist-base merge keeps options[] base-only, so a genuinely-new option is
 * absent here even though it survives as a node and is analysable by run-analysis
 * (which reads option nodes). That absence — against a graph carrying top-level
 * options[] preferred by the context-pack assembler — is the divergence
 * add_option is held on.
 */
export function optionPresentInModelState(
  candidate: Record<string, unknown>,
  optionId: string,
): boolean {
  const options = candidate.options;
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
