/**
 * ⭐ THE ONE QUANTITY-IDENTITY RULE: whether a figure the user wrote is THIS quantity's. The limit door (`propose_limit_change`)
 * and the value door (`propose_assumptions`) both ask it, and on `not_this` neither writes the quantity.
 *
 * Sources: verifier P05 ("the remote-village constraint … 85%" was refused); Codex R2 on #3424 and R1–R3 on #3433 (nested,
 * symbol and shared-fragment labels; a turned-down figure whose number recurs as another quantity; a headcount written into a
 * rate); DL-3 ("70 customers per week; the existing team capacity is unchanged" saved 70 as the team's capacity).
 *
 * Every written occurrence (the ONE located-amount reader, digits and words) is read on its own, so the user's source and the
 * quantity are always the same occurrence:
 * - **Turned down.** An occurrence the user turned down ("not 90%", "rather than", "instead of") is never theirs, and once they
 *   turned a figure down, another occurrence of it is theirs only where their words name this quantity, never by default.
 * - **Its unit.** The unit written after the figure, read whole by the shared unit reader (`statedTailParts`), must be this
 *   quantity's (`readUnitParts`): the same kind, the same counted thing, the same denominator, and for a count the same period
 *   (2 engineers is a headcount, never 2 engineers a week). Money or a percentage that names no period keeps the quantity's.
 * - **Names.** Its phrase runs from a clause break or conjunction to the next; the quantity's own unit words after the figure
 *   name nothing. It names a quantity by the label's whole phrase (longest labels first, symbols included: "%", "£"), or by a
 *   word only that label has.
 * - **Candidates.** These are the quantities the door could write the figure into: the caller's structural rivals. A phrase
 *   naming this quantity and no other candidate makes the figure this quantity's. A phrase naming another candidate means it
 *   is not.
 * - **Nothing named.** When the phrase names no candidate, the figure is this quantity's only when no other candidate could
 *   hold it, AND either the phrase refers to the model only by words several quantities share ("change the spend limit to
 *   £30,000", "spend" being several siblings' word: DL #2195) or the ordinary attribution of that SAME occurrence
 *   (`figureTheUserWroteForSpan` at its index) reads it so.
 *
 * No word list names a kind of quantity: the model's own labels and units, and the door's candidates, decide.
 */
import { isProseAfterValue, unitFamilyOf } from '../routing/value-unit-resolution.js';
import { isProportionScaledFactor } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { readUnitParts, statedTailParts, type UnitParts } from './same-unit.js';
import { amountsWrittenIn, amountTheUserWrote, figureTheUserWroteForSpan, sameWord, wordsOf, type EntityScope } from './stated-by-user.js';

/**
 * `this`: the user's words give the figure to this quantity. `not_this`: they wrote it, and their words give it elsewhere (another
 * candidate named, a fragment two candidates share, another unit) or turn it down. `unclear`: written, but their words do not say
 * whose (no candidate named and more than one could hold it). `not_written`: not written in this text.
 */
export interface QuantityIdentity {
  readonly verdict: 'this' | 'not_this' | 'unclear' | 'not_written';
  /** On `not_this`: the quantities the user's words give the figure to instead (named, or the only ones its unit fits), for the ask. */
  readonly givenTo: readonly string[];
}
/** A quantity the door could write the figure into instead, with its unit (null when it has none). */
export interface Candidate { readonly label: string; readonly unit: unknown }

/** A figure the user turned down ("at least 85%, not 90%", "rather than 90%"): never their new figure. */
const REJECTED_FIGURE = /\b(?:not|rather\s+than|instead\s+of)\s*[£$€]?\s*$/i;
const CLAUSE_END = /[.!?;,:\n–—]|\b(?:and|but|while|whereas|plus)\b/i;
/** Words, and the symbols a label can be ("%", "£"). */
const tokensOf = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+|[\p{S}%‰]/gu) ?? [];

/**
 * Whether the unit the user wrote after a figure (null: none) can be the quantity's own unit. A percentage for a 0–1 share is the
 * same quantity read in its frame (`isProportionScaledFactor`, as the located-amount reader reads it).
 */
function writtenInItsUnit(stated: UnitParts | null, own: UnitParts | null, share = false): boolean {
  if (stated === null || own === null || (share && stated.kind === 'percent')) return true;
  if (stated.kind !== own.kind) return false;
  // A denominator fits by its head noun ("per senior engineer" is per engineer); "each" names an unnamed one, which fits any.
  const perFits = stated.per === null ? own.per === null
    : stated.per.length === 0 || (own.per !== null && own.per.length > 0 && stated.per.includes(own.per[own.per.length - 1]!));
  if (stated.kind === 'count' ? stated.period !== own.period || !perFits
    : (stated.period !== null && stated.period !== own.period) || (stated.per !== null && !perFits)) return false;
  if (stated.code !== null && own.code !== null && stated.code !== own.code) return false;
  // The counted thing by its head noun ("70 support tickets" counts tickets). A headcount unit (people, hires, FTE, seats:
  // `unitFamilyOf` 'count') counts whatever its phrase names, as the ONE reader reads it (`amountTheUserWrote`): "3 developers"
  // are 3 hires. A share's base is not compared: the reader keeps one word of it ("80% of MY time" against "% of founder
  // working time").
  const counted = own.noun?.[own.noun.length - 1];
  return counted === undefined || unitFamilyOf(counted) === 'count' || (stated.noun ?? []).includes(counted);
}

/** The labels a phrase NAMES: a label's whole phrase, longest labels first ("Annual oven capacity" keeps its words from "Oven capacity"), or a word only that label has. */
function quantitiesNamedIn(phrase: readonly string[], labels: readonly string[]): Set<string> {
  const used = phrase.map(() => false); const named = new Set<string>();
  for (const label of [...labels].sort((a, b) => tokensOf(b).length - tokensOf(a).length)) {
    const ws = tokensOf(label);
    for (let i = 0; ws.length > 0 && i + ws.length <= phrase.length; i++) {
      if (!ws.every((w, k) => !used[i + k] && sameWord(phrase[i + k]!, w))) continue;
      ws.forEach((_, k) => { used[i + k] = true; }); named.add(label);
    }
  }
  for (const label of labels) {
    const own = wordsOf(label).filter((w) => !labels.some((o) => o !== label && wordsOf(o).some((x) => sameWord(x, w))));
    if (own.some((w) => phrase.some((c, i) => !used[i] && sameWord(c, w)))) named.add(label);
  }
  return named;
}

/**
 * Whether `value` in `unit`, as written in `text`, is the figure of `scope.target[0]`. `scope.others` are every other quantity's
 * label (they name); `candidates` are the quantities this door could write the figure into instead (they compete, each only for
 * a figure written in a unit it can hold).
 */
export function figureIsThisQuantitys(
  text: string | null | undefined, value: number, unit: unknown, scope: EntityScope, candidates: readonly Candidate[],
): QuantityIdentity {
  const target = scope.target[0];
  const verdict = (v: QuantityIdentity['verdict'], givenTo: readonly string[] = []): QuantityIdentity => ({ verdict: v, givenTo });
  if (typeof text !== 'string' || target === undefined) return verdict('not_written');
  const labels = [...new Set([target, ...scope.others, ...candidates.map((c) => c.label)])];
  const unitWords = typeof unit === 'string' ? tokensOf(unit) : [];
  const own = readUnitParts(unit);
  const share = isProportionScaledFactor({ unit, cap: undefined, value: undefined, raw_value: undefined });
  const written = amountsWrittenIn(text).filter((a) => amountTheUserWrote(a, value, unit, text)).map((a) => {
    let phraseStart = 0;
    for (const m of text.slice(0, a.index).matchAll(new RegExp(CLAUSE_END.source, 'gi'))) phraseStart = (m.index ?? 0) + m[0].length;
    const lead = text.slice(phraseStart, a.index);
    const end = a.index + a.matchedText.length; const stop = text.slice(end).search(CLAUSE_END);
    // The figure's own phrase ends at the next clause break or conjunction: "2 ovens and the annual …" states no period.
    const phrase = stop < 0 ? text : text.slice(0, end + stop);
    return { a, lead, phrase, tail: tokensOf(phrase.slice(end)), turnedDown: REJECTED_FIGURE.test(lead) };
  });
  if (written.length === 0) return verdict('not_written');
  // A figure the user turned down anywhere is this quantity's only where their words name it, never by default.
  const turnedDown = written.some((w) => w.turnedDown);
  let unclear = false;
  const givenTo = new Set<string>();
  for (const { a, lead, phrase, tail } of written.filter((w) => !w.turnedDown)) {
    const next = /^\s*([A-Za-z][A-Za-z'-]*)/.exec(phrase.slice(a.index + a.matchedText.length))?.[1];
    const stated = a.kind !== 'currency' && a.kind !== 'percent' && next !== undefined && isProseAfterValue(next) ? null : statedTailParts(phrase, a);
    if (!writtenInItsUnit(stated, own, share)) {
      // Written in another unit: the quantities that unit fits are the ones to ask about ("70 specialists": Additional specialists).
      for (const c of candidates) if (c.label !== target && ((p) => p !== null && writtenInItsUnit(stated, p))(readUnitParts(c.unit))) givenTo.add(c.label);
      continue;
    }
    // A rival competes only for a figure written in a unit it can hold ("1,500 Pro subscribers" is no price's).
    const competing = candidates.filter((c) => c.label !== target
      && (stated === null || ((p) => p !== null && writtenInItsUnit(stated, p))(readUnitParts(c.unit)))).map((c) => c.label);
    const words = [...tokensOf(lead), ...tail.filter((w) => !unitWords.some((u) => sameWord(u, w)))];
    const named = quantitiesNamedIn(words, labels);
    if (competing.some((c) => named.has(c))) { competing.filter((c) => named.has(c)).forEach((c) => givenTo.add(c)); continue; }
    if (named.has(target)) return verdict('this');
    // Against each competing quantity, its own words decide: a word only this quantity has ("SENIOR engineers", against the
    // junior salary) and none only the rival has. A rival's own word gives the figure to the rival; the whole fragment both
    // share, with neither's own word, names neither ("support capacity": Annual or Monthly?). One shared word in passing
    // ("Blue's ANNUAL quote") says nothing.
    const holds = (ws: readonly string[]): boolean => ws.some((w) => words.some((c) => sameWord(c, w)));
    const versus = competing.map((r) => {
      const t = wordsOf(target); const o = wordsOf(r);
      const shared = t.filter((w) => o.some((x) => sameWord(x, w)));
      const tIn = holds(t.filter((w) => !o.some((x) => sameWord(x, w)))); const rIn = holds(o.filter((w) => !t.some((x) => sameWord(x, w))));
      return tIn && !rIn ? 'this' : rIn || (shared.length > 0 && shared.every((w) => holds([w]))) ? 'rival' : 'silent';
    });
    if (versus.includes('rival')) { competing.filter((_, i) => versus[i] === 'rival').forEach((c) => givenTo.add(c)); continue; }
    if (versus.length > 0 && versus.every((v) => v === 'this')) return verdict('this');
    // With no other candidate: words several quantities share name none of them ("the spend limit"), so they never give the
    // figure away; with no model word at all, the ordinary attribution of this occurrence decides ("Revenue was £6,000 …").
    if (!turnedDown && competing.length === 0 && ((named.size === 0 && labels.some((l) => holds(wordsOf(l))))
      || figureTheUserWroteForSpan(value, unit, text, { ...scope, at: a.index }) !== null)) return verdict('this');
    unclear = true;
  }
  return unclear ? verdict('unclear') : verdict('not_this', [...givenTo]);
}
