/**
 * ⭐ S2 THE LEAD BEFORE AN OPTION'S EFFECT IS FULL (DL boundary ruling 21:43Z 14 Oct). The window's scale k = 1+(r−1)·max(0,H−L)/H
 * (`capacityRatioScale`) reads ONE lead L from the option's carrier (`lead_low` = `lead_high`); a hire part's law reads its two
 * ends. L is read here, from the user's own words, on S2's ONE statement contract (`verifyStatements`):
 *  - each statement is a WHOLE statement of the user's verified typed words; one sentence may hold both readings ("She could
 *    start in 2 months, and onboarding takes about a month"), each read from its own clause;
 *  - the START: "in N months" / "N months" (stated), "about N" (Olumi's disclosed reading of it), "N–M months" (their range).
 *    A bound alone ("within 2 months", "at least 3") gives no lead and is refused with its ask, never completed by Olumi;
 *  - the ONBOARDING: the same forms in months, or in weeks (converted at 12/52, Olumi's reading of the figure);
 *  - L = start + onboarding. That the change is fully in place once onboarding ends is a MODELLING ASSUMPTION, Olumi's,
 *    labelled (`assumption`); a part the user did not give is Olumi's too ("from now", "no onboarding"), never theirs.
 * A range is kept as their range (k then fails closed with its reason). Pure.
 */
import { verifyStatements, type StatementTexts, type UserStatement } from '../agent-lane/user-statements.js';
import { readHiringStart } from './hiring-times.js';

export const EFFECT_START_QUANTITY = 'effect_start' as const;
export const ONBOARDING_QUANTITY = 'onboarding' as const;
export type LeadRole = 'stated' | 'derived' | 'olumi_estimate';
export interface LeadPart { readonly low: number; readonly high: number; readonly role: LeadRole }
/** What the option's carrier holds beside `lead_low` / `lead_high`: whose each figure is, and the assumption joining them. */
export interface EffectLead {
  readonly lead_low: number;
  readonly lead_high: number;
  readonly lead_statements: readonly UserStatement[];
  readonly lead_reading: { readonly start: LeadPart; readonly onboarding: LeadPart; readonly assumption: 'full_effect_after_onboarding' };
}
export type EffectLeadVerdict =
  | { readonly kind: 'read'; readonly lead: EffectLead }
  | { readonly kind: 'refused'; readonly refusal: 'origin_unknown' | 'lead_not_stated' | 'lead_is_a_bound' | 'lead_unclear'; readonly detail: string };

const NUM = '(\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const COUNT: Readonly<Record<string, number>> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12 };
const n = (s: string): number => COUNT[s.toLowerCase()] ?? Number(s);
const plain = (t: string): string => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const ONBOARDING_WORDS = /\b(?:onboard\w*|ramp(?:s|ing)?[ -]up|up to speed|settl(?:e|es|ing) in|bed(?:s|ding)? in)\b/;
const APPROXIMATE = /\b(?:about|around|roughly|approximately|or so|or thereabouts)\b|~/;
const SPAN = /\b(?:months?|weeks?)\b/;
const WEEK_MONTHS = 12 / 52;
const round = (x: number): number => Number(x.toFixed(2));

/** The clauses of a statement: at sentence ends, semicolons, commas, and a coordinating "and"/"then" not inside "between 2 and 3". */
function clausesOf(quote: string): string[] {
  return plain(quote).split(/[.!?;,\n]+|\s(?:and then|and|then)\s(?!(?:\d|an?\b|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))/u)
    .map((c) => c.trim()).filter((c) => c !== '');
}

/** The onboarding time a clause states, in months (a range, a point, or weeks converted), or null for none or doubt. */
export function readOnboarding(clause: string): { readonly low: number; readonly high: number; readonly derived: boolean } | null {
  const c = plain(clause);
  if (!ONBOARDING_WORDS.test(c)) return null;
  const range = new RegExp(`\\b${NUM}(?: (months?|weeks?))? ?(?:-|to|or) ?${NUM} (months?|weeks?)\\b`).exec(c);
  const points = [...c.matchAll(new RegExp(`\\b${NUM} (months?|weeks?)\\b`, 'g'))];
  const inWeeks = (unit: string | undefined): boolean => unit !== undefined && unit.startsWith('week');
  if (range) {
    const unit = range[4]!, scale = inWeeks(unit) ? WEEK_MONTHS : 1;
    if (range[2] !== undefined && inWeeks(range[2]) !== inWeeks(unit)) return null;
    const low = round(n(range[1]!) * scale), high = round(n(range[3]!) * scale);
    return low < high ? { low, high, derived: inWeeks(unit) } : null;
  }
  if (points.length !== 1) return null;
  const v = round(n(points[0]![1]!) * (inWeeks(points[0]![2]) ? WEEK_MONTHS : 1));
  return { low: v, high: v, derived: inWeeks(points[0]![2]) || APPROXIMATE.test(c) };
}

type Reading = { readonly kind: 'start' | 'onboarding'; readonly low: number; readonly high: number; readonly derived: boolean; readonly quote: string };
/** Every lead reading in a statement, clause by clause; a bound or a clause it cannot read is said as such. */
function readingsIn(quote: string): { readonly readings: Reading[]; readonly bound?: string; readonly unclear?: boolean } {
  const readings: Reading[] = [];
  for (const clause of clausesOf(quote)) {
    if (!SPAN.test(clause)) continue;
    if (ONBOARDING_WORDS.test(clause)) {
      const o = readOnboarding(clause);
      if (o === null) return { readings, unclear: true };
      readings.push({ kind: 'onboarding', ...o, quote });
      continue;
    }
    const s = readHiringStart(clause);
    if (s === null || s.kind === 'after_previous') return { readings, unclear: true };
    if (s.kind === 'at_least' || s.kind === 'within') return { readings, bound: clause };
    readings.push(s.kind === 'range' ? { kind: 'start', low: s.low, high: s.high, derived: false, quote }
      : { kind: 'start', low: s.months, high: s.months, derived: APPROXIMATE.test(clause), quote });
  }
  return { readings };
}

/**
 * The option's lead from the user's ONE or TWO whole statements (`quotes`): at most one start and one onboarding reading among
 * them. Anything in doubt (no reading, two starts, an unreadable span, a bound) prepares nothing, with its reason.
 */
export function effectLeadFromStatements(texts: StatementTexts, optionId: string, quotes: readonly string[]): EffectLeadVerdict {
  const notStated = (detail: string): EffectLeadVerdict => ({ kind: 'refused', refusal: 'lead_not_stated', detail });
  if (quotes.length === 0 || quotes.length > 2) return notStated('Give the user\'s one or two complete statements of when the change would start and how long it takes to bed in. Nothing was prepared.');
  const read = quotes.map(readingsIn);
  const bound = read.find((r) => r.bound !== undefined)?.bound;
  if (bound !== undefined) {
    return { kind: 'refused', refusal: 'lead_is_a_bound', detail: `“${bound}” gives a bound on the start, not when it would take full effect, so nothing `
      + 'was prepared. Keep their words and ask once when it would take full effect, in months; do not choose a figure for them.' };
  }
  const all = read.flatMap((r) => r.readings);
  const starts = all.filter((r) => r.kind === 'start'), onboardings = all.filter((r) => r.kind === 'onboarding');
  if (read.some((r) => r.unclear === true) || starts.length > 1 || onboardings.length > 1 || all.length === 0) {
    return { kind: 'refused', refusal: 'lead_unclear', detail: 'Olumi could not read one start and one onboarding time from those words, so nothing was '
      + 'prepared. Ask once when the change would start and how long it would take to bed in, in months.' };
  }
  const statements: UserStatement[] = [];
  for (const r of all) {
    const v = verifyStatements([r.low === r.high ? { quote: r.quote, form: 'point', value: r.low } : { quote: r.quote, form: 'range', low: r.low, high: r.high }],
      texts, { subject: { quantity: r.kind === 'start' ? EFFECT_START_QUANTITY : ONBOARDING_QUANTITY, option_id: optionId }, unit: 'months',
        forms: ['point', 'range'], figuresIn: (q) => readingsIn(q).readings.filter((x) => x.kind === r.kind).map((x) => ({ low: x.low, high: x.high })) });
    if (v.kind === 'refused') return v.refusal === 'origin_unknown' ? { kind: 'refused', refusal: 'origin_unknown', detail: v.detail } : notStated(v.detail);
    statements.push(v.statements[0]!);
  }
  const part = (r: Reading | undefined): LeadPart => (r === undefined ? { low: 0, high: 0, role: 'olumi_estimate' }
    : { low: r.low, high: r.high, role: r.derived ? 'derived' : 'stated' });
  const start = part(starts[0]), onboarding = part(onboardings[0]);
  return { kind: 'read', lead: { lead_low: round(start.low + onboarding.low), lead_high: round(start.high + onboarding.high), lead_statements: statements,
    lead_reading: { start, onboarding, assumption: 'full_effect_after_onboarding' } } };
}

/** A lead the option's carrier already holds from the user's words (never re-asked), or `undefined`. */
export function savedEffectLead(carrier: unknown): EffectLead | undefined {
  if (carrier === null || typeof carrier !== 'object' || Array.isArray(carrier)) return undefined;
  const c = carrier as Partial<EffectLead> & { lead_reading?: { assumption?: unknown } };
  return typeof c.lead_low === 'number' && typeof c.lead_high === 'number' && Array.isArray(c.lead_statements) && c.lead_statements.length > 0
    && c.lead_reading?.assumption === 'full_effect_after_onboarding'
    ? { lead_low: c.lead_low, lead_high: c.lead_high, lead_statements: c.lead_statements, lead_reading: c.lead_reading as EffectLead['lead_reading'] } : undefined;
}

const months = (x: number): string => (x === 1 ? '1 month' : `${x} months`);
const said = (p: LeadPart): string => (p.low === p.high ? months(p.low) : `${p.low}–${months(p.high)}`);
/**
 * AIE_TEXT_PENDING (DL relays): the lead as a card says it, each figure with whose it is, and the one assumption joining them.
 * "Full effect 3 months from now: your start in 2 months, then your settling-in time of about 1 month (Olumi’s reading of your
 * words). Olumi assumes the change is fully in place once that settling-in ends." (A hire's onboarding, a change's bedding in.)
 */
export function effectLeadWords(lead: EffectLead): string {
  const { start, onboarding } = lead.lead_reading;
  const total = lead.lead_low === lead.lead_high ? months(lead.lead_low) : `${lead.lead_low}–${months(lead.lead_high)}`;
  const startWords = start.role === 'olumi_estimate' ? 'starting now (Olumi’s assumption)'
    : `your start in ${start.role === 'derived' ? `about ${said(start)} (Olumi’s reading of your words)` : said(start)}`;
  const onboardingWords = onboarding.role === 'olumi_estimate' ? 'with no settling-in time (Olumi’s assumption)'
    : `then your settling-in time of ${onboarding.role === 'derived' ? `about ${said(onboarding)} (Olumi’s reading of your words)` : said(onboarding)}`;
  return `Full effect ${total} from now: ${startWords}, ${onboardingWords}. Olumi assumes the change is fully in place once that settling-in ends.`;
}
