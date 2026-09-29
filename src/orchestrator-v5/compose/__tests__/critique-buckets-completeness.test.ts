/**
 * LANE 3 Car 3 (hygiene) — CRITIQUE_BUCKETS completeness against the ISL
 * critique-code corpus (value-chain triage Row 21 bycatch 1; worsened since:
 * 3 missing at 2026-08-04, not 2).
 *
 * THE DEFECT CLASS (CLAUDE.md trap 12 + 12d): `CRITIQUE_BUCKETS`' header
 * claims "Every ISL critique code from Inference-Service-Layer/
 * src/models/critique.py is listed here". That claim was FALSE at every tip
 * checked since 31 Jul and NOTHING tested it — the fail-safe (`bucketFor`
 * unknown → 'D') makes the drift invisible: each unlisted code is silently
 * suppressed with no conscious decision recorded. Silent-suppression drift,
 * not a leak — but a disclosure ISL deliberately emits (e.g.
 * MARGINAL_SWITCH_TRUNCATED, "we publish what we computed and name what we
 * did not") disappears without anyone having chosen that.
 *
 * WHY A HAND-WRITTEN CORPUS (trap 12d): TypeScript cannot import
 * critique.py, so a derived guard is impossible at this seam — and a derived
 * guard could never notice the canonical list going short anyway. This
 * corpus IS the completeness check; it is expected to need a human append
 * when ISL adds codes, and THAT is the moment the bucket decision gets made
 * consciously instead of by fail-safe.
 *
 * CORPUS PROVENANCE: `grep -oE 'code="[A-Z_]+"' src/models/critique.py |
 * sort -u` over ISL staging (fetched via gh api, 2026-08-04) — 34 distinct
 * codes. Refresh the same way; scope = the single ISL file that defines
 * critique codes.
 *
 * RED-FIRST at pristine CEE `d2cdd99b`: fails naming exactly
 * GOAL_ANCESTOR_DATA_GAP, STRUCTURAL_INFLUENCE_TRUNCATED,
 * MARGINAL_SWITCH_TRUNCATED.
 */

import { describe, it, expect } from 'vitest';
import { CRITIQUE_BUCKETS } from '../sanitise-enrichment.js';

/** All 34 ISL critique codes @ ISL staging, 2026-08-04 (provenance above). */
const ISL_CRITIQUE_CODE_CORPUS = [
  'BASELINE_NEAR_ZERO',
  'CONSTRAINT_NODE_DEFAULT_BASE',
  'DEGENERATE_OPTION_ZERO_VARIANCE',
  'DEGENERATE_OUTCOMES',
  'DUPLICATE_NODE_ID',
  'DUPLICATE_OPTION_ID',
  'EDGE_ENDPOINT_MISSING',
  'EDGE_STD_INVALID',
  'EDGE_STRENGTH_OUT_OF_RANGE',
  'EMPTY_INTERVENTIONS',
  'GOAL_ANCESTOR_DATA_GAP',
  'GRAPH_CYCLE_DETECTED',
  'GRAPH_DISCONNECTED',
  'GRAPH_EMPTY',
  'HIGH_TIE_RATE',
  'IDENTICAL_OPTIONS',
  'IDENTIFIABILITY_ISSUE',
  'INFERENCE_TIMEOUT',
  'INSUFFICIENT_OPTIONS',
  'INTERNAL_ERROR',
  'INTERVENTION_VALUE_INVALID',
  'INVALID_INTERVENTION_TARGET',
  'INVALID_NODE_ID',
  'LOW_EFFECTIVE_SAMPLES',
  'MARGINAL_SWITCH_TRUNCATED',
  'MISSING_GOAL_NODE',
  'MONTE_CARLO_FAILED',
  'NEGLIGIBLE_EDGE_STRENGTH',
  'NO_EFFECTIVE_PATH_TO_GOAL',
  'NO_OPTIONS',
  'NUMERICAL_INSTABILITY',
  'OPTION_NO_INTERVENTIONS',
  'SEED_INVALID',
  'STRUCTURAL_INFLUENCE_TRUNCATED',
] as const;

describe('CRITIQUE_BUCKETS completeness — the header claim, finally tested', () => {
  it('every ISL corpus code has an EXPLICIT bucket entry (fail-safe D is a decision nobody made)', () => {
    const missing = ISL_CRITIQUE_CODE_CORPUS.filter(
      (code) => CRITIQUE_BUCKETS[code] === undefined,
    );
    expect(
      missing,
      'These ISL codes reach CEE and are silently suppressed by the unknown→D ' +
        'fail-safe with no conscious bucket decision recorded. Add each to ' +
        'CRITIQUE_BUCKETS explicitly (D needs no new copy; S/U promotion needs ' +
        'Paul-approved copy) and update the classification-totals pin.',
    ).toEqual([]);
  });

  it('POSITIVE CONTROL — the corpus detects an unlisted code (a fake code is reported missing)', () => {
    const corpusPlusFake = [...ISL_CRITIQUE_CODE_CORPUS, 'FAKE_CODE_FOR_CONTROL_xyzzy'];
    const missing = corpusPlusFake.filter((code) => CRITIQUE_BUCKETS[code] === undefined);
    expect(missing).toContain('FAKE_CODE_FOR_CONTROL_xyzzy');
  });

  it('inverse direction — no CRITIQUE_BUCKETS entry claims to be an ISL code that is not in the corpus (PLoT-authored entries are named exceptions)', () => {
    // PLoT-authored codes deliberately live in the table but not in
    // critique.py — the named-exception list keeps this assertion honest
    // instead of quietly widening.
    const PLOT_AUTHORED = new Set(['SAMPLES_REDUCED_FOR_COMPLEXITY']);
    const corpus = new Set<string>(ISL_CRITIQUE_CODE_CORPUS);
    const unexpected = Object.keys(CRITIQUE_BUCKETS).filter(
      (code) => !corpus.has(code) && !PLOT_AUTHORED.has(code),
    );
    expect(
      unexpected,
      'Either ISL removed a code (delete the entry AND the corpus row with a ' +
        'fresh derivation) or a non-ISL producer joined (add it to the named ' +
        'PLoT_AUTHORED exceptions with provenance).',
    ).toEqual([]);
  });
});
