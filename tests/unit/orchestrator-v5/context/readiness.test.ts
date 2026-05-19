import { describe, it, expect } from 'vitest';
import type {
  HandlerFact,
  RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';

import { deriveContextReadiness } from '../../../../src/orchestrator-v5/context/readiness.js';
import type { EnrichedTurnContext } from '../../../../src/orchestrator-v5/build-turn-context.js';
import type { FreshnessDerivation } from '../../../../src/orchestrator-v5/context/freshness.js';

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const HASH_OLD = 'aaaaaaaaaaaaaaaa';
const HASH_NEW = 'bbbbbbbbbbbbbbbb';
const COMPUTED_AT = '2026-05-09T10:00:00.000Z';

function makeRunAnalysisFact(
  graph_hash_at_run: string,
  options: { decisionReview?: unknown } = {},
): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Option A leads.',
      win_probabilities: { opt_a: 0.64, opt_b: 0.36 },
      graph_hash_at_run,
      computed_at: COMPUTED_AT,
      ...(options.decisionReview !== undefined
        ? { enrichment: { decision_review: options.decisionReview } }
        : {}),
    } as unknown as RunAnalysisHandlerFact['result'],
  };
}

interface MakeContextInput {
  readonly persistedGraph?: unknown;
  readonly scenarioBriefText?: string | null;
  readonly prior_facts?: readonly HandlerFact[];
  readonly most_recent_pending_actions?: readonly unknown[];
}

function makeContext(input: MakeContextInput = {}): EnrichedTurnContext {
  return {
    prior_turns: [],
    prior_facts: input.prior_facts ?? [],
    prior_facts_with_turn: [],
    scenarioBriefText: input.scenarioBriefText ?? null,
    persistedGraph: input.persistedGraph ?? null,
    most_recent_pending_actions: input.most_recent_pending_actions ?? [],
  } as unknown as EnrichedTurnContext;
}

function makeFreshness(
  overrides: Partial<FreshnessDerivation> = {},
): FreshnessDerivation {
  return {
    freshness: 'none',
    reason: 'no_successful_run_analysis_fact',
    selected_fact_index: null,
    graph_hash_at_run: null,
    current_graph_hash: null,
    computed_at: null,
    ...overrides,
  };
}

describe('deriveContextReadiness', () => {
  it('returns has_run_analysis_fact=true and freshness=fresh for a fresh fact', () => {
    const priorFacts = [makeRunAnalysisFact(HASH_NEW)];
    const readiness = deriveContextReadiness({
      context: makeContext({ prior_facts: priorFacts }),
      freshness: makeFreshness({
        freshness: 'fresh',
        reason: 'graph_hash_match',
        selected_fact_index: 0,
        graph_hash_at_run: HASH_NEW,
        current_graph_hash: HASH_NEW,
        computed_at: COMPUTED_AT,
      }),
      recentChangeCount: 0,
      contextPackChars: 4321,
    });
    expect(readiness.has_run_analysis_fact).toBe(true);
    expect(readiness.latest_analysis_freshness).toBe('fresh');
    expect(readiness.latest_analysis_graph_hash).toBe(HASH_NEW);
    expect(readiness.current_graph_hash).toBe(HASH_NEW);
  });

  it('returns has_run_analysis_fact=true and freshness=stale when hashes diverge', () => {
    const priorFacts = [makeRunAnalysisFact(HASH_OLD)];
    const readiness = deriveContextReadiness({
      context: makeContext({ prior_facts: priorFacts }),
      freshness: makeFreshness({
        freshness: 'stale',
        reason: 'graph_hash_diverged',
        selected_fact_index: 0,
        graph_hash_at_run: HASH_OLD,
        current_graph_hash: HASH_NEW,
        computed_at: COMPUTED_AT,
      }),
      recentChangeCount: 1,
      contextPackChars: 5000,
    });
    expect(readiness.has_run_analysis_fact).toBe(true);
    expect(readiness.latest_analysis_freshness).toBe('stale');
    expect(readiness.latest_analysis_graph_hash).toBe(HASH_OLD);
  });

  it('returns has_run_analysis_fact=false and freshness=none for empty fact chain', () => {
    const readiness = deriveContextReadiness({
      context: makeContext(),
      freshness: makeFreshness(),
      recentChangeCount: 0,
      contextPackChars: null,
    });
    expect(readiness.has_run_analysis_fact).toBe(false);
    expect(readiness.latest_analysis_freshness).toBe('none');
    expect(readiness.latest_analysis_graph_hash).toBeNull();
  });

  it('reflects graph presence and counts from persistedGraph', () => {
    const readiness = deriveContextReadiness({
      context: makeContext({
        persistedGraph: {
          nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
          edges: [{ from: 'a', to: 'b' }],
        },
      }),
      freshness: makeFreshness(),
      recentChangeCount: 0,
      contextPackChars: 100,
    });
    expect(readiness.graph_present).toBe(true);
    expect(readiness.graph_node_count).toBe(3);
    expect(readiness.graph_edge_count).toBe(1);
  });

  it('reports graph_present=false when persistedGraph is null or empty', () => {
    const r1 = deriveContextReadiness({
      context: makeContext({ persistedGraph: null }),
      freshness: makeFreshness(),
      recentChangeCount: 0,
      contextPackChars: 100,
    });
    expect(r1.graph_present).toBe(false);
    expect(r1.graph_node_count).toBe(0);
    expect(r1.graph_edge_count).toBe(0);

    const r2 = deriveContextReadiness({
      context: makeContext({ persistedGraph: { nodes: [], edges: [] } }),
      freshness: makeFreshness(),
      recentChangeCount: 0,
      contextPackChars: 100,
    });
    expect(r2.graph_present).toBe(false);
  });

  it('reflects brief_present from scenarioBriefText (trimmed non-empty)', () => {
    const r1 = deriveContextReadiness({
      context: makeContext({ scenarioBriefText: 'Decision brief' }),
      freshness: makeFreshness(),
      recentChangeCount: 0,
      contextPackChars: 100,
    });
    expect(r1.brief_present).toBe(true);

    const r2 = deriveContextReadiness({
      context: makeContext({ scenarioBriefText: '   ' }),
      freshness: makeFreshness(),
      recentChangeCount: 0,
      contextPackChars: 100,
    });
    expect(r2.brief_present).toBe(false);

    const r3 = deriveContextReadiness({
      context: makeContext({ scenarioBriefText: null }),
      freshness: makeFreshness(),
      recentChangeCount: 0,
      contextPackChars: 100,
    });
    expect(r3.brief_present).toBe(false);
  });

  it('phase3_block_context_available is true only when decision_review is non-null on the selected fact', () => {
    const withReview = deriveContextReadiness({
      context: makeContext({
        prior_facts: [makeRunAnalysisFact(HASH_NEW, { decisionReview: { summary: 'x' } })],
      }),
      freshness: makeFreshness({
        freshness: 'fresh',
        reason: 'graph_hash_match',
        selected_fact_index: 0,
        graph_hash_at_run: HASH_NEW,
        current_graph_hash: HASH_NEW,
        computed_at: COMPUTED_AT,
      }),
      recentChangeCount: 0,
      contextPackChars: 100,
    });
    expect(withReview.phase3_block_context_available).toBe(true);

    const withoutReview = deriveContextReadiness({
      context: makeContext({
        prior_facts: [makeRunAnalysisFact(HASH_NEW)],
      }),
      freshness: makeFreshness({
        freshness: 'fresh',
        reason: 'graph_hash_match',
        selected_fact_index: 0,
        graph_hash_at_run: HASH_NEW,
        current_graph_hash: HASH_NEW,
        computed_at: COMPUTED_AT,
      }),
      recentChangeCount: 0,
      contextPackChars: 100,
    });
    expect(withoutReview.phase3_block_context_available).toBe(false);

    const withNullReview = deriveContextReadiness({
      context: makeContext({
        prior_facts: [makeRunAnalysisFact(HASH_NEW, { decisionReview: null })],
      }),
      freshness: makeFreshness({
        freshness: 'fresh',
        reason: 'graph_hash_match',
        selected_fact_index: 0,
        graph_hash_at_run: HASH_NEW,
        current_graph_hash: HASH_NEW,
        computed_at: COMPUTED_AT,
      }),
      recentChangeCount: 0,
      contextPackChars: 100,
    });
    expect(withNullReview.phase3_block_context_available).toBe(false);
  });

  it('passes through recent_change_count and context_pack_chars', () => {
    const readiness = deriveContextReadiness({
      context: makeContext(),
      freshness: makeFreshness(),
      recentChangeCount: 3,
      contextPackChars: 9876,
    });
    expect(readiness.recent_change_count).toBe(3);
    expect(readiness.context_pack_chars).toBe(9876);
  });

  it('all non-routing fields are number/boolean/null or the freshness enum (privacy contract)', () => {
    const readiness = deriveContextReadiness({
      context: makeContext({
        persistedGraph: { nodes: [{ id: 'a' }], edges: [] },
        scenarioBriefText: 'brief',
        prior_facts: [makeRunAnalysisFact(HASH_NEW)],
      }),
      freshness: makeFreshness({
        freshness: 'fresh',
        reason: 'graph_hash_match',
        selected_fact_index: 0,
        graph_hash_at_run: HASH_NEW,
        current_graph_hash: HASH_NEW,
        computed_at: COMPUTED_AT,
      }),
      recentChangeCount: 2,
      contextPackChars: 1000,
    });

    const allowedFreshness = new Set(['fresh', 'stale', 'unknown', 'none']);
    for (const [key, value] of Object.entries(readiness)) {
      const t = typeof value;
      const ok =
        value === null
        || t === 'number'
        || t === 'boolean'
        || (t === 'string'
          && (key === 'latest_analysis_freshness'
            ? allowedFreshness.has(value as string)
            : key === 'latest_analysis_graph_hash' || key === 'current_graph_hash'));
      expect(ok, `${key}: ${String(value)} (${t})`).toBe(true);
    }
  });
});
