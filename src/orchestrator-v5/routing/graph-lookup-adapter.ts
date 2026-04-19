/**
 * V5 Phase 1.5 — GraphLookup adapter.
 *
 * The validator consumes the minimal `GraphLookup` interface defined in
 * [validator.ts](./validator.ts) — `findEntityById(id)` and
 * `listEntitiesByKind(kind)`. That interface is deliberately decoupled from
 * the concrete graph representation so the validator stays mechanically
 * unchanged as new graph shapes appear.
 *
 * This adapter builds a GraphLookup from the Phase 1.5 GraphV3T payload,
 * preserving the adapter boundary per plan correction #5. The validator does
 * not learn about GraphV3T; it only learns about the lookup surface.
 */

import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { EntityKind } from './types.js';
import type { GraphLookup } from './validator.js';

/**
 * Adapter-extended GraphLookup. Carries the raw options array from the UI
 * payload alongside the minimal lookup surface the validator consumes.
 *
 * The validator itself uses only the `GraphLookup` interface (findEntityById,
 * listEntitiesByKind) — this extension is invisible to it. Preconditions
 * registered in validation-registry.ts narrow to this shape to inspect
 * option-level data (intervention configuration) that the core lookup surface
 * cannot see. This preserves plan correction #5 (validator.ts unchanged)
 * while giving preconditions the data they need.
 */
export interface GraphLookupWithOptions extends GraphLookup {
  readonly options: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Map a NodeV3 `kind` field to the validator's EntityKind vocabulary.
 *
 *   NodeV3 kinds:  goal, factor, outcome, decision, risk, action, option
 *   EntityKind:    node, edge, option, goal, constraint
 *
 * Validator callers reason in terms of proposal targets: "option", "goal",
 * "constraint" are addressable via distinct kinds; everything else is a
 * generic "node" bucket. We preserve the option/goal distinction (handlers
 * like run_analysis accept those kinds explicitly) and collapse the rest
 * into "node".
 */
function toEntityKind(nodeKind: unknown): EntityKind | null {
  if (typeof nodeKind !== 'string') return null;
  if (nodeKind === 'option') return 'option';
  if (nodeKind === 'goal') return 'goal';
  // factor / outcome / decision / risk / action all map to the generic
  // "node" bucket per the validator's addressable-entity taxonomy.
  if (nodeKind === 'factor' || nodeKind === 'outcome' || nodeKind === 'decision' ||
      nodeKind === 'risk' || nodeKind === 'action') {
    return 'node';
  }
  return null;
}

/**
 * Build a GraphLookup from a GraphV3T payload. Returns `undefined` when the
 * graph has no nodes — a frame-stage turn or a graph that arrived empty. The
 * validator treats `undefined` as "no lookup" and the TurnExecutor emits
 * `validate_skipped_no_graph` telemetry.
 *
 * The returned lookup is a pure projection over the graph's nodes. Edges are
 * not consulted — the validator surface never touches them.
 */
export function buildGraphLookup(
  graph: GraphV3T | null | undefined,
): GraphLookup | undefined {
  if (!graph) return undefined;
  const nodes = graph.nodes ?? [];
  if (nodes.length === 0) return undefined;

  // Pre-index once: id → record, kind → record[]. Both are read-mostly for
  // validator calls, so indexing up-front avoids O(n) scans per lookup.
  const byId = new Map<string, { id: string; kind: EntityKind; label: string | null }>();
  const byKind = new Map<EntityKind, Array<{ id: string; label: string }>>();

  for (const raw of nodes) {
    const node = raw as { id?: unknown; kind?: unknown; label?: unknown };
    if (typeof node.id !== 'string') continue;
    const mappedKind = toEntityKind(node.kind);
    if (mappedKind === null) continue;
    const label = typeof node.label === 'string' ? node.label : null;
    const entry = { id: node.id, kind: mappedKind, label };
    byId.set(node.id, entry);
    const kindList = byKind.get(mappedKind) ?? [];
    kindList.push({ id: node.id, label: label ?? node.id });
    byKind.set(mappedKind, kindList);
  }

  if (byId.size === 0) return undefined;

  // `options` is a passthrough field on the wire — GraphV3T's Zod schema
  // declares only { nodes, edges }, but the UI may send an `options` array
  // alongside. Surface whatever is there as a read-only array; preconditions
  // that care about intervention configuration inspect it.
  const rawOptions = ((graph as unknown as { options?: unknown }).options);
  const optionsList: ReadonlyArray<Record<string, unknown>> = Array.isArray(rawOptions)
    ? (rawOptions.filter((o): o is Record<string, unknown> =>
        typeof o === 'object' && o !== null && !Array.isArray(o),
      ))
    : [];

  const lookup: GraphLookupWithOptions = {
    findEntityById(id: string) {
      return byId.get(id) ?? null;
    },
    listEntitiesByKind(kind: EntityKind) {
      return byKind.get(kind) ?? [];
    },
    options: optionsList,
  };
  return lookup;
}
