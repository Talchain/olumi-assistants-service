/**
 * THE CANONICAL REASONING MODEL (spike S1, 23 Oct 2026; MODEL-ARCH-PLAN r2/r3 with the PL's corrections and the phase 0/0b
 * and gold-model format fixes).
 *
 * The AI writes the person's situation as this ONE typed model, in one strict structured output. It is the full reasoning
 * model, not equations alone (PL correction 1): quantities and their canonical relations, goals, limits, preferences, options
 * and risks, AND the qualitative records (claims, evidence, assumptions, dissent, conditions, left out) as first-class items
 * that name what they concern. Code then only compiles it (`compile.ts` → `executable.ts`), simulates it (`simulate/`) and
 * draws it (`project.ts`). The display shows every record; the calculation is the compiled subset.
 *
 * Rules the schema states and `compile.ts` enforces:
 *  · every number is a NAMED quantity with a unit, an author and a status; no bare literals;
 *  · a quantity's author is the person (their words, quoted), Olumi (an estimate: always low AND high) or STRUCTURE (an exact
 *    constant that defines the model: a unit conversion, a 0/1 switch, a count; never shown as an Olumi estimate);
 *  · a quantity is a FACT (the person's own situation: asked when missing, never estimated) or a COEFFICIENT (a mechanism's
 *    size: Olumi may estimate it, labelled and ranged);
 *  · a figure only the person can give and did not is `asked` (null + a question). Asking is a legitimate, successful outcome:
 *    it withholds only what that figure feeds, and the compiler never removes it or gives it a value;
 *  · relations are canonical forms only: a definition (a signed SUM, or a PRODUCT of powers ±1: difference, ratio and mixed
 *    signs in one op), an effect (base + Σ coefficient × driver, each coefficient an uncertain mechanism size in natural units)
 *    or a stock (start, inflows, outflows per period). An exact identity is a definition, never an effect;
 *  · a goal is what the person is trying to achieve; a limit is a condition the plan must not break; a preference ("we'd like
 *    to spend less") is neither. An aim or guardrail with no measure yet is valid: measure null plus a coaching question;
 *  · the QUESTION binds the calculation: each goal states its frame (a level, or a change from a reference), aggregation
 *    (end, sum, mean, every, max, min), optional rate denominator (`per`) and window;
 *  · a window's length and its origin's timing are quantities, and timing may name a quantity, so every ask fills exactly one
 *    quantity;
 *  · authorship (`author`, `party`, `quote`, `author_id`) and approval are on every record, and on every effect term.
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
/**
 * The mark of a figure the person gave as approximate ("about £2,000"), set by the host on the quantity's `basis` when it
 * records their answer (the DL's ruling, 23 Oct): the figure is theirs, NO range is read into "about", it is used exactly as
 * stated, and a range is asked for.
 */
export const APPROXIMATE_FIGURE = 'You gave this as an approximate figure; Olumi uses it for now, until you give a range.';
export type AuthorT = (typeof AUTHORS)[number];
/** A quantity's figure may also be STRUCTURE: an exact constant the model's form needs (phase 0b: 40 zero-width "estimates"). */
export const QUANTITY_AUTHORS = ['person', 'olumi', 'structure'] as const;
export const APPROVALS = ['proposed', 'approved'] as const;

/** Who asserted it, in whose words, and whether the person has accepted it. Separate facts, never one. */
const attribution = {
  author: z.enum(AUTHORS).describe(
    "Who asserted this. person: the person's own statement, or someone they report (named in party). olumi: Olumi's own addition, reading or estimate. Never present Olumi's as the person's."),
  party: z.string().nullable().describe(
    'When the person reports someone else\'s statement ("our accountant says"): that someone, as written. Null otherwise.'),
  quote: z.string().nullable().describe(
    "The person's exact words that state this, copied verbatim from what they wrote. Required for the person's figures and relations. Null for Olumi's own items."),
  approval: z.enum(APPROVALS).describe('proposed: not yet accepted by the person (always, in a draft). approved: the person accepted it (set by Olumi\'s host, never by the draft).'),
  author_id: z.string().nullable().describe('Set by Olumi\'s host: which person said or approved it, when several people work on one model. Always null in a draft.'),
};

// ── Quantities ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const QUANTITY_STATUSES = ['known', 'estimated', 'asked', 'derived', 'unknown', 'not_applicable', 'unsupported'] as const;
/**
 * FACT vs COEFFICIENT vs DERIVED (DL, from the blind phase 0 score; contradiction fixed 23 Oct): a fact is about the person's
 * own situation (their price, costs, headcount, dates, members today) and only they can give it, so a missing fact is ASKED,
 * never estimated. A coefficient is a mechanism's size (how much a driver moves what it drives, a rate, a share): Olumi may
 * estimate it, labelled and ranged, and it stays a coefficient even when it is worked out from other quantities. A derived
 * quantity that is not a link's size is neither: it is derived (worked out by its relation).
 */
export const QUANTITY_KINDS = ['fact', 'coefficient', 'derived'] as const;
export type QuantityStatusT = (typeof QUANTITY_STATUSES)[number];
/** The statuses whose figure is in hand: the only ones that reach the executable model as a value or range. */
export const FIGURE_STATUSES: ReadonlySet<QuantityStatusT> = new Set(['known', 'estimated']);
/** The statuses that withhold every goal they feed, with a reason (never an invented figure). */
export const WITHHOLDING_STATUSES: ReadonlySet<QuantityStatusT> = new Set(['unknown', 'unsupported']);

export const UNIT_RULES = 'The unit in singular words: a currency as GBP, USD or EUR (or £, $, €); a count noun ("loaf", "member"); "/" for per, read left to right ("GBP/loaf", "member/month", "GBP/member/month"); a rate per period as "/month" ("%/month" for 4 % a month; the stock it applies to × that rate is a flow per month); "1" for a pure number or a chance from 0 to 1; "%" for a percentage (its figures in percent, 20 for 20 %). Never a multiplier such as k or m: write the figure in full. A coefficient\'s unit is the defined quantity\'s unit per the driver\'s unit ("loaf/week/oven").';

/**
 * WHAT A RANGE MEANS (PL ruling B): read from the words, never assumed. bounds: the ends are hard; plausible: a rough span.
 * A person's range whose words do not say which is an UNRESOLVED reading: asked, never guessed.
 */
export const RANGE_KINDS = ['bounds', 'plausible'] as const;
const RANGE_KIND = z.enum(RANGE_KINDS).nullable().describe(
  'For a range only. bounds: the words fix hard ends ("between 80 and 150", "no more than", "at least"), so it cannot fall outside them. plausible: a rough span ("about", "roughly", "likely", "somewhere around"); Olumi\'s own estimates are plausible. Null when there is no range, or when the person\'s words do not say which (it is then asked).');

export const CanonicalQuantity = z.object({
  id,
  label: z.string().describe('A short plain name the person would recognise ("Loaves sold per week").'),
  unit: z.string().describe(UNIT_RULES),
  value: z.number().nullable().describe('One figure, in the unit; for an Olumi estimate, its most likely figure strictly inside its range (or null). Null when there is no figure.'),
  low: z.number().nullable().describe('The low end of a stated or estimated range, in the unit. Null when not a range.'),
  high: z.number().nullable().describe('The high end of a stated or estimated range, in the unit. Null when not a range.'),
  range_kind: RANGE_KIND,
  kind: z.enum(QUANTITY_KINDS).describe(
    'fact: a figure about the person\'s own situation (their price, costs, headcount, members today, dates, targets): only they can give it, so a missing fact is asked, never estimated. '
    + 'coefficient: the size of a mechanism (each extra oven adds so many loaves; the share of visitors who join; a rate): Olumi may estimate it, labelled, with low and high; a link\'s size stays a coefficient even when it is worked out by a relation. '
    + 'derived: worked out by its relation and not a link\'s size (profit, total members): its status is derived. A structural constant is a fact.'),
  status: z.enum(QUANTITY_STATUSES).describe(
    'known: a figure in hand that is not an estimate: the person\'s (quoted), a structural constant (author structure), or Olumi\'s reading of a stated calendar date as a window\'s whole number of periods (basis names the date). '
    + 'estimated: Olumi\'s provisional estimate of a coefficient, always with low and high, as wide as what is genuinely unknown. Never a fact. '
    + 'asked: a figure only the person can know (their own costs, prices, headcount, dates) that they did not give: every figure null, with a question. Never estimate it, and never ask for the result itself (a goal\'s own quantity). '
    + 'derived: worked out by exactly one relation (a definition, effect or stock): every figure null. '
    + 'unknown: it matters, but nobody can give or responsibly estimate it yet: every figure null, basis says why. '
    + 'not_applicable: it does not apply to this situation, so nothing uses it. '
    + 'unsupported: the person stated it but these forms cannot express it: every figure null, basis says what is missing.'),
  question: z.string().nullable().describe('For asked: the one plain question to the person that would give this figure, in their words, never internal terms. Null otherwise.'),
  basis: z.string().nullable().describe(
    'For estimated: one plain sentence on what the estimate rests on. For structure: what the constant is ("12 months in a year"). For unknown, not_applicable or unsupported: why. Null otherwise.'),
  author: z.enum(QUANTITY_AUTHORS).describe(
    "Who gave the figure. person: the person's own figure (or someone they report, in party), quoted. olumi: Olumi's estimate (ranged) or reading. structure: an exact constant the model's form needs (12 month/year, 100 for a percentage scale, 0 or 1 for an option switched off or on, a count that defines the structure): never an estimate, never shown as Olumi's, no range."),
  party: attribution.party,
  quote: attribution.quote,
  approval: attribution.approval,
  author_id: attribution.author_id,
}).strict();
export type CanonicalQuantityT = z.infer<typeof CanonicalQuantity>;

// ── Relations: canonical forms only ──────────────────────────────────────────────────────────────────────────────────────

const SumDefinition = z.object({
  form: z.enum(['definition']),
  id,
  defines: id.describe('The derived quantity this relation works out.'),
  op: z.enum(['sum']),
  parts: z.array(z.object({ id, sign: z.literal([1, -1]).describe('1 to add the part, -1 to subtract it.') }).strict())
    .describe('Signed parts, all in the defined quantity\'s unit ("profit is takings minus costs": takings +1, costs -1).'),
  ...attribution,
}).strict().describe('What a quantity IS, as a signed sum. A definition, not a cause.');

const ProductDefinition = z.object({
  form: z.enum(['definition']),
  id,
  defines: id.describe('The derived quantity this relation works out.'),
  op: z.enum(['product']),
  parts: z.array(z.object({ id, power: z.literal([1, -1]).describe('1 to multiply by the part, -1 to divide by it.') }).strict())
    .describe('Parts with powers; their units multiply and divide to the defined quantity\'s unit ("takings are loaves sold × price"; "cost per loaf is costs ÷ loaves": costs 1, loaves -1).'),
  ...attribution,
}).strict().describe('What a quantity IS, as a product of powers ±1. A definition, not a cause.');

export const EffectTerm = z.object({
  driver: id.describe('The quantity whose change moves the defined quantity.'),
  coefficient: id.describe('A coefficient quantity: the uncertain size of the mechanism, the change in the defined quantity per one unit of the driver, in natural units ("150 loaf/week/oven"), with its own range and author. Never exact: an exact relation is a definition.'),
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
}).strict().describe('defines = base + Σ coefficient × driver, for a MECHANISM of uncertain size ("each extra oven adds about 150 loaves a week"). An exact identity is a definition, never an effect.');

const StockRelation = z.object({
  form: z.enum(['stock']),
  id,
  defines: id,
  start: id.describe('The quantity giving the stock\'s level at period 0 (now), in the stock\'s unit.'),
  inflows: ids.describe('Quantities added each period, in the stock\'s unit per period.'),
  outflows: ids.describe('Quantities removed each period, in the stock\'s unit per period (a stock × a rate per period is such a flow).'),
  ...attribution,
}).strict().describe('A level that carries over: next period\'s level = this period\'s + inflows − outflows.');

export const CanonicalRelation = z.union([SumDefinition, ProductDefinition, EffectRelation, StockRelation]);
export type CanonicalRelationT = z.infer<typeof CanonicalRelation>;
export type SumDefinitionT = z.infer<typeof SumDefinition>;
export type ProductDefinitionT = z.infer<typeof ProductDefinition>;
export type EffectRelationT = z.infer<typeof EffectRelation>;
export type StockRelationT = z.infer<typeof StockRelation>;

// ── Goals, limits and preferences ────────────────────────────────────────────────────────────────────────────────────────

export const CMPS = ['>=', '<=', '>', '<'] as const;
/** THE QUESTION BINDS THE CALCULATION (plan r3 #1; BATCH0-CHANGE-GOAL-DECISION): a level, or a change from a stated reference. */
export const GOAL_FRAMES = ['level', 'change_abs', 'change_rel'] as const;
export const REFERENCE_KINDS = ['now', 'option', 'value'] as const;
export const AGGREGATIONS = ['end', 'sum', 'mean', 'every', 'max', 'min'] as const;

/**
 * A window counts in the model's periods from an origin. Its length and the origin's timing are QUANTITIES, so a missing
 * deadline or launch date is an ordinary asked quantity (phase 0 lesson 4: every ask's answer fills exactly one quantity).
 */
export const CanonicalWindow = z.object({
  origin_event: z.string().nullable().describe('Null when the window counts from now. Otherwise the event it counts from, as written ("the opening").'),
  origin_offset: id.nullable().describe('For an event: a quantity in the model\'s period unit giving how many periods from now it happens (asked when not stated). Null when the window counts from now.'),
  start: z.number().int().describe('Periods after the origin the window opens: 0 = at the origin ("in the first three months after opening" is 0). Counting is ordinal: "in months 6 to 8" opens at 5, with 3 periods.'),
  periods: id.describe('A quantity in the model\'s period unit giving how many periods the window lasts ("within 3 months" on a monthly model: 3 month, the person\'s quote). When no deadline was stated: an asked quantity with the question "By when?". A calendar date ("by the end of March") is Olumi\'s reading: known, author olumi, its basis naming the date.'),
}).strict();
export type CanonicalWindowT = z.infer<typeof CanonicalWindow>;

const aggregation = z.enum(AGGREGATIONS).describe(
  'end: the level after the window\'s last period. sum: the total over the window. mean: the average per period. every: in every period of the window. max: the highest level in the window ("reach 400 members within six months" is max ≥ 400). min: the lowest level in the window ("never below 2,000 GBP in the bank" is min ≥ 2,000).');
const per = id.nullable().describe('For a rate over the window ("conversion over the first three months"): the denominator quantity, aggregated the same way, so the value is agg(quantity) ÷ agg(per). The target is then in quantity ÷ per units. Null otherwise; never with every.');

export const CanonicalGoal = z.object({
  id,
  label: z.string().describe("The aim in the person's own words (\"keep weekly profit over £900\"). Never empty."),
  measure: z.object({
    quantity: id.describe('The quantity the aim is about. Never an asked quantity: that would ask for the result itself.'),
    per,
    cmp: z.enum(CMPS).describe('> for "over" or "more than"; >= for "at least" or "reach"; < for "under" or "below"; <= for "at most".'),
    target: id.describe('A quantity holding the target figure, in the measured quantity\'s unit (× the period for a sum of a per-period flow).'),
    frame: z.enum(GOAL_FRAMES).describe(
      'level: the quantity itself reaches the target ("revenue next year over 60,000 GBP" is a level, summed over the window). '
      + 'change_abs: its change from the reference, in its own unit ("grow takings by 500 GBP a month"). '
      + 'change_rel: its change from the reference as a fraction of the reference, the target in "%" or "1" ("grow takings by 10 %").'),
    reference: z.object({
      kind: z.enum(REFERENCE_KINDS).describe('now: its level today, before any option. option: its level under the named option on the same draws (usually "carry on as now"). value: a stated reference quantity ("10 % above last year\'s 40,000 GBP").'),
      option: id.nullable().describe('For option: the option id. Null otherwise.'),
      quantity: id.nullable().describe('For value: the quantity holding the reference, in the measured quantity\'s unit. Null otherwise.'),
    }).strict().nullable().describe('Null for a level. For a change: what it is a change from.'),
    aggregation,
    window: CanonicalWindow.nullable().describe('Null for a static level with no deadline ("keep the margin above 20 %"). A level that changes over time needs a window.'),
    measure_by: z.enum(AUTHORS).describe('person when they named the measure; olumi when the aim had none and this is Olumi\'s suggested measure (the aim stays theirs; every figure they did not give stays asked).'),
    assumptions: ids.describe('Ids of the assumption records this reading of the goal rests on (for a change from now: "carrying on leaves it unchanged" unless the model says otherwise).'),
    exclusions: ids.describe('Ids of left_out records for parts of the aim this measure does not cover ("code quality is not in this chance"). [] when it covers the whole aim.'),
  }).strict().nullable().describe('Null for an aim with no measure yet ("keep the regulars happy"; "a successful launch" with no metric): VALID, left out of the chance and asked about. Never invent a measure to have one.'),
  question: z.string().nullable().describe('When the measure is null: the one plain question that would give it a measure ("How would you tell the regulars are happy: repeat visits a week?"). When the window is null but the level changes over time: "By when?". Null otherwise.'),
  ...attribution,
}).strict().describe(
  'WHAT THE PERSON IS TRYING TO ACHIEVE, in their words. Never a condition the plan must not break (that is a limit), never a preference; a condition is never both a goal and a limit.');
export type CanonicalGoalT = z.infer<typeof CanonicalGoal>;
export type CanonicalMeasureT = NonNullable<CanonicalGoalT['measure']>;

export const CanonicalLimit = z.object({
  id,
  label: z.string().describe("The condition in the person's own words. Never empty."),
  measure: z.object({
    quantity: id,
    per,
    cmp: z.enum(CMPS),
    bound: id.describe('A quantity holding the limit\'s figure, in the limited quantity\'s unit.'),
    aggregation,
    window: CanonicalWindow.nullable().describe('Null for a static condition with no period.'),
  }).strict().nullable().describe('Null for a guardrail with no measure yet ("keep code quality where it is"): VALID, reported as not covered by the result, never given an invented scale.'),
  question: z.string().nullable().describe('When the measure is null: the one plain question that would give it a measure. Null otherwise.'),
  ...attribution,
}).strict().describe(
  'A CONDITION THE PLAN MUST NOT BREAK, beside the aim ("we cannot spend more than 2,000 GBP a month", "I can give it at most 10 hours a week"). Never the aim itself, never a preference, and never also a goal.');
export type CanonicalLimitT = z.infer<typeof CanonicalLimit>;

export const CanonicalPreference = z.object({
  id,
  quantity: id.describe('The quantity the person would like lower or higher.'),
  direction: z.enum(['lower', 'higher']),
  ...attribution,
}).strict().describe('A wish without a threshold ("we\'d like to spend less"): shown and reported, never a goal or a limit, never given an invented target.');
export type CanonicalPreferenceT = z.infer<typeof CanonicalPreference>;

// ── Options and risks ────────────────────────────────────────────────────────────────────────────────────────────────────

export const OPTION_STATUSES = ['live', 'ruled_out', 'removed'] as const;
const timing = z.union([z.number().int(), id]).describe('The period it takes effect from: a whole number (0 = now), or the id of a quantity in the model\'s period unit when the timing is the person\'s figure, asked, or differs by option ("when the extension opens").');

export const CanonicalOptionSet = z.object({
  quantity: id.describe('An input quantity (one with a figure, not a derived one) the option changes.'),
  to: id.nullable().describe('A quantity holding the value the option sets it to, when that value is shared or used elsewhere. Null when the value is this option\'s own, given inline below.'),
  value: z.number().nullable().describe('With to null: this option\'s own value for the quantity, in its unit ("raise the price to 3.50": 3.5; switched on: 1). Null otherwise.'),
  low: z.number().nullable().describe('With to null: the low end of this option\'s own value, when a range. Null otherwise.'),
  high: z.number().nullable().describe('With to null: the high end of this option\'s own value, when a range. Null otherwise.'),
  range_kind: RANGE_KIND,
  question: z.string().nullable().describe('With to null and no figure: the one question to the person for this option\'s value. Null otherwise.'),
  from_period: timing,
  author: z.enum(QUANTITY_AUTHORS).describe('Who gave the inline value: person, olumi, or structure (a switch: 1 for on).'),
  quote: attribution.quote,
}).strict().describe('What the option changes, and to what: a quantity id in to, or the option\'s own inline value (value, or low and high), with who gave it. An inline value compiles into a named quantity of its own.');
export type CanonicalOptionSetT = z.infer<typeof CanonicalOptionSet>;

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
  from_period: timing,
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
  author_id: attribution.author_id,
}).strict();

// ── The model ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const PERIOD_UNITS = ['week', 'month', 'year'] as const;

export const CanonicalModel = z.object({
  version: z.enum([CANONICAL_VERSION]),
  question: z.string().describe('What is being reasoned about, in one plain sentence.'),
  period: z.enum(PERIOD_UNITS).describe('The model\'s time step, which windows and stocks count in. Period 0 is now.'),
  quantities: z.array(CanonicalQuantity),
  relations: z.array(CanonicalRelation),
  goals: z.array(CanonicalGoal).describe('Every aim the person stated, each with its own measure (or null with a question), target and window. An aim with no measure is valid; never invent one.'),
  limits: z.array(CanonicalLimit).describe('Every condition the plan must not break. A budget or a time cap is a limit, not a goal.'),
  preferences: z.array(CanonicalPreference).describe('Every wish without a threshold ("we\'d like to spend less").'),
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
