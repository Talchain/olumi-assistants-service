import type { NumberClaim, SourceSpan, SourceQuantity, SourceUnit } from './meaning.js';

export type BoundSource = { quote: string; start: number; end: number; offset_corrected?: true };
export type Binding = { ok: true; source: BoundSource } | { ok: false; reason: string };
const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

export function bindSource(brief: string, claim: SourceSpan): Binding {
  let mismatchedOffset = false;
  if (claim.start !== null || claim.end !== null) {
    if (claim.start === null || claim.end === null || claim.end <= claim.start
      || brief.slice(claim.start, claim.end) !== claim.quote) {
      // Offsets are provider hints, not authority. An exact unique quote has
      // one deterministic location even when the provider counted badly.
      mismatchedOffset = true;
    } else {
      return { ok: true, source: { quote: claim.quote, start: claim.start, end: claim.end } };
    }
  }
  const start = brief.indexOf(claim.quote);
  if (start < 0) return { ok: false, reason: 'source_quote_missing' };
  if (brief.indexOf(claim.quote, start + 1) >= 0) return { ok: false, reason: 'source_quote_ambiguous' };
  return { ok: true, source: { quote: claim.quote, start, end: start + claim.quote.length,
    ...(mismatchedOffset ? { offset_corrected: true as const } : {}) } };
}

export function readNumber(brief: string, claim: NumberClaim): { value: number; source: BoundSource } | null {
  const bound = bindSource(brief, claim.source);
  if (!bound.ok || !bound.source.quote.includes(claim.literal)) return null;
  const at = bound.source.quote.indexOf(claim.literal);
  const following = bound.source.quote.slice(at + claim.literal.length);
  if (bound.source.quote.indexOf(claim.literal, at + 1) >= 0
    || /[\d.,+-]/.test(bound.source.quote[at - 1] ?? '')
    || /^[\da-z]|^[.,]\d/i.test(following)) return null;
  // These are numeric spellings, not inferred values. Preserve the full quote
  // (including "about") and require the decoded value to equal the typed one.
  const spelling = claim.literal.trim().replace(/^(?:about|approximately|roughly|around)\s+/i, '')
    .replace(/\s+(?:days?|weeks?|months?|years?|hours?|minutes?|seconds?)$/i, '');
  const literal = spelling.replace(/[,\s]/g, '').replace(/^(GBP|USD|EUR)/i, '')
    .replace(/[£$€]/g, '').replace(/(?:%|percentagepoints|pp)$/i, '');
  const parsed = /^([+-]?\d+(?:\.\d+)?)(k|m|million|thousand)?$/i.exec(literal);
  if (!parsed && SMALL_NUMBERS[literal.toLowerCase()] === undefined) return null;
  const multiplier = /^(k|thousand)$/i.test(parsed?.[2] ?? '') ? 1_000
    : /^(m|million)$/i.test(parsed?.[2] ?? '') ? 1_000_000 : 1;
  const value = parsed ? Number(parsed[1]) * multiplier : SMALL_NUMBERS[literal.toLowerCase()];
  const claimed = Number(claim.value);
  if (!Number.isFinite(value) || !Number.isFinite(claimed)
    || Math.abs(value - claimed) > Number.EPSILON * Math.max(1, Math.abs(value)) * 4) return null;
  return { value: claimed, source: bound.source };
}

/** Detect explicit contradictions; successful text binding is not semantic proof. */
export function quantityProblem(quantity: SourceQuantity, context: string): string | null {
  if ((quantity.role === 'current' || quantity.role === 'proposed_level') && quantity.frame !== 'level') return 'role_frame_conflict';
  if (quantity.role === 'absolute_change' && quantity.frame !== 'change_abs') return 'role_frame_conflict';
  if (quantity.role === 'relative_change' && quantity.frame !== 'change_rel') return 'role_frame_conflict';
  if (quantity.frame === 'change_rel' && quantity.unit.kind !== 'percent') return 'relative_change_requires_percent';
  const quote = quantity.number.source.quote;
  const at = quote.indexOf(quantity.number.literal);
  const before = quote.slice(0, at).toLowerCase();
  if (quantity.role === 'current') {
    const statedCurrent = [...before.matchAll(/\b(current(?:ly)?|today|now|have|has|from)\b/g)].at(-1)?.index ?? -1;
    const prospective = [...before.matchAll(/\b(target|want|goal|aim|must|under|below|above|limit|ceiling|budget|to)\b/g)].at(-1)?.index ?? -1;
    if (prospective > statedCurrent) return 'current_value_is_target_or_limit';
  }
  if (quantity.frame !== 'level' && quantity.direction === 'decrease' && !/\b(reduc\w*|cut\w*|decreas\w*|lower\w*|less|drop\w*|save\w*)\b/i.test(quote)) return 'change_direction_not_grounded';
  if (quantity.frame !== 'level' && quantity.direction === 'increase' && !/\b(increas\w*|rais\w*|grow\w*|growth|more|add\w*|improv\w*)\b/i.test(quote)) return 'change_direction_not_grounded';
  const unit = quantity.unit;
  if (unit.kind === 'currency') {
    const currencyPattern = unit.currency === 'GBP' ? /£|\bGBP\b|pounds?/i
      : unit.currency === 'USD' ? /\$|\bUSD\b|dollars?/i : unit.currency === 'EUR' ? /€|\bEUR\b|euros?/i : null;
    if (!currencyPattern?.test(context)) return 'currency_not_grounded';
  } else if (unit.currency !== null) return 'currency_on_non_currency_unit';
  if (unit.kind === 'percent' && !/%|percent/i.test(context)) return 'percent_not_grounded';
  if (unit.kind === 'percentage_points' && !/percentage[ -]points?|\bpp\b/i.test(context)) return 'percentage_points_not_grounded';
  const periods = { day: /\b(daily|days?)\b/i, week: /\b(weekly|weeks?)\b/i, month: /\b(monthly|months?|MRR)\b/i,
    quarter: /\b(quarterly|quarters?)\b/i, year: /\b(annual(?:ly)?|yearly|years?|ARR)\b/i };
  if (unit.period !== null && !periods[unit.period].test(context)) return 'period_not_grounded';
  // Period and deadline are different. A provider's incidental horizon field
  // cannot invalidate a sound current value or limit; only targets consume it.
  if (quantity.role === 'target' && quantity.horizon_months !== null) {
    const months = /\b(\d+)\s+months?\b/i.exec(context);
    const years = /\b(\d+|a|one)\s+years?\b/i.exec(context);
    const stated = months ? Number(months[1]) : years ? (Number(years[1]) || 1) * 12 : null;
    if (stated !== quantity.horizon_months) return 'horizon_not_grounded';
  }
  return null;
}

export function unitText(unit: SourceUnit): string {
  const base = unit.kind === 'currency' ? unit.currency ?? unit.as_stated
    : unit.kind === 'count' ? unit.counted_object ?? unit.as_stated
      : unit.kind === 'percent' ? '%' : unit.kind === 'percentage_points' ? 'percentage points' : unit.as_stated;
  const counted = unit.kind === 'currency' && unit.counted_object ? ` per ${unit.counted_object}` : '';
  if (unit.kind === 'time' && unit.period !== null && new RegExp(`^${unit.period}s?$`, 'i').test(unit.as_stated.trim())) return base;
  return `${base}${counted}${unit.period ? ` per ${unit.period}` : ''}`;
}

export function compatibleUnits(left: SourceUnit, right: SourceUnit): boolean {
  return left.kind === right.kind && left.currency === right.currency && left.period === right.period
    && (left.counted_object ?? '').toLowerCase() === (right.counted_object ?? '').toLowerCase();
}
