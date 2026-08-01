/**
 * ROADMAP 2.278 — the flip-claim posture gate, and the drift pin that keeps it
 * honest against the second classifier over the same rows.
 *
 * Fixtures are the WITNESSED bytes, not hand-assembled shapes:
 *   - `witness-2267-attested-no-flip.json` — four staging turns, 19/19
 *     `flip_thresholds` rows `structurally_invariant`. Zero flips attested.
 *   - `witness-2265-runA.flip-threshold-winner.json` — the first real measured
 *     factor flip in the programme's history. The POSITIVE CONTROL: if the gate
 *     fired on this it would be suppressing a true claim.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readFlipEntries, summariseFlipEntries } from '../../compose/flip-proposal.js';
import { readFlipClaimPosture, readTopLevelFlipRows } from '../flip-threshold-rows.js';

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../../../../tests/fixtures/cross-service/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}

const NO_FLIP = loadFixture('witness-2267-attested-no-flip.json');
const REAL_FLIP = loadFixture('witness-2265-runA.flip-threshold-winner.json');

const NO_FLIP_RUNS = Object.entries(NO_FLIP.runs as Record<string, Record<string, unknown>>);

describe('readFlipClaimPosture — the witnessed attested-no-flip turns', () => {
  it('the fixture really is 19/19 structurally_invariant (guards the fixture itself)', () => {
    const rows = NO_FLIP_RUNS.flatMap(([, run]) => run.flip_thresholds as Record<string, unknown>[]);
    expect(rows).toHaveLength(19);
    expect(rows.every((r) => r.flip_reason === 'structurally_invariant')).toBe(true);
    expect(rows.every((r) => r.no_flip_in_range === true)).toBe(true);
    expect(rows.every((r) => r.flip_value === null)).toBe(true);
  });

  it.each(NO_FLIP_RUNS)('run %s → attested_no_flip', (_name, run) => {
    expect(readFlipClaimPosture({ flip_thresholds: run.flip_thresholds })).toBe('attested_no_flip');
  });

  it('every one of those runs simultaneously carried the PLoT fragile verdict', () => {
    // Not an assertion about CEE — this is the contradiction the lane exists to
    // close, pinned so the fixture cannot quietly stop exhibiting it.
    for (const [, run] of NO_FLIP_RUNS) {
      const rob = run.robustness as Record<string, unknown>;
      expect(rob.display_verdict).toBe('fragile');
      expect(rob.display_verdict_reason).toBe('small changes could flip this result');
      expect(rob.is_robust).toBe(false);
    }
  });

  it('and carried isolated/correlated flip_risk_category marginals on the same factors', () => {
    // The false-flip mechanism: the marginal says "isolated", the flip evidence
    // for that SAME factor_id says structurally_invariant.
    const isolated = NO_FLIP_RUNS.flatMap(([, run]) =>
      (run.factor_sensitivity as Record<string, unknown>[]).filter(
        (f) => f.flip_risk_category === 'isolated',
      ),
    );
    expect(isolated.length).toBeGreaterThan(0);
    for (const [, run] of NO_FLIP_RUNS) {
      const byId = new Map(
        (run.flip_thresholds as Record<string, unknown>[]).map((r) => [r.factor_id, r]),
      );
      for (const f of run.factor_sensitivity as Record<string, unknown>[]) {
        // every marginal-bearing factor has a flip row, and it attests no flip
        expect(byId.get(f.factor_id)?.flip_reason).toBe('structurally_invariant');
      }
    }
  });
});

describe('readFlipClaimPosture — POSITIVE CONTROL: a run with a real flip', () => {
  it('the control fixture really does carry a finite flip_value', () => {
    const rows = readTopLevelFlipRows({ flip_thresholds: REAL_FLIP.flip_thresholds });
    expect(rows.some((r) => r.kind === 'flip_pair')).toBe(true);
  });

  it('does NOT fire — a true flippability claim is never suppressed', () => {
    expect(readFlipClaimPosture({ flip_thresholds: REAL_FLIP.flip_thresholds })).toBe('permitted');
  });
});

describe('readFlipClaimPosture — conservatism (every uncertain state permits)', () => {
  it.each([
    ['absent enrichment', undefined],
    ['null', null],
    ['a non-object', 'nope'],
    ['an array', []],
    ['no flip_thresholds key', {}],
    ['flip_thresholds not an array', { flip_thresholds: 'x' }],
    ['empty flip_thresholds', { flip_thresholds: [] }],
    ['rows with no parseable factor_id', { flip_thresholds: [{ flip_reason: 'structurally_invariant' }] }],
  ])('%s → permitted', (_label, enrichment) => {
    expect(readFlipClaimPosture(enrichment)).toBe('permitted');
  });

  it('an UNATTESTED null row alongside attested ones → permitted, not attested_no_flip', () => {
    // A mix means the producer did not establish absence across the board.
    expect(
      readFlipClaimPosture({
        flip_thresholds: [
          { factor_id: 'a', flip_value: null, flip_reason: 'structurally_invariant' },
          { factor_id: 'b', flip_value: null }, // no reason → `unusable`
        ],
      }),
    ).toBe('permitted');
  });

  it('an unrecognised flip_reason token → permitted (a new upstream token must not read as certainty)', () => {
    expect(
      readFlipClaimPosture({
        flip_thresholds: [{ factor_id: 'a', flip_value: null, flip_reason: 'some_new_token' }],
      }),
    ).toBe('permitted');
  });

  it('one real flip among attested rows → permitted', () => {
    expect(
      readFlipClaimPosture({
        flip_thresholds: [
          { factor_id: 'a', flip_value: null, flip_reason: 'structurally_invariant' },
          { factor_id: 'b', current_value: 1, flip_value: 2 },
        ],
      }),
    ).toBe('permitted');
  });

  it('accepts the OTHER attested token too (no_effect_within_bounds)', () => {
    expect(
      readFlipClaimPosture({
        flip_thresholds: [{ factor_id: 'a', flip_value: null, flip_reason: 'no_effect_within_bounds' }],
      }),
    ).toBe('attested_no_flip');
  });
});

describe('DRIFT PIN — the two classifiers over the same rows must agree', () => {
  /**
   * `summariseFlipEntries` (compose/flip-proposal.ts) is a second reader of
   * `enrichment.flip_thresholds[]`. It is deliberately NOT imported by the gate
   * (import weight — see the note on `FlipClaimPosture`). This control is what
   * makes that duplication safe: both are driven over the same inputs and must
   * agree, so a change to either that moves the boundary fails HERE rather than
   * silently splitting the estate's answer to "did anything flip?".
   */
  // Synthetic rows carry `factor_label` because EVERY row on the real wire does
  // (all 19 witnessed rows + all of witness-2265). See the admission-divergence
  // test below for what happens when one does not, and why it is out of scope
  // for this pin.
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ...NO_FLIP_RUNS.map(
      ([name, run]) => [`witness-2267 run ${name}`, { flip_thresholds: run.flip_thresholds }] as const,
    ),
    ['witness-2265 runA (real flip)', { flip_thresholds: REAL_FLIP.flip_thresholds }],
    ['empty', { flip_thresholds: [] }],
    ['no key', {}],
    [
      'mixed attested + unusable',
      {
        flip_thresholds: [
          { factor_id: 'a', factor_label: 'A', flip_value: null, flip_reason: 'structurally_invariant' },
          { factor_id: 'b', factor_label: 'B', flip_value: null },
        ],
      },
    ],
    [
      'both attested tokens',
      {
        flip_thresholds: [
          { factor_id: 'a', factor_label: 'A', flip_value: null, flip_reason: 'structurally_invariant' },
          { factor_id: 'b', factor_label: 'B', flip_value: null, flip_reason: 'no_effect_within_bounds' },
        ],
      },
    ],
    [
      'unrecognised token',
      {
        flip_thresholds: [
          { factor_id: 'a', factor_label: 'A', flip_value: null, flip_reason: 'brand_new' },
        ],
      },
    ],
    [
      'one real flip among attested',
      {
        flip_thresholds: [
          { factor_id: 'a', factor_label: 'A', flip_value: null, flip_reason: 'structurally_invariant' },
          { factor_id: 'b', factor_label: 'B', current_value: 1, flip_value: 2 },
        ],
      },
    ],
  ];

  it.each(cases)('%s — posture agrees with overall_status', (_label, enrichment) => {
    const posture = readFlipClaimPosture(enrichment);
    const status = summariseFlipEntries(readFlipEntries(enrichment)).overall_status;
    expect(posture === 'attested_no_flip').toBe(status === 'no_practical_flip');
  });

  /**
   * ⚠ RECORDED DIVERGENCE, found by this pin on its first run — deliberately
   * NOT "fixed", and deliberately not swept into the pin above.
   *
   * The two readers have different ROW-ADMISSION rules, independent of flip
   * semantics: `readFlipEntries` (flip-proposal.ts:335) drops any row lacking
   * `factor_label`, while `readTopLevelFlipRows` falls back to the `factor_id`
   * as the label and keeps it. So a label-less attested row reads
   * `attested_no_flip` here and `'none'` there.
   *
   * Why this is not acted on in 2.278: it changes no verdict on any observed
   * payload — PLoT emits `factor_label` on every row of every capture we hold
   * (19/19 in witness-2267, all of witness-2265) — and closing it means picking
   * which admission rule is correct for BOTH consumers, which is a change to
   * the decision_review and chip paths, not to a copy gate. Rowed as bycatch.
   *
   * It is pinned HERE, as a characterisation test, so the divergence is a known
   * measured quantity rather than a surprise the day a producer drops a label.
   */
  it('BYCATCH (characterised, not fixed): the readers disagree on a LABEL-LESS attested row', () => {
    const labelless = {
      flip_thresholds: [{ factor_id: 'a', flip_value: null, flip_reason: 'structurally_invariant' }],
    };
    expect(readFlipClaimPosture(labelless)).toBe('attested_no_flip');
    expect(summariseFlipEntries(readFlipEntries(labelless)).overall_status).toBe('none');

    // …and the divergence is ONLY about the label: add one and they agree.
    const labelled = {
      flip_thresholds: [
        { factor_id: 'a', factor_label: 'A', flip_value: null, flip_reason: 'structurally_invariant' },
      ],
    };
    expect(readFlipClaimPosture(labelled)).toBe('attested_no_flip');
    expect(summariseFlipEntries(readFlipEntries(labelled)).overall_status).toBe('no_practical_flip');
  });
});
