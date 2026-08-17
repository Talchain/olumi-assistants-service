/**
 * ⭐ ROADMAP 2.1261 — the ASK composer.
 *
 * The load-bearing property is CHIP ROUTABILITY, asserted by DERIVATION
 * (trap 12): each emitted chip message is run through the ROUTER'S OWN
 * predicates — `detectConfigureOptionIntent` must claim it (effect_vocab) and
 * none of route-v2's shared negative gates may fire — so the offered remedy
 * provably returns to the lane that writes option interventions. A mirrored
 * assertion ("message contains the word option") could drift; the predicates
 * cannot.
 */
import { describe, expect, it } from 'vitest';

import { composeRepairValueAskResponse, MAX_REPAIR_PAIR_CHIPS } from '../repair-value-ask-response.js';
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

  it('offers one chip per pair, each carrying the user value verbatim', () => {
    const response = compose();
    expect(response.suggested_actions).toHaveLength(2);
    for (const chip of response.suggested_actions) {
      expect(chip.message).toContain('0.12');
      expect(chip.label).toContain('0.12');
    }
    expect(response.suggested_actions[0]!.message).toContain(PAIR_SUB.factorLabel);
    expect(response.suggested_actions[1]!.message).toContain(PAIR_PASS.factorLabel);
  });

  it('⭐ every chip message ROUTES, by the router’s own predicates', () => {
    for (const chip of compose().suggested_actions) {
      // The configure-option detector claims it (the "option" word anchors,
      // "set … effect … to <digit>" satisfies effect_vocab / value payload).
      const detection = detectConfigureOptionIntent(chip.message, []);
      expect(detection.matched, chip.message).toBe(true);
      // It carries a writable value payload, so the bare-configure intercept
      // (`shouldInterceptBeforeEditLane`) declines and the edit LLM gets it.
      expect(carriesConfigureOptionValuePayload(chip.message), chip.message).toBe(true);
      // None of route-v2's shared negative gates fires.
      expect(EDIT_GRAPH_NEGATIVE_REGEX.test(chip.message), chip.message).toBe(false);
      expect(isAnalyticalQuestion(chip.message), chip.message).toBe(false);
      expect(isStateQueryQuestionShape(chip.message), chip.message).toBe(false);
    }
  });

  it('caps chips at MAX_REPAIR_PAIR_CHIPS while the prose still names every pair', () => {
    const pairs = [
      PAIR_SUB,
      PAIR_PASS,
      { ...PAIR_SUB, optionId: 'opt_c', optionLabel: 'option c', factorId: 'fac_c', factorLabel: 'Factor c' },
      { ...PAIR_SUB, optionId: 'opt_d', optionLabel: 'option d', factorId: 'fac_d', factorLabel: 'Factor d' },
    ];
    const response = compose(pairs);
    expect(response.suggested_actions).toHaveLength(MAX_REPAIR_PAIR_CHIPS);
    expect(response.assistant_text).toContain('Factor d');
  });

  it('survives the egress forbidden-phrase guard (derived, not mirrored)', () => {
    expect(findForbiddenPhraseHit(compose().assistant_text)).toBeNull();
  });
});
