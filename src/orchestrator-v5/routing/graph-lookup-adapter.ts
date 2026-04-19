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
 * generic "node" bucket. "edge" is not produced from graph.nodes — edges[]
 * is a separate top-level array. "constraint" comes from graph.goal_constraints[]
 * and is handled separately in buildGraphLookup (see debt inventory §1.3).
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
 * Project each goal_constraints[] entry into a lookup-compatible entity.
 * GoalConstraintSchema (src/schemas/assist.ts) guarantees `constraint_id`
 * is a non-empty string; `label` is optional. We surface constraints under
 * `listEntitiesByKind('constraint')` so future handlers that target
 * constraint entities get validator coverage. No current handler accepts
 * 'constraint' — this is a forward-compatibility projection, validated
 * by an adapter unit test.
 */
function collectConstraintEntries(
  raw: GraphStateIngress['goal_constraints'],
): Array<{ id: string; kind: EntityKind; label: string | null }> {
  if (!raw) return [];
  const entries: Array<{ id: string; kind: EntityKind; label: string | null }> = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const c = entry as { constraint_id?: unknown; label?: unknown };
    if (typeof c.constraint_id !== 'string' || c.constraint_id.length === 0) continue;
    const label = typeof c.label === 'string' ? c.label : null;
    entries.push({ id: c.constraint_id, kind: 'constraint', label });
  }
  return entries;
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
  const byKind = new Map<EntityKind, Array<{ id: string; label: string | null }>>();

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
    // Keep label as null when the node has no label, so downstream consumers
    // (composer chips, Dice matching) can distinguish "real label" from
    // "no label — do NOT surface the id". Previously this substituted
    // `node.id` in as the label, which leaked id-shaped tokens into chips.
    kindList.push({ id: node.id, label });
    byKind.set(mappedKind, kindList);
  }

  // Project goal_constraints[] as constraint-kind entities. Additive to
  // node-derived entries; constraints live on a separate wire field but
  // share the same `findEntityById` / `listEntitiesByKind` surface.
  for (const entry of collectConstraintEntries(graph.goal_constraints)) {
    byId.set(entry.id, entry);
    const kindList = byKind.get('constraint') ?? [];
    kindList.push({ id: entry.id, label: entry.label });
    byKind.set('constraint', kindList);
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
