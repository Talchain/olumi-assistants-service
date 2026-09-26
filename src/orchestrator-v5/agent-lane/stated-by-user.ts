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
 * ⛔ CURRENCY — ONE RULE, THE BRIEF PATH'S (Model Generation #70 5845579390 item 1; Delivery Lead 5845585247; round-2
 * review of db6c8a3a). "$12,000", "12,000 USD", "€12k", "12,000 dollars" and "USD 12,000" each grounded an
 * Agent-passed `{value: 12000, unit: 'GBP'}` as the user's figure. Round 1 attached a currency to a number with
 * SHAPED patterns (the token straight after it, a code straight before it) — a second rule, which still grounded
 * "12,000 US dollars", "12,000 (USD)", "USD: 12,000" and "12,000 USDs" that the brief path refuses. Now:
 *   - currency IDENTITY is the brief path's own rule (`amountFitsUnit` in `stated-amounts.ts`): a unit naming a code
 *     takes only a currency amount in that SAME code;
 *   - an amount's currency is the scanner's symbol, else EVERY registered currency token written between it and its
 *     neighbouring numbers, in any shape ("US dollars", "(USD)", "in USD", "USD:", "USDs"). One code: that currency.
 *     Two codes: a currency no unit matches. None: a BARE number. A token beside ANOTHER number is that number's
 *     ("62, not $79" leaves 62 bare);
 *   - ONE declared difference from the brief path: a bare number grounds any kind here ("raise to 59"), as it always
 *     has in this lane; the brief path never lets a plain number ground a currency unit (the parity row names it);
 *   - a unit's code is read by the SAME token reader over the unit phrase ("GBP", "GBP per month", "MRR (GBP)",
 *     "price (GBP)", "pounds"); a money unit naming no code keeps the kind-only rule;
 *   - a currency amount never grounds a NAMED unit of another kind ("12,000 USD" is not 12,000 subscribers — the brief
 *     path's rule). With no unit at all it cannot be ruled out, which is why callers pass the factor's unit, and why a
 *     blank Agent unit falls back to it (`unitToGroundIn`).
 * The vocabulary is derived, never re-spelled here: `CURRENCY_SYMBOL_TO_CODE` plus `CURRENCY_WORDS`.
 *
 * ⛔ PERCENT — THE FRAME GOES THROUGH THE UNIT. A written percentage grounds its fraction ("40%" → 0.4) only on a unit
 * that is NOT a percentage: a share kept as 0–1, which the Agent passes in the factor's own units (the brief-extraction
 * claim in `stated-amounts.ts` refuses the fraction everywhere). On a "%"/"percent" unit it grounds only the same
 * magnitude: "3%" is 3, never 0.03 — 100x too small on a factor framed on 100. `contradictsItsName` reads an option's
 * name with the same currency and frame rules.
 *
 * Every miss fails toward UNDER-claiming (the figure is left unset or recorded as Olumi's, and said): word-form
 * numerals ("four percent"), a figure the Agent derived ("down a point" → 4), a magnitude written with a suffix the
 * Agent dropped (£54k vs 54), a money unit that names no code the token reader knows ("sterling", "GBPm"), a
 * currency token that belongs to a different sentence but no other number stands between ("Raise it to 62. The US
 * team quotes in dollars."), and a currency word used as a weight ("5 pounds of flour"). Over-claim left as it was:
 * "dollars" is USD in the registered vocabulary, so "12,000 Australian dollars" still grounds a USD unit.
 */
import { amountFitsUnit, findStatedAmounts, type AmountKind } from '../../cee/provenance/stated-amounts.js';
import { CURRENCY_WORDS } from '../../cee/factor-extraction/index.js';
import { CURRENCY_SYMBOL_TO_CODE } from '../../utils/currency-alphabet.js';
import type { UnitFamily } from '../routing/value-unit-resolution.js';
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

/**
 * ONE token reader for the user's words AND a unit phrase. A token starting with a letter must start a word ("fraud"
 * is not AUD); one ending with a letter must end a word, with a plural "s" allowed ("USDs"; "poundland" is not GBP). A
 * symbol is read wherever it stands ("US$", "12,000€"). Longest first, so "$" never swallows "NZ$".
 */
const CURRENCY_TOKEN: RegExp = new RegExp(
  [...CODE_OF_TOKEN.keys()]
    .sort((a, b) => b.length - a.length)
    .map((t) => {
      const body = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const start = /^\p{L}/u.test(t) ? '(?<![\\p{L}\\p{N}])' : '';
      const end = /\p{L}$/u.test(t) ? 's?(?![\\p{L}\\p{N}])' : '';
      return `${start}${body}${end}`;
    })
    .join('|'),
  'giu',
);

/** The currency codes a span of text names, by the one token reader. */
function currenciesNamedIn(span: string): ReadonlySet<string> {
  const codes = new Set<string>();
  for (const m of span.matchAll(CURRENCY_TOKEN)) {
    const token = m[0].toLowerCase();
    const code = CODE_OF_TOKEN.get(token) ?? CODE_OF_TOKEN.get(token.replace(/s$/, ''));
    if (code !== undefined) codes.add(code);
  }
  return codes;
}

/**
 * Two different currencies named together: still a currency, but one that no code can equal. Two sentinels, so an
 * amount beside two currencies never "matches" a unit phrase that also names two.
 */
const SEVERAL_WRITTEN = 'several currencies (written)';
const SEVERAL_IN_UNIT = 'several currencies (unit)';

const oneCodeOf = (codes: ReadonlySet<string>, several: string): string | undefined =>
  codes.size === 0 ? undefined : codes.size === 1 ? [...codes][0] : several;

const normalisedCode = (code: string | undefined): string | undefined =>
  code === undefined ? undefined : (CODE_OF_TOKEN.get(code.toLowerCase()) ?? code);

/** A written amount with the currency it is IN, when it is in one. */
interface DenominatedAmount {
  readonly magnitude: number;
  readonly kind: AmountKind;
  readonly currencyCode?: string;
}

/**
 * Every amount in `text`, each with its currency: the scanner's symbol, else the codes named between it and its
 * neighbouring numbers (so a token beside another number is never this one's). Percentages keep their kind.
 */
function denominatedAmountsIn(text: string): readonly DenominatedAmount[] {
  const amounts = findStatedAmounts(text);
  return amounts.map((a, i): DenominatedAmount => {
    if (a.kind === 'currency') return { magnitude: a.magnitude, kind: 'currency', currencyCode: normalisedCode(a.currencyCode) ?? SEVERAL_WRITTEN };
    if (a.kind !== 'plain') return { magnitude: a.magnitude, kind: a.kind };
    const prev = amounts[i - 1];
    const next = amounts[i + 1];
    const before = text.slice(prev === undefined ? 0 : prev.index + prev.matchedText.length, a.index);
    const after = text.slice(a.index + a.matchedText.length, next === undefined ? text.length : next.index);
    const code = oneCodeOf(new Set([...currenciesNamedIn(before), ...currenciesNamedIn(after)]), SEVERAL_WRITTEN);
    return code === undefined ? { magnitude: a.magnitude, kind: 'plain' } : { magnitude: a.magnitude, kind: 'currency', currencyCode: code };
  });
}

/**
 * How a figure's unit is read: no unit at all; its family, by the #1966 classifier (its lead token, unchanged); and
 * the currency code the phrase names, read only when that family is money or unclassified — "price (GBP)" names GBP,
 * while "month (GBP)" stays a time unit, as before.
 */
interface FigureUnit {
  readonly none: boolean;
  readonly family: UnitFamily | null;
  readonly code?: string;
}

function readFigureUnit(unit: unknown): FigureUnit {
  if (typeof unit !== 'string' || unitLeadToken(unit) === null) return { none: true, family: null };
  const family = unitPhraseFamily(unit);
  if (family !== null && family !== 'currency') return { none: false, family };
  const code = oneCodeOf(currenciesNamedIn(unit), SEVERAL_IN_UNIT);
  return code === undefined ? { none: false, family } : { none: false, family, code };
}

/** Does this written amount ground `value` in the unit read as `u`? */
function groundsFigure(a: DenominatedAmount, value: number, u: FigureUnit): boolean {
  if (u.code !== undefined) {
    // The brief path's rule decides currency identity; a bare number is this lane's one declared difference.
    return (amountFitsUnit(a, { kind: 'currency', currencyCode: u.code }) || a.kind === 'plain') && same(a.magnitude, value);
  }
  if (a.kind === 'currency') {
    // A money unit naming no code keeps the kind-only rule; no unit cannot rule it out; any other named unit refuses.
    return (u.none || u.family === 'currency') && same(a.magnitude, value);
  }
  if (a.kind === 'percent') {
    // "40%" is 40 on a percentage; 0.4 only on a unit that is not one (a share kept as 0–1, or no unit at all).
    if (u.family === 'percent') return same(a.magnitude, value);
    return u.family === null && (same(a.magnitude, value) || same(a.magnitude / 100, value));
  }
  return same(a.magnitude, value);
}

/**
 * The unit a figure is grounded in: the Agent's unit when it names one, else the factor's own. A BLANK Agent unit is
 * not "no unit" — read as none, any written currency would ground a money factor (round-2 review, caller gap).
 */
export function unitToGroundIn(stated: unknown, factorUnit: unknown): unknown {
  return typeof stated === 'string' && stated.trim() !== '' ? stated : factorUnit;
}

/** Whether `value`, in `unit`, is a figure written in `userText`. No text (or none bound) proves nothing: false. */
export function figureTheUserWrote(value: number, unit: unknown, userText: string | null | undefined): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const u = readFigureUnit(unit);
  return denominatedAmountsIn(typeof userText === 'string' ? userText : '').some((a) => groundsFigure(a, value, u));
}

/**
 * Whether Olumi's own figure contradicts the option's NAME ("Test £54 at release" carrying an estimate of 64; #1982
 * review N2). Only money and percentages count: a bare number in a name ("Hire 2 developers") is usually about
 * something else. The name must state at least one figure of that kind, and the estimate must match none of them —
 * read with the rules above: a currency is the amount's own, in the unit's code when the unit names one ("Test
 * $12,000" is not a GBP 12,000), and a percentage's fraction counts only off a percentage frame ("Cut churn to 3%"
 * is 3 on a "%" factor, never 0.03).
 */
export function contradictsItsName(value: number, unit: unknown, name: string): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const u = readFigureUnit(unit);
  const typed = denominatedAmountsIn(name).filter((a) =>
    (a.kind === 'currency' && (u.family === null || u.family === 'currency')) || (a.kind === 'percent' && (u.family === null || u.family === 'percent')));
  if (typed.length === 0) return false;
  return !typed.some((a) => a.kind === 'currency'
    ? same(a.magnitude, value) && (u.code === undefined || amountFitsUnit(a, { kind: 'currency', currencyCode: u.code }))
    : same(a.magnitude, value) || (u.family !== 'percent' && same(a.magnitude / 100, value)));
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
