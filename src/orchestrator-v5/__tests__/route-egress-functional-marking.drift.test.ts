/**
 * ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: FAIL-LOUD guard on the
 * FUNCTIONAL set (fourth F1 fix).
 *
 * The inversion flips the egress default: `sendFinalised200` now synthesises
 * `_answer_shape` for ANY answer UNLESS its ctx declares `answerKind:
 * 'functional'`. That makes the SMALL, STABLE functional set the thing that must
 * be marked — the opposite of the pre-inversion world, where the (larger,
 * open-ended) substantive set needed marking and each new one was missed.
 *
 * The failure direction is now SAFE: a functional dispatch that FORGETS its mark
 * ships one long message behind progressive disclosure (mild — caught by the UI
 * content-loss gate + A2 criterion 3), never a substantive answer silently
 * un-shaped. But "safe-when-missed" is not "fine to drift silently", so this
 * guard makes the omission FAIL LOUD.
 *
 * DERIVE-NOT-MIRROR (CLAUDE.md trap #12): this test does NOT hand-list the exit
 * paths. It ENUMERATES every `sendFinalised200(...)` CALL in route-v2.ts from
 * SOURCE (balanced-paren scan) and asserts each one's ctx object declares an
 * `answerKind` — either an explicit literal (`'functional'` / `'substantive'`)
 * or a threaded value (`run.answerKind` / `cc.answerKind`). A NEW dispatch family
 * added without a mark appears here immediately. There is no list to fall out of
 * sync with.
 *
 * POSITIVE CONTROL (CLAUDE.md trap #13): the final test feeds the detector a
 * fixture `sendFinalised200` call with NO `answerKind` in its ctx and asserts it
 * is FLAGGED — proving the "every call is marked" assertion above can actually
 * SEE an unmarked call (otherwise it is vacuous).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_V2 = resolve(HERE, '../../orchestrator/route-v2.ts');

interface SendCall {
  /** char offset of the call in the source */
  readonly offset: number;
  /** the full balanced `(...)` argument span */
  readonly argSpan: string;
  /**
   * true when the call's argument span declares an `answerKind` — an explicit
   * literal OR a threaded value (`run.answerKind` / `cc.answerKind`). false when
   * the span has NO `answerKind` reference at all (an UNMARKED egress: post
   * inversion it would SHAPE without a deliberate decision).
   */
  readonly marked: boolean;
}

/**
 * Enumerate every `sendFinalised200(` CALL (not the `function sendFinalised200`
 * definition) and, for each, capture the balanced `(...)` argument span and
 * whether it references `answerKind`. Pure string analysis — no import of the
 * module under test, so it cannot be fooled by runtime behaviour.
 */
function enumerateSendCalls(source: string): SendCall[] {
  const calls: SendCall[] = [];
  const re = /sendFinalised200\(/g;
  for (const m of source.matchAll(re)) {
    const matchStart = m.index!;
    // Skip the DEFINITION (`function sendFinalised200(`).
    const preceding = source.slice(Math.max(0, matchStart - 20), matchStart);
    if (/function\s+$/.test(preceding)) continue;

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
    calls.push({ offset: matchStart, argSpan, marked: /answerKind/.test(argSpan) });
  }
  return calls;
}

describe('F1 egress-inversion — route-v2 functional-marking drift guard (ROADMAP 1.132)', () => {
  const source = readFileSync(ROUTE_V2, 'utf8');
  const calls = enumerateSendCalls(source);

  it('finds every sendFinalised200 call site', () => {
    // Sanity: the enumerator is actually seeing the route's exits (there are
    // ~19 of them). If this drops to 0 the guard below would be vacuously green.
    expect(calls.length).toBeGreaterThanOrEqual(15);
  });

  it('every sendFinalised200 call declares an answerKind (no unmarked egress under the inverted default)', () => {
    const unmarked = calls.filter((c) => !c.marked);
    expect(
      unmarked.map((c) => `sendFinalised200@${c.offset}`),
      'route-v2 has a sendFinalised200 call whose ctx omits answerKind — post-inversion ' +
        'it would SHAPE by default. Mark it `answerKind: \'functional\'` (or thread the ' +
        'dispatch kind) if it is functional copy, or `\'substantive\'` if it is a real answer.',
    ).toEqual([]);
  });

  // ── POSITIVE CONTROL (trap #13) ────────────────────────────────────────────
  it('positive control: the detector FLAGS a sendFinalised200 call that omits answerKind', () => {
    const fixtureUnmarked = `
      return sendFinalised200(reply, requestId, 'made_up_family', someResponse, {
        graph: null,
        requestStartedAt: routeStartedAt,
        userMessage: ingress.message,
      });
    `;
    const seen = enumerateSendCalls(fixtureUnmarked);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.marked, 'an unmarked call must be SEEN as unmarked').toBe(false);

    // …and it does NOT false-flag a properly marked call (so the absence signal
    // is specific, not always-false).
    const fixtureMarked = `
      return sendFinalised200(reply, requestId, 'made_up_family', someResponse, {
        graph: null,
        answerKind: 'functional',
        userMessage: ingress.message,
      });
    `;
    const ok = enumerateSendCalls(fixtureMarked);
    expect(ok).toHaveLength(1);
    expect(ok[0]!.marked).toBe(true);
  });
});
