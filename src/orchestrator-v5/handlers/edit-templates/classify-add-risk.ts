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
//
// All accepted patterns also START with an explicit verb anchor (`add`,
// `include`, `please add`, `we should add`). The earlier draft included a
// fourth pattern of the form `(.+?) is a risk` with no leading verb anchor.
// That form was retired because the non-greedy capture combined with the
// mandatory end anchor accepted arbitrary preamble — `"I think team
// dynamics is a risk"` captured label `"I think team dynamics"` which is
// not the user's intended risk label. Statements of the form `"X is a
// risk"` now fall through to the LLM path, which has the full context to
// disambiguate. Tests in classify-add-risk.test.ts pin this behaviour.
const TRAILING_PUNCT = `\\s*[.!?]?\\s*$`;
const PATTERNS: ReadonlyArray<RegExp> = [
  new RegExp(`^\\s*(?:please\\s+)?add\\s+(.+?)\\s+as\\s+a\\s+risk${TRAILING_PUNCT}`, 'i'),
  new RegExp(`^\\s*(?:please\\s+)?include\\s+(.+?)\\s+as\\s+a\\s+risk${TRAILING_PUNCT}`, 'i'),
  new RegExp(`^\\s*(?:we should\\s+)?add\\s+(.+?)\\s+risk${TRAILING_PUNCT}`, 'i'),
];

const PRONOUN_DEMONSTRATIVE_RE =
  /^(this|that|it|its|it's|these|those|they|them|one|ones|something|anything|everything|nothing)$/i;

// Reject labels whose punctuation density exceeds this fraction — a heuristic
// guard against "team dynamics, !!!" or smuggled JSON / markdown fragments
// being baked into a node ID and the user-facing assistant text.
const MAX_PUNCT_DENSITY = 0.4;
const PUNCT_RE = /[!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~]/g;

// Invisible / control codepoints rejected from labels. Codepoint ranges are
// written numerically and the regex is built at module load time so the
// source is fully reviewable without relying on monospace rendering of
// invisible glyphs:
//   U+0000 .. U+001F  ASCII control characters
//   U+007F            DEL
//   U+200B .. U+200F  ZWSP / ZWJ / ZWNJ / LRM / RLM
//   U+202A .. U+202E  LRE / RLE / PDF / LRO / RLO (BiDi override controls)
//   U+2060 .. U+2064  word joiner, function-application invisibles, etc.
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x007f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
];
function buildInvisibleRe(): RegExp {
  const hex = (n: number): string => `\\u${n.toString(16).padStart(4, '0')}`;
  const charClass = INVISIBLE_RANGES.map(([lo, hi]) =>
    lo === hi ? hex(lo) : `${hex(lo)}-${hex(hi)}`,
  ).join('');
  return new RegExp('[' + charClass + ']');
}
const CONTROL_CHAR_RE = buildInvisibleRe();

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
