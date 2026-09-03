/**
 * ⭐⭐ THE CALL-SITE PIN for the process-narration egress guard.
 *
 * ⚠ WHY THIS FILE EXISTS, stated as the finding that produced it. An
 * independent review of this change measured that only two specs referenced
 * the guard at all — the unit spec and the telemetry mirror — so **deleting
 * the `edit_graph_finalise` or `chip_click_finalise` block left the whole
 * suite green**. The route spec drives its text through `runTurnExecutor`,
 * while the leak that was actually witnessed (turn 15 of the 3 Sep capture)
 * travelled `edit_graph_default@v11`, i.e. the EDIT-GRAPH path. Two of the
 * three call sites were unpinned, and the one that leaked was among them.
 *
 * A perfect guard nobody invokes is the estate's dominant defect class —
 * machinery that reads as a guarantee and never executes
 * (`blocked-slot-claim-guard-callsite-pin.test.ts` makes the same argument for
 * its own guard, and this file follows its mechanism deliberately).
 *
 * It reads the three dispatch modules' SOURCE rather than driving a turn, for
 * the reason that sibling states: `runTurnExecutor` has dozens of
 * `finalizeRun()` exits and constructing one of them here would prove the
 * guard runs on THAT exit and nothing about the others. The properties below
 * are true of every exit of a given dispatch family, or of none.
 *
 * ⚠ SCOPE — WHAT THIS FILE DOES **NOT** CLAIM. It pins the three call sites
 * that exist. It is NOT evidence that those three cover every 200-OK exit:
 * `route-v2.ts` has 24 `sendFinalised200` exits and this guard is reachable on
 * four of them (`turn_executor`, the `eg.response` edit exit, and the two
 * `chip_click` exits). See the guard's docblock in `turn-executor.ts` for the
 * enumeration and for the exits that carry model-authored prose without it.
 *
 * ⚠ MUTANT OBLIGATION (what must RED): delete any one of the three calls →
 * that site's property fails; move the executor call below the
 * forbidden-phrase guard → the ordering property fails; drop the telemetry
 * emit at any site → that site's observability property fails.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), 'utf8');

const EXECUTOR = read('../turn-executor.ts');
const EDIT_GRAPH = read('../handlers/edit-graph-dispatch.ts');
const CHIP_CLICK = read('../handlers/chip-click-dispatch.ts');

/**
 * The three dispatch families that invoke the guard, and the `dispatch_path`
 * literal each one reports. Derived once here so a fourth site added later is
 * a one-line addition rather than a fourth copy of three assertions.
 */
const CALL_SITES: ReadonlyArray<readonly [string, string, string]> = [
  ['turn-executor', EXECUTOR, 'turn_executor_finalise'],
  ['edit-graph-dispatch', EDIT_GRAPH, 'edit_graph_finalise'],
  ['chip-click-dispatch', CHIP_CLICK, 'chip_click_finalise'],
];

describe('process-narration guard — wired at all three dispatch finalisers', () => {
  it.each(CALL_SITES)(
    '1 · %s IMPORTS the guard and CALLS it — the definition is not the wiring',
    (_name, source, _path) => {
      expect(source).toContain('applyProcessNarrationGuard');
      // The import, so a same-named local helper cannot satisfy this.
      expect(source).toMatch(
        /import \{ applyProcessNarrationGuard \} from '\.[./]*\/?(?:compose\/)?process-narration\.js';/,
      );
      // An actual invocation, not merely the symbol in a comment.
      expect(source).toMatch(/applyProcessNarrationGuard\(/);
    },
  );

  it.each(CALL_SITES)(
    '2 · %s reports its own dispatch_path, so a live leak is attributable',
    (_name, source, path) => {
      // Without the path literal the telemetry cannot tell which finaliser
      // fired, and the two unpinned sites would be invisible in production
      // exactly as they were invisible to the suite.
      expect(source).toContain('TelemetryEvents.V5EgressProcessNarrationDetected');
      expect(source).toContain(`dispatch_path: '${path}'`);
    },
  );

  it.each(CALL_SITES)(
    '3 · %s WRITES the guarded text back — a guard whose result is discarded is theatre',
    (_name, source, _path) => {
      // The whole point is the substitution. Computing `guarded` and not
      // assigning it would pass properties 1 and 2 and ship the monologue.
      //
      // ⚠ THE WINDOW IS BOUND BY IDENTITY, AND THE FIRST DRAFT WAS NOT —
      // MEASURED, not guessed. A fixed `call + 1600` window overran into the
      // sibling forbidden-phrase guard, which binds its own result to a
      // variable of the SAME NAME (`guarded`) and writes the same field. So a
      // mutant that discarded THIS guard's result stayed GREEN, satisfied by a
      // different object (CLAUDE.md trap 19). The window now ends where the
      // next guard begins.
      const call = source.indexOf('applyProcessNarrationGuard(');
      expect(call).toBeGreaterThan(-1);
      const nextGuard = source.indexOf('applyEgressForbiddenPhraseGuard(', call);
      const end = nextGuard > call ? nextGuard : call + 1600;
      const block = source.slice(call, end);
      // The write-back belongs to THIS guard's block, not to a later one.
      expect(block).toMatch(/assistant_text: guarded\.text/);
    },
  );

  it('4 · in the executor it runs FIRST of the prose guards — ordering is load-bearing', () => {
    // It is the only guard that can substitute the WHOLE reply with copy of
    // its own, so it must run ahead of the guards that judge copy; otherwise
    // its replacement bypasses them. The converse — that the fallback carries
    // no forbidden phrase, leader claim or success claim — is pinned in
    // `compose/__tests__/process-narration.test.ts`.
    const narration = EXECUTOR.indexOf(
      "enforceProcessNarrationGuard('turn_executor_finalise');",
    );
    expect(narration).toBeGreaterThan(-1);
    for (const later of [
      "enforceWithheldLeaderClaimGuard('turn_executor_finalise');",
      "enforceEgressForbiddenPhraseGuard('turn_executor_finalise');",
    ]) {
      const at = EXECUTOR.indexOf(later);
      expect(at, `${later} not found`).toBeGreaterThan(-1);
      expect(narration).toBeLessThan(at);
    }
  });

  it('5 · in the executor the guard is INSIDE finalizeRun, not on one exit path', () => {
    // The property that makes "every executor exit" true: the call sits in the
    // finaliser body, so it cannot be one exit's local decision.
    const finaliser = EXECUTOR.indexOf('function finalizeRun(');
    expect(finaliser).toBeGreaterThan(-1);
    const call = EXECUTOR.indexOf(
      "enforceProcessNarrationGuard('turn_executor_finalise');",
    );
    expect(call).toBeGreaterThan(finaliser);
  });

  it.each([
    ['edit-graph-dispatch', EDIT_GRAPH],
    ['chip-click-dispatch', CHIP_CLICK],
  ])(
    '6 · %s runs the guard BEFORE its forbidden-phrase guard, matching the executor',
    (_name, source) => {
      // Same ordering argument, pinned at the two sites the review found
      // unpinned. Both dispatchers apply the forbidden-phrase guard at their
      // own finaliser; the narration guard must precede it there too.
      const narration = source.indexOf('applyProcessNarrationGuard(');
      const forbidden = source.indexOf('applyEgressForbiddenPhraseGuard(');
      expect(narration).toBeGreaterThan(-1);
      expect(forbidden).toBeGreaterThan(-1);
      expect(narration).toBeLessThan(forbidden);
    },
  );
});
