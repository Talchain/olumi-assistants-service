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
  source: LivingSource,
  /** For `party`: the person or body the user reports, as written. Null otherwise. */
  party: z.string().nullable(),
  /** The person's exact words for a user or party item. Null for Olumi's own items. */
  quote: z.string().nullable(),
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
    comparator: z.enum(['>=', '<=', '=', 'increase', 'decrease']),
    ...figure,
    by_when: z.string().nullable(),
    /** The reference the target is measured from, as written ("today", "last quarter"); null when none. */
    baseline: z.string().nullable(),
    /** The quantity's current level, in the target's unit, when stated. Unknown is null, never 0. */
    current: z.number().nullable(),
    /** 'user' only when the person set today's level themselves (a canvas edit); otherwise null: the aim's attribution covers it. */
    current_source: z.enum(['user']).nullable(),
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
  settings: z.array(LivingSetting),
  ...attribution,
}).strict();

export const LivingLink = z.object({
  id,
  /** A factor id (or an option id for an option's direct effect). */
  from: id,
  /** A factor id or an aim id. */
  to: id,
  effect: z.object({
    /**
     * `normal`: an explicitly stated law, `value` its mean and `sd` its standard deviation, per +1 of `from`. An ordinary
     * range is not a law (AIE, 20 Oct): it stays a `range`.
     */
    form: z.enum(['point', 'range', 'normal', 'direction_only', 'unknown']),
    ...figure,
    /**
     * The link's unit is the `to` item's own unit, exactly as that item writes it; "per +1 of `from`" is implied, so it is
     * never written here. The AI reads this description (the strict tool schema carries it), so it is the instruction.
     */
    unit: z.string().nullable().describe(
      "The unit of the `to` item's quantity, written exactly as that item writes its own unit (e.g. \"units\", \"£\"). The effect is always per +1 of `from`, so never add \"per …\". Null when `to` has no unit."),
    sd: z.number().nullable(),
    sign: z.enum(['+', '-']).nullable(),
  }).strict().describe('The change in `to` for each +1 of `from`, in the unit of `to`.'),
  ...attribution,
}).strict();

export const LivingCondition = z.object({
  text: z.string(),
  applies_to: z.array(z.string()),
  ...attribution,
}).strict();

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
