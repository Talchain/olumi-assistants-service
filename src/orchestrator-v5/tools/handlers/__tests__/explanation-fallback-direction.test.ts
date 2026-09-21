/**
 * Boundary tests for `formatSensitivityDirection` and
 * `formatEdgeStrengthMagnitude`.
 *
 * The fallback helper composes a direct verb phrase ("Cost moderately weakens
 * the option that came out highest") rather than the noun-phrase form ("Cost
 * has a moderate negative influence") so the deterministic prose stays direct
 * about WHAT the influence is on. Thresholds still delegate to the canonical
 * `bandFromMagnitude` so the bucket boundaries cannot drift between this
 * fallback and the upstream display-safe projection.
 *
 * Vocabulary (adverb form), where SUBJECT is {@link RESULT_STANDING_SUBJECT}:
 *   |v| < 0.05         → "has little effect on SUBJECT"
 *   |v| in [0.05, 0.3) → "slightly strengthens|weakens SUBJECT"
 *   |v| in [0.3, 0.7)  → "moderately ..."
 *   |v| in [0.7, 0.95) → "strongly ..."
 *   |v| ≥ 0.95         → "very strongly ..."
 *
 * The lowest band uses "slightly" rather than "weakly" because
 * "weakly weakens" reads awkwardly. The other bands compose naturally
 * with `weakens` / `strengthens`.
 *
 * ⭐ THE SUBJECT IS INTERPOLATED FROM THE OWNER, NOT TYPED HERE (Paul's 21 Sep
 * ruling retired the league-table noun "the lead"). This table's job is the
 * BAND BOUNDARIES; spelling the referent out 25 times would make it a fourth
 * hand-maintained copy that keeps passing while the emitter drifts away from it
 * (CLAUDE.md trap 13b). The referent itself is pinned once, by identity, in the
 * dedicated block at the end of this describe.
 */

import { describe, expect, it } from 'vitest';
import {
  RESULT_STANDING_PATTERN,
  RESULT_STANDING_SUBJECT,
} from '../../../compose/goal-referenced-result-phrasing.js';
import { textNamesLeadingOption } from '../../../compose/leading-option-egress-guard.js';
import {
  formatSensitivityDirection,
  formatEdgeStrengthMagnitude,
} from '../explanation-fallback.js';

/** Shorthand so the band table below stays readable. */
const S = RESULT_STANDING_SUBJECT;

describe('formatSensitivityDirection', () => {
  it.each([
    // Near-zero short-circuit (|v| < 0.05).
    [0, `has little effect on ${S}`],
    [0.01, `has little effect on ${S}`],
    [-0.01, `has little effect on ${S}`],
    [0.049, `has little effect on ${S}`],
    [-0.049, `has little effect on ${S}`],
    // Weak band: [0.05, 0.3) — "slightly" to avoid "weakly weakens".
    [0.05, `slightly strengthens ${S}`],
    [-0.05, `slightly weakens ${S}`],
    [0.1, `slightly strengthens ${S}`],
    [0.2, `slightly strengthens ${S}`],
    [0.299, `slightly strengthens ${S}`],
    // Moderate band: [0.3, 0.7).
    [0.3, `moderately strengthens ${S}`],
    [-0.3, `moderately weakens ${S}`],
    [0.5, `moderately strengthens ${S}`],
    [0.699, `moderately strengthens ${S}`],
    // Strong band: [0.7, 0.95).
    [0.7, `strongly strengthens ${S}`],
    [-0.7, `strongly weakens ${S}`],
    [0.9, `strongly strengthens ${S}`],
    [0.949, `strongly strengthens ${S}`],
    // Very strong band: [0.95, ∞).
    [0.95, `very strongly strengthens ${S}`],
    [-0.95, `very strongly weakens ${S}`],
    [1.0, `very strongly strengthens ${S}`],
    // The brief's evidence #4 raw value: must surface as bucketed prose.
    [-0.7346938775510203, `strongly weakens ${S}`],
  ])('value=%s → %s', (value, expected) => {
    expect(formatSensitivityDirection(value)).toBe(expected);
  });

  it('non-finite input is treated as no material influence (does not throw)', () => {
    expect(formatSensitivityDirection(Number.NaN)).toBe(`has little effect on ${S}`);
    expect(formatSensitivityDirection(Number.POSITIVE_INFINITY)).toBe(
      `has little effect on ${S}`,
    );
    expect(formatSensitivityDirection(Number.NEGATIVE_INFINITY)).toBe(
      `has little effect on ${S}`,
    );
  });

  it('output never contains a raw decimal (no-decimal egress invariant)', () => {
    for (const v of [-0.7346, 0.123, -0.5, 0.6789, -1.23456, 0.4, -0.96]) {
      const out = formatSensitivityDirection(v);
      expect(out).not.toMatch(/-?\d+\.\d/);
    }
  });

  /**
   * ⭐⭐ THE RETIRED LEAGUE-TABLE NOUN, PINNED BY EXECUTION.
   *
   * PAUL'S RULING, 21 Sep 2026: "It's not a leading option… We are giving them
   * information to improve their critical and creative thinking, not
   * recommending options."
   *
   * ⛔ THE RISK HERE IS A LEAK, NOT A TYPO. `formatSensitivityDirection`'s
   * output is read as well as written: `withheld-history-redaction.ts` has to
   * scrub it out of the model's own stored history when a LATER turn withholds
   * the leader claim, and it decides that by calling
   * {@link textNamesLeadingOption}. The superseded phrase was caught by the
   * `the_lead` pattern; a reword no reader could see would switch that
   * redaction OFF silently. So these assert the OUTPUT SURVIVES THE READER, not
   * that it equals a string.
   */
  describe('the retired league-table noun, and the reader that must still see the phrase', () => {
    const EVERY_BAND = [0, 0.01, -0.049, 0.05, -0.2, 0.45, -0.32, 0.7, -0.9, 0.95, -1, Number.NaN];

    it('no band names "the lead" — the noun with no stated referent is gone', () => {
      for (const v of EVERY_BAND) {
        expect(formatSensitivityDirection(v), `band for ${v}`).not.toMatch(/\bthe\s+lead\b/i);
      }
    });

    it('POSITIVE CONTROL: that matcher DOES reject the superseded phrasing', () => {
      // Without this the assertion above could be passing by testing nothing.
      // Verbatim from the enriched-fixture reply measured before the change.
      expect(
        "The result appears to be driven by 'Delivery risk', which moderately strengthens the lead.",
      ).toMatch(/\bthe\s+lead\b/i);
    });

    it("every band interpolates the OWNER's subject, so a reword cannot leave one behind", () => {
      for (const v of EVERY_BAND) {
        expect(formatSensitivityDirection(v), `band for ${v}`).toContain(RESULT_STANDING_SUBJECT);
        expect(formatSensitivityDirection(v)).toMatch(RESULT_STANDING_PATTERN);
      }
    });

    it('⭐ THE LEAK GUARD: every band stays visible to the egress alarm IN ISOLATION', () => {
      for (const v of EVERY_BAND) {
        const sentence = `The result appears to be driven by 'Delivery risk', which ${formatSensitivityDirection(v)}.`;
        expect(
          textNamesLeadingOption(sentence),
          `the alarm is blind to ${JSON.stringify(sentence)} — a withheld leader would survive in stored history`,
        ).toBe(true);
      }
    });

    it('CONTRAST CONTROL: the alarm does not fire on prose carrying no ordering claim', () => {
      // If this ever goes true the leak guard above is vacuous AND the history
      // redactor has started scrubbing legitimate coaching (trap #13).
      expect(
        textNamesLeadingOption(
          'Two of your assumptions have no evidence attached yet, so the model is resting on them.',
        ),
      ).toBe(false);
    });
  });
});

describe('formatEdgeStrengthMagnitude', () => {
  it.each([
    // Weak band: |v| < 0.3.
    [0, 'weak'],
    [0.05, 'weak'],
    [-0.099, 'weak'],
    [0.1, 'weak'],
    [0.25, 'weak'],
    [0.299, 'weak'],
    // Moderate band: [0.3, 0.7).
    [0.3, 'moderate'],
    [-0.3, 'moderate'],
    [0.5, 'moderate'],
    [0.699, 'moderate'],
    // Strong band: [0.7, 0.95).
    [0.7, 'strong'],
    [-0.7, 'strong'],
    [0.85, 'strong'],
    [0.949, 'strong'],
    // Very strong band: [0.95, ∞).
    [0.95, 'very strong'],
    [-0.95, 'very strong'],
    [1.0, 'very strong'],
  ])('value=%s → %s', (value, expected) => {
    expect(formatEdgeStrengthMagnitude(value)).toBe(expected);
  });

  it('non-finite input falls back to weak (does not throw)', () => {
    expect(formatEdgeStrengthMagnitude(Number.NaN)).toBe('weak');
    expect(formatEdgeStrengthMagnitude(Number.POSITIVE_INFINITY)).toBe('weak');
  });

  it('output never contains a raw decimal', () => {
    for (const v of [-0.7346, 0.123, 0.6789, 0.4, -0.96]) {
      const out = formatEdgeStrengthMagnitude(v);
      expect(out).not.toMatch(/-?\d+\.\d/);
    }
  });
});
