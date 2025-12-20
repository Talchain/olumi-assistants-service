/**
 * Working Set Schemas for /ask Endpoint
 *
 * Defines the request/response contract for the CEE /ask endpoint.
 * All types use Zod for runtime validation.
 *
 * Key invariant: Every response MUST be model-bound, meaning it must contain
 * at least one of: model_actions, highlights, or follow_up_question.
 */

import { z } from "zod";
import { Graph } from "./graph.js";

// ============================================================================
// Request ID Validation
// ============================================================================

/**
 * Safe charset pattern for request IDs.
 * Allows alphanumeric, dots, underscores, and hyphens.
 * Must be 1-64 characters to prevent log injection attacks.
 */
export const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Validate that a request ID uses safe characters.
 * Returns true if safe, false if potentially dangerous.
 */
export function isRequestIdSafe(id: string): boolean {
  return SAFE_REQUEST_ID_PATTERN.test(id);
}

/**
 * Request ID schema - accepts any safe charset string (not just UUID).
 * This allows clients to use their own trace IDs for correlation.
 */
export const SafeRequestId = z
  .string()
  .min(1)
  .max(64)
  .regex(SAFE_REQUEST_ID_PATTERN, "Request ID must use safe characters: A-Za-z0-9._-");

// ============================================================================
// Common Types
// ============================================================================

/**
 * User intent for the /ask request.
 * Used for routing to appropriate capability handlers.
 */
export const AskIntent = z.enum([
  "clarify",   // Default - need more context
  "explain",   // Explain why something is in the graph
  "ideate",    // Generate alternatives or new ideas
  "repair",    // Fix errors or improve structure
  "compare",   // Compare options or paths
  "challenge", // Challenge assumptions or beliefs
]);

export type AskIntentT = z.infer<typeof AskIntent>;

/**
 * User selection context - what the user is focused on.
 */
export const Selection = z.object({
  node_id: z.string().optional(),
  edge_id: z.string().optional(),
  panel_section: z.string().optional(),
});

export type SelectionT = z.infer<typeof Selection>;

/**
 * Conversation turn for context.
 */
export const Turn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(2000),
  referenced_ids: z.array(z.string()).optional(),
  timestamp: z.string().optional(),
});

export type TurnT = z.infer<typeof Turn>;

/**
 * Market context reference (not the full context, just the reference).
 */
export const MarketContextRef = z.object({
  id: z.string(),
  version: z.string(),
  hash: z.string(),
});

export type MarketContextRefT = z.infer<typeof MarketContextRef>;

// ============================================================================
// Graph Size Limits
// ============================================================================

/**
 * Maximum number of nodes allowed in a graph snapshot.
 * Limits ensure reasonable LLM context usage and response latency.
 */
export const MAX_GRAPH_NODES = 12;

/**
 * Maximum number of edges allowed in a graph snapshot.
 */
export const MAX_GRAPH_EDGES = 20;

// ============================================================================
// Request Schema
// ============================================================================

/**
 * Working Set Request - the input to /assist/v1/ask
 *
 * The graph_snapshot is the authoritative source of truth for the current
 * decision model state. Redis cache is supplementary, not canonical.
 *
 * Note: request_id is optional in the body. If not provided, the route will
 * use X-Request-Id header or Fastify's auto-generated ID. If provided in body,
 * it must use safe characters (A-Za-z0-9._-) to prevent log injection.
 */
export const WorkingSetRequest = z.object({
  // Required fields (request_id is optional - can come from header)
  request_id: SafeRequestId.optional(),
  scenario_id: z.string().min(1).max(100),
  graph_schema_version: z.literal("2.2"),
  brief: z.string().min(10).max(10000),
  message: z.string().min(1).max(2000),
  graph_snapshot: Graph,
  market_context: MarketContextRef,

  // Optional fields
  selection: Selection.optional(),
  turns_recent: z.array(Turn).max(10).optional(),
  decision_state_summary: z.string().max(1000).optional(),
  intent: AskIntent.optional(),
}).refine(
  (req) => req.graph_snapshot.nodes.length <= MAX_GRAPH_NODES,
  {
    message: `Graph snapshot exceeds maximum of ${MAX_GRAPH_NODES} nodes`,
    path: ["graph_snapshot", "nodes"],
  }
).refine(
  (req) => req.graph_snapshot.edges.length <= MAX_GRAPH_EDGES,
  {
    message: `Graph snapshot exceeds maximum of ${MAX_GRAPH_EDGES} edges`,
    path: ["graph_snapshot", "edges"],
  }
);

export type WorkingSetRequestT = z.infer<typeof WorkingSetRequest>;

// ============================================================================
// Response Types
// ============================================================================

/**
 * Model Action - a strict graph patch operation.
 *
 * ID validation rules:
 * - update/delete ops: target_id MUST exist in graph_snapshot
 * - add ops: IDs in payload MUST NOT collide with existing IDs
 */
export const ModelActionOp = z.enum([
  "add_node",
  "add_edge",
  "update_node",
  "update_edge",
  "delete_node",
  "delete_edge",
]);

export type ModelActionOpT = z.infer<typeof ModelActionOp>;

export const ModelAction = z.object({
  action_id: z.string().uuid(),
  op: ModelActionOp,
  target_id: z.string().optional(), // Required for update/delete
  payload: z.record(z.unknown()),
  reason_code: z.string().max(50).optional(),
  label: z.string().max(100).optional(),
});

export type ModelActionT = z.infer<typeof ModelAction>;

/**
 * Highlight - visual emphasis on graph elements.
 */
export const HighlightStyle = z.enum(["primary", "secondary", "warning", "error"]);

export const Highlight = z.object({
  type: z.enum(["node", "edge", "path"]),
  ids: z.array(z.string()).min(1),
  style: HighlightStyle.optional(),
  label: z.string().max(100).optional(),
});

export type HighlightT = z.infer<typeof Highlight>;

/**
 * Provenance - source attribution for responses.
 */
export const ProvenanceSource = z.enum([
  "brief",
  "graph",
  "market_context",
  "validator",
  "engine",
  "user_edit",
]);

export const ProvenanceConfidence = z.enum(["high", "medium", "low"]);

export const ProvenanceItem = z.object({
  source: ProvenanceSource,
  confidence: ProvenanceConfidence,
  note: z.string().max(500),
  references: z.object({
    node_ids: z.array(z.string()).optional(),
    edge_ids: z.array(z.string()).optional(),
  }).optional(),
});

export type ProvenanceItemT = z.infer<typeof ProvenanceItem>;

/**
 * Attribution metadata for audit (not for determinism).
 */
export const Attribution = z.object({
  provider: z.string(),
  model_id: z.string(),
  timestamp: z.string(),
  assistant_response_hash: z.string(),
  seed: z.number().optional(),
});

export type AttributionT = z.infer<typeof Attribution>;

/**
 * Ask Response - the output from /assist/v1/ask
 *
 * Model-bound invariant: At least one of model_actions, highlights,
 * or follow_up_question MUST be present.
 */
export const AskResponse = z.object({
  request_id: z.string().uuid(),
  message: z.string().max(1000),

  // At least one MUST be present (enforced by refinement)
  model_actions: z.array(ModelAction).optional(),
  highlights: z.array(Highlight).optional(),
  follow_up_question: z.string().max(500).optional(),

  // Optional enrichment
  why: z.array(ProvenanceItem).optional(),
  updated_decision_state_summary: z.string().max(1000).optional(),

  // Required attribution
  attribution: Attribution,
}).refine(
  (response) => {
    // Model-bound invariant: at least one actionable element
    const hasActions = response.model_actions && response.model_actions.length > 0;
    const hasHighlights = response.highlights && response.highlights.length > 0;
    const hasFollowUp = !!response.follow_up_question;
    return hasActions || hasHighlights || hasFollowUp;
  },
  {
    message: "Response must be model-bound: include model_actions, highlights, or follow_up_question",
    path: ["_model_bound"],
  }
);

export type AskResponseT = z.infer<typeof AskResponse>;

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes specific to /ask endpoint.
 */
export const AskErrorCode = z.enum([
  "CEE_ASK_INVALID_GRAPH",      // Graph snapshot fails validation
  "CEE_ASK_MISSING_CONTEXT",    // Required fields missing
  "CEE_ASK_ID_NOT_FOUND",       // Referenced node/edge ID doesn't exist
  "CEE_ASK_ID_COLLISION",       // New ID collides with existing
  "CEE_ASK_NOT_MODEL_BOUND",    // Response would violate invariant
  "CEE_ASK_INTENT_UNKNOWN",     // Could not determine intent
  "CEE_ASK_LLM_ERROR",          // LLM call failed
  "CEE_ASK_RATE_LIMITED",       // Rate limit exceeded
]);

export type AskErrorCodeT = z.infer<typeof AskErrorCode>;

export const AskErrorResponse = z.object({
  request_id: z.string().uuid(),
  error: z.object({
    code: AskErrorCode,
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type AskErrorResponseT = z.infer<typeof AskErrorResponse>;

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate that all IDs referenced in model_actions exist in the graph
 * or are being created in the same response.
 */
export function validateActionIds(
  actions: ModelActionT[],
  graph: { nodes: { id: string }[]; edges: { from: string; to: string }[] }
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const existingNodeIds = new Set(graph.nodes.map(n => n.id));
  const existingEdgeIds = new Set<string>(); // Build from from/to pairs

  for (const edge of graph.edges) {
    existingEdgeIds.add(`${edge.from}->${edge.to}`);
  }

  // Track IDs being added in this response
  const addedNodeIds = new Set<string>();
  const addedEdgeIds = new Set<string>();

  for (const action of actions) {
    switch (action.op) {
      case "add_node": {
        const nodeId = action.payload.id as string | undefined;
        if (nodeId) {
          if (existingNodeIds.has(nodeId)) {
            errors.push(`add_node: ID "${nodeId}" already exists in graph`);
          }
          if (addedNodeIds.has(nodeId)) {
            errors.push(`add_node: ID "${nodeId}" added multiple times in same response`);
          }
          addedNodeIds.add(nodeId);
        }
        break;
      }
      case "add_edge": {
        const from = action.payload.from as string | undefined;
        const to = action.payload.to as string | undefined;
        if (from && to) {
          const edgeKey = `${from}->${to}`;
          if (existingEdgeIds.has(edgeKey)) {
            errors.push(`add_edge: Edge "${edgeKey}" already exists in graph`);
          }
          if (addedEdgeIds.has(edgeKey)) {
            errors.push(`add_edge: Edge "${edgeKey}" added multiple times in same response`);
          }
          // Verify from/to nodes exist or are being added
          if (!existingNodeIds.has(from) && !addedNodeIds.has(from)) {
            errors.push(`add_edge: Source node "${from}" does not exist`);
          }
          if (!existingNodeIds.has(to) && !addedNodeIds.has(to)) {
            errors.push(`add_edge: Target node "${to}" does not exist`);
          }
          addedEdgeIds.add(edgeKey);
        }
        break;
      }
      case "update_node":
      case "delete_node": {
        if (!action.target_id) {
          errors.push(`${action.op}: target_id is required`);
        } else if (!existingNodeIds.has(action.target_id)) {
          errors.push(`${action.op}: Node "${action.target_id}" not found in graph`);
        }
        break;
      }
      case "update_edge":
      case "delete_edge": {
        if (!action.target_id) {
          errors.push(`${action.op}: target_id is required`);
        } else {
          // Edge target_id must be in "from->to" format and edge must exist
          // (or be added in same response for update_edge)
          if (!action.target_id.includes("->")) {
            errors.push(`${action.op}: target_id "${action.target_id}" must be in "from->to" format`);
          } else if (!existingEdgeIds.has(action.target_id) && !addedEdgeIds.has(action.target_id)) {
            errors.push(`${action.op}: Edge "${action.target_id}" not found in graph`);
          }
        }
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that all IDs referenced in highlights exist in the graph
 * or are being created in the same response's model_actions.
 */
export function validateHighlightIds(
  highlights: HighlightT[],
  graph: { nodes: { id: string }[]; edges: { from: string; to: string }[] },
  addedNodeIds: Set<string> = new Set(),
  addedEdgeIds: Set<string> = new Set()
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const existingNodeIds = new Set(graph.nodes.map(n => n.id));
  const existingEdgeIds = new Set<string>();

  for (const edge of graph.edges) {
    existingEdgeIds.add(`${edge.from}->${edge.to}`);
  }

  for (const highlight of highlights) {
    for (const id of highlight.ids) {
      if (highlight.type === "node") {
        if (!existingNodeIds.has(id) && !addedNodeIds.has(id)) {
          errors.push(`Highlight references non-existent node: "${id}"`);
        }
      } else if (highlight.type === "edge") {
        // Edge IDs must be in "from->to" format and edge must exist
        if (!id.includes("->")) {
          errors.push(`Highlight edge ID "${id}" must be in "from->to" format`);
        } else if (!existingEdgeIds.has(id) && !addedEdgeIds.has(id)) {
          errors.push(`Highlight references non-existent edge: "${id}"`);
        }
      } else if (highlight.type === "path") {
        // "path" type is a sequence of node IDs
        if (!existingNodeIds.has(id) && !addedNodeIds.has(id)) {
          errors.push(`Highlight path references non-existent node: "${id}"`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
