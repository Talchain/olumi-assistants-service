/**
 * Unit tests for the shared robustness-honesty helpers extracted from the
 * post-analysis advice gate (PR #193). Locking the truth table here lets
 * both the free-text composer (advice gate) and the deterministic chip-
 * click composer (what_would_flip fallback) consume the SAME thresholds
 * and override semantics without duplicating either.
 */

import { describe, expect, it } from 'vitest';

import {
  NEAR_TIE_PP_THRESHOLD,
  RAW_FRAGILE_LEVELS,
  closenessLead,
  describeRobustnessBand,
  isNearTieByMargin,
  isRawFragile,
  nearTieReasonByMargin,
  quoteLabel,
  type RawRobustnessSignals,
} from '../robustness-honesty.js';

describe('robustness-honesty SSOT', () => {
  it('NEAR_TIE_PP_THRESHOLD is 1.0pp (inclusive)', () => {
    expect(NEAR_TIE_PP_THRESHOLD).toBe(1.0);
  });

  it('RAW_FRAGILE_LEVELS contains the canonical fragility synonyms', () => {
    expect(RAW_FRAGILE_LEVELS.has('very_low')).toBe(true);
    expect(RAW_FRAGILE_LEVELS.has('low')).toBe(true);
    expect(RAW_FRAGILE_LEVELS.has('fragile')).toBe(true);
    // Negative coverage: ensure no false friends crept in.
    expect(RAW_FRAGILE_LEVELS.has('moderate')).toBe(false);
    expect(RAW_FRAGILE_LEVELS.has('medium')).toBe(false);
    expect(RAW_FRAGILE_LEVELS.has('stable')).toBe(false);
    expect(RAW_FRAGILE_LEVELS.has('high')).toBe(false);
  });

  describe('isNearTieByMargin', () => {
    it('true at the threshold (1.0pp inclusive)', () => {
      expect(isNearTieByMargin(1.0, null)).toBe(true);
      expect(isNearTieByMargin(-1.0, null)).toBe(true);
    });
    it('true below the threshold', () => {
      expect(isNearTieByMargin(0.4, null)).toBe(true);
      expect(isNearTieByMargin(0, null)).toBe(true);
    });
    it('false above the threshold', () => {
      expect(isNearTieByMargin(1.01, null)).toBe(false);
      expect(isNearTieByMargin(6, null)).toBe(false);
      expect(isNearTieByMargin(35, null)).toBe(false);
    });
    it('raw near_tie.is_tie=true wins regardless of margin', () => {
      const raw: RawRobustnessSignals = { level: null, near_tie_is_tie: true };
      expect(isNearTieByMargin(20, raw)).toBe(true);
      expect(isNearTieByMargin(null, raw)).toBe(true);
      expect(isNearTieByMargin(undefined, raw)).toBe(true);
    });
    it('null / undefined / NaN / Infinity margin without raw override → false', () => {
      expect(isNearTieByMargin(null, null)).toBe(false);
      expect(isNearTieByMargin(undefined, null)).toBe(false);
      expect(isNearTieByMargin(Number.NaN, null)).toBe(false);
      expect(isNearTieByMargin(Number.POSITIVE_INFINITY, null)).toBe(false);
    });
  });

  describe('nearTieReasonByMargin', () => {
    it("'margin' when margin alone fires the verdict", () => {
      expect(nearTieReasonByMargin(0.5, null)).toBe('margin');
    });
    it("'override' when the raw flag is the only signal", () => {
      const raw: RawRobustnessSignals = { level: null, near_tie_is_tie: true };
      expect(nearTieReasonByMargin(20, raw)).toBe('override');
      expect(nearTieReasonByMargin(null, raw)).toBe('override');
    });
    it("'margin' when margin AND override both fire (margin wins as authoritative)", () => {
      const raw: RawRobustnessSignals = { level: null, near_tie_is_tie: true };
      expect(nearTieReasonByMargin(0.3, raw)).toBe('margin');
    });
    it('null when neither signal fires', () => {
      expect(nearTieReasonByMargin(20, null)).toBe(null);
      expect(nearTieReasonByMargin(null, null)).toBe(null);
    });
  });

  describe('isRawFragile', () => {
    it.each(['very_low', 'low', 'fragile'])('true for level=%s', (level) => {
      expect(isRawFragile({ level, near_tie_is_tie: false })).toBe(true);
    });
    it.each(['moderate', 'medium', 'stable', 'high', 'very_high', 'highly_stable', 'unknown'])(
      'false for level=%s',
      (level) => {
        expect(isRawFragile({ level, near_tie_is_tie: false })).toBe(false);
      },
    );
    it('false when rawRobustness is null / undefined / level is null', () => {
      expect(isRawFragile(null)).toBe(false);
      expect(isRawFragile(undefined)).toBe(false);
      expect(isRawFragile({ level: null, near_tie_is_tie: false })).toBe(false);
    });
  });
});

describe('describeRobustnessBand — plain-language band phrases', () => {
  it('maps each canonical band to a calm plain phrase (never the raw token)', () => {
    expect(describeRobustnessBand('highly_stable')).toBe('very stable');
    expect(describeRobustnessBand('stable')).toBe('stable');
    expect(describeRobustnessBand('moderate')).toBe('fairly stable');
    expect(describeRobustnessBand('fragile')).toBe('fragile');
  });

  it('never returns the raw snake_case enum token or "robustness band" jargon', () => {
    for (const band of ['highly_stable', 'stable', 'moderate', 'fragile']) {
      const phrase = describeRobustnessBand(band);
      expect(phrase).not.toBeNull();
      expect(phrase!).not.toContain('_');
      expect(phrase!.toLowerCase()).not.toContain('robustness');
      expect(phrase!.toLowerCase()).not.toContain('band');
    }
  });

  it('returns null for unknown / absent bands so the caller omits the sentence', () => {
    expect(describeRobustnessBand(null)).toBeNull();
    expect(describeRobustnessBand(undefined)).toBeNull();
    expect(describeRobustnessBand('')).toBeNull();
    expect(describeRobustnessBand('weird_unknown_band')).toBeNull();
  });
});

describe('quoteLabel', () => {
  it('wraps a display label in straight single quotes', () => {
    expect(quoteLabel('Hire One Tech Lead and One Developer')).toBe(
      "'Hire One Tech Lead and One Developer'",
    );
  });
});

describe('closenessLead', () => {
  it('returns null when not a near-tie (caller emits the clear-lead opener)', () => {
    const out = closenessLead({
      leadingLabel: 'A',
      runnerLabel: 'B',
      tieReason: null,
      marginPp: 24,
    });
    expect(out).toBeNull();
  });

  it('returns null when there is no runner-up label', () => {
    expect(
      closenessLead({ leadingLabel: 'A', runnerLabel: null, tieReason: 'override', marginPp: 5 }),
    ).toBeNull();
    expect(
      closenessLead({ leadingLabel: 'A', runnerLabel: '  ', tieReason: 'margin', marginPp: 0.5 }),
    ).toBeNull();
  });

  it('margin tie (≤1pp) → "effectively tied" with quoted labels, no number', () => {
    const out = closenessLead({
      leadingLabel: 'Hire One Tech Lead',
      runnerLabel: 'Hire One Tech Lead and One Developer',
      tieReason: 'margin',
      marginPp: 0.4,
    });
    expect(out).toBe(
      "'Hire One Tech Lead' and 'Hire One Tech Lead and One Developer' are effectively tied.",
    );
  });

  it('override tie with finite margin → "close call … by about N percentage points" (real margin)', () => {
    const out = closenessLead({
      leadingLabel: 'Hire One Tech Lead',
      runnerLabel: 'Hire One Tech Lead and One Developer',
      tieReason: 'override',
      marginPp: 5.15,
    });
    expect(out).toBe(
      "This is a close call: 'Hire One Tech Lead' is narrowly ahead of 'Hire One Tech Lead and One Developer' by about 5 percentage points.",
    );
  });

  it('override tie with non-finite margin → number-free near-tie line', () => {
    const out = closenessLead({
      leadingLabel: 'A',
      runnerLabel: 'B',
      tieReason: 'override',
      marginPp: null,
    });
    expect(out).toBe("This is a close call: the analysis treats 'A' and 'B' as a near-tie.");
  });
});
