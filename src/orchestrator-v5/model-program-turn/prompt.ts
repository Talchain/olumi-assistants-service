/**
 * THE CANONICAL DRAFTER'S FIXED TEXT (alpha, 23 Oct 2026, MODEL-ARCH-PLAN r2/r3). The phase-0b drafting prompt, ported to the
 * canonical model's own vocabulary (`model-program/canonical.ts`, S1), and the canonical schema as the strict structured
 * output. Both are constants: the instructions and the schema are the cached prefix, the same bytes on every call; the brief
 * (and, on a repair, the draft and the compiler's sentences) follows as the call's input. Synthetic example only (a bakery).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod-v4';
import { CanonicalModel } from '../model-program/canonical.js';

export const DRAFTING_INSTRUCTIONS = [
  'Turn the person\'s brief into ONE canonical model, following the schema. Olumi\'s code compiles, simulates and draws it; never compute results yourself.',
  '',
  '- Faithful: keep their figures, units, goals, deadlines and options. Every figure, relation, goal, limit and option of theirs is author "person"; its quote is their words copied exactly, one unbroken stretch, never reworded or joined.',
  '- Every number is a named quantity, except an option\'s own inline value. An exact constant the form needs (0 or 1 to switch an option off or on, 12 month/year) is author "structure": known, one figure, no range.',
  '- A relation they state keeps its form: "profit is takings minus costs" is a definition (a signed sum: takings +1, costs -1; or a product of parts with powers 1 or -1); "each extra X adds about Y" is an effect term whose coefficient is their figure (and range, if given).',
  '- Facts (kind "fact"): what they know or decide: current levels, prices, costs, budgets and how they split them, headcount, dates, durations, targets. A fact they did not give is status "asked": every figure null, author "person", and one plain question in their words. Never estimate a fact, and never ask for the result itself.',
  '- Mechanisms (kind "coefficient"): how much a driver moves what it drives is Olumi\'s estimate unless they gave it: status "estimated", author "olumi", an honest low and high (range_kind "plausible") in natural units per natural unit, and a one-line basis. Never ask them for a link\'s size or an option\'s effect.',
  '- A range\'s range_kind: "bounds" when their words fix hard ends ("between", "no more than"), "plausible" for a rough span ("about", "roughly").',
  '- A quantity worked out by a relation is kind "derived", status "derived", every figure null; a link\'s size worked out by a relation stays kind "coefficient".',
  '- Build the mechanism from what the brief names: every option reaches every measured goal through relations from what it sets; a quantity that is by definition a product or sum of others is a definition, never an effect; each other link is sized by their coefficient or Olumi\'s estimate. Every driver, constraint and current state they mention feeds the calculation or, if it cannot be calculated, goes in left_out with the reason.',
  '- Units: singular words, "/" for per, "1" for a pure number or a chance, "%" for a percent, "%/month" for a rate per month, no k or m multipliers. coefficient × driver = the defined unit; sum parts share a unit; a stock\'s flows are its unit per period.',
  '- Period 0 is now. A stock\'s level after n periods is its start plus n periods of its flows.',
  '- A goal is an aim they state; a limit is a condition the plan must not break; a preference is a wish with no threshold. Never two of these at once. A deadline is its goal\'s window; context (an event, the options\' task) is a note, never a goal. An aim or guardrail with no measure keeps measure null and a question; never invent a measure. No aim stated: no goal; a left_out note with id aim asks what outcome they want.',
  '- A window counts in the model\'s periods from now, or from an event (origin_offset: a quantity giving when it happens). Its length is a quantity: their deadline, quoted, or asked "By when?". Null only for a static level with no deadline. "In months 6 to 8" opens at start 5 for 3 periods (the first month is start 0). "Reach X within" is max; "never below" is min; a rate over a window uses per.',
  '- Goals: every target they stated, each a level or a change from a stated reference. Options: every option they named, by its exact name in full; sets change an input quantity from a period, to another quantity or to the option\'s own inline value with its author and quote; [] = carry on as now. Never ask which option applies.',
  '- Risk: occurrence is a chance quantity (unit "1"); severity is in the affected quantity\'s unit (add) or "1" (multiply).',
  '- Important but uncalculable → left_out. A disagreement → dissent. A premise the calculation rests on → assumptions. history is [].',
  '- Questions: the one that most changes the result first, only what the result needs, one thing each, never two alike, never what their words state; the reply asks at most three, and every other missing fact stays asked on its item. Every figure a goal or limit rests on stays in: their fact (what they expect without the options included) is asked, with its question. A link or effect (an option\'s added effect included) is theirs or, by default, Olumi\'s provisional estimate with a defensible range in natural units and a plain basis; uncertainty alone is not a reason to withhold. If only its direction can be defended, keep that belief in words, leave its size unknown and say what would size it. Never force a number to get a chance.',
  '',
  'Example: "We sell 400 loaves a week from our one oven, with no advertising, and have £5,000 to spend. A second oven adds 150 loaves a week of capacity, or we could spend £1,000 on local ads. We want to sell 500 loaves a week without going over budget."',
  'Sketch (period week; author person with their quote unless marked):',
  '- base_sales 400 loaf/week fact known "sell 400 loaves a week"; budget 5000 GBP fact known "£5,000 to spend"; ad_spend 0 GBP fact known "no advertising"',
  '- ovens_added 0 oven and one_oven 1 oven: fact known, author structure, basis "the second oven off / on"',
  '- oven_capacity 150 loaf/week/oven coefficient known "adds 150 loaves a week"',
  '- sell_through 0.6 (0.3 to 0.9, plausible) 1 coefficient estimated olumi, basis "new capacity sells only as far as demand grows"',
  '- sales_per_ad_pound 0.05 (0.02 to 0.1, plausible) loaf/week/GBP coefficient estimated olumi, basis "small local ads add roughly 2 to 10 weekly sales per £100"',
  '- oven_price GBP/oven fact asked, question "What would the second oven cost?"',
  '- extra_per_oven loaf/week/oven, kind coefficient, status derived: product(oven_capacity 1, sell_through 1), olumi',
  '- sales loaf/week, kind derived: effect base_sales + extra_per_oven × ovens_added + sales_per_ad_pound × ad_spend, olumi',
  '- oven_spend GBP, kind derived: product(oven_price 1, ovens_added 1); spend GBP, kind derived: sum(oven_spend +1, ad_spend +1)',
  '- sales_target 500 loaf/week fact known "sell 500 loaves a week"; goal sales >= sales_target, frame level, aggregation end, window null, "We want to sell 500 loaves a week"',
  '- limit spend <= budget, end, window null, "without going over budget"',
  '- option "A second oven": sets ovens_added to one_oven, starts_after_periods 0; option "Local ads": sets ad_spend to its own value 1000, person, "£1,000 on local ads"',
].join('\n');

/** What the compiler's sentences are returned with, in the same conversation (phase 0b's repair turn, verbatim). */
export const REPAIR_PREFIX = 'The compiler found these errors. Return the whole model again with them fixed, keeping everything else as it was.';
/** What an update asks, after the person's words and the saved model, in the same conversation (simplify v1, A3: `draft.ts` proposePostimage). */
export const UPDATE_PREFIX = 'Update the model above for the change below, and return the WHOLE model, by the same rules. Keep every record, with its id, exactly as it is unless the change is to it. Leave out only the ids listed to remove. A new item gets a new id. Every option reaches every measured goal, a goal this change adds included. A figure of theirs quotes their words copied exactly, never reworded or joined; anything you add yourself is olumi\'s. Keep the history as it is.';

/**
 * The canonical schema as OpenAI's strict json_schema. `z.toJSONSchema` is the shape S1 checks for strict output
 * (`compile.test.ts`, closed objects, every key required, anyOf only); two keys are dropped at this boundary: `$schema`, and
 * the safe-integer bounds `.int()` adds (S1: "no number carries a bound"; the compiler checks bounds in sentences).
 */
function strictSchema(): Record<string, unknown> {
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (n === null || typeof n !== 'object') return n;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === '$schema') continue;
      if ((k === 'minimum' || k === 'maximum') && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER) continue;
      out[k] = walk(v);
    }
    return out;
  };
  return walk(z.toJSONSchema(CanonicalModel)) as Record<string, unknown>;
}
export const CANONICAL_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze(strictSchema());
export const CANONICAL_SCHEMA_NAME = 'canonical_model';
export const DRAFTING_PROMPT_SHA256 = createHash('sha256').update(DRAFTING_INSTRUCTIONS, 'utf8').digest('hex');
export const CANONICAL_SCHEMA_SHA256 = createHash('sha256').update(JSON.stringify(CANONICAL_JSON_SCHEMA), 'utf8').digest('hex');
