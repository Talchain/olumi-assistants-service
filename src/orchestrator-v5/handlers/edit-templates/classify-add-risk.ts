/**
 * Deterministic intent classifier for the `add_risk` edit template.
 *
 * Pure regex / string ops — no LLM, no I/O. Target latency < 5ms.
 *
 * Returns `add_risk` only on high-confidence matches:
 *   - Anchored, case-insensitive patterns capturing a label group
 *   - Label is not a pronoun / demonstrative / too short / too long
 *   - The slugified risk node ID does not already exist in the graph
 *
 * Anything else returns `llm_required` so the caller falls through to the
 * existing `handleEditGraph` LLM path.
 *
 * NOTE on naming: `classifyEditIntent` is already exported by
 * `src/orchestrator/tools/edit-graph.ts` with a different signature
 * (returns `EditIntentCategory` for the LLM prompt). Hence
 * `classifyAddRiskIntent` here.
 */

import type { GraphV3T } from "../../../schemas/cee-v3.js";

export type AddRiskIntent =
  | { intent: 'add_risk'; label: string; confidence: 'high' }
  | { intent: 'llm_required' };

const PATTERNS: ReadonlyArray<RegExp> = [
  /^\s*(?:please\s+)?add\s+(.+?)\s+as\s+a\s+risk\b/i,
  /^\s*(?:please\s+)?include\s+(.+?)\s+as\s+a\s+risk\b/i,
  /^\s*(?:we should\s+)?add\s+(.+?)\s+risk\b/i,
  /^\s*(.+?)\s+is\s+a\s+risk(?:\s+we should consider)?\b/i,
];

const PRONOUN_DEMONSTRATIVE_RE =
  /^(this|that|it|its|it's|these|those|they|them|one|ones|something|anything|everything|nothing)$/i;

const MIN_LABEL_LEN = 3;
const MAX_LABEL_LEN = 80;

export function classifyAddRiskIntent(message: string, graph: GraphV3T): AddRiskIntent {
  const trimmed = message.trim();
  if (trimmed.length === 0) return { intent: 'llm_required' };

  for (const re of PATTERNS) {
    const match = re.exec(trimmed);
    if (!match) continue;
    const rawLabel = (match[1] ?? '').trim();
    if (!isAcceptableLabel(rawLabel)) return { intent: 'llm_required' };

    const id = riskNodeIdFor(rawLabel);
    if (graph.nodes.some((n) => n.id === id)) return { intent: 'llm_required' };

    return { intent: 'add_risk', label: rawLabel, confidence: 'high' };
  }

  return { intent: 'llm_required' };
}

function isAcceptableLabel(label: string): boolean {
  if (label.length < MIN_LABEL_LEN || label.length > MAX_LABEL_LEN) return false;
  // Reject pure pronouns / demonstratives.
  if (PRONOUN_DEMONSTRATIVE_RE.test(label)) return false;
  // Reject all-whitespace / all-punctuation.
  if (!/[a-z0-9]/i.test(label)) return false;
  return true;
}

export function riskNodeIdFor(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `risk_${slug}`;
}
