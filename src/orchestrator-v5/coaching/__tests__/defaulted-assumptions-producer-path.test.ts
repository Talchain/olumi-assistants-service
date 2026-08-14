/**
 * F6 — the defaulted-value disclosure must read the path the PRODUCER actually
 * emits, proven against REAL CAPTURES rather than a self-authored envelope.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WENT WRONG, AND WHY A FULLY GREEN SUITE COULD NOT SEE IT
 *
 * #940 built the whole defaulted-value disclosure machinery — the selector, the
 * stability collapse, the canonical sentence — and every part of it is correct.
 * It never fired on a single real payload, because the SELECTOR read
 *
 *     enrichment.defaulted_assumptions            ← top level
 *
 * while PLoT has only ever emitted
 *
 *     enrichment.decision_brief.defaulted_assumptions   ← nested
 *
 * (PLoT `assembly/decision-brief.ts`; the key is absent from
 * `ISL_TOPLEVEL_ENRICHMENT_KEYS` and there is no wholesale spread, and CEE
 * persists PLoT's response byte-for-byte in `tools/handlers/run-analysis.ts`).
 *
 * ⭐ THE INSTRUMENT DEFECT IS THE LESSON (CLAUDE.md trap 16-inverse: "a fixture
 * you wrote yourself is not evidence about the wire"). #940's suite DID source
 * from the real capture — its header cites
 * `fixtures/dsk-walk/session-a.enrichment.json:949` — but it copied the ARRAY
 * ENTRY and then invented the ENVELOPE around it
 * (`enrichment: { defaulted_assumptions: defaulted }`). Line 949 sits at
 * four-space indentation INSIDE `decision_brief`. The entry was real; the PATH
 * was the author's model of the producer. Every assertion passed, 25 mutants
 * would have bitten, and the product disclosed nothing to anybody.
 *
 * So this suite refuses to construct an enrichment envelope at all. It loads
 * the captured envelope VERBATIM and hands it to the selector unmodified.
 *
 * ⚠ FIXTURES ARE READ, NEVER EDITED (CLAUDE.md trap 14b). These files record
 * what the producer actually sent on a dated run; rewriting one would falsify
 * the evidence. The no-defaults twin below is derived IN MEMORY by deleting a
 * single key from a parsed copy — the file on disk is untouched.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  pickLatestDefaultedAssumptions,
  readDefaultedAssumptions,
} from '../pick-defaulted-assumptions.js';

const CAPTURES = ['session-a', 'session-b2'] as const;

/** The factor label each capture actually defaulted, read from the file. */
const EXPECTED_LABEL: Record<(typeof CAPTURES)[number], string> = {
  'session-a': 'Market Conditions',
  'session-b2': 'Wholesale Flour Price',
};

function loadCapture(name: (typeof CAPTURES)[number]): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../compose/__tests__/fixtures/dsk-walk/${name}.enrichment.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
}

/**
 * A `run_analysis` fact carrying the capture's enrichment envelope VERBATIM.
 * The only authored bytes are the fact wrapper the selector needs; the
 * enrichment itself is the producer's, unmodified.
 */
function factWithEnrichment(enrichment: unknown): any {
  return [
    {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 's1',
        leading_option_id: 'opt_a',
        computed_at: '2026-08-13T19:30:00.000Z',
        enrichment,
      },
    },
  ];
}

describe('F6 — defaulted assumptions are read at the producer’s real path', () => {
  /**
   * ⭐ THE PRECONDITION IS PINNED IN-TEST (CLAUDE.md trap 13b). Without this
   * block a green result below could mean "the reader works" OR "the fixture
   * happens to carry the key top-level after all". These assertions make the
   * first reading the only available one, and they RED if a future capture is
   * added with a different shape rather than silently weakening the suite.
   */
  describe.each(CAPTURES)('precondition — capture %s really has the shape claimed', (name) => {
    const capture = loadCapture(name);

    it('carries defaulted_assumptions NESTED under decision_brief', () => {
      const brief = capture['decision_brief'] as Record<string, unknown>;
      expect(brief).toBeTypeOf('object');
      expect(Array.isArray(brief['defaulted_assumptions'])).toBe(true);
      expect((brief['defaulted_assumptions'] as unknown[]).length).toBeGreaterThan(0);
    });

    it('does NOT carry defaulted_assumptions at the top level', () => {
      expect(Object.hasOwn(capture, 'defaulted_assumptions')).toBe(false);
    });

    /**
     * CONTRAST CONTROL (CLAUDE.md trap 13e). A capture whose top level were
     * empty would satisfy the assertion above by being blank rather than by
     * being real. These two keys ARE top-level on the same envelope, so the
     * absence measured above is a real absence, not instrument blindness.
     */
    it('contrast control — sibling top-level enrichment keys ARE present', () => {
      expect(Object.hasOwn(capture, 'flip_thresholds')).toBe(true);
      expect(Object.hasOwn(capture, 'inference_warnings')).toBe(true);
    });
  });

  describe.each(CAPTURES)('selector over the verbatim %s envelope', (name) => {
    it('returns the engine’s defaulted-value signal', () => {
      const signal = pickLatestDefaultedAssumptions(factWithEnrichment(loadCapture(name)));

      expect(signal).not.toBeNull();
      expect(signal!.count).toBe(1);
      expect(signal!.named).toEqual([EXPECTED_LABEL[name]]);
    });

    /**
     * DIRECTION TWIN — no defaults ⇒ no signal, so the product can never invent
     * a caveat on a run that did not default anything. Derived from the SAME
     * capture with ONE key deleted in memory, which makes it maximally
     * comparable: one key is the entire difference between the two arms.
     */
    it('returns null once that one key is removed — no invented disclosure', () => {
      const capture = loadCapture(name);
      const brief = capture['decision_brief'] as Record<string, unknown>;
      delete brief['defaulted_assumptions'];

      expect(pickLatestDefaultedAssumptions(factWithEnrichment(capture))).toBeNull();
    });
  });

  /**
   * The normaliser is unchanged by this fix and is re-asserted over the real
   * entries only to prove the fix moved the READ PATH and nothing else.
   */
  it('normalises the captured entries without changing their meaning', () => {
    const capture = loadCapture('session-a');
    const brief = capture['decision_brief'] as Record<string, unknown>;

    expect(readDefaultedAssumptions(brief['defaulted_assumptions'])).toEqual({
      count: 1,
      named: ['Market Conditions'],
    });
  });
});
