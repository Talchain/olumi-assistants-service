/**
 * V5 TURN FENCE — a refusal must NOT arrive as HTTP 500. (#759 review, A2.)
 *
 * Nothing caught `TurnFenceRejectedError`. The complete manifest at the time was
 * its definition and its single throw site — so every fence refusal fell through
 * to the generic commit catch, became `STATE_COMMIT_FAILED` → `INTERNAL_ERROR`,
 * and reached the client as a **500**. "You stopped this turn" as a server error:
 * unactionable for the UI, and permanent noise for whoever watches the error
 * rate. The `GraphStaleWriteError` branch three lines below the fix carries a
 * comment forbidding exactly this flattening for the CAS conflict; a fence
 * refusal has the same shape.
 *
 * This pins the mapping WITHOUT booting a turn: driving a real 50-second turn to
 * its commit in a unit test would need the whole LLM + Supabase surface mocked,
 * and the thing under test is one `instanceof` branch and the envelope it
 * builds. So the pins are:
 *   1. the error class is what the store actually throws (imported, not restated);
 *   2. `GRAPH_WRITE_CONFLICT` maps to a 409-class wire code, never INTERNAL_ERROR;
 *   3. the branch exists in the executor's commit catch, ahead of the generic
 *      `STATE_COMMIT_FAILED` fallback, and carries `fence_verdict`;
 *   4. every verdict has a recovery_action, so no verdict reaches the wire mute.
 *
 * ⚠⚠ EVERY PIN IN THIS FILE IS SOURCE-TEXT ONLY, AND THAT IS WEAKER THAN I FIRST
 *    ADMITTED. My original note said "weaker than executing the branch" and then
 *    relied on it anyway. The #759 round-2 review measured the gap: it neutered the
 *    branch with `if (false && error instanceof TurnFenceRejectedError)` — source
 *    text fully intact — and this file stayed GREEN, twice, reproducibly. `toContain`
 *    cannot see a dead branch. A guarantee asserted against source text is not a
 *    guarantee about behaviour.
 *
 *    THE LOAD-BEARING PIN IS NOW ELSEWHERE:
 *    `tests/integration/orchestrate-v2-fail-closed.test.ts` drives a REAL turn
 *    through `app.inject` and asserts the REAL response is 409 + GRAPH_DIVERGED +
 *    `fence_verdict` + `recovery_action`, for a user-facing verdict (`stopped`) and
 *    an infrastructure one (`unavailable`). Under the same neuter it REDs with
 *    `expected 500 to be 409`.
 *
 *    These tests stay because they pin things the runtime test cannot see cheaply —
 *    branch ORDER relative to the generic fallback, and the wire-map entry itself —
 *    but they are DEFENCE IN DEPTH, not the guarantee. Do not add a behavioural
 *    claim to this file; add it to the integration suite.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TurnFenceRejectedError } from '../session/turn-fence.js';
import { StateCommitFailedError } from '../session/store.js';
import { INTERNAL_TO_WIRE } from '../types.js';

const EXECUTOR = readFileSync(
  fileURLToPath(new URL('../turn-executor.ts', import.meta.url)),
  'utf8',
);

describe('the refusal is a typed conflict, not an internal error', () => {
  it('TurnFenceRejectedError still rides the typed commit-failure family', () => {
    const err = new TurnFenceRejectedError('refused', {
      verdict: 'stopped',
      generation: 1,
      maxGeneration: 2,
    });
    expect(err).toBeInstanceOf(StateCommitFailedError);
    expect(err.verdict).toBe('stopped');
    expect(err.name).toBe('TurnFenceRejectedError');
  });

  it('GRAPH_WRITE_CONFLICT maps to a 409-class wire code, never INTERNAL_ERROR', () => {
    const wire = INTERNAL_TO_WIRE.GRAPH_WRITE_CONFLICT;
    expect(wire).toBe('GRAPH_DIVERGED');
    expect(wire).not.toBe('INTERNAL_ERROR');
    // And the flattening target is a DIFFERENT code, so the two cannot converge
    // by someone "simplifying" the map.
    expect(INTERNAL_TO_WIRE.STATE_COMMIT_FAILED).not.toBe(wire);
  });

  it('the executor catches TurnFenceRejectedError BEFORE the generic fallback (the A2 STEP-7 branch)', () => {
    // 2.301 hoist: the first `instanceof TurnFenceRejectedError` in the file
    // is now the commitTurn CAPTURE seam, so the A2 branch is anchored by its
    // amendment marker rather than by first occurrence — the exact
    // wrong-pair-measurement hazard the note below already recorded once.
    const a2At = EXECUTOR.indexOf('AMENDMENT A2');
    expect(a2At, 'the A2 amendment marker must exist').toBeGreaterThan(-1);
    const fenceAt = EXECUTOR.indexOf('error instanceof TurnFenceRejectedError', a2At);
    const staleAt = EXECUTOR.indexOf('error instanceof GraphStaleWriteError', a2At);
    expect(fenceAt, 'the fence branch must exist').toBeGreaterThan(-1);
    expect(staleAt, 'the CAS branch must still exist').toBeGreaterThan(-1);
    // The COMMIT catch's own fallback — the first STATE_COMMIT_FAILED after the
    // CAS branch. Deliberately not `indexOf` from 0: this file has dozens of
    // them and the first belongs to an entirely different catch block, which is
    // exactly the false comparison my first version of this assertion made (it
    // "failed" by measuring the wrong pair, and the fix is a narrower search,
    // not a looser assertion).
    const flattenAt = EXECUTOR.indexOf('INTERNAL_TO_WIRE.STATE_COMMIT_FAILED', staleAt);
    expect(flattenAt, 'the commit catch keeps its generic fallback').toBeGreaterThan(-1);
    // Ordering is the load-bearing part: a branch AFTER the generic fallback is
    // dead code that reads as a fix.
    expect(fenceAt).toBeLessThan(staleAt);
    expect(fenceAt).toBeLessThan(flattenAt);
  });

  it('the A2 branch carries the machine-readable verdict and a per-verdict remedy', () => {
    const a2At = EXECUTOR.indexOf('AMENDMENT A2');
    const branch = EXECUTOR.slice(
      EXECUTOR.indexOf('error instanceof TurnFenceRejectedError', a2At),
      EXECUTOR.indexOf('error instanceof GraphStaleWriteError', a2At),
    );
    expect(branch).toContain("'GRAPH_WRITE_CONFLICT'");
    expect(branch).toContain('fence_verdict: error.verdict');
    // Every verdict the classifier can produce needs a remedy, or one of them
    // reaches the UI with nothing to offer the user.
    expect(branch).toContain("'start_new_draft'"); // stopped
    expect(branch).toContain("'refresh_and_reconfirm'"); // superseded
    expect(branch).toContain("'retry_later'"); // unclaimed / unavailable
  });

  // ── ROADMAP 2.301 — the HOISTED mapping seams (source-text defence in
  //    depth; the BEHAVIOURAL guarantee is
  //    tests/integration/turn-fence-hoisted-conflict-mapping.test.ts, which
  //    REDs `expected 500 to be 409` on a non-A2 path when either seam is
  //    neutered) ──────────────────────────────────────────────────────────
  it('commitTurn captures typed conflicts for the finalise remap (the hoist capture seam)', () => {
    const captureAt = EXECUTOR.indexOf('lastCommitConflictError = error');
    expect(captureAt, 'the capture assignment must exist').toBeGreaterThan(-1);
    // Reset-per-attempt is what stops a retried commit inheriting a stale
    // conflict — the capture without the reset would be a latent mismap.
    expect(EXECUTOR).toContain('lastCommitConflictError = null');
  });

  it('finalizeRun remaps ONLY the STATE_COMMIT_FAILED flattening, with per-verdict remedies (the hoist remap seam)', () => {
    const remapAt = EXECUTOR.indexOf(
      'failureType === INTERNAL_TO_WIRE.STATE_COMMIT_FAILED &&',
    );
    expect(remapAt, 'the remap guard must exist').toBeGreaterThan(-1);
    const remapBlock = EXECUTOR.slice(remapAt, remapAt + 3000);
    expect(remapBlock).toContain('lastCommitConflictError !== null');
    expect(remapBlock).toContain("'GRAPH_WRITE_CONFLICT'");
    expect(remapBlock).toContain('fence_verdict: conflict.verdict');
    expect(remapBlock).toContain("'start_new_draft'"); // stopped
    expect(remapBlock).toContain("'refresh_and_reconfirm'"); // superseded
    expect(remapBlock).toContain("'retry_later'"); // unclaimed / unavailable
  });

  it('route-v2 forwards fence_verdict onto the 409 envelope (via the A-2 derived manifest)', () => {
    // Without this the three verdicts collapse into one opaque conflict at the
    // boundary and the UI cannot tell "you stopped this" from "someone else owns
    // the scenario now".
    //
    // A-2 changed the MECHANISM this pin must watch: the extractor no longer
    // hand-copies `fence_verdict` — it derives its copy loop from
    // `GRAPH_CONFLICT_RECOVERY_KEYS`. So the pin is now two halves:
    // the extractor derives from the manifest, AND the manifest carries the
    // key. (The RUNTIME guarantee — a real 409 carrying fence_verdict — is
    // `tests/integration/orchestrate-v2-fail-closed.test.ts`, as the file
    // header says; this stays defence in depth.)
    const routeV2 = readFileSync(
      fileURLToPath(new URL('../../orchestrator/route-v2.ts', import.meta.url)),
      'utf8',
    );
    expect(routeV2).toContain('for (const key of GRAPH_CONFLICT_RECOVERY_KEYS)');
    const manifest = readFileSync(
      fileURLToPath(new URL('../graph-conflict-recovery-keys.ts', import.meta.url)),
      'utf8',
    );
    expect(manifest).toContain("'fence_verdict'");
  });
});
