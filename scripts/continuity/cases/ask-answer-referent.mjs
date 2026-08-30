/**
 * CASE: ask-answer-referent  —  SEAM A (the discourse ledger)
 *
 * THE PROPERTY
 * ------------
 * When the product has just asked the user to confirm one option×factor effect
 * value, and the user answers the way people answer — with a bare number — the
 * product must show it still knows what it asked. Concretely: it names the
 * option AND the factor it is waiting on, and offers the form it can actually
 * bind.
 *
 * WHY A BARE NUMBER IS THE RIGHT PROBE
 * ------------------------------------
 * It is the highest-frequency shape of the harm. The product asked a question;
 * the user answered it in the most natural register available; whether the
 * product retains the referent across exactly one turn boundary is the whole
 * of the AI Harness claim at turn granularity.
 *
 * This case does NOT test the refusal itself. Refusing to silently rescale a
 * user's number is a ratified founder ruling and is correct. What is tested is
 * what happens AFTER the refusal: whether the decline is referent-bearing or
 * anonymous.
 *
 * WIRE WITNESS AT caceba1a (30 Aug 2026, this harness's own first run)
 * -------------------------------------------------------------------
 * The arm response names the FACTOR ("monthly seat price") and offers the
 * percentage form ("a 20% increase") — so the seam is in better shape than the
 * source claim of a "generic LLM clarify" suggested. It does NOT name the
 * OPTION ("Partial Increase"). One half of the referent survives the turn
 * boundary and the other does not.
 *
 * THIS CASE IS THEREFORE EXPECTED TO FAIL ON THE OPTION ASSERTION AT caceba1a.
 * That is deliberate and it is the point: the harness is a net, and a net that
 * is green on the day the defect is live is not a net. When the seam is closed
 * this case turns green on its own, and it REDs again if the referent is ever
 * dropped. Do not "fix" the red by weakening the assertion.
 */

import { check } from '../lib/verdict.mjs';
import { mentions } from '../lib/wire.mjs';
import {
  BRIEF_PENDING_ASK,
  BRIEF_FULLY_SPECIFIED,
  draftUntil,
  deriveAskedPair,
  analysisStatus,
  optionLabels,
} from '../lib/scenarios.mjs';

/** The bare value the user sends. One token, no unit, no factor name. */
const BARE_VALUE = '20';

export default {
  id: 'ask-answer-referent',
  seam: 'A',
  stateClass: 'fresh',
  title: 'a bare number answering the product\'s own question keeps its referent',
  expectedAt: {
    caceba1a: 'FAIL (option label not named; factor label and % form ARE named)',
  },

  /**
   * ARM world: exactly one pending effect-value ask.
   * CONTROL world: nothing pending at all.
   * Same message, opposite states — so any difference is the product's doing.
   */
  async setup(ctx) {
    // The drafter is non-deterministic about which values it infers, so each
    // world is ACHIEVED (bounded retries) rather than assumed. The precondition
    // below still asserts it was reached — a world that cannot be reached voids
    // the case instead of silently testing a different one.
    const [arm, control] = await Promise.all([
      draftUntil(
        ctx.client,
        BRIEF_PENDING_ASK,
        (body) => analysisStatus(body) === 'needs_user_input' && deriveAskedPair(body) !== null,
        'ask-referent-ARM-draft',
      ),
      draftUntil(
        ctx.client,
        BRIEF_FULLY_SPECIFIED,
        (body) => analysisStatus(body) === 'ready' && deriveAskedPair(body) === null,
        'ask-referent-CTL-draft',
      ),
    ]);

    return {
      arm: { scenarioId: arm.scenarioId, draft: arm.response, reached: arm.reached, tried: arm.tried },
      control: { scenarioId: control.scenarioId, draft: control.response, reached: control.reached, tried: control.tried },
      askedPair: arm.response ? deriveAskedPair(arm.response.body) : null,
    };
  },

  /**
   * PIN THE PRECONDITION. Both halves.
   *
   * Without the control's pin, a control that quietly started producing a
   * pending ask would still "pass" by not naming a pair, and the case would
   * report a discrimination it was no longer making.
   */
  precondition(s) {
    if (!s.arm.reached || !s.control.reached) {
      return [
        check(
          'both worlds were reachable within the retry budget',
          false,
          `ARM reached=${s.arm.reached} tried=${JSON.stringify(s.arm.tried)}; ` +
            `CONTROL reached=${s.control.reached} tried=${JSON.stringify(s.control.tried)}. ` +
            'The drafter did not produce the required states — COULD_NOT_MEASURE, not a pass.',
        ),
      ];
    }
    const armStatus = analysisStatus(s.arm.draft.body);
    const ctlStatus = analysisStatus(s.control.draft.body);
    return [
      check('arm HTTP 200', s.arm.draft.ok, `status=${s.arm.draft.status}`),
      check('control HTTP 200', s.control.draft.ok, `status=${s.control.draft.status}`),
      check(
        'ARM has a pending user-input state',
        armStatus === 'needs_user_input',
        `analysis_ready.status=${armStatus} (need needs_user_input)`,
      ),
      check(
        'ARM exposes an asked option×factor pair, bound by identity',
        s.askedPair !== null,
        s.askedPair
          ? `asked "${s.askedPair.optionLabel}" on "${s.askedPair.factorLabel}" (${s.askedPair.boundBy})`
          : 'no pair could be bound to analysis_ready.options[] — fixture no longer reproduces the state',
      ),
      check(
        'CONTROL has NO pending user-input state',
        ctlStatus === 'ready',
        `analysis_ready.status=${ctlStatus} (need ready)`,
      ),
      check(
        'CONTROL exposes no asked pair',
        deriveAskedPair(s.control.draft.body) === null,
        'control must be the zero-blocker world, else it is not an opposite outcome',
      ),
    ];
  },

  async arm(ctx, s) {
    return ctx.client.turn({
      scenarioId: s.arm.scenarioId,
      message: BARE_VALUE,
      label: 'ask-referent-ARM-bare20',
    });
  },

  async control(ctx, s) {
    return ctx.client.turn({
      scenarioId: s.control.scenarioId,
      message: BARE_VALUE,
      label: 'ask-referent-CTL-bare20',
    });
  },

  /** The arm must carry the referent it was asked about. */
  assertArm(resp, s) {
    const t = resp.text;
    const pair = s.askedPair;
    return [
      check('arm returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
      check(
        'names the asked FACTOR',
        mentions(t, pair.factorLabel),
        `looking for "${pair.factorLabel}" (identity: the factor the product itself asked about)`,
      ),
      check(
        'names the asked OPTION',
        mentions(t, pair.optionLabel),
        `looking for "${pair.optionLabel}" — the referent half. KNOWN OPEN at caceba1a.`,
      ),
      check(
        'offers a bindable form for the value',
        mentions(t, `${BARE_VALUE}%`) || mentions(t, `${BARE_VALUE} %`) || mentions(t, 'percentage'),
        `looking for a %-shaped restatement of "${BARE_VALUE}" the user can click or repeat`,
      ),
      check(
        'does NOT silently bind the raw number',
        !/\bset\b[^.]{0,40}\bto\s+0\.2\b/i.test(t),
        'the founder ruling forbids rescaling a user\'s number on their behalf',
      ),
    ];
  },

  /**
   * The control must produce the OPPOSITE outcome: with nothing pending, the
   * honest answer is "I do not know what this refers to" — and specifically it
   * must not name an option×factor pair it was never waiting on.
   */
  assertControl(resp, s) {
    const t = resp.text;
    const ctlOptions = optionLabels(s.control.draft.body);
    const namedAny = ctlOptions.filter((l) => l && mentions(t, l));
    return [
      check('control returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
      check(
        'names NO option label (nothing was pending)',
        namedAny.length === 0,
        namedAny.length
          ? `named ${JSON.stringify(namedAny)} despite no pending ask — a referent invented rather than retained`
          : `none of ${ctlOptions.length} option labels appear, as required`,
      ),
      check(
        'does not claim to know what the number refers to',
        !/effect value for\s+"/i.test(t),
        'a zero-blocker world must not emit an effect-value ask sentence',
      ),
    ];
  },
};
