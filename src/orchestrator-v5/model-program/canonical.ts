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
 *    fewer late deliveries") is neither. An aim or guardrail with no measure yet is valid: measure null plus a coaching question;
 *  · the QUESTION binds the calculation: each goal states its frame (a level, or a change from a reference), aggregation
 *    (end, sum, mean, every, max, min), optional rate denominator (`per`) and window;
 *  · a window's length and its origin's timing are quantities, and timing may name a quantity, so every ask fills exactly one
 *    quantity;
 *  · authorship (`author`, `party`, `quote`, `author_id`) and approval (`approval`, `approved_by`) are on every record, and on
 *    every effect term: who said it and who accepted it are separate facts (C6).
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
/**
 * The fields only Olumi's host sets (Paul 26 Oct: the AI does no unnecessary work): never in the schema the drafter is sent
 * (`prompt.ts`), and set by the host when a draft is read (`draft.ts` withHostFields). The stored model keeps them.
 */
export const HOST_OWNED_FIELDS = ['approval', 'approved_by', 'author_id'] as const;

/** Who asserted it, in whose words, and whether the person has accepted it. Separate facts, never one. */
const attribution = {
  author: z.enum(AUTHORS).describe(
    "Who introduced this content: person for their quoted words, including uncertainty or a question; olumi for Olumi additions or readings. Keep added interpretation separate. Status alone never determines origin; party names a reported speaker."),
  party: z.string().nullable().describe(
    'When the person reports someone else\'s statement ("our accountant says"): that someone, as written. Null otherwise.'),
  quote: z.string().nullable().describe(
    "One unbroken verbatim span supporting the person's content, including their stated uncertainty or question. Null for Olumi's content."),
  approval: z.enum(APPROVALS).describe('proposed: not yet accepted by the person (always, in a draft). approved: the person accepted it (set by Olumi\'s host, never by the draft).'),
  // C6 (27 Oct 2026): approving never makes the approver the author. A record approved before this held its approver in
  // author_id; it reads with approved_by null (`withDeclaredTiming`) and is never rewritten on read.
  approved_by: z.string().nullable().describe('Set by Olumi\'s host: which person accepted it, on an approved record; null when proposed or not known.'),
  author_id: z.string().nullable().describe('Set by Olumi\'s host: which person said it (whose words these are), when several people work on one model; null for Olumi\'s own and when not known. Never who approved it. Always null in a draft.'),
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

export const UNIT_RULES = 'Singular unit words; GBP, USD or EUR (or £, $, €); "1" for a pure number or chance from 0 to 1; "%" for percent (20 means 20%); "/" for per, with every term after a slash in the denominator; no k or m multipliers. Coefficient unit × driver unit must equal the defined unit: (USD/day)/(task/hour) is "USD hour/day/task", never "USD/day/task/hour".';

/**
 * WHAT A RANGE MEANS (PL ruling B): read from the words, never assumed. bounds: the ends are hard; plausible: a rough span.
 * A person's range whose words do not say which is an UNRESOLVED reading: asked, never guessed.
 */
export const RANGE_KINDS = ['bounds', 'plausible'] as const;
const RANGE_KIND = z.enum(RANGE_KINDS).nullable().describe(
  'For endpoints only: bounds means hard ends; plausible means a rough span, including supported Olumi estimates. An approximate single figure is known with its stated value, low/high/range_kind null and the approximate basis; never manufacture endpoints from about, roughly or ~. A stated range of unresolved meaning stays asked with range_kind null.');

export const CanonicalQuantity = z.object({
  id,
  label: z.string().describe('A short plain name the person would recognise ("Loaves sold per week"). In a first draft, aim for about 8 quantities the person would recognise; never add arithmetic scaffolding the stated meaning does not need.'),
  unit: z.string().describe(UNIT_RULES),
  value: z.number().nullable().describe('One figure, in the unit; for an Olumi estimate, its most likely figure strictly inside its range (or null). Null when there is no figure.'),
  low: z.number().nullable().describe('The low end of a stated or estimated range, in the unit. Null when not a range.'),
  high: z.number().nullable().describe('The high end of a stated or estimated range, in the unit. Null when not a range.'),
  range_kind: RANGE_KIND,
  floor: z.number().nullable().describe('Olumi\'s reading of the physically lowest value in this quantity\'s unit: 0 for nonnegative levels or counts; -100 in % or -1 in unit 1 for a change removing at most a whole share; null for other changes, differences, profit or an unjustified bound. A coefficient\'s bound follows its own meaning, never other terms. Never a target, budget or uncertainty endpoint.'),
  ceiling: z.number().nullable().describe('Olumi\'s reading of the physically highest value in this quantity\'s unit: 100 for a share in %, 1 in unit 1; null unless certain from its own meaning. Never a target, budget or uncertainty endpoint.'),
  kind: z.enum(QUANTITY_KINDS).describe(
    'fact: a figure about their situation, including observed shares, mixes and allocations; missing facts are asked, never estimated. coefficient: a causal response per unit of driver, still a coefficient when derived; estimate only when a stated relation or established mechanism supports numerical scale, otherwise unknown even if direction is plausible. derived: a quantity worked out by its relation that is not a link\'s size. Structural constants are facts.'),
  status: z.enum(QUANTITY_STATUSES).describe(
    'known: a figure in hand. estimated: an Olumi coefficient estimate with plausible low/high. asked: an answer is awaited, every figure null and a question required. derived: computed by exactly one relation, every figure null. unknown: no defensible numerical range yet, every figure null. not_applicable: unused in this situation. unsupported: their statement cannot be expressed by these forms, every figure null.'),
  question: z.string().nullable().describe('For asked: the one plain question to the person that would give this figure, in their words, never internal terms. Null otherwise.'),
  basis: z.string().nullable().describe(
    `For a person's approximate single figure, exactly: "${APPROXIMATE_FIGURE}". For estimated: what supports the numerical scale. For structure: what the constant is ("12 months in a year"). For unknown, not_applicable or unsupported: why and what would resolve it. Null otherwise.`),
  direction: z.enum(['raises', 'lowers']).nullable().describe(
    'For a link\'s size (a coefficient), used only when no figure is given (no most likely figure, and no range or one that spans zero): raises when more of the driver means more of what it moves, lowers when it means less; null when no one can say which. Null for every other quantity.'),
  author: z.enum(QUANTITY_AUTHORS).describe(
    `${attribution.author.description} structure only for necessary exact mathematical constants, with one known figure and no range. Zero may encode no additional activity, never an unstated current level or share.`),
  party: attribution.party,
  quote: attribution.quote,
  approval: attribution.approval,
  approved_by: attribution.approved_by,
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
  coefficient: id.describe('The id of the coefficient quantity supplying this link\'s size.'),
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
/** Each comparison in plain words, the one phrase table every card says it with (never an operator on a card). */
export const CMP_WORDS: Readonly<Record<(typeof CMPS)[number], string>> = { '>=': 'at least', '<=': 'at most', '>': 'more than', '<': 'less than' };
/** THE QUESTION BINDS THE CALCULATION (plan r3 #1; BATCH0-CHANGE-GOAL-DECISION): a level, or a change from a stated reference. */
export const GOAL_FRAMES = ['level', 'change_abs', 'change_rel'] as const;
export const REFERENCE_KINDS = ['now', 'option', 'value'] as const;
export const AGGREGATIONS = ['end', 'sum', 'mean', 'every', 'max', 'min'] as const;

/**
 * A window counts in the model's periods from an origin. Its length and the origin's timing are QUANTITIES, so a missing
 * deadline or opening date is an ordinary asked quantity (phase 0 lesson 4: every ask's answer fills exactly one quantity).
 */
export const CanonicalWindow = z.object({
  origin_event: z.string().nullable().describe('Null when the window counts from now. Otherwise the event it counts from, as written ("the opening").'),
  origin_offset: id.nullable().describe('For an event: a quantity in the model\'s period unit giving how many periods from now it happens (asked when not stated). Null when the window counts from now.'),
  start: z.number().int().describe('Periods after the origin the window opens: 0 = at the origin ("in the first four weeks after opening" is 0). Counting is ordinal: "in months 6 to 8" opens at 5, with 3 periods.'),
  periods: id.describe('A quantity in the model\'s period unit giving how many periods the window lasts ("within 5 weeks" on a weekly model: 5 week, the person\'s quote). When no deadline was stated: an asked quantity with the question "By when?". A calendar date ("by the end of March") is Olumi\'s reading: known, author olumi, its basis naming the date.'),
}).strict();
export type CanonicalWindowT = z.infer<typeof CanonicalWindow>;

const aggregation = z.enum(AGGREGATIONS).describe(
  'end: the level after the window\'s last period. sum: the total over the window. mean: the average per period. every: in every period of the window. max: the highest level in the window ("reach 400 members within six months" is max ≥ 400). min: the lowest level in the window ("never below 2,000 GBP in the bank" is min ≥ 2,000).');
const per = id.nullable().describe('For a rate over the window ("no-shows per booking over the first eight weeks"): the denominator quantity, aggregated the same way, so the value is agg(quantity) ÷ agg(per). The target is then in quantity ÷ per units. Null otherwise; never with every.');

export const CanonicalGoal = z.object({
  id,
  label: z.string().describe('A short title of a few words for the aim, for its card ("Weekly profit over £900"). Never empty.'),
  measure: z.object({
    quantity: id.describe('The quantity the aim is about. Never an asked quantity: that would ask for the result itself.'),
    per,
    cmp: z.enum(CMPS).describe('> for "over" or "more than"; >= for "at least" or "reach"; < for "under" or "below"; <= for "at most".'),
    target: id.describe('A quantity holding the target figure, in the measured quantity\'s unit (× the period for a sum of a per-period flow).'),
    frame: z.enum(GOAL_FRAMES).describe(
      'level: the quantity itself reaches the target ("revenue next year over 60,000 GBP" is a level, summed over the window). '
      + 'change_abs: its change from the reference, in its own unit ("grow takings by 500 GBP a month"). '
      + 'change_rel: its change from the reference as a fraction of the reference, the target in "%" or "1" ("grow takings by 12 %").'),
    reference: z.object({
      kind: z.enum(REFERENCE_KINDS).describe('now: its level today, before any option. option: its level under the named option on the same draws (usually "carry on as now"). value: a stated reference quantity ("12 % above last year\'s 40,000 GBP").'),
      option: id.nullable().describe('For option: the option id. Null otherwise.'),
      quantity: id.nullable().describe('For value: the quantity holding the reference, in the measured quantity\'s unit. Null otherwise.'),
    }).strict().nullable().describe('Null for a level. For a change: what it is a change from.'),
    aggregation,
    window: CanonicalWindow.nullable().describe('Null for a static level with no deadline ("keep the margin above 20 %"). A level that changes over time needs a window.'),
    measure_by: z.enum(AUTHORS).describe('Who named the measure: person, or olumi for a suggested measure; this does not change the aim\'s author.'),
    assumptions: ids.describe('Ids of assumption records this reading of the goal rests on; [] for none.'),
    exclusions: ids.describe('Ids of left_out records for parts of the aim this measure does not cover ("the café\'s cosy feel is not in this chance"). [] when it covers the whole aim.'),
  }).strict().nullable().describe('Null when the aim has no measure yet. A proposed release bar or other standard is an assumption or condition, never a substitute measure.'),
  question: z.string().nullable().describe('When the measure is null: the one plain question that would give it a measure ("How would you tell the regulars are happy: repeat visits a week?"). When the window is null but the level changes over time: "By when?". Null otherwise.'),
  ...attribution,
}).strict().describe(
  'An outcome sought, including wanting more or less of something without a threshold; never simultaneously a limit or preference. Events or tasks alone are context.');
export type CanonicalGoalT = z.infer<typeof CanonicalGoal>;
export type CanonicalMeasureT = NonNullable<CanonicalGoalT['measure']>;

export const CanonicalLimit = z.object({
  id,
  label: z.string().describe('A short title of a few words for the condition, for its card ("Running costs cap"). Never empty.'),
  measure: z.object({
    quantity: id,
    per,
    cmp: z.enum(CMPS),
    bound: id.describe('A quantity holding the limit\'s figure, in the limited quantity\'s unit.'),
    aggregation,
    window: CanonicalWindow.nullable().describe('Null for a static condition with no period.'),
  }).strict().nullable().describe('Null for a guardrail with no measure yet ("keep the neighbours on side"): never given an invented scale.'),
  question: z.string().nullable().describe('When the measure is null: the one plain question that would give it a measure. Null otherwise.'),
  ...attribution,
}).strict().describe(
  'A condition the plan must not break. A person-stated limit has author person and their quote on this record; an added reading of its measure or timing belongs in separately attributed supporting records, never changing who introduced the limit.');
export type CanonicalLimitT = z.infer<typeof CanonicalLimit>;

export const CanonicalPreference = z.object({
  id,
  quantity: id.describe('The quantity the person would like lower or higher.'),
  direction: z.enum(['lower', 'higher']),
  ...attribution,
}).strict().describe('A wish about how, without a threshold; shown and reported without an invented target. An outcome sought belongs in goals.');
export type CanonicalPreferenceT = z.infer<typeof CanonicalPreference>;

// ── Options and risks ────────────────────────────────────────────────────────────────────────────────────────────────────

export const OPTION_STATUSES = ['live', 'ruled_out', 'removed'] as const;
/** When a setting or a risk takes effect: a DECLARED count, one meaning in the schema and in the compiler (in force from
 *  interval k = the count). Issue map class 13: the old `from_period` ("0 = now") was written as 1 for the first period. */
export const STARTS_AFTER_PERIODS = 'How many whole periods pass before it takes effect: 0 = from the start ("straight away", "from the first month" and "from now" are all 0), "from month 3" is 2, "in two months" is 2';
const timing = z.union([z.number().int(), id]).describe(`${STARTS_AFTER_PERIODS}. Or the id of a quantity in the model's period unit giving that count, when the timing is the person's figure, asked, or differs by option ("when the extension opens").`);
/** The old fields, mapped ONCE, where a saved model is read (program-store): `from_period` k is `starts_after_periods` k, the
 *  same count under its old name. Missing quantity direction and physical bounds read as null, without inferring them, and
 *  so does a missing approved_by on a record, a link or a history entry (C6): an earlier approver stays where it was saved.
 *  A model saved before titles reads with no title (null) and no coaching questions ([]).
 *  A model that has both timing names, or neither, is left for the schema to judge. */
export function withDeclaredTiming(raw: unknown): unknown {
  const rec = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  const renamed = (x: unknown) => { if (!rec(x) || !('from_period' in x) || 'starts_after_periods' in x) return x; const { from_period, ...rest } = x; return { ...rest, starts_after_periods: from_period }; };
  if (!rec(raw) || !Array.isArray(raw['options']) || !Array.isArray(raw['risks'])) return raw;
  const declaredQuantity = (x: unknown) => (rec(x) ? { direction: null, floor: null, ceiling: null, ...x } : x);
  const approver = (x: unknown): unknown => (Array.isArray(x) ? x.map(approver) : !rec(x) ? x
    : Object.fromEntries([...Object.entries(x).map(([k, v]) => [k, approver(v)] as const), ...('approval' in x && !('approved_by' in x) ? [['approved_by', null] as const] : [])]));
  const read = { ...raw, ...('title' in raw ? {} : { title: null }), ...('coaching_questions' in raw ? {} : { coaching_questions: [] }),
    ...(Array.isArray(raw['quantities']) ? { quantities: raw['quantities'].map(declaredQuantity) } : {}),
    options: raw['options'].map((o) => (rec(o) && Array.isArray(o['sets']) ? { ...o, sets: o['sets'].map(renamed) } : o)), risks: raw['risks'].map(renamed) };
  return Object.fromEntries(Object.entries(read).map(([k, v]) => [k, !Array.isArray(v) ? v : k === 'history'
    ? v.map((h) => (rec(h) && !('approved_by' in h) ? { ...h, approved_by: null } : h)) : approver(v)]));
}

export const CanonicalOptionSet = z.object({
  quantity: id.describe('An input quantity (one with a figure, not a derived one) the option changes. Prefer a recognisable figure; an off/on switch only when the stated meaning needs one.'),
  to: id.nullable().describe('A named quantity holding the setting\'s value; required for an approximate point, whose basis an inline setting cannot hold. Null for the option\'s own exact inline value, range or unanswered setting.'),
  value: z.number().nullable().describe('With to null: this option\'s own value for the quantity, in its unit ("raise the price to 3.50": 3.5; switched on: 1). Null otherwise.'),
  low: z.number().nullable().describe('With to null: the low end of this option\'s own value, when a range. Null otherwise.'),
  high: z.number().nullable().describe('With to null: the high end of this option\'s own value, when a range. Null otherwise.'),
  range_kind: RANGE_KIND,
  question: z.string().nullable().describe('With to null and no figure: the one question to the person for this option\'s value. Null otherwise.'),
  starts_after_periods: timing,
  author: z.enum(QUANTITY_AUTHORS).describe('Who proposed this setting, with either to or an inline value. Olumi\'s proposed option settings are olumi, even when to names the person\'s figure. structure only for a mathematical off/on switch.'),
  quote: attribution.quote,
}).strict().describe('A setting: either a quantity id in to or its own inline figure or range. Inline values compile into named quantities.');
export type CanonicalOptionSetT = z.infer<typeof CanonicalOptionSet>;

export const CanonicalOption = z.object({
  id,
  label: z.string().describe('A short neutral name ("Second oven"). In a first draft, aim for about 3 options; every option they name is kept.'),
  sets: z.array(CanonicalOptionSet).describe('What the option changes. [] for "carry on as now".'),
  status: z.enum(OPTION_STATUSES).describe('live: compared. ruled_out: the person rules it out but keeps it in view. removed: taken out of the comparison.'),
  developed_from: id.nullable().describe('The id of the option this is a variant of. A record, not a cause. Null otherwise.'),
  ...attribution,
}).strict();
export type CanonicalOptionT = z.infer<typeof CanonicalOption>;

export const CanonicalRisk = z.object({
  id,
  label: z.string().describe('A short title for a possible future downside stated or clearly implied by the brief ("Oven breaks down"). One risk record per distinct downside, even when unsized; never a condition labelled risk or something already true.'),
  occurrence: id.describe('A coefficient quantity in unit "1" or "%": the chance the event happens at least once over the whole model horizon. Unknown is valid: reference an unknown coefficient with null figures, never invent a probability.'),
  severity: id.describe('A quantity: what it does IF it happens, drawn only when it does. In the affected quantity\'s unit for add; unit "1" for multiply. Unknown is valid: reference an unknown coefficient with null figures, never invent a loss.'),
  effect_on: id.describe('The quantity it changes.'),
  mode: z.enum(['add', 'multiply']).describe('add: severity is added to the quantity. multiply: the quantity is multiplied by severity.'),
  starts_after_periods: timing,
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
    'prerequisite: a real-world requirement that must be met first ("only once the landlord agrees"), shown beside the result. challenge: a doubt worth raising, said beside the result. A possible future downside belongs in risks, even when its chance or size is unknown. A missing figure is never a condition: it is an asked quantity.'),
  concerns, ...attribution,
}).strict();

export const CanonicalLeftOut = z.object({
  id,
  text: z.string().describe('What matters but is not in the calculation.'),
  why: z.string().describe('Why it is left out, in one plain sentence.'),
  question: z.string().nullable().describe('The clarification or representable measure that would let this into the calculation, as one question; null when none would.'),
  concerns, ...attribution,
}).strict();

export const CanonicalHistoryEntry = z.object({
  id: z.string().describe('The id of the record that changed.'),
  change: z.enum(['superseded', 'withdrawn']),
  old: z.string().describe('The earlier record, as JSON text, so a correction never loses what it replaced.'),
  quote: attribution.quote,
  author_id: attribution.author_id,
  approved_by: z.string().nullable().describe('Set by Olumi\'s host: which person approved this change; null when not known.'),
}).strict();

// ── The model ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const PERIOD_UNITS = ['week', 'month', 'year'] as const;

export const CanonicalModel = z.object({
  version: z.enum([CANONICAL_VERSION]),
  question: z.string().describe('What is being reasoned about, in one plain sentence.'),
  title: z.string().nullable().describe('A short title of a few words for the situation, the name on its board ("Second oven or wholesale?"). Never empty.'),
  period: z.enum(PERIOD_UNITS).describe('The model\'s time step, which windows and stocks count in. Period 0 is now.'),
  quantities: z.array(CanonicalQuantity),
  relations: z.array(CanonicalRelation).describe('First draft: each option reaches the goal through as few named links as faithfully express it, usually one or two. No dummy links; no derived totals beyond what one goal or limit needs.'),
  goals: z.array(CanonicalGoal),
  limits: z.array(CanonicalLimit),
  preferences: z.array(CanonicalPreference),
  options: z.array(CanonicalOption),
  risks: z.array(CanonicalRisk).describe('Every distinct stated or clearly implied future downside, with stated versus Olumi-inferred authorship kept separate. When simplifying, keep supported risks, re-expressed more simply; follow an explicit correction or retraction. Unsized never means absent.'),
  claims: z.array(CanonicalClaim),
  evidence: z.array(CanonicalEvidence),
  assumptions: z.array(CanonicalAssumption),
  dissent: z.array(CanonicalDissent),
  conditions: z.array(CanonicalCondition),
  left_out: z.array(CanonicalLeftOut),
  coaching_questions: z.array(z.string()).describe(
    'Ordered first-screen questions, up to three, each plain, non-leading, open and asking one thing; a selected item question uses its exact wording. [] when none would help.'),
  history: z.array(CanonicalHistoryEntry).describe('Kept by Olumi\'s host: [] in a first draft.'),
}).strict().describe('One statement, one record across all families; never paraphrase it into another. Evidence and assumptions get separate records only for distinct statements.');
export type CanonicalModelT = z.infer<typeof CanonicalModel>;

/** The record families a `concerns` list (or an error's `items`) can name, in display order. */
export const QUALITATIVE_FAMILIES = ['claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out'] as const;
export type QualitativeFamilyT = (typeof QUALITATIVE_FAMILIES)[number];
