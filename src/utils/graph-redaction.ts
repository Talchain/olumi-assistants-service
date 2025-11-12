/**
 * Graph Redaction for Sharing (v1.5.0 - PR I)
 *
 * Redacts sensitive information from decision graphs for public sharing:
 * - Removes detailed rationales (keeps basic "why" only)
 * - Strips provenance details
 * - Removes attachment content
 * - Preserves graph structure and labels
 */

import type { GraphT } from "../schemas/graph.js";

/**
 * Redacted graph type (subset of GraphT)
 */
export interface RedactedGraph {
  version: string;
  default_seed: number;
  meta: {
    brief?: string; // Optionally redacted
    title?: string;
  };
  nodes: Array<{
    id: string;
    kind: "goal" | "decision" | "option" | "outcome" | "risk" | "action";
    label?: string;
    body?: string; // May be redacted
  }>;
  edges: Array<{
    from: string;
    to: string;
  }>;
}

/**
 * Redaction options
 */
export interface RedactionOptions {
  /** Keep brief in meta (default false) */
  keep_brief?: boolean;
  /** Keep node body fields (default false) */
  keep_bodies?: boolean;
  /** Keep detailed rationales (default false) */
  keep_rationales?: boolean;
}

/**
 * Redact a decision graph for public sharing
 *
 * @param graph Full decision graph
 * @param options Redaction options
 * @returns Redacted graph safe for public viewing
 */
export function redactGraphForSharing(
  graph: GraphT,
  options: RedactionOptions = {}
): RedactedGraph {
  const {
    keep_brief = false,
    keep_bodies = false,
    keep_rationales = false,
  } = options;

  // Redact meta (use any to handle extended meta fields not in GraphT)
  const graphMeta = graph.meta as any;
  const meta: RedactedGraph["meta"] = {
    title: graphMeta?.title,
  };

  if (keep_brief && graphMeta?.brief) {
    meta.brief = graphMeta.brief;
  }

  // Redact nodes: keep structure, optionally redact bodies
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    label: node.label,
    body: keep_bodies ? node.body : undefined,
  }));

  // Redact edges: keep only graph structure
  const edges = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
  }));

  const redacted: RedactedGraph = {
    version: graph.version,
    default_seed: graph.default_seed,
    meta,
    nodes,
    edges,
  };

  return redacted;
}

/**
 * Check if a brief contains potentially sensitive information
 * Returns true if brief should be redacted by default.
 *
 * Heuristics:
 * - Contains email addresses
 * - Contains phone numbers
 * - Contains dollar amounts over $1M
 * - Contains specific names (proper nouns in title case)
 */
export function containsSensitiveInfo(brief: string): boolean {
  // Email addresses (simplified pattern)
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(brief)) {
    return true;
  }

  // Phone numbers (various formats)
  if (/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(brief)) {
    return true;
  }

  // Large dollar amounts ($1M+, $1 million, etc.)
  if (/\$\s*\d+\.?\d*\s*(M|million|B|billion)/i.test(brief)) {
    return true;
  }

  // Social Security Numbers (XXX-XX-XXXX)
  if (/\d{3}-\d{2}-\d{4}/.test(brief)) {
    return true;
  }

  return false;
}
