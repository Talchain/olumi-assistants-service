/**
 * ⭐ ROADMAP 2.1261 — the ASK composer, ⭐⭐ AS SUPPRESSED BY P8 (2.1267).
 *
 * ⚠ THE ORIGINAL HEADER NAMED THE WRONG LOAD-BEARING PROPERTY, and that is the
 * lesson, so it is quoted rather than deleted: *"The load-bearing property is
 * CHIP ROUTABILITY, asserted by DERIVATION (trap 12) … so the offered remedy
 * provably returns to the lane that writes option interventions."*
 *
 * Routability was proven and was never the question. **Landing was assumed.** On
 * deployed `8be62df` (witness-acceptance-2026-08-17, J4 t4) clicking
 * `chip_prompt_repair_value_bind_1` routed correctly into the edit lane and then
 * produced NO edit fact, blockers 10→10, `graph_hash` unchanged, and *"open … on
 * the canvas"* — an affordance terminating in refusal (P8; Research-CTA shape).
 *
 * So the chips are suppressed and the derived-routability check is RE-POINTED at
 * the sentence the reply now hands the user to TYPE. The check is still the
 * valuable one — a phrasing the product suggests must return to the lane that
 * suggested it — it simply no longer certifies a click the product cannot honour.
 */
import { describe, expect, it } from 'vitest';

import { composeRepairValueAskResponse } from '../repair-value-ask-response.js';
import type { MissingEffectPair } from '../../routing/repair-value-binding.js';
import { detectConfigureOptionIntent, carriesConfigureOptionValuePayload } from '../../routing/configure-option-intent.js';
import { isAnalyticalQuestion } from '../../routing/analytical-question-guard.js';
import { isStateQueryQuestionShape } from '../../routing/state-query-guard.js';
import { EDIT_GRAPH_NEGATIVE_REGEX } from '../../../orchestrator/routing/edit-graph-intent-regex.js';
import { findForbiddenPhraseHit } from '../forbidden-user-facing-phrases.js';

const PAIR_SUB: MissingEffectPair = {
  optionId: 'opt_sub',
  optionLabel: 'subcontracting inner-city deliveries to a green courier',
  factorId: 'fac_sub_cost',
  factorLabel: 'Subcontractor cost as share of affected revenue',
};

const PAIR_PASS: MissingEffectPair = {
  optionId: 'opt_pass',
  optionLabel: 'paying the daily charges and passing costs to customers',
  factorId: 'fac_price_up',
  factorLabel: 'Customer price increase applied',
};

function compose(pairs: readonly MissingEffectPair[] = [PAIR_SUB, PAIR_PASS]) {
  return composeRepairValueAskResponse({ pairs, valueText: '0.12', stage: 'frame' });
}

describe('composeRepairValueAskResponse', () => {
  it('names every missing pair and the user value, and invites a typed reply', () => {
    const response = compose();
    expect(response.assistant_text).toContain('0.12');
    expect(response.assistant_text).toContain(PAIR_SUB.factorLabel);
    expect(response.assistant_text).toContain(PAIR_SUB.optionLabel);
    expect(response.assistant_text).toContain(PAIR_PASS.factorLabel);
    expect(response.assistant_text).toContain(PAIR_PASS.optionLabel);
    expect(response.assistant_text).toMatch(/name the option and factor/i);
  });

  it('⭐⭐ P8: offers NO chip — an affordance that cannot land must not be offered', () => {
    // RED at 936f4b49: this emitted 2 chips, one of which was wire-witnessed
    // no-opping with a canvas redirect (J4 t4). The value in the reply is still
    // the user's own and every pair is still named; only the false click is gone.
    expect(compose().suggested_actions).toEqual([]);
  });

  it('offers no chip AT ANY pair count — this is a doctrine, not a cap', () => {
    // The predecessor test asserted a CAP (3 chips), i.e. it would have passed
    // while still offering a click that cannot land. Bind by the invariant.
    for (const n of [1, 2, 3, 4, 10]) {
      const pairs = Array.from({ length: n }, (_, i) => ({
        ...PAIR_SUB,
        optionId: `opt_${i}`,
        optionLabel: `option ${i}`,
        factorId: `fac_${i}`,
        factorLabel: `Factor ${i}`,
      }));
      expect(compose(pairs).suggested_actions, `pair count ${n}`).toEqual([]);
    }
  });

  it('the prose still names EVERY pair — nothing the chips carried is withheld', () => {
    const pairs = [
      PAIR_SUB,
      PAIR_PASS,
      { ...PAIR_SUB, optionId: 'opt_c', optionLabel: 'option c', factorId: 'fac_c', factorLabel: 'Factor c' },
      { ...PAIR_SUB, optionId: 'opt_d', optionLabel: 'option d', factorId: 'fac_d', factorLabel: 'Factor d' },
    ];
    const response = compose(pairs);
    expect(response.assistant_text).toContain('Factor d');
    expect(response.assistant_text).toContain('Factor c');
  });

  it('⭐ the TYPED exemplar still ROUTES, by the router’s own predicates (the check, re-pointed)', () => {
    // The derivation that mattered survives the suppression: a phrasing the
    // product suggests must return to the lane that suggested it. It is now
    // asserted on the sentence handed over as TEXT, not on a click.
    const text = compose().assistant_text;
    const exemplar = text.slice(text.indexOf('like this: ') + 'like this: '.length);
    expect(exemplar.length).toBeGreaterThan(20);
    expect(exemplar).toContain('0.12');
    expect(detectConfigureOptionIntent(exemplar, []).matched, exemplar).toBe(true);
    expect(carriesConfigureOptionValuePayload(exemplar), exemplar).toBe(true);
    expect(EDIT_GRAPH_NEGATIVE_REGEX.test(exemplar), exemplar).toBe(false);
    expect(isAnalyticalQuestion(exemplar), exemplar).toBe(false);
    expect(isStateQueryQuestionShape(exemplar), exemplar).toBe(false);
  });

  it('survives the egress forbidden-phrase guard (derived, not mirrored)', () => {
    expect(findForbiddenPhraseHit(compose().assistant_text)).toBeNull();
  });
});
