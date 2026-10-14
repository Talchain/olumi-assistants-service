/**
 * Recovery Batch B, S4 (DL 12 Oct: "FIRST, the 2 FALSE CREDITS"; AIE 0825 §2, "current versus past").
 * Corpus M04 (marketing L36/L41, verbatim): "We have 6 months to launch our new features from last Friday, …" was credited
 * as today's level of "Time to launch". The 6 months is counted from a past day, so it is not today's level of anything.
 * A past anchor in the credited sentence now withholds current-level credit. The figure stays the user's unverified
 * claim, never Olumi's estimate. This was not introduced by V1: the verifier blob is identical at be084b06, e58b8dbd and C head.
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { verifiedFactorLevel } from '../verified-option-setting.js';
import { valueAuthorshipOf } from '../turn-context/guidance-signals.js';

const M04 = 'We have 6 months to launch our new features from last Friday, and that\'s when the initial 3-month sales cycle starts.';
const Q920 = 'Our clinic completes 920 appointments each month.';
function draft(label: string, value: number, unit: string, quote: string): CandidateModel {
  return {
    goal: { metric: 'Overall outcome', value: null, unit: null, operator: '>=', horizon_months: null, provenance: 'explicit' },
    constraints: [], options: [], outcomes: [], risks: [], links: [],
    factors: [{ label, baseline_value: value, unit, baseline_known: true, provenance: 'explicit', role: 'observable',
      plausible_max: value * 10, baseline_evidence: { quote } }],
  } as unknown as CandidateModel;
}
const credits = (d: CandidateModel, brief: string): boolean => verifiedFactorLevel(d, d.factors[0]!, brief);
const stored = (d: CandidateModel, brief: string): string =>
  valueAuthorshipOf((admitCandidateModel(d, {}, brief).nodes.find(n => n.kind === 'factor') as { observed_state?: unknown }).observed_state);

describe('a past anchor withholds current-level credit', () => {
  it('POSITIVE CONTROL (first): the 920 receipt is credited and stored as the user\'s', () => {
    const d = draft('Completed appointments', 920, 'appointments/month', Q920);
    expect(credits(d, Q920)).toBe(true);
    expect(stored(d, Q920)).toBe('yours');
  });
  it('RED at 51a7580 (corpus M04): "6 months … from last Friday" is not today\'s level; it stays the user\'s unverified claim', () => {
    const d = draft('Time to launch', 6, 'months', M04);
    expect(credits(d, M04)).toBe(false);
    expect(stored(d, M04), 'never Olumi\'s estimate').toBe('unknown');
  });
  it('RED at 51a7580: the 920 receipt dated "as of last year" is not today\'s level', () => {
    const q = 'Our clinic completes 920 appointments each month, as of last year.';
    expect(credits(draft('Completed appointments', 920, 'appointments/month', q), q)).toBe(false);
  });
  it('RED at 51a7580: "two years ago" dates it too', () => {
    const q = 'Our clinic completes 920 appointments each month, the same as two years ago.';
    expect(credits(draft('Completed appointments', 920, 'appointments/month', q), q)).toBe(false);
  });
  it('ACCEPTED RESIDUAL (fail closed, no clause parser per AIE 0825): a past comparison in the same sentence also withholds the current figure, which stays the user\'s', () => {
    const q = 'Our clinic completes 920 appointments each month, up from 800 last year.';
    const d = draft('Completed appointments', 920, 'appointments/month', q);
    expect(credits(d, q)).toBe(false);
    expect(stored(d, q)).toBe('unknown');
  });
});
