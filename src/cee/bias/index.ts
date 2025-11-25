import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";
import { applyBiasDefinition } from "./library.js";
import {
  detectAvailabilityBias,
  detectOptimismBias,
  detectOverconfidenceBias,
  detectAuthorityBias,
  detectFramingEffectBias,
  detectStatusQuoBias,
} from "./detectors.js";

type CEEBiasFindingV1 = components["schemas"]["CEEBiasFindingV1"];
type CEEBiasCheckRequestV1 = components["schemas"]["CEEBiasCheckRequestV1"];

type ArchetypeMeta = CEEBiasCheckRequestV1["archetype"];

function structuralBiasEnabled(): boolean {
  const flag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
  if (flag === undefined) {
    return false;
  }
  return flag === "true" || flag === "1";
}

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
      code: "SELECTION_LOW_OPTION_COUNT",
      targets: {
        node_ids: optionIds,
      },
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
      code: "MEASUREMENT_MISSING_RISKS_OR_OUTCOMES",
      targets: {
        node_ids: [...goalIds, ...riskIds, ...outcomeIds],
      },
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
      code: "OPTIMISATION_PRICING_NO_RISKS",
      targets: {
        node_ids: [...goalIds, ...optionIds],
      },
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
      code: "FRAMING_SINGLE_GOAL_NO_RISKS",
      targets: {
        node_ids: [...goalIds, ...optionIds],
      },
    } as CEEBiasFindingV1);
  }

  if (structuralBiasEnabled()) {
    const structuralDetectors: (CEEBiasFindingV1 | null)[] = [
      detectAvailabilityBias(graph),
      detectStatusQuoBias(graph),
      detectOptimismBias(graph),
      detectOverconfidenceBias(graph),
      detectAuthorityBias(graph),
      detectFramingEffectBias(graph),
    ];

    for (const finding of structuralDetectors) {
      if (finding) {
        findings.push(finding);
      }
    }

    const edges = Array.isArray((graph as any).edges) ? ((graph as any).edges as any[]) : [];

    // Structural confirmation bias: one option has explicit risks/outcomes while others have none.
    if (optionCount >= 2 && (riskCount > 0 || outcomeCount > 0) && edges.length > 0) {
      const optionIdSet = new Set(optionIds);
      const evidenceIdSet = new Set([...riskIds, ...outcomeIds]);

      const evidenceCountByOption = new Map<string, number>();
      for (const id of optionIds) {
        evidenceCountByOption.set(id, 0);
      }

      for (const edge of edges) {
        const from = (edge as any).from as string | undefined;
        const to = (edge as any).to as string | undefined;
        if (!from || !to) continue;

        if (optionIdSet.has(from) && evidenceIdSet.has(to)) {
          evidenceCountByOption.set(from, (evidenceCountByOption.get(from) ?? 0) + 1);
        }
        if (optionIdSet.has(to) && evidenceIdSet.has(from)) {
          evidenceCountByOption.set(to, (evidenceCountByOption.get(to) ?? 0) + 1);
        }
      }

      const optionsWithEvidence: string[] = [];
      const optionsWithoutEvidence: string[] = [];

      for (const id of optionIds) {
        const count = evidenceCountByOption.get(id) ?? 0;
        if (count > 0) {
          optionsWithEvidence.push(id);
        } else {
          optionsWithoutEvidence.push(id);
        }
      }

      if (optionsWithEvidence.length === 1 && optionsWithoutEvidence.length >= 1) {
        const relatedNodeIds = [...optionsWithEvidence, ...optionsWithoutEvidence];
        findings.push({
          id: "confirmation_unbalanced_evidence",
          category: "other",
          severity: "medium",
          node_ids: relatedNodeIds,
          explanation:
            "One option has explicit risks or outcomes while alternative options have none; this may indicate confirmation bias toward the best-documented path.",
          code: "CONFIRMATION_BIAS",
          targets: {
            node_ids: relatedNodeIds,
          },
        } as CEEBiasFindingV1);
      }
    }

    // Structural sunk cost bias: single option with multiple actions attached.
    const actionNodes = getNodesByKind(graph, "action");
    const actionIds = actionNodes.map((n) => (n as any).id as string).filter(Boolean);
    const actionCount = actionNodes.length;

    if (optionCount === 1 && actionCount >= 3) {
      const soleOptionId = optionIds[0];
      const relatedNodeIds = [soleOptionId, ...actionIds];

      findings.push({
        id: "sunk_cost_single_option_actions",
        category: "other",
        severity: "medium",
        node_ids: relatedNodeIds,
        explanation:
          "Graph shows a single option with multiple attached actions; this may indicate sunk cost bias towards continuing an existing path.",
        code: "SUNK_COST",
        targets: {
          node_ids: relatedNodeIds,
        },
      } as CEEBiasFindingV1);
    }
  }

  type BiasFindingWithCode = CEEBiasFindingV1 & { code?: string };

  const enrichedFindings = findings.map((finding) => {
    const withCode = finding as BiasFindingWithCode;
    return withCode.code ? applyBiasDefinition(withCode, withCode.code) : finding;
  });

  return enrichedFindings;
}

const severityOrder: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const categoryOrder: Record<string, number> = {
  selection: 0,
  measurement: 1,
  optimisation: 2,
  framing: 3,
  other: 4,
};

function getSeverityRank(severity: unknown): number {
  const key = typeof severity === "string" ? severity : "";
  return severityOrder[key] ?? 999;
}

function getCategoryRank(category: unknown): number {
  const key = typeof category === "string" ? category : "";
  return categoryOrder[key] ?? 999;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export function sortBiasFindings(findings: CEEBiasFindingV1[], seed?: string): CEEBiasFindingV1[] {
  if (!Array.isArray(findings) || findings.length <= 1) {
    return findings.slice();
  }

  const seedPrefix = typeof seed === "string" && seed.length > 0 ? seed : "";

  return findings
    .slice()
    .sort((a, b) => {
      const sevDiff = getSeverityRank(a.severity) - getSeverityRank(b.severity);
      if (sevDiff !== 0) return sevDiff;

      const catDiff = getCategoryRank(a.category) - getCategoryRank(b.category);
      if (catDiff !== 0) return catDiff;

      const aId = (a.id ?? "") as string;
      const bId = (b.id ?? "") as string;

      if (seedPrefix) {
        const aHash = hashString(`${seedPrefix}:${aId}`);
        const bHash = hashString(`${seedPrefix}:${bId}`);
        if (aHash !== bHash) {
          return aHash < bHash ? -1 : 1;
        }
      }

      const idDiff = aId.localeCompare(bId);
      if (idDiff !== 0) return idDiff;

      const aFirstNode = Array.isArray(a.node_ids) && a.node_ids.length > 0 ? a.node_ids[0] : "";
      const bFirstNode = Array.isArray(b.node_ids) && b.node_ids.length > 0 ? b.node_ids[0] : "";

      return aFirstNode.localeCompare(bFirstNode);
    });
}
