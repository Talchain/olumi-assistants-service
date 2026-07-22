/**
 * Capability layer P0 — lens-suggestion coaching-block emitter tests
 * (ROADMAP 1.183).
 *
 * Proves the emitted block:
 *   - parses against the VENDORED (0.21.0) `CoachingBlockSchema` (strict) —
 *     the egress wire-surface pin; it rides the existing coaching block with
 *     ONLY 0.21-present fields, no new wire fields;
 *   - is `coaching_kind: 'strengthen'`, `source: 'deterministic_signal'`
 *     (honest provenance), with NO `action_intent` / `action_label` (the P0
 *     no-inert-chip rule) and the strengthen guidance signals;
 *   - fires EXACTLY ONE frozen-manifest telemetry event, only on emission,
 *     carrying the lens id + rationale code and NO user text;
 *   - is stable per (lens, graph_hash) for UI dedupe;
 *   - returns null (and emits nothing) when the selector recommends nothing.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { setTestSink } from '../../../utils/telemetry.js';
import { buildLensSuggestionCoachingBlock, type BlockBuildCtx } from '../phase3-blocks.js';

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';
const CTX: BlockBuildCtx = {
  created_at: '2026-07-22T15:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

interface SinkEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}
let sink: SinkEvent[] = [];

beforeEach(() => {
  sink = [];
  setTestSink((event, data) => {
    sink.push({ event, data });
  });
});
afterEach(() => {
  setTestSink(null);
});

// A fact that trips the sensitivity lens (a dominant driver).
function dominantDriverFact(graphHash = GRAPH_HASH): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: graphHash,
      enrichment: {
        confidence_tier: 'strong',
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.15, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_c', influence_score: 0.05, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

// A healthy fact — the selector recommends nothing.
function healthyFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        confidence_tier: 'strong',
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

describe('buildLensSuggestionCoachingBlock', () => {
  it('emits a schema-valid strengthen coaching block (egress wire-surface pin)', () => {
    const block = buildLensSuggestionCoachingBlock(dominantDriverFact(), CTX);
    expect(block).not.toBeNull();
    // Strict parse against the VENDORED 0.21.0 schema — proves no unknown field
    // rides the wire and every field is 0.21-present.
    const parsed = CoachingBlockSchema.safeParse(block);
    expect(parsed.success).toBe(true);
  });

  it('is a deterministic_signal-sourced strengthen card with NO inert chip', () => {
    const block = buildLensSuggestionCoachingBlock(dominantDriverFact(), CTX)!;
    expect(block.type).toBe('coaching');
    expect(block.coaching_kind).toBe('strengthen');
    // Honest provenance: derived from analysis signals, not the LLM review pass.
    expect(block.source).toBe('deterministic_signal');
    // The P0 no-inert-chip rule: no on-card action affordance.
    expect(block.action_intent).toBeUndefined();
    expect(block.action_label).toBeUndefined();
    expect(block.priority_rank).toBe(15);
    // Strengthen guidance signals (producer-owned).
    expect(block.category).toBe('could_fix');
    expect(block.signal_code).toBe('STRENGTHEN_ITEM');
    expect(block.title.length).toBeGreaterThan(0);
    expect(block.body.length).toBeGreaterThan(0);
  });

  it('fires exactly one frozen-manifest telemetry event on emission (no user text)', () => {
    buildLensSuggestionCoachingBlock(dominantDriverFact(), CTX);
    const events = sink.filter((e) => e.event === 'v5.capability.lens_suggestion_emitted');
    expect(events).toHaveLength(1);
    expect(events[0]!.data.lens_id).toBe('sensitivity_flip_risk');
    expect(events[0]!.data.rationale_code).toBe('DOMINANT_DRIVER');
    // Payload carries only the closed enums + graph hash — never the card prose.
    const payloadValues = Object.values(events[0]!.data).map(String).join(' ');
    expect(payloadValues).not.toContain('Strengthen your model');
  });

  it('returns null and emits NOTHING when the selector recommends nothing', () => {
    const block = buildLensSuggestionCoachingBlock(healthyFact(), CTX);
    expect(block).toBeNull();
    expect(sink.filter((e) => e.event === 'v5.capability.lens_suggestion_emitted')).toHaveLength(0);
  });

  it('keeps a stable block_id / signal_id per (lens, graph_hash) for dedupe', () => {
    const a = buildLensSuggestionCoachingBlock(dominantDriverFact(), CTX)!;
    const b = buildLensSuggestionCoachingBlock(dominantDriverFact(), CTX)!;
    expect(a.signal_id).toBe(b.signal_id);
    expect(a.block_id).toBe(b.block_id);
    // Different graph hash → different identity.
    const c = buildLensSuggestionCoachingBlock(
      dominantDriverFact('gh_different000000002'),
      { ...CTX, graph_hash_at_generation: 'gh_different000000002' },
    )!;
    expect(c.signal_id).not.toBe(a.signal_id);
  });
});
