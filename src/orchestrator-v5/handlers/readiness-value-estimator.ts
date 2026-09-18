/**
 * ⭐⭐ THE MISSING HALF OF `readiness-value-batch`: something that PRODUCES the
 * estimates.
 *
 * `buildValueBatchProposal` takes `estimates` as a PARAMETER. Two independent
 * reviews measured that no caller supplies them and that the module is
 * therefore dark — "it estimates nothing; it is a validator and assembler
 * around a derivation" that does not exist. This is that derivation.
 *
 * THE HARM IT CLOSES, in the user's own words from the witnessed session:
 *   *"Just put reasonable estimates in for each one, and then we'll review them
 *   together."* — said THREE TIMES. The product could not act, and offered to
 *   work through ten values one at a time instead.
 *
 * ⚠ WHY THIS IS A MODEL CALL AND NOT A DERIVATION. A missing option→factor
 * effect value is not recoverable from the graph: the graph records that the
 * link exists and what the factor's own level is, never what THIS option would
 * set it to. Deriving one from neighbouring options' values would be inventing
 * a number and presenting it as arithmetic. The model is the honest source, and
 * every value it returns is marked as its own (`VALUE_BATCH_INTERVENTION_SOURCE`)
 * and reviewed by the user before anything is applied.
 *
 * ⭐ DECLINING IS A FIRST-CLASS ANSWER, NOT AN ERROR PATH. `ValueBatchEstimate`
 * declares `value: number | null` with `declined_reason` required when null —
 * the contract was designed for a producer that can refuse. A producer that
 * always answers would make that field dead and would, on the cells it cannot
 * judge, do exactly what this estate's grammar work exists to stop: emit a
 * confident number with nothing behind it. The prompt therefore asks for a
 * refusal by name, and the schema below makes `declined_reason` structurally
 * required on a null — so a model that declines without saying why fails
 * validation rather than producing a silent blank.
 *
 * ⚠ THE UNIT IS THE MODEL UNIT, AND THE PROMPT SAYS SO IN THE PRODUCT'S OWN
 * WORDS. The deployed coaching for this exact gap reads: *"Just the percentage
 * is enough — it is the level the factor reaches, not how much it moves: 0%
 * means zero, 100% means its top."* (witnessed on staging, 18 Sep 08:47Z). The
 * system prompt restates that sentence rather than paraphrasing it, so the
 * number the model returns means the same thing as the number a user types into
 * the same gap. Two spellings of one convention is how this estate's scale
 * defects start.
 */

import { z } from 'zod';
import type { ValueBatchCell, ValueBatchEstimate } from './readiness-value-batch.js';

/**
 * What the model is asked to return, and the shape Structured Outputs enforces.
 *
 * ⚠ `.strict()` is deliberate. An unrecognised key means the model answered a
 * question we did not ask, and silently dropping it would hide a prompt/schema
 * divergence the next reader would have to re-derive from behaviour.
 */
const EstimateRow = z
  .object({
    option_id: z.string().min(1),
    factor_id: z.string().min(1),
    /**
     * Model-unit level in [0,1], or null for an honest refusal. The bound is
     * asserted HERE and not only in the prompt: a prompt is a request and a
     * schema is a guarantee, and `buildValueBatchProposal` is entitled to assume
     * the values it validates already sit in the contract's domain.
     */
    value: z.number().min(0).max(1).nullable(),
    reasoning: z.string().min(1).optional(),
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    declined_reason: z.string().min(1).optional(),
  })
  .strict()
  .refine((r) => r.value !== null || typeof r.declined_reason === 'string', {
    message: 'declined_reason is required when value is null',
    path: ['declined_reason'],
  });

const EstimateResponse = z.object({ estimates: z.array(EstimateRow) }).strict();

/** JSON Schema handed to Anthropic Structured Outputs. Mirrors `EstimateResponse`. */
export const VALUE_ESTIMATE_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['estimates'],
  properties: {
    estimates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['option_id', 'factor_id', 'value'],
        properties: {
          option_id: { type: 'string' },
          factor_id: { type: 'string' },
          value: { type: ['number', 'null'], minimum: 0, maximum: 1 },
          reasoning: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          declined_reason: { type: 'string' },
        },
      },
    },
  },
};

/** Per-factor context the model needs in order to judge a level. */
export interface ValueEstimateFactorContext {
  readonly factor_id: string;
  readonly label: string | undefined;
  /** The factor's own current level, model-unit, when the graph carries one. */
  readonly current_value: number | undefined;
  readonly unit: string | undefined;
}

export interface ValueEstimateRequest {
  readonly cells: readonly ValueBatchCell[];
  readonly factors: readonly ValueEstimateFactorContext[];
  /** The user's own framing of the decision, when the turn carries it. */
  readonly brief: string | undefined;
}

/**
 * The network boundary, INJECTED.
 *
 * ⚠ This is why the module is testable without a paid call, and it is not
 * decoration: a fixture you wrote yourself is not evidence about the wire, so
 * the unit tests here prove the PROMPT CONTRACT and the PARSE and make no claim
 * about model behaviour. Anything claiming the latter needs a live call and
 * must say so.
 */
export type ValueEstimateModelCall = (args: {
  system: string;
  userMessage: string;
  outputSchema: Record<string, unknown>;
}) => Promise<{ content: string }>;

export type ValueEstimateOutcome =
  | { readonly status: 'ok'; readonly estimates: readonly ValueBatchEstimate[] }
  | { readonly status: 'no_cells' }
  | { readonly status: 'unparseable'; readonly detail: string }
  | { readonly status: 'off_contract'; readonly detail: string };

export const VALUE_ESTIMATE_SYSTEM_PROMPT = [
  'You are estimating option effect values for a causal decision model.',
  '',
  'For each cell you are given, return the level the factor reaches WHEN THAT',
  'OPTION IS TAKEN, as a number between 0 and 1.',
  '',
  'The unit is the level the factor reaches, not how much it moves:',
  '0 means zero, 1 means its top. (0.85 is 85%.)',
  '',
  'Rules:',
  '- Answer ONLY the cells given. Never invent a cell, an option or a factor.',
  '- Every value is your estimate, not the user’s. It is shown to them as',
  '  yours and reviewed before anything is applied, so estimate rather than',
  '  hedge — but see the next rule.',
  '- If you cannot judge a cell defensibly, return value: null and say why in',
  '  declined_reason. A refusal is a correct answer and is preferred to a number',
  '  you cannot justify. Do not spread uncertainty across every cell in order to',
  '  avoid refusing one.',
  '- reasoning: one short sentence giving the basis for the number.',
  '- confidence: high | medium | low.',
].join('\n');

/** Separator for cell identity. Ids are hex/slug, so this cannot collide. */
const CELL_SEP = '::';
const cellIdentity = (optionId: string, factorId: string): string =>
  `${optionId}${CELL_SEP}${factorId}`;

/** The user-content half. Exported so a test can assert what the model is told. */
export function buildValueEstimateUserContent(req: ValueEstimateRequest): string {
  const factorById = new Map(req.factors.map((f) => [f.factor_id, f]));
  const lines: string[] = [];
  if (req.brief && req.brief.trim().length > 0) {
    lines.push('## The decision', req.brief.trim(), '');
  }
  lines.push('## Cells to estimate');
  for (const c of req.cells) {
    const f = factorById.get(c.factor_id);
    const level =
      f?.current_value === undefined
        ? 'no current level recorded'
        : `currently ${f.current_value}`;
    const unit = f?.unit ? `, unit ${f.unit}` : '';
    lines.push(
      `- option_id=${c.option_id} "${c.option_label ?? c.option_id}" ` +
        `-> factor_id=${c.factor_id} "${c.factor_label ?? f?.label ?? c.factor_id}" (${level}${unit})`,
    );
  }
  return lines.join('\n');
}

/**
 * Ask the model for one estimate per cell.
 *
 * ⭐ THE RETURN IS FILTERED TO THE CELLS ASKED, BY IDENTITY. The model can echo
 * a pair we did not ask about — `buildValueBatchProposal` already rejects that
 * with `unknown_cell`, and letting it get that far would turn a producer defect
 * into a user-visible refusal of the WHOLE batch. Dropping it here keeps the
 * batch answerable, and the drop is not hidden: `cells.length` vs
 * `estimates.length` is the discrepancy, and the caller holds both.
 */
export async function estimateValueBatch(
  req: ValueEstimateRequest,
  call: ValueEstimateModelCall,
): Promise<ValueEstimateOutcome> {
  if (req.cells.length === 0) return { status: 'no_cells' };

  const res = await call({
    system: VALUE_ESTIMATE_SYSTEM_PROMPT,
    userMessage: buildValueEstimateUserContent(req),
    outputSchema: VALUE_ESTIMATE_OUTPUT_SCHEMA,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(res.content);
  } catch {
    return { status: 'unparseable', detail: res.content.slice(0, 200) };
  }

  const parsed = EstimateResponse.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'off_contract',
      detail: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    };
  }

  const asked = new Set(req.cells.map((c) => cellIdentity(c.option_id, c.factor_id)));
  const estimates: ValueBatchEstimate[] = [];
  for (const row of parsed.data.estimates) {
    if (!asked.has(cellIdentity(row.option_id, row.factor_id))) continue;
    estimates.push({
      option_id: row.option_id,
      factor_id: row.factor_id,
      value: row.value,
      ...(row.reasoning ? { reasoning: row.reasoning } : {}),
      ...(row.confidence ? { confidence: row.confidence } : {}),
      ...(row.declined_reason ? { declined_reason: row.declined_reason } : {}),
    });
  }
  return { status: 'ok', estimates };
}
