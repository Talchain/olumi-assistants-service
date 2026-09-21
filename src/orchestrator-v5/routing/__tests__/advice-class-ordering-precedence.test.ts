/**
 * `advice` MUST REMAIN THE LAST CLASS — AND NOTHING ASSERTED IT UNTIL NOW.
 *
 * #1369 added `matchedClass === 'advice'` to the reasoning-request conjunct, so
 * the whole open-ended `advice` class now falls through to the contextual
 * router instead of being answered by a frozen deterministic template with
 * `llm_calls_used: 0`. That is the right change, and it is SAFE FOR ONE REASON
 * ONLY: `CLASS_PATTERNS` is scanned with `break` on first match, and `advice`
 * sits LAST — indices 51–63 of 64, across 9 classes. Every more specific class
 * matches first and keeps its deterministic answer.
 *
 * ⚠ THE SAFETY ARGUMENT IS AN ORDERING FACT THAT NOTHING PINS. Reorder
 * `CLASS_PATTERNS` — a tidy-up, an alphabetisation, a merge that moves a
 * block — and specific classes start diverting to the LLM with every existing
 * test green, because no existing test distinguishes "answered deterministically"
 * from "answered by the model". Silent, and it undoes the merged change.
 *
 * ⭐ THE OVERLAPS BELOW ARE REAL, NOT HYPOTHETICAL. Derived from the patterns:
 *
 *   update_advice  /\bhow\s+(?:should|do|would|can|might)\s+(?:we|i|you)\s+update\b/i
 *   advice         /\bhow\s+(?:should|do|would|can|might)\s+(?:we|i|you)\b/i
 *
 * "How should we update the model?" matches BOTH. It resolves to
 * `update_advice` purely because `update_advice` is earlier in the array. The
 * same holds for `improvement` against advice's `what should we` pattern.
 *
 * So these are not decorative ordering assertions — each message is one a real
 * user types, and each would change destination on a reorder. `CLASS_PATTERNS`
 * is module-private, so this binds BEHAVIOURALLY through the exported gate,
 * which is the stronger form anyway: it pins the property (specific classes
 * still answer deterministically), not the implementation detail (array index).
 */
import { describe, expect, it } from 'vitest';

import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
} from '../post-analysis-advice-gate.js';
import type { GraphPatchBlockData } from '../../../orchestrator/types.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

const FIXTURE_ANALYSIS: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Hire two senior engineers locally' },
  runner_up: { label: 'Hire one senior engineer overseas' },
  top_drivers: [{ factor_label: 'Delivery risk' }, { factor_label: 'Cost overrun risk' }],
  fragile_edges: [{ from_label: 'Delivery risk', to_label: 'Successful launch' }],
};

const READY_PAYLOAD_OPEN: AnalysisReadyPayload = {
  goal_node_id: 'goal_1',
  status: 'needs_user_mapping',
  options: [
    { option_id: 'opt_a', label: 'Hire two senior engineers locally', status: 'needs_user_mapping', interventions: {} },
    { option_id: 'opt_b', label: 'Hire one senior engineer overseas', status: 'needs_encoding', interventions: {} },
  ],
};

/**
 * ⚠ `freshness: 'fresh'` IS LOAD-BEARING AND THE FIRST VERSION OF THIS FILE
 * OMITTED IT. The gate returns `not_fresh` at line ~1359, BEFORE it classifies
 * anything, so every case below fell through on freshness and never reached the
 * ordering logic this file exists to pin. All three assertions "failed", which
 * is the lucky direction — had the expectations been written the other way
 * round they would have PASSED while testing nothing at all.
 *
 * The contrast control is what exposed it: it expected `reasoning_request` and
 * got `not_fresh`, naming the short-circuit outright.
 */
const run = (message: string) =>
  tryPostAnalysisAdviceGate({
    message,
    analysis: FIXTURE_ANALYSIS,
    analysisReady: READY_PAYLOAD_OPEN,
    freshness: 'fresh',
  });

/**
 * Messages that match a SPECIFIC class AND an `advice` pattern. Each one changes
 * destination if `advice` stops being last — from a deterministic answer to the
 * LLM router.
 */
const SHADOWABLE: ReadonlyArray<{
  readonly message: string;
  readonly expected: string;
  readonly alsoMatchesAdvicePattern: string;
}> = [
  {
    message: 'How should we update the model?',
    expected: 'update_advice',
    alsoMatchesAdvicePattern: 'how (should|do|would|can|might) (we|i|you)',
  },
  {
    message: 'What should we improve?',
    expected: 'improvement',
    alsoMatchesAdvicePattern: 'what should (we|i|you)',
  },
];

describe('`advice` must remain the LAST class — specific classes keep precedence', () => {
  it.each(SHADOWABLE)(
    'PRECONDITION: "$message" really does match an `advice` pattern too — otherwise this case proves nothing',
    ({ message, alsoMatchesAdvicePattern }) => {
      // Pins the collision IN-TEST. If the `advice` pattern this case relies on
      // is ever narrowed, the case stops being a shadowing test and would go on
      // passing for the wrong reason — a guard agreeing with itself.
      const overlaps = new RegExp(
        alsoMatchesAdvicePattern.replace(/\(/g, '(?:'),
        'i',
      ).test(message);
      expect(
        overlaps,
        'this message no longer overlaps the advice pattern it was chosen for',
      ).toBe(true);
    },
  );

  it.each(SHADOWABLE)(
    '"$message" resolves to $expected, NOT diverted to the router',
    ({ message, expected }) => {
      const outcome = run(message);
      // The failure this guards against is precisely `reasoning_request`: that
      // is what `advice` returns, so a reorder shows up here and nowhere else.
      if (!outcome.matched) {
        expect(
          outcome.reason,
          `"${message}" fell through as "${outcome.reason}" — if this is ` +
            '"reasoning_request", `advice` is no longer last in CLASS_PATTERNS ' +
            'and #1369 has been silently undone.',
        ).not.toBe('reasoning_request');
      }
      expect(outcome.matched ? outcome.advice_class : null).toBe(expected);
    },
  );

  it('CONTRAST CONTROL: a bare advice message DOES divert — the guard is not blanket', () => {
    // Without this, every assertion above would still pass if the gate had
    // stopped diverting anything at all, which is the opposite regression.
    const outcome = run('What do you recommend?');
    expect(outcome.matched).toBe(false);
    expect(outcome.matched ? null : outcome.reason).toBe('reasoning_request');
  });
});
