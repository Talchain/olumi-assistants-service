/**
 * ⛔ P0 SHARED DATA (DL 4563ad): "may a leader be named?" has ONE answer, the leader licence (`compose/leader-licence.ts`),
 * which reads the composed `leader_claim` AND the admission's `permitted_analysis_mode`. `leader_claim.permitted` alone
 * is one of its inputs: `composeLeaderClaim` never reads the admission. On a separated Run of a model admitted below
 * `comparative_leader` (exploratory: 86 of the 126 runnable served graphs in this repo's fixtures) the claim says
 * `permitted: true` while the licence — and so the reply, the result block and the Agent's `claim_permissions` — withholds.
 *
 * `bindRunBlocksToReadback` read the claim, not the licence, so a "The leading option is ahead…" card reached the user
 * beside a reply that names no leader (the R&C `bw-580d135b` class, through the admission arm).
 *
 * The admission is the PRODUCER's (`buildCanonicalAnalysisReadyFromGraph`) over served graphs, never a typed literal.
 *
 * RE-PINNED, RT-10 B′ R2 (Science #87 5999608477; DL e8 CONFIRMED): the served cold graph was `exploratory` only through
 * the untestable-target cap R2 retired, and no producer path mints an analysable `exploratory` now. The class this file
 * guards still reaches the bind through STORED readbacks: every Run persisted before R2 deploys carries the cap. So
 * `READY.exploratory` is the producer's admission for that same graph, as a pre-R2 Run stored it (mode `exploratory`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bindRunBlocksToReadback } from '../first-analysis.js';
import { scienceBriefOf } from '../analysis-coaching-pass-through.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { permittedAnalysisModeFromAnalysisReady } from '../../admission/analysis-admission.js';
import { leaderLicenceFromState } from '../../compose/leader-licence.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));
const exploratoryGraph = (fixture('served-799d1a5d-cold-s1-graph.json') as { graph: unknown }).graph;
const m1 = fixture('m1-s1-served-graphs.json') as { cases: { graph: unknown }[] };
const producedForExploratoryGraph = buildCanonicalAnalysisReadyFromGraph(exploratoryGraph);
/** The same admission as a pre-R2 Run STORED it: only the retired cap differs. */
const storedPreR2 = (ready: unknown): unknown => {
  const r = structuredClone(ready) as { analysis_admission: Record<string, unknown> };
  r.analysis_admission.permitted_analysis_mode = 'exploratory';
  return r;
};
const READY = {
  exploratory: storedPreR2(producedForExploratoryGraph),
  comparative: buildCanonicalAnalysisReadyFromGraph(m1.cases[0]!.graph),
  provisional: buildCanonicalAnalysisReadyFromGraph(m1.cases[1]!.graph),
};

const H = 'revision-hash-of-the-run';
const current = { run_state: { kind: 'complete_current', computed_at: '2026-10-03T00:00:00.000Z' }, usable_for_chips: true };
/** A separated, entitled Run: the composed claim says `permitted: true`. */
const separated = { ...current, leader_claim: { permitted: true, separation: 'separated' } };
const withheld = { ...current, leader_claim: { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' } };
const strengthen = { type: 'coaching', coaching_kind: 'strengthen', block_id: 'coach:lens:pre_mortem', source: 'decision_review_enricher', graph_hash_at_generation: H, title: 'Stress-test', body: 'The leading option is ahead, but not by a wide margin.' };
const narrative = { type: 'review_card', card_kind: 'narrative', graph_hash_at_generation: H, title: 'narrative', body: 'b' };
const neutral = { type: 'review_card', card_kind: 'evidence_priority', graph_hash_at_generation: H, title: 't', body: 'b' };
const result = { type: 'analysis_result' };

describe('PRECONDITION: the served admissions are what the rows say they are (producer, not literal)', () => {
  it('exploratory / comparative_leader / quantified_provisional', () => {
    // The producer now admits the cold graph uncapped (B′ R2); the stored pre-R2 shape is the exploratory row's input.
    expect(permittedAnalysisModeFromAnalysisReady(producedForExploratoryGraph)).toBe('quantified_provisional');
    expect(permittedAnalysisModeFromAnalysisReady(READY.exploratory)).toBe('exploratory');
    expect(permittedAnalysisModeFromAnalysisReady(READY.comparative)).toBe('comparative_leader');
    expect(permittedAnalysisModeFromAnalysisReady(READY.provisional)).toBe('quantified_provisional');
  });
  it('the boundary: one Run, claim permitted:true, licence withheld', () => {
    expect(separated.leader_claim.permitted).toBe(true);
    expect(leaderLicenceFromState(separated, READY.exploratory)).toBe('withheld');
  });
});

describe('RED: a leader-presuming card follows the ONE leader licence, not the bare claim', () => {
  it('RED: exploratory admission, separated Run → the leader-presuming cards are dropped; neutral stays', () => {
    const out = bindRunBlocksToReadback([strengthen, narrative, neutral], { graphHash: H, analysisState: separated, analysisResult: result, analysisReady: READY.exploratory });
    expect(out).toEqual([neutral]);
  });
  it('CONTROL (agreeing case): comparative_leader admission, separated Run → every card is bound', () => {
    const out = bindRunBlocksToReadback([strengthen, narrative, neutral], { graphHash: H, analysisState: separated, analysisResult: result, analysisReady: READY.comparative });
    expect(out).toEqual([strengthen, narrative, neutral]);
  });
  it('CONTROL: quantified_provisional + separated → permitted_with_caveat ("caveat, not withhold") → bound', () => {
    expect(leaderLicenceFromState(separated, READY.provisional)).toBe('permitted_with_caveat');
    const out = bindRunBlocksToReadback([strengthen, neutral], { graphHash: H, analysisState: separated, analysisResult: result, analysisReady: READY.provisional });
    expect(out).toEqual([strengthen, neutral]);
  });
  it('CONTROL: a withheld claim stays withheld under every admission', () => {
    for (const ready of [READY.exploratory, READY.comparative, READY.provisional]) {
      expect(bindRunBlocksToReadback([strengthen, neutral], { graphHash: H, analysisState: withheld, analysisResult: result, analysisReady: ready })).toEqual([neutral]);
    }
  });
});

describe('RED: the science brief tells the model the licence, not the bare claim', () => {
  it('RED: exploratory admission, separated Run → leader.may_be_named is false', () => {
    expect(scienceBriefOf(null, [], separated, READY.exploratory).leader.may_be_named).toBe(false);
  });
  it('CONTROL (agreeing case): comparative_leader → true', () => {
    expect(scienceBriefOf(null, [], separated, READY.comparative).leader.may_be_named).toBe(true);
  });
  it('CONTROL: a withheld claim → false', () => {
    expect(scienceBriefOf(null, [], withheld, READY.comparative).leader.may_be_named).toBe(false);
  });
});
