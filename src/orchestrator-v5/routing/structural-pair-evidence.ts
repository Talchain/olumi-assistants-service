/**
 * Deterministic evidence for an explicit two-element Living Model question.
 *
 * The frontier router classifies the question with a typed `structure_query`.
 * This module then joins those ids to exactly two unambiguous canonical
 * references in the current message and reads only the one graph snapshot that
 * already feeds ContextPack. Intent comes from the model; facts come from the
 * canonical graph. Neither can substitute for the other.
 */

import type {
  ContextPackFocus,
  ContextPackGraph,
} from '../context/context-pack-assembler.js';
import type { GraphContextStatus } from '../context/context-graph-snapshot.js';
import type { StructureQuery } from './types.js';
import type { GroundedSelection } from '../context/grounded-selection.js';
import { isLegalStructuralEdge } from '../../cee/utils/structural-edge-classifier.js';
import {
  formatGraphForContext,
  type DisplaySafeEdge,
  type DisplaySafeNode,
} from '../format/format-graph-for-context.js';
import {
  buildGraphNodeLookupFromGraph,
  buildLabelIndex,
  resolveLabelToId,
  resolveTypedCanonicalProseEntityRefs,
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

/**
 * Canonical direct-dependency evidence for one identified Living Model item.
 *
 * This is intentionally separate from {@link StructuralPairEvidence}: a
 * question establishes its subject by canonical canvas identity or an exact
 * current-message reference corroborating the typed canonical id,
 * and its predicate through a separately typed `dependencies` query,
 * while the pair carrier establishes two subjects from current-message prose.
 * Neither identity warrant may substitute for the other.
 */
export type SelectedDependenciesEvidence =
  | {
      readonly status: 'ambiguous';
      /**
       * Set iff this turn carried exactly one RESOLVED selected element
       * (`focus.elements.length === 1 && focus.unresolved === 'none'`).
       *
       * The consumer's ambiguity notice asks the user to "name or select one
       * element and ask again". That instruction's truth condition is FALSE
       * here — the user has already done it, and the ambiguity is in the typed
       * query or in the saved model, not in their gesture. The mark exists so
       * the copy can state something true; it never relaxes a verdict.
       */
      readonly subject_selection?: 'single_resolved';
    }
  | {
      readonly status: 'coverage_unavailable';
      readonly reason: 'graph_coverage_unavailable' | 'structural_semantics_unlicensed';
    }
  | {
      readonly status: 'resolved';
      readonly selected_label: string;
      readonly dependencies: readonly StructuralPairRelationship[];
      readonly bidirected: readonly StructuralPairRelationship[];
    };

/**
 * Canonical direct OUTGOING-INFLUENCE evidence for one identified Living Model
 * item — what the item directly drives, not what drives it.
 *
 * ⭐⭐ WHY THIS IS A SEPARATE TYPE AND NOT A FIELD ON
 * {@link SelectedDependenciesEvidence}. "Why does X matter?" and "what does X
 * depend on?" are two questions, and the estate's characteristic defect is two
 * questions living under one name until a reader inherits the wrong one. The
 * incoming-only reading of the dependencies carrier is load-bearing: it is what
 * makes an invented option-to-factor dependency unrepresentable (#1229). A
 * direction parameter on that carrier would hand every existing reader a
 * meaning it was never written for, silently.
 *
 * The payload key is `influences` rather than `dependencies` on purpose: a
 * consumer that reads the wrong one does not compile, so a direction inversion
 * cannot be reached by a plausible-looking edit.
 */
export type SelectedOutgoingInfluenceEvidence =
  | {
      readonly status: 'ambiguous';
      /** Same meaning as the dependencies carrier's mark: exactly one resolved selected element. */
      readonly subject_selection?: 'single_resolved';
    }
  | {
      readonly status: 'coverage_unavailable';
      readonly reason: 'graph_coverage_unavailable' | 'structural_semantics_unlicensed';
    }
  | {
      readonly status: 'resolved';
      readonly selected_label: string;
      /** Complete direct, directed connectors FROM the selected element. */
      readonly influences: readonly StructuralPairRelationship[];
      readonly bidirected: readonly StructuralPairRelationship[];
    };

export interface BuildStructuralPairEvidenceOptions {
  readonly messageText: string;
  readonly structureQuery: StructureQuery | undefined;
  readonly graphContextStatus: GraphContextStatus | undefined;
  readonly graphAuthority: StructuralGraphAuthority;
  readonly graphWasTrimmed: boolean;
}

export interface BuildSelectedDependenciesEvidenceOptions {
  /** Required for named references; omitted legacy callers remain selection-only. */
  readonly messageText?: string;
  readonly structureQuery: StructureQuery | undefined;
  /**
   * The original ingress selection, before node-only focus projection. A mixed
   * node/edge gesture must not masquerade as a single selected node merely
   * because edge references are intentionally absent from ContextPack focus.
   */
  readonly requestedSelection:
    | {
        readonly node_ids: readonly string[];
        readonly edge_ids: readonly string[];
      }
    | null
    | undefined;
  readonly focus: ContextPackFocus | undefined;
  readonly groundedSelection: GroundedSelection | null;
  readonly proposalEntity:
    | {
        readonly id: string;
        readonly label?: string;
        readonly resolution_status: string;
      }
    | undefined;
  readonly graphContextStatus: GraphContextStatus | undefined;
  readonly graphAuthority: StructuralGraphAuthority;
  readonly graphWasTrimmed: boolean;
}

const SELECTED_DEPENDENCIES_MAX_RELATIONSHIPS = 24;

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

/**
 * An ambiguous verdict, carrying whether the turn had one resolved selected
 * element. Every ambiguous return inside {@link buildSelectedDependenciesEvidence}
 * goes through here; a source-derived test asserts that, so a return site added
 * later cannot silently reintroduce the false notice.
 */
function ambiguousForTurn(
  options: BuildSelectedDependenciesEvidenceOptions,
): SelectedElementEdgeEvidence {
  return options.focus !== undefined &&
    options.focus.elements.length === 1 &&
    options.focus.unresolved === 'none'
    ? { status: 'ambiguous', subject_selection: 'single_resolved' }
    : { status: 'ambiguous' };
}

/**
 * The direction of the connectors a selected-element structural answer may
 * report. `incoming` is the `dependencies` question ("what feeds into X?");
 * `outgoing` is the influence question ("what does X drive?").
 *
 * ⚠ This is a PRIVATE parameter of the shared identity/coverage core below. It
 * is deliberately NOT reachable from the wire: each public builder fixes its own
 * direction from its own `structure_query.kind`, so no caller can flip one.
 */
type SelectedEdgeDirection = 'incoming' | 'outgoing';

/**
 * The shape both public builders return, before each names its directed set.
 * Kept internal so neither public payload can be handed to the other's consumer.
 */
type SelectedElementEdgeEvidence =
  | { readonly status: 'ambiguous'; readonly subject_selection?: 'single_resolved' }
  | {
      readonly status: 'coverage_unavailable';
      readonly reason: 'graph_coverage_unavailable' | 'structural_semantics_unlicensed';
    }
  | {
      readonly status: 'resolved';
      readonly selected_label: string;
      readonly directed: readonly StructuralPairRelationship[];
      readonly bidirected: readonly StructuralPairRelationship[];
    };

/**
 * Shared identity, coverage and licensing core for a one-element structural
 * question. Every gate here is direction-INDEPENDENT — who the subject is, and
 * whether canonical coverage licenses any claim at all, does not change with the
 * direction asked. Only the two edge filters at the bottom read `direction`.
 *
 * ⭐ Extracted rather than copied. A second hand-maintained copy of ~90 lines of
 * identity gates is the estate's dominant defect class: the copies drift, and
 * the drift reads as green. The cost of sharing is that ONE flipped argument
 * could invert both answers — so the direction binding is proved by a
 * discriminating mutant pair (loosen for all → both RED; loosen one direction
 * only → only that direction's suite REDs), not asserted.
 */
function buildSelectedElementEdgeEvidence(
  graph: ContextPackGraph,
  options: BuildSelectedDependenciesEvidenceOptions,
  direction: SelectedEdgeDirection,
): SelectedElementEdgeEvidence {
  const selectedIds = options.groundedSelection?.element_ids ?? [];
  const requestedNodeIds = options.requestedSelection?.node_ids ?? [];
  const requestedEdgeIds = options.requestedSelection?.edge_ids ?? [];
  const hasSelection = requestedNodeIds.length > 0 || requestedEdgeIds.length > 0 ||
    options.focus !== undefined || selectedIds.length > 0 ||
    (options.groundedSelection != null && options.groundedSelection.unresolved !== 'none');
  const query = options.structureQuery;
  if (query === undefined || !('element_id' in query)) return ambiguousForTurn(options);
  const selectedId = query.element_id;
  if (
    options.proposalEntity?.resolution_status !== 'resolved' ||
    options.proposalEntity.id !== selectedId
  ) {
    return ambiguousForTurn(options);
  }
  if (hasSelection && (
    requestedNodeIds.length !== 1 ||
    requestedEdgeIds.length !== 0 ||
    requestedNodeIds[0] !== selectedId ||
    options.focus === undefined ||
    options.focus.elements.length !== 1 ||
    options.focus.requested_count !== 1 ||
    options.focus.unresolved_count !== 0 ||
    options.focus.unresolved !== 'none' ||
    options.focus.elements_omitted !== undefined ||
    selectedIds.length !== 1 ||
    options.groundedSelection?.unresolved !== 'none' ||
    options.focus.elements[0]?.id !== selectedIds[0] ||
    options.proposalEntity?.resolution_status !== 'resolved' ||
    options.proposalEntity.id !== selectedIds[0] ||
    selectedId !== selectedIds[0]
  )) {
    return ambiguousForTurn(options);
  }

  if (
    options.graphContextStatus !== 'canonical' ||
    options.graphAuthority !== 'canonical_strict' ||
    options.graphWasTrimmed
  ) {
    return { status: 'coverage_unavailable', reason: 'graph_coverage_unavailable' };
  }

  const displayGraph = formatGraphForContext(graph);
  const idCounts = countNodeIds(displayGraph.nodes);
  // Only the named path uses the whole lookup to corroborate its typed id.
  // The selected path retains its scoped endpoint checks below: an unrelated
  // duplicate must not invalidate an otherwise unambiguous selected item.
  if (!hasSelection && [...idCounts.values()].some((count) => count !== 1)) {
    return ambiguousForTurn(options);
  }
  const selectedNodes = displayGraph.nodes.filter((node) => node.id === selectedId);
  if (selectedNodes.length !== 1 || idCounts.get(selectedId) !== 1) {
    return ambiguousForTurn(options);
  }
  const selectedNode = selectedNodes[0]!;

  // A repeated visible label makes relationship prose ambiguous even when the
  // selected id itself is unique. Require every endpoint we may render to map
  // back to its one canonical id.
  const lookup = buildGraphNodeLookupFromGraph(displayGraph);
  const labelIndex = buildLabelIndex(lookup);
  if (resolveLabelToId(labelIndex, selectedNode.label) !== selectedId) {
    return ambiguousForTurn(options);
  }

  if (!hasSelection) {
    // Existence of the model-proposed id does not corroborate a user reference.
    // Reuse the pair-query identity check: precisely this canonical id must be
    // named, with no duplicate labels or extra references. Intent remains the
    // router's typed query, not a classification made from these mentions.
    const named = resolveTypedCanonicalProseEntityRefs(
      lookup, labelIndex, options.messageText ?? '', [selectedId],
      { rejectOtherGenericReferences: true },
    );
    if (named?.length !== 1 || named[0]?.id !== selectedId) {
      return ambiguousForTurn(options);
    }
  }

  // ⭐ THE ONLY DIRECTION-DEPENDENT READ IN THE WHOLE FUNCTION.
  // `incoming` keeps `dependencies` exactly as it was: directed connectors whose
  // TO endpoint is the selected element. `outgoing` reads the FROM endpoint, and
  // is reachable only from `kind: 'outgoing_influence'`. Bidirected connectors
  // touch the element in neither direction and are carried by both, separately,
  // because a bidirected association establishes no direction at all.
  const relevantEdges = displayGraph.edges.filter(
    (edge) =>
      (edge.edge_type === 'bidirected' &&
        (edge.from === selectedId || edge.to === selectedId)) ||
      (edge.edge_type !== 'bidirected' &&
        (direction === 'incoming' ? edge.to === selectedId : edge.from === selectedId)),
  );
  const kindById = new Map(displayGraph.nodes.map((node) => [node.id, node.kind]));
  // decision→option and option→factor connectors encode model structure, not
  // causal influence. The display formatter intentionally carries them for
  // topology, but its generic relationship phrase is not a licence to call
  // them dependencies or describe a causal magnitude. Until a dedicated
  // provenance-bearing structural answer exists, fail weak for the whole
  // selected-item answer rather than silently mixing semantics. The rule is
  // direction-independent: an option→factor connector is structural whether it
  // is read forwards or backwards.
  if (relevantEdges.some((edge) =>
    isLegalStructuralEdge(kindById.get(edge.from), kindById.get(edge.to)))) {
    return { status: 'coverage_unavailable', reason: 'structural_semantics_unlicensed' };
  }
  for (const edge of relevantEdges) {
    if (
      edge.from === edge.to ||
      idCounts.get(edge.from) !== 1 ||
      idCounts.get(edge.to) !== 1 ||
      resolveLabelToId(labelIndex, edge.from_label) !== edge.from ||
      resolveLabelToId(labelIndex, edge.to_label) !== edge.to
    ) {
      return ambiguousForTurn(options);
    }
  }

  const relationships = uniqueRelationships(relevantEdges, 'canonical_strict');
  if (relationships === null) return ambiguousForTurn(options);
  if (relationships.length > SELECTED_DEPENDENCIES_MAX_RELATIONSHIPS) {
    return { status: 'coverage_unavailable', reason: 'graph_coverage_unavailable' };
  }

  return {
    status: 'resolved',
    selected_label: selectedNode.label,
    directed: publicRelationships(
      relationships.filter((relationship) =>
        relationship.edge_type === 'directed' &&
        (direction === 'incoming'
          ? relationship.to_id === selectedId
          : relationship.from_id === selectedId)),
    ),
    bidirected: publicRelationships(
      relationships.filter((relationship) => relationship.edge_type === 'bidirected'),
    ),
  };
}

/**
 * Return deterministic incoming-dependency evidence only when the typed query,
 * selected or current-message identity, validated proposal target and canonical
 * graph all identify the same one element. A named reference never creates a
 * canvas selection, and an unresolved/conflicting selection cannot be bypassed.
 *
 * A `general` structural answer remains free-form model prose because identity
 * answers "which item?", not "which question?". The distinct query avoids
 * replacing valid selected-item answers such as "why does this matter?" while
 * making an observed invented option-to-factor dependency unrepresentable.
 *
 * ⚠ INCOMING ONLY, AND THAT IS THE POINT. "Why does this matter?" is an
 * OUTGOING question and is answered by
 * {@link buildSelectedOutgoingInfluenceEvidence} under its own typed kind — NOT
 * by widening this one. Substituting an outgoing fact here would be a truthful
 * answer to a question nobody asked.
 */
export function buildSelectedDependenciesEvidence(
  graph: ContextPackGraph,
  options: BuildSelectedDependenciesEvidenceOptions,
): SelectedDependenciesEvidence | null {
  if (options.structureQuery?.kind !== 'dependencies') return null;
  const core = buildSelectedElementEdgeEvidence(graph, options, 'incoming');
  if (core.status !== 'resolved') return core;
  return {
    status: 'resolved',
    selected_label: core.selected_label,
    dependencies: core.directed,
    bidirected: core.bidirected,
  };
}

/**
 * Return deterministic direct OUTGOING-INFLUENCE evidence for one identified
 * element, under exactly the identity, coverage and licensing warrant the
 * dependencies carrier requires. Same subject rules; opposite predicate.
 *
 * ⭐ WHAT THIS DOES NOT DO, because the temptation is the whole defect here: it
 * does not rank the connectors it lists, does not walk one step further forward,
 * does not compose a pathway, and does not say which influence is "strongest".
 * "Why does X matter" invites exactly those, and each of them is the freedom
 * that let fluent prose invent structure. The answer is the complete direct
 * outgoing set, with its scope stated.
 */
export function buildSelectedOutgoingInfluenceEvidence(
  graph: ContextPackGraph,
  options: BuildSelectedDependenciesEvidenceOptions,
): SelectedOutgoingInfluenceEvidence | null {
  if (options.structureQuery?.kind !== 'outgoing_influence') return null;
  const core = buildSelectedElementEdgeEvidence(graph, options, 'outgoing');
  if (core.status !== 'resolved') return core;
  return {
    status: 'resolved',
    selected_label: core.selected_label,
    influences: core.directed,
    bidirected: core.bidirected,
  };
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
  if (options.structureQuery.kind === 'dependencies') return null;
  // The one-element carriers own both selected-element predicates. Naming the
  // new kind explicitly (rather than letting it fall through) keeps this
  // function's rejection list a statement about QUESTIONS, not a side effect of
  // which fields happen to be present.
  if (options.structureQuery.kind === 'outgoing_influence') return null;

  const displayGraph = formatGraphForContext(graph);
  const lookup = buildGraphNodeLookupFromGraph(displayGraph);
  const labelIndex = buildLabelIndex(lookup);
  const queryIds = options.structureQuery.kind === 'direct_relationship'
    ? options.structureQuery.element_ids
    : [options.structureQuery.source_element_id, options.structureQuery.target_element_id] as const;
  // A bare word such as "Cost" is too weak to establish identity in ordinary
  // prose. Here the frontier router has already supplied a typed pair of
  // canonical ids, so exact bounded label equality may corroborate those ids.
  // The shared typed resolver still rejects duplicate labels, extra references
  // and any id mismatch; this does not create label-only authority.
  const refs = resolveTypedCanonicalProseEntityRefs(
    lookup,
    labelIndex,
    options.messageText,
    queryIds,
  )?.filter((ref) => ref.kind !== 'edge');
  if (refs === undefined || refs === null || refs.length !== 2) return { status: 'ambiguous' };

  const [firstRef, secondRef] = refs;
  if (firstRef === undefined || secondRef === undefined || firstRef.id === secondRef.id) {
    return { status: 'ambiguous' };
  }

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
