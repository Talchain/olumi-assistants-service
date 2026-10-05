import { literalConventionValue } from './quantity-evidence.js';
import type { DraftRecordSet, DraftStatedItem } from './grammar.js';
import type { DroppedRecordRef, RecordProjection } from './projector.js';

/** Edge endpoints are its persisted identity; V3 deliberately strips legacy edge ids. */
export type StatedCarrier = (
  | { readonly kind: 'node'; readonly node_id: string }
  | { readonly kind: 'edge'; readonly from: string; readonly to: string }
) & { readonly path: readonly string[] };
export type StatedDisposition = { readonly stated_index: number; readonly stated_item: DraftStatedItem } & (
  | { readonly disposition: 'carried'; readonly location: StatedCarrier; readonly stored_value: unknown }
  | { readonly disposition: 'rejected'; readonly reason: DroppedRecordRef['reason'] | 'stated_value_not_carried' | 'stated_relationship_not_carried' | 'carrier_removed' }
  | { readonly disposition: 'asked' }
);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function field(value: unknown, path: readonly string[]): unknown {
  for (const key of path) {
    if (!object(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** One receipt per input index, using only the projector's own identities and writes. */
export function deriveStatedDispositions(
  records: DraftRecordSet,
  projection: RecordProjection,
  statedNodeIds: ReadonlyMap<number, string>,
  originalRecords: DraftRecordSet = records,
): readonly StatedDisposition[] {
  const { nodes, edges } = projection.graph;
  return records.stated_items.map((item, stated_index): StatedDisposition => {
    // Retain the decoded input too: a rejected index alone cannot explain a loss after reload.
    const origin = { stated_index, stated_item: originalRecords.stated_items[stated_index]! };
    const carry = (location: StatedCarrier, stored_value: unknown): StatedDisposition =>
      ({ ...origin, disposition: 'carried', location, stored_value });
    const nodeId = statedNodeIds.get(stated_index);
    const node = nodes.find(n => n.id === nodeId);
    // A typed relationship needs its executable bundle, never just its cause label.
    if (item.relationship !== undefined) {
      const edge = edges.find(e => e.provenance?.magnitude === 'user_stated'
        && (e.provenance.basis ?? []).includes(nodeId ?? '')
        && e.provenance.stated_relationship?.from_quantity === item.relationship!.from_quantity
        && e.provenance.stated_relationship?.to_quantity === item.relationship!.to_quantity);
      if (edge?.provenance?.natural_effect !== undefined) return carry({ kind: 'edge', from: edge.from, to: edge.to, path: ['provenance', 'natural_effect'] }, edge.provenance.natural_effect);
    } else if (item.value !== undefined) {
      // The target and the independent baseline/horizon references select their owner.
      for (const [index, goal] of records.stated_items.entries()) {
        const goalNode = nodes.find(n => n.id === statedNodeIds.get(index) && n.kind === 'goal');
        if (goalNode === undefined) continue;
        const path = index === stated_index ? 'goal_threshold_raw'
          : goal.baseline_ref === stated_index ? 'goal_baseline_raw'
            : goal.horizon_ref === stated_index ? 'goal_horizon_months' : undefined;
        if (path !== undefined && field(goalNode, [path]) === item.value) return carry({ kind: 'node', node_id: goalNode.id, path: [path] }, item.value);
      }
      if (node?.observed_state?.raw_value === item.value) return carry({ kind: 'node', node_id: node.id, path: ['observed_state', 'raw_value'] }, item.value);
      // An intervention's binder supplies the actual stated index, not a rendered string.
      for (const option of nodes) {
        const details = option.data?.intervention_details;
        if (!object(details)) continue;
        for (const [factorId, detail] of Object.entries(details)) {
          if (object(detail) && detail.source === 'brief_extraction' && detail.stated_index === stated_index
            && detail.raw_value === literalConventionValue(item.value, item.unit, item.value_scale)) {
            return carry({ kind: 'node', node_id: option.id, path: ['data', 'intervention_details', factorId, 'raw_value'] }, detail.raw_value);
          }
        }
      }
    } else if (node !== undefined) return carry({ kind: 'node', node_id: node.id, path: [] }, { id: node.id });
    const dropped = projection.dropped.find(row => row.stated_index === stated_index);
    return { ...origin, disposition: 'rejected', reason: dropped?.reason
      ?? (item.relationship !== undefined ? 'stated_relationship_not_carried' : 'stated_value_not_carried') };
  });
}

/** A later transform can withdraw a carrier. Never advertise a vanished or changed write. */
export function reconcileStatedDispositions(rows: readonly StatedDisposition[], graph: unknown): readonly StatedDisposition[] {
  return rows.map(row => {
    if (row.disposition !== 'carried') return row;
    const location = row.location;
    const collection = object(graph) ? graph[location.kind === 'node' ? 'nodes' : 'edges'] : undefined;
    const carrier = Array.isArray(collection) ? collection.find(item => object(item)
      && (location.kind === 'node' ? item.id === location.node_id : item.from === location.from && item.to === location.to)) : undefined;
    // The existing V1→V3 transform relocates these two writes. Reconcile at the
    // registered V3 bytes, using the same carrier identity, never a label/value search.
    const path = location.path[0] === 'goal_baseline_raw' ? ['observed_state', 'raw_value']
      : location.path[0] === 'data' && location.path[1] === 'intervention_details'
        ? ['interventions', ...location.path.slice(2)] : location.path;
    const held = path.length === 0 && object(carrier) ? { id: carrier.id } : field(carrier, path);
    if (held !== undefined && JSON.stringify(held) === JSON.stringify(row.stored_value)) return { ...row, location: { ...location, path } };
    return { stated_index: row.stated_index, stated_item: row.stated_item, disposition: 'rejected', reason: 'carrier_removed' };
  });
}
