/**
 * END-TO-END: a REAL producer envelope → the join → the rendered sentence.
 *
 * ⭐ WHY THIS SUITE EXISTS. The cold review's F5: `factor_investigation` had
 * three production references and ZERO test references, and both existing
 * suites test one END of the chain on hand-built inputs — the classifier on a
 * hand-built envelope, `formatDriver` on drivers with the verdict pre-set.
 * Its finding, verified: **delete the entire join block and both suites still
 * pass.** Nothing took a real enrichment envelope and produced a rendered
 * string, so the join itself — the part that can silently fail closed — was
 * unguarded.
 *
 * ⚠ THE INPUT IS NOT FROM THE AUTHOR'S HEAD (trap #22). It is
 * `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`, a real
 * staging capture already in this repo, read at its own bytes. The expectations
 * are derived from the producer's semantics, not from what would be convenient.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { deriveFactorInvestigationFromEnrichment } from '../factor-investigation-licence.js';
import { projectTopDrivers } from '../context-pack-assembler.js';
import { formatAnalysisForContext } from '../../format/format-analysis-for-context.js';
import type { DriverSummary } from '../../../orchestrator/context/analysis-compact.js';

const STAGING_CAPTURE = 'tests/fixtures/cross-service/v5-turn.run-analysis.staging.json';

function realEnrichment(): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(STAGING_CAPTURE, 'utf8')) as {
    blocks: Array<{ enrichment?: Record<string, unknown> }>;
  };
  const enrichment = raw.blocks[0]?.enrichment;
  // PRECONDITION PINNED IN-TEST: if the fixture ever stops carrying what this
  // suite reads, fail LOUD here rather than asserting over an empty array.
  if (enrichment === undefined) throw new Error('fixture drift: no blocks[0].enrichment');
  const fs = enrichment.factor_sensitivity;
  if (!Array.isArray(fs) || fs.length === 0) {
    throw new Error('fixture drift: enrichment.factor_sensitivity is empty');
  }
  return enrichment;
}

/** Drivers as the compact layer builds them, ids intact for the structural join. */
function driversFrom(enrichment: Record<string, unknown>): DriverSummary[] {
  const rows = enrichment.factor_sensitivity as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    factor_id: String(r.factor_id ?? r.node_id),
    factor_label: String(r.factor_label ?? r.label ?? r.factor_id),
    sensitivity: Math.abs(Number(r.influence_score ?? 0)),
    direction: 'positive' as const,
  }));
}

describe('factor investigation — real envelope through the join to the rendered string', () => {
  it('renders an investigation sentence for a real zero-VoI factor, joined on factor_id', () => {
    const enrichment = realEnrichment();
    const signals = deriveFactorInvestigationFromEnrichment(enrichment);

    // PRECONDITION: the derivation saw the real rows.
    expect(signals.length).toBeGreaterThan(0);

    const drivers = projectTopDrivers(driversFrom(enrichment), undefined, 10, signals);
    const out = formatAnalysisForContext({
      status: 'ok',
      leading_option: { label: 'A', probability: 0.58 },
      runner_up: { label: 'B', probability: 0.42 },
      margin_pp: 16,
      robustness_band: 'moderate',
      top_drivers: drivers,
      fragile_edges: [],
    });

    const rendered = (out?.top_drivers ?? []) as Array<Record<string, unknown>>;
    expect(rendered.length).toBeGreaterThan(0);

    // ── The load-bearing assertion. `fac_offshore` ("Offshore Engagement"):
    //    value_of_information: 0, flip_risk_category: 'negligible',
    //    rank_flip_rate: 0.15 (PRESENT and non-zero) ⇒ no_information_value.
    //    Bound by exact label, and the id join is what carried it here.
    const offshore = rendered.find((d) => d.label === 'Offshore Engagement');
    expect(offshore).toBeDefined();
    expect(String(offshore?.investigation ?? '')).toContain(
      'resolving this has no measured value',
    );
    // It must NOT claim the ranking was stable — rank_flip_rate is 0.15.
    expect(String(offshore?.investigation ?? '')).not.toContain(
      'resampling did not move its ranking',
    );
  });

  it('CONTRAST CONTROL: a real factor the options control gets its OWN sentence, not the generic one', () => {
    // In this capture `fac_eng_capacity` carries value_of_information: 0.045 at
    // the enrichment layer, so it is `informative` there — the contrast that
    // proves the sweep above is discriminating between rows rather than
    // stamping every driver with one phrase.
    const enrichment = realEnrichment();
    const signals = deriveFactorInvestigationFromEnrichment(enrichment);
    const engCapacity = signals.find((s) => s.factor_id === 'fac_eng_capacity');
    expect(engCapacity).toBeDefined();
    expect(engCapacity?.verdict).toBe('informative');
    // And the magnitude rode along, so the display layer can band it.
    expect(engCapacity?.value_of_information).toBe(0.045);

    // ⭐ THE ADDITIVE REMEDY, FIRING ON REAL PRODUCER BYTES — not a hand-built
    // fixture. 0.045 is POSITIVE, so no verdict suppresses it and it keeps its
    // recommendation; it is also below the shared 0.05 near-zero cut, so the
    // composer is now told, in the same breath, not to call it decisive.
    // Before this change the model received "<band> influence" and NOTHING
    // else for exactly this row — the shape that produced the witnessed lie.
    const drivers = projectTopDrivers(driversFrom(enrichment), undefined, 10, signals);
    const out = formatAnalysisForContext({
      status: 'ok',
      leading_option: { label: 'A', probability: 0.58 },
      runner_up: { label: 'B', probability: 0.42 },
      margin_pp: 16,
      robustness_band: 'moderate',
      top_drivers: drivers,
      fragile_edges: [],
    });
    const engRendered = ((out?.top_drivers ?? []) as Array<Record<string, unknown>>).find(
      (d) => d.label === 'Engineering Capacity',
    );
    expect(engRendered).toBeDefined();
    expect(String(engRendered?.investigation ?? '')).toContain('too small to call decisive');

    const offshore = signals.find((s) => s.factor_id === 'fac_offshore');
    expect(offshore?.verdict).toBe('no_information_value');
    // DISCRIMINATION: two real rows, two different verdicts, from one envelope.
    expect(engCapacity?.verdict).not.toBe(offshore?.verdict);
  });

  it('EXTRACTOR-DELETION GUARD: with no signals the join adds nothing and the pre-fix shape returns', () => {
    // This is the mutant F5 named: delete the join and everything still passes.
    // Here the absence is asserted POSITIVELY — same drivers, no signals, and
    // every rendered driver must be byte-identical to the pre-fix projection.
    const enrichment = realEnrichment();
    const drivers = projectTopDrivers(driversFrom(enrichment), undefined, 10, []);
    for (const d of drivers) {
      expect('investigation_verdict' in d).toBe(false);
      expect('investigation_voi' in d).toBe(false);
    }
    // CONTRAST in the same test: WITH signals, at least one driver carries one.
    const signals = deriveFactorInvestigationFromEnrichment(enrichment);
    const joined = projectTopDrivers(driversFrom(enrichment), undefined, 10, signals);
    expect(joined.some((d) => 'investigation_verdict' in d)).toBe(true);
  });
});
