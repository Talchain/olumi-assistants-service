/**
 * CASE: pronoun-identity  —  SEAM A (the discourse ledger)
 *
 * THE PROPERTY
 * ------------
 * A demonstrative ("that one") refers to whatever was named last turn. Two
 * conversations that are word-for-word identical except for WHICH option was
 * named must therefore diverge at the demonstrative. If they do not, the
 * product is not resolving the pronoun — it is answering from something else
 * entirely, and the fact that its answer looks reasonable is exactly what makes
 * this dangerous.
 *
 * THE CONTROL IS THE ENTIRE CASE
 * ------------------------------
 * There is no way to judge a single anaphoric answer in isolation: "set aside
 * Hold at 45" is a perfectly plausible reply to "set that one aside" no matter
 * which option was actually named. Correctness here is not a property of one
 * response, it is a property of the DIFFERENCE between two.
 *
 * So the arm names option[0] and the control names option[last], and the two
 * then send byte-identical demonstrative messages. The required outcome is not
 * "the arm is right" — it is "the arm and the control disagree, each in favour
 * of its own antecedent". The 30 Aug batch found them returning the IDENTICAL
 * pair under opposite antecedents, which is why `assertArmsDiscriminate` runs
 * as a gate for every case in this harness rather than as an assertion in this
 * one.
 *
 * A third probe (the explicit-name variant) establishes that the machinery
 * works when the referent is spelled out — so a failure here is localised to
 * pronoun RESOLUTION and is not just "the product cannot set options aside".
 * Without it, a red would be ambiguous between two very different defects.
 */

import { check } from '../lib/verdict.mjs';
import { mentions } from '../lib/wire.mjs';
import { BRIEF_FULLY_SPECIFIED, draft, optionLabels } from '../lib/scenarios.mjs';

/** Byte-identical in both worlds. Any divergence must come from the antecedent. */
const DEMONSTRATIVE = 'Set that one aside for now.';

export default {
  id: 'pronoun-identity',
  seam: 'A',
  stateClass: 'fresh',
  title: 'a demonstrative resolves to the entity named in the previous turn',
  expectedAt: {
    caceba1a: 'UNKNOWN at time of authoring — the 30 Aug batch saw byte-identical answers under opposite antecedents',
  },

  async setup(ctx) {
    const [arm, control, explicit] = await Promise.all([
      draft(ctx.client, BRIEF_FULLY_SPECIFIED, 'pronoun-ARM-draft'),
      draft(ctx.client, BRIEF_FULLY_SPECIFIED, 'pronoun-CTL-draft'),
      draft(ctx.client, BRIEF_FULLY_SPECIFIED, 'pronoun-EXPLICIT-draft'),
    ]);

    const armOptions = optionLabels(arm.response.body);
    const ctlOptions = optionLabels(control.response.body);

    return {
      arm: { scenarioId: arm.scenarioId, draft: arm.response, options: armOptions },
      control: { scenarioId: control.scenarioId, draft: control.response, options: ctlOptions },
      explicit: { scenarioId: explicit.scenarioId, draft: explicit.response, options: optionLabels(explicit.response.body) },
      // Antecedents chosen from OPPOSITE ends so a partial-credit answer cannot
      // satisfy both. Bound by identity to the producer's own option list.
      armAntecedent: armOptions[0],
      ctlAntecedent: ctlOptions[ctlOptions.length - 1],
    };
  },

  precondition(s) {
    return [
      check('arm draft HTTP 200', s.arm.draft.ok, `status=${s.arm.draft.status}`),
      check('control draft HTTP 200', s.control.draft.ok, `status=${s.control.draft.status}`),
      check(
        'arm scenario offers >= 2 distinct options',
        s.arm.options.filter(Boolean).length >= 2,
        `options=${JSON.stringify(s.arm.options)}`,
      ),
      check(
        'control scenario offers >= 2 distinct options',
        s.control.options.filter(Boolean).length >= 2,
        `options=${JSON.stringify(s.control.options)}`,
      ),
      check(
        'the two antecedents are DIFFERENT strings',
        Boolean(s.armAntecedent && s.ctlAntecedent && s.armAntecedent !== s.ctlAntecedent),
        `arm="${s.armAntecedent}" control="${s.ctlAntecedent}" — identical antecedents would make the control vacuous`,
      ),
      check(
        'the control antecedent is NOT also first in the arm list',
        s.ctlAntecedent !== s.arm.options[0],
        'if both worlds point at the same option the case cannot discriminate',
      ),
    ];
  },

  /** Name option[0], then send the demonstrative. */
  async arm(ctx, s) {
    await ctx.client.turn({
      scenarioId: s.arm.scenarioId,
      message: `Let's focus on ${s.armAntecedent}.`,
      label: 'pronoun-ARM-name-antecedent',
    });
    return ctx.client.turn({
      scenarioId: s.arm.scenarioId,
      message: DEMONSTRATIVE,
      label: 'pronoun-ARM-demonstrative',
    });
  },

  /** Name option[last], then send the IDENTICAL demonstrative. */
  async control(ctx, s) {
    await ctx.client.turn({
      scenarioId: s.control.scenarioId,
      message: `Let's focus on ${s.ctlAntecedent}.`,
      label: 'pronoun-CTL-name-antecedent',
    });
    return ctx.client.turn({
      scenarioId: s.control.scenarioId,
      message: DEMONSTRATIVE,
      label: 'pronoun-CTL-demonstrative',
    });
  },

  assertArm(resp, s) {
    const t = resp.text;
    const wrong = s.arm.options.filter((o) => o && o !== s.armAntecedent && mentions(t, o));
    return [
      check('arm returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
      check(
        'resolves to the antecedent named last turn',
        mentions(t, s.armAntecedent),
        `expected "${s.armAntecedent}" (the option named in the immediately preceding turn)`,
      ),
      check(
        'does not resolve to a DIFFERENT option',
        wrong.length === 0,
        wrong.length ? `also/instead named ${JSON.stringify(wrong)}` : 'no competing option named',
      ),
    ];
  },

  assertControl(resp, s) {
    const t = resp.text;
    const wrong = s.control.options.filter((o) => o && o !== s.ctlAntecedent && mentions(t, o));
    return [
      check('control returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
      check(
        'resolves to ITS OWN antecedent, not the arm\'s',
        mentions(t, s.ctlAntecedent),
        `expected "${s.ctlAntecedent}" — the opposite end of the option list from the arm`,
      ),
      check(
        'does not resolve to a DIFFERENT option',
        wrong.length === 0,
        wrong.length ? `also/instead named ${JSON.stringify(wrong)}` : 'no competing option named',
      ),
    ];
  },

  /**
   * Third probe: the explicit-name variant must work.
   * Reported as a finding rather than gating the verdict — it localises a red
   * rather than causing one.
   */
  async diagnostic(ctx, s) {
    const target = s.explicit.options[0];
    if (!target) return { name: 'explicit-name variant', ok: false, detail: 'no option label available' };
    const resp = await ctx.client.turn({
      scenarioId: s.explicit.scenarioId,
      message: `Set ${target} aside for now.`,
      label: 'pronoun-DIAG-explicit-name',
    });
    return {
      name: 'explicit-name variant resolves (localises any pronoun red)',
      ok: resp.ok && mentions(resp.text, target),
      detail: resp.ok
        ? `named "${target}": ${mentions(resp.text, target)}`
        : `HTTP ${resp.status}`,
    };
  },
};
