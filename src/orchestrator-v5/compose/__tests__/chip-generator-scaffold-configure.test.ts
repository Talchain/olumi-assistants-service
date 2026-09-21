/**
 * Configure chip on a run_analysis success turn that did not compare every
 * option the user can see.
 *
 * ⚠⚠ ITS SOURCE MOVED WITH THE NO-RANK RULING (Paul, 2026-08-14), and the move
 * IS the point of this file now.
 *
 * The chip used to be built from `scaffoldedOptions` — the options CEE filled
 * with placeholder values. Since the ruling, CEE fills nothing for an
 * unconfigured option: it EXCLUDES it, and the only records left on that
 * channel are STATUS-QUO HOLDS. Offering "Help me configure 'Stay as we are'"
 * would prescribe a repair for an option that needs none, directly beneath a
 * disclosure that deliberately prescribes nothing.
 *
 * The options a configure step actually repairs are the ones the run LEFT OUT,
 * so the chip is built from `excludedOptions`. Same single copy source (#487's
 * deterministic edit-lane chip), same FIRST position — claim-safety beats
 * exploration — different question answered (trap 21).
 */

import { describe, it, expect } from 'vitest';

import { generateChips } from '../chip-generator.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  buildConfigureOptionChip,
  CONFIGURE_OPTION_GENERIC_CHIP,
} from '../../configure-option-chip-text.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { OmittedOptionRecord } from '../../coaching/scaffold-disclosure.js';

const RUN_FACT: HandlerFact = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    leading_option_id: 'opt_a',
    summary: 'Ran analysis on your current scenario.',
  },
} as HandlerFact;

/**
 * An EXCLUDED option carries identity and a label and NOTHING else — no
 * `factor_ids`, no `value_defaulted` — because nothing was minted for it.
 * That is why it has its own record type rather than borrowing the scaffold's.
 */
function excluded(label: string | null): OmittedOptionRecord {
  return { option_id: 'opt_new', label };
}

describe('chip generator — run_analysis success turn that excluded an option', () => {
  it('emits the configure chip FIRST when the current-turn run EXCLUDED an option', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [RUN_FACT],
      analysis: null,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
      excludedOptions: [excluded('New Option')],
    });

    expect(chips.length).toBeGreaterThan(0);
    const expected = buildConfigureOptionChip('New Option');
    expect(chips[0]).toMatchObject({
      id: expected.id,
      label: expected.label,
      message: expected.message,
    });
    // The existing post-run follow-ups still ride behind it (cap 3).
    expect(chips.map((c) => c.id)).toContain('chip_action_explain_results');
    expect(chips).toHaveLength(3);
  });

  it('falls back to the generic configure chip when the label is unsafe or multiple options were excluded', () => {
    for (const records of [
      [excluded(null)],
      [excluded('opt_new')], // id-shaped label
      [excluded('A'), { ...excluded('B'), option_id: 'opt_new2' }],
    ]) {
      const chips = generateChips({
        stage: 'analyse',
        handlerFacts: [RUN_FACT],
        analysis: null,
        validationRegistry: HANDLER_VALIDATION_REGISTRY,
        excludedOptions: records,
      });
      expect(chips[0]).toMatchObject({
        id: CONFIGURE_OPTION_GENERIC_CHIP.id,
        message: CONFIGURE_OPTION_GENERIC_CHIP.message,
      });
    }
  });

  it('⭐ a HELD status quo produces NO configure chip — there is nothing to configure', () => {
    // The discriminating half of the source move. Without it, "the chip appears
    // for excluded options" is equally satisfied by a generator that emits the
    // chip for ANY CEE-touched option — i.e. by the behaviour the ruling makes
    // wrong, since a status quo needs no repair.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [RUN_FACT],
      analysis: null,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
      scaffoldedOptions: [
        { option_id: 'opt_sq', label: 'Stay as we are', factor_ids: ['fac_price'], value_defaulted: true },
      ],
    });
    expect(chips.map((c) => c.id)).not.toContain('chip_prompt_configure_option');
    expect(chips.map((c) => c.id)).not.toContain(CONFIGURE_OPTION_GENERIC_CHIP.id);
  });

  it('no excluded record → post-run chips are byte-identical to today', () => {
    const withoutField = generateChips({
      stage: 'analyse',
      handlerFacts: [RUN_FACT],
      analysis: null,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });
    const withEmpty = generateChips({
      stage: 'analyse',
      handlerFacts: [RUN_FACT],
      analysis: null,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
      excludedOptions: [],
    });
    expect(withEmpty).toEqual(withoutField);
    expect(withoutField.map((c) => c.id)).toEqual([
      'chip_action_explain_results',
      'chip_action_what_would_flip',
    ]);
  });
});
