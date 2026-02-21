/**
 * Node & Edge Matching Layer
 *
 * CEE may generate different node IDs, labels, or edge sets across runs
 * of the same brief. This module matches nodes and edges across runs so
 * that downstream stability metrics compare like-with-like.
 *
 * Node matching (two-pass):
 *   Pass 1: Primary key = (kind, normalised_label). Unique keys are resolved.
 *   Pass 2: Ambiguous keys are disambiguated using neighbor kind:label
 *           signatures (NOT raw IDs, which are run-specific). For option
 *           nodes, adjacency to matched goal/factor nodes is used.
 *   Unmatched nodes are reported explicitly.
 *
 * Edge matching:
 *   After node matching, edges are matched by (matched_from, matched_to).
 *   Edges present in some runs but not all are flagged as "intermittent".
 */

import type { NodeV3T, EdgeV3T } from "../../src/schemas/cee-v3.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canonical key for a matched node across runs */
export type NodeKey = string; // "kind:normalised_label" or "kind:normalised_label#sig"

/** Canonical key for a matched edge across runs */
export type EdgeKey = string; // "matched_from_key→matched_to_key"

export interface MatchedNode {
  /** Canonical key used for cross-run identification */
  key: NodeKey;
  /** Original node from each run (indexed by run number) */
  instances: Map<number, NodeV3T>;
}

export interface MatchedEdge {
  /** Canonical key */
  key: EdgeKey;
  /** Original edge from each run (indexed by run number) */
  instances: Map<number, EdgeV3T>;
  /** Run indices where this edge appears */
  present_in_runs: number[];
  /** Total number of runs */
  total_runs: number;
}

export interface MatchResult {
  /** All matched nodes across runs */
  matched_nodes: MatchedNode[];
  /** All matched edges across runs */
  matched_edges: MatchedEdge[];
  /** Nodes that could not be matched, per run index */
  unmatched_nodes_per_run: Map<number, NodeV3T[]>;
  /** Edges present in some but not all runs */
  intermittent_edges: MatchedEdge[];
  /** Edges present in all runs */
  always_present_edges: MatchedEdge[];
  /** Total number of runs (passed in, not inferred) */
  total_runs: number;
}

// ---------------------------------------------------------------------------
// Node Key Generation
// ---------------------------------------------------------------------------

/**
 * Normalise a label for matching: lowercase, trim, replace spaces/hyphens
 * with underscores, collapse runs of underscores.
 */
export function normaliseLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Generate a primary node key from kind and label.
 */
function primaryNodeKey(node: NodeV3T): NodeKey {
  return `${node.kind}:${normaliseLabel(node.label)}`;
}

// ---------------------------------------------------------------------------
// Node Matching — Two-Pass Algorithm
// ---------------------------------------------------------------------------

export interface RunGraph {
  nodes: NodeV3T[];
  edges: EdgeV3T[];
}

/**
 * For a single run, build a map from node ID → primary key.
 */
function buildIdToPrimaryKey(graph: RunGraph): Map<string, NodeKey> {
  const m = new Map<string, NodeKey>();
  for (const node of graph.nodes) {
    m.set(node.id, primaryNodeKey(node));
  }
  return m;
}

/**
 * Compute a cross-run-stable neighbor signature for a node.
 *
 * Instead of using raw neighbor IDs (which are run-specific), we use
 * the primary keys (kind:normalised_label) of neighbors. This produces
 * an identical signature for semantically-equivalent nodes across runs.
 *
 * Signature format: sorted list of "dir:neighbor_primary_key" strings.
 */
function neighborSignature(
  nodeId: string,
  graph: RunGraph,
  idToPrimaryKey: Map<string, NodeKey>,
): string {
  const parts: string[] = [];

  for (const edge of graph.edges) {
    if (edge.from === nodeId) {
      const neighborKey = idToPrimaryKey.get(edge.to);
      if (neighborKey) parts.push(`out:${neighborKey}`);
    }
    if (edge.to === nodeId) {
      const neighborKey = idToPrimaryKey.get(edge.from);
      if (neighborKey) parts.push(`in:${neighborKey}`);
    }
  }

  return parts.sort().join("|");
}

/**
 * Build a map from node key → node for a single run.
 *
 * Two-pass:
 *   1. Assign primary keys (kind:normalised_label) — unique ones are done.
 *   2. For collisions, disambiguate using cross-run-stable neighbor signatures.
 */
function buildNodeKeyMap(graph: RunGraph): Map<NodeKey, NodeV3T> {
  const keyMap = new Map<NodeKey, NodeV3T>();
  const idToPrimaryKey = buildIdToPrimaryKey(graph);
  const keyCollisions = new Map<NodeKey, NodeV3T[]>();

  // Pass 1: detect collisions
  for (const node of graph.nodes) {
    const key = primaryNodeKey(node);
    const existing = keyCollisions.get(key);
    if (existing) {
      existing.push(node);
    } else {
      keyCollisions.set(key, [node]);
    }
  }

  // Pass 2: resolve
  for (const [key, nodes] of keyCollisions) {
    if (nodes.length === 1) {
      keyMap.set(key, nodes[0]!);
    } else {
      // Disambiguate using cross-run-stable neighbor signatures
      const sigCounts = new Map<string, number>();
      const nodeSigs: Array<{ node: NodeV3T; sig: string }> = [];

      for (const node of nodes) {
        const sig = neighborSignature(node.id, graph, idToPrimaryKey);
        sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
        nodeSigs.push({ node, sig });
      }

      // If signatures are unique, use them as disambiguators
      // If signatures also collide (extremely rare), append a positional index
      const sigIndexes = new Map<string, number>();
      for (const { node, sig } of nodeSigs) {
        const count = sigCounts.get(sig)!;
        if (count === 1) {
          keyMap.set(`${key}#${sig}`, node);
        } else {
          // Last resort: positional index within same-signature group
          const idx = sigIndexes.get(sig) ?? 0;
          sigIndexes.set(sig, idx + 1);
          keyMap.set(`${key}#${sig}#${idx}`, node);
        }
      }
    }
  }

  return keyMap;
}

/**
 * Match nodes across multiple runs of the same brief.
 *
 * Strategy:
 * 1. Build key maps for all runs (using cross-run-stable keys)
 * 2. Collect the union of all keys
 * 3. For each key, collect instances from each run
 * 4. Track unmatched nodes (present in only one run)
 */
export function matchNodes(
  runs: RunGraph[],
): { matched: MatchedNode[]; unmatched: Map<number, NodeV3T[]> } {
  const keyMaps = runs.map((run) => buildNodeKeyMap(run));

  // Union of all node keys
  const allKeys = new Set<NodeKey>();
  for (const km of keyMaps) {
    for (const key of km.keys()) allKeys.add(key);
  }

  const matched: MatchedNode[] = [];
  const unmatched = new Map<number, NodeV3T[]>();

  // Initialise unmatched lists
  for (let i = 0; i < runs.length; i++) unmatched.set(i, []);

  for (const key of allKeys) {
    const instances = new Map<number, NodeV3T>();
    for (let i = 0; i < keyMaps.length; i++) {
      const node = keyMaps[i]!.get(key);
      if (node) instances.set(i, node);
    }
    matched.push({ key, instances });
  }

  // Nodes whose key only appears in one run are "unmatched"
  for (const mn of matched) {
    if (mn.instances.size === 1) {
      const [runIdx, node] = [...mn.instances.entries()][0]!;
      unmatched.get(runIdx)!.push(node);
    }
  }

  return { matched, unmatched };
}

// ---------------------------------------------------------------------------
// Edge Matching
// ---------------------------------------------------------------------------

/**
 * Match edges across runs using matched node keys.
 *
 * After node matching, each edge is identified by
 * (matched_from_node_key, matched_to_node_key).
 * Edges that appear in some runs but not all are "intermittent".
 */
export function matchEdges(
  runs: RunGraph[],
  matchedNodes: MatchedNode[],
): { matched: MatchedEdge[]; intermittent: MatchedEdge[]; alwaysPresent: MatchedEdge[] } {
  const totalRuns = runs.length;

  // Build reverse lookup: (runIndex, nodeId) → nodeKey
  const nodeIdToKey = new Map<string, NodeKey>(); // "runIdx:nodeId" → key
  for (const mn of matchedNodes) {
    for (const [runIdx, node] of mn.instances) {
      nodeIdToKey.set(`${runIdx}:${node.id}`, mn.key);
    }
  }

  // Collect edges by canonical edge key
  const edgeMap = new Map<EdgeKey, MatchedEdge>();

  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    const run = runs[runIdx]!;
    for (const edge of run.edges) {
      const fromKey = nodeIdToKey.get(`${runIdx}:${edge.from}`);
      const toKey = nodeIdToKey.get(`${runIdx}:${edge.to}`);
      if (!fromKey || !toKey) continue; // Skip edges to/from unmatched nodes

      const edgeKey: EdgeKey = `${fromKey}→${toKey}`;
      let me = edgeMap.get(edgeKey);
      if (!me) {
        me = {
          key: edgeKey,
          instances: new Map(),
          present_in_runs: [],
          total_runs: totalRuns,
        };
        edgeMap.set(edgeKey, me);
      }
      me.instances.set(runIdx, edge);
      me.present_in_runs.push(runIdx);
    }
  }

  const matched = [...edgeMap.values()];
  const alwaysPresent = matched.filter((e) => e.present_in_runs.length === totalRuns);
  const intermittent = matched.filter((e) => e.present_in_runs.length < totalRuns);

  return { matched, intermittent, alwaysPresent };
}

// ---------------------------------------------------------------------------
// Top-Level Match
// ---------------------------------------------------------------------------

/**
 * Run full node + edge matching across multiple runs of the same brief.
 */
export function matchRuns(runs: RunGraph[]): MatchResult {
  const { matched: matchedNodes, unmatched } = matchNodes(runs);
  const { matched: matchedEdges, intermittent, alwaysPresent } = matchEdges(runs, matchedNodes);

  return {
    matched_nodes: matchedNodes,
    matched_edges: matchedEdges,
    unmatched_nodes_per_run: unmatched,
    intermittent_edges: intermittent,
    always_present_edges: alwaysPresent,
    total_runs: runs.length,
  };
}
