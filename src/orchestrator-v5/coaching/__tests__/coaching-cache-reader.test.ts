import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { appendDraftCoaching } from '../draft-coaching-log.js';
import {
  DEFAULT_DRAFT_COACHING_LOG_PATH,
  readLatestDraftCoaching,
} from '../draft-coaching-log.js';
import { readCoachingCache } from '../coaching-cache-reader.js';
import type { DraftCoaching } from '../types.js';

function runAnalysisFact(enrichment?: Record<string, unknown>): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'done',
      ...(enrichment ? { enrichment } : {}),
    },
  };
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
    const uniqueScenario = `scen-missing-${Date.now()}`;
    const cache = await readCoachingCache(uniqueScenario, []);
    expect(cache).toEqual({
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    });
  });

  it('populates decision_review from the most recent run_analysis fact with enrichment.decision_review', async () => {
    const uniqueScenario = `scen-dr-${Date.now()}`;
    const dr = {
      produced_at: '2026-04-20T12:00:00.000Z',
      narrative_summary: 'pick option A',
      story_headlines: ['A wins'],
    };
    const facts: HandlerFact[] = [
      runAnalysisFact({ some: 'other' }),
      runAnalysisFact({ decision_review: dr }),
    ];

    const cache = await readCoachingCache(uniqueScenario, facts);
    expect(cache.decision_review).toEqual(dr);
  });

  it('returns null decision_review when run_analysis fact lacks enrichment', async () => {
    const uniqueScenario = `scen-no-dr-${Date.now()}`;
    const facts: HandlerFact[] = [runAnalysisFact()];

    const cache = await readCoachingCache(uniqueScenario, facts);
    expect(cache.decision_review).toBeNull();
  });

  it('populates last_coaching_signal when fact enrichment carries a coaching signal', async () => {
    const uniqueScenario = `scen-sig-${Date.now()}`;
    const facts: HandlerFact[] = [
      runAnalysisFact({
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'turn-42',
        coaching_signal_produced_at: '2026-04-20T09:00:00.000Z',
      }),
    ];

    const cache = await readCoachingCache(uniqueScenario, facts);
    expect(cache.last_coaching_signal).toEqual({
      signal_id: 'FIRST_ANALYSIS_COMPLETE',
      turn_id: 'turn-42',
      produced_at: '2026-04-20T09:00:00.000Z',
    });
  });

  it('rejects an unrecognised coaching_signal_id', async () => {
    const uniqueScenario = `scen-bad-sig-${Date.now()}`;
    const facts: HandlerFact[] = [
      runAnalysisFact({
        coaching_signal_id: 'NOT_A_REAL_SIGNAL',
        coaching_signal_turn_id: 'turn-42',
        coaching_signal_produced_at: '2026-04-20T09:00:00.000Z',
      }),
    ];

    const cache = await readCoachingCache(uniqueScenario, facts);
    expect(cache.last_coaching_signal).toBeNull();
  });

  it('populates draft_coaching from the sidecar log', async () => {
    const uniqueScenario = `scen-draft-${Date.now()}`;
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
      const cache = await readCoachingCache(uniqueScenario, []);
      expect(cache.draft_coaching).toEqual(record);
    } finally {
      // Best-effort cleanup: unique scenario id means leftover records are
      // effectively invisible to other tests; we skip deleting the shared
      // file to avoid fighting concurrent tests.
    }
  });

  it('keeps draft_coaching.bias_signals independent from a CEE preflight-style field on the same fact', async () => {
    const uniqueScenario = `scen-collision-${Date.now()}`;
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

    const cache = await readCoachingCache(uniqueScenario, facts);
    expect(cache.draft_coaching?.bias_signals).toEqual(draftRecord.bias_signals);
    // decision_review is null (no decision_review field on that enrichment):
    expect(cache.decision_review).toBeNull();
  });
});
