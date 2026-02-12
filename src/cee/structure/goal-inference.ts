/**
 * Goal Inference Utility
 *
 * Provides functions to infer goal nodes from decision briefs when LLM
 * fails to generate them. Used as part of the defence-in-depth strategy
 * for handling missing goal nodes.
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";
import type { CorrectionCollector } from "../corrections.js";
import { formatEdgeId } from "../corrections.js";

/**
 * Patterns that indicate goal/objective phrases in briefs
 */
const GOAL_PATTERNS = [
  // Explicit goal statements
  /(?:my |our |the )?goal is (?:to )?(.+?)(?:\.|,|$)/i,
  /(?:my |our |the )?objective is (?:to )?(.+?)(?:\.|,|$)/i,
  /(?:my |our |the )?aim is (?:to )?(.+?)(?:\.|,|$)/i,

  // Purpose phrases
  /to achieve (.+?)(?:\.|,|$)/i,
  /to improve (.+?)(?:\.|,|$)/i,
  /to increase (.+?)(?:\.|,|$)/i,
  /to reduce (.+?)(?:\.|,|$)/i,
  /to decrease (.+?)(?:\.|,|$)/i,
  /to maximize (.+?)(?:\.|,|$)/i,
  /to minimize (.+?)(?:\.|,|$)/i,
  /to enable (?:me |us )?to (.+?)(?:\.|,|$)/i,
  /to help (?:me |us )?(.+?)(?:\.|,|$)/i,
  /to allow (?:me |us )?to (.+?)(?:\.|,|$)/i,
  /to focus on (.+?)(?:\.|,|$)/i,

  // Want/need statements
  /(?:I |we )?want to (.+?)(?:\.|,|$)/i,
  /(?:I |we )?need to (.+?)(?:\.|,|$)/i,

  // Success/outcome phrases
  /success (?:means|looks like|is) (.+?)(?:\.|,|$)/i,
  /the outcome (?:I |we )?(?:want|need) is (.+?)(?:\.|,|$)/i,
];

/**
 * Default placeholder goal when no objective can be inferred
 */
export const DEFAULT_GOAL_LABEL = "Achieve the best outcome for this decision";

/**
 * Result of goal inference
 */
export interface GoalInferenceResult {
  /** Whether a goal was found/inferred */
  found: boolean;
  /** The inferred goal label */
  label: string;
  /** Source of the goal */
  source: "brief" | "placeholder" | "explicit";
  /** The matched pattern (for debugging) */
  matchedPattern?: string;
}

/**
 * Infer a goal from a decision brief
 *
 * @param brief - The user's decision brief
 * @returns The inferred goal result
 */
export function inferGoalFromBrief(brief: string): GoalInferenceResult {
  if (!brief || typeof brief !== "string") {
    return {
      found: false,
      label: DEFAULT_GOAL_LABEL,
      source: "placeholder",
    };
  }

  // Try each pattern
  for (const pattern of GOAL_PATTERNS) {
    const match = brief.match(pattern);
    if (match && match[1]) {
      const extracted = match[1].trim();
      // Clean up the extracted text
      const cleaned = cleanGoalText(extracted);
      if (cleaned.length >= 5 && cleaned.length <= 200) {
        return {
          found: true,
          label: capitalizeFirst(cleaned),
          source: "brief",
          matchedPattern: pattern.source,
        };
      }
    }
  }

  // No pattern matched, return placeholder
  return {
    found: false,
    label: DEFAULT_GOAL_LABEL,
    source: "placeholder",
  };
}

/**
 * Clean up extracted goal text
 */
function cleanGoalText(text: string): string {
  return text
    // Remove trailing punctuation
    .replace(/[.,;:!?]+$/, "")
    // Remove leading articles/prepositions if they're the whole prefix
    .replace(/^(?:a |an |the |to |for |in |on |by )/i, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Create a goal node with standard structure
 */
export function createGoalNode(
  label: string,
  id: string = "goal_inferred"
): {
  id: string;
  kind: "goal";
  label: string;
} {
  return {
    id,
    kind: "goal",
    label,
  };
}

/**
 * Wire outcomes and risks to a goal node
 *
 * @param graph - The graph to modify
 * @param goalId - The ID of the goal node to wire to
 * @param collector - Optional correction collector for tracking
 * @returns Modified graph with outcome/risk edges to goal
 */
export function wireOutcomesToGoal(
  graph: GraphV1,
  goalId: string,
  collector?: CorrectionCollector
): GraphV1 {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return graph;
  }

  const outcomeAndRiskIds = new Set<string>();
  for (const node of graph.nodes) {
    const kind = (node as any).kind as string | undefined;
    const id = (node as any).id as string | undefined;
    if (id && (kind === "outcome" || kind === "risk")) {
      outcomeAndRiskIds.add(id);
    }
  }

  // Check which outcomes/risks already have edges to goal
  const alreadyWired = new Set<string>();
  for (const edge of graph.edges as any[]) {
    if (edge.to === goalId && outcomeAndRiskIds.has(edge.from)) {
      alreadyWired.add(edge.from);
    }
  }

  // Add missing edges
  const newEdges = [...(graph.edges as any[])];
  for (const nodeId of outcomeAndRiskIds) {
    if (!alreadyWired.has(nodeId)) {
      // Determine if outcome (positive) or risk (negative)
      const node = graph.nodes.find((n: any) => n.id === nodeId);
      const isRisk = (node as any)?.kind === "risk";
      const kind = (node as any)?.kind;

      const newEdge = {
        from: nodeId,
        to: goalId,
        // Use flat field names to match V3 transform expectations
        // (edges added here bypass LLM normalisation which flattens strength.mean)
        strength_mean: isRisk ? -0.5 : 0.7,
        strength_std: 0.15,
        belief_exists: 0.9,
        effect_direction: isRisk ? "negative" as const : "positive" as const,
        origin: "default" as const,
        provenance: {
          source: "synthetic",
          quote: `Wired ${kind} to goal (synthetic edge)`,
        },
        provenance_source: "synthetic",
      };

      newEdges.push(newEdge);

      // Record correction for added edge (Stage 18: Outcome→Goal Wiring)
      if (collector) {
        collector.addByStage(
          18, // Stage 18: Outcome→Goal Wiring
          "edge_added",
          { edge_id: formatEdgeId(nodeId, goalId) },
          `Wired ${kind} node to goal (missing edge)`,
          undefined,
          { from: nodeId, to: goalId, strength_mean: newEdge.strength_mean }
        );
      }
    }
  }

  return {
    ...graph,
    edges: newEdges,
  } as GraphV1;
}

/**
 * Check if a graph has a goal node
 */
export function hasGoalNode(graph: GraphV1 | undefined): boolean {
  if (!graph || !Array.isArray(graph.nodes)) {
    return false;
  }
  return graph.nodes.some((node: any) => node.kind === "goal");
}

/**
 * Add a goal node to a graph if missing
 *
 * @param graph - The graph to potentially modify
 * @param brief - The user's decision brief (for inference)
 * @param explicitGoal - Optional explicit goal from context.goals
 * @param collector - Optional correction collector for tracking
 * @returns Object with modified graph and metadata about the operation
 */
export function ensureGoalNode(
  graph: GraphV1,
  brief: string,
  explicitGoal?: string,
  collector?: CorrectionCollector
): {
  graph: GraphV1;
  goalAdded: boolean;
  goalNodeId?: string;
  inferredFrom?: "brief" | "placeholder" | "explicit";
} {
  if (!graph || !Array.isArray(graph.nodes)) {
    return { graph, goalAdded: false };
  }

  // Check if goal already exists
  if (hasGoalNode(graph)) {
    return { graph, goalAdded: false };
  }

  // Use explicit goal if provided
  if (explicitGoal && typeof explicitGoal === "string" && explicitGoal.trim().length > 0) {
    const goalNode = createGoalNode(explicitGoal.trim(), "goal_explicit");
    const graphWithGoal = {
      ...graph,
      nodes: [...(graph.nodes as any[]), goalNode],
    } as GraphV1;

    // Record correction for added goal node (Stage 17: Goal Inference)
    if (collector) {
      collector.addByStage(
        17, // Stage 17: Goal Inference
        "node_added",
        { node_id: goalNode.id, kind: "goal" },
        "Goal node added from explicit context",
        undefined,
        { id: goalNode.id, kind: "goal", label: goalNode.label }
      );
    }

    return {
      graph: wireOutcomesToGoal(graphWithGoal, goalNode.id, collector),
      goalAdded: true,
      goalNodeId: goalNode.id,
      inferredFrom: "explicit",
    };
  }

  // Infer goal from brief
  const inference = inferGoalFromBrief(brief);
  const goalNode = createGoalNode(inference.label, "goal_inferred");
  const graphWithGoal = {
    ...graph,
    nodes: [...(graph.nodes as any[]), goalNode],
  } as GraphV1;

  // Record correction for added goal node (Stage 17: Goal Inference)
  if (collector) {
    collector.addByStage(
      17, // Stage 17: Goal Inference
      "node_added",
      { node_id: goalNode.id, kind: "goal" },
      `Goal node inferred from ${inference.source}`,
      undefined,
      { id: goalNode.id, kind: "goal", label: goalNode.label }
    );
  }

  return {
    graph: wireOutcomesToGoal(graphWithGoal, goalNode.id, collector),
    goalAdded: true,
    goalNodeId: goalNode.id,
    inferredFrom: inference.source,
  };
}
