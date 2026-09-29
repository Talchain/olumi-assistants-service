/**
 * ROADMAP 2.278 — `pickLatestFlipClaimPosture`: the selector that carries the
 * flip posture from the canonical run_analysis fact to the post-analysis advice
 * gate.
 *
 * ⚠ SCOPE, STATED SO IT IS NOT OVER-READ: this file proves the SELECTOR. The
 * single line in `turn-executor.ts` that calls it into `AdviceGateInput` is
 * covered by the typechecker only — no behavioural test in this lane drives a
 * whole turn and asserts the posture arrived. That residual is reported rather
 * than papered over.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { pickLatestFlipClaimPosture } from '../pick-flip-summary.js';

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../../../../tests/fixtures/cross-service/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}

const NO_FLIP = loadFixture('witness-2267-attested-no-flip.json');
const REAL_FLIP = loadFixture('witness-2265-runA.flip-threshold-winner.json');
const NO_FLIP_RUNS = Object.entries(NO_FLIP.runs as Record<string, Record<string, unknown>>);

function factWith(enrichment: unknown, computedAt = '2026-08-01T18:20:00.000Z'): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-witness',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      graph_hash_at_run: 'gh_a1b2c3d4e5f60001',
      computed_at: computedAt,
      ...(enrichment === undefined ? {} : { enrichment }),
    },
  } as unknown as HandlerFact;
}

describe('pickLatestFlipClaimPosture', () => {
  it.each(NO_FLIP_RUNS)('witnessed run %s → attested_no_flip', (_name, run) => {
    expect(pickLatestFlipClaimPosture([factWith({ flip_thresholds: run.flip_thresholds })])).toBe(
      'attested_no_flip',
    );
  });

  it('a run with a REAL flip → permitted', () => {
    expect(
      pickLatestFlipClaimPosture([factWith({ flip_thresholds: REAL_FLIP.flip_thresholds })]),
    ).toBe('permitted');
  });

  it.each([
    ['no facts', []],
    ['a fact with no enrichment', [factWith(undefined)]],
    ['a fact whose enrichment is not an object', [factWith('nope')]],
  ])('%s → undefined (distinguishable from "permitted")', (_label, facts) => {
    expect(pickLatestFlipClaimPosture(facts as HandlerFact[])).toBeUndefined();
  });

  it('reads the SAME fact the other grounding layers select — the NEWEST run', () => {
    // The drift class this selector family exists to close: a posture derived
    // from a different fact than the robustness band it corrects.
    const older = factWith({ flip_thresholds: REAL_FLIP.flip_thresholds }, '2026-08-01T10:00:00.000Z');
    const newer = factWith(
      { flip_thresholds: NO_FLIP_RUNS[0]![1].flip_thresholds },
      '2026-08-01T18:20:00.000Z',
    );
    expect(pickLatestFlipClaimPosture([older, newer])).toBe('attested_no_flip');
    // …and the reverse ordering resolves to the other fact, so the assertion
    // above is about RECENCY and not about array position.
    const newerRealFlip = factWith(
      { flip_thresholds: REAL_FLIP.flip_thresholds },
      '2026-08-01T19:00:00.000Z',
    );
    expect(pickLatestFlipClaimPosture([newer, newerRealFlip])).toBe('permitted');
  });
});
