import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";
import { BIAS_DEFINITIONS } from "./library.js";

type CEEBiasFindingV1 = components["schemas"]["CEEBiasFindingV1"];

type Severity = CEEBiasFindingV1["severity"];

type Category = CEEBiasFindingV1["category"];

type NodeLike = { id?: string; kind?: string; label?: string } & Record<string, unknown>;

type EdgeLike = {
  from?: string;
  to?: string;
  // V4 fields (preferred)
  strength_mean?: number;
  belief_exists?: number;
  // Legacy fields (fallback)
  weight?: number;
  belief?: number;
} & Record<string, unknown>;

function getNodes(graph: GraphV1 | undefined): NodeLike[] {
  if (!graph || !Array.isArray((graph as any).nodes)) return [];
  return (graph as any).nodes as NodeLike[];
}

function getEdges(graph: GraphV1 | undefined): EdgeLike[] {
  if (!graph || !Array.isArray((graph as any).edges)) return [];
  return (graph as any).edges as EdgeLike[];
}

function getNodesByKind(graph: GraphV1 | undefined, kind: string): NodeLike[] {
  return getNodes(graph).filter((n) => n && n.kind === kind);
}

function toIds(nodes: NodeLike[]): string[] {
  return nodes
    .map((n) => n.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

// Availability bias: recency-weighted evidence
export function detectAvailabilityBias(graph: GraphV1 | undefined): CEEBiasFindingV1 | null {
  const evidenceNodes = getNodes(graph).filter((n) => {
    return n.kind === "evidence" || n.kind === "risk" || n.kind === "outcome";
  });

  if (evidenceNodes.length < 3) return null;

  const recencyMarkers = /\b(recent|latest|just|yesterday|today|this week|this month|new)\b/i;

  const recentEvidence = evidenceNodes.filter((n) => {
    const label = typeof n.label === "string" ? n.label : "";
    return recencyMarkers.test(label);
  });

  if (recentEvidence.length === 0) return null;

  const ratio = recentEvidence.length / evidenceNodes.length;
  if (!(ratio > 0.6)) return null;

  const def = BIAS_DEFINITIONS["AVAILABILITY_BIAS"];
  if (!def) return null;

  const nodeIds = toIds(recentEvidence);
  if (nodeIds.length === 0) return null;

  const severity: Severity = ratio > 0.8 ? "high" : "medium";
  const confidence_band: CEEBiasFindingV1["confidence_band"] =
    evidenceNodes.length >= 5 ? "high" : "medium";

  const finding: CEEBiasFindingV1 = {
    id: "availability_recency_clustering",
    category: "other" as Category,
    severity,
    node_ids: nodeIds,
    explanation:
      `${recentEvidence.length}/${evidenceNodes.length} evidence-related nodes reference recent events; longer-term data may be under-represented.`,
    code: def.code,
    targets: { node_ids: nodeIds },
    structural_pattern: `${Math.round(ratio * 100)}% of evidence-related nodes are marked as recent`,
    confidence_band,
  };

  return finding;
}

export function detectOptimismBias(graph: GraphV1 | undefined): CEEBiasFindingV1 | null {
  const optionNodes = getNodesByKind(graph, "option");
  const outcomeNodes = getNodesByKind(graph, "outcome");
  const riskNodes = getNodesByKind(graph, "risk");

  if (optionNodes.length === 0 || outcomeNodes.length === 0) return null;

  const edges = getEdges(graph);
  if (edges.length === 0) return null;

  const optionIdSet = new Set(toIds(optionNodes));
  const outcomeIdSet = new Set(toIds(outcomeNodes));
  const riskIdSet = new Set(toIds(riskNodes));

  let outcomeEdges = 0;
  let riskEdges = 0;

  for (const edge of edges) {
    const from = edge.from as string | undefined;
    const to = edge.to as string | undefined;
    if (!from || !to) continue;

    const fromIsOption = optionIdSet.has(from);
    const toIsOption = optionIdSet.has(to);
    const fromIsOutcome = outcomeIdSet.has(from);
    const toIsOutcome = outcomeIdSet.has(to);
    const fromIsRisk = riskIdSet.has(from);
    const toIsRisk = riskIdSet.has(to);

    if ((fromIsOption && toIsOutcome) || (toIsOption && fromIsOutcome)) {
      outcomeEdges += 1;
    }
    if ((fromIsOption && toIsRisk) || (toIsOption && fromIsRisk)) {
      riskEdges += 1;
    }
  }

  if (!(outcomeEdges >= 1 && riskEdges === 0)) {
    return null;
  }

  const def = BIAS_DEFINITIONS["OPTIMISM_BIAS"];
  if (!def) return null;

  const node_ids = [...toIds(optionNodes), ...toIds(outcomeNodes)];
  if (node_ids.length === 0) return null;

  const finding: CEEBiasFindingV1 = {
    id: "optimism_outcomes_no_risks",
    category: "other" as Category,
    severity: "medium",
    node_ids,
    explanation:
      "Options connect to outcomes but not to explicit risk nodes; potential downsides may be under-represented.",
    code: def.code,
    targets: { node_ids },
    structural_pattern: `Options have ${outcomeEdges} edges to outcomes and 0 edges to risks`,
    confidence_band: "medium",
  };

  return finding;
}

export function detectOverconfidenceBias(graph: GraphV1 | undefined): CEEBiasFindingV1 | null {
  const edges = getEdges(graph) as any[];
  if (edges.length === 0) return null;

  // V4 field takes precedence, fallback to legacy
  const edgesWithBelief = edges
    .map((e) => ({ ...e, _belief: e?.belief_exists ?? e?.belief }))
    .filter((e) => typeof e._belief === "number" && Number.isFinite(e._belief));

  if (edgesWithBelief.length < 3) return null;

  const beliefs = edgesWithBelief.map((e) => e._belief as number);
  const minBelief = Math.min(...beliefs);
  const maxBelief = Math.max(...beliefs);

  if (!(minBelief >= 0.7 && maxBelief - minBelief <= 0.15)) {
    return null;
  }

  const def = BIAS_DEFINITIONS["OVERCONFIDENCE"];
  if (!def) return null;

  const nodeIdSet = new Set<string>();
  for (const e of edgesWithBelief) {
    if (typeof e.from === "string") nodeIdSet.add(e.from);
    if (typeof e.to === "string") nodeIdSet.add(e.to);
  }

  const node_ids = Array.from(nodeIdSet.values());
  if (node_ids.length === 0) return null;

  const severity: Severity = minBelief >= 0.9 ? "high" : "medium";

  const finding: CEEBiasFindingV1 = {
    id: "overconfidence_narrow_belief_band",
    category: "other" as Category,
    severity,
    node_ids,
    explanation:
      "Edge beliefs are all high and tightly clustered; probability estimates may be over-confident.",
    code: def.code,
    targets: { node_ids },
    structural_pattern: `Belief values in high, narrow band [${minBelief.toFixed(
      2,
    )}, ${maxBelief.toFixed(2)}] across ${beliefs.length} edges`,
    confidence_band: "medium",
  };

  return finding;
}

export function detectAuthorityBias(graph: GraphV1 | undefined): CEEBiasFindingV1 | null {
  const nodes = getNodes(graph);
  if (nodes.length === 0) return null;

  const authorityMarkers = /\b(ceo|cfo|coo|cto|vp|vice president|director|executive|founder|manager|lead|expert|consultant|board)\b/i;

  const authorityNodes = nodes.filter((n) => {
    const label = typeof n.label === "string" ? n.label : "";
    return authorityMarkers.test(label);
  });

  if (authorityNodes.length === 0) return null;

  const authorityIds = toIds(authorityNodes);
  const authorityIdSet = new Set(authorityIds);
  if (authorityIdSet.size === 0) return null;

  const edges = getEdges(graph);
  if (edges.length === 0) return null;

  const connectionCount = new Map<string, number>();
  const neighbourIds = new Set<string>();

  for (const edge of edges) {
    const from = edge.from as string | undefined;
    const to = edge.to as string | undefined;
    if (!from || !to) continue;

    if (authorityIdSet.has(from)) {
      connectionCount.set(from, (connectionCount.get(from) ?? 0) + 1);
      neighbourIds.add(to);
    }
    if (authorityIdSet.has(to)) {
      connectionCount.set(to, (connectionCount.get(to) ?? 0) + 1);
      neighbourIds.add(from);
    }
  }

  const influentialAuthorities = authorityIds.filter(
    (id) => (connectionCount.get(id) ?? 0) >= 3,
  );

  if (influentialAuthorities.length === 0) {
    return null;
  }

  const def = BIAS_DEFINITIONS["AUTHORITY_BIAS"];
  if (!def) return null;

  const node_ids = [...new Set([...influentialAuthorities, ...neighbourIds])];
  if (node_ids.length === 0) return null;

  const finding: CEEBiasFindingV1 = {
    id: "authority_high_degree_node",
    category: "other" as Category,
    severity: "medium",
    node_ids,
    explanation:
      "One or more authority-labelled nodes are highly connected in the decision graph; this may overweight senior opinions.",
    code: def.code,
    targets: { node_ids },
    structural_pattern: "Authority-labelled node has connections to three or more other nodes",
    confidence_band: "medium",
  };

  return finding;
}

export function detectFramingEffectBias(graph: GraphV1 | undefined): CEEBiasFindingV1 | null {
  const outcomeNodes = getNodesByKind(graph, "outcome");
  if (outcomeNodes.length < 2) return null;

  const goalNodes = getNodesByKind(graph, "goal");
  const goalIds = toIds(goalNodes);

  const framingByPercent = new Map<
    number,
    {
      positive: string[];
      negative: string[];
    }
  >();

  for (const node of outcomeNodes) {
    const label = typeof node.label === "string" ? node.label : "";
    if (!label) continue;

    const percentMatch = label.match(/(\d{1,3})\s*%/);
    if (!percentMatch) continue;

    const pct = Number(percentMatch[1]);
    if (!Number.isFinite(pct)) continue;

    const isPositive = /\b(save|gain|benefit|success|survive|improve|win)\b/i.test(label);
    const isNegative = /\b(loss|cost|failure|die|death|harm|risk)\b/i.test(label);
    if (!isPositive && !isNegative) continue;

    const id = typeof node.id === "string" ? node.id : undefined;
    if (!id) continue;

    const entry = framingByPercent.get(pct) ?? { positive: [] as string[], negative: [] as string[] };
    if (isPositive) entry.positive.push(id);
    if (isNegative) entry.negative.push(id);
    framingByPercent.set(pct, entry);
  }

  let chosenPercent: number | null = null;
  let framedNodeIds: string[] | null = null;

  for (const [pct, entry] of framingByPercent.entries()) {
    if (entry.positive.length > 0 && entry.negative.length > 0) {
      chosenPercent = pct;
      framedNodeIds = [...entry.positive, ...entry.negative];
      break;
    }
  }

  if (!framedNodeIds || framedNodeIds.length === 0 || chosenPercent === null) {
    return null;
  }

  const def = BIAS_DEFINITIONS["FRAMING_EFFECT"];
  if (!def) return null;

  const node_ids = [...new Set([...goalIds, ...framedNodeIds])];
  if (node_ids.length === 0) return null;

  const finding: CEEBiasFindingV1 = {
    id: "framing_gain_vs_loss_percentages",
    category: "framing" as Category,
    severity: "medium",
    node_ids,
    explanation:
      `Outcomes describe the same ${chosenPercent}% probability using both gain- and loss-framed language.`,
    code: def.code,
    targets: { node_ids },
    structural_pattern: `Outcomes share ${chosenPercent}% but mix gain- and loss-framed wording`,
    confidence_band: "medium",
  };

  return finding;
}

export function detectStatusQuoBias(graph: GraphV1 | undefined): CEEBiasFindingV1 | null {
  const optionNodes = getNodesByKind(graph, "option");
  if (optionNodes.length === 0) return null;

  const statusQuoMarkers = /\b(keep|maintain|continue|current|existing|status quo|as-is|as is)\b/i;
  const changeMarkers = /\b(change|new|switch|replace|upgrade|transform|migrate|redesign|relaunch)\b/i;

  const statusQuoOptions = optionNodes.filter((n) => {
    const label = typeof n.label === "string" ? n.label : "";
    return statusQuoMarkers.test(label);
  });

  const changeOptions = optionNodes.filter((n) => {
    const label = typeof n.label === "string" ? n.label : "";
    return changeMarkers.test(label);
  });

  if (statusQuoOptions.length === 0 || changeOptions.length === 0) {
    return null;
  }

  const riskNodes = getNodesByKind(graph, "risk");
  const riskIdSet = new Set(toIds(riskNodes));
  if (riskIdSet.size === 0) return null;

  const edges = getEdges(graph);
  if (edges.length === 0) return null;

  const countRiskEdges = (nodes: NodeLike[]): number => {
    const optionIdSet = new Set(toIds(nodes));
    if (optionIdSet.size === 0) return 0;

    let count = 0;
    for (const e of edges) {
      const from = e.from;
      const to = e.to;
      if (!from || !to) continue;

      if (optionIdSet.has(from) && riskIdSet.has(to)) {
        count += 1;
      } else if (optionIdSet.has(to) && riskIdSet.has(from)) {
        count += 1;
      }
    }
    return count;
  };

  const statusQuoRisks = countRiskEdges(statusQuoOptions);
  const changeRisks = countRiskEdges(changeOptions);

  if (!(changeRisks >= 2 && changeRisks >= statusQuoRisks * 2)) {
    return null;
  }

  const def = BIAS_DEFINITIONS["STATUS_QUO_BIAS"];
  if (!def) return null;

  const node_ids = [...toIds(statusQuoOptions), ...toIds(changeOptions)];
  if (node_ids.length === 0) return null;

  const ratioText = statusQuoRisks === 0
    ? ">=2"
    : (changeRisks / Math.max(1, statusQuoRisks)).toFixed(1).replace(/\.0$/, "");

  const finding: CEEBiasFindingV1 = {
    id: "status_quo_risk_asymmetry",
    category: "other" as Category,
    severity: "medium",
    node_ids,
    explanation: `Change options have ${changeRisks} risks attached vs ${statusQuoRisks} for status quo`,
    code: def.code,
    targets: { node_ids },
    structural_pattern: `Risk edges are ${ratioText}x higher for change options`,
    confidence_band: "medium",
  };

  return finding;
}
