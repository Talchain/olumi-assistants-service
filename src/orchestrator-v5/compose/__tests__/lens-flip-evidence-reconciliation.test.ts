/**
 * ROADMAP 2.278 — the lens selector must not claim flippability on a turn whose
 * own flip evidence attests that NOTHING flips in range.
 *
 * THE WITNESSED DEFECT (staging, 2026-08-01 — `witness-2267-onscreen-flip.md`
 * and `witness-2267-raw/`): across four consecutive analysis turns, all 19
 * `flip_thresholds` rows came back `structurally_invariant` / `no_flip_in_range:
 * true` — ISL's closed-form proof that no factor can move the winner at all.
 * On those same turns `factor_sensitivity[].flip_risk_category` read `isolated`
 * for 11 of 19 factors, so rule 1a fired and the user was shown
 *
 *     "Strengthen your model: pressure-test the key driver"
 *     "…a small change to it alone could flip the outcome."
 *
 * about a factor the engine had just proved cannot flip anything.
 *
 * The mechanism is the one #555 fixed on the UI side (`selectFlipRisk`) and the
 * one `explanation-fallback.ts` already fixed for the deterministic fallbacks:
 * copy keyed off ROBUSTNESS MARGINALS, with the FLIP EVIDENCE one key away on
 * the same enrichment object never consulted.
 *
 * These tests are driven by the WITNESSED BYTES, not by hand-built shapes.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { BODY_BY_RATIONALE, TITLE_BY_LENS, selectLens } from '../lens-selector.js';

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../../../../tests/fixtures/cross-service/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}

const NO_FLIP = loadFixture('witness-2267-attested-no-flip.json');
const REAL_FLIP = loadFixture('witness-2265-runA.flip-threshold-winner.json');
const NO_FLIP_RUNS = Object.entries(NO_FLIP.runs as Record<string, Record<string, unknown>>);

/** Build a run_analysis fact from a witnessed enrichment slice. */
function factFrom(enrichment: Record<string, unknown>): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-witness',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      graph_hash_at_run: 'gh_a1b2c3d4e5f60001',
      computed_at: '2026-08-01T18:20:00.000Z',
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

/**
 * Vocabulary that ASSERTS the result could flip. Any of these in a lens body or
 * title, on a turn where the producer attested no flip, is a false claim to the
 * user — which is the whole subject of this file.
 */
const FLIPPABILITY_CLAIM_REGEX =
  /\b(?:could|can|would|might|may)\s+(?:\w+\s+){0,3}?(?:flip|tip)\b|\bflip\s+the\s+(?:outcome|result|decision)\b|\btip\s+which\s+option\s+leads\b|\bbefore\s+the\s+leading\s+option\s+changes\b|\bwhat\s+would\s+flip\b/i;

describe('FLIPPABILITY_CLAIM_REGEX — positive control (the matcher can SEE the defect)', () => {
  // Trap 13: an absence assertion is vacuous unless it can first prove a presence.
  it.each([
    ['the shipped ISOLATED body', BODY_BY_RATIONALE.FLIP_RISK_ISOLATED],
    ['the shipped CORRELATED body', BODY_BY_RATIONALE.FLIP_RISK_CORRELATED],
    ['the shipped DOMINANT_DRIVER body', BODY_BY_RATIONALE.DOMINANT_DRIVER],
  ])('matches %s', (_label, copy) => {
    expect(copy).toMatch(FLIPPABILITY_CLAIM_REGEX);
  });

  it('does NOT match neutral prose', () => {
    expect('One factor shapes this result more than the others.').not.toMatch(
      FLIPPABILITY_CLAIM_REGEX,
    );
  });
});

describe('the witnessed turns still trigger the sensitivity lens (no suppression)', () => {
  // The correction must not silently DELETE the lens. The factor really is the
  // dominant driver; only the flippability claim about it was false.
  it.each(NO_FLIP_RUNS)('run %s still selects a lens', (_name, run) => {
    const sel = selectLens(
      factFrom({
        factor_sensitivity: run.factor_sensitivity,
        flip_thresholds: run.flip_thresholds,
        confidence_tier: 'fair',
      }),
    );
    expect(sel).not.toBeNull();
    expect(sel!.lens).toBe('sensitivity_flip_risk');
  });
});

describe('RED-first — no flippability claim on an attested-no-flip turn', () => {
  it.each(NO_FLIP_RUNS)('run %s — BODY makes no flippability claim', (_name, run) => {
    const sel = selectLens(
      factFrom({
        factor_sensitivity: run.factor_sensitivity,
        flip_thresholds: run.flip_thresholds,
        confidence_tier: 'fair',
      }),
    );
    expect(sel!.body).not.toMatch(FLIPPABILITY_CLAIM_REGEX);
  });

  it.each(NO_FLIP_RUNS)('run %s — TITLE makes no flippability claim', (_name, run) => {
    const sel = selectLens(
      factFrom({
        factor_sensitivity: run.factor_sensitivity,
        flip_thresholds: run.flip_thresholds,
        confidence_tier: 'fair',
      }),
    );
    expect(sel!.title).not.toMatch(FLIPPABILITY_CLAIM_REGEX);
  });

  it.each(NO_FLIP_RUNS)('run %s — rationale is a no-flip code', (_name, run) => {
    const sel = selectLens(
      factFrom({
        factor_sensitivity: run.factor_sensitivity,
        flip_thresholds: run.flip_thresholds,
        confidence_tier: 'fair',
      }),
    );
    expect(sel!.rationaleCode).toMatch(/_NO_FLIP$/);
  });

  it('the correction is driven by the FLIP EVIDENCE, not by the marginals', () => {
    // Identical factor_sensitivity; only flip_thresholds differs. This is the
    // mutation witness for the gate itself: if the selector stops reading
    // flip_thresholds, these two become equal and the test goes RED.
    const [, run] = NO_FLIP_RUNS[0]!;
    const withEvidence = selectLens(
      factFrom({ factor_sensitivity: run.factor_sensitivity, flip_thresholds: run.flip_thresholds }),
    );
    const withoutEvidence = selectLens(factFrom({ factor_sensitivity: run.factor_sensitivity }));

    expect(withoutEvidence!.rationaleCode).toBe('FLIP_RISK_ISOLATED');
    expect(withEvidence!.rationaleCode).not.toBe(withoutEvidence!.rationaleCode);
    expect(withoutEvidence!.body).toMatch(FLIPPABILITY_CLAIM_REGEX);
    expect(withEvidence!.body).not.toMatch(FLIPPABILITY_CLAIM_REGEX);
  });
});

describe('POSITIVE CONTROL — a run with a REAL flip keeps its honest flip copy', () => {
  // If the gate over-fired, this is what would catch it: witness-2265 runA is
  // the first real measured factor flip in the programme's history.
  const realFlipFact = factFrom({
    factor_sensitivity: [
      { factor_id: 'fac_leeds_activation', influence_score: 0.5, influence_rank: 1, flip_risk_category: 'isolated' },
      { factor_id: 'fac_other', influence_score: 0.2, influence_rank: 2 },
    ],
    flip_thresholds: REAL_FLIP.flip_thresholds,
  });

  it('keeps the FLIP_RISK_ISOLATED rationale', () => {
    expect(selectLens(realFlipFact)!.rationaleCode).toBe('FLIP_RISK_ISOLATED');
  });

  it('keeps the flip-language body — a TRUE claim is never suppressed', () => {
    expect(selectLens(realFlipFact)!.body).toMatch(FLIPPABILITY_CLAIM_REGEX);
    expect(selectLens(realFlipFact)!.body).toBe(BODY_BY_RATIONALE.FLIP_RISK_ISOLATED);
  });

  it('keeps the shipped title', () => {
    expect(selectLens(realFlipFact)!.title).toBe(TITLE_BY_LENS.sensitivity_flip_risk);
  });
});

describe('BACKWARD COMPATIBILITY — absent flip evidence changes nothing', () => {
  const marginals = {
    factor_sensitivity: [
      { factor_id: 'fac_a', influence_score: 0.5, influence_rank: 1, flip_risk_category: 'isolated' },
      { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2 },
    ],
  };

  it('no flip_thresholds key at all → unchanged FLIP_RISK_ISOLATED', () => {
    const sel = selectLens(factFrom(marginals))!;
    expect(sel.rationaleCode).toBe('FLIP_RISK_ISOLATED');
    expect(sel.body).toBe(BODY_BY_RATIONALE.FLIP_RISK_ISOLATED);
  });

  it('empty flip_thresholds → unchanged (absent ≠ attested)', () => {
    const sel = selectLens(factFrom({ ...marginals, flip_thresholds: [] }))!;
    expect(sel.rationaleCode).toBe('FLIP_RISK_ISOLATED');
  });

  it('unattested null rows → unchanged (a failure to find is not an attestation)', () => {
    const sel = selectLens(
      factFrom({
        ...marginals,
        flip_thresholds: [{ factor_id: 'fac_a', factor_label: 'A', flip_value: null }],
      }),
    )!;
    expect(sel.rationaleCode).toBe('FLIP_RISK_ISOLATED');
  });
});

describe('the CORRELATED and DOMINANT_DRIVER doors are gated too (complete family)', () => {
  const attested = [
    { factor_id: 'fac_a', factor_label: 'A', flip_value: null, flip_reason: 'structurally_invariant' },
    { factor_id: 'fac_b', factor_label: 'B', flip_value: null, flip_reason: 'structurally_invariant' },
  ];

  it('CORRELATED → no flippability claim', () => {
    const sel = selectLens(
      factFrom({
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.5, influence_rank: 1, flip_risk_category: 'correlated' },
          { factor_id: 'fac_b', influence_score: 0.4, influence_rank: 2 },
        ],
        flip_thresholds: attested,
      }),
    )!;
    expect(sel.rationaleCode).toBe('SENSITIVITY_CORRELATED_NO_FLIP');
    expect(sel.body).not.toMatch(FLIPPABILITY_CLAIM_REGEX);
  });

  it('DOMINANT_DRIVER → no flippability claim (its copy presupposes the leader can change)', () => {
    const sel = selectLens(
      factFrom({
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.9, influence_rank: 1 },
          { factor_id: 'fac_b', influence_score: 0.05, influence_rank: 2 },
        ],
        flip_thresholds: attested,
      }),
    )!;
    expect(sel.rationaleCode).toBe('DOMINANT_DRIVER_NO_FLIP');
    expect(sel.body).not.toMatch(FLIPPABILITY_CLAIM_REGEX);
  });
});
