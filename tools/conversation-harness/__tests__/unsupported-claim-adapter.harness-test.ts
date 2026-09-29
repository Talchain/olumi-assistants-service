import { describe, it, expect } from 'vitest';
import { productionUnsupportedClaimChecker, packFromTurn } from '../scorer/unsupported-claim-adapter.js';
import type { GateTurn } from '../scorer/gate-dims.js';
import type { TurnRow } from '../scorer/dims.js';
import type { TurnSurfaces } from '../scorer/prompt-dims.js';

function turn(assistantText: string, s: Partial<TurnSurfaces> = {}): GateTurn {
  const row: TurnRow = {
    turn: 'T1', turnClassHint: null, editIntent: false, onlyIf: null, skipped: false,
    duplicateOf: null, httpStatus: 200, startedAt: null, wallClockMs: 1, assistantText,
    chips: [], substageTimings: null,
  };
  return {
    row,
    surfaces: { hasHeldProposal: false, winProbabilities: null, leadingOptionLabel: null, optionLabels: [], winPctByLabel: {}, payloadPercentages: [], ...s },
    userMessage: 'x',
  };
}

describe('production unsupported-claim adapter', () => {
  it('passes clean coaching prose', () => {
    expect(productionUnsupportedClaimChecker(turn('What matters most to you about this decision?'))).toBeNull();
  });

  it('catches a fabricated result reference pre-analysis (state-INDEPENDENT rule)', () => {
    const v = productionUnsupportedClaimChecker(turn('The Monte Carlo simulation shows Plan A wins 62% of the time.'));
    expect(v).toBe('fabricated_result_reference');
  });

  it('catches invented mutation success', () => {
    const v = productionUnsupportedClaimChecker(turn("I've updated the graph and added your new factor."));
    expect(v).toBeTruthy();
  });

  it('returns a closed telemetry-safe TAG, never prose or a label (PII)', () => {
    const v = productionUnsupportedClaimChecker(
      turn('The analysis found that Plan Alpha wins.', { optionLabels: ['Plan Alpha'] }),
    );
    expect(v).toBeTruthy();
    expect(v).toMatch(/^[a-z_]+$/); // snake_case enum only
    expect(v).not.toMatch(/Plan Alpha/);
  });

  it('packFromTurn is conservative: no observed result => freshness none', () => {
    expect(packFromTurn(turn('hi')).freshness).toBe('none');
    expect(packFromTurn(turn('hi')).analysis_present).toBe(false);
  });

  it('packFromTurn marks an observed result present+fresh (disarms state-conditional rules)', () => {
    const p = packFromTurn(turn('Wins 62%.', { payloadPercentages: [62] }));
    expect(p.analysis_present).toBe(true);
    expect(p.freshness).toBe('fresh');
    expect(p.blocked).toBe(false);
  });

  it('does NOT flag ordinary pre-analysis option-weighing (the #450 narrowing holds)', () => {
    expect(
      productionUnsupportedClaimChecker(turn('Plan A is faster but riskier; Plan B is slower and safer. Which matters more?')),
    ).toBeNull();
  });
});
