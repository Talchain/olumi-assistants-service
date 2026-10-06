/**
 * SD-1 interim (buddy r1 FAIL 1 + CONCERN 5): the loader names a pair's in-band moves only from the reconciled durable
 * record, never from the hot window alone, and never strands the chip on a pending read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerFact, RunInputSnapshot } from '@talchain/schemas/orchestrator';

const load = vi.fn();
vi.mock('../../build-turn-context.js', () => ({ loadScenarioAnalysisFactsForRead: (...a: unknown[]) => load(...a) }));

import { withinBandMovesForRunDelta } from '../rerun-within-band.js';

const FROM = 'a'; const TO = 'b';
const snap = (mean: number, digest: string): RunInputSnapshot => ({
  snapshot_version: 1, sent_digest: 'a'.repeat(64), residual_digest: 'c'.repeat(64),
  goal: { node_id: 'g', label: 'G', target_raw: 1, unit: 'x', operator: '>=' },
  options: [], options_not_sent: [], factors: [], constraints: [],
  links: [{ from: FROM, to: TO, mean, band: 'strong', sizing: 'user', authorship_digest: digest }],
});
const run = (id: string, s: RunInputSnapshot): HandlerFact => ({ fact_type: 'run_analysis', noop: false, result: { run_id: id, input_snapshot: s } } as unknown as HandlerFact);
const receipt: HandlerFact = { fact_type: 'adjust_edge_strength', noop: false,
  result: { target_id: `${FROM}→${TO}`, status: 'applied', before: { strength: { mean: 0.4 } }, after: { strength: { mean: 0.6 } } } } as unknown as HandlerFact;
const PAIR = [run('r2', snap(0.6, 'e'.repeat(64))), run('r1', snap(0.4, 'b'.repeat(64)))];
const DELTA = { input_coverage: 'partial', endpoints: { prior: { run_id: 'r1' }, current: { run_id: 'r2' } }, input_changes: [] };
const MOVE = { from: FROM, to: TO, band: 'strong', author: 'user' };

// Braces: a function returned from beforeEach is run as its cleanup, and mockReset returns the mock itself.
beforeEach(() => { load.mockReset(); });

describe('withinBandMovesForRunDelta', () => {
  it('the durable record is authority: the pair’s move, with the user receipt from the record or the hot window', async () => {
    load.mockResolvedValue({ factSet: { status: 'complete', source: 'scenario', facts: PAIR, total_count: 2 }, hotWindow: { status: 'ok', facts: [receipt] } });
    expect(await withinBandMovesForRunDelta('s', 'r', DELTA)).toEqual([MOVE]);
  });
  it('⭐ FAIL 1: a degraded/conflicting durable record names NOTHING, even when the hot window holds the pair', async () => {
    load.mockResolvedValue({ factSet: { status: 'degraded', reason: 'snapshot_conflict', facts: [] }, hotWindow: { status: 'ok', facts: [...PAIR, receipt] } });
    expect(await withinBandMovesForRunDelta('s', 'r', DELTA)).toEqual([]);
  });
  it('⭐ CONCERN 5: a read that never settles names nothing by the deadline', async () => {
    load.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    expect(await withinBandMovesForRunDelta('s', 'r', DELTA, 30)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('a read that rejects names nothing', async () => {
    load.mockImplementation(async () => { throw new Error('db down'); });
    expect(await withinBandMovesForRunDelta('s', 'r', DELTA)).toEqual([]);
  });
  it('a delta that is not partial costs no read at all', async () => {
    expect(await withinBandMovesForRunDelta('s', 'r', { ...DELTA, input_coverage: 'complete' })).toEqual([]);
    expect(await withinBandMovesForRunDelta('s', 'r', undefined)).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});
