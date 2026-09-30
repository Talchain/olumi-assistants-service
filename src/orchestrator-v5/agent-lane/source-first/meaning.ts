import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Private extraction contract. It is not persisted and contains no graph IDs. */
export const SourceSpanSchema = z.object({
  quote: z.string().min(1),
  // Offsets count UTF-16 code units in the unchanged input, as String.slice does.
  start: z.number().int().nonnegative().nullable(),
  end: z.number().int().nonnegative().nullable(),
}).strict();
const ref = z.string().min(1).max(120);
export const UnitSchema = z.object({
  kind: z.enum(['currency', 'count', 'percent', 'percentage_points', 'time', 'index', 'other']),
  currency: z.enum(['GBP', 'USD', 'EUR']).nullable(),
  period: z.enum(['day', 'week', 'month', 'quarter', 'year']).nullable(),
  counted_object: z.string().min(1).nullable(),
  as_stated: z.string().min(1),
}).strict();
export const NumberClaimSchema = z.object({
  literal: z.string().min(1),
  // Decimal text avoids asking the provider to round or encode graph numbers.
  value: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  source: SourceSpanSchema,
}).strict();
export const SourceMeaningSchema = z.object({
  entities: z.array(z.object({
    ref,
    kind: z.enum(['goal', 'factor', 'outcome', 'risk', 'decision', 'option']),
    label: z.string().min(1).max(250),
    source: SourceSpanSchema,
  }).strict()),
  // Read old frozen extractions too; the provider schema below requires these
  // channels on new extractions. Metadata never stands in for a numeric claim.
  entity_metadata: z.array(z.object({
    entity_ref: ref,
    unit: z.object({
      value: UnitSchema,
      authorship: z.enum(['explicit', 'interpretation']),
      source: SourceSpanSchema,
    }).strict().nullable(),
    deadline: z.object({
      as_stated: z.string().min(1).max(60),
      horizon_months: z.number().int().positive().nullable(),
      source: SourceSpanSchema,
    }).strict().nullable(),
  }).strict()).optional(),
  evidence_ranges: z.array(z.object({
    ref,
    entity_ref: ref,
    literal: z.string().min(1),
    lower_value: z.string().regex(/^-?\d+(?:\.\d+)?$/),
    upper_value: z.string().regex(/^-?\d+(?:\.\d+)?$/),
    unit: UnitSchema,
    source: SourceSpanSchema,
  }).strict()).optional(),
  quantities: z.array(z.object({
    ref,
    entity_ref: ref,
    role: z.enum(['current', 'target', 'proposed_level', 'absolute_change', 'relative_change', 'limit', 'evidence']),
    frame: z.enum(['level', 'change_abs', 'change_rel']),
    direction: z.enum(['increase', 'decrease', 'none']),
    number: NumberClaimSchema,
    unit: UnitSchema,
    comparator: z.enum(['<', '<=', '>', '>=', '=']).nullable(),
    horizon_months: z.number().int().positive().nullable(),
  }).strict()),
  options: z.array(z.object({
    entity_ref: ref,
    is_status_quo: z.boolean(),
    interventions: z.array(z.object({
      entity_ref: ref,
      quantity_ref: ref.nullable(),
      source: SourceSpanSchema,
    }).strict()),
  }).strict()),
  definitions: z.array(z.object({
    ref,
    target_ref: ref,
    operation: z.enum(['product', 'sum']),
    operand_refs: z.array(ref).min(2),
    authorship: z.enum(['explicit', 'interpretation']),
    source: SourceSpanSchema,
  }).strict()),
  causal_claims: z.array(z.object({
    ref,
    from_ref: ref,
    to_ref: ref,
    direction: z.enum(['positive', 'negative', 'unknown']),
    source: SourceSpanSchema,
    // A bare coefficient has no unit/frame authority and is retained outside
    // GraphV3. A stated natural effect can be passed to the existing magnitude
    // contract only when both measured changes and their units are grounded.
    coefficient: NumberClaimSchema.nullable(),
    natural_effect: z.object({
      amount: NumberClaimSchema,
      amount_unit: UnitSchema,
      per_source_change: NumberClaimSchema,
      per_source_change_unit: UnitSchema,
    }).strict().nullable(),
    standard_deviation: NumberClaimSchema.nullable(),
    existence_probability: NumberClaimSchema.nullable(),
  }).strict()),
  unknowns: z.array(z.object({
    ref,
    entity_refs: z.array(ref),
    question: z.string().min(1),
    source: SourceSpanSchema.nullable(),
  }).strict()),
  // M1 is faithful. The separate widening role, not this constructor, fills
  // this channel. Keeping it typed prevents accidental canonical admission.
  proposals: z.array(z.object({
    ref,
    kind: z.enum(['option', 'factor', 'risk', 'opportunity', 'challenge']),
    label: z.string().min(1),
    reason: z.string().min(1),
  }).strict()),
}).strict();

export type SourceMeaning = z.infer<typeof SourceMeaningSchema>;
export type SourceSpan = z.infer<typeof SourceSpanSchema>;
export type SourceUnit = z.infer<typeof UnitSchema>;
export type NumberClaim = z.infer<typeof NumberClaimSchema>;
export type SourceQuantity = SourceMeaning['quantities'][number];
export type SourceEvidenceRange = NonNullable<SourceMeaning['evidence_ranges']>[number];
export type SourceDeadline = NonNullable<NonNullable<SourceMeaning['entity_metadata']>[number]['deadline']>;

export function buildSourceMeaningSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(SourceMeaningSchema, { $refStrategy: 'none' });
  const { $schema: _version, ...body } = schema;
  // Optional only for backwards-compatible offline parsing, never for new
  // strict structured output. Every top-level channel must be returned.
  return { ...body, required: Object.keys((body as { properties?: Record<string, unknown> }).properties ?? {}) };
}

export const SOURCE_MEANING_INSTRUCTIONS = `Read the original brief into source-grounded typed meaning. You are the faithful M1 constructor, not a creative widener. Return only the requested JSON schema.
Preserve every explicit option, consequential figure, target, limit, risk, outcome and uncertainty. Do not add options, factors or risks that the brief does not state. Return proposals: []; creative expansion belongs to a separate M2 role.
Use short stable internal refs, globally unique across entities, quantities, definitions, causal claims and unknowns. References identify entities; labels never do. A factor and option can have the same label but must have different refs. Use one entity for one actual quantity; a metric with a target is a goal, and its current level belongs to that same entity. Do not fabricate a decision or goal for sensemaking.
Copy source quotes exactly from the untouched brief, including punctuation. Quote the smallest complete clause that establishes subject and role, NOT a bare numeric token. Set start and end to null for unique quotes: code locates them exactly. Only use offsets to disambiguate repeated quotes, using UTF-16 positions. A number appearing in the brief does not prove it is a current value.
Each numeric claim has its exact written literal and expanded decimal value: £75k -> literal £75k, value 75000. Never calculate an unstated value. Separate current, target, proposed_level, absolute_change, relative_change, limit and evidence. For decrease BY 15%, keep value 15, direction decrease, frame change_rel; a level OF 15% has frame level and direction none. EVERY frame level claim has direction none, including proposed levels and targets; 'raise to £59' is proposed_level=59 with direction none, not a signed change. Current values always have frame level. Targets and limits preserve their own frame and strict comparator. No current value is inferred from a target or limit. Unknown is absent, never zero; stated zero is retained.
Units explicitly retain currency, period and counted object; as_stated copies the unit wording. counted_object means an actual counted population such as subscribers, employees or tickets, never a quantity label such as price, MRR or churn. For total currency or percentages use counted_object null unless a population denominator is stated. Currency/count rate: price per subscriber per month differs from total monthly revenue. Percentage points are not relative percent change. Set horizon_months only for an explicit month count or explicit year converted to months; never invent the year for 'Q3'.
Use entity_metadata for a stated unit or deadline even when the entity has no numeric current level or target. Bind each metadata item to that entity's own source clause. A currency inferred from context is authorship interpretation, never explicit. Keep deadlines verbatim in as_stated; horizon_months is null unless that deadline explicitly states a month or year count. Do not invent a numeric target to carry metadata.
Use evidence_ranges for an explicit range about the entity it actually describes. Preserve the whole written literal and its shared scale: '£1-2 million' has endpoints 1000000 and 2000000. A firm's deal-size range belongs to a firm-deal-size entity, never to total funding, its current level or its target. No midpoint, prior distribution, numeric frame or identity is inferred from an evidence range. Return entity_metadata: [] and evidence_ranges: [] when absent.
Each explicit option references exactly the quantities it changes. Quote the option's complete own clause including its intervention details, so its source and intervention sources overlap. An intervention's quantity_ref points to its stated level or change, never a target for the whole problem. Its numeric source must overlap that same intervention source. If the option names a change but gives no amount, quantity_ref is null. Do not manufacture a status-quo option; mark it only if the brief gives that alternative.
Before returning check: every options[].entity_ref names an entity of kind option, NEVER a decision entity. A question can contain an action: in 'Should we raise our Pro plan price from £49 to £59 a month?', make the raise-price action its own option entity and options[] entry, with an intervention on the price factor pointing to the stated £59 proposed level. A decision entity may retain the question, but its ref must not appear in options[]. The question does not state an effect on MRR or churn.
Bind current and desired change to the same metric ref when the brief uses the same scope, even if it calls the current measure 'spend' and the desired measure 'costs'. In 'Monthly spend is £45k; we want to cut costs by 20%', one goal entity carries both the £45k current level and the 20% decrease as a relative_change claim with frame change_rel. Do not make a separate factor for that current level, calculate an unstated absolute target, or treat 20% as the current level. Distinguish refs only when the brief really distinguishes scope; ask if scope is genuinely unclear. Current MRR and a target for that same MRR likewise use ONE goal entity with current and target quantity claims.
Definitions name the exact target and operand refs, not nearby intermediates. Explicit definitions require a source clause stating that relationship. A justified domain definition can be labelled interpretation, but compatible units and numerical coincidence alone are insufficient. If price times subscribers differs from stated MRR, preserve every figure and ask which revenue scope is intended; do not invent a reconciliation amount.
Causal claims are separate from definitions. Do not guess behavioural strength, probability or uncertainty. A natural effect such as "4 fewer subscribers per £1 increase in price" belongs in natural_effect: amount 4 subscribers, per_source_change £1 in the price unit. Copy each number and unit from its own source clause and retain the source and target refs. Never put a natural-unit figure in coefficient; leave coefficient null. natural_effect is null unless the brief supplies BOTH a target change and a source change. coefficient, standard_deviation and existence_probability stay null unless the brief explicitly supplies those parameters. If an uncertainty figure has no explicit frame, retain its exact words but do not guess what it measures. An unknown relationship stays unknown. Avoid cycles and invented connectivity.
Ask the smallest useful clarification for genuine unresolved meaning. Preserve all unambiguous content. Do not ask the user to repeat a number they supplied. Distinguish a model the product can retain from one ready for analysis.`;
