/**
 * `_context_summary` coaching-state opt-in — builder flag matrix.
 *
 * The redacted `coaching_state_pack` sub-block is double-gated: the route only
 * passes `includeCoachingState: true` when BOTH `contextSummaryEnabled` (the
 * enclosing diagnostic) AND `coachingStatePackEnabled` are set. This proves the
 * builder's half of that contract:
 *   - opt-out (falsy / omitted) → `coaching_state_pack` key ABSENT;
 *   - opt-in → `coaching_state_pack` present + redacted (hash-free), with every
 *     other field byte-identical to the opt-out output.
 */
import { describe, it, expect } from 'vitest';

import { buildV5ContextSummary } from '../../src/orchestrator-v5/context/build-context-summary.js';
import {
  selectCanonicalAnalysisState,
  type ReadinessLike,
} from '../../src/orchestrator-v5/context/canonical-analysis-state.js';
import { computeAnalysisAffectingGraphHash } from '../../src/orchestrator-v5/context/graph-hash.js';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { GraphStateIngress } from '../../src/orchestrator-v5/boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const graph: GraphStateIngress = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [],
} as unknown as GraphStateIngress;

const HASH = computeAnalysisAffectingGraphHash(graph)!;
const READY: ReadinessLike = { status: 'ready', goal_node_id: 'goal', blockers: [] };

function freshFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: HASH,
      computed_at: '2026-04-30T01:00:00.000Z',
      enrichment: { analysis_status: 'computed' },
    },
  } as unknown as RunAnalysisHandlerFact;
}

function canonical() {
  return selectCanonicalAnalysisState({
    priorFacts: [freshFact() as HandlerFact],
    currentGraphHash: HASH,
    readiness: READY,
  });
}

describe('buildV5ContextSummary — coaching_state_pack opt-in', () => {
  it('omits coaching_state_pack when includeCoachingState is unset (pack flag off)', () => {
    const summary = buildV5ContextSummary({ canonicalState: canonical() });
    expect('coaching_state_pack' in (summary as unknown as Record<string, unknown>)).toBe(false);
  });

  it('omits coaching_state_pack when includeCoachingState is false', () => {
    const summary = buildV5ContextSummary({ canonicalState: canonical(), includeCoachingState: false });
    expect('coaching_state_pack' in (summary as unknown as Record<string, unknown>)).toBe(false);
  });

  it('includes a redacted, hash-free coaching_state_pack when includeCoachingState is true', () => {
    const summary = buildV5ContextSummary({ canonicalState: canonical(), includeCoachingState: true });
    expect(summary.coaching_state_pack).toBeDefined();
    expect(summary.coaching_state_pack!.analysis_present).toBe(true);
    expect(summary.coaching_state_pack!.freshness).toBe('fresh');
    // No hash leak via the sub-block.
    expect(JSON.stringify(summary.coaching_state_pack)).not.toContain(HASH);
  });

  it('opt-in adds ONLY the coaching_state_pack key — every other field is identical to opt-out', () => {
    const state = canonical();
    const off = buildV5ContextSummary({ canonicalState: state, graphCounts: null });
    const on = buildV5ContextSummary({ canonicalState: state, graphCounts: null, includeCoachingState: true });
    const { coaching_state_pack: _omit, ...onWithoutCoaching } = on as typeof on & {
      coaching_state_pack?: unknown;
    };
    expect(onWithoutCoaching).toEqual(off);
  });
});

describe('buildV5ContextSummary — canonical_state_source provenance', () => {
  it('omits canonical_state_source when not threaded', () => {
    const summary = buildV5ContextSummary({ canonicalState: canonical() });
    expect('canonical_state_source' in (summary as unknown as Record<string, unknown>)).toBe(false);
  });

  it('records turn_executor provenance when threaded', () => {
    const summary = buildV5ContextSummary({
      canonicalState: canonical(),
      canonicalStateSource: 'turn_executor',
    });
    expect(summary.canonical_state_source).toBe('turn_executor');
  });

  it('records route_fallback provenance when threaded', () => {
    const summary = buildV5ContextSummary({
      canonicalState: canonical(),
      canonicalStateSource: 'route_fallback',
    });
    expect(summary.canonical_state_source).toBe('route_fallback');
  });
});
