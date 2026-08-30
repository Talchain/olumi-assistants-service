import { z } from 'zod';
import type { FactorEstimate } from './types.js';

const identity = {
  factor_id: z.string().min(1).refine((id) => id.trim() === id, 'factor_id must be exact'),
  reasoning: z.string().trim().min(1).max(2000),
};
const basis = z.array(z.string().min(1).max(200).refine((ref) => ref.trim() === ref, 'basis reference must be exact')).max(16)
  .refine((refs) => new Set(refs).size === refs.length, 'duplicate basis reference');
const estimated = { ...identity, estimate_type: z.literal('estimated'), basis: basis.refine((refs) => refs.length > 0, 'estimate requires supplied context basis') };
const pointEstimate = z.object({ ...estimated, value: z.number().finite(), std: z.number().finite().positive() }).strict();
const rangeEstimate = z.object({
  ...estimated,
  distribution: z.literal('uniform'),
  range_min: z.number().finite(),
  range_max: z.number().finite(),
}).strict().refine((item) => item.range_min < item.range_max, 'range bounds must be strictly ordered');
const unknownEstimate = z.object({ ...identity, estimate_type: z.literal('unknown'), basis }).strict();
const response = z.object({ estimates: z.array(z.union([pointEstimate, rangeEstimate, unknownEstimate])) }).strict();

export type FactorEstimatesParseResult =
  | { readonly ok: true; readonly estimates: readonly FactorEstimate[] }
  | { readonly ok: false; readonly error: string };

/** Whole-response rejection prevents partial parsing from hiding a contract violation. */
export function parseFactorEstimates(raw: unknown, requestedIds: readonly string[]): FactorEstimatesParseResult {
  const requested = new Set(requestedIds);
  if (requested.size !== requestedIds.length || requestedIds.some((id) => id.length === 0 || id.trim() !== id)) {
    return { ok: false, error: 'invalid_requested_ids' };
  }
  const parsed = response.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid_estimate_contract' };
  const seen = new Set<string>();
  for (const item of parsed.data.estimates) {
    if (!requested.has(item.factor_id)) return { ok: false, error: 'unrequested_factor_id' };
    if (seen.has(item.factor_id)) return { ok: false, error: 'duplicate_factor_id' };
    seen.add(item.factor_id);
  }
  // Missing IDs remain operationally unresolved; never manufacture model abstention.
  return { ok: true, estimates: parsed.data.estimates };
}

const commonProperties = {
  factor_id: { type: 'string', description: 'Exact canonical factor_id from requested gaps.' },
  reasoning: { type: 'string', description: 'Concrete rationale and uncertainty basis, or reason estimation is unsupported.' },
  basis: { type: 'array', items: { type: 'string' }, description: 'Exact supplied context reference IDs; at least one for an estimated item.' },
};

function itemSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) };
}

/** API-compatible first fence. The parser enforces finite/bounded values and identity. */
export const FACTOR_ESTIMATES_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['estimates'],
  properties: {
    estimates: {
      type: 'array',
      items: {
        anyOf: [
          itemSchema({
            ...commonProperties,
            estimate_type: { type: 'string', enum: ['estimated'] },
            value: { type: 'number', description: 'Finite estimate in the existing factor unit and scale.' },
            std: { type: 'number', description: 'Strictly positive finite standard deviation in the same unit.' },
          }),
          itemSchema({
            ...commonProperties,
            estimate_type: { type: 'string', enum: ['estimated'] },
            distribution: { type: 'string', enum: ['uniform'] },
            range_min: { type: 'number', description: 'Finite lower bound, strictly below range_max.' },
            range_max: { type: 'number', description: 'Finite upper bound, strictly above range_min.' },
          }),
          itemSchema({ ...commonProperties, estimate_type: { type: 'string', enum: ['unknown'] } }),
        ],
      },
    },
  },
};
