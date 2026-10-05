import { Ajv } from 'ajv';
import { buildStrictDraftRecordsSchema } from '../runtime/build-model-from-records.js';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';

const validateStrictRecords = new Ajv({ strict: false, allErrors: true }).compile(buildStrictDraftRecordsSchema());

type Schema = { type?: string; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[] };

/** Test-only wire encoding: strict optional fields are explicit nulls, exactly as the provider must emit. */
export function strictRecordsWire(records: DraftRecordSet): unknown {
  const encode = (value: unknown, node: Schema): unknown => {
    const shape = node.anyOf?.find(entry => entry.type !== 'null') ?? node;
    if (Array.isArray(value)) return value.map(item => encode(item, shape.items!));
    if (!shape.properties || value === null || typeof value !== 'object') return value;
    const held = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(shape.properties).map(([key, child]) => [key,
      key in held ? encode(held[key], child) : null]));
  };
  const wire = encode(records, buildStrictDraftRecordsSchema() as Schema);
  if (!validateStrictRecords(wire)) throw new Error(`Invalid records stub: ${JSON.stringify(validateStrictRecords.errors)}`);
  return wire;
}

/** Explicit test topology. References are array positions, never inferred from label overlap. */
export function constructionRecords(optionQuote = 'Hire a tech lead', goalQuote = 'Delivery reliability', factorLabel = 'Team capacity'): DraftRecordSet {
  return {
    stated_items: [
      { kind: 'goal', source_quote: goalQuote },
      { kind: 'option', source_quote: optionQuote },
    ],
    claims: [
      { claim_kind: 'factor', label: factorLabel, value: 5, unit: 'people', value_scale: 'raw_count' },
      { claim_kind: 'outcome', label: goalQuote },
      { claim_kind: 'causal_link', label: 'Option sets capacity', from_stated: 1, to_claim: 0, sets_to: 7, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Capacity affects result', from_claim: 0, to_claim: 1, effect: 'positive', strength: 0.5 },
      { claim_kind: 'causal_link', label: 'Result reaches goal', from_claim: 1, to_stated: 0, effect: 'positive', strength: 1 },
    ],
  };
}

/** Oversized records retain connected independent quantities; no compact verdict is fabricated. */
export function oversizedConstructionRecords(): DraftRecordSet {
  const records = constructionRecords();
  for (let index = 0; index < 35; index += 1) {
    const ref = records.claims.length;
    records.claims.push({ claim_kind: 'factor', label: `Secondary factor ${index}`, value: 0.5, value_scale: 'unit_interval' },
      { claim_kind: 'causal_link', label: `Secondary cause ${index}`, from_claim: ref, to_claim: 1, effect: 'positive', strength: 0.1 });
  }
  return records;
}

/** The same opposing price/subscriber paths as C46, without inventing a product carrier the grammar lacks. */
export function pricingConstructionRecords(): DraftRecordSet {
  return {
    stated_items: [
      { kind: 'goal', source_quote: 'goal of reaching £20k MRR within 12 months' },
      { kind: 'option', source_quote: 'increase the Pro plan price from £49 to £59 per month' },
    ],
    claims: [
      { claim_kind: 'factor', label: 'Pro plan price', value: 49, unit: 'GBP', value_scale: 'raw_count' },
      { claim_kind: 'factor', label: 'Pro subscribers', value: 300, unit: 'subscribers', value_scale: 'raw_count' },
      { claim_kind: 'factor', label: 'Monthly churn', value: 5, unit: '%', value_scale: 'raw_count' },
      { claim_kind: 'outcome', label: 'MRR' },
      { claim_kind: 'causal_link', label: 'Price level', from_stated: 1, to_claim: 0, sets_to: 59, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Price raises churn', from_claim: 0, to_claim: 2, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Churn lowers subscribers', from_claim: 2, to_claim: 1, effect: 'negative' },
      { claim_kind: 'causal_link', label: 'Price raises revenue', from_claim: 0, to_claim: 3, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Subscribers raise revenue', from_claim: 1, to_claim: 3, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Revenue reaches goal', from_claim: 3, to_stated: 0, effect: 'positive' },
    ],
  };
}
