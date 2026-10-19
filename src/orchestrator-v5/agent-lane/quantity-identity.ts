/**
 * ⭐ THE ONE QUANTITY-IDENTITY RULE: whether a figure the user wrote is THIS quantity's. The limit door (`propose_limit_change`)
 * and the value door (`propose_assumptions`' field binding) both ask it.
 *
 * Sources: verifier P05 ("the remote-village constraint … 85%" was refused); Codex R2 on #3424 and R1/R2 on #3433 (nested,
 * symbol and shared-fragment labels, and a turned-down figure whose number recurs as another quantity); DL-3 ("70 customers per
 * week; the existing team capacity is unchanged" saved 70 as the team's capacity with no "binding unverified" label).
 *
 * The rule reads ONE written occurrence at a time, so the user's source and the quantity are always the same occurrence:
 * - **Turned down.** An occurrence the user turned down ("not 90%", "rather than", "instead of") is never theirs, and once they
 *   turned a figure down, another occurrence of it is theirs only where their words name this quantity, never by default.
 * - **Counts another thing.** A plain figure counts the label words written straight after it. When those words hold none of
 *   this quantity's unit words, it counts another thing, not this quantity ("90 requests" against a % limit).
 * - **Names.** Its phrase runs from a clause break or conjunction to the next; the quantity's own unit words after the figure
 *   name nothing. The phrase names a quantity by the label's whole phrase (longest labels first, symbols included: "%", "£"),
 *   or by a word only that label has.
 * - **Candidates.** These are the quantities the door could write the figure into: the caller's structural rivals. A phrase
 *   naming this quantity and no other candidate makes the figure this quantity's. A phrase naming another candidate means it
 *   is not.
 * - **Nothing named.** When the phrase names no candidate, the figure is this quantity's only when no other candidate could
 *   hold it, AND either the phrase names no quantity at all ("change the spend limit to £30,000", "spend" being several
 *   siblings' word: DL #2195) or the ordinary attribution of that SAME occurrence (`figureTheUserWroteForSpan` at its index)
 *   reads it so.
 *
 * No word list names a kind of quantity: the model's own labels and the door's candidates decide.
 */
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { figureTheUserWroteForSpan, figureTheUserWroteSpan, sameWord, wordsOf, type EntityScope } from './stated-by-user.js';

/** A figure the user turned down ("at least 85%, not 90%", "rather than 90%"): never their new figure. */
const REJECTED_FIGURE = /\b(?:not|rather\s+than|instead\s+of)\s*[£$€]?\s*$/i;
const CLAUSE_END = /[.!?;,:\n–—]|\b(?:and|but|while|whereas|plus)\b/i;
/** Words, and the symbols a label can be ("%", "£"). */
const tokensOf = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+|[\p{S}%‰]/gu) ?? [];

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
 * label (they name); `candidates` are the labels this door could write the figure into instead (they compete).
 */
export function figureIsThisQuantitys(
  text: string | null | undefined, value: number, unit: unknown, scope: EntityScope, candidates: readonly string[],
): boolean {
  const target = scope.target[0];
  if (typeof text !== 'string' || target === undefined) return false;
  const labels = [...new Set([target, ...scope.others, ...candidates])];
  const unitWords = typeof unit === 'string' ? tokensOf(unit) : [];
  const isUnitWord = (w: string): boolean => unitWords.some((u) => sameWord(u, w));
  const isLabelWord = (w: string): boolean => labels.some((l) => wordsOf(l).some((x) => sameWord(x, w)));
  const kindAt = new Map(findStatedAmounts(text).map((a) => [a.index, a.kind]));
  const written: { start: number; lead: string; tail: string[]; turnedDown: boolean }[] = [];
  for (let from = 0; from < text.length;) {
    const at = figureTheUserWroteSpan(value, unit, text.slice(from));
    if (at === null) break;
    const start = from + at.start; const end = from + at.end;
    from = end;
    let phraseStart = 0;
    for (const m of text.slice(0, start).matchAll(new RegExp(CLAUSE_END.source, 'gi'))) phraseStart = (m.index ?? 0) + m[0].length;
    const lead = text.slice(phraseStart, start);
    const rest = text.slice(end); const stop = rest.search(CLAUSE_END);
    written.push({ start, lead, tail: tokensOf(stop < 0 ? rest : rest.slice(0, stop)), turnedDown: REJECTED_FIGURE.test(lead) });
  }
  // A figure the user turned down anywhere is this quantity's only where their words name it, never by default.
  const turnedDown = written.some((w) => w.turnedDown);
  for (const { start, lead, tail } of written.filter((w) => !w.turnedDown)) {
    const kind = kindAt.get(start) ?? 'words';
    if (kind === 'plain' || kind === 'words') {
      const stopAt = tail.findIndex((w) => !isUnitWord(w) && !isLabelWord(w));
      const counted = stopAt < 0 ? tail : tail.slice(0, stopAt);
      if (unitWords.length > 0 && counted.length > 0 && !counted.some(isUnitWord)) continue;
    }
    const named = quantitiesNamedIn([...tokensOf(lead), ...tail.filter((w) => !isUnitWord(w))], labels);
    if (candidates.some((c) => c !== target && named.has(c))) continue;
    if (named.has(target)) return true;
    if (!turnedDown && candidates.every((c) => c === target) && (named.size === 0
      || figureTheUserWroteForSpan(value, unit, text, { ...scope, at: start }) !== null)) return true;
  }
  return false;
}
