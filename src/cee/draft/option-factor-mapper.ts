/**
 * ⭐⭐ THE DRAFT-SEAM RE-ASK: "which factors does THIS option move?"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE HARM, and the reason the remedy sits HERE rather than in readiness.
 *
 * A founder asked whether to hire a tech lead or two developers. The drafter
 * returned four options; three carried option→factor edges and one — "Hire Two
 * Developers Only" — carried none. From that single omission the whole
 * downstream chain is determined, and every link in it is behaving correctly:
 *
 *   · `fixStatusQuoConnectivity` wires the unconnected option to the UNION of
 *     every factor its siblings target, stamped `origin: "repair"`, so the
 *     draft is not lost at the fail-closed `NO_PATH_TO_GOAL` gate;
 *   · readiness EXCLUDES those edges (`isRepairAuthoredOptionFactorEdge`) —
 *     correctly: the product must not bill the user for its own inventions;
 *   · so `connectedFactorCount === 0`, the option is `needs_user_mapping`
 *     (`transforms/option-status.ts:335-338`), and the blocker it mints
 *     (`OPTION_NEEDS_MAPPING`) names an option but NO factor;
 *   · the estimate batch therefore cannot touch it. `readiness-value-batch.ts`
 *     :70-75 refuses by design — *"IT NEVER GUESSES WHICH FACTOR"* — and the
 *     cell lands in `unsettable{reason:'factor_unknown'}` rather than in the
 *     one review card the user would have approved.
 *
 * The user is then told, truthfully, that Olumi drew the link itself and it
 * carries no effect value, and the option is excluded from ranking.
 *
 * ⭐ THE FIX IS UPSTREAM, AND IT IS THE ONLY PLACE THAT DOES NOT REQUIRE
 * OVERTURNING A RULING. Nothing below the draft seam may choose a factor. But
 * the DRAFTER choosing which factor an option IT INVENTED moves is a judgement
 * about that option — it made exactly that judgement for the three siblings in
 * the same response. Asking it again for the one it skipped loosens no
 * exclusion: the connectivity repair's union-of-everyone-else's-targets is not
 * a judgement about the option and stays excluded, byte for byte.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE DOES AND DOES NOT PRODUCE.
 *
 *   · IT PRODUCES A MAPPING (which factors), NEVER A MAGNITUDE (how much).
 *     The magnitude is the estimate batch's job and is already wired
 *     (`readiness-value-batch.ts` + `readiness-value-estimator.ts`): every
 *     value it proposes is stamped `cee_hypothesis`, shipped in ONE review
 *     card, and applied only on approval. Two judgements, two producers, two
 *     marks — collapsing them here would mint a second authority on a question
 *     that already has one.
 *   · THE EDGES IT WRITES ARE STAMPED `origin: "ai"` — the transform's own
 *     default for a drafter-authored edge (`transforms/schema-v3.ts:1152`,
 *     `origin: edge.origin ?? "ai"`) — and NEVER `"repair"`. This is not a
 *     loophole around the exclusion: `origin` is the estate's ONE discriminator
 *     between "the product wired this to keep the graph connected" and "the
 *     drafter judged that this option moves this factor"
 *     (`graph/repair-authored-edge.ts:5-16`), and these edges are the second
 *     thing.
 *   · DECLINING IS A FIRST-CLASS ANSWER. An option the model genuinely cannot
 *     place returns no factors, acquires no edges, and continues down exactly
 *     today's path: repair-wired, disclosed, excluded from ranking. The honest
 *     refusal is preserved for the cases that need it; what stops is refusing
 *     the class where Olumi demonstrably DOES know.
 *
 * ⚠ A FIXTURE YOU WROTE YOURSELF IS NOT EVIDENCE ABOUT THE WIRE (trap 16).
 * The unit tests here pin the PROMPT CONTRACT, the PARSE and the IDENTITY
 * FILTER. They make no claim about model behaviour; anything claiming that
 * needs a live call and must say so.
 */

import { z } from 'zod';
import { chatWithAnthropic } from '../../adapters/llm/anthropic.js';
import { OPTION_FACTOR_MAP_TIMEOUT_MS } from '../../config/timeouts.js';

/**
 * What the model is asked to return.
 *
 * ⚠ `.strict()` is deliberate, for the same reason the estimator gives: an
 * unrecognised key means the model answered a question we did not ask, and
 * dropping it silently hides a prompt/schema divergence.
 *
 * ⚠ THE REFINE IS THE HONESTY PIN. `factor_ids: []` with no `declined_reason`
 * is a blank, not a refusal. Requiring the reason structurally means a model
 * that cannot place an option has to SAY so, and the telemetry below can then
 * distinguish "the model refused" from "the model returned nothing".
 */
const MappingRow = z
  .object({
    option_id: z.string().min(1),
    factor_ids: z.array(z.string().min(1)),
    reasoning: z.string().min(1).optional(),
    declined_reason: z.string().min(1).optional(),
  })
  .strict()
  .refine((r) => r.factor_ids.length > 0 || typeof r.declined_reason === 'string', {
    message: 'declined_reason is required when factor_ids is empty',
    path: ['declined_reason'],
  });

const MappingResponse = z.object({ mappings: z.array(MappingRow) }).strict();

/** JSON Schema handed to Anthropic Structured Outputs. Mirrors `MappingResponse`. */
export const OPTION_FACTOR_MAP_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['mappings'],
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['option_id', 'factor_ids'],
        properties: {
          option_id: { type: 'string' },
          factor_ids: { type: 'array', items: { type: 'string' } },
          reasoning: { type: 'string' },
          declined_reason: { type: 'string' },
        },
      },
    },
  },
};

/** One option the drafter left unmapped. */
export interface OptionToMap {
  readonly option_id: string;
  readonly label: string | undefined;
}

/** One factor the option could be mapped onto, plus how its SIBLINGS use it. */
export interface MappableFactor {
  readonly factor_id: string;
  readonly label: string | undefined;
  /** Labels of the options that already target this factor. Context, never a target list. */
  readonly targeted_by: readonly string[];
}

export interface OptionFactorMapRequest {
  readonly options: readonly OptionToMap[];
  readonly factors: readonly MappableFactor[];
  /** The user's own framing of the decision, when the turn carries it. */
  readonly brief: string | undefined;
  readonly requestId?: string;
}

/**
 * The network boundary, INJECTED — and BOUND here, beside the prompt it uses.
 *
 * The injection point survives as a DEFAULT PARAMETER, so every test supplies
 * its own `call` and no unit test makes a paid request. Putting the binding
 * here rather than in the pipeline keeps the pipeline from choosing a
 * temperature and a token budget for a prompt it does not own — the exact
 * defect `tests/unit/ai-task-lifecycle-authority.test.ts` was written to catch.
 */
export type OptionFactorMapModelCall = (args: {
  system: string;
  userMessage: string;
  outputSchema: Record<string, unknown>;
  requestId?: string;
  timeoutMs: number;
}) => Promise<{ content: string }>;

/**
 * Budget for one mapping call. The output is a handful of ids, so it is small
 * by construction; 1024 leaves room for a `reasoning` sentence per option
 * without funding an essay.
 */
export const OPTION_FACTOR_MAP_MAX_TOKENS = 1024;
/** Low but non-zero: the model is judging, not transcribing. Mirrors the estimator. */
export const OPTION_FACTOR_MAP_TEMPERATURE = 0.1;

/**
 * The production binding: the shared Anthropic chat boundary.
 *
 * ⚠ THE MODEL IS NOT NAMED HERE, and that is a fact about this task rather than
 * an omission — the same posture `readiness_value_estimate` records. No explicit
 * model is passed, so `chatWithAnthropic` resolves `LLM_MODEL ->
 * FALLBACK_ANTHROPIC_MODEL`. If that names a non-Anthropic model the call fails
 * closed at the boundary and the caller degrades to TODAY'S behaviour — the
 * connectivity repair, the disclosure sentence, the honest refusal. Nothing the
 * user sees becomes wrong; a class of option simply stops being rescued.
 */
export const anthropicOptionFactorMapCall: OptionFactorMapModelCall = async ({
  system,
  userMessage,
  outputSchema,
  requestId,
  timeoutMs,
}) => {
  const res = await chatWithAnthropic({
    system,
    userMessage,
    temperature: OPTION_FACTOR_MAP_TEMPERATURE,
    maxTokens: OPTION_FACTOR_MAP_MAX_TOKENS,
    requestId,
    outputSchema,
    timeoutMs,
  });
  return { content: res.content };
};

/** One option's answer, already filtered to ids that exist in the graph. */
export interface OptionFactorMapping {
  readonly option_id: string;
  readonly factor_ids: readonly string[];
  readonly reasoning?: string;
  readonly declined_reason?: string;
}

export type OptionFactorMapOutcome =
  | { readonly status: 'ok'; readonly mappings: readonly OptionFactorMapping[] }
  | { readonly status: 'no_options' }
  | { readonly status: 'unparseable'; readonly detail: string }
  | { readonly status: 'off_contract'; readonly detail: string };

export const OPTION_FACTOR_MAP_SYSTEM_PROMPT = [
  'You are completing a causal decision model that has already been drafted.',
  '',
  'Every option in the model should say which factors it changes. One or more',
  'options were drafted without that mapping, while their siblings have it.',
  'For each option you are given, return the factor ids that OPTION ITSELF',
  'would change if it were chosen.',
  '',
  'Rules:',
  '- Choose ONLY from the factor ids listed. Never invent a factor or an option.',
  '- Answer ONLY the options given. Leave every other option alone.',
  '- Name the factors THIS option moves, not the ones its siblings move. Two',
  '  options in the same decision often move different factors, and copying a',
  '  sibling’s list is the specific error to avoid.',
  '- Most options move one to three factors. Listing every factor is not an',
  '  answer; it is a refusal to choose.',
  '- If you cannot say defensibly which factors this option changes, return an',
  '  EMPTY factor_ids array and say why in declined_reason. A refusal is a',
  '  correct answer and is preferred to a list you cannot justify.',
  '- Do NOT estimate how much each factor moves. You are being asked which,',
  '  not how much; the size is asked for separately and reviewed by the user.',
  '- reasoning: one short sentence giving the basis for the choice.',
].join('\n');

/** The user-content half. Exported so a test can assert what the model is told. */
export function buildOptionFactorMapUserContent(req: OptionFactorMapRequest): string {
  const lines: string[] = [];
  if (req.brief && req.brief.trim().length > 0) {
    lines.push('## The decision', req.brief.trim(), '');
  }
  lines.push('## Factors available');
  for (const f of req.factors) {
    const used =
      f.targeted_by.length > 0
        ? ` (already changed by: ${f.targeted_by.join(', ')})`
        : ' (not changed by any option yet)';
    lines.push(`- factor_id=${f.factor_id} "${f.label ?? f.factor_id}"${used}`);
  }
  lines.push('', '## Options needing a mapping');
  for (const o of req.options) {
    lines.push(`- option_id=${o.option_id} "${o.label ?? o.option_id}"`);
  }
  return lines.join('\n');
}

/**
 * Ask the model which factors each unmapped option moves.
 *
 * ⭐ THE RETURN IS FILTERED TO WHAT WAS ASKED, BY IDENTITY (trap 19). An option
 * we did not ask about is dropped; a factor id that is not in the offered set is
 * dropped. Letting either through would let a model typo mint an edge to a node
 * that does not exist, which the validator would then have to repair — turning a
 * producer defect into a user-visible draft failure.
 */
export async function mapOptionsToFactors(
  req: OptionFactorMapRequest,
  call: OptionFactorMapModelCall = anthropicOptionFactorMapCall,
  timeoutMs: number = OPTION_FACTOR_MAP_TIMEOUT_MS,
): Promise<OptionFactorMapOutcome> {
  if (req.options.length === 0) return { status: 'no_options' };

  const res = await call({
    system: OPTION_FACTOR_MAP_SYSTEM_PROMPT,
    userMessage: buildOptionFactorMapUserContent(req),
    outputSchema: OPTION_FACTOR_MAP_OUTPUT_SCHEMA,
    requestId: req.requestId,
    timeoutMs,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(res.content);
  } catch {
    return { status: 'unparseable', detail: res.content.slice(0, 200) };
  }

  const parsed = MappingResponse.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'off_contract',
      detail: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    };
  }

  const askedOptions = new Set(req.options.map((o) => o.option_id));
  const offeredFactors = new Set(req.factors.map((f) => f.factor_id));
  const seen = new Set<string>();
  const mappings: OptionFactorMapping[] = [];
  for (const row of parsed.data.mappings) {
    if (!askedOptions.has(row.option_id)) continue;
    if (seen.has(row.option_id)) continue;
    seen.add(row.option_id);
    const factorIds = [...new Set(row.factor_ids.filter((id) => offeredFactors.has(id)))];
    mappings.push({
      option_id: row.option_id,
      factor_ids: factorIds,
      ...(row.reasoning ? { reasoning: row.reasoning } : {}),
      ...(row.declined_reason ? { declined_reason: row.declined_reason } : {}),
    });
  }
  return { status: 'ok', mappings };
}
