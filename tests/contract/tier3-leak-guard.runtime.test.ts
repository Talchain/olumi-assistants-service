/**
 * Tier-3 leak guard — Part B runtime assertions (Brief 5 §5b) + the
 * Tier-2 cage decision matrix (Brief 5 §2).
 *
 * RED-FIRST PROOF (Mission 2): the m1_coaching suppression test below
 * was written BEFORE the cage change to sanitise-enrichment and run
 * against the pre-cage walker, where it FAILED — the sentinel coaching
 * prose survived `sanitiseEnrichment` byte-preserved (scrubbed for
 * hard-ban tokens only, then KEPT as an allow-listed prose leaf) and
 * would have reached the wire through the response-finaliser backstop
 * (`sanitiseEnrichmentBlocks`), which shares this exact walker. That is
 * the leak: `m1_coaching` is Tier-3 deny (Brief 4 §4) yet had a live
 * prose transport path. With the cage (fail-closed suppression of
 * `m1_coaching[].text` in the walker) the same test is GREEN.
 *
 * Doctrine is not enforcement: these tests bind the Brief 4 tiers to
 * runtime behaviour — the flag default, the empty allow-list, the
 * fail-closed decision order, and the prose block — so a regression is
 * a required-gate failure, not a doc violation.
 */

import { describe, expect, it } from 'vitest';

import {
  TIER2_CANDIDATE_FIELDS,
  TIER2_COACHING_ALLOWLIST,
  TIER3_LEAK_BLOCK_FIELDS,
  TIER3_TRANSPORT_BANNED_FIELDS,
  isClaimUsable,
  isTier3LeakBlocked,
} from '../../src/orchestrator-v5/compose/claim-safety-cage.js';
import {
  sanitiseEnrichment,
  SUPPRESSED_PROSE_FALLBACK,
} from '../../src/orchestrator-v5/compose/sanitise-enrichment.js';

/**
 * Deliberately scrub-proof sentinel: no hard-ban vocabulary, no node
 * ids, no numerics — nothing the prose scrubber would touch. If this
 * string survives the walker, the ONLY thing that kept it out of a
 * user-facing surface was luck, not the cage.
 */
const M1_SENTINEL =
  'TIER3-M1-SENTINEL unverified science coaching prose that must never reach a user-facing surface.';

describe('Tier-2 cage — locks are closed at ship', () => {
  // Lock 1 default-closed pin updated 2026-07-20 (O-7 wave 2): the
  // CEE_COACHING_TIER2_ENABLED config field was deleted (Appendix A4 —
  // zero production callers). Lock 1 is now the caller-supplied
  // `tier2Enabled` input, which `isClaimUsable` treats as CLOSED unless
  // explicitly true — pinned below via the omitted-input deny cases.
  it('lock 1 defaults CLOSED: isClaimUsable denies when tier2Enabled is false', () => {
    expect(isClaimUsable('factor_sensitivity', { tier2Enabled: false })).toBe(false);
  });

  it('TIER2_COACHING_ALLOWLIST ships EMPTY (lock 2) — populating it is a G2 decision, not a default', () => {
    expect(TIER2_COACHING_ALLOWLIST.size).toBe(0);
  });

  it('the candidate set and the deny set are the ratified Brief 4/5 members, frozen', () => {
    expect([...TIER2_CANDIDATE_FIELDS].sort()).toEqual(
      ['confidence_tier', 'factor_sensitivity', 'robustness'].sort(),
    );
    expect([...TIER3_LEAK_BLOCK_FIELDS].sort()).toEqual(
      ['edge_e_values', 'flip_thresholds', 'inference_warnings', 'm1_coaching'].sort(),
    );
    expect(Object.isFrozen(TIER2_CANDIDATE_FIELDS)).toBe(true);
    expect(Object.isFrozen(TIER3_LEAK_BLOCK_FIELDS)).toBe(true);
    expect(Object.isFrozen(TIER2_COACHING_ALLOWLIST)).toBe(true);
  });

  it('lock 2 is runtime-immutable, not just type-readonly: Set mutators THROW (Object.freeze alone does not stop .add on a Set)', () => {
    const mutable = TIER2_COACHING_ALLOWLIST as Set<string>;
    expect(() => mutable.add('factor_sensitivity')).toThrow(/read-only/);
    expect(() => mutable.delete('anything')).toThrow(/read-only/);
    expect(() => mutable.clear()).toThrow(/read-only/);
    expect(TIER2_COACHING_ALLOWLIST.size).toBe(0);
  });

  it('the transport-banned subset is exactly the Tier-3 ∩ not-keep-listed intersection (m1_coaching), frozen and a subset of the deny set', () => {
    expect([...TIER3_TRANSPORT_BANNED_FIELDS]).toEqual(['m1_coaching']);
    expect(Object.isFrozen(TIER3_TRANSPORT_BANNED_FIELDS)).toBe(true);
    for (const field of TIER3_TRANSPORT_BANNED_FIELDS) {
      expect(TIER3_LEAK_BLOCK_FIELDS).toContain(field);
    }
  });
});

describe('isClaimUsable — fail-closed at every fork (Brief 5 §2 decision order)', () => {
  const FULLY_OPEN = {
    tier2Enabled: true,
    companionStatusClaimSafe: true,
    freshness: 'fresh',
  } as const;

  it('Tier-3 fields are denied even with every other gate open', () => {
    for (const field of TIER3_LEAK_BLOCK_FIELDS) {
      expect(isClaimUsable(field, FULLY_OPEN), field).toBe(false);
      expect(isTier3LeakBlocked(field), field).toBe(true);
    }
  });

  it('Tier-2 candidates are denied with the flag OFF (lock 1)', () => {
    for (const field of TIER2_CANDIDATE_FIELDS) {
      expect(isClaimUsable(field, { ...FULLY_OPEN, tier2Enabled: false }), field).toBe(false);
    }
  });

  it('Tier-2 candidates are denied with the flag ON because the allow-list is empty (lock 2 — defence in depth)', () => {
    for (const field of TIER2_CANDIDATE_FIELDS) {
      expect(isClaimUsable(field, FULLY_OPEN), field).toBe(false);
    }
  });

  it('an unknown / unclassified field is denied (deny-by-default)', () => {
    expect(isClaimUsable('some_future_science_field', FULLY_OPEN)).toBe(false);
  });

  it('companion-status unverified (omitted) is denied — a caller cannot pass the gate without wiring the check', () => {
    expect(
      isClaimUsable('factor_sensitivity', { tier2Enabled: true, freshness: 'fresh' }),
    ).toBe(false);
  });

  it('non-fresh (stale / unknown / none / absent) freshness is denied', () => {
    for (const freshness of ['stale', 'unknown', 'none', null, undefined] as const) {
      expect(
        isClaimUsable('factor_sensitivity', {
          tier2Enabled: true,
          companionStatusClaimSafe: true,
          freshness: freshness ?? undefined,
        }),
        String(freshness),
      ).toBe(false);
    }
  });
});

describe('Tier-3 m1_coaching prose block — the red-first runtime proof', () => {
  it('m1_coaching[].text is fail-closed suppressed by the enrichment walker (pre-cage: the sentinel survived byte-preserved)', () => {
    const enrichment: Record<string, unknown> = {
      m1_coaching: [{ text: M1_SENTINEL, top_fragile_edge: { from: 'a', to: 'b' } }],
      summary: 'A perfectly ordinary summary.',
    };
    const result = sanitiseEnrichment(enrichment);
    const out = result.enrichment as {
      m1_coaching: Array<{ text?: string; top_fragile_edge?: unknown }>;
      summary?: string;
    };
    // Non-vacuous: the entry itself survives (array length / structural
    // siblings untouched — index alignment preserved for consumers).
    expect(out.m1_coaching).toHaveLength(1);
    expect(out.m1_coaching[0]!.top_fragile_edge).toEqual({ from: 'a', to: 'b' });
    // THE CAGE: the Tier-3 prose never survives — replaced by the
    // fail-shut suppression marker, mirroring the walker's existing
    // hard-ban posture, NOT deleted (length/shape stability).
    expect(out.m1_coaching[0]!.text).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(JSON.stringify(result.enrichment)).not.toContain('TIER3-M1-SENTINEL');
    // Control: non-Tier-3 prose leaves are untouched by the cage.
    expect(out.summary).toBe('A perfectly ordinary summary.');
  });

  it('the block holds for every entry of a multi-entry m1_coaching array', () => {
    const enrichment: Record<string, unknown> = {
      m1_coaching: [{ text: `${M1_SENTINEL} one` }, { text: `${M1_SENTINEL} two` }],
    };
    const result = sanitiseEnrichment(enrichment);
    const out = result.enrichment as { m1_coaching: Array<{ text?: string }> };
    expect(out.m1_coaching).toHaveLength(2);
    for (const entry of out.m1_coaching) {
      expect(entry.text).toBe(SUPPRESSED_PROSE_FALLBACK);
    }
    expect(JSON.stringify(result.enrichment)).not.toContain('TIER3-M1-SENTINEL');
  });
});

describe('Tier-3 wire backstop — transport-banned subtrees are DELETED at the finaliser seam (adversarial-review fix)', () => {
  it('UNKNOWN prose fields inside m1_coaching cannot ride the wire: the whole subtree is dropped in backstop mode', () => {
    // The .text-only suppression left a hole: a prose field the walker
    // does not know by name (e.g. `headline`) survived byte-preserved.
    // In wire-backstop mode the transport-banned subtree is deleted
    // outright — m1_coaching on the wire is already a contract anomaly
    // (it is not in the P0B keep-list).
    const enrichment: Record<string, unknown> = {
      m1_coaching: [
        { text: M1_SENTINEL, headline: `${M1_SENTINEL} via unknown field` },
      ],
      summary: 'A perfectly ordinary summary.',
    };
    const result = sanitiseEnrichment(enrichment, null, null, {
      dropTier3TransportBanned: true,
    });
    const out = result.enrichment as Record<string, unknown>;
    expect('m1_coaching' in out).toBe(false);
    expect(JSON.stringify(result.enrichment)).not.toContain('TIER3-M1-SENTINEL');
    // Non-Tier-3 content untouched.
    expect(out.summary).toBe('A perfectly ordinary summary.');
  });

  it('default (enricher/fact) mode keeps the subtree with only the known prose leaf suppressed — the m1 adapter still reads the structured enums', () => {
    const enrichment: Record<string, unknown> = {
      m1_coaching: [{ text: M1_SENTINEL, readiness: 'ready', headline_type: 'positive' }],
    };
    const result = sanitiseEnrichment(enrichment);
    const out = result.enrichment as {
      m1_coaching: Array<{ text?: string; readiness?: string; headline_type?: string }>;
    };
    expect(out.m1_coaching).toHaveLength(1);
    expect(out.m1_coaching[0]!.text).toBe(SUPPRESSED_PROSE_FALLBACK);
    // Adapter-v1 starvation guard: structured enums preserved.
    expect(out.m1_coaching[0]!.readiness).toBe('ready');
    expect(out.m1_coaching[0]!.headline_type).toBe('positive');
  });

  it('transport-KEPT Tier-3 fields (flip_thresholds etc.) are NOT deleted in backstop mode — claim-permission is the other axis', () => {
    const enrichment: Record<string, unknown> = {
      flip_thresholds: [{ factor_id: 'fac_x', flip_value: null }],
      edge_e_values: [],
      inference_warnings: [],
    };
    const result = sanitiseEnrichment(enrichment, null, null, {
      dropTier3TransportBanned: true,
    });
    const out = result.enrichment as Record<string, unknown>;
    expect(Array.isArray(out.flip_thresholds)).toBe(true);
    expect(out.edge_e_values).toEqual([]);
    expect(out.inference_warnings).toEqual([]);
  });
});
