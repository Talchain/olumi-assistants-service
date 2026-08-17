/**
 * ⭐⭐ ROADMAP 2.1265 (D2) — the guard is WIRED at the `finalizeRun` chokepoint,
 * in the right place in the chain.
 *
 * WHY THIS FILE EXISTS, stated honestly. The predicate is unit-pinned against
 * the wire bytes (`compose/__tests__/missing-value-claim-guard.test.ts`), and a
 * correct predicate that nothing calls is this estate's dominant defect. The
 * ideal evidence is a behavioural test through `runTurnExecutor`; the measured
 * reason there is not one here is recorded below rather than left implied.
 *
 * ⚠⚠ WHAT WAS MEASURED, AND WHY IT MATTERS BEYOND THIS TEST. A behavioural
 * replay WAS written and run. On that harness the witnessed fabrication never
 * reaches the finaliser at all: the **coaching output post-check** degrades any
 * model-state claim to *"No analysis has been run on your model yet…"* at
 * COMPOSE time, upstream of every finaliser guard, whenever the coaching pack's
 * freshness verdict is `none`. Supplying a request-side `analysis_state` and a
 * prior `run_analysis` fact did not move that verdict in the harness, so every
 * assertion in that file would have passed (or failed) for reasons that have
 * nothing to do with this guard — a test that cannot discriminate is not a test
 * (trap 13b), so it was deleted rather than kept green.
 *
 * ⭐ AND THE FINDING THAT FALLS OUT OF IT, which is the useful part: there are
 * TWO containment layers on this class of claim, and the witnessed leak got past
 * the upstream one because the live turn's coaching pack DID have an analysis
 * (the #999 auto-run fact at 09:28:03Z, `run_state: complete_current`). So the
 * fabrication is contained when no analysis exists and was NOT contained when
 * one did — which is exactly the state a repair conversation is in. This guard
 * covers the state the upstream layer stands down on.
 *
 * ⚠ DECLARED GAP: no executed test in this lane exercises the guard through the
 * real executor. This pin proves the CALL SITE and its ORDER; it does not prove
 * the runtime behaviour of the composed chain. A route-level witness on staging
 * is the evidence that closes it.
 *
 * Pattern and comment-stripping mechanism follow the estate's existing callsite
 * pin (`tests/unit/orchestrator-v5/context/anti-rederivation-callsite-pin.test.ts`).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { stripComments } from '../../../scripts/ci/strip-source-comments.mjs';

const TURN_EXECUTOR = stripComments(
  readFileSync(new URL('../turn-executor.ts', import.meta.url), 'utf8'),
) as string;

const GUARD_CALL = "enforceMissingValueClaimGuard('turn_executor_finalise')";
const LEADER_CALL = "enforceWithheldLeaderClaimGuard('turn_executor_finalise')";
const FORBIDDEN_CALL = "enforceEgressForbiddenPhraseGuard('turn_executor_finalise')";
const STRUCTURAL_CALL = "enforceStructuralSuccessClaimGuard('turn_executor_finalise')";

describe('2.1265 — the missing-value claim guard is armed on every executor exit', () => {
  it('is invoked in the finaliser chain (comment-stripped, so a doc mention cannot satisfy it)', () => {
    expect(TURN_EXECUTOR).toContain(GUARD_CALL);
    // Exactly one call site: the chokepoint. A second would mean a per-path
    // hook crept back in, which is the geometry this placement replaces.
    expect(TURN_EXECUTOR.split(GUARD_CALL).length - 1).toBe(1);
  });

  it('the guard the pin is about actually exists as a function in this file', () => {
    // POSITIVE CONTROL — without this, the pin would still pass on a file that
    // merely mentioned the identifier in a string.
    expect(TURN_EXECUTOR).toContain('function enforceMissingValueClaimGuard(');
    expect(TURN_EXECUTOR).toContain("from './compose/missing-value-claim-guard.js'");
  });

  it('ORDER: after the leader-claim guard, before the forbidden-phrase and structural-success guards', () => {
    // The ordering argument is load-bearing, so it is pinned rather than left in
    // a comment: this guard performs a WHOLE-TEXT substitution, and its
    // replacement copy must itself be swept by the two guards below rather than
    // bypassing them.
    const guardAt = TURN_EXECUTOR.indexOf(GUARD_CALL);
    const leaderAt = TURN_EXECUTOR.indexOf(LEADER_CALL);
    const forbiddenAt = TURN_EXECUTOR.indexOf(FORBIDDEN_CALL);
    const structuralAt = TURN_EXECUTOR.indexOf(STRUCTURAL_CALL);
    // CONTRAST CONTROL — every anchor must be present, or an index of -1 would
    // silently satisfy the comparisons (trap 13e: a probe that finds nothing
    // agrees with every other probe that finds nothing).
    for (const [name, at] of [
      ['guard', guardAt],
      ['leader', leaderAt],
      ['forbidden', forbiddenAt],
      ['structural', structuralAt],
    ] as const) {
      expect(at, `${name} call site must be present`).toBeGreaterThan(-1);
    }
    expect(leaderAt).toBeLessThan(guardAt);
    expect(guardAt).toBeLessThan(forbiddenAt);
    expect(guardAt).toBeLessThan(structuralAt);
  });
});
