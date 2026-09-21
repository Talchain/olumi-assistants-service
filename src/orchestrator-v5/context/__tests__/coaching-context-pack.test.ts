/**
 * Coaching Context Pack v1 — pack redaction + source + assembler injection.
 *
 * Proves the pack is exactly the agreed Tier-1 fields, pinned to the live
 * `deriveAnalysisFreshness` verdict, and carries NO hashes / indices / values /
 * units / labels / free text. Also proves the assembler surfaces it as
 * `coaching_context` only when supplied (flag-off ⇒ field absent), and that the
 * pack validates against the canonical ContextPack schema.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalStateFromFreshness,
  summariseCoachingStatePack,
} from '../canonical-analysis-state.js';
import type { FreshnessDerivation } from '../freshness.js';
import { assembleContextPackWithSummary } from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

const HASH_AT_RUN = 'a1b2c3d4e5f60718';
const CURRENT_HASH = 'ffeeddccbbaa9988';
const COMPUTED_AT = '2026-06-23T10:00:00.000Z';

function staleFreshness(): FreshnessDerivation {
  return {
    freshness: 'stale',
    reason: 'graph_hash_diverged',
    selected_fact_index: 0,
    graph_hash_at_run: HASH_AT_RUN,
    current_graph_hash: CURRENT_HASH,
    computed_at: COMPUTED_AT,
  };
}

function freshFreshness(): FreshnessDerivation {
  return {
    freshness: 'fresh',
    reason: 'graph_hash_match',
    selected_fact_index: 0,
    graph_hash_at_run: HASH_AT_RUN,
    current_graph_hash: HASH_AT_RUN,
    computed_at: COMPUTED_AT,
  };
}

function noneFreshness(): FreshnessDerivation {
  return {
    freshness: 'none',
    reason: 'no_successful_run_analysis_fact',
    selected_fact_index: null,
    graph_hash_at_run: null,
    current_graph_hash: CURRENT_HASH,
    computed_at: null,
  };
}

const EXPECTED_KEYS = [
  'analysis_present',
  'freshness',
  'readiness_status',
  'rerun_required',
  'usable_for_prose',
  'usable_for_chips',
  'blocked',
  'actionable_blocker_count',
].sort();

describe('CoachingStatePack — Tier-1 fields, pinned to deriveAnalysisFreshness', () => {
  it('projects exactly the 8 agreed fields and nothing else', () => {
    const pack = summariseCoachingStatePack(
      canonicalStateFromFreshness(staleFreshness(), {
        readiness: { status: 'ready', blockers: [] },
      }),
    );
    expect(Object.keys(pack).sort()).toEqual(EXPECTED_KEYS);
  });

  it('freshness field equals the live deriveAnalysisFreshness verdict, verbatim', () => {
    for (const fd of [freshFreshness(), staleFreshness(), noneFreshness()]) {
      const pack = summariseCoachingStatePack(canonicalStateFromFreshness(fd));
      expect(pack.freshness).toBe(fd.freshness);
    }
  });

  it('stale verdict ⇒ rerun_required, not chip-usable; none ⇒ no analysis', () => {
    const stale = summariseCoachingStatePack(
      canonicalStateFromFreshness(staleFreshness(), {
        readiness: { status: 'ready', blockers: [] },
      }),
    );
    expect(stale.rerun_required).toBe(true);
    expect(stale.usable_for_chips).toBe(false);
    expect(stale.analysis_present).toBe(true);

    const none = summariseCoachingStatePack(canonicalStateFromFreshness(noneFreshness()));
    expect(none.analysis_present).toBe(false);
    expect(none.usable_for_chips).toBe(false);
  });

  it('carries NO hashes, indices, timestamps, values, units or labels', () => {
    const pack = summariseCoachingStatePack(
      canonicalStateFromFreshness(staleFreshness(), {
        readiness: { status: 'ready', blockers: [] },
      }),
    );
    const json = JSON.stringify(pack);
    expect(json).not.toContain(HASH_AT_RUN);
    expect(json).not.toContain(CURRENT_HASH);
    expect(json).not.toContain(COMPUTED_AT);
    // No long hex digest, no monetary value, no snake_case graph id leaked.
    expect(json).not.toMatch(/[0-9a-f]{12,}/i);
    expect(json).not.toMatch(/[£$€]/);
    // freshness_reason / selected_fact_index / contradiction_codes are NOT
    // projected (they live on the richer AnalysisStateSummary only).
    expect(json).not.toContain('graph_hash');
    expect(json).not.toContain('freshness_reason');
    expect(json).not.toContain('selected_fact_index');
  });
});

describe('assembleContextPack — coaching_context injection (flag-gated)', () => {
  const payload = makeMessagePayload({
    turn_id: 't-1',
    scenario_id: 'scen-1',
    message: 'what should I do?',
  });

  it('surfaces coaching_context when supplied; validates against the schema', () => {
    const pack = summariseCoachingStatePack(
      canonicalStateFromFreshness(staleFreshness(), {
        readiness: { status: 'ready', blockers: [] },
      }),
    );
    const { contextPack } = assembleContextPackWithSummary({
      payload,
      priorTurns: [],
      priorFacts: [],
      coachingContext: pack,
    });
    expect(contextPack.coaching_context).toEqual(pack);
    expect(ContextPackSchema.safeParse(contextPack).success).toBe(true);
  });

  it('omits coaching_context entirely when not supplied (flag-off shape)', () => {
    const { contextPack } = assembleContextPackWithSummary({
      payload,
      priorTurns: [],
      priorFacts: [],
    });
    expect('coaching_context' in contextPack).toBe(false);
    expect(contextPack.coaching_context).toBeUndefined();
    expect(ContextPackSchema.safeParse(contextPack).success).toBe(true);
  });
});
