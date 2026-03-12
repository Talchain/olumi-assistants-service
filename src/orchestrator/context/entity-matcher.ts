/**
 * Entity-Aware Context Enrichment
 *
 * When a user's message references a specific graph entity by name, extract
 * a focused explanation-ready detail block. Zero overhead when no match found.
 *
 * Matching rules:
 * 1. Exact case-insensitive label match against node labels — highest priority.
 * 2. Substring match (4+ chars) only if it matches exactly one node — unambiguous.
 * 3. If multiple nodes match a substring, skip (ambiguous).
 * 4. Cap: max 2 entities per turn, max 3 edges per entity.
 */

import type { GraphV3Compact, CompactEdge } from "./graph-compact.js";
import type { ReferencedEntityDetail, ReferencedEntityEdgeSummary } from "../pipeline/types.js";

// ============================================================================
// Constants
// ============================================================================

const MAX_ENTITIES_PER_TURN = 2;
const MAX_EDGES_PER_ENTITY = 3;
const MIN_SUBSTRING_LENGTH = 4;

// ============================================================================
// Internal helpers
// ============================================================================

function normaliseLabel(label: string): string {
  return label.toLowerCase().trim();
}

/**
 * Build a ReferencedEntityDetail from a compact node and the graph's edge list.
 * Includes up to MAX_EDGES_PER_ENTITY directly connected edges (in or out).
 */
function buildEntityDetail(
  nodeId: string,
  graph: GraphV3Compact,
): ReferencedEntityDetail {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    // Should not happen — caller verified the node exists
    throw new Error(`Entity matcher: node ${nodeId} not found in graph`);
  }

  // Build label lookup for connected nodes
  const labelById = new Map(graph.nodes.map((n) => [n.id, n.label]));

  // Collect directly connected edges (outgoing + incoming)
  const connected: Array<{ edge: CompactEdge; connectedId: string }> = [];
  for (const edge of graph.edges) {
    if (edge.from === nodeId) {
      connected.push({ edge, connectedId: edge.to });
    } else if (edge.to === nodeId) {
      connected.push({ edge, connectedId: edge.from });
    }
  }

  // Sort by strength descending — most influential edges first
  connected.sort((a, b) => b.edge.strength - a.edge.strength);

  const edges: ReferencedEntityEdgeSummary[] = connected
    .slice(0, MAX_EDGES_PER_ENTITY)
    .map(({ edge, connectedId }) => ({
      connected_label: labelById.get(connectedId) ?? connectedId,
      strength: edge.strength,
      // effect_direction not stored in CompactEdge (dropped during compaction) — field omitted
    }));

  const detail: ReferencedEntityDetail = {
    id: node.id,
    label: node.label,
    kind: node.kind,
    edges,
  };

  // Optional fields — include only when present
  if (node.category) detail.category = node.category;
  if (node.value !== undefined) detail.value = node.value;
  if (node.raw_value !== undefined) detail.raw_value = node.raw_value;
  if (node.unit !== undefined) detail.unit = node.unit;
  if (node.cap !== undefined) detail.cap = node.cap;
  if (node.source !== undefined) detail.source = node.source;

  return detail;
}

// ============================================================================
// Main export
// ============================================================================

/**
 * Match entity references in a user message against the compact graph.
 *
 * Returns up to MAX_ENTITIES_PER_TURN matched entity detail blocks, or an
 * empty array when no confident match is found.
 *
 * Safe to call when graph is absent — returns [] immediately.
 */
export function matchReferencedEntities(
  userMessage: string,
  graph: GraphV3Compact | null | undefined,
): ReferencedEntityDetail[] {
  if (!graph || graph.nodes.length === 0 || !userMessage) return [];

  const normMessage = userMessage.toLowerCase();
  const matched = new Map<string, ReferencedEntityDetail>();

  for (const node of graph.nodes) {
    if (matched.size >= MAX_ENTITIES_PER_TURN) break;

    const normLabel = normaliseLabel(node.label);

    // 1. Exact match (case-insensitive)
    if (normMessage.includes(normLabel)) {
      if (!matched.has(node.id)) {
        matched.set(node.id, buildEntityDetail(node.id, graph));
      }
      continue;
    }

    // 2. Substring match — only if label is 4+ chars and matches exactly one node
    // (Already checking a single node here; the ambiguity check is across all nodes)
    // We collect substring candidates and check uniqueness after the loop.
    // → Handled in a second pass below.
  }

  // Second pass: substring matching for nodes not yet matched.
  //
  // A node qualifies via substring only if its normalised label (4+ chars) appears somewhere in
  // the message AND no other unmatched node's normalised label also appears in the message.
  // This is a global uniqueness check: if two distinct nodes both have labels present in the
  // message text, the match is ambiguous and both are skipped.
  if (matched.size < MAX_ENTITIES_PER_TURN) {
    // Collect every unmatched node whose label (4+ chars) appears in the message
    const substringHits: string[] = [];
    for (const node of graph.nodes) {
      if (matched.has(node.id)) continue;
      const normLabel = normaliseLabel(node.label);
      if (normLabel.length >= MIN_SUBSTRING_LENGTH && normMessage.includes(normLabel)) {
        substringHits.push(node.id);
      }
    }

    // Accept a hit only if it is the sole unmatched node whose label appears in the message.
    // If multiple nodes match → ambiguous → skip all of them.
    if (substringHits.length === 1) {
      const candidateId = substringHits[0];
      if (matched.size < MAX_ENTITIES_PER_TURN) {
        matched.set(candidateId, buildEntityDetail(candidateId, graph));
      }
    }
    // substringHits.length === 0: no substring match — nothing to add
    // substringHits.length > 1: ambiguous — skip all
  }

  return Array.from(matched.values());
}
