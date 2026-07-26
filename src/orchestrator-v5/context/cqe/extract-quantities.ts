import type { QuantityExtractionResult } from './schema-types.js';
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
import { tracePattern } from './pattern-trace.js';

// Main CQE orchestrator. Pure, synchronous, deterministic, never throws.
// Returns an ordered array of QuantityExtractionResult per CQE Design v1.1 §5.
//
// TIMEOUT CONFORMANCE — read §5 "Timeout behaviour (amended 2026-07-19)"
// before changing either fork below. §5's ORIGINAL clause said "on timeout:
// fail closed to [] ... no partial-result fallback". The code never did
// that: it dropped one rule's result and let later rules and the compromise
// backstop re-claim the unmasked span — the forbidden partial-result
// fallback, and the mechanism of a P0 that silently wrote values wrong by
// 100x to 1e9x. That clause is now RETIRED and §5 documents the behaviour
// as built. Do not "restore" the `continue` on the per-rule fork: a rule
// that COMPLETED slowly has a correct result, and discarding it reclaims no
// latency (the work is already done) while re-opening the defect.
//
// CLOCK CHOICE — both budget forks measure CPU TIME CONSUMED, never wall
// time. See `cpuMs()` for the full rationale; the short version is that this
// function is pure and deterministic, so its OUTPUT must not depend on how
// contended the host is, and a wall clock cannot tell "this regex is
// backtracking catastrophically" apart from "this process was descheduled".
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
  /**
   * TRUE when at least one pattern rule did NOT run to completion, so the
   * result set may be missing the highest-fidelity interpretation of some
   * span and a lower-fidelity substitute may have taken its place.
   *
   * This is deliberately NARROWER than `timeout`. A rule that ran to
   * completion but exceeded its wall-clock cap is SLOW, not degraded — its
   * output is recorded and is exactly as correct as an in-budget run (a
   * regex is deterministic; slowness does not change what it matches). Only
   * a rule that never produced its matches can degrade the result set.
   *
   * Consumers that deterministically APPLY an extracted value (see
   * `tryDeterministicValueUpdate`) must refuse to do so when this is true —
   * a slower correct answer beats a fast wrong one.
   */
  readonly degraded: boolean;
  readonly message_too_long: boolean;
  readonly word_range_missed: boolean;
  readonly ambiguous_phrasing_detected: boolean;
}

export interface CqeExtractionOutput {
  readonly results: readonly QuantityExtractionResult[];
  readonly summary: CqeExtractionSummary;
}

/**
 * Test-only hooks. Not exported from the public surface of this module;
 * only `__runExtractionForTesting` accepts them. Production callers of
 * `runExtraction(rawMessage)` cannot reach these fields by construction.
 */
export interface CqeTestHooks {
  /**
   * Rules (by id, e.g. "P1") the orchestrator should treat as having timed
   * out. When a rule is in this set, its apply() is skipped entirely, the
   * per-pattern timeout telemetry fires exactly as if the circuit breaker
   * had tripped, and later rules continue unaffected.
   */
  readonly forceTimeoutPatterns?: ReadonlySet<string>;
  /** Override the rule list (for tests that want a minimal or injected set). */
  readonly patternRules?: readonly PatternRule[];
}

export function extractQuantities(rawMessage: string): QuantityExtractionResult[] {
  return runExtraction(rawMessage).results as QuantityExtractionResult[];
}

/**
 * Public extractor entry point. Production code calls this; it takes only
 * the raw user message and does not expose any test hooks on its signature.
 */
export function runExtraction(rawMessage: string): CqeExtractionOutput {
  return runExtractionInternal(rawMessage, undefined);
}

/**
 * Test-only extractor entry point. Production code must not import this.
 * It accepts the same input plus `CqeTestHooks` for deterministic
 * simulation of timeout and rule-injection scenarios that cannot be
 * reliably produced in a synchronous unit test otherwise.
 */
export function __runExtractionForTesting(
  rawMessage: string,
  hooks: CqeTestHooks,
): CqeExtractionOutput {
  return runExtractionInternal(rawMessage, hooks);
}

function runExtractionInternal(
  rawMessage: string,
  hooks: CqeTestHooks | undefined,
): CqeExtractionOutput {
  const startedAt = nowMs();
  const cpuStartedAt = cpuMs();
  const originalLength = typeof rawMessage === 'string' ? rawMessage.length : 0;
  const emptySummary: CqeExtractionSummary = {
    message_length: originalLength,
    result_count: 0,
    cqe_match_count: 0,
    compromise_match_count: 0,
    patterns_matched: [],
    duration_ms: 0,
    timeout: false,
    degraded: false,
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
    let degraded = false;
    const patternsMatched = new Set<string>();
    // CPU-time deadline, not a wall-clock one — see `cpuMs()`.
    const budgetDeadline = cpuStartedAt + CQE_TOTAL_BUDGET_MS;

    const activeRules = hooks?.patternRules ?? PATTERN_RULES;
    const forcedTimeouts = hooks?.forceTimeoutPatterns ?? EMPTY_SET;

    for (const rule of activeRules) {
      if (cpuMs() > budgetDeadline) {
        // The remaining rules never run, so the highest-fidelity reading of
        // any span they would have claimed is missing from the result set.
        // That IS degradation, and it is the one fork that used to exit
        // here with NO telemetry at all — an unobservable branch on a path
        // that writes values into the user's graph.
        timedOut = true;
        degraded = true;
        emitBudgetExhausted(rule.id, activeRules, cpuMs() - cpuStartedAt);
        break;
      }
      if (forcedTimeouts.has(rule.id)) {
        // apply() is skipped entirely, so this rule contributed nothing.
        timedOut = true;
        degraded = true;
        emitPatternTimeout(rule.id, 'forced_for_test');
        continue;
      }
      const ruleStart = cpuMs();
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
      const ruleDuration = cpuMs() - ruleStart;
      if (ruleDuration > CQE_REGEX_TIMEOUT_MS) {
        // SLOW, but NOT degraded — and deliberately NOT `continue`.
        //
        // This check runs AFTER rule.apply() has already returned. JS regex
        // execution is synchronous and non-interruptible, so by the time we
        // can observe `ruleDuration` the (possibly catastrophic) backtracking
        // has already completed and been paid for in full. Discarding the
        // result here therefore buys ZERO latency back — the cost is sunk —
        // while throwing away a result that is exactly as correct as an
        // in-budget one. That trade was strictly negative: it was the
        // dominant source of silent value corruption on this path, because
        // the unmasked span is then re-claimed by a lower-fidelity
        // substitute (a lower-priority rule, or the compromise backstop)
        // that yields a DIFFERENT NUMBER, not merely fewer numbers.
        //
        // `Docs/v5/cqe-design-v1_1.md` §5 is explicit that the 50ms cap is
        // "defence-in-depth against pathological input, not a normal
        // control-flow mechanism. If a regex regularly approaches the
        // timeout, redesign the regex." Dropping the result made it exactly
        // the control-flow mechanism the design forbids. We keep the
        // measurement and the telemetry (that is the redesign signal the
        // design doc asks for) and keep the work we already paid for.
        //
        // The cumulative-cost concern the cap existed to serve is still
        // served — by the total-budget check at the top of this loop, which
        // runs BEFORE the next rule and so can actually prevent work.
        //
        // `ruleDuration` is CPU TIME, not wall time (see `cpuMs()`). On a
        // wall clock this branch fired on a merely-contended host — measured
        // at ~15 spurious trips per 18,000 extractions under 4x CPU
        // oversubscription, for rules doing ~0.3ms of actual work. That is a
        // broken alarm: it reported "redesign this regex" about a regex that
        // was fine and a machine that was busy, and a signal that cries wolf
        // is a signal nobody reads. On a CPU clock it fires only when a rule
        // really did burn the budget, which is the redesign signal §5 asks
        // for.
        timedOut = true;
        emitPatternTimeout(rule.id, 'cpu_time_exceeded', ruleDuration);
      }
      if (ruleMatches.length === 0) {
        tracePattern(rule.id, false, null, ruleDuration);
      }
      for (const m of ruleMatches) {
        matches.push({ ...m, patternId: rule.id });
        patternsMatched.add(rule.id);
        maskedText = maskSpan(maskedText, m.spanStart, m.spanEnd);
        tracePattern(rule.id, true, `${m.spanStart}:${m.spanEnd}`, ruleDuration);
      }
    }

    const backstopMatches = compromiseBackstop(maskedText, matches);
    const allMatches = [...matches, ...backstopMatches];

    allMatches.sort((a, b) => a.spanStart - b.spanStart);
    const filtered = applyPostFilters(allMatches, text);

    const cqeCount = filtered.filter((m) => m.result.source === 'cqe').length;
    const compromiseCount = filtered.filter((m) => m.result.source === 'compromise').length;

    const results = filtered.map((m) => {
      const valueSpan = locateValueTokenSpan(m);
      return {
        ...normaliseResult(m.result),
        ...(valueSpan !== null
          ? { span_start: valueSpan.start, span_end: valueSpan.end }
          : {}),
      };
    });

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
      degraded,
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
  // Prefer a monotonic clock where available (always on Node 18+, always
  // in browsers). globalThis.performance satisfies the project's eslint
  // no-undef rule without a per-file ambient global.
  //
  // WALL TIME. Used for `summary.duration_ms` ONLY — how long the caller
  // waited is a latency fact and wall time is the honest way to report it.
  // It must never decide whether a rule runs; see `cpuMs()`.
  const perf = globalThis.performance;
  return perf !== undefined ? perf.now() : Date.now();
}

/**
 * CPU time consumed by this process so far, in milliseconds.
 *
 * THIS is the clock both budget guards below use, and the reason is the
 * whole point of ROADMAP 1.232.
 *
 * The guards exist to bound WORK — specifically a pattern regex backtracking
 * catastrophically on adversarial input. Work is CPU. They were previously
 * driven by `performance.now()`, which measures WALL time, and wall time on
 * a contended host also counts every millisecond the process spent
 * DESCHEDULED — time in which the extractor did nothing at all and no
 * catastrophic backtracking was happening.
 *
 * That made a pure, deterministic, side-effect-free function's OUTPUT depend
 * on how busy the machine was. The total-budget fork would `break` out of
 * the rule loop, the highest-fidelity rules for a span never ran, and the
 * compromise backstop re-claimed that span with a DIFFERENT NUMBER (measured:
 * "set churn to 5% and cost to 50000" yields 0.05 on an idle host and 5 — a
 * silent 100x error — on a loaded one). This repo had already measured the
 * trigger and worked around it *in the tests* rather than in the source:
 * see the `withFrozenClock` helper in `extract-quantities.degraded.test.ts`,
 * whose comment records "on a cold JIT or a loaded machine a real
 * runExtraction genuinely exceeds CQE_TOTAL_BUDGET_MS". Independently
 * re-measured 2026-07-26 under 8x CPU oversubscription: 126ms of wall time
 * accrued before rule #3 of 15 against a 200ms budget, for ~0.02ms of actual
 * work.
 *
 * A CPU clock cannot be fooled this way: a process that is starved for 300ms
 * accrues ~0.03ms of CPU (measured), while a regex that genuinely burns
 * 200ms of CPU still trips the guard exactly as before. Resolution is 1
 * microsecond and each call costs ~0.5us, i.e. ~20us added to an extraction
 * whose median cost is ~60us — a price worth paying to stop a pure function
 * returning different numbers on a busy laptop.
 */
function cpuMs(): number {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

function emitPatternTimeout(
  patternId: string,
  reason: 'cpu_time_exceeded' | 'forced_for_test',
  durationMs?: number,
): void {
  log.warn(
    {
      event: 'cqe.pattern_timeout',
      // Literal brief §6 Gate 5 requirement: payload carries `timeout: true`
      // alongside `pattern_id` so machine-readable filters can select
      // timed-out patterns without parsing the event name.
      timeout: true,
      pattern_id: patternId,
      reason,
      // CPU milliseconds consumed by this rule — the quantity that was
      // actually compared against the cap. Renamed from the old
      // `wall_clock_exceeded` reason when the guard moved off the wall clock
      // (ROADMAP 1.232): a label that outlives the mechanism it names is how
      // an honest signal turns into a false one.
      duration_ms: durationMs,
      timeout_cap_ms: CQE_REGEX_TIMEOUT_MS,
    },
    'CQE pattern exceeded wall-clock budget; no partial mask recorded',
  );
}

/**
 * Telemetry for the total-budget fork. Before this existed the loop could
 * `break` here having run only some of the rules, emitting NOTHING — an
 * unobservable branch on a path whose output is deterministically written
 * into the user's graph. `skipped_pattern_ids` names exactly which rules
 * never ran, so an operator can tell which fidelity was lost rather than
 * only that something was.
 */
function emitBudgetExhausted(
  firstSkippedId: string,
  activeRules: readonly PatternRule[],
  elapsedMs: number,
): void {
  const firstIdx = activeRules.findIndex((r) => r.id === firstSkippedId);
  const skipped = firstIdx >= 0 ? activeRules.slice(firstIdx).map((r) => r.id) : [firstSkippedId];
  log.warn(
    {
      event: 'cqe.budget_exhausted',
      timeout: true,
      degraded: true,
      first_skipped_pattern_id: firstSkippedId,
      skipped_pattern_ids: skipped,
      skipped_count: skipped.length,
      // CPU milliseconds consumed before the budget tripped — the quantity
      // compared against `total_budget_ms`, not the caller's wall-clock wait
      // (which `summary.duration_ms` still reports). See `cpuMs()`.
      elapsed_ms: elapsedMs,
      total_budget_ms: CQE_TOTAL_BUDGET_MS,
    },
    'CQE total wall-clock budget exhausted; remaining patterns skipped and extraction marked degraded',
  );
}

function maskSpan(text: string, start: number, end: number): string {
  const spaces = ' '.repeat(Math.max(0, end - start));
  return text.slice(0, start) + spaces + text.slice(end);
}

// ---------------------------------------------------------------------------
// O-1 (batch mutation lifecycle) — value-token span location.
//
// A CQE match's spanStart/spanEnd cover the WHOLE pattern match — the
// sentence-level rules capture the full leading clause ("set Factor A to
// current plan and Factor B to 0.8" is ONE match), so the match span is
// useless for label↔quantity pairing. What pairing needs is the span of the
// NUMERIC VALUE TOKEN inside the match. Rules don't expose per-capture-group
// offsets, so we re-locate the token inside `raw`:
//   1. collect every digit-bearing numeric token in the matched text;
//   2. prefer the token whose parsed number reproduces `result.value`
//      (undoing the percent /100 pre-normalisation and the k/m/bn suffix
//      expansion); when several qualify, take the LAST — value phrasing puts
//      the operand at the end of the clause ("set X to 0.8");
//   3. otherwise fall back to the last numeric token;
//   4. a match with NO digit token ("double it", "a half") gets no span —
//      the compound detector refuses to pair spanless quantities.
// Offsets are absolute positions in the CQE-normalised text (the same
// coordinate space as spanStart/spanEnd).
// ---------------------------------------------------------------------------

const VALUE_TOKEN_SCAN_RE = /-?(?:\d[\d]*(?:\.\d+)?|\.\d+)/g;
const VALUE_SUFFIX_FACTORS = [1, 1e3, 1e6, 1e9];

function locateValueTokenSpan(
  match: CqePatternMatch,
): { start: number; end: number } | null {
  const tokens: Array<{ start: number; end: number; parsed: number }> = [];
  VALUE_TOKEN_SCAN_RE.lastIndex = 0;
  for (
    let m = VALUE_TOKEN_SCAN_RE.exec(match.raw);
    m !== null;
    m = VALUE_TOKEN_SCAN_RE.exec(match.raw)
  ) {
    if (m.index === VALUE_TOKEN_SCAN_RE.lastIndex) VALUE_TOKEN_SCAN_RE.lastIndex++;
    const parsed = Number.parseFloat(m[0]);
    if (!Number.isFinite(parsed)) continue;
    tokens.push({
      start: match.spanStart + m.index,
      end: match.spanStart + m.index + m[0].length,
      parsed,
    });
  }
  if (tokens.length === 0) return null;

  const targets = [
    match.result.value,
    match.result.range_min,
    match.result.range_max,
  ].filter((v): v is number => typeof v === 'number');
  const isPercent = match.result.unit === 'percentage';
  const reproduces = (parsed: number): boolean =>
    targets.some((target) =>
      VALUE_SUFFIX_FACTORS.some(
        (f) =>
          parsed * f === target || (isPercent && (parsed * f) / 100 === target),
      ),
    );
  const matching = tokens.filter((t) => reproduces(t.parsed));
  const chosen =
    matching.length > 0 ? matching[matching.length - 1]! : tokens[tokens.length - 1]!;
  return { start: chosen.start, end: chosen.end };
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
