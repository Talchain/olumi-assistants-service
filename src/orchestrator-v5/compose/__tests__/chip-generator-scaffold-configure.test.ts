/**
 * D-ask-1 (ROADMAP 2.11 P0-1) — configure chip on a scaffolded run_analysis
 * success turn.
 *
 * When the run only completed because the scaffold filled placeholder
 * interventions for an unconfigured option, the success turn must point at
 * the configure route (the #487 deterministic edit-lane chip), not just at
 * explain/flip follow-ups. The chip is FIRST — claim-safety beats
 * exploration.
 *
 * RED-first: fails against pristine `4d79746a7` (ChipGeneratorInput has no
 * `scaffoldedOptions` field; no configure chip is emitted).
 */

import { describe, it, expect } from 'vitest';

import { generateChips } from '../chip-generator.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  buildConfigureOptionChip,
  CONFIGURE_OPTION_GENERIC_CHIP,
} from '../../configure-option-chip-text.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { ScaffoldedOptionRecord } from '../../coaching/scaffold-disclosure.js';

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

function scaffolded(label: string | null): ScaffoldedOptionRecord {
  return { option_id: 'opt_new', label, factor_ids: ['fac_price'], value_defaulted: true };
}

describe('chip generator — scaffolded run_analysis success turn', () => {
  it('emits the configure chip FIRST when the current-turn run was scaffolded', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [RUN_FACT],
      analysis: null,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
      scaffoldedOptions: [scaffolded('New Option')],
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

  it('falls back to the generic configure chip when the label is unsafe or multiple options were scaffolded', () => {
    for (const records of [
      [scaffolded(null)],
      [scaffolded('opt_new')], // id-shaped label
      [scaffolded('A'), { ...scaffolded('B'), option_id: 'opt_new2' }],
    ]) {
      const chips = generateChips({
        stage: 'analyse',
        handlerFacts: [RUN_FACT],
        analysis: null,
        validationRegistry: HANDLER_VALIDATION_REGISTRY,
        scaffoldedOptions: records,
      });
      expect(chips[0]).toMatchObject({
        id: CONFIGURE_OPTION_GENERIC_CHIP.id,
        message: CONFIGURE_OPTION_GENERIC_CHIP.message,
      });
    }
  });

  it('no scaffold record → post-run chips are byte-identical to today', () => {
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
      scaffoldedOptions: [],
    });
    expect(withEmpty).toEqual(withoutField);
    expect(withoutField.map((c) => c.id)).toEqual([
      'chip_action_explain_results',
      'chip_action_what_would_flip',
    ]);
  });
});
