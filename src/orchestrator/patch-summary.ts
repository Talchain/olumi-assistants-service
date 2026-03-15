/**
 * Patch Summary Formatter
 *
 * Generates user-facing summary strings and compact grouped detail items for
 * graph_patch blocks. Called by draft_graph, edit_graph, and patch_accepted
 * to ensure every user-visible patch always has meaningful, polished content.
 *
 * Design goals:
 * - Deterministic (no randomness, no timestamps, no internal IDs)
 * - Plain English — no internal patch jargon, no op-type dumps
 * - Scales: small patches → specific; large patches → grouped/semantic
 * - Robust pluralisation and graceful fallback for unknown kinds
 */

import type { PatchOperation } from './types.js';

// ============================================================================
// Node kind label map
// ============================================================================

/** Human-readable singular/plural labels for known node kinds. */
const NODE_KIND_LABELS: Record<string, { singular: string; plural: string }> = {
  factor:   { singular: 'factor',   plural: 'factors'   },
  goal:     { singular: 'goal',     plural: 'goals'     },
  option:   { singular: 'option',   plural: 'options'   },
  outcome:  { singular: 'outcome',  plural: 'outcomes'  },
  risk:     { singular: 'risk',     plural: 'risks'     },
  lever:    { singular: 'lever',    plural: 'levers'    },
  driver:   { singular: 'driver',   plural: 'drivers'   },
  barrier:  { singular: 'barrier',  plural: 'barriers'  },
  enabler:  { singular: 'enabler',  plural: 'enablers'  },
  context:  { singular: 'context node', plural: 'context nodes' },
};

function nodeKindLabel(kind: string, count: number): string {
  const entry = NODE_KIND_LABELS[kind.toLowerCase()];
  if (entry) {
    return count === 1 ? entry.singular : entry.plural;
  }
  // Graceful fallback for unknown kinds
  const safe = kind.toLowerCase().replace(/_/g, ' ');
  return count === 1 ? safe : `${safe}s`;
}

function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

// ============================================================================
// Operation analysis helpers
// ============================================================================

interface OpAnalysis {
  /** add_node ops grouped by node kind → count */
  addedByKind: Map<string, number>;
  /** remove_node ops grouped by node kind → list of labels */
  removedByKind: Map<string, string[]>;
  /** update_node ops: list of node labels + changed fields */
  updatedNodes: Array<{ label: string; fields: string[] }>;
  /** add_edge count */
  edgesAdded: number;
  /** remove_edge count */
  edgesRemoved: number;
  /** update_edge ops: list of from/to labels */
  edgesUpdated: Array<{ from: string; to: string }>;
  totalOps: number;
}

/**
 * Analyse a PatchOperation array into structured buckets for summary generation.
 */
export function analyseOperations(operations: PatchOperation[]): OpAnalysis {
  const addedByKind = new Map<string, number>();
  const removedByKind = new Map<string, string[]>();
  const updatedNodes: Array<{ label: string; fields: string[] }> = [];
  let edgesAdded = 0;
  let edgesRemoved = 0;
  const edgesUpdated: Array<{ from: string; to: string }> = [];

  for (const op of operations) {
    switch (op.op) {
      case 'add_node': {
        const v = op.value as Record<string, unknown> | undefined;
        const kind = typeof v?.kind === 'string' ? v.kind : 'node';
        addedByKind.set(kind, (addedByKind.get(kind) ?? 0) + 1);
        break;
      }
      case 'remove_node': {
        const v = (op.old_value ?? op.value) as Record<string, unknown> | undefined;
        const kind = typeof v?.kind === 'string' ? v.kind : 'node';
        const label = typeof v?.label === 'string' ? v.label : undefined;
        const list = removedByKind.get(kind) ?? [];
        if (label) list.push(label);
        removedByKind.set(kind, list);
        break;
      }
      case 'update_node': {
        const v = op.value as Record<string, unknown> | undefined;
        const old = op.old_value as Record<string, unknown> | undefined;
        // label: prefer old_value label (more reliable than update payload)
        const label = typeof old?.label === 'string' ? old.label
          : typeof v?.label === 'string' ? v.label
          : extractLabelFromPath(op.path);
        const fields = v ? Object.keys(v).filter(k => k !== 'id') : [];
        updatedNodes.push({ label, fields });
        break;
      }
      case 'add_edge': {
        edgesAdded++;
        break;
      }
      case 'remove_edge': {
        edgesRemoved++;
        break;
      }
      case 'update_edge': {
        const path = op.path ?? '';
        // path like /edges/factor_1->goal_1 or edges/factor_1->goal_1
        const arrowMatch = path.match(/([^/]+)->([^/]+)$/);
        edgesUpdated.push({
          from: arrowMatch?.[1] ?? path,
          to: arrowMatch?.[2] ?? '',
        });
        break;
      }
    }
  }

  return {
    addedByKind,
    removedByKind,
    updatedNodes,
    edgesAdded,
    edgesRemoved,
    edgesUpdated,
    totalOps: operations.length,
  };
}

/**
 * Extract a human-readable identifier from a patch path (last segment, dashes → spaces).
 * e.g. "/nodes/technical_oversight" → "technical oversight"
 */
function extractLabelFromPath(path: string | undefined): string {
  if (!path) return 'element';
  const segment = path.replace(/^\//, '').split('/').pop() ?? path;
  return segment.replace(/_/g, ' ');
}

// ============================================================================
// Summary generation
// ============================================================================

/**
 * Threshold above which a patch is considered "large" and gets grouped detail.
 * Small patches (≤ this count) get specific item-level detail instead.
 */
const SMALL_PATCH_THRESHOLD = 3;

/**
 * Generate a concise, user-facing summary for an applied/proposed graph patch.
 *
 * Rules:
 * - No internal IDs
 * - No raw op-type jargon
 * - Reflects what materially changed, not just op count
 * - Prefers the LLM-provided coaching summary when available (for edit_graph)
 * - Falls back to operation-derived description
 *
 * @param operations  The validated PatchOperation array
 * @param coachingSummary  Optional LLM-generated summary to prefer if present
 * @param patchContext  Optional context hint ('full_draft' | 'edit' | 'accepted')
 */
export function buildPatchSummary(
  operations: PatchOperation[],
  coachingSummary?: string | null,
  patchContext?: 'full_draft' | 'edit' | 'accepted',
): string {
  // Prefer LLM coaching summary when available — it's the highest-quality signal
  if (coachingSummary && coachingSummary.trim().length > 0) {
    return coachingSummary.trim();
  }

  if (operations.length === 0) {
    return 'No changes were applied.';
  }

  const a = analyseOperations(operations);
  const isLarge = a.totalOps > SMALL_PATCH_THRESHOLD;
  const parts: string[] = [];

  // ---- Additions ----
  if (a.addedByKind.size > 0) {
    if (!isLarge) {
      // Small patch: use labels for added nodes
      const addedLabels = operations
        .filter(op => op.op === 'add_node')
        .map(op => {
          const v = op.value as Record<string, unknown> | undefined;
          return typeof v?.label === 'string' ? v.label : extractLabelFromPath(op.path);
        })
        .slice(0, 3);
      const addParts: string[] = [...addedLabels];
      if (a.edgesAdded > 0) {
        addParts.push(`${a.edgesAdded} ${plural('connection', a.edgesAdded)}`);
      }
      parts.push(`Added ${joinList(addParts)}`);
    } else {
      // Large patch: group by kind with counts
      const addParts: string[] = [];
      for (const [kind, count] of a.addedByKind) {
        addParts.push(`${count} ${nodeKindLabel(kind, count)}`);
      }
      if (a.edgesAdded > 0) {
        addParts.push(`${a.edgesAdded} ${plural('connection', a.edgesAdded)}`);
      }
      parts.push(`Added ${joinList(addParts)}`);
    }
  } else if (a.edgesAdded > 0) {
    parts.push(`Added ${a.edgesAdded} ${plural('connection', a.edgesAdded)}`);
  }

  // ---- Removals ----
  const removedKinds = [...a.removedByKind.entries()];
  if (removedKinds.length > 0) {
    const removeParts = removedKinds.map(([kind, labels]) => {
      const count = labels.length || 1;
      if (labels.length === 1) return labels[0];
      return `${count} ${nodeKindLabel(kind, count)}`;
    });
    parts.push(`Removed ${joinList(removeParts)}`);
  }
  if (a.edgesRemoved > 0 && removedKinds.length === 0) {
    parts.push(`Removed ${a.edgesRemoved} ${plural('connection', a.edgesRemoved)}`);
  }

  // ---- Updates (small patch: specific; large patch: grouped) ----
  if (a.updatedNodes.length > 0 || a.edgesUpdated.length > 0) {
    if (!isLarge && a.updatedNodes.length === 1 && a.edgesUpdated.length === 0) {
      // Single update: specific
      const u = a.updatedNodes[0];
      if (u.fields.length === 1) {
        const field = friendlyFieldName(u.fields[0]);
        parts.push(`Updated ${u.label}: ${field}`);
      } else {
        parts.push(`Updated ${u.label}`);
      }
    } else if (!isLarge && a.updatedNodes.length > 0) {
      const labels = a.updatedNodes.map(u => u.label).slice(0, 3);
      parts.push(`Updated ${joinList(labels)}`);
    } else if (isLarge) {
      const totalUpdates = a.updatedNodes.length + a.edgesUpdated.length;
      parts.push(`Updated ${totalUpdates} ${plural('element', totalUpdates)}`);
    }
  }

  if (parts.length === 0) {
    // Edge-only updates or unhandled mix
    return patchContext === 'full_draft'
      ? 'Created a new decision model.'
      : 'Applied graph changes.';
  }

  // Capitalise first letter of first sentence; join with "; "
  const joined = parts.join('; ');
  return capitalise(joined) + '.';
}

// ============================================================================
// Compact detail items
// ============================================================================

export interface PatchDetailItem {
  /** Short human-readable description of a group of changes */
  description: string;
}

/**
 * Generate compact grouped detail items for a patch.
 *
 * Small patches (≤ SMALL_PATCH_THRESHOLD ops): specific, itemised descriptions.
 * Large patches: grouped semantic descriptions.
 *
 * Never exposes raw op-type names as user-facing content.
 */
export function buildPatchDetailItems(operations: PatchOperation[]): PatchDetailItem[] {
  if (operations.length === 0) return [];

  const a = analyseOperations(operations);
  const items: PatchDetailItem[] = [];
  const isLarge = a.totalOps > SMALL_PATCH_THRESHOLD;

  if (isLarge) {
    // ---- Grouped / semantic detail (large patches) ----

    // Node additions grouped by kind
    for (const [kind, count] of a.addedByKind) {
      items.push({ description: `Added ${count} ${nodeKindLabel(kind, count)}` });
    }

    // Edge additions
    if (a.edgesAdded > 0) {
      items.push({
        description: `Linked ${a.edgesAdded} ${plural('connection', a.edgesAdded)} between nodes`,
      });
    }

    // Node removals grouped by kind
    for (const [kind, labels] of a.removedByKind) {
      const count = labels.length || 1;
      if (labels.length === 1) {
        items.push({ description: `Removed ${labels[0]}` });
      } else {
        items.push({ description: `Removed ${count} ${nodeKindLabel(kind, count)}` });
      }
    }

    // Edge removals
    if (a.edgesRemoved > 0) {
      items.push({
        description: `Removed ${a.edgesRemoved} ${plural('connection', a.edgesRemoved)}`,
      });
    }

    // Updates (grouped)
    if (a.updatedNodes.length > 0) {
      items.push({
        description: `Updated ${a.updatedNodes.length} ${plural('node', a.updatedNodes.length)}`,
      });
    }
    if (a.edgesUpdated.length > 0) {
      items.push({
        description: `Updated ${a.edgesUpdated.length} ${plural('connection', a.edgesUpdated.length)}`,
      });
    }

  } else {
    // ---- Specific / itemised detail (small patches) ----

    // Node additions: show label if available
    for (const op of operations) {
      if (op.op === 'add_node') {
        const v = op.value as Record<string, unknown> | undefined;
        const label = typeof v?.label === 'string' ? v.label : extractLabelFromPath(op.path);
        const kind = typeof v?.kind === 'string' ? nodeKindLabel(v.kind, 1) : 'node';
        items.push({ description: `Added ${kind}: ${label}` });
      }
    }

    // Node updates: show label + field
    for (const u of a.updatedNodes) {
      if (u.fields.length === 1) {
        const field = friendlyFieldName(u.fields[0]);
        items.push({ description: `${u.label}: ${field} updated` });
      } else if (u.fields.length > 1) {
        const fieldList = u.fields.slice(0, 2).map(friendlyFieldName).join(', ');
        items.push({ description: `${u.label}: ${fieldList} updated` });
      } else {
        items.push({ description: `${u.label} updated` });
      }
    }

    // Edge additions
    if (a.edgesAdded > 0) {
      items.push({
        description: `Added ${a.edgesAdded} ${plural('connection', a.edgesAdded)}`,
      });
    }

    // Node removals
    for (const [, labels] of a.removedByKind) {
      for (const lbl of labels) {
        items.push({ description: `Removed ${lbl}` });
      }
    }

    // Edge removals
    if (a.edgesRemoved > 0) {
      items.push({
        description: `Removed ${a.edgesRemoved} ${plural('connection', a.edgesRemoved)}`,
      });
    }

    // Edge updates
    for (const eu of a.edgesUpdated) {
      items.push({ description: `Updated connection from ${eu.from} to ${eu.to}` });
    }
  }

  return items;
}

// ============================================================================
// Helpers
// ============================================================================

/** Map internal field names to friendly labels. */
function friendlyFieldName(field: string): string {
  const MAP: Record<string, string> = {
    label: 'name',
    strength_mean: 'strength',
    strength_std: 'strength variance',
    exists_probability: 'confidence',
    effect_direction: 'direction',
    data: 'value',
    value: 'value',
    category: 'category',
    kind: 'type',
  };
  return MAP[field] ?? field.replace(/_/g, ' ');
}

/** Join a list of strings with commas and "and" before the last item. */
function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function capitalise(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
