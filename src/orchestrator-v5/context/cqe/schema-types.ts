// Local mirror of CQE types that v0.6.0 re-exported from
// @talchain/schemas/orchestrator. v0.7.0 still ships the underlying files
// (dist/orchestrator/quantity-extraction.*) but dropped them from the
// orchestrator barrel. These declarations started byte-identical to the
// tarball's package/dist/orchestrator/quantity-extraction.d.ts; O-1 (batch
// mutation lifecycle) then added the OPTIONAL `span_start`/`span_end`
// fields below, so a future re-export swap must first upstream those two
// fields (they are additive-optional, so the swap remains a schema
// superset, not a breaking change).
//
// Naming: the schemas-package original is `ParameterOperator`. That name
// collides with Phase 1's canonical routing enum (spec §5) defined in
// src/orchestrator-v5/routing/types.ts — a DIFFERENT enum with different
// members. validate-handler-ownership.sh guards the canonical name, so
// this module re-exports the CQE variant as `CqeParameterOperator` to
// disambiguate. CQE-internal callers import under the Cqe- prefix.
import { z } from 'zod';

export const CqeParameterOperatorSchema = z.enum([
  'set',
  'add',
  'multiply',
  'increment',
  'decrement',
]);
export type CqeParameterOperator = z.infer<typeof CqeParameterOperatorSchema>;

export const QuantityExtractionResultSchema = z
  .object({
    raw_text: z.string(),
    value: z.number().nullable(),
    unit: z.string().nullable(),
    direction: z.enum(['up', 'down', 'set', 'unknown']).nullable(),
    multiplier: z.number().nullable(),
    operator: CqeParameterOperatorSchema.nullable(),
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
    // O-1 (batch mutation lifecycle) — the NUMERIC VALUE TOKEN's span,
    // expressed as offsets into the CQE-NORMALISED text (preNormalise →
    // word-number pre-pass), NOT the raw message. The compound value-update
    // detector uses these to bind a quantity to the factor label whose
    // bounded segment contains it — global document-order pairing silently
    // misattributed stray numbers (a leading "2026" became a factor value,
    // Codex F2). Optional: a match with no digit-bearing value token (e.g.
    // "double it") carries no span, and the compound path refuses to pair it.
    span_start: z.number().int().nonnegative().optional(),
    span_end: z.number().int().nonnegative().optional(),
  })
  .strict();
export type QuantityExtractionResult = z.infer<typeof QuantityExtractionResultSchema>;
