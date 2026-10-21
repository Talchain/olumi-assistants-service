/**
 * V5 post-analysis interaction contract v1 — edit-lifecycle regression locks.
 *
 * Verifies the analytical-intent mutation patterns (analytical-intent.ts) do
 * not regress the edit-lifecycle behaviour shipped by PR #192 (deterministic
 * from/to value edits): a concrete value edit, even wrapped in advice
 * phrasing, carries a mutation signal; bare advice phrasing does not.
 *
 * (The post-analysis advice gate these locks once also drove was unreachable
 * from `src/server.ts` and has been deleted.)
 *
 * Lightweight by design — the canonical edit-lifecycle coverage lives
 * in `deterministic-value-update.test.ts`,
 * `deterministic-value-update.from-to.test.ts` and `vague-edit-guard.test.ts`.
 */

import { describe,expect,it } from 'vitest';

import { hasMutationSignal } from '../analytical-intent.js';

// =========================================================================
// PR #192 — concrete edits with "to <value>" still mutate
//
// value-update-pre-route (turn-executor.ts) owns these.
// =========================================================================
describe('PR #192 regression — concrete value-edit phrases still mutate', () => {
  const concreteEdits: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'Set Pricing to £100', label: 'set + to numeric (existing)' },
    { message: 'Change Pricing from £80 to £100', label: 'from/to (PR #192 deictic)' },
    { message: 'Tell me what to change Pricing to £100', label: 'advice prefix + concrete to-value' },
    { message: 'Tell me what to change Pricing from £80 to £100', label: 'advice prefix + from/to' },
    { message: 'What needs to change? Set delivery risk to 0.7.', label: 'advice question + bare set' },
    { message: 'Help me figure out what to change — adjust budget to 200', label: 'help-me + adjust-to-value' },
  ];

  for (const { message, label } of concreteEdits) {
    it(`hasMutationSignal === true: ${label}`, () => {
      expect(hasMutationSignal(message)).toBe(true);
    });
  }

  it('"Tell me what to change" (no value) stays advice — does NOT mutate', () => {
    expect(hasMutationSignal('Tell me what to change.')).toBe(false);
    expect(hasMutationSignal('What needs to change?')).toBe(false);
    expect(hasMutationSignal('Show me what to update.')).toBe(false);
  });
});
