import type { QuantityExtractionResult } from '@talchain/schemas/orchestrator';
import { preNormalise, MAX_INPUT_LENGTH } from './pre-normalise.js';
import { applyWordNumberPrePass } from './word-numbers.js';
import { PATTERN_RULES, type CqePatternMatch } from './rules.js';
import { compromiseBackstop } from './compromise-backstop.js';
import { applyPostFilters } from './post-filters.js';

// Main CQE orchestrator. Pure, synchronous, deterministic, never throws.
// Returns an ordered array of QuantityExtractionResult per CQE Design v1.1 §5.
//
// Telemetry is emitted by the caller (context-pack-assembler) using the
// summary returned here; this function itself does not emit events.

export const CQE_REGEX_TIMEOUT_MS = 50;
export const CQE_TOTAL_BUDGET_MS = 200;

export interface CqeExtractionSummary {
  readonly message_length: number;
  readonly result_count: number;
  readonly cqe_match_count: number;
  readonly compromise_match_count: number;
  readonly patterns_matched: readonly string[];
  readonly duration_ms: number;
  readonly timeout: boolean;
  readonly message_too_long: boolean;
  readonly word_range_missed: boolean;
  readonly ambiguous_phrasing_detected: boolean;
}

export interface CqeExtractionOutput {
  readonly results: readonly QuantityExtractionResult[];
  readonly summary: CqeExtractionSummary;
}

export function extractQuantities(rawMessage: string): QuantityExtractionResult[] {
  return runExtraction(rawMessage).results as QuantityExtractionResult[];
}

export function runExtraction(rawMessage: string): CqeExtractionOutput {
  const startedAt = nowMs();
  const originalLength = typeof rawMessage === 'string' ? rawMessage.length : 0;
  const emptySummary: CqeExtractionSummary = {
    message_length: originalLength,
    result_count: 0,
    cqe_match_count: 0,
    compromise_match_count: 0,
    patterns_matched: [],
    duration_ms: 0,
    timeout: false,
    message_too_long: false,
    word_range_missed: false,
    ambiguous_phrasing_detected: false,
  };
  if (!rawMessage || typeof rawMessage !== 'string') {
    return { results: [], summary: { ...emptySummary, duration_ms: nowMs() - startedAt } };
  }

  try {
    const normalised = preNormalise(rawMessage);
    const { text, replacements } = applyWordNumberPrePass(normalised.text);

    let maskedText = text;
    const matches: CqePatternMatch[] = [];
    let timedOut = false;
    const patternsMatched = new Set<string>();
    const budgetDeadline = startedAt + CQE_TOTAL_BUDGET_MS;

    for (const rule of PATTERN_RULES) {
      if (nowMs() > budgetDeadline) {
        timedOut = true;
        break;
      }
      const ruleStart = nowMs();
      let ruleMatches: CqePatternMatch[];
      try {
        ruleMatches = rule.apply(maskedText, { wordNumberReplacements: replacements });
      } catch {
        continue;
      }
      const ruleDuration = nowMs() - ruleStart;
      if (ruleDuration > CQE_REGEX_TIMEOUT_MS) {
        timedOut = true;
        continue;
      }
      for (const m of ruleMatches) {
        matches.push({ ...m, patternId: rule.id });
        patternsMatched.add(rule.id);
        maskedText = maskSpan(maskedText, m.spanStart, m.spanEnd);
      }
    }

    const backstopMatches = compromiseBackstop(maskedText, matches);
    const allMatches = [...matches, ...backstopMatches];

    allMatches.sort((a, b) => a.spanStart - b.spanStart);
    const filtered = applyPostFilters(allMatches, text);

    const cqeCount = filtered.filter((m) => m.result.source === 'cqe').length;
    const compromiseCount = filtered.filter((m) => m.result.source === 'compromise').length;

    const results = filtered.map((m) => normaliseResult(m.result));

    const wordRangeMissed = detectWordRangeMiss(rawMessage, results);
    const ambiguousPhrasingDetected = results.some(
      (r) => r.value_origin === 'lexical_quantifier' && r.value === null,
    );

    const summary: CqeExtractionSummary = {
      message_length: originalLength,
      result_count: results.length,
      cqe_match_count: cqeCount,
      compromise_match_count: compromiseCount,
      patterns_matched: Array.from(patternsMatched).sort(),
      duration_ms: nowMs() - startedAt,
      timeout: timedOut,
      message_too_long: normalised.messageTooLong,
      word_range_missed: wordRangeMissed,
      ambiguous_phrasing_detected: ambiguousPhrasingDetected,
    };

    return { results, summary };
  } catch {
    return {
      results: [],
      summary: { ...emptySummary, duration_ms: nowMs() - startedAt },
    };
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function maskSpan(text: string, start: number, end: number): string {
  const spaces = ' '.repeat(Math.max(0, end - start));
  return text.slice(0, start) + spaces + text.slice(end);
}

function normaliseResult(partial: Partial<QuantityExtractionResult>): QuantityExtractionResult {
  const {
    raw_text,
    value,
    unit,
    direction,
    multiplier,
    operator,
    comparator,
    range_min,
    range_max,
    approximate,
    source,
    value_origin,
  } = partial;
  return {
    raw_text: raw_text ?? '',
    value: value ?? null,
    unit: unit ?? null,
    direction: direction ?? null,
    multiplier: multiplier ?? null,
    operator: operator ?? null,
    comparator: comparator ?? null,
    range_min: range_min ?? null,
    range_max: range_max ?? null,
    approximate: approximate ?? false,
    source: source ?? 'cqe',
    ...(value_origin !== undefined ? { value_origin } : {}),
  };
}

// Heuristic: user wrote a word-number range ("between five and ten") but we
// did not emit a range result. Used for the upgrade trigger telemetry per
// CQE Design v1.1 §10.
const WORD_RANGE_HEURISTIC = /\bbetween\s+[a-z]+\s+and\s+[a-z]+\b/i;

function detectWordRangeMiss(
  rawMessage: string,
  results: readonly QuantityExtractionResult[],
): boolean {
  if (!WORD_RANGE_HEURISTIC.test(rawMessage)) return false;
  return !results.some((r) => r.comparator === 'between');
}

// Re-export the cap constant for callers that want to reason about it.
export { MAX_INPUT_LENGTH };
