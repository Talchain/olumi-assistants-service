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
import type { GraphV3T, NodeV3T, EdgeV3T } from '../../schemas/cee-v3.js';
import { CANDIDATE_BUILD_FAILED, type MutationReasonCode } from './reason-codes.js';
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

function toBlocker(err: unknown): MutationBlocker {
  if (err instanceof D1HandlerError) {
    // D1 error codes overlap the reason vocabulary where it matters
    // (GRAPH_INVARIANT_VIOLATED, ENTITY_NOT_FOUND); others map to a generic build failure.
    const code = (err.code as MutationReasonCode) ?? CANDIDATE_BUILD_FAILED;
    return { code, readable: err.message };
  }
  return {
    code: CANDIDATE_BUILD_FAILED,
    readable: err instanceof Error ? err.message : 'candidate construction failed',
  };
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

/** A node with `nodeId` already exists. → OPTION_ID_COLLISION for add_option. */
export function graphHasNodeId(graph: unknown, nodeId: string): boolean {
  if (graph === null || typeof graph !== 'object') return false;
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.some(
    (n) => n !== null && typeof n === 'object' && (n as { id?: unknown }).id === nodeId,
  );
}
