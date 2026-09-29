/**
 * Display-anchor reconciliation for the `edit_graph` mutation path.
 *
 * ROADMAP 2.1003 / audit finding F3 — "the screen lies".
 *
 * A node carries BOTH a machine value (`observed_state.value` / `raw_value`)
 * and a denormalised human string (`display_value`). The `edit_graph` path
 * mutates the former through PLoT and leaves the latter alone, so a receipt
 * can legitimately carry `observed_state.value = 40` beside a stale
 * `display_value = "20%"`. Measured on deployed staging, 2026-08-09: the
 * canvas preferred the stale string and kept showing 20% — before AND after
 * reload — while the rerun computed on 40 and flipped the leading option.
 *
 * The correction is the PRODUCER half of that defect: when a mutation moves a
 * node's observed state, the display anchor moves atomically with it, or is
 * cleared. A stale anchor must not survive the write that invalidated it.
 *
 * The precedent already exists in this repo and is reused verbatim in spirit:
 * `set-factor-value.ts` (V5 D1 golden-path closure, A3.1 Task 3) recomputes
 * `display_value` via `synthesiseDisplayValue` after its mutation and DELETES
 * the stale string when the formatter declines to produce a new one. This
 * module is that same law applied to the `edit_graph` lane, which never had
 * it. It is deliberately NOT a second formatter — it delegates to the one
 * canonical pure formatter (`synthesiseDisplayValue`).
 *
 * ⚠ SCOPE IS DELIBERATELY NARROW, and the narrowness is the design.
 * Only nodes whose observed state ACTUALLY MOVED between the pre-edit graph
 * and the applied graph are touched. Reconciling every factor on every turn
 * would be a breadth defect, not a fix: `analysis-ready.ts` deliberately
 * PREFERS an LLM/enricher-authored `display_value` (e.g. a qualitative
 * "Moderate") over the synthesised fallback ("0.42"), and a blanket rewrite
 * would silently downgrade every untouched node's display string on every
 * edit turn. A node the edit did not touch keeps whatever string it had.
 *
 * Pure: no I/O, no LLM, no telemetry, no mutation of the inputs. The caller
 * owns emission and persistence.
 */

import { synthesiseDisplayValue } from '../../cee/factor-extraction/display-value.js';

/** Minimal structural view of the node fields this module reads. */
interface AnchorNode {
  id?: unknown;
  kind?: unknown;
  factor_type?: unknown;
  display_value?: unknown;
  observed_state?: {
    value?: unknown;
    raw_value?: unknown;
    unit?: unknown;
    cap?: unknown;
    factor_type?: unknown;
  } | null;
}

/** Minimal structural view of the graph shape this module reads. */
interface AnchorGraph {
  nodes?: unknown;
}

export interface DisplayAnchorReconciliation<G> {
  /**
   * The reconciled graph. **Referentially identical to `after`** when nothing
   * needed repair — callers use that to decide whether a previously-computed
   * graph hash is still valid (see `edit-graph.ts`: PLoT's canonical
   * `graph_hash` must only be discarded when we actually changed bytes).
   */
  graph: G;
  /** Ids of the nodes whose display anchor was rewritten or cleared. */
  repairedNodeIds: string[];
}

/**
 * The observed-state fields that make a display anchor correct or stale.
 * Anything outside this list (e.g. `source`, `provenance`) can move without
 * invalidating the rendered string.
 */
function anchorInputs(node: AnchorNode): {
  value?: number;
  raw_value?: number;
  unit?: string;
  cap?: number;
  factor_type?: string;
} {
  const os = node.observed_state ?? undefined;
  const out: {
    value?: number;
    raw_value?: number;
    unit?: string;
    cap?: number;
    factor_type?: string;
  } = {};
  if (typeof os?.value === 'number') out.value = os.value;
  if (typeof os?.raw_value === 'number') out.raw_value = os.raw_value;
  if (typeof os?.unit === 'string') out.unit = os.unit;
  if (typeof os?.cap === 'number') out.cap = os.cap;
  const ft = typeof os?.factor_type === 'string'
    ? os.factor_type
    : typeof node.factor_type === 'string'
      ? node.factor_type
      : undefined;
  if (ft !== undefined) out.factor_type = ft;
  return out;
}

function anchorInputsEqual(a: ReturnType<typeof anchorInputs>, b: ReturnType<typeof anchorInputs>): boolean {
  return a.value === b.value
    && a.raw_value === b.raw_value
    && a.unit === b.unit
    && a.cap === b.cap
    && a.factor_type === b.factor_type;
}

/**
 * Rewrite (or clear) the `display_value` of every node whose observed state
 * moved between `before` and `after`.
 *
 * @param before - the pre-edit graph (the graph the edit was authored against)
 * @param after  - the applied/post-edit graph
 * @returns `{ graph, repairedNodeIds }`. `graph === after` (same reference)
 *          when no node needed repair.
 */
export function reconcileDisplayAnchors<G extends AnchorGraph>(
  before: unknown,
  after: G,
): DisplayAnchorReconciliation<G> {
  const afterNodes = (after as AnchorGraph | null)?.nodes;
  if (!Array.isArray(afterNodes)) return { graph: after, repairedNodeIds: [] };

  const beforeNodesRaw = (before as AnchorGraph | null)?.nodes;
  const beforeById = new Map<string, AnchorNode>();
  if (Array.isArray(beforeNodesRaw)) {
    for (const n of beforeNodesRaw as AnchorNode[]) {
      if (typeof n?.id === 'string') beforeById.set(n.id, n);
    }
  }

  const repairedNodeIds: string[] = [];
  const nextNodes: unknown[] = [];
  let changed = false;

  for (const raw of afterNodes as AnchorNode[]) {
    const id = typeof raw?.id === 'string' ? raw.id : undefined;
    const priorNode = id !== undefined ? beforeById.get(id) : undefined;

    // A node that is NEW in `after` is left alone: the V3 transform already
    // synthesises an anchor for a node that has none, and a freshly authored
    // node's LLM-provided string is not stale by construction.
    if (priorNode === undefined) {
      nextNodes.push(raw);
      continue;
    }

    const afterInputs = anchorInputs(raw);
    const beforeInputs = anchorInputs(priorNode);
    if (anchorInputsEqual(afterInputs, beforeInputs)) {
      nextNodes.push(raw);
      continue;
    }

    // The observed state moved. The anchor is now a claim about a value that
    // no longer exists — recompute it, or clear it when the canonical
    // formatter declines to produce one. Never leave the prior string.
    const recomputed = synthesiseDisplayValue(afterInputs);
    const current = typeof raw.display_value === 'string' ? raw.display_value : undefined;

    if (recomputed !== undefined) {
      if (current === recomputed) {
        nextNodes.push(raw);
        continue;
      }
      nextNodes.push({ ...raw, display_value: recomputed });
    } else {
      if (current === undefined) {
        nextNodes.push(raw);
        continue;
      }
      const { display_value: _dropped, ...rest } = raw as AnchorNode & Record<string, unknown>;
      nextNodes.push(rest);
    }

    changed = true;
    if (id !== undefined) repairedNodeIds.push(id);
  }

  if (!changed) return { graph: after, repairedNodeIds: [] };
  return { graph: { ...(after as object), nodes: nextNodes } as G, repairedNodeIds };
}
