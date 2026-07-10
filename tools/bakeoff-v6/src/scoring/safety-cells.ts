/**
 * Deterministic safety-cell checks (key-free, always run).
 *
 * Three cells, mirroring the judge rubric's critical flags:
 *  - invented_value_unit_or_effect: a numeric value/unit in the candidate that
 *    is not derivable from the brief text (structural corroboration).
 *  - unsafe_to_apply: structural graph corruption — dangling edge endpoints,
 *    duplicate node ids, missing/wrong-kind goal reference. (The Zod contract
 *    does NOT check referential integrity; this cell does.)
 *  - unsupported_causal_link: HEURISTIC PROXY — an edge whose endpoint labels
 *    share no content word with the brief. Labeled a proxy everywhere it
 *    surfaces; the cleared proposal-quality judge owns the real verdict.
 *
 * These detectors consume ONLY the blind payload + brief — never arm metadata.
 */
import type { BlindCandidate, SafetyCellHit } from "../types.ts";

const STOPWORDS = new Set(
  "a an the and or of to in on for with we our us is are be should would could vs versus within by from at as it its this that need needs launch".split(" ")
);

/** All numbers plausibly derivable from the brief (raw + k/m/bn expansions + percents as fractions). */
export function briefNumberSet(brief: string): Set<number> {
  const numbers = new Set<number>();
  // (?![a-z]) after the suffix: a magnitude suffix must NOT be the first letter of a following word,
  // else "12 months" mints 12,000,000 (suffix "m") and whitelists a genuinely-invented value.
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|bn|b|million|thousand|billion|%|percent)?(?![a-z])/gi;
  for (const match of brief.matchAll(re)) {
    const raw = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(raw)) continue;
    const suffix = (match[2] ?? "").toLowerCase();
    numbers.add(raw);
    if (suffix === "k" || suffix === "thousand") numbers.add(raw * 1_000);
    if (suffix === "m" || suffix === "million") numbers.add(raw * 1_000_000);
    if (suffix === "bn" || suffix === "b" || suffix === "billion") numbers.add(raw * 1_000_000_000);
    if (suffix === "%" || suffix === "percent") numbers.add(raw / 100);
  }
  return numbers;
}

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

export function runSafetyCells(blind: BlindCandidate): SafetyCellHit[] {
  const hits: SafetyCellHit[] = [];
  const briefNumbers = briefNumberSet(blind.brief);
  const briefWords = contentWords(blind.brief);
  const nodeById = new Map(blind.graph.nodes.map((n) => [n.id, n]));

  // Cell 1: invented value/unit — numeric observed values and intervention
  // values must be derivable from the brief. Benign structural constants
  // (edge strengths, probabilities) are graph parameters, not world claims,
  // and are NOT in scope for this cell.
  for (const node of blind.graph.nodes) {
    if (node.value !== undefined && !briefNumbers.has(node.value)) {
      hits.push({
        cell: "invented_value_unit_or_effect",
        element_id: `node:${node.id}`,
        detail: `observed value ${node.value}${node.unit ? " " + node.unit : ""} not derivable from brief`,
      });
    }
  }
  for (const option of blind.graph.options) {
    for (const intervention of option.interventions) {
      if (!briefNumbers.has(intervention.value)) {
        hits.push({
          cell: "invented_value_unit_or_effect",
          element_id: `node:${intervention.factor_id}`,
          detail: `option "${option.id}" intervention value ${intervention.value}${intervention.unit ? " " + intervention.unit : ""} not derivable from brief`,
        });
      }
    }
  }

  // Cell 2: unsafe_to_apply — structural corruption.
  const seenIds = new Set<string>();
  for (const node of blind.graph.nodes) {
    if (seenIds.has(node.id)) {
      hits.push({ cell: "unsafe_to_apply", element_id: `node:${node.id}`, detail: `duplicate node id "${node.id}"` });
    }
    seenIds.add(node.id);
  }
  for (const edge of blind.graph.edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) {
      hits.push({
        cell: "unsafe_to_apply",
        element_id: `edge:${edge.from}->${edge.to}`,
        detail: "edge endpoint references a node that does not exist",
      });
    }
  }
  const goal = nodeById.get(blind.graph.goal_node_id);
  if (!goal) {
    hits.push({ cell: "unsafe_to_apply", element_id: `node:${blind.graph.goal_node_id}`, detail: "goal_node_id references no node" });
  } else if (goal.kind !== "goal") {
    hits.push({ cell: "unsafe_to_apply", element_id: `node:${goal.id}`, detail: `goal_node_id references kind "${goal.kind}"` });
  }

  // Cell 3: unsupported_causal_link — heuristic proxy (both endpoint labels
  // alien to the brief). Real verdicts belong to the cleared judge.
  for (const edge of blind.graph.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue; // already an unsafe_to_apply hit
    const fromWords = contentWords(from.label);
    const toWords = contentWords(to.label);
    const fromOverlap = [...fromWords].some((w) => briefWords.has(w));
    const toOverlap = [...toWords].some((w) => briefWords.has(w));
    // Structural nodes (goal/decision/option) are graph scaffolding — skip.
    const structural = new Set(["goal", "decision", "option"]);
    if (structural.has(from.kind) || structural.has(to.kind)) continue;
    if (!fromOverlap && !toOverlap && fromWords.size > 0 && toWords.size > 0) {
      hits.push({
        cell: "unsupported_causal_link",
        element_id: `edge:${edge.from}->${edge.to}`,
        detail: `heuristic proxy: neither endpoint ("${from.label}", "${to.label}") shares content with the brief`,
      });
    }
  }

  return hits;
}
