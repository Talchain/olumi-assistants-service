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
  a8NonCommittingNoFalseSuccess,
  a8bSourceRejectionGrounded,
  a9ContextSurfaced,
  a10Latency,
  a11PremortemSafe,
  latencyClassFor,
  evaluateJourney,
  evaluateObservation,
  type ContextSnapshot,
} from '../../../tools/golden-journey-harness/invariants.js';
import type {
  TurnObservation,
  TurnRole,
  WireBody,
} from '../../../tools/golden-journey-harness/observation.js';
import { isAdvisoryFinding, makeFinding } from '../../../tools/golden-journey-harness/components.js';
import { nextComponentToFix } from '../../../tools/golden-journey-harness/report.js';

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

describe('A1 — stale-as-fresh is GATING + wire-grounded (Coaching Context Pack v1)', () => {
  const staleAsFreshBody: WireBody = {
    analysis_ready: { status: 'ready', freshness: 'stale' },
    assistant_text: 'Option A leads at 62%.',
  };

  it('the stale-as-fresh finding carries no `provisional` flag — it gates', () => {
    const f = a1AnalysisCoherence(obs({ role: 'explain', body: staleAsFreshBody }));
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.provisional).toBeUndefined();
    expect(isAdvisoryFinding(f[0]!)).toBe(false);
  });

  it('the OTHER A1 findings stay advisory (provisional)', () => {
    const denied = a1AnalysisCoherence(
      obs({
        role: 'explain',
        body: { analysis_ready: { status: 'ready' }, assistant_text: "The results aren't back yet." },
      }),
    );
    expect(denied[0]!.provisional).toBe(true);
    expect(isAdvisoryFinding(denied[0]!)).toBe(true);

    const pass = a1AnalysisCoherence(
      obs({
        role: 'explain',
        body: { analysis_ready: { status: 'ready', freshness: 'fresh' }, assistant_text: 'Option A leads.' },
      }),
    );
    expect(pass[0]!.provisional).toBe(true);
    expect(isAdvisoryFinding(pass[0]!)).toBe(true);
  });

  it('a stale-as-fresh turn yields a GATING fail in the whole-journey evaluation', () => {
    const { findings } = evaluateJourney([obs({ role: 'explain', body: staleAsFreshBody })], {
      diagnosticTraceExpected: true,
      mode: 'replay',
    });
    const gatingFails = findings.filter((f) => f.status === 'fail' && !isAdvisoryFinding(f));
    expect(gatingFails.some((f) => f.invariant_id === 'A1')).toBe(true);
  });

  it('is wire-grounded: the gate reads analysis_ready.freshness (the live deriveAnalysisFreshness verdict)', () => {
    // A staleness caveat on the prose flips the gate off; the SAME prose under
    // a wire `freshness: 'fresh'` is not a stale-as-fresh fail. The harness's
    // "stale" is exactly analysis_ready.freshness — no test-local heuristic.
    const withCaveat = a1AnalysisCoherence(
      obs({
        role: 'explain',
        body: {
          analysis_ready: { status: 'ready', freshness: 'stale' },
          assistant_text: 'These results may be out of date — re-run analysis. Option A led at 62%.',
        },
      }),
    );
    expect(withCaveat[0]!.status).toBe('pass');

    const freshWire = a1AnalysisCoherence(
      obs({
        role: 'explain',
        body: { analysis_ready: { status: 'ready', freshness: 'fresh' }, assistant_text: 'Option A leads at 62%.' },
      }),
    );
    expect(freshWire[0]!.status).toBe('pass');
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
    const { findings, caveats } = evaluateJourney(observations, { diagnosticTraceExpected: true, mode: 'replay' });
    expect(findings.some((f) => f.invariant_id === 'A2' && f.status === 'inconclusive')).toBe(true);
    expect(caveats.some((c) => c.title.includes('A2 asserted in-process only'))).toBe(true);
    expect(caveats.some((c) => c.title.includes('scalar value-edit path only'))).toBe(true);
  });

  it('adds a trace-flag caveat when the diagnostic flag is not confirmed', () => {
    const { caveats } = evaluateJourney([], { diagnosticTraceExpected: false, mode: 'replay' });
    expect(caveats.some((c) => c.title.includes('Diagnostic-trace flag not confirmed ON'))).toBe(true);
  });

  it('always emits the "live A5 advisory" caveat', () => {
    const { caveats } = evaluateJourney([], { diagnosticTraceExpected: true, mode: 'replay' });
    expect(caveats.some((c) => c.title.includes('Live A5 is advisory'))).toBe(true);
  });
});

describe('advisory gating (A5 / provisional A1 do not hard-gate)', () => {
  it('classifies A5 fail and provisional A1 as advisory, A3 fail as gating', () => {
    expect(isAdvisoryFinding(makeFinding('A5', 'fail', 'medium', 'x'))).toBe(true);
    expect(isAdvisoryFinding(makeFinding('A1', 'fail', 'high', 'x', { provisional: true }))).toBe(true);
    expect(isAdvisoryFinding(makeFinding('A3', 'fail', 'high', 'x'))).toBe(false);
  });

  it('nextComponentToFix prefers a gating fail over an advisory fail', () => {
    const next = nextComponentToFix([
      makeFinding('A5', 'fail', 'medium', 'ungrounded'),
      makeFinding('A3', 'fail', 'high', 'hash unchanged'),
    ]);
    expect(next?.invariant).toBe('A3');
    expect(next?.advisory).toBe(false);
  });

  it('nextComponentToFix surfaces an advisory fail (labelled) above an inconclusive', () => {
    const next = nextComponentToFix([
      makeFinding('A2', 'inconclusive', 'medium', 'in-process'),
      makeFinding('A5', 'fail', 'medium', 'ungrounded'),
    ]);
    expect(next?.invariant).toBe('A5');
    expect(next?.advisory).toBe(true);
  });
});

// ===========================================================================
// Blind-spot-closure invariants for the four lived post-analysis defects.
// ===========================================================================

describe('A8 — non-committing intent never claims a mutation it did not make', () => {
  it('fails (gating) on phantom success: mutation ack with an unchanged graph hash', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        priorGraphHash: 'aaaa1111',
        body: {
          assistant_text: 'Updated the Budget factor so it carries more weight now.',
          analysis_ready: { status: 'ready', current_graph_hash: 'aaaa1111' },
        },
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
    expect(isAdvisoryFinding(f[0]!)).toBe(false); // A8 is a safety/honesty gate
  });

  it('passes when a non-committing request clarifies without claiming a change', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        priorGraphHash: 'aaaa1111',
        body: {
          assistant_text: 'Did you mean increase its weight, or change its value? Which would you like?',
          analysis_ready: { status: 'ready', current_graph_hash: 'aaaa1111' },
        },
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('pass');
  });

  it('is inconclusive (acceptance requirement) when a success claim has no observable hash', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        priorGraphHash: null,
        body: { assistant_text: 'Updated the Budget factor.' },
      }),
    );
    expect(f[0]!.status).toBe('inconclusive');
  });

  it('is role-agnostic: fires on a non-intent turn (e.g. explain/direct-answer) that opens with a success claim', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'explain',
        priorGraphHash: 'aaaa1111',
        body: {
          assistant_text: 'Added a new factor to the model.',
          analysis_ready: { status: 'ready', current_graph_hash: 'aaaa1111' },
        },
      }),
    );
    expect(f[0]!.status).toBe('fail'); // previously missed — only ran on mutate_intent
  });

  it('hash is authoritative: a non-mutating handler does NOT make a claim durable', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        priorGraphHash: 'aaaa1111',
        body: {
          assistant_text: 'Updated the Budget factor.',
          analysis_ready: { status: 'ready', current_graph_hash: 'aaaa1111' },
          _diagnostic_trace: { coaching_delivery: { handler: 'explain_result' } },
        },
      }),
    );
    expect(f[0]!.status).toBe('fail');
  });

  it('passes honest proposal text (the real a9da06f2 shape): no opening claim, proposal-only', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        priorGraphHash: 'acfa3515',
        body: {
          assistant_text:
            'The change was rejected by the structural rules. You could introduce a factor or loosen a link. Which would you like to try?',
          analysis_ready: { status: 'ready', current_graph_hash: 'acfa3515' },
          pending_actions: [{ action: { kind: 'proposed_concept' } }],
        },
      }),
    );
    expect(f[0]!.status).toBe('pass'); // honest acknowledgement + proposal is NOT a false success
  });

  it('returns no finding for a non-intent turn that makes no mutation claim', () => {
    expect(
      a8NonCommittingNoFalseSuccess(obs({ role: 'explain', body: { assistant_text: 'Option A leads at 60%.' } })),
    ).toHaveLength(0);
  });
});

describe('A9 — AI-facing context observable on the wire', () => {
  it('is inconclusive (acceptance requirement) when no turn surfaces a context summary', () => {
    const f = a9ContextSurfaced([obs({ role: 'explain', body: { assistant_text: 'x' } })]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('inconclusive');
    expect(f[0]!.evidence).toContain('ACCEPTANCE REQUIREMENT');
  });

  it('passes when a wire context summary carries all five required elements', () => {
    const f = a9ContextSurfaced([
      obs({
        role: 'reload',
        body: {
          assistant_text: 'x',
          _context_summary: {
            graph: { nodes: 3 },
            analysis_state: 'ready',
            blockers: ['none'],
            capabilities: ['edit'],
            recent_turn_state: { last: 'reload' },
          },
        },
      }),
    ]);
    expect(f[0]!.status).toBe('pass');
  });

  it('fails when a present context summary is missing required elements', () => {
    const f = a9ContextSurfaced([
      obs({ role: 'reload', body: { assistant_text: 'x', _context_summary: { graph: { nodes: 3 } } } }),
    ]);
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toContain('analysis_state');
  });
});

describe('A10 — simple deterministic turns within an advisory latency budget', () => {
  it('classifies an llm_calls=0 turn as deterministic with the tight budget', () => {
    const cls = latencyClassFor(obs({ role: 'mutate_intent', body: { _timings: { turn: { llm_calls_used: 0 } } } }));
    expect(cls.cls).toBe('deterministic');
    expect(cls.budgetMs).toBe(1500);
  });

  it('flags (advisory) a deterministic turn over budget; never gating', () => {
    const f = a10Latency(
      obs({ role: 'mutate_intent', body: { _timings: { turn: { total_ms: 2300, llm_calls_used: 0 } } } }),
    );
    expect(f[0]!.status).toBe('fail');
    expect(isAdvisoryFinding(f[0]!)).toBe(true);
  });

  it('passes a fast deterministic turn', () => {
    const f = a10Latency(
      obs({ role: 'mutate', body: { _timings: { turn: { total_ms: 930, llm_calls_used: 0 } } } }),
    );
    expect(f[0]!.status).toBe('pass');
  });

  it('is inconclusive when no latency is observable', () => {
    const f = a10Latency(obs({ role: 'explain', body: { assistant_text: 'x' } }));
    expect(f[0]!.status).toBe('inconclusive');
  });

  it('does not flag a slow draft (generous draft budget)', () => {
    const f = a10Latency(obs({ role: 'draft', body: { _timings: { turn: { total_ms: 52000 } } } }));
    expect(f[0]!.status).toBe('pass');
  });

  it('flags wrongful LLM escalation on a deterministic-eligible turn even within the time budget (real a9da06f2 shape)', () => {
    // 11347ms < 12000ms llm budget, but role is deterministic-eligible with 1 LLM call.
    const f = a10Latency(
      obs({ role: 'mutate_intent', body: { _timings: { turn: { total_ms: 11347, llm_calls_used: 1 } } } }),
    );
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toContain('wrongful LLM escalation');
    expect(isAdvisoryFinding(f[0]!)).toBe(true);
  });

  it('does not flag a legitimate LLM turn (explain) for escalation', () => {
    const f = a10Latency(
      obs({ role: 'explain', body: { _timings: { turn: { total_ms: 11347, llm_calls_used: 1 } } } }),
    );
    expect(f[0]!.status).toBe('pass');
  });
});

describe('A11 — premortem / challenge handled safely (advisory)', () => {
  it('passes a safe premortem with framing + a next step', () => {
    const f = a11PremortemSafe(
      obs({
        role: 'premortem',
        body: {
          assistant_text:
            'A premortem: the main risks are budget pressure and ramp time. To de-risk, you could test the Budget assumption.',
        },
      }),
    );
    expect(f[0]!.status).toBe('pass');
  });

  it('fails (advisory) when a discuss-only premortem overclaims with a success verb', () => {
    const f = a11PremortemSafe(
      obs({ role: 'premortem', body: { assistant_text: 'Updated the model to be more robust. The leader is guaranteed.' } }),
    );
    expect(f[0]!.status).toBe('fail');
    expect(isAdvisoryFinding(f[0]!)).toBe(true);
  });

  it('fails when no clear next step is offered', () => {
    const f = a11PremortemSafe(
      obs({ role: 'premortem', body: { assistant_text: 'The leading option could be wrong in several ways.' } }),
    );
    expect(f[0]!.status).toBe('fail');
  });

  it('does not run on non-premortem roles', () => {
    expect(a11PremortemSafe(obs({ role: 'explain' }))).toHaveLength(0);
  });
});

describe('evaluateJourney — A9 + blind-spot caveats', () => {
  it('emits A9 inconclusive and the new acceptance-requirement caveats', () => {
    const { findings, caveats } = evaluateJourney(
      [obs({ role: 'analysis', body: { analysis_ready: { status: 'ready', current_graph_hash: 'h' }, _diagnostic_trace: COMPLETE_TRACE } })],
      { diagnosticTraceExpected: true, mode: 'replay' },
    );
    expect(findings.some((f) => f.invariant_id === 'A9' && f.status === 'inconclusive')).toBe(true);
    expect(caveats.some((c) => c.title.includes('A9 — context observability'))).toBe(true);
    expect(caveats.some((c) => c.title.includes('A10 — latency'))).toBe(true);
    expect(caveats.some((c) => c.title.includes('A8 — non-committing'))).toBe(true);
  });
});

describe('A8b — source-rejection grounding (Capability 2A acceptance target, advisory)', () => {
  const GENERIC =
    "I wasn't able to apply that change — it would create an inconsistency in the model structure. You could try describing the change differently, or I can rebuild the model from an updated brief.";
  const ENRICHED =
    "I wasn't able to add that as described, because the new risk isn't connected into the model yet, so it has no path through to your goal and can't affect the result. To add it, connect it through to your goal — for example by linking it to a factor that already feeds into your goal. Which factor should it relate to, or which outcome does it threaten?";
  const INVENTED =
    "I wasn't able to apply that change: adding a new risk connected directly to an option rather than flowing through an existing factor created an inconsistency the system couldn't resolve cleanly.";
  const HELD_SCIENCE =
    "I wasn't able to add that risk. Connect it through to your goal — it would shift the most vulnerable assumptions and the sensitivity of the result.";

  it('CURRENT (generic suppression) → advisory fail (no structural next step), reports the gap', () => {
    const f = a8bSourceRejectionGrounded(obs({ role: 'mutate_intent', body: { assistant_text: GENERIC } }));
    expect(f).toHaveLength(1);
    expect(f[0]!.invariant_id).toBe('A8b');
    expect(f[0]!.status).toBe('fail');
    expect(isAdvisoryFinding(f[0]!)).toBe(true); // advisory — never gates
  });

  it('ACCEPTED (enriched structural next step) → pass', () => {
    const f = a8bSourceRejectionGrounded(obs({ role: 'mutate_intent', body: { assistant_text: ENRICHED } }));
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('pass');
  });

  it('invented failure mechanism → advisory fail', () => {
    const f = a8bSourceRejectionGrounded(obs({ role: 'mutate_intent', body: { assistant_text: INVENTED } }));
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toMatch(/invented failure mechanism/i);
    expect(isAdvisoryFinding(f[0]!)).toBe(true);
  });

  it('held-science prose → advisory fail', () => {
    const f = a8bSourceRejectionGrounded(obs({ role: 'mutate_intent', body: { assistant_text: HELD_SCIENCE } }));
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toMatch(/held-science/i);
  });

  it('does NOT fire on a non-rejection edit turn (self-gated)', () => {
    expect(a8bSourceRejectionGrounded(obs({ role: 'mutate', body: { assistant_text: 'Set Budget to 0.5. Re-run analysis to see the effect.' } }))).toHaveLength(0);
  });

  it('does NOT fire on a non-edit role (e.g. explain)', () => {
    expect(a8bSourceRejectionGrounded(obs({ role: 'explain', body: { assistant_text: GENERIC } }))).toHaveLength(0);
  });

  it('is never gating: every A8b finding is advisory', () => {
    for (const body of [{ assistant_text: GENERIC }, { assistant_text: INVENTED }, { assistant_text: HELD_SCIENCE }]) {
      for (const f of a8bSourceRejectionGrounded(obs({ role: 'mutate_intent', body }))) {
        expect(isAdvisoryFinding(f)).toBe(true);
      }
    }
  });
});
