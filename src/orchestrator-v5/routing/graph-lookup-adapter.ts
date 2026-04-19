/**
 * V5 Phase 1.5 — GraphLookup adapter.
 *
 * The validator consumes the minimal `GraphLookup` interface defined in
 * [validator.ts](./validator.ts) — `findEntityById(id)` and
 * `listEntitiesByKind(kind)`. That interface is deliberately decoupled from
 * the concrete graph representation so the validator stays mechanically
 * unchanged as new graph shapes appear.
 *
 * This adapter builds a GraphLookup from the Phase 1.5 ingress payload. It
 * returns a discriminated result so callers can distinguish three states
 * (P0-2 fix):
 *
 *   • no_graph    — payload is absent, null, or structurally empty.
 *                   Frame-stage turns legitimately land here; the caller
 *                   emits `validate_skipped_no_graph` telemetry.
 *   • all_dropped — nodes were present but NONE mapped to a known kind.
 *                   This is a hard contract violation (the wire has drifted
 *                   past what this code recognises); caller must fail the
 *                   turn rather than silently skip graph-dependent checks.
 *   • ok          — lookup built; stats describe how many nodes survived.
 *
 * Stats are surfaced into the routing log so payload drift is visible
 * BEFORE the safety envelope silently degrades (Imp-2).
 */

import type { GraphStateIngress } from '../boundary/request-extensions.js';
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
 * Per-turn statistics on how the ingress graph survived adapter mapping.
 * Emitted to the routing log so wire drift is observable before it silently
 * starts bypassing the safety envelope.
 */
export interface GraphLookupStats {
  readonly total_nodes: number;
  readonly mapped_nodes: number;
  readonly dropped_by_unknown_kind: number;
  readonly dropped_by_missing_id: number;
}

export type BuildGraphLookupResult =
  | { readonly kind: 'no_graph' }
  | { readonly kind: 'all_dropped'; readonly stats: GraphLookupStats }
  | {
      readonly kind: 'ok';
      readonly lookup: GraphLookupWithOptions;
      readonly stats: GraphLookupStats;
    };

/**
 * Map a NodeV3 `kind` field to the validator's EntityKind vocabulary.
 *
 *   NodeV3 kinds:  goal, factor, outcome, decision, risk, action, option
 *   EntityKind:    node, edge, option, goal, constraint
 *
 * Validator callers reason in terms of proposal targets: "option" and "goal"
 * are addressable via distinct kinds; everything else collapses into a
 * generic "node" bucket. ("edge" and "constraint" are not produced from
 * graph.nodes — they come from edges[] and goal_constraints[] respectively
 * and are out of Phase 1.5 scope.)
 */
function toEntityKind(nodeKind: string): EntityKind | null {
  if (nodeKind === 'option') return 'option';
  if (nodeKind === 'goal') return 'goal';
  if (
    nodeKind === 'factor' ||
    nodeKind === 'outcome' ||
    nodeKind === 'decision' ||
    nodeKind === 'risk' ||
    nodeKind === 'action'
  ) {
    return 'node';
  }
  return null;
}

/**
 * Normalise an ingress `options` value into a safe, read-only array of
 * records. `GraphStateIngress.options` is `unknown[] | undefined` per the
 * boundary schema — we narrow to proper records here so the precondition
 * can reason about intervention configuration without further casts.
 */
function normaliseOptions(
  raw: GraphStateIngress['options'],
): ReadonlyArray<Record<string, unknown>> {
  if (!raw) return [];
  const records: Array<Record<string, unknown>> = [];
  for (const entry of raw) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      records.push(entry as Record<string, unknown>);
    }
  }
  return records;
}

/**
 * Build a GraphLookup from an ingress graph payload. Returns a discriminated
 * result so the caller can distinguish "no graph on the turn" (legitimate
 * skip) from "graph was present but we could not map any of it" (contract
 * violation — payload drift).
 */
export function buildGraphLookup(
  graph: GraphStateIngress | null | undefined,
): BuildGraphLookupResult {
  if (!graph) return { kind: 'no_graph' };
  const nodes = graph.nodes;
  if (nodes.length === 0) return { kind: 'no_graph' };

  const byId = new Map<string, { id: string; kind: EntityKind; label: string | null }>();
  const byKind = new Map<EntityKind, Array<{ id: string; label: string }>>();

  let droppedByMissingId = 0;
  let droppedByUnknownKind = 0;

  for (const node of nodes) {
    // The ingress schema guarantees id/kind/label are strings; this guard
    // only fires if a caller bypasses the boundary parse.
    if (typeof node.id !== 'string') {
      droppedByMissingId += 1;
      continue;
    }
    const mappedKind = toEntityKind(node.kind);
    if (mappedKind === null) {
      droppedByUnknownKind += 1;
      continue;
    }
    const label = typeof node.label === 'string' ? node.label : null;
    byId.set(node.id, { id: node.id, kind: mappedKind, label });
    const kindList = byKind.get(mappedKind) ?? [];
    kindList.push({ id: node.id, label: label ?? node.id });
    byKind.set(mappedKind, kindList);
  }

  const stats: GraphLookupStats = {
    total_nodes: nodes.length,
    mapped_nodes: byId.size,
    dropped_by_unknown_kind: droppedByUnknownKind,
    dropped_by_missing_id: droppedByMissingId,
  };

  if (byId.size === 0) {
    return { kind: 'all_dropped', stats };
  }

  const optionsList = normaliseOptions(graph.options);

  const lookup: GraphLookupWithOptions = {
    findEntityById(id: string) {
      return byId.get(id) ?? null;
    },
    listEntitiesByKind(kind: EntityKind) {
      return byKind.get(kind) ?? [];
    },
    options: optionsList,
  };
  return { kind: 'ok', lookup, stats };
}
