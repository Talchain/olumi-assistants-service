/**
 * T1 claim safety, LAYER 3 — FAIL-LOUD drift guard on the egress permission.
 *
 * `EgressSanitiseOpts.mayNameLeadingOption` is REQUIRED, so the type checker
 * already catches a `sanitiseOlumiResponseForEgress` call that omits it. What
 * tsc CANNOT catch is a `sendFinalised200` ctx that omits it, because a new
 * dispatch family added later would simply fail to compile once — and the
 * cheapest way to make that error go away is to pass a hardcoded `true`,
 * silently disarming the guard for that whole family.
 *
 * So this guard asserts the marking exists AT EVERY EXIT, from SOURCE.
 *
 * ⚠ AND THE COMPANION ASSERTION HAS BEEN INVERTED (ROADMAP 1.233 finish-line
 * criterion 2, 2026-07-28). It used to RECORD which exits pass a literal
 * `true`, "the shape a future reader must be able to audit at a glance rather
 * than discover by reading nineteen call sites" — a guard that catalogued the
 * defect instead of rejecting it. Sixteen exits sat in that catalogue, each
 * asserting "this path runs no analysis, so it withheld no claim", and that
 * premise is false: the permission belongs to the fact the response DISPLAYS,
 * not to the work the turn performed. It now asserts NO exit may pass a
 * literal at all — `false` included, since a blanket `false` over-suppresses
 * just as silently. The audit-at-a-glance property survives: the answer is
 * "none", derived, rather than a list to keep in sync.
 *
 * DERIVE-NOT-MIRROR (CLAUDE.md trap #12): this test does NOT hand-list the exit
 * paths. It ENUMERATES every `sendFinalised200(...)` CALL in route-v2.ts from
 * source (balanced-paren scan, same technique as
 * `route-egress-functional-marking.drift.test.ts`, which it is modelled on) and
 * asserts each one's ctx declares `mayNameLeadingOption`. A NEW dispatch family
 * added without the mark appears here immediately. There is no list to fall out
 * of sync with.
 *
 * WHY A SOURCE SCAN AND NOT RUNTIME BRANCHING: the alternative — having the
 * guard detect its own absence at runtime — means shipping a code path whose
 * only job is to notice a programming error, on every request, forever. CI is
 * the right place to enforce a property of the source.
 *
 * POSITIVE CONTROL: the final test feeds the detector a fixture call with NO
 * `mayNameLeadingOption` and asserts it is FLAGGED, then a marked fixture and
 * asserts it is NOT — proving the assertion above can actually SEE an unmarked
 * call in both directions rather than being vacuously green.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_V2 = resolve(HERE, '../../orchestrator/route-v2.ts');
const OUTPUT_SAFETY = resolve(HERE, '../compose/output-safety.ts');
const CHIP_CLICK_DISPATCH = resolve(HERE, '../handlers/chip-click-dispatch.ts');
const TURN_EXECUTOR = resolve(HERE, '../turn-executor.ts');

interface SendCall {
  readonly offset: number;
  readonly argSpan: string;
  /**
   * ctx STATES the permission — either by naming the field explicitly, or by
   * inheriting it from the turn-entry resolver.
   *
   * ⚠ THE SECOND FORM IS NEW (ROADMAP 1.233 finish-line criterion 2). Sixteen
   * exits used to name the field and pass a literal `true`; they now spread
   * `...(await claimSafety.forExit())`, which supplies the boolean AND its
   * provenance together. Widening the detector here is NOT a weakening — the
   * companion assertion below went from "record which exits pass a literal" to
   * "NO exit may pass a literal", which is strictly stronger than what this
   * file enforced before.
   */
  readonly marked: boolean;
  /**
   * ctx passes a LITERAL permission.
   *
   * Used to be `true`-only, on the doctrine "pass the literal `true` ONLY if
   * the path provably runs no analysis". That doctrine was the defect: the
   * permission belongs to the fact the response DISPLAYS, not to whether this
   * turn ran an analysis, and an edit turn displays the prior analysis. Both
   * literals are now failures — `false` included, because a blanket `false`
   * would over-suppress legitimate prose just as silently.
   */
  readonly literalPermission: boolean;
}

function enumerateSendCalls(source: string): SendCall[] {
  const calls: SendCall[] = [];
  for (const m of source.matchAll(/sendFinalised200\(/g)) {
    const matchStart = m.index!;
    // Skip the DEFINITION (`function sendFinalised200(`).
    if (/function\s+$/.test(source.slice(Math.max(0, matchStart - 20), matchStart))) continue;

    const openParen = matchStart + m[0].length - 1;
    let depth = 0;
    let j = openParen;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    const argSpan = source.slice(openParen, j + 1);
    calls.push({
      offset: matchStart,
      argSpan,
      marked:
        /mayNameLeadingOption/.test(argSpan) || /claimSafety\.forExit\(\)/.test(argSpan),
      literalPermission: /mayNameLeadingOption:\s*(true|false)\b/.test(argSpan),
    });
  }
  return calls;
}

describe('T1 layer 3 — route-v2 claim-safety marking drift guard', () => {
  const source = readFileSync(ROUTE_V2, 'utf8');
  const calls = enumerateSendCalls(source);

  it('finds every sendFinalised200 call site', () => {
    // Sanity: the enumerator is actually seeing the route's exits. If this
    // dropped to 0 the guard below would be vacuously green.
    expect(calls.length).toBeGreaterThanOrEqual(15);
  });

  it('every sendFinalised200 call declares mayNameLeadingOption', () => {
    const unmarked = calls.filter((c) => !c.marked);
    expect(
      unmarked.map((c) => `sendFinalised200@${c.offset}`),
      'route-v2 has a sendFinalised200 call whose ctx omits the claim-safety permission, so ' +
        'the layer-3 leading-option egress guard is DISARMED for that dispatch family. Thread ' +
        "the dispatch result's own value if the path derives one (as a REQUIRED field, not a " +
        '`?? true` fallback — the shape that disarmed the chip exit until 2026-07-27), ' +
        'otherwise inherit the turn-entry read with `...(await claimSafety.forExit())`.',
    ).toEqual([]);
  });

  it('NO exit may pass a LITERAL permission — every one reads or inherits', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // ⭐ ROADMAP 1.233 finish-line criterion 2. This assertion REPLACES a
    // weaker one, and the replacement is the point of the change.
    //
    // It used to say: "Pass the literal `true` ONLY if the path provably runs
    // no analysis" — and it recorded, rather than rejected, the sixteen exits
    // that did. That doctrine was itself the defect. The permission belongs to
    // the fact the response DISPLAYS, not to the work this turn performed, and
    // an edit turn is handed the prior analysis as context; so "this path runs
    // no analysis" never licensed `true`. Live-confirmed 28 Jul: a withheld
    // analysis, then an edit turn that came back `true`.
    //
    // `false` is rejected too. A blanket `false` would pass every withheld
    // test in the estate and silently over-suppress legitimate leader prose —
    // a worse defect, and one this file would not otherwise see.
    // ═══════════════════════════════════════════════════════════════════════
    expect(
      calls.filter((c) => c.literalPermission).map((c) => `sendFinalised200@${c.offset}`),
      'an exit hardcoded its claim-safety permission. Inherit the turn-entry read instead — ' +
        '`...(await claimSafety.forExit())` — which supplies the boolean AND its provenance ' +
        'from the same canonical derivation the execute path uses.',
    ).toEqual([]);
  });

  it('the two analysis-running exits thread a real value, never a literal', () => {
    // The routed executor and the run_analysis chip click are the two exits
    // that carry their OWN post-dispatch verdict (#737 re-reads after this
    // turn's facts commit — a different question from the entry read, and one
    // the resolver deliberately does not answer). Asserted by the threaded
    // expression appearing in the span — a future refactor that replaces
    // `run.mayNameLeadingOption` with `true` fails HERE.
    const threaded = calls.filter((c) => /mayNameLeadingOption:/.test(c.argSpan));
    const exprs = threaded.map((c) => {
      const m = /mayNameLeadingOption:\s*([^\n,]+)/.exec(c.argSpan);
      return (m?.[1] ?? '').trim();
    });
    expect(
      exprs.sort(),
      'the turn_executor and chip_click exits must thread the verdict the run_analysis handler ' +
        'stamped on the fact. If one of these became a literal `true`, the guard would be blind ' +
        'on exactly the path the G-CEE-1 defect ships through.',
    ).toEqual(['cc.mayNameLeadingOption', 'run.mayNameLeadingOption']);
  });

  it('the turn_executor exit has NO `?? true` fallback left either, and cannot regrow one', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // F6 — THE LAST INSTANCE OF THE FAMILY, closed 2026-07-27.
    //
    // `run.mayNameLeadingOption ?? true` survived the chip-click fix one line
    // above it. Its own defence was that the default is DEAD: the ROADMAP 1.233
    // hoist assigns `mayNameLeadingOptionForRun` at the declaration, so every
    // exit carries a real value and the `??` never fires. That is exactly what
    // makes it worth removing rather than tolerating — an unexercised default
    // is a latent re-arming point, and the codebase's own comment on the
    // sibling says so: "optional is what let the `?? true` exist".
    //
    // Same shape of fix as the chip exit: the field is now REQUIRED on
    // `TurnExecutorRunResult`, so a new exit that forgets it fails to COMPILE.
    // And, as there, the fix is a TYPE change — no runtime test would go red on
    // a revert. Both halves are pinned from source, which is what discriminates.
    // ═══════════════════════════════════════════════════════════════════════
    expect(source).toContain('mayNameLeadingOption: run.mayNameLeadingOption,');
    expect(
      source,
      'the turn_executor exit regrew a `?? true` fallback. The field is REQUIRED on ' +
        'TurnExecutorRunResult — if a new exit cannot derive a verdict, derive one from the ' +
        'persisted facts with readMayNameLeadingOptionForFacts; do not default open.',
    ).not.toContain('run.mayNameLeadingOption ??');

    const executor = readFileSync(TURN_EXECUTOR, 'utf8');
    expect(executor).toMatch(/^\s{2}mayNameLeadingOption:\s*boolean;/m);
    expect(
      executor,
      'mayNameLeadingOption was made optional again on TurnExecutorRunResult. Optional is ' +
        'what the `?? true` at the route grew out of: a producer that forgets the field must ' +
        'fail to compile, which is the doctrine EgressSanitiseOpts already applies.',
    ).not.toMatch(/^\s{2}mayNameLeadingOption\?:/m);
  });

  it('POSITIVE CONTROL: the turn_executor `?? true` pin can FAIL', () => {
    // Rule 2 — re-introduce the exact pre-F6 shape and prove both halves flip.
    const reverted = source.replace(
      'mayNameLeadingOption: run.mayNameLeadingOption,',
      'mayNameLeadingOption: run.mayNameLeadingOption ?? true,',
    );
    expect(reverted).not.toContain('mayNameLeadingOption: run.mayNameLeadingOption,');
    expect(reverted).toContain('run.mayNameLeadingOption ??');

    const executor = readFileSync(TURN_EXECUTOR, 'utf8');
    const revertedType = executor.replace(
      /^(\s{2})mayNameLeadingOption: boolean;/m,
      '$1mayNameLeadingOption?: boolean;',
    );
    expect(revertedType).toMatch(/^\s{2}mayNameLeadingOption\?:/m);
  });

  it('the chip_click exit has NO `?? true` fallback left, and cannot regrow one', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // WALK-2026-07-27-FINAL.md §11.6, and the pin that makes the fix bite.
    //
    // This exit read `cc.mayNameLeadingOption ?? true` — the last surviving
    // instance of the default the ROADMAP 1.233 hoist removed everywhere else.
    // An exit that could not read a verdict handed the Layer-3 guard an explicit
    // permission to ignore whatever the response said.
    //
    // ⚠ THE WALK'S SEVERITY CLAIM IS REFUTED, in the safe direction, and the
    // refutation is recorded here because it changes what this test is for.
    // It was NOT "live-reachable for every non-run_analysis chip outcome":
    // `DETERMINISTIC_CHIP_ACTION_TYPES` has exactly one member, the dispatcher
    // THROWS on anything else, and the union's single `outcome: 'ok'` producer
    // always populated the field. The default was a LATENT re-arming point, not
    // a live leak — real, and worth closing, and not what it was billed as.
    //
    // The fix is a TYPE change (the field is now required on the `ok` outcome),
    // which means reverting it changes no runtime behaviour and no runtime test
    // would go red. THIS is the instrument that discriminates: both halves are
    // pinned from source, so a revert of either fails here.
    // ═══════════════════════════════════════════════════════════════════════
    expect(source).toContain('mayNameLeadingOption: cc.mayNameLeadingOption,');
    expect(
      source,
      'the chip_click exit regrew a `?? true` fallback. The field is REQUIRED on the ' +
        "dispatch's `ok` outcome — if a new outcome cannot derive a verdict, derive one " +
        'from the persisted facts with readMayNameLeadingOptionForFacts; do not default open.',
    ).not.toContain('cc.mayNameLeadingOption ??');

    const dispatch = readFileSync(CHIP_CLICK_DISPATCH, 'utf8');
    expect(dispatch).toMatch(/readonly mayNameLeadingOption:\s*boolean;/);
    expect(
      dispatch,
      'mayNameLeadingOption was made optional again on the chip dispatch `ok` outcome. ' +
        'Optional is what let the `?? true` exist: a producer that forgets the field must ' +
        'fail to COMPILE, which is the same doctrine tryRunComparisonGate already applies.',
    ).not.toMatch(/readonly mayNameLeadingOption\?:/);
  });

  it('POSITIVE CONTROL: the `?? true` pin can FAIL', () => {
    // Rule 2 — an instrument that returns the same answer for "fixed" and
    // "could not look" is not an instrument. Re-introduce the exact pre-fix
    // shape and prove both halves of the assertion above flip.
    const reverted = source.replace(
      'mayNameLeadingOption: cc.mayNameLeadingOption,',
      'mayNameLeadingOption: cc.mayNameLeadingOption ?? true,',
    );
    expect(reverted).not.toContain('mayNameLeadingOption: cc.mayNameLeadingOption,');
    expect(reverted).toContain('cc.mayNameLeadingOption ??');
  });

  it('EgressSanitiseOpts declares mayNameLeadingOption as REQUIRED, not optional', () => {
    // The type checker is the primary enforcement for the sanitiser itself.
    // This asserts the enforcement has not been softened to `?:` — the exact
    // change the `userMessage` field's own comment warns against ("an optional
    // field is one a future caller silently forgets").
    const safety = readFileSync(OUTPUT_SAFETY, 'utf8');
    expect(safety).toMatch(/readonly mayNameLeadingOption:\s*boolean;/);
    expect(
      safety,
      'mayNameLeadingOption was made optional on EgressSanitiseOpts. A claim-safety guard a ' +
        'caller can forget to arm is theatre — revert to a required field and fix the callers.',
    ).not.toMatch(/readonly mayNameLeadingOption\?:/);
  });

  // ── POSITIVE CONTROL ──────────────────────────────────────────────────────
  it('positive control: the detector flags an unmarked call and clears a marked one', () => {
    const fixtureUnmarked = `
      return sendFinalised200(reply, requestId, 'made_up_family', someResponse, {
        graph: null,
        answerKind: 'functional',
        userMessage: ingress.message,
      });
    `;
    const seen = enumerateSendCalls(fixtureUnmarked);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.marked, 'an unmarked call must be SEEN as unmarked').toBe(false);

    const fixtureMarked = `
      return sendFinalised200(reply, requestId, 'made_up_family', someResponse, {
        graph: null,
        mayNameLeadingOption: true,
        userMessage: ingress.message,
      });
    `;
    const ok = enumerateSendCalls(fixtureMarked);
    expect(ok).toHaveLength(1);
    expect(ok[0]!.marked).toBe(true);
    expect(ok[0]!.literalPermission).toBe(true);

    // A literal `false` must ALSO be seen as a literal — otherwise the
    // "no literal permissions" assertion would be blind to the blanket-false
    // over-suppression mutant, which is the more dangerous of the two.
    const fixtureLiteralFalse = fixtureMarked.replace(
      'mayNameLeadingOption: true,',
      'mayNameLeadingOption: false,',
    );
    expect(enumerateSendCalls(fixtureLiteralFalse)[0]!.literalPermission).toBe(true);

    const fixtureThreaded = `
      return sendFinalised200(reply, requestId, 'made_up_family', someResponse, {
        graph: null,
        mayNameLeadingOption: run.mayNameLeadingOption ?? true,
        userMessage: ingress.message,
      });
    `;
    const thr = enumerateSendCalls(fixtureThreaded);
    expect(thr[0]!.marked).toBe(true);
    expect(thr[0]!.literalPermission, 'a threaded value must NOT read as a literal').toBe(false);

    // THE INHERITED FORM — the shape sixteen exits now use. It must read as
    // MARKED (the permission IS stated) and NOT as a literal. Without this
    // arm the detector could silently stop recognising the resolver and the
    // "every call declares it" assertion would go red for the wrong reason.
    const fixtureInherited = `
      return sendFinalised200(reply, requestId, 'made_up_family', someResponse, {
        graph: null,
        ...(await claimSafety.forExit()),
        userMessage: ingress.message,
      });
    `;
    const inh = enumerateSendCalls(fixtureInherited);
    expect(inh).toHaveLength(1);
    expect(inh[0]!.marked, 'the inherited form STATES the permission').toBe(true);
    expect(inh[0]!.literalPermission).toBe(false);
  });
});
