import type { QuantityExtractionResult } from '@talchain/schemas/orchestrator';
import { log } from '../../../utils/telemetry.js';
import { preNormalise, MAX_INPUT_LENGTH } from './pre-normalise.js';
import { applyWordNumberPrePass } from './word-numbers.js';
import {
  PATTERN_RULES,
  type CqePatternMatch,
  type PatternRule,
} from './rules.js';
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

/**
 * Internal options for testing the circuit-breaker behaviour of the
 * extractor. Not part of the public contract. Production callers never pass
 * these; they exist so the timeout unit test can simulate a pattern
 * exceeding its wall-clock budget without needing a real slow regex.
 */
export interface RunExtractionInternalOptions {
  /**
   * Rules (by id, e.g. "P1") the orchestrator should treat as having timed
   * out. When a rule is in this set, its apply() is skipped entirely, the
   * per-pattern timeout telemetry fires exactly as if the circuit breaker
   * had tripped, and later rules continue unaffected.
   */
  readonly __testForceTimeoutPatterns?: ReadonlySet<string>;
  /** Override the rule list (for tests that want a minimal set). */
  readonly __testPatternRules?: readonly PatternRule[];
}

export function extractQuantities(rawMessage: string): QuantityExtractionResult[] {
  return runExtraction(rawMessage).results as QuantityExtractionResult[];
}

export function runExtraction(
  rawMessage: string,
  internalOptions: RunExtractionInternalOptions = {},
): CqeExtractionOutput {
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

    const activeRules =
      internalOptions.__testPatternRules ?? PATTERN_RULES;
    const forcedTimeouts = internalOptions.__testForceTimeoutPatterns ?? EMPTY_SET;

    for (const rule of activeRules) {
      if (nowMs() > budgetDeadline) {
        timedOut = true;
        break;
      }
      if (forcedTimeouts.has(rule.id)) {
        timedOut = true;
        emitPatternTimeout(rule.id, 'forced_for_test');
        continue;
      }
      const ruleStart = nowMs();
      let ruleMatches: CqePatternMatch[];
      try {
        ruleMatches = rule.apply(maskedText, { wordNumberReplacements: replacements });
      } catch (err) {
        log.warn(
          { pattern_id: rule.id, err: String(err) },
          'CQE rule threw during apply; continuing with no mask',
        );
        continue;
      }
      const ruleDuration = nowMs() - ruleStart;
      if (ruleDuration > CQE_REGEX_TIMEOUT_MS) {
        timedOut = true;
        emitPatternTimeout(rule.id, 'wall_clock_exceeded', ruleDuration);
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
  } catch (err) {
    // Defence-in-depth: extractQuantities() contract says it never throws.
    // If an unexpected error surfaces (e.g. a runtime change in compromise
    // or a pattern regex that the typechecker missed), surface it through
    // structured logging so it isn't silently a dark feature.
    log.warn(
      {
        event: 'cqe.extraction_failed',
        err: String(err),
        message_length: originalLength,
      },
      'CQE extraction threw unexpectedly; returning empty result set',
    );
    return {
      results: [],
      summary: { ...emptySummary, duration_ms: nowMs() - startedAt },
    };
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

function emitPatternTimeout(
  patternId: string,
  reason: 'wall_clock_exceeded' | 'forced_for_test',
  durationMs?: number,
): void {
  log.warn(
    {
      event: 'cqe.pattern_timeout',
      pattern_id: patternId,
      reason,
      duration_ms: durationMs,
      timeout_cap_ms: CQE_REGEX_TIMEOUT_MS,
    },
    'CQE pattern exceeded wall-clock budget; no partial mask recorded',
  );
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
