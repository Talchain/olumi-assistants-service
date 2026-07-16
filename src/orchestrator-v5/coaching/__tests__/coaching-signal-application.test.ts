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

const { appendLastCoachingSignalMock } = vi.hoisted(() => ({
  appendLastCoachingSignalMock: vi.fn(async () => {}),
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

function runFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'Ran analysis',
    },
  } as unknown as HandlerFact;
}

function runOutcome(): SuccessfulHandlerOutcome {
  return { assistant_text: 'done', handler_facts: [runFact()], llm_calls_used: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyCoachingSignal', () => {
  it('first run: FIRST_ANALYSIS_COMPLETE fires, marker attached to the run_analysis fact, sidecar appended', () => {
    const facts = [runFact()];
    const out = applyCoachingSignal({
      proposedHandlerId: 'run_analysis',
      outcome: runOutcome(),
      contextPack: null,
      priorFacts: [],
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
      outcome: runOutcome(),
      contextPack: null,
      priorFacts: [runFact()],
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

  it('no detection: returns nulls and the input facts untouched, no sidecar write', () => {
    const facts = [runFact()];
    const out = applyCoachingSignal({
      proposedHandlerId: 'explain_results',
      outcome: runOutcome(),
      contextPack: null,
      priorFacts: [],
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
