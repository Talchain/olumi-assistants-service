/**
 * schemas 0.31.0 — `critiques` joins `ENRICHMENT_CLAIM_BLOBS`.
 *
 * ⚠ THIS TEST EXISTS BECAUSE THE MUTATION CHECK CAUGHT ITS ABSENCE. Adding
 * `'critiques'` to `ENRICHMENT_CLAIM_BLOBS` first shipped with NO coverage:
 * deleting the entry again left all 68 tests in the review scope green. That is
 * the definition of theatre — a guard entry whose removal nothing notices — and
 * it is exactly what CLAUDE.md trap 11 says to hunt.
 *
 * WHY THE ENTRY IS NEEDED AT ALL. The per-row transport projection stops the
 * STRUCTURED designation (`affected_option_ids` is dropped on a withheld turn),
 * but a critique's `user_message` for the U bucket is PRODUCER PROSE — PLoT's
 * and ISL's wording, which this repo does not author and cannot pattern-check
 * at the source. So a leader name can ride the prose even after the structured
 * half is clean. `robustness` was added to this same list on 2026-07-27 as "the
 * third instance of the same defect"; `critiques` is the fourth.
 */
import { describe, expect, it } from 'vitest';

import { findLeaderClaims } from '../leading-option-egress-guard.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';

/** Prose that asserts a leader — the shape the guard's patterns are tuned for. */
const LEADER_PROSE = 'Option Alpha is the strongest option and currently leads.';

function responseWithEnrichment(enrichment: Record<string, unknown>): OlumiResponse {
  return {
    blocks: [{ type: 'analysis_result', enrichment }],
  } as unknown as OlumiResponse;
}

describe('critiques are scanned for leader claims at egress', () => {
  it('POSITIVE CONTROL — the scan sees leader prose in an ALREADY-covered blob', () => {
    // Proves the harness, the response shape and the pattern all work before
    // anything is claimed about `critiques` (CLAUDE.md trap 13). Without this,
    // a wrong envelope shape would make the critiques assertion below fail for
    // the wrong reason — or, worse, a wrong PROSE string would make it pass
    // vacuously in the negative direction.
    const hits = findLeaderClaims(
      responseWithEnrichment({ robustness: { caveat: LEADER_PROSE } }),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it('leader prose inside critiques[].user_message IS caught', () => {
    const hits = findLeaderClaims(
      responseWithEnrichment({
        critiques: [{ code: 'LOW_EFFECTIVE_SAMPLES', user_message: LEADER_PROSE }],
      }),
    );
    expect(
      hits.length,
      'critiques must be in ENRICHMENT_CLAIM_BLOBS — a critique carries ' +
        'producer prose this repo does not author, so a leader name can ride it ' +
        'even when the structured half (affected_option_ids) is clean.',
    ).toBeGreaterThan(0);
    expect(hits.some((h) => h.path.includes('critiques'))).toBe(true);
  });

  it('NEGATIVE CONTROL — innocent critique prose is NOT flagged', () => {
    // Without this the assertion above would also pass against a guard that
    // flagged every string it saw, which would be a different defect.
    const hits = findLeaderClaims(
      responseWithEnrichment({
        critiques: [
          {
            code: 'LOW_EFFECTIVE_SAMPLES',
            user_message: 'This analysis is less reliable than usual.',
          },
        ],
      }),
    );
    expect(hits).toEqual([]);
  });
});
