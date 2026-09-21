/**
 * ROADMAP 2.681 — CEE's confidence band MUST agree with the band PLoT already
 * puts in front of the user.
 *
 * THE DEFECT THIS PINS (live, user-visible, measured 8 Aug 2026 on deployed
 * PLoT `bc4b2a34` + CEE `98f2476a` + ISL `fcba3754`):
 *
 *   PLoT  `src/review-pass/evidence-priority.ts:139-145` — the "Add evidence"
 *         suggested-action the user READS:
 *           confidence >= 0.7  → suppressed (not worth investigating)
 *           confidence <  0.4  → "...your confidence in its strength is low."
 *           otherwise          → "...your confidence in its strength is medium."
 *   CEE   `confidence-bands.ts` — the evidence-block display band, WAS
 *           confidence >= 0.3  → 'medium'
 *
 * The two services already agreed EXACTLY on 0.7. They diverged on ONE number,
 * and live confidence FLOORS AT 0.30 (ISL `STABILITY_CONFIDENCE_MAP.negligible`
 * = 0.1, PLoT `confidence = 0.5*islConf + 0.25` ⇒ floor 0.5*0.1+0.25 = 0.30), so
 * the divergence was not a corner — it was most of the traffic:
 *
 *   - 404 `factor_sensitivity[].confidence` values across 125 deployed-staging
 *     capture files (August 2026): **218 (54%) fell in [0.3, 0.4)** — PLoT said
 *     "low" while CEE stamped 'medium' on the same factor. ZERO of those 404
 *     fell below 0.3, so on that corpus CEE's 'low' band was unreachable.
 *     CLAIM TYPE: "not observed in 404 August rows", NOT "impossible" — the
 *     April 2026 fixture below predates PLoT's v2/v3 formula and does carry
 *     sub-0.3 values, which is precisely why it stays in the corpus.
 *   - 286 evidence blocks in those captures: **286/286** carried
 *     `current_confidence: 'medium'`, `severity: 'info'`, `category:
 *     'could_fix'`. Not one 'low', not one 'critical'/'warning'. The whole
 *     severity ladder was collapsed onto its bottom rung by the drifted number.
 *
 * WHY THIS IS A PINNED CONSTANT AND NOT A DERIVATION. Deriving would be better
 * (trap 12) and was checked first — it is not available at this tip:
 *   - `@talchain/schemas` types no factor confidence BAND. Its only confidence
 *     enum, `EnrichmentConfidenceTier`, is `strong|fair|needs_work` — the
 *     whole-analysis tier, a different concept.
 *   - The wire carries `factor_sensitivity[].confidence` as a bare SCALAR. No
 *     band label crosses the boundary for CEE to read.
 *   - PLoT's band reaches the user as PRE-RENDERED PROSE inside
 *     `suggested_actions[].message`, not as structured data.
 * So the boundary is pinned HERE, with its provenance, and this file is the
 * fail-loud mirror-guard: if PLoT moves its number, this test REDs and NAMES
 * the file to change. That is trap 12's prescribed fallback — where you cannot
 * derive, the mirror must fail loud on drift rather than assume good.
 *
 * WHY THE CORPUS IS CAPTURES, NOT VALUES THIS FILE CHOSE (trap 22). A corpus
 * drawn from the author's head cannot see the class the author did not imagine,
 * and a full mutant kit will certify it anyway. Every value below is read out
 * of a VERBATIM deployed-staging capture already committed to this repo — the
 * two `fixtures/dsk-walk/*.enrichment.json` envelopes and the cross-service
 * staging turn. No confidence literal in this file is an input; the only
 * literals are the two PLoT boundaries being pinned and the historical 0.3.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  bandConfidence,
  isLensLowConfidence,
  CONFIDENCE_HIGH_MIN,
  CONFIDENCE_MEDIUM_MIN,
  LENS_LOW_CONFIDENCE_MAX,
  type ConfidenceBand,
} from '../confidence-bands.js';

// ============================================================================
// 1. The PLoT boundary, with its provenance — the thing that must not drift
// ============================================================================

/**
 * Read at the bytes from DEPLOYED PLoT, not from a note about it.
 *
 *   repo   Talchain/plot-lite-service
 *   ref    bc4b2a34e94649e1d93879cf701d1e6fd81d67d9  (staging == deployed, 7 Aug 2026)
 *   file   src/review-pass/evidence-priority.ts
 *   lines  139-145  (`suggestedEvidenceText`)
 *
 * If this test REDs, the fix is NOT to edit these numbers to match CEE — it is
 * to re-read that file at PLoT's current tip and move BOTH services together.
 */
const PLOT_PROVENANCE = {
  repo: 'Talchain/plot-lite-service',
  ref: 'bc4b2a34e94649e1d93879cf701d1e6fd81d67d9',
  file: 'src/review-pass/evidence-priority.ts',
  symbol: 'suggestedEvidenceText',
} as const;

/** PLoT: `if (confidence >= 0.7) return null; // suppress — high confidence` */
const PLOT_SUPPRESS_MIN = 0.7;
/** PLoT: `if (confidence < 0.4) { ...is low. }` */
const PLOT_LOW_MAX = 0.4;

/** The two copy templates PLoT actually emits, verbatim. */
const PLOT_COPY_LOW =
  'Gather evidence on how {factor} affects the goal — this factor is highly sensitive but your confidence in its strength is low.';
const PLOT_COPY_MEDIUM =
  'Gather evidence on how {factor} affects the goal — this factor is highly sensitive but your confidence in its strength is medium.';

/**
 * A faithful replica of PLoT's decision, returning the STRING the user reads
 * (or `null` where PLoT suppresses the item entirely).
 *
 * Deliberately shaped as the copy rather than a band label: the property that
 * matters is the WORD IN FRONT OF THE USER, so the parity assertion binds to
 * the emitted sentence and cannot be satisfied by a label that merely happens
 * to sort the same way (trap 19 — bind by identity, not by a predicate
 * something else could satisfy).
 */
function plotSuggestedEvidenceText(confidence: number): string | null {
  if (confidence >= PLOT_SUPPRESS_MIN) return null;
  if (confidence < PLOT_LOW_MAX) return PLOT_COPY_LOW;
  return PLOT_COPY_MEDIUM;
}

/** The band a user would infer from what PLoT put on their screen. */
function plotUserFacingBand(confidence: number): ConfidenceBand {
  const copy = plotSuggestedEvidenceText(confidence);
  if (copy === null) return 'high'; // suppressed as "not worth investigating"
  return copy === PLOT_COPY_LOW ? 'low' : 'medium';
}

/** The boundary CEE shipped before 2.681 — pinned to the HISTORICAL artefact,
 *  permanently, so the control below can never decay into a tautology when the
 *  live boundary moves again (trap 12b). */
const CEE_HISTORICAL_MEDIUM_MIN = 0.3;

function bandWithMediumMin(confidence: number, mediumMin: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_HIGH_MIN) return 'high';
  if (confidence >= mediumMin) return 'medium';
  return 'low';
}

// ============================================================================
// 2. The corpus — verbatim deployed-staging captures already in this repo
// ============================================================================

const REPO_ROOT = new URL('../../../../', import.meta.url);

type Row = {
  readonly source: string;
  readonly factorId: string;
  readonly confidence: number;
  readonly influenceRank: number | null;
};

function collectFactorConfidences(node: unknown, source: string, out: Row[]): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectFactorConfidences(n, source, out);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'factor_sensitivity' && Array.isArray(value)) {
      for (const raw of value) {
        if (raw === null || typeof raw !== 'object') continue;
        const e = raw as Record<string, unknown>;
        if (typeof e.confidence !== 'number' || !Number.isFinite(e.confidence)) continue;
        const factorId =
          typeof e.factor_id === 'string' ? e.factor_id
          : typeof e.node_id === 'string' ? e.node_id
          : typeof e.id === 'string' ? e.id
          : '(unidentified)';
        out.push({
          source,
          factorId,
          confidence: e.confidence,
          influenceRank:
            typeof e.influence_rank === 'number' && Number.isFinite(e.influence_rank)
              ? e.influence_rank
              : null,
        });
      }
    }
    collectFactorConfidences(value, source, out);
  }
}

function loadRows(url: URL, source: string): Row[] {
  const out: Row[] = [];
  collectFactorConfidences(JSON.parse(readFileSync(url, 'utf8')), source, out);
  return out;
}

/**
 * Three independent deployed-staging captures. Each is committed VERBATIM
 * elsewhere in this repo for its own reasons, so none of them was shaped by
 * this lane — which is exactly why they are usable as a corpus.
 */
const LIVE_ROWS: readonly Row[] = [
  ...loadRows(
    new URL('./fixtures/dsk-walk/session-a.enrichment.json', import.meta.url),
    'dsk-walk/session-a',
  ),
  ...loadRows(
    new URL('./fixtures/dsk-walk/session-b2.enrichment.json', import.meta.url),
    'dsk-walk/session-b2',
  ),
  ...loadRows(
    new URL('tests/fixtures/cross-service/v5-turn.run-analysis.staging.json', REPO_ROOT),
    'cross-service/v5-turn.run-analysis.staging',
  ),
];

/** The rows the two services USED to disagree about: PLoT "low", CEE 'medium'. */
const DISAGREEMENT_WINDOW = LIVE_ROWS.filter(
  (r) => r.confidence >= CEE_HISTORICAL_MEDIUM_MIN && r.confidence < PLOT_LOW_MAX,
);

// ============================================================================
// 3. The corpus is real, and it can SEE the defect (precondition pins)
// ============================================================================
//
// Every assertion in §4 is worthless if the corpus stops containing values in
// the contested window — it would pass by testing nothing, which is the exact
// shape of a guard agreeing with itself (trap 13b). These pin the corpus's own
// discriminating power, in-test, so a fixture that is regenerated, trimmed or
// re-pathed REDs here rather than quietly hollowing out the parity test.

describe('2.681 corpus — the captures can observe the defect', () => {
  it('loads real capture rows from all three committed staging captures', () => {
    const bySource = new Map<string, number>();
    for (const r of LIVE_ROWS) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
    expect(bySource.get('dsk-walk/session-a')).toBeGreaterThan(0);
    expect(bySource.get('dsk-walk/session-b2')).toBeGreaterThan(0);
    expect(bySource.get('cross-service/v5-turn.run-analysis.staging')).toBeGreaterThan(0);
  });

  it('CONTAINS values in the contested [0.3, 0.4) window — else §4 is vacuous', () => {
    expect(DISAGREEMENT_WINDOW.length).toBeGreaterThan(0);
  });

  it('the window spans MORE than the exact floor — not one degenerate value', () => {
    // 0.30 is the arithmetic floor and dominates live traffic, but a corpus of
    // nothing but 0.30 would only ever prove the boundary is not `> 0.3`.
    const distinct = new Set(DISAGREEMENT_WINDOW.map((r) => r.confidence));
    expect(distinct.size).toBeGreaterThan(1);
    expect([...distinct].some((c) => c > CEE_HISTORICAL_MEDIUM_MIN)).toBe(true);
  });

  it('also contains rows OUTSIDE the window, so parity is not proven on one class', () => {
    expect(LIVE_ROWS.some((r) => r.confidence >= PLOT_LOW_MAX)).toBe(true);
  });

  it('HISTORICAL CONTROL — the pre-2.681 boundary DISAGREES with PLoT on this corpus', () => {
    // Pinned to 0.3 by literal, permanently. This is the defect as it shipped;
    // it must stay observable no matter where the live boundary moves next, or
    // the parity test below loses its only evidence that it is testing anything
    // (trap 12b — a control pinned to "current" expires the day current moves).
    const stillDisagreeing = LIVE_ROWS.filter(
      (r) =>
        bandWithMediumMin(r.confidence, CEE_HISTORICAL_MEDIUM_MIN) !==
        plotUserFacingBand(r.confidence),
    );
    expect(stillDisagreeing.length).toBe(DISAGREEMENT_WINDOW.length);
    expect(stillDisagreeing.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 4. The property: CEE's band is the band PLoT already showed the user
// ============================================================================

describe('2.681 — CEE confidence bands agree with PLoT user-facing copy', () => {
  it(`pins the low/medium boundary to PLoT ${PLOT_PROVENANCE.file} (${PLOT_PROVENANCE.symbol})`, () => {
    // If this REDs: PLoT moved. Re-read
    //   {repo}/{file} @ its current tip
    // and move BOTH services together — never edit one side to match the other.
    expect(CONFIDENCE_MEDIUM_MIN).toBe(PLOT_LOW_MAX);
  });

  it(`pins the medium/high boundary to the same PLoT source`, () => {
    // This one has ALWAYS agreed — which is the tell that 0.3 was the drifted
    // number and not 0.4. It is pinned so a future edit cannot break the half
    // that was never broken.
    expect(CONFIDENCE_HIGH_MIN).toBe(PLOT_SUPPRESS_MIN);
  });

  it('agrees with PLoT on EVERY confidence value in the live capture corpus', () => {
    const mismatches = LIVE_ROWS.filter(
      (r) => bandConfidence(r.confidence) !== plotUserFacingBand(r.confidence),
    ).map((r) => ({
      source: r.source,
      factorId: r.factorId,
      confidence: r.confidence,
      cee: bandConfidence(r.confidence),
      plotShowsUser: plotUserFacingBand(r.confidence),
    }));
    expect(mismatches).toEqual([]);
  });

  it('bands every row in the contested window as `low`, matching PLoT copy', () => {
    // The direct statement of the shipped defect, bound to the rows that
    // exhibited it rather than to a count.
    for (const r of DISAGREEMENT_WINDOW) {
      expect(bandConfidence(r.confidence)).toBe('low');
      expect(plotSuggestedEvidenceText(r.confidence)).toBe(PLOT_COPY_LOW);
    }
  });

  it('makes the `low` band reachable FROM THE CONTESTED WINDOW specifically', () => {
    // SCOPE, stated precisely rather than generalised. The "CEE's `low` band is
    // unreachable" measurement is bounded to the 404 rows captured across 125
    // deployed-staging files in AUGUST 2026, where confidence floors at 0.30 —
    // in that corpus, 0 rows fell below 0.3. It is NOT a claim about all
    // captures ever taken: the April 2026 cross-service fixture loaded above
    // predates PLoT's v2/v3 confidence formula and does carry sub-0.3 values
    // (0.25, 0.1), which is why it is in this corpus at all — it exercises the
    // band from the other side.
    //
    // So the discriminating assertion is not "some row is low" (the April rows
    // satisfy that at ANY boundary, and it would pass with the defect intact).
    // It is that the CONTESTED window — the class that floors at 0.30 and is
    // 54% of current live traffic — now bands `low`, which is what unlocks the
    // evidence-block severity ladder (`low` + rank-1 → critical, `low` →
    // warning, else info) that measured 286/286 `info` on the August captures.
    expect(DISAGREEMENT_WINDOW.length).toBeGreaterThan(0);
    for (const r of DISAGREEMENT_WINDOW) {
      expect(bandWithMediumMin(r.confidence, CEE_HISTORICAL_MEDIUM_MIN)).toBe('medium');
      expect(bandConfidence(r.confidence)).toBe('low');
    }
  });

  it('boundary values themselves land on the PLoT side of each edge', () => {
    // Exact-edge behaviour, stated once: >= is the operator on both boundaries
    // in BOTH services, so the edges belong to the upper band.
    expect(bandConfidence(PLOT_LOW_MAX)).toBe('medium');
    expect(bandConfidence(PLOT_SUPPRESS_MIN)).toBe('high');
    expect(plotUserFacingBand(PLOT_LOW_MAX)).toBe('medium');
    expect(plotUserFacingBand(PLOT_SUPPRESS_MIN)).toBe('high');
  });

  it('still returns null (unknown) for absent / non-finite confidence', () => {
    // Unchanged by 2.681, pinned here because the parity fix must not become a
    // reason to default a missing signal into the newly-reachable `low` band —
    // that would fabricate a `critical` severity out of an absent value.
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, '0.35', {}]) {
      expect(bandConfidence(bad)).toBeNull();
    }
  });
});

// ============================================================================
// 5. The DISPLAY band and the LADDER trigger are two different questions
// ============================================================================
//
// The single most likely way this fix gets undone is a future tidy-up noticing
// two confidence thresholds in one file and "removing the duplication" — which
// is normally the right instinct here (trap 12) and is wrong in this one case.
// These pin the difference as LOAD-BEARING and measured, so that edit REDs with
// the reason attached instead of quietly reordering the coaching ladder.

describe('2.681 — the display band and the lens trigger are deliberately different', () => {
  it('holds them at different values, with the display band the higher one', () => {
    expect(CONFIDENCE_MEDIUM_MIN).toBe(PLOT_LOW_MAX);
    expect(LENS_LOW_CONFIDENCE_MAX).toBe(CEE_HISTORICAL_MEDIUM_MIN);
    expect(LENS_LOW_CONFIDENCE_MAX).toBeLessThan(CONFIDENCE_MEDIUM_MIN);
  });

  it('the lens trigger is BYTE-IDENTICAL to pre-2.681 on every live capture row', () => {
    // The trust fix must not have moved the ladder. Stated as a per-row
    // equivalence against the historical band rather than as a passing suite,
    // because "the other tests still pass" is not evidence about this property.
    for (const r of LIVE_ROWS) {
      expect(isLensLowConfidence(r.confidence)).toBe(
        bandWithMediumMin(r.confidence, CEE_HISTORICAL_MEDIUM_MIN) === 'low',
      );
    }
  });

  it('the two DIVERGE on real captured rows — the split is not cosmetic', () => {
    // If this ever finds no divergence, the corpus has stopped containing the
    // contested class and the test above is proving nothing (trap 13b: pin the
    // precondition in-test, so the guard cannot pass by not discriminating).
    const diverging = LIVE_ROWS.filter(
      (r) => isLensLowConfidence(r.confidence) !== (bandConfidence(r.confidence) === 'low'),
    );
    expect(diverging.length).toBe(DISAGREEMENT_WINDOW.length);
    expect(diverging.length).toBeGreaterThan(0);
  });

  it('the lens trigger is fail-CLOSED on absent / non-finite confidence', () => {
    // An unknown confidence must never trigger a coaching exercise whose whole
    // claim is "you are least sure about this factor". Same rule as the display
    // band's `null`, asserted separately because it is a different function and
    // a different failure (there: a fabricated band; here: a fabricated claim).
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, '0.2', {}]) {
      expect(isLensLowConfidence(bad)).toBe(false);
    }
  });

  it('names the ladder stake: rank-1 rows that merging the two would newly trigger', () => {
    // `TOP_FACTOR_LOW_CONFIDENCE` needs `influence_rank === 1` AND low. This is
    // the exact set that would start firing if the constants were merged — the
    // set that starves `consider_opposite` / `devils_advocacy` on the sessionA
    // capture. Non-empty here is what makes the merge a REGRESSION rather than
    // a no-op, so it is asserted rather than described.
    const rank1 = LIVE_ROWS.filter((r) => r.influenceRank === 1);
    expect(rank1.length).toBeGreaterThan(0);

    const firesToday = rank1.filter((r) => isLensLowConfidence(r.confidence));
    const firesIfMerged = rank1.filter((r) => bandConfidence(r.confidence) === 'low');
    expect(firesIfMerged.length).toBeGreaterThan(firesToday.length);
  });
});
