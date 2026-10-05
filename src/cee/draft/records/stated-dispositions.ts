import { literalConventionValue } from './quantity-evidence.js';
import type { DraftRecordSet, DraftStatedItem } from './grammar.js';
import type { DroppedRecordRef, RecordProjection } from './projector.js';
import { sameStatedNaturalEffect } from './stated-edge-carrier.js';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';

/** Edge endpoints are its persisted identity; V3 deliberately strips legacy edge ids. */
export type StatedCarrier = (
  | { readonly kind: 'node'; readonly node_id: string }
  | { readonly kind: 'edge'; readonly from: string; readonly to: string }
) & { readonly path: readonly string[] };
export type StatedDisposition = { readonly stated_index: number; readonly stated_item: DraftStatedItem } & (
  | { readonly disposition: 'carried'; readonly location: StatedCarrier; readonly stored_value: unknown }
  | { readonly disposition: 'rejected'; readonly reason: DroppedRecordRef['reason'] | 'stated_value_not_carried' | 'stated_relationship_not_carried' | 'carrier_removed' }
  | { readonly disposition: 'asked'; readonly reason?: 'goal_quantity_missing' | 'link_unresolved' }
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

const FAILED_EVIDENCE = new Set<DroppedRecordRef['reason']>([
  'literal_absent', 'literal_ambiguous', 'literal_not_whole_amount', 'literal_value_mismatch',
  'span_and_literal_both', 'quantity_unit_undeclared', 'quantity_declaration_mismatch',
  'unit_not_evidenced', 'unit_period_ambiguous', 'unit_literal_contradicts_unit',
]);

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
    // P2-B6x: an unknown the projector asks about is an ask, never a carried value or a silent default.
    if (projection.dropped.some(d => d.stated_index === stated_index && d.reason === 'goal_quantity_missing')) {
      return { ...origin, disposition: 'asked', reason: 'goal_quantity_missing' };
    }
    // Fix (a): a required link the drafter typed "unresolved" is an ask on this item, ahead of a rejection.
    // ⭐ S2 (Lead/Science, 5 Oct): A CARRIED ITEM IS REPORTED CARRIED. The ask on its unresolved link stays (its
    // `link_unresolved` row and open question), but the receipt never contradicts the graph that holds its value.
    const settled = settle();
    if (settled.disposition !== 'carried' && projection.dropped.some(d => d.stated_index === stated_index && d.reason === 'link_unresolved')) {
      return { ...origin, disposition: 'asked', reason: 'link_unresolved' };
    }
    return settled;
    function settle(): StatedDisposition {
    const evidenceFailure = projection.dropped.find(d => d.stated_index === stated_index && FAILED_EVIDENCE.has(d.reason));
    if (evidenceFailure !== undefined) return { ...origin, disposition: 'rejected', reason: evidenceFailure.reason };
    const nodeId = statedNodeIds.get(stated_index);
    const node = nodes.find(n => n.id === nodeId);
    if (item.kind === 'option_effect' && item.option_effect !== undefined) {
      const e = item.option_effect;
      const option = nodes.find(n => n.id === statedNodeIds.get(e.option));
      const details = option?.data?.intervention_details;
      if (option !== undefined && object(details)) for (const [factorId, detail] of Object.entries(details)) {
        if (!object(detail) || detail.source !== 'brief_extraction' || detail.stated_index !== stated_index) continue;
        const key = e.change_by === undefined ? 'raw_value' : 'change_by';
        const value = literalConventionValue(e.sets_to ?? e.change_by!, records.stated_items[e.quantity]?.unit, records.stated_items[e.quantity]?.value_scale);
        if (detail[key] === value) return carry({ kind: 'node', node_id: option.id, path: ['data', 'intervention_details', factorId, key] }, value);
      }
    }
    // The rate-less cause door carries the same option intervention, identified
    // by its owning stated index and target quantity rather than a causal edge.
    if (item.kind === 'cause' && item.relationship?.per_source_change === undefined && item.relationship?.amount !== undefined) {
      for (const option of nodes.filter(n => n.kind === 'option')) {
        const details = option.data?.intervention_details;
        if (!object(details)) continue;
        for (const [factorId, detail] of Object.entries(details)) {
          if (!object(detail) || detail.source !== 'brief_extraction' || detail.stated_index !== stated_index
            || nodes.find(n => n.id === factorId)?.quantity_ref !== item.relationship.to_quantity
            || detail.change_by !== item.relationship.amount) continue;
          return carry({ kind: 'node', node_id: option.id, path: ['data', 'intervention_details', factorId, 'change_by'] }, detail.change_by);
        }
      }
    }
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
          if (!object(detail) || detail.source !== 'brief_extraction' || detail.stated_index !== stated_index) continue;
          const stated = literalConventionValue(item.value, item.unit, item.value_scale);
          // A delta option's own carrier is its `change_by` (P2-A1): its `raw_value` is the compile-time absolute
          // (baseline + delta), never the figure the user stated, so it is never compared with it (Codex R1 F4).
          if (detail.change_by !== undefined) {
            if (detail.change_by === stated) return carry({ kind: 'node', node_id: option.id, path: ['data', 'intervention_details', factorId, 'change_by'] }, detail.change_by);
          } else if (detail.raw_value === stated) {
            return carry({ kind: 'node', node_id: option.id, path: ['data', 'intervention_details', factorId, 'raw_value'] }, detail.raw_value);
          }
        }
      }
    } else if (node !== undefined) return carry({ kind: 'node', node_id: node.id, path: [] }, { id: node.id });
    const dropped = projection.dropped.find(row => row.stated_index === stated_index);
    return { ...origin, disposition: 'rejected', reason: dropped?.reason
      ?? (item.relationship !== undefined ? 'stated_relationship_not_carried' : 'stated_value_not_carried') };
    }
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
    // Structural equality, independent of object KEY ORDER: a GraphV3 parse rebuilds objects in schema order (a
    // `natural_effect` came back reordered), and the same carrier must not read as removed (R2, Codex P2).
    const sameWrite = location.kind === 'edge' && path.join('.') === 'provenance.natural_effect'
      ? sameStatedNaturalEffect(held, row.stored_value)
      : held !== undefined && stableStringify(held) === stableStringify(row.stored_value);
    let sameRange = true;
    if (location.kind === 'edge' && row.stated_item.relationship !== undefined && object(carrier)) {
      const p = carrier.provenance;
      const actual = object(p) && object(p.stated_relationship) ? p.stated_relationship : undefined;
      const expected = row.stated_item.relationship;
      if (actual !== undefined) {
        sameRange = actual.from_quantity === expected.from_quantity && actual.to_quantity === expected.to_quantity
          && actual.from_node === location.from && actual.to_node === location.to;
        const actualRange = actual.range;
        if (expected.range !== undefined && object(held) && typeof held.amount === 'number'
          && typeof expected.amount === 'number' && expected.amount !== 0) {
          // Input evidence retains its original convention. The executable write
          // may express a loss on a quantity level with the opposite sign.
          const factor = held.amount / expected.amount;
          const ends = [expected.range.low * factor, expected.range.high * factor].sort((a, b) => a - b);
          sameRange &&= object(actualRange) && actualRange.low === ends[0] && actualRange.high === ends[1]
            && actualRange.meaning === expected.range.meaning;
        } else sameRange &&= actualRange === undefined && expected.range === undefined;
      } else if (expected.range !== undefined) sameRange = false;
    }
    if (sameWrite && sameRange) return { ...row, location: { ...location, path }, stored_value: held };
    return { stated_index: row.stated_index, stated_item: row.stated_item, disposition: 'rejected', reason: 'carrier_removed' };
  });
}
