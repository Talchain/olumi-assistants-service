/**
 * Tier 3 — decision_review enricher contract tests.
 *
 * Drives `buildInvokeInputForTests` with a populated synthetic
 * V2RunResponseEnvelope fixture and asserts every adapter-owned field is
 * present and correctly shaped for prompt v11. Edge-case fixtures cover
 * the brief's "no fabrication" rules and the value-delta direction
 * derivation. A separate test confirms `_meta` never leaks into the
 * assembled user message — diagnostics live on the input object only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInvokeInputForTests } from '../decision-review-enricher.js';
import { buildDecisionReviewUserMessage } from '../../../cee/decision-review/invoke.js';

// ============================================================================
// Populated synthetic fixture — mirrors a real staging run_analysis enrichment
// ============================================================================

function makePopulatedEnrichment(): Record<string, unknown> {
  return {
    graph: {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Q3 revenue target', data: {} },
        { id: 'opt_partner', kind: 'option', label: 'Engage Offshore Partner', data: {} },
        { id: 'opt_hire', kind: 'option', label: 'Hire Two Senior Engineers Locally', data: {} },
        // Factors — units carried on data.unit (per brief), values via observed_state
        { id: 'fac_budget', kind: 'factor', label: 'Hiring Budget',
          data: { unit: 'GBP' }, observed_state: { value: 250000 } },
        { id: 'fac_ramp', kind: 'factor', label: 'Ramp-up Time',
          data: { unit: 'weeks' }, observed_state: { value: 8 } },
        { id: 'fac_seniority', kind: 'factor', label: 'Engineering Seniority',
          // unit absent — exercises the unit-fallback path
          data: {}, observed_state: { value: 0.6 } },
      ],
      edges: [],
    },
    results: [
      {
        option_id: 'opt_partner',
        option_label: 'Engage Offshore Partner',
        win_probability: 0.48,
        // Flat outcome shape — exercises the flat-vs-nested fallback in
        // projectOptionAsWinner and option_comparison normalisation.
        outcome_mean: 1_240_000,
        outcome_p10: 980_000,
        outcome_p90: 1_510_000,
        factor_sensitivity: [
          {
            factor_id: 'fac_budget',
            factor_label: 'Hiring Budget',
            elasticity: 0.42,
            confidence: 0.78,
            current_value: 250_000,
            flip_threshold: 320_000,
          },
          {
            factor_id: 'fac_ramp',
            factor_label: 'Ramp-up Time',
            elasticity: -0.31,
            confidence: 0.65,
            current_value: 8,
            flip_threshold: 5, // decrease required → direction='decrease'
          },
        ],
      },
      {
        option_id: 'opt_hire',
        option_label: 'Hire Two Senior Engineers Locally',
        win_probability: 0.25,
        // Nested outcome shape — exercises r.outcome.mean fallback.
        outcome: { mean: 1_080_000, p10: 850_000, p90: 1_320_000 },
        factor_sensitivity: [
          {
            factor_id: 'fac_seniority',
            factor_label: 'Engineering Seniority',
            elasticity: 0.55,
            confidence: 0.72,
            current_value: 0.6,
            flip_threshold: 0.85,
          },
          // Duplicate factor_id (also seen on opt_partner) — should be deduped.
          {
            factor_id: 'fac_budget',
            factor_label: 'Hiring Budget (DUP)',
            elasticity: 0.40,
            confidence: 0.70,
            current_value: 250_000,
            flip_threshold: 350_000,
          },
        ],
      },
    ],
    factor_sensitivity: [
      { factor_id: 'fac_budget', factor_label: 'Hiring Budget', elasticity: 0.42, confidence: 0.78 },
      { factor_id: 'fac_ramp', factor_label: 'Ramp-up Time', elasticity: -0.31, confidence: 0.65 },
      { factor_id: 'fac_seniority', factor_label: 'Engineering Seniority', elasticity: 0.55, confidence: 0.72 },
    ],
    robustness: {
      level: 'moderate',
      recommendation_stability: 0.74,
      overall_confidence: 0.66,
      fragile_edges: [
        {
          edge_id: 'e_budget_to_partner',
          from_node_id: 'fac_budget',
          to_node_id: 'opt_partner',
          switch_probability: 0.22,
          marginal_switch_probability: 0.18,
          alternative_winner_id: 'opt_hire',
          alternative_winner_label: 'Hire Two Senior Engineers Locally',
        },
      ],
    },
  };
}

const BRIEF = "Should we engage an offshore partner or hire locally to deliver Q3?";

describe('decision-review-enricher — Tier 3 contract', () => {
  it('contract: every adapter-owned field is present and correctly shaped (prompt v11)', () => {
    const input = buildInvokeInputForTests(BRIEF, makePopulatedEnrichment(), 'opt_partner');
    expect(input).not.toBeNull();
    if (!input) throw new Error('unreachable');

    // brief / brief_hash present
    expect(input.brief).toBe(BRIEF);
    expect(input.brief_hash).toMatch(/^[0-9a-f]{64}$/);

    // flip_threshold_data: factor_id + factor_label + current_value + flip_value
    // + direction + (optional) unit. Deduplication keeps the first occurrence.
    expect(input.flip_threshold_data).toBeDefined();
    expect(input.flip_threshold_data!.length).toBe(3); // budget, ramp, seniority — duplicate budget deduped
    const ftdById = Object.fromEntries(
      input.flip_threshold_data!.map((r) => [r.factor_id as string, r]),
    );
    expect(ftdById.fac_budget).toMatchObject({
      factor_id: 'fac_budget',
      factor_label: 'Hiring Budget',
      current_value: 250_000,
      flip_value: 320_000,
      direction: 'increase',
      unit: 'GBP',
    });
    expect(ftdById.fac_ramp).toMatchObject({
      factor_id: 'fac_ramp',
      factor_label: 'Ramp-up Time',
      current_value: 8,
      flip_value: 5,
      direction: 'decrease', // flip < current
      unit: 'weeks',
    });
    expect(ftdById.fac_seniority).toMatchObject({
      factor_id: 'fac_seniority',
      factor_label: 'Engineering Seniority',
      current_value: 0.6,
      flip_value: 0.85,
      direction: 'increase',
    });
    // Unit absent on graph node and on factor entry → unit field omitted.
    expect(ftdById.fac_seniority.unit).toBeUndefined();

    // factor_sensitivity: factor_id, factor_label, elasticity, confidence — typed numbers (or null)
    const fs = input.isl_results.factor_sensitivity as Array<Record<string, unknown>>;
    expect(fs).toHaveLength(3);
    for (const e of fs) {
      expect(typeof e.factor_id).toBe('string');
      expect(typeof e.factor_label).toBe('string');
      expect(e.elasticity === null || typeof e.elasticity === 'number').toBe(true);
      expect(e.confidence === null || typeof e.confidence === 'number').toBe(true);
    }

    // fragile_edges: from_label / to_label resolved via graph node label map
    const fe = input.isl_results.fragile_edges as Array<Record<string, unknown>>;
    expect(fe).toHaveLength(1);
    expect(fe[0]).toMatchObject({
      edge_id: 'e_budget_to_partner',
      from_label: 'Hiring Budget',
      to_label: 'Engage Offshore Partner',
      switch_probability: 0.22,
      marginal_switch_probability: 0.18,
      alternative_winner_id: 'opt_hire',
      alternative_winner_label: 'Hire Two Senior Engineers Locally',
    });

    // option_comparison: outcome.{mean,p10,p90} normalised from both flat and nested input shapes
    const oc = input.isl_results.option_comparison as Array<Record<string, unknown>>;
    expect(oc).toHaveLength(2);
    const partner = oc.find((r) => r.option_id === 'opt_partner') as Record<string, unknown>;
    expect((partner.outcome as Record<string, unknown>).mean).toBe(1_240_000);
    expect((partner.outcome as Record<string, unknown>).p10).toBe(980_000);
    expect((partner.outcome as Record<string, unknown>).p90).toBe(1_510_000);
    const hire = oc.find((r) => r.option_id === 'opt_hire') as Record<string, unknown>;
    expect((hire.outcome as Record<string, unknown>).mean).toBe(1_080_000); // from nested r.outcome.mean
    expect((hire.outcome as Record<string, unknown>).p10).toBe(850_000);
    expect((hire.outcome as Record<string, unknown>).p90).toBe(1_320_000);

    // winner.outcome_mean: read from flat field (opt_partner uses outcome_mean)
    expect(input.winner.id).toBe('opt_partner');
    expect(input.winner.outcome_mean).toBe(1_240_000);

    // robustness signals
    const rob = input.isl_results.robustness as Record<string, unknown>;
    expect(rob.recommendation_stability).toBe(0.74);
    expect(rob.overall_confidence).toBe(0.66);
    expect(rob.level).toBe('moderate');
  });

  it('no-semantic-invention: deterministic_coaching keeps safe defaults when m1_coaching is absent', () => {
    // Adapter v1 (2026-05-21): when enrichment.m1_coaching is absent, the
    // adapter still emits v11-compatible safe defaults. When m1_coaching IS
    // present (live staging behaviour), the populated branch is covered by
    // decision-review-enricher.adapter-v1.test.ts. makePopulatedEnrichment()
    // has no m1_coaching field, so this test exercises the fallback path
    // and asserts no fabrication.
    const input = buildInvokeInputForTests(BRIEF, makePopulatedEnrichment(), 'opt_partner')!;
    const dc = input.deterministic_coaching;
    expect(dc.headline_type).toBe('neutral');
    expect(dc.readiness).toBe('unknown');
    expect(dc.model_critiques).toEqual([]);
    expect(dc.evidence_gaps).toEqual([]);
  });

  it('_meta observability: input_shape_version, counts, margin, robustness_level', () => {
    const input = buildInvokeInputForTests(BRIEF, makePopulatedEnrichment(), 'opt_partner')!;
    const meta = input._meta;
    expect(meta).toBeDefined();
    if (!meta) throw new Error('unreachable');
    expect(meta.input_shape_version).toBe('v5-normalised');
    expect(meta.flip_threshold_count).toBe(3);
    expect(meta.factor_sensitivity_count).toBe(3);
    expect(meta.fragile_edge_count).toBe(1);
    expect(meta.model_critique_count).toBe(0);
    // FIX C (1.41 fix round, C3): MAX_MODEL_CRITIQUES's doc comment claims
    // "tracked in _meta for observability" — these two counts must actually
    // be present on _meta, not just computed and dropped on the floor.
    expect(meta.model_critiques_dropped_count).toBe(0);
    expect(meta.model_critiques_capped_count).toBe(0);
    expect(meta.has_deterministic_coaching).toBe(false);
    // margin = 0.48 - 0.25 = 0.23
    expect(meta.margin).toBeCloseTo(0.23, 6);
    expect(meta.robustness_level).toBe('moderate');
  });

  it('_meta is adapter-only: NEVER appears in the assembled user message', () => {
    const input = buildInvokeInputForTests(BRIEF, makePopulatedEnrichment(), 'opt_partner')!;
    const margin = input.runner_up !== null
      ? input.winner.win_probability - input.runner_up.win_probability
      : null;
    const userMessage = buildDecisionReviewUserMessage(input, margin);

    // _meta keys must not leak into the prompt — guards against accidental
    // future serialisation that would expose adapter diagnostics to the LLM.
    expect(userMessage).not.toContain('_meta');
    expect(userMessage).not.toContain('input_shape_version');
    expect(userMessage).not.toContain('has_deterministic_coaching');
    expect(userMessage).not.toContain('factor_sensitivity_count');
    expect(userMessage).not.toContain('flip_threshold_count');
    expect(userMessage).not.toContain('fragile_edge_count');
    expect(userMessage).not.toContain('model_critique_count');
    expect(userMessage).not.toContain('evidence_gaps_dropped_count');
    expect(userMessage).not.toContain('model_critiques_dropped_count');
    expect(userMessage).not.toContain('model_critiques_capped_count');
    // Sanity: the user message *is* still populated — proves we didn't accidentally
    // strip everything in the assertion above.
    expect(userMessage).toContain('Engage Offshore Partner');
    expect(userMessage).toContain('<FLIP_THRESHOLD_DATA>');
  });
});

// ============================================================================
// Edge-case fixtures
// ============================================================================

describe('decision-review-enricher — edge cases', () => {
  it('null flip_value is filtered out of flip_threshold_data', () => {
    const enrichment = makePopulatedEnrichment();
    (enrichment.results as Array<Record<string, unknown>>)[0].factor_sensitivity = [
      // First entry has no flip_threshold (null) — must be filtered out.
      { factor_id: 'fac_budget', factor_label: 'Hiring Budget', current_value: 250_000, elasticity: 0.4, confidence: 0.7 },
      // Second entry has a real flip_threshold — must survive.
      { factor_id: 'fac_ramp', factor_label: 'Ramp-up Time', current_value: 8, flip_threshold: 5, elasticity: -0.3 },
    ];
    (enrichment.results as Array<Record<string, unknown>>)[1].factor_sensitivity = [];

    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner')!;
    expect(input.flip_threshold_data?.length).toBe(1);
    expect((input.flip_threshold_data?.[0] as Record<string, unknown>).factor_id).toBe('fac_ramp');
  });

  it('missing factor_label falls back to factor_id', () => {
    const enrichment = makePopulatedEnrichment();
    // Strip graph entirely so labelMap is empty, and remove inline labels too.
    enrichment.graph = { nodes: [] };
    (enrichment.factor_sensitivity as Array<Record<string, unknown>>) = [
      { factor_id: 'fac_anonymous', elasticity: 0.5, confidence: 0.8 },
    ];

    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner')!;
    const fs = input.isl_results.factor_sensitivity as Array<Record<string, unknown>>;
    expect(fs[0].factor_id).toBe('fac_anonymous');
    expect(fs[0].factor_label).toBe('fac_anonymous');
  });

  it('missing graph-node unit yields unit field omitted (not invented)', () => {
    const input = buildInvokeInputForTests(BRIEF, makePopulatedEnrichment(), 'opt_partner')!;
    const seniority = input.flip_threshold_data!.find(
      (r) => (r as Record<string, unknown>).factor_id === 'fac_seniority',
    ) as Record<string, unknown>;
    // fac_seniority has no data.unit on its graph node and no factor.unit on
    // its factor_sensitivity entry — unit must be omitted, never invented.
    expect(seniority.unit).toBeUndefined();
  });

  it('empty fragile_edges array yields [] with no error', () => {
    const enrichment = makePopulatedEnrichment();
    (enrichment.robustness as Record<string, unknown>).fragile_edges = [];
    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner')!;
    expect(input.isl_results.fragile_edges).toEqual([]);
    expect(input._meta?.fragile_edge_count).toBe(0);
  });

  it('flat outcome_mean and nested outcome.mean both normalise correctly', () => {
    // Already covered by the contract test above (opt_partner flat,
    // opt_hire nested) — this is the explicit assertion form.
    const input = buildInvokeInputForTests(BRIEF, makePopulatedEnrichment(), 'opt_partner')!;
    const oc = input.isl_results.option_comparison as Array<Record<string, unknown>>;
    const partner = oc.find((r) => r.option_id === 'opt_partner') as Record<string, unknown>;
    const hire = oc.find((r) => r.option_id === 'opt_hire') as Record<string, unknown>;
    expect((partner.outcome as Record<string, unknown>).mean).toBe(1_240_000);
    expect((hire.outcome as Record<string, unknown>).mean).toBe(1_080_000);
  });

  it('missing confidence on factor_sensitivity yields confidence:null (not fabricated)', () => {
    const enrichment = makePopulatedEnrichment();
    (enrichment.factor_sensitivity as Array<Record<string, unknown>>) = [
      { factor_id: 'fac_x', factor_label: 'X', elasticity: 0.5 }, // no confidence
    ];
    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner')!;
    const fs = input.isl_results.factor_sensitivity as Array<Record<string, unknown>>;
    expect(fs[0].confidence).toBeNull();
  });

  it('unrecognised graph shape: enricher still returns a valid input with empty maps', () => {
    const enrichment = makePopulatedEnrichment();
    enrichment.graph = 'not-an-object'; // pathological shape

    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner');
    expect(input).not.toBeNull();
    if (!input) throw new Error('unreachable');
    // Without a graph, factor labels fall back to factor_id and units go null.
    const ftd = input.flip_threshold_data as Array<Record<string, unknown>>;
    for (const entry of ftd) {
      expect(entry.unit === undefined || entry.unit === null).toBe(true);
    }
  });

  it('direction is value-delta-driven, NOT elasticity-sign-driven', () => {
    // Negatively-elastic factor with flip < current → direction must be 'decrease'.
    // Positively-elastic factor with flip > current → 'increase'.
    // Negatively-elastic factor with flip > current → still 'increase' (the
    // input change required is upward, regardless of model response sign).
    const enrichment = makePopulatedEnrichment();
    (enrichment.results as Array<Record<string, unknown>>)[0].factor_sensitivity = [
      { factor_id: 'fac_neg_dec', factor_label: 'A', current_value: 40, flip_threshold: 30, elasticity: -0.5 },
      { factor_id: 'fac_pos_inc', factor_label: 'B', current_value: 40, flip_threshold: 50, elasticity: 0.5 },
      { factor_id: 'fac_neg_inc', factor_label: 'C', current_value: 40, flip_threshold: 60, elasticity: -0.5 },
    ];
    (enrichment.results as Array<Record<string, unknown>>)[1].factor_sensitivity = [];

    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner')!;
    const byId = Object.fromEntries(
      input.flip_threshold_data!.map((r) => [(r as Record<string, unknown>).factor_id as string, r]),
    );
    expect((byId.fac_neg_dec as Record<string, unknown>).direction).toBe('decrease');
    expect((byId.fac_pos_inc as Record<string, unknown>).direction).toBe('increase');
    expect((byId.fac_neg_inc as Record<string, unknown>).direction).toBe('increase');
  });

  it('runner_up: null margin survives when only one option has results', () => {
    const enrichment = makePopulatedEnrichment();
    enrichment.results = [(enrichment.results as Array<Record<string, unknown>>)[0]];
    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner')!;
    expect(input.runner_up).toBeNull();
    expect(input._meta?.margin).toBeNull();
  });
});

// ============================================================================
// isl_results.option_comparison — envelope-shape coverage (ROADMAP 1.78)
//
// The CURRENT live V2 envelope populates `enrichment.option_comparison` and
// leaves the legacy `enrichment.results` ABSENT (proven by the REAL staging
// capture below). readIslResults must therefore build the prompt's
// isl_results.option_comparison from BOTH sources — current shape primary,
// legacy `results` fallback — mirroring readResultsArraySources' tolerance
// WITHOUT pooling the two (pooling would double-count the same option).
// ============================================================================

describe('decision-review-enricher — isl_results.option_comparison envelope shapes (1.78)', () => {
  // REAL staging capture: blocks[0].enrichment carries the full persisted
  // PLoT envelope with `results` ABSENT and `option_comparison` populated.
  // Provenance: tests/fixtures/cross-service/*.metadata.json. Never hand-edit.
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = join(
    here, '..', '..', '..', '..',
    'tests', 'fixtures', 'cross-service', 'v5-turn.run-analysis.staging.json',
  );

  function loadStagingEnrichment(): Record<string, unknown> {
    const turn = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
      blocks: Array<Record<string, unknown>>;
    };
    const block = turn.blocks.find((b) => b.type === 'analysis_result');
    if (!block) throw new Error('fixture: no analysis_result block');
    const enrichment = block.enrichment as Record<string, unknown>;
    if (!enrichment) throw new Error('fixture: no enrichment on analysis_result block');
    return enrichment;
  }

  it('REAL staging capture: option_comparison is read from the CURRENT envelope shape (results absent)', () => {
    const enrichment = loadStagingEnrichment();

    // Pin the fixture facts this test's proof rests on: the live envelope
    // has NO legacy `results` array and 4 option_comparison entries.
    expect(enrichment.results).toBeUndefined();
    const fxOc = enrichment.option_comparison as Array<Record<string, unknown>>;
    expect(fxOc).toHaveLength(4);

    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_hire_local');
    expect(input).not.toBeNull();
    if (!input) throw new Error('unreachable');

    // THE 1.78 BUG: this was [] on the live path — the decision_review
    // prompt coached without per-option win_probability / outcome numbers.
    const oc = input.isl_results.option_comparison as Array<Record<string, unknown>>;
    expect(oc).toHaveLength(4);

    // Every fixture option survives with the normalised prompt shape,
    // values copied verbatim from the capture (no fabrication, no reshaping
    // beyond flat→nested outcome normalisation).
    for (const fx of fxOc) {
      const got = oc.find((r) => r.option_id === fx.option_id);
      expect(got).toBeDefined();
      if (!got) throw new Error('unreachable');
      expect(got.option_label).toBe(fx.option_label);
      expect(got.win_probability).toBe(fx.win_probability);
      const fxOutcome = fx.outcome as Record<string, unknown>;
      expect(got.outcome).toEqual({
        mean: fxOutcome.mean,
        p10: fxOutcome.p10,
        p90: fxOutcome.p90,
      });
      // Output shape stays byte-identical to the pre-fix contract: exactly
      // option_id / option_label / win_probability / outcome{mean,p10,p90}.
      expect(Object.keys(got).sort()).toEqual(
        ['option_id', 'option_label', 'outcome', 'win_probability'],
      );
    }
  });

  it('legacy-only envelope (results present, option_comparison absent) still populates — fallback preserved', () => {
    // makePopulatedEnrichment() is exactly the legacy shape: results[]
    // present, no top-level option_comparison.
    const enrichment = makePopulatedEnrichment();
    expect(enrichment.option_comparison).toBeUndefined();

    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner')!;
    const oc = input.isl_results.option_comparison as Array<Record<string, unknown>>;
    expect(oc).toHaveLength(2);
    expect(oc.map((r) => r.option_id).sort()).toEqual(['opt_hire', 'opt_partner']);
  });

  it('both sources present: prefers the current shape, never double-counts', () => {
    const enrichment = makePopulatedEnrichment();
    // Same two options also present as a CURRENT option_comparison, with
    // deliberately different numbers so provenance is observable.
    enrichment.option_comparison = [
      {
        option_id: 'opt_partner',
        option_label: 'Engage Offshore Partner',
        win_probability: 0.51,
        outcome: { mean: 1_300_000, p10: 990_000, p90: 1_600_000 },
      },
      {
        option_id: 'opt_hire',
        option_label: 'Hire Two Senior Engineers Locally',
        win_probability: 0.22,
        outcome: { mean: 1_050_000, p10: 840_000, p90: 1_300_000 },
      },
    ];

    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner')!;
    const oc = input.isl_results.option_comparison as Array<Record<string, unknown>>;
    // 2 entries, not 4 — the legacy `results` copies must NOT be pooled in.
    expect(oc).toHaveLength(2);
    const partner = oc.find((r) => r.option_id === 'opt_partner') as Record<string, unknown>;
    // Values come from the CURRENT source (0.51 / 1.3M), not legacy (0.48 / 1.24M).
    expect(partner.win_probability).toBe(0.51);
    expect((partner.outcome as Record<string, unknown>).mean).toBe(1_300_000);
  });

  it('current shape present but EMPTY: falls back to legacy results', () => {
    const enrichment = makePopulatedEnrichment();
    enrichment.option_comparison = [];
    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner')!;
    const oc = input.isl_results.option_comparison as Array<Record<string, unknown>>;
    expect(oc).toHaveLength(2);
  });

  it('both sources absent: option_comparison stays [] (no fabrication)', () => {
    const enrichment = makePopulatedEnrichment();
    delete enrichment.results;
    // Keep a winner source so buildInvokeInput still returns an input:
    // decision_brief.options is the third published shape.
    enrichment.decision_brief = {
      options: [
        { option_id: 'opt_partner', label: 'Engage Offshore Partner', win_probability: 0.48, rank: 1 },
        { option_id: 'opt_hire', label: 'Hire Two Senior Engineers Locally', win_probability: 0.25, rank: 2 },
      ],
    };
    const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner')!;
    expect(input.isl_results.option_comparison).toEqual([]);
  });
});
