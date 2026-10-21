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

/*
 * ⚠ DELETION 8 (track2, 22 Oct 2026): the join this suite drove end to end
 * (`projectTopDrivers` → `formatAnalysisForContext`) is deleted with the
 * ContextPack assembler, so the join and rendered-sentence rows went with it
 * (original in `evidence/track2-deletion8-20261022/deleted/`). What stays is the
 * LIVE half: the served derivation over the real staging capture.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { deriveFactorInvestigationFromEnrichment } from '../factor-investigation-licence.js';

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

describe('factor investigation — real staging envelope through the served derivation', () => {
  it('two real rows from one envelope get two different verdicts, bound by factor_id', () => {
    // In this capture `fac_eng_capacity` carries value_of_information: 0.045 at
    // the enrichment layer, so it is `informative`; `fac_offshore` carries 0 with
    // a present, non-zero rank_flip_rate, so it is `no_information_value`.
    const enrichment = realEnrichment();
    const signals = deriveFactorInvestigationFromEnrichment(enrichment);
    expect(signals.length).toBeGreaterThan(0);

    const engCapacity = signals.find((s) => s.factor_id === 'fac_eng_capacity');
    expect(engCapacity).toBeDefined();
    expect(engCapacity?.verdict).toBe('informative');
    // The magnitude rode along, so a display layer can band it.
    expect(engCapacity?.value_of_information).toBe(0.045);

    const offshore = signals.find((s) => s.factor_id === 'fac_offshore');
    expect(offshore?.verdict).toBe('no_information_value');
    // DISCRIMINATION: two real rows, two different verdicts, from one envelope.
    expect(engCapacity?.verdict).not.toBe(offshore?.verdict);
  });
});
