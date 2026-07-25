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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ PARTIALLY SUPERSEDED 2026-07-25 (FAST-ABORT LANE). #675 was right that a
 * doomed retry must never be funded and right that both sites must agree. Its
 * YARDSTICK was wrong: it compared the retry budget against the cap of the
 * ABANDONED attempt. That premise ("a model that could not fit N tokens
 * re-truncates in anything less") describes a generation that tried to fit a
 * graph and overflowed — and a runaway is not that. Over 29 live runs
 * (`parallel-briefs/TOKEN-CEILING-EXPERIMENT-2026-07-25.md`): 17/17 runaways
 * NEVER emitted an edge (`time_to_edges_ms` NULL, `edges: Required`) and
 * consumed `completion_tokens == the cap, exactly` at 8,550, 12,000 AND 16,000,
 * while 12/12 successful drafts finished in 1,652-2,271 tokens at every ceiling.
 * A runaway's cap carries no demand information, so sizing its retry from that
 * cap demanded the impossible and left the detector unreachable
 * (`runaway_abort_count: 0` on all 30 observations).
 *
 * The RUNAWAY gates therefore now use `isRunawayRetryAffordable` (an evidence-
 * derived converged-draft requirement, 3,407 — STRICTER than the 2,700 floor
 * #675 shipped). The tests below that asserted the prior-cap yardstick are
 * re-aimed, individually annotated, and the flipped expectations are stated
 * openly rather than quietly deleted. What #675 established that STILL HOLDS —
 * one rule, one floor, no second encoding, no authorise-then-refuse — is
 * asserted harder than before, here and in `draft-fast-abort-yardstick.test.ts`.
 *
 * `isDraftRetryAffordable` itself is UNCHANGED and still governs parse.ts's lean
 * retry, where a natural max_tokens truncation genuinely IS a demand signal.
 * ─────────────────────────────────────────────────────────────────────────────
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
  isRunawayRetryAffordable,
  viableDraftRetryFloorTokens,
} from '../../../config/timeouts.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The full-window attempt-1 cap at the derived timeout (8,550 at defaults). */
const FULL_CAP = resolveDraftMaxTokens(DRAFT_LLM_TIMEOUT_MS).effective;

describe('THE REGRESSION — the exact live A2killer arithmetic must still be refused', () => {
  it('reproduces the observed cap: two hard-ceiling aborts leave a window affording ~3,150 tokens', () => {
    // ⚠ RE-DERIVED 2026-07-25: the hard ceiling moved 30s -> 25s, so two aborts
    // now leave 60s, not 50s. The 50s/3,150 pair is preserved BELOW as the
    // historical fact the live census was measured at — it is what the 18
    // failures died against and must stay legible.
    const windowAfterTwoAborts = DRAFT_LLM_TIMEOUT_MS - 2 * DRAFT_RUNAWAY_HARD_CEILING_MS;
    expect(windowAfterTwoAborts).toBe(60_000);
    expect(getAffordableDraftTokens(windowAfterTwoAborts)).toBe(4_050);
    // The historical arithmetic, kept as evidence: at the 30s ceiling the third
    // rung was funded at 3,150 tokens and failed 18/18.
    expect(getAffordableDraftTokens(50_000)).toBe(3_150);
  });

  it('THE #675 FIX STILL HOLDS: a 3,150-token final attempt is SKIPPED, not run', () => {
    // The live defect, still refused — now because 3,150 cannot fund a converged
    // draft (3,407 required), rather than because it cannot re-fund 8,550. Same
    // verdict on the case that mattered, from a premise that is actually true.
    expect(
      shouldSkipDoomedFinalAttempt({
        runawayAbortCount: 2,
        willBeFinalAttempt: true,
        thinkingEnabled: false,
        finalAttemptAffordableTokens: getAffordableDraftTokens(50_000),
      }),
    ).toBe(true);
    expect(isRunawayRetryAffordable(getAffordableDraftTokens(50_000))).toBe(false);
  });

  it('THE OLD GATE would have let it run — the 2,700-only floor is satisfied by 3,150', () => {
    // Documents WHY the gate was silent: this is the condition that used to be
    // in anthropic.ts, evaluated on the real numbers. It is false, i.e. "do not
    // skip". Any future edit that reintroduces a bare-floor comparison
    // reintroduces exactly this.
    const finalAttemptAffordableTokens = getAffordableDraftTokens(50_000);
    expect(finalAttemptAffordableTokens < LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR).toBe(false);
    // …while BOTH aligned rules refuse it. The runaway rule is the one the
    // adapter now uses; the prior-cap rule still governs the lean retry.
    expect(isRunawayRetryAffordable(finalAttemptAffordableTokens)).toBe(false);
    expect(isDraftRetryAffordable(finalAttemptAffordableTokens, FULL_CAP)).toBe(false);
  });

  it('the observed live caps: the starved 16 are refused, the 2 above the requirement are funded', () => {
    // The complete census from results.jsonl, not a representative sample.
    const observedCaps = [
      3146, 3147, 3147, 3147, 3147, 3147, 3148, 3148, 3148,
      3148, 3148, 3148, 3148, 3148, 3149, 3378, 3419, 3826,
    ];
    expect(observedCaps).toHaveLength(18);
    const skipped = observedCaps.filter((cap) =>
      shouldSkipDoomedFinalAttempt({
        runawayAbortCount: 2,
        willBeFinalAttempt: true,
        thinkingEnabled: false,
        finalAttemptAffordableTokens: cap,
      }),
    );
    // ⚠ FLIPPED, AND STATED PLAINLY: this used to assert all 18. 3,419 and 3,826
    // clear the converged-draft requirement (3,407) and are now funded — which is
    // right: a 3,419-token budget can produce the 2,271-token graph that is the
    // largest any successful draft has ever needed. #675 refused them only
    // because it measured against the 8,550-token cap of an attempt that never
    // emitted an edge. The dominant band (15 of 18 inside 3,146-3,149) is
    // entirely refused, and that band is what failed 18/18 live.
    expect(skipped).toHaveLength(16);
    expect(observedCaps.filter((c) => !skipped.includes(c) || c >= 3_407)).toContain(3_826);
    for (const cap of observedCaps.filter((c) => c <= 3_149)) {
      expect(isRunawayRetryAffordable(cap)).toBe(false);
    }
  });
});

describe('shouldSkipDoomedFinalAttempt — the preconditions that keep it from over-firing', () => {
  const base = {
    runawayAbortCount: 2,
    willBeFinalAttempt: true,
    thinkingEnabled: false,
    finalAttemptAffordableTokens: 3_150,
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

  it('does NOT skip a final attempt that CAN fund a converged draft', () => {
    expect(
      shouldSkipDoomedFinalAttempt({
        ...base,
        finalAttemptAffordableTokens: FULL_CAP,
      }),
    ).toBe(false);
  });

  it('is exactly the negation of the shared runaway rule wherever its preconditions hold', () => {
    for (const affordable of [0, 1_500, 2_699, 2_700, 3_150, 3_406, 3_407, 6_800, FULL_CAP, FULL_CAP + 1]) {
      expect(
        shouldSkipDoomedFinalAttempt({
          runawayAbortCount: 1,
          willBeFinalAttempt: true,
          thinkingEnabled: false,
          finalAttemptAffordableTokens: affordable,
        }),
      ).toBe(!isRunawayRetryAffordable(affordable));
    }
  });

  it('⭐ the gate NO LONGER depends on the abandoned cap — it cannot, the parameter is gone', () => {
    // The structural guarantee behind the fix: `priorAttemptMaxTokens` is not in
    // the parameter type, so a future edit cannot quietly start comparing
    // against it again without changing the signature. Type-level, plus this
    // behavioural check that the decision is a pure function of the budget.
    for (const affordable of [1_000, 3_406, 3_407, 10_000]) {
      const verdict = shouldSkipDoomedFinalAttempt({
        runawayAbortCount: 3,
        willBeFinalAttempt: true,
        thinkingEnabled: false,
        finalAttemptAffordableTokens: affordable,
      });
      expect(verdict).toBe(affordable < 3_407);
    }
  });
});

describe('isAbortableRetryViable — the abort must not create a window the skip-gate will refuse', () => {
  it('⭐ FLIPPED: the DEFAULT REGIME now DOES authorise the abort — that was the whole defect', () => {
    // ⚠ This assertion is the inverse of what it was. It used to read "a
    // full-budget attempt-1 authorises NO abort", which was TRUE of the code and
    // was the bug: the detector could never fire at default configuration
    // (`runaway_abort_count: 0` on all 30 live observations).
    //
    // The arithmetic it was built on is still TRUE and still asserted — the
    // post-abort window genuinely cannot re-fund the abandoned cap. What changed
    // is that this is no longer the question being asked.
    expect(hasRoomForAnotherAbortableAttempt(DRAFT_LLM_TIMEOUT_MS, 0)).toBe(true);
    const postAbortAffordable = getAffordableDraftTokens(
      DRAFT_LLM_TIMEOUT_MS - DRAFT_RUNAWAY_HARD_CEILING_MS,
    );
    expect(postAbortAffordable).toBe(6_300);
    expect(postAbortAffordable).toBeLessThan(FULL_CAP);        // still cannot re-fund 8,550
    expect(isDraftRetryAffordable(postAbortAffordable, FULL_CAP)).toBe(false);
    // …but 6,300 tokens is ~2.8x the largest successful draft ever measured, so
    // the retry is genuinely viable and the abort is authorised.
    expect(isRunawayRetryAffordable(postAbortAffordable)).toBe(true);
    expect(isAbortableRetryViable(DRAFT_LLM_TIMEOUT_MS, 0)).toBe(true);
  });

  it('the mechanism is also armed under a REDUCED attempt-1 ceiling (unchanged property)', () => {
    // A caller-supplied ceiling lowers what the retry would really get, so the
    // gate is computed against that — a ceiling far below the requirement still
    // refuses the abort.
    expect(isAbortableRetryViable(DRAFT_LLM_TIMEOUT_MS, 0, 6_000)).toBe(true);
    expect(isAbortableRetryViable(DRAFT_LLM_TIMEOUT_MS, 0, 3_407)).toBe(true);
    expect(isAbortableRetryViable(DRAFT_LLM_TIMEOUT_MS, 0, 3_406)).toBe(false);
  });

  it('still respects the time reserve and the runaway backstop', () => {
    expect(isAbortableRetryViable(1_000, 0)).toBe(false);
    expect(isAbortableRetryViable(10_000_000, DRAFT_MAX_RUNAWAY_RETRIES)).toBe(false);
  });

  it('NEVER authorises an abort the skip-gate would then refuse (the contradiction #673 fixed, one level up)', () => {
    // Sweep the real domain. For every authorised abort, the window it leaves
    // must pass the very gate that runs at the next loop top.
    let authorised = 0;
    for (let remaining = 0; remaining <= 200_000; remaining += 500) {
      for (const ceiling of [undefined, 8_550, 4_000]) {
        if (!isAbortableRetryViable(remaining, 1, ceiling)) continue;
        authorised++;
        const postAbortWindow = remaining - DRAFT_RUNAWAY_HARD_CEILING_MS;
        const postAbortAffordable = resolveDraftMaxTokens(Math.max(0, postAbortWindow), ceiling).effective;
        expect(
          shouldSkipDoomedFinalAttempt({
            runawayAbortCount: 2,
            willBeFinalAttempt: true,
            thinkingEnabled: false,
            finalAttemptAffordableTokens: postAbortAffordable,
          }),
        ).toBe(false);
      }
    }
    // POSITIVE CONTROL — an absence claim over a sweep that authorises nothing
    // is vacuous. Before the fix this counter would have been 0 for the
    // full-cap cases; it must now be substantial.
    expect(authorised).toBeGreaterThan(100);
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

  it('exactly ONE src module references the raw floor: its own definition', () => {
    // ⚠ STRENGTHENED 2026-07-25. This used to allow `draft-budget.ts` as well,
    // because DRAFT_RUNAWAY_MIN_RETRY_MS was derived from the raw floor there.
    // That derivation now goes through `viableRunawayRetryFloorTokens()`, so the
    // raw constant is reachable from exactly one module. Anything else is a new
    // mirror and must be justified by editing this pin.
    const allowed = new Set(['src/config/timeouts.ts']);
    const hits = execGrepSrc('LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR');
    // POSITIVE CONTROL: the scanner must SEE the definition, or the set equality
    // below could be satisfied by a scanner that finds nothing.
    expect(hits).toContain('src/config/timeouts.ts');
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
