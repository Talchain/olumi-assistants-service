/**
 * THE CANONICAL REASONING MODEL (spike S1, 23 Oct 2026; MODEL-ARCH-PLAN r2 with the PL's five corrections).
 *
 * The AI writes the person's situation as this ONE typed model, in one strict structured output. It is the full reasoning
 * model, not equations alone (PL correction 1): quantities and their canonical relations, goals, limits, options and risks,
 * AND the qualitative records (claims, evidence, assumptions, dissent, conditions, left out) as first-class items that name
 * what they concern. Code then only compiles it (`compile.ts` → `executable.ts`), simulates it (`simulate/`) and draws it
 * (`project.ts`). The display shows every record; the calculation is the compiled subset.
 *
 * Rules the schema states and `compile.ts` enforces:
 *  · every number is a NAMED quantity with a unit, an author and a status; no bare literals;
 *  · a person's figure carries their verbatim quote; a quote not found in their words makes it UNVERIFIED, a typed outcome
 *    that is never shown as theirs. An Olumi figure always has low AND high (its only exceptions: an exact calendar
 *    conversion such as 12 month/year, and its reading of a stated date as a window's whole number of periods);
 *  · a goal is what the person is trying to achieve; a limit is a condition the plan must not break; never both;
 *  · a window's length and its origin's timing are quantities, so every ask's answer fills exactly one quantity;
 *  · a figure only the person can give and did not is `asked` (null + a question), never estimated. Asking is a legitimate,
 *    successful outcome: it withholds only the goals that figure feeds;
 *  · relations are canonical forms only: a definition (sum, difference, product, ratio), an effect (base + Σ coefficient ×
 *    driver, each coefficient a quantity in natural units per natural unit) or a stock (start, inflows, outflows per period).
 *    A stated definition stays a definition; a stated per-unit effect is an effect term;
 *  · authorship (`author`, `party`, `quote`) and approval (`approval`) are on every record, and on every effect term.
 *
 * Strict-output shape: every field is present (null when not stated), every object is closed, unions are `anyOf`, and no
 * number carries a bound (bounds are checked in `compile.ts`, where the error is a sentence the AI can act on).
 * Synthetic examples only (a bakery, a gym): never a test brief's words.
 */
import { z } from 'zod-v4';

export const CANONICAL_VERSION = 'canonical.v1' as const;

const id = z.string().describe('A short lowercase snake_case id (letters, digits, underscores), unique across the whole model.');
const ids = z.array(id);

export const AUTHORS = ['person', 'olumi'] as const;
export type AuthorT = (typeof AUTHORS)[number];
export const APPROVALS = ['proposed', 'approved'] as const;

/** Who asserted it, in whose words, and whether the person has accepted it. Three separate facts, never one. */
const attribution = {
  author: z.enum(AUTHORS).describe(
    "Who asserted this. person: the person's own statement, or someone they report (named in party). olumi: Olumi's own addition, reading or estimate. Never present Olumi's as the person's."),
  party: z.string().nullable().describe(
    'When the person reports someone else\'s statement ("our accountant says"): that someone, as written. Null otherwise.'),
  quote: z.string().nullable().describe(
    "The person's exact words that state this, copied verbatim from what they wrote. Required for the person's figures and relations. Null for Olumi's own items."),
  approval: z.enum(APPROVALS).describe('proposed: not yet accepted by the person (always, in a draft). approved: the person accepted it (set by Olumi\'s host, never by the draft).'),
};

// ── Quantities ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const QUANTITY_STATUSES = ['known', 'estimated', 'asked', 'derived', 'unknown', 'not_applicable', 'unsupported'] as const;
export type QuantityStatusT = (typeof QUANTITY_STATUSES)[number];
/** The statuses whose figure is in hand: the only ones that reach the executable model as a value or range. */
export const FIGURE_STATUSES: ReadonlySet<QuantityStatusT> = new Set(['known', 'estimated']);
/** The statuses that withhold every goal they feed, with a reason (never an invented figure). */
export const WITHHOLDING_STATUSES: ReadonlySet<QuantityStatusT> = new Set(['unknown', 'unsupported']);

export const UNIT_RULES = 'The unit in singular words: a currency as GBP, USD or EUR (or £, $, €); a count noun ("loaf", "member"); "/" for per, read left to right ("GBP/loaf", "member/month", "GBP/member/month"); "1" for a pure number or a chance from 0 to 1; "%" for a percentage (its figures in percent, 20 for 20 %). Never a multiplier such as k or m: write the figure in full. A coefficient\'s unit is the defined quantity\'s unit per the driver\'s unit ("loaf/week/oven").';

export const CanonicalQuantity = z.object({
  id,
  label: z.string().describe('A short plain name the person would recognise ("Loaves sold per week").'),
  unit: z.string().describe(UNIT_RULES),
  value: z.number().nullable().describe('One figure, in the unit; for an Olumi estimate, its central figure (or null). Null when there is no figure.'),
  low: z.number().nullable().describe('The low end of a stated or estimated range, in the unit. Null when not a range.'),
  high: z.number().nullable().describe('The high end of a stated or estimated range, in the unit. Null when not a range.'),
  status: z.enum(QUANTITY_STATUSES).describe(
    'known: the person stated it (a figure, or low and high), quoted. Olumi\'s only known figures: an exact calendar conversion (12 month/year, 52 week/year, 7 day/week), and its reading of a stated calendar date as a window\'s whole number of periods (basis names the date). '
    + 'estimated: Olumi\'s provisional estimate of a general figure, always with low and high, as wide as what is genuinely unknown. '
    + 'asked: a figure only the person can know (their own costs, prices, headcount, dates) that they did not give: every figure null, with a question. Never estimate it. '
    + 'derived: worked out by exactly one relation (a definition, effect or stock): every figure null. '
    + 'unknown: it matters, but nobody can give or responsibly estimate it yet: every figure null, basis says why. '
    + 'not_applicable: it does not apply to this situation, so nothing uses it. '
    + 'unsupported: the person stated it but these forms cannot express it: every figure null, basis says what is missing.'),
  question: z.string().nullable().describe('For asked: the one plain question to the person that would give this figure. Null otherwise.'),
  basis: z.string().nullable().describe(
    'For estimated: one plain sentence on what the estimate rests on. For unknown, not_applicable or unsupported: why. Null otherwise.'),
  ...attribution,
}).strict();
export type CanonicalQuantityT = z.infer<typeof CanonicalQuantity>;

// ── Relations: canonical forms only ──────────────────────────────────────────────────────────────────────────────────────

export const DEFINITION_OPS = ['sum', 'difference', 'product', 'ratio'] as const;

const DefinitionRelation = z.object({
  form: z.enum(['definition']),
  id,
  defines: id.describe('The derived quantity this relation works out.'),
  op: z.enum(DEFINITION_OPS).describe('sum: parts added. difference: the first part minus the rest. product: parts multiplied. ratio: the first part divided by the rest.'),
  parts: ids.describe('Quantity ids, in order. sum and difference parts share the defined unit; product and ratio parts\' units combine to it.'),
  ...attribution,
}).strict().describe('What a quantity IS ("profit is takings minus costs"). A definition, not a cause.');

export const EffectTerm = z.object({
  driver: id.describe('The quantity whose change moves the defined quantity.'),
  coefficient: id.describe('A quantity: the change in the defined quantity per one unit of the driver, in natural units ("150 loaf/week/oven"), with its own range and author.'),
  ...attribution,
}).strict().describe('One link: coefficient × driver. Its author is who asserted that the driver moves it; the coefficient quantity carries who gave the size.');
export type EffectTermT = z.infer<typeof EffectTerm>;

const EffectRelation = z.object({
  form: z.enum(['effect']),
  id,
  defines: id,
  base: id.describe('The quantity\'s level with every driver at zero, in its unit (often its level today when the drivers are changes).'),
  terms: z.array(EffectTerm),
  ...attribution,
}).strict().describe('defines = base + Σ coefficient × driver. A stated per-unit effect ("each extra oven adds about 150 loaves a week") is a term.');

const StockRelation = z.object({
  form: z.enum(['stock']),
  id,
  defines: id,
  start: id.describe('The quantity giving the stock\'s level at period 0 (now), in the stock\'s unit.'),
  inflows: ids.describe('Quantities added each period, in the stock\'s unit per period.'),
  outflows: ids.describe('Quantities removed each period, in the stock\'s unit per period.'),
  ...attribution,
}).strict().describe('A level that carries over: next period\'s level = this period\'s + inflows − outflows.');

export const CanonicalRelation = z.union([DefinitionRelation, EffectRelation, StockRelation]);
export type CanonicalRelationT = z.infer<typeof CanonicalRelation>;
export type DefinitionRelationT = z.infer<typeof DefinitionRelation>;
export type EffectRelationT = z.infer<typeof EffectRelation>;
export type StockRelationT = z.infer<typeof StockRelation>;

// ── Goals and limits ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const CMPS = ['>=', '<=', '>', '<'] as const;
export const AGGREGATIONS = ['end', 'sum', 'mean', 'every'] as const;

/**
 * A window counts in the model's periods from an origin. Its length and the origin's timing are QUANTITIES, so a missing
 * deadline or launch date is an ordinary asked quantity (phase 0 lesson 4: every ask's answer fills exactly one quantity).
 */
export const CanonicalWindow = z.object({
  origin_event: z.string().nullable().describe('Null when the window counts from now. Otherwise the event it counts from, as written ("the opening").'),
  origin_offset: id.nullable().describe('For an event: a quantity in the model\'s period unit giving how many periods from now it happens (asked when not stated). Null when the window counts from now.'),
  start: z.number().int().describe('Periods after the origin the window opens: 0 = at the origin ("in the first three months after opening" is 0).'),
  periods: id.describe('A quantity in the model\'s period unit giving how many periods the window lasts ("within 3 months" on a monthly model: 3 month, the person\'s quote). When no deadline was stated: an asked quantity with the question "By when?". A calendar date ("by the end of March") is Olumi\'s reading: known, author olumi, its basis naming the date.'),
}).strict();
export type CanonicalWindowT = z.infer<typeof CanonicalWindow>;

const aggregation = z.enum(AGGREGATIONS).describe(
  'end: the level after the window\'s last period. sum: the total over the window. mean: the average per period over the window. every: in every period of the window.');

export const CanonicalGoal = z.object({
  id,
  label: z.string().describe("The aim, in the person's words where possible."),
  measure: z.object({
    quantity: id.describe('The quantity the aim is about.'),
    cmp: z.enum(CMPS).describe('> for "over" or "more than"; >= for "at least" or "reach"; < for "under" or "below"; <= for "at most".'),
    target: id.describe('A quantity holding the target figure, in the measured quantity\'s unit (× the period for a sum of a per-period flow). A target stated as a change from today is a derived quantity (today\'s level plus the change).'),
    aggregation,
    window: CanonicalWindow,
    measure_by: z.enum(AUTHORS).describe('person when they named the measure; olumi when the aim had none and this is Olumi\'s suggested measure (the aim stays theirs; every figure they did not give stays asked).'),
  }).strict().nullable().describe('Null for an aim with no measure yet ("keep the regulars happy"): it is left out of the chance and asked about, never dropped.'),
  question: z.string().nullable().describe('When the measure is null: the one plain question that would give it a measure ("How would you tell the regulars are happy: repeat visits a week?"). Null otherwise.'),
  ...attribution,
}).strict().describe(
  'WHAT THE PERSON IS TRYING TO ACHIEVE. Every situation has at least one, even when it has no measure yet. Never a condition the plan must not break (that is a limit); a condition is never both.');
export type CanonicalGoalT = z.infer<typeof CanonicalGoal>;

export const CanonicalLimit = z.object({
  id,
  label: z.string(),
  quantity: id,
  cmp: z.enum(CMPS),
  bound: id.describe('A quantity holding the limit\'s figure, in the limited quantity\'s unit.'),
  aggregation,
  window: CanonicalWindow,
  ...attribution,
}).strict().describe(
  'A CONDITION THE PLAN MUST NOT BREAK, beside the aim ("we cannot spend more than 2,000 GBP a month", "I can give it at most 10 hours a week"). Never the aim itself, and never also a goal.');
export type CanonicalLimitT = z.infer<typeof CanonicalLimit>;

// ── Options and risks ────────────────────────────────────────────────────────────────────────────────────────────────────

export const OPTION_STATUSES = ['live', 'ruled_out', 'removed'] as const;

export const CanonicalOptionSet = z.object({
  quantity: id.describe('An input quantity (one with a figure, not a derived one) the option changes.'),
  to: id.describe('A quantity holding the value the option sets it to. Never a bare number.'),
  from_period: z.number().int().describe('The period it takes effect from (0 = now).'),
  author: attribution.author,
  quote: attribution.quote,
}).strict();

export const CanonicalOption = z.object({
  id,
  label: z.string().describe('The option\'s exact name as the person wrote it; for Olumi\'s own option, a short plain name.'),
  sets: z.array(CanonicalOptionSet).describe('What the option changes. [] for "carry on as now".'),
  status: z.enum(OPTION_STATUSES).describe('live: compared. ruled_out: the person rules it out but keeps it in view. removed: taken out of the comparison.'),
  developed_from: id.nullable().describe('The id of the option this is a variant of. A record, not a cause. Null otherwise.'),
  ...attribution,
}).strict();
export type CanonicalOptionT = z.infer<typeof CanonicalOption>;

export const CanonicalRisk = z.object({
  id,
  label: z.string().describe('An event that may or may not happen ("the oven breaks down"). Never something already true.'),
  occurrence: id.describe('A quantity in unit "1" (or "%"): the chance it happens at least once over the whole model horizon.'),
  severity: id.describe('A quantity: what it does IF it happens, drawn only when it does. In the affected quantity\'s unit for add; unit "1" for multiply.'),
  effect_on: id.describe('The quantity it changes.'),
  mode: z.enum(['add', 'multiply']).describe('add: severity is added to the quantity. multiply: the quantity is multiplied by severity.'),
  from_period: z.number().int().describe('The period from which the effect applies, once it happens.'),
  ...attribution,
}).strict();
export type CanonicalRiskT = z.infer<typeof CanonicalRisk>;

// ── Qualitative records: first-class, display-only, each naming what it concerns ─────────────────────────────────────────

const concerns = ids.describe('The ids of the records (quantities, relations, goals, options, risks or other notes) this concerns. [] when it concerns the situation as a whole.');

export const CanonicalClaim = z.object({
  id, text: z.string().describe('A statement about the situation, as said ("the regulars come for the sourdough").'), concerns, ...attribution,
}).strict();

export const CanonicalEvidence = z.object({
  id,
  text: z.string().describe('What was observed or measured, as said.'),
  source: z.string().nullable().describe('Where it comes from, as stated ("last year\'s till records"). Null when not stated.'),
  bears: z.enum(['supports', 'challenges', 'informs']).describe('Whether it supports, challenges or simply informs what it concerns.'),
  concerns, ...attribution,
}).strict();

export const CanonicalAssumption = z.object({
  id,
  text: z.string().describe('A premise the reasoning rests on ("the new oven runs at full capacity from the first week").'),
  applied: z.boolean().describe('true when the calculation is worked out under it; false when it is only noted.'),
  concerns, ...attribution,
}).strict();

export const CanonicalDissent = z.object({
  id,
  holder: z.string().describe('Who holds the view, as written ("my business partner").'),
  position: z.string().describe('Their view, in plain words.'),
  concerns, ...attribution,
}).strict().describe('A disagreement worth keeping visible. Never resolved by dropping it.');

export const CanonicalCondition = z.object({
  id,
  text: z.string(),
  kind: z.enum(['prerequisite', 'challenge']).describe(
    'prerequisite: a real-world requirement that must be met first ("only once the landlord agrees"), shown beside the result. challenge: a doubt worth raising, said beside the result. A missing figure is never a condition: it is an asked quantity.'),
  concerns, ...attribution,
}).strict();

export const CanonicalLeftOut = z.object({
  id,
  text: z.string().describe('What matters but is not in the calculation.'),
  why: z.string().describe('Why it is left out, in one plain sentence.'),
  question: z.string().nullable().describe('What would let it in (a measure, a figure), as one question to the person. Null if nothing would.'),
  concerns, ...attribution,
}).strict();

export const CanonicalHistoryEntry = z.object({
  id: z.string().describe('The id of the record that changed.'),
  change: z.enum(['superseded', 'withdrawn']),
  old: z.string().describe('The earlier record, as JSON text, so a correction never loses what it replaced.'),
  quote: attribution.quote,
}).strict();

// ── The model ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const PERIOD_UNITS = ['week', 'month', 'year'] as const;

export const CanonicalModel = z.object({
  version: z.enum([CANONICAL_VERSION]),
  question: z.string().describe('What is being reasoned about, in one plain sentence.'),
  period: z.enum(PERIOD_UNITS).describe('The model\'s time step, which windows and stocks count in. Period 0 is now.'),
  quantities: z.array(CanonicalQuantity),
  relations: z.array(CanonicalRelation),
  goals: z.array(CanonicalGoal).describe('Every aim the person stated (at least one), each with its own measure (or null), target and window.'),
  limits: z.array(CanonicalLimit).describe('Every condition the plan must not break. A budget or a time cap is a limit, not a goal.'),
  options: z.array(CanonicalOption).describe('Every option the person named, by its exact name; Olumi\'s own options are author olumi.'),
  risks: z.array(CanonicalRisk),
  claims: z.array(CanonicalClaim),
  evidence: z.array(CanonicalEvidence),
  assumptions: z.array(CanonicalAssumption),
  dissent: z.array(CanonicalDissent),
  conditions: z.array(CanonicalCondition),
  left_out: z.array(CanonicalLeftOut),
  history: z.array(CanonicalHistoryEntry).describe('Kept by Olumi\'s host: [] in a first draft.'),
}).strict();
export type CanonicalModelT = z.infer<typeof CanonicalModel>;

/** The record families a `concerns` list (or an error's `items`) can name, in display order. */
export const QUALITATIVE_FAMILIES = ['claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out'] as const;
export type QualitativeFamilyT = (typeof QUALITATIVE_FAMILIES)[number];
