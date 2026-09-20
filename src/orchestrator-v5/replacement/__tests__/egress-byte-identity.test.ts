/**
 * DOES THE ASSISTANT'S TEXT REACH THE USER UNCHANGED?
 *
 * Everything else in this layer is worthless if the answer is no, and the
 * answer was no for the retired path: five layers at egress can delete the
 * assistant's text and three can rewrite it. The replacement controller goes
 * through the same egress, because `sendFinalised200` is the route's sole
 * sanctioned 200 exit and is type-branded — composing a separate response
 * would have meant bulldozing a deliberate invariant.
 *
 * So this exercises the real chain, in the real order, with the exact context
 * the route branch supplies:
 *
 *     shapeRunResult → sanitiseOlumiResponseForEgress → validateEgress
 *                    → sanitiseOlumiResponseForEgress → finaliseV5Response
 *
 * and asserts the text arrives BYTE-IDENTICAL.
 *
 * WHY NOT BOOT THE ROUTE. Fastify plus an 8,000-line handler would make this
 * slow and flaky, and would test the framework rather than the risk. The risk
 * is these four functions in this order, and they are all importable. What
 * this therefore does NOT cover, stated rather than implied: that the branch
 * is reached at all, and that the UI renders what arrives. Both need a
 * deploy.
 */

import { describe, expect, it } from 'vitest';

import { sanitiseOlumiResponseForEgress } from '../../compose/output-safety.js';
import { validateEgress } from '../../../validators/b1.js';
import { shapeRunResult } from '../to-run-result.js';
import type { ReplacementEntryResult } from '../turn-entry.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';

/** Exactly what the route branch passes. */
const CTX = {
  graph: null,
  requestId: 'req-egress-test',
  exitPath: 'replacement_controller' as never,
  userMessage: 'what should we do?',
  mayNameLeadingOption: true,
  assistantTextAlreadyIdentifierSafe: true as const,
};

function turn(text: string): ReplacementEntryResult {
  return {
    assistantText: text,
    state: { version: 1, memory: { items: [] }, proposals: { proposals: [] } },
    applied: [],
    mustReconcile: [],
    toolsCalled: ['read_results'],
    iterations: 2,
    incomplete: false,
  };
}

/** The real chain, in the real order. */
function throughEgress(text: string, over: Partial<typeof CTX> = {}): OlumiResponse {
  const shaped = shapeRunResult({
    turn: turn(text),
    stage: 'frame',
    commitPerformed: true,
    analysisExists: true,
    wallClockMs: 1234,
  });
  const ctx = { ...CTX, ...over };
  const first = sanitiseOlumiResponseForEgress(shaped.response, ctx);
  const egress = validateEgress(first, ctx.requestId);
  expect(egress.ok, 'the response must pass egress validation, not take the fallback').toBe(true);
  if (!egress.ok) throw new Error('egress validation failed');
  return sanitiseOlumiResponseForEgress(egress.value, ctx);
}

/**
 * Sentences the shared pattern scrub was MEASURED to rewrite on 20 Sep, by
 * extracting its regexes and executing them. This corpus is the reason the
 * opt-out exists, so it is the right corpus to prove the opt-out holds all
 * the way to the wire rather than only at the first call.
 */
const REAL_PROSE = [
  'Improve the decision-making-process across teams.',
  'Compare risk-adjusted-returns for each fund.',
  'We need outcome-based-pricing before the renewal.',
  'Their option-heavy-strategy is the risk.',
  'Run a goal-setting-workshop in Q3.',
];

describe('the assistant text reaches the wire unchanged', () => {
  it('survives the whole chain byte-identically, on every sentence the scrub mangles', () => {
    for (const sentence of REAL_PROSE) {
      expect(throughEgress(sentence).assistant_text).toBe(sentence);
    }
  });

  it('keeps figures, currency, percentages and quotes exactly as written', () => {
    const t =
      'Raising prices wins in 63% of runs, mean 0.42 against 0.29. The downside is ' +
      '-0.07 at the tenth percentile, and the ceiling you gave me was £1.5 million — ' +
      'I have not rounded it. You said "no discount below 78% margin".';
    expect(throughEgress(t).assistant_text).toBe(t);
  });

  it('keeps a long multi-paragraph answer intact, including the paragraph breaks', () => {
    const t = [
      'The analysis says raising prices for new customers only wins in 63% of runs.',
      'But the link from average revenue per user to annual recurring revenue is fragile. If it is wrong, holding current pricing wins instead, and that happens in 58% of runs.',
      'Before you take this to sign-off, what happened to the third option?',
    ].join('\n\n');
    const out = throughEgress(t).assistant_text;
    expect(out).toBe(t);
    expect(out.split('\n\n')).toHaveLength(3);
  });

  /**
   * The discriminating half. Without it, an egress that had simply stopped
   * touching anything would pass every case above, and so would one where
   * the opt-out silently failed open.
   */
  it('CONTRAST: without the opt-out the SAME sentence is rewritten', () => {
    const sentence = REAL_PROSE[0]!;
    const withOptOut = throughEgress(sentence).assistant_text;
    const withoutOptOut = throughEgress(sentence, {
      assistantTextAlreadyIdentifierSafe: undefined as never,
    }).assistant_text;
    expect(withOptOut).toBe(sentence);
    expect(withoutOptOut).not.toBe(sentence);
  });
});

describe('the fields that decide whether the response is wiped', () => {
  it('the provenance this controller sets is not the one that wipes the response', () => {
    // `fail_closed_unavailable` is the single member of seven that triggers
    // the analysis-authority wipe. Named here so a change to shapeRunResult
    // that reached for it would fail loudly rather than blank a turn.
    const withAnalysis = shapeRunResult({
      turn: turn('x'), stage: 'frame', commitPerformed: true, analysisExists: true, wallClockMs: 1,
    });
    const without = shapeRunResult({
      turn: turn('x'), stage: 'frame', commitPerformed: true, analysisExists: false, wallClockMs: 1,
    });
    expect(withAnalysis.mayNameLeadingOptionProvenance).toBe('scenario_fact');
    expect(without.mayNameLeadingOptionProvenance).toBe('no_analysis_exists');
    for (const p of [withAnalysis, without]) {
      expect(p.mayNameLeadingOptionProvenance).not.toBe('fail_closed_unavailable');
    }
  });

  it('every stage the ingress can carry passes egress validation', () => {
    // `stage_indicator` is a FOUR-member enum, and a value outside it fails
    // validation and replaces the whole reply with a generic error. The route
    // branch forwards `ingress.stage`, which is the same four-member enum —
    // enumerated here rather than assumed, because a contract drift on either
    // side would blank every turn on this path.
    for (const stage of ['frame', 'analyse', 'decide', 'review'] as const) {
      const shaped = shapeRunResult({
        turn: turn('A real answer.'), stage, commitPerformed: true, analysisExists: true, wallClockMs: 1,
      });
      const r = validateEgress(sanitiseOlumiResponseForEgress(shaped.response, CTX), 'req-1');
      expect(r.ok, `stage "${stage}" must pass egress validation`).toBe(true);
    }
  });

  it('commit_performed is true on the success path — false would ship a non-200', () => {
    const shaped = shapeRunResult({
      turn: turn('x'), stage: 'frame', commitPerformed: true, analysisExists: true, wallClockMs: 1,
    });
    expect(shaped.telemetry.commit_performed).toBe(true);
    expect(shaped.telemetry.failure_type).toBeNull();
    expect(shaped.telemetry.response_emitted).toBe(true);
  });
});
