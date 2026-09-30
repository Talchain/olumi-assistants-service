import type { NumberClaim, SourceSpan, SourceQuantity, SourceUnit, SourceEvidenceRange, SourceDeadline } from './meaning.js';

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
  const preceding = bound.source.quote.slice(0, at);
  const following = bound.source.quote.slice(at + claim.literal.length);
  // A range endpoint is not an independent scalar. Keep the separate "from
  // £49 to £59" current/proposed reading; explicit ranges cannot use it.
  const rangeContext = /\b(?:between|ranges?)\b[^.!?;]*$/i.test(preceding);
  // A saved numeric quote may omit the action verb; it still must be in this
  // same original clause, never borrowed from an earlier sentence.
  const clause = brief.slice(0, bound.source.start + at)
    .split(/[!?;]|(?<!\d)[.,]|[.,](?!\d)/).at(-1) ?? '';
  const changeAction = /\b(?:raise|increase|lower|reduce|cut|change|move|grow|drop)\s+[a-z][a-z0-9\s'-]*\s+from\b/i.test(clause)
    && !/\b(?:not|never|cannot|can't|and|but|whereas|while)\b/i.test(clause);
  const fromStart = /\bfrom\s*$/i.test(preceding) && changeAction && !rangeContext;
  const fromEnd = /\bfrom\s*[£$€]?\s*\d[\d,.]*(?:\s*(?:k|m|million|thousand))?\s+to\s*[£$€]?\s*$/i.test(preceding) && changeAction && !rangeContext;
  const upperDash = /\d[\d,.]*(?:\s*(?:k|m|million|thousand))?\s*[-–—]\s*[£$€]?\s*$/i.test(preceding);
  const upperTo = /\d[\d,.]*(?:\s*(?:k|m|million|thousand))?\s+to\s*[£$€]?\s*$/i.test(preceding) && !fromEnd;
  const lowerTo = /^\s+to\s*[£$€]?\s*\d/i.test(following) && !fromStart;
  const betweenStart = /\bbetween\s*$/i.test(preceding) && /^\s+and\s*[£$€]?\s*\d/i.test(following);
  const betweenEnd = /\bbetween\s+[£$€]?\s*\d[\d,.]*(?:\s*(?:k|m|million|thousand))?\s+and\s*[£$€]?\s*$/i.test(preceding);
  if (bound.source.quote.indexOf(claim.literal, at + 1) >= 0
    || /[\d.,+-]/.test(bound.source.quote[at - 1] ?? '')
    || /^[\da-z]|^[.,]\d/i.test(following)
    || /^\s*(?:-|–|—)\s*(?:[£$€]\s*)?\d/i.test(following)
    || upperDash || upperTo || lowerTo || betweenStart || betweenEnd) return null;
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

/** Decode a written range, including a scale shared by its two endpoints. */
export function readEvidenceRange(brief: string, claim: SourceEvidenceRange): { lower: number; upper: number; source: BoundSource } | null {
  const bound = bindSource(brief, claim.source);
  if (!bound.ok || !bound.source.quote.includes(claim.literal)
    || sourceUnitProblem(claim.unit, bound.source.quote)) return null;
  const parsed = /^(?:£|\$|€|GBP\s*|USD\s*|EUR\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)?\s*(?:-|–|—|to)\s*(?:£|\$|€|GBP\s*|USD\s*|EUR\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)?$/i.exec(claim.literal.trim());
  if (!parsed) return null;
  const codes = [...claim.literal.matchAll(/£|\$|€|GBP|USD|EUR/gi)].map(([token]) =>
    token === '£' ? 'GBP' : token === '$' ? 'USD' : token === '€' ? 'EUR' : token.toUpperCase());
  if (codes.length && (claim.unit.kind !== 'currency' || codes.some((code) => code !== claim.unit.currency))) return null;
  const multiplier = (scale: string) => /^(k|thousand)$/i.test(scale) ? 1_000 : /^(m|million)$/i.test(scale) ? 1_000_000 : 1;
  const lower = Number(parsed[1].replaceAll(',', '')) * multiplier(parsed[2] ?? parsed[4] ?? '');
  const upper = Number(parsed[3].replaceAll(',', '')) * multiplier(parsed[4] ?? parsed[2] ?? '');
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper
    || lower !== Number(claim.lower_value) || upper !== Number(claim.upper_value)) return null;
  return { lower, upper, source: bound.source };
}

/** A deadline is metadata about the goal, never its target or current level. */
export function readDeadline(brief: string, claim: SourceDeadline): { source: BoundSource } | null {
  const bound = bindSource(brief, claim.source);
  if (!bound.ok || !bound.source.quote.includes(claim.as_stated)
    || !/^(within|in|by|before)\b/i.test(claim.as_stated)
    || /\b(?:not|never|cannot|can't)\s+(?:be\s+)?(?:within|in|by|before)\b/i.test(bound.source.quote)) return null;
  const before = bound.source.quote.slice(0, bound.source.quote.indexOf(claim.as_stated)).split(/[.!?;]/).at(-1) ?? '';
  if (/\b(?:not|never|cannot|can't)\b/i.test(before)) return null;
  const parsed = /^(?:within|in|by|before)\s+(?:the\s+)?(?:next\s+)?(\d+|one|a)\s+(months?|years?)$/i.exec(claim.as_stated);
  const quarter = /^(?:by|before)\s+(?:the\s+end\s+of\s+)?Q[1-4]$/i.test(claim.as_stated);
  if (!parsed && !quarter) return null;
  const count = parsed ? /^\d+$/.test(parsed[1]) ? Number(parsed[1]) : 1 : null;
  const months = parsed && count !== null ? count * (/^year/i.test(parsed[2]) ? 12 : 1) : null;
  if (parsed && (months === null || months <= 0)) return null;
  if (claim.horizon_months !== null && months !== claim.horizon_months) return null;
  return { source: bound.source };
}

export function sourceUnitProblem(unit: SourceUnit, context: string): string | null {
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
  return null;
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
    if (prospective >= 0 && statedCurrent > prospective) {
      const between = before.slice(prospective, statedCurrent);
      // A prospective cue still governs "current MRR" in "target of current
      // MRR is £75k". Only a completed preceding clause can release it.
      const separateSentence = /[.!?;]\s+/.test(between);
      const completedConjoinedClause = /\b(?:is|are|was|were)\b[^.!?;]*\d[^.!?;]*(?:,\s*)?\b(?:and|but|whereas|while)\s+$/.test(before.slice(0, statedCurrent));
      if (!separateSentence && !completedConjoinedClause) return 'current_value_is_target_or_limit';
    }
  }
  if (quantity.frame !== 'level' && quantity.direction === 'decrease' && !/\b(reduc\w*|cut\w*|decreas\w*|lower\w*|less|drop\w*|save\w*)\b/i.test(quote)) return 'change_direction_not_grounded';
  if (quantity.frame !== 'level' && quantity.direction === 'increase' && !/\b(increas\w*|rais\w*|grow\w*|growth|more|add\w*|improv\w*)\b/i.test(quote)) return 'change_direction_not_grounded';
  const unitProblem = sourceUnitProblem(quantity.unit, context);
  if (unitProblem) return unitProblem;
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
