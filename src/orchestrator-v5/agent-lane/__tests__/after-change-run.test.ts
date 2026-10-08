import { describe, expect, it } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { stampRunAnalysisProjection } from '../../context/analysis-projection-policy.js';
import { buildAutoRunProvenance, RUN_PROVENANCE_ENRICHMENT_KEY } from '../../context/run-initiator.js';
import { buildRunDelta } from '../../coaching/build-run-delta.js';
import {
  AFTER_CHANGE_RUN_CHIP_ID,
  afterChangeRunDecision,
  isAfterChangeRunChip,
} from '../after-change-run.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CURRENT_HASH = 'current-hash';
const PRIOR_HASH = 'prior-hash';

function runFact(input: {
  hash?: string;
  status?: string;
  computedAt?: string;
  seed?: string;
  wins?: readonly [number, number];
  provenance?: object;
} = {}): RunAnalysisHandlerFact {
  const wins = input.wins ?? [0.6, 0.4];
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      summary: 'Ran analysis on your current scenario.',
      computed_at: input.computedAt ?? '2026-10-08T09:00:00.000Z',
      ...(input.hash === undefined ? {} : { graph_hash_at_run: input.hash }),
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: stampRunAnalysisProjection({
        analysis_status: input.status ?? 'completed',
        results: [
          { option_id: 'opt-a', option_label: 'Option A', win_probability: wins[0] },
          { option_id: 'opt-b', option_label: 'Option B', win_probability: wins[1] },
        ],
        meta: { seed_used: input.seed ?? '111', n_samples: 10_000 },
        ...(input.provenance === undefined ? {} : { [RUN_PROVENANCE_ENRICHMENT_KEY]: input.provenance }),
      }),
    },
  };
}

describe('afterChangeRunDecision', () => {
  const staleFacts: readonly HandlerFact[] = [runFact({ hash: PRIOR_HASH })];
  const freshFacts: readonly HandlerFact[] = [runFact({ hash: CURRENT_HASH })];

  it.each([
    ['stale successful Run -> run', { currentGraphHash: CURRENT_HASH, priorFacts: staleFacts, priorFactsReadOk: true }, { kind: 'run' }],
    ['fresh successful Run -> already_current', { currentGraphHash: CURRENT_HASH, priorFacts: freshFacts, priorFactsReadOk: true }, { kind: 'skip', reason: 'already_current' }],
    ['no successful Run -> no_prior_run', { currentGraphHash: CURRENT_HASH, priorFacts: [runFact({ hash: PRIOR_HASH, status: 'degraded' })], priorFactsReadOk: true }, { kind: 'skip', reason: 'no_prior_run' }],
    ['failed prior-facts read -> freshness_unknown', { currentGraphHash: CURRENT_HASH, priorFacts: [], priorFactsReadOk: false }, { kind: 'skip', reason: 'freshness_unknown' }],
    ['failed prior-facts read with a stale fact -> freshness_unknown', { currentGraphHash: CURRENT_HASH, priorFacts: staleFacts, priorFactsReadOk: false }, { kind: 'skip', reason: 'freshness_unknown' }],
    ['base mismatch beats stale -> stale_view', { currentGraphHash: CURRENT_HASH, priorFacts: staleFacts, priorFactsReadOk: true, baseGraphHash: 'old-client-hash' }, { kind: 'skip', reason: 'stale_view' }],
    ['matching base and stale -> run', { currentGraphHash: CURRENT_HASH, priorFacts: staleFacts, priorFactsReadOk: true, baseGraphHash: CURRENT_HASH }, { kind: 'run' }],
    ['missing current hash -> no_graph', { currentGraphHash: null, priorFacts: staleFacts, priorFactsReadOk: true }, { kind: 'skip', reason: 'no_graph' }],
    ['base mismatch is checked before missing current hash -> stale_view', { currentGraphHash: null, priorFacts: staleFacts, priorFactsReadOk: true, baseGraphHash: CURRENT_HASH }, { kind: 'skip', reason: 'stale_view' }],
    ['unknown legacy Run hash -> freshness_unknown (kills !== fresh mutant)', { currentGraphHash: CURRENT_HASH, priorFacts: [runFact()], priorFactsReadOk: true }, { kind: 'skip', reason: 'freshness_unknown' }],
  ] as const)('%s', (_name, input, expected) => {
    expect(afterChangeRunDecision(input)).toEqual(expected);
  });
});

describe('isAfterChangeRunChip', () => {
  it.each([
    ['after-change id and run action', { chip: { id: AFTER_CHANGE_RUN_CHIP_ID, action_type: 'run_analysis' } }, true],
    ['after-change id with another action', { chip: { id: AFTER_CHANGE_RUN_CHIP_ID, action_type: 'explain_results' } }, false],
    ['ordinary Run chip', { chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } }, false],
    ['missing chip', {}, false],
    ['null body', null, false],
  ] as const)('%s', (_name, body, expected) => {
    expect(isAfterChangeRunChip(body)).toBe(expected);
  });
});

describe('after-change Runs remain user-initiated for run_delta pairing', () => {
  const draftAutoRun = runFact({
    hash: 'draft-hash',
    computedAt: '2026-10-08T08:00:00.000Z',
    provenance: buildAutoRunProvenance('draft-turn-abc'),
  });
  const firstAfterChangeRun = runFact({
    hash: 'run-one-hash',
    computedAt: '2026-10-08T09:00:00.000Z',
    seed: '222',
    wins: [0.55, 0.45],
  });
  const secondAfterChangeRun = runFact({
    hash: 'run-two-hash',
    computedAt: '2026-10-08T10:00:00.000Z',
    seed: '333',
    wins: [0.45, 0.55],
  });

  it('draft auto-Run + unstamped Run one + unstamped Run two -> comparison', () => {
    const result = buildRunDelta({
      priorFacts: [secondAfterChangeRun, firstAfterChangeRun, draftAutoRun],
      mayNameLeadingOption: true,
    });
    expect(result.kind).toBe('ok');
  });

  it('contrast: draft auto-Run + unstamped Run one -> unrequested_run_in_pair', () => {
    const result = buildRunDelta({
      priorFacts: [firstAfterChangeRun, draftAutoRun],
      mayNameLeadingOption: true,
    });
    expect(result).toEqual({ kind: 'none', reason: 'unrequested_run_in_pair' });
  });
});
