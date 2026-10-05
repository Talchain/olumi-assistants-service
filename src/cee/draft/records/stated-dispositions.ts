import { goalQuantityCanonicaliser } from './goal-quantity-identity.js';
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
    // A no-effect clause is honoured without an executable edge. Do not let
    // its withdrawn model scaffold replace that receipt with "not connected".
    if (projection.dropped.some(d => d.stated_index === stated_index && d.reason === 'user_stated_no_effect')) {
      return { ...origin, disposition: 'rejected', reason: 'user_stated_no_effect' };
    }
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
  const canonical = goalQuantityCanonicaliser(new Map(rows.map(row => [row.stated_index, row.stated_item])));
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
        sameRange = actual.from_quantity === canonical(expected.from_quantity) && actual.to_quantity === canonical(expected.to_quantity)
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

/** RT-6 B4 input hook. No recorder or persisted reading carrier exists in this tree. */
export interface StatedUserReading {
  readonly stated_index: number;
  readonly reading: 'user_set_aside' | 'agent_proposed_user_confirmed';
}
export interface StatedRuleDisclosure {
  readonly stated_index: number;
  readonly quote: string;
  readonly code: string;
  readonly reason: string;
  readonly on_option_path: boolean;
  readonly actions?: readonly ['Add it', 'Leave it out'];
  readonly ask?: string;
  readonly increment_index?: number;
  readonly incoming_index?: number;
}
export const SIGN_CONFIRMATION_ASK = "I read 'loses about 2 customers' with 'each lost customer removes £300' as raising prices ADDING £6,000. Right, or does it take £6,000 away?";
type RuleRow = { readonly stated_index: number; readonly stated_item: unknown; readonly disposition: string; readonly location?: unknown; readonly reason?: string };
interface StatedPathEdge { from: string; to: string; index: number; amount?: number; per?: number; literal?: string }

/**
 * ONE compile / persisted Run / evaluation predicate (DROP-1 D1–D3, SIGN-1 S2).
 * Reachability is exclusively over the stated records, including refused / never-minted quantities.
 * A positive, reconciled receipt is the carried authority. Missing drops never supply it.
 */
export function assessStatedRules(rows: readonly RuleRow[], readings: readonly StatedUserReading[] = []) {
  const items = new Map<number, DraftStatedItem>();
  for (const row of rows) {
    if (!object(row.stated_item) || typeof row.stated_item.kind !== 'string' || typeof row.stated_item.source_quote !== 'string') continue;
    // The receipt's item is passthrough. Test every reference at use; malformed fields supply no identity.
    items.set(row.stated_index, row.stated_item as unknown as DraftStatedItem);
  }
  const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const canonical = goalQuantityCanonicaliser(new Map([...items].map(([index, item]) => [index, {
    ...item, baseline_ref: integer(item.baseline_ref) ? item.baseline_ref : undefined,
    quantity: integer(item.quantity) ? item.quantity : undefined,
  }])));
  const q = (n: number): string => `q:${canonical(n)}`;
  const edges: StatedPathEdge[] = [];
  const options: string[] = [];
  const goals = new Set<string>();
  for (const [index, item] of items) {
    if (item.kind === 'goal') goals.add(q(integer(item.quantity) ? item.quantity : index));
    if (item.kind === 'option') {
      const option = `o:${index}`; options.push(option);
      // A relationship can name the option's own stated index (including Keep with no numeric setting).
      // This supplies reachability, never a setting value.
      edges.push({from:option,to:q(integer(item.quantity)?item.quantity:index),index,amount:finite(item.value)?item.value:undefined,per:1});
    }
    const e = item.option_effect;
    if (object(e) && integer(e.option) && integer(e.quantity)) edges.push({from:`o:${e.option}`,to:q(e.quantity),index,
      amount:finite(e.change_by)?e.change_by:finite(e.sets_to)?e.sets_to:undefined,per:1});
    const r = item.relationship;
    if (object(r) && integer(r.from_quantity) && integer(r.to_quantity)) edges.push({from:q(r.from_quantity),to:q(r.to_quantity),index,
      amount:finite(r.amount)?r.amount:undefined,per:finite(r.per_source_change)?r.per_source_change:undefined,
      literal:typeof r.per_source_literal==='string'?r.per_source_literal:undefined});
  }
  const closure = (seeds: Iterable<string>, reverse=false): Set<string> => {
    const reached = new Set(seeds);
    for (let changed=true; changed;) {
      changed=false;
      for (const e of edges) {
        const from=reverse?e.to:e.from,to=reverse?e.from:e.to;
        if (reached.has(from) && !reached.has(to)) {reached.add(to);changed=true;}
      }
    }
    return reached;
  };
  const fromOptions=closure(options), toGoals=closure(goals,true);
  const onPath=(e:StatedPathEdge):boolean=>fromOptions.has(e.from) && toGoals.has(e.to);
  const aside = new Set(readings.filter(r=>r.reading==='user_set_aside').map(r=>r.stated_index));
  const confirmed = new Set(readings.filter(r=>r.reading==='agent_proposed_user_confirmed').map(r=>r.stated_index));
  const dropped: StatedRuleDisclosure[] = [];
  for (const row of rows) {
    const item=items.get(row.stated_index);
    if (item === undefined || item.kind !== 'cause' && item.kind !== 'option_effect' && item.relationship === undefined) continue;
    // D2: the server reconciles and binds carried locations before these rows are read.
    const carried = row.disposition === 'carried' && object(row.location) || row.reason === 'user_stated_no_effect';
    if (carried || aside.has(row.stated_index)) continue;
    const on_option_path=edges.some(e=>e.index===row.stated_index && onPath(e));
    const code=row.reason ?? (row.disposition==='asked'?'link_unresolved':'stated_relationship_not_carried');
    const reason=code==='literal_ambiguous'?'that figure appears twice in your sentence'
      : code==='relationship_unsized'?'the relationship has no usable size'
      : code==='unit_not_evidenced'?'the unit is not evidenced in that quote'
      : code==='carrier_removed'?'the recorded relationship is no longer in the model'
      : 'the analysis does not carry this stated cause';
    dropped.push({stated_index:row.stated_index,quote:item.source_quote,code,reason,on_option_path,actions:['Add it','Leave it out']});
  }
  const sign_unconfirmed: StatedRuleDisclosure[] = [];
  const non_increment_negative_pairs: {increment_index:number;incoming_index:number;outgoing_index:number}[] = [];
  const coefficient = (e:StatedPathEdge):number|undefined => e.amount===undefined || e.per===undefined || e.per===0 ? undefined : e.amount/e.per;
  const seenQuantities = new Set<string>();
  for (const [itemIndex,alias] of items) {
    const index=canonical(integer(alias.quantity)?alias.quantity:itemIndex);
    const item=items.get(index) ?? alias;
    const identity=q(index);
    if (seenQuantities.has(identity)) continue;
    seenQuantities.add(identity);
    for (const incoming of edges.filter(e=>e.to===identity && onPath(e))) for (const outgoing of edges.filter(e=>e.from===identity && onPath(e))) {
      const si=coefficient(incoming),so=coefficient(outgoing);
      const doubleNegative=si!==undefined && so!==undefined && si<0 && so<0;
      if (doubleNegative && item.kind!=='change_quantity') non_increment_negative_pairs.push({increment_index:index,incoming_index:incoming.index,outgoing_index:outgoing.index});
      const mirror=outgoing.per!==undefined && outgoing.per<0 && /^(?:each|every|per)\b/i.test(outgoing.literal?.trim() ?? '');
      if (item.kind!=='change_quantity' || !(doubleNegative || mirror) || confirmed.has(outgoing.index) || aside.has(outgoing.index)) continue;
      if (sign_unconfirmed.some(s=>s.increment_index===index)) continue; // S4 one ask per increment.
      sign_unconfirmed.push({stated_index:outgoing.index,increment_index:index,incoming_index:incoming.index,
        quote:items.get(outgoing.index)!.source_quote,code:'sign_unconfirmed',reason:'sign_unconfirmed',on_option_path:true,ask:SIGN_CONFIRMATION_ASK});
    }
  }
  return {dropped,sign_unconfirmed,non_increment_negative_pairs,
    block_leader:dropped.some(d=>d.on_option_path) || sign_unconfirmed.length>0};
}
