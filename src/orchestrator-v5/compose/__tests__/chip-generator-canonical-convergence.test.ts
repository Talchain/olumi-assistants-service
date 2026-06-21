/**
 * M2 — chip-floor / freshness convergence with the canonical analysis state.
 *
 * Proves the chip generator, when threaded the canonical state, derives
 * fact-presence + freshness from the SINGLE composed verdict (unified
 * current+prior facts) so the floor and `deriveAnalysisFreshness` cannot
 * disagree — and that when `canonicalState` is omitted, behaviour is
 * byte-identical to the prior local-expression path.
 *
 * Live activation (turn-executor threading the canonical state) lands in
 * M5 post-#287; this proves the mechanism in-process.
 */
import { describe, it, expect } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  generateChips,
  deriveProjectionStatus,
  type ChipGeneratorInput,
} from '../chip-generator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import {
  selectCanonicalAnalysisState,
  type ReadinessLike,
} from '../../context/canonical-analysis-state.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { TurnOutcome } from '../../turn-outcome.js';
import type { ContextPackAnalysis } from '../../context/context-pack-assembler.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// A populated analysis projection — in production the assembler fills this
// from the prior run_analysis fact, so the analyse-stage "no analysis yet"
// rule skips and the floor (the convergence target) is reached.
function analysisAt(band: string): ContextPackAnalysis {
  return {
    status: 'complete',
    leading_option: { label: 'Option A', probability: 0.6 },
    runner_up: { label: 'Option B', probability: 0.4 },
    margin_pp: 20,
    robustness_band: band,
    top_drivers: [],
    fragile_edges: [],
  };
}

const REGISTRY = HANDLER_VALIDATION_REGISTRY;
const SCENARIO_ID = '00000000-0000-4000-8000-000000000001';

function runAnalysisFact(
  opts: { graph_hash_at_run?: string; computed_at?: string; status?: string } = {},
): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = { analysis_status: opts.status ?? 'computed' };
  const result: RunAnalysisHandlerFact['result'] = {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt-a',
    summary: 'Prior run',
    enrichment,
  };
  if (opts.graph_hash_at_run) result.graph_hash_at_run = opts.graph_hash_at_run;
  if (opts.computed_at) result.computed_at = opts.computed_at;
  return { fact_type: 'run_analysis', fact_version: 1, noop: false, result };
}

function setFactorFact(): HandlerFact {
  return { fact_type: 'set_factor_value', fact_version: 1, noop: false, result: {} } as HandlerFact;
}

function chain(...facts: HandlerFact[]): readonly HandlerFact[] {
  return [...facts].reverse();
}

const baseGraph: GraphStateIngress = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'budget', kind: 'factor', label: 'Budget', observed_state: { value: 100 } },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [{ from: 'budget', to: 'goal' }],
} as unknown as GraphStateIngress;

const editedGraph: GraphStateIngress = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'budget', kind: 'factor', label: 'Budget', observed_state: { value: 250 } },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [{ from: 'budget', to: 'goal' }],
} as unknown as GraphStateIngress;

const HASH_A = computeAnalysisAffectingGraphHash(baseGraph)!;
const HASH_B = computeAnalysisAffectingGraphHash(editedGraph)!;
const READY: ReadinessLike = { status: 'ready', goal_node_id: 'goal', blockers: [] };
const READY_PAYLOAD = { status: 'ready', options: [], goal_node_id: 'goal' } as ChipGeneratorInput['analysisReady'];
const PRIOR_RUN = '2026-04-30T01:00:00.000Z';

describe('chip floor — canonical convergence', () => {
  it('C1: fresh prior analysis reaching the floor → exploration prompt (usable)', () => {
    const priorFacts = chain(runAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: PRIOR_RUN }));
    const canonicalState = selectCanonicalAnalysisState({ priorFacts, currentGraphHash: HASH_A, readiness: READY });
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      priorFacts,
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: READY_PAYLOAD,
      canonicalState,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].id).toBe('chip_prompt_floor_post_analysis_explore');
    // NOT a "run analysis" / "set values" chip — the analysis is usable.
    expect(chips[0].action_type).toBeUndefined();
  });

  it('C2: stale analysis → rerun prompt, never the explore chip', () => {
    const priorFacts = chain(runAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: PRIOR_RUN }));
    const canonicalState = selectCanonicalAnalysisState({ priorFacts, currentGraphHash: HASH_B, readiness: READY });
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      priorFacts,
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: READY_PAYLOAD,
      canonicalState,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].id).toBe('chip_prompt_floor_rerun_analysis');
  });

  it('C3: no analysis fact + ready → executable run_analysis chip', () => {
    const canonicalState = selectCanonicalAnalysisState({ priorFacts: [], currentGraphHash: HASH_A, readiness: READY });
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      priorFacts: [],
      validationRegistry: REGISTRY,
      analysisReady: READY_PAYLOAD,
      canonicalState,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
  });

  it('convergence: canonical state is authoritative over a misleading turnOutcome', () => {
    // The documented split: the run_analysis fact is real + fresh, but a
    // turnOutcome derived from priorFacts-only could carry 'none'. With the
    // canonical state threaded, the floor trusts it — not the stale signal.
    const priorFacts = chain(runAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: PRIOR_RUN }));
    const misleadingTurnOutcome: TurnOutcome = {
      graph_mutated: false,
      analysis_run: false,
      analysis_selected_fact_index: null,
      analysis_freshness: 'none',
      freshness_reason: 'no_successful_run_analysis_fact',
    };
    const canonicalState = selectCanonicalAnalysisState({ priorFacts, currentGraphHash: HASH_A, readiness: READY });
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [],
      priorFacts,
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: READY_PAYLOAD,
      turnOutcome: misleadingTurnOutcome,
      canonicalState,
    });
    // Canonical 'fresh' wins → explore, not a "set values / run" recovery.
    expect(chips[0].id).toBe('chip_prompt_floor_post_analysis_explore');
  });

  it('C4 equivalence: absent canonicalState (correct turnOutcome) === present canonicalState', () => {
    const priorFacts = chain(runAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: PRIOR_RUN }));
    const base = {
      stage: 'analyse' as const,
      handlerFacts: [] as HandlerFact[],
      priorFacts,
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
      analysisReady: READY_PAYLOAD,
    };
    const freshTurnOutcome: TurnOutcome = {
      graph_mutated: false,
      analysis_run: false,
      analysis_selected_fact_index: 0,
      analysis_freshness: 'fresh',
      freshness_reason: 'graph_hash_match',
    };
    const withoutCanonical = generateChips({ ...base, turnOutcome: freshTurnOutcome });
    const withCanonical = generateChips({
      ...base,
      canonicalState: selectCanonicalAnalysisState({ priorFacts, currentGraphHash: HASH_A, readiness: READY }),
    });
    expect(withCanonical).toEqual(withoutCanonical);
  });
});

describe('generateChipsRaw post-mutation rule — canonical convergence', () => {
  it('mutation this turn + stale prior analysis → "Run analysis again"', () => {
    const priorFacts = chain(runAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: PRIOR_RUN }));
    const handlerFacts = [setFactorFact()];
    // The mutation invalidated the prior run → stale (HASH_A run vs HASH_B now).
    const canonicalState = selectCanonicalAnalysisState({
      handlerFacts,
      priorFacts,
      currentGraphHash: HASH_B,
      readiness: READY,
    });
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts,
      priorFacts,
      validationRegistry: REGISTRY,
      analysisReady: READY_PAYLOAD,
      canonicalState,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].id).toBe('chip_action_rerun_analysis_after_mutation');
    expect(chips[0].action_type).toBe('run_analysis');
  });

  it('mutation this turn + NO prior analysis → executable run_analysis chip', () => {
    const handlerFacts = [setFactorFact()];
    const canonicalState = selectCanonicalAnalysisState({
      handlerFacts,
      priorFacts: [],
      currentGraphHash: HASH_B,
      readiness: READY,
    });
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts,
      priorFacts: [],
      validationRegistry: REGISTRY,
      analysisReady: READY_PAYLOAD,
      canonicalState,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
  });
});

describe('deriveProjectionStatus agreement with the canonical selector (no drift)', () => {
  it('facts_absent ⟺ selected_fact_index === null', () => {
    const none = selectCanonicalAnalysisState({ priorFacts: [], currentGraphHash: HASH_A, readiness: READY });
    expect(deriveProjectionStatus([], null, []) === 'facts_absent').toBe(none.selected_fact_index === null);
  });

  it('facts present ⟺ usableForFollowupContext (no blocking contradiction)', () => {
    const priorFacts = chain(runAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: PRIOR_RUN }));
    const state = selectCanonicalAnalysisState({ priorFacts, currentGraphHash: HASH_A, readiness: READY });
    expect(deriveProjectionStatus([], null, priorFacts) !== 'facts_absent').toBe(state.usableForFollowupContext);
  });
});
