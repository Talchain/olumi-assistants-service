/**
 * Deterministic intent classifier for the `add_risk` edit template.
 *
 * Pure regex / string ops — no LLM, no I/O. Target latency < 5ms.
 *
 * Returns `add_risk` only on high-confidence matches:
 *   - Anchored, case-insensitive patterns capturing a label group
 *   - Patterns are END-anchored (with optional trailing punctuation only)
 *     so compound requests fall through to the LLM path
 *   - Label is not a pronoun / demonstrative / too short / too long /
 *     punctuation-heavy / control-char-bearing
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

// All patterns are END-ANCHORED (with optional trailing punctuation only) so
// compound requests like "Add team dynamics as a risk and connect it to
// churn" do NOT match — they fall through to the LLM path which can handle
// the second clause. A naïve non-anchored match would silently drop the
// trailing instruction.
const TRAILING_PUNCT = `\\s*[.!?]?\\s*$`;
const PATTERNS: ReadonlyArray<RegExp> = [
  new RegExp(`^\\s*(?:please\\s+)?add\\s+(.+?)\\s+as\\s+a\\s+risk${TRAILING_PUNCT}`, 'i'),
  new RegExp(`^\\s*(?:please\\s+)?include\\s+(.+?)\\s+as\\s+a\\s+risk${TRAILING_PUNCT}`, 'i'),
  new RegExp(`^\\s*(?:we should\\s+)?add\\s+(.+?)\\s+risk${TRAILING_PUNCT}`, 'i'),
  new RegExp(`^\\s*(.+?)\\s+is\\s+a\\s+risk(?:\\s+we should consider)?${TRAILING_PUNCT}`, 'i'),
];

const PRONOUN_DEMONSTRATIVE_RE =
  /^(this|that|it|its|it's|these|those|they|them|one|ones|something|anything|everything|nothing)$/i;

// Reject labels whose punctuation density exceeds this fraction — a heuristic
// guard against "team dynamics, !!!" or smuggled JSON / markdown fragments
// being baked into a node ID and the user-facing assistant text.
const MAX_PUNCT_DENSITY = 0.4;
const PUNCT_RE = /[!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~]/g;

// ASCII control chars (0x00-0x1F, 0x7F) plus zero-width / BiDi formatting
// chars. These should never appear in a label fed into a deterministic ID +
// UI string.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1F\x7F​-‏‪-‮⁠-⁤]/;

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
  // Reject control / zero-width / BiDi formatting characters.
  if (CONTROL_CHAR_RE.test(label)) return false;
  // Reject high punctuation density (smuggled syntax / spam).
  const punctMatches = label.match(PUNCT_RE);
  const punctCount = punctMatches ? punctMatches.length : 0;
  if (punctCount / label.length > MAX_PUNCT_DENSITY) return false;
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
