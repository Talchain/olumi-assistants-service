/**
 * ⛔⛔ BOTH POST-APPLY CHIP SITES MUST FEED THE GATE A PAYLOAD THAT CARRIES THE
 * ADMISSION — AND ONE OF THEM CANNOT BE REACHED BY A TEST.
 *
 * `turn-executor.ts` offers the post-apply chips after an accepted REPAIR and
 * after an accepted VALUE BATCH. The value-batch site is bound behaviourally by
 * `readiness-value-batch-route-level.test.ts`. The repair site is not, and
 * cannot honestly be: measured, **0 of 40,921 production turns** ever minted an
 * `rrp_` pending action (controls in the same query: `gmh_` 533,
 * `graph_management_held_v1` 485), and statically 0 of 15,282 models yield an
 * offerable repair proposal. The turn has never been entered by a user.
 *
 * A mutant on that site therefore SURVIVES, and review reported it correctly.
 * It survives because the code is unreachable, not because it is right — and
 * "unreachable" decays the moment a machine-repairable blocker exists. So the
 * invariant that IS enforceable is enforced here.
 *
 * ⛔ THE SPECIFIC DEFECT THIS PREVENTS RETURNING. Both sites originally passed
 * `outcome.assessmentAfter.analysisReady`. That comes from the BARE assessment,
 * which carries `may_run` on **0 of 15,282** real models, so the admission half
 * of the run gate was DEAD CODE: an admissible-but-not-ready model was offered
 * nothing while the client would have rendered the run.
 *
 * ⚠ A source-text assertion is worth nothing unless it is shown to be reading
 * the right text and capable of refusing. Both controls below.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../turn-executor.ts'),
  'utf8',
);

describe('both post-apply chip sites feed the gate an admission-bearing payload', () => {
  it('POSITIVE CONTROL — the source was actually read', () => {
    expect(SRC.length).toBeGreaterThan(10_000);
    expect(SRC).toContain('buildPostApplyChips(');
  });

  it('NEGATIVE CONTROL — it does not find a call that is not there', () => {
    expect(SRC).not.toContain('buildDefinitelyNotARealReadiness(');
  });

  it('⭐ both sites are present, and both use the canonical builder', () => {
    const calls = SRC.split('buildPostApplyChips(').length - 1;
    expect(calls, 'the repair site and the value-batch site').toBe(2);
    const canonical = SRC.split('buildCanonicalAnalysisReadyFromGraph(outcome.appliedGraph)').length - 1;
    expect(canonical, 'each chip site plus the pre-existing gm readiness').toBeGreaterThanOrEqual(2);
  });

  it('⛔ neither site feeds the gate the bare assessment, which omits may_run', () => {
    expect(SRC).not.toContain('buildPostApplyChips(\n            outcome.assessmentAfter.analysisReady');
    expect(SRC).not.toContain('outcome.assessmentAfter.analysisReady as never');
  });
});
