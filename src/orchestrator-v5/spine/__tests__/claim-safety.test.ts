/**
 * Tier 0 S1 — proof: provenance + claim-safety classification.
 *
 * Proves: the DRAFT REGISTRY table (40 keys); disputed → provisional;
 * causal-effect-like → not claim-safe by default (floor); confidence /
 * robustness / VOI-EVPI / calibration / identifiability / sensitivity →
 * conservative pending Neil/Jinghui; comparison → conservative (not claim_safe)
 * with the mandated reason; and the wording boundary (sensitivity/driver fields
 * are NOT causal-effect claims).
 *
 * The REGISTRY is provisional doctrine pending Neil/Jinghui ratification — the
 * EXPECTED table below is an independent restatement so test 5 catches drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  classifyEnrichment,
  classifyEnrichmentByField,
  ENRICHMENT_REGISTRY,
  type ClaimSafetyStatus,
  type Provenance,
  type ScientificCategory,
} from '../claim-safety.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_BYTES = readFileSync(join(HERE, 'fixtures/enrichment.sanitised.json'), 'utf8');
function loadFixture(): Record<string, unknown> {
  return JSON.parse(FIXTURE_BYTES) as Record<string, unknown>;
}

interface Expected {
  category: ScientificCategory;
  provenance: Provenance;
  defaultClaimSafety: ClaimSafetyStatus;
}

// Independent restatement of the DRAFT REGISTRY (pending Neil/Jinghui ratification).
const EXPECTED: Record<string, Expected> = {
  option_comparison: { category: 'comparison', provenance: 'plot_engine', defaultClaimSafety: 'conservative' },
  conditional_winners: { category: 'comparison', provenance: 'plot_engine', defaultClaimSafety: 'conservative' },
  decision_brief: { category: 'comparison', provenance: 'cee_meta', defaultClaimSafety: 'conservative' },
  factor_sensitivity: { category: 'sensitivity', provenance: 'isl', defaultClaimSafety: 'conservative' },
  edge_sensitivity: { category: 'sensitivity', provenance: 'plot_engine', defaultClaimSafety: 'conservative' },
  factor_stability: { category: 'robustness', provenance: 'isl', defaultClaimSafety: 'conservative' },
  stability_thresholds: { category: 'robustness', provenance: 'cee_meta', defaultClaimSafety: 'conservative' },
  robustness: { category: 'robustness', provenance: 'isl', defaultClaimSafety: 'conservative' },
  robustness_synthesis: { category: 'robustness', provenance: 'cee_meta', defaultClaimSafety: 'conservative' },
  confidence_tier: { category: 'confidence', provenance: 'isl', defaultClaimSafety: 'conservative' },
  decision_quality: { category: 'confidence', provenance: 'cee_meta', defaultClaimSafety: 'conservative' },
  identifiability: { category: 'identifiability', provenance: 'isl', defaultClaimSafety: 'conservative' },
  inference_warnings: { category: 'calibration', provenance: 'isl', defaultClaimSafety: 'conservative' },
  flip_thresholds: { category: 'causal_effect', provenance: 'isl', defaultClaimSafety: 'not_claim_safe' },
  edge_e_values: { category: 'causal_effect', provenance: 'isl', defaultClaimSafety: 'not_claim_safe' },
  m1_coaching: { category: 'other', provenance: 'coaching_m1', defaultClaimSafety: 'conservative' },
  m1_review: { category: 'other', provenance: 'coaching_m1', defaultClaimSafety: 'conservative' },
  improvement_guidance: { category: 'other', provenance: 'coaching_m1', defaultClaimSafety: 'conservative' },
  critiques: { category: 'other', provenance: 'isl', defaultClaimSafety: 'conservative' },
  review_cards: { category: 'other', provenance: 'cee_meta', defaultClaimSafety: 'conservative' },
  insights: { category: 'other', provenance: 'cee_meta', defaultClaimSafety: 'conservative' },
  rationale: { category: 'other', provenance: 'cee_meta', defaultClaimSafety: 'conservative' },
  analysis_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  option_comparison_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  robustness_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  drivers_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  isl_analysis_status: { category: 'metadata', provenance: 'isl', defaultClaimSafety: 'unknown' },
  review_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  review_skip_reason: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  cee_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  request_id: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  response_hash: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  processing_time_ms: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  request_schema_version: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  endpoint_version: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  preflight_version: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  downstream_calls: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  fact_objects: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  _meta: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
  meta: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown' },
};

describe('classifyEnrichment — DRAFT REGISTRY over all 40 live keys', () => {
  it('matches the expected (category, provenance, defaultClaimSafety) for every key', () => {
    const byField = classifyEnrichmentByField(loadFixture());
    const keys = Object.keys(byField).sort();
    expect(keys).toHaveLength(40);
    expect(keys).toEqual(Object.keys(EXPECTED).sort());
    for (const [field, exp] of Object.entries(EXPECTED)) {
      const c = byField[field];
      expect(c, `missing classification for ${field}`).toBeDefined();
      expect(c.category, `${field}.category`).toBe(exp.category);
      expect(c.provenance, `${field}.provenance`).toBe(exp.provenance);
      expect(c.defaultClaimSafety, `${field}.defaultClaimSafety`).toBe(exp.defaultClaimSafety);
    }
  });
});

describe('causal-effect-like fields are not claim-safe by default', () => {
  it('flip_thresholds and edge_e_values default not_claim_safe; disputes cannot raise them', () => {
    const base = classifyEnrichmentByField(loadFixture());
    for (const f of ['flip_thresholds', 'edge_e_values']) {
      expect(base[f].category).toBe('causal_effect');
      expect(base[f].defaultClaimSafety).toBe('not_claim_safe');
      expect(base[f].claimSafety).toBe('not_claim_safe');
    }
    // a dispute naming flip_thresholds must NOT lift it off the floor
    const injected = classifyEnrichmentByField({ ...loadFixture(), inference_warnings: [{ field: 'flip_thresholds' }] });
    expect(injected.flip_thresholds.disputed).toBe(true);
    expect(injected.flip_thresholds.claimSafety).toBe('not_claim_safe');
  });
});

describe('conservative pending Neil/Jinghui', () => {
  it('confidence / robustness / VOI-EVPI / calibration / identifiability / sensitivity default conservative', () => {
    const base = classifyEnrichmentByField(loadFixture());
    for (const f of ['factor_sensitivity', 'factor_stability', 'robustness', 'confidence_tier', 'identifiability', 'inference_warnings']) {
      expect(base[f].defaultClaimSafety, f).toBe('conservative');
      expect(base[f].pendingRuling, f).toBe('neil_jinghui');
    }
  });
});

describe('comparison fields default conservative (amendment 2)', () => {
  it('option_comparison / conditional_winners / decision_brief → conservative with the mandated reason', () => {
    const base = classifyEnrichmentByField(loadFixture());
    for (const f of ['option_comparison', 'conditional_winners', 'decision_brief']) {
      expect(base[f].defaultClaimSafety, f).toBe('conservative');
      expect(base[f].pendingRuling, f).toBe('neil_jinghui');
      expect(base[f].reason, f).toContain('descriptive model output, not real-world truth; non-causal; non-empirical');
    }
  });

  it('no field defaults to claim_safe', () => {
    expect(Object.values(ENRICHMENT_REGISTRY).some((e) => e.defaultClaimSafety === 'claim_safe')).toBe(false);
    expect(classifyEnrichment(loadFixture()).some((c) => c.defaultClaimSafety === 'claim_safe')).toBe(false);
  });
});

describe('wording boundary — sensitivity/driver fields are NOT causal-effect claims', () => {
  it('sensitivity/driver fields classify as sensitivity/robustness, never causal_effect, never not_claim_safe by default', () => {
    const base = classifyEnrichmentByField(loadFixture());
    for (const f of ['factor_sensitivity', 'edge_sensitivity', 'factor_stability']) {
      expect(['sensitivity', 'robustness'], f).toContain(base[f].category);
      expect(base[f].category, f).not.toBe('causal_effect');
      expect(base[f].defaultClaimSafety, f).not.toBe('not_claim_safe');
    }
    // ONLY the explicit causal keys carry the causal_effect category
    const causal = classifyEnrichment(loadFixture())
      .filter((c) => c.category === 'causal_effect')
      .map((c) => c.field)
      .sort();
    expect(causal).toEqual(['edge_e_values', 'flip_thresholds']);
  });
});

describe('disputed fields marked provisional (re-derived on read, never persisted)', () => {
  it('downgrades affected fields to provisional via injected signals; causal floor unaffected', () => {
    const f = loadFixture();
    const injected = classifyEnrichmentByField({
      ...f,
      stability_thresholds: { ...(f.stability_thresholds as object), provisional: true },
      robustness: { ...(f.robustness as object), near_tie: { is_tie: true } },
      robustness_status: 'degraded',
      inference_warnings: [{ field: 'factor_sensitivity' }],
    });
    expect(injected.factor_stability.claimSafety).toBe('provisional');
    expect(injected.factor_stability.disputeSignals).toContain('thresholds_provisional');
    expect(injected.robustness.claimSafety).toBe('provisional');
    expect(injected.robustness.disputeSignals).toContain('status_not_computed');
    expect(injected.option_comparison.claimSafety).toBe('provisional');
    expect(injected.option_comparison.disputeSignals).toContain('near_tie');
    expect(injected.factor_sensitivity.claimSafety).toBe('provisional');
    expect(injected.factor_sensitivity.disputeSignals).toContain('named_in_inference_warnings');
    // causal floor unaffected by disputes
    expect(injected.flip_thresholds.claimSafety).toBe('not_claim_safe');
  });

  it('derives disputes from REAL fixture signals (review skipped, provisional thresholds)', () => {
    const base = classifyEnrichmentByField(loadFixture());
    expect(base.review_cards.disputeSignals).toContain('review_skipped');
    expect(base.review_cards.claimSafety).toBe('provisional');
    expect(base.factor_stability.disputeSignals).toContain('thresholds_provisional');
    expect(base.factor_stability.claimSafety).toBe('provisional');
  });
});

describe('fail-closed: an ABSENT status companion disputes its guarded fields', () => {
  // Minimal fixtures isolate the status_not_computed mapping: no
  // stability_thresholds (so thresholds_provisional cannot fire), no near_tie,
  // no review_status — the ONLY possible dispute source is the absent companion.
  // This proves each companion→field mapping individually (the full fixture has
  // stability_thresholds.provisional=true, which would mask the status signal on
  // factor_stability / robustness_synthesis).
  it('absent option_comparison_status → option_comparison disputed solely via status_not_computed', () => {
    const idx = classifyEnrichmentByField({ option_comparison: [] });
    expect(idx.option_comparison.disputeSignals).toEqual(['status_not_computed']);
    expect(idx.option_comparison.claimSafety).toBe('provisional');
  });

  it('absent robustness_status → robustness & robustness_synthesis disputed solely via status_not_computed', () => {
    const idx = classifyEnrichmentByField({ robustness: {}, robustness_synthesis: 'x' });
    for (const f of ['robustness', 'robustness_synthesis']) {
      expect(idx[f].disputeSignals, f).toEqual(['status_not_computed']);
      expect(idx[f].claimSafety, f).toBe('provisional');
    }
  });

  it('absent drivers_status → factor_sensitivity & factor_stability disputed solely via status_not_computed', () => {
    const idx = classifyEnrichmentByField({ factor_sensitivity: [], factor_stability: [] });
    for (const f of ['factor_sensitivity', 'factor_stability']) {
      expect(idx[f].disputeSignals, f).toEqual(['status_not_computed']);
      expect(idx[f].claimSafety, f).toBe('provisional');
    }
  });

  it('also fires on the full live fixture when a companion is deleted', () => {
    const f = loadFixture();
    delete f.option_comparison_status; // near_tie.is_tie is false in the fixture, so this isolates the status signal
    const idx = classifyEnrichmentByField(f);
    expect(idx.option_comparison.disputeSignals).toContain('status_not_computed');
    expect(idx.option_comparison.claimSafety).toBe('provisional');
  });

  it('incomplete data is never MORE claim-safe than data with an explicit failure', () => {
    const missing = classifyEnrichmentByField({ option_comparison: [] });
    const failed = classifyEnrichmentByField({ option_comparison: [], option_comparison_status: 'failed' });
    expect(missing.option_comparison.claimSafety).toBe('provisional');
    expect(failed.option_comparison.claimSafety).toBe('provisional');
    expect(missing.option_comparison.claimSafety).toBe(failed.option_comparison.claimSafety);
  });
});
