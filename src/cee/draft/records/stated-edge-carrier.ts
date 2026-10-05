import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';
import { readStatedRelationship, statedEffectQuoteMatches } from '../../provenance/stated-effect.js';
import type { DraftStatedRelationship } from './grammar.js';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The write the user stated; frame fitting may change every other field. */
export function sameStatedNaturalEffect(a: unknown, b: unknown): boolean {
  if (!object(a) || !object(b)) return false;
  const stated = (effect: Record<string, unknown>) => Object.fromEntries(Object.entries(effect)
    .filter(([key]) => !['strength_mean', 'strength_std', 'strength_mean_frame'].includes(key)));
  return stableStringify(stated(a)) === stableStringify(stated(b));
}

/** Read a records edge by its recorded endpoint and quantity identities, never labels. */
export function readRecordsEdgeEffect(edge: Record<string, unknown>, nodes: readonly Record<string, unknown>[], quote: string) {
  const p = edge.provenance;
  if (!object(p) || p.source !== 'brief_extraction' || p.magnitude !== 'user_stated'
    || !object(p.stated_relationship) || !object(p.natural_effect)) return undefined;
  const recorded = p.stated_relationship;
  const parsed = readStatedRelationship(recorded);
  if (parsed === undefined || recorded.from_node !== edge.from || recorded.to_node !== edge.to) return undefined;
  const source = nodes.find(n => n.id === edge.from), target = nodes.find(n => n.id === edge.to);
  if (source === undefined || target === undefined
    || source.quantity_ref !== undefined && source.quantity_ref !== parsed.from_quantity
    || target.quantity_ref !== undefined && target.quantity_ref !== parsed.to_quantity) return undefined;
  // Keep the compiler's literal and range evidence: the minimal persisted reader
  // validates the required fields but intentionally returns only those fields.
  for (const key of ['amount_literal', 'per_source_literal']) {
    if (recorded[key] !== undefined && typeof recorded[key] !== 'string') return undefined;
  }
  if (recorded.range !== undefined) {
    const range = recorded.range;
    if (!object(range) || typeof range.low !== 'number' || !Number.isFinite(range.low)
      || typeof range.high !== 'number' || !Number.isFinite(range.high)
      || typeof range.low_literal !== 'string' || typeof range.high_literal !== 'string') return undefined;
  }
  const authority = { ...recorded, ...parsed } as DraftStatedRelationship;
  const natural = p.natural_effect;
  for (const key of ['amount', 'amount_unit', 'per_source_change', 'per_source_change_unit'] as const) {
    if (natural[key] !== authority[key]) return undefined;
  }
  const detail = { amount: authority.amount!, amount_unit: authority.amount_unit!,
    per_source_change: authority.per_source_change!, per_source_change_unit: authority.per_source_change_unit! };
  if (detail.amount === 0 || detail.per_source_change === 0 || !statedEffectQuoteMatches(quote, detail, authority)) return undefined;
  const sign = Math.sign(detail.amount) * Math.sign(detail.per_source_change);
  if (edge.effect_direction === 'positive' && sign < 0 || edge.effect_direction === 'negative' && sign > 0) return undefined;
  return { detail, authority };
}
