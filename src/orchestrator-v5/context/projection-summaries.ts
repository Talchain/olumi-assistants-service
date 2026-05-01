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

export interface AnalysisProjectionSummary {
  readonly status: string;
  readonly leading_option: AnalysisProjectionOption | null;
  readonly runner_up: AnalysisProjectionOption | null;
  readonly margin_pp: number | null;
  readonly robustness_band: string | null;
  readonly top_drivers: readonly AnalysisProjectionDriver[];
  // V5 state-trust: `staleness_reason` removed. Freshness is now a
  // deterministic four-state verdict on TurnOutcome / analysis_ready.
  // The handler-facing projection no longer carries the legacy reason
  // string — the only consumer was applyStalenessPrefix, which is no
  // longer called from explain_results / what_would_flip.
}

export interface StructureLink {
  readonly label_from: string;
  readonly label_to: string;
  readonly strength: number;
  readonly plain_interpretation?: string;
}

export interface StructureProjectionSummary {
  readonly goal_label: string | null;
  readonly top_causal_links: readonly StructureLink[];
  /** Populated when the user message mentioned a factor by label. */
  readonly named_factor_label?: string;
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
  options: { messageText?: string } = {},
): StructureProjectionSummary {
  const nodes = graph.nodes.filter(isMinimalNode);
  const edges = graph.edges.filter(isMinimalEdge);

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
      strength: edge.strength,
      ...(edge.plain_interpretation !== undefined
        ? { plain_interpretation: edge.plain_interpretation }
        : {}),
    });
  }

  const topCausalLinks = linksWithLabels
    .slice()
    .sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength))
    .slice(0, STRUCTURE_LINK_CAP);

  let namedFactorLabel: string | undefined;
  let namedFactorPathways: StructureLink[] = [];
  if (options.messageText) {
    const namedNode = findNamedFactor(options.messageText, nodes);
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
            strength: e.strength,
            ...(e.plain_interpretation !== undefined
              ? { plain_interpretation: e.plain_interpretation }
              : {}),
          };
        })
        .filter((l): l is StructureLink => l !== null)
        .sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength))
        .slice(0, NAMED_FACTOR_LINK_CAP);
    }
  }

  return {
    goal_label: goalNode?.label ?? null,
    top_causal_links: topCausalLinks,
    ...(namedFactorLabel !== undefined ? { named_factor_label: namedFactorLabel } : {}),
    named_factor_pathways: namedFactorPathways,
    factor_count: nodes.filter((n) => n.kind === 'factor').length,
    option_count: nodes.filter((n) => n.kind === 'option').length,
  };
}

/**
 * Substring-match the user message against factor node labels. Longer labels
 * first so "Engineering Capacity" wins over the substring "Capacity". Pure
 * mechanical match — no synthesis. Returns null on no match.
 */
function findNamedFactor(messageText: string, nodes: readonly MinimalNode[]): MinimalNode | null {
  const lower = messageText.toLowerCase();
  const factors = nodes
    .filter((n) => n.kind === 'factor')
    .slice()
    .sort((a, b) => b.label.length - a.label.length);
  for (const factor of factors) {
    if (lower.includes(factor.label.toLowerCase())) return factor;
  }
  return null;
}
