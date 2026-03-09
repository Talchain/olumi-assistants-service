/**
 * Post-Draft GuidanceItem Generation
 *
 * Called from dispatch after draft_graph or edit_graph completes.
 * Pure function: takes graph state + draft warnings → returns GuidanceItem[].
 *
 * Sources:
 * 1. CEEStructuralWarningV1[] from pipeline body.draft_warnings
 * 2. Structural graph analysis (deterministic, no LLM)
 *
 * Warning code mapping (from CEEStructuralWarningV1.id):
 * - uniform_edge_strengths / edge_origin_defaulted → DEFAULT_EDGE_STRENGTH (should_fix, 70)
 * - cycle_detected                                 → STRUCTURAL_CYCLE (must_fix, 95)
 * - blocker severity                               → must_fix
 * - high severity                                  → should_fix
 * - medium severity                                → could_fix
 * - low severity                                   → exclude (informational only)
 * - unknown ids                                    → STRUCTURAL_VALIDATION_ERROR (should_fix, discuss)
 *
 * Max 8 items. Sorted: priority desc, item_id asc.
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import { DEFAULT_EXISTS_PROBABILITY } from "../context/constants.js";
import { DEFAULT_STRENGTH_MEAN, DEFAULT_STRENGTH_STD } from "../../cee/constants.js";
import {
  SIGNAL_CODES,
  computeGuidanceItemId,
  deduplicateGuidanceItems,
  sortGuidanceItems,
} from "../types/guidance-item.js";
import type { GuidanceItem, GuidanceCategory, GuidanceAction } from "../types/guidance-item.js";

// ============================================================================
// CEEStructuralWarningV1 shape (from generated OpenAPI — read defensively)
// ============================================================================

interface CEEDraftWarning {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'blocker';
  affected_node_ids?: string[];
  affected_edge_ids?: string[];
  explanation?: string;
  fix_hint?: string;
  // Legacy fields
  node_ids?: string[];
  edge_ids?: string[];
}

// ============================================================================
// Constants
// ============================================================================

const MAX_ITEMS = 8;
const MAX_WARNING_ITEMS = 3;
const MAX_DEFAULT_CONFIDENCE_ITEMS = 3;
const MIN_DEGREE_FOR_DEFAULT_CONFIDENCE = 3;

// ============================================================================
// Warning Code Mapping
// ============================================================================

/** Map CEEStructuralWarningV1.id to signal_code + category */
const WARNING_ID_MAP: Record<string, { signal_code: string; category: GuidanceCategory; priority: number } | 'exclude'> = {
  // Default/uniform strength warnings → DEFAULT_EDGE_STRENGTH
  uniform_edge_strengths: { signal_code: SIGNAL_CODES.DEFAULT_EDGE_STRENGTH, category: 'should_fix', priority: 70 },
  edge_origin_defaulted: { signal_code: SIGNAL_CODES.DEFAULT_EDGE_STRENGTH, category: 'should_fix', priority: 70 },
  // Structural cycle
  cycle_detected: { signal_code: SIGNAL_CODES.STRUCTURAL_CYCLE, category: 'must_fix', priority: 95 },
  // Low-severity informational warnings — not actionable
  missing_baseline: 'exclude',
  goal_no_baseline_value: 'exclude',
  normalisation_input_insufficient: 'exclude',
  range_degenerate: 'exclude',
};

function severityToCategory(severity: string): GuidanceCategory | 'exclude' {
  switch (severity) {
    case 'blocker': return 'must_fix';
    case 'high': return 'should_fix';
    case 'medium': return 'could_fix';
    case 'low': return 'exclude';
    default: return 'should_fix'; // unknown severity — surface as should_fix
  }
}

function severityToPriority(severity: string, category: GuidanceCategory): number {
  if (category === 'must_fix') return 90;
  if (category === 'should_fix') return 65;
  return 35;
}

// ============================================================================
// Structural Analysis Helpers
// ============================================================================

/** Compute degree (in + out edge count) for each node */
function computeNodeDegrees(graph: GraphV3T): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const node of graph.nodes) {
    degrees.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
  }
  return degrees;
}

/** Detect default edge strength: |mean| === DEFAULT_STRENGTH_MEAN && std === DEFAULT_STRENGTH_STD */
export function isDefaultEdgeStrength(edge: { strength?: { mean?: number; std?: number } }): boolean {
  const mean = edge.strength?.mean;
  const std = edge.strength?.std;
  if (mean === undefined || std === undefined) return false;
  return Math.abs(mean) === DEFAULT_STRENGTH_MEAN && std === DEFAULT_STRENGTH_STD;
}

/** Count option nodes in graph */
function countOptions(graph: GraphV3T): number {
  // Count via options array first, then fall back to node kinds
  const optionsArr = (graph as Record<string, unknown>).options;
  if (Array.isArray(optionsArr)) return optionsArr.length;
  return graph.nodes.filter((n) => n.kind === 'option').length;
}

// ============================================================================
// Framing completeness
// ============================================================================

interface FramingContext {
  goal?: string | null;
  constraints?: unknown[] | null;
}

function checkFramingCompleteness(graph: GraphV3T, framing: FramingContext | null): string[] {
  const missing: string[] = [];
  // Check goal
  const hasGoalNode = graph.nodes.some((n) => n.kind === 'goal');
  if (!hasGoalNode && !framing?.goal) {
    missing.push('goal');
  }
  // Check options
  if (countOptions(graph) === 0) {
    missing.push('options');
  }
  return missing;
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate GuidanceItems after draft_graph or edit_graph.
 *
 * @param graph - Current graph state (post-draft/edit)
 * @param draftWarnings - CEEStructuralWarningV1[] from body.draft_warnings (may be empty)
 * @param framing - Framing context for completeness check (may be null)
 * @returns Sorted, deduplicated GuidanceItem[] (max 8)
 */
export function generatePostDraftGuidance(
  graph: GraphV3T,
  draftWarnings: CEEDraftWarning[],
  framing: FramingContext | null,
): GuidanceItem[] {
  const items: GuidanceItem[] = [];

  // ── 1. Convert draft warnings ────────────────────────────────────────────
  let warningItemCount = 0;
  for (const warning of draftWarnings) {
    if (warningItemCount >= MAX_WARNING_ITEMS) break;

    const mapped = WARNING_ID_MAP[warning.id];

    if (mapped === 'exclude') continue;

    let signal_code: string;
    let category: GuidanceCategory;
    let priority: number;

    if (mapped) {
      signal_code = mapped.signal_code;
      category = mapped.category;
      priority = mapped.priority;
    } else {
      // Unknown warning id — fall back to severity mapping
      const cat = severityToCategory(warning.severity);
      if (cat === 'exclude') continue;
      category = cat;
      signal_code = SIGNAL_CODES.STRUCTURAL_VALIDATION_ERROR;
      priority = severityToPriority(warning.severity, category);
    }

    // Determine target from affected elements
    const nodeIds = warning.affected_node_ids ?? warning.node_ids ?? [];
    const edgeIds = warning.affected_edge_ids ?? warning.edge_ids ?? [];
    const targetNodeId = nodeIds[0];
    const targetEdgeId = edgeIds[0];

    let action: GuidanceAction;
    let targetObject: GuidanceItem['target_object'];

    if (targetNodeId) {
      action = { type: 'open_inspector', node_id: targetNodeId };
      const nodeLabel = graph.nodes.find((n) => n.id === targetNodeId)?.label;
      targetObject = { type: 'node', id: targetNodeId, label: nodeLabel };
    } else if (targetEdgeId) {
      // For edge targets, open the target node of the edge
      const edge = graph.edges.find((e) => `${e.from}->${e.to}` === targetEdgeId || e.to === targetEdgeId);
      const targetNodeForEdge = edge?.to;
      action = targetNodeForEdge
        ? { type: 'open_inspector', node_id: targetNodeForEdge }
        : { type: 'discuss', prompt: warning.fix_hint ?? warning.explanation ?? 'Review and correct this structural warning.' };
      targetObject = { type: 'edge', id: targetEdgeId };
    } else if (signal_code === SIGNAL_CODES.STRUCTURAL_CYCLE) {
      action = { type: 'discuss', prompt: 'The graph contains a cycle. Which connections need to be modified?' };
      targetObject = { type: 'graph' };
    } else {
      action = { type: 'discuss', prompt: warning.fix_hint ?? warning.explanation ?? 'Review and address this warning.' };
      targetObject = { type: 'graph' };
    }

    const item_id = computeGuidanceItemId(signal_code, targetObject?.id, 'structural');

    items.push({
      item_id,
      signal_code,
      category,
      source: 'structural',
      title: warning.explanation ?? `Graph warning: ${warning.id}`,
      detail: warning.fix_hint,
      primary_action: action,
      target_object: targetObject,
      priority,
    });

    warningItemCount++;
  }

  // ── 2. Structural: DEFAULT_NODE_CONFIDENCE ────────────────────────────────
  const degrees = computeNodeDegrees(graph);
  const defaultConfidenceNodes = graph.nodes
    .filter((n) => {
      const degree = degrees.get(n.id) ?? 0;
      const ep = (n as Record<string, unknown>).exists_probability;
      const existsProb = typeof ep === 'number' ? ep : DEFAULT_EXISTS_PROBABILITY;
      return degree >= MIN_DEGREE_FOR_DEFAULT_CONFIDENCE && existsProb === DEFAULT_EXISTS_PROBABILITY;
    })
    .sort((a, b) => {
      const degDiff = (degrees.get(b.id) ?? 0) - (degrees.get(a.id) ?? 0);
      if (degDiff !== 0) return degDiff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, MAX_DEFAULT_CONFIDENCE_ITEMS);

  for (const node of defaultConfidenceNodes) {
    const item_id = computeGuidanceItemId(SIGNAL_CODES.DEFAULT_NODE_CONFIDENCE, node.id, 'structural');
    items.push({
      item_id,
      signal_code: SIGNAL_CODES.DEFAULT_NODE_CONFIDENCE,
      category: 'should_fix',
      source: 'structural',
      title: `"${node.label ?? node.id}" has default confidence`,
      detail: 'This high-connectivity node uses the default existence probability. Calibrate it for more accurate results.',
      primary_action: { type: 'open_inspector', node_id: node.id },
      target_object: { type: 'node', id: node.id, label: node.label },
      priority: 70,
    });
  }

  // ── 3. Structural: LOW_OPTION_COUNT ──────────────────────────────────────
  const optionCount = countOptions(graph);
  if (optionCount <= 2) {
    const item_id = computeGuidanceItemId(SIGNAL_CODES.LOW_OPTION_COUNT, undefined, 'structural');
    items.push({
      item_id,
      signal_code: SIGNAL_CODES.LOW_OPTION_COUNT,
      category: 'could_fix',
      source: 'structural',
      title: optionCount === 0 ? 'No decision options defined' : 'Only one option — add alternatives',
      detail: 'Decisions need at least two options to compare. What other approaches could you take?',
      primary_action: { type: 'discuss', prompt: 'What other approaches could you take?' },
      target_object: { type: 'graph' },
      priority: 45,
    });
  }

  // ── 4. Structural: MISSING_FRAMING_ELEMENT ───────────────────────────────
  const missingElements = checkFramingCompleteness(graph, framing);
  if (missingElements.length > 0 && !missingElements.includes('options')) {
    // options is already covered by LOW_OPTION_COUNT
    const nonOptionMissing = missingElements.filter((e) => e !== 'options');
    if (nonOptionMissing.length > 0) {
      const item_id = computeGuidanceItemId(SIGNAL_CODES.MISSING_FRAMING_ELEMENT, nonOptionMissing[0], 'structural');
      items.push({
        item_id,
        signal_code: SIGNAL_CODES.MISSING_FRAMING_ELEMENT,
        category: 'could_fix',
        source: 'structural',
        title: `Missing framing element: ${nonOptionMissing.join(', ')}`,
        detail: `The decision framing is incomplete. Adding ${nonOptionMissing.join(' and ')} will improve the model.`,
        primary_action: { type: 'discuss', prompt: `Can you describe the ${nonOptionMissing.join(' and ')} for this decision?` },
        target_object: { type: 'framing' },
        priority: 35,
      });
    }
  }

  // ── 5. Structural: COMPLEXITY_CHECK ──────────────────────────────────────
  if (graph.nodes.length > 10) {
    // Find lowest-connectivity node (degree ≤ 1)
    let lowestConnNode: { id: string; label?: string; degree: number } | null = null;
    for (const node of graph.nodes) {
      const degree = degrees.get(node.id) ?? 0;
      if (degree <= 1) {
        if (!lowestConnNode || degree < lowestConnNode.degree || (degree === lowestConnNode.degree && node.id < lowestConnNode.id)) {
          lowestConnNode = { id: node.id, label: node.label, degree };
        }
      }
    }
    if (lowestConnNode) {
      const item_id = computeGuidanceItemId(SIGNAL_CODES.COMPLEXITY_CHECK, lowestConnNode.id, 'structural');
      items.push({
        item_id,
        signal_code: SIGNAL_CODES.COMPLEXITY_CHECK,
        category: 'could_fix',
        source: 'structural',
        title: `Model has ${graph.nodes.length} nodes — consider simplifying`,
        detail: `"${lowestConnNode.label ?? lowestConnNode.id}" has low connectivity (degree ${lowestConnNode.degree}). Removing weakly-connected nodes can improve clarity.`,
        primary_action: { type: 'open_inspector', node_id: lowestConnNode.id },
        target_object: { type: 'node', id: lowestConnNode.id, label: lowestConnNode.label },
        priority: 30,
      });
    }
  }

  // ── 6. Deduplicate, sort, cap ─────────────────────────────────────────────
  return sortGuidanceItems(deduplicateGuidanceItems(items)).slice(0, MAX_ITEMS);
}
