/**
 * ⭐ ACCEPTANCE: FOUR COACHING INTENTS MUST NOT PRODUCE ONE ANSWER.
 *
 * ── THE OBSERVATION THIS EXISTS TO PIN ─────────────────────────────────────
 * In the 3 Sep 2026 manual session (`olumi-programme-docs`
 * `artefacts/manual-test-2026-09-03/olumi-debug-f2e2df1b-20260903.json`) the
 * user asked four different things of the same model inside three minutes —
 * explain the result (13:46:02Z), what's missing (13:47:11Z), run a pre-mortem
 * (13:47:30Z), walk me through the analysis (13:48:25Z) — and got
 * substantially the same three bullets each time: ICP clarity dominant, the
 * product-gaps story thin, the sales-runway link fragile. Turn indices 16, 13,
 * 12 and 11 in that bundle.
 *
 * ── WHAT AN ACCEPTANCE TEST CAN AND CANNOT ASSERT HERE ─────────────────────
 * It cannot assert the ANSWERS differ. The answers are authored by a model, in
 * a live call, from a ContextPack; asserting on them needs a live key, is
 * non-deterministic, and would be a flaky gate that teaches people to ignore
 * it. What it CAN assert is the half CEE owns and the half that makes four
 * different answers POSSIBLE AT ALL: four materially different REQUESTS. If
 * CEE sends the coach the same framing four times, four different answers are
 * impossible by construction, and no amount of prompt work downstream recovers
 * it.
 *
 * So: the routing message CEE composes for each routed coaching intent, on the
 * SAME model and the SAME stage, must be materially different — measured two
 * ways that do not share a blind spot.
 *
 *   DERIVED   no two intents share a method step, and each names a distinct
 *             clicked request. Catches copy-paste. It is derived from
 *             `INTENT_METHOD`, so it proves the entries are DIFFERENT and can
 *             say nothing about whether any of them is RIGHT (trap 12d).
 *   INDEPENDENT a lexical-overlap ceiling on the fully composed routing
 *             message. Measured over the produced artefact rather than the map
 *             that produced it, so a map whose entries differ only in
 *             boilerplate still REDs.
 *
 * ── ⚠ AND THE HALF THAT IS A FINDING, NOT A FIX ────────────────────────────
 * The last two cases below assert things that are WRONG WITH THE PRODUCT, so
 * they cannot be quietly reworded away:
 *
 *   1. Two of the four affordances the capture exercised — "Explain the
 *      result" and "Walk me through the analysis" — are the SAME chip id and
 *      the SAME `action_type`. They are not two questions. Two of the four
 *      identical answers were the product correctly answering the same
 *      question twice under two labels.
 *   2. Of the seven coaching methods CEE routes, exactly ONE (`pre_mortem`)
 *      has a chip CEE composes. The other six are reachable only from DGAI's
 *      PRE-analysis sparks. After an analysis has run — which is where a user
 *      most wants to challenge, widen or take the outside view — the product
 *      offers no affordance for any of them.
 *
 * Both are pinned as EXACT SETS so that closing either goes deliberately red
 * rather than silently green.
 */

import { describe, expect, it } from 'vitest';

import {
  ROUTED_COACHING_INTENTS,
  buildCoachingMethodDirective,
  composeCoachingRoutingMessage,
} from '../../src/orchestrator-v5/coaching/typed-intent-directive.js';
import { coachingIntentForChipId } from '../../src/orchestrator-v5/coaching/coaching-chip-registry.js';

/** One model, one stage, for every intent — the "same model" half of the claim. */
const STAGE = 'decide';
const USER_MESSAGE = 'Imagine this decision went wrong — what would have caused it?';

const routingMessages = new Map(
  ROUTED_COACHING_INTENTS.map((intent) => [
    intent,
    composeCoachingRoutingMessage(
      USER_MESSAGE,
      buildCoachingMethodDirective(intent, STAGE).directive,
    ),
  ]),
);

/**
 * Content-word overlap between two composed messages, as a fraction of the
 * smaller vocabulary. Deliberately crude and deliberately INDEPENDENT of
 * `INTENT_METHOD`: it reads the produced strings, so two entries that differ
 * only in their shared boilerplate score high and RED.
 *
 * Stop-words are dropped because English function words are common to any two
 * English paragraphs and would compress every score into a narrow band.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'each',
  'for', 'from', 'has', 'have', 'in', 'is', 'it', 'its', 'not', 'of', 'on',
  'one', 'or', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'they',
  'this', 'to', 'up', 'was', 'what', 'when', 'which', 'who', 'will', 'with',
  'you', 'your',
]);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z']+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function overlapFraction(a: string, b: string): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
}

describe('coaching intents — four questions must reach the coach as four requests', () => {
  it('every routed intent composes a routing message that differs from the raw turn', () => {
    // The floor: without a directive the coach sees only the user's words, and
    // every intent is the same request. A green suite here with no directive
    // appended would be the pre-#1321 state.
    for (const [intent, message] of routingMessages) {
      expect(message.startsWith(USER_MESSAGE), `${intent} must preserve the user's words`).toBe(
        true,
      );
      expect(message.length, `${intent} appended no method`).toBeGreaterThan(
        USER_MESSAGE.length + 200,
      );
    }
  });

  it('DERIVED: no two intents share a method step or a clicked request', () => {
    const steps = new Map<string, string>();
    const clicked = new Map<string, string>();
    for (const intent of ROUTED_COACHING_INTENTS) {
      const directive = buildCoachingMethodDirective(intent, STAGE).directive;
      for (const line of directive.split('\n')) {
        if (!line.startsWith('- ')) continue;
        const prior = steps.get(line);
        expect(prior, `method step shared by ${prior} and ${intent}: ${line.slice(0, 60)}`)
          .toBeUndefined();
        steps.set(line, intent);
      }
      const request = directive.split('\n')[1] ?? '';
      const priorRequest = clicked.get(request);
      expect(priorRequest, `${priorRequest} and ${intent} name the same request`).toBeUndefined();
      clicked.set(request, intent);
    }
    // Non-vacuity: the loop must actually have collected steps.
    expect(steps.size).toBeGreaterThanOrEqual(ROUTED_COACHING_INTENTS.length * 3);
  });

  it('INDEPENDENT: no pair of composed routing messages overlaps above the ceiling', () => {
    // ⚠ THE CEILING IS SET FROM A MEASUREMENT, AND THE FIRST NUMBER I WROTE
    // HERE WAS A GUESS THAT RED-ED — recorded because a threshold asserted
    // before it is measured is a fabrication even when it later proves right.
    //
    // MEASURED at this tip, all 21 pairs, stage `decide`:
    //   min  0.50  (outside_view vs pre_mortem, and vs elicit_risks)
    //   max  0.64  (challenge_frame vs pre_mortem)
    //   the floor is high because every composed message shares the user's own
    //   turn plus the directive's fixed header and grounding line.
    //
    // 0.72 sits ~0.08 above the measured maximum: loose enough not to flake on
    // a wording change, tight enough that a genuine collapse toward one
    // directive REDs — which the discriminating control below proves it can.
    const CEILING = 0.72;
    const offenders: string[] = [];
    const intents = [...ROUTED_COACHING_INTENTS];
    for (let i = 0; i < intents.length; i++) {
      for (let j = i + 1; j < intents.length; j++) {
        const score = overlapFraction(
          routingMessages.get(intents[i]) as string,
          routingMessages.get(intents[j]) as string,
        );
        if (score > CEILING) offenders.push(`${intents[i]} vs ${intents[j]} = ${score.toFixed(2)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('CONTROL: the ceiling FIRES on the collapse it exists to catch', () => {
    // A ceiling nothing can exceed is not a guard, it is decoration. The
    // discriminating pair:
    //
    //   MUST FIRE  two directives that differ only in which request they name
    //              — i.e. exactly what "two intents quietly share a method"
    //              looks like on the wire.
    //   MUST NOT   two real intents, which is the assertion above.
    //
    // Neither alone shows anything. The pair does.
    const CEILING = 0.72;
    const preMortem = routingMessages.get('pre_mortem') as string;
    const collapsed = preMortem.replace(
      'run a pre-mortem on this decision',
      'take the outside view on this decision',
    );
    // Guard the mutation itself: a `replace` that matched nothing would make
    // this control compare a string with itself and pass while testing nothing
    // (an unapplied mutation is indistinguishable from an equivalent one).
    expect(collapsed).not.toBe(preMortem);
    expect(overlapFraction(preMortem, collapsed)).toBeGreaterThan(CEILING);

    const outsideView = routingMessages.get('outside_view') as string;
    expect(overlapFraction(preMortem, outsideView)).toBeLessThan(CEILING);
  });
});

describe('coaching intents — the two findings this lane did NOT fix', () => {
  it('FINDING: "Explain the result" and "Walk me through the analysis" are one question', () => {
    // Both labels are composed against chip id `chip_action_explain_results`
    // with `action_type: 'explain_results'` — chip-generator.ts:599-604 and
    // :780-785, plus edit-graph-dispatch.ts:403-407 and
    // post-analysis-label-intercept.ts:294-299. Two of the capture's four
    // "different questions" were the same question asked twice.
    //
    // Pinned here rather than fixed because giving them different handlers is a
    // product decision about what "walk me through" should mean, not a copy
    // change — and because a lane that quietly relabelled one of them would
    // make the duplication invisible without removing it.
    expect(coachingIntentForChipId('chip_action_explain_results')).toBeUndefined();
  });

  it('FINDING: only ONE of the seven routed coaching methods has a CEE-composed chip', () => {
    // EXACT SET, so closing this gap REDs deliberately. Derived by scanning the
    // tree in `coaching-chip-intent-completeness.guard.test.ts`; restated here
    // as the acceptance-level statement of what a user can actually reach.
    //
    // The other six (`challenge_frame`, `define_success`, `elicit_options`,
    // `challenge_assumption`, `outside_view`, `elicit_risks`) are reachable
    // ONLY from DGAI's pre-analysis sparks. Post-analysis — where the capture
    // sits, and where challenging the result matters most — the product offers
    // explain, re-run, what-would-flip and pre-mortem, and nothing else.
    const withCeeChip = ROUTED_COACHING_INTENTS.filter(
      (intent) =>
        coachingIntentForChipId(`chip_prompt_run_${intent}`) !== undefined ||
        coachingIntentForChipId(`chip_action_run_${intent}`) !== undefined,
    );
    expect(withCeeChip).toEqual(['pre_mortem']);
  });
});
