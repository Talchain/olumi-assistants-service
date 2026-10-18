/**
 * ⭐ LEAN CORE (#3392, USER_QUOTE) — the AI's citation, as the signed tool text asks for it: for a figure the AI claims as the
 * user's, it copies the user's sentence that writes it. A row written before the citation existed passes its calls through
 * here, so the AI cites exactly what the user's typed words write (`quoteOfFigure`), and NOTHING where the figure is unwritten
 * (which stays unknown, never "you said"). A call that already carries a quote, or claims nothing, is passed unchanged.
 */
import { quoteOfFigure } from '../../stated-by-user.js';

type Rec = Record<string, unknown>;
const textOf = (ctx: unknown): string => {
  const c = (ctx ?? {}) as { user_turn_text?: unknown; user_text?: unknown };
  return typeof c.user_turn_text === 'string' && c.user_turn_text !== '' ? c.user_turn_text : typeof c.user_text === 'string' ? c.user_text : '';
};
/** The user's own sentence writing `value` (the whole turn, else the one line that writes it), or none. */
const quoteFor = (value: number, unit: unknown, text: string): string | null => {
  const u = typeof unit === 'string' ? unit : '';
  return quoteOfFigure(value, u, text) ?? text.split('\n').find((l) => quoteOfFigure(value, u, l) !== null) ?? null;
};
/** An item the AI claims as the user's (`user_stated: true`) and has not cited. */
const cite = (item: unknown, value: unknown, unit: unknown, text: string): unknown => {
  if (item === null || typeof item !== 'object' || (item as Rec).quote !== undefined || (item as Rec).user_stated !== true) return item;
  const quote = typeof value === 'number' ? quoteFor(value, unit, text) : null;
  return quote === null ? item : { ...(item as Rec), quote };
};
/** A new option's level claims nothing by a flag: the user's when cited, Olumi's only with `estimate`. Cited where written. */
const citeLevel = (level: unknown, text: string): unknown => {
  if (level === null || typeof level !== 'object' || (level as Rec).quote !== undefined || (level as Rec).estimate !== undefined) return level;
  const value = (level as Rec).value;
  const quote = typeof value === 'number' ? quoteFor(value, (level as Rec).unit, text) : null;
  return quote === null ? level : { ...(level as Rec), quote };
};

/** The capabilities, with each figure-carrying call cited from the turn's own typed words. */
export function citeUserSpans<T extends object>(caps: T): T {
  const c = caps as unknown as Record<string, ((ctx: unknown, args: Rec) => unknown) | undefined>;
  const wrap = (name: string, rewrite: (args: Rec, text: string) => Rec) => {
    const fn = c[name];
    return fn === undefined ? undefined : (ctx: unknown, args: Rec) => fn.call(caps, ctx, rewrite(args ?? {}, textOf(ctx)));
  };
  const items = (key: string) => (args: Rec, text: string): Rec => (Array.isArray(args[key])
    ? { ...args, [key]: (args[key] as Rec[]).map((i) => cite(i, i?.value, i?.unit, text)) } : args);
  const actsOn = (o: Rec, text: string): Rec => (Array.isArray(o.acts_on)
    ? { ...o, acts_on: (o.acts_on as Rec[]).map((a) => (a?.level === undefined ? a : { ...a, level: citeLevel(a.level, text) })) } : o);
  const wrapped: Record<string, unknown> = {
    proposeAssumptions: wrap('proposeAssumptions', items('assumptions')),
    proposeOptionInterventions: wrap('proposeOptionInterventions', items('interventions')),
    proposeStartingPoint: wrap('proposeStartingPoint', (args, text) => items('option_levels')(items('assumptions')(args, text), text)),
    proposeNewOption: wrap('proposeNewOption', (args, text) => {
      const one = actsOn(args, text);
      return Array.isArray(one.options) ? { ...one, options: (one.options as Rec[]).map((o) => actsOn(o, text)) } : one;
    }),
  };
  return new Proxy(caps, { get: (target, key, receiver) => (typeof key === 'string' && wrapped[key] !== undefined ? wrapped[key] : Reflect.get(target, key, receiver)) });
}
