/**
 * THE CANONICAL DRAFTER'S FIXED TEXT (alpha, 23 Oct 2026, MODEL-ARCH-PLAN r2/r3). The phase-0b drafting prompt, ported to the
 * canonical model's own vocabulary (`model-program/canonical.ts`, S1), and the canonical schema as the strict structured
 * output. Both are constants: the instructions and the schema are the cached prefix, the same bytes on every call; the brief
 * (and, on a repair, the draft and the compiler's sentences) follows as the call's input. Synthetic example only (a class studio).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod-v4';
import { CanonicalModel, HOST_OWNED_FIELDS } from '../model-program/canonical.js';

export const DRAFTING_INSTRUCTIONS = [
  'Draft ONE small model of the person\'s situation, not its arithmetic. The size budget and expansion steps below apply only to a first draft.',
  'Work silently in this order:',
  '1. Extract the question, stated aims, options, present state, targets, limits, deadlines, concerns and figures, preserving qualifiers, conditions and references without strengthening their meaning.',
  '2. Aim: retain every stated aim, including avoiding a stated loss. Suggest a measure only when it tracks that aim, with exclusions for what it misses. With no stated aim, offer ONE Olumi working aim supported by the brief for confirmation or change.',
  '3. Size and alternatives: keep the model small enough for the person to explain and challenge: as a guide, about 3 options and 8 quantities, using figures they would recognise; this guides what Olumi adds and never limits what they supplied. Retain named options; include carry on as now where meaningful, and propose a materially different or lower-commitment route when useful within the budget and stated constraints. If their stated options or essential figures already exceed the budget, preserve them, disclose the excess and ask what to focus on; never silently discard their content or refuse to draft.',
  '4. Structure: connect each option to the goal through as few named links as faithfully express it, usually one or two; keep a longer path when their stated mechanism has more steps. Use direct option settings where they express the situation faithfully; keep a named mechanism only when it changes what the person could question or do. Retain supplied causal meaning and uncertainty; do not add links merely to connect. Avoid dispensable off/on switches, derived totals and stocks; keep only the minimal structure a stated mechanism, cumulative budget, entry or exit, or a valid calculation needs, without extra plumbing for the person to read. Preserve other stated mechanisms as attributed qualitative records rather than expand arithmetic scaffolding.',
  '5. Figures: encode supplied figures and relations without inventing a unit, period or reference, turning an amount into an unsupported rate, or assuming carry-on leaves a reference unchanged. Use an option\'s own inline setting rather than a separate quantity for the same exact figure. Ask for a missing duration only when a stated goal, limit or mechanism needs that window; do not build spending plumbing to generate questions.',
  '6. Risks: each distinct downside stated or clearly implied by the brief belongs in risks, not a condition labelled "risk". Keep a stated concern as the person\'s, and an inferred risk as Olumi\'s provisional addition. Unknown chance or size is legitimate: never invent numbers to make a risk calculable. In the current quantity-reference contract, use unknown coefficient records for unsized chance or harm, with null figures and a basis; do not hide the risk because it is unsized. A fact already true stays context; the possible future harm is the risk.',
  '7. Questions: confirm an ambiguous or suggested aim, measure or reference; then ask about the unknown most likely to change the reasoning. Put a needed input\'s question on its item and select at most three coaching_questions. Ask for evidence, never invented effects or probabilities; never re-ask supplied information. Ask for a range when a supplied approximate point feeds a goal or limit.',
  '',
  'Example: "We run 6 classes a week and can carry on at 6. We want at least 8. Either add our own Saturday session or use a partner; either route would bring us to 8. Illness might cancel classes."',
  'Small sketch (period week; person with their quote unless marked):',
  '- classes 6 class/week fact known "run 6 classes a week"; target 8 class/week fact known "at least 8"; goal classes >= target, level, end, window null.',
  '- option "Own Saturday session" sets classes to inline 8; option "Partner" sets classes to inline 8, both supported by "either route would bring us to 8"; option "Carry on" sets [], supported by "can carry on at 6". Each setting reaches the measured goal directly; no switch or derived total.',
  '- risk "Illness cancels classes", person "Illness might cancel classes", effect_on classes; chance and harm unknown, no numbers invented. Under the current contract only: two unknown coefficient quantities (chance in 1; harm in class/week, lowers), mode add; Olumi\'s harm reading has its own attribution. No condition claims to be this risk.',
  '- Four quantities, three options, one risk. When asked to simplify, keep the supported options-to-goal reasoning and the risk, re-expressed more simply, unless they correct or retract it.',
].join('\n');

/** What the compiler's sentences are returned with, in the same conversation (phase 0b's repair turn, verbatim). */
export const REPAIR_PREFIX = 'The compiler found these errors. Return the whole model again with them fixed, keeping everything else as it was.';
/** What an update asks, after the person's words and the saved model, in the same conversation (simplify v1, A3: `draft.ts` proposePostimage). */
export const UPDATE_PREFIX = 'Update the model above for the change below, by the same rules: return only the records you change or add, with their ids, each in full and as it was but for the change; never return a record you did not change; list removals in remove (only the ids listed to remove). Keep supplied figures, units, periods, quotes and origin, including when simplifying; follow deliberate corrections, retractions or approved representation changes without losing their meaning or history. A new item gets a new id. Each answer goes on the item whose question it answers (a question about one option, on that option\'s item); words that settle a figure (yes, no, all, none) are that figure, quoting them, its basis saying how they were read. Never keep an answer unassigned and ask it again. "I don\'t know" is an answer too: the item stays open, its question changed to ask for what would size it. A goal or limit this change adds comes with the relations from the options to it, only where an option plausibly affects it; never added merely to connect. Size them as for a first draft, and return those relations too.';
/** An update's repair turn: every change again (each attempt is merged onto the saved model afresh), never the whole model. */
export const UPDATE_REPAIR_PREFIX = 'The compiler found these errors in the model with your changes. Return all your changes again with them fixed, by the same rules: only the records you change or add, each in full with its id, and the removals.';

/**
 * AN UPDATE'S OUTPUT (DL 24 Oct, DoD-G classes 12 and 4), derived from the canonical schema, never a second copy: in each
 * family only the records the update changes or adds, each in its family's own record schema; the question and the time
 * step null unless the change is to them; the ids it removes in remove; no history (the host's); no title or coaching questions
 * (the first draft's, kept as drafted). The host merges it onto the
 * saved model by id (`draft.ts` mergeUpdate). The families' "every ..." descriptions are a first draft's, so they are left off.
 */
export const CanonicalUpdate = CanonicalModel.omit({ history: true, title: true, coaching_questions: true }).extend({
  question: CanonicalModel.shape.question.nullable().describe('Null unless the change is to the question: then the new question, in one plain sentence.'),
  period: CanonicalModel.shape.period.nullable().describe('Null unless the change is to the time step: then the new one.'),
  goals: z.array(CanonicalModel.shape.goals.element),
  limits: z.array(CanonicalModel.shape.limits.element),
  preferences: z.array(CanonicalModel.shape.preferences.element),
  options: z.array(CanonicalModel.shape.options.element),
  remove: z.array(z.string()).describe('The ids of the records this update removes: only the ids listed to remove; [] for none.'),
}).describe(`Only the records this update changes or adds, each in full with its id, in its own family; [] for a family with none. ${CanonicalModel.description ?? ''}`);
export type CanonicalUpdateT = z.infer<typeof CanonicalUpdate>;

/**
 * The canonical schema as OpenAI's strict json_schema. `z.toJSONSchema` is the shape S1 checks for strict output
 * (`compile.test.ts`, closed objects, every key required, anyOf only); dropped at this boundary: `$schema`, the safe-integer
 * bounds `.int()` adds (S1: "no number carries a bound"; the compiler checks bounds in sentences), and the host's own fields
 * (`HOST_OWNED_FIELDS`, from every object's properties and required), which the drafter never writes (Paul 26 Oct).
 */
function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const host: ReadonlySet<string> = new Set(HOST_OWNED_FIELDS);
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (n === null || typeof n !== 'object') return n;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === '$schema') continue;
      if ((k === 'minimum' || k === 'maximum') && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER) continue;
      if (k === 'properties' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([p]) => !host.has(p)).map(([p, s]) => [p, walk(s)]));
      } else if (k === 'required' && Array.isArray(v)) {
        out[k] = v.filter((p) => !host.has(String(p)));
      } else out[k] = walk(v);
    }
    return out;
  };
  return walk(z.toJSONSchema(schema)) as Record<string, unknown>;
}
/** The first draft's strict output: the canonical model without its history (the host's: none yet, `draft.ts` withHostFields). */
export const CANONICAL_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze(strictSchema(CanonicalModel.omit({ history: true }).describe(CanonicalModel.description ?? '')));
/** The update's strict output: the same records, by the same walk. */
export const UPDATE_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze(strictSchema(CanonicalUpdate));
export const CANONICAL_SCHEMA_NAME = 'canonical_model';
/**
 * Today's date for the drafter, after the fixed instructions: a date they state is counted from it (refusals #2, #8, #9, #13, #15,
 * #16 of 25 Oct). An update on a later day than the first draft also names the model's period 0, that draft's day (the saved
 * `drafted_on`), so a date read now counts from the same day as every date already in the model, never from a second
 * period 0 (words#5). A first draft, and an update on the day it was drafted, send exactly the line they always did.
 */
export const todayLine = (today: string, periodZero: string = today): string => (periodZero === today
  ? `Today is ${today} (Europe/London). A date they state counts in whole periods from today, which is period 0.`
  : `Today is ${today} (Europe/London). This model's period 0 is ${periodZero}, the day it was first drafted: a date they state, and anything they time from today, counts in whole periods from ${periodZero}.`);
export const DRAFTING_PROMPT_SHA256 = createHash('sha256').update(DRAFTING_INSTRUCTIONS, 'utf8').digest('hex');
export const CANONICAL_SCHEMA_SHA256 = createHash('sha256').update(JSON.stringify(CANONICAL_JSON_SCHEMA), 'utf8').digest('hex');
