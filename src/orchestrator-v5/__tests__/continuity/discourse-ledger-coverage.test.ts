/**
 * CONTINUITY HARNESS — Tier 1: the derived discourse-ledger coverage guard.
 *
 * WHAT THIS GUARDS
 * ----------------
 * CEE has exactly one discourse-state object — the pending-actions ledger
 * written by `persistAskedQuestion`. It is one turn deep, and at the time of
 * writing it is written at only THREE of the finalised response exits in
 * `route-v2.ts`. Every consumer fails closed, so a MISSING WRITE does not
 * surface as a visible gap: it surfaces as a confident, generic answer. That
 * is why the seam is expensive and why it keeps reopening — nothing anywhere
 * notices when a new exit forgets the ledger.
 *
 * WHY THIS IS DERIVED AND NOT A LIST
 * ----------------------------------
 * A hand-maintained list of "exits that should write the ledger" would drift
 * silently and the drift would read as green — the dominant defect class in
 * this estate. So the counts are DERIVED from the source at test time. The
 * only hand-maintained artefact is the EXEMPTION list, and an exemption is
 * loud by construction: it must name the exit and state a reason, and the
 * guard REDs when the derived numbers move away from it.
 *
 * IT FAILS IN BOTH DIRECTIONS. A new exit without a ledger write REDs (the
 * seam quietly widening). An exit disappearing also REDs (the baseline is
 * stale and every claim resting on it must be re-derived). A guard that only
 * fires when a number grows is half a guard.
 *
 * THE CONTRAST CONTROL IS NOT OPTIONAL. A regex sweep that silently stops
 * matching returns zero, and zero is indistinguishable from "the seam is
 * perfectly covered". So the guard asserts a symbol it EXPECTS to find, in the
 * same read, and fails if that returns zero — proving the instrument can see a
 * presence before any of its absences are believed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROUTE_V2 = join(process.cwd(), 'src/orchestrator/route-v2.ts');

/**
 * Exits that finalise a 200 WITHOUT writing the discourse ledger, each with a
 * stated reason. This is the adjudication surface: the remaining exits get
 * argued about one at a time here, rather than being forgotten.
 *
 * It is deliberately a COUNT plus a rationale rather than a list of line
 * numbers — line numbers churn on every edit and would make this guard a
 * nuisance that gets deleted. What must not change silently is the SHAPE of
 * the seam: how many exits finalise, and how many of them remember.
 */
const LEDGER_EXEMPT_EXIT_COUNT = 20;
const LEDGER_EXEMPT_REASON =
  'Not yet adjudicated. These exits finalise a turn without recording what the turn asked, ' +
  'so the next turn cannot bind an ellipsis, a bare value, or a demonstrative against them. ' +
  'Each should be reviewed individually and either given a write or an explicit exemption.';

/** Exits KNOWN to write the ledger. Derived count is asserted against this. */
const LEDGER_WRITING_EXIT_COUNT = 3;

function readRouteV2(): string {
  const src = readFileSync(ROUTE_V2, 'utf8');
  // Non-empty gate. Two extractions that both produced nothing agree perfectly;
  // every comparison below is worthless if this read came back empty.
  expect(src.length, 'route-v2.ts read came back empty — the guard would be measuring nothing').toBeGreaterThan(10_000);
  return src;
}

function countOccurrences(src: string, pattern: RegExp): number {
  const m = src.match(pattern);
  return m ? m.length : 0;
}

describe('continuity: discourse-ledger coverage (derived, fail-loud)', () => {
  it('CONTRAST CONTROL — the sweep can see a presence before any absence is believed', () => {
    const src = readRouteV2();

    // A symbol we positively expect in this file. If this reads zero, the
    // regex/read is blind and every count below is an artefact of the
    // instrument rather than a fact about the code.
    const contrast = countOccurrences(src, /answeredAskClaim/g);
    expect(
      contrast,
      'CONTRAST CONTROL RETURNED ZERO — the sweep is blind, so no count in this file is trustworthy',
    ).toBeGreaterThan(0);

    // A second, deliberately different expectation: a probe whose answer
    // DIFFERS from the others cannot be faked by a blind instrument.
    const absent = countOccurrences(src, /__thisSymbolShouldNotExistAnywhere__/g);
    expect(absent, 'a symbol that cannot exist was matched — the sweep is over-matching').toBe(0);
  });

  it('derives the finalised-exit count and the ledger-write count', () => {
    const src = readRouteV2();

    const totalMentions = countOccurrences(src, /sendFinalised200\(/g);
    const isDefined = /(?:async\s+)?function\s+sendFinalised200\s*\(/.test(src);
    expect(isDefined, 'sendFinalised200 is no longer defined in route-v2.ts — re-derive this guard').toBe(true);

    // One mention is the definition itself; the rest are call sites (exits).
    const exits = totalMentions - 1;
    const ledgerWrites = countOccurrences(src, /persistAskedQuestion\(/g);

    expect(exits, 'no finalised exits found — the guard is not measuring what it thinks').toBeGreaterThan(0);
    expect(ledgerWrites, 'no ledger writes found at all — either the seam collapsed or the sweep is blind').toBeGreaterThan(0);

    // ---- THE SEAM SHAPE ---------------------------------------------------
    // Fails in BOTH directions. A change here is not necessarily a defect, but
    // it is always something a human must look at.
    expect(
      ledgerWrites,
      `Ledger-writing exits changed (derived ${ledgerWrites}, expected ${LEDGER_WRITING_EXIT_COUNT}). ` +
        'If a write was ADDED, lower LEDGER_EXEMPT_EXIT_COUNT in the same commit and say which exit it was. ' +
        'If a write was REMOVED, the discourse ledger just got thinner — that is a regression in the seam ' +
        'this harness exists to close.',
    ).toBe(LEDGER_WRITING_EXIT_COUNT);

    expect(
      exits - ledgerWrites,
      `Unadjudicated finalised exits changed (derived ${exits - ledgerWrites}, expected ${LEDGER_EXEMPT_EXIT_COUNT}). ` +
        `${LEDGER_EXEMPT_REASON} ` +
        'A NEW exit was almost certainly added without deciding whether it should record what it asked. ' +
        'Decide, then update this constant in the same commit.',
    ).toBe(LEDGER_EXEMPT_EXIT_COUNT);
  });

  it('states the seam honestly: most exits still do not record what they asked', () => {
    const src = readRouteV2();
    const exits = countOccurrences(src, /sendFinalised200\(/g) - 1;
    const writes = countOccurrences(src, /persistAskedQuestion\(/g);
    const coverage = writes / exits;

    // This is not a threshold to game. It is a standing, derived statement of
    // how partial the ledger is, so that "memory is missing" is never again
    // diagnosed as a model problem when it is a WRITE-COVERAGE problem.
    expect(coverage).toBeLessThan(1);
    expect(
      coverage,
      `Discourse-ledger write coverage is ${writes}/${exits} (${(coverage * 100).toFixed(0)}%). ` +
        'Consumers fail closed, so every uncovered exit converts a missing write into a confident generic answer ' +
        'rather than a visible gap.',
    ).toBeGreaterThan(0);
  });
});
