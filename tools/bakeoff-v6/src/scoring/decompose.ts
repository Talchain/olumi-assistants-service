/**
 * Method-blind decomposer: one candidate graph -> delta elements vs the
 * NEUTRAL shared seed. For this generation bake-off the seed S is the EMPTY
 * graph (arms draft from a brief), so every node, edge and defer artifact is
 * a delta element. The decomposition is identical for every arm — an arm can
 * never score differently because its output "decomposes more cleanly";
 * whole-graph quality is guarded separately by the holistic scorer.
 */
import type { BlindCandidate } from "../types.ts";

export interface DecomposedElement {
  element_id: string;
  element_kind: "node" | "edge" | "artifact";
  /** Normalized display text used for duplicate detection and R matching. */
  text: string;
  node_kind?: string;
  from?: string;
  to?: string;
}

export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function decompose(blind: BlindCandidate): DecomposedElement[] {
  const elements: DecomposedElement[] = [];
  for (const node of blind.graph.nodes) {
    elements.push({
      element_id: `node:${node.id}`,
      element_kind: "node",
      text: normalizeText(node.label),
      node_kind: node.kind,
    });
  }
  for (const edge of blind.graph.edges) {
    elements.push({
      element_id: `edge:${edge.from}->${edge.to}`,
      element_kind: "edge",
      text: `${edge.from} -> ${edge.to} (${edge.effect_direction})`,
      from: edge.from,
      to: edge.to,
    });
  }
  blind.open_questions.forEach((question, i) => {
    elements.push({
      element_id: `artifact:${i}`,
      element_kind: "artifact",
      text: normalizeText(question),
    });
  });
  return elements;
}
