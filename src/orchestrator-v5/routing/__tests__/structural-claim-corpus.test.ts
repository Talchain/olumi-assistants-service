/**
 * FROZEN precision-first behaviour spec (Brief 4 final contract).
 *
 * A 206-item adversarial corpus (7 lenses, machine-generated, then adjudicated
 * against the real classifier) is committed alongside this test. Its purpose is
 * to FREEZE the intended behaviour so future changes cannot silently re-expand
 * the swap target or re-introduce the false-decline class.
 *
 * The safety-critical invariant: items whose category must be PRESERVED
 * (read-outs, advisory, idioms/people, non-graph context, ambiguous edges) must
 * NEVER be swapped — with or without structural-edit intent. Two irreducible
 * residuals that need true syntactic/semantic parsing (#289) are listed
 * explicitly and characterised, so they are visible rather than hidden.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyStructuralClaim } from '../mutation-language.js';

type Item = { text: string; category: string; lens: string };
const corpus = JSON.parse(
  readFileSync(new URL('./fixtures/structural-claim-corpus.json', import.meta.url), 'utf8'),
) as Item[];

const base = { handlerEmittedMutatedGraph: false, proposedHandlerId: null as string | null };
const verdict = (t: string, intent: boolean) =>
  classifyStructuralClaim({ ...base, assistantText: t, structuralEditIntent: intent }).verdict;

// Must-never-swap categories (precision-first preservation guarantee).
const PRESERVE = new Set(['benign_readout', 'advisory', 'idiom_people', 'nongraph', 'ambiguous_edge']);

// Known #289 residuals — text-only limits that still bind a verb to a structural
// noun (mental-model idiom; noun-noun compound). Characterised, not hidden.
const KNOWN_RESIDUAL_SWAPS = new Set([
  'I reworked the model in my head and the second option clearly wins on EVPI.',
  'I added the option scores together to rank them.',
]);

describe('FROZEN corpus — precision-first preservation guarantee', () => {
  it('the corpus fixture is present and sizeable', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(200);
  });

  it('preserve-category items are NEVER swapped (except the 2 characterised #289 residuals)', () => {
    const violations: string[] = [];
    for (const { text, category } of corpus) {
      if (!PRESERVE.has(category)) continue;
      if (KNOWN_RESIDUAL_SWAPS.has(text)) continue;
      if (verdict(text, false) === 'swap' || verdict(text, true) === 'swap') {
        violations.push(`${category}: ${JSON.stringify(text)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the 2 known #289 residuals still swap (characterised — fix should flip these)', () => {
    for (const text of KNOWN_RESIDUAL_SWAPS) {
      expect(verdict(text, false)).toBe('swap');
    }
  });

  // Core guarantee: a real completion claim must swap even when it shares a
  // sentence with a later conditional offer (comma/conjunction). Frozen here so
  // the under-enforcement hole cannot silently reopen.
  it('completion_must_swap items always swap (no mutation → must decline)', () => {
    const mustSwap = corpus.filter((c) => c.category === 'completion_must_swap');
    expect(mustSwap.length).toBeGreaterThanOrEqual(2);
    for (const { text } of mustSwap) {
      expect(verdict(text, false)).toBe('swap');
    }
  });
});
