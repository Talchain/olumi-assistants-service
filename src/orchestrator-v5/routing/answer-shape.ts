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
 *
 * ── ANSWER-ONLY (2026-09-01) ──────────────────────────────────────────────
 * `bullets` and `detail` are OPTIONAL. They were not, and that made a concise
 * direct answer IMPOSSIBLE TO EMIT: a model that correctly answered a factual
 * lookup in one sentence failed validation on the non-blank `detail` refine
 * and was sent back through REPAIR_ONCE to pad the reply. Every converse turn
 * was therefore shaped into headline-plus-explanation whether or not the
 * question wanted it — a mechanical cause of the product feeling like
 * operating machinery rather than talking to a reasoning partner.
 *
 * It also contradicted the SERVED routing prompt's own SHARP SHAPE rule
 * (v121, hash bec840a648800928, line 32: "Lookups and state queries: 1 to 3
 * sentences"). The prompt already granted concision; this schema revoked it.
 *
 * What did NOT relax, because it is the actual guarantee: `headline` is still
 * REQUIRED, still non-blank, and still exactly one sentence. So a valid shape
 * always yields non-blank user-facing text, and "answer-only" can never
 * become a wall-of-prose channel. See `classifyAnswerShape` for the two named
 * outcomes, and `answer-shape-answer-only.test.ts` for the twin-direction
 * proof (concise becomes legal AND coaching still arrives).
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
// The boundary is assembled from three fragments so the "detect" regex
// (INTERNAL_SENTENCE_BOUNDARY) and the "split" regex (SENTENCE_SPLIT, below)
// derive from a SINGLE source and cannot drift apart (CLAUDE.md "derive,
// don't mirror"). A terminator run (`.` `!` `?` + closing quotes/brackets),
// then whitespace, then the start of the next sentence (capital/digit,
// optionally after an opening quote/bracket).
const SENTENCE_TERMINATOR = `[.!?]["')\\]]*`;
const SENTENCE_GAP = `\\s+`;
const SENTENCE_NEXT_START = `["'([]?[A-Z0-9]`;
const INTERNAL_SENTENCE_BOUNDARY = new RegExp(
  `${SENTENCE_TERMINATOR}${SENTENCE_GAP}${SENTENCE_NEXT_START}`,
);

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
    // OPTIONAL since the answer-only lane (2026-09-01). `.default([])` keeps
    // the OUTPUT type `string[]`, so every existing consumer of a parsed
    // shape (`shape.bullets.map(...)`) is untouched — only the INPUT relaxes.
    bullets: z
      .array(
        z
          .string()
          .refine((b) => b.trim().length > 0, { message: 'bullets must be non-blank' }),
      )
      .max(ANSWER_SHAPE_MAX_BULLETS, {
        message: `bullets must contain at most ${ANSWER_SHAPE_MAX_BULLETS} items — fold extra points into detail`,
      })
      .default([]),
    // OPTIONAL since the answer-only lane (2026-09-01) — this was THE
    // constraint that made a concise direct answer impossible to emit. Same
    // `.default('')` mechanic: output stays `string`, input relaxes.
    detail: z.string().default(''),
  })
  .strict();

export type AnswerShape = z.infer<typeof AnswerShapeSchema>;

/**
 * The two legitimate answer outcomes, DERIVED from the shape's own content.
 *
 * - `answer_only` — the complete answer is the headline. One sentence, no
 *   bullets, no detail: the user asked something simple and gets a simple
 *   reply, with no manufactured structure around it.
 * - `coached`     — the headline is accompanied by supporting bullets and/or
 *   a fuller explanation: a genuine reasoning intervention.
 *
 * ⚠ This is DERIVED, never model-authored, and that is deliberate. A `kind`
 * field the model filled in could claim `answer_only` beside a 400-word
 * detail — two authorities answering one question, which is the defect class
 * CLAUDE.md trap 21 exists to prevent. Deriving it from the content means it
 * cannot disagree with the content (rule 12 — derive, don't mirror).
 */
export type AnswerShapeKind = 'answer_only' | 'coached';

export function classifyAnswerShape(shape: AnswerShape): AnswerShapeKind {
  const hasBullets = shape.bullets.length > 0;
  const hasDetail = shape.detail.trim().length > 0;
  return hasBullets || hasDetail ? 'coached' : 'answer_only';
}

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
    'answer in this shape, never in leading text before the tool call. ' +
    'TWO SHAPES ARE VALID, and choosing between them is your judgement: ' +
    'ANSWER-ONLY — send headline ALONE, omitting bullets and detail, when ' +
    'the honest complete answer is one sentence (a factual lookup, a state ' +
    'query, a confirmation, a simple yes/no). Do NOT add bullets or detail ' +
    'to reach a shape; padding a simple answer with structure the user did ' +
    'not ask for makes the product worse. COACHED — add bullets and/or ' +
    'detail when the turn genuinely warrants a reasoning intervention ' +
    '(explaining results, challenging a choice, surfacing risk, handling ' +
    'contradiction). When it does, do NOT thin it out: the coaching is the ' +
    'value.',
  properties: {
    headline: {
      type: 'string',
      description:
        'Exactly ONE sentence: the single most important takeaway. ' +
        'Sentence case, British English. On an ANSWER-ONLY turn this is ' +
        'the entire answer, so make it complete on its own.',
    },
    bullets: {
      type: 'array',
      items: { type: 'string' },
      maxItems: ANSWER_SHAPE_MAX_BULLETS,
      description:
        'At most 3 short supporting points (one line each). OMIT this ' +
        'field entirely on an ANSWER-ONLY turn — never send a bullet that ' +
        'only restates the headline.',
    },
    detail: {
      type: 'string',
      description:
        'The full supporting explanation — every remaining sentence of ' +
        'your answer. Reference specific values, factor labels and causal ' +
        'links from the context. Do not use mutation language. OMIT this ' +
        'field entirely when the headline is already the complete answer.',
    },
  },
  // ONLY headline is required. bullets/detail are the COACHED half of the
  // shape and are omitted outright on an answer-only turn.
  required: ['headline'],
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
 * The bullets section is omitted entirely when `bullets` is empty, and so is
 * the detail section when `detail` is blank — so an ANSWER-ONLY shape derives
 * to exactly its headline, with no trailing whitespace. Parts are trimmed;
 * the result is still non-blank by construction, because `headline` remains
 * required and non-blank (that guarantee did NOT move with the answer-only
 * relaxation, and `answer-shape-answer-only.test.ts` pins it).
 */
export function deriveAnswerTextFromShape(shape: AnswerShape): string {
  const bulletLines = shape.bullets.map((b) => `• ${b.trim()}`).join('\n');
  return [shape.headline.trim(), bulletLines, shape.detail.trim()]
    .filter((part) => part.length > 0)
    .join('\n\n');
}

/**
 * Split `text` at its FIRST internal sentence boundary. Derives from the same
 * three fragments as `INTERNAL_SENTENCE_BOUNDARY` (lookahead on the
 * next-sentence start so it is NOT consumed), so the split point is exactly
 * where `isSingleSentence` says a boundary exists — the two can never drift.
 *
 *   - Returns `null` when there is no internal boundary (the whole `text` is
 *     one sentence — nothing to split).
 *   - Otherwise `headline` is `text` up to and including the first
 *     terminator run (guaranteed single-sentence by construction, since it
 *     contains no earlier boundary), and `remainder` is everything after the
 *     inter-sentence whitespace.
 */
function splitFirstSentence(text: string): { headline: string; remainder: string } | null {
  const split = new RegExp(`(${SENTENCE_TERMINATOR})(${SENTENCE_GAP})(?=${SENTENCE_NEXT_START})`);
  const match = split.exec(text);
  if (match === null || match.index === undefined) return null;
  const headlineEnd = match.index + match[1].length;
  const remainderStart = headlineEnd + match[2].length;
  return { headline: text.slice(0, headlineEnd), remainder: text.slice(remainderStart) };
}

const SYNTH_BULLET_LINE = /^\s*[•\-*]\s+(\S.*)$/;

/**
 * A bullet belongs to the SECTION HEADING immediately above it, and hoisting
 * it away from that heading strands the heading with nothing under it.
 *
 * Measured on the 2026-08-17 live reply corpus + the 2026-09-05 founder
 * journey (809 replies): **146 of 146** replies carrying an `Options compared`
 * heading derived to an output where that heading was followed by nothing, and
 * the deployed founder journey shows the same defect on the advice gate's
 * `What to check next` (turns 3 and 10, reproduced byte-exact). The heading is
 * emitted correctly — `post-analysis-advice-gate.ts` puts the bullet directly
 * beneath it — so the strand is introduced HERE, by lifting the bullet into
 * `bullets` while the heading stays behind in `detail`, after which
 * `deriveAnswerTextFromShape` re-renders `[headline, bullets, detail]` and the
 * bullet lands ABOVE its own heading.
 *
 * A line introduces the bullets beneath it when EITHER:
 *
 *   - it ends with a colon — it explicitly promises what follows
 *     (`…three sensible ways to define it against your £150,000 budget:`, and
 *     `post-analysis-advice-gate.ts`'s evidence-priority line, both of which
 *     strand their colon today); or
 *   - it is short and carries NO sentence-terminating punctuation — a label
 *     rather than a sentence (`What to check next`, `Options compared`).
 *
 * A full sentence followed by bullets ("Here is the answer. …" + list) is the
 * ordinary lead-in-then-list shape and is deliberately NOT matched, so those
 * bullets keep being hoisted exactly as before. The predicate is deliberately
 * two narrow limbs rather than a general "is this a heading?" judgement over
 * natural language — that question does not have a stable answer, and each
 * extra limb here buys a measured case or it does not ship.
 *
 * Scope of the behaviour change, MEASURED rather than asserted: across the
 * 809-reply corpus exactly 148 replies change, and every one of them is a
 * reply whose heading or colon is stranded TODAY. No reply outside the
 * stranded class changes shape, and no reply gains or loses a shape (zero
 * null-flips). `answer-shape-heading-bullet-adjacency.test.ts` pins both
 * directions, including the negative case.
 */
const SECTION_HEADING_MAX_LENGTH = 60;

function isSectionHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.endsWith(':')) return true;
  if (trimmed.length > SECTION_HEADING_MAX_LENGTH) return false;
  return !/[.!?]$/.test(trimmed);
}

/**
 * Deterministically SYNTHESISE an answer shape from a plain-prose
 * `assistant_text` that arrived with NO model-authored shape (the intent-null
 * / text_only prose path, and any deterministic-recovery copy). This is the
 * F1 progressive-disclosure fallback: a concise headline + optional bullets,
 * with everything else behind `detail`.
 *
 * Rules (deterministic, no LLM):
 *   - bullets  = lines already bullet-formatted (leading `•`, `-`, `*`), in
 *     order, capped at `ANSWER_SHAPE_MAX_BULLETS`;
 *   - headline = the FIRST sentence of the remaining (non-bullet) prose;
 *   - detail   = the rest of that prose, plus any bullet lines BEYOND the cap
 *     folded in verbatim so no content is ever dropped.
 *
 * Returns `null` — synthesise NOTHING, leave the prose un-shaped — when the
 * prose is a single sentence with no splittable remainder (a terse
 * clarify/receipt one-liner is already a concise headline; there is nothing
 * to disclose), or when there is no trailing prose to put behind the toggle
 * (e.g. a headline-plus-bullets with nothing after it).
 *
 * ⚠ WHY THIS PATH STAYS CONSERVATIVE AFTER THE ANSWER-ONLY RELAXATION. The
 * schema now accepts a blank `detail` (module header), but this is the
 * DETERMINISTIC-RECOVERY path, where no model judged whether the turn wanted
 * structure. Shipping the prose unchanged is the honest fallback;
 * synthesising a "Show more" toggle with nothing behind it is not. The
 * COUPLING block of `answer-shape-answer-only.test.ts` pins that, and it
 * bites: a mutant that lets a single-sentence prose synthesise into a
 * headline-only shape REDs two of its cases.
 *
 * ⚠ BE PRECISE ABOUT WHICH LINE ENFORCES IT — the `!detail` limb below does
 * NOT. Measured 2026-09-01 with a differential probe (23 inputs, 13 of which
 * reach the guard, positive control firing): `!detail` and `!headline` are
 * BOTH UNREACHABLE, and removing the `!detail` limb is a demonstrated
 * EQUIVALENT MUTANT. `splitFirstSentence` returns non-null only when its
 * regex matched with a LOOKAHEAD at `["'([]?[A-Z0-9]`, so the remainder
 * always begins with that non-whitespace character and can never trim to
 * empty; the headline always contains the terminator run. The real floor is
 * `split === null` — no internal sentence boundary. The `!detail` check is
 * belt-and-braces against a future change to `splitFirstSentence`, and is
 * documented as such rather than left to read as the load-bearing guard.
 *
 * The caller is responsible for preserving the byte-equality invariant by
 * SETTING `assistant_text := deriveAnswerTextFromShape(result)` — see the
 * route-v2 egress fallback.
 */
export function synthesiseAnswerShapeFromText(text: string): AnswerShape | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. Extract already-bulleted lines FIRST (in order, cap at 3) so the
  //    sentence split below sees only the prose. A bullet line BEYOND the cap
  //    is kept VERBATIM (glyph and all) and folded into `detail`, never
  //    dropped and never allowed to pollute the headline.
  const bullets: string[] = [];
  const proseLines: string[] = [];
  const overflowBulletLines: string[] = [];
  // A bullet that sits under a SECTION HEADING stays with its heading — see
  // `isSectionHeadingLine`. The flag is updated only by non-blank, non-bullet
  // lines, so a blank line between the heading and its bullets does not break
  // the association, and every consecutive bullet in the section is kept.
  let inHeadingSection = false;
  for (const line of trimmed.split('\n')) {
    const m = SYNTH_BULLET_LINE.exec(line);
    if (m === null) {
      proseLines.push(line);
      if (line.trim().length > 0) inHeadingSection = isSectionHeadingLine(line);
      continue;
    }
    if (inHeadingSection) {
      proseLines.push(line);
    } else if (bullets.length < ANSWER_SHAPE_MAX_BULLETS) {
      bullets.push(m[1].trim());
    } else {
      overflowBulletLines.push(line);
    }
  }
  const proseText = proseLines.join('\n').trim();
  if (!proseText) return null;

  // 2. Split the prose into headline (first sentence) + detail (remainder).
  //    A single-sentence prose has no splittable remainder — there is nothing
  //    to disclose beyond the headline, so synthesise NOTHING.
  const split = splitFirstSentence(proseText);
  if (split === null) return null;
  const headline = split.headline.trim();
  const detail = [split.remainder.trim(), overflowBulletLines.join('\n').trim()]
    .filter((part) => part.length > 0)
    .join('\n\n');
  // BELT-AND-BRACES, NOT THE LOAD-BEARING FLOOR — see the jsdoc above. Both
  // limbs are unreachable given splitFirstSentence's lookahead contract
  // (demonstrated 2026-09-01, not assumed), so removing this line is an
  // equivalent mutant. It stays as a fail-closed guard should that contract
  // ever change; the floor that actually fires is `split === null`.
  if (!headline || !detail) return null;

  const parsed = AnswerShapeSchema.safeParse({ headline, bullets, detail });
  return parsed.success ? parsed.data : null;
}
