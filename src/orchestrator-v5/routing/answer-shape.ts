/**
 * The structured answer shape for coach / converse turns (ROADMAP 1.132, F2)
 * — UNCONDITIONAL since the F1 flag deletion (no-dark-launches doctrine).
 *
 * Coach/converse answers were arriving as walls of prose. The routing tool
 * call must carry a structured `{ headline, bullets, detail }` shape; the
 * legacy `answer_text` channel is then DERIVED from the shape
 * (`deriveAnswerTextFromShape`) so every existing consumer of answer_text /
 * assistant_text keeps working unchanged, and the shape itself rides the
 * wire as the `_answer_shape` additive sidecar (route-v2 strip → validate →
 * re-attach, the same mechanic as `_reasoning` — the vendored
 * @talchain/schemas OlumiResponseSchema is `.strict()`, so a bare top-level
 * field would fail egress validation).
 *
 * This module owns the shape's Zod contract, the JSON-schema property
 * advertised to the model (flag-on only — see `buildOlumiActionTool` in
 * tool-schema.ts), and the deterministic answer_text derivation. The
 * enforcement wiring (require-on-coach/converse, forbid-on-execute/clarify,
 * REPAIR_ONCE flow) lives in tool-schema.ts's RawToolCallSchema.
 */

import { z } from 'zod';

export const ANSWER_SHAPE_MAX_BULLETS = 3;

/**
 * "Exactly one sentence" — pragmatic, decimal-safe check.
 *
 * An INTERNAL sentence boundary is a terminator run (`.` `!` `?`, optionally
 * followed by closing quotes/brackets) then whitespace then a capital
 * letter, digit or opening quote/bracket. Decimals ("2.5%") never match
 * (no whitespace after the dot); lowercase abbreviation continuations
 * ("e.g. lower") never match (no capital). A capitalised abbreviation
 * continuation ("Mr. Smith") IS a false positive — the cost is one
 * REPAIR_ONCE retry prompting the model to rephrase, never a dropped turn.
 * A trailing terminator is allowed but not required.
 */
const INTERNAL_SENTENCE_BOUNDARY = /[.!?]["')\]]*\s+["'([]?[A-Z0-9]/;

export function isSingleSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !INTERNAL_SENTENCE_BOUNDARY.test(trimmed);
}

/**
 * The authoritative Zod contract. `.strict()` like every other proposal
 * sub-schema: an unknown key inside answer_shape is a validation failure
 * that flows through REPAIR_ONCE, not a silent drop.
 */
export const AnswerShapeSchema = z
  .object({
    headline: z.string().superRefine((value, ctx) => {
      if (!value.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'headline must be a non-blank single sentence',
        });
        return;
      }
      if (!isSingleSentence(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'headline must be exactly one sentence — move every additional sentence into detail',
        });
      }
    }),
    bullets: z
      .array(
        z
          .string()
          .refine((b) => b.trim().length > 0, { message: 'bullets must be non-blank' }),
      )
      .max(ANSWER_SHAPE_MAX_BULLETS, {
        message: `bullets must contain at most ${ANSWER_SHAPE_MAX_BULLETS} items — fold extra points into detail`,
      }),
    detail: z.string().refine((d) => d.trim().length > 0, {
      message: 'detail must be non-blank — carry the full supporting explanation here',
    }),
  })
  .strict();

export type AnswerShape = z.infer<typeof AnswerShapeSchema>;

/**
 * Descriptive JSON-schema property advertised to the model on the
 * `olumi_action` tool (unconditionally, via `buildOlumiActionTool`).
 * Descriptive, not enforcing: the hard contract is
 * `AnswerShapeSchema` above, exactly like the rest of the tool schema
 * (tool-schema.ts header comment).
 */
export const ANSWER_SHAPE_TOOL_PROPERTY = {
  type: 'object',
  additionalProperties: false,
  description:
    'The structured form of your complete user-facing answer. REQUIRED ' +
    'when intent_class is "coach" or "converse"; forbidden when ' +
    'intent_class is "execute" or "clarify" (those carry their answer via ' +
    'action.explanation.answer_text or clarification.question). The user ' +
    'reads headline first, then bullets, then detail — put your whole ' +
    'answer in this shape, never in leading text before the tool call.',
  properties: {
    headline: {
      type: 'string',
      description:
        'Exactly ONE sentence: the single most important takeaway. ' +
        'Sentence case, British English.',
    },
    bullets: {
      type: 'array',
      items: { type: 'string' },
      maxItems: ANSWER_SHAPE_MAX_BULLETS,
      description:
        'At most 3 short supporting points (one line each). Use [] when ' +
        'the answer needs no itemised points.',
    },
    detail: {
      type: 'string',
      description:
        'The full supporting explanation — every remaining sentence of ' +
        'your answer. Reference specific values, factor labels and causal ' +
        'links from the context. Do not use mutation language.',
    },
  },
  required: ['headline', 'bullets', 'detail'],
} as const;

/**
 * Deterministically derive the legacy `answer_text` from a validated shape,
 * so no answer_text/assistant_text consumer breaks when the flag is on:
 *
 *   headline
 *
 *   • bullet 1
 *   • bullet 2
 *
 *   detail
 *
 * The bullets section is omitted entirely when `bullets` is empty. Parts
 * are trimmed; the result is non-blank by construction (AnswerShapeSchema
 * requires a non-blank headline and detail).
 */
export function deriveAnswerTextFromShape(shape: AnswerShape): string {
  const bulletLines = shape.bullets.map((b) => `• ${b.trim()}`).join('\n');
  return [shape.headline.trim(), bulletLines, shape.detail.trim()]
    .filter((part) => part.length > 0)
    .join('\n\n');
}
