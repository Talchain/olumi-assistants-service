/**
 * ⭐ THE AGENT LANE'S AUTOMATIC FIRST ANALYSIS — the runner, in isolation (PR-B).
 *
 * Paul's ruling (5812069638): the first analysis runs ITSELF, ONCE, on the model the Agent just
 * built, and only when `resolveRunAdmission(graph).willProceed`. This file pins the runner's four
 * gates in order — admission, deadline, the (construction turn K, revision H) prior-fact check,
 * then exactly one dispatch of the EXISTING run orchestration — plus the pure helpers the route
 * uses to bind coaching blocks and to read the typed leader permission.
 *
 * Every identity is DERIVED, never typed: K comes from the production `registrationTurnId` ∘
 * `constructionOperationId`, and the provenance a prior fact carries comes from the trigger the
 * runner itself hands the dispatcher.
 */
import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  runFirstAnalysisAfterConstruction,
  firstAnalysisAutoRunTrigger,
  recordsFirstAnalysisOf,
  bindRunBlocksToReadback,
  claimPermissionsFrom,
  firstAnalysisDeadline,
  firstAnalysisSentence,
  FIRST_ANALYSIS_RESERVE_MS,
} from '../first-analysis.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { constructionOperationId } from '../runtime/build-model.js';
import { AGENT_RUN_ANALYSIS_CHIP_ID } from '../../handlers/agent-chip-ids.js';
import { RUN_PROVENANCE_ENRICHMENT_KEY, buildAutoRunProvenance, buildConstructionAutoRunProvenance } from '../../context/run-initiator.js';
import { TURN_RESPONSE_HEADROOM_MS } from '../../../config/timeouts.js';
import { READY_GRAPH, BLOCKED_GRAPH } from './fixtures/first-analysis-graphs.js';

const SCENARIO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const BRIEF = 'Should we hire a tech lead or two developers to lift delivery reliability?';
const K = registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, BRIEF));
const H = 'revision-hash-after-construction';

type DispatchArgs = Parameters<NonNullable<Parameters<typeof runFirstAnalysisAfterConstruction>[0]['dispatchRunAnalysis']>>[0];

/** A stub of the ONE run orchestration: counts calls (each is a PLoT call) and records what it was asked. */
function stubDispatch(outcome: 'ok' | 'handler_recovered' | 'handler_failure' | 'throw' = 'ok') {
  const calls: DispatchArgs[] = [];
  const fn = async (args: DispatchArgs) => {
    calls.push(args);
    if (outcome === 'throw') throw new Error('plot unreachable');
    if (outcome === 'handler_recovered') {
      return { outcome: 'handler_recovered', response: { assistant_text: 'Option B sets nothing yet.', blocks: [] }, commitPerformed: true, causeKind: 'options_not_configured', analysisReady: {}, freshness: undefined, graph: null } as never;
    }
    if (outcome === 'handler_failure') {
      return { outcome: 'handler_failure', response: { assistant_text: '', blocks: [] }, commitPerformed: false, causeKind: 'plot_unavailable', retryable: true, graph: null } as never;
    }
    return {
      outcome: 'ok',
      response: { assistant_text: 'Ran.', blocks: [{ type: 'analysis_result', summary: 's' }, { type: 'review_card', graph_hash_at_generation: H }] },
      commitPerformed: true, analysisReady: { status: 'ready' }, graph: null, mayNameLeadingOption: false,
    } as never;
  };
  return { calls, fn };
}
const noPriorFacts = async () => ({ status: 'ok' as const, facts: [] as HandlerFact[] });
const later = () => Date.now() + 60_000;

const base = (over: Partial<Parameters<typeof runFirstAnalysisAfterConstruction>[0]> = {}) => ({
  scenarioId: SCENARIO,
  constructionTurnId: K,
  revisionGraph: READY_GRAPH as unknown,
  revisionHash: H,
  requestId: 'req-1',
  deadlineAt: later(),
  readPriorFacts: noPriorFacts,
  ...over,
});

describe('the first analysis runs the EXISTING orchestration once, on the admitted revision', () => {
  it('fixture control: the admission really admits READY and really refuses BLOCKED', () => {
    expect(resolveRunAdmission(READY_GRAPH).willProceed).toBe(true);
    expect(resolveRunAdmission(BLOCKED_GRAPH).willProceed).toBe(false);
  });

  it('RED: an admissible revision → exactly ONE dispatch, as the Agent chip, carrying the construction trigger', async () => {
    const d = stubDispatch();
    const out = await runFirstAnalysisAfterConstruction(base({ dispatchRunAnalysis: d.fn }));
    expect(out.ran).toBe(true);
    expect(d.calls).toHaveLength(1);
    const call = d.calls[0]!;
    // decision_review (Anthropic) is skipped by THIS id and only this id.
    expect(call.payload.chip?.id).toBe(AGENT_RUN_ANALYSIS_CHIP_ID);
    expect(call.payload.chip?.action_type).toBe('run_analysis');
    expect(call.payload.scenario_id).toBe(SCENARIO);
    // Provenance: the ONE trigger function, bound by identity to K.
    expect(call.autoRun).toEqual(firstAnalysisAutoRunTrigger(K));
    // A new turn in the record, never the construction's id.
    expect(call.payload.turn_id).not.toBe(K);
  });

  it('RED: NOT admissible → 0 dispatches, reason not_admissible, and the admission’s own next step', async () => {
    const d = stubDispatch();
    const out = await runFirstAnalysisAfterConstruction(base({ revisionGraph: BLOCKED_GRAPH, dispatchRunAnalysis: d.fn }));
    expect(d.calls, 'no PLoT call for a model that cannot run').toHaveLength(0);
    expect(out).toEqual({ ran: false, reason: 'not_admissible', nextStep: resolveRunAdmission(BLOCKED_GRAPH).blockedNextStep });
    expect(firstAnalysisSentence(out), 'never a silent skip').toMatch(/Option B/);
  });

  it('RED: the turn deadline has passed → 0 dispatches, reason no_time, and one sentence', async () => {
    const d = stubDispatch();
    const out = await runFirstAnalysisAfterConstruction(base({ deadlineAt: Date.now() - 1, dispatchRunAnalysis: d.fn }));
    expect(d.calls).toHaveLength(0);
    expect(out).toEqual({ ran: false, reason: 'no_time' });
    expect(firstAnalysisSentence(out)).toEqual(expect.any(String));
  });

  it('CONTRAST: not admissible AND out of time reports what is MISSING (a Run could not fix it)', async () => {
    const d = stubDispatch();
    const out = await runFirstAnalysisAfterConstruction(base({ revisionGraph: BLOCKED_GRAPH, deadlineAt: Date.now() - 1, dispatchRunAnalysis: d.fn }));
    expect(out.ran === false && out.reason).toBe('not_admissible');
    expect(d.calls).toHaveLength(0);
  });

  it('the deadline is the proxy budget less the response headroom and the first-analysis reserve', () => {
    expect(firstAnalysisDeadline(1_000_000, 125_000)).toBe(1_000_000 + 125_000 - TURN_RESPONSE_HEADROOM_MS - FIRST_ANALYSIS_RESERVE_MS);
  });
});

describe('RED: defence in depth — the (construction turn K, revision H) prior fact', () => {
  /** The fact a committed first analysis leaves: stamped by the dispatcher from the trigger WE handed it. */
  const priorFact = (constructionTurnId: string, hash: string): HandlerFact => {
    const trigger = firstAnalysisAutoRunTrigger(constructionTurnId);
    return {
      fact_type: 'run_analysis', fact_id: 'f1', fact_version: 1, noop: false,
      result: {
        scenario_id: SCENARIO, graph_hash_at_run: hash, summary: 'x',
        enrichment: { [RUN_PROVENANCE_ENRICHMENT_KEY]: ('constructionTurnId' in trigger ? buildConstructionAutoRunProvenance(trigger.constructionTurnId) : buildAutoRunProvenance(trigger.draftTurnId)) },
      },
    } as unknown as HandlerFact;
  };
  const withFacts = (facts: HandlerFact[]) => async () => ({ status: 'ok' as const, facts });

  it('RED: a fact for exactly (K, H) → already_ran_for_construction, 0 dispatches', async () => {
    const d = stubDispatch();
    const out = await runFirstAnalysisAfterConstruction(base({ readPriorFacts: withFacts([priorFact(K, H)]), dispatchRunAnalysis: d.fn }));
    expect(out).toEqual({ ran: false, reason: 'already_ran_for_construction' });
    expect(d.calls).toHaveLength(0);
    expect(firstAnalysisSentence(out), 'an analysis of this exact revision exists: nothing to say').toBeNull();
  });

  it.each([
    ['same K, a DIFFERENT revision', () => priorFact(K, 'another-revision')],
    ['same revision, a DIFFERENT construction', () => priorFact(registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, `${BRIEF} (rephrased)`)), H)],
  ])('CONTRAST: %s → it runs', async (_l, mk) => {
    const d = stubDispatch();
    const out = await runFirstAnalysisAfterConstruction(base({ readPriorFacts: withFacts([mk()]), dispatchRunAnalysis: d.fn }));
    expect(out.ran).toBe(true);
    expect(d.calls).toHaveLength(1);
  });

  it('CONTRAST: a USER-initiated fact for the same revision (no provenance) does not suppress it', async () => {
    const f = priorFact(K, H) as unknown as { result: { enrichment: Record<string, unknown> } };
    delete f.result.enrichment[RUN_PROVENANCE_ENRICHMENT_KEY];
    const d = stubDispatch();
    const out = await runFirstAnalysisAfterConstruction(base({ readPriorFacts: withFacts([f as unknown as HandlerFact]), dispatchRunAnalysis: d.fn }));
    expect(out.ran).toBe(true);
  });

  it('a DEGRADED prior-fact read proceeds (the cheap harm is a duplicate, the expensive one is no result)', async () => {
    const d = stubDispatch();
    const out = await runFirstAnalysisAfterConstruction(base({ readPriorFacts: async () => ({ status: 'degraded' as const, facts: [] }), dispatchRunAnalysis: d.fn }));
    expect(out.ran).toBe(true);
    expect(d.calls).toHaveLength(1);
  });

  it('the reader recognises the future {construction_turn_id} spelling too, so the trigger switch is one line', () => {
    const f = { fact_type: 'run_analysis', noop: false, result: { graph_hash_at_run: H, enrichment: { [RUN_PROVENANCE_ENRICHMENT_KEY]: { initiated_by: 'auto_post_construction', provisional: true, construction_turn_id: K } } } } as unknown as HandlerFact;
    expect(recordsFirstAnalysisOf(f, K, H)).toBe(true);
    expect(recordsFirstAnalysisOf(f, K, 'other')).toBe(false);
  });
});

describe('a run that did not complete is never reported as one', () => {
  it('the dispatcher’s own refusal → refused, with its words as the next step', async () => {
    const d = stubDispatch('handler_recovered');
    const out = await runFirstAnalysisAfterConstruction(base({ dispatchRunAnalysis: d.fn }));
    expect(out).toMatchObject({ ran: false, reason: 'refused', nextStep: 'Option B sets nothing yet.' });
  });
  it('an `ok` answer with no result is a refusal whose reason is NOT the run\u2019s own receipt', async () => {
    const calls: unknown[] = [];
    const out = await runFirstAnalysisAfterConstruction(base({
      dispatchRunAnalysis: (async (a: unknown) => {
        calls.push(a);
        return { outcome: 'ok', response: { assistant_text: 'I ran a first analysis on the model I have just drafted.', blocks: [] }, commitPerformed: true, graph: null, mayNameLeadingOption: false } as never;
      }) as never,
    }));
    expect(calls).toHaveLength(1);
    expect(out).toMatchObject({ ran: false, reason: 'refused', nextStep: '' });
    expect(firstAnalysisSentence(out)).not.toContain('I ran a first analysis');
  });
  it.each(['handler_failure', 'throw'] as const)('%s → failed, never thrown', async (mode) => {
    const d = stubDispatch(mode);
    const out = await runFirstAnalysisAfterConstruction(base({ dispatchRunAnalysis: d.fn }));
    expect(out).toMatchObject({ ran: false, reason: 'failed' });
  });
});

describe('RED: coaching blocks are bound to the readback, never appended raw', () => {
  const run = [
    { type: 'analysis_result', summary: 'the run’s own copy' },
    { type: 'review_card', card_kind: 'evidence_priority', graph_hash_at_generation: H, title: 't', body: 'b' },
    { type: 'coaching', graph_hash_at_generation: H, title: 't', body: 'b', action_intent: 'explore' },
    { type: 'ui_directive', graph_hash_at_generation: H },
  ];
  const current = { run_state: { kind: 'complete_current', computed_at: '2026-09-24T18:00:00.000Z' }, usable_for_chips: true };

  it('RED: matching hash + a current run → the Phase 3 blocks are included (the run’s own analysis_result is not)', () => {
    const out = bindRunBlocksToReadback(run, { graphHash: H, analysisState: current, analysisResult: { type: 'analysis_result' } });
    expect(out.map((b) => (b as { type: string }).type)).toEqual(['review_card', 'coaching']);
  });
  it('CONTRAST: a different readback hash → nothing', () => {
    expect(bindRunBlocksToReadback(run, { graphHash: 'moved', analysisState: current, analysisResult: { type: 'analysis_result' } })).toEqual([]);
  });
  it('CONTRAST: a non-current run → nothing', () => {
    const stale = { ...current, run_state: { kind: 'complete_stale', computed_at: '2026-09-24T18:00:00.000Z', cause: 'graph_changed' } };
    expect(bindRunBlocksToReadback(run, { graphHash: H, analysisState: stale, analysisResult: { type: 'analysis_result' } })).toEqual([]);
  });
  it('CONTRAST: no readback result → nothing (never manufacture currentness)', () => {
    expect(bindRunBlocksToReadback(run, { graphHash: H, analysisState: current, analysisResult: undefined })).toEqual([]);
  });
  it('an action-bearing block needs usable_for_chips', () => {
    const out = bindRunBlocksToReadback(run, { graphHash: H, analysisState: { ...current, usable_for_chips: false }, analysisResult: { type: 'analysis_result' } });
    expect(out.map((b) => (b as { type: string }).type)).toEqual(['review_card']);
  });
});

/**
 * ⛔ R&C served witness `bw-580d135b-7f9a16d-noflag3` (#69 5827198323): a near-tie Run withheld the leader, and a
 * `strengthen` card ("The leading option is ahead…") still reached the user. Leader-presuming blocks — compose's own
 * definition — are shown only when `leader_claim.permitted === true`.
 */
describe('RED: a card that presumes a leader is bound only when a leader may be named', () => {
  const current = { run_state: { kind: 'complete_current', computed_at: '2026-09-25T05:10:00.000Z' }, usable_for_chips: true };
  const withheld = { ...current, leader_claim: { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' } };
  const permitted = { ...current, leader_claim: { permitted: true } };
  const served = { type: 'coaching', coaching_kind: 'strengthen', block_id: 'coach:lens:pre_mortem', source: 'decision_review_enricher', graph_hash_at_generation: H, title: 'Stress-test', body: 'The leading option is ahead, but not by a wide margin.' };
  const presuming = [
    served,
    ...['narrative', 'robustness', 'scenario_context', 'pre_mortem', 'flip_threshold'].map((k) => ({ type: 'review_card', card_kind: k, graph_hash_at_generation: H, title: k, body: 'b' })),
    { type: 'evidence', graph_hash_at_generation: H, evidence_gap: 'Confirm the leading option holds if churn rises.' },
  ];
  const neutral = [
    { type: 'review_card', card_kind: 'evidence_priority', graph_hash_at_generation: H, title: 't', body: 'b' },
    { type: 'coaching', coaching_kind: 'assumption_check', graph_hash_at_generation: H, title: 't', body: 'b' },
    { type: 'evidence', graph_hash_at_generation: H, evidence_gap: 'Measure monthly churn before the rise.' },
  ];
  const result = { type: 'analysis_result' };
  it('RED: withheld (the served near tie) → every leader-presuming block is dropped; neutral ones stay', () => {
    const out = bindRunBlocksToReadback([...presuming, ...neutral], { graphHash: H, analysisState: withheld, analysisResult: result });
    expect(out).toEqual(neutral);
  });
  it('RED: no leader_claim at all is not a permission (fail closed)', () => {
    expect(bindRunBlocksToReadback([served, ...neutral], { graphHash: H, analysisState: current, analysisResult: result })).toEqual(neutral);
  });
  it('CONTROL: permitted → the same blocks are all bound', () => {
    expect(bindRunBlocksToReadback([...presuming, ...neutral], { graphHash: H, analysisState: permitted, analysisResult: result })).toEqual([...presuming, ...neutral]);
  });
});

describe('the typed leader permission the Agent is given', () => {
  const ready = (mode: string) => ({ analysis_admission: { structurally_analysable: true, permitted_analysis_mode: mode } });
  it('names a leader only when leader_claim.permitted AND the admission is comparative_leader', () => {
    expect(claimPermissionsFrom({ leader_claim: { permitted: true } }, ready('comparative_leader')).leader_may_be_named).toBe(true);
    expect(claimPermissionsFrom({ leader_claim: { permitted: true } }, ready('quantified_provisional')).leader_may_be_named).toBe(false);
    expect(claimPermissionsFrom({ leader_claim: { permitted: false, withheld_reason: 'auto_initiated' } }, ready('comparative_leader'))).toEqual({
      leader_may_be_named: false, withheld_reason: 'auto_initiated', permitted_analysis_mode: 'comparative_leader',
    });
    expect(claimPermissionsFrom(undefined, undefined).leader_may_be_named, 'absent is never permission').toBe(false);
  });
});
