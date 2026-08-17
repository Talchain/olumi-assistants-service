/**
 * ROADMAP 2.1265 — the CALL-SITE PIN for the blocker/claim mutual-exclusion
 * invariant.
 *
 * ⭐ WHY A PIN AND NOT ANOTHER BEHAVIOURAL TEST. The guard itself is a pure
 * function with 27 tests of its own, all of which stay green if the executor
 * never calls it. A perfect guard nobody invokes is the estate's dominant defect
 * class — machinery that reads as a guarantee and never executes. This file
 * fails when the WIRING is wrong, which is the only thing its siblings cannot
 * see.
 *
 * It reads the executor's SOURCE rather than driving a turn, deliberately:
 * `runTurnExecutor` has 39 `return finalizeRun()` exits and constructing one of
 * them here would prove the guard runs on THAT exit and nothing about the other
 * 38. The three properties below are true of every exit or of none.
 *
 * ⚠ MUTANT OBLIGATION (what must RED): delete the call → property 1 fails; move
 * it above the defaulted-value guard → property 2 fails; pass any graph other
 * than the readiness authority → property 3 fails.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const EXECUTOR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../turn-executor.ts',
);
const source = readFileSync(EXECUTOR, 'utf8');

describe('blocked-slot claim guard — wired at the finaliser chokepoint', () => {
  it('1 · the guard IS CALLED from the finaliser guard block', () => {
    // The definition alone is not the wiring; assert the CALL exists.
    expect(source).toContain(
      "enforceBlockedSlotClaimGuard('turn_executor_finalise');",
    );
    expect(source).toContain(
      "import { applyBlockedSlotClaimGuard } from './compose/blocked-slot-claim-guard.js';",
    );
  });

  it('2 · it runs AFTER every whole-text substitution, including the defaulted-value disclosure', () => {
    // Ordering is load-bearing: a layer that judges text a later guard discards
    // is judging a string no user will read. The sibling guards' own ordering
    // note makes the same argument.
    const call = source.indexOf("enforceBlockedSlotClaimGuard('turn_executor_finalise');");
    const defaulted = source.indexOf(
      "enforceDefaultedValueDisclosureGuard('turn_executor_finalise');",
    );
    const forbidden = source.indexOf(
      "enforceEgressForbiddenPhraseGuard('turn_executor_finalise');",
    );
    const structural = source.indexOf(
      "enforceStructuralSuccessClaimGuard('turn_executor_finalise');",
    );
    for (const earlier of [defaulted, forbidden, structural]) {
      expect(earlier).toBeGreaterThan(-1);
      expect(call).toBeGreaterThan(earlier);
    }
  });

  it('3 · P5 — it is handed the READINESS AUTHORITY, not any other graph', () => {
    // `canonicalReadinessGraphForRun` is the graph `analysisReadyForTurn` was
    // derived from. Handing over a different graph would have the guard decide a
    // contradiction against state the blockers were never computed over — which
    // was MEASURED during development: a reload taken one turn later called the
    // fabricated 12% grounded, because a subsequent wrong-entity write had put it
    // there (trap 16).
    const block = source.slice(
      source.indexOf('const applied = applyBlockedSlotClaimGuard({'),
    );
    const call = block.slice(0, block.indexOf('});') + 3);
    expect(call).toContain('blockers: analysisReadyForTurn?.blockers');
    expect(call).toContain('persistedGraph: canonicalReadinessGraphForRun');
    // And no OTHER graph variable is smuggled in.
    expect(call).not.toContain('context.persistedGraph');
    expect(call).not.toContain('requestGraph');
  });

  it('4 · the guard emits a named telemetry event so a live fabrication is visible', () => {
    // A correction that ships silently is a defect nobody can measure the rate
    // of. Any non-zero count here is a real fabrication that reached egress.
    expect(source).toContain('TelemetryEvents.V5BlockedSlotClaimRefused');
  });
});
