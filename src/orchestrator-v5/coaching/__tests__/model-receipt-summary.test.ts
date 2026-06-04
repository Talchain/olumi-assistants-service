/**
 * Unit tests for buildModelReceiptSummary (F1 PR A).
 *
 * The helper feeds `analysis_ready.coaching_summary` — the short, pre-analysis
 * "assumption to check" line DGAI's ModelReceiptBlock will use as its
 * top-insight (PR B). It MUST reuse the post-draft narrative's gated
 * assumption tier so the structured insight and the chat narrative stay
 * consistent and copy-safe (no internal IDs, no recommendation / winner
 * language), and return null when only the generic fallback applies so the
 * receipt never surfaces a weak, contentless insight.
 *
 * Scope note: this helper deliberately does NOT scrub entity IDs — the
 * dispatch site applies `sanitiseCoachingProse` as the egress guard. These
 * tests therefore assert the GATE behaviour (IDs / recommendation prose are
 * rejected before they can be selected); the dispatch-level test asserts the
 * scrub.
 */
import { describe, it, expect } from 'vitest';

import { buildModelReceiptSummary } from '../post-draft-narrative.js';

describe('buildModelReceiptSummary', () => {
  it('returns the gated assumption sentence from a strengthen_item detail', () => {
    const summary = buildModelReceiptSummary({
      graph: null,
      strengthenItems: [{ detail: 'the delivery timeline may be optimistic' }],
    });
    expect(summary).toBe(
      'One assumption worth checking: the delivery timeline may be optimistic.',
    );
  });

  it('returns null when only the deterministic generic fallback applies', () => {
    const summary = buildModelReceiptSummary({
      graph: null,
      strengthenItems: [],
      coachingBiasSignals: [],
    });
    expect(summary).toBeNull();
  });

  it('rejects premature-recommendation prose and returns null rather than leaking a verdict', () => {
    const summary = buildModelReceiptSummary({
      graph: null,
      strengthenItems: [{ detail: 'option B is the best choice' }],
    });
    // The only candidate trips PREMATURE_RECOMMENDATION ("best choice"); no
    // other source is available, so the helper falls through to null.
    expect(summary).toBeNull();
  });

  it('skips a gate-rejected strengthen item and uses the next safe tier (bias finding)', () => {
    const summary = buildModelReceiptSummary({
      graph: null,
      strengthenItems: [{ detail: 'recommend option A' }], // rejected: recommendation
      analysisReady: {
        bias_findings: [{ explanation: 'the cost estimate assumes no overruns' }],
      },
    });
    expect(summary).toBe(
      'One assumption worth checking: the cost estimate assumes no overruns.',
    );
  });

  it('rejects an entity-ID-shaped fragment — no internal ID can pass the gate', () => {
    const summary = buildModelReceiptSummary({
      graph: null,
      strengthenItems: [{ detail: 'fac_cost_overrun may dominate the result' }],
    });
    // `fac_*` is an unambiguous internal-id slug → gate rejects 'internal_id';
    // no other candidate is available → null. IDs never reach the wire via
    // this helper, independent of the downstream scrub.
    expect(summary).toBeNull();
  });
});

describe('buildModelReceiptSummary — verdict / confidence / likelihood copy safety', () => {
  // PR-A review follow-up. The spec forbids "post-analysis verdict language"
  // and "confidence/likelihood CLAIMS from analysis". Those are CONTEXT bans,
  // not bare-word bans: this helper's source is pre-analysis draft coaching,
  // so an analysis-derived verdict / probability claim cannot be the source.
  // What the gate DOES hard-reject — regression-locked here on the receipt
  // path — is recommendation / winner / best-option phrasing. Bare dual-use
  // words ("likely", "confidence") inside a legitimate pre-analysis assumption
  // are intentionally PRESERVED, so the receipt insight stays consistent with
  // the chat narrative (both draw from the same gated assumption tier; banning
  // the bare words would over-reject and diverge the two surfaces).

  it('returns null for best-option verdict phrasing', () => {
    expect(
      buildModelReceiptSummary({
        graph: null,
        strengthenItems: [{ detail: 'option A is clearly the best choice' }],
      }),
    ).toBeNull();
  });

  it('returns null for explicit winner phrasing', () => {
    expect(
      buildModelReceiptSummary({
        graph: null,
        strengthenItems: [{ detail: 'option A is the clear winner here' }],
      }),
    ).toBeNull();
  });

  it('returns null for recommendation phrasing', () => {
    expect(
      buildModelReceiptSummary({
        graph: null,
        strengthenItems: [{ detail: 'I recommend option A over the alternatives' }],
      }),
    ).toBeNull();
  });

  it('preserves a legitimate pre-analysis likelihood assumption (not an analysis-derived claim)', () => {
    // "likely" flags an input assumption to check, not a computed probability.
    expect(
      buildModelReceiptSummary({
        graph: null,
        strengthenItems: [{ detail: 'the revenue forecast is likely optimistic' }],
      }),
    ).toBe('One assumption worth checking: the revenue forecast is likely optimistic.');
  });

  it('preserves a legitimate pre-analysis confidence assumption about an input', () => {
    expect(
      buildModelReceiptSummary({
        graph: null,
        strengthenItems: [{ detail: 'there is low confidence in the delivery estimate' }],
      }),
    ).toBe('One assumption worth checking: there is low confidence in the delivery estimate.');
  });
});
