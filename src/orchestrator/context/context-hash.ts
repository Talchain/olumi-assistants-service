/**
 * Canonical Context Hashing
 *
 * Produces a deterministic SHA-256 hash of the logical context sent to the LLM.
 * Two identical logical states must produce the same hash regardless of timing,
 * UI state, or field ordering.
 *
 * Canonicalisation rules:
 * - Graph compact: already deterministic (sorted nodes/edges from graph-compact.ts)
 * - Analysis compact: already deterministic (sorted options/drivers)
 * - Messages: ordered by sequence index (position in array). Include role + content only.
 *   Exclude client_turn_id, timestamp, and other metadata.
 * - Selected elements: sorted bytewise before including
 * - Framing: sort constraints and options arrays bytewise; include stage
 * - Excluded entirely: event_log_summary (derived), scenario_id, scenario_title,
 *   any UI state fields, any timestamps, context_hash itself
 *
 * Hash algorithm: SHA-256 of canonical JSON string via stableStringify.
 * Output: lowercase hex string (full 64 chars).
 *
 * Versioning: canonical input includes "__hash_version": "1" as the first key.
 * Increment this when canonicalisation rules change to distinguish prior hashes.
 */

import { createHash } from "node:crypto";
import type { GraphV3Compact } from "./graph-compact.js";
import type { AnalysisResponseSummary } from "./analysis-compact.js";
import { stableStringify } from "./stable-stringify.js";

// ============================================================================
// Versioning
// ============================================================================

/** Increment when canonicalisation rules change. */
const HASH_VERSION = "1";

// ============================================================================
// Context Shape for Hashing
// ============================================================================

/**
 * The fields of EnrichedContext that participate in the context hash.
 * This is a structural subset — pass the full EnrichedContext and we extract
 * only what belongs in the hash.
 */
export interface HashableContext {
  // Compact graph (from graph-compact.ts)
  graph?: GraphV3Compact | null;
  // Compact analysis (from analysis-compact.ts)
  analysis_response?: AnalysisResponseSummary | null;
  // Framing (stage included — affects LLM behaviour)
  framing?: {
    stage: string;
    goal?: string;
    constraints?: unknown[];
    options?: unknown[];
  } | null;
  // Conversation messages — trimmed, role + content only
  messages?: Array<{ role: string; content: string }>;
  // Selected elements
  selected_elements?: { node_ids?: string[]; edge_ids?: string[] } | string[] | null;
}

// ============================================================================
// Canonical Normalisation
// ============================================================================

function normaliseMessages(
  messages: Array<{ role: string; content: string } | Record<string, unknown>>,
): Array<{ role: string; content: string }> {
  return messages.map((m) => ({
    role: typeof m.role === 'string' ? m.role : '',
    content: typeof m.content === 'string' ? m.content : '',
  }));
}

function normaliseSelectedElements(
  sel: HashableContext['selected_elements'],
): { node_ids: string[]; edge_ids: string[] } | null {
  if (!sel) return null;

  if (Array.isArray(sel)) {
    // Legacy flat array of IDs — sort bytewise
    return { node_ids: [...sel].sort(), edge_ids: [] };
  }

  return {
    node_ids: sel.node_ids ? [...sel.node_ids].sort() : [],
    edge_ids: sel.edge_ids ? [...sel.edge_ids].sort() : [],
  };
}

function normaliseFraming(
  framing: HashableContext['framing'],
): Record<string, unknown> | null {
  if (!framing) return null;

  const result: Record<string, unknown> = {
    stage: framing.stage,
  };

  if (framing.goal !== undefined) {
    result.goal = framing.goal;
  }

  // Sort constraints bytewise (each element normalised via stableStringify round-trip)
  if (Array.isArray(framing.constraints)) {
    result.constraints = [...framing.constraints]
      .map((c) => stableStringify(c))
      .sort()
      .map((s) => JSON.parse(s) as unknown);
  }

  // Sort options bytewise
  if (Array.isArray(framing.options)) {
    result.options = [...framing.options]
      .map((o) => stableStringify(o))
      .sort()
      .map((s) => JSON.parse(s) as unknown);
  }

  return result;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Compute a deterministic SHA-256 hash of the logical context.
 *
 * Fields included:
 * - __hash_version (version sentinel)
 * - graph (compact, already sorted)
 * - analysis_response (compact, already sorted)
 * - messages (role + content only, in sequence order)
 * - selected_elements (sorted bytewise)
 * - framing.stage, framing.goal, framing.constraints (sorted), framing.options (sorted)
 *
 * Fields excluded:
 * - event_log_summary (derived state, not primary)
 * - scenario_id, scenario_title
 * - timestamps, client_turn_id, turn_id
 * - UI state fields
 * - context_hash itself
 *
 * @returns lowercase hex SHA-256 hash string (64 chars)
 */
export function computeContextHash(context: HashableContext): string {
  // __hash_version must be first so stableStringify (which sorts keys) places it first
  // after lexicographic sort: "__" sorts before all lowercase letters.
  const canonical: Record<string, unknown> = {
    __hash_version: HASH_VERSION,
  };

  // Graph compact (already deterministic)
  if (context.graph != null) {
    canonical.graph = context.graph;
  }

  // Analysis compact (already deterministic)
  if (context.analysis_response != null) {
    canonical.analysis_response = context.analysis_response;
  }

  // Framing (normalised — stage included, constraints/options sorted)
  const normFraming = normaliseFraming(context.framing);
  if (normFraming !== null) {
    canonical.framing = normFraming;
  }

  // Messages — role + content only, sequence-ordered
  canonical.messages = normaliseMessages(
    (context.messages ?? []) as Array<{ role: string; content: string }>,
  );

  // Selected elements — sorted bytewise
  const normSelected = normaliseSelectedElements(context.selected_elements);
  if (normSelected !== null) {
    canonical.selected_elements = normSelected;
  }

  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}
