/**
 * Pre-Analysis Gap Detection
 *
 * Detects graph factors that will default to 0.0 in ISL because they have
 * no `observed_state.value` and no well-formed `prior` (with range_min/range_max).
 *
 * Runs as a fast, synchronous graph scan before `run_analysis` in dispatch.ts.
 * When gaps are found, returns coaching guidance (GuidanceItems + assistant text)
 * instead of proceeding to analysis. The user can bypass with "run anyway".
 *
 * Detection criteria — a node is "value-missing" if ALL of:
 * 1. kind is "factor", "outcome", or "risk" (participates in inference)
 * 2. Is a root node (no incoming directed edges) OR category === "external"
 * 3. Has no observed_state (undefined/missing)
 * 4. Has no prior with range_min AND range_max (prior is a passthrough field, not in Zod)
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import type { GuidanceItem } from "../types/guidance-item.js";
import { SIGNAL_CODES, computeGuidanceItemId } from "../types/guidance-item.js";

// ============================================================================
// Types
// ============================================================================

export interface ValueMissingFactor {
  node_id: string;
  label: string;
  kind: string;
  category: string | undefined;
}

// Kinds that participate in inference and can cause ISL defaults
const INFERENCE_KINDS = new Set(['factor', 'outcome', 'risk']);

/**
 * Fingerprint string present in every gap coaching response.
 * Used by dispatch to detect whether the previous turn was gap coaching
 * so that the next run_analysis intent auto-bypasses the gap check.
 */
export const GAP_COACHING_FINGERPRINT = '"run anyway" to proceed with defaults';

// Maximum factor-specific guidance items to emit (plus one "run anyway" item)
const MAX_GAP_ITEMS = 10;

// ============================================================================
// Detection
// ============================================================================

/**
 * Detect graph nodes that will default to 0.0 in ISL due to missing values.
 *
 * A node is "value-missing" when it:
 * - Has a kind that participates in inference (factor, outcome, risk)
 * - Is a root node (no incoming directed edges) OR has category "external"
 * - Has no `observed_state` field
 * - Has no `prior` with both `range_min` and `range_max`
 *
 * The scan is O(|edges| + |nodes|) — no LLM calls, no async.
 *
 * @param graph - Current graph state, or null/undefined if no graph exists
 * @returns Array of value-missing factor descriptors (empty if no gaps or no graph)
 */
export function detectValueMissingFactors(graph: GraphV3T | null | undefined): ValueMissingFactor[] {
  if (!graph || !graph.nodes || graph.nodes.length === 0) return [];

  // Build set of nodes with at least one incoming directed edge
  const hasIncomingDirected = new Set<string>();
  for (const edge of graph.edges) {
    // Bidirected edges are trust annotations, not causal flow — exclude
    const edgeAny = edge as Record<string, unknown>;
    if (edgeAny.edge_type === 'bidirected') continue;
    hasIncomingDirected.add(edge.to);
  }

  const gaps: ValueMissingFactor[] = [];

  for (const node of graph.nodes) {
    // 1. Kind filter
    if (!INFERENCE_KINDS.has(node.kind)) continue;

    // 2. Root OR external
    const isRoot = !hasIncomingDirected.has(node.id);
    const nodeAny = node as Record<string, unknown>;
    const category = (nodeAny.category as string | undefined) ?? undefined;
    const isExternal = category === 'external';
    if (!isRoot && !isExternal) continue;

    // 3. Has observed_state?
    if (node.observed_state != null) continue;

    // 4. Has well-formed prior? (passthrough field — check at runtime)
    const prior = nodeAny.prior as Record<string, unknown> | undefined;
    if (prior != null && prior.range_min != null && prior.range_max != null) continue;

    gaps.push({
      node_id: node.id,
      label: node.label,
      kind: node.kind,
      category,
    });
  }

  return gaps;
}

// ============================================================================
// Guidance Items
// ============================================================================

/**
 * Build GuidanceItems for value-missing factors.
 *
 * Produces one `should_fix` item per gap (capped at MAX_GAP_ITEMS) plus
 * one `could_fix` "Run anyway" item that lets the user proceed with defaults.
 */
export function buildGapGuidanceItems(gaps: ValueMissingFactor[]): GuidanceItem[] {
  if (gaps.length === 0) return [];

  const items: GuidanceItem[] = [];

  // Per-factor items (capped)
  const capped = gaps.slice(0, MAX_GAP_ITEMS);
  for (const gap of capped) {
    items.push({
      item_id: computeGuidanceItemId(SIGNAL_CODES.MISSING_OBSERVED_VALUE, gap.node_id, 'structural'),
      signal_code: SIGNAL_CODES.MISSING_OBSERVED_VALUE,
      category: 'should_fix',
      source: 'structural',
      priority: 65,
      title: `No value set for ${gap.label}`,
      detail: 'This factor has no observed value or prior range and will use a default in the analysis. Providing an estimate improves accuracy.',
      primary_action: { type: 'navigate', target: `set ${gap.label} range` },
      target_object: { type: 'node', id: gap.node_id, label: gap.label },
    });
  }

  // "Run anyway" item
  items.push({
    item_id: computeGuidanceItemId(SIGNAL_CODES.MISSING_OBSERVED_VALUE, 'run_anyway', 'structural'),
    signal_code: SIGNAL_CODES.MISSING_OBSERVED_VALUE,
    category: 'could_fix',
    source: 'structural',
    priority: 30,
    title: 'Run analysis with defaults',
    detail: `Proceed using default values for ${gaps.length === 1 ? 'the factor' : `${gaps.length} factors`} without estimates. Results may be less accurate.`,
    primary_action: { type: 'navigate', target: 'run anyway' },
  });

  return items;
}

// ============================================================================
// Coaching Text
// ============================================================================

/**
 * Build deterministic assistant_text explaining which factors lack values.
 *
 * When `briefText` is provided, performs a case-insensitive label-substring
 * match against the brief to produce anchored elicitation ("You mentioned X
 * in your brief…"). This is a fast string scan — no LLM call.
 *
 * @param gaps - Value-missing factors detected by detectValueMissingFactors
 * @param briefText - Optional original brief text for anchor extraction
 * @returns Coaching text for the assistant response
 */
export function buildGapCoachingText(gaps: ValueMissingFactor[], briefText?: string | null): string {
  if (gaps.length === 0) return '';

  const briefLower = briefText?.toLowerCase() ?? '';
  const lines: string[] = [];

  if (gaps.length === 1) {
    const gap = gaps[0];
    const anchor = briefLower && findBriefAnchor(gap.label, briefLower, briefText ?? '');
    if (anchor) {
      lines.push(`Before running the analysis, I noticed **${gap.label}** has no value set on the model. ${anchor}`);
    } else {
      lines.push(`Before running the analysis, I noticed **${gap.label}** has no value set. Without an estimate, the model will use a default which may not reflect your situation.`);
    }
    lines.push('');
    lines.push(`What's the lowest realistic, most likely, and highest realistic value for ${gap.label}?`);
  } else {
    const labels = gaps.slice(0, MAX_GAP_ITEMS).map(g => `**${g.label}**`);
    const labelList = labels.join(', ');
    lines.push(`Before running the analysis, I noticed ${gaps.length} factors have no values set: ${labelList}${gaps.length > MAX_GAP_ITEMS ? ` (and ${gaps.length - MAX_GAP_ITEMS} more)` : ''}.`);
    lines.push('');
    lines.push('Without estimates, the model will use defaults which may not reflect your situation. For each factor, what range would you expect?');

    // Add brief-anchored prompts for each factor
    for (const gap of gaps.slice(0, MAX_GAP_ITEMS)) {
      const anchor = briefLower && findBriefAnchor(gap.label, briefLower, briefText ?? '');
      if (anchor) {
        lines.push(`- **${gap.label}**: ${anchor}`);
      }
    }
  }

  lines.push('');
  lines.push('You can set estimates for each factor, or say "run anyway" to proceed with defaults.');

  return lines.join('\n');
}

// ============================================================================
// Brief Anchor Extraction
// ============================================================================

/**
 * Search the brief text for a mention of the factor label and extract a
 * contextual anchor for elicitation.
 *
 * Uses a case-insensitive label-substring match (full label first, then
 * significant words >4 chars with word boundaries). Finds the nearest
 * number/percentage/currency within 60 chars of the match to produce
 * an anchored prompt like "You mentioned 3.2% in your brief…".
 *
 * @returns Anchored elicitation prompt, or null if no match found
 */
function findBriefAnchor(label: string, briefLower: string, briefOriginal: string): string | null {
  // Try matching the full label first, then significant words (>4 chars, word-boundary)
  const labelLower = label.toLowerCase();
  let matchIdx = briefLower.indexOf(labelLower);
  let matchLen = labelLower.length;

  if (matchIdx === -1) {
    // Try individual words from the label (skip short/common words)
    const words = labelLower.split(/\s+/).filter(w => w.length > 4);
    for (const word of words) {
      // Word-boundary match to avoid partial hits ("cost" in "costly")
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`);
      const m = re.exec(briefLower);
      if (m) {
        matchIdx = m.index;
        matchLen = word.length;
        break;
      }
    }
  }

  if (matchIdx === -1) return null;

  // Find all numbers in the brief and pick the one closest to the match position
  const numberPattern = /[£$€]?\d[\d,]*\.?\d*\s*[%kKmMbB]?/g;
  let closest: { value: string; distance: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = numberPattern.exec(briefOriginal)) !== null) {
    const numCenter = m.index + m[0].length / 2;
    const matchCenter = matchIdx + matchLen / 2;
    const distance = Math.abs(numCenter - matchCenter);
    if (!closest || distance < closest.distance) {
      closest = { value: m[0].trim(), distance };
    }
  }

  // Only anchor if the nearest number is within 60 chars of the label match
  if (closest && closest.distance <= 60) {
    return `You mentioned "${closest.value}" in your brief — would you like to use that as a baseline?`;
  }

  return null;
}
