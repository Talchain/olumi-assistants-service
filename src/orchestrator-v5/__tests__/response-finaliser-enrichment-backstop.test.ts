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

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
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
