// Local mirror of CQE types that v0.6.0 re-exported from
// @talchain/schemas/orchestrator. v0.7.0 still ships the underlying files
// (dist/orchestrator/quantity-extraction.*) but dropped them from the
// orchestrator barrel. These declarations are byte-identical to the
// tarball's package/dist/orchestrator/quantity-extraction.d.ts so a future
// v0.7.x that restores the barrel export can swap this file for a
// re-export without code-site changes.
import { z } from 'zod';

export const ParameterOperatorSchema = z.enum([
  'set',
  'add',
  'multiply',
  'increment',
  'decrement',
]);
export type ParameterOperator = z.infer<typeof ParameterOperatorSchema>;

export const QuantityExtractionResultSchema = z
  .object({
    raw_text: z.string(),
    value: z.number().nullable(),
    unit: z.string().nullable(),
    direction: z.enum(['up', 'down', 'set', 'unknown']).nullable(),
    multiplier: z.number().nullable(),
    operator: ParameterOperatorSchema.nullable(),
    comparator: z.enum(['at_least', 'at_most', 'between']).nullable(),
    range_min: z.number().nullable(),
    range_max: z.number().nullable(),
    approximate: z.boolean(),
    source: z.enum(['cqe', 'compromise', 'unparsed']),
    value_origin: z
      .enum([
        'literal',
        'lexical_quantifier',
        'word_fraction',
        'suffix_expansion',
        'word_number',
        'parsed_numeric',
      ])
      .optional(),
  })
  .strict();
export type QuantityExtractionResult = z.infer<typeof QuantityExtractionResultSchema>;
