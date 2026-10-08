/** Shared CEE/DGAI words for a licensed deliverable forecast. */
import { sayDate } from './deadline-date.js';

const ARTICLES = new Set(['the', 'our', 'a']);
const PREPOSITIONS_AND_CONJUNCTIONS = new Set([
  'aboard', 'about', 'above', 'absent', 'across', 'after', 'against', 'albeit', 'along', 'alongside', 'although',
  'amid', 'amidst', 'among', 'amongst', 'and', 'around', 'as', 'astride', 'at', 'atop', 'barring', 'because',
  'before', 'behind', 'below', 'beneath', 'beside', 'besides', 'between', 'beyond', 'both', 'but', 'by', 'circa',
  'concerning', 'considering', 'despite', 'down', 'during', 'either', 'except', 'excepting', 'excluding',
  'following', 'for', 'from', 'given', 'if', 'in', 'including', 'inside', 'into', 'lest', 'like', 'minus', 'near',
  'neither', 'nor', 'notwithstanding', 'of', 'off', 'on', 'once', 'onto', 'opposite', 'or', 'out', 'outside',
  'over', 'past', 'pending', 'per', 'plus', 'provided', 'providing', 'regarding', 'respecting', 'round', 'save',
  'since', 'so', 'supposing', 'than', 'that', 'though', 'through', 'throughout', 'till', 'to', 'touching',
  'toward', 'towards', 'under', 'underneath', 'unless', 'unlike', 'until', 'unto', 'up', 'upon', 'versus', 'via',
  'when', 'whenever', 'where', 'whereas', 'wherever', 'whether', 'while', 'with', 'within', 'without', 'yet',
]);
const WORD = /^[\p{L}][\p{L}\p{N}]*(?:[-'’][\p{L}\p{N}]+)*$/u;
const isWord = (word: string): boolean => WORD.test(word) && !/^(?:pre|post)-/u.test(word);
const isModifier = (word: string): boolean => isWord(word) && !PREPOSITIONS_AND_CONJUNCTIONS.has(word);

/** JS `\s` exactly (ECMA-262 WhiteSpace + LineTerminator), read by char code. */
const isSpace = (c: number): boolean => c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 0x1680
  || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;

/** The deliverable's words, lower-cased, in ONE pass with no whole-string copy; null past `max` words. */
function wordsOf(text: string, max: number): string[] | null {
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    if (i === text.length || isSpace(text.charCodeAt(i))) {
      if (start >= 0) {
        if (out.length === max) return null;
        out.push(text.slice(start, i).toLowerCase());
        start = -1;
      }
    } else if (start < 0) start = i;
  }
  return out;
}

/** The longest launch phrase the grammar accepts: article, two modifiers, "launch", "in"/"across" and three place words. */
const MAX_LAUNCH_WORDS = 8;

/** A closed whole-deliverable grammar; an unrecognised phrase keeps the full finishing wording. */
export function deliverableIsALaunch(deliverable: string): boolean {
  const read = wordsOf(deliverable, MAX_LAUNCH_WORDS);
  if (read === null) return false;
  const words = read.length === 0 ? [''] : read;
  if (words[0] === 'launching') {
    const object = words.slice(2);
    return ARTICLES.has(words[1] ?? '') && object.length <= 2 && object.every(isModifier);
  }
  const launch = words.indexOf('launch');
  if (launch < 0) return false;
  const modifiers = words.slice(ARTICLES.has(words[0] ?? '') ? 1 : 0, launch);
  if (modifiers.length > 2 || !modifiers.every(isModifier)) return false;
  const place = words.slice(launch + 1);
  return place.length === 0 || ((place[0] === 'in' || place[0] === 'across')
    && place.length >= 2 && place.length <= 4 && place.slice(1).every(isWord));
}

export function shareGoalChanceWords(deliverable: string, dateIso: string): string {
  return deliverableIsALaunch(deliverable)
    ? `chance of launching by ${sayDate(dateIso)}`
    : `chance of finishing ${deliverable} by ${sayDate(dateIso)}`;
}
