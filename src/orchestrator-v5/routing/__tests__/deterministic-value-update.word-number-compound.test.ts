/**
 * End-to-end regression lock for the CQE word-number compound silent
 * wrong-value defect, at the seam where it actually bites: the deterministic
 * value-update pre-route.
 *
 * THE DEFECT (live, verified at the bytes on origin/staging tip eb792d81):
 * "set support ticket load to one hundred and forty" ran the CQE word-number
 * pre-pass, which folded the lead fragment "one" → "1" ("…to 1 hundred and
 * forty"), CQE extracted value 1, and `tryDeterministicValueUpdate` committed
 * 1 — a confident, zero-LLM wrong value reachable by any user typing a
 * compound word-number in chat.
 *
 * THE FIX lives in cqe/word-numbers.ts (compound guard). This file drives the
 * REAL extractor (`extractQuantities`) through the REAL pre-route so the whole
 * chain is exercised: pre-pass → CQE extraction → dispatch decision. It is the
 * anti-regression pin for the reported "commits 1" symptom.
 *
 * Mutation-check: revert the guard in word-numbers.ts and the "falls through to
 * the LLM" test goes RED — `extractQuantities` yields value 1 and the pre-route
 * returns matched:true committing 1.
 */

import { describe, it, expect } from 'vitest';

import { extractQuantities } from '../../context/cqe/extract-quantities.js';
import type { GraphLookup } from '../validator.js';
import { tryDeterministicValueUpdate } from '../deterministic-value-update.js';

function makeGraph(
  factors: ReadonlyArray<{ id: string; label: string | null }>,
): GraphLookup {
  const byId = new Map(factors.map((f) => [f.id, f]));
  return {
    findEntityById: (id) => {
      const f = byId.get(id);
      return f ? { id: f.id, kind: 'node', label: f.label } : null;
    },
    listEntitiesByKind: (kind) => {
      if (kind !== 'node') return [];
      return factors.map((f) => ({ id: f.id, label: f.label }));
    },
  };
}

const GRAPH = makeGraph([{ id: 'fac_load', label: 'support ticket load' }]);
const FACTOR_IDS = new Set(['fac_load']);

function dispatch(message: string) {
  return tryDeterministicValueUpdate(
    message,
    extractQuantities(message),
    GRAPH,
    [],
    FACTOR_IDS,
    false,
  );
}

describe('deterministic value-update — compound word-number falls through, never commits a fragment', () => {
  // THE PIN: the verbatim live case must NOT deterministically commit 1. It
  // must fall through to the LLM (no CQE quantity → skip_reason 'no_quantity').
  it('"set support ticket load to one hundred and forty" → falls through to the LLM (never commits 1)', () => {
    const message = 'set support ticket load to one hundred and forty';
    // The extractor finds nothing — the fragment "1" is never manufactured.
    expect(extractQuantities(message)).toEqual([]);
    const result = dispatch(message);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_quantity');
  });

  // POSITIVE CONTROL 1 — digits still take the deterministic fast-path.
  it('"set support ticket load to 140" (digits) → commits 140 deterministically', () => {
    const result = dispatch('set support ticket load to 140');
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_load');
    expect(result.quantity.value).toBe(140);
  });

  // POSITIVE CONTROL 2 — a genuine SINGLE word-number still folds and commits.
  it('"set support ticket load to one" (genuine single) → commits 1 deterministically', () => {
    const result = dispatch('set support ticket load to one');
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    expect(result.quantity.value).toBe(1);
  });

  // A representative spread of the other silent-wrong-value classes: none may
  // commit a fragment value; every one must fall through to the LLM. Covers
  // compound cardinals, the mixed-fraction "and a <fraction>" tail (else "one
  // and a half" commits 1, not 1.5), and the spoken decimal "point" (else "one
  // point five" commits 1, not 1.5).
  const COMPOUND_MESSAGES: readonly string[] = [
    'set support ticket load to five hundred',
    'set support ticket load to two hundred and fifty',
    'set support ticket load to one hundred thousand',
    'set support ticket load to twenty five thousand',
    'set support ticket load to forty five',
    'set support ticket load to five grand',
    'set support ticket load to one and a half',
    'set support ticket load to two and a quarter',
    'set support ticket load to one point five',
    'set support ticket load to one point five million',
  ];

  it.each(COMPOUND_MESSAGES)('non-atomic quantity "%s" → no deterministic commit (no_quantity)', (message) => {
    expect(extractQuantities(message)).toEqual([]);
    const result = dispatch(message);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_quantity');
  });
});
