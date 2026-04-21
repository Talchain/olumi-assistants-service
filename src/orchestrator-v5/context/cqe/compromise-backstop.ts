import nlp from 'compromise';
import compromiseNumbers from 'compromise-numbers';
import type { QuantityExtractionResult } from './schema-types.js';
import type { CqePatternMatch } from './rules.js';

// compromise-numbers augments the compromise View at runtime with `.numbers()`
// which yields a sub-view whose `.json()` exposes parsed numeric tokens.
// Compromise declares View as a class, which cannot be augmented via
// interface-merging to express the plugin's additions. We access the plugin
// method via a single @ts-expect-error directive and validate the result
// shape at runtime before trusting it.
interface NumbersJsonEntry {
  text?: string;
  number?: number;
}

function asNumbersJson(value: unknown): NumbersJsonEntry[] {
  if (
    value !== null &&
    typeof value === 'object' &&
    'json' in value &&
    typeof (value as { json: unknown }).json === 'function'
  ) {
    const result = (value as { json: () => unknown }).json();
    if (Array.isArray(result)) {
      return result.filter(
        (item): item is NumbersJsonEntry =>
          item !== null && typeof item === 'object',
      );
    }
  }
  return [];
}

// Compromise + compromise-numbers backstop per CQE Design v1.1 §4.1 step 4.
//
// Runs on the remaining unmasked text after all CQE rules have fired. For
// each numeric token compromise recognises that does not overlap an existing
// match, emit a minimal QuantityExtractionResult with source=compromise and
// value_origin=parsed_numeric.

nlp.plugin(compromiseNumbers as Parameters<typeof nlp.plugin>[0]);

interface NumericToken {
  value: number;
  start: number;
  end: number;
  raw: string;
}

const TRAILING_UNIT_RE = /^\s*(%|pp|percentage\s+points?|months?|weeks?|days?|years?|hours?|minutes?|kg|km|miles?|GBP|USD|EUR|grand|quid)\b/i;

export function compromiseBackstop(
  maskedText: string,
  existingMatches: readonly CqePatternMatch[],
): CqePatternMatch[] {
  const tokens = extractNumericTokens(maskedText);
  if (tokens.length === 0) return [];

  const out: CqePatternMatch[] = [];
  for (const token of tokens) {
    if (overlapsExisting(token, existingMatches)) continue;
    const trailing = maskedText.slice(token.end, token.end + 24);
    const unitMatch = trailing.match(TRAILING_UNIT_RE);
    const [unit, extendedEnd, isPercent, isPp, isGrand, isCurrency] = unitMatch
      ? parseTrailingUnit(unitMatch, token.end)
      : [null, token.end, false, false, false, false];
    let value = token.value;
    let valueOrigin: QuantityExtractionResult['value_origin'] = 'parsed_numeric';
    if (isPercent) value = value / 100;
    if (isGrand) {
      value = value * 1000;
      valueOrigin = 'suffix_expansion';
    }
    const endPos = typeof extendedEnd === 'number' ? extendedEnd : token.end;
    const raw = maskedText.slice(token.start, endPos);
    const result: Partial<QuantityExtractionResult> = {
      raw_text: raw,
      value,
      unit: typeof unit === 'string' ? unit : null,
      direction: null,
      multiplier: null,
      operator: null,
      comparator: null,
      range_min: null,
      range_max: null,
      approximate: false,
      source: 'compromise',
      value_origin: isCurrency || isPp || isPercent ? 'parsed_numeric' : valueOrigin,
    };
    out.push({
      spanStart: token.start,
      spanEnd: endPos,
      raw,
      result,
      patternId: 'compromise',
    });
  }
  return out;
}

function parseTrailingUnit(
  m: RegExpMatchArray,
  tokenEnd: number,
): [string | null, number, boolean, boolean, boolean, boolean] {
  const raw = m[1]!.toLowerCase();
  const totalLen = m[0]!.length;
  const extendedEnd = tokenEnd + totalLen;
  if (raw === '%') return ['percentage', extendedEnd, true, false, false, false];
  if (raw === 'pp' || /^percentage\s+points?$/.test(raw)) {
    return ['percentage_points', extendedEnd, false, true, false, false];
  }
  if (raw === 'gbp' || raw === 'quid') return ['GBP', extendedEnd, false, false, false, true];
  if (raw === 'grand') return ['GBP', extendedEnd, false, false, true, true];
  if (raw === 'usd') return ['USD', extendedEnd, false, false, false, true];
  if (raw === 'eur') return ['EUR', extendedEnd, false, false, false, true];
  return [raw.replace(/s$/u, ''), extendedEnd, false, false, false, false];
}

function extractNumericTokens(text: string): NumericToken[] {
  const out: NumericToken[] = [];
  try {
    const view = nlp(text);
    // compromise-numbers adds the `numbers()` method at runtime. Compromise's
    // View class exposes generic match helpers so the call typechecks; we
    // validate the shape before trusting it.
    const sub: unknown = view.numbers();
    const parsedJson = asNumbersJson(sub);
    let cursor = 0;
    for (const entry of parsedJson) {
      const raw = entry.text;
      if (!raw || raw.trim() === '') continue;
      const idx = text.indexOf(raw, cursor);
      if (idx === -1) continue;
      const value = typeof entry.number === 'number' ? entry.number : Number.parseFloat(raw);
      if (!Number.isFinite(value)) continue;
      out.push({
        value,
        start: idx,
        end: idx + raw.length,
        raw,
      });
      cursor = idx + raw.length;
    }
  } catch {
    // Fail closed: compromise is a backstop; if it throws, return what we have.
  }
  return out;
}

function overlapsExisting(
  token: NumericToken,
  matches: readonly CqePatternMatch[],
): boolean {
  for (const m of matches) {
    if (m.spanStart < token.end && m.spanEnd > token.start) return true;
  }
  return false;
}
