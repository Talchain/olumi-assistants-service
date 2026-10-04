import { sharedLicensedPair } from './shared-licensed-pair.fixture.js';
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { RUN_ANALYSIS_PROJECTION_KEY, stampRunAnalysisProjection } from '../../context/analysis-projection-policy.js';
import { bindVersionResults } from '../version-result-binding.js';
import { buildRunDelta } from '../../coaching/build-run-delta.js';
import { versionRecord, FIX_SCENARIO } from './fixtures.js';
import { FROM, TO, PRIOR, CURRENT, factSet, savedRun } from './version-result-fixtures.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const result = (fact: HandlerFact): Record<string, unknown> => (fact as unknown as { result: Record<string, unknown> }).result;
const binding = (facts = factSet(), from = FROM, to = TO) =>
  bindVersionResults({ scenarioId: FIX_SCENARIO, from, to, factSet: facts });

describe('stored versions bind only to confirmed recorded results', () => {
  it('resolves the exact pair immutably and freshly computes its existing delta', () => {
    const original = JSON.stringify([FROM, TO, factSet()]);
    const bound = binding(); expect(bound.kind).toBe('paired');
    if (bound.kind !== 'paired') return;
    expect(bound.selectedPair.prior.run_id).toBe('bound-prior');
    expect(bound.selectedPair.current.run_id).toBe('bound-current');
    expect(buildRunDelta({ priorFacts: bound.facts, selectedPair: bound.selectedPair,
      mayNameLeadingOption: bound.mayNameLeadingOption }).kind).toBe('ok');
    expect(JSON.stringify([FROM, TO, factSet()])).toBe(original);
  });

  it('reverses the selected direction without changing the recorded dates', () => {
    const bound = binding(factSet(), TO, FROM); expect(bound.kind).toBe('paired');
    if (bound.kind !== 'paired') return;
    expect(bound.selectedPair.prior).toMatchObject({ run_id: 'bound-current', computed_at: '2026-10-02T01:00:00.000Z' });
    expect(bound.selectedPair.current).toMatchObject({ run_id: 'bound-prior', computed_at: '2026-10-02T00:00:00.000Z' });
  });

  it('selects the latest eligible result by its recorded time, then Run identity', () => {
    const later = savedRun(FROM, 'z-last', '2026-10-02T02:00:00.000Z');
    const tied = savedRun(FROM, 'a-first', '2026-10-02T02:00:00.000Z');
    const bound = binding(factSet([PRIOR, later, CURRENT, tied]));
    expect(bound.kind).toBe('paired');
    if (bound.kind === 'paired') expect(bound.selectedPair.prior.run_id).toBe('a-first');
  });

  it('does not join a later Run by timestamp when its inputs do not match', () => {
    const wrong = clone(CURRENT); result(wrong).computed_at = '2026-10-02T03:00:00.000Z';
    expect(binding(factSet([wrong]))).toStrictEqual({ kind: 'unavailable', reason: 'missing_run' });
  });

  it('references one Run once when both versions have the same analysis inputs', () => {
    const same = versionRecord(FROM.graph as Parameters<typeof versionRecord>[0], { id: TO.id });
    const bound = binding(factSet([PRIOR]), FROM, same);
    expect(bound).toMatchObject({ kind: 'shared', recordedRun: { run_id: 'bound-prior' } });
    expect(bound).not.toHaveProperty('facts'); expect(bound).not.toHaveProperty('selectedPair');
  });

  it('reports missing runs only from a complete record', () => {
    expect(binding(factSet([]))).toStrictEqual({ kind: 'unavailable', reason: 'missing_run' });
    expect(binding({ status: 'capped', facts: [], total_count: 21 })).toStrictEqual({ kind: 'unavailable', reason: 'unconfirmed_identity' });
    expect(binding({ status: 'degraded', facts: [], reason: 'durable_unavailable' })).toStrictEqual({ kind: 'unavailable', reason: 'unconfirmed_identity' });
  });

  it.each(['run_id', 'graph_hash_at_run', 'computed_at', 'scenario_id', 'input_snapshot'])('does not repair a legacy Run missing %s', (key) => {
    const legacy = clone(PRIOR); delete result(legacy)[key];
    expect(binding(factSet([CURRENT, legacy]))).toStrictEqual({ kind: 'unavailable', reason: 'unconfirmed_identity' });
  });

  it('rejects stored envelopes that do not match their snapshot', () => {
    expect(binding(factSet(), { ...FROM, analysis_affecting_hash: 'a'.repeat(64) })).toStrictEqual({ kind: 'unavailable', reason: 'unconfirmed_identity' });
    expect(binding(factSet(), { ...FROM, identity_normaliser_version: 'unknown' })).toStrictEqual({ kind: 'unavailable', reason: 'unconfirmed_identity' });
  });

  it('reuses the goal-unit gate even when the numerical input hash stayed equal', () => {
    const wrong = clone(PRIOR);
    (result(wrong).input_snapshot as { goal: { unit: string } }).goal.unit = 'USD/month';
    expect(binding(factSet([CURRENT, wrong]))).toStrictEqual({ kind: 'unavailable', reason: 'incompatible_results' });
  });

  it('refuses ambiguous records and propagates a selected Run’s withheld leader', () => {
    expect(binding(factSet([PRIOR, CURRENT, clone(PRIOR)]))).toStrictEqual({ kind: 'unavailable', reason: 'unconfirmed_identity' });
    const withheld = clone(CURRENT); result(withheld).constraint_verdict = { may_name_leading_option: false, constraint_verdict_state: 'evaluated_feasible' };
    const bound = binding(factSet([PRIOR, withheld]));
    expect(bound.kind).toBe('paired');
    if (bound.kind === 'paired') {
      expect(bound.mayNameLeadingOption).toBe(false);
      const delta = buildRunDelta({ priorFacts: bound.facts, selectedPair: bound.selectedPair,
        mayNameLeadingOption: bound.mayNameLeadingOption });
      expect(delta.kind).toBe('ok');
      if (delta.kind === 'ok') {
        expect(delta.delta.leader).not.toHaveProperty('prior_leading_option_id');
        expect(delta.delta.leader).not.toHaveProperty('current_leading_option_id');
        expect(delta.delta.win_probabilities).toStrictEqual([]);
      }
    }
  });
});


describe('both bound saved Run licences reach the final Compare input', () => {
  it('retains a producer-licensed positive instead of evaluating a bare permission with no admission', () => {
    const pair = sharedLicensedPair();
    expect(pair.admissions.map(a => a?.permitted_analysis_mode)).toStrictEqual(['comparative_leader', 'comparative_leader']);
    const bound = bindVersionResults({ scenarioId: FIX_SCENARIO, from: pair.from, to: pair.to, factSet: pair.facts });
    expect(bound.kind).toBe('paired');
    if (bound.kind !== 'paired') return;
    expect(bound.leaderLicences).toStrictEqual({ prior: 'permitted', current: 'permitted' });
    expect(bound.mayNameLeadingOption).toBe(true);
    const delta = buildRunDelta({ priorFacts: bound.facts, selectedPair: bound.selectedPair, mayNameLeadingOption: bound.mayNameLeadingOption });
    expect(delta.kind).toBe('ok');
    if (delta.kind === 'ok') expect(delta.delta.win_probabilities.length).toBeGreaterThan(0);
  });
  it.each(['prior', 'current'] as const)('withholds if the %s Run restricts the claim', (which) => {
    const pair = sharedLicensedPair();
    result(pair[which]).constraint_verdict = { may_name_leading_option: false, constraint_verdict_state: 'evaluated_feasible' };
    const bound = bindVersionResults({ scenarioId: FIX_SCENARIO, from: pair.from, to: pair.to, factSet: pair.facts });
    expect(bound.kind).toBe('paired');
    if (bound.kind !== 'paired') return;
    expect(bound.leaderLicences[which]).toBe('withheld');
    expect(bound.mayNameLeadingOption).toBe(false);
  });
});


describe('Compare respects the saved Run projection stamp', () => {
  it.each(['node', 'mirror', 'both'] as const)('selects exact Runs for %s gaps in either direction and same-version comparisons', placement => {
    const clear = FROM;
    const graph = clone(FROM.graph) as { nodes: Record<string, unknown>[]; options?: Record<string, unknown>[] };
    const target = graph.nodes.find(n => n.id === 'opt-a')!;
    const gaps = { unresolved_targets: ['billable seats'], user_questions: ['Which seats?'] };
    if (placement !== 'node') graph.options = graph.nodes.filter(n => n.kind === 'option').map(n => ({ id: n.id, label: n.label, status: 'ready', interventions: clone(n.interventions) }));
    if (placement !== 'mirror') Object.assign(target, gaps);
    if (placement !== 'node') Object.assign(graph.options!.find(n => n.id === target.id)!, gaps);
    const held = versionRecord(graph as never, { id: TO.id });
    const cleanRun = savedRun(clear, 'exact-clean', '2026-10-03T02:00:00.000Z');
    const heldRun = savedRun(held, 'exact-held', '2026-10-03T01:00:00.000Z');
    for (const run of [cleanRun, heldRun]) result(run).enrichment = stampRunAnalysisProjection(result(run).enrichment as Record<string, unknown>);
    for (const [from, to] of [[held, clear], [clear, held]]) {
      const bound = binding(factSet([cleanRun, heldRun]), from, to);
      expect(bound.kind).toBe('paired');
      if (bound.kind === 'paired') {
        expect(bound.selectedPair.prior.run_id).toBe(from === held ? 'exact-held' : 'exact-clean');
        expect(bound.selectedPair.current.run_id).toBe(to === held ? 'exact-held' : 'exact-clean');
      }
    }
    expect(binding(factSet([cleanRun, heldRun]), held, held)).toMatchObject({ kind: 'shared', recordedRun: { run_id: 'exact-held' } });
    expect(binding(factSet([cleanRun]), held, held).kind).toBe('unavailable');
  });
  it('rejects an unknown stamp even on an identical version', () => {
    const run = clone(PRIOR);
    (result(run).enrichment as Record<string, unknown>)[RUN_ANALYSIS_PROJECTION_KEY] = 'unknown';
    expect(binding(factSet([run]), FROM, FROM)).toStrictEqual({ kind: 'unavailable', reason: 'unconfirmed_identity' });
  });
});
