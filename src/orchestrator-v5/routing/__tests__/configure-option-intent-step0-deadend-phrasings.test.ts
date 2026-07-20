/**
 * POC-BOARD 5c — add-option→configure-effects LOOP (Step-0 trust-spine
 * evidence 2026-07-17, captures T12/T12b/T12c/T15, VERDICTS.md §7).
 *
 * Four live configure phrasings — including the assistant's OWN suggested
 * exact format (T14→T15) — failed to record a chat-added option's
 * interventions. The write chain itself is healthy (#487's
 * option-configure-apply-chain pins parse→referee→apply→readiness); the
 * live defect is ROUTING: none of these shapes claimed the edit lane, so
 * they fell to the LLM router (adjust_edge_strength wrong-thing write /
 * set_factor_value guard refusal) or to the deterministic value-update
 * path (guard refusal with no working next step).
 *
 * Two starvation conditions pinned here:
 *  1. EMPTY option labels — the LIVE route-v2 condition: labels are
 *     projected from request `graph_state`, which the live wire does not
 *     send (step0 probes and the V5 UI path both omit it). Detection must
 *     work label-blind for these shapes.
 *  2. Labels present — the turn-executor backstop-guard condition
 *     (committed-graph labels via graphLookup).
 *
 * The exact captured phrasings are load-bearing: do not paraphrase them.
 */
import { describe, it, expect } from 'vitest';

import { detectConfigureOptionIntent } from '../configure-option-intent.js';

const CRM_OPTION_LABELS = ['Cloud-Native CRM', 'On-Prem Suite'];

/** The four captured Step-0 phrasings (T12/T12b/T12c/T15, 17 Jul). */
const STEP0_PHRASINGS: ReadonlyArray<readonly [string, string]> = [
  [
    'T12',
    'Configure Cloud-Native CRM: set its CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55.',
  ],
  [
    'T12b',
    'Configure the Cloud-Native CRM option: set CRM Feature Depth to 0.7, set CRM Platform Cost to 0.55.',
  ],
  [
    'T12c',
    'Under the Cloud-Native CRM option, set its effect on CRM Feature Depth to 0.7.',
  ],
  [
    'T15',
    'Set CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55 for the Cloud-Native CRM option.',
  ],
];

describe('detectConfigureOptionIntent — Step-0 dead-end phrasings (5c)', () => {
  describe('label-blind (the live route-v2 condition: graph_state absent)', () => {
    for (const [id, message] of STEP0_PHRASINGS) {
      it(`${id} matches with EMPTY option labels: ${JSON.stringify(message)}`, () => {
        expect(detectConfigureOptionIntent(message, []).matched).toBe(true);
      });
    }
  });

  describe('with option labels (the executor backstop-guard condition)', () => {
    for (const [id, message] of STEP0_PHRASINGS) {
      it(`${id} matches with labels`, () => {
        expect(detectConfigureOptionIntent(message, CRM_OPTION_LABELS).matched).toBe(true);
      });
    }
  });

  describe('negative controls — the broadened triggers stay narrow', () => {
    it('a plain factor-value edit (no option anchor) does NOT match', () => {
      expect(
        detectConfigureOptionIntent('Set CRM Feature Depth to 0.7.', CRM_OPTION_LABELS).matched,
      ).toBe(false);
    });

    it('a question about option effects does NOT match (question suppressor)', () => {
      expect(
        detectConfigureOptionIntent(
          'What effect does the Cloud-Native CRM option have on CRM Feature Depth?',
          CRM_OPTION_LABELS,
        ).matched,
      ).toBe(false);
    });

    it('a question-shaped configure message does NOT match', () => {
      expect(
        detectConfigureOptionIntent(
          'Should I configure the Cloud-Native CRM option?',
          CRM_OPTION_LABELS,
        ).matched,
      ).toBe(false);
    });

    it('configure vocabulary with neither anchor nor value payload does NOT match', () => {
      expect(detectConfigureOptionIntent('Configure it properly this time.', []).matched).toBe(
        false,
      );
    });

    it('an effect observation without a set verb or values does NOT match', () => {
      expect(
        detectConfigureOptionIntent(
          'The Cloud-Native CRM option has a strong effect there.',
          CRM_OPTION_LABELS,
        ).matched,
      ).toBe(false);
    });
  });

  describe('REVIEW-573 C-2 — adversarial statement shapes stay OFF the edit lane', () => {
    // Verbatim reviewer probes (REVIEW-573-2026-07-20.md, C1d/C1e): both
    // claimed the edit lane via the effect arm's original verb set ("make"),
    // classify `structural` there, and would leave mutation-vs-no-op to the
    // edit LLM's judgement with zero pins. With "make" removed from
    // EFFECT_ASSIGN_VERB they keep their pre-PR LLM-router routing.
    it('C1d: "Make sure the effects on both options are captured." does NOT match', () => {
      expect(
        detectConfigureOptionIntent(
          'Make sure the effects on both options are captured.',
          CRM_OPTION_LABELS,
        ).matched,
      ).toBe(false);
    });

    it('C1e: "The options make no difference to the effect here." does NOT match', () => {
      expect(
        detectConfigureOptionIntent(
          'The options make no difference to the effect here.',
          CRM_OPTION_LABELS,
        ).matched,
      ).toBe(false);
    });

    it('control: the qualitative no-digit effect assignment still matches', () => {
      // VALUE_SET_PAYLOAD is digit-anchored, so this shape rides the effect
      // arm — the reason the arm survives with a stricter verb set instead
      // of being deleted.
      expect(
        detectConfigureOptionIntent(
          "Set the Cloud-Native CRM option's effect on CRM Feature Depth to high.",
          CRM_OPTION_LABELS,
        ).matched,
      ).toBe(true);
    });
  });
});
