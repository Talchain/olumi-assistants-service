/**
 * ROADMAP 2.73 — shared STEP-5 coaching-signal application helper.
 *
 * Pins the single-owner contract: detector → telemetry → run_analysis
 * fact-attach → sidecar append. Both dispatch paths (turn-executor and
 * chip-click) invoke this helper, so its behaviour IS the coaching-signal
 * behaviour of the product.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import type { LastCoachingSignalRecord } from '../last-coaching-signal-log.js';

// Typed at the real appendLastCoachingSignal signature so mock.calls carries
// the record argument (an untyped `vi.fn(async () => {})` types calls as `[]`,
// which cannot be indexed). Type-only import above is erased, so referencing
// it inside the hoisted factory is safe.
const { appendLastCoachingSignalMock } = vi.hoisted(() => ({
  appendLastCoachingSignalMock: vi.fn(
    async (_record: LastCoachingSignalRecord, _filePath?: string): Promise<void> => {},
  ),
}));

vi.mock('../last-coaching-signal-log.js', async () => {
  const actual = await vi.importActual<typeof import('../last-coaching-signal-log.js')>(
    '../last-coaching-signal-log.js',
  );
  return {
    ...actual,
    appendLastCoachingSignal: appendLastCoachingSignalMock,
  };
});

import { applyCoachingSignal } from '../coaching-signal-application.js';
import type { ClaimSafetyScenarioScope } from '../../context/claim-safety-read.js';

/**
 * ROADMAP 2.804 — the scenario scope every caller must now supply. Array-only:
 * no scenario-scoped read, so the degraded-store fail-closed fallback cannot
 * arm and the permission is decided purely by the facts each test passes.
 */
const SCOPE: ClaimSafetyScenarioScope = {
  newestAnalysisFact: null,
  readOk: true,
  windowTruncated: false,
};

/**
 * ROADMAP 2.804 — `constraint_verdict` is now LOAD-BEARING in this fixture and
 * was previously absent.
 *
 * The coaching slot's leader-claim permission used to come from an internal
 * handler-outcome channel that defaulted to "permitted"; it now comes from the
 * fact chain, which fails CLOSED on a fact carrying no verdict stamp. An
 * unstamped fact is the pre-#710 population — a shape `run_analysis` has not
 * written since — so a fixture without this stamp was not modelling a current
 * production turn at all, and would now (correctly) read as withheld and
 * suppress the very signals these tests are about. Stamped permitted here, in
 * the exact shape `projectClaimSafety` writes.
 */
function runFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'Ran analysis',
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'not_applicable',
      },
    },
  } as unknown as HandlerFact;
}

function runOutcome(): SuccessfulHandlerOutcome {
  return { assistant_text: 'done', handler_facts: [runFact()], llm_calls_used: 0 };
}

function projectableRunFact(computedAt: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'Ran analysis',
      computed_at: computedAt,
      graph_hash_at_run: 'aag_v1:test',
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'not_applicable',
      },
      enrichment: {
        analysis_status: 'completed',
        results: [
          {
            option_id: 'opt-1',
            option_label: 'Launch now',
            win_probability: 0.62,
            factor_sensitivity: [],
          },
          {
            option_id: 'opt-2',
            option_label: 'Wait',
            win_probability: 0.38,
            factor_sensitivity: [],
          },
        ],
      },
    },
  } as unknown as HandlerFact;
}

function factorEditFact(label: string): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: {
      target_id: 'factor-churn',
      status: 'applied',
      before: { value: 1, raw_value: 1, label },
      after: { value: 2, raw_value: 2, label },
    },
  } as unknown as HandlerFact;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyCoachingSignal', () => {
  it('first run: FIRST_ANALYSIS_COMPLETE fires, marker attached to the run_analysis fact, sidecar appended', () => {
    const facts = [runFact()];
    const out = applyCoachingSignal({
      proposedHandlerId: 'run_analysis',
      claimSafetyScope: SCOPE,
      outcome: runOutcome(),
      contextPack: null,
      priorFacts: [],
      priorAnalysisFacts: [],
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
    });

    expect(out.signalId).toBe('FIRST_ANALYSIS_COMPLETE');
    expect(out.coachingText).toMatch(/first analysis/i);
    const attached = out.handlerFacts[0] as {
      result: { enrichment?: Record<string, unknown> };
    };
    expect(attached.result.enrichment?.coaching_signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    expect(attached.result.enrichment?.coaching_signal_turn_id).toBe('req-1');
    expect(appendLastCoachingSignalMock).toHaveBeenCalledTimes(1);
    expect(appendLastCoachingSignalMock.mock.calls[0]![0]).toMatchObject({
      scenario_id: 'scen-a',
      signal_id: 'FIRST_ANALYSIS_COMPLETE',
      turn_id: 'req-1',
    });
  });

  it('rerun: RERUN_ANALYSIS_COMPLETE fires when a prior run_analysis fact exists', () => {
    const facts = [runFact()];
    const out = applyCoachingSignal({
      proposedHandlerId: 'run_analysis',
      claimSafetyScope: SCOPE,
      outcome: runOutcome(),
      contextPack: null,
      priorFacts: [runFact()],
      priorAnalysisFacts: [runFact()],
      handlerFacts: facts,
      requestId: 'req-2',
      scenarioId: 'scen-a',
    });

    expect(out.signalId).toBe('RERUN_ANALYSIS_COMPLETE');
    expect(out.coachingText).toBeTruthy();
    const attached = out.handlerFacts[0] as {
      result: { enrichment?: Record<string, unknown> };
    };
    expect(attached.result.enrichment?.coaching_signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
    expect(appendLastCoachingSignalMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the hot mixed chronology intact for run -> mutation -> rerun attribution', () => {
    const priorRun = projectableRunFact('2026-08-01T00:00:00.000Z');
    const currentRun = projectableRunFact('2026-08-02T00:00:00.000Z');
    const mutation = factorEditFact('Customer churn');

    const out = applyCoachingSignal({
      proposedHandlerId: 'run_analysis',
      claimSafetyScope: SCOPE,
      outcome: {
        assistant_text: 'done',
        handler_facts: [currentRun],
        llm_calls_used: 0,
      },
      contextPack: null,
      // The hot window is the only source with truthful cross-type ordering.
      // Prefixing the independently ordered scenario analysis page would put
      // `priorRun` at index 0 and silently erase this attribution.
      priorFacts: [mutation, priorRun],
      priorAnalysisFacts: [priorRun],
      handlerFacts: [currentRun],
      requestId: 'req-rerun-attribution',
      scenarioId: 'scen-a',
    });

    expect(out.signalId).toBe('RERUN_ANALYSIS_COMPLETE');
    expect(out.coachingText?.startsWith('Since you changed Customer churn, ')).toBe(true);
  });

  it('no detection: returns nulls and the input facts untouched, no sidecar write', () => {
    const facts = [runFact()];
    const out = applyCoachingSignal({
      proposedHandlerId: 'explain_results',
      claimSafetyScope: SCOPE,
      outcome: runOutcome(),
      contextPack: null,
      priorFacts: [],
      priorAnalysisFacts: [],
      handlerFacts: facts,
      requestId: 'req-3',
      scenarioId: 'scen-a',
    });

    expect(out.signalId).toBeNull();
    expect(out.coachingText).toBeNull();
    expect(out.handlerFacts).toBe(facts);
    expect(appendLastCoachingSignalMock).not.toHaveBeenCalled();
  });
});
