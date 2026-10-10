/**
 * ⭐ THE SUPPORTED TIME CLASS, AS THE CODE'S OWN BOUNDARY (S4 "time", DL github-6d GO on the design; AIE/PL ACK of the words).
 *
 * WHAT THE PRODUCT COMPUTES AT A HELD MONTH H (read from the code, `accumulation-identity.ts`, `ceiling-stock.ts`,
 * `goal-horizon-verdict.ts`): ONE stock with a stated starting level, ONE constant net monthly change after losses (or an
 * inflow and a monthly churn rate), and ONE target (>=) or fixed ceiling (<=) checked AT month H. The accumulation carrier is
 * `[stock, rate, inflow]` + H: there is no start month, no schedule, no time-varying ceiling, no seasonal path. So a brief that
 * STATES such a mechanism ("rent a second depot, starting in month 3, which lifts the ceiling by 600") is OUTSIDE the class,
 * and a chance computed as if the mechanism acted from month 0 would be manufactured certainty (served T3, 10 Oct: the
 * ceiling card was confirmed, a chance was licensed, and the month-3 start was ignored without a word).
 *
 * THE INVARIANT (stated here, pinned by `time-class.test.ts` and `time-class.guard.test.ts`):
 *   A DETECTION CAN ONLY WITHHOLD AND SAY SO. It never credits, computes, licenses or sizes anything, and it never makes a
 *   chance appear that was absent. Reading the brief's text is acceptable here ONLY because it fails safe: a brief the grammar
 *   below does not recognise behaves exactly as before; a brief it does recognise loses the at-H chance (and the card that
 *   would have licensed one) and gets one plain sentence in the user's own words.
 *
 * STRUCTURE FIRST: no onset / step / seasonal field exists on the drafted graph (`InterventionV3`, `OptionV3`, the candidate
 * intervention carry value, unit, kind, range and free-text reasoning only; the accumulation carrier is `[stock, rate, inflow]`
 * + H), so there is nothing typed to read; the closed grammar below over the stored brief is the only signal. If a typed field
 * is ever added, it becomes the authority and this text reading the fallback.
 *
 * The grammar is deliberately TIGHT (a closed list, not a language model): an onset VERB must sit next to a MONTH reference,
 * so "review in month 3" or "within 12 months" is not an onset. Pure.
 */

export type UnsupportedTimeKind = 'scheduled_start' | 'seasonal' | 'gradual_build_up';

export interface UnsupportedTimeShape {
  readonly kind: UnsupportedTimeKind;
  /** The user's own phrase, verbatim from the brief (the sentence quotes it). */
  readonly words: string;
}

export interface TimeClass {
  /** True when the brief states none of the shapes the product cannot yet work out over time. */
  readonly supported: boolean;
  readonly shapes: readonly UnsupportedTimeShape[];
}

const NUMBER_WORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty)';
const ORDINAL = '(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)';
const COUNT = `(?:\\d{1,3}|${NUMBER_WORD})`;
/** Where in time a change begins: "in month 3", "from the third month", "after 3 months", "3 months in", "3 months from now". Month 0/1 and "the first month" are the start of the horizon, not a later onset. */
const WHEN = `(?:(?:in|from|at)\\s+(?:the\\s+)?month\\s+(?!(?:0|1|zero|one)\\b)${COUNT}|(?:in|from|at)\\s+(?:the\\s+)?(?!first\\b)${ORDINAL}\\s+month|after\\s+${COUNT}\\s+months?|${COUNT}\\s+months?\\s+(?:in|from\\s+now|later))`;
/** A verb that says a change BEGINS (not merely that something happens at a time). */
const ONSET = '(?:start(?:s|ing)?|begin(?:s|ning)?|commenc(?:es?|ing)|kick(?:s|ing)?\\s+in|takes?\\s+effect|taking\\s+effect|come(?:s)?\\s+(?:on\\s*line|into\\s+(?:use|effect|service)))';

const SCHEDULED_START = new RegExp(`\\b${ONSET}\\s+(?:${WHEN})`, 'iu');
const SEASONAL = /\b(?:seasonal(?:ity|ly)?|alternate\s+months|every\s+other\s+month|each\s+(?:summer|winter|spring|autumn)|peak\s+season|off[- ]season|in\s+(?:the\s+)?(?:summer|winter)\s+months)\b/iu;
const GRADUAL = /\b(?:ramp(?:s|ed|ing)?\s+up|phase[sd]?\s+in|phasing\s+in|build(?:s|ing)?\s+up\s+(?:gradually|slowly|over)|gradually\s+(?:rises?|increases?|grows?|builds?))\b/iu;

/** The brief's sentences, as written (a full stop must be followed by a capital to end one; a hard-wrapped line does not, only a blank line does). */
const sentencesOf = (brief: string): string[] => brief.split(/(?<=[.!?])\s+(?=[A-Z“"‘(])|\n\s*\n/u).map(s => s.trim()).filter(s => s !== '');

/**
 * The shapes the brief STATES that the product cannot yet work out over time. Empty for no brief, an unrecognised brief, or a
 * brief inside the supported class. Order: as written in the brief.
 */
export function timeClassOf(brief: string | null | undefined): TimeClass {
  if (typeof brief !== 'string' || brief.trim() === '') return { supported: true, shapes: [] };
  const shapes: UnsupportedTimeShape[] = [];
  for (const sentence of sentencesOf(brief)) {
    for (const [kind, pattern] of [['scheduled_start', SCHEDULED_START], ['seasonal', SEASONAL], ['gradual_build_up', GRADUAL]] as const) {
      const hit = pattern.exec(sentence);
      if (hit !== null) shapes.push({ kind, words: hit[0].replace(/\s+/gu, ' ').trim() });
    }
  }
  return { supported: shapes.length === 0, shapes };
}

/**
 * The one sentence the user sees (DL github-6d GO, exact bytes pending AIE/PL ACK before merge): their own phrase, verbatim, then
 * what Olumi cannot yet model, then the consequence for the month their goal is for. One shape is named (the first as written).
 */
export function unsupportedTimeSentence(shape: UnsupportedTimeShape, month: number): string {
  const cannot = shape.kind === 'scheduled_start' ? 'when a change starts'
    : shape.kind === 'seasonal' ? 'how something changes by season' : 'a gradual build-up';
  return `You said ‘${shape.words}’. Olumi can't yet model ${cannot}, so it won't give a chance for month ${month}.`;
}
