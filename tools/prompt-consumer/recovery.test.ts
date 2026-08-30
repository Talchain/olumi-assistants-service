import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { recoveryExamples, runRecoveryProbe, runRecoveryProbes, runRecoveryMutations } from './recovery.js';
const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => expect(collected).toEqual(['all-examples', 'no-change', 'mutations']));
describe('generated recovery ask → actual binder → canonical operation', () => {
  it('executes every canonical advertised example and the no-change opposite', () => {
    collected.push('all-examples');
    const results = runRecoveryProbes();
    expect(results).toHaveLength(recoveryExamples().length + 1);
    expect(results.every(r => r.status === 'PASS'), JSON.stringify(results)).toBe(true);
    expect(results.every(r => r.participation.identity.status === 'UNVERIFIED')).toBe(true);
  });
  it('zero remains a numeric write while no-change never becomes one', () => {
    collected.push('no-change');
    expect(runRecoveryProbe('0%').status).toBe('PASS');
    expect(runRecoveryProbe('no change').status).toBe('PASS');
    expect(runRecoveryProbe('no change', 'zero-for-no-change').status).toBe('FAIL');
  });
  it('the same semantic verifier rejects a wrong owner but accepts unrelated context', () => {
    collected.push('mutations');
    expect(runRecoveryMutations().status).toBe('PASS');
  });
});
