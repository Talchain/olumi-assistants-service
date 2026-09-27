/**
 * ⛔ A DERIVED LEVEL IS THE USER'S ONLY UNDER THREE TYPED CONDITIONS (AI Quality ruling, #70 5859388817).
 *
 * Served (DL pj-20260927T181846Z, journey C08): "Let's spit it 50/50 at this stage." after the user set the spend limit
 * to £30,000. The Agent added the option with no levels, because "50/50" is not a figure `figureTheUserWroteFor` can
 * find: the £15,000 each is DERIVED. Whether a derived figure is the user's is a science ruling, and it is:
 *   1. every operand is user-stated and typed: the ratio in THIS message, the base a user-stated total in the model
 *      (an Olumi estimate is never a base);
 *   2. the operation is exact arithmetic: typed shares that make the whole (percent shares summing to 100, "half each",
 *      "a third each", "evenly"), with no hedge ("roughly", "mostly", "a bit");
 *   3. exactly ONE candidate total is in scope; two means asking which, never guessing.
 * All three ⇒ the user's, with the working written out for the approval sentence (C2: consent covers exactly what is
 * written). Anything else ⇒ not the user's derivation (Olumi's arithmetic, stamped and shown as such).
 *
 * PURE: it reads a message and the totals the caller found; it persists nothing. The `derived_from` stamp that records
 * the derivation on the model waits for Canonical's carrier on the one intervention form (#70 5859537590).
 */

/** A total the model already holds, with who stated it. Only a `user` total can be the base of the user's split. */
export interface StatedTotal {
  readonly node_id: string;
  readonly label: string;
  readonly value: number;
  readonly unit?: string;
  readonly by: 'user' | 'olumi';
}

export type SplitReading =
  | { readonly kind: 'user_split'; readonly ratio: readonly number[]; readonly base: StatedTotal; readonly parts: readonly number[]; readonly working: string }
  | { readonly kind: 'ask_which_total'; readonly candidates: readonly StatedTotal[] }
  | { readonly kind: 'not_derived' };

const NOT: SplitReading = { kind: 'not_derived' };

/** A hedge anywhere in the message makes the arithmetic inexact (condition 2). */
const HEDGE = /\b(?:roughly|about|around|approximately|approx|mostly|mainly|a\s+bit|a\s+little|more\s+or\s+less|ish)\b/i;
/** Percent shares written as 50/50, 70:30, 50-50, 40/30/30. */
const PERCENT_SHARES = /(?<![\d.,£$€])(\d{1,3})\s*[/:–-]\s*(\d{1,3})(?:\s*[/:–-]\s*(\d{1,3}))?(?!\d|[.,]\d|%)/;
/** "a 50/50 chance", "50/50 odds": a probability idiom, not a split. */
const PROBABILITY_IDIOM = /^\s*(?:chance|odds|shot|call|bet)\b/i;

function typedShares(message: string, partCount: number): number[] | null {
  const m = PERCENT_SHARES.exec(message);
  if (m !== null) {
    if (PROBABILITY_IDIOM.test(message.slice(m.index + m[0].length))) return null;
    const shares = [m[1], m[2], m[3]].filter((x): x is string => x !== undefined).map(Number);
    // Never normalised: "60/30" stays 0.6 + 0.3, and the re-sum guard in `readUserSplit` refuses it (ONE guard).
    return shares.map((s) => s / 100);
  }
  if (/\bhalf\s+(?:each|and\s+half)\b|\bhalves\b/i.test(message)) return partCount === 2 ? [0.5, 0.5] : null;
  if (/\b(?:a\s+)?third\s+each\b|\bthirds\b/i.test(message)) return partCount === 3 ? [1 / 3, 1 / 3, 1 / 3] : null;
  if (/\b(?:evenly|equally)\b/i.test(message) && partCount >= 2) return Array.from({ length: partCount }, () => 1 / partCount);
  return null;
}

const FRACTION_WORD: Readonly<Record<number, string>> = { 2: 'half', 3: 'a third', 4: 'a quarter' };

function money(value: number, unit: string | undefined): string {
  const isGbp = unit !== undefined && /^(?:gbp|£)/i.test(unit.trim());
  const shown = Number.isInteger(value) ? value.toLocaleString('en-GB') : value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return isGbp ? `£${shown}` : unit !== undefined && unit !== '' ? `${shown} ${unit}` : shown;
}

/** The working, in words the approval sentence can carry: "£15,000 each: half of your £30,000". */
function workingOf(ratio: readonly number[], parts: readonly number[], base: StatedTotal): string {
  const equal = ratio.every((r) => Math.abs(r - ratio[0]!) < 1e-12);
  const whole = money(base.value, base.unit);
  if (equal && FRACTION_WORD[ratio.length] !== undefined) return `${money(parts[0]!, base.unit)} each: ${FRACTION_WORD[ratio.length]} of your ${whole}`;
  return `${parts.map((p) => money(p, base.unit)).join(' and ')}: ${ratio.map((r) => Math.round(r * 100)).join(':')} of your ${whole}`;
}

/**
 * Read the user's own split of a total, or say why it is not theirs. `partCount` is how many levels the change sets
 * (the factors the split is across); a typed share count that does not match it is not this split.
 */
export function readUserSplit(message: string, totals: readonly StatedTotal[], partCount: number): SplitReading {
  if (typeof message !== 'string' || !(partCount >= 2) || HEDGE.test(message)) return NOT;
  const ratio = typedShares(message, partCount);
  if (ratio === null || ratio.length !== partCount) return NOT;
  const candidates = totals.filter((t) => t.by === 'user' && Number.isFinite(t.value) && t.value > 0);
  if (candidates.length === 0) return NOT;
  if (candidates.length > 1) return { kind: 'ask_which_total', candidates };
  const base = candidates[0]!;
  const parts = ratio.map((r) => r * base.value);
  // The parts must make the whole, or nothing is the user's (the ruling's guard; never a rounded near-miss).
  if (Math.abs(parts.reduce((a, b) => a + b, 0) - base.value) > 1e-9 * Math.max(1, base.value)) return NOT;
  return { kind: 'user_split', ratio, base, parts, working: workingOf(ratio, parts, base) };
}
