/**
 * THE LIVING MODEL (thin core, 20 Oct 2026). The AI's own complete model of the person's reasoning, emitted whole as
 * strict tool arguments and saved beside the graph it compiles to (`GraphV3.living_model`). The graph the engine runs
 * on is a VIEW regenerated from this on every revision; nothing here is re-read from the graph.
 *
 * The shape is the 18 Oct bake-off arm's (`redteam/armB/SYS.md`: 99–100 % of facts kept, 10/10 corrections), with a
 * frozen `id` on every item so regeneration never renumbers an entity or orphans a Run, and the engine's fields.
 *
 * Attribution is a LABEL, never a gate. `source` says who asserted the item; `quote` holds the person's exact words for
 * a user or party item. A user or party item whose quote is not found verbatim is saved as `unverified`, never as
 * Olumi's. Every field is present (null when not stated) so the schema is valid as OpenAI strict tool arguments.
 */
import { z } from 'zod-v4';

export const LIVING_MODEL_SOURCES = ['user', 'party', 'olumi', 'unverified'] as const;
export const LivingSource = z.enum(LIVING_MODEL_SOURCES);
export type LivingSourceT = z.infer<typeof LivingSource>;

/**
 * A living-model id IS the node or edge id it compiles to; the kernel makes it canonical (`CANONICAL_ID_REGEX`). Strict tool
 * schemas carry no string patterns, so the id is normalised there, not checked here.
 */
const id = z.string();

const attribution = {
  source: LivingSource.describe(
    "Who asserted this: user = the person's own statement; party = someone the person reports (named in `party`); olumi = Olumi's own addition or estimate; unverified = said to be someone's, without their exact words."),
  /** For `party`: the person or body the user reports, as written. Null otherwise. */
  party: z.string().nullable().describe('For party: the person or body exactly as the user names them, word for word. Null otherwise.'),
  /** The person's exact words for a user or party item. Null for Olumi's own items. */
  quote: z.string().nullable().describe("The person's exact words that state this item, copied verbatim. Null for Olumi's own items."),
};

/**
 * Per-figure authorship (DL 21 Oct, buddy SIMPLER): Olumi's provisional estimate of a WHOLLY missing figure on an item the
 * person or a party named. The item keeps its source and quote; only this figure is Olumi's. Track 3 candidate 2: all 22
 * Q2 factors were the person's with no level, so nothing could be worked out, and the schema could not say "your factor,
 * Olumi's starting estimate". A saved model without it reads null: unchanged.
 */
const estimateBy = z.enum(['olumi']).nullable().default(null).describe(
  "'olumi' when Olumi supplies this WHOLE figure (value, range and unit) for an item the person or a party named without one: "
  + 'its provisional estimate, as wide as what is genuinely unknown. Null when the item\'s own source gave the figure, and on '
  + 'Olumi\'s own items (their source already says so). Never on or mixed with a figure the person or a party gave.');

/** A figure as stated: a point (`value`) or a range (`low`/`high`), never a range collapsed to its midpoint. */
const figure = {
  value: z.number().nullable(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  /** The unit as written ("tickets per week", "£", "%"); null when none was given, and for anything simply on or off. */
  unit: z.string().nullable().describe(
    'The unit as written ("tickets per week", "£", "%"). Null when none was given, except that Olumi\'s own estimate states its unit. Always null for something that is simply on or off, such as a step an option takes or not ("dual-sourcing in place"): it has no unit.'),
};

/** A figure Olumi may estimate on another's item (factor level, setting, link size): never the aim's target, which is asked for. */
const estimable = { estimate_by: estimateBy, ...figure };

/**
 * TRACK 2 identity (21 Oct): what a quantity IS, when it is defined as the sum or product of factors. A definition, not a
 * cause: the engine works it out exactly and never draws its parts. A model saved before reads null.
 */
const definedAs = z.object({
  op: z.enum(['sum', 'product']),
  of: z.array(id),
  subtract: z.array(id).min(1).nullable().optional().describe('Sum only: ids from of whose values are subtracted. For profit = revenue minus costs, of is [revenue, costs] and subtract is [costs]. Null for an all-positive sum or a product; an older saved definition may omit it. Only the stated or visibly Olumi-authored definition supplies a sign.'),
  /**
   * Who stated the definition itself, which can differ from who stated the quantity ("we need £6,500" vs "revenue is
   * customers × price"). A definition saved without it reads as unverified: said, but with no one's words for it.
   */
  source: attribution.source.default('unverified'),
  party: attribution.party.default(null),
  quote: attribution.quote.default(null),
}).strict().superRefine((d, ctx) => {
  if (d.subtract != null && (d.op !== 'sum' || new Set(d.subtract).size !== d.subtract.length || d.subtract.some((id) => !d.of.includes(id)))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subtract'], message: 'subtract requires distinct parts of a sum' });
  }
}).nullable().default(null).describe(
  'When this quantity IS the sum or product of factors ("total customers = UK + EU"; "revenue = customers × price per customer"): op, the factor ids, and who stated the definition (its quote is their words for the definition itself). A definition, not a cause, so add no links from those factors to it. '
  + 'Write the units so the parts\' units make the quantity\'s, in the person\'s meaning where the brief makes it plain: a sum\'s parts share the quantity\'s unit; for a product, the quantity\'s unit names its period when it has one ("£ per day" for daily revenue, not "£"), a price names the thing it is per ("£ per coffee", not "£ each"), a count names that same thing, and the period sits on exactly one part, wherever the person put it ("coffees per day" × "£ per coffee"; "customers" × "£ per customer per month"). This never changes the unit of a factor outside a definition. Null otherwise.');

export const LivingAim = z.object({
  id,
  text: z.string(),
  status: z.enum(['current', 'later', 'withdrawn']),
  target: z.object({
    /** The quantity the aim is about, as written. */
    quantity: z.string(),
    comparator: z.enum(['>=', '<=', '>', '<', '=', 'increase', 'decrease']).describe(
      ">= or <= for a level to reach; > when the person says over or more than; < when they say under or below; = for exactly; increase or decrease for a change from the baseline, `value` being the size of the change."),
    ...figure,
    by_when: z.string().nullable(),
    /** The goal's window in months (fractions allowed), ONLY when the person states a duration counted from today. A model saved before reads null. */
    period_months: z.number().nullable().default(null).describe(
      'The goal\'s window in months; fractions are allowed (3 weeks is 0.69), only when the person states a duration counted from today ("within 12 months" is 12, "over the next six months" is 6). Null for a calendar date ("by the end of September"): read it into period_deadline instead, with period_by olumi, and Olumi works out its window. Null for a period counted from a launch or any other event, or no deadline stated: never worked out or guessed.'),
    /**
     * ⭐ A CALENDAR DEADLINE IS OLUMI'S READING, LABELLED (DL 22 Oct): "by the end of September" fixes a date, not a duration, so its
     * window depends on the day it is read. The AI reads the date (`period_deadline`) and marks it Olumi's (`period_by`); the host
     * records the day it was read (`period_read_on`, `calendar-reading.ts`); the mapper works out the months between them, never
     * the AI. A model saved before reads all three as null.
     */
    period_by: z.enum(['olumi']).nullable().default(null).describe(
      '\'olumi\' when by_when is a calendar date ("by the end of September", "by 15 June next year"): you read the date it fixes into period_deadline. Null otherwise.'),
    period_deadline: z.string().nullable().default(null).describe(
      'With period_by olumi: the calendar date by_when fixes, as YYYY-MM-DD, read from today\'s date in your state ("by 15 June next year" read on 22 October 2026 is 2027-06-15; "by the end of September" is 2027-09-30). Null otherwise.'),
    period_read_on: z.string().nullable().default(null).describe(
      'The day Olumi read the date, as YYYY-MM-DD. Olumi records it: keep a saved one unchanged; null for a new reading.'),
    /** The reference the target is measured from, as written ("today", "last quarter"); null when none. */
    baseline: z.string().nullable(),
    /** The quantity's current level, in the target's unit, when stated. Unknown is null, never 0. */
    current: z.number().nullable().describe("Today's level of the quantity, in the target's unit, when stated. Unknown is null, never 0."),
    /** 'user' only when the person set today's level themselves (a canvas edit); otherwise null: the aim's attribution covers it. */
    current_source: z.enum(['user']).nullable(),
    /** Today's level's own unit when it differs from the target's ("+10%" on "£ per month"). A model saved before reads null. */
    current_unit: z.string().nullable().default(null).describe(
      "The unit today's level is in, when it differs from `unit` (a change of \"10 %\" on revenue in \"£ per month\" has unit \"%\" and current_unit \"£ per month\"). Null when they are the same."),
    /** For increase/decrease: what the change's figure means. Declared, never guessed; a model saved before reads null. */
    change_kind: z.enum(['absolute', 'relative', 'points']).nullable().default(null).describe(
      'For increase or decrease only: absolute = the change in the quantity\'s own unit; relative = a percentage of today\'s level; points = percentage points of a quantity that is itself a percentage (its unit is "%"). Null for a level target.'),
    /**
     * Who chose the MEASURE (Track 3 Q2 s1 0/8; buddy AMEND 21 Oct): 'olumi' when the person stated an aim without one and Olumi
     * suggests how to measure it. The aim's own text, source and quote stay the person's; a suggested measure never carries a
     * figure the person did not give (the mapper holds one). A model saved before reads null.
     */
    source: z.enum(['olumi']).nullable().default(null).describe(
      "'olumi' when the measure is your suggestion for an aim they stated without one (the aim stays theirs); null when they named the measure. Your suggestion keeps every figure null; once they give a figure or confirm the measure, set null."),
  }).strict().nullable().describe(
    // Track 3 E2E, 21 Oct: 12 of 13 aims drafted from briefs without figures had no target, so the person's figure had no place to go.
    'For a measurable quantity the person named for this aim, give its target even without a figure: leave every figure they did not state null (never invent one) and keep any deadline they gave. When they named none but a measure would serve the aim, suggest one as yours (source olumi): its quantity, usual unit and comparator, every figure null. Null when no measure would serve: a deadline alone never makes one.'),
  defined_as: definedAs,
  ...attribution,
}).strict();

export const LivingFactor = z.object({
  id,
  label: z.string(),
  /** TRACK 2 (21 Oct): a result other factors lead to, drawn as an outcome on the goal's path. A model saved before reads factor. */
  kind: z.enum(['factor', 'outcome']).default('factor').describe(
    'outcome for a result that other factors lead to and that in turn moves the aim ("customer satisfaction", "staff turnover"); factor for everything else, including anything an option sets.'),
  /** The factor's current level, when known. */
  ...estimable,
  /**
   * Paul's served test (21 Oct, 31711a9): with no rule here, every Olumi factor came back with no level, so nothing could be
   * worked out. Olumi completes its OWN items, labelled as its own; a person's missing figure stays null and is asked for.
   */
  value: figure.value.describe(
    "Today's level of this factor, in its unit: one figure here, or a range in low and high (value then null unless a central figure was given). "
    + "For the person's or a party's factor, the figures they gave; where they gave none, Olumi's provisional central estimate with a range, with estimate_by olumi, never mixed with theirs. "
    + "For Olumi's own factor (source olumi), give Olumi's central estimate in value, with low and high around it as wide as what is genuinely unknown, in a stated unit."),
  defined_as: definedAs,
  /** TRACK 2 (21 Oct): a limit beside the aim, sent as the legacy lane's limit row (one per quantity). Saved before: null. */
  limit: z.object({
    comparator: z.enum(['<=', '>=', '<', '>']),
    value: z.number(),
    ...attribution,
  }).strict().nullable().default(null).describe(
    'A limit the person must stay within on this quantity, beside the aim ("we cannot spend more than £30,000" on total cost is <= 30000), in this factor\'s unit, with who stated it. Never the aim itself. Null when there is none.'),
  /**
   * Host-set, like an aim's `current_source` (DL 22 Oct, Lenses' step 3): 'chat' when this figure is the person's own words
   * said in the conversation, not in the brief, saved by their approval, so the saved graph says it is their chat edit, never
   * the brief's. The kernel sets it (`kernel.ts`); what the AI sends is replaced. Absent (a model saved before) reads as null.
   */
  said_in: z.enum(['chat']).nullable().optional(),
  ...attribution,
}).strict();

export const LivingSetting = z.object({
  factor_id: id,
  ...estimable,
  ...attribution,
}).strict();

export const LivingOption = z.object({
  id,
  label: z.string(),
  /** What the option sets each factor to. An option with no settings changes nothing (the status quo). */
  settings: z.array(LivingSetting).describe(
    "The level the option sets each real quantity to, in that factor's unit (\"price to £12\"). Never a factor for the option itself being taken: choosing the option already says that, and its own effect on a quantity (\"adds 30\") is a link from the option. The only on or off setting is a step a risk's mitigation names, set to 1. An option with neither changes nothing (the status quo)."),
  /** TRACK 2 (21 Oct): the legacy option status. A ruled-out option stays in view and is not compared. Saved before: feasible. */
  status: z.enum(['feasible', 'infeasible', 'removed']).default('feasible').describe(
    'infeasible when the person rules the option out but keeps it in view ("B is not possible"); removed when they take it out of the comparison; feasible otherwise. Only feasible options are compared.'),
  /** TRACK 2 lineage (21 Oct): where the option came from. A record, never a cause: the engine never sees it. Saved before: null. */
  developed_from: id.nullable().default(null).describe(
    'The id of the option this one was developed from, when it is a variant or development of it ("a cheaper version of A"). A record of where it came from, not a cause: it changes no figure. Null otherwise.'),
  ...attribution,
}).strict();

/**
 * TRACK 2 event risk (21 Oct): an EVENT that may or may not happen within a window. What it does if it happens is an
 * ordinary link FROM it (per +1: it happening). Its chance and window are the item's own figures, attributed like any other.
 */
export const LivingRisk = z.object({
  id,
  label: z.string(),
  occurrence: z.object({ estimate_by: estimateBy, low: z.number().nullable(), high: z.number().nullable() }).strict().describe(
    'The chance it happens at least once within the window, from 0 to 1 ("5–15%" is low 0.05, high 0.15; one figure is low = high). For a risk the person or a party raised, the chance they gave; where they gave none, Olumi\'s provisional range with estimate_by olumi. For Olumi\'s own risk (source olumi), Olumi\'s provisional range. Each as wide as what is genuinely unknown.'),
  horizon_months: z.number().nullable().describe('The window that chance is over, in months ("within a year" is 12). Null when not stated, except Olumi\'s own window (horizon_by olumi on another\'s risk) when Olumi gives the chance.'),
  /** Per-figure authorship of the window (buddy: a chance is owned FOR its window; a supplied window is never replaced). */
  horizon_by: z.enum(['olumi']).nullable().default(null).describe(
    "'olumi' when Olumi supplies the window for a risk the person or a party raised without one. Null when its source gave it, and on Olumi's own risk."),
  mitigations: z.array(z.object({
    factor_id: id,
    reduction: z.number(),
    ...attribution,
  }).strict()).describe('Steps that make it less likely: the factor an option switches on, and the share of the chance it removes ("cuts it by 70%" is 0.7), with who said that share (its own words: the person may state the risk while Olumi proposes the step). The step is on or off, so its factor has no unit (null): its value is 0 today and 1 under an option that takes the step.'),
  ...attribution,
}).strict().describe(
  'An event that may or may not happen within a window ("our key supplier may fail within 12 months"). Never something already true: a present condition ("we lack marketing experience") is a factor at its current level, never a risk. What it does if it happens is a link from it.');

export const LivingLink = z.object({
  id,
  /** A factor id (or an option id for an option's direct effect). */
  from: id.describe('A factor id, or an option id when the person states that option\'s own effect on `to` ("Option A adds 30").'),
  /** A factor id or an aim id. */
  to: id.describe('A factor id or an aim id. An effect on the quantity an aim measures goes to that aim\'s id, never to a factor that restates the aim\'s own quantity.'),
  effect: z.object({
    /**
     * `normal`: an explicitly stated law, `value` its mean and `sd` its standard deviation, per +1 of `from`. An ordinary
     * range is not a law (AIE, 20 Oct): it stays a `range`.
     */
    form: z.enum(['point', 'exact', 'range', 'normal', 'direction_only', 'unknown']).describe(
      'point: a stated figure ("adds about 50"); exact: the person says it is exactly this, with no variation ("adds exactly 50"); '
      + 'normal: a stated Normal law, value its mean and sd its standard deviation; range: low to high, with value the source\'s own central figure: the person\'s when they give one, Olumi\'s for Olumi\'s own estimate ("about 20, between 10 and 30"), else null; direction_only: a sign with no size, only when `to` has no unit, `from` is a quantity with no unit, or the source gave a direction only (an option or a step simply on or off is +1 when in place, so its link has a size); unknown: direction is unstated or unresolved, with sign null.'),
    ...estimable,
    /**
     * The link's unit is the `to` item's own unit, exactly as that item writes it; "per +1 of `from`" is implied, so it is
     * never written here. The AI reads this description (the strict tool schema carries it), so it is the instruction.
     */
    unit: z.string().nullable().describe(
      "The unit of the `to` item's quantity, written exactly as that item writes its own unit (e.g. \"units\", \"£\"). The effect is always per +1 of `from`, so never add \"per …\". Null when `to` has no unit."),
    sd: z.number().nullable(),
    /**
     * The engine has no "unknown" direction, so an unsigned link is left out of the model the engine runs on (mapper
     * `link_sign_unknown`). On 21 Oct, every overnight core hiring draft held Olumi's own goal links unsigned, which cut
     * the goal off from its factors and left Run disabled. The AI reads this description, so it is the instruction.
     */
    sign: z.enum(['+', '-']).nullable().describe(
      "Which way `to` moves for each +1 of `from`: '+' raises it, '-' lowers it. For source olumi, give your provisional judgement of direction; use form direction_only only when `to` has no unit or `from` is a quantity with no unit (an option or an on-or-off step is +1 when in place), else give its size. For source user, party or unverified, preserve only the direction that source supplied. If none was supplied, use sign null and form unknown, then ask. Never put an Olumi-inferred direction under another source."),
  }).strict().describe("The change in `to` for each +1 of `from`, in the unit of `to`. For Olumi's own link (source olumi), when `to` has a unit and `from` has one or is an option or an on-or-off step (+1 when in place), give form range with Olumi's central estimate in value and low and high around it; else direction_only with its sign. For the person's or a party's link they gave no size, Olumi's provisional size the same way, with estimate_by olumi; its sign stays the one they gave."),
  ...attribution,
}).strict();

export const LivingCondition = z.object({
  text: z.string(),
  applies_to: z.array(z.string()).describe('The ids of the items (aims, options, factors, links) this condition qualifies.'),
  /**
   * What the condition does to a result that rests on these items (AIE 17:59 20 Oct), declared by the AI (meaning), applied by
   * the mapper (rule), never decided by source: a challenge is said beside it; an applied assumption carries a CONDITIONAL
   * result shown with it; an unresolved prerequisite withholds it. A model saved before roles reads every condition as unresolved.
   */
  role: z.enum(['challenge', 'assumption', 'prerequisite']).default('prerequisite').describe(
    'challenge: a question or doubt worth raising, said beside a result without changing it; '
    + 'assumption: a concrete modelling premise the result is actually worked out under, compatible with the stated figures, quantity and '
    + 'window, and said with the result ("assuming the trial effect is fully realised by the end of the quarter"); '
    + 'prerequisite: a requirement that must actually be met first, such as an approval, event or input ("only after supplier approval"), so a result resting on it cannot be computed yet. '
    + 'An open question about whether, how fully or how soon an effect happens is a challenge, or an assumption when the result is worked out under it; never a prerequisite. '
    + 'Decide by what it does to the calculation, never by who raised it.'),
  ...attribution,
}).strict().describe('A challenge, an applied assumption or an unresolved prerequisite about the listed items, with who raised it.');

export const LivingView = z.object({
  holder: z.string(),
  position: z.string(),
  quote: z.string().nullable(),
}).strict();

export const LivingHistoryEntry = z.object({
  /** The id of the item that changed. */
  id: z.string().min(1),
  change: z.enum(['superseded', 'withdrawn']),
  /** The earlier item, as JSON text, so a correction never loses what it replaced. */
  old: z.string(),
  quote: z.string().nullable(),
}).strict();

export const LivingModel = z.object({
  aims: z.array(LivingAim),
  options: z.array(LivingOption),
  factors: z.array(LivingFactor),
  links: z.array(LivingLink),
  /** A model saved before risks reads none. */
  risks: z.array(LivingRisk).default([]),
  conditions: z.array(LivingCondition),
  views: z.array(LivingView),
  history: z.array(LivingHistoryEntry),
}).strict();
export type LivingModelT = z.infer<typeof LivingModel>;
