import { describe, expect, it } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { finaliseV5Response } from '../response-finaliser.js';
import { buildAnalysisResultBlock } from '../compose.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';
import { canonicalStateFromFreshness } from '../context/canonical-analysis-state.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { runAnalysisFact } from '../context/__tests__/run-delta-fixtures.js';
import {
  WITHHELD_RUN_IDENTITY_CONFLICT,
  WITHHELD_RUN_IDENTITY_UNCONFIRMED,
  composeAnalysisStateV1,
} from '../compose/analysis-state-v1.js';

// Synthetic run facts; real producer projection, block builder, composer,
// finaliser and strict wire schema. No provider calls or injected composer.
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GRAPH: GraphStateIngress = { nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }], edges: [] };
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const CHANGED_HASH = computeAnalysisAffectingGraphHash({
  ...GRAPH, nodes: [{ ...GRAPH.nodes[0], goal_threshold: 0.8 }],
} as GraphStateIngress)!;
const FIRST_TIME = '2026-09-06T17:50:03.871Z';
const NEXT_TIME = '2026-09-06T17:50:11.035Z';

function fact(overrides: Partial<RunAnalysisHandlerFact['result']> = {}): RunAnalysisHandlerFact {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, graph_hash_at_run: HASH, computed_at: FIRST_TIME,
      leading_option_id: 'option-a', summary: 'Option A leads on the current model.',
      win_probabilities: { 'option-a': 0.65, 'option-b': 0.35 },
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: {
        analysis_status: 'completed',
        robustness: { level: 'strong', near_tie: { is_tie: false } },
        option_comparison: [
          { option_id: 'option-a', option_label: 'Option A', win_probability: 0.65 },
          { option_id: 'option-b', option_label: 'Option B', win_probability: 0.35 },
        ],
      },
      ...overrides,
    },
  });
}

function response(run: RunAnalysisHandlerFact | null): OlumiResponse {
  return {
    response_version: 2, assistant_text: 'You can explore the model assumptions next.',
    stage_indicator: 'analyse', suggested_actions: [], insights: [],
    blocks: run === null ? [] : [buildAnalysisResultBlock(run)],
  };
}

function finalise(
  runs: RunAnalysisHandlerFact[],
  options: { scenarioId?: string; currentHash?: string; selectedFreshnessRun?: RunAnalysisHandlerFact; withBlock?: boolean } = {},
) {
  const chosen = options.selectedFreshnessRun ?? runs[0];
  const freshness = deriveAnalysisFreshness(chosen ? [chosen] : [], options.currentHash ?? HASH);
  const out = finaliseV5Response(response(options.withBlock === false ? null : chosen ?? null), {
    scenarioId: options.scenarioId ?? SCENARIO,
    priorFacts: runs, freshness, mayNameLeadingOption: true,
  });
  expect(OlumiResponseSchema.safeParse(out).success).toBe(true);
  return out;
}

describe('C2 binding at the reached finaliser/composer seam', () => {
  it('keeps a valid current run and its available figures', () => {
    const out = finalise([fact()]);
    expect(out.analysis_state?.run_state).toEqual({ kind: 'complete_current', computed_at: FIRST_TIME });
    expect(out.analysis_state?.leader_claim.permitted).toBe(true);
    expect(out.blocks[0]).toMatchObject({ leading_option_id: 'option-a', win_probabilities: { 'option-a': 0.65 } });
  });

  it('uses the new timestamp for a same-graph rerun', () => {
    const older = fact();
    const rerun = fact({ computed_at: NEXT_TIME });
    expect(finalise([older, rerun], { selectedFreshnessRun: rerun }).analysis_state?.run_state)
      .toEqual({ kind: 'complete_current', computed_at: NEXT_TIME });
    expect(older.result.computed_at).toBe(FIRST_TIME);
  });

  it('rejects a same-graph fact from a different rerun than the freshness selection', () => {
    const out = finalise([fact({ computed_at: NEXT_TIME })], { selectedFreshnessRun: fact() });
    expect(out.analysis_state?.leader_claim).toEqual({ permitted: false, withheld_reason: WITHHELD_RUN_IDENTITY_CONFLICT });
    expect(out.analysis_state?.contradictions).toContain(`${WITHHELD_RUN_IDENTITY_CONFLICT}:computed_at_conflict`);
    expect(out.blocks).toEqual([]);
  });

  it('binds to the canonical tuple that actually supplies the emitted run state', () => {
    const older = fact();
    const newer = fact({ computed_at: NEXT_TIME });
    const out = finaliseV5Response(response(newer), {
      scenarioId: SCENARIO, priorFacts: [newer], mayNameLeadingOption: true,
      freshness: deriveAnalysisFreshness([newer], HASH),
      canonicalState: canonicalStateFromFreshness(deriveAnalysisFreshness([older], HASH)),
    });
    expect(OlumiResponseSchema.safeParse(out).success).toBe(true);
    expect(out.analysis_state?.run_state.kind).toBe('unknown_degraded');
    expect(out.analysis_state?.contradictions).toContain(`${WITHHELD_RUN_IDENTITY_CONFLICT}:computed_at_conflict`);
    expect(out.blocks).toEqual([]);
  });

  it('treats an explicitly empty supplied fact list as unconfirmed when canonical state claims a selected fact', () => {
    const original = fact();
    const out = finaliseV5Response(response(original), {
      scenarioId: SCENARIO, priorFacts: [], mayNameLeadingOption: true,
      canonicalState: canonicalStateFromFreshness(deriveAnalysisFreshness([original], HASH)),
    });
    expect(OlumiResponseSchema.safeParse(out).success).toBe(true);
    expect(out.analysis_state?.run_state.kind).toBe('unknown_degraded');
    expect(out.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_RUN_IDENTITY_UNCONFIRMED);
    expect(out.blocks[0]).toMatchObject({ leading_option_id: null, win_probabilities: { 'option-a': 0.65 } });
  });

  it.each([FIRST_TIME, '2026-09-06T17:50:03Z', undefined])('rejects another scenario without hiding the conflict behind timestamp %s', (computed_at) => {
    const out = finalise([fact({ computed_at })], { scenarioId: OTHER_SCENARIO });
    expect(out.analysis_state?.run_state.kind).toBe('unknown_degraded');
    expect(out.analysis_state?.contradictions).toContain(`${WITHHELD_RUN_IDENTITY_CONFLICT}:scenario_id_conflict`);
    expect(out.blocks).toEqual([]);
    expect(out.assistant_text).toBe('You can explore the model assumptions next.');
  });

  it('does not append a comparative run delta to a conflicting run binding', () => {
    const olderEcho = runAnalysisFact(
      [{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }], '111', HASH, FIRST_TIME,
    );
    const newerEcho = runAnalysisFact(
      [{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }], '222', CHANGED_HASH, NEXT_TIME,
    );
    if (olderEcho.fact_type !== 'run_analysis' || newerEcho.fact_type !== 'run_analysis') {
      throw new Error('The shared producer fixture must supply run_analysis facts');
    }
    const older = fact({ ...olderEcho.result });
    const newer = fact({ ...newerEcho.result });
    expect(finalise([newer, older], { currentHash: CHANGED_HASH }).run_delta).toBeDefined();
    const out = finalise([newer, older], { scenarioId: OTHER_SCENARIO, currentHash: CHANGED_HASH });
    expect(out.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_RUN_IDENTITY_CONFLICT);
    expect(out.blocks).toEqual([]);
    expect(out.run_delta).toBeUndefined();
  });

  it('does not rewrite historical identity when the current graph has changed', () => {
    const original = fact();
    const snapshot = JSON.stringify(original);
    const out = finalise([original], { currentHash: CHANGED_HASH, withBlock: false });
    expect(out.analysis_state?.run_state).toEqual({ kind: 'complete_stale', computed_at: FIRST_TIME, cause: 'graph_changed' });
    expect(out.analysis_state?.contradictions).not.toContain(`${WITHHELD_RUN_IDENTITY_CONFLICT}:graph_hash_at_run_conflict`);
    expect(out.graph_hash).toBe(CHANGED_HASH);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it.each([undefined, '2026-09-06T17:50:03Z'])('retains figures for unconfirmed legacy time %s but withholds fresh claims', (computed_at) => {
    const out = finalise([fact({ computed_at })]);
    expect(out.analysis_state?.run_state.kind).toBe('unknown_degraded');
    expect(out.analysis_state?.leader_claim).toEqual({ permitted: false, withheld_reason: WITHHELD_RUN_IDENTITY_UNCONFIRMED });
    expect(out.blocks[0]).toMatchObject({ type: 'analysis_result', leading_option_id: null, win_probabilities: { 'option-a': 0.65, 'option-b': 0.35 } });
    expect((out.blocks[0] as { summary: string }).summary).not.toContain('Option A leads');
  });

  it('preserves a supported tie and preserves figures when the existing entitlement withholds a leader', () => {
    const tied = fact({
      constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'evaluated_infeasible' },
      enrichment: { analysis_status: 'completed', robustness: { level: 'moderate', near_tie: { is_tie: true } } },
    });
    const out = finalise([tied]);
    expect(out.analysis_state?.leader_claim.permitted).toBe(false);
    expect(out.analysis_state?.leader_claim.separation).toBe('near_tie');
    expect(out.blocks[0]).toMatchObject({ leading_option_id: null, win_probabilities: { 'option-a': 0.65 } });
  });

  it('keeps true no-run and no-fact-context compatibility paths distinct', () => {
    expect(finalise([]).analysis_state?.run_state.kind).toBe('never_run');
    const legacyCaller = finaliseV5Response(response(fact()), {
      freshness: deriveAnalysisFreshness([fact()], HASH), mayNameLeadingOption: true,
    });
    // This caller is not adopted into the binding check; no new C2 guarantee.
    expect(legacyCaller.analysis_state?.run_state.kind).toBe('complete_current');
    expect(legacyCaller.analysis_state?.leader_claim.permitted).toBe(true);
  });

  it.each(['refused', 'blocked', 'running'] as const)('does not replace a known %s lifecycle with an identity failure', (kind) => {
    const run = fact();
    const freshness = {
      ...deriveAnalysisFreshness([run], HASH),
      ...(kind === 'refused' ? { refusal_declared: true as const } : {}),
    };
    const readiness = kind === 'blocked' ? { status: 'blocked' as const, blocked_reason: 'fixture_blocker' } : undefined;
    const state = composeAnalysisStateV1({
      canonical: canonicalStateFromFreshness(freshness, { readiness }),
      freshness, readiness, mayNameLeadingOption: true, rawRobustness: null,
      runFactBinding: { scenarioId: OTHER_SCENARIO, selectedResult: run.result },
      ...(kind === 'running' ? { autoRunInFlight: { startedAt: NEXT_TIME } } : {}),
    });
    expect(state?.run_state.kind).toBe(kind);
    expect(state?.leader_claim.permitted).toBe(false);
  });

  it('re-finalises the same supplied fact without changing its interpretation fields', () => {
    const original = fact();
    const ctx = { scenarioId: SCENARIO, priorFacts: [original], freshness: deriveAnalysisFreshness([original], HASH), mayNameLeadingOption: true };
    const first = finaliseV5Response(response(original), ctx);
    const repeated = finaliseV5Response(first, ctx);
    expect(repeated.analysis_state).toEqual(first.analysis_state);
    expect(repeated.blocks).toEqual(first.blocks);
    expect(original.result.computed_at).toBe(FIRST_TIME);
    // Equality here does not establish request idempotency or DB durability.
  });
});
