/**
 * strip-source-comments — the shared literal-aware comment stripper behind
 * every source-scanning guard (shell guards via its CLI, static vitest
 * guards via the `stripComments` import).
 *
 * Three jobs:
 *   1. POSITIVE + NEGATIVE controls for the footgun class it exists to
 *      kill: an accurate comment documenting an anti-pattern must be
 *      invisible; the real anti-pattern (code or string literal) must stay
 *      visible. A stripper that blanked too much would turn every guard
 *      vacuous — the absence assertions here only mean something because
 *      the presence assertions pass beside them.
 *   2. PARITY with the ratified tokeniser it was ported from
 *      (tests/unit/contracts/controlled-factor-authority.scan.ts). Two
 *      same-purpose tokenisers drifting apart is exactly the twin-function
 *      class this repo has been bitten by; this check makes the sync
 *      MECHANICAL — if either implementation changes alone, this goes red.
 *   3. The length/line-preservation invariant every guard's line numbers
 *      depend on.
 */
import { describe, expect, it } from 'vitest';

import { stripComments, tokenise } from '../../../scripts/ci/strip-source-comments.mjs';
import { tokenise as ratifiedTokenise } from '../../unit/contracts/controlled-factor-authority.scan.js';

describe('stripComments — the comment footgun is dead', () => {
  it('a trailing comment documenting an anti-pattern is invisible', () => {
    expect(stripComments('const ok = 1; // never launder types via as unknown as here')).not.toContain(
      'as unknown as',
    );
  });

  it('an unstarred block-comment body is invisible', () => {
    expect(stripComments('/*\nthe V4 adapter used as unknown as to bypass the contract\n*/')).not.toContain(
      'as unknown as',
    );
  });

  it('a JSDoc body is invisible', () => {
    expect(stripComments('/**\n * DecisionGuideAI renders this fact verbatim.\n */')).not.toContain(
      'DecisionGuideAI',
    );
  });

  it('a full-line comment quoting call syntax is invisible', () => {
    expect(stripComments("// never call .rpc('append_turn_atomic') outside the store")).not.toContain(
      'append_turn_atomic',
    );
  });
});

describe('stripComments — real violations stay visible (positive controls)', () => {
  it('real code still matches', () => {
    expect(stripComments('const meta = input as unknown as Meta;')).toContain('as unknown as');
  });

  it('string-literal contents are kept (violations often live in strings)', () => {
    expect(stripComments("reply.type('text/event-stream');")).toContain('text/event-stream');
    expect(stripComments('const m = args.model || "claude-3-5-haiku-20241022";')).toContain(
      'claude-3-5-haiku-20241022',
    );
  });

  it('a // inside a string does not open a comment (literal-aware)', () => {
    expect(stripComments('const u = "https://a//b"; const y = q as unknown as Z;')).toContain(
      'as unknown as',
    );
  });

  it('template-interpolation code is kept', () => {
    expect(stripComments('const t = `x ${v as unknown as W} y`;')).toContain('as unknown as');
  });

  it('a regex literal does not open a comment', () => {
    expect(stripComments('const r = /https:\\/\\//; const z = a as unknown as B;')).toContain(
      'as unknown as',
    );
  });
});

describe('stripComments — invariants the guards depend on', () => {
  it('is length- and line-preserving (line numbers survive)', () => {
    const src = 'line1\n/* c1\nc2 */\nconst hit = a as unknown as B; // note\n';
    const out = stripComments(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out.split('\n').findIndex((l) => l.includes('as unknown as'))).toBe(3);
  });

  it('matches the ratified controlled-factor-authority tokeniser char-for-char (anti-twin pin)', () => {
    // A fixture exercising every state the two machines share: line/block
    // comments, all three string kinds with escapes and comment-lookalikes,
    // template interpolation nesting, regex literals and character classes,
    // division vs regex disambiguation.
    const fixture = [
      "const a = 'sq // not a comment';",
      'const b = "dq /* not a comment */";',
      'const c = `tpl ${inner + `nested ${deep}`} // still template`;',
      'const d = /re\\/gex[/]/.test(x) ? 1 : 2; // trailing',
      '/* block',
      ' * starred body as unknown as',
      ' unstarred body */',
      'const e = 10 / 2 / 1;',
      "const f = { warnOnInvalid: true }; // warnOnInvalid",
      'return /^a\\/b$/;',
    ].join('\n');
    const ours = tokenise(fixture);
    const ratified = ratifiedTokenise(fixture);
    expect(ours.noComments).toBe(ratified.noComments);
    expect(ours.structural).toBe(ratified.structural);
  });
});
