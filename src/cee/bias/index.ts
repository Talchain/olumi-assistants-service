import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";

type CEEBiasFindingV1 = components["schemas"]["CEEBiasFindingV1"];
type CEEBiasCheckRequestV1 = components["schemas"]["CEEBiasCheckRequestV1"];

type ArchetypeMeta = CEEBiasCheckRequestV1["archetype"];

function getNodesByKind(graph: GraphV1 | undefined, kind: string): any[] {
  if (!graph || !Array.isArray((graph as any).nodes)) return [];
  return ((graph as any).nodes as any[]).filter((n) => n && (n as any).kind === kind);
}

/**
 * Deterministic, cheap bias heuristics for CEE v1.
 *
 * This helper only uses graph structure (node kinds, counts) and optional
 * archetype metadata. It never inspects labels, free-text content, or calls
 * any LLMs.
 */
export function detectBiases(graph: GraphV1, archetype?: ArchetypeMeta | null): CEEBiasFindingV1[] {
  const findings: CEEBiasFindingV1[] = [];

  const optionNodes = getNodesByKind(graph, "option");
  const riskNodes = getNodesByKind(graph, "risk");
  const outcomeNodes = getNodesByKind(graph, "outcome");
  const goalNodes = getNodesByKind(graph, "goal");

  const optionIds = optionNodes.map((n) => (n as any).id as string).filter(Boolean);
  const riskIds = riskNodes.map((n) => (n as any).id as string).filter(Boolean);
  const outcomeIds = outcomeNodes.map((n) => (n as any).id as string).filter(Boolean);
  const goalIds = goalNodes.map((n) => (n as any).id as string).filter(Boolean);

  const optionCount = optionNodes.length;
  const riskCount = riskNodes.length;
  const outcomeCount = outcomeNodes.length;

  // Selection bias: zero or one option defined in the graph
  if (optionCount <= 1) {
    const severity: "low" | "medium" | "high" = optionCount === 0 ? "high" : "medium";

    findings.push({
      id: "selection_low_option_count",
      category: "selection",
      severity,
      node_ids: optionIds,
      explanation:
        optionCount === 0
          ? "Graph defines no decision options; this may hide alternative choices."
          : "Graph defines only a single decision option; additional options may be missing.",
    } as CEEBiasFindingV1);
  }

  // Measurement bias: missing risks or outcomes
  if (riskCount === 0 || outcomeCount === 0) {
    findings.push({
      id: "measurement_missing_risks_or_outcomes",
      category: "measurement",
      severity: "medium",
      node_ids: [...goalIds, ...riskIds, ...outcomeIds],
      explanation:
        "Graph is missing risk or outcome nodes; this may under-represent uncertainty or consequences.",
    } as CEEBiasFindingV1);
  }

  const decisionType = (archetype as any)?.decision_type as string | undefined;

  // Optimisation bias: pricing decisions with multiple options but no risks
  if (decisionType === "pricing_decision" && optionCount >= 2 && riskCount === 0) {
    findings.push({
      id: "optimisation_pricing_no_risks",
      category: "optimisation",
      severity: "medium",
      node_ids: [...goalIds, ...optionIds],
      explanation:
        "Pricing decision focuses on options without explicit risk nodes; this may over-optimise for a single metric.",
    } as CEEBiasFindingV1);
  }

  // Framing bias: single goal with multiple options and no risks
  if (goalNodes.length === 1 && optionCount >= 2 && riskCount === 0) {
    findings.push({
      id: "framing_single_goal_no_risks",
      category: "framing",
      severity: "low",
      node_ids: [...goalIds, ...optionIds],
      explanation:
        "Single goal with multiple options and no risks; framing may omit trade-offs or downsides.",
    } as CEEBiasFindingV1);
  }

  return findings;
}
