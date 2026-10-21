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

/** A figure as stated: a point (`value`) or a range (`low`/`high`), never a range collapsed to its midpoint. */
const figure = {
  value: z.number().nullable(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  /** The unit as written ("tickets per week", "£", "%"); null when none was given. */
  unit: z.string().nullable(),
};

export const LivingAim = z.object({
  id,
  text: z.string(),
  status: z.enum(['current', 'later', 'withdrawn']),
  target: z.object({
    /** The quantity the aim is about, as written. */
    quantity: z.string(),
    comparator: z.enum(['>=', '<=', '=', 'increase', 'decrease']).describe(
      ">= or <= for a level to reach; = for exactly; increase or decrease for a change from the baseline, `value` being the size of the change."),
    ...figure,
    by_when: z.string().nullable(),
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
  }).strict().nullable(),
  ...attribution,
}).strict();

export const LivingFactor = z.object({
  id,
  label: z.string(),
  /** The factor's current level, when known. */
  ...figure,
  ...attribution,
}).strict();

export const LivingSetting = z.object({
  factor_id: id,
  ...figure,
  ...attribution,
}).strict();

export const LivingOption = z.object({
  id,
  label: z.string(),
  /** What the option sets each factor to. An option with no settings changes nothing (the status quo). */
  settings: z.array(LivingSetting).describe(
    "The level the option sets each factor to, in the factor's unit. An option's own effect on a quantity (\"adds 30\") is a link from the option instead. An option with neither changes nothing (the status quo)."),
  ...attribution,
}).strict();

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
      + 'normal: a stated Normal law, value its mean and sd its standard deviation; range: low to high, with value the person\'s own central figure when they give one ("about 20, between 10 and 30"), else null; direction_only: a sign with no size; unknown.'),
    ...figure,
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
      "Which way `to` moves for each +1 of `from`: '+' raises it, '-' lowers it. A link you add yourself (source olumi) always carries your best judgement of its direction, even with no size (form direction_only); it is shown as Olumi's, for the person to confirm or flip. Null only for the person's own link when they did not say which way it goes: then ask them that one question."),
  }).strict().describe('The change in `to` for each +1 of `from`, in the unit of `to`.'),
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
  conditions: z.array(LivingCondition),
  views: z.array(LivingView),
  history: z.array(LivingHistoryEntry),
}).strict();
export type LivingModelT = z.infer<typeof LivingModel>;
