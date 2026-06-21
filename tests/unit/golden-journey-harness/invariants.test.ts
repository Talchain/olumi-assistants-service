/**
 * Golden-Journey Harness v1 — invariant classifier unit tests.
 *
 * Each A1..A7 classifier gets a contradiction case and a clean case. These
 * are PURE (no network, no product boot) and prove the harness logic — the
 * "what fails today" classification is only trustworthy if the classifier
 * itself is correct.
 */

import { describe, expect, it } from 'vitest';

import {
  a1AnalysisCoherence,
  a2ContextCompleteness,
  a2LiveStub,
  a3DurableStateChanged,
  a4NoFalseSuccess,
  a5CoachingGrounded,
  a6DebugExplains,
  a7RecoveryVisible,
  evaluateJourney,
  evaluateObservation,
  type ContextSnapshot,
} from '../../../tools/golden-journey-harness/invariants.js';
import type {
  TurnObservation,
  TurnRole,
  WireBody,
} from '../../../tools/golden-journey-harness/observation.js';

function obs(partial: Partial<TurnObservation> & { role: TurnRole; body?: WireBody }): TurnObservation {
  return {
    step: partial.step ?? `step_${partial.role}`,
    role: partial.role,
    httpStatus: partial.httpStatus ?? 200,
    body: partial.body,
    diagnosticTraceExpected: partial.diagnosticTraceExpected ?? true,
    priorRunHash: partial.priorRunHash ?? null,
    priorGraphHash: partial.priorGraphHash ?? null,
    optionLabels: partial.optionLabels ?? [],
    factorLabels: partial.factorLabels ?? [],
  };
}

const COMPLETE_TRACE = {
  exit_path: 'turn_executor',
  correlation_ids: { request_id: 'r', scenario_id: 's', turn_id: 't' },
};

describe('A1 — analysis coherence (provisional)', () => {
  it('fails when status=ready but prose denies analysis', () => {
    const f = a1AnalysisCoherence(
      obs({
        role: 'explain',
        body: { analysis_ready: { status: 'ready' }, assistant_text: "The results aren't back yet." },
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.component_primary).toBe('canonical_state');
    expect(f[0]!.provisional).toBe(true);
  });

  it('fails when freshness=stale but no staleness signal', () => {
    const f = a1AnalysisCoherence(
      obs({
        role: 'explain',
        body: { analysis_ready: { status: 'ready', freshness: 'stale' }, assistant_text: 'Option A leads at 62%.' },
      }),
    );
    expect(f[0]!.status).toBe('fail');
  });

  it('passes when analysis is fresh and prose does not deny it', () => {
    const f = a1AnalysisCoherence(
      obs({
        role: 'explain',
        body: { analysis_ready: { status: 'ready', freshness: 'fresh' }, assistant_text: 'Option A leads at 62%.' },
      }),
    );
    expect(f[0]!.status).toBe('pass');
    expect(f[0]!.provisional).toBe(true);
  });

  it('is exercised on a concrete mutate turn: stale acknowledged → A1 pass via dispatch', () => {
    const findings = evaluateObservation(
      obs({
        role: 'mutate',
        body: {
          analysis_ready: { status: 'ready', freshness: 'stale' },
          assistant_text: 'Updated Budget from 0 to 0.5. This makes the last analysis stale. Re-run analysis.',
          suggested_actions: [{ id: 'c', label: 'Run analysis again', message: 'Run analysis.', action_type: 'run_analysis' }],
        },
      }),
    );
    const a1 = findings.filter((f) => f.invariant_id === 'A1');
    expect(a1).toHaveLength(1);
    expect(a1[0]!.status).toBe('pass');
  });

  it('flags a mutate that goes stale but presents results as fresh', () => {
    const f = a1AnalysisCoherence(
      obs({
        role: 'mutate',
        body: { analysis_ready: { status: 'ready', freshness: 'stale' }, assistant_text: 'Budget is now 0.5. The leader still wins at 62%.' },
      }),
    );
    expect(f[0]!.status).toBe('fail');
  });
});

describe('A2 — context completeness', () => {
  const base: ContextSnapshot = {
    graph: true,
    analysis_state: true,
    blockers: true,
    capabilities: true,
    recent_turn_state: true,
    source: 'in-process',
  };

  it('passes when all five elements are present', () => {
    const f = a2ContextCompleteness(base);
    expect(f[0]!.status).toBe('pass');
    expect(f[0]!.component_primary).toBe('context_management');
  });

  it('fails when a required element is missing', () => {
    const f = a2ContextCompleteness({ ...base, blockers: false });
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toContain('blockers');
  });

  it('live stub is inconclusive (not wire-observable)', () => {
    const f = a2LiveStub();
    expect(f[0]!.status).toBe('inconclusive');
    expect(f[0]!.component_primary).toBe('context_management');
  });
});

describe('A3 — durable state changed', () => {
  it('passes when the post-mutation hash differs from the baseline', () => {
    const f = a3DurableStateChanged(
      obs({ role: 'rerun_analysis', priorRunHash: 'AAAA', body: { analysis_ready: { current_graph_hash: 'BBBB' } } }),
    );
    expect(f[0]!.status).toBe('pass');
    expect(f[0]!.component_primary).toBe('typed_action_mutation');
  });

  it('fails when the hash is unchanged after a mutation', () => {
    const f = a3DurableStateChanged(
      obs({ role: 'rerun_analysis', priorRunHash: 'AAAA', body: { analysis_ready: { current_graph_hash: 'AAAA' } } }),
    );
    expect(f[0]!.status).toBe('fail');
  });

  it('is inconclusive when the hash trio is missing', () => {
    const f = a3DurableStateChanged(obs({ role: 'rerun_analysis', priorRunHash: null, body: {} }));
    expect(f[0]!.status).toBe('inconclusive');
  });
});

describe('A4 — no false success', () => {
  it('fails when a non-mutating turn opens with a success claim', () => {
    const f = a4NoFalseSuccess(obs({ role: 'explain', body: { assistant_text: 'Updated Budget to 20%. Here is why...' } }));
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.component_primary).toBe('typed_action_mutation');
  });

  it('fails when a failed turn claims success', () => {
    const f = a4NoFalseSuccess(
      obs({ role: 'mutate', httpStatus: 500, body: { assistant_text: 'Updated the model successfully.' } }),
    );
    expect(f[0]!.status).toBe('fail');
  });

  it('passes a clean explain turn', () => {
    const f = a4NoFalseSuccess(obs({ role: 'explain', body: { assistant_text: 'Option A leads because it improves delivery.' } }));
    expect(f[0]!.status).toBe('pass');
  });
});

describe('A5 — coaching grounded', () => {
  it('fails when coaching denies analysis that is ready', () => {
    const f = a5CoachingGrounded(
      obs({ role: 'explain', body: { analysis_ready: { status: 'ready' }, assistant_text: "I haven't run the analysis." } }),
    );
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.component_primary).toBe('science_grounded_coaching');
  });

  it('fails when analysis is ready but coaching cites no real signal', () => {
    const f = a5CoachingGrounded(
      obs({
        role: 'explain',
        optionLabels: ['Hire two senior engineers'],
        body: { analysis_ready: { status: 'ready' }, assistant_text: 'It depends on a number of things to consider.' },
      }),
    );
    expect(f[0]!.status).toBe('fail');
  });

  it('passes when coaching references a real option label + probability', () => {
    const f = a5CoachingGrounded(
      obs({
        role: 'explain',
        optionLabels: ['Hire two senior engineers'],
        body: {
          analysis_ready: { status: 'ready' },
          assistant_text: 'Hire two senior engineers leads at about 62% against the goal.',
        },
      }),
    );
    expect(f[0]!.status).toBe('pass');
  });
});

describe('A6 — debug explains what happened', () => {
  it('passes when a complete diagnostic trace is present', () => {
    const f = a6DebugExplains(obs({ role: 'analysis', body: { _diagnostic_trace: COMPLETE_TRACE, _timings: { turn: {} } } }));
    expect(f[0]!.status).toBe('pass');
    expect(f[0]!.component_primary).toBe('observability_recovery');
  });

  it('fails when the trace flag is ON but the trace is absent', () => {
    const f = a6DebugExplains(obs({ role: 'analysis', diagnosticTraceExpected: true, body: { assistant_text: 'x' } }));
    expect(f[0]!.status).toBe('fail');
  });

  it('is inconclusive when the trace is absent and the flag is not confirmed', () => {
    const f = a6DebugExplains(obs({ role: 'analysis', diagnosticTraceExpected: false, body: { assistant_text: 'x' } }));
    expect(f[0]!.status).toBe('inconclusive');
    expect(f[0]!.severity).toBe('high');
  });
});

describe('A7 — repairs/recoveries visible', () => {
  it('fails on a hard 500', () => {
    const f = a7RecoveryVisible(obs({ role: 'mutate', httpStatus: 500, body: {} }));
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.component_primary).toBe('observability_recovery');
  });

  it('fails on a 200 carrying an error envelope (disguised failure)', () => {
    const f = a7RecoveryVisible(obs({ role: 'analysis', httpStatus: 200, body: { schema: 'error.v1', code: 'X' } }));
    expect(f[0]!.status).toBe('fail');
  });

  it('passes when repairs are surfaced via model_adjustments', () => {
    const f = a7RecoveryVisible(
      obs({ role: 'analysis', body: { analysis_ready: { model_adjustments: [{ code: 'data_filled', field: 'x', reason: 'y' }] } } }),
    );
    expect(f[0]!.status).toBe('pass');
    expect(f[0]!.evidence).toContain('model_adjustments');
  });

  it('passes a clean graceful 200', () => {
    const f = a7RecoveryVisible(obs({ role: 'explain', httpStatus: 200, body: { assistant_text: 'ok' } }));
    expect(f[0]!.status).toBe('pass');
  });
});

describe('evaluateJourney — aggregation + caveats', () => {
  it('emits the A2 live stub and the dispatch coverage caveats', () => {
    const observations: TurnObservation[] = [
      obs({ step: '2_run_analysis', role: 'analysis', body: { analysis_ready: { status: 'ready', freshness: 'fresh' }, _diagnostic_trace: COMPLETE_TRACE } }),
    ];
    const { findings, caveats } = evaluateJourney(observations, { diagnosticTraceExpected: true });
    expect(findings.some((f) => f.invariant_id === 'A2' && f.status === 'inconclusive')).toBe(true);
    expect(caveats.some((c) => c.title.includes('A2 asserted in-process only'))).toBe(true);
    expect(caveats.some((c) => c.title.includes('scalar value-edit path only'))).toBe(true);
  });

  it('adds a trace-flag caveat when the diagnostic flag is not confirmed', () => {
    const { caveats } = evaluateJourney([], { diagnosticTraceExpected: false });
    expect(caveats.some((c) => c.title.includes('Diagnostic-trace flag not confirmed ON'))).toBe(true);
  });
});
