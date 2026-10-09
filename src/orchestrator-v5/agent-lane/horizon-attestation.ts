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
  String.raw`\b(?:by|before|until)\s+(?:the\s+)?(?:end\s+of\s+)?(?:(?:Q[1-4]|H[12])\b(?:\s+\d{4})?|(?:this|next)\s+(?:year|quarter)\b|year[-\s]?end\b|(?:January|February|March|April|May|June|July|August|September|October|November|December)\b(?:\s+\d{4})?)`
  + String.raw`|\b(?:in|during)\s+(?:Q[1-4]|H[12])\b(?:\s+\d{4})?`,
  'gi',
);

/** Words just before a figure that make it a past period or the far end of a range. */
const PAST_OR_RANGE_BEFORE = /(?:\b(?:last|past|previous|prior)\s+|\d\s*[-–]\s*)$/i;
/** Words just after that make it a past period. */
const PAST_AFTER = /^\s+ago\b/i;

interface Span { readonly months: number; readonly wording: string; readonly index: number }

function forwardDurations(brief: string): Span[] {
  const spans: Span[] = [];
  for (const m of brief.matchAll(FIGURE_DURATION)) {
    const lead = m[1] ?? '';
    const figureAt = (m.index ?? 0) + lead.length;
    const before = brief.slice(Math.max(0, figureAt - 16), figureAt);
    const after = brief.slice((m.index ?? 0) + m[0].length);
    if ((lead === '' && PAST_OR_RANGE_BEFORE.test(before)) || PAST_AFTER.test(after)) continue;
    spans.push({ months: Number(m[2]) * MONTHS_PER[m[3]!.toLowerCase()]!, wording: m[0].trim(), index: m.index ?? 0 });
  }
  for (const m of brief.matchAll(SPELLED_DURATION)) {
    if (PAST_AFTER.test(brief.slice((m.index ?? 0) + m[0].length))) continue;
    spans.push({ months: MONTHS_PER[m[1]!.toLowerCase()]!, wording: m[0].trim(), index: m.index ?? 0 });
  }
  return spans.sort((a, b) => a.index - b.index);
}

/**
 * Whether the brief attests the candidate goal's deadline. `candidate` is the drafter's goal (`horizon_months`);
 * an older or goal-free candidate is simply one with no deadline to attest.
 */
export function attestHorizon(
  brief: string | null | undefined,
  candidate: { readonly horizon_months?: unknown } | null | undefined,
): HorizonAttestation {
  const absent: HorizonAttestation = { months: null, wording: '', status: 'absent' };
  if (typeof brief !== 'string' || brief.trim() === '') return absent;
  const claimed = candidate?.horizon_months;
  const durations = forwardDurations(brief);
  const countWords: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, eighteen: 18 };
  const proposed = /\bmonth\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)\s+months?\b/i.exec(brief);
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
  const first = [...calendar, ...durations].sort((a, b) => a.index - b.index)[0];
  return first === undefined ? absent : { months: null, wording: first.wording, status: 'unresolved' };
}
