/**
 * Wave-3 σ (ROADMAP 1.203) — the claim-safety cage wired into Phase-3 egress.
 *
 * POSITIVE CONTROL (mandatory, trap-13): an absence claim ("σ omits fabricated
 * fields") is vacuous unless the wired path can SEE a PRESENCE. These prove
 * `composeCagedField` DISCRIMINATES on the live-wired path:
 *   - DENIAL: a Tier-3 field, a non-allow-listed field, an unactivated flag, an
 *     unverified companion, and a stale verdict each OMIT (return null) + fire a
 *     reason-tagged `v5.claim_cage.field_evaluated` deny event.
 *   - PASS: an allow-listed + activated + companion-safe + fresh field SURFACES
 *     (returns the value) + fires an allow event — proving the gate is not
 *     denying everything vacuously (an allow-list typo would fail HERE).
 *
 * MUTATION-CHECK (revert → RED, trap-11): making `composeCagedField` return the
 * value unconditionally (drop the `classifyClaimUsable` consult) turns the denial
 * assertions RED — proving the CAGE, not the schema, did the denying.
 *
 * BYTE-INERT wiring: `buildLensSuggestionCoachingBlock` consults the cage for the
 * lens's grounding field but emits the SAME prose-only block regardless of the
 * verdict (no value is surfaced today) — asserted by the block being unchanged
 * while the cage telemetry fires.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { setTestSink } from '../../../utils/telemetry.js';
import { composeCagedField, buildLensSuggestionCoachingBlock, type BlockBuildCtx } from '../phase3-blocks.js';

interface SinkEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}
let sink: SinkEvent[] = [];
beforeEach(() => {
  sink = [];
  setTestSink((event, data) => sink.push({ event, data }));
});
afterEach(() => setTestSink(null));

const FULLY_OPEN = { tier2Enabled: true, companionStatusClaimSafe: true, freshness: 'fresh' } as const;
function cageEvents() {
  return sink.filter((e) => e.event === 'v5.claim_cage.field_evaluated');
}

describe('composeCagedField — the field-level cage chokepoint (σ)', () => {
  it('PASS: an allow-listed + activated + companion-safe + fresh field SURFACES + fires an allow event', () => {
    const value = { influence_share: 0.62 };
    const out = composeCagedField('factor_sensitivity', value, FULLY_OPEN);
    // The positive control: the gate returns the value (does NOT deny vacuously).
    expect(out).toBe(value);
    expect(cageEvents()).toHaveLength(1);
    expect(cageEvents()[0]!.data).toMatchObject({ field: 'factor_sensitivity', decision: 'allowed' });
  });

  it('DENY (Tier-3): a leak-block field is OMITTED with reason tier3_denied, even fully open', () => {
    const out = composeCagedField('flip_thresholds', 'X', FULLY_OPEN);
    expect(out).toBeNull();
    expect(cageEvents()[0]!.data).toMatchObject({
      field: 'flip_thresholds',
      decision: 'denied',
      reason: 'tier3_denied',
    });
  });

  it('DENY (not allow-listed): an unclassified field is OMITTED with reason not_allowlisted', () => {
    const out = composeCagedField('option_comparison', 'X', FULLY_OPEN);
    expect(out).toBeNull();
    expect(cageEvents()[0]!.data).toMatchObject({ decision: 'denied', reason: 'not_allowlisted' });
  });

  it('DENY (lock 1 off): an allow-listed field is OMITTED with reason tier2_not_activated', () => {
    const out = composeCagedField('factor_sensitivity', 'X', { ...FULLY_OPEN, tier2Enabled: false });
    expect(out).toBeNull();
    expect(cageEvents()[0]!.data).toMatchObject({ decision: 'denied', reason: 'tier2_not_activated' });
  });

  it('DENY (companion unverified): an allow-listed field is OMITTED with reason companion_unverified', () => {
    const out = composeCagedField('factor_sensitivity', 'X', { tier2Enabled: true, freshness: 'fresh' });
    expect(out).toBeNull();
    expect(cageEvents()[0]!.data).toMatchObject({ decision: 'denied', reason: 'companion_unverified' });
  });

  it('DENY (not fresh): an allow-listed field is OMITTED with reason not_fresh', () => {
    const out = composeCagedField('factor_sensitivity', 'X', {
      tier2Enabled: true,
      companionStatusClaimSafe: true,
      freshness: 'stale',
    });
    expect(out).toBeNull();
    expect(cageEvents()[0]!.data).toMatchObject({ decision: 'denied', reason: 'not_fresh' });
  });
});

// ── Byte-inert live wiring through the lens builder ──────────────────────────
const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';
// CTX omits `freshness` — after F8 (2026-07-24) that means the cage sees an
// ABSENT verdict and DENIES (not_fresh), no longer defaulted to 'fresh'.
const CTX: BlockBuildCtx = { created_at: '2026-07-23T15:00:00.000Z', graph_hash_at_generation: GRAPH_HASH };
// Explicit fresh verdict — the positive control for the ALLOW path on the wired
// lens-builder path (an allow-list typo or an over-eager cage would fail HERE).
const CTX_FRESH: BlockBuildCtx = { ...CTX, freshness: 'fresh' };

// Dominant-driver fact → sensitivity lens → grounds in factor_sensitivity (ALLOW-LISTED).
function dominantDriverFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: 'scen-test', leading_option_id: 'opt_a', summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        confidence_tier: 'strong',
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.15, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_c', influence_score: 0.05, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

// Moderate win-prob fact → pre-mortem lens → grounds in option_comparison (NOT allow-listed).
function winProbModerateFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: 'scen-test', leading_option_id: 'opt_a', summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        confidence_tier: 'fair',
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.55 }, { win_probability: 0.45 }],
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

describe('buildLensSuggestionCoachingBlock — cage consult is LIVE + byte-inert (σ)', () => {
  it('FRESH verdict: the SAME prose-only strengthen block (byte-inert) AND an allow cage event for the allow-listed grounding field', () => {
    // Positive control on the wired path — an explicit fresh verdict.
    const block = buildLensSuggestionCoachingBlock(dominantDriverFact(), CTX_FRESH, null);
    // Byte-inert: the block is unchanged by the cage consult (prose-only, no value).
    expect(block).not.toBeNull();
    expect(block!.coaching_kind).toBe('strengthen');
    expect(block!.source).toBe('deterministic_signal');
    expect(block!.action_intent).toBeUndefined();
    expect(block!.priority_rank).toBe(15);
    // The cage RAN live on the grounding field (factor_sensitivity → allowed).
    const evt = cageEvents();
    expect(evt).toHaveLength(1);
    expect(evt[0]!.data).toMatchObject({ field: 'factor_sensitivity', decision: 'allowed' });
  });

  it('F8 — an OMITTED freshness verdict DENIES (not_fresh), not defaulted to fresh', () => {
    // CTX omits `freshness`. Before F8 the live caller supplied `?? 'fresh'`, so
    // this allow-listed + companion-safe grounding field would have passed the
    // cage. With F8 it must DENY with not_fresh — deny-by-default at the caller.
    const block = buildLensSuggestionCoachingBlock(dominantDriverFact(), CTX, null);
    expect(block).not.toBeNull(); // still byte-inert — the block always emits
    const evt = cageEvents();
    expect(evt).toHaveLength(1);
    expect(evt[0]!.data).toMatchObject({ field: 'factor_sensitivity', decision: 'denied', reason: 'not_fresh' });
  });

  it('STAGING-OBSERVABLE DENIAL: a pre-mortem lens grounded in option_comparison fires a not_allowlisted deny event, block still emits', () => {
    const block = buildLensSuggestionCoachingBlock(winProbModerateFact(), CTX, null);
    // The block still emits (byte-inert — the denial omits a value that was never
    // surfaced, never the block).
    expect(block).not.toBeNull();
    expect(block!.coaching_kind).toBe('strengthen');
    // The organic, live positive-control denial observable on staging.
    const evt = cageEvents();
    expect(evt).toHaveLength(1);
    expect(evt[0]!.data).toMatchObject({
      field: 'option_comparison',
      decision: 'denied',
      reason: 'not_allowlisted',
    });
  });
});
