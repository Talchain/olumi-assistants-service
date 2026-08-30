/**
 * ⭐⭐ NEVER ASK WHAT YOU CANNOT ACCEPT (P8) — enforced, not documented.
 *
 * THE DEFECT CLASS. `compose/configure-option-clarify-response.ts` records what
 * happens without this guard: the recovery copy ended `— 0.6, say.` and called
 * the exemplar *"wire-proven to route"*. The exemplar was; the SHAPE the copy
 * wrapped it in was not, and all three deterministic readers returned null on
 * the sentence the product itself suggested. `parameter-user-phrasing.ts`
 * states the rule that broke: *recovery copy must only recommend an input the
 * system can CURRENTLY accept*.
 *
 * SO THIS FILE DRIVES THE REAL BINDER OVER THE REAL COPY'S OWN EXEMPLARS. It
 * cannot be satisfied by a fixture, and it REDs in both directions — if the copy
 * gains a form the binder refuses, and if the binder narrows past a form the
 * copy advertises.
 */

import { describe, expect, it } from 'vitest';

import {
  MISSING_VALUE_ASK_EXEMPLARS,
  MISSING_VALUE_ASK_FORMAT_HINT,
  readMissingValueAnswer,
} from '../missing-value-answer.js';
import { resolveRepairValueBinding } from '../repair-value-binding.js';
import { projectReadinessRecovery } from '../../coaching/readiness-recovery.js';

const READINESS = {
  status: 'needs_user_input',
  blockers: [
    {
      blocker_type: 'missing_value',
      option_id: 'opt-hire',
      option_label: 'Hire two engineers',
      factor_id: 'fac-payroll',
      factor_label: 'Payroll cost',
    },
  ],
};

describe('every phrasing the ask offers is one the binder accepts', () => {
  it('the exemplar list is non-empty — a vacuous guard is not a guard', () => {
    // Trap 13: an assertion over an empty list passes by testing nothing.
    expect(MISSING_VALUE_ASK_EXEMPLARS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(MISSING_VALUE_ASK_EXEMPLARS.map((e) => [e.form, e.example] as const))(
    'the "%s" form, written as "%s", reads as a numeric answer AND binds to the asked pair',
    (_form, exemplar) => {
      const reading = readMissingValueAnswer(exemplar);
      expect(reading, `the copy offers "${exemplar}" and the reader returns null`).not.toBeNull();
      expect(reading?.kind).toBe('numeric');

      const resolved = resolveRepairValueBinding({
        message: exemplar,
        readiness: READINESS as never,
      });
      expect(resolved.matched, `"${exemplar}" does not resolve`).toBe(true);
      if (!resolved.matched) return;
      expect(resolved.kind).toBe('bind');
      if (resolved.kind !== 'bind') return;
      // Bound BY IDENTITY, not by value (trap 19).
      expect(resolved.pair.optionId).toBe('opt-hire');
      expect(resolved.pair.factorId).toBe('fac-payroll');
      // And the figure it would write is inside the producer's own 0-1 scale.
      const written = Number(resolved.valueText);
      expect(Number.isFinite(written)).toBe(true);
      expect(written).toBeGreaterThanOrEqual(0);
      expect(written).toBeLessThanOrEqual(1);
    },
  );

  it('the hint SENTENCE is built FROM the anchors, not spelled beside them', () => {
    // A second spelling is the copy that rots (trap 12). The two ANCHORS the
    // list declares are the two figures the sentence may contain, and both must
    // appear verbatim in the sentence a user reads.
    const [low, high] = MISSING_VALUE_ASK_EXEMPLARS;
    expect(MISSING_VALUE_ASK_FORMAT_HINT).toContain(low!.example);
    expect(MISSING_VALUE_ASK_FORMAT_HINT).toContain(high!.example);
    expect(MISSING_VALUE_ASK_FORMAT_HINT.toLowerCase()).toContain('percentage');
  });

  it('⚠⚠ THE HINT NEVER NAMES THE INTERNAL REPRESENTATION — the founder ruling', () => {
    // A strategic user is never asked to understand Olumi's normalised
    // coefficient scale. The ONLY figures permitted in the ask are the two
    // human anchors; anything of the form `0.x` is the internal representation
    // leaking into user copy, and a mid-scale specimen is additionally a number
    // put in the user's mouth (the property `post-draft-narrative.test.ts`
    // independently guards).
    expect(MISSING_VALUE_ASK_FORMAT_HINT).not.toMatch(/\b0\.\d/);
    const anchors = new Set(
      MISSING_VALUE_ASK_EXEMPLARS.slice(0, 2).map((e) => e.example.replace('%', '')),
    );
    const figures = MISSING_VALUE_ASK_FORMAT_HINT.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
    expect(figures.length, 'the ask must contain figures — else this is vacuous').toBeGreaterThan(0);
    expect(figures.every((f) => anchors.has(f)), figures.join(',')).toBe(true);
  });
});

describe('the on-screen ask carries the hint', () => {
  it('the provide_value recovery names the slot AND says what an answer looks like', () => {
    const projection = projectReadinessRecovery(READINESS as never, [
      { id: 'opt-hire', kind: 'option', label: 'Hire two engineers' },
      { id: 'fac-payroll', kind: 'factor', label: 'Payroll cost' },
    ] as never);

    expect(projection.kind).toBe('provide_value');
    // The slot, unchanged.
    expect(projection.nextStep).toContain('Hire two engineers');
    expect(projection.nextStep).toContain('Payroll cost');
    expect(projection.nextStep).toContain('choose the missing effect value');
    // ⭐ AND THE FORMAT — the half a tester had no way to know at pristine.
    expect(projection.nextStep).toContain(MISSING_VALUE_ASK_FORMAT_HINT);
  });

  it('⭐⭐ THE OUTCOME METRIC — the ask says how many more there are', () => {
    // MEASURED wire-level on the same deployed build: recovery clears the
    // blocker it asked about 9 of 10 times, and terminates in a RUN 1 of 10.
    // Drafts carry 3-8 missing effect values and the affordance surfaces one, so
    // a user who answers perfectly clears one of eight and cannot tell whether
    // they are one step from a run or seven. Trap 23 in the live product.
    const many = {
      status: 'needs_user_input',
      blockers: [1, 2, 3, 4, 5].map((n) => ({
        blocker_type: 'missing_value',
        option_id: `opt-${n}`, option_label: `Option ${n}`,
        factor_id: `fac-${n}`, factor_label: `Factor ${n}`,
      })),
    };
    const p = projectReadinessRecovery(many as never, [] as never);
    expect(p.kind).toBe('provide_value');
    expect(p.nextStep).toContain('There are 4 more effect values to set after this one');
    // ⚠⚠ AND IT NAMES A COUNT, NOT THE PAIRS — the discriminating half, and the
    // reason is a misbind class. If the ask LISTED all five, a user replying
    // "60%" would have it bound to `blockers[0]` by `deriveOnScreenEffectAsk`,
    // whose entire justification is that a bare figure's only antecedent is the
    // ONE question on screen. A batched ASK is fine; a batched order-guessed
    // WRITE is banned, and listing the set is one edit away from it.
    for (const n of [2, 3, 4, 5]) {
      expect(p.nextStep, `Option ${n}`).not.toContain(`Option ${n}`);
      expect(p.nextStep, `Factor ${n}`).not.toContain(`Factor ${n}`);
    }
    // Exactly one question is live, and it is the head.
    expect(p.nextStep).toContain('Option 1');
    expect(p.nextStep).toContain('Factor 1');
  });

  it('⚠ THE TWIN — with ONE outstanding value the ask says nothing about more', () => {
    // "and 0 more after this" is noise, and the single-blocker case is the one
    // that actually ends in a run.
    const p = projectReadinessRecovery(READINESS as never, [] as never);
    expect(p.kind).toBe('provide_value');
    expect(p.nextStep).not.toMatch(/more effect value/);
  });

  it('⚠ the hint is NOT added to asks that are about something else', () => {
    // The DISCRIMINATING half: a guard that fired everywhere would prove nothing
    // about the branch it names. A blocked graph renders "resolve the model
    // issue", where an effect-value format hint would be noise at best and a
    // wrong instruction at worst.
    const blocked = projectReadinessRecovery(
      { ...READINESS, status: 'blocked' } as never,
      [] as never,
    );
    expect(blocked.kind).toBe('resolve_model_issue');
    expect(blocked.nextStep).not.toContain(MISSING_VALUE_ASK_FORMAT_HINT);

    const ready = projectReadinessRecovery({ status: 'ready', blockers: [] } as never, [] as never);
    expect(ready.kind).toBe('run');
    expect(ready.nextStep).not.toContain(MISSING_VALUE_ASK_FORMAT_HINT);
  });
});
