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
 *  · every number is a NAMED quantity with a unit, an author and a status; no bare literals. A factor no one can measure yet
 *    has unit null (Box 1a, Q1 28 Oct): no scale, never executed, unknown or asked;
 *  · a quantity's author is the person (their words, quoted), Olumi (an estimate: always low AND high) or STRUCTURE (an exact
 *    constant that defines the model: a unit conversion, a 0/1 switch, a count; never shown as an Olumi estimate);
 *  · a quantity is a FACT (the person's own situation) or a COEFFICIENT (a mechanism's size). A figure the calculation needs that
 *    they did not give may be Olumi's estimate (Paul, 28 Oct: AI knowledge used, never hidden): author olumi, status estimated,
 *    always ranged, its basis what is typical for situations like theirs; their aims, targets, limits and choices never are;
 *  · a figure only the person can give and did not is `asked` (null + a question). Asking is a legitimate, successful outcome:
 *    it withholds only what that figure feeds, and the compiler never removes it or gives it a value;
 *  · relations are canonical forms only: a definition (a signed SUM, or a PRODUCT of powers ±1: difference, ratio and mixed
 *    signs in one op), an effect (base + Σ coefficient × driver, each coefficient an uncertain mechanism size in natural units)
 *    or a stock (start, inflows, outflows per period). An exact identity is a definition, never an effect. A causal claim no
 *    figure sizes is an INFLUENCE, a link in words (Box 1a): drawn, never calculated, and what it reaches is withheld;
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

const id = z.string().describe('Stable lowercase snake_case id, unique across record families; reuse it for the same record in an edit.');
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
    'Who introduced this assertion: person for verified human content, including reported speech, uncertainty or a question; olumi for additions or interpretations. Keep added interpretation separately attributed; certainty and approval do not determine origin.'),
  party: z.string().nullable().describe(
    'When the person reports someone else\'s statement ("our accountant says"): that someone, as written. Null otherwise.'),
  quote: z.string().nullable().describe(
    'One unbroken verbatim human span supporting person content; preserve its qualifiers. Null for olumi or structure. Olumi instructions, labels and compiler feedback are not human source words.'),
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
 * own situation (their price, costs, headcount, dates, members today). A coefficient is a mechanism's size (how much a driver
 * moves what it drives, a rate, a share), and it stays a coefficient even when it is worked out from other quantities. A
 * derived quantity that is not a link's size is neither: it is derived (worked out by its relation). Either figure, when they
 * did not give it, may be Olumi's estimate, labelled and ranged (Paul, 28 Oct, superseding "a missing fact is asked, never
 * estimated"); a target, limit or choice of theirs is asked, never estimated.
 */
export const QUANTITY_KINDS = ['fact', 'coefficient', 'derived'] as const;
export type QuantityStatusT = (typeof QUANTITY_STATUSES)[number];
/** The statuses whose figure is in hand: the only ones that reach the executable model as a value or range. */
export const FIGURE_STATUSES: ReadonlySet<QuantityStatusT> = new Set(['known', 'estimated']);
/** The statuses that withhold every goal they feed, with a reason (never an invented figure). */
export const WITHHOLDING_STATUSES: ReadonlySet<QuantityStatusT> = new Set(['unknown', 'unsupported']);

export const UNIT_RULES = 'Singular units; GBP, USD, EUR or their currency symbols; 1 for a pure number or probability; % for percent, with 20 meaning 20%. Slash terms are denominators; no k or m multipliers. Coefficient unit times driver unit equals the output unit: (USD/day)/(task/hour) is USD hour/day/task.';

/**
 * WHAT A RANGE MEANS (PL ruling B): read from the words, never assumed. bounds: the ends are hard; plausible: a rough span.
 * A person's range whose words do not say which is an UNRESOLVED reading: asked, never guessed.
 */
export const RANGE_KINDS = ['bounds', 'plausible'] as const;
const RANGE_KIND = z.enum(RANGE_KINDS).nullable().describe(
  'bounds for explicitly hard endpoints; plausible for explicitly rough endpoints or Olumi\'s provisional uncertainty range. For an approximate point, retain the stated value with low/high/range_kind null. When a human range\'s meaning is unresolved, keep the endpoints in quote and leave execution asked; do not invent its interpretation.');

/** A date or a span the person states, as the AI reads it; Olumi's host counts it in the model's periods (`stated-time.ts`). */
const StatedTime = z.object({
  date: z.string().nullable().describe('YYYY-MM-DD: your reading of a date they state ("by the end of March" read against today). Null for a span.'),
  span: z.number().nullable().describe('A length of time they state, in its own unit ("six weeks": 6). Null for a date.'),
  unit: z.enum(['day', 'week', 'month', 'year']).nullable().describe('The span\'s unit as they state it. Null for a date.'),
  said_on: z.string().nullable().describe('YYYY-MM-DD: the day this date or span was said, which a span is counted from. Leave it null for a date or span stated in this message; keep the saved said_on when you return a record whose time is not restated. Olumi fills it in.'),
}).strict().nullable().describe('A supplied date as {date: YYYY-MM-DD, span: null, unit: null, said_on}, or span as {date: null, span: number, unit: day|week|month|year, said_on}, for a window length or timing/origin offset. Preserve the original quote and span unit. Leave value null; the host counts model periods and writes the basis. Null for quantities without a stated date or span, and for an immediate start represented directly as 0. Do not compute period counts or implied spans.');

export const CanonicalQuantity = z.object({
  id,
  label: z.string().describe('A short plain name the person would recognise ("Loaves sold per week").'),
  unit: z.string().nullable().describe(`${UNIT_RULES} Use the supported unit even when the value is unknown. For a time quantity with stated_time, use the model period for host-counted execution and preserve the supplied time unit inside stated_time and quote. Null only when no supported measurement unit exists, with status asked or unknown; never invent a scale.`),
  value: z.number().nullable().describe('The figure in this unit; an Olumi estimate\'s most likely figure lies inside its plausible range, or is null if unsupported. Null when no figure, for a derived quantity, or when stated_time is present for host counting.'),
  low: z.number().nullable().describe('The low end of a stated or estimated range, in the unit. Null when not a range.'),
  high: z.number().nullable().describe('The high end of a stated or estimated range, in the unit. Null when not a range.'),
  range_kind: RANGE_KIND,
  floor: z.number().nullable().describe('Olumi\'s justified physical or mathematical lower domain in this unit; null without support from the quantity\'s explicit meaning. A signed change is not a nonnegative level. Never infer a bound from a label alone or use a target, budget or uncertainty endpoint as the domain.'),
  ceiling: z.number().nullable().describe('Olumi\'s justified physical or mathematical upper domain in this unit; null without support from the quantity\'s explicit meaning. Never infer a bound from a label alone or use a target, budget or uncertainty endpoint as the domain.'),
  kind: z.enum(QUANTITY_KINDS).describe(
    'fact: a figure about their situation, including observed shares, mixes and allocations. coefficient: a causal response per unit of driver, still a coefficient when derived. derived: a quantity worked out by its relation that is not a link\'s size. Structural constants are facts.'),
  status: z.enum(QUANTITY_STATUSES).describe(
    'known: a supplied or exact figure, including stated_time awaiting host counting. estimated: a missing fact or coefficient responsibly estimated by Olumi, with plausible low/high and basis; the roughly eight-in-ten range is a provisional uncertainty assumption, not observed calibration. asked: a missing personal target, limit, budget, deadline or choice, an unresolved range interpretation, or an answerable input with no responsible estimate; numeric fields null and question required. derived: computed by one relation, numeric fields null. unknown: no responsible range or answer yet, numeric fields null. not_applicable: unused here. unsupported: not expressible by the supported forms, numeric fields null. A supplied approximate point remains known, not Olumi\'s estimate.'),
  question: z.string().nullable().describe('For asked, the one plain question that resolves this item\'s missing figure or meaning. Never ask for a span the supplied dates imply. Null otherwise.'),
  stated_time: StatedTime,
  basis: z.string().nullable().describe(
    `For a human approximate point, exactly: "${APPROXIMATE_FIGURE}" For estimated, name the credible reference class and context without inventing observations. For structure, explain the exact constant. For unknown, not_applicable or unsupported, say why and what would resolve it. For stated_time, null on model output; the host supplies the count and its basis. Otherwise null unless explaining a supported reading of human words.`),
  direction: z.enum(['raises', 'lowers']).nullable().describe(
    'For an unsized coefficient: raises or lowers only when the causal direction is supported; null if unknown or the uncertainty crosses zero. Null for a sized coefficient or other quantity.'),
  author: z.enum(QUANTITY_AUTHORS).describe(
    'person for their supplied figure, date, span or uncertainty; olumi for an added estimate or interpretation; structure only for necessary exact mathematical constants with a known point and no range. A structural zero may mean no added activity, never an unknown current level. Retain a stated time\'s human quote; place any added calendar convention on a separate Olumi assumption.'),
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
  base: id.describe('The output level when every driver is zero, in the output unit. Use a supported reference; it is not automatically today\'s level, especially on a continuation.'),
  terms: z.array(EffectTerm),
  ...attribution,
}).strict().describe('defines = base + Σ coefficient × driver, for a MECHANISM of uncertain size ("each extra oven adds about 150 loaves a week"). An exact identity is a definition, never an effect.');

const StockRelation = z.object({
  form: z.enum(['stock']),
  id,
  defines: id,
  start: id.describe('The quantity giving the stock level at the saved model\'s period 0, in the stock unit; not automatically today\'s level on a later turn.'),
  inflows: ids.describe('Quantities added each model period, in stock units per model period; one-off amounts belong in the start or a separate once-counted total.'),
  outflows: ids.describe('Quantities removed each period, in the stock\'s unit per period (a stock × a rate per period is such a flow).'),
  ...attribution,
}).strict().describe('A level that carries over: next period\'s level = this period\'s + inflows − outflows.');

/** Box 1a (Q1, 28 Oct): which way a link in words moves what it points at, and how sure it is (never who said it). */
export const INFLUENCE_DIRECTIONS = ['up', 'down', 'unknown', 'conditional', 'disputed'] as const;
export const CONFIDENCES = ['likely', 'unsure', 'unknown'] as const;
const InfluenceRelation = z.object({
  form: z.enum(['influence']),
  id,
  from: id.describe('The option, quantity or risk that moves it.'),
  to: id.describe('The quantity, goal or limit it moves.'),
  direction: z.enum(INFLUENCE_DIRECTIONS).describe('up: more of from (or choosing it) means more of to; down: less. unknown: no one can say which way. conditional: it depends; disputed: people disagree (the basis, conditions or dissent say how).'),
  confidence: z.enum(CONFIDENCES).describe('How sure the link is: likely, unsure or unknown.'),
  basis: z.string().nullable().describe('What supports this causal claim or reading, in plain words, with uncertainty retained. Null if no basis is available; never invent supporting evidence.'),
  ...attribution,
}).strict().describe('A causal claim in words that no figure sizes ("evening classes lift how members feel"). Never calculated; what it reaches is withheld.');

export const CanonicalRelation = z.union([SumDefinition, ProductDefinition, EffectRelation, StockRelation, InfluenceRelation]);
export type CanonicalRelationT = z.infer<typeof CanonicalRelation>;
export type SumDefinitionT = z.infer<typeof SumDefinition>;
export type ProductDefinitionT = z.infer<typeof ProductDefinition>;
export type EffectRelationT = z.infer<typeof EffectRelation>;
export type StockRelationT = z.infer<typeof StockRelation>;
export type InfluenceRelationT = z.infer<typeof InfluenceRelation>;
/** The relations the engine calculates: every form but the link in words. */
export type NumericRelationT = Exclude<CanonicalRelationT, InfluenceRelationT>;
export const isInfluence = (r: CanonicalRelationT): r is InfluenceRelationT => r.form === 'influence';

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
  origin_event: z.string().nullable().describe('Null for a window from the saved model\'s period 0; otherwise the event it starts from, in the supplied words.'),
  origin_offset: id.nullable().describe('For an event origin, the id of its timing quantity relative to the saved period 0. Keep supplied time in that quantity\'s stated_time; ask only for genuinely missing timing. Null for a window from period 0.'),
  start: z.number().int().describe('Whole model periods after the origin before the window opens; 0 opens at the origin. For explicit ordinal positions, position n opens after n minus one periods; this is positional indexing, not calendar conversion. Do not calculate a calendar offset here. A stated date or span belongs on a referenced time quantity, with a suitable origin.'),
  periods: id.describe('Id of the quantity giving the window length in model periods. Preserve a supplied date or span in that quantity\'s stated_time and leave its value for the host. Ask By when? only when timing is genuinely missing; never re-ask a span implied by supplied dates. A date on a window that opens later is counted by the host from the window\'s opening.'),
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
    target: id.describe('Id of the person\'s target quantity: measured-output units for level or absolute change, % or 1 for relative change; account for per and sum. A missing target is asked, never estimated.'),
    frame: z.enum(GOAL_FRAMES).describe(
      'level: the quantity itself reaches the target ("revenue next year over 60,000 GBP" is a level, summed over the window). '
      + 'change_abs: its change from the reference, in its own unit ("grow takings by 500 GBP a month"). '
      + 'change_rel: its change from the reference as a fraction of the reference, the target in "%" or "1" ("grow takings by 12 %").'),
    reference: z.object({
      kind: z.enum(REFERENCE_KINDS).describe('now: the level at saved period 0 before options; option: the named option on the same draws; value: a supplied reference quantity. Carrying on does not itself prove a reference stays constant.'),
      option: id.nullable().describe('For option: the option id. Null otherwise.'),
      quantity: id.nullable().describe('For value: the quantity holding the reference, in the measured quantity\'s unit. Null otherwise.'),
    }).strict().nullable().describe('Null for a level. For a change: what it is a change from.'),
    aggregation,
    window: CanonicalWindow.nullable().describe('Null for a static level with no deadline ("keep the margin above 20 %"). A level that changes over time needs a window.'),
    measure_by: z.enum(AUTHORS).describe('Who named the measure: person, or olumi for a suggested measure; this does not change the aim\'s author.'),
    assumptions: ids.describe('Ids of assumption records this reading of the goal rests on; [] for none.'),
    exclusions: ids.describe('Ids of left_out records for parts of the aim this measure does not cover ("the café\'s cosy feel is not in this chance"). [] when it covers the whole aim.'),
  }).strict().nullable().describe('Null when no supported measure exists; retain the aim and ask what would count as success. A proposed standard or release bar is not a substitute for the aim\'s measure.'),
  question: z.string().nullable().describe('For an unmeasured aim, one plain question defining success. A missing timing or target question belongs on its quantity; do not duplicate it here. Null otherwise.'),
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
    bound: id.describe('Id of the person\'s limit quantity in the measured output\'s units, including per or sum where applicable. A missing bound is asked, never estimated.'),
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
export const STARTS_AFTER_PERIODS = 'Whole model periods elapsed before taking effect: 0 is immediate';
const timing = z.union([z.number().int(), id]).describe(`${STARTS_AFTER_PERIODS}. For an explicit ordinal model-period position, use one fewer elapsed periods; otherwise use an explicit elapsed count or the id of a timing quantity. Store a supplied date or span on that quantity's stated_time and leave counting to the host; do not derive a period count. Do not encode an immediate start as a positive duration.`);
/** The old fields, mapped ONCE, where a saved model is read (program-store): `from_period` k is `starts_after_periods` k, the
 *  same count under its old name. Missing quantity direction and physical bounds read as null, without inferring them, and
 *  so does a missing approved_by on a record, a link or a history entry (C6): an earlier approver stays where it was saved.
 *  A model saved before titles reads with no title (null) and no coaching questions ([]). A model saved before Box 1a reads
 *  with no carry-on declared on any option (false: no claim, never inferred from its settings or name) and each risk's
 *  direction unknown. A model saved before stated time reads with none on any quantity and no decide-by date (null); a
 *  stated time saved before said_on reads with said_on null.
 *  A model that has both timing names, or neither, is left for the schema to judge. */
export function withDeclaredTiming(raw: unknown): unknown {
  const rec = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  const renamed = (x: unknown) => { if (!rec(x) || !('from_period' in x) || 'starts_after_periods' in x) return x; const { from_period, ...rest } = x; return { ...rest, starts_after_periods: from_period }; };
  if (!rec(raw) || !Array.isArray(raw['options']) || !Array.isArray(raw['risks'])) return raw;
  // A stated time saved before said_on (PL 14:12Z) reads with none: the day it was said, not kept, is never guessed.
  const said = (t: unknown) => (rec(t) && !('said_on' in t) ? { ...t, said_on: null } : t);
  const declaredQuantity = (x: unknown) => (rec(x) ? { direction: null, floor: null, ceiling: null, stated_time: null, ...x, ...('stated_time' in x ? { stated_time: said(x['stated_time']) } : {}) } : x);
  const approver = (x: unknown): unknown => (Array.isArray(x) ? x.map(approver) : !rec(x) ? x
    : Object.fromEntries([...Object.entries(x).map(([k, v]) => [k, approver(v)] as const), ...('approval' in x && !('approved_by' in x) ? [['approved_by', null] as const] : [])]));
  const read = { ...raw, ...('title' in raw ? {} : { title: null }), ...('decide_by' in raw ? {} : { decide_by: null }), ...('coaching_questions' in raw ? {} : { coaching_questions: [] }),
    ...(Array.isArray(raw['quantities']) ? { quantities: raw['quantities'].map(declaredQuantity) } : {}),
    options: raw['options'].map((o) => (rec(o) && Array.isArray(o['sets']) ? { carry_on: false, ...o, sets: o['sets'].map(renamed) } : o)),
    risks: raw['risks'].map((k) => renamed(rec(k) ? { direction: 'unknown', ...k } : k)) };
  return Object.fromEntries(Object.entries(read).map(([k, v]) => [k, !Array.isArray(v) ? v : k === 'history'
    ? v.map((h) => (rec(h) && !('approved_by' in h) ? { ...h, approved_by: null } : h)) : approver(v)]));
}

export const CanonicalOptionSet = z.object({
  quantity: id.describe('The input quantity this option changes; its current value may be asked or unknown. Preserve that missing baseline rather than inventing zero. Change a stock through its start or flows, not by setting its accumulated level.'),
  to: id.nullable().describe('A named quantity holding the proposed setting, required for Olumi estimates, approximate human points or time wording needing their own basis or stated_time. Null for an exact inline setting, an explicitly interpreted human range, or an unanswered inline setting.'),
  value: z.number().nullable().describe('With to null: this option\'s own value for the quantity, in its unit ("raise the price to 3.50": 3.5; switched on: 1). Null otherwise.'),
  low: z.number().nullable().describe('With to null: the low end of this option\'s own value, when a range. Null otherwise.'),
  high: z.number().nullable().describe('With to null: the high end of this option\'s own value, when a range. Null otherwise.'),
  range_kind: RANGE_KIND,
  question: z.string().nullable().describe('With to null and no figure: the one question to the person for this option\'s value. Null otherwise.'),
  starts_after_periods: timing,
  author: z.enum(QUANTITY_AUTHORS).describe('Who proposed this setting: person for their own specified intervention; olumi for Olumi\'s proposed setting, even when to names their figure; structure only for a necessary mathematical off/on switch. This is separate from the source of the setting\'s numerical value.'),
  quote: attribution.quote,
}).strict().describe('A setting: either a quantity id in to or its own inline figure or range. Inline values compile into named quantities.');
export type CanonicalOptionSetT = z.infer<typeof CanonicalOptionSet>;

export const CanonicalOption = z.object({
  id,
  label: z.string().describe('A short neutral name ("Second oven").'),
  sets: z.array(CanonicalOptionSet).describe('Numerical input changes made by this option. Preserve supported stated effects as settings on the inputs they change, with conditions intact. [] means no numerical setting, including a carry-on option that changes nothing; it does not require an invented influence or imply an unchanged future outcome.'),
  status: z.enum(OPTION_STATUSES).describe('live: compared. ruled_out: the person rules it out but keeps it in view. removed: taken out of the comparison.'),
  developed_from: id.nullable().describe('The id of the option this is a variant of. A record, not a cause. Null otherwise.'),
  carry_on: z.boolean().describe('true only for the option of carrying on as now; false for every other.'),
  ...attribution,
}).strict();
export type CanonicalOptionT = z.infer<typeof CanonicalOption>;

export const CanonicalRisk = z.object({
  id,
  label: z.string().describe('A short title of a few words for an event that may or may not happen, for its card ("Oven breaks down"). Never something already true.'),
  occurrence: id.nullable().describe('A coefficient quantity in unit "1" or "%": the chance the event happens at least once over the whole model horizon. Null when no one can say yet.'),
  severity: id.nullable().describe('A quantity: what it does IF it happens, drawn only when it does. In the affected quantity\'s unit for add; unit "1" for multiply. Null when no one can size it yet.'),
  effect_on: id.describe('The quantity it changes; or, when it cannot be sized, the goal, limit or option it bears on.'),
  direction: z.enum(['up', 'down', 'unknown']).describe('Which way it moves effect_on if it happens: up, down or unknown.'),
  mode: z.enum(['add', 'multiply']).nullable().describe('add: severity is added to the quantity. multiply: the quantity is multiplied by severity. Null unless it is sized: a chance and a severity on a quantity.'),
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
    'prerequisite: a real-world requirement that must be met first ("only once the landlord agrees"), shown beside the result. challenge: a doubt worth raising, said beside the result. A missing figure is never a condition: it is an asked quantity.'),
  concerns, ...attribution,
}).strict();

export const CanonicalLeftOut = z.object({
  id,
  text: z.string().describe('What matters but is not in the calculation.'),
  why: z.string().describe('Why it is left out, in one plain sentence.'),
  question: z.string().nullable().describe('The clarification or representable measure that would let this into the calculation, as one question; null when none would.'),
  concerns, ...attribution,
}).strict();

/**
 * D074 (C6, "Source quote, contributor and approval actor stay distinct"): `entered` is the host's own record that the person
 * typed this record's figure on the canvas (`program-tools.ts` applyCanvasFigure), so that change gave it its present words,
 * the figure as entered; the projection reads a canvas figure's origin from this entry alone (`project.ts`), never from its
 * words. A goal's target split off from a figure it shared is a record that edit MADE: its entry's `old` is "null", the JSON of
 * no record, never a predecessor it did not have. Host-owned, like all of history: in neither schema the drafter is sent.
 */
export const CanonicalHistoryEntry = z.object({
  id: z.string().describe('The id of the record that changed.'),
  change: z.enum(['superseded', 'withdrawn', 'entered']).describe(
    'superseded: an approved change replaced the record; withdrawn: an approved removal took it out; entered: the person typed its figure on the canvas.'),
  old: z.string().describe('The earlier record, as JSON text, so a correction never loses what it replaced; "null" when the change made the record (a goal\'s own target split off by a figure typed on the canvas).'),
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
  period: z.enum(PERIOD_UNITS).describe('The supported time step chosen from supplied figures and mechanisms: week, month or year. Period 0 is the saved draft origin, not reset to today on continuation. The host counts stated_time; the AI does not convert dates or spans to periods.'),
  quantities: z.array(CanonicalQuantity),
  relations: z.array(CanonicalRelation),
  goals: z.array(CanonicalGoal),
  limits: z.array(CanonicalLimit),
  preferences: z.array(CanonicalPreference),
  options: z.array(CanonicalOption),
  risks: z.array(CanonicalRisk),
  claims: z.array(CanonicalClaim),
  evidence: z.array(CanonicalEvidence),
  assumptions: z.array(CanonicalAssumption),
  dissent: z.array(CanonicalDissent),
  conditions: z.array(CanonicalCondition),
  left_out: z.array(CanonicalLeftOut),
  coaching_questions: z.array(z.string()).describe(
    'Up to three ordered, useful unresolved questions, each naming its card and asking one thing without leading or anchoring on Olumi\'s estimate. Use a selected item question verbatim. [] if none helps.'),
  decide_by: z.object({
    date: z.string().nullable().describe('YYYY-MM-DD: always Olumi\'s reading of the quote, never their words ("mid-November" read as 2026-11-15 is Olumi\'s), or null when no calendar date can be read.'),
    quote: z.string().nullable().describe('Their words saying when, exactly, kept apart from the date read from them.'),
  }).strict().nullable().describe('When the person must decide, separate from any outcome deadline, as {date: YYYY-MM-DD|null, quote: verbatim human span|null}; the date is always Olumi\'s reading of the quote. Null when absent; retain unresolved date wording in quote with date null. Do not compute it from a duration or use it as a success measure.'),
  history: z.array(CanonicalHistoryEntry).describe('Kept by Olumi\'s host: [] in a first draft.'),
}).strict().describe('One provisional Living Model, including its qualitative reasoning and optional calculable subset. Represent each distinct assertion once; a source span may support distinct records, and an arithmetic relation or source quantity is not a duplicate of the aim it supports. Reuse ids rather than paraphrase assertions into extra notes.');
export type CanonicalModelT = z.infer<typeof CanonicalModel>;

/** The record families a `concerns` list (or an error's `items`) can name, in display order. */
export const QUALITATIVE_FAMILIES = ['claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out'] as const;
export type QualitativeFamilyT = (typeof QUALITATIVE_FAMILIES)[number];
