/**
 * Narrow read-only views threaded into HandlerInvocation for the deterministic
 * fallback path of explanation handlers.
 *
 * F.6 invariant: format only. Sort and slice existing context-pack data; do
 * NOT derive new metrics, calculate new margins, or synthesise causality.
 *
 * Two views:
 *
 *  - `AnalysisProjectionSummary` — slim view of `ContextPackAnalysis`,
 *    consumed by `explain_results` and `what_would_flip` fallbacks.
 *  - `StructureProjectionSummary` — slim view derived from the V5
 *    `ContextPackGraph` (whose nodes/edges are statically typed as
 *    `unknown[]` but at runtime are CompactNode/CompactEdge per
 *    `projectCompactGraph` in context-pack-assembler.ts). Consumed by
 *    `explain_from_structure` fallback. The runtime check `isMinimalNode`
 *    / `isMinimalEdge` defends against shape drift in case the assembler's
 *    upstream graph format ever changes.
 */

import type { ContextPackAnalysis, ContextPackGraph } from './context-pack-assembler.js';
import { isRenderableValidationEdge } from '../coaching/validation-priority.js';
import {
  AMBIGUOUS_LABEL,
  buildGraphNodeLookupFromGraph,
  buildLabelIndex,
  hasAmbiguousProseEntityReference,
  resolveProseEntityRefs,
} from '../compose/phase3-blocks.js';

const STRUCTURE_LINK_CAP = 3;
const NAMED_FACTOR_LINK_CAP = 4;

export interface AnalysisProjectionOption {
  readonly label: string;
  readonly probability: number;
}

export interface AnalysisProjectionDriver {
  readonly factor_label: string;
  readonly sensitivity_value: number;
}

export interface AnalysisProjectionFragileEdge {
  readonly from_label: string;
  readonly to_label: string;
}

export interface AnalysisProjectionSummary {
  readonly status: string;
  readonly leading_option: AnalysisProjectionOption | null;
  readonly runner_up: AnalysisProjectionOption | null;
  readonly margin_pp: number | null;
  readonly robustness_band: string | null;
  readonly top_drivers: readonly AnalysisProjectionDriver[];
  /**
   * Structured fragile-edge labels carried through from
   * `ContextPackAnalysis.fragile_edges`, pre-filtered to renderable entries
   * (both endpoint labels non-empty, shared predicate with the advice gate).
   * Read by the `explain_results` handler's "what to validate" beat
   * (V5-LANE-B-STRUCTURAL-01). Optional so pre-existing literal fixtures
   * stay valid; absent and empty are equivalent (no link rung).
   * F.6: pass-through labels only — no derivation.
   */
  readonly fragile_edges?: readonly AnalysisProjectionFragileEdge[];
  // V5 state-trust: `staleness_reason` removed. Freshness is now a
  // deterministic four-state verdict on TurnOutcome / analysis_ready.
  // The handler-facing projection no longer carries the legacy reason
  // string — the only consumer was applyStalenessPrefix, which is no
  // longer called from explain_results / what_would_flip.
}

export interface StructureLink {
  readonly label_from: string;
  readonly label_to: string;
  readonly edge_type: 'directed' | 'bidirected';
  /** Omitted whenever strict canonical relationship detail is unavailable. */
  readonly strength?: number;
  readonly plain_interpretation?: string;
}

export interface StructureProjectionSummary {
  readonly relationship_detail_status: 'canonical_strict' | 'unavailable';
  readonly goal_label: string | null;
  readonly top_causal_links: readonly StructureLink[];
  /** Populated when the user message mentioned a factor by label. */
  readonly named_factor_label?: string;
  /** A current-message factor reference could not be joined to one identity. */
  readonly named_factor_ambiguous?: true;
  readonly named_factor_pathways: readonly StructureLink[];
  readonly factor_count: number;
  readonly option_count: number;
}

export function buildAnalysisProjectionSummary(
  analysis: ContextPackAnalysis | null,
): AnalysisProjectionSummary | null {
  if (!analysis) return null;
  return {
    status: analysis.status,
    leading_option: analysis.leading_option,
    runner_up: analysis.runner_up,
    margin_pp: analysis.margin_pp,
    robustness_band: analysis.robustness_band,
    top_drivers: analysis.top_drivers,
    // `?. ?? []` mirrors the sibling `renderableFragileEdges` idiom in the
    // advice gate: the field is typed non-optional, but one call site
    // (chip-click-dispatch) hand-constructs the analysis object, so this
    // stays robust against a future producer that omits it rather than
    // throwing mid-projection.
    fragile_edges: analysis.fragile_edges?.filter(isRenderableValidationEdge) ?? [],
  };
}

interface MinimalNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

interface MinimalEdge {
  readonly from: string;
  readonly to: string;
  readonly strength: number;
  readonly edge_type?: 'bidirected';
  readonly plain_interpretation?: string;
}

function isMinimalNode(v: unknown): v is MinimalNode {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.kind === 'string' && typeof r.label === 'string';
}

function isMinimalEdge(v: unknown): v is MinimalEdge {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.from === 'string' && typeof r.to === 'string' && typeof r.strength === 'number';
}

export function buildStructureProjectionSummary(
  graph: ContextPackGraph,
  options: {
    messageText?: string;
    relationshipDetailStatus?: 'canonical_strict' | 'unavailable';
  } = {},
): StructureProjectionSummary {
  const nodes = graph.nodes.filter(isMinimalNode);
  const rawEdges = graph.edges.filter(isMinimalEdge);
  const requestedRelationshipDetailStatus =
    options.relationshipDetailStatus ?? 'unavailable';

  // Labels are the user-facing identity in this fallback. A duplicate node id
  // or duplicate normalised label therefore makes a total relationship claim
  // unsafe even when strict GraphV3 compaction succeeded.
  const nodeIdCounts = new Map<string, number>();
  for (const node of nodes) {
    nodeIdCounts.set(node.id, (nodeIdCounts.get(node.id) ?? 0) + 1);
  }
  const duplicateNodeId = [...nodeIdCounts.values()].some((count) => count > 1);
  const identityLookup = buildGraphNodeLookupFromGraph({ nodes, edges: rawEdges });
  const identityLabelIndex = buildLabelIndex(identityLookup);
  const duplicateNormalisedLabel = [...identityLabelIndex.values()].some(
    (value) => value === AMBIGUOUS_LABEL,
  );

  // Collapse exact connector twins. Conflicting semantic twins make ranking
  // unavailable. Directed identity preserves order; bidirected identity does
  // not, so reversing its endpoints cannot evade the conflict check.
  const edgeByTopology = new Map<string, MinimalEdge>();
  let conflictingEdgeIdentity = false;
  for (const edge of rawEdges) {
    const bidirected = edge.edge_type === 'bidirected';
    const [first, second] = bidirected
      ? [edge.from, edge.to].sort((a, b) => a.localeCompare(b))
      : [edge.from, edge.to];
    const key = `${bidirected ? 'bidirected' : 'directed'}\u0000${first}\u0000${second}`;
    const prior = edgeByTopology.get(key);
    if (prior === undefined) {
      edgeByTopology.set(key, edge);
      continue;
    }
    if (
      !Object.is(prior.strength, edge.strength) ||
      prior.plain_interpretation !== edge.plain_interpretation
    ) {
      conflictingEdgeIdentity = true;
    }
  }
  const nodeIdentityUnsafe = duplicateNodeId || duplicateNormalisedLabel;
  const edges = nodeIdentityUnsafe ? [] : [...edgeByTopology.values()];
  const relationshipDetailStatus =
    requestedRelationshipDetailStatus === 'canonical_strict' &&
    !nodeIdentityUnsafe &&
    !conflictingEdgeIdentity
      ? 'canonical_strict'
      : 'unavailable';
  const strictDetails = relationshipDetailStatus === 'canonical_strict';

  const labelById = new Map<string, string>();
  for (const node of nodes) labelById.set(node.id, node.label);

  const goalNode = nodes.find((n) => n.kind === 'goal') ?? null;

  const linksWithLabels: StructureLink[] = [];
  for (const edge of edges) {
    const labelFrom = labelById.get(edge.from);
    const labelTo = labelById.get(edge.to);
    if (!labelFrom || !labelTo) continue;
    linksWithLabels.push({
      label_from: labelFrom,
      label_to: labelTo,
      edge_type: edge.edge_type === 'bidirected' ? 'bidirected' : 'directed',
      ...(strictDetails ? { strength: edge.strength } : {}),
      ...(strictDetails && edge.plain_interpretation !== undefined
        ? { plain_interpretation: edge.plain_interpretation }
        : {}),
    });
  }

  const topCausalLinks = linksWithLabels
    .filter((link): link is StructureLink & { readonly strength: number } =>
      link.edge_type === 'directed' && link.strength !== undefined,
    )
    .slice()
    .sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength))
    .slice(0, STRUCTURE_LINK_CAP);

  let namedFactorLabel: string | undefined;
  let namedFactorAmbiguous = false;
  let namedFactorPathways: StructureLink[] = [];
  if (options.messageText) {
    const lookup = buildGraphNodeLookupFromGraph({ nodes, edges });
    const labelIndex = buildLabelIndex(lookup);
    namedFactorAmbiguous =
      duplicateNodeId ||
      hasAmbiguousProseEntityReference(labelIndex, options.messageText);
    const factorRefs = namedFactorAmbiguous
      ? []
      : resolveProseEntityRefs(lookup, labelIndex, options.messageText)
          .filter((ref) => nodes.find((node) => node.id === ref.id)?.kind === 'factor');
    if (factorRefs.length > 1) namedFactorAmbiguous = true;
    const namedNode = factorRefs.length === 1
      ? nodes.find((node) => node.id === factorRefs[0]?.id) ?? null
      : null;
    if (namedNode) {
      namedFactorLabel = namedNode.label;
      namedFactorPathways = edges
        .filter((e) => e.from === namedNode.id || e.to === namedNode.id)
        .map((e): StructureLink | null => {
          const labelFrom = labelById.get(e.from);
          const labelTo = labelById.get(e.to);
          if (!labelFrom || !labelTo) return null;
          return {
            label_from: labelFrom,
            label_to: labelTo,
            edge_type: e.edge_type === 'bidirected' ? 'bidirected' : 'directed',
            ...(strictDetails ? { strength: e.strength } : {}),
            ...(strictDetails && e.plain_interpretation !== undefined
              ? { plain_interpretation: e.plain_interpretation }
              : {}),
          };
        })
        .filter((l): l is StructureLink => l !== null)
        .sort((a, b) => {
          if (a.strength !== undefined && b.strength !== undefined) {
            const byMagnitude = Math.abs(b.strength) - Math.abs(a.strength);
            if (byMagnitude !== 0) return byMagnitude;
          }
          return [a.label_from, a.label_to, a.edge_type]
            .join('\u0000')
            .localeCompare([b.label_from, b.label_to, b.edge_type].join('\u0000'));
        })
        .slice(0, NAMED_FACTOR_LINK_CAP);
    }
  }

  return {
    relationship_detail_status: relationshipDetailStatus,
    goal_label: goalNode?.label ?? null,
    top_causal_links: topCausalLinks,
    ...(namedFactorLabel !== undefined ? { named_factor_label: namedFactorLabel } : {}),
    ...(namedFactorAmbiguous ? { named_factor_ambiguous: true as const } : {}),
    named_factor_pathways: namedFactorPathways,
    factor_count: nodes.filter((n) => n.kind === 'factor').length,
    option_count: nodes.filter((n) => n.kind === 'option').length,
  };
}
