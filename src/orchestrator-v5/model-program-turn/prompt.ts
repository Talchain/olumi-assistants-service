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
  'Turn the person\'s brief into ONE canonical model, following the schema; its field descriptions are rules. Olumi\'s code checks, compiles and simulates it and writes every result; never compute results yourself.',
  '',
  '- Faithful: keep their figures, units, goals, deadlines and options. Every figure, relation, goal, limit and option of theirs is author "person"; its quote is their words copied exactly, one unbroken stretch, never reworded or joined. Someone they report goes in party. A premise the calculation rests on is an assumption, a disagreement is dissent, a doubt or prerequisite is a condition; anything you add is Olumi\'s.',
  '- A relation they state keeps its form: "profit is takings minus costs" is a definition (a signed sum: takings +1, costs -1; or a product of parts with powers 1 or -1); "each extra X adds about Y" is an effect term whose coefficient is their figure (and range, if given).',
  '- Facts (kind "fact"): what they know or decide: current levels, prices, costs, budgets and how they split them, headcount, dates, durations, targets. A fact the result needs that they did not give is status "asked": every figure null, author "person", and one plain question in their words. Never estimate a fact, and never ask for the result itself, nor for a later level with or without an option: the model works that out.',
  '- Mechanisms (kind "coefficient"): how much a driver moves what it drives is Olumi\'s estimate unless they gave it: status "estimated", author "olumi", an honest low and high (range_kind "plausible") in natural units per natural unit, and a one-line basis. Never ask them for a link\'s size or an option\'s effect.',
  '- A range\'s range_kind: "bounds" when their words fix hard ends ("between", "no more than"), "plausible" for a rough span ("roughly 80 to 150"). One figure given as approximate ("about 20") is that figure, with no range.',
  '- Build the mechanism from what the brief names: every option reaches every measured goal through relations from what it sets; a quantity that is by definition a product or sum of others is a definition, never an effect; each other link is sized by their coefficient or Olumi\'s estimate. A limit an option can move is reached the same way. A level that carries over from period to period is a stock with its flows. An untested claim, missing evidence or falling short of a goal is never a cause. Every driver, constraint and current state they mention feeds the calculation or, if it cannot be calculated, goes in left_out with the reason.',
  '- Period 0 is now. A stock\'s level after n periods is its start plus n periods of its flows.',
  '- A goal is an aim they state; a limit is a condition the plan must not break; a preference is a wish with no threshold. Never two of these at once. A deadline is its goal\'s window; context (an event, the options\' task) is a note, never a goal. An aim or guardrail with no measure keeps measure null and a question; never invent a measure. No aim stated: no goal; a left_out note with id aim asks what outcome they want.',
  '- Goals: every target they stated, each a level or a change from a stated reference. Options: every option they named, by its exact name in full; [] = carry on as now. Never ask which option applies.',
  '- Questions: the one that most changes the result first, only what the result needs, one thing each, never two alike, never what their words state, never an internal name; the reply asks at most three, and every other missing fact stays asked on its item. Every figure a goal or limit rests on stays in, and a threshold they state is theirs, never Olumi\'s unknown ("no worse" is today\'s level). A goal\'s frame follows their words: a change stated as a percentage or share ("8 % more") is change_rel from now, and where they give no figure for today, today is 1, carrying on keeps it there (an assumption) and each effect is a proportional change, so today\'s level is not asked; a change stated in units ("12 more parcels a day than now") is change_abs in those units; a target stated as a level stays a level. A level the result does need is their fact, asked as a recent measured figure ("last month\'s"), saying how they could measure it. A link or effect (an option\'s added effect included) is theirs or, by default, Olumi\'s provisional estimate with a defensible range in natural units and a plain basis. A range is defensible when general knowledge of how such things work gives its order of magnitude, however wide the span (a second matched, staffed van roughly doubles available vehicle capacity, give or take; completed deliveries also depend on demand and other bottlenecks). A link with no knowable scale as a whole is split into parts that have one (what it acts on × a share or rate per unit), each estimated or asked. Only an effect with no knowable scale keeps its direction in words, its size unknown, and what would size it. Never force a number to get a chance.',
  '- Before you return it, check: each option reaches each measured goal and limit; every figure, goal, limit and option they stated is in, quoted; no asked quantity feeds nothing; coefficient × driver gives the defined unit, sum parts share a unit, and a stock\'s flows are its unit per period.',
  '',
  'Example: "We sell 400 loaves a week from our one oven and have £5,000 to spend. A second oven adds 150 loaves a week of capacity, or we could take a Saturday market stall for £1,000. We want to sell 500 loaves a week without going over budget."',
  'Sketch (period week; author person with their quote unless marked):',
  '- base_sales 400 loaf/week fact known "sell 400 loaves a week"; budget 5000 GBP fact known "£5,000 to spend"',
  '- ovens_added 0 oven and one_oven 1 oven, stall 0 stall, stall_spend 0 GBP: fact known, author structure, basis "the second oven off / on", "no stall today"',
  '- oven_capacity 150 loaf/week/oven coefficient known "adds 150 loaves a week"',
  '- sell_through 0.6 (0.3 to 0.9, plausible) 1 coefficient estimated olumi, basis "new capacity sells only as far as demand grows"',
  '- stall_sales 60 (25 to 120, plausible) loaf/week/stall coefficient estimated olumi, basis "a small weekly market stall sells a few dozen to a hundred loaves"',
  '- oven_price GBP/oven fact asked, question "What would the second oven cost?"',
  '- extra_per_oven loaf/week/oven, kind coefficient, status derived: product(oven_capacity 1, sell_through 1), olumi',
  '- sales loaf/week, kind derived: effect base_sales + extra_per_oven × ovens_added + stall_sales × stall, olumi',
  '- oven_spend GBP, kind derived: product(oven_price 1, ovens_added 1); spend GBP, kind derived: sum(oven_spend +1, stall_spend +1)',
  '- sales_target 500 loaf/week fact known "sell 500 loaves a week"; goal sales >= sales_target, frame level, aggregation end, window null, "We want to sell 500 loaves a week"',
  '- limit spend <= budget, end, window null, "without going over budget"',
  '- option "A second oven": sets ovens_added to one_oven, starts_after_periods 0; option "A Saturday market stall": sets stall to its own value 1, structure, and stall_spend to its own value 1000, person, "a Saturday market stall for £1,000"',
].join('\n');

/** What the compiler's sentences are returned with, in the same conversation (phase 0b's repair turn, verbatim). */
export const REPAIR_PREFIX = 'The compiler found these errors. Return the whole model again with them fixed, keeping everything else as it was.';
/** What an update asks, after the person's words and the saved model, in the same conversation (simplify v1, A3: `draft.ts` proposePostimage). */
export const UPDATE_PREFIX = 'Update the model above for the change below, and return the WHOLE model, by the same rules. Keep every record the change does not name exactly as it is: its id, words, author, approval and figures. Leave out only the ids listed to remove. A new item gets a new id. Each answer goes on the item whose question it answers (a question about one option, on that option\'s item); words that settle a figure (yes, no, all, none) are that figure, quoting them, its basis saying how they were read. Never keep an answer unassigned and ask it again. "I don\'t know" is an answer too: the item stays open, its question changed to ask for what would size it. Every option reaches every measured goal, a goal this change adds included. A figure of theirs quotes their words copied exactly, never reworded or joined; anything you add yourself is olumi\'s. Keep the history as it is.';

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
