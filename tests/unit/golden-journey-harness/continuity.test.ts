/**
 * Golden-Journey Harness — A12 prior-turn continuity + capture flow tests.
 *
 * A12 closes the single most user-felt blind spot: before it existed, a
 * transcript whose follow-up flatly denied the previous conversation exited 0
 * (fixtures/golden-journey-v1-context-drop.json, pre-A12 replay transcript in
 * the PR evidence) — A1-A11 could not catch a dropped conversation. These are
 * PURE multi-turn classifier tests (no network, no product boot), closing the
 * previous single-observation-only gap in this suite.
 *
 * Also pinned here:
 *   - roleForStep no longer guesses `follow_up` for unknown steps (which
 *     mis-applied role-specific semantics), and maps the Cap-2A fixture step
 *     to `mutate_intent` so A8b fires on the fixture authored for it;
 *   - A8 no longer reads an explicit edit REJECTION as a phantom-success
 *     claim (real false positive: `\bUpdated\b` matched the adjective in
 *     "…rebuild the model from an updated brief");
 *   - the `--capture` builder emits the exact replay-fixture shape, and the
 *     writer redacts secrets.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  a8NonCommittingNoFalseSuccess,
  a12PriorTurnContinuity,
  evaluateJourney,
  evaluateObservation,
} from '../../../tools/golden-journey-harness/invariants.js';
import { roleForStep } from '../../../tools/golden-journey-harness/journey.js';
import {
  buildCaptureFixture,
  writeCaptureFixture,
} from '../../../tools/golden-journey-harness/capture.js';
import { isAdvisoryFinding } from '../../../tools/golden-journey-harness/components.js';
import { createRedactor } from '../../../tools/v5-journey-replay/redact.js';
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
    ...(partial.elapsedMs !== undefined ? { elapsedMs: partial.elapsedMs } : {}),
    diagnosticTraceExpected: partial.diagnosticTraceExpected ?? true,
    priorRunHash: partial.priorRunHash ?? null,
    priorGraphHash: partial.priorGraphHash ?? null,
    optionLabels: partial.optionLabels ?? [],
    factorLabels: partial.factorLabels ?? [],
  };
}

/** Draft + analysis turns that establish the anchors a follow-up must honour. */
function priorTurns(labels: { options?: string[]; factors?: string[] } = {}): TurnObservation[] {
  const optionLabels = labels.options ?? ['Hire two senior engineers', 'Engage an offshore partner'];
  const factorLabels = labels.factors ?? ['Budget'];
  return [
    obs({ step: '1_draft', role: 'draft', optionLabels, factorLabels, body: { assistant_text: 'Model ready.' } }),
    obs({
      step: '2_run_analysis',
      role: 'analysis',
      optionLabels,
      factorLabels,
      body: {
        assistant_text: 'Analysis complete.',
        analysis_ready: {
          status: 'ready',
          freshness: 'fresh',
          option_comparison: [
            { option_id: 'opt_a', option_label: 'Hire two senior engineers', win_probability: 0.62 },
            { option_id: 'opt_b', option_label: 'Engage an offshore partner', win_probability: 0.26 },
          ],
        },
      },
    }),
  ];
}

function followUp(text: string, over: Partial<TurnObservation> = {}): TurnObservation {
  return obs({
    step: '4_follow_up',
    role: 'follow_up',
    optionLabels: ['Hire two senior engineers', 'Engage an offshore partner'],
    factorLabels: ['Budget'],
    body: { assistant_text: text },
    ...over,
  });
}

const a12 = (observations: TurnObservation[], provisional = false) =>
  a12PriorTurnContinuity(observations, { provisional });

describe('A12 — prior-turn context continuity (multi-turn)', () => {
  it('passes a follow-up grounded in an option label the conversation established', () => {
    const f = a12([...priorTurns(), followUp('Engage an offshore partner trails the leader mainly on delivery speed.')]);
    expect(f).toHaveLength(1);
    expect(f[0]!.invariant_id).toBe('A12');
    expect(f[0]!.status).toBe('pass');
    expect(isAdvisoryFinding(f[0]!)).toBe(false); // gates in replay
  });

  it('fails on an explicit continuity denial, even when an anchor is also named', () => {
    const f = a12([
      ...priorTurns(),
      followUp("I don't have the earlier results about Budget, so I can't compare the options for you."),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.severity).toBe('high');
    expect(f[0]!.evidence).toContain('denies the prior conversation');
    expect(isAdvisoryFinding(f[0]!)).toBe(false);
  });

  it('fails a follow-up that references none of the established anchors', () => {
    const f = a12([
      ...priorTurns(),
      followUp('In general, comparing two approaches means weighing their trade-offs against your objective.'),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toContain('references NONE');
  });

  it('is inconclusive (never a silent pass) when no prior-turn anchors are computable', () => {
    // No draft, no prior analysis with option labels precede the follow-up.
    const f = a12([followUp('Here is a comparison of your options.', { optionLabels: [], factorLabels: [] })]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('inconclusive');
    expect(f[0]!.evidence).toContain('ACCEPTANCE REQUIREMENT');
  });

  it('draft labels only count when a draft turn actually precedes the follow-up', () => {
    // Labels are threaded onto the observation, but no draft turn precedes it
    // and no prior analysis names options → anchors are not prior-turn facts.
    const f = a12([followUp('Hire two senior engineers still leads.')]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('inconclusive');
  });

  it('anchors come from a prior analysis option_comparison even without a draft', () => {
    const analysisOnly = obs({
      step: '2_run_analysis',
      role: 'analysis',
      optionLabels: [],
      factorLabels: [],
      body: {
        assistant_text: 'Analysis complete.',
        analysis_ready: {
          status: 'ready',
          freshness: 'fresh',
          option_comparison: [{ option_id: 'opt_a', option_label: 'Tiered pricing', win_probability: 0.7 }],
        },
      },
    });
    const f = a12([
      analysisOnly,
      followUp('Tiered pricing remains ahead of the alternatives.', { optionLabels: [], factorLabels: [] }),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('pass');
  });

  it('covers explain_changed turns and only strictly-prior turns provide anchors', () => {
    const explainChanged = obs({
      step: '7_explain_what_changed',
      role: 'explain_changed',
      optionLabels: ['Hire two senior engineers'],
      factorLabels: ['Budget'],
      body: { assistant_text: 'After making Budget more important, the leader is unchanged.' },
    });
    const f = a12([...priorTurns(), explainChanged]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('pass');
  });

  it('live mode marks findings provisional → advisory (replay stays the gate)', () => {
    const f = a12(
      [...priorTurns(), followUp('In general, weigh the trade-offs against your objective.')],
      true,
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.provisional).toBe(true);
    expect(isAdvisoryFinding(f[0]!)).toBe(true);
  });

  it('skips non-200 and empty-prose turns (owned by A6/A7/A5)', () => {
    expect(a12([...priorTurns(), followUp('anything', { httpStatus: 500 })])).toHaveLength(0);
    expect(a12([...priorTurns(), followUp('')])).toHaveLength(0);
  });

  it('is wired into evaluateJourney (replay gates, live is provisional)', () => {
    const journey = [...priorTurns(), followUp('Generic advice with no anchors at all.')];
    const replay = evaluateJourney(journey, { diagnosticTraceExpected: false, mode: 'replay' });
    const replayA12 = replay.findings.filter((f) => f.invariant_id === 'A12');
    expect(replayA12).toHaveLength(1);
    expect(replayA12[0]!.status).toBe('fail');
    expect(isAdvisoryFinding(replayA12[0]!)).toBe(false);
    expect(replay.caveats.some((c) => c.title.includes('A12'))).toBe(true);

    const live = evaluateJourney(journey, { diagnosticTraceExpected: false, mode: 'live' });
    const liveA12 = live.findings.filter((f) => f.invariant_id === 'A12');
    expect(liveA12).toHaveLength(1);
    expect(isAdvisoryFinding(liveA12[0]!)).toBe(true);
  });
});

describe('roleForStep — no guessed roles (regression for the follow_up fallback)', () => {
  it('maps known golden steps to their roles', () => {
    expect(roleForStep('4_follow_up')).toBe('follow_up');
    expect(roleForStep('7_explain_what_changed')).toBe('explain_changed');
    expect(roleForStep('9_mutate_intent')).toBe('mutate_intent');
  });

  it('maps the Cap-2A fixture step to mutate_intent (so A8b fires on its own fixture)', () => {
    expect(roleForStep('9_add_risk_rejection')).toBe('mutate_intent');
  });

  it('unknown steps get the neutral unknown role, never follow_up', () => {
    expect(roleForStep('99_something_new')).toBe('unknown');
  });
});

describe('A8 — explicit edit rejection is not a phantom-success claim (regression)', () => {
  const GENERIC_REJECTION =
    "I wasn't able to apply that change — it would create an inconsistency in the model structure. " +
    'You could try describing the change differently, or I can rebuild the model from an updated brief.';

  it('generic rejection copy on a mutate_intent turn does NOT fail A8 (the "updated brief" false positive)', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        body: { assistant_text: GENERIC_REJECTION, analysis_ready: { current_graph_hash: 'h1' } },
        priorGraphHash: 'h1',
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('pass');
  });

  it('a genuine ack with an unmoved hash on a mutate_intent turn still fails A8', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        body: {
          assistant_text: 'The Budget factor has been updated as you asked.',
          analysis_ready: { current_graph_hash: 'h1' },
        },
        priorGraphHash: 'h1',
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toContain('Phantom success');
  });
});

describe('--capture builder + writer', () => {
  const observations: TurnObservation[] = [
    obs({ step: '1_draft', role: 'draft', body: { assistant_text: 'Model ready.' } }),
    obs({
      step: '2_run_analysis',
      role: 'analysis',
      httpStatus: 200,
      elapsedMs: 1234.6,
      body: { assistant_text: 'Analysis complete with key sk-SECRET-123 embedded.', _timings: { turn: {} } },
    }),
  ];

  it('builds the replay-fixture shape with role + elapsed round-trip and derived timing flag', () => {
    const fixture = buildCaptureFixture({
      name: 'golden-journey-live-capture',
      brief: 'brief text',
      baseUrl: 'https://cee-staging.example',
      capturedAt: '2026-07-02T00:00:00.000Z',
      diagnosticTraceEnabled: true,
      observations,
    });
    expect(fixture.transcript!.observations).toHaveLength(2);
    // Role travels with the capture (replay never guesses from step names),
    // and the client-elapsed wall clock survives so A10 latency evidence does
    // not degrade to unobservable on replay (review fixes).
    expect(fixture.transcript!.observations![0]).toEqual({
      step: '1_draft',
      role: 'draft',
      http_status: 200,
      body: { assistant_text: 'Model ready.' },
    });
    expect(fixture.transcript!.observations![1]).toMatchObject({
      step: '2_run_analysis',
      role: 'analysis',
      elapsed_ms: 1235,
    });
    expect(fixture.transcript!.diagnostic_trace_enabled).toBe(true);
    // timing_debug_enabled is DERIVED from the observations (single source),
    // not trusted from a caller.
    expect(fixture.transcript!.timing_debug_enabled).toBe(true);
    expect(fixture.description).toContain('LIVE CAPTURE');
    expect(fixture.description).toContain('AT CAPTURE TIME');
  });

  it('writer creates the directory and passes the fixture through the redactor (secret never reaches disk)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gj-capture-'));
    // Nested, not-yet-existing directory: the writer must create it rather
    // than crash after an authorised live run (review fix).
    const out = join(dir, 'nested', 'fixtures', 'capture.json');
    try {
      const fixture = buildCaptureFixture({
        name: 'x',
        brief: 'b',
        baseUrl: 'https://cee-staging.example',
        capturedAt: 'now',
        diagnosticTraceEnabled: false,
        observations,
      });
      writeCaptureFixture(out, fixture, createRedactor('sk-SECRET-123'));
      const written = readFileSync(out, 'utf-8');
      expect(written).not.toContain('sk-SECRET-123');
      expect(written).toContain('[REDACTED]');
      const parsed = JSON.parse(written) as { transcript: { observations: unknown[] } };
      expect(parsed.transcript.observations).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('review-fix regressions — A12 precision', () => {
  it('curly-apostrophe denial (U+2019) is caught even when an anchor is named', () => {
    const f = a12([
      ...priorTurns(),
      followUp('I don’t have the earlier results about Budget, so I can’t compare the options.'),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toContain('denies the prior conversation');
  });

  it("morphological variants do not ground an answer ('budgeting' is not the 'Budget' anchor)", () => {
    const f = a12([
      ...priorTurns(),
      followUp('In general, careful budgeting and weighing trade-offs against your objective is the right approach.'),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toContain('references NONE');
  });

  it('innocent forward-looking coaching prose is not a denial', () => {
    const f = a12([
      ...priorTurns(),
      followUp('If you share updated numbers for Budget, I can run the comparison again.'),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('pass'); // names the Budget anchor; no denial
  });

  it("a re-request shape ('share the details again') still counts as a denial", () => {
    const f = a12([...priorTurns(), followUp('If you share the details again, I can take a look at Budget.')]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
  });

  it('explain and reload turns are judged too (a denial one step earlier no longer escapes)', () => {
    const explainDenial = obs({
      step: '3_explain_leader',
      role: 'explain',
      optionLabels: ['Hire two senior engineers'],
      factorLabels: ['Budget'],
      body: {
        assistant_text:
          "I don't have our earlier conversation, but the attached analysis shows a clear leader either way.",
        analysis_ready: { status: 'ready', freshness: 'fresh' },
      },
    });
    const f = a12([...priorTurns(), explainDenial]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');

    const reloadGrounded = obs({
      step: '8_reload',
      role: 'reload',
      optionLabels: ['Hire two senior engineers'],
      factorLabels: ['Budget'],
      body: { assistant_text: 'Hire two senior engineers still leads in the current analysis.' },
    });
    const g = a12([...priorTurns(), reloadGrounded]);
    expect(g).toHaveLength(1);
    expect(g[0]!.status).toBe('pass');
  });

  it('anchors also come from analysis_ready.options[].label (the shape real wire bodies use)', () => {
    const analysisOnly = obs({
      step: '2_run_analysis',
      role: 'analysis',
      optionLabels: [],
      factorLabels: [],
      body: {
        assistant_text: 'Analysis complete.',
        analysis_ready: {
          status: 'ready',
          freshness: 'fresh',
          options: [{ id: 'opt_a', label: 'Tiered pricing' }],
        },
      },
    });
    const f = a12([
      analysisOnly,
      followUp('Tiered pricing remains ahead of the alternatives.', { optionLabels: [], factorLabels: [] }),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('pass');
  });
});

describe('review-fix regressions — unknown-step safety floor', () => {
  it('gating A1 stale-as-fresh still runs on unknown-step turns', () => {
    const staleAsFresh = obs({
      step: '13_recap',
      role: 'unknown',
      body: {
        assistant_text: 'Here is where things stand: the leading option is comfortably ahead.',
        analysis_ready: { status: 'ready', freshness: 'stale' },
      },
    });
    const findings = evaluateObservation(staleAsFresh);
    const a1 = findings.filter((f) => f.invariant_id === 'A1');
    expect(a1).toHaveLength(1);
    expect(a1[0]!.status).toBe('fail');
    expect(isAdvisoryFinding(a1[0]!)).toBe(false); // stale-as-fresh gates
  });

  it('gating A4 opening-false-success still runs on unknown-step turns', () => {
    const phantom = obs({
      step: '42_extra_probe',
      role: 'unknown',
      body: { assistant_text: 'Updated the Budget factor weighting as requested.' },
    });
    const findings = evaluateObservation(phantom);
    const a4 = findings.filter((f) => f.invariant_id === 'A4');
    expect(a4).toHaveLength(1);
    expect(a4[0]!.status).toBe('fail');
  });

  it('evaluateJourney emits a LOUD caveat naming every unknown step', () => {
    const journey = [
      ...priorTurns(),
      obs({ step: '4_followup_typo', role: 'unknown', body: { assistant_text: 'Some answer.' } }),
    ];
    const { caveats } = evaluateJourney(journey, { diagnosticTraceExpected: false, mode: 'replay' });
    const caveat = caveats.find((c) => c.title.includes('Unknown step name'));
    expect(caveat).toBeDefined();
    expect(caveat!.detail).toContain('4_followup_typo');
  });
});

describe('review-fix regressions — A8 sentence-scoped rejection carve-out', () => {
  it('a mixed reject-plus-ack turn is STILL a phantom success (the turn-wide carve-out let it through)', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        body: {
          assistant_text:
            "I wasn't able to apply the second change you described. The Budget factor has been updated as you asked.",
          analysis_ready: { current_graph_hash: 'h1' },
        },
        priorGraphHash: 'h1',
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toContain('Phantom success');
  });

  it('a SAME-SENTENCE mixed reject-plus-ack is STILL a phantom success (review blocker: the per-sentence carve-out let it through)', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        body: {
          // Rejection clause and ack clause in ONE sentence (comma, not period).
          assistant_text: "I wasn't able to apply that change, but the Budget factor has been updated for you.",
          analysis_ready: { current_graph_hash: 'h1' },
        },
        priorGraphHash: 'h1',
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
    expect(f[0]!.evidence).toContain('Phantom success');
  });

  it('pure rejection copy (generic + Cap-2A placeholder shapes) is NOT a phantom success', () => {
    const generic = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        body: {
          assistant_text:
            "I wasn't able to apply that change — it would create an inconsistency in the model structure. " +
            'You could try describing the change differently, or I can rebuild the model from an updated brief.',
          analysis_ready: { current_graph_hash: 'h1' },
        },
        priorGraphHash: 'h1',
      }),
    );
    expect(generic).toHaveLength(1);
    expect(generic[0]!.status).toBe('pass'); // "an updated brief" is an adjective, not an ack
  });

  it('a first-person claim with a curly apostrophe is still an ack', () => {
    const f = a8NonCommittingNoFalseSuccess(
      obs({
        role: 'mutate_intent',
        body: {
          assistant_text: 'I’ve updated the Budget factor for you.',
          analysis_ready: { current_graph_hash: 'h1' },
        },
        priorGraphHash: 'h1',
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.status).toBe('fail');
  });
});
