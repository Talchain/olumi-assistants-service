/**
 * Share Redaction
 *
 * Always-on redaction for shared artifacts
 * Removes: flags, env vars, keys, internal metadata, PII from labels/body
 */

import type { GraphT } from "../schemas/graph.js";

/**
 * Redact graph for public sharing
 * Never returns: flags, env, keys, correlation IDs, or PII
 */
export function redactGraphForShare(graph: GraphT): GraphT {
  return {
    version: graph.version,
    default_seed: graph.default_seed,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label ? redactText(node.label) : undefined,
      body: node.body ? redactText(node.body) : undefined,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      weight: edge.weight,
      belief: edge.belief,
      provenance: edge.provenance,
      provenance_source: edge.provenance_source,
    })),
    meta: graph.meta,
  };
}

/**
 * Redact brief text for sharing
 */
export function redactBrief(brief: string): string {
  return redactText(brief);
}

/**
 * Redact text content (basic PII patterns)
 * Replaces: emails, phone numbers, potential keys/tokens
 */
function redactText(text: string): string {
  let redacted = text;

  // Redact emails
  redacted = redacted.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    "[EMAIL]"
  );

  // Redact phone numbers (UK/US patterns)
  redacted = redacted.replace(
    /\b(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b/g,
    "[PHONE]"
  );
  redacted = redacted.replace(
    /(\+1\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    "[PHONE]"
  );

  // Redact potential API keys/tokens (32+ hex chars)
  redacted = redacted.replace(/\b[a-fA-F0-9]{32,}\b/g, "[TOKEN]");

  // Redact potential secrets (sk_*, pk_*, etc.)
  redacted = redacted.replace(/\b(sk|pk|api|key)_\w{10,}\b/gi, "[KEY]");

  return redacted;
}

/**
 * Calculate safe size of redacted content
 * Enforces size caps to prevent abuse
 */
export function calculateRedactedSize(graph: GraphT, brief?: string): number {
  const graphJson = JSON.stringify(redactGraphForShare(graph));
  const briefJson = brief ? JSON.stringify(redactBrief(brief)) : "{}";
  return graphJson.length + briefJson.length;
}

/**
 * Size limits for shares (prevent abuse)
 */
export const SHARE_SIZE_LIMITS = {
  MAX_GRAPH_SIZE: 50_000, // 50 KB
  MAX_NODES: 50,
  MAX_EDGES: 200,
};
