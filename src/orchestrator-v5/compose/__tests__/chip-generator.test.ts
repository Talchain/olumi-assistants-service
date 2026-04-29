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
    leading_option: { label: 'Option A', probability: 0.6 },
    runner_up: { label: 'Option B', probability: 0.4 },
    margin_pp: 20,
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

  it('analyse stage with analysisReady=ready → executable run_analysis chip', () => {
    // V5 alpha hardening Phase 2.4: the executable chip now requires the
    // full structural readiness signal, not just option count. This is
    // the only path that emits the executable variant.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      graphOptionCount: 2,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
    expect(chips[0].label).toBe('Run analysis');
  });

  it('analyse stage with analysisReady=needs_user_input → conversational setup prompt', () => {
    // Options absent per structural readiness → conversational fallback.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      graphOptionCount: 0,
      analysisReady: { status: 'needs_user_input', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBeUndefined();
    expect(chips[0].label).toBe('Set values for options');
  });

  it('analyse stage with analysisReady=needs_user_mapping → "Set values for options" (not "Run the analysis")', () => {
    // Follow-up review: when readiness is KNOWN but not ready, steer
    // the user toward the configuration they're missing. Pre-follow-up
    // this emitted "Run the analysis" which loop-baited Sonnet back
    // toward a run_analysis call that validator would reject.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      graphOptionCount: 2,
      analysisReady: {
        status: 'needs_user_mapping',
        options: [],
        goal_node_id: 'g',
      } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBeUndefined();
    expect(chips[0].label).toBe('Set values for options');
  });

  it('analyse stage with analysisReady=needs_encoding → "Set values for options"', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      graphOptionCount: 2,
      analysisReady: {
        status: 'needs_encoding',
        options: [],
        goal_node_id: 'g',
      } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBeUndefined();
    expect(chips[0].label).toBe('Set values for options');
  });

  it('analyse stage with analysisReady=undefined + options present → neutral "Tell me about your decision" prompt', () => {
    // Follow-up review (P1-4 revisit): when readiness is UNKNOWN (no
    // graph / unparseable graph), do NOT nudge Sonnet toward an
    // analysis action whose graph precondition is structurally
    // impossible. Pre-follow-up this emitted "Run the analysis"; the
    // neutral decision-framing prompt keeps the model focused on the
    // structural step that actually comes next.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      graphOptionCount: 2,
      // analysisReady intentionally omitted (unknown)
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBeUndefined();
    expect(chips[0].label).toBe('Tell me about your decision');
  });

  it('analyse stage with analysisReady=undefined (unknown readiness) → never executable', () => {
    // Correction 11: when readiness is unknown (graph absent or unparseable),
    // the executable chip MUST NOT render even if graphOptionCount looks OK.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      graphOptionCount: 2,
      // analysisReady deliberately omitted
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBeUndefined();
  });

  it('analyse stage with run_analysis not registered even when ready → conversational fallback', () => {
    // When the executable variant is unavailable (registry empty) the
    // chip falls through to the neutral decision-framing prompt rather
    // than the old "Run the analysis" prompt, which would have
    // loop-baited Sonnet toward an action whose handler isn't
    // registered in this deployment.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      analysis: null,
      validationRegistry: {},
      graphOptionCount: 3,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBeUndefined();
    expect(chips[0].label).toBe('Tell me about your decision');
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
      // V5 alpha hardening Phase 2.4: readiness gate — the executable
      // chip only emits when structural readiness says 'ready'.
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    // Not the post-run_analysis chips, because the fact was a noop.
    // Should follow the "analyse + no analysis + no handler ran" rule,
    // which emits the executable Run analysis chip when readiness is ok.
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

// V5 0.9.0 — facts_absent rule fires when one of the new no-op explanation
// handlers ran but no real run_analysis fact exists in handlerFacts. The
// chip is the same "Run analysis" executable as the analyse-stage rule
// when readiness is ready; otherwise a conversational setup prompt.
describe('generateChips — V5 0.9.0 facts_absent rule', () => {
  function noopExplainResultsFact(): HandlerFact {
    return {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: true, option_count: 2 },
    };
  }

  function noopWhatWouldFlipFact(): HandlerFact {
    return {
      fact_type: 'what_would_flip',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: true, option_count: 2 },
    };
  }

  function noopExplainFromStructureFact(): HandlerFact {
    return {
      fact_type: 'explain_from_structure',
      fact_version: 1,
      noop: true,
      result: { option_count: 2 },
    };
  }

  it('explain_results noop fact + facts_absent + ready → executable run_analysis chip', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [noopExplainResultsFact()],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
    expect(chips[0].label).toBe('Run analysis');
  });

  it('what_would_flip noop fact + facts_absent + ready → executable run_analysis chip', () => {
    const chips = generateChips({
      stage: 'decide',
      handlerFacts: [noopWhatWouldFlipFact()],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
  });

  it('explain_from_structure noop fact + facts_absent + ready → executable run_analysis chip', () => {
    // Fires across stages — frame here.
    const chips = generateChips({
      stage: 'frame',
      handlerFacts: [noopExplainFromStructureFact()],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
  });

  it('noop fact + facts_absent + readiness undefined → conversational setup prompt', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [noopExplainResultsFact()],
      analysis: null,
      validationRegistry: REGISTRY,
      // analysisReady intentionally absent.
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBeUndefined();
    expect(chips[0].label).toBe('Set values for options');
  });

  it('noop run_analysis fact does NOT satisfy facts_absent — still emits Run analysis', () => {
    // The non-noop filter: a noop run_analysis fact must NOT count as
    // "real analysis present". Mirrors the handler-side precondition.
    const noopRunAnalysisFact: HandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: true,
      result: {
        scenario_id: '00000000-0000-4000-8000-000000000001',
        leading_option_id: null,
        summary: '',
      },
    };
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [noopRunAnalysisFact, noopExplainResultsFact()],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
  });

  it('explain_results post-analysis (priorFacts has run_analysis) → NO Run analysis chip', () => {
    // V5 0.9.0 fix: the original facts_absent rule consulted only the
    // current turn's handlerFacts, so a successful post-analysis
    // explain_results turn (current fact = noop explain_results, prior =
    // non-noop run_analysis) would falsely emit a "Run analysis" chip.
    // The fix routes deriveProjectionStatus through priorFacts AND the
    // populated analysis projection.
    //
    // The handler emits `precondition_unmet: false` on the post-analysis
    // path (explain-results.ts:96) — match that here so the precondition-
    // unmet rule above this one does not fire spuriously.
    const priorRunAnalysis: HandlerFact = runAnalysisFact();
    const postAnalysisExplainResultsFact: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: false, option_count: 2 },
    };
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [postAnalysisExplainResultsFact],
      priorFacts: [priorRunAnalysis],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    // Run analysis chip MUST NOT appear — analysis already exists.
    for (const c of chips) {
      expect(c.action_type).not.toBe('run_analysis');
    }
  });

  it('analysis projection populated but NO prior run_analysis fact → STILL emits Run analysis (single source of truth = priorFacts)', () => {
    // V5 0.9.0 alignment: the chip rule and the handler precondition both
    // key off the persisted run_analysis HandlerFact. A turn that arrives
    // with `analysis` populated upstream but no persisted fact (e.g. a
    // bypass path that synthesises analysis without writing a fact) is
    // facts_absent. The user gets the "Run analysis" chip and the handler
    // returns its precondition-fail template — both signals agreeing.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [noopExplainResultsFact()],
      // priorFacts deliberately empty.
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
  });
});

// V5 0.9.0 — deriveProjectionStatus is the single helper that flattens
// "no real run_analysis fact" / "fact present, projection empty" / "fact
// present, projection populated" into one enum. Used by the facts_absent
// chip rule above.
describe('deriveProjectionStatus', () => {
  it('returns "facts_absent" when handlerFacts is empty', async () => {
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    expect(deriveProjectionStatus([], null)).toBe('facts_absent');
    expect(deriveProjectionStatus(undefined, null)).toBe('facts_absent');
  });

  it('returns "facts_absent" when only a noop run_analysis fact is present and analysis is empty', async () => {
    // V5 0.9.0: deriveProjectionStatus now treats a populated analysis
    // projection (leading_option non-null) as standalone evidence of real
    // analysis. Test the noop-fact filter in isolation by passing null
    // analysis — otherwise the populated projection signal would override.
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    const noop: HandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: true,
      result: {
        scenario_id: '00000000-0000-4000-8000-000000000001',
        leading_option_id: null,
        summary: '',
      },
    };
    expect(deriveProjectionStatus([noop], null)).toBe('facts_absent');
  });

  it('returns "facts_absent" when only a noop explain_results fact is present', async () => {
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    const noop: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: true, option_count: 0 },
    };
    expect(deriveProjectionStatus([noop], null)).toBe('facts_absent');
  });

  it('returns "projection_empty" when run_analysis fact present but analysis has no leading_option', async () => {
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    expect(deriveProjectionStatus([runAnalysisFact()], null)).toBe('projection_empty');
  });

  it('returns "projection_populated" when run_analysis fact + populated analysis present', async () => {
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    expect(deriveProjectionStatus([runAnalysisFact()], analysisAt('stable'))).toBe(
      'projection_populated',
    );
  });

  it('treats prior_facts as evidence of real analysis (cross-turn, V5 0.9.0)', async () => {
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    // Current turn: only a noop explain_results fact. Prior turns: non-noop
    // run_analysis fact. Status must reflect "analysis exists somewhere",
    // not "facts absent on this turn".
    const noopExplain: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: false, option_count: 2 },
    };
    expect(
      deriveProjectionStatus([noopExplain], analysisAt('stable'), [runAnalysisFact()]),
    ).toBe('projection_populated');
  });

  it('returns "facts_absent" when analysis projection is populated but priorFacts is empty (single source of truth)', async () => {
    // Critical alignment with the handler precondition: a populated
    // upstream analysis projection alone does NOT count. The persisted
    // run_analysis HandlerFact is the canonical signal both the chip
    // generator and the explain_results / what_would_flip handlers consult.
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    expect(deriveProjectionStatus([], analysisAt('stable'))).toBe('facts_absent');
    expect(deriveProjectionStatus([], analysisAt('stable'), [])).toBe('facts_absent');
  });
});

// V5 spec §7 every-failure-path-includes-a-chip — explicit precondition rule.
// When the handler returned a precondition-fail outcome (Test B path), the
// chip MUST fire on `result.precondition_unmet === true` regardless of how
// `priorFacts` is threaded. Independent of `deriveProjectionStatus`.
describe('generateChips — V5 spec §7 explicit precondition_unmet rule', () => {
  function preconditionUnmetExplainResultsFact(): HandlerFact {
    return {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: true, option_count: 4 },
    };
  }

  function preconditionUnmetWhatWouldFlipFact(): HandlerFact {
    return {
      fact_type: 'what_would_flip',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: true, option_count: 4 },
    };
  }

  it('explain_results precondition_unmet:true + analysisReady.status: ready → executable run_analysis chip', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [preconditionUnmetExplainResultsFact()],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
    expect(chips[0].id).toBe('chip_action_run_analysis');
    expect(chips[0].label).toBe('Run analysis');
  });

  it('what_would_flip precondition_unmet:true + analysisReady.status: ready → executable run_analysis chip', () => {
    const chips = generateChips({
      stage: 'decide',
      handlerFacts: [preconditionUnmetWhatWouldFlipFact()],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
    expect(chips[0].id).toBe('chip_action_run_analysis');
  });

  it('explain_results precondition_unmet:true + analysisReady.status: needs_encoding → no executable chip from precondition rule', () => {
    // The precondition rule does NOT fire when readiness is not 'ready'.
    // Downstream rules may emit a conversational fallback; assert the
    // executable run_analysis chip is suppressed specifically.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [preconditionUnmetExplainResultsFact()],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: {
        status: 'needs_encoding',
        options: [],
        goal_node_id: 'g',
      } as never,
    });
    for (const c of chips) {
      expect(c.action_type).not.toBe('run_analysis');
    }
  });

  it('explain_results precondition_unmet:true + analysisReady undefined → no executable chip', () => {
    // Readiness unknown — the precondition rule does not fire. Downstream
    // facts_absent rule emits the conversational setup prompt.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [preconditionUnmetExplainResultsFact()],
      analysis: null,
      validationRegistry: REGISTRY,
    });
    for (const c of chips) {
      expect(c.action_type).not.toBe('run_analysis');
    }
  });

  it('explain_results happy path (precondition_unmet:false, prior run_analysis present) → NO run_analysis chip from precondition rule', () => {
    // Regression guard: the precondition rule must read the typed
    // result.precondition_unmet field, not just fact_type === 'explain_results'.
    const happyPathFact: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: false, option_count: 4 },
    };
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [happyPathFact],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    for (const c of chips) {
      expect(c.action_type).not.toBe('run_analysis');
    }
  });
});
