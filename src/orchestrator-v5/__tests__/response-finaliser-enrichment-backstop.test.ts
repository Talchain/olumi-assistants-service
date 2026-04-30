/**
 * Phase 1 / Commit 6 of analysis-enrichment-critique-prose-safety.
 *
 * Defensive second-pass test for the response-finaliser's enrichment
 * sanitisation backstop. The decision-review enricher is the primary
 * scrub site (Commit 5); this backstop covers any future enrichment
 * producer that bypasses the enricher (cached blocks, fallback
 * composers, future analysis_result variants).
 *
 * Gating contract:
 *   - CEE_TURN_DEBUG_ENABLED=false (default) → enrichment is sanitised
 *   - CEE_TURN_DEBUG_ENABLED=true            → enrichment passes verbatim
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { finaliseV5Response } from '../response-finaliser.js';
import { config } from '../../config/index.js';
import type { CritiqueLike } from '../compose/sanitise-enrichment.js';

const ANALYSIS_READY_STUB = {
  status: 'ready' as const,
  goal_node_id: 'goal_test',
  options: [
    { option_id: 'opt_a', label: 'Option A', status: 'ready' as const, interventions: {} },
    { option_id: 'opt_b', label: 'Option B', status: 'ready' as const, interventions: {} },
  ],
};

function makeResponseWithLeakedEnrichment(): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: 'ok',
    blocks: [
      {
        type: 'analysis_result',
        enrichment: {
          critiques: [
            {
              id: 'c1',
              // No code → fail-safe routes to bucket D
              severity: 'info',
              source: 'preprocessing',
              message:
                "Node 'opt_a' has kind='option'. Option nodes are filtered before analysis.",
            },
          ],
          summary: 'opt_a is the leading option.',
          payloads: { isl_request: { secret: 'preserved verbatim' } },
        } as Record<string, unknown>,
      } as never,
    ],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  } as OlumiResponse;
}

describe('response-finaliser — enrichment-prose backstop', () => {
  let originalDebug: boolean | undefined;

  beforeEach(() => {
    // Snapshot the existing config flag so we can mutate within tests.
    originalDebug = config.cee?.turnDebugEnabled;
  });

  afterEach(() => {
    if (config.cee && originalDebug !== undefined) {
      // restore original value
      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = originalDebug;
    }
  });

  it('sanitises enrichment.critiques and resolves IDs in summary when debug=false', () => {
    if (config.cee) {
      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = false;
    }
    const out = finaliseV5Response(makeResponseWithLeakedEnrichment(), {
      analysisReady: ANALYSIS_READY_STUB,
    });
    const block = (out.blocks as Array<Record<string, unknown>>)[0]!;
    const enrichment = block.enrichment as Record<string, unknown>;
    // bucket-D critique routed away → user critiques empty
    const userCritiques = enrichment.critiques as CritiqueLike[];
    expect(userCritiques).toEqual([]);
    // summary IDs resolved via priority-2 (analysis_ready.options) lookup
    expect(enrichment.summary).toBe('Option A is the leading option.');
    // structural payloads byte-equal
    expect(enrichment.payloads).toEqual({ isl_request: { secret: 'preserved verbatim' } });
    // _diagnostics absent on the wire by default
    expect(enrichment._diagnostics).toBeUndefined();
  });

  it('preserves enrichment verbatim when debug=true (engineer surface)', () => {
    if (config.cee) {
      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = true;
    }
    const out = finaliseV5Response(makeResponseWithLeakedEnrichment(), {
      analysisReady: ANALYSIS_READY_STUB,
    });
    const block = (out.blocks as Array<Record<string, unknown>>)[0]!;
    const enrichment = block.enrichment as Record<string, unknown>;
    // Verbatim — original critique and summary preserved
    const userCritiques = enrichment.critiques as CritiqueLike[];
    expect(userCritiques).toHaveLength(1);
    expect(userCritiques[0]?.message).toMatch(/^Node 'opt_a'/);
    expect(enrichment.summary).toBe('opt_a is the leading option.');
  });

  it('runs sanitiser on review-cards-only enrichment (no critiques, no flat leaves) — Codex finding #2', () => {
    if (config.cee) {
      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = false;
    }
    const response: OlumiResponse = {
      response_version: 2,
      assistant_text: 'ok',
      blocks: [
        {
          type: 'analysis_result',
          enrichment: {
            // Deliberately NO critiques, NO summary/narrative/rationale/robustness_synthesis.
            // The previous cheap-gate would have skipped sanitisation entirely.
            review_cards: [
              {
                card_id: 'ep_x',
                what: "Node 'opt_a' has kind='option'. Option nodes are filtered before analysis.",
              },
            ],
            factor_sensitivity: [
              { node_id: 'fac_x', interpretation: "Node 'opt_b' has kind='option'." },
            ],
          } as Record<string, unknown>,
        } as never,
      ],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse',
    } as OlumiResponse;
    const out = finaliseV5Response(response, { analysisReady: ANALYSIS_READY_STUB });
    const block = (out.blocks as Array<Record<string, unknown>>)[0]!;
    const enrichment = block.enrichment as Record<string, unknown>;
    // Both contaminated prose leaves are deleted.
    const rc = (enrichment.review_cards as Array<Record<string, unknown>>);
    expect(rc[0]?.what).toBeUndefined();
    expect(rc[0]?.card_id).toBe('ep_x'); // structural preserved
    const fs = (enrichment.factor_sensitivity as Array<Record<string, unknown>>);
    expect(fs[0]?.interpretation).toBeUndefined();
    expect(fs[0]?.node_id).toBe('fac_x'); // structural preserved
  });

  it('runs sanitiser on improvement_guidance-only enrichment — Codex finding #2', () => {
    if (config.cee) {
      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = false;
    }
    const response: OlumiResponse = {
      response_version: 2,
      assistant_text: 'ok',
      blocks: [
        {
          type: 'analysis_result',
          enrichment: {
            improvement_guidance: [
              'Clean entry one.',
              "Node 'opt_x' has kind='option'.",
              'Clean entry two.',
            ],
          } as Record<string, unknown>,
        } as never,
      ],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse',
    } as OlumiResponse;
    const out = finaliseV5Response(response, { analysisReady: ANALYSIS_READY_STUB });
    const block = (out.blocks as Array<Record<string, unknown>>)[0]!;
    const enrichment = block.enrichment as Record<string, unknown>;
    const ig = enrichment.improvement_guidance as string[];
    expect(ig).toEqual(['Clean entry one.', 'Clean entry two.']);
  });

  it('no-op when no blocks have enrichment', () => {
    if (config.cee) {
      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = false;
    }
    const response: OlumiResponse = {
      response_version: 2,
      assistant_text: 'ok',
      blocks: [{ type: 'text', content: 'nothing to scrub' } as never],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'frame',
    } as OlumiResponse;
    const out = finaliseV5Response(response, { analysisReady: ANALYSIS_READY_STUB });
    expect(out.blocks).toEqual([{ type: 'text', content: 'nothing to scrub' }]);
  });
});
