import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { appendDraftCoaching } from '../draft-coaching-log.js';
import {
  DEFAULT_DRAFT_COACHING_LOG_PATH,
} from '../draft-coaching-log.js';
import {
  appendLastCoachingSignal,
  DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH,
  type LastCoachingSignalRecord,
} from '../last-coaching-signal-log.js';
import { readCoachingCache } from '../coaching-cache-reader.js';
import type { DraftCoaching } from '../types.js';
import { reconcileScenarioAnalysisFacts } from '../../context/reconcile-scenario-analysis-facts.js';

function runAnalysisFact(
  enrichment?: Record<string, unknown>,
  computedAt?: string,
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'done',
      ...(computedAt !== undefined ? { computed_at: computedAt } : {}),
      ...(enrichment ? { enrichment } : {}),
    },
  };
}

function factSources(
  scenarioId: string,
  inputFacts: readonly HandlerFact[],
) {
  const facts = inputFacts.map((fact) => ({
    ...fact,
    result: { ...fact.result, scenario_id: scenarioId },
  })) as HandlerFact[];
  const analysisFactSet = reconcileScenarioAnalysisFacts({
    scenarioId,
    hotWindowFacts: [],
    hotWindowFactsWithIdentity: [],
    durableRead: {
      status: 'ok',
      scenario_id: scenarioId,
      query_limit: 21,
      total_count: facts.length,
      facts: facts.map((fact, index) => ({
        fact,
        fact_row_id: `analysis-fact-${index}`,
        // Input fixtures preserve the production newest-first convention.
        fact_created_at: `2026-04-21T12:00:${String(59 - index).padStart(2, '0')}.000Z`,
      })),
    },
  });
  return analysisFactSet;
}

function readWithFacts(
  scenarioId: string,
  facts: readonly HandlerFact[],
) {
  return readCoachingCache(scenarioId, factSources(scenarioId, facts));
}

describe('readCoachingCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'coaching-cache-'));
    // Redirect default sidecar path for these tests via a spy; simpler is to
    // use the exported reader-with-path in the helper. Since readCoachingCache
    // calls readLatestDraftCoaching with the default path, we stub the default
    // by writing to it under a unique scenario_id, then cleaning up after.
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns the empty cache when no sources are present', async () => {
    const uniqueScenario = randomUUID();
    const cache = await readWithFacts(uniqueScenario, []);
    expect(cache).toEqual({
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    });
  });

  it('populates decision_review from the most recent run_analysis fact with enrichment.decision_review', async () => {
    const uniqueScenario = randomUUID();
    const dr = {
      produced_at: '2026-04-20T12:00:00.000Z',
      narrative_summary: 'pick option A',
      story_headlines: ['A wins'],
    };
    const facts: HandlerFact[] = [
      runAnalysisFact({ decision_review: dr }),
      runAnalysisFact({ some: 'other' }),
    ];

    const cache = await readWithFacts(uniqueScenario, facts);
    expect(cache.decision_review).toEqual(dr);
  });

  it('picks the NEWEST decision_review when multiple run_analysis facts carry it (newest-first input order)', async () => {
    // V5 review cycle 2: SupabaseSessionStore.readFactsFor now orders by
    // created_at DESC, so priorFacts arrives newest-first. This test pins
    // the forward-walk semantics so a future refactor that flipped the
    // loop direction would fail loudly.
    const uniqueScenario = randomUUID();
    const newestDr = {
      produced_at: '2026-04-21T12:00:00.000Z',
      narrative_summary: 'newest recommendation',
    };
    const olderDr = {
      produced_at: '2026-04-20T12:00:00.000Z',
      narrative_summary: 'older recommendation',
    };
    const facts: HandlerFact[] = [
      runAnalysisFact({ decision_review: newestDr }),
      runAnalysisFact({ decision_review: olderDr }),
    ];

    const cache = await readWithFacts(uniqueScenario, facts);
    expect(cache.decision_review).toEqual(newestDr);
  });

  it('binds decision_review to the exact selected analysis fact, not page position', async () => {
    const uniqueScenario = randomUUID();
    const firstDr = {
      produced_at: '2026-04-21T12:00:00.000Z',
      narrative_summary: 'DB head must not substitute for the selected run',
    };
    const selectedDr = {
      produced_at: '2026-04-20T12:00:00.000Z',
      narrative_summary: 'Selected run review',
    };
    const facts: HandlerFact[] = [
      runAnalysisFact(
        { decision_review: firstDr },
        '2026-04-20T12:00:00.000Z',
      ),
      runAnalysisFact(
        { decision_review: selectedDr },
        '2026-04-21T12:00:00.000Z',
      ),
    ];

    const cache = await readWithFacts(uniqueScenario, facts);
    expect(cache.decision_review).toEqual(selectedDr);
  });

  it('fails weak for a caller-forged complete carrier', async () => {
    const uniqueScenario = randomUUID();
    const fact = runAnalysisFact({
      decision_review: {
        produced_at: '2026-04-21T12:00:00.000Z',
        narrative_summary: 'FORGED_REVIEW_MUST_NOT_REACH_PROMPT',
      },
    });
    const cache = await readCoachingCache(uniqueScenario, {
      status: 'complete',
      source: 'scenario',
      facts: [fact],
      total_count: 1,
    });
    expect(cache.decision_review).toBeNull();
  });

  it.each(['capped', 'degraded'] as const)(
    'reads a reconciler-attested %s scenario fact set per its authority',
    async (status) => {
      const uniqueScenario = randomUUID();
      const scenarioReviewFact = {
        ...runAnalysisFact({
          decision_review: {
            produced_at: '2026-04-21T12:00:00.000Z',
            narrative_summary: 'SCENARIO_REVIEW_CANARY',
          },
          coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
          coaching_signal_turn_id: 'unlicensed-signal-turn',
          coaching_signal_produced_at: '2026-04-21T12:00:00.000Z',
        }),
        result: {
          ...runAnalysisFact().result,
          scenario_id: uniqueScenario,
          enrichment: {
            decision_review: {
              produced_at: '2026-04-21T12:00:00.000Z',
              narrative_summary: 'SCENARIO_REVIEW_CANARY',
            },
            coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
            coaching_signal_turn_id: 'unlicensed-signal-turn',
            coaching_signal_produced_at: '2026-04-21T12:00:00.000Z',
          },
        },
      } as HandlerFact;
      const carrier =
        status === 'degraded'
          ? reconcileScenarioAnalysisFacts({
              scenarioId: uniqueScenario,
              hotWindowFacts: [scenarioReviewFact],
              durableRead: { status: 'degraded', reason: 'unavailable' },
            })
          : reconcileScenarioAnalysisFacts({
              scenarioId: uniqueScenario,
              hotWindowFacts: [],
              hotWindowFactsWithIdentity: [],
              durableRead: {
                status: 'ok',
                scenario_id: uniqueScenario,
                query_limit: 21,
                total_count: 21,
                facts: Array.from({ length: 21 }, (_, index) => ({
                  fact: scenarioReviewFact,
                  fact_row_id: `capped-analysis-fact-${index}`,
                  fact_created_at: `2026-04-21T11:${String(59 - index).padStart(2, '0')}:00.000Z`,
                })),
              },
            });

      expect(carrier.status).toBe(status);
      const cache = await readCoachingCache(uniqueScenario, carrier);

      if (status === 'degraded') {
        // Nothing was read. Absence is not evidence, so coaching stays silent.
        expect(cache.decision_review).toBeNull();
        expect(cache.last_coaching_signal).toBeNull();
        return;
      }

      // `capped` is a VALIDATED durable page whose newest row is the analysis
      // the user is looking at — it is bounded, not unread. Withholding the
      // review here is what made the assistant deny an analysis the UI was
      // simultaneously reporting as fresh, from the 21st run onward.
      expect(cache.decision_review).toEqual({
        produced_at: '2026-04-21T12:00:00.000Z',
        narrative_summary: 'SCENARIO_REVIEW_CANARY',
      });
      expect(cache.last_coaching_signal).toEqual({
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        turn_id: 'unlicensed-signal-turn',
        produced_at: '2026-04-21T12:00:00.000Z',
      });
    },
  );

  it('picks the NEWEST coaching_signal when multiple run_analysis facts carry one', async () => {
    const uniqueScenario = randomUUID();
    const facts: HandlerFact[] = [
      runAnalysisFact({
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'turn-newest',
        coaching_signal_produced_at: '2026-04-21T12:00:00.000Z',
      }),
      runAnalysisFact({
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'turn-older',
        coaching_signal_produced_at: '2026-04-20T12:00:00.000Z',
      }),
    ];

    const cache = await readWithFacts(uniqueScenario, facts);
    expect(cache.last_coaching_signal?.turn_id).toBe('turn-newest');
  });

  it('returns null decision_review when run_analysis fact lacks enrichment', async () => {
    const uniqueScenario = randomUUID();
    const facts: HandlerFact[] = [runAnalysisFact()];

    const cache = await readWithFacts(uniqueScenario, facts);
    expect(cache.decision_review).toBeNull();
  });

  it('populates last_coaching_signal when fact enrichment carries a coaching signal', async () => {
    const uniqueScenario = randomUUID();
    const facts: HandlerFact[] = [
      runAnalysisFact({
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'turn-42',
        coaching_signal_produced_at: '2026-04-20T09:00:00.000Z',
      }),
    ];

    const cache = await readWithFacts(uniqueScenario, facts);
    expect(cache.last_coaching_signal).toEqual({
      signal_id: 'FIRST_ANALYSIS_COMPLETE',
      turn_id: 'turn-42',
      produced_at: '2026-04-20T09:00:00.000Z',
    });
  });

  it('rejects an unrecognised coaching_signal_id', async () => {
    const uniqueScenario = randomUUID();
    const facts: HandlerFact[] = [
      runAnalysisFact({
        coaching_signal_id: 'NOT_A_REAL_SIGNAL',
        coaching_signal_turn_id: 'turn-42',
        coaching_signal_produced_at: '2026-04-20T09:00:00.000Z',
      }),
    ];

    const cache = await readWithFacts(uniqueScenario, facts);
    expect(cache.last_coaching_signal).toBeNull();
  });

  it('populates draft_coaching from the sidecar log', async () => {
    const uniqueScenario = randomUUID();
    const record: DraftCoaching = {
      scenario_id: uniqueScenario,
      produced_at: '2026-04-20T10:00:00.000Z',
      summary: 'headline',
      strengthen_items: [],
      widening_log: null,
      bias_signals: null,
    };
    // Write to the default sidecar path (module-level constant). The record is
    // scoped to a unique scenario_id so it does not collide with other tests.
    await appendDraftCoaching(record, DEFAULT_DRAFT_COACHING_LOG_PATH);

    try {
      const cache = await readWithFacts(uniqueScenario, []);
      expect(cache.draft_coaching).toEqual(record);
    } finally {
      // Best-effort cleanup: unique scenario id means leftover records are
      // effectively invisible to other tests; we skip deleting the shared
      // file to avoid fighting concurrent tests.
    }
  });

  it('keeps draft_coaching.bias_signals independent from a CEE preflight-style field on the same fact', async () => {
    const uniqueScenario = randomUUID();
    const draftRecord: DraftCoaching = {
      scenario_id: uniqueScenario,
      produced_at: '2026-04-20T10:00:00.000Z',
      summary: 's',
      strengthen_items: [],
      widening_log: null,
      bias_signals: [{ type: 'anchoring', confidence: 'high', evidence: 'price reference' }],
    };
    await appendDraftCoaching(draftRecord, DEFAULT_DRAFT_COACHING_LOG_PATH);

    const facts: HandlerFact[] = [
      runAnalysisFact({
        // A bare `bias_signals` on the enrichment (hypothetical, not a real
        // contract). The reader must not conflate this with draft_coaching.bias_signals.
        bias_signals: [{ type: 'preflight_marker' }],
      }),
    ];

    const cache = await readWithFacts(uniqueScenario, facts);
    expect(cache.draft_coaching?.bias_signals).toEqual(draftRecord.bias_signals);
    // decision_review is null (no decision_review field on that enrichment):
    expect(cache.decision_review).toBeNull();
  });

  // Review feedback P1.1: signal sources must merge by produced_at, not
  // short-circuit on facts. These tests pin the merge contract so a newer
  // edit-turn signal cannot be masked by an older analysis-turn signal.
  describe('last_coaching_signal merge precedence', () => {
    function factWithSignal(args: {
      signal_id: string;
      turn_id: string;
      produced_at: string;
    }): HandlerFact {
      return runAnalysisFact({
        coaching_signal_id: args.signal_id,
        coaching_signal_turn_id: args.turn_id,
        coaching_signal_produced_at: args.produced_at,
      });
    }

    it('picks the sidecar signal when it is newer than the fact signal', async () => {
      const uniqueScenario = randomUUID();
      const olderFactFact = factWithSignal({
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        turn_id: 'turn-older',
        produced_at: '2026-04-20T09:00:00.000Z',
      });
      const newerSidecar: LastCoachingSignalRecord = {
        scenario_id: uniqueScenario,
        signal_id: 'STALE_ANALYSIS_AFTER_EDIT',
        turn_id: 'turn-newer',
        produced_at: '2026-04-20T10:00:00.000Z',
      };
      await appendLastCoachingSignal(newerSidecar, DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH);

      const cache = await readWithFacts(uniqueScenario, [olderFactFact]);
      expect(cache.last_coaching_signal?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
      expect(cache.last_coaching_signal?.turn_id).toBe('turn-newer');
    });

    it('compares equivalent ISO offsets by represented instant, not lexical text', async () => {
      const uniqueScenario = randomUUID();
      const olderFactFact = factWithSignal({
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        turn_id: 'turn-older-offset',
        // 2026-04-29T23:00:00Z
        produced_at: '2026-04-30T01:00:00+02:00',
      });
      const newerSidecar: LastCoachingSignalRecord = {
        scenario_id: uniqueScenario,
        signal_id: 'STALE_ANALYSIS_AFTER_EDIT',
        turn_id: 'turn-newer-zulu',
        // Later instant even though this string sorts before the fact string.
        produced_at: '2026-04-30T00:30:00.000Z',
      };
      await appendLastCoachingSignal(newerSidecar, DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH);

      const cache = await readWithFacts(uniqueScenario, [olderFactFact]);
      expect(cache.last_coaching_signal?.turn_id).toBe('turn-newer-zulu');
    });

    it('resolves equal represented instants deterministically to the fact source', async () => {
      const uniqueScenario = randomUUID();
      const fact = factWithSignal({
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        turn_id: 'turn-fact-tie',
        produced_at: '2026-04-30T01:00:00+01:00',
      });
      await appendLastCoachingSignal(
        {
          scenario_id: uniqueScenario,
          signal_id: 'STALE_ANALYSIS_AFTER_EDIT',
          turn_id: 'turn-sidecar-tie',
          produced_at: '2026-04-30T00:00:00.000Z',
        },
        DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH,
      );

      const cache = await readWithFacts(uniqueScenario, [fact]);
      expect(cache.last_coaching_signal?.turn_id).toBe('turn-fact-tie');
    });

    it.each([
      {
        label: 'valid sidecar beats invalid fact',
        factAt: 'not-an-instant',
        sidecarAt: '2026-04-30T00:00:00.000Z',
        expectedTurn: 'turn-valid-sidecar',
      },
      {
        label: 'valid fact beats invalid sidecar',
        factAt: '2026-04-30T00:00:00.000Z',
        sidecarAt: 'not-an-instant',
        expectedTurn: 'turn-valid-fact',
      },
    ])('$label', async ({ factAt, sidecarAt, expectedTurn }) => {
      const uniqueScenario = randomUUID();
      const fact = factWithSignal({
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        turn_id: 'turn-valid-fact',
        produced_at: factAt,
      });
      await appendLastCoachingSignal(
        {
          scenario_id: uniqueScenario,
          signal_id: 'STALE_ANALYSIS_AFTER_EDIT',
          turn_id: 'turn-valid-sidecar',
          produced_at: sidecarAt,
        },
        DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH,
      );

      const cache = await readWithFacts(uniqueScenario, [fact]);
      expect(cache.last_coaching_signal?.turn_id).toBe(expectedTurn);
    });

    it('withholds singleton and paired signals whose timestamps are invalid', async () => {
      const factOnlyScenario = randomUUID();
      const invalidFact = factWithSignal({
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        turn_id: 'turn-invalid-fact',
        produced_at: 'not-an-instant',
      });
      expect(
        (await readWithFacts(factOnlyScenario, [invalidFact]))
          .last_coaching_signal,
      ).toBeNull();

      const pairedScenario = randomUUID();
      await appendLastCoachingSignal(
        {
          scenario_id: pairedScenario,
          signal_id: 'STALE_ANALYSIS_AFTER_EDIT',
          turn_id: 'turn-invalid-sidecar',
          produced_at: 'also-not-an-instant',
        },
        DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH,
      );
      expect(
        (await readWithFacts(pairedScenario, [invalidFact]))
          .last_coaching_signal,
      ).toBeNull();
    });

    it.each([
      '2026-02-30T00:00:00.000Z',
      '2026-04-31T00:00:00.000Z',
    ])(
      'withholds calendar-impossible singleton and paired signals: %s',
      async (impossibleAt) => {
        const singletonScenario = randomUUID();
        const impossibleFact = factWithSignal({
          signal_id: 'FIRST_ANALYSIS_COMPLETE',
          turn_id: 'turn-impossible-fact',
          produced_at: impossibleAt,
        });
        expect(
          (await readWithFacts(singletonScenario, [impossibleFact]))
            .last_coaching_signal,
        ).toBeNull();

        const pairedScenario = randomUUID();
        await appendLastCoachingSignal(
          {
            scenario_id: pairedScenario,
            signal_id: 'STALE_ANALYSIS_AFTER_EDIT',
            turn_id: 'turn-impossible-sidecar',
            produced_at: impossibleAt,
          },
          DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH,
        );
        expect(
          (await readWithFacts(pairedScenario, [impossibleFact]))
            .last_coaching_signal,
        ).toBeNull();
      },
    );

    it('picks the fact signal when it is newer than the sidecar signal', async () => {
      const uniqueScenario = randomUUID();
      const newerFactFact = factWithSignal({
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        turn_id: 'turn-fact',
        produced_at: '2026-04-20T11:00:00.000Z',
      });
      const olderSidecar: LastCoachingSignalRecord = {
        scenario_id: uniqueScenario,
        signal_id: 'STALE_ANALYSIS_AFTER_EDIT',
        turn_id: 'turn-sidecar',
        produced_at: '2026-04-20T09:00:00.000Z',
      };
      await appendLastCoachingSignal(olderSidecar, DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH);

      const cache = await readWithFacts(uniqueScenario, [newerFactFact]);
      expect(cache.last_coaching_signal?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
      expect(cache.last_coaching_signal?.turn_id).toBe('turn-fact');
    });

    it('falls back to sidecar when no fact carries a signal', async () => {
      const uniqueScenario = randomUUID();
      const sidecarOnly: LastCoachingSignalRecord = {
        scenario_id: uniqueScenario,
        signal_id: 'HIGH_SENSITIVITY_EDIT',
        turn_id: 'turn-edit',
        produced_at: '2026-04-20T12:00:00.000Z',
      };
      await appendLastCoachingSignal(sidecarOnly, DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH);

      const cache = await readWithFacts(uniqueScenario, []);
      expect(cache.last_coaching_signal?.signal_id).toBe('HIGH_SENSITIVITY_EDIT');
      expect(cache.last_coaching_signal?.turn_id).toBe('turn-edit');
    });

    it('falls back to fact when no sidecar entry exists for the scenario', async () => {
      const uniqueScenario = randomUUID();
      const fact = factWithSignal({
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        turn_id: 'turn-fact-only',
        produced_at: '2026-04-20T08:00:00.000Z',
      });

      const cache = await readWithFacts(uniqueScenario, [fact]);
      expect(cache.last_coaching_signal?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    });

    it('returns null when neither source has a signal for this scenario', async () => {
      const uniqueScenario = randomUUID();
      const cache = await readWithFacts(uniqueScenario, []);
      expect(cache.last_coaching_signal).toBeNull();
    });
  });
});
