/**
 * Deterministic evidence for an explicit two-element Living Model question.
 *
 * The frontier router classifies the question with a typed `structure_query`.
 * This module then joins those ids to exactly two unambiguous canonical
 * references in the current message and reads only the one graph snapshot that
 * already feeds ContextPack. Intent comes from the model; facts come from the
 * canonical graph. Neither can substitute for the other.
 */

import type { ContextPackGraph } from '../context/context-pack-assembler.js';
import type { GraphContextStatus } from '../context/context-graph-snapshot.js';
import type { StructureQuery } from './types.js';
import {
  formatGraphForContext,
  type DisplaySafeEdge,
  type DisplaySafeNode,
} from '../format/format-graph-for-context.js';
import {
  buildGraphNodeLookupFromGraph,
  buildLabelIndex,
  hasAmbiguousProseEntityReference,
  resolveProseEntityRefs,
} from '../compose/phase3-blocks.js';

export type StructuralGraphAuthority =
  | 'canonical_strict'
  | 'canonical_structural_fallback'
  | 'unavailable';

export interface StructuralPairRelationship {
  readonly from_label: string;
  readonly to_label: string;
  readonly edge_type: 'directed' | 'bidirected';
  /** Present only when the exact canonical snapshot passed strict compaction. */
  readonly relationship?: string;
  readonly coefficient_confidence?: 'high' | 'moderate' | 'uncertain';
}

export type StructuralPairEvidence =
  | { readonly status: 'ambiguous' }
  | {
      readonly status: 'direct';
      readonly first_label: string;
      readonly second_label: string;
      /**
       * `complete` licenses pair-level negative facts such as "not reverse".
       * `presence_only` licenses only the retained connector endpoint/type.
       */
      readonly coverage: 'complete' | 'presence_only';
      readonly relationships: readonly StructuralPairRelationship[];
    }
  | {
      readonly status: 'no_direct';
      readonly first_label: string;
      readonly second_label: string;
    }
  | {
      readonly status: 'reachable';
      readonly source_label: string;
      readonly target_label: string;
    }
  | {
      readonly status: 'not_reachable';
      readonly source_label: string;
      readonly target_label: string;
    }
  | {
      readonly status: 'coverage_unavailable';
      readonly first_label: string;
      readonly second_label: string;
    };

export interface BuildStructuralPairEvidenceOptions {
  readonly messageText: string;
  readonly structureQuery: StructureQuery | undefined;
  readonly graphContextStatus: GraphContextStatus | undefined;
  readonly graphAuthority: StructuralGraphAuthority;
  readonly graphWasTrimmed: boolean;
}

interface RelationshipWithIds extends StructuralPairRelationship {
  readonly from_id: string;
  readonly to_id: string;
}

function countNodeIds(nodes: readonly DisplaySafeNode[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
  return counts;
}

function orderedPair(first: string, second: string): readonly [string, string] {
  return first.localeCompare(second) <= 0 ? [first, second] : [second, first];
}

function relationshipAuthorityKey(edge: RelationshipWithIds): string {
  if (edge.edge_type === 'bidirected') {
    const [first, second] = orderedPair(edge.from_id, edge.to_id);
    return ['bidirected', first, second].join('\u0000');
  }
  return ['directed', edge.from_id, edge.to_id].join('\u0000');
}

function relationshipSignature(edge: RelationshipWithIds): string {
  return [
    relationshipAuthorityKey(edge),
    edge.relationship ?? '',
    edge.coefficient_confidence ?? '',
  ].join('\u0000');
}

function projectRelationship(
  edge: DisplaySafeEdge,
  authority: StructuralGraphAuthority,
): RelationshipWithIds {
  const bidirected = edge.edge_type === 'bidirected';
  const shouldReverse = bidirected && edge.from.localeCompare(edge.to) > 0;
  return {
    from_id: shouldReverse ? edge.to : edge.from,
    to_id: shouldReverse ? edge.from : edge.to,
    from_label: shouldReverse ? edge.to_label : edge.from_label,
    to_label: shouldReverse ? edge.from_label : edge.to_label,
    edge_type: bidirected ? 'bidirected' : 'directed',
    ...(authority === 'canonical_strict'
      ? {
          relationship: edge.relationship,
          ...(edge.coefficient_confidence !== undefined
            ? { coefficient_confidence: edge.coefficient_confidence }
            : {}),
        }
      : {}),
  };
}

/** Dedupe exact edges and fail weak when one topology identity tells two stories. */
function uniqueRelationships(
  edges: readonly DisplaySafeEdge[],
  authority: StructuralGraphAuthority,
): readonly RelationshipWithIds[] | null {
  const exact = new Map<string, RelationshipWithIds>();
  const signaturesByAuthority = new Map<string, Set<string>>();
  for (const edge of edges) {
    const relationship = projectRelationship(edge, authority);
    const authorityKey = relationshipAuthorityKey(relationship);
    const signature = relationshipSignature(relationship);
    const signatures = signaturesByAuthority.get(authorityKey) ?? new Set<string>();
    signatures.add(signature);
    signaturesByAuthority.set(authorityKey, signatures);
    exact.set(signature, relationship);
  }
  if ([...signaturesByAuthority.values()].some((signatures) => signatures.size > 1)) {
    return null;
  }
  return [...exact.values()].sort((a, b) =>
    relationshipSignature(a).localeCompare(relationshipSignature(b)),
  );
}

function publicRelationships(
  relationships: readonly RelationshipWithIds[],
): readonly StructuralPairRelationship[] {
  return relationships.map(({ from_id: _from, to_id: _to, ...relationship }) => relationship);
}

function rawReaches(graph: ContextPackGraph, sourceId: string): readonly string[] | null {
  const candidates = graph.nodes.filter(
    (raw): raw is Record<string, unknown> =>
      typeof raw === 'object' && raw !== null && (raw as { id?: unknown }).id === sourceId,
  );
  if (candidates.length !== 1) return null;
  const source = candidates[0];
  if (source?.kind !== 'option') return null;
  if (!Array.isArray(source.reaches) || !source.reaches.every((entry) => typeof entry === 'string')) {
    return null;
  }
  return source.reaches;
}

/**
 * Return evidence only when model-typed intent and canonical current-message
 * identities agree. `null` preserves the open-ended explanation path.
 */
export function buildStructuralPairEvidence(
  graph: ContextPackGraph,
  options: BuildStructuralPairEvidenceOptions,
): StructuralPairEvidence | null {
  if (options.graphContextStatus !== 'canonical') return null;
  if (options.graphAuthority === 'unavailable') return null;
  if (options.structureQuery === undefined) return null;
  if (options.structureQuery.kind === 'general') return null;

  const displayGraph = formatGraphForContext(graph);
  const lookup = buildGraphNodeLookupFromGraph(displayGraph);
  const labelIndex = buildLabelIndex(lookup);
  if (hasAmbiguousProseEntityReference(labelIndex, options.messageText)) {
    return { status: 'ambiguous' };
  }

  const refs = resolveProseEntityRefs(lookup, labelIndex, options.messageText)
    .filter((ref) => ref.kind !== 'edge');
  if (refs.length !== 2) return { status: 'ambiguous' };

  const [firstRef, secondRef] = refs;
  if (firstRef === undefined || secondRef === undefined || firstRef.id === secondRef.id) {
    return { status: 'ambiguous' };
  }

  const queryIds = options.structureQuery.kind === 'direct_relationship'
    ? options.structureQuery.element_ids
    : [options.structureQuery.source_element_id, options.structureQuery.target_element_id] as const;
  const [firstId, secondId] = queryIds;
  if (
    firstId === secondId ||
    new Set([firstRef.id, secondRef.id]).size !== 2 ||
    ![firstRef.id, secondRef.id].includes(firstId) ||
    ![firstRef.id, secondRef.id].includes(secondId)
  ) {
    return { status: 'ambiguous' };
  }

  const idCounts = countNodeIds(displayGraph.nodes);
  if (idCounts.get(firstId) !== 1 || idCounts.get(secondId) !== 1) {
    return { status: 'ambiguous' };
  }

  const firstNode = displayGraph.nodes.find((node) => node.id === firstId);
  const secondNode = displayGraph.nodes.find((node) => node.id === secondId);
  if (firstNode === undefined || secondNode === undefined) {
    return { status: 'ambiguous' };
  }

  if (options.structureQuery.kind === 'reachability') {
    const query = options.structureQuery;
    if (options.graphAuthority !== 'canonical_strict' || options.graphWasTrimmed) {
      return {
        status: 'coverage_unavailable',
        first_label: firstNode.label,
        second_label: secondNode.label,
      };
    }
    const reaches = rawReaches(graph, query.source_element_id);
    const target = displayGraph.nodes.find(
      (node) => node.id === query.target_element_id,
    );
    const source = displayGraph.nodes.find(
      (node) => node.id === query.source_element_id,
    );
    if (reaches === null || source === undefined || target === undefined) {
      return { status: 'ambiguous' };
    }
    return reaches.includes(target.id)
      ? { status: 'reachable', source_label: source.label, target_label: target.label }
      : { status: 'not_reachable', source_label: source.label, target_label: target.label };
  }

  const directEdges = displayGraph.edges.filter(
    (edge) =>
      (edge.from === firstNode.id && edge.to === secondNode.id) ||
      (edge.from === secondNode.id && edge.to === firstNode.id),
  );
  const relationships = uniqueRelationships(directEdges, options.graphAuthority);
  if (relationships === null) return { status: 'ambiguous' };
  if (relationships.length > 0) {
    const complete = options.graphAuthority === 'canonical_strict' && !options.graphWasTrimmed;
    return {
      status: 'direct',
      first_label: firstNode.label,
      second_label: secondNode.label,
      coverage: complete ? 'complete' : 'presence_only',
      relationships: publicRelationships(relationships),
    };
  }

  if (options.graphWasTrimmed || options.graphAuthority !== 'canonical_strict') {
    return {
      status: 'coverage_unavailable',
      first_label: firstNode.label,
      second_label: secondNode.label,
    };
  }
  return {
    status: 'no_direct',
    first_label: firstNode.label,
    second_label: secondNode.label,
  };
}
