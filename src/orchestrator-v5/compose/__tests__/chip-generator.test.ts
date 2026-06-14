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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { ActionSchema } from '@talchain/schemas/boundary';

import { generateChips } from '../chip-generator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { ContextPackAnalysis } from '../../context/context-pack-assembler.js';
import { setTestSink } from '../../../utils/telemetry.js';

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

  it('after run_analysis → emits TWO executable action chips (explain_results + what_would_flip)', () => {
    // Phase 2b round-2 reviewer finding: previously the "Explain the
    // result" chip had no `action_type`, so chip-clicks silently routed
    // through Sonnet (ORIENT, ~12s) even though the deterministic
    // `explain_results` dispatcher exists in
    // `chip-click-dispatch.ts`'s whitelist. The chip now emits
    // `action_type: 'explain_results'` (plural — matches the registered
    // handler) so the click hits the bypass and saves the latency.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(2);
    // Both chips now executable.
    expect(chips[0].label).toBe('Explain the result');
    expect(chips[0].action_type).toBe('explain_results');
    expect(chips[0].id).toBe('chip_action_explain_results');
    expect(chips[1].label).toBe('What could change the outcome?');
    expect(chips[1].action_type).toBe('what_would_flip');
    expect(chips[1].id).toBe('chip_action_what_would_flip');
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

// New SUCCESS rule for what_would_flip — closes the missing follow-up
// affordance on the deterministic-fallback closing question ("Which of
// those would you like to explore changing?"). Mirrors the existing
// explain_results SUCCESS rule at the top of generateChips.
describe('generateChips — what_would_flip SUCCESS rule', () => {
  function successfulWhatWouldFlipFact(): HandlerFact {
    // Production what_would_flip facts always carry noop: true; the
    // success discriminator is result.precondition_unmet === false.
    return {
      fact_type: 'what_would_flip',
      fact_version: 1,
      noop: true,
      result: {
        precondition_unmet: false,
        option_count: 2,
        answer_source: 'deterministic_fallback',
        fallback_reason: null,
        answer_text_length: 100,
        staleness_prefixed: false,
      },
    } as HandlerFact;
  }

  it('emits exactly THREE exploration chips on a successful what_would_flip turn', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [successfulWhatWouldFlipFact()],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(3);
  });

  it('emits the canonical chip labels and action_types', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [successfulWhatWouldFlipFact()],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    const labels = chips.map((c) => c.label);
    expect(labels).toEqual([
      'Walk me through the analysis',
      'Re-run analysis',
      'Run a pre-mortem',
    ]);
    const types = chips.map((c) => c.action_type ?? null);
    expect(types).toEqual(['explain_results', 'run_analysis', null]);
  });

  it('first two chips carry IDs that match the deterministic chip-click whitelist convention', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [successfulWhatWouldFlipFact()],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips[0].id).toBe('chip_action_explain_results');
    expect(chips[1].id).toBe('chip_action_rerun_analysis');
    expect(chips[2].id).toBe('chip_prompt_run_pre_mortem');
  });

  it('every chip is schema-valid per the boundary ActionSchema', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [successfulWhatWouldFlipFact()],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    for (const c of chips) {
      expect(() => ActionSchema.parse(c)).not.toThrow();
    }
  });

  it('does NOT fire for a precondition-UNMET what_would_flip fact (falls through to existing rule)', () => {
    const preconditionFailFact: HandlerFact = {
      fact_type: 'what_would_flip',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: true, option_count: 2 },
    };
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [preconditionFailFact],
      priorFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    // Existing precondition rule emits exactly ONE chip ("Run analysis").
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
  });

  it('does NOT regress the explain_results SUCCESS rule (still emits its single chip)', () => {
    const successfulExplainResultsFact: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: false, option_count: 2 },
    };
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [successfulExplainResultsFact],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('what_would_flip');
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

  // P0 V5 golden-path repair — predicate parity with isSuccessfulRunAnalysisFact.
  // A run_analysis fact whose status doesn't normalise to a canonical success
  // must NOT count as "analysis exists" here, mirroring the handler-side
  // precondition. Earlier behaviour accepted any non-noop fact.
  it('returns "facts_absent" when only a partial-status run_analysis fact is present (predicate parity)', async () => {
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    const partial: HandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: '00000000-0000-4000-8000-000000000001',
        leading_option_id: null,
        summary: 'Partial result',
        enrichment: { analysis_status: 'partial' },
      },
    };
    expect(deriveProjectionStatus([partial], null)).toBe('facts_absent');
    expect(deriveProjectionStatus([], null, [partial])).toBe('facts_absent');
  });

  it('returns "facts_absent" when only a failed-status run_analysis fact is present', async () => {
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    const failed: HandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: '00000000-0000-4000-8000-000000000001',
        leading_option_id: null,
        summary: 'Failed',
        enrichment: { analysis_status: 'failed' },
      },
    };
    expect(deriveProjectionStatus([failed], null)).toBe('facts_absent');
  });

  it('still treats canonical-success status (computed/completed/ready) as evidence', async () => {
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    const computed: HandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: '00000000-0000-4000-8000-000000000001',
        leading_option_id: 'opt-a',
        summary: 'OK',
        enrichment: { analysis_status: 'computed' },
      },
    };
    expect(deriveProjectionStatus([computed], analysisAt('stable'))).toBe(
      'projection_populated',
    );
  });

  it('treats legacy fact (no analysis_status) as success — pre-0.10.0 compat', async () => {
    const { deriveProjectionStatus } = await import('../chip-generator.js');
    // runAnalysisFact() has no enrichment.analysis_status; this is the
    // legacy-fact path that selectRunAnalysisFact also accepts.
    expect(deriveProjectionStatus([runAnalysisFact()], analysisAt('stable'))).toBe(
      'projection_populated',
    );
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

describe('generateChips — V5 state-trust stale-rerun rule', () => {
  // V5 state-trust retarget: the rerun-analysis chip is now gated on
  // turnOutcome.analysis_freshness === 'stale', NOT on the legacy
  // analysis.staleness_reason. Freshness is derived from a deterministic
  // graph-hash comparison (not the always-set fallback string), so a
  // fresh-after-run_analysis turn correctly suppresses the chip and a
  // post-edit stale-explain turn correctly emits exactly one.

  function staleExplainResultsFact(): HandlerFact {
    return {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: {
        precondition_unmet: false,
        option_count: 4,
        answer_source: 'sonnet',
        fallback_reason: null,
        answer_text_length: 200,
        staleness_prefixed: false,
      },
    } as HandlerFact;
  }

  function turnOutcomeWithFreshness(
    freshness: 'fresh' | 'stale' | 'unknown' | 'none',
  ): import('../../turn-outcome.js').TurnOutcome {
    return {
      graph_mutated: false,
      analysis_run: false,
      analysis_selected_fact_index: freshness === 'none' ? null : 0,
      analysis_freshness: freshness,
      freshness_reason:
        freshness === 'fresh'
          ? 'graph_hash_match'
          : freshness === 'stale'
            ? 'graph_hash_diverged'
            : freshness === 'unknown'
              ? 'legacy_fact_missing_hash'
              : 'no_successful_run_analysis_fact',
    };
  }

  it('turnOutcome.analysis_freshness=stale + analysisReady=ready → executable Rerun analysis chip', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [staleExplainResultsFact()],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
      turnOutcome: turnOutcomeWithFreshness('stale'),
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Rerun analysis');
    expect(chips[0].action_type).toBe('run_analysis');
    expect(chips[0].id).toBe('chip_action_rerun_analysis');
  });

  it('turnOutcome.analysis_freshness=stale + analysisReady=needs_user_input → no rerun chip', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [staleExplainResultsFact()],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'needs_user_input', options: [], goal_node_id: 'g' } as never,
      turnOutcome: turnOutcomeWithFreshness('stale'),
    });
    for (const c of chips) {
      expect(c.id).not.toBe('chip_action_rerun_analysis');
    }
  });

  it('turnOutcome.analysis_freshness=fresh → no rerun chip (the P0 fix)', () => {
    // Pre-state-trust this branch unconditionally fired the chip because
    // staleness_reason was always set. With the freshness verdict driving
    // the gate, fresh analysis correctly suppresses the chip.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [staleExplainResultsFact()],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
      turnOutcome: turnOutcomeWithFreshness('fresh'),
    });
    for (const c of chips) {
      expect(c.id).not.toBe('chip_action_rerun_analysis');
    }
  });

  it('turnOutcome.analysis_freshness=unknown → no rerun chip', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [staleExplainResultsFact()],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
      turnOutcome: turnOutcomeWithFreshness('unknown'),
    });
    for (const c of chips) {
      expect(c.id).not.toBe('chip_action_rerun_analysis');
    }
  });

  it('turnOutcome absent → no rerun chip (safe default)', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [staleExplainResultsFact()],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
    });
    for (const c of chips) {
      expect(c.id).not.toBe('chip_action_rerun_analysis');
    }
  });

  it('exactly one run_analysis-action_type chip overall when stale (no duplicate from facts_absent rule)', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [staleExplainResultsFact()],
      priorFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: { status: 'ready', options: [], goal_node_id: 'g' } as never,
      turnOutcome: turnOutcomeWithFreshness('stale'),
    });
    const runAnalysisChips = chips.filter((c) => c.action_type === 'run_analysis');
    expect(runAnalysisChips).toHaveLength(1);
  });
});

// =========================================================================
// V5 coaching — post-run_analysis validation prompt chip. Surfaces only
// when the current-turn run_analysis fact's decision_review enrichment
// contains usable evidence_enhancements (at least one entry has a
// non-empty `specific_action` string). The chip has no `action_type` —
// on click, the message text routes through the post-analysis advice
// gate's evidence_gap class for a deterministic, grounded answer.
// =========================================================================
describe('generateChips — V5 coaching post-run_analysis validation chip', () => {
  function runAnalysisFactWithDecisionReview(
    evidenceEnhancements: Record<string, unknown>,
    keyAssumptions: readonly unknown[] = [],
  ): HandlerFact {
    return {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: '00000000-0000-4000-8000-000000000001',
        leading_option_id: 'opt-a',
        summary: 'Prior run',
        win_probabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
        enrichment: {
          decision_review: {
            produced_at: '2026-05-21T10:00:00.000Z',
            evidence_enhancements: evidenceEnhancements,
            key_assumptions: keyAssumptions,
          },
        },
      },
    };
  }

  const USABLE_ENHANCEMENTS: Record<string, unknown> = Object.freeze({
    fac_delivery: Object.freeze({
      specific_action: 'Pull on-time delivery rates from the last two releases.',
      rationale: 'top sensitivity',
    }),
    fac_cost: Object.freeze({
      specific_action: 'Talk to the finance team about historical overruns.',
    }),
  });

  it('emits validation prompt chip when evidence_enhancements is non-empty', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFactWithDecisionReview(USABLE_ENHANCEMENTS)],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(3);
    // Order: explain_results → what_would_flip → validation prompt
    expect(chips[0].id).toBe('chip_action_explain_results');
    expect(chips[1].id).toBe('chip_action_what_would_flip');
    expect(chips[2].id).toBe('chip_prompt_validate_decision');
    expect(chips[2].label).toBe('What should we validate?');
    expect(chips[2].message).toBe(
      'What should we validate or research to build confidence in this decision?',
    );
  });

  it('validation chip label is at most 30 characters', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFactWithDecisionReview(USABLE_ENHANCEMENTS)],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    const validationChip = chips.find((c) => c.id === 'chip_prompt_validate_decision');
    expect(validationChip).toBeDefined();
    expect(validationChip!.label.length).toBeLessThanOrEqual(30);
  });

  it('validation chip has NO action_type (prompt chip routes through advice gate)', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFactWithDecisionReview(USABLE_ENHANCEMENTS)],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    const validationChip = chips.find((c) => c.id === 'chip_prompt_validate_decision');
    expect(validationChip).toBeDefined();
    expect(validationChip!.action_type).toBeUndefined();
  });

  it('suppresses validation chip when run_analysis fact has no enrichment', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(2);
    expect(chips.some((c) => c.id === 'chip_prompt_validate_decision')).toBe(false);
  });

  it('suppresses validation chip when decision_review.evidence_enhancements is empty', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFactWithDecisionReview({})],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(2);
    expect(chips.some((c) => c.id === 'chip_prompt_validate_decision')).toBe(false);
  });

  it('suppresses validation chip when evidence_enhancements entries lack specific_action', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [
        runAnalysisFactWithDecisionReview({
          fac_a: { rationale: 'top sensitivity' }, // missing specific_action
          fac_b: { specific_action: '   ' }, // whitespace-only
          fac_c: { specific_action: 42 }, // wrong type
        }),
      ],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(2);
    expect(chips.some((c) => c.id === 'chip_prompt_validate_decision')).toBe(false);
  });

  it('CODEX BLOCKER FIX — suppresses validation chip when current-turn fact has no enrichment, EVEN IF priorFacts is usable', () => {
    // Chip honesty contract: current-turn handler facts are authoritative.
    // If the current run_analysis fact has no usable
    // decision_review.evidence_enhancements[].specific_action, the chip
    // must be suppressed. We must NOT fall back to older priorFacts to
    // emit the chip — doing so would point the user at stale pre-edit
    // evidence right after a soft-failed enricher on this turn.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFact()], // no enrichment on current turn
      priorFacts: [runAnalysisFactWithDecisionReview(USABLE_ENHANCEMENTS)], // older usable
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(2);
    expect(chips.some((c) => c.id === 'chip_prompt_validate_decision')).toBe(false);
  });

  it('suppresses validation chip on malformed enrichment shapes (defensive parsing)', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [
        {
          fact_type: 'run_analysis',
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: '00000000-0000-4000-8000-000000000001',
            leading_option_id: 'opt-a',
            summary: 'Prior',
            enrichment: {
              decision_review: 'not an object',
            },
          },
        } as HandlerFact,
      ],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(2);
    expect(chips.some((c) => c.id === 'chip_prompt_validate_decision')).toBe(false);
  });

  it('chip IDs are unique within the post-run_analysis chip set', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFactWithDecisionReview(USABLE_ENHANCEMENTS)],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    const ids = chips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('respects MAX_CHIPS=3 cap', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFactWithDecisionReview(USABLE_ENHANCEMENTS)],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips.length).toBeLessThanOrEqual(3);
  });

  it('validation chip passes ActionSchema validation', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFactWithDecisionReview(USABLE_ENHANCEMENTS)],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    for (const chip of chips) {
      expect(ActionSchema.safeParse(chip).success).toBe(true);
    }
  });

  it('chip text avoids developer/internal terminology', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFactWithDecisionReview(USABLE_ENHANCEMENTS)],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    const forbidden = [
      'handler_id',
      'run_analysis',
      'explain_result',
      'evidence_enhancements',
      'decision_review',
      'enrichment',
      'context_pack',
    ];
    for (const chip of chips) {
      const blob = `${chip.label} ${chip.message}`.toLowerCase();
      for (const bad of forbidden) {
        expect(blob).not.toContain(bad);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// V5 link-safe response floor — chip floor.
// When existing rules + filter would emit an empty array, applyChipFloor
// picks one safe deterministic chip from a priority ladder driven by
// analysisReady / handler facts / freshness. When no rung qualifies,
// empty is preserved and v5.chips.empty_intentional is emitted with
// reason 'no_safe_floor'.
// ════════════════════════════════════════════════════════════════════

describe('generateChips — V5 link-safe chip floor', () => {
  let events: Array<{ name: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    events = [];
    setTestSink((name, data) => {
      events.push({ name, data });
    });
  });

  afterEach(() => {
    setTestSink(null);
  });

  const eventsNamed = (name: string) => events.filter((e) => e.name === name);

  // Helpers to build well-typed fixtures for the chip floor tests.
  const readyAnalysis = () => ({
    options: [
      {
        option_id: 'opt_a',
        label: 'Option A',
        status: 'ready',
        interventions: {},
        is_baseline: false,
      },
      {
        option_id: 'opt_b',
        label: 'Option B',
        status: 'ready',
        interventions: {},
        is_baseline: false,
      },
    ],
    goal_node_id: 'goal',
    status: 'ready' as const,
  });
  const needsInputAnalysis = (status: 'needs_user_input' | 'needs_user_mapping' | 'needs_encoding') => ({
    options: [],
    goal_node_id: 'goal',
    status: status as string,
  });
  const staleOutcome = () => ({
    graph_mutated: true,
    analysis_run: false,
    analysis_selected_fact_index: 0,
    analysis_freshness: 'stale' as const,
    freshness_reason: 'graph_hash_diverged' as const,
  });

  it('existing rule emitted chips → floor does not fire (no telemetry, chips unchanged)', () => {
    // The post-run_analysis rule emits 2 executable chips. The floor
    // must be invisible in this happy path.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [runAnalysisFact()],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    expect(chips.length).toBeGreaterThan(0);
    expect(eventsNamed('v5.chips.floor_applied')).toHaveLength(0);
    expect(eventsNamed('v5.chips.empty_intentional')).toHaveLength(0);
  });

  it('frame stage no graph + no analysisReady → empty preserved + V5ChipsEmptyIntentional fires with reason no_safe_floor', () => {
    const chips = generateChips({
      stage: 'frame',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
    });
    expect(chips).toEqual([]);
    const empty = eventsNamed('v5.chips.empty_intentional');
    expect(empty).toHaveLength(1);
    expect(empty[0].data.reason).toBe('no_safe_floor');
    expect(empty[0].data.stage).toBe('frame');
    expect(empty[0].data.has_run_analysis_fact).toBe(false);
    // No floor_applied telemetry on empty case.
    expect(eventsNamed('v5.chips.floor_applied')).toHaveLength(0);
  });

  it('decide stage + analysis ready + no run_analysis fact → floor adds executable run_analysis chip', () => {
    // The analyse-stage rule does not fire (stage=decide), the
    // post-mutation rule does not fire (no mutation fact), the decide
    // rules require hasAnalysis or fragile. With no analysis, the
    // existing rules return []. Floor's "ready + no fact" rung picks
    // the executable run_analysis chip.
    const chips = generateChips({
      stage: 'decide',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: readyAnalysis(),
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
    const floor = eventsNamed('v5.chips.floor_applied');
    expect(floor).toHaveLength(1);
    expect(floor[0].data.reason).toBe('analysis_ready');
    expect(floor[0].data.has_run_analysis_fact).toBe(false);
  });

  it('decide stage + analysisReady needs_user_input → floor adds conversational Set values prompt (no action_type)', () => {
    const chips = generateChips({
      stage: 'decide',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: needsInputAnalysis('needs_user_input'),
    });
    expect(chips).toHaveLength(1);
    // Conversational prompt chip — no action_type so the upstream
    // readiness gate cannot reject it.
    expect(chips[0]).not.toHaveProperty('action_type');
    expect(chips[0].label).toBe('Set values for options');
    const floor = eventsNamed('v5.chips.floor_applied');
    expect(floor).toHaveLength(1);
    expect(floor[0].data.reason).toBe('needs_input');
    expect(floor[0].data.analysis_ready_status).toBe('needs_user_input');
  });

  it('decide stage + analysisReady needs_encoding → floor adds Set values prompt (does NOT emit executable run_analysis)', () => {
    const chips = generateChips({
      stage: 'decide',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: needsInputAnalysis('needs_encoding'),
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]).not.toHaveProperty('action_type');
    // Safety: executable run_analysis chip MUST NOT be emitted when
    // readiness is not 'ready' — the upstream gate would reject it.
    expect(chips[0].action_type).toBeUndefined();
    expect(eventsNamed('v5.chips.floor_applied')[0].data.reason).toBe('needs_input');
  });

  it('decide stage + analysisReady needs_user_mapping → floor adds Set values prompt', () => {
    const chips = generateChips({
      stage: 'decide',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: needsInputAnalysis('needs_user_mapping'),
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]).not.toHaveProperty('action_type');
    expect(eventsNamed('v5.chips.floor_applied')[0].data.reason).toBe('needs_input');
  });

  it('frame stage + prior run_analysis fact + no current handler → floor emits the EXECUTABLE what_would_flip chip (post_analysis_no_obvious_next)', () => {
    // V5 P0-B: floor priority 3 now emits an EXECUTABLE what_would_flip chip
    // (not a bare prompt) so a click dispatches the deterministic handler
    // instead of falling through to the LLM. The prior run_analysis fact makes
    // a projection buildable, so the handler precondition would 'execute'.
    const chips = generateChips({
      stage: 'frame',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      priorFacts: [runAnalysisFact()],
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('what_would_flip');
    expect(chips[0].id).toBe('chip_action_what_would_flip');
    expect(chips[0].label).toBe('What could change the outcome?');
    const floor = eventsNamed('v5.chips.floor_applied');
    expect(floor).toHaveLength(1);
    expect(floor[0].data.reason).toBe('post_analysis_no_obvious_next');
    expect(floor[0].data.has_run_analysis_fact).toBe(true);
  });

  it('stale freshness + prior run_analysis fact → floor adds conversational Re-run prompt (does NOT emit executable run_analysis)', () => {
    const chips = generateChips({
      stage: 'frame',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      priorFacts: [runAnalysisFact()],
      turnOutcome: staleOutcome(),
    });
    expect(chips).toHaveLength(1);
    // Conversational, not executable — upstream gate may have changed
    // since the fact was recorded.
    expect(chips[0]).not.toHaveProperty('action_type');
    expect(chips[0].label).toBe('Re-run analysis');
    const floor = eventsNamed('v5.chips.floor_applied');
    expect(floor).toHaveLength(1);
    expect(floor[0].data.reason).toBe('stale_post_edit');
    expect(floor[0].data.has_run_analysis_fact).toBe(true);
  });

  it('no floor chip uses an unsupported action_type', () => {
    // Sweep every priority rung. The only chip that should carry an
    // action_type is the priority-2 "ready + no fact" rung, and it
    // must use the registered 'run_analysis' identifier.
    const supportedActionTypes = new Set([
      'run_analysis',
      'explain_results',
      'what_would_flip',
    ]);
    const probes: Array<Parameters<typeof generateChips>[0]> = [
      // priority 1 (stale)
      {
        stage: 'frame',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        priorFacts: [runAnalysisFact()],
        turnOutcome: staleOutcome(),
      },
      // priority 2 (ready, no fact)
      {
        stage: 'decide',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        analysisReady: readyAnalysis(),
      },
      // priority 3 (post-analysis no next)
      {
        stage: 'frame',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        priorFacts: [runAnalysisFact()],
      },
      // priority 4 (needs_input)
      {
        stage: 'decide',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        analysisReady: needsInputAnalysis('needs_encoding'),
      },
    ];
    for (const input of probes) {
      const chips = generateChips(input);
      for (const chip of chips) {
        if ('action_type' in chip && chip.action_type !== undefined) {
          expect(supportedActionTypes).toContain(chip.action_type);
        }
      }
    }
  });

  it('no floor chip label/message contains forbidden user-facing internal vocabulary', () => {
    const forbidden = ['factor', 'node', 'edge', 'graph', 'schema', 'validator', 'patch'];
    const idPattern = /\b(opt|goal|fac|node|edge|n|e)_/i;
    const probes: Array<Parameters<typeof generateChips>[0]> = [
      {
        stage: 'frame',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        priorFacts: [runAnalysisFact()],
        turnOutcome: staleOutcome(),
      },
      {
        stage: 'decide',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        analysisReady: readyAnalysis(),
      },
      {
        stage: 'frame',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        priorFacts: [runAnalysisFact()],
      },
      {
        stage: 'decide',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        analysisReady: needsInputAnalysis('needs_encoding'),
      },
    ];
    for (const input of probes) {
      const chips = generateChips(input);
      for (const chip of chips) {
        const blob = `${chip.label} ${chip.message}`.toLowerCase();
        for (const bad of forbidden) {
          expect(blob, `chip "${chip.label}" contains forbidden term "${bad}"`).not.toContain(bad);
        }
        expect(blob, `chip "${chip.label}" leaks ID-shape token`).not.toMatch(idPattern);
      }
    }
  });

  it('floor chips have deterministic IDs prefixed with chip_prompt_floor_ or chip_action_*', () => {
    // Stale path
    const stale = generateChips({
      stage: 'frame',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      priorFacts: [runAnalysisFact()],
      turnOutcome: staleOutcome(),
    });
    expect(stale[0].id).toBe('chip_prompt_floor_rerun_analysis');

    // Needs-input path
    const needsInput = generateChips({
      stage: 'decide',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: needsInputAnalysis('needs_encoding'),
    });
    expect(needsInput[0].id).toBe('chip_prompt_floor_set_option_values');

    // Post-analysis explore path — V5 P0-B: now the executable what_would_flip
    // chip (deterministic dispatch) rather than a bare prompt.
    const postAnalysis = generateChips({
      stage: 'frame',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      priorFacts: [runAnalysisFact()],
    });
    expect(postAnalysis[0].id).toBe('chip_action_what_would_flip');
    expect(postAnalysis[0].action_type).toBe('what_would_flip');

    // Ready-no-fact path uses existing executable chip id
    const ready = generateChips({
      stage: 'decide',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      analysisReady: readyAnalysis(),
    });
    expect(ready[0].id).toBe('chip_action_run_analysis');
  });

  it('every floor chip passes ActionSchema validation', () => {
    const probes: Array<Parameters<typeof generateChips>[0]> = [
      {
        stage: 'frame',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        priorFacts: [runAnalysisFact()],
        turnOutcome: staleOutcome(),
      },
      {
        stage: 'decide',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        analysisReady: readyAnalysis(),
      },
      {
        stage: 'frame',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        priorFacts: [runAnalysisFact()],
      },
      {
        stage: 'decide',
        handlerFacts: [],
        analysis: null,
        validationRegistry: REGISTRY,
        analysisReady: needsInputAnalysis('needs_encoding'),
      },
    ];
    for (const input of probes) {
      const chips = generateChips(input);
      for (const chip of chips) {
        const parsed = ActionSchema.safeParse(chip);
        expect(parsed.success, `chip "${chip.label}" failed ActionSchema: ${JSON.stringify(chip)}`).toBe(true);
      }
    }
  });

  it('floor priority — stale beats ready (does NOT emit executable run_analysis even if readiness is ready)', () => {
    // A turn that is both ready-to-run AND has stale analysis should
    // surface the conversational Re-run prompt rather than the
    // executable Run analysis chip — readiness can drift between when
    // the fact was recorded and now.
    const chips = generateChips({
      stage: 'frame',
      handlerFacts: [],
      analysis: null,
      validationRegistry: REGISTRY,
      priorFacts: [runAnalysisFact()],
      analysisReady: readyAnalysis(),
      turnOutcome: staleOutcome(),
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]).not.toHaveProperty('action_type');
    expect(chips[0].label).toBe('Re-run analysis');
    expect(eventsNamed('v5.chips.floor_applied')[0].data.reason).toBe('stale_post_edit');
  });
});
