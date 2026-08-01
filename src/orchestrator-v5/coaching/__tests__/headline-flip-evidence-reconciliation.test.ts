/**
 * ROADMAP 2.278 — the analysis-result headline must not tell the user "small
 * changes could flip it" on a turn whose own flip evidence attests that nothing
 * flips in range.
 *
 * `NOT_ROBUST_SENTENCE` is CEE's closest analogue to PLoT's
 * `display_verdict` + `display_verdict_reason` pair: a verdict plus a reason,
 * keyed off `robustness.is_robust` / `robustness.level` — robustness MARGINALS —
 * and asserting flippability. On all four witnessed staging turns
 * (`witness-2267-raw/`) `is_robust` was `false`, so this sentence shipped, while
 * 19 of 19 flip rows attested `structurally_invariant`.
 *
 * The verdict itself ("not yet robust") is TRUE and is preserved — the
 * robustness Monte Carlo really did report an unstable result. Only the REASON
 * is corrected, because the instability is in the margin, not in the ranking.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  isAllowedRunAnalysisAssistantText,
} from '../analysis-result-headline.js';
import {
  FORBIDDEN_HEADLINE_VOCABULARY_REGEX,
  RAW_DECIMAL_REGEX,
  ASSISTANT_TEXT_ID_REGEX,
} from '../assistant-text-defences.js';

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../../../../tests/fixtures/cross-service/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}

const NO_FLIP = loadFixture('witness-2267-attested-no-flip.json');
const REAL_FLIP = loadFixture('witness-2265-runA.flip-threshold-winner.json');
const NO_FLIP_RUNS = Object.entries(NO_FLIP.runs as Record<string, Record<string, unknown>>);

import { assertsFlippability } from '../../__tests__/support/flip-claim-matcher.support.js';

/** Option field that lets the headline resolve a winner (Case E floor). */
const RESULTS = [
  { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.34 },
  { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.33 },
  { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.33 },
];

/** The witnessed robustness block, plus the run's real flip evidence. */
function enrichmentFor(run: Record<string, unknown>, withFlipEvidence: boolean) {
  const rob = run.robustness as Record<string, unknown>;
  return {
    results: RESULTS,
    robustness: { is_robust: rob.is_robust, level: rob.level },
    ...(withFlipEvidence ? { flip_thresholds: run.flip_thresholds } : {}),
  };
}

function headline(enrichment: Record<string, unknown>): string {
  return buildAnalysisResultHeadline({
    enrichment,
    leading_option_id: 'opt_a',
    status_kind: 'ok',
  }) as string;
}

describe('positive control — the matcher can SEE the shipped claim', () => {
  // Trap 13: prove a presence before asserting an absence.
  it('the current sentence is emitted, and matches, when there is no flip evidence', () => {
    const out = headline(enrichmentFor(NO_FLIP_RUNS[0]![1], false));
    expect(out).toContain('not yet robust');
    expect(assertsFlippability(out)).toBe(true);
  });
});

describe('RED-first — attested-no-flip turns lose the flippability reason', () => {
  it.each(NO_FLIP_RUNS)('run %s — no flippability claim', (_name, run) => {
    expect(assertsFlippability(headline(enrichmentFor(run, true)))).toBe(false);
  });

  it.each(NO_FLIP_RUNS)('run %s — the not-robust VERDICT is preserved', (_name, run) => {
    // The result really is not robust. Suppressing the whole sentence would be
    // over-correction: it would hide a true caveat.
    expect(headline(enrichmentFor(run, true))).toContain('not yet robust');
  });

  it('the correction is driven by the FLIP EVIDENCE, not the robustness block', () => {
    // Identical robustness; only flip_thresholds differs. Mutation witness: if
    // the headline stops reading flip_thresholds these two become equal.
    const run = NO_FLIP_RUNS[0]![1];
    const withEvidence = headline(enrichmentFor(run, true));
    const withoutEvidence = headline(enrichmentFor(run, false));
    expect(assertsFlippability(withoutEvidence)).toBe(true);
    expect(assertsFlippability(withEvidence)).toBe(false);
    expect(withEvidence).not.toBe(withoutEvidence);
  });

  it.each(NO_FLIP_RUNS)('run %s — the replacement passes the content defences', (_name, run) => {
    const out = headline(enrichmentFor(run, true));
    expect(out).not.toMatch(FORBIDDEN_HEADLINE_VOCABULARY_REGEX);
    expect(out).not.toMatch(ASSISTANT_TEXT_ID_REGEX);
    expect(out).not.toMatch(RAW_DECIMAL_REGEX);
    expect(out).not.toMatch(/\d+%/);
  });

  it('the replacement survives the egress GRAMMAR (else the user gets the locked template)', () => {
    // The defect this guards is the one the module header records for the
    // constraint-gap disclosure: copy that is rejected at egress is silently
    // replaced, so the honest half never reaches the wire.
    const out = headline(enrichmentFor(NO_FLIP_RUNS[0]![1], true));
    expect(isAllowedRunAnalysisAssistantText(out)).toBe(true);
  });
});

describe('POSITIVE CONTROL — a real flip keeps the flippability reason', () => {
  it('witness-2265 runA (a genuine measured flip) is untouched', () => {
    const out = headline({
      results: RESULTS,
      robustness: { is_robust: false, level: 'very_low' },
      flip_thresholds: REAL_FLIP.flip_thresholds,
    });
    expect(assertsFlippability(out)).toBe(true);
  });
});

describe('BACKWARD COMPATIBILITY — absent flip evidence is byte-identical', () => {
  it.each([
    ['no flip_thresholds key', {}],
    ['empty array', { flip_thresholds: [] }],
    ['unattested null rows', { flip_thresholds: [{ factor_id: 'a', factor_label: 'A', flip_value: null }] }],
  ])('%s → the original sentence', (_label, extra) => {
    const out = headline({ results: RESULTS, robustness: { level: 'low' }, ...extra });
    expect(out).toContain('The result is not yet robust — small changes could flip it.');
  });

  it('a ROBUST result still emits no sentence at all', () => {
    const out = headline({
      results: RESULTS,
      robustness: { is_robust: true, level: 'high' },
      flip_thresholds: NO_FLIP_RUNS[0]![1].flip_thresholds,
    });
    expect(out).not.toContain('not yet robust');
  });
});
