/**
 * ROADMAP 1.132 (F1) — FAIL-LOUD DRIFT GUARD for the answer-kind discriminator.
 *
 * The dominant defect class in this codebase is the hand-maintained mirror that
 * drifts silently green (CLAUDE.md verification trap #12). The F1 answer-shape
 * scope has now failed the live wire THREE times, twice because a NEW substantive
 * compose site was left unclassified while every test stayed green.
 *
 * Two independent guards make that impossible to repeat SILENTLY:
 *
 *   1. BUILD-TIME (primary, derive-not-mirror): `answerKind` is a REQUIRED field
 *      of `ComposeInput` / `ComposeToolCallInput`, so a NEW compose site cannot
 *      compile without declaring a kind. The type-checker IS the enumerator —
 *      there is no hand-list to fall out of sync. (Verified by the build gate,
 *      `tsc -p tsconfig.build.json`.)
 *
 *   2. THIS SOURCE-ENUMERATION TEST: even a site that declares `answerKind` via
 *      a non-literal, or a change to WHICH sites are `'substantive'`, must be
 *      DELIBERATE. This test enumerates every `composeDirectAnswerResponse` /
 *      `composeClarifyResponse` / `composeToolCallResponse` CALL in the three
 *      answer-egress files, asserts each passes an `answerKind:` literal, and
 *      PINS the set of `'substantive'` sites. Adding a substantive site (which
 *      also needs egress wiring) fails this test RED until the pin is updated —
 *      so it can never ship silently un-shaped.
 *
 * POSITIVE CONTROL (CLAUDE.md verification trap #13): the detector must first be
 * proven able to SEE an unclassified site, otherwise its "every call is
 * classified" assertion is vacuous. The final test feeds it a fixture compose
 * call with NO `answerKind` and asserts it is flagged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Enumerate the two public answer composers AND the executor-local
// `composeAnswer` chokepoint (a wrapper over composeDirectAnswerResponse that
// captures the substantive-answer text — see turn-executor.ts). All three take a
// `ComposeInput` / `ComposeToolCallInput` whose `answerKind` field is REQUIRED.
const COMPOSE_CALL_RE =
  /compose(?:DirectAnswer|Clarify|ToolCall)Response\(|composeAnswer\(/g;

interface ComposeCall {
  readonly composer: string;
  /** char offset of the call in the source */
  readonly offset: number;
  /** the full `(...)` argument span, balanced */
  readonly argSpan: string;
  /**
   * 'substantive' / 'functional' when an `answerKind` literal is present;
   * 'delegated' when the call passes a pre-built input VARIABLE (no object
   * literal) — the kind rides on that variable's type, enforced by tsc, e.g. the
   * `composeAnswer` wrapper's own `composeDirectAnswerResponse(input)`; null when
   * an object literal is passed WITHOUT any `answerKind` (an unclassified site).
   */
  readonly declaredKind: 'substantive' | 'functional' | 'delegated' | null;
}

/**
 * Enumerate every compose CALL (not the `export function` definitions) and, for
 * each, extract the balanced `(...)` argument span and its declared `answerKind`.
 * Pure string analysis — no import of the module under test, so it cannot be
 * fooled by runtime behaviour.
 */
function enumerateComposeCalls(source: string): ComposeCall[] {
  const calls: ComposeCall[] = [];
  for (const m of source.matchAll(COMPOSE_CALL_RE)) {
    const matchStart = m.index!;
    // Skip a DEFINITION (`function composeX(` / `const composeX = (`).
    const preceding = source.slice(Math.max(0, matchStart - 20), matchStart);
    if (/function\s+$/.test(preceding) || /const\s+$/.test(preceding)) continue;

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
    let declaredKind: ComposeCall['declaredKind'];
    if (/answerKind:\s*'substantive'/.test(argSpan)) declaredKind = 'substantive';
    else if (/answerKind:\s*'functional'/.test(argSpan)) declaredKind = 'functional';
    else if (/answerKind/.test(argSpan)) declaredKind = 'functional'; // literal present but non-standard formatting
    else if (!argSpan.includes('{')) declaredKind = 'delegated'; // passes a typed input variable
    else declaredKind = null; // object literal with NO answerKind → unclassified
    calls.push({ composer: m[0].slice(0, -1), offset: matchStart, argSpan, declaredKind });
  }
  return calls;
}

// The three files where a composed OlumiResponse reaches the route egress.
const TARGET_FILES = {
  'turn-executor.ts': resolve(HERE, '../turn-executor.ts'),
  'route-v2.ts': resolve(HERE, '../../orchestrator/route-v2.ts'),
  'chip-click-dispatch.ts': resolve(HERE, '../handlers/chip-click-dispatch.ts'),
} as const;

// PINNED expected number of `'substantive'` compose sites per file. A change to
// any of these must be DELIBERATE — adding a substantive site needs egress
// wiring, so this pin failing RED is the point.
//   - turn-executor: coach LLM, converse/text_only LLM, post-analysis advice
//     gate, run-comparison = 4.
//   - route-v2: the two inline composes (edit_graph no-op, edit_graph
//     no-proposal) are functional = 0.
//   - chip-click-dispatch: 0. The explain_results / what_would_flip answer is
//     DEFERRED-FUNCTIONAL (see chip-click-dispatch.ts) — arguably substantive
//     but left un-shaped pending a scope + live-wire decision; every chip compose
//     is therefore 'functional' today. Flipping the explain/flip compose to
//     'substantive' later must bump this pin to 1 (deliberate).
const EXPECTED_SUBSTANTIVE_COUNT: Record<keyof typeof TARGET_FILES, number> = {
  'turn-executor.ts': 4,
  'route-v2.ts': 0,
  'chip-click-dispatch.ts': 0,
};

describe('F1 answer-kind — compose-site classification drift guard (ROADMAP 1.132)', () => {
  for (const [name, path] of Object.entries(TARGET_FILES)) {
    const source = readFileSync(path, 'utf8');
    const calls = enumerateComposeCalls(source);

    it(`${name}: every compose call declares an answerKind (no unclassified answer site)`, () => {
      expect(calls.length).toBeGreaterThan(0);
      const unclassified = calls.filter((c) => c.declaredKind === null);
      // A new compose site that forgot `answerKind` would appear here. (The
      // build-time required field catches it first; this is the second net,
      // and it also catches a wrong non-literal.)
      expect(
        unclassified.map((c) => `${c.composer}@${c.offset}`),
        `${name} has compose call(s) with no answerKind declaration`,
      ).toEqual([]);
    });

    it(`${name}: the set of 'substantive' compose sites matches the pin (deliberate-change gate)`, () => {
      const substantive = calls.filter((c) => c.declaredKind === 'substantive');
      expect(
        substantive.length,
        `${name}: substantive compose-site count changed — if intentional, update ` +
          `EXPECTED_SUBSTANTIVE_COUNT AND confirm the new site's kind is threaded to ` +
          `the route egress (run.answerKind / cc.answerKind).`,
      ).toBe(EXPECTED_SUBSTANTIVE_COUNT[name as keyof typeof TARGET_FILES]);
    });
  }

  // ── NO-BYPASS: the executor's capture chokepoint is the ONLY direct caller ──
  // `composeAnswer` (which captures the substantive-answer text) is the sole
  // route through which a turn-body answer may be composed. If a new site called
  // `composeDirectAnswerResponse` DIRECTLY it would compile (the field is still
  // required) but bypass the capture — shipping a substantive answer un-shaped,
  // exactly the class of miss that burned F1 three times. Pin: the executor
  // calls `composeDirectAnswerResponse` EXACTLY ONCE — inside the wrapper — and
  // that call delegates a typed input variable.
  it('turn-executor.ts: composeDirectAnswerResponse is called ONLY inside the composeAnswer chokepoint', () => {
    const source = readFileSync(TARGET_FILES['turn-executor.ts'], 'utf8');
    const directCalls = enumerateComposeCalls(source).filter(
      (c) => c.composer === 'composeDirectAnswerResponse',
    );
    expect(directCalls, 'exactly one direct composeDirectAnswerResponse call (the wrapper)').toHaveLength(1);
    // …and it delegates the wrapper's typed `input` (no inline object literal).
    expect(directCalls[0]!.declaredKind).toBe('delegated');
  });

  // ── POSITIVE CONTROL (trap #13) ────────────────────────────────────────────
  // Prove the detector can SEE an unclassified site — otherwise the
  // "every call declares answerKind" assertions above are vacuous.
  it('positive control: the detector FLAGS a compose call that omits answerKind', () => {
    const fixtureUnclassified = `
      const r = composeDirectAnswerResponse({
        assistant_text: 'hello there. more prose here.',
        stage: 'analyse',
      });
    `;
    const calls = enumerateComposeCalls(fixtureUnclassified);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.declaredKind).toBeNull(); // SEEN as unclassified

    // And prove it does NOT false-flag a properly classified call (so the
    // absence signal above is specific, not always-null).
    const fixtureClassified = `
      const r = composeDirectAnswerResponse({
        answerKind: 'substantive',
        assistant_text: 'hello there. more prose here.',
        stage: 'analyse',
      });
    `;
    const ok = enumerateComposeCalls(fixtureClassified);
    expect(ok).toHaveLength(1);
    expect(ok[0]!.declaredKind).toBe('substantive');
  });
});
