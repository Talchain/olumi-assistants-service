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
import {
  ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE,
  enforceAnalysisAuthorityUnavailableAtEgress,
} from '../../compose/analysis-authority-unavailable-notice.js';
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
  it('this controller expresses NO opinion about the LEADING-OPTION claim permission — the exit inherits it', () => {
    // ⚠⚠ WHICH CLAIM. Named in the title after a reviewer showed the old
    // wording invited a conflation, and they were right: "the claim
    // permission" reads as though it covers every claim this layer can make.
    // It does not. What the exit inherits is `claimSafety.forExit()` —
    // `{ mayNameLeadingOption, mayNameLeadingOptionProvenance, exitFreshness }`
    // (`turn-claim-safety.ts:314-324`). **That is the LEADER claim.**
    //
    // ⛔ THE *SAVE* CLAIM IS A DIFFERENT QUESTION AND IS NOT COVERED HERE OR
    // ANYWHERE ON THIS EXIT. A reply asserting a change was made travels
    // verbatim — `to-run-result.ts` passes `assistant_text` through, and no
    // truthfulness guard runs on this path. Two claims under one word is trap
    // 21, and this sentence was the place it would have been inherited.
    //
    // The save claim is now MEASURED rather than guarded, in
    // `__tests__/unbacked-change-claim.test.ts` and the per-turn record's
    // `claimed_change_without_receipt`. Measured is not guarded; the remedy is
    // a copy decision and is not this lane's to take.

    // ⛔ THIS TEST REPLACES ONE THAT PINNED THE OPPOSITE, AND THE REPLACEMENT
    // IS THE POINT.
    //
    // It used to assert that `shapeRunResult` emits `scenario_fact` when
    // `analysisExists` is true and `no_analysis_exists` when it is false, and
    // that neither is the wiping provenance. Every one of those assertions
    // passed. They were all true. And the property they certified was
    // worthless, because the ONLY production call site passed the literal
    // `analysisExists: false` — so the "verdict" was a constant, and the test
    // proved a mapping nothing exercised.
    //
    // That is this estate's signature test defect in miniature: a green
    // assertion over an input space the product never visits (CLAUDE.md trap
    // 16-inverse — a fixture you wrote yourself is not evidence about the
    // wire). The permission now comes from the canonical turn-entry read,
    // spread into the exit as `...(await claimSafety.forExit())`, and the
    // honest thing for this module to assert is that it no longer has an
    // opinion to be wrong about.
    const shaped = shapeRunResult({
      turn: turn('x'), stage: 'frame', commitPerformed: true, wallClockMs: 1,
    });
    expect(Object.keys(shaped).sort()).toEqual(['response', 'telemetry']);
    expect(shaped).not.toHaveProperty('mayNameLeadingOption');
    expect(shaped).not.toHaveProperty('mayNameLeadingOptionProvenance');
  });

  it('⚠ the exit IS wipeable under one inherited provenance, and that was chosen', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // A DELIBERATE BEHAVIOUR CHANGE, PINNED SO IT IS NOT REDISCOVERED AS A BUG.
    //
    // While the exit passed a hardcoded permission, `fail_closed_unavailable`
    // was unreachable here and the analysis-authority wipe could never fire on
    // a coaching answer. Inheriting the canonical verdict makes it reachable:
    // `readMayNameLeadingOptionVerdict` returns it when the scenario-scoped
    // analysis read FAILED and the turn window was not truncated. Combined
    // with `answerKind: 'substantive'`, the whole reply — text, blocks, chips,
    // insights — is then replaced by ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE.
    //
    // ⭐ WHY NO EXEMPTION WAS ADDED, since one was considered and is the
    // tempting move: this layer's `read_results` now says the unreadable case
    // in its own, more precise words, so a bypass looked justified. It is not.
    // The wipe's stated justification is that substantive prose "may contain
    // arbitrary model prose, including the exact false claim this guard closes
    // ('no analysis has run')" — and a TOOL refusal cannot bind what the model
    // writes from its own head. Carving out the newest, least-proven exit from
    // an existing safety guard, to protect that exit's own output, is the move
    // this estate keeps paying for. The cost is losing one good answer on a
    // genuine store outage; the notice is honest and names a next step.
    //
    // The two conditions are NOT the same, which is what keeps the honest
    // sentence reachable in the common case: this exit's snapshot reports
    // "could not read" whenever the scenario fact CARRIER is absent, degraded
    // or unattested, while the wipe needs the narrower scenario-scoped
    // newest-fact READ to have failed. Where only the former holds, no wipe
    // fires and `read_results`' precise sentence ships.
    // ═══════════════════════════════════════════════════════════════════════
    const shaped = shapeRunResult({
      turn: turn('A good answer about something else entirely.'),
      stage: 'frame',
      commitPerformed: true,
      wallClockMs: 1,
    });
    const wiped = enforceAnalysisAuthorityUnavailableAtEgress(shaped.response, {
      answerKind: 'substantive',
      egressOk: true,
    });
    expect(wiped.mode).toBe('substantive_replaced');
    expect(wiped.response.assistant_text).toBe(ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE);

    // DISCRIMINATING CONTROL: the same call under the other answerKind
    // preserves the text and appends. Without this the assertion above could
    // pass on an enforcement that replaces everything unconditionally, and
    // would tell us nothing about which lever decides it.
    const preserved = enforceAnalysisAuthorityUnavailableAtEgress(shaped.response, {
      answerKind: 'functional',
      egressOk: true,
    });
    expect(preserved.mode).toBe('functional_preserved');
    expect(preserved.response.assistant_text).toContain('A good answer about something else');
  });

  it('every stage the ingress can carry passes egress validation', () => {
    // `stage_indicator` is a FOUR-member enum, and a value outside it fails
    // validation and replaces the whole reply with a generic error. The route
    // branch forwards `ingress.stage`, which is the same four-member enum —
    // enumerated here rather than assumed, because a contract drift on either
    // side would blank every turn on this path.
    for (const stage of ['frame', 'analyse', 'decide', 'review'] as const) {
      const shaped = shapeRunResult({
        turn: turn('A real answer.'), stage, commitPerformed: true, wallClockMs: 1,
      });
      const r = validateEgress(sanitiseOlumiResponseForEgress(shaped.response, CTX), 'req-1');
      expect(r.ok, `stage "${stage}" must pass egress validation`).toBe(true);
    }
  });

  it('commit_performed is true on the success path — false would ship a non-200', () => {
    const shaped = shapeRunResult({
      turn: turn('x'), stage: 'frame', commitPerformed: true, wallClockMs: 1,
    });
    expect(shaped.telemetry.commit_performed).toBe(true);
    expect(shaped.telemetry.failure_type).toBeNull();
    expect(shaped.telemetry.response_emitted).toBe(true);
  });
});
