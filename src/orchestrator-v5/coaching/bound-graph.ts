/**
 * THE RUN-TURN CARD'S GRAPH — used only when it IS the graph the run was computed on.
 *
 * The route hands `runTurnCoaching` the readback's own graph (routes/agent-v1-turn.ts,
 * `readBackState`). A card may read a fact from it only after this module proves the graph
 * is the one the bound run's hash names: `computeAnalysisAffectingGraphHash(graph) === graphHash`.
 * Anything else — no graph, another turn's graph, a graph the hash function cannot read — is
 * `null`, and the card falls back to words that need no graph. A fact is never taken from a
 * graph the run did not see.
 *
 * Pure: no clock, no LLM, no telemetry.
 */
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { readRecord } from './fragile-link-challenge.js';

/** The graph, when (and only when) its analysis-affecting hash is `graphHash`. */
export function graphBoundToHash(graph: unknown, graphHash: string): Record<string, unknown> | null {
  const record = readRecord(graph);
  if (record === null) return null;
  let hash: string | null;
  try {
    hash = computeAnalysisAffectingGraphHash(record as never);
  } catch {
    // The hash function throws on a persisted graph it cannot read (run-analysis-snapshot-binding.ts).
    return null;
  }
  return hash === graphHash ? record : null;
}

/**
 * The label of THE one node the model's limits sit on, joined by identity:
 * `goal_constraints[].node_id` → that node's `label`. Null when there is no limit row, when
 * the rows sit on more than one node, or when a row's node is missing or unlabelled — the
 * caller then names no limit rather than guessing one.
 */
export function soleLimitNodeLabel(graph: Record<string, unknown>): string | null {
  const rows = graph.goal_constraints;
  const nodes = graph.nodes;
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(nodes)) return null;
  const nodeIds = new Set<string>();
  for (const row of rows) {
    const nodeId = readRecord(row)?.node_id;
    if (typeof nodeId !== 'string' || nodeId.length === 0) return null;
    nodeIds.add(nodeId);
  }
  if (nodeIds.size !== 1) return null;
  const [nodeId] = [...nodeIds];
  const matches = nodes.filter((n) => readRecord(n)?.id === nodeId);
  if (matches.length !== 1) return null;
  const label = readRecord(matches[0])?.label;
  return typeof label === 'string' && label.trim().length > 0 ? label.trim() : null;
}
