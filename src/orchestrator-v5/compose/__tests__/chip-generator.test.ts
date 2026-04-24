/**
 * Unit tests for generateChips — V5 Task 2.1.
 *
 * Rules covered:
 *   - post-run_analysis → "Explain the result" + "What could change…"
 *   - analyse + no analysis + no handler ran → "Run analysis" (executable)
 *   - decide + fragile → pre-mortem + flip prompts
 *   - decide + stable → "Explain the decision"
 *   - review → "Summarise the decision"
 *   - other combinations → []
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { ActionSchema } from '@talchain/schemas/boundary';

import { generateChips } from '../chip-generator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { ContextPackAnalysis } from '../../context/context-pack-assembler.js';

const REGISTRY = HANDLER_VALIDATION_REGISTRY;

function runAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: '00000000-0000-4000-8000-000000000001',
      leading_option_id: 'opt-a',
      summary: 'Prior run',
      win_probabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
    },
  };
}

function analysisAt(band: string): ContextPackAnalysis {
  return {
    status: 'complete',
    leading_option: 'Option A',
    runner_up: 'Option B',
    robustness_band: band,
    top_drivers: [],
    fragile_edges: [],
    staleness_reason: null,
  };
}

describe('generateChips', () => {
  it('returns empty for frame stage with no handler', () => {
    const chips = generateChips({
      stage: 'frame',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
    });
    expect(chips).toEqual([]);
  });

  it('after run_analysis → emits explain + flip prompts (both conversational)', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(2);
    expect(chips[0].label).toBe('Explain the result');
    expect(chips[1].label).toBe('What could change the outcome?');
    // Both are prompts (no action_type).
    for (const c of chips) {
      expect(c.action_type).toBeUndefined();
    }
  });

  it('analyse stage with no analysis, options present → executable run_analysis chip', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      graphOptionCount: 2,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
    expect(chips[0].label).toBe('Run analysis');
  });

  it('analyse stage with no analysis AND no options → setup prompt (no executable chip)', () => {
    // V5 review gate: run_analysis has a precondition requiring at least
    // one option node. Offering the executable chip when options are
    // absent produces a handler-failure response on click. Fall back to
    // a conversational setup prompt.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      graphOptionCount: 0,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBeUndefined();
    expect(chips[0].label).toBe('Set values for options');
  });

  it('analyse stage with no analysis but run_analysis not registered (options present) → prompt chip fallback', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      analysis: null,
      validationRegistry: {},
      graphOptionCount: 3,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBeUndefined();
    expect(chips[0].label).toBe('Run the analysis');
  });

  it('decide stage with fragile robustness → flip + pre-mortem prompts', () => {
    const chips = generateChips({
      stage: 'decide',
      handlerFacts: [],
      analysis: analysisAt('fragile'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.label)).toContain('What would make this flip?');
    expect(chips.map((c) => c.label)).toContain('Run a pre-mortem');
  });

  it('decide stage with stable robustness → explain-decision prompt', () => {
    const chips = generateChips({
      stage: 'decide',
      handlerFacts: [],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Explain the decision');
  });

  it('review stage → summarise prompt', () => {
    const chips = generateChips({
      stage: 'review',
      handlerFacts: [],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Summarise the decision');
  });

  it('every generated chip is structurally valid per ActionSchema', () => {
    const scenarios: Parameters<typeof generateChips>[0][] = [
      { stage: 'analyse', handlerFacts: [runAnalysisFact()], analysis: analysisAt('stable'), validationRegistry: REGISTRY },
      { stage: 'analyse', handlerFacts: [], analysis: null, validationRegistry: REGISTRY },
      { stage: 'decide', handlerFacts: [], analysis: analysisAt('fragile'), validationRegistry: REGISTRY },
      { stage: 'decide', handlerFacts: [], analysis: analysisAt('stable'), validationRegistry: REGISTRY },
      { stage: 'review', handlerFacts: [], analysis: analysisAt('stable'), validationRegistry: REGISTRY },
    ];
    for (const input of scenarios) {
      for (const chip of generateChips(input)) {
        expect(ActionSchema.safeParse(chip).success).toBe(true);
      }
    }
  });

  it('chip text contains no handler IDs or developer terminology', () => {
    const scenarios: Parameters<typeof generateChips>[0][] = [
      { stage: 'analyse', handlerFacts: [runAnalysisFact()], analysis: analysisAt('stable'), validationRegistry: REGISTRY },
      { stage: 'decide', handlerFacts: [], analysis: analysisAt('fragile'), validationRegistry: REGISTRY },
      { stage: 'decide', handlerFacts: [], analysis: analysisAt('stable'), validationRegistry: REGISTRY },
      { stage: 'review', handlerFacts: [], analysis: analysisAt('stable'), validationRegistry: REGISTRY },
    ];
    const forbidden = [
      'handler_id',
      'run_analysis',
      'explain_result',
      'what_would_flip',
      'context_pack',
      'contextpack',
      'compose',
    ];
    for (const input of scenarios) {
      for (const chip of generateChips(input)) {
        const blob = `${chip.label} ${chip.message}`.toLowerCase();
        for (const bad of forbidden) {
          expect(blob).not.toContain(bad);
        }
      }
    }
  });

  it('emits at most 3 chips per call', () => {
    // No current rule emits more than 3, but assert the cap is respected.
    const chips = generateChips({
      stage: 'decide',
      handlerFacts: [],
      analysis: analysisAt('fragile'),
      validationRegistry: REGISTRY,
    });
    expect(chips.length).toBeLessThanOrEqual(3);
  });

  it('noop run_analysis fact is ignored (treated as no handler ran)', () => {
    const noopFact: HandlerFact = {
      ...runAnalysisFact(),
      noop: true,
    };
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [noopFact],
      analysis: null,
      validationRegistry: REGISTRY,
      graphOptionCount: 2,
    });
    // Not the post-run_analysis chips, because the fact was a noop.
    // Should follow the "analyse + no analysis + no handler ran" rule,
    // which emits the executable Run analysis chip when options exist.
    expect(chips[0].action_type).toBe('run_analysis');
  });

  it('chip IDs are deterministic and url-safe', () => {
    const chips = generateChips({
      stage: 'decide',
      handlerFacts: [],
      analysis: analysisAt('fragile'),
      validationRegistry: REGISTRY,
    });
    for (const c of chips) {
      expect(c.id).toMatch(/^chip_[a-z_0-9]+$/);
    }
  });
});
