/**
 * How Olumi reads a unit's words (money in one currency and period, a count, or plain words), and when two units name
 * the same quantity (`sameUnit`). Moved verbatim out of `reconciling-product.ts` so a pure reader (`placeholder-parts.ts`:
 * the ONE Olumi-guess test DR row 4 and B6 share) can use `sameUnit` without importing admission (its import chain
 * reaches `placeholder-parts.ts` itself). `reconciling-product.ts` re-exports what it exported before.
 */
import { readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { CURRENCY_WORD_TO_CODE } from '../../utils/currency-alphabet.js';
import { isPeriodConnector, periodAdverb, periodNoun, shareKind, type UnitPeriod } from '../../utils/unit-alphabet.js';

/**
 * ⚠ C1 IS A NARROWER VIEW OF THE ONE GRAMMAR (Science U-GRAMMAR, PR-U1 conditions 5 Oct). The vocabulary is the leaf's
 * (`utils/unit-alphabet.ts`); C1 — `periodIn`, `readMoney`, `readMoneyTotal`, `readCount`, `sameUnit`, the composition
 * and sizing readers behind ~12 call sites — sees only its MONTH and YEAR spellings. Measured on staging 147c6630:
 * giving C1 every period flips `unitsCompose` ("£" goal, "£/hour" × "hours": PROOF today → NO) and turns the duration
 * counts "weeks"/"hours"/"days" into periods. So C1 widens only once a composition rule exists (a rate per period × a
 * duration count of the same time unit is a total with no period); until then it may ABSTAIN where `readUnitParts`
 * would equate, and must never CONTRADICT it (pinned by the invariant row).
 */
const C1_PERIODS: ReadonlySet<UnitPeriod> = new Set<UnitPeriod>(['month', 'year']);
type Period = 'month' | 'year' | null;
const c1Period = (w: string): Period => {
  const p = periodNoun(w) ?? periodAdverb(w);
  return p !== null && C1_PERIODS.has(p) ? (p as 'month' | 'year') : null;
};
export const words = (s: string): string[] => s.toLowerCase().replace(/[()]/g, ' ').replace(/\//g, ' / ').split(/[\s-]+/).filter((w) => w !== '');
export const singular = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

function periodOf(ws: readonly string[]): Period | 'both' {
  const m = ws.some((w) => c1Period(w) === 'month');
  const y = ws.some((w) => c1Period(w) === 'year');
  return m && y ? 'both' : m ? 'month' : y ? 'year' : null;
}

/** The ONE period a piece of text names ("Monthly spend", "£540k a year"), or null when it names none or both. */
export function periodIn(text: string): 'month' | 'year' | null {
  const p = periodOf(words(text));
  return p === 'both' ? null : p;
}

const isPeriod = (w: string): boolean => c1Period(w) !== null;
const isCurrency = (w: string): boolean => readCurrencyUnitWithQualifiers(w).kind === 'currency';
/** The words `readCurrencyUnitWithQualifiers` lets stand beside the currency itself ("GBP recurring revenue", "£ a month"). */
const MONEY_WORDS = new Set(['revenue', 'recurring', 'a']);

/**
 * Money in ONE unscaled currency, its period, and its ONE per-unit denominator ("£/subscriber/month" → [subscriber]).
 *
 * ⛔ PR Review on 9fdc3f96: every "/" or "per" opens a segment, and each segment after the money must be a period or THE
 * denominator. A second denominator ("GBP per subscriber per seat per month") makes price × subscribers money per seat
 * per month, not the goal's money per month. So it is refused, as is a segment that mixes a period into a denominator.
 */
export function readMoney(unit: unknown, label: string): { code: string; period: Period; per: string[] | null; mixed?: true } | null {
  if (typeof unit !== 'string') return null;
  const r = readCurrencyUnitWithQualifiers(unit);
  if (r.kind !== 'currency' || r.currencyCode === undefined || (r.multiplier ?? 1) !== 1) return null;
  const ws = words(unit);
  const segments: string[][] = [[]];
  for (const w of ws) {
    if (w === '/' || w === 'per') segments.push([]);
    else segments[segments.length - 1]!.push(w);
  }
  if (segments.some((s) => s.length === 0) || !segments[0]!.every((w) => isCurrency(w) || isPeriod(w) || MONEY_WORDS.has(w))) return null;
  // ⛔ AIQ 5891385320 (3): "per subscriber-month" names the count's noun with the period joined on. It composes (£ per
  // subscriber-month × subscribers IS £/month); the parser just never finished it, so it read as "don't compose" and got
  // neither a card nor the withhold. Read as the denominator plus its period, marked `mixed`: never a silent mint, the card.
  let mixed = false;
  for (const seg of segments.slice(1)) {
    if (seg.length >= 2 && isPeriod(seg[seg.length - 1]!) && !seg.slice(0, -1).some(isPeriod)) { mixed = true; }
  }
  if (mixed) {
    const parts = segments.slice(1);
    if (parts.length !== 1 || ws.filter(isPeriod).length !== 1) return null;
    const seg = parts[0]!;
    const nouns = seg.slice(0, -1);
    if (!nouns.every((w) => /^[a-z]+$/.test(w) && !isCurrency(w) && !MONEY_WORDS.has(w))) return null;
    const period = periodOf([seg[seg.length - 1]!]);
    if (period === 'both' || period === null) return null;
    return { code: r.currencyCode, period, per: nouns.map(singular), mixed: true };
  }
  const denominators = segments.slice(1).filter((s) => !s.every(isPeriod));
  if (denominators.length > 1) return null;
  if (denominators.some((s) => !s.every((w) => /^[a-z]+$/.test(w) && !isPeriod(w) && !isCurrency(w) && !MONEY_WORDS.has(w)))) return null;
  // ⛔ PR Review on 98be677f: ONE period at most. "GBP per subscriber per month per month" is money per month², and
  // "GBP monthly per subscriber per month" says the period twice; neither composes to money per month.
  if (ws.filter(isPeriod).length > 1) return null;
  // The goal's own name can carry its period ("MRR", "Monthly recurring revenue") when its unit does not.
  const own = periodOf(ws);
  const period = own !== null ? own : periodOf(words(label));
  if (period === 'both') return null;
  return { code: r.currencyCode, period, per: denominators.length === 1 ? denominators[0]!.map(singular) : null };
}

/**
 * A stored money TOTAL in terms a goal's figure can be added to (PR Review 5894085840 on #2305): ONE unscaled currency,
 * no per-item denominator, and a period — the unit's own, else the node's name's ("Other-plan MRR"). Null when any part
 * is unreadable: "£1,500 per year" is never added into a monthly MRR.
 */
export function readMoneyTotal(unit: unknown, label: string): { code: string; period: 'month' | 'year' } | null {
  const m = readMoney(unit, label);
  return m === null || m.mixed === true || m.per !== null || m.period === null ? null : { code: m.code, period: m.period };
}

/** A COUNT: words only ("subscribers", "paying customers") — no currency, no %, no period, no "per" (a rate). */
export function readCount(unit: unknown): string[] | null {
  if (typeof unit !== 'string' || !/^[a-z][a-z\s-]*$/i.test(unit.trim())) return null;
  const ws = words(unit);
  if (ws.length === 0 || ws.includes('per') || periodOf(ws) !== null || readCurrencyUnitWithQualifiers(unit).kind === 'currency') return null;
  return ws.map(singular);
}

/**
 * Two units naming the same quantity as `unitsCompose` reads them (AIQ 5906521706, P0 PARTNER row E): the same count noun
 * ("subscribers" = "subscriber"; never "customers"), or the same money (currency, period and denominator). A unit neither
 * reads is compared word for word; no unit on either side is never the same.
 */
export function sameUnit(a: unknown, b: unknown): boolean {
  // C1 never contradicts the full reader (Science PR-U1 condition 2; Codex r1 on #2604): a %/pp spelling on ONE side
  // only ("percent" vs "percents") is not the same unit, whatever the word fallback below would say.
  if (typeof a === 'string' && typeof b === 'string' && (shareKind(a) === null) !== (shareKind(b) === null)) return false;
  const ca = readCount(a); const cb = readCount(b);
  if (ca !== null || cb !== null) return ca !== null && cb !== null && ca.join(' ') === cb.join(' ');
  const ma = readMoney(a, ''); const mb = readMoney(b, '');
  if (ma !== null || mb !== null) {
    return ma !== null && mb !== null && ma.code === mb.code && ma.period === mb.period && ma.mixed === mb.mixed
      && (ma.per ?? []).join(' ') === (mb.per ?? []).join(' ');
  }
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const wa = words(a).join(' ');
  return wa !== '' && wa === words(b).join(' ');
}

// ── THE FULL READER (U-GRAMMAR G1): every part typed independently, every period the leaf knows ──────────────────

/**
 * A unit's parts. `scale` is the multiplier a scaled currency unit carries ("£k/year" → 1,000): the caller applies it to
 * the VALUE, it never makes two units differ (Science G1: scale belongs to the number).
 */
export interface UnitParts {
  readonly kind: 'currency' | 'percent' | 'points' | 'count';
  readonly code: string | null;
  readonly scale: number;
  /** A count's noun ("tickets a month" → [ticket]); a duration noun stays a noun ("18 months" → [month]). */
  readonly noun: readonly string[] | null;
  /** Money's per-item denominator ("£/billable day" → [billable]); `each` with no noun is an unnamed one ([]). */
  readonly per: readonly string[] | null;
  /** A share's base ("% of output" → [output]). */
  readonly base: readonly string[] | null;
  /** Words after a %/pp head that are not its base ("% increase from prior year"); they take part in equality. */
  readonly qualifiers: readonly string[] | null;
  readonly period: UnitPeriod | null;
}

const isLeafPeriodNoun = (w: string): boolean => periodNoun(w) !== null;
const currencyOf = (w: string): { code: string; scale: number } | null => {
  const word = CURRENCY_WORD_TO_CODE[w.toLowerCase()];
  if (word !== undefined) return { code: word, scale: 1 };
  const r = readCurrencyUnitWithQualifiers(w);
  return r.kind === 'currency' && r.currencyCode !== undefined ? { code: r.currencyCode, scale: r.multiplier ?? 1 } : null;
};

/**
 * Read a unit string into its parts, or null when any word is unreadable. A period is the period only as an adverb
 * ("annually", "MRR") or after a connector ("a month", "/year", "per annum"); a bare period noun is a duration noun.
 * After a currency, an unknown word leaves the unit unread (C47: "GBP widgets" is not money).
 */
export function readUnitParts(unit: unknown): UnitParts | null {
  if (typeof unit !== 'string' || unit.trim() === '') return null;
  const ws = words(unit);
  // A share: the longest %/pp spelling at the head; "of <noun>" is its base, anything else a qualifier.
  for (let n = Math.min(3, ws.length); n >= 1; n -= 1) {
    const kind = shareKind(ws.slice(0, n).join(' '));
    if (kind === null) continue;
    const rest = ws.slice(n);
    const base = rest[0] === 'of' && rest.length > 1 ? rest.slice(1).map(singular) : null;
    const qualifiers = base === null && rest.length > 0 ? rest.map(singular) : null;
    return { kind, code: null, scale: 1, noun: null, per: null, base, qualifiers, period: null };
  }
  let period: UnitPeriod | null = null;
  const setPeriod = (p: UnitPeriod): boolean => {
    if (period !== null && period !== p) return false;
    period = p;
    return true;
  };
  let money: { code: string; scale: number } | null = null;
  const nouns: string[] = [];
  let per: string[] | null = null;
  // Segments: every "/" or "per" opens one; inside a segment "a/an/each/every" + a period noun names the period.
  const segments: string[][] = [[]];
  for (const w of ws) {
    if (w === '/' || w === 'per') segments.push([]);
    else segments[segments.length - 1]!.push(w);
  }
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    const afterConnector = i > 0;
    if (afterConnector && seg.length === 0) return null;
    const segNouns: string[] = [];
    for (let j = 0; j < seg.length; j += 1) {
      const w = seg[j]!;
      const adverb = periodAdverb(w);
      if (adverb !== null) { if (!setPeriod(adverb)) return null; continue; }
      const cur = currencyOf(w);
      if (cur !== null) { if (money !== null || i > 0) return null; money = cur; continue; }
      if (isPeriodConnector(w) && j + 1 < seg.length && isLeafPeriodNoun(seg[j + 1]!)) {
        if (!setPeriod(periodNoun(seg[j + 1]!)!)) return null;
        j += 1;
        continue;
      }
      if (['a', 'an', 'each', 'every'].includes(w)) { if (w === 'each' || w === 'every') per = per ?? []; continue; }
      // The last word after a connector, when it is a period noun, is the period ("/year", "per billable day").
      if (afterConnector && j === seg.length - 1 && isLeafPeriodNoun(w)) { if (!setPeriod(periodNoun(w)!)) return null; continue; }
      // In a MONEY unit string a period noun right after the currency is its period ("£ year" as C1 reads it); in a
      // count it stays a duration noun ("18 months").
      if (i === 0 && money !== null && isLeafPeriodNoun(w)) { if (!setPeriod(periodNoun(w)!)) return null; continue; }
      if (!/^[a-z][a-z.'-]*$/.test(w)) return null;
      segNouns.push(w);
    }
    if (segNouns.length === 0) continue;
    if (i === 0) nouns.push(...segNouns);
    else if (money !== null || nouns.length > 0) {
      if (per !== null && per.length > 0) return null;
      per = segNouns.map(singular);
    } else return null;
  }
  if (money !== null) {
    // After a currency, only the money words may stand beside it (C47).
    if (nouns.some((w) => !MONEY_WORDS.has(w))) return null;
    return { kind: 'currency', code: money.code, scale: money.scale, noun: null, per, base: null, qualifiers: null, period };
  }
  if (nouns.length === 0) return null;
  return { kind: 'count', code: null, scale: 1, noun: nouns.map(singular), per, base: null, qualifiers: null, period };
}

const sameWords = (a: readonly string[], b: readonly string[]): boolean => a.join(' ') === b.join(' ');
/** `outer` contains `inner` as a contiguous run (a stated "new subscriber" contains the declared "subscriber"). */
const containsWords = (outer: readonly string[], inner: readonly string[]): boolean =>
  inner.length > 0 && ` ${outer.join(' ')} `.includes(` ${inner.join(' ')} `);

/**
 * C3, carrier-compatible (U-GRAMMAR G2): the manifest's and an edge figure's predicate. The kinds and the currency agree,
 * a count's noun agrees, and NO part BOTH sides state conflicts (period, denominator, base, qualifiers). A part only one
 * side states is no conflict. Scale is not compared: the caller compares value × scale.
 */
export function carrierCompatible(stated: UnitParts, declared: UnitParts): boolean {
  if (stated.kind !== declared.kind || stated.code !== declared.code) return false;
  if (stated.kind === 'count' && !containsWords(stated.noun ?? [], declared.noun ?? [])) return false;
  const conflicts = (a: readonly string[] | null, b: readonly string[] | null): boolean =>
    a !== null && b !== null && a.length > 0 && b.length > 0 && !sameWords(a, b);
  if (stated.period !== null && declared.period !== null && stated.period !== declared.period) return false;
  // A stated denominator is read up to two words ("per billable day"; "per audit aiming…" reads [audit, aiming]), so
  // two denominators conflict only when NEITHER contains the other: "client" vs "customer" does, "audit aiming" vs
  // "audit" does not.
  if (stated.per !== null && declared.per !== null && stated.per.length > 0 && declared.per.length > 0
    && !containsWords(stated.per, declared.per) && !containsWords(declared.per, stated.per)) return false;
  if (conflicts(stated.base, declared.base)) return false;
  if (conflicts(stated.qualifiers, declared.qualifiers)) return false;
  return true;
}

/** A count's noun and period ("tickets a month" → ticket + month), from the full reader. */
export function readCountRate(unit: unknown): { noun: string[]; period: UnitPeriod | null } | null {
  const p = readUnitParts(unit);
  return p === null || p.kind !== 'count' || p.noun === null ? null : { noun: [...p.noun], period: p.period };
}

/** The one period a set of unit parts names, 'ambiguous' when they name two, else null. */
export function evidencePeriod(parts: readonly string[]): UnitPeriod | null | 'ambiguous' {
  const seen = new Set<UnitPeriod>();
  for (const part of parts) {
    const p = readUnitParts(part);
    if (p?.period != null) seen.add(p.period);
  }
  return seen.size > 1 ? 'ambiguous' : seen.size === 1 ? [...seen][0]! : null;
}

// ── THE ONE SOURCE-LOCATED TAIL READER (moved here from stated-effect.ts `unitsAt`/`nounUnitsAt`) ────────────────

const CURRENCY_TOKEN = /(?:A\$|C\$|NZ\$|[£$€¥₹]|CHF|kr)/iu;

/** Every sub-phrase of the first three words after a plain literal ("12,000 tickets a month" → tickets, tickets a, …). */
export function nounUnitsAt(tail: string): readonly string[] {
  const ws = tail.match(/^\s+((?:[A-Za-z][A-Za-z-]*\s*){1,3})/u)?.[1]
    .trim()
    .split(/\s+/u)
    .map((word) => word.toLowerCase()) ?? [];
  return ws.flatMap((_, start) => ws.slice(start).map((__, end) => ws.slice(start, end + 1).join(' ')));
}

/**
 * ⭐ THE PARTS THE USER STATED after a literal (Codex r1 on #2604, P1): every part the words directly after it state is
 * KEPT — a denominator ("per client"), a period ("a year", "annually"), a share's base ("of revenue"), a count's noun —
 * so C3 can see a conflict instead of a "£" or a "%" with the rest thrown away ("£75,000 per client per year" never
 * binds a "GBP per customer per year" edge). It reads at most four words and stops at punctuation, a digit or a word
 * that is none of these. Null when the literal names no unit at all.
 */
export function statedTailParts(text: string, literal: { index: number; matchedText: string; kind: string }): UnitParts | null {
  const tail = text.slice(literal.index + literal.matchedText.length);
  const toks = (tail.match(/^[\s/]*((?:(?:p\.a\.|[A-Za-z%][A-Za-z%'-]*|\/)[\s]*){1,6})/u)?.[1] ?? '')
    .replace(/\//g, ' / ').trim().toLowerCase().split(/\s+/u).filter((w) => w !== '').slice(0, 6);
  if (tail.match(/^\s*\//u) !== null) toks.unshift('/');
  let k = 0;
  let period: UnitPeriod | null = null;
  let per: string[] | null = null;
  const conflictFree = (p: UnitPeriod): boolean => (period === null || period === p ? ((period = p), true) : false);
  // A period or a denominator, repeatedly: "per client per year", "a month each", "/year".
  const readRateParts = (): boolean => {
    while (k < toks.length) {
      const w = toks[k]!;
      const adverb = periodAdverb(w);
      if (adverb !== null) { if (!conflictFree(adverb)) return false; k += 1; continue; }
      if (isPeriodConnector(w) && k + 1 < toks.length && isLeafPeriodNoun(toks[k + 1]!)) {
        if (!conflictFree(periodNoun(toks[k + 1]!)!)) return false; k += 2; continue;
      }
      if ((w === 'per' || w === '/') && k + 1 < toks.length && /^[a-z]+$/.test(toks[k + 1]!) && !isPeriodConnector(toks[k + 1]!)) {
        const nouns: string[] = [];
        let j = k + 1;
        while (j < toks.length && nouns.length < 2 && /^[a-z]+$/.test(toks[j]!) && !isPeriodConnector(toks[j]!) && periodAdverb(toks[j]!) === null) {
          nouns.push(toks[j]!); j += 1;
        }
        const last = nouns[nouns.length - 1]!;
        if (nouns.length > 1 && isLeafPeriodNoun(last)) { if (!conflictFree(periodNoun(last)!)) return false; nouns.pop(); }
        if (per !== null && per.length > 0) return false;
        per = nouns.map(singular); k = j; continue;
      }
      if (w === 'each' || w === 'apiece') { per = per ?? []; k += 1; continue; }
      break;
    }
    return true;
  };
  if (literal.kind === 'currency') {
    const token = literal.matchedText.match(CURRENCY_TOKEN)?.[0];
    const cur = token === undefined ? null : currencyOf(token);
    if (cur === null) return null;
    if (!readRateParts()) return null;
    return { kind: 'currency', code: cur.code, scale: 1, noun: null, per, base: null, qualifiers: null, period };
  }
  // A share: the literal itself ("18%") or a %/pp phrase right after a plain number ("3 percentage points").
  let share: 'percent' | 'points' | null = literal.kind === 'percent' ? 'percent' : null;
  // "3% points" is percentage POINTS (G1: bare "point(s)" is pp only on a % quantity).
  if (share === 'percent' && (toks[0] === 'point' || toks[0] === 'points')) { share = 'points'; k = 1; }
  if (share === null) {
    for (let n = Math.min(3, toks.length); n >= 1; n -= 1) {
      const kind = shareKind(toks.slice(0, n).join(' '));
      if (kind !== null) { share = kind; k = n; break; }
    }
  }
  if (share !== null) {
    const base = toks[k] === 'of' && k + 1 < toks.length && /^[a-z]+$/.test(toks[k + 1]!) ? [singular(toks[k + 1]!)] : null;
    return { kind: share, code: null, scale: 1, noun: null, per: null, base, qualifiers: null, period: null };
  }
  // A count: the noun phrase (up to three words, to a connector or a period word), then its rate parts.
  const noun: string[] = [];
  while (k < toks.length && noun.length < 3 && /^[a-z][a-z'-]*$/.test(toks[k]!) && !isPeriodConnector(toks[k]!)
    && periodAdverb(toks[k]!) === null && toks[k] !== 'each') {
    noun.push(singular(toks[k]!)); k += 1;
  }
  if (noun.length === 0) return null;
  if (!readRateParts()) return null;
  return { kind: 'count', code: null, scale: 1, noun, per, base: null, qualifiers: null, period };
}

/**
 * The units a literal is written with, read from the words directly after it — ONE reader for the brief and the model.
 * Money → its currency, plus its period when the next words name one ("£75,000 annually" → "£/year"). A percent → "%".
 * A plain number → a %/pp phrase when one follows ("3 percentage points" → only that), else its noun sub-phrases.
 */
export function unitsAt(text: string, literal: { index: number; matchedText: string; kind: string }): readonly string[] {
  const tail = text.slice(literal.index + literal.matchedText.length);
  if (literal.kind === 'percent') return ['%'];
  if (literal.kind === 'currency') {
    const currency = literal.matchedText.match(CURRENCY_TOKEN)?.[0];
    if (currency === undefined) return [];
    // Rendered from the STATED parts, so a denominator is never dropped ("£75,000 per client per year" → £/client/year).
    const parts = statedTailParts(text, literal);
    if (parts === null) return [currency];
    const per = parts.per !== null && parts.per.length > 0 ? `/${parts.per.join(' ')}` : '';
    return [`${currency}${per}${parts.period !== null ? `/${parts.period}` : ''}`];
  }
  const head = tail.match(/^\s+((?:[A-Za-z%][A-Za-z%-]*\s*){1,3})/u)?.[1]?.trim().toLowerCase().split(/\s+/u) ?? [];
  for (let n = Math.min(3, head.length); n >= 1; n -= 1) {
    if (shareKind(head.slice(0, n).join(' ')) !== null) return [head.slice(0, n).join(' ')];
  }
  return nounUnitsAt(tail);
}
