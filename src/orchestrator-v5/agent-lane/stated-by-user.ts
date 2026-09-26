/**
 * ⛔ A FIGURE IS RECORDED AS THE USER'S ONLY WHEN THE USER WROTE IT.
 *
 * Served on CEE fbb12b8 (guest witness, scenario fb2e5613; #70 5843805457): "Add an option: keep the price at £49
 * and run a win-back offer for churned customers. It reduces Monthly churn." The Agent passed `level: {value: 0}`
 * for Monthly churn to mean "not set", and one approval stored `{value: 0, unit: "percent per month", source:
 * "user_specified"}` — a 0% churn level recorded as the user's, who stated none. The tool text already said "a
 * level ONLY for a figure the user stated"; nothing enforced it, and the unit check (#1966) cannot see it (% on %).
 *
 * THE RULE: a figure the Agent attributes to the user must be PRESENT in the user's own words (`user_text`, bound
 * by the route from the conversation's user messages, never from model output), read by the repo's one scanner
 * (`findStatedAmounts`). It is a NECESSARY condition, never attestation (see that module): not present ⇒ the
 * user's claim is withdrawn; present ⇒ there are no grounds to withdraw it.
 *
 * KIND: a written amount grounds a figure only in a compatible kind of unit, read by the family classifier #1966
 * uses (`unitPhraseFamily` — `readUnit` reads "£ per month" and "GBP/month" as plain, so it would disown every
 * price level). A bare number ("59", "7 engineers") grounds any kind; "£49" grounds only a money figure (never a
 * churn level); "4%" only a percentage or a unit nobody can classify.
 *
 * ⛔ CURRENCY — THE CODE MUST MATCH (Model Generation #70 5845579390 item 1; Delivery Lead 5845585247). "$12,000",
 * "12,000 USD", "€12k", "12,000 dollars" and "USD 12,000" each grounded an Agent-passed `{value: 12000, unit: 'GBP'}`
 * as the user's figure, 5 of 5: the branch checked only the KIND, and a number with its currency written after it (or
 * an ISO code before it) was scanned as a bare number, which grounds any unit. The brief-path rule
 * (`isAmountStatedInBrief`) refused all five. Now:
 *   - a number with a currency ATTACHED is a CURRENCY amount, never a bare number: a symbol before it (the scanner's
 *     own read), an ISO code before or after it, or a registered currency word after it (`CURRENCY_WORDS`, folded
 *     through `CURRENCY_SYMBOL_TO_CODE` — one vocabulary, derived, never re-spelled here);
 *   - it grounds only a currency unit, and when the unit names a code ("GBP", "£", "GBP per month", "£/month",
 *     "pounds") only that code. The unit's code is read by the C47 composite reader (`readCurrencyUnitWithQualifiers`),
 *     else from the token its family is read from (`unitLeadToken`). A currency unit naming no code keeps the kind rule;
 *   - it never grounds a NAMED unit of another kind, classified or not: "12,000 USD" is not 12,000 subscribers (the
 *     brief path's rule: a written denomination never matches a unit it cannot read). With no unit at all it cannot be
 *     ruled out, which is why callers pass the factor's unit.
 *
 * ⛔ PERCENT — THE FRAME GOES THROUGH THE UNIT. A written percentage grounds its fraction ("40%" → 0.4) only on a unit
 * that is NOT a percentage: a share kept as 0–1, which the Agent passes in the factor's own units (the brief-extraction
 * claim in `stated-amounts.ts` refuses the fraction everywhere). On a "%"/"percent" unit it grounds only the same
 * magnitude: "3%" is 3, never 0.03 — 100x too small on a factor framed on 100.
 *
 * Every miss fails toward UNDER-claiming (the figure is left unset or recorded as Olumi's, and said): word-form
 * numerals ("four percent"), a figure the Agent derived ("down a point" → 4), a magnitude written with a suffix
 * the Agent dropped (£54k vs 54), a money unit whose code sits behind a word the composite reader does not know
 * ("revenue in GBP" refuses every written currency), and a currency word used as a weight ("5 pounds of flour").
 * NOT read, and so still a bare number as before: a currency spelled outside the vocabulary ("12,000 US dollars").
 */
import {
  findStatedAmounts,
  readCurrencyUnitWithQualifiers,
  readUnit,
  type StatedAmount,
} from '../../cee/provenance/stated-amounts.js';
import { CURRENCY_WORDS } from '../../cee/factor-extraction/index.js';
import { CURRENCY_SYMBOL_TO_CODE } from '../../utils/currency-alphabet.js';
import { unitLeadToken, unitPhraseFamily } from './unit-conflict.js';

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Every written currency token, in lower case, to its code — DERIVED: the one map's symbols and codes, then the
 * registered currency words folded through it ("dollars" → its symbol → USD). A Map, so no inherited key
 * ("constructor") ever reads as a currency.
 */
const CODE_OF_TOKEN: ReadonlyMap<string, string> = (() => {
  const codes = new Map<string, string>();
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_TO_CODE)) {
    codes.set(symbol.toLowerCase(), code);
    codes.set(code.toLowerCase(), code);
  }
  for (const [word, symbol] of Object.entries(CURRENCY_WORDS)) {
    const code = Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL_TO_CODE, symbol) ? CURRENCY_SYMBOL_TO_CODE[symbol] : undefined;
    if (code !== undefined && !codes.has(word.toLowerCase())) codes.set(word.toLowerCase(), code);
  }
  return codes;
})();

/** A longest-first alternation of literal tokens: first-match-wins must never let "$" swallow "NZ$". */
const alternationOf = (tokens: Iterable<string>): string =>
  [...new Set(tokens)].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

const lettered = (token: string): boolean => /^\p{L}/u.test(token);
const MAP_TOKENS: readonly string[] = [...Object.keys(CURRENCY_SYMBOL_TO_CODE), ...Object.values(CURRENCY_SYMBOL_TO_CODE)].map((t) => t.toLowerCase());

/** A currency written straight AFTER a number: "12,000 USD", "12,000 dollars", "12,000€" — a whole word, never a prefix. */
const CURRENCY_AFTER = new RegExp(`^\\s*(?<cur>${alternationOf(CODE_OF_TOKEN.keys())})(?![\\p{L}\\p{N}])`, 'iu');

/**
 * A code or symbol written straight BEFORE a number the scanner read bare: "USD 12,000", and "US$12,000", whose "$" the
 * scanner's lookbehind refuses because it is glued to letters. A lettered token must start a word: "fraud 12" is not AUD.
 */
const CURRENCY_BEFORE = new RegExp(
  `(?:(?<![\\p{L}\\p{N}])(?<code>${alternationOf(MAP_TOKENS.filter(lettered))})|(?<sym>${alternationOf(MAP_TOKENS.filter((t) => !lettered(t)))}))\\s*$`,
  'iu',
);

const normalisedCode = (code: string): string => CODE_OF_TOKEN.get(code.toLowerCase()) ?? code;

/**
 * The currency a written amount is IN, or undefined for a bare number or a percentage. The scanner reads a symbol
 * before the number; a code or word after it, or a code before it, is read here from the words either side.
 */
function writtenCurrencyOf(a: StatedAmount, text: string): string | undefined {
  if (a.kind === 'currency') return normalisedCode(a.currencyCode ?? '');
  if (a.kind !== 'plain') return undefined;
  const after = CURRENCY_AFTER.exec(text.slice(a.index + a.matchedText.length))?.groups?.['cur'];
  if (after !== undefined) return CODE_OF_TOKEN.get(after.toLowerCase());
  const before = CURRENCY_BEFORE.exec(text.slice(0, a.index))?.groups;
  const token = before?.['code'] ?? before?.['sym'];
  return token === undefined ? undefined : CODE_OF_TOKEN.get(token.toLowerCase());
}

/**
 * The currency code a unit phrase names, or undefined: "GBP", "£", "GBP per month", "£/month" and "MRR (GBP)" through
 * the C47 composite reader; else the token the unit's family is read from, which also reads "£k" and a currency word
 * ("pounds per month").
 */
function currencyCodeOfUnit(unit: unknown): string | undefined {
  if (typeof unit !== 'string') return undefined;
  const composite = readCurrencyUnitWithQualifiers(unit);
  if (composite.kind === 'currency' && composite.currencyCode !== undefined) return normalisedCode(composite.currencyCode);
  const lead = unitLeadToken(unit);
  if (lead === null) return undefined;
  const read = readUnit(lead);
  if (read.kind === 'currency' && read.currencyCode !== undefined) return normalisedCode(read.currencyCode);
  return CODE_OF_TOKEN.get(lead);
}

/** Whether `value`, in `unit`, is a figure written in `userText`. No text (or none bound) proves nothing: false. */
export function figureTheUserWrote(value: number, unit: unknown, userText: string | null | undefined): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const text = typeof userText === 'string' ? userText : '';
  const unitCode = currencyCodeOfUnit(unit);
  const family = unitCode !== undefined ? 'currency' : unitPhraseFamily(unit);
  const noUnit = unitLeadToken(unit) === null;
  return findStatedAmounts(text).some((a) => {
    const currency = writtenCurrencyOf(a, text);
    // A written currency grounds only a currency unit, and only its own code when the unit names one; never a named
    // unit of another kind. With no unit at all it cannot be ruled out.
    if (currency !== undefined) {
      const unitAccepts = noUnit || (family === 'currency' && (unitCode === undefined || unitCode === currency));
      return unitAccepts && same(a.magnitude, value);
    }
    // "40%" is 40 on a percentage; 0.4 only on a unit that is not one (a share kept as 0–1, or no unit at all).
    if (a.kind === 'percent') {
      if (family === 'percent') return same(a.magnitude, value);
      return family === null && (same(a.magnitude, value) || same(a.magnitude / 100, value));
    }
    return same(a.magnitude, value);
  });
}

/**
 * Whether Olumi's own figure contradicts the option's NAME ("Test £54 at release" carrying an estimate of 64; #1982
 * review N2). Only money and percentages count: a bare number in a name ("Hire 2 developers") is usually about
 * something else. The name must state at least one figure of that kind, and the estimate must match none of them.
 */
export function contradictsItsName(value: number, unit: unknown, name: string): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const family = unitPhraseFamily(unit);
  const typed = findStatedAmounts(name).filter((a) =>
    (a.kind === 'currency' && (family === null || family === 'currency')) || (a.kind === 'percent' && (family === null || family === 'percent')));
  if (typed.length === 0) return false;
  return !typed.some((a) => same(a.magnitude, value) || (a.kind === 'percent' && same(a.magnitude / 100, value)));
}

/**
 * Whether this request is something the user TYPED: a composer message. A chip click is not — every chip's text is
 * Olumi's (an approval replaying the Agent's own labels, a suggestion, a coaching prompt) — and neither is a system
 * event such as a board edit.
 *
 * An ALLOWLIST of sources (#1978 review 5845079924 N1): the UI sends `composer`, `chip`, `chip_click` or `retry`
 * (`buildPayload.ts` `normaliseMessageSource`), and a `chip_click` can arrive without a `chip` object. Only `composer`
 * — or no source at all, an API caller — is typed. A `retry` re-sends an earlier message whose words were recorded
 * when it was first sent, if they were typed; any other source fails toward under-claiming.
 */
export function typedByUser(body: Record<string, unknown>): boolean {
  const kind = body['kind'];
  const chip = body['chip'];
  const source = body['source'];
  return (kind === undefined || kind === 'message') && (chip === null || chip === undefined)
    && (source === undefined || source === 'composer');
}

/**
 * The user's own words in this conversation: what they TYPED earlier in this session (`HistoryStore.typedWords`), then
 * this turn's message when they typed it. A figure the user gave two turns ago ("test £54 vs £59", then "add those") is
 * still theirs.
 *
 * ⛔ PROVENANCE, NEVER TEXT SHAPE (#1978 reviews 5844589340 B1, 5844805634 B2/B3). The Agent's history carries text
 * that is not the user's in `role: 'user'` items: Olumi's narration of a board edit, a chip's replay of the Agent's
 * own labels, and — after a restart, when history is reseeded from the durable conversation — rows Olumi itself
 * dispatched ("Add the option \u201cTest \u00a354 at release\u201d.", a run's reason). Stripping by punctuation lost
 * the user's own "Yes, but it's closer to 4%". So the words are recorded as they are typed, by the route, and nothing
 * else is ever read as the user's. After a restart the earlier words are gone: a figure is then left unset and asked
 * for — under-claiming, never over.
 */
export function userWordsOf(typedEarlier: readonly string[], typedNow: string | null): string {
  return [...typedEarlier, ...(typedNow !== null ? [typedNow] : [])].join('\n');
}
