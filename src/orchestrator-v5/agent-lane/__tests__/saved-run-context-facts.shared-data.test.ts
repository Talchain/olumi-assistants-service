/** Offline controls over the existing canonical/SCI corpus; no provider, write or browser proof. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { savedRunContextFacts, type SavedRunContextFactsRead } from '../saved-run-context-facts.js';
import { analysisResultForAgent } from '../decision-sensitivity.js';
import { modelFacingToolResult } from '../licensed-run-view.js';
import { runExplanationChip } from '../run-explanation.js';
import { claimPermissionsFrom } from '../first-analysis.js';
import { readLimitVerdicts } from '../../../orchestrator/context/constraint-feasibility.js';
import { projectModelFacingRunDelta } from '../../context/model-facing-run-delta.js';
import { selectedRunContextDelta, selectedRunContextPair } from './fixtures/selected-run-context-delta.js';
import { buildRunDelta } from '../../coaching/build-run-delta.js';

type Rec = Record<string, any>;
const corpus = (path: string): Rec => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Rec;
const POSITIVE = corpus('../../../../tests/fixtures/cross-service/b5-per-limit/0e19bb82.served-turn.json');
const NO_FLIP = corpus('../../coaching/__tests__/fixtures/paul-run-17d1cd3a-next-move.json').analysis_result as Rec;
const W3 = corpus('./fixtures/served-w3-520aab46-cold-read-f074916.json');
const SID = '520aab46-9ed5-4819-9d7f-498d16603943';
const AT = '2026-10-03T00:00:00.000Z';
const result = { type: 'analysis_result', computed_against_hash: POSITIVE.graph_hash, enrichment: POSITIVE.enrichment };
const current: SavedRunContextFactsRead = {
  graph_hash: POSITIVE.graph_hash, analysis_state: { run_state: { kind: 'complete_current', computed_at: AT } },
  analysis_result: result, raw: W3.graph,
};
const withheld = { leader_may_be_named: false };
const project = (read = current): Rec => savedRunContextFacts(SID, read, withheld);

describe('same selected current Run supplies context facts without another authority', () => {
  it('withheld ordinary and recovery context omits a residual comparison, rather than neutralising its IDs', () => {
    const delta = selectedRunContextDelta(POSITIVE.graph_hash, AT);
    expect(delta.leader.changed).toBe(true);
    expect(delta.win_probabilities.length).toBeGreaterThan(0);
    expect(project({ ...current, run_delta: delta })).not.toHaveProperty('run_delta');
    const cold = modelFacingToolResult('get_canonical_state', { analysis: { claim_permissions: withheld, run_delta: delta } });
    expect(cold.analysis).not.toHaveProperty('run_delta');
  });

  it.each(['flip_thresholds', 'endpoints', 'input_coverage', 'input_changes', 'win_probabilities_unavailable'])(
    'wire-only %s stays out of both ordinary and recovery model inputs', key => {
    const pair = selectedRunContextPair(POSITIVE.graph_hash, AT);
    (pair[1] as unknown as Rec).result.constraint_verdict.may_name_leading_option = false;
    const built = buildRunDelta({ priorFacts: pair, mayNameLeadingOption: true });
    if (built.kind !== 'ok') throw new Error(`fixture comparison refused: ${built.reason}`);
    const delta = built.delta;
    const permission = { leader_may_be_named: true };
    const before = JSON.stringify(delta);
    const ordinary = savedRunContextFacts(SID, { ...current, run_delta: delta }, permission);
    const cold = modelFacingToolResult('get_canonical_state', { analysis: { claim_permissions: permission, run_delta: delta } });
    expect(delta).toHaveProperty(key);
    expect(ordinary.run_delta).not.toHaveProperty(key);
    expect(cold.analysis.run_delta).not.toHaveProperty(key);
    expect(JSON.stringify(delta)).toBe(before);
  });
  it('projects the licensed delta, preserving every prior fact', () => {
    const delta = selectedRunContextDelta(POSITIVE.graph_hash, AT);
    const baseline = project();
    const facts = savedRunContextFacts(SID, { ...current, run_delta: delta }, { leader_may_be_named: true });
    expect(facts.run_delta).toEqual(projectModelFacingRunDelta(delta));
    const { run_delta: _delta, ...unchanged } = facts;
    expect(unchanged).toEqual(baseline);
    expect(project()).not.toHaveProperty('run_delta');
  });

  it.each(['never_run', 'complete_stale', 'unknown_degraded'])('%s cannot revive an earlier delta', (kind) => {
    const delta = selectedRunContextDelta(POSITIVE.graph_hash, AT);
    expect(project({ ...current, run_delta: delta,
      analysis_state: { run_state: { kind, computed_at: AT } },
    } as SavedRunContextFactsRead)).toEqual({});
  });

  it('a newer degraded read with no selected result cannot borrow a prior delta', () => {
    const delta = selectedRunContextDelta(POSITIVE.graph_hash, AT);
    expect(project({ ...current, run_delta: delta, analysis_result: undefined,
      analysis_state: { run_state: { kind: 'complete_current', computed_at: AT },
        contradictions: ['fact_status_success_but_degraded_newer'] },
    } as SavedRunContextFactsRead)).toEqual({});
  });

  it('a newer Run on the same graph uses only its own selected delta and reference', () => {
    const nextAt = '2026-10-03T00:05:00.000Z';
    const delta = selectedRunContextDelta(POSITIVE.graph_hash, nextAt);
    const facts = savedRunContextFacts(SID, { ...current, run_delta: delta,
      analysis_state: { run_state: { kind: 'complete_current', computed_at: nextAt } },
    }, { leader_may_be_named: true });
    expect(facts.run_delta).toEqual(projectModelFacingRunDelta(delta));
    expect(facts.selected_run_reference).not.toBe(project().selected_run_reference);
  });

  it('uses the existing science projection exactly, retaining the recorded factor and 55.76 threshold', () => {
    const immediate = modelFacingToolResult('run_analysis', { result: analysisResultForAgent(result), claim_permissions: withheld }) as Rec;
    const facts = project();
    expect(facts.tipping_point).toEqual(immediate.result.tipping_point);
    expect(facts.tipping_point).toMatchObject({ status: 'found', factor_id: 'pro_plan_price', threshold: 55.76 });
    const reference = runExplanationChip(SID, { graphHash: current.graph_hash, analysisState: current.analysis_state, analysisResult: result })!;
    expect(facts.tipping_point_run_key).toBe(reference.id);
    expect(facts.selected_run_reference).toBe(reference.id);
    expect(JSON.stringify(facts.tipping_point)).not.toMatch(/alternative_winner|leader|additional_advertising/u);
  });

  it('cold JSON context requires no transcript, and a newer Run on the same graph has its own reference', () => {
    expect(project(JSON.parse(JSON.stringify(current)))).toEqual(project());
    const newer = project({ ...current, analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-03T00:01:00.000Z' } } });
    expect(newer.tipping_point).toEqual(project().tipping_point);
    expect(newer.selected_run_reference).not.toBe(project().selected_run_reference);
  });

  it('a different CAS/read hash does not override the canonical selected-current verdict', () => {
    expect(project({ ...current, graph_hash: 'f'.repeat(64) })).toEqual(project());
  });

  it.each(['complete_stale', 'unknown_degraded', 'never_run', 'failed'])('%s carries no selected facts', (kind) => {
    expect(project({ ...current, analysis_state: { run_state: { kind, computed_at: AT } } })).toEqual({});
  });

  it.each([
    ['missing result', { ...current, analysis_result: undefined }],
    ['newer degraded suppresses old result', { ...current, analysis_result: undefined, analysis_state: {
      run_state: { kind: 'complete_current', computed_at: AT }, contradictions: ['fact_status_success_but_degraded_newer'],
    } }],
    ['missing timestamp', { ...current, analysis_state: { run_state: { kind: 'complete_current' } } }],
    ['missing analysis hash', { ...current, analysis_result: { ...result, computed_against_hash: undefined } }],
    ['missing read hash', { ...current, graph_hash: undefined }],
  ])('%s omits fact and reference', (_name, read) => expect(project(read as SavedRunContextFactsRead)).toEqual({}));

  it.each([
    ['not_evaluated', {}],
    ['no_flip_in_range', NO_FLIP.enrichment],
    ['unresolved', { ...POSITIVE.enrichment, flip_thresholds: [{ ...POSITIVE.enrichment.flip_thresholds[0], flip_value: null, flip_reason: 'candidate_cap_exceeded' }] }],
  ])('retains %s without inventing a crossing', (status, enrichment) => {
    expect(project({ ...current, analysis_result: { ...result, enrichment } }).tipping_point).toEqual({ status });
  });

  it('passes selected typed verdicts and limit checks through the existing reader, without filling missing coverage', () => {
    const verdicts = readLimitVerdicts({ per_limit: [{ constraint_id: 'agent-lane:monthly_churn:<=', state: 'estimate_only', reason: 'level_user_assumption' }], joint: { state: 'estimate_only' } })!;
    expect(verdicts).not.toBeNull();
    const facts = project({ ...current, limit_verdicts: verdicts, constraint_verdict_state: 'unevaluated' });
    expect(facts.limit_verdicts).toBe(verdicts);
    expect(facts.limit_checks.limits.map((row: Rec) => [row.constraint_id, row.state])).toEqual([['agent-lane:monthly_churn:<=', 'estimate_only']]);
    expect(facts.constraint_verdict_state).toBe('unevaluated');
    expect(facts).not.toHaveProperty('leader_limit_risks');
  });

  it.each([[null], [[]], [[{ constraint_id: 'churn', label: 'Monthly churn', source_quote: null, probability: 0.3 }]]])('retains canonical risk %j verbatim', (risks) => {
    const facts = project({ ...current, leader_limit_risks: risks });
    expect(facts.leader_limit_risks).toBe(risks);
  });

  it('missing, null and refused constraint state remain distinct, and missing verdict is not an empty list', () => {
    expect(project()).not.toHaveProperty('constraint_verdict_state');
    expect(project({ ...current, constraint_verdict_state: null })).toHaveProperty('constraint_verdict_state', null);
    expect(project({ ...current, constraint_verdict_state: 'invented_ok' })).not.toHaveProperty('constraint_verdict_state');
    expect(project()).not.toHaveProperty('limit_verdicts');
    expect(project()).not.toHaveProperty('limit_checks');
  });

  it('states the canonical probability polarity without changing the recorded risk figure', () => {
    const risks = [{ constraint_id: 'churn', label: 'Monthly churn', source_quote: null, probability: 0.3 }];
    const facts = project({ ...current, leader_limit_risks: risks });
    expect(facts.leader_limit_risks).toBe(risks);
    expect(facts.leader_limit_risks[0].probability).toBe(0.3);
    expect(facts.leader_limit_risks_note).toContain('meets the named limit');
    expect(facts.leader_limit_risks_note).toContain('not its chance of breaching');
    expect(facts.leader_limit_risks_note).toContain('grant no permission');
  });

  it.each(['none', 'exploratory', 'quantified_provisional', 'comparative_leader'])('science fact grants no licence in %s', (mode) => {
    const state = { run_state: { kind: 'complete_current', computed_at: AT }, leader_claim: { permitted: true, separation: 'separated' } };
    const permission = claimPermissionsFrom(state, { analysis_admission: { permitted_analysis_mode: mode, structurally_analysable: ['quantified_provisional', 'comparative_leader'].includes(mode) } }, { requested: true });
    const before = JSON.stringify(permission);
    const facts = savedRunContextFacts(SID, { ...current, analysis_state: state }, permission);
    expect(facts).not.toHaveProperty('claim_permissions');
    expect(facts).not.toHaveProperty('leader_may_be_named');
    expect(JSON.stringify(permission)).toBe(before);
    expect(facts.tipping_point).toEqual(project().tipping_point);
  });

  it('never mutates the selected canonical read', () => {
    const before = JSON.stringify(current); project(); expect(JSON.stringify(current)).toBe(before);
  });
});
