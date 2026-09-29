/**
 * ⛔⛔ BOTH POST-APPLY SITES MUST USE THE SAME PRODUCER — AND ONE OF THEM
 * CANNOT BE REACHED BY A TEST.
 *
 * `turn-executor.ts` sets the turn's readiness after an applied REPAIR and
 * after an applied VALUE BATCH. The value-batch site is bound behaviourally by
 * `readiness-value-batch-route-level.test.ts`. The repair site is NOT, and it
 * cannot honestly be: measured over 400 real persisted models, **0** produce a
 * repair proposal with any actionable `changes` (all 520 blocking issues are
 * `repairability: 'human_input_required'`), so `buildReadinessRepairOffer`
 * never returns an offer and the accepted-repair turn is never entered.
 *
 * Independent review correctly reported that mutant as SURVIVING. It survives
 * because the code is unreachable, not because the change is wrong — and
 * "unreachable" is a claim that decays the moment a machine-repairable blocker
 * exists. So the invariant that IS enforceable is enforced here: the two sites
 * must not drift into two spellings.
 *
 * ⚠ THIS IS A SOURCE-TEXT ASSERTION, which is worth nothing unless it is shown
 * to be reading the right text and capable of saying no. Both controls below.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../turn-executor.ts'),
  'utf8',
);

const CANONICAL_CALL = 'buildCanonicalAnalysisReadyFromGraph(committed.persistedGraph)';

describe('the two post-apply readiness sites keep ONE spelling', () => {
  it('POSITIVE CONTROL — the source was actually read', () => {
    expect(SRC.length).toBeGreaterThan(10_000);
    expect(SRC).toContain('analysisReadyForTurn');
  });

  it('NEGATIVE CONTROL — it does not find a call that is not there', () => {
    expect(SRC).not.toContain('buildDefinitelyNotARealReadiness(');
  });

  it('⭐ both sites use the canonical builder, which is the one that carries may_run', () => {
    const uses = SRC.split(CANONICAL_CALL).length - 1;
    expect(uses, 'both the repair and value-batch readbacks').toBe(2);
  });

  it('⛔ neither site reads back through the bare assessment, which omits may_run', () => {
    expect(SRC).not.toContain('assessCanonicalAnalysisReadiness(committed.persistedGraph)');
  });
});
