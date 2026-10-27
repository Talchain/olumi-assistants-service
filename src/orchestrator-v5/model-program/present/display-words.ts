/**
 * The screen's words for a comparator and a displayed percentage, and the display rounding a chance's precision earns.
 * The program's presenter needs only these, so they live apart from the legacy goal-target modules they came from
 * (`goal-target-basis.ts`, `goal-chance-driver.ts`, `goal-targets-joint.ts`), which re-export them (ALPHA-CODE-INVENTORY §1 F0).
 */
import type { GoalChanceDisplayRounding } from '../../goal-target/goal-chance-display.js';

const COMPARATOR_WORDS: Readonly<Record<string, string>> = { '>=': 'at least', '>': 'above', '<=': 'at most', '<': 'below' };
export const comparatorWords = (op: unknown): string | undefined => typeof op === 'string' ? COMPARATOR_WORDS[op] : undefined;

const TOL = 1e-9;
/** Ruling 5: the widest Wilson half-width, in percentage points, that is still shown as a whole percentage. */
export const WHOLE_PCT_MAX_HALF_WIDTH_POINTS = 2.5;

/** Ruling 5 on a half-width in percentage points. */
export function displayRoundingFor(halfWidthPoints: number): GoalChanceDisplayRounding {
  return halfWidthPoints <= WHOLE_PCT_MAX_HALF_WIDTH_POINTS + TOL ? 'whole' : 'nearest_5';
}

/**
 * A model unit as a person writes it about their own situation (W8 c7.3: "ticket / week / specialist" read as code): each
 * "/" is "per", a period comes last, and what is counted is plural unless there is exactly one of it.
 *   "ticket/week/specialist" → "tickets per specialist per week"; "GBP/customer/month" → "GBP per customer per month" (the
 *   figure formatter then writes "£20 per customer per month"); "%/week" → "% per week"; "1/month/%" → "per percentage
 *   point per month"; "loaf/week" with 1 → "loaf per week".
 * A unit with no "/" keeps its own words (only its underscores read as spaces); the pure number "1" is nothing.
 */
const PERIODS = /^(?:second|minute|hour|day|week|fortnight|month|quarter|year)s?$/i;
const UNCOUNTED = /(?:people|staff|personnel|data|feedback|revenue|money|equipment|software|information|work|time|capacity|traffic|cash)$/i;
const IRREGULAR: Readonly<Record<string, string>> = { person: 'people', child: 'children', man: 'men', woman: 'women' };
const pluralOf = (words: string): string => {
  const last = /([a-z]+)$/.exec(words)?.[1];
  // Only plain lower-case words, the last of three letters or more, are made plural: "kg", "FTE", "% monthly" and "%" stay
  // as written, and so does a word already plural or one that is never counted.
  if (last === undefined || !/^[a-z][a-z -]*$/.test(words) || last.length < 3 || last.endsWith('ly') || UNCOUNTED.test(words)
    || (last.endsWith('s') && !last.endsWith('ss'))) return words;
  const many = IRREGULAR[last] ?? (/[^aeiou]y$/.test(last) ? `${last.slice(0, -1)}ies` : /(?:s|x|z|ch|sh)$/.test(last) ? `${last}es`
    : /[al]f$/.test(last) ? `${last.slice(0, -1)}ves` : `${last}s`);
  return `${words.slice(0, words.length - last.length)}${many}`;
};
export function unitWords(unit: unknown, value?: number | null): string {
  if (typeof unit !== 'string') return '';
  const u = unit.replace(/_/g, ' ').trim();
  if (u === '' || u === '1') return '';
  if (!u.includes('/')) return value === 1 ? u : pluralOf(u);
  const [head = '', ...per] = u.split('/').map((p) => p.trim());
  const pers = [...per.filter((p) => !PERIODS.test(p)), ...per.filter((p) => PERIODS.test(p))]
    .map((p) => `per ${p === '%' ? 'percentage point' : p}`).join(' ');
  return head === '' || head === '1' ? pers : `${value === 1 ? head : pluralOf(head)} ${pers}`;
}

/** "about 37%", "less than 1%", "more than 99%" — the screen's one edge-word rule for a displayed whole percentage. */
export function sayDisplayedPct(pct: number): string {
  return pct === 0 ? 'less than 1%' : pct === 100 ? 'more than 99%' : `about ${pct}%`;
}
