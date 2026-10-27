/**
 * THE CANONICAL DRAFTER'S FIXED TEXT (alpha, 23 Oct 2026, MODEL-ARCH-PLAN r2/r3). The phase-0b drafting prompt, ported to the
 * canonical model's own vocabulary (`model-program/canonical.ts`, S1), and the canonical schema as the strict structured
 * output. Both are constants: the instructions and the schema are the cached prefix, the same bytes on every call; the brief
 * (and, on a repair, the draft and the compiler's sentences) follows as the call's input. Synthetic example only (a bakery).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod-v4';
import { CanonicalModel, HOST_OWNED_FIELDS } from '../model-program/canonical.js';

export const DRAFTING_INSTRUCTIONS = [
  'Draft ONE canonical model. The expansion steps below apply only to a first draft.',
  'Work silently in this order:',
  '1. Extract the question, stated aims, options, present state, targets, limits, deadlines, concerns and figures, preserving qualifiers, conditions and references without strengthening their meaning.',
  '2. Aim: retain every stated aim, including avoiding a stated loss. Suggest a measure only when it tracks that aim, with exclusions for what it misses. With no stated aim, offer ONE Olumi working aim supported by the brief for confirmation or change.',
  '3. Alternatives: retain every named option and carry on as now; with none, one, only two opposites, or an open request, add one or two materially different routes, lower-commitment where useful; for allocations, offer feasible divisions. Consider staged, hybrid, learn-first, smaller-scope, partner or buy routes and changes to scope or resources within stated budgets, exclusions and scope; never assume a constraint can move.',
  '4. Causal paths: for each consequential concern or plausible outside force, trace each affected option setting to a goal or limit, retaining separately changeable bottlenecks, delays, benefits and harms as distinct quantities and relations with missing facts asked and unsized coefficients unknown on the path; missing numbers alone never send a mechanism to prose or left_out; omit only an unrepresentable mechanism or measure, saying why and what would enable it.',
  '5. Quantities: encode supplied relations and figures; never invent a unit, period or reference, turn a stated amount into an unsupported rate, or assume carry-on leaves a reference unchanged. If no unit is supported, retain the statement and ask what would give it one.',
  'Count a one-off payment once, through a total or stock start; model lasting assets through their capacity and ongoing activity through spending over a bounded window. Track cumulative spending against its limit with a stock. Ask missing durations wherever representable; otherwise explain the limitation.',
  '6. Unknowns and questions: confirm an ambiguous or suggested aim, measure or reference; then select observable unknowns most able to change route feasibility or comparison through causal evidence, rival explanations, capacity, timing, permissions or commitments; a needed figure is arithmetic-only only if it cannot change that comparison. Put each missing input\'s question on its item; order item arrays and select coaching_questions by this priority. Ask for evidence, not invented effects or probabilities; never re-ask supplied information. Ask for a range when a supplied approximate point feeds a goal or limit.',
  '',
  'Example: "We sell 400 loaves a week from our one oven, with no advertising, and have £5,000 to spend. Should we buy a second oven? It adds 150 loaves a week of capacity. We want to sell 500 loaves a week without going over budget, and to grow the bakery."',
  'Sketch (period week; author person with their quote unless marked):',
  '- base_sales 400 loaf/week fact known "sell 400 loaves a week"; budget 5000 GBP fact known "£5,000 to spend"; ad_spend 0 GBP/week fact known "no advertising"',
  '- ovens_added 0 oven and one_oven 1 oven: fact known, author structure, basis "the second oven off / on"',
  '- oven_capacity 150 loaf/week/oven coefficient known "adds 150 loaves a week"',
  '- sell_through 0.6 (0.3 to 0.9, plausible) 1 coefficient estimated olumi, basis "new capacity sells only as far as demand grows"',
  '- sales_per_ad_pound 0.05 (0.02 to 0.1, plausible) loaf/GBP coefficient estimated olumi, basis "each £100 a week of small local ads adds roughly 2 to 10 sales a week"',
  '- oven_price GBP/oven fact asked, question "What would the second oven cost?"',
  '- extra_per_oven loaf/week/oven, kind coefficient, status derived: product(oven_capacity 1, sell_through 1), olumi',
  '- sales loaf/week, kind derived: effect base_sales + extra_per_oven × ovens_added + sales_per_ad_pound × ad_spend, olumi',
  '- oven_spend GBP, kind derived: product(oven_price 1, ovens_added 1); spent GBP, kind derived: stock, start oven_spend (the oven is paid once), inflows ad_spend (each week\'s ads), olumi',
  '- budget_weeks week fact asked, question "Over how many weeks does the £5,000 need to last?"',
  '- sales_target 500 loaf/week fact known "sell 500 loaves a week"; goal sales >= sales_target, frame level, aggregation end, window null, "We want to sell 500 loaves a week"',
  '- grow_target loaf/week fact asked, question "How many more loaves a week would count as growing?"; goal "to grow the bakery", measure_by olumi (a suggested measure): sales change_abs from now >= grow_target, end, window null, exclusions: left_out "growth beyond loaf sales, such as new lines", why "not in this model", author olumi, quote null',
  '- limit spent <= budget, max, window from now for budget_weeks, "without going over budget"',
  '- option "Second oven", quote "buy a second oven": sets ovens_added to one_oven, starts_after_periods 0; option "Weekly local ads", olumi (they named only one; reversible, lower-commitment): sets ad_spend to its own value 50, olumi; option "Carry on as now", olumi: sets []',
].join('\n');

/** What the compiler's sentences are returned with, in the same conversation (phase 0b's repair turn, verbatim). */
export const REPAIR_PREFIX = 'The compiler found these errors. Return the whole model again with them fixed, keeping everything else as it was.';
/** What an update asks, after the person's words and the saved model, in the same conversation (simplify v1, A3: `draft.ts` proposePostimage). */
export const UPDATE_PREFIX = 'Update the model above for the change below, by the same rules: return only the records you change or add, with their ids, each in full and as it was but for the change; never return a record you did not change; list removals in remove (only the ids listed to remove). A new item gets a new id. Each answer goes on the item whose question it answers (a question about one option, on that option\'s item); words that settle a figure (yes, no, all, none) are that figure, quoting them, its basis saying how they were read. Never keep an answer unassigned and ask it again. "I don\'t know" is an answer too: the item stays open, its question changed to ask for what would size it. A goal or limit this change adds comes with the relations from the options to it, only where an option plausibly affects it; never added merely to connect. Size them as for a first draft, and return those relations too.';
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
}).describe('Only the records this update changes or adds, each in full with its id, in its own family; [] for a family with none.');
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
