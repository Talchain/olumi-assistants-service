/**
 * Patch Lint (v1.4.0 - PR D)
 *
 * Validates graph patches for common structural issues:
 * - Duplicate additions (adding nodes/edges that already exist)
 * - Invalid updates (referencing non-existent elements)
 * - Invalid removals (referencing non-existent elements)
 * - Edge validity (from/to nodes exist in graph or patch adds)
 * - Provenance requirements
 *
 * Used by critique endpoint to provide patch-specific feedback.
 */

import type { GraphT, NodeT, EdgeT } from "../schemas/graph.js";

export type PatchT = {
  adds: {
    nodes: NodeT[];
    edges: EdgeT[];
  };
  updates: Array<{ id: string; [key: string]: unknown }>;
  removes: string[];
};

export type PatchIssue = {
  level: "BLOCKER" | "IMPROVEMENT" | "OBSERVATION";
  note: string;
  target?: string;
};

/**
 * Lint a patch against a base graph.
 * Returns array of issues found (empty if patch is clean).
 */
export function lintPatch(graph: GraphT, patch: PatchT): PatchIssue[] {
  const issues: PatchIssue[] = [];

  // Build ID sets for existing nodes and edges
  const existingNodeIds = new Set(graph.nodes.map(n => n.id));
  const existingEdgeIds = new Set(
    graph.edges.map(e => `${e.from}→${e.to}`)
  );

  // Validate adds.nodes - check for duplicates
  const addedNodeIds = new Set<string>();
  for (const node of patch.adds.nodes) {
    if (existingNodeIds.has(node.id)) {
      issues.push({
        level: "BLOCKER",
        note: `Node '${node.id}' already exists in graph`,
        target: node.id,
      });
    }

    if (addedNodeIds.has(node.id)) {
      issues.push({
        level: "BLOCKER",
        note: `Duplicate node '${node.id}' in patch adds`,
        target: node.id,
      });
    }

    addedNodeIds.add(node.id);

    // Check provenance requirement (v04 spec)
    const prov = (node as unknown as { provenance?: string | unknown[] }).provenance;
    const hasProvenance = prov && (
      typeof prov === "string" ||
      (Array.isArray(prov) && prov.length > 0)
    );

    if (!hasProvenance) {
      issues.push({
        level: "IMPROVEMENT",
        note: `Node '${node.id}' missing provenance (empty array)`,
        target: node.id,
      });
    }
  }

  // Build combined node set (existing + added) for edge validation
  const allNodeIds = new Set([...existingNodeIds, ...addedNodeIds]);

  // Validate adds.edges - check for duplicates and node existence
  const addedEdgeIds = new Set<string>();
  for (const edge of patch.adds.edges) {
    const edgeKey = `${edge.from}→${edge.to}`;

    if (existingEdgeIds.has(edgeKey)) {
      issues.push({
        level: "BLOCKER",
        note: `Edge '${edge.from}→${edge.to}' already exists`,
        target: edgeKey,
      });
    }

    if (addedEdgeIds.has(edgeKey)) {
      issues.push({
        level: "BLOCKER",
        note: `Duplicate edge '${edge.from}→${edge.to}' in patch`,
        target: edgeKey,
      });
    }

    addedEdgeIds.add(edgeKey);

    // Check that from/to nodes exist
    if (!allNodeIds.has(edge.from)) {
      issues.push({
        level: "BLOCKER",
        note: `Edge references non-existent source node '${edge.from}'`,
        target: edgeKey,
      });
    }

    if (!allNodeIds.has(edge.to)) {
      issues.push({
        level: "BLOCKER",
        note: `Edge references non-existent target node '${edge.to}'`,
        target: edgeKey,
      });
    }

    // Check provenance requirement (v04 spec)
    const prov = (edge as unknown as { provenance?: string | unknown[] }).provenance;
    const hasProvenance = prov && (
      typeof prov === "string" ||
      (Array.isArray(prov) && prov.length > 0)
    );

    if (!hasProvenance) {
      issues.push({
        level: "IMPROVEMENT",
        note: `Edge '${edge.from}→${edge.to}' missing provenance`,
        target: edgeKey,
      });
    }
  }

  // Validate updates - check that referenced IDs exist
  for (const update of patch.updates) {
    if (!existingNodeIds.has(update.id) && !addedNodeIds.has(update.id)) {
      issues.push({
        level: "BLOCKER",
        note: `Update references non-existent element '${update.id}'`,
        target: update.id,
      });
    }
  }

  // Validate removes - check that referenced IDs exist
  for (const removeId of patch.removes) {
    if (!existingNodeIds.has(removeId)) {
      // Check if it's an edge ID (format: "from→to")
      if (removeId.includes("→")) {
        if (!existingEdgeIds.has(removeId)) {
          issues.push({
            level: "BLOCKER",
            note: `Remove references non-existent edge '${removeId}'`,
            target: removeId,
          });
        }
      } else {
        issues.push({
          level: "BLOCKER",
          note: `Remove references non-existent node '${removeId}'`,
          target: removeId,
        });
      }
    }
  }

  // Check for dangling edges after removes (OBSERVATION level)
  const removedNodeIds = new Set(
    patch.removes.filter(id => !id.includes("→"))
  );

  if (removedNodeIds.size > 0) {
    // Check existing edges that reference removed nodes
    for (const edge of graph.edges) {
      if (removedNodeIds.has(edge.from) || removedNodeIds.has(edge.to)) {
        const edgeKey = `${edge.from}→${edge.to}`;
        if (!patch.removes.includes(edgeKey)) {
          issues.push({
            level: "OBSERVATION",
            note: `Edge '${edgeKey}' will dangle after node removal`,
            target: edgeKey,
          });
        }
      }
    }
  }

  return issues;
}
