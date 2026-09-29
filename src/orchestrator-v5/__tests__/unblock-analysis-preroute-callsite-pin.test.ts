/**
 * THE CALL-SITE PIN for the unblock-analysis pre-route.
 *
 * ⭐ WHY A PIN. Both modules are pure and have 21 tests between them, every one
 * of which stays green if the executor never calls them. A perfect detector
 * nobody invokes is this estate's dominant defect class — and it is exactly how
 * a previous PR of mine shipped a fix that could be deleted without a single
 * test going red across 43,884 tests. This file fails when the WIRING is wrong,
 * which is the only thing its siblings cannot see.
 *
 * It reads the executor's SOURCE rather than driving a turn, following the
 * sibling pins: `runTurnExecutor` has dozens of `return finalizeRun()` exits and
 * constructing one here would prove the pre-route runs on THAT exit and nothing
 * about the others. The properties below are true of every exit or of none.
 *
 * ⚠ COMMENTS ARE STRIPPED FIRST, and that is not cosmetic. The block this pins
 * carries a long rationale naming the very symbols asserted below, so an
 * un-stripped search would match this module's own prose and pass on a build
 * where the code had been deleted. A previous test of mine did exactly that.
 * Property 0 proves the stripper is load-bearing.
 *
 * ⚠ MUTANT OBLIGATION (what must RED): delete the detector call → property 1;
 * move the block above the no-analysis guard → property 2; move it after the
 * LLM routing call → property 3; pass anything but the readiness authority →
 * property 4.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const EXECUTOR = resolve(dirname(fileURLToPath(import.meta.url)), '../turn-executor.ts');
const raw = readFileSync(EXECUTOR, 'utf8');

/**
 * Comments removed, LINE BY LINE.
 *
 * ⚠ A naive `/\/\*[\s\S]*?\*\//g` is WRONG here and was measured wrong: it also
 * fires on `/*` inside string literals and regexes, and in this file it ate
 * real code — the routing call disappeared entirely and this suite's ordering
 * assertion compared against index -1. A block comment in this estate always
 * BEGINS a line, so tracking that is both safe and sufficient.
 */
const code = (() => {
  let inBlock = false;
  return raw
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (inBlock) {
        if (t.endsWith('*/')) inBlock = false;
        return '';
      }
      if (t.startsWith('/*')) {
        if (!t.endsWith('*/')) inBlock = true;
        return '';
      }
      if (t.startsWith('//')) return '';
      return line;
    })
    .join('\n');
})();

describe('unblock-analysis pre-route — wired ahead of generic routing', () => {
  it('0 · the comment stripper is load-bearing', () => {
    // This phrase exists ONLY inside the pinned block's rationale.
    expect(raw).toContain('COULD NEVER satisfy a mapping obligation');
    expect(code).not.toContain('COULD NEVER satisfy a mapping obligation');
  });

  it('1 · both modules are CALLED, not merely imported', () => {
    expect(code).toContain('detectUnblockAnalysisIntent(payload.message)');
    expect(code).toContain('buildUnblockAnalysisAnswer(');
    expect(code).toContain(
      "import { detectUnblockAnalysisIntent } from './routing/unblock-analysis-intent.js';",
    );
  });

  it('2 · it runs AFTER the no-analysis guard, so that guard keeps its turns', () => {
    const guard = code.indexOf('tryNoAnalysisGuard({');
    const preroute = code.indexOf('detectUnblockAnalysisIntent(payload.message)');
    expect(guard).toBeGreaterThan(-1);
    expect(preroute).toBeGreaterThan(-1);
    expect(preroute).toBeGreaterThan(guard);
  });

  it('3 · it runs BEFORE the LLM routing that previously claimed these turns', () => {
    const preroute = code.indexOf('detectUnblockAnalysisIntent(payload.message)');
    // ⚠ NOT `indexOf('routeWithToolUse')` — that matches the IMPORT at the top
    // of the file, which is earlier than every call site and made this
    // assertion compare against the wrong occurrence entirely. Bind to the
    // invocation.
    const routed = code.indexOf('routingResult = await routeWithToolUse(');
    expect(routed).toBeGreaterThan(-1);
    expect(preroute).toBeLessThan(routed);
  });

  it('4 · the answer is built from the READINESS AUTHORITY, not a second opinion', () => {
    const call = code.indexOf('buildUnblockAnalysisAnswer(');
    const window = code.slice(call, call + 200);
    expect(window).toContain('analysisReadyForTurn');
  });

  it('5 · it claims the turn — it does not fall through to the router', () => {
    const preroute = code.indexOf('detectUnblockAnalysisIntent(payload.message)');
    const window = code.slice(preroute, preroute + 3000);
    expect(window).toContain('return finalizeRun();');
    expect(window).toContain("turn_class: 'direct_answer'");
    expect(window).toContain('llm_calls_used: 0');
  });
});
