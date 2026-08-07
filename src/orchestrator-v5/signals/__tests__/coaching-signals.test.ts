import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { ContextPack } from '../../context/context-pack-assembler.js';
import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import { COACHING_TEXT, detectCoachingSignal } from '../coaching-signals.js';

function makeContextPack(overrides: {
  topDrivers?: readonly string[];
  analysisPresent?: boolean;
} = {}): ContextPack {
  const driverLabels = overrides.topDrivers ?? ['Customer Churn'];
  return {
    version: '2.0',
    stage: 'analyse',
    graph: {
      nodes: [],
      edges: [],
      options: [],
      goals: [],
      constraints: [],
      counts: { nodes: 0, edges: 0, options: 0, goals: 0, constraints: 0 },
    },
    analysis:
      overrides.analysisPresent === false
        ? null
        : {
            status: 'complete',
            leading_option: { label: 'Option A', probability: 0.6 },
            runner_up: { label: 'Option B', probability: 0.4 },
            margin_pp: 20,
            robustness_band: 'moderate',
            top_drivers: driverLabels.map((label, i) => ({
              factor_label: label,
              sensitivity_value: 0.5 - i * 0.1,
            })),
            fragile_edges: [],
            staleness_reason: null,
          },
    conversation: {
      recent_turns: [],
      turn_count: 1,
      last_tool_used: null,
      pending_confirmation: false,
    },
    coaching: {
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    },
    compound_detected: false,
    compound_pattern_matched: null,
    parsed_quantities: [],
    system_event: null,
  };
}

function runAnalysisOutcome(): SuccessfulHandlerOutcome {
  const fact: HandlerFact = {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'Ran analysis',
    },
  };
  return { assistant_text: 'done', handler_facts: [fact], llm_calls_used: 0 };
}

// ── ROADMAP 2.73 rerun fixtures — PLoT V2 envelope shape accepted by
//    compactAnalysis (mirrors compare-runs.test.ts's `envelope`) ──────────

function runEnvelope(opts: {
  options: Array<{ id: string; label: string; win: number }>;
}): Record<string, unknown> {
  return {
    analysis_status: 'completed',
    results: opts.options.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      win_probability: o.win,
      factor_sensitivity: [],
    })),
  };
}

function runAnalysisOutcomeWithEnvelope(
  env: Record<string, unknown>,
): SuccessfulHandlerOutcome {
  const fact: HandlerFact = {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'Ran analysis',
      enrichment: env,
    },
  } as unknown as HandlerFact;
  return { assistant_text: 'done', handler_facts: [fact], llm_calls_used: 0 };
}

function priorRunAnalysisFactWithEnvelope(
  env: Record<string, unknown>,
  /** `null` OMITS `computed_at` entirely — the legacy pre-0.10.0 shape. */
  computedAt: string | null = '2026-07-01T00:00:00.000Z',
): HandlerFact {
  const result: Record<string, unknown> = {
    scenario_id: 'scen-a',
    leading_option_id: 'opt-1',
    summary: 'prior',
    enrichment: env,
    graph_hash_at_run: 'hash-prior',
  };
  if (computedAt !== null) result.computed_at = computedAt;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result,
  } as unknown as HandlerFact;
}

function setFactorOutcome(targetId: string): SuccessfulHandlerOutcome {
  const fact: HandlerFact = {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: {
      target_id: targetId,
      status: 'applied',
      before: { value: 1 },
      after: { value: 2 },
    },
  };
  return { assistant_text: 'done', handler_facts: [fact], llm_calls_used: 0 };
}

/**
 * A no-op edit outcome: the handler ran and succeeded, but the proposed
 * value already matched the persisted one, so `noop: true` and
 * `status: 'noop'`. Mirrors what set-factor-value.ts emits at :411/:423.
 */
function noopSetFactorOutcome(targetId: string): SuccessfulHandlerOutcome {
  const fact: HandlerFact = {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: true,
    result: {
      target_id: targetId,
      status: 'noop',
      before: { value: 2 },
      after: { value: 2 },
    },
  };
  return { assistant_text: 'already', handler_facts: [fact], llm_calls_used: 0 };
}

function noopEdgeOutcome(targetId: string): SuccessfulHandlerOutcome {
  const fact: HandlerFact = {
    fact_type: 'adjust_edge_strength',
    fact_version: 1,
    noop: true,
    result: {
      target_id: targetId,
      status: 'noop',
      before: { strength: { mean: 0.4 } },
      after: { strength: { mean: 0.4 } },
    },
  };
  return { assistant_text: 'already', handler_facts: [fact], llm_calls_used: 0 };
}

function noopAddConstraintOutcome(targetId: string): SuccessfulHandlerOutcome {
  const fact: HandlerFact = {
    fact_type: 'add_constraint',
    fact_version: 1,
    noop: true,
    result: {
      target_id: targetId,
      status: 'noop',
      before: { value: 5 },
      after: { value: 5 },
    },
  };
  return { assistant_text: 'already', handler_facts: [fact], llm_calls_used: 0 };
}

function priorRunAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'prior',
    },
  };
}

describe('detectCoachingSignal', () => {
  /**
   * ROADMAP 2.804 — the detector's contract for the new REQUIRED
   * `mayNameLeadingOption` input, pinned directly at this level.
   *
   * The wider property (that this boolean is the TURN-level, display-bound
   * permission and not the per-run one) is proven against real fact chains in
   * `coaching/__tests__/coaching-signal-leader-permission.test.ts`. What is
   * pinned HERE is narrower and complementary: given the permission, the
   * detector does the right thing with it — and it does so on the SAME
   * fixtures every other test in this file uses, so a change to the fixtures
   * moves both arms together.
   */
  describe('the leader-claim permission governs both run_analysis signals', () => {
    it('withheld ⇒ FIRST_ANALYSIS_COMPLETE is SUPPRESSED, not reworded', () => {
      const permitted = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [],
      });
      const withheld = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: false,
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [],
      });
      // The pair is the point: one input flipped, opposite outcomes. Asserting
      // only the withheld arm would pass on a detector that had stopped firing
      // this signal altogether.
      expect(permitted?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
      expect(withheld).toBeNull();
    });

    it('withheld ⇒ RERUN_ANALYSIS_COMPLETE degrades to the comparison-free copy, keeping its id', () => {
      const permitted = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      const withheld = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: false,
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      // Same id both ways — the telemetry series must not go dark on a
      // withheld turn — but different copy, bound to the production bank.
      expect(permitted?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
      expect(withheld?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
      expect(withheld?.coaching_text).toBe(
        COACHING_TEXT.RERUN_ANALYSIS_COMPLETE({ runDelta: null }),
      );
    });

    it('the permission governs run_analysis ONLY — an edit-handler signal is untouched by it', () => {
      // The gate sits inside `if (proposedHandlerId === 'run_analysis')`. If it
      // ever escaped that branch, every edit turn would lose its coaching on a
      // withheld scenario — a silent, wide regression. Pinned by a control.
      const withheldEdit = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: false,
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(withheldEdit?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    });
  });

  describe('FIRST_ANALYSIS_COMPLETE', () => {
    it('fires on the first successful run_analysis (no prior facts)', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [],
      });
      expect(detection?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
      expect(detection?.coaching_text).toMatch(/first analysis/i);
    });

    it('yields to RERUN_ANALYSIS_COMPLETE on a subsequent run_analysis (ROADMAP 2.73)', () => {
      // Pre-2.73 this returned null, so every rerun turn shipped zero
      // coaching prose by construction.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
    });

    it('fires on first success even when prior run_analysis turn failed (no fact emitted)', () => {
      // Paul's Task C correction: failed handler turns throw and never emit
      // facts. A successful first analysis must therefore still see an empty
      // priorFacts array and fire FIRST_ANALYSIS_COMPLETE.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [], // prior failed attempt produced no fact
      });
      expect(detection?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    });
  });

  describe('RERUN_ANALYSIS_COMPLETE (ROADMAP 2.73)', () => {
    it('fires with comparison-free copy when the runs cannot be projected', () => {
      // Prior fact has no enrichment envelope (legacy shape) → projectRunFact
      // returns null → the copy acknowledges the rerun without a comparison.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
      expect(detection?.coaching_text).toMatch(/re-run/i);
      expect(detection?.coaching_text.length).toBeGreaterThan(0);
    });

    it('names the unchanged leader when the delta shows no movement', () => {
      const env = runEnvelope({
        options: [
          { id: 'a', label: 'Offshore', win: 0.62 },
          { id: 'b', label: 'Onshore', win: 0.38 },
        ],
      });
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcomeWithEnvelope(env),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFactWithEnvelope(env)],
      });
      expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
      expect(detection?.coaching_text).toContain('unchanged');
      expect(detection?.coaching_text).toContain('Offshore still leads');
    });

    it('names the delta when the leading option changed', () => {
      const priorEnv = runEnvelope({
        options: [
          { id: 'a', label: 'Offshore', win: 0.62 },
          { id: 'b', label: 'Onshore', win: 0.38 },
        ],
      });
      const currentEnv = runEnvelope({
        options: [
          { id: 'b', label: 'Onshore', win: 0.55 },
          { id: 'a', label: 'Offshore', win: 0.45 },
        ],
      });
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcomeWithEnvelope(currentEnv),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFactWithEnvelope(priorEnv)],
      });
      expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
      expect(detection?.coaching_text).toContain('Offshore led before');
      expect(detection?.coaching_text).toContain('Onshore now leads');
    });

    // ── F2 (same defect class as the comparison pair): the "previous run"
    // this copy diffs against must be the canonical newest one, not whichever
    // successful fact happens to sit first in the array.
    it('F2 RED: diffs against the NEWEST prior run by computed_at, not the first in the array', () => {
      const offshoreLeads = runEnvelope({
        options: [
          { id: 'a', label: 'Offshore', win: 0.62 },
          { id: 'b', label: 'Onshore', win: 0.38 },
        ],
      });
      const onshoreLeads = runEnvelope({
        options: [
          { id: 'b', label: 'Onshore', win: 0.62 },
          { id: 'a', label: 'Offshore', win: 0.38 },
        ],
      });
      // A legacy fact with no computed_at sits FIRST; the genuinely newest
      // prior run sits second. Array position says "Offshore led before";
      // the canonical ordering says the previous run already led with Onshore.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcomeWithEnvelope(onshoreLeads),
        contextPack: makeContextPack(),
        priorFacts: [
          priorRunAnalysisFactWithEnvelope(offshoreLeads, null),
          priorRunAnalysisFactWithEnvelope(onshoreLeads, '2026-07-05T00:00:00.000Z'),
        ],
      });
      expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
      expect(detection?.coaching_text).toContain('Onshore still leads');
      expect(detection?.coaching_text).not.toContain('Offshore led before');
    });

    // ── F3: a rename is not an outcome change.
    it('F3: renaming the leading option does not produce "led before / now leads" copy', () => {
      const priorEnv = runEnvelope({
        options: [
          { id: 'a', label: 'Offshore', win: 0.62 },
          { id: 'b', label: 'Onshore', win: 0.38 },
        ],
      });
      const currentEnv = runEnvelope({
        options: [
          { id: 'a', label: 'Offshore (EU)', win: 0.62 },
          { id: 'b', label: 'Onshore', win: 0.38 },
        ],
      });
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcomeWithEnvelope(currentEnv),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFactWithEnvelope(priorEnv)],
      });
      expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
      expect(detection?.coaching_text).not.toContain('led before');
      expect(detection?.coaching_text).toContain('Offshore (EU) still leads');
    });

    // ⭐ A1 — the rerun composer has the same affirmative-continuity arms as
    // the gate ("The result is unchanged: X still leads.", "…its lead has
    // widened/narrowed"). On an id-less prior run they assert a continuity we
    // did not verify — here, one that is actually false.
    it('A1 RED: an id-less prior run with a DIFFERENT leader gets no continuity claim', () => {
      const labelOnlyEnv = {
        analysis_status: 'completed',
        results: [
          { option_label: 'Offshore', win_probability: 0.62, factor_sensitivity: [] },
          { option_label: 'Onshore', win_probability: 0.38, factor_sensitivity: [] },
        ],
      } as Record<string, unknown>;
      const currentEnv = runEnvelope({
        options: [
          { id: 'b', label: 'Onshore', win: 0.70 },
          { id: 'a', label: 'Offshore', win: 0.30 },
        ],
      });
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcomeWithEnvelope(currentEnv),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFactWithEnvelope(labelOnlyEnv)],
      });
      expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
      const text = detection!.coaching_text;
      // Neither direction, and no margin movement about two different leaders.
      expect(text).not.toContain('still leads');
      expect(text).not.toContain('The result is unchanged');
      expect(text).not.toContain('led before');
      expect(text).not.toContain('widened');
      expect(text).not.toContain('narrowed');
      // What IS said: this run's leader, and the honest limit.
      expect(text).toContain('Onshore leads after this re-run');
      expect(text).toContain('cannot line up');
      // Copy safety, same as the sibling arms.
      expect(text).not.toContain('—');
      expect(text).not.toMatch(/0\.\d/);
    });

    it('POSITIVE CONTROL: with ids on both runs the continuity copy still fires', () => {
      // Without this, the absence assertions above would pass against a
      // composer that never makes a continuity claim at all.
      const env = runEnvelope({
        options: [
          { id: 'a', label: 'Offshore', win: 0.62 },
          { id: 'b', label: 'Onshore', win: 0.38 },
        ],
      });
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcomeWithEnvelope(env),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFactWithEnvelope(env)],
      });
      expect(detection?.coaching_text).toContain('Offshore still leads');
    });

    it('fires with a NULL contextPack (chip-click path assembles no pack)', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcome(),
        contextPack: null,
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
      expect(detection?.coaching_text.length).toBeGreaterThan(0);
    });

    it('FIRST_ANALYSIS_COMPLETE still wins when no prior run fact exists (first-run behaviour unchanged)', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcome(),
        contextPack: null,
        priorFacts: [],
      });
      expect(detection?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    });

    it('never emits em-dashes or raw decimals in rerun copy', () => {
      const priorEnv = runEnvelope({
        options: [
          { id: 'a', label: 'Offshore', win: 0.62 },
          { id: 'b', label: 'Onshore', win: 0.38 },
        ],
      });
      const currentEnv = runEnvelope({
        options: [
          { id: 'a', label: 'Offshore', win: 0.7 },
          { id: 'b', label: 'Onshore', win: 0.3 },
        ],
      });
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcomeWithEnvelope(currentEnv),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFactWithEnvelope(priorEnv)],
      });
      expect(detection).not.toBeNull();
      expect(detection!.coaching_text).not.toContain('—');
      expect(detection!.coaching_text).not.toContain('–');
      expect(detection!.coaching_text).not.toMatch(/0\.\d/);
    });
  });

  describe('STALE_ANALYSIS_AFTER_EDIT', () => {
    it('fires on an edit handler when a prior run_analysis fact exists', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: true,
        outcome: setFactorOutcome('f-cost'),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    });

    it('does not fire on an edit handler when no prior analysis exists', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: true,
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack({ analysisPresent: false }),
        priorFacts: [],
      });
      expect(detection).toBeNull();
    });

    // ------------------------------------------------------------------
    // Gate-1 claim integrity. STALE_ANALYSIS_AFTER_EDIT asserts "This
    // change affects the model. The current analysis may not reflect it."
    // A no-op edit changed nothing, so it cannot stale an analysis, and
    // both sentences would be false. The fact channel already carries
    // `noop: true`; the signal must honour it.
    // ------------------------------------------------------------------
    it('does NOT fire on a NO-OP set_factor_value even with a prior analysis', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: true,
        outcome: noopSetFactorOutcome('f-cost'),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection).toBeNull();
    });

    it('does NOT fire on a NO-OP adjust_edge_strength even with a prior analysis', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'adjust_edge_strength',
        mayNameLeadingOption: true,
        outcome: noopEdgeOutcome('f-budget→g-revenue'),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection).toBeNull();
    });

    it('does NOT fire on a NO-OP add_constraint even with a prior analysis', () => {
      // add_constraint's NARRATION is already honest (ROADMAP 1.19(a)
      // formatConstraintUnchanged), but it still emitted false staleness
      // coaching on a no-op restatement. The coaching gate covers all
      // three edit handlers, not just the two whose narration was wrong.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'add_constraint',
        mayNameLeadingOption: true,
        outcome: noopAddConstraintOutcome('f-churn'),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection).toBeNull();
    });

    it('STILL fires on a real (non-noop) edit with a prior analysis (the gate must discriminate)', () => {
      // Guard against "fix by suppression": gating on noop must not
      // silence the signal on edits that genuinely did stale the
      // analysis. Without this, `return null` would pass the tests above.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: true,
        outcome: setFactorOutcome('f-cost'),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
      expect(detection?.coaching_text).toContain('This change affects the model');
    });
  });

  describe('HIGH_SENSITIVITY_EDIT', () => {
    it('fires on an edit to a top driver when no prior analysis exists in facts', () => {
      // HIGH_SENSITIVITY branch: no prior run_analysis fact, but contextPack
      // carries top_drivers. The edit target matches a driver label.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: true,
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack({ topDrivers: ['Customer Churn', 'Ad Spend'] }),
        priorFacts: [],
      });
      expect(detection?.signal_id).toBe('HIGH_SENSITIVITY_EDIT');
      expect(detection?.coaching_text).toContain('Customer Churn');
    });

    it('does not fire when the edit target is not among top drivers', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: true,
        outcome: setFactorOutcome('Unrelated Factor'),
        contextPack: makeContextPack({ topDrivers: ['Customer Churn'] }),
        priorFacts: [],
      });
      expect(detection).toBeNull();
    });

    it('does NOT fire on a NO-OP edit of a top driver', () => {
      // "You're editing X ... Rerunning will show how this changes the
      // picture" is equally false on a no-op: nothing was edited and a
      // re-run would show an identical picture. Both edit-branch signals
      // presuppose an actual edit, so the gate sits on the branch.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: true,
        outcome: noopSetFactorOutcome('Customer Churn'),
        contextPack: makeContextPack({ topDrivers: ['Customer Churn', 'Ad Spend'] }),
        priorFacts: [],
      });
      expect(detection).toBeNull();
    });
  });

  describe('priority order (STALE > HIGH_SENSITIVITY > FIRST_ANALYSIS)', () => {
    it('picks STALE over HIGH_SENSITIVITY when both are eligible', () => {
      // Edit a top driver AND a prior analysis exists in facts. STALE wins.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: true,
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack({ topDrivers: ['Customer Churn'] }),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    });
  });

  describe('non-action handlers', () => {
    it('returns null for an unknown handler_id', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'explain_result',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [],
      });
      expect(detection).toBeNull();
    });
  });

  describe('coaching text invariants', () => {
    it('never emits em-dashes in any signal text', () => {
      const firstAnalysis = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        mayNameLeadingOption: true,
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [],
      });
      const stale = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: true,
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      const high = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        mayNameLeadingOption: true,
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack({ topDrivers: ['Customer Churn'] }),
        priorFacts: [],
      });

      for (const d of [firstAnalysis, stale, high]) {
        expect(d).not.toBeNull();
        expect(d!.coaching_text).not.toContain('—');
        expect(d!.coaching_text).not.toContain('–');
      }
    });
  });
});
