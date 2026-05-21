/**
 * Adapter v1 tests — 2026-05-21
 *
 * Cover the m1_coaching → deterministic_coaching mapping and the richer
 * allowlisted factor_sensitivity projection added by the adapter v1 fix.
 * See Docs/v5/captures/decision_review_envelope_audit_2026-05-21.md §7-§8
 * for the root-cause motivation.
 *
 * Fixtures are compact and inline — derived from the captured staging shape
 * but trimmed to the minimum required to exercise each branch. We do NOT
 * import the 136 KB capture JSON.
 */

import { describe, expect, it } from 'vitest';

import { buildInvokeInputForTests } from '../decision-review-enricher.js';

const BRIEF = 'A brief about pricing strategy and resource allocation.';

function baseEnrichment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    results: [
      { option_id: 'opt-1', option_label: 'Option A', win_probability: 0.7 },
      { option_id: 'opt-2', option_label: 'Option B', win_probability: 0.3 },
    ],
    factor_sensitivity: [],
    robustness: { level: 'moderate', fragile_edges: [] },
    graph: { nodes: [], edges: [] },
    ...overrides,
  };
}

describe('adapter v1: m1_coaching → deterministic_coaching mapping', () => {
  it('1. populated m1_coaching: maps readiness/headline_type/3 evidence_gaps; has_deterministic_coaching=true; dropped=0', () => {
    const enrichment = baseEnrichment({
      m1_coaching: {
        readiness: 'ready',
        headline_type: 'moderate_winner',
        evidence_gaps: [
          {
            factor_id: 'fac_hiring_cost',
            factor_label: 'Incremental Staffing Cost',
            voi_score: 0.3467,
            confidence: 0.4319,
            suggestion: 'Gather data on Incremental Staffing Cost',
            confidence_display: '43%',
            confidence_defaulted: false,
            influence: 0.6103,
            influence_display: '61%',
            evpi_percentage_points: 13.9,
            evpi_method: 'heuristic',
          },
          {
            factor_id: 'fac_delivery',
            factor_label: 'Delivery Capacity',
            voi_score: 0.21,
            confidence: 0.55,
          },
          {
            factor_id: 'fac_market',
            factor_label: 'Market Demand',
            voi_score: 0.12,
            confidence: 0.68,
          },
        ],
        model_critiques: [],
      },
    });
    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt-1')!;
    const dc = input.deterministic_coaching;
    expect(dc.readiness).toBe('ready');
    expect(dc.headline_type).toBe('moderate_winner');
    const gaps = dc.evidence_gaps as ReadonlyArray<Record<string, unknown>>;
    expect(gaps).toHaveLength(3);
    // Required fields renamed: voi_score → voi
    expect(gaps[0]!.voi).toBe(0.3467);
    expect(gaps[0]!.factor_id).toBe('fac_hiring_cost');
    expect(gaps[0]!.factor_label).toBe('Incremental Staffing Cost');
    expect(gaps[0]!.confidence).toBe(0.4319);
    // Allowlisted optional passthrough
    expect(gaps[0]!.suggestion).toBe('Gather data on Incremental Staffing Cost');
    expect(gaps[0]!.confidence_display).toBe('43%');
    expect(gaps[0]!.confidence_defaulted).toBe(false);
    expect(gaps[0]!.influence).toBe(0.6103);
    expect(gaps[0]!.influence_display).toBe('61%');
    expect(gaps[0]!.evpi_percentage_points).toBe(13.9);
    expect(gaps[0]!.evpi_method).toBe('heuristic');
    // Second gap has only required fields — optional passthrough omitted
    expect(gaps[1]!.voi).toBe(0.21);
    expect(gaps[1]!.suggestion).toBeUndefined();
    expect(gaps[1]!.evpi_percentage_points).toBeUndefined();

    const meta = input._meta!;
    expect(meta.has_deterministic_coaching).toBe(true);
    expect(meta.evidence_gaps_dropped_count).toBe(0);
    expect(meta.model_critique_count).toBe(0);
  });

  it('2. absent m1_coaching: safe defaults preserved; has_deterministic_coaching=false', () => {
    const input = buildInvokeInputForTests(BRIEF, baseEnrichment(), 'opt-1')!;
    const dc = input.deterministic_coaching;
    expect(dc.readiness).toBe('unknown');
    expect(dc.headline_type).toBe('neutral');
    expect(dc.evidence_gaps).toEqual([]);
    expect(dc.model_critiques).toEqual([]);

    const meta = input._meta!;
    expect(meta.has_deterministic_coaching).toBe(false);
    expect(meta.evidence_gaps_dropped_count).toBe(0);
    expect(meta.model_critique_count).toBe(0);
  });

  it('3. partial m1_coaching: evidence_gaps present, no readiness/headline_type → still has_deterministic_coaching=true', () => {
    const enrichment = baseEnrichment({
      m1_coaching: {
        evidence_gaps: [
          { factor_id: 'fac_x', factor_label: 'X', voi_score: 0.5, confidence: 0.8 },
          { factor_id: 'fac_y', factor_label: 'Y', voi_score: 0.4, confidence: 0.7 },
        ],
      },
    });
    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt-1')!;
    const dc = input.deterministic_coaching;
    expect((dc.evidence_gaps as unknown[]).length).toBe(2);
    expect(dc.readiness).toBe('unknown'); // fallback
    expect(dc.headline_type).toBe('neutral'); // fallback

    const meta = input._meta!;
    expect(meta.has_deterministic_coaching).toBe(true); // because evidence_gaps > 0
  });

  it('4. empty/default-like m1_coaching: no real signals → has_deterministic_coaching=false', () => {
    const enrichment = baseEnrichment({
      m1_coaching: {
        readiness: 'unknown',
        headline_type: 'neutral',
        evidence_gaps: [],
        model_critiques: [],
      },
    });
    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt-1')!;
    const meta = input._meta!;
    expect(meta.has_deterministic_coaching).toBe(false);
    expect(meta.evidence_gaps_dropped_count).toBe(0);
  });

  it('5. richer factor_sensitivity: allowlisted extras forwarded; unknown fields dropped', () => {
    const enrichment = baseEnrichment({
      factor_sensitivity: [
        {
          factor_id: 'fac_a',
          factor_label: 'Factor A',
          elasticity: 1.2,
          confidence: 0.4,
          attribution_stability: 'negligible',
          rank_flip_rate: 0.05,
          evpi_percentage_points: 1.8,
          direction: 'positive',
          sensitivity_score: 0.229,
          confidence_components: { structural_certainty: 0.5, sampling_stability: 0 },
          confidence_source: 'plot_unified_from_isl_bootstrap',
          confidence_provenance: { formula_version: 'plot_unified_v3', is_provisional: true },
          bogus_field: 'should_not_appear',
          another_unknown: 42,
        },
      ],
    });
    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt-1')!;
    const fs = input.isl_results.factor_sensitivity as ReadonlyArray<Record<string, unknown>>;
    expect(fs).toHaveLength(1);
    const f = fs[0]!;
    // Core fields
    expect(f.factor_id).toBe('fac_a');
    expect(f.factor_label).toBe('Factor A');
    expect(f.elasticity).toBe(1.2);
    expect(f.confidence).toBe(0.4);
    // Allowlisted additive fields
    expect(f.attribution_stability).toBe('negligible');
    expect(f.rank_flip_rate).toBe(0.05);
    expect(f.evpi_percentage_points).toBe(1.8);
    expect(f.direction).toBe('positive');
    expect(f.sensitivity_score).toBe(0.229);
    expect(f.confidence_components).toEqual({ structural_certainty: 0.5, sampling_stability: 0 });
    expect(f.confidence_source).toBe('plot_unified_from_isl_bootstrap');
    expect(f.confidence_provenance).toEqual({
      formula_version: 'plot_unified_v3',
      is_provisional: true,
    });
    // Unknown/un-allowlisted fields are NOT forwarded
    expect(f.bogus_field).toBeUndefined();
    expect(f.another_unknown).toBeUndefined();
  });

  it('6. malformed evidence_gaps: object-shaped but missing required fields are dropped and counted; user-facing output unaffected', () => {
    // Partial-malformed sub-case: valid + 2 malformed
    const partialEnrichment = baseEnrichment({
      m1_coaching: {
        evidence_gaps: [
          // Valid
          { factor_id: 'fac_v', factor_label: 'Valid', voi_score: 0.5, confidence: 0.8 },
          // Missing factor_label
          { factor_id: 'fac_a', voi_score: 0.4, confidence: 0.7 },
          // Missing voi_score
          { factor_id: 'fac_b', factor_label: 'B', confidence: 0.6 },
          // Non-object: silently skipped, NOT counted as malformed
          'not-an-object',
          null,
        ],
      },
    });
    const input = buildInvokeInputForTests(BRIEF, partialEnrichment, 'opt-1')!;
    const dc = input.deterministic_coaching;
    const gaps = dc.evidence_gaps as ReadonlyArray<Record<string, unknown>>;
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.factor_id).toBe('fac_v');

    const meta = input._meta!;
    expect(meta.evidence_gaps_dropped_count).toBe(2);
    // At least one valid gap was mapped, so has_real_data should be true.
    expect(meta.has_deterministic_coaching).toBe(true);

    // All-malformed sub-case: every entry fails required-field validation.
    // Per amended brief, this counts as "no evidence_gaps supplied" and
    // has_deterministic_coaching may only flip true via other signals.
    const allBadEnrichment = baseEnrichment({
      m1_coaching: {
        evidence_gaps: [
          { factor_id: 'a' }, // missing label + voi + confidence
          { factor_label: 'B', voi_score: 0.3 }, // missing factor_id + confidence
          { factor_id: 'c', factor_label: 'C', voi_score: 0.2 }, // missing confidence
        ],
        // No real readiness/headline_type/model_critiques either
      },
    });
    const allBadInput = buildInvokeInputForTests(BRIEF, allBadEnrichment, 'opt-1')!;
    const allBadDc = allBadInput.deterministic_coaching;
    expect(allBadDc.evidence_gaps).toEqual([]);
    const allBadMeta = allBadInput._meta!;
    expect(allBadMeta.evidence_gaps_dropped_count).toBe(3);
    expect(allBadMeta.has_deterministic_coaching).toBe(false);
  });

  it('7. whitespace and wrong-type readiness/headline_type fall back to defaults; padded canonical values are trimmed', () => {
    // Padded canonical values trim cleanly to canonical form.
    const paddedEnrichment = baseEnrichment({
      m1_coaching: {
        readiness: '   ready   ',
        headline_type: '\t\nmoderate_winner\t\n',
        evidence_gaps: [],
        model_critiques: [],
      },
    });
    const paddedInput = buildInvokeInputForTests(BRIEF, paddedEnrichment, 'opt-1')!;
    const paddedDc = paddedInput.deterministic_coaching;
    expect(paddedDc.readiness).toBe('ready');
    expect(paddedDc.headline_type).toBe('moderate_winner');
    expect(paddedInput._meta!.has_deterministic_coaching).toBe(true);

    // Whitespace-only / empty strings fall back to defaults.
    const whitespaceEnrichment = baseEnrichment({
      m1_coaching: {
        readiness: '   ',
        headline_type: '',
        evidence_gaps: [],
        model_critiques: [],
      },
    });
    const wsInput = buildInvokeInputForTests(BRIEF, whitespaceEnrichment, 'opt-1')!;
    expect(wsInput.deterministic_coaching.readiness).toBe('unknown');
    expect(wsInput.deterministic_coaching.headline_type).toBe('neutral');
    expect(wsInput._meta!.has_deterministic_coaching).toBe(false);

    // Non-string types fall back to defaults (defensive against PLoT shape drift).
    const wrongTypeEnrichment = baseEnrichment({
      m1_coaching: {
        readiness: 42,
        headline_type: null,
        evidence_gaps: [],
        model_critiques: [],
      },
    });
    const wtInput = buildInvokeInputForTests(BRIEF, wrongTypeEnrichment, 'opt-1')!;
    expect(wtInput.deterministic_coaching.readiness).toBe('unknown');
    expect(wtInput.deterministic_coaching.headline_type).toBe('neutral');
    expect(wtInput._meta!.has_deterministic_coaching).toBe(false);
  });

  it('8. unknown non-empty readiness/headline_type values are preserved verbatim and flip has_deterministic_coaching=true', () => {
    // Documents the deliberate upstream-contract-trust policy: any non-empty
    // trimmed string (including values outside the today-canonical set) is
    // forwarded as-is, on the rationale that PLoT owns the enum vocabulary
    // and may extend it. The adapter does NOT enum-allowlist. If a future
    // runtime issue surfaces from unknown enums reaching v11, the fix lives
    // in the prompt (v13 enum-handling), not in adapter strictness.
    const unknownEnrichment = baseEnrichment({
      m1_coaching: {
        readiness: 'ready-with-gaps', // not in today's canonical set
        headline_type: 'edge_case_winner', // also non-canonical
        evidence_gaps: [],
        model_critiques: [],
      },
    });
    const input = buildInvokeInputForTests(BRIEF, unknownEnrichment, 'opt-1')!;
    const dc = input.deterministic_coaching;
    // Preserved verbatim — NOT replaced with "unknown"/"neutral".
    expect(dc.readiness).toBe('ready-with-gaps');
    expect(dc.headline_type).toBe('edge_case_winner');
    // Non-default values count as real upstream data.
    expect(input._meta!.has_deterministic_coaching).toBe(true);
  });
});
