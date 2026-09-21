import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendDraftCoaching,
  readLatestDraftCoaching,
} from '../draft-coaching-log.js';
import type { DraftCoaching } from '../types.js';

describe('draft-coaching-log sidecar', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'draft-coaching-log-'));
    filePath = join(dir, 'v5-draft-graph-coaching.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeRecord(overrides: Partial<DraftCoaching> = {}): DraftCoaching {
    return {
      scenario_id: overrides.scenario_id ?? 'scen-a',
      produced_at: overrides.produced_at ?? '2026-04-20T10:00:00.000Z',
      summary: 'summary' in overrides ? overrides.summary! : 'Summary text',
      strengthen_items: overrides.strengthen_items ?? [
        { id: 'i1', label: 'Widen options', detail: 'Consider B', action_type: 'widen' },
      ],
      widening_log: 'widening_log' in overrides ? overrides.widening_log! : [{ step: 1 }],
      bias_signals: 'bias_signals' in overrides ? overrides.bias_signals! : [{ type: 'anchoring' }],
    };
  }

  it('returns null when the file does not yet exist', async () => {
    const got = await readLatestDraftCoaching('scen-a', filePath);
    expect(got).toBeNull();
  });

  it('appends a record and reads it back for the same scenario', async () => {
    const record = makeRecord();
    await appendDraftCoaching(record, filePath);

    const got = await readLatestDraftCoaching('scen-a', filePath);
    expect(got).toEqual(record);
  });

  it('returns null when no record matches the scenario', async () => {
    await appendDraftCoaching(makeRecord({ scenario_id: 'other' }), filePath);
    const got = await readLatestDraftCoaching('scen-a', filePath);
    expect(got).toBeNull();
  });

  it('returns the most recent record by produced_at for a scenario', async () => {
    await appendDraftCoaching(
      makeRecord({ produced_at: '2026-04-20T10:00:00.000Z', summary: 'older' }),
      filePath,
    );
    await appendDraftCoaching(
      makeRecord({ produced_at: '2026-04-20T11:00:00.000Z', summary: 'newer' }),
      filePath,
    );

    const got = await readLatestDraftCoaching('scen-a', filePath);
    expect(got?.summary).toBe('newer');
  });

  it('preserves widening_log and bias_signals as pass-through arrays', async () => {
    const widening = [{ step: 1 }, { step: 2 }];
    const bias = [{ type: 'anchoring', confidence: 'high' }];
    await appendDraftCoaching(
      makeRecord({ widening_log: widening, bias_signals: bias }),
      filePath,
    );

    const got = await readLatestDraftCoaching('scen-a', filePath);
    expect(got?.widening_log).toEqual(widening);
    expect(got?.bias_signals).toEqual(bias);
  });

  it('null widening_log / bias_signals round-trip without loss', async () => {
    await appendDraftCoaching(
      makeRecord({ widening_log: null, bias_signals: null }),
      filePath,
    );

    const got = await readLatestDraftCoaching('scen-a', filePath);
    expect(got?.widening_log).toBeNull();
    expect(got?.bias_signals).toBeNull();
  });

  it('swallows I/O failures on append (non-throwing)', async () => {
    // Point at a path that cannot exist (the directory contains a file in place of the target dir).
    const conflictPath = join(dir, 'file-not-a-dir');
    await appendDraftCoaching(makeRecord(), conflictPath);
    // Writing under conflictPath would turn it into a file; subsequent attempt
    // to treat it as a directory would fail but the helper must not throw.
    const secondTarget = join(conflictPath, 'sub', 'log.jsonl');
    await expect(appendDraftCoaching(makeRecord(), secondTarget)).resolves.toBeUndefined();
  });

  it('writes one JSON object per line', async () => {
    await appendDraftCoaching(makeRecord({ summary: 'first' }), filePath);
    await appendDraftCoaching(makeRecord({ summary: 'second' }), filePath);

    const contents = await readFile(filePath, 'utf8');
    const lines = contents.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).summary).toBe('first');
    expect(JSON.parse(lines[1]).summary).toBe('second');
  });
});
