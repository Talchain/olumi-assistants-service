import type { GraphV1 } from "../../contracts/plot/engine.js";
import { randomUUID } from "node:crypto";

export type AmbiguityType =
  | "missing_node"
  | "uncertain_edge"
  | "multiple_interpretations";

export interface Ambiguity {
  id: string;
  type: AmbiguityType;
  location?: { node_id?: string; edge_id?: string };
  description: string;
  confidence: number;
}

interface NodeInfo {
  id: string;
  kind: string;
  label?: string;
}

interface EdgeInfo {
  from: string;
  to: string;
  // Normalized belief value (V4 takes precedence over legacy)
  belief?: number;
}

function extractNodes(graph: GraphV1): NodeInfo[] {
  if (!graph.nodes || !Array.isArray(graph.nodes)) return [];
  return graph.nodes.map((n: any) => ({
    id: n.id as string,
    kind: n.kind as string,
    label: n.label as string | undefined,
  }));
}

function extractEdges(graph: GraphV1): EdgeInfo[] {
  const edges = (graph as any).edges;
  if (!edges || !Array.isArray(edges)) return [];
  return edges.map((e: any) => {
    // V4 field takes precedence, fallback to legacy
    const belief = e.belief_exists ?? e.belief;
    return {
      from: e.from as string,
      to: e.to as string,
      belief: typeof belief === "number" ? belief : undefined,
    };
  });
}

function findMissingNodeAmbiguities(
  graph: GraphV1,
  brief: string,
  qualityScore: number
): Ambiguity[] {
  const ambiguities: Ambiguity[] = [];
  const nodes = extractNodes(graph);
  const edges = extractEdges(graph);

  const kinds = new Map<string, number>();
  for (const node of nodes) {
    kinds.set(node.kind, (kinds.get(node.kind) ?? 0) + 1);
  }

  // Check for missing standard node types
  const expectedKinds = ["goal", "decision", "option", "outcome", "risk"];
  for (const kind of expectedKinds) {
    if (!kinds.has(kind) || kinds.get(kind) === 0) {
      // Only flag as ambiguity if quality is below threshold
      if (qualityScore < 7.0) {
        ambiguities.push({
          id: `amb_${randomUUID().slice(0, 8)}`,
          type: "missing_node",
          description: `Graph is missing ${kind} nodes which are typically important for decision modeling`,
          confidence: 0.7,
        });
      }
    }
  }

  // Check if decision nodes have at least 2 options connected
  const decisions = nodes.filter((n) => n.kind === "decision");
  for (const decision of decisions) {
    const connectedOptions = edges.filter(
      (e) =>
        e.from === decision.id &&
        nodes.some((n) => n.id === e.to && n.kind === "option")
    );
    if (connectedOptions.length < 2) {
      ambiguities.push({
        id: `amb_${randomUUID().slice(0, 8)}`,
        type: "missing_node",
        location: { node_id: decision.id },
        description: `Decision "${decision.label || decision.id}" has fewer than 2 options - more alternatives may be missing`,
        confidence: 0.8,
      });
    }
  }

  return ambiguities;
}

function findUncertainEdgeAmbiguities(
  graph: GraphV1,
  _brief: string,
  _qualityScore: number
): Ambiguity[] {
  const ambiguities: Ambiguity[] = [];
  const nodes = extractNodes(graph);
  const edges = extractEdges(graph);

  // Find edges with very low or missing belief values
  for (const edge of edges) {
    if (edge.belief !== undefined && edge.belief < 0.3) {
      const fromNode = nodes.find((n) => n.id === edge.from);
      const toNode = nodes.find((n) => n.id === edge.to);
      ambiguities.push({
        id: `amb_${randomUUID().slice(0, 8)}`,
        type: "uncertain_edge",
        location: { edge_id: `${edge.from}->${edge.to}` },
        description: `The relationship between "${fromNode?.label || edge.from}" and "${toNode?.label || edge.to}" has low confidence (${(edge.belief * 100).toFixed(0)}%)`,
        confidence: 0.6,
      });
    }
  }

  // Find decision nodes with edges that have widely varying beliefs
  const nodeKindMap = new Map(nodes.map((n) => [n.id, n.kind]));
  const decisionEdges = new Map<string, number[]>();

  for (const edge of edges) {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);
    if (fromKind === "decision" && toKind === "option" && edge.belief !== undefined) {
      const existing = decisionEdges.get(edge.from) ?? [];
      existing.push(edge.belief);
      decisionEdges.set(edge.from, existing);
    }
  }

  for (const [decisionId, beliefs] of decisionEdges) {
    if (beliefs.length >= 2) {
      const max = Math.max(...beliefs);
      const min = Math.min(...beliefs);
      const range = max - min;
      // Flag if one option dominates (very high confidence) - might indicate bias
      if (range > 0.6) {
        const decisionNode = nodes.find((n) => n.id === decisionId);
        ambiguities.push({
          id: `amb_${randomUUID().slice(0, 8)}`,
          type: "uncertain_edge",
          location: { node_id: decisionId },
          description: `Options for "${decisionNode?.label || decisionId}" have very different confidence levels - the preferred option may not be fully justified`,
          confidence: 0.5,
        });
      }
    }
  }

  return ambiguities;
}

function findMultipleInterpretationAmbiguities(
  graph: GraphV1,
  brief: string,
  _qualityScore: number
): Ambiguity[] {
  const ambiguities: Ambiguity[] = [];
  const nodes = extractNodes(graph);

  // Check for vague or generic node labels that might have multiple interpretations
  const vaguePatterns = [
    /^other$/i,
    /^misc/i,
    /^general/i,
    /^various/i,
    /^unknown/i,
    /^tbd$/i,
  ];

  for (const node of nodes) {
    if (node.label) {
      for (const pattern of vaguePatterns) {
        if (pattern.test(node.label)) {
          ambiguities.push({
            id: `amb_${randomUUID().slice(0, 8)}`,
            type: "multiple_interpretations",
            location: { node_id: node.id },
            description: `"${node.label}" is vague and could mean different things - please clarify what this represents`,
            confidence: 0.7,
          });
          break;
        }
      }
    }
  }

  // Check if brief mentions concepts not reflected in graph
  const briefWords = new Set(
    brief
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 4)
  );
  const graphLabels = new Set(
    nodes
      .filter((n) => n.label)
      .flatMap((n) =>
        n.label!
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 4)
      )
  );

  // Find important brief concepts not in graph
  const importantKeywords = [
    "competitor",
    "customer",
    "revenue",
    "cost",
    "timeline",
    "team",
    "risk",
    "market",
    "growth",
    "profit",
    "strategy",
  ];

  for (const keyword of importantKeywords) {
    if (briefWords.has(keyword) && !graphLabels.has(keyword)) {
      // Only add if quality is mediocre
      ambiguities.push({
        id: `amb_${randomUUID().slice(0, 8)}`,
        type: "multiple_interpretations",
        description: `Your brief mentions "${keyword}" but it's not explicitly modeled in the graph - should it be a factor?`,
        confidence: 0.5,
      });
    }
  }

  // Limit to top 3 interpretation ambiguities
  return ambiguities.slice(0, 3);
}

export function detectAmbiguities(
  graph: GraphV1,
  brief: string,
  qualityScore: number
): Ambiguity[] {
  const ambiguities: Ambiguity[] = [];

  // If quality is already high, fewer ambiguities needed
  if (qualityScore >= 8.0) {
    return [];
  }

  ambiguities.push(...findMissingNodeAmbiguities(graph, brief, qualityScore));
  ambiguities.push(...findUncertainEdgeAmbiguities(graph, brief, qualityScore));
  ambiguities.push(
    ...findMultipleInterpretationAmbiguities(graph, brief, qualityScore)
  );

  // Sort by confidence descending and limit total
  return ambiguities
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}
