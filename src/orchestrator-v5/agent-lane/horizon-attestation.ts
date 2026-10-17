/**
 * ⭐ IS THE GOAL'S DEADLINE THE BRIEF'S? — `attestHorizon` (MG's drafting half of G1; Codex PJ-A2 rows 25–27).
 *
 * The drafter types the deadline as `goal.horizon_months`. G1 stores it on the goal (`goal_horizon_months`,
 * `holdStatedGoalAttributes` in `stated-by-user.ts`) ONLY when the brief attests it. Before this helper the only
 * attestation was a literal "N months", so "over the next year" was never held, and nothing kept an unresolvable
 * deadline's own words ("by Q3").
 *
 * ATTEST, NEVER EXTRACT. The typed candidate makes the claim; the brief can only confirm it:
 *  · `attested` — the candidate's month count is a positive whole number AND the brief writes a forward duration
 *    of exactly that many months: a figure in months or years ("within 12 months", "a 12-month horizon",
 *    "within 2 years"), or one month or year spelled with an article ("over the next year", "within a year").
 *    `months` is that count; `wording` is the brief's own span, verbatim.
 *  · `unresolved` — not attested, but the brief writes a deadline: a calendar point that needs a year or today's
 *    date to become a month count ("by Q3", "by the end of next year"), or a duration that is not the candidate's.
 *    `months` is null; `wording` is the brief's span, kept so the deadline is never lost unseen.
 *  · `absent` — the brief writes no deadline this recognises. `months` null, `wording` ''.
 *
 * ⛔ A FIGURE BESIDE ANOTHER NOUN IS NEVER A DEADLINE ("12 subscribers", row 25): only a month or year unit counts.
 * A PAST PERIOD IS NOT A DEADLINE ("over the last 12 months", "a year ago"), and neither is one end of a range
 * ("3-6 months"). Every miss under-claims: a deadline in number words ("eighteen months") stays unheld and its
 * question stays asked, exactly as before G1. Nothing here is defaulted, rounded or computed from a clock.
 */

export type HorizonStatus = 'attested' | 'unresolved' | 'absent';

export interface HorizonAttestation {
  /** The month count the brief attests; null unless `status` is `attested`. */
  readonly months: number | null;
  /** The brief's own words for the deadline, verbatim; '' when `absent`. */
  readonly wording: string;
  readonly status: HorizonStatus;
  readonly proposed_months?: number;
  /** With no deadline claimed: the brief's span that does NOT govern the goal's achievement, retained for its missing reading. */
  readonly unbound?: string;
}

const MONTHS_PER: Readonly<Record<string, number>> = { month: 1, year: 12 };

/** A forward lead-in kept as part of the wording: "within ", "over the next ", "in the coming ". */
const LEAD = String.raw`(?:\b(?:within|in|over|during|for|by)\s+(?:the\s+)?(?:(?:next|coming|following)\s+)?)`;
/** A figure in months or years: "12 months", "12-month", "2 years". */
const FIGURE_DURATION = new RegExp(String.raw`(${LEAD})?(?<![\d.,])(\d+)(?:\s+|\s*-\s*)(month|year)s?\b`, 'gi');
/** One month or year, spelled: "over the next year", "within a year", "in one month". */
const SPELLED_DURATION = new RegExp(
  String.raw`\b(?:within|in|over|during)\s+(?:(?:the\s+)?(?:next|coming|following)|a|an|one)\s+(month|year)\b`, 'gi',
);
/** A calendar point: a year or today's date is needed to count its months. */
const CALENDAR_POINT = new RegExp(
  // DL-3 14:21Z (G3 #4): the year the user writes after a month or quarter is part of the point ("by the end of June next year"
  // was held as "by the end of June", and the deadline was asked again).
  String.raw`\b(?:by|before|until)\s+(?:the\s+)?(?:end\s+of\s+)?(?:(?:Q[1-4]|H[12])\b(?:\s+(?:\d{4}|(?:this|next)\s+year\b))?|(?:this|next)\s+(?:year|quarter)\b|year[-\s]?end\b|(?:January|February|March|April|May|June|July|August|September|October|November|December)\b(?:\s+(?:\d{4}|(?:this|next)\s+year\b))?)`
  + String.raw`|\b(?:in|during)\s+(?:Q[1-4]|H[12])\b(?:\s+\d{4})?`,
  'gi',
);

/** Words just before a figure that make it a past period or the far end of a range ("6-12 months", "6 to 12 months"). */
const PAST_OR_RANGE_BEFORE = /(?:\b(?:last|past|previous|prior)\s+|\d\s*(?:[-–]|to)\s*)$/i;
/**
 * ⭐ A RANGE OF TIME IS ONE SPAN, NEVER A COUNT (DL-3 02:54Z; BUDDY-A 02:58Z; Paul's served "in the next 6-12 months"): its whole
 * words are kept and neither end is ever attested. Its role is always asked first (`unbound`: "Is … the period by which … should
 * be achieved?"), wherever it sits (#3342 R2, below). Before, both ends were skipped and the brief's words were lost, leaving only
 * the drafter's own pick of one end ("Does … get there within 12 months?").
 */
const RANGE_DURATION = new RegExp(String.raw`(${LEAD})?(?<![\d.,])(\d+)\s*(?:[-–]|to)\s*(\d+)(?:\s+|\s*-\s*)(month|year)s?\b`, 'gi');
/** Words just after that make it a past period. */
const PAST_AFTER = /^\s+ago\b/i;

/** Words just after a span that make it time allotted to the goal: "two months to learn", "six months from today". */
const ALLOTTED_AFTER = /^\s+(?:to\s+\p{L}|from\s+(?:now|today)\b)/iu;
/**
 * A forward lead-in just before a span, "the first" included ("within the first 3 months", marketing's L20): the span's
 * form as a deadline. The held wording stays the span's own (`LEAD` above), so "3 months" is held as before.
 */
const LED_BEFORE = new RegExp(String.raw`\b(?:within|in|over|during|for|by)\s+(?:the\s+)?(?:(?:next|coming|following|first)\s+)?$`, 'i');

/**
 * `led`: the brief writes it as a deadline, forward-led ("within 12 months", "over the next ten months") or allotted ("two
 * months to learn"), not as the bare length of something else ("a runway of 12 months if we run lean").
 */
interface Span { readonly months: number; readonly wording: string; readonly index: number; readonly led: boolean }

function forwardDurations(brief: string): Span[] {
  const spans: Span[] = [];
  for (const m of brief.matchAll(FIGURE_DURATION)) {
    const lead = m[1] ?? '';
    const figureAt = (m.index ?? 0) + lead.length;
    const before = brief.slice(Math.max(0, figureAt - 16), figureAt);
    const after = brief.slice((m.index ?? 0) + m[0].length);
    if ((lead === '' && PAST_OR_RANGE_BEFORE.test(before)) || PAST_AFTER.test(after)) continue;
    spans.push({ months: Number(m[2]) * MONTHS_PER[m[3]!.toLowerCase()]!, wording: m[0].trim(), index: m.index ?? 0,
      led: lead !== '' || LED_BEFORE.test(brief.slice(Math.max(0, figureAt - 32), figureAt)) || ALLOTTED_AFTER.test(after) });
  }
  for (const m of brief.matchAll(RANGE_DURATION)) {
    const lead = m[1] ?? '';
    const lowAt = (m.index ?? 0) + lead.length;
    // `months` NaN: a range is never one count, so no claim is ever attested from it. Only a forward-led one is a deadline's
    // form ("over the last 6-12 months" and "a runway of 6-12 months" are not led, so they never reach the role rules).
    spans.push({ months: Number.NaN, wording: m[0].trim(), index: m.index ?? 0,
      led: lead !== '' || LED_BEFORE.test(brief.slice(Math.max(0, lowAt - 32), lowAt)) || ALLOTTED_AFTER.test(brief.slice((m.index ?? 0) + m[0].length)) });
  }
  for (const m of brief.matchAll(SPELLED_DURATION)) {
    if (PAST_AFTER.test(brief.slice((m.index ?? 0) + m[0].length))) continue;
    spans.push({ months: MONTHS_PER[m[1]!.toLowerCase()]!, wording: m[0].trim(), index: m.index ?? 0, led: true });
  }
  return spans.sort((a, b) => a.index - b.index);
}

/**
 * ⭐ A PERIOD IS THE GOAL'S DEADLINE ONLY WHERE IT GOVERNS THE GOAL'S ACHIEVEMENT (AIE #94 6184383302; #3208 was the containment).
 * D5's "We have two months to learn, and are not choosing a final strategy today." is the team's learning window, not a deadline
 * for achieving customer trust, whether the drafter files it in unknowns or not. The role comes from the ONE statement contract
 * (`construction-source-map.ts`): a `target` statement is the goal's target "with its comparator, reference, period and
 * conditions", verified against the brief by the host. So with no deadline claimed, a span is the goal's deadline only inside
 * the goal's own verified target statement (`governing`). A span anywhere else (a measure, a learning window, a start) is never
 * written as a deadline: its words come back as `unbound`, for the caller to ask the exact missing reading. No keyword list:
 * a learning task whose completion IS the goal's target keeps its period. A claimed count the brief attests is unchanged.
 * `governing` undefined (a caller with no statement map) reads every span exactly as before.
 */
function governedBy(brief: string, governing: readonly string[] | undefined): (index: number, length: number) => boolean {
  if (governing === undefined) return () => true;
  const ranges = governing.filter((q) => q.trim() !== '').flatMap((q) => {
    const out: [number, number][] = [];
    for (let at = brief.indexOf(q); at >= 0; at = brief.indexOf(q, at + 1)) out.push([at, at + q.length]);
    return out;
  });
  return (index, length) => ranges.some(([a, b]) => index >= a && index + length <= b);
}

/**
 * Whether the brief attests the candidate goal's deadline. `candidate` is the drafter's goal (`horizon_months`);
 * an older or goal-free candidate is simply one with no deadline to attest.
 */
export function attestHorizon(
  brief: string | null | undefined,
  candidate: { readonly horizon_months?: unknown } | null | undefined,
  governing?: readonly string[],
): HorizonAttestation {
  const absent: HorizonAttestation = { months: null, wording: '', status: 'absent' };
  if (typeof brief !== 'string' || brief.trim() === '') return absent;
  const claimed = candidate?.horizon_months;
  const governs = governedBy(brief, governing);
  let unbound: string | undefined;
  /** An unclaimed span: kept when it governs the goal's achievement; otherwise its words are retained as `unbound`. */
  const governed = (index: number, words: string): boolean => {
    if (governs(index, words.length)) return true;
    unbound ??= words;
    return false;
  };
  const durations = forwardDurations(brief);
  const countWords: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, eighteen: 18 };
  const proposals = [...brief.matchAll(/\bmonth\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)\s+months?\b/gi)];
  // ⛔ S3 T5 D2 (L1): the CANDIDATE's count picks the brief's span that says it. "…the first three months after launch. We
  // plan to launch six months from today." with a 6 typed was saved as "three months": the first span won, whatever the
  // claim. A forward span equal to the claim is taken; otherwise the first, exactly as before.
  const countOf = (p: RegExpExecArray): number => countWords[(p[1] ?? p[2]!).toLowerCase()] ?? Number(p[1] ?? p[2]);
  /**
   * ⛔ A BARE LENGTH IS NOT A DEADLINE (Paul's funding brief, 13 Oct 23:12Z: "a runway of 12 months if we run lean" was
   * held as the goal's deadline and asked as "the deadline your brief sets"). Only the candidate's claim attests a span
   * (exactly its count, below). Without one, the brief shows a deadline only by its form: a calendar point ("by Q3"), a
   * month point ("month 9"), a forward-led span ("within 12 months", "over the next ten months") or time allotted ("we
   * have two months to learn"), never the bare length of something else ("a runway of 12 months", "twelve months of runway").
   */
  const forwardLed = (index: number): boolean => LED_BEFORE.test(brief.slice(Math.max(0, index - 32), index));
  const deadlineForm = (p: RegExpExecArray): boolean => p[1] !== undefined || forwardLed(p.index)
    || ALLOTTED_AFTER.test(brief.slice(p.index + p[0].length));
  const proposed = proposals.find((p) => countOf(p) === claimed
    && !PAST_OR_RANGE_BEFORE.test(brief.slice(Math.max(0, p.index - 16), p.index))
    && !PAST_AFTER.test(brief.slice(p.index + p[0].length))) ?? proposals.find((p) => deadlineForm(p) && governed(p.index, p[0])) ?? null;
  if (proposed !== null) {
    const count = proposed[1] ?? proposed[2]!;
    const months = countWords[count.toLowerCase()] ?? Number(count);
    if (Number.isInteger(months) && months > 0) {
      const before = brief.slice(Math.max(0, proposed.index - 16), proposed.index);
      if (!PAST_OR_RANGE_BEFORE.test(before) && !PAST_AFTER.test(brief.slice(proposed.index + proposed[0].length))) {
        // A count explicitly at the end of month N is ruled, rather than a bare proposed month N.
        if (/end of\s+$/i.test(before) && claimed === months) return { months, wording: `end of ${proposed[0]}`, status: 'attested' };
        return { months: null, proposed_months: months, wording: proposed[0], status: 'unresolved' };
      }
    }
  }
  if (typeof claimed === 'number' && Number.isInteger(claimed) && claimed > 0) {
    const match = durations.find((d) => d.months === claimed);
    if (match !== undefined) return { months: claimed, wording: match.wording, status: 'attested' };
  }
  const calendar = [...brief.matchAll(CALENDAR_POINT)].map((m) => ({ wording: m[0].trim(), index: m.index ?? 0 }));
  // ⛔ #3342 R2 (BUDDY-A B1 03:24Z; AIE 6184383302: containment alone never proves a period's role): a RANGE is never the goal's
  // deadline by sitting inside its target sentence ("We want £100k MRR; the Pro feature release is planned in the next 6-12
  // months."). Its whole words always come back `unbound`, so the role is asked first; a single span keeps the existing rule.
  const range = (d: { readonly months?: number }): boolean => Number.isNaN(d.months);
  const first = [...calendar, ...durations.filter((d) => d.led)].sort((a, b) => a.index - b.index)
    .find((d) => (range(d) ? ((unbound ??= d.wording), false) : governed(d.index, d.wording)));
  if (first !== undefined) return { months: null, wording: first.wording, status: 'unresolved' };
  return unbound === undefined ? absent : { ...absent, unbound };
}
