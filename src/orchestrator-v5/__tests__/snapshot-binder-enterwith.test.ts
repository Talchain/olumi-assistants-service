/**
 * THE SHIPPED BINDER IS `enterWith`, AND UNTIL NOW NOTHING TESTED IT.
 *
 * Production calls `bindAnalysisSnapshotForTurn` -> `storage.enterWith(...)`
 * (`run-analysis-snapshot-binding.ts:148-150`). Every pre-existing test used
 * `runWithBoundAnalysisSnapshot` -> `storage.run(...)`, which has DIFFERENT
 * propagation semantics. So the one function with the risky semantics had zero
 * coverage — flagged by independent review.
 *
 * ⚠ WHY THIS MATTERS MORE THAN USUAL. A leak here is a FALSE REFUSAL: a turn
 *   inheriting another turn's expected hash would refuse an analysis on which
 *   nothing raced. That is the worst failure mode of this guard, because it is
 *   invisible in the happy path and only appears under concurrency.
 *
 * ⚠ AND IT IS NODE-VERSION FRAGILE. `package.json` allows `node >= 20`; Node 24
 *   makes AsyncContextFrame the default ALS implementation, which changes
 *   `enterWith` propagation. These assertions are the tripwire for that.
 */
import { describe, it, expect } from 'vitest';

import {
  bindAnalysisSnapshotForTurn,
  currentBoundAnalysisSnapshot,
} from '../run-analysis-snapshot-binding.js';

const snapshot = (id: string) => ({ scenarioId: id, analysisGraphHash: `hash-${id}` });

/** One "turn": bind, then do async work, and report what it sees afterwards. */
async function turn(id: string): Promise<string | undefined> {
  bindAnalysisSnapshotForTurn(snapshot(id));
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 1));
  return currentBoundAnalysisSnapshot()?.scenarioId;
}

describe('bindAnalysisSnapshotForTurn (the SHIPPED binder, via enterWith)', () => {
  // ⚠ MUST BE FIRST. `enterWith` binds the CURRENT context and every
  //   continuation of it, so once any test in this file has bound, a later
  //   bare read in the same lineage inherits it. Declared first so this
  //   assertion measures an unbound process, not leftovers from its siblings.
  it('an unbound caller sees NO CLAIM, so non-turn paths are unchanged', () => {
    expect(currentBoundAnalysisSnapshot()).toBeUndefined();
  });

  it('the binding survives later awaits in the same turn', async () => {
    expect(await turn('scenario-a')).toBe('scenario-a');
  });

  it('CONCURRENT turns each see their OWN snapshot, never each other\'s', async () => {
    const [a, b, c] = await Promise.all([turn('a'), turn('b'), turn('c')]);
    expect({ a, b, c }).toEqual({ a: 'a', b: 'b', c: 'c' });
  });

  it('SEQUENTIAL turns do not inherit the previous turn\'s snapshot', async () => {
    expect(await turn('first')).toBe('first');
    expect(await turn('second')).toBe('second');
    expect(await turn('third')).toBe('third');
  });

  /**
   * ⛔ CHARACTERISATION, NOT AN ENDORSEMENT — the invariant production relies on.
   *
   * `enterWith` binds the current context AND its continuations, so a binding
   * DOES outlive the "turn" that set it within the same lineage. Measured here
   * rather than assumed, because it is the property that would bite if the
   * shape of the call site ever changed.
   *
   * ⚠ WHY PRODUCTION IS SAFE TODAY, AND WHAT WOULD BREAK IT. `runTurnExecutor`
   *   has exactly ONE call site (`route-v2.ts`), and route-v2 schedules no
   *   deferred work after it — so nothing runs in the leaked continuation. That
   *   is an UNGUARDED invariant: adding a second call site, or any post-turn
   *   deferred work on that path, would let one turn inherit another turn's
   *   expected hash and REFUSE an analysis on which nothing raced.
   *
   *   The isolation tests above show the case that actually matters —
   *   concurrent and sequential turns that each bind do NOT cross-contaminate.
   */
  it('CHARACTERISATION — a binding outlives its turn within the same lineage', async () => {
    await turn('lineage-owner');
    // No bind of our own here: we are a continuation of the turn above.
    expect(
      currentBoundAnalysisSnapshot()?.scenarioId,
      'if this ever becomes undefined the ALS semantics changed — re-check the ' +
        'single-call-site assumption before relying on it',
    ).toBe('lineage-owner');
  });
});
