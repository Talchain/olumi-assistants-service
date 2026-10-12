/**
 * ⭐ G — A CHANGE TARGET'S CONDITIONAL CHANCE ON A STATIC MODEL (AIE #94 6128697025, "S4/S8 — D timing decision"; amendments
 * 6131950992 (b)–(d) and 6133027121, 12 Oct 2026; DL G round 2, 13 Oct, answering check CHECK-f46cd7c5 BLOCKING).
 *
 * A static model may support a CONDITIONAL chance of a change target "by month N" under a disclosed assumption that its
 * estimated effects have occurred by then. The assumption is OLUMI'S, never the person's: the stored basis keeps
 * `effects_at_period_end: false` (it is never flipped as human evidence), and the chance carries {@link periodEndAssumptionNote}.
 * The licence decides whether the reading applies (`periodEndConditionalOf`, `goal-chance-licence.ts`); this module holds
 * only its two pieces of words-and-grammar:
 *
 *  · the AIE's note, exactly, for the STATIC timing-assumption reading only (amendment (b): a producer that models arrival,
 *    or sizes its effects at the period, says its own timing instead);
 *  · {@link statedEffectTiming}: whether the brief says ANYTHING about when, how fast or how much of an effect arrives.
 *
 * ⛔ FAIL SAFE, BY CLASS (DL G r2). Round 1 listed the contradictions it recognised ("only half … by month 3", "won't see the
 * full gain until month 6", …) and licensed everything else, so "The hires start in month four." (after a 3-month period)
 * escaped and a chance was shown. A phrase list of contradictions can never be complete, so the default is inverted: the
 * conditional chance is licensed ONLY when the brief states no timing at all beyond the goal's own period phrase. Any time unit,
 * calendar point, onset ("start", "kick in"), onboarding/ramp/learning/delay, pace or sequence ("gradually", "until", "after",
 * "first"), share in place ("partly", "half", "fully"), movement over time ("dips", "builds up") or launch-relative time
 * withholds with E's existing sentence. A false withhold is
 * acceptable; a false chance is not. The AIE corpus's NOT_A_CONTRADICTION cases (a start alone, a negated partial, a past
 * programme, another quantity's timing, an upper bound) all state timing, so they now withhold too.
 *
 * THE GOAL'S OWN PERIOD PHRASE is excused by IDENTITY with the held basis, never by text similarity: the ONE phrase in the
 * brief that states arrival BY a point ("in the next three months", "within 3 months", "by the end of month three", "at three
 * months") whose value is the basis' own `period_months` from its own `reference`. Two such phrases, another value, another
 * reference, or a clause that negates, limits or doubts it ("won't … by month 3", "only … within three months") or states an
 * amount of the goal's kind other than the held target's own ("a 5% gain in the next three months") excuse nothing. A clause left excused can
 * only state arrival BY the period, which is the assumption itself, so it cannot make the chance false.
 *
 * THE INVARIANT (the same as `time-class.ts`): A DETECTION CAN ONLY WITHHOLD. No timing found never attests arrival: the chance
 * still says Olumi's assumption, and amendment (d) (an unread source is never "no timing") is the caller's. Pure.
 */
import { periodEndWords, type GoalTargetBasis } from './goal-target-basis.js';

/** The AIE's note, verbatim, with {period} as the period-end words E's withhold uses ("month three"). Said once per result. */
export const PERIOD_END_ASSUMPTION_NOTE_TEMPLATE = 'Provisional: this calculation assumes the estimated effects are in place by {period}. It does not model when they arrive.';

export function periodEndAssumptionNote(basis: Pick<GoalTargetBasis, 'reference' | 'period_months'>): string {
  return PERIOD_END_ASSUMPTION_NOTE_TEMPLATE.replace('{period}', periodEndWords(basis));
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const WORD_COUNT = `(?:${[...NUMBER_WORDS].sort((a, b) => b.length - a.length).join('|')})`;
const COUNT = `(?:\\d{1,3}|${WORD_COUNT})`;
const countOf = (word: string): number => {
  const w = word.toLowerCase();
  return /^\d+$/.test(w) ? Number(w) : w === 'a' || w === 'an' ? 1 : NUMBER_WORDS.indexOf(w);
};

/**
 * A phrase stating arrival BY a point, in months or years, with its own reference when it names one: "in the next three
 * months", "within 3 months' time", "by the end of month three", "at three months", "over the first three months after launch".
 */
const BY_PERIOD = new RegExp(
  `\\b(?:by|in|within|inside|over|during|at)\\s+(?:the\\s+end\\s+of\\s+)?(?:the\\s+)?(?:(?:next|coming|first|following)\\s+)?`
  + `(?:month\\s+(?<point>${COUNT})\\b|(?<count>${COUNT}|an?)\\s+(?<unit>months?|years?)\\b(?:['’]?\\s+time\\b)?)`
  + `(?:\\s+(?:of|after|from|following|since|post|past|into|beyond)\\s+(?:the\\s+)?(?<ref>[\\p{L}-]+))?`,
  'giud');

/** In the excused phrase's own clause, a word that negates, limits, doubts or reverses it: then it is not the goal's period. */
const UNSETTLES = /(?:\b(?:not|never|no|none|nothing|nor|neither|without|unlikely|doubt\w*|fail\w*|miss\w*|struggl\w*|barely|hardly|scarcely|little|only|just|merely|less|fewer|lower|worse|dip\w*|drop\w*|fall\w*|fell|declin\w*|slump\w*|lose|loses|losing|lost|loss|reduc\w*|disrupt\w*|distract\w*|hurt\w*|harm\w*|unclear|uncertain\w*|unknown|maybe|might|may|perhaps|possibl\w*|hope\w*)\b|n['’]t\b)/iu;

const CLAUSE_END = /[.!?](?=\s|$)|[;\n]/gu;
const AMOUNT = `(?:\\d[\\d,]*(?:\\.\\d+)?|\\b${WORD_COUNT})`;
/**
 * An amount of the goal's kind in the excused clause — a percentage or points, money, or a figure in the basis' own effect unit
 * ("a 5% gain", "£50,000 more", "4 extra customers") — never a count of the options' own things ("two developers"). Only the
 * held target's own figure may stand beside the goal's period.
 */
function amountsOf(clause: string, basis: Pick<GoalTargetBasis, 'effect_unit'>): number[] {
  const unit = /^[\p{L}]{3,}/u.exec(basis.effect_unit.trim())?.[0];
  const kinds = ['%', 'per\\s?cent', 'percent', 'percentage\\s+points?', 'points?', 'pp', ...(unit === undefined ? [] : [`${unit.replace(/s$/u, '')}s?`])];
  const amount = new RegExp(`[£$€¥]\\s?(?<money>\\d[\\d,]*(?:\\.\\d+)?)|(?<n>${AMOUNT})\\s?(?:${kinds.join('|')})(?![\\p{L}])`, 'giu');
  return [...clause.matchAll(amount)].map((m) => {
    const figure = (m.groups?.money ?? m.groups?.n ?? '').trim();
    return /^\d/.test(figure) ? Number(figure.replace(/,/g, '')) : countOf(figure);
  });
}

type HeldBasis = Pick<GoalTargetBasis, 'period_months' | 'reference' | 'target_raw' | 'effect_unit'>;

/** The goal's own period phrase, by identity with the held basis, as [start, end) in the brief — or undefined. */
function goalPeriodPhraseOf(brief: string, basis: HeldBasis): readonly [number, number] | undefined {
  const own: [number, number][] = [];
  for (const m of brief.matchAll(BY_PERIOD)) {
    const g = m.groups ?? {};
    const n = g.point !== undefined ? countOf(g.point) : g.count !== undefined ? countOf(g.count) * (/^year/i.test(g.unit ?? '') ? 12 : 1) : -1;
    const ref = g.ref === undefined ? 'today' : /^(?:now|today)$/i.test(g.ref) ? 'today' : /^launch(?:ing|es)?$/i.test(g.ref) ? 'launch' : 'other';
    if (n === basis.period_months && ref === basis.reference) own.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  if (own.length !== 1) return undefined;
  const [start, end] = own[0]!;
  // Its clause: from the sentence end before it to the next one (a decimal point such as "10.5%" ends no sentence).
  const stops = [...brief.matchAll(CLAUSE_END)].map((m) => m.index ?? 0);
  const from = Math.max(-1, ...stops.filter((i) => i < start)) + 1;
  const to = Math.min(brief.length, ...stops.filter((i) => i >= end));
  const clause = `${brief.slice(from, start)} ${brief.slice(end, to)}`;
  if (UNSETTLES.test(clause)) return undefined;
  return amountsOf(clause, basis).every((v) => v === basis.target_raw) ? [start, end] : undefined;
}

const re = (source: string): RegExp => new RegExp(source, 'iu');
/** Every family of timing the class covers; any match outside the goal's own period phrase withholds. */
const TIMING: readonly RegExp[] = [
  // A unit of time, anywhere: "month four", "takes six weeks", "a couple of quarters", "2% a month", "90 days".
  re(String.raw`\b(?:months?|weeks?|weekends?|days?|years?|quarters?|fortnights?|sprints?|hours?|semesters?|mos|wks|yrs|annum|monthly|weekly|daily|yearly|annual(?:ly)?|quarterly|fortnightly|bi-?weekly|bi-?monthly)\b`),
  // Time itself: "over time", "a timeline", "time to productivity", "a while", "the deadline" (never "full-time"/"part-time").
  re(String.raw`(?<!\b(?:full|part|real|one)[\s-])\btim(?:e|es|ing|eline|elines|eframe|eframes|escale|escales|etable|etables)\b|\ba\s+while\b|\bawhile\b|\bduration\b|\bperiods?\b|\bdeadlines?\b|\bschedul\w*|\bmilestones?\b|\bhorizons?\b`
    + String.raw`|\b(?:by|from|until|till|before|after|on)\s+(?:the\s+|that\s+|this\s+)?dates?\b|\b(?:due|target|completion|delivery|joining|go[\s-]live)\s+dates?\b|\bdated\b`
    + String.raw`|\b(?:ago|ages|long|longer|longest|season\w*|monday|tuesday|wednesday|thursday|friday|saturday|sunday|asap)\b`),
  // A calendar point: a month's name, a quarter or half, a financial year, a year, a dated day, a season or holiday.
  re(String.raw`\b(?:january|february|march|april|june|july|august|september|october|november|december)\b`
    + String.raw`|(?<=\b(?:in|by|from|until|till|before|after|since|of|early|mid|late|end\s+of)\s+)may\b|\bmay\s+\d|\d(?:st|nd|rd|th)?\s+may\b`
    + String.raw`|\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d|\d(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b`
    + String.raw`|\b[qh][1-4]\b|\bfy\s?['’]?\d{2,4}\b|\beo[ymq]\b|(?<![£$€¥\d.,])\b(?:19|20)\d{2}\b(?![.,]\d)|\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b`
    + String.raw`|\b(?:spring|summer|autumn|winter|christmas|xmas|easter|new\s+year|tomorrow|tonight|yesterday)\b`),
  // An onset or arrival: "start", "begin", "kick in", "take effect", "materialise", "arrive", "come through", "pay off", "in place".
  re(String.raw`\b(?:start(?:s|ed|ing)?|begin(?:s|ning)?|began|begun|commenc\w*|kick(?:s|ed|ing)?[\s-]+(?:in|off)|take(?:s|n)?\s+effect|taking\s+effect|took\s+effect`
    + String.raw`|(?:come|comes|coming|came)\s+(?:in|through|online|on\s+stream|on\s+board|into\s+(?:effect|play|force))|materiali[sz]\w*|arriv\w*|appear(?:s|ed|ing|ance)?`
    + String.raw`|show(?:s|ed|ing)?\s+up|land(?:s|ed|ing)?|realised|realized|realisation|realization|pay(?:s|ing)?[\s-]+(?:off|back)|paid\s+(?:off|back)|payback`
    + String.raw`|bear(?:s|ing)?\s+fruit|in\s+place|go(?:es|ing)?[\s-]+live|went\s+live|outset|get[\s-]?go|from\s+the\s+off)\b`),
  // Onboarding, ramp-up and delay: "onboarding", "induction", "ramp up", "settle in", "up to speed", "learning curve", "delay", "lag".
  re(String.raw`\b(?:on-?board\w*|induct\w*|ramp\w*|warm[\s-]?up|bed(?:s|ded|ding)?\s+in|settl\w*|up\s+to\s+speed|learning\s+curve|notice|probation\w*`
    + String.raw`|hand-?overs?|lead[\s-]?times?|lag\w*|delay\w*|wait\w*|postpon\w*|defer\w*|slip(?:s|ped|page)?|train(?:s|ed|ing|ee|ees)?|learn\w*`
    + String.raw`|familiari[sz]\w*|adjust\w*|adapt\w*|integrat\w*|acclimati[sz]\w*|get(?:s|ting)?\s+used\s+to|temporar\w*|transition\w*|interim)\b`),
  // Pace and sequence: "gradually", "slowly", "immediately", "soon", "later", "eventually", "in stages", "until", "after", "once", "yet".
  re(String.raw`\b(?:gradual\w*|slow\w*|quick\w*|fast(?:er|est)?|rapid\w*|swift\w*|immediate\w*|instant\w*|straight\s+away|right\s+away|at\s+once|soon\w*`
    + String.raw`|early|earlier|earliest|late|later|latest|eventual\w*|in\s+due\s+course|progressive\w*|incremental\w*|step[\s-]by[\s-]step|phas(?:e|es|ed|ing)`
    + String.raw`|stagger\w*|in\s+stages|by\s+stages|steadil\w*|overnight|initial\w*|at\s+first|to\s+begin\s+with|short[\s-]term|long[\s-]term|medium[\s-]term`
    + String.raw`|near[\s-]term|meantime|meanwhile|until|till|til|not\s+before|no\s+(?:earlier|sooner)\s+than|by\s+then|since|thereafter|afterwards?|after`
    + String.raw`|before|beforehand|prior\s+to|once|when(?:ever)?|already|yet|for\s+now|from\s+now|right\s+now|by\s+now|so\s+far|still|first|then|next|last|lastly`
    + String.raw`|finally|ultimately|end|ends|ended|ending|ahead|pace|paced|speed|tempo|stages?|momentum|(?:front|back)[\s-]?loaded)\b`
    // "while" says when, except before a participle ("while maintaining code quality": a condition, not a time; every
    // onboarding, training, settling or waiting participle is caught on its own above).
    + String.raw`|\bwhile\b(?!\s+[\p{L}]+ing\b)`),
  // How the effect moves over time: "dips", "slumps", "falls back", "recovers", "builds up", "grows", "peaks", "plateaus", "fades".
  re(String.raw`\b(?:dip(?:s|ped|ping)?|slump\w*|fall(?:s|ing|en)?|fell|drop(?:s|ped|ping)?|declin\w*|worsen\w*|suffer\w*|setbacks?|recover\w*|rebound\w*`
    + String.raw`|bounce(?:s|d)?\s+back|build(?:s|ing)?\s+up|built\s+up|grow\w*|grew|climb\w*|accumulat\w*|compound\w*|snowball\w*|peak\w*|plateau\w*`
    + String.raw`|level(?:s|led|ling)?\s+off|tail(?:s|ed|ing)?\s+off|fade\w*|wear(?:s|ing)?\s+off|wore\s+off|pick(?:s|ed|ing)?\s+up|take(?:s)?\s+hold|curve)\b`),
  // How much is in place: "partly", "half", "a third", "some of", "40% of the gain", "fully", "in full", "none", "the whole".
  re(String.raw`\b(?:partly|partial\w*|half|halves|halfway|thirds?|three[\s-]quarters|fraction\w*|portion\w*|proportion\s+of|percentage\s+of|share\s+of`
    + String.raw`|some\s+of|part\s+of|most\s+of|much\s+of|little\s+of|bit\s+of|none|nothing|not\s+all|in\s+full|fully|full(?![\s-]time)|whole|entire\w*|complete(?:ly)?)\b`
    + String.raw`|\b\d{1,3}(?:\.\d+)?\s?(?:%|per\s?cent)\s+of\s+(?:the|its|their|this|that|our|these|those)\b`),
  // Launch-relative time: "after launch", "post-launch", "by launch".
  re(String.raw`\b(?:post|pre)[\s-]?launch\w*|\b(?:from|after|by|at|until|till|before|following|since)\s+(?:the\s+)?launch\b`),
];

/**
 * The first words in the brief that say anything about WHEN, HOW FAST or HOW MUCH of an effect arrives, other than the goal's
 * own period phrase (excused by identity with the held `basis`); undefined only when the brief states no timing at all. Any
 * result withholds the conditional chance (E's sentence). Never called on an unread brief (the caller withholds, amendment (d)).
 */
export function statedEffectTiming(brief: string, basis: HeldBasis): string | undefined {
  const own = goalPeriodPhraseOf(brief, basis);
  const rest = own === undefined ? brief : `${brief.slice(0, own[0])}${' '.repeat(own[1] - own[0])}${brief.slice(own[1])}`;
  // The earliest timing words in the brief, from any family.
  const first = TIMING.map((timing) => timing.exec(rest)).filter((m): m is RegExpExecArray => m !== null)
    .sort((x, y) => x.index - y.index)[0];
  return first?.[0].replace(/\s+/gu, ' ').trim();
}
