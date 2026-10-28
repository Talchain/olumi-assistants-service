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
  'Draft ONE canonical model: their situation as a small influence diagram they could explain in a minute, with their aims, options, what drives the outcome, risks, uncertainty and any disagreement. The steps below apply only to a first draft.',
  'Its cards are the question, options, factors (quantities), aims (goals), risks and limits. Keep what materially helps them understand or challenge the situation; omit only what does not, or an unrepresentable mechanism or measure, saying why and what would enable it. Keep each label, basis and question short.',
  'Work silently in this order:',
  '1. Extract the question, stated aims, options, present state, targets, limits, deadlines, concerns and figures, preserving qualifiers, conditions, bounds and references without strengthening, narrowing or widening their meaning. Keep each with the words it came in and who said it: theirs, or the party they report. Their record keeps only reasoning and qualifications they stated. Any additional explanation, caveat or causal claim is Olumi\'s: put it on an Olumi record or leave it as an open question. Their uncertainty remains uncertainty, never evidence of absence. A tentative thought is never a commitment. Keep any option they explicitly raise with their actual qualifier in its words; do not promote an unframed reflection into an option of theirs.',
  '2. Aim: retain every stated aim, including avoiding a stated loss. Keep a target or date they state as theirs; it becomes the aim\'s measure only where the quantity, frame and meaning it measures are supported, and a date alone never becomes a measure of success or an invented outcome value. A stated horizon keeps its whole span, part periods included; ask the convention rather than shorten it. Suggest a measure only when it tracks that aim, with exclusions for what it misses. With no stated aim, offer ONE Olumi working aim supported by the brief for confirmation or change.',
  '3. Options: retain every named option, named shortly in their terms without changing or strengthening what it does, and carrying on as now (carry_on true; false on every other option). With none, one, only two opposites, or an open request, add one or two materially different options, lower-commitment where useful, each a concrete course with its own commitment or mechanism, as an Olumi option, never left in prose or only a variant of carrying on; for allocations, offer feasible divisions. Stay within stated budgets, exclusions and scope; never assume a constraint can move.',
  '4. Factors: the few things that matter most to the aims and options, about eight as a guide, including feasibility, supplied reasoning and uncertainty, each clear enough that someone with the facts could say what it is. A figure only where it is real: theirs, or Olumi\'s estimate with a range where an established mechanism supports one; otherwise unknown, or asked with its question. A factor keeps its unit when its value is unknown; a stated score or index whose meaning is dimensionless takes unit "1", while a missing physical or currency unit is asked, never assumed dimensionless, and no ordinal arithmetic is added; unit null only when no supported unit exists yet; never invent a unit, period or reference, turn a stated amount into an unsupported rate, or assume carry-on leaves a reference unchanged.',
  '5. Links: what each option changes and what each factor moves, as influence links from cause to effect, each with a direction, how sure it is and its basis in plain words. A link goes from an option, factor or risk to a factor, aim or limit. Link each live option to the aims or limits it plausibly affects; never add a link merely to connect. Follow supported or defensible provisional causal paths through to the aims or limits they affect; where no connection is supported, retain the gap and what would establish it rather than adding a link. Each decisive driver, capacity, baseline, loss or interaction goes into that structure as a linked factor (asked where unknown), never only in prose or as a factor linked to nothing; a missing figure withholds the calculation, not the mechanism. A loop is allowed where they describe feedback. Use a numerical relation where its figures are given or defensibly estimated, and keep that calculation even when other links are in words; figures alone never supply a missing response. Keep every genuine unsized influence or risk as its typed link or risk, even when it withholds the affected chance; preserve independently supported numerical calculations. A conditional assumption may narrow an explicitly stated scenario, never reclassify a consequential unknown solely to make a chance appear; an asked input holds its result until it is supplied; never guess a size to force one, or add a switch, a zero or an intermediate total only to make arithmetic run.',
  'Count a one-off payment once, through a total or stock start; model lasting assets through their capacity and ongoing activity through spending over a bounded window. Track cumulative spending against its limit with a stock. Ask missing durations wherever representable; otherwise explain the limitation.',
  '6. Risks: events that may or may not happen, never something already true, each on the factor, aim, limit or option it would hit, with its direction. A chance and a size only where theirs or defensibly estimated; otherwise null.',
  '7. Unknowns and questions: confirm an ambiguous or suggested aim, measure or reference; then select observable unknowns most able to change route feasibility or comparison through causal evidence, rival explanations, capacity, timing, permissions or commitments; a needed figure is arithmetic-only only if it cannot change that comparison. Put each missing input\'s question on its item; order item arrays and select coaching_questions by this priority, leading with the unknown that most separates the options or fixes the reference point, before peripheral detail. Ask for evidence, not invented effects or probabilities; never re-ask supplied information. Ask for a range when a supplied approximate point feeds a goal or limit.',
  '',
  'Example: "We sell 400 loaves a week from our one oven and have £5,000 to spend. Should we buy a second oven? It adds 150 loaves a week of capacity. We want to sell 500 loaves a week without going over budget, and to grow the bakery."',
  'Sketch (period week; author person with their quote unless marked):',
  '- base_sales 400 loaf/week fact known "sell 400 loaves a week"; extra_capacity 150 loaf/week fact known "adds 150 loaves a week of capacity"; budget 5000 GBP fact known "£5,000 to spend"; sales_target 500 loaf/week fact known "sell 500 loaves a week"',
  '- sales loaf/week fact unknown, olumi, basis "weekly sales once the choice has played out"',
  '- extra_demand loaf/week fact asked, olumi, question "How many more loaves a week do customers ask for that you cannot bake now?"; staff_cover, unit null, unknown, olumi, basis "whether staff can cover longer hours"',
  '- oven_price GBP fact asked, olumi, question "What would the second oven cost?"',
  '- goal sales >= sales_target, frame level, aggregation end, window null, "We want to sell 500 loaves a week"; grow_target loaf/week fact asked, olumi, question "How many more loaves a week would count as growing?"; goal "to grow the bakery", measure_by olumi (a suggested measure): sales change_abs from base_sales >= grow_target, end, window null, exclusions: left_out "growth beyond loaf sales, such as new lines", why "not in this model", author olumi, quote null',
  '- limit "without going over budget", measure null, question "Is the £5,000 for the oven alone, or for everything this choice needs?"; budget 5000 GBP is its figure, theirs',
  '- option "Second oven", quote "buy a second oven": sets []; option "Longer baking hours", olumi (lower-commitment): sets []; option "Carry on as now", olumi, carry_on true: sets []',
  '- links, olumi: Second oven → "without going over budget" unknown, unsure, basis "whether it fits depends on oven_price, still asked"; Second oven → sales up, likely, basis "150 loaves a week more capacity, sold only as far as demand allows"; extra_demand → sales up, likely, basis "extra loaves sell only if customers want them"; Longer baking hours → sales up, unsure, basis "more bakes from one oven"; staff_cover → sales up, unsure, basis "longer hours need staff to cover them"',
  '- risk "A supermarket bakery opens nearby", olumi: on extra_demand, direction down, chance null, size null',
].join('\n');

/** What the compiler's sentences are returned with, in the same conversation (phase 0b's repair turn, verbatim). */
export const REPAIR_PREFIX = 'The compiler found these errors. Return the whole model again with them fixed, keeping everything else as it was.';
/** What an update asks, after the person's words and the saved model, in the same conversation (simplify v1, A3: `draft.ts` proposePostimage). */
export const UPDATE_PREFIX = 'Update the model above for the change below, by the same rules: return only the records you change or add, with their ids, each in full and as it was but for the change; never return a record you did not change; list removals in remove (only the ids listed to remove). Keep supplied figures, units, periods, quotes and origin, including when simplifying; follow deliberate corrections, retractions or approved representation changes without losing their meaning or history. When asked to simplify, keep every figure, aim, limit, quote, link in words and risk they gave, each measure of an aim or limit of theirs, and every relation their figures size; fold only Olumi\'s own items that add nothing to understanding or challenge, and turn Olumi\'s unsized arithmetic scaffolding (switches, zeros or intermediate totals no real figure sizes) into links in words. Preserve supported numerical calculations and every consequential cause, condition, risk, uncertainty, disagreement and attribution, including Olumi\'s useful provisional reasoning; re-express rather than erase it. A size they ask for never outranks this: simplify as far as you can without losing any of it. Return coaching_questions only when this change makes the saved ones out of date. A new item gets a new id. Each answer goes on the item whose question it answers (a question about one option, on that option\'s item); words that settle a figure (yes, no, all, none) are that figure, quoting them, its basis saying how they were read. Never keep an answer unassigned and ask it again. "I don\'t know" is an answer too: the item stays open, its question changed to ask for what would size it. A goal or limit this change adds comes with the relations from the options to it, only where an option plausibly affects it; never added merely to connect. Size them as for a first draft, and return those relations too.';
/** An update's repair turn: every change again (each attempt is merged onto the saved model afresh), never the whole model. */
export const UPDATE_REPAIR_PREFIX = 'The compiler found these errors in the model with your changes. Return all your changes again with them fixed, by the same rules: only the records you change or add, each in full with its id, and the removals.';

/**
 * AN UPDATE'S OUTPUT (DL 24 Oct, DoD-G classes 12 and 4), derived from the canonical schema, never a second copy: in each
 * family only the records the update changes or adds, each in its family's own record schema; the question and the time
 * step null unless the change is to them; the ids it removes in remove; no history (the host's); no title (the first draft's,
 * kept as drafted). Olumi's coaching questions (Box 2, Paul Q1/Q2, 28 Oct): null keeps the saved list; the whole new list,
 * [] included, replaces it, only when this change makes it out of date. The host merges it onto the
 * saved model by id (`draft.ts` mergeUpdate). The families' "every ..." descriptions are a first draft's, so they are left off.
 */
export const CanonicalUpdate = CanonicalModel.omit({ history: true, title: true }).extend({
  question: CanonicalModel.shape.question.nullable().describe('Null unless the change is to the question: then the new question, in one plain sentence.'),
  period: CanonicalModel.shape.period.nullable().describe('Null unless the change is to the time step: then the new one.'),
  coaching_questions: CanonicalModel.shape.coaching_questions.nullable().describe('Null unless this change makes the saved questions out of date (one is answered, settled or no longer applies, or the model now raises a more important one): then the whole new list, by the first draft\'s rules (up to three).'),
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
