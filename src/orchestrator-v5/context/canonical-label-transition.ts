/** Read-only interpretation of one already committed model-version pair. */
import { isDeepStrictEqual } from 'node:util';

import { NodeKindV3 } from '../../schemas/cee-v3.js';
import { assertIngressGraphNumericBounds } from '../../validators/numeric-bounds.js';
import {
  GraphStateIngressSchema,
  type GraphStateIngress,
} from '../boundary/request-extensions.js';
import { compareVersionRecords } from '../model-management/compare.js';
import type { ModelVersionRecord } from '../model-management/types.js';
import type {
  CanonicalNodeLabelTransition,
  CommittedMutationTurnRef,
} from '../types/recent-mutation-transition.js';
import {
  computeGraphIdentityHash,
  computeVersionAnalysisAffectingHashRecord,
} from './graph-identity.js';

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function usableGraph(graph: unknown): graph is GraphStateIngress {
  const shape = GraphStateIngressSchema.safeParse(graph);
  return (
    shape.success &&
    shape.data.nodes.length > 0 &&
    shape.data.nodes.every(
      (node) => nonempty(node.id) && nonempty(node.label) && NodeKindV3.safeParse(node.kind).success,
    ) &&
    assertIngressGraphNumericBounds(graph).ok
  );
}

function supportedIdentity(version: ModelVersionRecord, graph: GraphStateIngress): boolean {
  const full = computeGraphIdentityHash(graph);
  const analysis = computeVersionAnalysisAffectingHashRecord(graph);
  return (
    full !== null &&
    analysis !== null &&
    version.graph_identity_hash === full.value &&
    version.analysis_affecting_hash === analysis.value &&
    version.hash_algorithm === full.algorithm &&
    version.identity_projection_version === full.projection_version &&
    version.identity_normaliser_version === full.normaliser_version &&
    version.graph_schema_version === full.graph_schema_version
  );
}

/**
 * The turn ref must come from the positively joined durable receipt/parent row.
 * This function cannot establish that database join itself. It checks the
 * version side of that join and returns historical labels only, never a current
 * value, numeric effect, scientific outcome or authorship claim.
 *
 * No returned label comes from summary prose or the formatted version diff.
 * Unsupported/legacy/malformed pairs fail weak without changing receipt-history
 * completeness. The caller retains the ordinary generic receipt in that case.
 */
export function deriveCanonicalNodeLabelTransition(
  ref: CommittedMutationTurnRef,
  child: ModelVersionRecord,
  parent: ModelVersionRecord,
): CanonicalNodeLabelTransition | null {
  try {
    if (
      !ref || !child || !parent ||
      !nonempty(ref.conversation_row_id) ||
      !nonempty(ref.source_turn_id) ||
      !nonempty(ref.scenario_id) ||
      !nonempty(ref.owner_user_id) ||
      !nonempty(ref.mutation_id) ||
      !nonempty(child.id) ||
      !nonempty(parent.id) ||
      child.id === parent.id ||
      child.scenario_id !== ref.scenario_id ||
      parent.scenario_id !== ref.scenario_id ||
      child.owner_user_id !== ref.owner_user_id ||
      parent.owner_user_id !== ref.owner_user_id ||
      child.source_turn_id !== ref.source_turn_id ||
      child.mutation_id !== ref.mutation_id ||
      child.creation_kind !== 'committed_mutation' ||
      child.parent_version_id !== parent.id ||
      !nonempty(child.root_version_id) ||
      child.root_version_id !== parent.root_version_id ||
      child.root_version_id === child.id ||
      parent.parent_version_id === child.id ||
      (parent.creation_kind === 'initial' &&
        (parent.parent_version_id !== null || parent.root_version_id !== parent.id)) ||
      !Number.isSafeInteger(parent.version_number) ||
      !Number.isSafeInteger(child.version_number) ||
      parent.version_number < 1 ||
      child.version_number <= parent.version_number ||
      !usableGraph(parent.graph) ||
      !usableGraph(child.graph)
    ) return null;

    // Reuse the existing canonical version comparison's strict identity and
    // reference validation (including duplicate nodes/edges/options). Its
    // human-facing before_display/after_display strings are never consumed.
    compareVersionRecords(parent, child);
    if (
      !supportedIdentity(parent, parent.graph) ||
      !supportedIdentity(child, child.graph)
    ) return null;

    const afterById = new Map(child.graph.nodes.map((node) => [node.id, node]));
    let changedId: string | null = null;
    let transition: CanonicalNodeLabelTransition | null = null;
    for (const before of parent.graph.nodes) {
      const after = afterById.get(before.id);
      if (!after || after.kind !== before.kind) return null;
      if (before.label === after.label) continue;
      if (transition !== null) return null;
      changedId = before.id;
      transition = {
        kind: 'node_label_changed',
        before_label: before.label,
        after_label: after.label,
      };
    }
    if (transition === null) return null;
    const afterLabel = transition.after_label;

    // A full raw-structure comparison is deliberately stricter than the graph
    // identity projection, which excludes transient UI fields and sorts arrays.
    // Even an extra value/unit/metadata/presentation change with the same hash
    // regime cannot acquire the label-only licence.
    const expectedAfter = {
      ...parent.graph,
      nodes: parent.graph.nodes.map((node) =>
        node.id === changedId ? { ...node, label: afterLabel } : node,
      ),
    };
    if (!isDeepStrictEqual(child.graph, expectedAfter)) return null;
    return Object.freeze(transition);
  } catch {
    return null;
  }
}
