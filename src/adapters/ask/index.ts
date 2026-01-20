/**
 * Ask Adapter
 *
 * Orchestrates responses to /ask endpoint by routing to appropriate
 * capability handlers based on inferred intent.
 *
 * Key responsibilities:
 * 1. Route to appropriate handler based on intent (explain, repair, ideate, etc.)
 * 2. Enforce model-bound invariant (always return actions, highlights, or follow-up)
 * 3. Validate all IDs in responses against graph_snapshot
 * 4. Generate attribution metadata
 *
 * P0 handlers (must ship):
 * - explain/clarify - Grounded to selected nodes/edges with highlights
 * - repair - Propose concrete model_actions
 * - follow_up_question - When context is missing
 */

import { randomUUID, createHash } from "node:crypto";
import { log, emit } from "../../utils/telemetry.js";
import { getAdapter } from "../llm/router.js";
import type { CallOpts } from "../llm/types.js";
import type {
  WorkingSetRequestT,
  AskResponseT,
  ModelActionT,
  HighlightT,
  ProvenanceItemT,
  AskIntentT,
  AttributionT,
} from "../../schemas/working-set.js";
import { validateActionIds, validateHighlightIds } from "../../schemas/working-set.js";
import { inferIntent, isP0Intent } from "../../services/intent-inference.js";
import type { GraphT } from "../../schemas/graph.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for ask adapter.
 */
export interface AskAdapterOpts {
  requestId: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}

/**
 * Internal result from intent handlers.
 */
interface HandlerResult {
  message: string;
  model_actions?: ModelActionT[];
  highlights?: HighlightT[];
  follow_up_question?: string;
  why?: ProvenanceItemT[];
  updated_decision_state_summary?: string;
}

/**
 * Extended response that includes the inferred intent for telemetry/session.
 * The route should use this for logging and session caching.
 */
export interface AskProcessResult {
  response: AskResponseT;
  /** The actual intent used (either from request or inferred) */
  inferredIntent: AskIntentT;
  /** Confidence score of the intent inference (1.0 if explicitly provided) */
  intentConfidence: number;
}

// ============================================================================
// Attribution
// ============================================================================

/**
 * Generate attribution metadata for response.
 */
function generateAttribution(
  provider: string,
  modelId: string,
  responseContent: string,
  seed?: number
): AttributionT {
  const hash = createHash("sha256")
    .update(responseContent)
    .digest("hex")
    .slice(0, 16);

  return {
    provider,
    model_id: modelId,
    timestamp: new Date().toISOString(),
    assistant_response_hash: hash,
    seed,
  };
}

// ============================================================================
// Intent Handlers
// ============================================================================

/**
 * Handle "explain" intent - explain why something is in the graph.
 */
async function handleExplain(
  request: WorkingSetRequestT,
  _opts: AskAdapterOpts
): Promise<HandlerResult> {
  const { message, selection, graph_snapshot } = request;

  // If user selected a node/edge, explain it
  if (selection?.node_id) {
    const node = graph_snapshot.nodes.find((n) => n.id === selection.node_id);
    if (node) {
      return {
        message: `The "${node.label || node.id}" ${node.kind} is part of this decision model because it ${getNodeExplanation(node.kind)}. ${node.body || ""}`,
        highlights: [
          {
            type: "node",
            ids: [node.id],
            style: "primary",
            label: "Focus of explanation",
          },
        ],
        why: [
          {
            source: "graph",
            confidence: "high",
            note: `Node "${node.id}" has kind "${node.kind}"`,
            references: { node_ids: [node.id] },
          },
        ],
      };
    }
  }

  if (selection?.edge_id) {
    // Parse edge_id as "from->to" format
    const [from, to] = selection.edge_id.split("->");
    const edge = graph_snapshot.edges.find(
      (e) => e.from === from && e.to === to
    );
    if (edge) {
      const fromNode = graph_snapshot.nodes.find((n) => n.id === from);
      const toNode = graph_snapshot.nodes.find((n) => n.id === to);
      return {
        message: `This connection shows that "${fromNode?.label || from}" influences "${toNode?.label || to}". The relationship strength is ${edge.belief ? `${(edge.belief * 100).toFixed(0)}%` : "not specified"}.`,
        highlights: [
          {
            type: "edge",
            ids: [selection.edge_id],
            style: "primary",
          },
        ],
        why: [
          {
            source: "graph",
            confidence: "high",
            note: `Edge from "${from}" to "${to}"`,
            references: { edge_ids: [selection.edge_id] },
          },
        ],
      };
    }
  }

  // No specific selection - try to extract what user is asking about from message
  const mentionedNodeIds = findMentionedNodes(message, graph_snapshot);
  if (mentionedNodeIds.length > 0) {
    const node = graph_snapshot.nodes.find((n) => n.id === mentionedNodeIds[0]);
    if (node) {
      return {
        message: `"${node.label || node.id}" is a ${node.kind} in this decision. ${getNodeExplanation(node.kind)}`,
        highlights: [
          {
            type: "node",
            ids: mentionedNodeIds,
            style: "primary",
          },
        ],
      };
    }
  }

  // Can't determine what to explain - ask follow-up
  return {
    message: "I'd be happy to explain part of this decision model.",
    follow_up_question: "Which node or connection would you like me to explain?",
    highlights: [
      {
        type: "node",
        ids: graph_snapshot.nodes.slice(0, 3).map((n) => n.id),
        style: "secondary",
        label: "Key elements",
      },
    ],
  };
}

/**
 * Handle "repair" intent - fix errors or improve structure.
 */
async function handleRepair(
  request: WorkingSetRequestT,
  _opts: AskAdapterOpts
): Promise<HandlerResult> {
  const { message, graph_snapshot } = request;

  // Check for common issues
  const issues: string[] = [];
  const actions: ModelActionT[] = [];

  // Check for orphan nodes (nodes with no edges)
  const connectedNodes = new Set<string>();
  for (const edge of graph_snapshot.edges) {
    connectedNodes.add(edge.from);
    connectedNodes.add(edge.to);
  }

  const orphanNodes = graph_snapshot.nodes.filter(
    (n) => !connectedNodes.has(n.id) && n.kind !== "goal"
  );

  if (orphanNodes.length > 0) {
    issues.push(`Found ${orphanNodes.length} disconnected node(s)`);
    // Suggest connecting orphans to the goal
    const goal = graph_snapshot.nodes.find((n) => n.kind === "goal");
    if (goal && orphanNodes.length <= 3) {
      for (const orphan of orphanNodes) {
        actions.push({
          action_id: randomUUID(),
          op: "add_edge",
          payload: {
            from: orphan.id,
            to: goal.id,
            belief: 0.5,
          },
          reason_code: "connect_orphan",
          label: `Connect ${orphan.label || orphan.id} to goal`,
        });
      }
    }
  }

  // Check for missing goal
  const hasGoal = graph_snapshot.nodes.some((n) => n.kind === "goal");
  if (!hasGoal) {
    issues.push("No goal node found");
    actions.push({
      action_id: randomUUID(),
      op: "add_node",
      payload: {
        id: "goal_1",
        kind: "goal",
        label: "Define goal",
      },
      reason_code: "add_goal",
      label: "Add a goal node",
    });
  }

  // Check for nodes without labels
  const unlabeledNodes = graph_snapshot.nodes.filter((n) => !n.label);
  if (unlabeledNodes.length > 0) {
    issues.push(`Found ${unlabeledNodes.length} node(s) without labels`);
  }

  if (issues.length === 0 && actions.length === 0) {
    // No obvious issues found
    return {
      message: "I didn't find any structural issues with this decision model. It looks well-formed.",
      highlights: [
        {
          type: "node",
          ids: graph_snapshot.nodes.map((n) => n.id),
          style: "secondary",
          label: "All nodes checked",
        },
      ],
      follow_up_question: "Is there a specific aspect you'd like me to improve?",
    };
  }

  return {
    message: `I found some issues: ${issues.join("; ")}. ${actions.length > 0 ? "Here are suggested fixes." : ""}`,
    model_actions: actions.length > 0 ? actions : undefined,
    highlights: orphanNodes.length > 0
      ? [
          {
            type: "node",
            ids: orphanNodes.map((n) => n.id),
            style: "warning",
            label: "Disconnected nodes",
          },
        ]
      : undefined,
    follow_up_question: actions.length === 0 ? "Would you like me to suggest specific improvements?" : undefined,
    why: issues.map((issue) => ({
      source: "validator" as const,
      confidence: "high" as const,
      note: issue,
    })),
  };
}

/**
 * Handle "clarify" intent - ask for more context.
 */
async function handleClarify(
  request: WorkingSetRequestT,
  _opts: AskAdapterOpts
): Promise<HandlerResult> {
  const { message, graph_snapshot, selection } = request;

  // If there's a selection, highlight it and ask about it
  if (selection?.node_id) {
    const node = graph_snapshot.nodes.find((n) => n.id === selection.node_id);
    return {
      message: node
        ? `I see you're focused on "${node.label || node.id}".`
        : "I see you've selected an element.",
      highlights: selection.node_id
        ? [{ type: "node", ids: [selection.node_id], style: "primary" }]
        : undefined,
      follow_up_question: "What would you like to know about this?",
    };
  }

  // General clarification
  return {
    message: "I'm here to help you understand and improve this decision model.",
    follow_up_question: "What aspect would you like to explore?",
    highlights: [
      {
        type: "node",
        ids: graph_snapshot.nodes.slice(0, 3).map((n) => n.id),
        style: "secondary",
        label: "Key elements",
      },
    ],
  };
}

/**
 * Handle "ideate" intent - generate alternatives.
 */
async function handleIdeate(
  request: WorkingSetRequestT,
  _opts: AskAdapterOpts
): Promise<HandlerResult> {
  const { graph_snapshot } = request;

  // Find options in the graph
  const options = graph_snapshot.nodes.filter((n) => n.kind === "option");

  if (options.length >= 3) {
    return {
      message: `You already have ${options.length} options. I can help you evaluate them or think of alternatives.`,
      highlights: [
        {
          type: "node",
          ids: options.map((n) => n.id),
          style: "secondary",
          label: "Existing options",
        },
      ],
      follow_up_question: "Would you like me to suggest a different approach, or help compare these options?",
    };
  }

  // Suggest adding options
  return {
    message: "Let me help you think of alternatives.",
    follow_up_question: "What constraints or requirements should I consider when suggesting options?",
    highlights: graph_snapshot.nodes.find((n) => n.kind === "goal")
      ? [
          {
            type: "node",
            ids: [graph_snapshot.nodes.find((n) => n.kind === "goal")!.id],
            style: "primary",
            label: "Goal to address",
          },
        ]
      : undefined,
  };
}

/**
 * Handle "compare" intent - compare options.
 */
async function handleCompare(
  request: WorkingSetRequestT,
  _opts: AskAdapterOpts
): Promise<HandlerResult> {
  const { graph_snapshot } = request;

  const options = graph_snapshot.nodes.filter((n) => n.kind === "option");

  if (options.length < 2) {
    return {
      message: "I need at least two options to compare.",
      follow_up_question: "Would you like me to help you identify more options first?",
    };
  }

  // Highlight the options for comparison
  return {
    message: `I see ${options.length} options to compare: ${options.map((o) => o.label || o.id).join(", ")}.`,
    highlights: [
      {
        type: "node",
        ids: options.map((n) => n.id),
        style: "primary",
        label: "Options to compare",
      },
    ],
    follow_up_question: "What criteria are most important for your comparison?",
  };
}

/**
 * Handle "challenge" intent - challenge assumptions.
 */
async function handleChallenge(
  request: WorkingSetRequestT,
  _opts: AskAdapterOpts
): Promise<HandlerResult> {
  const { graph_snapshot, selection } = request;

  // If selection, challenge that specific element
  if (selection?.node_id) {
    const node = graph_snapshot.nodes.find((n) => n.id === selection.node_id);
    if (node) {
      return {
        message: `Let's examine "${node.label || node.id}" more critically.`,
        highlights: [
          {
            type: "node",
            ids: [node.id],
            style: "warning",
            label: "Under scrutiny",
          },
        ],
        follow_up_question: `What evidence supports this ${node.kind}? Are there alternatives we haven't considered?`,
        why: [
          {
            source: "graph",
            confidence: "medium",
            note: "This element may benefit from additional validation",
            references: { node_ids: [node.id] },
          },
        ],
      };
    }
  }

  // General challenge - look for low-confidence edges
  const lowConfidenceEdges = graph_snapshot.edges.filter(
    (e) => e.belief !== undefined && e.belief < 0.5
  );

  if (lowConfidenceEdges.length > 0) {
    return {
      message: "I found some connections with lower confidence that may be worth examining.",
      highlights: [
        {
          type: "edge",
          ids: lowConfidenceEdges.map((e) => `${e.from}->${e.to}`),
          style: "warning",
          label: "Low confidence",
        },
      ],
      follow_up_question: "Would you like to strengthen any of these connections with evidence?",
    };
  }

  return {
    message: "Every decision model contains assumptions. Let's examine yours.",
    follow_up_question: "Which assumption would you like to challenge first?",
    highlights: [
      {
        type: "node",
        ids: graph_snapshot.nodes.slice(0, 3).map((n) => n.id),
        style: "secondary",
      },
    ],
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a brief explanation of what a node kind means.
 */
function getNodeExplanation(kind: string): string {
  switch (kind) {
    case "goal":
      return "represents the objective you're trying to achieve";
    case "decision":
      return "represents a choice point that needs to be made";
    case "option":
      return "represents a possible course of action";
    case "outcome":
      return "represents a possible result of a decision";
    case "risk":
      return "represents a potential negative consequence to consider";
    case "action":
      return "represents a concrete step to be taken";
    case "factor":
      return "represents a variable or consideration that influences the decision";
    default:
      return "is part of the decision structure";
  }
}

/**
 * Find nodes mentioned in a message by label matching.
 */
function findMentionedNodes(message: string, graph: GraphT): string[] {
  const mentioned: string[] = [];
  const lowerMessage = message.toLowerCase();

  for (const node of graph.nodes) {
    if (node.label) {
      const lowerLabel = node.label.toLowerCase();
      if (lowerMessage.includes(lowerLabel)) {
        mentioned.push(node.id);
      }
    }
  }

  return mentioned;
}

// ============================================================================
// Main Adapter Function
// ============================================================================

/**
 * Process an ask request and return a model-bound response.
 *
 * @param request - The working set request
 * @param opts - Adapter options (requestId, timeout, etc.)
 * @returns AskProcessResult with response, inferred intent, and confidence
 */
export async function processAskRequest(
  request: WorkingSetRequestT,
  opts: AskAdapterOpts
): Promise<AskProcessResult> {
  const startTime = Date.now();

  // Infer intent if not provided
  const intentResult = request.intent
    ? { intent: request.intent, confidence: 1.0 }
    : inferIntent(request.message, request.selection);
  const intent = intentResult.intent;
  const intentConfidence = intentResult.confidence;

  log.info(
    {
      event: "ask.process_start",
      request_id: opts.requestId,
      scenario_id: request.scenario_id,
      intent,
      has_selection: !!(request.selection?.node_id || request.selection?.edge_id),
      node_count: request.graph_snapshot.nodes.length,
      edge_count: request.graph_snapshot.edges.length,
    },
    "Processing ask request"
  );

  // Route to appropriate handler
  let result: HandlerResult;

  try {
    switch (intent) {
      case "explain":
        result = await handleExplain(request, opts);
        break;
      case "repair":
        result = await handleRepair(request, opts);
        break;
      case "clarify":
        result = await handleClarify(request, opts);
        break;
      case "ideate":
        result = await handleIdeate(request, opts);
        break;
      case "compare":
        result = await handleCompare(request, opts);
        break;
      case "challenge":
        result = await handleChallenge(request, opts);
        break;
      default:
        result = await handleClarify(request, opts);
    }
  } catch (error) {
    log.error(
      { error, request_id: opts.requestId, intent },
      "Handler threw error"
    );
    // Return a safe fallback
    result = {
      message: "I encountered an issue processing your request.",
      follow_up_question: "Could you rephrase your question?",
    };
  }

  // Validate model actions if present
  if (result.model_actions && result.model_actions.length > 0) {
    const validation = validateActionIds(result.model_actions, request.graph_snapshot);
    if (!validation.valid) {
      log.warn(
        { errors: validation.errors, request_id: opts.requestId },
        "Model actions failed ID validation"
      );
      // Remove invalid actions
      result.model_actions = undefined;
      result.follow_up_question = result.follow_up_question || "I wasn't able to suggest valid changes. Could you provide more context?";
    }
  }

  // Validate highlights if present
  if (result.highlights && result.highlights.length > 0) {
    const addedNodeIds = new Set(
      (result.model_actions || [])
        .filter((a) => a.op === "add_node" && a.payload.id)
        .map((a) => a.payload.id as string)
    );
    const validation = validateHighlightIds(
      result.highlights,
      request.graph_snapshot,
      addedNodeIds
    );
    if (!validation.valid) {
      log.warn(
        { errors: validation.errors, request_id: opts.requestId },
        "Highlights failed ID validation"
      );
      // Remove invalid highlights
      result.highlights = result.highlights.filter((h) => {
        const validIds = h.ids.filter((id) => {
          if (h.type === "node") {
            return (
              request.graph_snapshot.nodes.some((n) => n.id === id) ||
              addedNodeIds.has(id)
            );
          }
          return true; // Be lenient with edge/path IDs
        });
        return validIds.length > 0;
      });
      if (result.highlights.length === 0) {
        result.highlights = undefined;
      }
    }
  }

  // Enforce model-bound invariant
  const hasActions = result.model_actions && result.model_actions.length > 0;
  const hasHighlights = result.highlights && result.highlights.length > 0;
  const hasFollowUp = !!result.follow_up_question;

  if (!hasActions && !hasHighlights && !hasFollowUp) {
    log.warn(
      { request_id: opts.requestId },
      "Response not model-bound, adding fallback"
    );

    // Try to add default highlights if nodes exist
    const graphNodes = request.graph_snapshot.nodes;
    if (graphNodes.length > 0) {
      result.highlights = [
        {
          type: "node",
          ids: graphNodes.slice(0, Math.min(3, graphNodes.length)).map((n) => n.id),
          style: "secondary",
        },
      ];
    } else {
      // Graph has no nodes - use follow_up_question as fallback
      result.follow_up_question = "Your decision model appears to be empty. What decision are you trying to make?";
    }
  }

  // Generate attribution
  const attribution = generateAttribution(
    "cee",
    "ask-adapter-v1",
    JSON.stringify(result),
    request.graph_snapshot.default_seed
  );

  const durationMs = Date.now() - startTime;

  log.info(
    {
      event: "ask.process_complete",
      request_id: opts.requestId,
      intent,
      duration_ms: durationMs,
      has_actions: hasActions,
      has_highlights: hasHighlights,
      has_follow_up: hasFollowUp,
    },
    "Ask request processed"
  );

  const response: AskResponseT = {
    // Use the route's resolved request_id (from header/Fastify), not body's request_id
    request_id: opts.requestId,
    message: result.message,
    model_actions: result.model_actions,
    highlights: result.highlights,
    follow_up_question: result.follow_up_question,
    why: result.why,
    updated_decision_state_summary: result.updated_decision_state_summary,
    attribution,
  };

  return {
    response,
    inferredIntent: intent,
    intentConfidence,
  };
}
