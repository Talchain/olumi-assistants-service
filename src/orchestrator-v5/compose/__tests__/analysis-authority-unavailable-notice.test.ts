import { describe, expect, it } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import {
  ANALYSIS_AUTHORITY_UNAVAILABLE_FRESHNESS,
  ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE,
  enforceAnalysisAuthorityUnavailableAtEgress,
} from '../analysis-authority-unavailable-notice.js';

function response(assistantText: string): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  };
}

describe('analysis-authority unavailable disclosure', () => {
  it('replaces contradictory substantive prose rather than appending to it', () => {
    const projected = enforceAnalysisAuthorityUnavailableAtEgress(
      response('No analysis has run yet.'),
      { answerKind: 'substantive', egressOk: true },
    );

    expect(projected.mode).toBe('substantive_replaced');
    expect(projected.response.assistant_text).toBe(ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE);
    expect(projected.response.assistant_text.toLowerCase()).not.toContain('you have not run');
    expect(projected.response.assistant_text.toLowerCase()).not.toContain('no analysis');
  });

  it.each(['substantive', undefined] as const)(
    'replaces clean arbitrary prose when answerKind is %s',
    (answerKind) => {
      const projected = enforceAnalysisAuthorityUnavailableAtEgress(
        response('I can still help refine the model.'),
        { answerKind, egressOk: true },
      );

      expect(projected.mode).toBe('substantive_replaced');
      expect(projected.response.assistant_text).toBe(
        ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE,
      );
    },
  );

  it('replaces the entire substantive answer surface, not assistant text alone', () => {
    const stale = {
      ...response('A stale leader still wins.'),
      blocks: [
        {
          type: 'analysis_result',
          summary: 'STALE_BLOCK_CANARY',
        },
      ],
      suggested_actions: [
        { id: 'stale-action', label: 'STALE_ACTION_CANARY' },
      ],
      insights: [{ id: 'stale-insight', text: 'STALE_INSIGHT_CANARY' }],
      framing_question: 'STALE_FRAMING_CANARY',
      reasoning: 'STALE_REASONING_CANARY',
    } as unknown as OlumiResponse;

    const projected = enforceAnalysisAuthorityUnavailableAtEgress(stale, {
      answerKind: 'substantive',
      egressOk: true,
    });

    expect(projected.response).toEqual({
      response_version: 2,
      assistant_text: ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE,
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse',
    });
    expect(JSON.stringify(projected.response)).not.toContain('STALE_');
  });

  it('uses the existing unknown/derivation_failed representation', () => {
    expect(ANALYSIS_AUTHORITY_UNAVAILABLE_FRESHNESS).toEqual({
      freshness: 'unknown',
      reason: 'derivation_failed',
      selected_fact_index: null,
      graph_hash_at_run: null,
      current_graph_hash: null,
      computed_at: null,
    });
  });

  it('appends the notice to functional copy and preserves every other field', () => {
    const original = response('Renamed Growth to Sustainable growth.');
    const projected = enforceAnalysisAuthorityUnavailableAtEgress(
      original,
      { answerKind: 'functional', egressOk: true },
    );
    const { assistant_text: originalText, ...originalStructured } = original;
    const {
      assistant_text: projectedText,
      ...projectedStructured
    } = projected.response;

    expect(projected.mode).toBe('functional_preserved');
    expect(projectedText).toBe(
      `${originalText}\n\n${ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE}`,
    );
    expect(projectedStructured).toEqual(originalStructured);
  });

  it('is idempotent for a functional response', () => {
    const first = enforceAnalysisAuthorityUnavailableAtEgress(
      response('Continue with the model.'),
      { answerKind: 'functional', egressOk: true },
    );
    const second = enforceAnalysisAuthorityUnavailableAtEgress(
      first.response,
      { answerKind: 'functional', egressOk: true },
    );

    expect(second.mode).toBe('functional_preserved');
    expect(second.response.assistant_text).toBe(first.response.assistant_text);
    expect(second.response.assistant_text.split(ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE)).toHaveLength(2);
  });

  it('preserves the typed egress fallback regardless of the upstream answer kind', () => {
    const fallback = response('The server produced an invalid response.');
    const projected = enforceAnalysisAuthorityUnavailableAtEgress(
      fallback,
      { answerKind: 'substantive', egressOk: false },
    );

    expect(projected.mode).toBe('egress_fallback_preserved');
    expect(projected.response.assistant_text).toBe(
      `The server produced an invalid response.\n\n${ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE}`,
    );
    expect(projected.response.blocks).toEqual(fallback.blocks);
  });
});
