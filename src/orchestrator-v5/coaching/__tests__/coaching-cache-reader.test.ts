import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { readCoachingCache } from '../coaching-cache-reader.js';
import {
  cappedScenarioAnalysisFactSet,
  completeScenarioAnalysisFactSet,
  degradedScenarioAnalysisFactSet,
} from '../../__tests__/support/scenario-analysis-fact-set.js';

function runAnalysisFact(
  scenarioId: string,
  enrichment?: Record<string, unknown>,
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: scenarioId,
      leading_option_id: 'opt-1',
      summary: 'done',
      ...(enrichment === undefined ? {} : { enrichment }),
    },
  };
}

function factSources(
  scenarioId: string,
  facts: readonly HandlerFact[],
  selectedIndex = facts.length === 0 ? -1 : 0,
) {
  const analysisFactSet = completeScenarioAnalysisFactSet(scenarioId, facts);
  return {
    analysisFactSet,
    selectedAnalysisFact:
      selectedIndex < 0 ? null : analysisFactSet.facts[selectedIndex] ?? null,
  };
}

describe('readCoachingCache', () => {
  it('returns an empty cache for complete durable zero', async () => {
    const scenarioId = randomUUID();
    await expect(
      readCoachingCache(scenarioId, factSources(scenarioId, [])),
    ).resolves.toEqual({
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    });
  });

  it.each(['capped', 'degraded', 'omitted', 'forged'] as const)(
    'fails weak when analysis authority is %s',
    async (status) => {
      const scenarioId = randomUUID();
      const fact = runAnalysisFact(scenarioId, {
        decision_review: {
          produced_at: '2026-04-20T12:00:00.000Z',
          narrative_summary: 'MUST_NOT_REACH_PROMPT',
        },
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'turn-must-not-reach-prompt',
        coaching_signal_produced_at: '2026-04-20T12:00:00.000Z',
      });
      const analysisFactSet =
        status === 'capped'
          ? cappedScenarioAnalysisFactSet(scenarioId, fact)
          : status === 'degraded'
            ? degradedScenarioAnalysisFactSet(scenarioId)
            : status === 'forged'
              ? ({
                  status: 'complete',
                  source: 'scenario',
                  facts: [fact],
                  total_count: 1,
                  newest_fact: fact,
                } as never)
              : undefined;

      const cache = await readCoachingCache(scenarioId, {
        selectedAnalysisFact: fact,
        ...(analysisFactSet === undefined ? {} : { analysisFactSet }),
      });
      expect(cache).toEqual({
        draft_coaching: null,
        decision_review: null,
        last_coaching_signal: null,
      });
    },
  );

  it('reads Decision Review only from the exact selected fact in the complete carrier', async () => {
    const scenarioId = randomUUID();
    const headReview = {
      produced_at: '2026-04-21T12:00:00.000Z',
      narrative_summary: 'DB_HEAD_REVIEW_MUST_NOT_REACH_PROMPT',
    };
    const selectedReview = {
      produced_at: '2026-04-20T12:00:00.000Z',
      narrative_summary: 'SELECTED_DISPLAY_REVIEW',
    };
    const sources = factSources(
      scenarioId,
      [
        runAnalysisFact(scenarioId, { decision_review: headReview }),
        runAnalysisFact(scenarioId, { decision_review: selectedReview }),
      ],
      1,
    );

    const cache = await readCoachingCache(scenarioId, sources);
    expect(cache.decision_review).toEqual(selectedReview);
  });

  it('does not substitute another review when the selected fact has none', async () => {
    const scenarioId = randomUUID();
    const sources = factSources(
      scenarioId,
      [
        runAnalysisFact(scenarioId, {
          decision_review: {
            produced_at: '2026-04-21T12:00:00.000Z',
            narrative_summary: 'UNSELECTED_REVIEW',
          },
        }),
        runAnalysisFact(scenarioId, { other: 'selected-without-review' }),
      ],
      1,
    );

    const cache = await readCoachingCache(scenarioId, sources);
    expect(cache.decision_review).toBeNull();
  });

  it('rejects a detached clone of the selected fact', async () => {
    const scenarioId = randomUUID();
    const fact = runAnalysisFact(scenarioId, {
      decision_review: {
        produced_at: '2026-04-21T12:00:00.000Z',
        narrative_summary: 'DETACHED_REVIEW_MUST_NOT_REACH_PROMPT',
      },
    });
    const analysisFactSet = completeScenarioAnalysisFactSet(scenarioId, [fact]);

    const cache = await readCoachingCache(scenarioId, {
      analysisFactSet,
      selectedAnalysisFact: fact,
    });
    expect(cache.decision_review).toBeNull();
  });

  it.each(['scenario_id', 'scenarioId', 'scenario-id', 'SCENARIO_ID'])(
    'withholds a Decision Review carrying nested scenario identity key %s',
    async (identityKey) => {
      const scenarioId = randomUUID();
      const foreignScenarioId = randomUUID();
      const sources = factSources(scenarioId, [
        runAnalysisFact(scenarioId, {
          decision_review: {
            produced_at: '2026-04-21T12:00:00.000Z',
            narrative_summary: 'FOREIGN_IDENTITY_REVIEW_MUST_NOT_REACH_PROMPT',
            nested: { source: { [identityKey]: foreignScenarioId } },
          },
        }),
      ]);

      const cache = await readCoachingCache(scenarioId, sources);
      expect(cache.decision_review).toBeNull();
      expect(JSON.stringify(cache)).not.toContain(foreignScenarioId);
    },
  );

  it('projects the DB-newest valid fact-enriched coaching signal', async () => {
    const scenarioId = randomUUID();
    const sources = factSources(scenarioId, [
      runAnalysisFact(scenarioId, {
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'turn-newest',
        coaching_signal_produced_at: '2026-04-21T12:00:00.000Z',
      }),
      runAnalysisFact(scenarioId, {
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'turn-older',
        coaching_signal_produced_at: '2026-04-20T12:00:00.000Z',
      }),
    ]);

    const cache = await readCoachingCache(scenarioId, sources);
    expect(cache.last_coaching_signal).toEqual({
      signal_id: 'FIRST_ANALYSIS_COMPLETE',
      turn_id: 'turn-newest',
      produced_at: '2026-04-21T12:00:00.000Z',
    });
    expect(Object.keys(cache.last_coaching_signal ?? {})).toEqual([
      'signal_id',
      'turn_id',
      'produced_at',
    ]);
  });

  it.each(['partial', 'refused', 'failed']) (
    'ignores a producer-carried signal on %s and continues to an older successful local signal',
    async (analysisStatus) => {
      const scenarioId = randomUUID();
      const sources = factSources(scenarioId, [
        runAnalysisFact(scenarioId, {
          analysis_status: analysisStatus,
          coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
          coaching_signal_turn_id: `${analysisStatus.toUpperCase()}_FORGED_COMPLETE_CANARY`,
          coaching_signal_produced_at: '2026-04-22T12:00:00.000Z',
        }),
        runAnalysisFact(scenarioId, {
          analysis_status: 'completed',
          coaching_signal_id: 'RERUN_ANALYSIS_COMPLETE',
          coaching_signal_turn_id: 'turn-older-local',
          coaching_signal_produced_at: '2026-04-21T12:00:00.000Z',
        }),
      ]);

      const cache = await readCoachingCache(scenarioId, sources);
      expect(cache.last_coaching_signal).toEqual({
        signal_id: 'RERUN_ANALYSIS_COMPLETE',
        turn_id: 'turn-older-local',
        produced_at: '2026-04-21T12:00:00.000Z',
      });
      expect(JSON.stringify(cache)).not.toContain(
        `${analysisStatus.toUpperCase()}_FORGED_COMPLETE_CANARY`,
      );
    },
  );

  it.each([
    {
      name: 'unrecognised id',
      enrichment: {
        coaching_signal_id: 'NOT_A_REAL_SIGNAL',
        coaching_signal_turn_id: 'turn-42',
        coaching_signal_produced_at: '2026-04-20T09:00:00.000Z',
      },
    },
    {
      name: 'invalid timestamp',
      enrichment: {
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'turn-42',
        coaching_signal_produced_at: 'not-a-timestamp',
      },
    },
    {
      name: 'missing turn',
      enrichment: {
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_produced_at: '2026-04-20T09:00:00.000Z',
      },
    },
  ])('fails weak for a $name fact signal', async ({ enrichment }) => {
    const scenarioId = randomUUID();
    const cache = await readCoachingCache(
      scenarioId,
      factSources(scenarioId, [runAnalysisFact(scenarioId, enrichment)]),
    );
    expect(cache.last_coaching_signal).toBeNull();
  });

  it('rejects a complete carrier attested for another scenario', async () => {
    const scenarioA = randomUUID();
    const scenarioB = randomUUID();
    const sources = factSources(scenarioA, [
      runAnalysisFact(scenarioA, {
        decision_review: {
          produced_at: '2026-04-21T12:00:00.000Z',
          narrative_summary: 'FOREIGN_REVIEW_MUST_NOT_REACH_PROMPT',
        },
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'turn-foreign',
        coaching_signal_produced_at: '2026-04-21T12:00:00.000Z',
      }),
    ]);

    const cache = await readCoachingCache(scenarioB, sources);
    expect(cache).toEqual({
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    });
  });
});
