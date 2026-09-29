import { describe, expect, it } from 'vitest';
import { optionParticipationForExecutedRun, readStoredOptionParticipation } from '../run-option-participation.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440079';
const HASH = '7b53bf0ada890991';
const result = { computed_against_hash: HASH };
const state = (computed_at: string, kind = 'complete_current') => ({ run_state: { kind, computed_at } });
const EXCLUDED = [{ option_id: 'suggested', state: 'excluded_olumi_proposed' }];

describe('selected Run participation binding', () => {
  it('carries the recorded array, including [], only for this exact Run', () => {
    const runState = state('2026-09-29T13:00:00.000Z');
    for (const participation of [EXCLUDED, []]) {
      expect(optionParticipationForExecutedRun(SCENARIO, result, runState, {
        analysis_result: result, analysis_state: runState, option_participation: participation,
      })).toEqual(participation);
    }
    expect(optionParticipationForExecutedRun(SCENARIO, result, runState, {
      analysis_result: result, analysis_state: state('2026-09-29T13:01:00.000Z'), option_participation: EXCLUDED,
    })).toBeUndefined(); // another Run of the same graph cannot lend its fact
  });

  it('stale, unrecorded, and contradictory records fail closed', () => {
    const runState = state('2026-09-29T13:00:00.000Z');
    expect(optionParticipationForExecutedRun(SCENARIO, result, runState, {
      analysis_result: result, analysis_state: state('2026-09-29T13:00:00.000Z', 'complete_stale'), option_participation: EXCLUDED,
    })).toBeUndefined();
    expect(optionParticipationForExecutedRun(SCENARIO, result, runState, {
      analysis_result: result, analysis_state: runState,
    })).toBeUndefined();
    expect(readStoredOptionParticipation([
      EXCLUDED[0], { option_id: 'suggested', state: 'kept_olumi_provisional' },
    ])).toBeUndefined();
    expect(readStoredOptionParticipation([])).toEqual([]);
  });
});
