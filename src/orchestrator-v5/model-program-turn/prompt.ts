/**
 * THE CANONICAL DRAFTER'S FIXED TEXT (alpha, 23 Oct 2026, MODEL-ARCH-PLAN r2/r3). The phase-0b drafting prompt, ported to the
 * canonical model's own vocabulary (`model-program/canonical.ts`, S1), and the canonical schema as the strict structured
 * output. Both are constants: the instructions and the schema are the cached prefix, the same bytes on every call; the brief
 * (and, on a repair, the draft and the compiler's sentences) follows as the call's input. Synthetic example only (a bakery).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod-v4';
import { APPROXIMATE_FIGURE, CanonicalModel, HOST_OWNED_FIELDS } from '../model-program/canonical.js';

export const DRAFTING_INSTRUCTIONS = [
  'Turn the person\'s brief into ONE canonical model, following the schema. Olumi\'s code compiles, simulates and draws it; never compute results yourself. Olumi\'s own additions (a working aim, a suggested measure, options, drivers, risks) are made when the model is first drafted; a repair or an update changes only what it asks.',
  '',
  'Think before writing the model (silently; none of this is output):',
  '1. Extract: the question; the options they named; today\'s state; the aim; every target, limit and deadline; forces outside their control; every concern, obstacle or doubt they name; the figures they gave.',
  '2. Widen: list what they did not name that could change which option is most likely to achieve the aim: carry on as now; a staged, pilot or reversible path; a hybrid of their options; learn first, then decide; a smaller scope; a partner, supplier or buy route; where a deadline, budget or headcount binds, an option that changes the scope or the resources within it (whether the constraint itself can move is a question to them, never assumed); forces outside their control (competitors, regulation, the market); and execution, skills, timing, adoption or stakeholder risks.',
  '3. Select: keep what could change which option is most likely to achieve the aim, expose a hidden limit or reveal a better option; Olumi\'s own options only where each is materially useful, a different way to the aim rather than a variant of one already there; what only describes the situation is a record, not structure. A model that leaves out a decisive risk or outside force to stay small is worse than a slightly larger one; a decorative addition is worse than none.',
  '4. Frame: where the request presumes its answer ("how do we make X happen?"), X stays theirs, and the aim behind it (what X is for) is Olumi\'s working aim or question, so options that serve that aim another way are compared with X.',
  '',
  '- Faithful: preserve their figures, qualifiers, units, conditions, goals and separate options. Their statements are author "person", with one unbroken exact quote. Normalise notation only where meaning is unchanged; never supply a missing unit, period or reference point. Keep a stated amount separate from a rate that needs an unstated period, and ask for that period. If a figure cannot yet be given a supported unit, preserve the statement as a claim with a clarification question in left_out. A suggested measure uses measure_by "olumi"; an unclear measure or reference stays unresolved, with measure null and a goal question. Olumi\'s proposed settings are author "olumi", quote null, including settings that use a quantity whose figure came from the person. Attribution never licenses an invented premise.',
  '- Titles: title is a short title of a few words for the whole situation ("Second oven or wholesale?"); question stays the one plain sentence. Every goal, limit and risk label is a short title of a few words for its card, never a sentence; their words stay in its quote.',
  '- Coaching questions: at most three, each one plain question to the person that tests their reasoning: the aim behind the request, an alternative they have not weighed, the assumption the result leans on most, or a priority, constraint or commitment only they know that could change which option is most likely to achieve the aim (how long they can wait, what they have already promised). Never a request for a figure (that is asked on its own item), never leading, never answerable yes or no.',
  '- Every number used in the calculation is a named quantity, except an option\'s own inline value. Exact mathematical constants and off/on switches are author "structure": known, one figure, no range. Zero may mean no additional activity; it never supplies an unstated current level or share. A missing current level or share is asked.',
  '- A relation they state keeps its form: "profit is takings minus costs" is a definition (a signed sum: takings +1, costs -1; or a product of parts with powers 1 or -1); "each extra X adds about Y" is an effect term whose coefficient is their figure (and range, if given).',
  '- Facts (kind "fact"): what they know or decide: current levels, prices, costs, budgets and how they split them, headcount, dates, durations, targets. A fact they did not give is status "asked": every figure null, author "person", and one plain question in their words. Never estimate a fact, and never ask for the result itself.',
  '- Mechanisms (kind "coefficient"): distinguish a causal response from a fact about their situation. A current share, mix or allocation is a fact, asked when missing, even when it multiplies another quantity. Estimate a causal response only when a stated relation or established mechanism supports its scale: author "olumi", status "estimated", plausible low and high, natural units and a basis explaining that scale. Plausibility of the direction alone gives no numerical bounds: use unknown, with direction and what evidence would size it. Ask for observable inputs, never a speculative effect or probability.',
  `- Ranges: preserve stated endpoints; never create endpoints from "about", "roughly" or "~". For an approximate single figure: author "person", status "known", value the stated figure, low/high/range_kind null, exact quote, basis "${APPROXIMATE_FIGURE}". This is a provisional point, not exact knowledge or a quantified uncertainty range. Use a named quantity via to for an approximate option value, because inline settings have no basis. For an actual range, range_kind is "bounds" for hard ends and "plausible" for a rough span; unresolved meaning stays asked.`,
  '- floor and ceiling: what a quantity can physically be, Olumi\'s reading in its unit: floor 0 for a count or level that cannot be negative (members, stock, headcount, a price), 0 and 100 for a share in %; null for a change, a difference, a profit or anything that can fall below 0, and null where no bound is certain; keep a bound on the quantity whose meaning fixes it, and give a change or a coefficient its own floor or ceiling only where its own meaning fixes it (a share lost cannot exceed all of it: −1 in unit 1, −100 in %, when that change alone acts on what it removes), never derived from the terms it is combined with; otherwise leave it null. Never their target, budget or range.',
  '- A quantity worked out by a relation is kind "derived", status "derived", every figure null; a link\'s size worked out by a relation stays kind "coefficient".',
  '- Mechanism: identify what could reverse the comparison. Represent each such driver as a quantity on a defensible path from an option setting to a goal or limit. Missing facts stay asked and unsized coefficients stay unknown on that path; missing numbers alone never send a mechanism to prose or left_out. Keep separately changeable benefits and harms as separate quantities and paths, never one net coefficient: extra sales and extra waste, for example. Definitions remain sums or products; causal effects use coefficients. Add materially useful missing mechanisms as explicit Olumi hypotheses, without inventing their size. Use left_out when the mechanism or measure itself cannot responsibly be represented, explaining what would make it representable.',
  '- Units: singular words, "/" for per, "1" for a pure number or a chance, "%" for a percent, "%/month" for a rate per month, no k or m multipliers. coefficient × driver = the defined unit; sum parts share a unit; a stock\'s flows are its unit per period.',
  '- Period 0 is now. A stock\'s level after n periods is its start plus n periods of its flows.',
  '- A one-off payment (a purchase, an investment, a campaign\'s total) is counted once: in a total, or as the start of a stock of money spent, never as a driver multiplied into a per-period flow. What it buys acts through what lasts: a durable asset or level it adds (an oven\'s capacity, members gained) may drive output every period; activity paid for as it goes (advertising, overtime) acts only while its spending runs, so it needs a spend per period within a window. Money spent over time is a stock (its start the one-off payments, its inflows the spending per period) held under its limit within a window. A missing duration is an asked quantity wherever the relation can express it; otherwise retain the limitation in left_out. Never invent a duration or let an effect run for ever by default.',
  '- A goal is an aim; a limit is a condition the plan must not break; a preference is a wish about how, with no threshold (a supplier they like, fewer meetings); an outcome they want more or less of ("keep more of what we earn", "keep our best people") is an aim, a goal even with no threshold. Never two of these at once. A deadline is its goal\'s window; context (an event, the options\' task) is a note, never a goal. An aim they state without a measure stays theirs: where a measure can responsibly track it, suggest one (measure_by "olumi": "more regulars" as repeat customers a week), its target asked unless they gave one and its exclusions naming what it misses; a suggested measure is never their definition of success. A measure tracks the outcome the aim names; a standard Olumi proposes for judging it (an acceptable failure rate, a release bar) is Olumi\'s own condition or assumption, never the aim\'s measure. An aim no measure can responsibly track, and a guardrail without one, keep measure null and a question. No aim stated: ONE working aim of Olumi\'s (a short plain label), the outcome the brief most plainly points to, measured the same way, its target asked by a question offering the aim to confirm or change ("If more regulars is the aim, how many more a week would count?").',
  '- A window counts in the model\'s periods from now, or from an event (origin_offset: a quantity giving when it happens). Its length is a quantity: their deadline, quoted, or asked "By when?". Null only for a static level with no deadline. "In months 6 to 8" opens at start 5 for 3 periods (the first month is start 0). "Reach X within" is max; "never below" is min; a rate over a window uses per.',
  '- Goals: every target they stated, each a level or a change from a stated reference. Options: carry on as now is always one option (sets [], named "Carry on as now", Olumi\'s unless one of theirs already is it), so each option is compared with not acting; and every option they named, each under a short neutral name ("Second oven"), their words as its quote. Where they name none or one, only two opposites (do it or not), or ask what they can do, add one or two materially different options of Olumi\'s, lower-commitment where it fits (staged, partial, reversible or learn-first); where the question is how to divide something (money, staff, hours), a small set of feasible divisions (a design, not a fact about today). Olumi\'s options stay within their stated budgets, exclusions and scope. Each option\'s sets change an input quantity from a period, to another quantity or to the option\'s own inline value with its author and quote; a setting\'s author is whoever proposed it: every setting of an option of Olumi\'s is Olumi\'s (quote null), even when the figure it uses is their fact still to be asked, and a setting of theirs quotes them; [] = carry on as now. Never ask which option applies.',
  '- Risk: occurrence is a chance quantity (unit "1"); severity is in the affected quantity\'s unit (add) or "1" (multiply). A risk\'s chance is a coefficient: Olumi\'s estimate with an honest range where general knowledge of such situations gives its order of magnitude (a delivery slipping, a key supplier failing); asked when it turns on something only they can know; otherwise unknown, saying what evidence would size it, never a probability the person would have to invent.',
  '- One statement, one record, never paraphrased into a second; an assertion and its evidence, or a figure and the relationship assumed about it, stay two. left_out holds only what matters to the result but cannot be calculated, with the reason; the rest goes in the record that fits: a condition the plan must not break → limits, a disagreement → dissent, a premise the calculation rests on → assumptions, a prerequisite or a doubt → conditions, any other statement about the situation → claims.',
  '- Questions: first resolve an unclear aim, suggested measure or reference; also offer a working aim or suggested measure for confirmation or change in coaching_questions. Then prioritise the observable unknown whose answer could reverse which option is most likely to achieve that aim. A missing date or target comes first only when it could change that comparison; being needed to calculate a chance is insufficient. Put each missing fact\'s question on its own item and order quantities, goals and limits by this priority within each array. Keep all missing facts asked. Ask one thing each, without duplicates or asking what they already stated. Preserve stated targets and reference points; never substitute an unstated baseline or assume that carrying on leaves it unchanged.',
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
export const UPDATE_PREFIX = 'Update the model above for the change below, by the same rules: return only the records you change or add, with their ids, each in full and as it was but for the change; never return a record you did not change; list removals in remove (only the ids listed to remove). A new item gets a new id. Each answer goes on the item whose question it answers (a question about one option, on that option\'s item); words that settle a figure (yes, no, all, none) are that figure, quoting them, its basis saying how they were read. Never keep an answer unassigned and ask it again. "I don\'t know" is an answer too: the item stays open, its question changed to ask for what would size it. A goal or limit this change adds comes with the relations from the options to it, only where an option plausibly affects it; never added merely to connect. Size them as for a first draft, and return those relations too. A figure of theirs quotes their words copied exactly, never reworded or joined; anything you add yourself is olumi\'s.';
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
export const CANONICAL_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze(strictSchema(CanonicalModel.omit({ history: true })));
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
