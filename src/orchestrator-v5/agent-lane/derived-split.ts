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

/** One unit key for an exact compare: "GBP" and "£" are one unit; anything else must match as written. */
function unitKey(unit: string | undefined): string {
  const u = (unit ?? '').trim().toLowerCase();
  return u === '£' ? 'gbp' : u;
}

/**
 * The totals the user STATED that the model holds (condition 1's only admissible bases): every limit stamped
 * `explicit` (the compound-goal vocabulary is explicit | inferred | proxy; an inferred or proxy limit is Olumi's), and
 * every factor value the user typed (`brief_extraction`, `user_specified`), read as its RAW figure. An adopted
 * assumption (`user_assumption`) was Olumi's suggestion the user accepted, never typed, so it is not a base.
 */
export function statedTotalsOf(rawGraph: unknown): StatedTotal[] {
  const raw = (rawGraph ?? {}) as { goal_constraints?: unknown; nodes?: unknown };
  const nodes = Array.isArray(raw.nodes) ? raw.nodes as Record<string, unknown>[] : [];
  const labelOf = (id: unknown): string | undefined => {
    const l = nodes.find((n) => n?.id === id)?.label;
    return typeof l === 'string' ? l : undefined;
  };
  const out: StatedTotal[] = [];
  for (const c of Array.isArray(raw.goal_constraints) ? raw.goal_constraints as Record<string, unknown>[] : []) {
    if (c?.provenance !== 'explicit' || typeof c.node_id !== 'string' || typeof c.value !== 'number' || !Number.isFinite(c.value)) continue;
    out.push({ node_id: c.node_id, label: labelOf(c.node_id) ?? (typeof c.label === 'string' ? c.label : c.node_id), value: c.value,
      ...(typeof c.unit === 'string' ? { unit: c.unit } : {}), by: 'user' });
  }
  for (const n of nodes) {
    const os = n?.observed_state as { source?: unknown; raw_value?: unknown; unit?: unknown } | undefined;
    if (n?.kind !== 'factor' || typeof n.id !== 'string' || (os?.source !== 'brief_extraction' && os?.source !== 'user_specified')) continue;
    if (typeof os.raw_value !== 'number' || !Number.isFinite(os.raw_value)) continue;
    out.push({ node_id: n.id, label: typeof n.label === 'string' ? n.label : n.id, value: os.raw_value,
      ...(typeof os.unit === 'string' ? { unit: os.unit } : {}), by: 'user' });
  }
  return out;
}

/** A level the Agent proposed for one factor of the option, in the factor's own unit. */
export interface ProposedPart { readonly factor_id: string; readonly value: number; readonly unit?: string }

export type DerivedLevels =
  | { readonly kind: 'derived'; readonly factor_ids: readonly string[]; readonly working: string;
      readonly derived_from: { readonly op: 'split'; readonly ratio: readonly number[]; readonly base: { readonly node_id: string; readonly value: number } } }
  | { readonly kind: 'ask_which_total'; readonly factor_ids: readonly string[]; readonly candidates: readonly StatedTotal[] }
  | { readonly kind: 'none' };

/**
 * The option's levels that are the USER's split of a total they stated, or a single ask, or nothing.
 *
 * A total is in scope when the message's typed shares split it across exactly the option's OTHER levels in its unit
 * (the total's own node is never one of its parts). Two totals in scope ⇒ ask which (condition 3), whatever figures
 * the Agent proposed: a proposal matching one of them is the Agent's guess, not the user's choice.
 *
 * v1 binds EQUAL shares only ("50/50", "evenly", "a third each"): every part is the same figure, so no factor has to
 * be matched to a share. An unequal split ("70/30") names no factor for each share, so which gets 70 is Olumi's
 * reading: it is not derived here, and takes the ordinary path (unset and asked, or Olumi's estimate with its basis).
 * Every proposed part must equal the user's part exactly; one that does not means the split is not the user's.
 */
export function derivedSplitOf(message: string, totals: readonly StatedTotal[], proposed: readonly ProposedPart[]): DerivedLevels {
  const none: DerivedLevels = { kind: 'none' };
  const inScope: { base: StatedTotal; parts: readonly ProposedPart[]; reading: Extract<SplitReading, { kind: 'user_split' }> }[] = [];
  for (const t of totals) {
    const parts = proposed.filter((p) => p.factor_id !== t.node_id && unitKey(p.unit) === unitKey(t.unit));
    const reading = readUserSplit(message, [t], parts.length);
    if (reading.kind === 'user_split') inScope.push({ base: t, parts, reading });
  }
  if (inScope.length > 1) {
    return { kind: 'ask_which_total', candidates: inScope.map((s) => s.base),
      factor_ids: [...new Set(inScope.flatMap((s) => s.parts.map((p) => p.factor_id)))] };
  }
  const only = inScope[0];
  if (only === undefined) return none;
  const { base, parts, reading } = only;
  if (!reading.ratio.every((r) => Math.abs(r - reading.ratio[0]!) < 1e-12)) return none;
  const each = reading.parts[0]!;
  if (!parts.every((p) => Math.abs(p.value - each) <= 1e-9 * Math.max(1, base.value))) return none;
  return { kind: 'derived', factor_ids: parts.map((p) => p.factor_id), working: reading.working,
    derived_from: { op: 'split', ratio: reading.ratio, base: { node_id: base.node_id, value: base.value } } };
}
