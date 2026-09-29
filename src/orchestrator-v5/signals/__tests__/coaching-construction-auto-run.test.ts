/**
 * THE AGENT LANE'S AUTOMATIC FIRST ANALYSIS — a second auto-run initiator,
 * with the two questions `context/run-initiator.ts` owns answered for it.
 *
 * Paul's ruling (#63 5812069638): after a successful construction the EXISTING
 * analysis runs once on the generated revision, provisional, and later edits
 * never auto-run. That run is server-initiated, so it is stamped
 * `auto_post_construction`. Its two answers differ from the post-draft auto-run
 * on exactly one of the two questions, and that is what this file pins:
 *
 *   "was this run auto-initiated?"  → YES, same as post-draft. Confinement
 *                                     (no leader on a run nobody asked for)
 *                                     stays on, as the safe default.
 *   "has the user seen its result?" → YES, unlike post-draft. The run is
 *                                     delivered inside the user's OWN
 *                                     synchronous build response, which is
 *                                     parity with a user-initiated run.
 *
 * WHY THE SECOND ANSWER MATTERS. `AUTO_RUN_RESULT_REACHES_USER` is `false`
 * (fail-closed, for the post-draft run's async delivery). If the construction
 * run inherited it, the user's next explicit Run would take the FIRST arm and
 * lose the re-run comparison — the "Run explains the change" step of the
 * journey — on a model whose first result the user has already been shown.
 *
 * Every case binds by IDENTITY: the stamp is built by the production builder,
 * the construction turn id is DERIVED the way the construction derives it (never
 * a literal), and each claim sits beside its opposite-direction twin.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import {
  AUTO_RUN_POST_CONSTRUCTION_INITIATOR,
  AUTO_RUN_POST_DRAFT_INITIATOR,
  AUTO_RUN_RESULT_REACHES_USER,
  buildAutoRunProvenance,
  buildConstructionAutoRunProvenance,
  hasUserSeenRunAnalysisResult,
  isAutoInitiatedRunAnalysisFact,
  RUN_PROVENANCE_ENRICHMENT_KEY,
} from '../../context/run-initiator.js';
import { wasAnalysisRequestedByUser } from '../../compose/unrequested-analysis-confinement.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { constructionOperationId } from '../../agent-lane/runtime/build-model.js';
import { COACHING_TEXT, detectCoachingSignal } from '../coaching-signals.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRIEF = 'Should we build self-hosting this year or defer it to next year?';
/** K — the construction's own turn identity, derived exactly as the build derives it. */
const CONSTRUCTION_TURN_ID = registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, BRIEF));

const OPTIONS = [
  { id: 'opt-build', label: 'build self-hosting this year', win: 0.6 },
  { id: 'opt-defer', label: 'defer it to next year', win: 0.4 },
];

function runEnvelope(): Record<string, unknown> {
  return {
    analysis_status: 'completed',
    results: OPTIONS.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      win_probability: o.win,
      factor_sensitivity: [],
    })),
  };
}

/** This turn's own run — identical numbers, so the rerun arm's "unchanged" sentence is the one that fires. */
function thisTurnRunOutcome(): SuccessfulHandlerOutcome {
  const fact = {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO,
      leading_option_id: 'opt-build',
      summary: 'Ran analysis',
      enrichment: runEnvelope(),
    },
  } as unknown as HandlerFact;
  return { assistant_text: 'done', handler_facts: [fact], llm_calls_used: 0 };
}

/** A prior run fact; `provenance` is spread into `enrichment` exactly as the writer spreads it. */
function priorRunFact(provenance: object | null): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO,
      leading_option_id: 'opt-build',
      summary: 'prior',
      computed_at: '2026-09-24T10:00:00.000Z',
      graph_hash_at_run: 'hash-prior',
      enrichment: {
        ...runEnvelope(),
        ...(provenance === null ? {} : { [RUN_PROVENANCE_ENRICHMENT_KEY]: provenance }),
      },
    },
  } as unknown as HandlerFact;
}

const CONSTRUCTION_PRIOR = (): HandlerFact =>
  priorRunFact(buildConstructionAutoRunProvenance(CONSTRUCTION_TURN_ID));
const DRAFT_PRIOR = (): HandlerFact => priorRunFact(buildAutoRunProvenance('draft-turn-abc'));
const USER_PRIOR = (): HandlerFact => priorRunFact(null);

function runBranch(priorFacts: readonly HandlerFact[]) {
  return detectCoachingSignal({
    proposedHandlerId: 'run_analysis',
    mayNameLeadingOption: true,
    outcome: thisTurnRunOutcome(),
    contextPack: null,
    priorFacts,
  });
}

describe('the construction initiator — its stamp', () => {
  it('is built by the one builder: auto_post_construction, provisional, and the construction turn id', () => {
    expect(CONSTRUCTION_TURN_ID.startsWith('graph_registration:')).toBe(true);
    expect(buildConstructionAutoRunProvenance(CONSTRUCTION_TURN_ID)).toEqual({
      initiated_by: 'auto_post_construction',
      provisional: true,
      construction_turn_id: CONSTRUCTION_TURN_ID,
    });
    expect(AUTO_RUN_POST_CONSTRUCTION_INITIATOR).toBe('auto_post_construction');
    // Two initiators, never one value under two names.
    expect(AUTO_RUN_POST_CONSTRUCTION_INITIATOR).not.toBe(AUTO_RUN_POST_DRAFT_INITIATOR);
  });

  it('carries NO member CEE deep-strips before transport (graph_hash, graph_hash_at_run)', () => {
    const stamp = buildConstructionAutoRunProvenance(CONSTRUCTION_TURN_ID) as unknown as Record<string, unknown>;
    expect(Object.keys(stamp).sort()).toEqual(['construction_turn_id', 'initiated_by', 'provisional']);
  });
});

describe('PROVENANCE — a construction auto-run is auto-initiated, so confinement stays on', () => {
  it('isAutoInitiatedRunAnalysisFact recognises BOTH initiators', () => {
    expect(isAutoInitiatedRunAnalysisFact(CONSTRUCTION_PRIOR())).toBe(true);
    expect(isAutoInitiatedRunAnalysisFact(DRAFT_PRIOR())).toBe(true);
    // The discriminating negative in the same test.
    expect(isAutoInitiatedRunAnalysisFact(USER_PRIOR())).toBe(false);
  });

  it('the confinement owner reads it as NOT requested by the user', () => {
    expect(wasAnalysisRequestedByUser(CONSTRUCTION_PRIOR())).toBe(false);
    expect(wasAnalysisRequestedByUser(USER_PRIOR())).toBe(true);
  });

  it('binds by IDENTITY: a near-miss initiator is still read as user-initiated (fail-safe kept)', () => {
    const nearMiss = priorRunFact({
      initiated_by: 'auto_post_constructio',
      provisional: true,
      construction_turn_id: CONSTRUCTION_TURN_ID,
    });
    expect(isAutoInitiatedRunAnalysisFact(nearMiss)).toBe(false);
  });
});

describe('DELIVERY — a construction auto-run is SEEN; a post-draft auto-run is unchanged', () => {
  it('the construction run is seen in BOTH postures of the post-draft constant', () => {
    expect(hasUserSeenRunAnalysisResult(CONSTRUCTION_PRIOR(), false)).toBe(true);
    expect(hasUserSeenRunAnalysisResult(CONSTRUCTION_PRIOR(), true)).toBe(true);
    expect(hasUserSeenRunAnalysisResult(CONSTRUCTION_PRIOR())).toBe(true);
  });

  it('CONTRAST: the post-draft run still follows the constant, which is still fail-closed', () => {
    expect(AUTO_RUN_RESULT_REACHES_USER).toBe(false);
    expect(hasUserSeenRunAnalysisResult(DRAFT_PRIOR())).toBe(false);
    // …and the parameter still governs it, in both directions.
    expect(hasUserSeenRunAnalysisResult(DRAFT_PRIOR(), false)).toBe(false);
    expect(hasUserSeenRunAnalysisResult(DRAFT_PRIOR(), true)).toBe(true);
  });
});

describe('the NEXT explicit Run — rerun arm after a construction auto-run, first arm after a post-draft one', () => {
  it('after a construction auto-run, the user’s next Run takes the RERUN arm', () => {
    const signal = runBranch([CONSTRUCTION_PRIOR()]);
    expect(signal?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
  });

  it('CONTRAST: after a post-draft auto-run, the next Run still reads as the FIRST (not seen)', () => {
    const signal = runBranch([DRAFT_PRIOR()]);
    expect(signal?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    expect(signal?.coaching_text).toBe(COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}));
  });

  it('CONTRAST: a user-initiated prior still takes the RERUN arm (the control the construction case matches)', () => {
    expect(runBranch([USER_PRIOR()])?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
  });
});

/**
 * ⛔ A CONFINED RUN'S LEADER WAS NEVER SHOWN, SO THE NEXT RUN MAY NOT SAY IT "STILL" LEADS.
 *
 * The construction auto-run is SEEN (its figures reach the user) but it is
 * auto-initiated, so unrequested-analysis confinement WITHHELD its leader.
 * Every sentence `compareRuns` composes names an option against the prior
 * run ("X still leads", "X now leads instead of Y"), which asserts a
 * designation the user was never given. The re-run is acknowledged
 * comparison-free instead; a user-initiated prior keeps its comparison.
 * (Verifier major 1 on the marker track, 24 Sep.)
 */
describe('the NEXT explicit Run never compares against a leader confinement withheld', () => {
  it('after a construction auto-run: re-run arm, but no option named against the prior', () => {
    const signal = runBranch([CONSTRUCTION_PRIOR()]);
    expect(signal?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
    const text = signal?.coaching_text ?? '';
    expect(text).not.toMatch(/still leads/i);
    for (const o of OPTIONS) expect(text).not.toContain(o.label);
  });

  it('CONTRAST: after a user-initiated run the comparison names the leader', () => {
    const text = runBranch([USER_PRIOR()])?.coaching_text ?? '';
    expect(text).toMatch(/still leads/i);
    expect(text).toContain(OPTIONS[0]!.label);
  });
});
