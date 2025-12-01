import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1, GraphPatchV1 } from "../../contracts/plot/engine.js";

// Lightweight, deterministic helper to derive structural mitigation patches
// from bias findings. This stays strictly metadata-only and never calls LLMs.

type CEEBiasFindingV1 = components["schemas"]["CEEBiasFindingV1"];
type CEEBiasMitigationPatchV1 = components["schemas"]["CEEBiasMitigationPatchV1"];

type NodeLike = { id?: string; kind?: string } & Record<string, unknown>;

function getNodes(graph: GraphV1 | undefined): NodeLike[] {
  if (!graph || !Array.isArray((graph as any).nodes)) return [];
  return (graph as any).nodes as NodeLike[];
}

function getNodesByKind(graph: GraphV1 | undefined, kind: string): NodeLike[] {
  return getNodes(graph).filter((n) => n && n.kind === kind);
}

function collectNodeIds(graph: GraphV1 | undefined): Set<string> {
  const ids = new Set<string>();
  for (const n of getNodes(graph)) {
    if (typeof n.id === "string" && n.id.length > 0) {
      ids.add(n.id);
    }
  }
  return ids;
}

function makeUniqueNodeId(base: string, existing: Set<string>): string {
  let index = 1;
  let id = `${base}_${index}`;
  while (existing.has(id)) {
    index += 1;
    id = `${base}_${index}`;
  }
  existing.add(id);
  return id;
}

/**
 * Build small, deterministic mitigation patches for structural biases.
 *
 * These patches are intentionally conservative:
 * - Only add minimal stub nodes (no labels or text fields).
 * - Never remove or update existing nodes/edges.
 * - At most one patch per canonical bias code.
 */
export function buildBiasMitigationPatches(
  graph: GraphV1,
  findings: CEEBiasFindingV1[],
): CEEBiasMitigationPatchV1[] {
  if (!graph || !Array.isArray((graph as any).nodes)) return [];

  const patches: CEEBiasMitigationPatchV1[] = [];
  const existingNodeIds = collectNodeIds(graph);

  const optionNodes = getNodesByKind(graph, "option");
  const riskNodes = getNodesByKind(graph, "risk");
  const outcomeNodes = getNodesByKind(graph, "outcome");

  const optionCount = optionNodes.length;
  const riskCount = riskNodes.length;
  const outcomeCount = outcomeNodes.length;

  const emittedCodes = new Set<string>();

  for (const finding of findings) {
    const code = finding.code;
    if (!code || emittedCodes.has(code)) continue;

    // Selection bias: zero or one option defined in the graph.
    if (code === "SELECTION_LOW_OPTION_COUNT") {
      const patch: GraphPatchV1 = {
        adds: {
          nodes: [
            {
              id: makeUniqueNodeId("cee_bias_mitigation_option", existingNodeIds),
              kind: "option",
            } as any,
          ],
        },
      };

      patches.push({
        bias_code: code,
        bias_id: finding.id,
        description:
          "Add at least one additional option node so the decision is not based on a single path.",
        patch,
      });
      emittedCodes.add(code);
      continue;
    }

    // Measurement / optimisation / framing cases where risks or outcomes are missing.
    if (
      code === "MEASUREMENT_MISSING_RISKS_OR_OUTCOMES" ||
      code === "OPTIMISATION_PRICING_NO_RISKS" ||
      code === "FRAMING_SINGLE_GOAL_NO_RISKS"
    ) {
      const newNodes: NodeLike[] = [];

      if (riskCount === 0) {
        newNodes.push({
          id: makeUniqueNodeId("cee_bias_mitigation_risk", existingNodeIds),
          kind: "risk",
        });
      }

      if (code === "MEASUREMENT_MISSING_RISKS_OR_OUTCOMES" && outcomeCount === 0) {
        newNodes.push({
          id: makeUniqueNodeId("cee_bias_mitigation_outcome", existingNodeIds),
          kind: "outcome",
        });
      }

      if (newNodes.length === 0) {
        emittedCodes.add(code);
        continue;
      }

      const patch: GraphPatchV1 = {
        adds: {
          nodes: newNodes as any[],
        },
      };

      let description: string;
      if (code === "MEASUREMENT_MISSING_RISKS_OR_OUTCOMES") {
        description =
          "Add explicit risk and/or outcome nodes so uncertainty and consequences are represented in the graph.";
      } else if (code === "OPTIMISATION_PRICING_NO_RISKS") {
        description =
          "Add at least one risk node linked to the pricing options so downside scenarios are captured.";
      } else {
        description =
          "Add risk or outcome nodes so both gain- and loss-framed consequences are visible.";
      }

      patches.push({
        bias_code: code,
        bias_id: finding.id,
        description,
        patch,
      });
      emittedCodes.add(code);
      continue;
    }
  }

  return patches;
}
