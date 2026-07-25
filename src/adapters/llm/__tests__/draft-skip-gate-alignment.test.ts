/**
 * SKIP-GATE ALIGNMENT (2026-07-25) — the two guards that encoded ONE rule with
 * DIFFERENT floors, and the live class that fell through the gap.
 *
 * THE DEFECT. "Don't fund a generation smaller than the one that just failed"
 * was written twice:
 *   * `config/timeouts.ts`      `>= max(2_700, priorAttemptMaxTokens)`
 *   * `adapters/llm/anthropic.ts` `< 2_700`   ← the second half was missing
 * Because getAffordableDraftTokens(50_000) = 3,150 and 3,150 >= 2,700, the
 * adapter's gate NEVER fired. After two 30s runaway aborts had burned 60s of a
 * 110s window, the "final" attempt ran at 3,150 tokens — ~37% of the 8,550-token
 * budget the aborted attempts had — and truncated by construction ~90s in.
 *
 * THE LIVE MEASUREMENT this is derived from (`parallel-briefs/
 * A2KILLER-REPROBE-1b9d596-2026-07-24.md`): `/assist/v1/draft-graph` A2killer
 * 0/18, observed caps `3146, 3147x5, 3148x8, 3149, 3378, 3419, 3826` — 15 of 18
 * inside a FOUR-token band. `aff(50_000) = 3,150` exactly. Solo and 3-concurrent
 * were indistinguishable, so it is not load; #673 moved
 * DRAFT_RUNAWAY_MIN_RETRY_MS 35s->45s, which changes WHEN the last rung fires,
 * not THAT it fires.
 *
 * These tests recompute the arithmetic from the exported primitives rather than
 * restating the constants, so they keep meaning if the timeout is retuned.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isAbortableRetryViable,
  shouldSkipDoomedFinalAttempt,
  hasRoomForAnotherAbortableAttempt,
  resolveDraftMaxTokens,
  DRAFT_RUNAWAY_HARD_CEILING_MS,
  DRAFT_MAX_RUNAWAY_RETRIES,
} from '../draft-budget.js';
import {
  DRAFT_LLM_TIMEOUT_MS,
  LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR,
  getAffordableDraftTokens,
  isDraftRetryAffordable,
  viableDraftRetryFloorTokens,
} from '../../../config/timeouts.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The full-window attempt-1 cap at the derived timeout (8,550 at defaults). */
const FULL_CAP = resolveDraftMaxTokens(DRAFT_LLM_TIMEOUT_MS).effective;

describe('THE REGRESSION — the exact live A2killer arithmetic must now be refused', () => {
  it('reproduces the observed cap: two hard-ceiling aborts leave a window affording ~3,150 tokens', () => {
    // Two 30s aborts out of the 110s window leaves 50s.
    const windowAfterTwoAborts = DRAFT_LLM_TIMEOUT_MS - 2 * DRAFT_RUNAWAY_HARD_CEILING_MS;
    expect(windowAfterTwoAborts).toBe(50_000);
    // This is the number every one of the 18 live failures died against.
    expect(getAffordableDraftTokens(windowAfterTwoAborts)).toBe(3_150);
  });

  it('THE FIX: that final attempt is now SKIPPED — it cannot fund the 8,550-token attempt it follows', () => {
    const remaining = DRAFT_LLM_TIMEOUT_MS - 2 * DRAFT_RUNAWAY_HARD_CEILING_MS;
    const finalAttemptAffordableTokens = resolveDraftMaxTokens(remaining).effective;
    expect(
      shouldSkipDoomedFinalAttempt({
        runawayAbortCount: 2,
        willBeFinalAttempt: true,
        thinkingEnabled: false,
        finalAttemptAffordableTokens,
        priorAttemptMaxTokens: FULL_CAP,
      }),
    ).toBe(true);
  });

  it('THE OLD GATE would have let it run — the 2,700-only floor is satisfied by 3,150', () => {
    // Documents WHY the gate was silent: this is the condition that used to be
    // in anthropic.ts, evaluated on the real numbers. It is false, i.e. "do not
    // skip". Any future edit that reintroduces a bare-floor comparison
    // reintroduces exactly this.
    const finalAttemptAffordableTokens = getAffordableDraftTokens(50_000);
    expect(finalAttemptAffordableTokens < LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR).toBe(false);
    // …while the ALIGNED rule refuses it.
    expect(isDraftRetryAffordable(finalAttemptAffordableTokens, FULL_CAP)).toBe(false);
  });

  it('every cap observed live (3,146-3,826) is refused against the full-budget attempt it followed', () => {
    // The complete census from results.jsonl, not a representative sample.
    const observedCaps = [
      3146, 3147, 3147, 3147, 3147, 3147, 3148, 3148, 3148,
      3148, 3148, 3148, 3148, 3148, 3149, 3378, 3419, 3826,
    ];
    expect(observedCaps).toHaveLength(18);
    for (const cap of observedCaps) {
      expect(
        shouldSkipDoomedFinalAttempt({
          runawayAbortCount: 2,
          willBeFinalAttempt: true,
          thinkingEnabled: false,
          finalAttemptAffordableTokens: cap,
          priorAttemptMaxTokens: FULL_CAP,
        }),
      ).toBe(true);
    }
  });
});

describe('shouldSkipDoomedFinalAttempt — the preconditions that keep it from over-firing', () => {
  const base = {
    runawayAbortCount: 2,
    willBeFinalAttempt: true,
    thinkingEnabled: false,
    finalAttemptAffordableTokens: 3_150,
    priorAttemptMaxTokens: FULL_CAP,
  };

  it('NEVER skips attempt 1 — no abort has been spent, so there is nothing to compare against', () => {
    expect(shouldSkipDoomedFinalAttempt({ ...base, runawayAbortCount: 0 })).toBe(false);
  });

  it('never skips a NON-final attempt (a retry is still funded behind it)', () => {
    expect(shouldSkipDoomedFinalAttempt({ ...base, willBeFinalAttempt: false })).toBe(false);
  });

  it('never skips under extended thinking — detection is off, so the final-attempt squeeze cannot apply', () => {
    expect(shouldSkipDoomedFinalAttempt({ ...base, thinkingEnabled: true })).toBe(false);
  });

  it('does NOT skip a final attempt that CAN fund the abandoned cap', () => {
    expect(
      shouldSkipDoomedFinalAttempt({
        ...base,
        finalAttemptAffordableTokens: FULL_CAP,
      }),
    ).toBe(false);
  });

  it('is exactly the negation of the shared rule wherever its preconditions hold', () => {
    for (const prior of [1_000, 2_700, 3_150, 6_800, FULL_CAP]) {
      for (const affordable of [0, 1_500, 2_699, 2_700, 3_150, 6_800, FULL_CAP, FULL_CAP + 1]) {
        expect(
          shouldSkipDoomedFinalAttempt({
            runawayAbortCount: 1,
            willBeFinalAttempt: true,
            thinkingEnabled: false,
            finalAttemptAffordableTokens: affordable,
            priorAttemptMaxTokens: prior,
          }),
        ).toBe(!isDraftRetryAffordable(affordable, prior));
      }
    }
  });
});

describe('isAbortableRetryViable — the abort must not create a window the skip-gate will refuse', () => {
  it('DEFAULT REGIME: a full-budget attempt-1 authorises NO abort — a 30s abort cannot re-fund 8,550', () => {
    // The time-reserve alone says yes (110s > 30s + 45s)…
    expect(hasRoomForAnotherAbortableAttempt(DRAFT_LLM_TIMEOUT_MS, 0)).toBe(true);
    // …but the window an abort would leave affords only aff(80s) = 5,850.
    expect(getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS - DRAFT_RUNAWAY_HARD_CEILING_MS)).toBe(5_850);
    expect(isAbortableRetryViable(DRAFT_LLM_TIMEOUT_MS, 0, FULL_CAP)).toBe(false);
  });

  it('THE MECHANISM IS NOT DEAD: a REDUCED attempt-1 cap re-arms the abort', () => {
    // An operator lowering CEE_DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL, or a caller
    // passing a maxTokensCeiling, makes a post-abort window able to re-fund the
    // smaller cap — so the ladder fires again, derived rather than switched.
    const postAbortAffordable = getAffordableDraftTokens(
      DRAFT_LLM_TIMEOUT_MS - DRAFT_RUNAWAY_HARD_CEILING_MS,
    );
    expect(isAbortableRetryViable(DRAFT_LLM_TIMEOUT_MS, 0, postAbortAffordable)).toBe(true);
    expect(isAbortableRetryViable(DRAFT_LLM_TIMEOUT_MS, 0, postAbortAffordable + 1)).toBe(false);
  });

  it('still respects the time reserve and the runaway backstop', () => {
    expect(isAbortableRetryViable(1_000, 0, 100)).toBe(false);
    expect(isAbortableRetryViable(10_000_000, DRAFT_MAX_RUNAWAY_RETRIES, 100)).toBe(false);
  });

  it('NEVER authorises an abort the skip-gate would then refuse (the contradiction #673 fixed, one level up)', () => {
    // Sweep the real domain. For every authorised abort, the window it leaves
    // must pass the very gate that runs at the next loop top.
    for (let remaining = 0; remaining <= 200_000; remaining += 500) {
      for (const currentCap of [1_500, 2_700, 3_150, 5_850, FULL_CAP]) {
        if (!isAbortableRetryViable(remaining, 1, currentCap)) continue;
        const postAbortWindow = remaining - DRAFT_RUNAWAY_HARD_CEILING_MS;
        const postAbortAffordable = resolveDraftMaxTokens(Math.max(0, postAbortWindow)).effective;
        expect(
          shouldSkipDoomedFinalAttempt({
            runawayAbortCount: 2,
            willBeFinalAttempt: true,
            thinkingEnabled: false,
            finalAttemptAffordableTokens: postAbortAffordable,
            priorAttemptMaxTokens: currentCap,
          }),
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ⭐ FAIL-LOUD DRIFT PIN. The defect was not a wrong number — it was a SECOND
// PLACE that could hold a number. These assertions fail the build if a module
// re-acquires the raw floor constant and is thereby one `Math.max` away from
// re-encoding the rule. They read the source at the bytes; a derived check is
// impossible here because the thing being prevented is a future hand-edit.
// ---------------------------------------------------------------------------
describe('DRIFT PIN — only ONE module may hold the raw token floor', () => {
  const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

  it('the Anthropic adapter does NOT import LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR', () => {
    // It used to, and it used it in a bare `<` comparison that dropped half the
    // rule. It now names the floor via `viableDraftRetryFloorTokens`, which is
    // derived from the same function the gate uses.
    const src = read('src/adapters/llm/anthropic.ts');
    const importLines = src
      .split('\n')
      .filter((l) => l.trimStart().startsWith('import') || /^\s+[A-Za-z_]+,?$/.test(l));
    expect(importLines.join('\n')).not.toContain('LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR');
  });

  it('exactly two src modules reference the raw floor: its definition, and the ONE derivation', () => {
    // `config/timeouts.ts` defines it and is the only place that compares
    // against it (inside `viableDraftRetryFloorTokens`). `draft-budget.ts` uses
    // it ARITHMETICALLY to derive DRAFT_RUNAWAY_MIN_RETRY_MS — the time-domain
    // twin of the same floor — which is a derivation, not a second encoding.
    // Anything else is a new mirror and must be justified by editing this pin.
    const allowed = new Set(['src/config/timeouts.ts', 'src/adapters/llm/draft-budget.ts']);
    const hits = execGrepSrc('LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR');
    expect(new Set(hits)).toEqual(allowed);
  });

  it('the shared rule and the floor helper agree by construction (no third floor can exist)', () => {
    for (const prior of [0, 1_000, 2_699, 2_700, 8_550, 20_000]) {
      const floor = viableDraftRetryFloorTokens(prior);
      expect(isDraftRetryAffordable(floor, prior)).toBe(true);
      expect(isDraftRetryAffordable(floor - 1, prior)).toBe(false);
      expect(floor).toBeGreaterThanOrEqual(LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR);
    }
  });
});

/**
 * Strip block and line comments so the scan below matches EXECUTABLE references
 * only. Prose that names the constant — the RCA comments that explain why the
 * mirror was removed — must not trip the pin; a comment cannot hold a floor.
 * Deliberately crude (no string-literal awareness): the symbol never appears
 * inside a string literal in this codebase, and a false positive here fails
 * loudly and visibly rather than passing silently, which is the correct bias.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Recursive source scan for an EXECUTABLE reference to a symbol under `src/`,
 * excluding test directories. Returns repo-relative paths. Kept local so the pin
 * has no dependency on a shell or a lint plugin being present in the test
 * environment.
 */
function execGrepSrc(symbol: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    // `withFileTypes` classifies each entry from the SAME directory read that
    // produced it. A separate `statSync(path)` followed by `readFileSync(path)`
    // is a check-then-use race (CodeQL js/file-system-race) — avoided by
    // construction rather than suppressed.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name === '__tests__' || name === 'node_modules' || name === 'generated') continue;
      const abs = join(dir, name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      if (stripComments(readFileSync(abs, 'utf8')).includes(symbol)) {
        out.push(abs.slice(REPO_ROOT.length + 1));
      }
    }
  };
  walk(join(REPO_ROOT, 'src'));
  return out;
}
