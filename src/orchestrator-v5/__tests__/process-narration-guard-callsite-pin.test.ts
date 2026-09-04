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
 * **three** of them — `:6860 turn_executor`, `:6387 edit_graph` (the
 * `eg.response` exit), and `:2937 chip_click` (the `ok` outcome ONLY).
 *
 * ⚠ THIS HEADER SAID **FOUR** AND NAMED "the two `chip_click` exits", AND
 * THAT WAS WRONG. A second independent review resolved the delegation on the
 * AST: `:2855` is the `handler_recovered` exit, returned out of
 * `dispatchChipClickRunAnalysis` from a catch clause at
 * `chip-click-dispatch.ts:1406`, before the guard at `:1729`. The count is
 * 3 of 24 and the uncovered set is 21. See the guard's docblock in
 * `turn-executor.ts` for the full enumeration, for `:2855`'s reason, and for
 * the exits that carry model-authored prose without it.
 *
 * ⚠ MUTANT OBLIGATION (what must RED): delete any one of the three calls →
 * that site's property fails; move the executor call below the
 * forbidden-phrase guard → the ordering property fails; **relocate the
 * executor call outside `finalizeRun`'s body, preserving guard order** → the
 * containment property fails (property 5 — it did NOT, before this round);
 * drop the telemetry emit at any site → that site's observability property
 * fails.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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

  it('5 · in the executor the guard is INSIDE finalizeRun — AST containment, not an index comparison', () => {
    // The property that makes "every executor exit" true: the call sits in the
    // finaliser BODY, so it cannot be one exit's local decision.
    //
    // ⚠⚠ THE FIRST DRAFT OF THIS PROPERTY COULD NOT OBSERVE ITS OWN
    // VIOLATION, and that was MEASURED rather than argued. It asserted
    // `indexOf(call) > indexOf('function finalizeRun(')` — a POSITIONAL PROXY
    // satisfied by every character after the declaration, including every
    // character after the body ENDS. An independent review relocated the three
    // `enforce*` calls to just past `finalizeRun`'s closing brace, preserving
    // their relative order so the ordering property survived, and this spec
    // stayed 13 passed / 0 failed while the AST confirmed the calls had left
    // the finaliser. That relocation is this rewrite's discriminating mutant.
    //
    // Containment is resolved on the PARSED TREE rather than by counting
    // braces over text, so a brace inside a comment, a string or a `${}`
    // interpolation cannot move the boundary. The parse is local to this test.
    const sf = ts.createSourceFile(
      'turn-executor.ts',
      EXECUTOR,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );

    /** Every `<callee>('turn_executor_finalise')` call node in the file. */
    const callsTo = (callee: string): ts.CallExpression[] => {
      const found: ts.CallExpression[] = [];
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === callee
        ) {
          found.push(node);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return found;
    };

    let finaliser: ts.FunctionDeclaration | undefined;
    const findFinaliser = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'finalizeRun') {
        finaliser = node;
      }
      ts.forEachChild(node, findFinaliser);
    };
    findFinaliser(sf);
    expect(finaliser, 'finalizeRun declaration not found').toBeDefined();
    expect(finaliser?.body, 'finalizeRun has no body').toBeDefined();

    /** Walk parents — exact containment, not a character-offset comparison. */
    const insideFinaliser = (node: ts.Node): boolean => {
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        if (p === finaliser) return true;
      }
      return false;
    };

    // PRECONDITION 1 — exactly one invocation, so a second copy elsewhere in
    // the file cannot satisfy this on behalf of the finaliser's own.
    const guardCalls = callsTo('enforceProcessNarrationGuard');
    expect(guardCalls).toHaveLength(1);

    // THE PROPERTY.
    expect(
      insideFinaliser(guardCalls[0]!),
      'enforceProcessNarrationGuard is not inside finalizeRun',
    ).toBe(true);

    // PRECONDITION 2 — THE DISCRIMINATING TWIN. `insideFinaliser` returning
    // `true` proves nothing on its own: a walk that ran away to the source file
    // would return `true` for every node. `applyProcessNarrationGuard` is
    // called from `enforceProcessNarrationGuard`'s OWN body, which is declared
    // outside `finalizeRun`, so it must read `false`. One assertion proves the
    // containment holds; only the pair proves the test is still discriminating.
    const siblingCalls = callsTo('applyProcessNarrationGuard');
    expect(siblingCalls).toHaveLength(1);
    expect(
      insideFinaliser(siblingCalls[0]!),
      'the containment walk no longer discriminates — it reports a node ' +
        'declared outside finalizeRun as inside it',
    ).toBe(false);
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
